"""Demo data for the User Guide screenshots and videos: a healthy, fictional office.

Creates (or re-creates) a separate database, migrates it, then fills it with two fictional
companies, their ready-made AI teams and about a month of work: tasks in every state,
approvals, reports, SOPs, library files, skills that were learned, a workflow, schedules,
meetings, a broadcast, documents, brain pages and facts, activity, and AI usage.

Nothing here is real: people, companies, figures and keys are made up. Provider keys are
fake, so nothing can call a real model with them.

    cd apps/api
    uv run python ../../deploy/docs-capture/seed_demo.py \
        --db-url postgresql+asyncpg://agentic:agentic_dev@localhost:8506/agentic_demo

Options: --no-recreate (seed an already-migrated, empty database), --valkey-url,
--vault-dir. Logins (password demo-office-2026):
    owner@demo.example (Aminah Rahman, owner)
    suresh@demo.example (Suresh Kumar, branch manager, Nusantara Logistics)
    farid@demo.example (Farid Hassan, staff, has an AI worker)
    wani@demo.example (Syazwani Omar, staff at Harmoni, new: no AI worker yet)
    kamal@demo.example (Ir. Kamal Yusof, admin), christine@demo.example (Christine Lau, approver)
"""

import argparse
import asyncio
import os
import random
import subprocess
import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
API_DIR = HERE.parent.parent / "apps" / "api"
PASSWORD = "demo-office-2026"
DOMAIN = "demo.example"

p = argparse.ArgumentParser(description="Seed the demo office for the User Guide captures.")
p.add_argument(
    "--db-url",
    default="postgresql+asyncpg://agentic:agentic_dev@localhost:8506/agentic_demo",
)
p.add_argument("--valkey-url", default="redis://localhost:8507/8")
p.add_argument("--vault-dir", default=str(HERE / ".work" / "vault"))
p.add_argument("--no-recreate", action="store_true")
ARGS = p.parse_args()

# Settings are read at import time, so the environment is set before agentic is imported.
os.environ["AGENTIC_DATABASE_URL"] = ARGS.db_url
os.environ["AGENTIC_VALKEY_URL"] = ARGS.valkey_url
os.environ["AGENTIC_VAULT_DIR"] = ARGS.vault_dir
os.environ.setdefault("AGENTIC_EMBED_BACKEND", "hash")
os.environ["AGENTIC_DEV_SEED"] = "false"
os.environ["AGENTIC_LOCAL_LLM_URL"] = ""
os.environ.setdefault("AGENTIC_TEMPORAL_TASK_QUEUE", "agentic-office")
sys.path.insert(0, str(API_DIR))

NOW = datetime.now(UTC)
RNG = random.Random(20261004)


def ago(days: float = 0, hours: float = 0, minutes: float = 0) -> datetime:
    return NOW - timedelta(days=days, hours=hours, minutes=minutes)


# ---------------------------------------------------------------- database (re)creation


async def recreate_database() -> None:
    import asyncpg

    url = ARGS.db_url.replace("postgresql+asyncpg://", "postgresql://")
    base, _, name = url.rpartition("/")
    conn = await asyncpg.connect(base + "/postgres")
    try:
        await conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        await conn.execute(f'CREATE DATABASE "{name}"')
    finally:
        await conn.close()
    env = dict(os.environ)
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=API_DIR,
        env=env,
        check=True,
        stdout=subprocess.DEVNULL,
    )
    print(f"database {name}: created and migrated")


# ---------------------------------------------------------------- the API, in process


class Api:
    """Calls the real API in-process (httpx ASGI transport), as one signed-in person."""

    def __init__(self) -> None:
        import httpx

        from agentic.api.main import app

        self.c = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://demo.local"
        )

    def _h(self) -> dict[str, str]:
        return {"x-csrf-token": self.c.cookies.get("agentic_csrf") or ""}

    async def call(self, method: str, path: str, body: Any = None, ok=(200, 201)) -> Any:
        r = await self.c.request(method, path, json=body, headers=self._h())
        if r.status_code not in ok:
            raise RuntimeError(f"{method} {path}: {r.status_code} {r.text[:400]}")
        return r.json() if r.content else None

    async def login(self, email: str) -> None:
        self.c.cookies.clear()
        await self.call("POST", "/api/auth/login", {"email": email, "password": PASSWORD})

    async def close(self) -> None:
        await self.c.aclose()


# ---------------------------------------------------------------- content

COMPANIES = {
    "N": {
        "name": "Nusantara Logistics Sdn Bhd",
        "industry": "trading",
        "color": "#2f6db5",
        "kit": {
            "legal_name": "Nusantara Logistics Sdn Bhd",
            "trading_name": "Nusantara Logistics",
            "reg_no": "201801012345 (1271234-K)",
            "tax_no": "SST W10-1808-32000123",
            "incorporated_on": "2018-04-12",
            "address": "Lot 12, Jalan Perigi Nanas 6/1, Pulau Indah Industrial Park,\n42920 Port Klang, Selangor",
            "phone": "+60 3-3101 2288",
            "email": "accounts@nusantara-logistics.example",
            "website": "www.nusantara-logistics.example",
            "bank_name": "Maybank Berhad",
            "bank_account": "5144 2201 8876",
            "bank_holder": "Nusantara Logistics Sdn Bhd",
            "signatory_name": "Aminah Rahman",
            "signatory_title": "Managing Director",
            "directors": "Aminah Rahman\nDaniel Tan Wei Ming",
            "currency": "RM",
            "tax_label": "SST",
            "tax_rate": "6",
            "payment_terms": "30 days from invoice date",
            "accent": "#2f6db5",
            "footer_note": "Thank you for moving with Nusantara.",
        },
    },
    "H": {
        "name": "Harmoni Engineering Sdn Bhd",
        "industry": "engineering",
        "color": "#13895f",
        "kit": {
            "legal_name": "Harmoni Engineering Sdn Bhd",
            "trading_name": "Harmoni Engineering",
            "reg_no": "201501034567 (1158765-T)",
            "tax_no": "SST W10-1509-31000456",
            "incorporated_on": "2015-09-03",
            "address": "No. 8, Jalan Teknologi 3/5, Taman Sains Selangor,\n47810 Kota Damansara, Selangor",
            "phone": "+60 3-6151 4400",
            "email": "office@harmoni-eng.example",
            "website": "www.harmoni-eng.example",
            "bank_name": "CIMB Bank Berhad",
            "bank_account": "8006 3321 9054",
            "bank_holder": "Harmoni Engineering Sdn Bhd",
            "signatory_name": "Ir. Kamal Yusof",
            "signatory_title": "Executive Director",
            "directors": "Aminah Rahman\nIr. Kamal Yusof",
            "currency": "RM",
            "tax_label": "SST",
            "tax_rate": "8",
            "payment_terms": "Progress claims: 30 days from certification",
            "accent": "#13895f",
            "footer_note": "CIDB G7 contractor. ISO 9001:2015 certified.",
        },
    },
}

T = dict  # readability


def tbl(title: str, columns: list[str], rows: list[list[Any]]) -> dict[str, Any]:
    return {"title": title, "columns": columns, "rows": rows}


