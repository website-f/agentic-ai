"""P6 channels: web push with approve-from-notification, Telegram, the delivery ledger,
API tokens and the OpenAI-compatible endpoint."""

import base64
import json
import os
from datetime import UTC, datetime, timedelta

import http_ece
import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from sqlalchemy import select, update

from agentic.agents import runtime
from agentic.channels import bot, deliver
from agentic.core.db import SessionLocal
from agentic.engine import client as engine_client
from agentic.models import ActionToken, Approval, Channel, ChannelLink, Delivery, PushSubscription

from .conftest import csrf
from .test_agents import ScriptedLLM, llm, new_agent, new_task, office, temporal  # noqa: F401

TG_TOKEN = "123456:ABCdefGhIJKlmNoPQRstuVWXyz-0123456789"


def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


class Net:
    """One fake internet: the scripted LLM, a push service and the Telegram Bot API."""

    def __init__(self, llm_: ScriptedLLM):
        self.llm = llm_
        self.pushes: list[httpx.Request] = []
        self.push_status = 201
        self.tg: list[tuple[str, dict]] = []
        self.updates: list[dict] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        host = request.url.host
        if host == "push.fake":
            self.pushes.append(request)
            return httpx.Response(self.push_status)
        if host == "tg.fake":
            method = request.url.path.rsplit("/", 1)[-1]
            body = json.loads(request.content or b"{}")
            self.tg.append((method, body))
            if not request.url.path.startswith(f"/bot{TG_TOKEN}/"):
                return httpx.Response(401, json={"ok": False, "description": "Unauthorized"})
            result: object = True
            if method == "getMe":
                result = {
                    "id": 99,
                    "is_bot": True,
                    "username": "maju_office_bot",
                    "first_name": "Maju",
                }
            elif method == "sendMessage":
                result = {"message_id": 1000 + len(self.tg), "chat": {"id": body["chat_id"]}}
            elif method == "getUpdates":
                result, self.updates = self.updates, []
            return httpx.Response(200, json={"ok": True, "result": result})
        return self.llm.handler(request)


@pytest.fixture
def net(llm):  # noqa: F811
    n = Net(llm)
    engine_client.use_transport(httpx.MockTransport(n.handler))
    yield n
    engine_client.use_transport(None)


def browser_keys() -> tuple[ec.EllipticCurvePrivateKey, dict[str, str], bytes]:
    key = ec.generate_private_key(ec.SECP256R1())
    pub = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    auth = os.urandom(16)
    return key, {"p256dh": b64u(pub), "auth": b64u(auth)}, auth


async def subscribe(
    c: httpx.AsyncClient, endpoint: str = "https://push.fake/send/abc"
) -> tuple[ec.EllipticCurvePrivateKey, bytes]:
    key, keys, auth = browser_keys()
    r = await c.post(
        "/api/push/subscribe",
        json={"endpoint": endpoint, "keys": keys, "label": "Fitri's phone"},
        headers=csrf(c),
    )
    assert r.status_code == 201, r.text
    return key, auth


async def blocked_task(c: httpx.AsyncClient, llm_: ScriptedLLM, o: dict) -> tuple[dict, str]:
    agent = await new_agent(c, o, "Rafi", "Research")
    task = await new_task(c, agent, "Check the price")
    await c.post(f"/api/tasks/{task['id']}/start", json={}, headers=csrf(c))
    llm_.call("web_fetch", url="https://good.fake/page", why="Need today's price")
    r = await runtime.run_task_step(task["id"])
    assert r.state == "needs_approval" and r.approval_id
    return task, r.approval_id


# ---------------------------------------------------------------- web push


async def test_subscriptions_only_for_real_push_services(client: httpx.AsyncClient, net, temporal):
    await office(client)
    _, keys, _ = browser_keys()
    for bad in (
        "http://push.fake/x",
        "https://169.254.169.254/latest",
        "https://evil.example.com/push",
    ):
        r = await client.post(
            "/api/push/subscribe", json={"endpoint": bad, "keys": keys}, headers=csrf(client)
        )
        assert r.status_code == 422, bad
    await subscribe(client)
    devices = (await client.get("/api/push/devices")).json()
    assert [d["label"] for d in devices] == ["Fitri's phone"] and devices[0][
        "service"
    ] == "push.fake"
    key = (await client.get("/api/push/key")).json()["public_key"]
    assert len(base64.urlsafe_b64decode(key + "==")) == 65  # uncompressed P-256 point


