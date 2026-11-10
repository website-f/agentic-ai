"""Practice ePerolehan (P97): a small fake of a government procurement portal's supplier side,
laid out the way the public ePerolehan supplier manuals describe it (sign-in "ID Log Masuk" /
"Kata Laluan", the top menu Paparan / Aplikasi Saya / Senarai Tugasan / Papan Kenyataan, the
"Papan Notis" search with KRITERIA CARIAN, the eligibility check "Semak", the proposal screen
"Penyediaan Kertas Cadangan" and its "Dokumen Sebut Harga / Tender"). Made-up data only,
for measuring and testing browser agents end to end (tests/test_p97_browser_speed.py). It
never pretends to be the real site: every page says "Practice" in its title and header.

Mounted by portal.py under /ep. Sign in with the portal's demo user.
"""

import hashlib
import hmac
import html
import os
from urllib.parse import parse_qs

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response

USER = os.environ.get("PORTAL_USER", "demo.supplier")
PASSWORD = os.environ.get("PORTAL_PASSWORD", "practice-only-2026")
SECRET = os.environ.get("PORTAL_SECRET", "practice-portal-secret").encode()
COOKIE = "ep_session"

router = APIRouter(prefix="/ep")

MINISTRIES = [
    "Kementerian Kerja Raya",
    "Kementerian Kesihatan",
    "Kementerian Pendidikan",
    "Kementerian Dalam Negeri",
    "Kementerian Pertanian",
    "Kementerian Pengangkutan",
]
NOTICES = [
    {
        "ref": f"QT26{100 + i:04d}",
        "title": title,
        "ptj": f"PTJ Contoh {1 + i % 5}",
        "ministry": MINISTRIES[i % len(MINISTRIES)],
        "advertised": f"2026-11-{1 + i % 9:02d}",
        "closes": f"2026-11-{14 + i % 12:02d} 12:00 PM",
        "proposal": f"PN2600{5100 + i}",
    }
    for i, title in enumerate(
        [
            "Bekalan Komputer Riba (40 Unit)",
            "Perkhidmatan Pembersihan Bangunan 12 Bulan",
            "Bekalan Kertas A4 dan Toner",
            "Penyelenggaraan Penghawa Dingin",
            "Pemasangan CCTV di 3 Lokasi",
            "Bekalan Perabot Pejabat",
            "Percetakan Laporan Tahunan",
            "Kerja Landskap Pejabat Utama",
            "Bekalan Peralatan Makmal",
            "Perkhidmatan Katering Latihan",
            "Bekalan Ubat dan Alat Perubatan",
            "Pembaikan Longkang Jalan Mawar",
        ]
    )
]
DOCS = [
    "01_Kenyataan_Sebut_Harga.pdf",
    "02_Syarat_Syarat_Am.pdf",
    "03_Spesifikasi_Teknikal.pdf",
    "04_Jadual_Harga.pdf",
]

STYLE = """<style>body{font:14px system-ui,sans-serif;margin:0;background:#eef1f5;color:#1d2733}
header{background:#123a63;color:#fff;padding:10px 20px;display:flex;justify-content:space-between;
align-items:center}header a{color:#fff;margin-left:14px;text-decoration:none}nav.menu{background:
#1f5d99;padding:8px 20px}nav.menu a{color:#fff;margin-right:18px;text-decoration:none}main{max-width
:1100px;margin:18px auto;background:#fff;padding:20px;border-radius:6px}table{width:100%;
border-collapse:collapse}td,th{padding:6px;border-bottom:1px solid #dde3ea;text-align:left}
label{display:block;margin:8px 0 3px}input,select{padding:6px;width:300px}button{padding:7px 16px;
margin:10px 6px 0 0;background:#1f5d99;color:#fff;border:0;border-radius:3px}.side{float:left;
width:230px}.side a{display:block;padding:6px 0}.body{margin-left:250px}.note{color:#667}
.crumb{color:#667;font-size:12px}.ok{color:#176d2c;font-weight:600}</style>"""

MENU = [
    ("Paparan", "/ep/dashboard"),
    ("Aplikasi Saya", "/ep/aplikasi"),
    ("Senarai Tugasan", "/ep/tugasan"),
    ("Papan Kenyataan", "/ep/papan-notis"),
    ("Laporan", "/ep/laporan"),
    ("Informasi", "/ep/informasi"),
    ("Lain-Lain", "/ep/lain"),
    ("Bantuan", "/ep/bantuan"),
]


