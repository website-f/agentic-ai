"""P92: what each role reaches through the API.

Walks the FastAPI route table and calls every GET as staff (and viewer, operator, approver,
supervisor) in a seeded workspace. Nothing workspace-wide or high-level may come back to a
staff member: other people's work, the AI engine's providers and keys, channel numbers and
errors, the members list, money, audit, settings. Canary strings mark what must not leak.
Every write route is also called as staff with an empty body: none may answer 2xx unless it is
one of the staff's own things, and none may crash.

P92_DUMP=<folder> writes what each role got, route by route, for review.
"""

import json
import os
import re
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from fastapi.routing import APIRoute
from sqlalchemy import select, update

from agentic.channels import whatsapp
from agentic.core import crypto
from agentic.core.db import SessionLocal
from agentic.core.ids import new_id
from agentic.models import Agent, AIProvider, Approval, Channel, User, Workspace

from .conftest import csrf
from .test_agents import llm, new_agent, new_task, office, temporal  # noqa: F401
from .test_office_roles import as_role, member

# What must never reach a staff member, wherever it appears.
CANARIES = {
    "FarCanaryAgent": "an agent of another company",
    "FarTaskCanary": "a task of another company",
    "BranchTaskCanary": "a task of an agent staff only watch",
    "ProvCanaryZ": "an AI provider's name",
    "good.fake": "an AI provider's address",
    "good-key-123": "an AI provider's key",
    "60199990000": "the WhatsApp number of a channel that is not working",
    "ErrCanaryZ": "a channel's last error",
    "colleague.canary@example.com": "another member's email",
    "VaultCanary": "someone else's saved login",
    "owner-secret-pw": "a saved login's password",
    "WahaKeyCanary": "the WhatsApp gateway's key",
    "waha.fake": "the WhatsApp gateway's address",
    "ObjCanaryZ": "another company's objective",
    "SopCanaryZ": "another company's SOP",
    "Jaya Bhd": "another company",
}

DUMP = os.environ.get("P92_DUMP")


@pytest.fixture(autouse=True)
def waha(monkeypatch):
    """The office WhatsApp gateway, broken unless a test says otherwise."""
    state = {"status": None}

    async def waha_status(cfg):
        if state["status"] == "WORKING":
            return {"status": "WORKING", "me": {"id": "60122223333@c.us", "pushName": "Office"}}
        raise whatsapp.WhatsAppError("ErrCanaryZ gateway refused", status=500)

    async def waha_ensure_webhook(cfg, url):
        return None

    monkeypatch.setattr(whatsapp, "waha_status", waha_status)
    monkeypatch.setattr(whatsapp, "waha_ensure_webhook", waha_ensure_webhook)
    return state


def _walk(routes, prefix=""):
    for r in routes:
        if type(r).__name__ == "_IncludedRouter":
            yield from _walk(r.original_router.routes, prefix + r.include_context.prefix)
        elif isinstance(r, APIRoute):
            yield prefix + r.path, r


def api_routes(get: bool) -> list[tuple[str, str]]:
    from agentic.api.main import app

    out = set()
    for path, r in _walk(app.routes):
        if not path.startswith("/api/"):
            continue
        for m in r.methods:
            if (m == "GET") == get and m != "HEAD":
                out.add((m, path))
    return sorted(out, key=lambda x: (x[1], x[0]))


