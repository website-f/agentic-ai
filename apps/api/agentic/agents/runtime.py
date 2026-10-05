"""The agent loop. Each call to `run_task_step` is one Temporal activity: it loads the task's
conversation from Postgres, lets the model think and call tools, and stops when it has a
final answer, needs a person (approval or question), or used its step allowance.

All state lives in the database, so a crashed worker simply re-runs the step.
"""

import asyncio
import json
import logging
import re
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..assistants.names import ASSISTANT_ONLY
from ..brain import core as core_memory
from ..brain.recall import recall_block
from ..core.config import settings
from ..core.db import SessionLocal
from ..core.redact import redact
from ..core.workspace_settings import max_task_model_calls
from ..engine import gateway
from ..i18n import explicit_lang
from ..i18n import notes as lang_notes
from ..models import (
    Agent,
    AgentMessage,
    Approval,
    ChatSession,
    Meeting,
    Task,
    TaskEvent,
    User,
    Workspace,
)
from ..services import events, prefs
from ..skills import store as skills_store
from ..teams import budget, colleague, delegation, meetings, objectives
from . import compress, context, goals, policy, verify
from .prompt import system_prompt
from .tools import GLOBAL_DENY, TOOLS, ToolContext, modes_for

log = logging.getLogger("agentic.runtime")

MAX_CALLS_PER_STEP = 6
# Room for a long final answer or a big report in one reply (billed only for what is
# written). 1,500 cut a 34-row report off mid-call, and the fallback model then claimed it
# was done.
TASK_REPLY_TOKENS = 4000
APPROVAL_TTL = timedelta(hours=24)
TOOL_TIMEOUT = 45
BROWSER_ERROR_LIMIT = 3


@dataclass
class StepResult:
    state: str  # done | needs_approval | failed | continue | delegate | meeting
    message: str | None = None
    approval_id: str | None = None
    timeout_seconds: int = 0
    # P7: the workflow runs these, then hands the result back as the tool call's answer.
    call_id: str | None = None
    children: list[dict[str, str]] | None = None  # [{task_id, workflow_id}]
    meeting_id: str | None = None

    def dict(self) -> dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------- persistence helpers


def _now() -> datetime:
    return datetime.now(UTC)


def to_openai(m: AgentMessage) -> dict[str, Any]:
    d: dict[str, Any] = {"role": m.role, "content": m.content}
    if m.role == "assistant" and m.tool_calls:
        d["tool_calls"] = m.tool_calls
    reasoning = (m.meta or {}).get("reasoning_content")
    if m.role == "assistant" and reasoning:
        # The engine sends it back only to models that need it (engine/client.py).
        d["reasoning_content"] = reasoning
    if m.role == "tool":
        d["tool_call_id"] = m.tool_call_id
        if m.name:
            d["name"] = m.name
    return d


async def _history(
    db: AsyncSession, *, task_id: str | None = None, session_id: str | None = None
) -> list[AgentMessage]:
    q = select(AgentMessage)
    q = (
        q.where(AgentMessage.task_id == task_id)
        if task_id
        else q.where(AgentMessage.session_id == session_id)
    )
    return list((await db.scalars(q.order_by(AgentMessage.id))).all())


def _add(
    db: AsyncSession,
    agent: Agent,
    role: str,
    *,
    task_id: str | None = None,
    session_id: str | None = None,
    content: str | None = None,
    tool_calls: list[dict[str, Any]] | None = None,
    tool_call_id: str | None = None,
    name: str | None = None,
    meta: dict[str, Any] | None = None,
) -> AgentMessage:
    m = AgentMessage(
        workspace_id=agent.workspace_id,
        agent_id=agent.id,
        task_id=task_id,
        session_id=session_id,
        role=role,
        content=content,
        tool_calls=tool_calls,
        tool_call_id=tool_call_id,
        name=name,
        meta=meta,
        created_at=_now(),
    )
    db.add(m)
    return m


def task_query(task: Task) -> str:
    """The words a compressor ranks rows by: what the job is about."""
    return f"{task.title}\n{task.brief or ''}"


async def _add_tool_result(
    db: AsyncSession,
    agent: Agent,
    *,
    call_id: str,
    name: str,
    content: str,
    query: str,
    args: dict[str, Any] | None = None,
    task_id: str | None = None,
    session_id: str | None = None,
) -> AgentMessage:
    """Store a tool result: the original in `content` (transcripts, the UI, expand_result) and,
    for a big one, the shortened text the model is sent in meta["compressed"] (compress.py)."""
    m = _add(
        db,
        agent,
        "tool",
        task_id=task_id,
        session_id=session_id,
        content=content,
        tool_call_id=call_id,
        name=name,
    )
    if len(content or "") >= compress.MIN_CHARS:
        await db.flush()  # the id goes into the marker that points at expand_result
        words = " ".join(str(v) for v in (args or {}).values() if isinstance(v, str))
        meta = compress.prepare(content, tool=name, query=query, extra=words, message_id=m.id)
        if meta:
            m.meta = meta
    return m


async def task_event(
    db: AsyncSession,
    task: Task,
    kind: str,
    actor: str,
    text: str,
    data: dict[str, Any] | None = None,
) -> None:
    db.add(TaskEvent(task_id=task.id, ts=_now(), kind=kind, actor=actor, text=text, data=data))
    await db.commit()
    await events.publish(
        task.workspace_id,
        "task.event",
        {
            "task_id": task.id,
            "agent_id": task.assignee_agent_id,
            "kind": kind,
            "actor": actor,
            "text": text,
            "tool": (data or {}).get("tool"),
        },
    )


async def set_task_status(
    db: AsyncSession,
    task: Task,
    status: str,
    *,
    actor: str = "system",
    note: str | None = None,
    **fields: Any,
) -> None:
    before = task.status
    task.status = status
    # P21: who moves it next is part of the state it is in; a move that does not name one
    # clears the previous owner and action (blocked/review set them explicitly).
    fields.setdefault("blocked_owner", None)
    fields.setdefault("blocked_action", None)
    for k, v in fields.items():
        setattr(task, k, v)
    await db.commit()
    if before != status:
        await task_event(
            db,
            task,
            "status",
            actor,
            note or f"moved it from {before} to {status}",
            {"from": before, "to": status},
        )
    await events.publish(
        task.workspace_id,
        "task.updated",
        {"task_id": task.id, "status": status, "assignee_agent_id": task.assignee_agent_id},
    )


async def agent_thinking(agent: Agent, on: bool) -> None:
    """A model call is in flight (the office shows a "..." bubble). Overlay, not a state."""
    await events.publish(agent.workspace_id, "agent.thinking", {"agent_id": agent.id, "on": on})


