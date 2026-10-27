"""P53 company-owned staff computers: the owner sees every linked computer (roster), can reach
a staff computer's screen and files through the same two-lock remote path (with the notice on
the computer), and can turn on a company backup of the folders staff computers share."""


from agentic.core.db import SessionLocal
from agentic.devices import backup
from agentic.documents import storage
from agentic.models import StorageTarget

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_devices import FakePC, ids_of, link, personal_agent
from .test_office_roles import as_role


async def _local_target(ws_id: str) -> str:
    async with SessionLocal() as db:
        t = StorageTarget(
            workspace_id=ws_id,
            name="Backup disk",
            kind="local",
            config={"folder": f"bk-{ws_id}"},
            created_by="user:test",
        )
        db.add(t)
        await db.commit()
        await db.refresh(t)
        return t.id


async def test_owner_oversees_staff_computers_and_can_reach_one(client, llm, temporal):
    o = await office(client)
    br = o["branch"]["id"]
    staff = await as_role(client, "aina@example.com", "staff", branch_id=br)
    try:
        aina_id, ws_id = await ids_of("aina@example.com")
        await personal_agent(o, aina_id, ws_id, is_twin=True)
        dev = await link(staff, "Aina work laptop")
        pc = await FakePC(dev["token"], remote="control").start(
            folders=["C:\\Users\\aina\\Documents"]
        )
        try:
            # The owner sees it on the roster, with who linked it and the company.
            r = await client.get("/api/org/computers")
            assert r.status_code == 200, r.text
            mine = [c for c in r.json()["computers"] if c["id"] == dev["device_id"]]
            assert len(mine) == 1
            row = mine[0]
            assert row["person"]["email"] == "aina@example.com" and row["online"] is True
            assert row["company"] == o["branch"]["name"] and r.json()["can_backup"] is True
            # Search narrows it.
            assert (await client.get("/api/org/computers?q=aina")).json()["computers"]
            assert not (await client.get("/api/org/computers?q=nobodyxyz")).json()["computers"]

            # Staff themselves cannot oversee others' computers.
            assert (await staff.get("/api/org/computers")).status_code == 403

            # The owner can reach the staff computer (health), and see its activity.
            h = await client.get(f"/api/devices/{dev['device_id']}/health")
            assert h.status_code == 200 and h.json()["hostname"] == "AINA-LAPTOP"
            # Turning on web remote needs the OWNER's own password (and the computer's lock).
            bad = await client.put(
                f"/api/devices/{dev['device_id']}/remote",
                json={"level": "view", "password": "wrong"},
                headers=csrf(client),
            )
            assert bad.status_code == 403 and bad.json()["code"] == "password_required"
            ok = await client.put(
                f"/api/devices/{dev['device_id']}/remote",
                json={"level": "view", "password": "correct-horse-battery"},
                headers=csrf(client),
            )
            assert ok.status_code == 200
            # A screen capture works (the computer's own lock is "control" >= "view").
            shot = await client.get(f"/api/devices/{dev['device_id']}/screen")
            assert shot.status_code == 200 and shot.headers["content-type"].startswith("image/")
        finally:
            await pc.stop()
    finally:
        await staff.aclose()


async def test_company_backup_copies_shared_folders_incrementally(client, llm, temporal):
    o = await office(client)
    owner_id, ws_id = await ids_of("owner@example.com")
    await personal_agent(o, owner_id, ws_id, is_twin=True)
    dev = await link(client, "Owner laptop")
    files = {
        "C:\\Users\\aina\\Documents\\Q3 report.txt": b"revenue up 12 percent",
        "C:\\Users\\aina\\Documents\\notes.txt": b"hello",
    }
    pc = await FakePC(dev["token"], files).start(folders=["C:\\Users\\aina\\Documents"])
    try:
        target_id = await _local_target(ws_id)
        # Off until the owner turns it on, and a destination is required.
        assert (await client.get("/api/org/computers/backup")).json()["enabled"] is False
        none = await client.put(
            "/api/org/computers/backup",
            json={"enabled": True, "target_id": ""},
            headers=csrf(client),
        )
        assert none.status_code == 422 and none.json()["code"] == "no_target"
        on = await client.put(
            "/api/org/computers/backup",
            json={"enabled": True, "target_id": target_id, "every_hours": 6},
            headers=csrf(client),
        )
        assert on.status_code == 200 and on.json()["enabled"] is True

        # The round copies the shared folder's files to the destination.
        async with SessionLocal() as db:
            n = await backup.backup_due(db)
        assert n == 1
        async with SessionLocal() as db:
            t = await db.get(StorageTarget, target_id)
            kept = await storage.list_files(t, f"{backup.KEY_ROOT}/{ws_id}/{dev['device_id']}")
            names = {e.key.split("/")[-1] for e in kept}
            assert {"Q3 report.txt", "notes.txt", "_manifest.json"} <= names
            got = await storage.get(
                t, f"{backup.KEY_ROOT}/{ws_id}/{dev['device_id']}/0/Q3 report.txt"
            )
            assert got == b"revenue up 12 percent"

        # It is on the computer's activity log (the staff member sees it), never secretly.
        acts = (await client.get(f"/api/devices/{dev['device_id']}/activity")).json()
        bk = [a for a in acts if a["kind"] == "backup"]
        assert bk and bk[0]["detail"]["files"] == 2

        # A second run right away is incremental: nothing re-downloaded, and it is not yet due.
        async with SessionLocal() as db:
            again = await backup.backup_due(db)
        assert again == 0  # within the interval, skipped
        async with SessionLocal() as db:
            st = await backup.run_once(
                db, await _device(db, dev["device_id"]), await db.get(StorageTarget, target_id)
            )
        assert st.files == 0 and st.skipped == 2
    finally:
        await pc.stop()


async def _device(db, device_id):
    from agentic.models import Device

    return await db.get(Device, device_id)
