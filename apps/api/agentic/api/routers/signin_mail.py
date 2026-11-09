"""P92: emailed sign-in passwords (services/signin_mail.py) and the system sender.

Public:
- `POST /api/auth/email-signin {email}`: always the same 202; an active member gets a fresh
  temporary password by email when the workspace allows it (in the background).
Owner only (Settings > Sign-in emails):
- `GET|PUT /api/settings/system-mail`: the sender address and name, and the two switches.
- `POST /api/settings/system-mail/test`: a harmless test email (no password) to the owner.
Owners and admins (members.manage), on the Members page:
- `GET /api/members/signin-emails`: can emails go out, how many never signed in, the bulk send.
- `POST /api/members/signin-emails/bulk`: email everyone who has not signed in yet.
- `POST /api/members/{user_id}/email-signin`: email one person a sign-in password.
"""

from typing import Any

from fastapi import APIRouter, Depends, Request, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.valkey import valkey
from ...core.workspace_settings import SYSTEM_MAIL, clean_system_mail, system_mail
from ...i18n import Msg, render
from ...microsoft import app as ms_app
from ...microsoft import sendmail
from ...models import Membership, User, Workspace
from ...services import audit, signin_mail
from ..deps import Principal, api_error, client_ip, current_principal, require

router = APIRouter(tags=["sign-in emails"])

TEST_PER_10_MIN = 5
SETUP_DOC = "docs/SYSTEM_EMAIL_SETUP.md"


# ---------------------------------------------------------------- public


class EmailSigninIn(BaseModel):
    email: EmailStr


@router.post("/api/auth/email-signin", status_code=status.HTTP_202_ACCEPTED)
async def email_signin(body: EmailSigninIn, request: Request) -> dict[str, bool]:
    """The same answer whether or not the email has an account; the work happens after it."""
    signin_mail.spawn(signin_mail.requested(body.email.lower(), client_ip(request)))
    return {"ok": True}


# ---------------------------------------------------------------- the owner's settings


class SystemMailIn(BaseModel):
    enabled: bool = False
    address: str = Field(default="", max_length=254)
    from_name: str = Field(default="", max_length=200)
    first_login: bool = True
    forgot_password: bool = True


class SystemMailOut(BaseModel):
    enabled: bool
    address: str
    from_name: str
    first_login: bool
    forgot_password: bool
    microsoft_app: bool
    problem: str | None
    setup_doc: str = SETUP_DOC


def _owner(principal: Principal) -> None:
    if principal.role != "owner":
        raise api_error(
            status.HTTP_403_FORBIDDEN, "owner_only", "Only an owner can change sign-in emails."
        )


async def _out(db: AsyncSession, ws: Workspace) -> SystemMailOut:
    sm = system_mail(ws.settings)
    problem = await signin_mail.sender_problem(db, ws.id)
    return SystemMailOut(
        **sm.as_dict(),
        microsoft_app=(await ms_app.load(db, ws.id)).configured,
        problem=render(problem) if problem else None,
    )


@router.get("/api/settings/system-mail")
async def get_system_mail(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> SystemMailOut:
    _owner(principal)
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    return await _out(db, ws)


@router.put("/api/settings/system-mail")
async def put_system_mail(
    body: SystemMailIn,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> SystemMailOut:
    _owner(principal)
    try:
        sm = clean_system_mail(**body.model_dump())
    except ValueError as e:
        if str(e) == "from_name":
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "bad_name",
                "Use a plain name of up to 80 letters, without < > or quotes.",
            ) from e
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "bad_address",
            "Type the full email address of the mailbox, like noreply@yourcompany.com.",
        ) from e
    ws = await db.scalar(
        select(Workspace).where(Workspace.id == principal.workspace_id).with_for_update()
    )
    assert ws is not None
    before = system_mail(ws.settings).as_dict()
    ws.settings = {**(ws.settings or {}), SYSTEM_MAIL: sm.as_dict()}
    await audit.record(
        db,
        ws.id,
        principal.actor,
        "settings.system_mail_changed",
        target=ws.id,
        before=before,
        after=sm.as_dict(),
    )
    await db.commit()
    return await _out(db, ws)


