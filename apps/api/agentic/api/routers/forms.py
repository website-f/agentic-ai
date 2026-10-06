"""Forms (P27): company forms people fill in and hand back, by a deadline.

A manager adds a form for a company (or one department): a ready-made one in one click
(`/starters`, agentic/forms/starters.py) or the company's own Excel/Word/PDF file, and says
when it is due. Everyone it is for sees it with their own state for this round (open, due
soon, late, handed in, returned, accepted), downloads the blank, and either hands back the
filled file (with receipts or anything else attached) or asks their AI worker to fill it: the
AI reads the form's layout, fills a copy and leaves it as a draft the person checks and hands
in. Managers see who has handed in each round, open the files, and accept or return them with
a note.

- GET    /api/forms                         forms for me, with my state this round
- GET    /api/forms/starters                the ready-made forms
- POST   /api/forms/starters                add a ready-made form to a company
- POST   /api/forms                         add a company's own form (file uploaded first)
- PATCH  /api/forms/{id}                    change it; DELETE archives it
- GET    /api/forms/{id}/download           the blank form
- POST   /api/forms/{id}/submit             hand in my filled form (and attachments)
- POST   /api/forms/{id}/ask                ask my AI worker to fill it
- GET    /api/forms/{id}/submissions        who handed in a round (managers)
- POST   /api/form-submissions/{id}/review  accept or return (managers)
"""

from datetime import UTC, date, datetime
from typing import Any, Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from ... import forms as F
from ...agents import launch
from ...core.db import get_db
from ...documents import provenance, service
from ...forms import starters, store
from ...i18n import current_lang, lookup, tr
from ...models import (
    Branch,
    Department,
    DocFile,
    Form,
    FormSubmission,
    Membership,
    Task,
    User,
    Workspace,
)
from ...services import audit, events
from ..deps import Principal, api_error, require
from .files import check_branch, visible_files

router = APIRouter(tags=["forms"])

MANAGERS = ("org.manage", "team.manage", "agents.manage")
WORKSPACE_ROLES = ("owner", "admin")
Kind = Literal["claim", "advance", "payroll", "request", "report", "record", "checklist", "other"]


def _now() -> datetime:
    return datetime.now(UTC)


def manages(principal: Principal, branch_id: str | None) -> bool:
    """May add forms for this company and review what people hand in."""
    if not any(p in principal.permissions for p in MANAGERS):
        return False
    sc = principal.scope
    return sc.everything or (branch_id is not None and branch_id == sc.branch_id)


def _for_me(principal: Principal) -> Any:
    """Forms this person sees: every form for workspace roles; else their company's (or
    everyone's) and, for a department form, only that department (a company's managers
    see all of its forms)."""
    q = Form.workspace_id == principal.workspace_id
    sc = principal.scope
    if sc.everything:
        return q
    branch = or_(Form.branch_id.is_(None), Form.branch_id == principal.branch_id)
    if any(p in principal.permissions for p in MANAGERS) and sc.kind == "branch":
        return q & branch
    dept = or_(Form.department_id.is_(None), Form.department_id == principal.department_id)
    return q & branch & dept


async def _form(db: AsyncSession, principal: Principal, form_id: str) -> Form:
    f = await db.scalar(select(Form).where(Form.id == form_id, _for_me(principal)))
    if f is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "form_not_found", "That form is not here.")
    return f


def _check_managed(principal: Principal, f: Form) -> None:
    if not manages(principal, f.branch_id):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "cannot_manage_forms",
            "Only managers add and change their company's forms.",
        )


def sub_out(s: FormSubmission, files: dict[str, DocFile]) -> dict[str, Any]:
    return {
        "id": s.id,
        "period": s.period,
        "status": s.status,
        "made_by": s.made_by,
        "note": s.note,
        "review_note": s.review_note,
        "submitted_at": s.submitted_at,
        "reviewed_at": s.reviewed_at,
        "task_id": s.task_id,
        "files": [
            {"id": i, "name": files[i].name, "mime": files[i].mime, "size": files[i].size}
            for i in s.file_ids or []
            if i in files
        ],
    }


