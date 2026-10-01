"""After work: pull durable facts out of a finished task or a chat turn, and log it.

Runs in the worker (Temporal activities), never in the request path.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Agent, AgentMessage, ChatSession, Task, Workspace
from . import facts, store
from .scope import for_agent

MIN_CHAT_CHARS = 25
TOOL_RESULT_CHARS = 600


def _transcript(task: Task | None, msgs: list[AgentMessage]) -> str:
    out = []
    if task is not None:
        out.append(f"TASK: {task.title}\n{task.brief}".strip())
    for m in msgs:
        if not m.content:
            continue
        if m.role == "tool":
            out.append(f"TOOL {m.name}: {m.content[:TOOL_RESULT_CHARS]}")
        else:
            out.append(f"{m.role.upper()}: {m.content}")
    return "\n\n".join(out)


async def learn_from_task(db: AsyncSession, task_id: str) -> facts.Learned | None:
    task = await db.get(Task, task_id)
    if task is None or task.assignee_agent_id is None or task.status not in ("review", "done"):
        return None
    agent = await db.get(Agent, task.assignee_agent_id)
    ws = await db.get(Workspace, task.workspace_id)
    if agent is None or ws is None:
        return None
    msgs = list(
        (
            await db.scalars(
                select(AgentMessage)
                .where(AgentMessage.task_id == task.id)
                .order_by(AgentMessage.id)
            )
        ).all()
    )
    learned = await facts.learn(
        db,
        agent,
        await for_agent(db, agent),
        _transcript(task, msgs),
        source_kind="task",
        source_id=task.id,
        source_label=f'task "{task.title[:120]}"',
    )
    await store.append_log(
        db,
        ws,
        f'{agent.name} finished "{task.title[:100]}" ({task.status}); memory: {learned.summary()}',
        store.Author(f"agent:{agent.id}", agent.name),
    )
    return learned


async def learn_from_chat(db: AsyncSession, message_id: int) -> facts.Learned | None:
    """`message_id` is the agent's reply; the person's message before it is the input."""
    reply = await db.get(AgentMessage, message_id)
    if reply is None or reply.session_id is None or reply.role != "assistant":
        return None
    asked = await db.scalar(
        select(AgentMessage)
        .where(
            AgentMessage.session_id == reply.session_id,
            AgentMessage.role == "user",
            AgentMessage.id < reply.id,
        )
        .order_by(AgentMessage.id.desc())
        .limit(1)
    )
    if asked is None or len(asked.content or "") < MIN_CHAT_CHARS:
        return None
    agent = await db.get(Agent, reply.agent_id)
    session = await db.get(ChatSession, reply.session_id)
    if agent is None or session is None:
        return None
    return await facts.learn(
        db,
        agent,
        await for_agent(db, agent),
        _transcript(None, [asked, reply]),
        source_kind="chat",
        source_id=session.id,
        source_label=f'chat "{session.title[:120]}"',
    )