def _brief(value: Any, limit: int = 300) -> str:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    text = redact(text)
    return text if len(text) <= limit else text[: limit - 1] + "…"


async def activity(agent: Agent, task: Task | None, kind: str, **data: Any) -> None:
    """One line of what an agent is doing, for the live monitor (persisted for replay).
    kind: think | tool_call | tool_result | answer | ask | browser | wait"""
    await events.publish(
        agent.workspace_id,
        "agent.activity",
        {
            "agent_id": agent.id,
            "agent_name": agent.name,
            "task_id": task.id if task else None,
            "task_title": task.title if task else None,
            "kind": kind,
            **data,
        },
    )


async def agent_status(agent: Agent, status: str, task: Task | None = None) -> None:
    """Live state for the dashboard and, later, the office view."""
    await events.publish(
        agent.workspace_id,
        "agent.status",
        {
            "agent_id": agent.id,
            "status": status,
            "task": {"id": task.id, "title": task.title} if task else None,
        },
    )


ASK_NUDGE = (
    "Your answer ends with a question for the person, but a task's final answer closes "
    "the task and nobody will reply to it. If you need their answer before you can finish, "
    "call ask_human now (with options if it is a choice). If not, give your final answer "
    "without the question."
)


WORK_NUDGE = (
    "Your answer says you will still do some of the work, but a final answer closes the "
    "task: nothing happens after it. Do that work now with your tools (split_work if there "
    "are many items), then give the final answer. If you cannot, say plainly what is left "
    "and why."
)
# "I'm now opening all 34 messages and will report them" closes a task with the work undone.
_PROMISE = re.compile(
    r"\b(i'll|i will|i am going to|i'm going to|i am now|i'm now|i'll do that next|"
    r"next,? i(?:'ll| will))\b[^.?!\n]{0,80}\b(open|do|start|check|read|go through|"
    r"continue|proceed|compile|prepare|report|send|fill|look)",
    re.I,
)


def promises_more_work(text: str | None) -> bool:
    return bool(_PROMISE.search((text or "").replace("\u2019", "'")))


def ends_with_question(text: str | None) -> bool:
    """The last line of an answer is a question (what an agent does instead of ask_human)."""
    lines = [ln.strip().strip("*_>#` ").strip() for ln in (text or "").splitlines()]
    last = next((ln for ln in reversed(lines) if ln), "")
    return last.endswith("?")


def _count(n: int, word: str) -> str:
    return f"{n} {word}" + ("" if n == 1 else "s")


def _parse_args(raw: Any) -> tuple[dict[str, Any] | None, str | None]:
    if isinstance(raw, dict):
        return raw, None
    try:
        val = json.loads(raw or "{}")
    except (TypeError, ValueError):
        return None, "The tool arguments were not valid JSON. Try again with valid JSON."
    return (val, None) if isinstance(val, dict) else (None, "Tool arguments must be a JSON object.")


async def run_tool(ctx: ToolContext, name: str, args: dict[str, Any]) -> str:
    try:
        return await asyncio.wait_for(TOOLS[name].handler(ctx, args), timeout=TOOL_TIMEOUT)
    except TimeoutError:
        return f"Error: {TOOLS[name].label} took longer than {TOOL_TIMEOUT} s."
    except Exception as e:  # noqa: BLE001 - a broken tool must not kill the task
        log.warning("tool %s failed", name, exc_info=True)
        return f"Error: {TOOLS[name].label} failed ({e.__class__.__name__}: {e})."


HELP_HINT = (
    "\n\n[Tip: if this is outside your expertise, do not keep retrying. A colleague can check it "
    "for you: ask_colleague(agent='<the expertise you need, e.g. software engineer>', "
    "kind='help', question='<what you need>', context='<what you tried and the exact error>'). "
    "Fixes are saved as lessons, so the office learns it once.]"
)
_FAILED = re.compile(r"Traceback \(most recent call last\)|Exit code: -?[1-9]")
_NO_HINT = frozenset({"ask_colleague", "consult", "delegate", "split_work", "ask_human"})


def _stuck(name: str, result: str) -> bool:
    """A tool result that means the agent hit a real problem (not an approval or a hint)."""
    if name in _NO_HINT or name.startswith("browser_"):  # the browser has its own recovery
        return False
    return result.lstrip().startswith("Error") or bool(_FAILED.search(result))


async def _help_hint_once(db: AsyncSession, task: Task, agent: Agent) -> bool:
    """Show the ask-for-help tip at most once per task, and only when asking is possible."""
    if task.depth >= colleague.MAX_DEPTH or modes_for(agent).get("ask_colleague") == "deny":
        return False
    shown = await db.scalar(
        select(TaskEvent.id).where(TaskEvent.task_id == task.id, TaskEvent.kind == "hint")
    )
    if shown:
        return False
    await task_event(db, task, "hint", "system", "suggested asking a colleague for help")
    return True


def _browser_tool_error(text: str) -> bool:
    """Whether a browser result is a real failure, rather than an approval hint."""
    return text.lstrip().startswith("Error:") and "SUBMIT_NEEDS_APPROVAL:" not in text


def _browser_error_streak(history: list[AgentMessage]) -> int:
    """Count the latest consecutive browser failures across model turns."""
    streak = 0
    for message in reversed(history):
        if message.role == "assistant":
            continue
        if message.role != "tool" or not (message.name or "").startswith("browser_"):
            break
        if not _browser_tool_error(message.content or ""):
            break
        streak += 1
    return streak


TEAM_TOOLS = ("delegate", "consult", "ask_colleague", "split_work")


MCP_BRIDGE = ("tool_search", "tool_describe", "tool_call")


async def _has_mcp(db: AsyncSession, workspace_id: str) -> bool:
    from ..models import McpServer

    return bool(
        await db.scalar(
            select(McpServer.id).where(
                McpServer.workspace_id == workspace_id, McpServer.enabled.is_(True)
            )
        )
    )


def offered_tools(
    agent: Agent, task: Task | None = None, *, mcp: bool = False
) -> list[dict[str, Any]]:
    """Denied tools are not even shown to the model. Team tools exist only inside tasks, and
    delegate only for orchestrators above their depth cap. The MCP bridge is shown only when
    the workspace has a connected MCP server, so offices that use none pay no prompt tokens."""
    out = []
    for n, mode in modes_for(agent).items():
        if mode == "deny" or n in GLOBAL_DENY:
            continue
        if n in MCP_BRIDGE and not mcp:
            continue
        if n == "run_python" and not settings.sandbox_url:
            continue
        if n.startswith("browser_") and not settings.browser_url:  # small servers: no browser
            continue
        if n in ASSISTANT_ONLY and not agent.private:  # a person's assistant only (P16)
            continue
        if n == "delegate" and not delegation.can_delegate(agent, task):
            continue
        if n == "consult" and task is None:
            continue
        if n == "split_work" and not delegation.can_split(agent, task):
            continue
        if n == "ask_colleague" and (task is None or task.depth >= colleague.MAX_DEPTH):
            continue
        out.append(TOOLS[n].schema())
    return out


