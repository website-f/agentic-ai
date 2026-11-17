"""P111: bring the organization names saved before P111 to the standard (capitals, trimmed,
single spaces; org/names.py). Inside the api container:

    docker compose exec api python -m agentic.org.upper_names --workspace <slug> --dry-run
    docker compose exec api python -m agentic.org.upper_names --workspace <slug>

- Organizations (branches) only. Departments keep their case and are only trimmed to single
  spaces (counted, with their names, the same way).
- Prints the counts and each change as "before -> after". These are company and department
  names, never a person's.
- A name that would become the same as another organization's is skipped and shown, for the
  owner to rename or merge by hand; nothing else is held up.
- Each rename is audited (branch.updated / department.updated, actor system:upper_names).
  The Prima companies are not touched: a change of case is not a rename (org_link).
- --dry-run changes nothing. Running it again changes nothing new.
"""

import argparse
import asyncio
import sys

from sqlalchemy import select

from ..core.db import SessionLocal, engine
from ..models import Branch, Department, Workspace
from ..services import audit
from .names import org_key, org_name, spaced

ACTOR = "system:upper_names"


class Stop(Exception):
    """A plain-English reason to stop, with nothing changed."""


async def _workspace(db, slug: str | None) -> Workspace:
    spaces = (await db.scalars(select(Workspace).order_by(Workspace.created_at))).all()
    if slug:
        spaces = [w for w in spaces if slug in (w.slug, w.id)]
    if not spaces:
        raise Stop(f"No workspace {slug}." if slug else "No workspace yet.")
    if len(spaces) > 1:
        raise Stop(
            "More than one workspace ("
            + ", ".join(w.slug for w in spaces)
            + "): pick one with --workspace <slug>."
        )
    return spaces[0]


async def upper_names(workspace_id: str, *, dry: bool) -> dict[str, list]:
    """{"branches": [(before, after)], "clashes": [(before, after)], "departments": [...],
    "total_branches": [n], "total_departments": [n]}."""
    out: dict[str, list] = {"branches": [], "clashes": [], "departments": []}
    async with SessionLocal() as db:
        branches = (
            await db.scalars(
                select(Branch)
                .where(Branch.workspace_id == workspace_id)
                .order_by(Branch.created_at, Branch.id)
            )
        ).all()
        taken: dict[str, str] = {}
        for b in branches:
            taken.setdefault(org_key(b.name), b.id)
        for b in branches:
            after = org_name(b.name)
            if not after or after == b.name:
                continue
            owner = taken.get(org_key(after))
            if owner is not None and owner != b.id:
                out["clashes"].append((b.name, after))
                continue
            out["branches"].append((b.name, after))
            if not dry:
                before = b.name
                b.name = after
                await audit.record(
                    db, workspace_id, ACTOR, "branch.updated", target=b.id,
                    before={"name": before}, after={"name": after},
                    note="P111: organization names in capitals",
                )  # fmt: skip
        depts = (
            await db.scalars(
                select(Department)
                .where(Department.workspace_id == workspace_id)
                .order_by(Department.branch_id, Department.position, Department.id)
            )
        ).all()
        for d in depts:
            after = spaced(d.name)
            if not after or after == d.name:
                continue
            out["departments"].append((d.name, after))
            if not dry:
                before = d.name
                d.name = after
                await audit.record(
                    db, workspace_id, ACTOR, "department.updated", target=d.id,
                    before={"name": before}, after={"name": after},
                    note="P111: names trimmed to single spaces",
                )  # fmt: skip
        if dry:
            await db.rollback()
        else:
            await db.commit()
        out["total_branches"] = [len(branches)]
        out["total_departments"] = [len(depts)]
    return out


def show(out: dict[str, list]) -> None:
    print(f"Organizations: {out['total_branches'][0]}")
    print(f"  to capitals: {len(out['branches'])}")
    for before, after in out["branches"]:
        print(f"    {before} -> {after}")
    if out["clashes"]:
        print(f"  skipped, the name is another organization's: {len(out['clashes'])}")
        for before, after in out["clashes"]:
            print(f"    {before} -> {after} (rename or merge by hand)")
    print(f"Departments: {out['total_departments'][0]}")
    print(f"  spacing tidied: {len(out['departments'])}")
    for before, after in out["departments"]:
        print(f"    {before!r} -> {after!r}")


async def run(args: argparse.Namespace) -> int:
    async with SessionLocal() as db:
        ws = await _workspace(db, args.workspace)
        ws_id, slug = ws.id, ws.slug
    print(f"Workspace: {slug}")
    show(await upper_names(ws_id, dry=args.dry_run))
    print("Dry run: nothing was changed." if args.dry_run else "Done.")
    return 0


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m agentic.org.upper_names", description=(__doc__ or "").split("\n\n")[0]
    )
    p.add_argument("--workspace", metavar="SLUG")
    p.add_argument("--dry-run", action="store_true", help="show, change nothing")
    return p


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)

    async def go() -> int:
        try:
            return await run(args)
        except Stop as e:
            print(f"Stopped: {e}", file=sys.stderr)
            return 2
        finally:
            await engine.dispose()

    return asyncio.run(go())


if __name__ == "__main__":
    sys.exit(main())
