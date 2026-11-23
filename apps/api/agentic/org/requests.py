"""P120: people's requests that someone above them approves, on the Approvals page.

Fitri (20 Nov 2026): "in the Library, the OneDrive link: make it available for normal staff but
with an approval process; once they key in a link, their upper manager sees it to approve it or
not, so all approval processes are on the Approvals page, not just approvals for AI".

A request (person_requests, org/models.py) is asked by one person and decided by one other:
- whoever is above the person on the organization chart (the person they report to, theirs, and
  so on up the line, teams/people.py `above`);
- for a SharePoint or OneDrive folder, whoever may connect folders for that company themselves
  (api/routers/linked_sources.py may_manage);
- the people who run the whole office (org.manage: owners, admins, management, HR), so nothing
  waits forever when a person reports to no one.
Nobody decides their own request, and every decision carries a reason (approve or decline).
Only the first person asked (the one they report to; with nobody above them, the company's
managers) is told by push, Telegram or WhatsApp; the others find it on the Approvals page.

Kinds:
- library_link: a folder (or file) for the Library. The link was opened with the asker's own
  Microsoft 365 sign-in when they asked (so it exists and they may open it); approving connects
  it in their name, synced with their sign-in, for the company they picked (one of theirs).
- work_mail (P124): an extra work email account (Microsoft or IMAP) someone below HOD
  connected. It waits, unused, until approved (org/work_mail.py); the person asked first is
  their line manager, else a head of their department, else their branch manager, else the
  office's owners and admins. Declining or cancelling deletes the account and what it stored.
"""

import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import ColumnElement, and_, false, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.security import COMPANY_ROLES, can
from ..i18n import Msg
from ..models import Membership, User
from ..services import audit
from ..teams import people
from ..teams.branches import member_in_branches
from .models import PersonRequest

log = logging.getLogger(__name__)

LIBRARY_LINK = "library_link"
WORK_MAIL = "work_mail"  # P124
_LINE = "<line>"  # ask(): the approver is the first person up the line
MAX_NOTE = 1000
MIN_REASON = 3
MAX_OPEN_PER_PERSON = 20


class RequestError(Exception):
    def __init__(self, status: int, code: str, message: str, **vars: Any) -> None:
        super().__init__(message)
        self.status, self.code, self.message, self.vars = status, code, message, vars


def _overseer(principal: Any) -> bool:
    return can(principal.role, "org.manage")


async def company_deciders(db: AsyncSession, workspace_id: str, branch_id: str | None) -> list[str]:
    """The company's managers (branch managers and group HODs of it), for a person with no one
    above them."""
    if not branch_id:
        return []
    rows = await db.scalars(
        select(Membership.user_id)
        .join(User, User.id == Membership.user_id)
        .where(
            Membership.workspace_id == workspace_id,
            Membership.role.in_(sorted(COMPANY_ROLES)),
            member_in_branches([branch_id]),
            User.is_active.is_(True),
        )
    )
    return sorted(set(rows.all()))


def _company_manager(principal: Any, r: PersonRequest) -> bool:
    if r.kind != LIBRARY_LINK:
        return False
    from ..api.routers.linked_sources import may_manage  # late: the api builds on this module

    return bool(r.branch_id) and may_manage(principal, r.branch_id)


async def may_decide(db: AsyncSession, principal: Any, r: PersonRequest) -> bool:
    if r.requested_by == principal.user.id:
        return False  # nobody approves their own
    if _overseer(principal) or _company_manager(principal, r):
        return True
    if r.approver_id and r.approver_id == principal.user.id:
        return True  # P124: the one asked first (a HOD or branch manager, not always above)
    return principal.user.id in await people.above(db, r.workspace_id, r.requested_by)


async def to_decide_where(db: AsyncSession, principal: Any) -> ColumnElement[bool]:
    """SQL on PersonRequest: the ones this person may decide (any status)."""
    me = principal.user.id
    if _overseer(principal):
        return PersonRequest.requested_by != me
    below = set(principal.team) or await people.below(db, principal.workspace_id, me)
    parts: list[ColumnElement[bool]] = [
        PersonRequest.requested_by.in_(sorted(below)) if below else false(),
        PersonRequest.approver_id == me,  # P124: the one asked first
    ]
    sc = principal.scope
    if sc.kind == "branch" and sc.branch_ids and can(principal.role, "agents.manage"):
        parts.append(
            and_(
                PersonRequest.kind == LIBRARY_LINK,
                PersonRequest.branch_id.in_(sorted(sc.branch_ids)),
            )
        )
    return and_(PersonRequest.requested_by != me, or_(*parts))


