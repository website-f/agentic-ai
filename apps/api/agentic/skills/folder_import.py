"""P102: bring a skill in from a folder (a SKILL.md with its reference files) into one office.

Run by the operator inside the api container, with the skill's folder copied in first:

    python -m agentic.skills.folder_import --workspace <id or slug> --src <folder> --dry-run
    python -m agentic.skills.folder_import --workspace <id or slug> --src <folder> \\
        --link eperolehan-tender

What comes in (nothing of the folder is kept in this repository; it goes into that office's
own database and vault):
- SKILL.md: the skill's instructions (name and description from its frontmatter), with a short
  "In this office" section in front: how its files load, that scripts and example folders are
  not here, notes go to office pages, messages to outsiders are drafts a person sends. It must
  fit the office's skill size (format.MAX_BODY).
- every markdown file under references/ (subfolders too) and under any --include folder: the
  skill's supporting files, brain pages skills/<name>/<file> that an agent loads with
  use_skill(name, file=...) only when a step needs one (use_skill lists them).
- tools/: the office has no sandbox for a skill's own scripts (they need PDF libraries, fonts
  and a browser on the person's computer), so no code comes in: a generated tools.md names
  each script and what its docstring says it does, so an agent can tell the person which to
  run.
- never: dot folders (.git), _bak* / _rev and build or check folders, anything that is not
  markdown (PDF, PNG, Office files), other top-level folders unless --include names them.

The operator reviewed the folder, so the skill is published straight away as an "official"
skill: on the Skills page, versioned (every changed run is a new version) and revertable;
an outside skill brought in from the Skills page still waits for review (importer.py). The
safety scan still runs on the instructions (a "block" finding stops the import) and on every
file (an injection stops it; a possible personal number or password word is reported).

Running it again updates in place: unchanged text is no new version, changed files are
rewritten, files gone from the folder are removed. A skill a person changed in the office
since the last import (or one of the same name made in the office) is not overwritten
without --force. --link <skill> links this skill to another (workspace settings
"skill_links"): work that gets that skill is told to use this one too (eperolehan.attach),
and ePerolehan work is given both (agents/skill_grant.match).
"""

import argparse
import ast
import asyncio
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ..brain.facts import _SECRET
from ..brain.pages import MAX_PAGE_CHARS, PathError, digest, normalize_path
from ..core import threats
from . import format as fmt

ACTOR = "system:skill-import"
IMPORTS = "skill_imports"  # workspace settings: {name: {"hash", "files", "source", "at"}}
REFERENCES = "references"
TOOLS_DIR = "tools"
TOOLS_PAGE = "tools.md"
SKIP_DIRS = frozenset({"build", "check", "rev", "node_modules", "__pycache__", "edge-profile"})
SCRIPT_SUFFIXES = (".py", ".js", ".mjs", ".ts", ".sh", ".ps1")


class FolderImportError(ValueError):
    pass


@dataclass
class File:
    path: str  # inside the skill, e.g. references/guide.md
    text: str
    warnings: list[str] = field(default_factory=list)


@dataclass
class Plan:
    name: str
    description: str
    body: str
    files: list[File]
    skipped: list[tuple[str, str]]  # (path, why)
    findings: list[dict[str, Any]]  # the safety scan of the instructions
    source: str


# ---------------------------------------------------------------- reading the folder


def _skip_part(part: str) -> bool:
    low = part.lower()
    return low.startswith((".", "_")) or low in SKIP_DIRS or low.endswith("profile")


def _description(raw: str) -> str:
    text = " ".join(str(raw or "").split())
    if len(text) > fmt.MAX_DESCRIPTION:
        text = text[: fmt.MAX_DESCRIPTION - 3].rsplit(" ", 1)[0].rstrip(" ,;:-") + "..."
    return text


def office_notes(name: str, link: str | None, *, files: bool, tools: bool) -> str:
    """The short section put in front of an imported skill's own instructions."""
    lines = ["## In this office"]
    if files:
        lines.append(
            f"- Its reference files load with use_skill(name='{name}', file='<file>'); "
            "use_skill lists them. Open one only when a step needs it."
        )
    missing = "Scripts, worked examples and per-case folders it mentions are not in the office"
    lines.append(
        f"- {missing}: {TOOLS_PAGE} says what each script does, and a person runs it on their "
        "own computer."
        if tools
        else f"- {missing}."
    )
    lines.append(
        "- Keep working notes as office pages (write_page, under wiki/). Never change this "
        "skill or its files: say what you learned in your result, and a person updates it."
    )
    lines.append(
        "- Emails and messages to people outside the office are drafts: a person reads and "
        "sends them."
    )
    if link:
        lines.append(f"- Work on a portal also follows the skill {link} and the site's playbook.")
    return "\n".join(lines) + "\n"


