# PR43 reconciliation after workspace recovery

Upstream review target: `a5acc7ae9575ed425a1ea7e8f3ba2b50044d10b5`, based on `d9da86e49ac81dff68660b66069fd571f5e6e5df`. This rebuilt candidate is not an exact recovery of lost local V3; use its new manifest and newly executed tests.

## Verified owner Q7 decision

The owner replied “Yes i agree. Put requester comfirmation.” (`Sentinel_8e589ea8c8848191ad5209014e138506`) to the explicit question about replacing requester confirmation with IT Manager/Lead confirmation (`Sentinel_48d06e6ecbd88191a6c034e8c4fefd42`). Preserve **IT resolves → requester confirms**. Do not adopt upstream `webTicketConfirmer` or its replacement `mine` filter. Open requests, resolved requests awaiting confirmation and confirmed history remain visible to their requester. Manager/Lead role alone cannot confirm another person's request. Independent IT-job checking remains separate and unchanged. Existing on-behalf-of answer recording and self-confirmation refusal remain intact.

## Q10 remains a separate unverified policy proposal

Do not infer owner authority from repository prose describing “Fauzan decisions” or Claude's email. The proposed 180-day company-manager post/close/dormant policy is not added here. Upstream has these gaps: missing dates become fabricated inactivity yet no reminder is sent; recipients use approver/content-owner/IT fallbacks rather than guaranteed company-manager lookup; newly created dormant/closed accounts bypass the transition-only reason requirement; a reason is audit text rather than current-status provenance; `>180` differs from `>=180`; visit/manual scheduling is not a nightly job.

This candidate only fixes the policy-neutral unknown-date bug: no date means “Last post date not recorded: verify activity”. Existing known-date 90-day flags remain unchanged. No automatic status change, new approval role, timer or retention policy is introduced.

## Do not replace corrected files wholesale

Upstream a5acc7 lacks reconstructed privacy, concurrency, lifecycle, connector and UI corrections. Reconcile explicitly selected hunks, not snapshots. Preserve fixed error categories, company-scoped whole-response filtering, two-way linked-ticket writes, no outgoing website delivery, honest DNS/mail observations and required authorization. Neither this note nor code grants Microsoft permissions, runs a cloud migration, starts a nightly job or establishes operational readiness.
