"""Meeting minutes from a recording: chunk planning, transcript stitching, the minutes JSON,
the upload -> prepare -> transcribe -> write pipeline (ffmpeg and the speech/LLM providers
are fakes), rate-limit waits, action items -> tasks, who sees and changes what, the purge,
and the agent tool."""

import json
import os
import re
import time
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import func, select, text

from agentic.agents.tools import TOOLS, ToolContext
from agentic.core.config import settings
from agentic.core.db import SessionLocal
from agentic.documents import service as doc_service
from agentic.engine import client as engine_client
from agentic.minutes import audio, service, transcript, writer
from agentic.models import (
    Agent,
    DocFile,
    Document,
    KnowledgeChunk,
    MeetingRecording,
    Task,
    Workspace,
)

from .conftest import csrf
from .test_agents import ScriptedLLM, llm, new_agent, office, temporal  # noqa: F401
from .test_office_roles import as_role

MINUTES = {
    "title": "Q4 budget review",
    "date": "5 October 2026",
    "attendees": ["Aisyah", "Encik Rahman"],
    "agenda": ["Q4 budget", "Supplier quotation"],
    "summary": "The team reviewed the Q4 budget of RM 12,500 and agreed to get a new quotation.",
    "topics": [
        {"title": "Q4 budget", "start": "0:00", "summary": "Budget is RM 12,500."},
        {"title": "Supplier", "start": "[6:45]", "summary": "Need a second quotation."},
        "Next steps",
    ],
    "decisions": ["Budget capped at RM 12,500"],
    "action_items": [
        {"what": "Send the supplier quotation", "owner": "Aisyah", "due": "Friday"},
        {"what": "Book the | meeting room", "owner": "", "due": ""},
        "Update the {{budget}} sheet",
    ],
    "open_questions": ["Is the RM 12,500 inclusive of SST?"],
    "next_meeting": "12 October, 10am",
}


def _field(body: bytes, name: str) -> str:
    m = re.search(rb'name="' + name.encode() + rb'"\r\n\r\n([^\r]*)', body)
    return m.group(1).decode() if m else ""


class Net:
    """Speech-to-text on the fake hosts (verbose_json with segments) plus the scripted LLM."""

    def __init__(self, llm_: ScriptedLLM) -> None:
        self.llm = llm_
        self.heard: list[dict] = []
        self.chunks: list[list[dict]] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/audio/transcriptions"):
            body = request.content
            self.heard.append(
                {
                    "host": request.url.host,
                    "prompt": _field(body, "prompt"),
                    "format": _field(body, "response_format"),
                    "filename": (re.search(rb'filename="([^"]+)"', body) or [b"", b""])[1],
                }
            )
            if request.url.host == "ratelimit.fake":
                return httpx.Response(
                    429,
                    headers={"retry-after": "120"},
                    json={"error": {"message": "Rate limit reached: audio seconds per hour"}},
                )
            segs = self.chunks.pop(0) if self.chunks else [{"start": 0, "end": 5, "text": "Ok."}]
            return httpx.Response(
                200,
                json={
                    "text": " ".join(s["text"] for s in segs),
                    "duration": 400.0,
                    "language": "malay",
                    "segments": segs,
                },
            )
        return self.llm.handler(request)


@pytest.fixture
def net(llm):  # noqa: F811
    n = Net(llm)
    engine_client.use_transport(httpx.MockTransport(n.handler))
    yield n
    engine_client.use_transport(None)


@pytest.fixture
def ff(monkeypatch, tmp_path):
    """ffmpeg/ffprobe stand-ins and a throwaway media folder."""
    monkeypatch.setattr(settings, "media_dir", str(tmp_path / "media"))
    state: dict = {"seconds": 1200.0, "has_audio": True, "cuts": [], "extracts": 0}

    async def probe(path, beat=None):
        return audio.Probe(seconds=state["seconds"], has_audio=state["has_audio"])

    async def extract(src, dst, seconds, beat=None):
        dst.write_bytes(b"ID3" + b"\x00" * 64)
        state["extracts"] += 1

    async def cut(src, dst, start, length, beat=None):
        state["cuts"].append((round(start, 1), round(length, 1)))
        return b"ID3chunk"

    monkeypatch.setattr(audio, "probe", probe)
    monkeypatch.setattr(audio, "extract", extract)
    monkeypatch.setattr(audio, "cut", cut)
    return state


