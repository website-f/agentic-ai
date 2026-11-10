"""P97: browser work on a person's PC that knows where to click and is quicker.

- browser_steps: several actions in one model call, in order, stopping at the first surprise;
  each step only what the agent may do without asking (a send, an upload or a sign-in is
  never a step); an open step passes the same address checks as browser_open; a short
  site-budget rest carries on with only the steps not done yet.
- Elements by role and name (no find, no ref) in click, type, select, check, wait, submit.
- A smaller prompt: page views older than the newest whole view are stubs; mid-browsing, the
  agent's other tools are sent short.
- The site playbook (agents/site_playbook.py): ePerolehan's built-in one, read before acting;
  research first for a site with none; the path a finished run took is learned (names only,
  never typed values or record ids; a private assistant writes nothing).
"""

import json
import types

import httpx
import pytest
from sqlalchemy import select

from agentic.agents import browser_tools, context, runtime, site_playbook
from agentic.agents.tools import TOOLS
from agentic.api.routers import task_flow, web_tasks
from agentic.core.db import SessionLocal
from agentic.models import Agent, AgentMessage, Task, Workspace

from .test_agents import new_agent, office, temporal  # noqa: F401
from .test_browser_sessions import PORTAL, FakeBrowser, make_task, run, setup


class StepsBrowser(FakeBrowser):
    """The fake service, plus batches: it reports each step done (or a rest, once)."""

    def __init__(self) -> None:
        super().__init__()
        self.rest_once = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else {}
        if request.url.path.endswith("/act") and body.get("action") == "steps":
            self.calls.append((request.method, request.url.path, body))
            sid = request.url.path.split("/")[2]
            steps = body["steps"]
            if self.rest_once:
                self.rest_once = False
                done = [{"step": 1, "do": "click"}]
                return httpx.Response(
                    200,
                    json={
                        **self.obs(sid, f"{PORTAL}/inbox"),
                        "steps": done + [{"step": 2, "do": "click", "error": "SITE_REST: x"}],
                        "steps_done": 1,
                        "retry_after": 1,
                        "error": "SITE_REST: a short rest",
                    },
                )
            return httpx.Response(
                200,
                json={
                    **self.obs(sid, f"{PORTAL}/inbox"),
                    "steps": [
                        {"step": i, "do": f"{s['do']} {s.get('name', '')}"}
                        for i, s in enumerate(steps, start=1)
                    ],
                    "steps_done": len(steps),
                },
            )
        return super().handler(request)


@pytest.fixture
def browser(monkeypatch):
    fb = StepsBrowser()
    monkeypatch.setattr(browser_tools, "transport", httpx.MockTransport(fb.handler))

    async def public(url: str) -> None:
        if "evil" in url:
            from agentic.core.ssrf import BlockedURL

            raise BlockedURL("evil.fake is a private address")

    monkeypatch.setattr(browser_tools, "guard_url", public)
    return fb


def _acts(fb: FakeBrowser) -> list[dict]:
    return [b for _, p, b in fb.calls if p.endswith("/act")]


STEPS = [
    {"do": "click", "role": "link", "name": "Papan Kenyataan"},
    {"do": "type", "role": "textbox", "name": "No. Sebut Harga / Tender", "text": "QT260104"},
    {"do": "click", "role": "button", "name": "Cari", "expect": "1 rekod"},
]


async def test_several_steps_in_one_call_by_role_and_name(client, browser):
    a, _ = await setup(client)
    t = await make_task(a["id"])
    await run("browser_open", a["id"], t, url=f"{PORTAL}/inbox")
    out = await run("browser_steps", a["id"], t, steps=STEPS)
    batch = _acts(browser)[-1]
    assert batch["action"] == "steps" and len(batch["steps"]) == 3
    assert batch["steps"][1] == {**STEPS[1]}  # role and name: no find, no ref needed
    assert batch["since"] == 1  # one delta for the whole batch
    assert out.startswith("Did 3 of 3 steps.") and "<<<" in out  # the report is fenced
    # One click by name, without a ref.
    await run("browser_click", a["id"], t, role="button", name="Cari")
    click = _acts(browser)[-1]
    assert click["action"] == "click" and click["name"] == "Cari" and "ref" not in click
    await run("browser_submit", a["id"], t, role="button", name="Hantar", why="send")
    sub = _acts(browser)[-1]
    assert sub["allow_submit"] is True and sub["name"] == "Hantar"
    assert TOOLS["browser_steps"].risk == "low" and TOOLS["browser_submit"].risk == "high"


