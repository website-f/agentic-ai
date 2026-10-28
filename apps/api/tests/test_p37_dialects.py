"""P37: agents speak casual Malay or a state's dialect to the people who want it."""

from agentic.i18n import dialects

from .conftest import csrf
from .test_agents import llm, new_agent, office, temporal  # noqa: F401


def test_every_style_has_a_pack_and_a_guide():
    assert set(dialects.STYLES) == {
        "pasar",
        "kelantan",
        "terengganu",
        "kedah",
        "perak",
        "pahang",
        "negeri_sembilan",
        "melaka",
        "johor",
        "sabah",
        "sarawak",
    }
    for code, s in dialects.STYLES.items():
        p = dialects.pack(code)
        assert p["pairs"], code  # real sentences in the dialect with their standard Malay
        if code != "pasar":
            assert len(p["lexicon"]) >= 80, code
        assert s.guide and dialects.voice_note(code, "tolong semak invois")


def test_the_note_fits_the_conversation_and_stays_fit_for_work():
    note = dialects.voice_note("kelantan", "Berapa duit yang belum dibayar?")
    assert note.startswith("(Speak Kelantan Malay") and "pitih" in note  # duit -> pitih
    assert "standard Malay" in note  # documents stay standard
    for code in dialects.STYLES:
        n = dialects.voice_note(code, "tolong")
        for rude in ("seluar dalam", "= bodoh", "= gila"):
            assert rude not in n, (code, rude)


def test_dialect_words_the_person_types_are_explained():
    g = dialects.gloss("kelantan", "Demo, bakpo pitih takdok lagi?")
    assert "demo = " in g and "bakpo = kenapa" in g and "pitih = " in g
    assert dialects.gloss("kelantan", "Please check the invoice") == ""
    assert dialects.gloss(None, "demo bakpo") == ""
    assert "kamek" in dialects.gloss("sarawak", "Kamek sik tau") or "sik" in dialects.gloss(
        "sarawak", "Kamek sik tau"
    )


