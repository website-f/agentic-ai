# Handover: the guard phone app (for Fitri)

Written 5 Nov 2026 for Fitri, who builds the native phone app for Prima Secure App. Fauzan asked for this note.

## Read this first: what state the code is in

**Everything described here has been built and run, but nothing is merged yet.** Fauzan, 5 Nov 2026: "All have run but not merge."

- The server routes below are in **draft pull requests**. They passed their tests and browser checks on made-up (synthetic) data. For example, PR #121 had all 16 CI checks green on head `2604019`.
- None of it is on `main`. None of it has been migrated into the database or deployed to staging or production.
- Every guard feature is **off by default** behind a switch. Fauzan decides when each PR is merged and switched on.
- So, build against the draft branches (or a local copy of them), not against staging. Expect small changes before merge.

| PR | What it gives the phone app | Branch | Stacked on |
| --- | --- | --- | --- |
| #121 | Guard sign-in on own phone (enrol, face + PIN), heartbeat, on-duty location, SOS | `claude/project-thread-f0no94` | #76 (face engine) → #51 (HR) |
| #120 | Guard payslips (`GET /api/guard-pay/mine`) | `claude/project-thread-4rcda0` | #112 (pay formulas) |
| #119 | JA switch-over reports. Office only, nothing for the phone | `claude/project-thread-iq5x5z` | #120 |
| #117 | Asset Management extras. Office only, nothing for the phone | `claude/project-thread-rlo83w` | `main` |
| #122 | Quality (ISO) package. **Guards must never see it** | `claude/project-thread-5ld2nw-qms-ops` | #111 |

#121 and #120 sit on **different stacks**. A test server with both needs both stacks combined. Ask Fauzan (or Claude) for a combined test branch rather than merging them yourself.

The repo is a monorepo: `apps/api` (NestJS API), `apps/web` (React PWA), `packages/core` (business rules and the service), PostgreSQL with a company wall (row-level security). The PWA already has a working guard phone screen (`apps/web/src/views/GuardPhone.tsx`, opened at `#guard-phone`). Your native app replaces that screen. Its client, `apps/web/src/api/guard-phone.ts`, is the best reference for exact request bodies.

## Why a native app

A browser only sends the heartbeat while the screen is open. Fauzan wants the **heartbeat and on-duty location to keep going with the phone locked**. That is the main job of your app. Same server routes, no new API needed for it.

## Sign-in

### Guards and officers: their own phone (PR #121)

Guards never use Microsoft sign-in. They use **phone + PIN + face**, all three every time, never the PIN alone.

1. **Enrol the phone (once).** The company office or HR presses *Enrol phone* on the guard's record. The office gets a one-time code (valid 24 h) and a link `…#guard-phone?u=<userId>&p=<phoneId>&c=<code>`. Your app should accept that link (deep link or QR) or let the guard type the code. The guard also types their own staff number.
   `POST /api/guard-phone/enrol` with `{ userId, phoneId, code, staffNo, deviceLabel }` returns `{ userId, phoneId, secret }`.
   **Store this device credential in the phone's secure storage** (Android Keystore / iOS Keychain). The server keeps only a hash of the secret, so if the app loses it the guard must enrol again. One active phone per guard; enrolling a new phone retires the old one.
2. **Register the face (once).** `POST /api/guard-phone/face` with `{ device, pin, photo, descriptor? }`. HR then approves it in the office app. Until approved, sign-in says "waiting for HR".
3. **Before sign-in.** `POST /api/guard-phone/status` with `{ device }` returns name, staff number, face status (`none` / `pending` / `approved` …), `lockedUntil`, and `engine` (`phone` or `server`).
4. **Sign in.** `POST /api/guard-phone/challenge` with `{ device }`, then `POST /api/guard-phone/sign-in`.
   - With `engine: "phone"`: send `{ device, pin, descriptor (128 numbers), live, photo }`. The PWA makes the descriptor with `@vladmandic/face-api` using the model files Prima serves at `/face-models`. Use the same model so numbers match.
   - With `engine: "server"` (stronger, preferred): the challenge returns `{ token, steps }` such as `centre, left, centre, right`. Take one JPEG per step and send `{ device, pin, token, frames: ["data:image/jpeg;base64,…", …] }`. The server judges the face; the phone only takes pictures.
   - Success returns `{ token, expiresAt, sessionId }`. The token starts with `gp1.`. Send it as `Authorization: Bearer gp1.…` on every signed-in call.
   - Refusals: `401` wrong PIN or face, `423` locked (`lockedUntil` in the body), `429` too many tries from this address. Five wrong tries lock the phone for 30 minutes.
