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

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core import crypto
from ..core.valkey import valkey
from ..i18n import Msg
from ..models import MailItem, MailSubscription, Membership, MicrosoftAccount
from . import app, http
from .errors import MicrosoftError, NotConfigured, ReconnectNeeded

STATE_TTL = 600
MAX_EXTRA_ACCOUNTS = 5  # P118: extra accounts beside the main one
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


async def scopes_for(
    db: AsyncSession,
    cfg: app.AppConfig,
    workspace_id: str,
    user_id: str | None,
    files: bool,
    chats: bool = False,
) -> str:
    """P80: what a person's sign-in asks for: the office's scopes, plus file reading when they
    asked for it now (`files`) or granted it before (so it is never lost on a later sign-in).
    P102: the same for starting new Teams chats (`chats`, app.CHAT_CREATE)."""
    if (not files or not chats) and user_id:
        acct = await db.scalar(
            select(MicrosoftAccount).where(
                MicrosoftAccount.workspace_id == workspace_id,
                MicrosoftAccount.user_id == user_id,
                MicrosoftAccount.is_primary.is_(True),
            )
        )
        granted = acct.scopes if acct is not None else ""
        files = files or has_scope(granted, app.FILES_SCOPES[0])
        chats = chats or has_scope(granted, app.CHAT_CREATE)
    scope = app.with_files(cfg.scopes) if files else cfg.scopes
    scope = app.with_new_chats(scope) if chats else scope
    if cfg.multi_tenant and not await _in_consented_tenant(db, cfg, workspace_id, user_id):
        scope = app.without(scope, app.ADMIN_ONLY_SCOPES)
    return scope


async def _in_consented_tenant(
    db: AsyncSession, cfg: app.AppConfig, workspace_id: str, user_id: str | None
) -> bool:
    """P124: whether this person's Microsoft 365 organisation is the one whose admin approved
    the office's permissions (cfg.admin_tenant). Known from their own sign-in (their
    membership's tenant), else from colleagues on the same email domain who signed in from it.
    Someone of another organisation is never asked for the admin-only permissions, so their
    sign-in does not stop at "Need admin approval" over them."""
    tenant = (cfg.admin_tenant or "").lower()
    if not tenant or not user_id:
        return False
    from ..models import User

    m = await db.get(Membership, (workspace_id, user_id))
    if m is not None and m.ms_tenant_id:
        return m.ms_tenant_id.lower() == tenant
    user = await db.get(User, user_id)
    domain = (
        user.email.rsplit("@", 1)[-1] if user is not None and "@" in user.email else ""
    ).lower()
    if not domain:
        return False
    same = await db.scalar(
        select(func.count())
        .select_from(Membership)
        .join(User, User.id == Membership.user_id)
        .where(
            Membership.workspace_id == workspace_id,
            func.lower(Membership.ms_tenant_id) == tenant,
            func.lower(User.email).like(f"%@{domain}"),
        )
    )
    return bool(same)


async def auth_url(
    db: AsyncSession,
    workspace_id: str,
    user_id: str,
    session_id: str,
    base: str,
    *,
    with_files: bool = False,
    with_new_chats: bool = False,
    another: bool = False,
) -> str:
    """Microsoft's sign-in page for this person. P118: `another` connects an extra account
    (personal or shared) beside their main one. `base` is the public address the callback
    returns to; it is remembered in the state so the token call uses the same one. P80:
    `with_files` also asks to read their SharePoint / OneDrive files (the Library). P102:
    `with_new_chats` also asks to start new Teams chats (the Teams tab)."""
    cfg = await _configured(db, workspace_id)
    if another:
        # P124: an extra account asks for mail and calendar only, through "common" when the
        # owner allowed personal Microsoft accounts (and the app is multi-tenant).
        scope = app.EXTRA_SCOPES
        authority = app.COMMON if cfg.personal_accounts and cfg.multi_tenant else cfg.tenant
    else:
        scope = await scopes_for(db, cfg, workspace_id, user_id, with_files, with_new_chats)
        authority = cfg.tenant
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
                "scope": scope,
                "files": with_files,
                "chats": with_new_chats,
                "another": another,
                "authority": authority,
            }
        ),
        ex=STATE_TTL,
    )
    q = {
        "client_id": cfg.client_id,
        "response_type": "code",
        "redirect_uri": redirect,
        "response_mode": "query",
        "scope": scope,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "prompt": "select_account",
    }
    return f"{app.LOGIN}/{authority}/oauth2/v2.0/authorize?{urllib.parse.urlencode(q)}"


