"""Password hashing (argon2id), session tokens, and role permissions."""

import hashlib
import secrets
import string
from collections.abc import Mapping
from contextvars import ContextVar
from typing import Any

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_ph = PasswordHasher()  # argon2id, library defaults (RFC 9106 low-memory profile)

# Verifying against this when the email is unknown keeps login timing flat,
# so response time does not reveal which emails have accounts.
_DUMMY_HASH = _ph.hash("timing-equalizer-not-a-real-password")

MIN_PASSWORD_LENGTH = 10


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _ph.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _ph.check_needs_rehash(password_hash)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    """Sessions are stored by hash, so a database leak does not leak live cookies."""
    return hashlib.sha256(token.encode()).hexdigest()


def temp_password(length: int = 14) -> str:
    # No look-alike characters (0/O, 1/l/I): this gets read aloud or typed from a screen.
    alphabet = "".join(c for c in string.ascii_letters + string.digits if c not in "0O1lI")
    return "".join(secrets.choice(alphabet) for _ in range(length))


ROLES = (
    "owner",
    "admin",
    "branch_manager",
    "hod",
    "supervisor",
    "staff",
    "operator",
    "approver",
    "viewer",
    # P92: leadership roles that see the whole workspace: admin's access without the AI
    # engine, file storage and MCP tools (the owner can change that: Roles and access).
    "management",
    "hr",
)

# Office roles (P9) see and act only inside their scope (api/scope.py): a branch manager
# their branch, a HOD and a supervisor their department, staff their own agents. The
# workspace roles (owner, admin, operator, approver, viewer) see the whole workspace.
SCOPED_ROLES = frozenset({"branch_manager", "hod", "supervisor", "staff"})

_ADMIN = {
    "read",
    "office.view",
    "org.read",
    "members.manage",
    "org.manage",
    "audit.read",
    "work.write",
    "approvals.decide",
    "agents.manage",
    "engine.manage",
    "brain.manage",
    "channels.manage",
    "vault.manage",
    "assistants.use",
    "finance.view",
    "finance.manage",
    # P92: the AI engine's pages and reads (providers, models, usage), file storage settings
    # and MCP tools, each its own switch so the owner can give or take them per role.
    "engine.view",
    "storage.manage",
    "mcp.manage",
}

# P92: management and HR run the whole workspace like an admin, without the AI engine
# (seeing or changing it), file storage and MCP tools.
_LEADERSHIP = _ADMIN - {"engine.manage", "engine.view", "storage.manage", "mcp.manage"}

# P36 "office.view": the office beyond your own work (the command center, every agent, the
# brain, skills, schedules, the company overview, setup pages). Everyone but staff, who
# keep to their own desk, their own AI and the work and files they are part of.

# P35 "finance.view" / "finance.manage": money owed to and by the companies (invoices, bills,
# payments, reminders). Owner and admin for the whole workspace; a branch manager for their
# own company only (api/routers/money.py scopes it). Nobody else sees money.

# P30 "assistants.use": private personal assistants (company pulse, team performance, Gmail,
# calendar, chasing people) are for people who manage others: owner, admin, branch manager,
# HOD and supervisor. Everyone else has at most one personal AI, their twin (agents.own).

# Capabilities per role. Approver and operator are siblings, not a ladder:
# operators drive work, approvers decide on it.
PERMISSIONS: dict[str, frozenset[str]] = {
    "owner": frozenset(_ADMIN | {"members.assign_owner"}),
    "admin": frozenset(_ADMIN),
    # Manage agents, work, approvals, logins and their own people, within the branch.
    "branch_manager": frozenset(
        {
            "read",
            "office.view",
            "work.write",
            "approvals.decide",
            "agents.manage",
            "vault.manage",
            "team.manage",
            "assistants.use",
            "finance.view",
            "finance.manage",
        }
    ),
    # The same within one department.
    "hod": frozenset(
        {
            "read",
            "office.view",
            "work.write",
            "approvals.decide",
            "agents.manage",
            "vault.manage",
            "team.manage",
            "assistants.use",
        }
    ),
    # Runs the department's work day to day, but does not change agents.
    "supervisor": frozenset(
        {"read", "office.view", "work.write", "approvals.decide", "assistants.use"}
    ),
    # Has one personal agent, their AI twin: gives it work, decides what it asks. No private
    # assistants (assistants.use): those are for people who manage others.
    "staff": frozenset({"read", "work.write", "approvals.decide", "agents.own", "vault.own"}),
    "operator": frozenset({"read", "office.view", "org.read", "work.write", "engine.view"}),
    "approver": frozenset({"read", "office.view", "org.read", "approvals.decide", "engine.view"}),
    "viewer": frozenset({"read", "office.view", "org.read", "engine.view"}),
    "management": frozenset(_LEADERSHIP),
    "hr": frozenset(_LEADERSHIP),
}

