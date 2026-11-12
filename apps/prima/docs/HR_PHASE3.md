# HR Phase 3 (Fauzan, 1 Nov 2026)

Department order: IT > Finance (Phase 2) > **HR (Phase 3)** > Special Ops > Central Admin > Nationwide.
The full plan, with what is built, what is left and the open questions, is the Claude Doc *Prima HR rollout plan (Phase 3)*.
Everything here runs on mock data. Nothing is deployed, no migration runs, and no real staff records are loaded.

## Fauzan's decisions (1 Nov 2026)

1. **Scope.** Phase 3 covers office staff. Guards' HR stays in the JA Group app, but each company must keep its guards' records. Slice 3G will agree the data list with the JA team and keep those records read-only per company.
2. **Approvals.**
   - The Chief of Staff is the HR Director, and the Deputy Chief of Staff stands in.
   - The HR Administrator keeps the records, deals with staff and does what the Chief of Staff assigns.
   - **Monthly staff payroll:** HR prepares, then the Chief of Staff approves, then the COO approves, then Finance pays.
   - **Salary amounts** (set each year or on review): HR proposes, the Chief of Staff or Deputy verifies, then the Vice Chairman consents.
   - **Staff leave:** the HR Administrator decides, then the Vice Chairman consents.
3. **Governance.** The HR department governs HR in every company with full authority. Each company only monitors its own staff's HR.
4. **Comments.** Every approval carries a comment (decided 31 Oct 2026). Any short comment is accepted.

## Slice 3A: built on branch `claude/project-thread-andehu` (draft PR)

| Area | Before | Now |
| --- | --- | --- |
| Staff leave | HR, or the HR Director after 12 hours, decides alone | HR approves with a comment and the request stays pending. Only the Vice Chairman then consents or refuses, with a comment. The CEO stands in while the pilot rule is on, but never on a request he approved for HR. |
| Guard and officer leave | OM or above | Unchanged |
| Basic pay change | CoS or DCoS verifies and the pay applies | CoS or DCoS verifies with a comment, then the Vice Chairman consents with a comment, and only then does the pay apply. Pay for the CoS or DCoS goes to the Vice Chairman alone (unchanged). |
| Salary account change | HR Director and Finance | Unchanged, but each check now needs a comment |
| Monthly payroll run | CoS approves, VC consents (stage `consented`) | CoS or DCoS approves, then the COO approves (stage `coo_approved`, field `cooApproved`, action `coo_approve`), each with a comment. The COO step is never taken by the person who approved as Chief of Staff. |
| Office staff HR file (hiring papers, MC, hospital claims) | Company manager and admin executives could upload | HR only; the company views |
| Asking leave for an office staff member | Staff member, line manager, company manager, HR | Staff member, line manager or HR |
| SOCSO claims for office staff | Company could start and manage | HR starts and manages; the company views |
| Vice Chairman's home | No HR items | Staff leave and salary amounts waiting for consent |
| Sign-in | IT pilot only | `PRIMA_ROLLOUTS=hr` (or the older `HR_ROLLOUT=true`; off by default, shared department switch) also admits the CoS, DCoS and Vice Chairman |

Code: `packages/core/src/hr.ts` (`inHrRollout`, `isHrAdmin`); `requireApprovalReason` and the flows in `packages/core/src/service.ts`; `apps/api/src/auth.ts` (`pilotAdmits`).
Tests: `packages/core/test/hr-phase3a.test.ts`, plus updated payroll, leave and pay-change tests in `core.test.ts`, `pilot-routing.test.ts` and `apps/api/test/rls.test.ts`.

**Data note.** The payroll stage `consented` was renamed to `coo_approved`, and the field `consented` to `cooApproved`. These live in JSONB, so there is no schema change and no migration. Staging holds no staff payroll runs. Any run left at `consented` would need a manual review before it could be paid.

## Slice 3A part 2: staff privacy notice (removed)

A staff privacy notice and face consent screen was built, then removed at Fauzan's request (1 Nov 2026). Face matching at clock in works as before.

## Slice 3A part 3: HR database wall (same draft PR, needs the CEO-run migration)

