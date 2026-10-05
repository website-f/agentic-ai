"""Practice supplier portal: a small, fake website with a login and an inbox, for testing
agents end to end (sign in with a saved login, page through an inbox, open messages,
report) without touching any real system. Demo data only; dev profile `demo` only.

Run: docker compose --profile demo up -d practice-portal   (http://localhost:8509)
"""

import hashlib
import hmac
import html
import os
import random
from datetime import date, timedelta

from urllib.parse import parse_qs

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, RedirectResponse

USER = os.environ.get("PORTAL_USER", "demo.supplier")
PASSWORD = os.environ.get("PORTAL_PASSWORD", "practice-only-2026")
SECRET = os.environ.get("PORTAL_SECRET", "practice-portal-secret").encode()
PER_PAGE = 10

app = FastAPI(docs_url=None, redoc_url=None)

AGENCIES = [
    "Ministry of Works",
    "State Water Board",
    "City Council of Seri Indah",
    "Public Health Department",
    "National Library",
    "Federal Roads Office",
]
ITEMS = [
    ("Supply of office furniture", 48_000),
    ("Cleaning services for 12 months", 132_000),
    ("Repair of drainage at Jalan Mawar", 86_500),
    ("Supply of A4 paper and toner", 12_400),
    ("Maintenance of air conditioners", 39_900),
    ("Supply of laptops (40 units)", 168_000),
    ("Landscaping works at the main office", 57_250),
    ("Printing of annual reports", 18_700),
    ("CCTV installation, 3 sites", 74_300),
    ("Catering for staff training", 9_800),
]


