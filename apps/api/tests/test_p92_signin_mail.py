"""P92: emailed sign-in passwords (first sign-in, forgotten password, the owner's bulk send)
and the system sender. Microsoft is faked (microsoft/http.py transport): nothing real is called.
Synthetic people only."""

import json
import re
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, unquote

import httpx
import pytest
from sqlalchemy import select

from agentic.core.config import settings
from agentic.core.db import SessionLocal
from agentic.core.security import verify_password
from agentic.core.valkey import valkey
from agentic.microsoft import http, sendmail
from agentic.models import AuditLog, Membership, User, Workspace
from agentic.services import signin_mail

from .conftest import csrf, setup_owner

CLIENT_ID = "11111111-2222-3333-4444-555555555555"
TENANT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
SENDER = "noreply@example.com"
PW = "a-long-new-password-2026"
BOX = re.compile(r'text-align:center">([A-Za-z0-9]+)</div>')


class FakeGraph:
    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.answers: list[tuple[int, dict, dict]] = []
        self.tokens = 0

    def handler(self, r: httpx.Request) -> httpx.Response:
        if r.url.host == "login.microsoftonline.com":
            form = {k: v[0] for k, v in parse_qs(r.content.decode()).items()}
            assert form["grant_type"] == "client_credentials"
            assert form["scope"] == "https://graph.microsoft.com/.default"
            self.tokens += 1
            return httpx.Response(200, json={"access_token": f"app-{self.tokens}", "expires_in": 3600})
        assert r.url.host == "graph.microsoft.com", r.url
        assert r.url.path.endswith("/sendMail"), r.url.path
        if self.answers:
            status, headers, body = self.answers.pop(0)
            return httpx.Response(status, headers=headers, json=body)
        self.sent.append({"path": unquote(r.url.path), "body": json.loads(r.content)})
        return httpx.Response(202)

    def to(self, email: str) -> list[dict]:
        return [
            s
            for s in self.sent
            if s["body"]["message"]["toRecipients"][0]["emailAddress"]["address"] == email
        ]

    def code_for(self, email: str) -> str:
        html = self.to(email)[-1]["body"]["message"]["body"]["content"]
        m = BOX.search(html)
        assert m, html
        return m.group(1)


@pytest.fixture
def graph(monkeypatch):
    fake = FakeGraph()
    http.transport = httpx.MockTransport(fake.handler)
    monkeypatch.setattr(settings, "ms_client_id", CLIENT_ID)
    monkeypatch.setattr(settings, "ms_client_secret", "s3cret-value")
    monkeypatch.setattr(settings, "ms_tenant", TENANT)
    waits: list[float] = []

    async def no_wait(s: float) -> None:
        waits.append(s)

    monkeypatch.setattr(signin_mail, "sleep", no_wait)
    fake.waits = waits
    yield fake
    http.transport = None


def anon(client: httpx.AsyncClient) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=client._transport, base_url="http://test")


async def sender_on(owner: httpx.AsyncClient, **over) -> dict:
    body = {
        "enabled": True,
        "address": SENDER,
        "from_name": "No Reply",
        "first_login": True,
        "forgot_password": True,
        **over,
    }
    r = await owner.put("/api/settings/system-mail", json=body, headers=csrf(owner))
    assert r.status_code == 200, r.text
    return r.json()


async def add(owner: httpx.AsyncClient, email: str, role: str = "viewer") -> dict:
    r = await owner.post(
        "/api/members",
        json={"email": email, "name": email.split("@")[0].title(), "role": role},
        headers=csrf(owner),
    )
    assert r.status_code == 201, r.text
    return r.json()


async def login(c: httpx.AsyncClient, email: str, password: str) -> httpx.Response:
    r = await c.post("/api/auth/login", json={"email": email, "password": password})
    await signin_mail.drain()
    return r


async def user(email: str) -> User:
    async with SessionLocal() as db:
        u = await db.scalar(select(User).where(User.email == email))
        assert u is not None
        return u


