# Connections V2 local integration contract

Local candidate based on `15bbc5e1531b8dbeffd766c7da8366a41c697f9b`. No provider setup, credentials, tenant consent, deployment or live reads have been performed.

## Ownership and extension points

ChatGPT owns `apps/web/src/connections/{contract,registry,session}.ts`, `connections/sharepoint/*`, the Connections screen, shared API interfaces and SharePoint backend. The authoritative implemented interface is `apps/web/src/connections/contract.ts`.

Claude owns additive Mail and Power BI modules under `apps/web/src/connections/mail/*`, `apps/web/src/connections/powerbi/*`, `apps/api/src/connections-mail/*`, and `apps/api/src/connections-powerbi/*`. Submit their adapter exports and proposed registration diff for review; do not independently edit shared auth, navigation, shell, dependency manifests or generic API interfaces. Neither module is implemented in this candidate. Both cards are explicitly Not configured.

An adapter returns authenticated server-bound `serviceId` and `userId` in configuration and access evidence, with exact resource binding and a point-in-time timestamp. Never stamp client IDs onto provider evidence. The static registry rejects unknown/duplicate provider IDs. A missing adapter is distinct from a failed setup-status request. No successful Microsoft sign-in implies provider access or a global Connected state.

Provider panels receive the typed user/selection/evidence/epoch/AbortSignal/cancel/fail contract. They must not read a provider on mount. Each read is explicit and independently server-authorized. Cancellation, session/user/resource changes and errors clear evidence and metadata; late responses are discarded. Keep tokens/secrets out of UI props, persisted storage, logs and model context.

## SharePoint scope

Existing verified Microsoft sign-in is reused; no new OAuth registration or credential form. Exact user allowlisting, all mapped company visibility, genuine Entra assertion and explicit delegated Sites.Selected remain required. Navigation remains restricted to the existing leadership/IT cohort.

`approvedDriveIds` is now required for any library metadata: missing/empty means zero approved libraries, not all libraries. Site-only access checks remain possible. Invalid nonempty configuration fails closed. This intentionally narrows legacy configuration; any future server configuration change needs separate approval.

The server first reads bounded site membership IDs only, then names only for approved member IDs. All approved IDs must be found in the bounded membership page or listing fails closed. No automatic pagination, unapproved names/counts/next links, document bodies, downloads, imports or AI transfer. Up to 50 approved libraries remain selectable; root metadata remains capped at 25 entries.

Staff manual compose, review and explicit Send is an approved app feature, not yet implemented in this candidate. Autonomous replies remain Grok’s responsibility. Provider-specific send and Power BI actions/permissions still require implementation review and separate live configuration approval.

## Local verification and remaining gates

Run `node --test scripts/connections-state.test.mjs scripts/connections-v2.test.mjs`; the proposed CI change includes both. Focused API tests use injected mocked Microsoft responses only. The new UI checks include actual React SSR, not interactive browser UAT.

Before release: run full disposable-PostgreSQL CI and desktop/mobile interactive Connections tests; verify exact approved tenant/sites/libraries/users and Microsoft delegated access in a separately authorized environment. A passing build is not deployment, operational connection, privacy approval or security certification.

## Explicit action capabilities and cancellation (review correction)

`Capability` is a closed taxonomy: `checkAccess`, `readMetadata`, `composeSend`, `viewReport`, `embedReport`. Unknown and duplicate values fail closed. Provider boundaries are also checked: SharePoint supports only check/metadata; Mail check/metadata/manual compose-send; Power BI check/metadata/view/embed. These declarations do not configure a provider, grant consent, register a module, authorize an API operation or incur a charge.

An adapter with `ProviderPanel` must explicitly declare `panelCapability`. The shell mounts that panel only when configuration advertises the same reviewed capability and valid user/provider/resource-bound access evidence exists. A compose panel declaring `composeSend` cannot mount merely because `readMetadata` is advertised. Never relabel Send as metadata. This is a trusted-code integration contract, not introspection of arbitrary React components: module review and independent server-side authorization remain mandatory.

The shell displays a human-action warning for composeSend, including review/explicit Send and no cancellation recall. Report view/embed panels display sensitivity and explicit-opening guidance. No panel may send, open or embed on mount, check, retry, model response, or automatic effect. Distinct capabilities permit future separate view versus embed permissions; embedding needs its own reviewed provider authorization and origin controls. No Mail or Power BI adapter is registered by this correction.

`ProviderPanelProps` now supplies separate `cancel()` and `fail()` callbacks (replacing ambiguous `invalidate()`). Cancel clears evidence and panel data, aborts/discards the current generation and displays a neutral note; provider errors use fail and retain an unavailable/error indication. Cancellation cannot undo a submitted action or guarantee an already-started provider request stopped. Provider modules must preserve operation-specific confirmation, idempotency and server authorization; they must not infer send rollback from an aborted browser request.

Claude adapters must update their declaration and callbacks before registration. A Mail compose panel declares `composeSend`; a report-view panel `viewReport`, an embed panel `embedReport`; metadata-only SharePoint remains `readMetadata`. A provider with several distinct action panels needs a separately reviewed explicit routing contract, not a silent fallback to the most permissive capability.
