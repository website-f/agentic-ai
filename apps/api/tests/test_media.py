"""P18 voice and pictures: speech-to-text routing (fallback, cooldown, llm_calls with cost),
the voice/picture groups filling themselves from Groq and OpenAI, WhatsApp (WAHA and Meta)
and Telegram voice notes answered as if typed, the dashboard /api/transcribe endpoint, and
the approval-gated generate_image tool that saves a picture to the office files.

Every provider, WAHA, Meta and Telegram call goes to a fake transport."""

import base64
import json
import re

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.orm import undefer

from agentic.agents import policy, runtime
from agentic.agents.tools import TOOLS, ToolContext
from agentic.channels import bot, whatsapp
from agentic.core.db import SessionLocal
from agentic.engine import client as engine_client
from agentic.engine import gateway
from agentic.models import Agent, Channel, DocFile, LLMCall, Workspace

from .conftest import csrf, setup_owner
from .test_agents import ScriptedLLM, llm, new_agent, new_task, office, temporal  # noqa: F401
from .test_assistants import FakeWaha, _msg, _waha_hook
from .test_channels import TG_TOKEN, Net, telegram_setup

OGG = b"OggS\x00\x02" + b"\x00" * 64  # enough to look like a voice note
PNG = b"\x89PNG\r\n\x1a\n" + b"fake picture"


def _field(body: bytes, name: str) -> str:
    m = re.search(rb'name="' + name.encode() + rb'"\r\n\r\n([^\r]*)', body)
    return m.group(1).decode() if m else ""


class Media:
    """Speech-to-text and picture endpoints on the fake provider hosts."""

    def __init__(self) -> None:
        self.heard = "Please book the meeting room for Friday"
        self.transcribe: list[dict] = []
        self.images: list[dict] = []

    def handle(self, request: httpx.Request) -> httpx.Response | None:
        host, path = request.url.host, request.url.path
        if path.endswith("/audio/transcriptions"):
            body = request.content
            fname = re.search(rb'filename="([^"]+)"', body)
            self.transcribe.append(
                {
                    "host": host,
                    "model": _field(body, "model"),
                    "format": _field(body, "response_format"),
                    "language": _field(body, "language"),
                    "filename": fname.group(1).decode() if fname else "",
                    "auth": request.headers.get("authorization", ""),
                }
            )
            if host == "broken.fake":
                return httpx.Response(500, text="upstream exploded")
            if _field(body, "response_format") == "verbose_json":
                return httpx.Response(
                    200, json={"text": self.heard, "duration": 30.0, "language": "english"}
                )
            return httpx.Response(200, json={"text": self.heard})
        if path.endswith("/images/generations"):
            self.images.append({"host": host, **json.loads(request.content)})
            if host == "broken.fake":
                return httpx.Response(500, text="no pictures today")
            return httpx.Response(
                200, json={"created": 1, "data": [{"b64_json": base64.b64encode(PNG).decode()}]}
            )
        return None


class VoiceNet(Net):
    """test_channels' fake internet (scripted LLM + Telegram) plus files and media."""

    def __init__(self, llm_: ScriptedLLM) -> None:
        super().__init__(llm_)
        self.media = Media()

    def handler(self, request: httpx.Request) -> httpx.Response:
        if (r := self.media.handle(request)) is not None:
            return r
        path = request.url.path
        if request.url.host == "tg.fake" and path.startswith(f"/file/bot{TG_TOKEN}/"):
            self.tg.append(("download", {"path": path}))
            return httpx.Response(200, content=OGG)
        if request.url.host == "tg.fake" and path.endswith("/getFile"):
            body = json.loads(request.content)
            self.tg.append(("getFile", body))
            return httpx.Response(
                200,
                json={
                    "ok": True,
                    "result": {
                        "file_id": body["file_id"],
                        "file_path": "voice/file_7.oga",
                        "file_size": len(OGG),
                    },
                },
            )
        return super().handler(request)


