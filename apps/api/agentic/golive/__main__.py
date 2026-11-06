"""P81: start fresh for go-live, from the server (the same reset as Settings > Data and
privacy > Start fresh). Inside the api container:

    docker compose cp staff.xlsx api:/tmp/staff.xlsx
    docker compose exec api python -m agentic.golive --dry-run --keep-companies-from /tmp/staff.xlsx
    docker compose exec api python -m agentic.golive --yes --keep-companies-from /tmp/staff.xlsx

- Every member except the owners leaves; companies the file does not name go (a close match
  counts as named: when in doubt a company stays). Without --keep-companies-from no company
  is removed.
- AI workers, files and linked folders of the removed companies move to --move-to (a company
  name; made when the office does not have it yet), else to the kept company with the most
  AI workers.
- The file is the members import sheet (.xlsx or .csv: its Company column) or JSON (a list of
  rows with "company", a list of names, or {"companies": [...]}).
- --dry-run does the whole reset in a transaction and rolls it back, so the counts are exact.
- It prints counts only, never names or emails (company names only with --show-companies).
  Every change is in the audit log as actor `system:golive-cli`.

Take a backup first: docker compose exec -T backup agentic-backup backup
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

from sqlalchemy import func, select

from ..core.db import SessionLocal, engine
from ..i18n import render
from ..models import Agent, Branch, Workspace
from . import service

ACTOR = "system:golive-cli"


def company_names(path: Path) -> list[str]:
    """The company names a members sheet or a JSON file lists (each once)."""
    from ..api.routers import member_import

    data = path.read_bytes()
    names: list[str] = []
    if path.suffix.lower() == ".json":
        raw: Any = json.loads(data.decode("utf-8-sig"))
        if isinstance(raw, dict):
            raw = raw.get("companies", [])
        if not isinstance(raw, list):
            raise SystemExit("The JSON file must be a list of rows or of company names.")
        for item in raw:
            if isinstance(item, str):
                names.append(item)
            elif isinstance(item, dict):
                names.append(str(item.get("company") or item.get("Company") or ""))
    else:
        try:
            _, rows = member_import._read_rows(data, path.name)
        except Exception as e:  # noqa: BLE001 - an HTTPException from the reader
            raise SystemExit(f"Could not read {path.name} as Excel or CSV.") from e
        found = member_import.find_header(rows)
        if found is None or "company" not in found[1]:
            raise SystemExit(f"{path.name} has no Company column.")
        header, cols = found
        col = cols["company"]
        names = [r[col] for r in rows[header + 1 :] if col < len(r)]
    out: dict[str, str] = {}
    for n in names:
        clean = " ".join(str(n).split())
        if clean:
            out.setdefault(member_import._norm(clean), clean)
    return list(out.values())


def plan_companies(
    branches: dict[str, str], keep_names: list[str] | None
) -> tuple[list[str], int, int]:
    """(ids of the companies to remove, how many kept by exact name, how many by a close
    match). No list: every company stays."""
    from ..api.routers.member_import import _company_key, best_match

    if keep_names is None:
        return [], len(branches), 0
    options = {str(i): n for i, n in enumerate(keep_names)}
    remove: list[str] = []
    exact = close = 0
    for bid, name in branches.items():
        hit = best_match(name, options, _company_key) if options else None
        if hit is None:
            remove.append(bid)
        elif hit[1]:
            exact += 1
        else:
            close += 1
    return remove, exact, close


async def _workspace(db: Any, slug: str | None) -> Workspace:
    spaces = (await db.scalars(select(Workspace).order_by(Workspace.created_at))).all()
    if slug:
        spaces = [w for w in spaces if slug in (w.slug, w.id)]
    if not spaces:
        raise SystemExit(f"No workspace {slug}." if slug else "No workspace yet.")
    if len(spaces) > 1:
        raise SystemExit(
            "More than one workspace ("
            + ", ".join(w.slug for w in spaces)
            + "): pick one with --workspace <slug>."
        )
    return spaces[0]


async def _move_to(
    db: Any, ws_id: str, branches: dict[str, str], remove: list[str], name: str | None
) -> tuple[str | None, bool]:
    """(the company that takes in what moves, whether it was made now)."""
    from ..api.routers.member_import import _company_key, _company_name, best_match
    from ..api.routers.org import _unique_slug

    kept = {i: n for i, n in branches.items() if i not in remove}
    if name:
        hit = best_match(name, kept, _company_key)
        if hit is not None and hit[1]:
            return hit[0], False
        if any(best_match(name, {i: branches[i]}, _company_key) for i in remove):
            raise SystemExit("--move-to names a company that is being removed.")
        clean = _company_name(name)
        slug = await _unique_slug(db, Branch, Branch.workspace_id, ws_id, clean, "branch")
        b = Branch(workspace_id=ws_id, name=clean, slug=slug)
        db.add(b)
        await db.flush()
        from ..services import audit

        await audit.record(
            db, ws_id, ACTOR, "branch.created", target=b.id, after={"name": clean, "via": "golive"}
        )
        return b.id, True
    if not kept:
        return None, False
    counts = dict(
        (
            await db.execute(
                select(Agent.branch_id, func.count())
                .where(Agent.workspace_id == ws_id, Agent.branch_id.in_(list(kept)))
                .group_by(Agent.branch_id)
            )
        ).all()
    )
    return sorted(kept, key=lambda i: (-counts.get(i, 0), kept[i].lower()))[0], False


def _print(label: str, n: Any) -> None:
    print(f"  {label:<44} {n}")


async def run(args: argparse.Namespace) -> int:
    keep = company_names(Path(args.keep_companies_from)) if args.keep_companies_from else None
    async with SessionLocal() as db:
        ws = await _workspace(db, args.workspace)
        before = await service.survey(db, ws.id)
        branches = {c["id"]: c["name"] for c in before["companies"]}
        remove, exact, close = plan_companies(branches, keep)
        move_to, made = await _move_to(db, ws.id, branches, remove, args.move_to)
        print(f"Workspace: {ws.slug}")
        print("Now:")
        _print(
            "members (owners stay)",
            f"{before['members']['total']} ({before['members']['owners']} owners)",
        )
        _print("companies", len(branches))
        _print("departments", before["departments"])
        _print("AI workers", before["agents"])
        _print("files", before["files"])
        _print("SOPs", before["sops"])
        if keep is not None:
            _print("companies named in the file", len(keep))
        _print("companies kept: same name / close match", f"{exact} / {close}")
        if args.show_companies:
            for bid in remove:
                print(f"    remove: {branches[bid]}")
        backup = before["backup"]["last_success"]
        print(f"Last server backup: {backup or 'unknown from here'}")
        if not backup:
            print(f"  Take one first: {service.BACKUP_COMMAND}")
        try:
            res = await service.reset(
                db,
                ws.id,
                ACTOR,
                remove_branch_ids=remove,
                move_to=move_to,
                via="golive-cli",
            )
        except service.ResetError as e:
            await db.rollback()
            print(f"Stopped: {render(e.message, 'en')}", file=sys.stderr)
            return 2
        print("Dry run (nothing was changed):" if args.dry_run else "Done:")
        if made:
            _print("company made to take in what moved", 1)
        for k, v in res.counts().items():
            if k not in ("move_to", "backup_last_success"):
                _print(k.replace("_", " "), v)
        if args.dry_run:
            await db.rollback()
        else:
            await db.commit()
            from ..engine import privacy

            privacy.invalidate(ws.id)
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="python -m agentic.golive", description=(__doc__ or "").split("\n\n")[0]
    )
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="count, change nothing")
    mode.add_argument("--yes", action="store_true", help="do the reset")
    p.add_argument("--keep-companies-from", metavar="FILE", help=".xlsx, .csv or .json")
    p.add_argument("--move-to", metavar="COMPANY", help="where AI workers and files go")
    p.add_argument("--workspace", metavar="SLUG")
    p.add_argument("--show-companies", action="store_true", help="list the companies removed")
    args = p.parse_args(argv)

    async def go() -> int:
        try:
            return await run(args)
        finally:
            await engine.dispose()

    return asyncio.run(go())


if __name__ == "__main__":
    sys.exit(main())
