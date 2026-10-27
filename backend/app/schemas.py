from datetime import datetime

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


class DocumentDetail(DocumentSummary):
    chunks: list[ChunkOut]


class PronunciationIn(BaseModel):
    word: str = Field(min_length=1, max_length=100)
    sounds_like: str = Field(min_length=1, max_length=200)
    enabled: bool = True


class PronunciationOut(PronunciationIn):
    model_config = ConfigDict(from_attributes=True)

    id: int


class Progress(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    chunk_index: int = Field(ge=0)
    offset_sec: float = Field(ge=0)