@pytest.fixture
def net(llm):  # noqa: F811
    n = VoiceNet(llm)
    engine_client.use_transport(httpx.MockTransport(n.handler))
    yield n
    engine_client.use_transport(None)


class VoiceWaha(FakeWaha):
    def __init__(self) -> None:
        super().__init__()
        self.downloads: list[str] = []

    def handler(self, r: httpx.Request) -> httpx.Response:
        if r.url.path.startswith("/api/files/"):
            assert r.headers.get("x-api-key") == "waha-key"
            self.downloads.append(str(r.url))
            return httpx.Response(200, content=OGG, headers={"content-type": "audio/ogg"})
        return super().handler(r)


@pytest.fixture
def waha(monkeypatch):
    from agentic.core.config import settings

    w = VoiceWaha()
    whatsapp.transport = httpx.MockTransport(w.handler)
    monkeypatch.setattr(settings, "waha_url", "http://waha.test:3000")
    monkeypatch.setattr(settings, "waha_api_key", "waha-key")
    yield w
    whatsapp.transport = None


async def _provider(c: httpx.AsyncClient, name: str, host: str, tier: str, preset=None) -> dict:
    r = await c.post(
        "/api/ai/providers",
        json={
            "name": name,
            "base_url": f"https://{host}/v1",
            "api_key": "secret-key-123",
            "tier": tier,
            **({"preset": preset} if preset else {}),
        },
        headers=csrf(c),
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _group(c: httpx.AsyncClient, name: str, members: list[tuple[dict, str]]) -> dict:
    r = await c.put(
        f"/api/ai/groups/{name}",
        json={"members": [{"provider_id": p["id"], "model_id": m} for p, m in members]},
        headers=csrf(c),
    )
    assert r.status_code == 200, r.text
    return r.json()


async def _workspace_id() -> str:
    async with SessionLocal() as db:
        return (await db.scalar(select(Workspace))).id


def _voice_msg(sender: str, mid: str) -> dict:
    return {
        "event": "message",
        "session": "default",
        "payload": {
            "id": mid,
            "from": sender,
            "body": "",
            "fromMe": False,
            "hasMedia": True,
            # WAHA writes its own public address here; only the path is ever used.
            "media": {
                "url": f"http://localhost:3000/api/files/default/{mid}.oga",
                "mimetype": "audio/ogg; codecs=opus",
            },
            "_data": {"notifyName": "Siti", "type": "ptt"},
        },
    }


# ---------------------------------------------------------------- routing


async def test_transcribe_falls_back_cools_and_logs_cost(client, net, temporal):
    await office(client)
    groups = {g["name"]: g for g in (await client.get("/api/ai/groups")).json()}
    assert groups["transcribe"]["kind"] == "transcribe" and groups["transcribe"]["members"] == []
    assert groups["image"]["kind"] == "image" and groups["smart"]["kind"] == "chat"
    ws = await _workspace_id()
    async with SessionLocal() as db:
        with pytest.raises(gateway.NotConfigured) as e:
            await gateway.transcribe(db, ws, OGG, mime="audio/ogg")
        assert "AI Engine" in str(e.value)

    broken = await _provider(client, "Broken", "broken.fake", "paid")
    paid = await _provider(client, "Paid", "good.fake", "paid")
    await _group(client, "transcribe", [(broken, "whisper-1"), (paid, "whisper-1")])
    async with SessionLocal() as db:
        t = await gateway.transcribe(db, ws, OGG, mime="audio/ogg; codecs=opus", language="en")
    assert t.text == net.media.heard and t.provider_name == "Paid" and t.seconds == 30.0
    assert t.cost_usd == pytest.approx(0.003)  # whisper-1: $0.006 a minute, 30 s
    assert [a.get("error_class") or "ok" for a in t.attempts] == ["provider_error", "ok"]
    sent = net.media.transcribe[-1]
    assert sent["filename"] == "voice.ogg" and sent["format"] == "verbose_json"
    assert sent["language"] == "en" and sent["auth"] == "Bearer secret-key-123"
    async with SessionLocal() as db:
        calls = (await db.scalars(select(LLMCall).where(LLMCall.task == "audio.transcribe"))).all()
    assert sorted((c.provider_name, c.status, c.error_class) for c in calls) == [
        ("Broken", "error", "provider_error"),
        ("Paid", "ok", None),
    ]
    assert float(next(c for c in calls if c.status == "ok").cost_usd) == pytest.approx(0.003)

    # The broken provider rests now: the next note goes straight to the working one.
    async with SessionLocal() as db:
        t2 = await gateway.transcribe(db, ws, OGG, mime="audio/webm")
    assert "cooling down" in t2.attempts[0]["skipped"]
    assert net.media.transcribe[-1]["filename"] == "voice.webm"

    async with SessionLocal() as db:
        with pytest.raises(gateway.MediaRejected, match="25 MB"):
            await gateway.transcribe(db, ws, b"x" * (25 * 1024 * 1024 + 1), mime="audio/ogg")
        with pytest.raises(gateway.MediaRejected, match="10 minutes"):
            await gateway.transcribe(db, ws, OGG, mime="audio/ogg", seconds=601)
        with pytest.raises(gateway.MediaRejected, match="empty"):
            await gateway.transcribe(db, ws, b"", mime="audio/ogg")
        # A voice group never answers a chat prompt.
        with pytest.raises(gateway.GatewayUnavailable, match="does not chat"):
            await gateway.chat(db, ws, "transcribe", [{"role": "user", "content": "hi"}], task="t")


async def test_groq_and_openai_fill_the_voice_and_picture_groups(client, net):
    await setup_owner(client)
    await client.get("/api/ai/groups")  # the groups exist, empty, before any provider
    groq = await _provider(client, "Groq", "good.fake", "free", preset="groq")
    groups = {g["name"]: g for g in (await client.get("/api/ai/groups")).json()}
    assert [m["model_id"] for m in groups["transcribe"]["members"]] == [
        "whisper-large-v3-turbo",
        "whisper-large-v3",
    ]
    assert groups["image"]["members"] == [] and groups["smart"]["members"] == []

    openai = await _provider(client, "OpenAI", "good.fake", "paid", preset="openai")
    groups = {g["name"]: g for g in (await client.get("/api/ai/groups")).json()}
    # Already set up: left alone. Still empty: filled.
    assert {m["provider_id"] for m in groups["transcribe"]["members"]} == {groq["id"]}
    assert groups["image"]["members"] == [
        {"provider_id": openai["id"], "model_id": "gpt-image-1"},
        {"provider_id": openai["id"], "model_id": "dall-e-3"},
    ]
    # Someone empties a group on purpose: another provider does not refill it.
    await _group(client, "transcribe", [])
    await _provider(client, "Mistral", "good.fake", "free", preset="mistral")
    groups = {g["name"]: g for g in (await client.get("/api/ai/groups")).json()}
    assert groups["transcribe"]["members"] == []


async def test_new_workspace_with_groq_gets_whisper_on_first_use(client, net):
    await setup_owner(client)
    # The provider exists before the voice group does (an office set up before P18).
    await _provider(client, "Groq", "good.fake", "free", preset="groq")
    ws = await _workspace_id()
    async with SessionLocal() as db:
        t = await gateway.transcribe(db, ws, OGG, mime="audio/ogg")
    assert t.model == "whisper-large-v3-turbo" and t.cost_usd == 0  # Groq's free tier


# ---------------------------------------------------------------- channels


async def test_whatsapp_voice_note_is_heard_and_answered(client, net, temporal, waha):
    await office(client)
    ch = (
        await client.post("/api/channels/whatsapp", json={"provider": "waha"}, headers=csrf(client))
    ).json()
    waha.status, waha.me = "WORKING", {"id": "60312345678@c.us", "pushName": "Maju Office"}
    await client.get(f"/api/channels/{ch['id']}/whatsapp")
    code = (
        await client.post(f"/api/channels/{ch['id']}/link-code", json={}, headers=csrf(client))
    ).json()["code"]
    me = "60123456789@c.us"
    await _waha_hook(client, ch["id"], _msg(me, f"LINK {code}", "l1"))
    a = (
        await client.post(
            "/api/assistants", json={"preset": "chief_of_staff"}, headers=csrf(client)
        )
    ).json()

    # No speech-to-text model yet: one helpful line, and the assistant is not bothered.
    calls = len(net.llm.requests)
    await _waha_hook(client, ch["id"], _voice_msg(me, "v1"))
    assert "AI Engine" in waha.sent[-1]["text"] and "Speech to text" in waha.sent[-1]["text"]
    assert len(net.llm.requests) == calls

    groups = {g["name"]: g for g in (await client.get("/api/ai/groups")).json()}
    good = (await client.get("/api/ai/providers")).json()[0]
    assert groups["transcribe"]["members"] == []
    await _group(client, "transcribe", [(good, "whisper-large-v3-turbo")])
    net.llm.say("Done: the meeting room is yours on Friday at 10.")
    await _waha_hook(client, ch["id"], _voice_msg(me, "v2"))

    # Fetched from the channel's own WAHA address (never the one in the payload), with its key.
    assert waha.downloads[-1] == "http://waha.test:3000/api/files/default/v2.oga"
    assert net.media.transcribe[-1]["filename"] == "voice.ogg"
    assert net.llm.requests[-1]["messages"][-1]["content"].startswith(net.media.heard)
    assert waha.sent[-1]["text"].startswith(
        f"> {net.media.heard}\n\n*{a['name']}*: Done: the meeting room"
    )
    # The same webhook again is answered once.
    sent = len(waha.sent)
    await _waha_hook(client, ch["id"], _voice_msg(me, "v2"))
    assert len(waha.sent) == sent
    # A stranger's voice note is never downloaded or transcribed.
    heard = len(net.media.transcribe)
    await _waha_hook(client, ch["id"], _voice_msg("60999@c.us", "s1"))
    assert len(net.media.transcribe) == heard and len(waha.sent) == sent


def test_waha_voice_payloads_parse_safely():
    ok = whatsapp.parse_waha(_voice_msg("60123@c.us", "v9"))
    assert ok[0].audio is not None and ok[0].audio.ref == "/api/files/default/v9.oga"
    # A picture is not a voice note; a media URL outside WAHA's files is ignored.
    pic = _voice_msg("60123@c.us", "p1")
    pic["payload"]["media"]["mimetype"] = "image/jpeg"
    odd = _voice_msg("60123@c.us", "p2")
    odd["payload"]["media"]["url"] = "http://evil.example/api/sessions/default/logout"
    assert whatsapp.parse_waha(pic) == [] and whatsapp.parse_waha(odd) == []


async def test_meta_voice_note_downloads_with_the_token_only_from_meta():
    seen: list[tuple[str, str]] = []
    cdn = "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1"

    def handler(r: httpx.Request) -> httpx.Response:
        seen.append((str(r.url), r.headers.get("authorization", "")))
        if r.url.host == "graph.facebook.com":
            url = cdn if r.url.path.endswith("/media-ok") else "https://evil.example/x"
            return httpx.Response(200, json={"url": url, "mime_type": "audio/ogg"})
        return httpx.Response(200, content=OGG)

    payload = {
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "messages": [
                                {
                                    "from": "60123",
                                    "id": "wamid.v1",
                                    "type": "audio",
                                    "audio": {"id": "media-ok", "mime_type": "audio/ogg"},
                                }
                            ]
                        }
                    }
                ]
            }
        ]
    }
    msg = whatsapp.parse_meta(payload)[0]
    assert msg.text == "" and msg.audio is not None and msg.audio.ref == "media-ok"
    cfg = whatsapp.Config(provider="meta", phone_number_id="1", token="EAAG-token")
    whatsapp.transport = httpx.MockTransport(handler)
    try:
        assert await whatsapp.download_audio(cfg, msg.audio, 1_000_000) == OGG
        assert seen[-1] == (cdn, "Bearer EAAG-token")
        with pytest.raises(whatsapp.WhatsAppError, match="unexpected address"):
            await whatsapp.download_audio(cfg, whatsapp.Audio("media-bad", "audio/ogg"), 1000)
        assert not any("evil.example" in u for u, _ in seen)
    finally:
        whatsapp.transport = None


