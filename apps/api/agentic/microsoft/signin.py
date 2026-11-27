"""P63: "Sign in with Microsoft": signing in to the office with a work Microsoft account, which
also connects that person's Outlook, calendar and Teams in the same step.

Flow: authorization code with PKCE and a nonce, against the workspace's own app (Channels >
Microsoft 365), returning to the SAME redirect URI the Outlook connection uses (so the app
registration needs nothing new). The state lives in Valkey as `mslogin:{state}` (10 min), which
is how the callback tells a sign-in from a connection (`msauth:`).

Who gets in (never anyone new: people are added by an admin first, as before):
1. A member of the workspace whose sign-in email is the account's `mail` or
   `userPrincipalName` from Graph /me (both set by the organisation's admin; the id token's
   optional `email` claim is not trusted, it can be unverified), else
2. the one person who connected this Microsoft account (same tenant + object id), for someone
   whose office email differs from their Microsoft one.
P116: the sign-in email comes first. A Microsoft account connected by someone else (a test
account, or a shared work mailbox several people connected) never takes a person's sign-in:
when more than one person connected it and none signs in with it, the sign-in is refused and
they use their own email and password.
The account must come from the company's own Microsoft organisation: the tenant the app is
registered for (Microsoft enforces it on a single-tenant app), or with a multi-tenant app the
tenant an admin consented in or that members already connected from.

Two-step sign-in: someone who set it up here still enters their code, unless Microsoft says it
did multi-factor itself (`amr` has "mfa").

P133 (Fitri, 26 Nov 2026: "allow all kinds of domain to log in with Microsoft", e.g. staff on
@outlook.com): when the owner allows personal Microsoft accounts (Channels > Microsoft 365, the P124
switch) on a multi-tenant app, someone whose email is not on the company's own Microsoft
organisation signs in through "common" (any organisation, and personal Microsoft accounts) asking
only who they are (SIGN_IN_ONLY: no mailbox, so a personal account can consent). They are still
only ever a member already here, matched only by the address Microsoft vouches for: the user
principal name (a domain verified in one organisation only), and for a personal account its sign-in
email. The `mail` attribute, which another organisation's admin may set to anything, is trusted
only from the company's own organisations.
"""

import base64
import hashlib
import json
import secrets
import urllib.parse
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.valkey import valkey
from ..i18n import Msg
from ..models import Membership, MicrosoftAccount, User, Workspace
from . import access, app, auth
from .errors import MicrosoftError

STATE_TTL = 600
PREFIX = "mslogin:"


class SignInError(MicrosoftError):
    pass


class EmailNeeded(SignInError):
    """More than one office here uses Microsoft sign-in: which one is told by the email."""


@dataclass
class SignedIn:
    user: User
    membership: Membership
    mfa: bool  # Microsoft did multi-factor for this sign-in
    account: MicrosoftAccount | None  # their Outlook / Teams connection, saved too
    email: str
    next: str


async def offices(db: AsyncSession) -> list[tuple[str, app.AppConfig]]:
    """The workspaces whose people may sign in with Microsoft (set up, and not turned off)."""
    out = []
    for ws_id in (await db.scalars(select(Workspace.id).order_by(Workspace.created_at))).all():
        cfg = await app.load(db, ws_id)
        if cfg.configured and cfg.sign_in:
            out.append((ws_id, cfg))
    return out


async def _office_for(db: AsyncSession, email: str) -> tuple[str, app.AppConfig]:
    found = await offices(db)
    if not found:
        raise SignInError(Msg("Sign in with Microsoft is not set up here yet."))
    email = email.strip().lower()
    if email:
        user = await db.scalar(select(User).where(User.email == email))
        if user is not None:
            mine = set(
                (
                    await db.scalars(
                        select(Membership.workspace_id).where(Membership.user_id == user.id)
                    )
                ).all()
            )
            for ws_id, cfg in found:
                if ws_id in mine:
                    return ws_id, cfg
    if len(found) == 1:
        return found[0]
    raise EmailNeeded(Msg("Enter your work email first, then press Sign in with Microsoft."))


def _pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(verifier.encode()).digest()
    return verifier, base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


