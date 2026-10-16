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
        self, *, editable=False, submit=False, transaction=False, is_password=False, tag="input"
    ) -> None:
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
            return {"submit": self.submit, "transaction": self.transaction, "label": "x"}
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
    monkeypatch.setattr(service, "TYPO_RATE", 0.0)
    monkeypatch.setattr(service, "_type_delay", lambda ch="": 0.0)

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
