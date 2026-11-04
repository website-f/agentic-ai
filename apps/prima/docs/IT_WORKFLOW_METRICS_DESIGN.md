# Phase 1 timing and quality — new implementation contract

Approved functional scope: shared active/wait/elapsed timing and objective quality tracking. This is new work, not part of the frozen 473-file checkpoint.

## Rules
- No financial, checker, requester or access authority changes. An authorized actor can track only their current assigned stage. Existing domain actions remain the only way to accept, approve, confirm or pay.
- Server adapters resolve current record visibility, assigned actor, exact source version and objective quality evidence. Client role/capability/quality claims are never accepted.
- Append-only events and immutable target/calendar snapshots; exact version and source-version checks, owner-bound UUID replay protection, transactional serialization and auditable target review.
- Track active, internal queue, external wait, self-reported handoff wait and total elapsed separately. External waiting must name a currently permitted accountable owner, reason and next-review time. Total elapsed never pauses.
- Active minutes mean staff-recorded workflow intervals, not measured physical productivity. No screen capture, keystrokes, hidden observation or automated staff ranking.
- Existing records start with prospective coverage only. Historical active minutes remain unknown. Missing quality evidence is unknown, never a pass.
- IT Manager reviews versioned provisional targets. These targets cannot amend domain deadlines or approve financial work. Business-calendar settings must be explicitly reviewed; absent calendar means business duration unknown.
- Malaysia timezone, explicit weekdays/work windows/holidays. Report median/p90 within workflow/stage/complexity cohorts with sample size; no fastest-only or cross-role comparison.

## Coverage plan — not a completion claim
Reference kinds: ticket, job, asset_entry, import_review, inspection, rental_bill, procurement, onboarding, website, connection_setup. Each stage needs a current-authority adapter and source-event integration. Core engine/types are the first slice. SQL/readiness, API, UI and each adapter need separate tests before marking that workflow covered. Never enable a generic free-form tracker as a substitute for record authorization.

Initial target proposals (minutes of hands-on ordinary work, complete inputs): asset entry5–10; inspection20–40/check5–10; rental preparation10–20/check5–10; PO10–20, receipt5–15, invoice matching10–20; onboarding checklist20–40/review5–10; website review10–20/check5–10; connection request5–10/diagnosis15–30. Import5-minute setup+1–3/row requires a quantity-aware target, not a fixed invented number. Ticket acknowledgement by severity remains a separate proposed response target, not a universal fix duration. No targets are automatically approved or installed by this document.

## Quality
Source-derived first-pass acceptance, returns/reopens, required-evidence completeness, validated error count and explicit requester confirmation. Timeout auto-confirmation is not explicit satisfaction. Financial matching is not payment execution. Only completed comparable cohorts contribute to completion percentiles; open work has separate age/backlog reporting.

## First source adapter contract (current-cycle writes)
- Job `work`: current assignee and existing `itBoard.can.submit`; terminal is submittedAt only while status submitted/checked/accepted.
- Job `check`: existing current `itBoard.can.check`; terminal is actual latest check-log actor/time while checked/accepted. No checker assignment or approval is created.
- Job `approve`: existing `itBoard.can.accept`; terminal is acceptedAt and actual acceptance-log actor. The tracker never calls a domain approve action.
- Ticket `work`: active ordinary IT, current exact assignee, existing board canWork. Terminal is resolvedAt with resolved status.
- Ticket `confirm`: existing requester/server webPolicy canConfirm, never a timeout. Terminal is stored confirmedAt; linked ticket checker actor comes from recorded confirmation history.
- Cycle must match current returns/reopened +1. Older cycles retain existing closed snapshots or explicit unknown-boundary recovery; they cannot start new work intervals and never receive later whole-record quality.
- Complexity is explicitly `unclassified`; browser cannot select a fabricated easier category. Further reviewed classification integration remains pending.
- Closed stage persists a quality snapshot. Open assignment mismatch or already-completed domain without synchronized closure produces unknown durations, not continuing active minutes against the old owner.
- Remaining workflows/stages return `not_instrumented`, including pre-save asset/import entry, procurement stages, rental, onboarding and connection setup. Linked inspection work can use its ordinary assigned job only; that is not a separate inspection timer.