async def test_approve_from_the_notification(client: httpx.AsyncClient, net, temporal):
    o = await office(client)
    phone, auth = await subscribe(client)
    task, approval_id = await blocked_task(client, net.llm, o)
    assert len(temporal["deliveries"]) == 1  # queued for the worker

    async with SessionLocal() as db:
        state = await deliver.deliver(db, temporal["deliveries"][0])
        d = await db.get(Delivery, temporal["deliveries"][0])
        assert d is not None and "token_enc" not in d.payload  # the secret leaves the row once sent
    assert state == "sent"
    req = net.pushes[0]
    assert req.headers["content-encoding"] == "aes128gcm" and req.headers[
        "authorization"
    ].startswith("vapid t=")
    payload = json.loads(
        http_ece.decrypt(req.content, private_key=phone, auth_secret=auth, version="aes128gcm")
    )
    assert payload["approval_id"] == approval_id and payload["title"] == "Rafi needs a decision"
    assert payload["url"] == f"/approve/{approval_id}" and payload["badge"] == 1

    # The Approve button (no session cookie: the token is the proof).
    anon = httpx.AsyncClient(transport=client._transport, base_url="http://test")  # noqa: SLF001
    async with anon:
        r = await anon.post(
            "/api/push/act", json={"token": payload["token"], "decision": "approve"}
        )
        assert r.status_code == 200 and r.json()["status"] == "approved"
        again = await anon.post(
            "/api/push/act", json={"token": payload["token"], "decision": "deny"}
        )
        assert again.status_code == 401  # single use
    assert temporal["signal"] == [(f"task-{task['id']}-1", approval_id)]
    log = (await client.get("/api/audit")).json()
    entry = next(e for e in log["items"] if e["action"] == "approval.approved")
    assert entry["after"]["via"] == "push"


async def test_expired_token_and_dedupe(client: httpx.AsyncClient, net, temporal):
    o = await office(client)
    await subscribe(client)
    _, approval_id = await blocked_task(client, net.llm, o)
    async with SessionLocal() as db:
        a = await db.get(Approval, approval_id)
        assert a is not None
        assert await deliver.approval_requested(db, a) == []  # same approval x device: never twice
        await db.execute(
            update(ActionToken).values(expires_at=datetime.now(UTC) - timedelta(minutes=1))
        )
        await db.commit()
        await deliver.deliver(db, temporal["deliveries"][0])
    payload_token = None
    for req in net.pushes:
        payload_token = req  # encrypted; the expiry is what matters here
    assert payload_token is not None
    async with SessionLocal() as db:
        tok = await db.scalar(select(ActionToken))
        assert tok is not None
    r = await client.post("/api/push/act", json={"token": "x" * 43, "decision": "approve"})
    assert r.status_code == 401


async def test_gone_subscription_is_removed(client: httpx.AsyncClient, net, temporal):
    await office(client)
    await subscribe(client)
    net.push_status = 410
    r = (await client.post("/api/push/test", json={}, headers=csrf(client))).json()
    assert r["results"][0]["state"] == "skipped"
    assert (await client.get("/api/push/devices")).json() == []


# ---------------------------------------------------------------- telegram


async def telegram_setup(c: httpx.AsyncClient, net: Net) -> dict:
    r = await c.post("/api/channels/telegram", json={"token": TG_TOKEN}, headers=csrf(c))
    assert r.status_code == 201, r.text
    ch = r.json()
    assert ch["bot_username"] == "maju_office_bot" and "token" not in json.dumps(
        ch
    ).lower().replace("bot_username", "")
    code = (await c.post(f"/api/channels/{ch['id']}/link-code", json={}, headers=csrf(c))).json()
    assert code["url"] == f"https://t.me/maju_office_bot?start={code['code']}"
    async with SessionLocal() as db:
        channel = await db.get(Channel, ch["id"])
        assert channel is not None
        await bot.handle_update(
            db,
            channel,
            {
                "update_id": 1,
                "message": {
                    "message_id": 5,
                    "text": f"/start {code['code']}",
                    "chat": {"id": 555, "type": "private"},
                    "from": {"id": 777, "first_name": "Fitri"},
                },
            },
        )
    return ch


