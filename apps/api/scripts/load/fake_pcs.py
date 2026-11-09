# ruff: noqa: ASYNC220, ASYNC240, S110, S311 - a test harness (local processes)
"""Many fake "Agentic Office PC" apps in one process, for the load harness (never in CI).

Each one links like the real app (apps/pc-agent/agent.cjs): it says hello on
/api/devices/connect with its token, pings, and answers `browser.open` by opening the CDP
relay socket /api/devices/cdp/{channel}. Two kinds of browser behind the relay:

- echo (default): a stand-in browser that answers the harness's fake Playwright
  (fake_pw.py). Every request names the size of the answer it wants and the browser-side
  work it stands for, so the relay carries the bytes a real Chrome would send. RTT seconds
  are added to every answer for the person's internet line.
- edge: a real headless Microsoft Edge per PC, piped to the relay exactly like the real app
  (only for a handful: each costs 150-250 MB).

    python scripts/load/fake_pcs.py --api http://127.0.0.1:8561 --tokens tokens.json
"""

import argparse
import asyncio
import contextlib
import json
import random
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import websockets

OPTS = argparse.Namespace(api="", rtt=0.04, mode="echo", edge="")
STATS = {"relay_msgs_in": 0, "relay_bytes_in": 0, "relay_msgs_out": 0, "relay_bytes_out": 0}
PAD = "x" * (1 << 20)


def _ws(path: str) -> str:
    return ("ws" + OPTS.api[4:] if OPTS.api.startswith("http") else OPTS.api) + path


