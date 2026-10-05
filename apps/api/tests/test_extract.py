"""Main-content extraction (agents/extract.py), the web_fetch pipeline built on it, and the
research_gather tool. Pages are saved fixtures in tests/fixtures/pages; HTTP goes through the
engine client's fake transport, like every other outbound call in the tests."""
# ruff: noqa: E501

from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from agentic.agents import browser_tools, extract, policy, research_tools, tools, websearch
from agentic.core import ssrf
from agentic.engine import client as engine_client
from agentic.models import Agent

PAGES = Path(__file__).parent / "fixtures" / "pages"
HOSTS = "good.fake,news.fake,tender.fake,docs.fake,shop.fake,research.fake,other.fake"


def page(name: str) -> str:
    return (PAGES / name).read_text(encoding="utf-8")


class Site:
    """A fake web: url -> (status, content type, body, extra headers). Records requests."""

    def __init__(self) -> None:
        self.routes: dict[str, tuple[int, str, str, dict[str, str]]] = {}
        self.requests: list[httpx.Request] = []

    def add(self, url: str, body: str, ctype: str = "text/html; charset=utf-8", status=200, **h):
        self.routes[url] = (status, ctype, body, h)
        return self

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        url = str(request.url)
        if url not in self.routes:
            return httpx.Response(404, text="not found")
        status, ctype, body, headers = self.routes[url]
        if callable(body):
            status, ctype, body = body(request)
        return httpx.Response(status, headers={"content-type": ctype, **headers}, text=body)

    def paths(self, host: str | None = None) -> list[str]:
        return [r.url.path for r in self.requests if host is None or r.url.host == host]


@pytest.fixture
def site(monkeypatch):
    monkeypatch.setattr(ssrf.settings, "private_hosts_allowed", HOSTS)
    s = Site()
    engine_client.use_transport(httpx.MockTransport(s.handler))
    yield s
    engine_client.use_transport(None)


@pytest.fixture
def digest_calls(monkeypatch):
    calls: list[str] = []

    async def fake_digest(ctx, text, focus):
        calls.append(focus)
        return "DIGESTED BY MODEL"

    monkeypatch.setattr(browser_tools, "_digest", fake_digest)
    return calls


CTX = SimpleNamespace(db=None, agent=None, workspace=None, task=None)
NEWS_URL = "https://news.fake/news/transport/penang-lrt"


# ---------------------------------------------------------------- prune + markdown


def test_news_article_keeps_the_story_and_drops_the_chrome():
    md = extract.to_markdown(extract.prune(page("news_article.html"), NEWS_URL))
    # Main text, headings and the quote survive.
    assert md.startswith("# Penang light rail line gets green light")
    for kept in (
        "approved the 29.5km Mutiara Line",
        "## Cost and funding",
        "**RM10.5 billion**",
        "closes on 28 November 2026 at 5pm",
        '> "If the train gets my workers here',
        "- Land acquisition: January to December 2027",
        "(image: Artist's impression of the Mutiara Line station at Komtar)",
    ):
        assert kept in md, kept
    # Cookie banner, menus, share bar, sidebar, ads, newsletter, comments, footer: gone.
    for dropped in (
        "We use cookies",
        "Lifestyle",
        "Skip to main content",
        "Share on Facebook",
        "Most read",
        "Advertisement",
        "broadband",
        "morning briefing",
        "Related stories",
        "Only took 15 years",
        "All rights reserved",
        "Search Coastal Daily",
        "Tags:",
        "logo",
    ):
        assert dropped not in md, dropped


def test_tables_become_pipe_tables_and_links_become_citations():
    md = extract.to_markdown(extract.prune(page("news_article.html"), NEWS_URL))
    assert "| No. | Station | Type | Interchange |\n| --- | --- | --- | --- |" in md
    assert "| 5 | Bayan Lepas | At-grade | Airport link |" in md
    assert "[railway scheme page][2]" in md and "[federal approval statement][3]" in md
    links = md.split("\nLinks:\n", 1)[1]
    # Relative links resolved against the page URL; external ones kept as they are.
    assert "[2]: https://news.fake/news/transport/mutiara-line-scheme" in links
    assert "[3]: https://www.mot.gov.my/en/rail/mutiara-line" in links
    assert "facebook.com" not in links and "ads.example.net" not in links


