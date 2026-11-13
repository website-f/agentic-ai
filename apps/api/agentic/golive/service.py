"""P81: start fresh for go-live (Settings > Data and privacy, and `python -m agentic.golive`).

A dev office full of sample people and companies becomes the real one. One reset, in one
transaction (the caller commits, or rolls back for a dry run):

- Members: everyone except the owners leaves the workspace. With the membership go what
  lets them in or acts for them here: sessions, linked computers, their own Microsoft
  mailbox and Gmail links, push subscriptions, Telegram links, API tokens and their Prima
  link. Someone who belongs to no other workspace is deactivated, not deleted:
  the audit log and their past work still name them, and adding them again turns them back
  on (members.add_one).
- Companies: the ones picked go, with their departments and what belongs only to a company
  (its memory pages, skills, workflows, forms, templates, credentials...: the database's
  ON DELETE CASCADE). What should outlive the company moves to the company picked as their
  new home first:
  - AI workers (an agent always sits in a company: agents.branch_id is required), with their
    department cleared;
  - files, into a folder named after the company they came from, so they are easy to find
    (and delete) in Browse; their library passages follow;
  - SharePoint and OneDrive folders linked for that company.
  The personal AI (twin, assistant) of someone who left is retired, not deleted.
- SOPs are kept. One written for a removed company or department becomes a library SOP,
  attached to the agents that followed it, so they still do and nobody else starts to.
- Settings, the AI Engine, Microsoft and SharePoint setup are not touched.

It never prints or returns personal data, only counts (the audit rows name people by id).
"""

import logging
import os
import re
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import delete, func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..i18n import Msg
from ..models import (
    SOP,
    Agent,
    ApiToken,
    AuthSession,
    Branch,
    Channel,
    ChannelLink,
    Department,
    Device,
    DocFile,
    GoogleAccount,
    KnowledgeChunk,
    Membership,
    MicrosoftAccount,
    PrimaLink,
    PushSubscription,
    User,
    Workspace,
)
from ..services import audit
from ..sharepoint.models import LinkedSource

log = logging.getLogger("agentic.golive")

# The backup container (deploy/backup/agentic-backup.sh) writes the time of its last good
# backup to /work/last-success. Mount its volume read-only in the api container to show it
# here (docker compose: `backupwork:/backup-status:ro`); without it the time is unknown.
BACKUP_STATUS_FILE = os.environ.get("AGENTIC_BACKUP_STATUS_FILE", "/backup-status/last-success")
BACKUP_COMMAND = "docker compose exec -T backup agentic-backup backup"

_IDENT = re.compile(r"^[a-z_][a-z0-9_]*$")
# Tables whose rows move instead of going with a company (agents) or are counted on their
# own (departments).
_NOT_CASCADED = {"agents", "departments"}


class ResetError(Exception):
    def __init__(self, code: str, message: Msg) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# ---------------------------------------------------------------- the backup


def last_backup() -> datetime | None:
    """When the server's last good backup finished, if this container can see it."""
    try:
        raw = Path(BACKUP_STATUS_FILE).read_text(encoding="utf-8").strip()
        return datetime.fromtimestamp(int(raw), UTC)
    except (OSError, ValueError, OverflowError):
        return None


# ---------------------------------------------------------------- what there is


async def _cascade_tables(db: AsyncSession) -> list[str]:
    """Tables whose rows the database deletes with their company (ON DELETE CASCADE on a
    branch_id foreign key), read from the live schema so a new one is counted too."""
    rows = await db.execute(
        text(
            "SELECT DISTINCT cl.relname FROM pg_constraint c "
            "JOIN pg_class cl ON cl.oid = c.conrelid "
            "JOIN pg_class ref ON ref.oid = c.confrelid "
            "JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey) "
            "WHERE c.contype = 'f' AND c.confdeltype = 'c' AND ref.relname = 'branches' "
            "AND a.attname = 'branch_id'"
        )
    )
    return sorted(n for (n,) in rows.all() if _IDENT.match(n or "") and n not in _NOT_CASCADED)