async def ask(
    db: AsyncSession,
    principal: Any,
    kind: str,
    title: str,
    data: dict[str, Any],
    branch_id: str | None,
    note: str = "",
    *,
    approver_id: str | None = _LINE,
) -> PersonRequest:
    """A new request from this person; the caller commits and then calls `tell_asked`.
    `approver_id`: who is asked first (default: the person they report to)."""
    open_now = await db.scalar(
        select(PersonRequest.id)
        .where(
            PersonRequest.workspace_id == principal.workspace_id,
            PersonRequest.requested_by == principal.user.id,
            PersonRequest.status == "pending",
        )
        .offset(MAX_OPEN_PER_PERSON - 1)
        .limit(1)
    )
    if open_now is not None:
        raise RequestError(
            429,
            "too_many_requests",
            "You have {n} requests waiting already. Wait for an answer, or cancel one.",
            n=MAX_OPEN_PER_PERSON,
        )
    if approver_id == _LINE:
        line = await people.above(db, principal.workspace_id, principal.user.id)
        approver_id = line[0] if line else None
    r = PersonRequest(
        workspace_id=principal.workspace_id,
        kind=kind,
        requested_by=principal.user.id,
        approver_id=approver_id,
        branch_id=branch_id,
        title=title[:300],
        note=" ".join((note or "").split())[:MAX_NOTE],
        data=data,
        status="pending",
        created_at=datetime.now(UTC),
    )
    db.add(r)
    await db.flush()
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "request.asked",
        target=r.id,
        after={"kind": kind, "title": r.title, "branch_id": branch_id, "approver": r.approver_id},
    )
    return r


async def first_told(db: AsyncSession, r: PersonRequest) -> list[str]:
    if r.approver_id:
        return [r.approver_id]
    if r.kind == WORK_MAIL:  # P124: nobody above them: the office's owners and admins
        from .work_mail import office_admins

        return await office_admins(db, r.workspace_id, r.requested_by)
    return [
        u for u in await company_deciders(db, r.workspace_id, r.branch_id) if u != r.requested_by
    ]


async def _notify(
    db: AsyncSession, r: PersonRequest, user_ids: list[str], title: Msg, body: Msg
) -> None:
    from ..channels import deliver  # late: channels import agent modules

    for uid in user_ids:
        try:
            ids = await deliver.notify_user(
                db,
                r.workspace_id,
                uid,
                title,
                body,
                f"/approvals?tab=people&request={r.id}",
                dedupe=f"request:{r.id}:{r.status}:{uid}",
            )
            await deliver.start(ids)
        except Exception:  # noqa: BLE001 - a notice must never break the request
            log.warning("could not tell %s about request %s", uid, r.id, exc_info=True)


async def tell_asked(db: AsyncSession, r: PersonRequest, by_name: str) -> None:
    await _notify(
        db,
        r,
        await first_told(db, r),
        Msg("Waiting for your approval: {title}", title=r.title[:100]),
        Msg("{name} asked. Open Approvals to approve or decline it.", name=by_name),
    )


async def tell_decided(db: AsyncSession, r: PersonRequest, by_name: str) -> None:
    title = (
        Msg("Approved: {title}", title=r.title[:100])
        if r.status == "approved"
        else Msg("Declined: {title}", title=r.title[:100])
    )
    body = Msg("{name} decided it.", name=by_name)
    if r.kind == WORK_MAIL:  # P124: the account is usable now, or was removed: say why
        body = (
            Msg(
                "{name} approved it: {reason}. You can use it now.",
                name=by_name,
                reason=r.decision_note[:300],
            )
            if r.status == "approved"
            else Msg(
                "{name} declined it: {reason}. The account was removed.",
                name=by_name,
                reason=r.decision_note[:300],
            )
        )
    await _notify(db, r, [r.requested_by], title, body)


