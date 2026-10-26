"""P34: Microsoft 365 / Outlook (Microsoft Graph only).

- The app (Channels > Microsoft 365, channels.manage): client id, write-only secret, tenant.
- A person's own Outlook: connect (OAuth + PKCE, bound to their session), status,
  disconnect. Who may connect: owns an AI twin, or has assistants.use.
- Admin consent (channels.manage): tells us the customer tenant for app-only access.
- Shared mailboxes (channels.manage): add, change, remove, test access.
- Mail activity: what arrived in a mailbox the person may see (microsoft/access.py), with
  what the AI understood and did (microsoft/features.py).
- A person's own mail preferences (digest, tasks, attachments, follow-ups): owner only.
- The Graph webhook (public): validation handshake, clientState check, queue, 202.
"""

import json
import logging
import urllib.parse
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request, Response, status
from fastapi.responses import PlainTextResponse, RedirectResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...assistants.access import may_assist
from ...core import crypto
from ...core.db import SessionLocal, get_db
from ...core.security import can
from ...i18n import render, tr
from ...microsoft import access, app, auth, graph, sync
from ...microsoft import rules as mail_rules
from ...microsoft.errors import Forbidden, MicrosoftError, NotConfigured, NotFound
from ...models import Agent, Branch, MailItem, SharedMailbox
from ...services import audit
from ..deps import Principal, api_error, optional_principal, require

router = APIRouter(tags=["microsoft"])
log = logging.getLogger("agentic.api.microsoft")

BASE = "/api/integrations/microsoft"
MAX_NOTIFY_BYTES = 1024 * 1024


def _base(request: Request) -> str:
    return app.request_base(request.headers, request.url.scheme)


def _say(e: Exception) -> str:
    """An error's sentence in the request's language."""
    return render(e.args[0] if e.args else str(e))


# ---------------------------------------------------------------- the app


class MicrosoftAppIn(BaseModel):
    client_id: str = Field(min_length=1, max_length=100)
    client_secret: str | None = Field(default=None, min_length=6, max_length=300)
    tenant: str = Field(default=app.DEFAULT_TENANT, min_length=4, max_length=253)


async def _status(db: AsyncSession, principal: Principal, base: str) -> dict[str, Any]:
    cfg = await app.load(db, principal.workspace_id)
    manage = can(principal.role, "channels.manage")
    return {
        "configured": cfg.configured,
        "client_id_hint": crypto.hint(cfg.client_id) if cfg.client_id else None,
        "tenant": cfg.tenant,
        "redirect_uri": app.redirect_uri(base),
        "notify_url": app.notify_url(base),
        "adminconsent_url": app.adminconsent_link(cfg, base) if cfg.configured else None,
        "webhooks_available": app.webhooks_ok(base),
        "can_configure": manage,
        "shared_enabled": cfg.configured and cfg.app_tenant() is not None,
        # Extra, for the Channels page: which tenant consented (managers only).
        "admin_tenant": (cfg.admin_tenant or None) if manage else None,
    }


@router.get(BASE)
async def microsoft_status(
    request: Request,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return await _status(db, principal, _base(request))


@router.put(BASE)
async def microsoft_configure(
    body: MicrosoftAppIn,
    request: Request,
    principal: Principal = Depends(require("channels.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    client_id, tenant = body.client_id.strip().lower(), body.tenant.strip()
    if not app.valid_client_id(client_id):
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "bad_client_id",
            "That is not an Application (client) ID. Copy it from the app's Overview page in "
            "Microsoft Entra ID (it looks like 1a2b3c4d-...).",
        )
    if not app.valid_tenant(tenant):
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "bad_tenant",
            "Tenant must be organizations, a Directory (tenant) ID, or a domain like "
            "contoso.onmicrosoft.com.",
        )
    before = await app.load(db, principal.workspace_id)
    stored = before if before.source == "dashboard" else app.AppConfig()
    secret = (body.client_secret or "").strip()
    if not secret and (not stored.client_secret or stored.client_id != client_id):
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "secret_required",
            "Enter the client secret (its Value, not its ID).",
        )
    changes: dict[str, Any] = {
        "client_id": client_id,
        "client_secret": secret or stored.client_secret,
        "tenant": tenant,
    }
    if before.client_id != client_id or before.tenant != tenant:
        # Consent was given to another app or tenant: it has to be given again.
        changes.update(admin_tenant=None, admin_consented_at=None)
    row = await app.update(db, principal.workspace_id, principal.actor, **changes)
    await app.remember_base(db, principal.workspace_id, _base(request), principal.actor)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "integration.updated",
        target=row.id,
        before={"kind": "microsoft", "client_id": before.client_id or None, "tenant": before.tenant}
        if before.configured
        else None,
        after={"kind": "microsoft", "client_id": client_id, "tenant": tenant,
               "secret_changed": bool(secret)},
    )  # fmt: skip
    await db.commit()
    return await _status(db, principal, _base(request))


