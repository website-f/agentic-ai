# HR PR #51: review bundle input (for the combined bundle due Thu 5 Nov 2026, morning MYT)

Draft PR only. Nothing is merged, migrated, installed or deployed, and no tenant grant or provider is changed. Synthetic
data only.

## Exact source
- Branch: `claude/project-thread-andehu`.
- Head: see the PR. This file was written at `e555c37`, after main `0ead549` was merged in (`63d09bc`, a clean merge that only adds `.github/workflows/deploy-exact-spa.yml`).
- Reviewed by Arisha main at `e29f49d`. The fixes since then are listed below.
- Base schema `db/migrations/001_init.sql`:
  - sha256 `18db58b12c9593f540b9ca715b591cce4c8313ba346cc1e5328e37a03363e340`, pinned in `db/release-manifest.json`.
  - The job posts PR stacked on this branch (5 Nov 2026) adds `prima.applicants` with its `applicant_wall` policy and repins the base to `6d454ec23a4352c27037856f884c3baf8715fe097a92e29ef780794fcf4ab983`.
  - Main's base is `4b4cf4d3…78fe`.
  - HR's earlier bases `8d1…`, `beb38cec…`, `59e65bff…` and `69a3035a…` are replaced by this one (3 Nov: `prima.staff_movements` with its two receiving-company policies, then `prima.allowance_types`, then the `movement_wall` policy and `prima.login_handovers`).
- The other department branches keep main's base (`4b4…`) and ship add-on files under `db/modules/`. HR is the only branch that changes the base file.
- The HR change to `001_init.sql` is additive: 95 lines added and 1 line changed.
  - The changed line is the company-wall table list, extended with the new HR tables.
  - No table, policy or grant from main is removed or weakened.
- Operator packages under `ops/` are not touched. A transition from main's reviewed base to this base needs its own review and rehearsal.

## Finding → fix → test

| Finding (Arisha main, 2 Nov) | Fix | Test |
|---|---|---|
| A JA guard row with an office staff member's company + staff number turned that person into a guard | `43cd733`: refused with nothing written; every check runs before the first write; each guard gets its own savepoint on PostgreSQL; database refusals are reported in plain words; guard account rows carry the guard mark | core `hr-3g-3d.test.ts` (office collision, hidden non-guard row, wrong company); PostgreSQL `staff-security.test.ts` (office collision, hidden HR row and a good guard in one delivery; wrong-company inserts refused by `guard_feed`) |
| Verify on PostgreSQL/RLS: permissions, collisions, wrong company, masking | Same commit, plus earlier `ddfa046` | PostgreSQL: the `guard_feed` wall sees and writes guard rows only, for granted companies only; `fw_ids` reads foreign passports only and never accounts or writes; no full IC or account on the JA or person record |
| Privacy, retention and biometric discrepancies go in the directors' view, not on staff screens; the removed consent screen is not restored automatically | `ef33d50`: five points in `hr-legal.ts`, each with sources, live affected records, a responsible director, a status (unresolved, being checked, resolved by a director; never "compliant") and history; audited; `hr_legal` wall on `prima.hr_legal_checks` | core (who sees, note rules, director check, history, audit); PostgreSQL wall test; browser (CEO sees, HR Admin does not) |
| A guide card on each staff and manager task (section A) | `6ef92a3`, corrected in `e144ff2`; moved to the shared card format of #56 in `packages/core/src/hr-guide-cards.ts` (who, where, fields, desk to ask, entered once, save/review/returned/done/recover, not verified). `allowed` calls the same rules the service uses (`hrKeeps`, `staffClockUser`, `vcConsents`, `guardPaperKeeper` in `hr.ts`) | core `hr-guide-cards.test.ts` (BM+English, desks only, real Office staff fields, role scope matches the server, a system feed gets none); browser shows the cards on the HR screen and the staff Clock screen |
| Browser evidence of enter → return → correct → resubmit | The run found that a refused request hid HR's reason and could not be corrected. `e144ff2`: the reason is shown and "Correct and send again" opens a new request with the same details. `e555c37`: phone layout | `scripts/hr-leave-browser-uat.cjs`: 38/38 at 1400px and 390px (now with the sick-leave correction); screenshots in `/mnt/project-files/hr-review/` |

