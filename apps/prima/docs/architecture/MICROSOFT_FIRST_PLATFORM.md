# Prima Secure App — Microsoft-first enterprise architecture
**Owner:** PWVSB CEO | **Status:** Proposed architecture / controlled development baseline | **Date:** 28 October 2026
**Replaces:** Cloudflare/DigitalOcean recommendation in draft PR #8 as the target architecture. This is a planning decision, **not** evidence that Azure services, M365 connectors, AI or production deployments have been provisioned.

## CEO decision

Target an **all-Microsoft cloud and productivity architecture** for the platform:
- Reuse the existing Prima React web/PWA, NestJS backend, shared TypeScript core and PostgreSQL, without rewriting.
- Microsoft Azure and Microsoft 365 are the target hosts/services; GitHub remains source control and Claude Code is an implementation agent, ChatGPT is independent planner/reviewer. Human approval is mandatory before merging, changing access or deploying.
- Phase order exactly: **1 IT → 2 Finance → 3 HR → 4 Special Enterprise Operations → 5 Central Administration → 6 Nationwide Operations.**
- Do not imply every user needs an expensive Power Apps, Power Automate Premium or Microsoft Copilot licence.
- Treat each security company as a distinct legal entity. PWVSB access needs documented mandate/authority and least privilege, not assumed ownership.
- Existing SQL Account remains authoritative financial ledger; OEM CCTV/VMS/ANPR/access and regulated statutory/financial systems remain their own authoritative systems with governed integrations.
- CEO makes final policy, budget and go-live decisions, assisted by technical staff and independent security/finance/legal reviewers.

## Logical architecture

```
Existing staff (Microsoft 365 accounts, MFA)      Future guard/external identities (separate design)
    |                                                         |
Microsoft Entra ID (single tenant pilot)                  Entra External ID feasibility
    |
React/Vite frontend — Azure Static Web Apps (production build, NEVER demo build)
    |
NestJS API — Azure Container Apps (server-side verified user/tenant, company walls, policy gates)
    |--> Azure Database for PostgreSQL Flexible Server (transaction records, RLS and audit)
    |--> Azure Blob Storage (private app evidence, protected by policy and scoped access)
    |--> Microsoft Graph (Teams notifications, Outlook, SharePoint evidence links, M365 account support)
    |--> Azure Functions / Logic Apps / Power Automate (time-based/connector workflows)
    |--> Azure AI Foundry (Arisha, optional and metered; no autonomous approvals)
    |--> external systems via controlled connectors (SQL Account, bank exports, OEM monitoring)
Cross-cutting: Key Vault, managed identities, App Insights/Monitor, budgets, backup and restore, Defender/access controls.
Deployment: GitHub Actions with Azure federated identity/OIDC; separate staging and production.
```

## Service decisions and qualifications

| Function | Target service | Notes |
|---|---|---|
| Staff login | Microsoft Entra ID + MFA | Single tenant for Phase 1; app validates **API token**, issuer, audience, tenant, expiry and user grants |
| Web frontend | Azure Static Web Apps | Confirm tier; custom built-in provider registration requires Standard; alternative MSAL SPA+API auth |
| Backend API | Azure Container Apps | NestJS retained; compute scale and minimum replicas based on real uptime needs |
| Database | Azure Database for PostgreSQL Flexible Server | Preserve RLS and append-only audit; not a replacement with Dataverse |
| Operational files | Private Azure Blob Storage | Encryption, retention, restricted access, expiring references |
| Office documents | SharePoint | Group SOPs, IT manuals and controlled collaborative evidence; business permissions still enforced in Prima |
| Communications | Teams, Outlook, Microsoft Graph | Notification delivery is not approval; no second source of truth |
| Automated workflow | Existing application workflow engine + Functions/Logic Apps/standard Power Automate where licensed | Avoid premium connector licensing surprise |
| Arisha | Azure AI Foundry pay-per-token inference | Off by default until DPA, data minimization, access control and benchmark signoff |
| Secrets | Key Vault + managed identity | No plaintext secrets/keys in frontend, GitHub files or chats |
| Logs | Azure Monitor + App Insights | Budget and retention control, avoid leaking personal/security data |
| Code + deployment | GitHub + GitHub Actions OIDC to Azure | Protected main, small reviewed PRs, environment approval and rollback |

### Security model
1. App permissions from approved legal entity mandates and departmental roles; Entra identity is authentication, not authorization to every company.
2. PostgreSQL row-level security enforces company walls; explicitly review group-wide tables, global IT/admin views, sensitive arms/credit/HR tables and service-to-service access.
3. Use delegated Graph permissions when practical, site-scoped SharePoint permissions where possible, admin consent logging and revocable secrets.
4. Approval and payment are separate: CEO authorizes relevant IT procurement; Finance Director arranges payment, **cannot approve own item by default**.
5. Safety-sensitive/regulated flows remain manual until separately signed-off; no AI direct arms commands, financial payments, access grants, dismissals or irrevocable actions.
6. Azure region/data processing, Malaysian PDPA and sector rules reviewed for each data class; Singapore hosting was previously allowed for Phase 1, but the final policy is documented by legal/security owners.

### Cost governance
CEO target is approximately RM300/month for a tiny IT pilot **only as a target**. Microsoft-only managed services, especially PostgreSQL, may exceed it even at low user counts; require current Azure Pricing Calculator estimate in Southeast Asia region with actual SKU, backups, storage, network egress, logs, staging and tax. Do not silently downgrade resilience to force the target. Existing Microsoft 365 licensing does not automatically include Azure compute, Graph special use, premium Power Automate, Power Apps or Azure AI usage. Compare a lean pilot tier and a resilient production tier, including monthly and total-cost estimates.

### Production gate (per department)
- Current live connected system established; no mock data or demo sign-in.
- Entra SSO, MFA, scoped app authorization and company RLS negative tests pass.
- Unit, API, integration and end-to-end tests pass; role-specific UAT evidence retained.
- Records/data migration reconciled; retention/PDPA notices and approvals completed.
- Staging isolated, monitoring and alerting operational, backups restored successfully.
- Security review and department owner + ACT signoff; CEO approves go-live.
- Rollback and incident procedure rehearsed.

### Official references
- https://learn.microsoft.com/en-us/azure/static-web-apps/authentication-authorization
- https://learn.microsoft.com/en-us/azure/static-web-apps/authentication-custom
- https://learn.microsoft.com/en-us/azure/container-apps/overview
- https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/overview
- https://learn.microsoft.com/en-us/graph/permissions-overview
- https://learn.microsoft.com/en-us/azure/foundry/concepts/deployments-overview
