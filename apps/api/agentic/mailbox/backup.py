"""P109: back up every attachment of a person's other email account into their own Files.

A job (MailBackupJob) runs on the worker (workflows/mailbackup_workflows.py) in rounds of a
few minutes; each round picks up where the last one stopped (`progress`), so a restart, a
deploy or a dropped connection loses nothing. When the worker is unreachable the API runs it
in the background itself.

- IMAP accounts: every folder except trash, spam and drafts (Gmail: only "All Mail", which
  holds every message once), oldest first by UID, read only (BODY.PEEK).
- Gmail connected with Google sign-in (assistants/gmail.py): the Gmail API, messages with
  attachments, page by page.

Each attachment goes through the files service like an upload (stored, scanned, read):
"My workspace/Email backup/<account>/<yyyy-mm>" (the month the mail was sent), owned by the
person. Skipped: inline pictures (logos, signatures), files over the upload limit
(documents.service.MAX_FILE_BYTES, 20 MB), and content the person's backup already holds (same
SHA-256). When it is done the person is told in the app (and by email when the office's system
mail is set up) that they can stop using the account, with a link to disconnect it.
"""

import asyncio
import base64
import email
import email.policy
import email.utils
import hashlib
import logging
import time
from collections.abc import Coroutine
from datetime import UTC, datetime
from email.message import EmailMessage
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from ..core import crypto
from ..core.db import SessionLocal
from ..i18n import Msg, render
from ..models import DocFile, GoogleAccount, Membership, User
from . import imap
from .models import ExternalMailAccount, MailBackupJob

log = logging.getLogger(__name__)

ROUND_SECONDS = 240.0  # one worker round; the next round continues
MAX_MESSAGE = 60 * 1024 * 1024  # a whole message bigger than this is not downloaded
BATCH = 50
FOLDER_EN, FOLDER_MS = "Email backup", "Sandaran e-mel"
ACTIVE = ("queued", "running")
clock = time.monotonic  # tests replace it to stop a round part-way


def now() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------- where files go


async def root_folder(db: AsyncSession, workspace_id: str, user_id: str) -> str:
    """The person's own "My workspace/Email backup" in the office's folder language."""
    from ..documents import provenance

    m = await db.get(Membership, (workspace_id, user_id))
    lang = await provenance.folder_lang(db, workspace_id, m.branch_id if m else None)
    return "Meja kerja saya/" + FOLDER_MS if lang == "ms" else "My workspace/" + FOLDER_EN


def _clean(part: str) -> str:
    return "".join(c if c.isalnum() or c in "@._-+ " else "_" for c in part).strip()[:120] or "-"


def folder_for(root: str, label: str, when: datetime | None) -> str:
    return f"{root}/{_clean(label.lower())}/{(when or now()):%Y-%m}"


# ---------------------------------------------------------------- reading one message


def mail_time(msg: EmailMessage) -> datetime | None:
    try:
        t = email.utils.parsedate_to_datetime(str(msg.get("Date") or ""))
    except (TypeError, ValueError, IndexError):
        return None
    if t is None:
        return None
    return t if t.tzinfo else t.replace(tzinfo=UTC)


def attachments(msg: EmailMessage) -> list[tuple[str, str, bytes, bool]]:
    """(name, type, bytes, inline picture?) of every file in a message. An inline picture is
    one shown in the text (a logo, a signature): disposition inline or a Content-ID, without
    being marked an attachment."""
    out: list[tuple[str, str, bytes, bool]] = []
    for part in msg.walk():
        if part.is_multipart():
            continue
        disp = part.get_content_disposition()
        name = part.get_filename()
        ctype = part.get_content_type()
        inline = (
            disp != "attachment"
            and part.get_content_maintype() == "image"
            and (disp == "inline" or bool(part.get("Content-ID")))
        )
        if inline:
            out.append((str(name or "inline"), ctype, b"", True))
            continue
        if not name and disp != "attachment":
            continue
        try:
            data = part.get_payload(decode=True) or b""
        except Exception:  # noqa: BLE001 - a broken part is skipped, not the whole mail
            log.info("a broken attachment part was skipped")
            continue
        if not isinstance(data, bytes):
            continue
        out.append((str(name or "attachment"), ctype, data, inline))
    return out


