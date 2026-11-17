# ruff: noqa: E501
"""P109 other email accounts (Connections): add one over IMAP (app password encrypted, never
shown), test it, back up every attachment into the person's own Files (resumable, de-duplicated
by content, inline pictures and over-size files skipped, "Email backup/<account>/<yyyy-mm>"),
then "you can stop using it" and disconnect (the password is deleted). Gmail through Google
sign-in too. Only the person's own accounts: an owner or admin gets 404.

The IMAP server and Gmail are fakes; nothing real is called."""

import base64
import itertools
from email.message import EmailMessage

import httpx
import pytest
from sqlalchemy import select

from agentic.core import crypto
from agentic.core.db import SessionLocal
from agentic.core.valkey import valkey
from agentic.mailbox import backup, imap
from agentic.mailbox.models import ExternalMailAccount, MailBackupJob
from agentic.models import DocFile, Event, GoogleAccount, User

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_office_roles import as_role

PDF = b"%PDF-1.4 quote " * 20
LOGO = b"\x89PNG\r\n\x1a\n" + b"x" * 50


def mail(
    subject: str, date: str, files: list[tuple[str, bytes, str]], inline_logo: bool = False
) -> bytes:
    m = EmailMessage()
    m["From"], m["To"], m["Subject"], m["Date"] = (
        "siti@client.example.com",
        "me@gmail.com",
        subject,
        date,
    )
    m.set_content("See attached.")
    if inline_logo:
        m.add_alternative('<p>Hi <img src="cid:logo1"></p>', subtype="html")
        m.get_payload()[1].add_related(LOGO, maintype="image", subtype="png", cid="<logo1>")
    for name, data, ctype in files:
        main, sub = ctype.split("/")
        m.add_attachment(data, maintype=main, subtype=sub, filename=name)
    return m.as_bytes()


class FakeBox:
    """An IMAP server: INBOX and Trash (or Gmail's All Mail), messages by UID."""

    def __init__(self, gmail: bool = False) -> None:
        self.gmail = gmail
        self.closed = 0
        self.fetched: list[int] = []
        self.folders_ = {
            "INBOX": {
                1: mail(
                    "Quote",
                    "Mon, 05 Oct 2026 10:00:00 +0800",
                    [("quote.pdf", PDF, "application/pdf")],
                    inline_logo=True,
                ),
                2: mail(
                    "Again",
                    "Tue, 03 Nov 2026 10:00:00 +0800",
                    [("quote copy.pdf", PDF, "application/pdf")],
                ),
                3: b"x" * 10,  # too big (its size says so)
                4: mail(
                    "Notes",
                    "Wed, 04 Nov 2026 10:00:00 +0800",
                    [("notes.txt", b"minutes of meeting", "text/plain")],
                ),
            },
            "Trash": {
                1: mail(
                    "Old",
                    "Mon, 05 Oct 2026 10:00:00 +0800",
                    [("old.pdf", b"%PDF old", "application/pdf")],
                )
            },
        }
        self.sel = ""

    def folders(self) -> list[imap.Folder]:
        if self.gmail:
            return [
                imap.Folder("INBOX", frozenset()),
                imap.Folder("[Gmail]/All Mail", frozenset({"\\All"})),
                imap.Folder("Trash", frozenset({"\\Trash"})),
            ]
        return [imap.Folder("INBOX", frozenset()), imap.Folder("Trash", frozenset({"\\Trash"}))]

    def select(self, name: str) -> tuple[int, int]:
        self.sel = "INBOX" if name == "[Gmail]/All Mail" else name
        return 7, len(self.folders_[self.sel])

    def uids_after(self, last: int) -> list[int]:
        return [u for u in sorted(self.folders_[self.sel]) if u > last]

    def sizes(self, uids: list[int]) -> dict[int, int]:
        return {
            u: (backup.MAX_MESSAGE + 1 if u == 3 else len(self.folders_[self.sel][u])) for u in uids
        }

    def fetch(self, uid: int) -> bytes:
        self.fetched.append(uid)
        return self.folders_[self.sel][uid]

    def close(self) -> None:
        self.closed += 1


