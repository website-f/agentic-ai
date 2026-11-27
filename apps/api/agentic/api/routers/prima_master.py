"""P132: Prima keeps the organization and the people; this is the office's view of that.

GET  /api/prima-master             on or not, the last run's summary and what is held (org.manage
                                    or members.manage, to show the Organization page read-only)
POST /api/prima-master/run         follow Prima now (owner or global admin); the first run switches
                                    the office to following Prima for good
POST /api/prima-master/apply-held  apply what was held: lower access levels and accounts Prima
                                    closed (owner only), after the owner looked at the list
GET  /api/prima-master/unknown-signins      P134: emails that asked for a sign-in password but
                                            nobody here has (owner, global admin, IT support)
POST /api/prima-master/unknown-signins/add  P141: add them as office members, each named from
                                            their email (they change it in their own settings);
                                            IT support's call waits for approval (org/held.py)
"""

from __future__ import annotations

import logging
import re

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.workspace_settings import valid_address
from ...i18n import Msg, current_lang, render
from ...microsoft import sendmail
from ...models import User, Workspace
from ...prima import autolink, client, mirror
from ...prima.client import PrimaError
from ..deps import Principal, api_error, current_principal
from ..schemas import Role

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/prima-master", tags=["prima"])


class HeldOut(BaseModel):
    user_id: str
    name: str
    kind: str  # "down": a lower access level; "close": Prima closed their access
    from_role: str | None = None
    to_role: str | None = None


class MasterOut(BaseModel):
    on: bool
    summary: dict[str, int] = {}
    held: list[HeldOut] = []
    can_run: bool = False
    can_apply_held: bool = False


async def _state(db: AsyncSession, p: Principal) -> MasterOut:
    w = await db.get(Workspace, p.workspace_id)
    st = ((w.settings or {}).get(mirror.STATE_KEY) or {}) if w else {}
    held = [
        HeldOut(
            user_id=str(h.get("user_id")),
            name=str(h.get("name") or ""),
            kind=str(h.get("kind") or ""),
            from_role=h.get("from"),
            to_role=h.get("to"),
        )
        for h in (st.get("held") or [])
        if isinstance(h, dict)
    ]
    return MasterOut(
        on=bool(st.get("on")),
        summary={k: int(v) for k, v in (st.get("summary") or {}).items() if isinstance(v, int)},
        held=held if p.role in ("owner", "admin") else [],
        can_run=p.role in ("owner", "admin") and client.enabled(p.workspace_id),
        can_apply_held=p.role == "owner" and bool(held),
    )


