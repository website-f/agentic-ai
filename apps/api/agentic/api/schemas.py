from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

from ..core.security import MIN_PASSWORD_LENGTH

Role = Literal[
    "owner",
    "admin",
    "it_support",  # P125
    "branch_manager",
    "hod",
    "group_hod",
    "supervisor",
    "staff",
    "operator",
    "approver",
    "viewer",
    "management",
    "hr",
]
HEX_COLOR = r"^#[0-9a-fA-F]{6}$"
# P99: the office and Prima, or Prima only (core/access.py).
Access = Literal["agentic", "prima_only"]
# P99: Prima screen ids (prima/modules.py); null = all their Prima role allows.
PrimaModules = list[str] | None
# P106: the Prima department their own Prima account gets (prima/client.PRIMA_DEPARTMENTS).
PrimaDepartment = Literal[
    "transport", "procurement", "hr", "finance", "chief_of_staff", "it", "legal", "audit",
    "operations", "asset", "pdpa", "fwm", "cms",
]  # fmt: skip
# P109: what of the Library a member reads (knowledge/dept_scope.py).
LibraryScope = Literal["company", "department"]


class _Password(BaseModel):
    @staticmethod
    def check_password(value: str) -> str:
        if len(value) < MIN_PASSWORD_LENGTH:
            raise ValueError(f"Use at least {MIN_PASSWORD_LENGTH} characters.")
        if value.strip() != value:
            raise ValueError("Remove spaces at the start or end.")
        return value


class SetupIn(_Password):
    workspace_name: str = Field(min_length=2, max_length=120)
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(max_length=200)

    _pw = field_validator("password")(_Password.check_password)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class ChangePasswordIn(_Password):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(max_length=200)

    _pw = field_validator("new_password")(_Password.check_password)


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    must_change_password: bool
    # P57: two-step sign-in is on; the workspace asks for it and it is not set up yet.
    two_factor_enabled: bool = False
    two_factor_setup_required: bool = False
    # P73: the system's developer (an owner who also has the Feedbacks page).
    is_developer: bool = False


class WorkspaceOut(BaseModel):
    id: str
    name: str
    slug: str
    timezone: str


class BranchRef(BaseModel):
    """P98: a branch by id and name."""

    id: str
    name: str


class ScopeOut(BaseModel):
    kind: Literal["all", "branch", "department", "own"]
    label: str
    branch_id: str | None = None
    branch_name: str | None = None
    department_id: str | None = None
    department_name: str | None = None
    # P98: every branch their scope covers (home first), with names.
    branches: list[BranchRef] = []


class MeOut(BaseModel):
    user: UserOut
    workspace: WorkspaceOut
    role: Role
    permissions: list[str]
    scope: ScopeOut | None = None
    assignable_roles: list[str] = []  # P92: the roles this person may give others
    # P99: Prima only (the office's pages are closed to them) and their chosen Prima screens.
    access: Access = "agentic"
    prima_modules: PrimaModules = None
    # P123: Prima is set up for this workspace: the app opens on Prima after signing in.
    prima: bool = False


class DepartmentRef(BaseModel):
    """P109: a department and its company (a head may head departments of several)."""

    id: str
    name: str
    branch_id: str | None = None
    branch_name: str | None = None


class MemberOut(BaseModel):
    user_id: str
    email: str
    name: str
    role: Role
    is_active: bool
    must_change_password: bool
    last_login_at: datetime | None
    joined_at: datetime
    branch_id: str | None = None  # the home (primary) branch
    branch_name: str | None = None
    # P98: every branch they work in, home first (branch_id is branches[0]).
    branches: list[BranchRef] = []
    department_id: str | None = None
    department_name: str | None = None
    agents: int = 0  # personal agents
    microsoft: bool = False  # P82: signed in with their Microsoft work account here
    # P97: who they report to, whether they head their department, how many report to them.
    reports_to_user_id: str | None = None
    reports_to_name: str | None = None
    heads_department: bool = False
    manages: int = 0
    # P99: what they reach: the office and Prima, or Prima only; and their Prima screens.
    access: Access = "agentic"
    prima_modules: PrimaModules = None
    prima_department: PrimaDepartment | None = None  # P106
    # P109: the departments they head (any company), what of the Library they read, and
    # whether they may upload files for other companies.
    head_of: list[DepartmentRef] = []
    library_scope: LibraryScope = "company"
    uploads_for_others: bool = False
    # P111: their job title (designation) on the organization chart.
    job_title: str | None = None