def _script_line(path: Path) -> str:
    """What a script says it does: the first line of its docstring (parsed, never run)."""
    if path.suffix != ".py":
        return ""
    try:
        doc = ast.get_docstring(ast.parse(path.read_text(encoding="utf-8", errors="replace")))
    except (SyntaxError, ValueError):
        return ""
    return " ".join((doc or "").strip().split("\n", 1)[0].split())[:200]


def _tools_page(name: str, scripts: list[tuple[str, int, str]]) -> str:
    rows = "\n".join(
        f"- `{p}` ({n:,} bytes){': ' + what if what else ''}" for p, n, what in scripts
    )
    return (
        f"# Scripts of the skill {name}\n\n"
        "These scripts belong to the skill's own build kit. They are not in the office and "
        "office agents cannot run them: they run on the person's own computer (Python and "
        "the libraries the skill names). When a step needs one, tell the person which script "
        "to run and with which files, and carry on with what the office can do.\n\n"
        f"{rows}\n"
    )


# Patterns a reference text trips by describing its subject ("leave without approval" in a
# guide to attendance rules): reported for the operator, not a stop. Anything else the scan
# finds (overriding the rules, moving secrets out, hidden characters) stops the import.
WARN_ONLY = frozenset({"skip_approval", "html_comment_injection"})


def _check_file(text: str) -> tuple[list[str], str | None]:
    """(warnings, why it may not come in)."""
    found = threats.scan(text, "strict")
    if hard := [t for t in found if t not in WARN_ONLY]:
        return [], f"the safety scan found {', '.join(hard)}"
    warnings = [
        f"mentions {t.replace('_', ' ')} (read it: a subject, not an order?)" for t in found
    ]
    if _SECRET.search(text):
        warnings.append("may hold a personal number, a card number or a password word")
    return warnings, None