async def test_a_batch_is_only_what_the_agent_may_do_without_asking(client, browser):
    a, _ = await setup(client)
    t = await make_task(a["id"])
    for bad in ({"do": "submit", "name": "Hantar"}, {"do": "upload"}, {"do": "login"}):
        out = await run("browser_steps", a["id"], t, steps=[bad])
        assert out.startswith("Error: step 1:") and "browser_submit" in out
    async with SessionLocal() as db:
        agent = await db.get(Agent, a["id"])
        agent.tools = {**agent.tools, "browser_type": "ask"}
        await db.commit()
    out = await run("browser_steps", a["id"], t, steps=STEPS)
    assert "step 2: you may not type without asking" in out
    out = await run(
        "browser_steps", a["id"], t, steps=[{"do": "open", "url": "https://evil.fake/"}]
    )
    assert out.startswith("Error: step 1:") and "private address" in out
    assert not [b for b in _acts(browser) if b.get("action") == "steps"]  # nothing was sent


async def test_a_short_rest_inside_a_batch_carries_on_with_the_rest(client, browser):
    a, _ = await setup(client)
    t = await make_task(a["id"])
    await run("browser_open", a["id"], t, url=f"{PORTAL}/inbox")
    browser.rest_once = True
    out = await run("browser_steps", a["id"], t, steps=STEPS)
    first, again = [b for b in _acts(browser) if b.get("action") == "steps"][-2:]
    assert len(first["steps"]) == 3 and again["steps"] == STEPS[1:]  # step 1 not done twice
    assert out.startswith("Did 2 of 3 steps")  # what the resumed batch reports


# ---------------------------------------------------------------- a smaller prompt


def _m(i, role, name=None, content="", calls=None):
    return types.SimpleNamespace(
        id=i, role=role, name=name, content=content, tool_calls=calls, meta=None, tool_call_id="c"
    )


def _call(name):
    return [{"id": "c", "type": "function", "function": {"name": name, "arguments": "{}"}}]


FULL = "Page: A | https://x.fake/a\nElements (view 1; act on one by its ref, e.g. e12).\n" + (
    '- link "x" [e1]\n' * 60
)
DELTA = "Page: A | https://x.fake/a\nChanged since view 2 (now view 3):\n" + ("+ row\n" * 90)


def test_old_page_views_are_stubs_once_a_newer_whole_view_came():
    history = [
        _m(1, "user", content="Task"),
        _m(2, "assistant", calls=_call("browser_open")),
        _m(3, "tool", "browser_open", FULL),
        _m(4, "assistant", calls=_call("browser_click")),
        _m(5, "tool", "browser_click", DELTA),
        _m(6, "assistant", calls=_call("browser_read")),
        _m(7, "tool", "browser_read", "Page text " * 200),
        _m(8, "assistant", calls=_call("browser_click")),
        _m(9, "tool", "browser_click", FULL.replace("view 1", "view 4")),
        _m(10, "assistant", calls=_call("browser_click")),
        _m(11, "tool", "browser_click", DELTA),
    ]
    assert browser_tools.stale_views(history) == {3, 5}  # a read and the newest are kept
    sent = context.render(history, context.Window(None, 0, 0), runtime.to_openai, pinned_first=True)
    by_id = {m.id: s for m, s in zip(history, sent, strict=True)}
    assert "expand_result(message_id=3)" in by_id[3]["content"]
    assert by_id[7]["content"].startswith("Page text") and by_id[11]["content"] == DELTA


