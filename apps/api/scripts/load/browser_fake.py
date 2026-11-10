# ruff: noqa: S110, S311 - a test harness: fakes, random sizes
"""The REAL browser service (apps/browser/service.py) with a fake Playwright, for the load
harness (never in CI).

Every call the service makes on a person's-PC page (goto, evaluate, screenshot, mouse moves,
clicks, request interception) becomes a round trip through the API's real CDP relay to a
fake PC (fake_pcs.py, echo mode), carrying the bytes a real Chrome would send: the 17 KB
snapshot script, the page tree it returns, a JPEG frame, one Fetch.requestPaused per page
resource. So the service's own code (sessions, pace, site budget, the click gate, snapshot
rendering and deltas) and the API relay are measured at 50 sessions without 50 browsers.

    python scripts/load/browser_fake.py --port 8562

GET /loadstats: event-loop lag (p50/p95/max ms), click-gate waits, open sessions.
"""

import argparse
import asyncio
import json
import os
import random
import statistics
import sys
import time
from pathlib import Path
from typing import Any

import websockets

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[3] / "browser"))

# Sizes of the real traffic (bytes) and the browser-side work (ms) each call stands for.
SNAPSHOT_REQ = 17_500  # SNAPSHOT_JS travels with every snapshot call
SHOT_BYTES = 60_000  # a 1280x900 JPEG at quality 55 (base64 adds a third on the wire)
RESOURCES_NAV = 25  # requests intercepted (Fetch.requestPaused) per full page load
RESOURCES_POST = 12  # after a click that posts a form
SITE_MS = (250, 700)  # the portal's own answer time
STATS: dict[str, Any] = {"lag": [], "gate_waits": [], "rt": 0, "rt_bytes": 0}


def _nodes(nav: int, clicks: int) -> list[dict[str, Any]]:
    """An ePerolehan-like page: menu, search form, a 40-row tender table."""
    nodes: list[dict[str, Any]] = [{"role": "main", "p": -1, "tag": "div"}]
    ref = 0

    def add(role: str, name: str, parent: int, **kw: Any) -> int:
        nonlocal ref
        ref += 1
        nodes.append(
            {"role": role, "name": name, "ref": f"e{ref}", "p": parent, "inview": ref < 60, **kw}
        )
        return len(nodes) - 1

    nav_i = add("navigation", "Menu", 0)
    for i in range(24):
        add("link", f"Menu item {i} page {nav}", nav_i, tag="a", st={"href": f"/m/{i}"})
    form = add("form", "Carian", 0)
    for i in range(10):
        add("textbox", f"Field {i}", form, tag="input", st={"type": "text", "value": ""})
    add("combobox", "Kategori", form, tag="select", st={"options": ["Bekalan", "Perkhidmatan"]})
    add("button", "Cari", form, tag="button")
    table = add("table", "Senarai tender", 0)
    for r in range(40):
        row = add(
            "row", f"QT{nav:03d}{r:04d} Tender row {r} status {clicks if r == 0 else 0}", table
        )
        add("link", f"QT{nav:03d}{r:04d}", row, tag="a", st={"href": f"/t/{r}"})
    add("heading", f"Page {nav}", 0, st={"level": 1})
    return nodes


class Conn:
    """One relay socket to a fake PC: numbered requests, answers matched by id."""

    def __init__(self, ws: Any) -> None:
        self.ws, self.n, self.waiting = ws, 0, {}
        self.reader = asyncio.create_task(self._read())
        self.closed = False

    async def _read(self) -> None:
        try:
            async for raw in self.ws:
                m = json.loads(raw)
                fut = self.waiting.pop(m.get("id"), None)
                if fut is not None and not fut.done():
                    fut.set_result(len(raw))
        except Exception:  # noqa: BLE001
            pass
        self.closed = True
        for fut in self.waiting.values():
            if not fut.done():
                fut.set_exception(RuntimeError("Target closed"))

    async def rt(self, req: int = 200, resp: int = 100, work_ms: float = 2) -> None:
        if self.closed:
            raise RuntimeError("Target page, context or browser has been closed")
        self.n += 1
        fut = asyncio.get_running_loop().create_future()
        self.waiting[self.n] = fut
        body = json.dumps({"id": self.n, "r": resp, "d": work_ms, "q": "q" * req})
        await self.ws.send(body)
        got = await asyncio.wait_for(fut, 30)
        STATS["rt"] += 1
        STATS["rt_bytes"] += len(body) + got


class Req:
    def __init__(self, page: "Page", url: str, nav: bool) -> None:
        self.url, self._nav, self.frame = url, nav, page.frame

    def is_navigation_request(self) -> bool:
        return self._nav


class Route:
    def __init__(self, page: "Page", url: str, nav: bool) -> None:
        self.page, self.request = page, Req(page, url, nav)

    async def continue_(self) -> None:
        await self.page.conn.rt(160, 1500, 1)  # the paused request (headers) and our answer

    async def abort(self, *_: Any) -> None:
        await self.page.conn.rt(120, 60, 1)