@pytest.fixture
def started(monkeypatch):
    calls: list[str] = []

    async def start(rec):
        calls.append(rec.id)
        return f"minutes-{rec.id}-{rec.runs}"

    monkeypatch.setattr(service, "start", start)
    return calls


@pytest.fixture(autouse=True)
async def wipe_chunks():
    async with SessionLocal() as db:
        await db.execute(text("TRUNCATE knowledge_chunks RESTART IDENTITY"))
        await db.commit()


async def speech(c: httpx.AsyncClient, o: dict, host: str = "good.fake") -> None:
    provider = o["provider"]
    if host != "good.fake":
        provider = (
            await c.post(
                "/api/ai/providers",
                json={
                    "name": "Busy",
                    "base_url": f"https://{host}/v1",
                    "api_key": "busy-key-123",
                    "tier": "free",
                },
                headers=csrf(c),
            )
        ).json()
    r = await c.put(
        "/api/ai/groups/transcribe",
        json={"members": [{"provider_id": provider["id"], "model_id": "whisper-large-v3-turbo"}]},
        headers=csrf(c),
    )
    assert r.status_code == 200, r.text


async def upload(
    c: httpx.AsyncClient, name: str = "board meeting.m4a", mime: str = "audio/mp4", **params
) -> httpx.Response:
    q = {"name": name, **params}
    return await c.post(
        "/api/minutes/upload",
        params=q,
        content=b"\x00\x00\x00\x20ftypM4A " + b"\x00" * 4096,
        headers={**csrf(c), "content-type": "application/octet-stream", "x-file-type": mime},
    )


async def run_pipeline(rec_id: str) -> dict:
    async with SessionLocal() as db:
        info = await service.prepare(db, rec_id)
    assert "failed" not in info, info
    for i in range(info["chunks"]):
        async with SessionLocal() as db:
            assert await service.transcribe_chunk(db, rec_id, i) == {"done": True}
    async with SessionLocal() as db:
        return await service.write(db, rec_id)


async def load(rec_id: str) -> MeetingRecording:
    async with SessionLocal() as db:
        rec = await db.get(MeetingRecording, rec_id)
        assert rec is not None
        return rec


THREE_CHUNKS = [
    [
        {"start": 0, "end": 8, "text": "Selamat pagi semua, kita mulakan mesyuarat."},
        {"start": 390, "end": 399.5, "text": "Budget is RM 12,500."},
    ],
    [
        {"start": 0, "end": 1.0, "text": "RM 12,500."},  # the overlap: heard twice
        {"start": 5, "end": 20, "text": "Aisyah will send the quotation by Friday."},
        {"start": 20, "end": 22, "text": "Terima kasih."},
        {"start": 22, "end": 24, "text": "Terima kasih."},  # a repeat over silence
    ],
    [{"start": 10, "end": 30, "text": "Next meeting 12 October."}],
]


# ---------------------------------------------------------------- pure parts


def test_chunk_plan_fits_the_gateway_and_covers_everything():
    assert audio.plan_chunks(0) == []
    for seconds in (30.0, 570.0, 600.0, 3600.0, 4 * 3600.0, 4 * 3600.0 + 59):
        chunks = audio.plan_chunks(seconds)
        assert chunks[0].start == 0 and chunks[-1].end == pytest.approx(seconds)
        for prev, c in zip(chunks, chunks[1:], strict=False):
            assert c.keep_from == pytest.approx(prev.keep_to)  # nothing kept twice or lost
            assert prev.end - c.start == pytest.approx(audio.OVERLAP_SECONDS)
        assert all(c.length <= audio.MAX_CHUNK_SECONDS <= 600 for c in chunks)
    assert len(audio.plan_chunks(3600.0)) == 7  # one hour: seven parts of about 8.6 minutes
    assert len(audio.plan_chunks(30.0)) == 1


