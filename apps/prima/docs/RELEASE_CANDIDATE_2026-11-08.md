# Release candidate, 8 Nov 2026

Branch `rc/2026-11-candidate`, now on top of `main` at 30ac5a0e. This is a draft for review: nothing is merged into
main and nothing is deployed from it. Prepared by Fitri (NiagaLabs) with Claude, following Fauzan's release-candidate
order.

**Update, evening of 8 Nov:** Fauzan merged #131 to #138 into main himself. Those merges include #137 (guard support
and arrival cash) and #138 (RBA: ethics declaration once, committee of at most 6). The candidate now has that main
merged in. Against main, this branch adds only the following:
- the QR item labels (`item_register_v2`, module 7) with its screens;
- the uniform deduction switch;
- the CEO P1 Monitor line and guards off the IT screens;
- "not switched on" answers for proposed modules that are not installed;
- the guard pay holiday-list pointer;
- the label scan-back step in #133's uniform test;
- these two documents.

Section 1 is the inventory as it stood before that merge, kept for the record.

## In short

- **Included:** the open PRs that bring code main does not have, which are #134, #136, #131, #135 (with #132), and
  #133 folded in. All of these are now in main. Two small pieces were missing from main and are carried over: the
  CEO P1 Monitor line (#63) and guards off the IT screens (#73).
- **Added:** the QR item labels and register part two (`item_register_v2`), with its phone-first screens.
- **Uniform and item deductions** from guard pay are a switch, left off until management and legal decide.
  #135's bans on fines, deposits and leaving charges are kept.
- **Release:** the release is seven pinned modules: the frozen five, `item_register` and `item_register_v2`. All
  other modules stay proposals.
- **Five owner decisions are left undecided in code** (section 4).
- **Tests and the upgrade path were run** (sections 5 and 6). The upgrade is set out in
  [RELEASE_CANDIDATE_UPGRADE_AND_RECOVERY.md](RELEASE_CANDIDATE_UPGRADE_AND_RECOVERY.md).

## 1. How the open PRs were sorted

Every PR head not already in main (86 of 132) was trial-merged with `git merge-tree`, and its added lines were checked
against main by code, not by title:
- whitespace, quote style and comments were ignored;
- lines were searched across the whole of main, because #130 reformatted and moved code;
- whatever was left was read by hand.

Lines a PR deletes that main still has, and lines carrying an owner decision ("Fauzan", "DECIDED"), were checked
separately.

### Included (merged in this order)

| PR | What it brings | Fixes needed when combined |
|---|---|---|
| #134 | The site gate test checks the whole IC number. Adds the gated `ops/combined-upgrade` stage 2 package. | The stage 2 "release ready" assertion follows the new module list |
| #136 | Mail and Power BI browser journey. PIKM Part 1 clauses. Screening checklists and intervals approved 8 Nov. | The `.mjs` conflict takes #131's version |
| #131 | HR discipline appeals (14 days) and policy languages: a Malay copy is required, and mother tongue is recorded (8 Nov decisions). | None |
| #135 (with #132) | Client codes, and report choice by OD or OGM. RBA readiness with the values approved 8 Nov. Whistleblowing follow-up. Guard pay refuses fine, deposit and leaving deductions. | Union of `demo.ts` and `http.ts`. The client-codes proposal's `after` list gains `item_register`. |

### Folded in rather than merged

| PR | Why |
|---|---|
| #133 | It activates `item_register` as module 6, which collides with the QR item work. The candidate wires `item_register` and `item_register_v2` once. It keeps #133's uniform PostgreSQL test, now with labels printed and scanned back, and its "release held until installed" rule. It drops #133's `deploy-exact-spa.yml` edit, because that template is pinned to the five-module release. |

### Carried over (missing from main)

| From | Item |
|---|---|
| #63 | The CEO home "P1 cases" Monitor line. `p1Watch` was built but never shown once #130 merged `lowMargin`, so open P1 cases still with operations appeared nowhere on the CEO home. Fixed, with a core test. |
| #73 | Guards no longer see `it-metrics` and `hr-it-intake` (staff usability rule 3, 4 Nov). Main's notes say this was done, but the code still listed `guard`. |

### Already in main or superseded (can be closed)

Already incorporated: #9, #27, #41, #45–#49, #52, #53, #55–#58, #60–#62, #64, #65, #67–#71, #74–#76, #78, #80, #81,
#83–#90, #92–#94, #97–#107, #109–#118, #121–#123, #127, #128.

Superseded on purpose (already recorded in main's integration notes):

| PR | Superseded by |
|---|---|
| #37 | The connections rework |
| #39 | Job email v2 |
| #43 | The websites rebuild |
| #49 | Daily cash v2 and the month-effective statutory settings |
| #54, #79 | `management-fees.ts` |
| #63 (whole) | Main's note: must not be merged wholesale |
| #82 | The newer BQ |
| #91 | The W4 automatic check |
| #119 | `ja-switch.ts` |

### Deferred

| PR | Why |
|---|---|
| #8 | The phase-1 hosting plan; the hosting decision went another way |
| #42 | Only the proposed Azure daily-job runbook text is left |

## 2. Added on top

| Commit | What |
|---|---|
| 107b9805, fae5407c | **QR item labels and register part two.** The module (`db/modules/item-register-v2.sql`), scan checks, the item passport, label runs on A4 and label printers with QR and Code 128, scan-back, the site board, counts with recount and review, reports, and the export-only Finance board for SQL Account. One scanner: full-screen camera, keyboard scanners, and typed IDs that need a reason and proof. The release manifest, catalogue checks and installer know the module (7 modules). |
| ed8ad269, 11c91254 | **Uniform deduction switch.** Rule PAY-GUARD `uniformDeduction: 'awaiting_decision'`. Uniform, lost and damaged item deductions are refused with a plain message, matched on whole words. Equipment is never charged. #135's guard-pay test is kept, with the switch tests next to it. |
| 416d91a3 | **Proposed modules answer in words.** Before tender opportunities, recruitment cost, EPF/SOCSO recharge, site survey and staff directory are installed, their screens say "not switched on in this database yet" instead of a server error. Running these screens against a copy of a live database without those modules showed the server error on Director Office, Tenders and quotes, Recruitment cost and Nepali EPF/SOCSO. Also, the guard pay holiday note now points to Site man-hours, Public holidays; it said Pay formulas. |
| cdaa5ffe | **#133's uniform PostgreSQL test** prints and scans back each label before the check, as paper 3.1 requires. |

## 3. What did not change

Pay formulas, guard pay, FW recruitment, the Central Admin modules and every other module stay proposals in
`db/proposed`, each with its `after` list. No permission, approval step or money rule was widened.

## 4. Decisions for you (left undecided in code)

1. **Sign-in key cache: 72 hours or 24?**
   - #63 records "72 hours DECIDED (Fauzan, 4 Nov 03:07Z)".
   - Main keeps 24 hours, and its integration note says the 72-hour offline instruction is not approval for a 72-hour
     key cache.
   - `WHOLE_ORG_REVIEW.md:431` still says 72.
   - The candidate keeps 24.
2. **Social media inactivity: flag at 90 days?**
   - #43 records Q10 (1 Nov): flag at 90 days, and the company manager decides at 180.
   - Main has only the 180-day flag, while `docs/WEBSITE_CONNECTORS.md` says 90.
   - The code is unchanged.
3. **JA import approver.** #119 allowed the ACT Lead or Deputy. Main allows the Lead only, because the ACT role model
   has no deputy, so nobody can approve while the Lead is away.
4. **RBA committee read wall.** #135's `committee_read` policy is `USING (true)`, so every signed-in Prima session can
   read committee names and seats in every company. Confirm this is intended.
5. **Uniform and item deductions:** off until management and legal decide (section 2).

## 5. Things worth a look (not changed)

- **Whistleblowing replies can lose an update.** `whistleReply` (service.ts around line 22307) reads the report outside
  the transaction and writes a patch built from that read. Two replies at the same moment (reporter and handler, or
  two reporter tabs) can overwrite each other's message. `whistleMessage` reads the report the same way.
- **W12 cannot be added by hand.** `POST contracts/:id/items` accepts W1 to W11. W12 (CMS activation, expansion
  rounds) is a system-checked item, so this is probably intended. Confirm.
- **Four core tests fail on this branch on 8 Nov:** assist-invoice (malformed gateway answers), "an armed site and
  a vault on any date", management fees (FD or CEO moves a fee) and ops-guide cards. None of them touches code this
  branch changed. In the office copy's full runs they were 5-second timeouts under load. They were not re-run on main
  itself. IT corrections and public holidays failed in one earlier partial run but passed in the full run.
- **Five script tests fail on Windows only, both here and on main:** the Vite cache and manual boundary tests, and
  two release-workflow-contract tests. CI on Linux is the judge.

## 6. Tests run on this branch

| Suite | Result |
|---|---|
| Core (vitest) | 2,241 of 2,245 before the main merge; 2,286 of 2,290 after it. The same 4 fail; they are listed in section 5. |
| API (node:test on PostgreSQL, incl. RLS tests) | 1,150 of 1,151 pass, 1 skipped, before the main merge. Two module-count tests that still expected 6 modules were updated for 7. After the merge, the affected suites (release, packaging, guard pay, cash, arrival, RBA, items, quality, client codes) pass 102 of 102. |
| `ops/combined-upgrade` cli and base-transition (no database) | 81/81 |
| Stage 2 upgrade on a fresh disposable PostgreSQL 16 (`combined-upgrade.pg.test.cjs`) | 6/6 |
| Stage 1 base transition on fresh PostgreSQL 16 (`base-transition.pg`, `cli.pg`) | 11/11, 7/7 |
| Item uniform and item register repair on fresh PostgreSQL 16 | pass, pass |
| Main to candidate upgrade with the seven modules (`run-combined-upgrade-pg.sh`, Linux) | 2/2 (restricted owner and existing admin): data and boundaries preserved. On Windows, run it in a Linux container with the workspace links recreated. |
| Web type check and build (`VITE_API_URL` set; the zxing reader wasm is emitted) | pass |
| `apps/web/test/item-labels-scan.cjs` | pass |

## 7. The Agentic Office copy (for information)

The same code runs inside the Agentic Office at agent.oriondesk.space, synced to this candidate on 8 Nov 2026. The
office differs from this branch in four ways:
- **More modules.** It activates 19 modules (these 7, then the 12 its database already had) and, with the owner's
  approval of 8 Nov, the 13 newer proposals. Each was rehearsed on a restored copy of the live database first. No
  existing row changed.
- **Its own sign-in and layout.** It keeps the office sign-in, its kit layout and its owner rights (maker-checker:
  the owner raises, someone else approves).
- **Arisha runs on the office AI.** She also has a plain-language guide to all 80 screens.
- **Contract import from a spreadsheet.** An imported contract is saved without the signed copy. Its "signed contract
  filed" item stays open until the copy is attached with proof.
