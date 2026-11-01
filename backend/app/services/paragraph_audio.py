"""Reads text one paragraph at a time, with a pause after each paragraph.

In a story a new paragraph often means a different character is speaking,
so a clear pause makes that easier to hear. Kokoro and Qwen both read this
way. (OpenAI reads each chunk in one request, without these pauses.)
"""

import re
from collections.abc import Awaitable, Callable

import numpy as np

# Seconds of silence after each paragraph (the paragraph_pause preference).
# It comes on top of the short pause the voice makes anyway at the end of a
# sentence. 0.35 is what Qwen always used before the pause was adjustable.
DEFAULT_PAUSE = 0.35
MAX_PAUSE = 2.0


async def read_paragraphs(
    text: str,
    speak: Callable[[str], Awaitable[np.ndarray]],
    sample_rate: int,
    pause: float,
) -> np.ndarray:
    """speak(paragraph) returns that paragraph's audio as float32 samples at
    sample_rate. Paragraphs are separated by blank lines (see chunker)."""
    silence = np.zeros(int(sample_rate * pause), dtype=np.float32)
    pieces = []
    for paragraph in text.split("\n\n"):
        # Paragraphs like "…" have nothing to say, so they just get a pause.
        if re.search(r"\w", paragraph):
            pieces.append(await speak(paragraph.strip()))
        pieces.append(silence)
    return np.concatenate(pieces)
