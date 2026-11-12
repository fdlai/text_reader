"""Small helpers shared by the API tests."""

import asyncio
from pathlib import Path

from app.config import settings
from app.models import AudioFile, Chunk, VoicePreset
from app.services.chunker import pack, split_paragraphs
from app.services.generation import queued_jobs
from app.services.paragraph_audio import DEFAULT_PAUSE
from app.services.tts import model_name


def long_text(paragraphs: int, tag: str = "") -> str:
    """Text long enough for several chunks (about 230 characters a paragraph)."""
    return "\n".join(
        f"Paragraph {p}{tag}. " + " ".join(f"Sentence {s} of paragraph {p}." for s in range(8))
        for p in range(paragraphs)
    )


def chunk_of_paragraph(text: str, paragraph: int) -> int:
    """Which chunk holds a paragraph of the text."""
    for i, chunk in enumerate(pack(split_paragraphs(text))):
        if chunk.first <= paragraph <= chunk.last:
            return i
    raise ValueError(paragraph)


async def create_text(client, text: str, title: str = "", collection_id=None) -> dict:
    response = await client.post(
        "/api/documents/text",
        json={"title": title, "text": text, "collection_id": collection_id},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def create_collection(client, name: str) -> dict:
    response = await client.post("/api/collections", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


async def add_preset(session, name: str = "Michael") -> VoicePreset:
    preset = VoicePreset(name=name, engine="kokoro", base_voice="am_michael")
    session.add(preset)
    await session.commit()
    return preset


async def add_audio(
    session,
    chunk_id: int,
    preset_id: int,
    duration: float = 10.0,
    engine: str = "kokoro",
    pronunciations: dict | None = None,
) -> Path:
    """An audio row for a chunk, as if made with the current settings, with
    a small file standing in for the MP3."""
    path = Path(settings.audio_dir) / f"{chunk_id}_{preset_id}_test.mp3"
    path.write_bytes(b"fake mp3")
    session.add(
        AudioFile(
            chunk_id=chunk_id,
            voice_preset_id=preset_id,
            model=model_name(engine),
            file_path=str(path),
            duration_sec=duration,
            pronunciations=pronunciations or {},
            paragraph_pause=None if engine == "openai" else DEFAULT_PAUSE,
        )
    )
    await session.commit()
    return path


async def chunk_ids(session, document_id: int) -> list[int]:
    from sqlalchemy import select

    return list(
        await session.scalars(
            select(Chunk.id).where(Chunk.document_id == document_id).order_by(Chunk.index)
        )
    )


async def until(condition, seconds: float = 5.0):
    """Waits for the worker (running in the background) to get somewhere."""
    for _ in range(int(seconds * 100)):
        if condition():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("timed out waiting")


def finished(key) -> bool:
    """True once a (document id, voice id) job has left the queue."""
    return key not in queued_jobs()
