"""P13 vision: view_image describes an image, or falls back to its OCR text when no vision
model is available; non-images and out-of-scope files are refused."""

from agentic.agents.tools import ToolContext  # noqa: I001 - import tools before doc_tools (cycle)
from agentic.agents import doc_tools, vision
from agentic.core.db import SessionLocal
from agentic.documents import service
from agentic.models import Agent, Workspace

from .test_agents import llm, new_agent, office, temporal  # noqa: F401

PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082"
)


async def _ctx(db, agent_id):
    a = await db.get(Agent, agent_id)
    ws = await db.get(Workspace, a.workspace_id)
    return ToolContext(db=db, agent=a, workspace=ws, task=None), a


async def _image(db, ws_id, branch_id, text=""):
    f = await service.create_file(
        db,
        workspace_id=ws_id,
        name="photo.png",
        data=PNG,
        created_by="user:x",
        mime="image/png",
        branch_id=branch_id,
        status="ready",
    )
    f.text = text
    await db.commit()
    return f.id


async def test_view_image_describes_with_the_model(client, llm, temporal, monkeypatch):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")

    async def fake(db, a, data, mime, question, *, task_id=None):
        assert data == PNG and mime == "image/png"
        return "A registration certificate for Qbot Studio Sdn Bhd."

    monkeypatch.setattr(vision, "describe", fake)
    async with SessionLocal() as db:
        ctx, a = await _ctx(db, agent["id"])
        fid = await _image(db, a.workspace_id, a.branch_id)
        out = await doc_tools._view_image(ctx, {"file_id": fid, "question": "what is this?"})
    assert "registration certificate" in out and "photo.png" in out


async def test_view_image_falls_back_to_ocr_text(client, llm, temporal, monkeypatch):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    monkeypatch.setattr(vision, "describe", lambda *a, **k: _none())
    async with SessionLocal() as db:
        ctx, a = await _ctx(db, agent["id"])
        fid = await _image(db, a.workspace_id, a.branch_id, text="SSM CERTIFICATE No 12345")
        out = await doc_tools._view_image(ctx, {"file_id": fid})
    assert "OCR" in out and "SSM CERTIFICATE No 12345" in out


async def test_view_image_refuses_non_images(client, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    async with SessionLocal() as db:
        ctx, a = await _ctx(db, agent["id"])
        f = await service.create_file(
            db,
            workspace_id=a.workspace_id,
            name="notes.txt",
            data=b"hi",
            created_by="user:x",
            mime="text/plain",
            branch_id=a.branch_id,
            status="ready",
        )
        await db.commit()
        out = await doc_tools._view_image(ctx, {"file_id": f.id})
    assert "not an image" in out


def test_data_url_encodes():
    url = vision.data_url(PNG, "image/png")
    assert url.startswith("data:image/png;base64,")


async def _none():
    return None
