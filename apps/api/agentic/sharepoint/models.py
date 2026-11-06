"""P80 tables (migration 0053). Imported by agentic.models so Alembic and the app see them."""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base, Timestamps
from ..core.ids import new_id

SOURCE_STATUSES = ("syncing", "ready", "needs_reconnect", "error")
FILE_STATUSES = ("indexed", "empty", "held", "too_large", "failed")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


class LinkedSource(Timestamps, Base):
    """A SharePoint or OneDrive folder (or one file) the Library reads, connected from a pasted
    link with the connecting person's own Microsoft 365 sign-in (read-only scopes). The files
    stay at Microsoft: only their searchable text is kept (knowledge_chunks, source_kind
    "sharepoint", one source per LinkedFile). Scope: branch_id None = every company, else one
    company. Status: syncing | ready | needs_reconnect (the connecting person's Microsoft
    sign-in stopped working: nothing is retried until it works again) | error."""

    __tablename__ = "linked_sources"
    __table_args__ = (
        UniqueConstraint("workspace_id", "drive_id", "item_id", name="uq_linked_sources_item"),
        CheckConstraint(_in("status", SOURCE_STATUSES), name="ck_linked_sources_status"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("ls"))
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    connected_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    connected_by_name: Mapped[str] = mapped_column(String(200), default="")
    provider: Mapped[str] = mapped_column(String(16), default="sharepoint")  # | onedrive
    drive_id: Mapped[str] = mapped_column(String(200))
    item_id: Mapped[str] = mapped_column(String(200))
    is_folder: Mapped[bool] = mapped_column(Boolean, default=True)
    name: Mapped[str] = mapped_column(String(300), default="")
    web_url: Mapped[str] = mapped_column(Text, default="")
    branch_id: Mapped[str | None] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(20), default="syncing")
    last_error: Mapped[str | None] = mapped_column(String(500))
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sync_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    files_seen: Mapped[int] = mapped_column(Integer, default=0)
    # The folder holds more than the limits (settings.sharepoint_max_files / _depth): only the
    # first ones (by path) are read.
    capped: Mapped[bool] = mapped_column(Boolean, default=False)


class LinkedFile(Timestamps, Base):
    """One file of a linked source: where it is (path, link) and the cTag it had when its text
    was indexed. The file's bytes are never kept. Status: indexed | empty (no text in it) |
    held (P24: it holds passwords or IC numbers, so it is never searchable) | too_large |
    failed (error says why)."""

    __tablename__ = "linked_files"
    __table_args__ = (
        UniqueConstraint("source_id", "item_id", name="uq_linked_files_item"),
        CheckConstraint(_in("status", FILE_STATUSES), name="ck_linked_files_status"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("lf"))
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    source_id: Mapped[str] = mapped_column(ForeignKey("linked_sources.id", ondelete="CASCADE"))
    item_id: Mapped[str] = mapped_column(String(200))
    name: Mapped[str] = mapped_column(String(300), default="")
    path: Mapped[str] = mapped_column(String(1000), default="")
    web_url: Mapped[str] = mapped_column(Text, default="")
    etag: Mapped[str] = mapped_column(String(200), default="")
    ctag: Mapped[str] = mapped_column(String(200), default="")
    size: Mapped[int] = mapped_column(BigInteger, default=0)
    status: Mapped[str] = mapped_column(String(16), default="indexed")
    passages: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(String(300))
    indexed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