async def start(db: AsyncSession, base: str, email: str = "", next_path: str = "") -> str:
    """Microsoft's sign-in page for this office."""
    ws_id, cfg = await _office_for(db, email)
    # P80: a person who allowed SharePoint for the Library keeps it (asked for again here); no
    # one else is ever asked for file reading at sign-in.
    known = (
        await db.scalar(select(User.id).where(User.email == email.strip().lower()))
        if email.strip()
        else None
    )
    scope = await auth.scopes_for(db, cfg, ws_id, known, False)
    authority = cfg.tenant
    domain = email.strip().lower().rsplit("@", 1)[-1] if "@" in email else ""
    if open_to_all(cfg) and domain and domain not in await own_domains(db, ws_id, cfg):
        # P133: outside the company's own organisation (another company, or @outlook.com).
        scope, authority = SIGN_IN_ONLY, app.COMMON
    state, nonce = secrets.token_urlsafe(24), secrets.token_urlsafe(16)
    verifier, challenge = _pkce()
    redirect = app.redirect_uri(base)
    await valkey().set(
        PREFIX + state,
        json.dumps(
            {
                "ws": ws_id,
                "verifier": verifier,
                "nonce": nonce,
                "redirect": redirect,
                "next": next_path,
                "scope": scope,
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
        "nonce": nonce,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "prompt": "select_account",
    }
    if email.strip():
        q["login_hint"] = email.strip()
    return f"{app.LOGIN}/{authority}/oauth2/v2.0/authorize?{urllib.parse.urlencode(q)}"


SIGN_IN_ONLY = "openid profile email offline_access User.Read"
# Microsoft's tenant id for personal accounts (outlook.com, hotmail.com, live.com...).
CONSUMERS_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad"
# Personal Microsoft account domains: never an organisation's own, even when such people were
# invited into the company's organisation as guests (their MicrosoftAccount rows carry its tenant).
CONSUMER_DOMAINS = frozenset({
    "outlook.com", "hotmail.com", "live.com", "msn.com", "passport.com",
    "outlook.my", "hotmail.my", "live.com.my", "outlook.sg", "hotmail.co.uk", "outlook.co.id",
})  # fmt: skip


def open_to_all(cfg: app.AppConfig) -> bool:
    """Any Microsoft account (another organisation or a personal one) may sign in a member."""
    return cfg.personal_accounts and cfg.multi_tenant


async def own_domains(db: AsyncSession, ws_id: str, cfg: app.AppConfig) -> set[str]:
    """Email domains of the company's own Microsoft organisations (people connected from them)."""
    tenants = await allowed_tenants(db, ws_id, cfg)
    if not tenants:
        return set()
    rows = (
        await db.scalars(
            select(MicrosoftAccount.email).where(
                MicrosoftAccount.workspace_id == ws_id, MicrosoftAccount.tenant_id.in_(tenants)
            )
        )
    ).all()
    return {e.rsplit("@", 1)[-1].lower() for e in rows if e and "@" in e} - CONSUMER_DOMAINS


async def is_sign_in(state: str) -> bool:
    return bool(state) and bool(await valkey().exists(PREFIX + state))


async def drop(state: str) -> None:
    await valkey().delete(PREFIX + state)


async def slow_down(ip: str) -> bool:
    """At most 20 sign-in starts a minute from one address (each keeps a state for 10 min)."""
    key = f"mslogin-rate:{ip}"
    try:
        n = await valkey().incr(key)
        if n == 1:
            await valkey().expire(key, 60)
    except Exception:  # noqa: BLE001 - no cache: no limit
        return False
    return n > 20


async def allowed_tenants(db: AsyncSession, ws_id: str, cfg: app.AppConfig) -> set[str]:
    """With a multi-tenant app: the company's own organisations (consented, or already used)."""
    seen = (
        await db.scalars(
            select(MicrosoftAccount.tenant_id).where(
                MicrosoftAccount.workspace_id == ws_id, MicrosoftAccount.tenant_id != ""
            )
        )
    ).all()
    return {t for t in [cfg.admin_tenant, *seen] if t}


async def finish(db: AsyncSession, state: str, code: str) -> SignedIn:
    raw = await valkey().getdel(PREFIX + state) if state else None
    if not raw:
        raise SignInError(
            Msg("That Microsoft sign-in expired. Press Sign in with Microsoft again.")
        )
    st = json.loads(raw)
    ws_id = st["ws"]
    cfg = await app.load(db, ws_id)
    if not (cfg.configured and cfg.sign_in):
        raise SignInError(Msg("Sign in with Microsoft is not set up here yet."))
    status, tok = await auth._token_call(  # noqa: SLF001 - same module family
        str(st.get("authority") or cfg.tenant),
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
        raise SignInError(
            Msg("Microsoft refused the sign-in: {why}", why=auth._why(tok, status))  # noqa: SLF001
        )
    claims = auth._claims(str(tok.get("id_token") or ""))  # noqa: SLF001
    if not claims or claims.get("nonce") != st["nonce"] or claims.get("aud") != cfg.client_id:
        raise SignInError(Msg("Microsoft's answer could not be checked. Try again."))
    tid, oid = str(claims.get("tid") or ""), str(claims.get("oid") or "")
    own = not cfg.multi_tenant or tid in await allowed_tenants(db, ws_id, cfg)
    if not own and not open_to_all(cfg):
        raise SignInError(
            Msg(
                "This Microsoft organisation is not linked to the office. An admin links it on "
                "Channels > Microsoft 365 (Grant company-wide access)."
            )
        )
    profile = await auth.profile_of(tok)
    oid = str(profile.get("id") or oid)
    emails = [str(profile.get(k) or "").strip().lower() for k in ("mail", "userPrincipalName")] + [
        str(claims.get("preferred_username") or "").strip().lower()
    ]
    shown = next((e for e in emails if e), "")

    user: User | None = None
    # Only the organisation-managed addresses (the first two); preferred_username is the UPN
    # on work accounts, kept only for the message below. P133: from any other organisation only
    # the user principal name (a verified domain), and a personal account's own sign-in email.
    if own:
        trusted = [x for x in emails[:2] if x]
    else:
        trusted = [x for x in emails[1:2] if x]
        if tid == CONSUMERS_TENANT and emails[2]:
            trusted.append(emails[2])
    for e in trusted:
        user = await db.scalar(
            select(User)
            .join(Membership, Membership.user_id == User.id)
            .where(User.email == e, Membership.workspace_id == ws_id)
        )
        if user is not None:
            break
    if user is None and oid:
        holders = (
            await db.scalars(
                select(MicrosoftAccount.user_id).where(
                    MicrosoftAccount.workspace_id == ws_id,
                    MicrosoftAccount.tenant_id == tid,
                    MicrosoftAccount.ms_user_id == oid,
                    MicrosoftAccount.status.not_in(("disconnected", "pending")),
                )
            )
        ).all()
        if len(set(holders)) > 1:
            raise SignInError(
                Msg(
                    "{email} is a shared Microsoft account: several people here connected it, so "
                    "it cannot tell who you are. Sign in with your own email and password.",
                    email=shown or "This Microsoft account",
                )
            )
        if holders:
            user = await db.get(User, holders[0])
    if user is None:
        raise SignInError(
            Msg(
                "No one with {email} is in this office yet. Ask your admin to add you, then sign "
                "in with Microsoft again.",
                email=shown or "this Microsoft account",
            )
        )
    if not user.is_active:
        raise SignInError(Msg("This account is disabled."))
    membership = await db.get(Membership, (ws_id, user.id))
    assert membership is not None

    connected: MicrosoftAccount | None = None
    if (
        tok.get("refresh_token")
        and auth.has_scope(str(tok.get("scope") or ""), "Mail.ReadWrite")
        and await access.may_connect_personal(db, ws_id, user.id, membership.role)
    ):
        connected = await auth.store(db, ws_id, user.id, tok, profile)
        membership = await db.get(Membership, (ws_id, user.id))  # store() committed
        user = await db.get(User, user.id)
        assert membership is not None and user is not None
    # P66: the verified account, for Prima (agentic/prima links its staff by object ID).
    # P145c: never one of their EXTRA accounts (a work mailbox kept beside their own account
    # when their sign-in email became a personal one): it signs them in, it is not who they are.
    extra = (
        await db.scalar(
            select(MicrosoftAccount.id).where(
                MicrosoftAccount.workspace_id == ws_id,
                MicrosoftAccount.user_id == user.id,
                MicrosoftAccount.ms_user_id == oid,
                MicrosoftAccount.is_primary.is_(False),
            )
        )
        if oid
        else None
    )
    if (
        oid
        and tid
        and extra is None
        and (membership.ms_oid, membership.ms_tenant_id) != (oid, tid)
        and await auth.own_microsoft(db, ws_id, user.id, oid, trusted)
    ):
        membership.ms_oid, membership.ms_tenant_id = oid, tid
        await db.commit()
        membership = await db.get(Membership, (ws_id, user.id))
        user = await db.get(User, user.id)
        assert membership is not None and user is not None
    amr = claims.get("amr") or []
    return SignedIn(
        user=user,
        membership=membership,
        mfa=isinstance(amr, list) and "mfa" in amr,
        account=connected,
        email=shown,
        next=str(st.get("next") or ""),
    )