async def _started(state: str, key: str) -> bool:
    raw = await valkey().get(f"msauth:{state}") if state else None
    try:
        return bool(raw and json.loads(raw).get(key))
    except ValueError:
        return False


async def started_with_files(state: str) -> bool:
    """P80: was this connect started by the Library's "allow SharePoint" (with_files)?"""
    return await _started(state, "files")


async def started_another(state: str) -> bool:
    """P118: was this connect "Add another Microsoft account"?"""
    return await _started(state, "another")


async def started_with_new_chats(state: str) -> bool:
    """P102: was this connect started by the Teams tab's "Allow new Teams chats"?"""
    return await _started(state, "chats")


async def drop_state(state: str) -> None:
    if state:
        await valkey().delete(f"msauth:{state}")


async def finish(
    db: AsyncSession,
    state: str,
    code: str,
    *,
    workspace_id: str,
    user_id: str,
    session_id: str,
    hold: bool = False,
    hold_main: bool = False,
) -> MicrosoftAccount:
    """The callback: trade the code for tokens and remember the mailbox (one per person).
    Only in the browser session that started it (P29). `hold` (P124): a new extra account
    starts pending (the caller decides whether it waits for approval); `hold_main`: so does
    a main account that is not the person's own identity (`own_identity`)."""
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
        st.get("authority") or cfg.tenant,  # P124: the authority the sign-in used
        {
            "client_id": cfg.client_id,
            "client_secret": cfg.client_secret,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": st["redirect"],
            "code_verifier": st["verifier"],
            "scope": st.get("scope") or cfg.scopes,
        },
    )
    if status >= 400 or not tok.get("access_token"):
        raise MicrosoftError(Msg("Microsoft refused the sign-in: {why}", why=_why(tok, status)))
    if not tok.get("refresh_token"):
        raise MicrosoftError(
            Msg("Microsoft gave no refresh token. Connect again and accept all the permissions.")
        )
    if not has_scope(str(tok.get("scope") or ""), "Mail.ReadWrite"):
        raise MicrosoftError(
            Msg("Mail access was not granted. Accept the mail permissions on Microsoft's screen.")
        )
    return await store(
        db,
        workspace_id,
        user_id,
        tok,
        await profile_of(tok),
        another=bool(st.get("another")),
        hold=hold,
        hold_main=hold_main,
    )


async def profile_of(tok: dict[str, Any]) -> dict[str, Any]:
    """The signed-in person's /me (id, mail, userPrincipalName, displayName), or {}."""
    from .graph import Graph

    async def fixed(_force: bool = False) -> str:
        return tok["access_token"]

    try:
        return await Graph(fixed, "/me").me()
    except MicrosoftError:
        return {}


