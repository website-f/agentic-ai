# ruff: noqa: ASYNC110, ASYNC220, ASYNC221, ASYNC240, S105, S106, S108 - a local harness
"""Load harness: N people start ePerolehan work on their own PCs at the same moment.

Runs the real pieces on this machine, each in its own process so CPU and memory are its own:
the API (uvicorn: PC sockets, CDP relay, events), the real Temporal worker (scripts/load/
worker.py), the real browser service with a fake Playwright (browser_fake.py), a fake model
(fake_llm.py) and N fake PC apps (fake_pcs.py). Temporal is the SDK's local test server; Postgres
and Valkey are throwaway (yours). Never run in CI.

    cd apps/api
    docker run -d --name load-pg ... -p 127.0.0.1:8551:5432 pgvector/pgvector:0.8.6-pg17-trixie
    .venv/Scripts/python scripts/load/run.py --people 10 25 50 --out load.json

Measured per run: time to the first page shown (task start -> first frame in Valkey), each
browser action's latency (model reply -> page back), queue wait of task_step (Temporal
scheduled -> started), task_step run time, tasks done, CPU seconds and peak memory of each
process, peak Postgres connections, the bytes the relay carried, browser-service event-loop
lag and click-gate waits.
"""

import argparse
import asyncio
import contextlib
import ctypes
import json
import os
import statistics
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
API_DIR = HERE.parents[1]
PY = sys.executable
TEMPORAL_EXE = Path(os.environ.get("TEMP", "/tmp")) / "temporal-test-server-sdk-python-1.34.0.exe"
EP = "eperolehan.gov.my"


def env_for(a: argparse.Namespace) -> dict[str, str]:
    e = dict(os.environ)
    e.update(
        {
            "AGENTIC_ENV": "dev",
            "AGENTIC_DATABASE_URL": f"postgresql+asyncpg://{a.pg}/{a.db}",
            "AGENTIC_VALKEY_URL": a.valkey,
            "AGENTIC_TEMPORAL_ADDRESS": f"localhost:{a.temporal_port}",
            "AGENTIC_TEMPORAL_TASK_QUEUE": "load-main",
            "AGENTIC_BROWSER_URL": f"http://127.0.0.1:{a.browser_port}",
            "AGENTIC_INTERNAL_API_URL": f"http://127.0.0.1:{a.api_port}",
            "AGENTIC_PUBLIC_URL": f"http://127.0.0.1:{a.api_port}",
            "AGENTIC_EMBED_BACKEND": "hash",
            "AGENTIC_PRIVATE_HOSTS_ALLOWED": f"127.0.0.1,localhost,{EP}",
            "AGENTIC_DEV_SEED": "false",
            "AGENTIC_NEW_WORKSPACE_REQUIRE_2FA": "off",
            "AGENTIC_PRIMA_PACK": "false",
            "AGENTIC_WEB_SEARCH_ENABLED": "false",
            "AGENTIC_DEVICE_RECONNECT_WAIT": "5",
            "AGENTIC_VAULT_DIR": str(Path(os.environ.get("TEMP", "/tmp")) / "load-vault"),
            "BROWSER_TOKEN": "dev-browser-token",
            "BROWSER_ALLOW_HOSTS": EP,  # no DNS for the portal from this laptop
            "PYTHONUNBUFFERED": "1",
        }
    )
    for k, v in a.env:
        e[k] = v
    return e


# ---------------------------------------------------------------- processes and their cost


