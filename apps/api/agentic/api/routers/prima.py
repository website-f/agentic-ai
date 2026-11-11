"""P66/P67: Prima Secure through the office (agentic/prima).

Prima's screens at /prima/ call /api/prima/api/... with the office session (and its CSRF
token, like every other screen); each call goes on to Prima signed for the person signed in.
Prima's answer, refusals included, comes back as it is, so Prima decides what anyone sees.
/api/prima/people: the owner links the office's people to Prima's staff records (P67).
/api/prima/companies: the owner says which Prima company each office branch is (P75): anyone
with no Prima record of their own gets their own account in that company.
"""

import json
from difflib import SequenceMatcher

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from ...core.db import get_db
from ...i18n import Msg, render, tr
from ...models import Branch, Membership, Workspace
from ...prima import client, modules, people
from ...prima.client import PrimaError
from ...services import audit
from ..deps import Principal, client_ip, current_principal, require

router = APIRouter(prefix="/api/prima", tags=["prima"])


def _refused(e: PrimaError) -> JSONResponse:
    # Prima's own error shape ({message}), so its screens show it like their own.
    return JSONResponse(
        {"message": render(e.message), "statusCode": e.status, "code": e.code},
        status_code=e.status,
    )


@router.get("/status")
async def status(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> dict[str, object]:
    """For the Prima page: is Prima here, and who it knows this person as."""
    ws = principal.workspace_id
    if not client.enabled(ws):
        return {
            "enabled": False, "running": False, "linked": False, "me": None, "problem": "",
            "needs_microsoft": False,
        }  # fmt: skip
    try:
        ans = await client.call(
            db, workspace_id=ws, user_id=principal.user.id, method="GET", path="api/me"
        )
    except PrimaError as e:
        return {
            "enabled": True,
            "running": e.status != 503,
            "linked": False,
            "me": None,
            "problem": render(e.message),
            "needs_microsoft": e.code == "microsoft_needed",
            "code": e.code,
        }
    if ans.status == 200:
        data = ans.json()
        user = data.get("user") if isinstance(data, dict) else None
        me = (
            {"name": user.get("name"), "title": user.get("title"), "role": user.get("role")}
            if isinstance(user, dict)
            else None
        )
        return {
            "enabled": True, "running": True, "linked": True, "me": me, "problem": "",
            "needs_microsoft": False,
        }  # fmt: skip
    problem = ""
    try:
        data = ans.json()
        problem = str(data.get("message") or "") if isinstance(data, dict) else ""
    except ValueError:
        pass
    return {
        "enabled": True,
        "running": ans.status < 500,
        "linked": False,
        "me": None,
        "problem": problem or tr("Prima did not open for this account."),
        "needs_microsoft": False,
    }


# ---------------------------------------------------------------- P67 who is who


class LinkIn(BaseModel):
    user_id: str = Field(min_length=1, max_length=40)
    prima_user_id: str | None = Field(default=None, max_length=100)


def _staff_row(r: client.StaffRecord, linked_to: str | None) -> dict[str, object]:
    return {
        "id": r.id,
        "name": r.name,
        "title": r.title,
        "role": r.role,
        "can_sign_in": r.can_sign_in,
        "linked_to": linked_to,
    }


@router.get("/people")
async def people_list(
    principal: Principal = Depends(require("org.manage")), db: AsyncSession = Depends(get_db)
) -> object:
    """The office's people beside Prima's staff records, with the likely record picked."""
    if not client.enabled(principal.workspace_id):
        return _refused(PrimaError(404, Msg("Prima is not set up on this server.")))
    try:
        staff = await client.staff()
    except PrimaError as e:
        return _refused(e)
    persons = await people.people(db, principal.workspace_id)
    guess = people.suggestions(persons, client.matchable(staff))
    linked = {p.link.prima_user_id: p.user_id for p in persons if p.link}
    # P82: owners (the developer is one) open Prima as its top record, with no link.
    top = client.top_of(staff)
    return {
        "staff": [_staff_row(r, linked.get(r.id)) for r in staff],
        "top": {"id": top.id, "name": top.name, "title": top.title, "top": top.top}
        if top
        else None,
        "people": [
            {
                "user_id": p.user_id,
                "name": p.name,
                "email": p.email,
                "role": p.role,
                "microsoft": bool(p.ms_oid),
                "opens_as": top.top if top and p.role == "owner" else None,
                "link": (
                    {"prima_user_id": p.link.prima_user_id, "prima_name": p.link.prima_name,
                     "how": p.link.how}
                    if p.link else None
                ),
                "suggestion": guess.get(p.user_id),
            }
            for p in persons
        ],
    }  # fmt: skip


@router.post("/people/link")
async def people_link(
    body: LinkIn,
    principal: Principal = Depends(require("org.manage")),
    db: AsyncSession = Depends(get_db),
) -> object:
    if not client.enabled(principal.workspace_id):
        return _refused(PrimaError(404, Msg("Prima is not set up on this server.")))
    try:
        record = None
        if body.prima_user_id:
            staff = await client.staff()
            m = await db.get(Membership, (principal.workspace_id, body.user_id))
            if m is not None and m.role == "owner" and client.top_of(staff):
                raise PrimaError(
                    409,
                    Msg("Owners open Prima as its top record. They need no link of their own."),
                )
            record = next((r for r in staff if r.id == body.prima_user_id), None)
            if record is None:
                raise PrimaError(404, Msg("That Prima record does not exist."))
        await people.set_link(db, principal.workspace_id, body.user_id, record, principal.actor)
    except PrimaError as e:
        return _refused(e)
    return {"ok": True}


@router.post("/people/link-suggested")
async def people_link_suggested(
    principal: Principal = Depends(require("org.manage")), db: AsyncSession = Depends(get_db)
) -> object:
    """Link everyone whose record is picked, in one go."""
    if not client.enabled(principal.workspace_id):
        return _refused(PrimaError(404, Msg("Prima is not set up on this server.")))
    try:
        staff = await client.staff()
    except PrimaError as e:
        return _refused(e)
    by_id = {r.id: r for r in staff}
    guess = people.suggestions(
        await people.people(db, principal.workspace_id), client.matchable(staff)
    )
    done = 0
    for user_id, rid in guess.items():
        try:
            await people.set_link(db, principal.workspace_id, user_id, by_id[rid], principal.actor)
            done += 1
        except PrimaError:
            await db.rollback()
    return {"linked": done}


# ---------------------------------------------------------------- P75 branches and companies


class CompaniesIn(BaseModel):
    # {office branch id: Prima company id, or null to clear}
    companies: dict[str, str | None] = Field(max_length=500)


def _similar(a: str, b: str) -> float:
    ka, kb = people.name_key(a), people.name_key(b)
    if not ka or not kb:
        return 0.0
    if ka in kb or kb in ka:
        return 1.0
    return SequenceMatcher(None, ka, kb).ratio()


def _suggest(branch: str, companies: list[client.Company]) -> str | None:
    """The Prima company whose name is clearly the branch's, else none. P81: a branch named
    exactly as one company's name or other name ("UNIT HR" is PWVSB, "OPERASI JOHOR" Goodwill
    Empire) is that company; else the closest name or other name, when clearly closest."""
    key = people.name_key(branch)
    exact = {
        c.id for c in companies if key and key in {people.name_key(n) for n in (c.name, *c.aliases)}
    }
    if len(exact) == 1:
        return exact.pop()
    if exact:
        return None  # two companies answer to that name: the owner picks
    scored = sorted(
        ((max(_similar(branch, n) for n in (c.name, *c.aliases)), c.id) for c in companies),
        reverse=True,
    )
    if not scored or scored[0][0] < 0.6:
        return None
    if len(scored) > 1 and scored[1][0] == scored[0][0]:
        return None  # two equally likely: the owner picks
    return scored[0][1]


async def _branches(db: AsyncSession, ws_id: str) -> list[Branch]:
    return list(
        (
            await db.scalars(
                select(Branch).where(Branch.workspace_id == ws_id).order_by(Branch.name)
            )
        ).all()
    )


@router.get("/companies")
async def companies_list(
    principal: Principal = Depends(require("org.manage")), db: AsyncSession = Depends(get_db)
) -> object:
    """Each office branch beside Prima's companies: the saved one, else the likely one."""
    ws_id = principal.workspace_id
    if not client.enabled(ws_id):
        return _refused(PrimaError(404, Msg("Prima is not set up on this server.")))
    try:
        found = await client.companies()
    except PrimaError as e:
        return _refused(e)
    saved = client.company_map(await db.get(Workspace, ws_id))
    known = {c.id for c in found}
    return {
        "companies": [{"id": c.id, "name": c.name} for c in found],
        "branches": [
            {
                "id": b.id,
                "name": b.name,
                "company_id": saved.get(b.id) if saved.get(b.id) in known else None,
                "suggestion": None if saved.get(b.id) in known else _suggest(b.name, found),
            }
            for b in await _branches(db, ws_id)
        ],
    }


@router.put("/companies")
async def companies_save(
    body: CompaniesIn,
    principal: Principal = Depends(require("org.manage")),
    db: AsyncSession = Depends(get_db),
) -> object:
    ws_id = principal.workspace_id
    if not client.enabled(ws_id):
        return _refused(PrimaError(404, Msg("Prima is not set up on this server.")))
    try:
        known = {c.id for c in await client.companies()}
    except PrimaError as e:
        return _refused(e)
    branches = {b.id for b in await _branches(db, ws_id)}
    for branch_id, company_id in body.companies.items():
        if branch_id not in branches:
            return _refused(PrimaError(400, Msg("That branch is not in this office.")))
        if company_id is not None and company_id not in known:
            return _refused(PrimaError(400, Msg("That Prima company does not exist.")))
    ws = await db.get(Workspace, ws_id)
    assert ws is not None
    before = client.company_map(ws)
    after = {k: v for k, v in before.items() if k in branches}
    for branch_id, company_id in body.companies.items():
        if company_id:
            after[branch_id] = company_id
        else:
            after.pop(branch_id, None)
    ws.settings = {**(ws.settings or {}), client.COMPANIES_KEY: after}
    flag_modified(ws, "settings")
    await audit.record(
        db, ws_id, principal.actor, "prima.companies", target=ws_id, before=before, after=after
    )
    await db.commit()
    return {"ok": True, "companies": after}


async def _forward(request: Request, path: str, principal: Principal, db: AsyncSession) -> Response:
    body = await request.body() if request.method == "POST" else b""
    try:
        ans = await client.call(
            db,
            workspace_id=principal.workspace_id,
            user_id=principal.user.id,
            method=request.method,
            path=path,
            query=request.url.query,
            body=body,
            client_ip=client_ip(request),
        )
    except PrimaError as e:
        return _refused(e)
    headers = {"cache-control": "no-store"}
    if ans.disposition:
        headers["content-disposition"] = ans.disposition
    body_out = ans.body
    if request.method == "GET" and path.strip("/") == "api/me" and ans.status == 200:
        body_out = _with_office(ans, principal)
    return Response(body_out, status_code=ans.status, media_type=ans.content_type, headers=headers)


def _with_office(ans: client.Answer, principal: Principal) -> bytes:
    """P99: Prima's "who am I" with what the office gives this person, so Prima's web hides
    the screens not chosen and the way back to the office of someone with Prima only. The
    office refuses those calls anyway (client.check_chosen, core/access.py)."""
    try:
        data = ans.json()
    except ValueError:
        return ans.body
    if not isinstance(data, dict):
        return ans.body
    chosen = None if principal.role == "owner" else principal.prima_modules
    data["office"] = {
        "primaOnly": principal.access == "prima_only",
        "modules": list(chosen) if chosen is not None else None,
        "always": list(modules.ALWAYS),
    }
    return json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode()


@router.get("/{path:path}")
async def prima_get(
    path: str,
    request: Request,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> Response:
    return await _forward(request, path, principal, db)


@router.post("/{path:path}")
async def prima_post(
    path: str,
    request: Request,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> Response:
    return await _forward(request, path, principal, db)
