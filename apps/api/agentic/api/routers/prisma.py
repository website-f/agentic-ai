"""P66: Prima Secure through the office (agentic/prisma).

Prima's screens at /prisma/ call /api/prisma/api/... with the office session (and its CSRF
token, like every other screen); each call goes on to Prima signed for the person signed in.
Prima's answer, refusals included, comes back as it is, so Prima decides what anyone sees.
"""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...i18n import render, tr
from ...prisma import client
from ...prisma.client import PrimaError
from ..deps import Principal, client_ip, current_principal

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
