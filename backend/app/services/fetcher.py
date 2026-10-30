import asyncio
import ipaddress
import socket
from collections.abc import Callable
from urllib.parse import urljoin, urlparse

import httpx

MAX_BYTES = 5 * 1024 * 1024
MAX_REDIRECTS = 5
TIMEOUT = httpx.Timeout(10.0)
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


class FetchError(Exception):
    pass


async def _assert_public_host(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise FetchError("Only http and https URLs are allowed.")

    try:
        infos = await asyncio.get_running_loop().getaddrinfo(
            parsed.hostname,
            parsed.port or (443 if parsed.scheme == "https" else 80),
            type=socket.SOCK_STREAM,
        )
    except socket.gaierror:
        raise FetchError("Could not resolve the host.")

    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            raise FetchError(
                "URLs pointing to private or local addresses are not allowed."
            )


# Image types browsers can show. SVG is left out on purpose: it can contain
# scripts, which would run if the image were opened from our own server.
IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"}


async def fetch_html(url: str) -> str:
    body, _, encoding = await _fetch(
        url,
        lambda t: "html" in t or "xml" in t,
        "The URL does not point to an HTML page.",
    )
    return body.decode(encoding or "utf-8", errors="replace")


async def fetch_image(url: str) -> tuple[bytes, str]:
    """Download an image. Returns its bytes and type (e.g. "image/jpeg")."""
    body, content_type, _ = await _fetch(
        url, lambda t: t in IMAGE_TYPES, "The URL does not point to an image."
    )
    return body, content_type


async def _fetch(
    url: str, accept: Callable[[str], bool], wrong_type: str
) -> tuple[bytes, str, str | None]:
    """Download a URL, refusing private addresses (also after redirects),
    responses over MAX_BYTES, and content types accept() says no to.

    Returns the body, its content type and its text encoding, if any.
    """
    async with httpx.AsyncClient(
        timeout=TIMEOUT, headers=HEADERS, follow_redirects=False
    ) as client:
        for _ in range(MAX_REDIRECTS + 1):
            await _assert_public_host(url)
            try:
                async with client.stream("GET", url) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            raise FetchError("Redirect without a location.")
                        url = urljoin(url, location)
                        continue

                    if response.status_code >= 400:
                        raise FetchError(
                            f"The site responded with status {response.status_code}."
                        )

                    # e.g. "text/html; charset=utf-8" -> "text/html"
                    content_type = (
                        response.headers.get("content-type", "")
                        .split(";")[0]
                        .strip()
                        .lower()
                    )
                    if not accept(content_type):
                        raise FetchError(wrong_type)

                    body = bytearray()
                    async for part in response.aiter_bytes():
                        body.extend(part)
                        if len(body) > MAX_BYTES:
                            raise FetchError("The page is too large.")
                    return bytes(body), content_type, response.encoding
            except httpx.HTTPError:
                raise FetchError("Could not fetch the page.")

    raise FetchError("Too many redirects.")
