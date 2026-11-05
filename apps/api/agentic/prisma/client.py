"""Calls to Prima Secure, signed for one person (P66).

The office holds no Prima password or token. Each call names the person by the Microsoft
account they signed in to the office with (Membership.ms_tenant_id / ms_oid, verified by
Microsoft at sign-in) and is signed with settings.prima_secret, which Prima checks
(apps/prima/apps/api/src/office.ts). Prima then links that account to its own staff record
exactly as it links a Microsoft sign-in, so its roles, record rules and row-level security
decide what the person, or their AI, may see and do. The signature covers the time, the
method, the path with its query, who, through what, and the exact body bytes.

Tests swap in a fake Prima: `client.transport = httpx.MockTransport(handler)`.
"""

import hashlib
import hmac
import re
from dataclasses import dataclass
from datetime import UTC, datetime

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..i18n import Msg
from ..models import Membership

transport: httpx.AsyncBaseTransport | None = None
TIMEOUT = httpx.Timeout(30.0, connect=5.0)

# Prima's own paths only, in a plain alphabet so the path Prima sees is the one signed.
_PATH = re.compile(r"^api/[A-Za-z0-9_\-./~]{0,300}$")
_QUERY = re.compile(r"^[A-Za-z0-9_\-.~%=&+:,]{0,1000}$")
# Never through the office: the signed system feeds (their own keys), development sign-in.
_CLOSED = ("api/integrations/", "api/auth/dev-login", "api/auth/users")
# The AI's Prima tools (agents/prisma_tools.py): offered only when enabled() for the workspace.
TOOL_NAMES = frozenset({"prisma_find", "prisma_read", "prisma_record"})
PROMPT_NOTE = (
    "Prima Secure (the group's operations app: attendance, leave, claims, staff pay, rosters, "
    "cases, assets, purchasing, tenders...) runs in this office. You can work in it for the "
    "person who asked you, as them, with their access only: prisma_find gives the action for a "
    "job, prisma_read reads, prisma_record records (they approve each one first). Follow the "
    "matching Prima procedure from the library. If Prima refuses, say why; never try another "
    "way round its rules. Prepare and record what the person asks; decisions on pay, "
    "deductions, discipline and contracts stay with the people Prima names."
)
MAX_BODY = 3 * 1024 * 1024  # Prima's own JSON limit (photos and proofs as data URLs)


class PrimaError(Exception):
    """A refusal before Prima was asked (not linked, not running, a path it never serves)."""

    def __init__(self, status: int, message: Msg) -> None:
        super().__init__(str(message))
        self.status = status
        self.message = message


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


async def identity(db: AsyncSession, workspace_id: str, user_id: str) -> tuple[str, str]:
    """(tenant, object ID) of the Microsoft account this person signed in with."""
    m = await db.get(Membership, (workspace_id, user_id))
    if m is None or not m.ms_oid or not m.ms_tenant_id:
        raise PrimaError(
            403,
            Msg(
                "Prima knows people by their Microsoft work account. Sign out, then use Sign in "
                "with Microsoft once, and open Prima again."
            ),
        )
    return m.ms_tenant_id.lower(), m.ms_oid.lower()


def via_agent(name: str) -> str:
    """'agent:<name>' in plain ASCII (a header), at most 80 characters of name."""
    plain = re.sub(r"[^A-Za-z0-9 _.\-]", "", name).strip() or "AI"
    return f"agent:{plain[:80]}"


def sign(ts: str, method: str, url: str, oid: str, tid: str, via: str, body: bytes) -> str:
    head = f"{ts}\n{method.upper()}\n{url}\n{oid}\n{tid}\n{via}\n".encode()
    return hmac.new(settings.prima_secret.encode(), head + body, hashlib.sha256).hexdigest()


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
    tid, oid = await identity(db, workspace_id, user_id)
    ts = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    headers = {
        "x-office-ts": ts,
        "x-office-oid": oid,
        "x-office-tid": tid,
        "x-office-via": via,
        "x-office-signature": sign(ts, method, url, oid, tid, via, body),
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