def test_stitch_keeps_the_overlap_once_and_drops_repeats():
    chunks = audio.plan_chunks(1200.0)
    results = {str(i): {"segments": s} for i, s in enumerate(THREE_CHUNKS)}
    segs = transcript.segments(chunks, results)
    texts = [s["text"] for s in segs]
    assert texts.count("RM 12,500.") == 0 and texts.count("Budget is RM 12,500.") == 1
    assert texts.count("Terima kasih.") == 1
    aisyah = next(s for s in segs if s["text"].startswith("Aisyah"))
    assert aisyah["t"] == pytest.approx(chunks[1].start + 5)  # on the recording's clock
    assert segs[-1]["t"] == pytest.approx(chunks[2].start + 10)
    # A model with no segments still lands at its chunk's start.
    plain = transcript.segments(chunks, {"1": {"text": "Hello there."}})
    assert plain == [{"t": chunks[1].start, "e": chunks[1].end, "text": "Hello there."}]
    paras = transcript.stitch(chunks, results)
    assert transcript.as_text(paras).splitlines()[0].startswith("[0:00] Selamat pagi")
    assert transcript.fmt_time(3725) == "1:02:05"
    parts = transcript.split_text("\n".join(["x" * 50] * 10), 120)
    assert all(len(p) <= 120 for p in parts) and sum(p.count("x") for p in parts) == 500
    assert "Aisyah" in transcript.context_prompt("words " * 50 + "Aisyah said")


def test_minutes_json_is_cleaned_and_rendered():
    raw = "```json\n" + json.dumps(MINUTES) + "\n```"
    m = writer.parse(raw)
    assert m is not None
    assert m["topics"][1]["start"] == "6:45" and m["topics"][2]["title"] == "Next steps"
    assert [a["what"] for a in m["action_items"]][2] == "Update the {{budget}} sheet"
    assert m["action_items"][0] == {
        "what": "Send the supplier quotation",
        "owner": "Aisyah",
        "due": "Friday",
    }
    assert writer.parse("not json at all") is None
    assert writer.parse(json.dumps({"title": "Empty"})) is None  # nothing useful in it
    assert writer.parse(json.dumps({"summary": "x", "topics": "oops", "attendees": "Ali"}))[
        "attendees"
    ] == ["Ali"]
    md = writer.markdown(m, language="en", recording="board.m4a, 20 min", date_fallback="")
    assert md.startswith("# Q4 budget review")
    assert "Attendees (as heard):** Aisyah, Encik Rahman" in md
    assert "as heard in the conversation" in md
    assert "| 2 | Book the / meeting room | - | - |" in md  # pipes cannot break the table
    assert "{{" not in md  # documents would treat it as a placeholder
    ms = writer.markdown(m, language="ms", recording="x", date_fallback="")
    assert "## Keputusan" in ms and "Kehadiran (seperti didengar)" in ms and "Tindakan oleh" in ms
    assert "Bahasa Melayu" in writer.system_prompt("ms")


# ---------------------------------------------------------------- the pipeline