def read_folder(src: Path, link: str | None = None, include: tuple[str, ...] = ()) -> Plan:
    """What would come in from this folder. Raises FolderImportError for a folder that is not a
    skill or instructions that do not fit; nothing is written."""
    from .scan import scan
    from .store import known_tools

    skill_md = src / "SKILL.md"
    if not skill_md.is_file():
        raise FolderImportError(f"{src} has no SKILL.md.")
    meta, own = fmt.parse(skill_md.read_text(encoding="utf-8"))
    name = fmt.slug(str(meta.get("name") or src.name))
    description = _description(str(meta.get("description") or ""))
    if not name or not description:
        raise FolderImportError("SKILL.md needs frontmatter with a name and a description.")
    allowed = {REFERENCES, *(d.strip("/\\") for d in include)}
    files: list[File] = []
    skipped: list[tuple[str, str]] = []
    scripts: list[tuple[str, int, str]] = []
    for path in sorted(src.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(src).as_posix()
        parts = rel.split("/")
        if rel == "SKILL.md":
            continue
        if any(_skip_part(p) for p in parts[:-1]) or parts[-1].startswith("."):
            skipped.append((rel, "build, backup or hidden folder"))
            continue
        if parts[0] == TOOLS_DIR and len(parts) > 1:
            if path.suffix.lower() in SCRIPT_SUFFIXES:
                scripts.append((rel, path.stat().st_size, _script_line(path)))
            skipped.append((rel, "script: listed in tools.md, not brought in"))
            continue
        if len(parts) == 1 or parts[0] not in allowed:
            skipped.append((rel, "not a reference file"))
            continue
        if path.suffix.lower() != ".md":
            skipped.append((rel, "not markdown"))
            continue
        text = path.read_text(encoding="utf-8", errors="replace").replace("\r\n", "\n")
        if len(text) > MAX_PAGE_CHARS:
            skipped.append((rel, f"over {MAX_PAGE_CHARS:,} characters"))
            continue
        try:
            normalize_path(f"skills/{name}/{rel}")
        except PathError:
            skipped.append((rel, "a name the office cannot store"))
            continue
        warnings, why = _check_file(text)
        if why:
            raise FolderImportError(f"{rel}: {why}. Fix the file first.")
        files.append(File(rel, text, warnings))
    if scripts:
        files.append(File(TOOLS_PAGE, _tools_page(name, scripts)))
    notes = office_notes(name, link, files=bool(files), tools=bool(scripts))
    body = f"{notes}\n{own.strip()}\n"
    if "when to use" not in own.lower():
        with_when = f"## When to use\n{description}\n\n{body}"
        if len(with_when) <= fmt.MAX_BODY:
            body = with_when  # only when it fits: the section is a nicety, the text is not
    fmt.check(name, description, body)
    findings = scan(body, description, known_tools())
    return Plan(name, description, body, files, skipped, findings, src.name)


# ---------------------------------------------------------------- writing it


async def _workspace(db: Any, key: str) -> Any:
    from sqlalchemy import or_, select

    from ..models import Workspace

    ws = await db.scalar(select(Workspace).where(or_(Workspace.id == key, Workspace.slug == key)))
    if ws is None:
        rows = (await db.execute(select(Workspace.id, Workspace.slug, Workspace.name))).all()
        have = "; ".join(f"{i} ({s}, {n})" for i, s, n in rows) or "none"
        raise FolderImportError(f"No workspace {key!r}. Workspaces: {have}.")
    return ws


async def _pages(db: Any, ws_id: str, name: str) -> dict[str, str]:
    """The skill's supporting files in the office now: {file: hash}."""
    from sqlalchemy import select

    from ..models import BrainPage
    from .store import vault_path

    prefix = f"skills/{name}/"
    rows = (
        await db.execute(
            select(BrainPage.path, BrainPage.hash).where(
                BrainPage.workspace_id == ws_id,
                BrainPage.path.startswith(prefix, autoescape=True),
                BrainPage.path != vault_path(name),
            )
        )
    ).all()
    return {p.removeprefix(prefix): h for p, h in rows}


def _guard(skill: Any, record: dict[str, Any] | None, force: bool) -> str | None:
    """Why this run may not overwrite the office's skill (None: it may)."""
    if skill is None or force:
        return None
    if record is None:
        return (
            f"The office already has a skill called {skill.name} that this import did not "
            "make. Use --force to replace its text (its versions stay)."
        )
    if digest(skill.body) != record.get("hash"):
        return (
            f"{skill.name} was changed in the office since the last import (now version "
            f"{skill.version}). Look at it on the Skills page; use --force to replace it."
        )
    if skill.status != "active":
        return f"{skill.name} was retired in the office. Use --force to bring it back."
    return None


async def apply(
    db: Any, ws: Any, plan: Plan, *, link: str | None, force: bool, dry_run: bool
) -> dict[str, Any]:
    """Create or update the skill and its files in this workspace. In dry_run, only say
    what would happen. Raises FolderImportError when it may not."""
    from ..brain import embed
    from ..brain import store as brain_store
    from ..models import Skill, SkillVersion
    from ..services import audit, events
    from . import store
    from .scan import blocked

    if blocked(plan.findings):
        raise FolderImportError(
            "The safety scan blocked the instructions: "
            + "; ".join(f["message"] for f in plan.findings if f["level"] == "block")
        )
    if not dry_run:
        await store.ensure_builtin(db, ws)
    seeds = {b[0] for b in store.BUILTIN} if dry_run else set()  # seeded on a real run
    if link and link not in seeds and await store.find(db, ws.id, link) is None:
        raise FolderImportError(f"There is no skill {link!r} in this office to link to.")
    skill = await store.find(db, ws.id, plan.name)
    record = ((ws.settings or {}).get(IMPORTS) or {}).get(plan.name)
    if why := _guard(skill, record, force):
        raise FolderImportError(why)
    now_pages = await _pages(db, ws.id, plan.name)
    new_paths = {f.path for f in plan.files}
    write = [f for f in plan.files if now_pages.get(f.path) != digest(f.text)]
    remove = sorted(set((record or {}).get("files") or []) & set(now_pages) - new_paths)
    changed = (
        skill is None
        or skill.body.strip() != plan.body.strip()
        or skill.description != plan.description
        or skill.status != "active"
    )
    links = dict((ws.settings or {}).get("skill_links") or {})
    linked = list(links.get(link) or []) if link else []
    out: dict[str, Any] = {
        "skill": plan.name,
        "action": "create" if skill is None else "update" if changed else "unchanged",
        "version": (1 if skill is None else skill.version + 1) if changed else skill.version,
        "files_written": [f.path for f in write],
        "files_unchanged": len(plan.files) - len(write),
        "files_removed": remove,
        "link": link if link and plan.name not in linked else None,
    }
    if dry_run:
        return out
    if not (changed or write or remove or out["link"]) and record is not None:
        return out  # nothing to do: no version, no audit line
    author = brain_store.Author(ACTOR, "Skill import")
    now = datetime.now(UTC)
    note = f"Imported from the folder {plan.source} ({len(plan.files)} files)"
    if changed:
        vec = await embed.embed_one(f"{plan.name}: {plan.description}")
        if skill is None:
            skill = Skill(
                workspace_id=ws.id,
                name=plan.name,
                description=plan.description,
                body=plan.body,
                version=1,
                trust="official",
                created_by=ACTOR,
                approved_by=ACTOR,
                embedding=vec,
            )
            db.add(skill)
            await db.flush()
        else:
            skill.version += 1
            skill.description, skill.body, skill.status = plan.description, plan.body, "active"
            skill.approved_by, skill.embedding = ACTOR, vec
        db.add(
            SkillVersion(
                skill_id=skill.id,
                version=skill.version,
                description=plan.description,
                body=plan.body,
                created_by=ACTOR,
                approved_by=ACTOR,
                note=note[:300],
                created_at=now,
            )
        )
    await db.refresh(ws, ["settings"], with_for_update=True)
    settings = dict(ws.settings or {})
    imports = dict(settings.get(IMPORTS) or {})
    imports[plan.name] = {
        "hash": digest(plan.body),
        "files": sorted(new_paths),
        "source": plan.source,
        "at": now.isoformat(timespec="seconds"),
    }
    settings[IMPORTS] = imports
    if link:
        links = dict(settings.get("skill_links") or {})
        links[link] = list(dict.fromkeys([*(links.get(link) or []), plan.name]))
        settings["skill_links"] = links
    ws.settings = settings
    await audit.record(
        db,
        ws.id,
        ACTOR,
        "skill.imported",
        target=skill.id,
        after={
            "name": plan.name,
            "version": skill.version,
            "files": len(plan.files),
            "written": len(write),
            "removed": len(remove),
            "link": link,
        },
        note=note,
    )
    if changed:  # the vault copy (commits, with everything above)
        await store.mirror(db, ws, skill, f"skills: v{skill.version} {plan.name} (import)", author)
    for f in write:
        await brain_store.save_page(
            db, ws, f"skills/{plan.name}/{f.path}", f.text, author, f"skills: {plan.name} {f.path}"
        )
    for path in remove:
        await brain_store.delete_page(db, ws, f"skills/{plan.name}/{path}", author)
    await db.commit()
    await events.publish(ws.id, "skill.updated", {"skill_id": skill.id, "name": plan.name})
    return out


# ---------------------------------------------------------------- the command


def _report(plan: Plan) -> str:
    """Names and sizes only: never the content."""
    lines = [
        f"Skill {plan.name}: instructions {len(plan.body):,} characters "
        f"(limit {fmt.MAX_BODY:,}), description {len(plan.description)} characters.",
        f"Files to bring in ({len(plan.files)}):",
    ]
    lines += [f"  {f.path}  {len(f.text):,} characters" for f in plan.files]
    for f in plan.files:
        lines += [f"  note: {f.path} {w}" for w in f.warnings]
    lines.append(f"Left out ({len(plan.skipped)}):")
    by_why: dict[str, list[str]] = {}
    for path, why in plan.skipped:
        by_why.setdefault(why, []).append(path)
    for why, paths in by_why.items():
        shown = ", ".join(paths[:8]) + (f" and {len(paths) - 8} more" if len(paths) > 8 else "")
        lines.append(f"  {len(paths)} {why}: {shown}")
    if plan.findings:
        lines.append("Safety scan of the instructions:")
        lines += [f"  {f['level']}: {f['code']}" for f in plan.findings]
    return "\n".join(lines)


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m agentic.skills.folder_import",
        description="Bring a skill folder (SKILL.md + references/) into one office.",
    )
    p.add_argument("--src", required=True, help="the skill's folder (with SKILL.md)")
    p.add_argument("--workspace", help="the office: its id or slug")
    p.add_argument("--link", help="link it to this office skill, e.g. eperolehan-tender")
    p.add_argument("--include", action="append", default=[], help="another folder to bring in")
    p.add_argument("--dry-run", action="store_true", help="say what would happen, write nothing")
    p.add_argument("--force", action="store_true", help="replace a skill changed in the office")
    return p


async def _run(args: argparse.Namespace, plan: Plan) -> dict[str, Any]:
    from ..core.db import SessionLocal, engine

    try:
        async with SessionLocal() as db:
            ws = await _workspace(db, args.workspace)
            return await apply(db, ws, plan, link=args.link, force=args.force, dry_run=args.dry_run)
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    src = Path(args.src)
    try:
        plan = read_folder(src, args.link, tuple(args.include))
    except (FolderImportError, fmt.SkillFormatError) as e:
        print(f"Not imported: {e}", file=sys.stderr)
        return 1
    print(_report(plan))
    if not args.workspace:
        if not args.dry_run:
            print("Give --workspace to import it.", file=sys.stderr)
            return 1
        return 0
    try:
        out = asyncio.run(_run(args, plan))
    except FolderImportError as e:
        print(f"Not imported: {e}", file=sys.stderr)
        return 1
    head = "Would" if args.dry_run else "Done:"
    print(
        f"{head} {out['action']} {out['skill']} (version {out['version']}); files written "
        f"{len(out['files_written'])}, unchanged {out['files_unchanged']}, removed "
        f"{len(out['files_removed'])}" + (f"; linked to {out['link']}" if out["link"] else "") + "."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
