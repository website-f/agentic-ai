"""P147: Microsoft 365 Copilot first, our AI engine for the rest.

Owner's decision (Fitri, 28 Nov 2026): "Copilot first (it costs us nothing for licensed users);
our AI engine only for big tasks Copilot can't handle; only for people connected via Microsoft
who have the subscription."

Where it hooks in: engine/gateway.chat asks `try_answer` before any model is called. It answers
only when ALL of these hold, else returns None and the engine runs exactly as before:
- the work is a person's own conversation with their own AI: agents/runtime.chat_turn marks
  its first model call with `for_person(...)` only when the person talking is the AI's owner
  and the AI is their twin or private assistant (never an agent working for a company or a
  shared context, never a task, a routine or background work: Microsoft's terms allow
  "human directed" use only);
- the call is task "agent.chat", asks for no JSON, carries no pictures, ends with the person's
  message, and either offers no tools or the person's message is a plain request (summarise,
  rewrite, translate, explain, draft a text...) with nothing that needs the office's tools
  (mail, Teams, calendar, tasks, files, Prima, the browser);
- the person's message and the conversation so far fit `max_prompt_chars`;
- the owner switched Copilot first on (Workspace.settings["copilot_first"]), the company's data
  level is not Local only, the approved-services lock (if on) allows "ai:copilot";
- the person is `ready` (microsoft/copilot.status: their own work account, Copilot allowed,
  licensed, not resting).
Copilot is asked as that person with their own delegated token only (never anyone else's).

Fallback to the engine, at once: any error, 401 (no_scope), 403 (no_licence), 429/503 (the
person's Copilot rests with a back-off), an empty or refusing answer, no answer within 45 s.

Privacy: the engine masks personal data before a cloud provider sees it (engine/privacy.py).
Copilot is NOT sent masked text: it runs inside the organisation's own Microsoft 365 tenant
(Microsoft's trust boundary, security-trimmed to what the person may already open), grounds its
answer on the person's own mail and files, and placeholders would break that grounding. It is
treated like a trusted provider: used for Standard and Confidential companies, never for Local
only ones.

Ledger: every Copilot attempt is a row in llm_calls with provider "copilot", cost 0, prompt and
completion 0 (nothing counts toward allowances or budgets) and, when it answered, saved_tokens:
what our engine would have used (characters / 4, 3.5 for Claude models, of everything the engine
call would have sent plus the answer). `model` is the engine model it replaced.
"""

import json
import logging
import re
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import acting, compliance, privacy, store
from .client import Usage

log = logging.getLogger("agentic.copilot_first")

PROVIDER = "copilot"
LABEL = "Microsoft 365 Copilot"
SERVICE = "ai:copilot"  # the approved-services lock's key (engine/compliance.py)
TASKS = frozenset({"agent.chat"})
INSTRUCTIONS_MAX = 4000  # our system prompt's head, as Copilot's extra context
TURNS_MAX = 12  # earlier turns of the conversation passed along


@dataclass(frozen=True)
class Route:
    """The model call is for this person, in this conversation, about this message."""

    user_id: str
    thread: str
    ask: str


_route: ContextVar[Route | None] = ContextVar("agentic_copilot_route", default=None)


def current() -> Route | None:
    return _route.get()


@contextmanager
def for_person(user_id: str, thread: str, ask: str) -> Iterator[None]:
    """Mark the model calls inside as a person's own conversation that may go to Copilot."""
    token = _route.set(Route(user_id, thread, ask))
    try:
        yield
    finally:
        _route.reset(token)


# ---------------------------------------------------------------- what Copilot may take

