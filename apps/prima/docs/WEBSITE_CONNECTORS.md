# Website, social and email register — reconstructed pilot candidate

This local replacement rebuilds the reviewed website scope after workspace recovery. Its hashes and test evidence are new; it is not the lost V3 artifact. Manual register, issue, monthly check, content-review and DNS-change workflows remain available subject to each user's existing authorization.

## Authorization and completion

The owner confirmed requester confirmation: **IT resolves → requester confirms**. Open, awaiting-confirmation and confirmed history remain visible to the requester. Manager/Lead role alone never substitutes for the requester's answer. The separate existing IT-job checker workflow is unchanged. Linked website and IT transitions run together; reopening clears stale confirmation/resolver fields. Integration identities cannot use the report feed.

Company-scoped responses exclude group connector state and SharePoint inbox metadata throughout the entire JSON object. A directly assigned IT executive sees only their own otherwise-unassigned issue/social account, not the company's entire register.

## Connectors remain off until explicitly configured and approved

Every read connector is OFF by default. Pasting a URL never grants access. Keys, permissions, tenant selection, provider inventories and actual runtime connectivity require separate authorized configuration and testing. GitHub requires explicit `GITHUB_WEBSITES_REPOS` (at most 20) and direct per-repository reads. Partial/paginated responses fail closed rather than pretending inventory is complete; previously stored observations remain. RDAP redirects are rejected and reported as unavailable until a vetted registry/bootstrap design is approved; manual expiry remains supported.

Response limits are 2 MiB streamed per response, 8 seconds per request and 30 seconds for the feed/network phase—not the surrounding database transactions or whole HTTP route. No automatic retries. Provider errors use fixed categories, never reflected provider text or credentials.

Website synchronization never sends email or Teams messages. Legacy delivery flags/queues cannot enable sending; the controller does not invoke a sender. Staff send/reply in Outlook. Website notices remain in-app. No Mail.Send, new Graph permission, webhook, nightly job or cloud resource is configured by this patch.

## Honest observations

DNS presence is not proof of DKIM signing, effective SPF expansion, actual mail delivery or security certification. Report collection remains unknown until checked. Unknown mailbox checks are not clean. A missing last-post date is unknown activity, not 90/180 days of inactivity. The existing known-date 90-day flag is unchanged; the proposed180-day manager policy is not adopted.

The first DNS reading establishes only a comparison baseline. Later drift stays flagged until explicit authorized acceptance with a comment; an unrelated approved DNS plan does not automatically bless a different fingerprint. Sample/live labels derive from authenticated application data mode, not the mere presence of a connector response.

## Verification limits

Use the newly generated local test log and manifest for exact evidence. Synthetic tests do not prove PostgreSQL locking/rollback, real-browser behavior, Microsoft/other-provider access, live deployment or production health. Restricted PostgreSQL concurrency/rollback tests are included for authorized CI; no live tenant/database call is part of local rebuilding. Publication, migration, activation and deployment remain separate gates.
