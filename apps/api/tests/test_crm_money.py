"""P35: customers and suppliers (parties), deals, money owed to and by the companies, bills
captured from email, payment reminders, agent tools and the privacy dictionary.

Microsoft Graph and the AI are fakes: nothing real is called.
"""

import json
from datetime import timedelta
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import func, select

from agentic.agents import policy, runtime
from agentic.agents.tools import TOOLS, ToolContext
from agentic.core.db import SessionLocal
from agentic.crm import access as crm_access
from agentic.crm import mail as crm_mail
from agentic.crm import reminders
from agentic.crm import service as svc
from agentic.engine import client as engine_client
from agentic.engine import gateway, privacy
from agentic.microsoft import features, hooks
from agentic.models import (
    Agent,
    EmailDraft,
    Interaction,
    MailItem,
    MoneyDoc,
    Party,
    Task,
    Workspace,
)

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_mail_features import mail_item, outlook, shared_mailbox  # noqa: F401
from .test_microsoft import count, make_agent, user_id
from .test_office_roles import as_role

# ---------------------------------------------------------------- fakes and helpers

BILL = {
    "supplier_name": "Bekalan Jaya Sdn Bhd",
    "supplier_tin": "C2584563200",
    "supplier_reg_no": "201901012345",
    "supplier_email": "accounts@bekalanjaya.example.com",
    "invoice_number": "BJ-2026-077",
    "issue_date": "2026-10-10",
    "due_date": "2026-11-09",
    "currency": "MYR",
    "subtotal": "1,000.00",
    "tax_total": 60,
    "total": 1060,
    "lines": [{"description": "Steel bars", "qty": 10, "unit_price": 100, "tax_rate": 6}],
}


class FakeAI:
    """gateway.chat: the mail classification and the bill reader answer JSON."""

    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.category = "invoice"
        self.bill: dict = dict(BILL)

    async def chat(self, db, workspace_id, group, messages, **kw):
        self.calls.append({"group": group, "messages": messages, **kw})
        if kw.get("task") == "mail.classify":
            content = json.dumps(
                {
                    "category": self.category,
                    "summary": "A supplier asks us to pay a bill",
                    "needs_person": True,
                    "due_date": None,
                }
            )
        elif kw.get("task") == "money.capture":
            content = json.dumps(self.bill)
        else:
            content = "{}"
        if kw.get("accept") is not None:
            assert kw["accept"](content), content
        return SimpleNamespace(content=content)


@pytest.fixture
def ai(monkeypatch):
    fake = FakeAI()
    monkeypatch.setattr(gateway, "chat", fake.chat)
    return fake


def invoice_pdf(number: str = "BJ-2026-077") -> bytes:
    from fpdf import FPDF

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=12)
    text = (
        f"TAX INVOICE\nBekalan Jaya Sdn Bhd (201901012345)\nTIN: C2584563200\n"
        f"Invoice No: {number}\nDate: 10/10/2026  Due: 09/11/2026\nSteel bars 10 x 100.00\n"
        "Subtotal 1,000.00  SST 6% 60.00  Total RM 1,060.00"
    )
    pdf.multi_cell(0, 8, text)
    return bytes(pdf.output())


async def two_companies(client: httpx.AsyncClient) -> dict:
    o = await office(client)
    b2 = (
        await client.post("/api/branches", json={"name": "Jaya Bhd"}, headers=csrf(client))
    ).json()
    o["b2"] = b2
    return o


async def new_party(c: httpx.AsyncClient, **kw) -> dict:
    body = {"name": "Kedai Runcit Ali", "roles": ["customer"], **kw}
    r = await c.post("/api/parties", json=body, headers=csrf(c))
    assert r.status_code == 201, r.text
    return r.json()


async def new_money(c: httpx.AsyncClient, party_id: str, branch_id: str, **kw) -> dict:
    body = {
        "direction": "receivable",
        "party_id": party_id,
        "branch_id": branch_id,
        "lines": [{"description": "Service", "qty": 2, "unit_price": 500, "tax_rate": 8}],
        **kw,
    }
    r = await c.post("/api/money", json=body, headers=csrf(c))
    assert r.status_code == 201, r.text
    return r.json()


async def post(c: httpx.AsyncClient, url: str, body: dict | None = None) -> httpx.Response:
    return await c.post(url, json=body or {}, headers=csrf(c))


async def ws_today(ws_id: str):
    async with SessionLocal() as db:
        return await svc.today(db, ws_id)


async def get(model, id_):
    async with SessionLocal() as db:
        return await db.get(model, id_)


async def run_tool(agent_id: str, name: str, args: dict) -> str:
    async with SessionLocal() as db:
        agent = await db.get(Agent, agent_id)
        ws = await db.get(Workspace, agent.workspace_id)
        return await TOOLS[name].handler(
            ToolContext(db=db, agent=agent, workspace=ws, task=None), args
        )


# ---------------------------------------------------------------- permissions