class Proc:
    """A child Python process that reports its own pid (the venv launcher on Windows is a
    separate process from the interpreter that does the work)."""

    def __init__(self, name: str, argv: list[str], env: dict[str, str], log_dir: Path) -> None:
        self.name = name
        pidfile = log_dir / f"{name}.pid"
        pidfile.unlink(missing_ok=True)
        code = (
            "import os,sys,runpy;"
            f"open({str(pidfile)!r},'w').write(str(os.getpid()));"
            f"sys.argv={argv!r};"
            + (
                f"runpy.run_module({argv[0][2:]!r}, run_name='__main__', alter_sys=True)"
                if argv[0].startswith("-m")
                else f"runpy.run_path({argv[0]!r}, run_name='__main__')"
            )
        )
        self.log = open(log_dir / f"{name}.log", "w")  # noqa: SIM115
        self.p = subprocess.Popen(  # noqa: S603 - our own scripts
            [PY, "-c", code], cwd=API_DIR, env=env, stdout=self.log, stderr=subprocess.STDOUT
        )
        self.pidfile = pidfile
        self.pid = 0

    def wait_pid(self) -> int:
        for _ in range(300):
            if self.pidfile.exists() and self.pidfile.read_text().strip():
                self.pid = int(self.pidfile.read_text())
                return self.pid
            time.sleep(0.1)
        raise RuntimeError(f"{self.name} did not start")

    def stop(self) -> None:
        with contextlib.suppress(Exception):
            self.p.kill()
        if self.pid:
            with contextlib.suppress(Exception):
                os.kill(self.pid, 9)


class _FT(ctypes.Structure):
    _fields_ = [("lo", ctypes.c_uint32), ("hi", ctypes.c_uint32)]


class _PMC(ctypes.Structure):
    _fields_ = [
        ("cb", ctypes.c_uint32),
        ("PageFaultCount", ctypes.c_uint32),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
    ]


def proc_usage(pid: int) -> tuple[float, int]:
    """(CPU seconds so far, working set bytes) of a process."""
    if os.name != "nt":
        with open(f"/proc/{pid}/stat") as f:
            parts = f.read().split(")")[1].split()
        cpu = (int(parts[11]) + int(parts[12])) / os.sysconf("SC_CLK_TCK")
        with open(f"/proc/{pid}/statm") as f:
            rss = int(f.read().split()[1]) * os.sysconf("SC_PAGE_SIZE")
        return cpu, rss
    k32 = ctypes.windll.kernel32
    h = k32.OpenProcess(0x1000 | 0x0010, False, pid)
    if not h:
        return 0.0, 0
    try:
        c, e, k, u = _FT(), _FT(), _FT(), _FT()
        k32.GetProcessTimes(h, ctypes.byref(c), ctypes.byref(e), ctypes.byref(k), ctypes.byref(u))
        cpu = (((k.hi << 32) | k.lo) + ((u.hi << 32) | u.lo)) / 1e7
        pmc = _PMC()
        pmc.cb = ctypes.sizeof(_PMC)
        ctypes.windll.psapi.GetProcessMemoryInfo(h, ctypes.byref(pmc), pmc.cb)
        return cpu, int(pmc.WorkingSetSize)
    finally:
        k32.CloseHandle(h)


def pct(xs: list[float], p: float) -> float:
    if not xs:
        return 0.0
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(p * len(xs)))], 3)


# ---------------------------------------------------------------- setup


async def fresh_db(a: argparse.Namespace) -> None:
    import asyncpg

    conn = await asyncpg.connect(f"postgresql://{a.pg}/postgres")
    try:
        await conn.execute(f"DROP DATABASE IF EXISTS {a.db} WITH (FORCE)")
        await conn.execute(f"CREATE DATABASE {a.db}")
    finally:
        await conn.close()
    env = env_for(a)
    out = subprocess.run(  # noqa: S603
        [PY, "-m", "alembic", "upgrade", "head"],
        cwd=API_DIR,
        env=env,
        capture_output=True,
        text=True,
    )
    if out.returncode:
        raise RuntimeError(out.stderr[-2000:])


async def wait_http(url: str, tries: int = 300) -> None:
    import httpx

    async with httpx.AsyncClient() as c:
        for _ in range(tries):
            with contextlib.suppress(Exception):
                r = await c.get(url, timeout=2)
                if r.status_code < 500:
                    return
            await asyncio.sleep(0.2)
    raise RuntimeError(f"{url} never answered")


