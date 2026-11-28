"""Calls to Prima Secure, signed for one person (P66, P67).

The office is Prima's sign-in. Each person in the office is linked to one Prima staff record
(models.PrimaLink), automatically the first time they open Prima when the match is sure: the
record IT gave the Microsoft account they signed in with (Membership.ms_oid, verified by
Microsoft), else the only record with exactly their name. The owner sees and can change every
link on the Prima page (agentic/prima/people). Nobody runs a script or signs in twice.

The office holds no Prima password or token. Each call names the linked record and is signed
with settings.prima_secret, which Prima checks (apps/prima/apps/api/src/office.ts) before
applying its own sign-in rules, roles, record rules and row-level security to that record. The
signature covers the time, the method, the path with its query, the record, through what
(person, agent:<name>, or system for the staff list), and the exact body bytes.

P75: anyone else (no sure match, not the owner) gets their own Prima account the first time
they open Prima, made by Prima's accounts service (office-accounts.ts, settings.
prima_accounts_url) with access from their office role (prima_role) in the Prima company the
owner set for their branch (workspace settings "prima_companies"). Linked with how="auto".

P109 (Fitri, 17 Nov 2026): "whatever members are added in the Agentic Office, make them auto
linked". A signed-in office member is enough: no Microsoft step first (P70 is gone). They are
linked when added (prima/autolink.py, in the background) or on their first Prima open, and
everyone already in the office by `python -m agentic.prima.link_all`. "Staff: own records only":
the office decides each own account's Prima level (prima_role), and an account made at an
earlier level is brought to it on their next open (_account_due). Admins (high management) open
Prima as its top record like owners (opens_as_top).

Tests swap in a fake Prima: `client.transport = httpx.MockTransport(handler)`.
"""

import asyncio
import hashlib
import hmac
import json
import logging
import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import unquote

import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..i18n import Msg, current_lang
from ..i18n.labels import role_label
from ..models import Branch, Membership, PrimaLink, Workspace
from ..services import audit
from . import modules

log = logging.getLogger(__name__)

transport: httpx.AsyncBaseTransport | None = None
TIMEOUT = httpx.Timeout(30.0, connect=5.0)
# P123: one kept-alive client per event loop (and transport: tests swap it), as microsoft/http.py,
# instead of a new client and a new connection to Prima for every call.
LIMITS = httpx.Limits(max_connections=40, max_keepalive_connections=20, keepalive_expiry=60)
_shared: dict[tuple[int, int], httpx.AsyncClient] = {}

# Prima's own paths only, in a plain alphabet so the path Prima sees is the one signed.
_PATH = re.compile(r"^api/[A-Za-z0-9_\-./~]{0,300}$")
_QUERY = re.compile(r"^[A-Za-z0-9_\-.~%=&+:,]{0,1000}$")
# Never through the office: the signed system feeds (their own keys), development sign-in,
# and the office's own staff list (a system call, staff() below).
_CLOSED = ("api/integrations/", "api/auth/dev-login", "api/auth/users", "api/office/")
# The AI's Prima tools (agents/prima_tools.py): offered only when enabled() for the workspace.
TOOL_NAMES = frozenset({"prima_find", "prima_read", "prima_record"})
PROMPT_NOTE = (
    "Prima Secure (the group's operations app: attendance, leave, claims, staff pay, rosters, "
    "cases, assets, purchasing, tenders...) runs in this office. You can work in it for the "
    "person who asked you, as them, with their access only: prima_find gives the action for a "
    "job, prima_read reads, prima_record records (they approve each one first). Follow the "
    "matching Prima procedure from the library. If Prima refuses, say why; never try another "
    "way round its rules. Prepare and record what the person asks; decisions on pay, "
    "deductions, discipline and contracts stay with the people Prima names."
)
MAX_BODY = 3 * 1024 * 1024  # Prima's own JSON limit (photos and proofs as data URLs)
# P75: office accounts (office-accounts.ts) are always "u-off-<office user id>".
OFFICE_ACCOUNT_PREFIX = "u-off-"
# Workspace settings key: {office branch id: Prima company id}, set by the owner.
COMPANIES_KEY = "prima_companies"
# The Prima role of an office role (least privilege, Prima's packages/core/src/access.ts): a
# branch manager gets the company's manager view without its decisions (admin_exec: the company
# overview, not commercial approval, arms, discipline or staff numbers); everyone else, admins
# included, is central staff (pwvsb_officer) with no grant or department: their own record,
# clock, leave and claims, and no HR or pay wall. The owner opens Prima as its top record.
PRIMA_ROLES = {"branch_manager": "admin_exec"}
# P109: the office roles that open Prima as its top record (the CEO, else the COO), with no link
# of their own: owners (the developer is one) and admins (high management, Fitri 17 Nov 2026).
TOP_ROLES = frozenset({"owner", "admin"})
# P109: linked_by of an own account, with the Prima role it was last given ("auto:account:<role>"),
# so an account given an earlier level (P75/P81) is brought to the office's level once.
ACCOUNT_LINK = "auto:account"
# P106: the Prima departments an office account may be in (Prima's office-accounts.ts
# OFFICE_DEPARTMENTS), set per member in Members > Access. "hr" opens Prima's HR and pay walls
# (staff personal data and payroll) and is for central staff (pwvsb_officer) only.
PRIMA_DEPARTMENTS = (
    "transport",
    "procurement",
    "hr",
    "finance",
    "chief_of_staff",
    "it",
    "legal",
    "audit",
    "operations",
    "asset",
    "pdpa",
    "fwm",
    "cms",
)
# P125: the departments that open staff personal data, payroll or money: central staff only (Prima
# refuses them on any other role, CENTRAL_ONLY_DEPARTMENTS in its office-accounts.ts).
CENTRAL_ONLY_DEPARTMENTS = ("hr", "finance", "chief_of_staff", "audit", "legal")
# P106: how the developer opens Prima: as its top record (the default, as every owner) or as
# their own Prima account (central staff), so they can prepare loads someone else OKs.
OPENS_AS = ("top", "own")


