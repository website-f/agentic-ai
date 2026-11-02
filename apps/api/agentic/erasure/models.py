"""P57 tables. Imported by agentic.models so Alembic and the app see them."""

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base
from ..core.ids import new_id


class WorkspaceExport(Base):
    """One export of everything a workspace holds: a ZIP on this server's disk, downloadable
    once by an owner with a signed, expiring link. Deleted with the workspace."""

    __tablename__ = "workspace_exports"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("wx"))
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    requested_by: Mapped[str] = mapped_column(String(40))  # user id
    # queued | running | ready | downloaded | failed | expired
    status: Mapped[str] = mapped_column(String(16), default="queued")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    step: Mapped[str] = mapped_column(String(40), default="")
    path: Mapped[str | None] = mapped_column(String(500))  # relative to settings.files_dir
    size: Mapped[int] = mapped_column(BigInteger, default=0)
    counts: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    sha256: Mapped[str | None] = mapped_column(String(64))  # of the ZIP, for checking it
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    downloaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ErasureRecord(Base):
    """Server level, kept after the workspace is gone: proof that it was erased, and when.
    Ids, a name, counts, timestamps and the certificate's hash; never any content. The
    column is erased_workspace_id (not workspace_id) on purpose: the check that no row with
    the workspace's id remains looks at every table with a workspace_id column."""

    __tablename__ = "erasure_records"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("er"))
    erased_workspace_id: Mapped[str] = mapped_column(String(40), index=True)
    workspace_name: Mapped[str] = mapped_column(String(120))
    requested_by: Mapped[str] = mapped_column(String(40))  # user id
    # requested | erasing | done | cancelled | failed
    status: Mapped[str] = mapped_column(String(16), default="requested")
    step: Mapped[str] = mapped_column(String(40), default="")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    counts: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    revoked: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    # Lets the owner follow the erase and fetch the certificate after their session is gone.
    access_hash: Mapped[str | None] = mapped_column(String(64))
    certificate_sha256: Mapped[str | None] = mapped_column(String(64))
    error: Mapped[str | None] = mapped_column(String(500))
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    due_by: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
