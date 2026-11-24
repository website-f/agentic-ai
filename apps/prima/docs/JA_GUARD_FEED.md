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
| `leftOn`, `leftHow` | no | Only with `status` `left`, and always together. `leftOn` is the last working day (`YYYY-MM-DD`, not before `hiredOn`); `leftHow` is `resigned`, `terminated`, `contract_end` or `retired`. Feeds the group employment history. |

## Who sees what in Prima
- HR: every company. Full numbers behind the HR wall.
- The guard's company manager: own company. Reads the full numbers, never changes them.
- Operations: the guards in its states or companies (counts and papers, no pay).
- FWM: foreign guards' passport numbers only.
- Group leaders: view.

## Group employment history (4 Nov 2026, draft)
- Each JA record is one company's employment. A guard who left one group company and joined another, or came back after
  years, has a record per employment; Prima links them to one person by the IC or passport (`idFull`). The records stay separate.
- To build the history from JA's past, send the guards who left too (`status` `left` with `leftOn` and `leftHow`), once per
  company, in the usual batches of up to 1,000.
- Without `idFull` a record is filed but not linked; HR links it later from the history board.
- See `docs/STAFF_HISTORY.md`.

## Open
- Papers recorded in Prima (for example a CSG certificate HR keys in) flowing back to JA.
- The JA sign-in for the feed and its company grants are created by the CEO when the feed goes live.

## Uploading JA files by hand (Fauzan, 23 Nov 2026)

Fauzan: "Guard salary upload from ja app. And roaster builder and roaster uploaded from ja app." The roster is built in the JA Group app and the salary is worked out there. Who uploads: "OM uploads both", then "Let company also can upload. Which ever". So the OM or Regional OM covering the site (the OGM for government, the Operations Director for private) or the company office (Company Manager, admin executives) uploads. The panel is at the top of the Roster screen.

Save JA's export as CSV. Column names may be written in any case or with spaces ("Staff No" reads as staffNo). Templates download from the panel.

- Roster, one line per duty: `staffNo, date, start, end, post`. Date YYYY-MM-DD in the month chosen; times like 07:00; an end before the start runs to the next day; post may be empty when the site has one post. Each line becomes a published duty. Past days, inactive guards, unknown posts, duties over 16 hours and overlaps in the file are refused with the line number. A new file for the same site and month takes earlier uploaded duties that are not in it off the roster from today on (set back to draft, never deleted).
- Salary, one line per guard: `staffNo, basic, otHours, otPay, allowances, epf, socso, eis, pcb, otherDeductions, gross, net, paidOn`. Kept as that guard's JA pay summary for the month (the operations salary check, site profit and loss and the side-by-side read it). Net must be gross less the deductions within RM1. A newer upload of the month replaces each guard's line. Prima does not pay from it.

Every upload is audited (`ja.upload_pay`, `ja.upload_roster`) and logged as a JA sync.

## Guard employment agreements (Fauzan, 23 Nov 2026)

"Make sure every guard employment aggrement are uploaded." Rule GUARD-AGREEMENT: every active guard and officer needs the signed employment agreement uploaded on the HR file (People, the guard, Hiring papers; or many at once with the file helper, which files a paper named with the staff number and "agreement"). Decision card: warn only, chase daily. The roster warns (NO_AGREEMENT, never a block) once the guard is past the grace days after joining (proposed 14); the company office gets a Do today line until all are in; the HR Director and the COO see the count across companies; the People screen has a "No agreement" filter. A transfer to another company starts a fresh employment, so a new agreement is needed there.

### JA's own salary report (Fauzan's sample files, 23 Nov 2026)

JA's "Monthly Salary Type 2" report saved as CSV uploads as it is: the panel recognises its report boxes (`textBox35`, `txtGross`, `txtTotal` ...) and reads each guard line with `fromJaSalaryType2` (`packages/core/src/ja-upload-formats.ts`). The page totals repeated at the start of each line are ignored. Worked out from the samples and checked on all 34 lines of both files (each balances): gross = basic + ADE + OTP + extra OT (`textBox24`) + ODP + PHP + 31P; net = gross less EPF, SOCSO, EIS, SOCSO SKBBK (`textBox75`), DED, advance and absence deduction (`textBox3`). Prima keeps OT pay as one figure (OTP + extra OT + ODP + PHP + 31P), SOCSO with SKBBK, and other deductions as DED + advance + absence deduction. The sample files hold real staff data and are not kept in the repository; the test uses a synthetic line. Still needed: a sample of JA's roster export.
