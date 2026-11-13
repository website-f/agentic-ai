"""P43: photos and PDFs people send on Telegram and WhatsApp.

- The file is always kept in the sender's own workspace ("My workspace/From my phone").
- No caption, or one that only says what it is ("receipt", "resit"...): they are told where it
  is (P102: it is no longer read into Money, which was removed).
- A caption that asks for something else goes to their AI with the file's id.

The AI, Telegram and WhatsApp are fakes.
"""

import io
import json

import httpx
import pytest
from sqlalchemy import select

from agentic.channels import bot, receipts, whatsapp
from agentic.core.db import SessionLocal
from agentic.engine import client as engine_client
from agentic.models import AgentMessage, Channel, DocFile, User, Workspace

from .conftest import csrf
from .test_agents import ScriptedLLM, llm, new_agent, office, temporal  # noqa: F401
from .test_channels import TG_TOKEN, Net, telegram_setup
from .test_office_roles import as_role


def blank_png() -> bytes:
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (400, 600), "white").save(out, "PNG")
    return out.getvalue()


async def user_id_of(email: str) -> str:
    async with SessionLocal() as db:
        u = await db.scalar(select(User).where(User.email == email))
        assert u is not None
        return u.id


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


async def test_a_receipt_photo_on_telegram_is_kept(client, net, temporal):
    o = await office(client)
    ch = await telegram_setup(client, net)
    async with SessionLocal() as db:
        channel = await db.get(Channel, ch["id"])
        assert channel is not None
        await bot.handle_update(db, channel, photo_update(20))
    assert ("getFile", {"file_id": "BIG"}) in net.tg  # the largest size that fits
    texts = [b["text"] for m, b in net.tg if m == "sendMessage"]
    assert texts[-1].startswith("Saved ") and "My workspace/From my phone" in texts[-1]
    async with SessionLocal() as db:
        f = await db.scalar(select(DocFile).where(DocFile.folder == "My workspace/From my phone"))
        assert f is not None and f.branch_id == o["branch"]["id"]
        assert f.owner_user_id == await user_id_of("owner@example.com")


async def test_a_caption_that_asks_something_else_goes_to_the_ai(client, net, temporal):
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


async def test_a_staff_member_s_receipt_is_kept_in_their_own_workspace(client, llm, temporal):
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
    assert out.chat is None and out.file_id
    assert out.reply.render().startswith("Saved IMG_1.png in your workspace")  # type: ignore[union-attr]
    async with SessionLocal() as db:
        f = await db.get(DocFile, out.file_id)
        assert f is not None and f.owner_user_id == aina and f.source_path == "whatsapp"
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
