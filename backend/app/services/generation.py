import asyncio
import logging
from pathlib import Path

from mutagen.mp3 import MP3
from sqlalchemy import select

from app.config import settings
from app.database import SessionLocal
from app.models import AudioFile, Chunk, VoicePreset
from app.services.alignment import word_start_times
from app.services.pronunciation import load_lexicon
from app.services.tts import TTSError, model_name, synthesize

logger = logging.getLogger(__name__)

# (document_id, voice_preset_id) -> {"running": bool, "error": str | None}
jobs: dict[tuple[int, int], dict] = {}
_tasks: set[asyncio.Task] = set()


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


async def _run(document_id: int, preset_id: int) -> None:
    job = jobs[(document_id, preset_id)]
    try:
        async with SessionLocal() as session:
            preset = await session.get(VoicePreset, preset_id)
            if preset is None:
                raise TTSError("Voice preset not found.")
            model = model_name(preset.engine)
            lexicon = await load_lexicon(session)

            chunks = (
                await session.scalars(
                    select(Chunk)
                    .where(Chunk.document_id == document_id)
                    .order_by(Chunk.index)
                )
            ).all()
            done = set(
                await session.scalars(
                    select(AudioFile.chunk_id).where(
                        AudioFile.voice_preset_id == preset_id,
                        AudioFile.model == model,
                        AudioFile.chunk_id.in_([c.id for c in chunks]),
                    )
                )
            )

            for chunk in chunks:
                if chunk.id in done:
                    continue
                # The voice reads the text with pronunciation entries swapped
                # in; word timings are still matched against the real text.
                spoken_text, used = lexicon.apply(chunk.text)
                data = await synthesize(
                    spoken_text, preset.engine, preset.base_voice, preset.instructions
                )
                path = Path(settings.audio_dir) / f"{chunk.id}_{preset_id}_{model}.mp3"
                duration = await asyncio.to_thread(_write_audio, path, data)
                session.add(
                    AudioFile(
                        chunk_id=chunk.id,
                        voice_preset_id=preset_id,
                        model=model,
                        file_path=str(path),
                        duration_sec=duration,
                        word_times=await word_times_for(path, chunk.text, duration),
                        pronunciations=used,
                    )
                )
                await session.commit()
    except Exception as e:
        job["error"] = str(e) if isinstance(e, TTSError) else "Audio generation failed."
    finally:
        job["running"] = False


def start_generation(document_id: int, preset_id: int) -> None:
    key = (document_id, preset_id)
    if jobs.get(key, {}).get("running"):
        return
    jobs[key] = {"running": True, "error": None}
    task = asyncio.create_task(_run(document_id, preset_id))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
