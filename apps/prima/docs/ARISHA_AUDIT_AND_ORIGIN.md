# Draft origin and extraction audit hardening

This candidate does not activate extraction, change leader permissions, or deploy configuration.

## Draft origin

Submitting a proposal is a human action, not evidence of its preparation origin. New proposals have `provenance: unverified`, regardless of record/Finance type or legacy caller hints. The API rejects client-supplied provenance/origin/proof fields. Historical rows and content-deduplication receipts remain unchanged; old `human`/`arisha` labels are historical assertions, not newly verified evidence. No server-issued verified-AI proof is implemented. Existing commit authority and deliberate authorized self-review remain unchanged.

## Extraction audit

Extraction remains exact-CEO, verified-Entra, explicit-consent and server-source/data-class allowlist gated. Data class is **self-declared**, not content classification. This code changes no flags; approved real-data use still needs separate authorization.

A required durable sink appends a committed `arisha.extraction.started` event before the single Azure model call. A separate transaction appends one terminal event after success, provider failure, output rejection or timeout. No database transaction is held across the model call; no automatic provider or audit retries occur. Failure to persist the start prevents transfer. Failure/uncertainty persisting a terminal event returns a generic error and leaves the started event as unresolved. A process crash may likewise leave only started evidence. Timeout means transfer/outcome **unknown**, not "nothing was sent".

Events use the existing append-only audit chain and its existing access/retention policy (group-wide metadata is visible to audit readers). They retain server attempt ID, actor ID, time, canonical source SHA-256 and UTF-16 length, kind, self-declared class, consent version and allowlisted outcome. They exclude source text, source label, model output, tokens and raw provider/storage errors. Hashes and actor IDs remain sensitive metadata; no new retention or access policy is claimed. Invalid/unauthorized requests rejected before an authorized transfer attempt do not create transfer events.

No schema migration is introduced. Unit tests cover fail-closed storage, correlation, redaction, failures, timeout, concurrent requests and no retry. PostgreSQL CI verifies start visibility from a separate connection before the mocked provider call, append-only behavior and chain integrity. Browser CI remains synthetic; it is not live Azure verification.

## Chat and readiness

Chat provider and managed-identity requests now have bounded time/response sizes and reject redirects; endpoint configuration must be a root `https://<resource>.openai.azure.com` URL. Check the real deployment's endpoint compatibility before rollout. Readiness output shows safe presence/enabled-state facts plus `endpointShapeValid`: true/false for an inline endpoint checked against the exact application parser, or null when absent/blank/secret-referenced. Parser parity is tested; no secret reference is resolved. The diagnostic now requires Node.js in addition to Azure CLI/jq. These facts are not secrets or proof of connectivity, role assignment, deployment compatibility or runtime health. Working Arisha is not switched off by this patch.
