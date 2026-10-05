"""Gmail for personal assistants (P16).

Each person connects their own mailbox with Google sign-in (OAuth 2.0 with PKCE). Scopes:
gmail.readonly (read and search) and gmail.compose (create drafts, and send a draft). Nothing
is ever sent without the person pressing Send in the dashboard: assistants only make drafts.
The same sign-in also asks for calendar.events (see calendar.py): connections made before
that have no calendar until the person reconnects.

An API key cannot read a mailbox; Google requires the mailbox owner's consent through an
OAuth client (Client ID + secret) created in the same Google Cloud project, with the Gmail
API enabled. Reading and drafting cost nothing (Gmail API quota is free).
"""

import base64
import hashlib
import html
import json
import re
import secrets
import urllib.parse
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import getaddresses, parseaddr
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core import crypto
from ..core.config import settings
from ..core.valkey import valkey
from ..i18n import Msg
from ..models import GoogleAccount, Integration

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"  # noqa: S105 - a URL
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
API = "https://gmail.googleapis.com/gmail/v1/users/me"
CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events"
SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
    # The person's calendar (read events, and add or change them once they confirm).
    CALENDAR_SCOPE,
]
STATE_TTL = 600
transport: httpx.AsyncBaseTransport | None = None  # tests swap in a fake Google


class GmailError(Exception):
    def __init__(self, message: str, status: int = 0):
        super().__init__(message)
        self.status = status


def redirect_uri() -> str:
    return f"{settings.public_url.rstrip('/')}/api/integrations/google/callback"


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=25, transport=transport)


# ---------------------------------------------------------------- the OAuth app


async def app_credentials(db: AsyncSession, workspace_id: str) -> tuple[str, str] | None:
    """The OAuth client: set in the dashboard, else from the environment."""
    row = await db.scalar(
        select(Integration).where(
            Integration.workspace_id == workspace_id, Integration.kind == "google"
        )
    )
    if row is not None and row.config_enc:
        data = json.loads(crypto.decrypt(row.config_enc, row.aad))
        if data.get("client_id") and data.get("client_secret"):
            return data["client_id"], data["client_secret"]
    if settings.google_client_id and settings.google_client_secret:
        return settings.google_client_id, settings.google_client_secret
    return None


