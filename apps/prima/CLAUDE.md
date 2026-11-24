> Current checkpoint (15 November 2026): main is 5b7804e (PR #141, Fitri's package Parts A-Z with review and audit fixes) plus the patches Fauzan has accepted. Fauzan, 15 Nov 2026: Fitri runs the database modules (release list, then the 24 off-list modules) with `infra/run-db-migration.sh`, staging first; deployment and switch-ons stay with the CEO. Source in the repository is not deployment, migration or operational acceptance. All departments begin the learning programme on 18 November 2026; the two months to about 18 January 2027 are for data collection and training (November and December staff salaries are paid the old way while Prima runs side by side). Guard payroll stays trial-only; providers, grants, new database modules and real-data activation remain separately gated. Staff/device UAT is deferred, not waived.

# Prima Secure — implementation and review guidance

## Current work

Fitri builds from the instruction files in `/mnt/project-files/fitri-instructions/` (start with `2026-11-11_FITRI_START_HERE_how-to-with-claude-code.txt` and the master list `2026-11-11_all-pending-changes.txt`), one item at a time. Repository code and tests do not establish deployment, database migration, tenant permissions, runtime health, security certification or completed staff UAT. Check the current branch and exact candidate evidence before making claims.

Handover rule (Fauzan, 11 Nov 2026): no new branches and no pull requests for Fitri's work. Work on main on your own computer, commit, and hand each item back as a patch file (`git format-patch -1 HEAD`) with a short note (item, what changed, check results). Nothing is merged, deployed or migrated until Fauzan says so. When an item is accepted, record it in the RESULTS LOG of the master list. A new table goes in `db/modules/`; migrations run only with `infra/run-db-migration.sh` (Fauzan, 15 Nov 2026: Fitri runs them, staging first; before that the CEO ran every migration). Modules not yet in `db/release-manifest.json` are listed in the item's ledger entry and installed only with Fauzan's go-ahead.

Rule values: change `packages/core/src/rules.ts`, write the source as the owner decision with its date, and change the label from Unverified to Policy. Lists that change each year (guard courses, claim clauses, discipline steps) are HR settings in the app, not rule values. A dated document's scope statement must be reconciled with the newest owner decision; do not infer live configuration from an old document. Actual staff and organizational data are entered by authorized staff through the application, not embedded in this guide.

## Workflow boundaries

- Staff workflow guidance is a deterministic, read-only in-app guide, not a new staff LLM permission or workflow executor. It shows scoped next steps and marks unavailable integrations honestly.
- Owner exception (Fauzan, 2 Nov 2026: "Use ai when needed. We use it in case basis"; he approved changing this rule): a manager may ask Arisha AI about one work-rebalancing case at a time. It is off unless `WORK_REBALANCE_AI_ENABLED=true` and Arisha AI is on, capped per manager per day (rule WORK-REBALANCE-AI), sends a pseudonymised minimal brief (Person A/B, no names, titles, task titles or leave details), offers the model no tools, and only advises: the manager decides and acts with a reason. Any other new staff AI use still needs his explicit approval.
- Owner approval (Fauzan, 23 Nov 2026, study doc "Where AI agents can help across Prima" and Part AG of the Fitri instruction files): helpers that read papers, draft words and check records, system first and AI last ("Use system more than ai"; "ai must also be there to help key in more needed. Staff do minimal work"). Rules, templates and free reading on the phone come first; the online reader fills only what they could not, never decides, and saves nothing. Each helper kind is off until listed in `AI_AGENT_KINDS`, is capped at USD 25 per agent a month (rule AI-AGENT-BUDGET) and is switched on separately with his go. Built so far: the key-in helper (`docs/KEY_IN_HELPER.md`), the data clean-up checker (`docs/DATA_CLEANUP.md`) and the Prima helper (`docs/PRIMA_HELPER.md`), source only. The Prima helper (Fauzan, 23 Nov 2026: "What prima app give permission for the person or department can do, agent can help it do") fills a job's form from the person's words with fixed rules and sends only when the person presses Send, through that job's own server action as the person; it never approves, signs, pays or disciplines. Its skill library and each person's style need module assistant-v1 (off the release list).
- Four leadership roles have bounded Arisha capabilities. Analysis and draft preparation do not grant operational write or final-approval authority. Enforce exact server identity, role and company grants; never substitute client claims.
- Human review of a draft is separate from IT work checking. Preserve existing explicit review semantics, no-self-check restrictions, technical checking, Manager acceptance/return and reasoned authorized oversight with notices.
- IT resolves a request; the requester confirms it. Keep open/history visibility and refuse premature, unrelated or duplicate confirmations. Do not replace requester confirmation with Manager/Lead status alone.
- Manual administrative intake covers joining/leaving, systems, existing devices and SharePoint guidance. Recording a checklist or access decision does not provision or revoke a provider account. Manual guidance is not a compliance certificate.
- Staff Send/reply stays in Outlook. Selected-message copying to a job is separate and requires explicit selection, current audience authorization and durable retry handling. Do not register autonomous reply or legacy Send routes implicitly.
- External connections stay unconfigured until separately verified. Never turn an entered URL, saved setup request or successful application login into a provider Connected claim.
- Offline work is deferred until after the online pilot. Do not interpret disconnected administrative records as offline synchronization.
- Rental rates and recurring asset inspections follow the latest reviewed owner-approved implementation. Never invent rates, purchase evidence, ownership, payments or inspection dates. Billing records do not establish payment.

## Monthly reports made by Prima (Fauzan, 23 Nov 2026)

Prima makes every monthly report on the 1st from its own records (company reports to the Director Office, each department's ACT-form report, each client's service report, the group report for the CEO); the owner keys in, uploads, downloads and sends; on the due day Prima sends unsent internal reports itself, marked Not checked; client reports always wait for a person (decision card, 23 Nov 2026). Dates confirmed 23 Nov ("Yes proceed"). The Director Office sets per report which parts must be there, which are left out and which are added; owners leave out optional parts and add their own, carried to next month ("Let they customize follow thier preference"). See `docs/AUTO_MONTHLY_REPORTS.md`. Needs module `db/modules/auto-reports-v1.sql` (not on the release list).

## Marketing tender desk (Fauzan, 22-23 Nov 2026)

One central Marketing department (Manager, Deputy, Tender Executives, under the COO) prepares and lodges every tender in each company's name; the company manager approves once; quotations stay with the company. Part 1 is in code and described in `docs/MARKETING_TENDER_DESK.md`. It is off until the CEO or the COO starts the desk in the app, and Marketing accounts need the add-on module `db/modules/marketing-accounts-v1.sql` (not on the release list). The company paper library (AH7) needs `db/modules/company-papers-v1.sql` (not on the release list). An executive's companies are their company access lines; do not add a second assignment list. The tender watcher (AH11) reads only public pages of sites a Marketing lead allowed, follows the robots file, never logs in, and is off until `TENDER_WATCHER_ENABLED=true`. Marketing gets `tender.work` only, never `commercial.prepare` or `commercial.approve`.

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

## HR (merged to main; database modules need the CEO-run migration)

Office-staff HR is on main. The decisions and what is built are in `docs/HR_PHASE3.md`, `docs/HR_SCREENING_AND_CONDUCT.md` and `docs/HR_POLICY_LANGUAGES_AND_APPEALS.md`. Standing decisions:
- HR governs HR in every company, and companies monitor only. The CoS or DCoS is the HR Director; PWVSB HR is the HR Administrator.
- Staff payroll: the CoS approves, then the COO. The Vice Chairman consents to salary amounts.
- Every approval needs a comment, and nobody approves their own.
- Working from home is only for staff HR allows; vacancies are approved by the CEO and signed by the company head.
- Face sign-in and location need the person's signed PDPA consent, collected on paper by the PDPA officer; Prima keeps only a small record (the gate is a switch, off until the PDPA officer or the CoS turns it on).
- Unused annual leave lapses on 31 December (no carry-forward); staff see a reminder in November and December.
