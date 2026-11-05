# Prima as one organisation: hand-overs, shared switches, import and go-live checks

Requested by Fauzan, 2 Nov 2026: "Make sure the system build like 1 whole organisation. Key in once and all department
get the data needed. Make sure try to automate what can be automated. Make staff life easier."

This is a draft. Nothing here is merged, migrated, deployed or switched on. Repository code and tests do not show that
anything is deployed, that a database module is installed, or that tenant permissions are granted.

## 1. Shared switches (stop department PRs colliding)

| What | File | Used by |
|---|---|---|
| One rollout switch. A department calls `registerRollout(key, label, admits)` from its own module. The CEO starts rollouts with `PRIMA_ROLLOUTS=hr,central_admin,...`. The older `HR_ROLLOUT=true`-style flags still work. Unknown or unregistered keys admit nobody. | `packages/core/src/rollouts.ts`, `apps/api/src/auth.ts` `pilotAdmits()` | Special Ops #53 and Central Admin #52 already cherry-picked it. HR #51 was asked to. |
| One database-wall registry. A department calls `registerWall(name, holds)`; `dataWalls()` appends the registered walls the person holds. | `packages/core/src/walls.ts` | Offered to Special Ops #53 for `arms`/`cms`. |

The GitHub sync check (trial merges of every open PR) is in the project files: `sync/github-sync-2026-11-02.md`.

## 2. Hand-overs between departments

Every business write already adds one audit entry. `withOrgLinks(store)` listens to those entries inside the same
transaction. When an action is a known link between departments, it writes three things:

- an **event**: the action, the record, the company and who keyed it. It never copies the audit summary, which can hold pay or personal details.
- one **hand-over** per receiving desk. Each goes to named people, has a due date when it is a to-do, and links to the keyed record.
- one **in-app notice** per person. Email and Teams stay unconfigured until separately verified.

A hand-over tells and links. It never approves, pays, provisions or changes the receiving department's records.
Confidential lines are never routed, even if a flow names them: speak-up, arms detail, discipline and harassment cases,
PDPA cases, face data, PINs and access reviews (`NEVER_ROUTED`).

Who sees hand-overs:
- The named receivers see their own.
- ACT and group leadership see all of them, with counts and a list of late ones.
- ACT also gets two signals: hand-overs past due, and hand-overs whose desk has nobody with an account.

Screen: **Hand-overs** (My hand-overs, How departments connect, Import existing records).

### The links (33)

