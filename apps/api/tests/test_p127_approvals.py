# ruff: noqa: E501
"""P127: every Microsoft approval of the office in one list (owner and global admins: all of it,
branch managers and HODs: their people's, everyone else: their own), the same approval seen
through several accounts once, one account that fails never breaking the list, one approval
opened with its approvers and their answers, answers that need a reason and never come from the
person who asked, and the person's own AI that only PREPARES an answer they send themselves.

Microsoft is faked (httpx MockTransport keyed by each account's access token)."""

import json

import httpx
import pytest
from sqlalchemy import select

from agentic.agents import policy, runtime
from agentic.agents.tools import ToolContext
from agentic.core import crypto
from agentic.core.db import SessionLocal
from agentic.core.valkey import valkey
from agentic.microsoft import app as ms_app
from agentic.microsoft import http, org_approvals
from agentic.models import Agent, ApprovalAnswer, AuditLog, MicrosoftAccount, Workspace

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_microsoft import GRANTED, make_agent, ms, user_id  # noqa: F401
from .test_office_roles import member, signed_in

APPROVALS = f"https://graph.microsoft.com/{ms_app.APPROVALS_SCOPE}"
BASE = "/beta/solutions/approval/approvalItems"


def _item(
    aid: str,
    title: str,
    owner: str,
    owner_name: str,
    roles: list[str],
    approvers: list[str],
    **extra,
) -> dict:
    return {
        "id": aid,
        "displayName": title,
        "description": extra.pop("description", f"Details of {title}"),
        "state": extra.pop("state", "Pending"),
        "approvalType": "basic",
        "owner": {"user": {"id": owner, "displayName": owner_name}},
        "approvers": [
            {"user": {"id": a, "displayName": a.removeprefix("oid-").title()}} for a in approvers
        ],
        "viewPoint": {"roles": roles},
        "responseOptions": ["Approve", "Reject"],
        "createdDateTime": extra.pop("created", "2026-11-20T01:00:00Z"),
        **extra,
    }


# Each account (by its access token) and the approvals Microsoft shows it.
LISTS = {
    "tok-s1": [
        _item("AP1", "Buy laptops", "oid-s1", "S1", ["Owner"], ["oid-s2"], created="2026-11-21T01:00:00Z"),
        _item("AP2", "Hire a driver", "oid-s2", "S2", ["Approver"], ["oid-s1"]),
    ],
    "tok-s2": [
        _item("AP1", "Buy laptops", "oid-s1", "S1", ["Approver"], ["oid-s2"], created="2026-11-21T01:00:00Z"),
        _item("AP2", "Hire a driver", "oid-s2", "S2", ["Owner"], ["oid-s1"]),
        _item("AP5", "Ops overtime", "oid-s2", "S2", ["Owner"], ["oid-ext"],
              description="Roster: https://maju.sharepoint.com/sites/ops/roster.xlsx"),
    ],
    "tok-far": [_item("AP3", "Far away tender", "oid-far", "Far", ["Owner"], ["oid-ext"])],
    "tok-owner": [_item("AP4", "Company car", "oid-ext", "Outside Person", ["Approver"], ["oid-owner"])],
}  # fmt: skip
REQUESTS = {
    "AP1": [{"id": "r1", "owner": {"user": {"id": "oid-s2", "displayName": "S2"}}, "createdDateTime": "2026-11-21T01:00:00Z", "isReassigned": False}],
    "AP5": [{"id": "r5", "owner": {"user": {"id": "oid-ext", "displayName": "Ext Boss"}}, "createdDateTime": "2026-11-20T01:00:00Z", "isReassigned": False}],
}  # fmt: skip
RESPONSES = {
    "AP5": [{"id": "x5", "response": "Approve", "comments": "Fine by me", "createdBy": {"user": {"id": "oid-ext", "displayName": "Ext Boss"}}, "createdDateTime": "2026-11-20T03:00:00Z"}],
}  # fmt: skip


class FakeApprovals:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str]] = []  # token, method, path
        self.answers: list[tuple[str, str, dict]] = []  # token, approval id, body
        http.transport = httpx.MockTransport(self.handler)

    def handler(self, r: httpx.Request) -> httpx.Response:
        token = r.headers.get("authorization", "").removeprefix("Bearer ")
        path = r.url.path
        self.calls.append((token, r.method, path))
        if token == "tok-broken":
            return httpx.Response(500, json={"error": {"code": "x", "message": "down"}})
        mine = {a["id"]: a for a in LISTS.get(token, [])}
        if path == BASE:
            return httpx.Response(200, json={"value": list(mine.values())})
        rest = path.removeprefix(BASE + "/").split("/")
        aid = rest[0]
        if aid not in mine:
            return httpx.Response(404, json={"error": {"code": "NotFound", "message": "no"}})
        if len(rest) == 1:
            return httpx.Response(200, json=mine[aid])
        if rest[1] == "requests":
            return httpx.Response(200, json={"value": REQUESTS.get(aid, [])})
        if rest[1] == "responses" and r.method == "GET":
            return httpx.Response(200, json={"value": RESPONSES.get(aid, [])})
        if rest[1] == "responses" and r.method == "POST":
            self.answers.append((token, aid, json.loads(r.content)))
            return httpx.Response(201, json={})
        return httpx.Response(404, json={})


