from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    openai_api_key: str = ""
    tts_model: str = "gpt-4o-mini-tts"
    kokoro_model_dir: str = "models/kokoro"
    whisper_model: str = "base.en"
    whisper_model_dir: str = "models/whisper"
    qwen_model_dir: str = "models/qwen"
    qwen_image: str = "ghcr.io/serveurpersocom/qwentts.cpp:cuda12"
    qwen_port: int = 8091
    # Running in Docker: the Docker network Qwen's container joins, so this
    # app reaches it by name there. Empty: Qwen is reached on this computer
    # at qwen_port (running without Docker).
    qwen_network: str = ""
    audio_dir: str = "storage/audio"
    voices_dir: str = "storage/voices"
    samples_dir: str = "storage/samples"
    covers_dir: str = "storage/covers"
    cors_origins: list[str] = ["http://localhost:5173"]
    # The built frontend (npm run build), served by this app when set, as in
    # Docker. Empty: the frontend runs on its own (npm run dev).
    frontend_dir: str = ""


settings = Settings()