async def _files(db: AsyncSession, ids: set[str]) -> dict[str, DocFile]:
    if not ids:
        return {}
    rows = await db.scalars(select(DocFile).where(DocFile.id.in_(ids)))
    return {f.id: f for f in rows.all()}


async def _expected(db: AsyncSession, f: Form) -> list[tuple[Membership, User]]:
    """Who should hand this form in: the people of its company (and department)."""
    q = (
        select(Membership, User)
        .join(User, User.id == Membership.user_id)
        .where(Membership.workspace_id == f.workspace_id, Membership.role.not_in(WORKSPACE_ROLES))
    )
    q = q.where(
        Membership.branch_id == f.branch_id if f.branch_id else Membership.branch_id.is_not(None)
    )
    if f.department_id:
        q = q.where(Membership.department_id == f.department_id)
    return [(m, u) for m, u in (await db.execute(q.order_by(User.name))).all()]


def expects(principal: Principal, f: Form) -> bool:
    """Whether this person is one of those who hand the form in (same rule as _expected)."""
    if principal.role in WORKSPACE_ROLES or principal.branch_id is None:
        return False
    if f.branch_id and principal.branch_id != f.branch_id:
        return False
    return not f.department_id or principal.department_id == f.department_id


async def form_out(db: AsyncSession, principal: Principal, f: Form, today: date) -> dict[str, Any]:
    mine_rows = (
        await db.scalars(
            select(FormSubmission).where(
                FormSubmission.form_id == f.id, FormSubmission.user_id == principal.user.id
            )
        )
    ).all()
    mine = {s.period: s for s in mine_rows}
    period, w = store.shown_round(f, today, set(mine))
    sub = mine.get(period)
    if (f.schedule or {}).get("every", "none") == "none":
        # Whenever needed: the latest one still in play.
        live = [s for s in mine_rows if s.status in ("draft", "returned", "submitted")]
        sub = max(live, key=lambda s: s.updated_at) if live else None
    files = await _files(
        db, ({f.file_id} if f.file_id else set()) | set(sub.file_ids if sub else [])
    )
    branch = await db.get(Branch, f.branch_id) if f.branch_id else None
    dept = await db.get(Department, f.department_id) if f.department_id else None
    template = files.get(f.file_id) if f.file_id else None
    out: dict[str, Any] = {
        "id": f.id,
        "name": f.name,
        "description": f.description,
        "kind": f.kind,
        "branch_id": f.branch_id,
        "branch_name": branch.name if branch else None,
        "department_id": f.department_id,
        "department_name": dept.name if dept else None,
        "schedule": f.schedule,
        "guide": f.guide,
        "status": f.status,
        "template": (
            {"id": template.id, "name": template.name, "mime": template.mime, "size": template.size}
            if template
            else None
        ),
        "period": period,
        "opens": w.opens if w else None,
        "due": w.due if w else None,
        "state": F.state(w, today, sub.status if sub else None),
        "mine": sub_out(sub, files) if sub else None,
        "can_manage": manages(principal, f.branch_id),
        "expected": expects(principal, f),
        "progress": None,
    }
    if out["can_manage"]:
        people = await _expected(db, f)
        q = select(FormSubmission).where(FormSubmission.form_id == f.id)
        if (f.schedule or {}).get("every", "none") != "none":
            q = q.where(FormSubmission.period == period)
        subs = (await db.scalars(q)).all()
        handed = {s.user_id: s.status for s in subs}
        out["progress"] = {
            "expected": len(people),
            "submitted": sum(1 for v in handed.values() if v in ("submitted", "accepted")),
            "accepted": sum(1 for v in handed.values() if v == "accepted"),
            "waiting": sum(1 for x in subs if x.status == "submitted"),
        }
    return out