async def set_user(who: str, **values) -> None:
    async with SessionLocal() as db:
        u = await db.scalar(select(User).where(User.email == who))
        for k, v in values.items():
            setattr(u, k, v)
        await db.commit()


async def audit_rows() -> list[AuditLog]:
    async with SessionLocal() as db:
        return list((await db.scalars(select(AuditLog).order_by(AuditLog.id))).all())


async def signed_in_member(client, owner, email: str) -> httpx.AsyncClient:
    temp = (await add(owner, email))["temp_password"]
    c = anon(client)
    assert (await login(c, email, temp)).status_code == 200
    r = await c.post(
        "/api/auth/change-password",
        json={"current_password": temp, "new_password": PW},
        headers=csrf(c),
    )
    assert r.status_code == 200, r.text
    return c


# ---------------------------------------------------------------- first sign-in


async def test_first_failed_sign_in_emails_a_code_that_works_once(client, graph):
    await setup_owner(client)
    await sender_on(client)
    await add(client, "new.person@example.com")
    before = (await user("new.person@example.com")).password_hash

    c = anon(client)
    r = await login(c, "new.person@example.com", "what-was-it-again")
    assert r.status_code == 401 and r.json()["code"] == "bad_credentials"
    assert len(graph.to("new.person@example.com")) == 1
    mail = graph.to("new.person@example.com")[0]
    assert mail["path"] == f"/v1.0/users/{SENDER}/sendMail"
    body = mail["body"]
    assert body["saveToSentItems"] is False
    msg = body["message"]
    assert msg["subject"] == signin_mail.SUBJECT
    assert msg["from"]["emailAddress"] == {"address": SENDER, "name": "No Reply"}
    assert msg["replyTo"][0]["emailAddress"]["address"] == SENDER
    html = msg["body"]["content"]
    assert msg["body"]["contentType"] == "HTML"
    assert "<img" not in html and "Do not reply" in html and "Jangan balas" in html
    assert "24 hours" in html and "Sign in with Microsoft" in html
    assert "http://localhost:8500/login" in html
    code = graph.code_for("new.person@example.com")
    assert len(code) == 14

    # The real password never changed: the code lives in its own columns, hashed.
    u = await user("new.person@example.com")
    assert u.password_hash == before
    assert u.signin_code_hash and code not in u.signin_code_hash
    assert verify_password(u.signin_code_hash, code)

    # Another wrong try within 10 minutes: no second email.
    assert (await login(c, "new.person@example.com", "still-wrong-1")).status_code == 401
    assert len(graph.to("new.person@example.com")) == 1

    # The code signs in once, and asks for a new password.
    r = await login(c, "new.person@example.com", code)
    assert r.status_code == 200, r.text
    assert r.json()["user"]["must_change_password"] is True
    u = await user("new.person@example.com")
    assert u.signin_code_hash is None and u.signin_code_expires_at is None
    assert u.password_hash == before
    assert (await login(anon(client), "new.person@example.com", code)).status_code == 401

    # The forced change takes the emailed password as the temporary one.
    r = await c.post(
        "/api/auth/change-password",
        json={"current_password": code, "new_password": PW},
        headers=csrf(c),
    )
    assert r.status_code == 200, r.text
    assert (await login(anon(client), "new.person@example.com", PW)).status_code == 200

    # Audited, never with the code.
    rows = await audit_rows()
    sent = [a for a in rows if a.action == "auth.signin_email_sent"]
    assert len(sent) == 1 and sent[0].after == {"to": "new.person@example.com", "via": "first_sign_in"}
    dump = json.dumps([[a.action, a.before, a.after, a.note] for a in rows], default=str)
    assert code not in dump


async def test_a_code_expires(client, graph):
    await setup_owner(client)
    await sender_on(client)
    await add(client, "late.one@example.com")
    c = anon(client)
    await login(c, "late.one@example.com", "nope-nope-nope")
    code = graph.code_for("late.one@example.com")
    await set_user("late.one@example.com", signin_code_expires_at=datetime.now(UTC) - timedelta(seconds=1))
    assert (await login(c, "late.one@example.com", code)).status_code == 401


