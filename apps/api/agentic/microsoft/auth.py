"""Microsoft sign-in: a person's own mailbox (delegated), shared mailboxes (app-only), and
the admin-consent step.

Delegated (personal Outlook): OAuth 2.0 authorization code with PKCE against
login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize|token. The state is bound to the
person who started it AND a hash of their sign-in session (the P29 Gmail fix): the callback
only finishes in that same browser session, so nobody can make a colleague's click connect
the wrong mailbox. Refresh tokens rotate: every refresh stores the new one. When Microsoft
refuses a refresh token (invalid_grant, interaction_required...) the account is marked
`reconnect_needed` and `ReconnectNeeded` is raised; syncing skips it until they reconnect.

App-only (shared mailboxes): client credentials for one specific tenant, scope
https://graph.microsoft.com/.default. With a multi-tenant app ("organizations") the tenant
comes from the admin-consent step, whose state is bound the same way.

Valkey keys: msauth:{state}, msadm:{state} (10 min), mstok:{account id} (access token, a
little shorter than its life), msapp:{workspace}:{tenant} (app token).
"""

import base64
import hashlib
import hmac
import json
import secrets
import urllib.parse
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core import crypto
from ..core.valkey import valkey
from ..i18n import Msg
from ..models import MailItem, MailSubscription, MicrosoftAccount
from . import app, http
from .errors import MicrosoftError, NotConfigured, ReconnectNeeded

STATE_TTL = 600
# Token errors that mean "this person has to sign in again", not "try later".
RECONNECT_ERRORS = frozenset(
    {"invalid_grant", "interaction_required", "consent_required", "login_required"}
)


def _sid(session_id: str) -> str:
    """The sign-in session that started a flow, hashed again for the state (P29)."""
    return hashlib.sha256(f"msauth:{session_id}".encode()).hexdigest()


def _bound(st: dict[str, Any], workspace_id: str, user_id: str, session_id: str) -> bool:
    return (
        st.get("ws") == workspace_id
        and st.get("user") == user_id
        and hmac.compare_digest(str(st.get("sid") or ""), _sid(session_id))
    )


def _claims(id_token: str) -> dict[str, Any]:
    """The id token's claims. It came straight from Microsoft's token endpoint over TLS
    (not through the browser), so its signature is not checked here."""
    try:
        part = id_token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
    except (IndexError, ValueError):
        return {}


def _why(tok: dict[str, Any], status: int) -> str:
    desc = str(tok.get("error_description") or "").split("\r\n")[0].split("\n")[0]
    return (desc or str(tok.get("error") or status))[:240]


async def _token_call(tenant: str, data: dict[str, str]) -> tuple[int, dict[str, Any]]:
    async with http.client() as c:
        r = await c.post(f"{app.LOGIN}/{tenant}/oauth2/v2.0/token", data=data)
    try:
        return r.status_code, (r.json() if r.content else {})
    except ValueError:
        return r.status_code, {}


async def _configured(db: AsyncSession, workspace_id: str) -> app.AppConfig:
    cfg = await app.load(db, workspace_id)
    if not cfg.configured:
        raise NotConfigured(Msg("Microsoft 365 is not set up yet (Channels > Microsoft 365)."))
    return cfg


# ---------------------------------------------------------------- a person's own mailbox


async def auth_url(
    db: AsyncSession, workspace_id: str, user_id: str, session_id: str, base: str
) -> str:
    """Microsoft's sign-in page for this person. `base` is the public address the callback
    returns to; it is remembered in the state so the token call uses the same one."""
    cfg = await _configured(db, workspace_id)
    state = secrets.token_urlsafe(24)
    verifier = secrets.token_urlsafe(48)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    )
    redirect = app.redirect_uri(base)
    await valkey().set(
        f"msauth:{state}",
        json.dumps(
            {
                "ws": workspace_id,
                "user": user_id,
                "sid": _sid(session_id),
                "verifier": verifier,
                "redirect": redirect,
            }
        ),
        ex=STATE_TTL,
    )
    q = {
        "client_id": cfg.client_id,
        "response_type": "code",
        "redirect_uri": redirect,
        "response_mode": "query",
        "scope": app.DELEGATED_SCOPES,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "prompt": "select_account",
    }
    return f"{app.LOGIN}/{cfg.tenant}/oauth2/v2.0/authorize?{urllib.parse.urlencode(q)}"


