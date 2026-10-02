"""FastAPI app: `uvicorn agentic.api.main:app`."""

import asyncio
import hmac
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .. import __version__
from ..brain import embed
from ..core.db import engine
from ..core.valkey import close_valkey
from .deps import CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE
from .routers import (
    agents,
    ai_engine,
    audit_log,
    auth,
    blueprints,
    brain,
    broadcasts,
    channels,
    documents,
    events_stream,
    files,
    members,
    monitor,
    office,
    openai_compat,
    org,
    overview,
    packs,
    reports,
    skills,
    sops,
    system,
    tasks,
    teams,
    vault,
    web_tasks,
    workflows,
)

log = logging.getLogger("agentic.api")

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
# No session exists yet on these, so there is no CSRF cookie to compare against.
CSRF_EXEMPT = {"/api/auth/login", "/api/auth/setup", "/api/push/act"}
# File uploads send raw bytes. A cross-site form cannot send octet-stream either, so the
# JSON-only guarantee holds; the CSRF token is still checked.
RAW_UPLOAD_PATHS = {"/api/files"}


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Load the embedding model in the background so the first search is not slow.
    warm = asyncio.create_task(embed.warm())
    yield
    warm.cancel()
    await close_valkey()
    await engine.dispose()


app = FastAPI(
    title="Agentic-AI",
    version=__version__,
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    redoc_url=None,
)


@app.middleware("http")
async def csrf_guard(request: Request, call_next):
    """Two layers for state-changing API calls:
    1. JSON only: a cross-site HTML form cannot send application/json without a CORS
       preflight, and this API allows no cross-origin requests.
    2. Double-submit token: the X-CSRF-Token header must match the agentic_csrf cookie.
    """
    path = request.url.path
    if request.method in UNSAFE_METHODS and path.startswith("/api/"):
        ctype = request.headers.get("content-type", "")
        raw_ok = (
            path in RAW_UPLOAD_PATHS
            and request.method == "POST"
            and ctype.startswith("application/octet-stream")
        )
        if not ctype.startswith("application/json") and not raw_ok:
            return _error(415, "json_required", "Send requests as application/json.")
        if path not in CSRF_EXEMPT and request.cookies.get(SESSION_COOKIE):
            cookie = request.cookies.get(CSRF_COOKIE, "")
            header = request.headers.get(CSRF_HEADER, "")
            if not cookie or not hmac.compare_digest(cookie, header):
                return _error(403, "csrf_failed", "Reload the page and try again.")
    return await call_next(request)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    if request.url.path.startswith("/api/") and not request.url.path.startswith("/api/docs"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


def _error(status_code: int, code: str, message: str, fields: dict | None = None) -> JSONResponse:
    body: dict = {"code": code, "message": message}
    if fields:
        body["fields"] = fields
    return JSONResponse(status_code=status_code, content=body)


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
    detail: Any = exc.detail  # starlette types it as str; ours carries a dict
    if isinstance(detail, dict) and "code" in detail:
        return _error(exc.status_code, str(detail["code"]), str(detail.get("message", "")))
    return _error(exc.status_code, "http_error", str(exc.detail))


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    fields: dict[str, str] = {}
    for err in exc.errors():
        loc = [str(p) for p in err.get("loc", []) if p not in ("body", "query", "path")]
        msg = str(err.get("msg", "Invalid value")).removeprefix("Value error, ")
        fields[".".join(loc) or "_"] = msg
    return _error(422, "validation_failed", "Some fields need fixing.", fields)


@app.exception_handler(Exception)
async def unhandled(_: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled error", exc_info=exc)
    return _error(500, "server_error", "Something failed on the server. Check the api logs.")


for r in (
    system.router,
    auth.router,
    blueprints.router,
    members.router,
    org.router,
    audit_log.router,
    ai_engine.router,
    agents.router,
    sops.router,
    tasks.router,
    broadcasts.router,
    brain.router,
    skills.router,
    office.router,
    monitor.router,
    channels.router,
    openai_compat.router,
    teams.router,
    overview.router,
    reports.router,
    vault.router,
    web_tasks.router,
    workflows.router,
    files.router,
    documents.router,
    packs.router,
    events_stream.router,
):
    app.include_router(r)
