"""P109 tables (migration 0069). Imported by agentic.models so Alembic and the app see them."""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
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

ACCOUNT_STATUSES = ("untested", "ok", "error", "pending")  # P124: pending approval
JOB_STATUSES = ("queued", "running", "done", "failed", "cancelled")
SOURCES = ("imap", "gmail")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


class ExternalMailAccount(Timestamps, Base):
    """Another email account a person connected besides Microsoft 365 (Gmail, Yahoo, a cPanel
    mailbox...), read over IMAP with an app password, so their attachments can be backed up
    into their own Files before they stop using it. Only its person ever uses it: no admin,
    no AI and no one else reads it. The password is encrypted at rest (core/crypto, bound to
    this row) and deleted when they disconnect. `backup_done_at`: a full backup finished."""

    __tablename__ = "mail_accounts"
    __table_args__ = (
        UniqueConstraint("workspace_id", "user_id", "email", name="uq_mail_accounts_email"),
        CheckConstraint(_in("status", ACCOUNT_STATUSES), name="ck_mail_accounts_status"),
        CheckConstraint("security IN ('ssl', 'starttls')", name="ck_mail_accounts_security"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("xm"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    email: Mapped[str] = mapped_column(String(254))
    provider: Mapped[str] = mapped_column(String(20), default="other")
    host: Mapped[str] = mapped_column(String(253))
    port: Mapped[int] = mapped_column(Integer, default=993)
    security: Mapped[str] = mapped_column(String(10), default="ssl")
    username: Mapped[str] = mapped_column(String(254))
    secret_enc: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(10), default="untested")
    last_error: Mapped[str | None] = mapped_column(String(500))
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    backup_done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def aad(self) -> str:
        return f"mail_account:{self.id}"


class MailBackupJob(Timestamps, Base):
    """One "back up all attachments" run of a person's other email account (IMAP), or of their
    Gmail connected with Google sign-in (source "gmail"). Runs on the worker in short rounds
    and resumes where it stopped (`progress`: per folder its UIDVALIDITY and the last UID done,
    or Gmail's page token). Files go to the person's own Files, "Email backup/<account>/
    <yyyy-mm>", each kept once (same content: skipped)."""

    __tablename__ = "mail_backup_jobs"
    __table_args__ = (
        CheckConstraint(_in("status", JOB_STATUSES), name="ck_mail_backup_jobs_status"),
        CheckConstraint(_in("source", SOURCES), name="ck_mail_backup_jobs_source"),
        Index("ix_mail_backup_jobs_owner", "workspace_id", "user_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("mbk"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    account_id: Mapped[str | None] = mapped_column(
        ForeignKey("mail_accounts.id", ondelete="SET NULL")
    )
    source: Mapped[str] = mapped_column(String(10), default="imap")
    label: Mapped[str] = mapped_column(String(254))  # the account's address
    status: Mapped[str] = mapped_column(String(12), default="queued")
    progress: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    messages_seen: Mapped[int] = mapped_column(Integer, default=0)
    messages_total: Mapped[int] = mapped_column(Integer, default=0)
    saved: Mapped[int] = mapped_column(Integer, default=0)
    duplicates: Mapped[int] = mapped_column(Integer, default=0)
    too_large: Mapped[int] = mapped_column(Integer, default=0)
    inline_skipped: Mapped[int] = mapped_column(Integer, default=0)
    bytes_saved: Mapped[int] = mapped_column(BigInteger, default=0)
    error: Mapped[str | None] = mapped_column(String(500))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
