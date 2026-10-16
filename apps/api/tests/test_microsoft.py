"""P34: Microsoft 365 / Outlook through Microsoft Graph (never EWS): the app config, a
person's own Outlook (OAuth bound to their session, token refresh, reconnect_needed), admin
consent, shared mailboxes (RBAC 403), the Graph webhook (handshake, clientState, lifecycle),
delta sync into MailItem (idempotent), polling without public https, who sees mail
activity, and disconnect.

Microsoft is faked with an httpx MockTransport (microsoft/http.py); nothing real is called.
"""

import base64
import json
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from sqlalchemy import func, select

from agentic.api.scope import Scope
from agentic.core import crypto
from agentic.core.db import SessionLocal
from agentic.core.valkey import valkey
from agentic.microsoft import access, auth, features, graph, http, sync
from agentic.microsoft.errors import ReconnectNeeded, Throttled
from agentic.models import (
    Agent,
    AuditLog,
    Event,
    MailItem,
    MailSubscription,
    MicrosoftAccount,
    SharedMailbox,
    User,
)

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_office_roles import as_role

CLIENT_ID = "11111111-2222-3333-4444-555555555555"
TENANT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
PUBLIC = {"x-forwarded-proto": "https", "x-forwarded-host": "agentic.example.com"}
GRANTED = (
    "openid profile email offline_access https://graph.microsoft.com/User.Read "
    "https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send "
    "https://graph.microsoft.com/Calendars.ReadWrite"
)
G = "https://graph.microsoft.com/v1.0"


def _jwt(claims: dict) -> str:
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()  # noqa: E731
    return f"{enc({'alg': 'none'})}.{enc(claims)}.sig"


def _msg(mid: str, subject: str, minutes_ago: int = 5, **extra) -> dict:
    return {
        "id": mid,
        "conversationId": f"conv-{mid}",
        "internetMessageId": f"<{mid}@client.example.com>",
        "receivedDateTime": (datetime.now(UTC) - timedelta(minutes=minutes_ago)).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        ),
        "from": {"emailAddress": {"name": "Ahmad", "address": "Ahmad@Client.example.com"}},
        "subject": subject,
        "hasAttachments": mid.endswith("a"),
        "isRead": False,
        "isDraft": False,
        **extra,
    }


class FakeMicrosoft:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict]] = []
        self.refresh_fails = False
        self.refreshes = 0
        self.inbox: dict[str, list[dict]] = {"me": [], "users/info@example.com": []}
        self.forbidden: set[str] = set()
        self.subs: dict[str, dict] = {}
        self.renewed: list[str] = []
        self.deleted: list[str] = []
        self.throttle_left = 0

    # -------------------------------------------------------- helpers

    def delta_calls(self) -> list[dict]:
        return [p for m, u, p in self.calls if m == "GET" and "/messages/delta" in u]

    def _page(self, root: str, start: int, query: dict) -> httpx.Response:
        msgs = self.inbox[root]
        base = f"{G}/{root}/mailFolders/inbox/messages/delta"
        if start == 0 and "$deltatoken" not in query and len(msgs) > 1:
            # first round: two pages
            return httpx.Response(
                200, json={"value": msgs[:1], "@odata.nextLink": f"{base}?$skiptoken=1"}
            )
        return httpx.Response(
            200, json={"value": msgs[start:], "@odata.deltaLink": f"{base}?$deltatoken={len(msgs)}"}
        )

    # -------------------------------------------------------- the transport

    def handler(self, r: httpx.Request) -> httpx.Response:
        q = {k: v[0] for k, v in parse_qs(r.url.query.decode()).items()}
        path = r.url.path
        self.calls.append((r.method, f"{r.url.host}{path}", q))
        if r.url.host == "login.microsoftonline.com":
            form = {k: v[0] for k, v in parse_qs(r.content.decode()).items()}
            assert path.endswith("/oauth2/v2.0/token"), path
            grant = form["grant_type"]
            if grant == "authorization_code":
                assert form["code"] == "good-code" and form["code_verifier"]
                assert form["client_secret"] == "s3cret-value"
                assert form["redirect_uri"].endswith("/api/integrations/microsoft/callback")
                return httpx.Response(
                    200,
                    json={
                        "access_token": "at-1",
                        "refresh_token": "rt-1",
                        "expires_in": 3600,
                        "scope": GRANTED,
                        "id_token": _jwt(
                            {
                                "tid": TENANT,
                                "oid": "oid-boss",
                                "name": "Boss One",
                                "preferred_username": "boss@maju.example.com",
                            }
                        ),  # fmt: skip
                    },
                )
            if grant == "refresh_token":
                if self.refresh_fails:
                    return httpx.Response(
                        400,
                        json={
                            "error": "invalid_grant",
                            "error_description": "AADSTS700082: The refresh token has expired.",
                        },
                    )
                self.refreshes += 1
                n = self.refreshes + 1
                return httpx.Response(
                    200,
                    json={
                        "access_token": f"at-{n}",
                        "refresh_token": f"rt-{n}",
                        "expires_in": 3600,
                        "scope": GRANTED,
                    },
                )
            if grant == "client_credentials":
                assert TENANT in path and form["scope"] == "https://graph.microsoft.com/.default"
                return httpx.Response(200, json={"access_token": "app-at", "expires_in": 3600})
        assert r.url.host == "graph.microsoft.com", r.url
        assert r.headers["authorization"].startswith("Bearer ")
        assert 'IdType="ImmutableId"' in r.headers.get("prefer", "")
        if self.throttle_left:
            self.throttle_left -= 1
            return httpx.Response(429, headers={"Retry-After": "2"})
        p = path.removeprefix("/v1.0/")
        if p == "me":
            return httpx.Response(
                200,
                json={
                    "id": "oid-boss",
                    "displayName": "Boss One",
                    "mail": "Boss@Maju.example.com",
                    "userPrincipalName": "boss@maju.example.com",
                },
            )
        if p == "subscriptions" and r.method == "POST":
            body = json.loads(r.content)
            assert body["notificationUrl"].startswith("https://")
            assert body["lifecycleNotificationUrl"] == body["notificationUrl"]
            assert body["changeType"] == "created" and body["clientState"]
            sid = f"sub-{len(self.subs) + 1}"
            self.subs[sid] = body
            return httpx.Response(
                201, json={"id": sid, "expirationDateTime": body["expirationDateTime"]}
            )
        if p.startswith("subscriptions/") and r.method == "PATCH":
            sid = p.split("/")[1]
            self.renewed.append(sid)
            exp = json.loads(r.content)["expirationDateTime"]
            return httpx.Response(200, json={"id": sid, "expirationDateTime": exp})
        if p.startswith("subscriptions/") and r.method == "DELETE":
            self.deleted.append(p.split("/")[1])
            return httpx.Response(204)
        for root in self.inbox:
            if p == f"{root}/mailFolders/inbox/messages/delta":
                if root in self.forbidden:
                    return httpx.Response(403, json={"error": {"code": "ErrorAccessDenied"}})
                start = int(q.get("$skiptoken") or q.get("$deltatoken") or 0)
                return self._page(root, start, q)
            if p == f"{root}/mailFolders/inbox":
                if root in self.forbidden:
                    return httpx.Response(
                        403,
                        json={"error": {"code": "ErrorAccessDenied",
                                        "message": "Access is denied."}},
                    )  # fmt: skip
                return httpx.Response(200, json={"id": "inbox-id"})
        return httpx.Response(404, json={"error": {"code": "NotFound", "message": p}})


