"""P132 (Fitri, 26 Nov 2026: "remove organization and members settings from Agentic ... let Prima
handle the organization and members ... follow the Prima organization structure and merge with the
organizations and members set up in Agentic"): the office's companies and departments take Prima's
shape, once.

The office had one "company" (branch) per line of the old staff list: the real companies, and also
HQ units ("UNIT HR", "CONTROL ROOM"), regional operations ("OPERASI JOHOR") and teams. The owner
already said which Prima company each is (workspace settings "prima_companies"); Prima's own staff
list names the same units as aliases of its central employers (core real-data.ts CENTRAL_ALIASES).
So, per Prima company:

- one office company, renamed to Prima's name and kept linked to it;
- an office company that was a unit or region of it becomes a department of that company, named as
  Prima names the unit (UNIT HR -> Human Resources under PW Venture Sdn Bhd (PWVSB));
- a second office company for the same real company (a "PIC" copy) is folded into the first.

Nothing is deleted while it still holds anything: every row in every table that points at a merged
company or department (agents, members, tasks, files, SOPs, mailboxes...) is pointed at its new
place first, in one transaction; only the emptied company or department row goes. A branch manager
or group HOD of a unit that becomes a department becomes its head (HOD), so nobody's view widens
to the whole company. An office company with no Prima company stays as it is and is listed.

    python -m agentic.prima.adopt            # dry run: the plan and the counts, changes nothing
    python -m agentic.prima.adopt --apply    # do it (rehearse on a copy of live first)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.db import SessionLocal
from ..core.ids import new_id
from ..models import Branch, Department, Workspace
from . import client

# Prima's central employers (core access.ts) and their full names (core real-data.ts).
CENTRAL_NAMES = {
    "pwvsb": "PW Venture Sdn Bhd (PWVSB)",
    "merdeka": "Merdeka Network Sdn Bhd",
    "goodwill": "Goodwill Empire Sdn Bhd",
    "sasateam": "Sasa Team Sdn Bhd",
    "pgl": "Perfect Global Logistics Sdn Bhd",
}
# The office company that IS the central employer itself (its other office companies are units).
CENTRAL_HOME = {
    "pwvsb": ("pw venture",),
    "merdeka": ("merdeka network",),
    "sasateam": ("sasa team",),
}
# A unit of a central employer, as Prima names it (core org-structure.ts UNIT_LABEL), by the
# office company's name (normalised). Others keep their own name, in title case.
UNIT_NAMES = {
    "unit hr": "Human Resources",
    "unit kewangan de": "Finance",
    "unit kewangan": "Finance",
    "unit audit audit hq": "ACT (Audit, Compliance and Transformation)",
    "unit audit": "ACT (Audit, Compliance and Transformation)",
    "control room": "CMS command centre",
    "unit nepal": "Foreign Worker Management",
    "unit it": "IT",
    "unit pengurusan kbk": "Pengurusan KBK",
    "unit pengurusan sekolah": "Pengurusan Sekolah",
}
SAME_NAME_DEPT = "SELECT id FROM departments WHERE branch_id=:b AND lower(name)=lower(:n)"
ROLE_DOWN = {"branch_manager": "hod", "group_hod": "hod"}


def norm(name: str) -> str:
    s = name.lower().replace("&", " and ")
    s = re.sub(r"\(pic[^)]*\)", " ", s)
    s = re.sub(r"\b(sdn|sn)\s+bhd\b|\(m\)", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def title(name: str) -> str:
    """OPERASI KL/ SELANGOR -> Operasi KL / Selangor: words capitalised, short state codes kept."""
    keep = {"kl", "pkk", "kbk", "hq", "it", "de"}
    words = re.sub(r"\s*/\s*", " / ", name.strip()).split()
    return " ".join(w.upper() if w.lower() in keep else w.lower().capitalize() for w in words)


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:70] or "dept"


@dataclass
class Move:
    """One office company folded into another: as a department of it, or as itself (a copy)."""

    source_id: str
    source_name: str
    as_department: str | None  # None: the same company (its departments move across as they are)


@dataclass
class Target:
    prima_id: str
    prima_name: str
    keep_id: str | None  # the office company kept (renamed); None: made new
    keep_name: str = ""
    moves: list[Move] = field(default_factory=list)


@dataclass
class Plan:
    targets: list[Target]
    unmapped: list[tuple[str, str]]  # (branch id, name) with no Prima company
    workspace_id: str


async def build(db: AsyncSession, prima_names: dict[str, str]) -> Plan:
    ws = await db.scalar(text("SELECT id FROM workspaces ORDER BY created_at LIMIT 1"))
    w = await db.get(Workspace, ws)
    cmap: dict[str, str] = dict((w.settings or {}).get("prima_companies") or {})
    branches = (
        await db.execute(
            text("SELECT id, name FROM branches WHERE workspace_id=:w ORDER BY name"), {"w": ws}
        )
    ).all()
    by_company: dict[str, list[tuple[str, str]]] = defaultdict(list)
    unmapped = []
    for bid, name in branches:
        pid = cmap.get(bid)
        (by_company[pid].append((bid, name)) if pid else unmapped.append((bid, name)))
    targets = []
    for pid, rows in sorted(by_company.items()):
        pname = prima_names.get(pid) or CENTRAL_NAMES.get(pid) or pid
        home = None
        if pid in CENTRAL_NAMES:
            homes = CENTRAL_HOME.get(pid, ())
            home = next((r for r in rows if norm(r[1]) in homes), None)
        else:
            # The plain company first (not a "PIC" copy), else the one whose name is Prima's.
            plain = [r for r in rows if "(pic" not in r[1].lower()]
            home = next((r for r in plain if norm(r[1]) == norm(pname)), None) or (plain or rows)[0]
        t = Target(
            prima_id=pid,
            prima_name=pname,
            keep_id=home[0] if home else None,
            keep_name=home[1] if home else "",
        )
        for bid, name in rows:
            if home and bid == home[0]:
                continue
            if pid in CENTRAL_NAMES:
                t.moves.append(Move(bid, name, UNIT_NAMES.get(norm(name)) or title(name)))
            else:
                t.moves.append(Move(bid, name, None))
        targets.append(t)
    return Plan(targets=targets, unmapped=unmapped, workspace_id=ws)


async def _ref_columns(db: AsyncSession, kind: str) -> list[tuple[str, str]]:
    """Every (table, column) in the office schema that holds a company (or department) id: the
    database's foreign keys, and the plain columns named so (some tables keep the id without
    one)."""
    target = "branches" if kind == "branch" else "departments"
    fk = (
        await db.execute(
            text(
                """SELECT kcu.table_name, kcu.column_name
                   FROM information_schema.table_constraints tc
                   JOIN information_schema.key_column_usage kcu
                     ON kcu.constraint_name = tc.constraint_name
                    AND kcu.table_schema = tc.table_schema
                   JOIN information_schema.constraint_column_usage ccu
                     ON ccu.constraint_name = tc.constraint_name
                    AND ccu.table_schema = tc.table_schema
                   WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = current_schema()
                     AND ccu.table_name = :t AND ccu.column_name = 'id'"""
            ),
            {"t": target},
        )
    ).all()
    named = (
        await db.execute(
            text(
                """SELECT table_name, column_name FROM information_schema.columns
                   WHERE table_schema = current_schema()
                     AND data_type IN ('character varying', 'text')
                     AND column_name ~ :pat AND table_name NOT IN ('branches', 'departments')"""
            ),
            {"pat": r"(^|_)branch_id$" if kind == "branch" else r"(^|_)department_id$"},
        )
    ).all()
    return sorted({(t, c) for t, c in [*fk, *named]})


async def _unique_with(db: AsyncSession, table: str, column: str) -> list[list[str]]:
    """The unique keys of `table` that include `column` (moving a row may meet its twin)."""
    rows = (
        await db.execute(
            text(
                """SELECT i.indexrelid, array_agg(a.attname ORDER BY a.attnum)
                   FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
                   JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
                   WHERE c.relname = :t AND i.indisunique GROUP BY i.indexrelid"""
            ),
            {"t": table},
        )
    ).all()
    return [list(cols) for _, cols in rows if column in cols]


async def _repoint(db: AsyncSession, cols, old: str, new: str, counts: dict) -> None:
    for table, col in cols:
        keys = await _unique_with(db, table, col)
        for key in keys:
            # A row whose twin (same key, the new id) is already there would clash: the twin is
            # kept and this one goes (membership_branches, department_heads: the same fact twice).
            others = [k for k in key if k != col]
            cond = " AND ".join(f't."{k}" = s."{k}"' for k in others) or "TRUE"
            res = await db.execute(
                text(
                    f'DELETE FROM "{table}" s WHERE s."{col}" = :old AND EXISTS '  # noqa: S608 (catalog names)
                    f'(SELECT 1 FROM "{table}" t WHERE t."{col}" = :new AND {cond})'
                ),
                {"old": old, "new": new},
            )
            if res.rowcount:
                counts[f"{table}.{col} (twin dropped)"] += res.rowcount
        res = await db.execute(
            text(f'UPDATE "{table}" SET "{col}" = :new WHERE "{col}" = :old'),  # noqa: S608
            {"old": old, "new": new},
        )
        if res.rowcount:
            counts[f"{table}.{col}"] += res.rowcount


async def apply(db: AsyncSession, plan: Plan, *, dry: bool) -> dict:
    counts: dict[str, int] = defaultdict(int)
    bcols = await _ref_columns(db, "branch")
    dcols = await _ref_columns(db, "department")
    w = await db.get(Workspace, plan.workspace_id)
    settings = dict(w.settings or {})
    cmap = dict(settings.get("prima_companies") or {})
    links = dict(settings.get("prima_company_links") or {})
    for t in plan.targets:
        if t.keep_id is None:
            b = Branch(
                id=new_id("br"),
                workspace_id=plan.workspace_id,
                name=t.prima_name,
                slug=slug(t.prima_name),
                industry="security",
            )
            db.add(b)
            await db.flush()
            t.keep_id = b.id
            counts["companies made"] += 1
        keep = await db.get(Branch, t.keep_id)
        assert keep is not None
        if keep.name != t.prima_name:
            keep.name = t.prima_name[:120]
            counts["companies renamed"] += 1
        cmap[keep.id] = t.prima_id
        for mv in t.moves:
            src = await db.get(Branch, mv.source_id)
            if src is None:
                continue
            if mv.as_department:
                # The unit becomes one department of the company; its own departments fold into it.
                dept = await db.scalar(
                    text(SAME_NAME_DEPT),
                    {"b": keep.id, "n": mv.as_department},
                )
                if dept is None:
                    s = slug(mv.as_department)
                    taken = {
                        r
                        for (r,) in (
                            await db.execute(
                                text("SELECT slug FROM departments WHERE branch_id=:b"),
                                {"b": keep.id},
                            )
                        ).all()
                    }
                    while s in taken:
                        s = f"{s}-2"
                    pos = await db.scalar(
                        text(
                            "SELECT coalesce(max(position), 0) + 1 FROM departments"
                            " WHERE branch_id=:b"
                        ),
                        {"b": keep.id},
                    )
                    d = Department(
                        id=new_id("dp"),
                        workspace_id=plan.workspace_id,
                        branch_id=keep.id,
                        name=mv.as_department[:120],
                        slug=s,
                        position=pos,
                    )
                    db.add(d)
                    await db.flush()
                    dept = d.id
                    counts["departments made"] += 1
                # Office roles that cover a whole company cover only this department now.
                for old_role, new_role in ROLE_DOWN.items():
                    res = await db.execute(
                        text(
                            "UPDATE memberships SET role=:n, heads_department=true"
                            " WHERE branch_id=:b AND role=:o"
                        ),
                        {"n": new_role, "o": old_role, "b": src.id},
                    )
                    if res.rowcount:
                        counts[f"{old_role} -> head of the department"] += res.rowcount
                # People and agents of the unit with no department of their own join this one.
                for table in ("memberships", "agents"):
                    res = await db.execute(
                        text(
                            f"UPDATE {table} SET department_id=:d"  # noqa: S608 (two fixed tables)
                            " WHERE branch_id=:b AND department_id IS NULL"
                        ),
                        {"d": dept, "b": src.id},
                    )
                    counts[f"{table} placed in the department"] += res.rowcount
                for (old_dept,) in (
                    await db.execute(
                        text("SELECT id FROM departments WHERE branch_id=:b"), {"b": src.id}
                    )
                ).all():
                    await _repoint(db, dcols, old_dept, dept, counts)
                    await db.execute(text("DELETE FROM departments WHERE id=:d"), {"d": old_dept})
                    counts["departments folded"] += 1
            else:
                # The same company twice: its departments go across (renamed if the name is taken).
                for did, dname in (
                    await db.execute(
                        text("SELECT id, name FROM departments WHERE branch_id=:b"), {"b": src.id}
                    )
                ).all():
                    twin = await db.scalar(
                        text(SAME_NAME_DEPT),
                        {"b": keep.id, "n": dname},
                    )
                    if twin:
                        await _repoint(db, dcols, did, twin, counts)
                        await db.execute(text("DELETE FROM departments WHERE id=:d"), {"d": did})
                        counts["departments folded"] += 1
                    else:
                        taken = {
                            r
                            for (r,) in (
                                await db.execute(
                                    text("SELECT slug FROM departments WHERE branch_id=:b"),
                                    {"b": keep.id},
                                )
                            ).all()
                        }
                        s = slug(dname)
                        while s in taken:
                            s = f"{s}-2"
                        await db.execute(
                            text("UPDATE departments SET branch_id=:k, slug=:s WHERE id=:d"),
                            {"k": keep.id, "s": s, "d": did},
                        )
                        counts["departments moved across"] += 1
            await _repoint(db, bcols, src.id, keep.id, counts)
            await db.execute(text("DELETE FROM branches WHERE id=:b"), {"b": src.id})
            counts["companies folded"] += 1
            cmap.pop(src.id, None)
            links.pop(src.id, None)
    settings["prima_companies"] = cmap
    settings["prima_company_links"] = links
    w.settings = settings
    left = (
        await db.execute(
            text("SELECT count(*) FROM branches WHERE workspace_id=:w"), {"w": plan.workspace_id}
        )
    ).scalar()
    counts["companies after"] = int(left or 0)
    if dry:
        await db.rollback()
    else:
        await db.commit()
    return dict(counts)


def show(plan: Plan) -> str:
    out = []
    for t in plan.targets:
        keep = f'"{t.keep_name}"' if t.keep_id else "(new)"
        out.append(f"{t.prima_name}  <-  {keep}")
        for mv in t.moves:
            where = (
                f'department "{mv.as_department}"'
                if mv.as_department
                else "folded in (same company)"
            )
            out.append(f'    + "{mv.source_name}"  ->  {where}')
    if plan.unmapped:
        out.append("No Prima company (left as they are): " + ", ".join(n for _, n in plan.unmapped))
    return "\n".join(out)


async def main(apply_it: bool) -> int:
    names = {c.id: c.name for c in await client.companies()}
    async with SessionLocal() as db:
        plan = await build(db, names)
        print(show(plan))
        counts = await apply(db, plan, dry=not apply_it)
    print(
        ("APPLIED " if apply_it else "DRY RUN (nothing changed) ")
        + json.dumps(counts, indent=1, sort_keys=True)
    )
    return 0


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--apply", action="store_true", help="make the changes (default: dry run)")
    sys.exit(asyncio.run(main(p.parse_args().apply)))
