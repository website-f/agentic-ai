"""P149b: posters, flyers and social graphics from ready-made templates (agentic/design).

The model writes a small spec (template id, size, a few short texts, a palette name, picture
file ids): a few hundred output tokens, never HTML or drawing code. The office renders it
(Pillow + fpdf2, bundled OFL fonts) into a PNG and a PDF saved as new office files, and
keeps the spec in the PNG's and PDF's key facts so design_revise changes one slot and draws
again without the model re-sending everything.

Rules:
- Pictures (photo, logo) are files the agent may read (doc_tools._file: its company's, its
  task's; never another company's or anyone's private files) and not held back for review.
- The company's logo and colour come from its company kit (Document Studio) by default.
- Files go to the company's AI folder "Posters" (design_revise: next to the poster revised).
- Deterministic arguments: a learned routine (skills/routines.py) replays a poster job with
  new texts and the next attached photo, without the paid model.
"""

import asyncio
import json
import re
from typing import Any

from PIL import Image

from ..design import SIZES, TEMPLATES, SpecError, catalogue, render, validate
from ..design.engine import PictureError, open_picture
from ..design.spec import FONT_SETS, Spec
from ..design.templates import Assets
from ..documents import provenance, service
from ..models import DocFile
from .doc_tools import HELD_BACK, _file
from .tools import Tool, ToolContext

SPEC_KEY = "Design spec"
MAX_PICTURE_BYTES = 30 * 1024 * 1024
PICTURE_EXTS = frozenset({"png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"})
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
_BAD_NAME = re.compile(r"[\\/:*?\"<>|\x00-\x1f]")
_VERSION = re.compile(r" v(\d{1,3})$")
# Rendering is CPU work in a thread; a few posters at once keep the worker responsive.
_RENDERING = asyncio.Semaphore(2)


async def _picture(ctx: ToolContext, file_id: str, what: str, max_side: int) -> Image.Image | str:
    from ..documents import storage

    f = await _file(ctx, file_id)
    if f is None:
        return (
            f"Error: no such file {file_id[:60]!r} for you ({what}). Use list_files or "
            "search_documents for a picture's id."
        )
    if f.quarantined:
        return HELD_BACK.format(name=f.name)
    ext = f.name.rsplit(".", 1)[-1].lower() if "." in f.name else ""
    if not (f.mime or "").startswith("image/") and ext not in PICTURE_EXTS:
        return f"Error: {f.name} is not a picture (PNG, JPG or WebP); it cannot be the {what}."
    if (f.size or 0) > MAX_PICTURE_BYTES:
        return f"Error: {f.name} is larger than {MAX_PICTURE_BYTES // (1024 * 1024)} MB."
    try:
        data = await storage.read(ctx.db, f)
        return await asyncio.to_thread(open_picture, data, max_side)
    except storage.StorageError as e:
        return f"Error: {f.name}: {e}"
    except PictureError as e:
        return f"Error: {f.name}: {e}"


def _branch(ctx: ToolContext) -> str | None:
    return (ctx.task.branch_id if ctx.task is not None else None) or ctx.agent.branch_id


async def _assets(
    ctx: ToolContext, spec: Spec, branch_id: str | None
) -> tuple[Assets, str, list[str]] | str:
    """The photo, the logo (the company kit's unless told otherwise), the company's name and
    colour, and anything that could not be used."""
    max_side = max(max(SIZES[s][0], SIZES[s][1]) for s in spec.sizes)
    a = Assets()
    notes: list[str] = []
    photo = spec.slots.get("photo")
    if photo:
        got = await _picture(ctx, photo, "photo", max_side)
        if isinstance(got, str):
            return got
        a.photo = got
    kit = await service.kit_data(ctx.db, branch_id)
    a.brand = str(kit.get("trading_name") or kit.get("legal_name") or "").strip()[:60]
    accent = str(kit.get("accent") or "").strip()
    accent = accent if _HEX.match(accent) else ""
    if isinstance(spec.logo, str):
        got = await _picture(ctx, spec.logo, "logo", 1600)
        if isinstance(got, str):
            return got
        a.logo = got
    elif spec.logo:
        data = await service.kit_logo(ctx.db, branch_id)
        if data:
            try:
                a.logo = await asyncio.to_thread(open_picture, data, 1600)
            except PictureError:
                notes.append("the company kit's logo is not a picture we can read; left out")
    else:
        a.brand = ""
    return a, accent, notes


def _base_name(spec: Spec) -> str:
    raw = spec.name or str(spec.slots.get("headline") or TEMPLATES[spec.template].title)
    raw = _BAD_NAME.sub(" ", raw)
    raw = re.sub(r"\s+", " ", raw).strip()[:80].rstrip(" .")
    return raw if spec.name else f"Poster - {raw}"


