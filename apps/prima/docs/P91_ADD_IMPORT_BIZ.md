# P91: Add and Import at the top of the business screens

Fitri, 9 Nov 2026: "we only see tables but don't see where to add them. The add side must be flexible as we are moving
from the old system to the new one ... in Add we can add manually, upload files (Excel/CSV/PDF) and more".

This covers the screens of My work and dashboards, Clients and sales, Finance and buying, Compliance, Governance and IT
(menu view names from `App.tsx`). For each screen or tab that keeps a list: the records, where **Add** is, the **Import**
kind, or why there is none. An import row is always saved through the same server call as the manual Add, with that
call's own permission check, so nobody can import what they could not add by hand, and no approval is skipped. The
buttons show only to people the server already lets add; the server checks every row again.

**P91** marks what changed here. "Top" means the page header (`PageHead` actions, top right, wraps on a phone) or the
header row of the open tab.

## New import kinds (P91)

All in `packages/core/src/org-import-biz.ts`, hooked into `org-import.ts` (`EXTRA_IMPORTS`, `IMPORTABLE_KINDS`, `saveRow`).
Malay and English column names, short forms and typos are matched by the P90 matcher; each spec adds its own synonyms.
The import screen now hands each spec's own column words to the in-browser matcher (`ImportDrawer.tsx`, `specWords`);
before, only the shared word tables reached it, so P90's own `words` (foreign workers, suppliers) were used by the tests
but not on screen. A field the matcher still leaves empty is chosen by the person in the "Check columns" step.

