# ruff: noqa: E501
"""P80: SharePoint / OneDrive folders in the Library. A manager pastes a link; the folder is
opened with their own Microsoft 365 sign-in (read-only scopes, granted by reconnecting once),
previewed, and read: only the searchable text is kept (never the files), scoped to the company
picked, cited with the SharePoint link. A sync follows changes (re-reads changed files, drops
deleted ones); a broken sign-in marks the folder needs_reconnect without retrying; disconnect
removes its text; only managers may connect; files can become SOP drafts.

Microsoft is faked with an httpx MockTransport (microsoft/http.py), as in test_microsoft.py.
"""

from urllib.parse import parse_qs

import httpx
import pytest
from sqlalchemy import func, select, text

from agentic.agents import dispatch, runtime
from agentic.agents.tools import ToolContext
from agentic.core.db import SessionLocal
from agentic.core.valkey import valkey
from agentic.microsoft import auth, http
from agentic.models import SOP, AuditLog, DocFile, KnowledgeChunk, MicrosoftAccount, Workspace
from agentic.sharepoint import library as linked
from agentic.sharepoint import links
from agentic.sharepoint.models import LinkedFile, LinkedSource

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_microsoft import configure, connect, make_agent, ms, my_account, user_id  # noqa: F401
from .test_office_roles import as_role

LINK = "https://maju.sharepoint.com/:f:/s/HR/EtAbCdEf?e=xyz"
G = "/v1.0"
DL = "maju.sharepoint.com"

LEAVE_V1 = (
    "LEAVE POLICY\nAnnual leave is applied for on Form BC-01 at least three working days "
    "before the leave starts. The head of department approves it within two days."
)
LEAVE_V2 = (
    "LEAVE POLICY\nAnnual leave is applied for on Form BC-02 at least five working days "
    "before the leave starts. The head of department approves it within one day."
)
CLAIMS = (
    "# Claims SOP\n\n## Travel claims\nTravel claims above RM 500 need the finance manager's "
    "approval. Mileage is paid at 60 sen per kilometre with the trip log attached."
)
SECRETS = "Server room\nPassword: Hunter2xyz!\nUsername: admin01\nPIN: 482913"


class FakeDrive:
    """A SharePoint folder at Microsoft: items by id, and what was fetched."""

    def __init__(self) -> None:
        self.items: dict[str, dict] = {}
        self.downloads: list[str] = []
        self.token_scopes: list[str] = []
        self.refuse = False
        self.add("fold-1", "Company SOPs", None, folder=True)
        self.add("fold-2", "HR", "fold-1", folder=True)
        self.add("f1", "Leave policy.txt", "fold-1", LEAVE_V1)
        self.add("f2", "Claims SOP.md", "fold-2", CLAIMS)
        self.add("f3", "Server passwords.txt", "fold-1", SECRETS)
        self.add("f4", "team photo.jpg", "fold-2", "not really a picture")

    def add(self, iid: str, name: str, parent: str | None, body: str = "", folder: bool = False):
        self.items[iid] = {"name": name, "parent": parent, "body": body, "folder": folder, "v": 1}

    def change(self, iid: str, body: str) -> None:
        self.items[iid]["body"] = body
        self.items[iid]["v"] += 1

    def json(self, iid: str) -> dict:
        it = self.items[iid]
        out = {
            "id": iid,
            "name": it["name"],
            "webUrl": f"https://{DL}/sites/HR/Shared%20Documents/{it['name']}",
            "eTag": f'"{iid},{it["v"]}"',
            "cTag": f'"c:{iid},{it["v"]}"',
            "parentReference": {"driveId": "d1", "id": it["parent"]},
        }
        if it["folder"]:
            out["folder"] = {
                "childCount": sum(1 for x in self.items.values() if x["parent"] == iid)
            }
        else:
            out["file"] = {"mimeType": "text/plain"}
            out["size"] = len(it["body"].encode())
        return out

    def handler(self, ms_fake):
        def handle(r: httpx.Request) -> httpx.Response:
            p = r.url.path
            if r.url.host == "login.microsoftonline.com":
                form = {k: v[0] for k, v in parse_qs(r.content.decode()).items()}
                self.token_scopes.append(form.get("scope", ""))
                got = ms_fake.handler(r)
                if got.status_code == 200 and form.get("grant_type") != "client_credentials":
                    # Microsoft grants what was asked for (the person accepted it).
                    body = got.json() | {"scope": form.get("scope", "")}
                    return httpx.Response(200, json=body)
                return got
            if r.url.host == DL:  # the pre-signed download: never our token
                assert "authorization" not in r.headers
                iid = r.url.params["id"]
                return httpx.Response(200, content=self.items[iid]["body"].encode())
            if r.url.host == "graph.microsoft.com" and (
                p.startswith(f"{G}/shares/") or p.startswith(f"{G}/drives/")
            ):
                assert r.headers["authorization"].startswith("Bearer ")
                if self.refuse:
                    return httpx.Response(403, json={"error": {"code": "accessDenied"}})
                if p.startswith(f"{G}/shares/"):
                    share = p.split("/")[3]
                    assert share == links.share_id(LINK)
                    return httpx.Response(200, json=self.json("fold-1"))
                parts = p.removeprefix(f"{G}/drives/d1/items/").split("/")
                iid = parts[0]
                if iid not in self.items:
                    return httpx.Response(404, json={"error": {"code": "itemNotFound"}})
                if len(parts) == 1:
                    return httpx.Response(200, json=self.json(iid))
                if parts[1] == "children":
                    kids = [k for k, v in self.items.items() if v["parent"] == iid]
                    return httpx.Response(200, json={"value": [self.json(k) for k in kids]})
                if parts[1] == "content":
                    self.downloads.append(iid)
                    return httpx.Response(
                        302,
                        headers={"location": f"https://{DL}/_layouts/15/download.aspx?id={iid}"},
                    )
            return ms_fake.handler(r)

        return handle


