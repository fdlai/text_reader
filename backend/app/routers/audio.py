from pathlib import Path
from typing import NamedTuple

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_session
from app.models import AudioFile, Chunk, Document, VoicePreset
from app.schemas_audio import (
    ChunkAudioStatus,
    GenerateIn,
    GenerationQueue,
    GenerationStatus,
    MoveIn,
    QueueItem,
    VoiceAudio,
)
from app.services import qwen
from app.services.generation import (
    audio_counts,
    cancel_generation,
    is_paused,
    jobs,
    notice,
    move_job,
    pause_generation,
    queue_position,
    queued_jobs,
    remove_files,
    resume_generation,
    start_generation,
)
from app.services.preferences import load_preferences
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


class _Settings(NamedTuple):
    """What generated audio depends on besides the voice, as it is now."""

    lexicon: Lexicon
    pause: float  # seconds after each paragraph, for Kokoro and Qwen


async def _current_settings(session: AsyncSession) -> _Settings:
    prefs = await load_preferences(session)
    return _Settings(await load_lexicon(session), prefs.paragraph_pause)


def _is_outdated(
    now: _Settings, preset: VoicePreset, chunk: Chunk, audio: AudioFile
) -> bool:
    """True if the chunk would now be spoken with different pronunciations,
    or with a different pause after its paragraphs."""
    _, used_now = now.lexicon.apply(chunk.text)
    if used_now != (audio.pronunciations or {}):
        return True
    return preset.engine != "openai" and audio.paragraph_pause != now.pause


async def _build_status(
    session: AsyncSession, document_id: int, preset: VoicePreset
) -> GenerationStatus:
    chunks, audio = await _chunks_with_audio(session, document_id, preset)
    now = await _current_settings(session)
    job = jobs.get((document_id, preset.id), {})
    return GenerationStatus(
        generating=job.get("running", False),
        queue_position=queue_position(document_id, preset.id),
        error=job.get("error"),
        notice=notice(document_id, preset.id),
        chunks=[
            ChunkAudioStatus(
                chunk_id=c.id,
                index=c.index,
                ready=c.id in audio,
                audio_id=audio[c.id].id if c.id in audio else None,
                duration_sec=audio[c.id].duration_sec if c.id in audio else None,
                word_times=audio[c.id].word_times if c.id in audio else None,
                outdated=c.id in audio and _is_outdated(now, preset, c, audio[c.id]),
            )
            for c in chunks
        ],
    )


async def _queue_status(session: AsyncSession) -> GenerationQueue:
    keys = queued_jobs()
    doc_ids = {d for d, _ in keys}
    preset_ids = {p for _, p in keys}
    documents = {
        d.id: d
        for d in await session.scalars(select(Document).where(Document.id.in_(doc_ids)))
    }
    presets = {
        p.id: p
        for p in await session.scalars(
            select(VoicePreset).where(VoicePreset.id.in_(preset_ids))
        )
    }
    totals = dict(
        (
            await session.execute(
                select(Chunk.document_id, func.count())
                .where(Chunk.document_id.in_(doc_ids))
                .group_by(Chunk.document_id)
            )
        ).all()
    )
    # Audio counts by (document, preset, model); only the preset's current
    # model counts, as elsewhere.
    ready = {
        (d, p, m): n
        for d, p, m, n in await session.execute(
            select(Chunk.document_id, AudioFile.voice_preset_id, AudioFile.model, func.count())
            .join(Chunk, Chunk.id == AudioFile.chunk_id)
            .where(
                Chunk.document_id.in_(doc_ids),
                AudioFile.voice_preset_id.in_(preset_ids),
            )
            .group_by(Chunk.document_id, AudioFile.voice_preset_id, AudioFile.model)
        )
    }
    items = []
    for d, p in keys:
        document, preset = documents.get(d), presets.get(p)
        if document is None or preset is None:
            continue  # being deleted right now
        items.append(
            QueueItem(
                document_id=d,
                voice_preset_id=p,
                title=document.title,
                has_cover=document.cover_type is not None,
                voice_name=preset.name,
                engine=preset.engine,
                ready=ready.get((d, p, model_name(preset.engine)), 0),
                total=totals.get(d, 0),
            )
        )
    return GenerationQueue(
        paused=is_paused(), items=items, qwen_running=qwen.is_running()
    )