### Canonical source version
SHA256 of recursively lexically sorted JSON, using `metricHash`, with explicit nulls (never UI projection/booleans):
`{record, actor, ref}`. Actor keys: id, role, department, itRole, opsTier, leadership, sorted companyIds, accessClosedFrom, integration boolean.
Job record keys: id, assigneeId, status, returns, technical, dueOn.
Ticket record keys: id, status, assignedToId/null, webResolutionVersion/null, confirmedAt/null, reopened/default0, sourceRef/null.
The hash is optimistic evidence binding, not authorization. Semantic current-role/assignment/scope checks and locks are independently required in service and SQL. Domain source rows, actor and relevant authority rows remain locked until commit.

### Storage
Four additive tables: streams; owner+UUID receipts; immutable target revisions keyed seriesId:version (including originating requestId/hash); admin-only immutable calendar revisions keyed calendar:version. Missing calendar remains unknown. Unique active-owner protection prevents concurrent double-counting. No new calendar defaults or employee visibility grants.

Recovery uses a stable owner+UUID and exact operation kind. A missing receipt is uncertain, not proof of no commit. Explicit guarded abandon writes a durable rejected tombstone; a committed receipt is returned unchanged, and delayed original writes cannot reuse the abandoned UUID. No timing interval or domain record is deleted. Request, stream, actor/source locks and unique active-owner enforcement are required in the production adapter.

External-wait owner means the current permitted internal staff liaison accountable for following up, not a claim that a supplier or Microsoft accepted responsibility.

### Source-boundary reconciliation addendum
The original active timer owner (not a Manager substitution) may explicitly reconcile a server-proven assignment/cycle/entitlement change. A minimal owner-only recovery list returns original timer references and a boolean; it does not return current domain payloads or grant domain access. The database helper derives actor/source ownership itself. Reconciliation appends `boundary_unknown` at recording time, not a claimed historical completion, sets permanent `boundaryUnknown`, stores unknown quality and removes the active-slot reservation. Duration remains unavailable and the case is excluded from completed-performance cohorts. Events/IDs remain retained. An unchanged source cannot be reconciled to evade a timer.

Production authority locks use `workflowMetricLock(ref|null)` / `workflowMetricBoundary(streamId, actorId, today)` adapters backed by reviewed SECURITY DEFINER helpers deriving the authenticated actor, never UPDATE grants on users. Request and stream advisory keys use the existing `it-manual:` namespace; exact source/actor participants must remain locked until commit. MemoryStore support is explicitly synthetic and does not prove PostgreSQL locking or rollback.

No inline domain hooks are installed in this slice. Authoritative closure is a separate post-commit, idempotent `metricsSync` action; metrics failure must not roll back a successful job approval or other domain operation. Until closure succeeds, its measurement is explicitly unknown. Domain actions never acquire metric locks, avoiding reversed source→metric versus metric→source lock order. This is explicit tracking with source-verified reconciliation, not a claim of automatic instrumentation across all workflows.

### Coverage segments and honest quality limits
`coverageSegment` is server-derived prospective coverage, not a domain return/cycle. First segment1; a later max+1 segment is allowed only after the prior same base reference closed with unknown boundary. No new segment after normal completion and no overwrite of old owners/events. Disabled owners cannot reconcile themselves; that remains an administrative recovery dependency, not a Manager override.

Timer submit means ready for handoff, not source-domain submission; it can resume while existing source authority still permits work. `handoffWaitMinutes` is self-reported readiness wait, never verified checker latency. Queue/elapsed begin at prospective timer creation; earlier working minutes remain unknown.

Work-stage closure can precede later acceptance/return, so first-pass quality may remain Unknown in its immutable snapshot. Full doer quality attribution needs separately verified exact-cycle outcome integration; this slice must not report submission as acceptance. Acceptance-stage snapshots may contain existing domain-verified outcomes.

### Private segment lookup
Production choices and opening use `workflowMetricNextSegment(ref)` / `prima.wm_next_segment(ref)` to obtain only the current-authority-checked positive integer. They must not infer segment 1 from an RLS-filtered list of earlier owners' private streams. The SQL guard still checks the exact next segment atomically under source/series serialization. Missing or malformed scalar support fails closed; the MemoryStore implementation is synthetic, not RLS proof.

### HR review proposal — authorization not configured
A separate HR review should bind an explicitly authorized reviewer and company/individual-detail scope to a fixed-period metric snapshot, record evidence and coverage gaps, allow a staff response and record the review outcome. It must not approve domain work, execute personnel decisions or hide existing own-work reports. Current staff own-work and existing IT oversight visibility remain unchanged. IT Manager target revisions remain separate: HR may recommend changes, not silently rewrite targets or historical cohorts. Authoritative HR reviewer/company mappings have not been supplied; no HR review route or additional grant is implemented in this slice. Unsupported workflows listed in the gateway remain unsupported.
