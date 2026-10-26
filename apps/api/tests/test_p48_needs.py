"""P48 "Needs you": what waits on each person, only what they may act on."""

from agentic.agents import runtime
from agentic.core.db import SessionLocal
from agentic.models import Task

from .conftest import csrf
from .test_agents import llm, new_agent, new_task, office, temporal  # noqa: F401
from .test_crm_money import invoice_pdf
from .test_office_roles import as_role
from .test_p43_receipts import ai, upload  # noqa: F401


def counts(body: dict) -> dict[str, int]:
    return {i["key"]: i["count"] for i in body["items"]}


async def test_needs_you_counts_only_what_each_person_may_act_on(client, llm, temporal, ai):
    o = await office(client)
    fin = await new_agent(client, o, "Faiz", "Finance")
    r = await client.get("/api/me/needs")
    assert r.status_code == 200 and r.json() == {"total": 0, "items": []}

    # An approval (a tool that asks), a bill to approve, and a failed task of mine.
    party = (
        await client.post(
            "/api/parties", json={"name": "Kedai Ali", "roles": ["customer"]}, headers=csrf(client)
        )
    ).json()
    t = await new_task(client, fin, "Invoice Kedai Ali")
    llm.call(
        "create_invoice_draft",
        party_id=party["id"],
        lines=[{"description": "Service", "qty": 1, "unit_price": 500, "tax_rate": 8}],
    )
    assert (await runtime.run_task_step(t["id"])).state == "needs_approval"
    await upload(client, invoice_pdf(), "r.pdf", "application/pdf")
    failed = await new_task(client, fin, "Pay the vendor")
    async with SessionLocal() as db:
        row = await db.get(Task, failed["id"])
        assert row is not None
        row.status = "failed"
        await db.commit()

    got = (await client.get("/api/me/needs")).json()
    c = counts(got)
    assert c["approvals"] == 1 and c["bills"] == 1 and c["failed"] == 1
    assert got["total"] == sum(c.values()) - c.get("routines", 0)
    bills = next(i for i in got["items"] if i["key"] == "bills")
    assert bills["to"] == "/money" and bills["search"] == {"tab": "payable"}

    # A staff member sees none of the owner's items.
    staff = await as_role(client, "aina@example.com", "staff", branch_id=o["branch"]["id"])
    try:
        mine = (await staff.get("/api/me/needs")).json()
        assert "bills" not in counts(mine) and "failed" not in counts(mine)
        assert "approvals" not in counts(mine)
    finally:
        await staff.aclose()
