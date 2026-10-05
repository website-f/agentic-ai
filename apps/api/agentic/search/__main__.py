"""Rebuild the document search index:

    docker compose exec api python -m agentic.search reindex            # every workspace
    docker compose exec api python -m agentic.search reindex --workspace ws_...

Safe to run any time and more than once: only sources that changed since they were indexed
are rebuilt, and searches keep working meanwhile.
"""

import argparse
import asyncio

from sqlalchemy import select

from ..core.db import SessionLocal, engine
from ..models import Workspace
from . import index


async def _reindex(workspace_id: str | None) -> None:
    async with SessionLocal() as db:
        ids = (
            [workspace_id]
            if workspace_id
            else list((await db.scalars(select(Workspace.id).order_by(Workspace.id))).all())
        )
    for ws in ids:
        async with SessionLocal() as db:
            out = await index.reindex_workspace(db, ws)
            sources = await index.counts(db, ws)
        print(
            f"{ws}: indexed {out.get('indexed', 0)}, removed {out.get('removed', 0)}; now {sources}"
        )
    await engine.dispose()


def main() -> None:
    ap = argparse.ArgumentParser(prog="python -m agentic.search")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("reindex").add_argument("--workspace", default=None)
    args = ap.parse_args()
    if args.cmd == "reindex":
        asyncio.run(_reindex(args.workspace))


if __name__ == "__main__":
    main()
