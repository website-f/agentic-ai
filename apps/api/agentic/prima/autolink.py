"""P109: members are linked to Prima when they are added (Fitri, 17 Nov 2026: "whatever members
are added in the Agentic Office, make them auto linked").

After an add is saved (Members > Add, Import from Excel, `python -m agentic.members_import`),
the people added are linked by the same path as their first Prima open (client.ensure): their
own staff record when the match is sure, else their own Prima account at the level of their
office role, in the Prima company of their branch. Owners and admins open Prima as its top
record and need nothing. In the api it runs after the answer has gone (a background task), so
it never holds up or undoes the add. A refusal (no company for their branch yet, Prima not
answering) is logged by reason, never by name, and tried again when they first open Prima.
Everyone added before P109: `python -m agentic.prima.link_all`.
"""

import logging
from collections import Counter
from collections.abc import Iterable

from fastapi import BackgroundTasks

from ..core.db import SessionLocal
from . import client

log = logging.getLogger(__name__)

# Tests that check the link made on the first Prima open switch this off (test_p66 prima_on).
on = True


def later(background: BackgroundTasks, workspace_id: str, user_ids: Iterable[str]) -> None:
    """Link these people once the add is saved and answered (the caller has committed)."""
    ids = [u for u in user_ids if u]
    if on and ids and client.enabled(workspace_id):
        background.add_task(link_now, workspace_id, ids)


async def link_now(workspace_id: str, user_ids: Iterable[str]) -> Counter[str]:
    """Link each of them now, in a session of its own; what happened, counted (client.OUTCOMES,
    or "refused:<code>" / "failed"). Never raises."""
    counts: Counter[str] = Counter()
    records: list[client.StaffRecord] | None = None
    try:
        async with SessionLocal() as db:
            for uid in user_ids:
                try:
                    if records is None:
                        records = client.matchable(await client.staff())
                    _, how = await client.ensure(db, workspace_id, uid, records=records)
                    counts[how] += 1
                except client.PrimaError as e:
                    await db.rollback()
                    counts[f"refused:{e.code or 'other'}"] += 1
                    log.info("prima autolink: %s not linked yet (%s)", uid, e.code or e.status)
                except Exception:
                    await db.rollback()
                    counts["failed"] += 1
                    log.exception("prima autolink: %s not linked (tried on first open)", uid)
    except Exception:  # the database itself: nothing linked, nothing lost
        log.exception("prima autolink: stopped (everyone left is linked on first open)")
        counts["failed"] += 1
    return counts
