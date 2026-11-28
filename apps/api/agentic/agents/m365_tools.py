"""P147: m365_search, the Microsoft 365 Copilot Retrieval API for a person's own AI.

Finds passages in the SharePoint and OneDrive files the person can already open, as that person
(their own delegated token; Microsoft trims the results to their access). Read only, risk low.
Offered only when microsoft.copilot.search_ready (the owner turned Copilot first on with Microsoft
365 search, the person allowed Copilot, and is not known to lack the licence) and gated like the
Teams tools (microsoft.access.TEAMS_TOOLS: the person's own AI, only when they asked themselves).
The passages are outside text: fenced, like any file or message the AI reads.
"""

from typing import Any

from ..core.fence import fence
from ..core.workspace_settings import copilot_first
from ..microsoft import access, copilot
from .tools import Tool, ToolContext, _threat_note

PASSAGE_MAX = 600
PASSAGES_PER_FILE = 2
NOT_READY = {
    copilot.NO_MICROSOFT: (
        "Error: there is no Microsoft 365 work account you may use. Your person connects their "
        "own work account on the Microsoft 365 page."
    ),
    copilot.NO_SCOPE: (
        "Error: Microsoft 365 search is not allowed yet. Tell your person to press Allow "
        "Microsoft 365 Copilot on the Microsoft 365 page; until then use search_library."
    ),
    copilot.NO_LICENCE: (
        "Error: your person has no Microsoft 365 Copilot licence, so Microsoft 365 search is not "
        "available. Use search_library for the office's own documents."
    ),
    copilot.THROTTLED: (
        "Error: Microsoft 365 is busy for your person right now. Try again in a few minutes, or "
        "use search_library meanwhile."
    ),
}


async def _search(ctx: ToolContext, args: dict[str, Any]) -> str:
    query = " ".join(str(args.get("query") or "").split())
    if not query:
        return "Error: say what to look for (one sentence)."
    cf = copilot_first(ctx.workspace.settings)
    if not (cf.on and cf.use_retrieval):
        return "Error: Microsoft 365 search is switched off here. Use search_library."
    acct = await access.teams_account(ctx.db, ctx.agent)
    if acct is None or copilot.is_personal(acct):
        return NOT_READY[copilot.NO_MICROSOFT]
    st = await copilot.status(ctx.db, acct.workspace_id, acct.user_id)
    if not st.ready or st.account is None:
        return NOT_READY.get(st.state, NOT_READY[copilot.NO_LICENCE])
    where = str(args.get("where") or "both").lower()
    try:
        limit = int(args.get("limit") or 8)
    except (TypeError, ValueError):
        limit = 8
    try:
        hits = await copilot.retrieve(ctx.db, st.account, query, where, limit)
    except copilot.CopilotFailed as e:
        if e.kind == "throttled":
            return NOT_READY[copilot.THROTTLED]
        if e.kind == "forbidden":
            return NOT_READY[copilot.NO_LICENCE]
        if e.kind == "unauthorized":
            return NOT_READY[copilot.NO_SCOPE]
        return f"Error: Microsoft 365 search did not answer ({e.kind}). Try search_library."
    if not hits:
        return (
            f"No passages in your person's SharePoint or OneDrive files match {query!r}. Try "
            "other words, or search_library for the office's own documents."
        )
    lines = [f"{len(hits)} file(s) from Microsoft 365 for {query!r}, best first:"]
    for i, h in enumerate(hits, 1):
        lines.append(f"\n[{i}] {h.title} ({h.source}) {h.url}")
        for p in h.passages[:PASSAGES_PER_FILE]:
            text = p if len(p) <= PASSAGE_MAX else p[:PASSAGE_MAX].rstrip() + "..."
            lines.append(f"  - {text}")
    out = "\n".join(lines)
    return (
        fence(out)
        + _threat_note(out)
        + "\nCite the files you use as [title](url). Only your person sees these files."
    )


M365_TOOLS: list[Tool] = [
    Tool(
        "m365_search",
        "Search Microsoft 365",
        "Find passages in your person's own SharePoint and OneDrive files (Microsoft 365 "
        "Copilot search, only what they may open). Prefer this when they ask to find something "
        "in 'my SharePoint', 'my OneDrive', 'our SharePoint site' or 'my files in Microsoft "
        "365'; search_library is for the office's own library. Ask in one clear sentence "
        "(1,500 characters at most). Returns titles, links and the best passages.",
        {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "one sentence: what to find"},
                "where": {
                    "type": "string",
                    "enum": ["both", "sharepoint", "onedrive"],
                    "description": "default both",
                },
                "limit": {"type": "integer", "description": "files, 1-25, default 8"},
            },
            "required": ["query"],
        },
        "low",
        "allow",
        _search,
    ),
]

assert {t.name for t in M365_TOOLS} == access.COPILOT_TOOLS