@pytest.fixture
def ms(monkeypatch):
    fake = FakeMicrosoft()
    fake.kicks = 0
    http.transport = httpx.MockTransport(fake.handler)

    async def no_wait(_s):
        return None

    async def kick():
        fake.kicks += 1
        return True

    async def no_features(item_id):  # the mail features have their own tests
        fake.processed.append(item_id)
        return "skipped"

    async def no_housekeeping(at=None):
        return {}

    fake.processed = []
    monkeypatch.setattr(http, "sleep", no_wait)
    monkeypatch.setattr(sync, "kick", kick)
    monkeypatch.setattr(features, "process", no_features)
    monkeypatch.setattr(features, "housekeeping", no_housekeeping)
    yield fake
    http.transport = None


# ---------------------------------------------------------------- helpers


async def configure(c, tenant: str = "organizations", **headers) -> httpx.Response:
    return await c.put(
        "/api/integrations/microsoft",
        json={"client_id": CLIENT_ID, "client_secret": "s3cret-value", "tenant": tenant},
        headers={**csrf(c), **headers},
    )


async def connect(c, *, public: bool = True) -> httpx.Response:
    """connect -> Microsoft -> our callback, in the same session."""
    extra = PUBLIC if public else {}
    r = await c.post("/api/integrations/microsoft/connect", json={}, headers={**csrf(c), **extra})
    assert r.status_code == 200, r.text
    state = parse_qs(urlparse(r.json()["url"]).query)["state"][0]
    return await c.get(
        "/api/integrations/microsoft/callback", params={"state": state, "code": "good-code"}
    )


def ms_query(r: httpx.Response) -> dict:
    assert r.status_code == 303, r.text
    u = urlparse(r.headers["location"])
    return {"path": u.path, **{k: v[0] for k, v in parse_qs(u.query).items()}}


async def user_id(email: str) -> tuple[str, str]:
    from agentic.models import Membership

    async with SessionLocal() as db:
        u = await db.scalar(select(User).where(User.email == email))
        m = await db.scalar(select(Membership).where(Membership.user_id == u.id))
        return u.id, m.workspace_id


async def make_agent(o: dict, ws_id: str, owner_id: str | None, **kind) -> Agent:
    async with SessionLocal() as db:
        a = Agent(
            workspace_id=ws_id,
            branch_id=o["branch"]["id"],
            slug=f"a-{(owner_id or 'team')[-6:]}-{len(kind)}-{datetime.now().timestamp()}",
            name=kind.pop("name", "Mail Agent"),
            role="Agent",
            owner_user_id=owner_id,
            tools={},
            **kind,
        )
        db.add(a)
        await db.commit()
        await db.refresh(a)
        return a


