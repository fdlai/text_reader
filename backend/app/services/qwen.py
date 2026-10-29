"""Runs Qwen3-TTS in a Docker container and talks to it over HTTP.

Qwen comes as two models, and only one fits on a small GPU at a time:
- "design" (VoiceDesign) makes up a voice from a written description. It's
  only used on the "Create a voice" page.
- "clone" (Base) reads text in the voice of a saved sample clip. It's used
  for everything else.

Asking for the model that isn't running swaps the container (about 10-20
seconds). The container is stopped after IDLE_SECONDS without use and when
the app shuts down, so the GPU is only busy while Qwen is actually needed.
"""

import asyncio
import base64
import io
import logging
import re
import subprocess
import time
from collections.abc import Callable
from pathlib import Path

import httpx
import numpy as np
import soundfile as sf

from app.config import settings
from app.services.errors import TTSError

logger = logging.getLogger(__name__)

CONTAINER = "text-reader-qwen"
VOLUME = "text-reader-qwen-models"
MODELS = {
    "design": "qwen-talker-1.7b-voicedesign-Q8_0.gguf",
    "clone": "qwen-talker-1.7b-base-Q8_0.gguf",
}
CODEC = "qwen-tokenizer-12hz-Q8_0.gguf"
MODEL_NAME = "qwen3-tts-1.7b"
SAMPLE_RATE = 24000
IDLE_SECONDS = 5 * 60
# Pause between paragraphs, which are generated one at a time.
PARAGRAPH_PAUSE = 0.35
# Qwen learns a voice from its whole sample (about 10 s), but longer clips
# need more GPU memory: a 10 s sample ran out of memory on a 4 GB GPU with a
# few other apps open, while its first 8 s worked. When that happens, Qwen
# is restarted and the voice loaded again from a shorter clip, trying these
# lengths in turn. Qwen can learn a voice from as little as 3 s, though very
# short clips capture it less faithfully.
SHORTER_REFERENCES = (8, 6, 4, 3)
# Below this, the voice may sound noticeably different, so the user is told.
FAITHFUL_REFERENCE_SECONDS = 6
# How long the "fixed" message stays up after recovering.
NOTICE_SECONDS = 15

# What a voice sample says. A plain narration sentence makes a sample that
# represents the voice well.
DESIGN_TEXT = (
    "The road wound slowly through the mountains. By the time the sun had set, "
    "the travelers had reached the village, tired but glad to be home at last."
)

_mode: str | None = None  # which model is running, if any
_registered: set[int] = set()  # custom voice ids the running server knows
_last_used = 0.0
# The longest sample, in seconds, that has loaded without running out of
# memory, or None to use whole samples. Only kept until the app restarts,
# since the GPU may be freer next time.
_reference_limit: float | None = None
# One request at a time: the server handles one anyway, and it stops a
# model swap from happening in the middle of a request.
_lock = asyncio.Lock()


def voice_path(voice_id: int) -> Path:
    return Path(settings.voices_dir) / f"{voice_id}.wav"


async def _docker(*args: str, timeout: float | None = None) -> tuple[int, str]:
    # Run in a thread with plain subprocess: on Windows, the event loop
    # uvicorn uses with --reload can't start subprocesses itself.
    command = asyncio.ensure_future(
        asyncio.to_thread(
            subprocess.run,
            ["docker", *args],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            errors="replace",
            timeout=timeout,
        )
    )
    try:
        # shield: being cancelled (e.g. the user cancelling generation) can't
        # stop a command that's already running, so wait for it to finish
        # first. Otherwise cleanup could run before it, e.g. removing the
        # container before "docker run" has created it.
        result = await asyncio.shield(command)
    except asyncio.CancelledError:
        await asyncio.wait([command])
        raise
    except FileNotFoundError:
        raise TTSError("Qwen needs Docker, which isn't installed.")
    except subprocess.TimeoutExpired:
        raise TTSError("Docker isn't responding. Try restarting Docker Desktop.")
    return result.returncode, result.stdout.strip()


async def unavailable_reason() -> str | None:
    """Why Qwen can't generate right now, or None if it can."""
    model_dir = Path(settings.qwen_model_dir)
    if not all((model_dir / name).is_file() for name in (*MODELS.values(), CODEC)):
        return f"Qwen's model files are missing from backend/{settings.qwen_model_dir}."
    try:
        # Asks the Docker engine for its version, which fails quickly if
        # Docker Desktop isn't running.
        code, output = await _docker("version", "--format", "{{.Server.Version}}", timeout=15)
        _check(code, output, "reach Docker")
    except TTSError as e:
        return str(e)
    return None