class PrimaError(Exception):
    """A refusal before Prima was asked (not linked, not running, a path it never serves)."""

    def __init__(self, status: int, message: Msg, code: str = "") -> None:
        super().__init__(str(message))
        self.status = status
        self.message = message
        # "company_needed": their branch has no Prima company; "account_refused": Prima's
        # accounts service refused their account; "module_not_chosen", "own_work" (P99, P106).
        self.code = code


@dataclass(frozen=True)
class Answer:
    status: int
    content_type: str
    body: bytes
    disposition: str = ""
    # P148d: Prima's own Server-Timing (its work, its database time); the round trip to it, in ms.
    timing: str = ""
    upstream_ms: float = 0.0

    def json(self) -> object:
        import json

        return json.loads(self.body or b"null")


def enabled(workspace_id: str | None = None) -> bool:
    if not (settings.prima_url and len(settings.prima_secret) >= 32):
        return False
    return not (
        settings.prima_workspace and workspace_id and workspace_id != settings.prima_workspace
    )


def clean_path(path: str, query: str = "") -> str:
    """The path Prima is asked for ("/api/...?..."), or PrimaError."""
    p = path.lstrip("/")
    if not _PATH.match(p) or ".." in p.split("/") or "//" in p:
        raise PrimaError(400, Msg("That is not a Prima address."))
    if any(p == c.rstrip("/") or p.startswith(c) for c in _CLOSED):
        raise PrimaError(403, Msg("That part of Prima is not opened through the office."))
    if not _QUERY.match(query):
        raise PrimaError(400, Msg("That is not a Prima address."))
    return f"/{p}" + (f"?{query}" if query else "")


@dataclass(frozen=True)
class StaffRecord:
    id: str
    name: str
    title: str
    role: str
    entra_oid: str | None
    can_sign_in: bool
    # P74: "ceo" / "coo" for Prima's top leadership records (the office's owner opens Prima
    # as one of them), else None.
    top: str | None = None
    # P112: the Prima person (staff record) this account belongs to, when Prima says (an
    # older Prima sends none): which office member is a Prima person (prima/person_member).
    person_id: str | None = None
    # P132: what the office mirrors (prima/mirror.py), from a newer Prima; empty from an older one.
    email: str | None = None
    company_ids: tuple[str, ...] = ()
    department: str | None = None
    leadership: str | None = None
    ops_tier: str | None = None
    closed: bool = False


@dataclass(frozen=True)
class Company:
    id: str
    name: str
    # P81: the other names Prima knows the company by ("UNIT HR", "OPERASI JOHOR"), for the
    # branch-to-company suggestion only; never shown or saved.
    aliases: tuple[str, ...] = ()


def prima_role(office_role: str) -> str:
    return PRIMA_ROLES.get(office_role, "pwvsb_officer")


def account_link(role: str) -> str:
    """linked_by of an own account given this Prima role (P109)."""
    return f"{ACCOUNT_LINK}:{role}"


def own_account_id(user_id: str) -> str:
    """The Prima id of an office person's own account (office-accounts.ts officeAccountId)."""
    return f"{OFFICE_ACCOUNT_PREFIX}{user_id}"


def account_department(m: Membership, role: str) -> str | None:
    """The Prima department to give this person's own account: theirs, and never hr on a role
    other than central staff (Prima refuses it; a branch manager keeps their account)."""
    dept = m.prima_department if m.prima_department in PRIMA_DEPARTMENTS else None
    return None if dept in CENTRAL_ONLY_DEPARTMENTS and role != "pwvsb_officer" else dept


def matchable(records: list[StaffRecord]) -> list[StaffRecord]:
    """Records the office may match people to by account or name: never an office account
    (P75), which belongs to the one office person it was made for."""
    return [r for r in records if not r.id.startswith(OFFICE_ACCOUNT_PREFIX)]


def company_map(ws: Workspace | None) -> dict[str, str]:
    raw = ((ws.settings if ws else None) or {}).get(COMPANIES_KEY) or {}
    return {str(k): str(v) for k, v in raw.items() if v} if isinstance(raw, dict) else {}


def _not_linked() -> PrimaError:
    return PrimaError(
        403,
        Msg(
            "You are not linked to your Prima staff record yet. The office owner links people "
            "on the Prima page."
        ),
    )