# Tasks: (company, role key, title, brief, status, labels, priority, age days, result, plan)
# role "twin" = Farid's AI worker. Status "blocked" tasks get a pending approval below.
TASKS: list[dict[str, Any]] = [
    T(c="N", r="finance", title="13-week cash-flow forecast (week 40)", status="done",
      labels=["cash-flow"], age=1.2, sched="cash",
      brief="Update the rolling 13-week cash-flow forecast with last week's collections, the fuel card statement and confirmed payroll. Flag any week where the closing balance falls under RM 250,000.",
      result="**Closing balance stays above the RM 250,000 floor in all 13 weeks.** The tightest week is week 45 (RM 286,400) when the two prime-mover HP instalments and payroll fall together.\n\n| Week | Receipts (RM) | Payments (RM) | Closing (RM) |\n|---|---:|---:|---:|\n| 41 | 612,300 | 548,900 | 731,200 |\n| 42 | 488,000 | 571,400 | 647,800 |\n| 43 | 530,500 | 602,100 | 576,200 |\n| 44 | 455,900 | 618,300 | 413,800 |\n| 45 | 498,200 | 625,600 | 286,400 |\n\nAssumptions: Mega Mart pays on day 45 as in the last 3 months; diesel at RM 3.35/l. Suggest moving the Seri Murni invoice run forward by one week to widen the week-45 buffer.",
      plan=["Pull last week's bank and collections", "Update receipts by customer", "Update fixed and variable payments", "Run the 13-week forecast", "Flag weeks under the floor"]),
    T(c="N", r="finance", title="Debtor ageing and collection plan: September", status="done",
      labels=["collections"], age=4.3,
      brief="Age all open customer invoices at 30 Sep and draft a collection plan for anything over 60 days.",
      result="Total receivables RM 1.42m; **RM 186,750 (13%) is over 60 days**, down from 17% in August.\n\n| Customer | Over 60 days (RM) | Oldest invoice | Next step |\n|---|---:|---|---|\n| Seri Murni Foods | 92,400 | INV-NL-2291 (74 days) | Call finance manager, offer 2 instalments |\n| Kedai Runcit Jaya | 41,850 | INV-NL-2244 (81 days) | Final reminder letter |\n| Borneo Fresh Trading | 52,500 | INV-NL-2302 (63 days) | Confirm PO matched; resend copy |\n\nDraft reminders are attached for review; nothing has been sent.",
      plan=["Export open invoices", "Age by customer", "Draft reminders for over-60-day accounts", "Summarise for the MD"]),
    T(c="N", r="finance", title="Reconcile fuel card statement against trip logs (September)", status="review",
      labels=["reconciliation"], age=0.4,
      brief="Match the September fleet fuel card statement to the trip logs and flag any fill-up that does not match a trip.",
      result="Matched **412 of 418** fill-ups (98.6%) to a trip log.\n\n6 fill-ups need a look, total RM 1,284.60:\n- 4 at Petron Bukit Raja on Sundays when the truck had no trip (WXK 4471)\n- 2 fills of over 400 litres on a 300-litre tank (WVB 2209, likely two vehicles on one card)\n\nNo duplicates on the statement itself. Suggest asking Operations to confirm the WXK 4471 Sunday trips before raising it with the driver.",
      plan=["Load the statement", "Load trip logs", "Match by vehicle, date and station", "List the exceptions"]),
    T(c="N", r="finance", title="Compare hire-purchase offers for 2 prime movers", status="done",
      labels=["financing"], age=9.1,
      brief="Two offers for two new prime movers (RM 420,000 each). Bank A: 2.65% flat, 5 years. Bank B: 4.6% reducing, 5 years. Which is cheaper and by how much?",
      result="**Bank B is cheaper by RM 7,960 over 5 years** for both trucks together.\n\n| | Bank A (2.65% flat) | Bank B (4.6% reducing) |\n|---|---:|---:|\n| Effective rate | 4.95% | 4.60% |\n| Monthly instalment (2 trucks) | RM 15,855 | RM 15,722 |\n| Total interest | RM 111,300 | RM 103,340 |\n\nA flat rate looks lower but is charged on the full amount for the whole term. Workings are from the finance calculator.",
      plan=["Convert the flat rate to an effective rate", "Compute both schedules", "Compare total interest"]),
    T(c="N", r="finance", title="Prepare September management report", status="running",
      labels=["management-report"], age=0.05,
      brief="Monthly management report for the board: P&L vs budget, cash, receivables, fleet utilisation and the three things to watch in October.",
      plan=[("Collect P&L and budget figures", "done"), ("Budget vs actual by cost centre", "done"), ("Cash and receivables", "doing"), ("Fleet utilisation", "todo"), ("Write the summary", "todo")]),
    T(c="N", r="sales", title="Quotation: Mega Mart Holdings, Klang Valley distribution (Q4)", status="review",
      labels=["quotation"], age=0.7,
      brief="Prepare a quotation for Mega Mart Holdings: 3x weekly ambient deliveries from Port Klang to 14 outlets in the Klang Valley, October to December.",
      result="Quotation **QT-2610-0031** is drafted in Documents for your review.\n\n- 3 trips a week, 14 drops each, 10-tonne rigid trucks\n- Rate RM 1,180 per trip (margin 21.4% after diesel at RM 3.35/l and tolls)\n- 13-week total RM 46,020 before SST\n\nThe margin check passed (floor 18%). The price is a draft: please confirm before it goes out.",
      plan=["Check last year's Mega Mart rates", "Cost a trip (fuel, tolls, driver)", "Check the margin", "Draft the quotation"]),
    T(c="N", r="sales", title="Follow-up drafts for 6 open quotations", status="done",
      labels=["follow-up"], age=3.2,
      brief="Draft short, friendly follow-ups for quotations sent more than 10 days ago with no reply.",
      result="Six follow-up drafts are ready (English and Bahasa Melayu where the customer wrote in BM). The two largest are Borneo Fresh (RM 28,400) and Kilang Roti Seri (RM 17,900). None were sent."),
    T(c="N", r="sales", title="Price and margin check: cold-chain rates to Penang", status="done",
      labels=["pricing"], age=6.0,
      brief="Check whether our current cold-chain rate to Penang (RM 2,650 per trip) still clears the 20% margin floor.",
      result="**Margin is 17.2%, under the 20% floor.** Diesel and reefer fuel went up 9% since the rate was set in March. A rate of RM 2,760 per trip brings the margin back to 20.4%.",
      plan=["Cost a Penang reefer trip", "Compare with current rate", "Suggest a new rate"]),
    T(c="N", r="sales", title="Draft proposal: Seri Murni Foods warehouse and last-mile", status="blocked",
      labels=["proposal"], age=0.3,
      brief="Seri Murni Foods asked for a combined warehousing (800 pallets) and last-mile proposal. Research their outlets and draft the proposal.",
      plan=[("Read the enquiry", "done"), ("Research their outlet list", "doing"), ("Cost warehousing and last-mile", "todo"), ("Draft the proposal", "todo")]),
    T(c="N", r="operations", title="Daily dispatch summary: Shah Alam hub", status="done",
      labels=["dispatch"], age=0.15, sched="dispatch",
      brief="Summarise today's dispatch: trips planned vs done, late departures and anything stuck.",
      result="**46 of 48 trips left on time.** Two late departures (WVB 2209, WXK 4471) waited for the 7:30 cross-dock. One load (Seri Murni, 6 pallets) is held for a missing DO, Customer Service is chasing it."),
    T(c="N", r="operations", title="Late deliveries this week: causes and owners", status="done",
      labels=["delivery"], age=2.1,
      brief="List every late delivery this week with the cause and who owns the fix.",
      result="9 late deliveries out of 231 (3.9%, target under 5%).\n\n| Cause | Count | Owner | Fix by |\n|---|---:|---|---|\n| Cross-dock wait | 4 | Hub supervisor | Mon |\n| Customer receiving closed | 3 | Customer Service | Book slots |\n| Breakdown (WXK 4471) | 2 | Workshop | Service done Thu |",
      plan=["Pull POD timestamps", "Group late drops by cause", "Assign owners"]),
    T(c="N", r="operations", title="Vehicle service schedule for October", status="done",
      labels=["fleet"], age=5.0,
      brief="Plan October services so that no more than 2 trucks are off the road on any day.",
      result="14 trucks due a service in October, planned over 9 working days with at most 2 off the road per day. Peak weeks (Mega Mart deliveries) are kept clear."),
    T(c="N", r="operations", title="Turn ops meeting notes into action items (30 Sep)", status="done",
      labels=["meeting"], age=4.0,
      brief="Turn the notes from the 30 Sep operations meeting into decisions and action items with owners and dates.",
      result="**3 decisions, 7 action items.** Decisions: start the 7:00 cross-dock from 7 Oct; pilot route optimisation on the Klang North run; move tyre changes to Saturday. All 7 actions have an owner and a date."),
    T(c="N", r="hr", title="Draft job ad: Warehouse Supervisor (Shah Alam)", status="done",
      labels=["hiring"], age=8.0,
      brief="Draft a job ad for a warehouse supervisor at the Shah Alam hub, in English and Bahasa Melayu.",
      result="Job ad drafted in both languages, using the salary band from the HR policy (RM 3,800 to RM 4,500) and the standard benefits list. Ready for JobStreet and Hiredly."),
    T(c="N", r="hr", title="Leave balance summary for drivers", status="done",
      labels=["leave"], age=11.0,
      brief="Summarise annual leave balances for all 38 drivers and flag anyone with more than 10 days left for the year.",
      result="7 drivers have more than 10 days of leave left. Suggested spreading them over November so the December peak is fully staffed."),
    T(c="N", r="hr", title="Update onboarding checklist for new drivers", status="review",
      labels=["onboarding"], age=1.0,
      brief="Update the driver onboarding checklist with the new GDL renewal check and the defensive driving module.",
      result="Checklist updated: added the GDL and PSV expiry check, the defensive driving module (half day) and the fuel card handover form. The changes are marked in the attached draft.",
      plan=["Read the current checklist", "Add the new checks", "Mark the changes"]),
    T(c="N", r="customer_service", title="Reply drafts: 9 delivery-status enquiries", status="done",
      labels=["enquiry"], age=0.6,
      brief="Draft replies to this morning's 9 delivery-status enquiries using the POD data.",
      result="9 replies drafted. 7 were delivered (POD attached), 1 is out for delivery (ETA 3pm) and 1 is held for a missing DO."),
    T(c="N", r="customer_service", title="Complaint summary: damaged cartons (Seri Murni)", status="done",
      labels=["complaint"], age=7.0,
      brief="Summarise the damaged-carton complaint from Seri Murni and what we know from the loading photos.",
      result="Complaint covers 14 cartons on 2 pallets (SO-24817). Loading photos show the pallets were intact at departure; the damage matches a load shift. Suggested a goodwill credit and a load-bar check on WVB 2209."),
    T(c="N", r="customer_service", title="Credit note request for order SO-24817", status="blocked",
      labels=["complaint"], age=0.2,
      brief="Prepare the credit note request for the 14 damaged cartons on SO-24817 and the apology letter.",
      plan=[("Confirm damaged quantity", "done"), ("Compute the credit", "done"), ("Ask for approval of the amount", "doing"), ("Draft the apology letter", "todo")]),
    T(c="N", r="purchasing", title="Reorder plan: pallets, stretch film and cartons", status="done",
      labels=["purchasing"], age=2.9,
      brief="Check stock against the 4-week usage and plan reorders for pallets, stretch film and cartons.",
      result="Reorder now: **stretch film (120 rolls)** and **cartons size B (2,000)**. Pallets are fine for 5 weeks.\n\n| Item | On hand | 4-week use | Reorder |\n|---|---:|---:|---:|\n| Stretch film (rolls) | 38 | 96 | 120 |\n| Cartons size B | 1,150 | 2,400 | 2,000 |\n| Pallets | 640 | 420 | 0 |"),
    T(c="N", r="purchasing", title="Compare 3 quotes for forklift rental", status="done",
      labels=["quotes"], age=12.0,
      brief="Compare three quotes for renting two 3-tonne forklifts for 12 months.",
      result="**Lift Prima is the best value at RM 4,150 per month** including service and a standby unit. Cheaper per month than Jentera Maju once breakdown cover is added."),
    T(c="N", r="purchasing", title="Submit PO on supplier portal: stretch film 120 rolls", status="blocked",
      labels=["purchasing"], age=0.1,
      brief="Raise and submit the purchase order for 120 rolls of stretch film on the supplier portal (approved in the reorder plan).",
      plan=[("Sign in to the supplier portal", "done"), ("Fill the PO form", "done"), ("Submit the PO", "doing")]),
    T(c="N", r="purchasing", title="Stock count variance: Bay C", status="running",
      labels=["inventory"], age=0.02,
      brief="Explain the variance between the system stock and the cycle count for Bay C.",
      plan=[("Load the cycle count", "done"), ("Match against the system stock", "doing"), ("List variances over 2%", "todo")]),
    # Harmoni Engineering
    T(c="H", r="finance", title="Progress claim #7: cash-flow impact", status="done",
      labels=["cash-flow"], age=3.0,
      brief="Progress claim #7 for the Kuantan drainage project was certified at RM 684,000. Show the cash-flow impact with 5% retention and 30-day payment.",
      result="Net receipt **RM 649,800** expected in week 44 after 5% retention (RM 34,200). It covers the October subcontractor payments with RM 112,000 to spare."),
    T(c="H", r="finance", title="Retention sum tracker update", status="done",
      labels=["retention"], age=6.5,
      brief="Update the retention tracker for all 3 active projects and list retention due for release in the next 90 days.",
      result="RM 418,600 held in retention across 3 projects. **RM 96,200 is due for release in November** (Seremban school block, end of defects liability period)."),
    T(c="H", r="finance", title="Monthly management report: September", status="done",
      labels=["management-report"], age=2.0, sched="monthly",
      brief="Monthly management report: project margins, cash, claims and retention, and what needs attention.",
      result="September revenue RM 2.31m (budget RM 2.2m). Gross margin 14.8% vs 15.5% budget, mainly rebar prices on the Kuantan job. Cash RM 1.04m. See the published report for tables."),
    T(c="H", r="finance", title="Cost-to-complete model: Kuantan drainage upgrade", status="blocked",
      labels=["forecast"], age=0.25,
      brief="Build a cost-to-complete model for the Kuantan drainage upgrade from the latest valuation and committed costs.",
      plan=[("Load the latest valuation", "done"), ("Load committed costs", "done"), ("Run the cost-to-complete model", "doing"), ("Summarise the forecast margin", "todo")]),
    T(c="H", r="sales", title="Tender shortlist: this week's open tenders", status="done",
      labels=["tender"], age=1.5,
      brief="From this week's open tenders, shortlist the ones that fit our CIDB G7 grade, civil works and the Klang Valley / Pahang area.",
      result="**4 of 23 open tenders fit.** Best fit: drainage and road upgrading in Temerloh (closes in 16 days, est. RM 6.8m). The shortlist with closing dates and required documents is in the report."),
    T(c="H", r="sales", title="Company profile refresh for prequalification", status="review",
      labels=["profile"], age=0.9,
      brief="Refresh the company profile for the KLCC Holdings prequalification: completed projects, certifications and key staff.",
      result="Company profile updated with 4 projects completed this year, the renewed ISO 9001 certificate and the new project director. Draft is in Documents for your review."),
    T(c="H", r="operations", title="Weekly site progress summary: 3 sites", status="done",
      labels=["site-progress"], age=2.4, sched="site",
      brief="Summarise progress on the 3 active sites against plan, with photos from the site diaries.",
      result="| Site | Planned | Actual | Status |\n|---|---:|---:|---|\n| Kuantan drainage | 62% | 59% | 3% behind (rain) |\n| Seremban school block | 96% | 96% | On track, handover 18 Oct |\n| Rawang warehouse | 18% | 21% | Ahead |\n\nKuantan can recover with a Saturday shift for 3 weeks."),
    T(c="H", r="operations", title="Toolbox meeting notes to actions (Site B)", status="done",
      labels=["safety"], age=5.5,
      brief="Turn the toolbox meeting notes from Site B into actions.",
      result="4 actions: replace 2 damaged harnesses, re-brief scaffolding tags, add a spotter for the excavator swing, and refresh the first-aid box. All owned by the site supervisor, due this week."),
    T(c="H", r="hr", title="CIDB green card renewals due in 60 days", status="done",
      labels=["compliance"], age=10.0,
      brief="List workers whose CIDB green card expires in the next 60 days.",
      result="11 workers have a green card expiring before 3 December. Renewal course booked for 19 October for 8 of them; 3 are subcontractor staff (letters drafted to their employers)."),
    T(c="H", r="customer_service", title="Reply to Bina Jaya on the defect list", status="done",
      labels=["defects"], age=8.5,
      brief="Draft a reply to Bina Jaya's defect list for the Seremban school block.",
      result="Reply drafted: 18 of 22 defects closed with photos, 4 scheduled for next week with dates. Polite and specific, ready for the project manager to sign."),
    T(c="H", r="project_coordinator", title="Look-ahead schedule: Kuantan drainage (3 weeks)", status="blocked",
      labels=["schedule"], age=0.15,
      brief="Prepare the 3-week look-ahead schedule for the Kuantan drainage upgrade and set it to refresh every Monday.",
      plan=[("Read the master programme", "done"), ("Draft the 3-week look-ahead", "done"), ("Set a weekly refresh", "doing")]),
    T(c="H", r="project_coordinator", title="Subcontractor submittal log update", status="done",
      labels=["submittals"], age=4.5,
      brief="Update the submittal log and list anything overdue for approval.",
      result="46 submittals logged; 5 overdue for consultant approval (oldest: precast culvert shop drawings, 12 days). Reminder drafted to the consultant."),
    T(c="H", r="project_coordinator", title="RFI log: open items for the client meeting", status="review",
      labels=["rfi"], age=0.5,
      brief="Summarise the open RFIs for Thursday's client meeting.",
      result="7 open RFIs. Two affect the programme: RFI-031 (culvert invert levels) and RFI-034 (utility diversion at CH 1+250). Suggested asking for answers by 10 October."),
    T(c="H", r="quantity_surveyor", title="BQ check: variation order VO-12 (rebar price)", status="done",
      labels=["variation"], age=7.5,
      brief="Check the rebar price adjustment in VO-12 against the BQ and the published price index.",
      result="VO-12 is **RM 38,640 too high**: it used the August spot price instead of the contract's index formula. The corrected value is RM 211,360. Workings attached.",
      plan=["Read VO-12 and the BQ", "Apply the index formula", "Compare and explain the difference"]),
    T(c="H", r="quantity_surveyor", title="Compare 3 ready-mix concrete quotes", status="done",
      labels=["quotes"], age=13.0,
      brief="Compare three ready-mix concrete quotes (G30, 1,200 m3) for the Rawang warehouse.",
      result="**Konkrit Utama is cheapest at RM 268/m3** delivered, with a 2-hour slot guarantee. Total saving vs the next quote: RM 14,400."),
    T(c="H", r="quantity_surveyor", title="Interim valuation #8 draft", status="running",
      labels=["valuation"], age=0.03,
      brief="Draft interim valuation #8 for the Kuantan drainage upgrade from the site measurements.",
      plan=[("Read the site measurements", "done"), ("Price the work done", "doing"), ("Add materials on site", "todo"), ("Draft the valuation", "todo")]),
    T(c="H", r="quantity_surveyor", title="Material price index update (steel and cement)", status="ready",
      labels=["pricing"], age=0.01,
      brief="Update the material price index sheet with the October steel and cement prices."),
    # Farid's AI worker (Finance, Nusantara)
    T(c="N", r="twin", title="Match supplier invoices to GRNs (week 40)", status="done",
      labels=["accounts-payable"], age=0.12,
      brief="Match this week's supplier invoices to goods received notes and list any that do not match.",
      result="**58 of 61 invoices match** a GRN. 3 need Farid's eye: two price differences on stretch film (RM 0.40/roll) and one invoice with no GRN yet (cartons, delivered Friday)."),
    T(c="N", r="twin", title="Chase 4 overdue customer payments", status="review",
      labels=["collections"], age=0.08,
      brief="Draft reminders for the 4 customers more than 45 days overdue.",
      result="4 reminder drafts ready, polite and with the invoice copies attached. Total overdue RM 63,280."),
    T(c="N", r="twin", title="Petty cash summary: September", status="running",
      labels=["petty-cash"], age=0.01,
      brief="Summarise September petty cash by category and flag receipts over RM 200.",
      plan=[("Read the petty cash log", "done"), ("Group by category", "doing"), ("Flag large receipts", "todo")]),
    T(c="N", r="twin", title="Weekly AP ageing", status="done",
      labels=["accounts-payable"], age=0.2,
      brief="Weekly accounts payable ageing.",
      result="AP total RM 742,100; nothing over 60 days. RM 128,400 falls due this week."),
]

# Older finished work so the charts have a month of history (title, role, labels).
HISTORY = [
    ("N", "operations", "Daily dispatch summary: Shah Alam hub", ["dispatch"]),
    ("N", "customer_service", "Reply drafts: delivery-status enquiries", ["enquiry"]),
    ("N", "finance", "13-week cash-flow forecast", ["cash-flow"]),
    ("N", "sales", "Follow-up drafts for open quotations", ["follow-up"]),
    ("N", "purchasing", "Weekly stock check: packaging", ["inventory"]),
    ("H", "operations", "Weekly site progress summary", ["site-progress"]),
    ("H", "project_coordinator", "Site diary summary", ["site-progress"]),
    ("H", "quantity_surveyor", "Subcontractor claim check", ["valuation"]),
    ("H", "sales", "Tender shortlist", ["tender"]),
    ("H", "finance", "Supplier payment run proposal", ["payments"]),
]

