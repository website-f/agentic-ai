"""P24 follow-ups: one handbook, many procedures (outline, per-section suggestions, focused
builds), outside systems are a person's work, and only real approvals are approvals.

Synthetic documents only; the model is scripted."""

import json

from agentic.core.db import SessionLocal
from agentic.intake import builders
from agentic.models import IntakeBatch

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_builders import SOP_REPLY, add_batch, add_file, ws_of

HANDBOOK = """SOP PENGURUSAN OPERASI CAWANGAN
[page 1]
KANDUNGAN
1. WANG PENDAHULUAN (ADVANCE) GAJI ........ 2
2. SURAT AMARAN DAN TINDAKAN DISIPLIN ........ 3
3. PERMOHONAN UNIFORM DAN PERALATAN ........ 4
[page 2]
1. WANG PENDAHULUAN (ADVANCE) GAJI
Objektif: memastikan setiap bayaran advance tepat mengikut hari bekerja.
Kelayakan ikut hari bekerja 1hb hingga 15hb:
| Hari bekerja | Kelayakan |
|---|---|
| 10 hingga 15 hari | RM700.00 |
| 7 hingga 9 hari | RM500.00 |
1. Pegawai Operasi menyemak laporan kehadiran 1hb hingga 15hb.
2. Pegawai Operasi execute Advanced Payment Closing selewat-lewatnya 16hb.
3. Bayaran dibuat kepada pekerja yang layak pada 20hb.
[page 3]
2. SURAT AMARAN DAN TINDAKAN DISIPLIN
1. Penyelia menghantar laporan kesalahan kepada HR dalam tempoh 24 jam.
2. HR menyemak rekod disiplin terdahulu dan bukti kesalahan.
3. Pengurus meluluskan surat amaran pertama, kedua atau ketiga.
4. Surat amaran ketiga membawa kepada penamatan perkhidmatan.
[page 4]
3. PERMOHONAN UNIFORM DAN PERALATAN
1. Pengawal mengisi borang permohonan uniform (BU-02) dengan saiz dan kuantiti.
2. Pegawai Ronda menyemak keperluan sebenar di pos kawalan.
3. Pegawai Operasi meluluskan Purchase Order kepada Inventory.
4. Barang dihantar ke cawangan dalam tempoh 5 hari bekerja.
"""

SECTIONS = [
    "1. WANG PENDAHULUAN (ADVANCE) GAJI",
    "2. SURAT AMARAN DAN TINDAKAN DISIPLIN",
    "3. PERMOHONAN UNIFORM DAN PERALATAN",
]


# ---------------------------------------------------------------- outline and sections


def test_the_outline_shows_the_sections_not_the_steps():
    rows = builders.outline(HANDBOOK)
    assert "p.2 1. WANG PENDAHULUAN (ADVANCE) GAJI" in rows
    assert "p.3 2. SURAT AMARAN DAN TINDAKAN DISIPLIN" in rows
    assert "p.4 3. PERMOHONAN UNIFORM DAN PERALATAN" in rows
    assert not any("........" in r for r in rows)  # table of contents rows left out
    assert not any("Pegawai Operasi" in r or "RM700" in r for r in rows)  # steps are not


def test_a_focus_finds_its_section_and_skips_the_contents_page():
    sec = builders.find_section(HANDBOOK, "Surat amaran dan tindakan disiplin")
    assert sec is not None and sec.startswith("2. SURAT AMARAN DAN TINDAKAN DISIPLIN")
    assert "24 jam" in sec and "penamatan perkhidmatan" in sec
    assert "RM700" not in sec and "BU-02" not in sec
    adv = builders.find_section(HANDBOOK, "Wang pendahuluan (advance) gaji pengawal")
    assert adv is not None and "RM700.00" in adv and "24 jam" not in adv
    assert builders.find_section(HANDBOOK, "Tuntutan petty cash") is None


