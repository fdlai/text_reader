import asyncio
from dataclasses import dataclass
from urllib.parse import urljoin

import trafilatura


class ExtractionError(Exception):
    pass


@dataclass
class Article:
    title: str
    text: str
    # The page's preview image (from its og:image tag), as a full URL.
    image_url: str | None


def _extract(html: str, url: str) -> Article:
    text = trafilatura.extract(
        html,
        url=url,
        include_comments=False,
        include_tables=False,
        favor_precision=True,
    )
    if not text or not text.strip():
        raise ExtractionError("No readable article text was found on that page.")

    metadata = trafilatura.extract_metadata(html, default_url=url)
    title = (metadata.title if metadata and metadata.title else "").strip() or url
    # Pages describe themselves for link previews (the card shown when a link
    # is pasted into a chat) with hidden tags like
    # <meta property="og:image" content="/covers/book.jpg">, which trafilatura
    # reads. The address may be relative to the page, so make it complete.
    image = metadata.image if metadata and metadata.image else None
    return Article(title[:500], text.strip(), urljoin(url, image) if image else None)


async def extract_article(html: str, url: str) -> Article:
    return await asyncio.to_thread(_extract, html, url)
