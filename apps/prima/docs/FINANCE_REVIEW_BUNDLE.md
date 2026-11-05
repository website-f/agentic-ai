# Finance Phase 2: combined review bundle for Arisha main

Draft PR #49, branch `claude/project-thread-gmzh82`. **Not merged, not deployed, no migration run.** This file is the in-repo copy of the review bundle (updated 3 Nov 2026), so it can be read from the branch. Screenshots and UAT scripts are kept outside the repository; their results are summarised in section 7.

## 1. Exact commits

| Role | SHA |
|---|---|
| Merge base with `main` (head is 0 commits behind) | `0ead549c0f08f2feb2d75a6896f5c209452bd654` |
| Reviewed by Arisha main (21 answers applied) | `a602127795ad346ad91bac2fc6de3e09420b2af7` |
| Review fixes (UI gaps, custody, statutory tables) | `f738ee7b0c9f06c99d148c595d7f20ddd5c6b5e2` |
| Guide cards (section A) | `06aa7f307bc1d53ef95fde83a7f5cbf55763e5ab` |
| PR #56 savepoint fix and Finance cards in the shared card shape | `5f2ec552f344351450cb6c2fcf653ea70db22efb` |
| Merge of `main` 0ead549 | `3f717333d9774056b05635dcb3a2c6c55f34b786` |
| Docs fix, coverage rows 2 and 5 | `2b69001c4faa12a9f489c87c013576fce4228d02` |
| Statement checks FS-01 to FS-12, chart of accounts mapping, SQL Account connector interface (off); CI green (runs 41553603983, 41553596864) | `0ceb488085dbf6cdcf382c967a744708f19c833a` |
| Round 3 daily cash fixes and doc corrections | `5a2d723e0f03196346ff7b75aca2a0acafb2e04a` |
| Bundle file added (docs only); CI green (runs 41557505850, 41557496878) | `6d598779be287b9a8f50aca19c929e9fc9606a2f` |
| Payroll counted only after final approval (combined HR + Finance rehearsal); CI green (runs 41561637400, 41561631520) | `f9d6ff9c6f8c7d85a858e0806d7ff15821466841` |
| Bundle update (docs only); reviewed by Arisha main 3 Nov 03:22Z | `77cbab283f493908a39626eac3bfe7f7039ce464` |
| Round 4: split cash return per holder; CI green with bundle 3a51522 (run 41573254867) | `10f3670feae517722a984d9cb3f0c54f70123add` |
| Budget revisions and three-statement forecasts (items 76/78); CI green with bundle 982fdb1 (run 41577630735) | `3639b5bead4d7067c23140ef8583febfdb75bbd7` |
| Forecast opening cash tied to the reviewed SQL cash; CI green with bundle b743dff (run 41585935028) | `4564f337ff93660fe8bf51f7802a22f698ef8980` |
| Budget revisions: FD or CEO, either is enough (Fauzan 3 Nov 06:06Z) | `0e9118674b1b3a72d112cedb02bff3c8efcaee65` |
| Two-author deadlock: FD+CEO cannot both write one record; withdraw with reason; CI green with bundle 632635f (run 41598701483) | `c16f69b84ab40c3e66a51180c5f5d3ae71bdeb5a` |
| Guide card sources name their desk (combined round 4); CI green (run 41600616533) | `b04ce44c42c80f053c81ee409555644233d79fcc` |
| **Screen acts only on an open revision; browser regression; last code commit** | **`5216e9547a98a3d56493b4b9054701ea2660443d`** |
| This bundle update (docs only, on top of 5216e95) | the branch head |

## 2. Finding to fix to test matrix

