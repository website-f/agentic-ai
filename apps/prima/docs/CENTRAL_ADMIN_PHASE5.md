# Central Admin, Phase 5 (Fauzan, 1 Nov 2026)

Department order: IT > Finance (Phase 2) > HR (Phase 3) > Special Ops (Phase 4) > **Central Admin (Phase 5)** > Nationwide Ops.
The full plan is the Claude Doc *Phase 5 Central Admin plan* (https://claude.ai/artifact/2ja3V3rDujucg2aasMejC6).
Everything here runs on mock data. Nothing is deployed, no migration runs, and no real company records are loaded.

## Fauzan's decisions (1 Nov 2026)

- **Scope.** Director Office, CEO instruction tracker, company secretary and SSM filings, board, audit and legal, mandates, licences and a group deadline calendar, the Chief of Staff office (memos, office requests, insurance), and PWVSB credit and collateral. PDPA and procurement move to Phase 6 (Nationwide Ops). Asset Management stays in Phase 4; hostels stay with FWM.
- **Who holds the pen.** Head office Corporate Admin records each company's filings. The company secretary also monitors them. Each company views its own and supplies the papers.
- **Owner.** The Deputy Chief of Staff owns Corporate Admin. The Chief of Staff also has authority to monitor it.
- **Heads of Company** are the company managers.
- **Director Office** = Chairman, Vice Chairman, CEO, COO, Finance Director, ACT Director, Asset Director and Operations Director. The Director Office Administrator monitors government tenders, sets every Director Office meeting (including those in a company) and prepares its agenda, collects minutes group-wide (including toolbox meetings every 2 weeks per department and company), and collects and marks every report due to the Director Office.
- **Pilot companies:** Sasa, Arrow Shield and Inas first. CEO instruction tracker: yes. Permata Management supplies SSM profiles and registers. Counsel has reviewed the Government Procurement Act points. The Director Office itself lists every report and meeting date in the app (Fauzan, 2 Nov 2026), so the report list is no longer an open question. Each report and meeting can be set as recurring or one time (Fauzan, 2 Nov 2026). The audit firm panel is also keyed in by staff later (Fauzan, 2 Nov 2026); today it is four mock names in the COR-SECRETARY rule, so 5D turns it into a list staff keep in the app. Today reports are weekly or monthly only and meetings do not repeat; 5E adds one-time items and more intervals (for example every 2 weeks for toolbox meetings, quarterly, yearly).
- **Every approval carries a reason** (decided 31 Oct 2026).

## Slice 5A part 1: built on branch `claude/project-thread-7o2o85` (draft PR)

| Area | Before | Now |
| --- | --- | --- |
| Recording SSM filing steps (prepared, lodged with MBRS reference, SSM receipt) | Company manager and admin executives | Deputy Chief of Staff (head office Corporate Admin) only; the company, the Chief of Staff, the company secretary and leaders view |
| Asking PWVSB to approve a corporate change | Company manager | Company manager (unchanged) |
| PWVSB approval of a corporate change | Chief of Staff or Deputy, reason needed only to reject | Deputy Chief of Staff only, a reason always needed, never the person who raised it; the Chief of Staff monitors (Fauzan, 2 Nov 2026) |
| Recording the board resolution | Company manager | Company manager or the Deputy Chief of Staff |
| Mandate verification by PWVSB legal | Note optional | A reason is required |
| Office requests and operation claims (CoS, then COO) | Approve with no note | A reason is required to approve |
| Company secretary | No sign-in | New mock user `u-cosec` (Permata Management, `corpSecretary: true`), monitor grants, sees the Company secretary screen view only, never legal matters |
| Overdue filing to-dos | On the company manager's home | On the Deputy Chief of Staff's home; others see the overdue count |
| Sign-in | IT pilot only | `CENTRAL_ADMIN_ROLLOUT=true` (off by default) also admits the Chief of Staff, the Deputy, the Director Office Administrator and the company secretary |

Code: `packages/core/src/central-admin.ts` (`isCorpAdminOwner`, `isCompanySecretary`, `inCentralAdminRollout`, `approvalReason`); `corpRoleOf` and the corporate, mandate and expense flows in `packages/core/src/service.ts`; `apps/api/src/auth.ts` (`pilotAdmits`); `GOV-AUTHORITY` matrix lines in `packages/core/src/rules.ts`.
Tests: `packages/core/test/central-admin-5a.test.ts` (6), `apps/api/test/central-admin-rollout.test.ts` (2), updated corporate, mandate and expense tests in `packages/core/test/core.test.ts`.

**Data note.** No schema change and no migration. New fields live in JSONB (`corpSecretary` on the user). Staging holds no corporate records.

**Overlap with HR draft PR #51.** That PR adds its own `pilotAdmits` with `HR_ROLLOUT`. Whichever merges second combines both switches in one `pilotAdmits`.

## Slice 5A part 2: database walls (same branch, 2 Nov 2026)

The six Central Admin tables already sat behind the company wall. Central departments that hold company grants for other work (HR, FWM, Arms, CMS, Transport) could therefore read them through a screen mistake. Each table now also gets a **restrictive** department wall (it narrows the company wall, never widens it). The walls live in `db/modules/central-admin-walls-v1.sql`, **outside** the base schema, so the reviewed IT pilot base (`db/release-manifest.json`) does not change:

| Wall | Tables | Who passes it (`packages/core/src/access.ts`) |
| --- | --- | --- |
| `corporate` | `corp_profiles`, `corp_filings`, `corp_changes`, `corp_audits` | The company's manager and admin executives, group leaders (CEO, COO, FD, CoS, DCoS, Chairman, VC, ACT head), the company secretary, PWVSB legal, ACT |
| `legal` | `legal_matters` | The same, except the company secretary (need-to-know) |
| `mandates` | `gov_mandates` | PWVSB legal, group leaders, the company manager |

The service still decides who may change what. **Memos have no wall:** every staff member reads memos, and the service already limits publishing to the Chief of Staff (all staff) and the COO (all guards and officers).

**Not installed anywhere and not yet in the release manifest.** Before the Central Admin rollout, the release owner packages it as a pinned module (with its catalog check), and an authorized owner installs it. Until then the API sends the new walls and the database simply ignores them. Nothing has been run on staging.
Tests: `apps/api/test/staff-security.test.ts` (2 new, in a throwaway local database: no wall or any other wall shows nothing, the corporate wall does not open legal matters, no visible company shows nothing even with every wall, the company secretary sees filings but not legal matters or mandates, HR and FWM see none); `packages/core/test/staff-security.test.ts` wall list updated.

## Slice 5A part 3: company record form (same branch, 2 Nov 2026)

- The **Head of Company** (company manager) opens its own company's record ("Company record" on the company overview) and saves it **as a draft**: registered name, SSM number, dates, addresses, state and the SSM source document reference. It cannot mark it checked, and cannot open another company's record.
- The **Deputy Chief of Staff** (head office Corporate Admin) checks the draft against the SSM source and marks it checked. Nobody checks their own work: if the Deputy saved the draft, someone else checks it.
- The **CEO** keeps master-data onboarding as before, with Arisha preparing company drafts for him (unchanged; drafts from Arisha are never marked checked).
- Admin executives, the Chief of Staff (monitors), the company secretary, the Finance Director, COO, ACT and system feeds do not keep the record.
- The draft saver is kept on the record (`draftById`, `draftBy`, JSONB, no schema change). Code: `recordCan` and the `company` save in `packages/core/src/service.ts`; tests in `packages/core/test/central-admin-5a.test.ts` (2 new).

## 5C renewals and compliance calendar: scope added by Fauzan (2 Nov 2026)

Fauzan: "License renewal, majlis license renewal. All vendor renewal, iso renewal and compliance". The 5C calendar covers every renewal a company holds, not only KDN, MOF, insurance and SSM. **Owners confirmed (Fauzan, 2 Nov 2026): each company renews its own items; Central Admin (the Deputy CoS) monitors them all.** ACT may still audit. Lead times stay as proposed unless Fauzan changes them.

| Renewal | Examples | Case opens before expiry (proposed) | Who renews (proposed) | Who monitors |
| --- | --- | --- | --- | --- |
| Security licence | KDN private agency licence, branch supplementary licence, CSG quota for renewal | 120 days | Company admin team | Deputy CoS, COO |
| Local council (majlis) licence | Business premise licence, signboard licence, per branch office | 60 days | Company admin team (per branch) | Deputy CoS |
| Vendor registrations | MOF (ePerolehan), state and agency vendor lists, client vendor panels (for example GLC and oil and gas panels) | 90 days (MOF from 3 months before, per its rule) | Company admin team | Deputy CoS; DOA sees it for tenders |
| ISO certification | ISO 9001, 14001, 45001: yearly surveillance audit and the 3-year recertification | 120 days before each audit | Company admin team with the certifying body | ACT (compliance) |
| Other compliance | HRD Corp, SOCSO and EPF employer registration, fire certificate (Bomba) for offices, OSH items | 60 to 90 days | Company admin team or the owning department | ACT (compliance) |
| Insurance and SSM | As before | 90 and 60 days | As before | Deputy CoS |

How it works: each renewal is one record with an expiry date and its paper checklist. The app opens the renewal case by itself at the lead time, reminds the owner, and steps up (Deputy CoS, then CoS, then CEO) if it is late. A renewal closes only when the new certificate or receipt is attached. An expired item shows red on the company file, and UNKNOWN (no expiry date entered) is never green. Arms permits stay with Arms Control (Phase 4).

### How a renewal is settled (proposed, 2 Nov 2026; Fauzan: "Create also workflow on settling it. Whats needed.")

1. Case opens by itself at the lead time, with its paper checklist and the owner named.
2. Owner gathers and uploads the papers; the app ticks the checklist and flags expired papers.
3. Company manager checks and signs the application (the preparer does not sign it off).
4. Fee paid through Finance: a payment request with the agency's bill, approved under Finance's normal rules with a reason. The only approval step, because money moves.
5. Owner submits and records the submission reference and date.
6. Follow-up (inspection, audit, query): case waits "with agency", reminder every 7 days.
7. Close: new certificate or receipt attached, new expiry entered; the Deputy CoS (ACT for ISO and compliance) confirms the date matches; next renewal scheduled by itself.

Refused or more asked: back to step 2 with the reason. Expiry passes first: red on the company file, escalation Deputy CoS, CoS, CEO.

Starting paper checklists (the agency's current form decides; the owner updates the checklist when it changes):

| Renewal | Papers usually needed |
| --- | --- |
| KDN security licence | Renewal application in the KDN system; current licence; SSM profile; directors and shareholders list; latest audited accounts; guard list with CSG training status; office premises proof; insurance; fee |
| Majlis premise and signboard licence | Council form or portal; current licence; SSM profile; tenancy agreement or title; latest assessment tax receipt; Bomba certificate where asked; signboard photo and size; fee |
| MOF (ePerolehan) | Online renewal from 3 months before expiry; SSM documents; audited accounts or bank statements; employee EPF and SOCSO statements; office photos and tenancy; current certificate; fees |
| Client and agency vendor panels | Client's form; SSM profile; audited accounts; KDN, MOF and ISO certificates; insurance; bank confirmation letter |
| ISO surveillance or recertification | Internal audit report; management review minutes; corrective actions closed; audit booked; nonconformities closed by the body's deadline; new certificate or continuation letter |
| Bomba fire certificate and OSH | Fire equipment service records; inspection booked; floor plan where asked; fee; OSH records asked for |

The app never lodges or pays by itself.

## Work the app can do for staff automatically (proposed, 2 Nov 2026)

Fauzan asked to automate Central Admin work to make staff life easier, and to keep controls only where the job really needs them. The rule for all of these: **the app prepares, reminds and counts; a person still decides, approves and signs.** Nothing below approves, lodges or files anything by itself.

| # | Who it helps | What the app does by itself | Slice |
| --- | --- | --- | --- |
| 1 | Deputy CoS (Corporate Admin) | Opens each company's annual return, financial statements and beneficial ownership filings with due dates worked out from the company file (incorporation date, financial year end) | 5B/5C |
| 2 | Deputy CoS, company managers | Opens every renewal case at its lead time (KDN, majlis, vendor registrations, ISO, insurance, SSM and other compliance; see 5C above) with the paper checklist already filled | 5C |
| 3 | Everyone with a deadline | Reminders and step-up escalation on its own (Deputy CoS, then CoS, then CEO), so nobody chases by phone | 5C |
| 4 | Company managers | When a corporate change is approved, the board resolution task and the 14-day SSM filing open by themselves (already built) | 5A |
| 5 | DOA | Toolbox meetings for every department and company scheduled every 2 weeks on their own, with the attendance list from the roster | 5E |
| 6 | DOA | Each meeting agenda drafted from the last meeting's open actions, reports due and decisions pending; the DOA edits and sends | 5E |
| 7 | DOA | Reports due to the Director Office marked received, late or missing on their own as they arrive; one tap to chase | 5E |
| 8 | DOA, directors | A short summary drafted from uploaded minutes, with actions and owners pulled out into the tracker (a person checks before it is shared) | 5E |
| 9 | CEO | CEO instructions become tracked tasks with owners and dates; overdue ones reach the CEO's home without anyone reporting them | 5E |
| 10 | CEO, Director Office | A weekly Director Office digest: meetings this week, reports missing, filings overdue, instructions overdue | 5E |
| 11 | Company managers, CoS | Monthly rent and utilities office requests pre-filled from last month; the manager checks the amount and sends | 5F |
| 12 | CoS | Memo read reminders to staff who have not opened a memo after 3 days, and a read count for the CoS | 5F |
| 13 | PWVSB legal | Mandate and management agreement renewal cases opened 90 days before expiry | 5D |
| 14 | DOA, tender team | The tender checklist read from the tender notice (arahan petender) as a draft; the preparer ticks it | 5E |

To keep trust with staff, the app does **not** add new approval steps for routine admin (meeting notes, toolbox minutes, filing papers). Checks stay where the job needs them: money, corporate changes, mandates and anything signed for a company. Every approval keeps a reason, and nobody approves their own work.

## 5B to 5G built (same branch, 2 Nov 2026)

Fauzan, 2 Nov 2026: "Build all that not build yet ... Key in once and all department get the data needed ... automate what can be automated." Built on `claude/project-thread-7o2o85` at `5063d38`, synthetic data only. Not merged, not migrated, not deployed.

| Slice | What is built | Who does what | Checks |
| --- | --- | --- | --- |
| 5B company file | Directors, shareholders, beneficial owners, constitution and key papers on the existing per-company `corp_profiles` record (no new table). The SSM number and addresses stay in the company record and are shown, not keyed again. Screen: Company secretary, tab Company files. | Head of Company (or Central Admin) saves a draft; the Deputy Chief of Staff checks it against the SSM extract, giving the extract reference. | Never checks own draft; a confirmation needs a reason; differences go back to the company. Flags a beneficial owner not notified to SSM within 14 days (Companies Act 2016 s.60A in rule COR-SECRETARY) and a file older than a structure change the board recorded. |
| 5C renewals | Built earlier (`7d1b9b0`), see above. | | |
| 5D panel firms | Audit, law and secretary firms keyed in by staff; yearly review; a firm taken off keeps its record and reason. Audits are checked against this list; law firm fees this year and open matters come from the legal matters already recorded. Lawyers on matters who are not on the panel are listed with one tap to add. Mandates now show for renewal 90 days before they end (was 60). | Central Admin keeps audit and secretary firms; PWVSB legal keeps law firms; the company secretary views. | New table in the PROPOSED module `db/modules/central-admin-panel-v1.sql` (corporate or legal wall). Until an authorized owner installs it, the API reads the starting list in rule COR-SECRETARY and refuses to add firms. |
| 5E Director Office | Reports can be weekly, every 2 weeks, monthly, quarterly, yearly or one time. Meetings can repeat (weekly to yearly, 1 to 26 meetings); toolbox talks default to every 2 weeks; the next meeting in a series shows the last one's open actions. CEO instructions are tracked tasks (`workTasks`, source `ceo`) in the owner's own Work list. Weekly digest put together from what is keyed in. Screen: Director Office (digest and CEO instructions) and Meetings. | The CEO gives instructions, or the Director Office records them for the CEO; the owner finishes with proof; the CEO accepts or returns with a reason. | Only the CEO or Director Office gives one; the digest is for the CEO, Director Office and group leaders. Under PostgreSQL the Director Office records instructions only for staff within its company grants (company wall on `work_tasks`). |
| 5F CoS office | Rent and utilities: "from last month" starts a draft from the last approved request. Memo read reminders on the reader's home 3 days after publishing until read. | Company manager checks the amount, attaches the bill and sends; the CoS then COO approve as before. | Nothing is sent on its own; the bill is still required. |
| 5G PWVSB credit | Checked against V8 and V10. Added: the loan agreement is stamped within 30 days of signing (Stamp Act 1949 s.47A), flagged from day 20; a collateral kind with no agreement reference is flagged. | The credit officer records the stamp certificate. | Enforcement steps stay off until counsel approves the template. Not built: a check that PWVSB's own KPKT moneylending licence is in date, because no one has keyed it in yet. |

Still a sample: the tender checklist reader (automation 14) needs an approved AI service; it stays the sample reader.

Audit action names added: `corp.file.save`, `corp.file.checked`, `corp.file.mismatch`, `panel.add`, `panel.review`, `panel.remove`, `ceo.instruction`, `credit.stamped`, plus the meeting series summary on `meeting.schedule`.

Tests at `5063d38`: core 713 passed (43 files, new `central-admin-5b/5d/5e/5f/5g` tests); API 684 passed against a throwaway local PostgreSQL 16 database (includes the panel module installed in that database only); web typecheck clean; demo build passed. No browser test was run.

## Review fixes (Arisha main's review of bb87acc, 2 Nov 2026)

Draft only. Not merged, migrated, installed or deployed.

| Finding | Fix | Tests |
| --- | --- | --- |
| An impossible date could become an immutable "OK" record | `isRealDate` (packages/core/src/time.ts) in the record form, renewals (submit, new expiry), company file, panel firms, credit (start, charge, stamping, lodgement), filings, board resolutions and one-time reports; the API date helper uses it too | core `central-admin-review.test.ts` (31 Feb, 29 Feb 2027, 31 Apr; renewal stays on its old expiry) |
| Missing collateral had no correction path | `creditCorrectCollateral`: credit officer only, active loans, reason of 5+ characters, "Nothing changed" refused, money terms untouched; old and new values on the loan and audit `credit.collateral.correct`; `POST credit/loans/:id/collateral`; "Correct collateral record" on the loan with the corrections list | core review test; browser UAT |
| Return, edit and resubmit not shown | Company file keeps earlier checks in `file.history`; the screen shows "Sent back by", "Fix and resubmit", "Resubmit for the SSM check" and "Earlier checks"; audit says "corrected and resubmitted" | core review test; browser UAT |
| Legal flags on staff screens | `directorLegalFlags` (group leaders only, `GET director/legal-flags`, Director Office > Legal flags): beneficial owner not notified, agreement not stamped, charge not lodged, KDN licence past expiry. Each has source, affected records, responsible director (credit and KDN owners marked assumed), status "open" and audit history; never labelled compliant. Staff keep the task without statute text | core review and 5C tests; browser UAT |
| W15 hard stop was a legal-only block | Fauzan 2 Nov 14:59Z: no legal-only blocks for staff. A contract is recorded; the expired licence and contracts recorded since go to the directors' legal flag. Decision card sent to confirm | core 5C test |
| Modules outside the manifest | `db/proposed/central-admin-modules.json`: pinned sha256 for base and both modules, `central_admin_panel` requires `central_admin_walls`, rollback notes. Read-only catalogue checks in `apps/api/src/central-admin-readiness.ts`, not wired into the release gate. `db/release-manifest.json` unchanged | API `central-admin-packaging.test.ts` (hashes, order, no destructive SQL, before/after install, repeat-safe, app role cannot DELETE or TRUNCATE, drift detected) |
| Guide cards (section A) | `packages/core/src/central-admin-guide.ts`, version `central-admin-guide 2026-11-02.2`: BM first with English, role-scoped, shown on Company files, Panel firms, Renewals, PWVSB credit, Director Office and Work; Arisha gets the same cards for the open screen | core `central-admin-guide.test.ts` checks every quoted label exists in the screens or service |

Browser UAT: `scripts/central-admin-browser-uat.mjs` on the synthetic demo build (no API, database or external call), desktop and phone: enter, denial, return, correct and resubmit, rejection without a reason, confirm, collateral correction with a double click (one correction), director-only legal flags, and the BM guide. Not PostgreSQL browser UAT and not staff UAT.

Open: the PWVSB KPKT licence record and the sample tender reader stay open gates, with no staff block. The Moneylenders Act rate cap stays as a validation on recording a loan; whether it counts as a legal-only block is for the directors.

## Review round 2 (Arisha main's re-check of 11f6867, 2 Nov 2026 16:16Z)

Draft only. Not merged, migrated, installed or deployed.

| Finding | Fix | Tests |
| --- | --- | --- |
| Stamped records had no audited correction | `creditCorrectRecord` (`POST credit/loans/:id/correct`): the credit officer corrects a recorded stamp (or takes it off when it was recorded in error), an SSM charge lodgement (both reference and date, or neither; never before creation) or the signing date. Reason of 5+ characters, "Nothing changed" refused, money terms untouched, old and new values on the loan, audit `credit.stamp.correct`, `credit.charge.correct` or `credit.signed.correct`. Screen: "Correct stamping, charge or signing date"; the list is now "Record corrections" | core `central-admin-review.test.ts` (round 2); browser UAT (stamp corrected with a reason, short reason cannot save; company manager has no button) |
| Signing date and start date were the same thing | `CreditLoan.signedOn` (optional): the day the agreement was signed. `startOn` stays the day the schedule runs from. No order between them is enforced. The 30-day stamping clock runs from `signedOn` when recorded; otherwise from `startOn`, and the row (`stampFrom: 'start'`) and the directors' flag say "signing date not recorded" | core review test (signed after start allowed, signed before start allowed, future or impossible signing date refused) |
| Module JSON not in the real release gate | Both modules are now in `db/release-manifest.json` (after the five IT modules; `central_admin_panel` requires `central_admin_walls`), `MODULE_SPECS`, `RELEASE_MODULE_IDS`, `scripts/release-artifact.mjs` and `scripts/staging-release-gate.mjs`. The catalogue gate runs `centralAdminWallsProblems` and `centralAdminPanelProblems` as the restricted runtime role (panel also needs the walls). The selected-module installer knows them by policy and table markers. The walls SQL now has one outer `BEGIN;`/`COMMIT;` as the installer requires. The PUBLIC-grant check reads the ACL because the runtime role cannot see PUBLIC grants in information_schema. `db/proposed/central-admin-modules.json` keeps order and rollback notes; a test proves its hashes equal the manifest | API `release-catalog`, `release-artifact`, `release-install-rls` (real PostgreSQL 16: all seven modules install and the restricted runtime reports ready only after the last), `module-install`, `central-admin-packaging`; `scripts/release-packaging`, `release-workflow-contract` |

Effect of the gate change: once merged, the API starts and the staging deploy gate passes only when both Central Admin modules are installed on the target database, as for the five IT modules. The named operator bundle in `ops/existing-admin` is pinned to the earlier five-module release and cannot install the Central Admin modules; the release owner has to regenerate it. Base stays `4b4cf4d3…`; re-pin after HR #51 changes the base.

## Masterplan items built (Fauzan 3 Nov 2026: "Yes build all not build")

Draft only. Not merged, migrated, installed or deployed. Ledger rows from `/mnt/project-files/reviews/masterplan-subsection-ledger-2026-11-03.md`.

| § | What | Who | Rules | Tests |
| --- | --- | --- | --- | --- |
| 103 | KPKT licence verification for PWVSB loans: `creditCheckLenderLicence` (`POST credit/loans/:id/licence`) records the licence number, valid-to date and how it was checked (counsel's confirmation) on each loan, with `validOnLoanDate` worked out against the signing date (or start date) | Deputy Chief of Staff | Not a staff block (Fauzan 2 Nov 14:59Z): the credit officer records loans as before. A loan with no check, or with a licence that ended before the loan date, goes only to the directors' legal flags (`LENDER_LICENCE_NOT_CHECKED`, `LENDER_LICENCE_NOT_VALID`). Rechecks are audited (`credit.licence.recheck`). The last licence is offered again | core `central-admin-masterplan.test.ts`; guide permission test; browser UAT |
| 126 | Adviser budgets and invoices on each panel firm: `adviserMoneyStep` (`POST corporate/panel/:id/money/:action`) with `budget`, `agree`, `invoice`, `check`, `resubmit` | Keeper of the list proposes and records; the Finance Director agrees budgets; the Finance Director or the Deputy checks invoices (never the person who keyed it) | Reasons on every agreement and check. Law firm fees stay keyed once on the legal matter, so law invoices are refused here. Queried invoices are corrected and sent again with history. "Passed to Finance" is a record; Prima never pays. Home items: budgets to agree, invoices to check, over budget | core test; browser UAT (propose, agree) |
| 243 | Emergency delegation and succession register: `delegationBoard`, `addDelegation`, `delegationStep` (`GET delegations`, `POST delegations/:companyId`, `POST delegations/item/:id/:action`); Company secretary > Delegations | CEO or Chief of Staff for group posts (under `pwvsb`); company manager for the company's posts; the CEO or Chief of Staff approves | Never the recorder or the person who acts approves. Emergency and leave cover need an end date. Lines are ended with a reason, never deleted. A register only: it gives nobody access or approval rights in Prima. New module `central_admin_delegations` (`db/modules/central-admin-delegations-v1.sql`): company wall plus a RESTRICTIVE mandates-or-named-delegate wall; writes need the mandates wall; no DELETE | core test; API `central-admin-packaging` (real PostgreSQL: delegate reads own line, others none, writes refused without the wall, no delete, drift detected); release tests (8 modules); browser UAT (record, approve) |

Release manifest now has eight modules (five IT, three Central Admin). Guide version `central-admin-guide 2026-11-03.1` adds three cards (`kpkt-check`, `adviser-money`, `delegations`).

Open: PWVSB's KPKT licence record itself is still not keyed in (staff enter it through the check). The delegate's own home notice only shows on group-leader homes today. Adviser invoices are not linked to SQL Account.

## Review round 3 (Arisha main's review of 6fffc33, 3 Nov 2026 00:50Z)

| Finding | Fix | Test |
|---|---|---|
| KPKT validity was saved at check time; correcting the signing date did not re-test it (licence to 30 Sep, signed 28 Sep corrected to 20 Oct still showed "checked", no directors' flag) | `licenceState` is worked out from the loan date as it stands now (`signedOn ?? startOn`) against the recorded `validTo`; a signing-date correction also refreshes the saved `validOnLoanDate` and the audit line says when the result changes; the directors' flag names the loan date; the screen reads the live state | `central-admin-masterplan.test.ts` "re-tests a recorded licence when the signing date is corrected" (the exact repro, clear and restore, no staff notice) |

Still directors' view only; no staff block. Start dates cannot be edited after a loan is recorded, so the signing-date correction is the only date that moves the loan date.

### Release-gate facts for the combined candidate (no /mnt access needed)

- Release manifest: 8 modules including `central_admin_walls`, `central_admin_panel`, `central_admin_delegations`; release sha `ef24943cb6ccf63d78cab1f4dcf215d51121bbd23f1f5d1366f018851076cff7`; base still `4b4cf4d3…` (re-pin after HR #51 merges). Unchanged by round 3.
- `db/modules/central-admin-delegations-v1.sql` sha starts `b57a8747583be5f5`.
- API start needs all three Central Admin modules installed after merge; the `ops/existing-admin` operator bundle is still 5-module and must be regenerated by the release owner.
- Nothing merged, installed, migrated or deployed.

## Review round 5 (Arisha main's masterplan gaps, 3 Nov 2026 03:32Z) and §125 legal hold (Fauzan "proceed work", 03:59Z)

| Finding | Built | Test |
|---|---|---|
| §243 no critical-role inventory | `CriticalRole` in `prima.critical_roles` (same module as delegations, mandates wall): post, holder, why critical, successors with readiness, yearly review, retire. A post with no approved succession line and no successor ready now shows to the CEO/COO/CoS as "no cover". A delegation line can name the critical post (post and holder copied, keyed once) | core "critical-role inventory"; API "critical posts" RLS |
| §243 single approval | Built as two different leaders; changed by Fauzan 3 Nov 2026 to one leader (CEO, COO or Chief of Staff) with a reason, never the recorder or the person who acts | core first two §243 tests; UAT CoS approves |
| §243 no competency/board evidence | Before approval: competency evidence as a reference to an HR training or appraisal record or a document (HR rows stay behind the HR wall; agreed with the HR thread) and, for succession, the board resolution reference and date | core §243 tests; UAT "Record evidence" |
| §243 no time-limited authorised access | After approval the keeper asks IT for access through an ACCOUNT help request (systems, end date at most 90 days and never past the line's end). Prima grants nothing and no account changes; the screen shows the request's state. Ending, revoking or a passed access end date asks IT to remove it (automatic request on end/revoke; home task when the date passes) | core "time-limited access", "access end date passes" |
| §243 no revocation | Revoke: a leader, never the person who acts, with a reason; marked revoked; raises the removal request | core "time-limited access" |
| §243 no case transfer | The keeper hands chosen open work tasks of the holder to the person who acts, and hands back what is still open after the line ends (home reminder) | core "hands chosen open work" |
| §126 no independent service acceptance | Each audit/secretary invoice is confirmed with evidence by whoever received the service (the billed company's manager; for PWVSB the CoS or Deputy), never the keyer; the checker is neither the keyer nor the acceptor; a corrected invoice is accepted again (the earlier acceptance stays in history) | core §126 tests; UAT |
| §126 no SQL AP link to the right entity | After it is passed to Finance, the Finance Director records the SQL Account payables document number and posting date; refused unless it is in the billed entity's books (company, or PWVSB), not before the invoice, and unique per entity. Prima posts and pays nothing | core "service acceptance … billed company's books"; UAT |
| §125 legal hold not enforced on files | New module `central_admin_legal_holds`: `prima.legal_holds` (company wall to read; legal wall to add or release) and append-only `prima.legal_hold_versions` (legal wall reads). Trigger `prima.lh_preserve` (runs as the caller) on evidence documents and photos, cases, contracts, company files, HR files and insurance claims keeps the earlier content before every change and refuses deletes while a hold stands. PWVSB legal or the Deputy places and releases holds with a reason (kept on the matter); group leaders see the list; staff are not blocked or told | API "legal hold" (trigger, RLS, append only, delete refused); core "§125 legal hold"; UAT |

Release-gate facts after round 5:

- Release manifest: 9 modules; `central_admin_delegations` sha `1b5b2cd56433765ec05b1a095071dd987db9bdb528dc02a440b05b90878d8b61`, `central_admin_legal_holds` sha `77a6e2efccc07ef426919fbf240c15cfdba880f700dbcb936bf0567ad2c49dc2`; release sha `b642c6107b103492bab17c88b8ca3ef271889c0bc26b4d037ae9b4b7253c3e71`. Base still `4b4cf4d3…` (re-pin after HR #51 merges).
- API start needs all four Central Admin modules installed after merge; the `ops/existing-admin` operator bundle is still 5-module and must be regenerated by the release owner.
- Not done: no provider access is granted or checked (IT changes the provider by hand); no live SQL Account read of the AP entry; legal-hold versions are kept by the database only (the demo store mirrors it); IT assets have no company column, so they are not holdable yet.
- Nothing merged, installed, migrated or deployed.

## Review round 5b (Arisha main's reproductions on 4f06e24, 3 Nov 2026 05:24Z)

| Finding | Fix | Proof |
| --- | --- | --- |
| (1) A first approval survived replaced competency or board evidence | Recording evidence on a line that has approvals clears them (audit says so). Since Fauzan's decision below one approval puts the line in force, after which evidence cannot be changed at all | core "evidence is fixed once a leader approves" |
| (2) Two concurrent AP links could take the same reference for one billed entity | The firm row is locked before it is read; the link takes a transaction advisory lock on the billed entity (`central-admin:ap:<entity>`) before the uniqueness scan; references compare without case, spaces, dots, slashes, dashes or underscores | API "two Finance Directors linking the same SQL Account reference at once" (two PostgreSQL connections, the second waits, then is refused); core normalised duplicates |
| (3) CEO records a succession to the CoS: only the COO can approve | Settled by Fauzan (3 Nov 2026 05:57Z, decision card: "One leader approval is enough"): one leader for ordinary delegations; then at 06:32Z successions go to the Chairman (alone, or consenting after the CEO), so the Chairman approves this case. The board marks a line no other leader can approve (`approversShort`, e.g. a leader's account closed) | core "one leader approves"; core "group posts sit under PWVSB" |
| (4) A review could keep or mark a closed account as ready and clear "no cover" | Closed accounts are refused as successors (add and review, including a review that keeps the list); a closed delegate cannot be approved, given access or handed work; coverage on the board and the leaders' home ignores closed successors and closed delegates; the board names successors who left and says to end a closed delegate's line | core "a closed account is never ready cover…" |
| Legal-hold readiness checked names only | `centralAdminLegalHoldsProblems` now compares the `prima.lh_preserve` body (sha256, whitespace collapsed, pinned against the module file by a test), language, return type, arguments and `search_path` (`LEGAL_HOLD_TRIGGER_FUNCTION_CHANGED`), and each trigger's type is exactly BEFORE + ROW + UPDATE + DELETE, unconditional, enabled and bound to `prima.lh_preserve` (`LEGAL_HOLD_TRIGGER_EVENTS`) | API "notices a legal-hold function body or trigger event that was changed" |

Fauzan 3 Nov 2026 05:57Z: one leader approval is enough; access stays at most 90 days. Fauzan 3 Nov 2026 06:32Z: "1. One leader is enough. 2. Successions only chairman approve or ceo approve with chairman consent". Built: an ordinary delegation needs one of the CEO, COO or CoS; a succession is put in force only by the Chairman, alone or consenting after the CEO's approval (approvals carry `as`: `ceo`, `chairman`, `chairman_consent`); the COO and CoS never approve a succession; the recorder and the successor never approve, so a CEO-recorded succession goes to the Chairman. The Chairman's home lists successions to approve. Proof: core "succession: only the Chairman approves…". Module SQL is unchanged, so the manifest and release sha above still stand. The `ops/existing-admin` operator bundle is still the pinned 5-module snapshot (it verifies intact); regenerating it for the 9-module release is a release-owner step, since it is the bundle used against the live admin database.

## Not in 5A part 1 (next)

- ~~5A part 2: database walls~~ done above (memos stay open to read).
- ~~5A part 3: company record form~~ done above.
- ~~5B to 5G~~ built above. Open: install the two proposed modules (walls, panel) as pinned modules after review; PWVSB KPKT licence record; real tender reader.
