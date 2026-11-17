"""P109: link everyone already in the office to Prima, once (Fitri, 17 Nov 2026: "link all
existing ones now"). Inside the api container:

    docker compose exec api python -m agentic.prima.link_all --workspace <slug> --dry-run
    docker compose exec api python -m agentic.prima.link_all --workspace <slug>

- The same path as a first Prima open (client.ensure): their own staff record when the match is
  sure (the Microsoft account IT recorded on it, else the only record of exactly their name),
  else their own Prima account at the level of their office role in the Prima company of their
  branch. An own account made at an earlier level is brought to the office's level.
- Owners, admins and the developer open Prima as its top record (the CEO): counted, untouched.
- Prints counts only, never names or emails. --dry-run changes nothing (no link, no Prima
  account, no audit row). Running it again changes nothing new (idempotent).
- Prima is asked for its staff list once; each person is saved on their own, so one refusal
  never undoes the others. Anyone refused is tried again when they first open Prima.
"""

import argparse
import asyncio
import sys
from collections import Counter

from sqlalchemy import select

from ..core.db import SessionLocal, engine
from ..i18n import use_lang
from ..models import Membership, User, Workspace
from . import client

# Printed in this order (key: label).
LABELS = (
    ("top", "open as the CEO record (owners, admins, developer): nothing to do"),
    ("already", "already linked"),
    ("refreshed", "own Prima account brought to the office's level (or relinked)"),
    ("microsoft", "linked to their Prima record by Microsoft account"),
    ("name", "linked to their Prima record by name"),
    ("account", "own Prima account made"),
    ("refused:no_branch", "refused: company needed (no branch)"),
    ("refused:unmapped", "refused: company needed (branch has no Prima company)"),
    ("refused:account_refused", "refused: Prima's accounts service refused the account"),
    ("refused:prima_down", "refused: Prima not answering"),
    ("refused:other", "refused: other"),
    ("inactive", "skipped: account switched off"),
)


class Stop(Exception):
    """A plain-English reason to stop, with nothing changed."""


def refusal(e: client.PrimaError, no_branch: bool) -> str:
    if e.code == "company_needed":
        return "refused:no_branch" if no_branch else "refused:unmapped"
    if e.code == "account_refused":
        return "refused:account_refused"
    if e.status == 503:
        return "refused:prima_down"
    return "refused:other"


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


async def link_all(workspace_id: str, *, dry: bool) -> Counter[str]:
    """Every member, counted by what happened (or, dry, would happen): LABELS keys."""
    counts: Counter[str] = Counter()
    async with SessionLocal() as db:
        rows = (
            await db.execute(
                select(Membership.user_id, User.is_active)
                .join(User, User.id == Membership.user_id)
                .where(Membership.workspace_id == workspace_id)
                .order_by(Membership.created_at, Membership.user_id)
            )
        ).all()
        records: list[client.StaffRecord] | None = None
        for user_id, active in rows:
            m = await db.get(Membership, (workspace_id, user_id))
            if m is None:
                continue
            if not active:
                counts["inactive"] += 1
                continue
            if client.opens_as_top(m):
                counts["top"] += 1
                continue
            no_branch = m.branch_id is None  # read now: a rollback below expires `m`
            try:
                if records is None:
                    records = client.matchable(await client.staff())
                _, how = await client.ensure(db, workspace_id, user_id, records=records, dry=dry)
                counts[how] += 1
            except client.PrimaError as e:
                await db.rollback()
                counts[refusal(e, no_branch)] += 1
        if dry:
            await db.rollback()
    return counts


def show(counts: Counter[str], total: int) -> None:
    print(f"Members: {total}")
    for key, label in LABELS:
        if counts.get(key):
            print(f"  {label:<66} {counts[key]}")


async def run(args: argparse.Namespace) -> int:
    async with SessionLocal() as db:
        ws = await _workspace(db, args.workspace)
        ws_id, slug = ws.id, ws.slug
    if not client.enabled(ws_id):
        raise Stop("Prima is not set up on this server (PRIMA_URL, PRIMA_SECRET).")
    print(f"Workspace: {slug}")
    counts = await link_all(ws_id, dry=args.dry_run)
    show(counts, sum(counts.values()))
    print("Dry run: nothing was changed." if args.dry_run else "Done.")
    return 0


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m agentic.prima.link_all", description=(__doc__ or "").split("\n\n")[0]
    )
    p.add_argument("--workspace", metavar="SLUG")
    p.add_argument("--dry-run", action="store_true", help="count, change nothing")
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
