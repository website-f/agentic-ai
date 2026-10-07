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
from ..i18n import Msg, current_lang, normalize, render, reset_lang, set_lang, tr
from .deps import CSRF_COOKIE, CSRF_HEADER, LANG_HEADER, SESSION_COOKIE
from .routers import (
    agents,
    ai_engine,
    assistants,
    audit_log,
    auth,
    blueprints,
    brain,
    broadcasts,
    channels,
    company_files,
    documents,
    events_stream,
    files,
    impact,
    learning,
    library,
    mcp_servers,
    media,
    members,
    monitor,
    office,
    openai_compat,
    org,
    overview,
    packs,
    prefs,
    reports,
    skills,
    sops,
    staff,
    system,
    tasks,
    teams,
    tutorial,
    twins,
    vault,
    web_tasks,
    whatsapp,
    workflow_runs,
    workflows,
)

log = logging.getLogger("agentic.api")

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
# No session exists yet on these, so there is no CSRF cookie to compare against.
CSRF_EXEMPT = {"/api/auth/login", "/api/auth/setup", "/api/push/act"}
# File uploads send raw bytes. A cross-site form cannot send octet-stream either, so the
# JSON-only guarantee holds; the CSRF token is still checked.
RAW_UPLOAD_PATHS = {"/api/files", "/api/transcribe"}
WEBHOOK_PREFIX = "/api/whatsapp/hook/"


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
            return _error(415, "json_required", tr("Send requests as application/json."))
        # Signed webhooks (WhatsApp) never use the session cookie, so CSRF does not apply.
        exempt = path in CSRF_EXEMPT or path.startswith(WEBHOOK_PREFIX)
        if not exempt and request.cookies.get(SESSION_COOKIE):
            cookie = request.cookies.get(CSRF_COOKIE, "")
            header = request.headers.get(CSRF_HEADER, "")
            if not cookie or not hmac.compare_digest(cookie, header):
                return _error(403, "csrf_failed", tr("Reload the page and try again."))
    return await call_next(request)


class LanguageMiddleware:
    """P22: the language this request is answered in. X-Lang (the app's language) wins;
    without it, current_principal falls back to the person's saved preference; else English.
    Kept in a contextvar (deep code calls i18n.current_lang()) and on request.state."""

    def __init__(self, app_) -> None:
        self.app = app_

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        raw = dict(scope.get("headers") or []).get(LANG_HEADER.encode(), b"")
        lang = normalize(raw.decode("latin-1"))
        scope.setdefault("state", {})["lang"] = lang
        token = set_lang(lang)
        try:
            await self.app(scope, receive, send)
        finally:
            reset_lang(token)


def request_lang(request: Request) -> str:
    return normalize(getattr(request.state, "lang", None)) or current_lang()


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
async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
    detail: Any = exc.detail  # starlette types it as str; ours carries a dict
    lang = request_lang(request)
    if isinstance(detail, dict) and "code" in detail:
        message = render(detail.get("message", ""), lang)
        return _error(exc.status_code, str(detail["code"]), message)
    return _error(exc.status_code, "http_error", render(str(exc.detail), lang))


# Pydantic's own messages, by error type; ctx values fill the {vars}.
PYDANTIC_MESSAGES: dict[str, str] = {
    "missing": "Field required",
    "string_too_short": "Should have at least {min_length} characters",
    "string_too_long": "Should have at most {max_length} characters",
    "too_short": "Should have at least {min_length} items",
    "too_long": "Should have at most {max_length} items",
    "greater_than": "Should be greater than {gt}",
    "greater_than_equal": "Should be {ge} or more",
    "less_than": "Should be less than {lt}",
    "less_than_equal": "Should be {le} or less",
    "int_parsing": "Should be a whole number",
    "int_type": "Should be a whole number",
    "float_parsing": "Should be a number",
    "float_type": "Should be a number",
    "bool_parsing": "Should be true or false",
    "bool_type": "Should be true or false",
    "string_type": "Should be text",
    "list_type": "Should be a list",
    "dict_type": "Should be an object",
    "enum": "Should be one of: {expected}",
    "literal_error": "Should be one of: {expected}",
    "extra_forbidden": "Not a known field",
    "json_invalid": "Not valid JSON",
    "url_parsing": "Not a valid web address",
    "datetime_parsing": "Not a valid date and time",
    "datetime_from_date_parsing": "Not a valid date and time",
    "date_parsing": "Not a valid date",
    "uuid_parsing": "Not a valid id",
}


