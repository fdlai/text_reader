"""Collections: creating, listing (with Unsorted), renaming and deleting."""

from helpers import create_collection, create_text


async def names(client, **params) -> list[str]:
    page = (await client.get("/api/collections", params=params)).json()
    return [c["name"] for c in page["items"]]


async def test_names_must_be_unique_ignoring_capitals(client):
    await create_collection(client, "Mount Hua")
    response = await client.post("/api/collections", json={"name": "mount hua"})
    assert response.status_code == 409


async def test_a_blank_name_is_refused(client):
    response = await client.post("/api/collections", json={"name": "   "})
    assert response.status_code == 422


async def test_unsorted_is_listed_last_and_only_when_it_has_documents(client):
    await create_collection(client, "Novel")
    assert await names(client) == ["Novel"]
    await create_text(client, "Loose text.")
    assert await names(client) == ["Novel", "Unsorted"]


async def test_cards_show_counts_and_the_newest_covers(client):
    novel = await create_collection(client, "Novel")
    docs = [await create_text(client, f"Chapter {n}.", title=f"Ch {n}", collection_id=novel["id"]) for n in range(5)]
    await client.put(f"/api/documents/{docs[0]['id']}/progress", json={"chunk_index": 0, "offset_sec": 1})

    [card] = (await client.get("/api/collections")).json()["items"]
    assert card["document_count"] == 5
    assert card["in_progress_count"] == 1
    assert [d["title"] for d in card["stack"]] == ["Ch 4", "Ch 3", "Ch 2"]


async def test_sorted_by_name_matches_starting_with_the_search_come_first(client):
    for name in ["Pre-read", "Return", "Zebra"]:
        await create_collection(client, name)
    assert await names(client, sort="name", q="re") == ["Return", "Pre-read"]


async def test_sorted_by_listened_the_latest_listened_comes_first(client):
    a = await create_collection(client, "A")
    b = await create_collection(client, "B")
    await create_collection(client, "C")
    doc_a = await create_text(client, "a", collection_id=a["id"])
    doc_b = await create_text(client, "b", collection_id=b["id"])
    await client.put(f"/api/documents/{doc_a['id']}/progress", json={"chunk_index": 0, "offset_sec": 1})
    await client.put(f"/api/documents/{doc_b['id']}/progress", json={"chunk_index": 0, "offset_sec": 1})
    assert await names(client) == ["B", "A", "C"]


async def test_paging_puts_unsorted_on_the_last_page(client):
    for n in range(3):
        await create_collection(client, f"Collection {n}")
    await create_text(client, "Loose.")
    page1 = (await client.get("/api/collections", params={"page_size": 2, "sort": "name"})).json()
    page2 = (await client.get("/api/collections", params={"page": 2, "page_size": 2, "sort": "name"})).json()
    assert page1["total"] == 4
    assert [c["name"] for c in page2["items"]] == ["Collection 2", "Unsorted"]


async def test_choosing_where_to_move_leaves_out_the_current_one_and_unsorted(client):
    a = await create_collection(client, "A")
    await create_collection(client, "B")
    await create_text(client, "Loose.")
    assert await names(client, exclude=a["id"], with_unsorted="false") == ["B"]


async def test_renaming_allows_changing_only_capitals(client):
    novel = await create_collection(client, "novel")
    await create_collection(client, "Other")
    ok = await client.patch(f"/api/collections/{novel['id']}", json={"name": "Novel"})
    taken = await client.patch(f"/api/collections/{novel['id']}", json={"name": "OTHER"})
    assert ok.json()["name"] == "Novel"
    assert taken.status_code == 409


async def test_deleting_a_collection_can_keep_its_documents_as_unsorted(client):
    novel = await create_collection(client, "Novel")
    doc = await create_text(client, "Kept.", collection_id=novel["id"])
    assert (await client.delete(f"/api/collections/{novel['id']}")).status_code == 204
    assert (await client.get(f"/api/documents/{doc['id']}")).json()["collection_id"] is None


async def test_deleting_a_collection_can_delete_its_documents_too(client):
    novel = await create_collection(client, "Novel")
    doc = await create_text(client, "Gone.", collection_id=novel["id"])
    await client.delete(f"/api/collections/{novel['id']}?delete_documents=true")
    assert (await client.get(f"/api/documents/{doc['id']}")).status_code == 404


async def test_a_missing_collection_is_404(client):
    assert (await client.get("/api/collections/999")).status_code == 404
