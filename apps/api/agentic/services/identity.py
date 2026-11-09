"""P92: correcting who a person is: their name or sign-in email, or the Microsoft account the
office linked them to.

A wrong email in an import can bind the wrong Microsoft account (Sign in with Microsoft
matches the office email to the account's mail or UPN, then keeps the binding by its object
ID). Correcting it therefore lets go of everything that binding made, so the person's next
Microsoft sign-in links the account of the new email, everywhere:

- Membership.ms_oid / ms_tenant_id (what Prima knows them by) are cleared;
- their own Microsoft connection (MicrosoftAccount, also the sign-in binding) is disconnected
  the way they would disconnect it themselves (subscriptions, tokens and the mail it synced
  are deleted) and its object ID forgotten; their next Microsoft sign-in connects it again;
- every session they have is ended (they sign in again);
- Prima: a link made from the old identity (how="microsoft" or "name") is removed, and their
  own Prima account (how="auto") is marked to be relinked the next time they open Prima,
  keeping its Prima id, so their Prima history stays theirs. A link the owner set by hand
  (how="owner") stays; the owner changes it on the Prima page.
"""

from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AuthSession, Membership, MicrosoftAccount, PrimaLink


async def sign_out_everywhere(db: AsyncSession, user_id: str) -> int:
    """End every session this person has (every device, every workspace). Caller commits."""
    n = await db.scalar(
        select(func.count()).select_from(AuthSession).where(AuthSession.user_id == user_id)
    )
    await db.execute(delete(AuthSession).where(AuthSession.user_id == user_id))
    return int(n or 0)


async def let_go_of_microsoft(db: AsyncSession, workspace_id: str, user_id: str) -> dict[str, Any]:
    """Undo the Microsoft binding and what was made from it (see the module doc). Commits
    (disconnecting a mailbox does). Returns what changed, for the audit entry."""
    from ..microsoft import sync

    done: dict[str, Any] = {}
    m = await db.get(Membership, (workspace_id, user_id))
    if m is not None and (m.ms_oid or m.ms_tenant_id):
        m.ms_oid = None
        m.ms_tenant_id = None
        done["microsoft_link"] = "cleared"
    acct = await db.scalar(
        select(MicrosoftAccount).where(
            MicrosoftAccount.workspace_id == workspace_id, MicrosoftAccount.user_id == user_id
        )
    )
    if acct is not None:
        if acct.status != "disconnected":
            await sync.disconnect_account(db, acct)  # commits
            done["mailbox"] = "disconnected"
        if acct.ms_user_id or acct.tenant_id:
            acct.ms_user_id = ""
            acct.tenant_id = ""
            done.setdefault("mailbox", "unbound")
    prima = await prima_follows(db, workspace_id, user_id)
    if prima:
        done["prima"] = prima
    await db.commit()
    return done


async def prima_follows(
    db: AsyncSession, workspace_id: str, user_id: str, *, name_only: bool = False
) -> str | None:
    """Their Prima link after a correction: what happened to it, or None. A new name changes
    only what was found by name (and their own account's name); a new email or Microsoft
    link also what was found by the old Microsoft account. Caller commits."""
    link = await db.get(PrimaLink, (workspace_id, user_id))
    if link is None:
        return None
    if link.how == "name" or (link.how == "microsoft" and not name_only):
        await db.delete(link)
        return f"unlinked from {link.prima_user_id} (found again on their next visit)"
    if link.how == "auto":
        link.relink_needed = True
        return f"{link.prima_user_id} relinked on their next visit"
    return None  # set by the owner: kept
