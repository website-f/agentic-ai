"""P94: ePerolehan work gets the browser by itself, on every way work reaches an agent.

Before P94 only Browse for me (the web-task form) gave an agent the browser tools, so the same
ePerolehan job given through Give a task, a chat, the desk, a routine or a workflow step ran
without them. Now, whenever work about ePerolehan starts (`launch.launch`, the first step of a
run, a chat turn), the agent gets exactly the browser tools tender mode gives:

- the browser to open, read and interact (as in tender mode), `browser_login` when a saved
  login for the portal is there, and `browser_submit` / `browser_upload` as "ask" (they always
  wait for a person anyway: policy.ALWAYS_ASK). Nothing beyond these browser tools; a tool a
  person already set is never changed, and submit / upload are never allowed outright;
- given only when the person the work is for may manage that agent (their own AI, or one
  they manage), with an audit entry, like the web-task form. Otherwise the work does not start
  without them: they are told "{agent} can't use the browser yet; ask whoever manages {agent}
  to allow it, or pick another agent" (in chat, the agent says so);
- the work follows the office's skill eperolehan-tender (skills/eperolehan.attach), with its
  live pitfalls in the brief, as tender mode does.
"""

import re
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ..i18n import Msg
from ..models import Agent, Membership, Task, Workspace
from .tools import TOOLS, modes_for

# Tender mode's browser tools (api/routers/web_tasks.py TENDER, its browser_* part; a test
# keeps the two the same).
BROWSER = (
    "browser_open",
    "browser_click",
    "browser_scroll",
    "browser_back",
    "browser_read",
    "browser_snapshot",
    "browser_find",
    "browser_wait",
    "browser_close",
    "browser_steps",
    "browser_type",
    "browser_fill",
    "browser_select",
    "browser_check",
    "browser_submit",
    "browser_upload",
    "browser_save_page",
)
GATED = ("browser_submit", "browser_upload")  # "ask": a person approves every one
LOGIN = "browser_login"
PORTAL = "eperolehan.gov.my"

# The work is about ePerolehan: the portal's address, its name, or a quotation reference
# (QT followed by its digits). Narrower than the lessons topic (brain/lessons.py), which also
# files any "tender" or "sebut harga" under ePerolehan: a tender document drafted in the
# office needs no browser.
_ABOUT = re.compile(r"eperolehan\.gov\.my|\be-?perolehan\b|\bQT\d{5,}\b", re.I)
LABELS = frozenset({"tender", "eperolehan"})

NO_BROWSER = (
    "{agent} can't use the browser yet; ask whoever manages {agent} to allow it, or pick "
    "another agent."
)


def about_text(text: str | None) -> bool:
    return bool(_ABOUT.search(text or ""))


def about(task: Task) -> bool:
    """Work on ePerolehan: the tender label (tender mode) or the portal in its words."""
    labels = {str(x).strip().lower() for x in task.labels or []}
    if labels & LABELS:
        return True
    return about_text(f"{task.title}\n{(task.brief or '')[:6000]}")


async def _portal_login(db: AsyncSession, agent: Agent) -> bool:
    """A saved login for the portal that this agent may use."""
    from . import vault

    try:
        logins = await vault.for_agent(db, agent)
    except Exception:  # noqa: BLE001 - no vault: no login tool
        return False
    return any(
        any(h == PORTAL or str(h).endswith("." + PORTAL) for h in (c.hosts or [])) for c in logins
    )


async def missing(db: AsyncSession, agent: Agent) -> dict[str, str]:
    """The browser tools this agent lacks for ePerolehan work, with the mode each gets."""
    modes = modes_for(agent)
    want = [*BROWSER, *((LOGIN,) if await _portal_login(db, agent) else ())]
    return {
        t: ("ask" if t in GATED else "allow")
        for t in want
        if t in TOOLS and modes.get(t, "deny") == "deny"
    }


async def may_manage(db: AsyncSession, agent: Agent, user_id: str | None) -> bool:
    """The person may change this agent (agents.manage inside their scope, or their own)."""
    if not user_id:
        return False
    from ..api.scope import Scope  # late: the API package imports the agents
    from ..core.security import effective

    m = await db.get(Membership, (agent.workspace_id, user_id))
    if m is None:
        return False
    ws = await db.get(Workspace, agent.workspace_id)
    perms = effective(m.role, ws.settings if ws is not None else None)
    scope = Scope.of_member(m)
    return scope.manages_agent(agent, perms)


def refusal(agent: Agent) -> Msg:
    return Msg(NO_BROWSER, agent=agent.name)


async def give(db: AsyncSession, agent: Agent, person: str | None, why: str) -> Msg | None:
    """Give the agent the browser tools it lacks for ePerolehan work (audited, in the caller's
    transaction), or the plain refusal when `person` may not change the agent. None: ready."""
    from ..services import audit

    changes = await missing(db, agent)
    if not changes:
        return None
    if not await may_manage(db, agent, person):
        return refusal(agent)
    agent.tools = {**(agent.tools or {}), **changes}
    await audit.record(
        db,
        agent.workspace_id,
        f"user:{person}",
        "agent.updated",
        target=agent.id,
        after={"tools": changes},
        note=why,
    )
    return None


async def _person(db: AsyncSession, task: Task, actor: str | None) -> str | None:
    if actor and actor.startswith("user:"):
        return actor.removeprefix("user:")
    from ..teams import allowance

    return await allowance.person_of_task(db, task)


def _skill_marker() -> str:
    from ..skills import eperolehan

    return f"the office's skill {eperolehan.NAME} ("


async def for_task(
    db: AsyncSession, task: Task, agent: Agent, actor: str | None = None
) -> Msg | None:
    """Work about ePerolehan is about to start: the browser tools (given, or the refusal to
    show the person) and the eperolehan-tender skill in its brief. None: go ahead. Commits."""
    if not about(task):
        return None
    person = await _person(db, task, actor)
    # The office's own work (a mail rule reading an ePerolehan notice; nobody gave it) is
    # neither given the browser nor stopped: nobody is there to decide, so it runs as before.
    if person:
        why = await give(db, agent, person, "browser tools given for ePerolehan work")
        if why is not None:
            return why
    if _skill_marker() not in (task.brief or ""):
        from ..skills import eperolehan

        task.brief = (task.brief or "") + await eperolehan.attach(db, agent, task)
    await db.commit()
    return None


async def for_chat(db: AsyncSession, agent: Agent, person: str, text: str) -> str:
    """A chat message about ePerolehan: the tools are given when the person may (audited), and
    "" is returned; otherwise the note that has the agent tell them plainly."""
    if not about_text(text):
        return ""
    why = await give(db, agent, person, "browser tools given for ePerolehan work (chat)")
    if why is None:
        await db.commit()
        return ""
    return (
        "You cannot use the browser for ePerolehan yet. Tell the person exactly this, in their "
        f"language, and do not try another way: {why.render()}"
    )


def as_text(msg: Any) -> str:
    return msg.render() if isinstance(msg, Msg) else str(msg)
