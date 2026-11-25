"""P127: the office's organization hierarchy and Prima's org chart kept in step, both ways.

Fitri (23 Nov 2026): "make sure the organization and hierarchy things sync with agentic side,
because agentic and prima is one so all things must be sync."

The office line is memberships.reports_to_user_id (org/hierarchy.py); Prima's is its org chart
(apps/prima/packages/core/src/org-structure.ts, docs/ORG_STRUCTURE.md): a line a head set, else
the job rules, a named unit head, more rules, and last the Chief of Staff marked "assumed". A
pair is an office member and their Prima account: their Prima link (models.PrimaLink), or for an
owner or admin (who open Prima as its top record with no link of their own) the sure match the
office links everyone else by (people.suggestions: their Microsoft account, else the only record
of exactly their name). One Prima account is never two members.

One run (sync()):
1. Prima is asked twice at most, never once per person: its staff list (the office's own system
   call: the top record and the matches) and its whole org chart as its top record (the CEO sees
   the whole group). A third read follows only when lines were sent to Prima in this run.
2. Each pair is compared with the line both sides last agreed on (PrimaOrgSync, the base):
   - the same manager on both sides (or none on both): in step;
   - an office line nobody has yet (no office line): Prima's is copied in;
   - only one side changed since the base: that side wins;
   - both changed: the side changed most recently wins (the office's time is when it was saved,
     members.set_manager; Prima's when a head set it). When that cannot be told, or on the first
     run where the office already has a different line (HR set it): the office keeps its line and
     the difference is shown. Nothing HR set is wiped by a first run.
   Never copied from Prima: an "assumed" line (the Chief of Staff fallback), a manager who is not
   an active member here, a line to oneself, a loop. A Prima line from the job cannot be removed
   in Prima: an office line cleared on such a person is shown as a difference.
3. An office line that wins goes to Prima's own route (POST /api/org/line) as its top record (the
   CEO may set any line), with the reason "Set in Agentic Office by <name>: <reason>". Prima
   checks its own rules. Before Prima's org chart settings are installed (module org-lines-v1),
   or on any refusal, it stays "waiting for Prima" with Prima's words and goes again next run;
   the office's own save is never undone or held up.
4. People with no Prima account here are skipped and counted.

Runs: after each applied office change (members router, in the background, after the answer),
every 30 minutes (worker schedule "prima-org-sync"), and "Sync with Prima" on the org chart
page. One run at a time per workspace (a Postgres advisory lock); a run that finds another
running answers with the last result.

Heads (P127 item 3): the office's heads of department (any office department, several per
department) do not map one to one onto Prima's named unit heads (16 central departments and 5
central companies, one head and one deputy each), so they are not synced; see HEADS_NOTE.
"""

import json
import logging
from dataclasses import dataclass, replace
from datetime import UTC, datetime

from fastapi import BackgroundTasks
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.db import SessionLocal
from ..models import Membership, PrimaLink, User, Workspace
from ..org import hierarchy
from ..services import audit
from . import client
from . import people as prima_people
from .client import PrimaError
from .org_sync_models import PrimaOrgSync, PrimaOrgSyncRun

log = logging.getLogger(__name__)

# Tests switch the after-change run off and call sync() themselves.
on = True
CHART_PATH = "/api/org/chart"
LINE_PATH = "/api/org/line"
ACTOR = "system:prima"
# Prima's line kinds: set by a head, from the job, the Chief of Staff fallback, the top.
REAL = ("set", "standard")
# Why a row shows as it does (the web turns each into words: pages/org-chart-sync.tsx).
WHY = (
    "office_newer", "prima_newer", "office_changed", "prima_changed", "filled_from_prima",
    "filled_to_prima", "prima_kept",
    "unsure_office_keeps", "both_changed_office_keeps", "prima_manager_not_linked",
    "office_manager_not_linked", "would_loop", "prima_no_line", "prima_job_line", "prima_top",
    "not_installed", "refused", "prima_down",
)  # fmt: skip
HEADS_NOTE = (
    "Heads are not synced: an office department may have several heads and sits in any company, "
    "while Prima names one head and one deputy for each of its 16 central departments and 5 "
    "central companies. Syncing them needs a map from office departments to Prima units."
)