async def staff() -> list[StaffRecord]:
    """Prima's staff records, for linking (the office's own signed call, no person)."""
    ans = await _send("GET", "/api/office/staff", "", "system", b"", "")
    if ans.status != 200:
        raise PrimaError(503, Msg("Prima is not answering right now. Try again in a minute."))
    rows = ans.json()
    return [
        StaffRecord(
            id=str(r["id"]),
            name=str(r.get("name") or ""),
            title=str(r.get("title") or ""),
            role=str(r.get("role") or ""),
            entra_oid=(str(r["entraOid"]).lower() if r.get("entraOid") else None),
            can_sign_in=bool(r.get("canSignIn")),
            top=(str(r["top"]) if r.get("top") in ("ceo", "coo") else None),
            person_id=(str(r["personId"])[:120] if r.get("personId") else None),
            email=(str(r["email"]).strip().lower()[:254] if r.get("email") else None),
            company_ids=tuple(str(c)[:80] for c in (r.get("companyIds") or [])[:20] if c),
            department=(str(r["department"])[:40] if r.get("department") else None),
            leadership=(str(r["leadership"])[:40] if r.get("leadership") else None),
            ops_tier=(str(r["opsTier"])[:40] if r.get("opsTier") else None),
            closed=bool(r.get("closed")),
        )
        for r in (rows if isinstance(rows, list) else [])
        if isinstance(r, dict) and r.get("id")
    ]


@dataclass(frozen=True)
class StaffPerson:
    """P134: an office staff record HR keeps in Prima (People), with the email they sign in with."""

    id: str
    company_id: str
    name: str
    email: str
    title: str | None = None


async def people() -> list[StaffPerson]:
    """HR's office staff records with an email (the office's own signed call). An older Prima
    without the feed gives none."""
    ans = await _send("GET", "/api/office/people", "", "system", b"", "")
    if ans.status == 404:
        return []
    if ans.status != 200:
        raise PrimaError(503, Msg("Prima is not answering right now. Try again in a minute."))
    rows = ans.json()
    return [
        StaffPerson(
            id=str(r["id"])[:120],
            company_id=str(r.get("companyId") or "")[:80],
            name=" ".join(str(r.get("name") or "").split())[:120],
            email=str(r["email"]).strip().lower()[:254],
            title=(str(r["title"])[:120] if r.get("title") else None),
        )
        for r in (rows if isinstance(rows, list) else [])
        if isinstance(r, dict) and r.get("id") and r.get("email")
    ]


async def companies() -> list[Company]:
    """Prima's companies, id and name only (the office's own signed call), for the owner to say
    which Prima company each office branch is."""
    ans = await _send("GET", "/api/office/companies", "", "system", b"", "")
    if ans.status != 200:
        raise PrimaError(503, Msg("Prima is not answering right now. Try again in a minute."))
    rows = ans.json()
    return [
        Company(
            id=str(r["id"]),
            name=str(r.get("name") or r["id"]),
            aliases=tuple(
                str(a)[:200] for a in (r.get("aliases") or [])[:20] if isinstance(a, str) and a
            ),
        )
        for r in (rows if isinstance(rows, list) else [])
        if isinstance(r, dict) and r.get("id")
    ]


async def create_account(
    *,
    office_user_id: str,
    name: str,
    title: str,
    role: str,
    company_ids: list[str],
    email: str = "",
    relink: bool = False,
    department: str | None = None,
) -> str:
    """Make (or bring up to date) this person's own Prima account; its Prima id. A system call
    to Prima's accounts service, signed like every other ("/accounts"). P81: with their sign-in
    email, Prima links the account to their own staff record (the real staff list), so My
    details, the staff clock and payroll are theirs. P106: with their Prima department (none
    leaves the account in no department)."""
    payload: dict[str, object] = {
        "officeUserId": office_user_id,
        "name": name[:120],
        "title": title[:120],
        "role": role,
        "companyIds": company_ids,
    }
    if department:
        payload["department"] = department
    if email and "@" in email and len(email) <= 254:
        payload["email"] = email.strip().lower()
    if relink:  # P92: find their staff record again from the corrected details
        payload["relink"] = True
    body = json.dumps(payload, separators=(",", ":")).encode()
    ans = await _send("POST", "/accounts", "", "system", body, "", base=settings.prima_accounts_url)
    data = ans.json() if ans.status in (200, 400) else None
    rid = str(data.get("id") or "") if isinstance(data, dict) else ""
    if ans.status == 200 and rid.startswith(OFFICE_ACCOUNT_PREFIX):
        return rid
    if ans.status == 400:
        raise PrimaError(
            403,
            Msg("Prima could not make your account. Ask the office owner to check it."),
            code="account_refused",
        )
    raise PrimaError(503, Msg("Prima is not answering right now. Try again in a minute."))


async def _create_in_department(
    department: str | None, **account: object
) -> tuple[str, str | None]:
    """create_account in this department: (the account's Prima id, the department Prima refused
    or None). P128: Prima refuses a central-only department (HR, Finance...) to someone whose
    own staff record makes them a licensed company's office staff. Before, that refusal closed
    Prima to them on every call; now their account is kept with no department and the refusal
    is remembered (prima_links.department_refused) and shown on Members > Access."""
    try:
        return await create_account(department=department, **account), None  # type: ignore[arg-type]
    except PrimaError as e:
        if e.code != "account_refused" or not department:
            raise
    rid = await create_account(department=None, **account)  # type: ignore[arg-type]
    log.warning("Prima refused a department on an office account; kept with none")
    return rid, department


