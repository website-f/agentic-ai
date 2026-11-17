"""P109: tell people about something that waits for them: files uploaded for their company,
a mention in a feedback comment.

Every notice goes three ways:
- in the app: the "Needs you" bell lists it (api/routers/needs.py reads the rows themselves);
- to their phone, Telegram or WhatsApp when they set one up (channels/deliver.notify_user);
- by email from the office's system mailbox (Workspace.settings["system_mail"], sent through
  Microsoft Graph, microsoft/sendmail.py) only when that mailbox is set up and switched on.

Emails are plain Malay and English, carry a link to the page (built from the public base URL,
microsoft/app.worker_base) and never a secret. They go after the answer (in the background) so a
slow mailbox never holds up the person; a failed email is logged and audited, never retried.
"""

import html
import logging
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.db import SessionLocal
from ..core.workspace_settings import system_mail, valid_address
from ..i18n import Msg
from ..microsoft import app as ms_app
from ..microsoft import sendmail
from ..models import User, Workspace
from . import audit
from .signin_mail import _page, spawn

log = logging.getLogger(__name__)


async def link(db: AsyncSession, workspace_id: str, path: str) -> str:
    """The page's full address (https://agent.oriondesk.space/... on the live server)."""
    return (await ms_app.worker_base(db, workspace_id)).rstrip("/") + path


def email_html(name: str, en: list[str], ms: list[str], url: str) -> str:
    """A plain notice: hello, the English lines, the Malay lines, the link. No images."""
    n, u = html.escape(name), html.escape(url, quote=True)
    a = f'<a href="{u}" style="color:#1d4ed8">{html.escape(url)}</a>'
    p = '<p style="margin:0 0 10px">'
    body = "".join(f"{p}{html.escape(x)}</p>" for x in en)
    badan = "".join(f"{p}{html.escape(x)}</p>" for x in ms)
    return _page(
        f"{p}Hello {n},</p>{body}{p}Open it here: {a}</p>"
        '<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">'
        f"{p}Salam {n},</p>{badan}{p}Buka di sini: {a}</p>"
    )


async def tell(
    db: AsyncSession,
    workspace_id: str,
    user_ids: Iterable[str],
    *,
    title: Msg,
    body: Msg,
    path: str,
    subject: str,
    en: list[str],
    ms: list[str],
    dedupe: str,
    actor: str,
) -> None:
    """Phone/Telegram/WhatsApp now, email in the background. Never raises: a notice must
    never break the work it is about. The caller commits its own work first."""
    ids = [u for u in dict.fromkeys(user_ids) if u]
    if not ids:
        return
    from ..channels import deliver  # late: channels import agent modules

    for uid in ids:
        try:
            got = await deliver.notify_user(
                db, workspace_id, uid, title, body, path, dedupe=f"{dedupe}:{uid}"
            )
            await deliver.start(got)
        except Exception:  # noqa: BLE001
            log.warning("could not notify %s (%s)", uid, dedupe, exc_info=True)
    try:
        ws = await db.get(Workspace, workspace_id)
        sm = system_mail(ws.settings if ws else None)
        if not sm.ready:
            return
        url = await link(db, workspace_id, path)
    except Exception:  # noqa: BLE001
        log.warning("could not prepare notice emails (%s)", dedupe, exc_info=True)
        return
    spawn(_emails(workspace_id, ids, sm.address, sm.from_name, subject, en, ms, url, actor))


async def _emails(
    workspace_id: str,
    ids: list[str],
    sender: str,
    from_name: str,
    subject: str,
    en: list[str],
    ms: list[str],
    url: str,
    actor: str,
) -> None:
    async with SessionLocal() as db:
        users = (
            await db.scalars(select(User).where(User.id.in_(ids), User.is_active.is_(True)))
        ).all()
        for u in users:
            if not valid_address(u.email):
                continue
            try:
                await sendmail.send(
                    db,
                    workspace_id,
                    sender=sender,
                    from_name=from_name,
                    to=u.email,
                    to_name=u.name,
                    subject=subject,
                    html=email_html(u.name, en, ms, url),
                )
                what = "notice.email_sent"
            except Exception as e:  # noqa: BLE001 - SendError or the network
                log.warning("notice email to %s failed: %s", u.id, e)
                what = "notice.email_failed"
            await audit.record(
                db, workspace_id, actor, what, target=u.id, after={"to": u.email, "about": subject}
            )
            await db.commit()