@pytest.fixture
def drive(ms, monkeypatch):
    d = FakeDrive()
    d.ms = ms
    http.transport = httpx.MockTransport(d.handler(ms))

    async def start_linked_sync(source_id):  # the worker, right here
        async with SessionLocal() as db:
            await linked.sync_source(db, source_id)

    monkeypatch.setattr(dispatch, "start_linked_sync", start_linked_sync)
    return d


@pytest.fixture(autouse=True)
async def wipe_chunks():
    async with SessionLocal() as db:  # knowledge_chunks has no foreign keys
        await db.execute(text("TRUNCATE knowledge_chunks RESTART IDENTITY"))
        await db.commit()


async def allow_files(email: str = "owner@example.com") -> None:
    """The person reconnected and granted SharePoint reading."""
    acct = await my_account(email)
    async with SessionLocal() as db:
        a = await db.get(MicrosoftAccount, acct.id)
        a.scopes = f"{a.scopes} https://graph.microsoft.com/Files.Read.All https://graph.microsoft.com/Sites.Read.All"
        await db.commit()


async def ready_office(client) -> dict:
    o = await office(client)
    await configure(client)
    await connect(client)
    await allow_files()
    return o


async def chunks(*where) -> list[KnowledgeChunk]:
    async with SessionLocal() as db:
        return list((await db.scalars(select(KnowledgeChunk).where(*where))).all())


async def files_by_name() -> dict[str, LinkedFile]:
    async with SessionLocal() as db:
        return {f.name: f for f in (await db.scalars(select(LinkedFile))).all()}


async def link(client, **body) -> httpx.Response:
    return await client.post(
        "/api/library/linked", json={"url": LINK, **body}, headers=csrf(client)
    )


# ---------------------------------------------------------------- the link


