"""P25: search_documents, the same document search people use, for agents.

It looks through the agent's company files page by page (not only the library), its SOPs,
documents and templates, for words, phrases ("quoted"), amounts (RM700), dates and codes,
and answers with cited hits ([title p.N]) and where to read more. Held-back files never
appear. Its setting follows search_library (an agent denied the library is denied this).
"""

from typing import Any

from ..search import engine
from ..search.viewer import for_agent
from .tools import Tool, ToolContext

DEFAULT_TOP_K = 5
MAX_TOP_K = 10


async def _search_documents(ctx: ToolContext, args: dict[str, Any]) -> str:
    query = str(args.get("query") or "").strip()
    if not query:
        return "Error: say what you are looking for."
    top_k = args.get("top_k")
    k = int(top_k) if isinstance(top_k, int | float) else DEFAULT_TOP_K
    k = max(1, min(MAX_TOP_K, k))
    kind = str(args.get("kind") or "").strip().lower() or None
    res = await engine.search(
        ctx.db, for_agent(ctx.agent), query, engine.Filters(kind=kind), limit=k
    )
    if not res.hits:
        return (
            f'No document matches {query!r}. Try fewer or other words, a "quoted phrase", '
            "search_library (by meaning), or company_documents to browse."
        )
    return engine.render_tool(query, res)


SEARCH_TOOLS = (
    Tool(
        "search_documents",
        "Search documents",
        "Search inside every document of your company — uploaded files page by page, SOPs, "
        'prepared documents and templates — for exact words, "quoted phrases", amounts '
        "(RM700), dates (16hb) or codes. Returns hits with title, page and file id; cite "
        "them as [title p.N] and use read_file with pages='N' for the full page. Use "
        "search_library to find guidance by meaning.",
        {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": 'Words, a "phrase", an amount'},
                "kind": {
                    "type": "string",
                    "description": "Only files of this kind (sop, guide, form, policy, "
                    "contract, certificate, ...)",
                },
                "top_k": {
                    "type": "integer",
                    "description": f"How many hits (1-{MAX_TOP_K}, default {DEFAULT_TOP_K})",
                },
            },
            "required": ["query"],
        },
        "low",
        "allow",
        _search_documents,
    ),
)
