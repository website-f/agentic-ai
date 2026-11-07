# Arisha AI Assistant: Prima-side contracts v0.1 (draft)

Status: draft for joint review with Arisha/Codex. Synthetic data only. **Off by default.** Nothing here is merged,
migrated, deployed or connected to a provider. Source: Arisha AI Assistant Master Plan v1.0 (6 Nov 2026), sections 5-7,
20 and the first joint integration milestone.

Code: `packages/core/src/assist-contract.ts`, `packages/core/src/assist-invoice.ts`, tests in
`packages/core/test/assist-invoice.test.ts`.

## 1. First milestone, mapped onto what already exists

The plan's milestone is an invoice task. On `main` the closest real task is the **Merdeka IT purchase invoice check**
(`packages/core/src/it-procurement.ts`, action `checkPurchaseInvoice`, kind `invoice`). It already has what the plan
asks for, so we build on it instead of inventing a new invoice record:

- assigned Finance team only (`financeTeam` authority, fail-closed when unset);
- a fixed request UUID per operation with an immutable receipt (`itProcurementReceipts`), and the same UUID with
  different details is refused permanently;
- `expectedVersion` binding to the packet the person saw;
- deterministic match against the PO lines, supplier and total. It records the check only and never pays.

Finance Phase 2 (#49) payments are deliberately **not** the first target: they are on the candidate stack, not `main`.

## 2. Flow

1. `prepare(user, {purchaseId, documentText})`: Prima checks the user's authority through the procurement board
   (`canCheckInvoice`). It then runs the outbound gate on the text, which fails closed on credentials, IC numbers,
   long account numbers, key material, control characters and text over 8,000 characters. Next it sends a **minimised**
   `GatewayRequest`: the PO reference, supplier and line descriptions only, with no prices, totals, people, approvals
   or evidence. Finally it validates the draft against a strict schema and compares it deterministically.
2. `check(user, jobId, fields)`: when the person corrects a field, Prima re-runs the checks and gives a new
   confirmation hash.
3. `confirm(user, jobId, {fields, confirmationHash, evidence})`: the hash binds purchase, packet version, operation
   UUID and exact values. Prima refuses the confirmation if the window (15 min) has expired, the packet moved, or the
   values differ from the latest check. It then submits through `ItProcurementService.save(user, 'invoice', …)` **as
   the person**, using the job's fixed operation UUID.
4. If the submission's result is lost, the job becomes `outcome_unknown`. `reconcile` reads the procurement receipt
   for that UUID, and a blind retry is impossible.

Job states: `planned → awaiting_approval → running → succeeded | failed | outcome_unknown`, with `cancelled` from
planned or awaiting. `outcome_unknown` resolves only to succeeded or failed.

## 3. Gateway port (Arisha/Codex implements)

```ts
interface AssistGateway { prepare(request: GatewayRequest, signal?: AbortSignal): Promise<GatewayResponse> }
GatewayRequest  = { contract_version, request_id, task_id, company_id, actor_id, task_class, data_class,
                    output_schema: 'prima.invoice_check_draft.v1', payload: { instructions, reference, document_text },
                    budget_cap_myr, deadline_ms, training }
GatewayResponse = { status:'drafted', request_id, provider, model, policy_version, routing_reason, usage, draft }
                | { status:'denied',  request_id, policy_version, reason, usage|null }
                | { status:'failed',  request_id, reason, usage|null }
usage           = { input_tokens, output_tokens, cached_tokens, cost_myr, price_version }
prima.invoice_check_draft.v1 = { ref, invoiceOn (YYYY-MM-DD), supplier, amount (MYR, 2dp), qty[], unitPrices[] }  // exact keys
```

Prima discards a response in any of these cases: the request id does not match, `status` is not `drafted`, the draft
has extra or missing keys or a wrong line count, or reported `cost_myr` exceeds `budget_cap_myr`. The gateway owns
provider eligibility, routing, its own disclosure gate, budget reservation and fallback. Prima never sees provider
credentials.

Open for the gateway side: the transport (HTTP within the company network, or an in-process adapter), service identity
and mTLS or token, idempotency storage for `request_id`, and the price-version register.

## 4. Work-event envelope (plan section 6)

Exact fields: `event_id, schema_version, company_id, actor_id, executor_id, device_id, task_id, source, event_type,
event_time, received_time, source_sequence, application, result (ok|denied|failed|unknown), reason, evidence_ref,
policy_version, training, detail`. `detail` is a flat object of at most 20 small scalars and never carries payload text.
`MemoryWorkEventOutbox` stores one result per `event_id`, and reusing an id for a different event is refused.

The milestone emits `assist.requested`, `assist.outbound_blocked`, `assist.gateway_decision` (with cost and tokens),
`assist.draft_ready`, `assist.draft_rejected`, `assist.confirmed`, `assist.submitted`, `assist.reconciled` and
`assist.cancelled`. Executor identities are the person, `svc:prima-assist` and `svc:arisha-gateway`.

## 5. Not built yet (next slices)

- PostgreSQL tables for assist jobs and the event outbox, with RLS by company. Jobs are currently in memory.
- API routes and the staff screen panel on the procurement board. The switch is `ARISHA_ASSIST_ENABLED`, default off.
- Event export to the ingestion service (Arisha side), with replay from `source_sequence`.
- Delegation and governance UI (plan sections 4 and 11).
