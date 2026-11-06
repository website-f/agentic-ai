"""P82: add members from an Excel or CSV sheet, from the server (the same import as Settings >
Members > Import from Excel). Inside the api container:

    docker compose cp staff.xlsx api:/tmp/staff.xlsx
    docker compose exec api python -m agentic.members_import /tmp/staff.xlsx --dry-run
    docker compose exec api python -m agentic.members_import /tmp/staff.xlsx --yes \\
        --add-missing-companies --signins-out /tmp/signins.csv
    docker compose cp api:/tmp/signins.csv ./signins.csv

- One path with the web import: member_import.read_sheet (the preview), its checks, and
  import_rows (members.add_one for each row).
- Never a duplicate. Someone already a member is skipped ("already a member"); someone with an
  account in another workspace is added and keeps their own password; the same email twice
  in the file keeps the first row only.
- --dry-run prints counts by status and by reason, never names or emails (row numbers per
  reason only with --show-rows). With --add-missing-companies it adds the companies the sheet
  names in the same transaction and rolls it all back, so the counts are exact.
- --yes adds the people and writes each new account's one-time sign-in details to the
  --signins-out CSV (the web download's columns); it prints counts only, never a password.
- It acts as the workspace's first owner; the audit log names it `system:members-import-cli`.
"""

import argparse
import asyncio
import csv
import os
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select

from .api.deps import Principal
from .api.routers import member_import
from .core.config import settings
from .core.db import SessionLocal, engine
from .i18n import render, use_lang
from .i18n.labels import role_label
from .models import Membership, User, Workspace

ACTOR = "system:members-import-cli"
SIGNIN_COLUMNS = (
    "Name",
    "Email",
    "Temporary password",
    "Role",
    "Company",
    "Department",
    "Sign in at",
)

# Why a row is not added (the first that applies), in the order printed.
SKIP_REASONS = (
    "same email twice in the file (first row kept)",
    "already a member",
    "email missing",
    "bad email",
    "name missing",
    "company not in the office",
    "department not in the company",
    "role problem",
    "no company or department given",
    "other",
)
# Rows that are added, with what the reader may want to check.
NOTE_REASONS = {
    "role": "role read from the sheet as a guess",
    "company": "company matched by a close name",
    "department": "department matched by a close name",
}


@dataclass(frozen=True)
class CliPrincipal(Principal):
    """The first owner, with the import command named in the audit log."""

    @property
    def actor(self) -> str:
        return ACTOR


class Stop(Exception):
    """A plain-English reason to stop, with nothing changed."""


def skip_reason(row: member_import.RowOut, duplicate: bool) -> str:
    fields = {n.field for n in row.notes_found if n.level == "error"}
    if duplicate:
        return SKIP_REASONS[0]
    if "member" in fields:
        return "already a member"
    if "email" in fields:
        return "email missing" if not row.email else "bad email"
    if "name" in fields:
        return "name missing"
    if "company" in fields:
        return "company not in the office"
    if "department" in fields:
        return "department not in the company"
    if "role" in fields:
        return "role problem"
    if "place" in fields:
        return "no company or department given"
    return "other"


def _valid(email: str) -> bool:
    try:
        member_import._EMAIL.validate_python(email)
    except ValidationError:
        return False
    return True


@dataclass
class Plan:
    rows: int
    status: Counter[str]
    skip: dict[str, list[int]]  # reason -> sheet row numbers
    notes: dict[str, list[int]]
    new_accounts: int
    elsewhere: int  # accounts from another workspace, added with their own password
    capped: bool
    missing_companies: int