| Link | Keyed once by | Who gets it | Status |
|---|---|---|---|
| New office staff joins | HR | IT (to do, 3d); Finance (to do, 7d); Chief of Staff office (to do, 7d); Company office (manager and admin executives) (told) | Ready on main |
| Staff leaves: access closed | HR | IT (to do, 1d); Finance (to do, 7d); Procurement and Goodwill store (told) | Ready on main |
| Basic pay change | HR | Finance (told) | Ready on main |
| Salary account change | HR | Finance (to do, 3d) | Ready on main |
| Staff claim submitted | HR | Finance (told) | Ready on main |
| Expense submitted | Company office (manager and admin executives) | Finance (told) | Ready on main |
| Purchase raised | Procurement and Goodwill store | Finance (told) | Ready on main |
| Goodwill store issues equipment to a guard | Procurement and Goodwill store | Finance (told); Company office (manager and admin executives) (told) | Ready on main |
| Guard disputes an equipment hand-over | Company office (manager and admin executives) | Procurement and Goodwill store (to do, 3d); ACT (Audit, Compliance and Transformation) (told) | Wakes when its PR merges (Gov Ops #54.) |
| Merdeka bills device rental | IT | Finance (to do, 7d); Company office (manager and admin executives) (told) | Ready on main |
| Hostel bill received | Foreign Worker Management | Finance (to do, 7d) | Ready on main |
| Hostel bill paid | Finance | Foreign Worker Management (told) | Already linked; notice added (Finance #49 already shows the payment on FWM’s hostel screen; this adds the notice.) |
| Foreign worker permit renewal submitted | Foreign Worker Management | Finance (to do, 5d); Company office (manager and admin executives) (told) | Ready on main |
| SOCSO claim started | HR | Finance (told); Company office (manager and admin executives) (told) | Ready on main |
| Serious site case raised | Company office (manager and admin executives) | CMS command centre (told); Chief of Staff office (to do, 3d); COO (told) | Ready on main |
| Site risk assessment with high risks | Company office (manager and admin executives) | HR (to do, 7d) | Ready on main |
| New client | Company office (manager and admin executives) | Finance (to do, 5d); CMS command centre (told) | Ready on main |
| Client leaves | Company office (manager and admin executives) | Finance (to do, 14d); Procurement and Goodwill store (to do, 14d); IT (to do, 14d); CMS command centre (told) | Ready on main |
| Contract signed, mobilisation opened | Company office (manager and admin executives) | Finance (to do, 7d); Chief of Staff office (to do, 7d); Procurement and Goodwill store (to do, 7d); HR (told); CMS command centre (told) | Ready on main |
| Contract changed | Company office (manager and admin executives) | Finance (told) | Ready on main |
| Invoice sent to a client | Company office (manager and admin executives) | Finance (told) | Ready on main |
| PWVSB lends to a company | Finance | Legal (to do, 7d); Company office (manager and admin executives) (told) | Ready on main |
| Legal matter opened | Legal | Company office (manager and admin executives) (told); Finance (told) | Ready on main |
| Asset disposed | Asset Management | Finance (to do, 7d) | Ready on main |
| Branch settlement approved | Company office (manager and admin executives) | Finance (to do, 7d) | Ready on main |
| Bad debt written off | Finance | ACT (Audit, Compliance and Transformation) (told); Company office (manager and admin executives) (told) | Wakes when its PR merges (Finance #49.) |
| Supplier or payee bank details changed | Finance | ACT (Audit, Compliance and Transformation) (told) | Wakes when its PR merges (Finance #49.) |
| Bank guarantee called or claimed | Finance | Legal (to do, 3d); Company office (manager and admin executives) (told) | Wakes when its PR merges (Finance #49.) |
| Office OSH incident | HR | Chief of Staff office (to do, 3d) | Wakes when its PR merges (HR #51.) |
| Licence renewal fee to pay | Company office (manager and admin executives) | Finance (to do, 3d) | Wakes when its PR merges (Central Admin #52 (5C). A lapsed licence already blocks a new contract there (W15).) |
| Licence renewed | Company office (manager and admin executives) | Legal (told); Company office (manager and admin executives) (told) | Wakes when its PR merges (Central Admin #52 (5C).) |
| Guard attendance, patrol and pay from the JA app | Company office (manager and admin executives) | CMS command centre (told); Finance (told) | Waits for outside system (Waits for the JA app API (request documents sent 2 Nov 2026).) |
| SQL Account postings read back | Finance | ACT (Audit, Compliance and Transformation) (told) | Waits for outside system (Waits for a read-only SQL Account link; staff paste the export today.) |

Status counts: 23 ready on main, 7 wake up when their department PR merges, 1 already linked directly (the hostel payment in #49), and 2 wait for an outside system (JA app API, SQL Account read link).

When the Company office module merges, `company_office` hand-overs can go to the office desk owner instead of the manager and admin executives (`officeDesk` on each line; `PrimaService.officeDeskHolders` in that thread).

## 3. Real-data import

`POST /api/org/import/:kind/preview` and `/commit`, plus the Import tab. A spreadsheet (CSV) of existing records:

1. **Preview.** Each row goes through the record form's own save inside a transaction that is rolled back. The errors shown are exactly the ones a real save would give. Nothing is kept.
2. **Import.** The same file goes back with the preview's SHA-256 fingerprint. It must be unchanged and every row clean. All rows are then saved in one transaction, or none.
3. **Once only.** A file is never imported twice: the fingerprint is unique in the database.

The same person may import who may add the record by hand. Restricted numbers (IC, salary account) are never echoed back.
Imported records start no hand-overs. The CEO's company master data and the arms register are not importable.
Kinds: sites, posts, checkpoints, licences, insurance policies, guarantees, vehicles, stock items, hostels, office staff,
rental units, fixed assets, domains.

## 4. Database module (`db/modules/org-links-v1.sql`)

This module is separate and reviewed. It is never run at startup. The CEO runs it, and only then sets `PRIMA_ORG_LINKS=true`. With the flag off, the API behaves exactly as before.

- Forced row-level security on four new tables. No deletes.
- An event is accepted only if it matches an audit entry already written: same sequence number, action, record and company.
- A hand-over is accepted only for an existing event, and only as open.
- A notice is accepted only for one of the hand-over's receivers.
- A hand-over closes once, by one of its receivers, under their own name, with a note.
- Readiness: `GET /api/health/org-links` reports whether the layer is on, installed and ready.

## 5. Go-live checks

| Script | What it does |
|---|---|
| `infra/check-golive.sh` | Read-only. Checks backup retention, second-region copy, earliest restore point, standby server, last restore drill, Log Analytics, API probes, minimum replicas, alert rules, budget, `/api/health` and `/api/health/org-links`. Exits 1 only on a FAIL. Each warning is a cost or risk decision for the CEO. |
| `infra/restore-drill.sh` | CEO-run, refused without `CONFIRM=restore-drill`. Restores the database to a temporary server at a point in time, checks it is ready and holds the database, logs the result to `ops/restore-drills/`, then deletes the temporary server. The live server is never touched. The temporary server is billed while it exists. |

Neither script has been run against Azure from this branch.

## 6. Test evidence

Branch `claude/project-thread-f5cy58`, commit 3e8ba79 plus this document. Run in the cloud session on 2 Nov 2026:

- Core (vitest, in-memory store, synthetic data): 38 files, 696 tests passed. New: `rollouts.test.ts` (4), `org-links.test.ts` (7), `org-import.test.ts` (5).
- API (node:test, `npm test -w @prima/api`) against a disposable **local PostgreSQL 16**: 686 tests passed. New: `org-links-rls.test.ts` (7). It runs as the `prima_app` role with forced RLS and covers right-people-only visibility, rollback on failure, forged closes, forged events, tasks and notices, the once-only import receipt, and readiness detecting drift.
- Web typecheck and demo build passed. A browser check of the demo build (Playwright, synthetic data) found no page errors and no sideways scroll at 1280 and 390 px. The import preview showed 1 row ready and 1 row to fix.
- The import's dry run and commit were tested on the in-memory store only, not on PostgreSQL.

## 7. Not done here

- ACT restructure (1 director, 2 teams of auditor + enforcement): built in the "Build ACT department" thread.
- Each company's own office: built in its own thread.
- Email, Teams, SMS or push delivery: off until verified.
- Alert rules, probes, backup retention and the restore drill are CEO decisions. The check reports them; it does not set them.
