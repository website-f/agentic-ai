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

Tests swap in a fake Prima: `client.transport = httpx.MockTransport(handler)`.
"""

import hashlib
import hmac
import re
from dataclasses import dataclass
from datetime import UTC, datetime

import httpx
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..i18n import Msg
from ..models import Membership, PrimaLink
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
        )
        for r in (rows if isinstance(rows, list) else [])
        if isinstance(r, dict) and r.get("id")
    ]


async def link_for(db: AsyncSession, workspace_id: str, user_id: str) -> PrimaLink:
    """This person's Prima record. Made here, the first time they open Prima, when the match is
    sure (people.suggestions): the record IT gave their verified Microsoft account, else the
    only record with exactly their name while nobody else in the office has it. The owner sees
    and can change every link on the Prima page."""
    from . import people  # late: people builds on this module

    # P70: Prima and the office are one system, and Prima knows people by their Microsoft work
    # account: no way in (screens or the AI) until the person has connected it in the office.
    m = await db.get(Membership, (workspace_id, user_id))
    if m is None or not m.ms_oid:
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
    records = await staff()
    persons = await people.people(db, workspace_id)
    rid = people.suggestions(persons, records).get(user_id)
    record = next((r for r in records if r.id == rid), None)
    me = next((p for p in persons if p.user_id == user_id), None)
    if record is None or me is None:
        raise _not_linked()
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


def via_agent(name: str) -> str:
    """'agent:<name>' in plain ASCII (a header), at most 80 characters of name."""
    plain = re.sub(r"[^A-Za-z0-9 _.\-]", "", name).strip() or "AI"
    return f"agent:{plain[:80]}"


def sign(ts: str, method: str, url: str, user: str, via: str, body: bytes) -> str:
    head = f"{ts}\n{method.upper()}\n{url}\n{user}\n{via}\n".encode()
    return hmac.new(settings.prima_secret.encode(), head + body, hashlib.sha256).hexdigest()


async def _send(method: str, url: str, user: str, via: str, body: bytes, client_ip: str) -> Answer:
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
                method, settings.prima_url.rstrip("/") + url, headers=headers, content=body or None
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
    return await _send(method, url, link.prima_user_id, via, body, client_ip)
