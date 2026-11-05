"""P66/P67: Prima Secure through the office (agentic/prisma).

Prima's screens at /prisma/ call /api/prisma/api/... with the office session (and its CSRF
token, like every other screen); each call goes on to Prima signed for the person signed in.
Prima's answer, refusals included, comes back as it is, so Prima decides what anyone sees.
/api/prisma/people: the owner links the office's people to Prima's staff records (P67).
"""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...i18n import Msg, render, tr
from ...prisma import client, people
from ...prisma.client import PrimaError
from ..deps import Principal, client_ip, current_principal, require

router = APIRouter(prefix="/api/prisma", tags=["prisma"])


def _refused(e: PrimaError) -> JSONResponse:
    # Prima's own error shape ({message}), so its screens show it like their own.
    return JSONResponse(
        {"message": render(e.message), "statusCode": e.status}, status_code=e.status
    )


@router.get("/status")
async def status(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> dict[str, object]:
    """For the Prisma page: is Prima here, and who it knows this person as."""
    ws = principal.workspace_id
    if not client.enabled(ws):
        return {"enabled": False, "running": False, "linked": False, "me": None, "problem": ""}
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
        }
    if ans.status == 200:
        data = ans.json()
        user = data.get("user") if isinstance(data, dict) else None
        me = (
            {"name": user.get("name"), "title": user.get("title"), "role": user.get("role")}
            if isinstance(user, dict)
            else None
        )
        return {"enabled": True, "running": True, "linked": True, "me": me, "problem": ""}
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
    guess = people.suggestions(persons, staff)
    linked = {p.link.prima_user_id: p.user_id for p in persons if p.link}
    return {
        "staff": [_staff_row(r, linked.get(r.id)) for r in staff],
        "people": [
            {
                "user_id": p.user_id,
                "name": p.name,
                "email": p.email,
                "role": p.role,
                "microsoft": bool(p.ms_oid),
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
            record = next((r for r in await client.staff() if r.id == body.prima_user_id), None)
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
    guess = people.suggestions(await people.people(db, principal.workspace_id), staff)
    done = 0
    for user_id, rid in guess.items():
        try:
            await people.set_link(db, principal.workspace_id, user_id, by_id[rid], principal.actor)
            done += 1
        except PrimaError:
            await db.rollback()
    return {"linked": done}


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
    return Response(ans.body, status_code=ans.status, media_type=ans.content_type, headers=headers)


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