async def _stop() -> None:
    global _mode
    _mode = None
    _registered.clear()
    # rm -f also removes a container left over from a crash.
    await _docker("rm", "-f", CONTAINER, timeout=60)


class OutOfMemory(TTSError):
    pass


def _check(code: int, output: str, action: str) -> None:
    if code == 0:
        return
    if "docker daemon" in output.lower() or "docker api" in output.lower():
        raise TTSError("Docker Desktop isn't running. Start it to use Qwen voices.")
    raise TTSError(f"Could not {action}: {output.splitlines()[-1] if output else code}")


async def _ensure_models(names: list[str]) -> None:
    """Copy model files into a Docker volume the first time they're needed.

    The model keeps reading its files while generating, and reading them
    straight from a Windows folder is about 3x slower than from a volume,
    which lives inside Docker's own Linux system.
    """
    run = ["run", "--rm", "-v", f"{VOLUME}:/models", "--entrypoint"]
    code, output = await _docker(*run, "ls", settings.qwen_image, "/models")
    _check(code, output, "check the Qwen models")
    missing = [name for name in names if name not in output.split()]
    if not missing:
        return

    model_dir = Path(settings.qwen_model_dir).resolve()
    for name in missing:
        if not (model_dir / name).is_file():
            raise TTSError(f"Qwen model file {name} not found in backend/{settings.qwen_model_dir}.")
    logger.info("Copying Qwen models into Docker: %s", missing)
    sources = [f"/source/{name}" for name in missing]
    code, output = await _docker(
        *run[:-1], "-v", f"{model_dir}:/source:ro", "--entrypoint",
        "cp", settings.qwen_image, *sources, "/models/",
    )  # fmt: skip
    _check(code, output, "copy the Qwen models")


async def _start(mode: str) -> None:
    await _stop()
    try:
        await _start_container(mode)
    except asyncio.CancelledError:
        # Cancelled partway (e.g. the user cancelled generation): the
        # container may be starting, but the app hasn't recorded it as
        # running, so nothing would ever stop it. Remove it now; it starts
        # again when next needed.
        await _stop()
        raise


async def _start_container(mode: str) -> None:
    global _mode
    await _ensure_models([MODELS[mode], CODEC])

    logger.info("Starting Qwen (%s model)", mode)
    code, output = await _docker(
        "run", "-d", "--name", CONTAINER, "--gpus", "all",
        # Only reachable from this computer.
        "-p", f"127.0.0.1:{settings.qwen_port}:8080",
        "-v", f"{VOLUME}:/models:ro",
        "-e", f"MODEL_PATH=/models/{MODELS[mode]}",
        "-e", f"CODEC_PATH=/models/{CODEC}",
        "-e", "TTS_LANG=English",
        settings.qwen_image,
    )  # fmt: skip
    _check(code, output, "start Qwen")

    # Loading the model takes a few seconds; wait until the server answers.
    async with httpx.AsyncClient() as client:
        for _ in range(120):
            try:
                if (await client.get(f"{_url()}/health")).status_code == 200:
                    _mode = mode
                    return
            except httpx.TransportError:
                pass
            _, running = await _docker("inspect", "-f", "{{.State.Running}}", CONTAINER)
            if running != "true":
                _, logs = await _docker("logs", "--tail", "5", CONTAINER)
                logger.error("Qwen container stopped:\n%s", logs)
                await _stop()
                raise TTSError("Qwen stopped while starting (possibly not enough GPU memory).")
            await asyncio.sleep(1)
    await _stop()
    raise TTSError("Qwen took too long to start.")


def _url() -> str:
    return f"http://127.0.0.1:{settings.qwen_port}"


async def _post(path: str, body: dict) -> bytes:
    global _last_used
    try:
        async with httpx.AsyncClient(timeout=300) as client:
            response = await client.post(f"{_url()}{path}", json=body)
    except httpx.TransportError as e:
        # The container probably crashed. Its log says why, and is gone once
        # it's removed; the next request starts a new one.
        try:
            _, logs = await _docker("logs", "--tail", "40", CONTAINER)
        finally:
            # Even if cancelled while reading the log, so the app doesn't
            # think the crashed container is still running.
            await _stop()
        if "out of memory" in logs.lower():
            raise OutOfMemory(
                "Qwen ran out of GPU memory. Closing other apps that use the GPU "
                "(browsers, video players, games) and trying again usually helps."
            ) from e
        raise TTSError("Lost the connection to Qwen.") from e
    finally:
        _last_used = time.monotonic()
    if response.status_code != 200:
        raise TTSError(f"Qwen request failed: {response.text[:200]}")
    return response.content


async def _use(mode: str) -> None:
    if _mode != mode:
        await _start(mode)


