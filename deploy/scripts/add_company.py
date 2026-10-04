"""Add a company (branch) with the standard departments and its ready-made AI team.

Idempotent: an existing company with the same name (any case) is reused, and roles it already
has are skipped, so running it twice changes nothing. Uses the same code path as
POST /api/branches with starter_team (agentic/org/starter.py).

On the server (inside the api container, which has the app and its settings):
    docker compose exec -T api python - --name "MERDEKA NETWORK SDN BHD" --industry network \
        < deploy/scripts/add_company.py
    (add `-f docker-compose.vps.yml` or the project's compose files as deploy-vps.sh does)

From source on a dev machine (point it at the database):
    cd apps/api
    AGENTIC_DATABASE_URL=postgresql+asyncpg://agentic:agentic_dev@localhost:8506/agentic \
        uv run python ../../deploy/scripts/add_company.py --name "..." --industry engineering

Industries: general, network, engineering, trading, professional.
Options: --workspace <slug> when there is more than one workspace; --no-team for the
company and departments only; --color "#2f6db5".
"""

import argparse
import asyncio
import json
import sys


async def run(args: argparse.Namespace) -> dict:
    from sqlalchemy import func, select

    from agentic.api.routers.org import DEFAULT_DEPARTMENTS, _unique_slug
    from agentic.core.db import SessionLocal, engine
    from agentic.models import Branch, Department, Workspace
    from agentic.org import starter
    from agentic.services import audit
    from agentic.services.text import slugify

    industry = args.industry.strip().lower()
    if industry not in starter.INDUSTRIES:
        known = ", ".join(starter.INDUSTRIES)
        raise SystemExit(f"Unknown industry {industry!r}. Pick one of: {known}")
    actor = "system:add_company"
    try:
        async with SessionLocal() as db:
            q = select(Workspace)
            if args.workspace:
                q = q.where(Workspace.slug == args.workspace)
            spaces = list((await db.scalars(q)).all())
            if len(spaces) != 1:
                found = ", ".join(w.slug for w in spaces) or "none"
                raise SystemExit(f"Pick one workspace with --workspace (found: {found}).")
            ws = spaces[0]
            name = " ".join(args.name.split())
            branch = await db.scalar(
                select(Branch).where(
                    Branch.workspace_id == ws.id, func.lower(Branch.name) == name.lower()
                )
            )
            created_branch = branch is None
            if branch is None:
                slug = await _unique_slug(db, Branch, Branch.workspace_id, ws.id, name, "branch")
                branch = Branch(
                    workspace_id=ws.id,
                    name=name,
                    slug=slug,
                    color=args.color,
                    isolated=False,
                    industry=industry,
                )
                db.add(branch)
                await db.flush()
                db.add_all(
                    Department(
                        workspace_id=ws.id,
                        branch_id=branch.id,
                        name=n,
                        slug=slugify(n),
                        position=i,
                    )
                    for i, n in enumerate(DEFAULT_DEPARTMENTS)
                )
                await audit.record(
                    db,
                    ws.id,
                    actor,
                    "branch.created",
                    target=branch.id,
                    after={
                        "name": name,
                        "departments": len(DEFAULT_DEPARTMENTS),
                        "industry": industry,
                    },
                )
                await db.commit()
            elif not branch.industry:
                branch.industry = industry
                await db.commit()
            result = {
                "workspace": ws.slug,
                "branch_id": branch.id,
                "branch": branch.name,
                "branch_created": created_branch,
                "industry": industry,
            }
            if not args.no_team:
                res = await starter.add_starter_team(db, branch, industry, actor)
                await db.commit()
                result.update(res.public())
                try:  # let open pages refresh; harmless if Valkey is not reachable
                    from agentic.services import events

                    for p in res.created:
                        await events.publish(
                            ws.id, "agent.upsert", {"agent_id": p.agent_id, "name": p.name}
                        )
                except Exception as e:  # noqa: BLE001
                    print(f"(live refresh skipped: {e})", file=sys.stderr)
            return result
    finally:
        await engine.dispose()


def main() -> None:
    p = argparse.ArgumentParser(description="Add a company with its starter AI team.")
    p.add_argument("--name", required=True, help="Company name, e.g. 'MERDEKA NETWORK SDN BHD'")
    p.add_argument(
        "--industry",
        default="general",
        help="general | network | engineering | trading | professional",
    )
    p.add_argument("--workspace", default=None, help="Workspace slug (when there are several)")
    p.add_argument("--color", default="#13895f", help="Branch colour, e.g. #2f6db5")
    p.add_argument("--no-team", action="store_true", help="Only the company and its departments")
    args = p.parse_args(sys.argv[1:])
    print(json.dumps(asyncio.run(run(args)), indent=2))


if __name__ == "__main__":
    main()
