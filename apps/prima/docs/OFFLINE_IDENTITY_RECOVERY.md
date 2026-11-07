# Offline identity repair and activation gates

This is an isolated repair of PR #126 at `f90be8f5e95b3d6f98d995ad1f72781b021a9044`. It does not activate offline recording, provision devices, change providers, migrate records, or authorize deployment.

## Identity and lifecycle

Offline recording requires a server-provided `DutyOfflineContext`: the authenticated account, authorized company and site, immutable device ID and unique enrollment ID. The server derives account/company/site itself. `User.dutyEnrollment` is absent by default. No seed, enrollment writer or setting is introduced here. Until a separately reviewed enrollment flow provisions both immutable identifiers, duty work remains online-only and an offline submission explicitly reports that it was **not saved**.

An enrollment flow must authenticate the physical device/account association, issue an unpredictable unique enrollment ID, rotate it on re-enrollment or reassignment, and never reuse an old ID. A caller must not be allowed to edit these fields through general profile updates. This field is a server-side binding, not device hardware attestation.

Each browser tab must first verify its context online. The verified lease exists only in memory. Reloads cannot unlock data from persisted account hints. Sign-out, sign-in/account switching, Microsoft sign-in, or a 401 invalidates the lease; a BroadcastChannel also locks other open tabs. Context changes during asynchronous operations invalidate their original lease. Server reassignment is checked before replay and again by the mutation service, before any idempotent result or write.

Each complete identity tuple has a separate v2 IndexedDB namespace and non-exportable AES-256-GCM key. Authenticated additional data binds that tuple, format version and record purpose; outbox metadata also binds client reference, kind and timestamp. Copying a key and ciphertext to a different namespace does not authenticate. Initial key selection is an IndexedDB read/write transaction: concurrent tabs generate candidates outside the transaction, but all use the first stored key. Reads never create replacement keys.

The current ordinary online endpoints remain available without `offlineContext`. Offline resends always carry it, and every duty mutation parser preserves and validates it. Client claims never grant company/site access. A missing or different server enrollment prevents resend. A 401 preserves waiting records rather than permanently refusing them.

## Pending-record recovery

1. Before logout, reassignment or re-enrollment, an authorized supervisor should inspect and reconcile the original enrollment's pending entries while it is still authorized. Do not clear site storage, uninstall the browser profile or delete keys to resolve a sync problem.
2. Logout and switching do not delete cache, keys or outbox records. A different enrollment cannot view or send them. Sign in online with the still-authorized original account and original enrollment to review/retry its queue. Re-enrollment intentionally does not unlock the former enrollment.
3. If the original enrollment is no longer authorized, stop. Preserve the browser profile and obtain an approved recovery procedure. This patch deliberately does not offer a cross-account transfer, key export, automatic rebinding or administrative bypass.
4. The legacy `prima-duty-device` database is retained untouched. Its records lack authenticated provenance, so this patch never loads, migrates, assigns a site to, or flushes them. Authorized recovery must independently establish each record's origin, reconcile against server receipts and obtain a supervisor-approved manual record/transfer process. Do not infer origin from the currently signed-in account. No legacy recovery/deletion tool is implemented by this patch.
5. Refused records remain until the existing explicit supervisor removal workflow is used. Unreadable ciphertext is retained for recovery rather than treated as successfully sent. Storage failures are surfaced rather than reported as an empty queue.

A browser CryptoKey is not protection from malicious same-origin scripts, an unlocked browser profile or device compromise. Existing retention/deletion jobs, hardware binding and custody remain separate activation gates.

## Verification

Use only synthetic fixtures and a throwaway browser profile. These commands assume the repository's dependencies are installed:

- Build core: `npm run build -w @prima/core`.
- Service and parser regressions: `node tests/offline-core.cjs`.
- Synthetic transaction-serialized IndexedDB with real Node WebCrypto: `node tests/offline-synthetic.cjs`.
- Native Chromium IndexedDB/WebCrypto, six tabs and synthetic loopback API: `node tests/offline-browser.cjs` (uses Playwright’s bundled Chromium by default; `PLAYWRIGHT_MODULE` may select the runner’s installed module and `CHROMIUM_PATH` may override its executable).
- Actual HTTP/restricted PostgreSQL: after building the API, run `node tests/run-offline-http.cjs` with `DATABASE_URL` pointing to the disposable loopback CI service’s `prima_test` or `postgres` database. It creates its own `prima_offline_test` database, refuses an existing database, uses a password-authenticated restricted role, and cleans up only its own database/role. Never point it at a live service.
- Existing core duty-device and site-task tests, and complete application typecheck/build.

`TYPESCRIPT_PATH` and `CORE_DIST` may point to an isolated compiler/compiled-core directory. The synthetic IndexedDB adapter is not proof of browser transaction scheduling. Native browser tests, real-phone airplane-mode/reload/logout flows and restricted HTTP/PostgreSQL/RLS replay tests must pass on the final integrated commit before activation. No real staff data, credentials or provider calls are part of these tests.

CI runs the synthetic/core checks after the core build, the HTTP/PG runner after API tests, and the native browser suite using the existing pinned Playwright installation in the isolated synthetic-browser job. These checks do not enable offline recording or any external provider.
