import base64
import binascii
import hashlib
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_session
from app.models import CustomVoice, VoicePreset
from app.schemas_audio import (
    NameIn,
    SpeedIn,
    VoicePresetIn,
    VoicePresetOut,
    VoicePresetSave,
    VoicePreviewIn,
)
from app.services import qwen
from app.services.generation import delete_preset_audio
from app.services.tts import VOICES, TTSError, synthesize

router = APIRouter(prefix="/api/voice-presets", tags=["voices"])

# What every voice says in its preview clip. Qwen voices use the clip they
# were designed with instead.
SAMPLE_TEXT = qwen.DESIGN_TEXT


async def _check_voice(session: AsyncSession, body: VoicePresetIn) -> None:
    if body.engine == "qwen" and await session.get(CustomVoice, int(body.base_voice)) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That saved voice doesn't exist.")


# Each engine's voices as {id, label}. Built-in voices are labelled by their
# id; Qwen's voices are the user's saved voices, labelled by name.
@router.get("/voices")
async def list_engine_voices(
    session: AsyncSession = Depends(get_session),
) -> dict[str, list[dict[str, str]]]:
    saved = (await session.scalars(select(CustomVoice).order_by(CustomVoice.name))).all()
    return {
        **{engine: [{"id": v, "label": v} for v in voices] for engine, voices in VOICES.items()},
        "qwen": [{"id": str(v.id), "label": v.name} for v in saved],
    }


@router.get("", response_model=list[VoicePresetOut])
async def list_presets(session: AsyncSession = Depends(get_session)):
    # Free (kokoro) voices sort before paid (openai) ones, so the Reader defaults to a free voice.
    query = select(VoicePreset).order_by(VoicePreset.engine, VoicePreset.id)
    return (await session.scalars(query)).all()


@router.post("", response_model=VoicePresetOut, status_code=status.HTTP_201_CREATED)
async def create_preset(
    body: VoicePresetSave, session: AsyncSession = Depends(get_session)
):
    await _check_voice(session, body)
    sample = _decode_sample(body.sample_b64)
    preset = VoicePreset(**body.model_dump(exclude={"sample_b64"}))
    session.add(preset)
    try:
        await session.commit()
    except IntegrityError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A voice with that name already exists."
        )
    if sample:
        _save_sample(preset, sample)
    return preset


@router.put("/{preset_id}", response_model=VoicePresetOut)
async def update_preset(
    preset_id: int, body: VoicePresetSave, session: AsyncSession = Depends(get_session)
):
    preset = await session.get(VoicePreset, preset_id)
    if preset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Preset not found.")
    await _check_voice(session, body)
    sample = _decode_sample(body.sample_b64)

    # Existing audio no longer matches the voice, so it is discarded and regenerated on demand.
    old = (preset.engine, preset.base_voice, preset.instructions)
    changed = old != (body.engine, body.base_voice, body.instructions)
    if changed:
        await delete_preset_audio(session, preset_id)

    for field, value in body.model_dump(exclude={"sample_b64"}).items():
        setattr(preset, field, value)
    try:
        await session.commit()
    except IntegrityError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A voice with that name already exists."
        )
    if changed:
        _remove_samples(preset_id)
    if sample:
        _save_sample(preset, sample)
    return preset


# A Qwen voice's name is also stored on its saved voice (the one shown while
# designing), so both are renamed together.
@router.patch("/{preset_id}/name", response_model=VoicePresetOut)
async def rename_preset(
    preset_id: int, body: NameIn, session: AsyncSession = Depends(get_session)
):
    preset = await session.get(VoicePreset, preset_id)
    if preset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Preset not found.")
    preset.name = body.name
    if preset.engine == "qwen":
        custom = await session.get(CustomVoice, int(preset.base_voice))
        if custom is not None:
            custom.name = body.name
    try:
        await session.commit()
    except IntegrityError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A voice with that name already exists."
        )
    return preset


# Speed only affects playback, not the audio, so changing it keeps the
# generated audio (unlike changing the voice or instructions).
@router.patch("/{preset_id}/speed", response_model=VoicePresetOut)
async def update_speed(
    preset_id: int, body: SpeedIn, session: AsyncSession = Depends(get_session)
):
    preset = await session.get(VoicePreset, preset_id)
    if preset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Preset not found.")
    preset.speed = body.speed
    await session.commit()
    return preset


@router.delete("/{preset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_preset(preset_id: int, session: AsyncSession = Depends(get_session)):
    preset = await session.get(VoicePreset, preset_id)
    if preset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Preset not found.")
    await delete_preset_audio(session, preset_id)
    await session.delete(preset)
    await session.commit()
    _remove_samples(preset_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# A short clip of the voice, for the ▶ buttons in the voice picker. Made the
# first time it's asked for and then kept, so later previews are instant and
# an OpenAI voice is only paid for once.
@router.get("/{preset_id}/sample")
async def voice_sample(preset_id: int, session: AsyncSession = Depends(get_session)):
    preset = await session.get(VoicePreset, preset_id)
    if preset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Preset not found.")
    if preset.engine == "qwen":
        path = qwen.voice_path(int(preset.base_voice))
        if not path.exists():
            raise HTTPException(status.HTTP_404_NOT_FOUND, "This voice's sample is missing.")
        return FileResponse(path, media_type="audio/wav")

    path = _sample_path(preset)
    if not path.exists():
        try:
            audio = await synthesize(
                SAMPLE_TEXT, preset.engine, preset.base_voice, preset.instructions
            )
        except TTSError as e:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))
        # Clips made with this voice's earlier settings no longer match it.
        _save_sample(preset, audio)
    return FileResponse(path, media_type="audio/mpeg")


# The file name includes a fingerprint of the voice's settings, so editing
# the voice (e.g. its instructions) makes a new clip instead of reusing one
# that sounds different.
def _sample_path(preset: VoicePreset) -> Path:
    settings_key = f"{preset.engine}|{preset.base_voice}|{preset.instructions}|{SAMPLE_TEXT}"
    fingerprint = hashlib.sha256(settings_key.encode()).hexdigest()[:12]
    return Path(settings.samples_dir) / f"{preset.id}-{fingerprint}.mp3"


def _decode_sample(sample_b64: str | None) -> bytes | None:
    if sample_b64 is None:
        return None
    try:
        return base64.b64decode(sample_b64, validate=True)
    except binascii.Error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The sample isn't valid base64.")


def _save_sample(preset: VoicePreset, audio: bytes) -> None:
    _remove_samples(preset.id)
    path = _sample_path(preset)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(audio)


def _remove_samples(preset_id: int) -> None:
    for old in Path(settings.samples_dir).glob(f"{preset_id}-*.mp3"):
        old.unlink(missing_ok=True)


@router.post("/preview")
async def preview(body: VoicePreviewIn):
    try:
        audio = await synthesize(
            body.text or SAMPLE_TEXT, body.engine, body.base_voice, body.instructions
        )
    except TTSError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))
    return Response(content=audio, media_type="audio/mpeg")
