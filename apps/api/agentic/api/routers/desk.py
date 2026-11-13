"""My workspace (P26): each person's own desk, for owners and staff alike.

One page instead of going through Files, SOPs, Workflows, Tasks and Documents one by one:
what the person pinned, the SOPs and workflows for their job (and the workflows their AI
workers follow, ready to run again), their AI workers, the work they gave and what came
back, what waits for them, and their workspace files — everything they uploaded or their
work produced (files and documents carry `owner_user_id`, documents/provenance.desk_owner).

They can still browse every document generally; the desk is the short way in. Asking from
the desk gives the question to their AI worker as a task: it searches the company's
documents, answers with sources and, when asked, prepares a document, which lands in
their workspace.

- GET    /api/desk                 the whole desk in one call
- GET    /api/desk/items           what is pinned (for pin buttons elsewhere)
- POST   /api/desk/items           pin something (sop, workflow, file, document, template,
                                   page, task, agent, search; P97: route, link, report)
- PATCH  /api/desk/items/{id}      P97: rename a pin (its own name) or move it to a folder
- DELETE /api/desk/items/{id}      unpin
- PUT    /api/desk/items/order     reorder the pins (P97: and move them between folders)
- PUT    /api/desk/layout          P97: which desk sections show, in what order, and folders
- POST   /api/desk/folders/rename  P97: rename a folder, or remove it (its pins stay)
- GET    /api/desk/find            P97: find tasks, agents, people and reports
- GET    /api/desk/meetings        P97: today's meetings from the person's own calendar
- POST   /api/desk/ask             give a question or a job to one of their AI workers
- POST   /api/desk/files           upload a file into their workspace
- POST   /api/desk/workflows/{id}/follow  have one of their agents follow a workflow
"""

import contextlib
import json
import re
from datetime import UTC, datetime, time, timedelta
from typing import Any, Literal
from urllib.parse import quote, urlsplit
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...agents import launch
from ...assistants.access import may_assist
from ...core.db import get_db
from ...core.valkey import valkey
from ...documents import provenance, service
from ...i18n import lookup, tr
from ...models import (
    SOP,
    Agent,
    Approval,
    BrainPage,
    DeskItem,
    DocFile,
    DocTemplate,
    Document,
    GoogleAccount,
    Membership,
    Report,
    Task,
    User,
    Workflow,
    Workspace,
)
from ...search import vocab
from ...search.viewer import for_person
from ...services import audit, events
from ..deps import Principal, api_error, ensure_work_scope, require
from .files import check_branch, file_out, start_reading, visible_files
from .reports import _scoped as report_scoped

router = APIRouter(prefix="/api/desk", tags=["desk"])

KINDS = (
    "sop",
    "workflow",
    "file",
    "document",
    "template",
    "page",
    "task",
    "agent",
    "search",
    "route",
    "link",
    "report",
)
PinKind = Literal[
    "sop",
    "workflow",
    "file",
    "document",
    "template",
    "page",
    "task",
    "agent",
    "search",
    "route",
    "link",
    "report",
]
MAX_PINS = 60
MAX_FOLDERS = 20
# P97: the blocks of the desk's overview, in their first order. A person may hide or reorder
# them (users.prefs["desk"]); a block added later shows up at the end for everyone.
SECTIONS = ("today", "pinned", "recent", "ai", "howto", "goto")
OPEN = ("triage", "ready", "running", "blocked", "review")
URLS = {
    "file": "/files?f={id}",
    "sop": "/sops?sop={id}",
    "document": "/documents?d={id}",
    "template": "/templates",
    "page": "/brain?tab=pages",
    "workflow": "/workflows?w={id}",
    "task": "/tasks?task={id}",
    "agent": "/chat?agent={id}",
    "search": "/search?q={id}",
    "report": "/reports?r={id}",
}


def url_of(kind: str, ref: str) -> str:
    """Where a pinned item opens (a wiki page's link needs its path: _resolve gives it). A
    screen (route) or a web link opens at its own address."""
    if kind in ("route", "link"):
        return ref
    return URLS[kind].format(id=quote(ref, safe=""))


_UNSAFE = re.compile(r"[\x00-\x20\x7f\\]")


def clean_ref(kind: str, ref: str) -> str | None:
    """The pin's ref as kept, or None when it may not be pinned. A screen is an address inside
    this site (/tasks?task=..., /prima/#clock): never another site, never the API. A web link
    is a plain http(s) address without a user name or password in it."""
    if kind == "search":
        return " ".join(ref.split()) or None
    ref = ref.strip()
    if kind == "route":
        if (
            not ref.startswith("/")
            or ref.startswith(("//", "/api/", "/api?"))
            or ref == "/api"
            or _UNSAFE.search(ref)
        ):
            return None
        return ref
    if kind == "link":
        if _UNSAFE.search(ref):
            return None
        try:
            u = urlsplit(ref)
        except ValueError:
            return None
        if u.scheme not in ("http", "https") or not u.hostname or u.username or u.password:
            return None
        return ref
    return ref or None


def clean_name(text: str | None, limit: int) -> str | None:
    """A person's own name for a pin or a folder: one line, trimmed; empty means none."""
    if text is None:
        return None
    out = " ".join("".join(ch for ch in text if ch.isprintable()).split())[:limit]
    return out or None


def _now() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------- who and what is "mine"


async def my_agents(db: AsyncSession, principal: Principal) -> list[Agent]:
    """The AI workers this person owns: their twin first, then their assistants. P30: a role
    without assistants.use has no assistants here (theirs are kept, dormant)."""
    q = select(Agent).where(
        Agent.workspace_id == principal.workspace_id,
        Agent.owner_user_id == principal.user.id,
        Agent.clone_of.is_(None),
        Agent.status != "retired",
    )
    if not may_assist(principal.role):
        q = q.where(Agent.private.is_not(True))
    return list((await db.scalars(q.order_by(Agent.is_twin.desc(), Agent.created_at))).all())


