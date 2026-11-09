from collections.abc import AsyncIterator, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .config import settings

engine = create_async_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Timestamps:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


# P96: a task step waits seconds at a time for the model and for browser actions. Its session
# kept its connection for all of it (a transaction stays open after the first read), so 50
# running steps held 50-100 connections doing nothing. Inside a step those waits now hand the
# connection back first; the next query takes one again.
_release_ok: ContextVar[bool] = ContextVar("db_release_while_waiting", default=False)


@contextmanager
def release_while_waiting() -> Iterator[None]:
    """Mark the code below (a task step) as safe to release idle connections in."""
    token = _release_ok.set(True)
    try:
        yield
    finally:
        _release_ok.reset(token)


async def release_idle(db: AsyncSession) -> None:
    """Before a long wait: end the session's read-only transaction so its connection goes back
    to the pool. Only inside release_while_waiting, and never with unsaved changes (those are
    the caller's to commit). Loaded objects stay usable (expire_on_commit=False)."""
    if not _release_ok.get() or not db.in_transaction():
        return
    if db.new or db.dirty or db.deleted:
        return
    await db.commit()
