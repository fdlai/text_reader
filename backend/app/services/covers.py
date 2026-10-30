"""Cover images for the Library, downloaded once from each article's page.

They're saved here rather than loaded from the other site each time, since
sites can block that, move their images, or go offline.
"""

import asyncio
import logging
from pathlib import Path

from app.config import settings
from app.services.fetcher import FetchError, fetch_image

logger = logging.getLogger(__name__)


def cover_path(document_id: int) -> Path:
    return Path(settings.covers_dir) / str(document_id)


async def save_cover(document_id: int, image_url: str | None) -> str | None:
    """Download and save a document's cover. Returns its type, or None if
    there's no image or it couldn't be downloaded (a cover is optional, so
    this never fails the caller)."""
    if not image_url:
        return None
    try:
        data, content_type = await fetch_image(image_url)
    except FetchError as e:
        logger.warning("No cover for document %d (%s): %s", document_id, image_url, e)
        return None
    path = cover_path(document_id)
    await asyncio.to_thread(_write, path, data)
    return content_type


def _write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
