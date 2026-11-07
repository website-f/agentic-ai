# FWM recruitment steps

Fauzan, 6 Nov 2026, IWAY answer 7: the recruitment steps are recorded in Foreign Worker Management (FWM).

## What existed before this change

- **Zero recruitment fees on arrival**: the arrival fee check in draft PR #62 (`ARRIVAL_FEE`, rule FWM-ZERO-FEE). This change reuses it. It does not duplicate it.
- **Age 18 to 60**: draft PR #81 checks this only when FWM adds a JA-only worker to Prima. It did not cover recruitment.
- **Agency licence, embassy confirmation, interview and the bilingual contract**: none of these existed.

## What this adds

There is one recruitment file per worker being recruited, under Foreign workers > Recruitment steps.

| Step | What FWM records | Paper | Rule |
|---|---|---|---|
| Agency licence | licence number and expiry | copy of the licence (needed) | An expired licence is refused. A licence that runs out before travel blocks clearance. |
| Embassy confirmation | reference | the embassy's letter (needed) | |
| Interview | interviewer, passed or not | optional | A fail needs a reason and stops the file. |
| Age check | date of birth from the passport | the passport page (needed) | The age is counted to the planned travel date and must be 18 to 60 (FWM-RECRUIT-AGE). Outside that range, the file stops. |
| Contract | date signed, languages | signed contract (needed) | It must include English and Malay, and may add the worker's mother tongue (FWM-CONTRACT-LANG). It must be signed on or before the planned travel date. |
| Zero fees (after arrival) | from the arrival fee check | (PR #62) | Waiting, then confirmed, or fee open or fee closed. |

- Only the **FWM Manager or Deputy** can clear the worker to travel. All five steps must be on record and must fit the travel date.
- **On arrival**, FWM links the worker's staff record by staff number in the permit company. One staff record can be linked to only one file.
- **Recording a step again** needs a reason. The earlier version is kept in the history.
- **Moving the travel date** after clearance re-checks the steps. If they no longer fit, the clearance is withdrawn.
- **A stopped file** keeps its reason. Nothing is deleted.
- **The passport number** is stored as its last 4 characters only.

## Who sees what

- **FWM staff** record. The despatch cannot see the board.
- **Group leaders** see everything.
- **A company manager** sees their own company's files with step status only. They do not see notes, the date of birth, the licence or embassy numbers, the fee answer, or the papers.
- **Papers** (`fwr-` prefix) open for FWM and the group leaders only.

## Database

- The new table is `prima.fw_recruit_files`, in `db/modules/fw-recruit-v1.sql`. It uses the company wall and forced RLS, with no DELETE.
- The catalogue check is `apps/api/src/fw-recruit-readiness.ts`. The proposed manifest entry is `db/proposed/fw-recruit-module.json`.
- The module is **not** in the release manifest and is not applied by any script. Installing it is a separate step that needs the owner's authorization.
- The shared seed leaves the table empty. The browser demo adds two mock files.