# ---------------------------------------------------------------- saving


class _Saver:
    """Saves files for one job: dedupe by content, the right folder, reading afterwards."""

    def __init__(self, db: AsyncSession, job: MailBackupJob, root: str, branch: str | None):
        self.db, self.job, self.root, self.branch = db, job, root, branch
        self.to_read: list[str] = []

    async def known(self, digest: str) -> bool:
        return (
            await self.db.scalar(
                select(DocFile.id)
                .where(
                    DocFile.workspace_id == self.job.workspace_id,
                    DocFile.owner_user_id == self.job.user_id,
                    DocFile.sha256 == digest,
                    DocFile.folder.like(self.root.replace("%", "\\%") + "/%"),
                )
                .limit(1)
            )
        ) is not None

    async def save(
        self, name: str, ctype: str, data: bytes, inline: bool, when: datetime | None, subject: str
    ) -> None:
        from ..documents import service as doc_service

        job = self.job
        if inline:
            job.inline_skipped += 1
            return
        if not data:
            return
        if len(data) > doc_service.MAX_FILE_BYTES:
            job.too_large += 1
            return
        if await self.known(hashlib.sha256(data).hexdigest()):
            job.duplicates += 1
            return
        f = await doc_service.create_file(
            self.db,
            workspace_id=job.workspace_id,
            name=name,
            data=data,
            created_by=f"user:{job.user_id}",
            mime=ctype,
            branch_id=self.branch,
            source="upload",
            folder=folder_for(self.root, job.label, when),
            source_path=f"{job.label}: {subject}"[:500],
            origin="uploaded",
            owner_user_id=job.user_id,
        )
        job.saved += 1
        job.bytes_saved += len(data)
        self.to_read.append(f.id)

    async def flush(self) -> None:
        """Commit, then hand the new files to the reader (scan, text, search)."""
        flag_modified(self.job, "progress")
        await self.db.commit()
        from ..agents.pc_tools import _start_reading

        ids, self.to_read = self.to_read, []
        for fid in ids:
            await _start_reading(fid)


# ---------------------------------------------------------------- one round


class Stop(Exception):
    """The job cannot go on (a sentence for the person)."""


async def run_round(job_id: str, budget: float = ROUND_SECONDS) -> str:
    """Work on a job for about `budget` seconds. "more" (call again), "done", "failed",
    "cancelled" or "gone"."""
    async with SessionLocal() as db:
        job = await db.get(MailBackupJob, job_id)
        if job is None:
            return "gone"
        if job.status not in ACTIVE:
            return job.status
        if job.status == "queued":
            job.status, job.started_at, job.error = "running", job.started_at or now(), None
            await db.commit()
            await _publish(job)
        m = await db.get(Membership, (job.workspace_id, job.user_id))
        root = await root_folder(db, job.workspace_id, job.user_id)
        saver = _Saver(db, job, root, m.branch_id if m else None)
        deadline = clock() + budget
        try:
            if job.source == "gmail":
                more = await _gmail_round(db, job, saver, deadline)
            else:
                more = await _imap_round(db, job, saver, deadline)
        except (Stop, imap.ImapError) as e:
            await saver.flush()
            job.status, job.finished_at = "failed", now()
            job.error = render(e.args[0] if e.args else Msg("The backup stopped."))[:500]
            await db.commit()
            await finished(db, job)
            return "failed"
        await saver.flush()
        if more:
            await _publish(job)
            return "more"
        job.status, job.finished_at = "done", now()
        if job.account_id:
            acct = await db.get(ExternalMailAccount, job.account_id)
            if acct is not None:
                acct.backup_done_at = job.finished_at
        await db.commit()
        await finished(db, job)
        return "done"


