"""P149c: agents organize the Library's files: see a unit's (or company's) folder tree, make
folders, move files, tag them with keywords, and plan then apply a tidy-up.

The owner (28 Nov 2026): "when I ask the AI to organize them it doesn't know how or has no
capability. Add organize skills so the AI can organize uploaded files."

Access is the Library's, never wider:
- the files are those the agent may read (documents.service.agent_files: its company, never
  anyone's own files or a private assistant's work, restricted ones only in its department);
- the place (a unit like Unit HR, a department, or a company) must be one the agent may file
  into: for a person's own AI, exactly where its owner may put files (files.place_refused,
  P143b/P144 grants); for a company agent, its own company, and only its own department when
  it has one. Another unit is refused.

Plans are deterministic (knowledge/organize.py: dates, categories, keywords, the unit's
rules), with an optional cheap model call for what the rules cannot place. apply_organization
moves only after the person agreed (confirmed=true) and follows the agent's setting for
revise_document (tools.FOLLOWS): an agent that must ask before changing documents asks here
too. Nothing is ever deleted, file names are kept, and a file a person placed is never moved.
"""

import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy import Select, or_, select

from ..documents import service
from ..knowledge import organize
from ..models import Department, DocFile
from .doc_tools import _file, _task_id
from .office_tools import clean_folder
from .tools import Tool, ToolContext

MAX_PLAN = 200
MAX_AT_ONCE = 100
DATES_SHOWN = {"month": "Year/Month", "year": "Year", "off": "no date folders"}


@dataclass
class Place:
    branch_id: str
    department_id: str | None
    label: str
    unit: str | None = None


async def owner_principal(ctx: ToolContext) -> Any:
    """The person a personal AI (or twin) works for, as the API would see them (their role,
    company, department, Library grants); None for a company agent."""
    from ..api.deps import Principal
    from ..knowledge import dept_scope, grants
    from ..models import Membership, User

    uid = getattr(ctx.agent, "owner_user_id", None)
    if not uid:
        return None
    cache = getattr(ctx, "_organize_owner", None)
    if cache is not None:
        return cache or None
    m = await ctx.db.get(Membership, (ctx.workspace.id, uid))
    u = await ctx.db.get(User, uid)
    p: Any = False
    if m is not None and u is not None:
        p = Principal(
            user=u,
            workspace_id=ctx.workspace.id,
            role=m.role,
            session_id="agent",
            branch_id=m.branch_id,
            department_id=m.department_id,
            branch_ids=tuple(m.branch_ids or ()),
            library_dept_only=dept_scope.applies(m.role, m.library_scope),
            library_grants=grants.parse(m.library_grants),
        )
    try:
        ctx._organize_owner = p  # type: ignore[attr-defined]
    except AttributeError:
        pass
    return p or None


async def resolve_place(ctx: ToolContext, args: dict[str, Any]) -> Place | str:
    """The unit (hr | audit | finance, "Unit HR", "Kewangan"), department or company asked
    for; else the agent's own company (and department)."""
    from ..i18n import render
    from ..knowledge import library_units as units
    from ..models import Branch

    raw = str(args.get("unit") or "").strip().lower()
    if raw:
        for u in await units.find(ctx.db, ctx.workspace.id):
            names = {u.key, render(u.label, "en").lower(), render(u.label, "ms").lower()}
            names |= {a.replace("-", " ") for a in units.ALIASES.get(u.key, set())}
            names |= {f"unit {n}" for n in list(names)}
            if raw in names or raw.replace("-", " ") in names:
                return Place(u.branch.id, u.department.id, f"{u.label} · {u.branch.name}", u.key)
        return "Error: no such unit here. Units: hr, audit, finance (as the Library lists them)."
    dept_id = str(args.get("department_id") or "").strip() or None
    branch_id = str(args.get("branch_id") or "").strip() or None
    if dept_id:
        d = await ctx.db.get(Department, dept_id)
        if d is None or d.workspace_id != ctx.workspace.id:
            return "Error: no such department."
        b = await ctx.db.get(Branch, d.branch_id)
        unit = await organize.unit_key(ctx.db, ctx.workspace.id, d.id)
        return Place(d.branch_id, d.id, f"{d.name} · {b.name if b else ''}", unit)
    branch_id = branch_id or ctx.agent.branch_id
    if not branch_id:
        return "Error: say which unit or company (unit, department_id or branch_id)."
    b = await ctx.db.get(Branch, branch_id)
    if b is None or b.workspace_id != ctx.workspace.id:
        return "Error: no such company."
    return Place(b.id, None, b.name)


