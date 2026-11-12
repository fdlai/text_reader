"""Adding, listing, moving and deleting documents, and listening progress."""

import pytest

from app.routers import documents as documents_router
from app.services.extractor import Article, ExtractionError
from app.services.fetcher import FetchError
from helpers import add_audio, add_preset, chunk_ids, create_collection, create_text


# --- Typed or pasted text ---------------------------------------------------


async def test_pasted_text_becomes_a_document_with_chunks(client):
    doc = await create_text(client, "First paragraph.\nSecond paragraph.", title="Notes")
    assert doc["title"] == "Notes"
    assert doc["source_url"] is None
    assert doc["collection_id"] is None
    assert len(doc["chunks"]) == 1


async def test_without_a_title_the_first_words_are_used(client):
    text = "It was a bright cold day in April, and the clocks were striking thirteen."
    doc = await create_text(client, text)
    assert doc["title"] == "It was a bright cold day in April, and the clocks were…"


async def test_a_title_from_one_very_long_word_is_cut_short(client):
    # e.g. a long web address, or Chinese or Japanese text (no spaces).
    doc = await create_text(client, "あ" * 2000)
    assert len(doc["title"]) <= 61  # 60 characters and "…"


async def test_empty_text_is_refused(client):
    response = await client.post("/api/documents/text", json={"text": "   \n  "})
    assert response.status_code == 422


async def test_text_over_the_limit_is_refused(client):
    response = await client.post("/api/documents/text", json={"text": "a" * 500_001})
    assert response.status_code == 422
    assert "500,000" in response.json()["detail"]


async def test_text_for_a_missing_collection_is_refused(client):
    response = await client.post("/api/documents/text", json={"text": "Hi.", "collection_id": 999})
    assert response.status_code == 404


# --- From a web address -----------------------------------------------------


@pytest.fixture
def page(monkeypatch):
    """Makes adding a URL use this article instead of downloading anything."""
    article = Article(
        title="Chapter 1",
        text="The story begins.\nIt continues.",
        image_url=None,
        next_url="https://novel.example.com/chapter-2",
    )

    async def fake_fetch(url):
        return "<html></html>"

    async def fake_extract(html, url):
        return article

    monkeypatch.setattr(documents_router, "fetch_html", fake_fetch)
    monkeypatch.setattr(documents_router, "extract_article", fake_extract)
    return article


async def test_a_page_is_added_without_its_hash_part(client, page):
    response = await client.post(
        "/api/documents", json={"url": "https://novel.example.com/chapter-1#comments"}
    )
    assert response.status_code == 201
    doc = response.json()
    assert doc["title"] == "Chapter 1"
    assert doc["source_url"] == "https://novel.example.com/chapter-1"
    assert doc["next_url"] == "https://novel.example.com/chapter-2"


async def test_the_same_page_twice_says_where_it_already_is(client, page):
    collection = await create_collection(client, "My Novel")
    url = "https://novel.example.com/chapter-1"
    first = await client.post("/api/documents", json={"url": url, "collection_id": collection["id"]})
    second = await client.post("/api/documents", json={"url": url + "#top"})
    assert second.status_code == 409
    assert second.json()["detail"] == {
        "message": "That page is already in “My Novel”.",
        "document_id": first.json()["id"],
    }


async def test_the_next_part_is_linked_once_it_is_added(client, page):
    first = (await client.post("/api/documents", json={"url": "https://novel.example.com/chapter-1"})).json()
    assert first["next_document_id"] is None
    page.next_url = None
    second = (await client.post("/api/documents", json={"url": "https://novel.example.com/chapter-2"})).json()
    first = (await client.get(f"/api/documents/{first['id']}")).json()
    assert first["next_document_id"] == second["id"]


@pytest.mark.parametrize("error", [FetchError("The site responded with status 404."), ExtractionError("No text found.")])
async def test_a_page_that_cannot_be_read_is_reported(client, monkeypatch, error):
    async def failing_fetch(url):
        raise error

    monkeypatch.setattr(documents_router, "fetch_html", failing_fetch)
    response = await client.post("/api/documents", json={"url": "https://example.com/x"})
    assert response.status_code == 422
    assert response.json()["detail"] == str(error)


# --- Listing ----------------------------------------------------------------


async def test_a_collection_lists_only_its_own_documents(client):
    novel = await create_collection(client, "Novel")
    await create_text(client, "In the novel.", title="Chapter", collection_id=novel["id"])
    await create_text(client, "Not in any.", title="Loose")

    in_novel = (await client.get(f"/api/documents?collection_id={novel['id']}")).json()
    unsorted = (await client.get("/api/documents?unsorted=true")).json()
    assert [d["title"] for d in in_novel["items"]] == ["Chapter"]
    assert [d["title"] for d in unsorted["items"]] == ["Loose"]


async def test_pages_split_the_list_and_total_counts_all_of_them(client):
    for n in range(5):
        await create_text(client, f"Text {n}.", title=f"Doc {n}")
    page1 = (await client.get("/api/documents?page=1&page_size=2")).json()
    page3 = (await client.get("/api/documents?page=3&page_size=2")).json()
    assert page1["total"] == 5
    assert [d["title"] for d in page1["items"]] == ["Doc 4", "Doc 3"]  # newest first
    assert [d["title"] for d in page3["items"]] == ["Doc 0"]


async def test_oldest_first_sorting(client):
    for n in range(3):
        await create_text(client, f"Text {n}.", title=f"Doc {n}")
    items = (await client.get("/api/documents?sort=oldest")).json()["items"]
    assert [d["title"] for d in items] == ["Doc 0", "Doc 1", "Doc 2"]