async def store(
    db: AsyncSession,
    workspace_id: str,
    user_id: str,
    tok: dict[str, Any],
    profile: dict[str, Any],
    *,
    another: bool = False,
    hold: bool = False,
    hold_main: bool = False,
) -> MicrosoftAccount:
    """Keep this person's connection: its refresh token, encrypted. Commits. P118: their main
    account, or with `another` an extra one beside it (the same Microsoft account connected
    again updates its own row either way). P124: with `hold`, a NEW extra account starts
    'pending' (unused until approved, org/work_mail.py); one that waits keeps waiting. With
    `hold_main`, the main account is 'pending' too unless it is the person's own identity
    (`own_identity`); a pending main account is never linked to Prima."""
    granted = str(tok.get("scope") or "")
    claims = _claims(str(tok.get("id_token") or ""))
    oid = str(profile.get("id") or claims.get("oid") or "")[:80]
    mine = select(MicrosoftAccount).where(
        MicrosoftAccount.workspace_id == workspace_id, MicrosoftAccount.user_id == user_id
    )
    acct = await db.scalar(mine.where(MicrosoftAccount.ms_user_id == oid)) if oid else None
    fresh = False
    if acct is None and another:
        extra = await db.scalar(
            select(func.count())
            .select_from(MicrosoftAccount)
            .where(
                MicrosoftAccount.workspace_id == workspace_id,
                MicrosoftAccount.user_id == user_id,
                MicrosoftAccount.is_primary.is_(False),
            )
        )
        if int(extra or 0) >= MAX_EXTRA_ACCOUNTS:
            raise MicrosoftError(
                Msg(
                    "You already connected {n} more Microsoft accounts. Remove one on the "
                    "Microsoft 365 page first.",
                    n=MAX_EXTRA_ACCOUNTS,
                )
            )
        acct = MicrosoftAccount(workspace_id=workspace_id, user_id=user_id, is_primary=False)
        db.add(acct)
        await db.flush()
        fresh = True
    if acct is None:
        acct = await db.scalar(mine.where(MicrosoftAccount.is_primary.is_(True)))
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
    had_files = has_scope(acct.scopes or "", app.FILES_SCOPES[0])
    if had_files and not changed_mailbox and not has_scope(granted, app.FILES_SCOPES[0]):
        # P80: a sign-in that did not ask for file reading (no email to know them by) does not
        # take back what this person granted for the Library; the next refresh asks for it,
        # and drops it if it was withdrawn (access_token).
        granted = app.with_files(granted)
    had_chats = has_scope(acct.scopes or "", app.CHAT_CREATE)
    if had_chats and not changed_mailbox and not has_scope(granted, app.CHAT_CREATE):
        granted = app.with_new_chats(granted)  # P102: the same for new Teams chats
    acct.scopes = granted
    acct.token_enc = crypto.encrypt(tok["refresh_token"], acct.aad)
    member = await db.get(Membership, (workspace_id, user_id))
    if acct.is_primary:
        waits = hold_main and not await own_identity(db, member, acct)
    else:
        waits = acct.status == "pending" or (fresh and hold)
    acct.status, acct.last_error = ("pending" if waits else "connected"), None
    if changed_mailbox:
        # Another Microsoft account than before: nothing of the old mailbox stays, and its
        # sync starts afresh. (Its old subscription cannot be deleted with this account's
        # token; it lapses at Microsoft and its notifications are ignored here.)
        await db.execute(delete(MailItem).where(MailItem.account_id == acct.id))
        await db.execute(delete(MailSubscription).where(MailSubscription.account_id == acct.id))
        acct.delta_link = None
        acct.last_sync_at = None
    if acct.status != "pending":  # P124: a waiting main account is never linked
        await link_member(
            db,
            member,
            acct,
            [str(profile.get(k) or "").strip().lower() for k in ("mail", "userPrincipalName")],
        )
    await db.commit()
    if acct.status != "pending":  # P124: a waiting account's token is not used
        await _cache(acct.id, tok)
    return acct


async def link_member(
    db: AsyncSession, member: Membership | None, acct: MicrosoftAccount, emails: list[str]
) -> None:
    """P66: the same verified account, for Prima (agentic/prima). P116: only when it is the
    person's own (not a shared work mailbox or someone else's account they connected)."""
    if (
        member is not None
        and acct.is_primary
        and acct.ms_user_id
        and acct.tenant_id
        and await own_microsoft(db, member.workspace_id, member.user_id, acct.ms_user_id, emails)
    ):
        member.ms_oid, member.ms_tenant_id = acct.ms_user_id, acct.tenant_id


async def own_identity(db: AsyncSession, member: Membership | None, acct: MicrosoftAccount) -> bool:
    """P124: the connected account is the person's own Microsoft identity: its object id is
    their membership's ms_oid (their own Microsoft sign-in, P66/P115), or, with none recorded
    yet, its address is their office sign-in email."""
    if member is None:
        return False
    if member.ms_oid:
        return bool(acct.ms_user_id) and acct.ms_user_id == member.ms_oid
    from ..models import User

    user = await db.get(User, member.user_id)
    login = (user.email if user else "").strip().lower()
    return bool(login) and (acct.email or "").strip().lower() == login


