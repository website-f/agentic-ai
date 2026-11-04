# Website policy rebuild — 1 November 2026

New implementation on verified PR50 `0129fc8d28ed09a81d3a10fd706ad0f50b5e3f95`. This is not recovery or verification of the lost 480-file bundle; prior test results do not cover this rebuild.

## Linked website/social/email requests only

`sourceRef: web:<issueId>` must match the issue's ticket ID. All assignment, take, resolve, confirmation, return and explicit reopen paths share the website transaction/advisory lock. Fresh personal actor identity and existing website company scope are checked before mutation; the existing explicit assigned-IT exception is retained. Ordinary generic IT tickets retain their previous policy.

- Current IT Manager delegates active personal IT staff. An unrelated Lead cannot take over; actual assigned fixer resolves with evidence.
- Outside-IT requester confirms their own scoped request. IT/system-requested work is checked by the current IT Manager; a resolution performed by the Manager is checked by the current IT Lead. Resolver role is snapshotted when resolution is recorded. Nobody confirms or returns their own resolution.
- Confirmation/return requires a boolean, a 3–500 character comment and exact resolution version. Each new resolution increments the version. Duplicate/stale decisions are refused.
- Legacy resolved work without a resolver snapshot is not silently accepted or assigned a guessed resolver. Current Manager explicitly reopens with reason and exact version (0 if absent); fresh resolution then follows normal checking.
- Previous resolution/evidence, resolver identity/role, version, actor, action and comment remain in ticket history. Reopening clears current acceptance, not history.
- Requester Mine visibility remains; loss of current scope removes action eligibility.

This is a trusted-server service policy on the existing ticket JSON database boundary, **not** a claim of new per-action SQL RLS.

## Frontend contract

Website issue rows expose `ticketPolicy`; IT Mine and ticket rows expose `webPolicy`:
`{canConfirm,canReturn,canAssign,canReopen,expectedResolutionVersion,checkerKind,legacyResolution}`.
`checkerKind` is `requester`, `it_manager` or `it_lead`; version is a number including 0 for legacy.

- `itAct('confirmTicket', {id,fixed,note,expectedResolutionVersion})`
- `itAct('reopenWebTicket', {id,note,expectedResolutionVersion})`
- Website `issueStep` close uses the same fixed/note/version fields; reopen uses note/version.
- Linked `recordConfirm` is refused: the eligible checker signs in directly.
- `assignTicket` remains Manager-only for linked work, with exact active staff ID.

The associated UI must expose these capabilities and capture required fields before rollout. Unlinked legacy issue rows expose `legacyActions` with existing scoped `canAssign`, `canClose` and `canReopen` authority; these are not linked-ticket checker approvals. The frontend must keep the legitimate legacy workflow usable and label it distinctly. Backend-only readiness is not operational readiness.

## Social activity

Only active accounts with a valid, nonfuture calendar last-post date at least 180 days old get an inactivity notice. Current company Manager(s) receive it, otherwise current IT Manager(s). Notices are in-app only and deduplicated by account/date/recipient; the existing visit-triggered scheduler remains, not a background service. Missing/invalid dates are unknown, never invented inactivity. The separate 90-day access review is unchanged.

Every dormant/closed save requires a valid documented reason, supplied now or retained from the existing record. Legacy missing reasons can be repaired without a false status toggle; supplied updated reasons are persisted and audited. No reason is invented.

## Validation boundaries

New focused synthetic tests cover checker separation, requester scope/Mine, current-role loss, stale/duplicate decisions, strict boolean, explicit delegation, legacy reopening, serialized races, valid date boundaries and deduplicated notices. A restricted-localhost PostgreSQL service test was authored in `it-ticket-refs-rls.test.ts` for concurrent confirmation and evidence-preserving reopen. It has **not** been executed locally. No browser, live Microsoft provider, production database or deployment validation is claimed.
