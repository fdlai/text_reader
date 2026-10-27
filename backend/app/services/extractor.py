import asyncio

import trafilatura


class ExtractionError(Exception):
    pass


def _extract(html: str, url: str) -> tuple[str, str]:
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
    return title[:500], text.strip()


async def extract_article(html: str, url: str) -> tuple[str, str]:
    return await asyncio.to_thread(_extract, html, url)