async def _account(
    ws_id: str, uid: str, token: str, oid: str, *, primary: bool = True
) -> MicrosoftAccount:
    async with SessionLocal() as db:
        a = MicrosoftAccount(workspace_id=ws_id, user_id=uid, email=f"{token}@maju.example.com",
                             display_name=token, status="connected", ms_user_id=oid,
                             scopes=f"{GRANTED} {APPROVALS}", is_primary=primary)  # fmt: skip
        db.add(a)
        await db.flush()
        a.token_enc = crypto.encrypt("rt", a.aad)
        await db.commit()
        await db.refresh(a)
    await valkey().set(f"mstok:{a.id}", token, ex=600)
    return a


@pytest.fixture
def no_background(monkeypatch):
    monkeypatch.setattr(org_approvals, "BACKGROUND", False)


async def _people(client) -> dict:
    """The owner, a branch manager and a Finance HOD of Maju, two staff (Finance, Operations),
    and one staff member of another company. Each of them but the managers connected Microsoft."""
    o = await office(client)
    b2 = (
        await client.post("/api/branches", json={"name": "Jaya Bhd"}, headers=csrf(client))
    ).json()
    b1 = o["branch"]["id"]
    fin, ops = o["depts"]["Finance"], o["depts"]["Operations"]
    far_dept = {d["name"]: d["id"] for d in b2["departments"]}["Finance"]
    out: dict = {"o": o}
    for key, role, where in (
        ("bm", "branch_manager", {"branch_id": b1}),
        ("hod", "hod", {"branch_id": b1, "department_id": fin}),
        ("s1", "staff", {"branch_id": b1, "department_id": fin}),
        ("s2", "staff", {"branch_id": b1, "department_id": ops}),
        ("far", "staff", {"branch_id": b2["id"], "department_id": far_dept}),
    ):
        m = await member(client, f"{key}.p127@example.com", role, **where)
        out[key] = {
            "id": m["member"]["user_id"],
            "temp": m["temp_password"],
            "email": f"{key}.p127@example.com",
        }
    owner_id, ws_id = await user_id("owner@example.com")
    out["owner"], out["ws"] = {"id": owner_id}, ws_id
    await _account(ws_id, owner_id, "tok-owner", "oid-owner")
    await _account(ws_id, out["s1"]["id"], "tok-s1", "oid-s1")
    await _account(
        ws_id, out["s1"]["id"], "tok-broken", "oid-s1-other", primary=False
    )  # P118: a second account, down
    await _account(ws_id, out["s2"]["id"], "tok-s2", "oid-s2")
    await _account(ws_id, out["far"]["id"], "tok-far", "oid-far")
    return out


async def _as(p: dict):
    return await signed_in(p["email"], p["temp"])


def _ids(body: dict) -> list[str]:
    return [a["id"] for a in body["items"]]