def clean_reason(text: str | None) -> str:
    reason = " ".join((text or "").split())[:MAX_NOTE]
    if len(reason) < MIN_REASON:
        raise RequestError(422, "reason_needed", "Write a short reason for your decision.")
    return reason


async def decide(
    db: AsyncSession, principal: Any, r: PersonRequest, approve: bool, reason: str
) -> PersonRequest:
    """Approve (and do what was asked) or decline, with a reason; the caller commits."""
    if r.status != "pending":
        raise RequestError(409, "already_decided", "This request was decided already.")
    if r.requested_by == principal.user.id:
        raise RequestError(403, "own_request", "You cannot decide your own request.")
    if not await may_decide(db, principal, r):
        raise RequestError(404, "request_not_found", "That request is not here.")
    why = clean_reason(reason)
    if approve:
        r.result_id = await _carry_out(db, principal, r)
    elif r.kind == WORK_MAIL:  # P124: refused: the account and its token or password go
        from . import work_mail

        await work_mail.remove(db, principal.actor, r, "declined")
    r.status = "approved" if approve else "declined"
    r.decided_by, r.decided_at, r.decision_note = principal.user.id, datetime.now(UTC), why
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        f"request.{r.status}",
        target=r.id,
        after={"kind": r.kind, "title": r.title, "reason": why, "result": r.result_id},
    )
    await db.flush()
    return r


async def cancel(
    db: AsyncSession, principal: Any, r: PersonRequest, *, remove_account: bool = True
) -> PersonRequest:
    if r.requested_by != principal.user.id:
        raise RequestError(403, "not_yours", "Only the person who asked can cancel it.")
    if r.status != "pending":
        raise RequestError(409, "already_decided", "This request was decided already.")
    if r.kind == WORK_MAIL and remove_account:  # P124: the waiting account goes with it
        from . import work_mail

        await work_mail.remove(db, principal.actor, r, "cancelled")
    r.status, r.decided_at = "cancelled", datetime.now(UTC)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "request.cancelled",
        target=r.id,
        after={"kind": r.kind, "title": r.title},
    )
    await db.flush()
    return r


async def _carry_out(db: AsyncSession, principal: Any, r: PersonRequest) -> str | None:
    if r.kind == LIBRARY_LINK:
        return await _connect_folder(db, principal, r)
    if r.kind == WORK_MAIL:
        from . import work_mail

        return await work_mail.release(db, r)
    return None


async def _connect_folder(db: AsyncSession, principal: Any, r: PersonRequest) -> str:
    """The folder joins the Library in the asker's name (synced with their own sign-in)."""
    from ..sharepoint.models import LinkedSource

    d = r.data or {}
    s = await db.scalar(
        select(LinkedSource).where(
            LinkedSource.workspace_id == r.workspace_id,
            LinkedSource.drive_id == d.get("drive_id"),
            LinkedSource.item_id == d.get("item_id"),
        )
    )
    if s is not None:
        return s.id  # someone linked the same folder meanwhile: it is in the Library already
    asker = await db.get(User, r.requested_by)
    if asker is None or not asker.is_active:
        raise RequestError(
            409, "asker_gone", "The person who asked is no longer active here. Decline it."
        )
    s = LinkedSource(
        workspace_id=r.workspace_id,
        connected_by=asker.id,
        connected_by_name=(asker.name or asker.email)[:200],
        provider=str(d.get("provider") or "sharepoint"),
        drive_id=str(d.get("drive_id") or ""),
        item_id=str(d.get("item_id") or ""),
        is_folder=bool(d.get("is_folder", True)),
        name=str(d.get("name") or "")[:300],
        web_url=str(d.get("web_url") or d.get("url") or ""),
        branch_id=r.branch_id,
        status="syncing",
    )
    db.add(s)
    await db.flush()
    await audit.record(
        db,
        r.workspace_id,
        principal.actor,
        "library.linked",
        target=s.id,
        after={
            "name": s.name,
            "web_url": s.web_url,
            "branch_id": s.branch_id,
            "requested_by": asker.id,
            "request": r.id,
        },
    )
    return s.id
