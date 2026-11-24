# Special Operations, Phase 4

Department order (Fauzan, 28 Oct 2026): IT > Finance > HR > **Special Ops** > Central Admin > Nationwide Ops.

Plan (Claude Doc): https://claude.ai/artifact/BRxfC3siKYUUmNyhUVJktT. It is based on masterplan sections 11 (CMS) and 12 (Arms Control), the Arms Act 1960, KDN Circulars 1/2006 and 1/2010, and the Private Agencies (Amendment) Act 2025.

## Scope (Fauzan, 1 Nov 2026)

- **In scope:**
  - Arms Control, including armed jobs: CIT, CDM, cash vaulting and bodyguards.
  - The 24/7 CMS command centre.
  - Company vehicles (Transport).
  - Asset Management (slice 4G).
- **Moved elsewhere:** credit goes to Central Admin (Phase 5). Hostels stay with FWM.

## Slices

| Slice | What | State |
| --- | --- | --- |
| 4A | Foundation: Special Ops switch, arms and CMS database walls, grant fix, foreign guards never armed | **Built, draft PR** |
| 4B | Complete arms register: ammunition, book check, vault watch, missing or deposited, police notices, range, 30 June renewals | **Built, draft PR** |
| 4C | Arms requests, all 10 steps, and the arms supplier file (foreign suppliers, local agent, papers) | **Built, draft PR** |
| 4D | Armed jobs readiness (no-go check) and the bank CIT tender pack | **Built, draft PR** |
| 4E | Prima's signed CMS event endpoint and directory for `apps/cms`; CMS seat clock-in | **Built, draft PR** (CMS app pulls the directory) |
| 4F | Transport: signed tracker feed, trips, JPJ-style driver hours, trips board | **Built, draft PR** (database wall on positions still open) |
| 4G | Asset Management: signed feed from the developer's system, rent check, furniture purchases | **Built, draft PR** |
| 4H | Arms trading and import: built, switched OFF until the CEO starts it | **Built, OFF, draft PR** |

## Arms import: what the law says (desk research, 2 Nov 2026; to be confirmed with PDRM and KDN)

Source: Arms Act 1960, unofficial MOHA text as at 4 July 2023.
- **s.15:** an **import licence** is needed for every import of arms, ammunition or parts. It comes from the Chief Police Officer (CPO) of any state; a manufacturer applies to the Minister. After the licence term ends, the holder endorses on it what was imported and returns it to the OCPD within 3 days. Fee RM10 (Second Schedule).
- **s.16:** if the import is for trade, the case is marked "Firearms" or "Ammunition", and the proper customs officer is told before arrival.
- **s.17:** the consignee declares the goods and shows the import licence on arrival.
- **s.18:** a landing or transhipment permit from a CPO, for the ship or aircraft.
- **s.19:** an export licence from a CPO is needed, for example to send arms back to the supplier for repair.
- **s.20 and s.21:** the Minister may limit imports to certain ports, or ban them except with a special permit.
- **s.23:** up to 7 years, RM10,000, or both, for importing or exporting without a licence.
- **s.6(2)(d):** a licensed importer may carry the goods while importing them without an arms licence.
- Customs (Prohibition of Imports) Order 2023, HS 9301 to 9306: arms imports are restricted, and PDRM licenses them (WTO notification).

The system would record, for each order: the CPO import licence, notice to customs, the declaration on arrival, the endorsed licence returned within 3 days (with a reminder), the end-user certificate, and the exporter's licence.

**Fauzan's answers (2 Nov 2026):**
1. The group is applying for a licence to import and sell arms. Importing sits with arms trading (4H) and stays OFF until that licence is approved and the CEO gives go-live.
2. KDN approves the import itself, after the CPO (Fauzan, 2 Nov 2026: "Import it self. After cpo. The paper will need kdn approvals"). Every import order follows this order: CPO import licence, then KDN approval of the papers, then shipping. The goods cannot be shipped without both, and the KDN step cannot be recorded before the CPO licence.
3. The buyer who gets police approval holds the end-user certificate. The system checks that the buyer's police approval and end-user certificate are on file before a sale goes ahead.
4. Ports: Port Klang and KLIA only. An import order must name one of them.
5. Approval time depends on the police district, so the system records each district's actual times instead of fixing one.