async def test_telegram_voice_note_is_heard_and_answered(client, net, temporal):
    o = await office(client)
    ch = await telegram_setup(client, net)
    agent = await new_agent(client, o, "Hana", "Management")
    await client.put(
        f"/api/channels/{ch['id']}/bindings",
        json={"match": "dm", "agent_id": agent["id"]},
        headers=csrf(client),
    )
    good = (await client.get("/api/ai/providers")).json()[0]
    await _group(client, "transcribe", [(good, "whisper-large-v3-turbo")])
    net.media.heard = "When is payroll?"
    net.llm.say("Payroll goes out on the 25th.")
    voice = {"file_id": "F1", "duration": 3, "mime_type": "audio/ogg", "file_size": len(OGG)}
    async with SessionLocal() as db:
        channel = await db.get(Channel, ch["id"])
        await bot.handle_update(
            db,
            channel,
            {
                "update_id": 9,
                "message": {
                    "message_id": 6,
                    "voice": voice,
                    "chat": {"id": 555, "type": "private"},
                    "from": {"id": 777},
                },
            },
        )
        # Too long to transcribe: refused before anything is downloaded.
        downloads = len([m for m, _ in net.tg if m == "download"])
        await bot.handle_update(
            db,
            channel,
            {
                "update_id": 10,
                "message": {
                    "message_id": 7,
                    "voice": {**voice, "duration": 900},
                    "chat": {"id": 555, "type": "private"},
                    "from": {"id": 777},
                },
            },
        )
    assert ("getFile", {"file_id": "F1"}) in net.tg
    assert len([m for m, _ in net.tg if m == "download"]) == downloads == 1
    texts = [b["text"] for m, b in net.tg if m == "sendMessage"]
    assert texts[-2] == '"When is payroll?"\n\nHana: Payroll goes out on the 25th.'
    assert "too long" in texts[-1]


