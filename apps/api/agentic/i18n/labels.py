"""Words that go into sentences as {vars}: role names and statuses, translated with them.

    api_error(403, "forbidden", "Your role ({role}) cannot do this.", role=role_label(r))

The "|..." tags keep a status word in a sentence apart from the same word as a label
("running|task status" reads "berjalan", the board column "Running" reads "Berjalan").
"""

from . import Msg

ROLES: dict[str, str] = {  # the same names the app shows (lib/types ROLE_INFO)
    "owner": "Owner",
    "admin": "Admin",
    "branch_manager": "Branch manager",
    "hod": "Head of department",
    "supervisor": "Supervisor",
    "staff": "Staff",
    "operator": "Operator",
    "approver": "Approver",
    "viewer": "Viewer",
}

AGENT_STATUS: dict[str, str] = {
    "active": "active|agent status",
    "paused": "paused|agent status",
    "retired": "retired|agent status",
}

TASK_STATUS: dict[str, str] = {
    "triage": "in triage|task status",
    "ready": "ready|task status",
    "running": "running|task status",
    "blocked": "waiting|task status",
    "review": "in review|task status",
    "done": "done|task status",
    "failed": "failed|task status",
    "cancelled": "cancelled|task status",
}

DECISION_STATUS: dict[str, str] = {  # approvals, email drafts, calendar proposals
    "pending": "pending|decision status",
    "approved": "approved|decision status",
    "denied": "denied|decision status",
    "answered": "answered|decision status",
    "expired": "expired|decision status",
    "cancelled": "cancelled|decision status",
    "done": "done|decision status",
    "sent": "sent|decision status",
    "discarded": "discarded|decision status",
    "failed": "failed|decision status",
}


def _label(table: dict[str, str], key: str) -> Msg | str:
    text = table.get(key)
    return Msg(text) if text else key


def role_label(role: str) -> Msg | str:
    return _label(ROLES, role)


def agent_status_label(status: str) -> Msg | str:
    return _label(AGENT_STATUS, status)


def task_status_label(status: str) -> Msg | str:
    return _label(TASK_STATUS, status)


def decision_status_label(status: str) -> Msg | str:
    return _label(DECISION_STATUS, status)
