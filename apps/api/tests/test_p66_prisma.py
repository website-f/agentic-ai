"""P66: Prima Secure inside the office. Its screens call /api/prisma/... with the office session,
and its AI works in it for the person who asked, both signed for that person
(agentic/prisma/client.py) and checked by Prima (apps/prima/apps/api/src/office.ts)."""

import hashlib
import hmac
import json
from pathlib import Path

import httpx
import pytest
from sqlalchemy import select

from agentic.agents import policy
from agentic.agents.runtime import offered_tools
from agentic.agents.tools import TOOLS, ToolContext
from agentic.core.config import settings
from agentic.core.db import SessionLocal
from agentic.models import Agent, Membership, User, Workspace
from agentic.prisma import client as prima
from agentic.prisma import routes
from agentic.prisma.client import PrimaError

from .conftest import csrf
from .test_agents import new_agent, office

SECRET = "o" * 40
TENANT = "11111111-2222-3333-4444-555555555555"
OID = "0a0a0a0a-0000-4000-8000-000000000001"
PRIMA_SRC = Path(__file__).resolve().parents[2] / "prima" / "apps" / "api" / "src"


@pytest.fixture
def prima_on(monkeypatch):
    monkeypatch.setattr(settings, "prima_url", "http://prima.test:3000")
    monkeypatch.setattr(settings, "prima_secret", SECRET)
    monkeypatch.setattr(settings, "prima_workspace", "")
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        h = req.headers
        url = req.url.raw_path.decode()
        head = (
            f"{h['x-office-ts']}\n{req.method}\n{url}\n{h['x-office-oid']}\n"
            f"{h['x-office-tid']}\n{h['x-office-via']}\n"
        ).encode()
        want = hmac.new(SECRET.encode(), head + req.content, hashlib.sha256).hexdigest()
        if h["x-office-signature"] != want:
            return httpx.Response(401, json={"message": "bad signature"})
        if url == "/api/me":
            return httpx.Response(200, json={"user": {"id": "u-it", "name": "IT Lead", "title": "IT", "role": "director"}})  # noqa: E501
        if url.startswith("/api/payroll"):
            return httpx.Response(403, json={"message": "Only HR runs payroll."})
        return httpx.Response(200, json={"ok": True, "url": url, "body": req.content.decode()})

    monkeypatch.setattr(prima, "transport", httpx.MockTransport(handler))
    return seen


async def _link(email: str = "owner@example.com") -> tuple[str, str]:
    async with SessionLocal() as db:
        user = await db.scalar(select(User).where(User.email == email))
        m = await db.scalar(select(Membership).where(Membership.user_id == user.id))
        m.ms_oid, m.ms_tenant_id = OID, TENANT
        await db.commit()
        return user.id, m.workspace_id


def test_signs_as_prima_checks():
    """The same test vector as apps/prima/apps/api/test/office.test.ts."""
    old = settings.prima_secret
    settings.prima_secret = SECRET
    try:
        sig = prima.sign(
            "2026-11-06T01:00:00.000Z", "post", "/api/leave?x=1", OID, TENANT,
            "agent:Chief of Staff", b'{"a":1}',
        )  # fmt: skip
    finally:
        settings.prima_secret = old
    assert sig == "8f4bc82cb2e354fd2c2737f3aa10b7ec011b91d3933ee4424eb0331eea3e8e21"


@pytest.mark.skipif(not PRIMA_SRC.is_dir(), reason="apps/prima not in this checkout")
def test_the_catalog_is_prima_s_api():
    built = routes.build(PRIMA_SRC)
    kept = json.loads((Path(routes.__file__).with_name("routes.json")).read_text(encoding="utf-8"))
    assert built == kept, "Run: python -m agentic.prisma.routes ../prima/apps/api/src > agentic/prisma/routes.json"  # noqa: E501
    paths = {(r["method"], r["path"]) for r in kept}
    assert ("GET", "api/leave") in paths and ("POST", "api/claims") in paths
    # The signed system feeds and development sign-in are never offered.
    assert not any(str(p).startswith(("api/integrations", "api/auth/dev-login")) for _, p in paths)
    assert routes.find("apply leave")[0]["path"].startswith("api/leave")


def test_only_prima_s_own_addresses():
    assert prima.clean_path("api/leave", "x=1&y=a%20b") == "/api/leave?x=1&y=a%20b"
    for bad in ("api/../x", "etc/passwd", "api//x", "api/leave?x=1", "api/x y"):
        with pytest.raises(PrimaError):
            prima.clean_path(bad)
    for closed in ("api/integrations/ja/v1/staff", "api/auth/dev-login", "api/auth/users"):
        with pytest.raises(PrimaError) as e:
            prima.clean_path(closed)
        assert e.value.status == 403
    with pytest.raises(PrimaError):
        prima.clean_path("api/leave", "x=<script>")