async def test_only_never_signed_in_active_members_get_one(client, graph):
    await setup_owner(client)
    await sender_on(client)
    await signed_in_member(client, client, "regular@example.com")
    await add(client, "off.person@example.com")
    await set_user("off.person@example.com", is_active=False)
    async with SessionLocal() as db:  # an account with no workspace
        db.add(User(email="nowhere@example.com", name="Nowhere", password_hash="x"))
        await db.commit()
    c = anon(client)
    for email in ("regular@example.com", "off.person@example.com", "nowhere@example.com"):
        assert (await login(c, email, "wrong-password-x")).status_code == 401
        r = await c.post("/api/auth/email-signin", json={"email": email})
        assert r.status_code == 202
    await signin_mail.drain()
    # The member who signed in before asked for one (forgot password): only they get it.
    assert [s["body"]["message"]["toRecipients"][0]["emailAddress"]["address"] for s in graph.sent] == [
        "regular@example.com"
    ]


async def test_switches_and_no_sender_mean_no_email(client, graph):
    await setup_owner(client)
    await add(client, "first.timer@example.com")
    c = anon(client)
    # No sender set up: nothing is sent.
    await login(c, "first.timer@example.com", "wrong-one-here")
    assert graph.sent == []
    # First-sign-in emails off: a failed sign-in sends nothing; asking still works (forgot on).
    await sender_on(client, first_login=False)
    await valkey().flushdb()
    await login(c, "first.timer@example.com", "wrong-two-here")
    assert graph.sent == []
    await c.post("/api/auth/email-signin", json={"email": "first.timer@example.com"})
    await signin_mail.drain()
    assert len(graph.sent) == 1
    # Forgot-password emails off: someone who signed in before gets nothing when asking.
    await sender_on(client, forgot_password=False)
    await signed_in_member(client, client, "known@example.com")
    await c.post("/api/auth/email-signin", json={"email": "known@example.com"})
    await signin_mail.drain()
    assert graph.to("known@example.com") == []


async def test_the_answer_is_the_same_whether_the_email_exists(client, graph):
    await setup_owner(client)
    await sender_on(client)
    await add(client, "exists@example.com")
    c = anon(client)
    a = await login(c, "exists@example.com", "wrong-password-1")
    b = await login(c, "ghost@example.com", "wrong-password-1")
    assert (a.status_code, a.json()) == (b.status_code, b.json())
    a = await c.post("/api/auth/email-signin", json={"email": "exists@example.com"})
    b = await c.post("/api/auth/email-signin", json={"email": "ghost@example.com"})
    assert (a.status_code, a.json()) == (b.status_code, b.json()) == (202, {"ok": True})
    await signin_mail.drain()
    assert graph.to("ghost@example.com") == []
    sso = (await c.get("/api/auth/sso")).json()
    assert sso["email_signin"] is True


async def test_a_strangers_request_never_changes_the_password(client, graph):
    await setup_owner(client)
    await sender_on(client)
    await signed_in_member(client, client, "careful@example.com")
    before = (await user("careful@example.com")).password_hash
    c = anon(client)
    await c.post("/api/auth/email-signin", json={"email": "careful@example.com"})
    await signin_mail.drain()
    assert len(graph.to("careful@example.com")) == 1
    u = await user("careful@example.com")
    assert u.password_hash == before and u.signin_code_hash
    # Their own password still works while a code is waiting, with no forced change.
    r = await login(c, "careful@example.com", PW)
    assert r.status_code == 200 and r.json()["user"]["must_change_password"] is False


