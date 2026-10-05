"""Speaker separation for meeting minutes (P23): linking window speakers into one meeting,
aligning turns with the transcript, the writer's speaker prompts, name suggestions, the
upload -> separate -> transcribe -> write pipeline with fake windows, naming speakers, the
clip endpoint, "Rewrite with names", the fallbacks, and (when the models are installed)
diarization of a small synthetic three-voice recording."""

import json
import pathlib
import wave

import numpy as np
import pytest

from agentic.core.db import SessionLocal
from agentic.minutes import audio, diarize, service, transcript, writer
from agentic.models import MeetingRecording

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_meeting_minutes import (  # noqa: F401
    MINUTES,
    THREE_CHUNKS,
    ff,
    load,
    net,
    speech,
    started,
    upload,
    wipe_chunks,
)

FIXTURES = pathlib.Path(__file__).parent / "fixtures" / "minutes"


def _voice(seed: int) -> list[float]:
    v = np.random.default_rng(seed).normal(size=192)
    return list(v / np.linalg.norm(v))


VA, VB, VC = _voice(1), _voice(2), _voice(3)


def _near(v: list[float], seed: int, noise: float = 0.15) -> list[float]:
    x = np.asarray(v) + np.random.default_rng(seed).normal(scale=noise / 14, size=192)
    return list(x / np.linalg.norm(x))


# ---------------------------------------------------------------- pure parts


def test_windows_cover_the_recording():
    assert diarize.plan_windows(0) == []
    assert diarize.plan_windows(30) == [(0.0, 30.0)]
    assert diarize.plan_windows(650) == [(0.0, 650.0)]  # a short tail joins the window
    assert diarize.plan_windows(1200) == [(0.0, 600.0), (600.0, 600.0)]
    w = diarize.plan_windows(3600 * 4)
    assert len(w) == 24 and w[-1][0] + w[-1][1] == pytest.approx(3600 * 4)


def test_link_joins_the_same_voice_across_windows():
    windows = [
        (
            0.0,
            {
                "segments": [[0, 100, "0"], [100, 250, "1"], [250, 300, "0"]],
                "speakers": {"0": {"embedding": VA}, "1": {"embedding": VB}},
            },
        ),
        (
            600.0,
            {
                # local numbering differs per window; the voices are the same people
                "segments": [[0, 50, "0"], [60, 200, "1"], [200, 201, "2"]],
                "speakers": {
                    "0": {"embedding": _near(VB, 7)},
                    "1": {"embedding": _near(VA, 8)},
                    "2": {"embedding": VC},  # one second: noise, not a person
                },
            },
        ),
    ]
    turns = diarize.link(windows)
    assert [t[2] for t in turns] == ["S1", "S2", "S1", "S2", "S1"]
    assert turns[3][:2] == [600.0, 650.0]  # on the recording's clock
    assert diarize.talk_time(turns) == {"S1": 290.0, "S2": 200.0}
    # Told "two people", the same; told "three", the window split of A/B is kept and a
    # same-window pair never merges.
    assert {t[2] for t in diarize.link(windows, num_speakers=2)} == {"S1", "S2"}
    one = [(0.0, {"segments": [[0, 300, "0"]], "speakers": {"0": {"embedding": VA}}})]
    assert diarize.link(one) == []  # one voice: no labels at all
    assert diarize.link([]) == []


def test_link_never_merges_two_voices_of_one_window():
    w = [
        (
            0.0,
            {
                "segments": [[0, 10, "0"], [10, 20, "1"]],
                "speakers": {"0": {"embedding": VA}, "1": {"embedding": _near(VA, 3, 0.01)}},
            },
        )
    ]
    assert {t[2] for t in diarize.link(w, num_speakers=0, threshold=1.5)} == {"S1", "S2"}


def test_clip_is_a_stretch_of_one_voice():
    turns = [[0.0, 4.0, "S1"], [4.0, 30.0, "S2"], [20.0, 22.0, "S1"], [31.0, 31.5, "S3"]]
    assert diarize.clip_for(turns, "S2") == [4.2, 10.0]  # cut before S1 talks over it
    assert diarize.clip_for(turns, "S1") == [0.2, 3.8]
    assert diarize.clip_for(turns, "S3") is None  # half a second is not enough
    paused = [[0.0, 3.0, "S1"], [4.0, 8.0, "S1"], [8.5, 9.0, "S2"]]
    assert diarize.clip_for(paused, "S1") == [0.2, 7.8]  # over a short pause of their own


