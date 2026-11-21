"""P109: a person's other email accounts (Connections), and backing up their attachments.

Everything is the signed-in person's own: every query is narrowed to their user id, so an
owner or admin cannot list, test, read or back up anyone else's account (the answer is 404).
The password is write-only: stored encrypted (core/crypto, bound to the row), never returned,
and deleted with the account on disconnect.

GET    /api/mail-accounts                      my accounts, Gmail (Google sign-in), backups
POST   /api/mail-accounts/discover             P122: an address in, its mail server out
POST   /api/mail-accounts                      add one (tested at once; P122: with no server
                                               given, the server found from the address)
PATCH  /api/mail-accounts/{id}                 change the server or password (tested again)
POST   /api/mail-accounts/{id}/test
DELETE /api/mail-accounts/{id}                 disconnect: the stored password is deleted
POST   /api/mail-accounts/{id}/backup          back up all attachments into my Files
POST   /api/mail-accounts/gmail/backup         the same for Gmail connected with Google sign-in
POST   /api/mail-accounts/backups/{id}/resume | /cancel
POST   /api/mail-accounts/ask                  "Ask AI", e.g. "back up my Gmail attachments"
"""

from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...assistants.access import may_assist
from ...core import crypto
from ...core.db import get_db
from ...core.fence import fence
from ...i18n import render, tr
from ...mailbox import autoconfig, backup, imap
from ...mailbox.models import ExternalMailAccount, MailBackupJob
from ...models import GoogleAccount
from ...services import audit
from ..deps import Principal, api_error, ensure_allowance, require

router = APIRouter(prefix="/api/mail-accounts", tags=["mail-accounts"])

MAX_ACCOUNTS = 10
STALE = timedelta(minutes=15)  # a running backup not heard of for this long can be resumed
Provider = Literal[
    "gmail", "yahoo", "outlook", "aol", "icloud", "zoho", "gmx", "yandex", "cpanel", "other"
]


def now() -> datetime:
    return datetime.now(UTC)


def job_out(j: MailBackupJob | None) -> dict[str, Any] | None:
    if j is None:
        return None
    stale = j.status in backup.ACTIVE and (j.updated_at or now()) < now() - STALE
    return {
        "id": j.id,
        "account_id": j.account_id,
        "source": j.source,
        "label": j.label,
        "status": j.status,
        "messages_seen": j.messages_seen,
        "messages_total": j.messages_total,
        "saved": j.saved,
        "duplicates": j.duplicates,
        "too_large": j.too_large,
        "inline_skipped": j.inline_skipped,
        "bytes_saved": j.bytes_saved,
        "error": render(j.error) if j.error else None,
        "started_at": j.started_at,
        "finished_at": j.finished_at,
        "updated_at": j.updated_at,
        "stale": stale,
    }


def account_out(a: ExternalMailAccount, job: MailBackupJob | None) -> dict[str, Any]:
    return {
        "id": a.id,
        "email": a.email,
        "provider": a.provider,
        "host": a.host,
        "port": a.port,
        "security": a.security,
        "username": a.username,
        "password_set": bool(a.secret_enc),
        "status": a.status,
        "last_error": render(a.last_error) if a.last_error else None,
        "last_checked_at": a.last_checked_at,
        "backup_done_at": a.backup_done_at,
        "created_at": a.created_at,
        "backup": job_out(job),
    }


async def _latest(db: AsyncSession, principal: Principal, **where: Any) -> MailBackupJob | None:
    q = select(MailBackupJob).where(
        MailBackupJob.workspace_id == principal.workspace_id,
        MailBackupJob.user_id == principal.user.id,
    )
    for k, v in where.items():
        q = q.where(getattr(MailBackupJob, k) == v)
    return await db.scalar(q.order_by(MailBackupJob.created_at.desc()).limit(1))


async def _mine(db: AsyncSession, principal: Principal, account_id: str) -> ExternalMailAccount:
    a = await db.get(ExternalMailAccount, account_id)
    if a is None or a.workspace_id != principal.workspace_id or a.user_id != principal.user.id:
        raise api_error(status.HTTP_404_NOT_FOUND, "not_found", "That email account is not here.")
    return a


