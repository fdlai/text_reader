"""Pronunciation entries and preferences."""

from app.database import SessionLocal
from app.services.pronunciation import load_lexicon


async def lexicon_text(text: str) -> str:
    async with SessionLocal() as session:
        return (await load_lexicon(session)).apply(text)[0]


# --- Pronunciations ---------------------------------------------------------


async def test_an_entry_is_saved_with_its_matching_key(client):
    response = await client.post("/api/pronunciations", json={"word": ' "Hermione" ', "sounds_like": "Her-my-oh-nee"})
    assert response.status_code == 201
    assert response.json()["word"] == '"Hermione"'
    assert await lexicon_text("Hermione waved.") == "Her-my-oh-nee waved."


async def test_the_same_word_twice_is_refused_even_with_other_capitals(client):
    await client.post("/api/pronunciations", json={"word": "Baek", "sounds_like": "Bake"})
    response = await client.post("/api/pronunciations", json={"word": "BAEK!", "sounds_like": "Back"})
    assert response.status_code == 409


async def test_a_word_without_letters_is_refused(client):
    response = await client.post("/api/pronunciations", json={"word": "?!", "sounds_like": "huh"})
    assert response.status_code == 422


async def test_changes_take_effect_straight_away(client):
    created = (await client.post("/api/pronunciations", json={"word": "Baek", "sounds_like": "Bake"})).json()
    assert await lexicon_text("Baek") == "Bake"  # now cached

    await client.put(f"/api/pronunciations/{created['id']}", json={"word": "Baek", "sounds_like": "Back"})
    assert await lexicon_text("Baek") == "Back"

    await client.put(f"/api/pronunciations/{created['id']}", json={"word": "Baek", "sounds_like": "Back", "enabled": False})
    assert await lexicon_text("Baek") == "Baek"

    await client.delete(f"/api/pronunciations/{created['id']}")
    assert (await client.get("/api/pronunciations")).json() == []


# --- Preferences ------------------------------------------------------------


async def test_preferences_start_with_defaults(client):
    prefs = (await client.get("/api/preferences")).json()
    assert prefs["theme"] == "auto"
    assert prefs["font_size"] == 18


async def test_preferences_are_saved(client):
    prefs = (await client.get("/api/preferences")).json()
    prefs.update(theme="paper", font_size=44, align="justify")
    assert (await client.put("/api/preferences", json=prefs)).status_code == 200
    saved = (await client.get("/api/preferences")).json()
    assert (saved["theme"], saved["font_size"], saved["align"]) == ("paper", 44, "justify")


async def test_out_of_range_preferences_are_refused(client):
    prefs = (await client.get("/api/preferences")).json()
    for change in ({"font_size": 200}, {"theme": "neon"}, {"paragraph_pause": -1}):
        response = await client.put("/api/preferences", json={**prefs, **change})
        assert response.status_code == 422, change