@dataclass(frozen=True)
class PrimaLine:
    id: str
    name: str
    manager: str | None
    how: str
    at: str | None


@dataclass(frozen=True)
class PrimaChart:
    installed: bool
    people: dict[str, PrimaLine]

    def name(self, pid: str | None) -> str | None:
        line = self.people.get(pid or "")
        return line.name if line else None


def parse_chart(data: object) -> PrimaChart | None:
    """Prima's GET /api/org/chart answer, or None when it is not one."""
    if not isinstance(data, dict) or not isinstance(data.get("people"), list):
        return None
    out: dict[str, PrimaLine] = {}
    for p in data["people"]:
        if not isinstance(p, dict) or not p.get("id"):
            continue
        how = str(p.get("how") or "")
        set_by = p.get("setBy") if isinstance(p.get("setBy"), dict) else None
        out[str(p["id"])[:120]] = PrimaLine(
            id=str(p["id"])[:120],
            name=" ".join(str(p.get("name") or "").split())[:200],
            manager=(str(p["managerId"])[:120] if p.get("managerId") else None),
            how=how if how in ("set", "standard", "assumed", "top") else "standard",
            at=(str(set_by.get("at") or "") or None) if set_by else None,
        )
    return PrimaChart(installed=bool(data.get("installed")), people=out)


def real_manager(line: PrimaLine) -> str | None:
    """Prima's manager the office may follow: never the assumed fallback or the top's none."""
    return line.manager if line.how in REAL and line.manager != line.id else None


def _when(text_: str | None) -> datetime | None:
    if not text_:
        return None
    try:
        d = datetime.fromisoformat(text_.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=UTC)


def _message(ans: client.Answer) -> str:
    try:
        data = ans.json()
    except ValueError:
        return ""
    msg = data.get("message") if isinstance(data, dict) else None
    if isinstance(msg, list):
        msg = "; ".join(str(m) for m in msg)
    return str(msg or "")[:500]


# ---------------------------------------------------------------- office side


async def note_office_change(
    db: AsyncSession, workspace_id: str, user_id: str, by: str, reason: str | None = None
) -> None:
    """members.set_manager saved a new line: it goes to Prima on the next run (in the caller's
    transaction, so a change that is not applied is never sent)."""
    if not client.enabled(workspace_id):
        return
    st = await db.get(PrimaOrgSync, (workspace_id, user_id))
    if st is None:
        st = PrimaOrgSync(workspace_id=workspace_id, user_id=user_id)
        db.add(st)
    st.office_at = datetime.now(UTC)
    st.pending = True
    st.pending_by = (by or "")[:200] or None
    st.pending_reason = " ".join((reason or "").split())[:300] or None


def later(background: BackgroundTasks, workspace_id: str) -> None:
    """Run the sync after the answer has gone (the caller has committed)."""
    if on and client.enabled(workspace_id):
        background.add_task(run_now, workspace_id)


async def run_now(workspace_id: str) -> None:
    """A run in a session of its own. Never raises."""
    try:
        async with SessionLocal() as db:
            await sync(db, workspace_id)
    except Exception:
        log.exception("prima org sync: run failed (the next run tries again)")


async def tick() -> dict[str, int]:
    """The worker's schedule: every workspace Prima is set up for and has links in."""
    done = 0
    async with SessionLocal() as db:
        ids = (
            await db.scalars(
                select(Workspace.id).where(
                    select(PrimaLink.user_id).where(PrimaLink.workspace_id == Workspace.id).exists()
                )
            )
        ).all()
    from . import mirror  # late: mirror builds on client and the models

    for ws in ids:
        if client.enabled(ws):
            # P132: first the office follows Prima's companies and people, then the lines.
            await mirror.tick_one(ws)
            await run_now(ws)
            done += 1
    return {"workspaces": done}


