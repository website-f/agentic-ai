"""The browser service's snapshot formatting and delta logic (apps/browser/snapshot.py).

Pure functions, no browser: the page side (SNAPSHOT_JS) is checked live against the practice
portal; here the nodes it returns are written by hand.
"""

import importlib.util
import sys
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parents[2] / "browser" / "snapshot.py"
if not SRC.exists():  # the api image does not ship the browser service
    pytest.skip("apps/browser is not here", allow_module_level=True)
_spec = importlib.util.spec_from_file_location("browser_snapshot", SRC)
assert _spec and _spec.loader
snap = importlib.util.module_from_spec(_spec)
sys.modules["browser_snapshot"] = snap
_spec.loader.exec_module(snap)


def node(ref, role, name="", p=-1, inview=True, **kw):
    return {"ref": ref, "role": role, "name": name, "p": p, "inview": inview, **kw}


def login_page():
    return [
        node("e1", "main"),  # 0
        node("e2", "heading", "Sign in", 0, st={"level": 1}, kind="t"),  # 1
        node("e3", "paragraph", "A practice site.", 0, kind="t"),  # 2
        node("e4", "form", "", 0),  # 3
        node("e5", "textbox", "User ID", 3, tag="input", st={"value": "demo"}),  # 4
        node(
            "e6",
            "textbox",
            "Password",
            3,
            tag="input",
            st={"password": True, "value": "(filled, hidden)"},
        ),
        node("e7", "button", "Sign in", 3, tag="button", submit=True),  # 6
    ]


def test_refs_parse_and_frames():
    assert snap.parse_ref("e17") == "e17" and snap.parse_ref(17) == "e17"
    assert snap.parse_ref("17") == "e17" and snap.parse_ref("[e3]") == "e3"
    assert snap.parse_ref("ref=f1e3") == "f1e3" and snap.parse_ref("f2") == "f2"
    assert snap.parse_ref("button") is None and snap.parse_ref(0) is None
    assert snap.parse_ref(True) is None
    assert snap.frame_of("f1e3") == "f1" and snap.frame_of("e3") is None


def test_render_interactive_tree():
    text = snap.render(login_page()).text()
    lines = text.splitlines()
    # interactive-only: the paragraph goes, the heading stays as context, the unnamed main
    # landmark adds nothing, the form is a scope (its ref is shown)
    assert "A practice site" not in text and "main" not in text
    assert lines[0] == '- heading "Sign in" level=1'
    assert lines[1] == "- form [e4]"
    assert lines[2] == '  - textbox "User ID" [e5] value="demo"'
    # never a secret value
    assert lines[3] == '  - textbox "Password" [e6] password value="(filled, hidden)"'
    assert lines[4] == '  - button "Sign in" [e7] (sends the form: browser_submit)'


def test_render_full_keeps_text_and_rows():
    nodes = [
        node("e1", "table", ""),
        node("e2", "row", "2026-10-02 | Ministry of Works", 0, st={"bold": True}),
        node("e3", "link", "Invitation to quote PQ1", 1, tag="a"),
        node("e4", "row", "2026-10-01 | State Water Board", 0),  # no link: dropped unless full
        node("e5", "text", "34 messages, 16 unread.", -1, kind="t"),
    ]
    short = snap.render(nodes).text()
    assert "State Water Board" not in short and "34 messages" not in short
    assert '- row "2026-10-02 | Ministry of Works" bold' in short
    full = snap.render(nodes, full=True).text()
    assert "State Water Board" in full and '- text "34 messages, 16 unread."' in full


def test_render_caps_by_tokens_on_screen_first():
    nodes = [node("e1", "list", "")]
    for i in range(2, 400):
        nodes.append(
            node(f"e{i}", "link", f"Item number {i} with a fairly long label", 0, inview=i > 380)
        )
    r = snap.render(nodes, budget=300)
    assert r.omitted > 300 and r.total == 398
    shown = r.text()
    assert snap.tokens(shown) <= 340  # about the budget
    assert "[e381]" in shown and "[e2]" not in shown  # what is on screen went first
    assert "browser_find" in snap.footer(r)
    assert snap.footer(snap.render(nodes)) != ""  # 398 links do not fit the default either


