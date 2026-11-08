# Quality and compliance (ISO 9001:2015 and SIRIM/PIKM)

Owner decision, Fauzan, 5 Nov 2026: extend the existing Prima modules into one connected quality and compliance system
for the SIRIM/PIKM security services code and ISO 9001:2015, not a separate app. Build each shared piece once and map
it to both standards. Staff experience rules: one task makes one record, approvals only for real decisions, each person
sees only their own work, guards and ordinary staff never see clause checklists, and the app never declares a company
compliant.

Screen: **Quality and compliance** (`quality` view, BM+EN "Quality dan compliance"). Code:
`packages/core/src/quality.ts`, starter lists and mock rows `packages/core/src/quality-seed.ts`, screen
`apps/web/src/views/Quality.tsx`, rule `QMS-REGISTER`.

This first package holds the pieces both standards share: the register, the QMS foundation and the competency matrix. The rest of the plan is listed at the end.

## 1. Requirements and evidence register (ACT)

| Who | What they do |
| --- | --- |
| ACT (department `audit`) | Keeps the requirement list (adds, edits, retires, with history). Checks evidence with a reason, never evidence they linked themselves. Decides "does not apply" with a reason. Raises a gap as an **ACT finding**, so the existing corrective-action steps (owner plans root cause and fix, shows proof, ACT checks, reopens if the fix fails) carry it. Records the periodic review. |
| Company manager | Sees their own company only. Links the evidence that already exists (a Prima record, a document reference or link, or what was seen on site). |
| Group leaders | View only, every company they hold grants for. |
| Guards, officers, admin executives, other staff | Do not see the register. |

States per requirement and company: Waiting for the code text (PIKM Part 2 only), Does not apply, Gap being fixed,
**Unknown: no evidence**, Evidence not checked yet, Review due, **Evidence checked**. There is no "compliant" state.

- Each requirement carries its standard and edition. ISO rows are clause numbers and headings with our own one-line
  summaries; the standard's text is not copied into Prima.
- **PIKM rows follow PIKM-KDN/SIRIM 1:2022 draft, Part 1** (private security company management), received from
  Fauzan on 8 Nov 2026. Rows are clause numbers with our own one-line summaries; the code is copyright PIKM/SIRIM and its
  text is not copied into Prima. Part 2 (screening) has not been received, so its single row stays a placeholder. A
  placeholder cannot be marked checked. When ACT replaces it, it must say which page or section of the code it checked
  against; that note stays in the history. When the final (non-draft) code is published, ACT re-checks the rows.
- "Prima figures" evidence (competency matrix coverage, open ACT findings, company licences) is filled in by the server
  at that moment, never typed, and still needs an ACT check. A saved link is not proof that the content was checked.
- A fresh install starts empty. ACT presses **Load starter list** once (31 ISO rows, 25 PIKM Part 1 rows and 1 Part 2 placeholder); rows already
  there are left alone.

## 2. QMS foundation (Central Admin and ACT)

ISO 9001 clauses 4 and 5: the approved scope, the quality policy, internal and external issues, interested parties, and
the process map with owners, inputs, outputs, measures, main risks and the requirements each process serves.

| Who | What they do |
| --- | --- |
| ACT, Chief of Staff or Deputy | Keep the issues, interested parties and processes (no approval; each has a review date). Draft the scope and policy. |
| CEO | Agrees or sends back the scope and the quality policy, with a reason, never a version they drafted. A change to the agreed scope or policy is a new draft version; the one in force stays until the CEO agrees the new one. |
| Company manager, group leaders | Read what is in force (company managers do not see drafts). |

The register's rows for clauses 4.1 to 4.4 and 5.2 show the foundation figures ("scope version 1 agreed, 3 processes, 1
not linked to a requirement...") as a hint for ACT.

## 3. Role competency matrix (HR)