def test_only_https_sharepoint_and_onedrive_links():
    ok = [
        LINK,
        "https://maju-my.sharepoint.com/personal/boss/Documents/SOP",
        "https://onedrive.live.com/?id=ABC",
        "https://1drv.ms/f/s!AbCd",
    ]
    for u in ok:
        assert links.check_link(f"  {u} ") == u
    bad = [
        "",
        "http://maju.sharepoint.com/sites/HR",  # not https
        "https://evil.com/maju.sharepoint.com",
        "https://maju.sharepoint.com.evil.com/x",
        "https://notsharepoint.com/x",
        "https://user:pw@maju.sharepoint.com/x",
        "https://maju.sharepoint.com:8443/x",
        "file:///c:/secrets",
        "https://maju.sharepoint.com/a b",
        "javascript:alert(1)",
    ]
    for u in bad:
        with pytest.raises(links.BadLink):
            links.check_link(u)
    assert links.share_id("https://a.sharepoint.com/x?y=1").startswith("u!")
    assert "=" not in links.share_id("https://a.sharepoint.com/xy")
    assert links.provider_of("https://maju-my.sharepoint.com/p") == "onedrive"
    assert links.provider_of(LINK) == "sharepoint"
    # Only the file types the Library reads.
    assert links.supported("A.DOCX") and links.supported("b.csv") and not links.supported("c.jpg")


async def test_bad_links_are_refused_before_microsoft_is_asked(client, llm, temporal, drive):
    await ready_office(client)
    r = await client.post(
        "/api/library/linked/resolve",
        json={"url": "https://evil.example.com/f"},
        headers=csrf(client),
    )
    assert r.status_code == 400 and r.json()["code"] == "bad_link"
    assert not drive.downloads


# ---------------------------------------------------------------- permission to read files


async def test_file_reading_is_asked_only_by_the_librarys_reconnect(client, llm, temporal, drive):
    await office(client)
    await configure(client)
    await connect(client)
    # Plain connect and everyone's sign-in never ask for file reading (a tenant that allows only
    # low-risk consent would otherwise stop every sign-in at "needs admin approval").
    assert "Files.Read.All" not in drive.token_scopes[-1]
    r = await client.post("/api/integrations/microsoft/connect", json={}, headers=csrf(client))
    assert "Files.Read.All" not in parse_qs(r.json()["url"].split("?", 1)[1])["scope"][0]
    for email in ("", "owner@example.com"):
        r = await client.post(
            "/api/auth/microsoft/start", json={"email": email}, headers=csrf(client)
        )
        assert "Files.Read.All" not in parse_qs(r.json()["url"].split("?", 1)[1])["scope"][0]
    acct = (await client.get("/api/integrations/microsoft/account")).json()
    assert acct["connected"] and acct["files_ok"] is False
    r = await client.post("/api/library/linked/resolve", json={"url": LINK}, headers=csrf(client))
    assert r.status_code == 409 and r.json()["code"] == "files_not_allowed"
    # Its token refresh asks only for what it was granted.
    a = await my_account()
    await valkey().delete(f"mstok:{a.id}")
    async with SessionLocal() as db:
        await auth.access_token(db, await db.get(MicrosoftAccount, a.id))
    assert "Files.Read.All" not in drive.token_scopes[-1]

    # The Library's "Reconnect Microsoft 365 to allow SharePoint": read only, never write, and
    # back to the Library.
    r = await client.post(
        "/api/integrations/microsoft/connect", json={"with_files": True}, headers=csrf(client)
    )
    q = parse_qs(r.json()["url"].split("?", 1)[1])
    scope = q["scope"][0]
    assert "Files.Read.All" in scope and "Sites.Read.All" in scope and "Mail.ReadWrite" in scope
    assert "Files.ReadWrite" not in scope and "Sites.ReadWrite" not in scope
    r = await client.get(
        "/api/integrations/microsoft/callback", params={"state": q["state"][0], "code": "good-code"}
    )
    assert r.status_code == 303 and r.headers["location"].startswith("/library?ms=connected")
    assert (await client.get("/api/integrations/microsoft/account")).json()["files_ok"] is True

    # Kept from then on: refreshes, their own sign-in (email known) and a plain reconnect.
    await valkey().delete(f"mstok:{a.id}")
    async with SessionLocal() as db:
        await auth.access_token(db, await db.get(MicrosoftAccount, a.id))
    assert "Files.Read.All" in drive.token_scopes[-1]
    r = await client.post(
        "/api/auth/microsoft/start", json={"email": "owner@example.com"}, headers=csrf(client)
    )
    assert "Files.Read.All" in parse_qs(r.json()["url"].split("?", 1)[1])["scope"][0]
    await connect(client)
    assert "Files.Read.All" in drive.token_scopes[-1]
    assert (await client.get("/api/integrations/microsoft/account")).json()["files_ok"] is True
    # A sign-in that could not know them (no email) does not take it back either.
    async with SessionLocal() as db:
        await auth.store(
            db, a.workspace_id, a.user_id,
            {"access_token": "at-x", "refresh_token": "rt-x", "expires_in": 3600,
             "scope": "openid offline_access Mail.ReadWrite Calendars.ReadWrite"},
            {"id": "oid-boss"},
        )  # fmt: skip
    assert (await client.get("/api/integrations/microsoft/account")).json()["files_ok"] is True
    # Withdrawn at Microsoft: the refresh drops file reading and mail keeps working.
    real = drive.ms.handler

    def withdrawn(r: httpx.Request) -> httpx.Response:
        form = {k: v[0] for k, v in parse_qs(r.content.decode()).items()}
        if form.get("grant_type") == "refresh_token" and "Files.Read.All" in form.get("scope", ""):
            return httpx.Response(
                400, json={"error": "invalid_grant", "error_description": "AADSTS65001: consent"}
            )
        return real(r)

    drive.ms.handler = withdrawn
    await valkey().delete(f"mstok:{a.id}")
    async with SessionLocal() as db:
        assert await auth.access_token(db, await db.get(MicrosoftAccount, a.id))
    acct = (await client.get("/api/integrations/microsoft/account")).json()
    assert acct["status"] == "connected" and acct["mail_ok"] and acct["files_ok"] is False


