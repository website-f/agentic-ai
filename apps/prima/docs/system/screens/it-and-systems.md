# Screens: IT, websites, connections and continuity

Status key: **Main**, **Candidate (#nn)**, **Main, extended (#nn)**. See [screens index](README.md).

IT is the **pilot department** (rule `PILOT-IT`). The detailed runbooks for these modules are in `docs/`:
`IT_OPERATIONS_PILOT.md`, `IT_MANUAL_PILOT.md`, `IT_PROCUREMENT_RECONSTRUCTED.md`, `IT_WORKFLOW_METRICS_*.md`,
`IT_RENTAL_*.md`, `IT_CLEANUP_*.md`, `IT_RECORD_CORRECTIONS.md`, `HR_IT_INTAKE_*.md`, `WEBSITE_*.md`,
`CONNECTIONS_*.md`, `M365_SHARED_PILOT_WIRING.md` and `MONDAY_PILOT_REQUIREMENTS_MATRIX.md`.

**IT people.** The IT team (1 IT Manager, 1 IT Lead, 4 IT Executives) is employed by Merdeka Network Sdn Bhd. The IT
Manager supervises and is not technical: gives jobs, chases them and accepts the proof. The IT Lead checks technical
work. The CEO owns every system, domain and account and alone grants or removes access; IT only operates. The COO
monitors and approves purchases.

---

## IT (`it`)

**Status:** Main, extended (#41 IT checking for other departments' work).

**Who sees it.** Everyone (to ask IT for help); the IT team, the COO and the CEO see the full workspace; the ACT head sees
the Audit tab.

**Tabs (by person).**

| Tab | What it does | Who |
|---|---|---|
| **My requests** / Ask IT for help | **Send to IT**; for each resolved request the asker presses **Yes, it is fixed** or **Not fixed** (reopens with the same IT person) | Everyone |
| **My work** | Everything given to me; for the IT Manager and IT Lead, what waits for their acceptance or technical check; late jobs to chase; help requests nobody has; joiners, leavers and tenders given to me | IT staff |
| **Plan** | Week, month and year plan: who has what, regular work, **Suggest a plan** (Arisha suggests; the IT Manager decides and gives each job) | IT Manager plans, others look |
| **Team** | Who is doing what in the last 30 days | IT Manager, IT Lead, COO, CEO |
| **Jobs** | **Give a job** (named doer, due date); **Start**, **Submit as done** (with proof), **Technical check passed** (IT Lead), **Accept** or **Send back** (IT Manager), **Add note**, **Cancel job**, **Change the job**. The COO or CEO may decide anyone's job with a reason; the person in charge sees "The COO or CEO decided these" with **Seen** | IT, COO, CEO |
| **Help requests** | **Log a request** (also for people not on the system), **Take it**, **Resolve**, **They say it is fixed** (recorded by someone other than the fixer) | IT |
| **Systems and access** | Every system the group runs; recorded access lists; **Confirm the recorded list**; **Ask the CEO to change access**; the CEO **Approve**s or **Reject**s recorded access requests (reviewed every 90 days) | IT, CEO |
| **Assets** | Register by kind; **Assign**, **Return to store**, **Send for repair**, **Ask to dispose**, **Dispose**; service and repair history (separate from six-monthly health inspections) | IT |
| **Device rental** | Merdeka Network rents devices to group companies: Manager-set rate versions and immutable billing records; health and condition every six months | IT Manager, Finance views |
| **Purchases** | **Ask to buy**: 3 quotes + 1 online price with documents; **Send for COO then CEO approval**; **Approve** / **Reject** with a reason; then **Open authorized IT purchase fulfilment** | IT, COO, CEO |
| **Maintenance** | Service due (CCTV, network, printers), in repair, disposal asked | IT |
| **Websites and domains** | Links to the Websites screen (one register) | IT |
| **Tenders (eP)** | IT tenders from ePerolehan and other government channels: **Add a tender found**, which companies hold IT codes (**Record a company**, certificate), IT parts and papers from the company, each stage timed in minutes; **Won**, **Lost**, **No-go** | IT Manager and paired IT Executive; IT Lead checks the technical part |
| **Joining and leaving** | IT steps for joiners and leavers, from the HR/IT joining request | IT |
| **Audit** | Controls that must hold, exceptions to check, every IT action | ACT head, CEO |
| **Import** | The CEO's one-time batch import of open IT work: preview, then approve the batch once; rows with errors or repeats are left out and listed; nothing already in Prima changes | CEO |

**When the IT Manager is away.** The IT Manager or the COO records it; the COO then accepts finished work until "The IT
Manager is back".

**Rules.** Nobody accepts their own work. A job 3 days late goes to the COO, 7 days to the CEO. A help request 24 hours
past its limit goes to the COO. IT resolves a request; **the requester confirms it**. Recording a checklist or access
decision does not provision or revoke a Microsoft account by itself.

---

## IT purchase fulfilment (`it-procurement`)

**Status:** Main.

**Purpose.** After a purchase is approved: order, delivery, receipt, tagging and handover evidence, each step with a
saved receipt and safe retry.

**Who sees it.** Group leaders, IT, Finance and ACT (never system feeds).

---

## Workflow time & quality (`it-metrics`)

**Status:** Main.

**Purpose.** How long each workflow step takes from when work reaches the person, and source-derived quality (not
self-rating). Versioned provisional targets and a business calendar; scoped comparable cohorts; coverage shows which
workflows are not yet measured.

**Who sees it.** Shown in the menu for every role; the server returns only the timing scope the person is authorised for.

---

## HR / IT coordination (`hr-it-intake`)

**Status:** Main.

**Purpose.** Joining and leaving coordination between HR and IT for systems, existing devices and SharePoint guidance.
HR prepares the exact scope; the Chief of Staff or company head reviews it; the IT Manager approves bounded technical
tasks for an executive; every step has a receipt and safe recovery. Recording a decision here does not create or remove a
provider account.

**Who sees it.** Everyone involved (server-scoped to their own records).

---

## Websites (`websites`)

**Status:** Main.

**Purpose.** One register of every company's domains and websites, run by IT: who owns what, quarterly content reviews
with the company, monthly checks, urgent issues, DNS changes, renewals, social media and email health. No outside
publication is done from here; manual records and optional read-only connector observations stay distinct.

**Who sees it.** Group leaders, IT, Finance, ACT, company managers and admin executives (their own company's sites).

**Tabs.** Overview (dashboards by role, **Run reminders now**); Companies; Websites (**Add website**, owners, reviews,
issues); Domains (**Add domain**, **Confirm renewal**, renewal payment **Paid** / **Unpaid**, **Raise DNS change**);
Social media and online listings (accounts, admins, access review); Email (manual Microsoft email change checklist, email
health per domain, mailbox review per company); Quarterly reviews (company answer, IT preparation, approvals,
publication, tests after publication, **The information is accurate**, **Complete the review**); Monthly checks (assign in
a batch, checklist, **Complete check**); Issues and urgent changes (**Report an issue**, **Approve urgent change**,
**Published and checked**, assign, work it, resolve; the reporter confirms the fix); DNS and nameserver changes (before
check, **Approve (IT Lead)**, after check, **Close the change** or **Roll back**); Reports (**Export (Excel)**, **Print or
PDF**); Settings; Connections (**Read connectors now**, website requests from SharePoint **Accept** / **Decline**, DNS
changed outside an approved change).

**Pilot.** Companies and ACT are not on the system yet, so the IT Manager records their answers and approvals for them;
the name and how it was given travel with each step.

---

## Connections (`connections`)

**Status:** Main for the SharePoint and selected-mail panels; extended by #60 (Outlook, Teams, SharePoint access check).

**Purpose.** Each office staff member checks their own Microsoft 365 access (Outlook, Teams, SharePoint) and the setup
requests for it. **Check my access**, **Refresh setup status**, **Cancel request**.

**Rules.** Off by default; tenant steps need the owner. Staff Send and reply stay in Outlook; Prima never registers a
mail-send permission. Copying a selected message to a job needs explicit selection and current audience authorisation.
A saved setup request or a successful sign-in is never shown as "Connected".

---

## Continuity (`continuity`)

**Status:** Main.

**Purpose.** Business continuity: every system keeps copies (cloud, own server, emergency server). IT records each
backup, restore test and drill; a copy with no record is Unknown.

**Who sees it.** IT (records) and group leaders (watch).

**Tabs.** **Systems and copies** (**Backup done now**, **Record restore test**; restore tests every 6 months against
target recovery times); **Playbooks** (5 playbooks, **Record a drill** yearly). All mock data until Prima is hosted.

---

## AI data preview (`it-extraction`)

**Status:** Main, behind a build flag.

**Purpose.** The CEO's preview of fields Arisha would extract from IT documents, reviewed before any import. Shown only to
the CEO's own account and only when the build flag, the server readiness check and Microsoft sign-in all allow it. Review
writes stay disabled where durable storage is not supported.