async def test_permissions_money_is_for_finance_people_only(client, llm, temporal):
    o = await two_companies(client)
    a, b = o["branch"]["id"], o["b2"]["id"]
    me = (await client.get("/api/auth/me")).json()
    assert {"finance.view", "finance.manage"} <= set(me["permissions"])
    pa = await new_party(client, name="Pelanggan A", branch_id=a)
    pb = await new_party(client, name="Pelanggan B", branch_id=b)
    shared = await new_party(client, name="Shared Supplier", roles=["supplier"])
    ma = await new_money(client, pa["id"], a)
    mb = await new_money(client, pb["id"], b)

    staff = await as_role(
        client, "staff@example.com", "staff", branch_id=a, department_id=o["depts"]["Finance"]
    )
    bm = await as_role(client, "bm@example.com", "branch_manager", branch_id=a)
    viewer = await as_role(client, "viewer@example.com", "viewer")
    try:
        me = (await staff.get("/api/auth/me")).json()
        assert "finance.view" not in me["permissions"]
        # Staff: no money at all, parties of their own company and the shared ones only.
        assert (await staff.get("/api/money")).status_code == 403
        assert (await staff.get("/api/money/summary")).status_code == 403
        assert (await staff.get(f"/api/money/{ma['id']}")).status_code == 403
        rows = (await staff.get("/api/parties")).json()
        assert {p["name"] for p in rows["items"]} == {"Pelanggan A", "Shared Supplier"}
        assert all(p["balances"] is None for p in rows["items"])
        detail = (await staff.get(f"/api/parties/{pa['id']}")).json()
        assert detail["money"] is None and detail["can_archive"] is False
        assert (await staff.get(f"/api/parties/{pb['id']}")).status_code == 404
        tl = (await staff.get(f"/api/parties/{pa['id']}/timeline")).json()
        assert all(i["kind"] not in ("invoice", "payment") for i in tl["items"])
        # Staff write in their own company, never another's.
        r = await post(staff, "/api/parties", {"name": "Staff Lead", "branch_id": b})
        assert r.status_code == 403
        assert (
            await post(staff, "/api/parties", {"name": "Staff Lead", "branch_id": a})
        ).status_code == 201
        assert (await post(staff, f"/api/parties/{pa['id']}/archive")).status_code == 403

        # Branch manager: their own company's money only.
        rows = (await bm.get("/api/money")).json()
        assert [m["id"] for m in rows["items"]] == [ma["id"]] and rows["total"] == 1
        assert (await bm.get(f"/api/money/{mb['id']}")).status_code == 404
        assert (await bm.get(f"/api/money/summary?branch_id={b}")).status_code == 404
        assert (await bm.get(f"/api/branches/{b}/reminders")).status_code == 404
        assert (await bm.get(f"/api/branches/{a}/reminders")).status_code == 200
        r = await post(bm, f"/api/money/{mb['id']}/approve")
        assert r.status_code == 404
        listed = {p["name"]: p for p in (await bm.get("/api/parties")).json()["items"]}
        assert listed["Pelanggan A"]["balances"]["receivable_open"] == 0  # a draft is not owed
        assert "Pelanggan B" not in listed

        # Viewer: reads every company's parties, changes nothing, sees no money.
        names = {p["name"] for p in (await viewer.get("/api/parties?limit=50")).json()["items"]}
        assert {"Pelanggan A", "Pelanggan B", "Shared Supplier"} <= names
        assert (await post(viewer, "/api/parties", {"name": "X"})).status_code == 403
        r = await viewer.patch(
            f"/api/parties/{shared['id']}", json={"phone": "1"}, headers=csrf(viewer)
        )
        assert r.status_code == 403
        assert (await viewer.get("/api/money")).status_code == 403
    finally:
        for c in (staff, bm, viewer):
            await c.aclose()


# ---------------------------------------------------------------- parties


async def test_party_crud_contacts_notes_and_duplicates(client, llm, temporal):
    o = await office(client)
    a = o["branch"]["id"]
    p = await new_party(
        client,
        name="  Maju   Trading Sdn. Bhd. ",
        branch_id=a,
        roles=["customer", "supplier"],
        tin="C 2584 5632 00",
        reg_no="201901099999",
        email="Sales@MajuTrading.example.com",
        website="https://www.majutrading.example.com",
        address={
            "lines": ["No 1, Jalan Ampang"],
            "city": "Kuala Lumpur",
            "postcode": "50450",
            "state": "W.P. Kuala Lumpur",
            "country": "Malaysia",
        },
        tags=["vip", "vip", " steel "],
        contact={"name": "Siti Aminah", "email": "siti@majutrading.example.com"},
        source="ignored by the server",
    )
    assert p["name"] == "Maju Trading Sdn. Bhd." and p["email"] == "sales@majutrading.example.com"
    assert p["tags"] == ["vip", "steel"] and p["roles"] == ["customer", "supplier"]
    assert p["primary_contact"]["name"] == "Siti Aminah" and p["contacts"][0]["is_primary"]
    assert p["balances"] is not None and p["money"]["recent"] == []  # the owner is finance

    # Contacts: a new primary takes over; edit; delete.
    r = await post(
        client,
        f"/api/parties/{p['id']}/contacts",
        {"name": "Lim Wei Ming", "email": "lim@majutrading.example.com", "is_primary": True},
    )
    assert r.status_code == 201
    lim = r.json()
    detail = (await client.get(f"/api/parties/{p['id']}")).json()
    assert [c["name"] for c in detail["contacts"]] == ["Lim Wei Ming", "Siti Aminah"]
    assert [c["is_primary"] for c in detail["contacts"]] == [True, False]
    r = await client.patch(
        f"/api/party-contacts/{lim['id']}", json={"title": "Buyer"}, headers=csrf(client)
    )
    assert r.json()["title"] == "Buyer"
    bad = await client.patch(
        f"/api/party-contacts/{lim['id']}", json={"email": "not-an-email"}, headers=csrf(client)
    )
    assert bad.status_code == 422
    assert (
        await client.delete(
            f"/api/party-contacts/{lim['id']}",
            headers={**csrf(client), "content-type": "application/json"},
        )
    ).status_code == 204

    # Edit, list with search and filters.
    r = await client.patch(
        f"/api/parties/{p['id']}",
        json={"phone": "03-1234 5678", "payment_terms_days": 45},
        headers=csrf(client),
    )
    assert r.status_code == 200 and r.json()["payment_terms_days"] == 45
    await new_party(client, name="Another Customer", tags=["retail"])
    rows = (await client.get("/api/parties?q=siti")).json()
    assert [x["id"] for x in rows["items"]] == [p["id"]]
    assert (await client.get("/api/parties?role=supplier")).json()["total"] == 1
    assert (await client.get("/api/parties?tag=retail")).json()["total"] == 1
    page = (await client.get("/api/parties?limit=1&offset=1")).json()
    assert page["total"] == 2 and len(page["items"]) == 1

    # Notes on the timeline.
    r = await post(client, f"/api/parties/{p['id']}/notes", {"text": "Wants a 5% discount."})
    assert r.status_code == 201 and r.json()["kind"] == "note"
    tl = (await client.get(f"/api/parties/{p['id']}/timeline")).json()
    assert tl["items"][0]["text"] == "Wants a 5% discount." and tl["total"] == 1
    assert set(tl["items"][0]["links"]) == {
        "task_id",
        "document_id",
        "money_doc_id",
        "deal_id",
        "mail_item_id",
    }

    # Duplicates: the same TIN written another way, and the same name without "Sdn Bhd".
    twin = await new_party(client, name="MAJU TRADING", tin="C2584563200")
    assert {d["id"] for d in twin["possible_duplicates"]} == {p["id"]}
    groups = (await client.get("/api/parties/duplicates")).json()
    reasons = {g["reason"] for g in groups["items"]}
    assert "tin" in reasons and groups["total"] == len(groups["items"])
    assert all(len(g["parties"]) == 2 for g in groups["items"])

    # Archive and bring back (owner); the archived one leaves the default list.
    r = await client.post(  # the web app posts it with no body at all
        f"/api/parties/{twin['id']}/archive",
        headers={**csrf(client), "content-type": "application/json"},
    )
    assert r.status_code == 200 and r.json()["status"] == "archived"
    # Blank form fields read as "not given".
    blank = await new_party(
        client, name="Blank Form", branch_id="", currency="", payment_terms_days="", contact={}
    )
    assert blank["branch_id"] is None and blank["currency"] == "MYR" and blank["contacts"] == []
    assert twin["id"] not in {x["id"] for x in (await client.get("/api/parties")).json()["items"]}
    archived = (await client.get("/api/parties?status=archived")).json()["items"]
    assert [x["id"] for x in archived] == [twin["id"]]
    r = await post(client, f"/api/parties/{twin['id']}/archive", {"restore": True})
    assert r.json()["status"] == "active"


