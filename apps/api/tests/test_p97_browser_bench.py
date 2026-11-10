"""P97 bench: one ePerolehan-style checking job on the practice portal (deploy/demo
practice_ep.py), driven through the real agent loop (runtime.run_task_step, the real browser
tools, the real browser service on a real Chrome/Edge over CDP, like a person's own PC), with
a scripted model that bills what it is sent (characters / 4).

It does not run in the normal suite. Start the three pieces, then point the bench at them:

    cd deploy/demo && python -m uvicorn portal:app --port 8591     # the practice portal
    msedge --headless=new --remote-debugging-port=9361 --user-data-dir=<tmp>   # "the PC"
    python deploy/demo/browser_bench_service.py apps/browser 8661  # the browser service
    P97_BENCH_BROWSER=http://127.0.0.1:8661 \
    P97_BENCH_CDP=ws://127.0.0.1:9361/devtools/browser/<id> \
    P97_BENCH_PORTAL=http://127.0.0.1:8591 P97_BENCH_FLOW=old|new \
    pytest -s tests/test_p97_browser_bench.py

The job: find quotation QT260104 on the notice board, check eligibility, open its proposal and
report the No. Cadangan, the closing date and the tender documents. `old` scripts the way the
agent worked before P97 (one action per model call, find before click); `new` the P97 way
(the site playbook, browser_steps batches by role and name, the saved session). It prints,
for the first and the second run: model calls, prompt tokens per call, browser actions on
the service, seconds per browser tool and per task.
"""

import json
import os
import time
from typing import Any

import httpx
import pytest
from sqlalchemy import select

from agentic.agents import browser_tools, runtime
from agentic.core.config import settings
from agentic.core.db import SessionLocal
from agentic.engine import client as engine_client
from agentic.models import Agent, AgentMessage, Task, Workspace
from agentic.skills import routines

from .conftest import csrf
from .test_agents import ScriptedLLM, new_agent, office, temporal  # noqa: F401

BROWSER = os.environ.get("P97_BENCH_BROWSER", "")
CDP = os.environ.get("P97_BENCH_CDP", "")
PORTAL = os.environ.get("P97_BENCH_PORTAL", "http://127.0.0.1:8591")
FLOW = os.environ.get("P97_BENCH_FLOW", "new")
REF = "QT260104"

pytestmark = pytest.mark.skipif(not (BROWSER and CDP), reason="P97 bench: needs a browser")


def ref_of(text: str, role: str, name: str) -> str:
    """The ref the page view shows for an element with this role and exact name."""
    hits = [r for ro, n, r in routines.elements(text) if ro == role and n == name]
    assert hits, f"no {role} {name!r} in:\n{text[:3000]}"
    return hits[-1]


