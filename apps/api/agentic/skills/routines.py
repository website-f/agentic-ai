"""P36: routines, the office's own way of doing a job it has done before without the paid
model. A skill is advice the model reads and follows again (every step costs tokens); a
routine is the steps themselves: the tool calls of finished work, with the values that change
from job to job (a customer, a month, a product) as slots.

Learning (after a task, in the skill_reflect activity, `learn`):
- Only work that went cleanly: every tool call worked, nothing was asked of a person or
  another agent, no browser or code (their steps depend on what was on screen or written).
- If a routine with the same steps already exists for this kind of task, the task confirms
  it (no model call). A routine confirmed by two tasks that people accepted goes live.
- Otherwise the model turns the work into a routine once (slots, steps, how the answer is
  written), and it is checked without any model: the routine filled with the task's own
  values must give back exactly the calls the agent made, every slot value must be in the
  task, and no step may reuse a value an earlier step found (that would be stale next time).

Using (at the start of a task, `step` in the runtime):
- A live routine whose task is close in meaning, whose tools this agent has, is followed.
- The slots are read from the task by the cheapest model (every value must be in the task's
  own words, else it is not used); a routine without slots needs no model at all.
- Each step goes through the same policy and approvals as the agent's own calls.
- The answer is the routine's template, or written from the results by the cheapest model
  with no tools and a short prompt.
- Any step that fails hands the task to the agent, with everything done so far.
- The finished work goes through the same self-check, goal and review as any other.
A routine whose results are sent back or fail twice in a row pauses itself.
"""

import hashlib
import json
import logging
import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from ..brain import embed
from ..engine import gateway
from ..models import (
    Agent,
    AgentMessage,
    Branch,
    LLMCall,
    Routine,
    Task,
    TaskEvent,
    Workspace,
)
from ..services import events

log = logging.getLogger("agentic.routines")

MATCH = 0.86  # task <-> routine similarity to follow it (multilingual MiniLM)
CONFIRM = 0.80  # a finished task this close, done the same way, confirms a routine
CONFIRMATIONS = 2  # accepted tasks before a learned routine goes live on its own
PAUSE_AFTER = 2  # results sent back or failed in a row
STEPS_PER_CALL = 6  # tool calls per activity call (each may take up to 45 s)
MAX_STEPS = 12
MAX_RESULT_CHARS = 4000  # per step, in the write-up prompt
# Drafting a routine costs one smart-model call; work that never repeats would waste it, so
# each workspace drafts at most this many a day (confirming an existing one is free).
DRAFTS_PER_DAY = 30
COMPOSE_TOKENS = 1500
SLOT = re.compile(r"\{\{\s*([a-z][a-z0-9_]{0,39})\s*\}\}")
ANSWER = "answer"

# Never part of a routine: they need a person, another agent, a screen or code written for
# the occasion, or they change how the office works.
FORBIDDEN = frozenset(
    {
        "ask_human",
        "ask_colleague",
        "consult",
        "delegate",
        "split_work",
        "message_agent",
        "run_python",
        "propose_skill",
        "schedule_task",
        "cancel_schedule",
        "tool_call",
        "tool_search",
        "tool_describe",
    }
)
FORBIDDEN_PREFIXES = ("browser_", "pc_")
# The agent's own bookkeeping: left out of the routine (it does not change the result).
SKIPPED = frozenset(
    {"use_skill", "report_progress", "expand_result", "memory", "remember", "recall"}
)
_FAILED = re.compile(
    r"^\s*(Error|Blocked by policy|Stopped)|denied this request|No one answered within"
    r"|Traceback \(most recent call last\)",
    re.IGNORECASE,
)


def _now() -> datetime:
    return datetime.now(UTC)


def failed(result: str | None) -> bool:
    return bool(_FAILED.search(result or ""))


def forbidden(tool: str) -> bool:
    return tool in FORBIDDEN or tool.startswith(FORBIDDEN_PREFIXES)


def _norm(text: str) -> str:
    return " ".join((text or "").lower().split())


def task_text(task: Task) -> str:
    return f"{task.title}\n{task.brief or ''}".strip()


# ---------------------------------------------------------------- templates


