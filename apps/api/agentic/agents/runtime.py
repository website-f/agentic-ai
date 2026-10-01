"""The agent loop. Each call to `run_task_step` is one Temporal activity: it loads the task's
conversation from Postgres, lets the model think and call tools, and stops when it has a
final answer, needs a person (approval or question), or used its step allowance.

All state lives in the database, so a crashed worker simply re-runs the step.
"""

import asyncio
import json
import logging
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..brain import core as core_memory
from ..brain.recall import recall_block
from ..core.db import SessionLocal
from ..engine import gateway
from ..models import (
    Agent,
    AgentMessage,
    Approval,
    ChatSession,
    Task,
    TaskEvent,
    User,
    Workspace,
)
from ..services import events
from ..skills import store as skills_store
from . import policy
from .prompt import system_prompt
from .tools import TOOLS, ToolContext, modes_for

log = logging.getLogger("agentic.runtime")

MAX_CALLS_PER_STEP = 6
MAX_CALLS_PER_TASK = 30
APPROVAL_TTL = timedelta(hours=24)
TOOL_TIMEOUT = 45


@dataclass
class StepResult:
    state: str  # done | needs_approval | failed | continue
    message: str | None = None
    approval_id: str | None = None
    timeout_seconds: int = 0

    def dict(self) -> dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------- persistence helpers


def _now() -> datetime:
    return datetime.now(UTC)


def to_openai(m: AgentMessage) -> dict[str, Any]:
    d: dict[str, Any] = {"role": m.role, "content": m.content}
    if m.role == "assistant" and m.tool_calls:
        d["tool_calls"] = m.tool_calls
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