def _waiting(a: Approval) -> StepResult:
    return StepResult(
        "needs_approval",
        approval_id=a.id,
        timeout_seconds=max(60, int((a.expires_at - _now()).total_seconds())),
    )


async def add_tool_result(
    db: AsyncSession, task_id: str, call_id: str, name: str, content: str
) -> bool:
    """Answer a tool call once (activities may retry). False if it was already answered."""
    task = await db.get(Task, task_id)
    agent = await db.get(Agent, task.assignee_agent_id) if task and task.assignee_agent_id else None
    if task is None or agent is None:
        return False
    done = await db.scalar(
        select(AgentMessage.id).where(
            AgentMessage.task_id == task_id,
            AgentMessage.role == "tool",
            AgentMessage.tool_call_id == call_id,
        )
    )
    if done is not None:
        return False
    await _add_tool_result(
        db,
        agent,
        task_id=task_id,
        call_id=call_id,
        name=name,
        content=content,
        query=task_query(task),
    )
    await db.commit()
    return True


# ---------------------------------------------------------------- tool-call resolution


async def _pending_calls(db: AsyncSession, history: list[AgentMessage]) -> list[dict[str, Any]]:
    """Tool calls from the latest assistant message that have no result yet."""
    last = next((m for m in reversed(history) if m.role == "assistant" and m.tool_calls), None)
    if last is None:
        return []
    answered = {m.tool_call_id for m in history if m.role == "tool" and m.id > last.id}
    return [c for c in last.tool_calls or [] if c.get("id") not in answered]


async def _resolve_calls(
    db: AsyncSession, ctx: ToolContext, task: Task, history: list[AgentMessage]
) -> StepResult | None:
    agent = ctx.agent
    for call in await _pending_calls(db, history):
        call_id = str(call.get("id"))
        fn = call.get("function") or {}
        name = str(fn.get("name", ""))

        waiting = await db.scalar(
            select(Approval).where(
                Approval.task_id == task.id,
                Approval.tool_call_id == call_id,
                Approval.status == "pending",
            )
        )
        if waiting:
            return _waiting(waiting)

        args, err = _parse_args(fn.get("arguments"))
        if err or args is None:
            _add(
                db,
                agent,
                "tool",
                task_id=task.id,
                content=f"Error: {err}",
                tool_call_id=call_id,
                name=name,
            )
            await db.commit()
            continue

        if name == "ask_human":
            question = str(args.get("question", "")).strip() or "The agent needs your input."
            return _waiting(
                await _create_approval(
                    db, task, agent, "question", name, call_id, args, question, "low", "ask_human"
                )
            )

        decision = await policy.evaluate(agent, name, args)
        if name in TEAM_TOOLS and decision.effect != "deny":
            # Coordination inside the office, no outside effect: never waits for approval.
            team = await _team_call(db, ctx, task, name, call_id, args)
            if team is not None:
                return team
            continue
        if decision.effect == "deny":
            label = TOOLS[name].label if name in TOOLS else name
            _add(
                db,
                agent,
                "tool",
                task_id=task.id,
                tool_call_id=call_id,
                name=name,
                content=f"Blocked by policy ({decision.rule}): {decision.reason}",
            )
            await db.commit()
            await task_event(
                db,
                task,
                "tool_blocked",
                f"agent:{agent.id}",
                f"was blocked from using {label}: {decision.reason}",
                {"tool": name, "rule": decision.rule, "hardline": decision.hardline},
            )
            continue
        if decision.effect == "ask":
            reason = str(args.get("why") or args.get("reason") or "")
            shown = args
            if name == "browser_submit":
                from . import browser_tools  # late: browser_tools imports this module

                shown = {**args, **(await browser_tools.form_preview(task.id))}
            return _waiting(
                await _create_approval(
                    db,
                    task,
                    agent,
                    "tool",
                    name,
                    call_id,
                    shown,
                    reason,
                    TOOLS[name].risk,
                    decision.rule,
                )
            )

        await activity(
            agent, task, "tool_call", tool=name, label=TOOLS[name].label, args=_brief(args)
        )
        result = await run_tool(ctx, name, args)
        if _stuck(name, result) and await _help_hint_once(db, task, agent):
            result += HELP_HINT
        await _add_tool_result(
            db,
            agent,
            task_id=task.id,
            call_id=call_id,
            name=name,
            content=result,
            query=task_query(task),
            args=args,
        )
        await db.commit()
        await activity(agent, task, "tool_result", tool=name, preview=_brief(result, 400))
        if name.startswith("browser_") and _browser_tool_error(result):
            streak = _browser_error_streak(await _history(db, task_id=task.id))
            if streak >= BROWSER_ERROR_LIMIT:
                return StepResult(
                    "failed",
                    "The browser did not recover after "
                    f"{BROWSER_ERROR_LIMIT} consecutive errors. Last result: {_brief(result, 280)}",
                )
        if name == "report_progress":
            await task_event(db, task, "progress", f"agent:{agent.id}", str(args.get("update", "")))
        else:
            await task_event(
                db,
                task,
                "tool",
                f"agent:{agent.id}",
                f"used {TOOLS[name].label}",
                {"tool": name, "args": args, "result_preview": result[:300]},
            )
    return None


