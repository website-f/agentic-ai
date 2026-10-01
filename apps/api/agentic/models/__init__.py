"""SQLAlchemy models. Every tenant-owned row carries workspace_id; queries filter on it."""

from datetime import date, datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Computed,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.db import Base, Timestamps
from ..core.ids import new_id
from ..core.security import ROLES

_ROLE_CHECK = "role IN (" + ", ".join(f"'{r}'" for r in ROLES) + ")"


class Workspace(Timestamps, Base):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("ws"))
    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kuala_Lumpur")
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)


class User(Timestamps, Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("us"))
    email: Mapped[str] = mapped_column(String(254), unique=True)  # stored lowercased
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Membership(Timestamps, Base):
    __tablename__ = "memberships"
    __table_args__ = (CheckConstraint(_ROLE_CHECK, name="ck_memberships_role"),)

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[str] = mapped_column(String(16))

    user: Mapped[User] = relationship(lazy="joined")


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # sha256(token)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    user_agent: Mapped[str | None] = mapped_column(String(400))
    ip: Mapped[str | None] = mapped_column(String(64))


class Branch(Timestamps, Base):
    """One branch per company. Agents, offices and vault sections hang off a branch."""

    __tablename__ = "branches"
    __table_args__ = (UniqueConstraint("workspace_id", "slug", name="uq_branches_ws_slug"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("br"))
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(80))
    color: Mapped[str] = mapped_column(String(16), default="#13895f")
    isolated: Mapped[bool] = mapped_column(Boolean, default=False)

    departments: Mapped[list["Department"]] = relationship(
        back_populates="branch",
        order_by="Department.position",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class Department(Timestamps, Base):
    __tablename__ = "departments"
    __table_args__ = (UniqueConstraint("branch_id", "slug", name="uq_departments_branch_slug"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("dp"))
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    branch_id: Mapped[str] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(80))
    position: Mapped[int] = mapped_column(Integer, default=0)

    branch: Mapped[Branch] = relationship(back_populates="departments")


class AuditLog(Base):
    """Append-only, hash-chained. A DB trigger (migration 0001) rejects UPDATE and DELETE."""

    __tablename__ = "audit_log"
    __table_args__ = (Index("ix_audit_ws_id", "workspace_id", "id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(String(40))
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    actor: Mapped[str] = mapped_column(String(80))
    action: Mapped[str] = mapped_column(String(80))
    target: Mapped[str | None] = mapped_column(String(120))
    before: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    note: Mapped[str | None] = mapped_column(Text)
    prev_hash: Mapped[str | None] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))


# ---------------------------------------------------------------- AI Engine


class AIProvider(Timestamps, Base):
    """One connected AI provider account. The key is envelope-encrypted (core/crypto.py)
    with the row id as associated data; the API only ever returns `key_hint`."""

    __tablename__ = "ai_providers"
    __table_args__ = (UniqueConstraint("workspace_id", "name", name="uq_ai_providers_ws_name"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("ap"))
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(80))
    preset: Mapped[str | None] = mapped_column(String(40))
    base_url: Mapped[str] = mapped_column(String(300))
    api_key_enc: Mapped[str] = mapped_column(Text, default="")
    key_hint: Mapped[str] = mapped_column(String(16), default="")
    key_version: Mapped[int] = mapped_column(Integer, default=1)
    tier: Mapped[str] = mapped_column(String(16), default="paid")  # free | paid | local
    priority: Mapped[int] = mapped_column(Integer, default=100)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    health: Mapped[str] = mapped_column(String(16), default="unknown")  # unknown|ok|degraded|down
    last_test_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_test_result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    @property
    def aad(self) -> str:
        return f"ai_provider:{self.id}"


class AIModel(Base):
    """A model a provider offers, with what we learned about it and its price."""

    __tablename__ = "ai_models"
    __table_args__ = (
        UniqueConstraint("provider_id", "model_id", name="uq_ai_models_provider_model"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("am"))
    workspace_id: Mapped[str] = mapped_column(String(40), index=True)
    provider_id: Mapped[str] = mapped_column(ForeignKey("ai_providers.id", ondelete="CASCADE"))
    model_id: Mapped[str] = mapped_column(String(200))
    context_window: Mapped[int | None] = mapped_column(Integer)
    # tools / json / vision / embed / reasoning: True, False, or absent = not tested yet.
    caps: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    # USD per 1M tokens. Null = unknown (cost shows as unpriced, not as zero).
    price_in: Mapped[float | None] = mapped_column(Numeric(12, 4))
    price_out: Mapped[float | None] = mapped_column(Numeric(12, 4))
    price_cached_in: Mapped[float | None] = mapped_column(Numeric(12, 4))
    stale: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ModelGroup(Timestamps, Base):
    """Agents ask for a group ("smart"), never a provider. Members are tried in order."""

    __tablename__ = "model_groups"
    __table_args__ = (UniqueConstraint("workspace_id", "name", name="uq_model_groups_ws_name"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("mg"))
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(40))
    label: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(String(300), default="")
    members: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    position: Mapped[int] = mapped_column(Integer, default=0)


class LLMCall(Base):
    """One row per model call attempt, successful or not. Provider is stored by id and
    name without a foreign key, so deleting a provider keeps its history."""

    __tablename__ = "llm_calls"
    __table_args__ = (Index("ix_llm_calls_ws_ts", "workspace_id", "ts"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(String(40))
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    task: Mapped[str] = mapped_column(String(60))
    group_name: Mapped[str | None] = mapped_column(String(40))
    provider_id: Mapped[str | None] = mapped_column(String(40))
    provider_name: Mapped[str] = mapped_column(String(80))
    model: Mapped[str] = mapped_column(String(200))
    agent_id: Mapped[str | None] = mapped_column(String(40))
    task_id: Mapped[str | None] = mapped_column(String(40))
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cached_tokens: Mapped[int] = mapped_column(Integer, default=0)
    reasoning_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float | None] = mapped_column(Numeric(14, 6))
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16))  # ok | error
    error_class: Mapped[str | None] = mapped_column(String(40))


class ProviderCheck(Base):
    """Scheduled and manual health checks, for the health sparkline."""

    __tablename__ = "ai_provider_checks"
    __table_args__ = (Index("ix_ai_provider_checks_provider_ts", "provider_id", "ts"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    provider_id: Mapped[str] = mapped_column(ForeignKey("ai_providers.id", ondelete="CASCADE"))
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ok: Mapped[bool] = mapped_column(Boolean)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    error_class: Mapped[str | None] = mapped_column(String(40))
    source: Mapped[str] = mapped_column(String(16), default="manual")  # manual | scheduled


# ---------------------------------------------------------------- Agents and work


class SOP(Timestamps, Base):
    """Standard operating procedure. Workspace, branch and department SOPs apply to every
    agent in that scope automatically; library SOPs apply only where attached."""

    __tablename__ = "sops"
    __table_args__ = (
        CheckConstraint(
            "scope IN ('workspace', 'branch', 'department', 'library')", name="ck_sops_scope"
        ),
        Index("ix_sops_ws_scope", "workspace_id", "scope", "scope_id"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("sp"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    scope: Mapped[str] = mapped_column(String(16))
    scope_id: Mapped[str | None] = mapped_column(String(40))  # branch or department id
    title: Mapped[str] = mapped_column(String(160))
    body: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_by: Mapped[str | None] = mapped_column(String(80))


class Agent(Timestamps, Base):
    __tablename__ = "agents"
    __table_args__ = (
        UniqueConstraint("workspace_id", "slug", name="uq_agents_ws_slug"),
        CheckConstraint("status IN ('active', 'paused', 'retired')", name="ck_agents_status"),
        CheckConstraint("autonomy IN ('ask', 'auto')", name="ck_agents_autonomy"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("ag"))
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    branch_id: Mapped[str] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"))
    department_id: Mapped[str | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL")
    )
    slug: Mapped[str] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(String(80))
    role: Mapped[str] = mapped_column(String(120))  # job title, e.g. "Senior Accountant"
    template: Mapped[str | None] = mapped_column(String(40))
    role_kind: Mapped[str] = mapped_column(String(16), default="leaf")  # leaf | orchestrator
    soul: Mapped[str] = mapped_column(Text, default="")
    model_group: Mapped[str] = mapped_column(String(40), default="smart")
    # {tool_name: "allow" | "ask" | "deny"}; tools not listed use the tool's default mode.
    tools: Mapped[dict[str, str]] = mapped_column(JSONB, default=dict)
    autonomy: Mapped[str] = mapped_column(String(8), default="ask")
    sop_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)  # attached library SOPs
    reports_to: Mapped[str | None] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(16), default="active")
    color: Mapped[str] = mapped_column(String(16), default="#13895f")


class ChatSession(Timestamps, Base):
    __tablename__ = "chat_sessions"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("cs"))
    workspace_id: Mapped[str] = mapped_column(String(40), index=True)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(160), default="New conversation")
    # Core memory as it was when the conversation started (frozen so the prompt prefix
    # stays cacheable while the agent edits its memory).
    memory_snapshot: Mapped[str | None] = mapped_column(Text)


class Task(Timestamps, Base):
    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint(
            "status IN ('triage', 'ready', 'running', 'blocked', 'review', 'done', 'failed',"
            " 'cancelled')",
            name="ck_tasks_status",
        ),
        Index("ix_tasks_ws_status", "workspace_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("tk"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(200))
    brief: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="triage")
    priority: Mapped[str] = mapped_column(String(8), default="normal")  # low|normal|high|urgent
    assignee_agent_id: Mapped[str | None] = mapped_column(
        ForeignKey("agents.id", ondelete="SET NULL")
    )
    created_by: Mapped[str] = mapped_column(String(80))
    source: Mapped[str] = mapped_column(String(24), default="manual")  # manual|broadcast|chat
    requires_review: Mapped[bool] = mapped_column(Boolean, default=True)
    result: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    blocked_reason: Mapped[str | None] = mapped_column(String(300))
    workflow_id: Mapped[str | None] = mapped_column(String(120))
    run_count: Mapped[int] = mapped_column(Integer, default=0)
    steps_used: Mapped[int] = mapped_column(Integer, default=0)
    position: Mapped[float] = mapped_column(Numeric(20, 6), default=0)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    memory_snapshot: Mapped[str | None] = mapped_column(Text)  # frozen at run start


class AgentMessage(Base):
    """Conversation turns in OpenAI shape, for a task run or a chat session."""

    __tablename__ = "agent_messages"
    __table_args__ = (
        Index("ix_agent_messages_task", "task_id", "id"),
        Index("ix_agent_messages_session", "session_id", "id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(String(40))
    agent_id: Mapped[str] = mapped_column(String(40))
    task_id: Mapped[str | None] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    session_id: Mapped[str | None] = mapped_column(
        ForeignKey("chat_sessions.id", ondelete="CASCADE")
    )
    role: Mapped[str] = mapped_column(String(16))  # user | assistant | tool
    content: Mapped[str | None] = mapped_column(Text)
    tool_calls: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    tool_call_id: Mapped[str | None] = mapped_column(String(80))
    name: Mapped[str | None] = mapped_column(String(80))
    meta: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class TaskEvent(Base):
    """Timeline of a task: status changes, tool calls, approvals, updates."""

    __tablename__ = "task_events"
    __table_args__ = (Index("ix_task_events_task", "task_id", "id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    kind: Mapped[str] = mapped_column(String(24))
    actor: Mapped[str] = mapped_column(String(80))
    text: Mapped[str] = mapped_column(Text, default="")
    data: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


class Approval(Base):
    """A decision an agent is waiting on: a tool call (kind=tool) or a question (kind=question)."""

    __tablename__ = "approvals"
    __table_args__ = (
        Index("ix_approvals_ws_status", "workspace_id", "status"),
        CheckConstraint(
            "status IN ('pending', 'approved', 'denied', 'answered', 'expired', 'cancelled')",
            name="ck_approvals_status",
        ),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("apv"))
    workspace_id: Mapped[str] = mapped_column(String(40))
    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    agent_id: Mapped[str] = mapped_column(String(40))
    kind: Mapped[str] = mapped_column(String(16), default="tool")
    tool_name: Mapped[str] = mapped_column(String(80))
    tool_call_id: Mapped[str] = mapped_column(String(80))
    args: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    reason: Mapped[str] = mapped_column(Text, default="")  # why the agent wants it
    risk: Mapped[str] = mapped_column(String(8), default="medium")
    rule: Mapped[str] = mapped_column(String(120), default="")
    status: Mapped[str] = mapped_column(String(16), default="pending")
    scope: Mapped[str | None] = mapped_column(String(8))  # once | always
    answer: Mapped[str | None] = mapped_column(Text)  # question answer or denial reason
    decided_by: Mapped[str | None] = mapped_column(String(80))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Broadcast(Base):
    __tablename__ = "broadcasts"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("bc"))
    workspace_id: Mapped[str] = mapped_column(String(40), index=True)
    sender: Mapped[str] = mapped_column(String(80))
    audience: Mapped[dict[str, Any]] = mapped_column(JSONB)
    audience_label: Mapped[str] = mapped_column(String(300))
    mode: Mapped[str] = mapped_column(String(16))  # announcement | directive
    request_reply: Mapped[bool] = mapped_column(Boolean, default=False)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class BroadcastReceipt(Base):
    __tablename__ = "broadcast_receipts"

    broadcast_id: Mapped[str] = mapped_column(
        ForeignKey("broadcasts.id", ondelete="CASCADE"), primary_key=True
    )
    agent_id: Mapped[str] = mapped_column(
        ForeignKey("agents.id", ondelete="CASCADE"), primary_key=True
    )
    delivered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ack_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reply: Mapped[str | None] = mapped_column(Text)
    task_id: Mapped[str | None] = mapped_column(String(40))


class Event(Base):
    """Every live event, kept briefly so a phone that slept can replay what it missed."""

    __tablename__ = "events"
    __table_args__ = (Index("ix_events_ws_seq", "workspace_id", "seq"),)

    seq: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(String(40))
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    type: Mapped[str] = mapped_column(String(40))
    data: Mapped[dict[str, Any]] = mapped_column(JSONB)


# ---------------------------------------------------------------- P3 brain

EMBED_DIMS = 384  # paraphrase-multilingual-MiniLM-L12-v2


class BrainPage(Timestamps, Base):
    """Index of one markdown file in the workspace vault. The row is the source of truth;
    the git vault mirrors it, and edits made in the vault (Obsidian) are imported back."""

    __tablename__ = "brain_pages"
    __table_args__ = (
        UniqueConstraint("workspace_id", "path", name="uq_brain_pages_ws_path"),
        Index("ix_brain_pages_ws_name", "workspace_id", "name"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("pg"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    # Pages under branches/<slug>/ belong to that company; null = whole workspace.
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"))
    path: Mapped[str] = mapped_column(String(400))  # e.g. wiki/entities/maju-trading.md
    name: Mapped[str] = mapped_column(String(200))  # lower-case file name: [[wikilink]] target
    kind: Mapped[str] = mapped_column(
        String(16)
    )  # wiki | decision | raw | log | agent | dream | root
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text, default="")
    frontmatter: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    hash: Mapped[str] = mapped_column(String(64))
    vault_hash: Mapped[str | None] = mapped_column(String(64))  # what the vault file last held
    updated_by: Mapped[str] = mapped_column(String(80))


class BrainChunk(Base):
    """Search unit: one section of a page, with keyword and vector indexes."""

    __tablename__ = "brain_chunks"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    page_id: Mapped[str] = mapped_column(
        ForeignKey("brain_pages.id", ondelete="CASCADE"), index=True
    )
    workspace_id: Mapped[str] = mapped_column(String(40), index=True)
    branch_id: Mapped[str | None] = mapped_column(String(40))
    kind: Mapped[str] = mapped_column(String(16))
    idx: Mapped[int] = mapped_column(Integer)
    heading: Mapped[str] = mapped_column(String(300), default="")
    text: Mapped[str] = mapped_column(Text)
    tsv: Mapped[Any] = mapped_column(
        TSVECTOR, Computed("to_tsvector('simple', heading || ' ' || text)", persisted=True)
    )
    embedding: Mapped[Any] = mapped_column(Vector(EMBED_DIMS), nullable=True)


class BrainLink(Base):
    __tablename__ = "brain_links"
    __table_args__ = (Index("ix_brain_links_ws_dst", "workspace_id", "dst_name"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(String(40))
    src_page_id: Mapped[str] = mapped_column(
        ForeignKey("brain_pages.id", ondelete="CASCADE"), index=True
    )
    dst_name: Mapped[str] = mapped_column(String(200))  # resolved by BrainPage.name at read time


class BrainFact(Base):
    """One atomic statement. Never deleted: a replaced or contradicted fact gets valid_to,
    so the history of what the office believed (and when) is kept."""

    __tablename__ = "brain_facts"
    __table_args__ = (Index("ix_brain_facts_ws_valid", "workspace_id", "valid_to"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("fa"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"))
    agent_id: Mapped[str | None] = mapped_column(  # null = shared with the branch / workspace
        ForeignKey("agents.id", ondelete="CASCADE")
    )
    text: Mapped[str] = mapped_column(Text)
    tsv: Mapped[Any] = mapped_column(
        TSVECTOR, Computed("to_tsvector('simple', text)", persisted=True)
    )
    embedding: Mapped[Any] = mapped_column(Vector(EMBED_DIMS), nullable=True)
    source_kind: Mapped[str] = mapped_column(String(16))  # task | chat | person | agent | dream
    source_id: Mapped[str | None] = mapped_column(String(40))
    source_label: Mapped[str | None] = mapped_column(String(200))
    created_by: Mapped[str] = mapped_column(String(80))
    confidence: Mapped[float] = mapped_column(Float, default=0.8)
    hits: Mapped[int] = mapped_column(Integer, default=0)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    valid_from: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    valid_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    end_reason: Mapped[str | None] = mapped_column(
        String(16)
    )  # replaced|merged|contradicted|forgotten
    superseded_by: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class BrainDream(Base):
    """One nightly consolidation run and the diary of what it changed."""

    __tablename__ = "brain_dreams"
    __table_args__ = (UniqueConstraint("workspace_id", "day", name="uq_brain_dreams_ws_day"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("dr"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    day: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(16), default="running")  # running | done | failed
    stats: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    changes: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    diary_path: Mapped[str | None] = mapped_column(String(400))
    error: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