def render(value: Any, values: dict[str, str]) -> Any:
    """Fill {{slot}} and {{answer}} in strings, lists and dicts."""
    if isinstance(value, str):
        return SLOT.sub(lambda m: values.get(m.group(1), m.group(0)), value)
    if isinstance(value, list):
        return [render(v, values) for v in value]
    if isinstance(value, dict):
        return {k: render(v, values) for k, v in value.items()}
    return value


def names_in(value: Any) -> set[str]:
    if isinstance(value, str):
        return set(SLOT.findall(value))
    if isinstance(value, list):
        return set().union(*(names_in(v) for v in value)) if value else set()
    if isinstance(value, dict):
        return set().union(*(names_in(v) for v in value.values())) if value else set()
    return set()


def _strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [s for v in value for s in _strings(v)]
    if isinstance(value, dict):
        return [s for v in value.values() for s in _strings(v)]
    return []


def _same(a: Any, b: Any) -> bool:
    return json.dumps(a, sort_keys=True, ensure_ascii=False) == json.dumps(
        b, sort_keys=True, ensure_ascii=False
    )


# ---------------------------------------------------------------- trajectories


@dataclass
class Call:
    tool: str
    args: dict[str, Any]
    result: str


def trajectory(msgs: list[AgentMessage]) -> list[Call] | None:
    """The tool calls of a finished run, in order, with their results. None when the run
    is not something a routine can repeat."""
    results = {m.tool_call_id: (m.content or "") for m in msgs if m.role == "tool"}
    calls: list[Call] = []
    for m in msgs:
        if m.role != "assistant" or not m.tool_calls:
            continue
        if (m.meta or {}).get("routine"):
            return None  # already a routine's run
        for c in m.tool_calls:
            fn = c.get("function") or {}
            name = str(fn.get("name") or "")
            if name in SKIPPED:
                continue
            if forbidden(name):
                return None
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except (TypeError, ValueError):
                return None
            if not isinstance(args, dict):
                return None
            result = results.get(c.get("id"))
            if result is None or failed(result):
                return None
            calls.append(Call(name, args, result))
    if not calls or len(calls) > MAX_STEPS:
        return None
    return calls


def check(
    text: str,
    calls: list[Call],
    final: str,
    slots: list[dict[str, Any]],
    steps: list[dict[str, Any]],
    answer: dict[str, Any],
) -> str | None:
    """Why this routine cannot be trusted to repeat the work, or None. No model involved."""
    if [s.get("tool") for s in steps] != [c.tool for c in calls]:
        return "its steps are not the calls the agent made"
    names = {str(s.get("name") or "") for s in slots}
    if len(names) != len(slots) or any(not SLOT.fullmatch("{{" + n + "}}") for n in names):
        return "a slot has no usable name"
    if ANSWER in names:
        return "a slot may not be called answer"
    plain = _norm(text)
    values: dict[str, str] = {}
    for s in slots:
        ex = str(s.get("example") or "").strip()
        if not ex or _norm(ex) not in plain:
            return f"the value of {s.get('name')} is not in the task"
        values[str(s["name"])] = ex
    used: set[str] = set()
    composed = False
    for i, (step, call) in enumerate(zip(steps, calls, strict=True)):
        args = step.get("args")
        if not isinstance(args, dict):
            return f"step {i + 1} has no arguments"
        inside = names_in(args)
        unknown = inside - names - {ANSWER}
        if unknown:
            return f"step {i + 1} uses {sorted(unknown)[0]}, which is not a slot"
        used |= inside
        if ANSWER in inside:
            composed = True  # written from the results: checked when it runs
            continue
        if composed:
            return f"step {i + 1} comes after the write-up but does not use it"
        if not _same(render(args, values), call.args):
            return f"step {i + 1} filled with this task's values is not the call the agent made"
        # A value an earlier step found (an id, a link) would be stale next time.
        earlier = " ".join(c.result for c in calls[:i])
        for v in _strings(args):
            if names_in(v):
                continue
            v = v.strip()
            if len(v) >= 6 and _norm(v) not in plain and v in earlier:
                return f"step {i + 1} reuses {v[:40]!r}, found by an earlier step"
    if names - used:
        return "a slot is never used"
    mode = answer.get("mode")
    if mode == "template":
        out = render(str(answer.get("text") or ""), values)
        if names_in(out) or _norm(out) != _norm(final):
            return "the answer template does not give back the agent's answer"
    elif mode != "compose" or not str(answer.get("text") or "").strip():
        return "it does not say how to write the answer"
    return None


