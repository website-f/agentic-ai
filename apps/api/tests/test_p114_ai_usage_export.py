"""P114 (Fitri, 18 Nov 2026): the developer downloads one person's AI usage report as Excel."""

from datetime import UTC, datetime, timedelta
from io import BytesIO

from openpyxl import load_workbook
from sqlalchemy import select

from agentic.core.db import SessionLocal
from agentic.models import AuditLog, Task

from .test_agents import new_agent, office
from .test_office_roles import as_role
from .test_p73_feedback import make_dev
from .test_p113_ai_usage_people import BASE, _call, _person, _ws


async def test_a_persons_report_downloads_as_excel(client):
    o = await office(client)
    ws = await _ws()
    agent = await new_agent(client, o, "Ana")
    a = await _person("Aina", "staff", o["branch"]["id"])
    async with SessionLocal() as db:
        t = Task(
            id="tk_p114x",
            workspace_id=ws.id,
            title="Aging report",
            brief="Overdue invoices by customer",
            result="Three customers are late",
            created_by=f"user:{a}",
            assignee_agent_id=agent["id"],
        )
        db.add(t)
        await db.commit()
    now = datetime.now(UTC) - timedelta(minutes=5)
    await _call(a, "agent.task", 1200, 300, 0.01, now, agent_id=agent["id"], task_id="tk_p114x")
    await _call(a, "agent.chat", 500, 100, 0.002, now - timedelta(minutes=1))

    staff = await as_role(client, "sam@example.com", "staff", branch_id=o["branch"]["id"])
    try:
        assert (await staff.get(f"{BASE}/{a}/report.xlsx?period=today")).status_code == 403
    finally:
        await staff.aclose()
    await make_dev()  # (owners and admins may download it too, P115)
    r = await client.get(f"{BASE}/{a}/report.xlsx?period=today")
    assert r.status_code == 200, r.text
    assert "AI-usage-Aina-" in r.headers["content-disposition"]
    book = load_workbook(BytesIO(r.content))
    assert book.sheetnames == [
        "Summary",
        "By feature",
        "By purpose",
        "By agent",
        "By model",
        "By day",
        "Calls",
    ]
    summary = {row[0]: row[1] for row in book["Summary"].iter_rows(min_row=2, values_only=True)}
    assert (
        summary["Person"] == "Aina" and summary["Calls"] == 2 and summary["Tokens (total)"] == 2100
    )
    calls = list(book["Calls"].iter_rows(min_row=2, values_only=True))
    assert len(calls) == 2
    head = [c.value for c in book["Calls"][1]]
    task_row = calls[0]
    assert task_row[head.index("Task")] == "Aging report"
    assert task_row[head.index("What they asked")] == "Overdue invoices by customer"
    assert task_row[head.index("What came back")] == "Three customers are late"
    async with SessionLocal() as db:
        logged = await db.scalar(
            select(AuditLog).where(AuditLog.action == "ai_usage.report_downloaded")
        )
        assert logged is not None and logged.target == a
