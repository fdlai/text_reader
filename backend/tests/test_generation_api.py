"""The generation endpoints: starting, the queue panel's list, pausing,
reordering and regenerating outdated audio."""

from app.config import settings
from helpers import add_audio, add_preset, chunk_ids, create_text, finished, long_text, until


async def generate(client, doc_id: int, preset_id: int, front: bool = False):
    return await client.post(
        f"/api/documents/{doc_id}/generate",
        json={"voice_preset_id": preset_id, "front": front},
    )


async def test_generating_makes_the_audio_and_remembers_the_voice(client, session, engine):
    doc = await create_text(client, long_text(4))
    preset = await add_preset(session)
    response = await generate(client, doc["id"], preset.id)
    assert response.status_code == 200
    assert response.json()["generating"] is True

    await until(lambda: finished((doc["id"], preset.id)))
    status = (await client.get(f"/api/documents/{doc['id']}/audio-status", params={"voice_preset_id": preset.id})).json()
    assert status["generating"] is False
    assert all(c["ready"] for c in status["chunks"])
    assert (await client.get(f"/api/documents/{doc['id']}")).json()["voice_preset_id"] == preset.id


async def test_generating_a_missing_document_or_voice_is_404(client, session, engine):
    doc = await create_text(client, "Hello.")
    preset = await add_preset(session)
    assert (await generate(client, 999, preset.id)).status_code == 404
    assert (await generate(client, doc["id"], 999)).status_code == 404


async def test_openai_voices_need_an_api_key(client, monkeypatch, engine):
    monkeypatch.setattr(settings, "openai_api_key", "")
    doc = await create_text(client, "Hello.")
    preset = (await client.post("/api/voice-presets", json={"name": "N", "engine": "openai", "base_voice": "coral"})).json()
    response = await generate(client, doc["id"], preset["id"])
    assert response.status_code == 400
    assert "OPENAI_API_KEY" in response.json()["detail"]


async def test_the_queue_lists_jobs_in_order_with_their_progress(client, session, engine):
    first = await create_text(client, long_text(4), title="First")
    second = await create_text(client, "Short.", title="Second")
    preset = await add_preset(session)
    engine.hold()
    await generate(client, first["id"], preset.id)
    await engine.started.wait()
    await generate(client, second["id"], preset.id)

    queue = (await client.get("/api/generation")).json()
    assert queue["paused"] is False
    assert [(i["title"], i["voice_name"], i["ready"]) for i in queue["items"]] == [
        ("First", "Michael", 0),
        ("Second", "Michael", 0),
    ]
    assert queue["items"][0]["total"] == len(first["chunks"])


async def test_the_queue_can_be_reordered(client, session, engine):
    a = await create_text(client, long_text(4), title="A")
    b = await create_text(client, "B.", title="B")
    preset = await add_preset(session)
    engine.hold()
    await generate(client, a["id"], preset.id)
    await generate(client, b["id"], preset.id)

    response = await client.post("/api/generation/move", json={"document_id": b["id"], "voice_preset_id": preset.id, "to": "top"})
    assert [i["title"] for i in response.json()["items"]] == ["B", "A"]


async def test_pause_and_resume(client, session, engine):
    doc = await create_text(client, long_text(4))
    preset = await add_preset(session)
    engine.hold()
    await generate(client, doc["id"], preset.id)
    await engine.started.wait()

    paused = (await client.post("/api/generation/pause")).json()
    assert paused["paused"] is True
    assert len(paused["items"]) == 1  # still queued

    engine.release()
    resumed = (await client.post("/api/generation/resume")).json()
    assert resumed["paused"] is False
    await until(lambda: finished((doc["id"], preset.id)))


async def test_regenerating_outdated_audio_remakes_only_those_sections(client, session, engine):
    doc = await create_text(client, "Hermione waved.\n" + long_text(4))
    preset = await add_preset(session)
    ids = await chunk_ids(session, doc["id"])
    files = [await add_audio(session, chunk_id, preset.id) for chunk_id in ids]
    await client.post("/api/pronunciations", json={"word": "Hermione", "sounds_like": "Her-my-oh-nee"})

    response = await client.post(f"/api/documents/{doc['id']}/regenerate-outdated", json={"voice_preset_id": preset.id})
    assert response.status_code == 200
    await until(lambda: finished((doc["id"], preset.id)))

    assert engine.said == ["Her-my-oh-nee waved.\n\n" + engine.said[0].split("\n\n", 1)[1]]
    assert [f.exists() for f in files[1:]] == [True] * (len(files) - 1)
    status = (await client.get(f"/api/documents/{doc['id']}/audio-status", params={"voice_preset_id": preset.id})).json()
    assert not any(c["outdated"] for c in status["chunks"])


async def test_regenerating_waits_for_a_running_job(client, session, engine):
    doc = await create_text(client, long_text(4))
    preset = await add_preset(session)
    engine.hold()
    await generate(client, doc["id"], preset.id)
    response = await client.post(f"/api/documents/{doc['id']}/regenerate-outdated", json={"voice_preset_id": preset.id})
    assert response.status_code == 409