async def seed(a: argparse.Namespace, n: int) -> dict[str, Any]:
    """Owner, a branch, the fake model; then n people, each with a personal AI allowed the
    browser and a linked PC that allowed ePerolehan (straight into the database)."""
    import httpx

    from agentic.agents.browser_grant import BROWSER, GATED
    from agentic.core.db import SessionLocal
    from agentic.devices import core as dcore
    from agentic.models import Agent, Device, Membership, User

    base = f"http://127.0.0.1:{a.api_port}"
    async with httpx.AsyncClient(base_url=base, timeout=30) as c:
        r = await c.post(
            "/api/auth/setup",
            json={
                "workspace_name": "Load Test Sdn Bhd",
                "name": "Owner Load",
                "email": "owner@load.example",
                "password": "load-test-password-2026",
            },
        )
        r.raise_for_status()
        h = {"x-csrf-token": c.cookies.get("agentic_csrf") or ""}
        branch = (await c.post("/api/branches", json={"name": "Load Branch"}, headers=h)).json()
        p = (
            await c.post(
                "/api/ai/providers",
                json={
                    "name": "Fake",
                    "base_url": f"http://127.0.0.1:{a.llm_port}/v1",
                    "api_key": "fake-key",
                    "tier": "paid",
                },
                headers=h,
            )
        ).json()
        r = await c.put(
            "/api/ai/groups/smart",
            json={"members": [{"provider_id": p["id"], "model_id": "fake-1"}]},
            headers=h,
        )
        r.raise_for_status()
        me = (await c.get("/api/auth/me")).json()
    ws_id = me.get("workspace", {}).get("id") or me.get("workspace_id")
    people: list[dict[str, str]] = []
    async with SessionLocal() as db:
        for i in range(n):
            u = User(email=f"staff{i:03d}@load.example", name=f"Staff {i:03d}", password_hash="!")
            db.add(u)
            await db.flush()
            db.add(
                Membership(workspace_id=ws_id, user_id=u.id, role="staff", branch_id=branch["id"])
            )
            agent = Agent(
                workspace_id=ws_id,
                branch_id=branch["id"],
                slug=f"pa-load-{i:03d}",
                name=f"Aide {i:03d}",
                role="Personal AI",
                owner_user_id=u.id,
                private=True,  # the person's own assistant: it may use their computer
                tools={t: ("ask" if t in GATED else "allow") for t in BROWSER},
            )
            db.add(agent)
            token = dcore.new_token()
            dev = Device(
                workspace_id=ws_id,
                user_id=u.id,
                name=f"PC {i:03d}",
                token_hash=dcore.hash_token(token),
                os="windows",
                version="0.5.2",
                browsers=["chrome", "edge"],
                tunnel_hosts=[EP],
            )
            db.add(dev)
            await db.flush()
            people.append({"user": u.id, "agent": agent.id, "device": dev.id, "token": token})
        await db.commit()
        # A live office has its built-in skills already; seed them now so the run measures
        # the steady state, not the first task ever in a new workspace.
        from agentic.models import Workspace
        from agentic.skills import store as skills_store

        await skills_store.ensure_builtin(db, await db.get(Workspace, ws_id))
        await db.commit()
    return {"workspace": ws_id, "branch": branch["id"], "people": people}


async def start_tasks(ws: dict[str, Any]) -> dict[str, float]:
    from agentic.agents import dispatch
    from agentic.core.db import SessionLocal
    from agentic.models import Task

    ids = []
    async with SessionLocal() as db:
        for i, p in enumerate(ws["people"]):
            t = Task(
                workspace_id=ws["workspace"],
                branch_id=ws["branch"],
                title=f"Check the ePerolehan tender list ({i:03d})",
                brief=f"Open this page in your browser: https://{EP}/home\n\nCheck it.",
                status="ready",
                assignee_agent_id=p["agent"],
                created_by=f"user:{p['user']}",
                labels=["web"],
                requires_review=False,
                device_id=p["device"],
                run_count=1,
            )
            db.add(t)
            await db.flush()
            ids.append(t.id)
        await db.commit()
    started: dict[str, float] = {}

    async def go(tid: str) -> None:
        wid = await dispatch.start_task(tid, 1)
        started[tid] = time.time()
        async with SessionLocal() as db:
            t = await db.get(Task, tid)
            t.workflow_id = wid
            await db.commit()

    await asyncio.gather(*(go(t) for t in ids))  # everyone presses Start at the same moment
    return started


