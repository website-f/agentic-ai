"""Lessons (P92): what people teach the agents when they correct them, kept on the spot.

When a person corrects an agent (sends work back, answers its question with a rule, turns a
request down with a reason, corrects it in chat, or says "remember this"), ONE lesson is
written at once with a small model call: one plain sentence plus its structure (when, do,
don't, the field it is about, an example). It is a brain fact (source_kind "lesson") with the
structure in `meta`, so recall, dedup, "a newer lesson on the same point replaces the older
one" and forgetting all work as for any fact. Secrets never get in: the person's words are
masked before the model sees them and the lesson is checked again before it is kept.

Lessons are used every time: a task of a topic (ePerolehan tenders, or the skill the work
follows) starts with the best lessons of that topic in its first message, a rerun after a
send-back gets them again, and chat turns about the topic carry them too. Each use is counted
(`hits`, `last_used_at`). At night the dream folds new lessons into the topic's skill
Pitfalls through the normal proposal -> tests -> autopilot path (fold_into_skills).

Who sees what: a lesson taught to a team agent is shared with that agent's company (branch);
one taught to someone's own AI stays with that AI, unless a manager (agents.manage) taught it.
A private assistant's lessons are always its own.
"""

import logging
import math
import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core import threats
from ..core.fence import defuse
from ..core.redact import redact
from ..core.security import can
from ..engine import gateway
from ..models import Agent, BrainFact, Membership, Skill, SkillUse, Task, User
from . import embed
from .facts import _SECRET as FACT_SECRET
from .facts import _now, end, mark_used, parse_json, scope_filter
from .scope import Viewer, for_agent

log = logging.getLogger("agentic.brain.lessons")

KIND = "lesson"
EPEROLEHAN = "eperolehan"
GENERAL = "general"
TOPIC_LABEL = {EPEROLEHAN: "ePerolehan", GENERAL: "general work"}
# A topic's lessons are folded into this skill's Pitfalls at night.
TOPIC_SKILL = {EPEROLEHAN: "eperolehan-tender"}
GENERIC_LABELS = frozenset({"web", "chat", "urgent", "review", "schedule"})

BLOCK_LIMIT = 12
CANDIDATES = 5
CANDIDATE_SIMILARITY = 0.5
GUESS_REPLACE = 0.9  # no model: a lesson this close to an older one on the topic replaces it
MIN_CHARS = 12
MAX_TEXT = 300
MAX_FIELD = 200
CONFIDENCE = 0.95  # a person said it
FIELDS = ("when", "do", "dont", "field", "example")

VIA_LABEL = {
    "send_back": "sent the work back",
    "ask_human": "answered a question",
    "denial": "turned a request down",
    "chat": "corrected it in chat",
    "remember": "asked it to remember",
    "edit": "edited the lesson",
}

_EPEROLEHAN = re.compile(
    r"e-?perolehan|\btender|sebut ?harga|cetak tawaran|no\.? ?cadangan|\bqt\d{4,}", re.I
)
# Explicit "keep this for next time", in English and Malay.
REMEMBER = re.compile(
    r"\b(remember (this|that|how)|don'?t forget|take note|note (this|that)|for next time|"
    r"next time|from now on|ingat (ini|tu|cara)|jangan lupa|lain kali|mulai sekarang|"
    r"catat(kan)?)\b",
    re.I,
)
# Words that make an answer a rule rather than a one-off reply.
RULE = re.compile(
    r"\b(always|never|must|should|don'?t|do not|instead|make sure|wrong|not like that|"
    r"use the|the right|correct (one|way)|jangan|mesti|wajib|perlu|sepatutnya|salah|bukan|"
    r"gunakan|guna|pastikan|kena|betul)\b",
    re.I,
)
# Secrets are never stored, whatever the model writes. Mentioning "the password" is fine (a
# lesson may be about where it goes); a value after it, an OTP, a key or a number is not.
_SECRET = re.compile(
    r"(\[redacted\]|sk-[A-Za-z0-9_-]{12,}|-----BEGIN|\b\d{6}-\d{2}-\d{4}\b"
    r"|\b(?:\d[ -]?){13,19}\b"
    r"|\b(?:password|passwd|pwd|kata ?laluan|pin|secret|token|api[_ -]?key)\b\s*"
    r"(?:is|ialah|adalah|:|=)\s*\S+"
    r"|\b(?:password|passwd|pwd|kata ?laluan|pin|secret|token)\s+\S*\d\S*"
    r"|\b(?:otp|tac|pin|verification code|security code|kod pengesahan|kod keselamatan)"
    r"\W{0,5}\d{3,8}\b)",
    re.I,
)

