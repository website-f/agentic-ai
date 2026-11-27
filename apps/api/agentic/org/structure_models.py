"""P145 tables (migration 0083): the group structure. Imported by agentic.models.

- org_units: offices, departments, divisions, regions and companies as a tree (parent_id); a
  unit may stand for an office company (branch_id) or department (department_id).
- org_positions: the job roles in a unit, each reporting to another position (reports_to_id).
memberships.position_id says which position a member holds (org/structure.py).
"""

from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base, Timestamps
from ..core.ids import new_id

UNIT_KINDS = ("governance", "office", "department", "unit", "division", "region", "company", "team")


class OrgUnit(Timestamps, Base):
    __tablename__ = "org_units"
    __table_args__ = (
        UniqueConstraint("workspace_id", "key", name="uq_org_units_ws_key"),
        CheckConstraint(
            "kind IN (" + ", ".join(f"'{k}'" for k in UNIT_KINDS) + ")", name="ck_org_units_kind"
        ),
        Index("ix_org_units_ws_parent", "workspace_id", "parent_id"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("ou"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(String(160))
    name_ms: Mapped[str | None] = mapped_column(String(160))
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("org_units.id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(String(16), default="unit", server_default="unit")
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id", ondelete="SET NULL"))
    department_id: Mapped[str | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL")
    )
    sort: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    custom: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")


class OrgPosition(Timestamps, Base):
    __tablename__ = "org_positions"
    __table_args__ = (
        UniqueConstraint("workspace_id", "key", name="uq_org_positions_ws_key"),
        Index("ix_org_positions_ws_unit", "workspace_id", "unit_id"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("op"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(String(80))
    title: Mapped[str] = mapped_column(String(160))
    title_ms: Mapped[str | None] = mapped_column(String(160))
    unit_id: Mapped[str] = mapped_column(ForeignKey("org_units.id", ondelete="CASCADE"))
    reports_to_id: Mapped[str | None] = mapped_column(
        ForeignKey("org_positions.id", ondelete="SET NULL")
    )
    level: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    default_role: Mapped[str | None] = mapped_column(String(16))
    headcount: Mapped[int | None] = mapped_column(Integer)
    duties: Mapped[str | None] = mapped_column(Text)
    aliases: Mapped[list[Any]] = mapped_column(JSONB, default=list, server_default="[]")
    sort: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    custom: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