@router.get("/api/forms")
async def list_forms(
    branch_id: str | None = Query(default=None, max_length=40),
    archived: bool = False,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    q = select(Form).where(_for_me(principal))
    q = q.where(Form.status == ("archived" if archived else "active"))
    if branch_id:
        q = q.where(or_(Form.branch_id == branch_id, Form.branch_id.is_(None)))
    today = await store.today_in(db, principal.workspace_id)
    rows = (await db.scalars(q.order_by(Form.name))).all()
    return [await form_out(db, principal, f, today) for f in rows]


# ---------------------------------------------------------------- adding forms


@router.get("/api/forms/starters")
async def list_starters(principal: Principal = Depends(require("read"))) -> list[dict[str, Any]]:
    lang = "ms" if current_lang() == "ms" else "en"
    return [
        {
            "key": s.key,
            "kind": s.kind,
            "name": s.names[lang],
            "description": s.descriptions[lang],
            "schedule": s.schedule,
        }
        for s in starters.STARTERS
    ]


async def _check_manage(db: AsyncSession, principal: Principal, branch_id: str | None) -> None:
    await check_branch(db, principal, branch_id)
    if not manages(principal, branch_id):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "cannot_manage_forms",
            "Only managers add and change their company's forms.",
        )


async def _department(
    db: AsyncSession, branch_id: str | None, department_id: str | None
) -> str | None:
    if not department_id:
        return None
    d = await db.get(Department, department_id)
    if d is None or (branch_id and d.branch_id != branch_id):
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "bad_department", "Pick a department of that company."
        )
    return d.id


def _share_template(file: DocFile, branch_id: str | None, department_id: str | None) -> None:
    """A form's blank is a guideline everyone it is for (and their agents) may open."""
    file.library = True
    file.branch_id = branch_id
    file.department_id = department_id
    file.kind = "form"
    file.owner_user_id = None


class StarterIn(BaseModel):
    key: str = Field(min_length=1, max_length=40)
    branch_id: str | None = Field(default=None, max_length=40)
    department_id: str | None = Field(default=None, max_length=40)


@router.post("/api/forms/starters", status_code=status.HTTP_201_CREATED)
async def add_starter(
    body: StarterIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if body.key not in starters.STARTERS_BY_KEY:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "no_starter", "There is no such ready-made form."
        )
    await _check_manage(db, principal, body.branch_id)
    dept = await _department(db, body.branch_id, body.department_id)
    branch = await db.get(Branch, body.branch_id) if body.branch_id else None
    ws = await db.get(Workspace, principal.workspace_id)
    lang = (
        "ms"
        if await provenance.folder_lang(db, principal.workspace_id, body.branch_id) == "ms"
        else "en"
    )
    kit = await service.kit_data(db, body.branch_id)
    company = str(kit.get("legal_name") or (branch.name if branch else ws.name if ws else ""))
    st, data = starters.build(body.key, lang, company)
    name = st.names[lang]
    file = await service.create_file(
        db,
        workspace_id=principal.workspace_id,
        name=f"{name}.xlsx",
        data=data,
        created_by=principal.actor,
        branch_id=body.branch_id,
        source="generated",
        status="ready",
        folder="Borang" if lang == "ms" else "Forms",
    )
    _share_template(file, body.branch_id, dept)
    f = Form(
        workspace_id=principal.workspace_id,
        branch_id=body.branch_id,
        department_id=dept,
        name=name,
        description=st.descriptions[lang],
        kind=st.kind,
        file_id=file.id,
        schedule=dict(st.schedule),
        created_by=principal.actor,
    )
    db.add(f)
    await db.flush()
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "form.created",
        target=f.id,
        after={"name": f.name, "starter": body.key},
    )
    await db.commit()
    return await form_out(db, principal, f, await store.today_in(db, principal.workspace_id))


class FormIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=2000)
    kind: Kind = "other"
    branch_id: str | None = Field(default=None, max_length=40)
    department_id: str | None = Field(default=None, max_length=40)
    file_id: str | None = Field(default=None, max_length=40)
    schedule: dict[str, Any] = Field(default_factory=dict)
    guide: str = Field(default="", max_length=8000)