## Slice 4A: what changed

**Switch: the shared rollout list, key `special_ops`** (`PRIMA_ROLLOUTS=special_ops`; the older `SPECIAL_OPS_ROLLOUT=true` still works).
- While the IT pilot rule is on, this lets Arms Control, CMS and Transport staff sign in. `inSpecialOpsRollout` lives in `packages/core/src/special-ops.ts`, which registers it with the shared switch (`registerRollout`, `packages/core/src/rollouts.ts`, from the "Connect departments" work). `apps/api/src/auth.ts` is the shared version, so HR, Central Admin and Special Ops no longer collide there.
- It is off by default, so the IT pilot is unchanged.
- Company arms staff at the pilot company, Jayapadu Bersatu Kawalan Sdn Bhd, come in a later slice.

**Arms wall (`app.walls` value `arms`).**
- It is a RESTRICTIVE policy on top of the company wall. It covers these tables: vaults, firearms, arms_movements, armed_jobs, dealer_licences, vault_watches, vault_events, ammo_stocks, arms_agreements and arms_requests.
- Arms suppliers and supplier items, which are group-wide tables, get the same wall.
- Who holds it (`holdsArmsWall`):
  - group users who see arms detail: Arms Control, CMS, the COO, the CEO, the Chairman, the Vice Chairman, the ACT head and directors;
  - company managers and supervisors.
- Who does not: the Finance Director, the Chief of Staff, HR, IT, PDPA, Transport, admin executives and system feeds.

**CMS wall (`cms`).**
- It covers the cms_staff and cms_shifts tables.
- The same group arms viewers hold it.

**Grant fix.** Arms suppliers, supplier items and CMS staff were SELECT-only for `prima_app`, so their forms could not save on PostgreSQL. They now have INSERT and UPDATE.

**Insurance.**
- The Chief of Staff's insurance section no longer reads arms rows. It says armed and cash-in-transit cover is checked on the Arms Control board (`armedCoverOnArmsBoard`).
- The Arms Control board now raises **No cover** when a company holds firearms, or runs CIT, CDM or vault jobs, with no valid policy of that kind (INS-REQUIRED).

**Rule ARMS-LOCAL-ONLY (Fauzan, 2 Nov 2026: "foreign guard cannot use arm").**
- A non-Malaysian guard is refused in three places:
  - an armed post (`deployability`, code FOREIGN_ARMED);
  - a firearm issue (`armsIssueCheck`, code FOREIGN_GUARD);
  - an armed job (`planArmedJob`).
- Foreign guards are left out of the crew list.

**Load.** `reset-db` opens every department wall inside its single load transaction, so a clean-slate load by an Azure administrator (not a superuser) can still write the CMS roster.

**Not walled yet: vehicles.** Every staff member needs the vehicle list to book a car, so the transport wall comes with the tracker feed in 4F.

## Slices 4B-4H: what changed (2 Nov 2026, draft)

All of it is in `packages/core/src/service.ts` (block before "Tenders and quotations"), helpers in `packages/core/src/special-ops.ts`, routes in `apps/api/src/special-ops.controller.ts`, and a few web screens. No new table: new fields ride on the existing JSON rows, and the trading switch is the row `arms-trading` in the CMS settings table. Every decision takes a reason and nobody decides their own request. Routine recording (counts, check-ins, trips) needs no approval, in line with Fauzan's "a little trust to the staff" (2 Nov 2026); arms custody and money keep the strict checks.

**4B arms register.**
- Ammunition: receive into a vault, count (a shortfall opens a case), and every issue and return of a firearm moves the rounds.
- Register book check, vault watch check-in, firearm reported missing (opens a case and asks for the police report), police report recorded, firearm found, deposit at and collection from a police station with receipt.
- Range sessions and the 30 June licence renewal list (work starts 90 days before).
- A lost or deposited firearm is off the register for issue, readiness and counts.

**4C arms requests and suppliers.**
- One step route (`POST /arms/requests/:id/step`): Arms Control passes or returns, the licensed company authorises or refuses, Legal clears or stops (transfers, disposal, trade), PDRM or KDN reference recorded, the COO or CEO approves the spend, someone other than the requester verifies, the register is reconciled, then closed. The request moves on by itself once nothing is missing.
- PWVSB Legal reads a request only while it is at the legal check.
- Supplier file: country, foreign registration, local agent, currency, people, links to our companies, and papers (licences, import permits, end-user certificates, export licences) with expiry.

