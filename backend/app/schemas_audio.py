from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.services.tts import VOICES

Engine = Literal["kokoro", "openai", "qwen"]


class VoiceSettings(BaseModel):
    engine: Engine = "openai"
    # For qwen, the id of one of the user's saved voices (a CustomVoice).
    base_voice: str
    instructions: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def check_voice(self):
        # Saved Qwen voices live in the database, so routes check they exist.
        if self.engine == "qwen":
            if not self.base_voice.isdigit():
                raise ValueError(f"Unknown qwen voice: {self.base_voice}")
        elif self.base_voice not in VOICES[self.engine]:
            raise ValueError(f"Unknown {self.engine} voice: {self.base_voice}")
        # Only OpenAI has a style prompt; elsewhere it would be silently ignored.
        if self.engine != "openai":
            self.instructions = ""
        return self


# Playback speed multiplier, shared by the preset form and the player.
Speed = Annotated[float, Field(ge=0.5, le=3.0)]


class VoicePresetIn(VoiceSettings):
    name: str = Field(min_length=1, max_length=100)
    speed: Speed = 1.0


class VoicePresetSave(VoicePresetIn):
    # Optional: a preview clip (MP3, base64) of this voice reading the
    # standard sample text, kept as its sample so previewing it later is free.
    sample_b64: str | None = Field(default=None, max_length=2_000_000)


class NameIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class SpeedIn(BaseModel):
    speed: Speed


class VoicePresetOut(VoicePresetIn):
    model_config = ConfigDict(from_attributes=True)

    id: int


class VoicePreviewIn(VoiceSettings):
    # Leave out to read the standard sample text (the one voice samples use).
    text: str | None = Field(default=None, min_length=1, max_length=500)


class VoiceDesignIn(BaseModel):
    description: str = Field(min_length=1, max_length=1000)


class CustomVoiceIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=1000)
    # The sample clip (a WAV file) chosen on the Create page, base64-encoded.
    sample_b64: str = Field(max_length=5_000_000)


class CustomVoiceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str


class GenerateIn(BaseModel):
    voice_preset_id: int
    # Put the job at the front of the queue, e.g. because it's being listened to.
    front: bool = False


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
    # True while queued or being generated.
    generating: bool
    # Jobs ahead of this one in the queue (0 = next or in progress).
    queue_position: int | None
    error: str | None
    chunks: list[ChunkAudioStatus]
