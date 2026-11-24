# PDPA officer: department check gaps (23 Nov 2026)

Fauzan, 23 Nov 2026: "Do the gap" on the study note "PDPA officer: department check". Source only: nothing here is
migrated, deployed or switched on.

| Item | What it does | Where |
|---|---|---|
| B1 Do today | The officer's work, most urgent first: breach clocks, data requests due in 5 days or late, DPO not notified, client consent waiting, client PDPA steps, certificates expiring, register entries due, the weekly clean-up OK, devices and staff questions, and what the Chief of Staff did while the officer was away. | PDPA screen, top |
| B2 Personal data downloads | Every logged download of pay, medical, bank or personal details (90 days): who, when, screen, rows, reason, reference. Officer and monitors read only. | PDPA > Personal data downloads |
| B3 Client PDPA step | The client's onboarding step "PDPA notice and client consent" closes only by the PDPA officer: from a client consent case with consent given, or with the reason no consent is needed. Operations can no longer tick it. | PDPA > Client consent |
| B4 Lost or stolen device | When a person reports a device lost or stolen to IT, a line goes to the officer's inbox. The officer opens a breach case (the 72 hours count from the report) or closes it with the reason no personal data was exposed. | PDPA > Inbox |
| B5 Keep periods | One read-only list of every keep period, its rule and whether it is set or Unknown. | PDPA > Keep periods |
| D1 Clean-up OK | The daily clean-up jobs (`purge-retention`, `purge-locations`) delete only while the officer's OK for the week is valid (7 days), and add each run to it. Counting what would go needs no OK. | PDPA > Keep periods |
| D2 Ask about my data | Every signed-in staff member can ask to see, correct or take a copy of their data, withdraw a consent or object. The officer logs it as a data request; the 21 days count from the day asked. The audit line names no data. | My details |
| D3 Chief of Staff cover | While no PDPA officer is on the books, or every officer is on approved leave today, the Chief of Staff acts on breaches, data requests and the inbox. Every step is marked as cover and shown to the officer for two weeks. Client consent, social media, products and the register wait for the officer. | PDPA screen, CoS Home |

## Database module

`db/modules/pdpa-officer-v1.sql` (not on the release list): `prima.pdpa_inbox` (the asker writes and reads only their
own lines; the PDPA wall reads all and handles; a handled line never changes) and `prima.pdpa_purge_oks` (PDPA wall
only; the administrator login used by the clean-up jobs reads the OK and adds its run; an OK only gains runs). Until it
runs: the inbox and Ask about my data say "not installed", device reports go to IT only, and the clean-up deletes
nothing.
