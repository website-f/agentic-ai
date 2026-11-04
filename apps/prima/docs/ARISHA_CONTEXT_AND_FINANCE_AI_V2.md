# Arisha candidate V2 — bounded executive context and Finance AI proposals

**Local, unpublished implementation.** Builds on the V1 draft-review candidate, based on remote main `997ac0db24c43e9820401f19bc4049151f1eec10`. The V1 Library bundle remains unchanged. This candidate does not deploy, migrate, enable AI, alter identities/mandates, or certify production security.

## Supported capabilities

| Exact pilot identity | Read-only model summaries | AI proposal preparation | Operational saving |
|---|---|---|---|
| CEO `u-fauzan` + CEO role | Operations, company-licence expiry, finance-paper statuses across current grants | Four safe new-record kinds; existing company master as unverified draft; existing audit/tax paper → prepared | Separate explicit human action, existing authority only |
| ACT `u-audit` + ACT lead role | Same three contexts across current grants | Four safe new-record kinds; existing audit/tax paper → prepared | No new operational save/approval authority |
| COO `u-coo` + COO role | Operations across current grants | Four safe new-record kinds | Existing authority only; no new generic save powers |
| Finance `u-fd` + Finance Director role | Finance-paper statuses across current grants | Existing audit/tax paper → prepared | Separate explicit human action under existing Finance authority; no new payment/approval powers |
| Other accounts/integrations | No Arisha AI tools | None | Existing authorized human draft-review access only; no AI entitlement |

The four safe new-record kinds remain **site, post, checkpoint and IT domain**. This is not a claim of complete organizational functionality or coverage of every SOP.

## Executive summaries and evidence

`executive_summary` is a typed read-only tool. It accepts only:
- `operations`: counts of recorded sites, posts and checkpoints.
- `compliance`: recorded company-licence/registration counts and expiry-date buckets (expired, today through 30 days, missing/invalid expiry).
- `finance-papers`: recorded auditor/tax-paper counts by status, including unknown status.

Every call independently validates the exact identity/role, allowed context, active dated grants, company visibility and existence. ACT receives no CEO impersonation or grant/RLS bypass. A requested unauthorized company is rejected. Aggregate scope is bounded to 50 companies; source references are bounded to five sample IDs per metric. Known permitted company IDs can be requested individually.

Responses include retrieval `observedAt`, covered company IDs, static metric labels/counts, table/record-ID references and limitations. `sourceUpdatedAt` is explicitly unknown (`null`); retrieval time is never presented as the source update time. Zero records, missing sources and truncated scope are not treated as success or proof of completeness. The UI displays authoritative service evidence separately from generated text and labels other generated references as unverified.

No raw employee, payroll, bank, medical, whistleblowing or document text is returned in these summaries. No arbitrary SQL, arbitrary table selector or arbitrary URL is accepted. Company-scope checking is independent of model prompts. IT job summaries are deliberately excluded: the current job table's unscoped shape requires a separate authorization/data-model design first.

## Finance AI data flow

1. `finance_papers` returns current permitted company IDs or bounded paper IDs, pack and status. It **does not send paper labels, people, amounts, bank data or source documents to the model**. Invalid statuses are represented as unknown. If the paper is ambiguous, the human must identify its ID from the Finance panel; the model must not guess from an unseen label.
2. `prepare_finance_paper` independently checks identity, company, target, allowed keys and current `todo` status. It can propose only `prepared`. It creates no durable draft, finance change, audit event, approval, payment or dispatch.
3. The prepared proposal is returned to a local human card. Its label may be displayed to the authorized human, but both server and demo model runners replace the entire tool result with a static confirmation before the next model request. Regression tests check that injected label text never enters the subsequent model request.
4. The human explicitly submits the proposal, then an authorized human separately reviews/saves through the V1 durable queue. Current write authority is rechecked. Authors may save only if they already have the exact existing authority. Source freshness, shared Finance locks, idempotency, returns and versioned resubmission remain in force.

The existing `provenance` field records submission-path metadata, **not cryptographic proof of model authorship**. Finance submissions are marked human because the final submission is an explicit human route, even when AI helped prepare the card. Do not use it as certified AI-generation provenance.

## Model/privacy boundaries

The model receives static help, user-supplied question/history, permitted tool schemas and the allowlisted results above. Automatic raw DOM scraping remains removed; server mode cannot silently fall back to Claude. User-supplied secrets in questions/history are not automatically redacted: this is not a comprehensive DLP system. Existing narrow record-form tools retain their approved nonpersonal schema/reference choices; human users must still avoid pasting confidential records into AI chat.

Model instructions and role-filtered advertisements improve behavior but do not grant authority. Every execution independently checks the authenticated user. No tool can submit, commit, approve, pay, change permissions, deploy or invoke arbitrary commands. All AI/provider activation and costs remain separately gated.

## Remaining work before release

- Run the full API suite on disposable PostgreSQL 16, including the new RLS, duplicate-submit/commit and direct-Finance-versus-draft concurrency regressions. MemoryStore tests are not proof of database rollback or row-level security.
- Run the prepared synthetic desktop/mobile browser job and human UAT. Local Chromium startup is blocked by environment socket permissions; no bypass was attempted.
- Review the proposed `.github/workflows/ci.yml` changes before separately authorizing a draft-PR publication. Existing CI already supplies PostgreSQL 16; the added browser job uses synthetic demo data, a localhost-only browser allowlist and no Azure/private environment secrets. Future CI may consume GitHub Actions allowance. No workflow has been dispatched for this candidate.
- Complete separately approved deployment/migration, real identity mapping, current mandate checks and AI activation. Passing local/GitHub checks does not establish those outcomes.

Out of scope: full financial transactions, payroll/medical/whistleblowing retrieval, IT job/tender AI drafts, all-company raw record access, verified source-document ingestion, comprehensive SOP coverage, autonomous email replies, autonomous operational writes and production monitoring. Email replies remain outside this app work.