# Plain asks: an answer, a summary, a draft text, a rewrite, a translation (English and Malay).
_PLAIN = re.compile(
    r"\b(summari[sz]e|summary|sum up|tl;?dr|rewrite|re-?word|rephrase|paraphrase|translate|"
    r"translation|proofread|polish|shorten|simplify|explain|define|definition|draft|write|"
    r"compose|brainstorm|suggest|ideas?|outline|improve|correct|grammar|what is|what are|"
    r"what does|what's|who is|how (?:do|does|to|can|should)|why|meaning|tips|example|"
    r"ringkas\w*|rumus\w*|terjemah\w*|tulis\w*|karang\w*|terang\w*|jelas\w*|huraikan|apa itu|"
    r"apakah|bagaimana|kenapa|mengapa|maksud|betulkan|perbaiki|semak|cadang\w*|contoh)\b",
    re.I,
)
# Anything the office's own tools or data do: the engine (with its tools) answers.
_ACTION = re.compile(
    r"(https?://|www\.|@\w)|\b(send|email|e-mail|emails|mail|inbox|outlook|reply to|forward|"
    r"teams|chat with|message to|whatsapp|telegram|schedule|book|calendar|meeting|invite|"
    r"remind|reminder|tasks?|assign|approve|approval|reject|delete|remove|update|upload|"
    r"download|attach\w*|open|browse|website|eperolehan|tender|submit|prima|attendance|leave|"
    r"claims?|payroll|salary|payslip|invoice|files?|folder|library|documents?|sop|policy|"
    r"report|my pc|computer|remember|note this|save|create|add|search|find|look up|our|"
    r"hantar|emel|balas|jadual\w*|mesyuarat|ingatkan|tugasan|lulus\w*|tolak|padam|muat|"
    r"buka|cuti|kehadiran|tuntutan|gaji|simpan|ingat|cipta|tambah|fail|cari|dokumen|laporan|"
    r"polisi|kami)\b",
    re.I,
)


HEAD_CHARS = 200  # the instruction part of a message ("Summarise this: <pasted text>")


def plain_request(text: str) -> bool:
    """A request Copilot can answer on its own: a plain ask, nothing for the office's tools.
    Only the instruction is read (the first line, 200 characters at most), so a pasted text
    that mentions a meeting or an email can still be summarised or translated."""
    head = (text or "").strip().split("\n", 1)[0][:HEAD_CHARS]
    return bool(head) and bool(_PLAIN.search(head)) and not _ACTION.search(head)


def _text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            str(p.get("text") or "")
            for p in content
            if isinstance(p, dict) and p.get("type") == "text"
        )
    return ""


def _has_picture(messages: list[dict[str, Any]]) -> bool:
    return any(
        isinstance(m.get("content"), list)
        and any(isinstance(p, dict) and p.get("type") != "text" for p in m["content"])
        for m in messages
    )


def _chars(messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None) -> int:
    n = sum(len(_text(m.get("content"))) for m in messages)
    n += sum(
        len(json.dumps(m.get("tool_calls"), default=str)) for m in messages if m.get("tool_calls")
    )
    return n + (len(json.dumps(tools, default=str)) if tools else 0)


def estimate_tokens(chars: int, model: str) -> int:
    """About how many tokens `chars` characters are for `model` (no tokenizer here)."""
    per = 3.5 if "claude" in (model or "").lower() else 4.0
    return int(round(chars / per)) if chars > 0 else 0


def compose(messages: list[dict[str, Any]], limit: int) -> tuple[str, list[str]] | None:
    """(the message, extra context) for Copilot, or None when it does not fit `limit`: our
    instructions (the system prompt's head) and the conversation so far (text turns only, the
    latest first until the limit), then the person's message."""
    if not messages or messages[-1].get("role") != "user":
        return None
    ask = _text(messages[-1].get("content")).strip()
    if not ask or len(ask) > limit:
        return None
    system = "\n\n".join(_text(m.get("content")) for m in messages if m.get("role") == "system")
    turns: list[str] = []
    room = limit - len(ask)
    for m in reversed(messages[:-1]):
        role = m.get("role")
        if role not in ("user", "assistant") or m.get("tool_calls"):
            continue
        text = _text(m.get("content")).strip()
        if not text:
            continue
        line = f"{'Person' if role == 'user' else 'Assistant'}: {text}"
        if len(line) > room or len(turns) >= TURNS_MAX:
            break
        turns.append(line)
        room -= len(line)
    context: list[str] = []
    if system.strip():
        head = system.strip()[:INSTRUCTIONS_MAX]
        context.append(
            "You are answering as this person's own AI assistant in their office system. "
            "Follow these instructions from it where they apply (its tools are not available "
            "here; answer in text):\n" + head
        )
    if turns:
        context.append("The conversation so far:\n" + "\n".join(reversed(turns)))
    return ask, context


# ---------------------------------------------------------------- the attempt


@dataclass
class CopilotReply:
    content: str
    latency_ms: int
    saved_tokens: int
    instead_of: str