5. **Sign out.** `POST /api/guard-phone/me/sign-out`. A `401` on any signed-in call means the session ended (signed out, phone retired, expired after 14 h); go back to sign-in. A `403` with "not enrolled" on a device call means the phone was retired; forget the credential and show enrolment.

If the switch is off the server answers `404` "Guard phone sign-in is switched off on this server." Show that plainly.

### Office staff: Microsoft (Entra) sign-in

Only relevant if your app ever serves office staff. It is on `main`. Office staff sign in with their Microsoft work account; the API accepts a Microsoft v2.0 access token for the Prima API with scope `access_as_user`. The app reads the client ID and scope from `GET /api/auth/config`. A native app would need its **own** app registration (public client, mobile redirect URI) added by the tenant admin, because the API checks which app the token was issued to. That is a tenant change: ask Fauzan before anyone sets it up. Setup is in `docs/MICROSOFT_SIGN_IN.md`. Use placeholders such as `<tenant-id>` and `<application-id>` in any notes; never copy real IDs into the app source.

## Guard screens to build

Keep it to these. Two languages on every screen (BM and English; the PWA writes "BM · English").

| Screen | What it shows or does | Route |
| --- | --- | --- |
| Enrol | Code (or link/QR) + staff number | `POST /api/guard-phone/enrol` |
| Register face | PIN + one photo, then "waiting for HR" | `POST /api/guard-phone/face`, `POST /api/guard-phone/status` |
| Sign in | PIN + face check (one step or the head-turn steps) | `challenge`, `sign-in` |
| Home / duty now | Name, staff no., the shift on now (site, start, end), open SOS, phone Live | `GET /api/guard-phone/me` |
| SOS | Big red button, **hold 1.5 s**. Works signed in or not, on or off duty | `POST /api/guard-phone/me/sos`, fallback `POST /api/guard-phone/sos` with `{ device, lat, lng, accuracyM }` |
| My duty (view only) | Roster next 14 days, clock-in record last 30 days, patrol rounds last 7 days, reminders (papers running out, leave waiting, salary account changed) | `GET /api/me/duty` (on `main`) |
| Payslips | Own payslips, paid months only | `GET /api/guard-pay/mine` (PR #120) |
| Memos | Memos from the COO to all guards and officers; mark read | `GET /api/memos`, `POST /api/memos/:id/read` (on `main`) |

**Background heartbeat (the main reason for the app):**
- `POST /api/guard-phone/me/heartbeat` with `{ lat, lng, accuracyM, capturedAt, battery }` every **60 s** (`heartbeatSec` from `/me` or the heartbeat answer; read it, don't hard-code it).
- CMS shows the phone Live, Late, or **Offline after 5 minutes** without a heartbeat.
- Send location whenever you have it. **The server decides what to keep**: only on duty (30 min before to 30 min after the shift), at most once a minute. The answer tells you `onDuty`.
- With no signal, keep the last readings and send them when back online with their real `capturedAt`. Do not invent readings.

**Not in the phone app:**
- **Clock-in and clock-out stay on the shared site device** (face at the site). The phone does not clock in.
- **Patrol checkpoints stay NFC taps on the site device.** Phone location is not patrol proof.
- **Leave** is asked on the site device or through the company, not on the phone.

## What guards must NOT see

Fauzan's rules (5 Nov 2026). Do not add these screens or call these routes from the guard app, even if the server would answer:

- **No ISO / PIKM / quality screens.** Requirements register, competency matrix, service faults, supplier ratings, objectives, controlled documents, management review (PRs #111, #122). "Guards and officers never see any of this."
- **No assignment instructions or client due diligence** (PR #115). "Guards do not see them in Prima; officers brief them."
- No other guard's record, no site or company dashboards, no rosters of others, no CMS board, no office screens.
- No AI assistant (Arisha) on the guard app.

The server enforces its own permissions, but the `gp1.` token is accepted by the general API guard. So do not treat "the server returned data" as "the guard may see it". Only call the routes in the table above.

## Data rules

- **Record once, no extra forms.** Do not add fields, questionnaires or forms that the server does not already have. Everything the guard sees comes from existing records. If you think a new field is needed, ask Fauzan first.
- **No PDPA location notice step on the phone.** Fauzan, 5 Nov 2026: "No need pdpa text." Do not add a consent screen for location.
- Ask only for the phone permissions needed: camera (face), location (always/background for the heartbeat), notifications if you show SOS status. Nothing else (no contacts, no files, no microphone).
- Keep the device secret and token only in secure storage. Never log the PIN, the secret, the token, photos or face numbers.
- Do not keep a local copy of other people's data. Cache only this guard's own duty screen, and clear it on sign-out.
- Test only with synthetic data (the PWA test version has sample guard `u-guard-sasa-1`). Never use real guards, real faces or real PINs in tests.

## Numbers (rule `OPS-GUARD-PHONE`, `packages/core/src/rules.ts`)

| Setting | Value | Status |
| --- | --- | --- |
| Heartbeat | 60 s | Fixed (JA requirements) |
| Offline after | 5 min | Fixed (JA requirements) |
| Location kept | on duty ±30 min, max once a minute | Proposed |
| Enrol code life | 24 h | Proposed |
| Sign-in session | 14 h | Proposed |
| Wrong tries / lock | 5 / 30 min | Proposed |
| SOS repeat | a second press within 10 min updates the location, no new alarm | Proposed |
| Keep readings | 90 days (deletion job not built) | Proposed |

Read these from the server answers where they are given; proposed values may change.

## Still open (not done in any PR)

- Merge, database migration and switch-on of #121 and #120 (Fauzan's approval; the migration is CEO-only).
- Server secrets `GUARD_PHONE_SECRET` and (for the server face engine) `FACE_CHALLENGE_SECRET`, in Key Vault.
- Bulk creation of guard sign-in users (today IT creates them one by one).
- The 90-day deletion job for location readings.
- Guards are refused while the IT pilot rule (`PILOT-IT`) is on, until a rollout admits them.
- Guards still use the JA Group app. Prima's guard features run beside JA until Fauzan picks a switch date.
- Real phones, real faces and real GPS have not been tested. All tests so far are synthetic.

## Where to look

| Part | File (on the PR #121 branch unless noted) |
| --- | --- |
| Full description | `docs/GUARD_PHONE.md` |
| Routes | `apps/api/src/guard-phone.controller.ts` |
| Token | `apps/api/src/guard-phone.ts`, check in `AuthGuard` (`apps/api/src/auth.ts`) |
| Logic | `packages/core/src/guard-phone.ts` |
| Face engine | `apps/api/src/face-engine.ts`, `packages/core/src/face.ts`, `apps/web/src/views/FaceCheck.tsx` |
| PWA reference client | `apps/web/src/api/guard-phone.ts`, `apps/web/src/views/GuardPhone.tsx` |
| Duty screen data | `myDuty` in `packages/core/src/service.ts` |
| Payslips | `myGuardPayslips` in `packages/core/src/service.ts`, `docs/GUARD_PAY_RUN.md` (PR #120 branch) |
| Microsoft sign-in | `docs/MICROSOFT_SIGN_IN.md` (on `main`) |