async def test_a_refused_files_consent_leaves_sign_in_and_mail_working(
    client, llm, temporal, drive
):
    await office(client)
    await configure(client)
    await connect(client)
    before = await my_account()
    r = await client.post(
        "/api/integrations/microsoft/connect", json={"with_files": True}, headers=csrf(client)
    )
    state = parse_qs(r.json()["url"].split("?", 1)[1])["state"][0]
    # The tenant lets users consent only to low-risk permissions: Microsoft sends them back.
    r = await client.get(
        "/api/integrations/microsoft/callback",
        params={"state": state, "error": "access_denied",
                "error_description": "AADSTS90094: An administrator of Maju has set a policy"},
    )  # fmt: skip
    assert r.status_code == 303
    loc = parse_qs(r.headers["location"].split("?", 1)[1])
    assert r.headers["location"].startswith("/library?") and loc["ms"] == ["error"]
    assert "Files.Read.All and Sites.Read.All" in loc["msg"][0] and "admin" in loc["msg"][0]
    after = await my_account()
    assert after.status == "connected" and after.token_enc == before.token_enc
    acct = (await client.get("/api/integrations/microsoft/account")).json()
    assert acct["mail_ok"] and acct["files_ok"] is False
    await valkey().delete(f"mstok:{after.id}")
    async with SessionLocal() as db:  # mail keeps refreshing, without file reading
        assert await auth.access_token(db, await db.get(MicrosoftAccount, after.id))
    assert "Files.Read.All" not in drive.token_scopes[-1]


# ---------------------------------------------------------------- preview, import, search


