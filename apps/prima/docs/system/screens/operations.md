# Screens: operations

Status key: **Main**, **Candidate (#nn)**, **Main, extended (#nn)**. See [screens index](README.md).

---

## Sites (`sites`)

**Status:** Main.

**Purpose.** Every guarded site of the chosen company, and each site's detail.

**Who sees it.** Group leaders, operations, company managers, admin executives and supervisors (their own sites).

**What is on it.** Site list; for one site: posts, who is on duty today, patrol checkpoints today (tapped or missed),
cases at the site, **site visits**, and **Open roster**.

**Actions.**
- Add or edit a site, post or checkpoint (company manager or admin executive, through the record form; a site needs GPS
  coordinates for the geofence).
- **Change patrol time**: the Regional OM sets the site's patrol interval (15 to 480 minutes) to follow the client's
  request; the group default is 2 hours.
- **Site visit**: check in by GPS with the server's time, take stamped photos, close with findings. A visit checked in
  away from the site shows red for the company to ask about.

---

## Roster (`roster`)

**Status:** Main.

**Purpose.** Plan who works which post and shift, week by week.

**Who sees it.** Group leaders, operations, company managers, admin executives and supervisors.

**What is on it.** One row per post and start time (a second guard on the same slot gets its own row), for this week or
next. Warnings for hours over 12, no rest day, guards not allowed to work, work restrictions from a SOCSO
rehabilitation, and empty shifts.

**Actions.** Place or remove a guard; **Publish this week** (company manager or supervisor; admin executives edit but do
not publish). PWVSB operations edits only with an `act` grant.

---

## Guards / People (`people`)

**Status:** Main, extended (#51 training, PIN and access; #56 import).

**Purpose.** The guard and staff list and each person's profile. HR and leaders see it as **People** and can also open
PWVSB's own central staff.

**Who sees it.** Group leaders, operations, HR, FWM (foreign workers only), company managers, admin executives,
supervisors. HR sees Malaysians and staff; FWM sees foreign workers; the company manager sees everyone in their company.

**What is on it (profile).**
- **Can this guard work today?** (age, KDN card or vetting, CSG, foreign worker papers, restrictions).
- Shifts in the last and next 7 days; hours day by day this month.
- **Coming next** (papers expiring, training due); licences, training and certificates; **chances to upgrade**.
- **Pay this month (estimate)** and medical and other benefits (company and HR only, not operations). Staff looking at
  their own record see their own amounts only, not the workings.
- Requests (leave, absence reasons) with **Correct and send again** for a refused one.
- Disciplinary record; attendance problems in the last 30 days.
- HR file: hiring checklist, MC and illness details, hospitalisation claims tracker, what can be claimed.
- SOCSO tab: **Start SOCSO claim** and the person's claims.
- **PIN and Prima access** *(candidate)*: HR or the company office sets the site-device PIN (never shown again); HR, the
  HR Director or the CEO **closes access** for a leaver.

**Actions.** Add or edit office staff through the record form (HR). Guards and officers are keyed in the JA Group app,
not here; Prima files them as person records that HR, the company and operations read. Full IC and salary account stay
behind the HR data wall.

---

## Attendance (`attendance`)

**Status:** Main.

**Purpose.** Who came to work, who did not, and what was done about it.

**Who sees it.** Group leaders, operations, company managers, admin executives and supervisors.

**What is on it.**
- **Alerting the PIC now**: live alerts repeating every 5 minutes until acted on, with the count and next alert time.
- **Absences, last 14 days**, with each replacement placed right under the post it covers (filter: not closed or all).
- **Absence and discipline**: guards absent more than 2 working days in a row, disciplinary records, every action
  taken, and the handbook ladder for each guard (what was given before, what is suggested, what the law allows yet).
- **Leave requests** waiting for a decision.

**Actions.** The PIC (or CMS) records what was done on an alert: told the guard, replacement placed, excused with a
reason. After 15 minutes without the PIC, operations may act for the company (`OPS-STEP-IN`). The company manager or
supervisor records a disciplinary step; never automatic. Lock attendance (company manager, supervisor).

---

## Cases (`cases`)

**Status:** Main.

**Purpose.** Every incident and problem, from report to fully resolved, with proof.

**Who sees it.** Group leaders, operations, Arms Control, company managers, admin executives and supervisors. Leaders can
switch between all companies and the selected company.

**What is on it.** Open or all cases with severity, level and age; for one case: proof (photos and documents with
fingerprints), the **escalation ladder** (levels above the Regional OM shown only when the case went there) and the
history.

**Actions.** **Raise a case** (with proof); **Acknowledge**; **Escalate** (reason); **Resolve** (proof); **Add note**;
**Close case** (company only). Verify, resolve and confirm need proof; send back and escalate need a reason. While the JA
app owns incidents, incidents are raised there.

---

## Regional ops (`ops`)

**Status:** Main, extended (#54 operations monitor and management fees).

**Purpose.** The Regional Operations Manager's board across every company with sites in their region. Each company still
decides its own rosters.

**Who sees it.** Group leaders and operations (OM and above).

**What is on it.**
- **Needs follow-up now**; leave and absence requests from guards and officers; companies in the region; patrolling
  officers (span of command, at most 60 guards); shifts with no guard in the next 7 days.
- **Operations monitor** *(candidate)*: for Goodwill Empire (government sites) and Sasa Team (private sites), each site's
  profit and loss, a check of every guard's pay against the hours worked, and guards on leave. Unknown is never shown as
  fine; a site's P&L stays Unknown until its company's management fee is entered.
- **Management fees** *(candidate)*: what Goodwill Empire and Sasa Team bill each company, entered by the FD or CEO from
  the signed management agreements, and the month's draft fee bills for Finance to raise in SQL Account.

---

## Clients (`clients`)

**Status:** Main, extended (#63 client report links).

**Purpose.** The client board: onboarding and offboarding, visits, monthly reports, complaints, satisfaction and billing.

**Who sees it.** Group leaders (the COO monitors every company), operations (OM, Regional OM, OGM, Operations Director,
patrolling officers), company managers (their own clients, record billing), admin executives and supervisors.

**What is on it.** Monthly operations meetings the COO holds with each company; clients by company; each client's steps,
contacts, reports, complaints, ratings, billing and invoice-sending proof.

**Actions.** **New client** (company manager or OM and up; onboarding starts with every step open); **Mark done** (what
was done in the note); **Log contact**; **Report sent**; **Log complaint**; **Save rating** (who at the client gave it and
how); **Start offboarding** (reason); **Update billing**; **Record** each way an invoice was sent with proof.

**Client report links** *(candidate)*: the company manager makes a read-only link for one period that expires; the client
opens it without signing in and sees only its own sites. No staff or guard names, case descriptions or money owed. Any
link can be revoked with a reason.

---

## Contracts (`contracts`)

**Status:** Main, extended (#53 CMS service step).

**Purpose.** Signed contracts and site mobilisation to go-live, and billing by the contract's method.

**Who sees it.** Group leaders, operations (OM and above), company managers and admin executives.

**What is on it.** Contracts with status; for one contract: billing method and figures, mobilisation workstreams, reviews
after go-live, the **CMS service** (signed scope, CMS acceptance, client acceptance), and history.

**Actions (company manager).** **New contract**; **Start mobilising**; **Sign Ready-to-Operate**; **Go live**;
**Suspend**, **Resume**, **End contract**; **Record a variation**. Items: **Mark done**, **Open again**, **Accept risk**
(non-critical only, up to 30 days), **Accept**; **Record review** at day 1, 7, 14, 30.

---

## Branches (`branches`)

**Status:** Main, extended (#61).

**Purpose.** Branches inside a licensed company, their signed agreements and monthly settlements.

**Who sees it.** Group leaders, company managers and admin executives.

**What is on it.** Each branch: agreement (model A, B or C and its signed versions), settlements by month, branch actions
to review, papers and accounts, step-in and closing, business case and 13-week cash, branch cash (from bank figures
Finance records; Unknown when nothing recent).

**Actions.** **Propose a new branch**; **Verify** papers; **Add account**; **Set project code**; **Activate branch**;
**New signed version**; **Prepare a month**; **Agreed to SQL Account**; **Approve settlement** (company manager);
**Return for correction**; **Record payment**; **Mark reviewed** (Finance on the business case); **Record figures**, **Set
float limit**.

---

## Far branches (`branchwork`)

**Status:** Main.

**Purpose.** Running far branches by checklist and visits.

**Who sees it.** The branch manager, the company manager, OM and above, ACT and CMS.

**What is on it.** An 8-measure **scorecard** (Unknown is never green); checklists with photo proof; visits and spot
checks: OM twice a month, Regional OM monthly, ACT unannounced once a half year, up to 2 random video spot checks a
month.

---

## Requests (`requests`)

**Status:** Main, extended (#52 rent and utilities from last month).

**Purpose.** Operation claims and office requests.

**Who sees it.** Group leaders, the Chief of Staff, OMs, and company managers.

**Actions.**
- **New operation claim**: the OM sets the month's claim items; **the COO approves**.
- **New office request** (consumables, utilities, rent; not IT or asset items): the company manager requests, **the Chief
  of Staff approves, the COO gives final approval**. **Rent / Utilities from last month** start from last month's
  approved request; check, attach the bill, send.
- **Approve**, **Send back**, **Reject** each with a reason.

---

## JA app data (`ja`)

**Status:** Main, extended (#51 guards from JA).

**Purpose.** Read-only data from the JA Group app, which runs guard and officer patrol, attendance, payroll, foreign
worker papers and incidents.

**Who sees it.** Group leaders, operations (OM and above), HR, FWM (not the despatch), CMS, company managers, admin
executives and supervisors with a tier.

**What is on it.** Each feed and its deliveries (a feed silent for 24 hours shows Unknown); payroll by period with
normal SOCSO and LINDUNG in separate columns (a figure JA has not sent shows as not sent, never zero); papers due within
30 days with no renewal submitted; incidents from JA; **guards by company** and **basic pay below the minimum wage**.

**Status of the link.** Not connected. Rule `SYS-JA-OWNS` lists nothing as owned yet, so Prima's own screens stay on;
each area switches over only when its feed is live.

---

## Site device (`device`)

**Status:** Main, extended (#51 face check).

**Purpose.** The shared phone or tablet kept at the guard post.

**Who sees it.** The site device sign-in only, for its own site.

**What is on it and actions.**
- **Clock in / Clock out** by face (staff number + 1:1 face match with a liveness check). A failed check is recorded and
  opens a P3 identity case; the guard is never refused. The face engine is not chosen yet; the test version simulates
  it.
- **Patrol checkpoint**: tap the NFC tag (Android Chrome), with staff number and PIN.
- **Report incident** with stamped photos, then add more photos of the scene.
- **Leave or absence reason** with staff number and face.
- **SOS**.
- *Today at this post*: who is on duty and the patrol state.