DISTIL = """A person has just corrected an AI office agent, or told it how to do something.
Turn it into ONE lesson the agent follows next time. Return JSON only:
{"lesson": {"text": "one plain sentence: the rule for next time",
            "when": "the situation it applies to", "do": "what to do",
            "dont": "what not to do, or empty", "field": "the form field or step, or empty",
            "example": "a short example, or empty"},
 "same_as": null, "replaces": null}
Rules:
- A general rule for next time, not a story of what happened. Use the person's language.
- Keep names of portals, forms, fields, buttons and documents exactly as the person wrote them.
- Never copy a password, PIN, OTP or TAC, security answer, login ID, IC or card number or any
  code from the conversation; describe it instead ("the PIN the person gives").
- If an EXISTING lesson already says the same, set "same_as" to its id. If the new lesson
  updates or contradicts an existing one, set "replaces" to its id (the new one wins).
- If the message only answers this one case (a yes, a choice, a date, a figure for this job)
  and teaches nothing for next time, return {"lesson": null}."""


@dataclass
class Noted:
    fact: BrainFact
    action: str  # added | replaced | confirmed
    replaced_text: str | None = None

    def event(self) -> dict[str, Any]:
        """What the task timeline / chat shows: "Noted for next time: ..." with Undo."""
        return {
            "lesson_id": self.fact.id,
            "text": self.fact.text,
            "action": self.action,
            "topic": (self.fact.meta or {}).get("topic"),
            "replaced": self.replaced_text,
        }


# ---------------------------------------------------------------- topics


def topic_label(topic: str | None) -> str:
    if not topic:
        return TOPIC_LABEL[GENERAL]
    return TOPIC_LABEL.get(topic, topic.replace("-", " "))


def topic_of_text(text: str) -> str | None:
    return EPEROLEHAN if _EPEROLEHAN.search(text or "") else None


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.strip().lower()).strip("-")[:60]


def base_topic(task: Task) -> str | None:
    """The topic a task's own words and labels give, before any skill is involved."""
    labels = [str(x).lower() for x in task.labels or []]
    if "tender" in labels or EPEROLEHAN in labels:
        return EPEROLEHAN
    return topic_of_text(f"{task.title}\n{(task.brief or '')[:3000]}")


async def _skills_of(db: AsyncSession, task: Task, agent: Agent | None) -> list[str]:
    """The skills a task used so far, then the one closest to it (P36 hint)."""
    used = list(
        (
            await db.scalars(
                select(Skill.name)
                .join(SkillUse, SkillUse.skill_id == Skill.id)
                .where(SkillUse.task_id == task.id)
                .order_by(SkillUse.id)
            )
        ).all()
    )
    if agent is not None:
        from ..skills import store as skills_store  # late: skills import the brain

        try:
            near = await skills_store.nearest(
                db, task.workspace_id, await embed.embed_one(f"{task.title}\n{task.brief}"[:2000])
            )
        except Exception:  # noqa: BLE001 - a topic guess is a nicety
            near = None
        if near is not None and near[1] >= skills_store.HINT_SIMILARITY:
            used.append(near[0].name)
    return list(dict.fromkeys(used))


def _label_topic(task: Task) -> str | None:
    for raw in task.labels or []:
        lab = _slug(str(raw))
        if lab and lab not in GENERIC_LABELS:
            return lab
    return None


