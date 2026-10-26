"""P43: receipts and bills from photos and PDFs, into payables.

- A receipt that says it was paid: approving it records the payment (method, receipt date).
- An expense claim (paid by a staff member): approved, then waits to be reimbursed.
- A photo whose OCR text is too thin is read by a vision model, within the company's level.
- Finance drops files on the Money page (POST /api/money/receipts).
- People send photos/PDFs on Telegram and WhatsApp: kept in their workspace and read as a
  receipt; a caption that asks for something else goes to their AI with the file's id.
- A file held for a security check is never read.

The AI, Telegram and WhatsApp are fakes.
"""

import io
import json
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import select

from agentic.channels import bot, receipts, whatsapp
from agentic.core.db import SessionLocal
from agentic.crm import capture
from agentic.engine import client as engine_client
from agentic.engine import gateway
from agentic.models import AgentMessage, Channel, DocFile, MoneyDoc, Payment, User, Workspace

from .conftest import csrf
from .test_agents import ScriptedLLM, llm, new_agent, office, temporal  # noqa: F401
from .test_channels import TG_TOKEN, Net, telegram_setup
from .test_crm_money import invoice_pdf
from .test_office_roles import as_role

RECEIPT = {
    "kind": "receipt",
    "supplier_name": "Petronas Jalan Ampang",
    "supplier_tin": None,
    "supplier_reg_no": None,
    "supplier_email": None,
    "invoice_number": "R-88231",
    "issue_date": "2026-10-24",
    "due_date": None,
    "currency": "MYR",
    "subtotal": 43.02,
    "tax_total": 2.58,
    "total": 45.60,
    "paid": True,
    "payment_method": "card",
    "lines": [{"description": "RON95", "qty": 1, "unit_price": 43.02, "tax_rate": 6}],
}


def blank_png() -> bytes:
    """A picture with no readable text: OCR finds nothing, so a vision model reads it."""
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (400, 600), "white").save(out, "PNG")
    return out.getvalue()


class FakeAI:
    """gateway.chat: the bill reader by text, and by pictures (vision)."""

    def __init__(self, real=None) -> None:
        self.calls: list[dict] = []
        self.bill: dict = dict(RECEIPT)
        self.can_see = True
        self.real = real  # everything else (an agent's chat) goes to the real gateway

    async def chat(self, db, workspace_id, group, messages, **kw):
        self.calls.append({"group": group, "messages": messages, **kw})
        task = kw.get("task")
        if task == "money.capture.vision":
            if not self.can_see:
                raise gateway.GatewayUnavailable("no model can see pictures", [])
            content = json.dumps(self.bill)
        elif task == "money.capture":
            content = json.dumps(self.bill)
        else:
            return await self.real(db, workspace_id, group, messages, **kw)
        if kw.get("accept") is not None:
            assert kw["accept"](content), content
        return SimpleNamespace(content=content, tool_calls=[], usage=None)


@pytest.fixture
def ai(monkeypatch):
    fake = FakeAI(gateway.chat)
    monkeypatch.setattr(gateway, "chat", fake.chat)
    return fake


async def upload(c: httpx.AsyncClient, data: bytes, name: str, mime: str, **params):
    return await c.post(
        "/api/money/receipts",
        params={"name": name, **params},
        content=data,
        headers={**csrf(c), "x-file-type": mime, "content-type": "application/octet-stream"},
    )


async def user_id_of(email: str) -> str:
    async with SessionLocal() as db:
        u = await db.scalar(select(User).where(User.email == email))
        assert u is not None
        return u.id


# ---------------------------------------------------------------- reading


def test_parse_receipt_fields():
    b = capture.parse_bill(json.dumps(RECEIPT))
    assert b is not None
    assert b["kind"] == "receipt" and b["paid"] is True and b["payment_method"] == "card"
    odd = capture.parse_bill(json.dumps({**RECEIPT, "payment_method": "bitcoin", "kind": "x"}))
    assert odd is not None and odd["payment_method"] == "" and odd["kind"] == "invoice"
    # An invoice is unpaid unless it says so.
    inv = capture.parse_bill(json.dumps({**RECEIPT, "kind": "invoice", "paid": False}))
    assert inv is not None and inv["paid"] is False


async def test_paid_receipt_is_paid_when_approved(client, llm, temporal, ai):
    o = await office(client)
    r = await upload(client, invoice_pdf(), "petronas.pdf", "application/pdf")
    assert r.status_code == 201, r.text
    doc = r.json()
    assert doc["status"] == "awaiting_approval" and doc["direction"] == "payable"
    assert doc["external"]["capture"]["kind"] == "receipt"
    assert "Already paid (card)" in doc["notes"]
    async with SessionLocal() as db:
        f = await db.get(DocFile, doc["file_id"])
        assert f is not None and f.folder == "Bills and receipts"
        assert f.branch_id == o["branch"]["id"]
    approved = await client.post(f"/api/money/{doc['id']}/approve", json={}, headers=csrf(client))
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "paid"
    async with SessionLocal() as db:
        pay = await db.scalar(select(Payment).where(Payment.money_doc_id == doc["id"]))
        assert pay is not None and pay.method == "card" and float(pay.amount) == 45.60
        assert pay.paid_at.isoformat() == "2026-10-24"