**4D armed jobs.** An armed job cannot start (code `ARMED_JOB_NO_GO`) while the crew, firearms, vehicle, client agreement or cover is not ready. A client checklist per agreement and a bank CIT tender pack per company are built from records already in Prima (key in once).

**4E CMS link.**
- `POST /api/integrations/cms/v1/events`: events and closed alarms from `apps/cms`, signed. Each event is taken once; a real closed alarm opens the company's own case. A company the CMS link holds no grant for is refused.
- `POST /api/integrations/cms/v1/directory`: companies, sites, linked systems, the next 24 hours of shifts and the group call-out people. Only the CMS link sign-in reads it. The CMS app pulls it on start and every 10 minutes (`PRIMA_DIRECTORY_URL`, or derived from `PRIMA_EVENTS_URL`); a directory that fails its checks is refused and the copy already held stays.
- CMS officers clock in to their own seat.

**4F Transport.**
- `POST /api/integrations/tracker/v1/positions`: positions are kept only while the vehicle is out on a trip (otherwise only "seen"); trip distance, top speed, over-speed and panic.
- Driving hours per driver today, against proposed limits: 8 hours a day, a 30 minute break after 4 hours, 90 km/h. **These numbers are proposals until Transport confirms them.**
- Board: `GET /transport/board`, for Transport, group leaders and CMS. Web: Vehicles, "Trips and driving hours".

**4G Asset Management.**
- `POST /api/integrations/am/v1/units`: the developer's system sends units by unit code. Its figures are kept beside Prima's tenancy, never over it. A month the system shows paid is "reported", not money received.
- Rent check (`GET /am/rent-check`): rent, status, tenant and paid-month differences for the team to settle. Web: Asset Management, "System check".
- Furniture and fittings purchases: the team asks with a reason; the FD decides up to RM10,000, the COO above; once bought, the request becomes the asset (tag, cost, date) so it is keyed once. Web: Asset Management, "Purchases".

**4H trading and import (OFF).**
- Kinds `TRADE_BUY`, `TRADE_SELL` and `IMPORT`. While off, every trading request or step is refused and the refusal is logged in its own transaction (it survives the rollback).
- Only the CEO switches it, with a reason, and only once a dealer licence is approved. Web: Arms Control, "Trading".
- Sale: the buyer's licence, police approval and end-user certificate must be on file. Import: CPO licence, then KDN approval, then customs notice, shipping (Port Klang or KLIA), arrival, declaration, and the endorsed licence back within 3 days. A step cannot be recorded out of order. Dealer return draft per company.

**Feeds and configuration (names only; values are set by an authorized owner, never in the repo).**

