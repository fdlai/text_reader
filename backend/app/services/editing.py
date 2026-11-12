"""Working out which chunks an edit changed, so the rest keep their audio.

Splitting the new text from scratch would change more chunks than were
edited: chunk sizes depend on their position, so one added sentence can move
every boundary after it. Instead, the chunks at the start and end whose
paragraphs weren't touched are kept as they are, and only the paragraphs
between them are split into new chunks.
"""

from dataclasses import dataclass

from app.services.chunker import Packed, pack, split_paragraphs, text_hash


@dataclass
class EditPlan:
    # How many of the old chunks to keep at the start, and at the end.
    keep_front: int
    keep_back: int
    # The chunks replacing the old ones between those, in order.
    middle: list[Packed]


def plan_edit(old_text: str, old_hashes: list[str], new_text: str) -> EditPlan:
    old = split_paragraphs(old_text)
    new = split_paragraphs(new_text)
    old_chunks = pack(old)
    # Chunks made by an older version of the chunker can't be matched to
    # paragraphs this way, so all of them are replaced.
    if [text_hash(c.text) for c in old_chunks] != old_hashes:
        return EditPlan(0, 0, pack(new))

    # How many paragraphs are the same at the start, then at the end (not
    # counting any already matched at the start).
    same_front = 0
    while same_front < min(len(old), len(new)) and old[same_front] == new[same_front]:
        same_front += 1
    same_back = 0
    while (
        same_back < min(len(old), len(new)) - same_front
        and old[-1 - same_back] == new[-1 - same_back]
    ):
        same_back += 1

    # The chunks made only of unchanged paragraphs. Kept runs must end (at
    # the start) or begin (at the end) at a paragraph break, since the new
    # chunks between them are made from whole paragraphs.
    keep_front = 0
    for i, chunk in enumerate(old_chunks):
        if chunk.last >= same_front:
            break
        if chunk.ends_paragraph:
            keep_front = i + 1
    keep_back = 0
    for i in range(len(old_chunks) - 1, keep_front - 1, -1):
        chunk = old_chunks[i]
        if chunk.first < len(old) - same_back:
            break
        if chunk.starts_paragraph:
            keep_back = len(old_chunks) - i

    # The paragraphs between the kept chunks, in the new text.
    start = old_chunks[keep_front - 1].last + 1 if keep_front else 0
    end = (
        len(new) - (len(old) - old_chunks[-keep_back].first) if keep_back else len(new)
    )
    return EditPlan(keep_front, keep_back, pack(new[start:end], first_index=keep_front))


def only_removed(old_texts: list[str], new_texts: list[str]) -> bool:
    """True if the new text is the old text with some words taken out (or
    exactly the same), so there's nothing new in it to hear."""
    old_words = iter(" ".join(old_texts).split())
    # Each new word is looked for further along the old words, in order.
    return all(word in old_words for word in " ".join(new_texts).split())
