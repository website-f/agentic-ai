"""Core memory (Hermes pattern): two small capped files per agent, always in the prompt.

- MEMORY.md: lessons, standing instructions, how this office works (2,200 characters)
- USER.md: who the agent works for and what they prefer (1,400 characters)

The prompt uses a snapshot frozen when a task run or chat starts, so edits made during the
run take effect next time and the cached prompt prefix stays valid. The caps force the
agent to consolidate instead of hoarding; anything bigger belongs in facts or the wiki.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core import threats
from ..core.fence import INJECTION  # noqa: F401 (kept for recall withholding)
from ..models import Agent, BrainPage, Workspace
from .facts import _SECRET
from .store import Author, save_page

CAPS = {"memory": 2200, "user": 1400}
FILES = {"memory": "MEMORY.md", "user": "USER.md"}
HEADINGS = {"memory": "What I have learned", "user": "Who I work for"}


class MemoryFull(ValueError):
    pass


def path_for(agent: Agent, target: str) -> str:
    return f"agents/{agent.slug}/{FILES[target]}"


def entries(body: str) -> list[str]:
    return [
        line[2:].strip() for line in body.splitlines() if line.startswith("- ") and line[2:].strip()
    ]


def render(agent: Agent, target: str, items: list[str]) -> str:
    lines = [f"# {agent.name}: {HEADINGS[target]}", ""] + [f"- {e}" for e in items]
    return "\n".join(lines) + "\n"


def target_of(path: str) -> str | None:
    """'memory' / 'user' when `path` is an agent's core memory file (agents/<slug>/...)."""
    parts = path.split("/")
    if len(parts) != 3 or parts[0] != "agents":
        return None
    return next((t for t, f in FILES.items() if f == parts[2]), None)


def refused(items: list[str]) -> str | None:
    """P29: why these entries may not go into core memory (it is in every future prompt),
    or None. The same rules the agent's own `memory` tool follows."""
    for e in items:
        if threats.scan(e, "strict"):
            return "Not saved. Core memory cannot change the rules, approvals or SOPs."
        if _SECRET.search(e):
            return "Not saved. Never keep passwords, keys, card or IC numbers in memory."
    return None


def used(items: list[str]) -> int:
    return sum(len(e) + 1 for e in items)


async def read(db: AsyncSession, agent: Agent) -> dict[str, list[str]]:
    paths = {path_for(agent, t): t for t in FILES}
    rows = (
        await db.execute(
            select(BrainPage.path, BrainPage.body).where(
                BrainPage.workspace_id == agent.workspace_id, BrainPage.path.in_(paths)
            )
        )
    ).all()
    out: dict[str, list[str]] = {t: [] for t in FILES}
    for path, body in rows:
        out[paths[path]] = entries(body)
    return out


async def snapshot(db: AsyncSession, agent: Agent) -> str:
    """Text for the prompt. Empty string when the agent has no core memory yet."""
    mem = await read(db, agent)
    parts = []
    if mem["user"]:
        parts.append("About the people you work for:\n" + "\n".join(f"- {e}" for e in mem["user"]))
    if mem["memory"]:
        parts.append("Your notes and lessons:\n" + "\n".join(f"- {e}" for e in mem["memory"]))
    return "\n\n".join(parts)


async def write(
    db: AsyncSession, ws: Workspace, agent: Agent, target: str, items: list[str], author: Author
) -> None:
    items = [" ".join(e.split()) for e in items if e.strip()]
    if used(items) > CAPS[target]:
        raise MemoryFull(
            f"{FILES[target]} is limited to {CAPS[target]:,} characters "
            f"({used(items):,} given). Shorten or merge entries."
        )
    await save_page(
        db,
        ws,
        path_for(agent, target),
        render(agent, target, items),
        author,
        f"{agent.name}: update {FILES[target]}",
    )


async def edit(
    db: AsyncSession,
    ws: Workspace,
    agent: Agent,
    *,
    action: str,
    target: str,
    text: str = "",
    old_text: str = "",
) -> str:
    """The `memory` tool. Returns a message for the model (errors included, never raises)."""
    if target not in FILES:
        return "Error: target must be 'memory' or 'user'."
    items = (await read(db, agent))[target]
    text, old_text = " ".join(text.split()), old_text.strip()
    if action == "add":
        if not text:
            return "Error: give the text to add."
        if any(text.lower() == e.lower() for e in items):
            return "Already in memory."
        new = items + [text]
    elif action in ("replace", "remove"):
        matches = [i for i, e in enumerate(items) if old_text and old_text.lower() in e.lower()]
        if len(matches) != 1:
            return (
                f"Error: old_text matched {len(matches)} entries; it must match exactly one. "
                "Current entries:\n" + "\n".join(f"- {e}" for e in items)
            )
        new = list(items)
        if action == "remove":
            new.pop(matches[0])
        elif not text:
            return "Error: give the replacement text."
        else:
            new[matches[0]] = text
    else:
        return "Error: action must be add, replace or remove."
    # Core memory goes into every future system prompt: refuse overrides and secrets there.
    why = refused([text]) if text else None
    if why:
        return f"Error: {why[0].lower()}{why[1:]}"
    try:
        await write(db, ws, agent, target, new, Author(f"agent:{agent.id}", agent.name))
    except MemoryFull:
        return (
            f"Error: {FILES[target]} is full ({used(items):,}/{CAPS[target]:,} characters). "
            "Merge or remove entries first (replace/remove), or save details with remember."
        )
    return (
        f"Saved. {FILES[target]} now uses {used(new):,}/{CAPS[target]:,} characters. "
        "It takes effect from your next task or conversation."
    )