## Arisha main review at `5a1eeb8` (3 Nov 2026)

| Finding | Fix | Test |
|---|---|---|
| The staff payroll guide card showed to an ordinary Finance officer whom `staffPayRun` refuses | The card's `allowed` is now `staffPayStepper` in `hr.ts`, built on `staffPayRole`, the same function the service's payroll uses. A Finance officer outside Finance's paying team gets no card, and a company manager (view only) gets none | core `hr-guide-cards.test.ts`: an ordinary Finance officer gets no card and `staffPayRun` refuses them; a paying-team member and HR get it |
| "Correct and send again" on a medical leave did not reuse the clinic, illness, MC number or MC file | The form fills the clinic, illness and MC number. `requestLeave` takes `correctsId` and reuses the refused request's MC documents. The server checks it is the staff member's own request, that it was refused, and that it has not been corrected before. The duplicate-MC check still applies, and the refused request stays on record unchanged | core: a pending request cannot be corrected, another person's refused request is not found, the files, clinic, illness and MC number carry over, and a second correction is refused. Browser: steps 8a to 8d at 1400px and 390px |

## Arisha main review at `84e78eb` (3 Nov 2026, 03:32Z)

| Finding | Fix | Test |
|---|---|---|
| The API's leave route dropped `correctsId`, so reusing MC evidence did not work over HTTP | `POST /api/leave` now checks `correctsId` (a string of up to 100 characters, empty means none) and passes it to `requestLeave` | `apps/api/test/hr-leave-correct-controller.test.ts`: the id is forwarded; missing or empty becomes null; a number or an overlong value is refused |
| Two corrections sent at the same moment could both pass "corrected once" and share one MC | The checks for "corrected once" and "one MC used once" now run in the same transaction as the insert, under a PostgreSQL transaction lock on the refused request and on the MC (`PgStore.lock`, keys `leave-correct:` and `leave-mc:`). Leave ids also gain a random part, so two requests in the same second never collide | `apps/api/test/hr-leave-correct-pg.test.ts` on PostgreSQL 16: 4 simultaneous corrections give exactly 1 correction, 1 live use of the MC and the same MC files; 3 simultaneous new requests with one MC give 1. With the lock removed, the correction test fails (2 corrections), so it does catch the race |
| Demo-mode limit (Arisha, 04:19Z) | Not changed: the in-browser demo `MemoryStore` has no lock, so two corrections sent at the same instant in demo mode can both pass. Only the PostgreSQL store is safe under concurrency. The demo is a synthetic preview and is not evidence of concurrency safety | PostgreSQL test above; no demo concurrency claim |
| Masterplan §243 delegation and succession | Owned by Central Admin #52 (agreed 3 Nov). HR gives read references only: StaffTraining, StaffAppraisal and guard papers behind the HR wall | Not in this PR |

## Staff movement (Fauzan, 3 Nov 2026, new since `65fb2ad`)

Promotion, transfer to another group company and secondment, as described in `docs/HR_PHASE3.md`. New table
`prima.staff_movements` in the base loop, plus `movement_receiving_read` (select) and `movement_receiving_accept`
(update, using and check) on `toCompanyId`. Nothing on the staff record changes before the last approval.

| Check | Test |
|---|---|
| Step order, comment needed, no self-approval, no preparer or moved person approving, nobody twice | core `hr-movement.test.ts` |
| Promotion writes a verified pay change carrying the HR Director check and the VC consent | core `hr-movement.test.ts` |
| Transfer: new record at the new company, fresh hire date, group start kept, IC and account copied, old record ends as transferred | core `hr-movement.test.ts`; PostgreSQL `hr-movement-pg.test.ts` |
| Receiving head sees and accepts under RLS; another company's head sees nothing; the CEO stands in for the HR Director in the pilot | PostgreSQL `hr-movement-pg.test.ts` |
| Company head reaches movements and vacancy signing from Company today (they cannot open the HR screen) | Web typecheck and demo build; no browser run yet |

## Arisha main retest at `beea18d` (4 Nov 2026, 02:54Z): older history applied out of date order

Can such records exist? Allowance changes (`kind: 'ALLOWANCE'`) do not exist on main, and from 9c3bc42 on they are kept in date order, so there is no older allowance data. Basic pay changes on main (`payEffectiveOn` on the staff record form) take any start date, so a basic pay change dated earlier could have been applied after a later-dated one. Nothing was assumed about live data.

