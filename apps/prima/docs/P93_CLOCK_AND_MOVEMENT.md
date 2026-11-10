# P93: clock-in, distance at log-out, and movement out of station

Fitri, 9 Nov 2026: "The clock-in: when I clock in sometimes I get an error asking me to go out and clock in again;
please fix this. And the distance history seems wrong when I logged out. Please check this too: my movements and all
must be recorded nicely, to know if the staff are out of station, for example if they go out of the range of the site,
to prevent violations and fraud."

Branch `p93-clock` (from `p92-integration` 8876ef5). Not merged, not deployed. No new table, no migration.

## 1. "An error asking me to go out and clock in again"

### Root causes

Every message in the clock flow that tells a person to leave or check out and come back was read (core, API and web):

| Message (English; the Malay screen says "daftar keluar", literally "register going out") | Where | When it fired for a normal person |
|---|---|---|
| "You checked in at 09:02. Check out first." | `checkin-service.ts` `record()` | A check-in when the server already had one: a second tap, a second tab or the phone and the laptop, and above all a **retry after the answer was lost** on a weak signal (the request waits up to 2.5 s for the address and carries a face photo of up to 2.5 MB, so phones often time out after the server has saved it). The card on the screen still said "Not checked in", the person pressed again and was told to check out first. |
| "A test check-in is already open. Check out of it first." | `owner-test-checkin.ts` `start()` | The owner's TEST check-in, the same way (Fitri tests as the owner): a test open on the phone, the laptop screen still showing "Check in (test)". |
| "You are already clocked in. Clock out first." | `service.ts` `staffClockIn()` | The photo clock-in, the same way. |
| "You have not checked in today. Check in first." | `checkin-service.ts` `record()` | **Midnight**: someone checked in at 22:00 could not check out at 00:30, because "today" had changed; opening Prima after midnight also closed their running clock as "did not sign out". |
| (no message; a second clock) | `staffSessionStart()` | **Race**: opening Prima clocks staff in automatically while the check-in also opens the clock. With nothing holding the two apart, both could open a clock; later screens then disagreed about whether the person was in. |
| "Your location is only accurate to about 140 m…" / "No location yet" | the check-in drawer | The drawer gave up after 12 seconds; indoors a phone often needs 20–40 seconds for a usable fix, so people were sent to "move near a window and try again". |

### What changed