async def seed(client: httpx.AsyncClient) -> dict:
    """An owner's office: two companies, agents and work in both, an AI provider, a broken
    WhatsApp channel, an objective and an SOP of the other company, a saved login, a colleague."""
    o = await office(client)
    async with SessionLocal() as db:
        await db.execute(update(AIProvider).values(name="ProvCanaryZ"))
        await db.commit()
    b2 = (
        await client.post("/api/branches", json={"name": "Jaya Bhd"}, headers=csrf(client))
    ).json()
    b2_depts = {d["name"]: d["id"] for d in b2["departments"]}
    branch_agent = await new_agent(client, o, "Branch Helper", "Finance")
    far = (
        await client.post(
            "/api/agents",
            json={
                "branch_id": b2["id"],
                "department_id": b2_depts["Finance"],
                "name": "FarCanaryAgent",
                "role": "Finance agent",
            },
            headers=csrf(client),
        )
    ).json()
    far_task = await new_task(client, far, "FarTaskCanary")
    await new_task(client, branch_agent, "BranchTaskCanary")
    r = await client.post(
        "/api/objectives",
        json={"title": "ObjCanaryZ grow sales", "branch_id": b2["id"]},
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    objective = r.json()
    r = await client.post(
        "/api/sops",
        json={"scope": "branch", "scope_id": b2["id"], "title": "SopCanaryZ", "body": "x"},
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    r = await client.post(
        "/api/vault/logins",
        json={
            "name": "VaultCanary",
            "hosts": ["portal.example.com"],
            "username": "owner-user",
            "password": "owner-secret-pw",
        },
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace.id))
        cid = new_id("ch")
        cfg = whatsapp.Config(base_url="https://waha.fake", api_key="WahaKeyCanary")
        ch = Channel(
            id=cid,
            workspace_id=ws,
            kind="whatsapp",
            name="Office WhatsApp",
            config_enc=crypto.encrypt(cfg.dump(), f"channel:{cid}"),
            state={
                "provider": "waha",
                "number": "60199990000",
                "status": "FAILED",
                "last_error": "ErrCanaryZ refused",
            },
            enabled=True,
        )
        db.add(ch)
        await db.commit()
        channel_id = ch.id
    await pending_approval(far["id"], far_task["id"])
    where = {"branch_id": o["branch"]["id"], "department_id": o["depts"]["Finance"]}
    await member(client, "colleague.canary@example.com", "staff", **where)
    return {
        "o": o,
        "b2": b2,
        "far": far,
        "far_task": far_task,
        "objective": objective,
        "where": where,
        "channel_id": channel_id,
    }


async def pending_approval(agent_id: str, task_id: str) -> None:
    now = datetime.now(UTC)
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace.id))
        db.add(
            Approval(
                workspace_id=ws,
                task_id=task_id,
                agent_id=agent_id,
                tool_name="send_email",
                tool_call_id=f"call-{agent_id[-6:]}",
                created_at=now,
                expires_at=now + timedelta(days=1),
            )
        )
        await db.commit()


async def give_own_agent(client: httpx.AsyncClient, s: dict, email: str) -> dict:
    """An agent this person owns, with one decision waiting for them."""
    agent = await new_agent(client, s["o"], "Own Helper", "Finance")
    async with SessionLocal() as db:
        uid = await db.scalar(select(User.id).where(User.email == email))
        await db.execute(update(Agent).where(Agent.id == agent["id"]).values(owner_user_id=uid))
        await db.commit()
    task = await new_task(client, agent, "My own work")
    await pending_approval(agent["id"], task["id"])
    return agent


def fill(path: str, s: dict) -> str:
    """Path parameters point at things the caller must not reach (or at nothing)."""
    ids = {
        "agent_id": s["far"]["id"],
        "task_id": s["far_task"]["id"],
        "branch_id": s["b2"]["id"],
        "objective_id": s["objective"]["id"],
        "dept_id": s["o"]["depts"]["Finance"],
        "channel_id": s["channel_id"],
    }

    def sub(m: re.Match) -> str:
        return ids.get(m.group(1).split(":")[0], "x-missing")

    return re.sub(r"\{([^}]+)\}", sub, path)


SKIP = {"/api/events"}  # a stream


async def walk(c: httpx.AsyncClient, s: dict) -> dict[str, tuple[int, str]]:
    out: dict[str, tuple[int, str]] = {}
    for _, path in api_routes(get=True):
        if path in SKIP:
            continue
        r = await c.get(fill(path, s))
        out[path] = (r.status_code, r.text)
    return out


