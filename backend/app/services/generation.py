"""Audio generation, one chunk at a time from a single queue.

Running every requested document at once would only split the GPU/CPU
between them, so each would generate slower than it plays. Instead, jobs
wait in a queue and one worker generates a single chunk of the job at the
front, then looks at the front again. Moving a job to the front (e.g. when
its document starts playing) therefore takes effect after at most one chunk.
"""

import asyncio
import logging
import time
from pathlib import Path

from mutagen.mp3 import MP3
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import SessionLocal
from app.models import AudioFile, Chunk, VoicePreset
from app.services import qwen
from app.services.alignment import word_start_times
from app.services.pronunciation import load_lexicon
from app.services.tts import TTSError, model_name, synthesize

logger = logging.getLogger(__name__)

Key = tuple[int, int]  # (document_id, voice_preset_id)

# Every job that was requested, including finished ones, so the status can
# show an error: key -> {"running": bool, "error": str | None, "notice": ...}.
# "running" means queued or being worked on. "notice" is a message about
# something going wrong and being fixed: (text, time it disappears or None
# to stay until replaced), or None.
jobs: dict[Key, dict] = {}
_queue: list[Key] = []  # unfinished jobs, next first
_wakeup = asyncio.Event()
_worker: asyncio.Task | None = None
# The job being worked on and the task generating its current chunk.
_current: tuple[Key, asyncio.Task] | None = None


def remove_files(paths: list[str]) -> None:
    for p in paths:
        Path(p).unlink(missing_ok=True)


def _write_audio(path: Path, data: bytes) -> float:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return MP3(path).info.length


async def word_times_for(path: Path, text: str, duration: float) -> list[float] | None:
    # Word timings only improve highlighting, so a failure here shouldn't
    # lose the audio; the player falls back to estimating instead.
    try:
        return await asyncio.to_thread(word_start_times, str(path), text, duration)
    except Exception:
        logger.exception("Could not work out word timings for %s", path)
        return None


async def _next_chunk(document_id: int, preset_id: int) -> bool:
    """Generate the document's first chunk without audio for this preset.

    Returns False if every chunk already has audio. The database is only
    used before and after generating, not held open during it.
    """
    async with SessionLocal() as session:
        preset = await session.get(VoicePreset, preset_id)
        if preset is None:
            raise TTSError("Voice preset not found.")
        model = model_name(preset.engine)
        has_audio = select(AudioFile.chunk_id).where(
            AudioFile.voice_preset_id == preset_id, AudioFile.model == model
        )
        chunk = await session.scalar(
            select(Chunk)
            .where(Chunk.document_id == document_id, Chunk.id.not_in(has_audio))
            .order_by(Chunk.index)
            .limit(1)
        )
        if chunk is None:
            return False
        # The voice reads the text with pronunciation entries swapped in;
        # word timings are still matched against the real text.
        spoken_text, used = (await load_lexicon(session)).apply(chunk.text)

    def notify(message: str, done: bool) -> None:
        if job := jobs.get((document_id, preset_id)):
            # A "fixed" message only stays up for a little while.
            job["notice"] = (message, time.monotonic() + qwen.NOTICE_SECONDS if done else None)

    data = await synthesize(
        spoken_text, preset.engine, preset.base_voice, preset.instructions, notify
    )
    path = Path(settings.audio_dir) / f"{chunk.id}_{preset_id}_{model}.mp3"
    try:
        duration = await asyncio.to_thread(_write_audio, path, data)
        word_times = await word_times_for(path, chunk.text, duration)
        async with SessionLocal() as session:
            session.add(
                AudioFile(
                    chunk_id=chunk.id,
                    voice_preset_id=preset_id,
                    model=model,
                    file_path=str(path),
                    duration_sec=duration,
                    word_times=word_times,
                    pronunciations=used,
                )
            )
            await session.commit()
    except BaseException:
        # Not saved (e.g. cancelled), so don't leave the file behind.
        path.unlink(missing_ok=True)
        raise
    return True


def _finish(key: Key, error: str | None = None) -> None:
    if key in _queue:
        _queue.remove(key)
    if key in jobs:
        jobs[key] = {"running": False, "error": error}


async def _work() -> None:
    global _current
    while True:
        await _wakeup.wait()
        _wakeup.clear()
        while _queue:
            key = _queue[0]
            task = asyncio.create_task(_next_chunk(*key))
            _current = (key, task)
            try:
                more = await task
            except asyncio.CancelledError:
                if asyncio.current_task().cancelling():
                    raise  # the worker itself is being stopped
                continue  # only this job was cancelled; it's already removed
            except Exception as e:
                if not isinstance(e, TTSError):
                    logger.exception("Audio generation failed for %s", key)
                _finish(key, str(e) if isinstance(e, TTSError) else "Audio generation failed.")
                continue
            finally:
                _current = None
            if not more:
                _finish(key)


def notice(document_id: int, preset_id: int) -> str | None:
    """The job's current notice text, if it hasn't expired."""
    value = jobs.get((document_id, preset_id), {}).get("notice")
    if value is None:
        return None
    text, expires = value
    return text if expires is None or time.monotonic() < expires else None


def queue_position(document_id: int, preset_id: int) -> int | None:
    """How many jobs are ahead of this one (0 = next or in progress)."""
    key = (document_id, preset_id)
    return _queue.index(key) if key in _queue else None


def start_generation(document_id: int, preset_id: int, front: bool = False) -> None:
    """Queue a job, or with front=True, queue it or move it to the front."""
    global _worker
    key = (document_id, preset_id)
    if key in _queue:
        if not front:
            return
        _queue.remove(key)
    else:
        jobs[key] = {"running": True, "error": None}
    if front:
        _queue.insert(0, key)
    else:
        _queue.append(key)
    if _worker is None or _worker.done():
        _worker = asyncio.create_task(_work())
    _wakeup.set()


async def cancel_generation(
    document_id: int | None = None, preset_id: int | None = None
) -> None:
    """Remove jobs for a document or preset that's about to be deleted or changed.

    Waits for a chunk in progress to stop, so it can't save audio for rows
    being deleted.
    """

    def matches(key: Key) -> bool:
        return (document_id is None or key[0] == document_id) and (
            preset_id is None or key[1] == preset_id
        )

    for key in [k for k in _queue if matches(k)]:
        _queue.remove(key)
    for key in [k for k in jobs if matches(k)]:
        del jobs[key]
    if _current and matches(_current[0]):
        task = _current[1]
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


async def shutdown() -> None:
    if _worker:
        _worker.cancel()
        await asyncio.gather(_worker, return_exceptions=True)


async def delete_preset_audio(session: AsyncSession, preset_id: int) -> None:
    """Delete a preset's audio rows and files (the caller commits)."""
    await cancel_generation(preset_id=preset_id)
    paths = (
        await session.scalars(
            select(AudioFile.file_path).where(AudioFile.voice_preset_id == preset_id)
        )
    ).all()
    await session.execute(delete(AudioFile).where(AudioFile.voice_preset_id == preset_id))
    remove_files(list(paths))
