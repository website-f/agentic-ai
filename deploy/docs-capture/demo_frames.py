"""Give two demo agents a live browser screen (the Monitor shows it), from pictures of two
fictional websites rendered by capture.js (frames/*.html -> .work/frames/*.jpg).

    uv run python ../../deploy/docs-capture/demo_frames.py <frames dir>

Uses the same AGENTIC_DATABASE_URL / AGENTIC_VALKEY_URL as the demo API.
"""

import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps" / "api"))

# frame file -> the task whose agent has that page open
FRAMES = {
    "supplier-po.jpg": ("Submit PO on supplier portal: stretch film 120 rolls", "portal.sinarpack.example/po/new", "New purchase order · Sinar Pack Supplies"),
    "outlets.jpg": ("Draft proposal: Seri Murni Foods warehouse and last-mile", "www.serimurni-foods.example/outlets", "Our outlets · Seri Murni Foods"),
}


async def main() -> None:
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import select

    from agentic.core.db import SessionLocal, engine
    from agentic.core.valkey import valkey, valkey_bytes
    from agentic.models import Agent, Event, Task

    folder = Path(sys.argv[1])
    async with SessionLocal() as db:
        for fname, (title, url, page_title) in FRAMES.items():
            img = folder / fname
            t = await db.scalar(select(Task).where(Task.title == title))
            if t is None or not img.exists():
                print(f"skipped {fname}")
                continue
            a = await db.get(Agent, t.assignee_agent_id)
            sid = f"demo-{a.id[-8:]}"
            meta = json.dumps({"workspace_id": t.workspace_id, "agent_id": a.id, "task_id": t.id})
            await valkey().set(f"browser:session:{sid}", meta)
            await valkey().set(f"browser:agent:{a.id}", sid)
            await valkey_bytes().set(f"browser:frame:{sid}", img.read_bytes())
            await valkey().set(f"browser:frame_seq:{sid}", 1)
            have = await db.scalar(
                select(Event).where(Event.type == "agent.activity", Event.data["session"].astext == sid)
            )
            if have is None:
                now = datetime.now(UTC)
                db.add(Event(workspace_id=t.workspace_id, ts=now - timedelta(minutes=5), type="agent.activity", data={"agent_id": a.id, "agent_name": a.name, "task_id": t.id, "task_title": t.title, "kind": "browser", "action": "goto", "title": page_title, "url": "https://" + url, "session": sid}))
            print(f"browser screen for {a.name}")
        await db.commit()
    # P31: the owner's demo laptop (seed_demo.py) shows as online, as a running PC agent would.
    await valkey().set("devices:online:dv_demo_aminah_laptop", json.dumps({"conn": "demo", "base": ""}), ex=6 * 3600)
    await engine.dispose()


if __name__ == "__main__":
    os.environ.setdefault("AGENTIC_TEMPORAL_TASK_QUEUE", "agentic-office")
    asyncio.run(main())
