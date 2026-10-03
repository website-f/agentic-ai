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
    LargeBinary,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.orm import Mapped, deferred, mapped_column, relationship

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
    # P9 scope for office roles: a branch manager's branch, a HOD's or supervisor's
    # department, a staff member's home (where their own agents are placed).
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id", ondelete="SET NULL"))
    department_id: Mapped[str | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL")
    )

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
    # The provider's own words (keys redacted), so a 400 can be diagnosed after the fact.
    error_detail: Mapped[str | None] = mapped_column(String(500))


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
    # P7 delegation: orchestrators split work into child tasks, within these caps.
    max_parallel_children: Mapped[int] = mapped_column(Integer, default=5, server_default="5")
    max_spawn_depth: Mapped[int] = mapped_column(Integer, default=2, server_default="2")
    # P7 budgets: auto-pause at 100 % (and ask), alert at 80 %. Null = no limit.
    budget_daily_tokens: Mapped[int | None] = mapped_column(Integer)
    budget_monthly_usd: Mapped[float | None] = mapped_column(Numeric(12, 4))
    # P7 heartbeat: wakes during work hours to pick up queued work or ask for some.
    heartbeat: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # P9: a staff member's personal agent (only they and their managers manage it), and
    # helpers an agent duplicated itself into to share a big job (clone_of = the original).
    owner_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    clone_of: Mapped[str | None] = mapped_column(String(40), index=True)
    # A personal assistant (P16): only its owner sees it, works with it and reads its work.
    private: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")


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
    # P12 context window (agents/context.py): the checkpoint of compacted work, the last
    # message it covers, and the last message whose old tool results are shown as stubs.
    ctx_summary: Mapped[str | None] = mapped_column(Text)
    ctx_summary_upto: Mapped[int | None] = mapped_column(BigInteger)
    ctx_cut: Mapped[int | None] = mapped_column(BigInteger)


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
    # P7: child tasks of a delegation, and the schedule a task came from.
    parent_task_id: Mapped[str | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), index=True
    )
    depth: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    output_schema: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    correction_used: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    schedule_id: Mapped[str | None] = mapped_column(String(40))
    # P9: what kind of work this is ("tender", "invoice"...), for the company overview.
    labels: Mapped[list[str]] = mapped_column(JSONB, default=list, server_default="[]")
    # P11: the workflow run this task is one step of.
    workflow_run_id: Mapped[str | None] = mapped_column(String(40), index=True)
    # P12 context window (agents/context.py): the checkpoint of compacted work, the last
    # message it covers, and the last message whose old tool results are shown as stubs.
    ctx_summary: Mapped[str | None] = mapped_column(Text)
    ctx_summary_upto: Mapped[int | None] = mapped_column(BigInteger)
    ctx_cut: Mapped[int | None] = mapped_column(BigInteger)
    # P13 goal loop: a model checks the result against this "done when…" after each finish; if
    # not met and under the cap, the agent is nudged and continues the same work.
    goal: Mapped[str | None] = mapped_column(Text)
    goal_tries: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


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


# ---------------------------------------------------------------- P4 skills


class Skill(Timestamps, Base):
    """A procedure agents load on demand (SKILL.md convention). The active version lives here
    and in the vault at skills/<name>/SKILL.md; every approved change is a new version."""

    __tablename__ = "skills"
    __table_args__ = (
        UniqueConstraint("workspace_id", "name", name="uq_skills_ws_name"),
        CheckConstraint("status IN ('active', 'retired')", name="ck_skills_status"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("sk"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    # An isolated company's skills stay with it; null = every company.
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(64))  # kebab-case, also the vault folder
    description: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text)  # markdown instructions, no frontmatter
    version: Mapped[int] = mapped_column(Integer, default=1)
    trust: Mapped[str] = mapped_column(String(16), default="trusted")  # builtin|official|trusted
    status: Mapped[str] = mapped_column(String(16), default="active")
    agent_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)  # empty = every agent
    embedding: Mapped[Any] = mapped_column(Vector(EMBED_DIMS), nullable=True)
    created_by: Mapped[str] = mapped_column(String(80))
    approved_by: Mapped[str | None] = mapped_column(String(80))
    # Token cost of the task the skill was learned from: the "before" in tokens saved.
    baseline_tokens: Mapped[int | None] = mapped_column(Integer)
    source_task_id: Mapped[str | None] = mapped_column(String(40))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_eval: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


