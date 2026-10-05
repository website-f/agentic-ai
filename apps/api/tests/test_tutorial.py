"""P19: the tutorial's progress signals (per person and role) and the prefs merge whitelist."""

from datetime import UTC, datetime, timedelta

import httpx
import pytest

from agentic.core.db import SessionLocal
from agentic.models import Agent, Approval, Task, User
from agentic.services import prefs

from .conftest import csrf, setup_owner
from .test_agents import GOOD_KEY, llm, new_agent, new_task, office, temporal  # noqa: F401
from .test_office_roles import as_role


async def progress(c: httpx.AsyncClient) -> dict:
    r = await c.get("/api/tutorial/progress")
    assert r.status_code == 200, r.text
    return r.json()


async def ws_id(c: httpx.AsyncClient) -> str:
    return (await c.get("/api/auth/me")).json()["workspace"]["id"]


async def put_prefs(c: httpx.AsyncClient, body: dict) -> httpx.Response:
    return await c.put("/api/me/prefs", json=body, headers=csrf(c))


async def test_needs_sign_in_and_csrf(client):
    assert (await client.get("/api/tutorial/progress")).status_code == 401
    assert (await client.get("/api/me/prefs")).status_code == 401
    r = await client.put("/api/me/prefs", json={"tutorial": {"dismissed": True}})
    assert r.status_code == 401
    await setup_owner(client)
    # Signed in, but without the CSRF echo the write is refused.
    r = await client.put("/api/me/prefs", json={"tutorial": {"dismissed": True}})
    assert r.status_code == 403
    assert (await client.get("/api/me/prefs")).json()["tutorial"] == {}