async def test_rate_limits(client, graph, monkeypatch):
    await setup_owner(client)
    await sender_on(client)
    await add(client, "busy@example.com")
    c = anon(client)
    for _ in range(3):
        await c.post("/api/auth/email-signin", json={"email": "busy@example.com"})
    await signin_mail.drain()
    assert len(graph.to("busy@example.com")) == 1  # one per 5 minutes
    for _ in range(8):  # the 5-minute gap passes each time: still 5 a day at most
        await valkey().delete("signin_mail:gap:busy@example.com")
        await c.post("/api/auth/email-signin", json={"email": "busy@example.com"})
        await signin_mail.drain()
    assert len(graph.to("busy@example.com")) == signin_mail.EMAIL_PER_DAY
    # Per IP: 20 an hour (here 2) whatever the emails.
    monkeypatch.setattr(signin_mail, "IP_PER_HOUR", 2)
    await valkey().flushdb()
    graph.sent.clear()
    for n in range(3):
        await add(client, f"guard{n}@example.com")
    for n in range(3):
        await c.post("/api/auth/email-signin", json={"email": f"guard{n}@example.com"})
    await signin_mail.drain()
    assert len(graph.sent) == 2


# ---------------------------------------------------------------- the owner's settings


async def test_settings_are_the_owners_and_checked(client, graph):
    await setup_owner(client)
    admin = await signed_in_member(client, client, "admin.one@example.com")
    async with SessionLocal() as db:
        u = await db.scalar(select(User).where(User.email == "admin.one@example.com"))
        m = await db.scalar(select(Membership).where(Membership.user_id == u.id))
        m.role = "admin"
        await db.commit()
    assert (await admin.get("/api/settings/system-mail")).status_code == 403
    r = await admin.put("/api/settings/system-mail", json={"enabled": True, "address": SENDER}, headers=csrf(admin))
    assert r.status_code == 403
    assert (await admin.post("/api/settings/system-mail/test", json={}, headers=csrf(admin))).status_code == 403

    r = await client.get("/api/settings/system-mail")
    assert r.status_code == 200
    got = r.json()
    assert got["enabled"] is False and got["from_name"] == "No Reply"
    assert got["first_login"] is True and got["forgot_password"] is True
    assert got["microsoft_app"] is True and got["problem"]

    for bad in (
        {"enabled": True, "address": ""},
        {"enabled": True, "address": "not an address"},
        {"enabled": False, "address": "x@y"},
    ):
        r = await client.put("/api/settings/system-mail", json=bad, headers=csrf(client))
        assert r.status_code == 422 and r.json()["code"] == "bad_address", bad
    r = await client.put(
        "/api/settings/system-mail",
        json={"enabled": True, "address": SENDER, "from_name": "<script>"},
        headers=csrf(client),
    )
    assert r.status_code == 422 and r.json()["code"] == "bad_name"

    got = await sender_on(client, address="  NoReply@Example.com ", from_name="  No   Reply  ")
    assert got["address"] == SENDER and got["from_name"] == "No Reply" and got["problem"] is None
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace))
        assert ws.settings["system_mail"]["address"] == SENDER
    assert any(a.action == "settings.system_mail_changed" for a in await audit_rows())


async def test_the_test_email_and_microsofts_errors_in_plain_words(client, graph):
    await setup_owner(client)
    r = await client.post("/api/settings/system-mail/test", json={}, headers=csrf(client))
    assert r.status_code == 409 and r.json()["code"] == "no_address"
    await sender_on(client)
    r = await client.post("/api/settings/system-mail/test", json={}, headers=csrf(client))
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "to": "owner@example.com"}
    msg = graph.to("owner@example.com")[0]["body"]["message"]
    assert msg["subject"] == signin_mail.TEST_SUBJECT
    assert not BOX.search(msg["body"]["content"])  # no password in a test

    cases = [
        (403, {}, {"error": {"code": "ErrorAccessDenied", "message": "Access is denied."}}, "Mail.Send application permission"),
        (429, {"retry-after": "30"}, {"error": {"code": "TooManyRequests"}}, "limiting how fast"),
        (503, {}, {"error": {"code": "ServiceUnavailable"}}, "having trouble"),
        (500, {}, {}, "having trouble"),
        (404, {}, {"error": {"code": "ErrorInvalidUser"}}, "has no mailbox"),
    ]
    for status, headers, body, words in cases:
        graph.answers.append((status, headers, body))
        r = await client.post("/api/settings/system-mail/test", json={}, headers=csrf(client))
        assert r.status_code == 502 and words in r.json()["message"], (status, r.text)
        await valkey().delete(f"signin_mail:test:{(await client.get('/api/auth/me')).json()['workspace']['id']}")

    # In Malay too.
    graph.answers.append((403, {}, {}))
    r = await client.post("/api/settings/system-mail/test", json={}, headers={**csrf(client), "x-lang": "ms"})
    assert "Mail.Send" in r.json()["message"] and "kebenaran" in r.json()["message"]


