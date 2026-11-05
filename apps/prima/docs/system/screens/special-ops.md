# Screens: special operations (arms, CMS, vehicles, assets)

Status key: **Main**, **Candidate (#nn)**, **Main, extended (#nn)**. See [screens index](README.md).

---

## Arms control (`arms`)

**Status:** Main, extended heavily (#53 Special Ops).

**Purpose.** Firearms, vaults, ammunition and armed jobs. The licensed company issues, receives and counts; PWVSB Arms
Control and the Director Office monitor; CMS watches. The paper register book stays in use.

**Who sees it.** Arms Control, CMS, the COO, CEO, Chairman, Vice Chairman, ACT head; company managers (own company) and
supervisors (only arms at their own sites and with their own people). Not admin executives or site devices.

**Company view (company manager, supervisor).**
- **Firearms out now** with state (on duty, overdue 15 min, overdue 30 min: escalate, over 2 hours: possible loss) and
  **Receive back**.
- **Armed shifts needing a firearm** and **Issue firearm**: RFID scan (a USB or Bluetooth reader types the tag code; left
  empty, it is recorded as not scanned) and a **witness** who types their own staff number and PIN.
- **Vaults** with **Count now**; firearm register (in vault, issued, maintenance, unverified, lost, with the police, off
  the register); returned in the last day.
- **Arms requests** *(candidate)*: **New arms request**, **Send to Arms Control**, and **Correct and resubmit** when sent
  back.
- **Armed jobs**: **Plan an armed job**, **Book the job**, **Update**, **Started** (booked, running, delayed, incident,
  completed).

**Arms Control view (all companies), tabs.**

| Tab | What it shows |
|---|---|
| Alerts | CMS arms alerts (watch checked in, late, not clocked in, nobody on watch), vaults as CMS sees them, vault door events and firearm movements in the last 24 hours |
| Readiness | Go or no-go for every armed shift now and in the next 24 hours, before the guard draws a firearm (cleared, not cleared, not confirmed) |
| Vaults; In and out | Every vault and every movement |
| Ammunition | Ledger by vault against the last physical count; rounds not returned; differences never adjusted silently |
| Armed jobs | Scheduled, on the job, completed, delayed, incident |
| Requests | The ten-step arms request path: **Pass to company**, **Send back**, **Authorise** / **Refuse** (company), **Legal: clear** / **Legal: stop**, **Record PDRM / KDN reference**, **Approve the spend** (COO or CEO), **Verify (not the requester)**, **Reconcile the register**, **Close**. Every decision takes a reason |
| Renewals | Firearm licences, permits and servicing |
| Client agreements | Client arms agreements and armed-service insurance for every armed site and job (signed, not signed, expired, none) |
| Police and KDN | Police reports for missing firearms (14 days), firearms to deposit with the police, firearms out at once, the annual firearms return to KDN, site police notification (not notified, site vault to install, waiting approval, live) |
| Tenders | Tenders to supply arms-related items; guarding tenders that need arms |
| Suppliers | Suppliers and their items, price catalogue |
| Trading | Arms trading and import: built, **off** until the CEO switches it on with an approved dealer licence |
| Companies | Each company's arms position |
| Legal points (directors) | Each open legal point with source, records touched, responsible director, status and history |

**CMS management** button opens the CMS roster and settings (Arms Control sets them).

---

## CMS (`cms`)

**Status:** Main, extended (#53 commissioning, response and coverage).

**Purpose.** The 24/7 command centre. CMS monitors and escalates; each company still decides.

**Who sees it.** CMS, Arms Control, the COO and higher (not other group leaders).

**What is on it.**
- **On shift now** and **Record handover**; **To act on**.
- **Roster**: every shift has 1 Head Control and 1 Monitor Officer; **Plan next week** (Arms Control).
- **Call back**: missed calls on every company's IP-phone extension (not answered in 20 seconds goes to CMS), **Called
  back**; today by company; company extensions; calls today.
- **Emergencies and alarms**: **Acknowledge**, **False alarm**; **False alarms for Head Control to review** (**Agree,
  false** or **It was real**). Open incidents at sites.
- **Attendance alerts to the PIC**: CMS can call the guard; the company does the rest.
- **Commissioning** *(candidate)*: signed CMS service per contract; operators **Mark verified** each call-out contact
  with a **Record test** call; Arms Control **Accept for CMS** once all are verified and sites linked.
- **Response and coverage, last 24 hours** *(candidate)*: how fast alarms are acknowledged and how much of the linked site
  equipment CMS can actually see, by company and site.
- **CMS settings** (Arms Control, within approved limits): **Save settings**, **Undo**; CMS staff; what CMS does.

**Not connected.** CCTV, alarm, door and vehicle feeds show as Unknown. The separate CMS command-centre app (`apps/cms`)
is built and tested on sample data only.

---

## Vehicles (`fleet`)

**Status:** Main, extended (#53 trips and driving hours).

**Purpose.** Company vehicles: renewals, servicing, payments, requests and monitoring.

**Who sees it.** The Transport head, CMS, the PDPA officer, group leaders, company managers and admin executives; staff
may request a vehicle. Not guards or officers.

**What is on it and actions.**
- **Renewals, servicing and payments** (road tax, insurance, permits, service by date or km): **Record with receipt**.
- Vehicles register (record form).
- **Requests**: staff **Request a vehicle**; the Transport head **Approve**s or **Reject**s; each use is logged out and in.
- **Trackers, dashcams and driver health**: CMS monitors; nothing is connected, so these show Unknown.
- **Driver consent to monitoring**: the PDPA officer **File consent** before a monitored vehicle is driven.
- *(candidate)* **Driver alerts**, **On the road** (positions kept only while out on a trip), **Driving hours today**
  (limits are proposals until Transport confirms).

---

## Asset Management (`assets`)

**Status:** Main, extended (#53 system comparison, purchases, WhatsApp reminders).

**Purpose.** A working model of the Asset Management department's system: 450 rental units, every non-electronic asset,
2 resorts, 6 orchards and the training facility. Real data will come from the department's own system by API.

**Who sees it.** The Asset Management team, group leadership and the Finance staff who oversee it. No group company sees
it.

**What is on it.**
- Units by type; rent billed and collected; **watch list**; **rent updates late** (unpaid units must be updated at least
  every 10 days; the Asset Director is alerted).
- **Monthly rent**: every let unit for the month, paid, part paid or not paid (only from recorded payments). **Contact or
  record payment**: Call, WhatsApp or Email open the phone's own apps with a reminder written (Malay first, English
  below); Prima sends nothing itself.
- **Record a payment** (cash, transfer, cheque, online; oldest month first; unique receipt number); **payments to confirm
  in the bank** (Finance banks cash within 2 days); **reversals** and **letters** waiting for the Asset Director
  (**Approve reversal**, **Approve**, **Stop**, **Refuse**).
- Arrears; payments recorded; group office and state branches; agreements ending soon; insurance, assessment and quit
  rent; work orders; register; disposals waiting for approval.
- *(candidate)* **Asset Management system against Prima**: where the two disagree on rent, status, tenant or paid months.
  The system's figures sit beside Prima's and never overwrite them; a month the system shows paid is "reported", not
  money received.
- *(candidate)* **Ask to buy** furniture and fittings with a reason; the FD (up to the limit) or COO decides; **Received**
  records tag, actual cost (not above approved) and date.
- *(candidate)* **WhatsApp rent reminders**: only tenants who agreed are messaged, with how they agreed recorded. Until
  WhatsApp Business is connected, reminders are only planned and the panel says so.
- **Fixed assets** (Finance side): monthly straight-line depreciation per owner entity drafted for SQL Account (**Posted**
  with the journal number); written off but still in use (**Keep using** or **Refurbish**); disposals (**Ask to dispose**,
  FD approves, COO above the limit, **Record disposal**).