async def _usable_file(db: AsyncSession, principal: Principal, file_id: str) -> DocFile:
    f = await db.scalar(
        visible_files(
            select(DocFile).where(
                DocFile.id == file_id, DocFile.workspace_id == principal.workspace_id
            ),
            principal,
        )
    )
    if f is None or f.quarantined:
        raise api_error(status.HTTP_400_BAD_REQUEST, "bad_file", "Pick files you can see.")
    return f


@router.post("/api/forms", status_code=status.HTTP_201_CREATED)
async def add_form(
    body: FormIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await _check_manage(db, principal, body.branch_id)
    dept = await _department(db, body.branch_id, body.department_id)
    if body.file_id:
        _share_template(await _usable_file(db, principal, body.file_id), body.branch_id, dept)
    f = Form(
        workspace_id=principal.workspace_id,
        branch_id=body.branch_id,
        department_id=dept,
        name=body.name.strip(),
        description=body.description.strip(),
        kind=body.kind,
        file_id=body.file_id,
        schedule=F.clean_schedule(body.schedule),
        guide=body.guide.strip(),
        created_by=principal.actor,
    )
    db.add(f)
    await db.flush()
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "form.created",
        target=f.id,
        after={"name": f.name},
    )
    await db.commit()
    return await form_out(db, principal, f, await store.today_in(db, principal.workspace_id))


class FormPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    kind: Kind | None = None
    department_id: str | None = Field(default=None, max_length=40)
    file_id: str | None = Field(default=None, max_length=40)
    schedule: dict[str, Any] | None = None
    guide: str | None = Field(default=None, max_length=8000)
    status: Literal["active", "archived"] | None = None


@router.patch("/api/forms/{form_id}")
async def change_form(
    form_id: str,
    body: FormPatch,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    f = await _form(db, principal, form_id)
    await _check_manage(db, principal, f.branch_id)
    changes = body.model_dump(exclude_unset=True)
    if "department_id" in changes:
        f.department_id = await _department(db, f.branch_id, changes["department_id"])
    if changes.get("file_id"):
        file = await _usable_file(db, principal, changes["file_id"])
        _share_template(file, f.branch_id, f.department_id)
        f.file_id = file.id
    if changes.get("schedule") is not None:
        f.schedule = F.clean_schedule(changes["schedule"])
    for k in ("name", "description", "kind", "guide", "status"):
        if changes.get(k) is not None:
            v = changes[k]
            setattr(f, k, v.strip() if isinstance(v, str) else v)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "form.updated",
        target=f.id,
        after={k: v for k, v in changes.items() if k != "guide"},
    )
    await db.commit()
    return await form_out(db, principal, f, await store.today_in(db, principal.workspace_id))


@router.delete("/api/forms/{form_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_form(
    form_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> None:
    f = await _form(db, principal, form_id)
    await _check_manage(db, principal, f.branch_id)
    f.status = "archived"
    await audit.record(db, principal.workspace_id, principal.actor, "form.archived", target=f.id)
    await db.commit()


@router.get("/api/forms/{form_id}/download")
async def download_blank(
    form_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    f = await _form(db, principal, form_id)
    file = (
        await db.scalar(
            select(DocFile).where(DocFile.id == f.file_id).options(undefer(DocFile.data))
        )
        if f.file_id
        else None
    )
    if file is None:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "no_template", "This form has no file to download."
        )
    return Response(
        content=bytes(file.data),
        media_type=file.mime or "application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(file.name)}"},
    )


# ---------------------------------------------------------------- handing in


class SubmitIn(BaseModel):
    file_ids: list[str] = Field(min_length=1, max_length=20)
    note: str = Field(default="", max_length=2000)
    period: str | None = Field(default=None, max_length=40)


