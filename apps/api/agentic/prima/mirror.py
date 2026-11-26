"""P132 (Fitri, 26 Nov 2026: "let Prima handle the organization and members ... next all will be
from Prima"): the office follows Prima's companies and people.

Prima is where companies, accounts, departments, lines and heads are kept (Accounts and access, the
org chart, Add company). Each run (with the org sync, every 30 minutes, prima/org_sync.tick):

- companies: a Prima company the office has not got becomes an office company (linked); an office
  company linked to one takes Prima's name. Nothing is deleted here.
- people: each Prima sign-in account (not a guard or a site device) is an office member: the one
  linked to it already (PrimaLink, or the office account it was made from, u-off-<id>), else the
  member with the same email or Microsoft account, else a new member with the email from their
  Prima staff record (they sign in with a code sent to it). No email: listed, not added.
- place: their office company is the one for their first Prima company; their department, the one
  named as Prima's central department (made when missing); else their own one there stays.
- access level: worked out from Prima (role, leadership, operations tier, unit heads: `derive`).
  The owner, global admins and IT support keep theirs (the office's own list), as do practice
  accounts (P131). A higher level is applied; a LOWER one and an account Prima closed are only
  listed ("held") until the owner applies them (`apply_held`), so nobody loses access by surprise.

`python -m agentic.prima.mirror` shows what a run would do; `--apply` runs it (`--held` also applies
what was held).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.db import SessionLocal
from ..core.ids import new_id
from ..core.security import hash_password, new_token
from ..models import Branch, Department, Membership, MembershipBranch, PrimaLink, User, Workspace
from ..services import audit
from . import client

log = logging.getLogger(__name__)

ACTOR = "system:prima-mirror"
STATE_KEY = "prima_mirror"  # workspace settings: the last run's summary and what is held
OFFICE_ACCOUNT_PREFIX = "u-off-"
# Prima roles with an office place (guards and site devices sign in on Prima's own phones).
MIRRORED_ROLES = frozenset(
    {"director", "pwvsb_officer", "company_manager", "admin_exec", "supervisor"}
)
# Office access levels the office keeps for itself (the owner gives them; Prima never changes them).
PINNED = frozenset({"owner", "admin", "it_support"})
PREVIEW_DOMAIN = "@role-preview.local"
# Higher first: a change down this list is held for the owner.
RANK = (
    "owner", "admin", "it_support", "management", "hr", "branch_manager", "group_hod", "hod",
    "supervisor", "staff", "operator", "approver", "viewer",
)  # fmt: skip
# Prima's central departments, named as Prima names them (core org-structure.ts UNIT_LABEL).
DEPARTMENT_LABEL = {
    "operations": "Operations",
    "hr": "Human Resources",
    "arms_control": "Arms Control",
    "chief_of_staff": "Chief of Staff office",
    "cms": "CMS command centre",
    "director_office": "Director Office",
    "fwm": "Foreign Worker Management",
    "pdpa": "PDPA",
    "transport": "Transport",
    "asset": "Asset Management",
    "finance": "Finance",
    "it": "IT",
    "legal": "Legal",
    "audit": "ACT (Audit, Compliance and Transformation)",
    "procurement": "Procurement and Inventory",
    "marketing": "Marketing",
}


def derive(r: client.StaffRecord, heads: list[str]) -> str:
    """The office access level for a Prima account (the owner's and admins' are kept: PINNED)."""
    if r.top in ("ceo", "coo") or r.role == "director":
        return "management"
    if r.leadership in ("chairman", "vice_chairman", "finance_director"):
        return "management"
    if r.leadership in ("cos", "deputy_cos"):
        return "hr"  # the HR Director (Chief of Staff or Deputy)
    if r.role in ("company_manager", "admin_exec"):
        return "branch_manager"
    if any(h.startswith("d_") for h in heads):
        return "hod"
    if r.role == "supervisor":
        return "supervisor"
    return "staff"


def rank(role: str) -> int:
    return RANK.index(role) if role in RANK else len(RANK)


@dataclass
class Report:
    companies_made: list[str] = field(default_factory=list)
    companies_renamed: list[str] = field(default_factory=list)
    added: list[str] = field(default_factory=list)
    linked: list[str] = field(default_factory=list)
    moved: list[str] = field(default_factory=list)
    raised: list[str] = field(default_factory=list)
    held: list[dict] = field(default_factory=list)  # {user_id, name, kind: down|close, from, to}
    no_email: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    # P134: office staff records HR added in Prima (People) without a sign-in account yet.
    added_from_records: list[str] = field(default_factory=list)

    def summary(self) -> dict:
        return {
            k: (len(v) if isinstance(v, list) else v)
            for k, v in self.__dict__.items()
            if k != "held"
        } | {"held": len(self.held)}


async def _chart_heads(top_id: str) -> dict[str, list[str]]:
    """Each Prima account's unit heads (d_hr, c_pwvsb...), from Prima's chart (read as the top)."""
    ans = await client._send("GET", "/api/org/chart", top_id, "person", b"", "")
    if ans.status != 200:
        return {}
    data = ans.json()
    out: dict[str, list[str]] = {}
    for p in data.get("people", []) if isinstance(data, dict) else []:
        if isinstance(p, dict) and p.get("id"):
            out[str(p["id"])] = [str(h) for h in (p.get("heads") or []) if isinstance(h, str)]
    return out


async def _department(
    db: AsyncSession, ws: str, branch_id: str, key: str | None, report: Report
) -> str | None:
    label = DEPARTMENT_LABEL.get(key or "")
    if not label:
        return None
    rows = (await db.scalars(select(Department).where(Department.branch_id == branch_id))).all()
    hit = next((d for d in rows if d.name.lower() == label.lower()), None)
    if hit:
        return hit.id
    slugs = {d.slug for d in rows}
    s = key.replace("_", "-") if key else "dept"
    while s in slugs:
        s += "-2"
    d = Department(
        id=new_id("dp"),
        workspace_id=ws,
        branch_id=branch_id,
        name=label,
        slug=s,
        position=max((x.position for x in rows), default=0) + 1,
    )
    db.add(d)
    await db.flush()
    return d.id


async def run(db: AsyncSession, ws_id: str, *, dry: bool = False, held_too: bool = False) -> Report:
    report = Report()
    w = await db.get(Workspace, ws_id)
    if w is None:
        return report
    settings = dict(w.settings or {})
    cmap: dict[str, str] = dict(settings.get("prima_companies") or {})

    # Companies.
    companies = await client.companies()
    branches = {
        b.id: b
        for b in (await db.scalars(select(Branch).where(Branch.workspace_id == ws_id))).all()
    }
    office_of: dict[str, list[str]] = {}
    for bid, pid in cmap.items():
        if bid in branches:
            office_of.setdefault(pid, []).append(bid)
    for c in companies:
        have = office_of.get(c.id, [])
        if not have:
            b = Branch(
                id=new_id("br"),
                workspace_id=ws_id,
                name=c.name[:120],
                slug=f"{c.id}"[:80],
                industry="security",
            )
            db.add(b)
            await db.flush()
            branches[b.id] = b
            cmap[b.id] = c.id
            office_of[c.id] = [b.id]
            report.companies_made.append(c.name)
        elif len(have) == 1 and branches[have[0]].name != c.name:
            report.companies_renamed.append(f"{branches[have[0]].name} -> {c.name}")
            branches[have[0]].name = c.name[:120]

    # People.
    staff = [r for r in await client.staff() if r.role in MIRRORED_ROLES]
    top = await client.top_record()
    heads = await _chart_heads(top.id) if top else {}
    links = {
        lk.prima_user_id: lk
        for lk in (await db.scalars(select(PrimaLink).where(PrimaLink.workspace_id == ws_id))).all()
    }
    members = {
        m.user_id: m
        for m in (
            await db.scalars(select(Membership).where(Membership.workspace_id == ws_id))
        ).all()
    }
    by_email = {m.user.email.lower(): m for m in members.values() if m.user and m.user.email}
    by_oid = {m.ms_oid.lower(): m for m in members.values() if m.ms_oid}
    held: list[dict] = []
    for r in staff:
        m: Membership | None = None
        lk = links.get(r.id)
        if lk is not None:
            m = members.get(lk.user_id)
        if m is None and r.id.startswith(OFFICE_ACCOUNT_PREFIX):
            m = members.get(r.id[len(OFFICE_ACCOUNT_PREFIX) :])
        if m is None and r.email:
            m = by_email.get(r.email)
        if m is None and r.entra_oid:
            m = by_oid.get(r.entra_oid)
        home = next((office_of[c][0] for c in r.company_ids if office_of.get(c)), None)
        want = derive(r, heads.get(r.id, []))
        if m is None:
            if r.closed or r.top:
                continue  # closed, or the top record (owners open Prima as it)
            if not r.email:
                report.no_email.append(r.name)
                continue
            if home is None:
                report.errors.append(f"{r.name}: no office company for {list(r.company_ids)}")
                continue
            user = await db.scalar(select(User).where(User.email == r.email))
            if user is None:
                # They sign in with a code sent to this email (services/signin_mail.py).
                user = User(
                    email=r.email, name=r.name[:120], password_hash=hash_password(new_token())
                )
                db.add(user)
                await db.flush()
            dept = await _department(db, ws_id, home, r.department, report)
            m = Membership(
                workspace_id=ws_id,
                user_id=user.id,
                role=want,
                branch_id=home,
                department_id=dept,
                job_title=(r.title or None) and r.title[:120],
                heads_department=want == "hod",
            )
            db.add(m)
            await db.flush()
            db.add(MembershipBranch(workspace_id=ws_id, user_id=user.id, branch_id=home))
            if r.id not in links:
                db.add(
                    PrimaLink(
                        workspace_id=ws_id,
                        user_id=user.id,
                        prima_user_id=r.id,
                        prima_name=r.name[:200],
                        how="owner",
                        linked_by=ACTOR,
                    )
                )
            members[user.id] = m
            report.added.append(f"{r.name} ({want})")
            await audit.record(
                db,
                ws_id,
                ACTOR,
                "member.added_from_prima",
                target=user.id,
                note=f"{r.id} as {want}",
            )
            continue

        email = (m.user.email or "").lower() if m.user else ""
        if email.endswith(PREVIEW_DOMAIN):
            continue
        # The owner and admins open Prima as its top record (client.opens_as_top): never linked.
        if (
            lk is None
            and r.id not in links
            and not r.id.startswith(OFFICE_ACCOUNT_PREFIX)
            and not client.opens_as_top(m)
        ):
            if not await db.scalar(
                select(PrimaLink).where(
                    PrimaLink.workspace_id == ws_id, PrimaLink.user_id == m.user_id
                )
            ):
                db.add(
                    PrimaLink(
                        workspace_id=ws_id,
                        user_id=m.user_id,
                        prima_user_id=r.id,
                        prima_name=r.name[:200],
                        how="owner",
                        linked_by=ACTOR,
                    )
                )
                report.linked.append(r.name)
        if r.closed:
            if m.user and m.user.is_active and m.role not in PINNED:
                held.append(
                    {
                        "user_id": m.user_id,
                        "name": r.name,
                        "kind": "close",
                        "from": m.role,
                        "to": None,
                    }
                )
            continue
        # P135: people the office manages (its own Members screens, shown inside Prima) keep the
        # role and place set there; only people who came from Prima (linked by this mirror) follow
        # Prima's role, company and department.
        if lk is None or lk.linked_by != ACTOR:
            continue
        # Place: Prima's company and central department. The owner, global admins and IT support
        # keep theirs (their place scopes nothing). Someone in several companies keeps them all:
        # only when none of their office companies is one of their Prima companies does their home
        # move, and the new home joins the companies they already had.
        prima_homes = {office_of[c][0] for c in r.company_ids if office_of.get(c)}
        mine = {m.branch_id, *m.branch_ids} - {None}
        if m.role in PINNED:
            pass
        elif home and not (mine & prima_homes):
            old = branches.get(m.branch_id or "")
            m.branch_id = home
            m.department_id = await _department(db, ws_id, home, r.department, report)
            if home not in mine:
                db.add(MembershipBranch(workspace_id=ws_id, user_id=m.user_id, branch_id=home))
            report.moved.append(f"{r.name}: {old.name if old else '-'} -> {branches[home].name}")
        elif home and r.department and m.branch_id in prima_homes:
            dept = await _department(db, ws_id, m.branch_id, r.department, report)
            if dept and m.department_id != dept:
                m.department_id = dept
                report.moved.append(f"{r.name}: department {DEPARTMENT_LABEL.get(r.department)}")
        # Access level.
        if m.role in PINNED or m.role == want:
            continue
        if rank(want) < rank(m.role):
            report.raised.append(f"{r.name}: {m.role} -> {want}")
            m.role = want
            m.heads_department = want == "hod" or m.heads_department
            await audit.record(
                db,
                ws_id,
                ACTOR,
                "member.role_from_prima",
                target=m.user_id,
                note=f"{r.id} -> {want}",
            )
        else:
            held.append(
                {"user_id": m.user_id, "name": r.name, "kind": "down", "from": m.role, "to": want}
            )

    # P134 (Fitri, 26 Nov 2026: "most do not receive the sign-in email": they were never added):
    # an office staff record HR keeps in Prima, with an email nobody here signs in with, becomes a
    # staff member of its company. They sign in with a code sent to that email; their own Prima
    # account is made the first time they open Prima (client.ensure links it to this record).
    # A record already behind an office member's Prima account is theirs, whatever email it shows
    # (a typo fixed in the office only, for example).
    taken = {
        r.person_id
        for r in staff
        if r.person_id and (r.id in links or r.id.startswith(OFFICE_ACCOUNT_PREFIX))
    }
    for rec in await client.people():
        if rec.id in taken or rec.email in by_email or rec.email.endswith(PREVIEW_DOMAIN):
            continue
        home = (office_of.get(rec.company_id) or [None])[0]
        if home is None:
            report.errors.append(f"{rec.name}: no office company for {rec.company_id}")
            continue
        user = await db.scalar(select(User).where(User.email == rec.email))
        if user is None:
            user = User(
                email=rec.email,
                name=rec.name or rec.email,
                password_hash=hash_password(new_token()),
            )
            db.add(user)
            await db.flush()
        elif await db.get(Membership, (ws_id, user.id)) is not None:
            continue
        m = Membership(
            workspace_id=ws_id,
            user_id=user.id,
            role="staff",
            branch_id=home,
            job_title=(rec.title or None) and rec.title[:120],
        )
        db.add(m)
        await db.flush()
        db.add(MembershipBranch(workspace_id=ws_id, user_id=user.id, branch_id=home))
        by_email[rec.email] = m
        report.added_from_records.append(rec.name or rec.email)
        await audit.record(
            db, ws_id, ACTOR, "member.added_from_prima_record", target=user.id, note=rec.id
        )

    if held_too:
        for h in held:
            m = members.get(h["user_id"])
            if m is None:
                continue
            if h["kind"] == "close" and m.user:
                m.user.is_active = False
            elif h["kind"] == "down":
                m.role = h["to"]
                m.heads_department = h["to"] == "hod"
            await audit.record(
                db,
                ws_id,
                ACTOR,
                f"member.{h['kind']}_from_prima",
                target=m.user_id,
                note=str(h["to"]),
            )
        held = []
    report.held = held
    settings["prima_companies"] = cmap
    state = dict(settings.get(STATE_KEY) or {})
    state.update(summary=report.summary(), held=held[:500], on=bool(state.get("on")) or not dry)
    settings[STATE_KEY] = state
    w.settings = settings
    if dry:
        await db.rollback()
    else:
        await db.commit()
    return report


def is_on(w: Workspace | None) -> bool:
    """Switched on by the first real run (`--apply`, after a dry run was checked)."""
    return bool(((w.settings or {}).get(STATE_KEY) or {}).get("on")) if w else False


async def tick_one(ws_id: str) -> None:
    """The scheduled run for one workspace (with the org sync), once switched on. Never raises."""
    try:
        async with SessionLocal() as db:
            if not is_on(await db.get(Workspace, ws_id)):
                return
            rep = await run(db, ws_id)
        log.info("prima mirror: %s", rep.summary())
    except Exception:
        log.exception("prima mirror: run failed (the next run tries again)")


async def _cli(apply_it: bool, held_too: bool) -> int:
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace.id).order_by(Workspace.created_at).limit(1))
        rep = await run(db, ws, dry=not apply_it, held_too=held_too)
    print(json.dumps(rep.__dict__, indent=1, ensure_ascii=False, default=str))
    print(("APPLIED " if apply_it else "DRY RUN (nothing changed) ") + json.dumps(rep.summary()))
    return 0


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="The office follows Prima's companies and people.")
    p.add_argument("--apply", action="store_true")
    p.add_argument("--held", action="store_true", help="also apply held downgrades and closures")
    a = p.parse_args()
    sys.exit(asyncio.run(_cli(a.apply, a.held)))


# P132: once the office follows Prima, companies, departments and people are changed in Prima.
CLOSED = (
    "Companies, departments and people are kept in Prima now. Change this in Prima: Accounts and "
    "access for people, Org chart for lines and heads, Companies for companies."
)


async def guard(db: AsyncSession, ws_id: str, *, allow: bool = False) -> None:
    """Refuse an office change to the organization or its people once the mirror is on (the
    office keeps only its own settings: access levels of owners, global admins and IT support,
    sign-in, Library, AI). `allow` lets a caller pass what stays the office's own."""

    # P135 (Fitri, 26 Nov 2026: "all functions ... must be the same, just managed on Prima"): the
    # office's own Organization and Members screens run again, shown inside Prima; nothing is
    # refused here any more. Kept as a hook (callers unchanged) should a lock come back.
    return
