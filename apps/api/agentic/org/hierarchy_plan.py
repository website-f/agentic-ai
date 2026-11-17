"""P111: set who reports to whom from a plan of reporting lines (an org chart typed as JSON).
Inside the api container:

    docker compose cp plan.json api:/tmp/hierarchy-plan.json
    docker compose exec api python -m agentic.org.hierarchy_plan --workspace <slug> \\
        --plan /tmp/hierarchy-plan.json --dry-run
    docker compose exec api python -m agentic.org.hierarchy_plan --workspace <slug> \\
        --plan /tmp/hierarchy-plan.json

The plan (never kept in the repository: it names people):

    {"people": [
      {"key": "coo", "title": "Chief Operating Officer (COO)",
       "find_by_title": ["chief operating officer", "coo"]},
      {"key": "ogm", "name": "Full Name bin Father", "title": "Operation General Manager",
       "reports_to": "coo"},
      ...],
     "notes": ["anything to print at the end, such as boxes with no names yet"]}

- Each person is found among the workspace's members by name: the same words first (case,
  spaces, dots and bin/binti/bt/b. left out), then the same words with common spellings made
  one (Mohd/Mohamad/Muhammad, Abd/Abdul), then the only member whose words hold all of the
  plan's (or the other way round, at least two words shared). Two candidates at any step is
  "ambiguous": nobody is guessed. A person with no name is found by job title instead
  (`find_by_title`: a whole phrase in their title), else left out and reported.
- Prints a match table, then each change. Only people found for sure are changed: their
  "reports to" (members.set_manager: every rule of the Members page, loops refused) and, when
  the member has no job title yet, the plan's title (members.set_title; --overwrite-titles
  replaces titles already set).
- --dry-run makes every change in one transaction and rolls it back, so what it prints is
  exactly what a real run does (refusals included). Each change is saved on its own: one
  refusal never undoes the others. Running it again changes nothing new.
- It acts as the workspace's first owner; the audit log names it `system:hierarchy-cli`.
"""

import argparse
import asyncio
import json
import re
import sys
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select

from ..api.deps import Principal
from ..api.routers import members
from ..core.db import SessionLocal, engine
from ..i18n import render, use_lang
from ..models import Branch, Membership, User, Workspace

ACTOR = "system:hierarchy-cli"

# Words between a person's name and their father's, and the dotted short forms of them.
CONNECTORS = frozenset({"bin", "binti", "bt", "bte", "binte", "b", "al", "ap", "so", "do"})
# Spellings of one name made one (used from the second step on).
FOLD = {
    "abd": "abdul",
    "abdull": "abdul",
    "mohd": "muhammad",
    "muhd": "muhammad",
    "md": "muhammad",
    "mohamad": "muhammad",
    "mohammad": "muhammad",
    "mohamed": "muhammad",
    "mohammed": "muhammad",
    "muhamad": "muhammad",
    "muhammed": "muhammad",
}
_SLASHED = re.compile(r"\b[asd]/[lpo]\b")
_NOT_WORD = re.compile(r"[^0-9a-z]+")


def words(name: str) -> tuple[str, ...]:
    """A name's words: lower case, no punctuation, no bin/binti/bt/b./a/l."""
    text = _SLASHED.sub(" ", name.lower().replace("’", "'"))
    text = text.replace("'", "")
    return tuple(w for w in _NOT_WORD.sub(" ", text).split() if w not in CONNECTORS)


def folded(ws: Iterable[str]) -> tuple[str, ...]:
    return tuple(FOLD.get(w, w) for w in ws)


@dataclass
class Match:
    how: str  # exact | spelling | words | title | ambiguous | not found | no name
    found: list[Membership] = field(default_factory=list)

    @property
    def one(self) -> Membership | None:
        return self.found[0] if len(self.found) == 1 and self.how not in ("ambiguous",) else None


def match_name(name: str, people: Sequence[Membership]) -> Match:
    """The member this name is, step by step; never a guess between two."""
    want = words(name)
    if not want:
        return Match("not found")
    steps = (
        ("exact", lambda m: words(m.user.name) == want),
        ("spelling", lambda m: folded(words(m.user.name)) == folded(want)),
        ("words", lambda m: _shares(folded(words(m.user.name)), folded(want))),
    )
    for how, test in steps:
        hits = [m for m in people if test(m)]
        if len(hits) == 1:
            return Match(how, hits)
        if hits:
            return Match("ambiguous", hits)
    return Match("not found")


