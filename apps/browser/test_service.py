"""Focused unit tests for the browser service's new machine pool and human-interaction layer.

These use lightweight fakes for Playwright's Locator/Page, so they need neither Camoufox nor a
real browser. Run them with the api venv's pytest (it has pytest + pytest-asyncio + fastapi):

    cd apps/api && .venv/Scripts/python -m pytest -q ../browser/test_service.py

What they cover: the per-agent deterministic identity, the pool (reuse / LRU eviction / all
busy), key-by-key human typing (exact text, with a backspace-correct), the human click
sequence (scroll -> cursor path -> hover -> click), the reported "clicks the field several
times" bug fix (type focuses itself; a click on a field focuses once and then no-ops; type
adds no extra click), the submit-approval gate, and multi-step scrolling.
"""

import asyncio
import os
import random
import sys
import types
from pathlib import Path

import pytest

os.environ.setdefault("BROWSER_PROFILES_DIR", str(Path(__file__).parent / ".test-profiles"))
sys.path.insert(0, str(Path(__file__).parent))

import service  # noqa: E402

# Marked here so the async tests run even when pytest is pointed straight at this file (the api
# pyproject's asyncio_mode=auto is not an ancestor of apps/browser); every test is async.
pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------- fakes


class FakeMouse:
    def __init__(self) -> None:
        self.moves: list[tuple[float, float]] = []
        self.wheels: list[tuple[int, int]] = []

    async def move(self, x, y, **_):
        self.moves.append((x, y))

    async def wheel(self, dx, dy):
        self.wheels.append((dx, dy))


class FakeKeyboard:
    def __init__(self) -> None:
        self.presses: list[str] = []

    async def press(self, key):
        self.presses.append(key)


class FakePage:
    def __init__(self, url="https://portal.example/login") -> None:
        self.url = url
        self.mouse = FakeMouse()
        self.keyboard = FakeKeyboard()

    async def wait_for_load_state(self, *_a, **_k):
        return None


class FakeLocator:
    """Records the interaction ops so a test can assert their order/count."""

    def __init__(
        self,
        *,
        editable=False,
        submit=False,
        transaction=False,
        is_password=False,
        tag="input",
        label="x",
    ) -> None:
        self.label = label
        self.value = "prefilled"
        self.focused = False
        self.editable = editable
        self.submit = submit
        self.transaction = transaction
        self.is_password = is_password
        self.tag = tag
        self.ops: list[str] = []
        self.clicks = 0
        self.focuses = 0

    async def scroll_into_view_if_needed(self, **_):
        self.ops.append("scroll")

    async def hover(self, **_):
        self.ops.append("hover")

    async def click(self, **_):
        self.ops.append("click")
        self.clicks += 1
        self.focused = True

    async def focus(self, **_):
        self.ops.append("focus")
        self.focuses += 1
        self.focused = True

    async def fill(self, text, **_):
        self.ops.append("fill")
        self.value = text
        self.focused = True

    async def press_sequentially(self, text, delay=0, **_):
        self.value += text

    async def press(self, key, **_):
        if key == "Backspace":
            self.value = self.value[:-1]
        else:
            self.ops.append(f"press:{key}")

    async def bounding_box(self):
        return {"x": 10.0, "y": 20.0, "width": 120.0, "height": 30.0}

    async def set_checked(self, *_a, **_k):
        self.ops.append("set_checked")

    async def evaluate(self, js, *args):
        if "transaction" in js:  # SUBMIT_JS
            return {"submit": self.submit, "transaction": self.transaction, "label": self.label}
        if "editable" in js:  # FIELD_JS
            return {"editable": self.editable, "focused": self.focused, "tag": self.tag}
        if "type === 'password'" in js:  # the secret password-field guard
            return self.is_password
        return None


@pytest.fixture(autouse=True)
def fast_human(monkeypatch):
    """Human layer on, but with zero timing so tests are instant and deterministic."""
    monkeypatch.setattr(service, "HUMAN_TYPING", True)
    monkeypatch.setattr(service, "HUMAN_CLICK", True)
    monkeypatch.setattr(service, "HUMAN_SCROLL", True)
    monkeypatch.setattr(service, "TYPE_MS_MIN", 0)
    monkeypatch.setattr(service, "TYPE_MS_MAX", 0)
    monkeypatch.setattr(service, "CLICK_DWELL_MS", 0)
    monkeypatch.setattr(service, "THINK_MS_MIN", 0)
    monkeypatch.setattr(service, "THINK_MS_MAX", 0)
    monkeypatch.setattr(service, "TYPO_RATE", 0.0)
    monkeypatch.setattr(service, "_type_delay", lambda ch="", pc=False: 0.0)

    async def _nosleep(*_a, **_k):
        return None

    monkeypatch.setattr(service.asyncio, "sleep", _nosleep)
    service.state["machines"].clear()
    service.state["sessions"].clear()
    yield
    service.state["machines"].clear()
    service.state["sessions"].clear()


