"""The nightly dream: tidy memory while nobody is working.

1. Bring in edits made directly in the vault (Obsidian).
2. Merge facts that say the same thing; settle facts that contradict (the newer one wins,
   the older gets valid_to). Near-certain duplicates merge without a model; borderline
   pairs go to the `fast` group in one batched call.
3. Rebuild index.md.
4. Write DREAMS/<date>.md, a diary people review in the dashboard, where every merge or
   correction can be undone.
"""

import logging
from datetime import UTC, date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..engine import gateway
from ..models import BrainDream, BrainFact, BrainPage, Workspace
from ..services import events
from ..skills import curator as skills_curator
from ..skills import store as skills_store
from . import store
from .facts import end, has_list, parse_json, same_numbers

log = logging.getLogger("agentic.brain.dream")

MERGE_SIMILARITY = 0.97
JUDGE_SIMILARITY = 0.80
JUDGE_BATCH = 30

JUDGE = """You check pairs of facts from an office's memory. For each pair answer:
- duplicate: both say the same thing
- contradiction: both cannot be true now (the NEWER one is current)
- fine: different facts, or compatible
Return JSON only: {"verdicts": [{"pair": 1, "verdict": "fine"}]}"""

_PAIRS = text(
    """
    SELECT a.id AS a_id, b.id AS b_id, 1 - (a.embedding <=> b.embedding) AS sim
    FROM brain_facts a
    JOIN LATERAL (
        SELECT id, embedding FROM brain_facts b
        WHERE b.workspace_id = a.workspace_id AND b.valid_to IS NULL AND b.id <> a.id
          AND b.embedding IS NOT NULL
          AND b.agent_id IS NOT DISTINCT FROM a.agent_id
          AND b.branch_id IS NOT DISTINCT FROM a.branch_id
        ORDER BY b.embedding <=> a.embedding
        LIMIT 3
    ) b ON true
    WHERE a.workspace_id = :ws AND a.valid_to IS NULL AND a.embedding IS NOT NULL
      AND 1 - (a.embedding <=> b.embedding) >= :min_sim
    ORDER BY sim DESC
    LIMIT 600
    """
)


def local_day(ws: Workspace, now: datetime | None = None) -> date:
    return (now or datetime.now(UTC)).astimezone(ZoneInfo(ws.timezone)).date()


async def _judge(
    db: AsyncSession, ws: Workspace, pairs: list[tuple[BrainFact, BrainFact]]
) -> dict[int, str]:
    lines = []
    for i, (old, new) in enumerate(pairs, start=1):
        lines += [f"PAIR {i}", f"  OLDER: {old.text}", f"  NEWER: {new.text}"]
    for group in ("fast", "smart"):
        try:
            r = await gateway.chat(
                db,
                ws.id,
                group,
                [
                    {"role": "system", "content": JUDGE},
                    {"role": "user", "content": "\n".join(lines)},
                ],
                task="brain.dream",
                # ~20 tokens a verdict plus the wrapper; thinking models get more anyway.
                max_tokens=200 + 30 * len(pairs),
                temperature=0,
                json_mode=True,
                accept=has_list("verdicts"),
            )
        except gateway.GatewayUnavailable:
            continue
        out = {}
        for v in parse_json(r.content).get("verdicts") or []:
            if isinstance(v, dict) and isinstance(v.get("pair"), int):
                out[v["pair"]] = str(v.get("verdict", "fine"))
        return out
    raise gateway.GatewayUnavailable("No model available for the dream.", [])