async def run_all(job_id: str) -> str:
    """Every round until the job ends (the fallback when the worker is down, and tests)."""
    for _ in range(10_000):
        result = await run_round(job_id)
        if result != "more":
            return result
    return "more"


async def _imap_round(db: AsyncSession, job: MailBackupJob, saver: _Saver, deadline: float) -> bool:
    acct = await db.get(ExternalMailAccount, job.account_id) if job.account_id else None
    if acct is None or not acct.secret_enc:
        raise Stop(Msg("The account was disconnected, so the backup stopped."))
    cfg = imap.Config(
        host=acct.host,
        port=acct.port,
        security=acct.security,
        username=acct.username,
        password=crypto.decrypt(acct.secret_enc, acct.aad),
    )
    box = await imap.open_box(cfg)
    try:
        prog: dict[str, Any] = dict(job.progress or {})
        if "folders" not in prog:
            folders = await imap.run(box.folders)
            everything = [f for f in folders if f.everything]
            chosen = everything[:1] or [f for f in folders if not f.skip]
            prog["folders"] = [f.name for f in chosen]
            prog["state"] = {}
            total = 0
            for name in prog["folders"]:
                _, count = await imap.run(box.select, name)
                total += count
            job.messages_total = total
            job.progress = prog
            flag_modified(job, "progress")
            await db.commit()
        state: dict[str, Any] = prog.setdefault("state", {})
        for name in prog["folders"]:
            st = dict(state.get(name) or {"validity": 0, "last": 0, "done": False})
            if st.get("done"):
                continue
            validity, _ = await imap.run(box.select, name)
            if st["validity"] and st["validity"] != validity:
                st["last"] = 0  # the server renumbered the folder: read it again (dupes skip)
            st["validity"] = validity
            uids = await imap.run(box.uids_after, int(st["last"]))
            for i in range(0, len(uids), BATCH):
                chunk = uids[i : i + BATCH]
                sizes = await imap.run(box.sizes, chunk)
                for uid in chunk:
                    if clock() > deadline:
                        state[name] = st
                        job.progress = prog
                        return True
                    if sizes.get(uid, 0) > MAX_MESSAGE:
                        job.too_large += 1
                    else:
                        raw = await imap.run(box.fetch, uid)
                        await _save_message(saver, raw)
                    job.messages_seen += 1
                    st["last"] = uid
                    state[name] = st
                    job.progress = prog
                    await saver.flush()
            st["done"] = True
            state[name] = st
            job.progress = prog
            await saver.flush()
        return False
    finally:
        await imap.run(box.close)


async def _save_message(saver: _Saver, raw: bytes) -> None:
    if not raw:
        return
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    assert isinstance(msg, EmailMessage)
    when, subject = mail_time(msg), str(msg.get("Subject") or "")
    for name, ctype, data, inline in attachments(msg):
        await saver.save(name, ctype, data, inline, when, subject)


# ---------------------------------------------------------------- Gmail (Google sign-in)


async def _gmail_round(
    db: AsyncSession, job: MailBackupJob, saver: _Saver, deadline: float
) -> bool:
    from ..assistants import gmail

    acct = await db.scalar(
        select(GoogleAccount).where(
            GoogleAccount.workspace_id == job.workspace_id, GoogleAccount.user_id == job.user_id
        )
    )
    if acct is None:
        raise Stop(Msg("Gmail was disconnected, so the backup stopped."))
    try:
        token = await gmail.access_token(db, acct)
        prog: dict[str, Any] = dict(job.progress or {})
        while True:
            params: dict[str, Any] = {"q": "has:attachment", "maxResults": BATCH}
            if prog.get("page"):
                params["pageToken"] = prog["page"]
            listing = await gmail._api(token, "GET", "/messages", params=params)  # noqa: SLF001
            if not job.messages_total:
                job.messages_total = int(listing.get("resultSizeEstimate") or 0)
            ids = [str(m.get("id")) for m in listing.get("messages") or []]
            for n, mid in enumerate(ids):
                if n < int(prog.get("skip") or 0):
                    continue
                if clock() > deadline:
                    prog["skip"] = n
                    job.progress = prog
                    return True
                await _gmail_message(token, mid, saver)
                job.messages_seen += 1
                prog["skip"] = n + 1
                job.progress = prog
                await saver.flush()
            nxt = listing.get("nextPageToken")
            prog["page"], prog["skip"] = nxt, 0
            job.progress = prog
            await saver.flush()
            if not nxt:
                return False
    except gmail.GmailError as e:
        raise Stop(Msg("Gmail refused: {why}", why=str(e)[:200])) from e