class Frame:
    def __init__(self, page: "Page") -> None:
        self.page, self.parent_frame = page, None

    @property
    def url(self) -> str:
        return self.page._url

    async def goto(self, url: str, **_: Any) -> None:
        self.page._url = url


class Mouse:
    def __init__(self, page: "Page") -> None:
        self.page = page

    async def move(self, *_: Any, **__: Any) -> None:
        await self.page.conn.rt(220, 60, 1)  # Input.dispatchMouseEvent

    async def wheel(self, *_: Any) -> None:
        await self.page.conn.rt(220, 60, 2)


class Keyboard:
    def __init__(self, page: "Page") -> None:
        self.page = page

    async def press(self, *_: Any, **__: Any) -> None:
        await self.page.conn.rt(220, 60, 2)


class Locator:
    def __init__(self, page: "Page") -> None:
        self.page = page

    async def _rt(self, n: int = 1) -> None:
        for _ in range(n):
            await self.page.conn.rt(450, 400, 2)

    async def count(self) -> int:
        await self._rt()
        return 1

    async def evaluate(self, js: str, *_: Any) -> Any:
        await self._rt()
        if "transaction" in js:
            return {"submit": False, "transaction": False, "label": "Seterusnya"}
        if "editable" in js:
            return {"editable": False, "focused": False, "tag": "a"}
        return True

    async def evaluate_all(self, *_: Any) -> int:
        await self._rt()
        return 0

    def nth(self, _: int) -> "Locator":
        return self

    @property
    def first(self) -> "Locator":
        return self

    async def bounding_box(self) -> dict[str, float]:
        await self._rt(2)
        return {
            "x": random.uniform(100, 900),
            "y": random.uniform(100, 700),
            "width": 90,
            "height": 22,
        }

    async def scroll_into_view_if_needed(self, **_: Any) -> None:
        await self._rt(2)

    async def hover(self, **_: Any) -> None:
        await self._rt(3)

    async def click(self, **_: Any) -> None:
        await self._rt(4)  # actionability checks, then mouse down and up
        self.page.clicks += 1
        await self.page._load(RESOURCES_POST)  # ePerolehan: every click posts the form

    async def focus(self, **_: Any) -> None:
        await self._rt()

    async def fill(self, *_: Any, **__: Any) -> None:
        await self._rt(2)

    async def press_sequentially(self, *_: Any, **__: Any) -> None:
        await self._rt()

    async def press(self, *_: Any, **__: Any) -> None:
        await self._rt()

    async def select_option(self, **_: Any) -> None:
        await self._rt(2)

    async def is_checked(self) -> bool:
        await self._rt()
        return False

    async def set_checked(self, *_: Any, **__: Any) -> None:
        await self._rt(2)


