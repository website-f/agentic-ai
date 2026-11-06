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

Tests swap in a fake Prima: `client.transport = httpx.MockTransport(handler)`.
"""

import hashlib
import hmac
import json
import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime

import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..i18n import Msg
from ..i18n.labels import role_label
from ..models import Branch, Membership, PrimaLink, Workspace
from ..services import audit

transport: httpx.AsyncBaseTransport | None = None
TIMEOUT = httpx.Timeout(30.0, connect=5.0)

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


class PrimaError(Exception):
    """A refusal before Prima was asked (not linked, not running, a path it never serves)."""

    def __init__(self, status: int, message: Msg, code: str = "") -> None:
        super().__init__(str(message))
        self.status = status
        self.message = message
        self.code = code  # "microsoft_needed": the screen offers Connect Microsoft


@dataclass(frozen=True)
class Answer:
    status: int
    content_type: str
    body: bytes
    disposition: str = ""

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


@dataclass(frozen=True)
class Company:
    id: str
    name: str
    # P81: the other names Prima knows the company by ("UNIT HR", "OPERASI JOHOR"), for the
    # branch-to-company suggestion only; never shown or saved.
    aliases: tuple[str, ...] = ()


def prima_role(office_role: str) -> str:
    return PRIMA_ROLES.get(office_role, "pwvsb_officer")


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
        )
        for r in (rows if isinstance(rows, list) else [])
        if isinstance(r, dict) and r.get("id")
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
) -> str:
    """Make (or bring up to date) this person's own Prima account; its Prima id. A system call
    to Prima's accounts service, signed like every other ("/accounts"). P81: with their sign-in
    email, Prima links the account to their own staff record (the real staff list), so My
    details, the staff clock and payroll are theirs."""
    payload: dict[str, object] = {
        "officeUserId": office_user_id,
        "name": name[:120],
        "title": title[:120],
        "role": role,
        "companyIds": company_ids,
    }
    if email and "@" in email and len(email) <= 254:
        payload["email"] = email.strip().lower()
    body = json.dumps(payload, separators=(",", ":")).encode()
    ans = await _send("POST", "/accounts", "", "system", body, "", base=settings.prima_accounts_url)
    data = ans.json() if ans.status in (200, 400) else None
    rid = str(data.get("id") or "") if isinstance(data, dict) else ""
    if ans.status == 200 and rid.startswith(OFFICE_ACCOUNT_PREFIX):
        return rid
    if ans.status == 400:
        raise PrimaError(
            403, Msg("Prima could not make your account. Ask the office owner to check it.")
        )
    raise PrimaError(503, Msg("Prima is not answering right now. Try again in a minute."))


async def _own_account(db: AsyncSession, m: Membership, name: str, email: str = "") -> PrimaLink:
    """P75: the person's own Prima account, in the Prima company of their branch."""
    branch_id = m.branch_id
    if branch_id is None:
        # Someone with no branch in an office of one branch works in that branch.
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
    role = prima_role(m.role)
    rid = await create_account(
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
        linked_by="auto:account",
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
        after={"prima_user_id": rid, "role": role, "company": company},
        note=f"Own Prima account {rid} made for them ({role} in {company})",
    )
    await db.commit()
    return link


async def link_for(db: AsyncSession, workspace_id: str, user_id: str) -> PrimaLink:
    """This person's Prima record. Made here, the first time they open Prima, when the match is
    sure (people.suggestions): the record IT gave their verified Microsoft account, else the
    only record with exactly their name while nobody else in the office has it. The owner sees
    and can change every link on the Prima page. P82: every owner, and the developer, opens
    Prima as its top record with no link (opens_as_top)."""
    from . import people  # late: people builds on this module

    m = await db.get(Membership, (workspace_id, user_id))
    if m is not None and opens_as_top(m):
        top = await top_record()
        if top is not None:
            await _let_go(db, workspace_id, user_id)
            return PrimaLink(
                workspace_id=workspace_id,
                user_id=user_id,
                prima_user_id=top.id,
                prima_name=top.name[:200],
                how="owner",
                linked_by=TOP_LINK,
            )
        # Prima has no top record: the owner opens it by their own link, as anyone else.
    elif m is None or not m.ms_oid:
        # P70: Prima and the office are one system, and Prima knows people by their Microsoft
        # work account: no way in (screens or the AI) until the person has connected it here.
        raise PrimaError(
            403,
            Msg(
                "Connect your Microsoft work account to the office to open Prima. It takes one "
                "sign-in with Microsoft."
            ),
            code="microsoft_needed",
        )
    link = await db.get(PrimaLink, (workspace_id, user_id))
    if link is not None:
        return link
    records = matchable(await staff())
    persons = await people.people(db, workspace_id)
    rid = people.suggestions(persons, records).get(user_id)
    record = next((r for r in records if r.id == rid), None)
    me = next((p for p in persons if p.user_id == user_id), None)
    if me is None or m is None:
        raise _not_linked()
    if record is None:
        # P75: no record of their own in Prima: they get one, from their office role. An
        # owner opens Prima as its top record (P74), never as a made account.
        if me.role == "owner":
            raise _not_linked()
        return await _own_account(db, m, me.name, me.email)
    how = "microsoft" if me.ms_oid and record.entra_oid == me.ms_oid else "name"
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
        return link
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
    return link


# P82: every office owner, and the system's developer, opens Prima as its top record (the CEO,
# else the COO): they run the company. No link, no Microsoft step, and several people may share
# that record; the office's audit log says which of them recorded what (call). The top record
# is asked of Prima at most every TOP_TTL seconds, not on every call.
TOP_LINK = "auto:top"  # linked_by of the link link_for hands back for them (never saved)
TOP_TTL = 300.0
_TOP: dict[str, tuple[float, StaffRecord | None]] = {}


def opens_as_top(m: Membership) -> bool:
    """An owner, or the developer (deps.is_developer: an owner the operator marked)."""
    from ..api.deps import is_developer  # late: the api builds on this module

    return m.role == "owner" or is_developer(m.user, m.role)


def top_of(records: list[StaffRecord]) -> StaffRecord | None:
    """Prima's top record: its CEO, else its COO, else none."""
    tops = sorted((r for r in records if r.top), key=lambda r: 0 if r.top == "ceo" else 1)
    return tops[0] if tops else None


async def top_record() -> StaffRecord | None:
    now = time.monotonic()
    hit = _TOP.get(settings.prima_url)
    if hit is not None and now - hit[0] < TOP_TTL:
        return hit[1]
    top = top_of(await staff())
    _TOP[settings.prima_url] = (now, top)
    return top


async def _let_go(db: AsyncSession, workspace_id: str, user_id: str) -> None:
    """An owner's own link from before P82 (a staff record by name, or the top record itself)
    is let go once, so that record is free for its own person."""
    old = await db.get(PrimaLink, (workspace_id, user_id))
    if old is None:
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


def via_agent(name: str) -> str:
    """'agent:<name>' in plain ASCII (a header), at most 80 characters of name."""
    plain = re.sub(r"[^A-Za-z0-9 _.\-]", "", name).strip() or "AI"
    return f"agent:{plain[:80]}"


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
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, transport=transport) as http:
            r = await http.request(
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
    link = await link_for(db, workspace_id, user_id)
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