async def test_preview_import_scope_and_search(client, llm, temporal, drive):
    o = await ready_office(client)
    b1 = o["branch"]["id"]
    b2 = (
        await client.post("/api/branches", json={"name": "Jaya Bhd"}, headers=csrf(client))
    ).json()

    r = await client.post("/api/library/linked/resolve", json={"url": LINK}, headers=csrf(client))
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["name"] == "Company SOPs" and p["is_folder"] and p["files"] == 3
    assert p["skipped"] == 1 and not p["capped"] and not p["already"]
    assert not drive.downloads  # a preview reads nothing

    r = await link(client, branch_id=b1)
    assert r.status_code == 201, r.text
    src = r.json()
    assert src["scope_label"] == "Maju Sdn Bhd" and src["connected_by_me"]
    listed = (await client.get("/api/library/linked")).json()
    s = listed["sources"][0]
    assert listed["can_connect"] and s["status"] == "ready" and s["last_sync_at"]
    assert s["files_indexed"] == 2 and s["files_held"] == 1 and s["passages"] >= 2
    fs = await files_by_name()
    assert (
        fs["Leave policy.txt"].status == "indexed"
        and fs["Claims SOP.md"].path == "HR/Claims SOP.md"
    )
    assert fs["Server passwords.txt"].status == "held"  # P24: never searchable
    assert "team photo.jpg" not in fs
    # Only text was kept: no stored file, no secret, the passages carry the company's scope.
    async with SessionLocal() as db:
        assert await db.scalar(select(func.count()).select_from(DocFile)) == 0
    every = await chunks(KnowledgeChunk.source_kind == "sharepoint")
    assert every and all(c.branch_id == b1 for c in every)
    assert not any("Hunter2" in c.text or "482913" in c.text for c in every)
    assert (await linked_already(client))["already"]

    # A person of the company finds it, with the SharePoint link to open.
    hits = (await client.get("/api/library/search", params={"q": "travel claims mileage"})).json()
    top = hits[0]
    assert top["source_kind"] == "sharepoint" and top["path"] == "HR/Claims SOP.md"
    assert top["url"].startswith(f"https://{DL}/")

    # Its agent finds it too (with the link), and can read the whole file; another company's
    # agent cannot.
    me, ws_id = await user_id("owner@example.com")
    mine = await make_agent(o, ws_id, None, name="HR Agent")
    other = await make_agent({"branch": b2}, ws_id, None, name="Jaya Agent")
    async with SessionLocal() as db:
        ws = await db.get(Workspace, ws_id)
        ctx = ToolContext(db=db, agent=mine, workspace=ws, task=None, person=me)
        out = await runtime.run_tool(ctx, "search_library", {"query": "annual leave form"})
        assert "Leave policy" in out and "SharePoint file" in out and f"https://{DL}/" in out
        out = await runtime.run_tool(ctx, "read_file", {"file_id": fs["Leave policy.txt"].id})
        assert "BC-01" in out and "Link for people" in out
        theirs = ToolContext(db=db, agent=other, workspace=ws, task=None, person=me)
        out = await runtime.run_tool(theirs, "search_library", {"query": "annual leave form"})
        assert "Leave policy" not in out
        out = await runtime.run_tool(theirs, "read_file", {"file_id": fs["Leave policy.txt"].id})
        assert out.startswith("Error: no such file")

    # A full re-index of the Library keeps SharePoint passages (it cannot rebuild them).
    from agentic.knowledge import indexer

    async with SessionLocal() as db:
        await indexer.reindex_workspace(db, ws_id)
    assert len(await chunks(KnowledgeChunk.source_kind == "sharepoint")) == len(every)


async def linked_already(client) -> dict:
    r = await client.post("/api/library/linked/resolve", json={"url": LINK}, headers=csrf(client))
    return r.json()


# ---------------------------------------------------------------- sync


async def test_sync_rereads_changes_and_drops_deleted_files(client, llm, temporal, drive):
    await ready_office(client)
    src = (await link(client)).json()
    assert sorted(drive.downloads) == ["f1", "f2", "f3"]
    before = await files_by_name()
    drive.downloads.clear()

    drive.change("f1", LEAVE_V2)  # edited in SharePoint
    del drive.items["f2"]  # deleted in SharePoint
    drive.items["f3"]["name"] = "Server room notes.txt"  # renamed: same content
    r = await client.post(f"/api/library/linked/{src['id']}/sync", json={}, headers=csrf(client))
    assert r.status_code == 202, r.text
    assert drive.downloads == ["f1"]  # only what changed is read again
    after = await files_by_name()
    assert set(after) == {"Leave policy.txt", "Server room notes.txt"}
    assert after["Leave policy.txt"].id == before["Leave policy.txt"].id
    assert after["Leave policy.txt"].ctag != before["Leave policy.txt"].ctag
    leave = await chunks(KnowledgeChunk.source_id == after["Leave policy.txt"].id)
    assert leave and all("BC-02" in c.text and "BC-01" not in c.text for c in leave)
    assert not await chunks(KnowledgeChunk.source_id == before["Claims SOP.md"].id)
    s = (await client.get("/api/library/linked")).json()["sources"][0]
    assert s["status"] == "ready" and s["files_indexed"] == 1 and s["files_held"] == 1

    # The schedule: nothing is due right after a sync; a stale one is.
    from datetime import UTC, datetime, timedelta

    async with SessionLocal() as db:
        assert await linked.due(db) == []
        assert await linked.due(db, datetime.now(UTC) + timedelta(hours=4)) == [src["id"]]


