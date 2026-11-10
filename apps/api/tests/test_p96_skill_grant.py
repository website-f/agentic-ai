"""P96: work gets the office skill it needs, by itself (agents/skill_grant.py).

A management or HR user's own new agent gets the skill (and the tools its steps need) the
moment work reaches it; staff cannot change a team agent this way; another person's private
assistant is never changed; a skill learned on one agent's work reaches a colleague in the
same company, never an isolated company's agents. Synthetic people only (example.com).
"""

import uuid

import pytest
from sqlalchemy import select

from agentic.agents import runtime, skill_grant
from agentic.brain import embed
from agentic.core.db import SessionLocal
from agentic.models import Agent, AuditLog, Skill, Task, TaskEvent, User

from .conftest import csrf
from .test_agents import llm, new_agent, office, temporal  # noqa: F401
from .test_office_roles import as_role

ONBOARD = (
    "Prepare the staff onboarding file for our new hire: the appointment letter, the "
    "documents to collect and a tidy staff file."
)


async def _skill(name: str) -> Skill:
    async with SessionLocal() as db:
        s = await db.scalar(select(Skill).where(Skill.name == name))
        assert s is not None, name
        return s


async def _limit(owner, name: str, agent_ids: list[str]) -> Skill:
    """The owner limits a skill to some agents (Skills page: who uses it)."""
    await owner.get("/api/skills")  # the built-in skills are in place
    s = await _skill(name)
    r = await owner.patch(f"/api/skills/{s.id}", json={"agent_ids": agent_ids}, headers=csrf(owner))
    assert r.status_code == 200, r.text
    return await _skill(name)


async def _agent(agent_id: str) -> Agent:
    async with SessionLocal() as db:
        a = await db.get(Agent, agent_id)
        assert a is not None
        return a


async def _events(task_id: str) -> list[TaskEvent]:
    async with SessionLocal() as db:
        return list(
            (
                await db.scalars(
                    select(TaskEvent)
                    .where(TaskEvent.task_id == task_id, TaskEvent.kind == "skill")
                    .order_by(TaskEvent.id)
                )
            ).all()
        )


async def _uid(email: str) -> str:
    async with SessionLocal() as db:
        return (await db.scalar(select(User.id).where(User.email == email))) or ""


async def _task(c, agent_id: str, title: str, brief: str = "") -> dict:
    r = await c.post(
        "/api/tasks",
        json={"title": title, "brief": brief, "assignee_agent_id": agent_id, "start": True},
        headers=csrf(c),
    )
    assert r.status_code == 201, r.text
    return r.json()


# ---------------------------------------------------------------- management: ePerolehan


async def test_a_management_users_new_agent_gets_the_eperolehan_skill_and_the_browser(
    client, llm, temporal
):
    o = await office(client)
    other = await new_agent(client, o, "Tender Desk", "Operations")
    # The office limited its tender skill to one agent; the new agent does not have it.
    await _limit(client, "eperolehan-tender", [other["id"]])
    mg = await as_role(client, "mg@example.com", "management")
    try:
        mine = await new_agent(mg, o, "Quotation Helper", "Finance")
        assert "browser_open" not in mine["tools"]
        t = await _task(mg, mine["id"], "Prepare quotation QT260123 on ePerolehan")
        assert temporal["start"], "the work started"
    finally:
        await mg.aclose()
    a = await _agent(mine["id"])
    assert a.tools["browser_open"] == "allow" and a.tools["browser_click"] == "allow"
    assert a.tools["browser_submit"] == "ask" and a.tools["browser_upload"] == "ask"
    skill = await _skill("eperolehan-tender")
    assert mine["id"] in skill.agent_ids and other["id"] in skill.agent_ids
    async with SessionLocal() as db:
        task = await db.get(Task, t["id"])
        assert task is not None and "the office's skill eperolehan-tender (" in task.brief
        audits = (
            await db.scalars(select(AuditLog).where(AuditLog.action == "skill.agents_changed"))
        ).all()
    mg_id = await _uid("mg@example.com")
    assert any(x.actor == f"user:{mg_id}" and x.target == skill.id for x in audits)
    ev = await _events(t["id"])
    assert [e.text for e in ev] == [
        "Quotation Helper was given the office's skill eperolehan-tender for this work."
    ]


# ---------------------------------------------------------------- HR: an HR skill


