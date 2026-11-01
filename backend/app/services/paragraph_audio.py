"""Reads text one paragraph at a time, with a pause after each paragraph.

In a story a new paragraph often means a different character is speaking,
so a clear pause makes that easier to hear. Kokoro and Qwen both read this
way. (OpenAI reads each chunk in one request, without these pauses.)

Since the paragraphs are joined here, we also know exactly when each one is
spoken, which keeps the word highlighting on time (see alignment).
"""

import re
from collections.abc import Awaitable, Callable

import numpy as np

# Seconds of silence after each paragraph (the paragraph_pause preference).
# It comes on top of the short pause the voice makes anyway at the end of a
# sentence. 0.35 is what Qwen always used before the pause was adjustable.
DEFAULT_PAUSE = 0.35
MAX_PAUSE = 2.0

# (start, end) in seconds of the speech in each paragraph, in order.
Spans = list[tuple[float, float]]

# Audio quieter than this (RMS, with samples from -1 to 1) counts as silence
# when finding where a paragraph's speech starts and ends.
SILENCE_LEVEL = 0.003


def _speech_bounds(samples: np.ndarray, sample_rate: int) -> tuple[int, int]:
    """The first and last sample of the speech, leaving out the near-silence
    a voice sometimes leaves before and after it. Measured in 10 ms frames."""
    frame = sample_rate // 100
    n = len(samples) // frame
    if n == 0:
        return 0, len(samples)
    rms = np.sqrt((samples[: n * frame].reshape(n, frame) ** 2).mean(axis=1))
    loud = np.flatnonzero(rms >= SILENCE_LEVEL)
    if len(loud) == 0:
        return 0, len(samples)
    return int(loud[0]) * frame, (int(loud[-1]) + 1) * frame


async def read_paragraphs(
    text: str,
    speak: Callable[[str], Awaitable[np.ndarray]],
    sample_rate: int,
    pause: float,
) -> tuple[np.ndarray, Spans]:
    """speak(paragraph) returns that paragraph's audio as float32 samples at
    sample_rate. Paragraphs are separated by blank lines (see chunker).
    Returns the audio, and when each paragraph is spoken in it."""
    silence = np.zeros(int(sample_rate * pause), dtype=np.float32)
    pieces = []
    spans: Spans = []
    position = 0  # samples so far
    for paragraph in text.split("\n\n"):
        # Paragraphs like "…" have nothing to say, so they just get a pause.
        if re.search(r"\w", paragraph):
            audio = await speak(paragraph.strip())
            first, last = _speech_bounds(audio, sample_rate)
            spans.append(((position + first) / sample_rate, (position + last) / sample_rate))
            pieces.append(audio)
            position += len(audio)
        else:
            spans.append((position / sample_rate, position / sample_rate))
        pieces.append(silence)
        position += len(silence)
    return np.concatenate(pieces), spans