TOOL_STEPS = {
    "finance": [("read_file", "Read a file", "Read bank_statement_sep.csv (412 rows)"), ("forecast", "Forecast a series", "13 weeks forecast, closing balance min RM 286,400 in week 45"), ("finance_calc", "Finance calculator", "Effective rate 4.95% per year")],
    "sales": [("finance_calc", "Finance calculator", "Margin 21.4% at RM 1,180 per trip"), ("draft_document", "Draft a document", "Drafted QT-2610-0031"), ("web_search", "Search the web", "5 results")],
    "operations": [("read_file", "Read a file", "Read pod_export.csv (231 rows)"), ("calc", "Calculator", "9 / 231 = 3.9%"), ("publish_report", "Publish a report", "Report published")],
    "hr": [("search_library", "Search the library", "3 passages from HR Policy 2026"), ("draft_document", "Draft a document", "Drafted the job ad")],
    "customer_service": [("search_library", "Search the library", "2 passages from Customer Service Standards"), ("read_file", "Read a file", "Read the POD export"), ("draft_document", "Draft a document", "Drafted 9 replies")],
    "purchasing": [("read_file", "Read a file", "Read stock_bay_c.xlsx"), ("calc", "Calculator", "Reorder 120 rolls"), ("forecast", "Forecast a series", "4-week usage 96 rolls")],
    "project_coordinator": [("read_file", "Read a file", "Read master_programme_rev4.pdf (38 pages)"), ("calc", "Calculator", "Float 6 days"), ("publish_report", "Publish a report", "Report published")],
    "quantity_surveyor": [("read_file", "Read a file", "Read VO-12.pdf (6 pages)"), ("finance_calc", "Finance calculator", "Adjusted value RM 211,360"), ("run_python", "Run Python code", "Variance table computed")],
    "twin": [("read_file", "Read a file", "Read the invoice batch (61 invoices)"), ("calc", "Calculator", "Total RM 63,280"), ("draft_document", "Draft a document", "Drafted 4 reminders")],
}

GROUP_MODEL = {
    "smart": ("OpenAI", "gpt-4.1-mini"),
    "fast": ("Groq", "llama-3.1-8b-instant"),
    "bulk": ("Gemini", "gemini-2.5-flash"),
}
def tool_args(tool: str, preview: str) -> str:
    """What a step's arguments look like on the monitor (short, like the real thing)."""
    if tool == "read_file" and "Read " in preview:
        return '{"file": "' + preview.split("Read ", 1)[1].split(" (")[0] + '"}'
    return {
        "forecast": '{"series": "weekly_net_cash", "periods": 13}',
        "finance_calc": '{"op": "effective_rate", "flat_rate": 2.65, "years": 5}',
        "calc": '{"expression": "9 / 231 * 100"}',
        "publish_report": '{"title": "Weekly summary"}',
        "draft_document": '{"template": "Quotation"}',
        "web_search": '{"query": "cold chain rates Penang 2026"}',
        "search_library": '{"query": "annual leave drivers"}',
        "run_python": '{"code": "df.groupby(\\"item\\").sum()"}',
    }.get(tool, "{}")


PRICES = {"gpt-4.1-mini": (0.40, 1.60), "gpt-4o-mini": (0.15, 0.60), "o4-mini": (1.10, 4.40)}


def plan_steps(raw: list[Any], final: bool) -> list[dict[str, str]]:
    out = []
    for s in raw:
        if isinstance(s, tuple):
            out.append({"text": s[0], "status": s[1]})
        else:
            out.append({"text": s, "status": "done" if final else "todo"})
    return out


# ---------------------------------------------------------------- seed