async def task_topic(db: AsyncSession, task: Task, agent: Agent | None = None) -> str:
    """One topic to file a lesson under: ePerolehan, else the skill the work follows, else
    the task's first label, else general."""
    return (
        base_topic(task)
        or next(iter(await _skills_of(db, task, agent)), None)
        or _label_topic(task)
        or GENERAL
    )


async def task_topics(db: AsyncSession, task: Task, agent: Agent | None = None) -> list[str]:
    """Every topic whose lessons a run of this task should get (most specific first)."""
    out = [t for t in (base_topic(task),) if t]
    out += await _skills_of(db, task, agent)
    if lab := _label_topic(task):
        out.append(lab)
    out.append(GENERAL)
    return list(dict.fromkeys(out))


# ---------------------------------------------------------------- safety


def safe(text: str | None, limit: int = MAX_TEXT) -> str | None:
    t = re.sub(r"\s+", " ", str(text or "")).strip().strip("-• ").strip()
    if not t or _SECRET.search(t) or threats.scan(t, "strict"):
        return None
    return t[:limit]


_VALUE_AFTER = re.compile(
    r"\b(password|passwd|pwd|kata ?laluan|pin|secret|token|otp|tac|verification code|"
    r"security code|kod pengesahan|kod keselamatan)"
    r"(\s*(?:is|ialah|adalah|:|=)?\s*)(\S*\d[^\s.,;]*)",
    re.I,
)


def scrub(text: str) -> str:
    """The person's words with every secret value masked, before any model sees them."""
    return _VALUE_AFTER.sub(lambda m: f"{m.group(1)}{m.group(2)}[redacted]", redact(text or ""))


def has_secret(text: str) -> bool:
    return bool(_SECRET.search(redact(text or "")))


def worth_a_lesson(answer: str, question: str = "", options: list[str] | None = None) -> bool:
    """An answer to an agent's question that carries a rule ("No, always use ..."), not a
    one-off reply ("September", one of the offered options)."""
    a = (answer or "").strip()
    if len(a) < 20 or a.lower() in {str(o).strip().lower() for o in options or []}:
        return False
    return bool(RULE.search(a) or REMEMBER.search(a))


# ---------------------------------------------------------------- who keeps it


async def _teacher_manages(db: AsyncSession, workspace_id: str, taught_by: str) -> bool:
    if not taught_by.startswith("user:"):
        return False
    role = await db.scalar(
        select(Membership.role).where(
            Membership.workspace_id == workspace_id,
            Membership.user_id == taught_by.removeprefix("user:"),
        )
    )
    return bool(role) and can(str(role), "agents.manage")


async def _keeps_private(db: AsyncSession, agent: Agent, taught_by: str) -> bool:
    if agent.private:
        return True  # a private assistant's conversations never reach the team
    personal = bool(agent.owner_user_id) or bool(getattr(agent, "is_twin", False))
    return personal and not await _teacher_manages(db, agent.workspace_id, taught_by)


def owner_agent(agent: Agent) -> str:
    return agent.clone_of or agent.id


def _same_scope(branch_id: str | None, agent_id: str | None) -> list[ColumnElement[bool]]:
    return [
        BrainFact.branch_id.is_(None) if branch_id is None else BrainFact.branch_id == branch_id,
        BrainFact.agent_id.is_(None) if agent_id is None else BrainFact.agent_id == agent_id,
    ]


def _topic_is(topic: str) -> ColumnElement[bool]:
    return BrainFact.meta["topic"].astext == topic


