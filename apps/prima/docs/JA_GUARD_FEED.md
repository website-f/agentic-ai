# JA Group app: guard feed to Prima (slice 3G, draft)

For the JA Group app developers. Status: draft PR only, not deployed. The feed is tested with synthetic data only.

## Why
Guards are keyed in once, in JA. Prima files each guard as the single record used by HR (CSG, KDN card, vetting, minimum wage), the guard's company and Operations. No department types the guard in again.

## Call
- `POST <staging-api-url>/api/integrations/ja/v1/guards`, signed in as the JA feed's own system account (integration `ja`). Staff accounts are refused.
- Body: `{ "records": [ ...up to 1,000 guards ], "covered": ["<company code>", ...] }`.
  - `covered` lists the companies this delivery fully covers, so a company with no change still shows as current.
- Reply: `{ "accepted": n, "rejected": [{ "externalId", "reason" }] }`.
  - Nothing is dropped silently.
  - Resending the same record, or an older copy, changes nothing.
- A company with no delivery for longer than the JA stale limit shows as **unknown** in Prima, never as fine.

## One guard
| Field | Required | Notes |
|---|---|---|
| `company` | yes | Prima company code |
| `externalId` | yes | JA's own id for the guard, up to 80 characters |
| `updatedAt` | yes | Date and time of the last change in JA. The newer copy wins. |
| `staffNo` | yes | The guard is matched on company + staff number |
| `name` | yes | |
| `nationality` | yes | `MY` or `NP` (Malaysian or Nepali). Anything else is refused. |
| `role` | yes | `guard`, `supervisor` or `patrol_officer` |
| `status` | yes | `active`, `suspended` or `left` |
| `dob`, `hiredOn` | yes | `YYYY-MM-DD` |
| `state` | no | Branch state. It places the guard in that state's branch. |
| `siteCode`, `phone` | no | |
| `idFull` | no | Full IC or passport. Kept only behind Prima's HR wall; Prima shows the masked form elsewhere. |
| `accountFull`, `bankName` | no | Full salary account, behind the HR wall. A change is audited. |
| `basicPay` | no | RM a month. Used for the minimum wage check. |
| `epfNo`, `socsoNo` | no | |
| `kdnCard` | no | `{ "number", "issuedOn", "expiresOn" }` |
| `vettingSubmittedOn`, `vettingRef` | no | eSIMS vetting submission |
| `csg`, `tng` | no | `{ "certificateNo", "doneOn" }` |

## Who sees what in Prima
- HR: every company. Full numbers behind the HR wall.
- The guard's company manager: own company. Reads the full numbers, never changes them.
- Operations: the guards in its states or companies (counts and papers, no pay).
- FWM: foreign guards' passport numbers only.
- Group leaders: view.

## Open
- Papers recorded in Prima (for example a CSG certificate HR keys in) flowing back to JA.
- The JA sign-in for the feed and its company grants are created by the CEO when the feed goes live.