def _shares(theirs: tuple[str, ...], want: tuple[str, ...]) -> bool:
    a, b = set(theirs), set(want)
    return len(a & b) >= 2 and (a <= b or b <= a)


def match_title(phrases: Iterable[str], people: Sequence[Membership]) -> Match:
    """The only member whose job title holds one of these phrases as whole words."""
    wanted = [" ".join(words(p)) for p in phrases if words(p)]
    hits = []
    for m in people:
        title = " " + " ".join(words(m.job_title or "")) + " "
        if m.job_title and any(f" {p} " in title for p in wanted):
            hits.append(m)
    if len(hits) == 1:
        return Match("title", hits)
    return Match("ambiguous", hits) if hits else Match("not found")


@dataclass(frozen=True)
class CliPrincipal(Principal):
    """The first owner, with this command named in the audit log."""

    @property
    def actor(self) -> str:
        return ACTOR


class Stop(Exception):
    """A plain-English reason to stop, with nothing changed."""


@dataclass
class PlanPerson:
    key: str
    name: str | None
    title: str | None
    reports_to: str | None
    find_by_title: list[str]


def read_plan(path: Path) -> tuple[list[PlanPerson], list[str]]:
    if not path.is_file():
        raise Stop(f"No plan at {path}.")
    try:
        raw: Any = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise Stop(f"The plan is not readable JSON: {e}") from None
    rows = raw.get("people") if isinstance(raw, dict) else None
    if not isinstance(rows, list) or not rows:
        raise Stop('The plan needs a "people" list.')
    out: list[PlanPerson] = []
    for i, r in enumerate(rows, 1):
        if not isinstance(r, dict) or not isinstance(r.get("key"), str) or not r["key"]:
            raise Stop(f'Plan person {i} needs a "key".')
        out.append(
            PlanPerson(
                key=r["key"],
                name=(r.get("name") or None),
                title=(r.get("title") or None),
                reports_to=(r.get("reports_to") or None),
                find_by_title=[str(p) for p in r.get("find_by_title") or []],
            )
        )
    keys = [p.key for p in out]
    if len(set(keys)) != len(keys):
        raise Stop("Each plan person needs their own key.")
    for p in out:
        if p.reports_to and p.reports_to not in keys:
            raise Stop(f'{p.key} reports to "{p.reports_to}", which is not in the plan.')
    notes = raw.get("notes") or []
    return out, [str(n) for n in notes] if isinstance(notes, list) else []


async def _workspace(db, slug: str | None) -> Workspace:
    spaces = (await db.scalars(select(Workspace).order_by(Workspace.created_at))).all()
    if slug:
        spaces = [w for w in spaces if slug in (w.slug, w.id)]
    if not spaces:
        raise Stop(f"No workspace {slug}." if slug else "No workspace yet.")
    if len(spaces) > 1:
        raise Stop("More than one workspace: pick one with --workspace <slug>.")
    return spaces[0]


async def _first_owner(db, ws: Workspace) -> CliPrincipal:
    row = (
        await db.execute(
            select(User)
            .join(Membership, Membership.user_id == User.id)
            .where(Membership.workspace_id == ws.id, Membership.role == "owner")
            .order_by(Membership.created_at, User.id)
            .limit(1)
        )
    ).first()
    if row is None:
        raise Stop("This workspace has no owner to act as.")
    return CliPrincipal(user=row[0], workspace_id=ws.id, role="owner", session_id="cli")


def _refusal(e: HTTPException) -> str:
    detail = e.detail if isinstance(e.detail, dict) else {"message": str(e.detail)}
    return render(detail.get("message", ""), "en")


def _table(rows: list[list[str]]) -> str:
    widths = [max(len(r[i]) for r in rows) for i in range(len(rows[0]))]
    lines = ["  ".join(c.ljust(w) for c, w in zip(r, widths, strict=True)).rstrip() for r in rows]
    lines.insert(1, "  ".join("-" * w for w in widths))
    return "\n".join(lines)


