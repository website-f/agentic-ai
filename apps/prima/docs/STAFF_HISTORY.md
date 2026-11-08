# Group employment history (draft)

Status: draft PR only. Not merged, not migrated, not deployed. Tested with synthetic data only.

## Why
Fauzan, 4 Nov 2026: "Build a database of all guard history. Because guard sometimes leave the company a and join back
company b. Or leave for few year and come back to work in different company. So we need a database of all staff history."

## The rule it keeps
Each licensed company keeps its own employment record (V7: never merge legally separate employment records). The history
does not merge records. It links them: every company record of the same person points to one group person.

## How records link
- By IC or passport. Prima never stores the number in the history tables. It keeps a keyed hash (HMAC-SHA256) made with
  the same Key Vault secret as staff PINs (`PIN_PEPPER`), under its own label. Without that key, linking is off and the
  screens say so. Nothing falls back to the plain number.
- "900101-10-1234" and "900101101234" match. A Malaysian IC and a passport never match each other.
- The link is made whenever the number is written: HR saves an office staff record, the JA feed files a guard, or a
  transfer creates the new employment. A corrected number moves an automatic link.
- A renewed passport or an old IC does not match. HR (local staff) or FWM (foreign workers) links the record by hand,
  with a reason. A hand link can be separated again, with a reason. Records with different dates of birth are refused.
- Records filed before this feature: HR presses **Link existing records** on the history board (up to 2,000 at a time).

## Who sees what
Fauzan, 4 Nov 2026: "Only rom or higher can see staff history when they key in the person ic or passport. Fwm managemnt
can see also. But they see what they key in. Not everyone. If the person are flag dont hire again. Then it will put red
notice."

| Who | What |
|---|---|
| HR, HR Director, CEO | They keep the history: the board (people who came back, rehire marks, records not linked), the history tab on every profile, how each employment ended and why, discipline counts per employment (not case text), rehire reasons, old-file entries, how the records are linked. HR officers see Malaysians; the HR Director and CEO see everyone. |
| FWM management (manager, deputy) | The full history of a foreign worker, only after typing their passport number. No list of people; the board shows counts and **Link existing records** only. |
| Regional OM, OGM, Operations Director, COO, other group leaders | Only by typing the IC or passport: a summary of that one person (each group company, job, dates, the rehire mark, CSG/TNG). No reasons, discipline or staff numbers. No list, no profile tab. |
| Company heads, OMs, FWM executives, admin executives, supervisors, guards, IT | Nothing. |

A person marked **Do not hire again** shows a red notice wherever their history is seen.

Each lookup is audited with the masked number (never the number itself), and each person outside HR has 30 lookups a
day (DECIDED, Fauzan, 4 Nov 2026 07:15Z). FWM management may open a foreign worker's full record only on the day it looked them up.

Safeguards from Arisha main's review (4 Nov 2026):
- A rehire mark follows the records when they are linked to another person (a renewed passport, a corrected number):
  the strictest mark wins and is audited (`history.mark_carried`), so "do not hire again" is never lost by relinking.
- A decision by lookup binds to the exact keyed number the same person looked up in the last 30 minutes (DECIDED,
  Fauzan, 4 Nov 2026 07:15Z), not to the masked last digits.
- The database refuses a decision about the caller's own records (`prima.history_set_mark`), reading links the caller
  cannot see.
- HR officers look up and read Malaysians only and FWM management foreign workers only, in the API and in the database
  (`history_local` wall, and the lookup function filters before returning anything).

In the database, only HR (`staff_history`), FWM management (`fw_history`, foreign workers) and the JA feed (`guard_feed`,
its own guards) have table policies on `prima.person_links`, `prima.group_people` and `prima.group_person_notes`.
Everyone else reads one person at a time through `prima.group_history_lookup` (`history_lookup` wall), which answers only
for the number typed.

## Rehire decisions
- HR marks a person **Can be hired again** or **Check with HR before hiring**, with a reason.
- **Do not hire again** is decided only by the HR Director (Chief of Staff or Deputy), the COO, the OGM, the Operations
  Director or the CEO, with a longer reason. Only they can lift it again. The COO, OGM and Operations Director decide
  from the lookup, after typing the number (`prima.history_set_mark`, `history_mark` wall), and see the earlier reasons.
- Prima suggests a look (for example after a termination or a dismissal), but never decides and never blocks a hire.
  Discipline is never automatic.
- HR is told on Home (red for do not hire again) when a marked person joins a group company again.

## Papers
- CSG and TNG belong to the person. HR can carry a certificate from an earlier employment to the current record when that
  record has none (so the guard is not sent for CSG again).
- The KDN guard card and eSIMS vetting never carry over. Each employer applies again. (Legal point to confirm with KDN.)

## Old paper files
HR or FWM can add an employment from before Prima (company, job, dates, how it ended, the file reference). It shows in the
summary as "from an old file"; the file reference stays with HR.

## JA Group app
Guards stay keyed in JA. JA may now send `leftOn` and `leftHow` with a guard who left, so the history shows when each
employment ended. Sending past (left) guards once builds the history from JA's past. See `docs/JA_GUARD_FEED.md`.
If the feed is not granted one of the earlier companies, the guard is still filed; the link is left for HR (audited as
`history.link_deferred`) and shows on the board as not linked.

## Before go-live (owner decisions and gates)
1. Visibility and "do not hire again" decided by Fauzan on 4 Nov 2026 (above); he confirmed the build as is ("Do it."),
   with HR keeping the full board and no further role for "do not hire again".
2. KDN and PDPA points below.
3. Database migration (new tables, policies and functions in `db/migrations/001_init.sql`; base hash repinned in
   `db/release-manifest.json`) needs the CEO-run migration.
4. `PIN_PEPPER` must be set in production; otherwise linking stays off. Rotating it breaks existing links (they must be
   rebuilt with **Link existing records**).
5. PDPA: the history keeps employment data after people leave. Retention period to be set by HR and the PDPA officer.
6. KDN: confirm the CSG certificate is accepted at the new employer.

## Tests (synthetic)
- `packages/core/test/staff-history.test.ts`: linking, summaries per role, rehire, check before hiring, hand links, old
  files, paper carry, no-key behaviour, JA leaving fields.
- `apps/api/test/staff-history-pg.test.ts`: the same on PostgreSQL with row-level security, including the database
  function and a feed not granted the earlier companies.
- `scripts/staff-history-browser-uat.cjs`: HR, HR Director, company head, OM, Regional OM and COO in the browser test
  version, at 1280 and 390 px. Runs in CI (synthetic-browser job); results and screenshots in the `hr-browser-results` artifact.