def _b64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


async def _gmail_message(token: str, mid: str, saver: _Saver) -> None:
    from ..assistants import gmail
    from ..documents import service as doc_service

    msg = await gmail._api(token, "GET", f"/messages/{mid}", params={"format": "full"})  # noqa: SLF001
    headers = {
        h.get("name", "").lower(): h.get("value", "")
        for h in (msg.get("payload") or {}).get("headers") or []
    }
    try:
        when: datetime | None = datetime.fromtimestamp(int(msg.get("internalDate")) / 1000, UTC)
    except (TypeError, ValueError):
        when = None
    subject = headers.get("subject", "")

    def walk(p: dict[str, Any]) -> list[dict[str, Any]]:
        parts = [p]
        for c in p.get("parts") or []:
            parts += walk(c)
        return parts

    for p in walk(msg.get("payload") or {}):
        name = p.get("filename") or ""
        body = p.get("body") or {}
        if not name or not (body.get("attachmentId") or body.get("data")):
            continue
        ph = {h.get("name", "").lower(): h.get("value", "") for h in p.get("headers") or []}
        disp = ph.get("content-disposition", "").lower()
        ctype = str(p.get("mimeType") or "")
        inline = (
            not disp.startswith("attachment")
            and ctype.startswith("image/")
            and (disp.startswith("inline") or bool(ph.get("content-id")))
        )
        if inline:
            saver.job.inline_skipped += 1
            continue
        if int(body.get("size") or 0) > doc_service.MAX_FILE_BYTES:
            saver.job.too_large += 1
            continue
        if body.get("attachmentId"):
            got = await gmail._api(  # noqa: SLF001
                token, "GET", f"/messages/{mid}/attachments/{body['attachmentId']}"
            )
            data = _b64(str(got.get("data") or ""))
        else:
            data = _b64(str(body.get("data") or ""))
        await saver.save(name, ctype, data, False, when, subject)


# ---------------------------------------------------------------- starting and telling


_tasks: set[asyncio.Task] = set()


def _spawn(coro: Coroutine[Any, Any, Any]) -> None:
    task = asyncio.create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def launch(job_id: str) -> None:
    """Start the job on the worker (Temporal). Raises when the worker cannot be reached."""
    from ..core.config import settings
    from ..core.temporal import temporal_client
    from ..workflows.mailbackup_workflows import MailBackupWorkflow

    client = await temporal_client()
    await client.start_workflow(
        MailBackupWorkflow.run,
        job_id,
        id=f"mail-backup-{job_id}-{now():%Y%m%d%H%M%S%f}",
        task_queue=settings.temporal_task_queue,
    )


async def start(job_id: str) -> None:
    """On the worker, else here in the background (a backup must not depend on the queue)."""
    try:
        await launch(job_id)
    except Exception:  # noqa: BLE001
        log.warning("worker unavailable; mail backup %s runs in the API", job_id, exc_info=True)
        _spawn(run_all(job_id))


async def _publish(job: MailBackupJob) -> None:
    from ..services import events

    await events.publish(
        job.workspace_id,
        "mail.backup",
        {
            "viewer_ids": [job.user_id],
            "job_id": job.id,
            "status": job.status,
            "saved": job.saved,
            "seen": job.messages_seen,
            "total": job.messages_total,
        },
    )