def dump(role: str, res: dict[str, tuple[int, str]]) -> None:
    if DUMP:
        with open(os.path.join(DUMP, f"{role}.json"), "w", encoding="utf-8") as f:
            json.dump({k: [v[0], v[1][:3000]] for k, v in res.items()}, f, indent=1)


def leaks(res: dict[str, tuple[int, str]], canaries) -> list[str]:
    return [
        f"{path} -> {c} ({CANARIES.get(c, c)})"
        for path, (st, body) in res.items()
        if st < 300
        for c in canaries
        if c in body
    ]


def crashes(res: dict[str, tuple[int, str]]) -> list[str]:
    return [f"{p} -> {st}" for p, (st, _) in res.items() if st >= 500]


# Every GET that answers a staff member (2xx). A new one fails this test until someone checks
# what it returns to staff and adds it here.
STAFF_OK = {
    "/api/agents", "/api/agents/templates", "/api/agents/tools", "/api/ai/groups",
    "/api/approvals", "/api/assistants", "/api/auth/2fa", "/api/auth/2fa/policy", "/api/auth/me",
    "/api/auth/setup-status", "/api/auth/sso", "/api/blueprints", "/api/branches",
    "/api/brain/dreams",  # the nightly tidy-up, only their own agents' share (test_staff_policy)
    # scoped to their own AI (test_p29_security)
    "/api/brain/facts", "/api/brain/page", "/api/brain/pages", "/api/brain/search",
    "/api/devices/my-pc-status", "/api/lessons", "/api/learning/digest",  # their own PC and AI
    "/api/procedures/summary",  # P96: learned work of the agents they see (their own AI)
    "/api/desk/meetings",  # P97: today's meetings from their own calendar
    # P97: the tasks given to them, and the people they may give a task to (themselves)
    "/api/me/assigned-tasks", "/api/team/people",
    "/api/branches/starter-teams", "/api/broadcasts", "/api/budgets", "/api/calendar-drafts",
    "/api/channels", "/api/channels/{channel_id}/whatsapp", "/api/chat/recent",
    "/api/company-kits",
    "/api/departments/{dept_id}/review-policy", "/api/desk", "/api/desk/ask-targets",
    "/api/desk/items", "/api/devices", "/api/doc-templates", "/api/documents",
    "/api/documents/review-queue", "/api/documents/review-queue/count", "/api/documents/stats",
    "/api/email-drafts", "/api/feedback/config", "/api/feedback/mine", "/api/files",
    "/api/files/by-task", "/api/files/labels", "/api/files/stats", "/api/files/tree",
    "/api/forms", "/api/forms/starters", "/api/intake", "/api/integrations/google",
    "/api/integrations/microsoft", "/api/integrations/microsoft/account", "/api/library",
    "/api/library/linked", "/api/mail/activity", "/api/me/allowance", "/api/me/needs",
    "/api/me/prefs", "/api/me/staff", "/api/me/twin", "/api/me/worker", "/api/meetings",
    "/api/members", "/api/minutes", "/api/minutes/settings", "/api/monitor/wall",
    "/api/objectives", "/api/packs", "/api/pings",
    "/api/prima/status", "/api/push/devices", "/api/push/key", "/api/reports", "/api/runs",
    "/api/schedules", "/api/search/suggest", "/api/sops", "/api/system/status",
    "/api/tasks", "/api/timetable", "/api/tutorial/progress", "/api/vault/logins",
    "/api/workflow-runs", "/api/workflows",
}  # fmt: skip

# Office-wide pages staff never open: refused outright (not just empty).
STAFF_REFUSED = {
    "/api/brain/overview", "/api/brain/graph",
    "/api/skills", "/api/skill-proposals", "/api/learning/overview",
    "/api/learning/week", "/api/objectives/{objective_id}", "/api/objectives/{objective_id}/tasks",
    "/api/ai/providers", "/api/ai/usage", "/api/audit", "/api/overview", "/api/impact",
    "/api/allowances", "/api/workspace/data", "/api/office/{branch_id}",
}  # fmt: skip


