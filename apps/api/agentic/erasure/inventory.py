"""Where one workspace's data lives.

Database: read from the live schema, not a hand-kept list, so a table added next month is
covered without touching this file:
- every base table with a workspace_id column ("owned" tables);
- tables without one that hang off an owned table by a foreign key (document versions,
  meeting turns, skill versions...): their rows are the ones whose parent is owned;
- users: the workspace's members (those only in this workspace are deleted on erase).

Outside the database: file bytes in storage targets (agentic/<ws>/... and pc-backups/<ws>/...
keys), the brain vault's git folder, Valkey keys that carry one of the workspace's ids,
Temporal workflows and schedules, and the export ZIPs on this server's disk.
"""

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings

# Server-level tables: never a workspace's, never exported or erased per workspace.
SERVER_TABLES = {"alembic_version", "instance_secrets", "erasure_records", "workspaces", "users"}
SKIP_TYPES = {"bytea", "tsvector", "USER-DEFINED"}  # file bytes, search indexes, embeddings

# Columns whose value is a secret (or proves one): exported as "[redacted]".
SECRET_COLUMNS = {
    "password_hash",
    "token_hash",
    "code_hash",
    "client_state_hash",
    "webhook_hash",
    "access_hash",
    "recovery_codes",
    "totp_last_step",
    "auth",  # push subscription auth secret
    "p256dh",
}
# Keys inside JSON values that hold a secret.
SECRET_KEYS = {
    "password",
    "passwd",
    "secret",
    "secret_key",
    "client_secret",
    "app_secret",
    "webhook_secret",
    "signing_secret",
    "token",
    "access_token",
    "refresh_token",
    "id_token",
    "bot_token",
    "verify_token",
    "api_key",
    "apikey",
    "access_key",
    "authorization",
    "auth_header",
    "cookie",
    "cookies",
    "private_key",
    "session_token",
}
REDACTED = "[redacted]"

_IDENT = re.compile(r"^[a-z_][a-z0-9_]*$")


def secret_column(name: str) -> bool:
    return name.endswith("_enc") or name in SECRET_COLUMNS


def redact_json(value: Any) -> Any:
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            key = str(k).lower()
            if (key.endswith("_enc") or key in SECRET_KEYS) and v not in (None, "", [], {}):
                out[k] = REDACTED
            else:
                out[k] = redact_json(v)
        return out
    if isinstance(value, list):
        return [redact_json(v) for v in value]
    return value


@dataclass
class Table:
    name: str
    columns: list[tuple[str, str]]  # (name, data_type), exportable ones
    skipped: list[str]  # columns not exported (bytes, embeddings, search indexes)
    owned_sql: str  # WHERE clause selecting this workspace's rows (uses :ws)
    direct: bool  # has a workspace_id column
    parent: str | None = None


@dataclass
class Schema:
    tables: dict[str, Table] = field(default_factory=dict)

    @property
    def direct(self) -> list[str]:
        return [t for t, v in self.tables.items() if v.direct]

    @property
    def children(self) -> list[str]:
        return [t for t, v in self.tables.items() if not v.direct]


async def schema(db: AsyncSession) -> Schema:
    """Every table holding this workspace's rows, and how to select them."""
    rows = (
        await db.execute(
            text(
                "SELECT c.table_name, c.column_name, c.data_type FROM information_schema.columns c "
                "JOIN information_schema.tables t ON t.table_name = c.table_name "
                "AND t.table_schema = c.table_schema "
                "WHERE c.table_schema = current_schema() AND t.table_type = 'BASE TABLE' "
                "ORDER BY c.table_name, c.ordinal_position"
            )
        )
    ).all()
    cols: dict[str, list[tuple[str, str]]] = {}
    for table, col, dtype in rows:
        cols.setdefault(table, []).append((col, dtype))
    fks = (
        await db.execute(
            text(
                "SELECT cl.relname AS child, a.attname AS col, pcl.relname AS parent, "
                "pa.attname AS pcol, con.confdeltype AS rule "
                "FROM pg_constraint con "
                "JOIN pg_class cl ON cl.oid = con.conrelid "
                "JOIN pg_namespace ns ON ns.oid = cl.relnamespace "
                "JOIN pg_class pcl ON pcl.oid = con.confrelid "
                "JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1] "
                "JOIN pg_attribute pa ON pa.attrelid = con.confrelid "
                "AND pa.attnum = con.confkey[1] "
                "WHERE con.contype = 'f' AND array_length(con.conkey, 1) = 1 "
                "AND ns.nspname = current_schema() ORDER BY cl.relname, a.attname"
            )
        )
    ).all()
    out = Schema()

    def add(name: str, owned: str, direct: bool, parent: str | None = None) -> None:
        keep = [(c, d) for c, d in cols[name] if d not in SKIP_TYPES]
        skipped = [c for c, d in cols[name] if d in SKIP_TYPES]
        out.tables[name] = Table(name, keep, skipped, owned, direct, parent)

    for name, cs in cols.items():
        if name in SERVER_TABLES or not _IDENT.match(name):
            continue
        if any(c == "workspace_id" for c, _ in cs):
            add(name, "workspace_id = :ws", True)
    # Children: owned through a cascading foreign key to an owned table (a few levels deep).
    for _ in range(4):
        grew = False
        for child, col, parent, pcol, rule in fks:
            if child in out.tables or child in SERVER_TABLES or parent not in out.tables:
                continue
            if rule != "c" or not (_IDENT.match(col) and _IDENT.match(pcol)):
                continue
            parent_sql = out.tables[parent].owned_sql
            owned = f"{col} IN (SELECT {pcol} FROM {parent} WHERE {parent_sql})"  # noqa: S608
            add(child, owned, False, parent)
            grew = True
        if not grew:
            break
    return out


