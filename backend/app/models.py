from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    source_url: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(String(500))
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    chunks: Mapped[list["Chunk"]] = relationship(
        back_populates="document", cascade="all, delete-orphan", order_by="Chunk.index"
    )
    progress: Mapped["PlaybackProgress | None"] = relationship(
        back_populates="document", cascade="all, delete-orphan", uselist=False
    )


class Chunk(Base):
    __tablename__ = "chunks"
    __table_args__ = (UniqueConstraint("document_id", "index"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE")
    )
    index: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    text_hash: Mapped[str] = mapped_column(String(64), index=True)
    char_count: Mapped[int] = mapped_column(Integer)

    document: Mapped[Document] = relationship(back_populates="chunks")
    audio_files: Mapped[list["AudioFile"]] = relationship(
        back_populates="chunk", cascade="all, delete-orphan"
    )


class VoicePreset(Base):
    __tablename__ = "voice_presets"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    engine: Mapped[str] = mapped_column(String(20), server_default="openai")
    base_voice: Mapped[str] = mapped_column(String(50))
    instructions: Mapped[str] = mapped_column(Text, default="")
    speed: Mapped[float] = mapped_column(Float, default=1.0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class CustomVoice(Base):
    """A voice designed from a description. Its sample clip is stored at
    storage/voices/{id}.wav, and Qwen reads text in the voice of that clip."""

    __tablename__ = "custom_voices"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class AudioFile(Base):
    __tablename__ = "audio_files"
    __table_args__ = (UniqueConstraint("chunk_id", "voice_preset_id", "model"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    chunk_id: Mapped[int] = mapped_column(ForeignKey("chunks.id", ondelete="CASCADE"))
    voice_preset_id: Mapped[int] = mapped_column(ForeignKey("voice_presets.id"))
    model: Mapped[str] = mapped_column(String(50))
    file_path: Mapped[str] = mapped_column(Text)
    duration_sec: Mapped[float | None] = mapped_column(Float)
    # Start time in seconds of each word of the chunk's text, in the order
    # given by chunker.paragraph_words(), or None if they couldn't be worked out.
    word_times: Mapped[list[float] | None] = mapped_column(JSON(none_as_null=True))
    # The pronunciation entries used when this audio was made, as
    # {key: sounds_like}. Compared with the current entries to tell whether
    # the audio is outdated. None for audio made before pronunciations existed.
    pronunciations: Mapped[dict[str, str] | None] = mapped_column(
        JSON(none_as_null=True)
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    chunk: Mapped[Chunk] = relationship(back_populates="audio_files")
    voice_preset: Mapped[VoicePreset] = relationship()


class Pronunciation(Base):
    __tablename__ = "pronunciations"

    id: Mapped[int] = mapped_column(primary_key=True)
    word: Mapped[str] = mapped_column(String(100))
    # The word normalized for matching ("Chung Myung" -> "chung myung"), so
    # the same word can't be added twice with different capitalization.
    key: Mapped[str] = mapped_column(String(100), unique=True)
    sounds_like: Mapped[str] = mapped_column(String(200))
    enabled: Mapped[bool] = mapped_column(Boolean, server_default="true")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Preference(Base):
    """The user's settings (theme, font, ...) as one JSON object.

    There's a single row for now. With user accounts, each user would get
    their own row. Defaults live in schemas.Preferences, so adding a
    setting needs no migration.
    """

    __tablename__ = "preferences"

    id: Mapped[int] = mapped_column(primary_key=True)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class PlaybackProgress(Base):
    __tablename__ = "playback_progress"

    document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True
    )
    chunk_index: Mapped[int] = mapped_column(Integer, default=0)
    offset_sec: Mapped[float] = mapped_column(Float, default=0.0)
    # True once the end was reached. Cleared when listening starts again.
    finished: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    document: Mapped[Document] = relationship(back_populates="progress")
