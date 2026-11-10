"""P97: the person's language and dialect reach every agent they talk to.

A person with Bahasa Melayu + Kelantan chats with a Chief of Staff (a private assistant), a
team agent and their own AI (twin): each model call carries the Kelantan guide, also when the
person types standard Malay or mixes in English. English speakers are unaffected; a chat may
pick another language for itself; a reused answer (P96) is never one in another language.
"""

from agentic.agents import runtime
from agentic.brain import answers
from agentic.core.db import SessionLocal
from agentic.i18n import dialects
from agentic.i18n import notes as lang_notes
from agentic.models import Task

from .conftest import csrf
from .test_agents import llm, new_agent, new_task, office, temporal  # noqa: F401
from .test_office_roles import as_role
from .test_twins import ANSWERS

KELANTAN = "Speak Kelantan Malay"


def _sent(llm) -> str:  # noqa: F811
    return "\n".join(str(m.get("content")) for m in llm.requests[-1]["messages"])


async def _kelantan(c) -> None:
    r = await c.put(
        "/api/me/prefs",
        json={"locale": {"language": "ms", "speech": "kelantan"}},
        headers=csrf(c),
    )
    assert r.status_code == 200, r.text


async def _chat(c, agent_id: str, message: str, **extra) -> dict:
    r = await c.post(
        f"/api/agents/{agent_id}/chat",
        json={"message": message, **extra},
        headers={**csrf(c), "X-Lang": "ms"},
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_malay_mixed_with_english_is_still_malay():
    # Someone who chose Malay mixes English in all the time; that is still Malay.
    assert dialects.writes_malay("Tolong summarize the report for me", "ms")
    assert dialects.writes_malay("boleh you check the report from yesterday", "ms")
    assert dialects.writes_malay("gapo khabar, demo doh siap?", "ms")
    assert dialects.writes_malay("ok", "ms")
    # A message plainly in English is English.
    assert not dialects.writes_malay("Can you check the sales report from last week?", "ms")
    assert not dialects.writes_malay("Can you check the sales report from last week?", "en")
    assert dialects.writes_malay("Tolong semak invois yang belum bayar", "en")


def test_the_dialect_note_never_says_follow_their_style():
    note = dialects.voice_note("kelantan", "Tolong semak laporan")
    assert "follow theirs" not in note
    assert "even when they write standard Malay" in note
    assert "wins over any general rule" in note


def test_a_voice_for_each_turn():
    v = lang_notes.voice_for("ms", "kelantan", "Tolong semak laporan jualan")
    assert (v.lang, v.style, v.picked) == ("ms", "kelantan", False)
    assert lang_notes.voice_for("ms", None, "Tolong semak").style is None
    assert lang_notes.voice_for("en", None, "Please check").lang == "en"
    # A chat's own pick wins over the setting and over what was typed.
    assert lang_notes.voice_for("ms", "kelantan", "Tolong", "en") == lang_notes.Voice(
        "en", None, True
    )
    assert lang_notes.voice_for("en", None, "Please", "sabah").style == "sabah"
    assert lang_notes.valid_pick("ms") and lang_notes.valid_pick("kedah")
    assert not lang_notes.valid_pick("klingon") and not lang_notes.valid_pick("")
    assert len({lang_notes.voice_for("ms", s, "Tolong semak").key for s in (None, "kelantan")}) == 2


def test_the_reuse_key_holds_the_language():
    m = [{"role": "user", "content": "Bagaimana nak tuntut elaun perjalanan?"}]
    std = lang_notes.Voice("ms", None).key
    kel = lang_notes.Voice("ms", "kelantan").key
    assert answers.key("w", "a", "u1", "smart", m, None, std) != answers.key(
        "w", "a", "u1", "smart", m, None, kel
    )


async def test_kelantan_reaches_chief_of_staff_team_agents_and_my_ai(client, llm, temporal):
    o = await office(client)
    await _kelantan(client)
    cos = (
        await client.post(
            "/api/assistants", json={"preset": "chief_of_staff"}, headers=csrf(client)
        )
    ).json()
    team = await new_agent(client, o, "Aina")
    for agent_id in (cos["id"], team["id"]):
        # Standard Malay typed, and Malay mixed with English: Kelantan back either way.
        for message in ("Tolong semak laporan jualan minggu lepas", "Tolong summarize the report"):
            llm.say("Baik, ambo tengok.")
            await _chat(client, agent_id, message)
            sent = _sent(llm)
            assert KELANTAN in sent, (agent_id, message)
            assert "even when they write standard Malay" in sent
            # The cached system prompt stays the same for everyone.
            assert "Kelantan" not in str(llm.requests[-1]["messages"][0]["content"])
    # Plain English from the same person gets English.
    llm.say("Sure.")
    await _chat(client, team["id"], "Can you check the sales report from last week?")
    assert KELANTAN not in _sent(llm)

    # A staff member with Kelantan set, with their own AI (twin).
    staff = await as_role(
        client,
        "siti@example.com",
        "staff",
        branch_id=o["branch"]["id"],
        department_id=o["depts"]["Finance"],
    )
    try:
        twin = (await staff.post("/api/me/twin", json=ANSWERS, headers=csrf(staff))).json()["twin"]
        await _kelantan(staff)
        llm.say("Baik.")
        await _chat(staff, twin["id"], "Tolong ingatkan saya pasal mesyuarat")
        assert KELANTAN in _sent(llm)
    finally:
        await staff.aclose()


async def test_english_speakers_are_unaffected(client, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    llm.say("Here it is.")
    r = await client.post(
        f"/api/agents/{agent['id']}/chat",
        json={"message": "Please list the unpaid invoices"},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    sent = _sent(llm)
    assert "Speak " not in sent and "reply in the language the person writes in" in sent


async def test_a_chat_can_pick_another_language_mid_conversation(client, llm, temporal):
    o = await office(client)
    await _kelantan(client)
    agent = await new_agent(client, o, "Aina")
    llm.say("Baik.")
    sid = (await _chat(client, agent["id"], "Tolong semak invois"))["session_id"]
    assert KELANTAN in _sent(llm)
    llm.say("Sure.")
    await _chat(client, agent["id"], "Tolong semak invois", session_id=sid, reply_in="en")
    sent = _sent(llm).split("Tolong semak invois")[-1]
    assert "picked English for this conversation" in sent and KELANTAN not in sent
    llm.say("Baik.")
    await _chat(client, agent["id"], "Tolong semak invois", session_id=sid, reply_in="terengganu")
    sent = _sent(llm).split("Tolong semak invois")[-1]
    assert "Speak Terengganu Malay" in sent and KELANTAN not in sent
    llm.say("Baik.")
    await _chat(client, agent["id"], "Tolong semak invois", session_id=sid, reply_in="ms")
    sent = _sent(llm).split("Tolong semak invois")[-1]
    assert "picked standard Malay" in sent and "Speak " not in sent
    # Back to the setting.
    llm.say("Baik.")
    await _chat(client, agent["id"], "Tolong semak invois", session_id=sid)
    assert KELANTAN in _sent(llm).split("Tolong semak invois")[-1]
    bad = await client.post(
        f"/api/agents/{agent['id']}/chat",
        json={"message": "Tolong", "session_id": sid, "reply_in": "klingon"},
        headers=csrf(client),
    )
    assert bad.status_code == 422


async def test_a_standard_malay_answer_is_never_reused_for_kelantan(client, llm, temporal):
    o = await office(client)
    await client.put("/api/me/prefs", json={"locale": {"language": "ms"}}, headers=csrf(client))
    agent = await new_agent(client, o, "Aina")
    q = "Bagaimana cara tuntut elaun perjalanan ke tapak projek?"
    llm.say("Isi borang tuntutan dan lampirkan resit.")
    await _chat(client, agent["id"], q)
    calls = len(llm.requests)
    # The same first question again, same setting: answered from what it said before.
    await _chat(client, agent["id"], q)
    assert len(llm.requests) == calls
    # Kelantan now: asked again, never the standard Malay answer.
    await _kelantan(client)
    llm.say("Demo isi borang tuntute, lampir resit.")
    r = await _chat(client, agent["id"], q)
    assert len(llm.requests) == calls + 1 and KELANTAN in _sent(llm)
    assert r["reply"].startswith("Demo")


async def test_tasks_and_their_delegated_parts_answer_in_the_persons_dialect(client, llm, temporal):
    o = await office(client)
    await _kelantan(client)
    agent = await new_agent(client, o, "Rafi", "Operations")
    task = await new_task(client, agent, "Semak senarai pembekal", "Tolong banding harga")
    async with SessionLocal() as db:
        parent = await db.get(Task, task["id"])
        assert parent is not None
        line = await runtime._language_line(db, parent)
        assert "When you answer the person directly" in line and KELANTAN in line
        child = Task(
            workspace_id=parent.workspace_id,
            title="Banding harga pembekal",
            brief="Senarai harga",
            created_by=f"agent:{agent['id']}",
            parent_task_id=parent.id,
        )
        db.add(child)
        await db.flush()
        assert KELANTAN in await runtime._language_line(db, child)
        await db.rollback()


async def test_a_meeting_speaks_to_the_person_in_their_dialect(client, llm, temporal):
    from agentic.models import Agent
    from agentic.teams import meetings

    o = await office(client)
    await _kelantan(client)
    me = (await client.get("/api/auth/me")).json()
    a1 = await new_agent(client, o, "Aina")
    a2 = await new_agent(client, o, "Rafi", "Operations")
    async with SessionLocal() as db:
        people = [await db.get(Agent, a1["id"]), await db.get(Agent, a2["id"])]
        m = await meetings.create(
            db,
            people[0].workspace_id,  # type: ignore[union-attr]
            "Bajet pemasaran suku depan",
            people,  # type: ignore[arg-type]
            f"user:{me['user']['id']}",
        )
        note = await meetings._person_note(db, m, await meetings.turns(db, m.id))
    assert "write your turn in Bahasa Melayu" in note and KELANTAN in note


async def test_notices_are_written_the_way_the_reader_chose(client, llm, temporal):
    await office(client)
    await _kelantan(client)
    cos = (
        await client.post(
            "/api/assistants", json={"preset": "chief_of_staff"}, headers=csrf(client)
        )
    ).json()
    t = await new_task(client, cos, "Ingatkan saya")
    llm.call(
        "notify_person", person="me", message="Please check the sales report before the meeting"
    ).call("notify_person", person="me", message="Tolong semak laporan jualan sebelum mesyuarat")
    llm.call("notify_person", person="me", message="Tolong semak laporan jualan sebelum mesyuarat")
    llm.say("Siap.")
    await runtime.run_task_step(t["id"])
    async with SessionLocal() as db:
        tool = [m.content for m in await runtime._history(db, task_id=t["id"]) if m.role == "tool"]
    assert tool[0].startswith("Not sent yet") and "Kelantan" in tool[0]  # English to a Malay reader
    assert tool[1].startswith("Not sent yet")  # standard Malay: asked once for Kelantan
    assert not tool[2].startswith("Not sent yet")  # never twice: it goes
