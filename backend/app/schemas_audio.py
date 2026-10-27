from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.services.tts import VOICES

Engine = Literal["kokoro", "openai"]


class VoiceSettings(BaseModel):
    engine: Engine = "openai"
    base_voice: str
    instructions: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def check_voice(self):
        if self.base_voice not in VOICES[self.engine]:
            raise ValueError(f"Unknown {self.engine} voice: {self.base_voice}")
        # Kokoro has no style prompt, so instructions would be silently ignored.
        if self.engine == "kokoro":
            self.instructions = ""
        return self


class VoicePresetIn(VoiceSettings):
    name: str = Field(min_length=1, max_length=100)
    speed: float = Field(default=1.0, ge=0.5, le=3.0)


class VoicePresetOut(VoicePresetIn):
    model_config = ConfigDict(from_attributes=True)

    id: int


class VoicePreviewIn(VoiceSettings):
    text: str = Field(min_length=1, max_length=500)


class GenerateIn(BaseModel):
    voice_preset_id: int


class ChunkAudioStatus(BaseModel):
    chunk_id: int
    index: int
    ready: bool
    # Changes whenever the audio is regenerated, so the player can tell new
    # audio from old even though the chunk and voice are the same.
    audio_id: int | None
    duration_sec: float | None
    word_times: list[float] | None
    # Made with different pronunciations than the current ones.
    outdated: bool


class GenerationStatus(BaseModel):
    generating: bool
    error: str | None
    chunks: list[ChunkAudioStatus]
