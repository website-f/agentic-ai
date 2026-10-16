"""P35: an email from a known party lands on its timeline (metadata only).

`record(item_id)` runs from microsoft/hooks.on_new_mail, once per new message: the sender's
address is matched to a contact or a party (or, for a company domain, the one party with
that domain), among the parties of the mailbox's company and the shared ones. A shared
mailbox's mail is logged with its subject; a person's own mail only as "an email reached
<person>'s Outlook", never its subject. Never raises.
"""

import logging

from sqlalchemy import select

from ..core.db import SessionLocal
from ..i18n import tr
from ..models import Interaction, MailItem, Membership, MicrosoftAccount, SharedMailbox, User
from . import service as svc

log = logging.getLogger("agentic.crm.mail")


async def record(item_id: str) -> int | None:
    """The interaction's id, or None when the sender is no known party."""
    try:
        async with SessionLocal() as db:
            item = await db.get(MailItem, item_id)
            if item is None or not item.from_address:
                return None
            done = await db.scalar(
                select(Interaction.id).where(
                    Interaction.mail_item_id == item.id, Interaction.kind == "email_in"
                )
            )
            if done is not None:
                return None
            shared = await db.get(SharedMailbox, item.mailbox_id) if item.mailbox_id else None
            acct = await db.get(MicrosoftAccount, item.account_id) if item.account_id else None
            if shared is not None:
                branch_id = shared.branch_id
                where = shared.display_name or shared.address
            elif acct is not None:
                m = await db.get(Membership, (item.workspace_id, acct.user_id))
                branch_id = m.branch_id if m else None
                u = await db.get(User, acct.user_id)
                where = u.name if u else acct.email
            else:
                return None
            hit = await svc.match_email(db, item.workspace_id, branch_id, item.from_address)
            if hit is None:
                return None
            party, contact = hit
            lang = await svc.company_lang(db, item.workspace_id, branch_id)
            summary = (
                tr("Email to {mailbox}: {subject}", lang, mailbox=where, subject=item.subject)
                if shared is not None
                else tr("An email reached {person}'s Outlook", lang, person=where)
            )
            row = await svc.log(
                db,
                item.workspace_id,
                party.id,
                "email_in",
                summary,
                "system:mail",
                at=item.received_at or item.created_at,
                mail_item_id=item.id,
                data={
                    "from": item.from_address,
                    "contact_id": contact.id if contact is not None else None,
                    "mailbox_kind": item.mailbox_kind,
                },
            )
            await db.commit()
            return row.id
    except Exception:  # noqa: BLE001 - the mail pipeline must go on
        log.warning("email interaction not recorded for %s", item_id, exc_info=True)
        return None
