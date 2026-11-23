"""P122: work or personal: which of a person's mailboxes belong to the company.

Fitri, 21 Nov 2026: "users connect their private email, which is also Outlook, and their work
email uses the company domain; they must be separated."

The office keeps no list of verified domains, so the company's domains are read from what the
office already knows to be the company's:

1. the address of every shared mailbox an admin added (Channels > Microsoft 365: accounts@,
   tender@ are company addresses by definition),
2. the address of every member's MAIN Microsoft account here (their work sign-in), and
3. the person's own sign-in email,

leaving out consumer domains (outlook.com, hotmail.*, live.*, msn.com, gmail.com, yahoo.*,
icloud.com ...), which are never a company's.

A Microsoft account is "work" when it is the person's main account, or its address is on a
company domain, or it signed in to the same Microsoft tenant as their main account (or the
tenant an admin consented in): a company with a second domain in the same tenant. Everything
else (outlook.com, hotmail, another company's domain) is "personal".
"""

from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import MicrosoftAccount, SharedMailbox

Kind = Literal["work", "personal"]

# Microsoft's tenant for personal accounts (outlook.com, hotmail, live): never a company's.
CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad"

# Free mail anyone can sign up for: never a company's domain.
CONSUMER_DOMAINS = frozenset(
    {
        "outlook.com",
        "msn.com",
        "passport.com",
        "gmail.com",
        "googlemail.com",
        "ymail.com",
        "rocketmail.com",
        "aol.com",
        "aim.com",
        "icloud.com",
        "me.com",
        "mac.com",
        "zoho.com",
        "zohomail.com",
        "gmx.com",
        "gmx.net",
        "gmx.de",
        "mail.com",
        "yandex.com",
        "yandex.ru",
        "ya.ru",
        "proton.me",
        "protonmail.com",
        "fastmail.com",
        "tm.net.my",
    }
)
# hotmail.co.uk, live.com.my, yahoo.com.my ...: the brand is the first label.
CONSUMER_BRANDS = frozenset({"hotmail", "live", "outlook", "yahoo", "windowslive"})


def domain_of(email: str | None) -> str:
    e = (email or "").strip().lower()
    return e.rsplit("@", 1)[1].rstrip(".") if "@" in e else ""


def is_consumer(domain: str) -> bool:
    d = domain.strip().lower()
    return bool(d) and (d in CONSUMER_DOMAINS or d.split(".", 1)[0] in CONSUMER_BRANDS)


async def company_domains(db: AsyncSession, workspace_id: str, user_email: str) -> list[str]:
    """The company's email domains, as far as the office knows them (see the module note)."""
    found = {domain_of(user_email)}
    shared = await db.scalars(
        select(SharedMailbox.address).where(SharedMailbox.workspace_id == workspace_id)
    )
    found |= {domain_of(a) for a in shared}
    mains = await db.scalars(
        select(func.distinct(func.split_part(func.lower(MicrosoftAccount.email), "@", 2))).where(
            MicrosoftAccount.workspace_id == workspace_id,
            MicrosoftAccount.is_primary.is_(True),
            MicrosoftAccount.status != "pending",  # P124: not the company's until approved
            MicrosoftAccount.email != "",
        )
    )
    found |= {d for d in mains if d}
    return sorted(d for d in found if d and not is_consumer(d))


def work_tenants(main: MicrosoftAccount | None, app_tenant: str | None) -> set[str]:
    out = {main.tenant_id if main else "", app_tenant or ""}
    return {t.lower() for t in out if t and t.lower() != CONSUMER_TENANT}


def kind_of(acct: MicrosoftAccount, domains: list[str] | set[str], tenants: set[str]) -> Kind:
    if acct.is_primary:
        return "work"
    d = domain_of(acct.email)
    if is_consumer(d):
        return "personal"
    if d in domains or (acct.tenant_id or "").lower() in tenants:
        return "work"
    return "personal"
