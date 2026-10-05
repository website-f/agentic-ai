"""P24: the AI drafts SOPs and runnable workflows from a company's own documents.

Design (the simplest reliable one): a build that fits one model call (documents up to
builders.SINGLE_PASS_CHARS of text, about 20 pages) runs inline and answers 201 with the
draft SOP or workflow, like POST /api/workflows/draft. A longer build needs map-reduce
(several calls), so it answers 202 with a job id at once and runs as a Temporal activity
(BuildFromDocsWorkflow); its state lives in Valkey for two days and
GET /api/builders/jobs/{id} reports it (the app polls; a `builder.done` event is also
published). If Temporal cannot be reached, the build runs inline instead.

Everything built here is a draft: SOPs wait for a person with org.manage to approve them
(PATCH /api/sops/{id} {"status": "active"}); workflows stay drafts until activated in the
editor. Building an SOP needs org.manage; building a workflow needs what workflows need
(agents.manage or agents.own).
"""

import logging
from typing import Any, Literal

from fastapi import APIRouter, Depends, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...agents import dispatch
from ...core.db import get_db
from ...core.security import PERMISSIONS
from ...documents import service
from ...engine import gateway
from ...i18n import current_lang
from ...i18n.labels import role_label
from ...intake import builders
from ...models import SOP, DocFile, IntakeBatch, Workflow
from ..agent_schemas import SOPOut
from ..deps import Principal, api_error, require
from .agents import manage_perm
from .sops import sop_out
from .workflows import WorkflowOut
from .workflows import out as workflow_out

router = APIRouter(tags=["builders"])
log = logging.getLogger("agentic.api.builders")


class BuildSopIn(BaseModel):
    file_ids: list[str] = Field(min_length=1, max_length=builders.MAX_FILES)
    department_id: str | None = None
    branch_id: str | None = None
    # Only this procedure of the documents (a handbook holds many), e.g. "Wang pendahuluan".
    focus: str | None = Field(default=None, max_length=300)


class BuildWorkflowIn(BaseModel):
    file_ids: list[str] = Field(min_length=1, max_length=builders.MAX_FILES)
    branch_id: str | None = None
    focus: str | None = Field(default=None, max_length=300)


class JobOut(BaseModel):
    id: str
    what: Literal["sop", "workflow"]
    status: Literal["running", "done", "failed"]
    detail: str | None = None  # progress, in the reader's language
    built_id: str | None = None
    error: str | None = None
    batch_id: str | None = None
    suggestion_id: str | None = None


class SuggestionOut(BaseModel):
    suggestion: dict[str, Any]
    job: JobOut | None = None
    sop: SOPOut | None = None
    workflow: WorkflowOut | None = None


def job_out(job: dict[str, Any]) -> JobOut:
    lang = current_lang()
    return JobOut(
        id=job["id"],
        what=job["what"],
        status=job["status"],
        detail=builders.error_text(job.get("detail"), lang),
        built_id=job.get("built_id"),
        error=builders.error_text(job.get("error"), lang),
        batch_id=job.get("batch_id"),
        suggestion_id=job.get("sid"),
    )


def _can_build(principal: Principal, what: str) -> None:
    perms = PERMISSIONS.get(principal.role, frozenset())
    ok = (
        "org.manage" in perms
        if what == "sop"
        else ("agents.manage" in perms or "agents.own" in perms)
    )
    if not ok:
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "forbidden",
            "Your role ({role}) cannot do this.",
            role=role_label(principal.role),
        )


async def _files(db: AsyncSession, principal: Principal, ids: list[str]) -> list[DocFile]:
    """The documents, checked: this person sees each one, it is read, and none is held for
    review (a file that may hold passwords or personal data is never sent to a model)."""
    ids = list(dict.fromkeys(ids))
    rows = (
        await db.scalars(
            service.scoped(
                select(DocFile).where(
                    DocFile.workspace_id == principal.workspace_id, DocFile.id.in_(ids)
                ),
                DocFile,
                principal,
            )
        )
    ).all()
    found = {f.id: f for f in rows}
    if len(found) != len(ids):
        raise api_error(status.HTTP_404_NOT_FOUND, "file_not_found", "That file is not here.")
    files = [found[i] for i in ids]
    for f in files:
        if f.quarantined:
            raise api_error(
                status.HTTP_409_CONFLICT,
                "file_held",
                "{name} is held for review because it may hold passwords or personal data. "
                "Release it first.",
                name=f.name,
            )
        if f.status == "reading":
            raise api_error(
                status.HTTP_409_CONFLICT,
                "file_not_ready",
                "{name} is still being read. Try again in a minute.",
                name=f.name,
            )
        if f.status != "ready":
            raise api_error(
                status.HTTP_400_BAD_REQUEST,
                "file_unreadable",
                "{name} could not be read, so it cannot be used.",
                name=f.name,
            )
    return files


