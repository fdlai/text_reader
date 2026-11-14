"""The generation queue: one worker making one chunk at a time for the job
at the front. A fake speech engine stands in for the real ones, so these run
in moments. Its "gate" can hold a chunk mid-generation, to test what happens
when the queue changes right then (pause, cancel, edits)."""

import asyncio
from pathlib import Path

from sqlalchemy import delete, select

from app.models import AudioFile, Chunk
from app.services import generation
from app.services.generation import (
    cancel_generation,
    jobs,
    move_job,
    pause_generation,
    queue_position,
    queued_jobs,
    resume_generation,
    skip_chunks,
    start_generation,
)
from app.services.tts import TTSError
from helpers import (
    add_audio,
    add_preset,
    chunk_ids,
    create_text,
    finished,
    long_text,
    until,
)


async def audio_rows(session, document_id: int) -> list[AudioFile]:
    # populate_existing: read the rows again, since the worker saved them
    # with its own session.
    return list(
        await session.scalars(
            select(AudioFile)
            .join(Chunk)
            .where(Chunk.document_id == document_id)
            .order_by(Chunk.index)
            .execution_options(populate_existing=True)
        )
    )


async def document_with_chunks(client, paragraphs: int = 6, text: str | None = None):
    doc = await create_text(client, text or long_text(paragraphs))
    return doc["id"]


async def test_every_chunk_gets_audio_in_order(client, session, engine):
    doc = await document_with_chunks(client)
    preset = await add_preset(session)
    ids = await chunk_ids(session, doc)

    start_generation(doc, preset.id)
    await until(lambda: finished((doc, preset.id)))

    rows = await audio_rows(session, doc)
    assert [r.chunk_id for r in rows] == ids
    assert all(Path(generation.audio_path(r.file_name)).exists() and r.duration_sec == 12.0 for r in rows)
    assert jobs[(doc, preset.id)] == {"running": False, "error": None}


async def test_pronunciations_are_spoken_but_the_text_is_kept(client, session, engine):
    await client.post("/api/pronunciations", json={"word": "Hermione", "sounds_like": "Her-my-oh-nee"})
    doc = await document_with_chunks(client, text="Hermione smiled.")
    preset = await add_preset(session)

    start_generation(doc, preset.id)
    await until(lambda: finished((doc, preset.id)))

    assert engine.said == ["Her-my-oh-nee smiled."]
    [row] = await audio_rows(session, doc)
    assert row.pronunciations == {"hermione": "Her-my-oh-nee"}
    assert len(row.word_times) == 2  # timed against "Hermione smiled."


async def test_the_paragraph_pause_setting_is_used(client, session, engine):
    prefs = (await client.get("/api/preferences")).json()
    await client.put("/api/preferences", json={**prefs, "paragraph_pause": 0.7})
    doc = await document_with_chunks(client, text="One.\nTwo.")
    preset = await add_preset(session)

    start_generation(doc, preset.id)
    await until(lambda: finished((doc, preset.id)))
    assert engine.pauses == [0.7]
    assert (await audio_rows(session, doc))[0].paragraph_pause == 0.7


async def test_chunks_that_already_have_audio_are_skipped(client, session, engine):
    doc = await document_with_chunks(client)
    preset = await add_preset(session)
    first, *rest = await chunk_ids(session, doc)
    await add_audio(session, first, preset.id)

    start_generation(doc, preset.id)
    await until(lambda: finished((doc, preset.id)))
    assert len(engine.said) == len(rest)


async def test_listening_moves_a_job_to_the_front_after_the_chunk_in_progress(client, session, engine):
    first = await document_with_chunks(client)
    second = await document_with_chunks(client, text="The other article.")
    preset = await add_preset(session)

    engine.hold()
    start_generation(first, preset.id)
    await engine.started.wait()  # the first article's first chunk is being made
    start_generation(second, preset.id, front=True)
    assert queued_jobs() == [(second, preset.id), (first, preset.id)]
    engine.release()

    await until(lambda: finished((first, preset.id)))
    # The chunk in progress finished, then the other article went next.
    assert engine.said[1] == "The other article."


async def test_asking_again_without_front_keeps_the_place(client, session, engine):
    a = await document_with_chunks(client)
    b = await document_with_chunks(client)
    preset = await add_preset(session)
    engine.hold()
    start_generation(a, preset.id)
    start_generation(b, preset.id)
    start_generation(b, preset.id)
    assert queued_jobs() == [(a, preset.id), (b, preset.id)]
    assert (queue_position(a, preset.id), queue_position(b, preset.id)) == (0, 1)