async def _team_call(
    db: AsyncSession, ctx: ToolContext, task: Task, name: str, call_id: str, args: dict[str, Any]
) -> StepResult | None:
    """delegate / consult: hand the work to the workflow, or answer with the reason it can't."""
    agent = ctx.agent
    if name == "ask_colleague":
        try:
            run, known = await colleague.plan(db, task, agent, ctx.workspace, call_id, args)
        except colleague.ColleagueError as e:
            await add_tool_result(db, task.id, call_id, name, f"Error: {e}")
            return None
        if known is not None:
            await add_tool_result(db, task.id, call_id, name, known)
            return None
        if not run:
            await delegation.collect(db, task.id, call_id)
            return None
        return StepResult("delegate", call_id=call_id, children=run)
    if name == "split_work":
        if not delegation.can_split(agent, task):
            await add_tool_result(
                db, task.id, call_id, name, "Error: helpers cannot split their work again."
            )
            return None
        try:
            run = await delegation.plan(db, task, agent, call_id, args, helpers=True)
        except delegation.DelegationError as e:
            await add_tool_result(db, task.id, call_id, name, f"Error: {e}")
            return None
        if not run:
            await delegation.collect(db, task.id, call_id)
            return None
        return StepResult("delegate", call_id=call_id, children=run)
    if name == "delegate":
        if not delegation.can_delegate(agent, task):
            await add_tool_result(
                db, task.id, call_id, name, "Error: you cannot delegate from this task."
            )
            return None
        try:
            run = await delegation.plan(db, task, agent, call_id, args)
        except delegation.DelegationError as e:  # raised before anything is added
            await add_tool_result(db, task.id, call_id, name, f"Error: {e}")
            return None
        if not run:  # every child already finished (a re-run): just collect
            await delegation.collect(db, task.id, call_id)
            return None
        return StepResult("delegate", call_id=call_id, children=run)
    # consult
    called = next(
        (
            e
            for e in (
                await db.scalars(
                    select(TaskEvent).where(
                        TaskEvent.task_id == task.id, TaskEvent.kind == "meeting_called"
                    )
                )
            ).all()
            if (e.data or {}).get("call_id") == call_id
        ),
        None,
    )
    if called is not None:
        m = await db.get(Meeting, (called.data or {}).get("meeting_id"))
        if m is None or m.status != "running":
            await add_tool_result(
                db,
                task.id,
                call_id,
                name,
                meetings.result_for_tool(m) if m else "The meeting is gone.",
            )
            return None
        return StepResult("meeting", call_id=call_id, meeting_id=m.id)
    try:
        refs = args.get("agents") or []
        others = await meetings.resolve_agents(
            db, task.workspace_id, [str(r) for r in refs] if isinstance(refs, list) else []
        )
        m = await meetings.create(
            db,
            task.workspace_id,
            str(args.get("topic", "")),
            others,
            f"agent:{agent.id}",
            task_id=task.id,
            initiator=agent,
            rounds=int(args.get("rounds") or 2),
        )
    except (meetings.MeetingError, ValueError, TypeError) as e:  # raised before any add
        await add_tool_result(db, task.id, call_id, name, f"Error: {e}")
        return None
    names = ", ".join(a.name for a in others if a.id != agent.id)
    await task_event(
        db,
        task,
        "meeting_called",
        f"agent:{agent.id}",
        f"called a meeting with {names}: {m.topic[:200]}",
        {"call_id": call_id, "meeting_id": m.id},
    )
    return StepResult("meeting", call_id=call_id, meeting_id=m.id)


async def _budget_gate(
    db: AsyncSession, task: Task, agent: Agent, ws: Workspace
) -> StepResult | None:
    """Over budget: stop and ask a person for more. Near it: warn once."""
    st = await budget.state(db, agent, ws.timezone)
    if not st.over:
        await budget.alert_if_near(db, agent, ws, st)
        return await objectives.gate(db, task, agent, ws)  # P21: the objective's budget
    daily = bool(st.token_limit and st.token_ratio >= 1)
    key = st.periods.day if daily else st.periods.month
    # The limit is part of the id: after a grant a new ask is a new approval.
    call_id = f"budget:{key}:{st.token_limit if daily else st.usd_limit}"
    prior = await db.scalar(
        select(Approval)
        .where(Approval.task_id == task.id, Approval.tool_call_id == call_id)
        .order_by(Approval.created_at.desc())
    )
    if prior is not None and prior.status == "pending":
        return _waiting(prior)
    if prior is not None and prior.status in ("denied", "expired", "cancelled"):
        why = "no one approved more" if prior.status == "expired" else "more budget was denied"
        return StepResult("failed", f"Stopped: {agent.name} is over budget and {why}.")
    return _waiting(
        await _create_approval(
            db,
            task,
            agent,
            "budget",
            "budget",
            call_id,
            st.dict(),
            st.reason(agent.name),
            "medium",
            "budget.limit",
        )
    )


async def _create_approval(
    db: AsyncSession,
    task: Task,
    agent: Agent,
    kind: str,
    tool: str,
    call_id: str,
    args: dict[str, Any],
    reason: str,
    risk: str,
    rule: str,
) -> Approval:
    a = Approval(
        workspace_id=task.workspace_id,
        task_id=task.id,
        agent_id=agent.id,
        kind=kind,
        tool_name=tool,
        tool_call_id=call_id,
        args=args,
        reason=reason,
        risk=risk,
        rule=rule,
        created_at=_now(),
        expires_at=_now() + APPROVAL_TTL,
    )
    db.add(a)
    await db.flush()
    if kind == "question":
        what, note = f"Question: {reason}", f"asked: {reason}"
        action = "Answer the question"
    elif kind == "budget":
        what, note = "Over budget: approve more to continue", "hit its budget and asked for more"
        action = "Approve more budget or stop it"
    else:
        what = f"Wants to use {TOOLS[tool].label}"
        note = f"wants to use {TOOLS[tool].label}"
        action = f"Approve or deny: {TOOLS[tool].label}"
    # P21: a named owner for the decision: the person who gave the task, else the agent's
    # owner; None = whoever may decide approvals for this agent.
    owner = task.created_by if (task.created_by or "").startswith("user:") else None
    if owner is None and agent.owner_user_id:
        owner = f"user:{agent.owner_user_id}"
    await set_task_status(
        db,
        task,
        "blocked",
        actor=f"agent:{agent.id}",
        note=note,
        blocked_reason=what[:300],
        blocked_owner=owner,
        blocked_action=action[:300],
    )
    await events.publish(
        task.workspace_id,
        "approval.requested",
        {
            "approval_id": a.id,
            "task_id": task.id,
            "agent_id": agent.id,
            "agent_name": agent.name,
            "kind": kind,
            "tool": tool,
            "summary": what,
        },
    )
    await agent_status(agent, "waiting_approval", task)
    # Phone push and Telegram: queued in the delivery ledger, sent by the worker.
    from ..channels import deliver  # late: channels -> agents.decisions -> dispatch

    try:
        await deliver.start(await deliver.approval_requested(db, a))
    except Exception:  # noqa: BLE001 - notifications must never break the task
        log.warning("could not queue notifications for %s", a.id, exc_info=True)
    return a


# ---------------------------------------------------------------- task steps


async def _load(db: AsyncSession, task_id: str) -> tuple[Task, Agent, Workspace]:
    task = await db.get(Task, task_id)
    if task is None:
        raise LookupError(f"task {task_id} not found")
    agent = await db.get(Agent, task.assignee_agent_id) if task.assignee_agent_id else None
    if agent is None:
        raise LookupError(f"task {task_id} has no agent")
    ws = await db.get(Workspace, task.workspace_id)
    assert ws is not None
    return task, agent, ws


