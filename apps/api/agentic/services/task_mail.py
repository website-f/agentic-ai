"""P109: "a task for you" emails.

When a task is given to people (created, or someone is added to it), every new assignee hears
of it in the office (the "Needs you" bell, their phone or Telegram: teams/people.notify) and,
when the workspace's system mail is set up (Workspace.settings["system_mail"], the same sender
as the sign-in emails, docs/SYSTEM_EMAIL_SETUP.md), by email with a link straight to the task.
Never to whoever made the change: they know already.

The email says who gave the task, its title, when it is due and the link, in Bahasa Melayu and
English. Nothing else from the task (no description, no files). One email per task and person
per 10 minutes (Valkey task_mail:{task}:{user}), so moving someone off and back on does not
send twice. Sending runs after the answer (`spawn`) and never breaks the work; a failure is
audited without the address' mailbox contents.
"""

import asyncio
import html
import logging
from collections.abc import Coroutine, Iterable
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from ..core.db import SessionLocal
from ..core.valkey import valkey
from ..core.workspace_settings import SystemMail, system_mail, valid_address
from ..microsoft import app as ms_app
from ..microsoft import sendmail
from ..models import Task, User, Workspace
from . import audit

log = logging.getLogger(__name__)

GAP_SECONDS = 600
SUBJECT = "Tugasan baharu: {title} / New task: {title}"

_tasks: set[asyncio.Task] = set()


def spawn(coro: Coroutine[Any, Any, Any]) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return task


async def drain() -> None:
    """Wait for the background sends (tests)."""
    while _tasks:
        await asyncio.gather(*list(_tasks), return_exceptions=True)


async def sender(db: AsyncSession, workspace_id: str) -> SystemMail | None:
    """The workspace's system sender when it can send (tests swap this)."""
    ws = await db.get(Workspace, workspace_id)
    sm = system_mail(ws.settings if ws else None)
    if not sm.ready or not (await ms_app.load(db, workspace_id)).configured:
        return None
    return sm


async def task_link(db: AsyncSession, workspace_id: str, task_id: str) -> str:
    """The deep link to a task on the office's public address."""
    base = (await ms_app.worker_base(db, workspace_id)).rstrip("/")
    return f"{base}/tasks?task={task_id}"


def _due_text(due: datetime | None, tz: str | None) -> tuple[str, str]:
    if due is None:
        return "Tiada tarikh akhir", "No due date"
    try:
        local = due.astimezone(ZoneInfo(tz or "Asia/Kuala_Lumpur"))
    except Exception:  # noqa: BLE001 - an unknown zone: the server's
        local = due
    return local.strftime("%d/%m/%Y %H:%M"), local.strftime("%d %b %Y, %H:%M")


def task_email(*, name: str, giver: str, title: str, due: tuple[str, str], link: str) -> str:
    """The email: Malay first, then English; the title as typed (escaped), no images."""
    n, g, ti = html.escape(name), html.escape(giver), html.escape(title)
    u = html.escape(link, quote=True)
    a = f'<a href="{u}" style="color:#1d4ed8">{html.escape(link)}</a>'
    btn = (
        f'<p style="margin:16px 0"><a href="{u}" style="display:inline-block;padding:10px 18px;'
        "border-radius:8px;background:#1f2937;color:#ffffff;text-decoration:none;"
        'font-weight:600">Buka tugasan / Open the task</a></p>'
    )
    p = '<p style="margin:0 0 10px">'
    box = (
        '<div style="margin:12px 0;padding:12px 16px;border:1px solid #d1d5db;border-radius:8px;'
        f'background:#f9fafb"><div style="font-size:16px;font-weight:600">{ti}</div>'
        f'<div style="font-size:13px;color:#4b5563">Tarikh akhir: {html.escape(due[0])} · '
        f"Due: {html.escape(due[1])}</div></div>"
    )
    return (
        '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#ffffff">'
        '<div style="max-width:560px;margin:0 auto;padding:24px 20px;font-family:Segoe UI,'
        'Arial,sans-serif;font-size:15px;line-height:1.5;color:#111827">'
        f"{p}Salam {n},</p>{p}{g} memberi anda satu tugasan dalam Agentic Office:</p>{box}{btn}"
        f"{p}Atau buka pautan ini: {a}</p>"
        '<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">'
        f"{p}Hello {n},</p>{p}{g} gave you a task in Agentic Office (above). Open it with the "
        f"button or this link: {a}</p>"
        '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px">'
        '<p style="font-size:12.5px;color:#6b7280">Peti mel ini tidak dipantau. Jangan balas.'
        "<br>This mailbox is not monitored. Do not reply.</p></div></body></html>"
    )


def tell_by_email(workspace_id: str, task_id: str, user_ids: Iterable[str], by_user: str) -> None:
    """Email these assignees about the task, after the answer (never the one who acted)."""
    ids = [u for u in dict.fromkeys(user_ids) if u and u != by_user]
    if ids:
        spawn(_send_all(workspace_id, task_id, ids, by_user))


async def _send_all(workspace_id: str, task_id: str, user_ids: list[str], by_user: str) -> None:
    try:
        async with SessionLocal() as db:
            sm = await sender(db, workspace_id)
            t = await db.get(Task, task_id)
            if sm is None or t is None:
                return
            ws = await db.get(Workspace, workspace_id)
            giver = await db.get(User, by_user)
            link = await task_link(db, workspace_id, task_id)
            due = _due_text(t.due_at, ws.timezone if ws else None)
            title = t.title
            for uid in user_ids:
                user = await db.get(User, uid)
                if user is None or not user.is_active or not valid_address(user.email):
                    continue
                key = f"task_mail:{task_id}:{uid}"
                if not await valkey().set(key, "1", ex=GAP_SECONDS, nx=True):
                    continue
                try:
                    await sendmail.send(
                        db,
                        workspace_id,
                        sender=sm.address,
                        from_name=sm.from_name,
                        to=user.email,
                        to_name=user.name,
                        subject=SUBJECT.format(title=title[:120]),
                        html=task_email(
                            name=user.name,
                            giver=giver.name if giver else "Agentic Office",
                            title=title,
                            due=due,
                            link=link,
                        ),
                    )
                except sendmail.SendError as e:
                    await audit.record(
                        db,
                        workspace_id,
                        f"user:{by_user}",
                        "task.email_failed",
                        target=task_id,
                        after={"to_user": uid, "why": e.kind},
                    )
                    await db.commit()
                    if e.kind in ("not_configured", "app_refused", "denied", "no_mailbox"):
                        return  # every other email would fail the same way
                    continue
                await audit.record(
                    db,
                    workspace_id,
                    f"user:{by_user}",
                    "task.email_sent",
                    target=task_id,
                    after={"to_user": uid},
                )
                await db.commit()
    except Exception:  # noqa: BLE001 - a background email must never take the API down
        log.exception("task email failed for %s", task_id)