async def test_upload_to_ready_minutes_in_the_library(client, net, ff, started, llm):  # noqa: F811
    o = await office(client)
    await speech(client, o)
    dept = o["depts"]["Finance"]
    r = await upload(client, title="", department_id=dept)
    assert r.status_code == 201, r.text
    rec = r.json()
    assert rec["status"] == "queued" and started == [rec["id"]]
    assert rec["title"] == "board meeting" and rec["branch_id"] == o["branch"]["id"]
    folder = audio.folder((await load(rec["id"])).workspace_id, rec["id"])
    assert (folder / "original.m4a").exists()

    net.chunks = [list(c) for c in THREE_CHUNKS]
    llm.say(json.dumps(MINUTES))
    assert await run_pipeline(rec["id"]) == {"done": True}

    # Three chunks heard in order, each told what came before; the original is gone.
    assert ff["cuts"] == [(0.0, 400.0), (398.0, 402.0), (798.0, 402.0)]
    assert len(net.heard) == 3 and net.heard[0]["format"] == "verbose_json"
    assert "Budget is RM 12,500." in net.heard[1]["prompt"]
    assert not (folder / "original.m4a").exists() and (folder / audio.AUDIO_NAME).exists()

    done = await load(rec["id"])
    assert done.status == "ready" and done.title == "Q4 budget review"
    assert done.chunk_results == {} and done.heard_language == "malay"
    assert done.audio_expires_at is not None
    assert abs((done.audio_expires_at - datetime.now(UTC)) - timedelta(days=30)) < timedelta(
        minutes=5
    )
    async with SessionLocal() as db:
        doc = await db.get(Document, done.document_id)
        assert doc is not None and doc.kind == "minutes" and "Q4 budget review" in doc.body
        f = await db.get(DocFile, done.library_file_id)
        assert f is not None and f.library and f.department_id == dept
        assert f.branch_id == o["branch"]["id"] and f.kind == "Meeting minutes"
        n = await db.scalar(
            select(func.count())
            .select_from(KnowledgeChunk)
            .where(KnowledgeChunk.source_id == f.id, KnowledgeChunk.department_id == dept)
        )
        assert n and n > 0  # agents in Finance can now search these decisions

    r = await client.get(f"/api/minutes/{rec['id']}")
    d = r.json()
    assert d["status"] == "ready" and d["audio_available"] and not d["published_stale"]
    assert d["transcript"][0]["t"] == 0 and "Selamat pagi" in d["transcript"][0]["text"]
    assert [a["what"] for a in d["action_items"]][0] == "Send the supplier quotation"
    assert d["open_actions"] == 3 and d["decision_count"] == 1

    # The player can jump: byte ranges are answered.
    r = await client.get(f"/api/minutes/{rec['id']}/audio", headers={"range": "bytes=0-9"})
    assert r.status_code == 206 and r.headers["content-type"] == "audio/mpeg"

    # Edit -> stale -> publish again; export reuses the document renderers.
    r = await client.put(
        f"/api/minutes/{rec['id']}/markdown",
        json={"body": d["markdown"] + "\nApproved by the chair."},
        headers=csrf(client),
    )
    assert r.status_code == 200 and r.json()["published_stale"]
    r = await client.post(f"/api/minutes/{rec['id']}/publish", json={}, headers=csrf(client))
    assert r.status_code == 200 and not r.json()["published_stale"]
    async with SessionLocal() as db:
        f = await db.get(DocFile, done.library_file_id)
        assert "Approved by the chair." in (
            await db.scalar(select(DocFile.text).where(DocFile.id == f.id))
        )
    r = await client.get(f"/api/minutes/{rec['id']}/export", params={"format": "docx"})
    assert r.status_code == 200 and r.content[:2] == b"PK"

    # Write again in Bahasa Melayu from the saved transcript: no new transcription.
    r = await client.post(
        f"/api/minutes/{rec['id']}/rewrite", json={"language": "ms"}, headers=csrf(client)
    )
    assert r.status_code == 200 and r.json()["status"] == "queued"
    llm.say(json.dumps({**MINUTES, "summary": "Pasukan menyemak bajet."}))
    assert await run_pipeline(rec["id"]) == {"done": True}
    assert len(net.heard) == 3
    d = (await client.get(f"/api/minutes/{rec['id']}")).json()
    assert "## Keputusan" in d["markdown"] and d["language"] == "ms"
    assert d["document_version"] >= 3  # earlier minutes kept as versions