@pytest.fixture
def fake_imap(monkeypatch):
    state = {"box": FakeBox(), "passwords": [], "refuse": False, "started": []}

    async def open_box(cfg: imap.Config):
        state["passwords"].append(cfg.password)
        if state["refuse"]:
            raise imap.ImapError(
                imap.Msg(
                    "The mail server refused the sign-in. Check the user name and use an app password if the provider asks for one."
                )
            )
        return state["box"]

    async def start(job_id: str) -> None:
        state["started"].append(job_id)

    monkeypatch.setattr(imap, "open_box", open_box)
    monkeypatch.setattr(backup, "start", start)
    yield state


async def _add(c, **extra) -> dict:
    body = {
        "email": "Me@Gmail.com",
        "provider": "gmail",
        "password": "abcd efgh ijkl mnop",
        **extra,
    }
    r = await c.post("/api/mail-accounts", json=body, headers=csrf(c))
    assert r.status_code == 201, r.text
    return r.json()


async def test_add_test_backup_resume_dedupe_and_disconnect(
    client, llm, temporal, fake_imap, monkeypatch
):
    await office(client)
    a = await _add(client)
    assert a["host"] == "imap.gmail.com" and a["port"] == 993 and a["username"] == "me@gmail.com"
    assert a["status"] == "ok" and a["password_set"] is True and "password" not in a
    assert fake_imap["passwords"] == ["abcd efgh ijkl mnop"]
    async with SessionLocal() as db:
        row = await db.get(ExternalMailAccount, a["id"])
        assert (
            "abcd" not in row.secret_enc
            and crypto.decrypt(row.secret_enc, row.aad) == "abcd efgh ijkl mnop"
        )
    assert (
        await client.post(
            "/api/mail-accounts",
            json={"email": "me@gmail.com", "provider": "gmail", "password": "x"},
            headers=csrf(client),
        )
    ).status_code == 409
    listing = (await client.get("/api/mail-accounts")).json()
    assert [x["email"] for x in listing["accounts"]] == ["me@gmail.com"] and "abcd" not in str(
        listing
    )
    assert listing["google"]["configured"] is False  # no Google sign-in set up: IMAP only

    # Back up: a job on the worker, resumable in rounds.
    r = await client.post(f"/api/mail-accounts/{a['id']}/backup", json={}, headers=csrf(client))
    assert r.status_code == 202 and r.json()["status"] == "queued"
    job_id = r.json()["id"]
    assert fake_imap["started"] == [job_id]
    again = await client.post(f"/api/mail-accounts/{a['id']}/backup", json={}, headers=csrf(client))
    assert again.json()["id"] == job_id  # one at a time

    clock = itertools.count(0, 1.0)
    monkeypatch.setattr(backup, "clock", lambda: next(clock))
    assert await backup.run_round(job_id, budget=2) == "more"  # stopped part-way
    async with SessionLocal() as db:
        j = await db.get(MailBackupJob, job_id)
        done_before = j.messages_seen
        assert j.status == "running" and 0 < done_before < 4 and j.progress["folders"] == ["INBOX"]
    monkeypatch.setattr(backup, "clock", lambda: 0.0)
    assert await backup.run_all(job_id) == "done"
    box = fake_imap["box"]
    assert 3 not in box.fetched and len(box.fetched) == len(set(box.fetched))  # nothing read twice

    async with SessionLocal() as db:
        j = await db.get(MailBackupJob, job_id)
        files = (await db.scalars(select(DocFile).order_by(DocFile.name))).all()
        uid = await db.scalar(select(User.id).where(User.email == "owner@example.com"))
        acct = await db.get(ExternalMailAccount, a["id"])
    assert (
        j.messages_seen,
        j.messages_total,
        j.saved,
        j.duplicates,
        j.too_large,
        j.inline_skipped,
    ) == (4, 4, 2, 1, 1, 1)
    assert [(f.name, f.folder) for f in files] == [
        ("notes.txt", "My workspace/Email backup/me@gmail.com/2026-11"),
        ("quote.pdf", "My workspace/Email backup/me@gmail.com/2026-10"),
    ]
    assert all(f.owner_user_id == uid for f in files) and acct.backup_done_at is not None
    async with SessionLocal() as db:
        types = [
            e.type
            for e in (await db.scalars(select(Event).where(Event.type == "mail.backup"))).all()
        ]
    assert "mail.backup" in types
    needs = (await client.get("/api/me/needs")).json()
    assert any(
        i["key"] == "mail_backup" and i["search"] == {"app": "accounts"} for i in needs["items"]
    )

    # Running it again saves nothing new (same content is kept once).
    r = await client.post(f"/api/mail-accounts/{a['id']}/backup", json={}, headers=csrf(client))
    assert await backup.run_all(r.json()["id"]) == "done"
    async with SessionLocal() as db:
        assert len((await db.scalars(select(DocFile))).all()) == 2

    # Disconnect: the account and its password are gone; the files stay.
    assert (
        await client.request(
            "DELETE", f"/api/mail-accounts/{a['id']}", json={}, headers=csrf(client)
        )
    ).status_code == 204
    async with SessionLocal() as db:
        assert await db.get(ExternalMailAccount, a["id"]) is None
        assert len((await db.scalars(select(DocFile))).all()) == 2
    needs = (await client.get("/api/me/needs")).json()
    assert not any(i["key"] == "mail_backup" for i in needs["items"])