async def refused(ctx: ToolContext, branch_id: str | None, department_id: str | None) -> str | None:
    """None when the agent may organize files of that company (and department)."""
    from ..api.routers.files import place_refused
    from ..core.security import can

    p = await owner_principal(ctx)
    if p is None and getattr(ctx.agent, "owner_user_id", None):
        return "Error: the person you work for is no longer in this office."
    if p is not None:
        if not can(p.role, "work.write"):
            return "Error: the person you work for cannot change files."
        wrong = place_refused(p, branch_id, department_id)
        if wrong is not None:
            return (
                "Error: that is outside where the person you work for may file documents "
                f"(another {'company' if wrong == 'company' else 'unit or department'})."
            )
        return None
    if not branch_id or branch_id != ctx.agent.branch_id:
        return "Error: you organize your own company's files only."
    own = ctx.agent.department_id
    if own and department_id and department_id != own:
        return "Error: that is another unit or department's files; you organize your own only."
    return None


async def _files_q(ctx: ToolContext, place: Place) -> Select[tuple[DocFile]]:
    q = select(DocFile).where(
        DocFile.workspace_id == ctx.workspace.id,
        DocFile.branch_id == place.branch_id,
        DocFile.status != "reading",
        service.agent_files(ctx.agent, _task_id(ctx)),
    )
    if place.department_id:
        q = q.where(DocFile.department_id == place.department_id)
    elif ctx.agent.department_id and not ctx.agent.owner_user_id:
        q = q.where(
            or_(DocFile.department_id.is_(None), DocFile.department_id == ctx.agent.department_id)
        )
    p = await owner_principal(ctx)
    if p is not None:  # what its owner may change (files.get_file without shared guidelines)
        mine = service.scoped(
            select(DocFile.id).where(DocFile.workspace_id == ctx.workspace.id), DocFile, p
        )
        q = q.where(DocFile.id.in_(mine))
    return q


async def changeable(ctx: ToolContext, file_id: str) -> tuple[DocFile | None, str]:
    """A file the agent may move, tag or rename, or (None, why not)."""
    f = await _file(ctx, file_id)
    if f is None:
        return None, "not a file you may change"
    if f.quarantined:
        return None, "held back for review"
    why = await refused(ctx, f.branch_id, f.department_id)
    if why:
        return None, why.removeprefix("Error: ")
    p = await owner_principal(ctx)
    if p is not None:
        ok = await ctx.db.scalar(
            service.scoped(
                select(DocFile.id).where(
                    DocFile.id == f.id, DocFile.workspace_id == f.workspace_id
                ),
                DocFile,
                p,
            )
        )
        if ok is None:
            return None, "not a file the person you work for may change"
    return f, ""


async def _place_or_error(ctx: ToolContext, args: dict[str, Any]) -> Place | str:
    place = await resolve_place(ctx, args)
    if isinstance(place, str):
        return place
    why = await refused(ctx, place.branch_id, place.department_id)
    return why or place


def _base(args: dict[str, Any]) -> str | None:
    raw = str(args.get("folder") or args.get("under") or "").strip().strip("/")
    if not raw:
        return ""
    return clean_folder(raw)


# ---------------------------------------------------------------- tools


async def _list_folder_tree(ctx: ToolContext, args: dict[str, Any]) -> str:
    place = await _place_or_error(ctx, args)
    if isinstance(place, str):
        return place
    base = _base(args)
    if base is None:
        return "Error: give the folder as a path, e.g. 'Payroll/2026'."
    q = (await _files_q(ctx, place)).with_only_columns(DocFile.folder, DocFile.quarantined)
    counts: dict[str, list[int]] = {}
    loose = 0
    for folder, _held in (await ctx.db.execute(q)).all():
        folder = folder or ""
        if base and not (folder == base or folder.startswith(base + "/")):
            continue
        if folder == base:
            loose += 1
        parts = folder.split("/") if folder else []
        for i in range(1, len(parts) + 1):
            c = counts.setdefault("/".join(parts[:i]), [0, 0])
            c[0] += 1
            if i == len(parts):
                c[1] += 1
    for path in await organize.folder_paths(
        ctx.db, ctx.workspace.id, place.branch_id, place.department_id
    ):
        if not base or path == base or path.startswith(base + "/"):
            counts.setdefault(path, [0, 0])
    rules = await organize.load_rules(
        ctx.db, ctx.workspace.id, place.branch_id, place.department_id
    )
    where = base or "the top level"
    lines = [f"{place.label}: folders under {where} (files in each, sub-folders included):"]
    lines.append(f"- {base or '(top level)'}: {loose} loose file(s) not in a sub-folder")
    shown = 0
    for path in sorted(counts, key=str.casefold):
        if base and path == base:
            continue
        if base and not path.startswith(base + "/"):
            continue
        depth = path.count("/") - (base.count("/") + 1 if base else 0)
        total, direct = counts[path]
        lines.append(f"{'  ' * (depth + 1)}- {path}: {total} ({direct} directly)")
        shown += 1
        if shown >= 200:
            lines.append("  ... more folders not shown; give `folder` to look deeper.")
            break
    names = ", ".join(rules.folder(c.key) for c in organize.CATEGORIES[:10])
    dates = DATES_SHOWN[rules.dates]
    lines.append(f"Sorting rules here: category folders ({names}...), dates as {dates}.")
    return "\n".join(lines)