async def _own_account(db: AsyncSession, m: Membership, name: str, email: str = "") -> PrimaLink:
    """P75: the person's own Prima account, in the Prima company of their branch."""
    company = await _account_company(db, m)
    role = prima_role(m.role)
    department = account_department(m, role)
    rid, refused = await _create_in_department(
        department,
        office_user_id=m.user_id,
        name=name,
        title=str(role_label(m.role)),
        role=role,
        company_ids=[company],
        email=email,
    )
    link = PrimaLink(
        workspace_id=m.workspace_id,
        user_id=m.user_id,
        prima_user_id=rid,
        prima_name=name[:200],
        how="auto",
        linked_by=account_link(role),
        department=None if refused else department,
        department_refused=refused,
    )
    db.add(link)
    try:
        await db.commit()
    except IntegrityError:  # opened twice at once: the other request linked it
        await db.rollback()
        got = await db.get(PrimaLink, (m.workspace_id, m.user_id))
        if got is None:
            raise _not_linked() from None
        return got
    await audit.record(
        db,
        m.workspace_id,
        "system:prima",
        "prima.account",
        target=m.user_id,
        after={"prima_user_id": rid, "role": role, "company": company}
        | ({"department": department} if department and not refused else {})
        | ({"department_refused": refused} if refused else {}),
        note=f"Own Prima account {rid} made for them ({role} in {company})"
        + (f"; Prima refused department {refused}, so they have none" if refused else ""),
    )
    await db.commit()
    return link


async def _relink(db: AsyncSession, m: Membership, link: PrimaLink) -> PrimaLink:
    """P92: their email or Microsoft link was corrected (services/identity). Their own Prima
    account keeps its id (and so their Prima history) and is relinked: Prima lets go of the
    staff record the old details found and of any Microsoft account on it, and finds their
    record again from the new email and name (office-accounts.ts, relink)."""
    return await _refresh(db, m, link, relink=True)


async def _refresh(db: AsyncSession, m: Membership, link: PrimaLink, *, relink: bool) -> PrimaLink:
    """Bring their own Prima account up to date: P92 relink (see _relink), or P106 their Prima
    department changed in Members > Access (the account keeps its id and its staff record)."""
    from . import people  # late: people builds on this module

    me = next((p for p in await people.people(db, m.workspace_id) if p.user_id == m.user_id), None)
    if me is None:
        raise _not_linked()
    if not link.prima_user_id.startswith(OFFICE_ACCOUNT_PREFIX):
        # Not theirs to remake: a staff record is kept as the owner set it (its department is
        # set in Prima, on that record).
        link.relink_needed = False
        await db.commit()
        return link
    company = await _account_company(db, m)
    role = prima_role(m.role)
    department = account_department(m, role)
    rid, refused = await _create_in_department(
        department,
        office_user_id=m.user_id,
        name=me.name,
        title=str(role_label(m.role)),
        role=role,
        company_ids=[company],
        email=me.email,
        relink=relink,
    )
    before = {"prima_user_id": link.prima_user_id, "department": link.department}
    level_before = link.linked_by
    link.prima_user_id = rid
    link.prima_name = me.name[:200]
    if relink:
        link.relink_needed = False
    link.department = None if refused else department
    link.department_refused = refused
    link.linked_by = account_link(role)
    after = {
        "prima_user_id": rid,
        "role": role,
        "company": company,
        "department": link.department,
    } | ({"department_refused": refused} if refused else {})
    if relink:
        await audit.record(
            db,
            m.workspace_id,
            "system:prima",
            "prima.relink",
            target=m.user_id,
            before={"prima_user_id": before["prima_user_id"]},
            after={k: v for k, v in after.items() if k != "department" or v},
            note=f"Own Prima account {rid} relinked from their corrected details",
        )
    elif level_before != link.linked_by:
        await audit.record(
            db,
            m.workspace_id,
            "system:prima",
            "prima.level",
            target=m.user_id,
            before={"linked_by": level_before},
            after=after,
            note=f"Own Prima account {rid} brought to {role} (the office's level for their role)",
        )
    else:
        await audit.record(
            db,
            m.workspace_id,
            "system:prima",
            "prima.department",
            target=m.user_id,
            before=before,
            after=after,
            note=(
                f"Prima refused department {refused} on own Prima account {rid}: kept with none"
                if refused
                else f"Own Prima account {rid} now in department {department or 'none'}"
            ),
        )
    await db.commit()
    return link


def _account_due(m: Membership, link: PrimaLink) -> bool:
    """Their own Prima account is not as the office sets it now: P106 its department, or P109
    its level (made before P109, or their office role changed since)."""
    if not link.prima_user_id.startswith(OFFICE_ACCOUNT_PREFIX):
        return False
    role = prima_role(m.role)
    # P128: a department Prima refused counts as given (it is not asked again on every call)
    # until the office's choice changes.
    given = link.department or link.department_refused or None
    return given != account_department(m, role) or link.linked_by != account_link(role)


