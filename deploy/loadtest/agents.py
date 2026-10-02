"""Load test for the parts k6 does not cover well: live event streams and agent work.

1. Opens N live event streams (/api/events) at once and checks that one published event
   reaches every one of them, and how fast.
2. Starts M agent tasks at the same moment and measures how long until all are finished.
   Point the agents at a fake or cheap model group first; this measures our side
   (Temporal, worker, database), not the provider.

    uv run --project apps/api python deploy/loadtest/agents.py --streams 200 --tasks 30
"""

import argparse
import asyncio
import statistics
import time

import httpx


async def login(c: httpx.AsyncClient, email: str, password: str) -> None:
    r = await c.post("/api/auth/login", json={"email": email, "password": password})
    r.raise_for_status()


def csrf(c: httpx.AsyncClient) -> dict[str, str]:
    return {"x-csrf-token": c.cookies.get("agentic_csrf") or ""}


async def streams(base: str, cookies: httpx.Cookies, n: int, trigger) -> dict:
    """n open streams; one event is published; returns how many got it and how fast."""
    lines: list[list[tuple[float, str]]] = [[] for _ in range(n)]
    opened = 0
    ready = asyncio.Event()

    async def one(i: int) -> None:
        nonlocal opened
        async with (
            httpx.AsyncClient(
                base_url=base, cookies=cookies, timeout=httpx.Timeout(10, read=None)
            ) as c,
            c.stream("GET", "/api/events") as r,
        ):
            opened += 1
            if opened == n:
                ready.set()
            async for line in r.aiter_lines():
                if line.startswith("data:"):
                    lines[i].append((time.perf_counter(), line))

    tasks = [asyncio.create_task(one(i)) for i in range(n)]
    try:
        await asyncio.wait_for(ready.wait(), 60)
    except TimeoutError:
        pass
    await asyncio.sleep(2)  # let the replay of older events drain
    for got in lines:
        got.clear()
    t0 = time.perf_counter()
    marker = await trigger()
    await asyncio.sleep(8)
    for t in tasks:
        t.cancel()
    delays = [
        next(ts for ts, line in got if marker in line) - t0
        for got in lines
        if any(marker in line for _, line in got)
    ]
    return {
        "opened": opened,
        "received": len(delays),
        "p50_ms": round(statistics.median(delays) * 1000) if delays else None,
        "max_ms": round(max(delays) * 1000) if delays else None,
    }


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8500")
    ap.add_argument("--email", default="owner@example.com")
    ap.add_argument("--password", default="agentic-test-2026")
    ap.add_argument("--streams", type=int, default=200)
    ap.add_argument("--tasks", type=int, default=30)
    ap.add_argument(
        "--agent", default="", help="agent id; default: every active agent in turn"
    )
    a = ap.parse_args()

    async with httpx.AsyncClient(base_url=a.base, timeout=60) as c:
        await login(c, a.email, a.password)
        agents = [
            x for x in (await c.get("/api/agents")).json() if x["status"] == "active"
        ]
        ids = [a.agent] if a.agent else [x["id"] for x in agents]

        async def trigger() -> str:
            r = await c.post(
                "/api/tasks",
                json={"title": "Load test marker", "brief": ""},
                headers=csrf(c),
            )
            r.raise_for_status()
            return r.json()["id"]  # every task.created event carries the task id

        if a.streams:
            print("streams:", await streams(a.base, c.cookies, a.streams, trigger))

        if a.tasks and ids:
            t0 = time.perf_counter()
            made = await asyncio.gather(
                *[
                    c.post(
                        "/api/tasks",
                        json={
                            "title": f"Load test task {i + 1}",
                            "brief": "Add 1250 and 300.",
                            "assignee_agent_id": ids[i % len(ids)],
                            "requires_review": False,
                            "start": True,
                        },
                        headers=csrf(c),
                    )
                    for i in range(a.tasks)
                ]
            )
            created = time.perf_counter() - t0
            task_ids = [r.json()["id"] for r in made if r.status_code == 201]
            done: dict[str, float] = {}
            while len(done) < len(task_ids) and time.perf_counter() - t0 < 600:
                await asyncio.sleep(2)
                rows = {t["id"]: t for t in (await c.get("/api/tasks")).json()}
                for tid in task_ids:
                    if tid not in done and rows[tid]["status"] in (
                        "done",
                        "failed",
                        "review",
                    ):
                        done[tid] = time.perf_counter() - t0
            states = [rows[t]["status"] for t in task_ids]
            print(
                "tasks:",
                {
                    "started": len(task_ids),
                    "create_s": round(created, 1),
                    "finished": len(done),
                    "done": states.count("done"),
                    "failed": states.count("failed"),
                    "p50_s": round(statistics.median(done.values()), 1)
                    if done
                    else None,
                    "all_s": round(max(done.values()), 1) if done else None,
                },
            )


if __name__ == "__main__":
    asyncio.run(main())
