# Time slip (rule HR-TIME-SLIP)

Fauzan, 4 Nov 2026. Staff ask to leave the office for a few hours on their own matters.

## Rules

- **What a slip covers.** A date, a time out and a time back, all within office hours (08:30 to 17:30).
  - A slip is at most 4 hours. Anything longer is leave.
  - A slip can be asked up to 30 days ahead, and never for a past day.
  - Slips on the same day may not overlap.
- **Who approves.** HR sets this in one setting. The default is the head:
  - Company staff go to their company head (the company manager).
  - Central staff go to their department head, where Prima records one: IT Manager, ACT Lead, FWM Manager, the Finance Director, the HR Director for HR, the Chief of Staff, the OGM for Procurement, or the Asset Director.
  - When there is no head above the person, HR approves instead. This covers a company manager, a department head, and a department with no head recorded.
  - HR may change the setting to **HR approves**, and back, always with a reason. The change is kept in the setting's history.
- **Approving.** Every approval needs a comment, and a refusal needs a reason. Nobody approves their own slip. HR's own slips go to the HR Director.
- **HR is told** of every approval, and told again when leave is taken. Each HR person marks a notice as seen.
- **Working the hours back.** The hours are worked back within 30 days of the slip date.
  - Make-up time is staff-clock time after 17:30.
  - Only a clock the person closed by signing out counts. A clock still open, including one left open from an earlier day, does not count until it is closed.
  - A clock closed by Prima (`NO_SIGN_OUT`) does not count. Neither does one where the door shows the person left before signing out (`LEFT_BEFORE_SIGN_OUT`).
  - When there are several slips, the one with the earliest deadline is filled first. Each minute counts once.
- **When the 30 days end.** Hours not worked back are taken from annual leave in half days (4 hours each, rounded up).
  - This is done as an approved leave record with `timeSlipId`, made by "Prima (time slip rule)".
  - When no annual leave is left, the rest is recorded as unpaid leave for HR to see.
  - This runs when HR or the HR Director opens the time slip board. It never runs twice for the same slip: each slip is locked and read again before leave is taken, so two boards opened at the same moment take leave once.
- **Cancelling.** The staff member may cancel a slip that is still waiting, or an approved slip before its day.

## Where it is

- **Staff.** Clock screen, then the "Time slip" panel. From there they ask for a slip, see who approves, track the hours to work back, and cancel.
- **Approvers.** The same panel shows "Waiting for you to approve". Company heads and HR also have the Staff clock screen, "Time slips" tab.
- **HR.** On the Staff clock screen, "Time slips" tab:
  - every slip;
  - "New for HR" with Mark seen;
  - "Still to work back";
  - "Taken from leave";
  - the approver setting.

## Code

| Part | File |
| --- | --- |
| Pure rules | `packages/core/src/time-slip.ts` |
| Service | `PrimaService.requestTimeSlip`, `decideTimeSlip`, `cancelTimeSlip`, `setTimeSlipApprover`, `seenTimeSlip`, `myTimeSlips`, `timeSlipBoard` |
| API | `GET/POST me/time-slips`, `POST me/time-slips/:id/cancel`, `GET time-slips`, `POST time-slips/:id/decide`, `POST time-slips/:id/seen`, `POST time-slips/settings` |
| Screens | `apps/web/src/views/TimeSlip.tsx` (inside `StaffClock.tsx`) |
| Database | `db/modules/time-slip-v1.sql`: `prima.time_slips` (company wall, the same as working from home) and `prima.time_slip_settings` (everyone reads; only group users write; the service allows HR only) |
| Tests | `packages/core/test/time-slip.test.ts`, `apps/api/test/time-slip-rls.test.ts` (PostgreSQL, including two boards opened at once), `scripts/time-slip-browser-smoke.mjs` (browser, runs in CI with screenshots kept as the `time-slip-uat` artifact) |

## Not done / gates

- **The database module is not run and not registered** in `db/release-manifest.json`. It needs the CEO-run migration and a release review before the screens work on staging. Until then, the time slip calls fail on a database without the tables. Nothing else is affected.
- **In the IT pilot (rule PILOT-IT), only pilot users sign in.** Company staff and company heads cannot use it until the pilot widens. The browser walk-through opens every made-up staff member in the test version only (browser flag `prima-demo-all-staff`, read by the demo API). The API build has no such switch.
- **The staff clock board still flags the time away as a long break.** It does not yet clear the flag for an approved slip.
- **Payroll does not read unpaid leave from slips yet.** This waits on the staff payroll work.
