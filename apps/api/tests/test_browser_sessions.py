"""P21 browser: saved sign-ins that survive between tasks (encrypted, checked before use,
expiring, forgettable, audited, never shown), the per-task site allow-list, stable refs
in tool calls, deltas in the page view and the per-tool output caps. Against a fake
browser service that keeps cookies per session like the real one."""

import base64
import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import select

from agentic.agents import browser_tools, vault
from agentic.agents.tools import TOOLS, ToolContext, mode_of, modes_for
from agentic.api.routers.web_tasks import WebTaskIn, brief_for
from agentic.core import crypto
from agentic.core.db import SessionLocal
from agentic.models import Agent, AuditLog, Credential, CredentialState, Event, Task, Workspace

from .conftest import csrf
from .test_agents import new_agent, office, temporal  # noqa: F401

JPEG = base64.b64encode(b"\xff\xd8\xff\xe0fake\xff\xd9").decode()
PORTAL = "https://portal.fake"
LOGIN_TREE = (
    '- textbox "User ID" [e5]\n- textbox "Password" [e6] password\n'
    '- button "Sign in" [e7] (sends the form: browser_submit)'
)
INBOX_TREE = (
    '- link "Inbox" [e2]\n- table [e11]\n  - row "2026-10-02 | Works"\n    - link "PQ1" [e14]'
)


