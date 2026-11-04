# Arisha review drafts — V1 implementation candidate, 30 October 2026

> Historical V1 scope. The current local V2 additions are documented in `ARISHA_CONTEXT_AND_FINANCE_AI_V2.md`; the saved V1 Library bundle is unchanged.

Base: `997ac0db24c43e9820401f19bc4049151f1eec10`. This patch is **not deployed**, not a production-health check and not a security certification. No live identity, company mandate, security setting or AI resource was changed. No paid AI call was made.

## Implemented boundaries

- Exact named identities **and** matching roles remain mandatory: CEO `u-fauzan`, Finance `u-fd`, COO `u-coo`, ACT `u-audit`. Matching titles alone and integration accounts do not grant AI access.
- CEO, COO and ACT can prepare new **site, post, checkpoint and IT domain** proposals. Explicit field allowlists fail closed if the generic registry grows; armed-site flags and personal/financial identifiers are excluded.
- CEO, ACT and Finance can submit a proposal to mark an existing audit/tax paper **prepared**, only while it is `todo`. This first Finance path is a human-operated form, not an AI finance tool. It does not pay, send, review, approve or alter bank details.
- Company-scoped drafting respects current company visibility/mandates. ACT is not impersonated as CEO, and no grants or RLS bypass were added. Missing/expired mandates block the affected scope. Organization-wide AI retrieval/analysis is **not** implemented by this slice.
- A submitted proposal is durable and immutable. An authenticated human with existing write authority explicitly reviews and commits it. The author may perform this separate review step only where existing authority already permits the exact operation (e.g. CEO safe records, Finance Director paper preparation). No second-person policy is invented, and existing workflow segregation rules are untouched. Draft creation does not change an operational table. `recordCan`, ordinary `recordForm`, `saveRecord` and approval authorities remain unchanged. `setFinPack` retains its permission rules but now locks inside its transaction before reading the paper array, avoiding lost updates between direct Finance actions and draft commits.
- Reviewer access is separate from AI access. The Draft reviews panel is available to signed-in humans, but its server-filtered queue shows only an author's own permitted proposals or proposals the human can actually review. This does not allow other staff to use AI.
- Finance source fingerprints are private and rechecked before commit. Draft/finance rows are locked; stable proposal IDs deduplicate retries, and committed drafts are idempotent for the committing reviewer. A returned proposal can be explicitly resubmitted by its author after fresh validation; its version and audit history advance without saving operational data. Identical submission retries remain deduplicated.
- Draft audit entries record actor/author/reviewer/version and action, not proposed field values or model text. Operational saves retain their existing audit behavior.

## CEO company-onboarding compatibility

The CEO's existing company-master AI preparation is preserved separately from the create-only review queue. It selects an **existing permitted company**, never a new ID/code, and uses an explicit nonpersonal whitelist. Model input cannot set `verificationStatus`; the prepared output and explicit CEO save remain **draft/unverified**. Source verification is a separate manual action in the existing company form. Company proposals cannot be smuggled into the new-record queue. Bulk submission excludes company cards and each company save requires a separate confirmation.

Other former CEO AI schemas (HR, arms, insurance, housing, etc.) are not exposed in this candidate's AI tool path. Their existing manual forms are unchanged. This is a deliberate safety restriction requiring product review before publishing; **not** a claim that the requested complete four-leader functionality is finished.

## AI context and limitations

Automatic raw DOM/screen scraping has been removed. Client brief contains static navigation/help context and the user's question rather than employee/bank/medical screen contents. Server-owned system instructions state the limited role of tools and prohibit implied execution/certification; tool authorization is enforced independently of prompts. The last eight user/assistant turns still go to the configured model. Users must not paste secrets or sensitive personal records; this patch is not a comprehensive DLP system.

No cross-company executive retrieval, evidence-cited group analysis, update-draft diffing, attachments, broader finance transactions, IT job/tender draft schemas, automated email replies or delegated approvals are added. Email remains outside this work. Azure AI activation, identity links and costs remain separately gated.

## Schema and rollout

`001_init.sql` adds only `prima.arisha_drafts` with forced RLS, scoped to transaction company IDs (and existing group-user scope for unscoped IT proposals). The application's author/reviewer checks add narrower authorization. Its existing migration fingerprint changes, so the API must refuse an old schema until an authorized administrator applies the reviewed additive migration. **No migration was run against staging or production.**

Before any deployment:
1. Review the patch, including the explicit CEO AI-scope restriction and Finance's human-form-only slice.
2. Run the complete API integration/RLS suite on a **disposable local PostgreSQL 16** database. The suite resets that database; never point it at Azure or real data.
3. Exercise concurrent identical submission/commit, failure rollback, grants revoked mid-workflow, cross-company SQL access, and all four real role mappings with synthetic records.
4. Browser UAT on desktop and phone: cancellation, sign-out/user switch, double-click, timeout/retry, Finance review, and existing CEO company onboarding.
5. Only after approval: authorized schema migration, deployment, identity verification and separately approved AI activation. Passing code checks are not proof of any of those steps.

Rollback: keep the additive draft table/data (do not drop live proposals), stop using this candidate, and coordinate schema fingerprint/application rollback with the authorized deployment owner. Restoring an older app without its matching expected fingerprint can fail readiness; do not manually overwrite schema-version metadata as a shortcut. A forward corrective migration/build is preferable after proposals have been saved.

## Validation record

See the delivered local test report for exact final results. PostgreSQL and browser runtime checks require a usable isolated environment; compilation and MemoryStore tests do not establish database rollback, real Entra mapping, deployed migrations, runtime health or security certification.

Concurrent repository work: draft PR #27 (`docs/arisha-activation-evidence-20261030`, head `14ed668`) was reported during this local implementation. It is separate activation-evidence documentation; main stayed at the base above. Reconcile its evidence before any future publication; this patch does not overwrite that remote work.