async def _consolidate(
    db: AsyncSession, ws: Workspace, stats: dict[str, Any]
) -> list[dict[str, Any]]:
    rows = (await db.execute(_PAIRS, {"ws": ws.id, "min_sim": JUDGE_SIMILARITY})).all()
    seen: set[tuple[str, str]] = set()
    pairs: list[tuple[str, str, float]] = []
    for a, b, sim in rows:
        key = (min(a, b), max(a, b))
        if key not in seen:
            seen.add(key)
            pairs.append((a, b, float(sim)))
    ids = {i for a, b, _ in pairs for i in (a, b)}
    facts = {
        f.id: f for f in (await db.scalars(select(BrainFact).where(BrainFact.id.in_(ids)))).all()
    }
    changes: list[dict[str, Any]] = []
    borderline: list[tuple[BrainFact, BrainFact, float]] = []

    def apply(kind: str, old: BrainFact, new: BrainFact, sim: float) -> None:
        end(old, "merged" if kind == "merge" else "contradicted", new.id)
        if kind == "merge":
            new.hits += old.hits
            new.confidence = max(new.confidence, old.confidence)
        changes.append(
            {
                "kind": kind,
                "ended": old.id,
                "ended_text": old.text,
                "kept": new.id,
                "kept_text": new.text,
                "similarity": round(sim, 3),
                "undone": False,
            }
        )

    for a, b, sim in pairs:
        fa, fb = facts.get(a), facts.get(b)
        if fa is None or fb is None or fa.valid_to or fb.valid_to:
            continue
        old, new = sorted((fa, fb), key=lambda f: (f.valid_from, f.id))
        exact = old.text.strip().rstrip(".").lower() == new.text.strip().rstrip(".").lower()
        if exact or (sim >= MERGE_SIMILARITY and same_numbers(old.text, new.text)):
            apply("merge", old, new, sim)
        else:
            borderline.append((old, new, sim))

    judged = 0
    for i in range(0, len(borderline), JUDGE_BATCH):
        batch = [
            (o, n, s)
            for o, n, s in borderline[i : i + JUDGE_BATCH]
            if not (o.valid_to or n.valid_to)
        ]
        if not batch:
            continue
        try:
            verdicts = await _judge(db, ws, [(o, n) for o, n, _ in batch])
        except gateway.GatewayUnavailable:
            stats["judge_skipped"] = "no model available; only exact duplicates were merged"
            break
        judged += len(batch)
        for j, (old, new, sim) in enumerate(batch, start=1):
            if old.valid_to or new.valid_to:
                continue
            verdict = verdicts.get(j, "fine")
            if verdict == "duplicate":
                apply("merge", old, new, sim)
            elif verdict == "contradiction":
                apply("contradiction", old, new, sim)
    stats["pairs_checked"] = len(pairs)
    stats["pairs_judged"] = judged
    await db.commit()
    return changes


def _n(n: int, word: str) -> str:
    return f"{n} {word}" + ("" if n == 1 else "s")


def _diary(ws: Workspace, day: date, changes: list[dict[str, Any]], stats: dict[str, Any]) -> str:
    merges = [c for c in changes if c["kind"] == "merge"]
    fixes = [c for c in changes if c["kind"] == "contradiction"]
    imports = [c for c in changes if c["kind"] == "import"]
    conflicts = [c for c in changes if c["kind"] == "conflict"]
    out = [
        f"# Dream diary, {day:%d %B %Y}",
        "",
        f"{_n(stats.get('facts_learned', 0), 'fact')} learned and "
        f"{_n(stats.get('pages_changed', 0), 'page')} changed since the last dream. "
        f"{_n(len(merges), 'duplicate')} merged, {_n(len(fixes), 'contradiction')} settled, "
        f"{_n(len(imports), 'vault edit')} imported.",
        "",
        "Review and undo in the dashboard: Brain > Dreams.",
    ]
    if merges:
        out += ["", f"## Merged duplicates ({len(merges)})"]
        out += [f'- "{c["ended_text"]}" merged into "{c["kept_text"]}"' for c in merges]
    if fixes:
        out += ["", f"## Contradictions settled ({len(fixes)})"]
        out += [f'- "{c["ended_text"]}" is out of date. Now: "{c["kept_text"]}"' for c in fixes]
    if imports:
        out += ["", f"## Imported from the vault ({len(imports)})"]
        out += [f"- [[{c['path'].rsplit('/', 1)[-1][:-3]}]] ({c['path']})" for c in imports]
    if conflicts:
        out += ["", f"## Edited in two places ({len(conflicts)})"]
        out += [
            f"- {c['path']}: the dashboard copy was kept, the vault copy saved beside it"
            for c in conflicts
        ]
    skills = [c for c in changes if c["kind"] == "skill"]
    if skills:
        out += ["", f"## Skills ({len(skills)})", "Proposals wait in Skills > Proposals."]
        for c in skills:
            name, action = c["name"], c.get("action", "")
            pct = round((c.get("success_rate") or 0) * 100)
            out.append(
                {
                    "merge": f"- Proposed merging {c.get('other')} into {name}",
                    "retire": f"- Proposed retiring {name} (unused for {c.get('days')} days)",
                    "flag": f"- {name} was accepted only {pct}% of the last {c.get('uses')} "
                    "times; worth a look",
                    "vault_edit": f"- {name} was edited in the vault; the edit waits for review",
                }.get(action, f"- {name}")
            )
    if stats.get("judge_skipped"):
        out += ["", f"Note: {stats['judge_skipped']}."]
    return "\n".join(out) + "\n"


