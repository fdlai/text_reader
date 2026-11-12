"""Editing a document's text: only changed chunks are replaced (with their
audio), and the listening position follows the rules in update_text."""

from helpers import add_audio, add_preset, chunk_ids, chunk_of_paragraph, create_text, long_text

PARAGRAPHS = 30


async def edit(client, doc_id: int, text: str, title: str = "Doc") -> dict:
    response = await client.put(f"/api/documents/{doc_id}/text", json={"title": title, "text": text})
    assert response.status_code == 200, response.text
    return response.json()


async def set_progress(client, doc_id: int, chunk: int, offset: float = 5.0, finished=False):
    await client.put(
        f"/api/documents/{doc_id}/progress",
        json={"chunk_index": chunk, "offset_sec": offset, "finished": finished},
    )


async def progress(client, doc_id: int) -> dict:
    return (await client.get(f"/api/documents/{doc_id}/progress")).json()


def with_change(text: str, paragraph: int, change: str = " An added sentence.") -> str:
    paragraphs = text.split("\n")
    paragraphs[paragraph] += change
    return "\n".join(paragraphs)


async def test_the_text_and_title_can_be_read_back_and_changed(client):
    doc = await create_text(client, "Old text.", title="Old")
    await edit(client, doc["id"], "New text.", title="New")
    assert (await client.get(f"/api/documents/{doc['id']}/text")).json() == {
        "title": "New",
        "text": "New text.",
    }


async def test_saving_without_changes_replaces_nothing(client):
    text = long_text(PARAGRAPHS)
    doc = await create_text(client, text)
    assert await edit(client, doc["id"], text) == {"changed": 0, "first_changed": None}


async def test_only_the_changed_chunk_loses_its_audio(client, session):
    text = long_text(PARAGRAPHS)
    doc = await create_text(client, text)
    preset = await add_preset(session)
    ids = await chunk_ids(session, doc["id"])
    files = [await add_audio(session, chunk_id, preset.id) for chunk_id in ids]

    changed = chunk_of_paragraph(text, 10)
    result = await edit(client, doc["id"], with_change(text, 10))

    assert result["first_changed"] == changed
    assert [f.exists() for f in files] == [i != changed for i in range(len(ids))]
    # The chunks after the change are the same rows (with their audio),
    # renumbered if needed.
    new_ids = await chunk_ids(session, doc["id"])
    assert new_ids[: changed] == ids[: changed]
    assert new_ids[-(len(ids) - changed - 1):] == ids[changed + 1 :]


async def test_a_position_in_an_unchanged_chunk_stays_on_that_chunk(client):
    text = long_text(PARAGRAPHS)
    doc = await create_text(client, text)
    last = len(doc["chunks"]) - 1
    listening_to = doc["chunks"][last]["id"]
    await set_progress(client, doc["id"], last, offset=7.5)

    await edit(client, doc["id"], with_change(text, 2))
    # The same chunk and offset, though its number may have changed if the
    # edit made more (or fewer) chunks before it.
    after = await progress(client, doc["id"])
    chunks = (await client.get(f"/api/documents/{doc['id']}")).json()["chunks"]
    assert chunks[after["chunk_index"]]["id"] == listening_to
    assert after["offset_sec"] == 7.5


async def test_a_position_after_an_added_chunk_moves_with_its_chunk(client):
    text = long_text(PARAGRAPHS)
    doc = await create_text(client, text)
    last = len(doc["chunks"]) - 1
    await set_progress(client, doc["id"], last)

    # A whole new paragraph's worth of text near the start adds a chunk.
    result = await edit(client, doc["id"], with_change(text, 1, " Extra words." * 120))
    assert result["changed"] >= 2
    moved = await progress(client, doc["id"])
    assert moved["chunk_index"] > last
    assert moved["offset_sec"] == 5.0


async def test_a_position_in_a_changed_chunk_goes_to_the_start_of_the_change(client):
    text = long_text(PARAGRAPHS)
    doc = await create_text(client, text)
    changed = chunk_of_paragraph(text, 10)
    await set_progress(client, doc["id"], changed, offset=12.0)

    result = await edit(client, doc["id"], with_change(text, 10))
    assert await progress(client, doc["id"]) == {
        "chunk_index": result["first_changed"],
        "offset_sec": 0,
        "finished": False,
    }


async def test_a_finished_document_with_something_new_is_unfinished(client):
    text = long_text(PARAGRAPHS)
    doc = await create_text(client, text)
    last = len(doc["chunks"]) - 1
    await set_progress(client, doc["id"], last, finished=True)

    result = await edit(client, doc["id"], with_change(text, 10))
    assert await progress(client, doc["id"]) == {
        "chunk_index": result["first_changed"],
        "offset_sec": 0,
        "finished": False,
    }


async def test_a_finished_document_with_text_only_removed_stays_finished(client):
    text = long_text(PARAGRAPHS)
    doc = await create_text(client, text)
    last = len(doc["chunks"]) - 1
    await set_progress(client, doc["id"], last, finished=True)

    removed = with_change(text, 10, "").replace("Paragraph 10. ", "")
    await edit(client, doc["id"], removed)
    assert (await progress(client, doc["id"]))["finished"] is True


async def test_deleting_everything_after_the_position_moves_it_to_the_last_chunk(client):
    text = long_text(PARAGRAPHS)
    doc = await create_text(client, text)
    last = len(doc["chunks"]) - 1
    await set_progress(client, doc["id"], last)

    shorter = "\n".join(text.split("\n")[:3])
    await edit(client, doc["id"], shorter)
    after = await progress(client, doc["id"])
    remaining = len((await client.get(f"/api/documents/{doc['id']}")).json()["chunks"])
    assert after["chunk_index"] == remaining - 1


async def test_editing_a_missing_document_is_404(client):
    response = await client.put("/api/documents/999/text", json={"text": "Hi."})
    assert response.status_code == 404
