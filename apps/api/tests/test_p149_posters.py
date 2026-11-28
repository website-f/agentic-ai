"""P149b: posters from ready templates. Every template renders at two sizes to a PNG of the
right pixel size and a PDF of the right paper size, with Malay text fitted (not cut short);
the spec is validated with every problem listed; design_poster uses a Library photo and the
company kit's logo and colour; design_revise changes one slot; pictures the agent may not
see are refused."""

import io
import json
import re

import pytest
from PIL import Image, ImageDraw
from pypdf import PdfReader
from sqlalchemy import select

from agentic.agents.tools import TOOLS, ToolContext
from agentic.core.db import SessionLocal
from agentic.design import SIZES, TEMPLATES, SpecError, render, validate
from agentic.design import engine as E
from agentic.design.spec import PALETTES
from agentic.design.templates import Assets
from agentic.documents import service, storage
from agentic.models import Agent, CompanyKit, DocFile, Task, Workspace
from agentic.skills import routines

from .test_agents import llm, new_agent, new_task, office, temporal  # noqa: F401

SAVED = re.compile(r"Saved \[(fl_[0-9a-z]+)\] (.+?\.png) and \[(fl_[0-9a-z]+)\] (.+?\.pdf)")

SAMPLES = {
    "event": {"kicker": "Majlis Makan Malam", "headline": "Malam Penghargaan Staf 2026",
              "subhead": "Meraikan setiap pengawal yang menjaga keselamatan kita",
              "details": ["Tarikh|Sabtu, 12 Disember 2026", "Masa|8.00 malam",
                          "Tempat|Dewan Seri Iskandar, Shah Alam"],
              "cta": "Sahkan kehadiran sebelum 5 Dis", "footer": "hr@prima.com.my · 03-5511 2233"},
    "announcement": {"kicker": "Pengumuman", "headline": "Pejabat ditutup pada Hari Krismas",
                     "body": "Semua cawangan ditutup pada 25 Disember 2026. Kawalan berjalan "
                     "seperti biasa.", "details": ["Bilik kawalan|03-5511 9999"]},
    "hiring": {"kicker": "Jawatan Kosong", "headline": "Pengawal Keselamatan",
               "points": ["Warganegara Malaysia, 21-55 tahun", "Lulus PT3 atau setaraf",
                          "Sanggup bekerja syif"], "details": ["Gaji|RM2,200 - RM2,800"],
               "cta": "WhatsApp 012-345 6789"},
    "sale": {"kicker": "Promosi Hujung Tahun", "headline": "Diskaun pemasangan CCTV",
             "big": "30%", "details": ["Sah|1-31 Dis 2026"], "cta": "Tempah sekarang"},
    "safety": {"kicker": "Amaran", "headline": "Kawasan larangan",
               "subhead": "Hanya kakitangan yang dibenarkan",
               "points": ["Tunjukkan pas keselamatan kepada pengawal",
                          "Dilarang mengambil gambar"],
               "footer": "Kecemasan: Bilik Kawalan 03-5511 9999"},
    "training": {"kicker": "Latihan", "headline": "Kursus Asas Kawalan Keselamatan",
                 "points": ["Undang-undang & etika pengawal", "Rondaan dan laporan insiden",
                            "Pertolongan cemas & CPR"],
                 "details": ["Tarikh|8-10 Jan 2027", "Tempat|Akademi Prima, Klang"],
                 "cta": "Daftar dengan penyelia anda"},
    "quote-milestone": {"kicker": "10 Tahun Bersama", "big": "10",
                        "headline": "Keselamatan pelanggan adalah amanah kami",
                        "name": "Dato' Fauzan", "subhead": "Pengarah Urusan"},
    "stats": {"kicker": "2026 dalam angka", "headline": "Tahun yang lebih selamat",
              "stats": ["1,240|Pengawal terlatih", "98.7%|Kehadiran syif", "0|Insiden besar"],
              "footer": "Sumber: Laporan Operasi 2026"},
    "tender-notice": {"kicker": "Notis Tender", "ref": "PPJ/T/0011/2026",
                      "headline": "Perkhidmatan kawalan keselamatan bangunan",
                      "details": ["Tempoh|24 bulan", "Tarikh tutup|11 Dis 2026, 12 tengah hari"],
                      "footer": "Perbadanan Putrajaya"},
    "menu": {"headline": "Kafe Prima", "subhead": "Menu sarapan",
             "items": ["Nasi lemak ayam|RM8.50|Sambal, telur", "Roti canai|RM2.00",
                       "Teh tarik|RM2.80"]},
    "webinar": {"kicker": "Webinar", "headline": "Keselamatan siber untuk PKS",
                "details": ["Tarikh|15 Jan 2027", "Platform|Microsoft Teams"],
                "people": ["Aina Rahman|Ketua IT", "Lim Wei Jie|Perunding"], "cta": "Daftar"},
    "thank-you": {"headline": "Terima Kasih", "subhead": "Atas sokongan anda sepanjang 2026",
                  "name": "Pengurusan Prima Secure"},
    "product": {"kicker": "Perkhidmatan baharu", "headline": "Rondaan pintar dengan aplikasi",
                "points": ["Laporan masa nyata", "Imbasan QR di setiap titik"],
                "big": "RM99/bulan", "cta": "Minta demo"},
    "festive-raya": {"headline": "Selamat Hari Raya Aidilfitri", "subhead": "Maaf Zahir & Batin",
                     "body": "Semoga Syawal ini membawa keberkatan.", "name": "Warga Prima"},
    "festive-cny": {"headline": "Gong Xi Fa Cai", "subhead": "Selamat Tahun Baru Cina"},
    "festive-deepavali": {"headline": "Selamat Hari Deepavali", "subhead": "Pesta Cahaya"},
    "festive-christmas": {"headline": "Selamat Hari Krismas", "subhead": "dan Tahun Baru 2027"},
    "festive-merdeka": {"kicker": "Hari Kebangsaan", "headline": "Selamat Hari Merdeka",
                        "body": "Bersatu menjaga keamanan negara."},
}  # fmt: skip
OTHER_SIZES = ["a4-portrait", "ig-story", "linkedin-banner", "fb-post", "whatsapp-status",
               "a4-landscape", "ig-portrait", "linkedin-post", "screen-16x9"]  # fmt: skip