def captures(template: str, got: str) -> dict[str, str] | None:
    """The slot values that make `template` read exactly `got`, or None."""
    parts = SLOT.split(template)  # literal, name, literal, name, ...
    pattern = "".join(re.escape(p) if i % 2 == 0 else f"(?P<{p}>.+?)" for i, p in enumerate(parts))
    try:
        m = re.fullmatch(pattern, got, re.DOTALL)
    except re.error:  # the same slot twice: compare the filled template instead
        return None
    return {k: v for k, v in m.groupdict().items()} if m else None


def confirms(r: Routine, text: str, calls: list[Call]) -> bool:
    """Was this work done the routine's way? Same tools in the same order, the same fixed
    values, and every slot's value present in the task. No model involved."""
    if [s.get("tool") for s in r.steps] != [c.tool for c in calls]:
        return False
    plain = _norm(text)
    for step, call in zip(r.steps, calls, strict=True):
        tpl = step.get("args") or {}
        if ANSWER in names_in(tpl):
            continue
        if set(tpl) != set(call.args):
            return False
        for k, v in tpl.items():
            got = call.args.get(k)
            if isinstance(v, str) and names_in(v):
                # The same template, filled with values that are all in this task.
                found = captures(v, got) if isinstance(got, str) else None
                if found is None or any(_norm(x) not in plain for x in found.values()):
                    return False
            elif not _same(v, got):
                return False
    return True


# ---------------------------------------------------------------- learning


async def _branch_for(db: AsyncSession, agent: Agent | None) -> str | None:
    """A routine belongs to the company it was learned in: its fixed values (a supplier, a
    portal, a price list) are that company's, so another company never replays them."""
    if agent is None or not agent.branch_id:
        return None
    b = await db.get(Branch, agent.branch_id)
    return b.id if b is not None else None


async def _task_tokens(db: AsyncSession, task_id: str, *, prefix: str = "agent.task") -> int:
    total = await db.scalar(
        select(func.coalesce(func.sum(LLMCall.prompt_tokens + LLMCall.completion_tokens), 0)).where(
            LLMCall.task_id == task_id, LLMCall.task.startswith(prefix)
        )
    )
    return int(total or 0)


def _visible(q: Any, agent: Agent) -> Any:
    return q.where(
        Routine.workspace_id == agent.workspace_id,
        or_(Routine.branch_id.is_(None), Routine.branch_id == agent.branch_id),
    )


async def _nearest(
    db: AsyncSession, agent: Agent, vector: list[float], statuses: tuple[str, ...], floor: float
) -> list[tuple[Routine, float]]:
    dist = Routine.embedding.cosine_distance(vector)
    q = _visible(select(Routine, (1 - dist).label("sim")), agent).where(
        Routine.status.in_(statuses), Routine.embedding.is_not(None)
    )
    rows: list[Any] = list((await db.execute(q.order_by(dist).limit(5))).all())
    return [(row[0], float(row[1])) for row in rows if float(row[1]) >= floor]


LEARN_PROMPT = """You turn a finished piece of office work into a routine the office can repeat
without thinking it through again. You get the task, the tool calls the agent made (in order,
with their arguments and the start of each result) and its final answer.

Return JSON only:
{"replayable": true or false,
 "why": "if not replayable: a few words",
 "name": "short name of the job, e.g. Monthly sales summary for a branch",
 "description": "one sentence: when this routine applies",
 "slots": [{"name": "snake_case", "description": "what it is",
            "example": "the value in THIS task"}],
 "steps": [{"tool": "same tool",
            "args": {same arguments, with {{slot}} where a value comes from the task}}],
 "answer": {"mode": "template" or "compose", "text": "..."}}

Rules:
- Keep exactly the same tools in the same order. Keep every argument; change only values that
  come from the task's own words into {{slot}} (the example is the exact words in the task).
- A value that comes from an earlier tool's result (an id, a link, a number found) cannot be a
  slot: then the work is not replayable.
- Arguments holding text the agent wrote from the results (a report body, a message, a
  summary) become exactly "{{answer}}"; such steps must come last.
- answer.mode "template": the final answer is fixed wording plus slots (text is that wording
  with {{slot}}). Otherwise "compose": text says what to write from the results (what it
  covers, its sections and format, its length), in one to three sentences.
- Not replayable when the work depended on judgement that will differ next time in a way the
  steps cannot capture.
"""


