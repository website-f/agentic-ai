"""P63: "Sign in with Microsoft": signing in to the office with a work Microsoft account, which
also connects that person's Outlook, calendar and Teams in the same step.

Flow: authorization code with PKCE and a nonce, against the workspace's own app (Channels >
Microsoft 365), returning to the SAME redirect URI the Outlook connection uses (so the app
registration needs nothing new). The state lives in Valkey as `mslogin:{state}` (10 min), which
is how the callback tells a sign-in from a connection (`msauth:`).

Who gets in (never anyone new: people are added by an admin first, as before):
1. The Microsoft account this person connected before (same tenant + object id), else
2. a member of the workspace whose email is the account's `mail` or `userPrincipalName` from
   Graph /me (both set by the organisation's admin; the id token's optional `email` claim is
   not trusted, it can be unverified).
The account must come from the company's own Microsoft organisation: the tenant the app is
registered for (Microsoft enforces it on a single-tenant app), or with a multi-tenant app the
tenant an admin consented in or that members already connected from.

Two-step sign-in: someone who set it up here still enters their code, unless Microsoft says it
did multi-factor itself (`amr` has "mfa").
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
            }
        ),
        ex=STATE_TTL,
    )
    q = {
        "client_id": cfg.client_id,
        "response_type": "code",
        "redirect_uri": redirect,
        "response_mode": "query",
        "scope": cfg.scopes,
        "state": state,
        "nonce": nonce,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "prompt": "select_account",
    }
    if email.strip():
        q["login_hint"] = email.strip()
    return f"{app.LOGIN}/{cfg.tenant}/oauth2/v2.0/authorize?{urllib.parse.urlencode(q)}"


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
        cfg.tenant,
        {
            "client_id": cfg.client_id,
            "client_secret": cfg.client_secret,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": st["redirect"],
            "code_verifier": st["verifier"],
            "scope": cfg.scopes,
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
    if cfg.multi_tenant and tid not in await allowed_tenants(db, ws_id, cfg):
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
    acct = await db.scalar(
        select(MicrosoftAccount).where(
            MicrosoftAccount.workspace_id == ws_id,
            MicrosoftAccount.tenant_id == tid,
            MicrosoftAccount.ms_user_id == oid,
            MicrosoftAccount.status != "disconnected",
        )
    )
    if acct is not None and oid:
        user = await db.get(User, acct.user_id)
    if user is None:
        # Only the organisation-managed addresses (the first two); preferred_username is the
        # UPN on work accounts, kept only for the message above.
        for e in [x for x in emails[:2] if x]:
            user = await db.scalar(
                select(User)
                .join(Membership, Membership.user_id == User.id)
                .where(User.email == e, Membership.workspace_id == ws_id)
            )
            if user is not None:
                break
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
    amr = claims.get("amr") or []
    return SignedIn(
        user=user,
        membership=membership,
        mfa=isinstance(amr, list) and "mfa" in amr,
        account=connected,
        email=shown,
        next=str(st.get("next") or ""),
    )
