"""P92: emailed sign-in passwords.

A person who has never signed in (or forgot their password) gets a temporary password by
email from the office's system mailbox (Workspace.settings["system_mail"], sent through
Microsoft Graph by microsoft/sendmail.py). The temporary password is kept only as an argon2id
hash in users.signin_code_* with a 24-hour expiry: it never replaces the real password, so a
stranger asking for one cannot lock anyone out. Signing in with it works once, clears it and
asks for a new password (must_change_password).

Three ways a code is sent:
- automatically, after a failed sign-in of an active member who has never signed in (and got
  no code in the last 10 minutes), when the workspace has first-sign-in emails on;
- "Email me a sign-in password" on the sign-in page (public; the answer never says whether
  the email exists);
- an owner or admin (members.manage) from the Members page, for one person or everyone who
  has not signed in yet (in the background, one email about every 2 seconds).

Rate limits in Valkey (every source): per email one per 5 minutes and 5 a day (the code's
24 hours); per IP (public sources) 20 an hour. Every send is audited, never with the code.

Valkey keys: signin_mail:gap:{email} (5 min), signin_mail:day:{email} (24 h),
signin_mail:ip:{ip} (1 h), signin_mail:used:{user id} (the code they signed in with, for the
forced password change, 24 h), signin_bulk:{ws} (the bulk send's progress, 1 day),
signin_bulk:lock:{ws} (one bulk send at a time per workspace).
"""

import asyncio
import html
import json
import logging
from collections.abc import Awaitable, Callable, Coroutine
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.db import SessionLocal
from ..core.security import hash_password, temp_password, verify_password
from ..core.valkey import valkey
from ..core.workspace_settings import SystemMail, system_mail, valid_address
from ..i18n import Msg
from ..microsoft import app as ms_app
from ..microsoft import sendmail
from ..models import Membership, User, Workspace
from . import audit

log = logging.getLogger(__name__)

CODE_TTL = timedelta(hours=24)
AUTO_WINDOW = timedelta(minutes=10)
EMAIL_GAP_SECONDS = 300
EMAIL_PER_DAY = 5
DAY_SECONDS = int(CODE_TTL.total_seconds())
IP_PER_HOUR = 20
BULK_GAP_SECONDS = 2.0
BULK_THROTTLE_TRIES = 3
BULK_LOCK_SECONDS = 600
BULK_STATUS_SECONDS = 86_400
# A bulk send stops at once on these: every other email would fail the same way.
FATAL = frozenset({"not_configured", "app_refused", "denied", "no_mailbox"})

SUBJECT = "Your Agentic Office sign-in password / Kata laluan log masuk Agentic Office"
TEST_SUBJECT = "Agentic Office test email / E-mel ujian Agentic Office"

# Tests swap these for a fake clock.
sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep


def now() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------- background work

_tasks: set[asyncio.Task] = set()


def spawn(coro: Coroutine[Any, Any, Any]) -> asyncio.Task:
    """Run after the answer, kept referenced until done (an HTTP error answer drops FastAPI's
    BackgroundTasks, so the failed-sign-in path cannot use those)."""
    task = asyncio.create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return task


async def drain() -> None:
    """Wait for the background sends (tests)."""
    while _tasks:
        await asyncio.gather(*list(_tasks), return_exceptions=True)


# ---------------------------------------------------------------- the code itself


def live_code_hash(user: User | None, at: datetime | None = None) -> str | None:
    if user is None or not user.signin_code_hash or user.signin_code_expires_at is None:
        return None
    return user.signin_code_hash if user.signin_code_expires_at > (at or now()) else None


def code_matches(user: User | None, password: str) -> bool:
    """Whether `password` is the person's unexpired emailed code. Always one argon2 check
    (against a dummy hash when there is no code), so timing says nothing."""
    return verify_password(live_code_hash(user), password)


def clear_code(user: User) -> None:
    user.signin_code_hash = None
    user.signin_code_expires_at = None
    user.signin_code_sent_at = None


def _used_key(user_id: str) -> str:
    return f"signin_mail:used:{user_id}"