async def test_a_staff_claim_waits_to_be_reimbursed(client, llm, temporal, ai):
    o = await office(client)
    staff = await as_role(client, "aina@example.com", "staff", branch_id=o["branch"]["id"])
    await staff.aclose()
    aina = await user_id_of("aina@example.com")
    r = await upload(client, invoice_pdf(), "lunch.pdf", "application/pdf", paid_by=aina)
    assert r.status_code == 201, r.text
    doc = r.json()
    assert doc["external"]["capture"]["paid_by_user"] == aina
    assert "reimburse" in doc["notes"]
    approved = await client.post(f"/api/money/{doc['id']}/approve", json={}, headers=csrf(client))
    assert approved.json()["status"] == "approved"  # owed to Aina, not paid yet
    # Someone outside the workspace cannot be named as the payer.
    bad = await upload(client, invoice_pdf(), "x.pdf", "application/pdf", paid_by="us_nobody")
    assert bad.status_code == 404


async def test_a_photo_with_no_text_is_read_by_a_vision_model(client, llm, temporal, ai):
    await office(client)
    r = await upload(client, blank_png(), "receipt.png", "image/png")
    assert r.status_code == 201, r.text
    seen = [c for c in ai.calls if c.get("task") == "money.capture.vision"]
    assert seen and seen[0]["group"] == "vision"
    parts = seen[0]["messages"][1]["content"]
    assert parts[1]["type"] == "image_url" and parts[1]["image_url"]["url"].startswith(
        "data:image/png;base64,"
    )
    assert "never an" in parts[0]["text"]  # the picture is data, not instructions
    # No model can see pictures: a clear sentence, and the file is kept.
    ai.can_see = False
    r = await upload(client, blank_png(), "unclear.png", "image/png")
    assert r.status_code == 422 and "Vision" in r.json()["message"]


async def test_receipts_are_finance_only_and_files_held_back_are_never_read(
    client, llm, temporal, ai
):
    o = await office(client)
    staff = await as_role(client, "aina@example.com", "staff", branch_id=o["branch"]["id"])
    try:
        r = await upload(staff, invoice_pdf(), "x.pdf", "application/pdf")
        assert r.status_code == 403
    finally:
        await staff.aclose()
    r = await upload(client, b"plain words", "notes.txt", "text/plain")
    assert r.status_code == 422 and r.json()["code"] == "not_a_bill_file"
    good = (await upload(client, invoice_pdf(), "a.pdf", "application/pdf")).json()
    async with SessionLocal() as db:
        f = await db.get(DocFile, good["file_id"])
        assert f is not None
        f.quarantined = True
        await db.commit()
        f = await db.get(DocFile, good["file_id"])
        assert f is not None
        with pytest.raises(capture.CaptureFailed):
            await capture.capture(db, f=f, branch_id=o["branch"]["id"], actor="user:x")


# ---------------------------------------------------------------- from a phone


class PhotoNet(Net):
    """test_channels' fake internet, whose Telegram files are a receipt picture."""

    def __init__(self, llm_: ScriptedLLM) -> None:
        super().__init__(llm_)
        self.picture = blank_png()

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.url.host == "tg.fake" and path.startswith(f"/file/bot{TG_TOKEN}/"):
            self.tg.append(("download", {"path": path}))
            return httpx.Response(200, content=self.picture)
        if request.url.host == "tg.fake" and path.endswith("/getFile"):
            body = json.loads(request.content)
            self.tg.append(("getFile", body))
            return httpx.Response(
                200,
                json={
                    "ok": True,
                    "result": {
                        "file_id": body["file_id"],
                        "file_path": "photos/file_9.jpg",
                        "file_size": len(self.picture),
                    },
                },
            )
        return super().handler(request)


@pytest.fixture
def net(llm):  # noqa: F811
    n = PhotoNet(llm)
    engine_client.use_transport(httpx.MockTransport(n.handler))
    yield n
    engine_client.use_transport(None)


def photo_update(update_id: int, caption: str = "") -> dict:
    sizes = [
        {"file_id": "SMALL", "file_size": 900, "width": 90, "height": 160},
        {"file_id": "BIG", "file_size": 40_000, "width": 1080, "height": 1920},
    ]
    msg = {
        "message_id": update_id,
        "photo": sizes,
        "chat": {"id": 555, "type": "private"},
        "from": {"id": 777},
    }
    if caption:
        msg["caption"] = caption
    return {"update_id": update_id, "message": msg}