async def test_my_ai_speaks_my_dialect(client, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    bad = await client.put(
        "/api/me/prefs", json={"locale": {"speech": "klingon"}}, headers=csrf(client)
    )
    assert bad.status_code == 422
    r = await client.put(
        "/api/me/prefs", json={"locale": {"speech": "sabah"}}, headers=csrf(client)
    )
    assert r.status_code == 200 and r.json()["locale"]["speech"] == "sabah"
    llm.say("Bah, sia tingu dulu ah.")
    r = await client.post(
        f"/api/agents/{agent['id']}/chat",
        json={"message": "Tolong tengok laporan jualan minggu lepas"},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    sent = "\n".join(str(m.get("content")) for m in llm.requests[-1]["messages"])
    assert "Speak Sabah Malay" in sent and "tingu = tengok" in sent
    # The system prompt (the cached prefix) is the same for everyone.
    assert "Sabah" not in str(llm.requests[-1]["messages"][0]["content"])
    # Back to standard: no dialect note.
    await client.put("/api/me/prefs", json={"locale": {"speech": "standard"}}, headers=csrf(client))
    assert (await client.get("/api/me/prefs")).json()["locale"].get("speech") is None
    llm.say("Baik.")
    await client.post(
        f"/api/agents/{agent['id']}/chat", json={"message": "Terima kasih"}, headers=csrf(client)
    )
    sent = "\n".join(str(m.get("content")) for m in llm.requests[-1]["messages"])
    assert "Speak Sabah" not in sent
    assert "even if earlier replies in this conversation used a dialect" in sent


async def test_writing_in_english_gets_english_whatever_the_dialect(client, llm, temporal):
    """A person with Sabah set who switches the app to English and writes English gets
    plain English back, not Sabah (the dialect is for when they write Malay)."""
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    await client.put("/api/me/prefs", json={"locale": {"speech": "sabah"}}, headers=csrf(client))
    await client.put("/api/me/prefs", json={"locale": {"language": "en"}}, headers=csrf(client))
    llm.say("Sure, here it is.")
    r = await client.post(
        f"/api/agents/{agent['id']}/chat",
        json={"message": "Can you check the sales report from last week?"},
        headers={**csrf(client), "X-Lang": "en"},
    )
    assert r.status_code == 200, r.text
    sent = "\n".join(str(m.get("content")) for m in llm.requests[-1]["messages"])
    assert "Speak Sabah" not in sent and "even if earlier replies" in sent
    # Writing Malay again brings the dialect back.
    llm.say("Bah, ok.")
    await client.post(
        f"/api/agents/{agent['id']}/chat",
        json={"message": "Tolong semak invois yang belum bayar"},
        headers={**csrf(client), "X-Lang": "en"},
    )
    sent = "\n".join(str(m.get("content")) for m in llm.requests[-1]["messages"])
    assert "Speak Sabah Malay" in sent


def test_how_to_speak_is_a_setting_never_a_memory():
    from agentic.brain import core

    assert dialects.about_speech("Fitri prefers replies in Sabah dialect (bah, sia, nda).")
    assert dialects.about_speech("Ahmad suka bercakap loghat Kelantan")
    # Facts that merely mention a place or a language are kept.
    assert not dialects.about_speech("Customer ABC Sdn Bhd is based in Sabah, pays in 60 days.")
    assert not dialects.about_speech("Invoices to LHDN use standard Malay.")
    assert core.refused(["Always speak to Fitri in Sabahan slang"])
    assert core.refused(["Fitri's company is in Kota Kinabalu, Sabah"]) is None


async def test_a_chat_answer_shows_what_it_remembered(client, llm, temporal):
    """The answer keeps which facts it recalled (shown under it, with "Not right"), a short
    follow-up still recalls what the conversation is about, and a dialect note left in
    memory never reaches the prompt."""
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    fact = (
        await client.post(
            "/api/brain/facts",
            json={"text": "Maju Trading invoices on net-45 terms."},
            headers=csrf(client),
        )
    ).json()
    llm.say("Maju Trading pays in 45 days.")
    r = await client.post(
        f"/api/agents/{agent['id']}/chat",
        json={"message": "What payment terms does Maju Trading have with us?"},
        headers=csrf(client),
    )
    sid = r.json()["session_id"]
    msgs = (await client.get(f"/api/chat/sessions/{sid}/messages")).json()
    recalled = msgs[-1]["meta"]["recalled"]
    assert recalled[0] == {"kind": "fact", "id": fact["id"], "text": fact["text"]}
    # A follow-up that names nothing still finds it, through the message before it.
    llm.say("Yes.")
    await client.post(
        f"/api/agents/{agent['id']}/chat",
        json={"message": "and is that net?", "session_id": sid},
        headers=csrf(client),
    )
    msgs = (await client.get(f"/api/chat/sessions/{sid}/messages")).json()
    assert msgs[-1]["meta"]["recalled"][0]["id"] == fact["id"]
    # "Not right" ends it: the next answer does not lean on it.
    await client.post(f"/api/brain/facts/{fact['id']}/forget", json={}, headers=csrf(client))
    llm.say("I am not sure.")
    await client.post(
        f"/api/agents/{agent['id']}/chat",
        json={"message": "What payment terms does Maju Trading have with us?"},
        headers=csrf(client),
    )
    sent = "\n".join(str(m.get("content")) for m in llm.requests[-1]["messages"])
    assert "net-45" not in sent.split("What payment terms")[-1]


async def test_old_dialect_notes_in_core_memory_never_reach_the_prompt(client, llm, temporal):
    from agentic.agents.prompt import system_prompt
    from agentic.core.db import SessionLocal
    from agentic.models import Agent

    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    async with SessionLocal() as db:
        a = await db.get(Agent, agent["id"])
        snap = (
            "About the people you work for:\n- Always speak to Fitri in Sabah dialect\n"
            "- Fitri runs the Kota Kinabalu office"
        )
        p = await system_prompt(db, a, "chat", snap)
    assert "Sabah dialect" not in p and "Kota Kinabalu office" in p