def test_alignment_labels_and_splits_segments():
    turns = [[0.0, 10.0, "S1"], [10.0, 20.0, "S2"], [20.0, 60.0, "S1"]]
    segs = [
        {"t": 0.5, "e": 8.0, "text": "Good morning everyone."},
        # spans the change at 10 s: cut at the sentence end nearest to it
        {"t": 8.0, "e": 14.0, "text": "Let us begin. Thanks, Aisyah, the budget is fine."},
        {"t": 14.5, "e": 19.0, "text": "Ok."},
        {"t": 61.0, "e": 62.0, "text": "Bye."},  # no turn here: the nearest voice (if close)
    ]
    out = transcript.label(segs, turns)
    assert [(s["s"], s["text"]) for s in out] == [
        ("S1", "Good morning everyone."),
        ("S1", "Let us begin."),
        ("S2", "Thanks, Aisyah, the budget is fine."),
        ("S2", "Ok."),
        ("S1", "Bye."),
    ]
    assert out[2]["t"] == pytest.approx(10.0)
    paras = transcript.paragraphs(out)
    assert [p["s"] for p in paras] == ["S1", "S2", "S1"]  # a new voice, a new paragraph
    names = {"S1": {"name": "Aisyah"}, "S2": {"name": ""}}
    text = transcript.as_text(paras, names)
    assert text.splitlines()[0] == "[0:00] Aisyah: Good morning everyone. Let us begin."
    assert "[0:10] Speaker 2: Thanks" in text
    assert "Penutur 2:" in transcript.as_text(paras, names, "ms")
    # Without turns nothing changes, and no paragraph carries a speaker.
    plain = transcript.stitch(audio.plan_chunks(1200.0), {"0": {"segments": THREE_CHUNKS[0]}})
    assert plain and all("s" not in p for p in plain)


def test_a_block_with_no_inner_times_is_spread_over_speech():
    turns = [[0.0, 40.0, "S1"], [41.0, 100.0, "S2"]]
    block = {
        "t": 0.0,
        "e": 100.0,
        "text": "This is the first person talking for a while about the budget. "
        "Now the second person answers with a much longer reply about suppliers and the "
        "quotation and the dates for Friday.",
    }
    out = transcript.label([block], turns)
    assert [s["s"] for s in out] == ["S1", "S2"]
    assert out[1]["text"].startswith("Now the second person")


def test_writer_prompts_and_markdown_with_speakers():
    assert "there are no speaker labels" in writer.system_prompt("en")
    sp = writer.system_prompt("en", "Aisyah", speakers=True)
    assert "Speaker N" in sp and "never guess a name" in sp and "no speaker labels" not in sp
    assert "who said them" in writer.map_system("en", speakers=True)
    assert "never put a name on a 'Speaker N'" in writer.reduce_system("ms", speakers=True)
    m = writer.parse(json.dumps(MINUTES))
    assert m is not None
    md = writer.markdown(m, language="en", recording="x", date_fallback="", speakers=True)
    assert "told apart by their voices" in md and "as heard in the conversation" not in md
    ms = writer.markdown(m, language="ms", recording="x", date_fallback="", speakers=True)
    assert "dibezakan mengikut suara" in ms


