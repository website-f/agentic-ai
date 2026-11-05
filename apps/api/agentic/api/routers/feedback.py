"""P73 feedback: the floating button on every page, and the developer's Feedbacks page.

Everyone signed in (any role) may send feedback while the developer has it switched on: a
note about the page they are on, optionally with a screenshot of it carrying their own marks
(circles, arrows, lines). The screenshot is made in the browser from the page itself, so it
only shows what that person already sees. The developer (an owner the operator marked,
deps.is_developer) reads every piece, moves it along and can answer; each sender sees their
own pieces, the status and the answer. The developer also writes the house rules everyone
reads from the same button, next to what each page is for.

The switch and the rules live in the workspace settings: settings["feedback"] =
{"enabled": bool, "rules": [{"id", "title", "body", "page"}]}.
"""

import base64
import binascii
import re
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer
from sqlalchemy.orm.attributes import flag_modified

from ...core.db import get_db
from ...core.ids import new_id
from ...core.valkey import valkey
from ...feedback.models import Feedback
from ...models import Workspace
from ...services import audit, events
from ..deps import (
    Principal,
    api_error,
    current_principal,
    is_developer,
    require_developer,
)

router = APIRouter(prefix="/api/feedback", tags=["feedback"])

Kind = Literal["screenshot", "general"]
Category = Literal["bug", "confusing", "not_needed", "idea", "praise", "other"]
Status = Literal["new", "planned", "in_progress", "done", "wont_do"]

MAX_SHOT_BYTES = 6 * 1024 * 1024  # a full-HD page as PNG fits; JPEG is far smaller
# Base64 is 4/3 of the bytes, plus the "data:image/...;base64," head.
MAX_SHOT_CHARS = MAX_SHOT_BYTES * 4 // 3 + 64
PER_HOUR = 40  # pieces one person may send in an hour (a typo loop, not a real limit)
MAX_RULES = 60
_DATA_URL = re.compile(r"^data:(image/(?:png|jpeg|webp));base64,", re.ASCII)
# What the file really is, whatever the data URL claims.
_MAGIC = {
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/webp": (b"RIFF",),
}


# ------------------------------------------------------------------ settings in the workspace


def _settings(ws: Workspace) -> dict[str, Any]:
    raw = (ws.settings or {}).get("feedback")
    return raw if isinstance(raw, dict) else {}


def _rules(ws: Workspace) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for r in _settings(ws).get("rules") or []:
        if isinstance(r, dict) and r.get("id") and (r.get("title") or r.get("body")):
            out.append(
                {
                    "id": str(r["id"]),
                    "title": str(r.get("title") or ""),
                    "body": str(r.get("body") or ""),
                    "page": str(r.get("page") or ""),
                }
            )
    return out


async def _workspace(db: AsyncSession, principal: Principal) -> Workspace:
    ws = await db.get(Workspace, principal.workspace_id)
    if ws is None:  # the session outlived its workspace (erased)
        raise api_error(status.HTTP_404_NOT_FOUND, "not_found", "Not found.")
    return ws


class RuleIn(BaseModel):
    id: str | None = Field(default=None, max_length=40)
    title: str = Field(default="", max_length=160)
    body: str = Field(default="", max_length=2000)
    # The page it is about ("/tasks"), or empty for every page.
    page: str = Field(default="", max_length=200)


class ConfigOut(BaseModel):
    enabled: bool
    developer: bool
    rules: list[dict[str, str]]


class ConfigIn(BaseModel):
    enabled: bool | None = None
    rules: list[RuleIn] | None = Field(default=None, max_length=MAX_RULES)