def plan(preview: member_import.PreviewOut) -> Plan:
    status: Counter[str] = Counter()
    skip: dict[str, list[int]] = {}
    notes: dict[str, list[int]] = {}
    seen: set[str] = set()
    new = elsewhere = 0
    for r in preview.rows:
        status[r.status] += 1
        # As the checks do (member_import._check_rows): the first row with a valid address
        # keeps it; a later row with the same one is the duplicate.
        dup = False
        if r.email and _valid(r.email):
            dup = r.email in seen
            seen.add(r.email)
        if r.status == "error":
            skip.setdefault(skip_reason(r, dup), []).append(r.row)
            continue
        if r.existing_account:
            elsewhere += 1
        else:
            new += 1
        for n in r.notes_found:
            if n.level == "warn" and n.field in NOTE_REASONS:
                notes.setdefault(NOTE_REASONS[n.field], []).append(r.row)
    return Plan(
        rows=len(preview.rows),
        status=status,
        skip=skip,
        notes=notes,
        new_accounts=new,
        elsewhere=elsewhere,
        capped=preview.capped,
        missing_companies=len(preview.missing_companies),
    )


def _print(label: str, n: object) -> None:
    print(f"  {label:<54} {n}")


def show(p: Plan, show_rows: bool) -> None:
    print(
        f"Rows read: {p.rows}" + (f" (only the first {member_import.MAX_ROWS})" if p.capped else "")
    )
    print("By status:")
    _print("ok", p.status.get("ok", 0))
    _print("ok, with a note to check", p.status.get("warn", 0))
    _print("skipped", p.status.get("error", 0))
    print("Would be added:" if p.new_accounts + p.elsewhere else "Would be added: nobody")
    _print("new accounts (one-time password)", p.new_accounts)
    _print("accounts from another workspace (own password)", p.elsewhere)
    if p.notes:
        print("Added, with a note:")
        for reason, rows in p.notes.items():
            _print(reason, len(rows))
            if show_rows:
                print(f"    rows: {_rows(rows)}")
    if p.skip:
        print("Skipped, by reason:")
        for reason in SKIP_REASONS:
            rows = p.skip.get(reason)
            if rows:
                _print(reason, len(rows))
                if show_rows:
                    print(f"    rows: {_rows(rows)}")
    if p.missing_companies:
        _print("companies the sheet names that the office lacks", p.missing_companies)


def _rows(rows: list[int]) -> str:
    return ", ".join(str(r) for r in rows)


def _sign_in_at() -> str:
    return settings.public_url.rstrip("/") + "/"


def _cell(v: str) -> str:
    # As the web download: a leading = + - @ would run as a formula in Excel.
    return f"'{v}" if v[:1] in ("=", "+", "-", "@") else v


def write_signins(path: Path, results: list[member_import.ResultOut]) -> int:
    """The web download's columns (lib/member-import.ts downloadSignIns), for the people added.
    Made new (never over another file), readable by its owner only. The count of rows."""
    added = [r for r in results if r.status == "added"]
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, quoting=csv.QUOTE_ALL, lineterminator="\r\n")
        w.writerow(SIGNIN_COLUMNS)
        for r in added:
            w.writerow(
                [
                    _cell(v)
                    for v in (
                        r.name,
                        r.email,
                        r.temp_password or "Their own password",
                        str(role_label(r.role)),
                        r.branch_name or "",
                        r.department_name or "",
                        _sign_in_at(),
                    )
                ]
            )
    return len(added)


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


async def owner_principal(db, ws: Workspace) -> CliPrincipal:
    """The workspace's first owner (the earliest to join as owner)."""
    row = (
        await db.execute(
            select(Membership, User)
            .join(User, User.id == Membership.user_id)
            .where(Membership.workspace_id == ws.id, Membership.role == "owner")
            .order_by(Membership.created_at, User.id)
            .limit(1)
        )
    ).first()
    if row is None:
        raise Stop("This workspace has no owner to act as.")
    m, user = row
    return CliPrincipal(user=user, workspace_id=ws.id, role="owner", session_id="cli")


def _refusal(e: HTTPException) -> str:
    detail = e.detail if isinstance(e.detail, dict) else {"message": str(e.detail)}
    return render(detail.get("message", ""), "en")