@router.post("/api/forms/{form_id}/submit")
async def submit(
    form_id: str,
    body: SubmitIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    f = await _form(db, principal, form_id)
    files = [await _usable_file(db, principal, i) for i in dict.fromkeys(body.file_ids)]
    today = await store.today_in(db, principal.workspace_id)
    period = await store.person_round(db, f, principal.user.id, today, body.period)
    s = await store.upsert(db, f, principal.user.id, f.branch_id or principal.branch_id, period)
    if s.status == "accepted":
        raise api_error(
            status.HTTP_409_CONFLICT, "already_accepted", "This round was already accepted."
        )
    s.file_ids = [x.id for x in files]
    s.note = body.note.strip()
    s.status = "submitted"
    s.submitted_at = _now()
    for x in files:  # the person's filled copy stays theirs, kept with the company's files
        if x.owner_user_id is None and not x.library:
            x.owner_user_id = principal.user.id
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "form.submitted",
        target=f.id,
        after={"period": period, "files": len(files)},
    )
    await db.commit()
    await events.publish(principal.workspace_id, "form.submitted", {"form_id": f.id})
    return await form_out(db, principal, f, today)


class AskIn(BaseModel):
    text: str = Field(default="", max_length=4000)
    file_ids: list[str] = Field(default_factory=list, max_length=10)
    agent_id: str | None = Field(default=None, max_length=40)


ASK_BRIEF = """{person} asks you to fill in the company form "{name}" (form id {form_id})
for {period}. Due: {due}. {description}
{guide}
What they told you:
{text}

How to do it:
1. describe_form form_id={form_id}: see the form's layout (sheets, labels, table headers, cells).
2. Read what they attached (read_file / view_image: receipts, attendance, lists) and use the
   company's documents when you need a rule or a figure (search_documents, find_sop).
3. fill_form form_id={form_id} with the values: by cell, by label or as table rows. Never
   invent a figure: leave it empty and say so.
4. Answer in their language: what you filled, totals, and anything missing or unclear.
The filled form waits as their draft; they check it and hand it in."""


@router.post("/api/forms/{form_id}/ask", status_code=status.HTTP_201_CREATED)
async def ask_ai(
    form_id: str,
    body: AskIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    from ...agents import runtime
    from .desk import my_agents
    from .tasks import _assignee, _attach_files

    f = await _form(db, principal, form_id)
    if not f.file_id:
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "no_template", "This form has no file to download."
        )
    if body.agent_id:
        agent = await _assignee(db, principal, body.agent_id)
    else:
        own = await my_agents(db, principal)
        agent = own[0] if own else None
    if agent is None:
        raise api_error(
            status.HTTP_400_BAD_REQUEST,
            "no_ai_worker",
            "You have no AI worker yet. Hire one in My AI worker, or pick an agent.",
        )
    today = await store.today_in(db, principal.workspace_id)
    period = await store.person_round(db, f, principal.user.id, today)
    w = F.window(f.schedule, today)
    t = Task(
        workspace_id=principal.workspace_id,
        branch_id=agent.branch_id,
        title=tr("Fill in: {form}", form=f.name)[:200],
        brief=ASK_BRIEF.format(
            person=principal.user.name,
            name=f.name,
            form_id=f.id,
            period=period,
            due=w.due.isoformat() if w else "whenever needed",
            description=f.description,
            guide=f"How to fill it: {f.guide}\n" if f.guide else "",
            text=body.text.strip() or "(nothing more: use the attached files)",
        ),
        status="ready",
        priority="normal",
        labels=["form"],
        assignee_agent_id=agent.id,
        created_by=principal.actor,
        source="form",
        requires_review=False,
    )
    db.add(t)
    await db.flush()
    t.root_task_id = t.id
    if body.file_ids:
        await _attach_files(db, principal, t, body.file_ids)
    s = await store.upsert(db, f, principal.user.id, f.branch_id or principal.branch_id, period)
    if s.status not in ("submitted", "accepted"):
        s.task_id = t.id
        s.made_by = "agent"
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "task.created",
        target=t.id,
        after={"title": t.title, "agent": agent.id, "form": f.id},
    )
    await db.commit()
    await runtime.task_event(db, t, "created", principal.actor, "asked to fill a form")
    await events.publish(
        principal.workspace_id, "task.created", {"task_id": t.id, "agent_id": agent.id}
    )
    note: str | None = None
    try:
        await launch.launch(db, t, principal.actor)
    except launch.LaunchError as e:
        note = lookup(e.message)
    return {"task_id": t.id, "agent": {"id": agent.id, "name": agent.name}, "note": note}


