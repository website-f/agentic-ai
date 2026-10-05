"""Knowledge library tools for agents (P18): search the office's guidelines, manuals,
policies and SOPs, and get cited passages back."""

from typing import Any

from ..knowledge import search as library
from .tools import Tool, ToolContext

DEFAULT_TOP_K = 4
MAX_TOP_K = 8


async def _search_library(ctx: ToolContext, args: dict[str, Any]) -> str:
    from .search_tools import over_budget

    query = str(args.get("query") or "").strip()
    if not query:
        return "Error: say what you are looking for."
    stop = await over_budget(ctx)
    if stop:
        return stop
    top_k = args.get("top_k")
    k = int(top_k) if isinstance(top_k, int | float) else DEFAULT_TOP_K
    k = max(1, min(MAX_TOP_K, k))
    hits = await library.search(ctx.db, library.for_agent(ctx.agent), query, limit=k)
    if not hits:
        return (
            f"Nothing in the library matches {query!r}. Try other words, find_sop, recall, "
            "or ask_colleague."
        )
    return library.render_tool(query, hits)


LIBRARY_TOOLS = (
    Tool(
        "search_library",
        "Search the library",
        "Search the office's library — SOPs, guidelines, manuals and policies people "
        "uploaded — for passages about something (e.g. 'refund for damaged goods', 'claim "
        "limit for travel'). Returns numbered passages with their title, page and file id; "
        "cite the ones you use as [title p.N], and use read_file for the full text.",
        {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "What you need to know"},
                "top_k": {
                    "type": "integer",
                    "description": f"How many passages (1-{MAX_TOP_K}, default {DEFAULT_TOP_K})",
                },
            },
            "required": ["query"],
        },
        "low",
        "allow",
        _search_library,
    ),
)
