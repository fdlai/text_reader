from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, computed_field

from app.services.chunker import paragraph_words


class DocumentCreate(BaseModel):
    url: HttpUrl


class ChunkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    index: int
    char_count: int
    # Read from the database but not sent; the words below are sent instead.
    text: str = Field(exclude=True)

    # Sent already split into words, so the frontend displays exactly the
    # words the word timings refer to.
    @computed_field
    @property
    def paragraphs(self) -> list[list[str]]:
        return paragraph_words(self.text)


class DocumentSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    source_url: str
    created_at: datetime


# A Library entry: the document plus how far through it listening is.
class LibraryItem(DocumentSummary):
    finished: bool
    fraction: float  # 0 to 1, how much has been listened to
    seconds_left: float  # an estimate at normal speed


class DocumentDetail(DocumentSummary):
    chunks: list[ChunkOut]


class PronunciationIn(BaseModel):
    word: str = Field(min_length=1, max_length=100)
    sounds_like: str = Field(min_length=1, max_length=200)
    enabled: bool = True


class PronunciationOut(PronunciationIn):
    model_config = ConfigDict(from_attributes=True)

    id: int


class Preferences(BaseModel):
    # Saved settings missing a newer field get its default here, and fields
    # that no longer exist are ignored.
    theme: Literal["auto", "light", "dark", "paper"] = "auto"
    font: Literal["sans", "serif", "book", "verdana"] = "sans"
    font_size: int = Field(default=18, ge=12, le=60)
    align: Literal["left", "justify"] = "left"
    page_width: Literal["normal", "wide", "full"] = "normal"
    highlight_words: bool = True
    highlight_color: Literal["yellow", "green", "blue", "pink"] = "yellow"
    # Voice preset ids, most recently picked first. The first one is the
    # voice the Reader starts with.
    recent_voices: list[int] = Field(default_factory=list, max_length=10)


class Progress(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    chunk_index: int = Field(ge=0)
    offset_sec: float = Field(ge=0)
    finished: bool = False
