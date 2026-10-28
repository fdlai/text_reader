import asyncio
import io
from pathlib import Path

import soundfile as sf
from kokoro_onnx import Kokoro
from openai import APIStatusError, AsyncOpenAI, AuthenticationError, OpenAIError

from app.config import settings
from app.services import qwen
from app.services.errors import TTSError

OPENAI_VOICES = [
    "alloy",
    "ash",
    "ballad",
    "coral",
    "echo",
    "fable",
    "marin",
    "cedar",
    "nova",
    "onyx",
    "sage",
    "shimmer",
    "verse",
]

# Kokoro's English voices: a = American, b = British; f = female, m = male.
KOKORO_VOICES = [
    "af_alloy",
    "af_aoede",
    "af_bella",
    "af_heart",
    "af_jessica",
    "af_kore",
    "af_nicole",
    "af_nova",
    "af_river",
    "af_sarah",
    "af_sky",
    "am_adam",
    "am_echo",
    "am_eric",
    "am_fenrir",
    "am_liam",
    "am_michael",
    "am_onyx",
    "am_puck",
    "am_santa",
    "bf_alice",
    "bf_emma",
    "bf_isabella",
    "bf_lily",
    "bm_daniel",
    "bm_fable",
    "bm_george",
    "bm_lewis",
]

VOICES = {"kokoro": KOKORO_VOICES, "openai": OPENAI_VOICES}

KOKORO_MODEL = "kokoro-v1.0"


def model_name(engine: str) -> str:
    """The model recorded with each audio file, so audio from different engines never mixes."""
    return {"kokoro": KOKORO_MODEL, "qwen": qwen.MODEL_NAME}.get(engine, settings.tts_model)


async def synthesize(text: str, engine: str, voice: str, instructions: str) -> bytes:
    """Return MP3 audio for the text."""
    if engine == "kokoro":
        return await asyncio.to_thread(_kokoro_synthesize, text, voice)
    if engine == "qwen":
        samples, sample_rate = await qwen.speak(text, int(voice))
        return await asyncio.to_thread(_to_mp3, samples, sample_rate)
    return await _openai_synthesize(text, voice, instructions)


def _to_mp3(samples, sample_rate: int) -> bytes:
    buffer = io.BytesIO()
    sf.write(buffer, samples, sample_rate, format="MP3")
    return buffer.getvalue()


async def unavailable_reasons() -> dict[str, str | None]:
    """For each engine, why it can't generate right now, or None if it can."""
    model_dir = Path(settings.kokoro_model_dir)
    kokoro_ready = (model_dir / "kokoro-v1.0.onnx").is_file() and (
        model_dir / "voices-v1.0.bin"
    ).is_file()
    return {
        "kokoro": None if kokoro_ready else f"Kokoro's model files are missing from backend/{model_dir}.",
        "openai": None if settings.openai_api_key else "Add OPENAI_API_KEY to backend/.env to use OpenAI voices.",
        "qwen": await qwen.unavailable_reason(),
    }


_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if not settings.openai_api_key:
        raise TTSError("OPENAI_API_KEY is not set.")
    if _client is None:
        # The SDK default timeout is 10 minutes, which makes a stalled
        # request look like generation silently hanging.
        _client = AsyncOpenAI(api_key=settings.openai_api_key, timeout=120.0)
    return _client


async def _openai_synthesize(text: str, voice: str, instructions: str) -> bytes:
    kwargs = {"instructions": instructions} if instructions.strip() else {}
    try:
        response = await _get_client().audio.speech.create(
            model=settings.tts_model,
            voice=voice,
            input=text,
            response_format="mp3",
            **kwargs,
        )
    except AuthenticationError as e:
        raise TTSError(
            "OpenAI rejected the API key. Check OPENAI_API_KEY in backend/.env."
        ) from e
    except APIStatusError as e:
        raise TTSError(f"OpenAI request failed (status {e.status_code}).") from e
    except OpenAIError as e:
        raise TTSError("Could not reach OpenAI.") from e
    return response.content


_kokoro: Kokoro | None = None


def _get_kokoro() -> Kokoro:
    # Loading the model takes a few seconds, so it is done once on first use.
    global _kokoro
    if _kokoro is None:
        model_dir = Path(settings.kokoro_model_dir)
        model = model_dir / "kokoro-v1.0.onnx"
        voices = model_dir / "voices-v1.0.bin"
        if not (model.is_file() and voices.is_file()):
            raise TTSError(f"Kokoro model files not found in backend/{model_dir}.")
        _kokoro = Kokoro(str(model), str(voices))
    return _kokoro


def _kokoro_synthesize(text: str, voice: str) -> bytes:
    lang = "en-gb" if voice.startswith("b") else "en-us"
    samples, sample_rate = _get_kokoro().create(text, voice=voice, lang=lang)
    return _to_mp3(samples, sample_rate)