def _revised_name(src: DocFile) -> str:
    stem = src.name.rsplit(".", 1)[0]
    stem = re.sub(r" \((?:" + "|".join(map(re.escape, SIZES)) + r")\)$", "", stem)
    m = _VERSION.search(stem)
    return stem[: m.start()] + f" v{int(m.group(1)) + 1}" if m else f"{stem} v2"


def _words(spec: Spec) -> str:
    out = []
    for k, v in spec.slots.items():
        if k == "photo":
            continue
        out.append(" · ".join(v) if isinstance(v, list) else str(v))
    return "\n".join(out)


async def _make(
    ctx: ToolContext,
    spec: Spec,
    *,
    base: str,
    folder: str,
    branch_id: str | None,
    department_id: str | None = None,
    revised: DocFile | None = None,
) -> str:
    got = await _assets(ctx, spec, branch_id)
    if isinstance(got, str):
        return got
    assets, accent, notes = got
    tpl = TEMPLATES[spec.template]
    made: list[str] = []
    looks: list[str] = []
    for size in spec.sizes:
        async with _RENDERING:
            r = await asyncio.to_thread(render, spec, size, assets, accent)
        stored = json.dumps(spec.stored(size), ensure_ascii=False, separators=(",", ":"))
        name = f"{base} ({size})"
        facts = {"Poster": f"{tpl.title}, {size}, {r.width}x{r.height} px", SPEC_KEY: stored}
        if revised is not None:
            facts["Revised from"] = f"{revised.name} [{revised.id}]"
        files: list[DocFile] = []
        for ext, data, mime in (("png", r.png, "image/png"), ("pdf", r.pdf, "application/pdf")):
            f = await service.create_file(
                ctx.db,
                workspace_id=ctx.workspace.id,
                name=f"{name}.{ext}",
                data=data,
                mime=mime,
                created_by=f"agent:{ctx.agent.id}",
                branch_id=branch_id,
                task_id=ctx.task.id if ctx.task else None,
                agent_id=ctx.agent.id,
                source="generated",
                status="ready",
                folder=folder,
                department_id=department_id,
            )
            f.kind = "Poster"
            f.title = str(spec.slots.get("headline") or tpl.title)[:200]
            f.summary = f"Poster ({tpl.title}, {size}) made by {ctx.agent.name}: {r.description}"[
                :1000
            ]
            f.text = _words(spec)
            f.pages = 1
            f.fields = dict(facts)
            files.append(f)
        files[1].fields = {**facts, "Picture": f"{files[0].name} [{files[0].id}]"}
        made.append(
            f"[{files[0].id}] {files[0].name} and [{files[1].id}] {files[1].name} "
            f"({r.width}x{r.height} px, palette {r.palette})"
        )
        look = r.description
        if r.notes:
            look += ". Adjusted: " + "; ".join(r.notes)
        looks.append(look[:900])
        notes.extend(n for n in r.notes if "cut short" in n or "left out" in n)
    await ctx.db.commit()
    head = "Saved " + made[0] + (f" (folder {folder})" if folder else "")
    out = [head, *("Saved " + m for m in made[1:])]
    out.append("Looks: " + looks[0])
    for lk in looks[1:]:
        out.append("Also: " + lk.split(";", 1)[0])
    if any("cut short" in n or "left out" in n for n in notes):
        out.append(
            "Some text did not fit: shorten it with design_revise (only the slots that change)."
        )
    elif notes:
        out.append("Note: " + "; ".join(dict.fromkeys(notes)))
    out.append("To change words, colours or size: design_revise with this file id.")
    return "\n".join(out)


def _spec_args(args: dict[str, Any]) -> dict[str, Any]:
    keys = ("template", "size", "sizes", "slots", "palette", "fonts", "logo", "name", "images")
    return {k: args[k] for k in keys if k in args and args[k] is not None}


async def _design_poster(ctx: ToolContext, args: dict[str, Any]) -> str:
    try:
        spec = validate(_spec_args(args))
    except SpecError as e:
        return f"Error: the poster spec needs fixing:\n{e}"
    branch_id = _branch(ctx)
    folder = await provenance.ai_folder(ctx.db, ctx.workspace.id, branch_id, "poster")
    return await _make(ctx, spec, base=_base_name(spec), folder=folder, branch_id=branch_id)


