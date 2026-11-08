# FWM permit board: real use in Prima and the JA Group app

Owner decision: Fauzan, 5 Nov 2026 (audit decision 1, "what is still not built"): the foreign worker permit and
renewal board lives in **both** Prima and the JA Group app. This branch turns the October sample board into one FWM can
run on real records. Repository code and tests do not show deployment, migration, live JA connection or staff UAT.

## What changed

| Area | Before (main 440aa83) | Now |
|---|---|---|
| Paper dates | Only from the sample data set; no screen or action could record a real PLKS, passport, FOMEMA or insurance date | FWM records each paper from its copy (copy required), corrects a typing mistake with a reason (old values kept), or takes the JA app's date |
| Renewal done | "Renewal submitted" paused the ladder for ever; there was no way to enter the new date | Recording the new paper closes the submitted renewal (`doneCredentialId`) and the ladder restarts on the new date |
| Acknowledgement (FW design v3) | Not built | At 30 days or less everyone alerted acknowledges within 1 working day (rule `FWM-ACK`): FWM and Chief of Staff from 30 days, COO from 15, CEO from 7. Late acknowledgements are counted and flagged |
| JA app dates | Shown only on the separate "JA app data" screen, and only when JA owned FWM | Shown beside Prima's date on every paper. When the two differ the ladder counts to the **earlier** date until FWM settles it. A JA "renewal submitted" pauses only the date it is about |
| Workers only in JA | Invisible to the FWM board | On the ladder marked "In JA only"; FWM adds them to Prima (branch, hire date, date of birth), with their JA paper dates marked "From JA" |
| Prima to JA | Nothing went back | Signed feed endpoint gives the JA app what FWM recorded in Prima, so both boards stay the same |
| Large lists | First 200 rows, no filter | Search by name or staff number, company, paper and "show only" filters, paging by 100; Workers tab to find any worker |
| Papers | PLKS, passport, FOMEMA, insurance | Also SPIKPA and the KDN approval letter (from year 4) |
| Rule SYS-JA-OWNS | FWM planned to move to JA only | FWM removed from `planned`; new rule `FWM-BOTH-APPS` |

## Who can do what (enforced in the service, not only the screen)

| Action | Who | Refused for |
|---|---|---|
| Record, correct, take JA date | FWM Manager, Deputy, Executives | FWM despatch, OMs, company managers, HR, COO, CEO |
| Acknowledge | Anyone the paper has reached at 30 days or less, at their own level, once per expiry date | Despatch, OMs; a level not yet reached (e.g. COO at 30 days) |
| Add a worker from JA | FWM staff | Everyone else; absconded or exited JA workers; non-Nepali; age outside 18 to 60; branch of another company; duplicate staff number |
| Read Prima changes back | The JA feed system sign-in only (`integration: 'ja'`) | Every staff account |

Passport numbers are kept as the last 4 characters only (`****5678`), in Prima and in what goes back to JA. The full
number stays in the JA app and the restricted vault. A worker added from JA gets an empty masked ID until HR records it.

## Data and database

No new table and no migration. Everything uses existing JSONB tables that already allow insert and update for the app
login and sit inside the company wall: `prima.credentials` (new optional fields `source`, `docIds`, `recordedBy*`,
`jaRecordId`, `jaUpdatedAt`, `fwAcks`, `corrections`), `prima.people`, `prima.fw_renewals` (`doneCredentialId`,
`doneAt`) and `prima.ja_records`. Copies of papers are evidence documents linked by `fwmId` = the paper id.

## JA feed: what Prima sends back

`POST /api/integrations/ja/v1/foreign-worker-papers/changes`, signed exactly like the deliveries (`X-Api-Key`,
`X-Timestamp`, `X-Signature` = HMAC of `ts.body`). Body: `{ "since": "<asOf or next from the last call>" }`, or `{}`
for everything.

```json
{
  "asOf": "2026-11-05T10:00:00+08:00",
  "records": [
    { "kind": "paper", "company": "<company-code>", "staffNo": "<staff-no>", "paper": "PLKS", "number": "<number>",
      "issuedOn": "2026-11-05", "expiresOn": "2027-11-04", "changedAt": "...", "corrected": false },
    { "kind": "renewal_submitted", "company": "<company-code>", "staffNo": "<staff-no>", "paper": "FOMEMA",
      "expiresOn": "2026-12-01", "submittedOn": "2026-11-05", "channel": "FOMEMA", "changedAt": "..." }
  ],
  "more": false,
  "next": null
}
```

