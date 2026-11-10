"""P94: a linked PC that says online really is, a call waits for one coming back, and
ePerolehan work gets the browser by itself on every way work reaches an agent.

- Online is the API's live socket (hub), not a Valkey flag that outlives a restart; flags from
  an earlier API process are dropped at startup and ignored by other processes.
- A computer connected moments ago is "reconnecting": a call waits for it (no polling) and
  goes through when it is back; after the wait it fails with what the person should do.
- An older PC app is told an update is available (welcome, My computers).
- Work about ePerolehan (Give a task, chat, an agent lining work up, a routine's run) gives the
  agent tender mode's browser tools with an audit entry when the person may manage the agent;
  otherwise it does not start and the person is told plainly. Submit and upload stay "ask".
"""

import asyncio
import re
from datetime import timedelta
from pathlib import Path

import httpx
import pytest
from sqlalchemy import select

from agentic.agents import browser_grant, runtime
from agentic.api.routers.web_tasks import TENDER
from agentic.core.config import settings
from agentic.core.db import SessionLocal
from agentic.core.valkey import valkey
from agentic.devices import bridge, core, hub
from agentic.devices.core import DeviceError
from agentic.models import Agent, AuditLog, ChatSession, Device, Schedule, SkillUse, Task

from .conftest import csrf
from .test_agents import llm, new_agent, office, temporal  # noqa: F401
from .test_devices import FakePC, fake_offline, fake_online, ids_of, link
from .test_office_roles import as_role


@pytest.fixture(autouse=True)
def _portal_dns(monkeypatch):
    """P96: the portal's address is looked up for the web-task form; a real DNS lookup failed
    once under load in the full suite, so these tests answer it themselves."""
    from agentic.core import ssrf

    real = ssrf._resolve

    async def resolve(host: str, port: int) -> list[str]:
        if host == "eperolehan.gov.my" or host.endswith(".eperolehan.gov.my"):
            return ["175.136.1.10"]
        return await real(host, port)

    monkeypatch.setattr(ssrf, "_resolve", resolve)


EP_BRIEF = "Open https://www.eperolehan.gov.my and check quotation QT260123 for Maju Sdn Bhd."


# ---------------------------------------------------------------- online is the socket


async def test_online_is_the_live_socket_and_stale_flags_are_dropped(client, llm, temporal):
    await office(client)
    dev = await link(client, "Work laptop")
    did = dev["device_id"]
    # A flag left by the API process before a restart: no socket here, so not online.
    await valkey().set(core.online_key(did), '{"conn": "x", "boot": "old"}', ex=90)
    assert await core.online_ids([did]) == set()
    rows = (await client.get("/api/devices")).json()
    assert rows[0]["online"] is False

    # Another process (the worker) reads the flags: one from an older boot does not count.
    core.use_local_online(None)
    try:
        await valkey().set(core.BOOT_KEY, core.BOOT)
        assert await core.online_ids([did]) == set()
        await valkey().set(core.online_key(did), f'{{"conn": "y", "boot": "{core.BOOT}"}}')
        assert await core.online_ids([did]) == {did}
        # The API starting again drops every flag at once.
        await valkey().set(core.online_key("other"), "1")
        assert await core.at_startup() == 2
        assert await valkey().exists(core.online_key(did)) == 0
        assert await valkey().get(core.BOOT_KEY) == core.BOOT
    finally:
        bridge.serve_here(True)

    # A real connection: online, everywhere the page looks.
    pc = await FakePC(dev["token"]).start()
    try:
        assert pc.welcome["type"] == "welcome"
        assert await core.online_ids([did]) == {did}
        rows = (await client.get("/api/devices")).json()
        assert rows[0]["online"] is True and rows[0]["reconnecting"] is False
    finally:
        await pc.stop()
    await asyncio.sleep(0.05)
    # Gone a moment ago: offline, but shown as reconnecting; long gone: plainly offline.
    rows = (await client.get("/api/devices")).json()
    assert rows[0]["online"] is False and rows[0]["reconnecting"] is True
    async with SessionLocal() as db:
        d = await db.get(Device, did)
        d.last_seen_at -= timedelta(minutes=10)
        await db.commit()
    rows = (await client.get("/api/devices")).json()
    assert rows[0]["online"] is False and rows[0]["reconnecting"] is False


