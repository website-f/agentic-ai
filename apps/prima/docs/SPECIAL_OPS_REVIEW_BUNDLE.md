# Special Ops, Asset Management and CMS: review bundle and handover (PR #53)

Prepared 2 Nov 2026, about 17:30Z, for Arisha main's combined review bundle (due Thursday 5 Nov 2026, morning MYT).

**Nothing here is approved.** Nothing is merged, migrated, installed or deployed. No rollout switch is on. WhatsApp
is OFF and not connected. No Azure, Meta or Entra resource was created. All test data is synthetic. Every database
result is from a disposable local PostgreSQL 16, never Azure. Browser results are from the local demo build
(browser-only data) and a local CMS process, not from staging.

## 1. Exact versions

| Item | Value |
|---|---|
| Branch | `claude/project-thread-2i31nr` (draft PR #53) |
| Base | `main` `0ead549c0f08f2feb2d75a6896f5c209452bd654` (merge base, same commit) |
| Reviewed at | `4007d85`, `e8fa96c` |
| Fix commits since review | `337242b` defects 1-6, WhatsApp, review screens; `ffa24b1` company arms requests, director-only legal points; `c23806a` packaging, catalogue check, shared savepoint fix; `268e382` guide cards in the shared shape, phone menu fix; `eeb62a8` CMS plans and close-dialog check; this document on top |
| Toolchain | Node 22.23.4, Vitest 4.1.12 (as declared in `packages/core`), TypeScript 5.8.3, PostgreSQL 16 |
| Combined SHA | Owned by the combined rehearsal in `/mnt/project-files/bundle/pr56-connect-departments-and-combined-rehearsal.md`. Its last rehearsal used #53 at `ffa24b1`; it needs a re-run with this branch's head. |

File hashes (sha256):

| File | sha256 |
|---|---|
| `db/migrations/001_init.sql` (unchanged from main) | `4b4cf4d3c67d0c5b09ca3c9592c74504a2c7335430dcffeccdd4f48710ed78fe` |
| `db/release-manifest.json` (unchanged from main) | `734f15d2d04be8e56f0ad7d562742d5a8760de9fb922b69d197c877c5f3ec3ab` |
| `db/modules/special-ops-v1.sql` (proposed add-on) | `429e6a832a36fd32125ad96534ed84b5b3b2156ea4b8a349831ee13fcf76b335` (3 Nov: wrapped in `BEGIN;`/`COMMIT;` for the single-transaction module installer; statements unchanged) |
| `db/proposed/special-ops-modules.json` | `2bbdecf96194164dc80a339a7cdcfb850463c99bcbaade26a64189363c7accdc` |
| `apps/api/src/special-ops-readiness.ts` | `7dbb9a6d6fdc6175cb9a81dcad48aa59f389dc43a5636ca8cca0492fd59d1997` (3 Nov: extra policies, inherited boundary, function configuration) |
| `apps/api/src/pg-store.ts` | `db86a0bd66051695a7939e2048905dd3875879686234e7e1a90e8b9f792de1e1` (savepoint release matches #56 `49d1a46`; whole-file hash differs from #56's because of other branch content) |
| `packages/core/src/special-ops-guide.ts` | `5ac7112e3504fa73fbf2ecb0343f05f3aeb5c7628b152524cb7c1bec712ff456` |
| `packages/core/src/rent-reminders.ts` | `785acfe4a73038ae9d6f33e6f5099ed9e4a39f0b9e8c82764e34c86975b4c08f` |
| `apps/cms/src/hub.ts` | `68d5fa2b5962fcf6f7605860888b9d48d8ea3b5245f7827e1ff6dc7615b57fa1` (3 Nov, §193/§195) |

## 2. Findings, fixes and tests

| # | Finding | Fix (commit) | Proof |
|---|---|---|---|
| 1 | Overlapping CMS flushes could drop a newly queued event | Single-flight flush; sent items removed by identity (`337242b`) | `apps/cms/test/cms.test.ts` "defect 1" |
| 2 | Event naming another site's device marked it online | Refused in the hub and in Prima's ingest (`337242b`) | cms.test.ts "defect 2" |
| 3 | INTRUSION sent as "info" skipped the Prima queue | Severity derived from the kind (`337242b`) | cms.test.ts "defect 3" |
| 4 | Item Prima refused in a 2xx answer was discarded | Kept, retried, parked after 5 and shown on the dashboard (`337242b`) | cms.test.ts "defect 4" |
| 5 | One alarm could create two cases | Stable alarm id; rows locked and re-read; resend is a duplicate (`337242b`) | core special-ops-4b-4h "defect 5"; PG test: two concurrent closes give one case |
| 6 | RM5,000 approval allowed an RM50,000 receipt | Receipt bound to the approved amount; reprice needs a new decision; decision bound to the amount seen (`337242b`) | core purchase test; PG test "review defect 6" (above-approved refused, reprice, stale decide refused) |
| UI | CMS close: Cancel meant "false alarm" | Explicit Real/False, required note, genuine Cancel (`337242b`) | Browser check 10/10 (§4) |
| UI | Returned drafts had no resubmit | Resubmit with reason and changes; company raise/authorise screen added (`337242b`, `ffa24b1`) | Core and PG tests (GM resubmits, CM refused); browser 16/16 |
| UI | Asset receiving had no action | Receive and "Ask again" on the Assets screen (`337242b`) | Browser 16/16 |
| WA | STOP ended reminders for the first unit only | STOP withdraws consent and cancels every unit of that number (`337242b`) | rent-reminders.test.ts multi-unit test; PG whatsapp.test.ts |
| WA | Concurrent duplicate delivery | Outbox rows claimed; stale claims released after 15 min; units locked in fixed order (`337242b`) | PG: two concurrent passes send one message; core claim-release test |
| WA | Stale amounts; per-unit caps | Amount worked out at send time; one message per tenant per day across units (`337242b`) | rent-reminders.test.ts "one message a day … today's balance" |
| Legal | Legal-only checks blocked staff (Fauzan, 2 Nov) | Police paperwork no longer blocks or alerts staff; directors see `specialOpsLegalFlags` with source, records, responsible director (assumed), open status, audit (`ffa24b1`) | Core: police paperwork never blocks; flags directors-only. PG: CEO reads, Arms Control and CM refused. Browser: CEO sees tab, Arms Control does not |
| Pack | Add-on outside the manifest | Packaging proposal and catalogue check (`c23806a`; widened 3 Nov, R3-1) | `special-ops-packaging.test.ts` 9 tests: missing on base, clean after install and reinstall, drift reported, unexpected policies, inherited boundary changes and function configuration reported, permissions checked |
| Shared | Savepoint left behind after a failed nested unit | RELEASE after ROLLBACK TO (#56 `49d1a46`, taken in `c23806a`) | Full API suite on PG |
| Guide | Section A guide cards | 12 cards in the shared GuideCardSpec shape, BM first, desks or record keepers only, `allowed` uses the server rule (`268e382`) | `special-ops-guide.test.ts` 3 tests; browser card opens |

### Round 2 (Arisha main re-check of `337242b`, 16:16Z)

None of these was covered by `4caa380`; all fixed in the commit after it.

| # | Finding | Fix | Proof |
|---|---|---|---|
| R2-1 | A malformed HTTP 200 answer cleared the CMS queue | Prima now answers `received: {events, closedAlarms}`; the CMS app treats a 2xx as an acknowledgement only if both counts match and every refusal names a list and matches an item sent (id wins; id and index must agree). Anything else keeps the whole batch | cms.test.ts "round 2" (9 malformed bodies plus unreadable JSON keep the queue, nothing parked; a valid one clears it). CMS 46/46 |
| R2-2 | WhatsApp one-a-day cap failed across units | The cap is per number across every unit with reminders, counting sends today, claims in flight and uncertain sends claimed today (before, a unit already messaged with nothing waiting was left out) | rent-reminders.test.ts "one-a-day limit holds across units" (fails on the old code) |
| R2-3 | An expired uncertain claim could be resent | New status `uncertain`: a claim with no result after 15 min, a timeout, a 5xx or a 2xx without a message id. Never resent automatically. Only a clear 4xx refusal is retried. The Asset team settles it (It went / Send again / Leave it) with what they checked; audited. A late clear result still settles it | Core: "claim … becomes uncertain" (fails on old code) and "unclear answer … team settles"; API: `sendOne` classification; PG: timeout not resent, WhatsApp sign-in and FD refused, team resend then one send |
| R2-4 | Early close accepted silently when events were absent | A close naming any event Prima has not got is refused by id ("events not received yet: …"), so the CMS app retries it and parks it after 5 if they never come | Core "round 2: a close naming events …"; PG test with `received` counts |
| R2-5 | Receipt implied an inspection via boughtOn | Receipt no longer sets `lastCheckedOn` (stays "never" until a real check); purchase date must be a real calendar date | Core purchase test (impossible date refused, `lastCheckedOn` null); PG defect-6 test extended |
| CI | `synthetic-browser` red on run 41476635536 | Not this PR's code: `it-corrections-browser-smoke.mjs` (IT pilot screen, unchanged here) timed out on "Review descriptive correction" right after Vite logged "Re-optimizing dependencies", which reloads the page mid-test. The push run on the same SHA (41476627091) passed every job, including synthetic-browser. Locally at the new head: all 16 synthetic-browser scripts pass, and this one 5 of 5 times. A clean CI run on the exact head is blocked: Actions jobs get no runner (§3) | Local runs; push run link |

Remaining gap: the WhatsApp "settle" buttons are checked by core and PostgreSQL tests and the web typecheck, not yet in a browser run.

### Round 3 (Arisha main verified `3c4e151`, 00:50Z; catalogue item from her 22:55Z email)

Round-2 residuals 1-5 verified fixed by Arisha main; CI on `3c4e151` passed all 8 jobs.

| # | Finding | Fix | Proof |
|---|---|---|---|
| R3-1 | The catalogue check missed unexpected permissive policies and inherited boundary/function checks | `specialOpsModuleProblems` now also reports: any policy on the 14 walled tables other than `arms_wall`, `company_wall` (arms tables) or `dept_wall` (`SPECIAL_OPS_UNEXPECTED_POLICY:<table>.<policy> (permissive)`); a changed base `company_wall` (must stay permissive, all commands, everyone, `company_id = ANY (prima.visible_companies())` both ways); `prima.has_wall` / `prima.visible_companies` with a different body, SECURITY DEFINER, or owned by a role prima_app can act as; a walled table owned by prima_app or a role it belongs to; prima_app inheriting (directly or through other roles) a superuser or BYPASSRLS role; CREATE on schema `prima` granted to prima_app | `special-ops-packaging.test.ts` 8/8 on throwaway PostgreSQL 16: extra permissive policy on `firearms` and `cms_staff`, an extra restrictive policy, a widened `company_wall`, `has_wall` returning true, `visible_companies` as definer, a table owned by prima_app, a BYPASSRLS role inherited through a middle role, and schema CREATE are each reported; after restoring, the list is empty again. API 712/712 |

| R3-2 | Arisha main 03:12Z on `6defaa9`: false green, `pg_proc.proconfig` not attested. A `has_wall` with its own `app.walls` setting overrides the caller while the body still matches | Approved configuration for `has_wall` and `visible_companies` is **none**: any function-level setting is `SPECIAL_OPS_FUNCTION_CONFIG:<name>`. They must also stay STABLE SQL functions (`SPECIAL_OPS_FUNCTION_KIND:<name>`) | Isolated PostgreSQL test: proves `has_wall('arms')` turns true for a caller with no walls once `ALTER FUNCTION ... SET app.walls` is applied, then that the check reports it while reporting no body change; same for a `search_path` set on `visible_companies` and a VOLATILE `has_wall`; clean after reset. The new test fails on the `6defaa9` checker and passes now |
| R3-3 | Arisha main 03:32Z (pinned `6defaa9`): a heartbeat a year ahead counted as "within 24 hours" | CMS activation counts a heartbeat or CMS test alarm only when its age is 0 to 24 hours; a future time never counts. The CMS app also treats a saved heartbeat later than the restart as Unknown | Core regression test (one year ahead, one minute ahead, a future test alarm; edges now and exactly 24 h ago still count) fails on the old code and passes now; CMS restart test with a future heartbeat |
| R3-4 | Commissioning does not establish signed service scope, operator/client acceptance or verified contacts | Labelled honestly: the item is now "CMS activation (technical)"; the contract screen and the code say it does not confirm a signed CMS service scope, client or operator acceptance, or verified phone numbers. Since built (Fauzan "proceed work", 3 Nov 04:07Z): see "CMS commissioning" below | Browser check at 1280/390 finds the new label |
| R3-5 | Coverage counters do not prove contracted post-minutes or recording integrity | Labelled honestly on the Prima CMS board and the CMS app dashboard: last reported states and alarm handling times only; not contracted post-minutes covered or recording integrity. Contracted minutes since built (below); recording integrity still not measured | Browser checks at 1280/390 |
| R3-6 | Combined candidate's single-transaction module installer (release thread, step R14) | `db/modules/special-ops-v1.sql` wrapped in `BEGIN;`/`COMMIT;` (statements unchanged); hash re-pinned in `db/proposed/special-ops-modules.json` | Packaging tests: install twice on throwaway PostgreSQL, clean both times |

How to count the fixture suite (Arisha main): the packaging tests are clean/detection checks on a throwaway database
plus one characterisation of the proconfig gap (the step that shows the override works), not separate security passes.

Still open: CMS database store, Entra operator identity and real-device acceptance (file persistence is built, below,
but is none of these); real role and provider browser acceptance (needs staging and real accounts; the browser runs
here use the demo build).

### Masterplan items built 3 Nov 2026 (Fauzan: "Yes build all not build")

Ledger rows from `/mnt/project-files/reviews/masterplan-subsection-ledger-2026-11-03.md`. Draft only, synthetic data.

| § | What was missing | Built | Proof |
|---|---|---|---|
| 191 | No CMS activation step in client onboarding | New mobilisation workstream **W12 CMS activation**, added last so earlier item ids do not change. It cannot be ticked by hand: Prima refuses "done" until every contract site has a CCTV or alarm panel linked and tested, CMS has heard from it in the last 24 hours (heartbeat, or a test alarm from the CMS app), and CMS has a site supervisor, the company manager and a Regional OM to call. Not critical: the company manager may risk-accept it with a reason and a date (a site with no CMS equipment yet). The contract screen says what Prima checks | Core `cms-masterplan.test.ts` (no site, nothing linked, silent >24 h, test alarm counts, no supervisor, no Regional OM, risk acceptance roles); PostgreSQL: the check under the company wall finds the company's own manager, another company cannot read the contract; browser at 1280/390: refusal shown on the item (evidence `/mnt/project-files/bundle/pr53-uat/masterplan-2026-11-03/`) |
| 193 | Before 3 Nov: CMS state held only in memory, plan only. Now: file persistence (this row); still not the planned database store, Entra operator identity or real-device acceptance | Saved state folder (`CMS_STATE_DIR`): atomic state file, append-only audit journal, one-hub lock, 2xx only after the save (503 if it fails), DC-09 ACK after the save, restart keeps open alarms, outbox, retry counts and watchers, reminders missed in an outage fire once, stale heartbeats show Unknown. No database, provider or hosting change. Details: `docs/CMS_DURABILITY_AND_OPERATOR_SIGN_IN_PLAN.md` §2A | 12 new CMS tests (see the plan); real-process check: a second hub on the same folder refuses to start; SIGTERM saves and releases; browser `scripts/cms-restart-uat.cjs` 5/5 at 1280/390 |
| 195 | No CMS response KPIs | CMS app: `GET /api/kpis` and a dashboard section (acknowledge/act/close median and 90%, over target, waiting over target now, false rate, repeats, devices online/offline/unknown, gaps, outbox, by severity and company; targets PROPOSED: acknowledge 2/5/15 min, act 10/20/60 min). Prima CMS board, Sites tab: "Response and coverage, last 24 hours" from Prima's own alarm records against the existing CMS setting (acknowledge within N s), linked systems online/offline/unknown, sites not linked, by company; same access as the CMS board | CMS KPI tests (exact figures, operator-only route, bad period refused); core exact-figure test and board test; PostgreSQL board test (HR refused); browser at 1280/390 |

| 191 (commissioning) | W12 checked only the technical link; no signed CMS service scope, verified contacts, acceptance or contracted minutes (R3-4, R3-5) | **Signed scope** (company manager): contract sites with Malaysia-time monitoring hours (past midnight allowed, `24:00` end), services (CCTV, alarm response, attendance watch, patrol watch), the signed document reference, client signatory and real signing date (not future). Recording it lists CMS's call-out contacts (supervisor per site, company manager, Regional OM by the region's monitoring grant) and restarts every check; a done W12 reopens. **Contacts verified** by a CMS desk user after a test call, with a note; nobody verifies their own number. **Operator acceptance** by Arms Control only, with a reason, after every contact is verified and the technical check passes; the person who recorded the scope cannot accept it. **Client acceptance** recorded by the company manager after CMS accepts (client name and their written acceptance reference). W12 "done" now needs all of these plus the technical check, and contacts unchanged since signing. Version-bound, locked, audited (`contract.cms_service`). **Contracted minutes**: Prima records outage edges from the CMS app's DEVICE_OFFLINE/ONLINE events and the CMS board shows signed minutes, minutes with the CMS link up, down and unknown (never heard from = unknown, never covered; future times ignored), plus contracts without a signed scope. Routes: `POST contracts/:id/cms-service`, `.../contacts/:index/verify`, `.../accept/operator|client`, `GET cms/commissioning`; screens: contract drawer "CMS service" panel and CMS "Commissioning" tab | Core `cms-commissioning.test.ts` 13/13 (validation, roles, no self-verify, stale version, order of steps, recorder cannot accept, technical gate, contacts changed, reopening W12, midnight/whole-day/office windows, all-systems-down rule, unknown, future, open outage, outage edges from the CMS feed, board figures); PostgreSQL `cms-commissioning.test.ts` (manager records under the company wall, company staff/another company/HR cannot verify, CMS desk verifies under its walls, CMS desk cannot accept, stale version refused, audit rows); browser 4/4 at 1280 and 390 px (manager records scope after a refused empty date, CMS desk verifies by test call and has no Accept button, Arms Control sees Accept). Found and fixed on the way: the §191 check looked for a Regional OM only by direct company assignment; Regional OMs cover companies through the region's monitoring grant, so under the database walls it wrongly reported "no Regional OM" |

**Round 4 (Arisha main on `2bdb7d4`, 05:24Z).** Commissioning stages passed; four coverage and scope defects, fixed:

| # | Finding | Fix | Proof |
|---|---|---|---|
| R4-1 | An Unknown system last heard in January counted as reachable for every October minute | Coverage is built only from observations, in time order (`observe`, `timeline` in `cms-commissioning.ts`). An up observation is evidence for 15 minutes (decided, Fauzan 3 Nov 07:42Z); the CMS app now sends a device status snapshot every 5 minutes (`statusForPrima`, online only while heard within the device's silent window). Time no observation speaks for is Unknown, never reachable | Core regression: January report gives 0 reachable, 1,440 unknown for an October day; reports that stop turn Unknown after 15 minutes; CMS test: snapshot sent with nothing else queued, a device past its silent window is unknown |
| R4-2 | A first heartbeat at 23:59 credited the whole preceding day | Nothing before the first observation is counted | Core regression: 1 reachable minute, 1,439 unknown |
| R4-3 | OFF 01:00, ON 02:00, then a late OFF stamped 01:30 gave 1,410 down minutes | Observations are placed by their own time, whatever order they arrive in; the shown status follows the newest observation, so a late edge never overwrites it | Core regression: 60 down minutes in all three arrival orders; ingest test: late OFF keeps the system online |
| R4-4 | Alarm and patrol scope could reach Commissioned with only CCTV linked | Each signed service needs its equipment linked at every scoped site (CCTV, alarm panel) and an acceptance test per service and site, recorded by the CMS desk: CCTV needs an up report from the CMS app in the last 24 hours; alarm needs an acknowledged CMS alarm from that site's panel in the last 24 hours (camera, unacknowledged or future alarms do not count); attendance and patrol run in the JA app, so the operator attests them and Prima labels them "operator attested". Arms Control cannot accept until every test is in; a new scope clears them | Core: CCTV-only site refused for alarm, acceptance names the missing panel and the missing patrol test; old/future CCTV reports refused; PostgreSQL: company staff cannot record a test, the CMS link's status snapshot under its walls makes the CCTV test pass; browser 4/4 at 1280/390 px (CCTV test refused in the demo, which has no CMS report) |

Results at this round: core 752/752, API on PostgreSQL 16 715/715, CMS 60/60, 13 CI script suites, web typecheck and builds.

Limits: contracted minutes measure CMS evidence that a site's linked systems were up (status snapshots every 5 minutes, each good for 15; decided, Fauzan 3 Nov 07:42Z), not guards on post, recording integrity or
camera view quality. The scope's signed document is referenced, not uploaded. Client acceptance is recorded by the
company manager from the client's written acceptance; Prima does not contact the client.

Open after these: KPI targets and keep periods are proposals for Arms Control and Fauzan; a database store (§2B) and
Entra operator sign-in remain plan only; hosting the CMS app needs a persistent volume and approval.

## 3. Test results at `eeb62a8`

| Suite | Result | Where |
|---|---|---|
| Core | 723 / 723 | Vitest 4.1.12, in memory |
| API | 705 / 705 | node --test against local PostgreSQL 16 with RLS and the add-on installed in the test DB |
| CMS app | 45 / 45 | node --test, in memory |
| CI script suites | 13 suites, 0 failures | local |
| Web | typecheck clean; server build and demo build pass | local |
| npm audit (production, high) | 0 | local |

**CI (update 3 Nov 2026, 00:20Z):** after the owner raised the Actions budget, both runs on `3c4e151` re-ran green:
[push 41543631153](https://github.com/fauzan4377/prima-secure-app/actions/runs/41543631153) and
[pull request 41543640063](https://github.com/fauzan4377/prima-secure-app/actions/runs/41543640063). The masterplan
commit on top needs its own runs.

**CI (as of 2 Nov):** the last green runs are on `337242b` ([push run 41476627091](https://github.com/fauzan4377/prima-secure-app/actions/runs/41476627091)). Every run since `ffa24b1` fails in 2-5 seconds with no runner assigned (for example [run 41488641493](https://github.com/fauzan4377/prima-secure-app/actions/runs/41488641493)). The same happens on #49, #51, #55 and #56, so it is not a code result. Likely cause (unconfirmed): GitHub Actions minutes or spending limit on the account. **No green CI link exists for the current head until the owner checks Actions billing.**

## 4. Browser UAT (synthetic, local)

| Run | Steps | Result | Evidence |
|---|---|---|---|
| Prima demo build, 1280 px | 16 | 16 pass | `/mnt/project-files/bundle/pr53-uat/shots-final-1280/`, `final1280.log` |
| Prima demo build, 390 px (phone) | 16 | 16 pass | `/mnt/project-files/bundle/pr53-uat/shots-final-390/`, `final390.log` |
| CMS operator dashboard | 10 | 10 pass | `/mnt/project-files/bundle/pr53-uat/cms-close/` |

Prima steps by role: Company GM raises an arms request (entry) and opens the guide card; Arms Control assistant cannot
send back without a reason, then sends back (review, return, rejection without reason); Company Manager has no
resubmit (authorization denial); GM sees why, corrects and resubmits (edit, retry); Arms Control passes; CM authorises
with a reason; Finance Director has no Arms menu (denial); Arms Control has no legal tab, CEO sees it (denial);
Asset team asks RM5,000; self-approval refused by the server (denial); FD approves; receipt at RM6,000 blocked, "Ask
again" used (rejection, retry); FD re-approves, team receives; GM has no Asset menu (denial); no page errors.

CMS steps: wrong operator key refused; Cancel keeps the alarm open; close without real/false is not sent; Escape keeps
it open; close without a note is not sent; false alarm closes with its note; real alarm closes; both closes wait in
the outbox; operator closes are audited; no page errors.

Scripts: `scripts/special-ops-browser-uat.cjs`, `scripts/cms-close-dialog-uat.cjs` (local only, not in CI).

**Not covered by the browser runs:** the API-backed web app against PostgreSQL (the demo build keeps data in the
browser), WhatsApp screens with a real provider, M365/Entra sign-in. A successful sign-in is not workflow acceptance.

## 5. Installation boundaries

- Base schema and manifest unchanged from main. One proposed add-on: `db/modules/special-ops-v1.sql`, described in
  `db/proposed/special-ops-modules.json` (install after the five manifest modules, repeat-safe, rollback written but
  not run). Not in the manifest. Not installed anywhere.
- Rollout key `special_ops` stays out of `PRIMA_ROLLOUTS`. Arms trading stays off (CEO-only switch).
- Feed keys (`CMS_FEED_*`, `TRACKER_FEED_*`, `AM_FEED_*`) and `WHATSAPP_*` are not set anywhere.
- CMS app: saved state folder on its own disk (3 Nov, §193); operator keys are a stop-gap; database store and Entra
  sign-in are plan only (`docs/CMS_DURABILITY_AND_OPERATOR_SIGN_IN_PLAN.md`).

## 6. Remaining inputs (owner decisions)

1. WhatsApp reminder days (proposed: 3 days before, due day, 7 days late, every 10 days to 90). Due day 1st is confirmed.
2. WhatsApp Business connection by an owner (Meta account, templates, `WHATSAPP_*`), then switch on.
3. CMS thresholds marked PROPOSED in `apps/cms/README.md` (15 min move-up, 15 min clock-in grace, 90 km/h, ANPR 0.8,
   repeat intervals); driver-hour limits (proposed).
4. DECIDED (Fauzan, 2 Nov 2026 23:08Z, "Left it unchange"): the arms request `legal_check` step (PWVSB Legal, for
   transfer, disposal, trade) and the PDRM/KDN `regulator_pending` step stay as approval stages.
5. Responsible director for legal flags is assumed "COO (armed operations)"; owner to confirm.
6. CMS durability (database for CMS, retention) and operator sign-in (Entra app registration, MFA policy, shift grace,
   break-glass). Plan only.
7. Open from 4A: database wall on vehicle positions.
8. Install of the add-on module and the rollout switch, both by an authorized owner.

## 7. Flagged for Thursday

- **CI links:** green on `3c4e151` after the budget change (section 3); the masterplan commit needs its own runs.
- **Combined SHA:** needs the combined rehearsal re-run with this head.
- Everything else in this list is done on the branch, with the limits stated above.