# ---------------------------------------------------------------- identity


async def test_identity_is_stable_per_agent_and_varies():
    a = service._identity("agent-123")
    assert a == service._identity("agent-123")  # same machine every time
    assert set(a) == {"os", "screen", "window"}
    assert a["os"] in ("windows", "macos", "linux")
    assert a["window"][0] <= a["screen"][0] and a["window"][1] <= a["screen"][1]
    others = {tuple(service._identity(f"agent-{i}")["screen"]) for i in range(30)}
    assert len(others) > 1  # not everyone is the same box


# ---------------------------------------------------------------- human typing


async def test_human_type_enters_exact_text():
    loc = FakeLocator(editable=True)
    await service._type_field(loc, "Hello, world 42")
    assert loc.value == "Hello, world 42"
    assert loc.focuses == 1 and loc.clicks == 0  # focuses itself, never clicks


async def test_human_type_clicks_into_the_field_first_when_it_can():
    """P58: like a person, the hand goes to the field and clicks into it, then types."""
    loc = FakeLocator(editable=True)
    loc.page = FakePage()
    await service._type_field(loc, "QT123")
    assert loc.value == "QT123"
    assert loc.clicks == 1 and loc.ops.index("click") < loc.ops.index("fill")
    assert loc.page.mouse.moves  # a cursor path to the field


async def test_human_type_backspace_correct_still_exact(monkeypatch):
    monkeypatch.setattr(service, "TYPO_RATE", 1.0)  # a typo on every typable char
    random.seed(7)
    loc = FakeLocator(editable=True)
    await service._human_type(loc, "abcdef")
    assert loc.value == "abcdef"  # every wrong key was backspaced and retyped


async def test_type_delay_is_bounded(monkeypatch):
    monkeypatch.setattr(service, "TYPE_MS_MIN", 60)
    monkeypatch.setattr(service, "TYPE_MS_MAX", 160)
    for _ in range(200):
        assert 0 <= service._type_delay("a") <= 0.16
        assert 0 <= service._type_delay(" ") <= 0.16 + 0.12 + 1e-9
        assert 0 <= service._type_delay(".") <= 0.16 + 0.18 + 1e-9


# ---------------------------------------------------------------- human clicking


async def test_click_scrolls_then_hovers_then_clicks():
    loc = FakeLocator(editable=False)
    page = FakePage()
    await service._click(page, loc)
    assert loc.ops.index("scroll") < loc.ops.index("hover") < loc.ops.index("click")
    assert page.mouse.moves  # a Bezier cursor path was walked to the target


async def test_submit_gate_blocks_until_approved():
    page = FakePage()
    loc = FakeLocator(editable=False, submit=True, transaction=True)
    res = await service._do_click(page, loc, allow_submit=False)
    assert "SUBMIT_NEEDS_APPROVAL" in res["error"] and loc.clicks == 0
    res = await service._do_click(page, loc, allow_submit=True)
    assert "error" not in res and loc.clicks == 1


async def test_a_search_button_is_an_ordinary_click():
    """P102: a form's search button (ePerolehan's "Cari") only looks things up: no approval.
    A button whose label also says it changes data still waits for a person."""
    page = FakePage()
    for label in ("Cari", "Carian btnSearch", "Search", " Tapis", "Lihat"):
        loc = FakeLocator(editable=False, submit=True, label=label)
        res = await service._do_click(page, loc, allow_submit=False)
        assert "error" not in res and loc.clicks == 1, label
    for label, transaction in (
        ("Hantar", True),
        ("Cari dan Simpan", True),
        ("Send", False),
        ("x", False),
        ("Search " + "z" * 80, False),
    ):
        loc = FakeLocator(editable=False, submit=True, transaction=transaction, label=label)
        res = await service._do_click(page, loc, allow_submit=False)
        assert "SUBMIT_NEEDS_APPROVAL" in res["error"] and loc.clicks == 0, label


