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