- The full IC or passport number moves to `prima.staff_ids`, and the full salary account moves to `prima.staff_accounts`. Neither stays on the person record that the company and other departments read.
- `staff_ids` wall: HR, the HR Director (CoS, DCoS) and the CEO. `staff_accounts` wall: the same people plus Finance, for the supplier fraud check and to finish a verified account change. The database enforces both (`prima.has_wall`), and so does the service (`seesStaffIds`, `seesStaffAccounts` in `access.ts`).
- A new salary account waits behind the wall (`StaffAccount.pending`) until the HR Director and Finance both verify it. The pay change itself keeps only the masked number. A refusal clears the waiting account.
- Someone outside the wall who types a full number is refused. On the HR form they see the full fields empty.
- **Fauzan's choice (1 Nov 2026):** each company manager also sees the full IC and salary account of their own company's staff, read only (`staff_company` wall, limited in the database to the companies in `app.company_ids`). Admin executives and other companies see only the last digits. Only HR types or changes a full number.
- Rows written before the wall keep their numbers on the person record until HR next saves them. Staging began on a clean slate with no staff records.
- **Migration:** two new tables, policies and grants in `db/migrations/001_init.sql`. This changes the schema fingerprint, so the CEO-authorized migration workflow must run before this code is deployed.
- Tests: `packages/core/test/hr-wall.test.ts` (4), the wall list in `staff-security.test.ts`, the salary account test in `core.test.ts`, and a database test in `apps/api/test/staff-security.test.ts`.
- Illness details on leave stay as they are today (worker, company manager and HR).
- Finance's bank payment file now carries the full account number from behind the wall. A line with no verified full number says `MISSING: ask HR`.
- Guard pay stays in the JA app, where company admin staff check it. The wall covers office staff only. When guard records come over from JA (3G), each company's admin staff will see their own guards' full numbers.

## Face recognition for staff clock in (Fauzan, 2 Nov 2026)

Fauzan asked for face recognition at clock in and chose the free engine that runs on the phone (decision card, 2 Nov 2026).

- **Register once:** the staff member registers their face on My clock, on their own phone. HR (the HR Administrator, or the CoS or DCoS) looks at the photo, then approves or refuses it with a comment. Nobody approves their own face.
- **Each sign-in:** signing in still clocks the person in. With an approved face, the clock shows "Face check not done" (`FACE_PENDING`) until they press *Check my face*.
- **Matching:** the phone's engine (`@vladmandic/face-api`, MIT, files served by Prima itself from `/face-models`) turns the photo into 128 numbers. The **server** compares them with the approved face (`packages/core/src/face.ts`; distance 0.6 = score 0.8 = rule OPS-FACE-MATCH). A score sent by the phone is ignored. The registered numbers never go back to a phone.
- **Accepted risk:** the phone makes the numbers, so a determined person could fake them. The phone also has only a basic movement check, not a real liveness test. Every face-check photo is kept on the clock record, and HR should spot-check them.
- **Data:** registered faces live in `prima.staff_faces`. Only the person (their own row) and HR or the HR Director (`staff_faces` wall) can read it. The person can only write a row waiting for approval, never an approved one. Company managers and Finance cannot see faces. **Needs the same CEO-run migration.**
- **Without an approved face**, clocking is photo-only, as before. HR can remove a face with a reason, and the person can then register again.
- **Guards** still clock in by face on the site device (JA app). This change covers office staff.
- **Tests:** `packages/core/test/face-clock.test.ts` (5), plus database tests in `apps/api/test/staff-security.test.ts`. A browser check confirmed the engine loads from Prima's own files and runs (WebGL). It has not yet been tried with a real face on a phone.

## Fauzan's answers on the HR gaps doc (2 Nov 2026)

Fauzan approved all 21 gaps in the doc *HR gaps still to cover (Phase 3)*. His notes:

- Maternity and paternity leave as the Act gives them, and HR may give more.
- HR keeps the public holidays and may add more than the Act requires.
- Staff overtime is prepared but stays off until HR switches it on and sets the rates, because most staff earn above RM4,000.
- LHDN forms are made by the system automatically.
- Each staff member has a discipline file.
- Working from home is only for staff HR allows. The system blocks it until then.
- Retrenchment is a how-to guide for HR. Retirement at 60 works the same as for guards for now.
- OSHA items 13 to 15 are approved.
- Vacancies: the CEO approves and the company head signs the approval. PWVSB central posts: the CEO approves and signs in one step (Fauzan, 11 Nov 2026, C2).
- Payslips are delivered in the app and staff download them.
- Handbook, code of conduct and IT-use acknowledgements are approved.
- Statutory dates are shown as the latest allowed date, not an exact date.

