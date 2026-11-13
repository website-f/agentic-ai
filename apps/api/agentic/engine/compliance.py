"""P57: the approved-services lock. A client's NDA may say company information goes only to
outside services (AI providers, cloud storage, messaging, the web, Microsoft 365, Google, MCP
servers) the company approved in writing, for stated data and locations.

Off (the default): everything works as before. On: a service that is not on the workspace's
approved list is not used at all; the attempt is recorded as a request ("Fitri's twin wanted
to use OpenAI"), so an owner sees what is waiting and approves it (provider, location, data
it may receive, a note) or keeps it blocked. Anything that runs on this server (a local AI
model, this server's disk) needs no approval.

Kept in the workspace's settings ("compliance"): {"lock": bool, "approved": {key: {...}},
"requests": {key: {...}}}. Keys: ai:<provider id>, storage:<target id>, web, telegram,
whatsapp, push, m365, google, mcp:<server id>.
"""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Workspace

log = logging.getLogger("agentic.compliance")

SETTINGS_KEY = "compliance"
REQUEST_EVERY = 300  # seconds: one "wanted to use" record per service per 5 minutes

# Tools that reach an outside service, by the service they need.
TOOL_SERVICE: dict[str, str] = {
    **{n: "web" for n in ("web_search", "web_fetch", "research_gather")},
    **{
        n: "m365"
        for n in (
            "teams_chats",
            "teams_read_chat",
            "teams_send",
            "teams_channels",
            "teams_read_channel",
        )
    },
    **{n: "google" for n in ("email_search", "email_read", "email_draft_reply", "email_draft")},
    **{
        n: "google"
        for n in (
            "calendar_agenda",
            "calendar_free_slots",
            "calendar_create_event",
            "calendar_update_event",
            "calendar_cancel_event",
        )
    },
    **{n: "mcp" for n in ("tool_search", "tool_describe", "tool_call")},
}

KINDS: dict[str, str] = {
    "ai": "AI provider",
    "storage": "File storage",
    "web": "The web",
    "telegram": "Messaging",
    "whatsapp": "Messaging",
    "push": "Phone notifications",
    "m365": "Microsoft 365",
    "google": "Google",
    "mcp": "Outside tools (MCP)",
    "proxy": "Web proxies",
}


def service_of_tool(name: str) -> str | None:
    if name.startswith("browser_"):
        return "web"
    if name.startswith("outlook_"):
        return "m365"
    return TOOL_SERVICE.get(name)


@dataclass(frozen=True)
class State:
    lock: bool
    approved: dict[str, Any]
    requests: dict[str, Any]

    def allows(self, key: str) -> bool:
        if not self.lock:
            return True
        family = key.split(":", 1)[0]
        # An MCP tool is approved with its servers ("mcp:<id>"); any approved server opens the
        # tool family, the server itself is checked where it is called.
        return key in self.approved or (
            key == family == "mcp" and any(k.startswith("mcp:") for k in self.approved)
        )


def state(ws: Workspace | None) -> State:
    raw = ((ws.settings if ws else None) or {}).get(SETTINGS_KEY) or {}
    return State(
        bool(raw.get("lock")),
        dict(raw.get("approved") or {}),
        dict(raw.get("requests") or {}),
    )


async def allowed(
    db: AsyncSession, workspace_id: str, key: str, label: str = "", what: str = ""
) -> bool:
    """May this workspace use `key` now? When it may not, the attempt is recorded as a request
    an owner sees (at most every few minutes per service)."""
    if not workspace_id:
        return True  # nothing to hold it to (an agent not yet saved)
    ws = await db.get(Workspace, workspace_id)
    st = state(ws)
    if st.allows(key):
        return True
    await _request(workspace_id, key, label, what)
    return False


async def _request(workspace_id: str, key: str, label: str, what: str) -> None:
    """Recorded in its own session, so the caller's transaction is never committed early."""
    from ..core.db import SessionLocal
    from ..services import events

    try:
        async with SessionLocal() as db:
            ws = await db.get(Workspace, workspace_id, with_for_update=True)
            if ws is None:
                return
            settings = dict(ws.settings or {})
            comp = dict(settings.get(SETTINGS_KEY) or {})
            reqs = dict(comp.get("requests") or {})
            now = datetime.now(UTC)
            prev = reqs.get(key) or {}
            last = prev.get("last_at")
            if last and (now - datetime.fromisoformat(last)).total_seconds() < REQUEST_EVERY:
                return
            reqs[key] = {
                "label": label or prev.get("label") or key,
                "kind": KINDS.get(key.split(":", 1)[0], "Service"),
                "first_at": prev.get("first_at") or now.isoformat(),
                "last_at": now.isoformat(),
                "count": int(prev.get("count") or 0) + 1,
                "what": what[:300],
            }
            comp["requests"] = reqs
            settings[SETTINGS_KEY] = comp
            ws.settings = settings
            await db.commit()
        await events.publish(workspace_id, "compliance.request", {"key": key})
    except Exception:  # noqa: BLE001 - recording a request must never break the caller
        log.warning("could not record the service request %s", key, exc_info=True)


BLOCKED = (
    "Not used: {label} is not on the company's approved services. An owner can approve it in "
    "Settings > Approved services."
)