# ---------------------------------------------------------------- the dashboard microphone


async def test_transcribe_endpoint_auth_csrf_type_and_size(client, net):
    anon = await client.post(
        "/api/transcribe",
        content=OGG,
        headers={"content-type": "application/octet-stream", "x-file-type": "audio/webm"},
    )
    assert anon.status_code == 401
    await office(client)
    raw = {"content-type": "application/octet-stream", "x-file-type": "audio/webm;codecs=opus"}
    no_csrf = await client.post("/api/transcribe", content=OGG, headers=raw)
    assert no_csrf.status_code == 403 and no_csrf.json()["code"] == "csrf_failed"
    form = await client.post(
        "/api/transcribe",
        content=b"a=1",
        headers={**csrf(client), "content-type": "application/x-www-form-urlencoded"},
    )
    assert form.status_code == 415 and form.json()["code"] == "json_required"
    not_audio = await client.post(
        "/api/transcribe", content=PNG, headers={**raw, **csrf(client), "x-file-type": "image/png"}
    )
    assert not_audio.status_code == 415 and not_audio.json()["code"] == "not_audio"
    unset = await client.post("/api/transcribe", content=OGG, headers={**raw, **csrf(client)})
    assert unset.status_code == 409 and unset.json()["code"] == "no_transcribe_model"
    assert "AI Engine" in unset.json()["message"]

    good = (await client.get("/api/ai/providers")).json()[0]
    await _group(client, "transcribe", [(good, "gpt-4o-mini-transcribe")])
    ok = await client.post(
        "/api/transcribe?language=ms&seconds=4.5", content=OGG, headers={**raw, **csrf(client)}
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["text"] == net.media.heard and ok.json()["model"] == "gpt-4o-mini-transcribe"
    sent = net.media.transcribe[-1]
    assert sent["filename"] == "voice.webm" and sent["format"] == "json"
    assert sent["language"] == "ms"
    big = await client.post(
        "/api/transcribe",
        content=b"x" * (25 * 1024 * 1024 + 10),
        headers={**raw, **csrf(client)},
    )
    assert big.status_code == 413 and big.json()["code"] == "recording_too_large"
    long = await client.post(
        "/api/transcribe?seconds=700", content=OGG, headers={**raw, **csrf(client)}
    )
    assert long.status_code == 400 and "10 minutes" in long.json()["message"]


# ---------------------------------------------------------------- pictures


async def test_generate_image_waits_for_approval_then_saves_a_file(client, net, temporal):
    o = await office(client)
    paid = await _provider(client, "Paid", "good.fake", "paid")
    await _group(client, "image", [(paid, "gpt-image-1")])
    agent = await new_agent(client, o, "Mira", "Research")
    task = await new_task(client, agent, "Make the sale poster")
    await client.post(f"/api/tasks/{task['id']}/start", json={}, headers=csrf(client))
    net.llm.call(
        "generate_image",
        prompt="A poster for the Hari Raya sale, green and gold",
        size="landscape",
        style="flat illustration",
    )
    r = await runtime.run_task_step(task["id"])
    assert r.state == "needs_approval"
    assert net.media.images == []  # nothing is spent before a person says yes
    pending = (await client.get("/api/approvals")).json()
    assert pending[0]["tool_label"] == "Make a picture"
    decided = await client.post(
        f"/api/approvals/{r.approval_id}",
        json={"decision": "approve", "scope": "once"},
        headers=csrf(client),
    )
    assert decided.status_code == 200
    await runtime.apply_approval(r.approval_id)

    sent = net.media.images[-1]
    assert sent["model"] == "gpt-image-1" and sent["size"] == "1536x1024"
    assert sent["quality"] == "medium" and "response_format" not in sent
    assert sent["prompt"].endswith("Style: flat illustration")
    async with SessionLocal() as db:
        f = await db.scalar(
            select(DocFile).where(DocFile.task_id == task["id"]).options(undefer(DocFile.data))
        )
        assert f is not None and f.source == "generated" and f.mime == "image/png"
        assert f.name == "a-poster-for-the-hari-raya.png" and bytes(f.data) == PNG
        cost = await db.scalar(select(LLMCall.cost_usd).where(LLMCall.task == "image.generate"))
    assert float(cost) == pytest.approx(0.063)
    files = (await client.get("/api/files", params={"source": "generated"})).json()
    assert [x["id"] for x in files] == [f.id]

    net.llm.say("The poster is ready in Files.")
    assert (await runtime.run_task_step(task["id"])).state == "done"
    tool_msg = net.llm.requests[-1]["messages"][-1]
    assert tool_msg["role"] == "tool" and f"[{f.id}]" in tool_msg["content"]


async def test_generate_image_needs_a_model_and_asks_by_default(client, net, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Mira", "Research")
    cautious = Agent(name="Ben", tools={}, autonomy="ask")
    assert (await policy.evaluate(cautious, "generate_image", {"prompt": "x"})).effect == "ask"
    async with SessionLocal() as db:
        a = await db.get(Agent, agent["id"])
        ws = await db.get(Workspace, a.workspace_id)
        ctx = ToolContext(db=db, agent=a, workspace=ws, task=None)
        out = await TOOLS["generate_image"].handler(ctx, {"prompt": "A cat"})
        assert out.startswith("Error: No picture model is set up") and "AI Engine" in out
        assert (await TOOLS["generate_image"].handler(ctx, {"prompt": " "})).startswith(
            "Error: Desc"
        )
        # Both members fail: a clear error, and nothing saved.
        broken = await _provider(client, "Broken", "broken.fake", "paid")
        await _group(client, "image", [(broken, "dall-e-3")])
        out = await TOOLS["generate_image"].handler(ctx, {"prompt": "A cat"})
        assert out.startswith("Error: the picture could not be made")
        assert net.media.images[-1]["response_format"] == "b64_json"
        assert await db.scalar(select(DocFile.id)) is None
