> Current rental/rates/inspection and staff-guidance coverage is specified in the final section. Earlier checkpoint limitations are historical where explicitly superseded; pending identity onboarding and live gates remain unresolved.

# Monday online pilot: requirements, evidence and release gates

This is an evidence map for the combined candidate, not a claim of production readiness, security certification, tenant consent, or completed staff UAT. The planned first phase is a one-week ONLINE operational IT pilot. Offline PR46/48 and Finance PR49 are excluded. Independently reviewed rebuilt website expansion is included; external read connectors remain OFF and automatic Mail/Teams unavailable. Each of the six named IT staff must perform their own day-of tests; manager verification does not substitute for individual sign-in and workflow evidence.

| Requirement / role | Implemented candidate path | Synthetic evidence | Still required before claiming operational readiness |
|---|---|---|---|
| IT ticket logging, assignment, resolution, requester confirmation | Existing IT service/UI; signed-in resolver saved; no self-confirmation | `it-checking.test.ts`, `core.test.ts`, existing IT browser smoke | All six personal-account tests with approved test records; requester confirmation evidence |
| Jobs, proof, technical check, Manager acceptance/return | Executive technical work goes through Lead then Manager; Lead's work checked by Manager; no self-check; reviewed leadership intervention with comments and notices | `it-checking.test.ts`, `coo-monitors.test.ts`, PostgreSQL decision/notice races | Day-of accept, return, resubmit and Seen tests; actual role/account mapping |
| Asset issue and return | Existing IT asset service/UI and holder records | Existing `core.test.ts` IT asset cases | Individual issue/return with permitted synthetic assets; no real stock movement during trial simulation |
| Asset maintenance | Service/repair only; strict finite nonnegative numeric cost; transaction locks asset history | `it-maintenance-validation.test.ts`, `it-maintenance-route.test.ts`; PostgreSQL concurrent-history test | Combined PostgreSQL test pass; staff service/repair demo. Technical safe-cent bound is not a new spending or approval policy |
| Simulated IT purchase | Existing COO and CEO decisions; Finance Director records payment separately after approved workflow | `core.test.ts` IT procurement/payment and rejection cases; `pilot-routing.test.ts` | Simulated end-to-end owner/Finance UAT; no actual payment or charge authorized by testing |
| Four-leader Arisha | Exact CEO/Finance Director/COO/ACT identities. Role-scoped summaries and draft tools; human save retains existing permissions | `arisha-context.test.ts`, `arisha-drafts.test.ts`, `arisha-policy.test.ts`, API pilot/tool tests | Each leader's live tool/denial tests and company-grant checks; chat replies alone do not prove tool UAT |
| Arisha-assisted batch import | CEO-only extraction proposal, immutable admission, explicit review, stale refresh, stable-ID recovery and transactional commit | Import core/API suites; real-core adapter tests; import browser harness | Exact combined DB/browser CI, final schema migration, both backend and build-time UI activation gates, approved source/data use; no automatic AI commit |
| SharePoint selected libraries | Existing Microsoft identity, approved site/library allowlists, metadata and safe file links, explicit generic setup request | Connections/SharePoint API, state, HTTP and browser tests | Actual selected-site consent/configuration and synthetic tenant UAT. Setup ticket is not consent; no document bodies sent to Arisha |
| Selected Outlook email copied onto a job | Own-mailbox selected-message preview, explicit attach, re-read, signed short-lived proof, current job audience and durable dedupe | Mail unit/controller/SQL tests, owner-switch tests, registration test and browser harness | Mail.Read consent/config, preview secret, module-v2 migration, synthetic tenant URL test, cleanup schedule; owner decision on proposed 30-day snapshot retention and job-audience redistribution remains unresolved |
| Staff sending/replying to mail | No autonomous reply or Mail.Send controller registered in this candidate; selected-email copy is a different feature | Registration test rejects legacy Send controller/provider | Owner confirmed staff Send/reply remains in Outlook; copied-message audience and retention are separate decisions |
| Power BI | Not registered or claimed connected | Registration negative test | Required scope, implementation and any deferral need explicit owner decision; absence is not approval to defer |
| Website schedules | Reviewed rebuilt PR43 website registers, linked IT lifecycle and bounded optional connectors, plus scheduling: per-visit retry/cancellation, serialized cycles/settings, reminder dedupe and correct Checks navigation | Website core/state tests and PostgreSQL concurrent-first-run test | Combined DB/browser evidence and role UAT; external read connectors OFF pending setup; automatic Mail/Teams unavailable |
| Drawer accessibility | Accessible title, initial focus, guarded Escape and focus restoration | Seven helper/SSR checks; synthetic Drawer browser harness | Actual desktop/mobile browser results and keyboard UAT; Tab focus trapping remains an explicit gap, no WCAG certification claimed |
| Unexpected-error privacy | Static error classifications and generated references only; raw DB errors never logged | `errors-privacy.test.ts` private body/address/token canaries | Runtime log configuration review; this does not certify all external services’ logging |
| Approved Arisha identity | Existing approved avatar bytes bundled; accessible fallback | Six avatar assertions after demo build | Verify desktop/mobile rendering on reviewed release; no new generated design implied |

