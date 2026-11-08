> Historical planning reference. Later owner direction supersedes the sequential start order: everyone begins the programme on18November2026; each workflow still needs separate acceptance before live use. This source merge grants no deployment, tenant changes or spending.

# PWVSB Prima Secure App — Six-phase department roadmap
**CEO-approved order 2026-10-28:** 1 IT, 2 Finance, 3 HR, 4 Special Enterprise Operations, 5 Central Administration, 6 Nationwide Operations.
This sequence overrides previous speculative rollout order. It does **not** mean each department's code is absent; much of the prototype already includes screens and simulated workflows.

## Common enterprise principles
- Keep distinct legal-entity records, mandates, powers, approvals and company walls.
- Implement as one modular monolith with separate departmental boundaries, not six disconnected apps.
- Entra identity for existing staff; additional field-worker identity model scoped separately as Phase 6 needs it.
- Core workflow state, timestamps, transactions, company permissions and audit always live in Prima; SharePoint/Teams/Outlook are communications/evidence/integrations, not replacement ledgers.
- No automatic payment, payroll, disciplinary action, licence submission, regulated arms transaction or final contractual approval.
- The 214-SOP guidebook is controlled draft. Each SOP must map to state machine, screens, permissions, tests, exception paths, evidence and signoff; never call 214 SOPs “complete” because there are matching screens.

## Phase 1 — IT Department (pilot)
**Users:** CEO, COO, Finance Director, ACT head, central HR, IT Manager, IT Lead and four IT executives (11-user pilot from uploaded go-live plan).
**Scope:** Microsoft sign-in; IT service desk/tickets; devices and asset life cycle; purchasing and CEO/FD separation; joiner/mover/leaver; M365 account/licence inventory; domain/website registry and quarterly checks across 38–50 companies; IT tenders; vendor and maintenance records; internal IT reports.
**Microsoft:** Entra ID, Teams, Outlook, SharePoint, Graph, Azure Static Web Apps, Container Apps, PostgreSQL, Monitor; pay-as-you-go Arisha after approval.
**Gate:** End-to-end help request → IT triage → resolution → staff acknowledgement; approved purchase → pay authorization → asset receipt; controlled leaver → revocation and recovery; negative tenancy/permission tests; backup restore; CEO approval.
**Source code:** apps/web/src/views/It.tsx, apps/api/src/controllers.ts, packages/core/src/service.ts and db/migrations/001_init.sql.

## Phase 2 — Finance
**Users:** Finance Director, seven team leaders and 4 staff/team, authorized executives and company management.
**Scope:** Close process per company, posting completeness, bank reconciliation, receivables/payables ageing, billing assurance, forecasts and budgets, payroll interfaces, reimbursements, entity-by-entity books, payment control and audit pack.
**Microsoft:** Entra permissions + SharePoint evidence; Teams alerts; scheduled Azure jobs; dashboards and Power BI only if justified.
**External authoritative system:** SQL Account remains actual accounting ledger. Build read-only integration and reconciliation first; do not replace with Dataverse or issue unsupervised postings.
**Gate:** Reconcile one complete period for a company with evidence, exceptions, segregation of duties and Finance Director approval. Disallow one user from authorizing and paying a transaction.

## Phase 3 — Human Resources
**Users:** HR administrator, Chief of Staff, approved operational/managerial roles, company employers.
**Scope:** Staff master, onboarding/offboarding, employment documentation, attendance and legally genuine rest, 45-hour working week where applicable, custom daily coverage vs actual work, roster/payroll bridges, annual/sick/hospital leave, training, SOCSO and foreign worker/hostel operations. Foreign-worker elective medical reimbursement **RM200 per eligible worker per year**, separate from statutory duties.
**Microsoft:** Entra staff records/groups, SharePoint controlled private files, Teams notification and authorized task approval; no broad HR disclosure.
**Gate:** Payroll preparation, leave and personnel approvals reconciled to lawful policy, with exceptions and data privacy verified.

## Phase 4 — Special Enterprise Operations
**Subdomains:** CMS/monitoring, Arms Control, CIT/CDM specialist activities, asset management/property/hostels, company fleet and specialized credit services. Define business-owner signoff per subdomain.
**Microsoft:** Azure protected telemetry/event processing, case management, logs, role-restricted information and alert integration; OEM systems remain authoritative for devices.
**Gate:** Security/risk and regulatory authorization, two-person sensitive approval where required, controlled data retention, emergency/manual fallback and tested incident response. Do not connect live firearms/vault actions without independent authorization.

## Phase 5 — Central Administration
**Users:** Director Office; Chief of Staff, Vice Chief of Staff, HR Administrator; Director Office Administrator; 38 Heads of Company (~50 independently licensed entities).
**Scope:** Group mandates, company licences/renewals, company document quality, minutes for **every Director Office-hosted meeting**, CEO report receipt/completeness/actions, **government tender monitoring** and CEO escalations; private-sector tender ownership remains COO/Private Sector team. Record statutory and internal deadlines separately.
**Microsoft:** Outlook intake, SharePoint controlled corporate documents, Teams reminders, selected Planner/Power Automate workflows with licensing review.
**Gate:** Each of 38 Heads of Company can submit/reconcile company registers; expiring licence, late report and government tender exception visible to correct owner, with audit.

## Phase 6 — Nationwide Operations
**Users:** COO, Government and Private Operations, state offices, supervisors, mobile guards, client/site roles where authorized.
**Scope:** Clients, sites, coverage hours (3/5/12/15 hours/day or contract-specific), lawful shifts/rest, attendance, incident escalation, NFC guard tours, regional operations, patrol officers, staff placement, real-time evidence and mobile field use.
**Microsoft:** Azure scalable API/database/monitoring, field identity model chosen for low cost and access security; offline support and mobile/PWA only when verified; OEM systems integrated with event APIs.
**Gate:** Selected live sites tested for correct legal work/rest, invoice hours, guard identity, missed patrol alerts, offline recovery, site/company walls and incident escalation. Scale incrementally after success.

## Release governance
Each phase requires: documented scope / SOP traceability / real security controls / real integration proof / QA and negative UAT / cost review / ACT and department-owner signoff / CEO explicit go-live approval. No arbitrary deadlines or fixed job limits imposed by a mock prototype.
