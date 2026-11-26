"""P133: with personal Microsoft accounts allowed (multi-tenant app), a member whose email is not
on the company's own Microsoft organisation (another company, or @outlook.com) signs in through
"common", asked only who they are; matched only by the address Microsoft vouches for. Microsoft is
faked; synthetic people only."""

from urllib.parse import parse_qs, urlparse

from sqlalchemy import select

from agentic.core.db import SessionLocal
from agentic.microsoft import app as ms_app
from agentic.microsoft.signin import CONSUMERS_TENANT
from agentic.models import MicrosoftAccount

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_microsoft import user_id
from .test_office_roles import member
from .test_p63_microsoft_signin import OTHER_TENANT, anon, configure, sign_in, sso  # noqa: F401


async def _open(client) -> str:
    await configure(client, tenant="organizations")
    _, ws_id = await user_id("owner@example.com")
    async with SessionLocal() as db:
        await ms_app.update(db, ws_id, "test", personal_accounts=True, admin_tenant="tid-own")
        await db.commit()
    return ws_id


async def test_an_outlook_com_member_signs_in_with_their_personal_microsoft_account(
    client, llm, temporal, sso
):
    o = await office(client)
    await member(client, "zul@outlook.com", "staff", branch_id=o["branch"]["id"])
    await _open(client)
    c = anon(client)
    try:
        r = await c.post("/api/auth/microsoft/start", json={"email": "zul@outlook.com"})
        url = r.json()["url"]
        q = parse_qs(urlparse(url).query)
        assert url.startswith("https://login.microsoftonline.com/common/oauth2/v2.0/authorize")
        assert q["scope"] == ["openid profile email offline_access User.Read"]
        sso.me = {"id": "oid-zul", "mail": None, "userPrincipalName": "zul@outlook.com"}
        sso.claims = {"tid": CONSUMERS_TENANT, "preferred_username": "zul@outlook.com"}
        sso.scope = "openid profile email offline_access User.Read"
        got = await sign_in(c, sso, email="zul@outlook.com")
        assert got.get("sso") == "done", got
        me = (await c.get("/api/auth/me")).json()
        assert me["user"]["email"] == "zul@outlook.com"
        async with SessionLocal() as db:  # no mailbox taken on this path
            assert await db.scalar(select(MicrosoftAccount.id)) is None
    finally:
        await c.aclose()


async def test_another_organisations_mail_attribute_is_never_trusted(client, llm, temporal, sso):
    await office(client)
    await _open(client)
    c = anon(client)
    try:
        # Another company's admin set `mail` to our owner's address; its UPN is their own.
        sso.me = {"id": "oid-x", "mail": "owner@example.com", "userPrincipalName": "x@evil.test"}
        sso.claims = {"tid": OTHER_TENANT, "preferred_username": "owner@example.com"}
        got = await sign_in(c, sso, email="x@evil.test")
        assert "No one with" in got.get("sso_error", ""), got
        assert (await c.get("/api/auth/me")).status_code == 401
    finally:
        await c.aclose()


async def test_closed_to_other_organisations_until_the_owner_allows_it(client, llm, temporal, sso):
    o = await office(client)
    await member(client, "zul@outlook.com", "staff", branch_id=o["branch"]["id"])
    await configure(client, tenant="organizations")
    c = anon(client)
    try:
        r = await c.post("/api/auth/microsoft/start", json={"email": "zul@outlook.com"})
        assert "/organizations/" in r.json()["url"]
        sso.me = {"id": "oid-zul", "mail": None, "userPrincipalName": "zul@outlook.com"}
        sso.claims = {"tid": CONSUMERS_TENANT}
        got = await sign_in(c, sso, email="zul@outlook.com")
        assert "not linked to the office" in got.get("sso_error", ""), got
    finally:
        await c.aclose()
    assert csrf  # imported for the fixtures' helpers