def test_moving_jobs_in_the_queue():
    generation._queue[:] = [(1, 1), (2, 1), (3, 1)]
    try:
        move_job(3, 1, "up")
        assert queued_jobs() == [(1, 1), (3, 1), (2, 1)]
        move_job(2, 1, "top")
        assert queued_jobs() == [(2, 1), (1, 1), (3, 1)]
        move_job(3, 1, "down")  # already last
        assert queued_jobs() == [(2, 1), (1, 1), (3, 1)]
        move_job(9, 1, "top")  # not queued: nothing happens
        assert queued_jobs() == [(2, 1), (1, 1), (3, 1)]
    finally:
        generation._queue.clear()


async def test_an_engine_error_ends_the_job_with_its_message(client, session, engine):
    doc = await document_with_chunks(client)
    preset = await add_preset(session)
    engine.error = TTSError("Docker Desktop isn't running.")

    start_generation(doc, preset.id)
    await until(lambda: finished((doc, preset.id)))
    assert jobs[(doc, preset.id)]["error"] == "Docker Desktop isn't running."
    assert await audio_rows(session, doc) == []


async def test_an_unexpected_error_gives_a_general_message(client, session, engine):
    doc = await document_with_chunks(client)
    preset = await add_preset(session)
    engine.error = RuntimeError("something internal")

    start_generation(doc, preset.id)
    await until(lambda: finished((doc, preset.id)))
    assert jobs[(doc, preset.id)]["error"] == "Audio generation failed."


async def test_pausing_stops_the_chunk_in_progress_and_resuming_carries_on(client, session, engine):
    doc = await document_with_chunks(client)
    preset = await add_preset(session)
    engine.hold()
    start_generation(doc, preset.id)
    await engine.started.wait()

    await pause_generation()
    assert generation.is_paused()
    assert queued_jobs() == [(doc, preset.id)]  # still queued
    assert await audio_rows(session, doc) == []  # the stopped chunk wasn't saved
    assert list(Path(generation.settings.audio_dir).glob(f"*_{preset.id}_*")) == []

    engine.release()
    resume_generation()
    await until(lambda: finished((doc, preset.id)))
    assert len(await audio_rows(session, doc)) == len(await chunk_ids(session, doc))


async def test_cancelling_removes_the_job_and_saves_nothing_more(client, session, engine):
    doc = await document_with_chunks(client)
    preset = await add_preset(session)
    engine.hold()
    start_generation(doc, preset.id)
    await engine.started.wait()

    await cancel_generation(document_id=doc)
    engine.release()
    await asyncio.sleep(0.1)
    assert queued_jobs() == []
    assert (doc, preset.id) not in jobs
    assert await audio_rows(session, doc) == []


async def test_cancelling_the_last_job_ends_a_pause(client, session, engine):
    doc = await document_with_chunks(client)
    preset = await add_preset(session)
    await pause_generation()
    start_generation(doc, preset.id)
    await cancel_generation(preset_id=preset.id)
    assert not generation.is_paused()


async def test_an_edit_skips_the_chunk_in_progress_and_the_job_carries_on(client, session, engine):
    doc = await document_with_chunks(client)
    preset = await add_preset(session)
    first, *rest = await chunk_ids(session, doc)
    engine.hold()
    start_generation(doc, preset.id)
    await engine.started.wait()  # making the first chunk

    await skip_chunks({first})
    engine.release()
    await until(lambda: finished((doc, preset.id)))
    # The skipped chunk was made again afterwards, since it still exists.
    assert len(await audio_rows(session, doc)) == 1 + len(rest)


async def test_a_chunk_deleted_while_its_audio_was_made_is_not_saved(client, session, engine):
    """The edit removed the chunk just as its audio finished: saving it
    fails (the chunk is gone), so the file is removed and the job goes on."""
    doc = await document_with_chunks(client)
    preset = await add_preset(session)
    first, *rest = await chunk_ids(session, doc)
    engine.hold()
    start_generation(doc, preset.id)
    await engine.started.wait()

    await session.execute(delete(Chunk).where(Chunk.id == first))
    await session.commit()
    engine.release()
    await until(lambda: finished((doc, preset.id)))

    assert [r.chunk_id for r in await audio_rows(session, doc)] == rest
    assert list(Path(generation.settings.audio_dir).glob(f"{first}_{preset.id}_*")) == []
    assert jobs[(doc, preset.id)]["error"] is None


async def test_word_timing_failures_keep_the_audio(monkeypatch, tmp_path):
    def broken(*args):
        raise RuntimeError("Whisper crashed")

    monkeypatch.setattr(generation, "word_start_times", broken)
    assert await generation.word_times_for(tmp_path / "a.mp3", "Some words.", 3.0) is None


def test_a_fixed_notice_disappears_after_a_while(monkeypatch):
    jobs[(1, 1)] = {"running": True, "error": None, "notice": ("Retrying with a shorter sample.", None)}
    assert generation.notice(1, 1) == "Retrying with a shorter sample."
    jobs[(1, 1)]["notice"] = ("Fixed.", 0.0)  # expired long ago
    assert generation.notice(1, 1) is None
    jobs.clear()