async def seed() -> None:  # noqa: C901, PLR0912, PLR0915 - one long, linear script
    from sqlalchemy import select, text, update

    from agentic.agents.twin import twin_of
    from agentic.brain import store as brain_store
    from agentic.core import crypto
    from agentic.core.db import SessionLocal, engine
    from agentic.core.ids import new_id
    from agentic.core.security import hash_password
    from agentic.documents import service as doc_service
    from agentic.engine import store as engine_store
    from agentic.knowledge import indexer
    from agentic.models import (
        SOP,
        Agent,
        AgentMessage,
        AIModel,
        AIProvider,
        Approval,
        AuditLog,
        Blueprint,
        Branch,
        BrainDream,
        BrainFact,
        Broadcast,
        BroadcastReceipt,
        ChatSession,
        CompanyKit,
        Credential,
        Department,
        DocFile,
        DocTemplate,
        Document,
        DocumentVersion,
        Event,
        JobRun,
        LLMCall,
        McpServer,
        Meeting,
        MeetingTurn,
        Membership,
        ModelGroup,
        Pack,
        ProviderCheck,
        Report,
        Schedule,
        Skill,
        SkillEvalCase,
        SkillProposal,
        SkillUse,
        SkillVersion,
        Task,
        TaskEvent,
        User,
        Workflow,
        WorkflowRun,
        Workspace,
    )
    from agentic.services import audit as audit_mod
    from agentic.skills import store as skill_store
    from agentic.workflows.procedure import clean_graph, layout

    api = Api()
    extra_audit: list[dict[str, Any]] = []

    def audit(ts: datetime, actor: str, action: str, target: str | None = None, after=None, before=None, note=None):
        extra_audit.append(dict(ts=ts, actor=actor, action=action, target=target, after=after, before=before, note=note))

    # ------------------------------------------------ people and companies (real API)
    await api.call(
        "POST",
        "/api/auth/setup",
        {"workspace_name": "Demo Group", "name": "Aminah Rahman", "email": f"owner@{DOMAIN}", "password": PASSWORD},
    )
    branches: dict[str, dict[str, Any]] = {}
    for key, c in COMPANIES.items():
        b = await api.call(
            "POST",
            "/api/branches",
            {"name": c["name"], "color": c["color"], "industry": c["industry"], "starter_team": True, "seed_departments": False},
        )
        branches[key] = b
    async with SessionLocal() as db:
        ws = (await db.scalars(select(Workspace))).one()
        owner = (await db.scalars(select(User).where(User.email == f"owner@{DOMAIN}"))).one()
        for key, b in branches.items():
            # Every company also has a management department (the starter team brings the rest).
            db.add(Department(workspace_id=ws.id, branch_id=b["id"], name="Management", slug="management", position=-1))
        await db.commit()
        depts = {
            (d.branch_id, d.name): d.id
            for d in (await db.scalars(select(Department).where(Department.workspace_id == ws.id))).all()
        }
    bN, bH = branches["N"]["id"], branches["H"]["id"]

    people = [
        ("Suresh Kumar", "suresh", "branch_manager", bN, None),
        ("Farid Hassan", "farid", "staff", bN, depts[(bN, "Finance")]),
        ("Syazwani Omar", "wani", "staff", bH, depts[(bH, "Projects")]),
        ("Ir. Kamal Yusof", "kamal", "admin", None, None),
        ("Christine Lau", "christine", "approver", None, None),
    ]
    for name, local, role, br, dp in people:
        await api.call(
            "POST",
            "/api/members",
            {"email": f"{local}@{DOMAIN}", "name": name, "role": role, "branch_id": br, "department_id": dp},
        )
    async with SessionLocal() as db:
        await db.execute(
            update(User).values(password_hash=hash_password(PASSWORD), must_change_password=False)
        )
        await db.commit()

    # The owner's personal assistant (real API).
    await api.login(f"owner@{DOMAIN}")
    await api.call("POST", "/api/assistants", {"preset": "chief_of_staff", "name": "Aminah's Chief of Staff"})

    # Farid meets and hires his AI worker (real API), without the first task or duties.
    await api.login(f"farid@{DOMAIN}")
    await api.call(
        "POST",
        "/api/me/twin",
        {
            "name": "Farid's AI worker",
            "role": "Accounts Executive (AI)",
            "job": "Accounts payable and receivable for Nusantara Logistics: invoice matching, payment reminders, petty cash and weekly ageing reports.",
            "style": "Short, clear, numbers first.",
            "languages": ["English", "Bahasa Melayu"],
            "polish": False,
        },
    )
    # A Malaysian office week (Mon to Sat); today too, so the captures show it at work.
    weekday = (NOW + timedelta(hours=8)).isoweekday()
    days = sorted({1, 2, 3, 4, 5, 6, weekday})
    await api.call(
        "POST",
        "/api/me/worker/hire",
        {
            "work_hours": {"tz": "Asia/Kuala_Lumpur", "days": days, "start": "08:00", "end": "21:00", "breaks": [{"start": "13:00", "end": "14:00"}], "urgent_anytime": True},
            "duties": [],
        },
    )
    await api.login(f"owner@{DOMAIN}")
    await api.close()

    # ------------------------------------------------ everything else (direct, backdated)
    async with SessionLocal() as db:
        ws = await db.get(Workspace, ws.id)
        users = {u.email.split("@")[0]: u for u in (await db.scalars(select(User))).all()}
        owner = users["owner"]
        uact = lambda local: f"user:{users[local].id}"  # noqa: E731
        settings_ = dict(ws.settings or {})
        settings_["skill_learning"] = {"mode": "auto_safe"}
        settings_["quality"] = {"self_check": True}
        ws.settings = settings_

        agents_all = list((await db.scalars(select(Agent).where(Agent.workspace_id == ws.id))).all())
        twin = await twin_of(db, ws.id, users["farid"].id)
        assistant = next(a for a in agents_all if a.private)
        role_of = {}
        for a in agents_all:
            if a.is_twin or a.private:
                continue
            key = "N" if a.branch_id == bN else "H"
            for spec_key, role in (
                ("finance", "Finance & Accounts Officer"), ("sales", "Sales & Marketing Executive"),
                ("operations", "Operations Coordinator"), ("hr", "HR & Admin Officer"),
                ("customer_service", "Customer Service Officer"), ("purchasing", "Purchasing & Inventory Officer"),
                ("project_coordinator", "Project Coordinator"), ("quantity_surveyor", "Quantity Surveyor (QS)"),
            ):
                if a.role == role:
                    role_of[(key, spec_key)] = a
        role_of[("N", "twin")] = twin
        # Fixed first names, so every run shows the same team (the starter picks by branch id).
        fixed = {
            "N": {"finance": "Aisyah", "sales": "Jason", "operations": "Ravi", "hr": "Priya", "customer_service": "Joanne", "purchasing": "Mei Xin"},
            "H": {"finance": "Kavitha", "sales": "Hafiz", "operations": "Zul", "hr": "Grace", "customer_service": "Syafiq", "project_coordinator": "Izzat", "quantity_surveyor": "Rashid"},
        }
        from agentic.org.starter import team_for
        shorts = {a.key: a.short for a in team_for("engineering") + team_for("trading")}
        for (key, rk), a in role_of.items():
            if rk == "twin":
                continue
            a.name = f"{fixed[key][rk]} ({shorts[rk]})"
            a.slug = f"{fixed[key][rk].lower().replace(' ', '-')}-{rk.replace('_', '-')}-{key.lower()}"

        # A lead agent per company that the others report to (an org chart with a top).
        for key, b in (("N", bN), ("H", bH)):
            fin = role_of[(key, "operations")]
            for (k2, rk), a in role_of.items():
                if k2 == key and rk not in ("operations", "twin"):
                    a.reports_to = fin.id
            fin.role_kind = "orchestrator"
        twin.reports_to = role_of[("N", "finance")].id
        role_of[("N", "finance")].heartbeat = True
        role_of[("H", "project_coordinator")].heartbeat = True
        role_of[("N", "finance")].budget_monthly_usd = 25
        role_of[("H", "quantity_surveyor")].budget_monthly_usd = 20

        # Back-date who joined when.
        created = ago(42)
        ws.created_at = created
        for i, u in enumerate(users.values()):
            u.created_at = created + timedelta(hours=i * 7)
            u.last_login_at = ago(hours=RNG.uniform(1, 30))
        for b in (await db.scalars(select(Branch))).all():
            b.created_at = ago(41)
        for a in agents_all:
            a.created_at = ago(40, hours=RNG.uniform(0, 5))
        twin.created_at = ago(21)
        assistant.created_at = ago(18)
        await db.commit()

        # ------------------------------------------------ AI engine
        groups = {g.name: g for g in await engine_store.ensure_default_groups(db, ws.id)}
        provs: dict[str, AIProvider] = {}
        prov_specs = [
            ("OpenAI", "openai", "https://api.openai.com/v1", "paid", 10, ["gpt-4.1-mini", "gpt-4o-mini", "o4-mini", "gpt-image-1", "gpt-4o-mini-transcribe"]),
            ("Groq", "groq", "https://api.groq.com/openai/v1", "free", 20, ["llama-3.1-8b-instant", "llama-3.3-70b-versatile", "whisper-large-v3-turbo"]),
            ("Gemini", "gemini", "https://generativelanguage.googleapis.com/v1beta/openai", "free", 30, ["gemini-2.5-flash", "gemini-2.5-pro"]),
            ("Local backup", None, "http://ollama:11434/v1", "local", 990, ["qwen3:0.6b"]),
        ]
        for name, preset, url, tier, prio, models in prov_specs:
            pv = AIProvider(workspace_id=ws.id, name=name, preset=preset, base_url=url, tier=tier, priority=prio, enabled=True, health="ok", last_test_at=ago(minutes=12), last_test_result={"ok": True, "latency_ms": RNG.randint(240, 900), "models": len(models)})
            db.add(pv)
            await db.flush()
            fake = "local" if tier == "local" else f"demo-not-a-real-key-{new_id('k')[-12:]}"
            engine_store.set_provider_key(pv, fake)
            pv.created_at = ago(40)
            for m in models:
                pin, pout = PRICES.get(m, (None, None))
                db.add(AIModel(workspace_id=ws.id, provider_id=pv.id, model_id=m, context_window=128000 if tier != "local" else 4096, caps={"tools": True, "json": True, "vision": m in ("gpt-4.1-mini", "gpt-4o-mini", "gemini-2.5-flash")}, price_in=pin if tier == "paid" else (0 if tier != "paid" else None), price_out=pout if tier == "paid" else (0 if tier != "paid" else None), last_seen_at=ago(minutes=12)))
            provs[name] = pv
            for h in range(96):  # a health check every 30 minutes for two days
                db.add(ProviderCheck(provider_id=pv.id, ts=ago(minutes=30 * h + 7), ok=True, latency_ms=RNG.randint(180, 950) if tier != "local" else RNG.randint(60, 140), source="scheduled"))
        await db.flush()

        def mem(prov: str, model: str) -> dict[str, str]:
            return {"provider_id": provs[prov].id, "model_id": model}

        group_members = {
            "smart": [mem("OpenAI", "gpt-4.1-mini"), mem("Gemini", "gemini-2.5-flash")],
            "fast": [mem("Groq", "llama-3.1-8b-instant"), mem("OpenAI", "gpt-4o-mini"), mem("Local backup", "qwen3:0.6b")],
            "bulk": [mem("Gemini", "gemini-2.5-flash"), mem("Groq", "llama-3.3-70b-versatile")],
            "reasoning": [mem("OpenAI", "o4-mini"), mem("Gemini", "gemini-2.5-pro")],
            "vision": [mem("OpenAI", "gpt-4o-mini"), mem("Gemini", "gemini-2.5-flash")],
            "local": [mem("Local backup", "qwen3:0.6b")],
        }
        for gname, g in groups.items():
            if gname in group_members:
                g.members = group_members[gname]
            elif "transcribe" in gname or "speech" in g.label.lower():
                g.members = [mem("Groq", "whisper-large-v3-turbo"), mem("OpenAI", "gpt-4o-mini-transcribe")]
            elif "image" in gname:
                g.members = [mem("OpenAI", "gpt-image-1")]
        await db.commit()

        # ------------------------------------------------ company kits, templates
        for key, b in (("N", bN), ("H", bH)):
            db.add(CompanyKit(branch_id=b, workspace_id=ws.id, data=COMPANIES[key]["kit"], updated_by=uact("owner")))
        await db.commit()
        await doc_service.ensure_starters(db, ws.id)
        site_tpl = DocTemplate(
            workspace_id=ws.id, branch_id=bH, name="Site visit report", kind="report", prefix="SVR",
            description="One page after every site visit: progress, issues, photos and actions.",
            body="# Site visit report\n\n**Report no.:** {{doc.number}}\n**Date:** {{doc.date}}\n**Site:** {{site}}\n**Visited by:** {{visited_by}}\n\n## Progress\n{{progress}}\n\n## Issues\n{{issues}}\n\n## Actions\n{{actions}}\n",
            fields=[{"key": "site", "label": "Site", "type": "text", "required": True, "hint": ""}, {"key": "visited_by", "label": "Visited by", "type": "text", "required": True, "hint": ""}, {"key": "progress", "label": "Progress", "type": "longtext", "required": False, "hint": ""}, {"key": "issues", "label": "Issues", "type": "longtext", "required": False, "hint": ""}, {"key": "actions", "label": "Actions", "type": "longtext", "required": False, "hint": ""}],
            builtin=False, created_by=uact("kamal"),
        )
        db.add(site_tpl)
        await db.commit()
        tpls = {t.name: t for t in (await db.scalars(select(DocTemplate).where(DocTemplate.workspace_id == ws.id))).all()}

        # ------------------------------------------------ SOPs
        sop_specs = [
            ("workspace", None, "Customer communication standards", "## Purpose\nEvery message to a customer is clear, polite and correct.\n\n## Rules\n1. Reply to enquiries within 4 working hours.\n2. Use the customer's language (English or Bahasa Melayu).\n3. Quote order, invoice or DO numbers in every reply.\n4. Never promise a delivery date or discount without the manager's approval.\n5. Prices, credit notes and apologies are drafts for a person to approve and send."),
            ("workspace", None, "Approval limits", "## Who approves what\n| Item | Up to | Approver |\n|---|---:|---|\n| Purchase order | RM 5,000 | Branch manager |\n| Purchase order | above RM 5,000 | Managing Director |\n| Credit note | RM 1,000 | Branch manager |\n| Any payment | any amount | Finance + MD |\n\nAgents never approve their own work; they ask a person."),
            ("branch", bN, "Goods receiving and GRN", "1. Check the DO against the PO: item, quantity, batch.\n2. Inspect for damage; photograph any damaged carton.\n3. Count pallets and record the bay.\n4. Raise the GRN in the system the same day.\n5. Send discrepancies to Purchasing within 24 hours."),
            ("department", depts[(bH, "Finance")], "Month-end closing", "1. Cut-off for supplier invoices: 3rd working day.\n2. Accrue certified progress claims not yet invoiced.\n3. Update the retention tracker.\n4. Reconcile all bank accounts.\n5. Management report to directors by the 8th working day."),
            ("library", None, "Tender submission checklist", "- Form of tender signed and stamped\n- CIDB, SPKK and STB certificates (valid)\n- SSM company profile (not older than 3 months)\n- Audited accounts (last 3 years)\n- Bank statements (last 3 months)\n- Site visit attendance slip\n- Priced BQ, signed on every page"),
        ]
        sops = []
        for scope, sid, title, body in sop_specs:
            s = SOP(workspace_id=ws.id, scope=scope, scope_id=sid, title=title, body=body, version=RNG.choice([1, 2, 3]), updated_by=uact("owner"))
            db.add(s)
            sops.append(s)
        await db.commit()
        for s in sops:
            s.created_at = ago(RNG.uniform(20, 38))
            s.updated_at = ago(RNG.uniform(1, 15))
            await indexer.index_sop(db, s.id)
        await db.commit()

        # ------------------------------------------------ library and files
        lib_specs = [
            ("HR Policy 2026.md", bN, None, "HR policy", "HR Policy 2026",
             "# HR Policy 2026\n\n## Working hours\nOffice staff work 9:00 to 18:00, Monday to Friday, with a one-hour lunch break. Hub staff work in shifts as rostered.\n\n## Annual leave\nStaff get 14 days of annual leave in their first two years, 16 days from year three and 18 days from year five. Apply at least 7 days ahead; drivers apply 14 days ahead in November and December.\n\n## Medical leave\n14 days a year with a medical certificate from a registered clinic.\n\n## Salary bands\n| Position | Band (RM) |\n|---|---|\n| Driver (GDL) | 2,600 to 3,400 |\n| Warehouse assistant | 2,200 to 2,800 |\n| Warehouse supervisor | 3,800 to 4,500 |\n| Accounts executive | 3,500 to 4,800 |\n\n## Claims\nSubmit mileage and outstation claims by the 5th of the next month with receipts."),
            ("Customer Service Standards.md", None, None, "Policy", "Customer Service Standards",
             "# Customer Service Standards\n\n## Response times\n- Delivery-status enquiries: within 2 working hours.\n- Complaints: acknowledge within 4 hours, full reply within 2 working days.\n\n## Damaged goods\n1. Ask for photos and the DO number.\n2. Check loading photos and the POD.\n3. Offer a credit note within the approval limits; anything above goes to the branch manager.\n\n## Tone\nPolite, specific, no blame. Always end with the next step and a date."),
            ("Site Safety Guidelines (HIRARC).md", bH, None, "Safety guideline", "Site Safety Guidelines",
             "# Site Safety Guidelines\n\n## Before work starts\nEvery activity has a HIRARC (hazard identification, risk assessment and risk control) signed by the site safety supervisor.\n\n## Toolbox meetings\nEvery morning, 10 minutes, attendance recorded.\n\n## Working at height\nFull-body harness above 2 metres. Scaffolds are tagged green (safe), yellow (restricted) or red (do not use) and inspected weekly.\n\n## Excavation\nShoring or battering beyond 1.5 metres deep. A spotter for every excavator swing near people."),
        ]
        files = []
        for name, br, dept, kind, title, body in lib_specs:
            f = await doc_service.create_file(db, workspace_id=ws.id, name=name, data=body.encode(), created_by=uact("owner"), mime="text/markdown", branch_id=br, status="ready")
            f.text = body
            f.library = True
            f.department_id = dept
            f.kind, f.title = kind, title
            f.summary = body.split("\n\n", 2)[1][:300] if "\n\n" in body else body[:300]
            f.pages = 1
            files.append(f)
        file_specs = [
            ("Supplier price list Q4 2026.csv", bN, "Price list", "Packaging supplier price list, Q4 2026",
             "item,unit,price_rm\nStretch film 500mm,roll,18.40\nCarton size A,piece,1.85\nCarton size B,piece,2.30\nPallet (new),piece,42.00\nPallet (repaired),piece,24.00\n",
             "Price list from the packaging supplier for October to December 2026: stretch film RM 18.40 a roll, cartons from RM 1.85, new pallets RM 42.", {"supplier": "Sinar Pack Supplies", "valid_until": "31 Dec 2026", "items": "5"}),
            ("Mega Mart outlet list.csv", bN, "Customer data", "Mega Mart Holdings outlets (Klang Valley)",
             "outlet,area,receiving_hours\nMM Klang Sentral,Klang,07:00-11:00\nMM Shah Alam 7,Shah Alam,07:00-10:00\nMM Subang Jaya,Subang,08:00-11:00\nMM Puchong,Puchong,07:00-11:00\n",
             "14 Mega Mart outlets in the Klang Valley with receiving hours (mostly 7am to 11am).", {"customer": "Mega Mart Holdings", "outlets": "14"}),
            ("Kuantan drainage - site measurements Sep.csv", bH, "Measurement sheet", "Kuantan drainage upgrade: September measurements",
             "item,description,unit,qty\nB2.1,Precast U-drain 900mm,m,412\nB2.4,Box culvert 1500x1500,m,36\nC1.2,Excavation in common material,m3,2840\n",
             "Site measurements for September on the Kuantan drainage upgrade: 412 m of precast U-drain, 36 m of box culvert and 2,840 m3 of excavation.", {"project": "Kuantan drainage upgrade", "period": "September 2026"}),
            ("CIDB certificate - Harmoni Engineering.txt", bH, "CIDB certificate", "CIDB registration certificate (G7)",
             "CIDB Malaysia - Certificate of Registration\nContractor: Harmoni Engineering Sdn Bhd\nGrade: G7\nCategories: CE (civil engineering), B (building)\nValid until: 14 March 2027\n",
             "CIDB registration for Harmoni Engineering, grade G7 for civil engineering and building, valid until 14 March 2027.", {"grade": "G7", "valid_until": "14 Mar 2027"}),
        ]
        for name, br, kind, title, body, summary, fields in file_specs:
            f = await doc_service.create_file(db, workspace_id=ws.id, name=name, data=body.encode(), created_by=uact("owner"), mime="text/csv" if name.endswith(".csv") else "text/plain", branch_id=br, status="ready")
            f.text, f.kind, f.title, f.summary, f.fields, f.pages = body, kind, title, summary, fields, 1
            if "CIDB" in name:
                f.expires_on = date(2027, 3, 14)
            files.append(f)
        await db.commit()
        for i, f in enumerate(files):
            f.created_at = ago(RNG.uniform(3, 30))
            if f.library:
                await indexer.index_file(db, f.id)
        await db.commit()

        # ------------------------------------------------ skills
        await skill_store.ensure_builtin(db, ws)
        learned_specs = [
            ("supplier-po-follow-up", "Follow up an open purchase order with a supplier: status, ETA and a polite chaser.", role_of[("N", "purchasing")], 3,
             "1. Find the PO and the promised delivery date.\n2. If it is late or within 2 days, draft a chaser in the supplier's language.\n3. Ask for a firm ETA and the DO number.\n4. Log the reply on the PO.\n5. Escalate to the branch manager if the goods are more than 5 days late."),
            ("fuel-card-reconciliation", "Match a fleet fuel card statement to trip logs and list exceptions.", role_of[("N", "finance")], 2,
             "1. Load the statement and trip logs for the month.\n2. Match each fill-up by vehicle, date and station.\n3. Flag fills on days with no trip and fills above tank size.\n4. Total the exceptions and list them by vehicle."),
            ("site-progress-summary", "Weekly progress summary for each site against plan, with the reason for any slip.", role_of[("H", "operations")], 2,
             "1. Read the site diaries for the week.\n2. Compare actual against planned progress for each site.\n3. Give the reason for any slip over 2%.\n4. Suggest a recovery action with an owner."),
            ("variation-order-check", "Check a variation order against the BQ rates and the contract price-adjustment formula.", role_of[("H", "quantity_surveyor")], 1,
             "1. Read the VO and the BQ items it touches.\n2. Apply the contract's price-adjustment formula (never spot prices).\n3. Show the workings with the finance calculator.\n4. State the corrected value and the difference."),
        ]
        learned = {}
        for name, desc, agent, versions, body in learned_specs:
            s = Skill(workspace_id=ws.id, name=name, description=desc, body=body, version=versions, trust="trusted", created_by=f"agent:{agent.id}", approved_by="system:autopilot" if versions > 1 else uact("owner"), baseline_tokens=RNG.randint(38000, 72000), last_used_at=ago(hours=RNG.uniform(2, 40)), agent_ids=[])
            db.add(s)
            await db.flush()
            s.created_at = ago(RNG.uniform(18, 26))
            for v in range(1, versions + 1):
                db.add(SkillVersion(skill_id=s.id, version=v, description=desc, body=body if v == versions else body.rsplit("\n", 1)[0], created_by=f"agent:{agent.id}" if v == 1 else "curator", approved_by=uact("owner") if v == 1 else "system:autopilot", note="Learned from a finished task" if v == 1 else ("Clearer escalation rule" if v == 2 else "Shorter, same results"), created_at=ago(26 - 7 * v)))
            cases = [
                (f"{name}: typical case", "A typical case from last month.", {"must_contain": ["RM"], "rubric": "Follows every step and shows the figures."}),
                (f"{name}: missing data", "Half the input is missing.", {"must_contain": ["missing"], "rubric": "Asks for the missing data instead of guessing."}),
                (f"{name}: edge case", "An unusual but valid case.", {"rubric": "Handles the case without inventing numbers."}),
            ]
            for title, inp, checks in cases:
                db.add(SkillEvalCase(workspace_id=ws.id, skill_id=s.id, title=title, input=inp, checks=checks, created_by="curator", created_at=ago(20)))
            s.last_eval = {"passed": 3, "total": 3, "tokens": RNG.randint(4000, 9000), "version": versions, "cases": [{"title": c[0], "pass": True, "failures": [], "output": "", "called": [], "tokens": 2400} for c in cases]}
            learned[name] = (s, agent)
        await db.commit()
        all_skills = list((await db.scalars(select(Skill).where(Skill.workspace_id == ws.id))).all())

        def evalres(p_, t_):
            return {"new": {"passed": p_, "total": t_, "tokens": 6200, "cases": []}, "old": {"passed": max(0, p_ - 1), "total": t_, "tokens": 6500, "cases": []}}

        proposals = [
            ("supplier-po-follow-up", "patch", "approved", "system:autopilot", 3.2, "Adds the escalation rule after two unanswered chasers (seen in 3 tasks).", evalres(3, 3), role_of[("N", "purchasing")]),
            ("fuel-card-reconciliation", "patch", "approved", "system:autopilot", 6.0, "Also flags fills above the vehicle's tank size.", evalres(3, 3), role_of[("N", "finance")]),
            ("site-progress-summary", "patch", "approved", uact("owner"), 9.0, "Adds a recovery action with an owner for every slip.", evalres(3, 3), role_of[("H", "operations")]),
            ("variation-order-check", "new", "approved", uact("kamal"), 12.0, "Learned from 'BQ check: variation order VO-12': the index formula, not spot prices.", {"new": {"passed": 3, "total": 3, "tokens": 5400, "cases": []}}, role_of[("H", "quantity_surveyor")]),
            ("debtor-reminder-tone", "new", "pending", None, 0.6, "Learned from 'Chase 4 overdue customer payments': polite reminder wording that got replies, in English and Bahasa Melayu.", {"new": {"passed": 3, "total": 3, "tokens": 4800, "cases": []}}, twin),
            ("site-progress-summary", "patch", "pending", None, 0.3, "Include rain days from the site diary when explaining a slip.", evalres(3, 3), role_of[("H", "operations")]),
            ("delivery-status-reply", "new", "rejected", uact("suresh"), 15.0, "Reply template for delivery-status enquiries.", {"new": {"passed": 1, "total": 3, "tokens": 3900, "cases": []}}, role_of[("N", "customer_service")]),
        ]
        for name, kind, status, by, age_d, reason, ev, agent in proposals:
            sk = learned.get(name, (None,))[0]
            body = sk.body if sk else "1. Read the customer's message and the invoice list.\n2. Draft a short, polite reminder with the invoice numbers and amounts.\n3. Offer instalments when over RM 20,000.\n4. Leave it as a draft for a person to send."
            prop = SkillProposal(workspace_id=ws.id, skill_id=sk.id if sk and kind != "new" else None, kind=kind, name=name, description=sk.description if sk else "Polite payment reminders that get answered.", body=body, base_version=(sk.version - 1 if sk and kind == "patch" and status == "approved" else (sk.version if sk else None)), reason=reason, eval_cases=[], scan=[], eval=ev, proposed_by=f"agent:{agent.id}" if kind == "new" else "curator", agent_id=agent.id, branch_id=agent.branch_id, status=status, decided_by=by, decided_at=ago(age_d - 0.05) if by else None, decision_note=("Proven: passed every test, went live by itself" if by == "system:autopilot" else ("Too generic; our SOP already covers it" if status == "rejected" else None)), created_at=ago(age_d))
            db.add(prop)
        await db.commit()

        # ------------------------------------------------ tasks
        task_rows: list[tuple[Task, dict[str, Any]]] = []
        schedules: dict[str, Schedule] = {}
        sched_specs = {
            "cash": (role_of[("N", "finance")], "Weekly cash-flow forecast", "13-week cash-flow forecast", "Update the rolling 13-week cash-flow forecast and flag any week under RM 250,000.", "0 9 * * 1"),
            "dispatch": (role_of[("N", "operations")], "Daily dispatch summary", "Daily dispatch summary: Shah Alam hub", "Summarise today's dispatch: trips planned vs done, late departures and anything stuck.", "30 17 * * 1-6"),
            "monthly": (role_of[("H", "finance")], "Monthly management report", "Monthly management report", "Project margins, cash, claims and retention.", "0 9 3 * *"),
            "site": (role_of[("H", "operations")], "Friday site progress", "Weekly site progress summary: 3 sites", "Summarise progress on the active sites against plan.", "0 16 * * 5"),
            "ap": (twin, "Weekly AP ageing", "Weekly AP ageing", "Weekly accounts payable ageing.", "0 8 * * 1"),
        }
        for key, (agent, name, title, brief, cron) in sched_specs.items():
            s = Schedule(workspace_id=ws.id, name=name, agent_id=agent.id, title=title, brief=brief, cron=cron, timezone="Asia/Kuala_Lumpur", enabled=True, requires_review=True, created_by=uact("farid") if key == "ap" else uact("owner"), last_run_at=ago(RNG.uniform(0.1, 2)))
            db.add(s)
            schedules[key] = s
        await db.flush()
        for s in schedules.values():
            s.created_at = ago(30)

        def calls_for(t: Task, agent: Agent, start: datetime, n: int) -> None:
            prov, model = GROUP_MODEL.get(agent.model_group, GROUP_MODEL["smart"])
            for i in range(n):
                pt, ct = RNG.randint(2500, 9000), RNG.randint(250, 1400)
                pin, pout = PRICES.get(model, (0, 0))
                cost = (pt * pin + ct * pout) / 1e6 if provs[prov].tier == "paid" else 0
                db.add(LLMCall(workspace_id=ws.id, ts=start + timedelta(seconds=20 * i + RNG.randint(1, 15)), task="agent.step", group_name=agent.model_group, provider_id=provs[prov].id, provider_name=prov, model=model, agent_id=agent.id, task_id=t.id, prompt_tokens=pt, completion_tokens=ct, cached_tokens=RNG.randint(0, pt // 2), cost_usd=round(cost, 6), latency_ms=RNG.randint(700, 4200), status="ok"))

        def add_events(t: Task, agent: Agent, spec: dict[str, Any], start: datetime, final_ts: datetime | None) -> None:
            ev = lambda ts, kind, actor, txt, data=None: db.add(TaskEvent(task_id=t.id, ts=ts, kind=kind, actor=actor, text=txt, data=data))  # noqa: E731
            creator = t.created_by
            ev(t.created_at, "created", creator, "created the task")
            ev(start, "run", creator, "started run 1")
            ev(start + timedelta(seconds=2), "status", "system", "moved it from ready to running", {"from": "ready", "to": "running"})
            steps = spec.get("plan")
            final = t.status in ("done", "review")
            if steps:
                cleaned = plan_steps(steps, final)
                first = [dict(s, status="todo") for s in cleaned]
                first[0]["status"] = "doing"
                ev(start + timedelta(seconds=10), "plan", f"agent:{agent.id}", f"plan: 0/{len(first)} done", {"steps": first})
            tools = TOOL_STEPS.get(spec["r"], [])
            k = 0
            for k, (tool, label, preview) in enumerate(tools):
                ev(start + timedelta(seconds=40 + 35 * k), "tool", f"agent:{agent.id}", f"used {label}", {"tool": tool, "args": {}, "result_preview": preview})
            if steps:
                cleaned = plan_steps(steps, final)
                done_n = sum(1 for s in cleaned if s["status"] in ("done", "skipped"))
                ev(start + timedelta(seconds=60 + 35 * k), "plan", f"agent:{agent.id}", f"plan: {done_n}/{len(cleaned)} done", {"steps": cleaned})
            if final and final_ts:
                if RNG.random() < 0.8:
                    issues = [] if RNG.random() < 0.75 else ["Two figures in the table did not add up to the total; corrected before hand-in."]
                    ev(final_ts - timedelta(seconds=20), "selfcheck", "system", "self-check passed" if not issues else "self-check caught a problem", {"ok": not issues, "checked": True, "issues": issues})
                    if issues:
                        ev(final_ts - timedelta(seconds=10), "selfcheck", "system", "self-check passed", {"ok": True, "checked": True, "issues": []})
                to = "review" if t.requires_review else "done"
                ev(final_ts, "status", f"agent:{agent.id}", f"moved it from running to {to}", {"from": "running", "to": to})
                if t.status == "done" and t.requires_review:
                    ev(final_ts + timedelta(minutes=RNG.randint(8, 120)), "status", t.created_by, "accepted the result", {"from": "review", "to": "done"})

        pos = 1000.0
        for spec in TASKS:
            agent = role_of[(spec["c"], spec["r"])]
            created_at = ago(spec["age"])
            started = created_at + timedelta(minutes=RNG.uniform(0.2, 3))
            final = spec["status"] in ("done", "review")
            finished = started + timedelta(minutes=RNG.uniform(2, 14)) if final else None
            if finished and finished > NOW:
                finished = NOW - timedelta(minutes=2)
            creator = uact("farid") if spec["r"] == "twin" else (uact("suresh") if spec["c"] == "N" and RNG.random() < 0.4 else uact("owner") if spec["c"] == "N" else uact("kamal"))
            sched = schedules.get(spec.get("sched", ""))
            if sched:
                creator = f"schedule:{sched.id}"
            pos += 10
            t = Task(workspace_id=ws.id, branch_id=agent.branch_id, title=spec["title"], brief=spec["brief"], status=spec["status"], priority="high" if spec["status"] == "blocked" or "Quotation" in spec["title"] else "normal", assignee_agent_id=agent.id, created_by=creator, source="schedule" if sched else "manual", requires_review=True, result=spec.get("result"), started_at=started if spec["status"] not in ("ready", "triage") else None, finished_at=finished, run_count=1 if spec["status"] not in ("ready", "triage") else 0, steps_used=RNG.randint(4, 18), position=pos, labels=spec["labels"], schedule_id=sched.id if sched else None, workflow_id=None)
            if spec["status"] == "ready":
                t.blocked_reason = None
            db.add(t)
            await db.flush()
            t.created_at = created_at
            t.updated_at = finished or (ago(minutes=RNG.uniform(1, 20)) if spec["status"] in ("running", "blocked") else created_at)
            if spec["status"] not in ("ready", "triage"):
                add_events(t, agent, spec, started, finished)
                calls_for(t, agent, started, RNG.randint(4, 11) if final else RNG.randint(2, 5))
            task_rows.append((t, spec))
        await db.commit()

        # History: about 25 days of finished work, 3 to 7 tasks a day.
        hist_tasks = []
        for d in range(2, 29):
            for _ in range(RNG.randint(2, 6)):
                c, r, title, labels = RNG.choice(HISTORY)
                agent = role_of[(c, r)]
                start = ago(d, hours=RNG.uniform(0, 9))
                fin = start + timedelta(minutes=RNG.uniform(3, 15))
                day = (NOW - timedelta(days=d)).strftime("%d %b")
                t = Task(workspace_id=ws.id, branch_id=agent.branch_id, title=f"{title} ({day})", brief=title + ".", status="done", priority="normal", assignee_agent_id=agent.id, created_by=uact("owner"), source="manual", requires_review=True, result="Done. See the attached summary.", started_at=start, finished_at=fin, run_count=1, steps_used=RNG.randint(4, 14), position=0, labels=labels)
                db.add(t)
                await db.flush()
                t.created_at, t.updated_at = start - timedelta(minutes=1), fin
                db.add(TaskEvent(task_id=t.id, ts=t.created_at, kind="created", actor=t.created_by, text="created the task"))
                db.add(TaskEvent(task_id=t.id, ts=fin, kind="status", actor=f"agent:{agent.id}", text="moved it from running to review", data={"from": "running", "to": "review"}))
                db.add(TaskEvent(task_id=t.id, ts=fin + timedelta(minutes=30), kind="status", actor=t.created_by, text="accepted the result", data={"from": "review", "to": "done"}))
                calls_for(t, agent, start, RNG.randint(3, 9))
                hist_tasks.append((t, agent))
        await db.commit()

        # Background model use: memory, skills, files (the learning engine's spend).
        for d in range(0, 30):
            for _ in range(RNG.randint(6, 14)):
                task = RNG.choice(["brain.extract", "brain.dream", "skill.reflect", "skill.eval", "file.understand", "colleague.memory", "chat"])
                prov, model = RNG.choice([("Groq", "llama-3.1-8b-instant"), ("Gemini", "gemini-2.5-flash"), ("OpenAI", "gpt-4o-mini"), ("Local backup", "qwen3:0.6b")])
                pt, ct = RNG.randint(800, 4000), RNG.randint(80, 600)
                pin, pout = PRICES.get(model, (0, 0))
                db.add(LLMCall(workspace_id=ws.id, ts=ago(d, hours=RNG.uniform(0, 23)), task=task, group_name="fast" if prov != "Gemini" else "bulk", provider_id=provs[prov].id, provider_name=prov, model=model, agent_id=None, task_id=None, prompt_tokens=pt, completion_tokens=ct, cost_usd=round((pt * pin + ct * pout) / 1e6, 6), latency_ms=RNG.randint(300, 2200), status="ok"))
        await db.commit()

        # Skill uses (the learning page's success rate).
        for t, agent in hist_tasks[: len(hist_tasks) * 2 // 3]:
            s = RNG.choice(all_skills)
            db.add(SkillUse(workspace_id=ws.id, skill_id=s.id, version=s.version, agent_id=agent.id, task_id=t.id, outcome=RNG.choices(["accepted", "sent_back"], [9, 1])[0], tokens=RNG.randint(12000, 40000), created_at=t.started_at))
        await db.commit()

        # ------------------------------------------------ approvals
        by_title = {t.title: t for t, _ in task_rows}
        pending = [
            ("Submit PO on supplier portal: stretch film 120 rolls", "tool", "browser_submit", "high", {"site": "portal.sinarpack.example", "form": "New purchase order", "po_number": "PO-NL-1043", "item": "Stretch film 500mm x 120 rolls", "total": "RM 2,208.00", "deliver_to": "Shah Alam hub, 9 Oct"}, "Submitting the purchase order for 120 rolls of stretch film (RM 2,208.00) approved in the reorder plan. This sends the order to the supplier.", 25),
            ("Cost-to-complete model: Kuantan drainage upgrade", "tool", "run_python", "high", {"code": "import pandas as pd\nboq = pd.read_csv('valuation_7.csv')\ncommitted = pd.read_csv('committed_costs.csv')\nctc = boq.merge(committed, on='item')\nctc['to_complete'] = ctc['budget'] - ctc['spent'] - ctc['committed']\nprint(ctc.groupby('section')['to_complete'].sum())"}, "Running the cost-to-complete calculation over the valuation and committed costs (sealed sandbox, no internet).", 50),
            ("Draft proposal: Seri Murni Foods warehouse and last-mile", "tool", "web_fetch", "medium", {"url": "https://www.serimurni-foods.example/outlets"}, "Reading Seri Murni's public outlet list to cost the last-mile deliveries.", 12),
            ("Credit note request for order SO-24817", "question", "ask_human", "medium", {"question": "May I prepare a credit note of RM 412.50 for the 14 damaged cartons on SO-24817 (14 x RM 29.46)? It is within the RM 1,000 limit for a branch manager."}, "", 8),
            ("Look-ahead schedule: Kuantan drainage (3 weeks)", "tool", "schedule_task", "medium", {"title": "Refresh the 3-week look-ahead", "when": "every Monday at 8:00", "cron": "0 8 * * 1"}, "Setting the look-ahead to refresh every Monday at 8:00 so the site team always has the next 3 weeks.", 5),
        ]
        for title, kind, tool, risk, args, reason, mins in pending:
            t = by_title[title]
            q = args.get("question") if kind == "question" else None
            db.add(Approval(workspace_id=ws.id, task_id=t.id, agent_id=t.assignee_agent_id, kind=kind, tool_name=tool, tool_call_id=f"call_{new_id('c')[-10:]}", args={} if q else args, reason=q or reason, risk=risk, rule="tool needs approval" if kind == "tool" else "", status="pending", created_at=ago(minutes=mins), expires_at=NOW + timedelta(days=2)))
            t.blocked_reason = "Waiting for a person to decide"
            db.add(TaskEvent(task_id=t.id, ts=ago(minutes=mins), kind="status", actor=f"agent:{t.assignee_agent_id}", text="moved it from running to blocked", data={"from": "running", "to": "blocked"}))
        # History of decisions.
        decided_src = [t for t, s in task_rows if s["status"] == "done"][:14]
        hist_specs = [
            ("web_fetch", {"url": "https://www.mysst.customs.gov.my"}, "Checking the current SST rate for transport services.", "approved", "once"),
            ("run_python", {"code": "df.groupby('vehicle')['litres'].sum()"}, "Summing fuel by vehicle.", "approved", "always"),
            ("browser_submit", {"form": "Purchase order", "fields": {"Item": "Pallets", "Quantity": "200"}}, "Submitting the pallet order.", "denied", None),
            ("schedule_task", {"title": "Daily dispatch summary", "cron": "30 17 * * 1-6"}, "Daily dispatch summary at 5:30pm.", "approved", "once"),
            ("web_fetch", {"url": "https://www.jkr.gov.my/tenders"}, "Reading the open tender list.", "approved", "always"),
            ("generate_image", {"prompt": "Clean diagram of a 3-bay warehouse layout"}, "A layout picture for the Seri Murni proposal.", "approved", "once"),
        ]
        for i, t in enumerate(decided_src):
            tool, args, reason, status, scope = hist_specs[i % len(hist_specs)]
            created = (t.started_at or t.created_at) + timedelta(minutes=1)
            decider = RNG.choice([uact("owner"), uact("suresh"), uact("christine")])
            db.add(Approval(workspace_id=ws.id, task_id=t.id, agent_id=t.assignee_agent_id, kind="tool", tool_name=tool, tool_call_id=f"call_{new_id('c')[-10:]}", args=args, reason=reason, risk="high" if tool in ("run_python", "browser_submit") else "medium", rule="tool needs approval", status=status, scope=scope, answer="Order via the usual supplier instead" if status == "denied" else None, decided_by=decider, decided_at=created + timedelta(minutes=RNG.uniform(3, 50)), created_at=created, expires_at=created + timedelta(days=2)))
        await db.commit()

        # ------------------------------------------------ live steps for the monitor
        for t, spec in task_rows:
            if t.status not in ("running", "blocked"):
                continue
            agent = role_of[(spec["c"], spec["r"])]
            base = ago(minutes=RNG.uniform(6, 14))
            prov, model = GROUP_MODEL.get(agent.model_group, GROUP_MODEL["smart"])
            meta = lambda: {"model": model, "tokens": RNG.randint(3000, 9000), "cached": RNG.randint(1000, 3000), "cost_usd": round(RNG.uniform(0.001, 0.006), 4)}  # noqa: E731
            steps = TOOL_STEPS.get(spec["r"], [])
            feed = [("think", {"text": f"Starting on '{t.title}'. I'll keep a plan and show my workings.", **meta()})]
            for tool, label, preview in steps[:2]:
                feed.append(("think", {"text": "", "tools": [{"tool": tool, "args": tool_args(tool, preview)}], **meta()}))
                feed.append(("tool_call", {"tool": tool, "label": label, "args": tool_args(tool, preview)}))
                feed.append(("tool_result", {"tool": tool, "preview": preview}))
            if t.status == "running" and len(steps) > 2:
                tool, label, _ = steps[2]
                feed.append(("think", {"text": "The figures reconcile so far. Next step of the plan.", "tools": [{"tool": tool, "args": tool_args(tool, _)}], **meta()}))
                feed.append(("tool_call", {"tool": tool, "label": label, "args": tool_args(tool, _)}))
            for i, (kind, data) in enumerate(feed):
                db.add(Event(workspace_id=ws.id, ts=base + timedelta(seconds=45 * i), type="agent.activity", data={"agent_id": agent.id, "agent_name": agent.name, "task_id": t.id, "task_title": t.title, "kind": kind, **data}))
            if t.status == "blocked":
                db.add(Event(workspace_id=ws.id, ts=base + timedelta(seconds=45 * len(feed)), type="approval.requested", data={"agent_id": agent.id, "task_id": t.id, "summary": t.title}))
        await db.commit()

        # ------------------------------------------------ reports
        report_specs = [
            ("N", "finance", "13-week cash-flow forecast: week 40", "Closing balance stays above the RM 250,000 floor in all 13 weeks; week 45 is the tightest at RM 286,400.", [tbl("Forecast", ["Week", "Receipts (RM)", "Payments (RM)", "Closing (RM)"], [[41, "612,300", "548,900", "731,200"], [42, "488,000", "571,400", "647,800"], [43, "530,500", "602,100", "576,200"], [44, "455,900", "618,300", "413,800"], [45, "498,200", "625,600", "286,400"]])], ["cash-flow"], 1.1),
            ("N", "finance", "Debtor ageing: 30 September", "RM 186,750 (13%) of receivables is over 60 days, down from 17% in August.", [tbl("Over 60 days", ["Customer", "Amount (RM)", "Oldest", "Next step"], [["Seri Murni Foods", "92,400", "74 days", "Instalment offer"], ["Kedai Runcit Jaya", "41,850", "81 days", "Final reminder"], ["Borneo Fresh Trading", "52,500", "63 days", "Resend invoice copy"]])], ["collections"], 4.2),
            ("N", "operations", "Late deliveries: week 40", "9 of 231 deliveries were late (3.9%, target under 5%).", [tbl("Causes", ["Cause", "Count", "Owner"], [["Cross-dock wait", 4, "Hub supervisor"], ["Receiving closed", 3, "Customer Service"], ["Breakdown", 2, "Workshop"]])], ["delivery"], 2.0),
            ("N", "purchasing", "Packaging reorder plan", "Reorder stretch film (120 rolls) and size B cartons (2,000) now; pallets are fine for 5 weeks.", [tbl("Reorder", ["Item", "On hand", "4-week use", "Reorder"], [["Stretch film", 38, 96, 120], ["Cartons size B", 1150, 2400, 2000], ["Pallets", 640, 420, 0]])], ["purchasing"], 2.8),
            ("H", "finance", "Management report: September", "Revenue RM 2.31m (budget RM 2.2m); gross margin 14.8% vs 15.5% budget, mainly rebar on the Kuantan job.", [tbl("Projects", ["Project", "Revenue (RM)", "Margin", "Budget margin"], [["Kuantan drainage", "1,240,000", "12.9%", "15.0%"], ["Seremban school block", "780,000", "17.6%", "16.0%"], ["Rawang warehouse", "290,000", "15.2%", "15.5%"]]), tbl("Cash and retention", ["Item", "RM"], [["Cash at bank", "1,040,000"], ["Retention held", "418,600"], ["Claims certified, unpaid", "684,000"]])], ["management-report"], 2.0),
            ("H", "operations", "Site progress: week 40", "Kuantan is 3% behind plan after rain; Seremban on track for handover on 18 Oct; Rawang ahead.", [tbl("Sites", ["Site", "Planned", "Actual", "Status"], [["Kuantan drainage", "62%", "59%", "Behind"], ["Seremban school block", "96%", "96%", "On track"], ["Rawang warehouse", "18%", "21%", "Ahead"]])], ["site-progress"], 2.3),
            ("H", "sales", "Tender shortlist: week 40", "4 of 23 open tenders fit our grade, scope and area.", [tbl("Shortlist", ["Tender", "Closes", "Est. value", "Fit"], [["Drainage and road upgrading, Temerloh", "20 Oct", "RM 6.8m", "Strong"], ["Box culvert replacement, Bentong", "24 Oct", "RM 2.1m", "Good"], ["School block extension, Kajang", "28 Oct", "RM 4.4m", "Good"], ["Flood mitigation phase 2, Kuantan", "3 Nov", "RM 11.5m", "Stretch"]])], ["tender"], 1.4),
            ("H", "quantity_surveyor", "VO-12 rebar adjustment check", "VO-12 is RM 38,640 too high: it used the August spot price, not the contract's index formula.", [tbl("Workings", ["Item", "Claimed (RM)", "Checked (RM)"], [["Rebar Y16", "148,200", "126,900"], ["Rebar Y20", "101,800", "84,460"], ["Total", "250,000", "211,360"]])], ["variation"], 7.4),
        ]
        for c, r, title, summary, tables, labels, age_d in report_specs:
            agent = role_of[(c, r)]
            src = next((t for t, s in task_rows if s["c"] == c and s["r"] == r and s["status"] == "done"), None)
            body = f"## Summary\n{summary}\n\n## Notes\nFigures come from the company's own files; workings were done with the finance calculator. Nothing was sent outside the company."
            db.add(Report(workspace_id=ws.id, branch_id=agent.branch_id, agent_id=agent.id, task_id=src.id if src else None, call_id=new_id("call"), title=title, summary=summary, body=body, tables=tables, labels=labels, created_at=ago(age_d)))
        await db.commit()

        # ------------------------------------------------ documents and packs
        qt = await doc_service.create_document(db, workspace_id=ws.id, branch_id=bN, template=tpls["Quotation"], title="Quotation: Mega Mart Holdings, Klang Valley distribution", values={"client_name": "Mega Mart Holdings Sdn Bhd", "client_address": "Level 8, Menara MMH, Jalan Tun Razak, 50400 Kuala Lumpur", "client_contact": "Puan Rozita Hamid, Logistics Manager", "subject": "Klang Valley outlet distribution, October to December 2026", "items": [{"description": "Ambient distribution, Port Klang to 14 outlets (per trip, 10-tonne rigid)", "qty": 39, "unit": "trip", "unit_price": 1180}], "valid_until": (NOW + timedelta(days=30)).date().isoformat(), "notes": "Rates include tolls and fuel at RM 3.35/litre."}, body=None, created_by=f"agent:{role_of[('N', 'sales')].id}", task_id=by_title["Quotation: Mega Mart Holdings, Klang Valley distribution (Q4)"].id, agent_id=role_of[("N", "sales")].id)
        qt.status = "review"
        inv = await doc_service.create_document(db, workspace_id=ws.id, branch_id=bN, template=tpls["Invoice"], title="Invoice: Borneo Fresh Trading, September deliveries", values={"client_name": "Borneo Fresh Trading Sdn Bhd", "client_address": "No. 21, Jalan Kenari 5, Bandar Puchong Jaya, 47100 Puchong", "client_contact": "Mr. Lee Kok Wai", "items": [{"description": "Chilled deliveries, September (22 trips)", "qty": 22, "unit": "trip", "unit_price": 980}, {"description": "Waiting time (over 2 hours)", "qty": 3, "unit": "hour", "unit_price": 80}]}, body=None, created_by=uact("farid"))
        inv.status, inv.approved_by, inv.approved_at = "approved", uact("suresh"), ago(3)
        letter = await doc_service.create_document(db, workspace_id=ws.id, branch_id=bH, template=tpls["Official letter"], title="Letter: request for extension of time (Kuantan drainage)", values={"client_name": "Jabatan Kerja Raya Daerah Kuantan", "client_address": "Jalan Gambut, 25000 Kuantan, Pahang", "client_contact": "Jurutera Daerah"}, body=None, created_by=uact("kamal"))
        prof = await doc_service.create_document(db, workspace_id=ws.id, branch_id=bH, template=tpls["Company profile"], title="Company profile: prequalification 2026", values={}, body=None, created_by=f"agent:{role_of[('H', 'sales')].id}", agent_id=role_of[("H", "sales")].id)
        prof.status = "review"
        svr = await doc_service.create_document(db, workspace_id=ws.id, branch_id=bH, template=site_tpl, title="Site visit report: Seremban school block", values={"site": "Seremban school block (SK Taman Rasah Jaya)", "visited_by": "Ir. Kamal Yusof", "progress": "Finishes 96% complete. External works and landscaping in progress.", "issues": "4 defects open from Bina Jaya's list (door closers, two ceiling boards, one gutter).", "actions": "Close the 4 defects by 11 Oct. Joint inspection with the consultant on 15 Oct. Handover 18 Oct."}, body=None, created_by=uact("kamal"))
        svr.status, svr.approved_by, svr.approved_at = "approved", uact("kamal"), ago(1)
        await db.flush()
        for d, age_d in ((qt, 0.7), (inv, 4), (letter, 2), (prof, 0.9), (svr, 1.2)):
            d.created_at, d.updated_at = ago(age_d + 0.2), ago(age_d)
            db.add(DocumentVersion(document_id=d.id, version=1, title=d.title, body=d.body, values=d.values, note="First draft", author=d.created_by, created_at=ago(age_d + 0.2)))
        pack = Pack(workspace_id=ws.id, branch_id=bH, title="Tender pack: drainage and road upgrading, Temerloh", description="Everything the tender asks for, compiled into one PDF with a cover and an index.", items=[
            {"id": "i1", "label": "Form of tender (signed)", "hint": "", "required": True, "file_id": None, "document_id": letter.id, "status": "done", "note": "", "auto": False},
            {"id": "i2", "label": "CIDB certificate (G7)", "hint": "", "required": True, "file_id": files[-1].id, "document_id": None, "status": "done", "note": "Valid until 14 Mar 2027", "auto": True},
            {"id": "i3", "label": "Company profile", "hint": "", "required": True, "file_id": None, "document_id": prof.id, "status": "done", "note": "", "auto": False},
            {"id": "i4", "label": "Audited accounts (3 years)", "hint": "2023, 2024, 2025", "required": True, "file_id": None, "document_id": None, "status": "missing", "note": "", "auto": False},
            {"id": "i5", "label": "Bank statements (3 months)", "hint": "", "required": True, "file_id": None, "document_id": None, "status": "missing", "note": "", "auto": False},
            {"id": "i6", "label": "Site visit attendance slip", "hint": "", "required": False, "file_id": None, "document_id": None, "status": "missing", "note": "Site visit on 9 Oct", "auto": False},
        ], status="collecting", created_by=uact("kamal"))
        db.add(pack)
        pack2 = Pack(workspace_id=ws.id, branch_id=bN, title="Vendor registration: Mega Mart Holdings", description="Documents Mega Mart asks of every new logistics vendor.", items=[
            {"id": "j1", "label": "SSM company profile", "hint": "", "required": True, "file_id": None, "document_id": None, "status": "done", "note": "", "auto": False},
            {"id": "j2", "label": "Insurance (goods in transit)", "hint": "", "required": True, "file_id": None, "document_id": None, "status": "done", "note": "", "auto": False},
            {"id": "j3", "label": "Quotation", "hint": "", "required": True, "file_id": None, "document_id": qt.id, "status": "done", "note": "", "auto": False},
            {"id": "j4", "label": "Bank confirmation letter", "hint": "", "required": True, "file_id": None, "document_id": None, "status": "missing", "note": "", "auto": False},
        ], status="collecting", created_by=uact("suresh"))
        db.add(pack2)
        await db.commit()

        # ------------------------------------------------ blueprints and workflow
        bp1 = Blueprint(workspace_id=ws.id, name="Accounts Receivable Clerk", description="Invoices, reminders and debtor ageing, with every figure shown.", role="Accounts Receivable Clerk", soul="You keep receivables moving: invoices out on time, polite reminders, a weekly ageing report. Drafts only; people send.", model_group="smart", tools={"finance_calc": "allow", "calc": "allow", "draft_document": "allow", "read_file": "allow"}, autonomy="ask", sop_ids=[sops[0].id], skill_ids=[learned["fuel-card-reconciliation"][0].id], color="#b7791f", created_by=uact("owner"))
        bp2 = Blueprint(workspace_id=ws.id, name="Site Coordinator", description="Site diaries, progress summaries and safety actions for one project.", role="Site Coordinator", soul="You keep one site on track: daily diary summaries, weekly progress against plan, toolbox actions with owners.", model_group="fast", tools={"read_file": "allow", "publish_report": "allow", "calc": "allow"}, autonomy="ask", sop_ids=[], skill_ids=[learned["site-progress-summary"][0].id], color="#13895f", created_by=uact("kamal"), branch_id=bH)
        bp3 = Blueprint(workspace_id=ws.id, name="Tender Analyst", description="Finds tenders that fit and builds the submission checklist.", role="Tender Analyst", soul="You screen open tenders against our grade, scope and area, and prepare the checklist for the ones we chase.", model_group="smart", tools={"web_search": "allow", "web_fetch": "ask", "publish_report": "allow"}, autonomy="ask", sop_ids=[sops[4].id], skill_ids=[], color="#2f6db5", created_by=uact("kamal"))
        db.add_all([bp1, bp2, bp3])
        sales_n, ops_n, pur_n, cs_n, fin_n = (role_of[("N", k)] for k in ("sales", "operations", "purchasing", "customer_service", "finance"))
        graph = clean_graph({
            "nodes": [
                {"id": "start", "type": "start", "title": "Customer order received"},
                {"id": "check", "type": "step", "title": "Check stock and truck capacity", "body": "Check the order against stock in the warehouse and trucks free on the delivery date.", "action": "check", "agent_id": ops_n.id, "role": "Operations"},
                {"id": "dec", "type": "decision", "title": "Can we deliver on the requested date?", "decider": "agent", "agent_id": ops_n.id},
                {"id": "do", "type": "step", "title": "Prepare the delivery order", "body": "Prepare the DO and the trip plan.", "action": "write", "agent_id": ops_n.id, "role": "Operations"},
                {"id": "buy", "type": "handoff", "title": "Ask Purchasing to restock", "body": "Raise a restock request for what is short.", "action": "message", "agent_id": pur_n.id, "role": "Purchasing"},
                {"id": "confirm", "type": "step", "title": "Confirm the date to the customer", "body": "Draft the confirmation with the delivery date and DO number.", "action": "reply", "agent_id": cs_n.id, "role": "Customer Service", "review": True},
                {"id": "inv", "type": "step", "title": "Raise the invoice after delivery", "body": "Raise the invoice once the POD is in.", "action": "template", "agent_id": fin_n.id, "role": "Finance"},
                {"id": "end", "type": "end", "title": "Order closed"},
            ],
            "edges": [
                {"from": "start", "to": "check"}, {"from": "check", "to": "dec"},
                {"from": "dec", "to": "do", "label": "Yes"}, {"from": "dec", "to": "buy", "label": "No"},
                {"from": "buy", "to": "do"}, {"from": "do", "to": "confirm"}, {"from": "confirm", "to": "inv"}, {"from": "inv", "to": "end"},
            ],
        })
        graph = layout(graph)
        wf = Workflow(workspace_id=ws.id, branch_id=bN, name="Customer order to delivery", description="From a customer's order to a delivered load and an invoice.", graph=graph, status="active", source="manual", agent_ids=[ops_n.id, pur_n.id, cs_n.id, fin_n.id], created_by=uact("suresh"))
        wf2 = Workflow(workspace_id=ws.id, branch_id=bH, name="Variation order review", description="Check a VO, agree it with the client, update the contract sum.", graph=layout(clean_graph({"nodes": [{"id": "s", "type": "start", "title": "VO received"}, {"id": "a", "type": "step", "title": "Check against BQ and formula", "action": "check", "agent_id": role_of[("H", "quantity_surveyor")].id}, {"id": "b", "type": "decision", "title": "Within 5% of our figure?", "decider": "person"}, {"id": "c", "type": "step", "title": "Draft the agreement letter", "action": "write", "agent_id": role_of[("H", "project_coordinator")].id}, {"id": "e", "type": "end", "title": "Contract sum updated"}], "edges": [{"from": "s", "to": "a"}, {"from": "a", "to": "b"}, {"from": "b", "to": "c", "label": "Yes"}, {"from": "c", "to": "e"}]})), status="active", source="analyst", agent_ids=[role_of[("H", "quantity_surveyor")].id], created_by=uact("kamal"))
        db.add_all([wf, wf2])
        await db.flush()
        run_start = ago(5)
        state = {}
        tsec = 0
        for n in graph["nodes"]:
            if n["id"] == "buy":
                state["buy"] = {"status": "skipped"}
                continue
            tsec += 1
            st = {"status": "done", "started_at": (run_start + timedelta(minutes=12 * tsec)).isoformat(), "finished_at": (run_start + timedelta(minutes=12 * tsec + 8)).isoformat()}
            if n["type"] == "decision":
                st.update(choice="Yes", output="Stock is available and 2 trucks are free on 30 Sep.", by=f"agent:{ops_n.id}")
            elif n["type"] in ("step", "handoff"):
                st.update(output={"check": "All 6 lines in stock; 10-tonne truck WVB 2209 free.", "do": "DO-NL-5521 prepared, 6 pallets, trip on 30 Sep 7:00.", "confirm": "Confirmation drafted to Kilang Roti Seri with DO-NL-5521.", "inv": "INV-NL-2340 raised after POD."}.get(n["id"], "Done."))
            state[n["id"]] = st
        run = WorkflowRun(workspace_id=ws.id, workflow_id=wf.id, branch_id=bN, name=wf.name, title="Order SO-24902: Kilang Roti Seri, 6 pallets", input="Kilang Roti Seri ordered 6 pallets of flour and packaging for delivery on 30 Sep.", graph=graph, assign={n["id"]: n["agent_id"] for n in graph["nodes"] if n.get("agent_id")}, state=state, status="done", created_by=uact("suresh"), finished_at=run_start + timedelta(hours=2))
        db.add(run)
        await db.flush()
        run.created_at, run.updated_at = run_start, run_start + timedelta(hours=2)
        for o in (bp1, bp2, bp3, wf, wf2):
            o.created_at = ago(RNG.uniform(14, 30))
        await db.commit()

        # ------------------------------------------------ schedule runs
        for key, s in schedules.items():
            for k in range(1, 6):
                started = ago(k * (7 if key in ("cash", "site", "ap") else (1 if key == "dispatch" else 30)) - 0.1)
                if started < ago(40):
                    continue
                db.add(JobRun(workspace_id=ws.id, job="schedule", schedule_id=s.id, status="completed", attempt=1, started_at=started, finished_at=started + timedelta(minutes=RNG.uniform(3, 12)), detail={"title": s.title}))
        await db.commit()

        # ------------------------------------------------ meetings
        m_specs = [
            ("N", "Diesel is up 9% since March: pass the surcharge on to customers, or absorb it?", ["finance", "sales", "operations"], 3.0,
             {"decision": "Add a 4% fuel surcharge from 1 November for contract customers, reviewed monthly against the diesel price; spot customers get the new rate now.", "rationale": "Margins on Penang and Klang Valley runs fell under the 20% floor. A surcharge tied to the diesel price is easier to explain than a rate increase.", "options": ["Absorb the cost for one more quarter", "4% surcharge tied to diesel", "Raise base rates by 6%"], "dissent": "Sales prefers to hold Mega Mart's rate until the Q4 contract is signed.", "actions": [{"owner": "Sales & Marketing Executive", "action": "Draft the surcharge letter for contract customers by 15 Oct"}, {"owner": "Finance & Accounts Officer", "action": "Set up the monthly diesel price check"}, {"owner": "Operations Coordinator", "action": "Report fuel use per trip weekly"}]}),
            ("H", "Kuantan drainage is 3% behind after rain: how do we recover before the December monsoon?", ["project_coordinator", "operations", "quantity_surveyor"], 1.5,
             {"decision": "Run a Saturday shift for 3 weeks and bring the box culvert works forward by one week.", "rationale": "The Saturday shift costs about RM 18,500 and recovers 4 to 5 days, which keeps the culvert crossing out of the monsoon window.", "options": ["Saturday shift for 3 weeks", "Second excavation crew", "Accept the delay and claim an extension of time"], "dissent": "", "actions": [{"owner": "Project Coordinator", "action": "Update the look-ahead schedule"}, {"owner": "Quantity Surveyor (QS)", "action": "Cost the Saturday shift and check the budget"}, {"owner": "Operations Coordinator", "action": "Confirm the crew and machines for Saturdays"}]}),
        ]
        for c, topic, keys, age_d, outcome in m_specs:
            parts = [role_of[(c, k)] for k in keys]
            m = Meeting(workspace_id=ws.id, initiator_agent_id=None, started_by=uact("owner"), topic=topic, participant_ids=[a.id for a in parts], status="done", max_rounds=3, rounds_done=2, token_budget=24000, tokens_used=RNG.randint(9000, 16000), outcome=outcome, created_at=ago(age_d), finished_at=ago(age_d) + timedelta(minutes=6))
            db.add(m)
            await db.flush()
            lines = {
                0: ["From the numbers, our Penang and Klang Valley margins are now 17.2% and 18.9%, both under the 20% floor.", "Customers accept surcharges more easily than rate changes when they move with a published price.", "Fuel per trip is steady; the cost increase is all price, not use."],
                1: ["We are 3% behind: 6 rain days in September. The culvert crossing must finish before mid-November.", "A Saturday shift for 3 weeks recovers about 5 days; I can confirm the crew.", "A Saturday shift costs about RM 18,500 including OT and machine hire. That is within the contingency."],
            }[0 if c == "N" else 1]
            for r in (1, 2):
                for i, a in enumerate(parts):
                    db.add(MeetingTurn(meeting_id=m.id, round=r, speaker=f"agent:{a.id}", name=a.name, kind="turn", content=lines[i] if r == 1 else "Agreed. " + outcome["actions"][i]["action"] + ".", tokens=RNG.randint(400, 900), created_at=m.created_at + timedelta(minutes=r * 2 + i * 0.5)))
            db.add(MeetingTurn(meeting_id=m.id, round=3, speaker="system", name="Outcome", kind="outcome", content=outcome["decision"], tokens=0, created_at=m.finished_at))
        await db.commit()

        # ------------------------------------------------ broadcast
        staff_agents = [a for (k, r), a in role_of.items() if r != "twin"]
        bc = Broadcast(workspace_id=ws.id, sender=uact("owner"), audience={"all": True}, audience_label="Everyone (both companies)", mode="directive", request_reply=True, body="From 1 November all our invoices go through MyInvois (LHDN e-invoicing). Every invoice you draft must carry the customer's TIN and the e-invoice reference. Reply with anything in your work that this changes.", created_at=ago(3.5))
        db.add(bc)
        await db.flush()
        replies = {"finance": "Noted. I will add the TIN and e-invoice reference to every invoice draft and flag customers whose TIN we do not have yet (12 in Nusantara).", "sales": "Quotations are not affected; I'll collect TINs from new customers at the quotation stage.", "customer_service": "I'll ask for the TIN when customers request invoice copies."}
        for a in staff_agents:
            key = next(k for (c, k), x in role_of.items() if x is a)
            db.add(BroadcastReceipt(broadcast_id=bc.id, agent_id=a.id, delivered_at=bc.created_at, ack_at=bc.created_at + timedelta(minutes=RNG.uniform(1, 30)), reply=replies.get(key)))
        bc2 = Broadcast(workspace_id=ws.id, sender=uact("kamal"), audience={"branch_id": bH}, audience_label="Harmoni Engineering Sdn Bhd", mode="announcement", request_reply=False, body="Public holiday on 20 October (Deepavali): no site work. Plan deliveries around it.", created_at=ago(9))
        db.add(bc2)
        await db.flush()
        for a in staff_agents:
            if a.branch_id == bH:
                db.add(BroadcastReceipt(broadcast_id=bc2.id, agent_id=a.id, delivered_at=bc2.created_at, ack_at=bc2.created_at + timedelta(minutes=RNG.uniform(1, 20))))
        await db.commit()

        # ------------------------------------------------ chat (owner with finance) and assistant
        fin = role_of[("N", "finance")]
        cs = ChatSession(workspace_id=ws.id, agent_id=fin.id, user_id=owner.id, title="Cash position this week")
        db.add(cs)
        await db.flush()
        cs.created_at = ago(hours=3)
        convo = [
            ("user", "How does our cash look for the next 4 weeks?"),
            ("assistant", "Comfortable. The closing balance stays above RM 250,000 every week; the lowest is **RM 413,800 in week 44**, when both prime-mover instalments and payroll fall together.\n\nThe biggest risk is Seri Murni Foods (RM 92,400 over 60 days). If they pay in week 42 as they promised, week 44 improves to RM 506,200."),
            ("user", "Draft a polite reminder to Seri Murni, offering two instalments."),
            ("assistant", "Here is the draft (not sent):\n\n> Dear Encik Roslan,\n> Our records show RM 92,400 outstanding on invoices INV-NL-2291 and INV-NL-2296. To make this easier, we can split it into two payments: RM 46,200 by 15 October and RM 46,200 by 31 October. Please let us know if this works for you.\n\nShall I put it in Documents for Suresh to review?"),
        ]
        for i, (role, content) in enumerate(convo):
            db.add(AgentMessage(workspace_id=ws.id, agent_id=fin.id, session_id=cs.id, role=role, content=content, created_at=ago(hours=3) + timedelta(minutes=i * 1.5)))
        acs = ChatSession(workspace_id=ws.id, agent_id=assistant.id, user_id=owner.id, title="Morning briefing")
        db.add(acs)
        await db.flush()
        a_convo = [
            ("user", "What needs me today?"),
            ("assistant", "Good morning, Aminah. Three things need you today:\n\n1. **5 approvals waiting**: the stretch-film PO on the supplier portal (RM 2,208) is the most urgent.\n2. **Mega Mart quotation** (RM 46,020, margin 21.4%) is ready for your review.\n3. **Kuantan drainage** is 3% behind; the team recommends a Saturday shift (about RM 18,500).\n\nEverything else is on track: 31 tasks were finished this week across both companies."),
        ]
        for i, (role, content) in enumerate(a_convo):
            db.add(AgentMessage(workspace_id=ws.id, agent_id=assistant.id, session_id=acs.id, role=role, content=content, created_at=ago(hours=1) + timedelta(minutes=i)))
        await db.commit()

        # ------------------------------------------------ logins, MCP server
        for name, hosts, br, hint, agents_ in (
            ("supplier-portal", ["portal.sinarpack.example"], bN, "purchasing@…", [pur_n.id]),
            ("myinvois", ["myinvois.hasil.gov.my"], None, "finance@…", [fin.id, role_of[("H", "finance")].id]),
            ("eperolehan", ["www.eperolehan.gov.my"], bH, "tender@…", [role_of[("H", "sales")].id]),
        ):
            cr = Credential(workspace_id=ws.id, branch_id=br, name=name, hosts=hosts, username_enc="", password_enc="", username_hint=hint, agent_ids=agents_, created_by=uact("owner"), last_used_at=ago(RNG.uniform(0.2, 4)))
            db.add(cr)
            await db.flush()
            cr.username_enc = crypto.encrypt("demo-user", cr.aad)
            cr.password_enc = crypto.encrypt("demo-password-not-real", cr.aad)
        mcp = McpServer(workspace_id=ws.id, name="erp", url="https://erp.nusantara-logistics.example/mcp", description="The company ERP: stock, sales orders and invoices (read-only).", enabled=True, tools=[{"name": "get_stock", "description": "Stock on hand for an item or bay", "schema": {}}, {"name": "get_sales_order", "description": "A sales order with its lines", "schema": {}}, {"name": "list_invoices", "description": "Invoices by customer and status", "schema": {}}], agent_ids=[], health="ok", created_by=uact("owner"))
        db.add(mcp)
        await db.commit()

        # ------------------------------------------------ brain: pages and facts
        await brain_store.ensure_vault(db, ws)
        sysauth = brain_store.Author(uact("owner"), "Aminah Rahman")
        pages = [
            ("wiki/customers/mega-mart-holdings.md", "# Mega Mart Holdings\n\nRetail chain, 14 outlets in the Klang Valley. Our largest ambient customer.\n\n- Contact: Puan Rozita Hamid, Logistics Manager\n- Receiving: 7:00 to 11:00 at most outlets\n- Pays on about day 45\n- Quotation for Q4: [[quotation-qt-2610-0031]]\n\nSee also [[nusantara-pricing]] and [[fuel-surcharge-decision]]."),
            ("wiki/customers/seri-murni-foods.md", "# Seri Murni Foods\n\nFood manufacturer in Shah Alam. Asked for warehousing (800 pallets) and last-mile.\n\n- Damaged-carton complaint on SO-24817 (load shift)\n- RM 92,400 over 60 days; instalment offer sent\n\nSee [[nusantara-pricing]]."),
            ("wiki/nusantara-pricing.md", "# Nusantara pricing rules\n\n- Margin floor: 20% after fuel and tolls\n- Diesel assumption: RM 3.35 per litre (review monthly)\n- Reefer runs: add reefer fuel at 2.1 litres per hour\n- Fuel surcharge from 1 Nov: see [[fuel-surcharge-decision]]\n\nUsed by [[mega-mart-holdings]] and [[seri-murni-foods]] quotations."),
            ("decisions/fuel-surcharge-decision.md", "# Decision: fuel surcharge\n\n4% fuel surcharge from 1 November for contract customers, reviewed monthly against the diesel price. Agreed in the operations meeting.\n\nAffects [[nusantara-pricing]]."),
            ("wiki/projects/kuantan-drainage-upgrade.md", "# Kuantan drainage upgrade\n\nClient: JKR Daerah Kuantan. Contract RM 9.6m. 62% planned, 59% actual (week 40).\n\n- Recovery: Saturday shift for 3 weeks (see [[kuantan-recovery-plan]])\n- VO-12 rebar adjustment corrected to RM 211,360\n- Retention 5%"),
            ("decisions/kuantan-recovery-plan.md", "# Decision: Kuantan recovery plan\n\nSaturday shift for 3 weeks and the box culvert works brought forward one week. About RM 18,500, within contingency.\n\nProject: [[kuantan-drainage-upgrade]]"),
            ("wiki/harmoni-company-facts.md", "# Harmoni Engineering: key facts\n\n- CIDB G7 (CE, B), valid until 14 Mar 2027\n- ISO 9001:2015\n- 3 active projects: [[kuantan-drainage-upgrade]], Seremban school block, Rawang warehouse"),
        ]
        for path, body in pages:
            await brain_store.save_page(db, ws, path, body, sysauth, f"Add {path}")
        fact_specs = [
            ("Mega Mart Holdings pays invoices on about day 45.", bN, "task"), ("Mega Mart outlets receive goods between 7:00 and 11:00.", bN, "task"),
            ("The margin floor for Nusantara deliveries is 20% after fuel and tolls.", bN, "person"), ("Diesel is costed at RM 3.35 per litre (October 2026).", bN, "task"),
            ("Truck WVB 2209 has a 300-litre tank.", bN, "task"), ("Seri Murni Foods prefers to pay in two instalments.", bN, "chat"),
            ("Lift Prima rents 3-tonne forklifts at RM 4,150 a month with a standby unit.", bN, "task"), ("Sinar Pack Supplies sells stretch film at RM 18.40 a roll (Q4 2026).", bN, "task"),
            ("A 4% fuel surcharge applies to contract customers from 1 November.", bN, "person"), ("Drivers apply for leave 14 days ahead in November and December.", bN, "agent"),
            ("Harmoni Engineering is CIDB grade G7, valid until 14 March 2027.", bH, "task"), ("Progress claims are paid 30 days after certification, less 5% retention.", bH, "task"),
            ("VO price adjustments use the contract's index formula, not spot prices.", bH, "person"), ("Konkrit Utama supplies G30 ready-mix at RM 268 per m3 delivered.", bH, "task"),
            ("The Seremban school block hands over on 18 October.", bH, "task"), ("No site work on 20 October (Deepavali).", bH, "person"),
            ("Kamal Yusof signs letters for Harmoni Engineering.", bH, "person"), ("Invoices from 1 November go through MyInvois with the customer's TIN.", None, "person"),
            ("Purchase orders above RM 5,000 need the Managing Director's approval.", None, "person"), ("Credit notes up to RM 1,000 can be approved by a branch manager.", None, "person"),
        ]
        for i, (txt, br, src) in enumerate(fact_specs):
            when = ago(RNG.uniform(0.5, 27))
            db.add(BrainFact(workspace_id=ws.id, branch_id=br, agent_id=None, text=txt, source_kind=src, source_label="from a finished task" if src == "task" else None, created_by=uact("owner") if src == "person" else f"agent:{fin.id}", confidence=0.9, hits=RNG.randint(0, 14), valid_from=when, created_at=when))
        old = BrainFact(workspace_id=ws.id, branch_id=bN, text="Diesel is costed at RM 3.05 per litre.", source_kind="task", created_by=f"agent:{fin.id}", confidence=0.8, valid_from=ago(60), valid_to=ago(12), end_reason="replaced", created_at=ago(60))
        db.add(old)
        for k in range(1, 6):
            day = (NOW - timedelta(days=k)).date()
            db.add(BrainDream(workspace_id=ws.id, day=day, status="done", stats={"facts_learned": RNG.randint(2, 7), "pages_changed": RNG.randint(0, 3), "active_facts": 20 + k, "pairs_checked": RNG.randint(8, 30), "pairs_judged": RNG.randint(0, 4)}, changes=[], started_at=datetime.combine(day, datetime.min.time(), UTC) + timedelta(hours=18), finished_at=datetime.combine(day, datetime.min.time(), UTC) + timedelta(hours=18, minutes=3)))
        await db.commit()

        # ------------------------------------------------ prefs: owner's tutorial progress
        owner = await db.get(User, owner.id)
        owner.prefs = {**(owner.prefs or {}), "tutorial": {"done": ["owner.providers", "owner.companies", "owner.agents", "owner.first-task"], "track": "owner"}}
        await db.commit()

        # ------------------------------------------------ activity (audit), back-dated
        actions = [
            (40, uact("owner"), "provider.created", "OpenAI"), (40, uact("owner"), "provider.created", "Groq"), (40, uact("owner"), "provider.created", "Gemini"),
            (39, uact("owner"), "sop.created", "Customer communication standards"), (39, uact("owner"), "sop.created", "Approval limits"),
            (30, uact("owner"), "schedule.created", "Weekly cash-flow forecast"), (30, uact("suresh"), "schedule.created", "Daily dispatch summary"),
            (28, uact("kamal"), "workflow.created", "Variation order review"), (26, uact("suresh"), "workflow.created", "Customer order to delivery"),
            (21, uact("farid"), "agent.created", "Farid's AI worker"), (18, uact("owner"), "agent.created", "Aminah's Chief of Staff"),
            (14, uact("owner"), "blueprint.created", "Accounts Receivable Clerk"), (12, uact("kamal"), "skill.approved", "variation-order-check"),
            (9, uact("kamal"), "broadcast.sent", "Public holiday on 20 October"), (6, "system:autopilot", "skill.approved", "fuel-card-reconciliation"),
            (5, uact("suresh"), "workflow_run.started", "Order SO-24902"), (3.5, uact("owner"), "broadcast.sent", "MyInvois from 1 November"),
            (3.2, "system:autopilot", "skill.approved", "supplier-po-follow-up"), (3, uact("suresh"), "document.approved", "Invoice: Borneo Fresh Trading"),
            (1, uact("kamal"), "document.approved", "Site visit report: Seremban"), (0.5, uact("owner"), "member.updated", "Christine Lau"),
        ]
        for d, actor, action, label in actions:
            audit(ago(d, hours=RNG.uniform(0, 6)), actor, action, None, {"name": label})
        approvals = (await db.scalars(select(Approval).where(Approval.status != "pending"))).all()
        for a in approvals:
            audit(a.decided_at, a.decided_by, f"approval.{a.status}", a.id, {"tool": a.tool_name, "task_id": a.task_id, "scope": a.scope, "via": "dashboard"})
        for t, spec in task_rows:
            if not t.created_by.startswith("schedule:"):
                audit(t.created_at, t.created_by, "task.created", t.id, {"title": t.title, "assignee": t.assignee_agent_id})
            if t.status == "done" and t.finished_at:
                audit(t.finished_at + timedelta(minutes=20), t.created_by if t.created_by.startswith("user:") else uact("owner"), "task.accepted", t.id, {"title": t.title})
        for t, agent in hist_tasks[::3]:
            audit(t.created_at, t.created_by, "task.created", t.id, {"title": t.title, "assignee": agent.id})

        # Rewrite the log in time order with a fresh hash chain (the trigger is lifted only
        # for this one rebuild of a brand-new demo database).
        rows = (await db.scalars(select(AuditLog).where(AuditLog.workspace_id == ws.id).order_by(AuditLog.id))).all()
        base_t = ago(42)
        existing = []
        for i, r in enumerate(rows):
            existing.append(dict(ts=base_t + timedelta(minutes=7 * i) if r.ts > ago(1) else r.ts, actor=r.actor, action=r.action, target=r.target, after=r.after, before=r.before, note=r.note))
        # The hire happened 21 days ago, the assistant 18 days ago.
        for e in existing:
            if e["actor"] == uact("farid"):
                e["ts"] = ago(21) + (e["ts"] - base_t)
        merged = sorted(existing + extra_audit, key=lambda e: e["ts"])
        await db.execute(text("ALTER TABLE audit_log DISABLE TRIGGER USER"))
        await db.execute(text("DELETE FROM audit_log WHERE workspace_id = :w"), {"w": ws.id})
        prev = None
        for e in merged:
            payload = audit_mod._row_payload(ws.id, e["ts"], e["actor"], e["action"], e["target"], e["before"], e["after"], e["note"])
            h = audit_mod._digest(prev, payload)
            db.add(AuditLog(workspace_id=ws.id, ts=e["ts"], actor=e["actor"], action=e["action"], target=e["target"], before=e["before"], after=e["after"], note=e["note"], prev_hash=prev, hash=h))
            prev = h
        await db.flush()
        await db.execute(text("ALTER TABLE audit_log ENABLE TRIGGER USER"))
        await db.commit()

        # Old live events from the API calls above would show as "just now"; drop them.
        await db.execute(text("DELETE FROM events WHERE ts > :t AND type NOT IN ('agent.activity')"), {"t": ago(minutes=30)})
        await db.commit()

        counts = {}
        for model in (Agent, Task, Approval, Report, Skill, SkillProposal, LLMCall, AuditLog, BrainFact, DocFile, Document):
            counts[model.__tablename__] = (await db.execute(text(f"SELECT count(*) FROM {model.__tablename__}"))).scalar()
        print("seeded:", ", ".join(f"{k} {v}" for k, v in counts.items()))
    await engine.dispose()


async def main() -> None:
    if not ARGS.no_recreate:
        await recreate_database()
    Path(ARGS.vault_dir).mkdir(parents=True, exist_ok=True)
    import shutil

    for child in Path(ARGS.vault_dir).iterdir():  # a fresh vault for a fresh database
        shutil.rmtree(child, ignore_errors=True)
    await seed()


if __name__ == "__main__":
    asyncio.run(main())
