> Current integration checkpoint (7 November 2026): source integration is not deployment or operational acceptance. Preserve PR129 repairs and the refreshed PR61 ledger. All departments begin the learning programme on18November; earlier sequential rollout dates are historical. Guard payroll stays trial-only; providers, grants, new modules and real-data activation remain separately gated. Staff/device UAT is deferred, not waived.

# Prima Secure — implementation and review guidance

## Current work

Prepare the online IT pilot as one reviewed candidate. Repository code and tests do not establish deployment, database migration, tenant permissions, runtime health, security certification or completed staff UAT. Check the current branch and exact candidate evidence before making claims.

Read `docs/MONDAY_PILOT_REQUIREMENTS_MATRIX.md`, `docs/MONDAY_PILOT_COMBINED_CANDIDATE.md` and relevant module runbooks. Their dated scope statements must be reconciled with the newest owner decision. Do not infer live configuration from an old document. Actual staff and organizational data are entered by authorized staff through the application, not embedded in this guide.

## Workflow boundaries

- Staff workflow guidance is a deterministic, read-only in-app guide, not a new staff LLM permission or workflow executor. It shows scoped next steps and marks unavailable integrations honestly.
- Owner exception (Fauzan, 2 Nov 2026: "Use ai when needed. We use it in case basis"; he approved changing this rule): a manager may ask Arisha AI about one work-rebalancing case at a time. It is off unless `WORK_REBALANCE_AI_ENABLED=true` and Arisha AI is on, capped per manager per day (rule WORK-REBALANCE-AI), sends a pseudonymised minimal brief (Person A/B, no names, titles, task titles or leave details), offers the model no tools, and only advises: the manager decides and acts with a reason. Any other new staff AI use still needs his explicit approval.
- Owner decision (Fauzan, 11 Nov 2026, handover K8/N1: "AI data manager and file manager, so it sends to correct places when bulk data are loaded"): the bulk load helper (`packages/core/src/bulk-manager.ts`, screen "Bulk load") proposes where each column of a bulk file and each of many files goes; a person confirms before anything is saved (the record's own import, or HR then the HR Director for the staff directory), unsure suggestions are held for the person, and every load keeps a record (`db/modules/bulk-loads-v1.sql`). A rule-based matcher does the whole job. Its AI part is off unless `PRIMA_BULK_AI_ENABLED=true` and Arisha AI is on; it then sends masked column headings, value shapes and masked file names only, never a value, a name or an ID number, and offers the model no tools.
- Owner decision (Fauzan, 11 Nov 2026, handover K9/N2: "Arisha AI inside the app trains the staff"; he approved changing these rules): staff screens may now offer Arisha. This changes staff usability rule 4 (staff screens named no AI tool; Arisha is now offered on every screen, staff screens included, still never naming Claude or any AI vendor) and the case-by-case approval of staff AI use, for this one use. "Learn with Arisha" (`apps/web/src/ArishaTrainer.tsx`, core `arisha-trainer.ts`) answers "how do I ...?" with the steps of the written screen guides for the person's own menu and gives a short first-time walk-through per role, in Bahasa Melayu by default. It is read-only (it never saves, approves or sends; it may only open a screen), sees only the person's role and the open screen, refuses questions about another department's records and requests for records, and works without the AI. Its AI part is off unless `PRIMA_TRAINER_AI_ENABLED=true` and Arisha AI is on (Azure OpenAI, his go-ahead, D7); it then sends the role, the screen, that screen's static guide and the question with numbers masked, with no tools, under the 20,000-character brief limit.
- Four leadership roles have bounded Arisha capabilities. Analysis and draft preparation do not grant operational write or final-approval authority. Enforce exact server identity, role and company grants; never substitute client claims.
- Human review of a draft is separate from IT work checking. Preserve existing explicit review semantics, no-self-check restrictions, technical checking, Manager acceptance/return and reasoned authorized oversight with notices.
- IT resolves a request; the requester confirms it. Keep open/history visibility and refuse premature, unrelated or duplicate confirmations. Do not replace requester confirmation with Manager/Lead status alone.
- Manual administrative intake covers joining/leaving, systems, existing devices and SharePoint guidance. Recording a checklist or access decision does not provision or revoke a provider account. Manual guidance is not a compliance certificate.
- Staff Send/reply stays in Outlook. Selected-message copying to a job is separate and requires explicit selection, current audience authorization and durable retry handling. Do not register autonomous reply or legacy Send routes implicitly.
- External connections stay unconfigured until separately verified. Never turn an entered URL, saved setup request or successful application login into a provider Connected claim.
- Offline work is deferred until after the online pilot. Do not interpret disconnected administrative records as offline synchronization.
- Rental rates and recurring asset inspections follow the latest reviewed owner-approved implementation. Never invent rates, purchase evidence, ownership, payments or inspection dates. Billing records do not establish payment.

## Engineering rules

1. Inspect the exact base, working diff, applicable instructions and test setup before editing. Keep unrelated work separate.
2. Use synthetic data for tests. Never use live staff records, credentials or provider calls as test fixtures.
3. Enforce permissions in backend actions, including direct tool/action calls. Preserve transaction locks, source/version binding, immutable receipts, replay protection and audit boundaries.
4. Minimize AI context. Do not include secrets, raw identity data or arbitrary screen content. Distinguish draft origin that is unverified from verified evidence.
5. Run applicable aggregate tests, builds and negative authorization tests. PostgreSQL/RLS and interactive-browser results must be reported separately from mocks and source inspection.
6. Opening a draft PR does not authorize merge, migration, deployment, tenant grants, provider activation or charges. Follow the specific owner authorization and stop on denied operations.
7. Record exact source hashes, actual test outcomes and unresolved gates. Keep local checkpoints; do not claim a restored artifact is byte-identical without verifying its manifest.

## Configuration references

Use generic placeholders in documentation: `<tenant-id>`, `<application-id>`, `<approved-site-id>`, `<approved-library-id>`, `<staging-api-url>` and `<staff-account>`. Resolve real values through approved configuration and authorized in-app setup, never by guessing or copying identity values from historical prose. Do not put passwords, tokens, private keys or personal account identifiers into review guidance.

## HR Phase 3 (draft PR on branch `claude/project-thread-andehu`, not merged or deployed)

Office-staff HR, built in slices. The decisions and what is built are in `docs/HR_PHASE3.md`. It changes the schema, adding the HR wall tables plus `prima.staff_faces`, `prima.public_holidays`, `prima.flex_requests`, `prima.vacancies`, `prima.hr_filings`, `prima.hr_cases` (confidential sexual harassment cases behind the `hr_cases` wall) `prima.office_osh` (OSH coordinator, office risk assessments, DOSH reports), and `prima.staff_training`, `prima.staff_appraisals`, `prima.hr_policies`, `prima.policy_acks`, `prima.staff_overtime` and `prima.hr_legal_checks` (directors-only legal points behind the `hr_legal` wall) and `prima.staff_movements` (promotion, transfer, secondment, readable and acceptable by the receiving company head, behind the `staff_movements` wall) and `prima.login_handovers` (the minimal login move IT works after a transfer, behind the `login_handover` wall) and `prima.allowance_types` (HR's allowance list with EPF/SOCSO/PCB/HRD ticks) and `prima.applicants` (job applicants, HR only, behind the `applicants` wall; stacked job posts PR #78), plus the `guard_feed` and `fw_ids` policies for JA guard records, so it needs the CEO-run migration before any deploy.

Main decisions so far:
- HR governs HR in every company, and companies monitor only.
- The CoS or DCoS is the HR Director.
- Staff payroll: the CoS approves, then the COO. The Vice Chairman consents to salary amounts.
- Every approval needs a comment, and nobody approves their own.
- Working from home is only for staff HR allows; vacancies are approved by the CEO and signed by the company head.

Next slices:
- 3G (JA guards keyed once) and 3D (minimum wage, overtime off, IC on EPF/SOCSO files) are built; overtime claims in payroll wait for Finance PR #49.
- HR KPI waits for pilot test 1.
- Staff movement (3 Nov 2026): promotion HR Director, CEO, VC consent; transfer receiving head then HR Director, fresh employment with group start date kept; secondment host head, HR Director, CEO.
- Allowances (3 Nov 2026): HR keeps the allowance list and its statutory ticks; a staff member's monthly allowances follow basic pay (HR Director verifies, VC consents). Backdating from the 1st of last month at the earliest (4 Nov 2026).
- Screening case file + guard code of conduct (PIKM/ISO review, 5 Nov 2026): stacked draft on this branch, adds `prima.hr_screenings` (hr_cases wall, ACT reads); see `docs/HR_SCREENING_AND_CONDUCT.md`.
- Handbook languages + discipline appeals (IWAY finding, 6 Nov 2026): draft PR #131 on main 2261e5d, not merged or deployed; English and Malay required, mother-tongue copies, signed language recorded, policies by job or site, appeal step decided by the HR Director or CEO (14-day window, 30-day site roster window confirmed by Fauzan 8 Nov 2026; more languages later); no new tables; see `docs/HR_POLICY_LANGUAGES_AND_APPEALS.md`.
