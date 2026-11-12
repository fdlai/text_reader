"""Shared test setup.

The tests use their own database: the app's database name plus "_test"
(e.g. text_reader_test), on the same PostgreSQL server. It's created and
migrated to the latest version at the start of each run, and emptied after
every test, so the real database is never touched and tests can't affect
each other. Files the app writes (audio, covers) go to a temporary folder.
"""

import asyncio
from pathlib import Path

import asyncpg
import httpx
import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.engine import make_url

from app.config import settings

BACKEND = Path(__file__).parent.parent

# Switched before anything else imports app.database, which connects with
# whatever settings.database_url is at that moment.
_url = make_url(settings.database_url)
_test_url = _url.set(database=f"{_url.database}_test")
settings.database_url = _test_url.render_as_string(hide_password=False)


async def _create_test_database() -> None:
    # A new database is created from the server's default "postgres" one.
    connection = await asyncpg.connect(
        user=_url.username,
        password=_url.password,
        host=_url.host or "localhost",
        port=_url.port or 5432,
        database="postgres",
    )
    try:
        exists = await connection.fetchval(
            "SELECT 1 FROM pg_database WHERE datname = $1", _test_url.database
        )
        if not exists:
            await connection.execute(f'CREATE DATABASE "{_test_url.database}"')
    finally:
        await connection.close()


def pytest_sessionstart(session):
    asyncio.run(_create_test_database())
    # The same migrations as the real database, so they're tested too.
    config = Config(str(BACKEND / "alembic.ini"))
    command.upgrade(config, "head")


@pytest.fixture(scope="session", autouse=True)
def storage(tmp_path_factory):
    """Points every folder the app writes to at a temporary one."""
    root = tmp_path_factory.mktemp("storage")
    for name in ("audio_dir", "voices_dir", "samples_dir", "covers_dir"):
        folder = root / name
        folder.mkdir()
        setattr(settings, name, str(folder))
    return root


@pytest.fixture(autouse=True)
async def empty_database(storage):
    """Each test starts with empty tables (and caches built from them) and
    empty storage folders."""
    yield
    for path in sorted(storage.rglob("*"), reverse=True):
        if path.is_file():
            path.unlink()
        elif path.parent != storage:  # keep the four folders themselves
            path.rmdir()
    from app import models  # noqa: F401  (registers every table on Base)
    from app.database import Base, engine
    from app.services.pronunciation import clear_lexicon_cache

    tables = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    async with engine.begin() as connection:
        await connection.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    clear_lexicon_cache()


@pytest.fixture
async def client():
    """Sends requests straight to the app, without a running server. The
    app's startup (adding built-in voices, Docker cleanup) doesn't run, so
    each test adds what it needs."""
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def session():
    """A database session for setting up data directly."""
    from app.database import SessionLocal

    async with SessionLocal() as s:
        yield s


class FakeEngine:
    """Records what it was asked to say. While held, each chunk waits at
    the gate until released."""

    def __init__(self):
        self.said: list[str] = []
        self.pauses: list[float] = []
        self.started = asyncio.Event()  # set each time a chunk starts
        self.gate = asyncio.Event()
        self.gate.set()  # open: chunks go straight through
        self.error: Exception | None = None

    def hold(self):
        self.gate.clear()

    def release(self):
        self.gate.set()

    async def synthesize(self, text, engine, base_voice, instructions, notify, pause):
        self.said.append(text)
        self.pauses.append(pause)
        self.started.set()
        await self.gate.wait()
        if self.error:
            raise self.error
        return b"fake mp3", None


@pytest.fixture
async def engine(monkeypatch):
    """A fake speech engine for the generation queue (see FakeEngine)."""
    from app.services import generation

    fake = FakeEngine()
    monkeypatch.setattr(generation, "synthesize", fake.synthesize)

    # A real MP3's length would be read from the file; this one is fake.
    def write_audio(path: Path, data: bytes) -> float:
        path.write_bytes(data)
        return 12.0

    async def word_times(path, text, duration, spans=None):
        return [0.0] * len(text.split())

    async def no_docker():
        pass

    monkeypatch.setattr(generation, "_write_audio", write_audio)
    monkeypatch.setattr(generation, "word_times_for", word_times)
    monkeypatch.setattr(generation.qwen, "stop_now", no_docker)
    yield fake

    # Leave the queue empty and stopped for the next test.
    fake.release()
    await generation.shutdown()
    generation._worker = None
    generation._paused = False
    generation._queue.clear()
    generation.jobs.clear()
