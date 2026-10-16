"""The seam the mail features plug into (P34).

`sync.sync_box` calls `on_new_mail(item)` once per message the first time it is seen in an
inbox, after the MailItem row (metadata only) is committed. Repeated notifications and
re-runs of a delta round never call it twice for the same Graph message.

It tells the people who may see that mailbox (live event `mail.new`), then hands the mail
to features.process (classify -> tasks and attachments by the rules -> `mail.updated`).
The body is fetched on demand, never stored. It runs in the worker; it must not raise
(features sets status "failed" instead), so one bad message cannot stop a mailbox's sync.
"""

import logging

from ..core.db import SessionLocal
from ..models import MailItem, MicrosoftAccount, SharedMailbox
from . import access

log = logging.getLogger("agentic.microsoft.hooks")


def item_event(item: MailItem, label: str) -> dict:
    return {
        "mail_item_id": item.id,
        "mailbox_kind": item.mailbox_kind,
        "mailbox_id": item.mailbox_ref,
        "mailbox_label": label,
        "from_name": item.from_name,
        "from_address": item.from_address,
        "subject": item.subject,
        "received_at": item.received_at.isoformat() if item.received_at else None,
        "has_attachments": item.has_attachments,
    }


async def on_new_mail(item: MailItem) -> None:
    """A new message arrived (metadata already stored). Publishes `mail.new` to whoever
    may see the mailbox, then sorts the mail and acts on it (features.process: pre-filter,
    one cheap classification, tasks and attachments by the mailbox's rules, `mail.updated`).
    Never raises."""
    await _announce(item)
    from ..crm import mail as crm_mail

    await crm_mail.record(item.id)  # P35: a known party's email on its timeline (never raises)
    try:
        from . import features

        await features.process(item.id)
    except Exception:  # noqa: BLE001 - one bad mail must not stop the mailbox's sync
        log.warning("mail %s not processed", item.id, exc_info=True)


async def _announce(item: MailItem) -> None:
    from ..services import events

    try:
        async with SessionLocal() as db:
            box: MicrosoftAccount | SharedMailbox | None = (
                await db.get(MicrosoftAccount, item.account_id)
                if item.account_id
                else await db.get(SharedMailbox, item.mailbox_id)
            )
            if box is None:
                return
            viewers = await access.viewer_ids(db, box)
            label = (
                box.email
                if isinstance(box, MicrosoftAccount)
                else (box.display_name or box.address)
            )
        await events.publish(
            item.workspace_id, "mail.new", {**item_event(item, label), "viewer_ids": viewers}
        )
    except Exception:  # noqa: BLE001 - a lost live update must not stop the sync
        log.warning("mail.new not published for %s", item.id, exc_info=True)