| Who | What they do |
| --- | --- |
| HR Admin (`u-pwvsb-hr`) | Proposes a role profile: the licences, training and skills a role needs and how often a skill is reassessed. **Load starter profiles** sends four starter profiles (guard, stationed officer, patrolling officer, office staff) for decision. |
| HR Director (Chief of Staff or Deputy) | Agrees or sends back a profile version with a reason, never one they proposed. This is a real decision because it changes who counts as qualified. |
| Company manager | Assesses anyone in their own company. |
| Stationed officer | Sees and assesses guards of their own company only. |
| Operations (OM and up) | Assesses guards and officers in the companies they cover. |
| HR | Assesses office staff. |
| Admin executive, ACT, group leaders | View only. Guards do not see it. |

- Licences and certificates are **read from HR's existing credential records** (KDN card or vetting submitted, CSG). Nobody
  types them twice; an expired card shows as expired here automatically.
- Nobody assesses themselves. Each assessment records the result (competent or not yet), how it was assessed, what was
  seen, and the refresher date.
- If the assessment follows a course, the assessor names the course. That reassessment **is** the training-effectiveness
  check ("training worked: x of y"), so there is no extra form.
- When the HR Phase 3 training log (draft PR #51) lands, the matrix should read courses from it too; not wired here
  because #51 is not on main.

## 4. Quality operations (package 1d, Fauzan 5 Nov 2026 "Build any not build")

Code: `packages/core/src/quality-ops.ts`, screen `apps/web/src/views/QualityOps.tsx` (tabs on the same screen), rule
`QMS-OPERATIONS`. Guards, officers, admin executives and storekeepers see none of it.

| Piece | ISO 9001 | Who records | Real decision | Notes |
| --- | --- | --- | --- | --- |
| Service faults | 8.7, 10.2 | Company manager (own company); Operations OM and up (sites they cover); ACT | none | One record: what happened, what was done at once, client told. A client complaint must say how the client was answered. A serious fault, or a second fault at the same site within 90 days (approved), shows "Root cause needed": ACT raises it as an ACT finding owned by the company manager. Closed as put right, client accepted (names the client person) or service stopped. |
| Supplier ratings | 8.4 | Procurement executive (all companies) or the company manager (own) | "Stop" blocks the supplier at once; only Finance unblocks (existing rule) | Scores 1 to 5 for quality, time, paperwork; low scores, watch or stop need a note. Rated again every 12 months (approved). Kept on the existing supplier record. Procurement gets a plain "Supplier ratings" screen. |
| Quality objectives | 6.2 | ACT or the Chief of Staff | none | Measure, target, owner by job title, date; progress figures; "Reached" needs a reason. |
| Controlled documents | 7.5 | ACT or the Chief of Staff | A second person (another keeper or the CEO) approves each version, never its writer | Code stays the same across versions; the old version stays in force until the new one is approved. The file stays in SharePoint; Prima keeps the link and says it is not checked. Company managers see versions in force only. |
| Management review | 9.3 | ACT or the Chief of Staff write the record | The CEO agrees the record | Prima builds the inputs pack (last review actions, foundation, complaints, objectives, faults, corrective actions, audits, suppliers, competence, register, documents) as counts, never a "compliant" statement, and keeps it with the record. |
| Corrective-action detail | 10.2 | Finding owner | (unchanged ACT check) | ACT findings get "what was done meanwhile", "where else it could happen" and "how we will know it worked". Needed on findings from the quality system (register gaps and service faults), optional on everyday findings. |

Fauzan approved on 5 Nov 2026: a second service fault at the same site within 90 days is a repeat; suppliers are rated again every 12 months; controlled documents are reviewed every 24 months by default.

## Database

`db/modules/quality-compliance-v1.sql` adds `qms_requirements`, `qms_foundation`, `comp_profiles` and `qms_items` (group-wide lists, readable by the app
role, changes checked in the service) and `qms_entries`, `comp_assessments` and `qms_nonconformities` (per company, same company wall as
`001_init.sql`). Supplier ratings are a new optional field on the existing supplier row. No delete grant anywhere. It is **proposed, not applied**. Until a CEO-approved, reviewed migration
installs it, the server screen says it is not switched on and the home page adds nothing. The test version (browser
demo) has the starter lists and mock rows.

## Approved by Fauzan (8 Nov 2026, as built)

1. Each requirement's checked evidence is reviewed every 12 months.
2. Skill refreshers every 12 months for guards and officers; office Prima and PDPA training every 24 months.
3. "Due soon" warning 60 days ahead.
4. The four starter role profiles (in `quality-seed.ts`).

## PIKM Part 1 gap list (8 Nov 2026, against the 2022 draft)

This is a reading of the code against what Prima records today. It is not an audit and does not say any company meets
or fails the code; ACT checks evidence per company in the register.

Already covered by Prima records: licences and permits (4.x, company licences), organisation and responsibilities (5.x),
office security and records (6.x), screening and conduct (7.2, HR screening file and briefings), arms (7.2.3, Arms
Control), training and competency (8.x, competency matrix and refreshers), client due diligence and contract review
(9.1-9.3), rostering (9.4), assignment instructions (9.5) and corrective action (10, ACT findings).

Gaps and owner questions:

1. **5.1, directors' involvement (legal point for directors only).** The code says directors and shareholders of one
   security company should not be involved in another security company's matters. The group's multi-company
   ownership may conflict with this. Needs legal advice; Prima does not decide it.
2. **9.5.1, assignment instructions at the site (decided by Fauzan, 8 Nov 2026: signed copy at site).** Prima still
   does not show the instructions to guards. The officer keeps the client-signed copy at the post and briefs the
   guards from it. ACT checks this on site visits as "seen on site" evidence.
3. **7.1, yearly medical from age 56.** Not tracked. Could be a dated item on the guard's file in HR.
4. **9.4, site risk assessment briefed before deployment.** Mobilisation covers the survey and risk step, but there is
   no record that officers were told of the risks before starting.
5. **6.3, office alarm and CCTV records.** Installer and maintenance records for the office systems are not kept.
6. **Personnel records kept 7 years after employment ends.** No retention rule set in Prima yet.
7. **7.2.1, code of conduct content.** HR's code of conduct policy should cover each point the code lists; HR checks
   its policy text.
8. **8.1, training policy authorised by top management.** Can use the controlled documents list with CEO approval.
9. **9.3, client information pack on request** (licence, company registration, membership, insurance). Not prepared as
   one pack.
10. **Part 2 (screening)** text not received.

## Where the other pieces are

- Screening case file and guard code of conduct: draft PR #114 (on HR #51).
- Client due diligence and assignment instructions: draft PR #115 (on Contracts #91).
- Service faults, supplier ratings, objectives, controlled documents, management review and CAPA detail: section 4
  (package 1d). The management review meeting itself is still set up in Meetings (#93 adds the agenda); this record
  holds the inputs and the decisions. Opportunities stay on the Governance risk register (#86).
- Not built: CMS device and vendor connections, video, operator Microsoft sign-in with MFA and outward alarms (need
  real hardware and tenant set-up); CMS overtime to payroll (needs an owner decision); KPI holiday calendar (on #77).

## Evidence (this change)

- Package 1d: `packages/core/test/quality-ops.test.ts` (10 tests) and a fourth PostgreSQL test in `apps/api/test/quality-rls.test.ts` (faults, root cause, supplier stop, document versions, review record, company wall and no delete on the new tables). Full core 707 passed (after review round 1), full API 683 passed on local PostgreSQL 16. Browser walk-through at 1280 and 390 px as company manager, ACT, Chief of Staff, CEO, Procurement, guard, officer, admin executive and storekeeper: 19 checks passed, no page errors, no sideways scroll.

- Core: `packages/core/test/quality.test.ts`, 16 tests, synthetic data. Full core suite 696 passed.
- PostgreSQL (local disposable PostgreSQL 16): `apps/api/test/quality-rls.test.ts` proves the screen stays off before
  install, the starter lists load through the app, the CEO agrees an ACT-drafted scope, the company wall holds for the per-company tables, and there is no
  delete. Full API suite 682 passed on the same local database.
- Browser: demo build walk-through at 1280 and 390 px as ACT, company manager, stationed officer, HR Director, CEO
  (agrees the policy) and a guard (no menu entry). Mock data only.
- 8 Nov 2026 PIKM rows: core quality tests 27 passed, full core 2187 passed, PostgreSQL quality tests 9 passed.
- Not done: staff UAT, migration, deployment, PIKM Part 2 text.
