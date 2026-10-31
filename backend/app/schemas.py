from datetime import datetime
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    HttpUrl,
    StringConstraints,
    computed_field,
)

from app.services.chunker import paragraph_words


class CollectionCreate(BaseModel):
    name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
    ]


class CollectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


# Enough of a document to show its cover (or a placeholder for it).
class CoverItem(BaseModel):
    id: int
    title: str
    has_cover: bool


# A collection's card on the home page. id None is Unsorted.
class CollectionSummary(BaseModel):
    id: int | None
    name: str
    document_count: int
    # Started but not finished.
    in_progress_count: int
    # Its newest documents, newest first, drawn as a stack of books.
    stack: list[CoverItem]


class DocumentIds(BaseModel):
    document_ids: list[int] = Field(min_length=1, max_length=1000)


class DocumentsMove(DocumentIds):
    collection_id: int


class DocumentCreate(BaseModel):
    url: HttpUrl
    # None (e.g. from an older page) puts it in Unsorted.
    collection_id: int | None = None


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
    has_cover: bool
    finished: bool
    fraction: float  # 0 to 1, how much has been listened to
    seconds_left: float  # an estimate at normal speed


class DocumentDetail(DocumentSummary):
    chunks: list[ChunkOut]
    collection_id: int | None
    # None when it's Unsorted.
    collection_name: str | None = None
    next_url: str | None
    # The next part's id if it's already in the Library, so it can be opened
    # instead of added again.
    next_document_id: int | None = None


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
    # The keys of FONTS in frontend/src/context/preferences.js.
    font: Literal[
        "sans", "serif", "book", "verdana",
        "literata", "merriweather", "source_serif", "garamond", "lora",
        "inter", "atkinson", "lexend", "nunito",
        "opendyslexic", "ia_writer",
    ] = "sans"
    font_size: int = Field(default=18, ge=12, le=60)
    align: Literal["left", "justify"] = "left"
    # Split long words with a hyphen at the end of a line.
    hyphenate: bool = False
    page_width: Literal["normal", "wide", "full"] = "normal"
    highlight_words: bool = True
    # The keys of HIGHLIGHT_COLORS in frontend/src/context/preferences.js.
    highlight_color: Literal[
        "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"
    ] = "yellow"
    # Voice preset ids, most recently picked first. The first one is the
    # voice the Reader starts with.
    recent_voices: list[int] = Field(default_factory=list, max_length=10)


class Progress(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    chunk_index: int = Field(ge=0)
    offset_sec: float = Field(ge=0)
    finished: bool = False