| Finding | Fix | Test |
|---|---|---|
| A change dated October but applied after a November one: rebuilding November fell back to the record | A payroll preflight (`payHistoryDisorder`, part of the submit blockers): where a person's verified basic pay or allowance changes were applied out of date order and the record disagrees with the last change in force by date, the month cannot be submitted. It names the person, the record figure and the figure by date, and HR keys a correcting change. Prima never picks either figure silently. History applied in date order never triggers it | core: a 1 Nov change decided before a 15 Oct change that wrote the record (RM4000 against RM5000 by date) blocks November and its submission; after a correcting change dated today it clears; changes in date order do not block |

## Arisha main retest at `a07f0e8` (4 Nov 2026, 02:04Z): fixed-only caps, backdating order, the submit/consent race

| Finding | Fix | Test |
|---|---|---|
| A fixed RM250 with the cap lowered to RM200 and no one-off did not block | HR cannot lower a cap below any active staff member's fixed amount of that type, or below a change waiting for approval or its date; HR lowers those through an approved change first. The draft check now covers fixed-only lines too | core: lowering to 200 refused with the person named; lowering to 250 allowed and no block; a cap below a fixed amount from older data blocks a fixed-only line and its submission |
| Backdated changes applied out of order gave values that did not match their dates | Backdating is limited: an allowance change cannot start before the first day of last month (the earliest month payroll prepares; **DECIDED** by Fauzan, 4 Nov 2026 03:16Z) or before a change already approved for that person, so changes apply in date order. Payroll history is rebuilt by effective date, not by approval or apply order: the value at a month end is the last change starting on or before it, and before the first change it is what that change replaced | core: a start before 1 Oct refused; a start before an approved 2 Nov change refused, the same date allowed; with a December change decided before a 20 November change, October shows none and November shows the 20 November amount |
| Submission and consent guards were outside a shared lock | Both take the same row lock on the payroll month (`SELECT … FOR UPDATE` through `PgStore.lock`) and recheck under it. A submission rereads the run, confirms it is still a draft and reruns every blocker on the transaction; the consent and apply-due paths lock every month from the start month on and reread their stages | PostgreSQL: a submission and a same-month consent run concurrently; whichever wins, the invariant holds (submitted first: the change waits and the record is unchanged; consented first: the submission is refused as stale and the record has the new amount). Run 4 times locally, passing each time |

## Arisha main review at `d6c8765` (4 Nov 2026, 01:28Z): late consent, last month's pay, dates, lowered caps

| Finding | Fix | Test |
|---|---|---|
| A consent after the start date applied straight away, past the submitted-payroll guard | The late path uses the same check as the deferred path (`allowancePayrollProblem`): if a payroll month from the start month on is already submitted, the change is consented but waits (`applied: null`) with the reason in its note, and HR's apply-due step applies it once that month is back with HR | core: a 1 Nov change consented while November is submitted waits with "already submitted", is refused by apply-due, and applies after the month is returned. PostgreSQL: the same consent leaves `applied` null and the record unchanged |
| Last month's payroll used today's allowances | Payroll takes each person as their pay stood in that month (`peopleForPeriod`): a consented allowance or basic pay change that starts after the month end is rolled back to what it replaced, in prepare, in a line edit and in the freshness check | core: after a 1 Nov allowance change and a 3 Nov promotion, October prepared today keeps the old basic and allowances and is not marked stale; November takes the new ones |
| Impossible dates | Allowance and movement dates must be real calendar dates (`2026-02-30`, `2026-11-31`, `2026-13-01` refused); an allowance cannot start before the person joined; a secondment's last day must be real and not before its start | core (allowance and movement); PostgreSQL (`<month>-32` refused) |
| A cap lowered after a draft was made | Submission is refused while a line's one-offs plus any fixed amount of that type exceed the current cap. Recalculating keeps HR's amount and stays blocked; HR lowers the one-off | core: cap 300 to 200 after a 250 one-off blocks submit and survives a recalculation; 250 refused at entry; 200 submits |

The hosted browser artifacts are synthetic demo runs, not staff UAT. The HRD treatment of one-offs still needs subject-matter confirmation.

