"""Tests run against the compose Postgres and Valkey, in a separate database and Valkey DB.

Needs: `docker compose up -d postgres valkey` (dev ports 8506 / 8507).
"""

import asyncio
import os
import shutil
import stat
import tempfile
from pathlib import Path

# Point the app at test resources before anything imports agentic.core.config.
PG = os.environ.get("TEST_PG", "agentic:agentic_dev@localhost:8506")
os.environ["AGENTIC_DATABASE_URL"] = f"postgresql+asyncpg://{PG}/agentic_test"
os.environ["AGENTIC_VALKEY_URL"] = os.environ.get("TEST_VALKEY", "redis://localhost:8507/15")
os.environ["AGENTIC_ENV"] = "dev"
# Fake provider hosts used by test_ai_engine.py skip DNS in the SSRF guard.
os.environ["AGENTIC_PRIVATE_HOSTS_ALLOWED"] = "good.fake,ratelimit.fake,broken.fake,flaky.fake"
# Brain: deterministic word-hash embeddings (no model download) and a throwaway vault.
os.environ["AGENTIC_EMBED_BACKEND"] = "hash"
# Channels: a fake push service and a fake Telegram API (see test_channels.py).
os.environ["AGENTIC_PUSH_HOSTS_ALLOWED"] = "push.fake"
os.environ["AGENTIC_TELEGRAM_API_BASE"] = "https://tg.fake"
os.environ["AGENTIC_RECALL_MIN_SIMILARITY"] = "0.3"
VAULT_DIR = Path(tempfile.mkdtemp(prefix="agentic-vault-"))
os.environ["AGENTIC_VAULT_DIR"] = str(VAULT_DIR)

import asyncpg  # noqa: E402
import httpx  # noqa: E402
import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import text  # noqa: E402


async def _recreate_test_db() -> None:
    conn = await asyncpg.connect(f"postgresql://{PG}/postgres")
    try:
        await conn.execute("DROP DATABASE IF EXISTS agentic_test WITH (FORCE)")
        await conn.execute("CREATE DATABASE agentic_test")
    finally:
        await conn.close()


def _migrate() -> None:
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.attributes["database_url"] = os.environ["AGENTIC_DATABASE_URL"]
    command.upgrade(cfg, "head")


@pytest.fixture(scope="session", autouse=True)
async def database():
    await _recreate_test_db()
    # Alembic's env.py calls asyncio.run, which can't nest inside the test loop.
    await asyncio.to_thread(_migrate)
    yield
    from agentic.core.db import engine

    await engine.dispose()


TABLES = (
    "packs",
    "document_versions",
    "documents",
    "doc_templates",
    "company_kits",
    "files",
    "workflows",
    "blueprints",
    "reports",
    "credentials",
    "incidents",
    "job_runs",
    "schedules",
    "agent_pings",
    "budget_grants",
    "meeting_turns",
    "meetings",
    "deliveries",
    "action_tokens",
    "push_subscriptions",
    "bindings",
    "channel_links",
    "channels",
    "api_tokens",
    "instance_secrets",
    "skill_eval_cases",
    "skill_uses",
    "skill_versions",
    "skill_proposals",
    "skills",
    "brain_dreams",
    "brain_links",
    "brain_chunks",
    "brain_facts",
    "brain_pages",
    "events",
    "broadcast_receipts",
    "broadcasts",
    "approvals",
    "task_events",
    "agent_messages",
    "chat_sessions",
    "tasks",
    "agents",
    "sops",
    "llm_calls",
    "ai_provider_checks",
    "ai_models",
    "model_groups",
    "ai_providers",
    "audit_log",
    "auth_sessions",
    "departments",
    "branches",
    "memberships",
    "users",
    "workspaces",
)


@pytest.fixture(autouse=True)
async def clean(database):
    from agentic.core.db import engine
    from agentic.core.valkey import valkey

    async with engine.begin() as conn:
        # TRUNCATE skips row triggers, so the append-only audit trigger does not fire here.
        await conn.execute(text(f"TRUNCATE {', '.join(TABLES)} RESTART IDENTITY CASCADE"))
    await valkey().flushdb()
    _wipe_vault()
    yield


def _wipe_vault() -> None:
    def writable(func, path, _exc):  # git marks pack files read-only (matters on Windows)
        os.chmod(path, stat.S_IWRITE)
        func(path)

    for child in VAULT_DIR.iterdir():
        shutil.rmtree(child, onexc=writable) if child.is_dir() else child.unlink()


@pytest.fixture
async def client():
    from agentic.api.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


def csrf(c: httpx.AsyncClient) -> dict[str, str]:
    return {"x-csrf-token": c.cookies.get("agentic_csrf") or ""}


async def setup_owner(c: httpx.AsyncClient, email: str = "owner@example.com") -> dict:
    r = await c.post(
        "/api/auth/setup",
        json={
            "workspace_name": "Acme Group",
            "name": "Owner One",
            "email": email,
            "password": "correct-horse-battery",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()
