"""A short exchange between two people, read in a voice with a chosen pause
between the lines, so the pause can be heard before generating anything.

The lines are generated once per voice and kept as WAV files (exact, unlike
MP3), so trying another pause only means joining them with different
silence, which is instant.
"""

import asyncio
import hashlib
from pathlib import Path

import numpy as np
import soundfile as sf

from app.config import settings
from app.models import VoicePreset
from app.services.tts import speak_paragraph, to_mp3

# Each line is its own paragraph, as in a story, with the speaker changing
# every line, which is what the pause is for.
LINES = [
    '"Are you coming with us tomorrow?"',
    "\"I can't. I promised my sister I'd help her move.\"",
    "\"Again? Didn't she just move last spring?\"",
    "\"She did. Don't ask.\"",
]

def _dir() -> Path:
    # Read each time rather than once at startup, so it follows the setting
    # (the tests point it at a temporary folder).
    return Path(settings.samples_dir) / "pause-preview"


def _paths(preset: VoicePreset) -> list[Path]:
    # A fingerprint of what the lines sound like, so a voice whose settings
    # changed (or new lines) gets new files instead of reusing the old ones.
    key = "|".join([preset.engine, preset.base_voice, *LINES])
    fingerprint = hashlib.sha256(key.encode()).hexdigest()[:12]
    return [_dir() / f"{preset.id}-{fingerprint}-{i}.wav" for i in range(len(LINES))]


def remove(preset_id: int) -> None:
    """Deletes a voice's saved lines."""
    for old in _dir().glob(f"{preset_id}-*.wav"):
        old.unlink(missing_ok=True)


async def preview(preset: VoicePreset, pause: float) -> bytes:
    """MP3 of the lines read in the voice, with pause seconds between them."""
    paths = _paths(preset)
    if not all(path.is_file() for path in paths):
        remove(preset.id)  # lines made with the voice's earlier settings
        _dir().mkdir(parents=True, exist_ok=True)
        for line, path in zip(LINES, paths):
            samples, rate = await speak_paragraph(line, preset.engine, preset.base_voice)
            sf.write(path, samples, rate)

    def join() -> bytes:
        pieces = []
        for path in paths:
            samples, rate = sf.read(path, dtype="float32")
            pieces += [samples, np.zeros(int(rate * pause), dtype=np.float32)]
        return to_mp3(np.concatenate(pieces[:-1]), rate)  # no pause at the end

    return await asyncio.to_thread(join)