async def _per_branch(db: AsyncSession, model: Any, ws: str) -> dict[str, int]:
    rows = await db.execute(
        select(model.branch_id, func.count())
        .where(model.workspace_id == ws, model.branch_id.is_not(None))
        .group_by(model.branch_id)
    )
    return {b: n for b, n in rows.all()}


async def _cascaded_per_branch(db: AsyncSession, ws: str) -> dict[str, int]:
    """Rows of other tables that go with each company (memory pages, skills, forms...)."""
    out: dict[str, int] = {}
    for table in await _cascade_tables(db):
        has_ws = await db.scalar(
            text(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_schema = current_schema() AND table_name = :t "
                "AND column_name = 'workspace_id'"
            ),
            {"t": table},
        )
        where = "branch_id IS NOT NULL" + (" AND workspace_id = :ws" if has_ws else "")
        rows = await db.execute(
            text(f"SELECT branch_id, count(*) FROM {table} WHERE {where} GROUP BY branch_id"),  # noqa: S608 - a table name from the catalog, checked above
            {"ws": ws},
        )
        for b, n in rows.all():
            out[b] = out.get(b, 0) + int(n)
    return out


async def survey(db: AsyncSession, ws_id: str) -> dict[str, Any]:
    """Counts only: members (owners stay), each company with what is in it, departments,
    AI workers, files, SOPs, and when the last server backup was taken (None: unknown)."""
    roles = dict(
        (
            await db.execute(
                select(Membership.role, func.count())
                .where(Membership.workspace_id == ws_id)
                .group_by(Membership.role)
            )
        ).all()
    )
    total = sum(roles.values())
    owners = roles.get("owner", 0)
    branches = (
        await db.scalars(select(Branch).where(Branch.workspace_id == ws_id).order_by(Branch.name))
    ).all()
    depts = await _per_branch(db, Department, ws_id)
    agents = await _per_branch(db, Agent, ws_id)
    files = await _per_branch(db, DocFile, ws_id)
    members = await _per_branch(db, Membership, ws_id)
    other = await _cascaded_per_branch(db, ws_id)
    linked = await _per_branch(db, LinkedSource, ws_id)

    async def count(model: Any, *where: Any) -> int:
        return int(
            await db.scalar(
                select(func.count()).select_from(model).where(model.workspace_id == ws_id, *where)
            )
            or 0
        )

    backup = last_backup()
    return {
        "members": {"total": total, "owners": owners, "to_remove": total - owners},
        "companies": [
            {
                "id": b.id,
                "name": b.name,
                "departments": depts.get(b.id, 0),
                "agents": agents.get(b.id, 0),
                "files": files.get(b.id, 0),
                "members": members.get(b.id, 0),
                "linked_folders": linked.get(b.id, 0),
                "other": other.get(b.id, 0),
            }
            for b in branches
        ],
        "departments": await count(Department),
        "agents": await count(Agent, Agent.status != "retired"),
        "files": await count(DocFile),
        "sops": await count(SOP),
        "backup": {
            "last_success": backup.isoformat() if backup else None,
            "command": BACKUP_COMMAND,
        },
    }


# ---------------------------------------------------------------- the reset


@dataclass
class Result:
    members_removed: int = 0
    owners_kept: int = 0
    accounts_deactivated: int = 0
    sessions_ended: int = 0
    prima_links_ended: int = 0
    connections_removed: int = 0  # computers, mailboxes, Gmail, push, Telegram
    api_tokens_revoked: int = 0
    companies_removed: int = 0
    companies_kept: int = 0
    departments_removed: int = 0
    other_rows_removed: int = 0
    agents_moved: int = 0
    personal_agents_retired: int = 0
    files_moved: int = 0
    linked_folders_moved: int = 0
    sops_kept_as_library: int = 0
    move_to: str | None = None  # the company id that took in what was moved
    backup_last_success: str | None = None
    removed_user_ids: list[str] = field(default_factory=list)
    removed_branch_ids: list[str] = field(default_factory=list)

    def counts(self) -> dict[str, Any]:
        """Everything but the id lists (what the page and the command show)."""
        d = asdict(self)
        d.pop("removed_user_ids")
        d.pop("removed_branch_ids")
        return d


