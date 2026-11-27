"""P141: the people who asked for a sign-in password but were not here are added by the office's
admins (named from their email), and anyone changes their own name. Synthetic people only."""

import pytest
from sqlalchemy import select

from agentic.api.routers.prima_master import name_from_email
from agentic.core.db import SessionLocal
from agentic.models import AuditLog, Membership, User
from agentic.services import signin_mail

from .conftest import csrf, setup_owner
from .test_office_roles import as_role, member
from .test_p92_signin_mail import graph, sender_on  # noqa: F401

ADD = "/api/prima-master/unknown-signins/add"
LIST = "/api/prima-master/unknown-signins"


@pytest.mark.parametrize(
    ("email", "name"),
    [
        ("zulaikha_zul@outlook.com", "Zulaikha Zul"),
        ("azeemrosele0002@outlook.com", "Azeemrosele"),
        ("hudanurin@outlook.com", "Hudanurin"),
        ("siti.nur-aisyah+work@example.com", "Siti Nur Aisyah Work"),
        ("AHMAD99ali@example.com", "Ahmad Ali"),
        ("12345@example.com", "New member"),
        ("._-@example.com", "New member"),
    ],
)
def test_a_name_is_made_from_the_email(email, name):
    assert name_from_email(email) == name


async def _company(client) -> str:
    r = await client.post("/api/branches", json={"name": "Maju Sdn Bhd"}, headers=csrf(client))
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


async def _member_of(email: str) -> tuple[User, Membership] | None:
    async with SessionLocal() as db:
        u = await db.scalar(select(User).where(User.email == email))
        if u is None:
            return None
        m = await db.scalar(select(Membership).where(Membership.user_id == u.id))
        return (u, m) if m else None


async def test_a_global_admin_adds_them_and_they_leave_the_list(client, graph):  # noqa: F811
    await setup_owner(client)
    await sender_on(client)
    branch = await _company(client)
    await member(client, "already.here@example.com", "staff", branch_id=branch)
    admin = await as_role(client, "global.admin@example.com", "admin")
    for e in ("zulaikha_zul@outlook.com", "azeemrosele0002@outlook.com"):
        await signin_mail.note_unknown(e)
    listed = (await admin.get(LIST)).json()
    assert {r["email"] for r in listed} == {
        "zulaikha_zul@outlook.com",
        "azeemrosele0002@outlook.com",
    }

    r = await admin.post(
        ADD,
        json={
            "emails": [
                "Zulaikha_Zul@outlook.com",
                "azeemrosele0002@outlook.com",
                "already.here@example.com",
                "not-an-email",
            ],
            "names": {"azeemrosele0002@outlook.com": "  Azeem   Rosele "},
            "branch_id": branch,
        },
        headers=csrf(admin),
    )
    assert r.status_code == 200, r.text
    out = r.json()
    by = {x["email"]: x for x in out["results"]}
    assert (out["added"], out["skipped"], out["failed"], out["emailed"]) == (2, 1, 1, 2)
    assert by["zulaikha_zul@outlook.com"]["ok"] and by["zulaikha_zul@outlook.com"]["emailed"]
    assert by["zulaikha_zul@outlook.com"]["name"] == "Zulaikha Zul"
    assert by["azeemrosele0002@outlook.com"]["name"] == "Azeem Rosele"
    assert by["already.here@example.com"]["skipped"] is True
    assert "already a member" in by["already.here@example.com"]["message"]
    assert by["not-an-email"]["ok"] is False and by["not-an-email"]["skipped"] is False

    u, m = await _member_of("zulaikha_zul@outlook.com")
    assert m.role == "staff" and m.branch_id == branch and u.must_change_password
    assert by["zulaikha_zul@outlook.com"]["user_id"] == u.id
    # Each got a sign-in password, the same email as Members > Email a sign-in password.
    assert len(graph.to("zulaikha_zul@outlook.com")) == 1
    assert len(graph.to("azeemrosele0002@outlook.com")) == 1
    assert graph.to("already.here@example.com") == []
    # Gone from the list; the audit names the admin, as with POST /api/members.
    assert (await admin.get(LIST)).json() == []
    async with SessionLocal() as db:
        rows = (
            await db.scalars(
                select(AuditLog).where(AuditLog.action == "member.added", AuditLog.target == u.id)
            )
        ).all()
    assert len(rows) == 1 and rows[0].after["via"] == "unknown-signins"
    await admin.aclose()