# ---------------------------------------------------------------- a person's own Outlook


@router.post(f"{BASE}/connect")
async def microsoft_connect(
    request: Request,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    if not await access.may_connect_personal(
        db, principal.workspace_id, principal.user.id, principal.role
    ):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "no_personal_ai",
            "Connecting Outlook is for your own AI. Make your AI twin first (My AI), then "
            "connect Outlook.",
        )
    base = _base(request)
    try:
        url = await auth.auth_url(
            db, principal.workspace_id, principal.user.id, principal.session_id, base
        )
    except NotConfigured as e:
        raise api_error(status.HTTP_409_CONFLICT, "not_configured", str(e)) from e
    if await app.remember_base(db, principal.workspace_id, base, principal.actor):
        await db.commit()
    return {"url": url}


async def _home(db: AsyncSession, principal: Principal | None) -> str:
    """Where the person's own AI lives: My AI (twin), or Assistants for a manager with no
    twin."""
    if principal is not None and may_assist(principal.role):
        if not await access.has_twin(db, principal.workspace_id, principal.user.id):
            return "/assistants"
    return "/my-worker"


@router.get(f"{BASE}/callback")
async def microsoft_callback(
    background: BackgroundTasks,
    state: str = Query(default="", max_length=200),
    code: str = Query(default="", max_length=4000),
    error: str = Query(default="", max_length=200),
    error_description: str = Query(default="", max_length=1000),
    principal: Principal | None = Depends(optional_principal),
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    home = await _home(db, principal)

    def back(result: str, msg: str = "") -> RedirectResponse:
        q = urllib.parse.urlencode({"ms": result, **({"msg": msg[:200]} if msg else {})})
        return RedirectResponse(f"{home}?{q}", status_code=303)

    if error:
        if error == "access_denied":
            return back("error", tr("Microsoft sign-in was cancelled."))
        return back("error", (error_description or error).split("\n")[0])
    if principal is None:  # P29: the callback belongs to the signed-in person who started it
        return back("error", tr("Sign in first, then connect Outlook again."))
    try:
        acct = await auth.finish(
            db,
            state,
            code,
            workspace_id=principal.workspace_id,
            user_id=principal.user.id,
            session_id=principal.session_id,
        )
    except MicrosoftError as e:
        return back("error", _say(e))
    except Exception:  # noqa: BLE001 - Microsoft unreachable and the like
        log.warning("Microsoft sign-in failed", exc_info=True)
        return back("error", tr("Could not reach Microsoft. Try again."))
    await sync.queue_box(acct)
    background.add_task(sync.kick)
    return back("connected", acct.email)


@router.get(f"{BASE}/account")
async def microsoft_account(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    acct = await access.personal_account_of(db, principal.workspace_id, principal.user.id)
    if acct is None or acct.status == "disconnected":
        return {
            "connected": False,
            "email": None,
            "display_name": None,
            "status": "disconnected",
            "mail_ok": False,
            "calendar_ok": False,
            "teams_ok": False,
            "last_sync_at": None,
            "webhooks": "off",
            "last_error": None,
        }
    return {
        "connected": True,
        "email": acct.email,
        "display_name": acct.display_name,
        "status": acct.status,
        "mail_ok": auth.has_scope(acct.scopes, "Mail.ReadWrite"),
        "calendar_ok": auth.has_scope(acct.scopes, "Calendars.ReadWrite"),
        # P52: Teams needs a reconnect for connections made before Teams was added.
        "teams_ok": auth.has_scope(acct.scopes, "Chat.Read"),
        "last_sync_at": acct.last_sync_at,
        "webhooks": await sync.webhooks_state(db, acct),
        "last_error": render(acct.last_error) if acct.last_error else None,
    }


# ---------------------------------------------------------------- Teams (P52): your own chats


async def _my_graph(db: AsyncSession, principal: Principal) -> graph.Graph:
    acct = await access.personal_account_of(db, principal.workspace_id, principal.user.id)
    if acct is None or acct.status not in access.USABLE_ACCOUNT:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "microsoft_not_connected",
            "Connect your Microsoft 365 account first.",
        )
    return await graph.for_account(db, acct)


def _teams_fail(e: MicrosoftError) -> Exception:
    if getattr(e, "status", 0) == 403:
        return api_error(
            status.HTTP_409_CONFLICT,
            "teams_not_allowed",
            "Reconnect Microsoft 365 once to allow Teams.",
        )
    return api_error(status.HTTP_502_BAD_GATEWAY, "microsoft_error", _say(e))


@router.get(f"{BASE}/teams/chats")
async def teams_chats(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> list[dict[str, Any]]:
    """Your own Teams chats (never anyone else's), most recent first."""
    from ...agents.teams_tools import plain

    g = await _my_graph(db, principal)
    try:
        me = (await g.me()).get("displayName") or ""
        chats = await g.list_chats(30)
    except MicrosoftError as e:
        raise _teams_fail(e) from e
    out = []
    for c in chats:
        last = c.get("lastMessagePreview") or {}
        names = [
            m.get("displayName")
            for m in c.get("members") or []
            if m.get("displayName") and m.get("displayName") != me
        ]
        out.append(
            {
                "id": c.get("id"),
                "title": c.get("topic") or ", ".join(names[:5]) or tr("Chat"),
                "kind": c.get("chatType") or "",
                "people": len(c.get("members") or []),
                "last_at": last.get("createdDateTime"),
                "last_from": ((last.get("from") or {}).get("user") or {}).get("displayName"),
                "last_text": plain((last.get("body") or {}).get("content"))[:200],
                "url": c.get("webUrl"),
            }
        )
    return out


@router.get(f"{BASE}/teams/chats/{{chat_id}}/messages")
async def teams_chat_messages(
    chat_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    from ...agents.teams_tools import plain

    g = await _my_graph(db, principal)
    try:
        msgs = await g.chat_messages(chat_id, 40)
    except MicrosoftError as e:
        raise _teams_fail(e) from e
    return [
        {
            "id": m.get("id"),
            "at": m.get("createdDateTime"),
            "from": ((m.get("from") or {}).get("user") or {}).get("displayName") or "",
            "text": plain((m.get("body") or {}).get("content"))[:4000],
        }
        for m in reversed(msgs)
        if m.get("messageType") in (None, "message")
    ]


@router.get(f"{BASE}/account/prefs")
async def microsoft_prefs(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    """What the AI does with the person's own Outlook mail (their own; nobody else's)."""
    acct = await access.personal_account_of(db, principal.workspace_id, principal.user.id)
    if acct is None or acct.status == "disconnected":
        raise api_error(status.HTTP_404_NOT_FOUND, "not_connected", "Connect Outlook first.")
    return mail_rules.personal_effective(acct.prefs)


@router.put(f"{BASE}/account/prefs")
async def microsoft_set_prefs(
    body: mail_rules.PersonalPrefs,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    acct = await access.personal_account_of(db, principal.workspace_id, principal.user.id)
    if acct is None or acct.status == "disconnected":
        raise api_error(status.HTTP_404_NOT_FOUND, "not_connected", "Connect Outlook first.")
    acct.prefs = body.model_dump()
    await db.commit()
    return mail_rules.personal_effective(acct.prefs)


@router.delete(f"{BASE}/account", status_code=status.HTTP_204_NO_CONTENT)
async def microsoft_disconnect(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> Response:
    acct = await access.personal_account_of(db, principal.workspace_id, principal.user.id)
    if acct is not None and acct.status != "disconnected":
        await sync.disconnect_account(db, acct)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------- admin consent


@router.get(f"{BASE}/adminconsent/start")
async def adminconsent_start(
    request: Request,
    principal: Principal = Depends(require("channels.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    base = _base(request)
    try:
        url = await auth.adminconsent_url(
            db, principal.workspace_id, principal.user.id, principal.session_id, base
        )
    except NotConfigured as e:
        raise api_error(status.HTTP_409_CONFLICT, "not_configured", str(e)) from e
    if await app.remember_base(db, principal.workspace_id, base, principal.actor):
        await db.commit()
    return {"url": url}


@router.get(f"{BASE}/adminconsent")
async def adminconsent_callback(
    background: BackgroundTasks,
    state: str = Query(default="", max_length=200),
    tenant: str = Query(default="", max_length=253),
    admin_consent: str = Query(default=""),
    error: str = Query(default="", max_length=200),
    error_description: str = Query(default="", max_length=1000),
    principal: Principal | None = Depends(optional_principal),
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    def back(result: str, msg: str = "") -> RedirectResponse:
        q = urllib.parse.urlencode({"ms_admin": result, **({"msg": msg[:200]} if msg else {})})
        return RedirectResponse(f"/channels?{q}", status_code=303)

    if error:
        if error == "access_denied":
            return back("error", tr("Admin consent was not given."))
        return back("error", (error_description or error).split("\n")[0])
    if principal is None or not can(principal.role, "channels.manage"):
        return back("error", tr("Sign in as an owner or admin, then grant admin consent again."))
    if admin_consent.lower() != "true":
        return back("error", tr("Admin consent was not given."))
    try:
        tid = await auth.adminconsent_finish(
            db,
            state,
            tenant,
            workspace_id=principal.workspace_id,
            user_id=principal.user.id,
            session_id=principal.session_id,
            actor=principal.actor,
        )
    except MicrosoftError as e:
        return back("error", _say(e))
    waiting = (
        await db.scalars(
            select(SharedMailbox).where(
                SharedMailbox.workspace_id == principal.workspace_id, SharedMailbox.tenant_id == ""
            )
        )
    ).all()
    for mb in waiting:
        mb.tenant_id = tid
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "integration.admin_consent",
        after={"kind": "microsoft", "tenant": tid},
    )
    await db.commit()
    for mb in waiting:
        await sync.queue_box(mb)
    if waiting:
        background.add_task(sync.kick)
    return back("ok")


# ---------------------------------------------------------------- shared mailboxes


class MailboxIn(BaseModel):
    address: EmailStr
    branch_id: str = Field(min_length=1, max_length=40)
    agent_id: str | None = Field(default=None, max_length=40)
    display_name: str | None = Field(default=None, max_length=200)
    rules: mail_rules.MailRules | None = None


class MailboxPatch(BaseModel):
    display_name: str | None = Field(default=None, max_length=200)
    branch_id: str | None = Field(default=None, min_length=1, max_length=40)
    agent_id: str | None = Field(default=None, max_length=40)  # null unassigns
    rules: mail_rules.MailRules | None = None
    paused: bool | None = None


async def _mailbox_out(db: AsyncSession, mb: SharedMailbox) -> dict[str, Any]:
    branch = await db.get(Branch, mb.branch_id)
    agent = await db.get(Agent, mb.agent_id) if mb.agent_id else None
    return {
        "id": mb.id,
        "address": mb.address,
        "display_name": mb.display_name or mb.address,
        "branch_id": mb.branch_id,
        "branch_name": branch.name if branch else None,
        "agent_id": mb.agent_id,
        "agent_name": agent.name if agent else None,
        "rules": mail_rules.effective(mb.rules),
        "status": mb.status,
        "last_sync_at": mb.last_sync_at,
        "webhooks": await sync.webhooks_state(db, mb),
        "last_error": render(mb.last_error) if mb.last_error else None,
    }


async def _branch(db: AsyncSession, principal: Principal, branch_id: str) -> Branch:
    b = await db.get(Branch, branch_id)
    if b is None or b.workspace_id != principal.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "branch_not_found", "That company is not here.")
    return b


async def _team_agent(
    db: AsyncSession, principal: Principal, agent_id: str, branch_id: str
) -> Agent:
    a = await db.get(Agent, agent_id)
    if (
        a is None
        or a.workspace_id != principal.workspace_id
        or a.private
        or a.status == "retired"
        or a.branch_id != branch_id
    ):
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "bad_agent",
            "Pick a team agent of that company (not a personal assistant).",
        )
    return a


async def _mailbox(db: AsyncSession, principal: Principal, mailbox_id: str) -> SharedMailbox:
    mb = await db.get(SharedMailbox, mailbox_id)
    if mb is None or mb.workspace_id != principal.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "mailbox_not_found", "That mailbox is not here.")
    return mb


@router.get(f"{BASE}/mailboxes")
async def list_mailboxes(
    principal: Principal = Depends(require("channels.manage")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    rows = (
        await db.scalars(
            select(SharedMailbox)
            .where(SharedMailbox.workspace_id == principal.workspace_id)
            .order_by(SharedMailbox.created_at)
        )
    ).all()
    return [await _mailbox_out(db, mb) for mb in rows]


@router.post(f"{BASE}/mailboxes", status_code=status.HTTP_201_CREATED)
async def add_mailbox(
    body: MailboxIn,
    request: Request,
    background: BackgroundTasks,
    principal: Principal = Depends(require("channels.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    cfg = await app.load(db, principal.workspace_id)
    if not cfg.configured:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "not_configured",
            "Microsoft 365 is not set up yet (Channels > Microsoft 365).",
        )
    tenant = cfg.app_tenant()
    if not tenant:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "no_tenant",
            "Grant admin consent first (Channels > Microsoft 365) so the app knows your tenant.",
        )
    address = str(body.address).strip().lower()
    taken = await db.scalar(
        select(SharedMailbox.id).where(
            SharedMailbox.workspace_id == principal.workspace_id, SharedMailbox.address == address
        )
    )
    if taken:
        raise api_error(
            status.HTTP_409_CONFLICT, "mailbox_exists", "That mailbox is already connected."
        )
    await _branch(db, principal, body.branch_id)
    if body.agent_id:
        await _team_agent(db, principal, body.agent_id, body.branch_id)
    mb = SharedMailbox(
        workspace_id=principal.workspace_id,
        address=address,
        display_name=(body.display_name or "").strip()[:200],
        tenant_id=tenant,
        branch_id=body.branch_id,
        agent_id=body.agent_id or None,
        rules=(body.rules or mail_rules.MailRules()).model_dump(),
        status="active",
        created_by=principal.actor,
    )
    db.add(mb)
    await db.flush()
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "mailbox.created",
        target=mb.id,
        after={"address": address, "branch_id": mb.branch_id, "agent_id": mb.agent_id},
    )
    await app.remember_base(db, principal.workspace_id, _base(request), principal.actor)
    await db.commit()
    await sync.queue_box(mb)
    background.add_task(sync.kick)
    return await _mailbox_out(db, mb)


@router.patch(f"{BASE}/mailboxes/{{mailbox_id}}")
async def change_mailbox(
    mailbox_id: str,
    body: MailboxPatch,
    background: BackgroundTasks,
    principal: Principal = Depends(require("channels.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    mb = await _mailbox(db, principal, mailbox_id)
    before = {"branch_id": mb.branch_id, "agent_id": mb.agent_id, "status": mb.status}
    sent = body.model_fields_set
    if body.display_name is not None:
        mb.display_name = body.display_name.strip()[:200]
    if body.branch_id is not None and body.branch_id != mb.branch_id:
        await _branch(db, principal, body.branch_id)
        mb.branch_id = body.branch_id
        if "agent_id" not in sent and mb.agent_id:
            mb.agent_id = None  # its agent belongs to the old company
    if "agent_id" in sent:
        if body.agent_id:
            await _team_agent(db, principal, body.agent_id, mb.branch_id)
        mb.agent_id = body.agent_id or None
    if body.rules is not None:
        mb.rules = body.rules.model_dump()
    resume = False
    if body.paused is True and mb.status != "paused":
        mb.status = "paused"
    elif body.paused is False and mb.status == "paused":
        mb.status, mb.last_error, resume = "active", None, True
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "mailbox.updated",
        target=mb.id,
        before=before,
        after={"branch_id": mb.branch_id, "agent_id": mb.agent_id, "status": mb.status},
    )
    await db.commit()
    if mb.status == "paused":
        await sync.drop_subscriptions(db, mb)
    elif resume:
        await sync.queue_box(mb)
        background.add_task(sync.kick)
    return await _mailbox_out(db, mb)


@router.delete(f"{BASE}/mailboxes/{{mailbox_id}}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_mailbox(
    mailbox_id: str,
    principal: Principal = Depends(require("channels.manage")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    mb = await _mailbox(db, principal, mailbox_id)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "mailbox.deleted",
        target=mb.id,
        before={"address": mb.address},
    )
    await sync.delete_mailbox(db, mb)  # commits (the audit row too)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(f"{BASE}/mailboxes/{{mailbox_id}}/test")
async def test_mailbox(
    mailbox_id: str,
    principal: Principal = Depends(require("channels.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Read the inbox's id with the app's own token: proves Exchange lets the app in."""
    mb = await _mailbox(db, principal, mailbox_id)
    try:
        g = await graph.for_mailbox(db, mb)
        await g.inbox_probe()
    except Forbidden:
        mb.status, mb.last_error = "error", sync.rbac_message()
        await db.commit()
        return {"ok": False, "message": render(sync.rbac_message())}
    except NotFound:
        return {"ok": False, "message": tr("Microsoft has no mailbox at that address.")}
    except MicrosoftError as e:
        return {"ok": False, "message": _say(e)}
    if mb.status == "error":
        mb.status, mb.last_error = "active", None
        await db.commit()
    return {"ok": True, "message": tr("Microsoft let the app read this mailbox.")}


# ---------------------------------------------------------------- mail activity


def _item_out(item: MailItem, label: str) -> dict[str, Any]:
    return {
        "id": item.id,
        "mailbox_label": label,
        "received_at": item.received_at,
        "from_name": item.from_name,
        "from_address": item.from_address,
        "subject": item.subject,
        "category": item.category,
        "status": item.status,
        "actions": [
            {k: v for k, v in a.items() if k != "attachment_id"} for a in item.actions or []
        ],
        "task_id": item.task_id,
        "has_attachments": item.has_attachments,
        # P34 mail features: what the AI understood.
        "summary": item.summary,
        "needs_person": item.needs_person,
        "due_at": item.due_at,
        "answered_at": item.answered_at,
        "followed_up_at": item.followed_up_at,
    }


@router.get("/api/mail/activity")
async def mail_activity(
    mailbox: str = Query(default="personal", max_length=40),
    limit: int = Query(default=50, ge=1, le=200),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """Recent mail of one mailbox: "personal" (always the caller's own) or a shared
    mailbox id the caller may see (404 otherwise)."""
    if mailbox == "personal":
        acct = await access.personal_account_of(db, principal.workspace_id, principal.user.id)
        if acct is None:
            return []
        box_id, label = acct.id, acct.email or acct.display_name
    else:
        mb = await db.get(SharedMailbox, mailbox)
        if not await access.sees_shared(
            db,
            mb,
            workspace_id=principal.workspace_id,
            user_id=principal.user.id,
            role=principal.role,
            branch_id=principal.branch_id,
        ):
            raise api_error(
                status.HTTP_404_NOT_FOUND, "mailbox_not_found", "That mailbox is not here."
            )
        assert mb is not None
        box_id, label = mb.id, mb.display_name or mb.address
    rows = (
        await db.scalars(
            select(MailItem)
            .where(MailItem.workspace_id == principal.workspace_id, MailItem.mailbox_ref == box_id)
            .order_by(MailItem.received_at.desc().nulls_last(), MailItem.id.desc())
            .limit(limit)
        )
    ).all()
    return [_item_out(i, label) for i in rows]


# ---------------------------------------------------------------- the Graph webhook


@router.post(app.NOTIFY_PATH)
async def microsoft_notify(
    request: Request,
    background: BackgroundTasks,
    validation_token: str | None = Query(default=None, alias="validationToken", max_length=2048),
) -> Response:
    """Graph's change and lifecycle notifications. Answers fast and never calls Graph here:
    the worker does the delta fetch."""
    if validation_token is not None:  # the subscription handshake: echo it, as text/plain
        return PlainTextResponse(validation_token, status_code=200)
    raw = await request.body()
    if len(raw) > MAX_NOTIFY_BYTES:
        return Response(status_code=status.HTTP_413_CONTENT_TOO_LARGE)
    try:
        payload = json.loads(raw or b"{}")
    except ValueError:
        return Response(status_code=status.HTTP_400_BAD_REQUEST)
    async with SessionLocal() as db:
        accepted, rejected = await sync.accept_notifications(db, payload)
    if rejected and not accepted:
        return Response(status_code=status.HTTP_403_FORBIDDEN)
    if accepted:
        background.add_task(sync.kick)
    return Response(status_code=status.HTTP_202_ACCEPTED)
