# Prima: leadership-first Arisha onboarding plan

**Status (30 Oct 2026):** PR #23 four-leader access controls are **merged to main** (commit `901bc54423352d9270478a3776658916b1163878`) but **not verified deployed or AI-activated**. This is not permission to import real employee records or activate paid AI.

## First pilot — CEO plus three directors
- **CEO:** `u-fauzan` (`opsTier=ceo`) — may chat with Arisha and prepare individual record drafts. The CEO still reviews and clicks **Save**; Arisha never saves on its own.
- **Finance Director:** Microsoft Entra lookup returned **Nabilah Jaafar** / `nabilahjaafar@pwvsb.com`, object ID `ecabeb73-74bf-44ec-85c9-e7a47ee891d7`; intended Prima record `u-fd` (`leadership=finance_director`) — finance AI chat, no record-preparation tools. **Prima account link remains UNVERIFIED.**
- **COO:** Microsoft Entra lookup returned **Faiz Fikri Jaafar** / `faizjaafar@pwvsb.com`, object ID `f896e9b4-a48c-49a5-a37d-4be2b7c98641`; intended Prima record `u-coo` (`opsTier=coo`) — operations AI chat, no record-preparation tools. **Prima account link remains UNVERIFIED.**
- **ACT Director:** intended Microsoft account `nurshahirah@pwvsb.com`, Prima record `u-audit` (`actRole=lead`, currently called ACT Lead in Prima) — AI chat for authorized audit/compliance screens, without record-preparation tools. **The account-to-record link is not verified yet.**
- Access requires both the exact pilot user ID and matching role marker; all other users and integrations are denied Arisha API access. The frontend hides Arisha from other users but **backend enforcement** is authoritative.

## Optional lock against staff use of Prima during onboarding
- `LEADERSHIP_ONBOARDING_ONLY=true` blocks authenticated office API sessions for everyone except those four named management users. The setting defaults **off** and no live Azure configuration is changed by this PR.
- If enabled, independently verify that an ordinary staff account is refused, each leader can sign in using their linked Microsoft identity, and the external integration/feed endpoints remain disabled or separately controlled as necessary. This lock does not confer elevated business-data access; original company and department permissions still apply.
- Turning the flag on creates a new Azure Container App revision: preserve existing registry, DB and secret configuration and verify rollout before admitting real data.

## Existing features and limitations
- Arisha's current record tools are only `record_form` and `prepare_record`. Approved CEO drafts are then committed by a separate Save action.
- No AI-driven import from Excel/CSV/PDF, source citations, company master creation, duplicate checking, verification review queue, batch rollback, or duplicate-safe dry run exists yet. These require separate reviewed development.
- The AI model receives conversation history and text from the user's on-screen data. Do not enter confidential employee IDs, payroll, medical or banking records until a privacy/data-minimization review is complete.
- The API's session permissions and business-data access rules are unchanged; don't assume Arisha can read across departments.

## Activation prerequisites
1. PR #22 and PR #23 have both been merged; before assuming their code is live, check the deployed API image and website revisions. Neither merge switches on the paid AI.
2. Provision or reuse secured Azure OpenAI capacity, configure model & compatible chat completions API version, grant `id-prima-staging-app` only `Cognitive Services OpenAI User` on that resource, and configure `AZURE_OPENAI_CLIENT_ID` for the identity. Validate connection with dummy prompts before `ARISHA_ENABLED=true`.
3. Before bringing real company or employee operational data into Prima, fix remaining security blockers in `docs/STAGING_PREPUBLICATION_REVIEW.md`: password/PIN/face-security gaps, department-level row-level security, offboarding and tested external backup. Decide how mock records will be retired, with a verified recovery point.
4. Keep the seeded mock records until a separate, tested, approval-based onboarding/import workflow is ready. Don't execute destructive cleanup or submit real personal data now.

## Onboarding order
1. Company register and authorized company relationships; source-based validation
2. Director Office, Finance, COO/Operations and ACT reporting structure
3. Client contracts and operational site registers
4. Licences, insurance, vehicles, assets and renewal dates
5. Personally identifying staff/payroll/bank/medical details **only after** security, access and data-minimization review

## Acceptance and later staff rollout
Test each of the four leadership accounts and deny a fifth account. Confirm CEO-only record tools and explicit Save approval. Staff go-live requires separate authorization and a planned change of `LEADERSHIP_ONBOARDING_ONLY=false`. Widening Arisha beyond four leaders requires independent code review.