def _branch(principal: Principal, files: list[DocFile], asked: str | None) -> str | None:
    branch_id = asked or next((f.branch_id for f in files if f.branch_id), None)
    if not service.branch_ok(principal, branch_id):
        raise api_error(status.HTTP_400_BAD_REQUEST, "bad_branch", "Pick a company you work in.")
    return branch_id


def _department(files: list[DocFile], asked: str | None) -> str | None:
    if asked:
        return asked
    found = {f.department_id for f in files}
    return found.pop() if len(found) == 1 else None


async def _built(db: AsyncSession, what: str, made_id: str) -> SOPOut | WorkflowOut | None:
    if what == "sop":
        s = await db.get(SOP, made_id)
        return await sop_out(db, s) if s else None
    wf = await db.get(Workflow, made_id)
    return await workflow_out(db, wf) if wf else None


async def _run(
    db: AsyncSession,
    principal: Principal,
    *,
    what: str,
    files: list[DocFile],
    branch_id: str | None,
    department_id: str | None,
    batch_id: str | None = None,
    sid: str | None = None,
    focus: str | None = None,
) -> tuple[SOPOut | WorkflowOut | None, JobOut | None]:
    """Build inline when one model call will do, else start a background job. Returns
    (what was built, None) or (None, the running job)."""
    ids = [f.id for f in files]
    focus = " ".join((focus or "").split()) or None
    size = await builders.source_size(db, principal.workspace_id, ids, focus)
    if size > builders.SINGLE_PASS_CHARS:
        job = await builders.new_job(
            workspace_id=principal.workspace_id,
            what=what,
            file_ids=ids,
            branch_id=branch_id,
            department_id=department_id,
            actor=principal.actor,
            batch_id=batch_id,
            sid=sid,
            focus=focus,
        )
        try:
            await dispatch.start_build(job["id"])
            return None, job_out(job)
        except Exception:  # noqa: BLE001 - Temporal is down: build it here instead
            log.warning("could not start build job %s; building inline", job["id"], exc_info=True)
            done = await builders.run_job(db, job["id"]) or job
            if done["status"] != "done":
                return None, job_out(done)
            return await _built(db, what, done["built_id"]), None
    try:
        made = await builders.build(
            db,
            what=what,
            workspace_id=principal.workspace_id,
            file_ids=ids,
            branch_id=branch_id,
            department_id=department_id,
            actor=principal.actor,
            focus=focus,
        )
    except builders.BuildError as e:
        await db.rollback()
        raise api_error(e.status, e.code, e.message) from e
    except gateway.GatewayUnavailable as e:
        await db.rollback()
        raise api_error(status.HTTP_502_BAD_GATEWAY, "no_model_available", str(e)) from e
    if batch_id and sid:
        await builders.update_suggestion(
            db, batch_id, sid, status="built", built_id=made.id, job_id=None
        )
    return await _built(db, what, made.id), None


def _answer(made: Any, job: JobOut | None) -> Any:
    if job is not None:
        code = status.HTTP_202_ACCEPTED if job.status == "running" else status.HTTP_200_OK
        return JSONResponse(status_code=code, content=jsonable_encoder(job))
    return JSONResponse(status_code=status.HTTP_201_CREATED, content=jsonable_encoder(made))


@router.post("/api/builders/sop", status_code=status.HTTP_201_CREATED, response_model=None)
async def build_sop(
    body: BuildSopIn,
    principal: Principal = Depends(require("org.manage")),
    db: AsyncSession = Depends(get_db),
) -> Any:
    """Draft an SOP from documents: 201 SOPOut (status draft), or 202 JobOut for long ones."""
    files = await _files(db, principal, body.file_ids)
    made, job = await _run(
        db,
        principal,
        what="sop",
        files=files,
        branch_id=_branch(principal, files, body.branch_id),
        department_id=_department(files, body.department_id),
        focus=body.focus,
    )
    return _answer(made, job)