async def _instead_of(db: AsyncSession, workspace_id: str, group: str) -> str:
    """The engine model the call would have gone to first (for the ledger and the estimate)."""
    from ..models import ModelGroup

    g = await db.scalar(
        select(ModelGroup).where(ModelGroup.workspace_id == workspace_id, ModelGroup.name == group)
    )
    members = (g.members if g is not None else None) or []
    return str(members[0].get("model_id") or "") if members else ""


async def _record(
    workspace_id: str,
    *,
    group: str,
    task: str,
    model: str,
    latency_ms: int,
    ok: bool,
    agent_id: str | None,
    level: str,
    branch_id: str | None,
    error_class: str | None = None,
    detail: str | None = None,
    saved: int = 0,
) -> None:
    from decimal import Decimal

    await store.record_call(
        workspace_id=workspace_id,
        task=task,
        group=group,
        provider_id=None,
        provider_name=PROVIDER,
        model=model or "microsoft-365-copilot",
        usage=Usage(),
        latency_ms=latency_ms,
        ok=ok,
        error_class=error_class,
        error_detail=detail,
        cost=Decimal(0),
        agent_id=agent_id,
        branch_id=branch_id,
        data_level=level,
        saved_tokens=saved,
    )


ERROR_CLASS = {
    "throttled": "rate_limited",
    "forbidden": "forbidden",
    "unauthorized": "auth",
    "timeout": "slow",
    "empty": "unusable_reply",
    "error": "error",
}


async def try_answer(
    db: AsyncSession,
    workspace_id: str,
    group: str,
    messages: list[dict[str, Any]],
    *,
    task: str,
    **kw: Any,
) -> CopilotReply | None:
    """Copilot's answer for this model call, or None: the engine answers (see the module)."""
    route = current()
    if route is None or task not in TASKS:
        return None
    try:
        return await _try(db, workspace_id, group, messages, route, task=task, **kw)
    except Exception:  # noqa: BLE001 - Copilot must never break a chat: the engine answers
        log.warning("Copilot first failed; the engine answers", exc_info=True)
        return None


async def _try(
    db: AsyncSession,
    workspace_id: str,
    group: str,
    messages: list[dict[str, Any]],
    route: Route,
    *,
    task: str,
    tools: list[dict[str, Any]] | None = None,
    json_mode: bool = False,
    agent_id: str | None = None,
    branch_id: str | None = None,
    **_: Any,
) -> CopilotReply | None:
    from ..core.workspace_settings import copilot_first
    from ..microsoft import copilot
    from ..models import Workspace

    if json_mode or route.user_id != acting.current() or _has_picture(messages):
        return None
    if tools and not plain_request(route.ask):
        return None
    ws = await db.get(Workspace, workspace_id)
    if ws is None:
        return None
    cf = copilot_first(ws.settings)
    if not cf.on:
        return None
    asked = compose(messages, cf.max_prompt_chars)
    if asked is None:
        return None
    level, branch = await privacy.resolve_level(db, workspace_id, branch_id, agent_id, None)
    if level == "local_only":
        return None
    if not await compliance.allowed(db, workspace_id, SERVICE, LABEL, task):
        return None
    st = await copilot.status(db, workspace_id, route.user_id)
    if not st.ready or st.account is None:
        return None
    instead = await _instead_of(db, workspace_id, group)
    text, context = asked
    try:
        answer = await copilot.chat(db, st.account, route.thread, text, context, ws.timezone)
    except copilot.CopilotFailed as e:
        await _record(
            workspace_id, group=group, task=task, model=instead, latency_ms=e.latency_ms,
            ok=False, agent_id=agent_id, level=level, branch_id=branch,
            error_class=ERROR_CLASS.get(e.kind, "error"), detail=f"Copilot {e}",
        )  # fmt: skip
        return None
    content = answer.text
    if answer.sources:
        content += "\n\n" + "\n".join(f"- [{s['title']}]({s['url']})" for s in answer.sources)
    saved = estimate_tokens(_chars(messages, tools) + len(content), instead)
    await _record(
        workspace_id, group=group, task=task, model=instead, latency_ms=answer.latency_ms,
        ok=True, agent_id=agent_id, level=level, branch_id=branch, saved=saved,
    )  # fmt: skip
    return CopilotReply(content, answer.latency_ms, saved, instead)