async def remember_used(user_id: str, code_hash: str) -> None:
    """After signing in with a code, the forced password change may take that code as the
    "temporary password" (it is already cleared from the account) for its 24 hours. The real
    password is accepted there too, as before."""
    await valkey().set(_used_key(user_id), code_hash, ex=DAY_SECONDS)


async def used_code_matches(user_id: str, password: str) -> bool:
    raw = await valkey().get(_used_key(user_id))
    return bool(raw) and verify_password(str(raw), password)


async def forget_used(user_id: str) -> None:
    await valkey().delete(_used_key(user_id))


# ---------------------------------------------------------------- rate limits


async def _ip_ok(ip: str) -> bool:
    r = valkey()
    key = f"signin_mail:ip:{ip}"
    n = await r.incr(key)
    if n == 1:
        await r.expire(key, 3600)
    return n <= IP_PER_HOUR


async def recently_sent(email: str) -> int:
    """Seconds until another email may go to this address (0: now)."""
    return max(0, int(await valkey().ttl(f"signin_mail:gap:{email}")))


async def _email_ok(email: str) -> bool:
    r = valkey()
    if not await r.set(f"signin_mail:gap:{email}", "1", ex=EMAIL_GAP_SECONDS, nx=True):
        return False
    key = f"signin_mail:day:{email}"
    n = await r.incr(key)
    if n == 1:
        await r.expire(key, DAY_SECONDS)
    return n <= EMAIL_PER_DAY


# ---------------------------------------------------------------- the emails


def _box(text: str) -> str:
    return (
        '<div style="margin:16px 0;padding:14px 18px;border:2px solid #1f2937;border-radius:8px;'
        "background:#f3f4f6;font-family:Consolas,Menlo,monospace;font-size:22px;"
        f'letter-spacing:2px;color:#111827;text-align:center">{text}</div>'
    )


def _page(inner: str) -> str:
    return (
        '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#ffffff">'
        '<div style="max-width:560px;margin:0 auto;padding:24px 20px;font-family:Segoe UI,'
        'Arial,sans-serif;font-size:15px;line-height:1.5;color:#111827">'
        f"{inner}"
        '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px">'
        '<p style="font-size:12.5px;color:#6b7280">This mailbox is not monitored. Do not '
        "reply.<br>Peti mel ini tidak dipantau. Jangan balas.</p>"
        "</div></body></html>"
    )


def signin_email(*, name: str, email: str, code: str, link: str) -> str:
    """The sign-in password email: Malay and English, the password in a box, no images."""
    n, e, u = html.escape(name), html.escape(email), html.escape(link, quote=True)
    a = f'<a href="{u}" style="color:#1d4ed8">{html.escape(link)}</a>'
    p = '<p style="margin:0 0 10px">'
    return _page(
        f"{p}Hello {n},</p>{p}Here is your temporary password for Agentic Office:</p>"
        f"{_box(html.escape(code))}"
        f"{p}Sign in at {a} with your email <b>{e}</b> and this password. It is valid for "
        "24 hours and works once. After signing in you will choose your own password.</p>"
        f"{p}Or press <b>Sign in with Microsoft</b> and use your work account.</p>"
        f"{p}If you got more than one of these emails, use the newest one. If you did not ask "
        "for it, ignore this email: your current password still works.</p>"
        '<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">'
        f"{p}Salam {n},</p>{p}Ini kata laluan sementara anda untuk Agentic Office (kotak di "
        "atas).</p>"
        f"{p}Log masuk di {a} dengan e-mel anda <b>{e}</b> dan kata laluan ini. Ia sah selama "
        "24 jam dan boleh digunakan sekali sahaja. Selepas log masuk, anda akan memilih kata "
        "laluan anda sendiri.</p>"
        f"{p}Atau tekan <b>Log masuk dengan Microsoft</b> dan gunakan akaun kerja anda.</p>"
        f"{p}Jika anda menerima lebih daripada satu e-mel ini, gunakan yang terbaharu. Jika "
        "anda tidak memintanya, abaikan e-mel ini: kata laluan semasa anda masih boleh "
        "digunakan.</p>"
    )