def test_delta_added_removed_changed_and_unchanged():
    h = snap.History()
    a = h.add("doc1", "https://x.test/live", snap.render(login_page()).lines, "Sign in")
    page2 = login_page()
    page2[4]["st"] = {"value": "demo.supplier"}  # changed
    page2.append(node("e9", "link", "Forgot password?", 3, tag="a"))  # added
    b = h.add("doc1", "https://x.test/live", snap.render(page2).lines, "Sign in")
    d = snap.diff(a, b)
    assert d.mode == "delta" and b.rev == a.rev + 1
    assert d.added == ['  - link "Forgot password?" [e9]'] and not d.removed
    assert d.changed == ['  - textbox "User ID" [e5] value="demo.supplier"']
    assert d.text().splitlines() == [
        '+ - link "Forgot password?" [e9]',
        '~ - textbox "User ID" [e5] value="demo.supplier"',
    ]
    same = h.add("doc1", "https://x.test/live", snap.render(page2).lines, "Sign in")
    assert same is b and snap.diff(b, same).mode == "same"


def test_stable_refs_make_small_deltas_but_renumbering_would_not():
    """A notice inserted at the top: with stable refs one line is added; if every element
    were renumbered (the old set-of-marks), every line would look changed."""

    def page(items, stable=True):
        nodes = [node("e1", "list", "")]
        for i, k in enumerate(items):
            ref = f"e{10 + k}" if stable else f"e{2 + i}"
            nodes.append(node(ref, "button", f"Open #{k}", 0, tag="button"))
        return snap.render(nodes).lines

    old = snap.Snap(1, "d", "u", page([3, 2, 1]))
    new = snap.Snap(2, "d", "u", page([4, 3, 2, 1]))
    d = snap.diff(old, new)
    assert d.mode == "delta" and d.added == ['  - button "Open #4" [e14]'] and not d.changed
    renumbered = snap.diff(
        snap.Snap(1, "d", "u", page([3, 2, 1], False)),
        snap.Snap(2, "d", "u", page([4, 3, 2, 1], False)),
    )
    assert renumbered.mode == "full"  # e2..e4 all now name other buttons


def test_full_on_navigation_or_big_change():
    lines = snap.render(login_page()).lines
    a = snap.Snap(1, "doc1", "https://x.test/a", lines)
    assert snap.diff(None, a).mode == "full"
    assert snap.diff(a, snap.Snap(2, "doc2", "https://x.test/a", lines)).mode == "full"  # reload
    assert snap.diff(a, snap.Snap(2, "doc1", "https://x.test/b", lines)).mode == "full"
    assert snap.diff(a, snap.Snap(2, "doc1", "https://x.test/a#top", lines)).mode == "same"
    other = snap.render([node("e20", "button", "Next")]).lines
    assert snap.diff(a, snap.Snap(2, "doc1", "https://x.test/a", other)).mode == "full"  # > 40%


def test_history_keeps_recent_revisions():
    h = snap.History()
    for i in range(20):
        h.add("d", "u", [(f"e{i}", f"- button {i}")], "")
    assert h.rev == 20 and len(h.snaps) == snap.HISTORY
    assert h.get(20) is not None and h.get(1) is None and h.get(None) is h.snaps[-1]


def test_text_delta_and_uncovered_text():
    assert snap.text_delta("a\nb", "a\nb") == ""
    assert snap.text_delta("Nothing opened yet.\nNotice #1", "Opened #2\nNotice #1") == "Opened #2"
    shown = ['- row "2026-10-02 | Ministry of Works"', '  - link "Invitation to quote PQ1" [e3]']
    text = "Inbox\n34 messages, 16 unread.\n2026-10-02\tMinistry of Works\tInvitation to quote PQ1"
    rest = snap.uncovered_text(text, shown)
    assert rest == "Inbox\n34 messages, 16 unread."


def test_find_and_form_elements():
    nodes = login_page()
    hits = snap.find(nodes, role="textbox")
    assert [h["ref"] for h in hits] == ["e5", "e6"]
    assert snap.find(nodes, label="sign in")[0]["ref"] == "e7"  # the button before the heading
    assert snap.find(nodes, text="Sign in")[1]["ref"] == "e2"
    assert snap.find(nodes) == []
    fields = snap.form_elements(nodes)
    assert [f["ref"] for f in fields] == ["e5", "e6", "e7"]
    assert fields[1]["value"] == "(filled, hidden)" and fields[2]["submit"] is True


def test_host_matching():
    assert snap.host_matches("https://portal.gov.my/x", ["gov.my"])
    assert snap.host_matches("https://gov.my/x", ["gov.my"])
    assert not snap.host_matches("https://evilgov.my/x", ["gov.my"])
    assert not snap.host_matches("about:blank", ["gov.my"])
