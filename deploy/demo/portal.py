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
    nav = '<a href="/inbox">Inbox</a> · <a href="/logout">Sign out</a>' if signed_in else ""
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