async def test_resting_speech_model_waits_instead_of_failing(client, net, ff, started):
    o = await office(client)
    await speech(client, o, host="ratelimit.fake")
    rec = (await upload(client)).json()
    async with SessionLocal() as db:
        assert (await service.prepare(db, rec["id"]))["chunks"] == 3
    async with SessionLocal() as db:
        r = await service.transcribe_chunk(db, rec["id"], 0)
    assert r["wait"] >= 60  # Groq said retry after 120 s; the gateway cooled it
    busy = await load(rec["id"])
    assert busy.status == "transcribing" and "resting" in busy.stage_detail
    async with SessionLocal() as db:  # still cooling: the next try waits, never calls again
        r = await service.transcribe_chunk(db, rec["id"], 0)
    assert r["wait"] > 0 and len(net.heard) == 1


async def test_bad_recordings_fail_with_a_reason(client, net, ff, started, monkeypatch):
    o = await office(client)
    await speech(client, o)
    ff["has_audio"] = False
    rec = (await upload(client, name="screen.mp4")).json()
    async with SessionLocal() as db:
        assert await service.prepare(db, rec["id"]) == {"failed": True}
    assert "no sound track" in (await load(rec["id"])).error
    ff["has_audio"], ff["seconds"] = True, 6 * 3600.0
    rec = (await upload(client, name="all-day.mp3")).json()
    async with SessionLocal() as db:
        assert await service.prepare(db, rec["id"]) == {"failed": True}
    assert "the limit is 4 h" in (await load(rec["id"])).error

    r = await upload(client, name="notes.pdf", mime="application/pdf")
    assert r.status_code == 415
    ws = (await load(rec["id"])).workspace_id
    before = set(os.listdir(audio.root() / ws))
    monkeypatch.setattr(settings, "minutes_max_mb", 1)
    r = await client.post(
        "/api/minutes/upload",
        params={"name": "big.wav"},
        content=b"\x00" * (1024 * 1024 + 10),
        headers={**csrf(client), "content-type": "application/octet-stream"},
    )
    assert r.status_code == 413
    assert set(os.listdir(audio.root() / ws)) == before  # the partial upload is cleaned up


async def test_worker_down_then_retry(client, net, ff, monkeypatch):
    o = await office(client)
    await speech(client, o)

    async def down(rec):
        raise RuntimeError("temporal unreachable")

    monkeypatch.setattr(service, "start", down)
    rec = (await upload(client)).json()
    assert rec["status"] == "failed" and "worker" in rec["error"]
    calls = []

    async def up(rec):
        calls.append(rec.runs)
        return "wf"

    monkeypatch.setattr(service, "start", up)
    r = await client.post(f"/api/minutes/{rec['id']}/retry", json={}, headers=csrf(client))
    assert r.status_code == 200 and r.json()["status"] == "queued" and calls == [2]
    r = await client.post(f"/api/minutes/{rec['id']}/retry", json={}, headers=csrf(client))
    assert r.status_code == 409


async def test_no_speech_model_says_how_to_add_one(client, net, ff, started):
    await office(client)
    rec = (await upload(client)).json()
    async with SessionLocal() as db:
        await service.prepare(db, rec["id"])
    async with SessionLocal() as db:
        assert await service.transcribe_chunk(db, rec["id"], 0) == {"failed": True}
    assert "Speech to text" in (await load(rec["id"])).error


# ---------------------------------------------------------------- action items -> tasks


async def ready_minutes(client, net, llm, o) -> dict:  # noqa: F811
    await speech(client, o)
    rec = (await upload(client)).json()
    net.chunks = [list(c) for c in THREE_CHUNKS]
    llm.say(json.dumps(MINUTES))
    assert await run_pipeline(rec["id"]) == {"done": True}
    return rec


