"""Applies the user's pronunciation entries to text before it is spoken.

Entries map a word or phrase to a respelling ("Chung Myung" -> "Chung Myoong").
Only the text sent to the voice engine is changed; the stored text, and so
what the reader displays, is never touched.

Lookup walks the text's words once and checks each word (and each phrase of
up to the longest entry's length) in a dict. A dict lookup takes the same
time however many entries there are, so a large dictionary doesn't slow
down reading articles that don't use it.
"""

import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Pronunciation

# Splits a token into (leading punctuation, the word, trailing punctuation),
# e.g. '"Myung!' -> ('"', 'Myung', '!').
_PARTS = re.compile(r"^(\W*)(.*?)(\W*)$", re.S)
_POSSESSIVE = re.compile(r"['’]s$", re.I)


def _parts(token: str) -> tuple[str, str, str]:
    return _PARTS.match(token).groups()


def normalize(phrase: str) -> str:
    """The form entries are stored and matched by: lowercase words, no punctuation."""
    words = (_parts(token)[1].lower() for token in phrase.split())
    return " ".join(word for word in words if word)


class Lexicon:
    def __init__(self, entries: dict[str, str]):
        """entries: {normalized word: sounds like}"""
        self.entries = entries
        self.max_words = max((key.count(" ") + 1 for key in entries), default=0)

    def apply(self, text: str) -> tuple[str, dict[str, str]]:
        """Returns the text with entries swapped in, and the entries that were used."""
        if not self.entries:
            return text, {}

        # Each token: (start, end, leading punctuation, word, trailing punctuation)
        tokens = [
            (m.start(), m.end(), *_parts(m.group()))
            for m in re.finditer(r"\S+", text)
        ]
        pieces: list[str] = []
        used: dict[str, str] = {}
        copied_up_to = 0
        i = 0
        while i < len(tokens):
            match = self._match(text, tokens, i)
            if match is None:
                i += 1
                continue
            length, key, possessive = match
            start, _, lead, _, _ = tokens[i]
            _, end, _, _, trail = tokens[i + length - 1]
            # Keep everything around the match (spaces, line breaks, quotes).
            pieces.append(text[copied_up_to:start])
            pieces.append(f"{lead}{self.entries[key]}{possessive}{trail}")
            used[key] = self.entries[key]
            copied_up_to = end
            i += length
        pieces.append(text[copied_up_to:])
        return "".join(pieces), used

    def _match(
        self, text: str, tokens: list[tuple], i: int
    ) -> tuple[int, str, str] | None:
        """Finds the longest entry starting at token i: (length, key, possessive)."""
        for length in range(min(self.max_words, len(tokens) - i), 0, -1):
            group = tokens[i : i + length]
            # Punctuation between the words ("Chung, Myung") or a line break
            # breaks a phrase.
            if any(t[4] for t in group[:-1]) or any(t[2] for t in group[1:]):
                continue
            gaps = (text[a[1] : b[0]] for a, b in zip(group, group[1:]))
            if any("\n" in gap for gap in gaps):
                continue
            words = [t[3].lower() for t in group]
            key = " ".join(words)
            if key in self.entries:
                return length, key, ""
            # "Chung Myung's" uses the "Chung Myung" entry and keeps the 's.
            possessive = _POSSESSIVE.search(words[-1])
            if possessive:
                key = " ".join(words[:-1] + [words[-1][: possessive.start()]])
                if key in self.entries:
                    original = group[-1][3]
                    return length, key, original[possessive.start() :]
        return None


# Entries change rarely but are needed on every status check and generation
# job, so the built Lexicon is kept in memory and reused. It is cleared
# whenever an entry changes, and rebuilt on the next use.
_cached: Lexicon | None = None
# Goes up on every clear. A build only stores its result if no clear
# happened while it was reading the database, so a change saved mid-build
# can't be overwritten by the old entries.
_version = 0


async def load_lexicon(session: AsyncSession) -> Lexicon:
    global _cached
    if _cached is not None:
        return _cached
    version = _version
    rows = await session.scalars(
        select(Pronunciation).where(Pronunciation.enabled.is_(True))
    )
    lexicon = Lexicon({row.key: row.sounds_like for row in rows})
    if version == _version:
        _cached = lexicon
    return lexicon


def clear_lexicon_cache() -> None:
    """Call after any change to the pronunciation entries."""
    global _cached, _version
    _cached = None
    _version += 1
