"""Adds word timings to audio generated before they existed.

Run from the backend folder:  ./.venv/Scripts/python -m app.backfill_word_times
Only listens to the saved audio files, so it never calls OpenAI.
"""

import asyncio
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import SessionLocal
from app.models import AudioFile
from app.services.generation import word_times_for


async def main() -> None:
    async with SessionLocal() as session:
        rows = (
            await session.scalars(
                select(AudioFile)
                .where(AudioFile.word_times.is_(None))
                .options(selectinload(AudioFile.chunk))
            )
        ).all()
        print(f"{len(rows)} audio files need word timings.")
        for i, audio in enumerate(rows, start=1):
            if not Path(audio.file_path).is_file():
                print(f"[{i}/{len(rows)}] missing file, skipped: {audio.file_path}")
                continue
            audio.word_times = await word_times_for(
                Path(audio.file_path), audio.chunk.text, audio.duration_sec or 0
            )
            await session.commit()
            print(f"[{i}/{len(rows)}] {audio.file_path}")


if __name__ == "__main__":
    asyncio.run(main())