| # | Finding on a602127 | Fix (commit, file) | Test or evidence |
|---|---|---|---|
| U1 | No reason input when the cash count differs | f738ee7, `FinanceDailyCash.tsx`: "Why the count differs" input; "Confirm count" is disabled until there is a reason of at least 5 characters; the settle label is "Reason for any difference" | UAT screenshot 6 |
| U2 | No Edit on returned payments | f738ee7, `FinanceDesk.tsx`: Edit button on returned rows, `EditReturned` form; `finance.ts` `finPaymentChanges` writes "Changed: ..." on the resubmitted step and keeps earlier documents | `finance-review-fixes.test.ts` (steps prepared, reviewed, returned, resubmitted; documents kept); UAT 1, 2, 3 |
| U3 | No Edit on returned payment requests | f738ee7, `PaymentRequests.tsx` "Correct and resubmit"; `finance-requests.ts` keeps documents, records changes, at most 10 documents | test (head_approved, returned, resubmitted); UAT 7, 8, 9 |
| U4 | Daily worker days could not be entered on screen | f738ee7, `PeopleEditor`: one row per person, a toggle for each day, Every day / None, paste a list; returned lists editable | UAT 4, 5 |
| N1 | Approval editors: unauthorised approver, self-approval, edits after approval | f738ee7 (rules already held; tests added) | `finance-review-fixes.test.ts`: unauthorised approvers refused; the FD's own payment goes to the CEO; no resubmit or second approval after approval |
| N2 | Cash custody separation | f738ee7, `finance-daily-cash.ts` `notApprover`: the approving FD never withdraws, hands over or counts; whoever withdrew or handed over does not count it back | `finance-review-fixes.test.ts` custody cases; UAT (FD refused the withdrawal) |
| N3 | Sample and fallback statutory tables treated as verified | f738ee7, `statutory-tables.ts` `statTableVerified` (only `checked`), `staffPayDirectorChecks` Unresolved list; `StatTables.tsx` "Built-in copy, not verified"; `StaffPay.tsx` "For directors to verify", shown only to CoS, VC, FD and CEO; payroll is not blocked (legal flags in the directors' view only, Fauzan 14:59Z) | `finance-review-fixes.test.ts` tables cases |
| A | Guide cards per staff and manager task, BM first, role-scoped, shared with Arisha, no invented fields or contacts, "recording is not a bank transfer" | 06aa7f3, `finance-guides.ts` (8 cards, version `2026-11-02.1`), `FinGuide.tsx` on 9 screens, `Arisha.tsx` gets the same cards | `finance-guides.test.ts`: bilingual and versioned; contacts are roles only; each entry card's example is accepted by the real service; scoping per role (CM, OGM, HR, guard); UAT 10, 11 |
| B1 | Found during UAT: daily cash bank account carried over from another company | f738ee7, `FinanceChecks.tsx` panels keyed by company | UAT 4 |
| B2 | Found during UAT: cash collectors shown without role | f738ee7, `finance-controls.ts` names "(CEO)" / "(COO)" | UAT 6 |
| B3 | Found during UAT: department heads and Finance checkers had no Payment requests menu | f738ee7, `finRequestInMenu`, `App.tsx` | `finance-review-fixes.test.ts` menu case; UAT 7 |
| R3-1 | Round 3: the FD could edit another preparer's daily cash list, have staff submit it, then approve it | 5a2d723, `finance-daily-cash.ts`: every edit is signed on the list (`edits`); anyone who edited it cannot approve it (returning stays allowed); no exception route is built (it would need separate authorisation) | `finance-review-fixes.test.ts` "Round 3": FD edits, second data entry submits, FD approve refused, CEO approve refused, FD return allowed |
| R3-2 | Round 3: a CEO who received no cash could record a worker payout from cash handed to and confirmed by only the COO | 5a2d723, `finDailyCashHeldBy`: held = counted handovers to that person less their own payouts; pay and give back need cash the person holds, up to that amount; uncounted cash is not held | same test: COO confirms, CEO pay refused ("hold none"), CEO give back refused, COO pays and gives back; `finance-daily-cash.test.ts` uncounted cash refused |
| X-1 | Combined HR #51 + Finance rehearsal: regular statutory/zakat payments counted a payroll at the CoS-only 'approved' stage, and missed HR's final 'coo_approved' | f9d6ff9, `finance-controls.ts` `finPayrollFinal`: only 'consented' (this base), 'coo_approved' (HR #51) or 'paid' count | `finance-staff-automation.test.ts`: CoS-approved only, nothing filled from payroll. Combined rehearsal on f9d6ff9 + HR 84e78eb: core 1167, API 841 (PostgreSQL), CMS 58 |
| R4-1 | Round 4: with cash split between the COO (RM50) and the CEO (RM50), neither could give back because the other still held cash | 10f3670, `finance-daily-cash.ts`: each holder gives back their own share on their own (`giveBacks`); after that they hold nothing and cannot pay; no handover to a holder who has given back; the list is returned for one settlement when every holder has given back (`giveBack` = the total). Holder, editor/approver and custodian/settler checks unchanged. `FinanceDailyCash.tsx` shows a note instead of the form to a holder who has given back | `finance-review-fixes.test.ts` "Round 4": COO pays one day and gives back RM0, list stays with collectors, COO refused a second give back and further pay, settle refused until the CEO gives back, CEO's RM100 give back needs a reason, CEO gives back RM50, COO/CEO/withdrawer/FD refused settle, deputy settles with no difference |
| M-78 | Masterplan gaps (Arisha main 3 Nov 03:32Z, ledger section 7a): three-statement forecasts and approved budget revisions not built | 3639b5b, `finance-plan3.ts`: revisions drafted by the team leader or deputy from an open month, versioned, approved by both the FD and the CEO (never an author), budget in force used for variances; three-statement forecasts linked (cash flow from profit and balance sheet movements, closing cash ties), scenarios and versions, FD or CEO approves, refused while the opening does not balance or disagrees with reviewed SQL figures. `FinancePlan3.tsx` on the Budget panel | `finance-plan3.test.ts` (4): drafters and approvers, closed month, no-change, reason, both approvals, return clears approval, budget in force; worked statements and tie-out, unbalanced opening, over-depreciation, over-repayment, shortfall, versions supersede, SQL agreement. Browser check (demo data, no page errors): deputy budget, FD approve, leader revision, FD then CEO approve, deputy forecast, FD approve |
| M-78a | Recheck at 982fdb1: the forecast opening totals were tied to reviewed SQL figures but the opening cash was not (RM60,000 entered against RM50,000 reviewed, RM10,000 offset in fixed assets; a RM55,000 outflow showed +RM5,000; submission and approval passed) | 4564f33, `finance-plan3.ts` `fin3Compute`: opening cash compared with the reviewed `cf.bsCash`, a problem at saving, sending and approval. Revision and forecast approval chains marked pending Fauzan's decision (docs and screen) | `finance-plan3.test.ts` "ties the opening cash": the reported case refused at sending; sent before the figures arrived, refused at approval; corrected opening shows -RM5,000 and a shortfall |
| D-1 | Approval chains pending Fauzan's decision | 0e91186: Fauzan, 3 Nov 2026 06:06Z, "Either is enough for both". A revision goes into force on one approval by the FD or the CEO (never its drafter or sender); the FD or CEO may draft. Forecasts unchanged (FD or CEO) | `finance-plan3.test.ts`: FD approval alone puts it in force; CEO cannot approve again; FD-drafted revision refused to the FD and approved by the CEO |
| D-2 | Arisha main 3 Nov 06:21Z: if the FD drafts a revision and the CEO edits it before sending, both are authors, neither can approve or return it, and there is no withdrawal, so it is stuck | c16f69b, `finance-plan3.ts` `finLeadAuthors`: once the FD (or CEO) has written or sent a revision, forecast or yearly budget, the other lead is refused when trying to change or send it, with guidance to return it after it is sent; so one lead always stays free to approve or return. Recovery: `withdrawRevision` / `fc3Withdraw` let an author or the sender withdraw a draft, sent or returned record with a reason (status 'withdrawn', never in force). No self-approval or override path added. Withdraw buttons in `FinancePlan3.tsx`. Budget limits (Fauzan via Arisha 07:31Z: "any budget need a limit") are an open decision; no limit amounts are invented | `finance-plan3.test.ts` "two-author deadlock": FD drafts, CEO edit and CEO send refused; withdraw needs a reason, outsider refused, author withdraws; same rule for forecasts and the yearly budget |
| D-3 | Arisha main 4 Nov (rendering the actual Plan3 at b04ce44): revision 1 withdrawn, revision 2 drafted; the screen still selected the withdrawn revision ("Change revision 1") and hid "Send revision 2". Also: budget limit amounts and the policy for setting them are undefined, so the controls must not be called complete | 5216e95, `finance-plan3.ts` `finOpenRevision` (draft, sent or returned only), used by the server and by `FinancePlan3.tsx`. `FINANCE_PHASE2.md` row 5 now says budget limits are not complete (open decision D-2, Finance gives amounts later, Fauzan 3 Nov 08:04Z) | `finance-plan3.test.ts` "the open revision"; new CI browser check `scripts/finance-plan3-browser-smoke.mjs` (demo build, real core rules, synthetic data, 1440px and 390px): budget approved, revision 1 drafted then withdrawn with a reason, revision 2 drafted shows "Change revision 2" and no "Change revision 1", "Send revision 2 for approval" sends it, FD approves, revision 1 stays withdrawn, no page errors, no outside requests (the font stylesheet is blocked). It fails on the old screen (checked locally). The phone menu is icons only, so navigation is at desktop width and the panel is used at 390px |
| R3-3 | Round 3 docs | 5a2d723, `docs/FINANCE_PHASE2.md`: the 13-week forecast, variance owners and forecast due dates are built (not missing); the statutory fallback stays an unresolved director item, never verified; still missing: live SQL Account (E62, no reader installed), payroll/claims/billing interfaces into SQL Account and the close, direct bank feeds, Microsoft Graph; A8 waits for Azure OpenAI | docs |

## 3. Toolchain and results at 5216e95 (local, synthetic data)

- Node `v22.23.4`, vitest `3.2.7`.
- Core: `npm run build -w @prima/core && (cd packages/core && npx vitest run)`: **881 passed (62 files)**.
- API: `cd apps/api && npm run build && DATABASE_URL=postgres://postgres@localhost:5433/prima_test DEV_TOKEN_SECRET=ci-only npm test`: **704 passed**, on a throwaway local PostgreSQL only, never staging.
- Web type check `npx tsc -p apps/web/tsconfig.json --noEmit` and `npm run build:demo -w @prima/web`: pass. Every `node --test` group of the CI `test` job also passes locally.
- These are local results. PostgreSQL results come from the local throwaway database; no browser run was repeated for round 3 (core-only change).

## 4. CI

- 0ceb488: **green**, runs [41553603983](https://github.com/fauzan4377/prima-secure-app/actions/runs/41553603983) and [41553596864](https://github.com/fauzan4377/prima-secure-app/actions/runs/41553596864), all 8 jobs.
- 6d59877: **green**, runs 41557505850 and 41557496878.
- 3a51522 (with 10f3670): **green**, runs 41573254867 and 41573246871.
- 982fdb1 (with 3639b5b): **green**, runs 41577630735 and 41577624376.
- b743dff (with 4564f33): **green**, runs 41585935028 and 41585929373.
- fd7b13c (with 0e91186): run 41588718836 had one failure, the synthetic-browser IT manual smoke (not touched by Finance; passes locally at 1440px/390px), treated as a flake.
- 632635f (with c16f69b): **green**, runs 41598701483 and 41598691904; the IT manual browser smoke passed (the 41588718836 failure was a flake).
- b04ce44: **green**, runs 41600616533 and 41600611247.
- Branch head after 5216e95: see the PR checks.
- f9d6ff9: **green**, runs [41561637400](https://github.com/fauzan4377/prima-secure-app/actions/runs/41561637400) and [41561631520](https://github.com/fauzan4377/prima-secure-app/actions/runs/41561631520), all 8 jobs.
- Earlier failures on f738ee7, 06aa7f3, 11c6376 and 3f71733 never reached a runner (GitHub Actions billing), fixed when the budget was raised.

## 5. Schema and module hashes at 5216e95

- `db/` is identical to `main` (`git diff origin/main -- db` is empty). sha256 of `cat db/migrations/*.sql`: `4b4cf4d3c67d0c5b09ca3c9592c74504a2c7335430dcffeccdd4f48710ed78fe`. **Finance adds no migration.**

| File | sha256 |
|---|---|
| `packages/core/src/finance-daily-cash.ts` | `bcaf2a59494bfaf2f9467b48b03981c2515f16ef8f2a074e859f458032de0262` |
| `packages/core/src/finance.ts` | `631fde71591aa13262562120a37359881c37f8272336b9867c3be2c79b4e39c7` |
| `packages/core/src/finance-controls.ts` | `2fce61d031fce583f6c4ea9ac2908fdc6341bfc1a8792a1feec6839138993776` |
| `packages/core/src/finance-plan3.ts` | `2ec5408eb2cf772ab5da76c69e988d6b0ad43b4d121d0a6e20a0259b0a961365` |
| `packages/core/src/finance-ledger.ts` | `dd8cc5a342d58cf0a2223dc29e26d7bd524740bfd9996ea4b9279dbed6f07e6e` |
| `packages/core/src/finance-requests.ts` | `9bc29c44d1468b0bd67bcfab83db4854aa21be451d85b110c18d065d2607813c` |
| `packages/core/src/finance-guides.ts` | `1cb0ac8bb0b82989ec97a813bda96b444aa61b132f5fff6926d417c427ee715f` |
| `packages/core/src/finance-guide-cards.ts` | `775ffacbe03bb2a66b643460e5d84d405ce023be82eb2ca73c805c4ff4827a6b` |
| `packages/core/src/statutory-tables.ts` | `7ec4ad1a1a5e7f2bb75dcb86743b065d39beee52cc2121fa037741448e45c084` |
| `apps/api/src/pg-store.ts` | `9aee683f81b27b65dc26317a15ff6a5a382d4b6fe05eb66de51e36f6ff7dbf73` |
| `packages/core/src/service.ts` | `5c84eeee180928a1de2f1318068d2836ccbd133ab46c6ba3f44757ad0e153424` |

## 6. Installation boundaries

- JSONB on the existing `prima.fin_status` rows only. No new tables, no migration.
- Off by default: `FINANCE_ROLLOUT`, `TEAMS_APPROVALS_READ`, the SQL Account connector (no reader installed, never switched on by the API), A8 Azure OpenAI (not provisioned).
- Prima never makes a bank transfer, never approves or pays by itself; no Microsoft 365 connection, no e-signature.
- Nothing deployed; no Azure, Key Vault, tenant or database change.

## 7. Browser UAT summary (synthetic demo data, earlier rounds)

All journeys finished with no page errors.

| Journey | Roles | Result |
|---|---|---|
| Payment | data entry, deputy, FD | prepared, returned with a reason, edited keeping documents, resubmitted with "Changed: ..." in the history |
| Daily cash | data entry, FD, second data entry, COO | days per person, FD return, edit, approve; FD refused the withdrawal; a count mismatch needs a reason |
| Payment request | company manager, OGM, Finance leader | created, returned, edited, back to head review; menu hidden for other staff |
| Guide cards | data entry, company manager | BM + English card on the form; HR and guards see none |
| Budget revision and three-statement forecast (3 Nov) | deputy, FD, team leader, CEO | budget drafted and approved; revision from December drafted by the leader, approved by the FD then the CEO; forecast prepared by the deputy and approved by the FD; the deputy sees no approve control |
| Statement checks, mapping, connector (3 Nov) | data entry, deputy, FD | figures recorded and reviewed by another person; the recorder has no review button; FD sees mapping gaps and returns; connector shown Off |

Not covered by browser UAT: Finance Settings, close, bank reconciliation and other Checks sections (unit and PostgreSQL tests), HR's view of statutory tables, and the round 3 daily cash changes (unit tests only).

## 8. Remaining inputs (nothing invented)

0a. **Approval chains decided** (Fauzan, 3 Nov 2026 06:06Z, "Either is enough for both"): budget revisions and three-statement forecasts are approved by the FD or the CEO.
0. **At the combined merge with HR #51** (agreed with the cross-department rehearsal): HR's test steps (CoS approve with a comment, then COO `coo_approve`) and the EPF/SOCSO file layout (Finance's employer-number header row, then Staff no, Name, IC / passport, EPF number or NOT RECORDED, then the rest).

1. **Official EPF and PERKESO tables**: built-in copies and the fallback are not verified; they stay on the directors' Unresolved list until published tables are loaded and checked.
2. **FD proposals**: thresholds and due days in Finance Settings still need the FD's confirmation.
3. **Live SQL Account (E62)**: edition, API and a reader, then a separately authorised switch-on.
4. **Close interfaces**: payroll, claims and billing into SQL Account.
5. **Direct bank feeds** and **Microsoft Graph** (Teams/SharePoint approvals): not built.
6. **A8**: waits for Azure OpenAI.
7. **Deployment**: none done; needs Fauzan's authorisation.

## 9. Handover

- Read `CLAUDE.md` and `docs/FINANCE_PHASE2.md`.
- Local tests use a throwaway PostgreSQL on port 5433 only; never staging.
- Guide cards live in `packages/core/src/finance-guides.ts`; bump `FIN_GUIDES_VERSION` when a screen changes.
- PR #49 stays a draft until Arisha main's review and Fauzan's decision. Do not merge or deploy from this bundle.
