"""Splitting a document's text into chunks (sections), which grow in size so
the first one is ready to play quickly."""

import random

from app.services.chunker import (
    FIRST_MAX_CHARS,
    MAX_CHARS,
    _limit,
    chunk_text,
    pack,
    paragraph_words,
    split_paragraphs,
    text_hash,
)


def sentence(n: int) -> str:
    return f"This is sentence number {n}, which has a few words in it."


def paragraph(start: int, sentences: int) -> str:
    return " ".join(sentence(n) for n in range(start, start + sentences))


def words(texts: list[str]) -> list[str]:
    return " ".join(texts).split()


def test_chunk_limits_grow_from_300_up_to_the_maximum():
    assert _limit(0) == FIRST_MAX_CHARS == 300
    assert _limit(1) == 375
    assert all(_limit(i) <= _limit(i + 1) for i in range(30))
    assert _limit(50) == MAX_CHARS == 1500


def test_paragraphs_are_lines_and_blank_lines_are_ignored():
    assert split_paragraphs("One.\n\n\nTwo.\n  Three.  \n\n") == ["One.", "Two.", "Three."]


def test_short_text_is_one_chunk_with_paragraphs_separated_by_a_blank_line():
    rows = chunk_text("Hello there.\nGeneral Kenobi.")
    assert len(rows) == 1
    assert rows[0]["index"] == 0
    assert rows[0]["text"] == "Hello there.\n\nGeneral Kenobi."
    assert rows[0]["char_count"] == len(rows[0]["text"])
    assert rows[0]["text_hash"] == text_hash(rows[0]["text"])


def test_no_chunk_is_longer_than_its_limit():
    text = "\n".join(paragraph(i * 10, random.Random(i).randint(1, 12)) for i in range(40))
    for row in chunk_text(text):
        assert row["char_count"] <= _limit(row["index"])


def test_every_word_is_kept_in_order():
    text = "\n".join(paragraph(i * 10, 1 + i % 9) for i in range(30))
    assert words([row["text"] for row in chunk_text(text)]) == text.split()


def test_a_paragraph_too_long_for_one_chunk_is_split_between_sentences():
    long = paragraph(0, 30)  # about 1,800 characters
    packed = pack([long])
    assert len(packed) > 1
    for piece in packed:
        assert piece.text.endswith(".")
    assert [(p.starts_paragraph, p.ends_paragraph) for p in (packed[0], packed[-1])] == [
        (True, False),
        (False, True),
    ]


def test_a_sentence_longer_than_a_chunk_is_split_between_words():
    no_full_stops = " ".join(["word"] * 200)  # 999 characters, one "sentence"
    packed = pack([no_full_stops])
    assert all(len(p.text) <= _limit(i) for i, p in enumerate(packed))
    assert words([p.text for p in packed]) == no_full_stops.split()


def test_packed_chunks_record_which_paragraphs_they_hold():
    packed = pack(["Short one.", "Short two.", paragraph(0, 8)])
    assert (packed[0].first, packed[0].last) == (0, 1)
    assert packed[-1].last == 2


def test_paragraph_words_splits_a_chunk_back_into_paragraphs():
    assert paragraph_words("Hello there.\n\nGeneral  Kenobi.") == [
        ["Hello", "there."],
        ["General", "Kenobi."],
    ]


def test_chunking_is_the_same_every_time():
    text = "\n".join(paragraph(i, 5) for i in range(20))
    assert chunk_text(text) == chunk_text(text)
