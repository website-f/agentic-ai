# 5. Status and gaps (as of 3 November 2026)

This page is honest about what exists. Code and tests in the repository do not prove deployment, database migration,
tenant permissions, runtime health, security certification or completed staff testing.

## 5.1 Where each part is

| Where | What |
|---|---|
| **On `main`** | Wave 1 core and every original module screen (operations, HR monitor, arms, CMS, cases, tenders, contracts, clients, branches, FWM, hostels, SOCSO, claims, staff payroll, finance monitor, credit, procurement, governance, company secretary, ACT, GRC, PDPA, insurance, assets, fleet, continuity, meetings, reports, memos, work), the **IT pilot** (jobs, help requests, purchases, rental, tenders, websites, metrics, HR/IT intake, procurement fulfilment, cleanup and corrections), Microsoft sign-in, staff data security (hashed PINs, department walls, offboarding), IT checking rule, three screen languages, confidentiality |
| **Combined candidate only** (14 draft PRs, see the [README](README.md)) | Finance Phase 2, HR Phase 3, Central Admin 5A-5G, Special Ops 4A-4H, Government and Private Ops with Procurement, ACT, Company office, Connect departments (hand-overs, shared guide), Work rebalancing, M365 Connections, Branches, Foreign worker welfare, Growth panel, IT checking for other departments |
| **Deployed** | Nothing from the candidate. This documentation does not confirm what, if anything, from `main` is running on staging; `docs/STAGING_*.md` and the release owner's records are the source for that |

## 5.2 Built but switched off

| Feature | Why off | Who turns it on |
|---|---|---|
| Arms trading and import | Needs an approved dealer licence | CEO |
| Staff overtime | HR has not set rates or eligible staff | HR |
| SQL Account connector (read-only) | Not verified with the vendor | Finance with the CEO |
| Microsoft 365 Connections, Teams approvals | Tenant steps not done | CEO (tenant owner) |
| Arisha on Azure OpenAI | Azure OpenAI not provisioned | CEO |
| WhatsApp rent reminders | WhatsApp Business not connected; reminders are only planned | Asset Management with the CEO |
| PWVSB credit enforcement steps 7 to 9 | Counsel has not approved the template | Legal |
| Department rollouts (HR, Finance, Central Admin, Company office, Gov Ops, Private Ops, Special Ops) | Each starts when the CEO adds it to `PRIMA_ROLLOUTS` | CEO |
| AI data preview | Build flag off unless released | CEO |
| RFID scan compulsory at vaults | `ARMS-RFID scanRequired: false` | Arms Control with the CEO |

## 5.3 Not connected (shown as Unknown)

SQL Account, JA Group app (attendance, patrol, guard payroll, FWM, incidents, hostels), Asset Management system, door
system, alarms and CCTV, vehicle trackers and dashcams, PBX call logs, face engine for guards (simulated in the test
version), KPKT, LHDN, PERKESO, KWSP, SSM, KDN and Customs (filed by staff, never by Prima).

## 5.4 Partly built or waiting on a decision

From the guide cards marked "partly built":

- Company master record: has its own SSM verification flow; the full company add form is still a gap.
- Panel firms, adviser budgets, delegation register, legal holds and the other Central Admin tables: the database
  modules are proposed and **not installed** in any database yet.
- KPKT licence check for PWVSB loans: the licence record is not keyed in yet.
- Vacancy signer for PWVSB central posts: assumed to be the HR Director, awaiting the CEO's decision.
- Staff overtime inside monthly payroll: waits on Finance PR #49.
- Quotation cost checks (minimum wage, OT, EPF, SOCSO, EIS): not switched on; check by hand.
- Government and private site profit: money actually collected waits on Finance; JA pay tested on synthetic data only.
- OSH: an OSH coordinator outside HR does not yet see the accident card (the server still lets them report).

Other open items:

- The face engine vendor and the PDPA wording for biometric consent (counsel and DPO).
- Rules labelled **Proposed** or **Unverified** in the [rule register](reference/rule-register.md) need approval.
- Records without an add form yet: users and access (handled through Entra and IT), contract creation details, armed
  jobs detail.
- Offline work is deferred until after the online pilot.
- Release owner items for the combined candidate: the base transition package and the `ops/` and exact SPA pins.

## 5.5 Test evidence for the candidate

From `rehearsal/combined/EVIDENCE.md` on the candidate branch (synthetic data, throwaway local PostgreSQL): install,
build, typecheck and web demo build pass; core 1292/1292; API 904/904; CMS 60/60; schema rehearsal pass; every department
rollout walked through sign-in on PostgreSQL. Browser walk-throughs exist for some modules (in the project files) and are
reported separately from these automated results.