def _field_message(err: dict[str, Any], lang: str) -> str:
    """One field's problem in the request's language. Our validators raise ValueError with
    a Msg (or plain English with a known template); pydantic's own go by error type."""
    ctx = err.get("ctx") or {}
    cause = ctx.get("error")
    if isinstance(cause, BaseException) and cause.args and isinstance(cause.args[0], str):
        return render(cause.args[0], lang)
    template = PYDANTIC_MESSAGES.get(str(err.get("type", "")))
    if template is not None and lang != "en":
        values = {k: v for k, v in ctx.items() if isinstance(v, (str, int, float))}
        return Msg(template, **values).render(lang)
    msg = str(err.get("msg", "Invalid value")).removeprefix("Value error, ")
    return render(msg, lang)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    lang = request_lang(request)
    fields: dict[str, str] = {}
    for err in exc.errors():
        loc = [str(p) for p in err.get("loc", []) if p not in ("body", "query", "path")]
        fields[".".join(loc) or "_"] = _field_message(err, lang)
    return _error(422, "validation_failed", tr("Some fields need fixing.", lang), fields)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled error", exc_info=exc)
    return _error(
        500,
        "server_error",
        tr("Something failed on the server. Check the api logs.", request_lang(request)),
    )


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
    company_files.router,  # P24: before files, so /api/files/tree is not read as a file id
    files.router,
    documents.router,
    packs.router,
    mcp_servers.router,
    workflow_runs.router,
    whatsapp.router,
    assistants.router,
    learning.router,
    events_stream.router,
    media.router,
    twins.router,
    library.router,
    prefs.router,
    tutorial.router,
    staff.router,
    impact.router,
):
    app.include_router(r)

# Outermost, so even the CSRF and JSON checks answer in the person's language.
app.add_middleware(LanguageMiddleware)

# Meeting minutes from a recording: the upload streams raw bytes like /api/files.
from .routers import minutes as minutes_router  # noqa: E402

RAW_UPLOAD_PATHS.add(minutes_router.UPLOAD_PATH)
app.include_router(minutes_router.router)

# P21: company objectives (why work matters, progress and cost per objective).
from .routers import objectives as objectives_router  # noqa: E402

app.include_router(objectives_router.router)

# P24: the AI drafts SOPs and workflows from company documents (and builds suggestions).
from .routers import builders as builders_router  # noqa: E402

app.include_router(builders_router.router)

# P24: company documents intake (zip / many files / one file); raw bytes like /api/files.
from .routers import intake as intake_router  # noqa: E402

RAW_UPLOAD_PATHS.add(intake_router.UPLOAD_PATH)
app.include_router(intake_router.router)

# P25: search inside every document (files page by page, SOPs, documents), with suggestions.
from .routers import search as search_router  # noqa: E402

app.include_router(search_router.router)

# P26: each person's workspace (desk).
from .routers import desk as desk_router  # noqa: E402

RAW_UPLOAD_PATHS.add("/api/desk/files")
app.include_router(desk_router.router)

# P27: company forms people fill in and hand back by a deadline.
from .routers import forms as forms_router  # noqa: E402

app.include_router(forms_router.router)

# Members from an Excel or CSV sheet: the sheet arrives as raw bytes like /api/files.
from .routers import member_import as member_import_router  # noqa: E402

RAW_UPLOAD_PATHS.add(member_import_router.UPLOAD_PATH)
app.include_router(member_import_router.router)

# Task flow: a task into a workflow or a schedule, and the person's recent chats.
from .routers import task_flow as task_flow_router  # noqa: E402

app.include_router(task_flow_router.router)
