# Local import review integration — not published or activated

Backend shape pinned to PR42 `13c36ec6a3d471d63510197b0087c1552868af47`; independent reviewer confirms `6cb3efa` preserves this contract and clears code-level backend blockers. Deployment, schema migration, daily cleanup scheduler and owner activation remain separate prerequisites.

## Implemented locally
- Default-off `VITE_ARISHA_IT_IMPORT_UI_ENABLED` build flag; app remains blocked unless explicitly enabled. Backend `enabled/ready/problems` and exact CEO checks remain additional gates.
- Real HttpApi transport restricted to review routes, Microsoft-only bearer with no development-token fallback, and current `/me` CEO verification before operations. Backend independently validates linked Microsoft OID and permissions. No live request was made during development.
- Durable localStorage marker contains **only** schema1, owner ID and UUIDv4 request ID. No source, row data, token or receipt is persisted. Key is scoped to API origin and owner. Browser Web Locks serialize operations across tabs; missing locks/storage fails closed.
- Marker is saved and reread before create POST. Same request ID is review ID. Lost response/reload recovers via GET without source resend; unknown/404 does not generate another batch. Logged-out/other-account access is rejected by the host before marker use. This is not encrypted storage or a security boundary against malicious same-origin scripts.
- Stable server row IDs and CSV numbering retained for updates. Admitted review edits work after extraction's 15-minute TTL and after reload without original source. Source is sent only on first admission. AI scope remains one extraction and at most20 proposals.
- Saved/displayed preview tokens remain separate. Stale GET disables approval; explicit refresh saves the new version, followed by separate confirmation.
- Human edits replace source-support labeling. No source offsets are fabricated on resume.
- Only explicit Start another review can retire a pending marker, after GET confirms the original server receipt or its expired/abandoned closed state. No automatic abandonment, record deletion or expiry-based assumption is used. Unknown results remain blocked.

## Verification and limits
68 synthetic fake-wire/session tests, storage+cross-tab mocks and mocked authenticated HTTP exercise these boundaries. No actual browser storage, Microsoft sign-in, Azure, Graph, model or live database call was used. Two additional tests run against the actual reviewed PR42 core build in MemoryStore: create/reload after16minutes/edit/approve/retire and lost-create/GET/one-ledger. This does not exercise HTTP guards, PostgreSQL or real Microsoft authentication. Run with PRIMA_REVIEWED_CORE_MODULE pointing to the separately reviewed core build. Independent QA is tracked separately. PR44's successful synthetic browser run covers its published UI, not this newer unpublished adapter.

Remaining release gates: independent review of new transport/storage wiring; full reviewed-core/HTTP/browser integration; real linked-CEO/staff UAT; final schema and scheduler deployment evidence; explicit publication and activation approval.

Offline prototype and72-hour offline policy remain separate; import review24-hour expiry/30-day retention policy is unchanged. No dependency, backend, permission, migration or deployment change included.