async def test_send_maps_token_and_app_problems():
    async with SessionLocal() as db:
        ws = Workspace(name="W", slug="w")
        db.add(ws)
        await db.commit()
        with pytest.raises(sendmail.SendError) as e:
            await sendmail.send(
                db, ws.id, sender=SENDER, from_name="No Reply", to="a@example.com", to_name="A", subject="s", html="h"
            )
        assert e.value.kind == "not_configured"


async def test_a_stale_token_is_renewed_once_then_explained(client, graph):
    await setup_owner(client)
    await sender_on(client)
    graph.answers += [(401, {}, {}), (401, {}, {})]
    r = await client.post("/api/settings/system-mail/test", json={}, headers=csrf(client))
    assert r.status_code == 502 and "client secret" in r.json()["message"]
    assert graph.tokens == 2
    # The sender address's domain is the tenant when the app has none of its own.
    assert sendmail.tenant_for(type("C", (), {"app_tenant": lambda self: None})(), SENDER) == "example.com"


# ---------------------------------------------------------------- the Members page


async def test_members_page_one_person_and_permissions(client, graph):
    await setup_owner(client)
    await add(client, "new.guard@example.com")
    viewer = await signed_in_member(client, client, "viewer.one@example.com")
    page = (await client.get("/api/members?page=1")).json()
    rows = {m["email"]: m for m in page["items"]}
    assert rows["new.guard@example.com"]["last_login_at"] is None
    assert rows["viewer.one@example.com"]["last_login_at"] is not None

    uid = rows["new.guard@example.com"]["user_id"]
    # No sender yet: a plain reason, and the page knows.
    r = await client.post(f"/api/members/{uid}/email-signin", json={}, headers=csrf(client))
    assert r.status_code == 409 and r.json()["code"] == "sender_off"
    info = (await client.get("/api/members/signin-emails")).json()
    assert info["sender_ready"] is False and "Settings > Sign-in emails" in info["problem"]
    assert info["never_signed_in"] == 1 and info["job"] is None

    await sender_on(client)
    r = await client.post(f"/api/members/{uid}/email-signin", json={}, headers=csrf(client))
    assert r.status_code == 200 and r.json() == {"ok": True, "to": "new.guard@example.com"}
    assert len(graph.to("new.guard@example.com")) == 1
    r = await client.post(f"/api/members/{uid}/email-signin", json={}, headers=csrf(client))
    assert r.status_code == 429 and r.json()["code"] == "sent_recently"
    sent = [a for a in await audit_rows() if a.action == "auth.signin_email_sent"]
    assert sent[-1].actor.startswith("user:") and sent[-1].after["via"] == "admin"

    # Only people who manage members.
    assert (await viewer.get("/api/members/signin-emails")).status_code == 403
    assert (await viewer.post(f"/api/members/{uid}/email-signin", json={}, headers=csrf(viewer))).status_code == 403
    assert (await viewer.post("/api/members/signin-emails/bulk", json={}, headers=csrf(viewer))).status_code == 403

    await set_user("new.guard@example.com", is_active=False)
    await valkey().flushdb()
    r = await client.post(f"/api/members/{uid}/email-signin", json={}, headers=csrf(client))
    assert r.status_code == 409 and r.json()["code"] == "account_disabled"
    assert (await client.post("/api/members/us_nobody/email-signin", json={}, headers=csrf(client))).status_code == 404