async def my_account(email: str = "owner@example.com") -> MicrosoftAccount:
    uid, _ = await user_id(email)
    async with SessionLocal() as db:
        return await db.scalar(select(MicrosoftAccount).where(MicrosoftAccount.user_id == uid))


async def count(model, *where) -> int:
    async with SessionLocal() as db:
        return await db.scalar(select(func.count()).select_from(model).where(*where)) or 0


async def mail_events() -> list[Event]:
    async with SessionLocal() as db:
        return list((await db.scalars(select(Event).where(Event.type == "mail.new"))).all())


async def pending() -> set[str]:
    return set(await valkey().smembers(sync.PENDING))


# ---------------------------------------------------------------- the app config


async def test_config_saved_secret_never_returned_and_audited(client, llm, temporal, ms):
    o = await office(client)
    r = await client.get("/api/integrations/microsoft")
    body = r.json()
    assert body["configured"] is False and body["adminconsent_url"] is None
    assert body["can_configure"] is True and body["webhooks_available"] is False
    r = await client.put(
        "/api/integrations/microsoft",
        json={"client_id": "not-a-guid-not-a-guid-not-a-guid-xx", "client_secret": "s3cret-value"},
        headers=csrf(client),
    )
    assert r.status_code == 422 and r.json()["code"] == "bad_client_id"
    r = await client.put(
        "/api/integrations/microsoft",
        json={"client_id": CLIENT_ID, "tenant": "organizations"},
        headers=csrf(client),
    )
    assert r.status_code == 422 and r.json()["code"] == "secret_required"
    r = await configure(client, **PUBLIC)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "s3cret-value" not in r.text and "client_secret" not in body
    assert body["configured"] is True and body["tenant"] == "organizations"
    assert body["client_id_hint"] == "…5555"
    assert body["redirect_uri"] == "https://agentic.example.com/api/integrations/microsoft/callback"
    assert body["notify_url"] == "https://agentic.example.com/api/integrations/microsoft/notify"
    assert body["webhooks_available"] is True
    assert body["adminconsent_url"].startswith(
        "https://login.microsoftonline.com/organizations/v2.0/adminconsent?"
    )
    assert body["shared_enabled"] is False  # multi-tenant: needs admin consent first
    # The secret is write-only: a later save without one keeps it.
    r = await client.put(
        "/api/integrations/microsoft",
        json={"client_id": CLIENT_ID, "tenant": TENANT},
        headers=csrf(client),
    )
    assert r.status_code == 200 and r.json()["tenant"] == TENANT
    assert r.json()["shared_enabled"] is True  # a specific tenant works app-only directly
    assert "s3cret-value" not in (await client.get("/api/integrations/microsoft")).text
    async with SessionLocal() as db:
        rows = (
            await db.scalars(select(AuditLog).where(AuditLog.action == "integration.updated"))
        ).all()
        assert len(rows) == 2 and all("s3cret" not in json.dumps(a.after) for a in rows)
    # Only channels.manage may change it.
    staff = await as_role(client, "aina@example.com", "staff", branch_id=o["branch"]["id"])
    try:
        assert (await configure(staff)).status_code == 403
        r = await staff.get("/api/integrations/microsoft")
        assert r.status_code == 200 and r.json()["can_configure"] is False
    finally:
        await staff.aclose()


# ---------------------------------------------------------------- personal Outlook


async def test_connect_is_bound_to_the_starting_session(client, llm, temporal, ms):
    o = await office(client)
    await configure(client)
    r = await client.post("/api/integrations/microsoft/connect", json={}, headers=csrf(client))
    url = r.json()["url"]
    q = parse_qs(urlparse(url).query)
    assert url.startswith("https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize")
    assert q["code_challenge_method"] == ["S256"] and q["client_id"] == [CLIENT_ID]
    assert "offline_access" in q["scope"][0] and "Mail.ReadWrite" in q["scope"][0]
    state = q["state"][0]
    # A colleague's browser (another signed-in person) cannot finish it.
    admin = await as_role(client, "admin2@example.com", "admin", branch_id=o["branch"]["id"])
    try:
        r = await admin.get(
            "/api/integrations/microsoft/callback", params={"state": state, "code": "good-code"}
        )
        got = ms_query(r)
        assert got["ms"] == "error" and "someone else" in got["msg"]
    finally:
        await admin.aclose()
    # Not signed in at all: refused too.
    anon = httpx.AsyncClient(transport=client._transport, base_url="http://test")
    try:
        r = await anon.get(
            "/api/integrations/microsoft/callback", params={"state": "x", "code": "good-code"}
        )
        assert ms_query(r)["ms"] == "error"
    finally:
        await anon.aclose()
    assert await count(MicrosoftAccount) == 0
    # The person who started it, in their own session.
    got = ms_query(await connect(client))
    assert got == {"path": "/assistants", "ms": "connected", "msg": "boss@maju.example.com"}
    acct = await my_account()
    assert acct.status == "connected" and acct.tenant_id == TENANT
    assert acct.ms_user_id == "oid-boss" and acct.display_name == "Boss One"
    assert crypto.decrypt(acct.token_enc, acct.aad) == "rt-1"
    assert await valkey().get(f"mstok:{acct.id}") == "at-1"
    assert {f"resub|personal|{acct.id}", f"sync|personal|{acct.id}"} <= await pending()
    assert ms.kicks == 1
    r = await client.get("/api/integrations/microsoft/account")
    assert r.json() | {"last_sync_at": None} == {
        "connected": True,
        "email": "boss@maju.example.com",
        "display_name": "Boss One",
        "status": "connected",
        "mail_ok": True,
        "calendar_ok": True,
        "last_sync_at": None,
        "webhooks": "polling",
        "last_error": None,
    }
    # The callback was cancelled at Microsoft.
    r = await client.get("/api/integrations/microsoft/callback", params={"error": "access_denied"})
    assert ms_query(r)["ms"] == "error"