async def test_search_matches_titles_ignoring_capitals_and_wildcards(client):
    await create_text(client, "a", title="The Hobbit")
    await create_text(client, "b", title="100% Done")
    await create_text(client, "c", title="Other")
    hobbit = (await client.get("/api/documents?q=hobbit")).json()
    percent = (await client.get("/api/documents", params={"q": "%"})).json()
    assert [d["title"] for d in hobbit["items"]] == ["The Hobbit"]
    # % is searched for as itself, not as "anything".
    assert [d["title"] for d in percent["items"]] == ["100% Done"]


async def test_progress_filters_and_their_counts(client):
    new = await create_text(client, "Not started.", title="New")
    started = await create_text(client, "Started.", title="Started")
    done = await create_text(client, "Done.", title="Done")
    await client.put(f"/api/documents/{started['id']}/progress", json={"chunk_index": 0, "offset_sec": 1})
    await client.put(f"/api/documents/{done['id']}/progress", json={"chunk_index": 0, "offset_sec": 1, "finished": True})

    listing = (await client.get("/api/documents?progress=in-progress")).json()
    assert [d["title"] for d in listing["items"]] == ["Started"]
    assert listing["counts"] == {"all": 3, "not-started": 1, "in-progress": 1, "finished": 1}
    not_started = (await client.get("/api/documents?progress=not-started")).json()
    assert [d["id"] for d in not_started["items"]] == [new["id"]]


async def test_listened_sorting_puts_the_latest_listened_first(client):
    a = await create_text(client, "a", title="A")
    b = await create_text(client, "b", title="B")
    await create_text(client, "c", title="Never played")
    await client.put(f"/api/documents/{b['id']}/progress", json={"chunk_index": 0, "offset_sec": 1})
    await client.put(f"/api/documents/{a['id']}/progress", json={"chunk_index": 0, "offset_sec": 2})
    items = (await client.get("/api/documents?sort=listened")).json()["items"]
    assert [d["title"] for d in items] == ["A", "B", "Never played"]


async def test_continue_listening_shows_unfinished_documents_only(client):
    a = await create_text(client, "a", title="A")
    b = await create_text(client, "b", title="B")
    await create_text(client, "c", title="Never played")
    await client.put(f"/api/documents/{a['id']}/progress", json={"chunk_index": 0, "offset_sec": 1})
    await client.put(f"/api/documents/{b['id']}/progress", json={"chunk_index": 0, "offset_sec": 1, "finished": True})
    recent = (await client.get("/api/documents/recent")).json()
    assert [d["title"] for d in recent] == ["A"]


async def test_time_left_uses_the_pace_of_audio_made_so_far(client, session):
    doc = await create_text(client, "x" * 100, title="Paced")
    preset = await add_preset(session)
    [chunk_id] = await chunk_ids(session, doc["id"])
    await add_audio(session, chunk_id, preset.id, duration=20.0)  # 0.2 s a character

    item = (await client.get("/api/documents")).json()["items"][0]
    assert item["seconds_left"] == pytest.approx(20.0)
    assert item["fraction"] == 0


# --- Progress ---------------------------------------------------------------


async def test_progress_starts_at_the_beginning_and_saves_the_latest(client):
    doc = await create_text(client, "Hello.")
    assert (await client.get(f"/api/documents/{doc['id']}/progress")).json() == {
        "chunk_index": 0,
        "offset_sec": 0,
        "finished": False,
    }
    for offset in (1.5, 3.25):
        await client.put(f"/api/documents/{doc['id']}/progress", json={"chunk_index": 0, "offset_sec": offset})
    saved = (await client.get(f"/api/documents/{doc['id']}/progress")).json()
    assert saved["offset_sec"] == 3.25


async def test_progress_for_a_missing_document_is_404(client):
    response = await client.put("/api/documents/999/progress", json={"chunk_index": 0, "offset_sec": 0})
    assert response.status_code == 404


# --- Moving and deleting ----------------------------------------------------


async def test_documents_are_moved_together(client):
    novel = await create_collection(client, "Novel")
    a = await create_text(client, "a")
    b = await create_text(client, "b")
    response = await client.post("/api/documents/move", json={"document_ids": [a["id"], b["id"]], "collection_id": novel["id"]})
    assert response.status_code == 204
    listing = (await client.get(f"/api/documents?collection_id={novel['id']}")).json()
    assert listing["total"] == 2


async def test_moving_to_a_missing_collection_is_404(client):
    a = await create_text(client, "a")
    response = await client.post("/api/documents/move", json={"document_ids": [a["id"]], "collection_id": 999})
    assert response.status_code == 404


async def test_deleting_a_document_removes_its_audio_files(client, session):
    doc = await create_text(client, "Hello.")
    preset = await add_preset(session)
    [chunk_id] = await chunk_ids(session, doc["id"])
    audio = await add_audio(session, chunk_id, preset.id)

    assert (await client.delete(f"/api/documents/{doc['id']}")).status_code == 204
    assert (await client.get(f"/api/documents/{doc['id']}")).status_code == 404
    assert not audio.exists()


async def test_deleting_several_skips_ids_that_do_not_exist(client):
    a = await create_text(client, "a")
    response = await client.post("/api/documents/delete", json={"document_ids": [a["id"], 999]})
    assert response.status_code == 204
    assert (await client.get("/api/documents")).json()["total"] == 0
