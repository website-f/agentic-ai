# Screens: people, HR and personal screens

Status key: **Main**, **Candidate (#nn)**, **Main, extended (#nn)**. See [screens index](README.md).

---

## HR monitor (`hr`)

**Status:** Main, extended heavily (#51 HR Phase 3).

**Purpose.** PWVSB central HR's workspace. HR monitors every company's workforce papers; each company stays the employer
and acts. HR is also the HR administrator for staff.

**Who sees it.** Group leaders and the HR department. (The HR Director is the Chief of Staff and the Deputy Chief of
Staff.)

**What is on it (panels, top to bottom).**

| Panel | What it does | Who acts |
|---|---|---|
| Workforce papers | Every company's guard papers (KDN card, vetting, CSG, foreign worker papers) due or expired | HR monitors; company acts |
| Pay and salary account changes to verify | A basic pay or salary account change set on the staff form takes effect only after the HR Director verifies (and Finance for an account change) and the Vice Chairman consents | HR Director, Finance, Vice Chairman; each with a comment |
| Allowances *(candidate)* | HR keeps the allowance list (name, monthly or one-off, usual amount and cap, and EPF / SOCSO / PCB / HRD ticks HR decides from its own reading of the law) and sets staff monthly allowances | HR prepares; HR Director and Vice Chairman consent (assumed) |
| Joining and leaving *(candidate)* | Filings with the latest day to file (**Filed today**), **EA figures**, probation to confirm or extend, staff at or near retirement age with a leaving guide, the register of employees (download) | HR |
| Vacancies *(candidate)* | HR or the company manager raises; **CEO approves or refuses**; the company head **signs the approval** | CEO, company head |
| Staff movement *(candidate)* | Promotion, transfer, secondment; each step approves or refuses with a comment; **Apply movements due today** on the effective date | HR, HR Director, CEO, Vice Chairman |
| Staff HR files *(candidate)* | Misconduct with the right to be heard, sexual harassment inquiry (confidential), grievances, performance; the HR Director records a serious outcome; the app never decides | HR, HR Director |
| Office safety (OSH) *(candidate)* | Each employer's OSH coordinator, office risk assessments (HIRARC), accidents to report to DOSH within 7 days; HR files and records the reference | HR, named coordinators |
| Appraisals *(candidate)* | Yearly appraisal sent to staff, staff reply, close | HR, staff |
| Training *(candidate)* | Training records; guard training and legal papers (KDN card, eSIMS vetting, CSG, TNG) | HR, company head |
| Handbook and policies *(candidate)* | New versions; staff acknowledge "I have read and understood it" | HR, staff |
| Staff overtime *(candidate)* | Off until HR turns it on, sets rates (never below the Act) and ticks who may claim; anyone can work out what hours would pay | HR |
| Legal points for the directors *(candidate)* | Privacy, retention and face-data points with sources, records touched, responsible director, status and history; nobody else sees it | Directors |
| How to do it | HR guide cards, Bahasa Melayu first | Read only |
| Leave waiting for a decision | Staff leave (HR administrator decides, Vice Chairman consents) | HR, Vice Chairman |
| Flexible hours or days *(candidate)* | Staff ask; HR answers in writing within 60 days (s.60P) | HR |
| Working from home and extra leave *(candidate)* | Who may work from home; leave days above the Act | HR |
| Public holidays *(candidate)* | HR keeps the year's holidays (at least 11 with the compulsory five) | HR |

---

## Staff clock (`staffclock`)

**Status:** Main, extended (#51 face recognition).

**Purpose.** Who of the office staff is clocked in and where.

**Who sees it.** Group leaders, HR, company managers (own company), and the IT Manager for the IT team (view only).

**What is on it.** Each person's state: working from home, signed in (location not followed), location followed, away
from base, location unknown, not clocked in. Location while clocked in. Working from home: home days to review,
applications, readiness, ending an arrangement. **Faces waiting for HR**: HR approves each registered face after looking
at the photo, with a comment; nobody approves their own.

---

## Clock / My clock (`clock`)

**Status:** Main, extended (#51 face check, OSH coordinator, HR guide cards for staff).

**Purpose.** A staff member's own clock. Staff are clocked in when they sign in and out when they sign out, idle or
asleep. Guards clock on the site device instead.

**Who sees it.** Every staff member with their own staff record (not the CEO, Chairman or Vice Chairman).

**What is on it.** Clocked in since; at base / GPS state; last 7 days. **Face recognition**: register once, HR approves the
photo, then each sign-in asks for a quick face check on the phone (the free on-phone engine; the photo is kept for HR to
spot-check). **Working from home**: apply, then on a home day post the plan, check in at the fixed times and send the
end-of-day report. Policies to read, own training, and (for a named coordinator) office OSH.

**Rules.** Location is followed only while clocked in. A web app reads location only while open; following a closed phone
needs the native app wrapper (production).

---

## My details / Duty (`mine`)

**Status:** Main, extended (#54 items to pass on).

**Purpose.** A person's own record, view only. Guards and officers see it as **Duty**.

**Who sees it.** Everyone with their own staff or person record.

**What is on it.**
- Guards: their details, reminders, roster, clock-in and clock-out record, and patrol rounds done or missed. Nothing about
  any other guard or the company.
- Office staff: their details, leave and absence requests, SOCSO claims.
- **Items issued to me**: confirm **I received it** or **Something is wrong** for each store item (never charged).
- **Items to pass on** *(candidate)*: an OM carrying Goodwill items to sites confirms receipt from the store, then attaches
  the patrolling officer's and the guard's signed slips (sign on screen or attach a slip and photo).

---

## Work (`work`)

**Status:** Main, extended (#58 rebalance, #52 delegation guide, #49 advances and cards).

**Purpose.** Everyone sees what to do and what "done" means, sends a morning check-in, finishes tasks with proof and asks
for help when stuck. Managers see exceptions first; leaders get the Monday summary. Tasks are also kept in Microsoft
Planner (preferred; a newer change in Planner wins).

**Who sees it.** Group leaders, PWVSB staff, company managers, admin executives and supervisors.

**Tabs.**
- **My work**: role playbook; to do; waiting for the manager's review; **Morning check-in** by 10:00 (hours, top 3
  priorities, support needed); **Finish with proof**; **Ask for more time**; **Ask for help** (unanswered in 30 minutes
  shows to the manager's manager); add my own task; results over the last 4 weeks; Microsoft Planner sync; my advances,
  company cards and petty cash *(candidate)*; working from home.
- **My team** (managers): help waiting, the team today, tasks to **Accept** or **Return to fix**, and **Move or readjust**
  (delegate to someone in your line, or new due time or priority, always with a reason). COO and CEO decisions made in
  the manager's place are shown with **Seen**.
- **Rebalance (Arisha advice)** *(candidate)*: each person's load (has room, busy, overloaded, on leave); Arisha's
  rule-based advice; **Give task**; **Record one-to-one** (weekly; missing after 7 days shows). Arisha AI may be asked about
  one rebalance at most 10 times a day; it only advises.
- **Monday summary** (leaders): by department, far branches, managers asked to talk to.

---

## Staff payroll (`staffpay`)

**Status:** Main, extended (#49 EPF/SOCSO tables, #51 allowances and zakat).

**Purpose.** Payroll for office staff (guards and officers are paid from the JA app).

**Who sees it.** Group leaders, HR, Finance team members, the Chief of Staff, company managers, and every staff member for
their own payslips.

**Tabs.**
- **Payroll**: each employer's month with its steps. HR **Recalculate**s and **Submit to the Chief of Staff**; the Chief
  of Staff **Approve**s; the COO **Approve as COO**; Finance **Mark paid**; any approver may **Return to HR**. Each step
  needs a comment. Shows items for directors to verify, contributions and zakat paid by Finance, draft files for Finance
  (bank, SQL Account, EPF, SOCSO, PCB), and staff lines with one-off allowances from HR's list (a one-off on HR's own line
  is flagged for the Chief of Staff and COO).
- **My payslips**: view and **Download payslip**; normal SOCSO and LINDUNG in separate columns; **My zakat deduction**
  (which body, what percentage).
- **EPF and SOCSO tables** *(candidate)*: the published contribution tables kept row by row. A new table is loaded by HR
  or Finance and **checked by a second person** before use. Also the employer's own EPF, PERKESO, LHDN and HRD numbers.

**Rules.** Wages paid within 7 days after the month; daily rate = monthly pay / 26; PCB is an estimate until Finance checks
e-PCB; Prima drafts files and never pays or files.

---

## Claims (`claims`)

**Status:** Main, extended (#49 receipt wallet and company head check).

**Purpose.** Staff medical, dental, optical, check-up and travel claims.

**Who sees it.** Staff with their own record (not guards or officers), HR and the Chief of Staff, company managers, and
Finance for payment.

**What is on it.** **My claims** and **New claim**; **Trips to approve before you go** and **Ask to travel**; **My
receipts** (camera or upload, read on the phone, **Claim now** or later); for HR, **Enter for staff** (pilot); **Mileage
rates** the Chief of Staff publishes monthly.

**Actions and approvals.** The company head **Verify**s with a comment (a rejection ends it); HR checks; the Chief of
Staff approves trips that need it; the COO approves; Finance **Record payment** with the reference.

---

## SOCSO claims (`socso`)

**Status:** Main.

**Purpose.** PERKESO claims for injured workers. PERKESO has no API: HR submits Form 34 in ASSIST and records the
reference here.

**Who sees it.** Group leaders, HR, operations (OM and above), company managers, admin executives and supervisors.

**What is on it.** **How to claim (SOP)**; claims (open or all); one claim with what happened, **pay for the MC days**,
papers, roster and clock-in from the app, PERKESO's decision, history and the **next step**. **Return to work**: plan,
**work restrictions** (block unsuitable roster posts), appointments, weekly check-ins.

**Steps HR records.** Form 34 submitted; all papers sent; PERKESO reviewing; approved or rejected; appeal lodged; appeal
approved or rejected; paid, close.

---

## Foreign workers (`fwm`)

**Status:** Main, extended (#62 recruitment and welfare).

**Purpose.** Foreign Worker Management renews every foreign worker's papers and sends the OMs dated tasks.

**Who sees it.** Group leaders, FWM (the despatch sees tasks only), the Chief of Staff, OMs and Regional OMs, company
managers. Switched off if the JA app takes over FWM.

**Tabs.**
- **Papers**: papers on the reminder ladder (for me or all), workers reaching year 10 within a year, tasks to the OMs
  (waiting for the OM, sent back, done for FWM to check, accepted). Actions: **Renewal submitted** (pauses the ladder),
  **Send task to OM**, **Accept**, **Send back**.
- **Recruitment and welfare** *(candidate)*: each worker's **arrival fee check**, **passport check** and **welfare talk**
  (every 90 days); follow-ups closed by someone else; agencies; confidential to FWM and group leaders.

---

## Hostels (`hostels`)

**Status:** Main.

**Purpose.** Hostel bills and utility excess per worker.

**Who sees it.** Group leaders, FWM, HR, the Operations Director and OGM, and the owning company's manager and admin
executives. Switched off if the JA app takes over hostels.

**Flow.** The owning company **adds a bill** and **asks for payment approval**; FWM checks; the Operations Director
(private) or OGM (government) approves, then the COO; the company pays and **uploads the payment slip**. Payment history
by month shows an unpaid or unproven month in red. Reminders 14, 7 and 3 days before due; overdue goes to the Chief of
Staff, COO and CEO (*proposed*).

**Utility excess.** Electricity above RM30 and water above RM20 a head are shared by bed. Before any deduction: **Give a
notice**, **Worker signed the notice**, **File the signed contract clause**, **File the worker's signed
acknowledgement**, then **Deduct from pay**.