async def test_a_broken_sign_in_marks_needs_reconnect_without_retrying(
    client, llm, temporal, drive
):
    await ready_office(client)
    src = (await link(client)).json()
    a = await my_account()
    # Microsoft refuses the refresh token: the person must sign in again.
    await valkey().delete(f"mstok:{a.id}")
    drive_calls = len(drive.downloads)
    drive.ms.refresh_fails = True
    r = await client.post(f"/api/library/linked/{src['id']}/sync", json={}, headers=csrf(client))
    assert r.status_code == 202
    s = (await client.get("/api/library/linked")).json()["sources"][0]
    assert s["status"] == "needs_reconnect" and s["last_error"]
    assert (await my_account()).status == "reconnect_needed"
    # What was indexed stays searchable; the schedule does not try again (no spinning).
    assert await chunks(KnowledgeChunk.source_kind == "sharepoint")
    from datetime import UTC, datetime, timedelta

    async with SessionLocal() as db:
        assert await linked.due(db, datetime.now(UTC) + timedelta(days=2)) == []
    out = await linked.tick()
    assert out == {"synced": 0, "failed": 0} and len(drive.downloads) == drive_calls


async def test_a_folder_the_person_lost_access_to_shows_an_error(client, llm, temporal, drive):
    await ready_office(client)
    src = (await link(client)).json()
    drive.refuse = True
    async with SessionLocal() as db:
        res = await linked.sync_source(db, src["id"])
    assert res.status == "error"
    s = (await client.get("/api/library/linked")).json()["sources"][0]
    assert s["status"] == "error" and "SharePoint says this folder is gone" in s["last_error"]
    assert await chunks(KnowledgeChunk.source_kind == "sharepoint")  # kept until disconnected


# ---------------------------------------------------------------- disconnect


async def test_disconnect_removes_the_text_and_keeps_sharepoint_untouched(
    client, llm, temporal, drive
):
    await ready_office(client)
    src = (await link(client)).json()
    assert await chunks(KnowledgeChunk.source_kind == "sharepoint")
    r = await client.delete(
        f"/api/library/linked/{src['id']}",
        headers={"content-type": "application/json", **csrf(client)},
    )
    assert r.status_code == 204
    assert not await chunks(KnowledgeChunk.source_kind == "sharepoint")
    async with SessionLocal() as db:
        assert await db.scalar(select(func.count()).select_from(LinkedFile)) == 0
        assert await db.scalar(select(func.count()).select_from(LinkedSource)) == 0
        row = await db.scalar(select(AuditLog).where(AuditLog.action == "library.unlinked"))
        assert row is not None and row.before["files"] == 3
    assert "f1" in drive.items  # nothing is ever written to SharePoint
    hits = (await client.get("/api/library/search", params={"q": "annual leave form"})).json()
    assert not [h for h in hits if h["source_kind"] == "sharepoint"]


# ---------------------------------------------------------------- who may connect


