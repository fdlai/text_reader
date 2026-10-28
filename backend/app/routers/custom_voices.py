import base64
import binascii
import io

import soundfile as sf
from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import CustomVoice, VoicePreset
from app.schemas_audio import CustomVoiceIn, CustomVoiceOut, VoiceDesignIn
from app.services import qwen
from app.services.errors import TTSError
from app.services.generation import delete_preset_audio

router = APIRouter(prefix="/api/custom-voices", tags=["custom voices"])


@router.get("", response_model=list[CustomVoiceOut])
async def list_custom_voices(session: AsyncSession = Depends(get_session)):
    return (await session.scalars(select(CustomVoice).order_by(CustomVoice.name))).all()


# Makes a sample but doesn't save it. The page plays it, and sends it back
# to be saved only if the user likes it.
@router.post("/design")
async def design(body: VoiceDesignIn):
    try:
        sample = await qwen.design(body.description)
    except TTSError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))
    return Response(content=sample, media_type="audio/wav")


def _decode_sample(sample_b64: str) -> bytes:
    try:
        data = base64.b64decode(sample_b64, validate=True)
        info = sf.info(io.BytesIO(data))
    except (binascii.Error, sf.LibsndfileError, RuntimeError):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The sample isn't a valid audio file.")
    if info.format != "WAV" or not 1 <= info.duration <= 30:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "The sample must be a WAV file of 1 to 30 seconds."
        )
    return data


@router.post("", response_model=CustomVoiceOut, status_code=status.HTTP_201_CREATED)
async def create_custom_voice(body: CustomVoiceIn, session: AsyncSession = Depends(get_session)):
    sample = _decode_sample(body.sample_b64)
    name = body.name.strip()
    voice = CustomVoice(name=name, description=body.description.strip())
    session.add(voice)
    try:
        # flush assigns the id, which names the sample file.
        await session.flush()
        # A preset with the same name makes the voice selectable in the
        # Reader right away; it also holds the voice's speed and audio.
        session.add(VoicePreset(name=name, engine="qwen", base_voice=str(voice.id)))
        await session.flush()
    except IntegrityError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A voice or preset with that name already exists."
        )
    path = qwen.voice_path(voice.id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(sample)
    await session.commit()
    return voice


@router.get("/{voice_id}/sample")
async def get_sample(voice_id: int):
    path = qwen.voice_path(voice_id)
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Voice not found.")
    return FileResponse(path, media_type="audio/wav")


@router.delete("/{voice_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_custom_voice(voice_id: int, session: AsyncSession = Depends(get_session)):
    voice = await session.get(CustomVoice, voice_id)
    if voice is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Voice not found.")
    # Presets using the voice (they store its id as base_voice) can't work
    # without it, so they're deleted too, along with their audio.
    presets = (
        await session.scalars(
            select(VoicePreset).where(
                VoicePreset.engine == "qwen", VoicePreset.base_voice == str(voice_id)
            )
        )
    ).all()
    for preset in presets:
        await delete_preset_audio(session, preset.id)
        await session.delete(preset)
    await session.delete(voice)
    await session.commit()
    qwen.voice_path(voice_id).unlink(missing_ok=True)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