async def _account_company(db: AsyncSession, m: Membership) -> str:
    """The Prima company of a person's branch, or PrimaError (code "company_needed"). Someone
    with no branch in an office of one branch works in that branch."""
    branch_id = m.branch_id
    if branch_id is None:
        only = (
            await db.scalars(
                select(Branch.id).where(Branch.workspace_id == m.workspace_id).limit(2)
            )
        ).all()
        branch_id = only[0] if len(only) == 1 else None
    if branch_id is None:
        raise PrimaError(
            403,
            Msg(
                "Prima does not know which company you work in yet. Ask the office owner to give "
                "you a branch."
            ),
            code="company_needed",
        )
    company = company_map(await db.get(Workspace, m.workspace_id)).get(branch_id)
    if not company:
        branch = await db.get(Branch, branch_id)
        raise PrimaError(
            403,
            Msg(
                "Prima does not know which company {branch} is yet. The office owner sets "
                '"which Prima company {branch} is" on the Prima page.',
                branch=branch.name if branch else "",
            ),
            code="company_needed",
        )
    return company


async def link_for(db: AsyncSession, workspace_id: str, user_id: str) -> PrimaLink:
    """This person's Prima record. Made here, the first time they open Prima (or when they are
    added, P109 autolink), when the match is sure (people.suggestions): the record IT gave their
    verified Microsoft account, else the only record with exactly their name while nobody else
    in the office has it; else their own Prima account (P75). The owner sees and can change
    every link on the Prima page. P82: every owner, the developer and (P109) every admin opens
    Prima as its top record with no link (opens_as_top)."""
    link, _ = await ensure(db, workspace_id, user_id)
    assert link is not None
    return link


# What ensure() did (or, dry, would do), for link_all's counts.
OUTCOMES = ("top", "already", "refreshed", "microsoft", "name", "account")


async def ensure(
    db: AsyncSession,
    workspace_id: str,
    user_id: str,
    *,
    records: list[StaffRecord] | None = None,
    dry: bool = False,
) -> tuple[PrimaLink | None, str]:
    """link_for, saying what it did (OUTCOMES), for link_all: `records` is Prima's matchable
    staff list asked once for everyone; `dry` changes nothing (no link, no Prima account, no
    audit) and hands back no link, only what would happen; a refusal is the same PrimaError
    either way. P109: a signed-in office member is enough, with no Microsoft step (P70)."""
    from . import people  # late: people builds on this module

    m = await db.get(Membership, (workspace_id, user_id))
    if m is None:
        raise _not_linked()
    if opens_own(m):
        # P106: the developer chose to open Prima as their own account (set_opens_as).
        if dry:
            return None, "top"
        return await _own_link(db, m), "top"
    if opens_as_top(m):
        top = await top_record()
        if top is not None:
            if not dry:
                await _let_go(db, workspace_id, user_id)
            return PrimaLink(
                workspace_id=workspace_id,
                user_id=user_id,
                prima_user_id=top.id,
                prima_name=top.name[:200],
                how="owner",
                linked_by=TOP_LINK,
            ), "top"
        # Prima has no top record: they open it by their own link, as anyone else.
    link = await db.get(PrimaLink, (workspace_id, user_id))
    if link is not None and (link.relink_needed or _account_due(m, link)):
        if dry:
            if link.prima_user_id.startswith(OFFICE_ACCOUNT_PREFIX):
                await _account_company(db, m)  # the refusal a real run would meet
            return None, "refreshed"
        # P92 their details were corrected; P106 their department or P109 their level changed.
        return await _refresh(db, m, link, relink=link.relink_needed), "refreshed"
    if link is not None:
        return link, "already"
    if records is None:
        records = matchable(await staff())
    persons = await people.people(db, workspace_id)
    rid = people.suggestions(persons, records).get(user_id)
    record = next((r for r in records if r.id == rid), None)
    me = next((p for p in persons if p.user_id == user_id), None)
    if me is None:
        raise _not_linked()  # their account is switched off: they cannot sign in either
    if record is None:
        # P75: no record of their own in Prima: they get one, from their office role. An
        # owner or admin opens Prima as its top record (P74), never as a made account.
        if me.role in TOP_ROLES:
            raise _not_linked()
        if dry:
            await _account_company(db, m)
            return None, "account"
        return await _own_account(db, m, me.name, me.email), "account"
    how = "microsoft" if me.ms_oid and record.entra_oid == me.ms_oid else "name"
    if dry:
        return None, how
    link = PrimaLink(
        workspace_id=workspace_id,
        user_id=user_id,
        prima_user_id=record.id,
        prima_name=record.name[:200],
        how=how,
        linked_by=f"auto:{how}",
    )
    db.add(link)
    try:
        await db.commit()
    except IntegrityError:  # opened twice at once: the other request linked it
        await db.rollback()
        link = await db.get(PrimaLink, (workspace_id, user_id))
        if link is None:
            raise _not_linked() from None
        return link, "already"
    await audit.record(
        db,
        workspace_id,
        "system:prima",
        "prima.link",
        target=user_id,
        note=f"Linked to Prima record {record.id} by their "
        + ("Microsoft account" if how == "microsoft" else "name"),
    )
    await db.commit()
    return link, how


# P82: every office owner, and the system's developer, opens Prima as its top record (the CEO,
# else the COO): they run the company. No link, no Microsoft step, and several people may share
# that record; the office's audit log says which of them recorded what (call). The top record
# is asked of Prima at most every TOP_TTL seconds, not on every call.
TOP_LINK = "auto:top"  # linked_by of the link link_for hands back for them (never saved)
TOP_TTL = 300.0
_TOP: dict[str, tuple[float, StaffRecord | None]] = {}