@router.get("")
async def master_state(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> MasterOut:
    return await _state(db, principal)


async def _run(db: AsyncSession, principal: Principal, held_too: bool) -> MasterOut:
    try:
        await mirror.run(db, principal.workspace_id, held_too=held_too)
    except PrimaError as e:
        raise api_error(status.HTTP_503_SERVICE_UNAVAILABLE, "prima_down", e.message) from e
    return await _state(db, principal)


@router.post("/run")
async def master_run(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> MasterOut:
    if principal.role not in ("owner", "admin"):
        raise api_error(
            status.HTTP_403_FORBIDDEN, "forbidden", "Only an owner or a global admin can do this."
        )
    return await _run(db, principal, held_too=False)


@router.post("/apply-held")
async def master_apply_held(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> MasterOut:
    if principal.role != "owner":
        raise api_error(status.HTTP_403_FORBIDDEN, "forbidden", "Only an owner can do this.")
    return await _run(db, principal, held_too=True)


class UnknownOut(BaseModel):
    email: str
    at: str


@router.get("/unknown-signins")
async def unknown_signins(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> list[UnknownOut]:
    """P134: emails that asked for a sign-in password in the last 7 days but nobody signs in with
    (the person HR still has to add in Prima). Those added since are left out."""
    from sqlalchemy import func, select

    from ...models import User
    from ...services import signin_mail

    if principal.role not in ("owner", "admin", "it_support"):
        raise api_error(
            status.HTTP_403_FORBIDDEN, "forbidden", "Only the office's admins see this."
        )
    rows = await signin_mail.unknown_recent()
    if not rows:
        return []
    known = set(
        (
            await db.scalars(
                select(func.lower(User.email)).where(
                    func.lower(User.email).in_([e for e, _ in rows])
                )
            )
        ).all()
    )
    return [UnknownOut(email=e, at=at.isoformat()) for e, at in rows if e not in known]


# ---------------------------------------------------------------- P141: add them here

# Fitri, 27 Nov 2026: "there are 10 people who want access but don't have their data here. Make
# it so we global admins can manage that: I can auto add them into the system and name them based
# on their email, but they can change their name later in settings" (PUT /api/account/name).
#
# Each is added exactly as POST /api/members adds one (members.add_one: the role ceiling, the
# company and department rules, the audit row), in a savepoint of its own, so one refusal never
# undoes the others. They are office members only: the Prima mirror (prima/mirror.py) walks
# Prima's accounts and records and never removes, moves or re-roles anyone it did not link itself.

_NAME_PARTS = re.compile(r"[._\-+]+|\d+")
FALLBACK_NAME = "New member"


def name_from_email(email: str) -> str:
    """'zulaikha_zul@outlook.com' -> 'Zulaikha Zul'; 'azeemrosele0002@...' -> 'Azeemrosele'."""
    local = (email or "").split("@", 1)[0]
    words = [w for w in _NAME_PARTS.split(local) if w]
    name = " ".join(w[:1].upper() + w[1:].lower() for w in words)[:120].strip()
    return name or FALLBACK_NAME


def clean_name(value: str | None) -> str:
    """Trimmed, with inner spaces collapsed ("" when nothing is left)."""
    return " ".join((value or "").split())


class UnknownAddIn(BaseModel):
    emails: list[str] = Field(min_length=1, max_length=100)
    # The name chosen for an email on the screen (else one made from the email).
    names: dict[str, str] = Field(default_factory=dict, max_length=100)
    role: Role = "staff"
    branch_id: str | None = None
    department_id: str | None = None
    send_signin: bool = True


class UnknownAddResult(BaseModel):
    email: str
    ok: bool
    user_id: str | None = None
    name: str | None = None
    skipped: bool = False  # already a member here
    emailed: bool | None = None  # None: no sign-in email was asked for
    message: str | None = None


class UnknownAddOut(BaseModel):
    results: list[UnknownAddResult]
    added: int
    skipped: int
    failed: int
    emailed: int


def _why(e: HTTPException) -> tuple[str, str]:
    detail = e.detail if isinstance(e.detail, dict) else {"message": str(e.detail)}
    return str(detail.get("code") or ""), render(detail.get("message", ""), current_lang())


@router.post("/unknown-signins/add")
async def add_unknown_signins(
    body: UnknownAddIn,
    background: BackgroundTasks,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> UnknownAddOut:
    from ...services import signin_mail
    from .members import _check_can_touch, _placement, add_one

    # IT support's call never gets here: api/held_guard.py holds it for approval (202), and the
    # approver's run applies IT support's limits too (core/security.acting_for).
    if principal.role not in ("owner", "admin", "it_support"):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "forbidden",
            "Only an owner, a global admin or IT support can add these people.",
        )
    await mirror.guard(db, principal.workspace_id)
    # The same refusals as POST /api/members, once for the whole list (not once per email).
    _check_can_touch(principal, body.role, body.role)
    await _placement(db, principal, body.role, body.branch_id, body.department_id)

    chosen = {k.strip().lower(): clean_name(v)[:120] for k, v in body.names.items()}
    results: list[UnknownAddResult] = []
    added: list[tuple[UnknownAddResult, str]] = []
    seen: set[str] = set()
    for raw in body.emails:
        email = (raw or "").strip().lower()
        if not email or email in seen:
            continue
        seen.add(email)
        if not valid_address(email):
            results.append(
                UnknownAddResult(
                    email=email[:254],
                    ok=False,
                    message=render(Msg("This is not an email address."), current_lang()),
                )
            )
            continue
        name = chosen.get(email) or ""
        if len(name) < 2:
            name = name_from_email(email)
        try:
            async with db.begin_nested():
                m, _ = await add_one(
                    db,
                    principal,
                    email=email,
                    name=name,
                    role=body.role,
                    branch_id=body.branch_id,
                    department_id=body.department_id,
                    via="unknown-signins",
                )
        except HTTPException as e:
            code, why = _why(e)
            results.append(
                UnknownAddResult(
                    email=email, ok=False, skipped=code == "already_member", message=why
                )
            )
            continue
        user = await db.get(User, m.user_id)
        row = UnknownAddResult(
            email=email, ok=True, user_id=m.user_id, name=user.name if user else name
        )
        results.append(row)
        added.append((row, m.user_id))
    await db.commit()

    for row, _uid in added:
        try:
            await signin_mail.forget_unknown(row.email)
        except Exception:  # noqa: BLE001 - the list leaves out members anyway
            log.warning("could not take an added email off the unknown list")
    if body.send_signin:
        for row, uid in added:
            user = await db.get(User, uid)
            if user is None:
                continue
            try:
                await signin_mail.send_to_member(
                    db, principal.workspace_id, user, actor=principal.actor
                )
                row.emailed = True
            except (signin_mail.NotSent, sendmail.SendError) as e:
                row.emailed = False
                row.message = render(
                    Msg("Added, but the sign-in email was not sent: {why}", why=e.message),
                    current_lang(),
                )
    if added:
        autolink.later(background, principal.workspace_id, [uid for _, uid in added])
    return UnknownAddOut(
        results=results,
        added=len(added),
        skipped=sum(1 for r in results if r.skipped),
        failed=sum(1 for r in results if not r.ok and not r.skipped),
        emailed=sum(1 for r in results if r.emailed),
    )