async def test_who_may_connect(client, llm, temporal, ms):
    o = await office(client)
    await configure(client)
    staff = await as_role(
        client, "aina@example.com", "staff", branch_id=o["branch"]["id"],
        department_id=o["depts"]["Finance"],
    )  # fmt: skip
    try:
        r = await staff.post(
            "/api/integrations/microsoft/connect", json={}, headers={**csrf(staff), "x-lang": "ms"}
        )
        assert r.status_code == 403 and r.json()["code"] == "no_personal_ai"
        assert r.json()["message"].startswith("Menyambung Outlook")
        uid, ws_id = await user_id("aina@example.com")
        await make_agent(o, ws_id, uid, is_twin=True)
        got = ms_query(await connect(staff))
        assert got["ms"] == "connected" and got["path"] == "/my-worker"  # where their twin is
    finally:
        await staff.aclose()
    viewer = await as_role(client, "v@example.com", "viewer")
    try:
        r = await viewer.post("/api/integrations/microsoft/connect", json={}, headers=csrf(viewer))
        assert r.status_code == 403
    finally:
        await viewer.aclose()
    # assistants.use (owner) may, with no twin.
    r = await client.post("/api/integrations/microsoft/connect", json={}, headers=csrf(client))
    assert r.status_code == 200


async def test_token_refresh_rotates_and_invalid_grant_needs_reconnect(client, llm, temporal, ms):
    await office(client)
    await configure(client)
    await connect(client)
    acct = await my_account()
    await valkey().delete(f"mstok:{acct.id}")  # the access token expired
    async with SessionLocal() as db:
        a = await db.get(MicrosoftAccount, acct.id)
        assert await auth.access_token(db, a) == "at-2"
        assert crypto.decrypt(a.token_enc, a.aad) == "rt-2"  # rotated, stored
        assert await auth.access_token(db, a) == "at-2"  # cached now
        assert ms.refreshes == 1
        ms.refresh_fails = True
        await valkey().delete(f"mstok:{a.id}")
        with pytest.raises(ReconnectNeeded):
            await auth.access_token(db, a)
    acct = await my_account()
    assert acct.status == "reconnect_needed" and "AADSTS700082" in acct.last_error
    r = (await client.get("/api/integrations/microsoft/account")).json()
    assert r["status"] == "reconnect_needed" and r["webhooks"] == "off"
    # Syncing stops: the tick does not touch it.
    before = len(ms.delta_calls())
    await sync.tick()
    assert len(ms.delta_calls()) == before
    # Connecting again brings it back.
    ms.refresh_fails = False
    assert ms_query(await connect(client))["ms"] == "connected"
    assert (await my_account()).status == "connected"


async def test_graph_retries_throttling_then_raises(client, llm, temporal, ms):
    await office(client)
    await configure(client)
    await connect(client)
    async with SessionLocal() as db:
        a = await db.get(MicrosoftAccount, (await my_account()).id)
        g = await graph.for_account(db, a)
        ms.throttle_left = 2
        assert (await g.me())["id"] == "oid-boss"
        ms.throttle_left = 10
        with pytest.raises(Throttled):
            await g.me()
        ms.throttle_left = 0
        with pytest.raises(graph.GraphError):
            await g._get("https://evil.example.com/v1.0/me")


# ---------------------------------------------------------------- admin consent + shared mailboxes


