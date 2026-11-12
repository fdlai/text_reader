"""Swapping in the user's respellings before text is spoken."""

from app.services.pronunciation import Lexicon, normalize


def lexicon(**entries: str) -> Lexicon:
    return Lexicon({normalize(k.replace("_", " ")): v for k, v in entries.items()})


def test_normalize_lowercases_and_strips_punctuation():
    assert normalize('  "Hermione!" ') == "hermione"
    assert normalize("Chung   Myung,") == "chung myung"


def test_a_word_is_replaced_and_reported_as_used():
    text, used = lexicon(Hermione="Her-my-oh-nee").apply("Hermione smiled.")
    assert text == "Her-my-oh-nee smiled."
    assert used == {"hermione": "Her-my-oh-nee"}


def test_matching_ignores_capitals_and_keeps_surrounding_punctuation():
    text, _ = lexicon(Hermione="Her-my-oh-nee").apply('"HERMIONE!" he shouted.')
    assert text == '"Her-my-oh-nee!" he shouted.'


def test_a_possessive_uses_the_entry_and_keeps_the_s():
    text, _ = lexicon(Hermione="Her-my-oh-nee").apply("Hermione's wand, Hermione’s cat.")
    assert text == "Her-my-oh-nee's wand, Her-my-oh-nee’s cat."


def test_phrases_match_before_single_words():
    lex = lexicon(Chung_Myung="Chung Mee-yung", Chung="Choong")
    text, used = lex.apply("Chung Myung met Chung.")
    assert text == "Chung Mee-yung met Choong."
    assert set(used) == {"chung myung", "chung"}


def test_punctuation_or_a_line_break_between_words_breaks_a_phrase():
    lex = lexicon(Chung_Myung="Chung Mee-yung")
    assert lex.apply("Chung, Myung")[0] == "Chung, Myung"
    assert lex.apply("Chung\n\nMyung")[0] == "Chung\n\nMyung"


def test_spacing_and_line_breaks_around_matches_are_kept():
    text, _ = lexicon(Baek="Bake").apply("Baek  walked.\n\nBaek ran.")
    assert text == "Bake  walked.\n\nBake ran."


def test_words_that_only_contain_an_entry_are_not_changed():
    text, used = lexicon(Baek="Bake").apply("Baekho and Baeks.")
    assert text == "Baekho and Baeks."
    assert used == {}


def test_an_empty_lexicon_changes_nothing():
    assert Lexicon({}).apply("Anything at all.") == ("Anything at all.", {})