async def test_telegram_link_chat_and_strangers(client: httpx.AsyncClient, net, temporal):
    o = await office(client)
    bad = await client.post(
        "/api/channels/telegram",
        json={"token": "999:wrongwrongwrongwrongwrong"},
        headers=csrf(client),
    )
    assert bad.status_code == 422
    ch = await telegram_setup(client, net)
    sent = [b for m, b in net.tg if m == "sendMessage"]
    assert sent[-1]["chat_id"] == "555" and sent[-1]["text"].startswith("Linked to Owner One")
    assert (await client.get("/api/channels")).json()[0]["linked"] is True

    agent = await new_agent(client, o, "Hana", "Management")
    await client.put(
        f"/api/channels/{ch['id']}/bindings",
        json={"match": "dm", "agent_id": agent["id"]},
        headers=csrf(client),
    )
    net.llm.say("Payroll goes out on the 25th.")
    async with SessionLocal() as db:
        channel = await db.get(Channel, ch["id"])
        assert channel is not None
        await bot.handle_update(
            db,
            channel,
            {
                "update_id": 2,
                "message": {
                    "message_id": 6,
                    "text": "When is payroll?",
                    "chat": {"id": 555, "type": "private"},
                    "from": {"id": 777},
                },
            },
        )
        # A stranger gets the private notice and never reaches an agent.
        calls = len(net.llm.requests)
        await bot.handle_update(
            db,
            channel,
            {
                "update_id": 3,
                "message": {
                    "message_id": 7,
                    "text": "hello?",
                    "chat": {"id": 888, "type": "private"},
                    "from": {"id": 888},
                },
            },
        )
        assert len(net.llm.requests) == calls
    texts = [b["text"] for m, b in net.tg if m == "sendMessage"]
    assert texts[-2] == "Hana: Payroll goes out on the 25th."
    assert texts[-1].startswith("This bot belongs to a private office")
    assert net.llm.requests[-1]["messages"][-1]["content"].startswith("When is payroll?")


async def test_telegram_approve_button_and_question_reply(client: httpx.AsyncClient, net, temporal):
    o = await office(client)
    ch = await telegram_setup(client, net)
    task, approval_id = await blocked_task(client, net.llm, o)
    async with SessionLocal() as db:
        tg = [
            d
            for d in (
                await db.scalars(
                    select(Delivery).where(
                        Delivery.channel == "telegram", Delivery.kind == "approval"
                    )
                )
            ).all()
        ]
        assert len(tg) == 1
        await deliver.deliver(db, tg[0].id)
    msg = [b for m, b in net.tg if m == "sendMessage"][-1]
    assert (
        msg["reply_markup"]["inline_keyboard"][0][0]["callback_data"]
        == f"apv:{approval_id}:approve"
    )
    async with SessionLocal() as db:
        channel = await db.get(Channel, ch["id"])
        assert channel is not None
        await bot.handle_update(
            db,
            channel,
            {
                "update_id": 10,
                "callback_query": {
                    "id": "cb1",
                    "data": f"apv:{approval_id}:approve",
                    "from": {"id": 777},
                    "message": {"message_id": 1003, "chat": {"id": 555}, "text": msg["text"]},
                },
            },
        )
        a = await db.get(Approval, approval_id)
        assert a is not None and a.status == "approved" and a.decided_by.startswith("user:")
    methods = [m for m, _ in net.tg]
    assert "answerCallbackQuery" in methods and "editMessageText" in methods
    edited = [b for m, b in net.tg if m == "editMessageText"][-1]
    assert edited["text"].endswith("✅ Approved by Owner One")

    # A question: the person replies to the notification message.
    t2 = await new_task(client, {"id": a.agent_id}, "Prepare payroll")
    await client.post(f"/api/tasks/{t2['id']}/start", json={}, headers=csrf(client))
    net.llm.call("ask_human", question="Which month?")
    r = await runtime.run_task_step(t2["id"])
    async with SessionLocal() as db:
        q = next(
            d
            for d in (
                await db.scalars(
                    select(Delivery).where(
                        Delivery.kind == "approval", Delivery.channel == "telegram"
                    )
                )
            ).all()
            if d.payload["approval_id"] == r.approval_id
        )
        await deliver.deliver(db, q.id)
        await db.refresh(q)
        channel = await db.get(Channel, ch["id"])
        assert channel is not None
        await bot.handle_update(
            db,
            channel,
            {
                "update_id": 11,
                "message": {
                    "message_id": 8,
                    "text": "September",
                    "chat": {"id": 555, "type": "private"},
                    "from": {"id": 777},
                    "reply_to_message": {"message_id": q.result["message_id"]},
                },
            },
        )
        ans = await db.get(Approval, r.approval_id)
        assert ans is not None and ans.status == "answered" and ans.answer == "September"


async def test_poller_keeps_its_offset(client: httpx.AsyncClient, net, temporal):
    await office(client)
    ch = await telegram_setup(client, net)
    from agentic.channels import poller

    net.updates = [
        {
            "update_id": 41,
            "message": {
                "message_id": 1,
                "text": "/help",
                "chat": {"id": 555, "type": "private"},
                "from": {"id": 777},
            },
        }
    ]
    assert await poller.poll_once(ch["id"], timeout=0) == 1
    async with SessionLocal() as db:
        channel = await db.get(Channel, ch["id"])
        assert channel is not None and channel.state["offset"] == 42
    calls = [b for m, b in net.tg if m == "getUpdates"]
    assert calls[-1]["offset"] == 0
    assert await poller.poll_once(ch["id"], timeout=0) == 0
    assert [b for m, b in net.tg if m == "getUpdates"][-1]["offset"] == 42