async def _design_revise(ctx: ToolContext, args: dict[str, Any]) -> str:
    fid = str(args.get("file_id") or "").strip()
    src = await _file(ctx, fid)
    if src is None:
        return f"Error: no such file {fid[:60]!r} for you. Give the id of a poster's PNG or PDF."
    if src.quarantined:
        return HELD_BACK.format(name=src.name)
    try:
        before = json.loads(str((src.fields or {}).get(SPEC_KEY) or ""))
    except ValueError:
        before = None
    if not isinstance(before, dict):
        return f"Error: {src.name} was not made by design_poster, so it has no spec to revise."
    raw = dict(before)
    changed: list[str] = []
    slots = dict(raw.get("slots") or {})
    new_slots = args.get("slots") or {}
    if not isinstance(new_slots, dict):
        return "Error: slots must be an object of slot name -> new text (null removes a slot)."
    for k, v in new_slots.items():
        if v is None or v == "" or v == []:
            if slots.pop(str(k), None) is not None:
                changed.append(f"removed {k}")
        elif slots.get(str(k)) != v:
            slots[str(k)] = v
            changed.append(f"{k}")
    raw["slots"] = slots
    for k in ("template", "size", "palette", "fonts", "logo"):
        if k in args and args[k] is not None and args[k] != raw.get(k):
            raw[k] = args[k]
            changed.append(k)
    if not changed:
        return "Error: nothing to change. Give the slots (or template, size, palette) that change."
    if args.get("name"):
        raw["name"] = args["name"]
    try:
        spec = validate(raw)
    except SpecError as e:
        return f"Error: the revised poster spec needs fixing:\n{e}"
    base = _BAD_NAME.sub(" ", str(args.get("name") or "")).strip()[:80] or _revised_name(src)
    folder = src.folder or await provenance.ai_folder(
        ctx.db, ctx.workspace.id, src.branch_id or _branch(ctx), "poster"
    )
    out = await _make(
        ctx,
        spec,
        base=base,
        folder=folder,
        branch_id=src.branch_id or _branch(ctx),
        department_id=src.department_id,
        revised=src,
    )
    if out.startswith("Error"):
        return out
    return out + f"\nRevised from [{src.id}] {src.name}: changed {', '.join(changed)}."


async def _design_templates(ctx: ToolContext, args: dict[str, Any]) -> str:
    return catalogue(str(args.get("query") or ""))


_SLOTS_SCHEMA = {
    "type": "object",
    "description": (
        "Slot name -> short text. Lists ('points', 'details', 'stats', 'items', 'people') are "
        "arrays of one-line strings with | between parts, e.g. details ['Tarikh|12 Dis 2026']. "
        "photo: a picture's file id."
    ),
    "additionalProperties": {"type": ["string", "array"], "items": {"type": "string"}},
}

DESIGN_TOOLS: list[Tool] = [
    Tool(
        "design_poster",
        "Design a poster",
        "Make a designed poster, flyer, notice or social-media graphic from a ready template: "
        "give only the template id, size and short texts per slot (no HTML, no design work). "
        "Saves a PNG and a PDF (A4/A3 at 300 dpi) to the office files with the company's logo "
        "and colours. design_templates lists the templates and slots. Change it afterwards "
        "with design_revise, not a new poster.",
        {
            "type": "object",
            "properties": {
                "template": {"type": "string", "description": "e.g. event, hiring, safety"},
                "size": {
                    "type": ["string", "array"],
                    "items": {"type": "string"},
                    "description": "e.g. a4-portrait, ig-square, ig-story, whatsapp-status, "
                    "fb-post, linkedin-banner; or a list of up to 4",
                },
                "slots": _SLOTS_SCHEMA,
                "palette": {
                    "type": ["string", "object"],
                    "description": "brand (company colour, default), brand-dark, or a name "
                    "from design_templates, or {bg, accent} hex colours",
                },
                "fonts": {"type": "string", "enum": list(FONT_SETS)},
                "logo": {
                    "type": ["boolean", "string"],
                    "description": "true: the company logo (default); false; or a file id",
                },
                "name": {"type": "string", "description": "Optional file name"},
            },
            "required": ["template", "slots"],
        },
        "low",
        "allow",
        _design_poster,
    ),
    Tool(
        "design_templates",
        "List poster templates",
        "The poster templates (what each is for, its slots, * = required), sizes and palettes, "
        "one line each. Give a word (e.g. 'raya', 'hiring') to see only matching templates.",
        {"type": "object", "properties": {"query": {"type": "string"}}},
        "low",
        "allow",
        _design_templates,
    ),
    Tool(
        "design_revise",
        "Revise a poster",
        "Change a poster made by design_poster and draw it again: give its file id and only "
        "what changes (slots with new text, null to remove one; or template, size, palette). "
        "Saves new files; the old ones stay.",
        {
            "type": "object",
            "properties": {
                "file_id": {"type": "string", "description": "The poster's PNG or PDF id"},
                "slots": _SLOTS_SCHEMA,
                "template": {"type": "string"},
                "size": {"type": ["string", "array"], "items": {"type": "string"}},
                "palette": {"type": ["string", "object"]},
                "fonts": {"type": "string", "enum": list(FONT_SETS)},
                "logo": {"type": ["boolean", "string"]},
                "name": {"type": "string"},
            },
            "required": ["file_id"],
        },
        "low",
        "allow",
        _design_revise,
    ),
]