async def test_an_older_app_is_told_an_update_is_available(client, llm, temporal):
    """FakePC says it is 0.2.0: the welcome and My computers offer the new app."""
    await office(client)
    dev = await link(client)
    pc = await FakePC(dev["token"]).start()
    try:
        assert pc.welcome["latest"] == core.AGENT_VERSION
        assert pc.welcome["update"]["version"] == core.AGENT_VERSION
        assert pc.welcome["update"]["url"].endswith(("/api/install/update/exe", "/computers"))
        row = (await client.get("/api/devices")).json()[0]
        assert row["update_available"] is True and row["latest_version"] == core.AGENT_VERSION
    finally:
        await pc.stop()
    assert core.update_available("0.5.1") and not core.update_available(core.AGENT_VERSION)
    assert not core.update_available("") and not core.update_available("9.0.0")


def test_the_server_knows_the_pc_apps_version():
    """core.AGENT_VERSION is the VERSION of the agent.cjs this repo ships."""
    src = Path(__file__).resolve().parents[2] / "pc-agent" / "agent.cjs"
    m = re.search(r'^const VERSION = "([^"]+)";', src.read_text(encoding="utf-8"), re.M)
    assert m is not None and m.group(1) == core.AGENT_VERSION


# ---------------------------------------------------------------- calls wait for it


async def test_a_call_waits_for_a_reconnecting_pc(client, llm, temporal, monkeypatch):
    monkeypatch.setattr(settings, "device_reconnect_wait", 5.0)
    await office(client)
    dev = await link(client, "Work laptop")
    did = dev["device_id"]
    pc = await FakePC(dev["token"], {"C:\\Users\\aina\\Documents\\a.txt": b"hi"}).start()
    await pc.stop()  # the server restarted: the socket is gone, the PC is on its way back
    await asyncio.sleep(0.05)
    assert hub.connection(did) is None

    back: list[FakePC] = []

    async def reconnect_soon() -> None:
        await asyncio.sleep(0.4)
        back.append(await FakePC(dev["token"]).start())

    started = asyncio.get_running_loop().time()
    later = asyncio.create_task(reconnect_soon())
    try:
        data = await bridge.call(did, "files.list", {"folder": "C:\\Users\\aina\\Documents"}, 10)
        waited = asyncio.get_running_loop().time() - started
        assert isinstance(data, dict) and 0.3 < waited < 5
        assert back and back[0].calls[-1]["method"] == "files.list"
    finally:
        await later
        for p in back:
            await p.stop()


async def test_a_call_fails_plainly_after_the_wait(client, llm, temporal, monkeypatch):
    monkeypatch.setattr(settings, "device_reconnect_wait", 0.3)
    await office(client)
    dev = await link(client, "Work laptop")
    did = dev["device_id"]
    pc = await FakePC(dev["token"]).start()
    await pc.stop()
    await asyncio.sleep(0.05)
    started = asyncio.get_running_loop().time()
    try:
        await bridge.call(did, "files.list", {"folder": "C:\\x"}, 5)
        raise AssertionError("the call should fail")
    except DeviceError as e:
        assert e.code == "offline"
        assert "open Agentic Office PC" in e.message and "My computers" in e.message
        assert "the tool reports" not in e.message
    assert asyncio.get_running_loop().time() - started >= 0.25  # it waited first

    # Long gone (not seen for minutes): no wait, the same plain answer at once.
    async with SessionLocal() as db:
        d = await db.get(Device, did)
        d.last_seen_at -= timedelta(minutes=10)
        await db.commit()
    monkeypatch.setattr(settings, "device_reconnect_wait", 30.0)
    started = asyncio.get_running_loop().time()
    try:
        await bridge.call(did, "files.list", {"folder": "C:\\x"}, 5)
    except DeviceError as e:
        assert e.code == "offline"
    assert asyncio.get_running_loop().time() - started < 2


