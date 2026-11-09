"""P92: ePerolehan work goes first and only to the person's OWN linked PC.

- GET /api/devices/my-pc-status says, before work starts, whether that PC is ready, and the
  next step in plain words (link it, turn it on, press Allow, update the app, resume it).
- An online PC that has not allowed the site gets the Allow request by itself (and again on
  "Send the request again"); an offline one is asked when it connects.
- Whatever Web connections says (server, proxies), a person's ePerolehan work never leaves
  from another computer, the proxies or this server's address: it is refused with why.
  Only the office's own work (no person) follows the workspace's choice.
- A web task on ePerolehan does not start until the person's PC is ready.
- Linking needs no AI twin first: the computer belongs to the person.
"""

import asyncio

import httpx
from sqlalchemy import select

from agentic.agents.tools import TOOLS, ToolContext
from agentic.core.db import SessionLocal
from agentic.core.valkey import valkey
from agentic.devices import bridge, tunnel
from agentic.devices.core import online_key
from agentic.models import Agent, Device, Task, Workspace

from .conftest import csrf
from .test_agents import llm, new_agent, office, temporal  # noqa: F401
from .test_devices import FakePC, ids_of, link, personal_agent
from .test_office_roles import as_role, member

EP = "eperolehan.gov.my"


async def status(c: httpx.AsyncClient, site: str = EP, **headers: str) -> dict:
    r = await c.get(f"/api/devices/my-pc-status?site={site}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


async def until(pred, tries: int = 80) -> bool:
    for _ in range(tries):
        if await pred():
            return True
        await asyncio.sleep(0.05)
    return False


def asks(pc: FakePC) -> list[dict]:
    return [m for m in pc.other if m.get("type") == "tunnel_ask"]


async def set_device(device_id: str, **fields) -> None:
    async with SessionLocal() as db:
        d = await db.get(Device, device_id)
        for k, v in fields.items():
            setattr(d, k, v)
        await db.commit()


async def test_status_walks_every_state_and_asks_the_persons_own_pc(client, llm, temporal):
    await office(client)
    owner_id, _ = await ids_of("owner@example.com")

    got = await status(client)
    assert got["state"] == "not_linked" and got["needed"] is True and got["device"] is None
    assert "Link your computer first" in got["next"]
    ms = await status(client, **{"x-lang": "ms"})
    assert ms["next"].startswith("Pautkan komputer anda dahulu")
    # A site that does not go through a PC needs nothing.
    other = await status(client, "example.com")
    assert other == {**other, "state": "ready", "needed": False}

    dev = await link(client, "Owner Laptop")
    got = await status(client)
    assert got["state"] == "offline" and got["device"]["name"] == "Owner Laptop"
    assert "Turn on Owner Laptop" in got["next"]
    # Remembered: when it connects it is asked for ePerolehan by itself.
    assert await tunnel.want_sites(owner_id) == [EP]

    pc = await FakePC(dev["token"]).start()  # an older app (0.2.0)
    try:
        assert await until(lambda: _true(asks(pc)))
        first = asks(pc)[0]
        assert first["hosts"] == [EP] and first.get("own") is True
        assert await until(lambda: _state_is(client, "needs_update"))
        got = await status(client)
        assert "older Agentic Office PC" in got["next"]

        # A current app that has not allowed it: asked by itself, at most once a minute.
        await set_device(dev["device_id"], version="0.5.1")
        await valkey().delete(f"devices:ask:{dev['device_id']}")
        pc.other.clear()
        got = await status(client)
        assert got["state"] == "not_allowed" and got["asked"] is True
        assert "press Allow" in got["next"]
        assert await until(lambda: _true(asks(pc)))
        ask = asks(pc)[0]
        assert ask["hosts"] == [EP] and ask["own"] is True and ask["by"]
        again = await status(client)
        assert again["state"] == "not_allowed" and again["asked"] is False  # not every poll
        # "Send the request again": now, then not twice within seconds.
        r = await client.post(
            "/api/devices/my-pc-status/ask", json={"site": EP}, headers=csrf(client)
        )
        assert r.status_code == 200 and r.json()["asked"] is True
        r = await client.post(
            "/api/devices/my-pc-status/ask", json={"site": EP}, headers=csrf(client)
        )
        assert r.json()["asked"] is False
        # Only sites that go through a computer can be asked for.
        await valkey().delete(f"devices:ask-again:{dev['device_id']}")
        r = await client.post(
            "/api/devices/my-pc-status/ask", json={"site": "example.com"}, headers=csrf(client)
        )
        assert r.json()["asked"] is False

        # Paused on the web: said so.
        r = await client.patch(
            f"/api/devices/{dev['device_id']}", json={"paused": True}, headers=csrf(client)
        )
        assert r.status_code == 200
        assert (await status(client))["state"] == "paused"
        await client.patch(
            f"/api/devices/{dev['device_id']}", json={"paused": False}, headers=csrf(client)
        )

        # Allow pressed on the PC: ready, and nothing more to ask.
        await pc.ws.send_json({"type": "state", "tunnel": {"on": True, "hosts": [EP]}})
        assert await until(lambda: _state_is(client, "ready"))
        got = await status(client)
        assert got["device"]["id"] == dev["device_id"] and "is ready" in got["next"]
    finally:
        await pc.stop()
    assert await until(lambda: _state_is(client, "offline"))


async def _true(x) -> bool:
    return bool(x)


async def _state_is(c: httpx.AsyncClient, state: str) -> bool:
    return (await status(c))["state"] == state


async def _pcs(o: dict) -> tuple[str, str, str, str, str]:
    """Owner and Aina, each with their own online PC that allowed ePerolehan."""
    owner_id, ws_id = await ids_of("owner@example.com")
    aina_id, _ = await ids_of("aina@example.com")
    async with SessionLocal() as db:
        mine = Device(workspace_id=ws_id, user_id=owner_id, name="Owner PC", token_hash="h-o",
                      tunnel_hosts=[EP], version="0.5.1")  # fmt: skip
        hers = Device(workspace_id=ws_id, user_id=aina_id, name="Aina PC", token_hash="h-a",
                      tunnel_hosts=[EP], version="0.5.1")  # fmt: skip
        db.add_all([mine, hers])
        await db.commit()
        ids = mine.id, hers.id
    for d in ids:
        await valkey().set(online_key(d), "1", ex=60)
    return ws_id, owner_id, aina_id, *ids


async def test_a_persons_eperolehan_work_uses_their_own_pc_whatever_was_chosen(
    client, llm, temporal
):
    o = await office(client)
    await member(client, "aina@example.com", "staff", branch_id=o["branch"]["id"])
    ws_id, owner_id, aina_id, mine_id, hers_id = await _pcs(o)
    twin = await personal_agent(o, owner_id, ws_id, is_twin=True)
    async with SessionLocal() as db:
        shared = Agent(workspace_id=ws_id, branch_id=o["branch"]["id"], slug="tender-clerk",
                       name="Tender Clerk", role="Tenders")  # fmt: skip
        db.add(shared)
        await db.commit()
        shared_id = shared.id

    # The owner chose "browse from this server": a person's ePerolehan work still goes
    # through their own PC; the office's own work (no person) follows the choice.
    r = await client.put("/api/org/web", json={"mode": "server", "sites": []}, headers=csrf(client))
    assert r.status_code == 200, r.text
    r1 = await tunnel.route(ws_id, "www.eperolehan.gov.my", twin.id)
    assert (r1.kind, r1.device_id, r1.own) == ("computer", mine_id, True)
    await tunnel.remember_person(shared_id, aina_id)
    r2 = await tunnel.route(ws_id, "www.eperolehan.gov.my", shared_id)
    assert (r2.kind, r2.device_id) == ("computer", hers_id)
    await tunnel.remember_person(shared_id, None)
    assert (await tunnel.route(ws_id, "www.eperolehan.gov.my", shared_id)).kind == "server"
    assert (await tunnel.route(ws_id, "example.com", twin.id)).kind == "server"
    async with SessionLocal() as db:
        assert await tunnel.screen_for(db, ws_id, [EP], aina_id) == (hers_id, "")
        assert await tunnel.screen_for(db, ws_id, [EP], None) == ("", "")  # office: the server

    # Proxies for every site: the same. Never the proxies for a person's ePerolehan work.
    r = await client.put(
        "/api/org/web",
        json={"mode": "proxy", "sites": ["*"], "proxy_list": "127.0.0.1:9:u:p"},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    assert (await tunnel.route(ws_id, "www.eperolehan.gov.my", twin.id)).device_id == mine_id
    assert (await tunnel.route(ws_id, "www.eperolehan.gov.my", "")).kind == "proxy"
    assert (await tunnel.route(ws_id, "news.example.com", twin.id)).kind == "proxy"

    # Aina's PC is off: refused by name with where to go, never another PC or way.
    await valkey().delete(online_key(hers_id))
    await tunnel.remember_person(shared_id, aina_id)
    r3 = await tunnel.route(ws_id, "www.eperolehan.gov.my", shared_id)
    assert r3.kind == "refuse" and r3.own and "Aina PC" in r3.why and "offline" in r3.why
    assert "/computers" in r3.why
    async with SessionLocal() as db:
        dev, why = await tunnel.screen_for(db, ws_id, [EP], aina_id)
    assert dev == "" and "offline" in why
    # Unlinked: told to link their own, about two minutes.
    await set_device(hers_id, revoked_at=tunnel.core.now())
    r4 = await tunnel.route(ws_id, "www.eperolehan.gov.my", shared_id)
    assert r4.kind == "refuse" and "no computer linked" in r4.why and "My computers" in r4.why
    why, own = await tunnel.refusal(ws_id, "www.eperolehan.gov.my", shared_id)
    assert own and "no computer linked" in why
    # The office's own work with nothing chosen: the old rule, its error points to My computers.
    async with SessionLocal() as db:
        ws = await db.get(Workspace, ws_id)
        ws.settings = {**(ws.settings or {}), "web_route": {"mode": "pc", "sites": [EP]},
                       "pc_tunnel": {"on": True, "device_id": "", "hosts": [EP]}}  # fmt: skip
        await db.commit()
    await set_device(mine_id, tunnel_hosts=[])
    r5 = await tunnel.route(ws_id, "www.eperolehan.gov.my", "")
    assert r5.kind == "refuse" and not r5.own and "My computers" in r5.why


async def test_an_online_pc_is_asked_by_itself_when_work_needs_it(client, llm, temporal):
    """The gateway (an agent's page) finds the person's PC online but not allowed: the Allow
    request goes to THAT PC, with no owner involved."""
    o = await office(client)
    owner_id, ws_id = await ids_of("owner@example.com")
    twin = await personal_agent(o, owner_id, ws_id, is_twin=True)
    dev = await link(client)
    pc = await FakePC(dev["token"]).start()
    try:
        await set_device(dev["device_id"], version="0.5.1")
        await until(lambda: _state_is(client, "not_allowed"))
        await valkey().delete(f"devices:ask:{dev['device_id']}")
        pc.other.clear()
        r = await tunnel.route(ws_id, "www.eperolehan.gov.my", twin.id)
        assert r.kind == "refuse" and "request was sent" in r.why
        assert await until(lambda: _true(asks(pc)))
        assert asks(pc)[0] == {**asks(pc)[0], "hosts": [EP], "own": True}

        # From the worker (another process): through the API's internal endpoint.
        from agentic.api.main import app

        bridge.serve_here(False)
        bridge.use_transport(httpx.ASGITransport(app=app))
        try:
            pc.other.clear()
            assert await bridge.ask_sites(dev["device_id"], [EP], "Owner", own=True) is True
            assert await until(lambda: _true(asks(pc)))
        finally:
            bridge.serve_here(True)
            bridge.use_transport(None)
    finally:
        await pc.stop()


async def test_the_internal_ask_needs_its_token(client):
    from agentic.api.main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        r = await c.post("/internal/devices/dv_x/ask", json={"hosts": [EP]})
    assert r.status_code == 403


async def test_a_web_task_on_eperolehan_waits_for_the_persons_pc(
    client, llm, temporal, monkeypatch
):
    from agentic.api.routers import web_tasks

    async def no_dns(url: str) -> None:
        return None

    monkeypatch.setattr(web_tasks, "guard_url", no_dns)
    o = await office(client)
    rafi = await new_agent(client, o, "Rafi", "Operations")
    body = {
        "url": "https://www.eperolehan.gov.my/",
        "instructions": "Prepare tender QT26000000001",
        "mode": "tender",
    }
    r = await client.post(f"/api/agents/{rafi['id']}/web-task", json=body, headers=csrf(client))
    assert r.status_code == 409 and r.json()["code"] == "pc_not_ready"
    assert "Link your computer first" in r.json()["message"]
    r = await client.post(
        f"/api/agents/{rafi['id']}/web-task", json=body, headers={**csrf(client), "x-lang": "ms"}
    )
    assert "Pautkan komputer anda dahulu" in r.json()["message"]
    async with SessionLocal() as db:
        assert (await db.scalars(select(Task).where(Task.title.like("%QT26%")))).all() == []

    owner_id, ws_id = await ids_of("owner@example.com")
    async with SessionLocal() as db:
        d = Device(workspace_id=ws_id, user_id=owner_id, name="Owner PC", token_hash="h-x",
                   tunnel_hosts=[EP], version="0.5.1")  # fmt: skip
        db.add(d)
        await db.commit()
        dev_id = d.id
    await valkey().set(online_key(dev_id), "1", ex=60)
    r = await client.post(f"/api/agents/{rafi['id']}/web-task", json=body, headers=csrf(client))
    assert r.status_code == 201, r.text
    assert "tender" in r.json()["labels"]


async def test_the_agent_tells_the_person_where_to_link(client, llm, temporal, monkeypatch):
    """A shared agent opening ePerolehan for someone with no PC gets the plain reason and the
    My computers link to pass on, never another way round."""
    from agentic.agents import browser_tools

    async def no_dns(url: str) -> None:
        return None

    monkeypatch.setattr(browser_tools, "guard_url", no_dns)
    o = await office(client)
    a = await new_agent(client, o, "Tina", "Operations", tools={"browser_open": "allow"})
    r = await client.post(
        "/api/tasks",
        json={"title": "Check QT1", "brief": "Check it", "assignee_agent_id": a["id"]},
        headers=csrf(client),
    )
    task_id = r.json()["id"]
    async with SessionLocal() as db:
        agent = await db.get(Agent, a["id"])
        ctx = ToolContext(
            db=db,
            agent=agent,
            workspace=await db.get(Workspace, agent.workspace_id),
            task=await db.get(Task, task_id),
        )
        out = await TOOLS["browser_open"].handler(ctx, {"url": "https://www.eperolehan.gov.my/"})
    assert out.startswith("Error: www.eperolehan.gov.my cannot be opened right now")
    assert "no computer linked" in out and "My computers (" in out and "/computers" in out
    assert "do not try another way" in out


async def test_linking_needs_no_ai_twin(client, llm, temporal):
    o = await office(client)
    staff = await as_role(client, "aina@example.com", "staff", branch_id=o["branch"]["id"])
    viewer = await as_role(client, "vera@example.com", "viewer")
    try:
        r = await staff.post("/api/devices/link-code", json={}, headers=csrf(staff))
        assert r.status_code == 201, r.text  # no twin needed
        r = await viewer.post(
            "/api/devices/link-code", json={}, headers={**csrf(viewer), "x-lang": "ms"}
        )
        assert r.status_code == 403 and r.json()["code"] == "no_personal_ai"
        assert r.json()["message"].startswith("Peranan anda")
        got = await status(staff)
        assert got["state"] == "not_linked"
    finally:
        await staff.aclose()
        await viewer.aclose()