def opens_as_top(m: Membership) -> bool:
    """An owner, the developer (deps.is_developer: an owner the operator marked) or, P109, an
    admin (high management; Fitri, 17 Nov 2026). Admins are not developers: the own-account
    switch (opens_own) stays the developer's."""
    from ..api.deps import is_developer  # late: the api builds on this module

    return m.role in TOP_ROLES or is_developer(m.user, m.role)


def all_of_prima(m: Membership) -> bool:
    """Every Prima screen whatever was chosen (P99): owners and the developer. An admin opens
    Prima as its top record too, but keeps the screens the owner chose for them, if any."""
    from ..api.deps import is_developer  # late: the api builds on this module

    return m.role == "owner" or is_developer(m.user, m.role)


# ---------------------------------------------------------------- P106 the developer's own account
#
# Fitri (owner and developer, 16 Nov 2026) loads company data into Prima herself: Goodwill items
# (an account in procurement) and the staff directory (an account in hr). Prima's two-person
# rules mean nobody OKs their own load and the preparer never approves their own batch; while
# she opens Prima as the shared CEO record she can prepare nothing. So the developer may choose
# to open Prima as their own account (central staff, in a department they pick), and switch
# back to the CEO record; Fauzan OKs as the CEO record after reviewing. The office refuses an OK
# given through the shared record on work that same person made with their own account
# (_check_not_own_work), so the switch is never a way round the rule.


def opens_own(m: Membership) -> bool:
    """The developer chose to open Prima as their own account (set_opens_as)."""
    from ..api.deps import is_developer  # late: the api builds on this module

    return m.prima_opens_as == "own" and is_developer(m.user, m.role)


async def _own_link(db: AsyncSession, m: Membership) -> PrimaLink:
    """The developer's own Prima account (made the first time, brought up to date when their
    department changed). A link they had to anything else is let go first."""
    from . import people  # late: people builds on this module

    link = await db.get(PrimaLink, (m.workspace_id, m.user_id))
    if link is not None and link.prima_user_id != own_account_id(m.user_id):
        await db.delete(link)
        await audit.record(
            db,
            m.workspace_id,
            "system:prima",
            "prima.unlink",
            target=m.user_id,
            before={"prima_user_id": link.prima_user_id},
            note="The developer opens Prima as their own account",
        )
        await db.commit()
        link = None
    if link is None:
        me = next(
            (p for p in await people.people(db, m.workspace_id) if p.user_id == m.user_id), None
        )
        if me is None:
            raise _not_linked()
        return await _own_account(db, m, me.name, me.email)
    if link.relink_needed or _account_due(m, link):
        return await _refresh(db, m, link, relink=link.relink_needed)
    return link


async def set_opens_as(
    db: AsyncSession, m: Membership, opens_as: str, department: str | None, actor: str
) -> PrimaLink | None:
    """The developer's choice: Prima's top record ("top", the default) or their own account
    ("own", made or brought up to date now, so a problem shows at once). Saying the same again
    changes nothing; each change is audited (who, from, to). Their own account (if made) is
    kept while they open the top record. The caller checks the developer; this checks again."""
    if not opens_own_allowed(m):
        raise PrimaError(403, Msg("Only the system's developer chooses how they open Prima."))
    if opens_as not in OPENS_AS:
        raise PrimaError(400, Msg("Pick how to open Prima."))
    if department is not None and department not in PRIMA_DEPARTMENTS:
        raise PrimaError(400, Msg("Pick a Prima department from the list."))
    before = {"opens_as": m.prima_opens_as, "department": m.prima_department}
    after = {"opens_as": opens_as, "department": department}
    m.prima_opens_as, m.prima_department = opens_as, department
    link: PrimaLink | None = None
    try:
        if opens_as == "own":
            link = await _own_link(db, m)  # commits the choice with the account
    except Exception:
        await db.rollback()
        raise
    if before != after:
        await audit.record(
            db,
            m.workspace_id,
            actor,
            "prima.opens_as",
            target=m.user_id,
            before=before,
            after=after,
            note="Opens Prima as their own account"
            if opens_as == "own"
            else "Opens Prima as its top record",
        )
    await db.commit()
    return link


def opens_own_allowed(m: Membership) -> bool:
    from ..api.deps import is_developer  # late: the api builds on this module

    return is_developer(m.user, m.role)


_OK_LOAD = re.compile(r"^/api/org/import-loads/([A-Za-z0-9_\-.~%]{1,200})/ok$")
_DECIDE = "/api/staff-directory/decide"


async def _check_not_own_work(
    db: AsyncSession, workspace_id: str, user_id: str, url: str, body: bytes, top_id: str,
    client_ip: str,
) -> None:  # fmt: skip
    """P106: Prima's two-person rules, kept across the switch. Through the shared top record,
    nobody OKs a bulk load (org-import okLoad) or decides a staff directory batch that they made
    with their own Prima account. Prima itself sees only the CEO record OK a load someone else
    made, so the office, which knows who is behind the shared record, refuses."""
    path = url.split("?", 1)[0]
    hit = _OK_LOAD.match(path)
    if hit:
        kind, item = "load", unquote(hit.group(1))
    elif path == _DECIDE:
        kind = "batch"
        try:
            data = json.loads(body or b"null")
        except ValueError:
            return  # Prima refuses it itself
        item = str(data.get("batchId") or "") if isinstance(data, dict) else ""
    else:
        return
    own = await db.get(PrimaLink, (workspace_id, user_id))
    if not item or own is None or own.prima_user_id != own_account_id(user_id):
        return  # they never had an own account: nothing of theirs to OK
    if await _made_by_own(kind, item, own, top_id, client_ip):
        raise PrimaError(
            403,
            Msg(
                "Someone else must OK what you loaded. You made this with your own Prima "
                "account, so another person (the CEO) gives the OK."
            ),
            code="own_work",
        )