async def finish(
    db: AsyncSession, state: str, code: str, *, workspace_id: str, user_id: str, session_id: str
) -> MicrosoftAccount:
    """The callback: trade the code for tokens and remember the mailbox (one per person).
    Only in the browser session that started it (P29)."""
    raw = await valkey().getdel(f"msauth:{state}") if state else None
    if not raw:
        raise MicrosoftError(
            Msg("That Microsoft sign-in link expired. Start again from the dashboard.")
        )
    st = json.loads(raw)
    if not _bound(st, workspace_id, user_id, session_id):
        raise MicrosoftError(
            Msg(
                "This Microsoft sign-in was started by someone else or in another browser. "
                "Start again from your own page."
            )
        )
    cfg = await _configured(db, workspace_id)
    status, tok = await _token_call(
        cfg.tenant,
        {
            "client_id": cfg.client_id,
            "client_secret": cfg.client_secret,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": st["redirect"],
            "code_verifier": st["verifier"],
            "scope": app.DELEGATED_SCOPES,
        },
    )
    if status >= 400 or not tok.get("access_token"):
        raise MicrosoftError(Msg("Microsoft refused the sign-in: {why}", why=_why(tok, status)))
    if not tok.get("refresh_token"):
        raise MicrosoftError(
            Msg("Microsoft gave no refresh token. Connect again and accept all the permissions.")
        )
    granted = str(tok.get("scope") or "")
    if not has_scope(granted, "Mail.ReadWrite"):
        raise MicrosoftError(
            Msg("Mail access was not granted. Accept the mail permissions on Microsoft's screen.")
        )
    claims = _claims(str(tok.get("id_token") or ""))
    profile: dict[str, Any] = {}
    try:
        from .graph import Graph

        async def fixed(_force: bool = False) -> str:
            return tok["access_token"]

        profile = await Graph(fixed, "/me").me()
    except MicrosoftError:
        profile = {}
    acct = await db.scalar(
        select(MicrosoftAccount).where(
            MicrosoftAccount.workspace_id == workspace_id, MicrosoftAccount.user_id == user_id
        )
    )
    if acct is None:
        acct = MicrosoftAccount(workspace_id=workspace_id, user_id=user_id)
        db.add(acct)
        await db.flush()
    email = profile.get("mail") or profile.get("userPrincipalName") or claims.get("email")
    email = email or claims.get("preferred_username") or ""
    changed_mailbox = bool(acct.ms_user_id) and acct.ms_user_id != (
        profile.get("id") or claims.get("oid") or ""
    )
    acct.ms_user_id = str(profile.get("id") or claims.get("oid") or "")[:80]
    acct.tenant_id = str(claims.get("tid") or "")[:80]
    acct.email = str(email).lower()[:254]
    acct.display_name = str(profile.get("displayName") or claims.get("name") or "")[:200]
    acct.scopes = granted
    acct.token_enc = crypto.encrypt(tok["refresh_token"], acct.aad)
    acct.status, acct.last_error = "connected", None
    if changed_mailbox:
        # Another Microsoft account than before: nothing of the old mailbox stays, and its
        # sync starts afresh. (Its old subscription cannot be deleted with this account's
        # token; it lapses at Microsoft and its notifications are ignored here.)
        await db.execute(delete(MailItem).where(MailItem.account_id == acct.id))
        await db.execute(delete(MailSubscription).where(MailSubscription.account_id == acct.id))
        acct.delta_link = None
        acct.last_sync_at = None
    await db.commit()
    await _cache(acct.id, tok)
    return acct


def has_scope(granted: str, scope: str) -> bool:
    """Microsoft may answer short names ("Mail.ReadWrite") or full URLs."""
    want = scope.lower()
    return any(s.rsplit("/", 1)[-1].lower() == want for s in granted.split())


async def _cache(account_id: str, tok: dict[str, Any]) -> None:
    ttl = max(60, int(tok.get("expires_in") or 3600) - 120)
    await valkey().set(f"mstok:{account_id}", tok["access_token"], ex=ttl)