## Four-leader capability boundaries

- CEO and ACT: operations, compliance and finance-paper summary contexts, subject to actual company access; four narrow record draft kinds (`site`, `post`, `checkpoint`, `itDomain`) and permitted finance-paper preparation. CEO also retains existing company draft preparation.
- COO: operations summary and the four record draft kinds within server-authorized scope.
- Finance Director: finance-paper summary/options/preparation within finance scope.
- These are not universal CRUD or coverage of every organizational SOP. ACT does not acquire CEO operational approval authority. Prepared drafts do not themselves save operational records. Existing deliberate authorized self-review is distinct from prohibited IT self-checking.

## Release gates and unknowns

1. Pin and review the actual combined commit; run its full GitHub PostgreSQL and desktop/mobile suites, not only separate-PR checks.
2. Global SQL fingerprint and job-email module checksum are separate checks. One healthy schema endpoint does not prove the optional module is installed or configured.
3. Import UI requires `VITE_ARISHA_IT_IMPORT_UI_ENABLED` at build time as well as backend readiness/flag. The existing deployment command does not currently supply that flag; an explicit reviewed activation path is required.
4. Retention schedules, account links, genuine grants, secret configuration and tenant consent require their own verified operational steps. No such changes are performed by this code candidate.
5. The 24-hour import-review expiry and 30-day review-row purge do not erase imported operational records, retained metadata/audit, or backups. Job-email retention/audience is a separate proposed policy, not covered by that approval.
6. Existing live Arisha remains separate from this candidate's default-off new integrations. Do not disable a working live assistant merely because its new tools are gated.
7. No Monday completion promise is justified until the remaining owner decisions and actual role/tenant UAT gates are satisfied.

Independent company-scale probe: 38 and 50 companies show correct counts; 12 added companies truthfully have no website. Repeat scheduling produces no duplicate reminders. The probe used 28 existing sites, not 50 live websites or a production load test.

Historical pre-intake replacement gaps (superseded by the implemented coverage below): manual joining/leaving intake and system-register intake were not present; existing seeded-record updates are not substitutes for real intake. Standalone tender add already exists. Manual SharePoint guidance register is a bounded recommendation, not uniform compliance certification. Owner-confirmed requester confirmation remains required after IT resolution.

## Current online manual-intake coverage

The prior replacement intake gaps are now implemented in the reviewed manual backend/UI delta: joining/leaving, system register, SharePoint guidance and existing-device registration. These are administrative records only, not provider provisioning/revocation or certified compliance. Existing-stock registration invents no purchase/price/ownership; real rental billing and payment remain blocked pending approved rate implementation. Guidance independently checked only by eligible IT Manager; no alternate checker grant is invented.

Durable receipt schema readiness, PostgreSQL atomicity/RLS/concurrency and browser interrupted-save/account-switch/mobile coverage are still release gates. New global SQL hash6d1b62e0dd9b63fd303dd3693ca14222b6bec0bbba1ea41fc77fb3a5eb455abd must not be confused with the old live schema. No migration/deployment has occurred. Offline remains after Monday; online working first.

## Latest owner-approved operational additions

- Manager-configured actual rental rates; staff authorized asset/billing records with versioned references, no test default prices and no payment claim. Legacy/unverified records remain explicit.
- Every asset: six-calendar-month inspection plan, unknown baseline handling, status/proof and linked IT follow-up.
- Staff Arisha: deterministic, read-only scoped guidance and next steps; no expanded staff LLM or automatic actions.
- Staged HR/IT identity onboarding is pending implementation/integration and is not completed by its guide text.
- Current SQL7a15ee7d4f1fbcbd1636b13b6abeb4c044eb0df4ae604998ee7c8fbde00428b8 requires reviewed migration. PostgreSQL/browser CI, actual tenant setup, all individual staff UAT and deployment approval remain separate gates. Online first; offline after Monday.

## Staged HR / IT update

Earlier pending-implementation labels are superseded for the bounded coordination layer: HR intake and exact-company scope, distinct CoS/company-head reviews, independently approved task-specific IT delegation, staff-own unverified evidence, and HR-admin handoff review are implemented. This is not user creation, identity binding, grant application, directory verification or provider provisioning/revocation. Missing authoritative configuration is pending_setup; personal-data retention approval and actual binding execution remain unresolved. NewSQL eab7e74c512a8069aaea5d5b527ff0e2e3d04c73b2c26de9405ba0c89b72d92c needs reviewed migration/PG tests.