async def test_who_sees_which_approvals(client, llm, temporal, ms, no_background):
    p = await _people(client)
    fake = FakeApprovals()

    # The owner: every approval of the office, each once, newest first; one account that fails
    # (s1's second account) is counted, never breaks the list.
    r = await client.get("/api/m365/approvals/all")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["view"] == "all" and body["accounts"] == 5 and body["failed"] == 1
    assert sorted(_ids(body)) == ["AP1", "AP2", "AP3", "AP4", "AP5"]
    assert _ids(body)[0] == "AP1" and len(_ids(body)) == len(set(_ids(body)))  # deduped
    rows = {a["id"]: a for a in body["items"]}
    assert rows["AP4"]["waiting_for_me"] is True and rows["AP1"]["waiting_for_me"] is False
    assert rows["AP1"]["approvers"] == [{"name": "S2"}] and rows["AP1"]["owner"] == "S1"
    assert rows["AP5"]["source"] == "sharepoint" and rows["AP1"]["source"] == "teams"
    assert rows["AP1"]["teams_link"].startswith("https://teams.microsoft.com/l/app/")

    # Kept: a second look within a minute asks Microsoft nothing.
    before = len(fake.calls)
    assert sorted(_ids((await client.get("/api/m365/approvals/all")).json())) == sorted(_ids(body))
    assert [c for c in fake.calls[before:] if c[0] != "tok-broken"] == []

    # A branch manager: approvals where someone of their company asked or is asked.
    bm = await _as(p["bm"])
    got = (await bm.get("/api/m365/approvals/all")).json()
    assert got["view"] == "scope" and sorted(_ids(got)) == ["AP1", "AP2", "AP5"]
    # A Finance HOD: only their department's people (s1), not Operations' own (AP5).
    hod = await _as(p["hod"])
    got = (await hod.get("/api/m365/approvals/all")).json()
    assert sorted(_ids(got)) == ["AP1", "AP2"]
    # Staff: their own only.
    s1 = await _as(p["s1"])
    got = (await s1.get("/api/m365/approvals/all")).json()
    assert got["view"] == "own" and sorted(_ids(got)) == ["AP1", "AP2"] and got["failed"] == 1
    far = await _as(p["far"])
    assert _ids((await far.get("/api/m365/approvals/all")).json()) == ["AP3"]

    # Opening one: only what the viewer may see (404 otherwise, never a peek).
    assert (await s1.get("/api/m365/approvals/all/AP5")).status_code == 404
    assert (await hod.get("/api/m365/approvals/all/AP3")).status_code == 404
    d = (
        await client.get("/api/m365/approvals/all/AP5")
    ).json()  # the owner reads it via s2's account
    assert d["title"] == "Ops overtime" and d["links"] == [
        "https://maju.sharepoint.com/sites/ops/roster.xlsx"
    ]
    assert d["people"][0]["name"] == "Ext Boss" and d["people"][0]["response"] == "Approve"
    assert d["people"][0]["comment"] == "Fine by me" and d["can_answer"] is False
    assert any(c[0] == "tok-s2" and c[2].endswith("/AP5/responses") for c in fake.calls)
    s2 = await _as(p["s2"])
    d = (await s2.get("/api/m365/approvals/all/AP1")).json()
    assert (
        d["waiting_for_me"] is True and d["can_answer"] is True and d["people"][0]["name"] == "S2"
    )
    for c in (bm, hod, s1, far, s2):
        await c.aclose()


async def test_answers_need_a_reason_and_never_answer_ones_own(
    client, llm, temporal, ms, no_background
):
    p = await _people(client)
    fake = FakeApprovals()
    s1, s2 = await _as(p["s1"]), await _as(p["s2"])

    r = await s1.post(
        "/api/m365/approvals/all/AP1/respond",
        json={"response": "Approve", "reason": "All good"},
        headers=csrf(s1),
    )
    assert r.status_code == 409 and r.json()["code"] == "own_request"
    r = await s2.post(
        "/api/m365/approvals/all/AP1/respond", json={"response": "Approve"}, headers=csrf(s2)
    )
    assert r.status_code == 422 and r.json()["code"] == "reason_required"
    r = await s2.post(
        "/api/m365/approvals/all/AP1/respond",
        json={"response": "Maybe", "reason": "Hmm ok"},
        headers=csrf(s2),
    )
    assert r.status_code == 400
    far = await _as(p["far"])
    r = await far.post(
        "/api/m365/approvals/all/AP5/respond",
        json={"response": "Approve", "reason": "Fine"},
        headers=csrf(far),
    )
    assert r.status_code == 409 and r.json()["code"] == "not_yours"
    await far.aclose()
    # s1's second account is down: no guess, an honest "try again".
    r = await s1.post(
        "/api/m365/approvals/all/AP5/respond",
        json={"response": "Approve", "reason": "Fine"},
        headers=csrf(s1),
    )
    assert r.status_code == 502
    # The owner sees everything but answers only what asks them.
    r = await client.post(
        "/api/m365/approvals/all/AP1/respond",
        json={"response": "Approve", "reason": "Fine"},
        headers=csrf(client),
    )
    assert r.status_code == 409 and r.json()["code"] == "not_yours"
    # The page's older answer route needs a reason too.
    r = await s2.post(
        "/api/m365/approvals/AP1/respond", json={"response": "Approve"}, headers=csrf(s2)
    )
    assert r.status_code == 422 and r.json()["code"] == "reason_required"
    assert fake.answers == []

    r = await s2.post(
        "/api/m365/approvals/all/AP1/respond",
        json={"response": "Reject", "reason": "Budget is spent"},
        headers=csrf(s2),
    )
    assert r.status_code == 200, r.text
    assert fake.answers == [
        ("tok-s2", "AP1", {"response": "Reject", "comments": "Budget is spent"})
    ]
    async with SessionLocal() as db:
        log = await db.scalar(select(AuditLog).where(AuditLog.action == "m365.approval_answered"))
        assert log.after == {"response": "Reject", "via": "page"} and "Budget" not in json.dumps(
            log.after
        )
    await s1.aclose()
    await s2.aclose()


