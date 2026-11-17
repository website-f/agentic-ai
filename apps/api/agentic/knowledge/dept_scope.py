"""P109: Library by department.

A member's `library_scope` (memberships, migration 0068) is "company" (the default: what
everyone read before) or "department": they, and every agent they own (their AI twin and
personal agents), read only the files filed under their own department, plus their own files
(uploaded or made by them) and the files of work they take part in. Company files with no
department, other departments' files, the workspace-wide library and linked SharePoint folders
stay out of their Library, Files, search and their agents' recall. SOPs are procedures, not
files: they follow the usual rules.

It narrows only the office roles that sit in a department (HOD, supervisor, staff); the
workspace roles and branch managers see as before. It never widens anything: every rule here
is ANDed onto the existing scope (knowledge/search.py, search/viewer.py, documents/service.py).

For a person the setting is read with their session (api/deps.Principal.library_dept_only);
for an agent it is read in SQL from its owner's membership, so a change applies at once.
"""

from typing import Any

from sqlalchemy import ColumnElement, and_, exists, false, or_, select

from ..models import DocFile, KnowledgeChunk, Membership

LIMITABLE_ROLES = frozenset({"hod", "supervisor", "staff"})
DEPARTMENT = "department"


def applies(role: str, library_scope: str | None) -> bool:
    """Does the "own department only" setting narrow this member?"""
    return library_scope == DEPARTMENT and role in LIMITABLE_ROLES


def _limited(workspace_id: str, user_id: str) -> ColumnElement[bool]:
    """SQL: this member is set to their own department only."""
    return exists(
        select(Membership.user_id).where(
            Membership.workspace_id == workspace_id,
            Membership.user_id == user_id,
            Membership.library_scope == DEPARTMENT,
            Membership.role.in_(sorted(LIMITABLE_ROLES)),
        )
    )


def own_department_files(workspace_id: str, user_id: str) -> ColumnElement[bool]:
    """SQL on DocFile: the files a department-only member still reads: their department's,
    and their own."""
    dept = select(Membership.department_id).where(
        Membership.workspace_id == workspace_id,
        Membership.user_id == user_id,
        Membership.department_id.is_not(None),
    )
    return or_(
        DocFile.department_id.in_(dept),
        DocFile.owner_user_id == user_id,
        DocFile.created_by == f"user:{user_id}",
    )


def person_files(principal: Any) -> ColumnElement[bool] | None:
    """SQL on DocFile for a person's shared (library) files, or None when not narrowed."""
    if not getattr(principal, "library_dept_only", False):
        return None
    return own_department_files(principal.workspace_id, principal.user.id)


def agent_files(agent: Any) -> ColumnElement[bool] | None:
    """SQL on DocFile for an agent: narrowed when its owner is set to their department only
    (its own files and its owner's always stay). None for company agents (no owner)."""
    owner = getattr(agent, "owner_user_id", None)
    if not owner:
        return None
    ws = agent.workspace_id
    return or_(
        ~_limited(ws, owner),
        own_department_files(ws, owner),
        DocFile.agent_id == agent.id,
    )


def chunk_cond(workspace_id: str, user_id: str | None, dept_only: bool | None) -> Any:
    """SQL on KnowledgeChunk (library search, auto recall). dept_only True: narrowed; None:
    narrowed when `user_id`'s membership says so (an agent's owner); False: not narrowed."""
    if dept_only is False or not user_id:
        return None
    files = select(DocFile.id).where(
        DocFile.workspace_id == workspace_id, own_department_files(workspace_id, user_id)
    )
    allowed = or_(
        KnowledgeChunk.source_kind == "sop",
        and_(KnowledgeChunk.source_kind == "file", KnowledgeChunk.source_id.in_(files)),
    )
    if dept_only is True:
        return allowed
    return or_(~_limited(workspace_id, user_id), allowed)


def file_ok(dept_only: bool, user_id: str | None, department_id: str | None, f: DocFile) -> bool:
    """In Python, for one file (lists already loaded)."""
    if not dept_only:
        return True
    return bool(
        (department_id and f.department_id == department_id)
        or (user_id and (f.owner_user_id == user_id or f.created_by == f"user:{user_id}"))
    )


def recordings_cond(dept_only: bool, department_id: str | None, col: Any) -> Any:
    """SQL on a department column of things filed like files (meeting recordings)."""
    if not dept_only:
        return None
    return col == department_id if department_id else false()
