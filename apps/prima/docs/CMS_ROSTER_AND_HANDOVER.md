# CMS duty roster and shift handover (real-use version)

Asked for: Fauzan, 25 Oct 2026 ("Cms must be manned by 1 head control and 1 monitor officer in each shift", roster under Arms Control) and 5 Nov 2026 ("Build all that still not build"). The 5 Nov audit listed the CMS roster as sample only.

Status: draft, mock data only. Not merged, not migrated, not deployed.

## Which side each piece is on

Fauzan, 5 Nov 2026: the CMS runs on its own in-house server; Prima keeps what must be documented as a company.

| Piece | Where | Why |
| --- | --- | --- |
| CMS staff list, roster, seats, rest and leave checks | Prima | Staff, hours and leave are employment records |
| Clock in and clock out of a seat, hours per month | Prima | Hours record for HR and pay |
| Handover record (who handed to whom, when, what was open, agreed or not) | Prima | Company record of who held the desk |
| Live desk handover with the CMS app's open alarms | CMS app (in-house) | The open alarms live there; it sends Prima the record only (no clip links or device details) |

Until the CMS app is installed on the in-house server, the handover is done on Prima's CMS board. Once it is live, the desk does it and the record lands on the same Prima seat. A seat takes one handover: the first wins, and a second one is refused with the reason.

## Rules

- **Own account.** A CMS staff record is linked to the person's Prima account (staff form, CMS department accounts only, one account per record). Clock-in, clock-out and the handover go by that account, never by the name on the roster. Someone with no account linked can be rostered but cannot clock in.
- **Rostering.** Arms Control sets the roster as needed (Fauzan, 5 Nov 2026). At most 12 hours in a row (Employment Act s.60A) and no more than 6 days in a row (Employment Act s.59) stay fixed by law. The rest between stretches is a CMS setting Arms Control changes (1 to 24 hours, 8 to start; Fauzan, 5 Nov 2026). Nobody is put on a seat during approved leave. The screen picks the person by staff record; a name alone is refused when two staff share it. The rest check looks two days each side of the seat, so the longest setting (24 hours) is always covered.
- **A clocked-in seat keeps its hours.** Once someone has clocked in on a seat, Arms Control cannot give that seat to another person (open: a separate seat for a mid-shift replacement is not built).
- **Same moment, same seat.** Clock-in, clock-out, take-off, assign and both handover steps lock the seat and check again inside the save, so two presses at once (or the board and the CMS desk together) land only once.
- **Taking someone off.** Arms Control takes a person off a seat that has not started, with the reason. The seat shows as empty and the roster alert asks for someone else.
- **Handover step 1.** The outgoing Head Control writes it in the last hour of the shift. Prima adds what is still open on its board: alarms not closed, false alarms waiting for review, forwarded calls not called back (names and counts only).
- **Handover step 2.** The incoming Head Control on that seat, clocked in, takes it from 30 minutes before the shift. If the outgoing Head Control was on the desk, they must have written step 1 first. Nobody takes a handover from themselves. "Not agreed" is allowed with the reason; the board raises it for Arms Control.
- **Clock-out.** Leaving more than 15 minutes before the end needs a reason. Head Control cannot clock out until the next Head Control has taken the handover (or nobody is rostered: call Arms Control). Arms Control can clock a person out with a reason.
- **Hours.** Arms Control sees each person's month: seats, worked, hours (clock-in to clock-out), late in, left early, no clock-out, missed, taken off. HR views the same record and the rest setting on the HR monitor, view only (Fauzan, 5 Nov 2026: "Hr just view it"). This is the hours record, not a payslip.

## CMS app side

- Prima's directory now carries `desk`: Head Control and Monitor Officer seats from 12 hours ago to 24 hours ahead (id, post, start, end, name, and whether that person is on the desk now).
- `GET /api/handover`, `POST /api/handover/give`, `POST /api/handover/take` on the operator routes. The dashboard has a "Serah tugas syif" panel in BM.
- Taken handovers are queued and sent to Prima with the events, signed the same way; Prima acknowledges with `received.handovers`, refusals are retried and then parked for the operator. They survive a restart. If the outgoing Head Control is not on the desk (no-show, or clocked out by Arms Control), the incoming one takes over without a written handover. Prima refuses a desk handover timed outside the seat (from 30 minutes before its start to its end), or one with no written step while the outgoing Head Control is still clocked in.
- The desk knows the operator by the name on their operator key. Microsoft sign-in for operators is still the plan in `docs/CMS_DURABILITY_AND_OPERATOR_SIGN_IN_PLAN.md`.

## Open

- Real CMS staff and their accounts: entered by Arms Control in the app, not in code.
- Whether CMS overtime goes into staff payroll.

## Checks run (5 Nov 2026)

- `packages/core/test/cms-roster.test.ts` (10 tests), core suite 762/762.
- API suite 716/716 against a local throwaway PostgreSQL 16, including a new app-role test (take off a seat, hours shown to Arms Control only).
- CMS app `test/handover.test.ts` (4 tests), CMS suite 87/87.
- Browser walk-through on the demo build at 1280 and 390 wide, 7/7 each (includes HR's view-only panel): `scripts/cms-roster-handover-uat.cjs`.
- After the rest-setting change: core 763/763, API 716/716, CMS 87/87.
- Review pass (5 Nov 2026, "Review test and push"): fixed same-name staff, the rest window for long rest settings, the desk handover time window and outgoing step. Core 765/765 (12 roster tests), API 716/716 on local PostgreSQL 16, CMS 88/88, build and demo build pass, walk-through 7/7 at 1280 and 390.
- Second review pass (5 Nov 2026): seat lock and re-check for every roster and handover action; clocked-in seat cannot be reassigned. Core 766/766, API 717/717 on local PostgreSQL 16 (new test: two people taking the same person off one seat at once, one lands), CMS 88/88, build and demo build pass, walk-through 7/7 at 1280 and 390.