async def run_dream(
    db: AsyncSession, ws: Workspace, day: date | None = None, *, force: bool = False
) -> BrainDream:
    day = day or local_day(ws)
    d = await db.scalar(
        select(BrainDream).where(BrainDream.workspace_id == ws.id, BrainDream.day == day)
    )
    if d is not None and d.status in ("done", "running") and not force:
        return d
    since = await db.scalar(
        select(func.max(BrainDream.started_at)).where(
            BrainDream.workspace_id == ws.id, BrainDream.status == "done", BrainDream.day < day
        )
    ) or datetime(2000, 1, 1, tzinfo=UTC)
    if d is None:
        d = BrainDream(workspace_id=ws.id, day=day)
        db.add(d)
    d.status, d.error, d.changes, d.stats = "running", None, [], {}
    d.started_at, d.finished_at = datetime.now(UTC), None
    await db.commit()
    await events.publish(ws.id, "brain.dream", {"dream_id": d.id, "status": "running"})
    try:
        stats: dict[str, Any] = {}
        sync = await store.sync_from_vault(db, ws)
        changes: list[dict[str, Any]] = [{"kind": "import", "path": p} for p in sync.imported]
        changes += [{"kind": "conflict", "path": p} for p in sync.conflicts]
        stats["vault"] = {
            "imported": len(sync.imported),
            "deleted": len(sync.deleted),
            "conflicts": len(sync.conflicts),
        }
        changes += await _consolidate(db, ws, stats)
        changes += [
            {"kind": "skill", "action": "vault_edit", "name": n}
            for n in await skills_store.ingest_vault(db, ws, sync.imported)
        ]
        try:
            changes += await skills_curator.run(db, ws)
        except Exception:  # noqa: BLE001 - the curator must never sink the dream
            log.warning("skill curator failed for %s", ws.id, exc_info=True)
            await db.rollback()
        await store.rebuild_index(db, ws)
        stats["facts_learned"] = await db.scalar(
            select(func.count())
            .select_from(BrainFact)
            .where(BrainFact.workspace_id == ws.id, BrainFact.created_at >= since)
        )
        stats["pages_changed"] = await db.scalar(
            select(func.count())
            .select_from(BrainPage)
            .where(
                BrainPage.workspace_id == ws.id,
                BrainPage.updated_at >= since,
                BrainPage.kind.not_in(("dream", "log", "root")),
            )
        )
        stats["active_facts"] = await db.scalar(
            select(func.count())
            .select_from(BrainFact)
            .where(BrainFact.workspace_id == ws.id, BrainFact.valid_to.is_(None))
        )
        path = f"DREAMS/{day:%Y-%m-%d}.md"
        await store.save_page(
            db,
            ws,
            path,
            _diary(ws, day, changes, stats),
            store.SYSTEM,
            f"Dream diary {day:%Y-%m-%d}",
        )
        d.changes, d.stats, d.diary_path = changes, stats, path
        d.status, d.finished_at = "done", datetime.now(UTC)
        await db.commit()
    except Exception as e:
        log.exception("dream failed for %s", ws.id)
        await db.rollback()
        d = await db.get(BrainDream, d.id) or d
        d.status, d.error, d.finished_at = (
            "failed",
            f"{e.__class__.__name__}: {e}",
            datetime.now(UTC),
        )
        await db.commit()
    await events.publish(ws.id, "brain.dream", {"dream_id": d.id, "status": d.status})
    return d


async def undo(db: AsyncSession, d: BrainDream, index: int) -> dict[str, Any]:
    """Bring back the fact a merge or correction ended. Vault imports are undone with git."""
    changes = [dict(c) for c in d.changes]
    if not 0 <= index < len(changes):
        raise IndexError("no such change")
    c = changes[index]
    if c["kind"] not in ("merge", "contradiction"):
        raise ValueError("Vault imports are undone in git, not here.")
    if not c.get("undone"):
        f = await db.get(BrainFact, c["ended"])
        if f is not None and f.superseded_by == c["kept"]:
            f.valid_to, f.end_reason, f.superseded_by = None, None, None
        c["undone"] = True
        d.changes = changes  # reassign so SQLAlchemy sees the JSONB change
        await db.commit()
    return c