async def test_only_managers_connect_and_only_for_their_company(client, llm, temporal, drive):
    o = await ready_office(client)
    b1 = o["branch"]["id"]
    b2 = (
        await client.post("/api/branches", json={"name": "Jaya Bhd"}, headers=csrf(client))
    ).json()
    staff = await as_role(
        client, "staff@example.com", "staff", branch_id=b1, department_id=o["depts"]["Finance"]
    )
    hod = await as_role(client, "hod@example.com", "hod", department_id=o["depts"]["Finance"])
    bm = await as_role(client, "bm@example.com", "branch_manager", branch_id=b1)
    bm2 = await as_role(client, "bm2@example.com", "branch_manager", branch_id=b2["id"])
    for c in (staff, hod):
        r = await c.post("/api/library/linked/resolve", json={"url": LINK}, headers=csrf(c))
        assert r.status_code == 403, r.text
        r = await c.post(
            "/api/library/linked", json={"url": LINK, "branch_id": b1}, headers=csrf(c)
        )
        assert r.status_code == 403
        assert (await c.get("/api/library/linked")).json()["can_connect"] is False
    # A company's manager may not link a folder for every company, or another company.
    r = await bm.post("/api/library/linked", json={"url": LINK}, headers=csrf(bm))
    assert r.status_code == 403
    r = await bm.post(
        "/api/library/linked", json={"url": LINK, "branch_id": b2["id"]}, headers=csrf(bm)
    )
    assert r.status_code == 403
    # Their own company: allowed once their own Microsoft 365 allows files.
    r = await bm.post("/api/library/linked", json={"url": LINK, "branch_id": b1}, headers=csrf(bm))
    assert r.status_code == 409 and r.json()["code"] == "microsoft_not_connected"

    src = (await link(client, branch_id=b1)).json()  # the owner links it for company 1
    assert (await bm.get("/api/library/linked")).json()["sources"][0]["can_manage"] is True
    assert (await staff.get("/api/library/linked")).json()["sources"][0]["can_manage"] is False
    assert (await bm2.get("/api/library/linked")).json()["sources"] == []
    assert (await bm2.get(f"/api/library/linked/{src['id']}/files")).status_code == 404
    r = await bm2.delete(
        f"/api/library/linked/{src['id']}",
        headers={"content-type": "application/json", **csrf(bm2)},
    )
    assert r.status_code == 404
    r = await staff.delete(
        f"/api/library/linked/{src['id']}",
        headers={"content-type": "application/json", **csrf(staff)},
    )
    assert r.status_code == 403
    r = await staff.post(f"/api/library/linked/{src['id']}/sops", json={}, headers=csrf(staff))
    assert r.status_code == 403
    # The same folder twice: refused.
    r = await link(client, branch_id=b1)
    assert r.status_code == 409 and r.json()["code"] == "already_linked"


# ---------------------------------------------------------------- SOP drafts

SOP_REPLY = """# Travel claims

Travel claims follow these steps.

## Steps
1. Attach the trip log to the claim.
2. Claims above RM 500 go to the finance manager for approval.
3. Mileage is paid at 60 sen per kilometre.
"""


async def test_files_become_sop_drafts_that_agents_do_not_see(
    client, llm, temporal, drive, monkeypatch
):
    from agentic.intake import builders

    await ready_office(client)
    src = (await link(client)).json()
    files = (await client.get(f"/api/library/linked/{src['id']}/files")).json()
    claims = next(f for f in files if f["name"] == "Claims SOP.md")
    assert claims["web_url"].startswith(f"https://{DL}/") and claims["status"] == "indexed"

    async def start_build(job_id):
        async with SessionLocal() as db:
            await builders.run_job(db, job_id)

    monkeypatch.setattr(dispatch, "start_build", start_build)
    llm.say(SOP_REPLY)
    r = await client.post(
        f"/api/library/linked/{src['id']}/sops",
        json={"file_ids": [claims["id"]]},
        headers=csrf(client),
    )
    assert r.status_code == 202, r.text
    job = (await client.get(f"/api/builders/jobs/{r.json()['jobs'][0]}")).json()
    assert job["status"] == "done", job
    async with SessionLocal() as db:
        s = await db.get(SOP, job["built_id"])
        assert s.status == "draft" and s.source_file_ids == []
        assert "Source: Claims SOP.md" in s.body and claims["web_url"] in s.body
    # The model read the file's text (from its passages).
    user = llm.requests[-1]["messages"][-1]["content"]
    assert "60 sen per kilometre" in user
    # A draft is never in the library index.
    assert not await chunks(KnowledgeChunk.source_kind == "sop")
    # Without a pick: the files that read like procedures ("Claims SOP"); the leave policy too.
    llm.say(SOP_REPLY).say(SOP_REPLY)
    r = await client.post(f"/api/library/linked/{src['id']}/sops", json={}, headers=csrf(client))
    assert r.status_code == 202 and r.json()["count"] == 2


# ---------------------------------------------------------------- P80: browser addresses