@router.post("/api/builders/workflow", status_code=status.HTTP_201_CREATED, response_model=None)
async def build_workflow(
    body: BuildWorkflowIn,
    principal: Principal = Depends(manage_perm()),
    db: AsyncSession = Depends(get_db),
) -> Any:
    """Draft a runnable workflow from documents: 201 WorkflowOut (status draft), or 202
    JobOut for long ones."""
    files = await _files(db, principal, body.file_ids)
    made, job = await _run(
        db,
        principal,
        what="workflow",
        files=files,
        branch_id=_branch(principal, files, body.branch_id),
        department_id=None,
        focus=body.focus,
    )
    return _answer(made, job)


@router.get("/api/builders/jobs/{job_id}")
async def read_job(job_id: str, principal: Principal = Depends(require("read"))) -> JobOut:
    job = await builders.get_job(job_id)
    if job is None or job.get("workspace_id") != principal.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "job_not_found", "That build is not here.")
    return job_out(job)


# ---------------------------------------------------------------- suggestions on an upload


async def _batch(db: AsyncSession, principal: Principal, batch_id: str) -> IntakeBatch:
    b = await db.get(IntakeBatch, batch_id)
    if (
        b is None
        or b.workspace_id != principal.workspace_id
        or not (b.created_by == principal.actor or service.branch_ok(principal, b.branch_id))
    ):
        raise api_error(status.HTTP_404_NOT_FOUND, "batch_not_found", "That upload is not here.")
    return b


def _suggestion(batch: IntakeBatch, sid: str) -> dict[str, Any]:
    s = builders.find_suggestion(batch, sid)
    if s is None or s.get("what") not in ("sop", "workflow"):
        raise api_error(
            status.HTTP_404_NOT_FOUND, "suggestion_not_found", "That suggestion is not here."
        )
    return s


@router.post("/api/intake/{batch_id}/suggestions/{sid}/build", response_model=None)
async def build_suggestion(
    batch_id: str,
    sid: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> Any:
    """Build what a suggestion proposes. 201 with the draft (suggestion marked built), 202
    with the job for long documents (marked built when it finishes), 200 when it was built
    already."""
    batch = await _batch(db, principal, batch_id)
    s = _suggestion(batch, sid)
    _can_build(principal, s["what"])
    if s.get("status") == "built" and s.get("built_id"):
        made = await _built(db, s["what"], s["built_id"])
        if made is not None:
            return _suggestion_answer(s, made, None, status.HTTP_200_OK)
    if s.get("job_id"):
        running = await builders.get_job(s["job_id"])
        if running is not None and running["status"] == "running":
            return _suggestion_answer(s, None, job_out(running), status.HTTP_202_ACCEPTED)
    files = await _files(db, principal, list(s.get("file_ids") or []))
    made, job = await _run(
        db,
        principal,
        what=s["what"],
        files=files,
        branch_id=_branch(principal, files, batch.branch_id),
        department_id=s.get("department_id") if s["what"] == "sop" else None,
        batch_id=batch.id,
        sid=sid,
        # The suggestion's title (and its section of a longer document): only that procedure.
        focus=builders.suggestion_focus(s),
    )
    if job is not None and job.status == "running":
        saved = await builders.update_suggestion(db, batch.id, sid, job_id=job.id) or s
        return _suggestion_answer(saved, None, job, status.HTTP_202_ACCEPTED)
    await db.refresh(batch)
    saved = builders.find_suggestion(batch, sid) or s
    if made is None:
        return _suggestion_answer(saved, None, job, status.HTTP_200_OK)
    return _suggestion_answer(saved, made, None, status.HTTP_201_CREATED)


@router.post("/api/intake/{batch_id}/suggestions/{sid}/dismiss")
async def dismiss_suggestion(
    batch_id: str,
    sid: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> SuggestionOut:
    batch = await _batch(db, principal, batch_id)
    s = _suggestion(batch, sid)
    _can_build(principal, s["what"])
    if s.get("status") == "built":
        raise api_error(
            status.HTTP_409_CONFLICT,
            "already_built",
            "This suggestion is built already. Delete the draft instead.",
        )
    saved = await builders.update_suggestion(db, batch.id, sid, status="dismissed") or s
    return SuggestionOut(suggestion=saved)


def _suggestion_answer(s: dict[str, Any], made: Any, job: JobOut | None, code: int) -> JSONResponse:
    out = SuggestionOut(
        suggestion=s,
        job=job,
        sop=made if isinstance(made, SOPOut) else None,
        workflow=made if isinstance(made, WorkflowOut) else None,
    )
    return JSONResponse(status_code=code, content=jsonable_encoder(out))