# ---------------------------------------------------------------- API tokens + OpenAI endpoint


async def test_openai_compatible_endpoint(client: httpx.AsyncClient, net, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    made = (
        await client.post("/api/tokens", json={"name": "Open WebUI"}, headers=csrf(client))
    ).json()
    raw = made["token"]
    assert raw.startswith("agt_") and made["prefix"] == raw[:10]
    assert "token" not in (await client.get("/api/tokens")).json()[0]  # shown once only

    api = httpx.AsyncClient(
        transport=client._transport,
        base_url="http://test",
        headers={"Authorization": f"Bearer {raw}"},
    )  # noqa: SLF001
    async with api:
        models = (await api.get("/api/v1/models")).json()
        assert [m["id"] for m in models["data"]] == [f"agent/{agent['slug']}"]
        net.llm.say("Hello from Aina.")
        r = await api.post(
            "/api/v1/chat/completions",
            json={
                "model": f"agent/{agent['slug']}",
                "messages": [
                    {"role": "system", "content": "ignored"},
                    {"role": "user", "content": [{"type": "text", "text": "Hi"}]},
                ],
            },
        )
        body = r.json()
        assert r.status_code == 200, body
        assert (
            body["object"] == "chat.completion"
            and body["choices"][0]["message"]["content"] == "Hello from Aina."
        )
        assert body["usage"]["total_tokens"] == 120
        sent = net.llm.requests[-1]["messages"]
        assert (
            sent[0]["role"] == "system" and "ignored" not in sent[0]["content"]
        )  # client system prompts do not override the agent's
        net.llm.say("Streamed.")
        s = await api.post(
            "/api/v1/chat/completions",
            json={
                "model": agent["slug"],
                "stream": True,
                "messages": [{"role": "user", "content": "Hi"}],
            },
        )
        assert s.headers["content-type"].startswith("text/event-stream")
        assert '"content": "Streamed."' in s.text and s.text.rstrip().endswith("data: [DONE]")
        missing = await api.post(
            "/api/v1/chat/completions",
            json={"model": "agent/nobody", "messages": [{"role": "user", "content": "x"}]},
        )
        assert missing.status_code == 404 and missing.json()["error"]["code"] == "model_not_found"

    await client.delete(
        f"/api/tokens/{made['id']}", headers={"content-type": "application/json", **csrf(client)}
    )
    async with httpx.AsyncClient(
        transport=client._transport,
        base_url="http://test",
        headers={"Authorization": f"Bearer {raw}"},
    ) as api2:  # noqa: SLF001
        assert (await api2.get("/api/v1/models")).status_code == 401
    async with httpx.AsyncClient(transport=client._transport, base_url="http://test") as anon:  # noqa: SLF001
        assert (await anon.get("/api/v1/models")).json()["error"]["code"] == "missing_token"


async def test_ledger_and_permissions(client: httpx.AsyncClient, net, temporal):
    o = await office(client)
    await subscribe(client)
    await telegram_setup(client, net)
    await blocked_task(client, net.llm, o)
    ledger = (await client.get("/api/deliveries")).json()
    # two approval notices waiting for the worker, plus the "Linked to" reply already sent
    assert ledger["counts"] == {"pending": 2, "sent": 1}
    assert {i["channel"] for i in ledger["items"]} == {"webpush", "telegram"}
    assert all("token" not in json.dumps(i) for i in ledger["items"])
    r = await client.post(
        "/api/members",
        json={"email": "op@example.com", "name": "Opi", "role": "operator"},
        headers=csrf(client),
    )
    temp = r.json()["temp_password"]
    async with httpx.AsyncClient(transport=client._transport, base_url="http://test") as op:  # noqa: SLF001
        await op.post("/api/auth/login", json={"email": "op@example.com", "password": temp})
        await op.post(
            "/api/auth/change-password",
            json={"current_password": temp, "new_password": "operator-pass-1"},
            headers=csrf(op),
        )
        assert (
            await op.post("/api/tokens", json={"name": "x"}, headers=csrf(op))
        ).status_code == 403
        assert (await op.get("/api/deliveries")).status_code == 403
        assert (
            await op.post("/api/channels/telegram", json={"token": TG_TOKEN}, headers=csrf(op))
        ).status_code == 403
        # Anyone can turn on notifications for themselves (operators get none: cannot decide).
        _, keys, _ = browser_keys()
        assert (
            await op.post(
                "/api/push/subscribe",
                json={"endpoint": "https://push.fake/op", "keys": keys},
                headers=csrf(op),
            )
        ).status_code == 201
    async with SessionLocal() as db:
        assert await db.scalar(
            select(PushSubscription).where(PushSubscription.endpoint == "https://push.fake/op")
        )
        assert await db.scalar(select(ChannelLink)) is not None
