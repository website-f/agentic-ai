"""Tables behind document search (migration 0026).

Passages hold text only: who may see a passage is decided at query time by joining its
source (files, sops, documents, doc_templates, brain_pages), so a file moved to another
company, a department SOP or a file held back is never found by the wrong person, however
old the index is.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base

KINDS = ("file", "sop", "document", "template", "page")


class SearchPassage(Base):
    """One searchable stretch of a source: a passage of a file (with its page), an SOP, a
    document, a template or a wiki page. `tsv` is built by search.text, not by Postgres."""

    __tablename__ = "search_passages"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    source_kind: Mapped[str] = mapped_column(String(16))
    source_id: Mapped[str] = mapped_column(String(40))
    file_id: Mapped[str | None] = mapped_column(ForeignKey("files.id", ondelete="CASCADE"))
    idx: Mapped[int] = mapped_column(Integer)
    page: Mapped[int | None] = mapped_column(Integer)
    heading: Mapped[str] = mapped_column(String(300), default="")
    text: Mapped[str] = mapped_column(Text)
    tsv: Mapped[Any] = mapped_column(TSVECTOR)


class SearchHeading(Base):
    """A heading of a source (intake.builders.outline), for suggestions as people type."""

    __tablename__ = "search_headings"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    source_kind: Mapped[str] = mapped_column(String(16))
    source_id: Mapped[str] = mapped_column(String(40))
    file_id: Mapped[str | None] = mapped_column(ForeignKey("files.id", ondelete="CASCADE"))
    page: Mapped[int | None] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(String(300))


class SearchSource(Base):
    """What is indexed, and from which version of its source (so a sync redoes only what
    changed). Files: sha256 + pages; the rest: updated_at."""

    __tablename__ = "search_sources"

    source_kind: Mapped[str] = mapped_column(String(16), primary_key=True)
    source_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    file_id: Mapped[str | None] = mapped_column(ForeignKey("files.id", ondelete="CASCADE"))
    version: Mapped[str] = mapped_column(String(120), default="")
    passages: Mapped[int] = mapped_column(Integer, default=0)
    indexed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