def test_email(*, name: str) -> str:
    n = html.escape(name)
    p = '<p style="margin:0 0 10px">'
    return _page(
        f"{p}Hello {n},</p>{p}This is a test from Agentic Office. Sign-in emails can be sent "
        "from this mailbox. No password is in this email.</p>"
        '<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">'
        f"{p}Salam {n},</p>{p}Ini ujian daripada Agentic Office. E-mel log masuk boleh "
        "dihantar daripada peti mel ini. Tiada kata laluan dalam e-mel ini.</p>"
    )


async def signin_link(db: AsyncSession, workspace_id: str) -> str:
    return (await ms_app.worker_base(db, workspace_id)).rstrip("/") + "/login"


# ---------------------------------------------------------------- who sends for whom


async def sender_for(db: AsyncSession, user: User) -> tuple[str, SystemMail] | None:
    """The first of the person's workspaces (in the order sign-in uses) with a sender set up."""
    rows = await db.execute(
        select(Workspace.id, Workspace.settings)
        .join(Membership, Membership.workspace_id == Workspace.id)
        .where(Membership.user_id == user.id)
        .order_by(Membership.created_at)
    )
    for ws_id, ws_settings in rows.all():
        sm = system_mail(ws_settings)
        if sm.ready:
            return ws_id, sm
    return None


async def any_sender(db: AsyncSession) -> SystemMail | None:
    """Some workspace sends sign-in emails (the sign-in page offers them). The same answer for
    everyone, so it says nothing about any one email."""
    for ws_settings in (await db.scalars(select(Workspace.settings))).all():
        sm = system_mail(ws_settings)
        if sm.ready and (sm.first_login or sm.forgot_password):
            return sm
    return None


# ---------------------------------------------------------------- sending one


async def issue(
    db: AsyncSession, user: User, workspace_id: str, sm: SystemMail, *, via: str, actor: str
) -> None:
    """A new temporary password for `user`, stored as a hash, then emailed. When the email
    fails the code is taken back. Raises sendmail.SendError. Commits."""
    code = temp_password()
    code_hash = hash_password(code)
    sent = now()
    user.signin_code_hash = code_hash
    user.signin_code_expires_at = sent + CODE_TTL
    user.signin_code_sent_at = sent
    user_id, email, name = user.id, user.email, user.name
    await db.commit()
    try:
        await sendmail.send(
            db,
            workspace_id,
            sender=sm.address,
            from_name=sm.from_name,
            to=email,
            to_name=name,
            subject=SUBJECT,
            html=signin_email(
                name=name, email=email, code=code, link=await signin_link(db, workspace_id)
            ),
        )
    except sendmail.SendError as e:
        # Nothing else is pending (committed above); no rollback, which would expire `user`.
        await db.execute(
            update(User)
            .where(User.id == user_id, User.signin_code_hash == code_hash)
            .values(signin_code_hash=None, signin_code_expires_at=None, signin_code_sent_at=None)
        )
        await audit.record(
            db,
            workspace_id,
            actor,
            "auth.signin_email_failed",
            target=user_id,
            after={"to": email, "via": via, "why": e.kind},
        )
        await db.commit()
        raise
    await audit.record(
        db,
        workspace_id,
        actor,
        "auth.signin_email_sent",
        target=user_id,
        after={"to": email, "via": via},
    )
    await db.commit()


# ---------------------------------------------------------------- the public sources


async def after_failed_login(email: str, ip: str) -> None:
    """A sign-in failed for `email`: a member who never signed in gets a temporary password
    (once per 10 minutes). Runs in the background for every failure, so nothing about it shows
    in the answer or its timing."""
    try:
        async with SessionLocal() as db:
            user = await db.scalar(select(User).where(User.email == email))
            if user is None or not user.is_active or user.last_login_at is not None:
                return
            if user.signin_code_sent_at and now() - user.signin_code_sent_at < AUTO_WINDOW:
                return
            found = await sender_for(db, user)
            if found is None or not found[1].first_login:
                return
            if not (await _ip_ok(ip) and await _email_ok(email)):
                return
            await issue(db, user, found[0], found[1], via="first_sign_in", actor="system")
    except sendmail.SendError:
        pass  # audited in issue()
    except Exception:  # noqa: BLE001 - a background task must never take the API down
        log.exception("first sign-in email failed")