# ---------------------------------------------------------------- P92: owner-set role access
#
# The table above is the default. The owner may give a role more (grant) or take some away
# (revoke) per workspace: Workspace.settings["role_permissions"] = {role: {"grant": [...],
# "revoke": [...]}}, edited on Settings > Roles and access (api/routers/role_access.py). The
# owner role itself is never edited, and the owner-only powers below are never given to
# anyone: making owners, editing role access, the CRM (shared part by part, P50) and the
# developer's feedback page. "read" (signing in at all) is never taken away.
#
# Each signed-in request reads the workspace's settings with the session (api/deps.py) and
# sets the table for that request (use_settings), so can() and every check built on it
# follow a change from the person's next request on. Code outside a request (bots, workers)
# that never set it uses the defaults.
ROLE_ACCESS_SETTING = "role_permissions"
OWNER_ONLY = frozenset({"members.assign_owner", "roles.manage", "crm.access", "feedback.manage"})
LOCKED = frozenset({"read"})
EDITABLE_ROLES = tuple(r for r in ROLES if r != "owner")
GRANTABLE = frozenset().union(*PERMISSIONS.values()) - OWNER_ONLY - LOCKED

_table: ContextVar[Mapping[str, frozenset[str]] | None] = ContextVar(
    "agentic_role_table", default=None
)


def role_overrides(ws_settings: Mapping[str, Any] | None) -> dict[str, dict[str, list[str]]]:
    """The workspace's saved changes, cleaned: known editable roles and grantable names only,
    a permission never both given and taken, and roles with no change left out."""
    raw = (ws_settings or {}).get(ROLE_ACCESS_SETTING)
    out: dict[str, dict[str, list[str]]] = {}
    if not isinstance(raw, Mapping):
        return out
    for role, change in raw.items():
        if role not in EDITABLE_ROLES or not isinstance(change, Mapping):
            continue
        grant = {p for p in change.get("grant") or () if isinstance(p, str) and p in GRANTABLE}
        revoke = {p for p in change.get("revoke") or () if isinstance(p, str) and p in GRANTABLE}
        default = PERMISSIONS[role]
        grant = (grant - default) - revoke
        revoke = revoke & default
        if grant or revoke:
            out[role] = {"grant": sorted(grant), "revoke": sorted(revoke)}
    return out


def effective(role: str, ws_settings: Mapping[str, Any] | None) -> frozenset[str]:
    """What this role may do in a workspace with these settings."""
    default = PERMISSIONS.get(role, frozenset())
    change = role_overrides(ws_settings).get(role)
    if change is None:
        return default
    return frozenset((default | set(change["grant"])) - set(change["revoke"]))


def use_settings(ws_settings: Mapping[str, Any] | None) -> None:
    """The role table for the rest of this request (or task): the workspace's own, else the
    defaults. Set on every signed-in request, so nothing carries over from another."""
    changes = role_overrides(ws_settings)
    _table.set({r: effective(r, ws_settings) for r in ROLES} if changes else None)


def role_permissions(role: str) -> frozenset[str]:
    table = _table.get()
    if table is not None and role in table:
        return table[role]
    return PERMISSIONS.get(role, frozenset())


def can(role: str, permission: str) -> bool:
    return permission in role_permissions(role)
