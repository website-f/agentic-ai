"""P124: an extra WORK email account waits for approval before it is used.

The owner (23 Nov 2026): "for work email, when someone who is not a HOD (or above) connects
one, it must request approval first, not connect immediately; another company might be checking
too. Right now I can add as many work emails as I want without approval."

Who: anyone whose role is not one of APPROVAL_FREE (owner, admin, management, HR, branch
manager, HOD, group HOD). Those connect at once, as before.

What: an EXTRA account that is work (microsoft/domains.py, P122: on a company domain, or a
Microsoft account in the company's tenant), connected with Microsoft's sign-in (after the
callback succeeds) or over IMAP (after the sign-in test succeeds). The person's main Microsoft
account and personal accounts (free mail, other companies' domains) never wait.

Pending: the account is kept (its refresh token or password encrypted, as always) with status
'pending'. Nothing uses it: no token (microsoft/auth.access_token refuses), no sync
(sync.is_active), no AI (access.USABLE_ACCOUNT), no reading on the Microsoft 365 page, no test
or backup of an IMAP account. The person sees it on the Work tab, "Waiting for approval by
<name>", and may cancel it.

The request is a P120 person request (kind 'work_mail', org/requests.py), asked first of
`approver_for`: the person they report to, else a head of their department, else their
company's branch manager, else the office's owners and admins. The owners, admins, management
and HR, and anyone above the person on the chart, may decide it too; never the person
themselves, and always with a reason. Approving makes the account usable at once (its first
sync starts the normal way); declining or cancelling deletes the account with its stored token
or password, and the person is told why.
"""

from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..mailbox.models import ExternalMailAccount
from ..microsoft import domains
from ..models import (
    DepartmentHead,
    MailItem,
    MailSubscription,
    Membership,
    MicrosoftAccount,
    User,
)
from ..services import audit
from ..teams.branches import member_in_branches
from .models import PersonRequest

APPROVAL_FREE = frozenset(
    {"owner", "admin", "management", "hr", "branch_manager", "hod", "group_hod"}
)
PENDING = "pending"
MICROSOFT = "microsoft"
IMAP = "imap"

Account = MicrosoftAccount | ExternalMailAccount


def needs_approval(role: str) -> bool:
    return role not in APPROVAL_FREE


async def _active(db: AsyncSession, workspace_id: str, ids: list[str], not_me: str) -> list[str]:
    """The ids (in order) that are active members here, the asker left out."""
    want = [i for i in dict.fromkeys(ids) if i and i != not_me]
    if not want:
        return []
    ok = set(
        (
            await db.scalars(
                select(Membership.user_id)
                .join(User, User.id == Membership.user_id)
                .where(
                    Membership.workspace_id == workspace_id,
                    Membership.user_id.in_(want),
                    User.is_active.is_(True),
                )
            )
        ).all()
    )
    return [i for i in want if i in ok]


async def approver_for(db: AsyncSession, workspace_id: str, user_id: str) -> str | None:
    """Who is asked first: the person they report to, else a head of their department, else a
    branch manager of their company. None: the office's owners and admins."""
    m = await db.get(Membership, (workspace_id, user_id))
    if m is None:
        return None
    line = await _active(db, workspace_id, [m.reports_to_user_id or ""], user_id)
    if line:
        return line[0]
    if m.department_id:
        heads = (
            await db.scalars(
                select(DepartmentHead.user_id)
                .where(
                    DepartmentHead.workspace_id == workspace_id,
                    DepartmentHead.department_id == m.department_id,
                )
                .order_by(DepartmentHead.created_at, DepartmentHead.user_id)
            )
        ).all()
        heads = await _active(db, workspace_id, list(heads), user_id)
        if heads:
            return heads[0]
    if m.branch_id:
        managers = (
            await db.scalars(
                select(Membership.user_id)
                .where(
                    Membership.workspace_id == workspace_id,
                    Membership.role == "branch_manager",
                    member_in_branches([m.branch_id]),
                )
                .order_by(Membership.user_id)
            )
        ).all()
        managers = await _active(db, workspace_id, list(managers), user_id)
        if managers:
            return managers[0]
    return None


async def office_admins(db: AsyncSession, workspace_id: str, not_me: str) -> list[str]:
    """The owners and admins (told when nobody else is above the person)."""
    rows = await db.scalars(
        select(Membership.user_id)
        .join(User, User.id == Membership.user_id)
        .where(
            Membership.workspace_id == workspace_id,
            Membership.role.in_(("owner", "admin")),
            User.is_active.is_(True),
        )
    )
    return sorted({u for u in rows.all() if u != not_me})


# ---------------------------------------------------------------- work or personal


async def microsoft_is_work(db: AsyncSession, principal: Any, acct: MicrosoftAccount) -> bool:
    """P122's rule for one of this person's Microsoft accounts, by its address and tenant. For a
    main account being connected (P124) the tenant compared is only the admin-consented one,
    never its own."""
    from ..microsoft import access, app

    cfg = await app.load(db, principal.workspace_id)
    company = await domains.company_domains(db, principal.workspace_id, principal.user.email)
    main = (
        None
        if acct.is_primary
        else await access.personal_account_of(db, principal.workspace_id, principal.user.id)
    )
    tenants = domains.work_tenants(main, cfg.app_tenant() if cfg.configured else None)
    d = domains.domain_of(acct.email)
    if not d or domains.is_consumer(d):
        return False
    return d in company or (acct.tenant_id or "").lower() in tenants


