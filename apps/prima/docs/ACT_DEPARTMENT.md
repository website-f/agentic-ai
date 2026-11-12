# ACT: Audit, Compliance and Transformation

Status: draft for review (2 Nov 2026). Test data only. Nothing here is deployed, migrated or live.

## What Fauzan asked (2 Nov 2026)

ACT monitors the whole group: internal audit, compliance and transformation. It has 1 Director and 2 teams, and each
team has 1 Auditor and 1 Enforcement officer. The system should work as one organisation: data is keyed in once, every
department gets what it needs, routine checks are automated, and staff work is easier.

## Research basis

| Source | What it means for ACT in Prima |
|---|---|
| IIA Global Internal Audit Standards (published Jan 2024, in force 9 Jan 2025) | Use a risk-based audit plan that covers every workflow, keep the audit function independent of the work it audits, follow management's action plans until they are done, and report to the top (the CEO and the board). |
| Three Lines model (IIA) | Owners (first line) fix the problem. Compliance and ACT monitoring (second and third lines) check it. ACT never fixes its own findings, and in Prima ACT can never be named as the owner of a finding. |
| MACC Act 2009 s.17A and the Guidelines on Adequate Procedures (in force 1 Jun 2020), known as TRUST | Top-level commitment; Risk assessment; Undertake control measures; Systematic review, monitoring and **enforcement**; Training and communication. The new ETHICS workflow covers gifts and speak-up. The Enforcement officer role is the "S" in TRUST. |
| Private Agencies (Amendment) Act 2025 (passed by Parliament Oct 2025) | Licence renewals and checks are tighter, so expired company licences and guard permits are now monitored signals (LICENSING). |
| Continuous auditing and monitoring practice | The system counts rule breaks every day from the records departments already keep, then a person decides whether to raise a finding. Detection is automatic. Judgement and discipline are not. |
| Fauzan's trust rule (2 Nov 2026) | Controls go only where the job needs them. Owners are never punished automatically, and ACT staff do not get second-person steps on routine work. |