class MembersSummary(BaseModel):
    """P82: the whole list the reader may see (filters and search left out)."""

    members: int
    owners_admins: int
    temp_password: int
    microsoft: int
    agents: int
    roles: dict[str, int]


class MembersPageOut(BaseModel):
    """P82: one page of members (GET /api/members?page=...)."""

    items: list[MemberOut]
    total: int  # matching the filters and search
    page: int
    page_size: int
    summary: MembersSummary


class MembersBulkIn(BaseModel):
    user_ids: list[str] = Field(min_length=1, max_length=100)
    # P97 "manager": everyone ticked reports to manager_id (null: to no one).
    # P99 "prima": everyone ticked gets this access and/or these Prima screens.
    action: Literal["remove", "access", "manager", "prima"]
    role: Role | None = None
    branch_id: str | None = None
    department_id: str | None = None
    # P98: every branch they work in (branch_id, or the department's branch, is the home).
    branch_ids: list[str] | None = Field(default=None, max_length=100)
    manager_id: str | None = Field(default=None, max_length=40)
    # P99 (action "prima"): leave out what does not change; prima_modules null = all.
    access: Access | None = None
    prima_modules: PrimaModules = Field(default=None, max_length=200)


class MembersBulkResult(BaseModel):
    user_id: str
    ok: bool
    message: str | None = None


class MembersBulkOut(BaseModel):
    results: list[MembersBulkResult]
    done: int
    skipped: int


class MemberCreateIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=120)
    role: Role
    branch_id: str | None = None
    department_id: str | None = None
    branch_ids: list[str] | None = Field(default=None, max_length=100)  # P98
    # P99: the office and Prima (default), or Prima only; their Prima screens (null = all).
    access: Access = "agentic"
    prima_modules: PrimaModules = Field(default=None, max_length=200)
    prima_department: PrimaDepartment | None = None  # P106


class MemberCreateOut(BaseModel):
    member: MemberOut
    temp_password: str | None  # shown once; None when an existing account was added


class MemberUpdateIn(BaseModel):
    # P92: any of role (with its place), name and email; leave out what does not change.
    role: Role | None = None
    branch_id: str | None = None
    department_id: str | None = None
    branch_ids: list[str] | None = Field(default=None, max_length=100)  # P98: all branches
    name: str | None = Field(default=None, min_length=1, max_length=120)
    email: EmailStr | None = None
    # P97: heads their department; reports to this manager (send null to clear).
    heads_department: bool | None = None
    reports_to_user_id: str | None = Field(default=None, max_length=40)
    # P109: every department they head (any company; [] = none). Replaces heads_department.
    head_of: list[str] | None = Field(default=None, max_length=50)
    # P99: what they reach, and their Prima screens (send null for all their role allows).
    access: Access | None = None
    prima_modules: PrimaModules = Field(default=None, max_length=200)
    # P106: their Prima department (send null for none).
    prima_department: PrimaDepartment | None = None
    # P111: their job title on the organization chart (send "" or null to clear).
    job_title: str | None = Field(default=None, max_length=120)


class MemberTeamIn(BaseModel):
    """P97: the people who report to a manager (the whole list; others are let go)."""

    user_ids: list[str] = Field(default_factory=list, max_length=500)