def test_government_tender_page_inside_an_aspnet_form_with_a_layout_table():
    md = extract.to_markdown(
        extract.prune(page("tender_notice.html"), "https://tender.fake/Tender/NotisTender.aspx")
    )
    # The whole page sits in one <form>: it must not be dropped as "form chrome".
    assert "## Notis Tender: JKR/SEL/T/114/2026" in md
    assert "Tawaran adalah dipelawa" in md
    # The outer layout table is walked, the inner data tables are rendered as tables.
    assert "| Perkara | Butiran |" in md
    assert "| Tarikh Tutup | 27 Oktober 2026, 12.00 tengah hari |" in md
    assert "| Harga Dokumen | RM 300.00 (tidak dikembalikan) |" in md
    assert "| 2 | [Syarat-syarat Tender][2] | 1.4 MB |" in md
    assert "[2]: https://tender.fake/Dokumen/2026/T114/Syarat.pdf" in md
    # A mailto link keeps its text but is not cited.
    assert "kontrak.sel@jkr.gov.my" in md and "mailto:" not in md
    for dropped in ("Soalan Lazim", "Profil Jabatan", "Anda di sini", "Hak Cipta", "__VIEWSTATE"):
        assert dropped not in md, dropped
    assert "Utama" not in md.split("## Notis Tender")[0]


def test_product_page_keeps_price_description_and_spec_table():
    md = extract.to_markdown(
        extract.prune(page("product_page.html"), "https://shop.fake/products/kopi-hutan")
    )
    assert "# Kopi Hutan Arabica Beans 500g" in md
    assert "RM 89.00 RM 72.00" in md  # short, but numbers: kept despite the word minimum
    assert "Gunung Kinabalu" in md and "- Roast level: Medium" in md
    # Key: value spec rows (<th> first cell) get an empty header so no row is lost.
    assert "|  |  |\n| --- | --- |\n| Net weight | 500 g |" in md
    assert "(image: Kopi Hutan Arabica 500g bag, front)" in md
    for dropped in (
        "IMG_2041",
        "Add to cart",
        "Whole bean",
        "You may also like",
        "Gayo Sumatra",
        "Join the club",
        "Refund policy",
        "Powered by Shopify",
        "Cart (0)",
    ):
        assert dropped not in md, dropped


def test_malay_page_is_cleaned_too():
    blocks = extract.prune(page("malay_page.html"), "https://news.fake/bantuan/bshr-2027")
    md = extract.to_markdown(blocks)
    assert "# Bantuan Sara Hidup Rakyat 2027" in md
    assert "## Siapa yang layak memohon" in md
    assert "| Bujang (21-59 tahun) | RM2,500 dan ke bawah | RM350 |" in md
    assert "1. Layari portal rasmi bantuan di [bshr.hasil.gov.my][1]." in md
    for dropped in ("menggunakan kuki", "Artikel Popular", "Kongsi", "Hak Cipta", "Subsidi diesel"):
        assert dropped not in md, dropped


def test_link_heavy_page_uses_the_dynamic_threshold():
    html = (
        "<html><body><ul>"
        + "".join(
            f'<li><a href="/reports/{y}.html">Annual report {y}</a></li>' for y in range(2015, 2026)
        )
        + "</ul></body></html>"
    )
    blocks = extract.prune(html, "https://good.fake/reports/")
    assert blocks and blocks[0].kind == "list"  # nothing passed 0.48, the best still kept
    assert "[Annual report 2020][6]" in extract.to_markdown(blocks)


def test_big_tables_are_capped_and_links_deduplicated():
    rows = "".join(
        "<tr>" + "".join(f"<td>r{r}c{c}</td>" for c in range(14)) + "</tr>" for r in range(60)
    )
    head = "<tr>" + "".join(f"<th>h{c}</th>" for c in range(14)) + "</tr>"
    html = (
        f"<main><h1>Data</h1><table>{head}{rows}</table>"
        '<p>See <a href="/a">the source</a> and again <a href="/a#top">the source</a>.</p></main>'
    )
    md = extract.to_markdown(extract.prune(html, "https://good.fake/x"))
    assert "| h0 | h1 |" in md and "h9 |" in md and "h10" not in md
    assert "[table cut: 20 more rows, 4 more columns not shown]" in md
    assert "[the source][1] and again [the source][1]" in md
    assert md.count("https://good.fake/a") == 1


# ---------------------------------------------------------------- BM25


