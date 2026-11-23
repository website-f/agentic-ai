"""P125: the one place IT support's admin changes are held for approval (org/held.py).

An ASGI middleware, the innermost one (inside the CSRF and JSON checks, api/main.py), so it
sees every call before routing and cannot be forgotten on a new route. For a state-changing
call under org/held.HELD_PREFIXES it looks up who is signed in (one small query); only for an
IT support person whose sign-in is fully valid (the same checks as every route:
deps.current_principal) does it read the body, save the call, and answer 202 instead of running
it. Anyone else, and any call whose sign-in fails, goes on to the route untouched (which then
answers as it always does).
"""

from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import select
from starlette.requests import Request
from starlette.types import ASGIApp, Receive, Scope, Send

from ..core.db import SessionLocal
from ..core.security import HELD_ROLE, can, token_hash
from ..i18n import Msg, current_lang
from ..i18n.labels import role_label
from ..models import AuthSession, Membership
from ..org import held
from .deps import current_principal, session_token


def _answer(status: int, content: dict[str, Any]) -> JSONResponse:
    return JSONResponse(status_code=status, content=content)


def _refuse(status: int, code: str, message: Msg) -> JSONResponse:
    return _answer(status, {"code": code, "message": message.render(current_lang())})


class HoldForApproval:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        method = str(scope.get("method", "")).upper()
        perm = held.area_of(method, scope.get("path", ""))
        if perm is None:
            await self.app(scope, receive, send)
            return
        answer = await self._maybe_hold(scope, receive, method, perm)
        if answer is None:
            await self.app(scope, receive, send)
        else:
            await answer(scope, receive, send)

    async def _maybe_hold(
        self, scope: Scope, receive: Receive, method: str, perm: str
    ) -> JSONResponse | None:
        request = Request(scope)
        token = session_token(request)
        if not token:
            return None
        async with SessionLocal() as db:
            role = await db.scalar(
                select(Membership.role)
                .join(
                    AuthSession,
                    (AuthSession.user_id == Membership.user_id)
                    & (AuthSession.workspace_id == Membership.workspace_id),
                )
                .where(
                    AuthSession.id == token_hash(token),
                    AuthSession.expires_at > datetime.now(UTC),
                )
            )
            if role != HELD_ROLE:
                return None
            try:
                principal = await current_principal(request, db)
            except HTTPException:
                return None  # the route refuses it the same way
            if principal.role != HELD_ROLE:
                return None
            if not can(principal.role, perm):
                return _refuse(
                    403,
                    "forbidden",
                    Msg("Your role ({role}) cannot do this.", role=role_label(principal.role)),
                )
            raw = bytearray()
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return _answer(400, {"code": "disconnected", "message": ""})
                raw.extend(message.get("body", b""))
                if len(raw) > held.MAX_BODY:
                    return _refuse(
                        413,
                        "too_large",
                        Msg("Changes held for approval can be up to {mb} MB.", mb=2),
                    )
                if not message.get("more_body", False):
                    break
            ctype = request.headers.get("content-type", "")
            query = (scope.get("query_string") or b"").decode("latin-1")
            try:
                row = await held.hold(
                    db, principal, method, scope.get("path", ""), query, ctype, bytes(raw)
                )
                await db.commit()
            except held.HoldError as e:
                await db.rollback()
                return _refuse(e.status, e.code, e.msg())
            summary = held.dec(row.summary)
            who = principal.user.name or principal.user.email
            await held.tell(
                db,
                row,
                await held.approvers(db, row.workspace_id, principal.user.id),
                Msg("IT support asks: {title}", title=row.title[:100]),
                Msg("{name} asked. Open Approvals to approve or decline it.", name=who),
            )
            text = summary.render(current_lang()) if isinstance(summary, Msg) else str(summary)
            return _answer(
                202,
                {
                    "held": True,
                    "request_id": row.id,
                    "summary": text,
                    "code": "held_for_approval",
                    "message": Msg(
                        "Sent to the admins for approval: {summary}", summary=text
                    ).render(current_lang()),
                },
            )