async def _candidates(
    db: AsyncSession,
    v: Viewer,
    topic: str,
    vector: list[float] | None,
    scope: tuple[str | None, str | None],
) -> list[tuple[BrainFact, float]]:
    """Active lessons on the same topic, kept in the same place: the closest by meaning,
    then the most recent ones (a person often says the same thing in other words), so the
    lesson writer can tell "the same point" or "this replaces that"."""
    from .search import tune_scan  # late: search imports facts

    conds = [
        scope_filter(v),
        BrainFact.source_kind == KIND,
        _topic_is(topic),
        *_same_scope(*scope),
    ]
    out: dict[str, tuple[BrainFact, float]] = {}
    if vector is not None:
        await tune_scan(db)
        dist = BrainFact.embedding.cosine_distance(vector)
        rows = (
            await db.execute(
                select(BrainFact, (1 - dist).label("sim"))
                .where(*conds, BrainFact.embedding.is_not(None))
                .order_by(dist)
                .limit(CANDIDATES)
            )
        ).all()
        out |= {f.id: (f, float(s)) for f, s in rows if float(s) >= CANDIDATE_SIMILARITY}
    recent = (
        await db.scalars(
            select(BrainFact).where(*conds).order_by(BrainFact.created_at.desc()).limit(CANDIDATES)
        )
    ).all()
    for f in recent:
        out.setdefault(f.id, (f, 0.0))
    return sorted(out.values(), key=lambda x: -x[1])[: CANDIDATES * 2]


# ---------------------------------------------------------------- capture


async def _distil(
    db: AsyncSession, agent: Agent, user: str, task_id: str | None
) -> dict[str, Any] | None:
    """The small model's lesson, or None when no small model could answer."""
    try:
        r = await gateway.chat_first(
            db,
            agent.workspace_id,
            ("local", "fast"),
            [{"role": "system", "content": DISTIL}, {"role": "user", "content": user}],
            task="brain.lesson",
            max_tokens=500,
            temperature=0,
            json_mode=True,
            accept=lambda c: "lesson" in parse_json(c),
            agent_id=agent.id,
            task_id=task_id,
        )
    except gateway.GatewayUnavailable:
        return None
    return parse_json(r.content)


def _compose(fields: dict[str, str]) -> str:
    """A sentence from the parts, when the model gave parts but no sentence."""
    out = ""
    if fields.get("when"):
        out = f"When {fields['when'].rstrip('.')}, "
    if fields.get("do"):
        out += fields["do"].rstrip(".")
    if fields.get("dont"):
        out += ("; " if fields.get("do") else "") + f"do not {fields['dont'].rstrip('.')}"
    return (out[:1].upper() + out[1:] + ".") if out else ""


async def capture(
    db: AsyncSession,
    agent: Agent,
    said: str,
    *,
    via: str,
    taught_by: str,
    task: Task | None = None,
    session_id: str | None = None,
    context: str = "",
    topic: str | None = None,
    guess: bool = True,
) -> Noted | None:
    """Keep ONE lesson from a person's correction, now. `guess`: when no small model is
    available, keep the person's own words as the lesson (False: keep nothing). Commits."""
    said = (said or "").strip()
    if len(said) < MIN_CHARS or not taught_by.startswith("user:"):
        return None  # only people teach lessons; a reviewer agent's notes are not one
    try:
        noted = await _capture(
            db, agent, said, via, taught_by, task, session_id, context, topic, guess
        )
    except Exception:  # noqa: BLE001 - a lesson is a bonus; the correction itself stands
        log.warning("could not keep a lesson for %s", agent.id, exc_info=True)
        await db.rollback()
        return None
    if noted is not None and task is not None:
        await _retire_routines(db, task.id, noted.fact.text)
    return noted


async def _retire_routines(db: AsyncSession, task_id: str, lesson: str) -> None:
    """P96: work a learned routine did (or did the routine's way) was corrected: the routine
    stops repeating it (skills/routines.py corrected)."""
    from ..skills import routines  # late: skills reach the runtime

    try:
        await routines.corrected(db, task_id, lesson)
    except Exception:  # noqa: BLE001 - the lesson is kept either way
        log.warning("could not pause the routines of %s", task_id, exc_info=True)
        await db.rollback()