@router.get("/config")
async def get_config(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> ConfigOut:
    """Is the button on, is this person the developer, and the house rules (for everyone)."""
    ws = await _workspace(db, principal)
    return ConfigOut(
        enabled=bool(_settings(ws).get("enabled")),
        developer=is_developer(principal.user, principal.role),
        rules=_rules(ws),
    )


@router.put("/config")
async def put_config(
    body: ConfigIn,
    principal: Principal = Depends(require_developer),
    db: AsyncSession = Depends(get_db),
) -> ConfigOut:
    ws = await _workspace(db, principal)
    before = _settings(ws)
    now = dict(before)
    if body.enabled is not None:
        now["enabled"] = body.enabled
    if body.rules is not None:
        rules = []
        for r in body.rules:
            title, text, page = r.title.strip(), r.body.strip(), r.page.strip()
            if not title and not text:
                continue
            if page and not page.startswith("/"):
                page = "/" + page
            rules.append({"id": r.id or new_id("rl"), "title": title, "body": text, "page": page})
        now["rules"] = rules
    ws.settings = {**(ws.settings or {}), "feedback": now}
    flag_modified(ws, "settings")
    await audit.record(
        db,
        ws.id,
        principal.actor,
        "feedback.config",
        before={"enabled": bool(before.get("enabled")), "rules": len(before.get("rules") or [])},
        after={"enabled": bool(now.get("enabled")), "rules": len(now.get("rules") or [])},
    )
    await db.commit()
    return ConfigOut(enabled=bool(now.get("enabled")), developer=True, rules=_rules(ws))


# ------------------------------------------------------------------ sending


class ContextIn(BaseModel):
    viewport: str = Field(default="", max_length=40)  # "1440x900"
    language: str = Field(default="", max_length=10)
    theme: str = Field(default="", max_length=10)
    browser: str = Field(default="", max_length=400)
    company: str = Field(default="", max_length=120)


class FeedbackIn(BaseModel):
    kind: Kind
    category: Category = "other"
    note: str = Field(default="", max_length=4000)
    page_path: str = Field(default="", max_length=500)
    page_title: str = Field(default="", max_length=200)
    marks: int = Field(default=0, ge=0, le=500)
    screenshot: str | None = Field(default=None, max_length=MAX_SHOT_CHARS)
    context: ContextIn = Field(default_factory=ContextIn)


def _decode_shot(data_url: str) -> tuple[bytes, str]:
    m = _DATA_URL.match(data_url)
    if not m:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "bad_screenshot",
            "The screenshot must be a PNG, JPEG or WebP image.",
        )
    mime = m.group(1)
    try:
        raw = base64.b64decode(data_url[m.end() :], validate=True)
    except (binascii.Error, ValueError) as e:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "bad_screenshot",
            "The screenshot must be a PNG, JPEG or WebP image.",
        ) from e
    if len(raw) > MAX_SHOT_BYTES:
        raise api_error(
            status.HTTP_413_CONTENT_TOO_LARGE,
            "screenshot_too_large",
            "That screenshot is too large (6 MB at most).",
        )
    ok = any(raw.startswith(sig) for sig in _MAGIC[mime])
    if mime == "image/webp":
        ok = ok and raw[8:12] == b"WEBP"
    if not ok:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "bad_screenshot",
            "The screenshot must be a PNG, JPEG or WebP image.",
        )
    return raw, mime


class SentOut(BaseModel):
    id: str
    status: str


@router.post("", status_code=status.HTTP_201_CREATED)
async def send(
    body: FeedbackIn,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> SentOut:
    ws = await _workspace(db, principal)
    if not _settings(ws).get("enabled"):
        raise api_error(
            status.HTTP_403_FORBIDDEN, "feedback_off", "Feedback is switched off right now."
        )
    note = body.note.strip()
    shot: tuple[bytes, str] | None = None
    if body.kind == "screenshot":
        if not body.screenshot:
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "screenshot_missing",
                "Take the screenshot first, or send it as general feedback.",
            )
        shot = _decode_shot(body.screenshot)
    elif len(note) < 3:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "note_missing",
            "Write a few words about what you noticed.",
        )
    key = f"feedback:{principal.workspace_id}:{principal.user.id}"
    count = int(await valkey().incr(key))
    if count == 1:
        await valkey().expire(key, 3600)
    if count > PER_HOUR:
        raise api_error(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "too_much_feedback",
            "That is a lot of feedback in one hour. Thank you! Try again a little later.",
        )
    fb = Feedback(
        id=new_id("fb"),
        workspace_id=ws.id,
        user_id=principal.user.id,
        author_name=principal.user.name[:120],
        author_role=principal.role,
        kind=body.kind,
        category=body.category,
        note=note,
        page_path=body.page_path.strip()[:500],
        page_title=body.page_title.strip()[:200],
        marks=body.marks if shot else 0,
        context={k: v for k, v in body.context.model_dump().items() if v},
        screenshot=shot[0] if shot else None,
        screenshot_type=shot[1] if shot else None,
        status="new",
        dev_note="",
    )
    db.add(fb)
    await audit.record(
        db,
        ws.id,
        principal.actor,
        "feedback.sent",
        target=fb.id,
        after={"kind": fb.kind, "category": fb.category, "page": fb.page_path},
    )
    await db.commit()
    await events.publish(ws.id, "feedback.new", {"id": fb.id})
    return SentOut(id=fb.id, status=fb.status)


# ------------------------------------------------------------------ reading


class MineOut(BaseModel):
    id: str
    kind: str
    category: str
    note: str
    page_path: str
    page_title: str
    status: str
    dev_note: str
    has_screenshot: bool
    created_at: datetime
    updated_at: datetime


class FeedbackOut(MineOut):
    user_id: str | None
    author_name: str
    author_email: str | None
    author_role: str
    marks: int
    context: dict[str, Any]
    screenshot_bytes: int
    handled_by: str | None
    resolved_at: datetime | None


class ListOut(BaseModel):
    items: list[FeedbackOut]
    counts: dict[str, int]
    total: int


def _mine(f: Feedback, size: int | None) -> dict[str, Any]:
    return {
        "id": f.id,
        "kind": f.kind,
        "category": f.category,
        "note": f.note,
        "page_path": f.page_path,
        "page_title": f.page_title,
        "status": f.status,
        "dev_note": f.dev_note,
        "has_screenshot": bool(size),
        "created_at": f.created_at,
        "updated_at": f.updated_at,
    }