async def test_an_hr_users_agent_gets_an_hr_skill_from_a_task_and_from_chat(client, llm, temporal):
    o = await office(client)
    keeper = await new_agent(client, o, "Records Keeper", "Management")
    await _limit(client, "staff-onboarding-file", [keeper["id"]])
    hr = await as_role(client, "hr@example.com", "hr")
    try:
        mine = await new_agent(hr, o, "People Helper", "Management")
        t = await _task(hr, mine["id"], "Onboard our new hire", ONBOARD)
        skill = await _skill("staff-onboarding-file")
        assert mine["id"] in skill.agent_ids
        ev = await _events(t["id"])
        assert len(ev) == 1 and "staff-onboarding-file" in ev[0].text
        async with SessionLocal() as db:
            task = await db.get(Task, t["id"])
            assert "use_skill(name='staff-onboarding-file')" in task.brief
        # The run's first step does not give it twice nor say it again.
        llm.say("Done.")
        await runtime.run_task_step(t["id"])
        assert len(await _events(t["id"])) == 1
        assert (await _skill("staff-onboarding-file")).agent_ids.count(mine["id"]) == 1

        # In chat: another HR agent, the same kind of request.
        chat_agent = await new_agent(hr, o, "HR Desk", "Management")
        llm.say("I will prepare it.")
        r = await hr.post(
            f"/api/agents/{chat_agent['id']}/chat", json={"message": ONBOARD}, headers=csrf(hr)
        )
        assert r.status_code == 200, r.text
        assert chat_agent["id"] in (await _skill("staff-onboarding-file")).agent_ids
        sent = "\n".join(str(m.get("content") or "") for m in llm.requests[-1]["messages"])
        assert "You now have the office's skill staff-onboarding-file" in sent
    finally:
        await hr.aclose()


# ---------------------------------------------------------------- who may not


async def test_staff_cannot_give_a_team_agent_or_their_twin_what_a_manager_decides(
    client, llm, temporal
):
    o = await office(client)
    a, fin = o["branch"]["id"], o["depts"]["Finance"]
    team = await new_agent(client, o, "Team Finance", "Finance")
    keeper = await new_agent(client, o, "Records Keeper", "Management")
    await _limit(client, "staff-onboarding-file", [keeper["id"]])
    await as_role(client, "hod@example.com", "hod", department_id=fin)  # manages Finance
    staff = await as_role(client, "s@example.com", "staff", branch_id=a, department_id=fin)
    staff_id = await _uid("s@example.com")
    try:
        r = await staff.post(
            "/api/agents", json={"branch_id": a, "name": "My Twin", "role": "Clerk"},
            headers=csrf(staff),
        )  # fmt: skip
        twin = r.json()
        assert r.status_code == 201 and twin["is_twin"]
        # A team agent: staff may not change it, so nothing is given.
        async with SessionLocal() as db:
            ag = await db.get(Agent, team["id"])
            sk = await db.get(Skill, (await _skill("staff-onboarding-file")).id)
            out = await skill_grant.give(db, ag, staff_id, [sk], "test")
            await db.commit()
        assert out.given == [] and len(out.refused) == 1
        assert team["id"] not in (await _skill("staff-onboarding-file")).agent_ids
        # Their own twin: the work starts, the skill is not given (publishing a limited skill
        # is a manager's), and they are told plainly who can.
        t = await _task(staff, twin["id"], "Onboard our new hire", ONBOARD)
        assert twin["id"] not in (await _skill("staff-onboarding-file")).agent_ids
        ev = await _events(t["id"])
        assert len(ev) == 1
        text = ev[0].text
        assert text.startswith("My Twin doesn't have the office's skill staff-onboarding-file")
        # Who can: the owner; not the Finance HOD (the skill reaches an agent outside their
        # department, so widening it is not theirs), never the person asking.
        assert "Ask Owner One to give it" in text
    finally:
        await staff.aclose()

    # A browser skill open to everyone: a twin's tools are its managers' to switch on.
    async with SessionLocal() as db:
        db.add(
            Skill(
                workspace_id=(await db.get(Agent, team["id"])).workspace_id,
                name="leave-portal-check",
                description="Check a staff member's leave balance on the leave portal website.",
                body="## When to use\nLeave balance.\n\n## Steps\n1. browser_open the leave "
                "portal.\n2. browser_read the balance.\n",
                created_by="user:x",
                embedding=await embed.embed_one("leave-portal-check: leave balance portal"),
            )
        )
        await db.commit()
        tw = await db.get(Agent, twin["id"])
        sk = await db.scalar(select(Skill).where(Skill.name == "leave-portal-check"))
        out = await skill_grant.give(db, tw, staff_id, [sk], "test")
        assert out.given == [] and "Hod" in out.refused[0]
        assert "browser_open" not in (tw.tools or {})
        out = await skill_grant.give(db, tw, await _uid("hod@example.com"), [sk], "test")
        await db.commit()
        assert out.given == ["leave-portal-check"] and tw.tools["browser_open"] == "allow"