async def design(description: str) -> bytes:
    """Return a WAV sample of a new voice matching the description. Each call
    makes a different voice, so the user can try again until they like one."""
    async with _lock:
        await _use("design")
        return await _post(
            "/v1/audio/speech",
            {
                "input": DESIGN_TEXT,
                "instructions": description,
                "language": "English",
                "response_format": "wav",
            },
        )


async def speak(
    text: str, voice_id: int, notify: Callable[[str, bool], None] | None = None
) -> tuple[np.ndarray, int]:
    """Read the text in a saved voice, one paragraph at a time.

    notify(message, done) is called if Qwen runs out of memory and has to be
    restarted: done=False while recovering, then done=True once it works.
    """
    async with _lock:
        await _use("clone")
        if voice_id not in _registered:
            await _register(voice_id, notify or (lambda message, done: None))

        pause = np.zeros(int(SAMPLE_RATE * PARAGRAPH_PAUSE), dtype=np.float32)
        pieces = []
        for paragraph in text.split("\n\n"):
            # Paragraphs like "…" have nothing to say, so they just get a pause.
            if re.search(r"\w", paragraph):
                wav = await _post(
                    "/v1/audio/speech",
                    {
                        "input": paragraph.strip(),
                        "voice": f"v{voice_id}",
                        "language": "English",
                        "response_format": "wav",
                        "seed": 42,
                    },
                )
                audio, _ = sf.read(io.BytesIO(wav), dtype="float32")
                pieces.append(audio)
            pieces.append(pause)
        return np.concatenate(pieces), SAMPLE_RATE


async def _register(voice_id: int, notify: Callable[[str, bool], None]) -> None:
    """Load a voice's sample into Qwen, from a shorter clip if it runs out of
    memory (see SHORTER_REFERENCES)."""
    global _reference_limit
    path = voice_path(voice_id)
    if not path.is_file():
        raise TTSError("The sample for this voice is missing.")
    audio, rate = sf.read(path, dtype="float32")
    full = len(audio) / rate
    recovered = False
    while True:
        seconds = min(full, _reference_limit or full)
        try:
            # Running out of memory crashes Qwen, which stops the container,
            # so start it again if needed.
            await _use("clone")
            # Without the sample's transcript the server keeps only a voice
            # "fingerprint", which is about twice as fast as copying the
            # sample closely and still keeps the voice consistent.
            await _post(
                "/v1/audio/voices",
                {"name": f"v{voice_id}", "wav_b64": _wav_b64(audio[: int(seconds * rate)], rate)},
            )
            break
        except OutOfMemory:
            shorter = next((s for s in SHORTER_REFERENCES if s < seconds), None)
            if shorter is None:
                # Trying again is meant for after closing other apps, so it
                # starts from the whole sample again.
                _reference_limit = None
                raise OutOfMemory(
                    f"Qwen ran out of GPU memory, even with a {seconds:g} s voice sample. "
                    "Close other apps that use the GPU (browsers, video players, games), "
                    "then try again."
                )
            logger.warning("Qwen ran out of memory with a %.1f s sample; trying %d s", seconds, shorter)
            _reference_limit = shorter
            recovered = True
            notify(
                f"Qwen ran out of GPU memory. Restarting it with a shorter voice sample ({shorter} s)…",
                False,
            )
    _registered.add(voice_id)

    if recovered:
        if seconds < FAITHFUL_REFERENCE_SECONDS:
            notify(
                f"Fixed. Qwen is using only {seconds:g} s of the voice sample, so the voice may "
                "sound slightly different. Closing other apps and restarting the app lets it "
                "use the full sample.",
                True,
            )
        else:
            notify(f"Fixed. Qwen is using {seconds:g} s of the voice sample on this computer.", True)


def _wav_b64(audio: np.ndarray, rate: int) -> str:
    buffer = io.BytesIO()
    sf.write(buffer, audio, rate, format="WAV", subtype="PCM_16")
    return base64.b64encode(buffer.getvalue()).decode()


async def stop_when_idle() -> None:
    """Runs for the life of the app, stopping Qwen once it's been idle a while."""
    while True:
        await asyncio.sleep(30)
        if _mode and not _lock.locked() and time.monotonic() - _last_used > IDLE_SECONDS:
            async with _lock:
                if _mode and time.monotonic() - _last_used > IDLE_SECONDS:
                    logger.info("Stopping Qwen after %d idle seconds", IDLE_SECONDS)
                    await _stop()


async def remove_container() -> None:
    """Remove the Qwen container when the app starts and shuts down, even if
    the app doesn't think one is running (e.g. one left over after the app
    was force-closed), so it can't hold GPU memory unnoticed."""
    try:
        await _stop()
    except TTSError:
        pass  # Docker isn't installed or isn't responding, so there's no container
