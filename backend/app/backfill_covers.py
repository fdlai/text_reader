"""Adds cover images to documents added before covers existed.

Run from the backend folder:  ./.venv/Scripts/python -m app.backfill_covers
Downloads each document's page again just to find its preview image; the
saved text isn't changed.
"""

import asyncio

from sqlalchemy import select

from app.database import SessionLocal
from app.models import Document
from app.services.covers import save_cover
from app.services.extractor import ExtractionError, extract_article
from app.services.fetcher import FetchError, fetch_html


async def main() -> None:
    async with SessionLocal() as session:
        documents = (
            await session.scalars(select(Document).where(Document.cover_type.is_(None)))
        ).all()
        print(f"{len(documents)} documents have no cover.")
        for i, document in enumerate(documents, start=1):
            try:
                html = await fetch_html(document.source_url)
                article = await extract_article(html, document.source_url)
            except (FetchError, ExtractionError) as e:
                print(f"[{i}/{len(documents)}] page unavailable ({e}): {document.title}")
                continue
            document.cover_type = await save_cover(document.id, article.image_url)
            await session.commit()
            result = "cover saved" if document.cover_type else "no image found"
            print(f"[{i}/{len(documents)}] {result}: {document.title}")


if __name__ == "__main__":
    asyncio.run(main())
