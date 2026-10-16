"""Who may connect, see and use which Microsoft mailbox (P34).

People:
- A personal mailbox (MicrosoftAccount) is its owner's only. Nobody else sees its mail
  activity: not admins, not the workspace owner.
- A shared mailbox is seen by: the workspace owner and admins, the branch manager(s) of its
  company (branch), and the owner of the agent it is assigned to. Nobody else.
- Who may connect their own Outlook: whoever may have a personal AI: they own an AI twin,
  or their role has assistants.use (the P31 rule for linking a computer).

AI:
- A personal mailbox may be used only by its owner's own AI: their twin or one of their
  private assistants (`ai_may_use_personal`).
- A shared mailbox may be used only by the agent assigned to it (`ai_may_use_shared`), and
  the helpers it duplicated itself into.
- `boxes_for_ai` lists what one AI may use; the Outlook tools (MAIL_TOOLS) are offered and
  allowed only when that is not empty (runtime.offered_tools, policy.evaluate).

Approvals: a personal mailbox's drafts and calendar changes go to its owner; a shared
mailbox's to its viewers who manage (owner/admin, the company's branch managers).

Use `viewer_ids` for live events about a mailbox (`mail.*` events carry them; see
api/scope.py), and `shared_where` to filter lists in SQL.
"""

from sqlalchemy import ColumnElement, and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..assistants.access import may_assist
from ..models import Agent, Membership, MicrosoftAccount, SharedMailbox

MAILBOX_ADMINS = frozenset({"owner", "admin"})


async def has_twin(db: AsyncSession, workspace_id: str, user_id: str) -> bool:
    twin = await db.scalar(
        select(Agent.id).where(
            Agent.workspace_id == workspace_id,
            Agent.owner_user_id == user_id,
            Agent.is_twin.is_(True),
            Agent.status != "retired",
        )
    )
    return twin is not None


async def may_connect_personal(
    db: AsyncSession, workspace_id: str, user_id: str, role: str
) -> bool:
    """Owns a twin, or the role has assistants.use."""
    return may_assist(role) or await has_twin(db, workspace_id, user_id)


def sees_personal(acct: MicrosoftAccount | None, workspace_id: str, user_id: str) -> bool:
    return acct is not None and acct.workspace_id == workspace_id and acct.user_id == user_id


async def sees_shared(
    db: AsyncSession,
    mailbox: SharedMailbox | None,
    *,
    workspace_id: str,
    user_id: str,
    role: str,
    branch_id: str | None,
) -> bool:
    if mailbox is None or mailbox.workspace_id != workspace_id:
        return False
    if role in MAILBOX_ADMINS:
        return True
    if role == "branch_manager" and branch_id and branch_id == mailbox.branch_id:
        return True
    if mailbox.agent_id:
        owner = await db.scalar(select(Agent.owner_user_id).where(Agent.id == mailbox.agent_id))
        return owner is not None and owner == user_id
    return False


def shared_where(
    workspace_id: str, user_id: str, role: str, branch_id: str | None
) -> ColumnElement[bool]:
    """SQL condition on SharedMailbox: the shared mailboxes this person sees."""
    in_ws = SharedMailbox.workspace_id == workspace_id
    if role in MAILBOX_ADMINS:
        return in_ws
    owned_agents = select(Agent.id).where(
        Agent.workspace_id == workspace_id, Agent.owner_user_id == user_id
    )
    parts: list[ColumnElement[bool]] = [SharedMailbox.agent_id.in_(owned_agents)]
    if role == "branch_manager" and branch_id:
        parts.append(SharedMailbox.branch_id == branch_id)
    return and_(in_ws, or_(*parts))


async def viewer_ids(db: AsyncSession, box: MicrosoftAccount | SharedMailbox) -> list[str]:
    """Everyone who may see this mailbox (for scoping live events)."""
    if isinstance(box, MicrosoftAccount):
        return [box.user_id]
    rows = (
        await db.execute(
            select(Membership.user_id, Membership.role, Membership.branch_id).where(
                Membership.workspace_id == box.workspace_id,
                or_(
                    Membership.role.in_(MAILBOX_ADMINS),
                    (Membership.role == "branch_manager") & (Membership.branch_id == box.branch_id),
                ),
            )
        )
    ).all()
    out = {r[0] for r in rows}
    if box.agent_id:
        owner = await db.scalar(select(Agent.owner_user_id).where(Agent.id == box.agent_id))
        if owner:
            out.add(owner)
    return sorted(out)


def ai_may_use_personal(agent: Agent | None, acct: MicrosoftAccount | None) -> bool:
    """Only the owner's own AI: their twin or their private assistant."""
    return bool(
        agent is not None
        and acct is not None
        and agent.workspace_id == acct.workspace_id
        and agent.owner_user_id == acct.user_id
        and (agent.is_twin or agent.private)
        and agent.status != "retired"
    )


