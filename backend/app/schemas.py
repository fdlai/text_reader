from datetime import datetime
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    HttpUrl,
    StringConstraints,
    computed_field,
    field_validator,
    model_validator,
)

from app.services.chunker import paragraph_words
from app.services.paragraph_audio import DEFAULT_PAUSE, MAX_PAUSE


class CollectionCreate(BaseModel):
    name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
    ]


class CollectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


# A collection's page: also how many documents it has in all, which its
# (paged) list doesn't show.
class CollectionDetail(CollectionOut):
    document_count: int


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


# The most items one page of a list can ask for.
MAX_PAGE_SIZE = 100


# One page of the home page's collections; total counts every page.
class CollectionPage(BaseModel):
    items: list[CollectionSummary]
    total: int


class DocumentIds(BaseModel):
    document_ids: list[int] = Field(min_length=1, max_length=1000)


class DocumentsMove(DocumentIds):
    collection_id: int


class DocumentCreate(BaseModel):
    url: HttpUrl
    # None (e.g. from an older page) puts it in Unsorted.
    collection_id: int | None = None


# The most text one document can have: about a long novel. More is better
# split into several documents.
MAX_TEXT_CHARS = 500_000


# A document's title and full text, for editing.
class DocumentText(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    title: str
    text: str


# A document's new title and text.
class DocumentTextUpdate(BaseModel):
    # Left empty, the start of the text is used.
    title: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] = ""
    text: Annotated[str, StringConstraints(strip_whitespace=True)]


# Text typed or pasted in, rather than downloaded from a page.
class DocumentTextCreate(DocumentTextUpdate):
    # None puts it in Unsorted.
    collection_id: int | None = None


# What an edit changed: how many chunks are new (and need audio) and the
# index of the first, or None if none are (nothing changed, or something
# was only deleted).
class DocumentTextUpdated(BaseModel):
    changed: int
    first_changed: int | None


class DocumentCover(BaseModel):
    # None removes the cover.
    image_url: HttpUrl | None
    # Also use it for every other document in the same collection.
    whole_collection: bool = False


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
    # None for text typed or pasted in.
    source_url: str | None
    created_at: datetime


# A Library entry: the document plus how far through it listening is.
class LibraryItem(DocumentSummary):
    has_cover: bool
    finished: bool
    fraction: float  # 0 to 1, how much has been listened to
    seconds_left: float  # an estimate at normal speed


# One page of a collection's documents; total counts every page. counts:
# how many there are with each progress ("all", "not-started", ...), for the
# filter tabs.
class LibraryPage(BaseModel):
    items: list[LibraryItem]
    total: int
    counts: dict[str, int]


class DocumentDetail(DocumentSummary):
    chunks: list[ChunkOut]
    collection_id: int | None
    # None when it's Unsorted.
    collection_name: str | None = None
    next_url: str | None
    # The next part's id if it's already in the Library, so it can be opened
    # instead of added again.
    next_document_id: int | None = None
    # The voice to open it with: the one it was last played or generated
    # with, else the one with the most audio for it. None for neither.
    voice_preset_id: int | None = None
    has_cover: bool = False


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
    # The space between paragraphs, in em (so it grows with the font size),
    # in steps of 0.25. See PARAGRAPH_SPACING in
    # frontend/src/context/preferences.js.
    paragraph_spacing: float = Field(default=1.0, ge=0, le=3)
    page_width: Literal["normal", "wide", "full"] = "normal"
    highlight_words: bool = True
    # The keys of HIGHLIGHT_COLORS in frontend/src/context/preferences.js.
    highlight_color: Literal[
        "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"
    ] = "yellow"
    # How the page scrolls to follow the reading: the keys of SCROLL_STYLES
    # and SCROLL_SPEEDS in frontend/src/context/preferences.js.
    scroll_style: Literal["pages", "steps"] = "pages"
    scroll_speed: Literal["instant", "quick", "gentle", "slow"] = "gentle"
    # Seconds Kokoro and Qwen voices pause after each paragraph.
    paragraph_pause: float = Field(default=DEFAULT_PAUSE, ge=0, le=MAX_PAUSE)
    # Voice preset ids, most recently picked first, for the voice menu.
    recent_voices: list[int] = Field(default_factory=list, max_length=10)
    # The voice preset new articles start with. (Articles that have been
    # played or generated open with their own voice.)
    default_voice: int | None = None

    @model_validator(mode="after")
    def first_default_voice(self):
        # Saved before there was a default voice: it starts as the most
        # recently picked one, which is what new articles used to start with.
        if self.default_voice is None and self.recent_voices:
            self.default_voice = self.recent_voices[0]
        return self

    @field_validator("paragraph_spacing", mode="before")
    @classmethod
    def spacing_em(cls, value):
        # Saved before the slider existed, as the name of a preset.
        value = {"compact": 0.5, "normal": 1.0, "wide": 2.0}.get(value, value)
        return round(float(value) * 4) / 4

    @field_validator("paragraph_pause", mode="before")
    @classmethod
    def pause_seconds(cls, value):
        # Saved before the slider existed, as the name of a preset.
        value = {"off": 0.0, "short": 0.35, "medium": 0.7, "long": 1.0}.get(value, value)
        # In steps of 0.05 s, like the slider, so a value saved now equals
        # the one recorded with audio made earlier at the same setting.
        return round(float(value) * 20) / 20


class DocumentVoice(BaseModel):
    voice_preset_id: int


class Progress(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    chunk_index: int = Field(ge=0)
    offset_sec: float = Field(ge=0)
    finished: bool = False
