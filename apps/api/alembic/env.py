import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

from agentic import models  # noqa: F401 - registers tables on Base.metadata
from agentic.core.config import settings
from agentic.core.db import Base

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# Indexes written by hand in migrations (GIN / HNSW / expression indexes the models do not
# declare). Without this, autogenerate "helpfully" drops them in the next revision.
MANUAL_INDEXES = {
    "ix_brain_chunks_tsv",
    "ix_brain_chunks_embedding",
    "ix_brain_facts_tsv",
    "ix_brain_facts_embedding",
    "ix_agent_messages_fts",
    "ix_knowledge_chunks_tsv",
    "ix_knowledge_chunks_embedding",
    "ux_agents_one_twin",
    "ix_approvals_page",
    "ix_tasks_page",
    "ix_meetings_page",
    "ix_broadcasts_page",
    "ix_chat_sessions_page",
    "ix_skill_proposals_page",
}


def include_object(obj, name, type_, reflected, compare_to):  # noqa: ARG001 - alembic hook
    return not (type_ == "index" and name in MANUAL_INDEXES)


def _url() -> str:
    return config.attributes.get("database_url") or settings.database_url


def run_migrations_offline() -> None:
    context.configure(
        url=_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def _do_run(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = create_async_engine(_url())
    async with engine.connect() as connection:
        await connection.run_sync(_do_run)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