def _brief(value: Any, limit: int) -> str:
    s = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return s if len(s) <= limit else s[: limit - 1] + "…"


async def _draft(
    db: AsyncSession, ws: Workspace, task: Task, calls: list[Call], final: str
) -> dict[str, Any] | None:
    lines = [f"TASK:\n{task_text(task)[:3000]}", "", "TOOL CALLS:"]
    for i, c in enumerate(calls, 1):
        lines.append(f"{i}. {c.tool}({_brief(c.args, 1500)})\n   result: {_brief(c.result, 500)}")
    lines += ["", f"FINAL ANSWER:\n{final[:3000]}"]
    prompt = [
        {"role": "system", "content": LEARN_PROMPT},
        {"role": "user", "content": "\n".join(lines)},
    ]

    def ok(raw: str) -> bool:
        try:
            return isinstance(json.loads(raw), dict)
        except (TypeError, ValueError):
            return False

    try:
        r = await gateway.chat_first(
            db,
            ws.id,
            ("smart", "fast"),
            prompt,
            task="skill.routine",
            json_mode=True,
            max_tokens=2500,
            temperature=0,
            accept=ok,
            agent_id=task.assignee_agent_id,
            task_id=task.id,
        )
    except gateway.GatewayUnavailable:
        return None
    return json.loads(r.content)


async def _may_draft(workspace_id: str) -> bool:
    from ..core.valkey import valkey

    key = f"routines:drafts:{workspace_id}:{_now().strftime('%Y-%m-%d')}"
    try:
        n = int(await valkey().incr(key))
        if n == 1:
            await valkey().expire(key, 2 * 86400)
    except Exception:  # noqa: BLE001 - no Valkey: no counter, draft anyway
        return True
    return n <= DRAFTS_PER_DAY


async def _event(db: AsyncSession, task: Task, note: str, data: dict[str, Any]) -> None:
    from ..agents import runtime  # late: the runtime imports this module

    await runtime.task_event(db, task, "routine", "system:routines", note, data)


async def learn(db: AsyncSession, task_id: str) -> Routine | None:
    """After a task: confirm the routine it followed the way of, or learn a new candidate."""
    task = await db.get(Task, task_id)
    if task is None or task.status not in ("done", "review") or not task.result:
        return None
    if task.output_schema or task.source in ("review", "question"):
        return None
    agent = await db.get(Agent, task.assignee_agent_id) if task.assignee_agent_id else None
    ws = await db.get(Workspace, task.workspace_id)
    if agent is None or ws is None or agent.private:
        return None  # a private assistant's work is its person's, not the office's
    msgs = list(
        (
            await db.scalars(
                select(AgentMessage)
                .where(AgentMessage.task_id == task.id)
                .order_by(AgentMessage.id)
            )
        ).all()
    )
    from .reflect import FEEDBACK, SELF_CHECK

    if task.run_count > 1 or any(
        m.role == "user" and (m.content or "").startswith((FEEDBACK, SELF_CHECK)) for m in msgs
    ):
        return None  # a person or the self-check corrected it: not the way to repeat
    calls = trajectory(msgs)
    if calls is None:
        return None
    text = task_text(task)
    vector = await embed.embed_one(text)
    if vector is None:
        return None
    for r, _ in await _nearest(db, agent, vector, ("candidate", "active"), CONFIRM):
        if confirms(r, text, calls):
            if task.id not in (r.source_task_ids or []):
                r.source_task_ids = [*(r.source_task_ids or []), task.id][-10:]
                flag_modified(r, "source_task_ids")
            await db.commit()
            await _event(db, task, f"did it the way of the routine {r.name}", {"routine_id": r.id})
            await promote(db, r)
            return r
    if not await _may_draft(ws.id):
        log.info("routine drafts for today used up in %s", ws.id)
        return None
    d = await _draft(db, ws, task, calls, task.result or "")
    if not d or not d.get("replayable"):
        log.info("task %s is not replayable: %s", task.id, (d or {}).get("why"))
        return None
    slots = [s for s in d.get("slots") or [] if isinstance(s, dict)]
    steps = [s for s in d.get("steps") or [] if isinstance(s, dict)]
    raw_answer = d.get("answer")
    answer: dict[str, Any] = raw_answer if isinstance(raw_answer, dict) else {}
    why = check(text, calls, task.result or "", slots, steps, answer)
    if why:
        log.info("routine from %s rejected: %s", task.id, why)
        return None
    name = " ".join(str(d.get("name") or task.title).split())[:120]
    r = Routine(
        workspace_id=ws.id,
        branch_id=await _branch_for(db, agent),
        name=name,
        description=" ".join(str(d.get("description") or "").split())[:300],
        example=text[:4000],
        embedding=vector,
        slots=[
            {
                "name": str(s["name"]),
                "description": str(s.get("description") or "")[:200],
                "example": str(s.get("example") or "")[:200],
            }
            for s in slots
        ],
        steps=[{"tool": s["tool"], "args": s["args"]} for s in steps],
        answer={"mode": answer["mode"], "text": str(answer.get("text") or "")[:2000]},
        tools=sorted({s["tool"] for s in steps}),
        status="candidate",
        source_task_ids=[task.id],
        agent_id=agent.id,
        baseline_tokens=await _task_tokens(db, task.id) or None,
    )
    db.add(r)
    await db.commit()
    await _event(
        db,
        task,
        f"learned the routine {r.name} (it goes live once the same job is done this way again)",
        {"routine_id": r.id},
    )
    await events.publish(ws.id, "routine.updated", {"routine_id": r.id, "status": r.status})
    return r