async def test_focus_then_type_is_exactly_one_click():
    """The reported bug: the agent clicked the field several times before typing. Now a click
    on a field focuses it once (and says so), a second click no-ops, and type adds no click."""
    page = FakePage()
    loc = FakeLocator(editable=True, tag="input")
    res = await service._do_click(page, loc, allow_submit=False)
    assert res.get("focused") and "focused" in res["note"]
    assert loc.clicks == 1  # exactly one focusing click
    # the model (or a flaky re-render) clicks again: it must be a no-op now
    res2 = await service._do_click(page, loc, allow_submit=False)
    assert res2.get("focused") and loc.clicks == 1
    # typing focuses itself and never adds a click
    await service._type_field(loc, "demo.user")
    assert loc.clicks == 1 and loc.value == "demo.user"


async def test_scroll_is_multi_step():
    page = FakePage()
    await service._scroll(page, 700)
    assert len(page.mouse.wheels) >= 3
    assert sum(dy for _dx, dy in page.mouse.wheels) == 700  # same net distance


# ---------------------------------------------------------------- the machine pool


async def _fake_launch(monkeypatch):
    async def context_for(self):
        self.context = self.context or types.SimpleNamespace(name=f"ctx-{self.agent_id}")
        self.touch()
        return self.context

    monkeypatch.setattr(service.Machine, "context_for", context_for)


async def test_same_agent_reuses_its_machine(monkeypatch):
    await _fake_launch(monkeypatch)
    m1 = await service._acquire_machine("rafi")
    m2 = await service._acquire_machine("rafi")
    assert m1 is m2 and m1.context is not None  # one machine, kept warm


async def test_lru_idle_machine_is_evicted_when_pool_is_full(monkeypatch):
    await _fake_launch(monkeypatch)
    monkeypatch.setattr(service, "BROWSER_MAX_LIVE", 2)
    a = await service._acquire_machine("a")
    a.last = 100  # oldest
    b = await service._acquire_machine("b")
    b.last = 200
    await service._acquire_machine("c")  # pool full -> evict the LRU idle machine (a)
    assert "a" not in service.state["machines"]
    assert "b" in service.state["machines"] and "c" in service.state["machines"]


async def test_all_busy_raises(monkeypatch):
    await _fake_launch(monkeypatch)
    monkeypatch.setattr(service, "BROWSER_MAX_LIVE", 1)
    m = service.Machine("busy")
    m.context = types.SimpleNamespace()
    m.sessions["s1"] = types.SimpleNamespace(running=True, hold_until=0.0)  # in use
    service.state["machines"]["busy"] = m
    with pytest.raises(service.AllBrowsersBusy):
        await service._acquire_machine("newcomer")


async def test_a_full_machine_waits_for_its_own_tabs(monkeypatch):
    await _fake_launch(monkeypatch)
    monkeypatch.setattr(service, "TABS_PER_MACHINE", 1)
    m = await service._acquire_machine("solo")
    m.sessions["t1"] = types.SimpleNamespace(running=False, hold_until=0.0)
    with pytest.raises(service.AllBrowsersBusy):  # one tab already, cap is 1
        await service._acquire_machine("solo")


# ---------------------------------------------------------------- P59 the site budget


def _at(hh: int, mm: int = 0) -> float:
    from datetime import datetime
    from zoneinfo import ZoneInfo

    return datetime(2026, 11, 3, hh, mm, tzinfo=ZoneInfo(service.BUDGET_TZ)).timestamp()


def test_budget_knows_the_site_and_its_subdomains():
    assert service.budget_site("https://www.eperolehan.gov.my/x") == "eperolehan.gov.my"
    assert service.budget_site("https://eperolehan.gov.my") == "eperolehan.gov.my"
    assert service.budget_site("https://eperolehan.gov.my.evil.com") is None
    assert service.budget_site("https://example.com") is None


def test_budget_keeps_office_hours(monkeypatch):
    service._budgets.clear()
    monkeypatch.setattr(service, "BUDGET_HOURS", "07:30-22:00")
    rest, why = service.budget_check(("ws", "eperolehan.gov.my"), _at(23, 0))
    assert "office hours" in why and 8 * 3600 <= rest <= 9 * 3600  # until 07:30
    assert service.budget_check(("ws", "eperolehan.gov.my"), _at(9, 0)) == (0.0, "")