def _sig() -> str:
    return USER + "." + hmac.new(SECRET, b"ep:" + USER.encode(), hashlib.sha256).hexdigest()[:24]


def _in(req: Request) -> bool:
    c = req.cookies.get(COOKIE, "")
    return bool(c) and hmac.compare_digest(c, _sig())


def _page(title: str, body: str, *, signed_in: bool = True, crumb: str = "") -> HTMLResponse:
    top = (
        '<span><a href="/ep/laman-saya">Laman Saya</a><a href="/ep/akaun">Akaun Saya</a>'
        '<a href="/ep/logout">Log Keluar</a></span>'
        if signed_in
        else '<span><a href="/ep/login">Log Masuk</a></span>'
    )
    menu = (
        '<nav class="menu">' + "".join(f'<a href="{u}">{n}</a>' for n, u in MENU) + "</nav>"
        if signed_in
        else ""
    )
    trail = f'<p class="crumb">eP App / {html.escape(crumb)}</p>' if crumb else ""
    return HTMLResponse(
        f"<!doctype html><html><head><meta charset=utf-8><title>{html.escape(title)} | Practice "
        f"ePerolehan</title>{STYLE}</head><body><header><b>Practice ePerolehan (demo data, not "
        f"the real portal)</b>{top}</header>{menu}<main>{trail}{body}</main></body></html>"
    )


def _guard(req: Request) -> RedirectResponse | None:
    return None if _in(req) else RedirectResponse("/ep/login", 302)


@router.get("/")
def ep_home(req: Request):
    return RedirectResponse("/ep/dashboard" if _in(req) else "/ep/login", 302)


@router.get("/login")
def ep_login_form(error: str = "") -> HTMLResponse:
    msg = '<p style="color:#b00">ID Log Masuk atau Kata Laluan salah.</p>' if error else ""
    return _page(
        "Log Masuk",
        f"<h1>Log Masuk</h1><p>Sila masukkan butiran log masuk anda</p>{msg}"
        "<form method=post action=/ep/login><label for=uid>ID Log Masuk :</label>"
        "<input id=uid name=user_id autocomplete=username><label for=pw>Kata Laluan:</label>"
        "<input id=pw name=password type=password autocomplete=current-password><br>"
        "<button type=submit>Log Masuk</button></form>"
        '<p><a href="/ep/lupa">Lupa Kata Laluan</a> · <a href="/ep/lupa">Lupa ID Log Masuk</a></p>'
        "<p class=note>Jangan simpan kata laluan dalam pelayar. (Practice site.)</p>",
        signed_in=False,
    )


@router.post("/login")
async def ep_login(req: Request):
    form = parse_qs((await req.body()).decode("utf-8", "replace"))
    user = (form.get("user_id") or [""])[0]
    pw = (form.get("password") or [""])[0]
    if not (hmac.compare_digest(user, USER) and hmac.compare_digest(pw, PASSWORD)):
        return RedirectResponse("/ep/login?error=1", 303)
    r = RedirectResponse("/ep/dashboard", 303)
    r.set_cookie(COOKIE, _sig(), httponly=True, samesite="lax", path="/ep")
    return r


@router.get("/logout")
def ep_logout():
    r = RedirectResponse("/ep/login", 302)
    r.delete_cookie(COOKIE, path="/ep")
    return r


@router.get("/dashboard")
def ep_dashboard(req: Request):
    if (g := _guard(req)) is not None:
        return g
    news = "".join(
        f'<li><a href="/ep/informasi?n={i}">Pengumuman {i}: makluman sistem untuk pembekal</a>'
        "</li>"
        for i in range(1, 13)
    )
    tasks = "".join(
        f"<tr><td>{n['ref']}</td><td>{html.escape(n['title'])}</td><td>Menunggu Maklumbalas</td>"
        f'<td><a href="/ep/tugasan?ref={n["ref"]}">Perihal</a></td></tr>'
        for n in NOTICES[:5]
    )
    return _page(
        "Paparan",
        "<h1>Paparan</h1><h2>Pengumuman</h2><ul>"
        f"{news}</ul><h2>Senarai Tugasan</h2><table><thead><tr><th>No.</th><th>Tajuk</th>"
        f"<th>Status</th><th>Tindakan</th></tr></thead><tbody>{tasks}</tbody></table>",
        crumb="Paparan",
    )