def test_tokens_handle_english_and_malay_suffixes():
    assert extract.stem("closing") == extract.stem("closes") == extract.stem("closed")
    assert extract.stem("retried") == extract.stem("retries") == extract.stem("retry")
    assert extract.stem("harganya") == "harga" and extract.stem("permohonan") == "permohon"
    assert extract.tokens("Bila tarikh tutup yang baharu?") == ["tarikh", "tutup", "baharu"]
    assert extract.tokens("RM 1,200.50 in 2026") == ["rm", "1,200.50", "2026"]


def test_bm25_picks_the_matching_section_in_document_order():
    blocks = extract.prune(page("news_article.html"), NEWS_URL)
    picked = extract.bm25_blocks(blocks, "when does the public feedback period close", 1200)
    md = extract.render(picked).body
    assert "## Public feedback period" in md and "closes on 28 November 2026" in md
    assert "Cost and funding" not in md and "Station list" not in md
    assert len(md) <= 1200
    assert [b.order for b in picked] == sorted(b.order for b in picked)


def test_bm25_works_on_malay_text():
    blocks = extract.prune(page("malay_page.html"), "https://news.fake/b")
    md = extract.render(extract.bm25_blocks(blocks, "bila tarikh tutup permohonan", 600)).body
    assert "## Tarikh penting" in md and "30 November 2026" in md
    assert "Kadar setahun" not in md


def test_markdown_documents_split_into_blocks():
    blocks = extract.markdown_blocks(page("docs_page.md"))
    kinds = [b.kind for b in blocks]
    assert kinds[0] == "h1" and "pre" in kinds and "table" in kinds and "list" in kinds
    code = next(b for b in blocks if b.kind == "pre")
    assert code.md.startswith("```python") and code.md.endswith("```")
    md = extract.to_markdown(
        extract.bm25_blocks(blocks, "how long are failed webhooks retried", 700)
    )
    assert "## Retries" in md and "up to **3 days**" in md and "Verifying signatures" not in md


# ---------------------------------------------------------------- web_fetch


async def test_web_fetch_uses_markdown_when_the_server_serves_it(site, digest_calls):
    def negotiate(request: httpx.Request):
        if request.headers["accept"].startswith("text/markdown"):
            return 200, "text/markdown; charset=utf-8", page("docs_page.md")
        return 200, "text/html", "<html><body><p>html version</p></body></html>"

    site.add("https://docs.fake/webhooks", negotiate)  # type: ignore[arg-type]
    out = await tools._web_fetch(CTX, {"url": "https://docs.fake/webhooks"})
    assert "## Retries" in out and "| Attempt | Delay after previous |" in out
    assert "```python" in out and "html version" not in out
    assert site.requests[0].headers["accept"] == tools.ACCEPT_PAGE
    assert out.count("<<<") == 1 and not digest_calls


async def test_web_fetch_with_why_picks_sections_without_a_model_call(site, digest_calls):
    site.add(NEWS_URL, page("news_article.html"))
    out = await tools._web_fetch(
        CTX, {"url": NEWS_URL, "why": "when does the public feedback period close"}
    )
    assert digest_calls == []  # BM25 fitted the budget: no _digest call
    assert "picked by keyword match" in out and "closes on 28 November 2026 at 5pm" in out
    assert "[railway scheme page][1]" in out and "https://news.fake/news/transport/mutiara" in out
    assert "Cost and funding" not in out and "We use cookies" not in out
    assert "full=true" in out and out.count("<<<") == 1


async def test_web_fetch_falls_back_to_the_digest_when_nothing_matches(site, digest_calls):
    site.add(NEWS_URL, page("news_article.html"))
    out = await tools._web_fetch(CTX, {"url": NEWS_URL, "why": "zxqv quokka"})
    assert digest_calls == ["zxqv quokka"] and "DIGESTED BY MODEL" in out


async def test_web_fetch_without_why_returns_clean_markdown(site, digest_calls):
    site.add(NEWS_URL, page("news_article.html"))
    out = await tools._web_fetch(CTX, {"url": NEWS_URL})
    assert "# Penang light rail" in out and "| 1 | Komtar | Underground |" in out
    assert "Links:\n[1]: https://news.fake/authors/aisyah-rahman" in out
    assert "We use cookies" not in out and "Most read" not in out
    assert out.count("<<<") == 1 and not digest_calls


