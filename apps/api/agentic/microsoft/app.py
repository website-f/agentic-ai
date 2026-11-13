"""The workspace's Microsoft Entra ID app and its public addresses.

Stored as `Integration(kind="microsoft")`, envelope-encrypted JSON:
  client_id, client_secret          the app registration (secret is write-only in the API)
  tenant                            "organizations" (any work/school tenant, the default) or
                                    one tenant's GUID or domain
  admin_tenant, admin_consented_at  the customer tenant an admin granted app permissions in
                                    (admin-consent step), for app-only (shared mailbox)
                                    tokens when `tenant` is "organizations"
  public_base                       the last public https address seen in a request, so the
                                    worker (which has no request) can (re)create webhooks
Without a dashboard app, AGENTIC_MS_CLIENT_ID / _SECRET / _TENANT are used.
"""

import ipaddress
import json
import re
import urllib.parse
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core import crypto
from ..core.config import settings
from ..models import Integration

KIND = "microsoft"
LOGIN = "https://login.microsoftonline.com"
MULTI_TENANT = frozenset({"organizations", "common"})
DEFAULT_TENANT = "organizations"
# Delegated: a person's own mailbox and calendar. offline_access gives the refresh token.
# P52: and their own Teams chats (read, send), teams and channels. All of these a person may
# consent to themselves (no admin consent needed).
DELEGATED_SCOPES = (
    "openid profile email offline_access User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite"
    " Chat.Read ChatMessage.Send Team.ReadBasic.All Channel.ReadBasic.All"
)
TEAMS_SCOPES = ("Chat.Read", "ChatMessage.Send", "Team.ReadBasic.All", "Channel.ReadBasic.All")
# P80: read (never write) the SharePoint and OneDrive files a person can already open, so the
# Library can learn from a folder they link. Never part of everyone's sign-in (a tenant that
# lets users consent only to low-risk permissions would stop every sign-in at "needs admin
# approval"): asked for only by the Library's "Reconnect Microsoft 365 to allow SharePoint",
# and from then on in that person's own sign-ins and refreshes (auth.scopes_for,
# auth.refresh_scopes).
FILES_SCOPES = ("Files.Read.All", "Sites.Read.All")


# P102: start a new one-to-one Teams chat with anyone in the organisation (Graph POST /chats),
# so the AI can draft a Teams message to someone the person has never chatted with. A person
# may consent to it themselves, but it is never part of everyone's sign-in: asking for it would
# make every existing connection's token refresh fail until they sign in again, and could stop
# sign-in where an admin approved the office's permissions for everyone. Asked for only by the
# Teams tab's "Allow new Teams chats", and from then on in that person's own sign-ins and
# refreshes (like FILES_SCOPES). Replying in a chat that already exists never needs it.
CHAT_CREATE = "Chat.Create"
# Scopes a person adds for themselves with a reconnect; kept only while they have them.
OPT_IN_SCOPES = (*FILES_SCOPES, CHAT_CREATE)


def with_scopes(scopes: str, extra: tuple[str, ...]) -> str:
    """The scopes plus `extra` (each once)."""
    have = scopes.split()
    return " ".join(have + [s for s in extra if s not in have])


def with_files(scopes: str) -> str:
    """The scopes plus the file-reading ones (once)."""
    return with_scopes(scopes, FILES_SCOPES)


def with_new_chats(scopes: str) -> str:
    """P102: the scopes plus starting new Teams chats (once)."""
    return with_scopes(scopes, (CHAT_CREATE,))


# P63: the posts in the Teams channels a person belongs to. Only an admin may consent to it,
# so it is asked for only once the Channels page says an admin granted it (asking for it
# before would stop everyone's sign-in at "needs admin approval").
CHANNEL_SCOPE = "ChannelMessage.Read.All"
APP_SCOPE = "https://graph.microsoft.com/.default"  # app-only: whatever the admin granted

CALLBACK_PATH = "/api/integrations/microsoft/callback"
NOTIFY_PATH = "/api/integrations/microsoft/notify"
ADMINCONSENT_PATH = "/api/integrations/microsoft/adminconsent"

_GUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_DOMAIN = re.compile(r"^(?=.{4,253}$)([a-zA-Z0-9-]{1,63}\.)+[a-zA-Z]{2,63}$")


def valid_client_id(v: str) -> bool:
    return bool(_GUID.match(v.strip()))


def valid_tenant(v: str) -> bool:
    v = v.strip()
    return v in MULTI_TENANT or bool(_GUID.match(v)) or bool(_DOMAIN.match(v))


@dataclass
class AppConfig:
    client_id: str = ""
    client_secret: str = ""
    tenant: str = DEFAULT_TENANT
    admin_tenant: str = ""
    admin_consented_at: str = ""
    public_base: str = ""
    source: str = ""  # dashboard | env | "" (none)
    # P63: "Sign in with Microsoft" on the sign-in page (on unless an admin turns it off).
    sign_in: bool = True
    # P63: an admin granted ChannelMessage.Read.All, so it is asked for (Teams channel posts).
    teams_channels: bool = False

    @property
    def configured(self) -> bool:
        return bool(self.client_id and self.client_secret)

    @property
    def scopes(self) -> str:
        """The delegated scopes a person's sign-in asks for."""
        return DELEGATED_SCOPES + (f" {CHANNEL_SCOPE}" if self.teams_channels else "")

    @property
    def multi_tenant(self) -> bool:
        return self.tenant in MULTI_TENANT

    def app_tenant(self) -> str | None:
        """The tenant app-only (client credentials) tokens are asked from: the configured
        tenant when it is a specific one, else the tenant an admin consented in."""
        if not self.multi_tenant:
            return self.tenant
        return self.admin_tenant or None


