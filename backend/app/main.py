import asyncio
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import SessionLocal, get_session
from app.models import VoicePreset
from app.routers import (
    audio,
    custom_voices,
    documents,
    engines,
    preferences,
    pronunciations,
    voices,
)
from app.services import generation, qwen
from app.services.builtin_voices import add_kokoro_voices


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with SessionLocal() as session:
        # On the very first run, add an example OpenAI voice.
        if await session.scalar(select(VoicePreset.id).limit(1)) is None:
            session.add(
                VoicePreset(
                    name="Narrator",
                    engine="openai",
                    base_voice="coral",
                    instructions=(
                        "Speak in a warm, natural, steady narrator voice at a relaxed pace. "
                        "Keep the tone consistent throughout."
                    ),
                )
            )
            await session.commit()
        await add_kokoro_voices(session)

    await qwen.remove_container()
    idle_watcher = asyncio.create_task(qwen.stop_when_idle())
    yield
    idle_watcher.cancel()
    await generation.shutdown()
    await qwen.remove_container()


app = FastAPI(title="Text Reader", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(documents.router)
app.include_router(voices.router)
app.include_router(audio.router)
app.include_router(pronunciations.router)
app.include_router(custom_voices.router)
app.include_router(engines.router)
app.include_router(preferences.router)


@app.get("/api/health")
async def health(session: AsyncSession = Depends(get_session)):
    await session.execute(text("SELECT 1"))
    return {"status": "ok"}