async def test_the_worker_waits_through_the_api_too(client, llm, temporal, monkeypatch):
    """From the worker (no sockets there): /internal/devices/{id}/wait and the call wait in
    the API process."""
    from agentic.api.main import app

    monkeypatch.setattr(settings, "device_reconnect_wait", 5.0)
    await office(client)
    dev = await link(client)
    did = dev["device_id"]
    pc = await FakePC(dev["token"]).start()
    await pc.stop()
    await asyncio.sleep(0.05)
    back: list[FakePC] = []

    async def reconnect_soon() -> None:
        await asyncio.sleep(0.3)
        back.append(await FakePC(dev["token"]).start())

    later = asyncio.create_task(reconnect_soon())
    bridge.serve_here(False)
    bridge.use_transport(httpx.ASGITransport(app=app))
    try:
        assert await bridge.wait_online(did, 5) is True
        assert await core.online_ids([did]) == {did}  # the flag this API process set
    finally:
        bridge.serve_here(True)
        bridge.use_transport(None)
        await later
        for p in back:
            await p.stop()


async def test_eperolehan_work_waits_for_the_persons_pc(client, llm, temporal, monkeypatch):
    """The browser start (screen_for -> person_computer) waits for a PC coming back instead
    of refusing it as offline."""
    from agentic.devices import tunnel

    monkeypatch.setattr(settings, "device_reconnect_wait", 5.0)
    await office(client)
    owner_id, ws_id = await ids_of("owner@example.com")
    dev = await link(client)
    did = dev["device_id"]
    async with SessionLocal() as db:
        d = await db.get(Device, did)
        d.tunnel_hosts, d.last_seen_at = ["eperolehan.gov.my"], core.now()
        await db.commit()
    async with SessionLocal() as db:
        state = await tunnel.person_state(db, ws_id, owner_id, ["eperolehan.gov.my"], ask=False)
    assert state.state == "reconnecting"

    async def online_soon() -> None:
        await asyncio.sleep(0.3)
        fake_online(did)
        hub._arrived(did)

    later = asyncio.create_task(online_soon())
    try:
        async with SessionLocal() as db:
            got = await tunnel.person_computer(db, ws_id, owner_id, ["eperolehan.gov.my"])
        assert got == (did, "")
    finally:
        await later
        fake_offline(did)


# ---------------------------------------------------------------- ePerolehan gets the browser


def test_the_browser_tools_are_tender_modes():
    assert set(browser_grant.BROWSER) == {t for t in TENDER if t.startswith("browser_")}
    assert set(browser_grant.GATED) == {"browser_submit", "browser_upload"}


def test_what_counts_as_eperolehan_work():
    yes = [
        "Check my inbox on ePerolehan",
        "log in to e-Perolehan and download the documents",
        "https://www.eperolehan.gov.my/home",
        "Prepare QT260123 for Maju",
    ]
    no = ["Write the tender proposal for the cleaning contract", "Sebut harga for paper", ""]
    assert all(browser_grant.about_text(t) for t in yes)
    assert not any(browser_grant.about_text(t) for t in no)


async def _audits(agent_id: str) -> list[AuditLog]:
    async with SessionLocal() as db:
        return list(
            (
                await db.scalars(
                    select(AuditLog).where(
                        AuditLog.target == agent_id, AuditLog.action == "agent.updated"
                    )
                )
            ).all()
        )


async def _tools(agent_id: str) -> dict:
    async with SessionLocal() as db:
        return dict((await db.get(Agent, agent_id)).tools or {})