async def _row(db: AsyncSession, workspace_id: str) -> Integration | None:
    return await db.scalar(
        select(Integration).where(
            Integration.workspace_id == workspace_id, Integration.kind == KIND
        )
    )


def _data(row: Integration | None) -> dict[str, Any]:
    if row is None or not row.config_enc:
        return {}
    try:
        return json.loads(crypto.decrypt(row.config_enc, row.aad))
    except (crypto.DecryptError, ValueError):
        return {}


async def load(db: AsyncSession, workspace_id: str) -> AppConfig:
    """The app as configured: the dashboard's, else the environment's."""
    data = _data(await _row(db, workspace_id))
    cfg = AppConfig(
        admin_tenant=str(data.get("admin_tenant") or ""),
        admin_consented_at=str(data.get("admin_consented_at") or ""),
        public_base=str(data.get("public_base") or ""),
        sign_in=data.get("sign_in") is not False,
        teams_channels=data.get("teams_channels") is True,
    )
    if data.get("client_id") and data.get("client_secret"):
        cfg.client_id, cfg.client_secret = data["client_id"], data["client_secret"]
        cfg.tenant = data.get("tenant") or DEFAULT_TENANT
        cfg.source = "dashboard"
    elif settings.ms_client_id and settings.ms_client_secret:
        cfg.client_id, cfg.client_secret = settings.ms_client_id, settings.ms_client_secret
        cfg.tenant = (settings.ms_tenant or DEFAULT_TENANT).strip()
        cfg.source = "env"
    return cfg


async def update(db: AsyncSession, workspace_id: str, actor: str, **changes: Any) -> Integration:
    """Merge `changes` into the stored JSON (None removes a key). The caller commits."""
    row = await _row(db, workspace_id)
    if row is None:
        row = Integration(workspace_id=workspace_id, kind=KIND)
        db.add(row)
        await db.flush()
    data = _data(row)
    for k, v in changes.items():
        if v is None:
            data.pop(k, None)
        else:
            data[k] = v
    row.config_enc = crypto.encrypt(json.dumps(data), row.aad)
    row.updated_by = actor
    return row


# ---------------------------------------------------------------- public addresses


def request_base(headers: Mapping[str, str], scheme: str) -> str:
    """Where people reach this server: AGENTIC_PUBLIC_URL, else the request's own address
    (X-Forwarded-Proto / X-Forwarded-Host behind a proxy)."""
    from ..devices.core import public_base

    return public_base(headers, scheme)


_PRIVATE_SUFFIXES = (".localhost", ".local", ".internal", ".lan", ".home.arpa", ".localdomain")


def webhooks_ok(base: str) -> bool:
    """Graph only calls public https endpoints: no http, no localhost, no private address."""
    try:
        u = urllib.parse.urlsplit(base)
    except ValueError:
        return False
    host = (u.hostname or "").lower()
    if u.scheme != "https" or not host:
        return False
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return "." in host and host != "localhost" and not host.endswith(_PRIVATE_SUFFIXES)
    return not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved)


def redirect_uri(base: str) -> str:
    return base.rstrip("/") + CALLBACK_PATH


def notify_url(base: str) -> str:
    return base.rstrip("/") + NOTIFY_PATH


def adminconsent_redirect(base: str) -> str:
    return base.rstrip("/") + ADMINCONSENT_PATH


def adminconsent_link(cfg: AppConfig, base: str, state: str | None = None) -> str:
    """Microsoft's admin-consent page for this app. Without `state` it can be handed to a
    customer's Microsoft 365 admin to grant access; the tenant is recorded only when an
    admin finishes it from the Channels page (bound state)."""
    q = {
        "client_id": cfg.client_id,
        "redirect_uri": adminconsent_redirect(base),
        "scope": APP_SCOPE,
    }
    if state:
        q["state"] = state
    tenant = cfg.tenant if not cfg.multi_tenant else "organizations"
    return f"{LOGIN}/{tenant}/v2.0/adminconsent?{urllib.parse.urlencode(q)}"


async def remember_base(db: AsyncSession, workspace_id: str, base: str, actor: str) -> bool:
    """Keep a public https base for the worker. True when it changed (the caller commits)."""
    if not webhooks_ok(base):
        return False
    cfg = await load(db, workspace_id)
    if cfg.public_base == base:
        return False
    await update(db, workspace_id, actor, public_base=base)
    return True


def _explicit_base() -> str | None:
    if "public_url" in settings.model_fields_set and settings.public_url:
        return settings.public_url.rstrip("/")
    return None


async def worker_base(db: AsyncSession, workspace_id: str) -> str:
    """The public base outside a request (the worker): AGENTIC_PUBLIC_URL, else the last
    public https base a request showed, else the default (no webhooks: polling)."""
    explicit = _explicit_base()
    if explicit:
        return explicit
    cfg = await load(db, workspace_id)
    return cfg.public_base or settings.public_url.rstrip("/")
