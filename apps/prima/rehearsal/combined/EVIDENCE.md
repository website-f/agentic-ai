# Combined candidate, round 8 (frozen, 4 Nov 2026)

This is a draft test candidate only. Nothing here is merged, migrated, installed on any shared database, or deployed.
Every test used synthetic data on a throwaway local PostgreSQL. The raw logs are in `logs/` (committed with
`git add -f`, because `*.log` is gitignored).

## What was combined (every selected head)

The base is `main` 0ead549c0f08f2feb2d75a6896f5c209452bd654. Components are merged by exact SHA in the order of
`kit/components.json`:

| Component | SHA | Mode |
|---|---|---|
| #56 Connect departments | c76c1af | merge |
| #53 Special Ops | 4f1ed5f | merge |
| #52 Central Admin | af69986 | merge |
| #55 ACT | ebf6e4d | merge |
| #57 Company office | 39c2c70 | merge |
| #51 HR | a07f0e8 | merge |
| #54 Gov Ops / Private Ops / Procurement | a93249e | merge |
| #58 Work rebalancing | 242aefa | merge |
| #49 Finance | 50719b4 | merge |
| #60 M365 Connections | 1bbe4a9 | merge |
| #41 IT checking | f62a7b3 | merge |
| #61 Branches | 19d06f6 | merge |
| #62 Foreign worker welfare | de70175 | merge |
| #63 Growth panel | d659bda | net change d7d472d..d659bda, applied once |

Pins for this candidate:

- Tested tree: commit 7008843ba501b1e68a105ee285944724886b97c3, tree 45131f71080a148c1cf5b50a0ec8d2cea56df072. The
  commit above it adds only `rehearsal/`.
- Combined base `db/migrations/001_init.sql`: d1a9ec22ffeb955a5228e9fc578a65b940e8730037c9d134aa3037f097c6a283.
- Release artifact: 891e9645c37b09af27482c147262a80c506b400e5d49bbb2b61e359b6b0790c5.

## Results (`logs/`)

| Step | Result |
|---|---|
| install, core build, typecheck, API build, web demo build | pass |
| core tests | 1307/1307 |
| API tests on real local PostgreSQL | 928/928 |
| CMS app | 60/60 |
| schema rehearsal | pass |
| stale-pins | FAIL, expected (see Not done) |

**Sign-in.** Every registered department rollout is walked through `userForEntra` on PostgreSQL: central_admin,
company_office, finance, gov_ops, hr, private_ops and special_ops. Each one is refused before it starts, admitted
once it has started, and refuses an outsider.

**Guide.** The department guide cards for ACT, Central Admin, Finance, HR and Company Office are registered with the
shared guide. Every card passes the shared check: BM and English text, what is entered once, a source and whom to
ask, and no invented field.

## One release manifest (14 modules)

The modules, in order: procurement, rental_corrections, cleanup, metrics, job_email, central_admin_walls,
central_admin_panel, central_admin_delegations, central_admin_legal_holds, company_office, company_run_links,
org_links, special_ops, fw_welfare.

company_run_links was approved by Fauzan on 3 Nov at 07:53Z ("Yes, via the release path"). It sits after
company_office, with #57's catalogue check `companyRunLinkProblems`.

The schema rehearsal first checks that the manifest equals the release catalogue and that every `db/proposed` module
is in the manifest. It then installs through the reviewed installer on a fresh database, twice:

- **Pass 1:** each module installs, and its catalogue check is clean as `prima_app`.
- **Pass 2:** each module reports `already_installed`, with its catalogue verified.

The installed schema has 196 tables, 155 of them with forced RLS.

## What changed from round 7 (frozen 8361620, hosted CI 41753278182 green)

The owners' fixes to the release owner's 01:28Z review of round 7, and one more reconcile step:

- **#61 19d06f6.** Approval works out holds and split for the month approved, and locks the branch, then the month.
- **#51 a07f0e8.** HR fixes; HR browser tests in CI (login handover 18/18, leave 38/38). Base unchanged.
- **#49 50719b4.** Withdrawn revisions no longer selectable; new browser smoke in the synthetic-browser job.
- **#63 d659bda** (after 6f2bd8c: one sign-in answer per key state through an outage and recovery; d659bda only marks
  KEYS_STALE_MS as PROPOSED in a comment and the report).