async def requested(email: str, ip: str) -> None:
    """ "Email me a sign-in password": the same 202 for everyone; here, in the background, an
    active member gets a fresh one when the workspace allows it."""
    try:
        if not await _ip_ok(ip):
            return
        async with SessionLocal() as db:
            user = await db.scalar(select(User).where(User.email == email))
            if user is None or not user.is_active:
                return
            found = await sender_for(db, user)
            if found is None:
                return
            sm = found[1]
            never = user.last_login_at is None
            if not (sm.forgot_password or (never and sm.first_login)):
                return
            if not await _email_ok(email):
                return
            await issue(db, user, found[0], sm, via="requested", actor="system")
    except sendmail.SendError:
        pass
    except Exception:  # noqa: BLE001
        log.exception("requested sign-in email failed")


# ---------------------------------------------------------------- an owner or admin


class NotSent(Exception):
    def __init__(self, message: Msg, code: str, status: int = 409) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status


SENDER_OFF = Msg(
    "Sign-in emails are not set up yet. An owner sets the sender in Settings > Sign-in emails."
)


async def send_to_member(
    db: AsyncSession, workspace_id: str, user: User, *, actor: str, via: str = "admin"
) -> None:
    """One person, now. Raises NotSent (a plain reason) or sendmail.SendError."""
    ws = await db.get(Workspace, workspace_id)
    sm = system_mail(ws.settings if ws else None)
    if not sm.ready:
        raise NotSent(SENDER_OFF, "sender_off")
    if not user.is_active:
        raise NotSent(Msg("This account is switched off."), "account_disabled")
    if not valid_address(user.email):
        raise NotSent(Msg("This person has no email address that can get mail."), "no_email")
    if not await _email_ok(user.email):
        raise NotSent(
            Msg(
                "A sign-in password was emailed to them a moment ago (at most one every 5 "
                "minutes and 5 a day). Ask them to check their inbox and Junk folder."
            ),
            "sent_recently",
            429,
        )
    await issue(db, user, workspace_id, sm, via=via, actor=actor)


async def sender_problem(db: AsyncSession, workspace_id: str) -> Msg | None:
    """Why sign-in emails cannot go out from this workspace (None: they can)."""
    ws = await db.get(Workspace, workspace_id)
    sm = system_mail(ws.settings if ws else None)
    if not sm.ready:
        return SENDER_OFF
    if not (await ms_app.load(db, workspace_id)).configured:
        return sendmail.NOT_CONFIGURED
    return None


async def never_signed_in(db: AsyncSession, workspace_id: str, exclude: str) -> list[User]:
    """Everyone in the workspace who has never signed in (switched-off ones too: the bulk
    send counts them as skipped)."""
    return list(
        (
            await db.scalars(
                select(User)
                .join(Membership, Membership.user_id == User.id)
                .where(
                    Membership.workspace_id == workspace_id,
                    User.last_login_at.is_(None),
                    User.id != exclude,
                )
                .order_by(Membership.created_at, User.id)
            )
        ).all()
    )


# ---------------------------------------------------------------- everyone at once

INTERRUPTED = Msg(
    "The sending stopped before the end (the server restarted). Press the button again to "
    "send to the rest."
)
BROKE_OFF = Msg("The sending stopped because of an error on the server. Check the api logs.")


def _bulk_key(workspace_id: str) -> str:
    return f"signin_bulk:{workspace_id}"


def _lock_key(workspace_id: str) -> str:
    return f"signin_bulk:lock:{workspace_id}"


async def bulk_status(workspace_id: str) -> dict[str, Any] | None:
    r = valkey()
    raw = await r.get(_bulk_key(workspace_id))
    if not raw:
        return None
    st = json.loads(raw)
    if st.get("state") == "running" and not await r.exists(_lock_key(workspace_id)):
        st["state"] = "stopped"
        st["error"] = st.get("error") or {"template": INTERRUPTED.template, "vars": {}}
    return st


