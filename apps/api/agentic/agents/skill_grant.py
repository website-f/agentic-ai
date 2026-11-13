"""P96: work gets the office skill it needs, by itself, the way ePerolehan work gets the browser.

When work starts (`launch.launch`: Give a task, a workflow step, a heartbeat; the first step
of a run: a routine or a schedule; a chat turn), it is matched against the office's skill
library (the built-in skills, the office pack, ePerolehan, and every skill learned from
past work). An agent that lacks a matching skill gets it:

- the skill itself, when it is limited to some agents (Skill.agent_ids) and this agent is not
  one of them: the agent is added;
- the tools the skill's steps name that are off for the agent only because they are off by
  default (the browser, for example). A tool a person switched to Never stays off;
  `browser_submit` / `browser_upload` are only ever given as "ask" (a person approves each).

Same rule as browser_grant: only when the person the work is for may manage that agent
(their own AI, or one they manage), audited as their change. Reaching more agents with a
limited skill is publishing it (api/routers/skills.may_publish): owners, admins, management
and HR may; a branch manager or HOD only for a skill that already reaches just the agents
they manage. An AI twin's tools are its managers' to loosen (P29), so its person alone gives
it no tools. Otherwise the work still starts (a skill is a procedure, not a door) and the
person is told plainly who can give it: a task event, or the agent says so in chat.

Matching is cheap: the local embedding of the work (no model call) against the skills'
stored embeddings, with a keyword fallback when embeddings are off; ePerolehan by its own
rule (browser_grant.about_text). Never another person's private assistant: nobody but its
owner manages it, so nobody else's work changes it. After the work, the agent keeps the
skill, and what it learns goes through reflection as before; a skill learned on one agent's
work is open to every agent of its company (an isolated company's stay inside it), and is
given this way to a colleague whose work needs it.
"""

import logging
import re
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..i18n import Msg
from ..models import Agent, Membership, Skill, Task, TaskEvent, User, Workspace
from . import browser_grant
from .tools import TOOLS, mode_of

log = logging.getLogger("agentic.agents.skill_grant")

# Close enough in meaning to give a skill (the prompt hint uses 0.55; giving is a change).
GRANT_SIMILARITY = 0.6
MAX_SKILLS = 2  # at most this many skills given for one piece of work
MIN_CHAT_WORDS = 4  # "hi", "thanks", "ok do it" match nothing
EVENT = "skill"

NO_SKILL = (
    "{agent} doesn't have the office's skill {skill} for this yet. Ask {who} to give it, or "
    "pick another agent."
)
GAVE = "{agent} was given the office's skill {skill} for this work."

_TOOL_WORD = re.compile(r"\b[a-z][a-z0-9]*_[a-z0-9_]+\b")
_WORD = re.compile(r"[a-z0-9]+")
_STOP = frozenset(
    "a an and are as at be by for from has have in into is it its of on or that the this to "
    "with what when who how your you our one two use using make made each every".split()
)


@dataclass
class Outcome:
    """What happened for one piece of work: skills given, and the plain refusals."""

    given: list[str] = field(default_factory=list)
    refused: list[Msg] = field(default_factory=list)
    tools: dict[str, str] = field(default_factory=dict)


# ---------------------------------------------------------------- what a skill needs


def needed_tools(body: str) -> set[str]:
    """The tools a skill's text names. Any browser tool means the browser, as tender mode
    gives it."""
    names = {w for w in _TOOL_WORD.findall(body or "") if w in TOOLS}
    # A saved login is typed only where browser_grant finds one for the portal.
    names.discard(browser_grant.LOGIN)
    if any(n.startswith("browser_") for n in names):
        names |= set(browser_grant.BROWSER)
    return names


def _mode_given(tool: str) -> str:
    """The browser as tender mode gives it (submit and upload ask); any other high-risk
    tool asks a person each time."""
    if tool in browser_grant.BROWSER:
        return "ask" if tool in browser_grant.GATED else "allow"
    return "ask" if TOOLS[tool].risk == "high" else "allow"