async def _capture(
    db: AsyncSession,
    agent: Agent,
    said: str,
    via: str,
    taught_by: str,
    task: Task | None,
    session_id: str | None,
    context: str,
    topic: str | None,
    guess: bool,
) -> Noted | None:
    topic = topic or (
        await task_topic(db, task, agent)
        if task is not None
        else topic_of_text(f"{context}\n{said}") or GENERAL
    )
    plain = scrub(said)[:2000]
    v = await for_agent(db, agent)
    private = await _keeps_private(db, agent, taught_by)
    scope = (None, owner_agent(agent)) if private else (agent.branch_id, None)
    cands = await _candidates(db, v, topic, await embed.embed_one(plain), scope)

    work = f'the task "{scrub(task.title)[:150]}"' if task is not None else "a chat"
    lines = [
        f"How it was taught: the person {VIA_LABEL.get(via, via)}.",
        f"Agent: {agent.name}, {agent.role}",
        f"Work: {work}",
        f"Topic: {topic_label(topic)}",
    ]
    if context.strip():
        lines.append(f"Context: {scrub(context)[:800]}")
    lines += ["", f"What the person said: {plain}", "", "EXISTING lessons on this topic:"]
    lines += [f"- {f.id}: {f.text}" for f, _ in cands] or ["(none)"]
    got = await _distil(db, agent, "\n".join(lines), task.id if task is not None else None)

    same: BrainFact | None = None
    old: BrainFact | None = None
    known = {f.id: f for f, _ in cands}
    if got is None:
        if not guess:
            return None
        # The person's own words, without any sentence that held a secret.
        keep = " ".join(
            s for s in re.split(r"(?<=[.!?;])\s+", plain) if "[redacted]" not in s
        ).strip()
        raw: dict[str, Any] = {"text": keep, "do": keep}
        if cands and cands[0][1] >= GUESS_REPLACE:
            old = cands[0][0]
    else:
        lesson = got.get("lesson")
        if not isinstance(lesson, dict):
            return None  # nothing for next time in it
        raw = lesson
        same = known.get(str(got.get("same_as"))) if got.get("same_as") else None
        old = known.get(str(got.get("replaces"))) if got.get("replaces") else None
    fields = {k: safe(raw.get(k), MAX_FIELD) or "" for k in FIELDS}
    text = safe(raw.get("text")) or safe(_compose(fields))
    if not text:
        return None
    exact = next((f for f, _ in cands if f.text.strip().lower() == text.lower()), None)
    exact = exact or await db.scalar(
        select(BrainFact).where(
            scope_filter(v),
            BrainFact.source_kind == KIND,
            _topic_is(topic),
            *_same_scope(*scope),
            func.lower(BrainFact.text) == text.lower(),
        )
    )
    now = _now()
    if exact is not None or same is not None:
        f = exact or same
        assert f is not None
        f.confidence = min(1.0, f.confidence + 0.05)
        f.meta = {
            **(f.meta or {}),
            "taught": int((f.meta or {}).get("taught") or 1) + 1,
            "last_taught_at": now.isoformat(),
        }
        await db.commit()
        return Noted(f, "confirmed")

    who = await _name(db, taught_by)
    meta: dict[str, Any] = {
        "topic": topic,
        **{k: val for k, val in fields.items() if val},
        "agent_id": owner_agent(agent),
        "via": via,
        "taught": int((old.meta or {}).get("taught") or 1) + 1 if old is not None else 1,
        "last_taught_at": now.isoformat(),
    }
    if (said_safe := safe(plain, 500)) is not None:
        meta["said"] = said_safe
    if task is not None:
        meta["task_id"] = task.id
    if session_id:
        meta["session_id"] = session_id
    if old is not None:
        meta["replaced"] = old.id
    fact = BrainFact(
        workspace_id=agent.workspace_id,
        branch_id=scope[0],
        agent_id=scope[1],
        text=text,
        embedding=await embed.embed_one(text),
        source_kind=KIND,
        source_id=task.id if task is not None else session_id,
        source_label=f"lesson taught by {who}"[:200],
        created_by=taught_by,
        confidence=CONFIDENCE,
        valid_from=now,
        created_at=now,
        meta=meta,
    )
    db.add(fact)
    await db.flush()
    replaced_text = None
    if old is not None:
        end(old, "replaced", fact.id)
        replaced_text = old.text
    await db.commit()
    return Noted(fact, "replaced" if old is not None else "added", replaced_text)