- **R27** `prepareStaffPay` (service.ts): #51 reads `people0` and applies the month's movements, #49 adds the dated
  statutory tables to the same `Promise.all`; the line union left two destructuring heads. One call with both.

## What changed from round 5 (round 6 was a dry run, hosted CI run 41749518800 green; round 7 adds the owners' fixes to Arisha's overnight review)

- **#61 a487d88** (after 0b5c2df: month preparation locks the month; invoice numbers and SQL project codes unique per company under a company advisory lock). **0b5c2df:** Every branch and settlement action locks its row first; fixes the approveBranchSettlement race that
  failed hosted CI on round 4 (run 41603059740, branch-ledger-pg 2 !== 1). Round 5 still carried it and is superseded.
- **#51 d6c8765** (after 714248e: allowance fixes, one-off fingerprint, HR browser tests in CI: login handover 18/18, leave 38/38). **714248e:** Transition-month payroll, login move, IT handover projection, pay freshness; base adds the
  staff_movements and login_handover walls and prima.login_handovers.
- **#63 4f05a81** (after 5fa0831: waiting staff get 503, not a sign-in prompt, during a Microsoft key outage). **5fa0831:** One sign-in check per request shared by AuthGuard and the limiter; overflow queues or gets 429;
  5 s limit on the Microsoft key fetch.
- **New reconcile steps** (`kit/reconcile.py`, fail closed):
  - **R24** one `DataWall` union in access.ts (HR's new members were left after the registered-wall terminator).
  - **R25** company managers' wall lists in the HR and staff-security tests state the combined list
    (arms, corporate, legal, mandates, staff_company, staff_movements).
  - **R26** main.ts keeps one general limiter (the identity-aware one); the line union had restored the plain one, so
    every request was counted twice and #63's concurrency test failed.
- **#56 checks, reproducible from any directory** (`node kit/runlink-check.js <worktree>`,
  `node kit/orglinks-upgrade-check.js <worktree> kit/org-links-v1.at-8b0c33f.sql`), raw output in
  `logs/runlink-check.log` and `logs/orglinks-upgrade-check.log`: both PASS. The upgrade check installs the previous
  hand-over module, writes a row, applies this module over it (twice), and checks rows kept, a clean catalogue, and the
  same office receivers in code and database with a run link set.

## Reconcile steps added for round 4 (`kit/reconcile.py`)

- **R20.** Department guide cards are registered in `packages/core/src/guide-registry.ts`. The test is
  `test/guide-registry.test.ts`.
- **R21.** company_run_links joins the manifest, with its spec, ids, catalogue check, install marker and tests.
- **R22.** `staffPaySums` keeps HR's allowance wage bases and Finance's dated tables plus zakat:
  - EPF uses epfWage.
  - SOCSO, EIS and Lindung use socsoWage.
  - PCB uses taxable.
  - Zakat is a percentage of gross and reduces PCB, never below 0.

  The HR and Finance threads both confirmed this rule.
- **R23.** In `db.ts`, the run-link read gets its own store, and the request store keeps hand-overs.
- **Earlier steps** are now safe to re-run, and a step whose anchor is missing still stops the rehearsal.

## Explicit exclusions

None among the selected heads. Anything pushed to a PR after the SHAs above is not in this candidate.

## Not done, and not claimed

- **Safe upgrade of live data.** A fresh install does not prove it. The combined team prepares the base transition;
  the package on this branch still moves 678910…→4b4cf4…, and the replacement for this round's base (→d1a9ec22…) is
  prepared on its own branch for the release owner's independent review. It never runs on live data without a separate
  approval for that exact target.
- **Stale operator material.** `ops/existing-admin` and the exact-SPA workflow pins still carry old bases, the
  five-module manifest and old commits (`logs/stale-pins.log`). They are regenerated after the transition is settled.
- **Live checks.** There is no Entra sign-in with real accounts, no browser UAT with staff, and no provider connection
  (Microsoft, SQL Account, JA, Azure OpenAI).
- **Changes to live systems.** There are no tenant grants, no deployment and no migration.