async def pairs(
    db: AsyncSession, workspace_id: str, records: list[client.StaffRecord]
) -> dict[str, str]:
    """{office user id: Prima account id} for active members (module docstring)."""
    persons = await prima_people.people(db, workspace_id)
    out = {p.user_id: p.link.prima_user_id for p in persons if p.link}
    tops = [p for p in persons if p.link is None and p.role in client.TOP_ROLES]
    if tops:
        others = [p for p in persons if not (p.link is None and p.role in client.TOP_ROLES)]
        as_staff = [replace(p, role="staff") for p in tops]
        found = prima_people.suggestions(others + as_staff, client.matchable(records))
        out |= {p.user_id: found[p.user_id] for p in tops if p.user_id in found}
    seen: dict[str, int] = {}
    for pid in out.values():
        seen[pid] = seen.get(pid, 0) + 1
    return {u: pid for u, pid in out.items() if seen[pid] == 1}


# ---------------------------------------------------------------- one run


@dataclass
class Plan:
    user_id: str
    prima_id: str
    line: PrimaLine
    act: str  # "in_step", "take", "push", "differs"
    winner: str | None = None
    why: str | None = None
    manager: str | None = None  # take: the office manager to set; push: Prima's manager to send


def _decide(
    st: PrimaOrgSync | None,
    uid: str,
    office: str | None,
    office_in_prima: str | None,
    line: PrimaLine,
    rev: dict[str, str],
) -> Plan:
    pid = line.id
    p = real_manager(line)
    if (office is None and p is None) or (office is not None and office_in_prima == p):
        return Plan(uid, pid, line, "in_step")
    if line.how == "top":
        return Plan(uid, pid, line, "differs", "none", "prima_top")
    # P129 (Fitri, 24 Nov 2026: "we should follow the Prima side ... if Prima is not
    # complete, add some from Agentic"): Prima's chart is the hierarchy. Where Prima has a real
    # line (set by a head there, or from the job) the office follows it, whatever changed where;
    # the office's line goes to Prima only where Prima has none (its assumed Chief of Staff).
    if p is not None:
        moved = st is not None and st.synced_at is not None and p != st.prima_manager
        why = "prima_changed" if moved else "prima_kept"
        boss = rev.get(p)
        if boss is None:
            return Plan(uid, pid, line, "differs", "office", "prima_manager_not_linked")
        return Plan(uid, pid, line, "take", "prima", why, boss)
    if office is not None:
        if office_in_prima is None:
            return Plan(uid, pid, line, "differs", "office", "office_manager_not_linked")
        return Plan(uid, pid, line, "push", "office", "filled_to_prima", office_in_prima)
    # Neither side has a real line: nothing to do (handled as in step above).
    return Plan(uid, pid, line, "in_step")


async def _read_chart(top_id: str) -> PrimaChart | None:
    ans = await client._send("GET", CHART_PATH, top_id, "person", b"", "")
    if ans.status != 200:
        return None
    try:
        return parse_chart(ans.json())
    except ValueError:
        return None


async def _finish_run(
    db: AsyncSession, ws: str, ok: bool, problem: str | None, installed: bool, counts: dict
) -> PrimaOrgSyncRun:
    run = await db.get(PrimaOrgSyncRun, ws)
    if run is None:
        run = PrimaOrgSyncRun(workspace_id=ws)
        db.add(run)
    run.at = datetime.now(UTC)
    run.ok, run.problem, run.installed, run.counts = ok, problem, installed, counts
    await db.commit()
    return run


def _reason(st: PrimaOrgSync | None) -> str:
    by = (st.pending_by if st else None) or "an office editor"
    why = (st.pending_reason if st else None) or "no reason given"
    return f"Set in Agentic Office by {by}: {why}"[:300]