async def own_microsoft(
    db: AsyncSession, workspace_id: str, user_id: str, oid: str, emails: list[str]
) -> bool:
    """P116: is this Microsoft account the person's own? Not when its address is another
    member's sign-in email, nor when another member is already linked to it (a shared work
    mailbox, or someone else's account connected from a test account)."""
    from ..models import User

    mine = [e for e in emails if e]
    if mine:
        other = await db.scalar(
            select(User.id)
            .join(Membership, Membership.user_id == User.id)
            .where(
                Membership.workspace_id == workspace_id,
                User.email.in_(mine),
                User.id != user_id,
            )
            .limit(1)
        )
        if other is not None:
            return False
    taken = await db.scalar(
        select(Membership.user_id)
        .where(
            Membership.workspace_id == workspace_id,
            Membership.ms_oid == oid,
            Membership.user_id != user_id,
        )
        .limit(1)
    )
    return taken is None


def has_scope(granted: str, scope: str) -> bool:
    """Microsoft may answer short names ("Mail.ReadWrite") or full URLs."""
    want = scope.lower()
    return any(s.rsplit("/", 1)[-1].lower() == want for s in granted.split())


def refresh_scopes(asked: str, granted: str) -> str:
    """P80: what a token refresh asks for: the office's scopes, plus Files.Read.All /
    Sites.Read.All only when this person granted them (the Library's reconnect). Asking for
    them without that grant would make Microsoft refuse the refresh and stop their mail too.
    P102: the same for Chat.Create (the Teams tab's "Allow new Teams chats")."""
    asked = " ".join(s for s in asked.split() if s not in app.OPT_IN_SCOPES)
    if has_scope(granted, app.FILES_SCOPES[0]):
        asked = app.with_files(asked)
    return app.with_new_chats(asked) if has_scope(granted, app.CHAT_CREATE) else asked


async def _cache(account_id: str, tok: dict[str, Any]) -> None:
    ttl = max(60, int(tok.get("expires_in") or 3600) - 120)
    await valkey().set(f"mstok:{account_id}", tok["access_token"], ex=ttl)


async def access_token(db: AsyncSession, acct: MicrosoftAccount, force: bool = False) -> str:
    """A valid access token for this person's mailbox: cached, else refreshed (and the
    rotated refresh token stored). `force` skips the cache (after a 401)."""
    if acct.status == "pending":  # P124: waits for approval: never used
        raise ReconnectNeeded(Msg("This email account is waiting for approval."))
    if acct.status in ("reconnect_needed", "disconnected") or not acct.token_enc:
        raise ReconnectNeeded(Msg("Outlook needs reconnecting. Connect Microsoft 365 again."))
    if not force:
        cached = await valkey().get(f"mstok:{acct.id}")
        if cached:
            return str(cached)
    cfg = await _configured(db, acct.workspace_id)
    tenant = acct.tenant_id or cfg.tenant
    want = refresh_scopes(cfg.scopes, acct.scopes)
    status, tok = await _token_call(
        tenant,
        {
            "client_id": cfg.client_id,
            "client_secret": cfg.client_secret,
            "grant_type": "refresh_token",
            "refresh_token": crypto.decrypt(acct.token_enc, acct.aad),
            "scope": want,
        },
    )
    # P63: Teams channel posts were switched on but this person's grant lacks them (no consent
    # yet); P80: their file reading was withdrawn (an admin revoked it); P102: the same for
    # starting new Teams chats. Either way, keep mail and everything else working with the
    # scopes they still have.
    for drop in (
        {app.CHANNEL_SCOPE} if cfg.teams_channels else set(),
        # P109: the same for channel posting and Teams Approvals, until the person signs in again.
        {app.CHANNEL_SEND_SCOPE} if cfg.teams_channel_send else set(),
        {app.APPROVALS_SCOPE} if cfg.teams_approvals else set(),
        set(app.FILES_SCOPES),
        {app.CHAT_CREATE},
    ):
        if str(tok.get("error") or "") not in RECONNECT_ERRORS or not drop & set(want.split()):
            continue
        want = " ".join(s for s in want.split() if s not in drop)
        status, tok = await _token_call(
            tenant,
            {
                "client_id": cfg.client_id,
                "client_secret": cfg.client_secret,
                "grant_type": "refresh_token",
                "refresh_token": crypto.decrypt(acct.token_enc, acct.aad),
                "scope": want,
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
