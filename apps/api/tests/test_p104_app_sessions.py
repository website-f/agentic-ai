"""P104: the phone app's sign-in (apps/mobile). Its screens run from the phone, so it signs in
with a bearer token (X-Agentic-Client: app) instead of cookies. Browsers keep cookies + CSRF.
Synthetic people only."""

from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import update

from agentic.core import totp
from agentic.core.db import SessionLocal
from agentic.models import AuthSession
from agentic.services import signin_mail

from .conftest import csrf, setup_owner
from .test_p57_two_factor import _turn_on, clock  # noqa: F401  (the clock fixture)
from .test_p92_signin_mail import add, graph, sender_on  # noqa: F401  (the graph fixture)

OWNER = "owner@example.com"
PW = "correct-horse-battery"
APP = {"x-agentic-client": "app"}
APP_ORIGIN = "capacitor://localhost"


def anon(client: httpx.AsyncClient) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=client._transport, base_url="http://test")


def bearer(token: str) -> dict[str, str]:
    return {**APP, "authorization": f"Bearer {token}"}


async def app_login(c: httpx.AsyncClient, email: str = OWNER, password: str = PW):
    return await c.post("/api/auth/login", json={"email": email, "password": password}, headers=APP)


async def test_app_sign_in_gives_a_token_not_cookies(client):
    await setup_owner(client)
    app = anon(client)
    r = await app_login(app)
    assert r.status_code == 200, r.text
    token = r.headers.get("x-agentic-session")
    assert token and len(token) >= 32
    assert "set-cookie" not in r.headers and not app.cookies
    assert r.json()["user"]["email"] == OWNER

    # Each call carries the token; no cookie, no CSRF echo needed (a browser never adds it).
    phone = anon(client)
    me = await phone.get("/api/auth/me", headers=bearer(token))
    assert me.status_code == 200 and me.json()["user"]["email"] == OWNER
    saved = await phone.put(
        "/api/me/prefs", json={"locale": {"language": "ms"}}, headers=bearer(token)
    )
    assert saved.status_code == 200, saved.text

    # The browser's sign-in is unchanged: cookies, and no token in the answer.
    browser = anon(client)
    b = await browser.post("/api/auth/login", json={"email": OWNER, "password": PW})
    assert b.status_code == 200 and "x-agentic-session" not in b.headers
    assert browser.cookies.get("agentic_session") and browser.cookies.get("agentic_csrf")

    # Signing out in the app ends that session on the server: the token is refused after.
    out = await phone.post("/api/auth/logout", json={}, headers=bearer(token))
    assert out.status_code == 204
    again = await phone.get("/api/auth/me", headers=bearer(token))
    assert again.status_code == 401 and again.json()["code"] == "session_expired"
    # The browser's own session is a different one and stays.
    assert (await browser.get("/api/auth/me")).status_code == 200


async def test_wrong_missing_and_expired_tokens_are_refused(client):
    await setup_owner(client)
    token = (await app_login(anon(client))).headers["x-agentic-session"]
    c = anon(client)

    wrong = await c.get("/api/auth/me", headers=bearer(token[:-4] + "abcd"))
    assert wrong.status_code == 401 and wrong.json()["code"] == "session_expired"
    empty = await c.get("/api/auth/me", headers={**APP, "authorization": "Bearer "})
    assert empty.status_code == 401 and empty.json()["code"] == "not_authenticated"
    basic = await c.get("/api/auth/me", headers={**APP, "authorization": f"Basic {token}"})
    assert basic.status_code == 401
    # A bearer token counts only from the app: without its header it is not a sign-in.
    plain = await c.get("/api/auth/me", headers={"authorization": f"Bearer {token}"})
    assert plain.status_code == 401 and plain.json()["code"] == "not_authenticated"
    assert (await c.get("/api/auth/me", headers=bearer(token))).status_code == 200

    async with SessionLocal() as db:
        await db.execute(
            update(AuthSession).values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
        )
        await db.commit()
    expired = await c.get("/api/auth/me", headers=bearer(token))
    assert expired.status_code == 401 and expired.json()["code"] == "session_expired"