async def test_staff_reach_only_their_own_work(client, llm, temporal):  # noqa: F811
    s = await seed(client)
    email = "staff.p92@example.com"
    staff = await as_role(client, email, "staff", **s["where"])
    await give_own_agent(client, s, email)
    res = await walk(staff, s)
    dump("staff", res)
    assert not crashes(res), crashes(res)
    assert not leaks(res, CANARIES), leaks(res, CANARIES)

    answered = {p for p, (st, _) in res.items() if st < 300}
    assert answered <= STAFF_OK, f"new GETs answer staff, check them: {sorted(answered - STAFF_OK)}"
    for path in STAFF_REFUSED:
        assert path in res, path  # the list stays true to the routes
        assert res[path][0] in (403, 404), (path, res[path])

    # Their own numbers: the app badge is the decision waiting for them, not the office's.
    st = json.loads(res["/api/system/status"][1])
    counts = st["counts"]
    assert counts["approvals_pending"] == 1 and counts["agents"] == 1
    assert counts["members"] == counts["providers"] == counts["branches"] == 0
    assert counts["skill_proposals_pending"] == 0 and counts["tasks"] == 1
    assert all(c["detail"] == "" for c in st["components"])
    owner_counts = (await client.get("/api/system/status")).json()["counts"]
    assert owner_counts["approvals_pending"] == 2 and owner_counts["members"] == 3

    # The model pickers keep the names and whether a group has models, not what is in it.
    smart = next(g for g in json.loads(res["/api/ai/groups"][1]) if g["name"] == "smart")
    assert smart["members"] == [] and smart["size"] == 1
    full = next(g for g in (await client.get("/api/ai/groups")).json() if g["name"] == "smart")
    assert full["members"] and full["size"] == 1

    # A channel: enough to link their phone; not the gateway, its errors or a dead number.
    [ch] = json.loads(res["/api/channels"][1])
    assert ch["number"] is None and ch["last_error"] is None and ch["provider"] is None
    [och] = (await client.get("/api/channels")).json()
    assert och["number"] == "60199990000" and och["last_error"]

    # The members list is themselves; the objectives picker their company's (none here).
    assert [m["email"] for m in json.loads(res["/api/members"][1])] == [email]
    assert json.loads(res["/api/objectives"][1]) == []
    await staff.aclose()


