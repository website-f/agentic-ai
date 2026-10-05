"""P22: the server speaks the person's language (English and Bahasa Melayu).

Like apps/web/src/i18n/coverage.test.ts: every tr("…") / Msg("…") / api_error(…, "…") text in
agentic/ needs a Malay entry in agentic/i18n/ms.py, and every {var} must survive.
`I18N_LIST=1 uv run pytest tests/test_i18n.py -k coverage -s` prints what is missing.
"""

import ast
import os
import pathlib
import re

import httpx
from sqlalchemy import select

from agentic.agents import runtime
from agentic.channels import bot, deliver
from agentic.core.db import SessionLocal
from agentic.i18n import MS, Msg, Plain, labels, lookup, render, tr, use_lang, vars_of
from agentic.models import Channel, Delivery, Membership

from .conftest import csrf
from .test_agents import llm, new_agent, new_task, office, temporal  # noqa: F401
from .test_channels import TG_TOKEN, blocked_task, net  # noqa: F401

AGENTIC = pathlib.Path(__file__).resolve().parent.parent / "agentic"
# Owned by other work in progress; their texts get Malay in a follow-up.
NOT_YET: set[str] = set()
MARKERS = {"tr", "Msg", "Plain"}


def _name(f: ast.expr) -> str:
    return f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else ""