async def test_owner_progress_follows_real_data(client, temporal):
    await setup_owner(client)
    p = await progress(client)
    assert p["role"] == "owner" and p["track"] == "owner"
    assert p["done"] == [] and p["dismissed"] is False
    s = p["signals"]
    assert not any(s[k] for k in ("provider", "model_group", "company", "agent", "task_created"))
    assert s["people"] is False

    # A company, a provider and a "smart" model group (what office() sets up).
    branch = (
        await client.post("/api/branches", json={"name": "Maju Sdn Bhd"}, headers=csrf(client))
    ).json()
    s = (await progress(client))["signals"]
    assert s["company"] and not s["provider"]
    prov = (
        await client.post(
            "/api/ai/providers",
            json={"name": "Good", "base_url": "https://good.fake/v1", "api_key": GOOD_KEY},
            headers=csrf(client),
        )
    ).json()
    assert (await progress(client))["signals"]["model_group"] is False
    await client.put(
        "/api/ai/groups/smart",
        json={"members": [{"provider_id": prov["id"], "model_id": "m1"}]},
        headers=csrf(client),
    )
    o = {"branch": branch, "depts": {d["name"]: d["id"] for d in branch["departments"]}}
    s = (await progress(client))["signals"]
    assert s["provider"] and s["model_group"] and s["company"]
    assert not s["agent"]

    agent = await new_agent(client, o, "Faiz")
    await new_task(client, agent, "Reconcile September")
    s = (await progress(client))["signals"]
    assert s["agent"] and s["task_created"]
    assert not s["task_done"] and not s["approved"] and not s["schedule"]

    r = await client.post(
        "/api/members",
        json={"email": "hana@example.com", "name": "Hana", "role": "viewer"},
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    assert (await progress(client))["signals"]["people"] is True


async def test_staff_progress_is_their_own(client, temporal):
    o = await office(client)
    await new_task(client, await new_agent(client, o, "Faiz"), "Owner's task")
    staff = await as_role(
        client,
        "siti@example.com",
        "staff",
        branch_id=o["branch"]["id"],
        department_id=o["depts"]["Finance"],
    )
    try:
        p = await progress(staff)
        assert p["role"] == "staff" and p["track"] == "staff"
        s = p["signals"]
        assert s["provider"] and s["company"]  # the office is set up: workspace facts
        # The owner's agent and task are not hers.
        assert not s["agent"] and not s["task_created"] and not s["twin"]

        me_id = (await staff.get("/api/auth/me")).json()["user"]["id"]
        async with SessionLocal() as db:
            ws = await ws_id(staff)
            twin = Agent(
                workspace_id=ws,
                branch_id=o["branch"]["id"],
                department_id=o["depts"]["Finance"],
                slug="siti-twin",
                name="Siti's twin",
                role="Accounts executive",
                owner_user_id=me_id,
                is_twin=True,
            )
            db.add(twin)
            await db.commit()
        s = (await progress(staff))["signals"]
        assert s["twin"] and not s["work_hours"]

        async with SessionLocal() as db:
            row = await db.get(Agent, twin.id)
            assert row is not None
            row.work_hours = {"days": [1, 2, 3, 4, 5], "start": "09:00", "end": "18:00"}
            await db.commit()
        assert (await progress(staff))["signals"]["work_hours"] is True
        # The owner has no twin of their own.
        assert (await progress(client))["signals"]["twin"] is False
    finally:
        await staff.aclose()


@pytest.mark.parametrize(
    ("role", "track"),
    [("hod", "management"), ("supervisor", "management"), ("approver", "approver")],
)
async def test_tracks_by_role(client, role, track):
    o = await office(client)
    where = {}
    if role in ("hod", "supervisor"):
        where = {"branch_id": o["branch"]["id"], "department_id": o["depts"]["Finance"]}
    c = await as_role(client, f"{role}@example.com", role, **where)
    try:
        assert (await progress(c))["track"] == track
    finally:
        await c.aclose()


async def test_approver_progress_counts_their_decisions(client):
    o = await office(client)
    agent = await new_agent(client, o, "Faiz")
    c = await as_role(client, "amir@example.com", "approver")
    try:
        assert (await progress(c))["signals"]["approved"] is False
        uid = (await c.get("/api/auth/me")).json()["user"]["id"]
        now = datetime.now(UTC)
        async with SessionLocal() as db:
            ws = await ws_id(c)
            t = Task(workspace_id=ws, title="Pay supplier", created_by="user:x")
            db.add(t)
            await db.flush()
            db.add(
                Approval(
                    workspace_id=ws,
                    task_id=t.id,
                    agent_id=agent["id"],
                    tool_name="send_email",
                    tool_call_id="c1",
                    status="approved",
                    decided_by=f"user:{uid}",
                    decided_at=now,
                    created_at=now,
                    expires_at=now + timedelta(hours=1),
                )
            )
            await db.commit()
        assert (await progress(c))["signals"]["approved"] is True
        # Someone else's decision does not count for the owner.
        assert (await progress(client))["signals"]["approved"] is False
    finally:
        await c.aclose()


async def test_prefs_merge_whitelist(client):
    await setup_owner(client)
    r = await put_prefs(
        client, {"tutorial": {"done": ["owner.providers", "owner.agent", "owner.agent"]}}
    )
    assert r.status_code == 200, r.text
    assert r.json()["tutorial"] == {"done": ["owner.providers", "owner.agent"]}

    # Sub-keys merge: dismissing keeps the done list; another whitelisted key sits beside it.
    r = await put_prefs(client, {"tutorial": {"dismissed": True}})
    assert r.json()["tutorial"] == {"done": ["owner.providers", "owner.agent"], "dismissed": True}
    r = await put_prefs(client, {"onboarding": {"step": 2, "seen": ["twin"]}})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["onboarding"] == {"step": 2, "seen": ["twin"]}
    assert body["tutorial"]["dismissed"] is True

    p = await progress(client)
    assert p["done"] == ["owner.providers", "owner.agent"] and p["dismissed"] is True

    # null removes a sub-key.
    r = await put_prefs(client, {"tutorial": {"dismissed": None}})
    assert r.json()["tutorial"] == {"done": ["owner.providers", "owner.agent"]}

    # Refused: unknown top-level keys, unknown tutorial fields, wrong shapes, empty body.
    for bad in (
        {"theme": "dark"},
        {"tutorial": {"done": ["ok"]}, "role": "owner"},
        {"tutorial": {"secret": 1}},
        {"tutorial": {"done": "owner.agent"}},
        {"tutorial": {"done": [1, 2]}},
        {"tutorial": {"dismissed": "yes"}},
        {"tutorial": {"track": "ceo"}},
        {"tutorial": ["done"]},
        {"onboarding": {"blob": "x" * 9000}},
        {},
    ):
        r = await put_prefs(client, bad)
        assert r.status_code == 422, (bad, r.text)
        assert r.json()["code"] in ("bad_prefs", "validation_failed")
    assert (await client.get("/api/me/prefs")).json()["tutorial"] == {
        "done": ["owner.providers", "owner.agent"]
    }


async def test_prefs_keep_other_keys_and_are_per_person(client):
    me = await setup_owner(client)
    uid = me["user"]["id"]
    async with SessionLocal() as db:
        u = await db.get(User, uid)
        assert u is not None
        u.prefs = {"internal": {"x": 1}}
        await db.commit()
    r = await put_prefs(client, {"tutorial": {"done": ["owner.agent"]}})
    assert r.status_code == 200
    assert "internal" not in r.json()  # only whitelisted keys come back
    async with SessionLocal() as db:
        u = await db.get(User, uid)
        assert u is not None
        assert u.prefs == {"internal": {"x": 1}, "tutorial": {"done": ["owner.agent"]}}

    other = await as_role(client, "vera@example.com", "viewer")
    try:
        assert (await other.get("/api/me/prefs")).json() == {
            "tutorial": {},
            "onboarding": {},
            "locale": {},
        }
        assert (await progress(other))["done"] == []
    finally:
        await other.aclose()


def test_merge_helper_is_generic_for_whitelisted_keys():
    assert prefs.KEYS == ("tutorial", "onboarding", "locale")
    out = prefs.merge({"onboarding": {"a": 1}}, {"onboarding": {"b": 2}})
    assert out == {"onboarding": {"a": 1, "b": 2}}
    with pytest.raises(prefs.PrefsError):
        prefs.merge({}, {"admin": {"x": 1}})
    assert prefs.visible(None) == {"tutorial": {}, "onboarding": {}, "locale": {}}
    assert prefs.visible({"tutorial": "junk"}) == {"tutorial": {}, "onboarding": {}, "locale": {}}


async def test_language_is_a_profile_setting(client, llm, temporal):
    from .conftest import csrf

    await office(client)
    r = await client.put("/api/me/prefs", json={"locale": {"language": "ms"}}, headers=csrf(client))
    assert r.status_code == 200 and r.json()["locale"] == {"language": "ms"}
    bad = await client.put(
        "/api/me/prefs", json={"locale": {"language": "fr"}}, headers=csrf(client)
    )
    assert bad.status_code == 422