async def test_staff_objective_picker_has_no_money(client, llm, temporal):  # noqa: F811
    s = await seed(client)
    r = await client.post(
        "/api/objectives",
        json={"title": "Our goal", "branch_id": s["o"]["branch"]["id"], "budget_usd": 500},
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    staff = await as_role(client, "staff.p92@example.com", "staff", **s["where"])
    [ob] = (await staff.get("/api/objectives?status=active")).json()
    assert ob["title"] == "Our goal" and ob["budget_usd"] is None and ob["budget_state"] == "none"
    assert (await staff.get(f"/api/objectives/{ob['id']}")).status_code == 403
    assert (await staff.get(f"/api/objectives/{ob['id']}/tasks")).status_code == 403
    sup = await as_role(client, "sup.p92@example.com", "supervisor", **s["where"])
    assert (await sup.get(f"/api/objectives/{ob['id']}")).status_code == 200
    await staff.aclose()
    await sup.aclose()


async def test_staff_see_a_working_office_number_and_own_company_sops(client, llm, temporal, waha):  # noqa: F811
    s = await seed(client)
    r = await (await as_role(client, "x.p92@example.com", "staff", **s["where"])).get(
        f"/api/channels/{s['channel_id']}/whatsapp"
    )
    assert r.status_code == 200 and r.json()["number"] is None and "error" not in r.json()
    waha["status"] = "WORKING"
    staff = await as_role(client, "staff.p92@example.com", "staff", **s["where"])
    async with SessionLocal() as db:
        ch = await db.get(Channel, s["channel_id"])
        ch.state = {"provider": "waha", "number": "60122223333", "status": "WORKING"}
        await db.commit()
    [ch] = (await staff.get("/api/channels")).json()
    assert ch["number"] == "60122223333"  # they message it to link their WhatsApp
    st = (await staff.get(f"/api/channels/{s['channel_id']}/whatsapp")).json()
    assert st["number"] == "60122223333" and st["provider"] is None and "base_url" not in st
    for scope, scope_id, title in [
        ("workspace", None, "Every company rule"),
        ("branch", s["o"]["branch"]["id"], "Our company rule"),
        ("department", s["o"]["depts"]["Finance"], "Our finance rule"),
        ("department", s["o"]["depts"]["Operations"], "Ops rule"),
    ]:
        r = await client.post(
            "/api/sops",
            json={"scope": scope, "scope_id": scope_id, "title": title, "body": "x"},
            headers=csrf(client),
        )
        assert r.status_code == 201, r.text
    r = await client.post(
        "/api/sops",
        json={"scope": "workspace", "title": "AI draft", "body": "x", "status": "draft"},
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    titles = {x["title"] for x in (await staff.get("/api/sops")).json()}
    assert titles == {"Every company rule", "Our company rule", "Our finance rule"}
    assert "SopCanaryZ" in {x["title"] for x in (await client.get("/api/sops")).json()}
    # Their own company's kit only.
    kits = (await staff.get("/api/company-kits")).json()
    assert [k["branch_id"] for k in kits] == [s["o"]["branch"]["id"]]
    assert (await staff.get(f"/api/company-kits/{s['b2']['id']}")).status_code == 404
    await staff.aclose()


# Writes a staff member makes with an empty body that may succeed: their own things only.
STAFF_WRITE_OK = {
    ("DELETE", "/api/search/recent"),  # their own recent searches
    ("POST", "/api/me/needs/seen"),  # their own "seen" mark
    ("POST", "/api/push/unsubscribe"),  # this device
    ("PUT", "/api/me/prefs"),  # their own preferences
    ("PUT", "/api/desk/items/order"),  # their own desk
    ("POST", "/api/tutorial/progress"),  # their own tutorial
    ("POST", "/api/auth/logout"),  # signs themselves out (walked last)
    ("POST", "/api/auth/2fa/setup"),  # their own two-step sign-in
    ("DELETE", "/api/integrations/google/account"),  # their own Google connection
    ("DELETE", "/api/integrations/microsoft/account"),  # their own Microsoft connection
    ("POST", "/api/integrations/microsoft/notify"),  # Microsoft's webhook (checks its own secret)
    ("POST", "/api/channels/{channel_id}/link-code"),  # linking their own phone
    ("POST", "/api/me/twin"),  # their own AI twin
    ("POST", "/api/me/twin/preview"),
    ("POST", "/api/me/worker/hire"),
    ("PUT", "/api/me/worker/workflows"),
    ("POST", "/api/documents"),  # a draft document of their own
    ("POST", "/api/doc-templates/detect"),  # reads placeholders from the text sent, saves nothing
    ("POST", "/api/library/delete"),  # nothing named, nothing removed (each item is checked)
    ("POST", "/api/tasks/retry-failed"),  # only failed work of their own (scope.task_where)
    ("POST", "/api/devices/link-code"),  # linking their own computer (P92 own PC)
    ("POST", "/api/devices/my-pc-status/ask"),  # asks their own computer to allow ePerolehan
    ("PUT", "/api/desk/layout"),  # P97: their own desk's sections and order
}


async def test_staff_writes_refused_beyond_their_own(client, llm, temporal):  # noqa: F811
    s = await seed(client)
    staff = await as_role(client, "staff.p92@example.com", "staff", **s["where"])
    got: dict[tuple[str, str], int] = {}
    routes = [r for r in api_routes(get=False) if r != ("POST", "/api/auth/logout")]
    for method, path in [*routes, ("POST", "/api/auth/logout")]:
        r = await staff.request(method, fill(path, s), json={}, headers=csrf(staff))
        got[(method, path)] = r.status_code
    crashed = sorted(k for k, v in got.items() if v >= 500)
    assert not crashed, crashed
    extra = sorted(k for k, v in got.items() if v < 300 and k not in STAFF_WRITE_OK)
    assert not extra, " | ".join(f"{m} {p}" for m, p in extra)
    await staff.aclose()


# P99: a Prima-only person (core/access.py). The office answers signing in, their own password,
# two-step sign-in and language, Prima, and the feedback button; pages with no sign-in answer
# anyone. Everything else is refused before any route runs ("prima_only").
PRIMA_ONLY_OK = {
    "/api/auth/me", "/api/auth/2fa", "/api/me/prefs", "/api/prima/status",
    "/api/feedback/config", "/api/feedback/mine",
    # no sign-in needed
    "/api/auth/setup-status", "/api/auth/sso",
}  # fmt: skip
PRIMA_ONLY_WRITE_OK = {
    ("PUT", "/api/me/prefs"), ("POST", "/api/auth/2fa/setup"), ("POST", "/api/auth/logout"),
    ("POST", "/api/integrations/microsoft/notify"),  # Microsoft's webhook (its own secret)
}  # fmt: skip


async def _prima_only(client, s: dict, email: str) -> httpx.AsyncClient:
    c = await as_role(client, email, "staff", **s["where"])
    async with SessionLocal() as db:
        uid = await db.scalar(select(User.id).where(User.email == email))
    r = await client.put(
        f"/api/members/{uid}/prima-access", json={"access": "prima_only"}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text
    return c


async def test_prima_only_reach_only_prima(client, llm, temporal):  # noqa: F811
    s = await seed(client)
    email = "prima.only.p99@example.com"
    c = await _prima_only(client, s, email)
    await give_own_agent(client, s, email)  # an agent they had before: out of reach now
    res = await walk(c, s)
    dump("prima_only", res)
    assert not crashes(res), crashes(res)
    assert not leaks(res, CANARIES), leaks(res, CANARIES)
    answered = {p for p, (st, _) in res.items() if st < 300}
    assert answered <= PRIMA_ONLY_OK, (
        f"new GETs answer Prima-only: {sorted(answered - PRIMA_ONLY_OK)}"
    )
    closed = {p for p, (st, body) in res.items() if st == 403 and '"prima_only"' in body}
    for path in ("/api/tasks", "/api/desk", "/api/agents", "/api/chat/recent", "/api/members",
                 "/api/me/twin", "/api/files", "/api/approvals", "/api/prima/people"):  # fmt: skip
        assert path in closed, path

    got: dict[tuple[str, str], int] = {}
    writes = [r for r in api_routes(get=False) if r != ("POST", "/api/auth/logout")]
    for method, path in [*writes, ("POST", "/api/auth/logout")]:
        r = await c.request(method, fill(path, s), json={}, headers=csrf(c))
        got[(method, path)] = r.status_code
    assert not sorted(k for k, v in got.items() if v >= 500)
    extra = sorted(k for k, v in got.items() if v < 300 and k not in PRIMA_ONLY_WRITE_OK)
    assert not extra, " | ".join(f"{m} {p}" for m, p in extra)
    await c.aclose()


SECRETS = [
    "good-key-123", "owner-secret-pw", "ErrCanaryZ", "60199990000", "WahaKeyCanary", "waha.fake"
]  # fmt: skip


@pytest.mark.parametrize("role", ["viewer", "operator", "approver", "supervisor"])
async def test_other_roles_get_no_secrets(client, llm, temporal, role):  # noqa: F811
    s = await seed(client)
    c = await as_role(client, f"{role}.p92@example.com", role, **s["where"])
    res = await walk(c, s)
    dump(role, res)
    assert not crashes(res), crashes(res)
    assert not leaks(res, SECRETS), leaks(res, SECRETS)
    if role == "supervisor":  # a department's view: not another company's work or the engine
        far = ["FarCanaryAgent", "FarTaskCanary", "ProvCanaryZ", "good.fake"]
        assert not leaks(res, far), leaks(res, far)
        assert "Jaya Bhd" not in res["/api/company-kits"][1]
    await c.aclose()
