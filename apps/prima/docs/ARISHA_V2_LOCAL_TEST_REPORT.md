# V2 local validation — not deployment approval

Repository base: `997ac0db24c43e9820401f19bc4049151f1eec10`. Local candidate extends the preserved V1 bundle. No remote branch, draft PR, workflow run, live database mutation or paid AI request was made.

## Executed checks

| Check | Result |
|---|---|
| Full core suite | **293/293 passed**, 12 files; includes the existing business-rule regressions plus eight new summary-context and five new Finance-AI tests |
| Combined offline API suites (`arisha-pilot`, `arisha`, `arisha-draft-routes`, `entra`) | **34/34 passed**: 17 Arisha/API-route/model-mock tests and 17 existing Entra tests |
| All-workspace typecheck | Passed |
| Core/API builds | Passed; new database tests compile |
| Final normal and demo web builds | Passed |
| Browser-script JavaScript syntax | Passed |
| Browser-script `--check-fixtures` | Passed through actual shared core authorization; this is not browser execution |
| Workflow YAML/static review | Passed; read-only repository permission and no Azure/private-environment credentials |
| Independent V2 source security review | No new concrete blocker found; bounded scope/data outputs and non-mutating tools verified by inspection |
| Patch whitespace | Passed |
| Production dependency audit | V1 audit reported zero known vulnerabilities; V2 did not change package manifests or lockfile |

New tests check identity/role/context scope, grant expiry and cross-company denial, source/coverage limits, real expiry-date boundaries, numeric-only summary outputs, missing/unknown status handling, non-mutation, Finance argument/status validation, human-only labels, role-filtered tools, unadvertised model action denial and authoritative summary evidence. Model responses are mocked; no real provider was contacted.

## Explicitly unrun

- Full PostgreSQL-backed API HTTP/RLS/setup suites. Local PostgreSQL binaries/services are unavailable; official distro metadata access is restricted. No workaround bypassed environment permissions.
- Actual Chromium desktop/mobile execution. Local browser startup previously failed with denied sockets; the candidate does not retry or bypass that restriction.
- Proposed future GitHub CI jobs for this exact candidate. Existing CI already supplies disposable PostgreSQL 16; the added browser job is prepared source only, not a green run.
- Live Entra mapping/sign-in, organization mandate completeness, deployment, migration, AI activation, operational acceptance, production runtime or security certification.

## Evidence interpretation

MemoryStore has no PostgreSQL transaction rollback or RLS and cannot establish database-level guarantees. Synthetic demo replay does not prove real HTTP authentication or responsive rendering. Generated answers can be wrong; the UI displays authoritative service evidence separately. Observation time is not source-update freshness, zero counts are not readiness, and partial supported contexts are not full organizational/SOP coverage.

See `ARISHA_CONTEXT_AND_FINANCE_AI_V2.md` for the exact supported capability matrix, and `ARISHA_CI_VALIDATION.md` for future isolated validation and publication/cost approval boundaries.