# ---------------------------------------------------------------- import


async def test_import_preview_suggests_mapping_and_commit_creates_and_updates(
    client, llm, temporal
):
    o = await office(client)
    await new_party(
        client, name="Syarikat Lama", reg_no="200801000111", branch_id=o["branch"]["id"]
    )
    sheet = (
        "Senarai pelanggan 2026\n"
        "Nama Syarikat,Emel,No SSM,TIN,Jenis,PIC,Poskod\n"
        "Syarikat Lama Sdn Bhd,lama@example.com,200801000111,,pelanggan,Encik Abu,50000\n"
        "Kilang Baru Enterprise,baru@example.com,,IG1234567890,pembekal,Puan Rosnah,40000\n"
        ",nobody@example.com,,,,,\n"
    )
    r = await client.post(
        "/api/parties/import?name=pelanggan.csv",
        content=sheet.encode(),
        headers={**csrf(client), "content-type": "application/octet-stream"},
    )
    assert r.status_code == 200, r.text
    prev = r.json()
    assert prev["header_row"] == 2 and prev["count"] == 3
    m = prev["mapping"]
    assert m["Nama Syarikat"] == "name" and m["Emel"] == "email" and m["No SSM"] == "reg_no"
    assert m["TIN"] == "tin" and m["Jenis"] == "roles" and m["PIC"] == "contact_name"
    assert m["Poskod"] == "postcode"
    assert prev["rows"][1]["Nama Syarikat"] == "Kilang Baru Enterprise"

    # A browser's FormData works the same.
    r = await client.post(
        "/api/parties/import",
        files={"file": ("pelanggan.csv", sheet.encode(), "text/csv")},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    assert r.json()["mapping"] == m

    r = await post(
        client,
        "/api/parties/import/commit",
        {"mapping": m, "rows": prev["rows"], "branch_id": o["branch"]["id"]},
    )
    assert r.status_code == 200, r.text
    assert (r.json()["created"], r.json()["updated"], r.json()["skipped"]) == (1, 1, 1)
    rows = {p["name"]: p for p in (await client.get("/api/parties")).json()["items"]}
    lama, baru = rows["Syarikat Lama"], rows["Kilang Baru Enterprise"]
    assert lama["email"] == "lama@example.com" and lama["primary_contact"]["name"] == "Encik Abu"
    assert baru["roles"] == ["customer", "supplier"] and baru["tin"] == "IG1234567890"
    assert baru["source"] == "import" and baru["address"]["postcode"] == "40000"
    # A mapping must name the name column.
    r = await post(
        client, "/api/parties/import/commit", {"mapping": {"Emel": "email"}, "rows": prev["rows"]}
    )
    assert r.status_code == 422


# ---------------------------------------------------------------- deals


async def test_deals_stage_moves_and_summary(client, llm, temporal):
    o = await office(client)
    p = await new_party(client, name="Prospek Jaya", roles=["lead"], branch_id=o["branch"]["id"])
    r = await post(
        client, "/api/deals", {"party_id": p["id"], "title": "CCTV for 3 sites", "value": 30000}
    )
    assert r.status_code == 201, r.text
    d = r.json()
    assert (d["stage"], d["probability"], d["branch_id"]) == ("lead", 10, o["branch"]["id"])
    d2 = (
        await post(
            client,
            "/api/deals",
            {"party_id": p["id"], "title": "Maintenance", "value": 5000, "stage": "proposal"},
        )
    ).json()
    r = await client.patch(
        f"/api/deals/{d['id']}",
        json={"stage": "negotiation", "position": 3.5},
        headers=csrf(client),
    )
    assert r.json()["stage"] == "negotiation" and r.json()["probability"] == 75
    assert r.json()["position"] == 3.5 and r.json()["closed_at"] is None
    r = await client.patch(
        f"/api/deals/{d2['id']}",
        json={"stage": "lost", "lost_reason": "Too pricey"},
        headers=csrf(client),
    )
    assert r.json()["closed_at"] is not None and r.json()["probability"] == 0
    s = (await client.get("/api/deals/summary")).json()
    assert s["negotiation"] == {"count": 1, "value": 30000.0, "weighted": 22500.0}
    assert s["stages"]["lost"]["count"] == 1 and s["open"]["value"] == 30000.0
    rows = (await client.get("/api/deals?stage=negotiation")).json()
    assert [x["id"] for x in rows["items"]] == [d["id"]] and rows["items"][0]["party_name"]
    assert (await client.get("/api/deals?open=true")).json()["total"] == 1
    tl = (await client.get(f"/api/parties/{p['id']}/timeline?kind=deal")).json()["items"]
    texts = [i["summary"] for i in tl]
    assert "Deal CCTV for 3 sites moved from lead to negotiation" in texts
    assert any("Too pricey" in t for t in texts) and tl[0]["titles"]["deal"]


# ---------------------------------------------------------------- money


async def test_money_lifecycle_payments_void_overdue_aging_forecast(client, llm, temporal):
    o = await office(client)
    a = o["branch"]["id"]
    _, ws_id = await user_id("owner@example.com")
    today = await ws_today(ws_id)
    supplier = await new_party(client, name="Bekal Sdn Bhd", roles=["supplier"], branch_id=a)
    customer = await new_party(client, name="Pelanggan Setia", branch_id=a)

    # A payable: draft -> approved -> partly paid -> paid. Totals follow the lines.
    bill = await new_money(
        client,
        supplier["id"],
        a,
        direction="payable",
        number="S-1",
        due_date=(today + timedelta(days=5)).isoformat(),
        status="draft",
    )
    assert (bill["subtotal"], bill["tax_total"], bill["total"]) == (1000.0, 80.0, 1080.0)
    assert bill["status"] == "draft" and bill["overdue"] is False
    r = await post(client, f"/api/money/{bill['id']}/payments", {"amount": 10})
    assert r.status_code == 409  # approve first
    r = await client.patch(
        f"/api/money/{bill['id']}",
        json={"lines": [{"description": "Cement", "qty": 4, "unit_price": 250, "tax_rate": 0}]},
        headers=csrf(client),
    )
    assert r.json()["total"] == 1000.0
    assert (await post(client, f"/api/money/{bill['id']}/approve")).json()["status"] == "approved"
    assert (await post(client, f"/api/money/{bill['id']}/approve")).status_code == 409
    r = await client.patch(f"/api/money/{bill['id']}", json={"notes": "x"}, headers=csrf(client))
    assert r.status_code == 409  # approved: no more edits
    r = await post(
        client,
        f"/api/money/{bill['id']}/payments",
        {"amount": 400, "method": "duitnow", "reference": "TRX1"},
    )
    assert r.status_code == 201 and r.json()["status"] == "partially_paid"
    assert r.json()["outstanding"] == 600.0 and len(r.json()["payments"]) == 1
    r = await post(client, f"/api/money/{bill['id']}/payments", {"amount": 600.01})
    assert r.status_code == 422 and r.json()["code"] == "overpaid"
    r = await post(client, f"/api/money/{bill['id']}/payments", {"amount": 600})
    assert r.json()["status"] == "paid" and r.json()["amount_paid"] == 1000.0
    assert (
        await post(client, f"/api/money/{bill['id']}/void", {"reason": "oops"})
    ).status_code == 409

    # Receivables: numbered, overdue computed, aging, forecast, summary.
    late = await new_money(
        client,
        customer["id"],
        a,
        issue_date=(today - timedelta(days=50)).isoformat(),
        due_date=(today - timedelta(days=40)).isoformat(),
    )
    soon = await new_money(
        client,
        customer["id"],
        a,
        lines=[],
        total=500,
        due_date=(today + timedelta(days=3)).isoformat(),
    )
    later = await new_money(
        client,
        customer["id"],
        a,
        total=200,
        due_date=(today + timedelta(days=20)).isoformat(),
        lines=[],
    )
    assert late["number"] == "INV-00001" and soon["number"] == "INV-00002"
    assert late["overdue"] is False  # a draft is not owed yet
    for m in (late, soon, later):
        assert (await post(client, f"/api/money/{m['id']}/approve")).status_code == 200
    late = (await client.get(f"/api/money/{late['id']}")).json()
    assert late["overdue"] is True and late["days_overdue"] == 40
    rows = (await client.get("/api/money?overdue=true")).json()
    assert [x["id"] for x in rows["items"]] == [late["id"]]
    assert rows["items"][0]["party_name"] == "Pelanggan Setia"
    assert (await client.get("/api/money?direction=receivable")).json()["total"] == 3

    aging = (await client.get("/api/money/aging?direction=receivable")).json()
    assert aging["d31_60"] == {"amount": 1080.0, "count": 1}
    assert aging["current"] == {"amount": 700.0, "count": 2}
    assert aging["buckets"]["d90_plus"]["count"] == 0 and aging["total"]["count"] == 3

    fc = (await client.get("/api/money/forecast?days=30")).json()
    assert len(fc["weeks"]) == 5 and fc["weeks"][0]["in"] == 500.0
    assert fc["overdue"]["in"] == 1080.0 and fc["total_in"] == 700.0
    assert fc["items"][0]["week_start"] == today.isoformat()

    s = (await client.get("/api/money/summary")).json()
    assert s["receivable_open"] == 1780.0 and s["receivable_overdue"] == 1080.0
    assert s["due_7d_in"] == 500.0 and s["payable_open"] == 0.0 and s["awaiting_approval"] == 0

    # Void with a reason; it leaves what is owed.
    r = await post(client, f"/api/money/{later['id']}/void", {"reason": "Cancelled order"})
    assert r.json()["status"] == "void" and "Cancelled order" in r.json()["notes"]
    assert (await client.get("/api/money/summary")).json()["receivable_open"] == 1580.0
    # Party balances follow.
    listed = (await client.get(f"/api/parties?q={customer['name']}")).json()["items"][0]
    assert (
        listed["balances"]["receivable_open"] == 1580.0 and listed["balances"]["overdue"] == 1080.0
    )
    tl = (await client.get(f"/api/parties/{supplier['id']}/timeline?kind=payment")).json()
    assert tl["total"] == 2 and tl["items"][0]["links"]["money_doc_id"] == bill["id"]


# ---------------------------------------------------------------- bill capture


async def test_mark_sent_finalises_a_draft_invoice_and_refuses_bills(client, llm, temporal):
    o = await office(client)
    a = o["branch"]["id"]
    customer = await new_party(client, name="Pelanggan Hantar", branch_id=a)
    inv = await new_money(client, customer["id"], a, status="draft")
    assert inv["status"] == "draft"
    r = await post(client, f"/api/money/{inv['id']}/sent")
    assert r.status_code == 200 and r.json()["status"] == "sent"
    assert (await get(MoneyDoc, inv["id"])).approved_by
    assert (await post(client, f"/api/money/{inv['id']}/sent")).status_code == 409  # once
    r = await post(client, f"/api/money/{inv['id']}/payments", {"amount": 100})
    assert r.status_code == 201 and r.json()["status"] == "partially_paid"
    supplier = await new_party(client, name="Pembekal Hantar", roles=["supplier"], branch_id=a)
    bill = await new_money(client, supplier["id"], a, direction="payable", status="draft")
    assert (await post(client, f"/api/money/{bill['id']}/sent")).status_code == 409


async def test_bill_from_an_invoice_mail_waits_for_approval_and_duplicates_are_flagged(
    client, llm, temporal, outlook, ai
):
    o = await office(client)
    owner_id, ws_id = await user_id("owner@example.com")
    clerk = await make_agent(o, ws_id, None, name="Accounts Clerk")
    mb = await shared_mailbox(ws_id, o["branch"]["id"], clerk.id)
    pdf = invoice_pdf()

    async def arrive(mid: str):
        outlook.add(
            mb.id,
            mid,
            subject="Invoice BJ-2026-077",
            sender="accounts@bekalanjaya.example.com",
            text="Please find our invoice attached.",
            attachments=[
                {
                    "id": f"att-{mid}",
                    "name": "BJ-2026-077.pdf",
                    "contentType": "application/pdf",
                    "size": len(pdf),
                    "isInline": False,
                    "_bytes": pdf,
                }
            ],
        )
        item = await mail_item(
            mb,
            mid,
            subject="Invoice BJ-2026-077",
            has_attachments=True,
            from_address="accounts@bekalanjaya.example.com",
        )
        assert await features.process(item.id) == "processed"
        return await get(MailItem, item.id)

    first = await arrive("m1")
    [cap] = [c for c in ai.calls if c["task"] == "money.capture"]
    assert cap["group"] == "fast" and cap["json_mode"] is True
    assert cap["branch_id"] == o["branch"]["id"]  # masked by the company's data level
    user = cap["messages"][1]["content"]
    assert "<<<" in user and "BJ-2026-077" in user[user.index("<<<") :]  # the PDF's text, fenced
    assert "DATA" in cap["messages"][0]["content"]

    async with SessionLocal() as db:
        docs = (await db.scalars(select(MoneyDoc).order_by(MoneyDoc.created_at))).all()
        [doc] = docs
        party = await db.get(Party, doc.party_id)
    assert (doc.direction, doc.status, doc.source) == ("payable", "awaiting_approval", "email")
    assert (svc.fl(doc.subtotal), svc.fl(doc.tax_total), svc.fl(doc.total)) == (1000, 60, 1060)
    assert doc.number == "BJ-2026-077" and doc.due_date.isoformat() == "2026-11-09"
    assert doc.mail_item_id == first.id and doc.file_id and doc.duplicate_of is None
    assert (party.name, party.tin, party.source, party.roles) == (
        "Bekalan Jaya Sdn Bhd",
        "C2584563200",
        "email",
        ["supplier"],
    )
    # ONE task: the review task replaces the plain invoice task.
    assert await count(Task) == 1
    task = await get(Task, doc.task_id)
    assert (
        task.title == "Review bill BJ-2026-077 from Bekalan Jaya Sdn Bhd RM 1,060.00 due 2026-11-09"
    )
    assert task.assignee_agent_id == clerk.id and task.branch_id == o["branch"]["id"]
    assert task.status == "triage" and task.labels == ["bill", "finance", "approval"]
    assert temporal["start"] == []  # nobody runs it: a person decides
    assert first.task_id == task.id
    assert [a["kind"] for a in first.actions] == ["attachment_saved", "bill"]
    assert first.actions[-1]["money_doc_id"] == doc.id

    # The same bill again: saved, but flagged as a possible duplicate.
    second = await arrive("m2")
    async with SessionLocal() as db:
        dup = await db.scalar(select(MoneyDoc).where(MoneyDoc.mail_item_id == second.id))
    assert dup.duplicate_of == doc.id and dup.party_id == doc.party_id
    dup_task = await get(Task, dup.task_id)
    assert "possible duplicate of BJ-2026-077" in dup_task.title and dup_task.priority == "high"
    assert "POSSIBLE DUPLICATE" in dup_task.brief
    assert await count(Party) == 1  # matched by TIN, not added twice

    # A person approves (finance.manage); the review task is done. Agents cannot.
    r = await post(client, f"/api/money/{doc.id}/approve")
    assert r.status_code == 200 and r.json()["task"]["status"] == "done"
    detail = (await client.get(f"/api/money/{dup.id}")).json()
    assert detail["duplicate"]["id"] == doc.id and detail["file"]["name"] == "BJ-2026-077.pdf"
    r = await post(client, f"/api/money/{dup.id}/void", {"reason": "Duplicate"})
    assert r.json()["task"]["status"] == "cancelled"

    # Capture from a Library file too.
    async with SessionLocal() as db:
        from agentic.documents import service as doc_service

        f = await doc_service.create_file(
            db,
            workspace_id=ws_id,
            name="other.pdf",
            data=invoice_pdf("BJ-2026-099"),
            created_by=f"user:{owner_id}",
            branch_id=o["branch"]["id"],
        )
        await db.commit()
        fid = f.id
    ai.bill = {
        **BILL,
        "invoice_number": "BJ-2026-099",
        "total": 500,
        "subtotal": 500,
        "tax_total": 0,
        "lines": [],
    }
    r = await post(client, "/api/money/capture", {"file_id": fid, "branch_id": o["branch"]["id"]})
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "awaiting_approval" and r.json()["source"] == "upload"
    assert r.json()["duplicate_of"] is None and r.json()["total"] == 500.0
    ai.bill = {"supplier_name": None}
    r = await post(client, "/api/money/capture", {"file_id": fid})
    assert r.status_code == 422 and r.json()["code"] == "capture_failed"


async def test_capture_off_by_rule_keeps_the_plain_invoice_task(client, llm, temporal, outlook, ai):
    o = await office(client)
    _, ws_id = await user_id("owner@example.com")
    clerk = await make_agent(o, ws_id, None, name="Accounts Clerk")
    mb = await shared_mailbox(ws_id, o["branch"]["id"], clerk.id, capture_bills=False)
    pdf = invoice_pdf()
    outlook.add(
        mb.id,
        "m1",
        subject="Invoice",
        attachments=[
            {
                "id": "a1",
                "name": "x.pdf",
                "contentType": "application/pdf",
                "size": len(pdf),
                "isInline": False,
                "_bytes": pdf,
            }
        ],
    )
    item = await mail_item(mb, "m1", subject="Invoice", has_attachments=True)
    assert await features.process(item.id) == "processed"
    assert await count(MoneyDoc) == 0
    row = await get(MailItem, item.id)
    assert (await get(Task, row.task_id)).title.startswith("Invoice:")


# ---------------------------------------------------------------- reminders


async def test_reminder_job_drafts_one_per_step_and_none_after_paid(client, llm, temporal, outlook):
    o = await two_companies(client)
    a, b = o["branch"]["id"], o["b2"]["id"]
    _, ws_id = await user_id("owner@example.com")
    today = await ws_today(ws_id)
    clerk = await make_agent(o, ws_id, None, name="Accounts Clerk")
    await shared_mailbox(ws_id, a, clerk.id)
    r = await client.put(
        f"/api/branches/{a}/reminders",
        json={"enabled": True, "days": [7, -3, 1, 1], "channel": "email"},
        headers=csrf(client),
    )
    assert r.status_code == 200 and r.json()["days"] == [-3, 1, 7]
    assert r.json()["mailbox"] == "accounts@maju.example.com"
    bad = await client.put(
        f"/api/branches/{a}/reminders", json={"enabled": True, "days": [400]}, headers=csrf(client)
    )
    assert bad.status_code == 422
    cust = await new_party(
        client,
        name="Pelanggan Lambat",
        branch_id=a,
        contact={"name": "Ahmad", "email": "ahmad@lambat.example.com"},
    )
    inv = await new_money(
        client,
        cust["id"],
        a,
        total=1000,
        lines=[],
        due_date=(today - timedelta(days=1)).isoformat(),
    )
    draft_only = await new_money(
        client, cust["id"], a, total=50, lines=[], due_date=(today - timedelta(days=1)).isoformat()
    )
    await post(client, f"/api/money/{inv['id']}/approve")
    # Another company with reminders on but no mailbox: a task with the text.
    await client.put(
        f"/api/branches/{b}/reminders", json={"enabled": True, "days": [1]}, headers=csrf(client)
    )
    cust_b = await new_party(client, name="Pelanggan B", branch_id=b, email="b@example.com")
    inv_b = await new_money(
        client,
        cust_b["id"],
        b,
        total=300,
        lines=[],
        due_date=(today - timedelta(days=2)).isoformat(),
    )
    await post(client, f"/api/money/{inv_b['id']}/approve")

    assert await reminders.run(today) == 2
    async with SessionLocal() as db:
        drafts = (await db.scalars(select(EmailDraft))).all()
    [d] = drafts
    assert d.to == "ahmad@lambat.example.com" and d.status == "pending" and d.user_id is None
    assert d.shared_mailbox_id is not None and "INV-00001" in d.subject
    assert "Dear Ahmad" in d.body and "RM 1,000.00" in d.body
    assert outlook.sent == []  # nothing sent: a person approves
    doc = await get(MoneyDoc, inv["id"])
    assert [x["step"] for x in doc.reminders] == ["1"] and doc.reminders[0][
        "channel"
    ] == "outlook_shared"
    task_b = (await get(MoneyDoc, inv_b["id"])).reminders[0]["task_id"]
    t = await get(Task, task_b)
    assert t.branch_id == b and "Pelanggan B" in t.title and "Dear Pelanggan B" in t.brief
    assert (await get(MoneyDoc, draft_only["id"])).reminders == []  # drafts are not owed

    assert await reminders.run(today) == 0  # once per step
    assert await reminders.run(today + timedelta(days=3)) == 0  # between steps
    assert await reminders.run(today + timedelta(days=6)) == 1  # the 7-day step
    assert [x["step"] for x in (await get(MoneyDoc, inv["id"])).reminders] == ["1", "7"]
    await post(client, f"/api/money/{inv['id']}/payments", {"amount": 1000})
    await client.put(
        f"/api/branches/{a}/reminders",
        json={"enabled": True, "days": [1, 7, 14]},
        headers=csrf(client),
    )
    assert await reminders.run(today + timedelta(days=20)) == 0  # paid: no more
    async with SessionLocal() as db:
        n = await db.scalar(select(func.count()).select_from(EmailDraft))
    assert n == 2
    tl = (await client.get(f"/api/parties/{cust['id']}/timeline?kind=invoice")).json()["items"]
    assert sum("Payment reminder" in i["summary"] for i in tl) == 2


async def test_remind_endpoint_without_a_mailbox_returns_the_text(client, llm, temporal):
    o = await office(client)
    _, ws_id = await user_id("owner@example.com")
    today = await ws_today(ws_id)
    cust = await new_party(
        client, name="Pelanggan Tunai", email="tunai@example.com", branch_id=o["branch"]["id"]
    )
    inv = await new_money(
        client,
        cust["id"],
        o["branch"]["id"],
        total=99,
        lines=[],
        due_date=(today + timedelta(days=3)).isoformat(),
    )
    assert (await post(client, f"/api/money/{inv['id']}/remind")).status_code == 409  # a draft
    await post(client, f"/api/money/{inv['id']}/approve")
    r = await post(client, f"/api/money/{inv['id']}/remind")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["channel"] == "text" and body["draft_id"] is None
    assert "is due on" in body["subject"] and "RM 99.00" in body["text"]
    assert body["money"]["reminders"][0]["step"] == "manual"
    # In Malay when the company writes Malay.
    async with SessionLocal() as db:
        from agentic.models import CompanyKit

        db.add(CompanyKit(branch_id=o["branch"]["id"], workspace_id=ws_id, data={"language": "ms"}))
        await db.commit()
    body = (await post(client, f"/api/money/{inv['id']}/remind")).json()
    assert body["subject"].startswith("Peringatan bayaran") and "Kepada" in body["body"]


# ---------------------------------------------------------------- email on the timeline


async def test_email_from_a_known_party_lands_on_its_timeline(client, llm, temporal, outlook, ai):
    o = await office(client)
    _, ws_id = await user_id("owner@example.com")
    clerk = await make_agent(o, ws_id, None, name="Accounts Clerk")
    mb = await shared_mailbox(ws_id, o["branch"]["id"], clerk.id, create_tasks_for=[])
    p = await new_party(
        client,
        name="Client Example",
        website="https://www.client.example.com",
        contact={"name": "Ahmad", "email": "ahmad@client.example.com"},
    )
    ai.category = "customer_request"
    outlook.add(mb.id, "e1", subject="Quote please")
    item = await mail_item(mb, "e1", subject="Quote please")
    await hooks.on_new_mail(await get(MailItem, item.id))
    tl = (await client.get(f"/api/parties/{p['id']}/timeline")).json()["items"]
    [e] = [i for i in tl if i["kind"] == "email_in"]
    assert e["summary"] == "Email to Accounts: Quote please"
    assert e["links"]["mail_item_id"] == item.id and e["actor"] == "system:mail"
    # Once only.
    assert await crm_mail.record(item.id) is None
    # Another person at the same company domain matches the party; gmail.com never does.
    other = await mail_item(mb, "e2", subject="Hello", from_address="boss@client.example.com")
    assert await crm_mail.record(other.id) is not None
    stranger = await mail_item(mb, "e3", subject="Hi", from_address="someone@gmail.com")
    assert await crm_mail.record(stranger.id) is None
    async with SessionLocal() as db:
        n = await db.scalar(
            select(func.count()).select_from(Interaction).where(Interaction.kind == "email_in")
        )
    assert n == 2


# ---------------------------------------------------------------- agent tools


async def _offered(agent_id: str) -> set[str]:
    async with SessionLocal() as db:
        a = await db.get(Agent, agent_id)
        tools = runtime.offered_tools(a, finance=await crm_access.money_ready(db, a))
    return {t["function"]["name"] for t in tools}


async def test_money_tools_only_for_finance_agents_and_no_decisions_as_tools(
    client, llm, temporal, ai
):
    o = await office(client)
    owner_id, ws_id = await user_id("owner@example.com")
    fin = await make_agent(o, ws_id, None, name="Finance Bot", department_id=o["depts"]["Finance"])
    ops = await make_agent(o, ws_id, None, name="Ops Bot", department_id=o["depts"]["Operations"])
    given = await make_agent(
        o, ws_id, None, name="Given Bot", department_id=o["depts"]["Operations"]
    )
    async with SessionLocal() as db:
        (await db.get(Agent, given.id)).tools = {"money_summary": "allow"}
        await db.commit()
    crm_names = {
        "find_party",
        "get_party",
        "create_party",
        "update_party",
        "add_party_note",
        "log_interaction",
        "list_deals",
        "create_deal",
        "update_deal",
    }
    assert crm_access.MONEY_TOOLS <= await _offered(fin.id)
    assert crm_names <= await _offered(ops.id)
    assert not (crm_access.MONEY_TOOLS & await _offered(ops.id))
    assert crm_access.MONEY_TOOLS & await _offered(given.id) == {"money_summary"}
    d = await policy.evaluate(await get(Agent, ops.id), "list_money", {})
    assert (d.effect, d.rule) == ("deny", "hidden.list_money")
    assert (await policy.evaluate(await get(Agent, fin.id), "list_money", {})).effect == "allow"
    assert (
        await policy.evaluate(await get(Agent, given.id), "money_summary", {})
    ).effect == "allow"
    assert (
        await policy.evaluate(await get(Agent, fin.id), "create_invoice_draft", {})
    ).effect == "ask"
    assert (await policy.evaluate(await get(Agent, ops.id), "create_party", {})).effect == "ask"
    # Approving, paying and voiding are never tools.
    for name in TOOLS:
        assert not any(
            w in name for w in ("approve", "payment_record", "record_payment", "void")
        ), name

    # The CRM tools work on the agent's company.
    out = await run_tool(
        ops.id,
        "create_party",
        {
            "name": "Syarikat Agen",
            "email": "a@agen.example.com",
            "tin": "C1111111111",
            "contact_name": "Rina",
        },
    )
    assert "Added Syarikat Agen" in out
    pid = out.split(" as ")[1].split(" ")[0]
    assert "already here" in await run_tool(ops.id, "create_party", {"name": "SYARIKAT AGEN"})
    assert "Syarikat Agen" in await run_tool(ops.id, "find_party", {"query": "rina"})
    assert "Note added" in await run_tool(
        ops.id, "add_party_note", {"party_id": pid, "text": "Met at expo"}
    )
    out = await run_tool(
        ops.id, "create_deal", {"party_id": pid, "title": "Expo lead", "value": 1200}
    )
    did = out.split("Deal ")[1].split(" ")[0]
    assert "negotiation" in await run_tool(
        ops.id, "update_deal", {"deal_id": did, "stage": "negotiation"}
    )
    assert "Expo lead" in await run_tool(ops.id, "list_deals", {"stage": "open"})
    got = await run_tool(ops.id, "get_party", {"party_id": pid})
    assert "Rina" in got and "Expo lead" in got and "Money" not in got
    assert "Money (your company)" in await run_tool(fin.id, "get_party", {"party_id": pid})

    # The money tools prepare, never decide.
    out = await run_tool(
        fin.id,
        "create_invoice_draft",
        {
            "party_id": pid,
            "lines": [{"description": "Booth", "qty": 1, "unit_price": 1000, "tax_rate": 8}],
        },
    )
    assert "DRAFT" in out and "RM 1,080.00" in out
    async with SessionLocal() as db:
        inv = await db.scalar(select(MoneyDoc).where(MoneyDoc.party_id == pid))
    assert inv.status == "draft" and inv.created_by == f"agent:{fin.id}"
    assert "INV-00001" in await run_tool(fin.id, "list_money", {"direction": "receivable"})
    assert "Customers owe us 0.00" in await run_tool(fin.id, "money_summary", {})
    assert "not yet due" in await run_tool(fin.id, "aging_report", {})
    assert "over 30 days" in await run_tool(fin.id, "cashflow_forecast", {"days": 30})
    assert "approved invoices" in await run_tool(
        fin.id, "draft_payment_reminder", {"money_doc_id": inv.id}
    )
    await post(client, f"/api/money/{inv.id}/approve")
    out = await run_tool(fin.id, "draft_payment_reminder", {"money_doc_id": inv.id})
    assert "No company mailbox" in out and "Payment reminder" in out
    assert (await get(MoneyDoc, inv.id)).status == "approved"  # drafts only

    async with SessionLocal() as db:
        from agentic.documents import service as doc_service

        f = await doc_service.create_file(
            db,
            workspace_id=ws_id,
            name="bill.pdf",
            data=invoice_pdf(),
            created_by=f"user:{owner_id}",
            branch_id=o["branch"]["id"],
        )
        await db.commit()
        fid = f.id
    out = await run_tool(fin.id, "capture_bill", {"file_id": fid})
    assert "awaiting approval by a person" in out and "cannot approve" in out
    async with SessionLocal() as db:
        bill = await db.scalar(select(MoneyDoc).where(MoneyDoc.direction == "payable"))
        t = await db.get(Task, bill.task_id)
    assert bill.status == "awaiting_approval" and t.assignee_agent_id == fin.id
    assert t.status == "triage"


# ---------------------------------------------------------------- privacy


SENT: list[dict] = []


def _capture(request: httpx.Request) -> httpx.Response:
    body = json.loads(request.content)
    SENT.append(body)
    return httpx.Response(
        200,
        json={
            "model": body["model"],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5},
            "choices": [{"finish_reason": "stop", "message": {"content": "Noted."}}],
        },
    )