async def run(args: argparse.Namespace, plan: list[PlanPerson], notes: list[str]) -> int:
    dry = args.dry_run
    async with SessionLocal() as db:
        ws = await _workspace(db, args.workspace)
        principal = await _first_owner(db, ws)
        people = list(
            (
                await db.scalars(
                    select(Membership)
                    .join(User, User.id == Membership.user_id)
                    .where(Membership.workspace_id == ws.id)
                    .order_by(User.name, User.id)
                )
            ).all()
        )
        companies: dict[str, str] = {
            bid: name
            for bid, name in (
                await db.execute(select(Branch.id, Branch.name).where(Branch.workspace_id == ws.id))
            ).all()
        }
        print(f"Workspace {ws.slug}: {len(people)} members. Acting as the first owner ({ACTOR}).")
        print("DRY RUN: nothing is saved.\n" if dry else "")

        found: dict[str, Match] = {}
        rows = [["key", "plan name", "found how", "member", "company", "role", "title now"]]
        for p in plan:
            if p.name:
                m = match_name(p.name, people)
            elif p.find_by_title:
                m = match_title(p.find_by_title, people)
            else:
                m = Match("no name")
            found[p.key] = m
            who = m.found if m.found else [None]
            for i, x in enumerate(who):
                rows.append(
                    [
                        p.key if i == 0 else "",
                        (p.name or f"(by title: {', '.join(p.find_by_title) or '-'})")
                        if i == 0
                        else "",
                        m.how if i == 0 else "",
                        x.user.name + ("" if x.user.is_active else " [switched off]") if x else "",
                        companies.get(x.branch_id or "", "") if x else "",
                        x.role if x else "",
                        (x.job_title or "") if x else "",
                    ]
                )
        print(_table(rows))
        print()

        counts = {"set": 0, "already": 0, "refused": 0, "left": 0, "titles": 0}
        for p in plan:
            me = found[p.key].one
            if me is None:
                if p.reports_to or p.title:
                    print(f"- {p.key}: not found for sure ({found[p.key].how}); left as it is.")
                    counts["left"] += 1
                continue
            if p.title and (args.overwrite_titles or not me.job_title):
                if members.clean_title(p.title) != me.job_title:
                    try:
                        async with db.begin_nested():
                            await members.set_title(db, principal, me.user_id, p.title)
                        counts["titles"] += 1
                        print(f"- {p.key}: title set to {p.title!r}.")
                    except HTTPException as e:
                        print(f"- {p.key}: title refused: {_refusal(e)}")
            if not p.reports_to:
                continue
            boss = found[p.reports_to].one
            if boss is None:
                print(
                    f"- {p.key}: reports to {p.reports_to}, who is not found for sure "
                    f"({found[p.reports_to].how}); their manager is left as it is."
                )
                counts["left"] += 1
                continue
            if me.reports_to_user_id == boss.user_id:
                print(f"- {p.key}: already reports to {p.reports_to}.")
                counts["already"] += 1
                continue
            try:
                async with db.begin_nested():
                    await members.set_manager(db, principal, me.user_id, boss.user_id)
            except HTTPException as e:
                print(f"- {p.key}: refused: {_refusal(e)}")
                counts["refused"] += 1
                continue
            counts["set"] += 1
            print(f"- {p.key}: now reports to {p.reports_to} ({boss.user.name}).")
        if dry:
            await db.rollback()
        else:
            await db.commit()
        print()
        verb = "would be" if dry else "were"
        print(
            f"{counts['set']} reporting lines {verb} set, {counts['already']} already right, "
            f"{counts['refused']} refused, {counts['left']} left as they are "
            f"(not found for sure); {counts['titles']} job titles {verb} set."
        )
        for n in notes:
            print(f"Note: {n}")
    return 0


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m agentic.org.hierarchy_plan",
        description="Set who reports to whom from a plan of reporting lines (JSON).",
    )
    p.add_argument("--workspace", help="the workspace's slug (needed with more than one)")
    p.add_argument("--plan", required=True, help="the plan's JSON file")
    p.add_argument("--dry-run", action="store_true", help="print what would change, save nothing")
    p.add_argument("--overwrite-titles", action="store_true", help="replace job titles already set")
    return p


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        plan, notes = read_plan(Path(args.plan))
    except Stop as e:
        print(f"Stopped: {e}", file=sys.stderr)
        return 2

    async def go() -> int:
        try:
            with use_lang("en"):
                return await run(args, plan, notes)
        except Stop as e:
            print(f"Stopped: {e}", file=sys.stderr)
            return 2
        finally:
            await engine.dispose()

    return asyncio.run(go())


if __name__ == "__main__":
    sys.exit(main())