def _rows(r: Any) -> int:
    return int(getattr(r, "rowcount", 0) or 0)


def _folder_for(company: str, folder: str | None) -> str:
    from ..intake.unpack import join_folder

    return join_folder(company.replace("/", "-").replace("\\", "-"), folder or "")


async def reset(
    db: AsyncSession,
    ws_id: str,
    actor: str,
    *,
    remove_branch_ids: list[str],
    move_to: str | None,
    via: str,
) -> Result:
    """The reset, inside the caller's transaction (it does not commit). ResetError when the
    choice cannot be carried out; nothing is changed then."""
    ws = await db.scalar(select(Workspace).where(Workspace.id == ws_id).with_for_update())
    if ws is None:
        raise ResetError("not_found", Msg("That workspace was not found."))
    res = Result(backup_last_success=(b.isoformat() if (b := last_backup()) else None))

    # ---- which companies go, and where what outlives them goes
    branches = {
        b.id: b for b in (await db.scalars(select(Branch).where(Branch.workspace_id == ws_id)))
    }
    gone = list(dict.fromkeys(remove_branch_ids))
    unknown = [b for b in gone if b not in branches]
    if unknown:
        raise ResetError("bad_branch", Msg("One of the companies picked is not in this office."))
    gone_set = set(gone)
    if move_to is not None and (move_to not in branches or move_to in gone_set):
        raise ResetError(
            "bad_move_to",
            Msg("The company that takes in the AI workers and files must be one you keep."),
        )
    gone_depts = (
        list(
            (
                await db.scalars(
                    select(Department.id).where(
                        Department.workspace_id == ws_id, Department.branch_id.in_(gone)
                    )
                )
            ).all()
        )
        if gone
        else []
    )
    needs_home = bool(gone) and bool(
        await db.scalar(
            select(Agent.id).where(Agent.workspace_id == ws_id, Agent.branch_id.in_(gone)).limit(1)
        )
        or await db.scalar(
            select(DocFile.id)
            .where(DocFile.workspace_id == ws_id, DocFile.branch_id.in_(gone))
            .limit(1)
        )
        or await db.scalar(
            select(LinkedSource.id)
            .where(LinkedSource.workspace_id == ws_id, LinkedSource.branch_id.in_(gone))
            .limit(1)
        )
    )
    if needs_home and move_to is None:
        raise ResetError(
            "move_to_required",
            Msg(
                "Pick the company that takes in the AI workers and files of the companies "
                "you remove."
            ),
        )

    # ---- who goes
    members = (await db.scalars(select(Membership).where(Membership.workspace_id == ws_id))).all()
    owners = [m for m in members if m.role == "owner"]
    if not owners:
        raise ResetError("no_owner", Msg("This office has no owner, so nobody would be left."))
    leaving = [m for m in members if m.role != "owner"]
    ids = [m.user_id for m in leaving]
    res.owners_kept = len(owners)
    res.members_removed = len(ids)
    res.removed_user_ids = ids

    # ---- 1. AI workers: re-homed, and the personal AI of people who leave retired
    if gone and move_to:
        sop_followers = await _sop_followers(db, ws_id, gone, gone_depts)
        res.agents_moved = _rows(
            await db.execute(
                update(Agent)
                .where(Agent.workspace_id == ws_id, Agent.branch_id.in_(gone))
                .values(branch_id=move_to, department_id=None)
                .execution_options(synchronize_session=False)
            )
        )
    else:
        sop_followers = {}
    if ids:
        res.personal_agents_retired = _rows(
            await db.execute(
                update(Agent)
                .where(
                    Agent.workspace_id == ws_id,
                    Agent.owner_user_id.in_(ids),
                    Agent.status != "retired",
                )
                .values(status="retired", heartbeat=False)
                .execution_options(synchronize_session=False)
            )
        )

    # ---- 2. SOPs of removed companies and departments: library SOPs, still attached
    if gone:
        await _keep_sops(db, ws_id, gone, gone_depts, sop_followers, res)

    # ---- 3. files and linked folders move to the new home, in a folder per old company
    if gone and move_to:
        for bid in gone:
            name = branches[bid].name
            files = (
                await db.execute(
                    select(DocFile.id, DocFile.folder).where(
                        DocFile.workspace_id == ws_id, DocFile.branch_id == bid
                    )
                )
            ).all()
            by_folder: dict[str, list[str]] = {}
            for fid, folder in files:
                by_folder.setdefault(_folder_for(name, folder), []).append(fid)
            for folder, fids in by_folder.items():
                await db.execute(
                    update(DocFile)
                    .where(DocFile.id.in_(fids))
                    .values(branch_id=move_to, department_id=None, folder=folder)
                    .execution_options(synchronize_session=False)
                )
            res.files_moved += len(files)
        await db.execute(
            update(KnowledgeChunk)
            .where(
                KnowledgeChunk.workspace_id == ws_id,
                KnowledgeChunk.source_kind != "sop",
                KnowledgeChunk.branch_id.in_(gone),
            )
            .values(branch_id=move_to, department_id=None)
            .execution_options(synchronize_session=False)
        )
        res.linked_folders_moved = _rows(
            await db.execute(
                update(LinkedSource)
                .where(LinkedSource.workspace_id == ws_id, LinkedSource.branch_id.in_(gone))
                .values(branch_id=move_to)
                .execution_options(synchronize_session=False)
            )
        )

    # ---- 4. the companies go (their departments and company-only rows by cascade)
    if gone:
        res.other_rows_removed = sum(
            n for b, n in (await _cascaded_per_branch(db, ws_id)).items() if b in gone_set
        )
        res.departments_removed = len(gone_depts)
        for bid in gone:
            b = branches[bid]
            await audit.record(
                db,
                ws_id,
                actor,
                "branch.deleted",
                target=bid,
                before={"name": b.name, "via": via},
            )
        await db.execute(
            delete(Branch)
            .where(Branch.workspace_id == ws_id, Branch.id.in_(gone))
            .execution_options(synchronize_session=False)
        )
        res.companies_removed = len(gone)
        res.removed_branch_ids = gone
    res.companies_kept = len(branches) - len(gone)
    res.move_to = move_to if (gone and move_to) else None

    # ---- 5. the members go, with what lets them in or acts for them here
    if ids:
        emails = dict((await db.execute(select(User.id, User.email).where(User.id.in_(ids)))).all())
        res.sessions_ended = _rows(
            await db.execute(
                delete(AuthSession).where(
                    AuthSession.workspace_id == ws_id, AuthSession.user_id.in_(ids)
                )
            )
        )
        res.prima_links_ended = _rows(
            await db.execute(
                delete(PrimaLink).where(PrimaLink.workspace_id == ws_id, PrimaLink.user_id.in_(ids))
            )
        )
        for model in (PushSubscription, MicrosoftAccount, GoogleAccount, Device):
            res.connections_removed += _rows(
                await db.execute(
                    delete(model).where(model.workspace_id == ws_id, model.user_id.in_(ids))
                )
            )
        res.connections_removed += _rows(
            await db.execute(
                delete(ChannelLink).where(
                    ChannelLink.user_id.in_(ids),
                    ChannelLink.channel_id.in_(
                        select(Channel.id).where(Channel.workspace_id == ws_id)
                    ),
                )
            )
        )
        res.api_tokens_revoked = _rows(
            await db.execute(
                update(ApiToken)
                .where(
                    ApiToken.workspace_id == ws_id,
                    ApiToken.created_by.in_(ids),
                    ApiToken.revoked_at.is_(None),
                )
                .values(revoked_at=datetime.now(UTC))
            )
        )
        for m in leaving:
            await audit.record(
                db,
                ws_id,
                actor,
                "member.removed",
                target=m.user_id,
                before={"email": emails.get(m.user_id, ""), "role": m.role, "via": via},
            )
        await db.execute(
            delete(Membership).where(Membership.workspace_id == ws_id, Membership.user_id.in_(ids))
        )
        # Nobody else has them: they can no longer sign in anywhere.
        elsewhere = select(Membership.user_id).where(Membership.user_id.in_(ids))
        alone = list(
            (
                await db.scalars(
                    select(User.id).where(
                        User.id.in_(ids), User.id.not_in(elsewhere), User.is_active.is_(True)
                    )
                )
            ).all()
        )
        if alone:
            await db.execute(update(User).where(User.id.in_(alone)).values(is_active=False))
            res.sessions_ended += _rows(
                await db.execute(delete(AuthSession).where(AuthSession.user_id.in_(alone)))
            )
        res.accounts_deactivated = len(alone)

    await audit.record(
        db,
        ws_id,
        actor,
        "workspace.golive_reset",
        target=ws_id,
        after={
            **res.counts(),
            "via": via,
            "removed_branch_ids": res.removed_branch_ids,
            "removed_user_ids": res.removed_user_ids,
        },
        note=(
            f"Last server backup: {res.backup_last_success}"
            if res.backup_last_success
            else "Last server backup: unknown here (the deploy backup is the safety net)"
        ),
    )
    await db.flush()
    return res