def _mine(principal: Principal, agent_ids: list[str]) -> Any:
    """Top-level tasks this person gave, or that their own AI workers do."""
    parts = [Task.created_by == principal.actor]
    if agent_ids:
        parts.append(Task.assignee_agent_id.in_(agent_ids))
    return (
        Task.workspace_id == principal.workspace_id,
        Task.parent_task_id.is_(None),
        or_(*parts),
    )


def _agent_card(a: Agent, current: Task | None, open_count: int) -> dict[str, Any]:
    return {
        "id": a.id,
        "name": a.name,
        "role": a.role,
        "color": a.color,
        "status": a.status,
        "is_twin": bool(a.is_twin),
        "private": bool(a.private),
        "current_task": {"id": current.id, "title": current.title} if current else None,
        "open_tasks": open_count,
        "work_hours": a.work_hours,
        "department_id": a.department_id,
    }


# ---------------------------------------------------------------- pins


async def _resolve(
    db: AsyncSession, principal: Principal, items: list[DeskItem]
) -> list[dict[str, Any]]:
    """Each pin with its current title, a line about it and where it opens. A pin whose
    item was deleted (or is no longer visible) says so instead of disappearing silently."""
    by: dict[str, list[str]] = {}
    for it in items:
        by.setdefault(it.kind, []).append(it.ref)
    info: dict[tuple[str, str], dict[str, Any]] = {}
    ws = principal.workspace_id

    if ids := by.get("sop"):
        cond = for_person(principal).sops()
        for s in (await db.scalars(select(SOP).where(SOP.id.in_(ids), cond))).all():
            info[("sop", s.id)] = {"title": s.title, "sub": s.scope, "status": s.status}
    if ids := by.get("workflow"):
        rows = await db.scalars(
            select(Workflow).where(Workflow.workspace_id == ws, Workflow.id.in_(ids))
        )
        for w in rows.all():
            info[("workflow", w.id)] = {"title": w.name, "sub": w.description, "status": w.status}
    if ids := by.get("file"):
        q = visible_files(select(DocFile).where(DocFile.workspace_id == ws), principal)
        shared = select(DocFile).where(DocFile.workspace_id == ws, DocFile.library.is_(True))
        rows = list((await db.scalars(q.where(DocFile.id.in_(ids)))).all())
        seen = {f.id for f in rows}
        rows += [
            f
            for f in (await db.scalars(shared.where(DocFile.id.in_(ids)))).all()
            if f.id not in seen and not f.quarantined
        ]
        for f in rows:
            info[("file", f.id)] = {
                "title": f.title or f.name,
                "sub": f.folder or f.kind,
                "status": f.status,
                "mime": f.mime,
            }
    if ids := by.get("document"):
        q = service.scoped(select(Document).where(Document.workspace_id == ws), Document, principal)
        for d in (await db.scalars(q.where(Document.id.in_(ids)))).all():
            info[("document", d.id)] = {
                "title": d.title,
                "sub": d.number or d.kind,
                "status": provenance.review_status(d.status, d.review),
            }
    if ids := by.get("template"):
        rows = await db.scalars(
            select(DocTemplate).where(DocTemplate.workspace_id == ws, DocTemplate.id.in_(ids))
        )
        for t in rows.all():
            info[("template", t.id)] = {"title": t.name, "sub": t.kind, "status": None}
    if ids := by.get("page"):
        rows = await db.scalars(
            select(BrainPage).where(
                BrainPage.workspace_id == ws, BrainPage.id.in_(ids), for_person(principal).pages()
            )
        )
        for p in rows.all():
            info[("page", p.id)] = {
                "title": p.title or p.path,
                "sub": p.path,
                "status": None,
                "url": f"/brain?tab=pages&path={quote(p.path, safe='')}",
            }
    if ids := by.get("task"):
        cond = principal.scope.task_where()
        if cond is not None and (shared := principal.scope.shared_task_where()) is not None:
            cond = or_(cond, shared)  # a task shared to look at may be pinned too
        q = select(Task).where(Task.workspace_id == ws, Task.id.in_(ids))
        for t in (await db.scalars(q.where(cond) if cond is not None else q)).all():
            info[("task", t.id)] = {"title": t.title, "sub": t.status, "status": t.status}
    if ids := by.get("agent"):
        rows = await db.scalars(select(Agent).where(Agent.workspace_id == ws, Agent.id.in_(ids)))
        for a in rows.all():
            if principal.scope.sees_agent(a):
                info[("agent", a.id)] = {"title": a.name, "sub": a.role, "status": a.status}
    if ids := by.get("report"):
        q = report_scoped(select(Report).where(Report.workspace_id == ws), principal)
        for r in (await db.scalars(q.where(Report.id.in_(ids)))).all():
            info[("report", r.id)] = {"title": r.title, "sub": r.summary[:120], "status": None}
    out: list[dict[str, Any]] = []
    for it in items:
        if it.kind == "search":
            found: dict[str, Any] | None = {"title": it.ref, "sub": "", "status": None}
        elif it.kind == "route":
            # A screen of the app or of Prima: whether this person may open it is decided
            # when it opens (the app's own page rules, Prima's sign-in), like any address.
            found = {"title": it.title or it.ref, "sub": it.ref, "status": None}
        elif it.kind == "link":
            found = {"title": it.title or it.ref, "sub": urlsplit(it.ref).hostname, "status": None}
        else:
            found = info.get((it.kind, it.ref))
        # Something deleted, or no longer this person's to see: only what they named or saw
        # when they pinned it, never what it says now.
        name = (found or {}).get("title") or it.title
        out.append(
            {
                "id": it.id,
                "kind": it.kind,
                "ref": it.ref,
                "title": it.label or name,
                "name": name,
                "label": it.label,
                "folder": it.folder,
                "sub": (found or {}).get("sub") or "",
                "status": (found or {}).get("status"),
                "mime": (found or {}).get("mime"),
                "url": (found or {}).get("url") or url_of(it.kind, it.ref),
                "missing": found is None,
            }
        )
    return out