def _photo() -> Image.Image:
    im = Image.new("RGB", (1200, 800), (60, 110, 160))
    ImageDraw.Draw(im).ellipse((400, 150, 800, 550), fill=(240, 200, 150))
    return im.convert("RGBA")


def _png(im: Image.Image) -> bytes:
    out = io.BytesIO()
    im.save(out, "PNG")
    return out.getvalue()


def _logo() -> Image.Image:
    im = Image.new("RGBA", (400, 120), (0, 0, 0, 0))
    ImageDraw.Draw(im).rounded_rectangle((0, 0, 399, 119), 30, fill=(19, 137, 95, 255))
    return im


# ---------------------------------------------------------------- the renderer


def test_at_least_fourteen_templates_with_slots_and_samples():
    assert len(TEMPLATES) >= 14
    assert set(SAMPLES) == set(TEMPLATES)
    for tid in ("festive-raya", "festive-cny", "festive-deepavali", "festive-christmas",
                "festive-merdeka", "safety", "tender-notice", "stats", "menu"):  # fmt: skip
        assert tid in TEMPLATES


@pytest.mark.parametrize("n,tid", list(enumerate(SAMPLES)))
def test_every_template_renders_at_two_sizes(n, tid):
    slots = dict(SAMPLES[tid])
    for size in ("ig-square", OTHER_SIZES[n % len(OTHER_SIZES)]):
        spec = validate({"template": tid, "size": size, "slots": slots})
        photo = _photo() if "photo" in TEMPLATES[tid].slots and n % 2 == 0 else None
        r = render(spec, size, Assets(photo=photo, logo=_logo()), "#13895F")
        w, h, paper, *_ = SIZES[size]
        im = Image.open(io.BytesIO(r.png))
        assert im.format == "PNG" and im.size == (w, h), (tid, size)
        assert len(im.convert("RGB").resize((24, 24)).getcolors(600) or []) > 8  # drawn
        assert r.pdf.startswith(b"%PDF")
        page = PdfReader(io.BytesIO(r.pdf)).pages[0]
        mm = (float(page.mediabox.width) * 25.4 / 72, float(page.mediabox.height) * 25.4 / 72)
        want = paper or (w / 150 * 25.4, h / 150 * 25.4)
        assert abs(mm[0] - want[0]) < 1 and abs(mm[1] - want[1]) < 1, (tid, size, mm)
        assert not r.truncated, (tid, size, r.notes)  # text fitted, never cut short
        assert "headline" in r.description and r.width == w


