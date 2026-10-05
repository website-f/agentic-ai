"""expand_result: read the full original of a tool result that was sent shortened (P21).

Big tool results reach the model compressed (compress.py) or, when old, as one-line stubs
(context.py); both point here. The original always stays in agent_messages.content. An agent
can only read results from its own task or its own chat session: anything else answers "not
found", the same as a missing id, so ids from other work reveal nothing.
"""

from typing import Any

from ..models import AgentMessage
from . import compress
from .tools import Tool, ToolContext

DEFAULT_LIMIT = 50
MAX_LIMIT = 200
MATCH_LIMIT = 30
MAX_CHARS = 12_000  # one expand_result answer stays under the old MCP cut


async def _find(ctx: ToolContext, message_id: int) -> AgentMessage | None:
    m = await ctx.db.get(AgentMessage, message_id)
    if m is None or m.role != "tool" or m.workspace_id != ctx.workspace.id:
        return None
    if ctx.task is not None:
        return m if m.task_id == ctx.task.id else None
    if ctx.session_id is not None:
        return m if m.session_id == ctx.session_id else None
    return None


def _page(rows: list[tuple[int, str]], total: int, next_hint: str) -> str:
    out, size = [], 0
    for i, text in rows:
        line = f"[{i}] {text}"
        if out and size + len(line) > MAX_CHARS:
            out.append(
                f"[… stopped at {MAX_CHARS:,} characters: continue with offset={i}{next_hint}]"
            )
            break
        out.append(line)
        size += len(line) + 1
    return "\n".join(out)


async def _expand_result(ctx: ToolContext, args: dict[str, Any]) -> str:
    try:
        message_id = int(args.get("message_id"))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return "Error: give message_id, the number in the shortened result's note."
    m = await _find(ctx, message_id)
    if m is None:
        return (
            f"Error: there is no tool result {message_id} in this "
            f"{'task' if ctx.task is not None else 'conversation'}."
        )
    text = m.content or ""
    parts = compress.units(text)
    total = len(parts)
    query = str(args.get("query") or "").strip()
    try:
        offset = max(0, int(args.get("offset") or 0))
        limit = min(MAX_LIMIT, max(1, int(args.get("limit") or DEFAULT_LIMIT)))
    except (TypeError, ValueError):
        return "Error: offset and limit must be whole numbers."
    head = (
        f"Full {m.name or 'tool'} result {message_id}: {total:,} rows/lines, "
        f"{len(text):,} characters."
    )
    if query:
        scores = compress.bm25([compress.terms(p) for p in parts], compress.terms(query))
        if not any(scores):  # rare words only: fall back to a plain substring search
            q = query.lower()
            scores = [float(q in p.lower()) for p in parts]
        hits = sorted((i for i in range(total) if scores[i] > 0), key=lambda i: -scores[i])
        hits = sorted(hits[: min(limit, MATCH_LIMIT)])
        if not hits:
            return f"{head}\nNothing matches {query!r}. Page through it with offset and limit."
        body = _page([(i, parts[i]) for i in hits], total, "")
        return f"{head}\n{len(hits)} best matches for {query!r} (row numbers in brackets):\n{body}"
    if offset == 0 and not args.get("limit") and len(text) <= MAX_CHARS:
        return f"{head}\n{text}"
    window = list(range(offset, min(total, offset + limit)))
    if not window:
        return f"{head}\nNothing at offset {offset}; the last row is {total - 1}."
    body = _page([(i, parts[i]) for i in window], total, f", limit={limit}")
    more = (
        f"\n[rows {offset}-{window[-1]} of {total}; next: offset={window[-1] + 1}]"
        if window[-1] < total - 1
        else ""
    )
    return f"{head}\n{body}{more}"


COMPRESS_TOOLS = (
    Tool(
        "expand_result",
        "Read a full tool result",
        "Big tool results are sent shortened, with a note naming expand_result(message_id=…). "
        "Use it to read the full original: page with offset/limit (row or line numbers), or "
        "pass query to get the rows that match.",
        {
            "type": "object",
            "properties": {
                "message_id": {"type": "integer"},
                "query": {"type": "string"},
                "offset": {"type": "integer"},
                "limit": {"type": "integer"},
            },
            "required": ["message_id"],
        },
        "low",
        "allow",
        _expand_result,
    ),
)