async def _create_folder(ctx: ToolContext, args: dict[str, Any]) -> str:
    from ..api.routers.company_files import _save_folders, _saved_folders
    from ..services import audit

    place = await _place_or_error(ctx, args)
    if isinstance(place, str):
        return place
    path = clean_folder(str(args.get("path") or ""))
    if not path:
        return "Error: give the folder path, e.g. 'Payroll/2026/11' (at most 6 levels)."
    existing = await organize.folder_paths(
        ctx.db, ctx.workspace.id, place.branch_id, place.department_id
    )
    if path.casefold() in {p.casefold() for p in existing}:
        return f"The folder {path} already exists in {place.label}."
    saved = await _saved_folders(ctx.db, ctx.workspace.id, lock=True)
    await _save_folders(
        ctx.db,
        ctx.workspace.id,
        [
            *saved,
            {"path": path, "branch_id": place.branch_id, "department_id": place.department_id},
        ],
    )
    await audit.record(
        ctx.db,
        ctx.workspace.id,
        f"agent:{ctx.agent.id}",
        "folder.created",
        after={"path": path, "branch_id": place.branch_id, "department_id": place.department_id},
    )
    await ctx.db.commit()
    return f"Made the folder {path} in {place.label}."


def _ids(args: dict[str, Any]) -> list[str]:
    raw = args.get("file_ids")
    items = raw if isinstance(raw, list) else [args.get("file_id")]
    return list(dict.fromkeys(str(x).strip() for x in items if x and str(x).strip()))


async def _move(ctx: ToolContext, f: DocFile, folder: str, why: str = "") -> None:
    from ..services import audit

    before = f.folder or ""
    f.folder = folder
    f.folder_by = "agent"
    await audit.record(
        ctx.db,
        ctx.workspace.id,
        f"agent:{ctx.agent.id}",
        "file.filed",
        target=f.id,
        before={"folder": before},
        after={
            "folder": folder,
            "task_id": ctx.task.id if ctx.task else None,
            **({"why": why[:200]} if why else {}),
        },
    )


async def _move_files(ctx: ToolContext, args: dict[str, Any]) -> str:
    folder = _base({"folder": args.get("folder")})
    if folder is None:
        return "Error: give the folder as a path, e.g. 'Payroll/2026/11' (at most 6 levels)."
    ids = _ids(args)
    if not ids:
        return "Error: give file_ids (from list_files or suggest_organization)."
    lines, moved = [], 0
    for fid in ids[:MAX_AT_ONCE]:
        f, why = await changeable(ctx, fid)
        if f is None:
            lines.append(f"- [{fid}] left alone: {why}.")
            continue
        if (f.folder or "") == folder:
            lines.append(f"- [{f.id}] {f.name}: already in {folder or 'the top level'}.")
            continue
        before = f.folder or "top level"
        await _move(ctx, f, folder)
        moved += 1
        lines.append(f"- [{f.id}] {f.name}: {before} -> {folder or 'top level'}")
    await ctx.db.commit()
    more = f" (only the first {MAX_AT_ONCE})" if len(ids) > MAX_AT_ONCE else ""
    return f"Moved {moved} file(s){more}:\n" + "\n".join(lines)


