# Staging release safety modes — local candidate

This patch is prepared locally only: it has not dispatched a workflow, pushed an image, patched Azure, migrated a database, changed settings or published the website.

## Explicit modes

The manual **Deploy staging** workflow defaults to `build-only`. Both modes require `main`, GitHub actor `fauzan4377`, and triggering actor `fauzan4377`.

| Mode | Exact confirmation | Permitted effects |
|---|---|---|
| `build-only` | `BUILD STAGING IMAGE` | Run tests, build and push an API image to the existing registry; report tag, immutable digest and expected schema hash. |
| `deploy` | `DEPLOY STAGING` | After tests/build, perform schema-gated API image update and subsequent website publication/verification. |

Build-only is **not read-only and may consume build/registry resources**. It does not inspect API readiness or require a prior ready revision, and cannot enter the deploy job: no API image PATCH, migration, website deployment-token retrieval or website publication. Neither mode runs migrations or changes API settings/secrets/AI flags.

Deploy mode rebuilds the selected main commit and deploys the resulting immutable digest. Rebuilding identical source can produce a different image digest (for example updated base-image layers); this is not a promise to reuse an earlier build-only artifact. The locally built image ID is captured before push and must match the pulled immutable digest image ID, so a retargeted tag cannot substitute different image bytes. The candidate migration SQL is copied from a never-started container and its actual hash must match source; the OCI label is not sole evidence. Existing migration tooling/tag semantics are unchanged and migration remains separately authorized.

## Fail-closed schema checks

The deploy job requires Azure `activeRevisionsMode` to be exactly `Single` before capture and each image-changing operation. It does not change that setting. Multiple/unknown mode fails closed because latest-ready metadata and the public endpoint alone do not establish which revision receives traffic.

Immediately before the forward PATCH, the workflow requires a successful schema endpoint response with well-formed 64-character lowercase SHA256 hashes and internally consistent `{current, expected, applied}` values. `applied` must equal the candidate image's expected schema. Missing/404/malformed/contradictory reports stop without changing the API.

The old API may legitimately report `current=false` after an authorized migration: its expected hash can differ from the newly applied target. This is allowed only when the applied hash exactly matches the candidate. Startup enforcement is an additional defense, not a fallback for missing preflight evidence.

## Rollback proof and first-release limitation

A prior image is eligible for automatic rollback only when its ready revision already specifies an **immutable digest**. Resolving a mutable tag today does not prove what is actually running; legacy tagged revisions therefore require manual recovery if deployment fails.

For an immutable prior image, the workflow pulls that exact digest, creates but **never starts** a container, copies `/app/db/migrations/001_init.sql`, and hashes the actual file. It verifies the ready revision/reference did not change during capture. OCI labels are informational, not the sole schema proof. Missing image/file/hash, changed revision or unknown evidence is never treated as safe recovery.

If prior evidence is unavailable or its schema differs from the candidate, the workflow warns **before** the forward PATCH and records that automatic rollback is unavailable. Forward deployment may continue only after the candidate schema gate passes. A schema-changing migration normally makes the prior image incompatible.

Before **every** rollback PATCH attempt, a fresh successful schema response must show applied schema equal to the captured prior-image hash. Missing evidence or mismatch blocks rollback and requires manual recovery. No automatic database downgrade, migration or fallback to an old tag is permitted. Restoration is reported verified only after the prior digest is configured/ready, health succeeds, and the schema endpoint reports that prior expected/applied hash as current.

## Offline checks and remaining verification

Pure Node schema-gate tests and workflow/CLI contract tests run in both normal CI and the manual workflow's test job, before Azure authentication. YAML and every shell block can be parsed locally without contacting Azure. These tests establish decision/ordering contracts, not actual Azure behavior, registry identity, live schema state, deployment success or security certification. Independent review and an explicitly authorized workflow run remain necessary before relying on this operationally.

## Separate approval order

1. Review and separately authorize publication of this local release-safety patch; do not dispatch merely because CI passes.
2. Authorize `build-only` with its exact confirmation if a registry artifact is needed. Review its digest and actual schema hash.
3. If needed, separately authorize and perform the migration using the existing administrator-controlled tooling. This workflow never invokes it.
4. Review current schema evidence, revision mode and the manual-recovery limitation; separately authorize `deploy` with its exact confirmation.
5. Verify the resulting revision and website, then handle identity links, AI activation and business UAT under their own approvals. A workflow success is not full organizational readiness.
