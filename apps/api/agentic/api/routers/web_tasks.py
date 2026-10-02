"""Browse for me (P9): a person gives an agent a link and says what they want, and the agent
does it in its browser: read and pull out details, or interact and fill in a form.

The brief is written for the agent in a fixed shape (where, what, which values, how to
answer, the rules), so a one-line request becomes a task the agent can carry out reliably.
Form sends still go through browser_submit, which always waits for a person.
"""

from typing import Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...agents import launch, runtime
from ...agents.templates import BY_ID
from ...agents.tools import modes_for
from ...agents.vault import for_agent as logins_for
from ...core.db import get_db
from ...core.ssrf import BlockedURL, guard_url
from ...models import Task
from ...services import audit, events
from ..agent_schemas import TaskOut
from ..deps import Principal, api_error, require
from .agents import can_manage, get_agent
from .tasks import clean_labels, task_out

router = APIRouter(prefix="/api", tags=["web-tasks"])

READ = (
    "browser_open",
    "browser_click",
    "browser_scroll",
    "browser_back",
    "browser_read",
    "browser_close",
)
INTERACT = READ + (
    "browser_type",
    "browser_fill",
    "browser_select",
    "browser_check",
    "browser_submit",
)


class WebTaskIn(BaseModel):
    url: str = Field(min_length=4, max_length=2000)
    instructions: str = Field(min_length=3, max_length=4000)
    mode: Literal["read", "interact"] = "read"
    values: str = Field(default="", max_length=6000)  # what to type into the form
    login: str | None = Field(default=None, max_length=80)  # a saved login's name
    output: Literal["answer", "report"] = "answer"
    title: str | None = Field(default=None, max_length=200)
    labels: list[str] = Field(default_factory=list, max_length=8)
    requires_review: bool = True


def brief_for(body: WebTaskIn) -> str:
    lines = [
        f"Open this page in your browser: {body.url}",
        "",
        "What I want:",
        body.instructions.strip(),
    ]
    if body.login:
        lines += [
            "",
            f"If the site asks you to sign in, use the saved login '{body.login}' "
            "(browser_login with submit_element).",
        ]
    if body.mode == "interact":
        lines += [
            "",
            "You may click, type and fill in forms on this site to do it. Fill all the fields "
            "in one browser_fill. Sending a form waits for my approval (browser_submit): "
            "before you send, check every field against what I asked.",
        ]
        if body.values.strip():
            lines += [
                "",
                "Use exactly these values (do not invent any others):",
                body.values.strip(),
            ]
    else:
        lines += [
            "",
            "Only read: do not fill in or send any form. Open the pages you need (several if "
            "the details are spread out; split_work if there are many).",
        ]
    lines += [
        "",
        "Answer with what you found, exactly as the site shows it (names, numbers, dates), "
        "and say where on the site it came from. If something is missing or unclear, say so "
        "instead of guessing; if you need a decision, ask me (ask_human).",
    ]
    if body.output == "report":
        lines += [
            "Write it up with publish_report: a short summary, and a table with one row per "
            "item found.",
        ]
    return "\n".join(lines)


@router.post("/agents/{agent_id}/web-task", status_code=status.HTTP_201_CREATED)
async def web_task(
    agent_id: str,
    body: WebTaskIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TaskOut:
    agent = await get_agent(db, principal, agent_id)
    if agent.status != "active":
        raise api_error(
            status.HTTP_409_CONFLICT, "agent_inactive", f"{agent.name} is {agent.status}."
        )
    url = body.url.strip()
    if "://" not in url:
        url = "https://" + url
    try:
        await guard_url(url)
    except BlockedURL as e:
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "bad_url", str(e)) from e
    body.url = url

    # The agent needs the browser for this. Give it, if this person may change the agent.
    needed = INTERACT if body.mode == "interact" else READ
    needed = needed + (("browser_login",) if body.login else ())
    modes = modes_for(agent)
    missing = [t for t in needed if modes.get(t) == "deny"]
    if missing:
        if not can_manage(principal, agent):
            raise api_error(
                status.HTTP_409_CONFLICT,
                "no_browser",
                f"{agent.name} cannot use the browser yet. Ask whoever manages {agent.name} to "
                "give it the browser tools (Permissions), or pick another agent.",
            )
        web = dict(BY_ID["web_operator"].tools)
        added = {t: web.get(t, "allow") for t in missing}
        agent.tools = {**(agent.tools or {}), **added}
        await audit.record(
            db,
            principal.workspace_id,
            principal.actor,
            "agent.updated",
            target=agent.id,
            after={"tools": added},
            note="browser tools given for a web task",
        )
    if body.login and body.login not in {c.name for c in await logins_for(db, agent)}:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "bad_login",
            f"{agent.name} may not use a saved login called {body.login!r}.",
        )

    lowest = (
        await db.scalar(
            select(func.min(Task.position)).where(Task.workspace_id == principal.workspace_id)
        )
        or 0
    )
    title = (body.title or "").strip() or body.instructions.strip().splitlines()[0][:120]
    t = Task(
        workspace_id=principal.workspace_id,
        title=title[:200],
        brief=brief_for(body),
        priority="normal",
        assignee_agent_id=agent.id,
        branch_id=agent.branch_id,
        requires_review=body.requires_review,
        created_by=principal.actor,
        status="ready",
        position=float(lowest) - 1,
        labels=clean_labels(["web", *body.labels]),
    )
    db.add(t)
    await db.flush()
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "task.created",
        target=t.id,
        after={"title": t.title, "assignee": agent.id, "web": body.mode, "url": url},
    )
    await db.commit()
    await runtime.task_event(db, t, "created", principal.actor, f"asked it to {body.mode} {url}")
    await events.publish(
        principal.workspace_id, "task.created", {"task_id": t.id, "agent_id": agent.id}
    )
    try:
        await launch.launch(db, t, principal.actor)
    except launch.LaunchError as e:
        raise api_error(e.status, e.code, e.message) from e
    await db.refresh(t)
    return await task_out(db, t)


@router.get("/agents/{agent_id}/logins")
async def agent_logins(
    agent_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, object]]:
    """The saved logins this agent may use (names and sites only), for the Browse for me form."""
    agent = await get_agent(db, principal, agent_id)
    return [{"name": c.name, "hosts": c.hosts} for c in await logins_for(db, agent)]
