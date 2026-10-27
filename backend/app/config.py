from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    openai_api_key: str = ""
    tts_model: str = "gpt-4o-mini-tts"
    kokoro_model_dir: str = "models/kokoro"
    whisper_model: str = "base.en"
    whisper_model_dir: str = "models/whisper"
    audio_dir: str = "storage/audio"
    cors_origins: list[str] = ["http://localhost:5173"]


settings = Settings()