async def test_party_and_contact_names_never_reach_a_cloud_provider(client, llm, temporal):
    await office(client)
    _, ws_id = await user_id("owner@example.com")
    SENT.clear()
    engine_client.use_transport(httpx.MockTransport(_capture))
    try:
        text = (
            "Call Wong Mei Ling at Kilang Besi Sentosa about the order, then email "
            "meiling@sentosa.example.com or ring 03-7781 2299. Their TIN is IG98765432100."
        )

        async def ask() -> str:
            async with SessionLocal() as db:
                await gateway.chat(
                    db, ws_id, "smart", [{"role": "user", "content": text}], task="test"
                )
            return json.dumps(SENT[-1], ensure_ascii=False)

        before = await ask()  # builds (and caches) the dictionary without the party
        assert "Kilang Besi Sentosa" in before
        p = await new_party(
            client,
            name="Kilang Besi Sentosa",
            tin="IG98765432100",
            phone="03-7781 2299",
            contact={"name": "Wong Mei Ling", "email": "meiling@sentosa.example.com"},
        )
        sent = await ask()  # the change dropped the cached dictionary at once
        for real in (
            "Kilang Besi Sentosa",
            "Wong Mei Ling",
            "meiling@sentosa.example.com",
            "IG98765432100",
            "7781 2299",
        ):
            assert real not in sent, real
        assert "[COMPANY_" in sent and "[PERSON_" in sent
        async with SessionLocal() as db:
            literals, firsts = await privacy.known_values(db, ws_id)
        assert ("COMPANY", "Kilang Besi Sentosa") in literals
        assert ("PERSON", "Wong Mei Ling") in literals and "Wong" in firsts
        assert ("EMAIL", "meiling@sentosa.example.com") in literals
        assert ("REF", "IG98765432100") in literals and ("PHONE", "03-7781 2299") in literals
        # A person party is a PERSON.
        await new_party(client, name="Rajesh Kumar", kind="person")
        async with SessionLocal() as db:
            literals, _ = await privacy.known_values(db, ws_id)
        assert ("PERSON", "Rajesh Kumar") in literals
        assert p["id"]
    finally:
        engine_client.use_transport(None)
        privacy.invalidate()