async def test_browser_csrf_still_applies_with_a_token_alongside(client):
    """A cookie session is always checked for CSRF, even when a bearer token comes too."""
    await setup_owner(client)
    token = (await app_login(anon(client))).headers["x-agentic-session"]
    assert client.cookies.get("agentic_session")
    r = await client.post("/api/auth/logout", json={}, headers=bearer(token))
    assert r.status_code == 403 and r.json()["code"] == "csrf_failed"
    # A form post (not JSON) is refused for the app too.
    form = await anon(client).post(
        "/api/auth/logout", content=b"a=1", headers={**bearer(token), "content-type": "text/plain"}
    )
    assert form.status_code == 415
    ok = await client.post("/api/auth/logout", json={}, headers=csrf(client))
    assert ok.status_code == 204


async def test_cors_only_for_the_app_and_never_with_cookies(client):
    pre = await client.options(
        "/api/auth/me",
        headers={
            "origin": APP_ORIGIN,
            "access-control-request-method": "GET",
            "access-control-request-headers": "authorization,x-agentic-client,x-lang",
        },
    )
    assert pre.status_code == 200, pre.text
    assert pre.headers["access-control-allow-origin"] == APP_ORIGIN
    assert "access-control-allow-credentials" not in pre.headers
    assert pre.headers["access-control-max-age"] == "7200"

    android = await client.get("/api/auth/setup-status", headers={"origin": "https://localhost"})
    assert android.headers["access-control-allow-origin"] == "https://localhost"
    assert "x-agentic-session" in android.headers["access-control-expose-headers"]

    evil = await client.options(
        "/api/auth/me",
        headers={"origin": "https://evil.example", "access-control-request-method": "POST"},
    )
    assert evil.status_code == 400
    assert "access-control-allow-origin" not in evil.headers
    simple = await client.get("/api/auth/setup-status", headers={"origin": "https://evil.example"})
    assert "access-control-allow-origin" not in simple.headers


async def test_two_step_sign_in_in_the_app(client, clock):  # noqa: F811
    await setup_owner(client)
    secret, codes = await _turn_on(client, clock)
    app = anon(client)
    r = await app_login(app)
    assert r.status_code == 200 and "x-agentic-session" not in r.headers
    challenge = r.json()["challenge"]
    clock["step"] += 2
    done = await app.post(
        "/api/auth/login/2fa",
        json={"challenge": challenge, "code": totp.code_at(secret, clock["step"])},
        headers=APP,
    )
    assert done.status_code == 200, done.text
    token = done.headers["x-agentic-session"]
    assert not app.cookies
    assert (await app.get("/api/auth/me", headers=bearer(token))).status_code == 200


async def test_emailed_sign_in_password_in_the_app(client, graph):  # noqa: F811
    await setup_owner(client)
    await sender_on(client)
    await add(client, "app.person@example.com")
    app = anon(client)
    first = await app_login(app, "app.person@example.com", "forgot-what-it-was")
    await signin_mail.drain()
    assert first.status_code == 401
    code = graph.code_for("app.person@example.com")

    r = await app_login(app, "app.person@example.com", code)
    assert r.status_code == 200, r.text
    assert r.json()["user"]["must_change_password"] is True
    token = r.headers["x-agentic-session"]
    changed = await app.post(
        "/api/auth/change-password",
        json={"current_password": code, "new_password": "a-long-new-password-2026"},
        headers=bearer(token),
    )
    assert changed.status_code == 200, changed.text
    # The password change keeps this phone signed in (other devices are signed out).
    me = await app.get("/api/auth/me", headers=bearer(token))
    assert me.status_code == 200 and me.json()["user"]["must_change_password"] is False


async def test_live_events_accept_the_token(client):
    """The live stream (/api/events) signs in the same way; a wrong token is refused."""
    from starlette.requests import Request

    from agentic.api.routers.events_stream import stream_principal

    await setup_owner(client)
    token = (await app_login(anon(client))).headers["x-agentic-session"]
    bad = await anon(client).get("/api/events", headers=bearer("not-a-real-token-0000000000000"))
    assert bad.status_code == 401 and bad.json()["code"] == "session_expired"

    def request(headers: dict[str, str]) -> Request:
        raw = [(k.encode(), v.encode()) for k, v in headers.items()]
        return Request({"type": "http", "method": "GET", "path": "/api/events", "headers": raw})

    principal = await stream_principal(request(bearer(token)))
    assert principal.user.email == OWNER