Sources:
[IIA standards effective date](https://www.theiia.org/fr-ca/content/communications/press-releases/2025/january/the-iia-celebrates-the-effective-date-of-the-global-internal-audit-standards),
[KPMG summary of the standards](https://kpmg.com/us/en/articles/2024/global-internal-audit-standards.html),
[MACC s.17A TRUST (HSF)](https://www.hsfkramer.com/notes/fsrandcorpcrime/2020-04/malaysia-section-17a-of-the-macc-act-trust-ed-adequate-procedures-for-your-corporation),
[Skrine on the s.17A guidelines](https://www.skrine.com/insights/alerts/february-2019/introduction-of-guidelines-on-adequate-procedures),
[Private Agencies (Amendment) Bill 2025 passed](https://www.freemalaysiatoday.com/category/nation/2025/10/09/bill-to-streamline-private-security-licence-renewals-passed).
These are secondary summaries. Legal counsel should confirm the wording against the gazetted texts.

## Who does what (built)

| Job | Prima record (mock) | Can do |
|---|---|---|
| Director (head of ACT) | `u-audit` (`actRole=lead`, kept so the Arisha leadership pilot record does not change) | Sees everything. Sets the guard pay formulas, the workflow timings and the JA switch-over numbers. Records audits, checks fixes, raises findings and leads improvements; may also give the second check. |
| ACT Manager (C6, Fauzan 11 Nov 2026) | `u-act-mgr` (`actRole=manager`) | Leads the work: sees both teams, gives findings, audits, reviews and investigations to a team, and gives the **second check** that closes a high finding. Checks the JA switch difference report and approves JA imports. Prepares pay formula drafts but does not make them live. |
| Auditor (team lead), Team A (1) / Team B (2) | `u-act-aud1`, `u-act-aud2` | Runs the workflow audits, raises findings, checks fixes (closes medium and low, gives the first check on high), and records audit results. |
| Enforcement, Team 1 / Team 2 | `u-act-enf1`, `u-act-enf2` | Follows up owners who are late (call, message, email, visit, meeting or memo, with the next date), raises findings from spot checks, and ticks improvement steps. Enforcement does **not** check fixes or record audits, so the person chasing an owner is never the person who signs off the fix. |

Both teams cover every workflow (Fauzan, 2 Nov 2026), and **the Director or the ACT Manager distributes the work**:
workflow audits, monthly report reviews and findings. A finding an Auditor or Enforcement officer raises stays with their
team; one the Director or the Manager raises waits until it is given to Team A (1) or Team B (2). Work given to a team is
recorded done by that team's Auditor (or the Director or the Manager), and nobody from the other team can close it.
**Each team sees its own work** (C6): an Auditor or Enforcement officer sees only their team's findings and work (plus
any finding they raised); the Director and the ACT Manager see both teams.

Each person's job and team are fields of their Prima sign-in (`actRole`, `actTeam`). The app's database login can only
read sign-in records (by design), so the job and team are set on the same reviewed path that sets every sign-in's
department and role; the "Who is in ACT" card shows them, with "not assigned" for an empty seat.

## Monthly reports of each department (Fauzan, 2 Nov 2026)

Recommended way (built):

1. **One report, sent once.** Each department sends its monthly report through the Director Office report list (Reports
   screen), by a fixed day of the next month. ACT reads the same submission, so nobody sends a copy to ACT.
2. **Every department is counted.** The ACT "Monthly reports" tab lists every central department and every company for
   the last month due: on time, late, missing, or "no monthly report set". A department without a report set is never
   green, and the Director Office should add one for it (proposal: due on the 7th).
3. **ACT checks three things.** Is it on time? Is it complete (the standard sections)? Is it true? For the last
   question, the Auditor compares the report's key figures with the records already in Prima, such as headcount
   against HR, collections against Finance, and incidents against cases.
4. **The Director distributes the reviews.** Use one click per report ("Review: Team 1/2"), split evenly each month,
   and swap the departments between the teams every quarter so each team sees every department.
5. **Problems become findings.** A late or wrong report becomes a finding with an owner (the department head) and goes
   through the normal plan, fix and check cycle and the escalation ladder.
6. **Proposed summary.** One page a month from the ACT Director to the CEO covering reports in and on time, reviews
   done, findings opened and closed, and anything escalated.

**Due date (Fauzan, 2 Nov 2026):** the 25th of the next month, 25 days after the month ends. Every central department
now has a monthly report on the Director Office list with that due day.

**Standard form (proposal; the ACT Director decides what each department needs, rule RPT-MONTHLY):**

1. Summary of the month: three to five key points.
2. Key figures against target: speed and quality of the work.
3. Work done, work still open and anything overdue.
4. Money: spending against budget, payments made and pending.
5. People: headcount, joiners, leavers, leave and training.
6. Compliance: licences, permits and legal dates due in the next 90 days; ACT findings open and fixed.
7. Risks, incidents and complaints.
8. Improvements done and planned.
9. Decisions or help needed from management.

Each department also has a short list of figures ACT compares with Prima's own records. For example, Finance's
collections are checked against SQL Account and the bank, and Arms Control's firearm count against the vault register.
The ACT Director can change the sections and checks for each department on the "Monthly reports" tab. When a sender
sends the report, they tick the sections it covers, and ACT sees any section left out.

## Workflow timing and field checks (Fauzan, 2 Nov 2026)

- **Set after a review, by the Director only.** After ACT reviews a workflow (a finished workflow audit), the ACT
  Director sets two things. The first is how often the workflow is audited, which replaces the rule default. The
  second is the time each step may take, in hours or working days, timed from when the work reaches the person. Every
  change is kept with its reason and the review it rests on, and the latest change is the one in force.
- **Every step is visible.** The ACT "Workflow timing" tab lists each workflow's steps. It also walks the workflow
  through a working day (8.30 to 5.30, Monday to Friday) to show when each step would fall due. This walk-through is a
  fixed calculation, not AI. Arisha AI can present it later, once AI is switched on.
- **Field check every 6 months.** Any ACT member records what actually happens at each step on site, and each step
  is shown against its timing. A workflow that has never been checked, or whose check is overdue, is not green.
- **Other screens.** `PrimaService.workStandardHours(): Promise<Record<string, number>>` returns the hours in force for
  each work key (an optional key on a step, such as the playbook item id `it-ex-queue`, or `assigned`). A key with no
  timing set is absent from the result; unset never means zero. Days count as 9-hour working days. Caveat: the timing
  rows live in `prima.act_audits`, behind the ACT wall. On PostgreSQL, a non-ACT session reads `{}` until a published
  read-only copy exists. That copy needs a schema change on the release path and is not part of this PR.

## Review fixes (Arisha main, 2 Nov 2026)

- **Owners.** The owner must work in the finding's company or be PWVSB central staff. A finding about a PWVSB
  department goes only to PWVSB staff.
- **Teams.** Auditors and Enforcement officers act only on findings and work belonging to their own team. A finding
  not yet given to a team waits for the Director.
- **High findings (C6, Fauzan 11 Nov 2026).** The team Auditor (or the Manager or the Director) gives the first check
  or sends it back as not fixed. A passed first check waits for the **second check** by the ACT Manager (the Director
  may also give it), which closes it. Nobody second-checks their own work: never the first checker, never the person
  who raised the finding. Enforced in the service; the screen shows the reason when a button is not offered.
- **Incomplete reports.** A report sent with sections of its form missing shows "Incomplete", never "On time".
- **Refusals.** ACT refusals give a plain reason instead of the company-grant wording.
- **Database test.** A PostgreSQL test confirms that the Director's form survives a Director Office save of the
  report list.
- **Guide cards.** Each ACT task (owner plan, owner fix, ACT check, follow-up, assigned audit, report review, timing,
  field check) has a collapsible read-only "Panduan / Guide" card, BM with English. It names only the real finding or
  work reference and people already on the record (owner, who raised it, the team, the Director), and missing evidence
  reads "Belum disahkan / Unresolved". Text lives in `apps/web/src/act-guide/guide.ts`.

## Record patterns (fraud-risk checks), investigations and forensic controls (masterplan item 241; Fauzan, 3 Nov 2026)

Fauzan said "build all not build" (3 Nov 2026). Rule ACT-FRAUD. All numbers below are proposals. The screen tab is
"Patterns and investigations".

- **Pattern checks (ACT only).** Five fixed checks over records Prima already keeps. They use no AI. Each one is a
  match or pattern for a person in ACT to verify, never proof and never an accusation, and Prima makes no decision
  about any person:
  1. **Supplier and staff account number match:** a supplier record and a staff salary record list the same account
     number. This is a match between records only. It does not show that any payment was made, or when, and it is
     not limited to the 90-day look-back.
  2. **Possible duplicate claim pattern:** more than one claim by one person with the same kind, date and amount in
     the last 90 days, including claims not yet paid (the status of each is shown).
  3. **Same photo fingerprint on more than one clock** in the last 90 days.
  4. **Clock-ins close in time and place:** two people within 5 minutes and 25 m, both away from their base.
     Colleagues often arrive together.
  5. **Repeated rent reversal pattern:** 2 or more rent payment reversals recorded by one person in 90 days.
     Reversals are often corrections.

  ACT decides whether to raise a finding or open an investigation.
- **Investigations (ACT only).**
  - The ACT Director opens one for any team. An Auditor opens one for their own team. Enforcement adds evidence and notes but does not open one.
  - Only the team it is given to and the Director see the file. The other team sees only "Under investigation" against the anomaly.
  - Evidence is stored inside the file with a SHA-256 the server computes. The same file cannot be attached twice. Nothing is removed. Each time a file is opened, its hash is checked again, and a mismatch shows as "HASH DOES NOT MATCH".
  - The SHA-256 covers the file's decoded bytes, not the data-URL text. The same file sent again under another type
    label (for example `application/octet-stream` instead of `application/pdf`) is refused as already attached.
  - The custody log records every open, evidence add, evidence view, note, team change and close.
  - **Changes run one at a time (Arisha main round 3, 3 Nov 2026).** Every evidence add, evidence view, note, team
    change and close takes the investigation row lock (`SELECT … FOR UPDATE` on PostgreSQL) inside its transaction,
    reads the file again after the lock, and re-checks that it is open and the file is new. Opening a file takes a
    separate transaction lock, so numbering and "one open file per pattern" hold. Two evidence adds at once keep both
    files and both custody lines, and an add that races a close is refused instead of reopening the file. The demo's
    in-memory store has no database lock, so the service also queues these changes in order.
  - Only the Director closes a file, with an outcome (substantiated, not substantiated, or referred) and a reason. A referral names who it goes to, such as HR or Legal, and they decide any action. Prima never disciplines anyone.
  - A closed file takes no more evidence.
- **Insider abuse audit item 16.** At the shared site phone, leave is refused when the face does not match, is missing or is not enrolled. The supervisor or company office can still enter it for the guard.
- **Insider abuse audit item 13.**
  - A clock photo already used (same SHA-256) is refused, so an old picture cannot clock a colleague in or out.
  - The anomaly finder looks for the photo reused across staff and for two people clocking at one spot.
  - Still not done: the face score is still the one the phone sends. Scoring it on the server needs a face provider that is not configured. Microsoft sign-in with MFA (PR #11) and the work-from-home check-ins already cover shared passwords and idle laptops.
- **Limits (explicit gaps).**
  - Server-side face verification is not done: the face score is still the one the phone sends (see item 13 above).
  - Investigations live in `prima.act_audits`, behind the ACT wall. At the database level, that wall also lets group leaders read the rows, while the service refuses them. A separate wall would need a schema change.
  - On PostgreSQL, a staff member's own reuse check only sees the clocks their wall lets them read. The cross-staff check is the ACT anomaly.

## What is automated

1. **Compliance monitor, 20 signals.** Each signal is a daily count of rule breaks, read from records that departments
   already keep. New signals in this change: company licences that are expired or have no expiry on record; guard
   permits past expiry; firearms not returned on time; insurance that has expired or has an unpaid premium; HIRARC
   reviews that are late; speak-up reports not acknowledged within 7 days; gifts still waiting for a decision; pay
   changes past their start date and not yet verified; monthly reports missing, late or not set.
2. **Key in once.** When ACT raises a finding from a signal, the server fills in the workflow, the team, today's count
   and the date. It also refuses a second open finding for the same signal. What the screen sends is not trusted.
3. **Follow-up queue.** A finding goes into Enforcement's queue when the owner has no plan 5 days after it was raised,
   when it is past its due date, or when the fix failed the check. It leaves the queue once a follow-up is recorded,
   and comes back after 7 days or on the promised next date.
4. **Each job's to-do list.** The Director sees high fixes to close and escalations. Auditors see fixes to check and
   signals with no finding yet. Enforcement sees owners to chase. Owners see what they must fix.
5. **Unchanged rules.** Escalation still goes to the Chief of Staff on day 1, the COO on day 14 and the CEO on day 30.
   Fix-by days are 14, 30 and 60. The audit cycle is every 6 or 12 months, and a workflow never audited is never green.

Owners see ACT's findings about their own work. They do not see ACT's internal follow-up log.

## Waiting for Fauzan (proposals in rule ACT-PLAN)

- The plan follow-up after 5 days and the 7-day follow-up cycle.
- Whether Enforcement may also check low findings (currently no).
- Real names. The Director's Microsoft account link is still unverified (see `docs/ARISHA_CEO_ONBOARDING.md`).

## Not done here

- No deployment, migration, tenant change or provider setup.
- Browser test (2 Nov 2026): headless Chromium on the demo build with synthetic seed data, 18 of 18 steps passed:
  owner enters a fix, empty proof refused, wrong-team Auditor has no check controls, Auditor returns, owner corrects
  and resubmits, Auditor closes a medium finding, Enforcement follows up without check controls, Auditor cannot close
  a high finding, Director closes it, guide cards shown, no page errors. The demo's IT-pilot sign-in gate was switched
  off in the served test copy only, because owners and ACT team members are not pilot sign-ins. This is the in-memory
  demo, not PostgreSQL or a deployed site; server refusals are covered by the core and PostgreSQL tests.
- Browser test (3 Nov 2026), Patterns and investigations tab (re-run after the round 3 fixes with the new labels), same method: 11 of 11 steps passed:
  - the Auditor sees the seeded duplicate claim, opens an investigation and adds evidence with its hash;
  - the same file a second time is refused;
  - opening the file re-checks the hash;
  - the Team 2 Auditor cannot see the file, and the company manager has no tab;
  - closing as referred without saying to whom is refused, and the Director then closes it;
  - no page errors.
- **Round 3 test evidence (3 Nov 2026, local, synthetic data):**
  - Core (in-memory store): 699 of 699 passed. Five new tests in `packages/core/test/act-fraud.test.ts` (two adds and a
    note at once; close racing an add; same bytes under another label, hash equals Node's SHA-256 of the bytes; three
    opens at once get three numbers; neutral wording). All five fail on the previous head 81e58f8.
  - API on local PostgreSQL 16 with row-level security: 684 of 684 passed. Two new tests in
    `apps/api/test/act-fraud-pg.test.ts` run each call on its own connection and transaction: four evidence adds at
    once keep all four files and custody lines; a close racing an add stays closed; same bytes under another label are
    refused; three parallel opens get three numbers. Against the old service code the four-add test kept only 2 of 4
    files and the relabelled file was accepted; with the fix it passed three runs in a row.
  - Typecheck and the demo build pass. The browser tests above (18 of 18, 11 of 11) passed again on the new build.
  - This is local evidence, not a deployed database; no migration is needed (no schema change).
- Other unbuilt masterplan modules (HR 3G/3D, Special Ops 4B–4H, Central Admin 5B–5G, JA and SQL Account feeds) are
  separate work.