@router.get("/items")
async def pins(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> list[dict[str, str]]:
    """Just what is pinned (kind and ref), for the pin buttons on other pages."""
    rows = await db.execute(
        select(DeskItem.id, DeskItem.kind, DeskItem.ref).where(
            DeskItem.workspace_id == principal.workspace_id,
            DeskItem.user_id == principal.user.id,
        )
    )
    return [{"id": i, "kind": k, "ref": r} for i, k, r in rows.all()]


class PinIn(BaseModel):
    kind: PinKind
    ref: str = Field(min_length=1, max_length=600)
    title: str = Field(default="", max_length=200)
    folder: str | None = Field(default=None, max_length=60)


async def _my_pins(db: AsyncSession, principal: Principal) -> list[DeskItem]:
    return list(
        (
            await db.scalars(
                select(DeskItem)
                .where(
                    DeskItem.workspace_id == principal.workspace_id,
                    DeskItem.user_id == principal.user.id,
                )
                .order_by(DeskItem.position, DeskItem.created_at)
            )
        ).all()
    )


async def _my_pin(db: AsyncSession, principal: Principal, item_id: str) -> DeskItem:
    it = await db.get(DeskItem, item_id)
    if it is None or it.user_id != principal.user.id or it.workspace_id != principal.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "not_found", "That is not on your workspace.")
    return it


@router.post("/items", status_code=status.HTTP_201_CREATED)
async def pin(
    body: PinIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    ref = clean_ref(body.kind, body.ref)
    if ref is None:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "bad_pin",
            "That address cannot be pinned. Pin a page of this app, or a web link "
            "starting with https://.",
        )
    existing = await db.scalar(
        select(DeskItem).where(
            DeskItem.workspace_id == principal.workspace_id,
            DeskItem.user_id == principal.user.id,
            DeskItem.kind == body.kind,
            DeskItem.ref == ref,
        )
    )
    if existing is None:
        count = await db.scalar(
            select(func.count())
            .select_from(DeskItem)
            .where(
                DeskItem.workspace_id == principal.workspace_id,
                DeskItem.user_id == principal.user.id,
            )
        )
        if (count or 0) >= MAX_PINS:
            raise api_error(
                status.HTTP_409_CONFLICT,
                "too_many_pins",
                "Your workspace holds up to {n} pinned items. Unpin one first.",
                n=MAX_PINS,
            )
        given = clean_name(body.title, 200) or ""
        probe = DeskItem(kind=body.kind, ref=ref, title=given, id="probe")
        resolved = (await _resolve(db, principal, [probe]))[0]
        if resolved["missing"]:
            raise api_error(
                status.HTTP_404_NOT_FOUND, "not_found", "That is not here, or you cannot open it."
            )
        last = await db.scalar(
            select(func.max(DeskItem.position)).where(
                DeskItem.workspace_id == principal.workspace_id,
                DeskItem.user_id == principal.user.id,
            )
        )
        # The name it has now (what the person sees): a screen or a link keeps the one given.
        name = given if body.kind in ("route", "link") else resolved["name"]
        existing = DeskItem(
            workspace_id=principal.workspace_id,
            user_id=principal.user.id,
            kind=body.kind,
            ref=ref,
            title=(name or ref)[:200],
            folder=clean_name(body.folder, 60),
            position=float(last or 0) + 1,
            created_at=_now(),
        )
        db.add(existing)
        await db.commit()
    return (await _resolve(db, principal, [existing]))[0]


class PinChange(BaseModel):
    """Only the fields sent change: a label or folder sent as null or "" is cleared."""

    label: str | None = Field(default=None, max_length=120)
    folder: str | None = Field(default=None, max_length=60)


