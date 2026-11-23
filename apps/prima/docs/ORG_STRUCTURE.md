# Org structure and org chart

Fauzan, 23 Nov 2026: "Recheck and rethink the organizational structure and also organizational chart. Make sure every
head can put who staff under it. So every task can be set correctly."

## 1. What main had before this change (review of 08995cb)

| Area | How "who is my manager" was decided | Problem |
| --- | --- | --- |
| Line manager (work.ts `lineManagerOf`) | Fixed rules from job fields (itRole, financeRole, fwmRole, procRole, actRole, opsTier, leadership) and from job titles ("Manager", "General ...") | Nobody could change a line in the app. Title words decide some lines. Where no rule fits, the Chief of Staff is shown as an *assumed* manager. |
| Staff record `reportsTo` | Free text name, typed by HR | Used only for leave asked by a manager; a name match, not an account. |
| Company office desks (company-office.ts) | Company head sets owner and backup per desk | Works; covers desks, not reporting lines. |
| Work rebalance, team board, help escalation, team memos, claim checks, toolbox and meeting heads | All follow `lineManagerOf` | They inherit every gap above. |
| Time slips | Company head, else a department head by job (IT Manager, ACT Director, FWM Manager, FD, HR Director, CoS, OGM, Asset Director) | Arms Control, CMS, Transport, PDPA, Legal, Director Office and Marketing had no head, so their slips fell to HR. |
| Department head marker | None. Each module guessed (time slips, shared logins, meetings) | Arms Control, CMS, Transport, PDPA, Legal, the Director Office and Perfect Global Logistics had no head marked, so their heads could not see their team's items (found by the shared-logins work, PR #147). |
| Finance | FD, then 7 teams (leader, deputy, 2 data entry); the FD assigns each company to a team | Works. Finance executives outside a team (asset oversight, credit officer) report to the FD by rule. |
| IT | Manager, Lead, 4 Executives; Manager under the COO | Works. |
| ACT | Director, ACT Manager, 2 teams (Auditor + Enforcement) | The ACT Manager had no rule (assumed under the CoS). **Fixed**: ACT Manager → ACT Director. |
| Procurement and Inventory | Executive under the OGM | The Inventory Manager had no line (assumed under the CoS), and the executive skipped the Inventory Manager. **Fixed**: executive → Inventory Manager → OGM. |
| Operations | Patrol → OM (by state in the title) → Regional OM → Operations Director / OGM → COO → CEO | A patrolling officer in a state with no OM and no ROM coverage (sample: Perak) was assumed under the CoS. **Fixed** (Fauzan, 23 Nov 2026: "Any om delegated by ogm"): such an officer is under the OGM, and the OGM puts them under any OM or Regional OM in the chart. Guards and officers stay in the JA app for about a year, so this stays light. |
| Transport | Head of Transport under the COO | **Fixed** (Fauzan, 23 Nov 2026: "Ogm but coo oversears"): the Head of Transport reports to the OGM; the COO oversees (sees the chart and checks Transport work with a reason). |
| Marketing (PR #146, draft) | Not on main | Its head is named in the chart and reports to the COO (Fauzan, 22 Nov 2026: central Marketing under the COO). |
| Escalation ladders (cases, FW renewals 120/90/60/30/15/7, approvals by job) | Fixed by job | Correct as designed; unchanged. They do not depend on the chart. |

## 2. Proposed structure (what is built)

```
CEO (Fauzan)
├── COO ── Operations Director (private, Sasa Team) ── Regional OMs ── OMs ── patrolling officers ── site officers
│        ├── OGM (government, Goodwill Empire) ── Procurement and Inventory (Inventory Manager → Executive → Storekeepers)
│        │                                      ├── Head of Transport (PGL), COO oversees
│        │                                      └── patrolling officers in states with no OM, until the OGM delegates an OM
│        ├── IT Manager ── IT Lead ── IT Executives (Merdeka Network)
│        ├── Arms Control head ── Arms Control staff, CMS Head Controls
│        ├── Marketing head ── Marketing staff
│        └── General Manager / Company Manager of each licensed company ── Branch Managers, Admin Executives
├── Finance Director ── 7 Finance teams (leader → deputy, data entry), credit officer, asset finance
├── Chief of Staff / HR Director ── Deputy CoS, central HR, FWM, Legal, Director Office, insurance section
├── ACT Director ── ACT Manager, Auditors, Enforcement officers
└── Asset Director ── Asset Management staff
Chairman, Vice Chairman: top of the group, report to nobody in the chart.
```

What every head can now do (screen **Org chart**, menu for office staff):

1. **See their own line**: the people above them and everyone under them. Group leaders, the HR Director and central HR see
   the whole group (group data stays with group leaders, as before).
2. **Put staff under them**: choose a person already in their line or in a unit they head, and put them directly under
   themselves, or under someone already in their own line, with a reason. Back to the line from the job at any time.
3. **Roles for a while or for good** (Fauzan, 23 Nov 2026: "Some staff have a few roles it hold for a while or for the
   whole"): one person can head or deputise several units, and any line or named role can carry a last day ("Until").
   After that day the role lapses and the person goes back to the line from the job. Empty means it holds until changed.
4. **The OGM delegates patrolling officers** to any OM or Regional OM (only patrolling officers, only under an OM or ROM).
5. **The CEO and the HR Director (CoS or DCoS)** can set any line, across heads and companies (HR governs HR in every
   company). A move between two heads goes to them.
6. **Naming unit heads**: the CEO or the HR Director names the head and deputy of each central department (16, including
   Marketing) and central company (PWVSB, Merdeka, Goodwill, Sasa Team, PGL). A named head is the manager of the unit's
   staff who have no line set, approves their time slips, and sees the unit on the chart and on the shared login list.

Rules kept:

- Nobody sets their own line, nobody names themselves head or deputy, nobody is put under themselves, and a loop is refused.
- A head cannot move their own manager, or anyone outside their line or unit.
- The CEO, Chairman and Vice Chairman report to nobody in the chart.
- Every change needs a reason and goes in the audit log.
- Guards and site devices are not on the chart (guards stay in the JA app). Patrolling officers can be a manager.

## 3. What follows the chart

`lineManagerOf` now reads, in order: (1) the line a head set, (2) the existing job rules for IT, Finance, FWM, ACT,
Procurement and Operations, (3) the named head of the person's department or central company, (4) the remaining job rules,
(5) the Chief of Staff, marked assumed. So these all follow the chart without further change:

- My work (manager shown), the team board, help asked (and its 30-minute escalation up the line), work rebalance
  (who is in a manager's team, who work can move to), one-to-ones;
- team memos (audience "my team");
- staff claim checks for central staff (line manager);
- time slips (named department heads approve);
- leave asked on a staff member's behalf (by the manager a head set, as well as the old typed name);
- department toolbox meeting chairs and the monthly general meeting's department heads.

Not changed (by design): case escalation, the FW renewal ladder, approvals by job (payroll, payments, promotions), the
company office desks and the Finance team per company.

## 4. Database module (Fauzan runs it later, with the others)

| Module | File | Table | Notes |
| --- | --- | --- | --- |
| `org_lines` | `db/modules/org-lines-v1.sql` | `prima.org_lines` | Not in `db/release-manifest.json`. Repeat-safe. Ids and reasons only. Read open to the app role (read with every users read, before walls). Insert/update only as yourself; never your own line; head rows only by the CEO, CoS or DCoS and never naming yourself; no delete. |

Before the module is run, the chart shows the lines from each job and every change is refused with a clear message.

## 5. Decisions (answered by Fauzan, 22 and 23 Nov 2026, all built)

1. **Transport**: the Head of Transport reports to the OGM; the COO oversees.
2. **Marketing head**: reports to the COO ("CEO and or COO"); the CEO can put the head directly under himself in the chart.
3. **Patrolling officers with no OM for their state**: under the OGM until the OGM delegates any OM.
4. **Staff with several roles**: several named roles per person, each for good or until a date.

## 6. Checks

- `packages/core/test/org-structure.test.ts`: visibility, gaps, moves inside a line, refusals (outside the line, above
  you, yourself, loops, the top), Company Manager and HR Director moves, naming heads, time slips, laying lines over
  users, and the not-installed state.
- `apps/api/test/org-lines-pg.test.ts` (PostgreSQL 16): not installed → refused in words; module repeat-safe, RLS forced,
  no delete; a head's line reaches the team board and My work; forged rows refused by the database; a named head's mark
  rides into their own request.
