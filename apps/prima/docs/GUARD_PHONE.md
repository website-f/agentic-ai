# Guards on their own phones

Third audit, item 2. Fauzan answered "Build" on 5 Nov 2026. The ask: guards sign in on their own phones with face plus PIN (never the PIN alone), with live patrol location, an SOS button and a heartbeat to CMS. It reuses the face engine from PR #76.

**Status: draft.** Built on mock data. It is off unless `GUARD_PHONE=on`. Nothing is merged, migrated or deployed. Guards stay on the JA app for now (Fauzan, 3 Nov 2026); this is built ready for when they move.

## How it works

1. **Enrol the phone.**
   - The company office or HR sets the guard's PIN. These are the same people who set PINs today.
   - On the guard's record they press **Enrol phone**. This gives a one-time code (valid 24 h) and a link.
   - The guard opens the link on their own phone and types their staff number.
   - The phone gets its own random secret. Prima keeps only hashes of the code and the secret.
   - Five wrong tries cancel the code.
   - A guard has one active phone at a time. A new phone retires the old one and ends its sign-in.
2. **Register the face.**
   - On the enrolled phone, the guard types their PIN and takes one photo.
   - HR approves it on the existing face list. This is the same flow as office staff (PR #51).
3. **Sign in.** It needs all three of these:
   - the enrolled phone;
   - the PIN;
   - the face, judged on the server. With the phone engine, the server scores the descriptor from the phone. With `FACE_ENGINE=server`, a signed head-turn challenge is used once per try.

   A right PIN with a wrong or still face is refused, and so is a right face with a wrong PIN. Five wrong tries lock the phone for 30 minutes. Every refusal is written to the audit log. The phone then gets a `gp1.` token. Every request checks in the database that its session is still open, so signing out or retiring the phone ends the token at once.
4. **Heartbeat and location.**
   - The open duty screen sends a heartbeat every 60 s.
   - CMS shows the phone as Live, Late, or Offline after 5 min. These numbers come from the JA requirements.
   - Location is kept only on duty, meaning from 30 minutes before the shift to 30 minutes after it, and at most once a minute.
   - There is no on-phone notice step (Fauzan, 5 Nov 2026: "No need pdpa text").
   - Off duty, the last location is cleared from the board.
5. **SOS.**
   - The guard holds the red button for 1.5 s. This raises an ordinary `GUARD_SOS` alarm in the CMS queue, with the phone's location, and CMS acknowledges and closes it as usual.
   - SOS needs only the enrolled phone: no PIN or face, and it works off duty.
   - A second press within 10 minutes updates the location; it does not raise a second alarm.
   - If the roster cannot place the guard, the alarm says the site is unknown.

The rule is `OPS-GUARD-PHONE` in `packages/core/src/rules.ts`. The heartbeat (60 s) and offline (5 min) numbers follow the JA requirements. **All the other numbers are PROPOSED:** code life, session length, lock, duty margin, SOS repeat and keeping readings 90 days.

## Where

| Part | File |
| --- | --- |
| Logic | `packages/core/src/guard-phone.ts` |
| Switch and token | `apps/api/src/guard-phone.ts` |
| Routes | `apps/api/src/guard-phone.controller.ts` |
| Token check | `AuthGuard` in `apps/api/src/auth.ts` |
| Tables | `prima.guard_phones`, `prima.guard_phone_sessions`, `prima.guard_pings` in `db/migrations/001_init.sql` |
| Phone screens | `apps/web/src/views/GuardPhone.tsx`, opened at `#guard-phone` |
| Office card | People → person → PIN and Prima access |
| CMS board | CMS → Guard phones (`apps/web/src/views/GuardPhoneOffice.tsx`) |

The three tables use the company wall. A guard or officer sees and writes only their own rows; the API now sets `app.user_role` on each request for this.

## Switch-on steps (each needs owner approval)

1. Run the database migration. This is CEO-only (`run-db-migration.sh`).
2. Add `GUARD_PHONE_SECRET` (32+ characters, Key Vault), then set `GUARD_PHONE=on`. The API refuses to start with the switch on and no secret.
3. Choose the face engine. `FACE_ENGINE=server` (PR #76) is stronger, because the phone sends pictures only.
4. Each guard's sign-in user must exist (role `guard`, linked by `personId`). Today IT creates these; bulk creation for 8,000 guards is not built.
5. The job that deletes readings after 90 days (PROPOSED) is not built yet.
6. The guards leave the IT pilot (`PILOT-IT`) or a rollout admits them. Until then every guard phone call is refused.

## Not proved / open

- Real faces, real phones and real GPS were not tested. All tests use synthetic numbers.
- A browser keeps the heartbeat only while the screen is open. The phone app for the locked-screen heartbeat will be built by Fitri, not in this PR (Fauzan, 5 Nov 2026). It can use the same `/api/guard-phone` routes.
- The 90-day deletion job is not built.
- Bulk creation of guard users is not built.
- There is no map view; CMS sees coordinates.
- Patrol checkpoints are still tapped on the site device (NFC). The phone's location is not used as patrol proof.
