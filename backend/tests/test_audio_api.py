"""Which sections have audio, and which are outdated: made before a
pronunciation or the paragraph pause changed."""

from helpers import add_audio, add_preset, chunk_ids, create_text, long_text


async def status(client, doc_id: int, preset_id: int) -> list[dict]:
    response = await client.get(
        f"/api/documents/{doc_id}/audio-status", params={"voice_preset_id": preset_id}
    )
    assert response.status_code == 200, response.text
    return response.json()["chunks"]


async def two_chunk_document(client, session):
    """A document whose first chunk mentions Hermione and whose others
    don't, with audio for its first two chunks."""
    text = "Hermione opened the book.\n" + long_text(6)
    doc = await create_text(client, text)
    preset = await add_preset(session)
    ids = await chunk_ids(session, doc["id"])
    for chunk_id in ids[:2]:
        await add_audio(session, chunk_id, preset.id, duration=12.5)
    return doc, preset


async def test_status_shows_which_sections_have_audio(client, session):
    doc, preset = await two_chunk_document(client, session)
    chunks = await status(client, doc["id"], preset.id)
    assert [c["ready"] for c in chunks[:3]] == [True, True, False]
    assert chunks[0]["duration_sec"] == 12.5
    assert not any(c["outdated"] for c in chunks)


async def test_a_new_pronunciation_outdates_only_the_sections_that_use_it(client, session):
    doc, preset = await two_chunk_document(client, session)
    await client.post("/api/pronunciations", json={"word": "Hermione", "sounds_like": "Her-my-oh-nee"})
    chunks = await status(client, doc["id"], preset.id)
    assert [c["outdated"] for c in chunks[:2]] == [True, False]


async def test_audio_made_with_the_current_pronunciation_is_up_to_date(client, session):
    doc = await create_text(client, "Hermione waved.")
    preset = await add_preset(session)
    await client.post("/api/pronunciations", json={"word": "Hermione", "sounds_like": "Her-my-oh-nee"})
    [chunk_id] = await chunk_ids(session, doc["id"])
    await add_audio(session, chunk_id, preset.id, pronunciations={"hermione": "Her-my-oh-nee"})
    [chunk] = await status(client, doc["id"], preset.id)
    assert chunk["outdated"] is False


async def test_a_new_paragraph_pause_outdates_kokoro_audio(client, session):
    doc, preset = await two_chunk_document(client, session)
    prefs = (await client.get("/api/preferences")).json()
    await client.put("/api/preferences", json={**prefs, "paragraph_pause": 1.0})
    chunks = await status(client, doc["id"], preset.id)
    assert [c["outdated"] for c in chunks[:2]] == [True, True]


async def test_deleting_a_voices_audio_keeps_the_document_and_other_voices(client, session):
    doc, preset = await two_chunk_document(client, session)
    other = await add_preset(session, name="Other")
    [first_chunk] = (await chunk_ids(session, doc["id"]))[:1]
    kept = await add_audio(session, first_chunk, other.id)

    response = await client.delete(
        f"/api/documents/{doc['id']}/audio", params={"voice_preset_id": preset.id}
    )
    assert response.status_code == 204
    assert not any(c["ready"] for c in await status(client, doc["id"], preset.id))
    assert (await status(client, doc["id"], other.id))[0]["ready"] is True
    assert kept.exists()