async def _attached_files_note(db: AsyncSession, task: Task, tz: str) -> str:
    """Files people gave this task (P10), already read and summarised: listed so the agent
    knows they exist and reads only what it needs."""
    from ..documents import service as doc_service
    from ..models import DocFile

    files = (
        await db.scalars(
            select(DocFile).where(DocFile.task_id == task.id).order_by(DocFile.created_at)
        )
    ).all()
    if not files:
        return ""
    today = doc_service.today_in(tz)
    lines = "\n".join(doc_service.file_line(f, today) for f in files[:20])
    return f"\n\nFiles attached to this task (read them with read_file):\n{lines}"


async def _language_line(db: AsyncSession, task: Task) -> str:
    """P22: a task a person created is reported in their language. One line on the first
    message only (never the system prompt, so the cached prefix stays the same)."""
    if not (task.created_by or "").startswith("user:"):
        return ""
    return lang_notes.task_line(await prefs.language(db, task.created_by.removeprefix("user:")))


async def run_task_step(task_id: str) -> StepResult:
    async with SessionLocal() as db:
        task, agent, ws = await _load(db, task_id)
        if task.status in ("done", "cancelled", "failed"):
            return StepResult("done", task.result)
        ctx = ToolContext(db=db, agent=agent, workspace=ws, task=task)
        history = await _history(db, task_id=task.id)
        if not history:
            content = f"Task: {task.title}\n\n{task.brief}".strip()
            content += await objectives.why_line(db, task)  # P21: why this work matters
            content += await _language_line(db, task)  # P22: report in the asker's language
            content += await _attached_files_note(db, task, ws.timezone)
            if task.output_schema:
                content += "\n\n" + delegation.schema_note(task.output_schema)
            block, n_facts, n_pages = await recall_block(
                db, agent, f"{task.title}\n{task.brief}", ws.timezone
            )
            _add(
                db,
                agent,
                "user",
                task_id=task.id,
                content=f"{content}\n\n{block}" if block else content,
            )
            await db.commit()
            if block:
                await task_event(
                    db,
                    task,
                    "memory",
                    f"agent:{agent.id}",
                    f"recalled {_count(n_facts, 'fact')} and {_count(n_pages, 'page')}",
                    {"facts": n_facts, "pages": n_pages},
                )
            history = await _history(db, task_id=task.id)

        await agent_status(agent, "working", task)
        pending = await _resolve_calls(db, ctx, task, history)
        if pending:
            return pending

        task_call_limit = max_task_model_calls(ws.settings)
        for _ in range(MAX_CALLS_PER_STEP):
            if task.steps_used >= task_call_limit:
                return StepResult(
                    "failed", f"Stopped after {task_call_limit} model calls without finishing."
                )
            gate = await _budget_gate(db, task, agent, ws)
            if gate:
                return gate
            history = await _history(db, task_id=task.id)
            if task.memory_snapshot is None:
                task.memory_snapshot = await core_memory.snapshot(db, agent)
            prompt = await system_prompt(db, agent, "task", task.memory_snapshot)
            messages = [{"role": "system", "content": prompt}]
            # P12: long runs send a checkpoint + recent turns, not the whole history.
            window = await context.plan(
                db,
                task,
                history,
                workspace_id=ws.id,
                group=agent.model_group,
                pinned_first=True,
                window=await context.group_window(db, ws.id, agent.model_group),
                agent_id=agent.id,
                task_id=task.id,
            )
            messages += context.render(history, window, to_openai, pinned_first=True)
            await agent_thinking(agent, True)
            try:
                reply = await gateway.chat(
                    db,
                    ws.id,
                    agent.model_group,
                    messages,
                    task="agent.task",
                    tools=offered_tools(agent, task, mcp=await _has_mcp(db, ws.id)),
                    max_tokens=TASK_REPLY_TOKENS,
                    agent_id=agent.id,
                    task_id=task.id,
                )
            except gateway.GatewayUnavailable as e:
                why = "; ".join(
                    f"{a['member']}: {a.get('failed') or a.get('skipped')}" for a in e.attempts
                )
                return StepResult("failed", f"{e}{' (' + why + ')' if why else ''}")
            finally:
                await agent_thinking(agent, False)
            task.steps_used += 1
            await activity(
                agent,
                task,
                "think",
                text=_brief(reply.content or "", 600),
                tools=[
                    {
                        "tool": str((c.get("function") or {}).get("name", "")),
                        "args": _brief((c.get("function") or {}).get("arguments", ""), 160),
                    }
                    for c in reply.tool_calls or []
                ],
                model=reply.model,
                provider=reply.provider_name,
                tokens=reply.usage.prompt + reply.usage.completion,
                cached=reply.usage.cached,
                cost_usd=reply.cost_usd,
            )
            if reply.tool_calls:
                _add(
                    db,
                    agent,
                    "assistant",
                    task_id=task.id,
                    content=reply.content or None,
                    tool_calls=reply.tool_calls,
                    meta={
                        "provider": reply.provider_name,
                        "model": reply.model,
                        **(
                            {"reasoning_content": reply.reasoning_content[:20_000]}
                            if reply.reasoning_content
                            else {}
                        ),
                    },
                )
                await db.commit()
                history = await _history(db, task_id=task.id)
                pending = await _resolve_calls(db, ctx, task, history)
                if pending:
                    return pending
                continue
            _add(
                db,
                agent,
                "assistant",
                task_id=task.id,
                content=reply.content,
                meta={"provider": reply.provider_name, "model": reply.model},
            )
            await db.commit()
            answer = reply.content
            if task.output_schema:
                value, why = delegation.check_output(reply.content, task.output_schema)
                if why is not None:
                    if task.correction_used:
                        return StepResult(
                            "failed", f"The answer did not match the required format: {why}."
                        )
                    task.correction_used = True
                    _add(
                        db,
                        agent,
                        "user",
                        task_id=task.id,
                        content=delegation.correction_prompt(why, task.output_schema),
                    )
                    await db.commit()
                    await task_event(
                        db, task, "correction", "system", f"asked for a corrected answer: {why}"
                    )
                    continue
                answer = json.dumps(value, ensure_ascii=False)
            elif (asks := ends_with_question(answer)) or promises_more_work(answer):
                # Once per kind and task: an agent that ends on a question meant to ask
                # (top-level tasks only: helpers and colleagues answer their caller), and one
                # that promises work meant to do it.
                kind = "nudge" if asks else "nudge_work"
                nudged = (asks and task.depth > 0) or await db.scalar(
                    select(TaskEvent.id).where(TaskEvent.task_id == task.id, TaskEvent.kind == kind)
                )
                if not nudged:
                    _add(
                        db,
                        agent,
                        "user",
                        task_id=task.id,
                        content=ASK_NUDGE if asks else WORK_NUDGE,
                    )
                    await db.commit()
                    await task_event(
                        db,
                        task,
                        kind,
                        "system",
                        "reminded it to ask with ask_human instead of ending on a question"
                        if asks
                        else "reminded it to do the work it said it would, before answering",
                    )
                    continue
            await activity(agent, task, "answer", text=_brief(answer or "", 600))
            return StepResult("done", answer)
        await db.commit()
        return StepResult("continue")