async def promote(db: AsyncSession, r: Routine) -> bool:
    """A candidate goes live once CONFIRMATIONS of its tasks were accepted."""
    if r.status != "candidate":
        return False
    ids = list(r.source_task_ids or [])
    if len(ids) < CONFIRMATIONS:
        return False
    done = await db.scalar(
        select(func.count()).select_from(Task).where(Task.id.in_(ids), Task.status == "done")
    )
    if (done or 0) < CONFIRMATIONS:
        return False
    r.status, r.confirmed_by, r.note = "active", "system:routines", None
    await db.commit()
    await events.publish(
        r.workspace_id, "routine.updated", {"routine_id": r.id, "status": "active"}
    )
    return True


async def settle(db: AsyncSession, task_id: str, outcome: str) -> None:
    """How a task ended (accepted | sent_back | failed): counts for the routine it followed,
    and for the candidates it taught."""
    used = await db.scalar(
        select(TaskEvent)
        .where(TaskEvent.task_id == task_id, TaskEvent.kind == "routine_run")
        .order_by(TaskEvent.id.desc())
    )
    data = (used.data or {}) if used is not None else {}
    r = await db.get(Routine, data.get("routine_id")) if data.get("routine_id") else None
    if (
        used is not None
        and r is not None
        and data.get("state") == "done"
        and not data.get("settled")
    ):
        if outcome == "accepted":
            r.successes += 1
            r.failure_streak = 0
            r.tokens_saved += int(data.get("saved") or 0)
            used.data = {**data, "settled": outcome}
        elif outcome in ("sent_back", "failed"):
            r.failures += 1
            r.failure_streak += 1
            used.data = {**data, "settled": outcome}
            if r.failure_streak >= PAUSE_AFTER and r.status == "active":
                r.status = "paused"
                how = outcome.replace("_", " ")
                r.note = f"Paused: its work was {how} {PAUSE_AFTER} times in a row."
        flag_modified(used, "data")
    taught = (
        await db.scalars(
            select(Routine).where(
                Routine.status == "candidate", Routine.source_task_ids.contains([task_id])
            )
        )
    ).all()
    for c in taught:
        if outcome in ("sent_back", "failed"):
            c.source_task_ids = [i for i in c.source_task_ids or [] if i != task_id]
            flag_modified(c, "source_task_ids")
            if not c.source_task_ids:
                c.status, c.note = "retired", "Its work was not accepted."
    await db.commit()
    for c in taught:
        if outcome == "accepted":
            await promote(db, c)


# ---------------------------------------------------------------- using