def test_name_suggestions_are_checked_against_the_meeting():
    heard = "Thanks, Aisyah. Saya Rafi dari kewangan. Encik Rahman agreed."
    raw = json.dumps(
        {
            "speakers": [
                {"label": "S1", "name": "Aisyah", "evidence": "[0:05] Thanks, Aisyah"},
                {"label": "S2", "name": "Zorro"},  # never said: made up
                {"label": "S9", "name": "Rafi"},  # no such voice
                {"label": "S3", "name": "aisyah"},  # one voice per name
                {"label": "S4", "name": "Encik Rahman"},
            ]
        }
    )
    got = writer.parse_names(raw, {"S1", "S2", "S3", "S4"}, heard)
    assert got == {
        "S1": {"name": "Aisyah", "evidence": "[0:05] Thanks, Aisyah"},
        "S4": {"name": "Encik Rahman", "evidence": ""},
    }
    assert writer.parse_names("not json", {"S1"}, heard) == {}
    paras = [
        {"t": 3, "e": 5, "text": "Saya Rafi dari kewangan.", "s": "S2"},
        {"t": 6, "e": 9, "text": "Saya rasa ok. I'm Sorry about that.", "s": "S3"},
        {"t": 9, "e": 12, "text": "Hello, my name is Wei Ling from sales.", "s": "S4"},
    ]
    intro = writer.introductions(paras, ["Rafi Ahmad", "Aisyah Rahman"])
    assert intro["S2"]["name"] == "Rafi Ahmad" and "Saya Rafi" in intro["S2"]["evidence"]
    assert "S3" not in intro  # "Saya rasa" / "I'm Sorry" are not names
    assert intro["S4"]["name"] == "Wei Ling"


# ---------------------------------------------------------------- the pipeline


def _windows(*, fail: bool = False, one_voice: bool = False):
    """Fake run_window: A 0-300 s, B 300-700 s, C 700-1200 s over two 10-minute windows."""
    calls: list[tuple] = []

    async def run_window(path, start, length, speakers=0, beat=None):
        calls.append((start, length, speakers))
        if fail:
            raise diarize.SpeakerError("the models crashed")
        if one_voice:
            return {"segments": [[0, length, "0"]], "speakers": {"0": {"embedding": VA}}}
        if start == 0:
            return {
                "segments": [[0, 300, "0"], [300, 600, "1"]],
                "speakers": {"0": {"embedding": VA}, "1": {"embedding": VB}},
            }
        return {
            "segments": [[0, 100, "0"], [100, 600, "1"]],
            "speakers": {"0": {"embedding": _near(VB, 5)}, "1": {"embedding": VC}},
        }

    return calls, run_window


async def _run(rec_id: str) -> dict:
    """What the worker does: prepare (+ separate speakers), every chunk, write."""
    async with SessionLocal() as db:
        info = await service.prepare(db, rec_id)
        if info.get("windows"):
            await service.separate_speakers(db, rec_id)
    for i in range(info.get("chunks") or 0):
        async with SessionLocal() as db:
            assert await service.transcribe_chunk(db, rec_id, i) == {"done": True}
    async with SessionLocal() as db:
        return await service.write(db, rec_id)


