"""P123 (Fitri, 23 Nov 2026): Arisha's use is AI use like any agent's. Everyone has the daily
allowance by default except owners (the developer is one) and admins; only owners and admins may
give unlimited, to the people they manage; and when several people open Prima as its shared top
record, Arisha's turns are charged to the one asking, not to the record's own person."""

from sqlalchemy import select

from agentic.core.db import SessionLocal
from agentic.models import LLMCall, Membership, User
from agentic.prima import client as prima_client
from agentic.prima import model
from agentic.teams import allowance

from .conftest import csrf
from .test_agents import llm, office  # noqa: F401
from .test_office_roles import as_role
from .test_p80_prima_model import _ask, _body, _link, prima_on, signed  # noqa: F401


def test_every_role_but_owners_and_admins_has_the_allowance_by_default():
    assert "owner" not in allowance.DEFAULT_ROLES and "admin" not in allowance.DEFAULT_ROLES
    for role in ("staff", "hod", "group_hod", "supervisor", "branch_manager", "management"):
        assert role in allowance.DEFAULT_ROLES


async def _user_id(email: str) -> str:
    async with SessionLocal() as db:
        return (await db.scalar(select(User).where(User.email == email))).id


async def test_only_owners_and_admins_give_unlimited(client, llm):
    o = await office(client)
    hod = await as_role(
        client,
        "hod@example.com",
        "hod",
        branch_id=o["branch"]["id"],
        department_id=o["depts"]["Finance"],
    )
    await as_role(
        client,
        "siti@example.com",
        "staff",
        branch_id=o["branch"]["id"],
        department_id=o["depts"]["Finance"],
    )
    siti = await _user_id("siti@example.com")
    # The head of department may set a daily limit for their people, never "no limit".
    r = await hod.put(f"/api/allowances/{siti}", json={"daily_tokens": 0}, headers=csrf(hod))
    assert r.status_code == 403 and r.json()["code"] == "unlimited_admin_only", r.text
    r = await hod.put(f"/api/allowances/{siti}", json={"daily_tokens": 500_000}, headers=csrf(hod))
    assert r.status_code == 200, r.text
    # The owner may.
    r = await client.put(f"/api/allowances/{siti}", json={"daily_tokens": 0}, headers=csrf(client))
    assert r.status_code == 200, r.text
    async with SessionLocal() as db:
        m = await db.scalar(select(Membership).where(Membership.user_id == siti))
        assert m.ai_daily_tokens == 0


async def test_arisha_through_the_top_record_is_charged_to_the_one_asking(client, llm, prima_on):
    org = await office(client)
    # The top record (the CEO) is linked to someone else; the owner opens Prima as it.
    o = await client.get("/api/auth/me")
    ws = o.json()["workspace"]["id"]
    owner = await _user_id("owner@example.com")
    await as_role(client, "ceo.person@example.com", "staff", branch_id=org["branch"]["id"])
    ceo_person = await _link("ceo.person@example.com", "u-ceo")

    # The owner asked through the office proxy: noted, and charged to the owner.
    await prima_client.note_top_asker("u-ceo", ws, owner)
    llm.say("Open **Leave**.")
    body = _body()
    r = await _ask(client, body, signed(body, user="u-ceo"))
    assert r.status_code == 200, r.text
    async with SessionLocal() as db:
        rows = (await db.scalars(select(LLMCall).where(LLMCall.task == model.TASK))).all()
    assert [x.user_id for x in rows] == [owner]

    # A note naming someone who does not open Prima as the top record is ignored: the record's
    # own person pays, as before.
    await prima_client.note_top_asker("u-ceo", ws, ceo_person)
    llm.say("Open **Leave**.")
    body = _body(max_tokens=1000)
    r = await _ask(client, body, signed(body, user="u-ceo"))
    assert r.status_code == 200, r.text
    async with SessionLocal() as db:
        rows = (await db.scalars(select(LLMCall).where(LLMCall.task == model.TASK))).all()
    assert sorted(x.user_id for x in rows) == sorted([owner, ceo_person])
