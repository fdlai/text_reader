"""Finds the link to a page's next part: the next chapter of a novel, the next
page of a long article, and so on."""

import re
from urllib.parse import urldefrag, urljoin, urlsplit

from lxml import html as lxml_html
from lxml.etree import ParserError

# Link texts that mean "next part", after symbols like ❯ › » → are removed.
NEXT_TEXT = re.compile(r"next( (chapter|page|part|episode))?")


def without_fragment(url: str) -> str:
    """The URL without its #part, which only points somewhere within a page,
    so "page#comments" and "page" are saved as the same page."""
    return urldefrag(url).url


def _host(url: str) -> str:
    # www.example.com and example.com count as the same site.
    return (urlsplit(url).hostname or "").removeprefix("www.")


def _link_text(link) -> str:
    """A link's text in lowercase words, without symbols: "Next ❯" -> "next"."""
    return " ".join(re.sub(r"[^\w\s]", " ", link.text_content()).lower().split())


def find_next_url(html: str, url: str) -> str | None:
    """The page's next-part link as a full URL, or None if it has none.

    Pages can mark it officially, with <link rel="next" href="..."> in the
    head or rel="next" on a link. Many don't, so links whose text is just
    "Next", "Next chapter" and similar count too. Only links to the same
    website are used, so a "Next" advert or other site is never picked.
    """
    # Some pages start with <?xml encoding="...">, which lxml refuses in text
    # that's already decoded. It isn't needed for finding links.
    html = re.sub(r"^\s*<\?xml[^>]*>", "", html)
    try:
        tree = lxml_html.fromstring(html)
    except ParserError:  # e.g. an empty page
        return None

    marked = [
        el.get("href")
        for el in tree.xpath("//link[@rel] | //a[@rel]")
        if "next" in el.get("rel").lower().split()
    ]
    labelled = [
        a.get("href")
        for a in tree.xpath("//a[@href]")
        if NEXT_TEXT.fullmatch(_link_text(a))
    ]

    page = without_fragment(url)
    for href in marked + labelled:
        if not href:
            continue
        candidate = without_fragment(urljoin(url, href.strip()))
        if (
            urlsplit(candidate).scheme in ("http", "https")
            and _host(candidate) == _host(url)
            and candidate != page
        ):
            return candidate
    return None