class HierarchyPerson(BaseModel):
    """P111: one box of the organization chart (org/hierarchy.py). `limited`: a manager above
    the reader they would not otherwise see: name, job title, company and department only."""

    user_id: str
    name: str
    job_title: str | None = None
    role: Role | None = None
    branch_id: str | None = None
    branch_name: str | None = None
    branch_ids: list[str] = []
    department_id: str | None = None
    department_name: str | None = None
    reports_to_user_id: str | None = None
    # Their manager's name when the reader does not see the manager's own box.
    reports_to_name: str | None = None
    direct_reports: int | None = None
    heads_department: bool = False
    is_active: bool = True
    limited: bool = False
    # P113: the reader may change this person's line and job title.
    editable: bool = False


class HierarchyOut(BaseModel):
    """P111: everyone on the chart the reader may see, and whether they may change it."""

    people: list[HierarchyPerson]
    me: str
    can_edit: bool
    whole: bool  # sees the whole workspace in full (else their part, the rest by name only)
    # P113: where they change it: the workspace, their branch or department (None: view only).
    edit_scope: Literal["all", "branch", "department"] | None = None


class MyHierarchyOut(BaseModel):
    """P111: My workspace: my managers up to the top (mine first) and the people under me."""

    me: HierarchyPerson
    chain: list[HierarchyPerson]
    reports: list[HierarchyPerson]
    below: int  # everyone under me, down every line
    # P120: everyone under me down every line (each with who they report to), for the tree on
    # My workspace; at most LINE_SHOWN of them.
    line: list[HierarchyPerson] = []


class PrimaAccessIn(BaseModel):
    """P99: what one member reaches. Leave out what does not change; prima_modules null is
    all their Prima role allows."""

    access: Access | None = None
    prima_modules: PrimaModules = Field(default=None, max_length=200)
    # P106: the Prima department their own Prima account gets (send null for none).
    prima_department: PrimaDepartment | None = None


class LibraryAccessIn(BaseModel):
    """P109: what of the Library one member reads, and whether they may upload files for
    other companies. Leave out what does not change."""

    library_scope: LibraryScope | None = None
    uploads_for_others: bool | None = None


class TempPasswordOut(BaseModel):
    temp_password: str


class DepartmentOut(BaseModel):
    id: str
    branch_id: str
    name: str
    slug: str
    position: int


class BranchOut(BaseModel):
    id: str
    name: str
    slug: str
    color: str
    isolated: bool
    created_at: datetime
    departments: list[DepartmentOut]
    industry: str = ""
    # P33: standard | confidential | local_only (which AI providers may see its work).
    data_level: str = "standard"
    # Set on create with starter_team: the agents added (org/starter.py StarterResult).
    starter: dict | None = None


class BranchCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    color: str = Field(default="#13895f", pattern=HEX_COLOR)
    isolated: bool = False
    seed_departments: bool = True
    # P19: what the company does (picks its starter team), and whether to add that team now.
    industry: str | None = Field(default=None, max_length=60)
    starter_team: bool = False


class StarterTeamIn(BaseModel):
    industry: str = Field(default="general", min_length=1, max_length=60)


class BranchUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    color: str | None = Field(default=None, pattern=HEX_COLOR)
    isolated: bool | None = None
    data_level: Literal["standard", "confidential", "local_only"] | None = None


class DepartmentCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class DepartmentUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    position: int | None = Field(default=None, ge=0, le=999)


class AuditOut(BaseModel):
    id: int
    ts: datetime
    actor: str
    actor_name: str | None
    action: str
    target: str | None
    before: dict | None
    after: dict | None
    note: str | None


class AuditPage(BaseModel):
    items: list[AuditOut]
    next_before_id: int | None
    # First page only: entries per kind (signin, people, org, work, agents, other) and in all.
    kinds: dict[str, int] | None = None
    total: int | None = None


class ComponentStatus(BaseModel):
    name: str
    ok: bool
    detail: str
    latency_ms: int | None = None


class SystemStatusOut(BaseModel):
    ok: bool
    version: str
    components: list[ComponentStatus]
    counts: dict[str, int]