@router.patch("/items/{item_id}")
async def change_pin(
    item_id: str,
    body: PinChange,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Rename a pin (the person's own name for it) or move it into a folder."""
    it = await _my_pin(db, principal, item_id)
    if "label" in body.model_fields_set:
        it.label = clean_name(body.label, 120)
    if "folder" in body.model_fields_set:
        it.folder = clean_name(body.folder, 60)
    await db.commit()
    return (await _resolve(db, principal, [it]))[0]


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unpin(
    item_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> None:
    it = await _my_pin(db, principal, item_id)
    await db.delete(it)
    await db.commit()


class OrderIn(BaseModel):
    ids: list[str] = Field(max_length=MAX_PINS)
    # P97: where each pin now sits ({id: folder name, or null for no folder}), after a drag.
    folders: dict[str, str | None] | None = Field(default=None, max_length=MAX_PINS)


@router.put("/items/order", status_code=status.HTTP_204_NO_CONTENT)
async def reorder(
    body: OrderIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> None:
    rows = {it.id: it for it in await _my_pins(db, principal)}
    for i, iid in enumerate(body.ids):
        if iid in rows:
            rows[iid].position = float(i)
    for iid, folder in (body.folders or {}).items():
        if iid in rows:
            rows[iid].folder = clean_name(folder, 60)
    await db.commit()


# ---------------------------------------------------------------- the desk's layout


def layout_of(user: User | None, pins: list[DeskItem] | None = None) -> dict[str, Any]:
    """The person's desk layout (users.prefs["desk"]): every section once, in their order
    (sections added since go last, shown), and their folders in order (with any folder a pin
    names that the list lacks)."""
    saved = ((user.prefs if user else None) or {}).get("desk") or {}
    sections: list[dict[str, Any]] = []
    for s in saved.get("sections") or []:
        if isinstance(s, dict) and s.get("id") in SECTIONS:
            if s["id"] not in [x["id"] for x in sections]:
                sections.append({"id": s["id"], "hidden": bool(s.get("hidden"))})
    sections += [
        {"id": s, "hidden": False} for s in SECTIONS if s not in [x["id"] for x in sections]
    ]
    folders = [f for f in saved.get("folders") or [] if isinstance(f, str) and f]
    for it in pins or []:
        if it.folder and it.folder not in folders:
            folders.append(it.folder)
    return {"sections": sections, "folders": folders[:MAX_FOLDERS]}


class SectionIn(BaseModel):
    id: Literal["today", "pinned", "recent", "ai", "howto", "goto"]
    hidden: bool = False


class LayoutIn(BaseModel):
    sections: list[SectionIn] | None = Field(default=None, max_length=len(SECTIONS))
    folders: list[str] | None = Field(default=None, max_length=MAX_FOLDERS)


async def _locked_user(db: AsyncSession, principal: Principal) -> User:
    return (
        await db.execute(
            select(User)
            .where(User.id == principal.user.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


def _save_layout(user: User, layout: dict[str, Any]) -> None:
    keep = {"sections": layout["sections"], "folders": layout["folders"]}
    if len(json.dumps(keep, separators=(",", ":"))) > 8_000:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "bad_layout", "That is too much to keep."
        )
    user.prefs = {**(user.prefs or {}), "desk": keep}  # a new dict: the JSONB column is dirty


@router.put("/layout")
async def put_layout(
    body: LayoutIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Which desk sections show and in what order, and the order of the person's folders.
    Kept per person on the server, so the desk looks the same on their phone and PC."""
    user = await _locked_user(db, principal)
    now = layout_of(user)
    if body.sections is not None:
        seen: list[str] = []
        for s in body.sections:
            if s.id in seen:
                raise api_error(
                    status.HTTP_422_UNPROCESSABLE_CONTENT, "bad_layout", "Each section once."
                )
            seen.append(s.id)
        now["sections"] = [{"id": s.id, "hidden": s.hidden} for s in body.sections]
    if body.folders is not None:
        names: list[str] = []
        for f in body.folders:
            name = clean_name(f, 60)
            if name and name not in names:
                names.append(name)
        now["folders"] = names
    _save_layout(user, now)
    await db.commit()
    return layout_of(user, await _my_pins(db, principal))


class FolderRenameIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    # The new name; null or "" removes the folder (its pins stay, outside any folder).
    to: str | None = Field(default=None, max_length=60)


@router.post("/folders/rename")
async def rename_folder(
    body: FolderRenameIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    old = clean_name(body.name, 60)
    new = clean_name(body.to, 60)
    pins = await _my_pins(db, principal)
    for it in pins:
        if it.folder == old:
            it.folder = new
    user = await _locked_user(db, principal)
    lay = layout_of(user)
    folders: list[str] = []
    for f in lay["folders"]:
        name = new if f == old else f
        if name and name not in folders:
            folders.append(name)
    lay["folders"] = folders
    _save_layout(user, lay)
    await db.commit()
    return layout_of(user, pins)


# ---------------------------------------------------------------- the desk


async def assignable(db: AsyncSession, principal: Principal) -> list[Agent]:
    """Agents this person may hand workflows to: their own AI workers, and for people who
    manage agents, the company agents in their scope (never someone else's personal one)."""
    own = await my_agents(db, principal)
    out = list(own)
    if "agents.manage" in principal.permissions:
        seen = {a.id for a in own}
        rows = await db.scalars(
            select(Agent)
            .where(
                Agent.workspace_id == principal.workspace_id,
                Agent.status == "active",
                Agent.clone_of.is_(None),
                Agent.owner_user_id.is_(None),
                principal.scope.agent_where(),
            )
            .order_by(Agent.name)
            .limit(200)
        )
        out += [a for a in rows.all() if a.id not in seen]
    return out


def _steps(w: Workflow) -> list[dict[str, str]]:
    """The workflow's steps in order (no start, end or notes), for a quick read."""
    graph = w.graph or {}
    nodes = {n.get("id"): n for n in graph.get("nodes") or []}
    nxt: dict[str, list[str]] = {}
    for e in graph.get("edges") or []:
        nxt.setdefault(str(e.get("from")), []).append(str(e.get("to")))
    start = next((i for i, n in nodes.items() if n.get("type") == "start"), None)
    order: list[str] = []
    queue = [start] if start else list(nodes)
    while queue:
        cur = queue.pop(0)
        if cur in order or cur not in nodes:
            continue
        order.append(cur)
        queue += nxt.get(cur, [])
    order += [i for i in nodes if i not in order]
    return [
        {"title": str(nodes[i].get("title") or ""), "type": str(nodes[i].get("type") or "step")}
        for i in order
        if nodes[i].get("type") not in ("start", "end", "note")
    ]


async def _procedures(
    db: AsyncSession, principal: Principal, agent_ids: list[str]
) -> dict[str, Any]:
    """The SOPs for this person's job (their department's first, then their company's, then
    everyone's) and the workflows they can run (the ones their AI workers follow first),
    each with its steps, who follows it and when they work."""
    ws = principal.workspace_id
    dept, branch = principal.department_id, principal.branch_id
    cond = for_person(principal).sops()
    whens: list[tuple[Any, int]] = []
    if dept:
        whens.append((SOP.scope_id == dept, 0))
    if branch:
        whens.append((SOP.scope_id == branch, 1))
    whens.append((SOP.scope == "workspace", 2))
    rank = case(*whens, else_=3)
    sop_q = select(SOP).where(SOP.workspace_id == ws, SOP.status == "active", cond)
    sops = (await db.scalars(sop_q.order_by(rank, SOP.title).limit(60))).all()
    sop_total = await db.scalar(sop_q.with_only_columns(func.count()).order_by(None))
    wf_q = select(Workflow).where(Workflow.workspace_id == ws, Workflow.status == "active")
    if branch and not principal.scope.everything:
        wf_q = wf_q.where(or_(Workflow.branch_id.is_(None), Workflow.branch_id == branch))
    flows = list((await db.scalars(wf_q.order_by(Workflow.name).limit(100))).all())
    mine = set(agent_ids)
    flows.sort(key=lambda w: (not (mine & set(w.agent_ids or [])), w.name.lower()))
    follower_ids = {i for w in flows for i in (w.agent_ids or [])}
    followers = {
        a.id: a
        for a in (
            await db.scalars(
                select(Agent).where(Agent.id.in_(follower_ids), Agent.status != "retired")
            )
        ).all()
    }
    can = {a.id for a in await assignable(db, principal)}

    def person(a: Agent) -> dict[str, Any]:
        return {
            "id": a.id,
            "name": a.name,
            "color": a.color,
            "role": a.role,
            "work_hours": a.work_hours,
            "mine": a.id in mine,
            "can_change": a.id in can,
        }

    return {
        "sops": [
            {"id": s.id, "title": s.title, "scope": s.scope, "url": url_of("sop", s.id)}
            for s in sops
        ],
        "sop_total": int(sop_total or 0),
        "workflows": [
            {
                "id": w.id,
                "name": w.name,
                "description": w.description,
                "followed": bool(mine & set(w.agent_ids or [])),
                "steps": len(_steps(w)),
                "step_list": _steps(w)[:12],
                "followers": [
                    person(followers[i])
                    for i in (w.agent_ids or [])
                    if i in followers and principal.scope.sees_agent(followers[i])
                ],
                "url": url_of("workflow", w.id),
            }
            for w in flows
        ],
        "workflow_total": len(flows),
    }


class FollowIn(BaseModel):
    agent_id: str = Field(min_length=1, max_length=40)
    follow: bool = True


@router.post("/workflows/{workflow_id}/follow")
async def follow_workflow(
    workflow_id: str,
    body: FollowIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Have one of the agents this person looks after follow a workflow as its way of doing
    that job (or stop). Staff choose for their own AI worker; managers for their agents."""
    w = await db.get(Workflow, workflow_id)
    if w is None or w.workspace_id != principal.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "not_found", "That workflow is not here.")
    agent = await db.get(Agent, body.agent_id)
    if agent is None or agent.id not in {a.id for a in await assignable(db, principal)}:
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "cannot_assign",
            "You can only choose for your own AI workers or the agents you manage.",
        )
    ids = list(w.agent_ids or [])
    if body.follow and agent.id not in ids:
        ids.append(agent.id)
    elif not body.follow and agent.id in ids:
        ids.remove(agent.id)
    if ids != list(w.agent_ids or []):
        w.agent_ids = ids
        await audit.record(
            db,
            principal.workspace_id,
            principal.actor,
            "workflow.updated",
            target=w.id,
            after={"agent": agent.id, "follows": body.follow},
            note="who follows it, from My workspace",
        )
        await db.commit()
        await events.publish(principal.workspace_id, "agent.upsert", {"agent_id": agent.id})
    return {"workflow_id": w.id, "agent_ids": ids}


async def _work(
    db: AsyncSession, principal: Principal, agent_ids: list[str]
) -> list[dict[str, Any]]:
    """The work this person gave or their AI workers do: open first, then the last week."""
    week = _now() - timedelta(days=7)
    rows = (
        await db.scalars(
            select(Task)
            .where(*_mine(principal, agent_ids))
            .where(or_(Task.status.in_(OPEN), Task.updated_at >= week))
            .order_by(case((Task.status.in_(OPEN), 0), else_=1), Task.updated_at.desc())
            .limit(30)
        )
    ).all()
    ids = [t.id for t in rows]
    names = {
        a.id: a.name
        for a in (
            await db.scalars(
                select(Agent).where(Agent.id.in_({t.assignee_agent_id for t in rows} - {None}))
            )
        ).all()
    }
    made: dict[str, list[dict[str, Any]]] = {}
    if ids:
        roots = func.coalesce(Task.root_task_id, Task.id)
        under = select(Task.id, roots.label("root")).where(
            Task.workspace_id == principal.workspace_id, roots.in_(ids)
        )
        root_of = {tid: root for tid, root in (await db.execute(under)).all()}
        docs = (
            await db.scalars(
                select(Document)
                .where(Document.task_id.in_(list(root_of)))
                .order_by(Document.created_at)
            )
        ).all()
        for d in docs:
            made.setdefault(root_of[d.task_id or ""], []).append(
                {"kind": "document", "id": d.id, "title": d.title, "url": url_of("document", d.id)}
            )
        files = (
            await db.scalars(
                select(DocFile)
                .where(DocFile.task_id.in_(list(root_of)), DocFile.document_id.is_(None))
                .order_by(DocFile.created_at)
            )
        ).all()
        for f in files:
            made.setdefault(root_of[f.task_id or ""], []).append(
                {
                    "kind": "file",
                    "id": f.id,
                    "title": f.title or f.name,
                    "url": url_of("file", f.id),
                }
            )
    return [
        {
            "id": t.id,
            "title": t.title,
            "status": t.status,
            "source": t.source,
            "agent_id": t.assignee_agent_id,
            "agent_name": names.get(t.assignee_agent_id or ""),
            "from_me": t.created_by == principal.actor,
            "result": (t.result or "")[:600],
            "note": t.blocked_reason,
            "updated_at": t.updated_at,
            "made": made.get(t.id, [])[:6],
            "url": url_of("task", t.id),
        }
        for t in rows
    ]


async def _files(db: AsyncSession, principal: Principal) -> dict[str, Any]:
    """Everything on this person's workspace: files and documents that are theirs."""
    ws = principal.workspace_id
    fq = select(DocFile).where(
        DocFile.workspace_id == ws, DocFile.owner_user_id == principal.user.id
    )
    files = (await db.scalars(fq.order_by(DocFile.created_at.desc()).limit(40))).all()
    counts = (
        await db.execute(
            fq.with_only_columns(
                func.count(),
                func.count().filter(DocFile.origin == "agent"),
                func.count().filter(DocFile.origin == "uploaded"),
            ).order_by(None)
        )
    ).one()
    dq = select(Document).where(
        Document.workspace_id == ws, Document.owner_user_id == principal.user.id
    )
    docs = (await db.scalars(dq.order_by(Document.updated_at.desc()).limit(20))).all()
    doc_total = await db.scalar(dq.with_only_columns(func.count()).order_by(None))
    agents = {
        a.id: a.name
        for a in (
            await db.scalars(
                select(Agent).where(Agent.id.in_({x.agent_id for x in [*files, *docs]} - {None}))
            )
        ).all()
    }
    return {
        "files": [
            {
                "id": f.id,
                "name": f.name,
                "title": f.title or f.name,
                "kind": f.kind,
                "mime": f.mime,
                "size": f.size,
                "folder": f.folder,
                "origin": f.origin,
                "status": f.status,
                "quarantined": f.quarantined,
                "agent_name": agents.get(f.agent_id or ""),
                "document_id": f.document_id,
                "task_id": f.task_id,
                "created_at": f.created_at,
                "url": url_of("file", f.id),
            }
            for f in files
        ],
        "file_counts": {
            "total": int(counts[0] or 0),
            "agent": int(counts[1] or 0),
            "uploaded": int(counts[2] or 0),
        },
        "documents": [
            {
                "id": d.id,
                "title": d.title,
                "number": d.number,
                "kind": d.kind,
                "origin": d.origin,
                "review_status": provenance.review_status(d.status, d.review),
                "agent_name": agents.get(d.agent_id or ""),
                "updated_at": d.updated_at,
                "url": url_of("document", d.id),
            }
            for d in docs
        ],
        "document_total": int(doc_total or 0),
    }


async def _waiting(db: AsyncSession, principal: Principal, agent_ids: list[str]) -> dict[str, Any]:
    """What waits for this person: their AI workers' questions and approvals, their work in
    review, and documents made for them that wait for review."""
    from ...agents.tools import TOOLS  # P102: a tool's name for people, never its code name

    mine = select(Task.id).where(*_mine(principal, agent_ids))
    roots = func.coalesce(Task.root_task_id, Task.id)
    family = select(Task.id).where(Task.workspace_id == principal.workspace_id, roots.in_(mine))
    approvals = (
        await db.execute(
            select(Approval, Task.title)
            .join(Task, Task.id == Approval.task_id)
            .where(Approval.status == "pending", Approval.task_id.in_(family))
            .order_by(Approval.created_at.desc())
            .limit(10)
        )
    ).all()
    reviews = (
        await db.scalars(
            select(Task)
            .where(*_mine(principal, agent_ids))
            .where(Task.status == "review")
            .order_by(Task.updated_at.desc())
            .limit(10)
        )
    ).all()
    docs = (
        await db.scalars(
            select(Document)
            .where(
                Document.workspace_id == principal.workspace_id,
                Document.owner_user_id == principal.user.id,
                Document.origin == "agent",
                Document.status == "review",
            )
            .order_by(Document.updated_at.desc())
            .limit(10)
        )
    ).all()
    return {
        "approvals": [
            {
                "id": a.id,
                "kind": a.kind,
                "tool_name": a.tool_name,
                "tool_label": tr(TOOLS[a.tool_name].label) if a.tool_name in TOOLS else "",
                "reason": a.reason,
                "task_id": a.task_id,
                "task_title": title,
                "created_at": a.created_at,
            }
            for a, title in approvals
        ],
        "reviews": [{"id": t.id, "title": t.title, "url": url_of("task", t.id)} for t in reviews],
        "documents": [
            {"id": d.id, "title": d.title, "url": url_of("document", d.id)} for d in docs
        ],
    }


@router.get("")
async def desk(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    agents = await my_agents(db, principal)
    agent_ids = [a.id for a in agents]
    cards: list[dict[str, Any]] = []
    for a in agents:
        current = await db.scalar(
            select(Task)
            .where(Task.assignee_agent_id == a.id, Task.status == "running")
            .order_by(Task.started_at.desc())
            .limit(1)
        )
        n = await db.scalar(
            select(func.count())
            .select_from(Task)
            .where(Task.assignee_agent_id == a.id, Task.status.in_(OPEN))
        )
        cards.append(_agent_card(a, current, int(n or 0)))
    pins = await _my_pins(db, principal)
    from ...models import Branch, Department

    branch = await db.get(Branch, principal.branch_id) if principal.branch_id else None
    dept = await db.get(Department, principal.department_id) if principal.department_id else None
    return {
        "person": {
            "name": principal.user.name,
            "role": principal.role,
            "company": branch.name if branch else None,
            "department": dept.name if dept else None,
        },
        "can_ask": "work.write" in principal.permissions,
        "agents": cards,
        "assignable": [
            {
                "id": a.id,
                "name": a.name,
                "color": a.color,
                "role": a.role,
                "work_hours": a.work_hours,
                "mine": a.id in agent_ids,
            }
            for a in await assignable(db, principal)
        ],
        "pins": await _resolve(db, principal, pins),
        "layout": layout_of(await db.get(User, principal.user.id), pins),
        # P97: whether today's meetings can come from their own calendar (assistants' Google).
        "may_assist": may_assist(principal.role),
        "procedures": await _procedures(db, principal, agent_ids),
        "work": await _work(db, principal, agent_ids),
        "waiting": await _waiting(db, principal, agent_ids),
        "recent_searches": (await vocab.recent_searches(principal.workspace_id, principal.user.id))[
            :8
        ],
        **await _files(db, principal),
    }


# ---------------------------------------------------------------- find anything (P97)

FIND_EACH = 5


def _like(q: str) -> str:
    words = q.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{words}%"


@router.get("/find")
async def find(
    q: str = Query(min_length=2, max_length=120),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, list[dict[str, Any]]]:
    """Tasks, agents, people and reports whose name matches, for the desk's search
    bar and the command palette (pages and documents come from the app and /api/search).
    Each list is only what this person may open, by the same rules as the pages that show
    them; people only for those who look after members."""
    ws = principal.workspace_id
    like = _like(" ".join(q.split()))
    out: dict[str, list[dict[str, Any]]] = {
        "tasks": [],
        "agents": [],
        "people": [],
        "reports": [],
    }
    tq = select(Task).where(Task.workspace_id == ws, func.lower(Task.title).like(like, escape="\\"))
    cond = principal.scope.task_where()
    if cond is not None and (shared := principal.scope.shared_task_where()) is not None:
        cond = or_(cond, shared)
    if cond is not None:
        tq = tq.where(cond)
    for t in (await db.scalars(tq.order_by(Task.updated_at.desc()).limit(FIND_EACH))).all():
        out["tasks"].append(
            {
                "kind": "task",
                "id": t.id,
                "title": t.title,
                "sub": t.status,
                "url": url_of("task", t.id),
            }
        )
    aq = select(Agent).where(
        Agent.workspace_id == ws,
        Agent.status != "retired",
        Agent.clone_of.is_(None),
        func.lower(Agent.name).like(like, escape="\\"),
        principal.scope.agent_where(),
    )
    for a in (await db.scalars(aq.order_by(Agent.name).limit(FIND_EACH * 2))).all():
        if principal.scope.sees_agent(a) and len(out["agents"]) < FIND_EACH:
            out["agents"].append(
                {
                    "kind": "agent",
                    "id": a.id,
                    "title": a.name,
                    "sub": a.role,
                    "url": url_of("agent", a.id),
                }
            )
    if {"members.manage", "team.manage"} & set(principal.permissions):
        from .members import _scope_where

        pq = (
            select(User, Membership)
            .join(Membership, Membership.user_id == User.id)
            .where(
                Membership.workspace_id == ws,
                _scope_where(principal),
                or_(
                    func.lower(User.name).like(like, escape="\\"),
                    func.lower(User.email).like(like, escape="\\"),
                ),
            )
            .order_by(func.lower(User.name))
            .limit(FIND_EACH)
        )
        for u, m in (await db.execute(pq)).all():
            out["people"].append(
                {
                    "kind": "person",
                    "id": u.id,
                    "title": u.name,
                    "sub": m.role,
                    "url": "/settings/members",
                }
            )
    rq = report_scoped(
        select(Report).where(
            Report.workspace_id == ws, func.lower(Report.title).like(like, escape="\\")
        ),
        principal,
    )
    for r in (await db.scalars(rq.order_by(Report.created_at.desc()).limit(FIND_EACH))).all():
        out["reports"].append(
            {
                "kind": "report",
                "id": r.id,
                "title": r.title,
                "sub": r.summary[:120],
                "url": url_of("report", r.id),
            }
        )
    return out


# ---------------------------------------------------------------- today's meetings (P97)

MEETINGS_TTL = 300  # seconds: the desk refreshes often; Google is asked at most every 5 min


@router.get("/meetings")
async def meetings(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    """Today's meetings from the person's own Google Calendar, when they connected it for
    their assistants (roles with assistants only). Read only; nothing is written anywhere."""
    from ...assistants import calendar

    none: dict[str, Any] = {"connected": False, "events": []}
    if not may_assist(principal.role):
        return none
    acct = await db.scalar(
        select(GoogleAccount).where(
            GoogleAccount.workspace_id == principal.workspace_id,
            GoogleAccount.user_id == principal.user.id,
        )
    )
    if acct is None or not calendar.has_calendar(acct):
        return none
    key = f"desk:meetings:{principal.workspace_id}:{principal.user.id}"
    try:
        cached = await valkey().get(key)
    except Exception:  # noqa: BLE001 - the cache is optional
        cached = None
    if cached:
        return dict(json.loads(cached))
    workspace = await db.get(Workspace, principal.workspace_id)
    tz = workspace.timezone if workspace else "Asia/Kuala_Lumpur"
    zone = ZoneInfo(tz)
    start = datetime.combine(datetime.now(zone).date(), time(0), zone)
    try:
        evs = await calendar.events(db, acct, start, start + timedelta(days=1), tz)
    except calendar.CalendarError:
        return {"connected": True, "events": [], "problem": True}
    out = {
        "connected": True,
        "events": [
            {
                "id": e.id,
                "title": e.title,
                "start": e.start.isoformat(),
                "end": e.end.isoformat(),
                "all_day": e.all_day,
                "location": e.location[:200],
                "meet": e.meet,
                "link": e.link,
            }
            for e in evs
            if e.my_response != "declined"
        ][:12],
    }
    with contextlib.suppress(Exception):  # the cache is optional
        await valkey().set(key, json.dumps(out), ex=MEETINGS_TTL)
    return out


# ---------------------------------------------------------------- ask my AI


class AskIn(BaseModel):
    text: str = Field(min_length=3, max_length=4000)
    agent_id: str | None = Field(default=None, max_length=40)
    # answer: find it and tell me (with sources); document: also prepare it as a document.
    make: Literal["answer", "document"] = "answer"
    file_ids: list[str] = Field(default_factory=list, max_length=10)


@router.get("/ask-targets")
async def ask_targets(
    principal: Principal = Depends(require("work.write")), db: AsyncSession = Depends(get_db)
) -> list[dict[str, Any]]:
    """Who can take a question from the desk: the person's own AI workers, then (for people
    who lead a team or the whole office) the company agents they may give work to, never
    someone else's personal AI worker."""
    own = await my_agents(db, principal)
    out = [_agent_card(a, None, 0) for a in own]
    if principal.scope.kind != "own":
        seen = {a.id for a in own}
        rows = await db.scalars(
            select(Agent)
            .where(
                Agent.workspace_id == principal.workspace_id,
                Agent.status == "active",
                Agent.clone_of.is_(None),
                Agent.private.is_not(True),
                Agent.owner_user_id.is_(None),
                principal.scope.agent_where(),
            )
            .order_by(Agent.name)
            .limit(60)
        )
        out += [_agent_card(a, None, 0) for a in rows.all() if a.id not in seen]
    return out


BRIEF = """{person} asked from their workspace:

{text}

How to do it:
1. Look in the company's own documents first: search_documents for exact words, amounts,
   names and reference numbers; search_library or find_sop for guidance by meaning. Open the
   pages you need with read_file.
2. Answer plainly, in the language they wrote in. Cite every source as [title p.N] so they
   can open it, and say clearly what you could not find or confirm. Never guess a figure.
{make}
Everything you make is kept in {person}'s workspace."""

MAKE_DOC = (
    "3. Then prepare it as a document with draft_document (use the company's own template "
    "when one fits, list_templates) so they can review and download it.\n"
)


@router.post("/ask", status_code=status.HTTP_201_CREATED)
async def ask(
    body: AskIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    from ...agents import runtime
    from .tasks import _assignee, _attach_files

    if body.agent_id:
        agent = await _assignee(db, principal, body.agent_id)
    else:
        own = await my_agents(db, principal)
        agent = own[0] if own else None
    if agent is None:
        raise api_error(
            status.HTTP_400_BAD_REQUEST,
            "no_ai_worker",
            "You have no AI worker yet. Hire one in My AI, or pick an agent.",
        )
    text = body.text.strip()
    await ensure_work_scope(db, principal, text)
    title = " ".join(text.split())
    title = tr("Find: {what}", what=title[:150] + ("…" if len(title) > 150 else ""))
    t = Task(
        workspace_id=principal.workspace_id,
        branch_id=agent.branch_id,
        title=title[:200],
        brief=BRIEF.format(
            person=principal.user.name,
            text=text,
            make=MAKE_DOC if body.make == "document" else "",
        ),
        status="ready",
        priority="normal",
        labels=[],
        assignee_agent_id=agent.id,
        created_by=principal.actor,
        source="desk",
        requires_review=body.make == "document",
    )
    db.add(t)
    await db.flush()
    if body.file_ids:
        await _attach_files(db, principal, t, body.file_ids)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "task.created",
        target=t.id,
        after={"title": t.title, "agent": agent.id, "from": "desk"},
    )
    await db.commit()
    await runtime.task_event(db, t, "created", principal.actor, "asked from the workspace")
    await events.publish(
        principal.workspace_id, "task.created", {"task_id": t.id, "agent_id": agent.id}
    )
    starts: datetime | None = None
    note: str | None = None
    try:
        starts = await launch.launch(db, t, principal.actor)
    except launch.LaunchError as e:
        note = lookup(e.message)
    await db.refresh(t)
    return {
        "task_id": t.id,
        "title": t.title,
        "status": t.status,
        "agent": {"id": agent.id, "name": agent.name},
        "starts_at": starts.isoformat() if starts else None,
        "note": note,
        "url": url_of("task", t.id),
    }


# ---------------------------------------------------------------- my files


@router.post("/files", status_code=status.HTTP_201_CREATED)
async def upload_to_desk(
    request: Request,
    name: str = Query(min_length=1, max_length=200),
    branch_id: str | None = Query(default=None, max_length=40),
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> Any:
    """A file of the person's own, kept in their workspace (and in their company's files
    under "My workspace/<name>", where only they and their managers see it)."""
    branch_id = branch_id or principal.branch_id
    await check_branch(db, principal, branch_id)
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > service.MAX_FILE_BYTES:
            raise api_error(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                "file_too_large",
                "Files can be up to {mb} MB.",
                mb=service.MAX_FILE_BYTES // (1024 * 1024),
            )
    if not data:
        raise api_error(status.HTTP_400_BAD_REQUEST, "empty_file", "That file is empty.")
    lang = await provenance.folder_lang(db, principal.workspace_id, branch_id)
    root = "Meja kerja saya" if lang == "ms" else "My workspace"
    f = await service.create_file(
        db,
        workspace_id=principal.workspace_id,
        name=name,
        data=bytes(data),
        created_by=principal.actor,
        mime=request.headers.get("x-file-type", "")[:120],
        branch_id=branch_id,
        folder=f"{root}/{provenance._part(principal.user.name) or 'me'}",
        owner_user_id=principal.user.id,
    )
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "file.uploaded",
        target=f.id,
        after={"name": f.name, "size": f.size, "to": "workspace"},
    )
    await db.commit()
    await db.refresh(f)
    await start_reading(f.id)
    await db.refresh(f)
    return await file_out(db, f)
