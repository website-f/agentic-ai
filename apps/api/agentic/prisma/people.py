"""P67: who in the office is which Prima staff record (models.PrismaLink).

People link themselves without doing anything when they signed in with Microsoft and IT had
recorded that account in Prima (client.link_for). For everyone else the owner's Prisma page
lists the office's people beside Prima's records, with the likely record already picked (the
same Microsoft account, else the one record with exactly the same name), and one button links
them all. A guess is never linked on its own: a link decides whose pay, leave and HR records
someone sees, so a person confirms it.
"""

import re
import unicodedata
from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..i18n import Msg
from ..models import Membership, PrismaLink, User
from ..services import audit
from .client import PrimaError, StaffRecord


@dataclass(frozen=True)
class Person:
    user_id: str
    name: str
    email: str
    role: str
    ms_oid: str | None
    link: PrismaLink | None


def name_key(name: str) -> str:
    """'Mohd. Fauzan  bin Ali' and 'mohd fauzan bin ali' are the same name."""
    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return " ".join(re.findall(r"[a-z0-9]+", plain.lower()))


async def people(db: AsyncSession, workspace_id: str) -> list[Person]:
    rows = (
        await db.execute(
            select(Membership, User)
            .join(User, User.id == Membership.user_id)
            .where(Membership.workspace_id == workspace_id, User.is_active.is_(True))
            .order_by(User.name)
        )
    ).all()
    links = {
        lk.user_id: lk
        for lk in (
            await db.scalars(select(PrismaLink).where(PrismaLink.workspace_id == workspace_id))
        ).all()
    }
    return [
        Person(
            user_id=u.id,
            name=u.name,
            email=u.email,
            role=m.role,
            ms_oid=(m.ms_oid or "").lower() or None,
            link=links.get(u.id),
        )
        for m, u in rows
    ]


def suggestions(persons: list[Person], staff: list[StaffRecord]) -> dict[str, str]:
    """user_id -> Prima record id, for unlinked people and records only: the record IT gave
    the person's Microsoft account, else the only record with the same name (and nobody else
    in the office with that name)."""
    taken = {p.link.prima_user_id for p in persons if p.link}
    free = [r for r in staff if r.id not in taken]
    by_oid = {r.entra_oid: r.id for r in free if r.entra_oid}
    by_name: dict[str, list[str]] = {}
    for r in free:
        by_name.setdefault(name_key(r.name), []).append(r.id)
    office_names: dict[str, int] = {}
    for p in persons:
        office_names[name_key(p.name)] = office_names.get(name_key(p.name), 0) + 1
    out: dict[str, str] = {}
    for p in persons:
        if p.link:
            continue
        if p.ms_oid and p.ms_oid in by_oid:
            out[p.user_id] = by_oid[p.ms_oid]
            continue
        key = name_key(p.name)
        hits = by_name.get(key, [])
        if key and len(hits) == 1 and office_names[key] == 1:
            out[p.user_id] = hits[0]
    # Never the same record for two people.
    counts: dict[str, int] = {}
    for rid in out.values():
        counts[rid] = counts.get(rid, 0) + 1
    return {u: rid for u, rid in out.items() if counts[rid] == 1}


async def set_link(
    db: AsyncSession,
    workspace_id: str,
    user_id: str,
    record: StaffRecord | None,
    actor: str,
) -> None:
    """Link (or, with no record, unlink) one person, by the owner. Commits."""
    m = await db.get(Membership, (workspace_id, user_id))
    if m is None:
        raise PrimaError(404, Msg("That person is not in this office."))
    old = await db.get(PrismaLink, (workspace_id, user_id))
    if record is not None:
        other = await db.scalar(
            select(PrismaLink).where(
                PrismaLink.workspace_id == workspace_id,
                PrismaLink.prima_user_id == record.id,
                PrismaLink.user_id != user_id,
            )
        )
        if other is not None:
            raise PrimaError(
                409, Msg("That Prima record is already linked to someone else in the office.")
            )
    if old is not None:
        await db.execute(
            delete(PrismaLink).where(
                PrismaLink.workspace_id == workspace_id, PrismaLink.user_id == user_id
            )
        )
    if record is not None:
        db.add(
            PrismaLink(
                workspace_id=workspace_id,
                user_id=user_id,
                prima_user_id=record.id,
                prima_name=record.name[:200],
                how="owner",
                linked_by=actor,
            )
        )
    await audit.record(
        db,
        workspace_id,
        actor,
        "prisma.link" if record else "prisma.unlink",
        target=user_id,
        before={"prima_user_id": old.prima_user_id} if old else None,
        after={"prima_user_id": record.id} if record else None,
    )
    await db.commit()
