"""Real-time mail sync for connected Outlook mailboxes (P34).

    Graph --POST /notify--> API: verify clientState, SADD work to Valkey `ms:pending`,
                            answer 202 at once, then (after the response) start a small
                            Temporal workflow that drains the queue in the worker.
    worker (MailPendingWorkflow / the 1-minute `mail-sync` schedule):
        sync|<kind>|<id>   delta query on that inbox -> MailItem rows -> hooks.on_new_mail
        renew|<sub id>     PATCH the subscription's expiry (reauthorizes it too)
        resub|<kind>|<id>  delete the box's subscriptions and create a new one

Rules:
- A notification only triggers a DELTA fetch; its payload is never trusted or used.
- First sync of a mailbox covers the last 7 days; then each round continues from the stored
  delta link. A stale link (410) starts a new 7-day round. Rows are unique per
  (mailbox, Graph message id), so repeats and overlapping rounds are harmless, and
  `on_new_mail` runs once per message.
- Subscriptions: changeType "created" on the inbox's messages, a random clientState per
  subscription (kept as SHA-256 only), lifecycle notifications to the same URL, lifetime
  just under Graph's 10,080-minute maximum for Outlook messages, renewed when under 24 h
  remain. reauthorizationRequired -> renew; subscriptionRemoved -> recreate + delta;
  missed -> delta.
- Webhooks need a public https base (app.webhooks_ok). Without one, or while a mailbox has
  no live subscription, it is polled: a delta every 3 minutes. With a live subscription a
  safety delta still runs every hour.
- A person whose refresh token Microsoft refused is `reconnect_needed`: skipped until they
  connect again. A paused shared mailbox is skipped.
"""

import hashlib
import hmac
import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, literal_column, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.db import SessionLocal
from ..core.ids import new_id
from ..core.valkey import valkey
from ..i18n import Msg
from ..models import MailItem, MailSubscription, MicrosoftAccount, SharedMailbox
from . import app, auth, graph, hooks
from .errors import Forbidden, Gone, MicrosoftError, NotConfigured, NotFound, ReconnectNeeded

log = logging.getLogger("agentic.microsoft.sync")

Box = MicrosoftAccount | SharedMailbox

SUB_LIFETIME = timedelta(minutes=10_070)  # Graph's max for Outlook messages is 10,080
RENEW_BEFORE = timedelta(hours=24)
POLL_EVERY = timedelta(minutes=3)
SAFETY_EVERY = timedelta(hours=1)
FIRST_SYNC = timedelta(days=7)
MAX_PAGES = 40  # per round; a longer backlog continues next round from the stored link
LOCK_TTL = 300
SUB_RETRY = 900  # seconds before trying again to subscribe a mailbox that failed
PENDING = "ms:pending"
INBOX = "mailFolders('inbox')/messages"


def rbac_message() -> Msg:
    """What a 403 on a shared mailbox means (Exchange RBAC for Applications)."""
    return Msg(
        "Microsoft refused access to this mailbox. Ask the Microsoft 365 admin to include it "
        "in the app's RBAC for Applications scope."
    )


def now() -> datetime:
    return datetime.now(UTC)


def kind_of(box: Box) -> str:
    return "personal" if isinstance(box, MicrosoftAccount) else "shared"


def ref(box: Box) -> str:
    return f"{kind_of(box)}|{box.id}"


def resource_of(box: Box) -> str:
    if isinstance(box, MicrosoftAccount):
        return f"me/{INBOX}"
    return f"users/{box.address}/{INBOX}"


def is_active(box: Box) -> bool:
    if isinstance(box, MicrosoftAccount):
        return box.status == "connected" and bool(box.token_enc)
    return box.status != "paused"


def label_of(box: Box) -> str:
    if isinstance(box, MicrosoftAccount):
        return box.email or box.display_name
    return box.display_name or box.address


async def load_box(db: AsyncSession, kind: str, box_id: str) -> Box | None:
    if kind == "personal":
        return await db.get(MicrosoftAccount, box_id)
    if kind == "shared":
        return await db.get(SharedMailbox, box_id)
    return None