async def start_run(task_id: str) -> None:
    async with SessionLocal() as db:
        task, agent, _ = await _load(db, task_id)
        await set_task_status(
            db,
            task,
            "running",
            actor=f"agent:{agent.id}",
            note="started work",
            started_at=_now(),
            # Frozen for the whole run: edits the agent makes now apply from the next run.
            memory_snapshot=await core_memory.snapshot(db, agent),
            error=None,
            blocked_reason=None,
        )
        await agent_status(agent, "working", task)


async def finish(task_id: str, state: str, message: str | None) -> None:
    from ..teams import blockers, review  # late: they import this module
    from . import browser_tools, launch  # late: both import this module

    await browser_tools.close_for_task(task_id)  # its browser goes when the task ends
    async with SessionLocal() as db:
        task, agent, ws = await _load(db, task_id)
        unchecked = False
        reviewing = task.source == "review"  # P21: a reviewer agent's verdict on others' work
        # P19: a reviewer reads real work once before it is handed in; one chance to fix.
        if state == "done" and not reviewing and verify.enabled(ws) and await verify.due(db, task):
            rv = await verify.review(db, task, agent, message)
            note = (
                "self-check could not run"
                if not rv.checked
                else "self-check passed"
                if rv.ok
                else f"self-check found {len(rv.issues)} problem(s); fixing before handing in"
            )
            await task_event(
                db,
                task,
                "selfcheck",
                "system",
                note,
                {"ok": rv.ok, "checked": rv.checked, "issues": rv.issues},
            )
            if not rv.ok:
                _add(db, agent, "user", task_id=task.id, content=verify.nudge(rv.issues))
                await db.commit()
                await launch.launch(db, task, "self-check")
                return
        if state == "done" and task.goal and task.goal_tries < goals.MAX_GOAL_TRIES:
            verdict = await goals.judge(db, task, agent, message)
            if not verdict.met:
                task.goal_tries += 1
                _add(db, agent, "user", task_id=task.id, content=goals.nudge(verdict.missing))
                await db.commit()
                await task_event(
                    db,
                    task,
                    "goal",
                    "system",
                    f"goal not met ({task.goal_tries}/{goals.MAX_GOAL_TRIES}): {verdict.missing}"[
                        :300
                    ],
                )
                await launch.launch(db, task, "goal-loop")
                return
            if not verdict.checked:
                # P17: never pass a goal nobody checked; a person looks instead.
                unchecked = True
                await task_event(
                    db, task, "goal", "system", "no model could check the goal; sent for review"
                )
        if state == "done" and not reviewing and not unchecked:
            # P21 review stages: a reviewer agent checks it before a person or done.
            try:
                taken = await review.start(db, task, agent, message)
            except Exception:  # noqa: BLE001 - review trouble must not lose the work
                log.warning("review stages failed for %s", task.id, exc_info=True)
                taken = False
            if taken:
                await agent_status(agent, "idle", task)
                return
        if state == "done":
            status = "review" if (task.requires_review and not reviewing) or unchecked else "done"
            if status == "done":
                await skills_store.settle(db, task.id, "accepted")
            await set_task_status(
                db,
                task,
                status,
                actor=f"agent:{agent.id}",
                note="finished and sent it for review" if status == "review" else "finished",
                result=message,
                finished_at=_now(),
                blocked_reason=None,
            )
        elif state == "cancelled":
            for a in (
                await db.scalars(
                    select(Approval).where(
                        Approval.task_id == task.id, Approval.status == "pending"
                    )
                )
            ).all():
                a.status = "cancelled"
            for m in (
                await db.scalars(
                    select(Meeting).where(Meeting.task_id == task.id, Meeting.status == "running")
                )
            ).all():
                await meetings.cancel(db, m)
            await set_task_status(
                db,
                task,
                "cancelled",
                note="cancelled the task",
                finished_at=_now(),
                blocked_reason=None,
            )
        else:
            await skills_store.settle(db, task.id, "failed")
            await set_task_status(
                db,
                task,
                "failed",
                actor=f"agent:{agent.id}",
                note=f"failed: {message}" if message else "failed",
                error=message,
                finished_at=_now(),
                blocked_reason=None,
            )
        await agent_status(agent, "error" if state not in ("done", "cancelled") else "idle", task)
        # P21: act on a reviewer's verdict, and move on the work that waits for this task.
        try:
            if reviewing:
                await review.finished(db, task, state, message)
            await blockers.on_finished(db, task)
        except Exception:  # noqa: BLE001 - the task itself is finished either way
            log.warning("follow-ups after %s failed", task.id, exc_info=True)


async def apply_approval(approval_id: str) -> None:
    """Turn a decided approval into the tool result the model will read next."""
    async with SessionLocal() as db:
        a = await db.get(Approval, approval_id)
        if a is None:
            return
        task, agent, ws = await _load(db, a.task_id)
        answered = (
            await db.scalar(
                select(AgentMessage.id).where(
                    AgentMessage.task_id == task.id,
                    AgentMessage.role == "tool",
                    AgentMessage.tool_call_id == a.tool_call_id,
                )
            )
        ) is not None
        if answered or a.status in ("pending", "cancelled"):
            return
        if a.kind == "budget":
            # No tool message: the next step re-checks the budget (and fails if denied).
            if a.status == "approved":
                await budget.grant(
                    db, agent, await budget.state(db, agent, ws.timezone), a.decided_by or "system"
                )
                await task_event(
                    db, task, "budget", a.decided_by or "system", "approved more budget"
                )
            await set_task_status(
                db,
                task,
                "running",
                actor=f"agent:{agent.id}",
                note="resumed after the budget decision",
                blocked_reason=None,
            )
            await agent_status(agent, "working", task)
            return
        who = "a person"
        if a.decided_by and a.decided_by.startswith("user:"):
            user = await db.get(User, a.decided_by.removeprefix("user:"))
            who = user.name if user else who
        if a.status == "approved":
            # "Always" never un-gates a high-risk tool from an approval card; a manager can
            # still choose that deliberately in the agent's permissions.
            tool = TOOLS.get(a.tool_name)
            if a.scope == "always" and tool is not None and tool.risk != "high":
                agent.tools = {**(agent.tools or {}), a.tool_name: "allow"}
            result = await run_tool(
                ToolContext(db=db, agent=agent, workspace=ws, task=task), a.tool_name, a.args
            )
            await activity(
                agent, task, "tool_result", tool=a.tool_name, preview=_brief(result, 400)
            )
            await task_event(
                db,
                task,
                "tool",
                f"agent:{agent.id}",
                f"used {TOOLS[a.tool_name].label} (approved)",
                {"tool": a.tool_name, "args": a.args, "result_preview": result[:300]},
            )
        elif a.status == "denied":
            result = (
                f"{who} denied this request."
                + (f" Reason: {a.answer}" if a.answer else "")
                + " Continue without it, or finish and explain what is missing."
            )
            if (a.answer or "").strip():
                await _learn_denial(db, agent, task, a, who)
        elif a.status == "answered":
            result = f"Answer from {who}: {a.answer}"
        else:  # expired
            result = (
                "No one answered within 24 hours. Continue without it, or finish and "
                "explain what is missing."
            )
        await _add_tool_result(
            db,
            agent,
            task_id=task.id,
            call_id=a.tool_call_id or "",
            name=a.tool_name,
            content=result,
            query=task_query(task),
            args=a.args,
        )
        await set_task_status(
            db,
            task,
            "running",
            actor=f"agent:{agent.id}",
            note="resumed after the decision",
            blocked_reason=None,
        )
        await agent_status(agent, "working", task)