## Arisha main retest at `714248e` (3 Nov 2026, 10:13–10:15Z): allowance defects, CI browser evidence, one-off freshness

| Finding | Fix | Test |
|---|---|---|
| A future-dated allowance was written to the record at consent | The change is consented and waits (`applied: null`). HR's "apply changes due today" step applies it on or after its date, under a lock, only while the record still holds what it was keyed against, and never into a payroll month already submitted (it stays waiting with the reason). A month's submission is refused while a consented change effective by its end is not applied. No new change is keyed while one waits | core `hr-allowances.test.ts` (record unchanged after consent, a second request refused, nothing due before the date, staff refused the apply step, applied once on the day with an audit entry, refused into a submitted December); PostgreSQL `hr-allowances-pg.test.ts` (consented for 2099 stays `applied: null`, record unchanged, not applied by apply-due, a second request refused) |
| Duplicate one-offs could pass the type cap | The cap is per month: all one-offs of the type on the line plus any fixed amount of that type | core: 200 + 200 against a cap of 300 refused; 150 + 150 accepted |
| An HRD-ticked one-off was left out of the HRD basis | The HRD basis is basic + fixed allowances + one-offs ticked for HRD. An HRD-off one-off and an unlisted one stay out. Subject-matter confirmation against HRD Corp's wage definition is still open | core: the HRD levy rises for an HRD-ticked one-off and not for an HRD-off or unlisted one |
| One-off type changes slipped past freshness | Each one-off keeps the ticks it was entered with. Submission is refused while any one-off's ticks differ from its type on the list; the draft keeps what it showed until HR recalculates, and the recalculation takes the new ticks. Submitted months are never rewritten | core: one regression each for EPF, SOCSO, PCB and HRD (refused after the tick change, unchanged until recalculated, takes the new tick after, no blocker left); a type change after submission leaves the submitted lines byte-identical |
| The browser UAT was local evidence only | Hosted CI job `synthetic-browser` now serves the demo build and runs `scripts/hr-login-handover-browser-uat.cjs` and `scripts/hr-leave-browser-uat.cjs` with its pinned Playwright, failing the job on any failed step. The logs and screenshots are kept as the `hr-browser-results` artifact on the run (14 days) | The same CI step was run locally: 18/18 and 38/38 |

## Arisha main retest at `84b056e` (3 Nov 2026, 09:02Z): IT exposure, the handover screen, stale drafts

| Finding | Fix | Test |
|---|---|---|
| An IT colleague read the full movement row (pay, private reason) to do the login move | IT no longer reads movements at all. The service refuses `staffMovements` without the new `staff_movements` wall (HR, the HR Director, the CEO, the VC, company heads), and the database adds a RESTRICTIVE `movement_wall` on `prima.staff_movements`. The login move is a separate minimal record, `prima.login_handovers`, behind its own `login_handover` wall: who, which accounts, from which company to which, from when, and its status. No pay, no reasons | core `hr-movement.test.ts` (IT refused movements; the handover JSON has no pay figure, no reason, no `basicPay`/`reason`/`steps` keys; a non-IT, non-HR user is refused handovers); core wall tests; PostgreSQL `hr-transfer-payroll-pg.test.ts` (IT refused by the service; the IT view has no reason or pay; an IT session counts 0 rows in `prima.staff_movements` under RLS) |
| Completion checked only `personId` | Confirmation now checks every account three ways, from its role, companies and grants that day: it points to the new record, it reaches the new company, and it no longer reaches the old company. Nobody confirms their own move; a second confirmation is refused | core: refused while only `personId` moved, accepted after the role and companies moved; own move refused; audit shows authorise then confirm. PostgreSQL: the same, with the grants removed and the account moved to the new company's office role by synthetic SQL |
| The login task sent IT to the HR screen, which errors for IT | A "Login handovers after a transfer" panel on the IT page; the HR panel keeps only the HR Director's authorise step. Home items send IT to the IT page | Browser `scripts/hr-login-handover-browser-uat.cjs`, 18/18 at 1400px and 390px: HR prepares a transfer (Merdeka to Inas) with pay RM9876 and a private reason; the Inas head and the CEO approve and it applies; the CoS authorises; **IT Executive 1**, signed in from the ordinary persona button, sees the handover on the IT page with company, account and date, no pay or reason anywhere on the page, no movement panel and no HR menu; Prima refuses the confirmation while the account still points to the old record. Screenshots in `/mnt/project-files/hr-review/` |
| A stale draft passed after a promotion changed basic pay | Each payroll line keeps a fingerprint of its inputs (basic pay, allowances with their ticks, paid days, approved unpaid leave, nationality, date of birth, Lindung opt-out). Submission is refused while any line no longer matches the record | core: a draft made before a promotion is refused, a retry without recalculating is refused again, a recalculation shows the new pay; an allowance consent after that makes it stale again; after recalculating it submits |