async def sync(db: AsyncSession, workspace_id: str) -> PrimaOrgSyncRun | None:
    """One run (module docstring); the run's row, or None when another run holds the lock or
    Prima is not set up here. Commits."""
    if not client.enabled(workspace_id):
        return None
    got = await db.scalar(
        text("SELECT pg_try_advisory_xact_lock(hashtext(:k))"),
        {"k": f"prima_org_sync:{workspace_id}"},
    )
    if not got:
        return None
    try:
        records = await client.staff()
    except PrimaError:
        return await _finish_run(db, workspace_id, False, "prima_down", False, {})
    top = client.top_of(records)
    if top is None:
        return await _finish_run(db, workspace_id, False, "no_top", False, {})
    try:
        chart = await _read_chart(top.id)
    except PrimaError:
        chart = None
    if chart is None:
        return await _finish_run(db, workspace_id, False, "prima_down", False, {})

    rows = (
        await db.execute(
            select(Membership, User)
            .join(User, User.id == Membership.user_id)
            .where(Membership.workspace_id == workspace_id)
        )
    ).all()
    members = {m.user_id: m for m, _ in rows}
    active = {m.user_id for m, u in rows if u.is_active}
    parent = {uid: m.reports_to_user_id for uid, m in members.items()}
    pair = await pairs(db, workspace_id, records)
    rev = {pid: uid for uid, pid in pair.items()}
    states = {
        s.user_id: s
        for s in (
            await db.scalars(select(PrimaOrgSync).where(PrimaOrgSync.workspace_id == workspace_id))
        ).all()
    }
    now = datetime.now(UTC)
    counts = {"in_step": 0, "waiting": 0, "differs": 0, "unlinked": 0, "not_on_chart": 0}
    counts |= {"from_prima": 0, "to_prima": 0}

    def row(uid: str) -> PrimaOrgSync:
        st = states.get(uid)
        if st is None:
            st = states[uid] = PrimaOrgSync(workspace_id=workspace_id, user_id=uid)
            db.add(st)
        return st

    def show(st: PrimaOrgSync, line: PrimaLine | None) -> None:
        st.prima_now = line.manager if line else None
        st.prima_now_name = chart.name(line.manager) if line else None
        st.prima_how = line.how if line else None

    plans: list[Plan] = []
    for uid in sorted(active):
        pid = pair.get(uid)
        if pid is None:
            counts["unlinked"] += 1
            if uid in states:
                states[uid].state, states[uid].why = "skipped", None
            continue
        line = chart.people.get(pid)
        if line is None:
            counts["not_on_chart"] += 1
            if uid in states:
                states[uid].state, states[uid].why = "skipped", None
            continue
        office = parent.get(uid)
        office = office if office in active else None
        plans.append(_decide(states.get(uid), uid, office, pair.get(office or ""), line, rev))

    # Prima -> office, one at a time against the chart as it grows (never a loop).
    for plan in plans:
        if plan.act != "take":
            continue
        boss = plan.manager
        assert boss is not None
        if boss == plan.user_id or plan.user_id in hierarchy.chain_up(parent, boss):
            plan.act, plan.winner, plan.why = "differs", "office", "would_loop"
            continue
        m = members[plan.user_id]
        before = m.reports_to_user_id
        m.reports_to_user_id = boss
        parent[plan.user_id] = boss
        await audit.record(
            db,
            workspace_id,
            ACTOR,
            "member.manager_changed",
            target=plan.user_id,
            before={"reports_to": before},
            after={"reports_to": boss},
            note="From Prima's org chart (P127 sync)",
        )
        counts["from_prima"] += 1

    # Office -> Prima.
    pushed: list[Plan] = []
    down = False
    for plan in plans:
        if plan.act != "push":
            continue
        st = row(plan.user_id)
        if not chart.installed or down:
            plan.act, plan.why = "waiting", "not_installed" if not chart.installed else "prima_down"
            st.message = None
            continue
        body = {"userId": plan.prima_id, "managerId": plan.manager, "reason": _reason(st)}
        raw = json.dumps(body, separators=(",", ":")).encode()
        try:
            ans = await client._send("POST", LINE_PATH, top.id, "person", raw, "")
        except PrimaError:
            down = True
            plan.act, plan.why = "waiting", "prima_down"
            continue
        await audit.record(
            db,
            workspace_id,
            ACTOR,
            "prima.org_line",
            target=plan.user_id,
            after={"prima_manager": plan.manager, "status": ans.status},
        )
        if 200 <= ans.status < 300:
            pushed.append(plan)
            counts["to_prima"] += 1
        else:
            plan.act, plan.why = "waiting", "refused"
            st.message = _message(ans) or None
    if pushed:
        try:
            again = await _read_chart(top.id)
        except PrimaError:
            again = None
        for plan in pushed:
            line = again.people.get(plan.prima_id) if again else None
            if line is None:  # as sent
                line = replace(
                    plan.line, manager=plan.manager, how="set" if plan.manager else "standard"
                )
            plan.line = line
            p = real_manager(line)
            if plan.manager is None and p is not None:
                plan.act, plan.why = "differs_after_push", "prima_job_line"
            else:
                plan.act = "pushed"

    for plan in plans:
        st = row(plan.user_id)
        office = parent.get(plan.user_id)
        office = office if office in active else None
        p = real_manager(plan.line)
        show(st, plan.line)
        if plan.act in ("in_step", "take", "pushed"):
            counts["in_step"] += 1
            st.state = "in_step"
            st.winner = plan.winner if plan.act != "in_step" else None
            st.why = plan.why if plan.act != "in_step" else None
            st.pending, st.message = False, None
            st.office_manager, st.prima_manager, st.synced_at = office, p, now
        elif plan.act == "waiting":
            counts["waiting"] += 1
            st.state, st.winner, st.why, st.pending = "waiting", "office", plan.why, True
            if plan.why != "refused":
                st.message = None
        else:  # a difference: the office keeps its line; both sides are the new base
            counts["differs"] += 1
            st.state, st.winner, st.why = "differs", plan.winner, plan.why
            st.message = None
            keep_pending = plan.why == "office_manager_not_linked"
            st.pending = keep_pending
            if not keep_pending:
                st.office_manager, st.prima_manager, st.synced_at = office, p, now
    return await _finish_run(db, workspace_id, True, None, chart.installed, counts)


