import hashlib
import re

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


def chunk_text(text: str) -> list[dict]:
    paragraphs = [p.strip() for p in re.split(r"\n+", text) if p.strip()]

    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        limit = _limit(len(chunks))
        parts = [paragraph] if len(paragraph) <= limit else _split_long(paragraph, limit)
        for part in parts:
            if current and len(current) + 2 + len(part) > _limit(len(chunks)):
                chunks.append(current)
                current = part
            else:
                current = f"{current}\n\n{part}" if current else part
    if current:
        chunks.append(current)

    return [
        {
            "index": i,
            "text": c,
            "text_hash": hashlib.sha256(c.encode("utf-8")).hexdigest(),
            "char_count": len(c),
        }
        for i, c in enumerate(chunks)
    ]