def missing_tools(agent: Agent, skill: Skill) -> dict[str, str]:
    """Tools the skill needs that are off for this agent only by default (a person's Never
    stays), with the mode each would get."""
    own = agent.tools or {}
    return {
        t: _mode_given(t)
        for t in sorted(needed_tools(skill.body))
        if mode_of(own, t) == "deny" and own.get(t) != "deny"
    }


def lacks_reach(agent: Agent, skill: Skill) -> bool:
    return bool(skill.agent_ids) and agent.id not in skill.agent_ids


# ---------------------------------------------------------------- matching


def _words(text: str) -> set[str]:
    return {w for w in _WORD.findall((text or "").lower()) if len(w) >= 4 and w not in _STOP}


def _stem(w: str) -> str:
    return w[:6]


def keyword_score(text_words: set[str], name: str, description: str) -> int:
    """Name words count double: "staff-onboarding-file" against "onboard the new staff"."""
    stems = {_stem(w) for w in text_words}
    named = {_stem(w) for w in _words(name.replace("-", " "))}
    desc = {_stem(w) for w in _words(description)} - named
    return 2 * len(named & stems) + len(desc & stems)


# Without embeddings a skill matches on this many keyword points; with them, a match this
# strong counts too (a Malay brief against an English description, say).
KEYWORD_MATCH = 3
KEYWORD_STRONG = 5


async def _reachable(db: AsyncSession, agent: Agent) -> frozenset[str] | None:
    """The companies whose skills this agent may use (None: every one)."""
    from ..brain.scope import for_agent

    return (await for_agent(db, agent)).branch_ids


async def match(db: AsyncSession, agent: Agent, text: str) -> list[Skill]:
    """The office skills that fit this work, best first (at most MAX_SKILLS). One local
    embedding and two small queries; no model call."""
    from ..brain import embed
    from ..skills import eperolehan, store

    text = (text or "")[:2000]
    if not text.strip():
        return []
    ws = await db.get(Workspace, agent.workspace_id)
    if ws is not None:
        await store.ensure_builtin(db, ws)  # one dict lookup once seeded
    branches = await _reachable(db, agent)

    def usable(q):  # noqa: ANN001, ANN202
        q = q.where(Skill.workspace_id == agent.workspace_id, Skill.status == "active")
        if branches is not None:
            q = q.where(Skill.branch_id.is_(None) | Skill.branch_id.in_(branches))
        return q

    try:
        vec = await embed.embed_one(text)
    except Exception:  # noqa: BLE001 - matching degrades to keywords
        vec = None
    # One light query over the library: names, descriptions and (with embeddings) how close
    # each is in meaning; never the bodies or the vectors themselves.
    cols = [Skill.id, Skill.name, Skill.description]
    if vec is not None:
        sim = (1 - Skill.embedding.cosine_distance(vec)).label("sim")
        cols.append(sim)
    light = (await db.execute(usable(select(*cols)))).all()
    picked: list[str] = []
    if browser_grant.about_text(text):
        # P102: the office's bid know-how linked to the ePerolehan skill comes with it.
        for name in (eperolehan.NAME, *eperolehan.linked(ws)):
            picked += [r[0] for r in light if r[1] == name]
    if vec is not None:
        close = sorted(
            (r for r in light if r[3] is not None and float(r[3]) >= GRANT_SIMILARITY),
            key=lambda r: -float(r[3]),
        )
        picked += [r[0] for r in close[:MAX_SKILLS]]
    # Keywords on names and descriptions: alone without embeddings; a strong match with them
    # (a Malay brief against an English description, say).
    words = _words(text)
    need = KEYWORD_MATCH if vec is None else KEYWORD_STRONG
    hits = sorted(
        ((keyword_score(words, r[1], r[2]), r[1], r[0]) for r in light),
        key=lambda x: (-x[0], x[1]),
    )
    picked += [i for score, _, i in hits[:MAX_SKILLS] if score >= need]
    ids = list(dict.fromkeys(picked))[:MAX_SKILLS]
    if not ids:
        return []
    by_id = {s.id: s for s in (await db.scalars(select(Skill).where(Skill.id.in_(ids)))).all()}
    return [by_id[i] for i in ids if i in by_id]


