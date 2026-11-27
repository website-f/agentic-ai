"""P142: people whose work Microsoft account is shared connect a personal one (Outlook.com,
Hotmail) as their own on the Microsoft 365 page. The company's sign-in page refuses personal
accounts, so with personal accounts allowed (multi-tenant app) their main connection goes through
"common" asking for mail and calendar only. Microsoft is faked; synthetic people only."""

from urllib.parse import parse_qs, urlparse

from agentic.core.db import SessionLocal
from agentic.microsoft import app as ms_app
from agentic.microsoft import auth
from agentic.microsoft.domains import CONSUMER_TENANT
from agentic.models import MicrosoftAccount

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_microsoft import user_id
from .test_office_roles import member
from .test_p63_microsoft_signin import configure, sso  # noqa: F401

CONNECT = "/api/integrations/microsoft/connect"


async def _setup(client, personal: bool = True) -> str:
    await configure(client, tenant="organizations")
    _, ws_id = await user_id("owner@example.com")
    async with SessionLocal() as db:
        await ms_app.update(db, ws_id, "test", personal_accounts=personal, admin_tenant="tid-own")
        await db.commit()
    return ws_id


def _parts(url: str) -> tuple[str, str]:
    u = urlparse(url)
    return u.path.split("/")[1], parse_qs(u.query)["scope"][0]


async def test_a_personal_account_connects_through_common_with_mail_and_calendar(
    client, llm, temporal, sso
):
    await office(client)
    await _setup(client)
    r = await client.post(CONNECT, json={"personal": True}, headers=csrf(client))
    assert r.status_code == 200, r.text
    authority, scope = _parts(r.json()["url"])
    assert authority == "common"
    assert scope == ms_app.EXTRA_SCOPES
    # The plain Connect of a work-email person stays on the company's own sign-in page.
    r = await client.post(CONNECT, json={}, headers=csrf(client))
    authority, scope = _parts(r.json()["url"])
    assert authority != "common"
    assert "Mail.ReadWrite" in scope


async def test_refused_while_personal_accounts_are_off(client, llm, temporal, sso):
    await office(client)
    await _setup(client, personal=False)
    r = await client.post(CONNECT, json={"personal": True}, headers=csrf(client))
    assert r.status_code == 409
    assert "switched off" in r.json()["message"]


async def test_an_outlook_com_member_or_a_personal_account_is_personal_by_itself(
    client, llm, temporal, sso
):
    o = await office(client)
    await member(client, "zul@outlook.com", "staff", branch_id=o["branch"]["id"])
    ws_id = await _setup(client)
    zul, _ = await user_id("zul@outlook.com")
    owner, _ = await user_id("owner@example.com")
    async with SessionLocal() as db:
        assert await auth._personal_main(db, ws_id, zul) is True
        assert await auth._personal_main(db, ws_id, owner) is False
        # The owner's main account already is a personal one: a reconnect stays personal.
        db.add(MicrosoftAccount(workspace_id=ws_id, user_id=owner, ms_user_id="p1",
                                tenant_id=CONSUMER_TENANT, email="me@outlook.com"))  # fmt: skip
        await db.commit()
        assert await auth._personal_main(db, ws_id, owner) is True
    r = await client.post(CONNECT, json={}, headers=csrf(client))
    assert _parts(r.json()["url"])[0] == "common"
    acct = (await client.get("/api/integrations/microsoft/account")).json()
    assert acct["personal"] is True