def marked_texts() -> tuple[dict[str, str], list[str]]:
    """{English text: where} for every marked literal, and the marks that are not literals
    (f-strings: Malay word order differs, so they must be templates with {vars})."""
    found: dict[str, str] = {}
    dynamic: list[str] = []
    for p in sorted(AGENTIC.rglob("*.py")):
        rel = p.relative_to(AGENTIC).as_posix()
        if rel in NOT_YET or rel.startswith("i18n/ms"):
            continue
        tree = ast.parse(p.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            n = _name(node.func)
            if n in ("tr", "Msg") and node.args:
                arg = node.args[0]
            elif n == "api_error" and len(node.args) >= 3:
                arg = node.args[2]
            else:
                continue
            where = f"{rel}:{node.lineno}"
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                found.setdefault(arg.value, where)
            elif isinstance(arg, ast.JoinedStr):
                dynamic.append(f"{where}: {ast.unparse(arg)[:100]}")
            elif isinstance(arg, ast.IfExp):  # "a" if x else "b"
                for side in (arg.body, arg.orelse):
                    if isinstance(side, ast.Constant) and isinstance(side.value, str):
                        found.setdefault(side.value, where)
                    elif isinstance(side, ast.JoinedStr):
                        dynamic.append(f"{where}: {ast.unparse(side)[:100]}")
    # Words that go into sentences from tables (labels.py), pydantic's messages by type,
    # and the tool labels shown in "Wants to: …".
    from agentic.agents.tools import TOOLS
    from agentic.api.main import PYDANTIC_MESSAGES

    for table in (
        labels.ROLES,
        labels.AGENT_STATUS,
        labels.TASK_STATUS,
        labels.DECISION_STATUS,
        PYDANTIC_MESSAGES,
    ):
        for v in table.values():
            found.setdefault(v, "i18n/labels.py or api/main.py")
    for t in TOOLS.values():
        found.setdefault(t.label, "agents/tools.py (tool label)")
    return found, dynamic


def strip_vars(text: str) -> str:
    return re.sub(r"\{\w+\}", "", text)


# ---------------------------------------------------------------- the dictionary


async def test_coverage_every_marked_text_has_malay():
    found, dynamic = marked_texts()
    missing = {k: w for k, w in found.items() if k not in MS and k.split("|")[0] not in MS}
    missing = {k: w for k, w in missing.items() if any(c.isalpha() for c in strip_vars(k))}
    if os.environ.get("I18N_LIST"):
        for k, w in sorted(missing.items(), key=lambda kv: kv[1]):
            print(f"{w}\t{k!r}")
    assert not dynamic, "f-strings in tr/Msg/api_error:\n" + "\n".join(dynamic)
    assert not missing, f"{len(missing)} texts need Malay, e.g. " + ", ".join(
        repr(k) for k in list(missing)[:10]
    )


async def test_every_var_survives_the_translation():
    broken = [(en, ms) for en, ms in MS.items() if vars_of(en) != vars_of(ms)]
    assert broken == []
    assert all(v.strip() for v in MS.values())


async def test_tr_msg_and_render():
    assert tr("Type an answer.", "en") == "Type an answer."
    assert tr("Type an answer.", "ms") == MS["Type an answer."]
    assert tr("Not translated yet", "ms") == "Not translated yet"
    m = Msg("Linked to {name}. Approvals will arrive here with buttons.", name="Aina")
    assert m == "Linked to Aina. Approvals will arrive here with buttons."  # English in logs
    assert str(ValueError(m)) == m and isinstance(str(ValueError(m)), Msg)
    assert render(m, "ms").startswith("Dipautkan kepada Aina")
    # Names go in as they are, even when they happen to be an English key.
    assert (
        render(
            Msg("{name} is {status}.", name="Done", status=labels.agent_status_label("paused")),
            "ms",
        )
        == "Done sedang dijeda."
    )
    # Plain English built elsewhere is still found through its template; Plain never is.
    assert render("Agent Ali is not here.", "ms") == "Agent Ali is not here."
    built = "Sara needs a decision"
    assert render(built, "ms") == MS["{name} needs a decision"].replace("{name}", "Sara")
    assert render(Plain(built), "ms") == built
    assert render(lookup(built), "ms") == render(built, "ms")
    with use_lang("ms"):
        assert tr("Type an answer.") == MS["Type an answer."]
    assert tr("Type an answer.") == "Type an answer."


# ---------------------------------------------------------------- errors follow the request


async def test_x_lang_header_switches_api_errors(client: httpx.AsyncClient):
    r = await client.get("/api/me/prefs", headers={"x-lang": "ms"})
    assert r.status_code == 401 and r.json()["code"] == "not_authenticated"
    assert r.json()["message"] == MS["Sign in to continue."]
    assert (await client.get("/api/me/prefs")).json()["message"] == "Sign in to continue."

    await office(client)
    r = await client.get("/api/tasks/nope", headers={"x-lang": "ms"})
    assert r.status_code == 404 and r.json()["code"] == "task_not_found"
    assert r.json()["message"] == MS["That task is not here."]
    # Without the header: the person's saved language.
    assert (await client.get("/api/tasks/nope")).json()["message"] == "That task is not here."
    r = await client.put("/api/me/prefs", json={"locale": {"language": "ms"}}, headers=csrf(client))
    assert r.status_code == 200
    assert (await client.get("/api/tasks/nope")).json()["message"] == MS["That task is not here."]
    # The header still wins over the saved language.
    r = await client.get("/api/tasks/nope", headers={"x-lang": "en"})
    assert r.json()["message"] == "That task is not here."

    # English raised in a module that does not mark it (agents/launch.py) is still found.
    t = await client.post("/api/tasks", json={"title": "No agent yet"}, headers=csrf(client))
    assert t.status_code == 201, t.text
    r = await client.post(
        f"/api/tasks/{t.json()['id']}/start", json={}, headers={**csrf(client), "x-lang": "ms"}
    )
    assert r.json()["code"] == "no_assignee"
    assert r.json()["message"] == MS["Assign an agent before starting."]

    # A template with {vars} and a validation message.
    r = await client.post(
        "/api/tasks", json={"title": ""}, headers={**csrf(client), "x-lang": "ms"}
    )
    assert r.status_code == 422 and r.json()["message"] == MS["Some fields need fixing."]
    assert all(v != "" for v in r.json()["fields"].values())


# ---------------------------------------------------------------- notices follow the recipient


async def _telegram(c: httpx.AsyncClient, n) -> dict:  # noqa: ANN001
    r = await c.post("/api/channels/telegram", json={"token": TG_TOKEN}, headers=csrf(c))
    assert r.status_code == 201, r.text
    ch = r.json()
    code = (await c.post(f"/api/channels/{ch['id']}/link-code", json={}, headers=csrf(c))).json()
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


async def test_malay_person_gets_malay_telegram_notices(
    client: httpx.AsyncClient,
    net,  # noqa: F811
    temporal,  # noqa: F811
):
    o = await office(client)
    r = await client.put("/api/me/prefs", json={"locale": {"language": "ms"}}, headers=csrf(client))
    assert r.status_code == 200
    ch = await _telegram(client, net)
    sent = [b for m, b in net.tg if m == "sendMessage"]
    assert sent[-1]["text"].startswith("Dipautkan kepada Owner One")

    # An approval request: title, buttons and the task line in Malay.
    _, approval_id = await blocked_task(client, net.llm, o)
    async with SessionLocal() as db:
        d = (
            await db.scalars(
                select(Delivery).where(Delivery.channel == "telegram", Delivery.kind == "approval")
            )
        ).one()
        await deliver.deliver(db, d.id)
    msg = [b for m, b in net.tg if m == "sendMessage"][-1]
    assert msg["text"].startswith("🔔 " + MS["{name} needs a decision"].replace("{name}", "Rafi"))
    buttons = msg["reply_markup"]["inline_keyboard"][0]
    assert buttons[0]["text"] == "✅ " + MS["Approve"]
    assert buttons[1]["text"] == "✖️ " + MS["Deny"]
    assert "Tugasan: Check the price" in msg["text"]

    # Pressing the button: the answer and the edited message are in Malay too.
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
    edited = [b for m, b in net.tg if m == "editMessageText"][-1]
    assert edited["text"].endswith(MS["✅ Approved by {name}"].replace("{name}", "Owner One"))

    # A plain notice (notify_user) with English built elsewhere: the recipient's language.
    async with SessionLocal() as db:
        m = await db.scalar(select(Membership))
        assert m is not None
        ids = await deliver.notify_user(
            db,
            m.workspace_id,
            m.user_id,
            Msg("Message from {agent}", agent="Rafi"),
            Plain("Payroll is ready."),
            "/tasks",
            dedupe="t1",
        )
        rows = [await db.get(Delivery, i) for i in ids]
    tg = [d for d in rows if d is not None and d.channel == "telegram"]
    assert tg and tg[0].payload["text"].startswith(
        MS["Message from {agent}"].replace("{agent}", "Rafi")
    )
    assert "Payroll is ready." in tg[0].payload["text"]  # what the agent wrote is untouched


async def test_english_person_keeps_english_notices(
    client: httpx.AsyncClient,
    net,  # noqa: F811
    temporal,  # noqa: F811
):
    o = await office(client)
    await _telegram(client, net)
    # Even when the request that caused it was in Malay: the RECIPIENT's language counts.
    agent = await new_agent(client, o, "Rafi", "Research")
    task = await new_task(client, agent, "Check the price")
    await client.post(
        f"/api/tasks/{task['id']}/start", json={}, headers={**csrf(client), "x-lang": "ms"}
    )
    net.llm.call("web_fetch", url="https://good.fake/page", why="Need today's price")
    r = await runtime.run_task_step(task["id"])
    assert r.state == "needs_approval"
    async with SessionLocal() as db:
        d = (
            await db.scalars(
                select(Delivery).where(Delivery.channel == "telegram", Delivery.kind == "approval")
            )
        ).one()
    assert d.payload["text"].startswith("🔔 Rafi needs a decision")
    assert d.payload["buttons"][0][0]["text"] == "✅ Approve"


# ---------------------------------------------------------------- agents answer in the language


async def test_chat_language_note_rides_on_the_turn(
    client: httpx.AsyncClient,
    llm,  # noqa: F811
    temporal,  # noqa: F811
):
    o = await office(client)
    agent = await new_agent(client, o, "Hana", "Management")
    llm.say("Gaji dibayar pada 25hb.").say("Sama-sama.")
    r = await client.post(
        f"/api/agents/{agent['id']}/chat",
        json={"message": "Bila gaji?"},
        headers={**csrf(client), "x-lang": "ms"},
    )
    assert r.status_code == 200, r.text
    sent = llm.requests[-1]["messages"]
    assert "Bahasa Melayu" not in sent[0]["content"]  # never the cached system prompt
    assert sent[-1]["role"] == "user" and sent[-1]["content"].startswith("Bila gaji?")
    assert "reply in the language the person writes in" in sent[-1]["content"]
    assert "Bahasa Melayu" in sent[-1]["content"]
    r = await client.post(
        f"/api/agents/{agent['id']}/chat",
        json={"message": "Terima kasih", "session_id": r.json()["session_id"]},
        headers={**csrf(client), "x-lang": "ms"},
    )
    sent = llm.requests[-1]["messages"]
    users = [m for m in sent if m["role"] == "user"]
    # Only the current turn carries it; the earlier turn went back to what was stored.
    assert "Language:" not in users[0]["content"] and "Language:" in users[-1]["content"]
    assert "Bahasa Melayu" not in sent[0]["content"]


async def test_first_task_message_asks_for_the_creators_language(
    client: httpx.AsyncClient,
    llm,  # noqa: F811
    temporal,  # noqa: F811
):
    o = await office(client)
    await client.put("/api/me/prefs", json={"locale": {"language": "ms"}}, headers=csrf(client))
    agent = await new_agent(client, o, "Rafi", "Research")
    task = await new_task(client, agent, "Banding pembekal")
    await client.post(f"/api/tasks/{task['id']}/start", json={}, headers=csrf(client))
    llm.say("Siap.")
    await runtime.run_task_step(task["id"])
    sent = llm.requests[-1]["messages"]
    assert "Bahasa Melayu" not in sent[0]["content"]  # the system prompt stays the same
    first = sent[1]["content"]
    assert first.startswith("Task: Banding pembekal")
    assert "Language: write your final answer and any report in the language the brief" in first
    assert "use Bahasa Melayu" in first  # the asker's language when the brief is unclear
    assert sum("Language: write your final" in str(m.get("content") or "") for m in sent) == 1