# ---------------------------------------------------------------- one run


async def watch(ws_id: str, started: dict[str, float], timeout: float, out: dict[str, Any]) -> None:
    import redis.asyncio as aioredis

    from agentic.core.config import settings

    r = aioredis.from_url(settings.valkey_url, decode_responses=True)
    ps = r.pubsub()
    await ps.subscribe(f"events:{ws_id}")
    first_page: dict[str, float] = {}
    last_think: dict[str, float] = {}
    action_lat: list[float] = []
    thinking_on: dict[str, float] = {}
    llm_lat: list[float] = []
    finished: dict[str, str] = {}
    errors: list[str] = []
    deadline = time.time() + timeout
    while time.time() < deadline and len(finished) < len(started):
        msg = await ps.get_message(ignore_subscribe_messages=True, timeout=1.0)
        if not msg:
            continue
        now = time.time()
        ev = json.loads(msg["data"])
        d, kind = ev.get("data") or {}, ev.get("type")
        tid = d.get("task_id")
        if kind == "agent.thinking":
            if d.get("on"):
                thinking_on[d["agent_id"]] = now
            elif d["agent_id"] in thinking_on:
                llm_lat.append(now - thinking_on.pop(d["agent_id"]))
        elif kind == "agent.activity" and tid in started:
            if d.get("kind") == "think" and d.get("tools"):
                last_think[tid] = now
            elif d.get("kind") == "browser":
                if d.get("error"):
                    errors.append(str(d["error"])[:160])
                if d.get("frame_seq") and tid not in first_page:
                    first_page[tid] = now - started[tid]
                if tid in last_think:
                    action_lat.append(now - last_think.pop(tid))
        elif (
            kind == "task.updated"
            and tid in started
            and d.get("status")
            in (
                "done",
                "failed",
                "review",
                "cancelled",
                "blocked",
            )
        ):
            finished[tid] = d["status"]
            out.setdefault("task_secs", []).append(now - started[tid])
    await ps.aclose()
    await r.aclose()
    out.update(
        first_page=list(first_page.values()),
        action=action_lat,
        llm=llm_lat,
        finished=finished,
        errors=errors,
    )


async def sample(procs: list[Proc], a: argparse.Namespace, stop: asyncio.Event, out: dict) -> None:
    import asyncpg

    conn = await asyncpg.connect(f"postgresql://{a.pg}/postgres")
    peak_mem = {p.name: 0 for p in procs}
    peak_pg = 0
    try:
        while not stop.is_set():
            for p in procs:
                peak_mem[p.name] = max(peak_mem[p.name], proc_usage(p.pid)[1])
            n = await conn.fetchval(
                "select count(*) from pg_stat_activity where datname = $1", a.db
            )
            peak_pg = max(peak_pg, int(n))
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), 1.0)
    finally:
        await conn.close()
    out["peak_mem_mb"] = {k: round(v / 1e6) for k, v in peak_mem.items()}
    out["peak_pg_conns"] = peak_pg