@dataclass
class Plan:
    routine: Routine
    slots: dict[str, str]
    similarity: float


async def _offered(db: AsyncSession, agent: Agent, task: Task) -> set[str]:
    from ..agents import runtime  # late: the runtime imports this module
    from ..crm.access import money_ready
    from ..devices.core import pc_ready
    from ..microsoft.access import mail_ready

    schemas = runtime.offered_tools(
        agent,
        task,
        mcp=await runtime._has_mcp(db, agent.workspace_id),
        pc=await pc_ready(db, agent),
        mail=await mail_ready(db, agent),
        finance=await money_ready(db, agent),
    )
    return {str(s["function"]["name"]) for s in schemas}


SLOT_PROMPT = (
    "Read these values from the task. Copy each value exactly as it is written in the task "
    '(same words, same spelling). Answer only JSON: {"values": {"name": "value"}}; '
    "use an empty string when the task does not say."
)


def _slot_values(raw: str, names: list[str], text: str) -> dict[str, str] | None:
    try:
        d = json.loads(raw)
    except (TypeError, ValueError):
        return None
    vals = d.get("values") if isinstance(d, dict) else None
    if not isinstance(vals, dict):
        return None
    plain = _norm(text)
    out: dict[str, str] = {}
    for n in names:
        v = str(vals.get(n) or "").strip()
        if not v or _norm(v) not in plain:
            return None  # a value the task does not contain is a guess: never act on it
        out[n] = v
    return out


async def _fill(db: AsyncSession, ws: Workspace, task: Task, r: Routine) -> dict[str, str] | None:
    names = [str(s["name"]) for s in r.slots or []]
    if not names:
        return {}
    text = task_text(task)
    spec = "\n".join(
        f"- {s['name']}: {s.get('description') or ''} (e.g. {s.get('example')})" for s in r.slots
    )
    prompt = [
        {"role": "system", "content": SLOT_PROMPT},
        {"role": "user", "content": f"Values:\n{spec}\n\nTask:\n{text[:4000]}"},
    ]
    try:
        reply = await gateway.chat_first(
            db,
            ws.id,
            gateway.cheap_groups(spec, text),
            prompt,
            task="agent.routine_slots",
            json_mode=True,
            max_tokens=300,
            temperature=0,
            accept=lambda raw: _slot_values(raw, names, text) is not None,
            agent_id=task.assignee_agent_id,
            task_id=task.id,
            branch_id=task.branch_id,
        )
    except gateway.GatewayUnavailable:
        return None
    return _slot_values(reply.content, names, text)


async def match(db: AsyncSession, agent: Agent, ws: Workspace, task: Task) -> Plan | None:
    """The live routine this task should follow, with its slots filled, or None."""
    if task.output_schema or task.source == "review" or task.goal or task.device_id:
        return None
    if (ws.settings or {}).get("routines", {}).get("enabled") is False:
        return None
    vector = await embed.embed_one(task_text(task))
    if vector is None:
        return None
    near = await _nearest(db, agent, vector, ("active",), MATCH)
    if not near:
        return None
    have = await _offered(db, agent, task)
    for r, sim in near:
        if not set(r.tools or []) <= have:
            continue
        slots = await _fill(db, ws, task, r)
        if slots is None:
            continue
        return Plan(r, slots, sim)
    return None


def _call_id(i: int) -> str:
    return f"rt{i}_{secrets.token_hex(4)}"


def _state(history: list[AgentMessage]) -> tuple[dict[str, Any] | None, int, bool]:
    """(the plan stored on the run, the next step, ended?)"""
    plan: dict[str, Any] | None = None
    nxt = 0
    for m in history:
        meta = m.meta or {}
        if meta.get("routine_end"):
            return plan, nxt, True
        if m.role == "assistant" and meta.get("routine"):
            if meta.get("plan"):
                plan = meta["plan"]
            nxt = max(nxt, int(meta.get("step", -1)) + 1)
    return plan, nxt, False