class PolicyLLM(ScriptedLLM):
    """Scripted replies that may depend on the newest tool result (to pick refs off the
    page, as a model does), billing what it is sent."""

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/chat/completions") and self.replies:
            body = json.loads(request.content)
            last = next(
                (m.get("content") or "" for m in reversed(body["messages"]) if m["role"] == "tool"),
                "",
            )
            if callable(self.replies[0]):
                self.replies[0] = self.replies[0](last, body)
        r = super().handler(request)
        if request.url.path.endswith("/chat/completions"):
            body = self.requests[-1]
            sent = json.dumps(body["messages"]) + json.dumps(body.get("tools") or [])
            data = json.loads(r.content)
            data["usage"] = {"prompt_tokens": len(sent) // 4, "completion_tokens": 40}
            return httpx.Response(200, json=data)
        return r

    def plan(self, fn) -> "PolicyLLM":
        self.replies.append(fn)
        return self


def call(tool: str, /, **args: Any) -> dict:
    return {
        "content": None,
        "tool_calls": [
            {
                "id": f"call_{time.monotonic_ns()}",
                "type": "function",
                "function": {"name": tool, "arguments": json.dumps(args)},
            }
        ],
    }


def say(text: str) -> dict:
    return {"content": text}


class Counter(httpx.AsyncBaseTransport):
    """Counts the actions the API asks of the browser service."""

    def __init__(self) -> None:
        self.inner = httpx.AsyncHTTPTransport()
        self.actions: list[str] = []

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/act"):
            body = json.loads(request.content)
            n = len(body.get("steps") or []) if body.get("action") == "steps" else 1
            self.actions += [body.get("action", "?")] * max(n, 1)
        return await self.inner.handle_async_request(request)


@pytest.fixture
def llm():
    s = PolicyLLM()
    engine_client.use_transport(httpx.MockTransport(s.handler))
    yield s
    engine_client.use_transport(None)


@pytest.fixture
def bench(monkeypatch):
    from agentic.api.routers import web_tasks
    from agentic.devices import tunnel

    async def public(url: str) -> None:
        return None

    async def pc_screen(db, ws, allowed, person):
        return "pc-bench", None

    async def open_on_pc(ctx, device_id, sites=None):
        return "chan-bench", CDP

    async def close_on_pc(*a, **k):
        return None

    counter = Counter()
    monkeypatch.setattr(settings, "browser_url", BROWSER)
    monkeypatch.setattr(settings, "browser_token", "dev-browser-token")
    # The practice portal runs on this machine: let the address checks pass it.
    hosts = settings.private_hosts_allowed + ",127.0.0.1"
    monkeypatch.setattr(settings, "private_hosts_allowed", hosts)
    monkeypatch.setattr(browser_tools, "transport", counter)
    monkeypatch.setattr(browser_tools, "guard_url", public)
    monkeypatch.setattr(web_tasks, "guard_url", public)
    monkeypatch.setattr(tunnel, "screen_for", pc_screen)
    monkeypatch.setattr(browser_tools, "_open_on_pc", open_on_pc)
    monkeypatch.setattr(browser_tools, "_close_on_pc", close_on_pc)
    timings: list[tuple[str, float]] = []
    real = runtime.run_tool

    async def timed(ctx, name, args):
        t0 = time.perf_counter()
        try:
            return await real(ctx, name, args)
        finally:
            timings.append((name, time.perf_counter() - t0))

    monkeypatch.setattr(runtime, "run_tool", timed)
    return {"counter": counter, "timings": timings}


INSTRUCTIONS = (
    f"Find quotation {REF} on the notice board (Papan Kenyataan), check that we are eligible "
    "(Semak), open its proposal and tell me the No. Cadangan, the closing date and the names "
    "of the tender documents."
)


def old_script(llm: PolicyLLM, signed_in: bool) -> None:
    """Before P97: one action per model call, a find before most clicks."""
    login = f"{PORTAL}/ep/login"
    llm.plan(lambda last, b: call("browser_open", url=login))
    if not signed_in:
        llm.plan(
            lambda last, b: call(
                "browser_login",
                login="ep",
                username_element=ref_of(last, "textbox", "ID Log Masuk :"),
                password_element=ref_of(last, "textbox", "Kata Laluan:"),
                submit_element=ref_of(last, "button", "Log Masuk"),
            )
        )
    llm.plan(lambda last, b: call("browser_find", role="link", label="Papan Kenyataan"))
    llm.plan(lambda last, b: call("browser_click", ref=ref_of(last, "link", "Papan Kenyataan")))
    llm.plan(
        lambda last, b: call(
            "browser_type", ref=ref_of(last, "textbox", "No. Sebut Harga / Tender"), text=REF
        )
    )
    llm.plan(lambda last, b: call("browser_find", role="button", label="Cari"))
    llm.plan(lambda last, b: call("browser_click", ref=ref_of(last, "button", "Cari")))
    llm.plan(lambda last, b: call("browser_wait", text="1 rekod"))
    llm.plan(lambda last, b: call("browser_find", role="link", label=f"Lihat {REF}"))
    llm.plan(lambda last, b: call("browser_click", ref=ref_of(last, "link", f"Lihat {REF}")))
    llm.plan(lambda last, b: call("browser_click", ref=ref_of(last, "button", "Semak")))
    llm.plan(lambda last, b: call("browser_wait", text="Layak"))
    llm.plan(lambda last, b: call("browser_find", role="link", label="Klik sini"))
    # Before P97 this link counted as a transaction ("sediakan", "kemaskini"): the click was
    # refused and the agent had to ask a person to approve opening the proposal.
    link = "Klik sini untuk sediakan / kemaskini cadangan tawaran"
    llm.plan(lambda last, b: call("browser_click", ref=ref_of(last, "link", link)))
    llm.plan(
        lambda last, b: call(
            "browser_submit",
            ref=next(
                m["ref"] for m in [json.loads(c["function"]["arguments"]) for c in _last_calls(b)]
            ),
            why="Open the proposal for the quotation (it only opens the page).",
        )
    )
    llm.plan(
        lambda last, b: call(
            "browser_click", ref=ref_of(last, "link", "Dokumen Sebut Harga / Tender")
        )
    )
    llm.plan(lambda last, b: call("browser_read"))
    llm.plan(lambda last, b: say(_answer(last)))


def _last_calls(body: dict) -> list[dict]:
    last = next(m for m in reversed(body["messages"]) if m["role"] == "assistant")
    return last.get("tool_calls") or []


def _answer(last: str) -> str:
    assert "PN2600" in last and "03_Spesifikasi_Teknikal.pdf" in last, last[:2000]
    return f"{REF}: No. Cadangan PN26005104, closes 2026-11-18 12:00 PM; documents listed."


LINK = "Klik sini untuk sediakan / kemaskini cadangan tawaran"
JOB_STEPS = [
    {"do": "click", "role": "link", "name": "Papan Kenyataan"},
    {"do": "type", "role": "textbox", "name": "No. Sebut Harga / Tender", "text": REF},
    {"do": "click", "role": "button", "name": "Cari", "expect": "1 rekod"},
    {"do": "click", "role": "link", "name": f"Lihat {REF}"},
    {"do": "click", "role": "button", "name": "Semak", "expect": "Layak"},
]

# What "research first" writes for the practice site (the built-in ePerolehan playbook is
# the same, from the public manuals): the menu path and the names on each screen.
PRACTICE_PLAYBOOK = """# Site playbook: practice ePerolehan

## Start
- Sign-in: {portal}/ep/login (textbox "ID Log Masuk :", textbox "Kata Laluan:", button
  "Log Masuk"; use browser_login).

## Jobs
### Find a quotation and check eligibility
1. click link "Papan Kenyataan" (Papan Notis, KRITERIA CARIAN)
2. type textbox "No. Sebut Harga / Tender", click button "Cari" (the list shows "1 rekod")
3. click link "Lihat <ref>", then button "Semak"; success reads "Layak"
4. link "Klik sini untuk sediakan / kemaskini cadangan tawaran" opens the proposal: it
   counts as a send (browser_submit)
### Tender documents
In the proposal, link "Dokumen Sebut Harga / Tender" shows SENARAI DOKUMEN.

## Learned paths
"""


def new_script(llm: PolicyLLM, signed_in: bool, learned: bool) -> None:
    """P97: the playbook names the path, so the agent sends it as browser_steps batches by
    role and name; a saved session needs no sign-in; a learned path starts on the page where
    the work starts. Opening the proposal is a send either way (a person approves)."""
    login = f"{PORTAL}/ep/login"
    if learned:
        steps = [{"do": "open", "url": f"{PORTAL}/ep/papan-notis"}, *JOB_STEPS[1:]]

        def first(last, b):
            prompt = b["messages"][1]["content"]
            assert "Learned paths" in prompt and "/ep/papan-notis" in prompt, prompt[-3000:]
            return call("browser_steps", steps=steps)

        llm.plan(first)
    else:
        llm.plan(lambda last, b: call("browser_open", url=login))
        if not signed_in:
            llm.plan(
                lambda last, b: call(
                    "browser_login",
                    login="ep",
                    username_element=ref_of(last, "textbox", "ID Log Masuk :"),
                    password_element=ref_of(last, "textbox", "Kata Laluan:"),
                    submit_element=ref_of(last, "button", "Log Masuk"),
                )
            )
        llm.plan(lambda last, b: call("browser_steps", steps=JOB_STEPS))

    def submit(last, b):
        assert f"Did {len(JOB_STEPS)} of {len(JOB_STEPS)} steps" in last, last[:2500]
        return call("browser_submit", role="link", name=LINK, why="Open the proposal.")

    llm.plan(submit)
    llm.plan(
        lambda last, b: call("browser_click", role="link", name="Dokumen Sebut Harga / Tender")
    )
    llm.plan(lambda last, b: say(_answer(last)))


async def _run(client, agent: dict, title: str) -> dict:
    r = await client.post(
        f"/api/agents/{agent['id']}/web-task",
        json={
            "url": f"{PORTAL}/ep/login",
            "instructions": INSTRUCTIONS,
            "mode": "tender",
            "login": "ep",
            "title": title,
        },
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    task_id = r.json()["id"]
    t0 = time.perf_counter()
    approvals = 0
    prof = None
    if os.environ.get("P97_BENCH_PROFILE"):
        import cProfile

        prof = cProfile.Profile()
        prof.enable()
    for _ in range(12):
        step = await runtime.run_task_step(task_id)
        if step.state == "needs_approval":  # a person approves at once (their wait not counted)
            approvals += 1
            r = await client.post(
                f"/api/approvals/{step.approval_id}",
                json={"decision": "approve", "scope": "once"},
                headers=csrf(client),
            )
            assert r.status_code == 200, r.text
            await runtime.apply_approval(step.approval_id)
            continue
        if step.state != "continue":
            break
    wall = time.perf_counter() - t0
    if prof is not None:
        import pstats

        prof.disable()
        pstats.Stats(prof).sort_stats("cumulative").print_stats(45)
    assert step.state == "done", (step.state, step.message)
    await browser_tools.close_for_task(task_id)  # keeps the signed-in session (P21)
    return {"task": task_id, "wall": wall, "approvals": approvals}


async def _messages(task_id: str) -> list[AgentMessage]:
    async with SessionLocal() as db:
        return list(
            (
                await db.scalars(
                    select(AgentMessage)
                    .where(AgentMessage.task_id == task_id)
                    .order_by(AgentMessage.id)
                )
            ).all()
        )


def _report(label: str, sent: list[dict], bench: dict, out: dict, acts: list[str]) -> dict:
    tokens = []
    for body in sent:
        text = json.dumps(body["messages"]) + json.dumps(body.get("tools") or [])
        tokens.append(len(text) // 4)
    tools_tokens = [len(json.dumps(b.get("tools") or [])) // 4 for b in sent]
    browser = [(n, s) for n, s in bench["timings"] if n.startswith("browser_")]
    secs = sum(s for _, s in browser)
    row = {
        "run": label,
        "model_calls": len(sent),
        "prompt_tokens_per_call": tokens,
        "avg_prompt_tokens": round(sum(tokens) / max(1, len(tokens))),
        "tools_tokens": tools_tokens[0] if tools_tokens else 0,
        "browser_tool_calls": len(browser),
        "service_actions": len(acts),
        "finds_snapshots": sum(1 for a in acts if a in ("find", "snapshot")),
        "clicks": sum(1 for a in acts if a == "click"),
        "browser_seconds": round(secs, 1),
        "per_tool": [(n, round(s, 2)) for n, s in browser],
        "wall_seconds": round(out["wall"], 1),
        "approvals": out["approvals"],
        # The model's time at the live rate (5.4 s for a ~20.7k-token call): a fixed part
        # and a part per 1,000 prompt tokens.
        "model_seconds_est": round(sum(1.5 + 0.19 * t / 1000 for t in tokens), 1),
    }
    row["task_seconds_est"] = round(row["browser_seconds"] + row["model_seconds_est"], 1)
    print("\nP97 BENCH " + json.dumps(row))
    return row


async def test_practice_eperolehan_first_and_second_run(client, llm, temporal, bench):
    o = await office(client)
    agent = await new_agent(client, o, "Rafi", "Operations", template="web_operator")
    r = await client.post(
        "/api/vault/logins",
        json={
            "name": "ep",
            "hosts": ["127.0.0.1"],
            "username": "demo.supplier",
            "password": "practice-only-2026",
        },
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    if FLOW == "new":  # what research first leaves behind for the practice site
        from agentic.agents import site_playbook

        async with SessionLocal() as db:
            a = await db.get(Agent, agent["id"])
            ws = await db.get(Workspace, a.workspace_id)
            body = PRACTICE_PLAYBOOK.format(portal=PORTAL)
            await site_playbook.save(db, ws, "127.0.0.1", body, "system", "research")
    rows = []
    for n, label in ((1, "first"), (2, "second")):
        llm.requests.clear()
        bench["timings"].clear()
        bench["counter"].actions.clear()
        if FLOW == "old":
            old_script(llm, signed_in=False)  # the PC path never restored a session
        else:
            new_script(llm, signed_in=n == 2, learned=n == 2)
        out = await _run(client, agent, f"Check {REF} ({label})")
        acts = list(bench["counter"].actions)
        rows.append(_report(f"{FLOW}-{label}", list(llm.requests), bench, out, acts))
        assert not llm.replies, "the script was not used up"
        if FLOW == "new":  # what the reflect activity does after a finished task
            from agentic.agents import site_playbook

            async with SessionLocal() as db:
                t = await db.get(Task, out["task"])  # as the workflow's finish leaves it
                t.status, t.result = "review", "Checked."
                await db.commit()
                assert await site_playbook.learn(db, out["task"]) == ["127.0.0.1"]
                page = await site_playbook.page_of(db, ws.id, "127.0.0.1")
                print("\nP97 LEARNED\n" + page.body.split("## Learned paths", 1)[1])
    print("\nP97 BENCH SUMMARY " + json.dumps(rows))