async def _google(db: AsyncSession, principal: Principal) -> dict[str, Any]:
    from ...assistants import gmail

    configured = await gmail.app_credentials(db, principal.workspace_id) is not None
    acct = await db.scalar(
        select(GoogleAccount).where(
            GoogleAccount.workspace_id == principal.workspace_id,
            GoogleAccount.user_id == principal.user.id,
        )
    )
    return {
        # Google sign-in is set up for the office (Channels > Gmail): Gmail can be connected
        # without an app password. Otherwise IMAP with an app password only.
        "configured": configured,
        "can_connect": configured and may_assist(principal.role),
        "account": None if acct is None else {"email": acct.email, "status": acct.status},
        "backup": job_out(await _latest(db, principal, source="gmail")) if acct else None,
    }


@router.get("")
async def list_accounts(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    rows = (
        await db.scalars(
            select(ExternalMailAccount)
            .where(
                ExternalMailAccount.workspace_id == principal.workspace_id,
                ExternalMailAccount.user_id == principal.user.id,
            )
            .order_by(ExternalMailAccount.created_at)
        )
    ).all()
    return {
        "accounts": [account_out(a, await _latest(db, principal, account_id=a.id)) for a in rows],
        "google": await _google(db, principal),
        "presets": imap.PRESETS,
    }


class DiscoverIn(BaseModel):
    email: EmailStr


@router.post("/discover")
async def discover(
    body: DiscoverIn,
    principal: Principal = Depends(require("work.write")),
) -> dict[str, Any]:
    """P122: where this address's mail lives, so the person types only their address (and
    the password the provider wants). Only the domain is looked up; the answer is cached."""
    return await autoconfig.discover(str(body.email))


class AccountIn(BaseModel):
    email: EmailStr
    provider: Provider = "other"
    host: str = Field(default="", max_length=253)
    port: int = Field(default=993, ge=1, le=65535)
    security: Literal["ssl", "starttls"] = "ssl"
    username: str = Field(default="", max_length=254)
    password: str = Field(min_length=1, max_length=500)


class AccountPatch(BaseModel):
    host: str | None = Field(default=None, max_length=253)
    port: int | None = Field(default=None, ge=1, le=65535)
    security: Literal["ssl", "starttls"] | None = None
    username: str | None = Field(default=None, max_length=254)
    password: str | None = Field(default=None, min_length=1, max_length=500)


def _host(v: str) -> str:
    h = v.strip().lower().rstrip(".")
    ok = 3 < len(h) <= 253 and "." in h and all(c.isalnum() or c in ".-" for c in h)
    if not ok:
        raise api_error(
            status.HTTP_400_BAD_REQUEST,
            "bad_host",
            "Type the mail server's name, e.g. imap.gmail.com.",
        )
    return h


async def _test(db: AsyncSession, a: ExternalMailAccount, password: str | None = None) -> None:
    """Sign in once and list the folders; the account's status says how it went. Commits."""
    try:
        pw = password if password is not None else crypto.decrypt(a.secret_enc, a.aad)
        await imap.test(imap.Config(a.host, a.port, a.security, a.username, pw))
    except imap.ImapError as e:
        a.status, a.last_error = "error", str(e.args[0] if e.args else e)[:500]
    else:
        a.status, a.last_error = "ok", None
    a.last_checked_at = now()
    await db.commit()


@router.post("", status_code=status.HTTP_201_CREATED)
async def add_account(
    body: AccountIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    email = str(body.email).lower()
    count = len(
        (
            await db.scalars(
                select(ExternalMailAccount.id).where(
                    ExternalMailAccount.workspace_id == principal.workspace_id,
                    ExternalMailAccount.user_id == principal.user.id,
                )
            )
        ).all()
    )
    if count >= MAX_ACCOUNTS:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "too_many",
            "You can connect up to {n} other email accounts.",
            n=MAX_ACCOUNTS,
        )
    dup = await db.scalar(
        select(ExternalMailAccount.id).where(
            ExternalMailAccount.workspace_id == principal.workspace_id,
            ExternalMailAccount.user_id == principal.user.id,
            ExternalMailAccount.email == email,
        )
    )
    if dup:
        raise api_error(
            status.HTTP_409_CONFLICT, "exists", "That email account is already connected."
        )
    preset = imap.PRESETS.get(body.provider) or {}
    port, security, username = body.port, body.security, body.username
    provider = body.provider
    if not (body.host or preset.get("host")):
        # P122: no server typed: the one found from the address (mailbox/autoconfig.py).
        found = await autoconfig.discover(email)
        if not found["imap"]:
            raise api_error(
                status.HTTP_400_BAD_REQUEST,
                "no_server",
                "The mail server for {domain} was not found. Open Advanced and type it.",
                domain=found["domain"],
            )
        preset = found["imap"]
        port, security = int(preset["port"]), preset["security"]
        username = username or found["username"]
        if provider == "other" and found["provider"] in imap.PRESETS:
            provider = found["provider"]
    host = _host(body.host or str(preset.get("host") or ""))
    a = ExternalMailAccount(
        workspace_id=principal.workspace_id,
        user_id=principal.user.id,
        email=email,
        provider=provider,
        host=host,
        port=port,
        security=security,
        username=(username.strip() or email)[:254],
    )
    db.add(a)
    await db.flush()
    a.secret_enc = crypto.encrypt(body.password, a.aad)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "mail_account.added",
        target=a.id,
        after={"email": email, "host": host},
    )
    await db.commit()
    await _test(db, a, body.password)
    return account_out(a, None)