DONE_TITLE = Msg("Email backup finished")
DONE_BODY = Msg(
    "All attachments from {account} are saved in your Files ({n} files). You can now stop "
    "using {account} and use your Microsoft mailbox. Disconnect it on the Microsoft 365 page."
)
FAILED_TITLE = Msg("Email backup stopped")
FAILED_BODY = Msg(
    "The backup of {account} stopped: {why} Files saved so far stay in your Files; press "
    "Resume on the Microsoft 365 page to continue."
)
PAGE = "/mail?app=accounts"


async def finished(db: AsyncSession, job: MailBackupJob) -> None:
    """Tell the person: live on the page, on their devices and linked phone, and by email
    when the office's system mail is set up. Never raises."""
    from ..channels import deliver

    await _publish(job)
    if job.notified_at is not None:
        return
    try:
        done = job.status == "done"
        title = DONE_TITLE if done else FAILED_TITLE
        body = (
            Msg(DONE_BODY.template, account=job.label, n=job.saved)
            if done
            else Msg(FAILED_BODY.template, account=job.label, why=job.error or "")
        )
        ids = await deliver.notify_user(
            db, job.workspace_id, job.user_id, title, body, PAGE, dedupe=f"mailbackup:{job.id}"
        )
        await deliver.start(ids)
        await _email(db, job, done)
        job.notified_at = now()
        await db.commit()
    except Exception:  # noqa: BLE001 - the backup is done either way
        log.warning("mail backup %s: notice not sent", job.id, exc_info=True)


EMAIL_SUBJECT_DONE = "Your email backup is done / Sandaran e-mel anda selesai"
EMAIL_SUBJECT_FAILED = "Your email backup stopped / Sandaran e-mel anda terhenti"


def email_html(*, name: str, account: str, saved: int, done: bool, why: str, link: str) -> str:
    """Plain BM + EN, the deep link, no secrets."""
    import html as h

    a, n, w, u = h.escape(account), saved, h.escape(why), h.escape(link)
    if done:
        en = (
            f"All attachments from {a} are saved in your Files ({n} files, in My workspace > "
            f"Email backup). You can now stop using {a} and use your Microsoft mailbox. "
            "Disconnect it here:"
        )
        ms = (
            f"Semua lampiran daripada {a} sudah disimpan dalam Fail anda ({n} fail, dalam Meja "
            f"kerja saya > Sandaran e-mel). Anda boleh berhenti guna {a} dan guna peti mel "
            "Microsoft anda. Putuskan sambungannya di sini:"
        )
    else:
        en = (
            f"The backup of {a} stopped: {w} Files saved so far stay in your Files. Resume it here:"
        )
        ms = (
            f"Sandaran {a} terhenti: {w} Fail yang sudah disimpan kekal dalam Fail anda. "
            "Sambung semula di sini:"
        )
    who = h.escape(name or "")
    return (
        f'<p>Hi {who},</p><p>{en}</p><p><a href="{u}">{u}</a></p><hr>'
        f'<p>Hai {who},</p><p>{ms}</p><p><a href="{u}">{u}</a></p>'
    )


async def _email(db: AsyncSession, job: MailBackupJob, done: bool) -> None:
    from ..core.workspace_settings import system_mail
    from ..microsoft import app as ms_app
    from ..microsoft import sendmail
    from ..models import Workspace

    ws = await db.get(Workspace, job.workspace_id)
    sm = system_mail(ws.settings if ws else None)
    user = await db.get(User, job.user_id)
    if not sm.ready or user is None or not user.email:
        return
    link = (await ms_app.worker_base(db, job.workspace_id)).rstrip("/") + PAGE
    try:
        await sendmail.send(
            db,
            job.workspace_id,
            sender=sm.address,
            from_name=sm.from_name,
            to=user.email,
            to_name=user.name,
            subject=EMAIL_SUBJECT_DONE if done else EMAIL_SUBJECT_FAILED,
            html=email_html(
                name=user.name,
                account=job.label,
                saved=job.saved,
                done=done,
                why=job.error or "",
                link=link,
            ),
        )
    except sendmail.SendError as e:
        log.info("mail backup %s: email not sent (%s)", job.id, e.kind)
