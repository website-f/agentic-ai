from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

Mode = Literal["allow", "ask", "deny"]
HEX = r"^#[0-9a-fA-F]{6}$"


class ToolOut(BaseModel):
    name: str
    label: str
    description: str
    risk: str
    default_mode: Mode


class AgentIn(BaseModel):
    branch_id: str
    department_id: str | None = None
    name: str = Field(min_length=1, max_length=80)
    role: str = Field(min_length=1, max_length=120)
    template: str | None = None
    soul: str = Field(default="", max_length=8000)
    model_group: str = Field(default="smart", max_length=40)
    tools: dict[str, Mode] = Field(default_factory=dict)
    autonomy: Literal["ask", "auto"] = "ask"
    sop_ids: list[str] = Field(default_factory=list, max_length=30)
    color: str = Field(default="#13895f", pattern=HEX)
    reports_to: str | None = None
    role_kind: Literal["leaf", "orchestrator"] = "leaf"
    max_parallel_children: int = Field(default=5, ge=1, le=10)
    max_spawn_depth: int = Field(default=2, ge=1, le=3)
    budget_daily_tokens: int | None = Field(default=None, ge=1000, le=100_000_000)
    budget_monthly_usd: float | None = Field(default=None, ge=0.01, le=1_000_000)
    heartbeat: bool = False
    # P9: the signed-in person's own agent (always, for staff).
    personal: bool = False


class AgentUpdateIn(BaseModel):
    branch_id: str | None = None
    department_id: str | None = None
    name: str | None = Field(default=None, min_length=1, max_length=80)
    role: str | None = Field(default=None, min_length=1, max_length=120)
    soul: str | None = Field(default=None, max_length=8000)
    model_group: str | None = Field(default=None, max_length=40)
    tools: dict[str, Mode] | None = None
    autonomy: Literal["ask", "auto"] | None = None
    sop_ids: list[str] | None = Field(default=None, max_length=30)
    color: str | None = Field(default=None, pattern=HEX)
    reports_to: str | None = None
    status: Literal["active", "paused", "retired"] | None = None
    role_kind: Literal["leaf", "orchestrator"] | None = None
    max_parallel_children: int | None = Field(default=None, ge=1, le=10)
    max_spawn_depth: int | None = Field(default=None, ge=1, le=3)
    budget_daily_tokens: int | None = Field(default=None, ge=1000, le=100_000_000)
    budget_monthly_usd: float | None = Field(default=None, ge=0.01, le=1_000_000)
    heartbeat: bool | None = None


class TaskBrief(BaseModel):
    id: str
    title: str
    status: str


class AgentOut(BaseModel):
    id: str
    slug: str
    name: str
    role: str
    template: str | None
    branch_id: str
    branch_name: str
    department_id: str | None
    department_name: str | None
    soul: str
    model_group: str
    tools: dict[str, str]
    autonomy: str
    sop_ids: list[str]
    color: str
    reports_to: str | None
    status: str
    role_kind: str
    max_parallel_children: int
    max_spawn_depth: int
    budget_daily_tokens: int | None
    budget_monthly_usd: float | None
    heartbeat: bool
    current_task: TaskBrief | None
    open_tasks: int
    created_at: datetime
    owner_user_id: str | None = None
    owner_name: str | None = None
    clone_of: str | None = None
    can_manage: bool = False


class PromptPreviewOut(BaseModel):
    prompt: str
    parts: list[dict[str, Any]]
    tokens_estimate: int


class SOPIn(BaseModel):
    scope: Literal["workspace", "branch", "department", "library"]
    scope_id: str | None = None
    title: str = Field(min_length=1, max_length=160)
    body: str = Field(default="", max_length=40_000)


class SOPUpdateIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    body: str | None = Field(default=None, max_length=40_000)


class SOPOut(BaseModel):
    id: str
    scope: str
    scope_id: str | None
    scope_label: str
    title: str
    body: str
    version: int
    updated_by: str | None
    updated_at: datetime


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    session_id: str | None = None


class ChatOut(BaseModel):
    session_id: str
    reply: str
    provider: str
    model: str
    tools_used: list[str]


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    brief: str = Field(default="", max_length=20_000)
    assignee_agent_id: str | None = None
    priority: Literal["low", "normal", "high", "urgent"] = "normal"
    requires_review: bool = True
    start: bool = False
    labels: list[str] = Field(default_factory=list, max_length=8)


class TaskUpdateIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    brief: str | None = Field(default=None, max_length=20_000)
    priority: Literal["low", "normal", "high", "urgent"] | None = None
    assignee_agent_id: str | None = None
    status: Literal["triage", "ready", "done", "cancelled"] | None = None
    position: float | None = None
    labels: list[str] | None = Field(default=None, max_length=8)


class TaskOut(BaseModel):
    id: str
    title: str
    brief: str
    status: str
    priority: str
    assignee_agent_id: str | None
    assignee_name: str | None
    assignee_color: str | None
    source: str
    requires_review: bool
    result: str | None
    error: str | None
    blocked_reason: str | None
    run_count: int
    steps_used: int
    pending_approvals: int
    created_by: str
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    parent_task_id: str | None = None
    depth: int = 0
    schedule_id: str | None = None
    has_output_schema: bool = False
    labels: list[str] = []
    branch_id: str | None = None


class TaskEventOut(BaseModel):
    id: int
    ts: datetime
    kind: str
    actor: str
    actor_name: str | None
    text: str
    data: dict[str, Any] | None


class ReviseIn(BaseModel):
    feedback: str = Field(min_length=1, max_length=8000)


class ApprovalOut(BaseModel):
    id: str
    kind: str
    tool_name: str
    tool_label: str
    args: dict[str, Any]
    reason: str
    risk: str
    rule: str
    status: str
    scope: str | None
    answer: str | None
    decided_by: str | None
    decided_by_name: str | None
    decided_at: datetime | None
    created_at: datetime
    expires_at: datetime
    task_id: str
    task_title: str
    agent_id: str
    agent_name: str
    agent_color: str


class DecisionIn(BaseModel):
    decision: Literal["approve", "deny", "answer"]
    scope: Literal["once", "always"] = "once"
    answer: str | None = Field(default=None, max_length=8000)


class TaskDetailOut(BaseModel):
    task: TaskOut
    events: list[TaskEventOut]
    approvals: list[ApprovalOut]
    transcript: list[dict[str, Any]]
    children: list[TaskOut] = []
    parent: TaskOut | None = None
    meetings: list[dict[str, Any]] = []


class Audience(BaseModel):
    all: bool = False
    branch_ids: list[str] = Field(default_factory=list)
    department_ids: list[str] = Field(default_factory=list)
    agent_ids: list[str] = Field(default_factory=list)


class BroadcastIn(BaseModel):
    audience: Audience
    mode: Literal["announcement", "directive"] = "announcement"
    body: str = Field(min_length=1, max_length=8000)
    request_reply: bool = False


class ReceiptOut(BaseModel):
    agent_id: str
    agent_name: str
    agent_role: str
    agent_color: str
    department_name: str | None
    branch_name: str
    delivered_at: datetime
    ack_at: datetime | None
    reply: str | None
    task_id: str | None


class BroadcastOut(BaseModel):
    id: str
    sender: str
    sender_name: str | None
    audience: dict[str, Any]
    audience_label: str
    mode: str
    request_reply: bool
    body: str
    created_at: datetime
    targets: int
    acked: int
    receipts: list[ReceiptOut] | None = None
