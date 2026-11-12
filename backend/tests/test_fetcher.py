"""Downloading pages and images safely. No real network is used: the HTTP
client is given a fake transport that answers each request, and addresses
are written as IP numbers, so checking them needs no DNS lookup."""

import httpx
import pytest

from app.services import fetcher
from app.services.fetcher import FetchError, fetch_html, fetch_image

PUBLIC = "http://93.184.215.14"  # a public address (example.com's)


@pytest.fixture
def respond(monkeypatch):
    """Makes the fetcher's HTTP client answer with handler(request)."""

    def use(handler):
        real_client = httpx.AsyncClient

        def fake_client(**kwargs):
            return real_client(transport=httpx.MockTransport(handler), **kwargs)

        monkeypatch.setattr(fetcher.httpx, "AsyncClient", fake_client)

    return use


def html_page(text: str = "<p>Hello</p>", **headers) -> httpx.Response:
    return httpx.Response(
        200, headers={"content-type": "text/html; charset=utf-8", **headers}, text=text
    )


async def test_a_page_is_downloaded_and_decoded(respond):
    respond(lambda request: html_page("<p>Café</p>"))
    assert await fetch_html(f"{PUBLIC}/page") == "<p>Café</p>"


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/",
        "http://10.0.0.5/",
        "http://192.168.1.1/admin",
        "http://169.254.169.254/latest/meta-data",  # cloud metadata
        "http://[::1]/",
        "http://localhost/",
    ],
)
async def test_private_and_local_addresses_are_refused(respond, url):
    respond(lambda request: pytest.fail("should never be requested"))
    with pytest.raises(FetchError, match="private or local"):
        await fetch_html(url)


async def test_only_http_and_https_are_allowed():
    with pytest.raises(FetchError, match="Only http and https"):
        await fetch_html("file:///etc/passwd")


async def test_a_redirect_to_a_private_address_is_refused(respond):
    def handler(request):
        if request.url.host == "93.184.215.14":
            return httpx.Response(302, headers={"location": "http://127.0.0.1/secret"})
        pytest.fail("the private address should never be requested")

    respond(handler)
    with pytest.raises(FetchError, match="private or local"):
        await fetch_html(f"{PUBLIC}/start")


async def test_redirects_are_followed(respond):
    def handler(request):
        if request.url.path == "/old":
            return httpx.Response(301, headers={"location": "/new"})
        return html_page("<p>Moved</p>")

    respond(handler)
    assert await fetch_html(f"{PUBLIC}/old") == "<p>Moved</p>"


async def test_endless_redirects_stop(respond):
    respond(lambda request: httpx.Response(302, headers={"location": "/again"}))
    with pytest.raises(FetchError, match="Too many redirects"):
        await fetch_html(f"{PUBLIC}/again")


async def test_an_error_status_is_reported(respond):
    respond(lambda request: httpx.Response(404))
    with pytest.raises(FetchError, match="status 404"):
        await fetch_html(f"{PUBLIC}/missing")


async def test_a_page_that_is_too_large_is_refused(respond):
    respond(lambda request: html_page("x" * (fetcher.MAX_BYTES + 1)))
    with pytest.raises(FetchError, match="too large"):
        await fetch_html(f"{PUBLIC}/huge")


async def test_a_non_html_url_is_refused_as_a_page(respond):
    respond(lambda request: httpx.Response(200, headers={"content-type": "application/pdf"}))
    with pytest.raises(FetchError, match="not point to an HTML page"):
        await fetch_html(f"{PUBLIC}/file.pdf")


async def test_images_are_downloaded_with_their_type(respond):
    respond(lambda request: httpx.Response(200, headers={"content-type": "image/png"}, content=b"PNG"))
    assert await fetch_image(f"{PUBLIC}/cover.png") == (b"PNG", "image/png")


async def test_svg_images_are_refused(respond):
    respond(
        lambda request: httpx.Response(200, headers={"content-type": "image/svg+xml"}, content=b"<svg/>")
    )
    with pytest.raises(FetchError, match="not point to an image"):
        await fetch_image(f"{PUBLIC}/cover.svg")


@pytest.mark.parametrize(
    "url",
    [
        f"{PUBLIC}:99999/cover.jpg",  # port out of range
        f"{PUBLIC}:abc/cover.jpg",  # port that isn't a number
        f"http://{'a' * 64}.example.com/cover.jpg",  # host name part too long
    ],
)
async def test_malformed_addresses_are_reported_not_crashed_on(url):
    # These come from pages (redirects, cover images), which aren't checked
    # the way addresses the user types are.
    with pytest.raises(FetchError):
        await fetch_image(url)