def _owner_filter(box: Box) -> Any:
    if isinstance(box, MicrosoftAccount):
        return MailSubscription.account_id == box.id
    return MailSubscription.mailbox_id == box.id


async def subscriptions_of(db: AsyncSession, box: Box) -> list[MailSubscription]:
    return list((await db.scalars(select(MailSubscription).where(_owner_filter(box)))).all())


async def webhooks_state(db: AsyncSession, box: Box) -> str:
    """ "live" (a subscription that has not expired), "polling" (synced by polling),
    "off" (not syncing: disconnected, reconnect needed, paused)."""
    if not is_active(box):
        return "off"
    t = now()
    return "live" if any(s.expires_at > t for s in await subscriptions_of(db, box)) else "polling"


def hash_state(client_state: str) -> str:
    return hashlib.sha256(f"msclientstate:{client_state}".encode()).hexdigest()


# ---------------------------------------------------------------- delta


def _row(box: Box, m: dict[str, Any]) -> dict[str, Any]:
    sender = ((m.get("from") or m.get("sender") or {}).get("emailAddress")) or {}
    personal = isinstance(box, MicrosoftAccount)
    return {
        "id": new_id("mi"),
        "workspace_id": box.workspace_id,
        "mailbox_kind": kind_of(box),
        "mailbox_ref": box.id,
        "account_id": box.id if personal else None,
        "mailbox_id": None if personal else box.id,
        "graph_message_id": str(m["id"])[:255],
        "conversation_id": str(m.get("conversationId") or "")[:255],
        "internet_message_id": str(m.get("internetMessageId") or "")[:400],
        "received_at": graph.parse_time(m.get("receivedDateTime")),
        "from_address": str(sender.get("address") or "").lower()[:254],
        "from_name": str(sender.get("name") or "")[:200],
        "subject": str(m.get("subject") or "")[:400],
        "has_attachments": bool(m.get("hasAttachments")),
        "is_read": bool(m.get("isRead")),
        "status": "new",
        "actions": [],
    }


async def _store(db: AsyncSession, box: Box, messages: list[dict[str, Any]]) -> list[str]:
    """Upsert metadata; returns the ids of rows that are new."""
    fresh: list[str] = []
    for m in messages:
        if not m.get("id") or "@removed" in m or m.get("isDraft"):
            continue
        stmt = pg_insert(MailItem).values(**_row(box, m))
        stmt = stmt.on_conflict_do_update(
            constraint="uq_mail_items_message", set_={"is_read": stmt.excluded.is_read}
        ).returning(MailItem.id, literal_column("(xmax = 0)").label("inserted"))
        row = (await db.execute(stmt)).first()
        if row is not None and row.inserted:
            fresh.append(row.id)
    return fresh


async def sync_box(db: AsyncSession, box: Box) -> list[MailItem]:
    """One delta round on the box's inbox: store new metadata, keep the delta link, then
    call hooks.on_new_mail for each new message. Returns the new items. Raises
    MicrosoftError subclasses (the caller records them; see `run_sync`)."""
    g = await graph.for_box(db, box)
    link = box.delta_link
    since = None if link else now() - FIRST_SYNC
    fresh: list[str] = []
    restarted = False
    pages = 0
    while True:
        try:
            page = await g.list_messages(delta_link=link, since=since)
        except Gone:
            if restarted:
                raise
            restarted, link, since = True, None, now() - FIRST_SYNC
            box.delta_link = None
            continue
        since = None
        fresh += await _store(db, box, page.items)
        pages += 1
        if page.delta_link:
            box.delta_link = page.delta_link
            break
        if not page.next_link or pages >= MAX_PAGES:
            # A long backlog: the next round continues from this page.
            box.delta_link = page.next_link or box.delta_link
            break
        link = page.next_link
    box.last_sync_at = now()
    box.last_error = None
    if isinstance(box, SharedMailbox) and box.status == "error":
        box.status = "active"
    await db.commit()
    items = (
        list((await db.scalars(select(MailItem).where(MailItem.id.in_(fresh)))).all())
        if fresh
        else []
    )
    items.sort(key=lambda i: i.received_at or now())
    for item in items:
        await hooks.on_new_mail(item)
    return items


