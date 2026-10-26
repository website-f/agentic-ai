"""P36: the work-scope guard. Staff use their AI for their work at the company, not for
homework, games or anything else; the owner says what counts as work.

Checked before any work starts for a person whose role the guard covers (staff by default):
a chat message to their AI (runtime.chat_turn) and a task or schedule they give (api deps
`ensure_work_scope`). In order:
1. Attempts to talk the AI out of its rules ("ignore your instructions") are refused.
2. Short follow-ups ("ok", "yes, send it") pass: they continue work already allowed.
3. A cheap model judges the rest against the company and the owner's description of the
   work; when unsure, or when no model answers, it is work (the guard never blocks real work
   because the AI is down). Verdicts are remembered for a day.
A refusal is written to the activity log, so the owner sees who tried what.

Workspace setting `work_scope`: {"enabled": true, "roles": ["staff"], "about": "..."}.
"""

import hashlib
import json
import logging
import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.valkey import valkey
from ..engine import gateway
from ..i18n import tr
from ..models import Branch, Membership, Workspace
from ..services import audit

log = logging.getLogger("agentic.scope_guard")

DEFAULT_ROLES = ("staff",)
MIN_CHARS = 25  # shorter messages continue a conversation the guard already let through
CACHE_SECONDS = 86400
MAX_ABOUT = 1500

# Attempts to switch the rules off: never work, whoever asks.
_JAILBREAK = re.compile(
    r"\b(ignore|disregard|forget|override)\s+(all\s+|any\s+|the\s+|your\s+|my\s+|of\s+)*"
    r"(previous\s+|prior\s+|above\s+|earlier\s+|system\s+)*(instructions|rules|prompts?)"
    r"|\b(developer|god|jailbreak|dan)\s+mode\b"
    r"|pretend (you are|to be) (not an ai|unrestricted|without (rules|limits))"
    r"|\babaikan\s+(semua\s+)?(arahan|peraturan)",
    re.IGNORECASE,
)


@dataclass
class Verdict:
    ok: bool
    why: str = ""


def settings_of(ws: Workspace) -> tuple[bool, tuple[str, ...], str]:
    raw: dict[str, Any] = (ws.settings or {}).get("work_scope") or {}
    roles = raw.get("roles", DEFAULT_ROLES)
    if not isinstance(roles, list | tuple):
        roles = DEFAULT_ROLES
    return (
        bool(raw.get("enabled", True)),
        tuple(str(r) for r in roles),
        str(raw.get("about") or "")[:MAX_ABOUT],
    )


async def applies(db: AsyncSession, ws: Workspace, user_id: str | None) -> Membership | None:
    """The person's membership when the guard covers them, else None."""
    enabled, roles, _ = settings_of(ws)
    if not enabled or not user_id:
        return None
    m = await db.scalar(
        select(Membership).where(Membership.workspace_id == ws.id, Membership.user_id == user_id)
    )
    return m if m is not None and m.role in roles else None


def refusal(why: str = "", lang: str | None = None) -> str:
    base = tr(
        "That looks outside your work here, so I will not do it. I am for your work at the "
        "company: its customers, documents, procedures and your own tasks. If it is for work, "
        "say how it connects to your job and ask again.",
        lang,
    )
    return f"{base} ({why})" if why else base


async def _company(db: AsyncSession, m: Membership, ws: Workspace) -> str:
    b = await db.get(Branch, m.branch_id) if m.branch_id else None
    if b is None:
        return ws.name
    return f"{b.name} ({b.industry} business)" if b.industry else b.name


def _parse(raw: str) -> Verdict | None:
    try:
        d = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(d, dict) or not isinstance(d.get("work"), bool):
        return None
    return Verdict(bool(d["work"]), str(d.get("why") or "")[:200])


async def judge(db: AsyncSession, ws: Workspace, m: Membership, text: str) -> Verdict:
    """Is this work? Never raises: anything that goes wrong is work."""
    text = (text or "").strip()
    if _JAILBREAK.search(text):
        return Verdict(False, "it asks the AI to ignore its rules")
    if len(text) < MIN_CHARS:
        return Verdict(True)
    _, _, about = settings_of(ws)
    company = await _company(db, m, ws)
    key = "scope:" + hashlib.sha256(f"{ws.id}|{company}|{about}|{text}".encode()).hexdigest()[:32]
    try:
        hit = await valkey().get(key)
    except Exception:  # noqa: BLE001 - no cache: judge again
        hit = None
    if isinstance(hit, str) and (v := _parse(hit)) is not None:
        return v
    prompt = [
        {
            "role": "system",
            "content": (
                "You check whether a request an employee gives their work AI is about their "
                f"job at {company}. "
                + (f"The owner says the AI is for: {about}. " if about else "")
                + "Work includes anything plausibly connected to the business: customers, "
                "suppliers, sales, documents, procedures, office admin, finance, HR, writing "
                "work messages, research or learning for the job. Not work: homework, "
                "personal shopping or investing, entertainment, games, dating, personal "
                "writing, anything harmful or illegal. When unsure, it is work. Answer only "
                'JSON: {"work": true or false, "why": "a few words"}.'
            ),
        },
        {"role": "user", "content": text[:4000]},
    ]
    try:
        r = await gateway.chat_first(
            db,
            ws.id,
            ("fast",),
            prompt,
            task="scope.check",
            json_mode=True,
            max_tokens=60,
            temperature=0,
            accept=lambda raw: _parse(raw) is not None,
        )
    except gateway.GatewayUnavailable:
        return Verdict(True)
    v = _parse(r.content) or Verdict(True)
    try:
        await valkey().set(key, json.dumps({"work": v.ok, "why": v.why}), ex=CACHE_SECONDS)
    except Exception:  # noqa: BLE001
        log.debug("scope verdict not cached", exc_info=True)
    return v


async def check(
    db: AsyncSession, ws: Workspace, user_id: str | None, text: str, where: str
) -> Verdict:
    """Judge `text` for this person, and log a refusal. Commits only when it refuses."""
    m = await applies(db, ws, user_id)
    if m is None:
        return Verdict(True)
    v = await judge(db, ws, m, text)
    if not v.ok:
        await audit.record(
            db,
            ws.id,
            f"user:{user_id}",
            "ai.out_of_scope",
            target=user_id,
            after={"where": where, "text": text[:300], "why": v.why},
        )
        await db.commit()
    return v
