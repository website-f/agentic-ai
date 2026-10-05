"""Prompt-cache health (P21, idea from headroom's CacheAligner).

Providers reuse (and bill much less for) a prompt prefix they saw moments ago. The prefix is
the system message and the tool list, so every call records their hash (llm_calls.prefix_hash,
see gateway.prefix_hash). Here the calls are grouped per agent and job kind:

- how many distinct prefixes it sent,
- how often the prefix changed against the previous call of the same run (the same task, or
  for chats and office jobs the previous call of the same agent and kind),
- the share of prompt tokens the provider served from its cache, earlier vs recently.

"Prefix churn" (more than 20% of calls changed it) or a clear drop in the cached share is
flagged, in plain words, on the AI Engine Usage tab.
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from typing import Any

CHURN_SHARE = 0.20
DROP = 0.15  # cached share fell by at least this much (absolute) from the earlier half
MIN_CALLS = 5  # fewer calls than this say nothing


@dataclass(frozen=True)
class Call:
    ts: datetime
    agent_id: str | None
    task: str  # the job kind, e.g. agent.task
    task_id: str | None
    prefix_hash: str
    prompt_tokens: int
    cached_tokens: int


def _share(cached: int, prompt: int) -> float | None:
    return round(cached / prompt, 3) if prompt > 0 else None


def report(calls: list[Call], names: dict[str, str]) -> list[dict[str, Any]]:
    """One row per (agent, job kind), worst first. `calls` must be in time order."""
    previous: dict[tuple[str | None, str], str] = {}
    groups: dict[tuple[str | None, str], list[tuple[Call, bool | None]]] = defaultdict(list)
    for c in calls:
        run = (c.agent_id, c.task_id or f"kind:{c.task}")
        before = previous.get(run)
        changed = None if before is None else before != c.prefix_hash
        previous[run] = c.prefix_hash
        groups[(c.agent_id, c.task)].append((c, changed))

    out: list[dict[str, Any]] = []
    for (agent_id, kind), items in groups.items():
        n = len(items)
        compared = [ch for _, ch in items if ch is not None]
        changes = sum(1 for ch in compared if ch)
        prompt = sum(c.prompt_tokens for c, _ in items)
        cached = sum(c.cached_tokens for c, _ in items)
        half = n // 2
        early, late = items[:half], items[half:]
        before = _share(
            sum(c.cached_tokens for c, _ in early), sum(c.prompt_tokens for c, _ in early)
        )
        recent = _share(
            sum(c.cached_tokens for c, _ in late), sum(c.prompt_tokens for c, _ in late)
        )
        change_share = round(changes / len(compared), 3) if compared else 0.0
        flags = []
        if n >= MIN_CALLS and len(compared) >= MIN_CALLS - 1 and change_share > CHURN_SHARE:
            flags.append("prefix_churn")
        if (
            n >= 2 * MIN_CALLS
            and before is not None
            and recent is not None
            and before > 0
            and before - recent >= DROP
        ):
            flags.append("cache_drop")
        who = names.get(agent_id or "", "") if agent_id else ""
        out.append(
            {
                "agent_id": agent_id,
                "agent_name": who or ("Office jobs" if not agent_id else "Removed agent"),
                "task": kind,
                "calls": n,
                "prefixes": len({c.prefix_hash for c, _ in items}),
                "changes": changes,
                "change_share": change_share,
                "prompt_tokens": prompt,
                "cached_tokens": cached,
                "cached_share": _share(cached, prompt),
                "cached_share_before": before,
                "cached_share_recent": recent,
                "flags": flags,
                "note": note(who or "This job", flags),
            }
        )
    out.sort(key=lambda r: (-len(r["flags"]), -r["change_share"], -r["calls"]))
    return out


def note(who: str, flags: list[str]) -> str:
    if "prefix_churn" in flags:
        return (
            f"{who}'s instructions change between calls, so the provider can't reuse its cache "
            "— it costs more."
        )
    if "cache_drop" in flags:
        return (
            f"Less of {who}'s prompt is being served from the provider's cache than before, so "
            "each call costs more."
        )
    return ""