async def one_run(a: argparse.Namespace, n: int) -> dict[str, Any]:
    import httpx
    import redis.asyncio as aioredis

    logs = Path(a.logs) / f"n{n}"
    logs.mkdir(parents=True, exist_ok=True)
    env = env_for(a)
    os.environ.update(env)  # this process imports agentic with the same settings
    r = aioredis.from_url(a.valkey)
    await r.flushdb()
    await r.aclose()
    await fresh_db(a)
    procs: list[Proc] = []
    tps = None
    try:
        tps = subprocess.Popen(  # noqa: S603
            [str(TEMPORAL_EXE), str(a.temporal_port)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        api = Proc(
            "api",
            [
                "-muvicorn",
                "agentic.api.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(a.api_port),
                "--log-level",
                "warning",
                *a.api_arg,
            ],
            env,
            logs,
        )
        llm = Proc(
            "llm",
            [
                str(HERE / "fake_llm.py"),
                "--port",
                str(a.llm_port),
                "--latency",
                str(a.llm_latency),
                "--clicks",
                str(a.clicks),
            ],
            env,
            logs,
        )
        browser = Proc(
            "browser", [str(HERE / "browser_fake.py"), "--port", str(a.browser_port)], env, logs
        )
        procs += [api, llm, browser]
        await wait_http(f"http://127.0.0.1:{a.api_port}/readyz")
        await wait_http(f"http://127.0.0.1:{a.browser_port}/healthz")
        for i in range(a.workers):
            wenv = {**env, **dict(a.worker_env)}  # e.g. the VPS overlay's worker settings
            procs.append(Proc(f"worker{i}", [str(HERE / "worker.py")], wenv, logs))
        ws = await seed(a, n)
        tokens = logs / "tokens.json"
        tokens.write_text(json.dumps([p["token"] for p in ws["people"]]))
        pcs = Proc(
            "pcs",
            [
                str(HERE / "fake_pcs.py"),
                "--api",
                f"http://127.0.0.1:{a.api_port}",
                "--tokens",
                str(tokens),
                "--rtt",
                str(a.rtt),
                "--stats",
                str(logs / "pcstats.json"),
            ],
            env,
            logs,
        )
        procs.append(pcs)
        for p in procs:
            p.wait_pid()
        for _ in range(300):  # every PC connected
            if "connected" in (logs / "pcs.log").read_text():
                break
            await asyncio.sleep(0.2)
        await asyncio.sleep(2)
        async with httpx.AsyncClient() as c:
            await c.post(f"http://127.0.0.1:{a.browser_port}/loadstats/reset")
        cpu0 = {p.name: proc_usage(p.pid)[0] for p in procs}
        out: dict[str, Any] = {}
        stop = asyncio.Event()
        sampler = asyncio.create_task(sample(procs, a, stop, out))
        t0 = time.time()
        started_box: dict[str, float] = {}
        watcher_out: dict[str, Any] = {}

        async def watch_later() -> None:
            while not started_box:
                await asyncio.sleep(0.01)
            await watch(ws["workspace"], started_box, a.timeout, watcher_out)

        watcher = asyncio.create_task(watch_later())
        await asyncio.sleep(0.5)  # subscribed before anything happens
        started_box.update(await start_tasks(ws))
        await watcher
        wall = time.time() - t0
        stop.set()
        await sampler
        cpu = {p.name: round(proc_usage(p.pid)[0] - cpu0[p.name], 1) for p in procs}
        async with httpx.AsyncClient() as c:
            bstats = (await c.get(f"http://127.0.0.1:{a.browser_port}/loadstats")).json()
            llm_stats = (await c.get(f"http://127.0.0.1:{a.llm_port}/stats")).json()
        r = aioredis.from_url(a.valkey, decode_responses=True)
        acts = [json.loads(x) for x in await r.lrange("load:acts", 0, -1)]
        frame_bytes = 0
        async for k in r.scan_iter("browser:frame:*"):
            frame_bytes += int(await r.strlen(k) or 0)
        await r.aclose()
        steps = [x for x in acts if x["type"] == "task_step"]
        statuses: dict[str, int] = {}
        for s in watcher_out.get("finished", {}).values():
            statuses[s] = statuses.get(s, 0) + 1
        err_kinds: dict[str, int] = {}
        for e in watcher_out.get("errors", []):
            key = e.split(":")[0][:60]
            err_kinds[key] = err_kinds.get(key, 0) + 1
        pcstats = (
            json.loads((logs / "pcstats.json").read_text())
            if (logs / "pcstats.json").exists()
            else {}
        )
        return {
            "people": n,
            "wall_s": round(wall, 1),
            "tasks": statuses,
            "first_page_s": {
                "p50": pct(watcher_out.get("first_page", []), 0.5),
                "p95": pct(watcher_out.get("first_page", []), 0.95),
                "n": len(watcher_out.get("first_page", [])),
            },
            "action_s": {
                "p50": pct(watcher_out.get("action", []), 0.5),
                "p95": pct(watcher_out.get("action", []), 0.95),
                "n": len(watcher_out.get("action", [])),
            },
            "llm_s": {
                "p50": pct(watcher_out.get("llm", []), 0.5),
                "p95": pct(watcher_out.get("llm", []), 0.95),
            },
            "task_s": {
                "p50": pct(watcher_out.get("task_secs", []), 0.5),
                "p95": pct(watcher_out.get("task_secs", []), 0.95),
            },
            "step_queue_wait_s": {
                "p50": pct([x["wait"] for x in steps], 0.5),
                "p95": pct([x["wait"] for x in steps], 0.95),
                "max": max([x["wait"] for x in steps] or [0]),
            },
            "step_run_s": {
                "p50": pct([x["run"] for x in steps], 0.5),
                "p95": pct([x["run"] for x in steps], 0.95),
                "mean": round(statistics.fmean([x["run"] for x in steps]), 2) if steps else 0,
            },
            "activities": len(acts),
            "activity_failures": sum(1 for x in acts if not x["ok"]),
            "cpu_s": cpu,
            "cpu_pct_of_core": {k: round(100 * v / wall) for k, v in cpu.items()},
            "peak_mem_mb": out.get("peak_mem_mb"),
            "peak_pg_conns": out.get("peak_pg_conns"),
            "browser": bstats,
            "llm_peak_in_flight": llm_stats.get("peak"),
            "llm_calls": llm_stats.get("calls"),
            "relay_pc_side_mb": round(
                (pcstats.get("relay_bytes_in", 0) + pcstats.get("relay_bytes_out", 0)) / 1e6, 1
            ),
            "valkey_frame_mb": round(frame_bytes / 1e6, 2),
            "browser_errors": err_kinds,
        }
    finally:
        for p in procs:
            p.stop()
        if tps is not None:
            with contextlib.suppress(Exception):
                tps.kill()
        await asyncio.sleep(1)


async def amain(a: argparse.Namespace) -> None:
    results = []
    for n in a.people:
        res = await one_run(a, n)
        print(json.dumps(res, indent=1), flush=True)
        results.append(res)
        if a.out:
            Path(a.out).write_text(json.dumps({"label": a.label, "runs": results}, indent=1))


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--people", type=int, nargs="+", default=[10])
    p.add_argument("--workers", type=int, default=1, help="worker processes (replicas)")
    p.add_argument("--clicks", type=int, default=4, help="page clicks per task after opening")
    p.add_argument("--llm-latency", type=float, default=2.0)
    p.add_argument("--rtt", type=float, default=0.04, help="the PC's internet round trip, s")
    p.add_argument("--timeout", type=float, default=900)
    p.add_argument("--pg", default="agentic:agentic_dev@localhost:8551")
    p.add_argument("--db", default="agentic_load")
    p.add_argument("--valkey", default="redis://localhost:8507/10")
    p.add_argument("--api-port", type=int, default=8561)
    p.add_argument("--browser-port", type=int, default=8562)
    p.add_argument("--llm-port", type=int, default=8563)
    p.add_argument("--temporal-port", type=int, default=8559)
    p.add_argument("--logs", default=str(Path(os.environ.get("TEMP", "/tmp")) / "agentic-load"))
    p.add_argument("--label", default="")
    p.add_argument("--out", default="")
    p.add_argument("--worker-env", nargs=2, action="append", default=[], metavar=("NAME", "VALUE"))
    p.add_argument("--api-arg", action="append", default=[], help="extra uvicorn flag for the api")
    p.add_argument("--env", nargs=2, action="append", default=[], metavar=("NAME", "VALUE"))
    asyncio.run(amain(p.parse_args()))


if __name__ == "__main__":
    main()