async def _name(db: AsyncSession, actor: str) -> str:
    if actor.startswith("user:"):
        u = await db.get(User, actor.removeprefix("user:"))
        if u is not None:
            return u.name
    return "a person"


# ---------------------------------------------------------------- using lessons


def _rank(f: BrainFact, now: datetime) -> float:
    """Confidence first, then how recently it was taught, then how often it was used."""
    taught = (f.meta or {}).get("last_taught_at")
    try:
        when = datetime.fromisoformat(taught) if taught else f.valid_from
    except ValueError:
        when = f.valid_from
    days = max(0.0, (now - when).total_seconds() / 86400) if when else 365.0
    return 2.0 * f.confidence + math.exp(-days / 30) + math.log1p(f.hits or 0) / 3


async def best(
    db: AsyncSession, agent: Agent, topics: list[str], limit: int = BLOCK_LIMIT
) -> list[BrainFact]:
    """The best lessons for these topics that this agent may see. A topic's lessons are
    shared by every agent that works on it; general lessons only by the agent taught."""
    if not topics:
        return []
    v = await for_agent(db, agent)
    me = owner_agent(agent)
    specific = [t for t in topics if t != GENERAL]
    conds = []
    if specific:
        conds.append(BrainFact.meta["topic"].astext.in_(specific))
    if GENERAL in topics:
        conds.append(_topic_is(GENERAL) & (BrainFact.meta["agent_id"].astext == me))
    rows = (
        await db.scalars(
            select(BrainFact)
            .where(scope_filter(v), BrainFact.source_kind == KIND, or_(*conds))
            .order_by(BrainFact.created_at.desc())
            .limit(300)
        )
    ).all()
    now = _now()
    order = {t: i for i, t in enumerate(topics)}
    ranked = sorted(
        rows,
        key=lambda f: (order.get(str((f.meta or {}).get("topic")), 99), -_rank(f, now)),
    )
    return ranked[:limit]


async def _in_skill(db: AsyncSession, workspace_id: str, topics: list[str]) -> str:
    """The live text of the topics' skills (a lesson already in it needs no repeating)."""
    names = [TOPIC_SKILL.get(t, t) for t in topics if t != GENERAL]
    if not names:
        return ""
    bodies = (
        await db.scalars(
            select(Skill.body).where(
                Skill.workspace_id == workspace_id, Skill.name.in_(names), Skill.status == "active"
            )
        )
    ).all()
    return "\n".join(bodies).lower()


def _line(f: BrainFact) -> str:
    m = f.meta or {}
    out = f"- {f.text}"
    if m.get("field") and str(m["field"]).lower() not in f.text.lower():
        out += f" (field: {m['field']})"
    if m.get("example") and str(m["example"]).lower() not in f.text.lower():
        out += f" Example: {m['example']}"
    return defuse(out)


async def block(
    db: AsyncSession, agent: Agent, topics: list[str], *, count: bool = True
) -> tuple[str, list[BrainFact]]:
    """The "Lessons learned for <topic>" block for a prompt, and the lessons in it. Each
    use is counted."""
    rows = await best(db, agent, topics)
    known = await _in_skill(db, agent.workspace_id, topics)
    rows = [f for f in rows if not (known and f.text.lower() in known)]
    if not rows:
        return "", []
    head = next((t for t in topics if t != GENERAL), GENERAL)
    title = (
        f"Lessons learned for {topic_label(head)}"
        if head != GENERAL
        else "Lessons people taught you"
    )
    text = "\n".join(
        [
            '<lessons note="Taught by the people who corrected this kind of work. Follow them '
            'unless the task or a person now says otherwise.">',
            f"{title}:",
            *[_line(f) for f in rows],
            "</lessons>",
        ]
    )
    if count:
        await mark_used(db, rows)
        await db.commit()
    return text, rows


async def block_for_task(db: AsyncSession, agent: Agent, task: Task) -> tuple[str, int]:
    text, rows = await block(db, agent, await task_topics(db, task, agent))
    return text, len(rows)