def test_big_batches_get_more_suggestions():
    many = "\n".join(f"{i}. PROSEDUR NOMBOR {i}\nLangkah pertama." for i in range(1, 18))

    class F:  # only what suggest_cap and outlines read
        def __init__(self, i: str, text: str) -> None:
            self.id, self.text = i, text

    files = [F("a", many)]
    assert builders.suggest_cap(files, builders.outlines(files)) == 20  # type: ignore[arg-type]
    small = [F("b", HANDBOOK)]
    assert builders.suggest_cap(small, builders.outlines(small)) == 12  # type: ignore[arg-type]


# ---------------------------------------------------------------- one suggestion per procedure


async def test_a_handbook_gives_one_suggestion_per_procedure(client, llm, temporal):
    o = await office(client)
    ws = await ws_of(o)
    batch = await add_batch(o)
    fid = await add_file(
        ws, "SOP Operasi Melaka.pdf", HANDBOOK, kind="sop", batch_id=batch, branch_id=None
    )
    llm.say(
        json.dumps(
            {
                "suggestions": [
                    {
                        "what": "sop",
                        "title": "Wang pendahuluan (advance) gaji",
                        "files": ["f1"],
                        "section": SECTIONS[0],
                        "reason": "Jadual kelayakan dan tarikh advance.",
                    },
                    {
                        "what": "workflow",
                        "title": "Wang pendahuluan (advance) gaji",
                        "files": ["f1"],
                        "section": SECTIONS[0],
                        "reason": "Semak, execute, bayar.",
                    },
                    {
                        "what": "sop",
                        "title": "Surat amaran dan tindakan disiplin",
                        "files": ["f1"],
                        "section": SECTIONS[1],
                        "reason": "Tahap surat amaran.",
                    },
                    {
                        "what": "workflow",
                        "title": "Permohonan uniform dan peralatan",
                        "files": ["f1"],
                        "section": SECTIONS[2],
                        "reason": "Borang, semakan, PO.",
                    },
                    {  # the same procedure twice: dropped
                        "what": "sop",
                        "title": "Advance gaji",
                        "files": ["f1"],
                        "section": SECTIONS[0],
                        "reason": "x",
                    },
                ]
            }
        )
    )
    async with SessionLocal() as db:
        bt = await db.get(IntakeBatch, batch)
        assert bt is not None
        out = await builders.suggest_for_batch(db, bt)
    system, user = (m["content"] for m in llm.requests[-1]["messages"])
    assert "one suggestion PER procedure" in system
    assert "outline:" in user and "p.3 2. SURAT AMARAN DAN TINDAKAN DISIPLIN" in user
    assert [(s["what"], s["section"]) for s in out] == [
        ("sop", SECTIONS[0]),
        ("workflow", SECTIONS[0]),
        ("sop", SECTIONS[1]),
        ("workflow", SECTIONS[2]),
    ]
    assert all(s["file_ids"] == [fid] for s in out)
    assert [s["id"] for s in out] == ["s1", "s2", "s3", "s4"]

    # Without a usable model answer the headings still split the handbook.
    llm.say("not json")
    async with SessionLocal() as db:
        bt = await db.get(IntakeBatch, batch)
        assert bt is not None
        out = await builders.suggest_for_batch(db, bt)
    assert [s["title"] for s in out] == [
        "Wang pendahuluan (advance) gaji",
        "Surat amaran dan tindakan disiplin",
        "Permohonan uniform dan peralatan",
    ]
    assert [s["section"] for s in out] == SECTIONS


# ---------------------------------------------------------------- focused builds


