"""P96: answer reuse. The same question to the same agent, from the same person, with the same
sources, is answered from what the agent already said instead of a new model call.

What makes two questions "the same" is everything the model would have read, byte for byte:
the system prompt (rules, SOPs, the agent's frozen memory), the recalled facts, pages and
lessons riding on the question, the language note, the tool list, and the question itself.
Any change to any of them (a new fact, an edited SOP, a lesson, another language) is another
key, so a reused answer is never older than what the agent knows.

Freshness and safety rules:
- Only the first message of a conversation (a follow-up depends on the turns before it).
- Only answers written without any tool (a tool's result can change by the minute: mail,
  files, calendars, prices); and never a cut-off or backup answer.
- Never a question about now (today, this week, latest, hari ini, terkini, ...).
- One person's answers are never given to another person (the person is in the key), and each
  workspace has its own keys.
- Kept for a day at most (TTL), so even unchanged knowledge is asked again daily.
- Off with the agent's "reuse what it learned" switch (skills/routines.replay_on).
"""

import contextlib
import hashlib
import json
import re
from typing import Any

TTL = 24 * 3600
MAX_CHARS = 12_000
MIN_QUESTION = 8
_TIMELY = re.compile(
    r"\b(today|tonight|now|tomorrow|yesterday|latest|newest|recent|current|currently|"
    r"this (morning|week|month|year)|next (week|month)|last (week|month)|"
    r"hari ini|malam ini|sekarang|esok|semalam|terkini|terbaru|minggu ini|bulan ini|"
    r"tahun ini|minggu depan|bulan depan|pukul|jam berapa|tarikh)\b",
    re.IGNORECASE,
)


def timely(question: str) -> bool:
    """A question about now: its answer changes with the clock."""
    return bool(_TIMELY.search(question or ""))


def key(
    workspace_id: str,
    agent_id: str,
    user_id: str,
    group: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None,
) -> str:
    raw = json.dumps([agent_id, user_id, group, messages, tools], sort_keys=True, default=str)
    return f"answers:{workspace_id}:{hashlib.sha256(raw.encode()).hexdigest()}"


def _stats_key(workspace_id: str) -> str:
    return f"answers:stats:{workspace_id}"


async def lookup(k: str) -> dict[str, Any] | None:
    """{content, model, tokens} kept for this key, or None."""
    from ..core.valkey import valkey

    try:
        hit = await valkey().get(k)
    except Exception:  # noqa: BLE001 - no Valkey: ask the model
        return None
    if not hit:
        return None
    try:
        data = json.loads(hit)
    except (TypeError, ValueError):
        return None
    return data if isinstance(data, dict) and data.get("content") else None


async def keep(k: str, content: str, model: str, tokens: int) -> None:
    from ..core.valkey import valkey

    if not content.strip() or len(content) > MAX_CHARS:
        return
    with contextlib.suppress(Exception):  # no Valkey: nothing kept, nothing lost
        await valkey().set(
            k, json.dumps({"content": content, "model": model, "tokens": int(tokens)}), ex=TTL
        )


async def count(workspace_id: str, agent_id: str, saved: int) -> None:
    """One reused answer and the tokens it did not spend, per agent (for the AI use page)."""
    from ..core.valkey import valkey

    with contextlib.suppress(Exception):
        await valkey().hincrby(_stats_key(workspace_id), f"{agent_id}:hits", 1)
        await valkey().hincrby(_stats_key(workspace_id), f"{agent_id}:saved", int(saved))


async def stats(workspace_id: str) -> dict[str, dict[str, int]]:
    """{agent_id: {"hits": n, "saved": tokens}} for the workspace."""
    from ..core.valkey import valkey

    try:
        raw = await valkey().hgetall(_stats_key(workspace_id))
    except Exception:  # noqa: BLE001 - no Valkey: no numbers
        return {}
    out: dict[str, dict[str, int]] = {}
    for field, value in (raw or {}).items():
        f = field.decode() if isinstance(field, bytes) else str(field)
        agent_id, _, what = f.rpartition(":")
        if agent_id and what in ("hits", "saved"):
            out.setdefault(agent_id, {"hits": 0, "saved": 0})[what] = int(value)
    return out


async def forget_agent(workspace_id: str, agent_id: str) -> None:
    """The agent's counters go (its kept answers expire within a day; the switch stops their
    use at once)."""
    from ..core.valkey import valkey

    with contextlib.suppress(Exception):
        await valkey().hdel(_stats_key(workspace_id), f"{agent_id}:hits", f"{agent_id}:saved")


def may_reuse(question: str, first_turn: bool, lesson_noted: bool, on: bool) -> bool:
    """The rules above that do not need the model's reply."""
    return (
        on
        and first_turn
        and not lesson_noted
        and len((question or "").strip()) >= MIN_QUESTION
        and not timely(question)
    )
