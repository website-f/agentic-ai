"""Dev test logins, created on `docker compose up` so every PC starts with the same accounts.

Runs after migrations (see the api command in docker-compose.yml). It does nothing unless
env=dev and AGENTIC_DEV_SEED is on, and nothing once any user exists, so it never touches a
real install or an install someone already set up by hand.

    python -m agentic.seed
"""

import asyncio

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from .api.routers.org import DEFAULT_DEPARTMENTS
from .core.config import settings
from .core.db import SessionLocal, engine
from .core.security import hash_password
from .models import Branch, Department, Membership, User, Workspace
from .services import audit
from .services.text import slugify

# (role, name, email local part). The owner comes first and owns the workspace.
ACCOUNTS = (
    ("owner", "Test Owner", "owner"),
    ("admin", "Test Admin", "admin"),
    ("operator", "Test Operator", "operator"),
    ("approver", "Test Approver", "approver"),
    ("viewer", "Test Viewer", "viewer"),
)


async def seed(db: AsyncSession) -> list[str]:
    """Create the test workspace and logins. Returns the emails created (empty if skipped)."""
    # Same lock as the setup page, so the setup form and this script can't both win.
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext('agentic:setup'))"))
    if await db.scalar(select(func.count()).select_from(User)):
        return []

    name = settings.seed_workspace
    ws = Workspace(name=name, slug=slugify(name, "workspace"))
    db.add(ws)
    await db.flush()

    password = hash_password(settings.seed_password)
    emails = []
    owner_id = ""
    for role, person, local in ACCOUNTS:
        email = f"{local}@{settings.seed_email_domain}"
        user = User(email=email, name=person, password_hash=password)
        db.add(user)
        await db.flush()
        db.add(Membership(workspace_id=ws.id, user_id=user.id, role=role))
        owner_id = owner_id or user.id
        emails.append(email)

    branch = Branch(
        workspace_id=ws.id, name=settings.seed_branch, slug=slugify(settings.seed_branch)
    )
    db.add(branch)
    await db.flush()
    db.add_all(
        Department(workspace_id=ws.id, branch_id=branch.id, name=n, slug=slugify(n), position=i)
        for i, n in enumerate(DEFAULT_DEPARTMENTS)
    )
    await audit.record(
        db,
        ws.id,
        f"user:{owner_id}",
        "workspace.created",
        target=ws.id,
        after={"name": ws.name, "owner_email": emails[0], "seeded": True},
        note="Dev test logins (AGENTIC_DEV_SEED)",
    )
    await db.commit()
    return emails


async def main() -> None:
    if not settings.is_dev or not settings.dev_seed:
        print("seed: skipped (only runs with AGENTIC_ENV=dev and AGENTIC_DEV_SEED=true)")
        return
    try:
        async with SessionLocal() as db:
            emails = await seed(db)
    finally:
        await engine.dispose()
    if emails:
        print(
            f"seed: created workspace {settings.seed_workspace!r} with logins {', '.join(emails)}"
        )
        print("seed: password is AGENTIC_SEED_PASSWORD (see .env.example)")
    else:
        print("seed: users already exist, nothing to do")


if __name__ == "__main__":
    asyncio.run(main())
