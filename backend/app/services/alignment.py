"""Finds when each word of a chunk is spoken in its audio.

A speech recognizer (Whisper) listens to the audio and reports the words it
heard with timestamps. Those are matched against the chunk's real text, so
the result is one start time per word of the text, in the order given by
paragraph_words().
"""

import difflib
import re

from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio

from app.config import settings
from app.services.chunker import paragraph_words

_model: WhisperModel | None = None


def _get_model() -> WhisperModel:
    # Loading takes a few seconds (and downloads the model on first use).
    global _model
    if _model is None:
        _model = WhisperModel(
            settings.whisper_model,
            device="cpu",
            compute_type="int8",
            download_root=settings.whisper_model_dir,
        )
    return _model


def _normalize(word: str) -> str:
    return re.sub(r"[^a-z0-9]", "", word.lower())


# A run of this many words in a row that Whisper didn't hear (or heard
# differently) is listened to again on its own; see word_start_times.
RETRY_RUN = 4
# How many heard words on each side of such a run are listened to again too.
# Whisper's times right next to the skipped words are often wrong as well.
RETRY_CONTEXT = 2
SAMPLE_RATE = 16000  # what Whisper listens at


def _heard_words(audio, offset: float) -> list[tuple[str, float, float]]:
    """Transcribes audio (samples at SAMPLE_RATE) into (word, start, end),
    with times counted from offset seconds."""
    # By default Whisper uses what it wrote so far as context for the next
    # stretch of audio, so one mistake can feed the next: stuttered dialogue
    # like "n-no." once made it write "No." over and over while skipping 40
    # seconds of speech. Without that context it can't get stuck in a loop.
    segments, _ = _get_model().transcribe(
        audio,
        language="en",
        word_timestamps=True,
        condition_on_previous_text=False,
    )
    heard: list[tuple[str, float, float]] = []
    for segment in segments:
        for w in segment.words:
            # A new word starts with a space. Without one it's the rest of
            # the previous word ("third" + "-class"), so join them back up.
            if heard and not w.word.startswith(" "):
                word, start, _ = heard[-1]
                heard[-1] = (word + w.word, start, offset + w.end)
            else:
                heard.append((w.word, offset + w.start, offset + w.end))
    return heard


def _match(words, heard, starts, ends, first: int) -> int:
    """Gives each of words the times of the heard word it matches, written
    into starts and ends from index first on. Returns how many matched."""
    matched = 0
    matcher = difflib.SequenceMatcher(
        None,
        [_normalize(w) for w in words],
        [_normalize(word) for word, _, _ in heard],
        autojunk=False,
    )
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == "equal":
            for k in range(i2 - i1):
                _, starts[first + i1 + k], ends[first + i1 + k] = heard[j1 + k]
            matched += i2 - i1
    return matched


def word_start_times(audio_path: str, text: str, duration: float) -> list[float]:
    words = [word for paragraph in paragraph_words(text) for word in paragraph]
    audio = decode_audio(audio_path, sampling_rate=SAMPLE_RATE)

    # Only words heard exactly as written get a time from Whisper. The rest
    # (heard differently, often names, or not heard at all) are placed
    # between those in _fill_gaps. What was heard instead isn't used, since
    # it can be nonsense.
    starts: list[float | None] = [None] * len(words)
    ends: list[float | None] = [None] * len(words)
    _match(words, _heard_words(audio, 0.0), starts, ends, 0)

    # On a long recording Whisper sometimes skips a few lines outright (it
    # once stretched one word over 8 seconds of dialogue), yet hears them
    # fine when that stretch is played to it alone. So each run of unheard
    # words is listened to again, with a little before and after.
    for first, last in _unheard_runs(starts):
        timed_before = [i for i in range(first) if starts[i] is not None]
        timed_after = [i for i in range(last, len(words)) if starts[i] is not None]
        first = timed_before[-RETRY_CONTEXT] if len(timed_before) >= RETRY_CONTEXT else 0
        last = (
            timed_after[RETRY_CONTEXT] if len(timed_after) > RETRY_CONTEXT else len(words)
        )
        clip_start = max(starts[first] - 0.5, 0.0) if first else 0.0
        clip_end = starts[last] if last < len(words) else duration
        if clip_end - clip_start < 1:
            continue
        clip = audio[int(clip_start * SAMPLE_RATE) : int(clip_end * SAMPLE_RATE)]

        retry_starts = [None] * len(words)
        retry_ends = [None] * len(words)
        heard = _heard_words(clip, clip_start)
        before = sum(s is not None for s in starts[first:last])
        # Kept only if it's an improvement.
        if _match(words[first:last], heard, retry_starts, retry_ends, first) > before:
            starts[first:last] = retry_starts[first:last]
            ends[first:last] = retry_ends[first:last]

    return _fill_gaps(words, starts, ends, duration)


def _unheard_runs(starts: list[float | None]) -> list[tuple[int, int]]:
    """The (first, end) index ranges of RETRY_RUN or more untimed words in a
    row."""
    runs = []
    i = 0
    while i < len(starts):
        if starts[i] is None:
            end = i
            while end < len(starts) and starts[end] is None:
                end += 1
            if end - i >= RETRY_RUN:
                runs.append((i, end))
            i = end
        else:
            i += 1
    return runs


def _fill_gaps(
    words: list[str],
    starts: list[float | None],
    ends: list[float | None],
    duration: float,
) -> list[float]:
    """Places words without a time between the end of the timed word before
    them and the start of the timed word after them, giving longer words
    more time."""
    result: list[float] = []
    i = 0
    while i < len(starts):
        if starts[i] is not None:
            # Times must never go backwards, or highlighting would jump back.
            result.append(max(starts[i], result[-1] if result else 0.0))
            i += 1
            continue
        gap_end = i
        while gap_end < len(starts) and starts[gap_end] is None:
            gap_end += 1
        before = max(ends[i - 1] if i else 0.0, result[-1] if result else 0.0)
        after = starts[gap_end] if gap_end < len(starts) else duration
        after = max(after, before)
        # Each word's share of the gap is its length (+1 for the space).
        lengths = [len(word) + 1 for word in words[i:gap_end]]
        total = sum(lengths)
        done = 0
        for length in lengths:
            result.append(before + (after - before) * done / total)
            done += length
        i = gap_end
    return [round(t, 2) for t in result]