async def test_give_a_task_grants_the_browser_with_an_audit(client, llm, temporal):
    o = await office(client)
    rafi = await new_agent(client, o, "Rafi", "Operations")
    r = await client.post(
        "/api/tasks",
        json={
            "title": "ePerolehan inbox",
            "brief": EP_BRIEF,
            "assignee_agent_id": rafi["id"],
            "start": True,
        },
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    assert temporal["start"]  # started
    tools = await _tools(rafi["id"])
    assert all(
        tools.get(t) == "allow"
        for t in browser_grant.BROWSER
        if t not in ("browser_submit", "browser_upload")
    )
    assert tools["browser_submit"] == "ask" and tools["browser_upload"] == "ask"
    assert "browser_login" not in tools  # no saved login for the portal
    assert not set(tools) - set(browser_grant.BROWSER)  # nothing beyond the browser
    audits = await _audits(rafi["id"])
    assert len(audits) == 1 and "ePerolehan" in (audits[0].note or "")
    assert audits[0].after["tools"]["browser_submit"] == "ask"
    async with SessionLocal() as db:
        t = await db.get(Task, r.json()["id"])
        assert "eperolehan-tender" in t.brief  # the skill and its pitfalls ride along
        assert await db.scalar(select(SkillUse.id).where(SkillUse.task_id == t.id))

    # A second task changes nothing more (no second audit, no second skill note).
    r = await client.post(
        "/api/tasks",
        json={
            "title": "ePerolehan again",
            "brief": EP_BRIEF,
            "assignee_agent_id": rafi["id"],
            "start": True,
        },
        headers=csrf(client),
    )
    assert r.status_code == 201 and len(await _audits(rafi["id"])) == 1


async def test_a_tool_set_by_a_person_is_left_alone(client, llm, temporal):
    o = await office(client)
    rafi = await new_agent(client, o, "Rafi", "Operations")
    async with SessionLocal() as db:
        a = await db.get(Agent, rafi["id"])
        a.tools = {"browser_type": "ask"}
        await db.commit()
    r = await client.post(
        "/api/tasks",
        json={
            "title": "Tender",
            "brief": "x",
            "labels": ["tender"],
            "assignee_agent_id": rafi["id"],
            "start": True,
        },
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    tools = await _tools(rafi["id"])
    assert tools["browser_type"] == "ask" and tools["browser_open"] == "allow"


async def test_someone_who_cannot_manage_the_agent_is_told_plainly(client, llm, temporal):
    o = await office(client)
    fina = await new_agent(client, o, "Fina", "Finance")
    sup = await as_role(
        client, "sup@example.com", "supervisor", department_id=o["depts"]["Finance"]
    )
    try:
        r = await sup.post(
            "/api/tasks",
            json={
                "title": "ePerolehan inbox",
                "brief": EP_BRIEF,
                "assignee_agent_id": fina["id"],
                "start": True,
            },
            headers=csrf(sup),
        )
        assert r.status_code == 409, r.text
        body = r.json()
        assert body["code"] == "no_browser"
        assert body["message"] == (
            "Fina can't use the browser yet; ask whoever manages Fina to allow it, or pick "
            "another agent."
        )
        # In Malay too.
        r = await sup.post(
            "/api/tasks",
            json={
                "title": "ePerolehan",
                "brief": EP_BRIEF,
                "assignee_agent_id": fina["id"],
                "start": True,
            },
            headers={**csrf(sup), "x-lang": "ms"},
        )
        assert r.status_code == 409 and "Fina" in r.json()["message"]
        assert "pelayar" in r.json()["message"]
    finally:
        await sup.aclose()
    assert not temporal["start"]  # never started without them
    assert await _audits(fina["id"]) == []
    assert "browser_open" not in await _tools(fina["id"])
    async with SessionLocal() as db:
        t = await db.scalar(select(Task).where(Task.title == "ePerolehan inbox"))
        assert t.status == "ready" and "can't use the browser yet" in (t.blocked_reason or "")


async def test_work_lined_up_by_an_agent_follows_the_person(client, llm, temporal):
    """An agent lining up ePerolehan work for a colleague: allowed for the person it is for
    (the owner here), refused for a supervisor's request on an agent they cannot change."""
    from agentic.agents import launch

    o = await office(client)
    rafi = await new_agent(client, o, "Rafi", "Operations")
    owner_id, ws_id = await ids_of("owner@example.com")
    async with SessionLocal() as db:
        t = Task(
            workspace_id=ws_id,
            title="Check ePerolehan",
            brief=EP_BRIEF,
            assignee_agent_id=rafi["id"],
            branch_id=o["branch"]["id"],
            created_by=f"user:{owner_id}",
            status="ready",
            position=0,
        )
        db.add(t)
        await db.commit()
        assert await launch.launch(db, t, f"agent:{rafi['id']}") is None
    assert (await _tools(rafi["id"]))["browser_open"] == "allow"
    assert (await _audits(rafi["id"]))[0].actor == f"user:{owner_id}"

    # Lined up for a supervisor who may not change Fina: not started, told plainly.
    fina = await new_agent(client, o, "Fina", "Finance")
    await as_role(client, "sup@example.com", "supervisor", department_id=o["depts"]["Finance"])
    sup_id, _ = await ids_of("sup@example.com")
    async with SessionLocal() as db:
        t2 = Task(
            workspace_id=ws_id,
            title="ePerolehan",
            brief=EP_BRIEF,
            assignee_agent_id=fina["id"],
            branch_id=o["branch"]["id"],
            created_by=f"user:{sup_id}",
            status="ready",
            position=0,
        )
        db.add(t2)
        await db.commit()
        try:
            await launch.launch(db, t2, f"agent:{rafi['id']}")
            raise AssertionError("should not start")
        except launch.LaunchError as e:
            assert e.code == "no_browser" and "Fina can't use the browser yet" in str(e.message)
    assert "browser_open" not in await _tools(fina["id"])

    # The office's own work (a mail rule; nobody gave it): runs as before, nothing given.
    async with SessionLocal() as db:
        t3 = Task(
            workspace_id=ws_id,
            title="ePerolehan notice",
            brief="A notice from ePerolehan arrived: file it.",
            assignee_agent_id=fina["id"],
            branch_id=o["branch"]["id"],
            created_by="system:mail",
            status="ready",
            position=0,
        )
        db.add(t3)
        await db.commit()
        assert await launch.launch(db, t3, "system:mail") is None
    assert "browser_open" not in await _tools(fina["id"])


async def test_a_routine_run_gets_the_browser_or_stops_plainly(client, llm, temporal):
    """A run that reached the agent without launch (a schedule's task) is checked on its first
    step: the person who made the schedule may manage the agent, so it is given."""
    o = await office(client)
    rafi = await new_agent(client, o, "Rafi", "Operations")
    owner_id, ws_id = await ids_of("owner@example.com")
    async with SessionLocal() as db:
        s = Schedule(
            workspace_id=ws_id,
            agent_id=rafi["id"],
            name="ePerolehan every morning",
            title="ePerolehan every morning",
            brief=EP_BRIEF,
            cron="0 9 * * *",
            created_by=f"user:{owner_id}",
        )
        db.add(s)
        await db.flush()
        t = Task(
            workspace_id=ws_id,
            title="ePerolehan every morning",
            brief=EP_BRIEF,
            assignee_agent_id=rafi["id"],
            branch_id=o["branch"]["id"],
            created_by=f"schedule:{s.id}",
            source="schedule",
            status="running",
            position=0,
        )
        db.add(t)
        await db.commit()
        tid = t.id
    llm.say("Done.")
    r = await runtime.run_task_step(tid)
    assert r.state != "failed", r.message
    assert (await _tools(rafi["id"]))["browser_open"] == "allow"

    # A routine a supervisor made, on an agent they may not change: it stops with the reason.
    fina = await new_agent(client, o, "Fina", "Finance")
    await as_role(client, "sup@example.com", "supervisor", department_id=o["depts"]["Finance"])
    sup_id, _ = await ids_of("sup@example.com")
    async with SessionLocal() as db:
        t2 = Task(
            workspace_id=ws_id,
            title="ePerolehan",
            brief=EP_BRIEF,
            assignee_agent_id=fina["id"],
            branch_id=o["branch"]["id"],
            created_by=f"user:{sup_id}",
            status="running",
            position=0,
        )
        db.add(t2)
        await db.commit()
        tid2 = t2.id
    r = await runtime.run_task_step(tid2)
    assert r.state == "failed" and "Fina can't use the browser yet" in (r.message or "")


async def test_chat_grants_or_the_agent_says_who_can(client, llm, temporal):
    o = await office(client)
    rafi = await new_agent(client, o, "Rafi", "Operations")
    llm.say("I can do that as a task.")
    r = await client.post(
        f"/api/agents/{rafi['id']}/chat",
        json={"message": "Can you check my ePerolehan inbox?"},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    tools = await _tools(rafi["id"])
    assert tools["browser_open"] == "allow" and tools["browser_submit"] == "ask"
    assert len(await _audits(rafi["id"])) == 1

    fina = await new_agent(client, o, "Fina", "Finance")
    sup = await as_role(
        client, "sup@example.com", "supervisor", department_id=o["depts"]["Finance"]
    )
    try:
        llm.say("Ask whoever manages me.")
        r = await sup.post(
            f"/api/agents/{fina['id']}/chat",
            json={"message": "Open e-Perolehan and read QT260123"},
            headers=csrf(sup),
        )
        assert r.status_code == 200, r.text
    finally:
        await sup.aclose()
    # The agent was told to say so, in those words.
    sent = llm.requests[-1]["messages"]
    assert any(
        "Fina can't use the browser yet; ask whoever manages Fina" in str(m.get("content"))
        for m in sent
    )
    assert "browser_open" not in await _tools(fina["id"])
    async with SessionLocal() as db:
        assert (await db.scalars(select(ChatSession))).all()


# ---------------------------------------------------------------- Rafi on Fitri's own PC


async def _ep_pc(client) -> tuple[dict, str, str]:
    """The owner's linked PC that allowed ePerolehan."""
    owner_id, ws_id = await ids_of("owner@example.com")
    dev = await link(client, "Owner PC")
    async with SessionLocal() as db:
        d = await db.get(Device, dev["device_id"])
        d.tunnel_hosts = ["eperolehan.gov.my"]
        await db.commit()
    return dev, owner_id, ws_id


async def _open(agent_id: str, task_id: str, device_id: str, sites: list[str] | None):
    from agentic.agents import browser_tools
    from agentic.agents.tools import ToolContext
    from agentic.models import Workspace

    async with SessionLocal() as db:
        a = await db.get(Agent, agent_id)
        ctx = ToolContext(
            db=db, agent=a, workspace=await db.get(Workspace, a.workspace_id),
            task=await db.get(Task, task_id),
        )  # fmt: skip
        return await browser_tools._open_on_pc(ctx, device_id, sites)


async def test_a_team_agent_and_her_own_ai_both_open_ePerolehan_on_her_pc(
    client, llm, temporal, monkeypatch
):
    """Rafi as a team agent given a Browse for me ePerolehan task by her, and her own AI:
    both open the browser on HER connected PC, also right after it reconnected."""
    from agentic.devices import tunnel

    from .test_devices import personal_agent

    monkeypatch.setattr(settings, "device_reconnect_wait", 5.0)
    o = await office(client)
    dev, owner_id, ws_id = await _ep_pc(client)
    did = dev["device_id"]
    rafi = await new_agent(client, o, "Rafi", "Operations")
    twin = await personal_agent(o, owner_id, ws_id, is_twin=True)
    pc = await FakePC(dev["token"]).start()
    try:
        r = await client.post(
            f"/api/agents/{rafi['id']}/web-task",
            json={"url": "https://www.eperolehan.gov.my", "instructions": "Read my inbox",
                  "mode": "tender"},
            headers=csrf(client),
        )  # fmt: skip
        assert r.status_code == 201, r.text
        tid = r.json()["id"]
        async with SessionLocal() as db:
            task = await db.get(Task, tid)
            from agentic.agents.browser_tools import task_hosts

            sites = await task_hosts(db, task)
            assert sites and all(tunnel.pc_only(s) for s in sites)
            # The work is hers: her own PC, for the team agent too.
            assert await tunnel.screen_for(db, ws_id, sites, owner_id) == (did, "")
        channel, ws_url = await _open(rafi["id"], tid, did, sites)
        assert channel and ws_url and pc.calls[-1]["method"] == "browser.open"
        assert pc.calls[-1]["params"]["sites"] == sites  # the team agent: only those sites
        # Her own AI: the same PC.
        channel2, _ = await _open(twin.id, tid, did, None)
        assert channel2
    finally:
        await pc.stop()
    await asyncio.sleep(0.05)

    # The API restarted a moment ago: the socket is gone, the PC is coming back. Opening waits
    # for it instead of "the browser on your computer won't open: offline".
    back: list[FakePC] = []

    async def reconnect_soon() -> None:
        await asyncio.sleep(0.3)
        back.append(await FakePC(dev["token"]).start())

    later = asyncio.create_task(reconnect_soon())
    try:
        async with SessionLocal() as db:
            assert await tunnel.screen_for(db, ws_id, sites, owner_id) == (did, "")
        channel3, _ = await _open(rafi["id"], tid, did, sites)
        assert channel3 and back
    finally:
        await later
        for p in back:
            await p.stop()

    # Still away after the wait: plain words, what to do, where to look.
    monkeypatch.setattr(settings, "device_reconnect_wait", 0.2)
    from agentic.agents.browser_tools import BrowsersBusy

    try:
        await _open(rafi["id"], tid, did, sites)
        raise AssertionError("should not open")
    except BrowsersBusy as e:
        text = str(e)
        assert "Owner PC" in text and "open Agentic Office PC" in text and "/computers" in text
        assert "the tool reports" not in text
