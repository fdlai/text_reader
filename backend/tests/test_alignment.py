"""The parts of word highlighting that don't need Whisper: matching heard
words to written ones, and placing the words Whisper missed."""

from app.services.alignment import (
    RETRY_RUN,
    _anchors,
    _fill_gaps,
    _fill_paragraphs,
    _match,
    _unheard_runs,
)


def test_heard_words_get_their_times_and_unheard_ones_stay_empty():
    words = ["The", "cat", "sat."]
    heard = [(" the", 0.0, 0.2), (" sat", 0.5, 0.8)]
    starts, ends = [None] * 3, [None] * 3
    assert _match(words, heard, starts, ends, 0) == 2
    assert starts == [0.0, None, 0.5]
    assert ends == [0.2, None, 0.8]


def test_a_name_heard_with_a_similar_spelling_still_matches():
    words = ["Baek", "Cheon", "nodded."]
    heard = [(" Beek", 0.0, 0.3), (" Chun", 0.3, 0.6), (" nodded", 0.6, 1.0)]
    starts, ends = [None] * 3, [None] * 3
    assert _match(words, heard, starts, ends, 0) == 3


def test_a_completely_different_word_does_not_match():
    words = ["Hermione"]
    heard = [(" potato", 0.0, 0.5)]
    starts, ends = [None], [None]
    assert _match(words, heard, starts, ends, 0) == 0


def test_missing_words_are_spread_between_their_neighbours_by_length():
    words = ["A", "bb", "cccc", "D"]
    starts = [0.0, None, None, 9.0]
    ends = [1.0, None, None, 9.5]
    times = _fill_gaps(words, starts, ends, duration=10.0)
    # The gap runs from the end of "A" (1.0) to the start of "D" (9.0), and
    # "bb" takes 3/8 of it (2 letters + a space, of 3 + 5).
    assert times == [0.0, 1.0, 4.0, 9.0]


def test_times_never_go_backwards():
    times = _fill_gaps(["a", "b", "c"], [2.0, 1.0, None], [2.5, 1.5, None], duration=5.0)
    assert times == sorted(times)


def test_words_after_the_last_heard_one_fill_up_to_the_end():
    times = _fill_gaps(["a", "b"], [0.0, None], [1.0, None], duration=3.0)
    assert times == [0.0, 1.0]


def test_runs_of_unheard_words_long_enough_to_retry():
    starts = [0.0] + [None] * RETRY_RUN + [5.0, None, 6.0]
    assert _unheard_runs(starts) == [(1, 1 + RETRY_RUN)]


def test_stretched_words_and_the_words_crammed_after_them_are_not_anchors():
    # "b" is stretched over 6 seconds (Whisper skipped speech); "c" is
    # crammed in right after it; "d" has almost no length.
    starts = [0.0, 1.0, 7.1, 9.0, 20.0]
    ends = [0.5, 7.0, 7.3, 9.01, 20.5]
    assert _anchors(starts, ends) == [True, True, False, False, True]


def test_each_paragraph_starts_when_its_speech_starts():
    paragraphs = [["One", "two."], ["Three", "four."]]
    starts = [0.1, 0.5, None, 3.4]
    ends = [0.4, 0.9, None, 3.8]
    times = _fill_paragraphs(paragraphs, starts, ends, [(0.0, 1.0), (3.0, 4.0)])
    assert times[0] == 0.0
    assert times[2] == 3.0


def test_a_word_heard_outside_its_paragraph_is_not_trusted():
    paragraphs = [["One", "two."], ["Three"]]
    # "two." was matched at 3.5 s, inside the second paragraph's speech.
    starts = [0.0, 3.5, 3.0]
    ends = [0.4, 3.9, 3.4]
    times = _fill_paragraphs(paragraphs, starts, ends, [(0.0, 1.0), (3.0, 4.0)])
    assert times[1] < 1.0