@router.get("/generation", response_model=GenerationQueue)
async def generation_queue(session: AsyncSession = Depends(get_session)):
    return await _queue_status(session)


@router.post("/generation/pause", response_model=GenerationQueue)
async def pause(session: AsyncSession = Depends(get_session)):
    """Pauses all generation (every queued document), and stops Qwen to free
    the GPU. The audio already made is kept."""
    await pause_generation()
    return await _queue_status(session)


@router.post("/generation/resume", response_model=GenerationQueue)
async def resume(session: AsyncSession = Depends(get_session)):
    resume_generation()
    return await _queue_status(session)


@router.post("/generation/move", response_model=GenerationQueue)
async def move(body: MoveIn, session: AsyncSession = Depends(get_session)):
    """Moves a queued document to the top, or up or down one place."""
    move_job(body.document_id, body.voice_preset_id, body.to)
    return await _queue_status(session)


@router.post("/documents/{document_id}/generate", response_model=GenerationStatus)
async def generate(
    document_id: int, body: GenerateIn, session: AsyncSession = Depends(get_session)
):
    document = await session.get(Document, document_id)
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found.")
    preset = await _get_preset(session, body.voice_preset_id)
    if preset.engine == "openai" and not settings.openai_api_key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "OPENAI_API_KEY is not set.")

    document.voice_preset_id = preset.id  # it opens with this voice next time
    await session.commit()
    start_generation(document_id, preset.id, front=body.front)
    return await _build_status(session, document_id, preset)


@router.post(
    "/documents/{document_id}/regenerate-outdated", response_model=GenerationStatus
)
async def regenerate_outdated(
    document_id: int, body: GenerateIn, session: AsyncSession = Depends(get_session)
):
    """Deletes audio made with old pronunciations or paragraph pauses, then
    generates it again."""
    document = await session.get(Document, document_id)
    if document is None:
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
    now = await _current_settings(session)
    outdated = [
        audio[c.id]
        for c in chunks
        if c.id in audio and _is_outdated(now, preset, c, audio[c.id])
    ]
    for a in outdated:
        await session.delete(a)
    document.voice_preset_id = preset.id  # it opens with this voice next time
    await session.commit()
    remove_files([a.file_path for a in outdated])

    start_generation(document_id, preset.id)
    return await _build_status(session, document_id, preset)


@router.delete("/documents/{document_id}/audio", status_code=status.HTTP_204_NO_CONTENT)
async def delete_audio(
    document_id: int, voice_preset_id: int, session: AsyncSession = Depends(get_session)
):
    """Cancels generation of a document with a voice and deletes the audio
    already made with it. Other voices' audio and the document are kept."""
    document = await session.get(Document, document_id)
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found.")
    preset = await _get_preset(session, voice_preset_id)
    await cancel_generation(document_id=document_id, preset_id=preset.id)
    audio = (
        await session.scalars(
            select(AudioFile)
            .join(Chunk, Chunk.id == AudioFile.chunk_id)
            .where(Chunk.document_id == document_id, AudioFile.voice_preset_id == preset.id)
        )
    ).all()
    for a in audio:
        await session.delete(a)
    # With its audio gone, the document opens with another voice that has
    # audio for it, if any (see the document's detail).
    if document.voice_preset_id == preset.id:
        document.voice_preset_id = None
    await session.commit()
    remove_files([a.file_path for a in audio])
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/documents/{document_id}/audio-status", response_model=GenerationStatus)
async def audio_status(
    document_id: int, voice_preset_id: int, session: AsyncSession = Depends(get_session)
):
    if await session.get(Document, document_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found.")
    preset = await _get_preset(session, voice_preset_id)
    return await _build_status(session, document_id, preset)


@router.get("/documents/{document_id}/voice-audio", response_model=list[VoiceAudio])
async def voice_audio(document_id: int, session: AsyncSession = Depends(get_session)):
    """The voices that have audio for a document (or are generating it), so
    the Reader's voice menu can point them out."""
    if await session.get(Document, document_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found.")
    ready = await audio_counts(session, document_id)
    generating = {
        p for d, p in queued_jobs() if d == document_id and jobs.get((d, p), {}).get("running")
    }
    return [
        VoiceAudio(voice_preset_id=p, ready=ready.get(p, 0), generating=p in generating)
        for p in ready.keys() | generating
    ]


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