| Feed | Route | Key and signing secret | Sign-in (default) |
| --- | --- | --- | --- |
| CMS app | `/api/integrations/cms/v1/events`, `/directory` | `CMS_FEED_API_KEY`, `CMS_FEED_SIGNING_SECRET` (the CMS app's side: `CMS_TO_PRIMA_KEY`, `CMS_TO_PRIMA_SECRET`) | `CMS_FEED_USER_ID` (`u-cms-link` in mock data) |
| Vehicle trackers | `/api/integrations/tracker/v1/positions` | `TRACKER_FEED_API_KEY`, `TRACKER_FEED_SIGNING_SECRET` | `TRACKER_FEED_USER_ID` |
| Asset Management system | `/api/integrations/am/v1/units` | `AM_FEED_API_KEY`, `AM_FEED_SIGNING_SECRET` | `AM_FEED_USER_ID` |

Each call carries `x-api-key`, `x-timestamp` (within 5 minutes) and `x-signature` (HMAC-SHA256 of `timestamp.body`), as the JA feed. A feed with no key set refuses every call. Feed sign-ins hold no department wall except the Asset Management feed, which holds the asset walls only.

**Open items.**
- Database wall on vehicle positions: positions are filtered in the service only (the vehicles table has no RLS yet).
- Driver hours and speed limit are proposals; Transport to confirm.
- CMS device brands: one adaptor per brand still to list with the CMS head.
- KDN circular on arms dealing (2017) to be checked with Legal before trading goes on.
- Supplier file papers are entered by Arms Control; no provider or government system is connected.
- Company arms staff at the pilot company are not yet in the rollout list.

## Deployment notes

- **Database: add-on module, base unchanged (2 Nov 2026, 13:20).** The walls and grant fix moved out of `db/migrations/001_init.sql` into `db/modules/special-ops-v1.sql`, like Central Admin's module. The reviewed base schema and `db/release-manifest.json` are back to main's (base sha256 `4b4cf4d3…`), so no new base transition is needed. The module is PROPOSED: not in the manifest and not installed anywhere. The release owner pins it before the Special Ops rollout and an authorized owner installs it. Slices 4B-4H add no table. This PR runs nothing on Azure.
- **Configuration.** `special_ops` stays out of `PRIMA_ROLLOUTS` until the CEO starts the Special Ops rollout.
- **Rollback.** Unset the switch. The walls only narrow access.

## Tests (2 Nov 2026, local PostgreSQL 16)

**After Arisha main's review (2 Nov 2026, late):** see `docs/SPECIAL_OPS_REVIEW_BUNDLE.md` for the finding-to-fix matrix, hashes, browser runs and remaining inputs. At `eeb62a8`: core 723/723 (Vitest 4.1.12), API on PostgreSQL 16 705/705, CMS 45/45. Police paperwork for armed jobs, sites and moves is now a directors-only legal point (`GET /arms/legal-flags`), not a staff block.


**4B-4H (second run, 2 Nov 2026 evening):**
- `packages/core/test/special-ops-4b-4h.test.ts`: 17 tests. Full core suite: 709 of 709 passed.
- `apps/api/test/special-ops-4b-4h.test.ts`: 4 database tests (legal reads only at its step and Finance sees nothing; CMS events once, alarm closed as real with a case, directory only for the CMS link; tracker and Asset Management feeds; trading refusal logged and the CEO-only switch) and a signature test. Full API suite on PostgreSQL 16 with row-level security: 690 of 690 passed (one older test now accepts "not found" where the database hides another company's request).
- `apps/cms`: 41 of 41 (adds the directory pull). Prima's directory output also passes the CMS app's own directory checks (checked by hand on mock data).
- Web typecheck, server build and demo build passed. CI script tests: all passed.
- These are local results with mock data only. Nothing ran on Azure; the add-on module is not installed anywhere.

**4A (first run):**

- `packages/core/test/special-ops.test.ts`: 8 tests covering:
  - the switch's people;
  - walls per person;
  - foreign guards on an armed post, a firearm issue and a CIT job;
  - armed cover moved to Arms Control.
- `apps/api/test/special-ops.test.ts`: 6 database tests covering:
  - no arms row without the wall, for any of the 10 tables;
  - no write without the wall;
  - supplier and CMS walls;
  - the FD and the CoS read no firearms;
  - the three forms now save;
  - the switch.
- Results:
  - core: 346 of 346 passed;
  - API: 174 of 174 passed;
  - web typecheck and demo build passed;
  - script tests: 53 of 53 passed.

## Part R arms policies (Fitri package, 13-14 Nov 2026)

Built on the PR 141 branch from `2026-11-13_arms-vault-licence-jacket-policies-part-R.txt` (R1-R32) and Fauzan's
answers R-X1..R-X11. Source code only: nothing is merged, deployed or migrated. The circulars are in force from
1 Nov 2026 and the other papers from 18 Nov 2026 (rule ARMS-POLICY `inForce`).

**Where it lives.** `packages/core/src/arms-policy-service.ts` (one door, `svc.armsPolicyAct(user, op, input)`), the
API route `POST /arms/policy/:op` (special-ops.controller.ts, trade refusals logged outside the transaction), the screen
section "Polisi senjata" at the foot of Arms control (`apps/web/src/views/ArmsPolicyPanel.tsx`), three guide cards in
`special-ops-guide.ts`, and one new database module `db/modules/arms-policies-v1.sql` (table
`prima.arms_policy_recs`, not in `db/release-manifest.json`; the CEO installs it with `infra/run-db-migration.sh`).

| Part | What is built | Rule / check |
|---|---|---|
| R1 | New firearm statuses NEEDS_MAINTENANCE, UNDER_INSPECTION, DAMAGED, IN_REPAIR, UNUSABLE; each blocks the issue ("ROSAK - JANGAN DIGUNAKAN"); out of use only through the reuse confirmation; every change in a status log | `FIREARM_OUT_OF_USE`, armsIssueCheck NOT_IN_VAULT (ARMS-DAMAGE) |
| R2 | Damage report (photos, holder, first action), firearm marked DAMAGED; refused while issued (return first); categories Light / Medium / Critical; only Arms Control lowers a category, with a reason; Critical opens a P1 ARMS case | ARMS-DAMAGE targets: light 24 h, medium report 24 h + 2 working days, critical at once |
| R3 | Inspection checklist; a failed check opens the damage report with the findings | FIREARM_INSPECT_CHECKS |
| R4 | Repairs through a SERVICE request to a licensed dealer; IN_REPAIR while away; back from service = UNDER_INSPECTION, not IN_VAULT | dealerProblem |
| R5 | Reuse confirmed by Arms Control, never the reporter or the repairer, after a passing inspection; medium needs the company manager's review, critical also the company director's | reuse |
| R6 | Possible negligence: HR links its own discipline case. Never a pay deduction, never automatic | negligenceLink |
| R7 | Arms licence category on the licence record (Pelesen A, AMRA, CNU, bodyguard, other) and its state (active / suspended / cancelled). A licence without a category only warns at issue unless Arms Control turns on `categoryRequired` (switch, default off) | FIREARM_PERMIT reminder now 90 days (HR-CRED-LEAD) |
| R8 | Staff licence application: HR eligibility, restricted record and drug check, need, documents, Administration Manager check (not the preparer), support letter, submission, police stages, decision, licence book (dates from the book, no default length), appeal; renewals due list | licStep |
| R9 | Vault application: the vault is created as APPLYING (nothing can be placed in or issued from it); council, IPD, inspections, support, approval, access list, active | VAULT_STEPS, VAULT_APPLYING |
| R10 | Vault access by written authorisation, never self-given; access log with a witness; an unlisted entry opens a P1 case; the A licence holder and the Amra need valid licences or the vault blocks issues | VAULT_STAFF_LICENCE |
| R11 | Vault inspection with corrective actions (owner and date), vault changes with police approval when needed | vaultInspect, vaultChange |
| R12 | Internal purchase form with holdings against the need (signed armed posts and open armed jobs); more than the need needs a reason | buyForm, holdings |
| R13 | Only licensed dealers: ACQUIRE and SERVICE refused at Arms Control's pass, order and reconcile when the supplier has no valid licence | dealerProblem |
| R14-R15 | Police application pack: what Prima already holds is not keyed again; sending to the IPD needs a complete pack; monthly follow-up reminder | packState, ipdSent, ARMS-POLICY followUpDays 30 |
| R16 | Approval letter details (permit, date, type, quantity, calibre, rounds, holder, copy); 14-day window with reminders on day 7 and 10; after day 14 no order, receipt or reconcile | windowProblem, buyWindowDays 14 |
| R17 | Receiving by an appointed officer who is not the requester; no more than the letter allows; a mismatch opens a case and the company manager confirms; reconcile adds the rounds COUNTED and creates the firearms (serial set once, UNDER_INSPECTION before first issue) | armsGrn, reconcileBuy |
| R18 | Finance budget check on the pack; purchase file A-F | armsBudget, buyFile |
| R19-R22 | Bulletproof jackets, owned by Goodwill Empire (R-X7), item category `ballistic_vest` (R-X8): register, purchase with need / specification / three quotes (price alone cannot win, no product documents cannot win, split-purchase warning), receiving, issue and return (never guard to guard; handover records both), inspection, quarantine decided by someone else, loss | JACKET_* checklists |
| R23-R25 | Settings (Arms Control, with a reason), board, home items | ARMS-MAINT-DAYS 120 days, due soon 14 |
| R28 | Dealer licence application per company; the issued licence is written with its number, place of business, copy, valid to 31 December | dealerStep |
| R29 | Trading needs, per company, an approved licence with number, place of business and copy, valid today, even with the CEO switch on; switch-on needs such a licence and the reason must name its number | tradeProblem, setArmsTrading |
| R30 | Trade ammunition on its own TRADE ledger, only into a store with its own police approval; guard issues and returns never touch it | tradeStore, ammoMoveTx |
| R31 | Readiness list per dealer company: UNKNOWN until recorded with a document | readinessList |

**Walls.** The service refuses the board to anyone outside the arms wall (Finance, the CoS, PWVSB legal); the store
team sees jackets only. In PostgreSQL the read, insert and update policies apply the arms wall AND the company wall;
jacket records are also open to the procurement and store team within its company wall; PWVSB HR reads licence
applications and damage reports; Finance reads the purchase pack. History is append-only, identity never changes,
and nothing is deleted (trigger `arpol_guard`, DELETE and TRUNCATE revoked).

**Still off or outside Prima.** Arms trading stays OFF (CEO switch). Sharing an operational vault with trade stock
stays OFF until the police view is recorded (readiness line `policeViewSharedVault`). Police-dependent times are
"expected" and flagged, never a block. No automatic pay deduction. Dealer names and signers from the papers are
entered by Arms Control in the app, not in code.

**Tests.** Mock: `packages/core/test/arms-policies.test.ts` (17) and the updated `special-ops-4b-4h.test.ts` (22).
PostgreSQL: `apps/api/test/arms-policies-pg.test.ts` (walls, inserts outside the wall refused, append-only, no delete,
grants), run apart from the mocks.

## Transport check gaps (Fauzan, 23 Nov 2026: "Do the gap")

Study note: "Transport and fleet check" (Claude Doc, 23 Nov 2026). Built from main `b3176a0`:

1. **OGM sees the board.** Transport runs under the OGM and the COO oversees. The OGM and the Deputy OGM now get the full Vehicles board, read only, like the COO.
2. **No self-approval.** Nobody decides their own vehicle request. A Transport person's own request goes to the OGM.
3. **Consent cannot be skipped.** A vehicle with a dashcam or health monitor goes out only to a driver chosen from the staff list, so the PDPA consent is checked. A typed name is refused.
4. **No expired vehicle on the road.** A vehicle cannot be logged out while its road tax or insurance has expired.
5. **Do today.** Transport gets one Do today list on the Vehicles screen: reminders, bookings waiting, driver hours, summonses due, licences ending and open accidents. The OGM and the COO see only what is expired, overdue or open after an accident. The COO also gets these on Home.
6. **Company-car mileage.** Each trip out and in now keeps the driver and the km. A company-car mileage claim is checked against the km logged that day for that person. With no logged trip it still goes to the Chief of Staff.
7. **Accidents.** Transport, or the driver of the vehicle out with them, reports an accident with photos, the place, police report and insurer claim numbers. Transport closes it as settled with proof.
8. **Summonses and driver licences.** Transport records a summons (JPJ, PDRM, AES, council). Prima links it to whoever had the vehicle out at that time. It is closed as paid, appealed or cancelled with proof. Transport files each driver's licence (classes, expiry, copy). A vehicle cannot go out to a driver whose licence on file has expired. The company pays a summons on time and recovers it from that driver (D2 below).

**Database module:** `db/modules/fleet-records-v1.sql` (new table `prima.fleet_records`, group and company wall, no delete, only status, outcome, added files and added history may change). Not on the release list. Until it runs, the three new tabs say Not installed, and vehicles still go out with no licence check.

**Fauzan's decisions (23 Nov 2026, "Follow your recommend"):**
- D1: 90 km/h, at most 8 hours driving a day, a 30 minute break after 4 hours (rule FLEET-DRIVING, Policy).
- D2: the driver at the wheel pays a summons. The company pays it on time, then Transport records the recovery: the driver paid back (receipt), HR deducts with the driver's signed consent, or the company bears it with a reason (rule FLEET-SUMMONS).
- D3: the Head of Transport named in the org chart decides bookings; the OGM stands in at any time; other Transport staff log trips, fill-ups and records. Until a head is named, any Transport person decides (never their own).
- D4: a vehicle 10 years from first registration or past 300,000 km is flagged to the COO for a replacement review (rule FLEET-REPLACE). The vehicle form has "First registered on".
- D5: the tracker feed stays off until a brand is chosen.
