"""Downloads the voice model files, skipping any already there.

    python -m app.download_models          Kokoro's (about 350 MB)
    python -m app.download_models qwen     Kokoro's and Qwen's (about 2.4 GB more)

Docker runs the first on every start, so the free voices work straight away.
Whisper's model downloads itself the first time audio is made.
"""

import sys
from pathlib import Path

import httpx

from app.config import settings

KOKORO_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
QWEN_URL = "https://huggingface.co/Serveurperso/Qwen3-TTS-GGUF/resolve/main"

KOKORO = [f"{KOKORO_URL}/kokoro-v1.0.onnx", f"{KOKORO_URL}/voices-v1.0.bin"]
QWEN = [
    f"{QWEN_URL}/qwen-talker-1.7b-voicedesign-Q8_0.gguf",
    f"{QWEN_URL}/qwen-talker-1.7b-base-Q8_0.gguf",
    f"{QWEN_URL}/qwen-tokenizer-12hz-Q8_0.gguf",
]


def download(url: str, folder: Path) -> None:
    path = folder / url.rsplit("/", 1)[1]
    if path.is_file():
        return
    folder.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {path.name}...", flush=True)
    # Written under another name first, so a download that stops partway
    # isn't mistaken for a whole file next time.
    partial = path.with_name(path.name + ".part")
    with httpx.stream("GET", url, follow_redirects=True, timeout=60) as response:
        response.raise_for_status()
        with partial.open("wb") as file:
            for part in response.iter_bytes():
                file.write(part)
    partial.replace(path)


def main(args: list[str]) -> None:
    for url in KOKORO:
        download(url, Path(settings.kokoro_model_dir))
    if "qwen" in args:
        for url in QWEN:
            download(url, Path(settings.qwen_model_dir))


if __name__ == "__main__":
    main(sys.argv[1:])
