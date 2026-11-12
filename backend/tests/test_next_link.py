"""Finding a page's link to its next part (the next chapter)."""

from app.services.next_link import find_next_url, without_fragment

PAGE = "https://novels.example.com/book/chapter-1"


def page(body: str, head: str = "") -> str:
    return f"<html><head>{head}</head><body>{body}</body></html>"


def test_a_rel_next_link_in_the_head_is_used():
    html = page("", head='<link rel="next" href="/book/chapter-2">')
    assert find_next_url(html, PAGE) == "https://novels.example.com/book/chapter-2"


def test_a_link_labelled_next_is_used_ignoring_symbols_and_capitals():
    html = page('<a href="chapter-2">NEXT ❯</a>')
    assert find_next_url(html, PAGE) == "https://novels.example.com/book/chapter-2"


def test_next_chapter_and_similar_labels_count():
    for label in ["Next chapter", "next page", "Next Part »", "→ Next episode"]:
        html = page(f'<a href="/book/chapter-2">{label}</a>')
        assert find_next_url(html, PAGE) is not None, label


def test_other_link_texts_do_not_count():
    html = page('<a href="/book/chapter-2">Next time on the blog</a>')
    assert find_next_url(html, PAGE) is None


def test_links_to_other_websites_are_ignored():
    html = page('<a href="https://ads.example.org/">Next</a>')
    assert find_next_url(html, PAGE) is None


def test_www_counts_as_the_same_site():
    html = page('<a href="https://www.novels.example.com/book/chapter-2">Next</a>')
    assert find_next_url(html, PAGE) == "https://www.novels.example.com/book/chapter-2"


def test_a_link_back_to_the_same_page_is_ignored():
    html = page('<a href="#comments">Next</a>')
    assert find_next_url(html, PAGE) is None


def test_an_empty_page_has_no_next_link():
    assert find_next_url("", PAGE) is None


def test_without_fragment_removes_the_hash_part():
    assert without_fragment("https://a.com/page#comments") == "https://a.com/page"