async def record_failure(db: AsyncSession, box: Box, e: Exception) -> None:
    """Remember why a sync failed, in words for the dashboard."""
    await db.rollback()
    box = await load_box(db, kind_of(box), box.id) or box
    if isinstance(e, ReconnectNeeded):
        return  # auth.access_token already marked the account reconnect_needed
    if isinstance(box, SharedMailbox) and isinstance(e, Forbidden):
        box.status = "error"
        box.last_error = rbac_message()
    else:
        box.last_error = str(e)[:500]
        if isinstance(box, SharedMailbox) and isinstance(e, NotConfigured | NotFound):
            box.status = "error"
    await db.commit()


# ---------------------------------------------------------------- subscriptions


async def subscribe(db: AsyncSession, box: Box, base: str) -> MailSubscription | None:
    """Replace the box's subscriptions with a new one. None when webhooks cannot work here
    (no public https base). Raises MicrosoftError when Graph refuses."""
    if not app.webhooks_ok(base) or not is_active(box):
        return None
    await drop_subscriptions(db, box)
    secret = secrets.token_urlsafe(32)
    expires = now() + SUB_LIFETIME
    g = await graph.for_box(db, box)
    body = await g.create_subscription(resource_of(box), app.notify_url(base), secret, expires)
    personal = isinstance(box, MicrosoftAccount)
    sub = MailSubscription(
        id=str(body["id"])[:80],
        workspace_id=box.workspace_id,
        account_id=box.id if personal else None,
        mailbox_id=None if personal else box.id,
        resource=resource_of(box)[:400],
        client_state_hash=hash_state(secret),
        expires_at=graph.parse_time(body.get("expirationDateTime")) or expires,
    )
    db.add(sub)
    await db.commit()
    return sub


async def renew(db: AsyncSession, sub: MailSubscription) -> bool:
    """Extend (and so reauthorize) a subscription. Gone at Microsoft: recreate it."""
    box = await load_box(
        db, "personal" if sub.account_id else "shared", sub.account_id or sub.mailbox_id or ""
    )
    if box is None or not is_active(box):
        await db.delete(sub)
        await db.commit()
        return False
    g = await graph.for_box(db, box)
    try:
        body = await g.renew_subscription(sub.id, now() + SUB_LIFETIME)
    except NotFound:
        await db.delete(sub)
        await db.commit()
        base = await app.worker_base(db, box.workspace_id)
        return await subscribe(db, box, base) is not None
    sub.expires_at = graph.parse_time(body.get("expirationDateTime")) or now() + SUB_LIFETIME
    await db.commit()
    return True


async def drop_subscriptions(db: AsyncSession, box: Box) -> int:
    """Delete the box's subscriptions at Microsoft (best effort) and here. Commits."""
    subs = await subscriptions_of(db, box)
    if not subs:
        return 0
    try:
        g: graph.Graph | None = await graph.for_box(db, box)
    except MicrosoftError:
        g = None
    for s in subs:
        if g is not None:
            try:
                await g.delete_subscription(s.id)
            except MicrosoftError:
                log.info("subscription %s not deleted at Microsoft", s.id, exc_info=True)
    await db.execute(delete(MailSubscription).where(_owner_filter(box)))
    await db.commit()
    return len(subs)


# ---------------------------------------------------------------- notifications (API side)


async def accept_notifications(db: AsyncSession, payload: Any) -> tuple[int, int]:
    """Graph's POST to /notify: check each notification's clientState and queue work.
    Never calls Graph. Returns (accepted, rejected). Unknown subscriptions are ignored
    (one we already deleted); a known one with the wrong clientState is rejected."""
    items = payload.get("value") if isinstance(payload, dict) else None
    accepted = rejected = 0
    work: set[str] = set()
    for n in (items if isinstance(items, list) else [])[:200]:
        if not isinstance(n, dict):
            continue
        sid = str(n.get("subscriptionId") or "")[:80]
        sub = await db.get(MailSubscription, sid) if sid else None
        if sub is None:
            continue
        given = hash_state(str(n.get("clientState") or ""))
        if not hmac.compare_digest(sub.client_state_hash, given):
            rejected += 1
            continue
        accepted += 1
        box_ref = f"personal|{sub.account_id}" if sub.account_id else f"shared|{sub.mailbox_id}"
        event = n.get("lifecycleEvent")
        if event == "reauthorizationRequired":
            work.add(f"renew|{sub.id}")
        elif event == "subscriptionRemoved":
            work.update({f"resub|{box_ref}", f"sync|{box_ref}"})
        else:  # a change (created) or "missed": a delta round either way
            work.add(f"sync|{box_ref}")
    if work:
        await valkey().sadd(PENDING, *sorted(work))
    return accepted, rejected