async def test_gmail_all_mail_only_and_failures_resume(client, llm, temporal, fake_imap):
    await office(client)
    fake_imap["box"] = FakeBox(gmail=True)
    a = await _add(client)
    job_id = (
        await client.post(f"/api/mail-accounts/{a['id']}/backup", json={}, headers=csrf(client))
    ).json()["id"]
    fake_imap["refuse"] = True
    assert await backup.run_all(job_id) == "failed"
    job = (await client.get("/api/mail-accounts")).json()["accounts"][0]["backup"]
    assert job["status"] == "failed" and "refused the sign-in" in job["error"]
    fake_imap["refuse"] = False
    r = await client.post(
        f"/api/mail-accounts/backups/{job_id}/resume", json={}, headers=csrf(client)
    )
    assert r.status_code == 202 and r.json()["status"] == "queued"
    assert await backup.run_all(job_id) == "done"
    async with SessionLocal() as db:
        j = await db.get(MailBackupJob, job_id)
    assert j.progress["folders"] == ["[Gmail]/All Mail"] and j.saved == 2  # not INBOX and Trash too


async def test_only_my_own_accounts(client, llm, temporal, fake_imap):
    await office(client)
    a = await _add(client)
    admin = await as_role(client, "admin.mail@example.com", "admin")
    assert (await admin.get("/api/mail-accounts")).json()["accounts"] == []
    for method, path in (
        ("POST", f"/api/mail-accounts/{a['id']}/test"),
        ("POST", f"/api/mail-accounts/{a['id']}/backup"),
        ("PATCH", f"/api/mail-accounts/{a['id']}"),
        ("DELETE", f"/api/mail-accounts/{a['id']}"),
    ):
        r = await admin.request(method, path, json={}, headers=csrf(admin))
        assert r.status_code == 404, (method, path, r.status_code)
    job_id = (
        await client.post(f"/api/mail-accounts/{a['id']}/backup", json={}, headers=csrf(client))
    ).json()["id"]
    assert (
        await admin.post(
            f"/api/mail-accounts/backups/{job_id}/cancel", json={}, headers=csrf(admin)
        )
    ).status_code == 404
    await admin.aclose()
    # A wrong password shows the server's refusal; nothing is backed up then.
    fake_imap["refuse"] = True
    bad = await _add(client, email="me@yahoo.com", provider="yahoo")
    assert bad["status"] == "error" and "app password" in bad["last_error"]
    assert (
        await client.post(f"/api/mail-accounts/{bad['id']}/backup", json={}, headers=csrf(client))
    ).status_code == 409


async def test_private_servers_and_plain_ports_refused():
    with pytest.raises(imap.ImapError):
        await imap.check_host("127.0.0.1", 993)
    with pytest.raises(imap.ImapError):
        await imap.check_host("imap.gmail.com", 25)
    assert imap.parse_list(b'(\\HasNoChildren \\All) "/" "[Gmail]/All Mail"').everything
    assert imap.Folder("INBOX/Spam", frozenset()).skip


