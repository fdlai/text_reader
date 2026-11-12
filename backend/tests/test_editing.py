"""Working out which chunks an edit changed, so the others keep their audio."""

import random

from app.services.chunker import pack, split_paragraphs, text_hash
from app.services.editing import only_removed, plan_edit


def make_text(paragraphs: int, seed: int = 0) -> str:
    rng = random.Random(seed)
    return "\n".join(
        " ".join(f"Paragraph {p} sentence {s} goes here." for s in range(rng.randint(1, 10)))
        for p in range(paragraphs)
    )


def hashes(text: str) -> list[str]:
    return [text_hash(c.text) for c in pack(split_paragraphs(text))]


def rebuilt(old_text: str, new_text: str) -> list[str]:
    """The chunks after applying the plan: kept start, new middle, kept end."""
    old_chunks = [c.text for c in pack(split_paragraphs(old_text))]
    plan = plan_edit(old_text, hashes(old_text), new_text)
    back = old_chunks[len(old_chunks) - plan.keep_back :] if plan.keep_back else []
    return old_chunks[: plan.keep_front] + [c.text for c in plan.middle] + back


def test_an_unchanged_text_keeps_every_chunk():
    text = make_text(30)
    plan = plan_edit(text, hashes(text), text)
    assert plan.keep_front + plan.keep_back == len(hashes(text))
    assert plan.middle == []


def test_one_changed_sentence_near_the_start_keeps_almost_everything():
    old = make_text(40, seed=1)
    paragraphs = old.split("\n")
    paragraphs[2] += " One more sentence."
    new = "\n".join(paragraphs)

    plan = plan_edit(old, hashes(old), new)
    total = len(hashes(old))
    # Only the chunk holding paragraph 2 is remade (perhaps with a neighbour).
    assert plan.keep_front + plan.keep_back >= total - 2
    assert 1 <= len(plan.middle) <= 2


def test_adding_paragraphs_at_the_end_keeps_the_start():
    old = make_text(20, seed=2)
    new = old + "\nA brand new final paragraph."
    plan = plan_edit(old, hashes(old), new)
    assert plan.keep_front >= len(hashes(old)) - 1
    assert plan.keep_back == 0


def test_chunks_from_an_older_chunker_are_all_replaced():
    old = make_text(10)
    plan = plan_edit(old, ["not a real hash"], old)
    assert (plan.keep_front, plan.keep_back) == (0, 0)
    assert [c.text for c in plan.middle] == [c.text for c in pack(split_paragraphs(old))]


def test_random_edits_always_rebuild_exactly_the_new_text():
    """Inserts, deletions and changes anywhere: the kept and new chunks
    together always hold exactly the new text's words, in order."""
    rng = random.Random(42)
    for seed in range(300):
        old = make_text(rng.randint(1, 25), seed=seed)
        paragraphs = old.split("\n")
        for _ in range(rng.randint(1, 3)):
            i = rng.randrange(len(paragraphs) + 1)
            action = rng.choice(["insert", "delete", "change"])
            if action == "insert" or not paragraphs:
                paragraphs.insert(i, f"Inserted paragraph {rng.random()}.")
            elif action == "delete":
                paragraphs.pop(min(i, len(paragraphs) - 1))
            else:
                j = min(i, len(paragraphs) - 1)
                paragraphs[j] = paragraphs[j].replace("goes", "went", 1) + " Changed."
        new = "\n".join(paragraphs) or "Everything was deleted but this."

        assert " ".join(rebuilt(old, new)).split() == new.split(), f"seed {seed}"


def test_only_removed_is_true_when_words_were_only_taken_out():
    old = ["The quick brown fox.", "Translator's note: hello."]
    assert only_removed(old, ["The quick fox."])
    assert only_removed(old, old)
    assert only_removed(old, [])


def test_only_removed_is_false_when_something_new_was_added_or_reordered():
    old = ["The quick brown fox."]
    assert not only_removed(old, ["The quick red fox."])
    assert not only_removed(old, ["brown The quick fox."])