async def test_web_fetch_full_pages_through_a_long_page(site, digest_calls):
    paras = "".join(
        f"<p>Paragraph {i}: " + ("the quick brown fox jumps over the lazy dog " * 20) + "</p>"
        for i in range(40)
    )
    site.add("https://good.fake/long", f"<html><body><article>{paras}</article></body></html>")
    first = await tools._web_fetch(CTX, {"url": "https://good.fake/long", "full": True})
    assert "characters 0-20,000 of" in first and "offset=20000" in first
    assert "Paragraph 0:" in first and "Paragraph 39:" not in first
    rest = await tools._web_fetch(
        CTX, {"url": "https://good.fake/long", "full": True, "offset": 20000}
    )
    assert "Paragraph 39:" in rest and "characters 20,000-" in rest
    clipped = await tools._web_fetch(CTX, {"url": "https://good.fake/long"})
    assert "[clipped:" in clipped and "full=true, offset=6000" in clipped


async def test_web_fetch_reads_llms_txt_only_for_a_site_overview(site, digest_calls):
    site.add(
        "https://docs.fake/llms.txt",
        "# Docs\n\n- [Webhooks](https://docs.fake/webhooks)",
        "text/plain",
    )
    site.add(
        "https://docs.fake/guide",
        "<html><body><main><h1>Guide</h1><p>Guide page body text here.</p></main></body></html>",
    )
    out = await tools._web_fetch(CTX, {"url": "https://docs.fake/guide", "site_overview": True})
    assert "llms.txt" in out and "[Webhooks](https://docs.fake/webhooks)" in out
    plain = await tools._web_fetch(CTX, {"url": "https://docs.fake/guide"})
    assert "Guide page body" in plain
    assert site.paths().count("/llms.txt") == 1  # not tried without site_overview
    # No llms.txt (404): the page itself is read.
    site.add(
        "https://news.fake/a",
        "<html><body><main><p>Just the page itself, nothing else.</p></main></body></html>",
    )
    fallback = await tools._web_fetch(CTX, {"url": "https://news.fake/a", "site_overview": True})
    assert "Just the page itself" in fallback


async def test_web_fetch_falls_back_to_plain_text_when_pruning_loses_the_page(site):
    text = "Important notice about the water supply interruption in Section 7. " * 8
    html = f'<html><body><div class="sidebar"><p>{text}</p></div></body></html>'
    cleaned = tools.clean_page("text/html", html, "https://good.fake/x")
    assert cleaned.how == "text" and "water supply interruption" in cleaned.body
    short = tools.clean_page(
        "text/html", "<h1>Prices</h1><p>RM 4.50 per kg</p>", "https://good.fake/p"
    )
    assert short.how == "pruned" and "RM 4.50 per kg" in short.body


async def test_web_fetch_redirects_stay_guarded(site):
    site.add("https://good.fake/go", "", status=302, location="http://169.254.169.254/latest")
    with pytest.raises(ssrf.BlockedURL):
        await tools._web_fetch(CTX, {"url": "https://good.fake/go"})
    assert "169.254.169.254" not in [r.url.host for r in site.requests]


# ---------------------------------------------------------------- research_gather


def test_robots_parsing():
    rules = research_tools.parse_robots(
        "User-agent: Googlebot\nDisallow: /\n\n"
        "User-agent: *\nDisallow: /private/\nDisallow: /*.cgi$\nAllow: /private/open/\n"
    )
    assert rules.allowed("https://x.fake/public/a")
    assert not rules.allowed("https://x.fake/private/a")
    assert rules.allowed("https://x.fake/private/open/b")  # longer Allow wins
    assert not rules.allowed("https://x.fake/run.cgi") and rules.allowed("https://x.fake/run.cgi?x")
    mine = research_tools.parse_robots(
        "User-agent: agentic-ai\nDisallow: /no\n\nUser-agent: *\nDisallow: /"
    )
    assert mine.allowed("https://x.fake/yes") and not mine.allowed("https://x.fake/no")
    assert research_tools.parse_robots("User-agent: *\nDisallow:\n").allowed("https://x.fake/a")


def _doc(title: str, body: str, links: str = "") -> str:
    return (
        f"<html><head><title>{title}</title></head><body><nav><a href='/'>Home</a></nav>"
        f"<main><h1>{title}</h1><p>{body}</p>{links}</main></body></html>"
    )