@router.get("/mine")
async def mine(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> list[MineOut]:
    """What this person sent, newest first, with where each one stands."""
    size = func.coalesce(func.octet_length(Feedback.screenshot), 0)
    rows = (
        await db.execute(
            select(Feedback, size)
            .where(
                Feedback.workspace_id == principal.workspace_id,
                Feedback.user_id == principal.user.id,
            )
            .order_by(Feedback.created_at.desc())
            .limit(50)
        )
    ).all()
    return [MineOut(**_mine(f, n)) for f, n in rows]


@router.get("")
async def list_feedback(
    status_: Status | None = Query(default=None, alias="status"),
    category: Category | None = Query(default=None),
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=200, ge=1, le=500),
    principal: Principal = Depends(require_developer),
    db: AsyncSession = Depends(get_db),
) -> ListOut:
    from ...models import User

    size = func.coalesce(func.octet_length(Feedback.screenshot), 0)
    base = [Feedback.workspace_id == principal.workspace_id]
    if category:
        base.append(Feedback.category == category)
    if q and q.strip():
        like = f"%{q.strip().replace('%', r'\%').replace('_', r'\_')}%"
        base.append(
            or_(
                Feedback.note.ilike(like),
                Feedback.page_path.ilike(like),
                Feedback.page_title.ilike(like),
                Feedback.author_name.ilike(like),
            )
        )
    counts = {
        s: n
        for s, n in (
            await db.execute(
                select(Feedback.status, func.count()).where(*base).group_by(Feedback.status)
            )
        ).all()
    }
    where = [*base, Feedback.status == status_] if status_ else base
    rows = (
        await db.execute(
            select(Feedback, size, User.email)
            .outerjoin(User, User.id == Feedback.user_id)
            .where(*where)
            .order_by(Feedback.created_at.desc())
            .limit(limit)
        )
    ).all()
    items = [
        FeedbackOut(
            **_mine(f, n),
            user_id=f.user_id,
            author_name=f.author_name,
            author_email=email,
            author_role=f.author_role,
            marks=f.marks,
            context=f.context or {},
            screenshot_bytes=int(n or 0),
            handled_by=f.handled_by,
            resolved_at=f.resolved_at,
        )
        for f, n, email in rows
    ]
    return ListOut(items=items, counts=counts, total=sum(counts.values()))


async def _one(db: AsyncSession, principal: Principal, fid: str, shot: bool = False) -> Feedback:
    stmt = select(Feedback).where(
        Feedback.id == fid, Feedback.workspace_id == principal.workspace_id
    )
    if shot:
        stmt = stmt.options(undefer(Feedback.screenshot))
    fb = await db.scalar(stmt)
    if fb is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "not_found", "That feedback is not here.")
    return fb


@router.get("/{fid}/screenshot")
async def screenshot(
    fid: str,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """The developer sees every screenshot; a sender sees their own."""
    fb = await _one(db, principal, fid, shot=True)
    if not is_developer(principal.user, principal.role) and fb.user_id != principal.user.id:
        raise api_error(status.HTTP_404_NOT_FOUND, "not_found", "That feedback is not here.")
    if not fb.screenshot:
        raise api_error(status.HTTP_404_NOT_FOUND, "not_found", "That feedback has no screenshot.")
    return Response(
        content=fb.screenshot,
        media_type=fb.screenshot_type or "image/png",
        headers={
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": f'inline; filename="feedback-{fb.id}.'
            + ("jpg" if fb.screenshot_type == "image/jpeg" else "png")
            + '"',
        },
    )


class FeedbackPatch(BaseModel):
    status: Status | None = None
    dev_note: str | None = Field(default=None, max_length=4000)


@router.patch("/{fid}")
async def update(
    fid: str,
    body: FeedbackPatch,
    principal: Principal = Depends(require_developer),
    db: AsyncSession = Depends(get_db),
) -> MineOut:
    fb = await _one(db, principal, fid)
    before = {"status": fb.status, "answered": bool(fb.dev_note)}
    if body.status is not None and body.status != fb.status:
        fb.status = body.status
        fb.resolved_at = datetime.now(UTC) if body.status in ("done", "wont_do") else None
    if body.dev_note is not None:
        fb.dev_note = body.dev_note.strip()
    fb.handled_by = principal.user.id
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "feedback.update",
        target=fb.id,
        before=before,
        after={"status": fb.status, "answered": bool(fb.dev_note)},
    )
    await db.commit()
    await db.refresh(fb)
    await events.publish(principal.workspace_id, "feedback.updated", {"id": fb.id})
    size = await db.scalar(
        select(func.coalesce(func.octet_length(Feedback.screenshot), 0)).where(Feedback.id == fb.id)
    )
    return MineOut(**_mine(fb, size))


@router.delete("/{fid}", status_code=status.HTTP_204_NO_CONTENT)
async def remove(
    fid: str,
    principal: Principal = Depends(require_developer),
    db: AsyncSession = Depends(get_db),
) -> Response:
    fb = await _one(db, principal, fid)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "feedback.delete",
        target=fb.id,
        before={"kind": fb.kind, "category": fb.category, "page": fb.page_path},
    )
    await db.delete(fb)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
