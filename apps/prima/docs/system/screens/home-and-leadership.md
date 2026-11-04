# Screens: home, leadership and the company office

Status key: **Main** = on `main`. **Candidate (#nn)** = only in the combined candidate, brought by draft PR #nn.
**Main, extended (#nn)** = the screen is on main and the candidate adds more to it.

---

## Home (`home`)

**Status:** Main, extended (#63 growth panel and approval limits; departments add their own lines).

**Purpose.** The first screen for each job. It shows only what that person must act on or watch, and every line opens
the screen where the work is done.

**Who sees it.** Group leaders, company managers, admin executives and supervisors. PWVSB staff without a home open on
their department's first screen.

**What is on it, by role.**

| Role | Home |
|---|---|
| CEO and group leaders ("Executive view") | Tiles; **Do today** (only items that reached the leader's own step: approvals, CEO instructions, consents); **Growth** panel; **Monitor** list (open P1 cases still with operations as one line, late JA feeds, late PDPA breach notices, joint tender reports for 7 days, overdue hostel bills, tenders closing within 7 days and not signed, foreign worker papers within 7 days) |
| Company Manager | The company's no-shows, cases, papers to fix, quotations to approve, contracts and mobilisation, branch actions to review, renewals to sign, arms readiness |
| Admin Executive | Licences, tenders and quotations to work, guard papers to fix, renewals |
| Supervisor | Their own sites: no-shows, patrols, cases, arms out |

Department modules add their own lines (HR consents, staff payroll steps, Finance, IT, ACT, credit, governance, renewals,
company files, delegations, panel firms, memos to read, CEO instructions and others).

**Approval limits (CEO only).** The CEO sets two value limits with a comment: staff claims that need no COO approval,
and purchases that need no CEO approval. Empty means no limit (the COO approves every claim; COO and CEO approve every
purchase). Each change is kept with its history.

**Growth panel (leaders).** Read only: is the group growing and which company is pulling it down. A figure with no
recorded source shows Unknown. Never a ranking of people.

---

## Group (`overview`)

**Status:** Main.

**Purpose.** "Group today": every company the person may see, side by side.

**Who sees it.** Group leaders (and the Director Office sign-in).

**What is on it.** Group totals and a companies table (guards, sites, no-shows, open cases, licences, papers). Leaders
with the right open the **company master record** form (company name, SSM number, addresses, state, head of company,
source document): the Head of Company drafts, the Deputy Chief of Staff checks it against the SSM extract and never
checks their own draft.

---

## Company today (`company`)

**Status:** Main.

**Purpose.** One company's position today.

**Who sees it.** Group leaders, and the company's own manager and admin executives.

**What is on it.** No-shows right now; rostered guards not allowed to work (and why); open cases; guard papers to fix;
company licences. A company manager also sees HR's requests to them: **vacancies to sign** and **staff moving in to
accept** (the head cannot open the HR screen, so these come here).

---

## Company office (`office`)

**Status:** Candidate (#57).

**Purpose.** Each licensed company's own office: 1 Company Manager or GM and 2 to 8 executives. The head shares the
company's work out to **desks**, each with an owner and a backup.

**Who sees it.** Group leaders (every office's staffing), company managers and admin executives (their own office). Not
a far-branch manager (they run the branch instead).

**What is on it.**
- *All offices* (leaders): every office's staffing and work by desk, and **companies run by another office**.
- *One office*: the KDN licence (a fact shown, never a block), team, desks with owner and backup, office work by desk,
  what to fix, and guide cards for each office task.

**Actions and approvals.**
- **Share out desks** (Company Manager or GM only): pick owner and backup per desk. A desk cleared on purpose stays
  clear; suggestions fill only desks never shared out.
- **Run by another office** (Chief of Staff and CEO): a company without a licence or enough work can be run by another
  company's office, whose head then manages it and can give its desks to their own executives. One level only; a reason
  is required; every change is audited.

**Data.** People come from the accounts HR and IT already keep; nothing is keyed twice.

---

## Director Office (`doa`)

**Status:** Main, extended (#52 Director Office desk and legal flags).

**Purpose.** The Director Office Administrator's desk: every company's tenders, quotations, proposals and leads and where
each stands, the reports companies send in, and the meeting schedule.

**Who sees it.** Group leaders and the Director Office department.

**What is on it.**
- Tenders across companies; quotations waiting for approval; **joint tenders** (see Tenders & quotes).
- **This week** *(candidate)*: a weekly digest put together from what is already keyed in.
- **CEO instructions** *(candidate)*: the CEO gives an instruction (or the Director Office records it for the CEO); it
  lands in the owner's own task list; the CEO accepts the result with a reason.
- **Legal flags** *(candidate, directors only)*: each open legal point with its source, the records it touches, who
  answers for it, status and audit trail. An open point is never shown as compliant.

---

## Reports (`reports`)

**Status:** Main.

**Purpose.** Weekly and monthly reports every department and company sends to the Director Office.

**Who sees it.** Group leaders, PWVSB departments, company managers and admin executives.

**What is on it.** *To send*: your reports with status (sent on time, sent late, not sent, not due yet, unknown when not
on the app). *Who has sent* (Director Office). **Send report** attaches the file.

**Actions.** The Director Office Administrator **changes the report list** (add, change, take off); a report taken off
keeps its history. Monthly reports are due on the 25th in a standard form the ACT Director decides (`RPT-MONTHLY`).

---

## Meetings (`meetings`)

**Status:** Main.

**Purpose.** Meetings across the group, their agendas, minutes and actions, and every deadline for the calendar.

**Who sees it.** Group leaders, PWVSB departments, company managers and admin executives.

**What is on it.**
- *Calendar*: the next 60 days of meetings, actions, tender dates and report dates; **Add all to Outlook** or per item
  (an .ics calendar file; production will sync through Microsoft 365).
- *Meetings and minutes*: numbered agenda, pre-briefing checklist by meeting kind, open actions from the last meeting,
  minutes, action items, and **Summary is right** confirmation.

**Rules.** Every meeting has an agenda and checklist; a meeting not ready 24 hours before is flagged (`MTG-PREP`).

---

## Hand-overs (`handovers`)

**Status:** Candidate (#56).

**Purpose.** "Key in once and every department gets the data it needs." Shows what other departments keyed that this
person must act on or know about.

**Who sees it.** Group leaders, PWVSB departments, company managers and admin executives.

**What is on it.**
- **My hand-overs**: each to-do or info notice, with a link to the record. If the link would open a screen the person
  does not have, it says where the record is instead.
- **Late or with nobody to receive** (ACT and leaders).
- **Every link between departments**: the full map (see [hand-over map](../reference/handover-map.md)).
- **Guide**: all the person's guide cards.
- **Import**: load existing records from a spreadsheet through the same checks as the forms.

**Actions.** **Done**, **Not needed**, **Noted**. The joining hand-overs for HR and IT follow the HR/IT joining request:
they are done only once IT has recorded the Microsoft identity there, and "not needed" only when HR cancels.