async def _tag_files(ctx: ToolContext, args: dict[str, Any]) -> str:
    from ..api.routers.files import reindex_keywords
    from ..services import audit

    add = organize.clean_keywords(args.get("add") or [])
    remove = organize.clean_keywords(args.get("remove") or [])
    if not add and not remove:
        return "Error: give keywords to add and/or remove."
    ids = _ids(args)
    if not ids:
        return "Error: give file_ids."
    lines, changed = [], []
    for fid in ids[:MAX_AT_ONCE]:
        f, why = await changeable(ctx, fid)
        if f is None:
            lines.append(f"- [{fid}] left alone: {why}.")
            continue
        before = list(f.keywords or [])
        f.keywords = organize.merge_keywords(before, add, remove)
        if f.keywords != before:
            changed.append(f.id)
        lines.append(f"- [{f.id}] {f.name}: {', '.join(f.keywords) or '(no keywords)'}")
    await audit.record(
        ctx.db,
        ctx.workspace.id,
        f"agent:{ctx.agent.id}",
        "file.keywords",
        after={"ids": ids[:50], "count": len(changed), "add": add, "remove": remove},
    )
    await ctx.db.commit()
    await reindex_keywords(changed)
    return f"Keywords changed on {len(changed)} file(s):\n" + "\n".join(lines)


async def _suggest_organization(ctx: ToolContext, args: dict[str, Any]) -> str:
    place = await _place_or_error(ctx, args)
    if isinstance(place, str):
        return place
    base = _base(args)
    if base is None:
        return "Error: give the folder as a path, e.g. 'Old files'."
    q = await _files_q(ctx, place)
    if base:
        q = q.where(or_(DocFile.folder == base, DocFile.folder.startswith(base + "/")))
    files = list((await ctx.db.scalars(q.order_by(DocFile.name).limit(MAX_PLAN * 3))).all())
    rules = await organize.load_rules(
        ctx.db, ctx.workspace.id, place.branch_id, place.department_id
    )
    paths = await organize.folder_paths(
        ctx.db, ctx.workspace.id, place.branch_id, place.department_id
    )
    plan = await organize.make_plan(ctx.db, files, rules, base, paths)
    if args.get("use_ai") and plan.kept:
        unsure = {fid for fid, _, why in plan.kept if why == "nothing to go by"}
        if unsure:
            hints = await organize.ai_hints(
                ctx.db, ctx.workspace.id, [f for f in files if f.id in unsure]
            )
            if hints:
                plan = await organize.make_plan(ctx.db, files, rules, base, paths, hints)
    moves = plan.moves[:MAX_PLAN]
    if not moves:
        left = "\n".join(f"- [{i}] {n}: {w}" for i, n, w in plan.kept[:30])
        return (
            f"Nothing to move in {place.label} ({base or 'top level'}): it is already in order."
            + (f"\nLeft alone:\n{left}" if left else "")
        )
    lines = [
        f"Plan for {place.label}, {base or 'top level'}: {len(moves)} file(s) to move into "
        f"{len(plan.folders())} folder(s). Nothing is deleted or renamed.",
        "",
        "| File | From | To | Why |",
        "|---|---|---|---|",
    ]
    for m in moves:
        lines.append(f"| [{m.file_id}] {m.name} | {m.src or 'top level'} | {m.dst} | {m.why} |")
    if plan.kept:
        lines.append("")
        lines.append(f"Left alone ({len(plan.kept)}):")
        lines += [f"- [{i}] {n}: {w}" for i, n, w in plan.kept[:30]]
        if len(plan.kept) > 30:
            lines.append(f"- ... and {len(plan.kept) - 30} more")
    lines.append("")
    lines.append(
        "Show this plan to the person. Only when they agree, call apply_organization with "
        "confirmed=true and these moves (change or drop any they asked to):"
    )
    lines.append(json.dumps([m.out() for m in moves], ensure_ascii=False))
    return "\n".join(lines)