class Page:
    def __init__(self, ctx: "Context") -> None:
        self.ctx, self.conn = ctx, ctx.conn
        self._url = "about:blank"
        self.frame = Frame(self)
        self.mouse, self.keyboard = Mouse(self), Keyboard(self)
        self.nav, self.clicks, self.idle_at = 0, 0, 0.0
        self._closed = False

    @property
    def url(self) -> str:
        return self._url

    @property
    def frames(self) -> list[Frame]:
        return [self.frame]

    def on(self, *_: Any) -> None:
        pass

    def is_closed(self) -> bool:
        return self._closed

    async def close(self) -> None:
        self._closed = True

    async def _load(self, resources: int) -> None:
        await self.conn.rt(300, 200, random.uniform(*SITE_MS))  # Page.navigate / the POST
        handler = self.ctx.handler
        urls = [self._url] + [
            f"https://eperolehan.gov.my/static/r{i}.js" for i in range(resources - 1)
        ]
        if handler is not None:
            for i in range(0, len(urls), 6):  # six at a time per host, like Chrome
                await asyncio.gather(
                    *(
                        handler(Route(self, u, j == 0 and i == 0))
                        for j, u in enumerate(urls[i : i + 6])
                    )
                )
        for _ in range(8):  # lifecycle and network events
            await self.conn.rt(60, 500, 0)
        self.nav += 1
        self.idle_at = time.monotonic() + 0.5  # networkidle: 500 ms with no requests

    async def goto(self, url: str, **_: Any) -> None:
        self._url = url
        await self._load(RESOURCES_NAV)

    async def go_back(self, **_: Any) -> Any:
        await self._load(RESOURCES_POST)
        return True

    async def wait_for_load_state(self, state: str = "load", **_: Any) -> None:
        if state == "networkidle":
            wait = self.idle_at - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)

    async def title(self) -> str:
        await self.conn.rt(200, 150, 1)
        return "ePerolehan"

    async def content(self) -> str:
        await self.conn.rt(200, 60_000, 5)
        return "<html></html>"

    async def evaluate(self, js: str, arg: Any = None) -> Any:
        from service import BOLD_ROWS_JS, TEXT_JS
        from snapshot import SNAPSHOT_JS

        if js == SNAPSHOT_JS:
            nodes = _nodes(self.nav, self.clicks)
            out = {"nodes": nodes, "doc": f"doc{self.nav}", "auth_form": None}
            await self.conn.rt(SNAPSHOT_REQ, len(json.dumps(out)), 25)
            return out
        if js == TEXT_JS:
            text = "\n".join(str(n.get("name") or "") for n in _nodes(self.nav, self.clicks))
            await self.conn.rt(500, len(text), 5)
            return text
        await self.conn.rt(400, 120, 2)
        if js == BOLD_ROWS_JS:
            return []
        if "contentType" in js:
            return "text/html"
        if "querySelector('iframe" in js:
            return False
        return None

    async def screenshot(self, **_: Any) -> bytes:
        await self.conn.rt(200, SHOT_BYTES * 4 // 3, 35)  # encoded on the PC, base64 on the wire
        return os.urandom(SHOT_BYTES)

    def locator(self, _: str) -> Locator:
        return Locator(self)

    def frame_locator(self, _: str) -> "Page":
        return self


class Context:
    def __init__(self, conn: Conn) -> None:
        self.conn, self.handler = conn, None
        self.pages: list[Page] = [Page(self)]

    def on(self, *_: Any) -> None:
        pass

    async def route(self, _: str, handler: Any) -> None:
        await self.conn.rt(300, 100, 1)  # Fetch.enable
        self.handler = handler

    async def add_cookies(self, cookies: list) -> None:
        await self.conn.rt(200 + 300 * len(cookies), 60, 1)

    async def new_page(self) -> Page:
        await self.conn.rt(300, 400, 20)
        p = Page(self)
        self.pages.append(p)
        return p

    async def storage_state(self) -> dict:
        await self.conn.rt(200, 4000, 5)
        return {"cookies": [], "origins": []}

    async def clear_cookies(self, **_: Any) -> None:
        await self.conn.rt(200, 60, 1)


class Browser:
    def __init__(self, conn: Conn) -> None:
        self.conn = conn
        self.contexts = [Context(conn)]
        self._on_close: list[Any] = []

    def on(self, event: str, cb: Any) -> None:
        if event == "disconnected":
            self._on_close.append(cb)

    async def new_context(self) -> Context:
        return self.contexts[0]

    async def close(self) -> None:
        await self.conn.ws.close()
        for cb in self._on_close:
            cb(self)


class Chromium:
    async def connect_over_cdp(
        self, url: str, headers: dict | None = None, timeout: float = 30_000
    ) -> Browser:
        ws = await websockets.connect(
            url, additional_headers=headers or {}, max_size=None, open_timeout=timeout / 1000
        )
        conn = Conn(ws)
        for req, resp in ((200, 300), (300, 2500), (400, 1500), (300, 800), (300, 800), (300, 300)):
            await conn.rt(req, resp, 3)  # getVersion, setAutoAttach, the target attach dance
        return Browser(conn)


class FakePlaywright:
    chromium = Chromium()

    async def stop(self) -> None:
        pass


class TimedLock(asyncio.Lock):
    async def acquire(self) -> bool:
        t0 = time.perf_counter()
        ok = await super().acquire()
        STATS["gate_waits"].append(time.perf_counter() - t0)
        return ok


async def _lag() -> None:
    while True:
        t0 = time.perf_counter()
        await asyncio.sleep(0.05)
        STATS["lag"].append((time.perf_counter() - t0 - 0.05) * 1000)
        del STATS["lag"][:-20000]


def _pct(xs: list[float], p: float) -> float:
    if not xs:
        return 0.0
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(p * len(xs)))]


def build_app():
    import service
    from starlette.responses import JSONResponse

    async def playwright() -> FakePlaywright:
        return FakePlaywright()

    service._playwright = playwright
    service._CLICK_GATE = TimedLock()
    app = service.app

    @app.get("/loadstats")
    async def loadstats() -> JSONResponse:
        lag, gw = STATS["lag"], STATS["gate_waits"]
        return JSONResponse(
            {
                "lag_p50_ms": round(_pct(lag, 0.5), 1),
                "lag_p95_ms": round(_pct(lag, 0.95), 1),
                "lag_max_ms": round(max(lag or [0]), 1),
                "gate_n": len(gw),
                "gate_wait_p50_s": round(_pct(gw, 0.5), 3),
                "gate_wait_p95_s": round(_pct(gw, 0.95), 3),
                "gate_wait_mean_s": round(statistics.fmean(gw), 3) if gw else 0,
                "relay_round_trips": STATS["rt"],
                "relay_mb": round(STATS["rt_bytes"] / 1e6, 1),
                "sessions": len(service.state["sessions"]),
            }
        )

    @app.post("/loadstats/reset")
    async def reset() -> JSONResponse:
        if "lagger" not in STATS:  # the service has a lifespan: no startup hooks
            STATS["lagger"] = asyncio.create_task(_lag())
        STATS["lag"].clear()
        STATS["gate_waits"].clear()
        STATS["rt"] = STATS["rt_bytes"] = 0
        return JSONResponse({"ok": True})

    return app


def main() -> None:
    import uvicorn

    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8562)
    a = p.parse_args()
    uvicorn.run(build_app(), host="127.0.0.1", port=a.port, log_level="warning")


if __name__ == "__main__":
    main()