class SkillVersion(Base):
    __tablename__ = "skill_versions"
    __table_args__ = (UniqueConstraint("skill_id", "version", name="uq_skill_versions"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    skill_id: Mapped[str] = mapped_column(ForeignKey("skills.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    description: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text)
    created_by: Mapped[str] = mapped_column(String(80))
    approved_by: Mapped[str | None] = mapped_column(String(80))
    note: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class SkillProposal(Base):
    """A change waiting for a person: a new skill, a patch, a merge or a retirement."""

    __tablename__ = "skill_proposals"
    __table_args__ = (
        CheckConstraint("kind IN ('new', 'patch', 'merge', 'retire')", name="ck_sp_kind"),
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected', 'superseded')", name="ck_sp_status"
        ),
        Index("ix_skill_proposals_ws_status", "workspace_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("sp"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    skill_id: Mapped[str | None] = mapped_column(ForeignKey("skills.id", ondelete="CASCADE"))
    # merge: the other skill folded into skill_id
    other_skill_id: Mapped[str | None] = mapped_column(String(40))
    kind: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text)
    base_version: Mapped[int | None] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(Text, default="")
    eval_cases: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    scan: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    eval: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    proposed_by: Mapped[str] = mapped_column(String(80))  # agent:<id> | curator | vault | user:<id>
    agent_id: Mapped[str | None] = mapped_column(String(40))
    branch_id: Mapped[str | None] = mapped_column(String(40))
    source_task_id: Mapped[str | None] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(16), default="pending")
    decided_by: Mapped[str | None] = mapped_column(String(80))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class SkillUse(Base):
    """One agent loading one skill for one task (or chat). Outcome follows the task."""

    __tablename__ = "skill_uses"
    __table_args__ = (Index("ix_skill_uses_skill", "skill_id", "id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(String(40))
    skill_id: Mapped[str] = mapped_column(ForeignKey("skills.id", ondelete="CASCADE"))
    version: Mapped[int] = mapped_column(Integer)
    agent_id: Mapped[str] = mapped_column(String(40))
    task_id: Mapped[str | None] = mapped_column(String(40), index=True)
    outcome: Mapped[str | None] = mapped_column(String(16))  # accepted | sent_back | failed
    tokens: Mapped[int | None] = mapped_column(Integer)  # whole task, set when it finishes
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class SkillEvalCase(Base):
    """A test for a skill: an input and checks on the answer (cheap, deterministic first)."""

    __tablename__ = "skill_eval_cases"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("ec"))
    workspace_id: Mapped[str] = mapped_column(String(40))
    skill_id: Mapped[str] = mapped_column(ForeignKey("skills.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(160))
    input: Mapped[str] = mapped_column(Text)
    # {"must_contain": [...], "must_not_contain": [...], "regex": "...",
    #  "number": {"value": 1640.4, "tolerance": 0.01}, "json_keys": [...], "rubric": "..."}
    checks: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_by: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


# ---------------------------------------------------------------- P6 channels


class InstanceSecret(Base):
    """Install-wide secrets the app generates itself (the VAPID key pair for web push)."""

    __tablename__ = "instance_secrets"

    name: Mapped[str] = mapped_column(String(60), primary_key=True)
    value_enc: Mapped[str] = mapped_column(Text)
    public: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class PushSubscription(Base):
    """One browser or installed app that may receive notifications for one person."""

    __tablename__ = "push_subscriptions"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("ps"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    endpoint: Mapped[str] = mapped_column(Text, unique=True)
    p256dh: Mapped[str] = mapped_column(String(200))
    auth: Mapped[str] = mapped_column(String(100))
    label: Mapped[str] = mapped_column(String(120), default="This device")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_ok_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failures: Mapped[int] = mapped_column(Integer, default=0)


class ActionToken(Base):
    """Single-use, short-lived proof that lets a notification button decide one approval."""

    __tablename__ = "action_tokens"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("at"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    approval_id: Mapped[str] = mapped_column(ForeignKey("approvals.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Channel(Timestamps, Base):
    """An outside messaging account, e.g. a Telegram bot. The token is encrypted at rest."""

    __tablename__ = "channels"
    __table_args__ = (CheckConstraint("kind IN ('telegram', 'whatsapp')", name="ck_channels_kind"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("ch"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(120))
    config_enc: Mapped[str] = mapped_column(Text)
    state: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict
    )  # offset, bot username, errors
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class ChannelLink(Base):
    """A person's account on a channel (their Telegram user), linked by a one-time code."""

    __tablename__ = "channel_links"
    __table_args__ = (UniqueConstraint("channel_id", "external_id", name="uq_channel_links"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("cl"))
    channel_id: Mapped[str] = mapped_column(ForeignKey("channels.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    external_id: Mapped[str] = mapped_column(String(80))
    chat_id: Mapped[str] = mapped_column(String(80))  # private chat with the bot
    display: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Binding(Base):
    """Which agent answers where (OpenClaw bindings). Most specific match wins:
    chat:<id> > group > dm."""

    __tablename__ = "bindings"
    __table_args__ = (UniqueConstraint("channel_id", "match", name="uq_bindings_match"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("bd"))
    channel_id: Mapped[str] = mapped_column(ForeignKey("channels.id", ondelete="CASCADE"))
    match: Mapped[str] = mapped_column(String(120))
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Delivery(Base):
    """The delivery ledger (Hermes): every outbound message, so none is lost or sent twice."""

    __tablename__ = "deliveries"
    __table_args__ = (
        CheckConstraint(
            "state IN ('pending', 'sent', 'failed', 'skipped')", name="ck_deliveries_state"
        ),
        Index("ix_deliveries_ws_created", "workspace_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("dl"))
    workspace_id: Mapped[str] = mapped_column(String(40))
    channel: Mapped[str] = mapped_column(String(16))  # webpush | telegram
    target: Mapped[str] = mapped_column(String(300))  # subscription id | channel id:chat id
    kind: Mapped[str] = mapped_column(String(16))  # approval | reply | test | link
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    dedupe_key: Mapped[str | None] = mapped_column(String(160), unique=True)
    state: Mapped[str] = mapped_column(String(16), default="pending")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(String(500))
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ApiToken(Base):
    """Scoped tokens for the OpenAI-compatible endpoint and scripts. Shown once, stored hashed."""

    __tablename__ = "api_tokens"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("tok"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    prefix: Mapped[str] = mapped_column(String(16))
    scopes: Mapped[list[str]] = mapped_column(JSONB, default=list)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


# ---------------------------------------------------------------- P7 teams and governance


class Meeting(Base):
    """A bounded discussion between agents (max 5, a few rounds, a token budget) that ends in
    one structured outcome. It can never approve anything by itself."""

    __tablename__ = "meetings"
    __table_args__ = (
        CheckConstraint(
            "status IN ('running', 'done', 'failed', 'cancelled')", name="ck_meetings_status"
        ),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("mt"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    task_id: Mapped[str | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"))
    initiator_agent_id: Mapped[str | None] = mapped_column(String(40))  # null: a person called it
    started_by: Mapped[str] = mapped_column(String(80))
    topic: Mapped[str] = mapped_column(Text)
    participant_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)
    status: Mapped[str] = mapped_column(String(16), default="running")
    max_rounds: Mapped[int] = mapped_column(Integer, default=3)
    rounds_done: Mapped[int] = mapped_column(Integer, default=0)
    token_budget: Mapped[int] = mapped_column(Integer, default=24000)
    tokens_used: Mapped[int] = mapped_column(Integer, default=0)
    outcome: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    decision_path: Mapped[str | None] = mapped_column(String(400))
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class MeetingTurn(Base):
    __tablename__ = "meeting_turns"
    __table_args__ = (Index("ix_meeting_turns_meeting", "meeting_id", "id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    meeting_id: Mapped[str] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"))
    round: Mapped[int] = mapped_column(Integer)
    speaker: Mapped[str] = mapped_column(String(80))  # agent:<id> | user:<id> | system
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(16), default="turn")  # turn | human | outcome
    content: Mapped[str] = mapped_column(Text)
    tokens: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class BudgetGrant(Base):
    """Extra allowance a person approved when an agent hit its budget."""

    __tablename__ = "budget_grants"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"), index=True)
    period: Mapped[str] = mapped_column(String(8))  # day | month
    period_key: Mapped[str] = mapped_column(String(10))  # 2026-10-01 | 2026-10
    extra_tokens: Mapped[int] = mapped_column(Integer, default=0)
    extra_usd: Mapped[float] = mapped_column(Numeric(12, 4), default=0)
    granted_by: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class AgentPing(Base):
    """An agent asking people for something outside a task: work, or attention to its budget."""

    __tablename__ = "agent_pings"
    __table_args__ = (
        Index("ix_agent_pings_ws_open", "workspace_id", "resolved_at"),
        UniqueConstraint("agent_id", "kind", "period_key", name="uq_agent_pings_once"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("ap"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(16))  # idle | budget_alert
    message: Mapped[str] = mapped_column(Text)
    period_key: Mapped[str] = mapped_column(String(10))  # at most one per agent, kind, period
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by: Mapped[str | None] = mapped_column(String(80))


class Schedule(Timestamps, Base):
    """Recurring work: a task an agent gets on a cron, run by a Temporal Schedule."""

    __tablename__ = "schedules"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("sc"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(160))
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(200))
    brief: Mapped[str] = mapped_column(Text, default="")
    cron: Mapped[str] = mapped_column(String(120))
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kuala_Lumpur")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    requires_review: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[str] = mapped_column(String(80))
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class JobRun(Base):
    """The cron ledger (Hermes): every scheduled run, claimed -> running -> completed/failed."""

    __tablename__ = "job_runs"
    __table_args__ = (Index("ix_job_runs_ws_started", "workspace_id", "started_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str | None] = mapped_column(String(40))  # null: system jobs
    job: Mapped[str] = mapped_column(String(40))  # schedule | heartbeat | dream | provider-health
    schedule_id: Mapped[str | None] = mapped_column(String(40), index=True)
    status: Mapped[str] = mapped_column(String(16), default="claimed")
    task_id: Mapped[str | None] = mapped_column(String(40))
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    error: Mapped[str | None] = mapped_column(Text)
    signature: Mapped[str | None] = mapped_column(String(64))
    detail: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Incident(Base):
    """Failures grouped by signature, so 50 identical failures make one alert."""

    __tablename__ = "incidents"
    __table_args__ = (UniqueConstraint("workspace_id", "signature", name="uq_incidents_sig"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(String(40))
    signature: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(300))
    count: Mapped[int] = mapped_column(Integer, default=1)
    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# ---------------------------------------------------------------- P9 vault and reports


class Credential(Timestamps, Base):
    """A website login agents may use without ever seeing it. The username and password are
    envelope-encrypted; the browser types them in only on the hosts listed here."""

    __tablename__ = "credentials"
    __table_args__ = (UniqueConstraint("workspace_id", "name", name="uq_credentials_ws_name"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("cr"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"))
    owner_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(80))  # what agents call it: "supplier-portal"
    hosts: Mapped[list[str]] = mapped_column(JSONB, default=list)  # e.g. ["portal.example.com"]
    username_enc: Mapped[str] = mapped_column(Text)
    password_enc: Mapped[str] = mapped_column(Text)
    username_hint: Mapped[str] = mapped_column(String(40), default="")
    agent_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)  # empty = any agent in scope
    created_by: Mapped[str] = mapped_column(String(80))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def aad(self) -> str:
        return f"credential:{self.id}"


class Report(Base):
    """A finished piece of work written up for people: markdown plus optional tables."""

    __tablename__ = "reports"
    __table_args__ = (Index("ix_reports_ws_created", "workspace_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("rp"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id", ondelete="SET NULL"))
    agent_id: Mapped[str | None] = mapped_column(ForeignKey("agents.id", ondelete="SET NULL"))
    task_id: Mapped[str | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"))
    call_id: Mapped[str | None] = mapped_column(String(80))  # one report per tool call
    title: Mapped[str] = mapped_column(String(200))
    summary: Mapped[str] = mapped_column(String(600), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    # [{"title": "...", "columns": [...], "rows": [[...], ...]}]
    tables: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    labels: Mapped[list[str]] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Blueprint(Timestamps, Base):
    """A reusable role package people define once and apply to agents (P9): the role, its
    instructions (soul), model group, tool scope, and the SOPs and skills it should follow.
    Applying it to an agent copies these onto the agent; an isolated branch keeps its own."""

    __tablename__ = "blueprints"
    __table_args__ = (UniqueConstraint("workspace_id", "name", name="uq_blueprints_ws_name"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("bp"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(String(300), default="")
    role: Mapped[str] = mapped_column(String(120), default="")
    soul: Mapped[str] = mapped_column(Text, default="")
    model_group: Mapped[str] = mapped_column(String(40), default="smart")
    # {tool_name: "allow" | "ask" | "deny"} — the capability scope this role is limited to.
    tools: Mapped[dict[str, str]] = mapped_column(JSONB, default=dict)
    autonomy: Mapped[str] = mapped_column(String(8), default="ask")
    sop_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)
    skill_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)
    color: Mapped[str] = mapped_column(String(16), default="#13895f")
    source: Mapped[str] = mapped_column(String(16), default="manual")  # manual | analyst
    created_by: Mapped[str] = mapped_column(String(80))


class Workflow(Timestamps, Base):
    """A visual procedure (P9): a graph of steps describing how a job is done. People draw it
    on a canvas or an analyst agent drafts it from a prompt. When attached to agents it is
    compiled to a numbered procedure and layered into their prompt, like an SOP — it is
    guidance the agent follows, never an automation engine."""

    __tablename__ = "workflows"
    __table_args__ = (UniqueConstraint("workspace_id", "name", name="uq_workflows_ws_name"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("wf"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(String(300), default="")
    # {"nodes": [{id,type,title,body,role,x,y}], "edges": [{id,from,to,label}]}
    graph: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="draft")  # draft | active
    source: Mapped[str] = mapped_column(String(16), default="manual")  # manual | analyst
    agent_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)  # agents that follow it
    created_by: Mapped[str] = mapped_column(String(80))


# ---------------------------------------------------------------- Document Studio (P10)


class DocFile(Timestamps, Base):
    """A file people uploaded (or the system generated, like a compiled pack). The bytes live
    here so the API and the worker both reach them and the database backup covers them. The
    worker reads each upload once (text, OCR for scans) and a cheap model summarises it; agents
    then work from that text instead of re-reading the file."""

    __tablename__ = "files"
    __table_args__ = (
        CheckConstraint("status IN ('reading', 'ready', 'failed')", name="ck_files_status"),
        Index("ix_files_ws_created", "workspace_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("fl"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id", ondelete="SET NULL"))
    task_id: Mapped[str | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="SET NULL"), index=True
    )
    agent_id: Mapped[str | None] = mapped_column(ForeignKey("agents.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(200))
    mime: Mapped[str] = mapped_column(String(120), default="application/octet-stream")
    size: Mapped[int] = mapped_column(Integer, default=0)
    sha256: Mapped[str] = mapped_column(String(64), default="")
    data: Mapped[bytes] = deferred(mapped_column(LargeBinary))
    status: Mapped[str] = mapped_column(String(16), default="reading")
    text: Mapped[str] = deferred(mapped_column(Text, default=""))
    pages: Mapped[int] = mapped_column(Integer, default=0)
    ocr: Mapped[bool] = mapped_column(Boolean, default=False)
    # What the cheap model understood: "SSM certificate", a title, 2-3 sentences, key facts.
    kind: Mapped[str] = mapped_column(String(80), default="")
    title: Mapped[str] = mapped_column(String(200), default="")
    summary: Mapped[str] = mapped_column(String(1000), default="")
    fields: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    expires_on: Mapped[date | None] = mapped_column(Date)
    error: Mapped[str | None] = mapped_column(String(300))
    source: Mapped[str] = mapped_column(String(16), default="upload")  # upload | generated
    created_by: Mapped[str] = mapped_column(String(80))


class CompanyKit(Timestamps, Base):
    """The facts every document about a company reuses: legal name, registration, address,
    bank, signatory, logo. One per branch (one branch per company)."""

    __tablename__ = "company_kits"

    branch_id: Mapped[str] = mapped_column(
        ForeignKey("branches.id", ondelete="CASCADE"), primary_key=True
    )
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    logo_file_id: Mapped[str | None] = mapped_column(String(40))
    updated_by: Mapped[str] = mapped_column(String(80), default="")


class DocTemplate(Timestamps, Base):
    """A reusable document: markdown with {{placeholders}} plus the fields that fill them, or
    an uploaded Word file whose {{placeholders}} are filled in place (keeping its layout)."""

    __tablename__ = "doc_templates"
    __table_args__ = (UniqueConstraint("workspace_id", "name", name="uq_doc_templates_ws_name"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("tp"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(40), default="custom")
    description: Mapped[str] = mapped_column(String(300), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    # [{"key", "label", "type": text|longtext|date|number|money|items|choice, "required", ...}]
    fields: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    docx_file_id: Mapped[str | None] = mapped_column(String(40))
    prefix: Mapped[str] = mapped_column(String(12), default="")  # numbering, e.g. "QT"
    builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[str] = mapped_column(String(80))


class Document(Timestamps, Base):
    """A document being prepared: source markdown (placeholders intact) plus field values.
    Drafted by people or agents, reviewed, then approved (locked). Exports to PDF, Word and
    Excel are rendered on demand from the same source."""

    __tablename__ = "documents"
    __table_args__ = (
        CheckConstraint("status IN ('draft', 'review', 'approved')", name="ck_documents_status"),
        Index("ix_documents_ws_updated", "workspace_id", "updated_at"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("dc"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id", ondelete="SET NULL"))
    template_id: Mapped[str | None] = mapped_column(
        ForeignKey("doc_templates.id", ondelete="SET NULL")
    )
    task_id: Mapped[str | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="SET NULL"), index=True
    )
    agent_id: Mapped[str | None] = mapped_column(ForeignKey("agents.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(40), default="custom")
    number: Mapped[str] = mapped_column(String(40), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    values: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="draft")
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[str] = mapped_column(String(80))
    approved_by: Mapped[str | None] = mapped_column(String(80))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DocumentVersion(Base):
    __tablename__ = "document_versions"
    __table_args__ = (Index("ix_document_versions_doc", "document_id", "version"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    version: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    values: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    note: Mapped[str] = mapped_column(String(300), default="")
    author: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Pack(Timestamps, Base):
    """A submission pack: a checklist of required items, each filled by an uploaded file or a
    prepared document, compiled into one PDF with a cover and an index. People submit it."""

    __tablename__ = "packs"
    __table_args__ = (
        CheckConstraint("status IN ('collecting', 'compiled')", name="ck_packs_status"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("pk"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id", ondelete="SET NULL"))
    task_id: Mapped[str | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(String(1000), default="")
    # [{"id", "label", "hint", "required", "file_id", "document_id", "status", "note", "auto"}]
    items: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    status: Mapped[str] = mapped_column(String(16), default="collecting")
    compiled_file_id: Mapped[str | None] = mapped_column(String(40))
    compiled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[str] = mapped_column(String(80))


class WorkflowRun(Timestamps, Base):
    """One job carried through a workflow (P11). The graph is copied at start so later edits
    to the workflow never change a run in flight. Each step becomes a task for its agent;
    decisions wait for a person (or ask an agent, if the workflow says so); steps marked for
    review wait until a person accepts the result. The worker ticks the run forward."""

    __tablename__ = "workflow_runs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('running', 'waiting', 'done', 'failed', 'cancelled')",
            name="ck_workflow_runs_status",
        ),
        Index("ix_workflow_runs_ws_created", "workspace_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("wr"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    workflow_id: Mapped[str | None] = mapped_column(
        ForeignKey("workflows.id", ondelete="SET NULL"), index=True
    )
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(80))  # the workflow's name when it started
    title: Mapped[str] = mapped_column(String(200))
    input: Mapped[str] = mapped_column(Text, default="")
    file_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)
    graph: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    assign: Mapped[dict[str, str]] = mapped_column(JSONB, default=dict)  # node id -> agent id
    # node id -> {status, task_id, output, choice, error, started_at, finished_at, by}
    state: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="running")
    error: Mapped[str | None] = mapped_column(String(500))
    temporal_id: Mapped[str | None] = mapped_column(String(120))
    created_by: Mapped[str] = mapped_column(String(80))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class McpServer(Timestamps, Base):
    """An external MCP (Model Context Protocol) server the office connects to (P13). Its tools
    are discovered over HTTP and offered to agents through the tool_search / tool_describe /
    tool_call bridge, so their schemas never fill the prompt. A call to one is approval-gated
    like any other outward action. Any auth header is envelope-encrypted."""

    __tablename__ = "mcp_servers"
    __table_args__ = (UniqueConstraint("workspace_id", "name", name="uq_mcp_servers_ws_name"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("mcp"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(80))  # how agents refer to it: "linear"
    url: Mapped[str] = mapped_column(String(400))  # the server's Streamable-HTTP endpoint
    description: Mapped[str] = mapped_column(String(300), default="")
    auth_header_enc: Mapped[str] = mapped_column(Text, default="")  # e.g. "Authorization: Bearer …"
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # Cached from tools/list: [{"name","description","schema"}]; refreshed on demand.
    tools: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    agent_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)  # empty = any agent in scope
    health: Mapped[str] = mapped_column(String(16), default="unknown")
    last_error: Mapped[str | None] = mapped_column(String(300))
    created_by: Mapped[str] = mapped_column(String(80))

    @property
    def aad(self) -> str:
        return f"mcp_server:{self.id}"


class Integration(Timestamps, Base):
    """A workspace's connection settings for an outside service (P16), e.g. the Google OAuth
    app (client id + secret) people sign in with to connect Gmail. Encrypted at rest."""

    __tablename__ = "integrations"
    __table_args__ = (UniqueConstraint("workspace_id", "kind", name="uq_integrations_ws_kind"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("ig"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(24))  # google
    config_enc: Mapped[str] = mapped_column(Text, default="")
    updated_by: Mapped[str] = mapped_column(String(80), default="")

    @property
    def aad(self) -> str:
        return f"integration:{self.id}"


class GoogleAccount(Timestamps, Base):
    """A person's own Gmail, connected by them with Google sign-in (P16). Only their private
    assistants use it. The refresh token is encrypted at rest; access tokens live in Valkey."""

    __tablename__ = "google_accounts"
    __table_args__ = (UniqueConstraint("workspace_id", "user_id", name="uq_google_accounts_user"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("ga"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    email: Mapped[str] = mapped_column(String(200))
    scopes: Mapped[str] = mapped_column(Text, default="")
    token_enc: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="connected")  # connected | error
    last_error: Mapped[str | None] = mapped_column(String(300))

    @property
    def aad(self) -> str:
        return f"google_account:{self.id}"


class EmailDraft(Timestamps, Base):
    """A reply an assistant drafted in the person's Gmail (P16). It is sent only when the
    person approves it here; until then it sits in Gmail's Drafts."""

    __tablename__ = "email_drafts"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'sent', 'discarded', 'failed')", name="ck_email_drafts_status"
        ),
        Index("ix_email_drafts_user_status", "user_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("ed"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    agent_id: Mapped[str | None] = mapped_column(ForeignKey("agents.id", ondelete="SET NULL"))
    account_id: Mapped[str] = mapped_column(ForeignKey("google_accounts.id", ondelete="CASCADE"))
    gmail_draft_id: Mapped[str] = mapped_column(String(120))
    thread_id: Mapped[str] = mapped_column(String(120), default="")
    in_reply_to: Mapped[str] = mapped_column(String(120), default="")  # the Gmail message id
    to: Mapped[str] = mapped_column(Text, default="")
    cc: Mapped[str] = mapped_column(Text, default="")
    subject: Mapped[str] = mapped_column(String(400), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    original_from: Mapped[str] = mapped_column(String(300), default="")
    original_snippet: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="pending")
    error: Mapped[str | None] = mapped_column(String(500))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