async def _sop_followers(
    db: AsyncSession, ws_id: str, gone: list[str], gone_depts: list[str]
) -> dict[str, list[str]]:
    """{branch or department id: the agents in it}, read before the agents move."""
    rows = await db.execute(
        select(Agent.id, Agent.branch_id, Agent.department_id).where(
            Agent.workspace_id == ws_id,
            Agent.branch_id.in_(gone),
            Agent.status != "retired",
        )
    )
    out: dict[str, list[str]] = {}
    for aid, bid, did in rows.all():
        out.setdefault(bid, []).append(aid)
        if did in gone_depts:
            out.setdefault(did, []).append(aid)
    return out


async def _keep_sops(
    db: AsyncSession,
    ws_id: str,
    gone: list[str],
    gone_depts: list[str],
    followers: dict[str, list[str]],
    res: Result,
) -> None:
    sops = (
        await db.scalars(
            select(SOP).where(
                SOP.workspace_id == ws_id,
                or_(
                    (SOP.scope == "branch") & SOP.scope_id.in_(gone),
                    (SOP.scope == "department") & SOP.scope_id.in_(gone_depts or [""]),
                ),
            )
        )
    ).all()
    if not sops:
        return
    attach: dict[str, list[str]] = {}
    for s in sops:
        for aid in followers.get(s.scope_id or "", []):
            attach.setdefault(aid, []).append(s.id)
        s.scope, s.scope_id = "library", None
    for a in (
        (await db.scalars(select(Agent).where(Agent.id.in_(list(attach))))).all() if attach else []
    ):
        a.sop_ids = list(dict.fromkeys([*(a.sop_ids or []), *attach[a.id]]))
    # A library SOP's passages are for everyone (knowledge.indexer.sop_scope).
    await db.execute(
        update(KnowledgeChunk)
        .where(
            KnowledgeChunk.source_kind == "sop", KnowledgeChunk.source_id.in_([s.id for s in sops])
        )
        .values(branch_id=None, department_id=None)
        .execution_options(synchronize_session=False)
    )
    res.sops_kept_as_library = len(sops)
