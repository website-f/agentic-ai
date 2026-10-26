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

    @property
    def configured(self) -> bool:
        return bool(self.client_id and self.client_secret)

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