async def test_prima_screens_open_with_the_office_sign_in(client, prima_on):
    await office(client)
    # Not signed in with Microsoft yet: Prima cannot know who this is.
    s = (await client.get("/api/prisma/status")).json()
    assert s["enabled"] and not s["linked"] and "Sign in with Microsoft" in s["problem"]
    r = await client.get("/api/prisma/api/me")
    assert r.status_code == 403 and "Microsoft work account" in r.json()["message"]
    assert not prima_on

    await _link()
    s = (await client.get("/api/prisma/status")).json()
    assert s["linked"] and s["me"]["name"] == "IT Lead"

    r = await client.get("/api/prisma/api/leave?x=1")
    assert r.status_code == 200 and r.json()["url"] == "/api/leave?x=1"
    sent = prima_on[-1]
    assert sent.headers["x-office-via"] == "person" and sent.headers["x-office-oid"] == OID
    assert sent.headers["x-forwarded-for"]  # Prima's per-address limit sees the person's

    # Writes carry the office's CSRF token, like every other screen, and the exact body.
    r = await client.post("/api/prisma/api/leave", json={"days": 2})
    assert r.status_code == 403
    r = await client.post("/api/prisma/api/leave", content=b'{"days":2}', headers={**csrf(client), "content-type": "application/json"})  # noqa: E501
    assert r.status_code == 200 and r.json()["body"] == '{"days":2}'

    # Prima's own refusal comes back as it is; closed parts never reach it.
    r = await client.get("/api/prisma/api/payroll")
    assert r.status_code == 403 and r.json()["message"] == "Only HR runs payroll."
    n = len(prima_on)
    r = await client.get("/api/prisma/api/integrations/ja/v1/staff")
    assert r.status_code == 403 and len(prima_on) == n

    # Signed out: nothing reaches Prima.
    client.cookies.clear()
    assert (await client.get("/api/prisma/api/me")).status_code == 401


async def test_not_set_up_means_no_prima(client, monkeypatch):
    monkeypatch.setattr(settings, "prima_url", "")
    await office(client)
    s = (await client.get("/api/prisma/status")).json()
    assert s == {"enabled": False, "running": False, "linked": False, "me": None, "problem": ""}
    assert (await client.get("/api/prisma/api/me")).status_code == 404


async def _ctx(db, agent_id: str, person: str | None) -> ToolContext:
    a = await db.get(Agent, agent_id)
    ws = await db.get(Workspace, a.workspace_id)
    return ToolContext(db=db, agent=a, workspace=ws, task=None, person=person)


async def test_the_ai_works_in_prima_as_the_person_who_asked(client, prima_on):
    o = await office(client)
    agent = await new_agent(client, o, "Chief of Staff", dept="Finance")
    owner_id, _ws = await _link()

    async with SessionLocal() as db:
        ctx = await _ctx(db, agent["id"], owner_id)
        found = await TOOLS["prisma_find"].handler(ctx, {"query": "leave"})
        assert "api/leave" in found
        out = await TOOLS["prisma_read"].handler(ctx, {"path": "/leave", "query": {"x": "1"}})
        assert '"url": "/api/leave?x=1"' in out
        assert prima_on[-1].headers["x-office-via"] == "agent:Chief of Staff"
        out = await TOOLS["prisma_record"].handler(
            ctx, {"path": "api/claims", "body": {"amount": 12}, "why": "taxi claim"}
        )
        assert '"body": "{\\"amount\\":12}"' in out
        refused = await TOOLS["prisma_read"].handler(ctx, {"path": "api/payroll"})
        assert refused.startswith("Error: Prima refused (403)") and "Only HR" in refused

        # Nobody asked (the office's own work): never as anyone.
        n = len(prima_on)
        nobody = await TOOLS["prisma_read"].handler(await _ctx(db, agent["id"], None), {"path": "api/me"})  # noqa: E501
        assert nobody.startswith("Error:") and len(prima_on) == n

        # Recording waits for a person, even on autonomy "auto"; reading does not.
        a = await db.get(Agent, agent["id"])
        assert (await policy.evaluate(a, "prisma_read", {"path": "api/me"})).effect == "allow"
        assert (await policy.evaluate(a, "prisma_record", {"path": "api/claims", "body": {}, "why": "x"})).effect == "ask"  # noqa: E501
        a.autonomy = "auto"
        assert (await policy.evaluate(a, "prisma_record", {"path": "api/claims", "body": {}, "why": "x"})).effect == "ask"  # noqa: E501
        names = {t["function"]["name"] for t in offered_tools(a)}
        assert {"prisma_find", "prisma_read", "prisma_record"} <= names


async def test_no_prima_tools_without_prima(client, monkeypatch):
    monkeypatch.setattr(settings, "prima_secret", "")
    o = await office(client)
    agent = await new_agent(client, o, "Chief of Staff", dept="Finance")
    async with SessionLocal() as db:
        a = await db.get(Agent, agent["id"])
        names = {t["function"]["name"] for t in offered_tools(a)}
        assert not names & {"prisma_find", "prisma_read", "prisma_record"}
        assert (await policy.evaluate(a, "prisma_read", {"path": "api/me"})).effect == "deny"
