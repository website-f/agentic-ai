"""Who may find what: the same rules as the pages that open each result.

A person:
- files: what the Files page shows them (documents.service.scoped: workspace roles all; a
  branch manager their company; others what they or their agents made) plus the library
  guidelines shared with them (knowledge.search.sees: company + department rules)
- SOPs: active ones in their library scope; drafts only for people who manage SOPs
  (org.manage), like the SOPs page
- Document Studio documents: as on the Documents page (service.scoped); templates: the
  whole workspace's and their company's
- wiki pages: workspace roles all; office roles workspace-wide pages and their company's

An agent: what read_file / find_sop / search_library let it read: its company's files and
the workspace's (department guidelines only for its department), active SOPs in its scope,
its company's documents and templates. No wiki pages (it has recall for those).

Held-back (quarantined) files are never found by anyone, managers included: their text is
for reading in the file viewer, not for search.
"""

from dataclasses import dataclass
from typing import Any

from sqlalchemy import ColumnElement, and_, false, or_, select, true

from ..core.security import can
from ..documents import service
from ..knowledge import search as library
from ..models import SOP, Agent, BrainPage, Department, DocFile, DocTemplate, Document


@dataclass(frozen=True)
class Viewer:
    workspace_id: str
    reader: library.Reader  # the library's scope (company + department)
    key: str  # cache key for this person's vocabulary
    principal: Any = None  # a person (None for an agent)
    agent: Agent | None = None
    drafts: bool = False  # sees draft SOPs
    user_id: str | None = None

    @property
    def everything(self) -> bool:
        return self.reader.everything

    # ------------------------------------------------------------ per kind

    def files(self) -> ColumnElement[bool]:
        ws = DocFile.workspace_id == self.workspace_id
        open_ = and_(ws, DocFile.quarantined.is_(False), DocFile.status == "ready")
        if self.everything:
            return open_
        shared = and_(DocFile.library.is_(True), _library_scope(self.reader))
        if self.agent is not None:
            r = self.reader
            branch = (
                or_(DocFile.branch_id.is_(None), DocFile.branch_id == r.branch_id)
                if r.branch_id
                else DocFile.branch_id.is_(None)
            )
            dept = (
                or_(DocFile.department_id.is_(None), DocFile.department_id == r.department_id)
                if r.department_id
                else DocFile.department_id.is_(None)
            )
            return and_(open_, branch, or_(DocFile.library.is_(False), dept))
        mine = service.scoped(select(DocFile.id).where(ws), DocFile, self.principal)
        return and_(open_, or_(DocFile.id.in_(mine), shared))

    def sops(self) -> ColumnElement[bool]:
        ws = SOP.workspace_id == self.workspace_id
        status = (
            or_(SOP.status == "active", SOP.status == "draft")
            if self.drafts
            else (SOP.status == "active")
        )
        if self.everything:
            return and_(ws, status)
        r = self.reader
        parts: list[ColumnElement[bool]] = [SOP.scope.in_(("workspace", "library"))]
        if r.branch_id:
            parts.append(and_(SOP.scope == "branch", SOP.scope_id == r.branch_id))
            depts = select(Department.id).where(Department.branch_id == r.branch_id)
            if not r.all_departments:
                depts = depts.where(
                    Department.id == r.department_id if r.department_id else false()
                )
            parts.append(and_(SOP.scope == "department", SOP.scope_id.in_(depts)))
        return and_(ws, status, or_(*parts))

    def documents(self) -> ColumnElement[bool]:
        ws = Document.workspace_id == self.workspace_id
        if self.everything:
            return ws
        if self.agent is not None:
            b = self.agent.branch_id
            return and_(ws, or_(Document.branch_id.is_(None), Document.branch_id == b))
        mine = service.scoped(select(Document.id).where(ws), Document, self.principal)
        return and_(ws, Document.id.in_(mine))

    def templates(self) -> ColumnElement[bool]:
        ws = DocTemplate.workspace_id == self.workspace_id
        if self.everything:
            return ws
        b = self.reader.branch_id
        return and_(
            ws,
            or_(DocTemplate.branch_id.is_(None), DocTemplate.branch_id == b)
            if b
            else (DocTemplate.branch_id.is_(None)),
        )

    def pages(self) -> ColumnElement[bool]:
        if self.agent is not None:
            return false()
        ws = and_(BrainPage.workspace_id == self.workspace_id, BrainPage.kind.in_(WIKI_KINDS))
        if self.everything:
            return ws
        b = self.reader.branch_id
        return and_(
            ws,
            or_(BrainPage.branch_id.is_(None), BrainPage.branch_id == b)
            if b
            else (BrainPage.branch_id.is_(None)),
        )


WIKI_KINDS = ("wiki", "decision")


def _library_scope(r: library.Reader) -> ColumnElement[bool]:
    """knowledge.search.scope_where, on files."""
    if r.everything:
        return true()
    branch = (
        or_(DocFile.branch_id.is_(None), DocFile.branch_id == r.branch_id)
        if r.branch_id
        else DocFile.branch_id.is_(None)
    )
    if r.all_departments:
        return branch
    dept = (
        or_(DocFile.department_id.is_(None), DocFile.department_id == r.department_id)
        if r.department_id
        else DocFile.department_id.is_(None)
    )
    return and_(branch, dept)


def for_person(principal: Any) -> Viewer:
    sc = principal.scope
    key = (
        f"{principal.workspace_id}:all"
        if sc.everything
        else f"{principal.workspace_id}:u:{principal.user.id}:{principal.role}"
        f":{principal.branch_id or '-'}:{principal.department_id or '-'}"
    )
    return Viewer(
        principal.workspace_id,
        library.for_person(principal),
        key,
        principal=principal,
        drafts=can(principal.role, "org.manage"),
        user_id=principal.user.id,
    )


def for_agent(agent: Agent) -> Viewer:
    return Viewer(
        agent.workspace_id,
        library.for_agent(agent),
        f"{agent.workspace_id}:a:{agent.id}",
        agent=agent,
    )
