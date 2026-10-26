"""P46: approval limits by amount. Small bills from suppliers approved before, and small
invoice drafts by agents, go through without a person; the rest waits, as before."""

from sqlalchemy import select

from agentic.agents import runtime
from agentic.core.db import SessionLocal
from agentic.models import Approval, MoneyDoc, TaskEvent

from .conftest import csrf
from .test_agents import llm, new_agent, new_task, office, temporal  # noqa: F401
from .test_crm_money import invoice_pdf
from .test_office_roles import as_role
from .test_p43_receipts import RECEIPT, ai, upload  # noqa: F401

ON = {
    "bills": {"enabled": True, "max": 100, "known_suppliers_only": True},
    "invoices": {"enabled": True, "max": 2000},
    "per_day": 20,
}


async def limits(client, body=None):
    if body is None:
        return await client.get("/api/approval-limits")
    return await client.put("/api/approval-limits", json=body, headers=csrf(client))


async def test_small_bills_from_known_suppliers_go_through(client, llm, temporal, ai):
    await office(client)
    r = await limits(client)
    assert r.status_code == 200 and r.json()["limits"]["bills"]["enabled"] is False
    # Off: a small receipt waits for a person, as before.
    first = (await upload(client, invoice_pdf(), "r1.pdf", "application/pdf")).json()
    assert first["status"] == "awaiting_approval"
    assert (await limits(client, ON)).status_code == 200

    # A new supplier's bill still waits even under the limit; a person approves it once.
    ai.bill = {**RECEIPT, "supplier_name": "Kedai Baru", "invoice_number": "K-1", "total": 20}
    new = (await upload(client, invoice_pdf(), "k1.pdf", "application/pdf")).json()
    assert new["status"] == "awaiting_approval"
    await client.post(f"/api/money/{new['id']}/approve", json={}, headers=csrf(client))

    # Now that supplier is known: the next small receipt is approved and, being paid, paid.
    ai.bill = {
        **RECEIPT,
        "supplier_name": "Kedai Baru",
        "invoice_number": "K-2",
        "total": 35,
        "issue_date": "2026-10-01",
    }
    auto = (await upload(client, invoice_pdf(), "k2.pdf", "application/pdf")).json()
    async with SessionLocal() as db:
        doc = await db.get(MoneyDoc, auto["id"])
    assert doc is not None and doc.status == "paid" and doc.approved_by == "system:limits"

    # Over the limit, or a possible duplicate: waits.
    ai.bill = {**RECEIPT, "supplier_name": "Kedai Baru", "invoice_number": "K-3", "total": 150}
    big = (await upload(client, invoice_pdf(), "k3.pdf", "application/pdf")).json()
    assert big["status"] == "awaiting_approval"
    ai.bill = {**RECEIPT, "supplier_name": "Kedai Baru", "invoice_number": "K-2", "total": 35}
    dup = (await upload(client, invoice_pdf(), "k2b.pdf", "application/pdf")).json()
    assert dup["status"] == "awaiting_approval" and dup["duplicate_of"]

    # The settings page lists what went through on its own.
    got = (await limits(client)).json()
    assert got["used_today"] == 1 and got["recent"][0]["money_doc_id"] == auto["id"]
    assert got["recent"][0]["label"].startswith("Kedai Baru")


async def test_the_daily_cap_and_who_may_change_the_limits(client, llm, temporal, ai):
    o = await office(client)
    await limits(
        client, {**ON, "bills": {**ON["bills"], "known_suppliers_only": False}, "per_day": 1}
    )
    ai.bill = {**RECEIPT, "supplier_name": "A Shop", "invoice_number": "A-1", "total": 10}
    one = (await upload(client, invoice_pdf(), "a1.pdf", "application/pdf")).json()
    ai.bill = {**RECEIPT, "supplier_name": "B Shop", "invoice_number": "B-1", "total": 12}
    two = (await upload(client, invoice_pdf(), "b1.pdf", "application/pdf")).json()
    async with SessionLocal() as db:
        assert (await db.get(MoneyDoc, one["id"])).approved_by == "system:limits"  # type: ignore[union-attr]
        assert (await db.get(MoneyDoc, two["id"])).status == "awaiting_approval"  # type: ignore[union-attr]
    staff = await as_role(client, "aina@example.com", "staff", branch_id=o["branch"]["id"])
    try:
        assert (await staff.get("/api/approval-limits")).status_code == 403
        assert (await limits(staff, ON)).status_code == 403
    finally:
        await staff.aclose()
    bad = await limits(client, {**ON, "per_day": 0})
    assert bad.status_code == 422


async def test_an_agent_drafts_a_small_invoice_without_asking(client, llm, temporal):
    o = await office(client)
    fin = await new_agent(client, o, "Faiz", "Finance")
    party = (
        await client.post(
            "/api/parties", json={"name": "Kedai Ali", "roles": ["customer"]}, headers=csrf(client)
        )
    ).json()
    small = {
        "party_id": party["id"],
        "lines": [{"description": "Service", "qty": 1, "unit_price": 500, "tax_rate": 8}],
    }
    big = {
        "party_id": party["id"],
        "lines": [{"description": "Project", "qty": 1, "unit_price": 9000, "tax_rate": 8}],
    }

    # Off: drafting an invoice asks a person.
    t1 = await new_task(client, fin, "Invoice Kedai Ali")
    llm.call("create_invoice_draft", **small)
    assert (await runtime.run_task_step(t1["id"])).state == "needs_approval"

    await limits(client, ON)
    t2 = await new_task(client, fin, "Invoice Kedai Ali again")
    llm.call("create_invoice_draft", **small).say("Drafted.")
    assert (await runtime.run_task_step(t2["id"])).state == "done"
    async with SessionLocal() as db:
        ev = await db.scalar(
            select(TaskEvent).where(
                TaskEvent.task_id == t2["id"], TaskEvent.kind == "auto_approved"
            )
        )
        assert ev is not None and "RM 540.00" in ev.text
        assert await db.scalar(select(Approval).where(Approval.task_id == t2["id"])) is None

    # Over the limit: it asks, as before.
    t3 = await new_task(client, fin, "Invoice the project")
    llm.call("create_invoice_draft", **big)
    assert (await runtime.run_task_step(t3["id"])).state == "needs_approval"