async def test_no_email_when_asked_not_to(client, graph):  # noqa: F811
    await setup_owner(client)
    await sender_on(client)
    branch = await _company(client)
    await signin_mail.note_unknown("hudanurin@outlook.com")
    r = await client.post(
        ADD,
        json={"emails": ["hudanurin@outlook.com"], "branch_id": branch, "send_signin": False},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    [row] = r.json()["results"]
    assert row["ok"] and row["emailed"] is None and row["name"] == "Hudanurin"
    assert graph.sent == []
    assert await _member_of("hudanurin@outlook.com")


async def test_who_may_add_and_what_they_may_give(client, graph):  # noqa: F811
    await setup_owner(client)
    branch = await _company(client)
    staff = await as_role(client, "plain.staff@example.com", "staff", branch_id=branch)
    r = await staff.post(ADD, json={"emails": ["x1@outlook.com"]}, headers=csrf(staff))
    assert r.status_code == 403
    assert (await staff.get(LIST)).status_code == 403
    await staff.aclose()

    admin = await as_role(client, "global.admin@example.com", "admin")
    # The role ceiling of POST /api/members: a global admin never makes an owner.
    r = await admin.post(
        ADD, json={"emails": ["x2@outlook.com"], "role": "owner"}, headers=csrf(admin)
    )
    assert r.status_code == 403 and r.json()["code"] == "owner_only"
    # Staff need a company, as on the Members page.
    r = await admin.post(ADD, json={"emails": ["x3@outlook.com"]}, headers=csrf(admin))
    assert r.status_code == 422 and r.json()["code"] == "branch_required"
    assert await _member_of("x2@outlook.com") is None
    await admin.aclose()

    # IT support's add waits for an owner or a global admin to approve it.
    it = await as_role(client, "it.helper@example.com", "it_support")
    r = await it.post(
        ADD,
        json={"emails": ["x4@outlook.com"], "branch_id": branch, "send_signin": False},
        headers=csrf(it),
    )
    assert r.status_code == 202, r.text
    assert r.json()["held"] is True and "x4@outlook.com" in r.json()["summary"]
    assert await _member_of("x4@outlook.com") is None
    await it.aclose()


async def test_anyone_changes_their_own_name(client):
    await setup_owner(client)
    branch = await _company(client)
    staff = await as_role(client, "zulaikha_zul@example.com", "staff", branch_id=branch)
    r = await staff.put("/api/account/name", json={"name": "  Zulaikha   binti Zul "})
    assert r.status_code == 403  # no CSRF header
    r = await staff.put(
        "/api/account/name", json={"name": "  Zulaikha   binti Zul "}, headers=csrf(staff)
    )
    assert r.status_code == 200, r.text
    assert r.json()["user"]["name"] == "Zulaikha binti Zul"
    assert (await staff.get("/api/auth/me")).json()["user"]["name"] == "Zulaikha binti Zul"
    for bad in ("Z", "   ", "x" * 121):
        r = await staff.put("/api/account/name", json={"name": bad}, headers=csrf(staff))
        assert r.status_code == 422 and r.json()["code"] == "bad_name", bad
    async with SessionLocal() as db:
        [row] = (
            await db.scalars(select(AuditLog).where(AuditLog.action == "account.name_changed"))
        ).all()
    assert row.before == {"name": "Zulaikha_Zul"} and row.after == {"name": "Zulaikha binti Zul"}
    await staff.aclose()
