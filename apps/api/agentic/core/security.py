"""Password hashing (argon2id), session tokens, and role permissions."""

import hashlib
import secrets
import string

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
)

# Office roles (P9) see and act only inside their scope (api/scope.py): a branch manager
# their branch, a HOD and a supervisor their department, staff their own agents. The
# workspace roles (owner, admin, operator, approver, viewer) see the whole workspace.
SCOPED_ROLES = frozenset({"branch_manager", "hod", "supervisor", "staff"})

_ADMIN = {
    "read",
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
}

# Capabilities per role. Approver and operator are siblings, not a ladder:
# operators drive work, approvers decide on it.
PERMISSIONS: dict[str, frozenset[str]] = {
    "owner": frozenset(_ADMIN | {"members.assign_owner"}),
    "admin": frozenset(_ADMIN),
    # Manage agents, work, approvals, logins and their own people, within the branch.
    "branch_manager": frozenset(
        {"read", "work.write", "approvals.decide", "agents.manage", "vault.manage", "team.manage"}
    ),
    # The same within one department.
    "hod": frozenset(
        {"read", "work.write", "approvals.decide", "agents.manage", "vault.manage", "team.manage"}
    ),
    # Runs the department's work day to day, but does not change agents.
    "supervisor": frozenset({"read", "work.write", "approvals.decide"}),
    # Has personal agents: creates them, gives them work, decides what they ask.
    "staff": frozenset({"read", "work.write", "approvals.decide", "agents.own", "vault.own"}),
    "operator": frozenset({"read", "org.read", "work.write"}),
    "approver": frozenset({"read", "org.read", "approvals.decide"}),
    "viewer": frozenset({"read", "org.read"}),
}


def can(role: str, permission: str) -> bool:
    return permission in PERMISSIONS.get(role, frozenset())
