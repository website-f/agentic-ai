# Arisha Azure activation runbook — controlled staging

## State of play
- PR #22 and PR #23 merged on `main`; actual Azure image/revision and `ARISHA_ENABLED` must be checked before any deployment or assumption that AI works.
- PR #26 is the proposed company-master form. Do **not** merge/deploy without CI/review.
- Three Microsoft Entra object IDs are verified but their **Prima DB links are unverified**. A user email is not an account association in Prima.
- Last Azure Cloud Shell output showed no OpenAI/AIServices resource and `ARISHA_ENABLED=false`.
- The current expected user-assigned API managed identity is `id-prima-staging-app` with client ID `fb3881d0-7c7b-4114-b539-f9606dcdb315`, principal ID `8cd9479b-9fd4-47d0-91a5-9d90fbd27ef9`.

## 1. Read-only preflight
From an authenticated Azure Cloud Shell, run:
```bash
bash infra/check-arisha-readiness.sh
```
(When cloning the private repository in Cloud Shell, use the approved GitHub access method; do not paste a PAT into shared output.)

Record the current AI resource name, model deployment, ready image revision, managed identity, role grants, subscription and budget/quota. Do not emit Azure Key Vault secret values, tokens or DB connection strings.

## 2. Identity-to-Prima linking
Use the private-network admin environment and the audited `apps/api/src/entra-link.ts` flow, **not an email-based lookup**.

Expected account IDs from read-only Azure Entra:
- Finance: `u-fd` (Nabilah Jaafar) → `ecabeb73-74bf-44ec-85c9-e7a47ee891d7`
- COO: `u-coo` (Faiz Fikri Jaafar) → `f896e9b4-a48c-49a5-a37d-4be2b7c98641`
- ACT: `u-audit` (Nurshahirah) → `1d959dc3-8410-49f6-a7cc-5908c83aaaf3`

Check all existing Prima `entraOid` values (including conflicts), current display names and role markers **before** any write. The seeded names are mock data. Obtain the CEO's approved identity/record correction, perform one audited change at a time with a protected administrator login, then test sign-in. Never expose the DB by opening a public firewall port.

## 3. Paid Azure OpenAI resource approval
No AI resource existed in the previous Azure inspection. Before creating it: choose a supported chat-completions/tool-calling model in a permitted location; verify quota availability, privacy/data processing requirements, pay-as-you-go rates, a monthly cost ceiling and a budget alert. **Do not use provisioned hourly throughput just for this pilot.** Follow the actual model list and region supported by the subscription.

Create a resource/deployment only after cost approval. The endpoint is obtained from the new resource, not guessed; supply the deployment **name** rather than the model family alone.

Grant the existing app managed identity the `Cognitive Services OpenAI User` role scoped to the AI resource, not the entire subscription/group. The current code calls Azure OpenAI using managed identity, not an API key.

## 4. Configure API environment only when ready
The code requires these values:
```
ARISHA_ENABLED=true
AZURE_OPENAI_ENDPOINT=<actual HTTPS resource endpoint>
AZURE_OPENAI_DEPLOYMENT=<actual deployed model name>
AZURE_OPENAI_API_VERSION=2024-10-21
AZURE_OPENAI_CLIENT_ID=fb3881d0-7c7b-4114-b539-f9606dcdb315
```
`LEADERSHIP_ONBOARDING_ONLY=true` is a separate, optional approval to block general staff access. It defaults off.

On Container Apps, setting environment variables creates a revision; record the previous ready image/revision and test a rollback plan. The standard GitHub `Deploy staging` workflow updates an image only and does not set environment variables or run migrations.

## 5. Controlled UAT and off-switch
1. Use mock-only prompts: every one of the four named users gets chat; a fifth user is rejected on the **server**.
2. CEO can prepare a company draft (PR #26 after approved deployment); no save before pressing Save; company ID/code unchanged, duplicate SSM blocked, audit entry written.
3. Finance/COO/ACT cannot get `record_form` or `prepare_record` tools, cannot write company master using AI and cannot see another department's data.
4. Validate logs for no secret values, review AI screen-context minimization and verify the separate monthly budget alert.
5. Off-switch: update `ARISHA_ENABLED=false` and verify `GET /api/arisha` reports disabled; this requires an API revision deployment by authorized Azure staff.

## 6. Before importing real employee data
Address unresolved security findings in `docs/STAGING_PREPUBLICATION_REVIEW.md` (PIN hashing/server face scoring, department-level row-level controls, account offboarding, backup/restore, privacy). Do not load payroll, banking, medical or private HR documents until those gates are closed.

**This runbook makes no Azure or DB changes.**
