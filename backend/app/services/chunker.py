import hashlib
import re
from dataclasses import dataclass

# OpenAI TTS accepts 4096 characters per request, but gpt-4o-mini-tts often
# cuts audio short on long inputs. Smaller chunks also start playing sooner.
MAX_CHARS = 1500
# The first chunk is kept short so its audio is ready soon. Each following
# chunk may be a little longer (up to MAX_CHARS). Growth is gentle because
# the next chunk has to finish generating while the current one plays: Qwen
# generates at about 0.75x real time, so a chunk 1.25x as long takes about
# as long to make as the current one takes to play.
FIRST_MAX_CHARS = 300
GROWTH = 1.25

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


def _limit(chunk_index: int) -> int:
    return min(MAX_CHARS, int(FIRST_MAX_CHARS * GROWTH**chunk_index))


def _split_long(paragraph: str, limit: int) -> list[str]:
    pieces: list[str] = []
    current = ""
    for sentence in _SENTENCE_SPLIT.split(paragraph):
        while len(sentence) > limit:
            cut = sentence.rfind(" ", 0, limit)
            cut = cut if cut > 0 else limit
            if current:
                pieces.append(current)
                current = ""
            pieces.append(sentence[:cut])
            sentence = sentence[cut:].lstrip()
        if current and len(current) + 1 + len(sentence) > limit:
            pieces.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    if current:
        pieces.append(current)
    return pieces


def paragraph_words(text: str) -> list[list[str]]:
    """Splits a chunk into paragraphs of words.

    This is the one definition of what a "word" is. Word timings are stored
    per word in this order, and the frontend displays these same words, so
    the two always line up.
    """
    return [paragraph.split() for paragraph in text.split("\n\n")]


def split_paragraphs(text: str) -> list[str]:
    """The text's paragraphs: each line, without blank ones."""
    return [p.strip() for p in re.split(r"\n+", text) if p.strip()]


@dataclass
class Packed:
    """One chunk's text, and which paragraphs it holds (by index). A long
    paragraph can be split over several chunks, so a chunk may start or end
    partway through one."""

    text: str
    first: int
    last: int
    starts_paragraph: bool = True
    ends_paragraph: bool = True


def pack(paragraphs: list[str], first_index: int = 0) -> list[Packed]:
    """Groups paragraphs into chunks. first_index is the first chunk's index
    in the document, which sets how long each may be (see _limit)."""
    chunks: list[Packed] = []
    current: Packed | None = None
    for p, paragraph in enumerate(paragraphs):
        limit = _limit(first_index + len(chunks))
        parts = [paragraph] if len(paragraph) <= limit else _split_long(paragraph, limit)
        for i, part in enumerate(parts):
            if current and len(current.text) + 2 + len(part) > _limit(
                first_index + len(chunks)
            ):
                chunks.append(current)
                current = None
            if current:
                current.text = f"{current.text}\n\n{part}"
                current.last = p
            else:
                current = Packed(part, p, p, starts_paragraph=i == 0)
            current.ends_paragraph = i == len(parts) - 1
    if current:
        chunks.append(current)
    return chunks


def text_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def chunk_rows(packed: list[Packed], first_index: int = 0) -> list[dict]:
    """The chunks as the Chunk table's columns."""
    return [
        {
            "index": first_index + i,
            "text": c.text,
            "text_hash": text_hash(c.text),
            "char_count": len(c.text),
        }
        for i, c in enumerate(packed)
    ]


def chunk_text(text: str) -> list[dict]:
    return chunk_rows(pack(split_paragraphs(text)))
