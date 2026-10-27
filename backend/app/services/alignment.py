"""Finds when each word of a chunk is spoken in its audio.

A speech recognizer (Whisper) listens to the audio and reports the words it
heard with timestamps. Those are matched against the chunk's real text, so
the result is one start time per word of the text, in the order given by
paragraph_words().
"""

import difflib
import re

from faster_whisper import WhisperModel

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


def word_start_times(audio_path: str, text: str, duration: float) -> list[float]:
    words = [word for paragraph in paragraph_words(text) for word in paragraph]
    segments, _ = _get_model().transcribe(
        audio_path, language="en", word_timestamps=True
    )
    heard = [w for segment in segments for w in segment.words]

    starts: list[float | None] = [None] * len(words)
    matcher = difflib.SequenceMatcher(
        None,
        [_normalize(w) for w in words],
        [_normalize(w.word) for w in heard],
        autojunk=False,
    )
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == "equal":
            for k in range(i2 - i1):
                starts[i1 + k] = heard[j1 + k].start
        elif op == "replace":
            # Heard differently (often names): spread the real words evenly
            # over the time span of what was heard.
            span_start, span_end = heard[j1].start, heard[j2 - 1].end
            for k in range(i2 - i1):
                starts[i1 + k] = span_start + (span_end - span_start) * k / (i2 - i1)
        # "delete" (text words not heard) is filled in below; "insert"
        # (heard words not in the text) is ignored.

    return _fill_gaps(starts, duration)


def _fill_gaps(starts: list[float | None], duration: float) -> list[float]:
    """Places words without a time evenly between their timed neighbors."""
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
        before = result[-1] if result else 0.0
        after = starts[gap_end] if gap_end < len(starts) else duration
        after = max(after, before)
        count = gap_end - i
        for k in range(count):
            result.append(before + (after - before) * (k + 1) / (count + 1))
        i = gap_end
    return [round(t, 2) for t in result]
