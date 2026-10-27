from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import AudioFile, VoicePreset
from app.schemas_audio import VoicePresetIn, VoicePresetOut, VoicePreviewIn
from app.services.generation import remove_files
from app.services.tts import VOICES, TTSError, synthesize

router = APIRouter(prefix="/api/voice-presets", tags=["voices"])


async def _clear_audio(session: AsyncSession, preset_id: int) -> None:
    paths = (
        await session.scalars(
            select(AudioFile.file_path).where(AudioFile.voice_preset_id == preset_id)
        )
    ).all()
    await session.execute(
        delete(AudioFile).where(AudioFile.voice_preset_id == preset_id)
    )
    remove_files(list(paths))


@router.get("/voices")
async def list_engine_voices() -> dict[str, list[str]]:
    return VOICES


@router.get("", response_model=list[VoicePresetOut])
async def list_presets(session: AsyncSession = Depends(get_session)):
    # Free (kokoro) voices sort before paid (openai) ones, so the Reader defaults to a free voice.
    query = select(VoicePreset).order_by(VoicePreset.engine, VoicePreset.id)
    return (await session.scalars(query)).all()


@router.post("", response_model=VoicePresetOut, status_code=status.HTTP_201_CREATED)
async def create_preset(
    body: VoicePresetIn, session: AsyncSession = Depends(get_session)
):
    preset = VoicePreset(**body.model_dump())
    session.add(preset)
    try:
        await session.commit()
    except IntegrityError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A preset with that name already exists."
        )
    return preset


@router.put("/{preset_id}", response_model=VoicePresetOut)
async def update_preset(
    preset_id: int, body: VoicePresetIn, session: AsyncSession = Depends(get_session)
):
    preset = await session.get(VoicePreset, preset_id)
    if preset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Preset not found.")

    # Existing audio no longer matches the voice, so it is discarded and regenerated on demand.
    old = (preset.engine, preset.base_voice, preset.instructions)
    if old != (body.engine, body.base_voice, body.instructions):
        await _clear_audio(session, preset_id)

    for field, value in body.model_dump().items():
        setattr(preset, field, value)
    try:
        await session.commit()
    except IntegrityError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A preset with that name already exists."
        )
    return preset


@router.delete("/{preset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_preset(preset_id: int, session: AsyncSession = Depends(get_session)):
    preset = await session.get(VoicePreset, preset_id)
    if preset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Preset not found.")
    await _clear_audio(session, preset_id)
    await session.delete(preset)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/preview")
async def preview(body: VoicePreviewIn):
    try:
        audio = await synthesize(
            body.text, body.engine, body.base_voice, body.instructions
        )
    except TTSError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))
    return Response(content=audio, media_type="audio/mpeg")
