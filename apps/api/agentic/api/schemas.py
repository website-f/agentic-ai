from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

from ..core.security import MIN_PASSWORD_LENGTH

Role = Literal["owner", "admin", "operator", "approver", "viewer"]
HEX_COLOR = r"^#[0-9a-fA-F]{6}$"


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


class WorkspaceOut(BaseModel):
    id: str
    name: str
    slug: str
    timezone: str


class MeOut(BaseModel):
    user: UserOut
    workspace: WorkspaceOut
    role: Role
    permissions: list[str]


class MemberOut(BaseModel):
    user_id: str
    email: str
    name: str
    role: Role
    is_active: bool
    must_change_password: bool
    last_login_at: datetime | None
    joined_at: datetime


class MemberCreateIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=120)
    role: Role


class MemberCreateOut(BaseModel):
    member: MemberOut
    temp_password: str | None  # shown once; None when an existing account was added


class MemberUpdateIn(BaseModel):
    role: Role


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


class BranchCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    color: str = Field(default="#13895f", pattern=HEX_COLOR)
    isolated: bool = False
    seed_departments: bool = True


class BranchUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    color: str | None = Field(default=None, pattern=HEX_COLOR)
    isolated: bool | None = None


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
