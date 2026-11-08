# Cleaning planner, site stock and fittings, guard duty plans

Status: draft PR only. Nothing here is merged, migrated or deployed. All names in the demo are synthetic.

Owner requests (Fauzan, 4 Nov 2026):

- OMs who manage or monitor cleaning get a daily roster and a minute-by-minute plan for every cleaner and supervisor, built from the client's scope.
- The OM uploads the site map and the size of each area.
- Gov Ops (OGM) monitors cleaning.
- Supplies and equipment are planned and monitored, with no over-use and no under-giving.
- Supervisors and cleaners do not sign in yet. The OM uploads the supervisor's time-marked photos, and an ordinary photo is not accepted.
- The OM who covers the site publishes. The company manager can only view.
- Guards and patrolling officers get the same kind of planner. Their work runs in the JA app or another app; Prima publishes the plan, and that app sends back a monthly report.
- Inventory monitors every site, including guard uniforms.
- Site fittings (chairs, tables, fans, guard post, CCTV) are planned and monitored.
- At contract end everything is taken back. The exceptions are items the contract hands over and items management decides to give. Management means the COO or CEO, confirmed by Fauzan on 4 Nov 2026.

## Not needed today (Fauzan, 4 Nov 2026)

A planned job may not be needed on the day, for example the drains are already clean. The OM marks that job **Not needed today** with the supervisor's reason and a time-stamp photo of the area. The rule allows this only on today's planned work, never on a job already done. The rest of the day is planned again at once from the current time: the freed time goes to other due work, and every done, checked and missed record is kept. The monthly report counts these jobs separately from missed work.

## Client slips and the monthly acknowledgement (Fauzan, 4 Nov 2026)

- **Cleaning slip.** Some jobs need the client's signed slip saying the work was done properly, for example the school's slip for grass cutting. The OM ticks "Client slip needed" on those areas. The KPM template ticks grass cutting and hedges. The OM uploads the slip (photo or scan, JPEG, PNG or PDF, under 2 MB, each file used once) under **Client slips**. With it the OM records who signed, the days of work covered, whether the client accepted the work, and the comment copied from the slip. A slip that does not accept the work needs the comment and what will be done. Those days stay open until the work is redone and a new slip is signed. The board shows how many work days are waiting for a slip; the monthly report lists every slip with its comment.
- **Every client, every month.** For all operations (guards and cleaning), the OM or the company uploads the client's signed acknowledgement of the month's work (a slip or the signed paper) by the 10th after the month closes. The upload records who signed, the date, whether the client was satisfied, and the client's comment on the work. If the slip has no comment, the OM writes "No comment written". A complaint needs what will be done. The client board flags a missing acknowledgement as "to upload" up to the 10th and in red after it, and flags a complaint. This sits beside the existing invoice proof (by hand, by email and the client's system).

## Guard contract terms (from the KPM SST Fauzan shared, 4 Nov 2026)

The OM enters each guarded site's terms on the guard duty screen: contract reference, rate per guard-hour (KHS), the shifts and guards each needs, the least number of guard tour points, how often the patrolling officer must visit, and when the daily report is due. "Use the KPM school contract" fills two 12-hour shifts (08:00 to 20:00 and 20:00 to 08:00), 4 points, a weekly visit and a report by 09:00. Nothing is filled for the rate; the OM enters it from the contract.

- The plan checks the roster against the terms for each shift and shows the deduction a gap would bring: KHS × guards missing × hours (Jadual 6 item 1). It also shows the month's price (KHS × guard-hours a day × 30.5) and the cost of one missed clocking (20% × KHS). For the shared contract that is RM12.61 per guard-hour, RM9,230.52 a month per premise, and RM2.52 per missed clocking.
- The plan warns when the site has fewer guard tour points than the contract needs. When one guard works a shift alone, it reminds the OM that patrol frequency is agreed with the premise administrator. Rounds say to visit the points in a different order each time, because the contract asks for a random pattern. The day shift gets a "daily report for the premise administrator" task.
- On the officer route, a site whose contract visit is due (for example weekly) goes first. If it does not fit in the officer's hours, the route says so.
- Fittings: "Add KPM guard equipment" adds the contract's list: guard tour points, the device, walkie-talkies (none for a lone guard), baton, whistle, raincoat, torch, first aid kit and the emergency numbers board.
- The monthly return (version 2) also asks for each checkpoint tap, guards present against the contract, the daily report hand-over time, guard tour system downtime with the fallback used, and equipment fault and fix times.
- **Our rules apply; clashes are flagged** (Fauzan, 4 Nov 2026: "Follow our ruling. Then flag if contract and our rule collide"). The terms also hold what the contract says about the guards: oldest age, CSG within N months, KDN vetting within N working days, urine test within N days, Malaysians only, and the most related guards. "KPM contract rules" fills 65, 6 months, 60 working days, 14 days, Malaysians only and 2. The screen lists every point where the contract and our rules differ and what it means at the site. Rostered guards who meet our rules but break the contract's (for example a Nepali guard on a Malaysians-only contract, or no CSG 6 months after joining) are flagged on the plan, never blocked.
- The deduction list (Lampiran A3) is shown on the screen as an estimate only; the client decides the deduction.

## Who can do what (enforced in `packages/core/src/cleaning-service.ts`)

