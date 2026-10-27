from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import SessionLocal, get_session
from app.models import VoicePreset
from app.routers import audio, documents, pronunciations, voices


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with SessionLocal() as session:
        if await session.scalar(select(VoicePreset.id).limit(1)) is None:
            # The free Kokoro voice is added first so it is the default.
            session.add(VoicePreset(name="Michael", engine="kokoro", base_voice="am_michael"))
            await session.flush()
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
    yield


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


@app.get("/api/health")
async def health(session: AsyncSession = Depends(get_session)):
    await session.execute(text("SELECT 1"))
    return {"status": "ok"}