async def queue(*members: str) -> None:
    if members:
        await valkey().sadd(PENDING, *members)


async def queue_box(box: Box, *, subscribe_too: bool = True) -> None:
    """Ask the worker to (re)subscribe and sync this box soon."""
    r = ref(box)
    await queue(*([f"resub|{r}"] if subscribe_too else []), f"sync|{r}")


async def kick() -> bool:
    """Start a workflow that drains the queue now. False when Temporal is unreachable
    (the 1-minute schedule drains it then)."""
    try:
        from ..core.config import settings
        from ..core.temporal import temporal_client
        from ..workflows.mail_workflows import MailPendingWorkflow

        client = await temporal_client()
        await client.start_workflow(
            MailPendingWorkflow.run,
            id=f"ms-pending-{secrets.token_hex(8)}",
            task_queue=settings.temporal_task_queue,
        )
        return True
    except Exception:  # noqa: BLE001 - the schedule is the backstop
        log.info("mail queue not kicked (Temporal unreachable)", exc_info=True)
        return False


# ---------------------------------------------------------------- worker side


async def _lock(box_id: str) -> bool:
    return bool(await valkey().set(f"ms:lock:{box_id}", "1", nx=True, ex=LOCK_TTL))


async def _unlock(box_id: str) -> None:
    await valkey().delete(f"ms:lock:{box_id}")


async def run_sync(kind: str, box_id: str) -> str:
    """One delta round for a box in its own session: ok | busy | skipped | failed."""
    if not await _lock(box_id):
        return "busy"
    try:
        async with SessionLocal() as db:
            box = await load_box(db, kind, box_id)
            if box is None or not is_active(box):
                return "skipped"
            try:
                await sync_box(db, box)
            except MicrosoftError as e:
                log.info("mail sync failed for %s %s: %s", kind, box_id, e)
                await record_failure(db, box, e)
                return "failed"
            return "ok"
    finally:
        await _unlock(box_id)


async def resubscribe(kind: str, box_id: str) -> str:
    async with SessionLocal() as db:
        box = await load_box(db, kind, box_id)
        if box is None or not is_active(box):
            return "skipped"
        base = await app.worker_base(db, box.workspace_id)
        if not app.webhooks_ok(base):
            return "polling"
        try:
            return "ok" if await subscribe(db, box, base) else "polling"
        except MicrosoftError as e:
            log.info("subscription failed for %s %s: %s", kind, box_id, e)
            await valkey().set(f"ms:subretry:{box_id}", "1", ex=SUB_RETRY)
            if isinstance(e, ReconnectNeeded):
                return "failed"
            await record_failure(db, box, e)
            return "failed"


async def renew_one(sub_id: str) -> str:
    async with SessionLocal() as db:
        sub = await db.get(MailSubscription, sub_id)
        if sub is None:
            return "skipped"
        try:
            return "ok" if await renew(db, sub) else "skipped"
        except MicrosoftError as e:
            log.info("renewal failed for %s: %s", sub_id, e)
            return "failed"


async def run_member(member: str) -> str:
    parts = member.split("|")
    if parts[0] == "sync" and len(parts) == 3:
        return await run_sync(parts[1], parts[2])
    if parts[0] == "resub" and len(parts) == 3:
        return await resubscribe(parts[1], parts[2])
    if parts[0] == "renew" and len(parts) == 2:
        return await renew_one(parts[1])
    return "skipped"