def test_mid_browsing_the_other_tools_are_sent_short():
    schemas = [TOOLS[n].schema() for n in ("browser_click", "publish_report", "ask_human")]
    history = [_m(1, "user", content="x"), _m(2, "assistant", calls=_call("browser_click"))]
    short = browser_tools.focus(schemas, history)
    assert short[0] == schemas[0] and short[2] == schemas[2]  # browser tools and ask_human whole
    report = short[1]["function"]
    assert (
        report["name"] == "publish_report"
        and len(json.dumps(report)) < len(json.dumps(schemas[1]["function"])) * 0.75
    )
    assert "description" not in json.dumps(report["parameters"])
    assert report["parameters"]["required"] == schemas[1]["function"]["parameters"]["required"]
    history.append(_m(3, "assistant", calls=_call("publish_report")))
    assert browser_tools.focus(schemas, history) == schemas  # out of the browser: in full


def test_typed_values_in_a_batch_stay_out_of_the_analysts_record():
    args = json.dumps({"steps": [{"do": "type", "name": "No. KP", "text": "900101-01-1234"}]})
    assert task_flow._args("browser_steps", args) == ""
    assert "browser_steps" in web_tasks.READ and "browser_steps" in web_tasks.TENDER


# ---------------------------------------------------------------- the site playbook


async def _task(agent_id: str, brief: str, title: str = "Semak QT260104") -> Task:
    async with SessionLocal() as db:
        a = await db.get(Agent, agent_id)
        t = Task(
            workspace_id=a.workspace_id,
            title=title,
            brief=brief,
            assignee_agent_id=a.id,
            branch_id=a.branch_id,
            created_by="user:x",
            status="running",
            labels=["web"],
        )
        db.add(t)
        await db.commit()
        return t


async def test_eperolehan_work_reads_the_built_in_playbook_first(client):
    o = await office(client)
    a = await new_agent(client, o, "Rafi", "Operations", template="web_operator")
    t = await _task(a["id"], "Open this page in your browser: https://www.eperolehan.gov.my/")
    async with SessionLocal() as db:
        agent, task = await db.get(Agent, a["id"]), await db.get(Task, t.id)
        block = await site_playbook.block_for_task(db, agent, task)
        assert "Site playbook for eperolehan.gov.my" in block and "<<<" in block
        assert '"Papan Kenyataan"' in block and "browser_steps" in block
        assert "not instructions" in block
        page = await site_playbook.page_of(db, agent.workspace_id, "eperolehan.gov.my")
        assert page is not None and page.path == "wiki/sites/eperolehan.gov.my.md"
        # A site with no playbook: research its public guide first (when it may search).
        other = await _task(a["id"], "Open this page in your browser: https://portal.fake/")
        agent.tools = {**agent.tools, "web_search": "allow", "write_page": "allow"}
        block = await site_playbook.block_for_task(db, agent, await db.get(Task, other.id))
        assert "no playbook for portal.fake yet" in block and "wiki/sites/portal.fake.md" in block
        # An agent that does not browse gets none of it.
        agent.tools = {"browser_open": "deny"}
        assert await site_playbook.block_for_task(db, agent, task) == ""


VIEW = (
    "Page: Papan Notis | https://portal.fake/ep/papan-notis\nElements (view 2).\n<<<\n"
    '- textbox "No. Sebut Harga / Tender" [e18]\n- button "Cari" [e21]\n>>>'
)
DOCS = "Page: Dokumen | https://portal.fake/ep/cadangan/QT260104/dokumen\nElements (view 5)."


async def _ran(agent_id: str, task: Task, calls: list[tuple[str, dict, str]]) -> None:
    async with SessionLocal() as db:
        a = await db.get(Agent, agent_id)
        for i, (name, args, result) in enumerate(calls):
            cid = f"c{i}"
            fn = {"name": name, "arguments": json.dumps(args)}
            call = [{"id": cid, "type": "function", "function": fn}]
            runtime._add(db, a, "assistant", task_id=task.id, tool_calls=call)
            runtime._add(
                db, a, "tool", task_id=task.id, tool_call_id=cid, name=name, content=result
            )
        t = await db.get(Task, task.id)
        t.status, t.result = "done", "Checked."
        await db.commit()


