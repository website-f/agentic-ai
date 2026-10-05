"""Saved website logins agents may use without seeing them (P9).

A login belongs to the workspace, one branch, or one person. An agent may use it when it is
in that branch (or belongs to that person) and, if the login names agents, is one of them
(a helper counts as its original). The worker decrypts it and the browser service types it
in, only on the login's hosts; the model gets the login's name and nothing else.

P21: a login also keeps its signed-in browser session (cookies + local storage, only for the
login's hosts), envelope-encrypted in credential_states, so the next task opens the browser
already signed in, like a person whose browser remembers them; portals with one-time codes
then need a person only when the session really expires. A saved session lasts
`browser_session_days`, is checked before use, and never reaches a model, the monitor or a log.
"""

import json
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core import crypto
from ..core.config import settings
from ..models import Agent, Credential, CredentialState


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


# ---------------------------------------------------------------- saved sessions (P21)


def state_aad(credential_id: str) -> str:
    return f"credential_state:{credential_id}"


def cookie_for(domain: str, hosts: list[str]) -> bool:
    """A cookie the login's sites use: on one of its hosts (or a subdomain), or set for a
    parent domain those hosts send it to."""
    d = str(domain).lower().lstrip(".")
    if not d:
        return False
    for h in hosts:
        h = h.lower()
        if d == h or d.endswith("." + h) or (h.endswith("." + d) and "." in d):
            return True
    return False


def only_hosts(state: dict[str, Any], hosts: list[str]) -> dict[str, Any]:
    """The part of a browser storage state that belongs to these hosts, nothing else."""
    cookies = [
        c
        for c in state.get("cookies") or []
        if isinstance(c, dict) and cookie_for(str(c.get("domain", "")), hosts)
    ]
    origins = [
        o
        for o in state.get("origins") or []
        if isinstance(o, dict) and host_matches(host_of(str(o.get("origin", ""))), hosts)
    ]
    return {"cookies": cookies, "origins": origins}


def expired(row: CredentialState, now: datetime | None = None) -> bool:
    now = now or datetime.now(UTC)
    return row.saved_at < now - timedelta(days=settings.browser_session_days)


async def state_row(db: AsyncSession, credential_id: str) -> CredentialState | None:
    return await db.get(CredentialState, credential_id)


async def save_state(
    db: AsyncSession, c: Credential, state: dict[str, Any], check_url: str | None
) -> bool:
    """Keep a signed-in session for this login (only its hosts' part). False when there is
    nothing worth keeping (no cookies or storage for the login's sites)."""
    mine = only_hosts(state, c.hosts)
    if not mine["cookies"] and not mine["origins"]:
        return False
    if check_url and not host_matches(host_of(check_url), c.hosts):
        check_url = None
    sealed = crypto.encrypt(json.dumps(mine, separators=(",", ":")), state_aad(c.id))
    row = await db.get(CredentialState, c.id)
    now = datetime.now(UTC)
    if row is None:
        row = CredentialState(
            credential_id=c.id,
            workspace_id=c.workspace_id,
            state_enc=sealed,
            check_url=(check_url or "")[:500] or None,
            saved_at=now,
        )
        db.add(row)
    else:
        row.state_enc = sealed
        row.saved_at = now
        if check_url:
            row.check_url = check_url[:500]
    return True


def open_state(row: CredentialState) -> dict[str, Any] | None:
    try:
        data = json.loads(crypto.decrypt(row.state_enc, state_aad(row.credential_id)))
    except (crypto.DecryptError, ValueError):
        return None
    return data if isinstance(data, dict) else None


async def forget_state(db: AsyncSession, credential_id: str) -> bool:
    res = await db.execute(
        delete(CredentialState).where(CredentialState.credential_id == credential_id)
    )
    return bool(getattr(res, "rowcount", 0))


async def restorable(
    db: AsyncSession, agent: Agent, allowed: list[str] | None = None
) -> list[tuple[Credential, CredentialState, dict[str, Any]]]:
    """Saved sessions this agent may start a task with: its usable logins' fresh, readable
    sessions (expired or unreadable ones are deleted). With an allow-list, only logins whose
    sites are all inside it."""
    creds = {c.id: c for c in await for_agent(db, agent)}
    if not creds:
        return []
    rows = (
        await db.scalars(select(CredentialState).where(CredentialState.credential_id.in_(creds)))
    ).all()
    out: list[tuple[Credential, CredentialState, dict[str, Any]]] = []
    now = datetime.now(UTC)
    for row in rows:
        c = creds[row.credential_id]
        if row.workspace_id != agent.workspace_id:
            continue
        if expired(row, now):
            await db.delete(row)
            continue
        state = open_state(row)
        if state is None:
            await db.delete(row)
            continue
        if allowed is not None and not all(host_matches(h, allowed) for h in c.hosts):
            continue
        mine = only_hosts(state, c.hosts)
        if mine["cookies"] or mine["origins"]:
            out.append((c, row, mine))
    return out


def merge_states(states: list[dict[str, Any]]) -> dict[str, Any] | None:
    cookies: list[dict[str, Any]] = []
    origins: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for s in states:
        for ck in s.get("cookies") or []:
            key = (str(ck.get("name")), str(ck.get("domain")), str(ck.get("path", "/")))
            if key not in seen:
                seen.add(key)
                cookies.append(ck)
        origins.extend(s.get("origins") or [])
    if not cookies and not origins:
        return None
    return {"cookies": cookies, "origins": origins}