async def test_speakers_from_upload_to_named_minutes(
    client,
    net,  # noqa: F811
    ff,  # noqa: F811
    started,  # noqa: F811
    llm,  # noqa: F811
    monkeypatch,
):
    o = await office(client)
    await speech(client, o)
    calls, fake = _windows()
    monkeypatch.setattr(diarize, "available", lambda: True)
    monkeypatch.setattr(diarize, "run_window", fake)
    r = await upload(client, speaker_count=3)
    assert r.status_code == 201, r.text
    rec = r.json()
    assert rec["separate_speakers"] and rec["speaker_count"] == 0

    # Progress while separating: the recording stays "extracting" with windows to do.
    async with SessionLocal() as db:
        info = await service.prepare(db, rec["id"])
    assert info == {"chunks": 3, "windows": 2}
    d = (await client.get(f"/api/minutes/{rec['id']}")).json()
    assert d["status"] == "extracting" and (d["speakers_done"], d["speakers_total"]) == (0, 2)

    net.chunks = [list(c) for c in THREE_CHUNKS]
    llm.say(
        json.dumps(
            {
                "speakers": [
                    {"label": "S2", "name": "Aisyah", "evidence": "[6:43] Aisyah will send"},
                    {"label": "S3", "name": "Zorro"},
                ]
            }
        )
    )
    llm.say(json.dumps({**MINUTES, "attendees": ["Encik Rahman", "Speaker 1"]}))
    assert await _run(rec["id"]) == {"done": True}
    # Several windows: each is told apart freely, the count applies when linking.
    assert calls == [(0.0, 600.0, 0), (600.0, 600.0, 0)]

    done = await load(rec["id"])
    assert done.status == "ready"
    assert [p.get("s") for p in done.transcript] == ["S1", "S2", "S3"]
    assert "Aisyah will send" in done.transcript[1]["text"]
    assert set(done.speakers) == {"S1", "S2", "S3"}
    assert done.speakers["S1"]["seconds"] == 300.0 and done.speakers["S3"]["seconds"] == 500.0
    assert done.speakers["S2"]["suggested"] == "Aisyah"  # "Zorro" was never said
    assert "suggested" not in done.speakers["S3"]
    assert done.speakers["S1"]["clip"] == [0.2, 10.0]
    assert done.work == {"diarize": {"on": True, "count": 3}}  # scratch gone, choice kept
    # The writer read who said what, under the speaker rules.
    names_req, minutes_req = llm.requests[-2], llm.requests[-1]
    assert "match the voices" in names_req["messages"][0]["content"]
    assert (
        "Speaker 2: Budget is RM 12,500. Aisyah will send" in minutes_req["messages"][1]["content"]
    )
    assert "never guess a name" in minutes_req["messages"][0]["content"]
    assert done.minutes["speaker_names"] == {"S1": "", "S2": "", "S3": ""}
    assert done.minutes["attendees"] == ["Encik Rahman"]  # labels are not attendees

    d = (await client.get(f"/api/minutes/{rec['id']}")).json()
    assert d["speaker_count"] == 3 and not d["speakers_stale"]
    s2 = next(s for s in d["speakers"] if s["label"] == "S2")
    assert (
        s2["suggested"] == "Aisyah"
        and s2["has_clip"]
        and s2["share"] == pytest.approx(1 / 3, abs=1e-3)
    )
    assert "told apart by their voices" in d["markdown"]

    # A clip of each voice, from the kept audio.
    r = await client.get(f"/api/minutes/{rec['id']}/speakers/S2/clip")
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg"
    assert ff["cuts"][-1] == (300.2, 10.0)
    assert (await client.get(f"/api/minutes/{rec['id']}/speakers/S7/clip")).status_code == 404
    assert (await client.get(f"/api/minutes/{rec['id']}/speakers/x/clip")).status_code == 422

    # Name them: the minutes are now out of date until rewritten with the names.
    r = await client.put(
        f"/api/minutes/{rec['id']}/speakers",
        json={"names": {"S1": "Encik Rahman", "S2": "  Aisyah "}},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["speakers_stale"]
    assert [s["name"] for s in d["speakers"]] == ["Encik Rahman", "Aisyah", ""]
    bad = await client.put(
        f"/api/minutes/{rec['id']}/speakers", json={"names": {"S9": "X"}}, headers=csrf(client)
    )
    assert bad.status_code == 400 and bad.json()["code"] == "no_such_speaker"

    r = await client.post(
        f"/api/minutes/{rec['id']}/rewrite", json={"language": "en"}, headers=csrf(client)
    )
    assert r.status_code == 200 and r.json()["status"] == "queued"
    llm.say(json.dumps({**MINUTES, "attendees": ["Encik Rahman"]}))
    assert await _run(rec["id"]) == {"done": True}
    assert len(calls) == 2 and len(net.heard) == 3  # nothing heard or separated again
    assert (
        "] Aisyah: Budget is RM 12,500. Aisyah will" in llm.requests[-1]["messages"][1]["content"]
    )
    d = (await client.get(f"/api/minutes/{rec['id']}")).json()
    assert not d["speakers_stale"] and d["document_version"] >= 2
    assert d["minutes"]["attendees"] == ["Encik Rahman", "Aisyah"]

    # Audio gone: no clips.
    r = await client.request(
        "DELETE", f"/api/minutes/{rec['id']}/audio", json={}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text
    assert not any(s["has_clip"] for s in r.json()["speakers"])
    assert (await client.get(f"/api/minutes/{rec['id']}/speakers/S1/clip")).status_code == 404


@pytest.mark.parametrize("case", ["off", "failed", "one_voice", "no_models"])
async def test_minutes_work_as_before_without_speakers(
    client,
    net,  # noqa: F811
    ff,  # noqa: F811
    started,  # noqa: F811
    llm,  # noqa: F811
    monkeypatch,
    case,
):
    o = await office(client)
    await speech(client, o)
    calls, fake = _windows(fail=case == "failed", one_voice=case == "one_voice")
    monkeypatch.setattr(diarize, "available", lambda: case != "no_models")
    monkeypatch.setattr(diarize, "run_window", fake)
    rec = (await upload(client, speakers="false" if case == "off" else "true")).json()
    assert rec["separate_speakers"] == (case != "off")
    net.chunks = [list(c) for c in THREE_CHUNKS]
    llm.say(json.dumps(MINUTES))  # no names call: the minutes call comes first
    assert await _run(rec["id"]) == {"done": True}
    assert len(calls) == {"off": 0, "failed": 1, "one_voice": 2, "no_models": 0}[case]
    done = await load(rec["id"])
    assert done.status == "ready" and done.speakers == {}
    assert all("s" not in p for p in done.transcript)
    assert "no speaker labels" in llm.requests[-1]["messages"][0]["content"]
    d = (await client.get(f"/api/minutes/{rec['id']}")).json()
    assert d["speakers"] == [] and d["speaker_count"] == 0 and not d["speakers_stale"]
    assert "as heard in the conversation" in d["markdown"]
    r = await client.put(
        f"/api/minutes/{rec['id']}/speakers", json={"names": {"S1": "A"}}, headers=csrf(client)
    )
    assert r.status_code == 409


async def test_a_retry_carries_on_at_the_next_window(
    client,
    net,  # noqa: F811
    ff,  # noqa: F811
    started,  # noqa: F811
    monkeypatch,
):
    o = await office(client)
    await speech(client, o)
    calls, fake = _windows()
    monkeypatch.setattr(diarize, "available", lambda: True)
    monkeypatch.setattr(diarize, "run_window", fake)
    rec = (await upload(client)).json()
    async with SessionLocal() as db:
        await service.prepare(db, rec["id"])
        assert await service.diarize_window(db, rec["id"], 0) == {"done": True}
    async with SessionLocal() as db:  # the worker restarted: prepare runs again
        info = await service.prepare(db, rec["id"])
        assert info["windows"] == 2
        await service.separate_speakers(db, rec["id"])
    assert [c[0] for c in calls] == [0.0, 600.0]
    async with SessionLocal() as db:
        r = await db.get(MeetingRecording, rec["id"])
        assert r is not None and r.status == "transcribing"
        assert len(service.speaker_turns(r)) == 3


# ---------------------------------------------------------------- real models


def _fixture_samples() -> np.ndarray:
    """The committed fixture (8 kHz 8-bit, to stay small) back at 16 kHz float."""
    with wave.open(str(FIXTURES / "three-voices-8k.wav")) as w:
        lo = (np.frombuffer(w.readframes(w.getnframes()), np.uint8).astype(np.float32) - 128) / 127
    return np.interp(np.arange(len(lo) * 2) / 2, np.arange(len(lo)), lo).astype(np.float32)


@pytest.mark.skipif(
    not diarize.available(),
    reason="speaker models not installed (they are baked into the image; set "
    "AGENTIC_SPEAKER_MODELS to run here)",
)
def test_real_diarization_of_three_synthetic_voices():
    ref = json.loads((FIXTURES / "three-voices-8k.json").read_text())["turns"]
    res = diarize.separate(_fixture_samples())
    turns = diarize.link([(0.0, res)])
    assert len({t[2] for t in turns}) == 3
    # Each scripted turn is mostly heard as one voice, and the three voices differ.
    heard: dict[str, str] = {}
    for a, b, who in ref:
        talk: dict[str, float] = {}
        for ta, tb, s in turns:
            talk[s] = talk.get(s, 0.0) + max(0.0, min(b, tb) - max(a, ta))
        best = max(talk, key=lambda k: talk[k])
        assert talk[best] >= 0.7 * sum(talk.values()), (a, b, talk)
        assert heard.setdefault(who, best) == best
    assert len(set(heard.values())) == 3