async def block_for_chat(db: AsyncSession, agent: Agent, text: str) -> str:
    topics = [t for t in (topic_of_text(text),) if t] + [GENERAL]
    out, _ = await block(db, agent, topics)
    return out


# ---------------------------------------------------------------- undo, edit, views


async def undo(db: AsyncSession, f: BrainFact) -> BrainFact | None:
    """Take a lesson back. The lesson it replaced (if any) comes back. Returns that one."""
    back = None
    if f.valid_to is None:
        end(f, "undone")
    rid = (f.meta or {}).get("replaced")
    if rid:
        prev = await db.get(BrainFact, str(rid))
        if prev is not None and prev.superseded_by == f.id:
            prev.valid_to, prev.end_reason, prev.superseded_by = None, None, None
            back = prev
    await db.commit()
    return back


async def correct(
    db: AsyncSession, old: BrainFact, changes: dict[str, Any], editor: str
) -> BrainFact:
    """A person edits a lesson: the correction is a new lesson that replaces the old one
    (the old one is kept, ended, so the change is on record)."""
    meta = dict(old.meta or {})
    for k in FIELDS:
        if k in changes and changes[k] is not None:
            val = safe(changes[k], MAX_FIELD) if str(changes[k]).strip() else ""
            if val is None:
                raise ValueError("Lessons never hold passwords, codes or other secrets.")
            meta[k] = val
    text = old.text
    if changes.get("text") is not None:
        t = safe(changes["text"])
        if not t or len(t) < 8:
            raise ValueError(
                "Write the lesson as one short sentence, with no passwords, codes or secrets."
            )
        text = t
    if changes.get("topic"):
        meta["topic"] = _slug(str(changes["topic"])) or meta.get("topic") or GENERAL
    meta = {k: v for k, v in meta.items() if v not in ("", None)}
    meta.update(via="edit", edited_from=old.id, last_taught_at=_now().isoformat())
    meta.pop("replaced", None)
    now = _now()
    new = BrainFact(
        workspace_id=old.workspace_id,
        branch_id=old.branch_id,
        agent_id=old.agent_id,
        text=text,
        embedding=await embed.embed_one(text),
        source_kind=KIND,
        source_id=old.source_id,
        source_label=f"lesson corrected by {await _name(db, editor)}"[:200],
        created_by=editor,
        confidence=CONFIDENCE,
        hits=old.hits,
        last_used_at=old.last_used_at,
        valid_from=now,
        created_at=now,
        meta=meta,
    )
    db.add(new)
    await db.flush()
    end(old, "replaced", new.id)
    await db.commit()
    return new


def day_bounds(day: date, tz: str) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time(0), ZoneInfo(tz)).astimezone(UTC)
    return start, start + timedelta(days=1)


# ---------------------------------------------------------------- the nightly fold


FOLD_BY = "lessons"  # SkillProposal.proposed_by of a fold
PITFALLS = re.compile(r"^##\s*Pitfalls\s*$", re.I | re.M)


def fold_body(body: str, add: list[str], drop: list[str]) -> str:
    """The skill text with these lessons in its Pitfalls (a replaced lesson's line goes)."""
    lines = body.rstrip("\n").split("\n")
    gone = {d.strip().lower() for d in drop}
    lines = [ln for ln in lines if ln.strip().lstrip("- ").strip().lower() not in gone]
    text = "\n".join(lines)
    new = [f"- {a}" for a in add if a.lower() not in text.lower()]
    if not new:
        return text + "\n"
    m = PITFALLS.search(text)
    if m is None:
        return f"{text}\n\n## Pitfalls\n" + "\n".join(new) + "\n"
    nxt = re.search(r"^##\s", text[m.end() :], re.M)
    cut = m.end() + nxt.start() if nxt else len(text)
    section = text[:cut].rstrip("\n")
    rest = text[cut:]
    return section + "\n" + "\n".join(new) + ("\n\n" + rest.lstrip("\n") if rest else "\n")