def _results(history: list[AgentMessage]) -> list[tuple[str, dict[str, Any], str, str]]:
    """(tool, args, what the write-up reads, the raw result) of the routine's steps so far."""
    by_id = {m.tool_call_id: m for m in history if m.role == "tool"}
    out = []
    for m in history:
        if m.role == "assistant" and (m.meta or {}).get("routine") and m.tool_calls:
            for c in m.tool_calls:
                fn = c.get("function") or {}
                res = by_id.get(c.get("id"))
                text = raw = ""
                if res is not None:
                    raw = res.content or ""
                    text = ((res.meta or {}).get("compressed") or raw)[:MAX_RESULT_CHARS]
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except (TypeError, ValueError):
                    args = {}
                out.append((str(fn.get("name") or ""), args, text, raw))
    return out


async def _compose(
    db: AsyncSession,
    ws: Workspace,
    agent: Agent,
    task: Task,
    r: Routine,
    history: list[AgentMessage],
) -> str | None:
    lines = []
    for i, (tool, args, text, _) in enumerate(_results(history), 1):
        lines.append(f"### {i}. {tool}({_brief(args, 300)})\n{text}")
    prompt = [
        {
            "role": "system",
            "content": (
                f"You are {agent.name}, {agent.role or 'an office agent'}. The steps of a "
                "routine job have run; write the final answer to the task from their results "
                f"only. {r.answer.get('text') or ''} Never invent a fact, figure or name the "
                "results do not hold; if something is missing, say so plainly. Answer in the "
                "task's language. No preamble."
            ),
        },
        {
            "role": "user",
            "content": f"Task:\n{task_text(task)[:3000]}\n\nResults:\n" + "\n\n".join(lines),
        },
    ]
    try:
        reply = await gateway.chat_first(
            db,
            ws.id,
            ("fast",),
            prompt,
            task="agent.routine",
            max_tokens=COMPOSE_TOKENS,
            temperature=0.2,
            accept=lambda raw: len(raw.strip()) >= 20,
            agent_id=agent.id,
            task_id=task.id,
            branch_id=task.branch_id,
        )
    except gateway.GatewayUnavailable:
        return None
    return reply.content.strip()


async def _answer_of(db: AsyncSession, task: Task) -> str | None:
    ev = await db.scalar(
        select(TaskEvent)
        .where(TaskEvent.task_id == task.id, TaskEvent.kind == "routine_answer")
        .order_by(TaskEvent.id.desc())
    )
    return str((ev.data or {}).get("answer") or "") or None if ev is not None else None


async def _abort(db: AsyncSession, agent: Agent, task: Task, r: Routine | None, why: str) -> None:
    from ..agents import runtime  # late: the runtime imports this module

    name = r.name if r is not None else "the routine"
    runtime._add(
        db,
        agent,
        "user",
        task_id=task.id,
        content=(
            f"[The learned routine {name!r} stopped: {why}. Finish the task yourself. The "
            "steps above already ran: use their results, and do not repeat what worked.]"
        ),
        meta={"routine_end": "handed_over"},
    )
    if r is not None:
        r.failures += 1
        r.failure_streak += 1
        if r.failure_streak >= PAUSE_AFTER and r.status == "active":
            r.status, r.note = (
                "paused",
                f"Paused: it stopped part-way {PAUSE_AFTER} times in a row.",
            )
    await db.commit()
    await runtime.task_event(
        db,
        task,
        "routine_run",
        "system:routines",
        f"the routine {name} stopped ({why}); the agent takes over",
        {"routine_id": r.id if r else None, "state": "handed_over", "why": why},
    )


