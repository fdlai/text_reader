"""Finds the next-part link of documents added before next parts existed.

Run from the backend folder:  ./.venv/Scripts/python -m app.backfill_next_urls
Downloads each document's page again just to find the link; the saved text
isn't changed.
"""

import asyncio

from sqlalchemy import select

from app.database import SessionLocal
from app.models import Document
from app.services.fetcher import FetchError, fetch_html
from app.services.next_link import find_next_url


async def main() -> None:
    async with SessionLocal() as session:
        documents = (
            await session.scalars(select(Document).where(Document.next_url.is_(None)))
        ).all()
        print(f"{len(documents)} documents have no next part.")
        for i, document in enumerate(documents, start=1):
            try:
                html = await fetch_html(document.source_url)
            except FetchError as e:
                print(f"[{i}/{len(documents)}] page unavailable ({e}): {document.title}")
                continue
            document.next_url = find_next_url(html, document.source_url)
            await session.commit()
            result = document.next_url or "no next part found"
            print(f"[{i}/{len(documents)}] {document.title}: {result}")


if __name__ == "__main__":
    asyncio.run(main())