def _filtered(no: str, title: str, ministry: str) -> list[dict]:
    out = NOTICES
    if no.strip():
        out = [n for n in out if no.strip().upper() in n["ref"]]
    if title.strip():
        out = [n for n in out if title.strip().lower() in n["title"].lower()]
    if ministry.strip():
        out = [n for n in out if n["ministry"] == ministry]
    return out


SEARCH_JS = """<script>
document.getElementById('cari').onclick = () => {
  const p = new URLSearchParams();
  for (const id of ['no', 'tajuk', 'kementerian']) p.set(id, document.getElementById(id).value);
  document.getElementById('cari').disabled = true;
  setTimeout(() => { location.href = '/ep/papan-notis?' + p.toString(); }, 600);
};
document.getElementById('semula').onclick = () => { location.href = '/ep/papan-notis'; };
</script>"""


@router.get("/papan-notis")
def ep_notices(req: Request, no: str = "", tajuk: str = "", kementerian: str = ""):
    if (g := _guard(req)) is not None:
        return g
    rows = _filtered(no, tajuk, kementerian)
    trs = "".join(
        f"<tr><td>{n['ref']}</td><td>{html.escape(n['title'])}</td><td>{n['ptj']}</td>"
        f"<td>{n['advertised']}</td><td>{n['closes']}</td>"
        f'<td><a href="/ep/notis/{n["ref"]}" aria-label="Lihat {n["ref"]}">Lihat</a></td></tr>'
        for n in rows
    )
    opts = "".join(
        f'<option{" selected" if m == kementerian else ""}>{html.escape(m)}</option>'
        for m in MINISTRIES
    )
    return _page(
        "Papan Notis",
        "<h1>Papan Notis</h1><h2>KRITERIA CARIAN</h2>"
        f'<label for=no>No. Sebut Harga / Tender</label><input id=no value="{html.escape(no)}">'
        f'<label for=tajuk>Tajuk Perolehan</label><input id=tajuk value="{html.escape(tajuk)}">'
        f"<label for=kementerian>Kementerian</label><select id=kementerian><option value=''>"
        f"Sila Pilih</option>{opts}</select><br>"
        "<button type=button id=cari>Cari</button><button type=button id=semula>Set Semula"
        f"</button><p>{len(rows)} rekod.</p><table><thead><tr><th>No. Sebut Harga / Tender</th>"
        "<th>Tajuk Perolehan</th><th>PTJ</th><th>Tarikh Iklan</th><th>Tarikh Tutup</th>"
        f"<th>Tindakan</th></tr></thead><tbody>{trs}</tbody></table>{SEARCH_JS}",
        crumb="Papan Kenyataan / Papan Notis",
    )


def _notice(ref: str) -> dict | None:
    return next((n for n in NOTICES if n["ref"] == ref.upper()), None)


CHECK_JS = """<script>
document.getElementById('semak').onclick = () => {
  setTimeout(() => {
    document.getElementById('hasil').innerHTML = '<p class=ok>Tahniah, anda Layak untuk menyertai '
      + 'perolehan ini.</p><a href="/ep/cadangan/__REF__">Klik sini untuk sediakan / kemaskini '
      + 'cadangan tawaran</a>';
  }, 500);
};
</script>"""


@router.get("/notis/{ref}")
def ep_notice(req: Request, ref: str):
    if (g := _guard(req)) is not None:
        return g
    n = _notice(ref)
    if n is None:
        return _page("Tiada", "<p>Notis tidak dijumpai.</p>")
    return _page(
        n["ref"],
        f"<h1>{html.escape(n['title'])}</h1><table>"
        f"<tr><th>No. Sebut Harga / Tender</th><td>{n['ref']}</td></tr>"
        f"<tr><th>Kementerian</th><td>{n['ministry']}</td></tr>"
        f"<tr><th>PTJ</th><td>{n['ptj']}</td></tr>"
        f"<tr><th>Tarikh Tutup</th><td>{n['closes']}</td></tr></table>"
        "<h2>SEMAK KELAYAKAN PEMBEKAL</h2><p>No. MOF: 357-0000XXXX (practice)</p>"
        "<button type=button id=semak>Semak</button><div id=hasil></div>"
        + CHECK_JS.replace("__REF__", n["ref"])
        + '<p><a href="/ep/papan-notis">&lt;&lt; Kembali</a></p>',
        crumb="Papan Kenyataan / Papan Notis / Semak Kelayakan",
    )


