"""Voice presets: creating, renaming, editing and deleting them, and what
happens to the audio made with them."""

from sqlalchemy import select

from app.models import AudioFile
from helpers import add_audio, chunk_ids, create_text


async def create_preset(client, name: str, voice: str = "coral", engine: str = "openai") -> dict:
    response = await client.post(
        "/api/voice-presets", json={"name": name, "engine": engine, "base_voice": voice}
    )
    assert response.status_code == 201, response.text
    return response.json()


async def preset_with_audio(client, session, name: str = "Narrator"):
    preset = await create_preset(client, name)
    doc = await create_text(client, "Some text to read.")
    [chunk_id] = await chunk_ids(session, doc["id"])
    audio = await add_audio(session, chunk_id, preset["id"])
    return preset, audio


async def audio_rows(session) -> int:
    return len((await session.scalars(select(AudioFile.id))).all())


async def test_a_preset_is_created_and_listed(client):
    await create_preset(client, "Narrator")
    presets = (await client.get("/api/voice-presets")).json()
    assert [(p["name"], p["base_voice"]) for p in presets] == [("Narrator", "coral")]


async def test_an_unknown_voice_is_refused(client):
    response = await client.post(
        "/api/voice-presets", json={"name": "X", "engine": "kokoro", "base_voice": "nobody"}
    )
    assert response.status_code == 422


async def test_instructions_are_dropped_for_engines_without_them(client):
    response = await client.post(
        "/api/voice-presets",
        json={"name": "K", "engine": "kokoro", "base_voice": "am_michael", "instructions": "Whisper"},
    )
    assert response.json()["instructions"] == ""


async def test_two_presets_cannot_share_a_name(client):
    await create_preset(client, "Narrator")
    response = await client.post(
        "/api/voice-presets", json={"name": "Narrator", "engine": "openai", "base_voice": "alloy"}
    )
    assert response.status_code == 409


async def test_renaming_and_speed_keep_the_audio(client, session):
    preset, audio = await preset_with_audio(client, session)
    renamed = await client.patch(f"/api/voice-presets/{preset['id']}/name", json={"name": "Storyteller"})
    faster = await client.patch(f"/api/voice-presets/{preset['id']}/speed", json={"speed": 1.5})
    assert renamed.json()["name"] == "Storyteller"
    assert faster.json()["speed"] == 1.5
    assert audio.exists()
    assert await audio_rows(session) == 1


async def test_changing_the_voice_discards_its_audio(client, session):
    preset, audio = await preset_with_audio(client, session)
    response = await client.put(
        f"/api/voice-presets/{preset['id']}",
        json={"name": "Narrator", "engine": "openai", "base_voice": "alloy"},
    )
    assert response.status_code == 200
    assert not audio.exists()
    assert await audio_rows(session) == 0


async def test_a_failed_edit_keeps_the_audio(client, session):
    """Changing the voice and taking a name that's in use fails as a whole:
    the audio rows stay, so their files must stay too."""
    preset, audio = await preset_with_audio(client, session)
    await create_preset(client, "Taken")
    response = await client.put(
        f"/api/voice-presets/{preset['id']}",
        json={"name": "Taken", "engine": "openai", "base_voice": "alloy"},
    )
    assert response.status_code == 409
    assert await audio_rows(session) == 1
    assert audio.exists()


async def test_deleting_a_preset_deletes_its_audio(client, session):
    preset, audio = await preset_with_audio(client, session)
    assert (await client.delete(f"/api/voice-presets/{preset['id']}")).status_code == 204
    assert not audio.exists()
    assert await audio_rows(session) == 0
    assert (await client.get("/api/voice-presets")).json() == []


async def test_the_documents_voice_is_remembered_until_the_voice_is_deleted(client, session):
    preset = await create_preset(client, "Narrator")
    doc = await create_text(client, "Hello.")
    response = await client.put(f"/api/documents/{doc['id']}/voice", json={"voice_preset_id": preset["id"]})
    assert response.status_code == 204
    assert (await client.get(f"/api/documents/{doc['id']}")).json()["voice_preset_id"] == preset["id"]

    await client.delete(f"/api/voice-presets/{preset['id']}")
    assert (await client.get(f"/api/documents/{doc['id']}")).json()["voice_preset_id"] is None