def ai_may_use_shared(agent: Agent | None, mailbox: SharedMailbox | None) -> bool:
    """Only the agent the mailbox is assigned to (and the helpers it duplicated itself into
    for a big job, clone_of = that agent)."""
    return bool(
        agent is not None
        and mailbox is not None
        and mailbox.agent_id is not None
        and mailbox.agent_id in (agent.id, agent.clone_of)
        and agent.workspace_id == mailbox.workspace_id
        and agent.status != "retired"
    )


# ---------------------------------------------------------------- the AI's mailboxes

# The Outlook tools (agents/mail_tools.py): offered and allowed only to an AI that may use
# a mailbox (its owner's own Outlook, or a shared mailbox it is assigned to).
MAIL_TOOLS = frozenset(
    {
        "outlook_search",
        "outlook_read",
        "outlook_draft_reply",
        "outlook_draft",
        "outlook_save_attachment",
        "outlook_calendar_agenda",
        "outlook_free_slots",
        "outlook_propose_event",
        "outlook_propose_update",
        "outlook_propose_cancel",
    }
)
USABLE_ACCOUNT = frozenset({"connected"})


def personal_ai(agent: Agent | None) -> bool:
    """A person's own AI: their twin or a private assistant."""
    return bool(agent and agent.owner_user_id and (agent.is_twin or agent.private))


async def boxes_for_ai(
    db: AsyncSession, agent: Agent | None
) -> list[MicrosoftAccount | SharedMailbox]:
    """The mailboxes this AI may use: its owner's own Outlook (twin or private assistant)
    first, then the shared mailboxes assigned to it (or to the agent it is a helper of)."""
    if agent is None or agent.status == "retired":
        return []
    out: list[MicrosoftAccount | SharedMailbox] = []
    if personal_ai(agent):
        acct = await personal_account_of(db, agent.workspace_id, agent.owner_user_id or "")
        if acct is not None and acct.status in USABLE_ACCOUNT and ai_may_use_personal(agent, acct):
            out.append(acct)
    ids = [i for i in (agent.id, agent.clone_of) if i]
    shared = (
        await db.scalars(
            select(SharedMailbox)
            .where(
                SharedMailbox.workspace_id == agent.workspace_id,
                SharedMailbox.agent_id.in_(ids),
                SharedMailbox.status != "paused",
            )
            .order_by(SharedMailbox.created_at)
        )
    ).all()
    out += [m for m in shared if ai_may_use_shared(agent, m)]
    return out


async def mail_ready(db: AsyncSession, agent: Agent | None) -> bool:
    return bool(await boxes_for_ai(db, agent))


async def has_mailbox(agent: Agent | None) -> bool:
    """mail_ready on its own session (policy.evaluate has none)."""
    from ..core.db import SessionLocal

    if agent is None:
        return False
    async with SessionLocal() as db:
        return await mail_ready(db, agent)


# ---------------------------------------------------------------- who approves

MAILBOX_MANAGERS = frozenset({"owner", "admin", "branch_manager"})


async def may_approve_shared(
    db: AsyncSession,
    mailbox: SharedMailbox | None,
    *,
    workspace_id: str,
    user_id: str,
    role: str,
    branch_id: str | None,
) -> bool:
    """A shared mailbox's drafts and calendar changes: approved by someone who sees the
    mailbox AND manages (owner, admin, or a branch manager of its company)."""
    if role not in MAILBOX_MANAGERS:
        return False
    return await sees_shared(
        db, mailbox, workspace_id=workspace_id, user_id=user_id, role=role, branch_id=branch_id
    )


def approvable_where(
    workspace_id: str, user_id: str, role: str, branch_id: str | None
) -> ColumnElement[bool] | None:
    """SQL condition on SharedMailbox: the mailboxes whose drafts this person approves.
    None: none at all."""
    if role not in MAILBOX_MANAGERS:
        return None
    return shared_where(workspace_id, user_id, role, branch_id)


async def approver_ids(db: AsyncSession, box: MicrosoftAccount | SharedMailbox) -> list[str]:
    """Who is asked to approve: the owner of a personal mailbox; for a shared one, its
    viewers that manage (owner/admin and the company's branch managers)."""
    if isinstance(box, MicrosoftAccount):
        return [box.user_id]
    rows = (
        await db.execute(
            select(Membership.user_id).where(
                Membership.workspace_id == box.workspace_id,
                or_(
                    Membership.role.in_(MAILBOX_ADMINS),
                    (Membership.role == "branch_manager") & (Membership.branch_id == box.branch_id),
                ),
            )
        )
    ).all()
    return sorted({r[0] for r in rows})


def label_of(box: MicrosoftAccount | SharedMailbox) -> str:
    if isinstance(box, MicrosoftAccount):
        return box.email or box.display_name
    return box.display_name or box.address


def address_of(box: MicrosoftAccount | SharedMailbox) -> str:
    return (box.email if isinstance(box, MicrosoftAccount) else box.address).lower()


async def personal_account_of(
    db: AsyncSession, workspace_id: str, user_id: str
) -> MicrosoftAccount | None:
    return await db.scalar(
        select(MicrosoftAccount).where(
            MicrosoftAccount.workspace_id == workspace_id, MicrosoftAccount.user_id == user_id
        )
    )