def _side(ref: str) -> str:
    items = [
        ("Dokumen Sebut Harga / Tender", f"/ep/cadangan/{ref}/dokumen"),
        ("Cadangan Teknikal", f"/ep/cadangan/{ref}"),
        ("Cadangan Kewangan", f"/ep/cadangan/{ref}"),
        ("Perakuan", f"/ep/cadangan/{ref}"),
        ("Surat Akuan Pembida", f"/ep/cadangan/{ref}"),
        ("Maklumat Umum", f"/ep/cadangan/{ref}"),
    ]
    return '<div class="side">' + "".join(f'<a href="{u}">{t}</a>' for t, u in items) + "</div>"


def _proposal_head(n: dict) -> str:
    return (
        f"<h1>Penyediaan Kertas Cadangan</h1><p>No. Sebut Harga / Tender: <b>{n['ref']}</b> · "
        f"No. Cadangan: <b>{n['proposal']}</b> · Tarikh Tutup: {n['closes']} · Tempoh Berbaki: "
        "6 hari</p><button type=button>Cetak Tawaran</button><button type=button>Serah</button>"
    )


@router.get("/cadangan/{ref}")
def ep_proposal(req: Request, ref: str):
    if (g := _guard(req)) is not None:
        return g
    n = _notice(ref)
    if n is None:
        return _page("Tiada", "<p>Notis tidak dijumpai.</p>")
    return _page(
        "Penyediaan Kertas Cadangan",
        _proposal_head(n) + _side(n["ref"]) + '<div class="body"><p>Pilih bahagian di sebelah '
        "kiri untuk menyediakan cadangan.</p></div>",
        crumb="Aplikasi Saya / Penyediaan Cadangan Sebut Harga/Tender",
    )


@router.get("/cadangan/{ref}/dokumen")
def ep_docs(req: Request, ref: str):
    if (g := _guard(req)) is not None:
        return g
    n = _notice(ref)
    if n is None:
        return _page("Tiada", "<p>Notis tidak dijumpai.</p>")
    rows = "".join(
        f'<tr><td>{d}</td><td><a href="/ep/doc/{n["ref"]}/{i}" download>Muat Turun</a></td></tr>'
        for i, d in enumerate(DOCS)
    )
    return _page(
        "Dokumen Sebut Harga / Tender",
        _proposal_head(n) + _side(n["ref"]) + '<div class="body"><h2>SENARAI DOKUMEN</h2>'
        f"<table><thead><tr><th>Nama Dokumen</th><th>Tindakan</th></tr></thead><tbody>{rows}"
        "</tbody></table></div>",
        crumb="Aplikasi Saya / Penyediaan Cadangan Sebut Harga/Tender / Dokumen",
    )


@router.get("/doc/{ref}/{i}")
def ep_doc(req: Request, ref: str, i: int):
    if not _in(req) or _notice(ref) is None or not 0 <= i < len(DOCS):
        return Response(status_code=404)
    body = f"%PDF-1.4\n% practice document {DOCS[i]} for {ref}\n".encode()
    return Response(
        body,
        media_type="application/pdf",
        headers={"content-disposition": f'attachment; filename="{DOCS[i]}"'},
    )


@router.get("/{rest:path}")
def ep_other(req: Request, rest: str):
    """Every other menu page: a plain page with the menu, so wrong turns look real."""
    if (g := _guard(req)) is not None:
        return g
    title = rest.split("/")[0].replace("-", " ").title() or "Paparan"
    links = "".join(f'<li><a href="/ep/{rest}?item={i}">Pautan {i}</a></li>' for i in range(1, 9))
    return _page(title, f"<h1>{html.escape(title)}</h1><ul>{links}</ul>", crumb=title)