def prepare(args: argparse.Namespace) -> tuple[bytes, Path | None]:
    """The sheet's bytes and the sign-in file to make, checked before the database is touched."""
    path = Path(args.file)
    if not path.is_file():
        raise Stop(f"No file at {path}.")
    data = path.read_bytes()
    if len(data) > member_import.MAX_BYTES:
        raise Stop(f"The file is over {member_import.MAX_BYTES // (1024 * 1024)} MB.")
    out: Path | None = None
    if args.yes:
        if not args.signins_out:
            raise Stop(
                "Give --signins-out PATH: the new accounts' one-time passwords are written "
                "there and shown nowhere else."
            )
        out = Path(args.signins_out)
        if out.exists():
            raise Stop(f"{out} already exists. Give a new file name (it is never overwritten).")
        if not out.parent.is_dir():
            raise Stop(f"The folder {out.parent} does not exist.")
    return data, out


async def run(args: argparse.Namespace, data: bytes, out: Path | None) -> int:
    name = Path(args.file).name
    async with SessionLocal() as db:
        ws = await _workspace(db, args.workspace)
        principal = await owner_principal(db, ws)
        print(f"Workspace: {ws.slug}")
        print(f"Acting as the first owner; audit actor {ACTOR}")
        try:
            preview = await member_import.read_sheet(db, principal, data, name)
            made = 0
            if args.add_missing_companies and preview.missing_companies:
                added = await member_import.add_company_names(
                    db, principal, preview.missing_companies[: member_import.MAX_COMPANIES]
                )
                made = len(added.created)
                # The sheet again, now that its companies are here.
                preview = await member_import.read_sheet(db, principal, data, name)
        except HTTPException as e:
            await db.rollback()
            raise Stop(_refusal(e)) from None
        print(f"Columns found by: {preview.mapped_by}; header row {preview.header_row}")
        if args.add_missing_companies:
            _print("companies added" if args.yes else "companies that would be added", made)
        p = plan(preview)
        show(p, args.show_rows)

        if args.dry_run:
            await db.rollback()
            print("Dry run: nothing was changed.")
            return 0

        assert out is not None
        rows = [r for r in preview.rows if r.status != "error"]
        if not rows:
            await db.commit()  # the companies added, if any
            print("Nobody to add.")
            return 0
        fresh = [
            member_import.RowOut(**r.model_dump(include=set(member_import.ImportRow.model_fields)))
            for r in rows
        ]
        try:
            result = await member_import.import_rows(db, principal, fresh)
        except HTTPException as e:
            await db.rollback()
            raise Stop(_refusal(e)) from None
        written = write_signins(out, result.results)
        try:
            await db.commit()
        except Exception:
            os.remove(out)  # nothing was added: no passwords to keep
            raise
        if made:
            from .engine import privacy

            privacy.invalidate(ws.id)
        new = sum(1 for r in result.results if r.status == "added" and r.temp_password)
        print("Done:")
        _print("added", result.added)
        _print("  of them new accounts (one-time password)", new)
        _print("  of them accounts from another workspace", result.added - new)
        _print("skipped while adding", result.skipped)
        _print(f"sign-in details written ({written} rows)", out)
    return 0


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m agentic.members_import", description=(__doc__ or "").split("\n\n")[0]
    )
    p.add_argument("file", help="the members sheet (.xlsx or .csv)")
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="count, change nothing")
    mode.add_argument("--yes", action="store_true", help="add the people")
    p.add_argument(
        "--add-missing-companies",
        action="store_true",
        help="add the companies the sheet names that the office does not have",
    )
    p.add_argument("--signins-out", metavar="PATH", help="CSV of the new sign-in details")
    p.add_argument("--show-rows", action="store_true", help="row numbers for each reason")
    p.add_argument("--workspace", metavar="SLUG")
    return p


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)

    try:
        data, out = prepare(args)
    except Stop as e:
        print(f"Stopped: {e}", file=sys.stderr)
        return 2

    async def go() -> int:
        try:
            with use_lang("en"):
                return await run(args, data, out)
        except Stop as e:
            print(f"Stopped: {e}", file=sys.stderr)
            return 2
        finally:
            await engine.dispose()

    return asyncio.run(go())


if __name__ == "__main__":
    sys.exit(main())