def _messages() -> list[dict]:
    rnd = random.Random(20261002)
    today = date(2026, 10, 2)
    out = []
    for i in range(1, 35):
        sent = today - timedelta(days=(34 - i) // 2)
        kind = rnd.choices(["invite", "result", "payment", "notice"], [14, 7, 7, 6])[0]
        agency = rnd.choice(AGENCIES)
        item, value = rnd.choice(ITEMS)
        ref = f"PQ{sent:%y%m}{i:04d}"
        closing = sent + timedelta(days=rnd.choice([7, 10, 14, 21]))
        if kind == "invite":
            subject = f"Invitation to quote {ref}: {item}"
            body = (
                f"You are invited to submit a quotation.\n\nReference: {ref}\nAgency: {agency}\n"
                f"Item: {item}\nEstimated value: RM {value:,.2f}\nBriefing: none\n"
                f"Closing date: {closing:%d %B %Y}, 12:00 noon\n\nSubmit through this portal "
                "before the closing date. Late submissions are not accepted."
            )
        elif kind == "result":
            won = rnd.random() < 0.4
            subject = f"Result of quotation {ref}"
            body = (
                f"Reference: {ref}\nAgency: {agency}\nItem: {item}\n\nResult: "
                + ("Your quotation was successful. A letter of award follows." if won
                   else "Your quotation was not successful this time.")
            )
        elif kind == "payment":
            subject = f"Payment issued for {ref}"
            body = (
                f"Reference: {ref}\nAgency: {agency}\nAmount paid: RM {value * 0.25:,.2f}\n"
                f"Paid on: {sent:%d %B %Y}"
            )
        else:
            subject = rnd.choice(
                ["Scheduled maintenance this Saturday", "Update your company profile",
                 "New rules for supplier registration"]
            )
            body = "This is a notice from the portal team. No action is needed unless stated."
        out.append({"id": i, "date": sent.isoformat(), "from": agency, "subject": subject,
                    "kind": kind, "body": body, "unread": rnd.random() < 0.5})
    return list(reversed(out))  # newest first, like a real inbox


MESSAGES = _messages()

STYLE = """<style>body{font:15px system-ui,sans-serif;margin:0;background:#f4f6f8;color:#1d2733}
header{background:#1f4e79;color:#fff;padding:12px 24px;display:flex;justify-content:space-between}
header a{color:#fff}main{max-width:960px;margin:24px auto;background:#fff;padding:24px;
border-radius:8px}table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px
solid #e3e7ec;text-align:left}tr.unread td{font-weight:600}.pager a{margin-right:8px}
label{display:block;margin:12px 0 4px}input{padding:8px;width:280px}button{margin-top:16px;
padding:8px 18px;background:#1f4e79;color:#fff;border:0;border-radius:4px}.note{color:#667}
pre{white-space:pre-wrap;font:inherit}</style>"""


def _sig(user: str) -> str:
    return user + "." + hmac.new(SECRET, user.encode(), hashlib.sha256).hexdigest()[:24]


def _signed_in(req: Request) -> bool:
    c = req.cookies.get("pp_session", "")
    return bool(c) and hmac.compare_digest(c, _sig(USER))


def page(title: str, body: str, signed_in: bool = True) -> HTMLResponse:
    nav = (
        '<a href="/inbox">Inbox</a> · <a href="/profile">Company profile</a> · '
        '<a href="/logout">Sign out</a>'
        if signed_in
        else ""
    )
    return HTMLResponse(
        f"<!doctype html><html><head><meta charset=utf-8><title>{html.escape(title)} | Practice "
        f"Supplier Portal</title>{STYLE}</head><body><header><b>Practice Supplier Portal "
        f"(demo data)</b><span>{nav}</span></header><main>{body}</main></body></html>"
    )


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


@app.get("/")
def home(req: Request):
    return RedirectResponse("/inbox" if _signed_in(req) else "/login", 302)


@app.get("/login")
def login_form(error: str = "") -> HTMLResponse:
    msg = '<p style="color:#b00">Wrong user ID or password.</p>' if error else ""
    return page(
        "Sign in",
        f"<h1>Sign in</h1>{msg}<form method=post action=/login>"
        "<label for=uid>User ID</label><input id=uid name=user_id autocomplete=username>"
        "<label for=pw>Password</label><input id=pw name=password type=password "
        "autocomplete=current-password><br><button type=submit>Sign in</button></form>"
        "<p class=note>A practice site with made-up messages. Nothing here is real.</p>",
        signed_in=False,
    )


@app.post("/login")
async def login(req: Request):
    form = parse_qs((await req.body()).decode("utf-8", "replace"))
    user_id = (form.get("user_id") or [""])[0]
    password = (form.get("password") or [""])[0]
    ok = hmac.compare_digest(user_id, USER) and hmac.compare_digest(password, PASSWORD)
    if not ok:
        return RedirectResponse("/login?error=1", 303)
    r = RedirectResponse("/inbox", 303)
    r.set_cookie("pp_session", _sig(USER), httponly=True, samesite="lax")
    return r


@app.get("/logout")
def logout():
    r = RedirectResponse("/login", 302)
    r.delete_cookie("pp_session")
    return r


@app.get("/inbox")
def inbox(req: Request, page_no: int = 1, q: str = ""):
    if not _signed_in(req):
        return RedirectResponse("/login", 302)
    rows = [m for m in MESSAGES if q.lower() in (m["subject"] + m["from"]).lower()]
    pages = max(1, -(-len(rows) // PER_PAGE))
    page_no = min(max(1, page_no), pages)
    chunk = rows[(page_no - 1) * PER_PAGE : page_no * PER_PAGE]
    trs = "".join(
        f'<tr class="{"unread" if m["unread"] else ""}"><td>{m["date"]}</td>'
        f"<td>{html.escape(m['from'])}</td><td><a href=/inbox/{m['id']}>"
        f"{html.escape(m['subject'])}</a></td></tr>"
        for m in chunk
    )
    links = "".join(
        f'<a href="/inbox?page_no={n}&q={html.escape(q)}">{"<b>" + str(n) + "</b>" if n == page_no else n}</a>'
        for n in range(1, pages + 1)
    )
    unread = sum(1 for m in rows if m["unread"])
    return page(
        "Inbox",
        f"<h1>Inbox</h1><p>{len(rows)} messages, {unread} unread. Page {page_no} of {pages}.</p>"
        f'<form method=get action=/inbox><input name=q value="{html.escape(q)}" '
        'placeholder="Search subject or sender" aria-label="Search"> <button>Search</button></form>'
        f"<table><thead><tr><th>Date</th><th>From</th><th>Subject</th></tr></thead><tbody>{trs}"
        f"</tbody></table><p class=pager>Pages: {links}</p>",
    )


@app.get("/inbox/{mid}")
def message(req: Request, mid: int):
    if not _signed_in(req):
        return RedirectResponse("/login", 302)
    m = next((x for x in MESSAGES if x["id"] == mid), None)
    if m is None:
        return page("Not found", "<p>No such message.</p>")
    return page(
        m["subject"],
        f"<p><a href=/inbox>Back to inbox</a></p><h1>{html.escape(m['subject'])}</h1>"
        f"<p class=note>From {html.escape(m['from'])}, {m['date']}</p>"
        f"<pre>{html.escape(m['body'])}</pre>",
    )


# ---------------------------------------------------------------- a form to fill (P9 demo)

CATEGORIES = ["Office supplies", "Cleaning services", "ICT equipment", "Building works", "Catering"]
PROFILE: dict[str, str] = {
    "company": "", "reg_no": "", "phone": "", "email": "", "address": "", "category": "",
}
SUBMISSIONS: list[dict[str, str]] = []


@app.get("/profile")
def profile_form(req: Request):
    if not _signed_in(req):
        return RedirectResponse("/login", 302)
    v = {k: html.escape(x) for k, x in PROFILE.items()}
    opts = "".join(
        f'<option{" selected" if c == PROFILE["category"] else ""}>{html.escape(c)}</option>'
        for c in CATEGORIES
    )
    return page(
        "Company profile",
        "<h1>Update company profile</h1><p class=note>Keep these details current so agencies "
        "can contact you.</p><form method=post action=/profile>"
        f'<label for=company>Company name</label><input id=company name=company value="{v["company"]}">'
        f'<label for=reg>SSM registration no.</label><input id=reg name=reg_no value="{v["reg_no"]}">'
        f'<label for=phone>Telephone</label><input id=phone name=phone value="{v["phone"]}">'
        f'<label for=email>E-mail</label><input id=email name=email type=email value="{v["email"]}">'
        f'<label for=address>Business address</label><textarea id=address name=address rows=3 '
        f'style="width:420px">{v["address"]}</textarea>'
        f"<label for=cat>Business category</label><select id=cat name=category>"
        f"<option value=''>Choose…</option>{opts}</select>"
        '<label><input type=checkbox name=confirm value=yes style="width:auto"> I confirm these '
        "details are correct</label><button type=submit>Save profile</button></form>",
    )


@app.get("/frame")
def framed(req: Request):
    """The profile form inside a same-origin iframe (many government portals do this)."""
    if not _signed_in(req):
        return RedirectResponse("/login", 302)
    return page(
        "Framed profile",
        "<h1>Supplier services</h1><p class=note>The form below is shown in a frame.</p>"
        '<iframe src="/profile" title="Company profile form" style="width:100%;height:640px;'
        'border:1px solid #ccd"></iframe>',
    )


LIVE_JS = """<script>
let next = 4;
const list = document.getElementById('notices');
function row(k) {
  const li = document.createElement('li');
  li.innerHTML = 'Notice #' + k + ' <button type=button data-k="' + k + '">Open #' + k + '</button>';
  return li;
}
for (let k = 3; k >= 1; k--) list.appendChild(row(k));
list.addEventListener('click', (e) => {
  const k = e.target.getAttribute && e.target.getAttribute('data-k');
  if (k) document.getElementById('status').textContent = 'Opened #' + k;
});
document.getElementById('add').onclick = () => { list.insertBefore(row(next), list.firstChild); next++; };
document.getElementById('redraw').onclick = () => {
  const ks = Array.from(list.querySelectorAll('button')).map(b => b.getAttribute('data-k'));
  list.innerHTML = '';
  ks.forEach(k => list.appendChild(row(k)));
};
</script>"""


@app.get("/live")
def live(req: Request):
    """A page that re-renders itself (new notices appear at the top; Redraw rebuilds the list),
    for checking that element references survive re-renders."""
    if not _signed_in(req):
        return RedirectResponse("/login", 302)
    return page(
        "Live notices",
        "<h1>Live notices</h1><p id=status class=note>Nothing opened yet.</p>"
        "<button type=button id=add>Add a notice</button> "
        "<button type=button id=redraw>Redraw the list</button>"
        f"<ul id=notices></ul>{LIVE_JS}",
    )


@app.get("/big")
def big(n: int = 1500) -> HTMLResponse:
    """A long page (n table rows with a link and a button each) for snapshot size checks."""
    n = max(1, min(n, 5000))
    rows = "".join(
        f"<tr><td>2026-10-{1 + i % 28:02d}</td><td>Agency {i % 17}</td>"
        f"<td><a href=/inbox/{1 + i % 34}>Item {i}</a></td>"
        f"<td><button type=button>Flag {i}</button></td></tr>"
        for i in range(n)
    )
    return page("Big list", f"<h1>Big list</h1><p>{n} rows.</p><table>{rows}</table>", False)


@app.get("/go")
def go(to: str = "/") -> RedirectResponse:
    """An open redirect, for checking that the browser's guards also see redirects."""
    return RedirectResponse(to, 302)


@app.post("/profile")
async def profile_save(req: Request):
    if not _signed_in(req):
        return RedirectResponse("/login", 302)
    form = {k: v[0] for k, v in parse_qs((await req.body()).decode("utf-8", "replace")).items()}
    if form.get("confirm") != "yes":
        return page("Not saved", "<h1>Not saved</h1><p>Tick the confirmation box and try again."
                    " <a href=/profile>Back</a></p>")
    for k in PROFILE:
        PROFILE[k] = form.get(k, "")[:300]
    SUBMISSIONS.append(dict(PROFILE))
    rows = "".join(
        f"<tr><th>{html.escape(k)}</th><td>{html.escape(v)}</td></tr>" for k, v in PROFILE.items()
    )
    return page(
        "Profile saved",
        f"<h1>Profile saved</h1><p>Reference UPD-{len(SUBMISSIONS):04d}. We received:</p>"
        f"<table>{rows}</table><p><a href=/profile>Edit again</a></p>",
    )