async def _learn_denial(db: AsyncSession, agent: Agent, task: Task, a: Approval, who: str) -> None:
    """A denial with a reason is a lesson: keep it as a private fact for this agent (P17)."""
    from ..brain import facts as brain_facts  # late: the brain imports agent modules
    from ..brain.scope import for_agent

    tool = TOOLS.get(a.tool_name)
    label = tool.label if tool else a.tool_name
    text = brain_facts.clean(
        f'{who} denied "{label}" on the task "{task.title[:80]}": {(a.answer or "").strip()}'
    )
    if not text:
        return
    try:
        await brain_facts.add(
            db,
            await for_agent(db, agent),
            text,
            branch_id=None,
            agent_id=agent.id,
            source_kind="person",
            source_id=task.id,
            source_label=f"approval decision by {who}",
            created_by=a.decided_by or "system",
        )
    except Exception:  # noqa: BLE001 - memory is best effort; the decision itself stands
        log.warning("could not remember the denial of %s", a.id, exc_info=True)


async def expire_approval(approval_id: str) -> None:
    async with SessionLocal() as db:
        a = await db.get(Approval, approval_id)
        if a is not None and a.status == "pending":
            a.status = "expired"
            a.decided_at = _now()
            await db.commit()
            await events.publish(
                a.workspace_id,
                "approval.resolved",
                {
                    "approval_id": a.id,
                    "status": "expired",
                    "task_id": a.task_id,
                    "agent_id": a.agent_id,
                },
            )


# ---------------------------------------------------------------- chat


def over_budget_reply(st: budget.BudgetState) -> str:
    when = "today" if st.token_limit and st.token_ratio >= 1 else "this month"
    return (
        f"I have used my budget for {when}, so I am paused. An admin can raise my budget on "
        "my profile, or approve more when I ask inside a task."
    )


@dataclass
class ChatReply:
    content: str
    provider_name: str
    model: str
    tools_used: list[str]
    message_id: int | None = None


BACKUP_NOTE = "(Backup mode: the main AI is unavailable, so a small local model answered.)"


async def _backup_reply(
    db: AsyncSession, ws: Workspace, agent: Agent, history: list[AgentMessage]
) -> gateway.GatewayReply | None:
    """When every cloud model in the agent's group is down, the small local model answers
    simple chat (no tools, short context: it only has ~4k tokens) and says it is in backup
    mode. Tasks never use it: they wait and retry, since a tiny model must not drive tools."""
    if agent.model_group == "local":
        return None
    recent = [m for m in history if m.role in ("user", "assistant") and m.content][-6:]
    msgs: list[dict[str, Any]] = [
        {
            "role": "system",
            "content": f"You are {agent.name}, {agent.role} at {ws.name}. The office's main AI "
            "is down, so you are answering with a small backup model. Keep answers short and "
            "simple. For anything complex, needing tools, documents or exact figures, say it "
            "will be handled as soon as the main AI is back. Never invent facts.",
        },
        *({"role": m.role, "content": (m.content or "")[:800]} for m in recent),
    ]
    try:
        r = await gateway.chat(
            db, ws.id, "local", msgs, task="agent.chat.backup", max_tokens=400, agent_id=agent.id
        )
    except gateway.GatewayUnavailable:
        return None
    r.content = f"{BACKUP_NOTE}\n\n{r.content.strip()}"
    r.tool_calls = []
    return r