Only papers FWM recorded or corrected in Prima (`source: 'prima'`) leave; sample rows and dates that came from JA never
go back as if Prima had seen the paper. Up to 1,000 records per call; when `more` is true call again with `since: next`.

Paper codes: Prima `PLKS_PERMIT`, `PASSPORT`, `FOMEMA`, `FW_INSURANCE`, `SPIKPA`, `KDN_LETTER` match JA `PLKS`,
`PASSPORT`, `FOMEMA`, `FWIG`, `SPIKPA`, `KDN_LETTER`.

## Decisions (Fauzan, 5 Nov 2026)

1. JA `FWIG` is Prima's "Foreign worker insurance": confirmed.
2. SPIKPA and the KDN approval letter are on the reminder ladder. A missing KDN letter counts as a gap only from service
   year 4 (FWCMS: years 4 to 13 need the KDN letter to renew the PLKS).
3. The 1 working day skips Saturday, Sunday and public holidays. Rule `FWM-ACK` holds the national weekday holidays:
   9 Nov 2026 (Deepavali replacement), 25 Dec 2026, and the 2027 Cabinet Division schedule (Hari Raya and Deepavali
   dates subject to change). 2027 replacement days and state-only holidays are not in the list yet; update it each year
   from the official schedule.
4. When the two apps differ, the board counts to the earlier date. Nothing is overwritten until FWM chooses.

## Not done here

- Alert delivery to Teams or email (on-screen only; the alerts outbox is on draft PR #73).
- Hostels, check-out memo and the long-SOCSO-MC permit task (from the earlier FWM backlog).
- No deployment, no merge, no JA connection test against the live JA app (a JA test copy is needed).

## Tests

- `packages/core/test/fwm-real-use.test.ts` (16 tests, synthetic data): record, correct, passport masking, server
  refusals, acknowledgement levels and lateness, JA date compare and pause, JA-only workers and adding them, stale
  feed, the send-back feed.
- `apps/api/test/rls.test.ts`: one new test through the restricted database login on a local PostgreSQL 16:
  company wall on the new paper, despatch refused, Chief of Staff acknowledgement stored, COO refused at 30 days, JA
  worker added, send-back feed for the JA sign-in only.
- Browser walk-through on the demo build at 1280 and 390 px: `/mnt/project-files/reviews/fwm-real-use/`.

## Review round, 5 Nov 2026 (Fauzan: "Review from all angle. Test and push")

| # | Angle | Finding | Fix |
|---|---|---|---|
| 1 | Data integrity | Paper ids were built from the time only; two papers for one worker in the same millisecond (adding from JA, then recording) clashed | Ids carry a random suffix |
| 2 | JA feed | `since` compared as text, so a UTC cursor (`Z`) and a Malaysia-time cursor (`+08:00`) gave different answers | Compared as instants; invalid cursor refused |
| 3 | JA feed | `asOf` was taken after reading, so a change saved during the read could be skipped; a page could split records with the same time | Cursor taken before reading (1 ms early, repeats are harmless); pages never split one instant |
| 4 | JA feed | Reads back were not in the activity log | Each read is audited (`ja.fw_papers.read`) |
| 5 | Privacy | Paper numbers went to leaders and company managers; older and sample passport numbers were shown in full | Numbers for the FWM team only; passports always last 4 characters on the board and in the feed |
| 6 | Workflow | With Prima and JA dates different, a renewal FWM submitted did not pause the ladder (it was keyed to Prima's date while the board counted to JA's) | A submitted, not yet done renewal pauses the paper whichever date it was recorded against; the "Renewal submitted" button shows only when Prima holds a date |
| 7 | Workflow | A JA date taken today (today stands in as the issue date) blocked recording the real paper issued today | For JA-sourced dates only the expiry is compared |
| 8 | Control | A correction could move an expiry years later with no copy, hiding an expired permit | Moving an expiry later needs the copy; moving it earlier needs only the reason |

Checked with no change needed: company wall on every new action (service and PostgreSQL), despatch and OM refusals,
acknowledgement only at one's own level, CEO level only for the CEO account, no automatic status change from JA, no
person added for absconded or exited JA workers, concurrent writes held by row locks, no new table or migration.
