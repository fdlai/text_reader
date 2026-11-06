"""Finds when each word of a chunk is spoken in its audio.

A speech recognizer (Whisper) listens to the audio and reports the words it
heard with timestamps. Those are matched against the chunk's real text, so
the result is one start time per word of the text, in the order given by
paragraph_words().

For Kokoro and Qwen we also know when each paragraph is spoken, since the
app joins the paragraphs itself (see paragraph_audio). That fixes the start
of each paragraph exactly and keeps every word inside its own paragraph.
Otherwise a paragraph whose first words Whisper didn't hear would be spread
back into the pause before it, running ahead of the voice.
"""

import difflib
import re

from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio

from app.config import settings
from app.services.chunker import paragraph_words
from app.services.paragraph_audio import Spans

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
# How alike (0 to 1) a heard word's spelling must be to the written word to
# count as it, e.g. "Beek" for "Baek" (0.75) or "Mihyung" for "Myung"
# (0.67). Names are what Whisper most often spells differently.
NEAR_MATCH = 0.5
# How far (seconds) before its paragraph's speech a heard word may start and
# still be trusted. Whisper often starts a word a little early; much earlier
# means it was matched to the wrong place.
SPAN_SLACK = 0.3


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


def _similar(written: str, heard: str) -> bool:
    return bool(written) and difflib.SequenceMatcher(None, written, heard).ratio() >= NEAR_MATCH


def _match(words, heard, starts, ends, first: int) -> int:
    """Gives each of words the times of the heard word it matches, written
    into starts and ends from index first on. Returns how many matched.

    Words heard exactly match, and so do words heard with a similar
    spelling in the same place: a run of words heard differently, as many
    as were written (e.g. "Beek" for "Baek"), is matched word for word
    where the spellings are close."""
    matched = 0
    written_words = [_normalize(w) for w in words]
    heard_words = [_normalize(word) for word, _, _ in heard]
    matcher = difflib.SequenceMatcher(None, written_words, heard_words, autojunk=False)
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == "equal" or (op == "replace" and i2 - i1 == j2 - j1):
            for k in range(i2 - i1):
                if op == "equal" or _similar(written_words[i1 + k], heard_words[j1 + k]):
                    _, starts[first + i1 + k], ends[first + i1 + k] = heard[j1 + k]
                    matched += 1
    return matched


def word_start_times(
    audio_path: str, text: str, duration: float, spans: Spans | None = None
) -> list[float]:
    """spans: when each paragraph is spoken, if known (see the top)."""
    paragraphs = paragraph_words(text)
    words = [word for paragraph in paragraphs for word in paragraph]
    audio = decode_audio(audio_path, sampling_rate=SAMPLE_RATE)

    # Only words heard as written (or spelled similarly, see _match) get a
    # time from Whisper. The rest (heard as other words, or not heard at
    # all) are placed between those in _fill_gaps.
    starts: list[float | None] = [None] * len(words)
    ends: list[float | None] = [None] * len(words)
    _match(words, _heard_words(audio, 0.0), starts, ends, 0)

    # On a long recording Whisper sometimes skips a few lines outright (it
    # once stretched one word over 8 seconds of dialogue), yet hears them
    # fine when that stretch is played to it alone. So each run of unheard
    # words is listened to again, with a little before and after.
    for first, last in _unheard_runs(starts):
        # The clip is cut around heard words with some length. When Whisper
        # skips a stretch, it can report a few of the skipped words with no
        # length (start = end) where it picks up again, seconds after they
        # were spoken. A clip starting from those would miss the skipped
        # speech. (Their times are otherwise kept: after a pause, a word
        # with no length often does start when Whisper says.)
        def anchor(i):
            return starts[i] is not None and ends[i] > starts[i]

        timed_before = [i for i in range(first) if anchor(i)]
        timed_after = [i for i in range(last, len(words)) if anchor(i)]
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

    if spans is None or len(spans) != len(paragraphs):
        return _fill_gaps(words, starts, ends, duration)
    return _fill_paragraphs(paragraphs, starts, ends, spans)


def _fill_paragraphs(
    paragraphs: list[list[str]],
    starts: list[float | None],
    ends: list[float | None],
    spans: Spans,
) -> list[float]:
    """Like _fill_gaps, one paragraph at a time: its first word starts when
    its speech does, and words heard outside it are treated as not heard."""
    result: list[float] = []
    first = 0
    for words, (start, end) in zip(paragraphs, spans):
        last = first + len(words)
        p_starts = starts[first:last]
        p_ends = ends[first:last]
        for i, t in enumerate(p_starts):
            if t is not None and not start - SPAN_SLACK <= t <= end:
                p_starts[i] = p_ends[i] = None
        if words:
            p_starts[0] = start
        # Times may not go back before the previous paragraph's last word.
        result += [max(t, result[-1] if result else 0.0) for t in _fill_gaps(words, p_starts, p_ends, end)]
        first = last
    return result


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
        previous_end = ends[i - 1] if i else None
        before = max(previous_end or 0.0, result[-1] if result else 0.0)
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