The demo build replays a browser's saved actions after a reload; movement ids have a random part, so later actions
lost their target. The replay now carries each made id forward (`apps/web/src/api/demo.ts`). Demo only.

Also fixed: the movement list called a Merdeka (IT team) employer "PWVSB (central)"; it now uses the same central
employer name as the handover.

## Arisha main retest at `598218f` (3 Nov 2026, 08:05Z): the transfer month and the login

| Finding | Fix | Test |
|---|---|---|
| The old employer's month dropped a mid-month leaver; the new employer paid a full basic with only a warning | A month includes everyone employed on any day of it (`paidInPeriod`). Part-month lines show their dates and need HR's figure for the days worked (`partPay`: basic, fixed allowances, how it was worked out). There is no proration rule, and Fauzan was asked to pick one. Submission is refused until every part-month line has its figure | PostgreSQL `hr-transfer-payroll-pg.test.ts`: mid-month transfer gives the old employer a line to the day before and the new employer a line from the date; both submissions are refused until HR enters the figure, then go through |
| A delayed apply leaves the old state after the date | Submitting is refused while a movement into or out of the employer, taking effect by the month end, is waiting or approved but not applied. It is also refused when staff, or the days they are paid for, changed since the month was calculated | PostgreSQL: submit refused while the transfer is due and unapplied; after the late apply, refused as stale; after recalculating, the part month shows and it submits |
| Pay omitted or paid twice when payroll is already submitted | A movement is not applied while a month from its effective month is submitted at either employer. The movement stays approved with the reason (also at the last approval) | PostgreSQL: a second transfer due after the month was submitted fails in apply-due with "already submitted", stays approved, and creates no new record |
| The login stays on the old person | Applying a transfer records the accounts to move. The HR Director or CEO authorises the move: not the preparer, not the applier, not the person moved. IT confirms after the approved account process, and Prima refuses the confirmation unless every account now points to the new record. Self-service leave on the ended record is refused with a plain reason | PostgreSQL: confirm refused before authorisation; the CEO who applied it cannot authorise; a synthetic CoS authorises; confirm refused while the account still points to the old record; old-login leave refused; confirm accepted after the synthetic account change |
| No proration policy invented | None. HR enters each part-month figure until Fauzan chooses | — |

## Arisha main review at `4fac9d8` (3 Nov 2026, 06:39Z): movements took effect at approval

