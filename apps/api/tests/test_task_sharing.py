"""P26: a manager or owner chooses who else may look at a task they give: only the people who
already see it (private), its department, its company or everyone. Shared tasks are read only:
on the board and opened, without the agent's transcript or approvals, and never changeable."""

from .conftest import csrf
from .test_agents import llm, new_agent, office, temporal  # noqa: F401
from .test_office_roles import as_role
from .test_twins import ANSWERS

JSON = {"content-type": "application/json"}


async def test_managers_share_tasks_read_only(client, llm, temporal):
    o = await office(client)
    nadia = await new_agent(client, o, "Nadia", "Finance")
    finance = await as_role(
        client,
        "siti@example.com",
        "staff",
        branch_id=o["branch"]["id"],
        department_id=o["depts"]["Finance"],
    )
    ops = await as_role(
        client,
        "amir@example.com",
        "staff",
        branch_id=o["branch"]["id"],
        department_id=o["depts"]["Operations"],
    )
    other = (
        await client.post("/api/branches", json={"name": "Jaya Bhd"}, headers=csrf(client))
    ).json()
    far = await as_role(client, "lim@example.com", "staff", branch_id=other["id"])
    try:
        t = (
            await client.post(
                "/api/tasks",
                json={"title": "Disciplinary case", "assignee_agent_id": nadia["id"]},
                headers=csrf(client),
            )
        ).json()
        assert t["visibility"] == "private"

        async def sees(c) -> bool:
            listed = t["id"] in {x["id"] for x in (await c.get("/api/tasks")).json()}
            opened = (await c.get(f"/api/tasks/{t['id']}")).status_code == 200
            assert listed == opened
            return listed

        assert [await sees(c) for c in (finance, ops, far)] == [False, False, False]

        async def share(v: str) -> None:
            r = await client.patch(
                f"/api/tasks/{t['id']}", json={"visibility": v}, headers=csrf(client)
            )
            assert r.status_code == 200 and r.json()["visibility"] == v

        await share("department")
        assert [await sees(c) for c in (finance, ops, far)] == [True, False, False]
        await share("company")
        assert [await sees(c) for c in (finance, ops, far)] == [True, True, False]
        await share("everyone")
        assert [await sees(c) for c in (finance, ops, far)] == [True, True, True]

        # Read only: no transcript or approvals, and nothing can be changed.
        d = (await finance.get(f"/api/tasks/{t['id']}")).json()
        assert d["read_only"] is True and d["transcript"] == [] and d["approvals"] == []
        r = await finance.patch(
            f"/api/tasks/{t['id']}", json={"title": "Mine now"}, headers=csrf(finance)
        )
        assert r.status_code == 404
        r = await finance.post(f"/api/tasks/{t['id']}/start", headers={**JSON, **csrf(finance)})
        assert r.status_code == 404
        # A shared task can be pinned to the viewer's workspace.
        r = await finance.post(
            "/api/desk/items", json={"kind": "task", "ref": t["id"]}, headers=csrf(finance)
        )
        assert r.status_code == 201, r.text
        # The owner's own view is the full one.
        assert (await client.get(f"/api/tasks/{t['id']}")).json()["read_only"] is False

        # Only managers and owners share.
        twin = (
            await finance.post(
                "/api/me/twin",
                json=ANSWERS,
                headers=csrf(finance),
            )
        ).json()["twin"]
        r = await finance.post(
            "/api/tasks",
            json={"title": "Mine", "assignee_agent_id": twin["id"], "visibility": "company"},
            headers=csrf(finance),
        )
        assert r.status_code == 403 and r.json()["code"] == "cannot_share"
        r = await finance.post(
            "/api/tasks",
            json={"title": "Mine", "assignee_agent_id": twin["id"]},
            headers=csrf(finance),
        )
        assert r.status_code == 201
        r = await finance.patch(
            f"/api/tasks/{r.json()['id']}", json={"visibility": "everyone"}, headers=csrf(finance)
        )
        assert r.status_code == 403
    finally:
        for c in (finance, ops, far):
            await c.aclose()