async def chat_turn(db: AsyncSession, agent: Agent, session: ChatSession, text: str) -> ChatReply:
    """Direct conversation. Runs in the request (no Temporal): only tools the policy allows
    outright are executed; anything needing approval is declined with a pointer to tasks."""
    ws = await db.get(Workspace, agent.workspace_id)
    assert ws is not None
    if session.memory_snapshot is None:  # frozen for the conversation, like a task run
        session.memory_snapshot = await core_memory.snapshot(db, agent)
    asked = _add(db, agent, "user", session_id=session.id, content=text)
    await db.commit()
    st = await budget.state(db, agent, ws.timezone)
    if st.over:
        note = over_budget_reply(st)
        answer = _add(
            db, agent, "assistant", session_id=session.id, content=note, meta={"budget": True}
        )
        await db.commit()
        return ChatReply(note, "", "", [], answer.id)
    # Recalled memory rides on this turn only: it is not stored, and earlier turns stay
    # byte-identical, so the cached prompt prefix keeps hitting.
    block, _, _ = await recall_block(db, agent, text, ws.timezone, exclude_session_id=session.id)
    # P22: the person's language rides on this turn too (never the system prompt). The
    # request's language (X-Lang, or a bot's use_lang), else the person's saved one.
    lang = explicit_lang() or await prefs.language(db, session.user_id)
    note = lang_notes.chat_note(lang)
    block = f"{block}\n\n{note}" if block else note
    ctx = ToolContext(
        db=db, agent=agent, workspace=ws, task=None, person=session.user_id, session_id=session.id
    )
    # A person who could approve this agent's requests asking it directly (policy.py).
    approver = await policy.chat_approver(db, agent, session.user_id)
    used: list[str] = []
    outside_read = False  # outside text was read this turn (policy.OUTSIDE_CONTENT)
    for round_no in range(CHAT_ROUNDS):
        # The last round offers no tools: the agent answers from what it has found so far,
        # instead of the person getting "could not finish" after real work was done.
        last = round_no == CHAT_ROUNDS - 1
        history = await _history(db, session_id=session.id)
        prompt = await system_prompt(db, agent, "chat", session.memory_snapshot)
        messages = [{"role": "system", "content": prompt}]
        # P12: a long conversation is checkpointed instead of cut at a fixed count (which
        # could split a tool call from its results).
        window = await context.plan(
            db,
            session,
            history,
            workspace_id=ws.id,
            group=agent.model_group,
            pinned_first=False,
            window=await context.group_window(db, ws.id, agent.model_group),
            agent_id=agent.id,
        )
        messages += context.render(
            history,
            window,
            to_openai,
            pinned_first=False,
            extra={asked.id: block} if block else None,
        )
        if last:
            messages.append({"role": "user", "content": FINAL_ROUND})
        await agent_thinking(agent, True)
        try:
            reply = await gateway.chat(
                db,
                ws.id,
                agent.model_group,
                messages,
                task="agent.chat",
                tools=None if last else offered_tools(agent, mcp=await _has_mcp(db, ws.id)),
                max_tokens=1600 if last else 1200,
                agent_id=agent.id,
            )
        except gateway.GatewayUnavailable:
            backup = await _backup_reply(db, ws, agent, history)
            if backup is None:
                raise
            reply = backup
        finally:
            await agent_thinking(agent, False)
        if not reply.tool_calls and (reply.content or "").strip():
            answer = _add(
                db,
                agent,
                "assistant",
                session_id=session.id,
                content=reply.content,
                meta={"provider": reply.provider_name, "model": reply.model, "tools": used},
            )
            await db.commit()
            return ChatReply(reply.content, reply.provider_name, reply.model, used, answer.id)
        _add(
            db,
            agent,
            "assistant",
            session_id=session.id,
            content=reply.content or None,
            tool_calls=reply.tool_calls,
        )
        await db.commit()
        for call in reply.tool_calls:
            fn = call.get("function") or {}
            name = str(fn.get("name", ""))
            args, err = _parse_args(fn.get("arguments"))
            if err or args is None:
                result = f"Error: {err}"
            elif name == "ask_human":
                result = "You are already talking to a person. Ask your question in your reply."
            else:
                d = await policy.evaluate(agent, name, args, asked_by=approver)
                if d.rule == "chat.person_asked" and outside_read:
                    result = (
                        "Not done yet: you read outside content (an email, a page or a file) "
                        "in this turn, so this needs the person's own confirmation. Tell them "
                        "exactly what you would set up and when, and ask them to reply yes."
                    )
                elif d.effect == "allow":
                    result = await run_tool(ctx, name, args)
                    used.append(name)
                    outside_read = outside_read or name in policy.OUTSIDE_CONTENT
                elif d.effect == "ask":
                    result = (
                        "This needs approval, which only works inside a task. Tell the "
                        "person and suggest turning this into a task."
                    )
                else:
                    result = f"Blocked by policy ({d.rule}): {d.reason}"
            await _add_tool_result(
                db,
                agent,
                session_id=session.id,
                call_id=str(call.get("id")),
                name=name,
                content=result,
                query=text,
                args=args,
            )
        await db.commit()
    final = "I could not finish that in one go. Try asking in smaller steps, or make it a task."
    _add(db, agent, "assistant", session_id=session.id, content=final)
    await db.commit()
    return ChatReply(final, "", "", used)


# A chat answer may take several tool rounds (search the inbox, open three emails, answer).
CHAT_ROUNDS = 8
FINAL_ROUND = (
    "(System note, not from the person: you have used your tools for this message. Answer "
    "now from what you have found so far. If something could not be checked, say so in one "
    "line and offer to continue.)"
)


@dataclass
class OnceReply:
    content: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    tools_used: list[str]


async def chat_once(db: AsyncSession, agent: Agent, convo: list[dict[str, Any]]) -> OnceReply:
    """Stateless chat for the OpenAI-compatible API: the client sends the history each time.
    Same rules as dashboard chat: the agent's prompt, recalled memory, and only tools the
    policy allows outright (anything needing approval belongs in a task)."""
    ws = await db.get(Workspace, agent.workspace_id)
    assert ws is not None

    def text_of(content: Any) -> str:
        if isinstance(content, str):
            return content
        if isinstance(content, list):  # [{"type": "text", "text": ...}, ...]
            return "\n".join(
                str(p.get("text", ""))
                for p in content
                if isinstance(p, dict) and p.get("type") == "text"
            )
        return ""

    turns = [
        {"role": m["role"], "content": text_of(m.get("content"))}
        for m in convo
        if isinstance(m, dict) and m.get("role") in ("user", "assistant")
    ][-40:]
    turns = [t for t in turns if t["content"].strip()]
    if not turns or turns[-1]["role"] != "user":
        raise ValueError("The last message must be from the user.")
    st = await budget.state(db, agent, ws.timezone)
    if st.over:
        return OnceReply(over_budget_reply(st), "", 0, 0, [])
    block, _, _ = await recall_block(db, agent, turns[-1]["content"], ws.timezone)
    if block:
        turns[-1] = {"role": "user", "content": f"{turns[-1]['content']}\n\n{block}"}
    prompt = await system_prompt(db, agent, "chat", await core_memory.snapshot(db, agent))
    messages: list[dict[str, Any]] = [{"role": "system", "content": prompt}, *turns]
    ctx = ToolContext(db=db, agent=agent, workspace=ws, task=None)
    used: list[str] = []
    p_tokens = c_tokens = 0
    model = ""
    for _ in range(4):
        await agent_thinking(agent, True)
        try:
            reply = await gateway.chat(
                db,
                ws.id,
                agent.model_group,
                messages,
                task="agent.api",
                tools=offered_tools(agent),
                max_tokens=1200,
                agent_id=agent.id,
            )
        finally:
            await agent_thinking(agent, False)
        p_tokens += reply.usage.prompt
        c_tokens += reply.usage.completion
        model = reply.model
        if not reply.tool_calls:
            return OnceReply(reply.content, model, p_tokens, c_tokens, used)
        messages.append(
            {"role": "assistant", "content": reply.content or None, "tool_calls": reply.tool_calls}
        )
        for call in reply.tool_calls:
            fn = call.get("function") or {}
            name = str(fn.get("name", ""))
            args, err = _parse_args(fn.get("arguments"))
            if err or args is None:
                result = f"Error: {err}"
            elif name == "ask_human":
                result = "You are talking to a person through an app. Ask in your reply."
            else:
                d = await policy.evaluate(agent, name, args)
                if d.effect == "allow":
                    result = await run_tool(ctx, name, args)
                    used.append(name)
                elif d.effect == "ask":
                    result = (
                        "This needs approval, which only works inside a task. Say so in your reply."
                    )
                else:
                    result = f"Blocked by policy ({d.rule}): {d.reason}"
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": str(call.get("id")),
                    "name": name,
                    "content": result,
                }
            )
    return OnceReply(
        "I could not finish that in one go. Try a smaller question, or ask for a task.",
        model,
        p_tokens,
        c_tokens,
        used,
    )