| Finding | Fix | Test |
|---|---|---|
| The last approval applied a future promotion's title and pay at once, and a future transfer created an active employment at the new company while the old one stayed active | The last approval now only agrees the movement (status `approved`). It applies in the same unit only if its date has come. Otherwise HR or the CEO applies it on or after the date (`POST /api/hr/movements/apply-due` or `/:id/apply`; Home shows what is due). No timer runs yet | core `hr-movement.test.ts`; PostgreSQL `hr-movement-pg.test.ts` "future transfer" (nothing changes before the date; applying early is refused) and "current promotion" (applies at the last approval with a verified pay change) |
| Safe scheduling and retries | Each apply locks the movement and the person, re-checks everything, and is idempotent: a movement already applied is returned as it is, and new ids are made from the movement id (`pr-<movement>`, `pay-<movement>`). `apply-due` applies each movement in its own unit and records a failure on that movement (`applyError`), which stays approved for a retry | PostgreSQL: three applies at once give one new employment, and a fourth returns the same result; a staff number clash fails, is recorded, leaves both records unchanged, and applies on the retry once cleared |
| No overlap between the old and new employment | The new employment starts on the effective date. The old one ends the day before and is closed as left in the same unit, which only runs on or after the date | PostgreSQL: after applying, old `left` with last day = date − 1, new `active` from the date |
| Corrected movements | HR can cancel an approved movement before it applies and prepare a corrected one; a second waiting or approved movement for the same person is refused; a cancelled movement never applies | core and PostgreSQL "corrected" cases |
| Do not apply the new schema before review | Nothing applied; this change needs no new table (the status and error live in the movement's data) | — |

## Allowances (Fauzan, 3 Nov 2026, new since `4fac9d8`)

HR's allowance list and per-staff monthly allowances, as described in `docs/HR_PHASE3.md`. New group-wide table
`prima.allowance_types`; a staff allowance change is a `pay_changes` row of kind `ALLOWANCE`.

| Check | Test |
|---|---|
| Only HR keeps the list; a basis and a reason for changes are needed; the cap is enforced; old ticks are kept in the audit | core `hr-allowances.test.ts` |
| A staff member's allowances change only after the HR Director verifies and the VC consents; order, no self-verify, comment needed | core `hr-allowances.test.ts` |
| An allowance change does not block basic pay or a promotion; a stale change is refused at consent | core `hr-allowances.test.ts` |
| Unticked allowances leave EPF, SOCSO, PCB and HRD; one-offs come from the list and keep their ticks | core `hr-allowances.test.ts` |
| HR writes on PostgreSQL; the person moved cannot verify; consent before the HR Director check is refused; record unchanged | PostgreSQL `hr-allowances-pg.test.ts` |
| HR screen panel and the one-off picker in the payroll month | Web typecheck and demo build; no browser run yet |

## Test results (local, isolated; never staging)
- **Core:** 779/779 on Vitest 3.2.7, which is the version installed in this container.
  - `package.json` declares 4.1.12, but a separate 4.1.12 install failed here because of an npm error.
  - Arisha main ran 739/739 on 4.1.12 at `e29f49d`. Please rerun on 4.1.12 at the head.
- **API on local PostgreSQL 16.15:** 705/705.
  - Run alone: two suites run at once against the same database interfere with each other.
- **Web:** the typecheck is clean and the demo build is clean.
- **Browser (demo build):** leave journey 38/38 and login handover 18/18, per the tables above; both also run in hosted CI (`synthetic-browser`, artifact `hr-browser-results`). It is synthetic, with no backend, and blocked web-font requests were the only outside calls.
  - The CEO stands in for the Vice Chairman, because the pilot persona list has no CoS or VC.
  - A sign-in in the demo is not a Microsoft or M365 acceptance.

## Installation boundary (nothing authorized)
- **Base migration:** the new HR tables are listed in `CLAUDE.md` and the PR body. The run is CEO-only (`run-db-migration.sh`), after its own transition review.
- **Rollout:** `PRIMA_ROLLOUTS=hr` (or the older `HR_ROLLOUT=true`) admits the CoS, DCoS and VC. It is off by default.
- **JA guard feed:** the JA system sign-in and its company grants are created by the CEO when JA is ready (`docs/JA_GUARD_FEED.md`).

## Remaining inputs and open items
- **Overtime claims inside the payroll run:** wait for Finance PR #49.
- **Papers recorded in Prima flowing back to JA:** wait for the live JA link.
- **Arisha AI and the guide cards:** the HR cards are in #56's shape but not registered yet, because `guide-cards.ts` is only on #56. After #56 merges, one line (`registerGuideCards(HR_GUIDE_CARDS)`) puts them in GET /api/org/guide for Arisha and the record drawers.
- **Decided (Fauzan, 4 Nov 2026 03:16Z):** an allowance change can start from the first day of last month at the earliest.
- **Payroll subject-matter checks:** the HRD basis for one-offs and the allowance ticks need HR/HRD Corp confirmation before payroll is called finished.
- **Browser runs:** only the leave journey and the login handover have browser runs. The other HR journeys are covered by service and database tests only.
- **Vacancy signer for PWVSB central posts:** the HR Director, as an assumption. The CEO's decision is pending.
- **Merges:** expected overlaps with Special Ops / Central Admin (`access.ts` wall list), Sasa Team (`Ja.tsx`, JA service) and Finance #49 (payroll). Each can be resolved in merge order.
- **HR KPI:** on hold until pilot test 1.
