from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_session
from app.models import AudioFile, Chunk, Document, VoicePreset
from app.schemas_audio import ChunkAudioStatus, GenerateIn, GenerationStatus
from app.services.generation import jobs, remove_files, start_generation
from app.services.pronunciation import Lexicon, load_lexicon
from app.services.tts import model_name

router = APIRouter(prefix="/api", tags=["audio"])


async def _get_preset(session: AsyncSession, preset_id: int) -> VoicePreset:
    preset = await session.get(VoicePreset, preset_id)
    if preset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Voice preset not found.")
    return preset


async def _chunks_with_audio(
    session: AsyncSession, document_id: int, preset: VoicePreset
) -> tuple[list[Chunk], dict[int, AudioFile]]:
    """The document's chunks, and their audio for this preset by chunk id."""
    chunks = (
        await session.scalars(
            select(Chunk).where(Chunk.document_id == document_id).order_by(Chunk.index)
        )
    ).all()
    audio = {
        a.chunk_id: a
        for a in await session.scalars(
            select(AudioFile).where(
                AudioFile.voice_preset_id == preset.id,
                AudioFile.model == model_name(preset.engine),
                AudioFile.chunk_id.in_([c.id for c in chunks]),
            )
        )
    }
    return list(chunks), audio


def _is_outdated(lexicon: Lexicon, chunk: Chunk, audio: AudioFile) -> bool:
    """True if the chunk would now be spoken with different pronunciations."""
    _, used_now = lexicon.apply(chunk.text)
    return used_now != (audio.pronunciations or {})


async def _build_status(
    session: AsyncSession, document_id: int, preset: VoicePreset
) -> GenerationStatus:
    chunks, audio = await _chunks_with_audio(session, document_id, preset)
    lexicon = await load_lexicon(session)
    job = jobs.get((document_id, preset.id), {})
    return GenerationStatus(
        generating=job.get("running", False),
        error=job.get("error"),
        chunks=[
            ChunkAudioStatus(
                chunk_id=c.id,
                index=c.index,
                ready=c.id in audio,
                audio_id=audio[c.id].id if c.id in audio else None,
                duration_sec=audio[c.id].duration_sec if c.id in audio else None,
                word_times=audio[c.id].word_times if c.id in audio else None,
                outdated=c.id in audio and _is_outdated(lexicon, c, audio[c.id]),
            )
            for c in chunks
        ],
    )


@router.post("/documents/{document_id}/generate", response_model=GenerationStatus)
async def generate(
    document_id: int, body: GenerateIn, session: AsyncSession = Depends(get_session)
):
    if await session.get(Document, document_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found.")
    preset = await _get_preset(session, body.voice_preset_id)
    if preset.engine == "openai" and not settings.openai_api_key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "OPENAI_API_KEY is not set.")

    start_generation(document_id, preset.id)
    return await _build_status(session, document_id, preset)


@router.post(
    "/documents/{document_id}/regenerate-outdated", response_model=GenerationStatus
)
async def regenerate_outdated(
    document_id: int, body: GenerateIn, session: AsyncSession = Depends(get_session)
):
    """Deletes audio made with old pronunciations, then generates it again."""
    if await session.get(Document, document_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found.")
    preset = await _get_preset(session, body.voice_preset_id)
    if preset.engine == "openai" and not settings.openai_api_key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "OPENAI_API_KEY is not set.")
    # A running job decided which chunks to skip when it started, so audio
    # deleted now could be missed.
    if jobs.get((document_id, preset.id), {}).get("running"):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Wait for the current generation to finish."
        )

    chunks, audio = await _chunks_with_audio(session, document_id, preset)
    lexicon = await load_lexicon(session)
    outdated = [
        audio[c.id]
        for c in chunks
        if c.id in audio and _is_outdated(lexicon, c, audio[c.id])
    ]
    for a in outdated:
        await session.delete(a)
    await session.commit()
    remove_files([a.file_path for a in outdated])

    start_generation(document_id, preset.id)
    return await _build_status(session, document_id, preset)


@router.get("/documents/{document_id}/audio-status", response_model=GenerationStatus)
async def audio_status(
    document_id: int, voice_preset_id: int, session: AsyncSession = Depends(get_session)
):
    if await session.get(Document, document_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found.")
    preset = await _get_preset(session, voice_preset_id)
    return await _build_status(session, document_id, preset)


@router.get("/chunks/{chunk_id}/audio")
async def chunk_audio(
    chunk_id: int, voice_preset_id: int, session: AsyncSession = Depends(get_session)
):
    preset = await _get_preset(session, voice_preset_id)
    audio = await session.scalar(
        select(AudioFile).where(
            AudioFile.chunk_id == chunk_id,
            AudioFile.voice_preset_id == preset.id,
            AudioFile.model == model_name(preset.engine),
        )
    )
    if audio is None or not Path(audio.file_path).is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Audio not generated yet.")
    return FileResponse(audio.file_path, media_type="audio/mpeg")