# ---------------------------------------------------------------- what the chart page shows


async def status(db: AsyncSession, workspace_id: str) -> dict:
    """The last run and the people who are not in step (names from the office; Prima's names
    for Prima managers who are not members here)."""
    run = await db.get(PrimaOrgSyncRun, workspace_id)
    rows = (
        await db.scalars(
            select(PrimaOrgSync)
            .where(
                PrimaOrgSync.workspace_id == workspace_id,
                PrimaOrgSync.state.in_(("waiting", "differs")),
            )
            .order_by(PrimaOrgSync.state, PrimaOrgSync.updated_at.desc())
            .limit(500)
        )
    ).all()
    ids = {r.user_id for r in rows}
    mem = (
        {
            m.user_id: m
            for m in (
                await db.scalars(
                    select(Membership).where(
                        Membership.workspace_id == workspace_id, Membership.user_id.in_(ids)
                    )
                )
            ).all()
        }
        if ids
        else {}
    )
    want = ids | {m.reports_to_user_id for m in mem.values() if m.reports_to_user_id}
    links = {
        lk.prima_user_id: lk.user_id
        for lk in (
            await db.scalars(select(PrimaLink).where(PrimaLink.workspace_id == workspace_id))
        ).all()
    }
    want |= {links[r.prima_now] for r in rows if r.prima_now in links}
    names = (
        dict((await db.execute(select(User.id, User.name).where(User.id.in_(want)))).all())
        if want
        else {}
    )
    out = []
    for r in rows:
        m = mem.get(r.user_id)
        if m is None:
            continue
        boss = m.reports_to_user_id
        prima_member = links.get(r.prima_now or "")
        out.append(
            {
                "user_id": r.user_id,
                "name": names.get(r.user_id, ""),
                "office_line": names.get(boss) if boss else None,
                "prima_line": (names.get(prima_member) if prima_member else None)
                or r.prima_now_name,
                "prima_how": r.prima_how,
                "state": r.state,
                "winner": r.winner,
                "why": r.why,
                "message": r.message,
            }
        )
    return {
        "enabled": client.enabled(workspace_id),
        "last_run": (
            {
                "at": run.at.isoformat(),
                "ok": run.ok,
                "problem": run.problem,
                "installed": run.installed,
                "counts": run.counts or {},
            }
            if run
            else None
        ),
        "people": out,
        "heads_synced": False,
    }


async def prima_lines(db: AsyncSession, workspace_id: str) -> dict[str, tuple[str | None, str]]:
    """{office user id: (Prima manager's name, how)} as last seen (the export)."""
    rows = (
        await db.scalars(select(PrimaOrgSync).where(PrimaOrgSync.workspace_id == workspace_id))
    ).all()
    return {r.user_id: (r.prima_now_name, r.prima_how or "") for r in rows if r.prima_how}