Build order: 3C, then 3D (after Finance PR #49, which rewrites staff payroll), then 3B, 3E, OSHA, and 3F/3G.

## Slice 3C: leave in full (same draft PR, needs the CEO-run migration)

- **Maternity and paternity leave** (rule EA-FAMILY-LEAVE, Employment Act s.37, s.41A and s.60FA):
  - Maternity is 98 consecutive days. The leave note flags a staff member under 90 days of service, or one with five or more children, so HR can check the maternity allowance.
  - Paternity is 7 consecutive days for a married man with 12 months of service.
  - HR may raise maternity, paternity, annual or sick leave for one staff member, always with a reason. HR can never go below the Act and never sets their own (`setLeaveOverride`, kept as `Person.leaveOverrides`).
- **Public holidays** (rule EA-PUBLIC-HOLIDAY, s.60D):
  - HR adds and removes holidays per state, giving a reason to remove one, and may add more than the Act requires (`prima.public_holidays`). Everyone can read the list.
  - A check per state shows when a year has fewer than 11 days or is missing one of the five fixed days. It is a reminder only, never a block.
  - The mock list carries only the fixed-date days. HR enters the rest of each year's gazetted list.
- **Office staff leave counts working days.** Saturdays, Sundays and the holidays of the staff member's state are not counted. Maternity, paternity and hospitalisation stay in calendar days. Guards are unchanged.
- **Working from home only for staff HR allows** (`Person.wfhAllowed`):
  - Until HR allows it, the staff member sees "HR has not opened working from home for you". Applying is refused.
  - When HR stops it, any open or approved arrangement ends, with HR's reason.
  - Only HR (the HR Administrator, or the CoS or DCoS) answers applications. The company manager no longer does, but line managers still review home days.
- **Flexible hours or days requests** (s.60P, `prima.flex_requests`, same company wall as working from home):
  - The staff member asks. HR answers in writing within 60 days, always with a comment, and must give the grounds for a refusal. Nobody answers their own request.
  - Overdue answers turn red on HR's home.
- **Tests:**
  - `packages/core/test/hr-leave.test.ts` (6).
  - Updated working-from-home tests in `core.test.ts`.
  - A database test in `apps/api/test/staff-security.test.ts`.

## Slice 3B: joining and leaving (same draft PR, needs the CEO-run migration)

Rule HR-JOIN-LEAVE. HR sees it on the HR monitor screen and on Home.

- **Filings with the latest day to file** (Fauzan: show the latest date, not an exact date; the system does it automatically):
  - CP22 within 30 days of joining.
  - SOCSO and EIS registration within 30 days.
  - EPF from the first month, by the 15th of the next month.
  - CP22A at least 30 days before the last day. LHDN exempts some cases where PCB was deducted, so HR checks.
  - EA forms by end February and Borang E with CP8D by 31 March, shown from January.
  - Prima drafts and reminds. HR files with LHDN, KWSP and PERKESO and records the reference (`prima.hr_filings`). Items due within a week, or late, show on HR's Home.
- **EA figures** come from the year's paid staff payroll: gross, EPF, SOCSO with EIS, and PCB, plus the full IC for HR. HR checks benefits in kind and allowances paid outside payroll before issuing.
- **Register of employees:** active staff plus anyone who left in the last 6 years, downloaded per employer. HR only.
- **Probation:** HR is reminded 14 days before it ends, and again once it has passed. HR confirms or extends it with a comment, never for themselves. Decisions are kept on the record.
- **Retirement at 60**, the same as for guards: HR sees office staff who are 60 or will reach it within 90 days.
- **s.41A:** a termination recorded around maternity leave is shown to HR in red.
- **Leaving guide** (Fauzan: a guide for HR, not a decision):
  - The notice period under the Act (4, 6 or 8 weeks) and the termination benefit (10, 15 or 20 days' wages a year, after 12 months).
  - The retrenchment steps: a fair method, consultation, Form PK to JTK at least 30 days before, CP22A, and keeping the records.
- **Vacancies** (rule HR-VACANCY, `prima.vacancies`):
  - HR, or the company manager for their own company, raises a vacancy.
  - The CEO approves or refuses it, never one he raised himself. The company head then signs the approval: the company manager, or the HR Director for PWVSB central posts.
  - Every step needs a comment. HR or the company head marks the vacancy filled or cancels it.
  - Who signs for central posts is my assumption; Fauzan can change it.
- **Tests:**
  - `packages/core/test/hr-joining.test.ts` (7).
  - A database test in `apps/api/test/staff-security.test.ts`.

## Slice 3E: each staff member's HR file (same draft PR, needs the CEO-run migration)

Rule HR-CASE, stored in `prima.hr_cases`.

- **Case types:** misconduct, sexual harassment, grievance and performance. Each staff member's cases form their file (Fauzan: "a file on what happens with each staff member").
- **Who records what:**
  - HR opens a case and records each step. HR never handles a case they are part of.
  - Company managers can read their own company's non-confidential cases but cannot act on them.
- **The right to be heard:**
  - A show-cause letter gives the staff member at least 7 days to reply in writing, by default.
  - An inquiry needs a show-cause letter first.
  - The inquiry panel leaves out the staff member, the complainant and whoever opened the case.
  - A suspension before the inquiry lasts at most 14 days, on at least half pay.
- **Outcomes:**
  - Dismissal, downgrade or suspension without wages (at most 14 days) comes only after an inquiry has found the charge proven (s.14(1)).
  - Only the HR Director (CoS or DCoS) or the CEO records an outcome.
- **Sexual harassment complaints** (Part XVA):
  - The case is **confidential**. Only HR, the HR Director and the CEO can see it (the `hr_cases` wall, enforced in the database). Audit entries do not include the details.
  - HR must set up an inquiry, or refuse one with written reasons, within 30 days of receiving the complaint. A refusal is accepted only within those 30 days.
  - HR's Home turns red in the last week before the 30 days run out.
- **Workplace notice (s.81H):** a yearly reminder on HR's filings list for each employer to confirm the sexual harassment notice is on display.
- **Tests:**
  - `packages/core/test/hr-cases.test.ts` (3).
  - A database test in `apps/api/test/staff-security.test.ts`.

## Office OSH: coordinator, risk assessment, DOSH reports (same draft PR, needs the CEO-run migration)

Fauzan, 2 Nov 2026 (gaps 13 to 15): "Do it also". Rule `HR-OSH-OFFICE`. Records are kept in `prima.office_osh` behind the company wall.

- **OSH coordinator (OSHA 1994 s.29A):** an employer with 5 or more active staff without a named coordinator is flagged on HR's Home. HR alone names the coordinator. Naming a new one ends the old one the same day.
- **Office risk assessment (HIRARC, s.18B):** HR or that employer's coordinator records each office or floor, with the number of hazards and how many are high risk. High risks need a note of the controls. A review is due after 12 months.
- **DOSH reports (NADOPOD Regulations 2004):** HR, the coordinator or the company manager records an accident, dangerous occurrence, poisoning or disease. The JKKP 6 form (JKKP 7 for a disease) is due within 7 days. A death or serious injury is flagged so DOSH is told at once. HR or the coordinator records the DOSH reference. Prima never files.
- **JKKP 8:** the yearly summary is on HR's filings list each January, due 31 January.
- **Who sees it:** HR, the HR Director and the CEO see every employer. A company manager and a named coordinator see their own. A coordinator outside HR finds the panel on the staff clock screen.
- **Tests:**
  - `packages/core/test/hr-osh.test.ts` (3).
  - A database test in `apps/api/test/staff-security.test.ts`.

## Slice 3F: training, appraisal, payslips, handbook (same draft PR, needs the CEO-run migration)

Fauzan, 2 Nov 2026 (gaps 18 to 20): appraisal and training "Do it"; payslips "Delivery in app. Staff download it"; handbook "Do it also". Rule `HR-DEVELOP`.

- **Training** (`prima.staff_training`): HR records each course with hours, cost and the HRD Corp claim reference. Staff see their own on the staff clock screen.
- **Appraisal** (`prima.staff_appraisals`): HR opens one per staff member per year and names the appraiser. The staff member can never appraise themselves, and HR never opens their own. The appraiser rates 1 to 5 with a comment. The staff member sees it only after that, reads it and may comment. HR closes it with a comment once the staff member has read it, or after 14 days. This is not the KPI, which stays on hold.
- **Payslips:** already shown in the app once Finance pays. Staff now download the payslip as a page they can keep or print to PDF. Nothing leaves the phone.
- **Handbook, code of conduct, IT use** (`prima.hr_policies`, `prima.policy_acks`): HR publishes the text. Every active office staff member reads and acknowledges it, and HR sees who has not. A new version asks everyone again.
- **Tests:**
  - `packages/core/test/hr-develop.test.ts` (4).
  - A database test in `apps/api/test/staff-security.test.ts`.

## Guard training and legal papers (Fauzan, 2 Nov 2026)

Fauzan: "Guard details on training also must be viewed and managed by HR department. CSG and all required by law must be able to monitor and manage. Company head of pertaining guard also can manage and view."

- **Board** (`guardTraining`, on the Guards screen): each active guard's KDN guard card, eSIMS vetting, CSG (within the first year) and TNG, with the same legal status the roster uses. Each company has a summary: guards, CSG done, CSG still due, past the CSG deadline, and no valid KDN card. KDN counts untrained guards at licence renewal.
- **Who:** HR sees and manages every company. The company head (company manager) sees and manages their own guards only. Group leaders view only.
- **Operations** (Fauzan, 2 Nov 2026: "Operation department need to know monitor and manage this also about guard hr"): the OM and Regional OM see and manage the guards of the states they cover; the Operations Director, OGM and COO every company they can see. They also record guards' other courses and get the Home alerts.
- **Recording** (`recordGuardPaper`): KDN card (with expiry), eSIMS vetting, CSG and TNG are stored as credentials with who recorded them, under the company wall. Firearm permits and range practice stay with Arms Control, and foreign worker papers with FWM.
- **Other courses:** HR or the company head records a guard's other courses in the training record.
- **Home:** HR and each company head see guards past the CSG deadline or without a valid KDN card, and guards still needing CSG in their first year.
- **Open point:** JA is the guards' system of record. Papers recorded in Prima are marked with who recorded them; how they flow back to JA waits for the JA link (3G).
- **Tests:**
  - `packages/core/test/guard-training.test.ts` (3).
  - A database test in `apps/api/test/staff-security.test.ts`.

## Slice 3G: guard records from JA, keyed once (Fauzan, 2 Nov 2026)

Fauzan: "Key in once and all department get the data needed. Make sure try to automate what can be automated."

- **Feed:** the JA Group app sends guards to `POST /api/integrations/ja/v1/guards` with its own system sign-in. Field list in `docs/JA_GUARD_FEED.md`. Until JA is ready, only test data is used.
- **One record:** each guard becomes, or updates, one person record. The match is company plus staff number. HR, the company, Operations, the CSG/KDN board, payroll checks and Home all read that record. Nobody types the guard in again.
- **Papers:** the KDN card, eSIMS vetting, CSG and TNG from JA are added once each to the guard's papers, marked "JA Group app". The guard training board picks them up straight away.
- **Full numbers:** the full IC/passport and salary account go only behind the HR wall (`prima.staff_ids`, `prima.staff_accounts`), marked as a guard's. The JA record and the person record hold masked numbers only. A salary account change from JA is written to the audit log.
- **Database walls:**
  - `guard_feed`: the JA feed reads and writes guard rows only, for the companies it is granted. It never touches an office staff member's row.
  - `fw_ids`: FWM (not the despatch) reads foreign workers' passport numbers only. It never reads accounts or Malaysian ICs, and never changes them.
  - Company managers keep their existing read-only view of their own company.
- **JA screen:** a Guards tab shows per-company counts: active, suspended, left and foreign. It flags a late feed as unknown.
  - HR, company heads and group leaders also see any basic pay below the minimum wage.
  - Operations sees counts only, never pay.
- **Tests:**
  - `packages/core/test/hr-3g-3d.test.ts`.
  - A database test in `apps/api/test/staff-security.test.ts` (feed wall, FWM wall, no full number on the JA or person record).

## Slice 3D: payroll checks (Fauzan, 2 Nov 2026)

Finance PR #49 rewrites the payroll tables. 3D is therefore kept in its own module (`packages/core/src/hr-payroll-checks.ts`) plus one flag line in `payroll.ts`, so the two PRs barely touch.

- **Minimum wage** (rule `HR-MIN-WAGE`): RM1,700 a month from 1 Feb 2025 (RM1,500 before), under the Minimum Wages Order 2024. A staff payslip below it is flagged. JA guards below it are listed on the JA screen.
- **Staff overtime** (rule `HR-OT`, table `prima.staff_overtime`): OFF until HR turns it on.
  - HR sets the rates. They can never be below the Act: 1.5x a normal day, 2x a rest day, 3x a public holiday.
  - HR ticks which office staff may claim it, and every change needs a reason. History is kept.
  - Pay is worked out as basic / 26 / 8 x hours x rate. Staff above the Act's RM4,000 wage limit are marked; HR decides for them.
  - The calculator only works out the amount. Claiming and paying overtime waits for Finance PR #49.
- **EPF and SOCSO files:** they now carry the IC/passport and the EPF/SOCSO member number, which KWSP and PERKESO match on.
  - HR's copy has the full IC from behind the HR wall.
  - Finance's copy has the masked IC, marked "HR completes".
  - Prima still never sends the files.

## Review fixes (Arisha main, 2 Nov 2026)

- **JA guard boundary (43cd733):** a JA row whose staff number belongs to office staff is refused with nothing written.
  - Every check runs before the first write.
  - On PostgreSQL each guard sits in its own savepoint, so one clash undoes that guard alone.
  - Database refusals reach JA as a plain reason.
- **Legal points for the directors** (Fauzan confirmed 14:59Z: legal, privacy, retention and biometric flags go only in the directors' view; staff get no legal-only blocks):
  - The points are listed in `packages/core/src/hr-legal.ts`:
    - the staff privacy notice that was removed (not restored automatically);
    - face data;
    - faces of leavers;
    - leavers' full numbers;
    - guards' numbers from JA.
  - Each shows its sources, the records it touches (counted live), a responsible director, a status (unresolved, being checked, resolved by a director) and its history. Every change is audited.
  - Only the HR Director and the CEO see the points. They are behind the new `hr_legal` wall on `prima.hr_legal_checks`.
  - Nothing is ever called compliant.

## Staff movement: promotion, transfer and secondment (Fauzan, 3 Nov 2026)

Fauzan's answers (06:05Z): promotion also needs the CEO, with the Vice Chairman's consent; a transfer starts a fresh
employment by law, but the HR record keeps when the person started in the group; secondment is allowed with the CEO's
consent.

- **Who prepares:** HR only (HR screen, "Staff movement"). One waiting movement per person. Every step needs a comment.
  Nobody approves their own preparation, a movement of themselves, or two steps of the same movement.
- **Steps:**
  - Promotion: HR Director (CoS or DCoS), then the CEO, then the Vice Chairman consents.
  - Transfer to another group company: the receiving company head accepts, then the HR Director. For a central employer
    (PWVSB) the CEO takes the receiving step.
  - Secondment: the host company head, then the HR Director, then the CEO consents. The employer does not change.
  - Pilot: while the pilot rule is on, the CEO may stand in for the HR Director and the Vice Chairman; the step is labelled "standing in".
- **Approval and taking effect are separate (Arisha main review, 3 Nov 2026).** The last approval only agrees the
  movement. If its date has come it applies at once; otherwise it waits as "approved" and nothing on any record changes.
  On or after the date HR or the CEO applies it ("Apply movements due today"; HR's Home shows what is due, red when late
  or when a try failed). Nothing runs on a timer yet. Applying is safe to repeat: the movement row and the person row are
  locked, a movement already applied is returned unchanged, and the new records take ids made from the movement id, so a
  replay cannot create a second employment or pay change. Everything is checked again when it applies (the person is still
  active, the staff number is still free at the new company, the branch still exists, no other basic pay change waits).
  If a check fails the reason is kept on the movement, it stays approved, and it can be applied again once fixed. HR can
  cancel an approved movement before it applies and prepare a corrected one; only one waiting or approved movement per
  person.
- **When it applies:**
  - Promotion: the new title, department and reporting line; a new basic pay is written as an already verified pay change
    carrying the HR Director's check and the Vice Chairman's consent from the movement.
  - Transfer: a new staff record at the new company (new staff number and branch, hire date = the effective date, so leave
    and service start again), with "joined the group on" kept from the old record. The old record ends the day before and
    is closed as left in the same unit, so the two employments never overlap. The full IC and salary account are
    copied behind the HR wall. The old record ends the day before as "transferred" and links to the new one. A new pay at
    the new company goes through the usual pay change.
  - Secondment: the host company and end date are shown on the person's record.
- **The transfer month in payroll (Arisha main retest of 598218f, 3 Nov 2026):**
  - Each employer's month now includes everyone employed on any day of it, including those who left or transferred
    out during it. Before this, a mid-month transfer dropped the person from the old employer's month.
  - A line covering only part of the month (joined, left or transferred during it) shows its dates. No proration rule
    is set (asked Fauzan on 3 Nov; no default), so HR enters the basic and fixed allowances for the days worked, with
    how they were worked out. The month cannot be submitted until every such line has them. Allowances keep their EPF,
    SOCSO, PCB and HRD ticks.
  - A month cannot be submitted while a movement into or out of that employer, taking effect by the month end, is still
    waiting or approved but not applied. It also cannot be submitted when staff, or the days they are paid for, changed
    since it was calculated; HR recalculates first. A delayed apply therefore cannot pay the old employer a full month.
  - A movement is not applied while a payroll month from its effective month is already submitted at either employer.
    The movement stays approved, the reason is shown, and HR returns the month and recalculates. This also applies at
    the last approval.
- **The login after a transfer:**
  - Applying a transfer writes a login handover (`prima.login_handovers`, `lh-<movement id>`): who, the accounts that still
    point to the old record, from which company to which, from when. It carries no pay, no reason and no staff record detail.
  - The HR Director (or the CEO) authorises it with a reason on the HR screen. That person cannot be the preparer, the
    applier or the person moved.
  - IT works it from the IT page ("Login handovers after a transfer"), not from the HR screen, which IT cannot open. IT
    makes the change through the approved account process, because Prima itself has no right to change accounts.
  - IT then confirms in Prima. Prima refuses the confirmation unless every account (a) points to the new record, (b)
    reaches the new company, and (c) no longer reaches the old company, as worked out from the account's role, companies
    and grants on that day. Nobody confirms their own move.
  - Until then, self-service on the old record refuses leave with a plain explanation. Prima never treats the old login
    as the new employee.
  - Pilot note: with no CoS signed in, a transfer the CEO approved and applied needs the CoS or DCoS to authorise the login move.
- **Stale payroll drafts:** each payroll line keeps a fingerprint of what it was calculated from (basic pay, allowances
  with their EPF/SOCSO/PCB/HRD ticks, paid days, approved unpaid leave, and the facts the contribution rates depend on).
  Submission is refused while any line's fingerprint no longer matches the record, for example after a promotion with
  new pay or an allowance consent; HR recalculates first.
- **Who sees:** HR, the HR Director, the CEO, the Vice Chairman, and the heads of the two companies (wall `staff_movements`; IT and other staff never read the movement row). The receiving head
  acts from Company today (the head cannot open the HR screen); vacancy signing for the head is shown there too.
- **Database:** `prima.staff_movements` (company wall) plus `movement_receiving_read` and `movement_receiving_accept`, so
  the receiving company's head can read and accept a movement that belongs to the sending company. A RESTRICTIVE
  `movement_wall` adds the `staff_movements` wall on top, so an IT or other staff session reads no movement rows even
  inside its companies. `prima.login_handovers` sits behind its own `login_handover` wall (IT, HR, the HR Director, the
  CEO). Base hash changes.

## Allowances HR sets (Fauzan, 3 Nov 2026)

Fauzan (06:24Z): "HR also have the ability to set allowance, the amount and what allowance is".

- **The list (HR screen, "Allowances"):** each allowance has a name, whether it is paid monthly, one-off or either, an
  optional usual amount and monthly cap, and four ticks: EPF, SOCSO (EIS and LINDUNG use the same wage), PCB and the HRD
  levy. HR records where its ticks come from. Prima does not decide the law for any allowance. Only HR changes the list;
  every change keeps the reason and is audited, including the old ticks. Retired allowances stay on record.
- **A staff member's monthly allowances:** HR picks from the list and gives the amount, start date and reason. This is a
  pay change of kind `ALLOWANCE`: the HR Director verifies, then the Vice Chairman consents, as for basic pay (Fauzan chose
  "Same as basic pay" on 3 Nov 2026, 07:44Z). The record changes only at consent, and only if the start date has come;
  a change consented for a later date waits and is applied by HR's "apply changes due today" step on or after that date,
  never into a payroll month already submitted; a consent given after the start date goes through the same check and
  waits, with the reason, while that month is submitted. Payroll for an earlier month uses the pay and allowances in
  force in that month, rebuilt by effective date. Dates must be real calendar dates, not before the person joined, not
  before the first day of last month (decided by Fauzan, 4 Nov 2026) and not before a change already approved for
  that person. Submission, consent and
  apply share one lock on the payroll month and each rechecks under it. A month cannot be submitted while a person's
  older basic pay history was applied out of date order and disagrees with the record; HR keys a correcting change. A consent or an apply is refused if the record changed since HR keyed it,
  and no second change can be keyed while one is waiting for approval or for its date. Allowances entered before the list carry no type and
  still count for everything, as before; HR moves them onto a listed allowance when it next sets that person's allowances.
- **Payroll:** EPF, SOCSO, EIS, LINDUNG, PCB and the HRD levy are worked out on gross pay less the allowances whose box is
  unticked. The line shows which allowances were left out of what. The EPF, SOCSO and PCB files carry those wages.
  One-off allowances in a payroll month are picked from the list and keep their ticks. A type's monthly cap covers all
  one-offs of that type on the line plus any fixed amount of that type. The HRD levy basis is basic pay plus fixed
  allowances and one-offs whose type is ticked for HRD (to be confirmed against HRD Corp's wage definition; an unlisted
  one-off stays out). If HR changes a type's ticks after a draft was calculated, the draft cannot be submitted until it is
  recalculated; a submitted month is never changed by a type change. If HR lowers a cap after a draft was made, the draft
  cannot be submitted while a line is over it; a cap cannot be lowered below anyone's fixed amount of that type.
- **Pilot note:** with no Chief of Staff signed in yet, the CEO can consent for the Vice Chairman but cannot also verify as
  HR Director, so allowance and basic pay changes wait until the CoS or DCoS signs in (unchanged from basic pay).
- **Database:** `prima.allowance_types` (group-wide, like `prima.hr_policies`; no one's pay in it). Base hash changes.

## Job posts for vacancies (audit decision 6, Fauzan 5 Nov 2026)

Rule `HR-JOB-ADVERT`. Code: `packages/core/src/hr-job-adverts.ts`, `PrimaService.advertStep`, route
`POST /api/vacancies/:id/advert/:action`, screen `JobPost` inside the Vacancies panel (HR, Company, and Operations for OMs).

- A vacancy now says whether it is for office staff, a guard or a patrolling officer. Guard and officer posts also
  name the state.
- Once a vacancy is open (CEO approved, company head signed; the CEO signs PWVSB central posts, C2, 11 Nov 2026), HR or the company manager writes the
  job post: "Draft for me" makes a bilingual BM + English draft from the job facts only (title, department, pay
  range, headcount, employer, how to apply, closing date). No AI model is connected yet, so the draft is labelled
  as Prima's template; `PrimaService.advertDrafter` is where a model plugs in later, and its output would be
  labelled "drafted by AI, not yet checked".
- Approval (Fauzan, 5 Nov 2026): the HR Director approves office staff posts; the Operations Manager covering the
  post's state approves guard and patrolling officer posts. The person who wrote the current wording never
  approves it. Approve and send back need a comment.
- Approval is bound to the exact version and SHA-256 of the wording, channels and closing date. Any edit sends
  the post back to draft and clears the approval. Every action carries the version the person saw.
- Wording checks: an IC number or a mobile number that is not the official number in "How to apply" blocks
  sending; discriminatory wording, pay below the minimum wage, no pay and no way to apply are warnings for the
  approver.
- Social publishing is switched off. Facebook, Instagram, LinkedIn, TikTok and JobStreet all show "not
  connected" and Prima never shows a post as published. After approval HR can copy the wording, post by hand,
  and record the link; that record is marked "recorded by HR, not checked by Prima".
- No new table: the post is kept on the vacancy row (`prima.vacancies.data`), so it adds no migration beyond the
  vacancies table already in this PR.

Fauzan's answers, 5 Nov 2026 (review questions 1-6):
1. The Regional OM of the state's region approves guard and patrolling officer posts as backup when the OM is away
   or no OM covers the state. The screen says when someone approves as backup.
2. No privacy line in posts.
3. The guard template wording stays ("aged 18 to 60", KDN vetting, CSG training).
4. JobStreet stays and is marked "paid per post"; the writer picks the channels each post needs.
5. An approved post goes out by itself once each account is connected: approval puts one entry per chosen channel
   in the post's `outbox` as "waiting for the account to be connected". An edit, send-back, withdrawal or closed
   vacancy empties the queue. No publisher exists yet, so nothing is posted and nothing can be marked posted.
6. Applicant list per vacancy, HR only: new table `prima.applicants` behind the new `applicants` wall (HR, the HR
   Director, the CEO; company managers and OMs never see applicants). HR keeps the list: name, phone or email,
   where they saw the post, the date applied, and new -> shortlisted -> interview (with date and time) -> offered ->
   hired, or not taken / withdrew at any step. Refusing, offering and hiring need a comment; no more hires than
   places; the same phone or email is refused twice on one vacancy. No IC number, CV file or photo is stored.
   Hiring does not create a staff record: HR then uses the joining steps. Base schema repinned to `6d454ec2…`.

Browser UAT (5 Nov 2026): `scripts/hr-job-posts-browser-uat.cjs`, 38/38 at 1400px and 390px on the demo build
with the IT-pilot sign-in limit off in a local copy only (HR, CEO, company manager, HR Director, Selangor and Johor
OMs, central Regional OM; Malaysia time zone). Review fixes from that round: the Regional OM now sees the job post
screen and its to-do line; interview times must carry a time zone (the screen converts Malaysia time); a withdrawn
post can be written again while the vacancy is open.

Proof of a post made by hand (Fauzan, 5 Nov 2026): the link stays the proof. For places with no link (WhatsApp
group, notice board, other place) HR records where it was posted; a photo field is kept empty until file storage
(draft PR #75) is switched on. Phone and IC numbers are refused in the place name.

Still open: connecting the social accounts (needs Fauzan's account access and a separate check before any
channel is switched on), and connecting an AI model for drafting.

## Not built yet

- HR KPI monitoring: on hold until the pilot test 1 results are in (Fauzan, 1 Nov 2026 15:53Z).
- Overtime claims inside the staff payroll run: waits for Finance PR #49.
- Papers recorded in Prima flowing back to JA: waits for the live JA link.