async def test_a_skill_is_never_given_to_another_persons_private_assistant(client, llm, temporal):
    o = await office(client)
    keeper = await new_agent(client, o, "Records Keeper", "Management")
    sk = await _limit(client, "staff-onboarding-file", [keeper["id"]])
    adm = await as_role(client, "adm@example.com", "admin")
    mg = await as_role(client, "mg@example.com", "management")
    await adm.aclose()
    adm_id, mg_id = await _uid("adm@example.com"), await _uid("mg@example.com")
    async with SessionLocal() as db:
        pa = Agent(
            workspace_id=sk.workspace_id,
            branch_id=o["branch"]["id"],
            slug=f"pa-{uuid.uuid4().hex[:6]}",
            name="Adm's Assistant",
            role="Assistant",
            private=True,
            owner_user_id=adm_id,
        )
        db.add(pa)
        await db.commit()
        pa_id = pa.id
    try:
        # Management manages the whole workspace, but not someone's private assistant: it
        # cannot even be given work, and a skill grant for it is refused.
        r = await mg.post(
            "/api/tasks",
            json={"title": "Onboard", "brief": ONBOARD, "assignee_agent_id": pa_id},
            headers=csrf(mg),
        )
        assert r.status_code == 400
    finally:
        await mg.aclose()
    async with SessionLocal() as db:
        pa = await db.get(Agent, pa_id)
        skill = await db.get(Skill, sk.id)
        out = await skill_grant.give(db, pa, mg_id, [skill], "test")
        await db.commit()
        assert out.given == [] and out.refused
        assert pa_id not in (await db.get(Skill, sk.id)).agent_ids
        # Work some routine of the management user made for it: still nothing given.
        t = Task(
            workspace_id=sk.workspace_id,
            title="Onboard our new hire",
            brief=ONBOARD,
            created_by=f"user:{mg_id}",
            assignee_agent_id=pa_id,
        )
        db.add(t)
        await db.commit()
        await skill_grant.for_task(db, t, pa)
        assert pa_id not in (await db.get(Skill, sk.id)).agent_ids
        # Its own person gives it work: it gets the skill.
        out = await skill_grant.give(db, pa, adm_id, [await db.get(Skill, sk.id)], "test")
        await db.commit()
        assert out.given == ["staff-onboarding-file"]


# ---------------------------------------------------------------- learned skills


@pytest.mark.parametrize("isolated", [False, True])
async def test_a_learned_skill_reaches_a_colleague_but_never_an_isolated_company(
    client, llm, temporal, isolated
):
    o = await office(client)
    r = await client.post(
        "/api/branches", json={"name": "Jaya Bhd", "isolated": True}, headers=csrf(client)
    )
    b2 = r.json()
    b2_fin = {d["name"]: d["id"] for d in b2["departments"]}["Finance"]
    learner = await new_agent(client, o, "Faiz", "Finance")
    colleague = await new_agent(client, o, "Aina", "Finance")
    far = (
        await client.post(
            "/api/agents",
            json={"branch_id": b2["id"], "department_id": b2_fin, "name": "Far", "role": "Clerk"},
            headers=csrf(client),
        )
    ).json()
    home = far if isolated else learner  # where the skill was learned
    name, desc = (
        "supplier-statement-reconcile",
        "Reconcile a supplier statement against our ledger and list every difference.",
    )
    async with SessionLocal() as db:
        db.add(
            Skill(
                workspace_id=(await db.get(Agent, learner["id"])).workspace_id,
                branch_id=b2["id"] if isolated else None,  # an isolated company's stay there
                name=name,
                description=desc,
                body="## When to use\nA supplier statement.\n\n## Steps\n1. read_file it.\n",
                created_by=f"agent:{home['id']}",
                source_task_id="tk_learned",
                agent_ids=[home["id"]],
                embedding=await embed.embed_one(f"{name}: {desc}"),
            )
        )
        await db.commit()
    t = await _task(
        client, colleague["id"], "Reconcile the supplier statement", "Reconcile the supplier "
        "statement against our ledger for October and list every difference."
    )  # fmt: skip
    got = (await _skill(name)).agent_ids
    if isolated:
        assert colleague["id"] not in got and await _events(t["id"]) == []
    else:
        assert colleague["id"] in got
        assert "Aina was given the office's skill supplier-statement-reconcile" in (
            (await _events(t["id"]))[0].text
        )


async def test_matching_is_cheap_and_ignores_small_talk(client, llm, temporal):
    o = await office(client)
    ag = await new_agent(client, o, "Faiz", "Finance")
    await client.get("/api/skills")
    async with SessionLocal() as db:
        a = await db.get(Agent, ag["id"])
        assert await skill_grant.for_chat(db, a, "nobody", "ok thanks") == ""
        found = await skill_grant.match(db, a, ONBOARD)
        assert [s.name for s in found][:1] == ["staff-onboarding-file"]
        found = await skill_grant.match(db, a, "Prepare quotation QT260123 on ePerolehan")
        assert found[0].name == "eperolehan-tender"
        assert await skill_grant.match(db, a, "   ") == []