| Kind | Screen | Create path (same as the Add) | Who may add | Notes |
|---|---|---|---|---|
| `tender` | Tenders and quotes | `addTender` | Company admin team (`commercial.prepare`) or the Director Office Administrator | Open tenders only: the Add refuses a closing date in the past, so closed history is refused on its row (its result would need its own record). Starts open; protocol, papers, checks and the manager's signature follow. Malay "Kerajaan / Swasta" read. |
| `finBankAccount` | Finance | `finance.addBankAccount` | Finance team leader, Finance Director, CEO | No verification step exists on this Add, so nothing is skipped. The full account number in a file is cut to its last 4 digits before the call; the full number is never stored, echoed in the preview or written to the audit. |
| `corpFiling` | Company secretary, Filings | `addCorpFiling` | Head office Corporate Admin (Deputy Chief of Staff) | Opens as "open"; papers, MBRS lodgement and SSM receipt are recorded afterwards as usual. An empty title or rule takes the wording the Add form pre-fills. |
| `corpAudit` | Company secretary, Audit | `addCorpAudit` | Company manager or admin executive | One per company and year (the Add's own rule); the PBC list is a comma or semicolon list. |
| `legalMatter` | Company secretary, Legal matters | `addLegalMatter` | PWVSB legal or the company manager | Opens as "open"; updates and fees on the screen. "Plaintif / Defendan" read as whose claim. |
| `bcmSystem` | Continuity | `addBcmSystem` | IT (or the owner) | One copy per row; more copies, backups and restore tests are recorded on the screen. Shows as unknown until then. |
| `grcObligation` | Speak up and assurance, Obligations | `addGrcObligation` | The company, internal audit or the owner | No proof yet: shows unknown until the company proves it and audit checks it. |
| `pdpaRegisterItem` | PDPA, Register | `savePdpaRegisterItem` (new entry) | PDPA officer, CEO, Chief of Staff | Not reviewed. An empty impact assessment is saved as "needed" (not "not needed"), so the entry shows as needing work until the officer decides. Optional Company column (empty = whole group). |
| `pdpaProduct` | PDPA, Products | `saveProduct` (new product) | PDPA officer (or the owner) | No certificates (each needs its copy attached on the screen). A product already on the list is refused on its row. |
| `regRisk` | Governance registers, Risks | `registers.act('addRisk')` | ACT Director | First scores recorded as today's review; a high risk needs an action and due date, as on the form. |

Tests: `packages/core/test/org-import-p91.test.ts` (each kind from a Malay/messy sheet, a refused person per kind,
closed tender refused, high risk without action refused, duplicate product refused, bank number never echoed) and
`apps/api/test/import-p91-pg.test.ts` (PostgreSQL with the walls on: refused preview cannot be committed and writes
nothing, the keeper imports, the same file is refused a second time, the route accepts the new kinds and still refuses
an unknown one).

## Screens

### My work and dashboards

| Screen (view) | Records | Add (where) | Import | Why not / notes |
|---|---|---|---|---|
| My duty / My details (`mine`) | Own duty and details | none | none | Personal page; nothing to add in bulk. |
| Work (`work`) | Tasks given to staff | "Give a task", top (leaders) | none | Workflow: each task has an owner, due date and proof. |
| Meetings (`meetings`) | Meetings, minutes, actions | "New meeting", top | none | Workflow (invitations, minutes, actions). |
| Memos (`memos`) | Memos | "New memo", top | none | Workflow (publish, read receipts). |
| Company today (`company`) | Company licences | **P91** "Add licence" + Import (`licence`) in the page header; still also on the licences card | `licence` | The rest is a dashboard. |
| Company offices (`office`) | none (management view) | none | none | Dashboard of each company's office work. |
| Director Office (`doa`) | none | links to Tenders etc. | none | Dashboard. |
| Reports to the Director Office (`reports`) | Report list and sent reports | "Change the report list", top | none | Workflow: each period's report is sent from its row. |
| Group today (`overview`) | Companies | "Company record" per company | none (by design) | Company master data stays on the CEO's reviewed path (P81). |

### Clients and sales

| Screen / tab | Records | Add | Import | Notes |
|---|---|---|---|---|
| Tenders and quotes (`commercial`), tender pipeline | Tenders | "Add tender", top | **P91** `tender` ("Import tenders", top) | Open tenders only (see above). |
| Tenders and quotes, quotations | Quotations | "New quotation", top | none | Workflow: the Company Manager approves each quotation. |
| Tenders and quotes, leads / joint tenders / opportunities panels | Sales leads, joint tenders, opportunities | each panel's own add in its header | none | Pipelines with their own steps; few rows. |
| Clients (`clients`) | Clients | "New client", top | `client` (top) | P81. |
| Contracts (`contracts`) | Client contracts | "New contract", top | `contract` (top) | P81. |

### Finance and buying

| Screen / tab | Records | Add | Import | Notes |
|---|---|---|---|---|
| Finance (`finance`), bank accounts | Company bank accounts | "Add bank account", top (and on each company's bank card) | **P91** `finBankAccount` ("Import bank accounts", top) | Last 4 digits only. |
| Finance, payments | Payments | "New payment", top | none | Workflow with approvals. |
| Finance, papers | Auditor and tax agent papers | "Add paper", top | none | Each paper is evidence for its year; added one by one with its date. |
| Payment requests (`payreq`) | Payment requests | "New payment request", top | none | Workflow: head, Finance check, COO approval; importing would skip them. |
| Claims and requests (`requests`) | Operation claims, office requests | "New operation claim" / "New office request", top | none | Workflow with receipts and approvals. |
| Procurement (`purchasing`), purchases | Purchases | "New purchase", top | none | Workflow: 3 quotes, COO and CEO approve. |
| Procurement, suppliers | Suppliers | "Add supplier", top of the tab | `purSupplier` (top of the tab) | P90; Finance still verifies each bank account. |
| Procurement, store | Store stock items (uniform store included) | **P91** "Add store item" + Import moved to the top of the tab (were on the Stock card under the loss and leaver lists) | `stockItem` | Issues, returns, counts and losses stay workflow. |
| PWVSB credit (`credit`) | Credit loans | "Add financing", top | none | Not imported: the Add builds the instalment schedule from the start date, so an old loan would show every past instalment as unpaid and start arrears and enforcement cases for money already paid. Old loans need their payment history, which is a CEO decision (the lead's archive proposal). |
| Branches (`branches`) | Branches | "Add branch", top | `branch` (top) | P90. |
| Insurance (`insurance`) | Policies, claims, guarantees | "Add policy" / "Record claim" / "Add guarantee", top | **P91** Import in the page header for the open tab's kind (`insurancePolicy`, `insuranceClaim` on Claims, `insuranceGuarantee` on Guarantees); also on each tab's card | Premium payments, renewals and cancellations are steps on a policy. |

### Compliance

| Screen / tab | Records | Add | Import | Notes |
|---|---|---|---|---|
| Company licences (`compliance`) | Licences | "Add licence", top | `licence` (top) | |
| Renewals (`renewals`) | Licences due | "Add licence", top | `licence` (top) | |
| RBA readiness (`rba`) | Committee, traces, ethics declarations | in each tab | none | Checklists and personal declarations; not records to load. |
| Yearly self-audit (`selfaudit`) | Self-audits | "Do a self-audit", top | none | Workflow: each audit is done and its fixes recorded. |
| ACT (`act`) | Findings, audits, investigations, improvements | **P91** "Raise a finding" / "Record an audit" now also at the top for ACT staff (they saw only their role chip) | none | Workflow: owner, fix, ACT check. |
| Audit trail (`audit`) | Audit log | none | none | Read only, sealed. |
| Quality and compliance (`quality`) | Requirements, evidence, profiles | "Add a requirement" in its tab | none | The requirement list follows ISO 9001 / PIKM and is CEO-approved; evidence is checked by a person. |
| Speak up and assurance (`grc`), obligations | Obligations | "Add obligation", top | **P91** `grcObligation` ("Import obligations", top) | |
| Speak up and assurance, speak up / gifts / site safety | Reports, gift declarations, risk assessments | "Report wrongdoing" form, "Declare a gift", top of their tabs | none | Personal reports and declarations, decided by the CoS; never bulk-loaded. |

### Governance

| Screen / tab | Records | Add | Import | Notes |
|---|---|---|---|---|
| Mandates and authority (`governance`) | Management agreements, board mandates | "Add mandate", top | none | Not imported: each mandate's powers per area (act or monitor, with limits) are the legal heart of PWVSB's authority and must be read from the signed document; each then needs the company board's confirmation and legal's verification. Few rows per company. |
| Governance registers (`registers`), risks | Risks | "Add a risk", top of the tab (**P91** primary) | **P91** `regRisk` (top of the tab) | ACT Director only. |
| Governance registers, related-party deals | Deals | "Record a deal", top of the tab (**P91** primary) | none | Workflow: CoS review, board decision. |
| Governance registers, directors' interests | Declarations | "Record a declaration", top of the tab (**P91** primary) | none | Personal declarations, seen by the CoS. |
| Governance registers, committees | Board committees | "Add a committee", top of the tab (**P91** primary) | none | Members with exactly one chair and the board resolution; few per company. |
| Company secretary (`corporate`), filings | SSM filings | "Add filing", top | **P91** `corpFiling` ("Import filings", top) | |
| Company secretary, corporate changes | Changes needing PWVSB approval | "Ask for a change", top | none | Workflow: DCoS approval, then the board. |
| Company secretary, audit | Statutory audits | "Register an audit", top of the tab | **P91** `corpAudit` (top of the tab) | |
| Company secretary, legal matters (also "Audit and legal" for PWVSB legal) | Legal matters | "Open a matter", top of the tab | **P91** `legalMatter` (top of the tab) | Legal holds have their own panel (placed and released with a reason). |
| Company secretary, company files / panel firms / delegations | Company files, panel firms, critical posts, delegations | each tab's own add at its top | none | Company files: one per company. Panel firms: a short list kept by Central Admin and legal. Delegations: approved by a leader after evidence. |
| PDPA (`pdpa`), register | Personal data register | **P91** "Add register entry" (primary) at the top of the tab | **P91** `pdpaRegisterItem` | |
| PDPA, products | Products sold or rented | **P91** "Add product" (primary) at the top of the tab | **P91** `pdpaProduct` | Certificates are added with their copy. |
| PDPA, consents | Signed consents | "Record consent" (**P91** primary) at the top of the tab | none | Each needs the signed form attached (evidence rule). |
| PDPA, breaches / client consent / social media / requests | Cases | "Open a case", top of the tab | none | Workflow with legal deadlines. |

### IT

| Screen / tab | Records | Add | Import | Notes |
|---|---|---|---|---|
| IT (`it`), assets | Existing devices | "Register existing device", top of the tab | `itAsset`: **P91** moved into the same row as the Add (was under the panel) | |
| IT, systems | Existing systems, SharePoint guidance | "Register existing system" / "Record SharePoint guidance", top of the tab | none | Manual records that never prove a connection; few rows. |
| IT, help requests / jobs / purchases | Tickets, jobs, purchases | "Ask IT for help" (top), "Give a job", "Purchases" form, top of their tabs | none | Workflow: requester confirms, money approvals. |
| HR / IT coordination (`hr-it-intake`) | Joining and leaving | "Prepare HR joining / leaving intake", top | none | Workflow: CoS and company head approve. |
| IT purchase fulfilment (`it-procurement`) | Approved purchases | raised on IT, Purchases | `itAsset` bar at the top (equipment bought before Prima) | P90. |
| Connections (`connections`) | Connection checks | none | none | No records; access checks only. |
| Websites (`websites`) | Domains and websites | "Add domain", top | `itDomain` (top) | P90. |
| Continuity (`continuity`) | Systems to protect | "Add system", top | **P91** `bcmSystem` (top) | Playbooks and drills are recorded per playbook. |
| Workflow time and quality (`it-metrics`) | Timers | none | none | Measurements, not records. |
| AI data preview (`it-extraction`) | AI extraction reviews | none | none | Its own reviewed, owner-only path. |
| JA app data (`ja`) | Guard records from the JA app | none | none | Read-only feed. |
| Switch from JA (`jaswitch`) | JA history | own staged file import | own path | A second person approves each staged file (P81/P90 kept as is). |

## Not done here, on purpose

- No live workflow is bulk-loaded (payment requests, requests, claims, ACT findings, self-audits, work, meetings, memos,
  HR/IT intake, IT tickets and purchases): an import would skip the approval or evidence each item needs.
- No "old records archive" module and no new tables: history of closed tenders, paid loans or finished work needs the
  CEO's decision (the lead is proposing it).
- No permission was widened: every Import sits next to an Add already shown only to its keepers, and the server checks
  each row through that Add's own call.