async def process_pending(limit: int = 500) -> dict[str, int]:
    """Drain `ms:pending`: subscriptions first, then renewals, then syncs."""
    r = valkey()
    members: list[str] = []
    while len(members) < limit:
        m = await r.spop(PENDING)
        if m is None:
            break
        members.append(str(m))
    order = {"resub": 0, "renew": 1, "sync": 2}
    members.sort(key=lambda m: order.get(m.split("|")[0], 3))
    counts: dict[str, int] = {}
    busy: list[str] = []
    for m in members:
        try:
            result = await run_member(m)
        except Exception:  # noqa: BLE001 - one mailbox must not stop the others
            log.warning("mail work %s failed", m, exc_info=True)
            result = "failed"
        if result == "busy":
            busy.append(m)
        counts[result] = counts.get(result, 0) + 1
    if busy:  # another worker is syncing that box; it runs again next time
        await r.sadd(PENDING, *busy)
    return counts


async def tick() -> dict[str, int]:
    """The `mail-sync` schedule (every minute): drain the queue, renew subscriptions that
    expire within 24 h, subscribe mailboxes that have none (when webhooks can work), and
    run a delta for every mailbox that is due (3 min polling, 1 h with live webhooks). Then
    the mail features' housekeeping (features.housekeeping): pending mail, follow-ups,
    daily digests."""
    counts = await process_pending()
    t = now()
    async with SessionLocal() as db:
        expiring = (
            await db.scalars(
                select(MailSubscription.id).where(MailSubscription.expires_at < t + RENEW_BEFORE)
            )
        ).all()
        accounts = (
            await db.scalars(select(MicrosoftAccount).where(MicrosoftAccount.status == "connected"))
        ).all()
        shared = (
            await db.scalars(select(SharedMailbox).where(SharedMailbox.status != "paused"))
        ).all()
        boxes: list[Box] = [*accounts, *shared]
        live: set[str] = {
            s.account_id or s.mailbox_id or ""
            for s in (
                await db.scalars(select(MailSubscription).where(MailSubscription.expires_at > t))
            ).all()
        }
        bases: dict[str, str] = {}
        plan: list[tuple[str, str, bool, bool]] = []  # kind, id, subscribe, sync
        for box in boxes:
            if not is_active(box):
                continue
            if box.workspace_id not in bases:
                bases[box.workspace_id] = await app.worker_base(db, box.workspace_id)
            is_live = box.id in live
            want_sub = (
                not is_live
                and app.webhooks_ok(bases[box.workspace_id])
                and not await valkey().exists(f"ms:subretry:{box.id}")
            )
            every = SAFETY_EVERY if is_live else POLL_EVERY
            due = box.last_sync_at is None or t - box.last_sync_at >= every
            plan.append((kind_of(box), box.id, want_sub, due))
    for sub_id in expiring:
        r = await renew_one(sub_id)
        counts[f"renew_{r}"] = counts.get(f"renew_{r}", 0) + 1
    for kind, box_id, want_sub, due in plan:
        if want_sub:
            r = await resubscribe(kind, box_id)
            counts[f"subscribe_{r}"] = counts.get(f"subscribe_{r}", 0) + 1
        if due:
            r = await run_sync(kind, box_id)
            counts[f"sync_{r}"] = counts.get(f"sync_{r}", 0) + 1
    from . import features

    for k, v in (await features.housekeeping()).items():
        counts[k] = v
    return counts


# ---------------------------------------------------------------- disconnect


async def disconnect_account(db: AsyncSession, acct: MicrosoftAccount) -> None:
    """The person withdraws: subscriptions deleted (at Microsoft too, while the token
    still works), tokens deleted, the mail metadata from their mailbox deleted, and the
    account marked disconnected."""
    await drop_subscriptions(db, acct)
    await auth.forget(acct)
    await db.execute(delete(MailItem).where(MailItem.account_id == acct.id))
    acct.token_enc = ""
    acct.status = "disconnected"
    acct.delta_link = None
    acct.last_sync_at = None
    acct.last_error = None
    await db.commit()


async def delete_mailbox(db: AsyncSession, mailbox: SharedMailbox) -> None:
    await drop_subscriptions(db, mailbox)
    await db.delete(mailbox)
    await db.commit()