VIEW = (
    "https://contoso.sharepoint.com/sites/HQ/Shared%20Documents/Forms/AllItems.aspx?e=5%3Aab"
    "&sharingv2=true&fromShare=true&id=%2Fsites%2FHQ%2FShared%20Documents%2F2026%2F"
    "CHECK%20LIST%20%26%20SOP%20TUGASAN&FolderCTID=0x0120"
)


def test_browser_addresses_are_read_by_their_folder_path():
    """What people copy from the address bar: a library view opened on a folder, the library
    itself, a plain folder path. Sharing links (/:f:/...) still go through /shares."""
    assert links.folder_path(VIEW) == (
        "contoso.sharepoint.com",
        "/sites/HQ/Shared Documents/2026/CHECK LIST & SOP TUGASAN",
    )
    lib = "https://contoso.sharepoint.com/sites/HQ/Shared%20Documents/Forms/AllItems.aspx"
    assert links.folder_path(lib) == ("contoso.sharepoint.com", "/sites/HQ/Shared Documents")
    plain = "https://contoso.sharepoint.com/sites/HQ/Shared%20Documents/2026"
    assert links.folder_path(plain) == ("contoso.sharepoint.com", "/sites/HQ/Shared Documents/2026")
    assert links.folder_path(LINK) is None  # a sharing link
    assert links.folder_path("https://contoso.sharepoint.com/SitePages/Home.aspx") is None
    assert links.folder_path("https://onedrive.live.com/?id=ABC") is None


class PathGraph:
    """Graph for a site, its libraries and an item by path; anything else is not found."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    async def request(self, method, path, *, params=None, prefer=None, **_):
        from agentic.microsoft.errors import NotFound

        self.calls.append(path)
        if path == "/sites/contoso.sharepoint.com:/sites/HQ":
            return {"id": "contoso.sharepoint.com,s1,w1"}
        if path == "/sites/contoso.sharepoint.com%2Cs1%2Cw1/drives":
            return {
                "value": [
                    {"id": "d-pol", "webUrl": "https://contoso.sharepoint.com/sites/HQ/Policies"},
                    {
                        "id": "d-docs",
                        "webUrl": "https://contoso.sharepoint.com/sites/HQ/Shared%20Documents",
                    },
                ]
            }
        if path == "/drives/d-docs/root:/2026/CHECK%20LIST%20%26%20SOP%20TUGASAN:":
            return {
                "id": "it-sop",
                "name": "CHECK LIST & SOP TUGASAN",
                "folder": {"childCount": 3},
                "webUrl": "https://contoso.sharepoint.com/sites/HQ/Shared%20Documents/2026/x",
                "parentReference": {"driveId": "d-docs", "id": "it-2026"},
            }
        raise NotFound(f"no {path}", 404)


async def test_a_library_view_link_opens_its_folder_without_shares():
    g = PathGraph()
    item = await links.resolve(g, VIEW)  # type: ignore[arg-type]
    assert (item.drive_id, item.item_id, item.is_folder) == ("d-docs", "it-sop", True)
    assert not any(c.startswith("/shares/") for c in g.calls)


async def test_a_path_outside_any_library_falls_back_to_shares():
    g = PathGraph()
    from agentic.microsoft.errors import NotFound

    with pytest.raises(NotFound):  # the fake has no /shares: it says not found
        await links.resolve(g, "https://contoso.sharepoint.com/sites/HQ/Elsewhere/x")  # type: ignore[arg-type]
    assert g.calls[-1].startswith("/shares/")


async def test_a_big_folder_preview_stops_at_its_time_budget(monkeypatch):
    """A preview answers within a few seconds and says it counted only part."""
    clock = iter([0.0, 0.0, 99.0, 99.0])
    monkeypatch.setattr(links.time, "monotonic", lambda: next(clock, 99.0))

    async def kids(g, drive_id, folder_id):
        return [{"id": f"{folder_id}-sub", "name": "sub", "folder": {}}]

    monkeypatch.setattr(links, "children", kids)
    root = links.Item("d", "root", "Big", "", True)
    out = await links.walk(None, root, budget=12)  # type: ignore[arg-type]
    assert out.partial and out.folders == 1