def test_malay_text_fits_by_shrinking_and_emoji_are_left_out():
    long = "Majlis Penyampaian Anugerah Perkhidmatan Cemerlang Kakitangan Keselamatan"
    spec = validate({"template": "event", "size": "ig-square", "slots": {
        "kicker": "Jemputan 🎉", "headline": long, "subhead": "Sila hadir ✨ tepat pada masanya",
        "details": ["Tarikh|Sabtu, 12 Disember 2026", "Masa|8.00 malam - 11.00 malam",
                    "Tempat|Dewan Besar Seri Iskandar, Jalan Plumbum, Shah Alam"],
    }})  # fmt: skip
    r = render(spec, "ig-square", Assets(), "")
    assert not r.truncated
    assert any("left out characters" in n for n in r.notes)
    assert "🎉" not in r.description and "Majlis Penyampaian" in r.description
    # The same text on a LinkedIn banner (4:1) still fits.
    r = render(spec, "linkedin-banner", Assets(), "")
    assert Image.open(io.BytesIO(r.png)).size == (1584, 396) and not r.truncated


def test_text_colour_is_kept_readable():
    cv = E.Canvas(400, 400, PALETTES["mono"], {}, (0, 0, 0, 0))
    assert cv.readable("#FFFF66", E.Box(0, 0, 400, 400), False, "x") == E.NEAR_BLACK
    assert cv.notes == ["x colour changed for contrast"]
    assert cv.readable("#111111", E.Box(0, 0, 400, 400), False, "y") == "#111111"
    assert E.contrast("#FFFFFF", "#000000") == pytest.approx(21.0)
    assert E.contrast("#777777", "#FFFFFF") < 4.5  # the WCAG example: #777 fails 4.5:1
    # A palette of one's own fills the rest; a light accent on light paper is never chosen
    # as text without a check.
    spec = validate({"template": "announcement", "size": "ig-square",
                     "palette": {"bg": "#FFFFFF", "accent": "#FFF59D"},
                     "slots": {"kicker": "Notis", "headline": "Ujian warna"}})  # fmt: skip
    assert render(spec, "ig-square", Assets(), "").palette == "custom"


def test_spec_problems_are_listed_together():
    with pytest.raises(SpecError) as e:
        validate({"template": "evnt", "slots": {}})
    assert "did you mean event" in str(e.value)
    with pytest.raises(SpecError) as e:
        validate({
            "template": "stats", "size": "a5", "palette": {"bg": "navy"}, "fonts": "comic",
            "logo": "my-logo.png",
            "slots": {"headline": "x" * 90, "stats": ["1|a", "2|b"], "price": "RM9",
                      "photo": "../etc/passwd"},
        })  # fmt: skip
    p = "\n".join(e.value.problems)
    for bit in ("size 'a5'", "palette bg must be a colour", "fonts 'comic'", "logo must be",
                "headline is 90 characters", "stats: give 3 to 6", "no slot 'price'",
                "no slot 'photo'"):  # fmt: skip
        assert bit in p, (bit, p)
    with pytest.raises(SpecError) as e:
        validate({"template": "event", "slots": {"kicker": "x", "photo": "not-an-id"}})
    p = "\n".join(e.value.problems)
    assert "needs slot 'headline'" in p and "photo must be a picture's file id" in p
    with pytest.raises(SpecError) as e:
        validate(
            {
                "template": "menu",
                "size": ["ig-square"] * 1 + ["a4-portrait", "ig-story", "fb-post", "linkedin-post"],
                "slots": {"headline": "M", "items": ["a|1"] * 15},
            }
        )
    p = "\n".join(e.value.problems)
    assert "at most 4 sizes" in p and "items: at most 14 items" in p
    # A small spec: a whole poster is a few hundred tokens of arguments.
    small = {"template": "event", "size": "ig-square", "slots": SAMPLES["event"]}
    assert len(json.dumps(small, ensure_ascii=False)) < 600