def test_budget_takes_a_break_after_a_long_sitting(monkeypatch):
    service._budgets.clear()
    monkeypatch.setattr(service, "BUDGET_SITTING_MIN", 25)
    key = ("ws", "eperolehan.gov.my")
    t = _at(10, 0)
    for i in range(26):  # one action a minute for 26 minutes
        rest, _ = service.budget_check(key, t + i * 60)
        if rest:
            break
    assert rest >= service.BUDGET_BREAK_MIN * 60  # a break of 4-10 minutes
    again, why = service.budget_check(key, t + i * 60 + 30)
    assert again > 0 and "break" in why  # still resting
    assert service.budget_check(key, t + i * 60 + rest + 1)[0] == 0  # back after the break
    other = service.budget_check(("other-ws", "eperolehan.gov.my"), t + i * 60)
    assert other == (0.0, "")  # another company has its own budget


def test_budget_caps_each_hour(monkeypatch):
    service._budgets.clear()
    monkeypatch.setattr(service, "BUDGET_PER_HOUR", 5)
    monkeypatch.setattr(service, "BUDGET_SITTING_MIN", 999)
    key = ("ws", "eperolehan.gov.my")
    t = _at(10, 0)
    for i in range(5):
        assert service.budget_check(key, t + i * 10)[0] == 0
    rest, why = service.budget_check(key, t + 60)
    assert "this hour" in why and rest > 3000

def test_budget_on_the_persons_own_pc_keeps_no_office_hours_or_breaks(monkeypatch):
    """P95: at 05:17 the window on the person's PC sat blank until 07:30."""
    service._budgets.clear()
    monkeypatch.setattr(service, "BUDGET_HOURS", "07:30-22:00")
    monkeypatch.setattr(service, "BUDGET_SITTING_MIN", 25)
    key = ("ws", "eperolehan.gov.my")
    assert service.budget_check(key, _at(5, 17), own_desk=True) == (0.0, "")
    assert service.budget_check(key, _at(23, 0))[0] > 0  # the office's own browsers still rest
    t = _at(10, 0)
    for i in range(40):  # one action a minute for 40 minutes: no break on the own PC
        assert service.budget_check(key, t + i * 60, own_desk=True) == (0.0, "")


def test_budget_on_the_own_pc_still_caps_each_hour(monkeypatch):
    service._budgets.clear()
    monkeypatch.setattr(service, "BUDGET_PER_HOUR", 5)
    key = ("ws", "eperolehan.gov.my")
    t = _at(5, 0)
    for i in range(5):
        assert service.budget_check(key, t + i * 10, own_desk=True)[0] == 0
    rest, why = service.budget_check(key, t + 60, own_desk=True)
    assert "this hour" in why and rest > 3000


# ---------------------------------------------------------------- P96 fifty people at once


def _session(remote: bool, agent: str = "a1", ws: str = "ws1"):
    m = service.Machine(agent, remote=remote, workspace_id=ws)
    s = service.Session("bs_" + agent, {"task_id": "t-" + agent, "agent_id": agent}, m, None)
    s.workspace_id = ws
    if remote:
        s.remote = object()  # a Chrome/Edge on the person's own computer
    return s


def test_own_pc_budget_is_each_persons_own(monkeypatch):
    """P96: 50 people of one company on their own computers used to share ONE hourly cap of
    90 actions, so after a few minutes everyone rested for up to an hour."""
    service._budgets.clear()
    monkeypatch.setattr(service, "BUDGET_PER_HOUR", 3)
    site = "eperolehan.gov.my"
    t = _at(10, 0)
    for agent in ("aina", "badrul", "chong"):  # three people, three actions each: all go
        s = _session(True, agent)
        for i in range(3):
            assert service.budget_check(service.budget_key(s, site), t + i, own_desk=True)[0] == 0
    s = _session(True, "aina")
    assert service.budget_check(service.budget_key(s, site), t + 9, own_desk=True)[0] > 0
    # The office's own browsers (one server address) still share the company's budget.
    a, b = _session(False, "x"), _session(False, "y")
    assert service.budget_key(a, site) == service.budget_key(b, site) == ("ws1", site)
    assert service.budget_key(_session(True, "x"), site) != service.budget_key(a, site)


async def test_clicks_on_a_persons_own_pc_never_wait_for_the_pool_gate():
    """P96: every click of every person's PC queued behind one lock (~2 s each over the
    relay): at 10 people a click waited ~17 s. Only our Camoufox pool needs the gate."""
    s = _session(True)
    page = FakePage()
    service._attach_page(s, _Closable(page), opened=False)
    remote_page = s.pages[0]
    loc = FakeLocator()
    gate = service._click_gate()
    await gate.acquire()  # another machine is mid-click
    try:
        await asyncio.wait_for(service._click(remote_page, loc), 1)
        assert loc.clicks == 1
        pool_page = FakePage()
        with pytest.raises(TimeoutError):  # a pool page still takes its turn
            await asyncio.wait_for(service._click(pool_page, FakeLocator()), 0.05)
    finally:
        gate.release()