def offered_tools(agent: Agent) -> list[dict[str, Any]]:
    """Denied tools are not even shown to the model."""
    return [TOOLS[n].schema() for n, mode in modes_for(agent).items() if mode != "deny"]


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
) -> Approval | None:
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
            return waiting

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
            return await _create_approval(
                db, task, agent, "question", name, call_id, args, question, "low", "ask_human"
            )

        decision = await policy.evaluate(agent, name, args)
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
            return await _create_approval(
                db,
                task,
                agent,
                "tool",
                name,
                call_id,
                args,
                reason,
                TOOLS[name].risk,
                decision.rule,
            )

        result = await run_tool(ctx, name, args)
        _add(db, agent, "tool", task_id=task.id, content=result, tool_call_id=call_id, name=name)
        await db.commit()
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
    what = f"Question: {reason}" if kind == "question" else f"Wants to use {TOOLS[tool].label}"
    note = f"asked: {reason}" if kind == "question" else f"wants to use {TOOLS[tool].label}"
    await set_task_status(
        db, task, "blocked", actor=f"agent:{agent.id}", note=note, blocked_reason=what[:300]
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


async def run_task_step(task_id: str) -> StepResult:
    async with SessionLocal() as db:
        task, agent, ws = await _load(db, task_id)
        if task.status in ("done", "cancelled", "failed"):
            return StepResult("done", task.result)
        ctx = ToolContext(db=db, agent=agent, workspace=ws, task=task)
        history = await _history(db, task_id=task.id)
        if not history:
            content = f"Task: {task.title}\n\n{task.brief}".strip()
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
            return StepResult(
                "needs_approval",
                approval_id=pending.id,
                timeout_seconds=max(60, int((pending.expires_at - _now()).total_seconds())),
            )

        for _ in range(MAX_CALLS_PER_STEP):
            if task.steps_used >= MAX_CALLS_PER_TASK:
                return StepResult(
                    "failed", f"Stopped after {MAX_CALLS_PER_TASK} model calls without finishing."
                )
            history = await _history(db, task_id=task.id)
            if task.memory_snapshot is None:
                task.memory_snapshot = await core_memory.snapshot(db, agent)
            prompt = await system_prompt(db, agent, "task", task.memory_snapshot)
            messages = [{"role": "system", "content": prompt}]
            messages += [to_openai(m) for m in history]
            await agent_thinking(agent, True)
            try:
                reply = await gateway.chat(
                    db,
                    ws.id,
                    agent.model_group,
                    messages,
                    task="agent.task",
                    tools=offered_tools(agent),
                    max_tokens=1500,
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
            if reply.tool_calls:
                _add(
                    db,
                    agent,
                    "assistant",
                    task_id=task.id,
                    content=reply.content or None,
                    tool_calls=reply.tool_calls,
                    meta={"provider": reply.provider_name, "model": reply.model},
                )
                await db.commit()
                history = await _history(db, task_id=task.id)
                pending = await _resolve_calls(db, ctx, task, history)
                if pending:
                    return StepResult(
                        "needs_approval",
                        approval_id=pending.id,
                        timeout_seconds=max(60, int((pending.expires_at - _now()).total_seconds())),
                    )
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
            return StepResult("done", reply.content)
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
    async with SessionLocal() as db:
        task, agent, _ = await _load(db, task_id)
        if state == "done":
            status = "review" if task.requires_review else "done"
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
        who = "a person"
        if a.decided_by and a.decided_by.startswith("user:"):
            user = await db.get(User, a.decided_by.removeprefix("user:"))
            who = user.name if user else who
        if a.status == "approved":
            if a.scope == "always":
                agent.tools = {**(agent.tools or {}), a.tool_name: "allow"}
            result = await run_tool(
                ToolContext(db=db, agent=agent, workspace=ws, task=task), a.tool_name, a.args
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
        elif a.status == "answered":
            result = f"Answer from {who}: {a.answer}"
        else:  # expired
            result = (
                "No one answered within 24 hours. Continue without it, or finish and "
                "explain what is missing."
            )
        _add(
            db,
            agent,
            "tool",
            task_id=task.id,
            content=result,
            tool_call_id=a.tool_call_id,
            name=a.tool_name,
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
                {"approval_id": a.id, "status": "expired", "task_id": a.task_id},
            )


# ---------------------------------------------------------------- chat


@dataclass
class ChatReply:
    content: str
    provider_name: str
    model: str
    tools_used: list[str]
    message_id: int | None = None


async def chat_turn(db: AsyncSession, agent: Agent, session: ChatSession, text: str) -> ChatReply:
    """Direct conversation. Runs in the request (no Temporal): only tools the policy allows
    outright are executed; anything needing approval is declined with a pointer to tasks."""
    ws = await db.get(Workspace, agent.workspace_id)
    assert ws is not None
    if session.memory_snapshot is None:  # frozen for the conversation, like a task run
        session.memory_snapshot = await core_memory.snapshot(db, agent)
    asked = _add(db, agent, "user", session_id=session.id, content=text)
    await db.commit()
    # Recalled memory rides on this turn only: it is not stored, and earlier turns stay
    # byte-identical, so the cached prompt prefix keeps hitting.
    block, _, _ = await recall_block(db, agent, text, ws.timezone, exclude_session_id=session.id)
    ctx = ToolContext(db=db, agent=agent, workspace=ws, task=None)
    used: list[str] = []
    for _ in range(4):
        history = await _history(db, session_id=session.id)
        prompt = await system_prompt(db, agent, "chat", session.memory_snapshot)
        messages = [{"role": "system", "content": prompt}]
        for m in history[-40:]:
            d = to_openai(m)
            if block and m.id == asked.id:
                d["content"] = f"{m.content}\n\n{block}"
            messages.append(d)
        await agent_thinking(agent, True)
        try:
            reply = await gateway.chat(
                db,
                ws.id,
                agent.model_group,
                messages,
                task="agent.chat",
                tools=offered_tools(agent),
                max_tokens=1200,
                agent_id=agent.id,
            )
        finally:
            await agent_thinking(agent, False)
        if not reply.tool_calls:
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
                d = await policy.evaluate(agent, name, args)
                if d.effect == "allow":
                    result = await run_tool(ctx, name, args)
                    used.append(name)
                elif d.effect == "ask":
                    result = (
                        "This needs approval, which only works inside a task. Tell the "
                        "person and suggest turning this into a task."
                    )
                else:
                    result = f"Blocked by policy ({d.rule}): {d.reason}"
            _add(
                db,
                agent,
                "tool",
                session_id=session.id,
                content=result,
                tool_call_id=str(call.get("id")),
                name=name,
            )
        await db.commit()
    final = "I could not finish that in one go. Try asking in smaller steps, or make it a task."
    _add(db, agent, "assistant", session_id=session.id, content=final)
    await db.commit()
    return ChatReply(final, "", "", used)


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