@router.patch("/{account_id}")
async def change_account(
    account_id: str,
    body: AccountPatch,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    a = await _mine(db, principal, account_id)
    if body.host is not None:
        a.host = _host(body.host)
    if body.port is not None:
        a.port = body.port
    if body.security is not None:
        a.security = body.security
    if body.username is not None and body.username.strip():
        a.username = body.username.strip()
    if body.password is not None:
        a.secret_enc = crypto.encrypt(body.password, a.aad)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "mail_account.changed",
        target=a.id,
        after={"host": a.host, "password": body.password is not None},
    )
    await db.commit()
    await _test(db, a)
    return account_out(a, await _latest(db, principal, account_id=a.id))


@router.post("/{account_id}/test")
async def test_account(
    account_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    a = await _mine(db, principal, account_id)
    if not a.secret_enc:
        raise api_error(status.HTTP_409_CONFLICT, "no_password", "Type the password again.")
    await _test(db, a)
    return account_out(a, await _latest(db, principal, account_id=a.id))


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_account(
    account_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Disconnect: the account and its stored password are deleted (running backups stop;
    files already saved stay in the person's Files)."""
    a = await _mine(db, principal, account_id)
    for j in (
        await db.scalars(
            select(MailBackupJob).where(
                MailBackupJob.account_id == a.id, MailBackupJob.status.in_(backup.ACTIVE)
            )
        )
    ).all():
        j.status, j.finished_at = "cancelled", now()
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "mail_account.removed",
        target=a.id,
        before={"email": a.email},
    )
    await db.delete(a)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------- backups


async def _begin(
    db: AsyncSession, principal: Principal, *, source: str, label: str, account_id: str | None
) -> MailBackupJob:
    where: dict[str, Any] = {"account_id": account_id} if account_id else {"source": source}
    last = await _latest(db, principal, **where)
    if last is not None and last.status in backup.ACTIVE:
        if job_out(last)["stale"]:  # type: ignore[index]
            await backup.start(last.id)
        return last
    job = MailBackupJob(
        workspace_id=principal.workspace_id,
        user_id=principal.user.id,
        account_id=account_id,
        source=source,
        label=label,
        status="queued",
        progress={},
    )
    db.add(job)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "mail_backup.started",
        target=label[:200],
        after={"source": source},
    )
    await db.commit()
    await backup.start(job.id)
    await db.refresh(job)
    return job


@router.post("/gmail/backup", status_code=status.HTTP_202_ACCEPTED)
async def start_gmail_backup(
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    g = await db.scalar(
        select(GoogleAccount).where(
            GoogleAccount.workspace_id == principal.workspace_id,
            GoogleAccount.user_id == principal.user.id,
        )
    )
    if g is None:
        raise api_error(status.HTTP_409_CONFLICT, "no_gmail", "Connect Gmail first.")
    job = await _begin(db, principal, source="gmail", label=g.email, account_id=None)
    return job_out(job) or {}


@router.post("/{account_id}/backup", status_code=status.HTTP_202_ACCEPTED)
async def start_backup(
    account_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    a = await _mine(db, principal, account_id)
    if a.status != "ok":
        raise api_error(
            status.HTTP_409_CONFLICT,
            "not_working",
            "Test the account first: the office could not sign in to it yet.",
        )
    job = await _begin(db, principal, source="imap", label=a.email, account_id=a.id)
    return job_out(job) or {}


async def _job(db: AsyncSession, principal: Principal, job_id: str) -> MailBackupJob:
    j = await db.get(MailBackupJob, job_id)
    if j is None or j.workspace_id != principal.workspace_id or j.user_id != principal.user.id:
        raise api_error(status.HTTP_404_NOT_FOUND, "not_found", "That backup is not here.")
    return j


@router.post("/backups/{job_id}/resume", status_code=status.HTTP_202_ACCEPTED)
async def resume_backup(
    job_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Go on from where a stopped (or silent) backup left off."""
    j = await _job(db, principal, job_id)
    if j.status == "done" or (j.status in backup.ACTIVE and not job_out(j)["stale"]):  # type: ignore[index]
        return job_out(j) or {}
    if j.source == "imap" and j.account_id is None:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "disconnected",
            "The account was disconnected. Connect it again to back it up.",
        )
    j.status, j.error, j.finished_at, j.notified_at = "queued", None, None, None
    await db.commit()
    await backup.start(j.id)
    await db.refresh(j)
    return job_out(j) or {}


@router.post("/backups/{job_id}/cancel")
async def cancel_backup(
    job_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    j = await _job(db, principal, job_id)
    if j.status in backup.ACTIVE:
        j.status, j.finished_at = "cancelled", now()
        await db.commit()
    return job_out(j) or {}


# ---------------------------------------------------------------- Ask AI


class AskIn(BaseModel):
    text: str = Field(min_length=3, max_length=1000)


ASK = (
    "My other email accounts (data):\n{accounts}\n\nMy request: {text}\n\n"
    "You can do one thing here: back up all attachments of one of these accounts into my "
    'Files. Answer as JSON only: {{"action": "backup" or "none", "account": "<the id from the '
    'list>", "answer": "one short sentence to me, in the language I wrote in"}}. Choose '
    '"backup" only when I clearly ask to back up, save or copy attachments or files from one '
    "account in the list; otherwise explain what you can do."
)


@router.post("/ask")
async def ask(
    body: AskIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """The person asks in their own words; a backup they clearly ask for starts at once (it
    only copies their own attachments into their own Files)."""
    from ...engine import gateway
    from ...microsoft import assist

    await ensure_allowance(db, principal)
    listing = await list_accounts(principal, db)
    choices: dict[str, dict[str, Any]] = {
        a["id"]: {"email": a["email"], "provider": a["provider"], "working": a["status"] == "ok"}
        for a in listing["accounts"]
    }
    if listing["google"]["account"]:
        choices["gmail"] = {
            "email": listing["google"]["account"]["email"],
            "provider": "gmail",
            "working": True,
        }
    lines = "\n".join(
        f"- id {k}: {v['email']} ({v['provider']})" + ("" if v["working"] else " [not working]")
        for k, v in choices.items()
    )
    prompt = ASK.format(accounts=fence(lines or "(none)"), text=body.text.strip())
    try:
        raw = await assist.ask(
            db,
            principal.workspace_id,
            prompt,
            task="mail_accounts.ask",
            temperature=0.1,
            max_tokens=300,
        )
    except gateway.GatewayUnavailable as e:
        raise api_error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "ai_unavailable",
            "No AI model could answer right now. Try again in a minute.",
        ) from e
    got = assist.parse_json(raw)
    got = got if isinstance(got, dict) else {}
    answer = str(got.get("answer") or "").strip()[:500]
    target = str(got.get("account") or "")
    if got.get("action") != "backup" or target not in choices:
        fallback = tr(
            "I can back up the attachments of an account listed here into your Files. Say "
            "which one."
        )
        return {"answer": answer or fallback, "job": None}
    if target == "gmail":
        job = await start_gmail_backup(principal, db)
    else:
        a = await _mine(db, principal, target)
        if a.status != "ok":
            why = tr("Test {email} first: the office could not sign in to it yet.", email=a.email)
            return {"answer": why, "job": None}
        job = job_out(await _begin(db, principal, source="imap", label=a.email, account_id=a.id))
    return {"answer": answer, "job": job}
