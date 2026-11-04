# 1. Overview

## 1.1 The group Prima serves

Prima Secure App is the group platform of the **PWVSB Security Group**.

- **PWVSB** is the group's central finance and management company, under the Director Office. The central departments
  (HR, Finance, IT, Operations, Arms Control, CMS, Foreign Worker Management, Procurement, ACT, Legal, Transport, Asset
  Management, PDPA and the Chief of Staff's office) sit at PWVSB.
- Around **50 separately licensed security companies** operate nationwide. Each has its own board, shareholders, KDN
  licence, insurance, bank accounts, statutory accounts and its own office (a Company Manager or GM with 2 to 8
  executives). The system is set up for **38 companies** for now.
- Three central companies employ some of the central staff:
  - **Merdeka Network Sdn Bhd** employs the IT team, owns the group's electronic devices and rents them to the
    companies.
  - **Goodwill Empire Sdn Bhd** runs government-sector operations under the Operations General Manager (OGM), keeps the
    guard equipment store and owns and bills all guard equipment (rent or sale).
  - **Sasa Team Sdn Bhd** runs private-sector operations.

The most important legal rule behind the design: **legally separate companies stay separate.** Prima never merges
employment records, licences, insurance, contracts, bank accounts or statutory accounts across companies. PWVSB acts in
a company only under a signed management agreement or board mandate (see the Mandates screen), and every company matter
is either controlled by the licensed company or monitored by it.

## 1.2 What Prima does

Prima is one place where each person sees the work their job needs, does it with proof, and passes it to the next
person, while leadership and auditors can see that it was done properly. In business terms it covers:

| Area | What Prima does |
|---|---|
| Operations | Sites, posts, rosters, attendance, patrols, cases and escalation, clients, contracts and mobilisation, branches, regional oversight |
| People | Guard and staff profiles, leave, claims, staff payroll, joining and leaving, HR cases, training, OSH, foreign workers, SOCSO claims |
| Special operations | Arms control (vaults, firearms, ammunition, armed jobs, arms requests), the CMS 24/7 command centre, vehicles |
| Commercial | Sales leads, tenders, quotations, joint tenders, the Director Office tender protocol |
| Finance | A control layer around SQL Account: payments, month-end close, bank reconciliation, checks, packs, budgets, payment requests, daily cash |
| Central admin | Company files, company secretary filings, renewals, mandates, panel firms, legal holds, delegations, meetings, reports, memos |
| Support | IT help desk, IT assets and purchases, websites and domains, procurement and inventory, insurance, PDPA, continuity |
| Assurance | ACT findings and audits, speak up (whistleblowing), gifts, obligations, investigations, audit trail |
| Everyone | Home, My details, Clock, Work, Claims, payslips, Memos, Hand-overs, Arisha the assistant |

## 1.3 Systems Prima works with (and does not replace)

| System | What it owns | How Prima uses it | Status |
|---|---|---|---|
| **SQL Account** | The books of every company (the system of financial record) | Prima holds approvals, evidence and checks around it; staff post in SQL Account and record the reference in Prima | Connector built read-only and switched off |
| **JA Group app** | Guards and officers: patrol, attendance, guard and officer payroll, incidents, foreign worker records, hostels | Prima shows JA's data read-only through a feed; a late feed shows as Unknown | Feed not connected; rule `SYS-JA-OWNS` lists nothing as owned by JA yet, so Prima's own screens stay on |
| **Asset Management system** | The 450 rental units, resorts, orchards, training facility | Prima's Asset Management screen is a working model; real data will arrive by API and never overwrite Prima's own records | Not connected |
| **Microsoft 365** | Staff sign-in (Entra), Outlook, Teams, SharePoint, Planner | Sign-in by Microsoft account; selected approvals and requests linked from Teams/SharePoint; tasks mirrored to Planner | Sign-in built; Connections off by default; Teams approvals off |
| **LHDN, PERKESO, KWSP, SSM, KDN, Customs** | Government filings | Prima never files anything. It lists what is due, drafts figures and keeps the reference staff record after filing | By design |
| **Banks** | Moving money | Prima never pays. Finance releases payments in the bank portal and records it | By design |

## 1.4 How it is built (for reviewers)

- **`packages/core`**: all business rules, permissions, the rule register and the service that every screen and the
  API call. Rules live here once, so the screen, the server and Arisha agree.
- **`apps/api`**: a NestJS server on PostgreSQL. Row-level security keeps companies apart (a person's request carries the
  companies they may see), and **department walls** keep group-wide department tables apart, so a screen bug cannot show
  another department's records.
- **`apps/web`**: a React web app, installable on Android and iPhone as a PWA. It also builds a single-file **test
  version** that runs the core in the browser on synthetic data, with a "choose who to sign in as" list.
- **`apps/cms`**: the separate CMS command-centre app (planned to bring CCTV, alarms, gates and visitor systems into one
  dashboard).
- **Database changes** are shipped as numbered release modules, installed in a fixed order. Running a migration on a
  shared database is the CEO's decision only.
- **Audit trail**: every save writes a hash-chained audit line (who, when, what, old value and new value), so a change
  to history can be detected.

## 1.5 Things that apply on every screen

- **Three screen languages**: Bahasa Melayu and English mixed (default), full Bahasa Melayu, or full English. The choice
  is on the sign-in page and in the header.
- **Confidentiality**: before first use each person accepts the confidentiality rule (`SEC-CONFIDENTIAL`); nothing opens
  until they do. Each person sees only what their work needs, and file opens are logged.
- **Arisha**: a small assistant that can be dragged anywhere on screen. She explains the screen and the rule, and gives
  numbered steps naming the exact buttons. She never presses a button, approves or saves. Four leaders have a bounded
  pilot where Arisha may prepare drafts; a person still submits and an authorised reviewer still saves. In the live
  app she will run on Azure OpenAI through the Prima server once it is switched on; today it is not.
- **Guide cards**: read-only "how to do it" cards, Bahasa Melayu first, built from the real form fields.
- **Unknown is never shown as fine.** A figure with no source shows "Unknown", never zero or green.
- **Data notice**: each server says whether its records are test data or staging-pilot data (`PRIMA_DATA_MODE`); a
  missing or wrong setting reads as test data.
- **Phones**: on a phone the first four menu items are tabs at the bottom; the rest are under "More".