async def test_a_closed_tab_forgets_its_cursor():
    s = _session(True)
    tab = _Closable(FakePage())
    service._attach_page(s, tab, opened=False)
    service._mouse_pos[id(tab)] = (1.0, 2.0)
    tab.fire("close")
    assert id(tab) not in service._mouse_pos


class _Closable:
    """A FakePage that also takes event handlers (download, close)."""

    def __init__(self, page) -> None:
        self._page = page
        self.handlers: dict = {}

    def __getattr__(self, name):
        return getattr(self._page, name)

    def on(self, event, fn):
        self.handlers[event] = fn

    def fire(self, event):
        self.handlers[event](self)


# ---------------------------------------------------------------- P97: a skilled hand


def _remote_page():
    s = _session(True, "pc")
    service._attach_page(s, _Closable(FakePage()), opened=False)
    return s, s.pages[0]


async def test_on_the_persons_pc_the_cursor_takes_a_short_curved_path():
    """P97: each cursor point is a round trip over the relay (12-22 cost ~1 s a click): a
    few points on the person's own computer, still curved, still ending on the target."""
    _, page = _remote_page()
    for _ in range(20):
        page.mouse.moves.clear()
        await service._human_mouse(page, 300.0, 200.0)
        assert 4 <= len(page.mouse.moves) <= 6  # 3-5 points and the correction
        assert page.mouse.moves[-1] == (300.0, 200.0)
    local = FakePage()
    await service._human_mouse(local, 300.0, 200.0)
    assert len(local.mouse.moves) >= 13  # the office's own browsers keep the long path


async def test_on_the_persons_pc_a_click_does_not_hover_twice():
    _, page = _remote_page()
    loc = FakeLocator()
    await service._click(page, loc)
    assert "hover" not in loc.ops and loc.clicks == 1  # the hand is already there
    loc2 = FakeLocator()
    await service._click(FakePage(), loc2)
    assert "hover" in loc2.ops


async def test_filling_a_form_on_the_pc_is_paced_by_the_typing_not_by_extra_waits(monkeypatch):
    waits: list[float] = []

    async def sleep(d, *_a, **_k):
        waits.append(d)

    monkeypatch.setattr(service.asyncio, "sleep", sleep)
    s = _session(True)
    s.last_server = service.time.time()  # an action a moment ago
    await service._pace(s, "type")
    assert waits == []  # a field right after: no extra wait
    await service._pace(s, "click")
    assert waits and waits[0] >= service.PC_PACE_MIN * 0.9  # a click still keeps the gap
    waits.clear()
    s2 = _session(False)
    s2.last_server = service.time.time()
    await service._pace(s2, "type")
    assert waits  # the office's own browsers are unchanged


def test_a_batch_step_is_an_ordinary_action_and_never_a_send():
    a = service._step_act({"do": "open", "url": "https://x.example/a"})
    assert a.action == "goto" and a.url == "https://x.example/a"
    a = service._step_act({"do": "type", "role": "textbox", "name": "No. Rujukan", "text": "QT1"})
    assert (a.action, a.role, a.name, a.text) == ("type", "textbox", "No. Rujukan", "QT1")
    a = service._step_act({"do": "check", "name": "Setuju", "on": False})
    assert a.action == "check" and a.text == "false"
    a = service._step_act({"do": "click", "name": "Cari", "expect": "1 rekod"})
    assert a.expect == "1 rekod" and not a.allow_submit
    for bad in ({"do": "submit"}, {"do": "upload"}, {"do": "login_submit"}, {"do": ""}):
        with pytest.raises(ValueError):
            service._step_act(bad)
    with pytest.raises(ValueError):
        service._step_act({"do": "press", "key": "Enter"})


def _nodes(*items):
    return {"nodes": [dict(ref=r, role=ro, name=n, tag="a") for r, ro, n in items]}