# ---------------------------------------------------------------- who may give it


async def _member(db: AsyncSession, agent: Agent, user_id: str):  # noqa: ANN202
    from ..api.scope import Scope  # late: the API package imports the agents
    from ..core.security import effective

    m = await db.get(Membership, (agent.workspace_id, user_id))
    if m is None:
        return None
    ws = await db.get(Workspace, agent.workspace_id)
    perms = effective(m.role, ws.settings if ws is not None else None)
    return Scope.of_member(m), perms


async def may_reach(db: AsyncSession, scope, perms: frozenset[str], skill: Skill, agent: Agent):  # noqa: ANN001, ANN201
    """May this person let `agent` use a skill limited to some agents (publishing it to one
    more agent)? The same rule as the Skills page (skills.may_publish)."""
    if "agents.manage" not in perms:
        return False
    if scope.everything:
        return True
    if skill.branch_id and not scope.in_branch(skill.branch_id):
        return False
    ids = [*(skill.agent_ids or []), agent.id]
    rows = (
        await db.scalars(
            select(Agent).where(Agent.id.in_(ids), Agent.workspace_id == agent.workspace_id)
        )
    ).all()
    return len(rows) == len(set(ids)) and all(scope.sees_agent(a) for a in rows)


async def who_can(
    db: AsyncSession, agent: Agent, skill: Skill, but: str | None, *, reach: bool, tools: bool
) -> list[str]:
    """Names of up to three people who could give `agent` this skill (never `but`)."""
    from ..api.scope import Scope
    from ..core.security import effective

    ws = await db.get(Workspace, agent.workspace_id)
    rows = (
        await db.execute(
            select(Membership, User.name)
            .join(User, User.id == Membership.user_id)
            .where(Membership.workspace_id == agent.workspace_id)
            .order_by(User.name)
        )
    ).all()
    names: list[str] = []
    for m, name in rows:
        if m.user_id == but or len(names) >= 3:
            continue
        perms = effective(m.role, ws.settings if ws is not None else None)
        scope = Scope.of_member(m)
        if not scope.manages_agent(agent, perms):
            continue
        if tools and agent.is_twin and "agents.manage" not in perms:
            continue
        if reach and not await may_reach(db, scope, perms, skill, agent):
            continue
        names.append(name or "")
    return [n for n in names if n]


def _who(names: list[str]) -> Msg | str:
    if not names:
        return Msg("an owner or admin")
    if len(names) == 1:
        return names[0]
    return Msg("{a} or {b}", a=", ".join(names[:-1]), b=names[-1])


# ---------------------------------------------------------------- giving


async def give(
    db: AsyncSession, agent: Agent, person: str | None, skills: list[Skill], why: str
) -> Outcome:
    """Give `agent` what it lacks of these skills, as `person`'s change (audited, in the
    caller's transaction), or the plain refusal naming who can."""
    from ..services import audit

    out = Outcome()
    if not person or not skills:
        return out
    who = await _member(db, agent, person)
    for skill in skills:
        reach = lacks_reach(agent, skill)
        tools = missing_tools(agent, skill)
        if not reach and not tools:
            continue
        ok = who is not None and who[0].manages_agent(agent, who[1])
        if ok and tools and agent.is_twin and "agents.manage" not in who[1]:
            ok = False  # P29: a twin's tools are its managers' to loosen
        if ok and reach:
            ok = await may_reach(db, who[0], who[1], skill, agent)
        if not ok:
            names = await who_can(db, agent, skill, person, reach=reach, tools=bool(tools))
            out.refused.append(Msg(NO_SKILL, agent=agent.name, skill=skill.name, who=_who(names)))
            continue
        if reach:
            before = list(skill.agent_ids or [])
            skill.agent_ids = [*before, agent.id]
            await audit.record(
                db,
                agent.workspace_id,
                f"user:{person}",
                "skill.agents_changed",
                target=skill.id,
                before={"agent_ids": before},
                after={"agent_ids": skill.agent_ids},
                note=why,
            )
        if tools:
            agent.tools = {**(agent.tools or {}), **tools}
            out.tools.update(tools)
            await audit.record(
                db,
                agent.workspace_id,
                f"user:{person}",
                "agent.updated",
                target=agent.id,
                after={"tools": tools},
                note=f"{why}: {skill.name}",
            )
        out.given.append(skill.name)
    return out


