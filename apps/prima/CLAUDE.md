# Prima Secure — implementation and review guidance

## Current work

Prepare the online IT pilot as one reviewed candidate. Repository code and tests do not establish deployment, database migration, tenant permissions, runtime health, security certification or completed staff UAT. Check the current branch and exact candidate evidence before making claims.

Read `docs/MONDAY_PILOT_REQUIREMENTS_MATRIX.md`, `docs/MONDAY_PILOT_COMBINED_CANDIDATE.md` and relevant module runbooks. Their dated scope statements must be reconciled with the newest owner decision. Do not infer live configuration from an old document. Actual staff and organizational data are entered by authorized staff through the application, not embedded in this guide.

## Workflow boundaries

- Staff workflow guidance is a deterministic, read-only in-app guide, not a new staff LLM permission or workflow executor. It shows scoped next steps and marks unavailable integrations honestly.
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