async def test_ask_ai_starts_my_backup(client, llm, temporal, fake_imap):
    await office(client)
    a = await _add(client)
    llm.say('{"action": "none", "answer": "Which account?"}')
    r = await client.post(
        "/api/mail-accounts/ask", json={"text": "hello there"}, headers=csrf(client)
    )
    assert r.json() == {"answer": "Which account?", "job": None} and fake_imap["started"] == []
    llm.say(
        f'{{"action": "backup", "account": "{a["id"]}", "answer": "Backing up your Gmail now."}}'
    )
    r = await client.post(
        "/api/mail-accounts/ask",
        json={"text": "back up all attachments from my Gmail"},
        headers=csrf(client),
    )
    assert (
        r.json()["answer"] == "Backing up your Gmail now." and r.json()["job"]["status"] == "queued"
    )
    assert len(fake_imap["started"]) == 1
    assert a["id"] in llm.requests[-1]["messages"][-1]["content"]


async def test_gmail_with_google_sign_in(client, llm, temporal, fake_imap, monkeypatch):
    from agentic.assistants import gmail

    await office(client)
    async with SessionLocal() as db:
        u = await db.scalar(select(User).where(User.email == "owner@example.com"))
        from agentic.models import Membership

        m = await db.scalar(select(Membership).where(Membership.user_id == u.id))
        g = GoogleAccount(
            workspace_id=m.workspace_id,
            user_id=u.id,
            email="boss@gmail.com",
            scopes="gmail.readonly",
            token_enc="",
        )
        db.add(g)
        await db.commit()
        await valkey().set(f"gtok:{g.id}", "gtoken")

    def b64(b: bytes) -> str:
        return base64.urlsafe_b64encode(b).decode().rstrip("=")

    def handler(r: httpx.Request) -> httpx.Response:
        p = r.url.path.removeprefix("/gmail/v1/users/me")
        if p == "/messages":
            return httpx.Response(200, json={"messages": [{"id": "g1"}], "resultSizeEstimate": 1})
        if p == "/messages/g1":
            return httpx.Response(
                200,
                json={
                    "internalDate": "1793500000000",
                    "payload": {
                        "headers": [{"name": "Subject", "value": "Invoice"}],
                        "parts": [
                            {
                                "mimeType": "text/plain",
                                "filename": "",
                                "body": {"data": b64(b"hi")},
                            },
                            {
                                "mimeType": "application/pdf",
                                "filename": "inv.pdf",
                                "headers": [{"name": "Content-Disposition", "value": "attachment"}],
                                "body": {"attachmentId": "A1", "size": 20},
                            },
                            {
                                "mimeType": "image/png",
                                "filename": "logo.png",
                                "headers": [
                                    {"name": "Content-Disposition", "value": "inline"},
                                    {"name": "Content-ID", "value": "<l>"},
                                ],
                                "body": {"attachmentId": "A2", "size": 9},
                            },
                        ],
                    },
                },
            )
        if p == "/messages/g1/attachments/A1":
            return httpx.Response(200, json={"data": b64(b"%PDF-1.4 invoice")})
        return httpx.Response(404)

    monkeypatch.setattr(gmail, "transport", httpx.MockTransport(handler))
    listing = (await client.get("/api/mail-accounts")).json()
    assert listing["google"]["account"]["email"] == "boss@gmail.com"
    r = await client.post("/api/mail-accounts/gmail/backup", json={}, headers=csrf(client))
    assert r.status_code == 202
    assert await backup.run_all(r.json()["id"]) == "done"
    async with SessionLocal() as db:
        j = await db.get(MailBackupJob, r.json()["id"])
        files = (await db.scalars(select(DocFile))).all()
    assert (j.saved, j.inline_skipped) == (1, 1) and files[0].name == "inv.pdf"
    assert files[0].folder.startswith("My workspace/Email backup/boss@gmail.com/2026-")


def test_notice_email_has_link_and_no_secret():
    html = backup.email_html(
        name="Siti",
        account="me@gmail.com",
        saved=3,
        done=True,
        why="",
        link="https://agent.oriondesk.space/mail?app=accounts",
    )
    assert (
        "https://agent.oriondesk.space/mail?app=accounts" in html
        and "Sandaran e-mel" in html
        and "Microsoft mailbox" in html
    )
