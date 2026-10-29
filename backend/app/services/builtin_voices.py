from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import VoicePreset
from app.services.tts import KOKORO_VOICES


def kokoro_name(voice: str) -> str:
    """"af_bella" -> "Bella"."""
    return voice.split("_", 1)[1].capitalize()


async def add_kokoro_voices(session: AsyncSession) -> None:
    """Gives every Kokoro voice a row, so all of them can be picked in the
    Reader without creating a preset first. Run at startup; voices that
    already have a row (under any name) are left alone."""
    rows = (
        await session.execute(select(VoicePreset.engine, VoicePreset.base_voice, VoicePreset.name))
    ).all()
    existing = {(engine, voice) for engine, voice, _ in rows}
    names = {name for _, _, name in rows}
    for voice in KOKORO_VOICES:
        if ("kokoro", voice) in existing:
            continue
        name = kokoro_name(voice)
        # Names are unique, and a saved voice may already use this one.
        if name in names:
            name = f"{name} (Kokoro)"
        session.add(VoicePreset(name=name, engine="kokoro", base_voice=voice))
        names.add(name)
    await session.commit()
