"""Saved website logins agents may use without seeing them (P9).

A login belongs to the workspace, one branch, or one person. An agent may use it when it is
in that branch (or belongs to that person) and, if the login names agents, is one of them
(a helper counts as its original). The worker decrypts it and the browser service types it
in, only on the login's hosts; the model gets the login's name and nothing else.
"""

from datetime import UTC, datetime
from urllib.parse import urlparse

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core import crypto
from ..models import Agent, Credential


def host_of(url: str) -> str:
    return (urlparse(url).hostname or "").lower()


def host_matches(host: str, hosts: list[str]) -> bool:
    host = host.lower()
    return any(host == h.lower() or host.endswith("." + h.lower()) for h in hosts if h)


def clean_hosts(raw: list[str]) -> list[str]:
    out: list[str] = []
    for h in raw:
        h = str(h).strip().lower()
        if "://" in h:
            h = host_of(h)
        h = h.split("/")[0].split(":")[0].strip(".")
        if h and h not in out:
            out.append(h)
    return out[:20]


def usable_by(c: Credential, agent: Agent) -> bool:
    if c.workspace_id != agent.workspace_id:
        return False
    if c.branch_id and c.branch_id != agent.branch_id:
        return False
    if c.owner_user_id and c.owner_user_id != agent.owner_user_id:
        return False
    if c.agent_ids and not {agent.id, agent.clone_of} & set(c.agent_ids):
        return False
    return True


async def for_agent(db: AsyncSession, agent: Agent) -> list[Credential]:
    rows = (
        await db.scalars(
            select(Credential)
            .where(
                Credential.workspace_id == agent.workspace_id,
                or_(Credential.branch_id.is_(None), Credential.branch_id == agent.branch_id),
            )
            .order_by(Credential.name)
        )
    ).all()
    return [c for c in rows if usable_by(c, agent)]


def reveal(c: Credential) -> tuple[str, str]:
    return crypto.decrypt(c.username_enc, c.aad + ":u"), crypto.decrypt(c.password_enc, c.aad)


def seal(c: Credential, username: str, password: str) -> None:
    c.username_enc = crypto.encrypt(username, c.aad + ":u")
    c.password_enc = crypto.encrypt(password, c.aad)
    c.username_hint = (username[:2] + "…" + username[-2:]) if len(username) > 5 else "…"


def touch(c: Credential) -> None:
    c.last_used_at = datetime.now(UTC)