async def access_token(db: AsyncSession, acct: MicrosoftAccount, force: bool = False) -> str:
    """A valid access token for this person's mailbox: cached, else refreshed (and the
    rotated refresh token stored). `force` skips the cache (after a 401)."""
    if acct.status in ("reconnect_needed", "disconnected") or not acct.token_enc:
        raise ReconnectNeeded(Msg("Outlook needs reconnecting. Connect Microsoft 365 again."))
    if not force:
        cached = await valkey().get(f"mstok:{acct.id}")
        if cached:
            return str(cached)
    cfg = await _configured(db, acct.workspace_id)
    tenant = acct.tenant_id or cfg.tenant
    status, tok = await _token_call(
        tenant,
        {
            "client_id": cfg.client_id,
            "client_secret": cfg.client_secret,
            "grant_type": "refresh_token",
            "refresh_token": crypto.decrypt(acct.token_enc, acct.aad),
            "scope": app.DELEGATED_SCOPES,
        },
    )
    if status >= 400 or not tok.get("access_token"):
        why = _why(tok, status)
        if str(tok.get("error") or "") in RECONNECT_ERRORS:
            acct.status = "reconnect_needed"
            acct.last_error = f"Microsoft: {why}"[:500]
            await db.commit()
            await valkey().delete(f"mstok:{acct.id}")
            raise ReconnectNeeded(Msg("Outlook needs reconnecting ({why}).", why=why), status)
        acct.last_error = f"Microsoft: {why}"[:500]
        await db.commit()
        raise MicrosoftError(Msg("Microsoft sign-in failed for now ({why}).", why=why), status)
    if tok.get("refresh_token"):
        acct.token_enc = crypto.encrypt(tok["refresh_token"], acct.aad)
    if tok.get("scope"):
        acct.scopes = str(tok["scope"])
    acct.last_error = None
    await db.commit()
    await _cache(acct.id, tok)
    return str(tok["access_token"])


async def forget(acct: MicrosoftAccount) -> None:
    """Drop the cached access token. Microsoft has no per-app revoke for a refresh token;
    deleting it here (the caller clears token_enc) is how a disconnect lets go."""
    await valkey().delete(f"mstok:{acct.id}")


# ---------------------------------------------------------------- app-only (shared mailboxes)


async def app_token(db: AsyncSession, workspace_id: str, tenant: str, force: bool = False) -> str:
    """Client-credentials token for one tenant, for shared mailboxes."""
    if not tenant or tenant in app.MULTI_TENANT:
        raise NotConfigured(
            Msg(
                "Grant admin consent first (Channels > Microsoft 365) so the app knows your tenant."
            )
        )
    key = f"msapp:{workspace_id}:{tenant}"
    if not force:
        cached = await valkey().get(key)
        if cached:
            return str(cached)
    cfg = await _configured(db, workspace_id)
    status, tok = await _token_call(
        tenant,
        {
            "client_id": cfg.client_id,
            "client_secret": cfg.client_secret,
            "grant_type": "client_credentials",
            "scope": app.APP_SCOPE,
        },
    )
    if status >= 400 or not tok.get("access_token"):
        raise MicrosoftError(
            Msg("Microsoft refused the app's sign-in: {why}", why=_why(tok, status)), status
        )
    await valkey().set(
        key, tok["access_token"], ex=max(60, int(tok.get("expires_in") or 3600) - 120)
    )
    return str(tok["access_token"])


# ---------------------------------------------------------------- admin consent


async def adminconsent_url(
    db: AsyncSession, workspace_id: str, user_id: str, session_id: str, base: str
) -> str:
    cfg = await _configured(db, workspace_id)
    state = secrets.token_urlsafe(24)
    await valkey().set(
        f"msadm:{state}",
        json.dumps({"ws": workspace_id, "user": user_id, "sid": _sid(session_id)}),
        ex=STATE_TTL,
    )
    return app.adminconsent_link(cfg, base, state)


async def adminconsent_finish(
    db: AsyncSession,
    state: str,
    tenant: str,
    *,
    workspace_id: str,
    user_id: str,
    session_id: str,
    actor: str,
) -> str:
    """Microsoft says an admin of `tenant` granted the app's permissions. Recorded only in
    the browser session that started it. Returns the tenant id."""
    raw = await valkey().getdel(f"msadm:{state}") if state else None
    if not raw:
        raise MicrosoftError(
            Msg(
                "Consent was given in Microsoft, but not from this page. Press Grant admin "
                "consent on the Channels page to finish."
            )
        )
    st = json.loads(raw)
    if not _bound(st, workspace_id, user_id, session_id):
        raise MicrosoftError(
            Msg(
                "This admin consent was started by someone else or in another browser. "
                "Start again from the Channels page."
            )
        )
    tenant = (tenant or "").strip()
    if not app.valid_tenant(tenant) or tenant in app.MULTI_TENANT:
        raise MicrosoftError(Msg("Microsoft did not say which tenant gave consent."))
    await app.update(
        db,
        workspace_id,
        actor,
        admin_tenant=tenant,
        admin_consented_at=datetime.now(UTC).isoformat(),
    )
    return tenant
