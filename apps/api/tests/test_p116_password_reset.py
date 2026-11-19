"""P116 (feedback 19 Nov): forgot password, reset it with a 6-digit code by email."""

import re

from agentic.services import password_reset, signin_mail

from .test_p92_signin_mail import (  # noqa: F401
    anon,
    audit_rows,
    graph,
    login,
    sender_on,
    setup_owner,
    signed_in_member,
    user,
)

NEW = "a-brand-new-password-1"


def code_in(fake, email: str) -> str:
    html = fake.to(email)[-1]["body"]["message"]["body"]["content"]
    m = re.search(r">(\d{6})</div>", html)
    assert m, html
    return m.group(1)


async def test_a_code_by_email_sets_a_new_password(client, graph):
    await setup_owner(client)
    await sender_on(client)
    member = await signed_in_member(client, client, "forgetful@example.com")
    c = anon(client)
    a = await c.post("/api/auth/password-reset", json={"email": "forgetful@example.com"})
    b = await c.post("/api/auth/password-reset", json={"email": "ghost@example.com"})
    assert (a.status_code, a.json()) == (b.status_code, b.json()) == (202, {"ok": True})
    await signin_mail.drain()
    assert graph.to("ghost@example.com") == []
    code = code_in(graph, "forgetful@example.com")

    # The code is not a password: it cannot sign in by itself.
    assert (await login(c, "forgetful@example.com", code)).status_code == 401
    # A wrong code changes nothing.
    wrong = "000000" if code != "000000" else "111111"
    r = await c.post(
        "/api/auth/password-reset/confirm",
        json={"email": "forgetful@example.com", "code": wrong, "new_password": NEW},
    )
    assert r.status_code == 400 and r.json()["code"] == "bad_code"
    # The right one sets the new password, once, and signs out every device.
    r = await c.post(
        "/api/auth/password-reset/confirm",
        json={"email": "forgetful@example.com", "code": code, "new_password": NEW},
    )
    assert r.status_code == 200, r.text
    assert (await member.get("/api/auth/me")).status_code == 401
    assert (await login(c, "forgetful@example.com", NEW)).status_code == 200
    c2 = anon(client)
    r = await c2.post(
        "/api/auth/password-reset/confirm",
        json={"email": "forgetful@example.com", "code": code, "new_password": NEW + "x"},
    )
    assert r.status_code == 400
    actions = [e.action for e in await audit_rows()]
    assert "auth.reset_code_sent" in actions and "auth.password_reset" in actions
    await member.aclose()
    await c2.aclose()
    await c.aclose()


async def test_five_wrong_tries_and_the_code_is_gone(client, graph):
    await setup_owner(client)
    await sender_on(client)
    await signed_in_member(client, client, "guessed@example.com")
    before = (await user("guessed@example.com")).password_hash
    c = anon(client)
    await c.post("/api/auth/password-reset", json={"email": "guessed@example.com"})
    await signin_mail.drain()
    code = code_in(graph, "guessed@example.com")
    wrong = [f"{(int(code) + i) % 1_000_000:06d}" for i in range(1, password_reset.TRIES + 1)]
    for w in wrong:
        r = await c.post(
            "/api/auth/password-reset/confirm",
            json={"email": "guessed@example.com", "code": w, "new_password": NEW},
        )
        assert r.status_code == 400
    r = await c.post(
        "/api/auth/password-reset/confirm",
        json={"email": "guessed@example.com", "code": code, "new_password": NEW},
    )
    assert r.status_code == 400  # used up: ask for a new one
    assert (await user("guessed@example.com")).password_hash == before
    await c.aclose()


async def test_no_code_when_forgot_password_is_off(client, graph):
    await setup_owner(client)
    await sender_on(client, forgot_password=False)
    await signed_in_member(client, client, "known@example.com")
    c = anon(client)
    await c.post("/api/auth/password-reset", json={"email": "known@example.com"})
    await signin_mail.drain()
    assert graph.to("known@example.com") == []
    await c.aclose()