MEMBERS_SQL = "id IN (SELECT user_id FROM memberships WHERE workspace_id = :ws)"
ONLY_HERE_SQL = (
    "SELECT user_id FROM memberships WHERE workspace_id = :ws AND user_id NOT IN "
    "(SELECT user_id FROM memberships WHERE workspace_id <> :ws)"
)


async def users_only_here(db: AsyncSession, ws_id: str) -> list[str]:
    return list((await db.scalars(text(ONLY_HERE_SQL), {"ws": ws_id})).all())


async def counts(db: AsyncSession, ws_id: str, sch: Schema | None = None) -> dict[str, int]:
    """Rows per table (only tables with rows), plus users and the workspace itself."""
    sch = sch or await schema(db)
    out: dict[str, int] = {}
    for name, t in sorted(sch.tables.items()):
        n = int(
            await db.scalar(text(f"SELECT count(*) FROM {name} WHERE {t.owned_sql}"), {"ws": ws_id})  # noqa: S608 - names from the live schema
            or 0
        )
        if n:
            out[name] = n
    out["users"] = int(
        await db.scalar(text(f"SELECT count(*) FROM users WHERE {MEMBERS_SQL}"), {"ws": ws_id})  # noqa: S608
        or 0
    )
    out["workspaces"] = 1
    return out


# Categories for the certificate: which tables make up what people would call "their data".
CATEGORIES: dict[str, tuple[str, ...]] = {
    "Agents, tasks and conversations": (
        "agents",
        "tasks",
        "task_events",
        "agent_messages",
        "chat_sessions",
        "approvals",
        "broadcasts",
        "meetings",
        "meeting_turns",
        "reports",
        "schedules",
        "routines",
        "workflow_runs",
    ),
    "Prompts, AI calls and logs": ("llm_calls", "audit_log", "events", "job_runs", "deliveries"),
    "Files and documents": ("files", "documents", "document_versions", "packs", "doc_templates"),
    "Memory (brain), embeddings and search indexes": (
        "brain_pages",
        "brain_chunks",
        "brain_facts",
        "brain_links",
        "brain_dreams",
        "knowledge_chunks",
    ),
    "CRM, contacts and money": (
        "crm_objects",
        "crm_fields",
        "crm_records",
        "parties",
        "party_contacts",
        "deals",
        "money_docs",
        "payments",
        "interactions",
    ),
    "Mail and calendar": ("mail_items", "email_drafts", "calendar_proposals", "mail_rules"),
    "Meeting recordings": ("meeting_recordings",),
    "People and access": ("memberships", "users", "auth_sessions", "api_tokens", "crm_access"),
}


def categorize(table_counts: dict[str, int]) -> dict[str, int]:
    out: dict[str, int] = {}
    placed: set[str] = set()
    for cat, tables in CATEGORIES.items():
        n = sum(table_counts.get(t, 0) for t in tables)
        placed.update(tables)
        if n:
            out[cat] = n
    other = sum(n for t, n in table_counts.items() if t not in placed and t != "workspaces")
    if other:
        out["Settings, integrations and everything else"] = other
    return out


def _host(url: str) -> str:
    try:
        return urlparse(url).hostname or ""
    except ValueError:
        return ""


