# Governance registers (light listing-style governance)

Owner decision, Fauzan, 5 Nov 2026: the group is not going to list (his statement: KDN does not allow a listed security
company), but Prima should follow listing-style governance "a little bit". This adds four light registers, not Bursa
rules. A private company is not bound by them.

Second round, Fauzan, 5 Nov 2026 (answers to the seven proposals): the Deputy Chief of Staff records deals and
declarations, the Chief of Staff reviews them; the board limit is a CEO setting, not set yet; directors declare once a
year on a paper form the Deputy Chief of Staff collects; the risk register is ACT only, run by the ACT Director.

Screen: **Governance registers** (`registers` view, BM "Daftar tadbir urus"). Code: `packages/core/src/board-registers.ts`,
mock entries `packages/core/src/board-registers-seed.ts`, screen `apps/web/src/views/Registers.tsx`, rule `GOV-REGISTERS`.
Each person sees only the registers that are theirs; the others are not shown at all.

## The four registers

| Register | Who records | Who reviews | Who sees it | Rule |
| --- | --- | --- | --- | --- |
| Related-party deals (rent, loan, purchase, fee, rental with a director, shareholder, family, their companies, or another PWVSB company) | Deputy Chief of Staff | Chief of Staff, with a reason; never someone named as interested | Deputy Chief of Staff, Chief of Staff, CEO | No board step until the CEO sets a limit. Once set, deals at or above it also need the company's board resolution with the interested directors out of the vote |
| Directors' interests | Deputy Chief of Staff, from the signed yearly form collected by hand, and marks the director done for the year | Chief of Staff reads it with a comment | Deputy Chief of Staff, Chief of Staff, CEO | Once a year and whenever something changes; Companies Act 2016 s.221. No declaration shows as Unknown, never clear |
| Board committees | The company; PWVSB's by control | None (records only) | The company and group leaders | Members, one chair, how often it meets, minutes per meeting. An audit committee without an independent majority is a note only |
| Risk register | ACT Director | ACT Director gives each risk to an ACT team member with an instruction; the team member reviews it; the ACT Director settles and closes it | ACT Director, ACT team, CEO (view only) | 5 x 5 likelihood and impact; 15+ is high, needs an action and due date, reviewed every 3 months; others every 6 |

The board limit: the CEO sets it on the deals tab with a reason; empty means no board step. Every change is kept in its
history and written to the audit trail.

Every change writes an audit entry. A deal's counterparty is matched against declared interests by name to help the
reviewer; the match is a hint, never a decision. Prima never approves on the board's behalf, signs or files.

## Database

`db/modules/governance-registers-v1.sql` adds five tenant tables (`reg_related_parties`, `reg_interests`,
`reg_committees`, `reg_risks`, `reg_settings`) with the same company wall as `001_init.sql`, and no delete grant. Two
department walls are added on top (restrictive policies): `reg_desk` (Deputy Chief of Staff, Chief of Staff, CEO) for
deals, declarations and the board limit, and `reg_risk` (ACT and the CEO) for risks. So a company manager or the COO
cannot read deals even with a direct database query.

It is **proposed, not applied**. Until a CEO-approved, reviewed migration installs it, the server screen says the
registers are not switched on and the home page adds nothing. The test version (browser demo) has them with mock entries.

## Still for the CEO to decide

1. The board limit amount (built as a CEO setting; not set).
2. Risk scoring 5 x 5, high at 15, reviews every 3 and 6 months (proposed).

## Evidence (this change)

- Core: `packages/core/test/board-registers.test.ts`, synthetic data.
- PostgreSQL (local disposable PostgreSQL 16): `apps/api/test/governance-registers-rls.test.ts` proves the screen stays
  off before install, the Deputy Chief of Staff records and the Chief of Staff reviews, the company wall on all five
  tables, the two department walls, and no delete for the app role.
- Browser: demo build walk-through at 1280 and 390 px as Deputy Chief of Staff, Chief of Staff, CEO, ACT Director, ACT
  team member, company manager and COO, in BM.
- Not done: staff UAT, migration, deployment.