- **Idempotent check-in and check-out.** Checking in when already checked in returns the check-in already made (`already: true`), never an error; the same for checking out twice. The owner's test check-in returns the open test; a test check-out sent again within 10 minutes returns it. The photo clock-in returns the open clock. The screen then says "You were already checked in. Nothing more to do."
- **One clock step at a time per person.** Opening Prima, check-in, check-out and sign-out take a per-person database lock (`pg_advisory_xact_lock('staffClocks:user:<id>')`, same for the owner's test), so the automatic clock-in and a check-in at the same moment cannot both open a clock. If an older open clock were ever left beside a newer one, the newest is used.
- **Midnight.** A clock opened on an earlier day still counts as the working session when it began less than 16 hours ago and was active (opened, or a location reading) in the last 4 hours: night work past midnight keeps its clock and can check out. A clock left open from yesterday morning is closed by Prima as before ("did not sign out").
- **Waiting for a usable location.** The drawer keeps looking for up to 45 seconds, showing "Accurate to about 180 m so far; waiting for 100 m or better", takes the first usable reading, and only then asks the person to move. A slow phone that already gave a reading is not failed on a timeout.
- **Plain message when something is really wrong**: checking out without having checked in today now says "You have not checked in today, so there is nothing to check out. Press Check in when you start work."

## 2. "The distance history seems wrong when I logged out"

### Root causes

- **GPS wobble added up as walking.** The owner's test added every step between readings (one every 15 s). A phone lying on a desk reports points a few metres apart each time; an hour at the desk showed as hundreds of metres to kilometres.
- **A rough last reading.** The test check-out took one quick reading (8 s) and added a straight line to it whatever its accuracy (a 1 km Wi-Fi/cell fix drew a 1 km jump), while readings on the way were filtered at 150 m.
- **Logging out did not end the test.** Signing out of Prima ended a staff clock but left the owner's test open; the next check-out, later and somewhere else, drew a straight line from the last reading before log-out to there.
- **Staff clock**: the clock-out record's distance is from the check-in place, but the record screen said "from base" (the older personal base); readings were ordered by the time the server got them, not when they were taken; a reading sent twice was stored twice; there was no route distance at all.

### What changed (one computation for staff and the owner's test: `packages/core/src/movement.ts`)

1. Readings without a location, rougher than 100 m, taken before the clock-in or after the clock-out, or sent twice, are left out (counted and shown: "3 of 40 readings were left out").
2. Readings are ordered by the phone's time (a reading kept offline keeps the time it was taken), unless the phone says it was taken after the server got it: then the phone clock is ahead and the server's time is used (and flagged).
3. A one-off far reading (faster than 200 km/h from the one before, back again after) is left out. If the phone stays at the far place, it is a **jump**: the route continues from there and the jump is a review item.
4. Distance counts a step only when it is longer than the two readings' accuracies together (and at least 20 m), so a phone lying still adds nothing.
5. The route stops at the clock-out. Signing out of Prima ends the owner's open test **at its last reading** ("Ended at sign-out").
6. The owner's tests show the distance worked out again from the readings each time, so tests saved before this fix show the right figure too.
7. The record screen says "x m from the check-in place" for a check-out.

## 3. Movement while clocked in, and out of station

Only while a person is clocked in, as before: nothing is taken after the clock-out, and no new personal data is collected
(the same latitude, longitude, accuracy and time per reading).

### Recording (the phone, `views/StaffTracker.tsx`)

- Adaptive: about every 10 minutes when still (rule HR-STAFF-PING), every 2 minutes when moved 100 m or more (rule HR-STAFF-MOVE). After 10 minutes still, the phone stops watching continuously and reads once per interval (battery); moving again resumes watching.
- A rough reading waits for a better one, unless nothing has been sent for the interval.
- No signal: readings are kept on the phone (up to 200) and sent together when the signal is back (`POST /api/me/clock/pings`). The server places each one inside the person's own clock session by its time and refuses any outside a session.
- Back on the screen (the phone woke up): a fresh reading at once and the kept ones sent.
- Starts at once after a check-in, stops at once after a check-out or when the server says the person is not clocked in.
- Each reading is named by the phone's time, so a retry is kept once.
- A web app reads the location only while Prima is open; following a closed phone still needs the native app wrapper.

### Where each person should be

Measured against the place Prima already knows for the person, in this order: their check-in rule (one place, or field areas plus the company offices), else their company's check-in places, else the older personal base. The place saved with the session's check-in is used, so changing someone's place later does not rewrite history. **No place set: the screen says "No place is set for this person, so time outside cannot be measured", instead of guessing.** Outstation days (field rule): anywhere is allowed, not counted. Working from home: not followed (unchanged).

### The rules (proposed, rule HR-STAFF-MOVE in `rules.ts`)

| What | Value | Meaning |
|---|---|---|
| Out of station | outside for more than **15 minutes** | an item for the manager; shorter times are recorded, not flagged |
| Inside | within the place's radius, giving a reading up to 50 m of its accuracy at the edge | radius as set on Check-in places (default 150 m) |
| Rough reading | over **100 m** accuracy | kept on the record, not used for distance or place |
| Jump | faster than **200 km/h** between readings and the phone stays there | suspicious: mock-location app, or the phone with someone else |
| Far clock-in | check-in more than **1 km** outside the place | review item (besides the existing out-of-area check-in review) |
| Fake-looking location | a reading claiming 0 m accuracy, or the exact same point 6 or more times with 5 m or better accuracy | real phone GPS always moves a little; a laptop's Wi-Fi location (tens of metres) is not counted |
| Phone clock ahead | the phone's time later than the server's by more than **5 minutes** (rule HR-STAFF-TIME) | server time used, item shown |
| Location stopped | no reading for more than **30 minutes** (rule HR-STAFF-GAP) after location was followed | shown as Unknown, never as inside |

Each reading stands for the time until the next one, at most 30 minutes; after that the time is Unknown.

### Who sees what (no permission widened)

- Each person: their own record (My clock: "My movement today", and every record in the last 7 days opens with the route, timeline and items).
- Managers: their team on the Staff clock board ("Movement to look at", a new "Out of station" count, and each person's record), with the existing staff clock scope: company managers their company, the Director, CEO, COO and central HR everyone, the IT Manager the IT team view-only. Another company's manager and colleagues are refused (service check, and the row-level security on `location_pings`/`staff_clocks` still applies).
- The owner: the TEST check-in uses the same computation, measured against the owner's company check-in places (else their base), with the same items, so Fitri can test it. Tests remain never attendance or pay.

Review items are worked out from the stored readings each time they are shown. There is no accept/follow-up button on them yet (that would need a small table for the decisions; see below).

## Files

- Core: `movement.ts` (new), `checkin-service.ts` (idempotent, midnight, lock), `service.ts` (staff clock: lock, idempotent clock-in, midnight carry, readings by phone time, `staffPings`, movement on My clock, board and record; sign-out ends the owner's test), `owner-test-checkin.ts` (same computation, idempotent, ends at sign-out), `rules.ts` (HR-STAFF-MOVE), `seed.ts` (a mock 50-minute trip out of the PWVSB office for the demo board).
- API: `controllers.ts` (`POST /api/me/clock/pings`), `pg-store.ts` (the per-person lock).
- Web: `views/StaffTracker.tsx` (new), `views/Movement.tsx` (new), `StaffClock.tsx`, `CheckIn.tsx`, `OwnerTestCheckin.tsx`, `api/*` (`staffPings`), `i18n.ts` (P93 rows and patterns), `styles/checkin.css`.
- Tests: `packages/core/test/movement.test.ts` (new), updated `checkin.test.ts`, `owner-test-checkin.test.ts`, `core.test.ts`; `apps/api/test/staff-movement.test.ts` (new, PostgreSQL).

## For Fauzan to decide

1. **The numbers** in HR-STAFF-MOVE are proposals: 15 minutes out of station, 100 m accuracy, 200 km/h jump, 1 km far clock-in, a reading every 2 minutes while moving.
2. **PDPA notice to staff.** Location is still recorded only while clocked in, but it is now read more often while moving, kept on the phone while offline, and used to show managers time outside the place and suspicious patterns. The written notice staff get before this goes live (the check-in notice in `checkin.ts` CHECKIN_NOTICE and the PDPA register) should say so; the wording is for the PDPA officer and the company lawyer. Keeping location readings 90 days (HR-STAFF-KEEP) is still unverified.
3. **Recording the manager's decision** on each movement item (reason accepted / follow up, with a comment, as for out-of-area check-ins) needs one small Prima office module (a decisions table with forced row-level security). Not built: say if wanted.
4. **Following a closed phone** needs the native app wrapper; the web app follows only while Prima is open.

## P97 (Fitri, 11 Nov 2026): face photo, following through the shift, the route at check-out

"In Prima clock-in I can clock in, but where is the face scan/snap? The location must be logged even if they close the
thing and still detect their location range. When clocked out, map the route from clock-in until clock-out and their
distance within the shift."

- **Why there was no face scan.** The check-in asked for a face only when the person had a face HR had approved AND the
  sign-in clock still waited for its face check; most staff have no approved face yet, check-out never asked, and the
  owner's TEST check-in (what the owner sees on My clock) had no camera at all. Not hidden by a rule: not built for them.
- **Face photo at every check-in and check-out** (rule HR-STAFF-SNAP, on by default): the same camera and face check as
  the sign-in face check (`FaceCheck.tsx`: the phone finds the face and checks it moved; with an approved face the server
  matches it, rule OPS-FACE-MATCH). The photo is made smaller on the phone (about 480 px) and kept in its own table
  (`db/modules/clock-snaps-v1.sql`, forced row-level security: the person, their manager and HR only, never colleagues;
  the picture is dropped after HR-STAFF-KEEP, 90 days). No camera: the person writes why. No photo, no face, a face that
  did not move or did not match: the check-in is still recorded (as for guards) and the photo waits on the Staff clock
  board ("Face photos to look at") for the manager or HR to mark fine or follow up, with a comment, never their own. The
  owner's TEST check-in takes the same photo, kept on the test's own row.
- **Following through the shift.** In a browser: watchPosition while Prima is open (also in a background tab while the
  browser allows it), the screen kept on if the person chooses, positions queued without signal, and notes of what the
  phone said (to the background, location refused, no position, no signal) sent with them. A web page cannot read the
  location once it is closed or the phone sleeps; those times are gaps with their likely cause, never made-up positions.
  The Prima app with the background-geolocation plugin follows in the background (`native-geo.ts`; steps in
  `P96_MOBILE_APP_READY.md`). Still only while clocked in.
- **The route.** At check-out (and on every clock record for the person, their manager and HR) the route is drawn in
  pieces: inside the place (green), outside it (orange, thicker), dashed where no position came (the line only joins the
  two readings), start and end markers and the place's circle, with the distance (and how much of it is the straight
  lines across gaps), time inside and outside the place, and each gap with its cause.