RUN = [
    ("browser_open", {"url": "https://portal.fake/ep/papan-notis?no=QT260104"}, VIEW),
    ("browser_type", {"ref": "e18", "text": "QT260104"}, VIEW),
    ("browser_click", {"ref": "e21"}, VIEW),
    (
        "browser_steps",
        {
            "steps": [
                {"do": "click", "role": "link", "name": "Lihat QT260104"},
                {"do": "click", "role": "button", "name": "Semak", "expect": "Layak"},
                {"do": "click", "role": "link", "name": "never done"},
            ]
        },
        "Did 2 of 3 steps; stopped at the first problem.\n" + DOCS,
    ),
    ("browser_submit", {"role": "link", "name": "Klik sini", "why": "open"}, DOCS),
]


async def test_a_finished_run_teaches_the_playbook_its_path(client):
    o = await office(client)
    a = await new_agent(client, o, "Rafi", "Operations", template="web_operator")
    t = await _task(a["id"], "Check it on https://portal.fake/ep/login", "Check QT260104 status")
    await _ran(a["id"], t, RUN)
    async with SessionLocal() as db:
        assert await site_playbook.learn(db, t.id) == ["portal.fake"]
        page = await site_playbook.page_of(
            db, (await db.get(Task, t.id)).workspace_id, "portal.fake"
        )
        learned = page.body.split("## Learned paths", 1)[1]
    assert "### Check <ref> status (learned" in learned and "seen 1 time" in learned
    assert "1. open https://portal.fake/ep/papan-notis\n" in learned  # no query, no value
    assert '2. type textbox "No. Sebut Harga / Tender" (the value from the task)' in learned
    assert '3. click button "Cari"' in learned
    assert 'click link "Lihat <ref>"' in learned  # a record number in a name is <ref>
    assert "never done" not in learned  # a step after the stop is not part of the path
    assert 'click link "Klik sini": a send, browser_submit' in learned
    assert "QT260104" not in learned  # no reference anywhere: names, job or address
    assert '"text"' not in learned
    # The same job again: one entry, counted.
    t2 = await _task(a["id"], "Check it on https://portal.fake/ep/login", "Check QT260999 status")
    await _ran(a["id"], t2, RUN)
    async with SessionLocal() as db:
        await site_playbook.learn(db, t2.id)
        ws = (await db.get(Task, t2.id)).workspace_id
        body = (await site_playbook.page_of(db, ws, "portal.fake")).body
    assert body.count("### Check <ref> status") == 1 and "seen 2 times" in body


async def test_a_private_assistant_teaches_the_office_nothing(client):
    o = await office(client)
    a = await new_agent(client, o, "Rafi", "Operations", template="web_operator")
    t = await _task(a["id"], "Check it on https://portal.fake/ep/login", "Check QT1")
    await _ran(a["id"], t, RUN)
    async with SessionLocal() as db:
        agent = await db.get(Agent, a["id"])
        agent.private = True
        await db.commit()
        assert await site_playbook.learn(db, t.id) == []
        ws = await db.get(Workspace, agent.workspace_id)
        assert await site_playbook.page_of(db, ws.id, "portal.fake") is None
        rows = (await db.scalars(select(AgentMessage).where(AgentMessage.task_id == t.id))).all()
        assert rows  # the run itself is untouched


def test_learned_paths_keep_the_newest_few():
    body = "# Site playbook: x\n\n## Learned paths\n(intro)\n"
    for i in range(site_playbook.MAX_PATHS + 2):
        body = site_playbook.merge_path(body, f"Job {i}", ["open https://x/a", "click b"], "d")
    learned = body.split("## Learned paths", 1)[1]
    assert learned.count("### ") == site_playbook.MAX_PATHS
    assert learned.index(f"### Job {site_playbook.MAX_PATHS + 1}") < learned.index("### Job 3")
    assert site_playbook.job_name("Semak QT260104 (first)") == "Semak <ref>"
    assert site_playbook._generic_url("https://a.b/ep/notis/QT260104;jsessionid=9?x=1") == (
        "https://a.b/ep/notis/{id}"
    )