async def test_bulk_send_counts_waits_and_throttling(client, graph):
    await setup_owner(client)
    await sender_on(client)
    for email in ("a.one@example.com", "b.two@example.com", "c.off@example.com", "d.noemail@example.com"):
        await add(client, email)
    await signed_in_member(client, client, "e.known@example.com")
    await set_user("c.off@example.com", is_active=False)
    await set_user("d.noemail@example.com", email="d.noemail@localhost")
    info = (await client.get("/api/members/signin-emails")).json()
    assert info["sender_ready"] is True and info["never_signed_in"] == 3  # the switched-off one aside

    graph.answers.append((429, {"retry-after": "7"}, {"error": {"code": "TooManyRequests"}}))
    r = await client.post("/api/members/signin-emails/bulk", json={}, headers=csrf(client))
    assert r.status_code == 202, r.text
    assert r.json()["state"] == "running" and r.json()["total"] == 4
    again = await client.post("/api/members/signin-emails/bulk", json={}, headers=csrf(client))
    assert again.status_code == 409 and again.json()["code"] == "running"
    await signin_mail.drain()

    job = (await client.get("/api/members/signin-emails")).json()["job"]
    assert job["state"] == "done"
    assert (job["sent"], job["failed"], job["skipped_disabled"], job["skipped_no_email"]) == (2, 0, 1, 1)
    assert job["skipped"] == 2
    # The first was throttled once (waited Retry-After), the next one waited the 2-second gap.
    assert graph.waits == [7.0, signin_mail.BULK_GAP_SECONDS]
    assert len(graph.to("a.one@example.com")) == 1 and len(graph.to("b.two@example.com")) == 1
    assert graph.to("e.known@example.com") == []
    codes = [graph.code_for("a.one@example.com"), graph.code_for("b.two@example.com")]
    dump = json.dumps([[a.action, a.before, a.after, a.note] for a in await audit_rows()], default=str)
    assert not any(c in dump for c in codes)
    assert "auth.signin_emails_bulk" in dump

    # A second round skips who was emailed in the last 5 minutes.
    r = await client.post("/api/members/signin-emails/bulk", json={}, headers=csrf(client))
    await signin_mail.drain()
    job = (await client.get("/api/members/signin-emails")).json()["job"]
    assert job["sent"] == 0 and job["skipped_recent"] == 2


async def test_bulk_send_stops_when_microsoft_refuses(client, graph):
    await setup_owner(client)
    await sender_on(client)
    for n in range(3):
        await add(client, f"p{n}@example.com")
    graph.answers.append((403, {}, {"error": {"code": "ErrorAccessDenied"}}))
    await client.post("/api/members/signin-emails/bulk", json={}, headers=csrf(client))
    await signin_mail.drain()
    job = (await client.get("/api/members/signin-emails", headers={"x-lang": "en"})).json()["job"]
    assert job["state"] == "stopped" and job["failed"] == 1 and job["sent"] == 0
    assert "Mail.Send application permission" in job["error"]
    assert graph.sent == []
    async with SessionLocal() as db:  # the code of the failed email was taken back
        assert not (await db.scalars(select(User).where(User.signin_code_hash.is_not(None)))).all()


async def test_an_interrupted_bulk_send_says_so(client, graph):
    await setup_owner(client)
    await sender_on(client)
    ws = (await client.get("/api/auth/me")).json()["workspace"]["id"]
    await valkey().set(f"signin_bulk:{ws}", json.dumps({"state": "running", "total": 9, "sent": 3}))
    job = (await client.get("/api/members/signin-emails")).json()["job"]
    assert job["state"] == "stopped" and "server restarted" in job["error"]