def _brief_line(names: list[str]) -> str:
    return "".join(
        f"\n\nThis work fits the office's skill {n}: call use_skill(name='{n}') first and "
        "follow it."
        for n in names
    )


async def for_task(db: AsyncSession, task: Task, agent: Agent, actor: str | None = None) -> Outcome:
    """Work is about to start: give the agent the skills it lacks for it (or say who can), on
    the task's timeline. Never stops the work; commits. Best effort: a failure is logged."""
    try:
        return await _for_task(db, task, agent, actor)
    except Exception:  # noqa: BLE001 - a skill is a help, never a reason work does not start
        log.warning("skill grant failed for task %s", task.id, exc_info=True)
        await db.rollback()
        return Outcome()


async def _for_task(db: AsyncSession, task: Task, agent: Agent, actor: str | None) -> Outcome:
    from . import runtime

    person = await browser_grant._person(db, task, actor)  # noqa: SLF001 - one rule for both
    if not person:  # the office's own work: nobody to decide, it runs as before
        return Outcome()
    skills = await match(db, agent, f"{task.title}\n{task.brief or ''}")
    out = await give(db, agent, person, skills, "skill given for this work")
    if out.given:
        from ..skills import eperolehan

        brief = task.brief or ""
        names = [n for n in out.given if n != eperolehan.NAME]
        if eperolehan.NAME in out.given and browser_grant._skill_marker() not in brief:  # noqa: SLF001
            # Tender work follows the skill with its live pitfalls (browser_grant attaches
            # them when the agent already had it; it has it now), and its linked skills.
            brief += await eperolehan.attach(db, agent, task)
        lines = [n for n in names if f"use_skill(name='{n}')" not in brief]
        task.brief = brief + _brief_line(lines)
    await db.commit()
    for name in out.given:
        await runtime.task_event(
            db,
            task,
            EVENT,
            f"user:{person}",
            Msg(GAVE, agent=agent.name, skill=name),
            {"skill": name, "tools": sorted(out.tools)},
        )
    for msg in out.refused:
        said = await db.scalar(
            select(TaskEvent.id).where(
                TaskEvent.task_id == task.id, TaskEvent.kind == EVENT, TaskEvent.text == str(msg)
            )
        )
        if said is None:  # once per task, not on every run
            await runtime.task_event(db, task, EVENT, f"agent:{agent.id}", msg)
    return out


async def for_chat(db: AsyncSession, agent: Agent, person: str, text: str) -> str:
    """A chat message: the skills it needs are given when this person may (audited), and the
    note for this turn says which to load; otherwise the note has the agent say who can."""
    if len(_WORD.findall((text or "").lower())) < MIN_CHAT_WORDS:
        return ""
    try:
        skills = await match(db, agent, text)
        out = await give(db, agent, person, skills, "skill given for this work (chat)")
        await db.commit()
    except Exception:  # noqa: BLE001
        log.warning("skill grant failed in chat with %s", agent.id, exc_info=True)
        await db.rollback()
        return ""
    parts = [
        f"You now have the office's skill {n} for this: call use_skill(name='{n}') first and "
        "follow it."
        for n in out.given
    ]
    parts += [
        "You do not have an office skill for this yet. Do what you can, and tell the person "
        f"plainly, in their language: {m.render()}"
        for m in out.refused
    ]
    return "\n".join(parts)