async def _apply_organization(ctx: ToolContext, args: dict[str, Any]) -> str:
    if args.get("confirmed") is not True:
        return (
            "Error: show the plan from suggest_organization to the person first, and call "
            "again with confirmed=true only once they agreed."
        )
    raw = args.get("moves")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raw = None
    if not isinstance(raw, list) or not raw:
        return "Error: give moves: [{file_id, folder}, ...] from suggest_organization."
    lines, moved, left = [], 0, 0
    folders: set[str] = set()
    for item in raw[:MAX_PLAN]:
        if not isinstance(item, dict):
            continue
        fid = str(item.get("file_id") or "").strip()
        folder = _base({"folder": item.get("folder")})
        if not fid or folder is None or not folder:
            lines.append(f"- [{fid or '?'}] left alone: no folder given.")
            left += 1
            continue
        f, why = await changeable(ctx, fid)
        if f is None:
            lines.append(f"- [{fid}] left alone: {why}.")
            left += 1
            continue
        if f.folder_by == "person":
            lines.append(f"- [{f.id}] {f.name}: left alone, a person placed it.")
            left += 1
            continue
        if (f.folder or "") == folder:
            continue
        before = f.folder or "top level"
        await _move(ctx, f, folder, "organize plan")
        folders.add(folder)
        moved += 1
        lines.append(f"- [{f.id}] {f.name}: {before} -> {folder}")
    await ctx.db.commit()
    return (
        f"Organized: moved {moved} file(s) into {len(folders)} folder(s); {left} left alone. "
        "Every move is in the audit log with where the file was.\n" + "\n".join(lines)
    )


_PLACE = {
    "unit": {
        "type": "string",
        "description": "A Library unit: hr, audit or finance (Unit HR, Unit Audit, Unit Kewangan)",
    },
    "department_id": {"type": "string"},
    "branch_id": {"type": "string", "description": "A company; default your own"},
}
_IDS = {"type": "array", "items": {"type": "string"}}
_KW = {"type": "array", "items": {"type": "string"}}

ORGANIZE_TOOLS = (
    Tool(
        "list_folder_tree",
        "See the folder tree",
        "The folder tree of a Library unit (Unit HR, Unit Audit, Unit Kewangan) or a company: "
        "every folder with its file counts, how many files lie loose, and the place's sorting "
        "rules. Use it before organizing.",
        {
            "type": "object",
            "properties": {
                **_PLACE,
                "folder": {"type": "string", "description": "Only under this folder"},
            },
        },
        "low",
        "allow",
        _list_folder_tree,
    ),
    Tool(
        "create_folder",
        "Make a folder",
        "Make an empty folder in a Library unit or company, e.g. 'Payroll/2026/11'. Folders are "
        "also made by themselves when files are moved into them.",
        {
            "type": "object",
            "properties": {**_PLACE, "path": {"type": "string"}},
            "required": ["path"],
        },
        "low",
        "allow",
        _create_folder,
    ),
    Tool(
        "move_files",
        "Move files",
        "Move files (ids) into a folder of their unit or company. Each move is logged with where "
        "the file was. Files a person placed are moved only when the person asks for exactly "
        "that file.",
        {
            "type": "object",
            "properties": {
                "file_ids": _IDS,
                "folder": {"type": "string", "description": "e.g. 'Leave/2026/11'; '' = top"},
            },
            "required": ["file_ids", "folder"],
        },
        "low",
        "allow",
        _move_files,
    ),
    Tool(
        "tag_files",
        "Tag files with keywords",
        "Add or remove keywords on files (lower case, e.g. 'payroll', 'nov 2026'): people filter "
        "and search the Library by them.",
        {
            "type": "object",
            "properties": {"file_ids": _IDS, "add": _KW, "remove": _KW},
            "required": ["file_ids"],
        },
        "low",
        "allow",
        _tag_files,
    ),
    Tool(
        "suggest_organization",
        "Plan how to organize files",
        "A plan (nothing moves) for a Library unit or company, or one folder of it: each loose "
        "file to a folder by what it is (Payroll, Leave, Claims, Invoices, Contracts, Minutes, "
        "Letters, Reports, Policies, Forms...) and its date (Year/Month, from the file name or "
        "content), following the folders people already use. use_ai=true asks a cheap model "
        "about files the rules cannot place. Show the plan before apply_organization.",
        {
            "type": "object",
            "properties": {
                **_PLACE,
                "folder": {"type": "string", "description": "Only this folder ('' = top)"},
                "use_ai": {"type": "boolean"},
            },
        },
        "low",
        "allow",
        _suggest_organization,
    ),
    Tool(
        "apply_organization",
        "Organize files (apply a plan)",
        "Apply the moves of a plan from suggest_organization after the person agreed "
        "(confirmed=true). Moves only; never deletes or renames; skips files a person placed.",
        {
            "type": "object",
            "properties": {
                "moves": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {"file_id": {"type": "string"}, "folder": {"type": "string"}},
                        "required": ["file_id", "folder"],
                    },
                },
                "confirmed": {
                    "type": "boolean",
                    "description": "true only after the person agreed to the plan",
                },
            },
            "required": ["moves", "confirmed"],
        },
        "medium",
        "allow",
        _apply_organization,
    ),
)