async def fold_into_skills(db: AsyncSession, ws: Any) -> list[dict[str, Any]]:
    """Nightly: new lessons of a topic that has a skill go into that skill's Pitfalls, as a
    proposal that is tested old vs new; the autopilot (or a person) decides. A lesson whose
    fold a person rejected is not proposed again."""
    from ..models import SkillProposal
    from ..skills import autopilot
    from ..skills import format as fmt
    from ..skills.reflect import evaluate
    from ..skills.store import SkillError, find, propose

    rows = (
        await db.scalars(
            select(BrainFact).where(
                BrainFact.workspace_id == ws.id,
                BrainFact.source_kind == KIND,
                BrainFact.valid_to.is_(None),
                BrainFact.agent_id.is_(None),  # never a private AI's lesson into a shared skill
            )
        )
    ).all()
    by_skill: dict[str, list[BrainFact]] = {}
    for f in rows:
        topic = str((f.meta or {}).get("topic") or "")
        if topic and topic != GENERAL:
            by_skill.setdefault(TOPIC_SKILL.get(topic, topic), []).append(f)
    changes: list[dict[str, Any]] = []
    for name, lessons in by_skill.items():
        skill = await find(db, ws.id, name)
        if skill is None or skill.status != "active":
            continue
        if skill.branch_id is not None:
            lessons = [f for f in lessons if f.branch_id in (None, skill.branch_id)]
        else:
            lessons = [f for f in lessons if f.branch_id is None or not await _isolated(db, f)]
        body_low = skill.body.lower()
        rejected = set(
            (
                await db.scalars(
                    select(SkillProposal.id).where(
                        SkillProposal.skill_id == skill.id,
                        SkillProposal.proposed_by == FOLD_BY,
                        SkillProposal.status == "rejected",
                    )
                )
            ).all()
        )
        todo = [
            f
            for f in sorted(lessons, key=lambda f: f.created_at)
            if f.text.lower() not in body_low
            # The skill scan blocks any mention of a password; such a lesson stays a lesson.
            and not FACT_SECRET.search(f.text)
            and ((f.meta or {}).get("folded") or {}).get("proposal_id") not in rejected
        ]
        fresh = [f for f in todo if not (f.meta or {}).get("folded")]
        if not fresh:
            continue  # nothing new since the last fold (it may still wait for a person)
        drop = []
        for f in todo:
            rid = (f.meta or {}).get("replaced")
            prev = await db.get(BrainFact, str(rid)) if rid else None
            if prev is not None:
                drop.append(prev.text)
        body = fold_body(skill.body, [f.text for f in todo], drop)
        if body.strip() == skill.body.strip():
            continue
        try:
            p = await propose(
                db,
                ws,
                kind="patch",
                skill=skill,
                name=skill.name,
                description=skill.description,
                body=body,
                proposed_by=FOLD_BY,
                reason=(
                    f"{len(todo)} lesson(s) people taught on {topic_label(name)} work, added to "
                    "Pitfalls: " + "; ".join(f.text for f in todo[:5])
                )[:2000],
            )
        except (SkillError, fmt.SkillFormatError) as e:
            log.info("could not fold lessons into %s: %s", name, e)
            continue
        for f in todo:
            f.meta = {
                **(f.meta or {}),
                "folded": {"skill": skill.name, "proposal_id": p.id, "at": _now().isoformat()},
            }
        await db.commit()
        try:
            await evaluate(db, p)
        except Exception:  # noqa: BLE001 - untested, it waits for a person
            log.warning("evals failed for fold %s", p.id, exc_info=True)
        live = None
        try:
            live = await autopilot.consider(db, ws, p)
        except Exception:  # noqa: BLE001
            log.warning("autopilot failed for fold %s", p.id, exc_info=True)
        changes.append(
            {
                "kind": "skill",
                "action": "lessons",
                "name": skill.name,
                "lessons": len(todo),
                "live": live is not None,
                "proposal_id": p.id,
            }
        )
    return changes


async def _isolated(db: AsyncSession, f: BrainFact) -> bool:
    from ..models import Branch

    b = await db.get(Branch, f.branch_id) if f.branch_id else None
    return b is not None and b.isolated