| Person | Cleaning plans | Site stock and fittings | Guard duty plans |
|---|---|---|---|
| OM / Regional OM (sites they cover) | Set up, map, plan, publish, record | Record fittings, stock and take back | Publish post plans and officer routes |
| OGM (Gov Ops) | Monitors every cleaning site; manages the government sites it covers | Sees all | Same as cleaning |
| Operations Director, COO, group leaders, ACT head | View | View | View |
| Procurement and Inventory | View | View all sites, including guard uniforms | – |
| Company manager, admin executives | View their own company | – | View |
| COO / CEO (or group director) | – | Approve giving an item at contract end, with a reason | – |

## Rules (Fauzan's answers, 4 Nov 2026)

| Rule | Value | Where |
|---|---|---|
| CLEAN-RATES | Approved. Default work rate per person per hour, e.g. toilets 10 cubicles, sweep 400 m², mop 250 m², grass cut 300 m², hedge 40 m, drains 60 m. The OM can override each area. | `CLEANING_DEFAULT_RATE` |
| Planner timing | Approved as defaults: briefing 10 min, moving between areas 5 min, big jobs split into parts of up to 90 min, supervisor check 5 min, rounds every 120 min (15 min each), report 15 min, breaks taken in turns from 12:00. The OM can change each one per site ("Planner timings for this site"). | `CLEANING_RULES`, `CleaningSite.timings` |
| Deduction estimate | Monthly wage ÷ 30.5 × missing workers (KPM contract) | `CLEANING_RULES.deductionDays` |
| CLEAN-STOCK | Set by Fauzan: above 100% of budget is over-use; below 50% is under-use or under-giving. Reorder when stock covers fewer than 7 working days (proposed). Receiving less than was sent is a short delivery. | `CLEANING_STOCK_RULES` |
| CLEAN-PROOF | The photo must be under 700 KB and the map under 2 MB. The time the OM reads off the photo must be on the same day. It is compared with the camera time in the file, with a 10-minute tolerance. A photo can be used only once, anywhere. A photo without camera time (e.g. sent by WhatsApp) is accepted and labelled; the screen tells the OM to have supervisors send time-stamp photos by email. | `RULES.cleaningProof`, `cleaning-proof.ts` |
| SITE-KIT-CHECK | Approved. Each site's fittings are checked monthly; a check is due after 31 days | `SITE_KIT_CHECK_DAYS` |
| DUTY_RULES | Guard timings approved. Handover 10 min. First round 30 min into the shift, then every site's patrol interval. A 30-minute meal break after about half the shift. A log entry every 4 h. Officer visits take 45, 30 or 20 min by site risk, with driving at 40 km/h. Officer hours are flexible (day or night): the OM sets start, end and meal break per day; 08:00–17:00 is only the starting value. At most 14 hours; an end earlier than the start runs past midnight. | `security-plan.ts` |

## Monthly return from the JA app (or other app)

The specs are `CLEANING_MONTHLY_RETURN` (cleaning-service.ts) and `SECURITY_MONTHLY_RETURN` (security-plan.ts). Both screens show them as well.

The app reports against Prima's published task ids. For each task it gives done, checked, redo or missed, with the times. It also sends:

- Headcount: who was present and who was absent.
- The time-marked photo for each check.
- Stock counts and deliveries.
- For guards: rounds, clock times and meal breaks.
- For officers: visits with GPS and photos, plus any site not visited.

## Database module

The tables are `cleaning_sites`, `cleaning_days`, `cleaning_stock` (deliveries, stock checks and client slips), `site_kits`, `duty_plans` and `guard_terms`, in `db/modules/cleaning-ops-v1.sql`. Each has a company wall (RLS), and nothing can be deleted. The module is optional. Until it is applied through an authorized migration, reads come back empty and writes are refused with "not installed". The PostgreSQL test is `apps/api/test/cleaning-ops-pg.test.ts`.

## Installing the database module (prepared; run only with Fauzan's go-ahead)

Fauzan approved preparing this on 4 Nov 2026. Nothing has been run against staging or production.

1. Merge PR #69 first.
2. Check the file is the reviewed one: `sha256sum db/modules/cleaning-ops-v1.sql` must print `4209f5a718d6ec74e7ff39a1caad25873463c972a1467b8b2a952a337730ac05`.
3. Run it once inside one transaction as the migration owner, after the base schema: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f db/modules/cleaning-ops-v1.sql`. It is safe to run twice (it creates only what is missing) and changes no existing table.
4. Check: the API's cleaning screens stop saying "not installed"; `apps/api/test/cleaning-ops-pg.test.ts` shows the company wall and refusals.
5. Adding the module to the signed release list (`db/release-manifest.json` and the release catalog) is the release owner's step when the next release is assembled, the same as earlier modules.

Last local run: PostgreSQL 16, `cleaning-ops-pg.test.ts` passed (4 Nov 2026, with guard terms and a client slip).

## Not done / open


- Supervisors and cleaners have no sign-in (by decision). The OM records for them.
- There is no live link to the JA app yet. The return specs are what that app must send.
- Reorder at 7 days left is still a proposal; the other numbers are Fauzan's answers.
- The written spec for the JA team is not needed yet (Fauzan, 4 Nov 2026); the return lists are in the code and on the screens.
- A photo shrunk by WhatsApp loses its camera time. It is still accepted when the printed time is on the right day, but it is labelled "Camera time removed" so reviewers can see it.