# ---------------------------------------------------------------- the tools


async def _tool(agent_id: str, name: str, args: dict, task_id: str | None = None) -> str:
    async with SessionLocal() as db:
        agent = await db.get(Agent, agent_id)
        ws = await db.get(Workspace, agent.workspace_id)
        task = await db.get(Task, task_id) if task_id else None
        ctx = ToolContext(db=db, agent=agent, workspace=ws, task=task)
        return await TOOLS[name].handler(ctx, args)


async def _put(ws_id: str, branch_id: str | None, name: str, data: bytes, **kw) -> str:
    async with SessionLocal() as db:
        f = await service.create_file(
            db, workspace_id=ws_id, name=name, data=data, created_by="system:test",
            branch_id=branch_id, source="upload", status="ready", **kw,
        )  # fmt: skip
        await db.commit()
        return f.id


async def test_design_poster_revise_and_access(client, llm, temporal):
    from .conftest import csrf

    o = await office(client)
    agent = await new_agent(client, o, "Rina", "Operations")
    branch = o["branch"]["id"]
    async with SessionLocal() as db:
        ws = (await db.get(Agent, agent["id"])).workspace_id
    logo = await _put(ws, branch, "logo.png", _png(_logo()))
    async with SessionLocal() as db:
        db.add(CompanyKit(branch_id=branch, workspace_id=ws, logo_file_id=logo,
                          data={"trading_name": "Maju", "accent": "#7C3AED"}))  # fmt: skip
        await db.commit()
    photo = await _put(ws, branch, "dewan.png", _png(_photo()))

    listing = await _tool(agent["id"], "design_templates", {"query": "raya"})
    assert "festive-raya" in listing and "hiring" not in listing.split("Sizes:")[0]

    t = await new_task(client, agent, "Poster makan malam", "Buat poster untuk makan malam")
    out = await _tool(agent["id"], "design_poster", {
        "template": "event", "size": ["ig-square", "a4-portrait"],
        "slots": {**SAMPLES["event"], "photo": photo},
    }, task_id=t["id"])  # fmt: skip
    m = SAVED.search(out)
    assert m, out
    png_id, png_name, pdf_id, _ = m.groups()
    assert png_name == "Poster - Malam Penghargaan Staf 2026 (ig-square).png"
    assert routines.made_file("design_poster", out) == png_id  # a routine can chain on it
    assert "Looks:" in out and "photo" in out and "company logo" in out
    async with SessionLocal() as db:
        png = await db.get(DocFile, png_id)
        pdf = await db.get(DocFile, pdf_id)
        assert png.mime == "image/png" and pdf.mime == "application/pdf"
        assert png.branch_id == branch and png.task_id == t["id"] and png.source == "generated"
        assert png.folder.endswith(("/Posters", "/Poster")) and pdf.folder == png.folder
        assert Image.open(io.BytesIO(await storage.read(db, png))).size == (1080, 1080)
        assert (await storage.read(db, pdf)).startswith(b"%PDF")
        spec = json.loads(png.fields["Design spec"])
        assert spec["template"] == "event" and spec["size"] == "ig-square"
        assert spec["slots"]["photo"] == photo
        assert pdf.fields["Picture"].endswith(f"[{png_id}]")
        a4 = (
            await db.scalars(select(DocFile).where(DocFile.name.like("%(a4-portrait).png")))
        ).one()
        assert Image.open(io.BytesIO(await storage.read(db, a4))).size == (2480, 3508)

    # Revise one slot: new files, the rest of the spec as it was, the old poster kept.
    out2 = await _tool(agent["id"], "design_revise", {
        "file_id": pdf_id, "slots": {"cta": "Daftar di kaunter HR", "subhead": None},
    })  # fmt: skip
    m2 = SAVED.search(out2)
    assert m2, out2
    assert m2.group(2) == "Poster - Malam Penghargaan Staf 2026 v2 (ig-square).png"
    assert "changed cta, removed subhead" in out2
    async with SessionLocal() as db:
        new = await db.get(DocFile, m2.group(1))
        s2 = json.loads(new.fields["Design spec"])
        assert s2["slots"]["cta"] == "Daftar di kaunter HR" and "subhead" not in s2["slots"]
        assert s2["slots"]["headline"] == SAMPLES["event"]["headline"]
        assert new.fields["Revised from"].endswith(f"[{pdf_id}]")
        assert await db.get(DocFile, png_id) is not None
    out3 = await _tool(agent["id"], "design_revise", {"file_id": m2.group(1), "size": "ig-story"})
    assert " v3 (ig-story).png" in out3
    assert (await _tool(agent["id"], "design_revise", {"file_id": png_id})).startswith(
        "Error: nothing to change"
    )

    # Another company's picture: refused. Held back, not a picture, not a poster: refused.
    b2 = await client.post("/api/branches", json={"name": "Jaya Bhd"}, headers=csrf(client))
    theirs = await _put(ws, b2.json()["id"], "their.png", _png(_photo()))
    n = await _count()
    out = await _tool(agent["id"], "design_poster", {
        "template": "event", "slots": {"headline": "Hai", "photo": theirs},
    })  # fmt: skip
    assert out.startswith("Error: no such file") and await _count() == n
    out = await _tool(agent["id"], "design_poster", {
        "template": "event", "slots": {"headline": "Hai"}, "logo": theirs,
    })  # fmt: skip
    assert out.startswith("Error: no such file")
    held = await _put(ws, branch, "held.png", _png(_photo()))
    async with SessionLocal() as db:
        (await db.get(DocFile, held)).quarantined = True
        await db.commit()
    out = await _tool(agent["id"], "design_poster", {
        "template": "event", "slots": {"headline": "Hai", "photo": held},
    })  # fmt: skip
    assert "held back for review" in out
    text = await _put(ws, branch, "notes.txt", b"hello")
    out = await _tool(agent["id"], "design_poster", {
        "template": "event", "slots": {"headline": "Hai", "photo": text},
    })  # fmt: skip
    assert "is not a picture" in out
    assert "has no spec to revise" in await _tool(
        agent["id"], "design_revise", {"file_id": photo, "slots": {"headline": "x"}}
    )
    n = await _count()
    out = await _tool(agent["id"], "design_poster", {"template": "nope", "slots": {}})
    assert out.startswith("Error: the poster spec needs fixing") and await _count() == n
    out = await _tool(agent["id"], "design_revise", {"file_id": png_id, "slots": {"price": "x"}})
    assert "has no slot 'price'" in out


async def _count() -> int:
    from sqlalchemy import func

    async with SessionLocal() as db:
        return await db.scalar(select(func.count()).select_from(DocFile))


def test_tool_labels_and_skill():
    from agentic.i18n import MS
    from agentic.skills.store import BUILTIN

    for name in ("design_poster", "design_templates", "design_revise"):
        assert TOOLS[name].label in MS
    skill = next(b for b in BUILTIN if b[0] == "design-poster")
    assert "design_revise" in skill[2] and len(skill[1]) <= 300
    assert {"design_poster", "design_revise"} <= routines.PRODUCERS