async def test_admin_consent_then_shared_mailbox_rbac_403(client, llm, temporal, ms):
    o = await office(client)
    await configure(client)
    r = await client.post(
        "/api/integrations/microsoft/mailboxes",
        json={"address": "info@example.com", "branch_id": o["branch"]["id"]},
        headers=csrf(client),
    )
    assert r.status_code == 409 and r.json()["code"] == "no_tenant"
    r = await client.get("/api/integrations/microsoft/adminconsent/start", headers=PUBLIC)
    url = r.json()["url"]
    q = parse_qs(urlparse(url).query)
    assert url.startswith("https://login.microsoftonline.com/organizations/v2.0/adminconsent?")
    assert q["scope"] == ["https://graph.microsoft.com/.default"]
    assert q["redirect_uri"] == [
        "https://agentic.example.com/api/integrations/microsoft/adminconsent"
    ]
    state = q["state"][0]
    # Another admin's session cannot finish it.
    admin = await as_role(client, "admin2@example.com", "admin", branch_id=o["branch"]["id"])
    try:
        r = await admin.get(
            "/api/integrations/microsoft/adminconsent",
            params={"state": state, "tenant": TENANT, "admin_consent": "True"},
        )
        assert ms_query(r)["ms_admin"] == "error"
    finally:
        await admin.aclose()
    r = await client.get("/api/integrations/microsoft/adminconsent/start")
    state = parse_qs(urlparse(r.json()["url"]).query)["state"][0]
    r = await client.get(
        "/api/integrations/microsoft/adminconsent",
        params={"state": state, "tenant": TENANT, "admin_consent": "True"},
    )
    assert ms_query(r) == {"path": "/channels", "ms_admin": "ok"}
    body = (await client.get("/api/integrations/microsoft")).json()
    assert body["shared_enabled"] is True and body["admin_tenant"] == TENANT
    # Add a shared mailbox and test access: Exchange RBAC for Applications refuses it.
    r = await client.post(
        "/api/integrations/microsoft/mailboxes",
        json={"address": "Info@Example.com", "branch_id": o["branch"]["id"]},
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    mb = r.json()
    assert mb["address"] == "info@example.com" and mb["branch_name"] == "Maju Sdn Bhd"
    assert mb["rules"] == {
        "create_tasks_for": ["invoice", "customer_request", "tender", "complaint"],
        "save_attachments": True,
        "digest": {"enabled": True, "time": "08:00"},
        "follow_up_hours": 48,
    }
    assert mb["webhooks"] == "polling" and mb["status"] == "active"
    async with SessionLocal() as db:
        assert (await db.get(SharedMailbox, mb["id"])).tenant_id == TENANT
    dup = await client.post(
        "/api/integrations/microsoft/mailboxes",
        json={"address": "info@example.com", "branch_id": o["branch"]["id"]},
        headers=csrf(client),
    )
    assert dup.status_code == 409
    ms.forbidden.add("users/info@example.com")
    r = await client.post(
        f"/api/integrations/microsoft/mailboxes/{mb['id']}/test", json={}, headers=csrf(client)
    )
    assert r.json() == {
        "ok": False,
        "message": "Microsoft refused access to this mailbox. Ask the Microsoft 365 admin to "
        "include it in the app's RBAC for Applications scope.",
    }
    r = await client.post(
        f"/api/integrations/microsoft/mailboxes/{mb['id']}/test",
        json={},
        headers={**csrf(client), "x-lang": "ms"},
    )
    assert r.json()["message"].startswith("Microsoft menolak akses ke peti mel ini")
    rows = (await client.get("/api/integrations/microsoft/mailboxes")).json()
    assert rows[0]["status"] == "error" and "RBAC" in rows[0]["last_error"]
    ms.forbidden.clear()
    r = await client.post(
        f"/api/integrations/microsoft/mailboxes/{mb['id']}/test", json={}, headers=csrf(client)
    )
    assert r.json()["ok"] is True
    # Rules are validated; an assistant (private) cannot be the assigned agent.
    r = await client.patch(
        f"/api/integrations/microsoft/mailboxes/{mb['id']}",
        json={"rules": {"follow_up_hours": 9999}},
        headers=csrf(client),
    )
    assert r.status_code == 422
    uid, ws_id = await user_id("owner@example.com")
    private = await make_agent(o, ws_id, uid, private=True, name="Mine")
    r = await client.patch(
        f"/api/integrations/microsoft/mailboxes/{mb['id']}",
        json={"agent_id": private.id},
        headers=csrf(client),
    )
    assert r.status_code == 422 and r.json()["code"] == "bad_agent"


# ---------------------------------------------------------------- the webhook and sync


async def _connected_with_webhook(client, ms) -> MicrosoftAccount:
    await office(client)
    await configure(client)
    await connect(client)
    acct = await my_account()
    await valkey().delete(sync.PENDING)
    async with SessionLocal() as db:
        a = await db.get(MicrosoftAccount, acct.id)
        sub = await sync.subscribe(db, a, "https://agentic.example.com")
        assert sub is not None and sub.id == "sub-1"
    body = ms.subs["sub-1"]
    assert body["resource"] == "me/mailFolders('inbox')/messages"
    assert (
        body["notificationUrl"] == "https://agentic.example.com/api/integrations/microsoft/notify"
    )
    return acct


async def notify(client, sub_id: str, client_state: str, **extra) -> httpx.Response:
    note = {"subscriptionId": sub_id, "clientState": client_state, **extra}
    if "lifecycleEvent" not in extra:
        note |= {"changeType": "created", "resource": "Users/x/Messages/AAA"}
    return await client.post(
        "/api/integrations/microsoft/notify",
        content=json.dumps({"value": [note]}),
        headers={"content-type": "application/json; charset=utf-8"},
    )


async def test_webhook_validation_handshake_echoes_the_token(client, ms):
    r = await client.post(
        "/api/integrations/microsoft/notify?validationToken=Validation%3A%20Testing%20client",
        content=b"",
        headers={"content-type": "text/plain; charset=utf-8"},
    )
    assert r.status_code == 200 and r.text == "Validation: Testing client"
    assert r.headers["content-type"].startswith("text/plain")


async def test_bad_client_state_is_rejected(client, llm, temporal, ms):
    acct = await _connected_with_webhook(client, ms)
    secret = ms.subs["sub-1"]["clientState"]
    r = await notify(client, "sub-1", "guessed")
    assert r.status_code == 403
    assert await pending() == set() and ms.kicks == 1  # only the connect's
    r = await notify(client, "sub-unknown", "whatever")  # not ours: ignored quietly
    assert r.status_code == 202 and await pending() == set()
    r = await notify(client, "sub-1", secret)
    assert r.status_code == 202
    assert await pending() == {f"sync|personal|{acct.id}"} and ms.kicks == 2
    async with SessionLocal() as db:  # stored hashed only
        sub = await db.get(MailSubscription, "sub-1")
        assert sub.client_state_hash != secret and len(sub.client_state_hash) == 64


async def test_notification_runs_a_delta_into_mail_items_idempotently(client, llm, temporal, ms):
    acct = await _connected_with_webhook(client, ms)
    secret = ms.subs["sub-1"]["clientState"]
    ms.inbox["me"] = [
        _msg("m1a", "Invoice INV-77", 30),
        _msg("m2", "Quote for 3 sites", 10),
        {"id": "gone-1", "@removed": {"reason": "deleted"}},
        _msg("draft-1", "my draft", 1, isDraft=True),
    ]
    assert (await notify(client, "sub-1", secret)).status_code == 202
    counts = await sync.process_pending()
    assert counts == {"ok": 1}
    first = ms.delta_calls()[0]
    assert first["$filter"].startswith("receivedDateTime ge ")  # the last 7 days
    assert "receivedDateTime" in first["$select"] and len(ms.delta_calls()) == 2  # two pages
    async with SessionLocal() as db:
        items = (await db.scalars(select(MailItem).order_by(MailItem.received_at))).all()
        assert [i.graph_message_id for i in items] == ["m1a", "m2"]
        i = items[0]
        assert (i.mailbox_kind, i.account_id, i.status, i.category) == (
            "personal", acct.id, "new", None,
        )  # fmt: skip
        assert i.from_address == "ahmad@client.example.com" and i.has_attachments
        a = await db.get(MicrosoftAccount, acct.id)
        assert a.delta_link.endswith("$deltatoken=4") and a.last_sync_at is not None
    evs = await mail_events()
    assert len(evs) == 2 and all(e.data["viewer_ids"] == [acct.user_id] for e in evs)
    # The same notification again (Graph retries): nothing new.
    assert (await notify(client, "sub-1", secret)).status_code == 202
    await sync.process_pending()
    assert await count(MailItem) == 2 and len(await mail_events()) == 2
    # A full re-run of the round (delta link lost) is still idempotent.
    async with SessionLocal() as db:
        a = await db.get(MicrosoftAccount, acct.id)
        a.delta_link = None
        await db.commit()
    ms.inbox["me"][1]["isRead"] = True
    assert await sync.run_sync("personal", acct.id) == "ok"
    assert await count(MailItem) == 2 and len(await mail_events()) == 2
    assert await count(MailItem, MailItem.is_read.is_(True)) == 1  # read state followed
    # New mail arrives: only it is new.
    ms.inbox["me"].append(_msg("m3", "Tender closing Friday", 0))
    await notify(client, "sub-1", secret)
    await sync.process_pending()
    assert await count(MailItem) == 3 and len(await mail_events()) == 3
    # The live event reaches only the mailbox's owner.
    ev = (await mail_events())[-1]
    assert Scope("all", acct.user_id).event_visible("mail.new", ev.data, set())
    assert not Scope("all", "us_someone_else").event_visible("mail.new", ev.data, set())


async def test_lifecycle_events_renew_and_recreate(client, llm, temporal, ms):
    acct = await _connected_with_webhook(client, ms)
    secret = ms.subs["sub-1"]["clientState"]
    async with SessionLocal() as db:
        sub = await db.get(MailSubscription, "sub-1")
        sub.expires_at = datetime.now(UTC) + timedelta(hours=2)
        await db.commit()
    r = await notify(client, "sub-1", secret, lifecycleEvent="reauthorizationRequired")
    assert r.status_code == 202 and await pending() == {"renew|sub-1"}
    await sync.process_pending()
    assert ms.renewed == ["sub-1"]
    async with SessionLocal() as db:
        sub = await db.get(MailSubscription, "sub-1")
        assert sub.expires_at > datetime.now(UTC) + timedelta(days=6)
    # subscriptionRemoved: a new subscription, then a delta round.
    r = await notify(client, "sub-1", secret, lifecycleEvent="subscriptionRemoved")
    assert await pending() == {f"resub|personal|{acct.id}", f"sync|personal|{acct.id}"}
    await sync.process_pending()
    assert "sub-2" in ms.subs and ms.deleted == ["sub-1"]
    assert await count(MailSubscription) == 1 and len(ms.delta_calls()) >= 1
    # missed: a delta round.
    secret2 = ms.subs["sub-2"]["clientState"]
    await notify(client, "sub-2", secret2, lifecycleEvent="missed")
    assert await pending() == {f"sync|personal|{acct.id}"}
    # The tick renews what expires within a day.
    await sync.process_pending()
    async with SessionLocal() as db:
        sub = await db.get(MailSubscription, "sub-2")
        sub.expires_at = datetime.now(UTC) + timedelta(hours=3)
        await db.commit()
    await sync.tick()
    assert ms.renewed[-1] == "sub-2"
    assert (await client.get("/api/integrations/microsoft/account")).json()["webhooks"] == "live"


async def test_polling_fallback_without_public_https(client, llm, temporal, ms):
    await office(client)
    await configure(client)  # plain http://test: Graph could not call us
    assert (await client.get("/api/integrations/microsoft")).json()["webhooks_available"] is False
    await connect(client, public=False)
    acct = await my_account()
    ms.inbox["me"] = [_msg("p1", "Hello", 3)]
    counts = await sync.tick()  # drains the connect's queue: no webhook, one delta
    assert not ms.subs and counts.get("polling") == 1
    assert await count(MailItem) == 1
    calls = len(ms.delta_calls())
    await sync.tick()  # not due yet (every 3 minutes)
    assert len(ms.delta_calls()) == calls
    async with SessionLocal() as db:
        a = await db.get(MicrosoftAccount, acct.id)
        a.last_sync_at = datetime.now(UTC) - timedelta(minutes=4)
        await db.commit()
    ms.inbox["me"].append(_msg("p2", "Again", 0))
    await sync.tick()
    assert len(ms.delta_calls()) == calls + 1 and await count(MailItem) == 2
    r = (await client.get("/api/integrations/microsoft/account")).json()
    assert r["webhooks"] == "polling"


# ---------------------------------------------------------------- who sees mail activity


async def test_mail_activity_access(client, llm, temporal, ms):
    o = await office(client)
    await configure(client, tenant=TENANT)
    await connect(client)
    owner_acct = await my_account()
    ms.inbox["me"] = [_msg("own1", "Board pack", 3)]
    await sync.run_sync("personal", owner_acct.id)
    br = o["branch"]["id"]
    staff = await as_role(
        client, "aina@example.com", "staff", branch_id=br, department_id=o["depts"]["Finance"]
    )
    other = await as_role(
        client, "zul@example.com", "staff", branch_id=br, department_id=o["depts"]["Finance"]
    )
    bm = await as_role(client, "bm@example.com", "branch_manager", branch_id=br)
    admin = await as_role(client, "admin2@example.com", "admin", branch_id=br)
    op = await as_role(client, "op@example.com", "operator")
    try:
        aina_id, ws_id = await user_id("aina@example.com")
        agent = await make_agent(o, ws_id, aina_id, name="Aina's Agent")
        r = await client.post(
            "/api/integrations/microsoft/mailboxes",
            json={"address": "info@example.com", "branch_id": br, "agent_id": agent.id,
                  "display_name": "Maju Info"},
            headers=csrf(client),
        )  # fmt: skip
        assert r.status_code == 201, r.text
        mb = r.json()
        assert mb["agent_name"] == "Aina's Agent"
        ms.inbox["users/info@example.com"] = [_msg("s1", "Invoice from supplier", 2)]
        assert await sync.run_sync("shared", mb["id"]) == "ok"
        # Personal: the owner sees their own; a colleague (even an admin) never does.
        rows = (await client.get("/api/mail/activity", params={"mailbox": "personal"})).json()
        assert [x["subject"] for x in rows] == ["Board pack"]
        assert rows[0]["mailbox_label"] == "boss@maju.example.com"
        assert (await admin.get("/api/mail/activity", params={"mailbox": "personal"})).json() == []
        r = await admin.get("/api/mail/activity", params={"mailbox": owner_acct.id})
        assert r.status_code == 404
        # Shared: owner/admin, the company's branch manager, the assigned agent's owner.
        for c in (client, admin, bm, staff):
            r = await c.get("/api/mail/activity", params={"mailbox": mb["id"]})
            assert r.status_code == 200, r.text
            assert [x["subject"] for x in r.json()] == ["Invoice from supplier"]
            assert r.json()[0]["mailbox_label"] == "Maju Info"
        for c in (other, op):
            r = await c.get("/api/mail/activity", params={"mailbox": mb["id"]})
            assert r.status_code == 404
        # Managing mailboxes is channels.manage only.
        assert (await bm.get("/api/integrations/microsoft/mailboxes")).status_code == 403
        # The live event about it reaches exactly those people.
        async with SessionLocal() as db:
            box = await db.get(SharedMailbox, mb["id"])
            viewers = set(await access.viewer_ids(db, box))
        everyone = ("owner@example.com", "admin2@example.com", "bm@example.com",
                    "aina@example.com", "zul@example.com", "op@example.com")  # fmt: skip
        ids = {e: (await user_id(e))[0] for e in everyone}
        assert viewers == {ids[e] for e in everyone[:4]}
        # Which AI may use which mailbox.
        async with SessionLocal() as db:
            box = await db.get(SharedMailbox, mb["id"])
            a = await db.get(Agent, agent.id)
            owner_acct = await db.get(MicrosoftAccount, owner_acct.id)
            assert access.ai_may_use_shared(a, box)
            assert not access.ai_may_use_personal(a, owner_acct)
        uid, _ = await user_id("owner@example.com")
        mine = await make_agent(o, ws_id, uid, private=True, name="My Assistant")
        assert access.ai_may_use_personal(mine, owner_acct)
        assert not access.ai_may_use_shared(mine, box)
    finally:
        for c in (staff, other, bm, admin, op):
            await c.aclose()


# ---------------------------------------------------------------- disconnect


async def test_disconnect_deletes_subscription_and_tokens(client, llm, temporal, ms):
    acct = await _connected_with_webhook(client, ms)
    ms.inbox["me"] = [_msg("d1", "Hi", 1)]
    await sync.run_sync("personal", acct.id)
    assert await count(MailItem) == 1
    r = await client.delete(
        "/api/integrations/microsoft/account",
        headers={**csrf(client), "content-type": "application/json"},
    )
    assert r.status_code == 204
    assert ms.deleted == ["sub-1"]
    assert await count(MailSubscription) == 0 and await count(MailItem) == 0
    a = await my_account()
    assert a.status == "disconnected" and a.token_enc == "" and a.delta_link is None
    assert await valkey().get(f"mstok:{a.id}") is None
    r = (await client.get("/api/integrations/microsoft/account")).json()
    assert r["connected"] is False and r["webhooks"] == "off"
    assert await sync.run_sync("personal", a.id) == "skipped"
    # A notification for the deleted subscription is ignored.
    assert (await notify(client, "sub-1", "x")).status_code == 202
    assert await pending() == set()


async def test_shared_mailbox_webhook_pause_and_delete(client, llm, temporal, ms):
    o = await office(client)
    await configure(client, tenant=TENANT, **PUBLIC)
    r = await client.post(
        "/api/integrations/microsoft/mailboxes",
        json={"address": "info@example.com", "branch_id": o["branch"]["id"],
              "rules": {"create_tasks_for": ["invoice"], "digest": {"enabled": False}}},
        headers={**csrf(client), **PUBLIC},
    )  # fmt: skip
    assert r.status_code == 201, r.text
    mb = r.json()
    assert mb["rules"]["create_tasks_for"] == ["invoice"]
    assert mb["rules"]["digest"] == {"enabled": False, "time": "08:00"}
    ms.inbox["users/info@example.com"] = [_msg("s1", "PO 4410", 2), _msg("s2", "Complaint", 1)]
    counts = await sync.process_pending()  # the add queued: subscribe (app-only) + delta
    assert counts == {"ok": 2}
    body = ms.subs["sub-1"]
    assert body["resource"] == "users/info@example.com/mailFolders('inbox')/messages"
    assert await count(MailItem, MailItem.mailbox_id == mb["id"]) == 2
    rows = (await client.get("/api/integrations/microsoft/mailboxes")).json()
    assert rows[0]["webhooks"] == "live" and rows[0]["last_sync_at"]
    # A notification on it runs a delta with the app's token.
    ms.inbox["users/info@example.com"].append(_msg("s3", "Tender", 0))
    assert (await notify(client, "sub-1", body["clientState"])).status_code == 202
    await sync.process_pending()
    assert await count(MailItem, MailItem.mailbox_id == mb["id"]) == 3
    # Paused: its subscription goes and it is not synced.
    r = await client.patch(
        f"/api/integrations/microsoft/mailboxes/{mb['id']}",
        json={"paused": True},
        headers=csrf(client),
    )
    assert r.json()["status"] == "paused" and r.json()["webhooks"] == "off"
    assert ms.deleted == ["sub-1"] and await count(MailSubscription) == 0
    assert await sync.run_sync("shared", mb["id"]) == "skipped"
    # Resumed, then removed: everything about it goes.
    r = await client.patch(
        f"/api/integrations/microsoft/mailboxes/{mb['id']}",
        json={"paused": False},
        headers=csrf(client),
    )
    assert r.json()["status"] == "active"
    await sync.process_pending()
    assert "sub-2" in ms.subs
    r = await client.delete(
        f"/api/integrations/microsoft/mailboxes/{mb['id']}",
        headers={**csrf(client), "content-type": "application/json"},
    )
    assert r.status_code == 204
    assert ms.deleted == ["sub-1", "sub-2"]
    assert await count(SharedMailbox) == 0 and await count(MailItem) == 0