async def email_is_work(db: AsyncSession, principal: Any, email: str) -> bool:
    """An address on one of the company's domains (free mail never)."""
    d = domains.domain_of(email)
    if not d or domains.is_consumer(d):
        return False
    return d in await domains.company_domains(db, principal.workspace_id, principal.user.email)


# ---------------------------------------------------------------- the request


async def pending_request(
    db: AsyncSession, workspace_id: str, account_id: str
) -> PersonRequest | None:
    rows = (
        await db.scalars(
            select(PersonRequest).where(
                PersonRequest.workspace_id == workspace_id,
                PersonRequest.kind == "work_mail",
                PersonRequest.status == "pending",
            )
        )
    ).all()
    return next((r for r in rows if (r.data or {}).get("account_id") == account_id), None)


async def ask(
    db: AsyncSession, principal: Any, source: str, acct: Account
) -> tuple[PersonRequest, bool]:
    """The account waits (status pending) and the request is asked; the caller commits, then
    (when it is new) calls org.requests.tell_asked. Asking again for the same account returns
    the open one: (request, False)."""
    from . import requests as asks

    acct.status = PENDING
    acct.last_error = None
    open_one = await pending_request(db, principal.workspace_id, acct.id)
    if open_one is not None:
        return open_one, False
    email = (acct.email or "").lower()
    m = await db.get(Membership, (principal.workspace_id, principal.user.id))
    data = {
        "source": source,
        "account_id": acct.id,
        "email": email,
        "domain": domains.domain_of(email),
        "display_name": (getattr(acct, "display_name", "") or "")[:200],
    }
    r = await asks.ask(
        db,
        principal,
        asks.WORK_MAIL,
        email,
        data,
        m.branch_id if m is not None else principal.branch_id,
        approver_id=await approver_for(db, principal.workspace_id, principal.user.id),
    )
    return r, True


async def drop_unasked(db: AsyncSession, acct: Account) -> None:
    """The request could not be asked (too many open): the held account is not kept."""
    if isinstance(acct, MicrosoftAccount):
        from ..microsoft import auth

        await auth.forget(acct)
    await db.delete(acct)
    await db.commit()


async def account_of(db: AsyncSession, r: PersonRequest) -> Account | None:
    """The account a work_mail request is about (still the asker's own), or None."""
    d = r.data or {}
    model = MicrosoftAccount if d.get("source") == MICROSOFT else ExternalMailAccount
    acct = await db.get(model, str(d.get("account_id") or ""))
    if acct is None or acct.workspace_id != r.workspace_id or acct.user_id != r.requested_by:
        return None
    return acct


async def release(db: AsyncSession, r: PersonRequest) -> str:
    """Approved: the account is usable from now on (the caller starts its first sync)."""
    from .requests import RequestError

    acct = await account_of(db, r)
    if acct is None or acct.status != PENDING:
        raise RequestError(
            409,
            "account_gone",
            "That email account was removed meanwhile. Decline the request instead.",
        )
    if isinstance(acct, MicrosoftAccount):
        acct.status = "connected" if acct.token_enc else "reconnect_needed"
    else:
        acct.status = "ok" if acct.secret_enc else "error"
    acct.last_error = None
    await db.flush()
    return acct.id


async def remove(db: AsyncSession, actor: str, r: PersonRequest, why: str) -> None:
    """Declined or cancelled: the account goes, with its stored token or password."""
    acct = await account_of(db, r)
    if acct is None or acct.status != PENDING:
        return
    if isinstance(acct, MicrosoftAccount):
        from ..microsoft import auth

        await auth.forget(acct)
        await db.execute(delete(MailItem).where(MailItem.account_id == acct.id))
        await db.execute(delete(MailSubscription).where(MailSubscription.account_id == acct.id))
        action = "microsoft.account_removed"
    else:
        action = "mail_account.removed"
    await audit.record(
        db,
        r.workspace_id,
        actor,
        action,
        target=acct.id,
        before={"email": acct.email},
        after={"request": r.id, "why": why},
    )
    await db.delete(acct)
    await db.flush()


async def cancel_for_account(db: AsyncSession, principal: Any, account_id: str) -> None:
    """The person removed a waiting account themselves: its request is cancelled too."""
    from . import requests as asks

    r = await pending_request(db, principal.workspace_id, account_id)
    if r is not None and r.requested_by == principal.user.id:
        await asks.cancel(db, principal, r, remove_account=False)


async def waiting_for(
    db: AsyncSession, workspace_id: str, user_id: str
) -> dict[str, dict[str, Any]]:
    """{account id: {request_id, approver_name}} of this person's accounts that wait."""
    rows = (
        await db.scalars(
            select(PersonRequest).where(
                PersonRequest.workspace_id == workspace_id,
                PersonRequest.kind == "work_mail",
                PersonRequest.status == "pending",
                PersonRequest.requested_by == user_id,
            )
        )
    ).all()
    ids = {r.approver_id for r in rows if r.approver_id}
    names: dict[str, str] = {}
    if ids:
        for uid, name, email in (
            await db.execute(select(User.id, User.name, User.email).where(User.id.in_(ids)))
        ).all():
            names[uid] = name or email
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        aid = str((r.data or {}).get("account_id") or "")
        if aid:
            out[aid] = {
                "request_id": r.id,
                "approver_name": names.get(r.approver_id or ""),
            }
    return out
