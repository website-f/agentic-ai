> Historical planning reference. Later owner direction supersedes the sequential start order: everyone begins the programme on18November2026; each workflow still needs separate acceptance before live use. This source merge grants no deployment, tenant changes or spending.

# START HERE — Claude Code and ChatGPT

**Official CEO direction, 28 October 2026.**

1. **Architecture: Microsoft first.** Target Azure + Microsoft 365 (Entra ID, Azure Static Web Apps, Azure Container Apps, PostgreSQL Flexible Server, SharePoint/Blob, Teams/Outlook via Graph, Azure Monitor/Key Vault, optional Azure AI Foundry). GitHub stays source control. Keep the current React + NestJS + TypeScript + PostgreSQL stack, no rewrite to Power Apps/Dataverse.
2. **Development order (fixed):** **IT → Finance → HR → Special Enterprise Operations → Central Administration → Nationwide Operations.** Read `docs/roadmap/SIX_PHASE_DEPARTMENT_ROADMAP.md`.
3. **Accountability:** The user is CEO and business/technical sponsor, not an engineer. Explain every task in simple language; clearly state what's built, what's mock and what the CEO must decide. **ChatGPT plans and audits; Claude implements and tests; GitHub is the handover.** No assumption of direct autonomous AI-to-AI messaging. Read `docs/governance/CEO_AI_TEAM_PLAYBOOK.md`.
4. **SOP basis:** Use the controlled PWVSB A–Z guidebook with 214 SOPs across 19 domains and V1–V15/V12.1 consolidated source. The machine-readable original SOP manifest should be stored in `docs/controlled-sops/PWVSB_A_to_Z_SOP_Manifest.json`. Note if the full PDF/Word historical sources are not actually present in the repository; do not claim to have read missing files. Map requirements to code and tests with source IDs. Signed law/mandates outrank draft docs.
5. **Phase 1:** existing 11-user IT pilot, M365 SSO, service desk, asset and purchase lifecycle, controlled AI Arisha, Microsoft environment; real database + secure evidence; production readiness only after review. Pilot cap RM300/month is an **aspiration, not a promise or reason to disable backup/security**. Get current regional Azure quotations before purchases.
6. **Authority:** CEO approves relevant IT purchases, Finance Director pays. Do not let payment approver and executor become the same actor without documented exceptional process. Reject the old prototype fixed 10-jobs-per-week cap.
7. **Safety:** no real-data import, credentials, Azure provisioning, deployment, payment, GitHub merge or live regulated integrations without explicit approval and accountable IT/ACT validation.
8. **First Claude output:** current-code-vs-SOP gap report, precise IT Entra and Graph permissions plan, minimum Azure bill of materials and current price comparison, 10 negative UAT cases, and the proposed **first small implementation PR** with tests. No large speculative rewrite.

**Do not merge draft PR #8 unchanged**: its Cloudflare/DigitalOcean hosting premise was superseded by the CEO's decision to use Microsoft architecture. Read `docs/architecture/MICROSOFT_FIRST_PLATFORM.md`.

### Copy/paste from CEO to Claude
> Read `docs/START_HERE_CEO_MICROSOFT_ROADMAP.md` and the linked files on the GitHub branch `docs/microsoft-first-six-phase-roadmap`. Treat that branch as the latest CEO scope decision. Start Phase 1 IT only. Show me in plain English what you will build and the exact tests. Do not purchase, deploy, merge or use real data until I approve.

