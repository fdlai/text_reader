"""Serving the built frontend (as in Docker): files as they are, any other
address as the app's index.html, and never that for /api addresses."""

import httpx
import pytest
from fastapi import FastAPI

from app.main import FrontendFiles


@pytest.fixture
async def site(tmp_path):
    (tmp_path / "index.html").write_text("<p>Audifire</p>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("console.log(1)")
    app = FastAPI()
    app.mount("/", FrontendFiles(directory=tmp_path, html=True))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def test_files_are_served_as_they_are(site):
    response = await site.get("/assets/app.js")
    assert response.text == "console.log(1)"


async def test_the_front_page_is_the_app(site):
    assert (await site.get("/")).text == "<p>Audifire</p>"


async def test_any_page_of_the_app_gets_the_app(site):
    response = await site.get("/documents/3")
    assert response.status_code == 200
    assert response.text == "<p>Audifire</p>"


async def test_a_wrong_api_address_is_still_not_found(site):
    assert (await site.get("/api/nope")).status_code == 404