async def _tool(agent_id: str, person: str | None, name: str, args: dict) -> str:
    async with SessionLocal() as db:
        agent = await db.get(Agent, agent_id)
        ws = await db.get(Workspace, agent.workspace_id)
        ctx = ToolContext(db=db, agent=agent, workspace=ws, task=None, person=person)
        return await runtime.run_tool(ctx, name, args)


async def test_the_ai_lists_reads_and_only_prepares_answers(
    client, llm, temporal, ms, no_background
):
    p = await _people(client)
    fake = FakeApprovals()
    o = p["o"]
    s2_id = p["s2"]["id"]
    twin = await make_agent(o, p["ws"], s2_id, name="S2 Twin", is_twin=True)

    # Allowed for the person's own AI in chat and tasks (it only prepares); hidden elsewhere.
    async with SessionLocal() as db:
        a = await db.get(Agent, twin.id)
        for tool in ("m365_approvals", "m365_approval", "m365_approval_answer"):
            assert (await policy.evaluate(a, tool, {})).effect == "allow", tool
    team_agent = await make_agent(o, p["ws"], None, name="Team Agent")
    async with SessionLocal() as db:
        a = await db.get(Agent, team_agent.id)
        assert (await policy.evaluate(a, "m365_approvals", {})).effect == "deny"
    assert policy.OUTSIDE_CONTENT >= {"m365_approvals", "m365_approval"}

    # Someone else talking to s2's twin never reaches s2's approvals.
    out = await _tool(twin.id, p["owner"]["id"], "m365_approvals", {})
    assert out.startswith("Error:")

    out = await _tool(twin.id, s2_id, "m365_approvals", {"filter": "waiting_for_me"})
    assert "[AP1] Buy laptops" in out and "WAITING FOR YOUR PERSON" in out and "AP3" not in out
    out = await _tool(twin.id, s2_id, "m365_approvals", {"filter": "all", "search": "overtime"})
    assert "[AP5]" in out and "[AP1]" not in out
    out = await _tool(twin.id, s2_id, "m365_approval", {"approval_id": "AP3"})
    assert out.startswith("Error:")  # not theirs to see
    out = await _tool(twin.id, s2_id, "m365_approval", {"approval_id": "AP1"})
    assert "Buy laptops" in out and "m365_approval_answer" in out

    # No reason: refused (the AI must ask its person). Its person's own request: refused.
    out = await _tool(
        twin.id, s2_id, "m365_approval_answer", {"approval_id": "AP1", "response": "Approve"}
    )
    assert out.startswith("Error:") and "reason" in out
    out = await _tool(
        twin.id,
        s2_id,
        "m365_approval_answer",
        {"approval_id": "AP5", "response": "Approve", "reason": "Needed"},
    )
    assert out.startswith("Error:") and "own request" in out
    out = await _tool(
        twin.id,
        s2_id,
        "m365_approval_answer",
        {"approval_id": "AP1", "response": "Approve", "reason": "Within budget"},
    )
    assert "NOTHING is sent" in out
    assert fake.answers == []  # prepared, not sent
    async with SessionLocal() as db:
        rows = (await db.scalars(select(ApprovalAnswer))).all()
        assert [(r.approval_id, r.response, r.status, r.user_id) for r in rows] == [
            ("AP1", "Approve", "pending", s2_id)
        ]
        answer_id = rows[0].id

    # Only the person sends it (nobody else can see or send it), and may change the reason.
    assert (await client.get("/api/m365/approvals/prepared")).json() == []
    r = await client.post(
        f"/api/m365/approvals/prepared/{answer_id}/send", json={}, headers=csrf(client)
    )
    assert r.status_code == 404 and fake.answers == []
    s2 = await _as(p["s2"])
    waiting = (await s2.get("/api/m365/approvals/prepared")).json()
    assert [w["id"] for w in waiting] == [answer_id] and waiting[0]["reason"] == "Within budget"
    d = (await s2.get("/api/m365/approvals/all/AP1")).json()
    assert [x["id"] for x in d["prepared"]] == [answer_id]
    r = await s2.post(
        f"/api/m365/approvals/prepared/{answer_id}/send",
        json={"reason": "Within this year's budget"},
        headers=csrf(s2),
    )
    assert r.status_code == 200, r.text
    assert fake.answers == [
        ("tok-s2", "AP1", {"response": "Approve", "comments": "Within this year's budget"})
    ]
    r = await s2.post(f"/api/m365/approvals/prepared/{answer_id}/send", json={}, headers=csrf(s2))
    assert r.status_code == 409 and len(fake.answers) == 1
    await s2.aclose()