async def test_a_focused_build_reads_only_its_section(client, llm, temporal):
    o = await office(client)
    ws = await ws_of(o)
    fid = await add_file(ws, "SOP Operasi Melaka.pdf", HANDBOOK, kind="sop")
    llm.say(SOP_REPLY)
    r = await client.post(
        "/api/builders/sop",
        json={"file_ids": [fid], "focus": "Surat amaran dan tindakan disiplin"},
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    user = llm.requests[-1]["messages"][1]["content"]
    assert "24 jam" in user and "penamatan perkhidmatan" in user
    assert "RM700.00" not in user and "BU-02" not in user  # other procedures never sent
    assert 'Write ONLY the SOP for the procedure "Surat amaran dan tindakan disiplin"' in user
    assert (
        "Sumber: SOP Operasi Melaka.pdf (bahagian: Surat amaran dan tindakan disiplin)"
        in (r.json()["body"])
    )

    # A suggestion builds its own section.
    batch = await add_batch(
        o,
        [
            {
                "id": "s1",
                "what": "workflow",
                "title": "Permohonan uniform dan peralatan",
                "section": SECTIONS[2],
                "file_ids": [fid],
                "department_id": None,
                "reason": "x",
                "status": "new",
                "built_id": None,
            }
        ],
    )
    llm.say(
        json.dumps(
            {
                "name": "Permohonan uniform",
                "nodes": [
                    {"id": "n1", "type": "start", "title": "Permohonan diterima"},
                    {"id": "n2", "type": "step", "action": "check", "title": "Semak keperluan"},
                    {"id": "n3", "type": "end", "title": "Selesai"},
                ],
                "edges": [{"from": "n1", "to": "n2"}, {"from": "n2", "to": "n3"}],
            }
        )
    )
    r = await client.post(
        f"/api/intake/{batch}/suggestions/s1/build", json={}, headers=csrf(client)
    )
    assert r.status_code == 201, r.text
    user = llm.requests[-1]["messages"][1]["content"]
    assert "BU-02" in user and "RM700.00" not in user and "24 jam" not in user
    assert 'for the procedure "Permohonan uniform dan peralatan' in user


async def test_a_focused_long_build_keeps_only_notes_about_it(client, llm, temporal, monkeypatch):
    o = await office(client)
    ws = await ws_of(o)
    monkeypatch.setattr(builders, "SINGLE_PASS_CHARS", 300)
    monkeypatch.setattr(builders, "PART_CHARS", 400)
    text = HANDBOOK + "\nTuntutan petty cash dibuat dengan resit, had RM500.00 sebulan.\n"
    fid = await add_file(ws, "Buku panduan.pdf", text, kind="handbook")
    focus = "Tuntutan petty cash"  # no heading names it: the map step filters
    async with SessionLocal() as db:
        files = await builders.load_files(db, [fid])
        parts = len(builders._parts(builders._source(files, focus)[0]))
    assert parts >= 2
    for _ in range(parts - 1):
        llm.say("NONE")
    llm.say("- Tuntutan petty cash: resit wajib, had RM500.00 sebulan.")
    llm.say(SOP_REPLY)
    async with SessionLocal() as db:
        s = await builders.build_sop(
            db, file_ids=[fid], branch_id=None, department_id=None, actor="user:t", focus=focus
        )
    assert s.status == "draft"
    maps = llm.requests[:parts]
    assert all(
        'Keep ONLY what belongs to the procedure "Tuntutan petty cash"'
        in m["messages"][0]["content"]
        for m in maps
    )
    reduce = llm.requests[-1]["messages"][1]["content"]
    assert "RM500.00 sebulan" in reduce and "NONE" not in reduce
    assert f"--- Part {parts} ---" in reduce and "--- Part 1 ---" not in reduce

    # Nothing about it anywhere: refused, in the reader's words.
    for _ in range(parts):
        llm.say("NONE")
    async with SessionLocal() as db:
        try:
            await builders.build_sop(
                db,
                file_ids=[fid],
                branch_id=None,
                department_id=None,
                actor="user:t",
                focus="Tuntutan perjalanan luar negara",
            )
        except builders.BuildError as e:
            assert e.code == "focus_not_found"
            assert "Tuntutan perjalanan luar negara" in str(e.message)
        else:
            raise AssertionError("a focus nothing describes must be refused")


# ---------------------------------------------------------------- who does what


SYSTEMS_DOC = """Pegawai log masuk ke Sistem Gaji Pintar untuk execute advance.
Semak kalendar taklimat dalam Microsoft Teams.
HR memasukkan cuti dalam HR portal."""


def test_outside_systems_and_plain_checks():
    systems = builders.systems_in(SYSTEMS_DOC)
    assert "Gaji Pintar" in systems or "Sistem Gaji Pintar" in systems
    assert "HR portal" in systems and "HR" not in systems
    g = {
        "nodes": [
            {"id": "s", "type": "start", "title": "Mula"},
            {"id": "qt", "type": "step", "action": "browse", "title": "Semak No. QT"},
            {
                "id": "cal",
                "type": "step",
                "action": "check",
                "title": "Semak kalendar taklimat",
                "body": "Dalam Microsoft Teams.",
            },
            {"id": "pay", "type": "step", "action": "task", "title": "Kemas kini Gaji Pintar"},
            {"id": "wa", "type": "step", "action": "message", "title": "Draf makluman WhatsApp"},
            {"id": "team", "type": "step", "action": "check", "title": "Semak with sales teams"},
            {"id": "doc", "type": "step", "action": "check", "title": "Semak dokumen tender"},
            {"id": "d1", "type": "decision", "action": "approval", "title": "Tender ada taklimat?"},
            {"id": "d2", "type": "decision", "action": "approval", "title": "Lulus untuk PO?"},
            {"id": "e", "type": "end", "title": "Selesai"},
        ],
        "edges": [
            {"from": "s", "to": "qt"},
            {"from": "qt", "to": "cal"},
            {"from": "cal", "to": "pay"},
            {"from": "pay", "to": "wa"},
            {"from": "wa", "to": "team"},
            {"from": "team", "to": "doc"},
            {"from": "doc", "to": "d1"},
            {"from": "d1", "to": "d2", "label": "Ya"},
            {"from": "d1", "to": "e", "label": "Tidak"},
            {"from": "d2", "to": "e", "label": "Lulus"},
        ],
    }
    fixed = builders.repair(g, "ms", systems)
    nodes = {n["id"]: n for n in fixed["nodes"]}
    assert [nodes[i]["type"] for i in ("qt", "cal", "pay")] == ["input"] * 3
    assert nodes["qt"]["title"] == "Sahkan: Semak No. QT"
    assert "Microsoft Teams" in nodes["cal"]["body"]
    assert all(nodes[i]["action"] == "" and nodes[i]["agent_id"] == "" for i in ("qt", "cal"))
    assert [nodes[i]["type"] for i in ("wa", "team", "doc")] == ["step"] * 3
    assert nodes["d1"]["action"] == "" and nodes["d2"]["action"] == "approval"
    assert builders.problems(fixed) == []
    system = builders.workflow_system("ms")
    assert "Never use the actions browse or form" in system
    assert "A plain yes/no check" in system
    assert ", browse," not in system.split("You are drafting")[1]


def test_screen_operations_become_person_steps():
    from agentic.intake.builders import person_steps

    steps = [
        ("a", "Penutupan bayaran", "Processing > Advanced Payment Closing, klik EXECUTE.", "task"),
        ("b", "Kira kelayakan", "Kira hari bekerja 1-15hb ikut jadual.", "calculate"),
        ("c", "Draf makluman", "Draf mesej: klik pautan dalam emel.", "message"),
        ("d", "Jana laporan", "REPORTS > Guard Advanced Payment Report > GENERATE.", "report"),
        ("e", "Simpan rekod", "Edit jumlah dan tekan SAVE ENTRY.", "check"),
    ]
    graph = {
        "nodes": [
            {"id": i, "type": "step", "title": t, "body": b, "action": a} for i, t, b, a in steps
        ],
        "edges": [],
    }
    assert sorted(person_steps(graph, lang="ms")) == ["a", "d", "e"]
    kinds = {n["id"]: n["type"] for n in graph["nodes"]}
    assert kinds == {"a": "input", "b": "step", "c": "step", "d": "input", "e": "input"}