def _items(data: object, kind: str) -> list[dict]:
    key = "loads" if kind == "load" else "batches"
    rows = data.get(key) if isinstance(data, dict) else None
    return [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []


async def _made_by_own(kind: str, item: str, own: PrimaLink, top_id: str, client_ip: str) -> bool:
    """Whether this load or batch was made by the person's own account: Prima's own list for
    that account first (a person's loads; their batches marked ownBatch), else the name of who
    made it on the shared record's list. Prima not answering is a refusal, never a yes."""
    from .people import name_key  # late: people builds on this module

    path = "/api/org/import-loads" if kind == "load" else "/api/staff-directory"
    mine = await _send("GET", path, own.prima_user_id, "person", b"", client_ip)
    if mine.status == 200:
        row = next((r for r in _items(mine.json(), kind) if r.get("id") == item), None)
        if row is not None:
            return kind == "load" or bool(row.get("ownBatch"))
    seen = await _send("GET", path, top_id, "person", b"", client_ip)
    if seen.status != 200:
        raise PrimaError(503, Msg("Prima could not check who made this. Try again in a minute."))
    row = next((r for r in _items(seen.json(), kind) if r.get("id") == item), None)
    if row is None:
        return False  # Prima answers "not found" itself
    who = str(row.get("by" if kind == "load" else "preparedBy") or "")
    return bool(who) and name_key(who) == name_key(own.prima_name)


def top_of(records: list[StaffRecord]) -> StaffRecord | None:
    """Prima's top record: its CEO, else its COO, else none."""
    tops = sorted((r for r in records if r.top), key=lambda r: 0 if r.top == "ceo" else 1)
    return tops[0] if tops else None


_TOP_RENEWING: set[asyncio.Task[None]] = set()


async def _renew_top(url: str) -> None:
    try:
        _TOP[url] = (time.monotonic(), top_of(await staff()))
    except Exception:  # noqa: BLE001 - kept as it was; asked again on the next call
        log.warning("could not renew Prima's top record")


async def top_record() -> StaffRecord | None:
    now = time.monotonic()
    url = settings.prima_url
    hit = _TOP.get(url)
    if hit is not None and now - hit[0] < TOP_TTL:
        return hit[1]
    if hit is not None and hit[1] is not None:
        # P148d: the top record (the CEO) all but never changes. Renewed in the background, so the
        # call after every five minutes no longer waits for Prima's whole staff list (~0.5 s).
        _TOP[url] = (now, hit[1])  # one renewal at a time
        task = asyncio.get_running_loop().create_task(_renew_top(url))
        _TOP_RENEWING.add(task)
        task.add_done_callback(_TOP_RENEWING.discard)
        return hit[1]
    top = top_of(await staff())
    _TOP[url] = (now, top)
    return top


async def _let_go(db: AsyncSession, workspace_id: str, user_id: str) -> None:
    """An owner's own link from before P82 (a staff record by name, or the top record itself)
    is let go once, so that record is free for its own person."""
    old = await db.get(PrimaLink, (workspace_id, user_id))
    if old is None or old.prima_user_id == own_account_id(user_id):
        # P106: the developer's own account is theirs alone (no staff record to free): kept for
        # when they open Prima as it again, and for the two-person check (_check_not_own_work).
        return
    await db.delete(old)
    await audit.record(
        db,
        workspace_id,
        "system:prima",
        "prima.unlink",
        target=user_id,
        before={"prima_user_id": old.prima_user_id},
        note="Owners open Prima as its top record, with no link of their own",
    )
    await db.commit()


async def check_chosen(
    db: AsyncSession, workspace_id: str, user_id: str, method: str, url: str
) -> None:
    """P99: refuse a call outside the Prima screens chosen for this person (modules.py), for
    their screens and their AI alike. Nothing chosen (None) is all their Prima role allows;
    owners always have all of Prima. Prima's own role checks come after, either way."""
    m = await db.get(Membership, (workspace_id, user_id))
    if m is None or m.prima_modules is None or all_of_prima(m):
        return
    path = url.split("?", 1)[0]
    if modules.allows(method, path, m.prima_modules):
        return
    lang = current_lang()
    names = modules.titles()
    shown = [
        names[v].get(lang) or names[v]["en"]
        for v in modules.ids()
        if v in modules.screens_for(method, path)
    ]
    if shown:
        raise PrimaError(
            403,
            Msg(
                "{screens} is not in your Prima access. Ask the person who manages members in "
                "the office to add it.",
                screens=", ".join(shown[:3]),
            ),
            code="module_not_chosen",
        )
    raise PrimaError(
        403,
        Msg(
            "This part of Prima is not in your Prima access. Ask the person who manages members "
            "in the office to add it."
        ),
        code="module_not_chosen",
    )


TOP_ASKER_TTL = 180  # seconds: an Arisha question and its model turns


def _top_asker_key(prima_user: str) -> str:
    return f"prima:top-asker:{prima_user}"


async def note_top_asker(prima_user: str, workspace_id: str, user_id: str) -> None:
    """P123: who is asking Arisha through the shared top record right now."""
    from ..core.valkey import valkey

    try:
        await valkey().set(
            _top_asker_key(prima_user), f"{workspace_id} {user_id}", ex=TOP_ASKER_TTL
        )
    except Exception:  # noqa: BLE001 - no note: the record's own link pays, as before
        log.warning("could not note who asks Arisha through the top record")


async def top_asker(prima_user: str) -> tuple[str, str] | None:
    """(workspace_id, user_id) of the person who last asked through this top record, if recent."""
    from ..core.valkey import valkey

    try:
        raw = await valkey().get(_top_asker_key(prima_user))
    except Exception:  # noqa: BLE001
        return None
    if not raw:
        return None
    text = raw.decode() if isinstance(raw, bytes) else str(raw)
    ws_id, _, uid = text.partition(" ")
    return (ws_id, uid) if ws_id and uid else None


def via_agent(name: str) -> str:
    """'agent:<name>' in plain ASCII (a header), at most 80 characters of name."""
    plain = re.sub(r"[^A-Za-z0-9 _.\-]", "", name).strip() or "AI"
    return f"agent:{plain[:80]}"


def _client() -> httpx.AsyncClient:
    """The shared client for this loop and transport. Never closed here: the next call reuses
    its connections."""
    key = (id(asyncio.get_running_loop()), id(transport))
    c = _shared.get(key)
    if c is None or c.is_closed:
        if len(_shared) >= 8:  # loops that ended (tests): forget them, they cannot be closed here
            _shared.clear()
        c = _shared[key] = httpx.AsyncClient(timeout=TIMEOUT, transport=transport, limits=LIMITS)
    return c


def sign(ts: str, method: str, url: str, user: str, via: str, body: bytes) -> str:
    head = f"{ts}\n{method.upper()}\n{url}\n{user}\n{via}\n".encode()
    return hmac.new(settings.prima_secret.encode(), head + body, hashlib.sha256).hexdigest()


async def _send(
    method: str, url: str, user: str, via: str, body: bytes, client_ip: str, base: str = ""
) -> Answer:
    ts = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    headers = {
        "x-office-ts": ts,
        "x-office-user": user,
        "x-office-via": via,
        "x-office-signature": sign(ts, method, url, user, via, body),
        "accept": "application/json",
    }
    if body:
        headers["content-type"] = "application/json"
    if client_ip:
        # Prima limits calls per address (behind one trusted proxy): the person's, not ours.
        headers["x-forwarded-for"] = client_ip
    started = time.perf_counter()
    try:
        r = await _client().request(
            method,
            (base or settings.prima_url).rstrip("/") + url,
            headers=headers,
            content=body or None,
        )
    except httpx.HTTPError as e:
        raise PrimaError(
            503, Msg("Prima is not answering right now. Try again in a minute.")
        ) from e
    return Answer(
        status=r.status_code,
        content_type=r.headers.get("content-type", "application/json"),
        body=r.content,
        disposition=r.headers.get("content-disposition", ""),
        timing=r.headers.get("server-timing", ""),
        upstream_ms=(time.perf_counter() - started) * 1000,
    )


async def call(
    db: AsyncSession,
    *,
    workspace_id: str,
    user_id: str,
    method: str,
    path: str,
    query: str = "",
    body: bytes = b"",
    via: str = "person",
    client_ip: str = "",
) -> Answer:
    """Ask Prima as this person. Prima's own answer (any status) comes back as it is."""
    if not enabled(workspace_id):
        raise PrimaError(404, Msg("Prima is not set up on this server."))
    method = method.upper()
    if method not in ("GET", "POST"):
        raise PrimaError(405, Msg("Prima only reads (GET) and records (POST)."))
    if len(body) > MAX_BODY:
        raise PrimaError(413, Msg("That is too large for Prima (3 MB at most)."))
    url = clean_path(path, query)
    await check_chosen(db, workspace_id, user_id, method, url)
    link = await link_for(db, workspace_id, user_id)
    if link.linked_by == TOP_LINK and url.startswith("/api/arisha"):
        # P123: several people open Prima as its top record; Arisha's model turns that follow are
        # charged to the one asking (prima/model.person_of), not to whoever the record belongs to.
        await note_top_asker(link.prima_user_id, workspace_id, user_id)
    if link.linked_by == TOP_LINK and method == "POST":
        await _check_not_own_work(
            db, workspace_id, user_id, url, body, link.prima_user_id, client_ip
        )
    ans = await _send(method, url, link.prima_user_id, via, body, client_ip)
    if link.linked_by == TOP_LINK and method == "POST":
        # P82: several people share the top record, and Prima's office.ts takes only "person"
        # or "agent:<name>" as `via`, so Prima's own log names the record. The office's log
        # names the person: every record made through the shared record, by whom and how.
        await audit.record(
            db,
            workspace_id,
            f"user:{user_id}",
            "prima.recorded",
            target=link.prima_user_id,
            after={"path": url.split("?", 1)[0], "via": via, "status": ans.status},
        )
        await db.commit()
    return ans
