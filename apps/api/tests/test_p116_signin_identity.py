"""P116 (feedback 19 Nov): an admin made a test account and connected her own work Microsoft
account in it; "Sign in with Microsoft" then landed in the test account, never her own. Now the
sign-in email decides first, a Microsoft account several people connected (a shared work
mailbox) never picks who signs in, and Prima's link follows only a person's own account."""

from sqlalchemy import select

from agentic.core.db import SessionLocal
from agentic.microsoft import auth
from agentic.models import Membership, MicrosoftAccount

from .test_agents import llm, office, temporal  # noqa: F401
from .test_microsoft import TENANT, user_id
from .test_office_roles import member
from .test_p63_microsoft_signin import anon, configure, sign_in, sso  # noqa: F401


async def _connected(email: str, oid: str, mailbox: str) -> str:
    """`email`'s account has the Microsoft account `oid` (`mailbox`) connected."""
    uid, _ = await user_id(email)
    async with SessionLocal() as db:
        ws = await db.scalar(select(Membership.workspace_id).where(Membership.user_id == uid))
        db.add(
            MicrosoftAccount(
                workspace_id=ws,
                user_id=uid,
                ms_user_id=oid,
                tenant_id=TENANT,
                email=mailbox,
                status="connected",
            )
        )
        await db.commit()
    return uid


async def test_the_sign_in_email_wins_over_a_test_account_that_connected_it(
    client, llm, temporal, sso
):
    o = await office(client)
    await configure(client)
    await member(client, "tester@example.com", "staff", branch_id=o["branch"]["id"])
    # The test account has the owner's own Microsoft account connected.
    await _connected("tester@example.com", "oid-owner", "owner@example.com")
    c = anon(client)
    try:
        assert (await sign_in(c, sso))["sso"] == "done"
        assert (await c.get("/api/auth/me")).json()["user"]["email"] == "owner@example.com"
    finally:
        await c.aclose()
    # And the test account never became "the owner" for Prima.
    tester, _ = await user_id("tester@example.com")
    async with SessionLocal() as db:
        mem = await db.scalar(select(Membership).where(Membership.user_id == tester))
        assert mem.ms_oid is None
        assert not await auth.own_microsoft(
            db, mem.workspace_id, tester, "oid-owner", ["owner@example.com"]
        )


async def test_a_shared_work_mailbox_never_decides_who_signs_in(client, llm, temporal, sso):
    o = await office(client)
    await configure(client)
    for e in ("aina@example.com", "bakri@example.com"):
        await member(client, e, "staff", branch_id=o["branch"]["id"])
    sso.me = {"id": "oid-shared", "mail": "hq@example.com", "userPrincipalName": "hq@example.com"}

    # One person connected it (their office email differs): it still finds them.
    aina = await _connected("aina@example.com", "oid-shared", "hq@example.com")
    c = anon(client)
    try:
        assert (await sign_in(c, sso))["sso"] == "done"
        assert (await c.get("/api/auth/me")).json()["user"]["email"] == "aina@example.com"
    finally:
        await c.aclose()
    async with SessionLocal() as db:
        ws = await db.scalar(select(Membership.workspace_id).where(Membership.user_id == aina))
        assert await auth.own_microsoft(db, ws, aina, "oid-shared", ["hq@example.com"])

    # Two people connected it: shared, so it cannot tell who you are.
    await _connected("bakri@example.com", "oid-shared", "hq@example.com")
    sso.nonce = ""
    c = anon(client)
    try:
        got = await sign_in(c, sso)
        assert got["path"] == "/login" and "shared Microsoft account" in got["sso_error"]
        assert (await c.get("/api/auth/me")).status_code == 401
    finally:
        await c.aclose()