async def test_an_element_is_found_by_role_and_name_one_match_only(monkeypatch):
    monkeypatch.setattr(service, "NAME_WAIT", 0)
    snap = _nodes(
        ("e3", "link", "Papan Kenyataan"),
        ("e4", "link", "Papan Kenyataan Lama"),
        ("e7", "button", "Cari"),
        ("e8", "link", "Lihat QT260104"),
        ("e9", "link", "Lihat QT260105"),
    )

    async def nodes(_page, **_k):
        return snap

    monkeypatch.setattr(service, "_snapshot_nodes", nodes)
    page = FakePage()
    assert await service._by_name(page, "link", "Papan Kenyataan") == ("e3", "")  # exact first
    assert await service._by_name(page, "", "cari") == ("e7", "")
    ref, why = await service._by_name(page, "link", "Lihat")
    assert ref is None and "2 elements match" in why and "e8" in why  # never guessed
    ref, why = await service._by_name(page, "button", "Simpan")
    assert ref is None and "Nothing on the page" in why


async def test_a_page_still_loading_is_looked_at_again(monkeypatch):
    monkeypatch.setattr(service, "NAME_WAIT", 5)
    calls = {"n": 0}

    async def nodes(_page, **_k):
        calls["n"] += 1
        return _nodes(("e5", "button", "Semak")) if calls["n"] >= 3 else _nodes()

    monkeypatch.setattr(service, "_snapshot_nodes", nodes)
    assert await service._by_name(FakePage(), "button", "Semak") == ("e5", "")
    assert calls["n"] == 3


async def test_a_batch_stops_at_the_first_surprise(monkeypatch):
    done: list[str] = []

    async def run(s, sid, body, observe=True):
        assert observe is False
        done.append(body.name or body.action)
        if body.name == "Simpan":
            return {"error": "SUBMIT_NEEDS_APPROVAL: this control sends the form."}
        return {"ok": True, "url": "https://x.example/", "point": None}

    async def observe(s, point=None, **_k):
        return {"url": "https://x.example/", "rev": 2, "mode": "delta", "delta": ""}

    async def nothing(_s):
        return None

    monkeypatch.setattr(service, "_run_action", run)
    monkeypatch.setattr(service, "_observe", observe)
    monkeypatch.setattr(service, "_guard_frames", nothing)
    s = _session(True)
    s.page = FakePage()
    body = service.Act(
        action="steps",
        steps=[
            {"do": "type", "name": "Catatan", "text": "x"},
            {"do": "click", "name": "Simpan"},
            {"do": "click", "name": "Seterusnya"},
        ],
    )
    obs = await service._do_steps(s, "bs_pc", body)
    assert done == ["Catatan", "Simpan"]  # nothing after the stop
    assert obs["steps_done"] == 1
    assert "SUBMIT_NEEDS_APPROVAL" in obs["steps"][1]["error"]


async def test_a_batch_rests_when_the_site_budget_says_so(monkeypatch):
    async def run(s, sid, body, observe=True):
        if body.name == "B":
            return {"error": "SITE_REST: enough for this hour", "retry_after": 600}
        return {"ok": True, "url": "https://x.example/"}

    async def observe(s, point=None, **_k):
        return {"url": "https://x.example/", "rev": 1, "mode": "same"}

    async def nothing(_s):
        return None

    monkeypatch.setattr(service, "_run_action", run)
    monkeypatch.setattr(service, "_observe", observe)
    monkeypatch.setattr(service, "_guard_frames", nothing)
    s = _session(True)
    s.page = FakePage()
    body = service.Act(action="steps", steps=[{"do": "click", "name": "A"}, {"do": "click", "name": "B"}])
    obs = await service._do_steps(s, "bs_pc", body)
    assert obs["retry_after"] == 600 and obs["steps_done"] == 1 and "SITE_REST" in obs["error"]


async def test_a_second_click_waits_for_the_page_instead_of_clicking_again(monkeypatch):
    """P97: one deliberate click per intent. The first click showed nothing yet; the page
    changes while the agent thinks; the second click is not made."""
    s = _session(True)
    s.page = FakePage("https://x.example/carian")
    s.last_click = {"ref": "e7", "url": s.page.url, "rev": 4, "changed": False}

    async def observe(s, point=None, **_k):
        return {"url": s.page.url, "rev": 5, "mode": "delta", "delta": "+ row"}

    monkeypatch.setattr(service, "_observe", observe)
    held = await service._held_click(s, "e7", service.Act(action="click", ref="e7"))
    assert held is not None and "Not clicked again" in held["note"]
    # Unchanged meanwhile: the click goes ahead (None); another element is never held.
    s.last_click = {"ref": "e7", "url": s.page.url, "rev": 5, "changed": False}
    assert await service._held_click(s, "e7", service.Act(action="click", ref="e7")) is None
    assert await service._held_click(s, "e9", service.Act(action="click", ref="e9")) is None