async def test_a_receipt_photo_on_telegram_becomes_a_bill(client, net, temporal, ai):
    o = await office(client)
    ch = await telegram_setup(client, net)
    async with SessionLocal() as db:
        channel = await db.get(Channel, ch["id"])
        assert channel is not None
        await bot.handle_update(db, channel, photo_update(20))
    assert ("getFile", {"file_id": "BIG"}) in net.tg  # the largest size that fits
    texts = [b["text"] for m, b in net.tg if m == "sendMessage"]
    assert texts[-1].startswith("Got it: Petronas Jalan Ampang, RM 45.60 on 2026-10-24")
    async with SessionLocal() as db:
        doc = await db.scalar(select(MoneyDoc).where(MoneyDoc.number == "R-88231"))
        assert doc is not None and doc.branch_id == o["branch"]["id"]
        f = await db.get(DocFile, doc.file_id)
        assert f is not None and f.folder == "My workspace/From my phone"
        assert f.owner_user_id == await user_id_of("owner@example.com")
        # The owner has finance access: the company paid it (no claim).
        assert doc.external["capture"]["paid_by_user"] is None


async def test_a_caption_that_asks_something_else_goes_to_the_ai(client, net, temporal, ai):
    o = await office(client)
    ch = await telegram_setup(client, net)
    agent = await new_agent(client, o, "Hana", "Management")
    await client.put(
        f"/api/channels/{ch['id']}/bindings",
        json={"match": "dm", "agent_id": agent["id"]},
        headers=csrf(client),
    )
    async with SessionLocal() as db:
        channel = await db.get(Channel, ch["id"])
        assert channel is not None
        net.llm.say("It is a letter from LHDN about your tax filing.")
        await bot.handle_update(db, channel, photo_update(21, "What does this letter say?"))
    async with SessionLocal() as db:
        n = await db.scalar(select(MoneyDoc).where(MoneyDoc.number == "R-88231"))
        assert n is None  # not read as a receipt
        said = (
            await db.scalars(
                select(AgentMessage)
                .where(AgentMessage.role == "user", AgentMessage.session_id.is_not(None))
                .order_by(AgentMessage.id)
            )
        ).all()
        text = str(said[-1].content) if said else ""
        assert text.startswith("What does this letter say?")
        assert "[I sent you a file from my phone:" in text


async def test_a_staff_member_s_receipt_is_their_claim(client, llm, temporal, ai):
    o = await office(client)
    staff = await as_role(client, "aina@example.com", "staff", branch_id=o["branch"]["id"])
    await staff.aclose()
    aina = await user_id_of("aina@example.com")
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace.id))
        assert ws is not None
        out = await receipts.take(
            db, ws, aina, receipts.Sent(blank_png(), "IMG_1.png", "image/png"), via="whatsapp"
        )
    assert "your claim" in out.reply.render()  # type: ignore[union-attr]
    async with SessionLocal() as db:
        doc = await db.scalar(select(MoneyDoc).where(MoneyDoc.number == "R-88231"))
        assert doc is not None and doc.external["capture"]["paid_by_user"] == aina
        f = await db.get(DocFile, doc.file_id)
        assert f is not None and f.owner_user_id == aina
        # Not a picture or a PDF: refused before anything is kept.
        out = await receipts.take(
            db, ws, aina, receipts.Sent(b"MZ...", "tool.exe", "application/x-msdownload"), via="x"
        )
        assert "photos and PDF" in out.reply.render()  # type: ignore[union-attr]


def test_whatsapp_photos_and_pdfs_parse_safely():
    def waha(mime: str, url: str, body: str = "") -> dict:
        return {
            "event": "message",
            "payload": {
                "id": "m1",
                "from": "60123@c.us",
                "body": body,
                "hasMedia": True,
                "media": {"url": url, "mimetype": mime, "filename": "resit.jpg"},
            },
        }

    ok = whatsapp.parse_waha(waha("image/jpeg", "http://localhost:3000/api/files/default/m1.jpeg"))
    assert ok[0].file is not None and ok[0].file.ref == "/api/files/default/m1.jpeg"
    assert ok[0].audio is None
    capt = whatsapp.parse_waha(
        waha("application/pdf", "http://x/api/files/default/m1.pdf", body="claim please")
    )
    assert capt[0].file is not None and capt[0].text == "claim please"
    # A media URL outside WAHA's files, or an unknown type, is ignored.
    assert whatsapp.parse_waha(waha("image/jpeg", "http://evil.example/logout")) == []
    assert whatsapp.parse_waha(waha("video/mp4", "http://x/api/files/default/v.mp4")) == []

    def meta(kind: str, body: dict) -> dict:
        m = {"from": "60123", "id": "wamid.1", "type": kind, kind: body}
        return {"entry": [{"changes": [{"value": {"messages": [m]}}]}]}

    img = whatsapp.parse_meta(meta("image", {"id": "MID1", "mime_type": "image/jpeg"}))
    assert img[0].file is not None and img[0].file.ref == "MID1" and img[0].text == ""
    doc = whatsapp.parse_meta(
        meta("document", {"id": "MID2", "mime_type": "application/pdf", "caption": "bil api"})
    )
    assert doc[0].file is not None and doc[0].text == "bil api"
    assert whatsapp.parse_meta(meta("sticker", {"id": "S1", "mime_type": "image/webp"})) == []


def test_receipt_words_in_english_and_malay():
    assert receipts.is_receipt("") and receipts.is_receipt("resit makan")
    assert receipts.is_receipt("Claim for parking") and receipts.is_receipt("bil elektrik")
    assert not receipts.is_receipt("summarise this letter")