async def _save(workspace_id: str, st: dict[str, Any]) -> None:
    await valkey().set(_bulk_key(workspace_id), json.dumps(st), ex=BULK_STATUS_SECONDS)


async def start_bulk(db: AsyncSession, workspace_id: str, actor_user_id: str, actor: str) -> dict:
    """Start emailing everyone who has not signed in yet. Raises NotSent when the sender is not
    set up or a bulk send is already running."""
    problem = await sender_problem(db, workspace_id)
    if problem is not None:
        raise NotSent(problem, "sender_off")
    if not await valkey().set(_lock_key(workspace_id), actor, ex=BULK_LOCK_SECONDS, nx=True):
        raise NotSent(
            Msg("Sign-in emails are already being sent. Wait for that to finish."), "running"
        )
    ids = [u.id for u in await never_signed_in(db, workspace_id, actor_user_id)]
    st: dict[str, Any] = {
        "state": "running",
        "total": len(ids),
        "sent": 0,
        "failed": 0,
        "skipped_disabled": 0,
        "skipped_no_email": 0,
        "skipped_recent": 0,
        "skipped_signed_in": 0,
        "error": None,
        "started_at": now().isoformat(),
        "finished_at": None,
    }
    await _save(workspace_id, st)
    await audit.record(
        db, workspace_id, actor, "auth.signin_emails_bulk", after={"people": len(ids)}
    )
    await db.commit()
    spawn(_run_bulk(workspace_id, ids, actor, st))
    return st


async def _send_with_waits(db: AsyncSession, workspace_id: str, user: User, actor: str) -> None:
    """One person of a bulk send: a 429 is waited out (Retry-After) a few times."""
    email = user.email
    for attempt in range(BULK_THROTTLE_TRIES + 1):
        try:
            await send_to_member(db, workspace_id, user, actor=actor, via="bulk")
            return
        except sendmail.SendError as e:
            if e.kind != "throttled" or attempt == BULK_THROTTLE_TRIES:
                raise
            await valkey().expire(_lock_key(workspace_id), BULK_LOCK_SECONDS)
            await valkey().delete(f"signin_mail:gap:{email}")  # the failed try did not send
            await valkey().decr(f"signin_mail:day:{email}")
            await sleep(e.retry_after)


async def _run_bulk(workspace_id: str, ids: list[str], actor: str, st: dict[str, Any]) -> None:
    try:
        first = True
        async with SessionLocal() as db:
            for user_id in ids:
                await valkey().expire(_lock_key(workspace_id), BULK_LOCK_SECONDS)
                user = await db.get(User, user_id)
                if user is None or user.last_login_at is not None:
                    st["skipped_signed_in"] += 1
                elif not user.is_active:
                    st["skipped_disabled"] += 1
                elif not valid_address(user.email):
                    st["skipped_no_email"] += 1
                elif await recently_sent(user.email):
                    st["skipped_recent"] += 1
                else:
                    if not first:
                        await sleep(BULK_GAP_SECONDS)  # about 30 a minute: Exchange's limit
                    first = False
                    try:
                        await _send_with_waits(db, workspace_id, user, actor)
                        st["sent"] += 1
                    except NotSent as e:
                        if e.code == "sent_recently":
                            st["skipped_recent"] += 1
                        else:
                            st["failed"] += 1
                    except sendmail.SendError as e:
                        st["failed"] += 1
                        if e.kind in FATAL:
                            st["state"] = "stopped"
                            st["error"] = {
                                "template": e.message.template,
                                "vars": {k: str(v) for k, v in e.message.vars.items()},
                            }
                            break
                await _save(workspace_id, st)
        if st["state"] == "running":
            st["state"] = "done"
    except Exception:  # noqa: BLE001
        log.exception("bulk sign-in emails failed")
        st["state"] = "stopped"
        st["error"] = {"template": BROKE_OFF.template, "vars": {}}
    finally:
        st["finished_at"] = now().isoformat()
        await _save(workspace_id, st)
        await valkey().delete(_lock_key(workspace_id))