@router.post("/api/settings/system-mail/test")
async def test_system_mail(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    """A harmless email (no password) from the saved sender to the owner's own address."""
    _owner(principal)
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    sm = system_mail(ws.settings)
    if not sm.address:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "no_address",
            "Save the sender address first, then send the test.",
        )
    key = f"signin_mail:test:{ws.id}"
    n = await valkey().incr(key)
    if n == 1:
        await valkey().expire(key, 600)
    if n > TEST_PER_10_MIN:
        raise api_error(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "too_many_tests",
            "That is enough test emails for now. Try again in 10 minutes.",
        )
    to = principal.user.email
    try:
        await sendmail.send(
            db,
            ws.id,
            sender=sm.address,
            from_name=sm.from_name,
            to=to,
            to_name=principal.user.name,
            subject=signin_mail.TEST_SUBJECT,
            html=signin_mail.test_email(name=principal.user.name),
        )
    except sendmail.SendError as e:
        await audit.record(
            db,
            ws.id,
            principal.actor,
            "settings.system_mail_test",
            after={"ok": False, "why": e.kind},
        )
        await db.commit()
        raise api_error(status.HTTP_502_BAD_GATEWAY, f"send_{e.kind}", e.message) from e
    await audit.record(
        db, ws.id, principal.actor, "settings.system_mail_test", after={"ok": True, "to": to}
    )
    await db.commit()
    return {"ok": True, "to": to}


# ---------------------------------------------------------------- the Members page


class BulkStatusOut(BaseModel):
    state: str
    total: int
    sent: int
    failed: int
    skipped: int
    skipped_disabled: int
    skipped_no_email: int
    skipped_recent: int
    skipped_signed_in: int
    error: str | None
    started_at: str | None
    finished_at: str | None


class SigninEmailsOut(BaseModel):
    sender_ready: bool
    problem: str | None
    never_signed_in: int
    job: BulkStatusOut | None


def _job_out(st: dict[str, Any] | None) -> BulkStatusOut | None:
    if st is None:
        return None
    err = st.get("error")
    text = render(Msg(err["template"], **err.get("vars", {}))) if isinstance(err, dict) else None
    skips = ("skipped_disabled", "skipped_no_email", "skipped_recent", "skipped_signed_in")
    return BulkStatusOut(
        state=st.get("state", "done"),
        total=st.get("total", 0),
        sent=st.get("sent", 0),
        failed=st.get("failed", 0),
        skipped=sum(int(st.get(k, 0)) for k in skips),
        error=text,
        started_at=st.get("started_at"),
        finished_at=st.get("finished_at"),
        **{k: int(st.get(k, 0)) for k in skips},
    )


@router.get("/api/members/signin-emails")
async def signin_emails(
    principal: Principal = Depends(require("members.manage")),
    db: AsyncSession = Depends(get_db),
) -> SigninEmailsOut:
    problem = await signin_mail.sender_problem(db, principal.workspace_id)
    never = await db.scalar(
        select(func.count())
        .select_from(Membership)
        .join(User, User.id == Membership.user_id)
        .where(
            Membership.workspace_id == principal.workspace_id,
            User.last_login_at.is_(None),
            User.is_active.is_(True),
            User.id != principal.user.id,
        )
    )
    return SigninEmailsOut(
        sender_ready=problem is None,
        problem=render(problem) if problem else None,
        never_signed_in=never or 0,
        job=_job_out(await signin_mail.bulk_status(principal.workspace_id)),
    )


@router.post("/api/members/signin-emails/bulk", status_code=status.HTTP_202_ACCEPTED)
async def signin_emails_bulk(
    principal: Principal = Depends(require("members.manage")),
    db: AsyncSession = Depends(get_db),
) -> BulkStatusOut:
    try:
        st = await signin_mail.start_bulk(
            db, principal.workspace_id, principal.user.id, principal.actor
        )
    except signin_mail.NotSent as e:
        raise api_error(e.status, e.code, e.message) from e
    out = _job_out(st)
    assert out is not None
    return out


@router.post("/api/members/{user_id}/email-signin")
async def email_member(
    user_id: str,
    response: Response,
    principal: Principal = Depends(require("members.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    m = await db.get(Membership, (principal.workspace_id, user_id))
    if m is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "member_not_found", "That member is not here.")
    user = await db.get(User, user_id)
    assert user is not None
    try:
        await signin_mail.send_to_member(db, principal.workspace_id, user, actor=principal.actor)
    except signin_mail.NotSent as e:
        raise api_error(e.status, e.code, e.message) from e
    except sendmail.SendError as e:
        raise api_error(status.HTTP_502_BAD_GATEWAY, f"send_{e.kind}", e.message) from e
    response.headers["Cache-Control"] = "no-store"
    return {"ok": True, "to": user.email}