async def test_action_items_become_tasks(client, net, ff, started, llm, temporal):  # noqa: F811
    o = await office(client)
    faiz = await new_agent(client, o, "Faiz", "Finance")
    rec = await ready_minutes(client, net, llm, o)
    base = f"/api/minutes/{rec['id']}/actions"

    r = await client.patch(
        f"{base}/1", json={"owner": "Siti", "due_date": "31/10"}, headers=csrf(client)
    )
    assert r.status_code == 400  # dates are ISO
    r = await client.patch(
        f"{base}/1", json={"owner": "Siti", "due_date": "2026-10-31"}, headers=csrf(client)
    )
    assert r.status_code == 200
    assert "| 2 | Book the / meeting room | Siti | 2026-10-31 |" in r.json()["markdown"]

    r = await client.post(
        f"{base}/0/task",
        json={"agent_id": faiz["id"], "due_date": "2026-10-09"},
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    item = r.json()["action_items"][0]
    assert (
        item["task_id"] and item["owner_label"] == "Faiz" and item["owner_agent_id"] == faiz["id"]
    )
    again = await client.post(f"{base}/0/task", json={}, headers=csrf(client))
    assert again.json()["action_items"][0]["task_id"] == item["task_id"]  # one task per item

    r = await client.post(f"{base}/tasks", json={}, headers=csrf(client))
    assert r.status_code == 201
    d = r.json()
    assert d["open_actions"] == 0
    async with SessionLocal() as db:
        tasks = {t.title: t for t in (await db.scalars(select(Task))).all()}
    sent = tasks["Send the supplier quotation"]
    assert sent.assignee_agent_id == faiz["id"] and sent.status == "ready"
    assert "minutes" in sent.labels and "due 2026-10-09" in sent.labels
    assert "Named in the meeting: Aisyah" in sent.brief and rec["id"] in sent.brief
    room = tasks["Book the | meeting room"]
    assert room.assignee_agent_id is None and room.status == "triage"
    assert "Owner: Siti" in room.brief and "due 2026-10-31" in room.labels
    assert len(tasks) == 3
    assert "| 1 | Send the supplier quotation | Faiz | 2026-10-09 |" in d["markdown"]


# ---------------------------------------------------------------- permissions


async def test_who_sees_and_changes_minutes(client, net, ff, started, llm):  # noqa: F811
    o = await office(client)
    b2 = (
        await client.post("/api/branches", json={"name": "Jaya Bhd"}, headers=csrf(client))
    ).json()
    rec = await ready_minutes(client, net, llm, o)
    # Filed for the first company by the owner.
    r = await client.patch(
        f"/api/minutes/{rec['id']}", json={"branch_id": o["branch"]["id"]}, headers=csrf(client)
    )
    assert r.status_code == 200 and r.json()["scope_label"] == "Maju Sdn Bhd"

    viewer = await as_role(client, "viewer@example.com", "viewer")
    far = await as_role(client, "far@example.com", "staff", branch_id=b2["id"])
    near = await as_role(client, "near@example.com", "staff", branch_id=o["branch"]["id"])
    try:
        assert (await viewer.get(f"/api/minutes/{rec['id']}")).status_code == 200
        r = await viewer.patch(
            f"/api/minutes/{rec['id']}", json={"title": "x"}, headers=csrf(viewer)
        )
        assert r.status_code == 403
        assert (await upload(viewer)).status_code == 403  # viewers cannot upload

        assert (await far.get(f"/api/minutes/{rec['id']}")).status_code == 404
        assert (await far.get("/api/minutes")).json() == []
        assert (await far.get(f"/api/minutes/{rec['id']}/audio")).status_code == 404

        seen = await near.get(f"/api/minutes/{rec['id']}")
        assert seen.status_code == 200 and not seen.json()["can_edit"]
        r = await near.post(f"/api/minutes/{rec['id']}/publish", json={}, headers=csrf(near))
        assert r.status_code == 403
        # Staff file their own recordings under their company, never another one.
        r = await upload(near, branch_id=b2["id"])
        assert r.status_code == 403
        mine = (await upload(near)).json()
        assert mine["branch_id"] == o["branch"]["id"] and mine["can_edit"]
        assert (await far.get(f"/api/minutes/{mine['id']}")).status_code == 404
    finally:
        for c in (viewer, far, near):
            await c.aclose()

    r = await client.put("/api/minutes/settings", json={"audio_days": 7}, headers=csrf(client))
    assert r.status_code == 200 and r.json()["audio_days"] == 7


# ---------------------------------------------------------------- purge


async def test_purge_deletes_expired_audio_old_originals_and_orphans(client, net, ff, started, llm):  # noqa: F811
    o = await office(client)
    rec = await ready_minutes(client, net, llm, o)
    ff["has_audio"] = False
    bad = (await upload(client, name="silent.mp4")).json()
    async with SessionLocal() as db:
        await service.prepare(db, bad["id"])
    done = await load(rec["id"])
    ws = done.workspace_id
    audio_path = audio.folder(ws, rec["id"]) / audio.AUDIO_NAME
    original = audio.folder(ws, bad["id"]) / "original.mp4"
    orphan = audio.root() / ws / "mr_abandoned"
    orphan.mkdir(parents=True)
    old = time.time() - 3 * 86400
    os.utime(orphan, (old, old))
    assert audio_path.exists() and original.exists()

    async with SessionLocal() as db:
        assert await service.purge(db) == {"audio": 0, "originals": 0, "orphans": 1}
    later = datetime.now(UTC) + timedelta(days=31)
    async with SessionLocal() as db:
        await db.execute(
            text("UPDATE meeting_recordings SET updated_at = now() - interval '4 days'")
        )
        await db.commit()
        counts = await service.purge(db, later)
    assert counts["audio"] == 1 and counts["originals"] == 1
    assert not audio_path.exists() and not original.exists() and not orphan.exists()
    gone = await load(rec["id"])
    assert gone.audio_file is None and gone.audio_purged_at is not None
    d = (await client.get(f"/api/minutes/{rec['id']}")).json()
    assert not d["audio_available"] and d["transcript"]  # the words stay
    r = await client.request("DELETE", f"/api/minutes/{rec['id']}", json={}, headers=csrf(client))
    assert r.status_code == 204
    async with SessionLocal() as db:
        assert await db.get(DocFile, done.library_file_id) is None
        assert await db.get(Document, done.document_id) is None


# ---------------------------------------------------------------- the agent tool


async def test_agent_makes_minutes_of_a_file(client, net, ff, started, llm):  # noqa: F811
    o = await office(client)
    await speech(client, o)
    faiz = await new_agent(client, o, "Faiz", "Finance")
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace))
        f = await doc_service.create_file(
            db,
            workspace_id=ws.id,
            name="call.mp3",
            data=b"ID3" + b"\x00" * 512,
            created_by="user:x",
            mime="audio/mpeg",
            branch_id=o["branch"]["id"],
            status="ready",
        )
        note = await doc_service.create_file(
            db, workspace_id=ws.id, name="memo.txt", data=b"hello", created_by="user:x"
        )
        await db.commit()
        agent = await db.get(Agent, faiz["id"])
        ctx = ToolContext(db=db, agent=agent, workspace=ws, task=None)
        tool = TOOLS["meeting_minutes"]
        assert "not an audio" in await tool.handler(ctx, {"file_id": note.id})
        out = await tool.handler(ctx, {"file_id": f.id, "language": "ms"})
        assert out.startswith("Started making minutes") and len(started) == 1
        out = await tool.handler(ctx, {"file_id": f.id})
        assert out.startswith("Still working")
        rec_id = started[0]
    rec = await load(rec_id)
    assert rec.language == "ms" and rec.department_id == faiz["department_id"]
    assert rec.created_by == f"agent:{faiz['id']}"
    net.chunks = [list(c) for c in THREE_CHUNKS]
    llm.say(json.dumps(MINUTES))
    assert await run_pipeline(rec_id) == {"done": True}
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace))
        agent = await db.get(Agent, faiz["id"])
        out = await TOOLS["meeting_minutes"].handler(
            ToolContext(db=db, agent=agent, workspace=ws, task=None), {"file_id": f.id}
        )
    assert out.startswith("Minutes ready") and "Q4 budget review" in out
