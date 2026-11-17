"""P111: link the organizations already in the office to their Prima companies, once (Fitri,
17 Nov 2026: "what organization added in agentic must exist in prima as well"). Inside the api
container:

    docker compose exec api python -m agentic.prima.org_link_all --workspace <slug> --dry-run
    docker compose exec api python -m agentic.prima.org_link_all --workspace <slug>

- Each organization with no Prima company yet is linked to the Prima company of exactly its
  name (or one of its other names), as when it is added (org_link.link). Linked ones are
  counted and left as they are.
- One Prima does not have is NOT added here: Prima needs its SSM number, primary state, source
  document and a reason, which the owner gives on the Organization page ("Add to Prima").
  They are listed by name so the owner knows which.
- Prints counts and organization names (company names, never a person's). --dry-run changes
  nothing. Running it again changes nothing new.
"""

import argparse
import asyncio
import sys
from collections import defaultdict

from sqlalchemy import select

from ..core.db import SessionLocal, engine
from ..i18n import use_lang
from ..models import Branch, Workspace
from . import client, org_link

ACTOR = "system:org_link_all"
LABELS = (
    ("already", "already linked"),
    ("matched", "linked to the Prima company of the same name"),
    ("details_needed", "not in Prima: add it with its SSM details (Organization page)"),
    ("ambiguous", "more than one Prima company has the name: pick on the Prima page"),
    ("prima_down", "Prima not answering: run again"),
    ("refused", "refused by Prima"),
)


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


async def link_all(workspace_id: str, *, dry: bool) -> dict[str, list[str]]:
    """{outcome: [organization names]}."""
    out: dict[str, list[str]] = defaultdict(list)
    found = await client.companies()  # refused here: nothing is changed
    async with SessionLocal() as db:
        rows = (
            await db.execute(
                select(Branch.id, Branch.name)
                .where(Branch.workspace_id == workspace_id)
                .order_by(Branch.name)
            )
        ).all()
        for bid, name in rows:
            b = await db.get(Branch, bid)
            if b is None:
                continue
            how = await org_link.link(db, workspace_id, b, actor=ACTOR, found=found, dry=dry)
            out[how].append(name)
        if dry:
            await db.rollback()
    return out


def show(out: dict[str, list[str]]) -> None:
    print(f"Organizations: {sum(len(v) for v in out.values())}")
    for key, label in LABELS:
        names = out.get(key) or []
        if not names:
            continue
        print(f"  {label}: {len(names)}")
        if key != "already":
            for n in names:
                print(f"    {n}")
    other = {k: v for k, v in out.items() if k not in dict(LABELS)}
    for key, names in other.items():
        print(f"  {key}: {len(names)}")


async def run(args: argparse.Namespace) -> int:
    async with SessionLocal() as db:
        ws = await _workspace(db, args.workspace)
        ws_id, slug = ws.id, ws.slug
    if not client.enabled(ws_id):
        raise Stop("Prima is not set up on this server (PRIMA_URL, PRIMA_SECRET).")
    print(f"Workspace: {slug}")
    try:
        out = await link_all(ws_id, dry=args.dry_run)
    except client.PrimaError as e:
        raise Stop(f"Prima did not answer with its companies ({e.status}).") from e
    show(out)
    print("Dry run: nothing was changed." if args.dry_run else "Done.")
    return 0


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m agentic.prima.org_link_all", description=(__doc__ or "").split("\n\n")[0]
    )
    p.add_argument("--workspace", metavar="SLUG")
    p.add_argument("--dry-run", action="store_true", help="show, change nothing")
    return p


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)

    async def go() -> int:
        try:
            with use_lang("en"):
                return await run(args)
        except Stop as e:
            print(f"Stopped: {e}", file=sys.stderr)
            return 2
        finally:
            await engine.dispose()

    return asyncio.run(go())


if __name__ == "__main__":
    sys.exit(main())
