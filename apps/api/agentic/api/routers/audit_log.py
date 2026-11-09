from typing import Literal

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import ColumnElement, and_, func, not_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...models import AuditLog, User
from ...services import audit
from .. import paging
from ..deps import Principal, api_error, require
from ..schemas import AuditOut, AuditPage
from ..table import TableParams, like, sql_page

router = APIRouter(prefix="/api/audit", tags=["audit"])

Kind = Literal["signin", "people", "org", "work", "agents", "other"]
# Entity (the part of the action before the dot) per kind; the activity page filters on these.
KIND_ENTITIES: dict[str, tuple[str, ...]] = {
    "people": ("member",),
    "org": ("workspace", "branch", "department"),
    "work": (
        "task",
        "file",
        "document",
        "pack",
        "workflow",
        "template",
        "meeting",
        "broadcast",
        "report",
        "schedule",
    ),
    "agents": ("agent", "skill", "sop", "brain", "blueprint"),
}


def _entity() -> ColumnElement[str]:
    return func.split_part(AuditLog.action, ".", 1)


def _kind_where(kind: str) -> ColumnElement[bool]:
    if kind == "signin":
        return AuditLog.action == "auth.login"
    if kind == "people":
        return or_(
            _entity().in_(KIND_ENTITIES["people"]),
            and_(_entity() == "auth", AuditLog.action != "auth.login"),
        )
    if kind == "other":
        known = [e for v in KIND_ENTITIES.values() for e in v] + ["auth"]
        return not_(_entity().in_(known))
    return _entity().in_(KIND_ENTITIES[kind])


def _kind_of(entity: str, action: str) -> str:
    if entity == "auth":
        return "signin" if action == "auth.login" else "people"
    return next((k for k, v in KIND_ENTITIES.items() if entity in v), "other")


async def _kinds(db: AsyncSession, workspace_id: str) -> dict[str, int]:
    """Entries per kind. Grouped by action (a few dozen distinct values), mapped here."""
    rows = (
        await db.execute(
            select(AuditLog.action, func.count())
            .where(AuditLog.workspace_id == workspace_id)
            .group_by(AuditLog.action)
        )
    ).all()
    out: dict[str, int] = {}
    for action, n in rows:
        k = _kind_of(action.split(".")[0], action)
        out[k] = out.get(k, 0) + n
    return out


def _words_where(words: list[str]) -> ColumnElement[bool]:
    """P96: every word is in the action, the note, the target, or the name or email of the
    person who did it."""
    conds = []
    for w in words:
        pat = like(w)
        people = select(func.concat("user:", User.id)).where(
            or_(User.name.ilike(pat, escape="\\"), User.email.ilike(pat, escape="\\"))
        )
        conds.append(
            or_(
                AuditLog.action.ilike(pat, escape="\\"),
                AuditLog.note.ilike(pat, escape="\\"),
                AuditLog.target.ilike(pat, escape="\\"),
                AuditLog.actor.ilike(pat, escape="\\"),
                AuditLog.actor.in_(people),
            )
        )
    return and_(*conds)


@router.get("")
async def list_audit(
    response: Response,
    limit: int = Query(default=50, ge=1, le=paging.MAX_LIMIT),
    before_id: int | None = Query(default=None),
    cursor: str | None = Query(default=None, max_length=40),
    kind: Kind | None = None,
    table: TableParams = Depends(),
    principal: Principal = Depends(require("audit.read")),
    db: AsyncSession = Depends(get_db),
) -> AuditPage:
    """Newest first. Page with `before_id` (or `cursor`, the same value from X-Next-Cursor);
    `kind` filters on the server so every page is the chosen kind. The first page also counts
    entries per kind.

    P96 (the activity table): `page` and `size` for numbered pages, `q` to find words in the
    action, note, target or who did it, `sort` "ts" or "-ts" (newest first, the default)."""
    if cursor:
        if not cursor.isdigit():
            raise api_error(
                status.HTTP_400_BAD_REQUEST, "bad_cursor", "That page cursor is not valid."
            )
        before_id = int(cursor)
    q = select(AuditLog).where(AuditLog.workspace_id == principal.workspace_id)
    if kind:
        q = q.where(_kind_where(kind))
    if table.words:
        q = q.where(_words_where(table.words))
    first = before_id is None
    if table.paged:
        _, desc = table.sort_by(("ts",), default="-ts")
        page = await sql_page(db, q, [(AuditLog.id, desc)], table, response)
        more = False
        kinds = await _kinds(db, principal.workspace_id)
        total = int(response.headers[paging.TOTAL])
    else:
        if before_id is not None:
            q = q.where(AuditLog.id < before_id)
        rows = (await db.scalars(q.order_by(AuditLog.id.desc()).limit(limit + 1))).all()
        page, more = list(rows[:limit]), len(rows) > limit
        kinds = await _kinds(db, principal.workspace_id) if first else None
        if kinds is None:
            total = None
        elif table.words:
            total = await paging.count(db, q)
        else:
            total = kinds.get(kind, 0) if kind else sum(kinds.values())
        if total is not None:
            response.headers[paging.TOTAL] = str(total)
        if more and page:
            response.headers[paging.NEXT] = str(page[-1].id)

    user_ids = {r.actor.removeprefix("user:") for r in page if r.actor.startswith("user:")}
    names = (
        dict((await db.execute(select(User.id, User.name).where(User.id.in_(user_ids)))).all())
        if user_ids
        else {}
    )

    items = [
        AuditOut(
            id=r.id,
            ts=r.ts,
            actor=r.actor,
            actor_name=names.get(r.actor.removeprefix("user:")),
            action=r.action,
            target=r.target,
            before=r.before,
            after=r.after,
            note=r.note,
        )
        for r in page
    ]
    return AuditPage(
        items=items,
        next_before_id=page[-1].id if more and page else None,
        kinds=kinds,
        total=total,
    )


@router.get("/verify")
async def verify(
    principal: Principal = Depends(require("audit.read")), db: AsyncSession = Depends(get_db)
) -> dict:
    return await audit.verify_chain(db, principal.workspace_id)