async def auth_url(db: AsyncSession, workspace_id: str, user_id: str) -> str:
    creds = await app_credentials(db, workspace_id)
    if creds is None:
        raise GmailError(Msg("Google sign-in is not set up yet (Channels > Gmail)."))
    state = secrets.token_urlsafe(24)
    verifier = secrets.token_urlsafe(48)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    )
    await valkey().set(
        f"gauth:{state}",
        json.dumps({"ws": workspace_id, "user": user_id, "verifier": verifier}),
        ex=STATE_TTL,
    )
    q = {
        "client_id": creds[0],
        "redirect_uri": redirect_uri(),
        "response_type": "code",
        "scope": " ".join(["openid", "email", *SCOPES]),
        "access_type": "offline",  # a refresh token, so the assistant works later too
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    return f"{AUTH_URL}?{urllib.parse.urlencode(q)}"


async def finish(db: AsyncSession, state: str, code: str) -> GoogleAccount:
    """The callback: trade the code for tokens and remember the mailbox."""
    raw = await valkey().getdel(f"gauth:{state}")
    if not raw:
        raise GmailError(Msg("That sign-in link expired. Start again from the dashboard."))
    st = json.loads(raw)
    creds = await app_credentials(db, st["ws"])
    if creds is None:
        raise GmailError(Msg("Google sign-in is not set up."))
    async with _client() as c:
        r = await c.post(
            TOKEN_URL,
            data={
                "code": code,
                "client_id": creds[0],
                "client_secret": creds[1],
                "redirect_uri": redirect_uri(),
                "grant_type": "authorization_code",
                "code_verifier": st["verifier"],
            },
        )
    tok = r.json() if r.content else {}
    if r.status_code >= 400 or not tok.get("access_token"):
        raise GmailError(
            Msg(
                "Google refused the sign-in: {why}",
                why=tok.get("error_description") or tok.get("error") or r.status_code,
            )
        )
    if not tok.get("refresh_token"):
        raise GmailError(
            Msg(
                "Google gave no refresh token. Remove the app's access in your Google account "
                "and connect again."
            )
        )
    granted = tok.get("scope", "")
    if "gmail.readonly" not in granted:
        raise GmailError(
            Msg("Gmail access was not granted. Tick the Gmail boxes on Google's screen.")
        )
    profile = await _api(tok["access_token"], "GET", "/profile")
    acct = await db.scalar(
        select(GoogleAccount).where(
            GoogleAccount.workspace_id == st["ws"], GoogleAccount.user_id == st["user"]
        )
    )
    if acct is None:
        acct = GoogleAccount(workspace_id=st["ws"], user_id=st["user"], email="", token_enc="")
        db.add(acct)
        await db.flush()
    acct.email = profile.get("emailAddress", "")[:200]
    acct.scopes = granted
    acct.token_enc = crypto.encrypt(tok["refresh_token"], acct.aad)
    acct.status, acct.last_error = "connected", None
    await db.commit()
    await valkey().set(
        f"gtok:{acct.id}", tok["access_token"], ex=max(60, int(tok.get("expires_in", 3600)) - 120)
    )
    return acct


async def access_token(db: AsyncSession, acct: GoogleAccount) -> str:
    cached = await valkey().get(f"gtok:{acct.id}")
    if cached:
        return cached.decode() if isinstance(cached, bytes) else str(cached)
    creds = await app_credentials(db, acct.workspace_id)
    if creds is None:
        raise GmailError(Msg("Google sign-in is not set up."))
    async with _client() as c:
        r = await c.post(
            TOKEN_URL,
            data={
                "client_id": creds[0],
                "client_secret": creds[1],
                "refresh_token": crypto.decrypt(acct.token_enc, acct.aad),
                "grant_type": "refresh_token",
            },
        )
    tok = r.json() if r.content else {}
    if r.status_code >= 400 or not tok.get("access_token"):
        acct.status = "error"
        acct.last_error = (
            f"Google: {tok.get('error_description') or tok.get('error') or r.status_code}"[:300]
        )
        await db.commit()
        raise GmailError(
            Msg("Gmail needs reconnecting ({why}).", why=acct.last_error or ""), r.status_code
        )
    await valkey().set(
        f"gtok:{acct.id}", tok["access_token"], ex=max(60, int(tok.get("expires_in", 3600)) - 120)
    )
    return tok["access_token"]


async def revoke(db: AsyncSession, acct: GoogleAccount) -> None:
    try:
        async with _client() as c:
            await c.post(REVOKE_URL, data={"token": crypto.decrypt(acct.token_enc, acct.aad)})
    except Exception:  # noqa: BLE001, S110 - best effort; the row goes anyway
        pass
    await valkey().delete(f"gtok:{acct.id}")


# ---------------------------------------------------------------- the Gmail API


async def _api(token: str, method: str, path: str, **kw: Any) -> dict[str, Any]:
    async with _client() as c:
        r = await c.request(method, API + path, headers={"Authorization": f"Bearer {token}"}, **kw)
    if r.status_code >= 400:
        raise GmailError(f"Gmail answered {r.status_code}: {r.text[:200]}", r.status_code)
    return r.json() if r.content else {}


def _headers(msg: dict[str, Any]) -> dict[str, str]:
    return {h["name"].lower(): h["value"] for h in (msg.get("payload") or {}).get("headers") or []}


def _decode(data: str) -> str:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", "replace")


def _text(part: dict[str, Any]) -> str:
    """The readable text of a message: plain text if there is any, else HTML stripped."""
    plain, rich = [], []

    def walk(p: dict[str, Any]) -> None:
        mime = p.get("mimeType", "")
        data = (p.get("body") or {}).get("data")
        if data and mime == "text/plain":
            plain.append(_decode(data))
        elif data and mime == "text/html":
            rich.append(_decode(data))
        for sub in p.get("parts") or []:
            walk(sub)

    walk(part)
    if plain:
        return "\n".join(plain)
    text = re.sub(r"(?is)<(script|style).*?</\1>", " ", "\n".join(rich))
    text = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>", "\n", text)
    text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    return re.sub(r"[ \t]+", " ", re.sub(r"\n\s*\n+", "\n\n", text)).strip()


@dataclass
class Mail:
    id: str
    thread_id: str
    sender: str
    to: str
    cc: str
    subject: str
    date: str
    snippet: str
    unread: bool
    message_id: str = ""  # the RFC 822 Message-ID, for threading replies
    references: str = ""
    body: str = ""


def _mail(msg: dict[str, Any], body: bool = False) -> Mail:
    h = _headers(msg)
    return Mail(
        id=msg.get("id", ""),
        thread_id=msg.get("threadId", ""),
        sender=h.get("from", ""),
        to=h.get("to", ""),
        cc=h.get("cc", ""),
        subject=h.get("subject", "(no subject)"),
        date=h.get("date", ""),
        snippet=html.unescape(msg.get("snippet", "")),
        unread="UNREAD" in (msg.get("labelIds") or []),
        message_id=h.get("message-id", ""),
        references=h.get("references", ""),
        body=_text(msg.get("payload") or {}) if body else "",
    )


async def search(db: AsyncSession, acct: GoogleAccount, query: str, limit: int = 10) -> list[Mail]:
    token = await access_token(db, acct)
    found = await _api(
        token, "GET", "/messages", params={"q": query, "maxResults": max(1, min(limit, 25))}
    )
    out = []
    for m in found.get("messages") or []:
        full = await _api(
            token,
            "GET",
            f"/messages/{m['id']}",
            params={
                "format": "metadata",
                "metadataHeaders": ["From", "To", "Cc", "Subject", "Date"],
            },
        )
        out.append(_mail(full))
    return out


async def read(db: AsyncSession, acct: GoogleAccount, message_id: str) -> Mail:
    token = await access_token(db, acct)
    return _mail(
        await _api(token, "GET", f"/messages/{message_id}", params={"format": "full"}), body=True
    )


def _raw(to: str, cc: str, subject: str, body: str, sender: str, reply: Mail | None) -> str:
    m = EmailMessage()
    m["To"] = to
    if cc:
        m["Cc"] = cc
    m["From"] = sender
    m["Subject"] = subject
    if reply is not None and reply.message_id:
        m["In-Reply-To"] = reply.message_id
        m["References"] = f"{reply.references} {reply.message_id}".strip()
    m.set_content(body)
    return base64.urlsafe_b64encode(m.as_bytes()).decode()


def reply_fields(original: Mail, me: str, reply_all: bool) -> tuple[str, str, str]:
    """Who a reply goes to, and its subject."""
    to = original.sender
    cc = ""
    if reply_all:
        mine = parseaddr(me)[1].lower()
        others = [
            f"{n} <{a}>" if n else a
            for n, a in getaddresses([original.to, original.cc])
            if a and a.lower() != mine
        ]
        cc = ", ".join(others)
    subject = (
        original.subject
        if original.subject.lower().startswith("re:")
        else f"Re: {original.subject}"
    )
    return to, cc, subject


async def create_draft(
    db: AsyncSession,
    acct: GoogleAccount,
    to: str,
    cc: str,
    subject: str,
    body: str,
    reply: Mail | None,
) -> dict[str, Any]:
    token = await access_token(db, acct)
    msg: dict[str, Any] = {"raw": _raw(to, cc, subject, body, acct.email, reply)}
    if reply is not None:
        msg["threadId"] = reply.thread_id
    return await _api(token, "POST", "/drafts", json={"message": msg})


async def update_draft(
    db: AsyncSession,
    acct: GoogleAccount,
    draft_id: str,
    thread_id: str,
    to: str,
    cc: str,
    subject: str,
    body: str,
    reply: Mail | None,
) -> dict[str, Any]:
    token = await access_token(db, acct)
    msg: dict[str, Any] = {"raw": _raw(to, cc, subject, body, acct.email, reply)}
    if thread_id:
        msg["threadId"] = thread_id
    return await _api(token, "PUT", f"/drafts/{draft_id}", json={"id": draft_id, "message": msg})


async def send_draft(db: AsyncSession, acct: GoogleAccount, draft_id: str) -> dict[str, Any]:
    token = await access_token(db, acct)
    return await _api(token, "POST", "/drafts/send", json={"id": draft_id})


async def delete_draft(db: AsyncSession, acct: GoogleAccount, draft_id: str) -> None:
    token = await access_token(db, acct)
    try:
        await _api(token, "DELETE", f"/drafts/{draft_id}")
    except GmailError as e:
        if e.status != 404:
            raise