async def test_research_stops_on_saturation(site):
    q = "mutiara line public feedback deadline"
    site.add(
        "https://research.fake/1",
        _doc(
            "Mutiara Line",
            "The Mutiara Line public consultation is open to every resident of the island.",
        ),
    )
    site.add(
        "https://research.fake/2",
        _doc("Mutiara news", "The Mutiara Line project was approved by the government this week."),
    )
    for i in (3, 4, 5, 6):
        site.add(
            f"https://research.fake/{i}",
            _doc(f"Page {i}", "Mutiara Line feedback deadline is 28 November 2026 for the public."),
        )
    seeds = [f"https://research.fake/{i}" for i in range(1, 7)]
    out = await research_tools._research_gather(CTX, {"question": q, "seed_urls": seeds})
    assert "read 2 page(s), saturated" in out
    assert "Missing: feedback, deadline" in out
    fetched = site.paths("research.fake")
    assert "/5" not in fetched and "/6" not in fetched  # never fetched once saturated
    assert "[1] Mutiara Line - https://research.fake/1" in out


async def test_research_respects_robots_and_max_pages(site):
    q = "alpha bravo charlie delta echo foxtrot golf hotel india juliet"
    site.add("https://research.fake/robots.txt", "User-agent: *\nDisallow: /private/", "text/plain")
    site.add("https://research.fake/private/0", _doc("Secret", "alpha bravo charlie delta echo"))
    words = q.split()
    for i in range(1, 7):
        site.add(
            f"https://research.fake/p{i}",
            _doc(f"Page {i}", f"This page talks about {words[i]} only, at some length."),
        )
    seeds = ["https://research.fake/private/0"] + [
        f"https://research.fake/p{i}" for i in range(1, 7)
    ]
    out = await research_tools._research_gather(
        CTX, {"question": q, "seed_urls": seeds, "max_pages": 3}
    )
    fetched = site.paths("research.fake")
    assert "/private/0" not in fetched and fetched.count("/robots.txt") == 1
    assert [p for p in fetched if p.startswith("/p")] == ["/p1", "/p2", "/p3"]
    assert "read 3 page(s), page limit reached" in out
    assert "1 disallowed by robots.txt" in out


async def test_research_follows_relevant_in_site_links_and_never_private_ones(site):
    q = "penang lrt public feedback closing date"
    links = (
        '<ul><li><a href="/lrt/feedback">How to send public feedback on the LRT, closing date</a></li>'
        '<li><a href="/about">About us</a></li>'
        '<li><a href="https://other.fake/lrt-feedback">Penang LRT public feedback elsewhere</a></li>'
        '<li><a href="/go">Penang LRT feedback closing date mirror</a></li></ul>'
    )
    site.add(
        "https://research.fake/start",
        _doc("Penang LRT", "The Penang LRT line was approved.", links),
    )
    site.add(
        "https://research.fake/lrt/feedback",
        _doc(
            "Feedback",
            "Public feedback on the Penang LRT closes on 28 November 2026; the closing date is firm.",
        ),
    )
    site.add("https://research.fake/go", "", status=302, location="http://10.0.0.5/admin")
    out = await research_tools._research_gather(
        CTX, {"question": q, "seed_urls": ["https://research.fake/start", "http://127.0.0.1/x"]}
    )
    fetched = site.paths("research.fake")
    assert "/lrt/feedback" in fetched and "/about" not in fetched
    hosts = {r.url.host for r in site.requests}
    assert "other.fake" not in hosts  # only in-site links are followed
    assert "10.0.0.5" not in hosts and "127.0.0.1" not in hosts  # guarded, never requested
    assert "closes on 28 November 2026" in out and "blocked (private" in out
    assert "https://research.fake/lrt/feedback" in out and out.count("<<<") == 1


async def test_research_without_seeds_uses_web_search(site, monkeypatch):
    async def fake_search(query, count=6):
        return "DuckDuckGo", [websearch.Result("Docs", "https://docs.fake/webhooks", "")]

    monkeypatch.setattr(websearch, "search", fake_search)
    site.add("https://docs.fake/webhooks", page("docs_page.md"), "text/markdown")
    out = await research_tools._research_gather(CTX, {"question": "webhook retries backoff"})
    assert "Started from 1 DuckDuckGo results" in out and "exponential backoff" in out


async def test_research_gather_is_registered_low_risk_and_allowed():
    t = tools.TOOLS["research_gather"]
    assert t.risk == "low" and t.default_mode == "allow"
    assert "research_gather" in policy.OUTSIDE_CONTENT
    a = Agent(name="Ana", tools={}, autonomy="ask")
    assert (await policy.evaluate(a, "research_gather", {"question": "x"})).effect == "allow"
