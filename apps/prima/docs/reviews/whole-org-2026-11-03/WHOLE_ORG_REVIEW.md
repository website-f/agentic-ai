# Prima Secure: whole-organisation review of the combined build

Prepared 3 Nov 2026 (about 03:00Z) for Fauzan, and then for Arisha main's review.

Nothing here was merged, migrated, deployed or switched on. All data is synthetic. Every PostgreSQL result comes from a disposable local PostgreSQL 16 database, not from Azure. Browser results come from the single-file test build, which runs the same business code inside the browser.

## 1. What was tested

| Item | Value |
|---|---|
| Build | `claude/combined-candidate-2026-11-03` at `d7d472de4a7fbad232fbea23b70c2ddc8a21b1f9` (11 department PRs joined) |
| Not included | Branches (#61) and foreign-worker welfare (#62) |
| Toolchain | Node 22.23.4, Vitest (as declared), PostgreSQL 16 local |
| Core tests | **1,167 / 1,167 pass** (103 files) |
| API tests on PostgreSQL | **841 / 841 pass** |
| Browser walk | 27 roles, every menu item opened in each role (about 1,000 screens), at 1280 px. The IT pilot switch was turned **off in a local copy only**, so leaders and company staff could be tested; the real build keeps it on. **These walk results do not establish real sign-in or rollout admission**: they used local dev logins with the pilot gate off. Real Microsoft sign-in is checked separately (G1, `tools/rollout-check.cjs`). |
| Stress test | The mock data was scaled from 3 detailed companies to all 38: **8,337 people (about 7,930 guards), 1,855 sites, 77,000 shifts, 37,000 attendance rows, 233,000 rows in total (174 MB)**. It was run two ways: business code in memory, and the real API on PostgreSQL. |

The tools and raw results are in `tools/` and `evidence/` next to this file. Anyone can re-run them.

## 2. Verdict in one paragraph

Prima now behaves like one organisation in its structure:
- The same records feed every department.
- 33 hand-over links connect the departments.
- The ACT monitor reads every department's own records.
- Approvals keep reasons and refuse self-approval.
- No screen crashed in any role.

Three things stop it working as one group app today:
1. **Sign-in is broken for every department rollout in the combined build.**
2. **The leadership screens do not survive group-scale data with more than about 10 people at once.**
3. **The "eagle eye" view shows risk only, not growth.**

The first is a small code fix. The second needs a design change before more companies go live. The third is a product gap that needs Fauzan's choice of measures.

## 3. Gaps ranked by importance

### G1. Staff of the new departments cannot sign in with Microsoft (blocker, small fix)

**Business effect:** when the CEO switches on HR, Central Admin, Special Ops, Finance or Gov Ops, every one of their staff is still refused with "You are not part of the pilot yet." Only the IT pilot people get in.

**Cause:** joining the branches left two checks in `apps/api/src/auth.ts` `userForEntra`:
- The shared rollout switch is at line 97.
- An old Finance-only check is at line 100. It refuses anyone outside the IT pilot unless they are Finance with `FINANCE_ROLLOUT=true`.
- Separately, `finance` and `gov_ops` are accepted as switch names, but nothing registers them, so line 97 refuses their staff too.

**Proof:** `tools/rollout-check.cjs` against the built API code. These people are refused:

| Person | Switch on | Refused at |
|---|---|---|
| Chief of Staff | `PRIMA_ROLLOUTS=hr` | line 100 |
| Arms Control | `special_ops` | line 100 |
| Company secretary | `central_admin` | line 100 |
| Finance team leader | `FINANCE_ROLLOUT=true` | line 97 |
| OGM | `GOV_OPS_ROLLOUT=true` | line 97 |

The IT Manager and HR admin sign in, because they are pilot users.

**Fix:**
1. Remove line 100.
2. Register `finance` and `gov_ops` with `registerRollout`.
3. Add one API test per switch that goes through `userForEntra`.

This was sent to the thread that owns the combined build ("Connect departments so data is keyed once").

### G2. Leadership screens slow down tenfold and then fail at group scale (high, design change)

**Business effect:** on pilot-size data the COO's home opens in 0.5 s, and 20 people opening it at once all succeed. With all 38 companies at real size:

| Screen (one person) | Pilot data | Group scale |
|---|---|---|
| COO home | 0.5 s, the database reads 0.27 M rows | **5.0 s, the database reads 7.7 M rows** |
| CEO private ops monitor | 0.2 s, 310 KB | **11.3 s, 3.6 MB** |
| Management fee bills (CEO, FD, COO) | n/a | **14 to 15 s** |
| Company offices list (leaders) | n/a | **8.5 s** |
| Company Manager home | 0.2 s | 0.17 s (fine: one company) |

At the same moment:
- **20 people opening the COO home** (morning rush): exactly 10 succeed after 14 to 17 s. The other 10 get "Something went wrong on the server" after 10 s.
- **50 or 100 people at once:** 80 to 90% fail the same way.

The cause is that each request holds one of 10 database connections while it reads whole group tables. The 11th person waits 10 s and is refused. The error message also wrongly tells staff that something broke, when the server is only busy.

**Writes are fine.** 100 help requests logged at the same moment all saved in 0.3 s with no duplicate numbers (170 of 170 unique).

**Fix:**
- Leadership screens should read **pre-counted daily figures per company**, updated when records change or every few minutes, instead of re-reading every shift and attendance row on every open.
- Group lists (offices, fee bills, private ops) need paging and a company filter.
- In the short term:
  - Raise the connection pool.
  - Free the connection before the in-memory work starts.
  - Return "busy, try again" instead of a server error.
- Rerun this stress test as a release gate.

### G3. The eagle-eye view protects the group but does not show growth (high; decided 3 Nov 03:07Z: "Recommended set", built as draft PR #63)

**What leaders see today:** the CEO home and "Group today" are strong on risk:
- decisions waiting;
- P1 cases;
- firearms;
- expired licences;
- guards not allowed to work;
- insurance;
- SSM filings;
- domains;
- cash, ageing and month-end close shown honestly as **Unknown**, because SQL Account is not linked.

**What is missing:** no screen answers "is the group growing, and which companies are pulling it down?" There is no revenue trend per company, no contracts won, lost or due for renewal (revenue at risk), no sales pipeline value, no margin per company or site, no guard headcount or fill-rate trend, and no collection days.

The data for several of these already exists in separate screens:
- **Contracts:** 143 live contracts worth RM1.83 M a month in the mock data.
- **Under-billing:** **31 contracts where last month's invoice is off or missing**, for example RM15,000 billed against RM15,752.64 due.
- **Site P&L:** Gov/Private Ops monitors.
- **Sales leads:** Clients.
- **Cash forecast:** the 13-week forecast in Finance.

None of it is rolled up to the leaders.

**Fix:** add a **Growth** panel on the CEO, COO, FD and Chairman home, per company and for the group:
- monthly contract value and its change;
- contracts ending in 90 days;
- pipeline value;
- under-billed amount last month;
- site margin;
- unfilled shifts;
- collection days once SQL Account is linked.

Each figure shows Unknown until its source is linked. **Fauzan to choose the measures and targets.**

### G4. Company hand-overs vanish when a company has no office account yet (medium, small fix)

**Business effect:** 33 of the 38 companies have no Company Manager or admin account in Prima yet. When something is keyed for one of them, the "company office" line of the hand-over is silently skipped. It is not shown as unassigned, and ACT's "hand-overs with nobody to receive them" count misses it. Examples:
- a client debt written off;
- a guarantee called;
- a licence renewed;
- a new joiner.

**Cause:** `org-links.ts` line 747 skips the company office line when nobody is found. It is meant for central employers (PWVSB, Merdeka, Goodwill, Sasa Team), but it applies to every company.

**Fix:** skip only central employers. For every other company, keep the line as unassigned so ACT and leadership see it.

### G5. Nobody owns a Finance hand-over (medium, needs Fauzan's rule)

**Business effect:** every Finance line goes to the same 9 people: the FD plus all 7 team leaders and deputies, whichever team handles that company. When everyone is told, nobody clearly owns the task, and the KPI clock has no single person.

**Fix:** route each hand-over to the team the FD assigned to that company for the year ("FD sets teams yearly", 2 Nov 2026), with the FD as backup. This needs the company-to-team list kept in Prima.

### G6. Too much lands on the CEO (medium)

**Business effect:** the CEO's "Do today" leads with operational escalations from the foreign-worker ladder:
- "Passport: 50 renewals not started, now with you", the worst 400 days late;
- "69 foreign worker papers at CEO".

These are mock ages, but the mechanism sends every unrenewed paper to the CEO after 7 days. At 2,000 Nepali guards, this would bury the CEO's real decisions.

**Fix:**
- Show the CEO one line per company and per paper type, with the count and the owner.
- Show the papers themselves to FWM, the Chief of Staff and the COO.
- Keep the CEO step for papers that block a guard from working or that are near a legal deadline.

### G7. Menus too long for leaders; two dead-end menu items (low)

- **Long menus:** leaders get 53 to 56 menu items, and company managers get 46. Group them into sections such as Today, People, Money, Operations, Compliance and Setup.
- **Dead end 1:** "IT purchase fulfilment" is in the menu of the Chairman, Vice Chairman, Chief of Staff, Deputy CoS, Credit Officer, Finance team leaders and Finance data entry staff, but opening it says "Not allowed". Hide it for anyone who cannot act on it.
- **Dead end 2:** in the test version, "Connection" shows "Status unavailable" for everyone. That is correct, because nothing is connected, but in the test link it reads as broken. Label it "Not set up in the test version".

### G8. KPIs cover IT and Finance only (low, already known)

"Workflow time & quality" covers only IT jobs, IT tickets and website tickets. It lists its uninstrumented parts honestly: procurement, onboarding, rentals, inspections and imports. HR KPI is on hold. Speed and quality of work in HR, Ops, Procurement and company offices is therefore not measured yet. The screen's wording is also technical for a leader ("server snapshots", "adapters").

### G9. Hand-over map labels are out of date (low, small fix)

Seven hand-over links still say "waiting for a department PR", although their source actions are now in the combined code:
- write-off;
- payee change;
- guarantee;
- OSH incident;
- licence fee;
- licence renewed;
- store dispute.

Routing ignores this label, so the links work. Only the map tells staff the wrong thing. Change these seven to "live" when the combined build is accepted.

## 4. What works well (checked)

- **No crashes:** 27 roles and about 1,000 screens opened, with zero page errors and zero console errors.
- **Data walls hold:**
  - A guard has 5 menu items (own view).
  - A patrol officer has 17.
  - The Company Manager sees only Sasa.
  - Company Manager home stays fast at group scale (0.17 s), because it reads only its own company.
- **ACT:** reads every department's records directly, with no re-keying. Examples: 15 legal obligations without proof, 28 guard permits expired, 15 HIRARC reviews overdue and 19 signals with no finding yet. Each line can raise a finding with the count pre-filled. Overdue findings go to the Chief of Staff, then the COO, then the CEO, and no discipline is automatic.
- **Hand-over design:**
  - 23 links are live, 7 are now live in the combined code but still labelled "waiting" (G9), 1 is direct and 2 wait on JA and SQL Account.
  - Each hand-over carries a link to the original record.
  - A hand-over never approves or pays.
  - Confidential actions (whistle-blowing, arms, HR cases, PDPA, face, PINs) are never routed.
- **Honest unknowns:** cash, ageing, closes and 35 companies without data show as Unknown, never as green.
- **Work rebalancing:** the COO's Work screen shows tasks, overdue, review, on-time % against an 80% standard, help that escalates after 30 minutes and the work-from-home readiness check.
- **Writes under load:** concurrent saves are fast, and numbers stay unique.

## 5. Suggested order

1. **G1:** fix sign-in. Small, and it blocks every rollout. This belongs to the combined-build thread.
2. **G4 and G9:** small fixes on the same branch.
3. **G2:** pre-counted leadership figures, paging, pool and busy handling. Rerun the stress test.
4. **G3:** Growth panel. Fauzan chose the Recommended set; built as draft PR #63 (not merged or deployed).
5. **G5 and G6:** routing rules for Finance teams and CEO escalations, once Fauzan decides.
6. **G7 and G8:** menus and KPI coverage.

## 5a. Staff workflow run (added 3 Nov, about 03:35Z, at Fauzan's request: "Be like all the staff doing the work")

I acted as each person and ran 8 everyday workflows end to end on the combined build's business code (synthetic data; the script is `tools/staffday.mjs` and the log is `evidence/staffday.log`). 34 steps went through. 5 were refused: 3 refused correctly (own claim, already paid, gallery photo instead of the in-app camera), and 2 point to gaps.

| Workflow | People involved | Result |
|---|---|---|
| New office joiner at Sasa | HR → IT, Finance, CoS, Sasa office | Keyed once and 5 hand-overs sent. **IT's to-do cannot close** (W2) |
| Medical claim RM120 | Admin exec → Company Manager → HR → COO → Finance | Works. Own-claim and double payment refused |
| Annual leave | Admin exec → HR | Works. The Company Manager cannot decide (rule: HR decides office staff leave) |
| Serious theft case (P1) | Company Manager → site officer → patrol officer → OM → Regional OM | The ladder works with proof at every step. **No hand-over to CMS, CoS or COO** (W1) |
| New client and contract | Company Manager → Finance, CoS, Procurement, HR, CMS | Works. 7 hand-overs from one entry |
| Purchase RM450 | Admin exec → Procurement (3 quotes and online price) → COO → CEO | Works. Approved |
| IT help request | Staff raises → IT fixes → staff confirms | Works. The fixer cannot confirm their own fix |
| ACT finding | ACT → Company Manager plans and fixes → ACT checks | Works |

New gaps from the run:

- **W1. Serious-case hand-overs never fire (high, small fix).** The `case_serious` link tests for severity `high` or `critical`, but cases use P1 to P4. When a P1 case was raised, CMS, the COO and the Chief of Staff (insurance check) got nothing. The unit test passes only because it uses `high`. Fix: test for P1 (and P2 if Fauzan agrees) and use real case values in the test.
- **W2. A joiner's IT to-do gets stuck (medium).** IT's to-do closes only from the HR/IT joining request. Nothing tells HR to open that request after adding the joiner: HR's hand-overs, HR join/leave screen and HR/IT intake all show nothing. The IT to-do stays open and goes late. Fix: when HR saves an office joiner, give HR a to-do "Open the HR/IT joining request", or start the request pre-filled from the staff record.
- **W3. Leaders approve very small items (needs Fauzan's choice).** Every staff medical claim (here RM120) needs the COO's approval. Every purchase (here RM450) needs the COO and the CEO. Across 38 companies this makes the COO and CEO the bottleneck. A value limit (for example, the Company Manager approves claims up to RM300 and the COO approves purchases up to RM2,000) would keep money control while freeing leaders' time. These are Fauzan's rules today, so they are not changed.
- **W4. Notices are in Prima only.** Staff learn about new work only when they open Prima. Email and Teams notices stay off until Microsoft 365 is connected (Arisha's tenant step). Until then, ask each desk to open Hand-overs at the start of the day.

## 5b. Decisions still open for Fauzan

| # | Decision | Recommendation |
|---|---|---|
| G3 | Growth measures | **Decided** 3 Nov 03:07Z: Recommended set. Built in draft PR #63; site margin still takes 13-17 s at group scale (G2). |
| G5 | Who owns a Finance hand-over: all 9 Finance leads, or only the team assigned to that company | The assigned team, with the FD as fallback when no team is set |
| G6 | Which escalations reach the CEO's Do today (the FW ladder floods it) | CEO sees only the final rung (7 days) and P1 cases; earlier rungs stay with FWM, CoS and COO |
| W1 | Which case severities count as serious for CMS, COO and CoS hand-overs | P1 and P2 |
| W3 | Value limits on approvals (every claim needs the COO; every purchase needs the COO and CEO) | Example only: Company Manager approves claims up to RM300; COO alone approves purchases up to RM2,000 |
| Leave | Whether Company Managers decide office staff leave, or HR only (today's rule) | Keep HR, unless Fauzan wants company heads to decide |

G1 (sign-in) is agreed as a real blocker. The combined-build thread owns the fix and the `userForEntra` tests.

## 5c. Rerun on the PR #63 head (added 3 Nov, about 04:05Z, after Arisha's review)

Arisha asked for four changes to the evidence; all four are done.

- **The loader refuses a real database.** `tools/pgload.mjs` drops the `prima` schema. It now runs only on localhost, only on a database named `prima_stress`, `prima_base`, `prima_scratch` or `prima_test…`, and only with `STRESS_DISPOSABLE_DB=yes`. Anything else stops with exit code 2. Checked against a remote URL: refused.
- **Refusals are counted apart from failures.** `tools/classify.mjs` sorts every response into ok, refused (permission, 401/403), refused (input, other 4xx) and server error (5xx). `tools/httpload.mjs` uses it. The rerun results are in `evidence/http-results.json`, and the console output is in `evidence/httpload-rerun.log`.
- **The 20-COO run has its raw output.** `tools/conc-coo-20.mjs` writes every response to `evidence/conc-coo-20.json`, including status, time and the start of any error body.
- **The rerun used the exact head.** The tools were run against the API built from the PR #63 head. The core tests ran on the same tree. The commit that adds this section is the pinned head.

Rerun results (same group-scale synthetic database, one local API process, 10 database connections):

| Check | ok | refused (permission) | refused (input) | server error |
|---|---|---|---|---|
| Every GET screen once, 4 roles (544 reads) | 424 | 94 | 15 | 11 |
| 20 COO homes at once | 10 (17.9-18.1 s) | 0 | 0 | 10 (at 10.06 s) |
| 25 homes at once, mixed roles | 10 | 1 | 4 | 10 |
| 50 homes at once | 10 | 1 | 4 | 35 |
| 100 homes at once | 10 | 1 | 4 | 85 |

What the numbers show:
- **The 403s and 400s are expected.** They are roles opening screens outside their job, or screens that need an input the crawler did not give. They are not failures.
- **The concurrency 5xx are all G2.** Above 10 requests at once, every extra request waits for a database connection and fails at about 10 s. G2 is confirmed again on the new head.
- **The 11 single-read 5xx come from two causes:**
  - `/api/org/inbox` and `/api/org/map` (CEO, COO and others): the stress database was loaded without the hand-over database module (`org_tasks` is missing), so these are an artefact of the test setup.
  - `/api/arisha/draft-form` with no `kind`: a real small defect. A missing input shows as a server error instead of "no form called …", because `arishaKind` throws a plain Error. Small fix for the Arisha branch.

## 5d. G2 speed fix, first step (added 3 Nov, about 04:20Z)

**Cause found.** For each of the 38 companies, a leader's home asked PostgreSQL for "this company's shifts today", attendance and credentials. Those queries went through a general-purpose JSON index that takes about 0.14 s per company at this size. The same reference lists were also read again and again: grants 63 times and credentials 79 times in one home.

**Fix (draft PR #63):**
1. `PgStore.list` sends company filters on the 14 large company tables through the plain company index. A database CHECK keeps that column equal to the record's company, so the results are the same. **No schema change:** the column, the CHECK and the index already exist in base `db/migrations/001_init.sql` (tenant-table loop). `git diff d7d472d..HEAD -- db apps/api/src/schema.ts` is empty, so there is no migration and no manifest change.
2. While a home is built, a repeated identical list is read once (`read-memo.ts`). Any write clears it.
3. When every database connection is busy, the reply is 503 "Prima is busy right now. Please try again", not a generic 500.

**Measured on the same synthetic group-scale database** (`tools/hometables.mjs`, `evidence/conc-coo-20-after.json`, `evidence/http-results-after.json`):

| Measure | Before | After |
|---|---|---|
| One COO home | 5.0 s, 7.7 M rows read | 1.4 s, 0.41 M rows |
| 20 COO homes at once | 10 ok, 10 failed | 20 ok (slowest 18.5 s) |
| 25 mixed homes at once | 10 server errors | 0 server errors |
| 50 / 100 at once | 35 / 85 server errors | 22 / 72 server errors (500). **Corrected in 5f:** the saved raw output of this run shows 500, not 503 as first written here. The rerun on the fixed head answers 503 |

**Still open in G2.**
- One API process does the leader-home work on one CPU, so 20 at once still take up to 18 s.
- Above about 25 at once, requests still queue past the 10-second connection wait.
- The next steps are pre-counted leader figures, paging the large screens (Operations private board, 3.6 MB), and running more than one API process on Azure.

## 5e. Ready for all guards (added 3 Nov, about 05:10Z)

Fauzan (04:35Z): guards stay in the JA Group app for now, but the system must already be built for them, so that moving them later is only an Azure size choice. This section tests that on the same synthetic group-scale database (`prima_stress`, local only): 7,406 synthetic guard accounts and 1,855 site devices (`tools/guardsetup.mjs`), then a year of synthetic history (`tools/guardhistory.sql`, which stops unless the database is `prima_stress`; 12 earlier months copied with new ids and dates: 1.0 M shifts, 0.5 M attendance rows, 0.3 M patrol taps).

**What was wrong at scale, and what changed (draft PR #63):**
1. **The rate limit counted a whole site as one person.** Guards at one site (or staff in one office) share one public address, so 600 requests a minute was shared by all of them. Now each person whose sign-in is **verified** (signature checked) has their own 600 a minute, with a looser cap for the address as a whole (`RATE_LIMIT_PER_IP_PER_MIN`, default 20,000). Anything unverified (no sign-in, a made-up or expired one) shares the address's 600, so rotating invalid headers gains nothing (Arisha review; first version hashed the unverified header, fixed in 5f).
2. **Reads pulled the whole history.** Shifts, attendance and patrol taps grow every day. `Store.list` now takes a date window, and the guard, site, attendance and monitor screens read only the dates they show.
3. **One guard's Duty screen read the whole company.** To list one guard's recent attendance problems it built the problem list for every guard in the company (all people, all sites, all posts, a month of everyone's shifts and attendance), then kept that guard's lines. It now reads only that guard's rows. A test checks the result is exactly the same as the company list filtered to that person (`packages/core/test/guard-reads.test.ts`).
4. ~~Proposed date indexes~~ **withdrawn** (see 5f): under the company wall PostgreSQL cannot use an index on a JSON field, so they could not help the app.

**Measured, one API process, 10 database connections, 4-CPU machine** (`tools/guardload.mjs`, `tools/guardsummary.mjs`, files in `evidence/`):

| Guards at the same moment | 1 month of history, before | 1 year of history, before fix 3 | 1 year, after fix 3 | 1 year, after fix 3 + withdrawn indexes |
|---|---|---|---|---|
| 50 open Duty | all ok, 1.9 s | all ok, 2.7 s | all ok, 0.8 s | all ok, 0.9 s |
| 100 open Duty | all ok, 5.6 s | 12 refused "busy", 11.6 s | all ok, 1.8 s | all ok, 1.8 s |
| 200 open Duty | all ok, 9.9 s | 89 refused "busy", 13.4 s | all ok, 3.0 s | all ok, 3.0 s |
| 200 clock-ins on site devices | all ok, 4.6 s | all ok, 4.8 s | all ok, 5.0 s | all ok, 4.7 s |

The last column matches the one before it because, as 5f explains, the app never used those indexes.

(Times are until the last of the group was answered. "Before" columns: `guard-load-before.json`, `guard-load-year-range.json`; after: `guard-load-year-person.json`, `guard-load-year-indexes.json`.)

**Running more than one copy of the API (needed for guards).** Checked the API for anything held in one process's memory:
- Audit chain, IT ticket numbers, manual records, module installs: ordered by database locks, so several copies stay correct.
- Rate limit: counted per copy. With N copies a session can make up to N × 600 a minute. Acceptable; a shared counter is needed only if that matters.
- Arisha IT extraction "one at a time per person": per copy. A person could run two at once on two copies. Low risk; the AI switches and daily caps are in the database.
- Microsoft sign-in keys: a per-copy cache, refreshed on its own. Safe.
- Clock-ins write one audit entry each, and the audit chain is one queue for the whole group. On this machine that is about 40 clock-ins a second. A shift change of 8,000 guards over 30 minutes is about 5 a second.

**Sizing note (PROPOSED; Fauzan decides the Azure size later).**

| Use | Load | Suggested start |
|---|---|---|
| Today: about 300 staff a day | a few requests a second | 1-2 API copies, database B1ms-B2s, 10 connections a copy (staging plan, Issue #12) |
| If all 8,000+ guards move to Prima | shift change: about 3,000-4,000 guards within 15-30 minutes, each opening Duty and clocking in | 3-4 API copies (scale out at shift change), General Purpose database with 2-4 vCores, 10-20 connections a copy, PgBouncer or the server's built-in pooler |

These are starting points, not measurements on Azure. The numbers above come from one local machine. Before guards move, rerun `tools/guardload.mjs` against staging with the chosen size.

**Still open:** the leader screens' site margin (13-17 s, G2) is unchanged by this work; JA Group remains the guards' system of record (rule SYS-JA-OWNS) until Fauzan decides otherwise.

## 5f. Arisha's review of 00fe974, fixed (added 3 Nov, about 06:20Z)

1. **Load tools could be pointed elsewhere.** A URL such as `postgres://...@localhost/prima_stress?host=<remote>` passed the old "localhost" check, but the database driver obeys the `host` setting in the query. Every tool that connects or writes now goes through `tools/target.mjs`:
   - The database URL may carry no query or fragment.
   - No `PG*` override variables may be set.
   - The name must be `prima_stress`, `prima_base`, `prima_scratch` or `prima_test*`, and `STRESS_DISPOSABLE_DB=yes` is required.
   - The client is built from explicit fields, never from the string, and after connecting the server must report a loopback address and the same database.
   - The API base must be plain `http` to `localhost`, `127.0.0.1` or `[::1]`, with no user info, query or path. Redirects are refused.

   `tools/target.test.mjs` **runs the real tools** (`pgload`, `guardsetup`, `guardload`, `conc-coo-20`) with unsafe settings while a local listener counts connections. 15 of 15 tests pass, every tool exits with code 2, and the listener received no connection.
2. **Rate limit escape.** See 5e item 1. Tests in `apps/api/test/http.test.ts`:
   - four made-up headers from one address share one count;
   - a failing identity check counts as unverified;
   - `rateIdentity` names a person only for a correctly signed token.
3. **Growth panel.**
   - Group collection days now add all companies' debtors and divide by all billing in the same ageing months, times 30. Arisha's case (60 days and 0 days, where the second company's contract ended) now gives 30, not 60.
   - Group figures that no company has recorded are Unknown (null), never a green zero: contracts ending, pipeline and under-billing.
   - Each figure states its own coverage, including a new `known.billing`.
   - Tests are in `packages/core/test/growth.test.ts`.
4. **Leader screens, rerun with raw output** (`tools/httpload.mjs` now keeps the first 300 characters of every answer that is not 200, and `classify.mjs` counts 503 "busy" apart from real server errors). Same synthetic database, now also holding the guard accounts and a year of history:

| Run | CEO home | 10 / 25 homes at once | 50 / 100 at once | Every screen once, 4 leader roles |
|---|---|---|---|---|
| `http-results-after.json` (305d9dd, before the guard data) | 2.6 s | all answered | **22 / 72 answered 500** | 7 server errors |
| `http-results-rerun2.json` (00fe974, with the guard data) | 20.4 s | all answered | 22 / 72 answered 503 busy, 0 server errors | 7 server errors |
| `http-results-rerun4.json` (this head) | 2.9 s | all answered | 16 / 72 answered 503 busy, 0 server errors | 7 server errors |

   - **What was wrong.** The 500s in the first run were real server errors. The first busy-pool fix did not reach them. On the current head, overload answers 503 "busy, try again, nothing was changed". The raw bodies are in the JSON files.
   - **Why the CEO home went from 2.6 s to 20 s.** The leave list looked up each guard's last shift across all companies. Under the company wall PostgreSQL may use an index only for plain column checks (`company_id`, `id`), never for a JSON field check (`data->>'personId'`, `data @> ...`). Each lookup therefore read all 1.0 M shifts. It now reads the person's own company first and falls back to all companies only when the person has no shift there. The same rule is why the proposed date indexes were withdrawn.
   - **Lasting fix, proposed only, not built.** Copy the few fields that are searched (person, site, date, clock-in) into real columns generated from the record, with indexes that start with `company_id`. It is a schema change, so it needs a reviewed module and the CEO's approval.
   - **The 7 remaining server errors** are `/api/org/inbox` and `/api/org/map`. They fail because the hand-over module (owned by the Connect departments thread, #56) is not installed on this test database. The server logs them as `category=database_configuration`. They were the same in every run.
   - **Not established by these runs.** The 200-guard Duty and clock-in results say nothing about Growth or leader-screen speed. Site margin, management-fee bills (12-14 s) and the Operations private board (9-11 s) remain slow (G2).

## 5g. Arisha's follow-up on d4dbb81 (added 3 Nov, about 08:50Z)

1. **Forged sign-ins could make Prima fetch Microsoft's keys many times.** Her synthetic test sent 8 forged tokens at once and got 8 key fetches before the address limit answered 429. Two changes:
   - **Key fetch (`apps/api/src/entra.ts`).** At most one key fetch runs at a time, and every request waiting on it shares it. There is at most one attempt per 5 minutes, even after a failed fetch. Keys already held keep working.
   - **Rate limit (`apps/api/src/security.ts`).** The address count is checked first and costs nothing, so an address over its limit is refused before any identity work. At most 8 identity checks run at once per address (`RATE_IDENTIFY_CONCURRENCY`); beyond that a request is counted as unverified without checking.

   Tests are in `apps/api/test/entra.test.ts`:
   - 8 requests at once, 7 with forged key ids, cause 1 fetch.
   - Further forged ids within 5 minutes cause no fetch.
   - A failed fetch is not retried for 5 minutes.
   - A burst through the real `verifyEntraToken` and `rateLimit` causes 1 fetch, at most 2 identity checks, and no identity check once the address is over its limit.
2. **Load report.** For this run the hand-over module (`db/modules/org-links-v1.sql`, owned by #56) was installed on the **local synthetic** `prima_stress` database only, and the API ran with `PRIMA_ORG_LINKS=true`. Growth was added to the run (`get-routes.txt` plus a Growth wave in `tools/httpload.mjs`). Result in `evidence/http-results-rerun6.json`:

| Measure | Result |
|---|---|
| Every screen once, 4 roles | 437 ok, 96 refused (permission), 19 refused (input), **0 server errors** |
| 50 / 100 homes at once | 16 / 73 answered 503 busy, 0 server errors |
| Growth, one leader | 0.4 s (was 2.0 s on d4dbb81; see below) |
| Growth, 10 / 25 leaders at once | all answered, last in 1.8 s / 4.7 s |
| Site margin, one leader | 11.8-12.3 s |
| Site margin, 5 at once | all answered, last in 57 s (still slow, G2) |
| Company manager on Growth | 403, as designed |

   - **Why Growth slowed down.** Growth read the next 8 days of shifts with 8 JSON date filters. Under the company wall none of them can use an index, so each one read all 1.0 M shifts. It now makes one read for all visible companies with a date window, which brings one leader from 2.0 s to 0.4 s.
   - **Still open.** Site margin is still slow (G2). The lasting fix for JSON-field reads under the wall is the generated-column proposal in 5f.

## 5h. Arisha's retest of 34d130e (added 3 Nov, about 09:30Z)

Arisha found that the 5g change had a hole: a request beyond the 8 checks at once was counted as unverified **without** a check, and then AuthGuard checked it in full anyway. With a signed token and a limit of 2, 4 requests at once all got 200, and 610 got 608 through. So one person could pass their own limit, and overflow still cost a full check. Fixed:

1. **One check per request.** The limiter and AuthGuard now share one sign-in check per request (`signInCheck` in `apps/api/src/auth.ts`). AuthGuard never checks a second time, and the check logs only an error message, never a token.
2. **Overflow waits or is refused, never passes unchecked** (`apps/api/src/security.ts`). Per address, at most `RATE_IDENTIFY_CONCURRENCY` (8) checks run at once. Up to `RATE_IDENTIFY_QUEUE` (64) more wait their turn. Anything beyond is answered 429 before any check. Every request that goes on is counted as the verified person, or as the address's unverified count.
3. **Time limit on Microsoft's keys** (`apps/api/src/entra.ts`). A key fetch that does not answer within `ENTRA_KEYS_TIMEOUT_MS` (5 s) is aborted, and the 5-minute retry gap applies. The error says only "did not answer in time". Redirects are refused.

Tests (run on local PostgreSQL; all three whole-app tests fail on 34d130e and pass now):

| Test | Result |
|---|---|
| Whole app, signed Microsoft token, one request | 1 signature check, not 2 |
| Whole app, limit 2, 4 requests at once with the same signed token | 2 answered, 2 refused 429; 4 checks, none unchecked |
| Whole app, 10 forged tokens at once (2 running, 2 waiting) | 4 checked, 6 refused before checking, 2 more refused 429 by the unverified limit, 2 refused 401, none answered |
| Key endpoint that never answers (limit 30 ms in the test) | aborted, "did not answer in time", no second fetch within 5 minutes |
| Burst test from 5g, now with queueing | 1 key fetch, at most 2 checks at once, all 6 admitted requests checked |

Suites on this change: API 851 of 851 on local PostgreSQL, core 1184 of 1184, review tools 15 of 15, web typecheck clean. These are local results; CI is reported separately in the PR.

**Follow-up (4 Nov, about 00:55Z).** Arisha's retest of 5fa0831 passed every point above but found one more. With a cold key cache and a key fetch that timed out, five valid sign-ins at once got 503 for the first and 401 ("sign in again") for the other four. The four were waiting on the same fetch, swallowed its failure and then reported an unknown key. So during a Microsoft outage real staff would have been told to sign in again. This was not a bypass.

Fix (`microsoftKeys` in `apps/api/src/entra.ts`): a request waiting on another request's fetch now gets the same failure, "keys unavailable" (503), unless its key is already held. In that case it still works.

Tests (both fail on 5fa0831 and pass now):
- **Whole app:** five valid tokens on a cold cache with a key endpoint that never answers give one fetch and 503 for all five. Normal answers return once keys are available.
- **Key cache:** every waiter gets the same timeout or error-status failure. A known key still works for waiters while a refresh fails.

API suite: 853 of 853 on local PostgreSQL.

**Second follow-up (4 Nov, about 01:45Z).** Arisha's retest of 4f05a81 found two more cases where the answer was inconsistent:
1. An old key was cached and the refresh for a rotated key failed. The first request got 503, but the same new key then got 401 during the retry gap.
2. A known key had expired. The request that started the refresh failed, while the requests waiting on it succeeded.

The key cache now gives one rule, whether a request started the fetch, waited on it, or arrived in the retry gap after it:
- **A key Prima holds is used**, even while a refresh fails. The limit is 3 days after the last good fetch (`KEYS_STALE_MS`). **3 days is PROPOSED**: the build chose it, and Fauzan has not decided it. After that it is "unavailable", so an old key is not trusted for ever.
- **A key Prima does not hold** is "unknown" (401, sign in again) only if the last fetch succeeded. If the last fetch failed, it is "unavailable" (503, try again in a minute).

Tests in `apps/api/test/entra.test.ts`:
- Rotated key during an outage: the first request, its waiters and later requests in the gap are all unavailable, the old key still works, and recovery takes one fetch.
- Expired cache during an outage: the starter and its waiters get the same answer, and the 3-day stop works.

Both tests fail on 4f05a81. The 3 Nov test that expected "unknown" in the gap after a failure now expects "unavailable". API suite: 855 of 855 on local PostgreSQL.

## 6. Limits

- The 35 cloned companies copy the pilots' shapes, so numbers are realistic in volume, not in mix.
- The stress test ran on one local machine (one API process, 10 database connections, the default). Azure Container Apps sizing will differ, but the per-request database reads (7.7 M rows for one COO home) do not depend on the machine.
- The browser walk opened every screen but did not fill every form. Approvals and refusals are covered by the 2,008 automated tests, not by this walk.
- The phone width (390 px) was not repeated in this pass.
- GitHub CI has been running again since 23:58Z on 2 Nov, according to the coordination thread. I did not check the CI run for `d7d472d` itself.