# ---------------------------------------------------------------- reviewing


@router.get("/api/forms/{form_id}/submissions")
async def submissions(
    form_id: str,
    period: str | None = Query(default=None, max_length=40),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    f = await _form(db, principal, form_id)
    _check_managed(principal, f)
    today = await store.today_in(db, principal.workspace_id)
    w = F.window(f.schedule, today)
    if (f.schedule or {}).get("every", "none") == "none":
        rows = (
            await db.scalars(
                select(FormSubmission)
                .where(FormSubmission.form_id == f.id, FormSubmission.status != "draft")
                .order_by(FormSubmission.updated_at.desc())
                .limit(200)
            )
        ).all()
        files = await _files(db, {i for s in rows for i in s.file_ids or []})
        users = {
            u.id: u
            for u in (
                await db.scalars(select(User).where(User.id.in_({s.user_id for s in rows})))
            ).all()
        }
        return {
            "period": None,
            "periods": [],
            "people": [
                {
                    "user_id": s.user_id,
                    "name": users[s.user_id].name if s.user_id in users else "",
                    "state": s.status,
                    "submission": sub_out(s, files),
                }
                for s in rows
            ],
        }
    # The round the form's card shows: one just missed (still being chased), else the open one.
    period = period or store.shown_round(f, today, set())[0]
    if period == "anytime":
        period = "once"
    subs = (
        await db.scalars(
            select(FormSubmission).where(
                FormSubmission.form_id == f.id, FormSubmission.period == period
            )
        )
    ).all()
    by_user = {s.user_id: s for s in subs}
    files = await _files(db, {i for s in subs for i in s.file_ids or []})
    people: list[dict[str, Any]] = []
    for _m, u in await _expected(db, f):
        s = by_user.pop(u.id, None)
        handed = s is not None and s.status != "draft"
        people.append(
            {
                "user_id": u.id,
                "name": u.name,
                "state": s.status
                if handed and s
                else ("late" if w and period < w.period else "missing"),
                "submission": sub_out(s, files) if handed and s else None,
            }
        )
    for s in by_user.values():  # handed in by someone the form was not addressed to
        if s.status == "draft":
            continue
        u = await db.get(User, s.user_id)
        people.append(
            {
                "user_id": s.user_id,
                "name": u.name if u else "",
                "state": s.status,
                "submission": sub_out(s, files),
            }
        )
    seen = (
        await db.execute(select(FormSubmission.period).where(FormSubmission.form_id == f.id))
    ).all()
    periods = sorted({p for (p,) in seen} | ({w.period} if w else set()) | {period}, reverse=True)[
        :24
    ]
    return {"period": period, "periods": periods, "people": people}


class ReviewIn(BaseModel):
    decision: Literal["accept", "return"]
    note: str = Field(default="", max_length=2000)


@router.post("/api/form-submissions/{submission_id}/review")
async def review(
    submission_id: str,
    body: ReviewIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    s = await db.get(FormSubmission, submission_id)
    f = await db.get(Form, s.form_id) if s else None
    if s is None or f is None or f.workspace_id != principal.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "form_not_found", "That form is not here.")
    _check_managed(principal, f)
    if body.decision == "return" and len(body.note.strip()) < 3:
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "note_needed", "Say what to fix when you return it."
        )
    s.status = "accepted" if body.decision == "accept" else "returned"
    s.review_note = body.note.strip()
    s.reviewed_by = principal.actor
    s.reviewed_at = _now()
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        f"form.{s.status}",
        target=s.id,
        after={"form": f.id, "period": s.period},
    )
    await db.commit()
    return sub_out(s, await _files(db, set(s.file_ids or [])))