class FakeBrowser:
    """Sessions with cookies; signed in on portal.fake when its session cookie says ok."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict]] = []
        self.cookies: dict[str, list[dict]] = {}
        self.n = 0

    def signed_in(self, sid: str) -> bool:
        return any(c["value"] == "ok" for c in self.cookies.get(sid, []))

    def obs(self, sid: str, url: str, **extra) -> dict:
        login = not self.signed_in(sid) and "portal.fake" in url
        return {
            "url": f"{PORTAL}/login" if login else url,
            "title": "Sign in" if login else "Inbox",
            "rev": 1,
            "mode": "full",
            "snapshot": LOGIN_TREE if login else INBOX_TREE,
            "auth_form": "password" if login else None,
            "elements": [],
            "text": "page",
            "text_chars": 4,
            "frame": JPEG,
            **extra,
        }

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else {}
        path = request.url.path
        self.calls.append((request.method, path, body))
        if path == "/sessions" and request.method == "POST":
            self.n += 1
            sid = f"bs_{self.n}"
            self.cookies[sid] = list((body.get("storage_state") or {}).get("cookies") or [])
            return httpx.Response(
                200, json={"id": sid, "restored": bool(body.get("storage_state"))}
            )
        sid = path.split("/")[2] if path.startswith("/sessions/") else ""
        if request.method == "DELETE":
            return httpx.Response(200, json={"ok": True})
        if path.endswith("/frame"):
            return httpx.Response(200, content=base64.b64decode(JPEG))
        if path.endswith("/state"):
            return httpx.Response(
                200, json={"state": {"cookies": self.cookies[sid], "origins": []}}
            )
        if path.endswith("/forget"):
            self.cookies[sid] = []
            return httpx.Response(200, json={"ok": True})
        action = body.get("action")
        if action == "login_submit":
            self.cookies[sid] = [
                {"name": "pp_session", "value": "ok", "domain": "portal.fake", "path": "/"},
                {"name": "track", "value": "x", "domain": ".tracker.fake", "path": "/"},
            ]
            return httpx.Response(200, json=self.obs(sid, f"{PORTAL}/inbox"))
        if action == "verify":
            o = self.obs(sid, body["url"])
            o["verified"] = self.signed_in(sid)
            return httpx.Response(200, json=o)
        if action == "goto":
            return httpx.Response(200, json=self.obs(sid, body["url"]))
        if action == "click" and body.get("ref") == "e99":
            return httpx.Response(
                200,
                json={
                    **self.obs(sid, f"{PORTAL}/inbox"),
                    "error": "There is no element e99 on the page now (it changed).",
                },
            )
        return httpx.Response(
            200,
            json={
                **self.obs(sid, f"{PORTAL}/inbox"),
                "mode": "delta",
                "snapshot": None,
                "delta": '~ - textbox "Company" [e9] value="Qbot"',
                "since": body.get("since"),
                "rev": 2,
            },
        )


@pytest.fixture
def browser(monkeypatch):
    fb = FakeBrowser()
    monkeypatch.setattr(browser_tools, "transport", httpx.MockTransport(fb.handler))

    async def public(url: str) -> None:  # the fake sites have no DNS; the guard has its tests
        return None

    monkeypatch.setattr(browser_tools, "guard_url", public)
    return fb


async def setup(client, hosts=("portal.fake",)):
    o = await office(client)
    a = await new_agent(client, o, "Rafi", "Operations", template="web_operator")
    r = await client.post(
        "/api/vault/logins",
        json={
            "name": "portal",
            "hosts": list(hosts),
            "username": "demo.user",
            "password": "s3cret-pw",
        },
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    return a, r.json()


async def make_task(
    agent_id: str, brief: str = "Do web work.", labels=None, created_by="user:x", parent=None
) -> str:
    async with SessionLocal() as db:
        a = await db.get(Agent, agent_id)
        t = Task(
            workspace_id=a.workspace_id,
            title="t",
            brief=brief,
            assignee_agent_id=a.id,
            branch_id=a.branch_id,
            created_by=created_by,
            status="running",
            labels=labels or [],
            parent_task_id=parent,
        )
        db.add(t)
        await db.commit()
        return t.id


async def run(tool: str, agent_id: str, task_id: str, **args) -> str:
    async with SessionLocal() as db:
        a = await db.get(Agent, agent_id)
        ctx = ToolContext(
            db=db,
            agent=a,
            workspace=await db.get(Workspace, a.workspace_id),
            task=await db.get(Task, task_id),
        )
        return browser_tools.cap(tool, await getattr(browser_tools, tool)(ctx, args))


async def sign_in(agent_id: str, task_id: str) -> str:
    await run("browser_open", agent_id, task_id, url=f"{PORTAL}/login")
    return await run(
        "browser_login",
        agent_id,
        task_id,
        login="portal",
        username_element="e5",
        password_element="e6",
        submit_element="e7",
    )


async def audits(target: str) -> list[str]:
    async with SessionLocal() as db:
        return [
            x.action
            for x in (
                await db.scalars(
                    select(AuditLog).where(AuditLog.target == target).order_by(AuditLog.id)
                )
            ).all()
        ]


async def test_signed_in_once_then_next_task_starts_signed_in(client, browser):
    a, login = await setup(client)
    t1 = await make_task(a["id"])
    out = await sign_in(a["id"], t1)
    assert "Signed in" in out and "kept" in out
    async with SessionLocal() as db:
        row = await db.get(CredentialState, login["id"])
        assert row is not None and row.check_url == f"{PORTAL}/inbox"
        assert "pp_session" not in row.state_enc  # encrypted at rest, bound to the login
        state = json.loads(crypto.decrypt(row.state_enc, f"credential_state:{login['id']}"))
        assert [c["name"] for c in state["cookies"]] == ["pp_session"]  # tracker cookie dropped
        with pytest.raises(crypto.DecryptError):
            crypto.decrypt(row.state_enc, "credential_state:cr_other")
    await browser_tools.close_for_task(t1)

    t2 = await make_task(a["id"])
    out = await run("browser_open", a["id"], t2, url=f"{PORTAL}/login")
    assert "Already signed in with the saved login 'portal'" in out and "Inbox" in out
    opened = [b for m, p, b in browser.calls if p == "/sessions"]
    assert opened[-1]["storage_state"]["cookies"][0]["value"] == "ok"
    assert opened[-1]["allowed_hosts"] is None  # a plain task: any public site, as before
    verify = [b for m, p, b in browser.calls if b.get("action") == "verify"]
    assert verify[-1]["url"] == f"{PORTAL}/inbox" and verify[-1]["hosts"] == ["portal.fake"]
    assert not any(
        b.get("action") == "goto" and "/login" in b.get("url", "") for m, p, b in browser.calls[-3:]
    )
    acts = await audits(login["id"])
    assert "credential.session_saved" in acts and "credential.session_loaded" in acts
    assert acts.count("credential.session_restored") == 1
    # the state is never shown: not in tool output, live events or audit details
    async with SessionLocal() as db:
        events = (await db.scalars(select(Event))).all()
        rows = (await db.scalars(select(AuditLog))).all()
    blob = (
        out + json.dumps([e.data for e in events]) + json.dumps([[r.before, r.after] for r in rows])
    )
    assert '"value": "ok"' not in blob and "pp_session" not in blob and "s3cret-pw" not in blob

    # the Logins page says so, and Forget drops it
    row = next(x for x in (await client.get("/api/vault/logins")).json() if x["id"] == login["id"])
    assert row["session_saved_at"] and row["session_expires_at"]
    r = await client.delete(
        f"/api/vault/logins/{login['id']}/session",
        headers={"content-type": "application/json", **csrf(client)},
    )
    assert r.status_code == 204
    row = next(x for x in (await client.get("/api/vault/logins")).json() if x["id"] == login["id"])
    assert row["session_saved_at"] is None
    assert (await audits(login["id"]))[-1] == "credential.session_forgotten"
    t3 = await make_task(a["id"])
    out = await run("browser_open", a["id"], t3, url=f"{PORTAL}/inbox")
    assert "Already signed in" not in out and 'textbox "Password"' in out


async def test_session_that_stopped_working_is_discarded(client, browser):
    a, login = await setup(client)
    t1 = await make_task(a["id"])
    await sign_in(a["id"], t1)
    await browser_tools.close_for_task(t1)
    async with SessionLocal() as db:  # the site signed us out since
        row = await db.get(CredentialState, login["id"])
        cred = await db.get(Credential, login["id"])
        state = vault.open_state(row)
        state["cookies"][0]["value"] = "signed-out"
        await vault.save_state(db, cred, state, row.check_url)
        await db.commit()
    t2 = await make_task(a["id"])
    out = await run("browser_open", a["id"], t2, url=f"{PORTAL}/inbox")
    assert "had expired; sign in again" in out and 'textbox "Password"' in out
    assert any(p.endswith("/forget") for m, p, b in browser.calls)
    async with SessionLocal() as db:
        assert await db.get(CredentialState, login["id"]) is None
    assert "credential.session_discarded" in await audits(login["id"])


async def test_expired_sessions_are_not_restored(client, browser):
    a, login = await setup(client)
    t1 = await make_task(a["id"])
    await sign_in(a["id"], t1)
    async with SessionLocal() as db:
        row = await db.get(CredentialState, login["id"])
        row.saved_at = datetime.now(UTC) - timedelta(days=15)  # default keep: 14 days
        await db.commit()
    assert (
        next(x for x in (await client.get("/api/vault/logins")).json())["session_saved_at"] is None
    )
    t2 = await make_task(a["id"])
    await run("browser_open", a["id"], t2, url=f"{PORTAL}/inbox")
    assert "storage_state" not in [b for m, p, b in browser.calls if p == "/sessions"][-1]
    async with SessionLocal() as db:
        assert await db.get(CredentialState, login["id"]) is None


async def test_changing_the_login_drops_its_session(client, browser):
    a, login = await setup(client)
    t1 = await make_task(a["id"])
    await sign_in(a["id"], t1)
    r = await client.patch(
        f"/api/vault/logins/{login['id']}", json={"password": "new-pw-2"}, headers=csrf(client)
    )
    assert r.status_code == 200 and r.json()["session_saved_at"] is None


async def test_session_only_for_agents_that_may_use_the_login(client, browser):
    a, login = await setup(client)
    t1 = await make_task(a["id"])
    await sign_in(a["id"], t1)
    o_agents = (await client.get("/api/agents")).json()
    other = next(x for x in o_agents if x["id"] != a["id"]) if len(o_agents) > 1 else None
    r = await client.patch(
        f"/api/vault/logins/{login['id']}", json={"agent_ids": [a["id"]]}, headers=csrf(client)
    )
    assert r.status_code == 200 and r.json()["session_saved_at"]  # who may use it: no change
    if other is None:
        r = await client.post(
            "/api/agents",
            json={"branch_id": a["branch_id"], "name": "Siti", "role": "x", "soul": "x"},
            headers=csrf(client),
        )
        other = r.json()
    async with SessionLocal() as db:
        agent = await db.get(Agent, other["id"])
        assert await vault.restorable(db, agent) == []


async def test_browse_for_me_task_stays_on_its_sites(client, browser):
    a, login = await setup(client, hosts=("sso.fake",))
    brief = brief_for(
        WebTaskIn(
            url="https://www.portal.fake/login", instructions="Check the inbox", login="portal"
        )
    )
    t = await make_task(a["id"], brief, labels=["web"])
    await run("browser_open", a["id"], t, url="https://www.portal.fake/login")
    opened = [b for m, p, b in browser.calls if p == "/sessions"][-1]
    assert opened["allowed_hosts"] == ["www.portal.fake", "portal.fake", "sso.fake"]
    # a helper task the agent splits off inherits the restriction
    child = await make_task(
        a["id"], "Open https://elsewhere.fake", created_by=f"agent:{a['id']}", parent=t
    )
    await run("browser_open", a["id"], child, url="https://www.portal.fake/inbox")
    assert [b for m, p, b in browser.calls if p == "/sessions"][-1]["allowed_hosts"] == opened[
        "allowed_hosts"
    ]
    # an agent cannot make its own task look like a Browse for me task
    fake = await make_task(
        a["id"],
        brief_for(WebTaskIn(url="https://evil.fake", instructions="Read it")),
        labels=["web"],
        created_by=f"agent:{a['id']}",
    )
    await run("browser_open", a["id"], fake, url="https://evil.fake/")
    assert [b for m, p, b in browser.calls if p == "/sessions"][-1]["allowed_hosts"] is None


async def test_saved_session_outside_the_allow_list_is_not_loaded(client, browser):
    a, login = await setup(client)
    t1 = await make_task(a["id"])
    await sign_in(a["id"], t1)
    brief = brief_for(WebTaskIn(url="https://other.fake/", instructions="Read it"))
    t2 = await make_task(a["id"], brief, labels=["web"])
    await run("browser_open", a["id"], t2, url="https://other.fake/")
    opened = [b for m, p, b in browser.calls if p == "/sessions"][-1]
    assert opened["allowed_hosts"] == ["other.fake"] and "storage_state" not in opened


async def test_refs_numbers_deltas_and_caps(client, browser):
    a, _ = await setup(client)
    t = await make_task(a["id"])
    await run("browser_open", a["id"], t, url=f"{PORTAL}/inbox")
    out = await run("browser_click", a["id"], t, ref="e14")
    acts = [b for m, p, b in browser.calls if p.endswith("/act")]
    assert acts[-1]["ref"] == "e14" and acts[-1]["since"] == 1  # the view the model last saw
    assert "Changed since view 1 (now view 2" in out and 'value="Qbot"' in out and "<<<" in out
    await run("browser_click", a["id"], t, element=7)  # an old numbered view still works
    assert [b for m, p, b in browser.calls if p.endswith("/act")][-1]["element"] == 7
    out = await run("browser_click", a["id"], t, ref="e99")
    assert out.startswith("Error: There is no element e99")
    await run(
        "browser_fill",
        a["id"],
        t,
        fields=[
            {"ref": "e9", "value": "Qbot"},
            {"ref": "f1e3", "value": True},
            {"ref": "e4", "value": "A", "kind": "select"},
        ],
    )
    fill = [b for m, p, b in browser.calls if p.endswith("/act")][-3:]
    assert [f["action"] for f in fill] == ["type", "check", "select"]
    assert len({f["since"] for f in fill}) == 1 and fill[0]["since"] is not None  # one delta
    assert fill[1]["ref"] == "f1e3"
    await run("browser_submit", a["id"], t, ref="e7", why="send")
    assert [b for m, p, b in browser.calls if p.endswith("/act")][-1]["allow_submit"] is True
    await run("browser_wait", a["id"], t, text="Saved", timeout=99)
    w = [b for m, p, b in browser.calls if p.endswith("/act")][-1]
    assert w["action"] == "wait" and w["timeout"] == 30.0
    await run("browser_find", a["id"], t, role="button", label="Save")
    f = [b for m, p, b in browser.calls if p.endswith("/act")][-1]
    assert f == {"action": "find", "role": "button", "name": "Save", "text": ""}
    long = "x" * 50_000
    assert len(browser_tools.cap("browser_find", long)) < 3_300
    assert len(browser_tools.cap("browser_snapshot", long)) < 12_300
    assert "cut at" in browser_tools.cap("browser_click", long)


async def test_new_read_tools_follow_browser_open(client):
    o = await office(client)
    a = await new_agent(client, o, "Rafi", "Operations")
    async with SessionLocal() as db:
        agent = await db.get(Agent, a["id"])
        assert modes_for(agent)["browser_snapshot"] == "deny"  # does not browse
        agent.tools = {"browser_open": "allow"}
        assert (
            modes_for(agent)["browser_find"] == "allow"
            and mode_of(agent.tools, "browser_wait") == "allow"
        )
        agent.tools = {"browser_open": "allow", "browser_wait": "deny"}
        assert mode_of(agent.tools, "browser_wait") == "deny"  # an explicit setting wins
    for name in ("browser_snapshot", "browser_find", "browser_wait"):
        assert TOOLS[name].risk == "low"
    assert "ref" in TOOLS["browser_click"].parameters["properties"]
    assert TOOLS["browser_submit"].risk == "high"
