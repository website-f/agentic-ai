# Arms Control changes from Part V (14 Nov 2026)

Source: arms briefing minutes 20 Oct 2026 and Fauzan's answers V-X9 and V-X10. Code: `packages/core/src/arms-policy-service.ts`, firearm identity in `service.ts`. Database module: `db/modules/arms-policies-v1.sql` (not on the release list; the CEO installs it).

- V14 monthly firearm record: one record per firearm per month from November 2026, done before the 28th. Condition is a choice (good, needs attention, unusable), "Tiada masalah" is a tick (typing NA is refused), a photo is required, and "maintenance done" needs the maintenance form and a recorded vault extinguisher. Reminder from the 21st, red after the 28th. The 120-day check stays.
- V15 vault fire extinguisher: serial or location, last service, expiry (after the service date) and the certificate copy. The board warns 30 days before expiry and flags missing or expired. It is a safety flag and never blocks an issue.
- V16 no double records: a serial is typed twice and the two must match; a serial already in the group is refused (the same batch included); no second licence with the same number for the same person; no second vault with the same police approval number. "Sejarah" shows what changed, who and when, from the audit log.
- V17 records still to fill per company: firearm serial, licence ref and expiry, vault; vault approval ref and expiry, A-licence holder and Amra; CNU / Bodyguard licence number and expiry.
- V18 missed application dates: a licence past expiry with no renewal application, and a vault application step past its time with no follow-up.
- V19 ammunition for an A-licence holder: through the Part R purchase request (V-X10); no separate flow.

Never: trade stock for the dealer licence and the shared vault stay off. Prima does not log in to any government system.

There is no bulk loader for firearms yet. When one is built it must stop on a duplicate serial or tag (ledger).