class PC:
    def __init__(self, token: str, n: int) -> None:
        self.token, self.n = token, n
        self.relays: dict[str, asyncio.Task] = {}
        self.edges: dict[str, subprocess.Popen] = {}
        self.connected = asyncio.Event()

    async def run(self) -> None:
        while True:
            try:
                await self._session()
            except Exception as e:  # noqa: BLE001 - reconnect like the real app
                print(f"pc{self.n}: {e.__class__.__name__}: {e}", flush=True)
            self.connected.clear()
            await asyncio.sleep(1 + random.random())

    async def _session(self) -> None:
        async with websockets.connect(_ws("/api/devices/connect"), max_size=None) as ws:
            await ws.send(
                json.dumps(
                    {
                        "type": "hello",
                        "token": self.token,
                        "version": "0.5.2",
                        "os": "windows",
                        "arch": "x64",
                        "hostname": f"LOAD-PC-{self.n:03d}",
                        "folders": [],
                        "paused": False,
                        "browsers": ["chrome", "edge"],
                        "remote": "off",
                        "tunnel": {"on": True, "hosts": ["eperolehan.gov.my"]},
                    }
                )
            )
            welcome = json.loads(await ws.recv())
            if welcome.get("type") != "welcome":
                raise RuntimeError(f"refused: {welcome}")
            self.connected.set()
            pinger = asyncio.create_task(self._ping(ws))
            try:
                async for raw in ws:
                    m = json.loads(raw)
                    if m.get("type") == "call":
                        asyncio.create_task(self._call(ws, m))  # noqa: RUF006
            finally:
                pinger.cancel()

    async def _ping(self, ws) -> None:
        while True:
            await asyncio.sleep(20)
            await ws.send(json.dumps({"type": "ping"}))

    async def _call(self, ws, m: dict) -> None:
        method, params = m.get("method"), m.get("params") or {}
        try:
            if method == "browser.open":
                data = await self._open(str(params["channel"]))
            elif method == "browser.close":
                self._close(str(params.get("channel") or ""))
                data = {}
            else:
                data = {}
            out = {"type": "result", "id": m["id"], "ok": True, "data": data}
        except Exception as e:  # noqa: BLE001
            out = {
                "type": "result",
                "id": m["id"],
                "ok": False,
                "error": {"code": "failed", "message": str(e)},
            }
        await ws.send(json.dumps(out))

    async def _open(self, channel: str) -> dict:
        for old in list(self.relays):
            self._close(old)  # one AI browser per computer, like the real app
        relay = await websockets.connect(
            _ws(f"/api/devices/cdp/{channel}"), max_size=None, compression=None
        )
        await relay.send(json.dumps({"type": "hello", "token": self.token}))
        if OPTS.mode == "edge":
            local = await self._edge(channel)
            self.relays[channel] = asyncio.create_task(self._pipe(relay, local, channel))
            return {"browser": "edge", "version": "headless"}
        self.relays[channel] = asyncio.create_task(self._echo(relay, channel))
        return {"browser": "chrome", "version": "echo"}

    def _close(self, channel: str) -> None:
        t = self.relays.pop(channel, None)
        if t is not None:
            t.cancel()
        p = self.edges.pop(channel, None)
        if p is not None:
            with contextlib.suppress(Exception):
                p.kill()

    async def _echo(self, relay, channel: str) -> None:
        """Answer each request after the line's delay plus the browser-side work it names."""

        async def answer(req: dict) -> None:
            await asyncio.sleep(OPTS.rtt + float(req.get("d") or 0) / 1000)
            body = json.dumps({"id": req["id"], "p": PAD[: int(req.get("r") or 0)]})
            STATS["relay_msgs_out"] += 1
            STATS["relay_bytes_out"] += len(body)
            with contextlib.suppress(Exception):
                await relay.send(body)

        try:
            async for raw in relay:
                STATS["relay_msgs_in"] += 1
                STATS["relay_bytes_in"] += len(raw)
                req = json.loads(raw)
                if isinstance(req, dict) and "id" in req:
                    asyncio.create_task(answer(req))  # noqa: RUF006
        except Exception:  # noqa: BLE001 - the relay ended
            pass
        finally:
            with contextlib.suppress(Exception):
                await relay.close()

    async def _edge(self, channel: str):
        profile = Path(tempfile.mkdtemp(prefix=f"loadpc{self.n}-"))
        proc = subprocess.Popen(  # noqa: S603 - a fixed local browser for the harness
            [
                OPTS.edge,
                "--headless=new",
                f"--user-data-dir={profile}",
                "--remote-debugging-port=0",
                "--remote-debugging-address=127.0.0.1",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-gpu",
                "--window-size=1280,900",
                "about:blank",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self.edges[channel] = proc
        port_file = profile / "DevToolsActivePort"
        for _ in range(200):
            if port_file.exists() and len(port_file.read_text().splitlines()) >= 2:
                break
            await asyncio.sleep(0.1)
        port, path = port_file.read_text().splitlines()[:2]
        return await websockets.connect(f"ws://127.0.0.1:{port}{path}", max_size=None)

    async def _pipe(self, relay, local, channel: str) -> None:
        async def one(src, dst, counted: bool) -> None:
            async for msg in src:
                if counted:
                    STATS["relay_msgs_out"] += 1
                    STATS["relay_bytes_out"] += len(msg)
                else:
                    STATS["relay_msgs_in"] += 1
                    STATS["relay_bytes_in"] += len(msg)
                await dst.send(msg)

        tasks = [
            asyncio.create_task(one(relay, local, False)),
            asyncio.create_task(one(local, relay, True)),
        ]
        try:
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for t in tasks:
                t.cancel()
            self._close(channel)


async def amain(tokens: list[str], stats_file: str) -> None:
    pcs = [PC(t, i) for i, t in enumerate(tokens)]
    for pc in pcs:
        asyncio.create_task(pc.run())  # noqa: RUF006
        await asyncio.sleep(0.02)
    t0 = time.time()
    await asyncio.wait_for(asyncio.gather(*(pc.connected.wait() for pc in pcs)), 60)
    print(f"{len(pcs)} fake PCs connected in {time.time() - t0:.1f}s", flush=True)
    while True:
        await asyncio.sleep(1)
        if stats_file:
            Path(stats_file).write_text(json.dumps(STATS))


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--api", default="http://127.0.0.1:8561")
    p.add_argument("--tokens", required=True)
    p.add_argument("--rtt", type=float, default=0.04)
    p.add_argument("--mode", choices=["echo", "edge"], default="echo")
    p.add_argument(
        "--edge",
        default=shutil.which("msedge")
        or r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    )
    p.add_argument("--stats", default="")
    a = p.parse_args()
    OPTS.__dict__.update(vars(a))
    tokens = json.loads(Path(a.tokens).read_text())
    asyncio.run(amain(tokens, a.stats))


if __name__ == "__main__":
    main()