async def providers(db: AsyncSession, ws_id: str) -> list[dict[str, str]]:
    """Outside services this workspace sent data to: they keep it under their own terms."""
    from sqlalchemy import select

    from ..models import (
        AIProvider,
        Channel,
        CrmConnector,
        GoogleAccount,
        Integration,
        McpServer,
        MicrosoftAccount,
        StorageTarget,
    )

    out: list[dict[str, str]] = []
    for p in (await db.scalars(select(AIProvider).where(AIProvider.workspace_id == ws_id))).all():
        if p.tier == "local":
            continue
        out.append({"kind": "AI provider", "name": p.name, "where": _host(p.base_url)})
    for t in (
        await db.scalars(select(StorageTarget).where(StorageTarget.workspace_id == ws_id))
    ).all():
        c = t.config or {}
        where = _host(str(c.get("endpoint") or c.get("url") or "")) or "this server"
        if c.get("bucket"):
            where = f"{where} / {c['bucket']}"
        out.append({"kind": f"Storage ({t.kind})", "name": t.name, "where": where})
    for ch in (await db.scalars(select(Channel).where(Channel.workspace_id == ws_id))).all():
        out.append({"kind": "Messaging channel", "name": ch.name, "where": ch.kind})
    n_ms = len(
        (
            await db.scalars(select(MicrosoftAccount).where(MicrosoftAccount.workspace_id == ws_id))
        ).all()
    )
    if n_ms:
        out.append({"kind": "Mail and calendar", "name": "Microsoft 365", "where": f"{n_ms}"})
    n_g = len(
        (await db.scalars(select(GoogleAccount).where(GoogleAccount.workspace_id == ws_id))).all()
    )
    if n_g:
        out.append({"kind": "Mail and calendar", "name": "Google", "where": f"{n_g}"})
    for m in (await db.scalars(select(McpServer).where(McpServer.workspace_id == ws_id))).all():
        out.append({"kind": "Tool server (MCP)", "name": m.name, "where": _host(m.url)})
    for c in (
        await db.scalars(select(CrmConnector).where(CrmConnector.workspace_id == ws_id))
    ).all():
        where = _host(str((c.config or {}).get("base_url") or (c.config or {}).get("url") or ""))
        out.append({"kind": "CRM connector", "name": c.name, "where": where or c.kind})
    for i in (await db.scalars(select(Integration).where(Integration.workspace_id == ws_id))).all():
        out.append({"kind": "Integration", "name": i.kind, "where": ""})
    return out


# ---------------------------------------------------------------- outside the database


def files_root() -> Path:
    return Path(settings.files_dir).resolve()


def exports_dir(ws_id: str) -> Path:
    """Export ZIPs. A dot folder: storage folder names are [A-Za-z0-9_-], so no target's
    folder can ever be this one."""
    return Path(settings.files_dir).resolve() / ".exports" / ws_id


def erasure_dir(record_id: str) -> Path:
    """The certificate (and the working notes of an erase in progress), server level."""
    return Path(settings.files_dir).resolve() / ".erasure" / record_id


def storage_prefixes(ws_id: str) -> list[str]:
    from ..devices.backup import KEY_ROOT

    return [f"agentic/{ws_id}/", f"{KEY_ROOT}/{ws_id}/"]


# Tables whose ids may appear in a Valkey key (agent:<id>, browser:task:<id>, gtok:<id>...).
KEY_ID_TABLES = (
    "agents",
    "tasks",
    "devices",
    "chat_sessions",
    "channels",
    "microsoft_accounts",
    "google_accounts",
    "shared_mailboxes",
    "meetings",
    "schedules",
    "workflow_runs",
    "documents",
    "files",
    "approvals",
    "broadcasts",
    "branches",
    "departments",
    "credentials",
    "crm_connectors",
    "storage_targets",
    "mcp_servers",
    "ai_providers",
    "meeting_recordings",
    "auth_sessions",
)


async def key_ids(db: AsyncSession, ws_id: str) -> set[str]:
    """Ids that, found in a Valkey key, make the key this workspace's."""
    ids = {ws_id}
    present = set(
        (
            await db.scalars(
                text(
                    "SELECT table_name FROM information_schema.columns WHERE table_schema = "
                    "current_schema() AND column_name = 'workspace_id' AND table_name = ANY(:t)"
                ),
                {"t": list(KEY_ID_TABLES)},
            )
        ).all()
    )
    for t in KEY_ID_TABLES:
        if t in present:
            ids.update(
                str(x)
                for x in (
                    await db.scalars(
                        text(f"SELECT id FROM {t} WHERE workspace_id = :ws"),  # noqa: S608
                        {"ws": ws_id},
                    )
                ).all()
            )
    ids.update(await users_only_here(db, ws_id))
    return {i for i in ids if i and len(i) >= 6}
