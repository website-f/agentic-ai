"""P118 (Fitri, 19 Nov 2026): one person, more than one Microsoft account. Their main account
stays the one their AI, Teams and Prima use and the one they sign in with; "Add another
Microsoft account" connects a personal or shared one beside it, read on the Microsoft 365 page
by picking it (X-M365-Account). Only their own accounts, never anyone else's; a shared one
shows how many other people here connected it."""

from sqlalchemy import select

from agentic.core.db import SessionLocal
from agentic.microsoft import access, graph
from agentic.models import Membership, MicrosoftAccount

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_microsoft import TENANT, connect, ms_query, user_id
from .test_office_roles import member
from .test_p63_microsoft_signin import configure, sso  # noqa: F401

PERSONAL = {
    "id": "oid-personal",
    "mail": "me.personal@example.org",
    "userPrincipalName": "me.personal@example.org",
}


async def connect_another(c) -> dict:
    r = await c.post("/api/integrations/microsoft/connect", json={"another": True}, headers=csrf(c))
    assert r.status_code == 200, r.text
    from urllib.parse import parse_qs, urlparse

    state = parse_qs(urlparse(r.json()["url"]).query)["state"][0]
    r = await c.get(
        "/api/integrations/microsoft/callback", params={"state": state, "code": "good-code"}
    )
    return ms_query(r)


async def test_another_account_beside_the_main_one(client, llm, temporal, sso, monkeypatch):
    await office(client)
    await configure(client)
    assert ms_query(await connect(client))["ms"] == "connected"  # the main one (oid-owner)
    sso.me = PERSONAL
    got = await connect_another(client)
    assert got["path"] == "/mail" and got["ms"] == "connected" and got["app"] == "mail"

    accounts = (await client.get("/api/integrations/microsoft/accounts")).json()
    assert [(a["email"], a["primary"]) for a in accounts] == [
        ("owner@example.com", True),
        ("me.personal@example.org", False),
    ]
    assert accounts[0]["is_sign_in"] is True and accounts[1]["shared_with"] == 0
    extra_id = accounts[1]["id"]

    # The main account is untouched: the AI's account and Prima's link stay the work one.
    owner, ws = await user_id("owner@example.com")
    async with SessionLocal() as db:
        main = await access.personal_account_of(db, ws, owner)
        assert main is not None and main.ms_user_id == "oid-owner"
        mem = await db.scalar(select(Membership).where(Membership.user_id == owner))
        assert mem.ms_oid == "oid-owner"

    # Connecting the same personal account again updates it (no second row).
    sso.me = PERSONAL
    await connect_another(client)
    assert len((await client.get("/api/integrations/microsoft/accounts")).json()) == 2

    # The Microsoft 365 page reads the account picked; nobody else's.
    used: list[str] = []

    class G:
        async def folder_messages(self, *_a, **_k):
            return []

    async def for_account(_db, acct):
        used.append(acct.email)
        return G()

    monkeypatch.setattr(graph, "for_account", for_account)
    assert (await client.get("/api/m365/mail")).status_code == 200
    r = await client.get("/api/m365/mail", headers={"X-M365-Account": extra_id})
    assert r.status_code == 200, r.text
    assert used == ["owner@example.com", "me.personal@example.org"]
    r = await client.get("/api/m365/mail", headers={"X-M365-Account": "ma_not_mine"})
    assert r.status_code == 404

    # A name for it, and removing it; the main one is not removed from here.
    r = await client.patch(
        f"/api/integrations/microsoft/accounts/{extra_id}",
        json={"label": "Personal"},
        headers=csrf(client),
    )
    assert r.status_code == 200 and r.json()["label"] == "Personal"
    main_id = accounts[0]["id"]
    r = await client.delete(
        f"/api/integrations/microsoft/accounts/{main_id}",
        headers={"content-type": "application/json", **csrf(client)},
    )
    assert r.status_code == 400
    r = await client.delete(
        f"/api/integrations/microsoft/accounts/{extra_id}",
        headers={"content-type": "application/json", **csrf(client)},
    )
    assert r.status_code == 204
    assert [
        a["email"] for a in (await client.get("/api/integrations/microsoft/accounts")).json()
    ] == ["owner@example.com"]


async def test_a_shared_account_shows_who_else_has_it_and_stays_private(client, llm, temporal, sso):
    o = await office(client)
    await configure(client)
    await connect(client)
    sso.me = {"id": "oid-hq", "mail": "hq@example.com", "userPrincipalName": "hq@example.com"}
    await connect_another(client)
    # A colleague connected the same company mailbox.
    await member(client, "aina@example.com", "staff", branch_id=o["branch"]["id"])
    aina, ws = await user_id("aina@example.com")
    async with SessionLocal() as db:
        db.add(
            MicrosoftAccount(
                workspace_id=ws,
                user_id=aina,
                ms_user_id="oid-hq",
                tenant_id=TENANT,
                email="hq@example.com",
                status="connected",
                is_primary=False,
            )
        )
        await db.commit()
        theirs = await db.scalar(
            select(MicrosoftAccount.id).where(MicrosoftAccount.user_id == aina)
        )
    accounts = (await client.get("/api/integrations/microsoft/accounts")).json()
    hq = next(a for a in accounts if a["email"] == "hq@example.com")
    assert hq["shared_with"] == 1 and hq["primary"] is False
    # Their copy is theirs: not readable, renamable or removable from here.
    assert (
        await client.get("/api/m365/mail", headers={"X-M365-Account": theirs})
    ).status_code == 404
    r = await client.patch(
        f"/api/integrations/microsoft/accounts/{theirs}", json={"label": "x"}, headers=csrf(client)
    )
    assert r.status_code == 404
    r = await client.delete(
        f"/api/integrations/microsoft/accounts/{theirs}",
        headers={"content-type": "application/json", **csrf(client)},
    )
    assert r.status_code == 404