async def step(
    db: AsyncSession, ctx: Any, task: Task, agent: Agent, ws: Workspace, history: list[AgentMessage]
) -> Any:
    """Run the routine this task follows, or start one. A StepResult when the step ends here
    (done, waiting for a person, or more steps to run); None hands over to the agent."""
    from ..agents import runtime  # late: the runtime imports this module

    plan, nxt, ended = _state(history)
    if ended:
        return None
    if plan is None:
        # Only a fresh run picks a routine: the first message is the brief, nothing else yet.
        if len(history) != 1 or history[0].role != "user":
            return None
        try:
            found = await match(db, agent, ws, task)
        except Exception:  # noqa: BLE001 - a routine is a shortcut; the agent still works
            log.warning("routine matching failed for %s", task.id, exc_info=True)
            await db.rollback()
            return None
        if found is None:
            return None
        plan = {
            "routine_id": found.routine.id,
            "slots": found.slots,
            "similarity": found.similarity,
        }
        found.routine.uses += 1
        found.routine.last_used_at = _now()
        await db.commit()
        await runtime.task_event(
            db,
            task,
            "routine_run",
            "system:routines",
            f"follows the learned routine {found.routine.name}",
            {"routine_id": found.routine.id, "state": "started", "slots": found.slots},
        )
    r = await db.get(Routine, plan["routine_id"])
    if r is None:
        await _abort(db, agent, task, None, "it was deleted")
        return None
    slots: dict[str, str] = dict(plan.get("slots") or {})
    # The result of the last step that ran: a failure hands over.
    done_calls = _results(history)
    if done_calls and failed(done_calls[-1][3]):
        await _abort(
            db, agent, task, r, f"step {len(done_calls)} ({done_calls[-1][0]}) did not work"
        )
        return None
    steps = list(r.steps or [])
    answer = await _answer_of(db, task)
    ran = 0
    while nxt < len(steps):
        if ran >= STEPS_PER_CALL:
            return runtime.StepResult("continue")
        spec = steps[nxt]
        needs_answer = ANSWER in names_in(spec.get("args") or {})
        if needs_answer and answer is None:
            answer = await _write(db, ws, agent, task, r, slots)
            if answer is None:
                await _abort(db, agent, task, r, "the write-up could not be made")
                return None
        args = render(spec.get("args") or {}, {**slots, **({ANSWER: answer} if answer else {})})
        meta: dict[str, Any] = {"routine": r.id, "step": nxt}
        if nxt == 0:
            meta["plan"] = plan
        runtime._add(
            db,
            agent,
            "assistant",
            task_id=task.id,
            tool_calls=[
                {
                    "id": _call_id(nxt),
                    "type": "function",
                    "function": {
                        "name": spec["tool"],
                        "arguments": json.dumps(args, ensure_ascii=False),
                    },
                }
            ],
            meta=meta,
        )
        await db.commit()
        history = await runtime._history(db, task_id=task.id)
        waiting = await runtime._resolve_calls(db, ctx, task, history)
        if waiting is not None:
            return waiting  # an approval: the run comes back here once it is decided
        history = await runtime._history(db, task_id=task.id)
        last = _results(history)
        if last and failed(last[-1][3]):
            await _abort(db, agent, task, r, f"step {nxt + 1} ({spec['tool']}) did not work")
            return None
        nxt += 1
        ran += 1
    if answer is None:
        answer = await _write(db, ws, agent, task, r, slots)
        if answer is None:
            await _abort(db, agent, task, r, "the write-up could not be made")
            return None
    used = await _task_tokens(db, task.id, prefix="agent.routine")
    saved = max(0, (r.baseline_tokens or 0) - used)
    runtime._add(
        db,
        agent,
        "assistant",
        task_id=task.id,
        content=answer,
        meta={"routine_end": "done", "routine": r.id, "tokens": used},
    )
    r.failure_streak = 0
    await db.commit()
    await runtime.task_event(
        db,
        task,
        "routine_run",
        "system:routines",
        f"finished with the routine {r.name}: {used:,} tokens instead of about "
        f"{r.baseline_tokens or 0:,}",
        {"routine_id": r.id, "state": "done", "tokens": used, "saved": saved},
    )
    await runtime.activity(agent, task, "answer", text=runtime._brief(answer, 600))
    return runtime.StepResult("done", answer)


async def _write(
    db: AsyncSession,
    ws: Workspace,
    agent: Agent,
    task: Task,
    r: Routine,
    slots: dict[str, str],
) -> str | None:
    """The answer: the template filled in (no model), or written from the results."""
    from ..agents import runtime  # late: the runtime imports this module

    if r.answer.get("mode") == "template":
        text = render(str(r.answer.get("text") or ""), slots)
        out = None if names_in(text) else text.strip() or None
    else:
        out = await _compose(db, ws, agent, task, r, await runtime._history(db, task_id=task.id))
    if out:
        await runtime.task_event(
            db, task, "routine_answer", "system:routines", "wrote the answer", {"answer": out}
        )
    return out


# ---------------------------------------------------------------- reading


def fingerprint(r: Routine) -> str:
    return hashlib.sha256(json.dumps(r.steps, sort_keys=True).encode()).hexdigest()[:12]