## ACT Director account-link verification before go-live
- The CEO provided the intended ACT Director email: `nurshahirah@pwvsb.com`.
- Azure Cloud Shell Entra lookup returned `displayName=Nurshahirah`, `userPrincipalName=nurshahirah@pwvsb.com`, and Entra object ID `1d959dc3-8410-49f6-a7cc-5908c83aaaf3`. This establishes the Azure account identity but does NOT establish a Prima link.
- Prima authenticates office users by their **verified Microsoft Entra object ID** (`entraOid`), not by email or display name. Do **not** put an email address into the `entraOid` field or grant pilot access just by matching an email.
- From an authorized Azure session, read the account identity using `az ad user show --id nurshahirah@pwvsb.com --query '{displayName:displayName,userPrincipalName:userPrincipalName,id:id}' -o json` (read-only). Confirm the result is the intended colleague; emails/UPNs can be aliases and are not proof of identity on their own.
- Separately use the established audited one-off `apps/api/src/entra-link.ts` workflow to link the **confirmed object ID** to the `u-audit` Prima record, after checking that it is not already linked to a different account. This is a database write requiring explicit authorized change approval; **not performed by this PR**.
- The current `u-audit` seed record still has mock name text. Replace/verify the displayed staff identity through a separate approved master-data change before treating it as a real staff record.
- Verify sign-in for the intended director, then verify Arisha chat is available, record preparation remains CEO-only, and unrelated accounts remain blocked.

## Finance Director and COO account verification before go-live
- CEO provided Finance Director's intended Microsoft account: `nabilahjaafar@pwvsb.com` → Prima user `u-fd`.
- CEO provided COO's intended Microsoft account: `faizjaafar@pwvsb.com` → Prima user `u-coo`.
- Read-only Microsoft Entra lookups **already returned** the expected display names, UPNs and object IDs: Finance Director `ecabeb73-74bf-44ec-85c9-e7a47ee891d7` (Nabilah Jaafar), COO `f896e9b4-a48c-49a5-a37d-4be2b7c98641` (Faiz Fikri Jaafar). Reconfirm them if the tenant has changed; lookup does **not** prove their Prima links.
- Confirm there is no existing conflicting `entraOid` association in Prima for either account before using the existing audited Entra linking workflow. Do not link by email, perform a database change or grant AI access as part of this documentation update.
- The `u-fd` and `u-coo` records currently contain seeded mock identity data. Real displayed names/roles must be confirmed and onboarded separately before real staff use.
- After linking, independently verify Microsoft sign-in and finance/operations permission boundaries. Only `u-fauzan` may use the AI record-preparation tool; the Finance Director and COO have conversational AI assistance only in this pilot.

## Identity-link preflight for all three directors (NO database change performed)
The three Microsoft Entra user identities were supplied from Azure Cloud Shell by the CEO on 30 October 2026. Before authorizing an actual Prima link:

1. **Access the private PostgreSQL network through an approved admin environment.** Use a read-only query first, and do not enable public network access, paste connection strings or use the routine GitHub deploy action for this.
2. Inspect the existing target Prima records and whether the OIDs appear on *any* other user record. The checks are read-only; expected target mapping below:

   | Prima ID | Expected role marker | Expected Entra OID |
   | --- | --- | --- |
   | `u-fd` | `leadership=finance_director` | `ecabeb73-74bf-44ec-85c9-e7a47ee891d7` |
   | `u-coo` | `opsTier=coo` | `f896e9b4-a48c-49a5-a37d-4be2b7c98641` |
   | `u-audit` | `actRole=lead` | `1d959dc3-8410-49f6-a7cc-5908c83aaaf3` |

   For an authorized DB administrator, an example *read-only* SQL check is:
   ```sql
   SELECT id, data->>'name' AS display_name,
          data->>'opsTier' AS ops_tier,
          data->>'leadership' AS leadership,
          data->>'actRole' AS act_role,
          data->>'entraOid' AS entra_oid
   FROM prima.users
   WHERE id IN ('u-fd', 'u-coo', 'u-audit')
      OR lower(data->>'entraOid') IN (
        'ecabeb73-74bf-44ec-85c9-e7a47ee891d7',
        'f896e9b4-a48c-49a5-a37d-4be2b7c98641',
        '1d959dc3-8410-49f6-a7cc-5908c83aaaf3'
      );
   ```
3. **Stop and investigate** if an existing target link differs, another staff record already has one of the OIDs, or seeded mock identity/role records do not match the actual named directors. Do not silently overwrite, duplicate or relink.
4. After CEO/authorized IT approval, use the existing audited `apps/api/src/entra-link.ts` process in a protected private-network admin run. Explicitly link each confirmed OID to its intended Prima record; the helper checks duplicate OIDs and logs the change. The current documentation update does **not** execute these writes.
5. Verify Microsoft app assignment, MFA, signed-in identity, four-leader access, denial for a fifth staff user, and that **only CEO** receives AI-assisted record preparation. No employee personal-data import until security/privacy gates pass.
