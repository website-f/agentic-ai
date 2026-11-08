# All-feature source integration, 7 November 2026

## Scope and release boundary

This is an isolated source-integration candidate, not production readiness or a deployment instruction. It starts from main `b1325ea3bb36885ed6275fb7892709a19713c9b4`. Fauzan authorized the safe route: reconcile intended features, preserve Fitri’s branches, test the exact combined result, and merge only if safe. Never infer permission to deploy, apply live SQL, change tenant/security settings, activate a provider, or waive UAT.

The shared programme date is 18 November. Older sequential rollout plans remain historical, not a replacement for that direction. Fitri’s operational checks and role-by-role UAT remain gates after source integration. An open/draft PR is not evidence that its entire historical tree should replace main.

## Integration method

Review exact PR deltas against their original base, reconcile at declaration/method level with current main, and preserve later fixes. PRs95,96,108,120 are already included by ancestry. PRs74,78,112 contain later deltas requiring reconciliation even where older content was included. PR63 targets an older combined branch and must not be merged wholesale. Binary evidence and synthetic fixture blobs are retained by original Git object hash, not recreated.

## Non-negotiable boundaries

- Preserve PR129 payroll effective-setting authority, stale-input binding, paid-history immutability, authorization, audit and transaction controls.
- Keep existing five activated database modules. Other source definitions remain proposed; source presence is not activation.
- Preserve main’s 24-hour stale-JWKS ceiling and fail-closed behavior. The user’s 72-hour offline-access instruction is not approval for a 72-hour authentication-key cache.
- Keep external-provider, sending, OCR/AI, website publication and paid processing gates. OCR is user-triggered with pinned same-origin worker/model assets, not automatic upload to an AI provider.
- Keep company, employer, staff and sensitive-data walls. Adding a role’s feature does not grant broader data access.
- Medical leave must use jurisdiction/date-effective statutory buckets: ordinary sick14/18/22 plus hospitalization60 under current law, without rewriting historical records or inventing transition-year resets.
- Statutory-table maintenance must not silently supersede the existing approved month-effective payroll settings. Incomplete policy and live-provider acceptance remain gated.

## Verification status

This document records scope, not a passing result. Merge requires the final exact candidate’s build, core/API/CMS/script tests, synthetic PostgreSQL tests and synthetic browser regressions. Partial component checks do not satisfy that gate. Remote checks and final commit/tree identifiers must be recorded before declaring completion.

## Exact PR-head scope snapshot

| PR | Title | Exact reviewed head | Disposition |
|---|---|---|---|
| #9 | CEO roadmap: Microsoft architecture and six-phase Prima rollout (214 SOPs) | `fa7e86b755172c2b10c8340645ad1bcfdc36210b` | Reconcile intended delta; not a wholesale tree replacement |
| #27 | docs: clarify pending Arisha activation and verified GitHub evidence | `14ed66840a88d6510ab9628c03f3c4599ce34352` | Reconcile intended delta; not a wholesale tree replacement |
| #37 | Add simple Connections cards and approved SharePoint libraries | `722f39819742e1785e43e2f42bc07652ea1d9549` | Reconcile intended delta; not a wholesale tree replacement |
| #39 | Attach Outlook emails to jobs (read-only) and Power BI report view; staff Send held off, not registered | `b3e251109cb02a4f83752a52149e3273d158023e` | Reconcile intended delta; not a wholesale tree replacement |
| #41 | IT checking: IT Manager accept and IT Lead technical check need a comment | `f62a7b35ac42f3d0580003a11a18fcf7fe84c61b` | Reconcile intended delta; not a wholesale tree replacement |
| #42 | Arisha batch import: review ledger and exact-batch approval through T9 | `9f628d15486b569cfd7f98d59b6f992b3f62d3f6` | Reconcile intended delta; not a wholesale tree replacement |
| #43 | Websites Phase 2: schedule, connectors, social media, email upkeep and IT tickets | `a5acc7ae9575ed425a1ea7e8f3ba2b50044d10b5` | Reconcile intended delta; not a wholesale tree replacement |
| #44 | Arisha import review frontend — gated workflow and contract validation | `f69f4781edff99dd7cdaa566dbb71382eea33cd4` | Reconcile intended delta; not a wholesale tree replacement |
| #45 | Audit chain: owner reads the whole log so audit_head finds the true head | `c6c96363c9a9f9bad8aee4607ca2c10fdbb2308a` | Reconcile intended delta; not a wholesale tree replacement |
| #46 | Offline work: server side for IT requests and job notes (switched off) | `c33ccf47b97e2fa416e632f87438a7707b9858eb` | Reconcile intended delta; not a wholesale tree replacement |
| #47 | Use approved Canva Arisha avatar | `c9d4d97851e2c698921954cdea377477697449e5` | Reconcile intended delta; not a wholesale tree replacement |
| #48 | Offline outbox groundwork — non-runtime state and PR46 contract prototype | `7fdc9ed62f5d55ae3fac02d52033e6629b2b8264` | Reconcile intended delta; not a wholesale tree replacement |
| #49 | Finance Phase 2: payments, close, packs, payee checks, bank reconciliation, ageing, SST, e-Invoice, bad debt, budget, settings | `afbdcd4f25a2716d5ff020b02431fa7b46743c34` | Reconcile intended delta; not a wholesale tree replacement |
| #52 | Central Admin 5A to 5G: filings, walls, company record and file, renewals, panel firms, Director Office, CoS office, credit checks | `af699865b3ae87e1a155293f3f56563565e52316` | Reconcile intended delta; not a wholesale tree replacement |
| #53 | Special Ops 4A-4H + WhatsApp rent reminders (off) + CMS Command Centre app | `4f1ed5fd37c784f8b4fba9fe42f69211a902fc6d` | Reconcile intended delta; not a wholesale tree replacement |
| #54 | Gov Ops (Goodwill) + Private Ops (Sasa Team), Procurement go-live readiness | `a93249e01c664a954fddbcb8d40ebe1d28c05916` | Reconcile intended delta; not a wholesale tree replacement |
| #55 | ACT department: teams, monthly reports, workflow timing, field checks, fraud anomalies and investigations | `ebf6e4d00850e9b7065c7ae4ad3968e00e84634d` | Reconcile intended delta; not a wholesale tree replacement |
| #56 | Connect departments: key once, hand-overs, shared rollout switch, import and go-live checks | `c76c1afb22d7c92220279db3d762aa018ad47806` | Reconcile intended delta; not a wholesale tree replacement |
| #57 | Company office for each licensed company (1 Company Manager or GM, 2-8 executives) | `39c2c70ddeb98cfafb9b134e4c7e3919831f773e` | Reconcile intended delta; not a wholesale tree replacement |
| #58 | Managers delegate or readjust staff work, with Arisha's advice from the data | `242aefa4ca273d0803f8c3e39464f8275cbed63d` | Reconcile intended delta; not a wholesale tree replacement |
| #60 | Microsoft 365 Connections: per-person Outlook, Teams and SharePoint status (draft) | `1bbe4a9d8a865d595ebb2e8e061e5729dbef6e06` | Reconcile intended delta; not a wholesale tree replacement |
| #61 | Branches lifecycle, month ledger, business case and treasury; insurance claim steps; client report links | `b864ec89a1f5b7e963485e0ef7eecc68cc6b0099` | Reconcile intended delta; not a wholesale tree replacement |
| #62 | Foreign workers: responsible recruitment and welfare checks (§240), draft | `de70175f20e2ad93c3aa6942b3bb8252d0d8939c` | Reconcile intended delta; not a wholesale tree replacement |
| #63 | Growth panel for group leadership (whole-org review G3) | `f25bee57b48c5cf0fe1603a51e568556ce144999` | Reconcile intended delta; not a wholesale tree replacement |
| #64 | FWM recruitment cost: host pays FWM, FWM pays owner back (draft) | `08aa95a4bbeea170528c458f0ef944a83784e844` | Reconcile intended delta; not a wholesale tree replacement |
| #65 | Police call or visit help: company asks, Arms Control sends a helper (draft) | `5c1bfe66682588788a3c36d9b91b6e3c1e707601` | Reconcile intended delta; not a wholesale tree replacement |
| #67 | HR: staff time slip (go out a few hours, work it back or take annual leave) | `8bb8bc4fae1098b34c3c5992f57c4746b99c2c4a` | Reconcile intended delta; not a wholesale tree replacement |
| #68 | Staff directory: format, bulk load screen and approval (no personal data in repo) | `1bed520564d5b8a187ca62f3ef2132cb9e958f96` | Reconcile intended delta; not a wholesale tree replacement |
| #69 | Cleaning planner, site stock and fittings, guard duty plans (draft) | `80d20518050692901c3081c94479a922bf0e9992` | Reconcile intended delta; not a wholesale tree replacement |
| #70 | HR: group employment history across companies (rejoiners, returners, rehire marks) — draft | `4a3e05012a4f575d8478bbf17e9e67f6d602d0ae` | Reconcile intended delta; not a wholesale tree replacement |
| #71 | Director Office counters: tenders, quotations, opportunities, tender sites, reports and meetings | `4948e5fbfcf92bd6eb375b2637f1a74f028a1761` | Reconcile intended delta; not a wholesale tree replacement |
| #73 | Staff usability rules: phone-size buttons, guard menu, BM default, no AI names, Teams/email alerts (off) | `8233cc1209ce47493d1aeb6959ffd8bb8c5d5aef` | Reconcile intended delta; not a wholesale tree replacement |
| #74 | Client CRM: one client lifecycle from lead to lost client (draft) | `d758ea39fd55e1af17f596674864f856a5061d9c` | Reconcile intended delta; not a wholesale tree replacement |
| #75 | Cloud file storage for app photos and proof (Azure Blob, off by default) | `83a1fcc8f186295b2c5dd2161985f8d9dfa9865a` | Reconcile intended delta; not a wholesale tree replacement |
| #76 | Face clock in: Prima's own face engine on the server (switch, off by default) | `3137613a65179e9a22b7912bbaebf1d4a4ad8f58` | Reconcile intended delta; not a wholesale tree replacement |
| #78 | HR: job posts and applicant list for vacancies (publishing off) | `96250403df8305eb094590cc3b74f8fb959d67c3` | Reconcile intended delta; not a wholesale tree replacement |
| #79 | Management fees between any group companies + PGL vehicles, rentals and transport usage (draft) | `2968380f8e46cf32cb9b131166d5a153a25b2bcf` | Reconcile intended delta; not a wholesale tree replacement |
| #80 | CMS site readiness: client-chosen devices, site checklist, Arms Control check | `ac2b8067ed52c5201dff2b8a0c91134c5a87def4` | Reconcile intended delta; not a wholesale tree replacement |
| #81 | FWM permit board ready for real use in Prima and the JA app | `5161db896e13ed15ccd10005ae933c912d427b54` | Reconcile intended delta; not a wholesale tree replacement |
| #82 | Asset Management: BQ, quotes, award and variation orders (draft) | `c6cc79b7325df7602b270cea6f77626764346d16` | Reconcile intended delta; not a wholesale tree replacement |
| #83 | CMS monitoring assistant + in-house model; Prima gets the company record only | `90943464248071b29a0bb9c5da77ed7eff7cea5f` | Reconcile intended delta; not a wholesale tree replacement |
| #84 | SharePoint files as proof, by link (no copies) | `ee1b3e0a5aa2aa93b6b4322ea0310dbe93bd7844` | Reconcile intended delta; not a wholesale tree replacement |
| #85 | Branches: Model B (salaried Branch Manager) in the branch ledger | `2a166bfc4bb178ffb9010b0d3a180b48e5043a05` | Reconcile intended delta; not a wholesale tree replacement |
| #86 | Light governance registers: related-party deals, directors' interests, committees, risks | `c7b76250d81677b3a02536e1d81bf729fe78504c` | Reconcile intended delta; not a wholesale tree replacement |
| #87 | Offline site survey form: fill it with no signal, send it later | `8035e97deb4131a28a53d637e9444ef8881b8e64` | Reconcile intended delta; not a wholesale tree replacement |
| #88 | PDPA and insurance registers for real use | `b291b6db7a0a0e52a2db1bff17db182bc0e47e76` | Reconcile intended delta; not a wholesale tree replacement |
| #89 | SOCSO: LINDUNG claims, payments to dependants abroad, DOSH accident notice | `1600389aae166e5911ba7a4fe4f8c3cb9ef08f60` | Reconcile intended delta; not a wholesale tree replacement |
| #90 | Every approval needs a reason or comment (app-wide sweep, draft) | `62cf249ec2b3dd4143dc919ff19f1b6b33ca2a02` | Reconcile intended delta; not a wholesale tree replacement |
| #91 | Contracts and site mobilisation ready for real use, linked to Clients (draft) | `ef942b16307b74584680a06df40567aa0b5776da` | Reconcile intended delta; not a wholesale tree replacement |
| #92 | CMS duty roster and shift handover in real use | `9daf8d9ea5e4090830f9bae43cc3b653726c638e` | Reconcile intended delta; not a wholesale tree replacement |
| #93 | Meetings and memos for real use: COO section meetings, regular meetings for every staff, team memos | `bbfd49b70c68007f612e51bd7c60ce129f2712e9` | Reconcile intended delta; not a wholesale tree replacement |
| #94 | Work KPIs: Finance payments and closes on the shared KPI screen (stacked on #49 + #77) | `ada85fae594cba8589bb364a8ade7b6aa9b1ad9b` | Reconcile intended delta; not a wholesale tree replacement |
| #95 | Work KPIs: HR filings, filling posts and IT login move (stacked on #51 + #77) | `97213d3980e0d3ff21338922240b6f7e00f4d365` | Already included by ancestry; preserve main |
| #96 | Work KPIs: HR job adverts (stacked on #78 + HR KPIs + #77) | `07aa95611078c073919ef483e2ee6bb637c2694a` | Already included by ancestry; preserve main |
| #97 | Work KPIs: time slips considered, nothing to time (stacked on #67 + #77) | `ce73ff0965d688de86fca3c8c2cd815883841f80` | Reconcile intended delta; not a wholesale tree replacement |
| #98 | Work KPIs: Central Admin SSM lodging, company file check, renewals (stacked on #52 + #77) | `498122e6445240e58aec9b51b6334d80f27e35b8` | Reconcile intended delta; not a wholesale tree replacement |
| #99 | Work KPIs: Director Office tenders, quotations, opportunities (stacked on #71 + #77) | `2b55c18b9cf37d12b112af733d1fe49963437d4b` | Reconcile intended delta; not a wholesale tree replacement |
| #100 | Work KPIs: Special Ops arms requests and CMS alarms (stacked on #53 + #77) | `8017ecdb13384ea1ebd490e3c2395eed4f0ee900` | Reconcile intended delta; not a wholesale tree replacement |
| #101 | Work KPIs: CMS site readiness check (stacked on #80 + #77) | `9d9a09921e925ad4381f55f1f25e7a6bfdc3d059` | Reconcile intended delta; not a wholesale tree replacement |
| #102 | Work KPIs: Gov/Private Ops complaints, equipment handovers, invoices (stacked on #54 + #77) | `ce678db4ef7c6baffb1491a2470e8d4ca2600a17` | Reconcile intended delta; not a wholesale tree replacement |
| #103 | Work KPIs: cleaning jobs, supervisor checks, monthly client acknowledgement (stacked on #69 + #77) | `96ff64362c08f1e235c2ef5f614d570194a0ca47` | Reconcile intended delta; not a wholesale tree replacement |
| #104 | Work KPIs: police call or visit help (stacked on #65 + #77) | `7df3b154440cd036f3090d448d7865b7ae337e0c` | Reconcile intended delta; not a wholesale tree replacement |
| #105 | Work KPIs: ACT audits, finding fixes and checks (stacked on #55 + #77) | `a5da726b87497daa66dc34b003b4ddfb8a8b7ba2` | Reconcile intended delta; not a wholesale tree replacement |
| #106 | Work KPIs: company office as a department, head sees own company (stacked on #57 + #77) | `99ff336a3e8228bd2706ad6895d0febd1522f014` | Reconcile intended delta; not a wholesale tree replacement |
| #107 | Work KPIs: branch queries, business case reviews, insurance claims (stacked on #61 + #77) | `673038992a2bc17e8ee5267dc03e6f0c848402d6` | Reconcile intended delta; not a wholesale tree replacement |
| #108 | Work KPIs: Client CRM leads, requests, renewals, complaints (stacked on #74 + #77) | `581c72ccfff355dd4bc32029666f33b248dff2e8` | Already included by ancestry; preserve main |
| #109 | Work KPIs: FWM paper acknowledgements and renewals (stacked on #81 + #77) | `473ba9f886a551e5f0c2930a3b6a52b467c61130` | Reconcile intended delta; not a wholesale tree replacement |
| #110 | Work KPIs: Asset Management work orders, BQ and award (stacked on #82 + #77) | `d820773d9cbae60a03ca37f38f7fae6a1c8ecaa9` | Reconcile intended delta; not a wholesale tree replacement |
| #111 | Quality and compliance: ISO 9001 + PIKM requirements register, QMS foundation and role competency matrix (draft) | `058cdafd3d538dd17bccb857ce144a43b453d4f0` | Reconcile intended delta; not a wholesale tree replacement |
| #112 | Pay formulas (ACT and CEO), CEO pay law settings, site man-hours, public holidays, salary calculator | `efd548d4141cfd36e6480958c88c646adfe9a87a` | Reconcile intended delta; not a wholesale tree replacement |
| #113 | Nepali EPF and SOCSO recharge: permit company pays, user company or branch repays | `f348a7d3f434e0efb06aab9c5a228f744160403d` | Reconcile intended delta; not a wholesale tree replacement |
| #114 | HR: screening case file and guard code of conduct (PIKM/ISO package 1b, stacked on #51) | `a00ce2e64861c20006ad8bfb2c74040f5ff00df1` | Reconcile intended delta; not a wholesale tree replacement |
| #115 | Contracts: client due diligence and assignment instructions (PIKM/ISO package 1c, stacked on #91) | `e0ce1d301a4c59cdec3a5b303997e71e9c522e61` | Reconcile intended delta; not a wholesale tree replacement |
| #116 | Suggested drafts for BQs, vacancy posts and bills (DRAFT-HELP, off by default) | `5e287611365294d70360fe2181596a324c8fe409` | Reconcile intended delta; not a wholesale tree replacement |
| #117 | Asset Management extras: contractors, finding tenants, meters, resort bookings, harvest, planned maintenance | `d581ae5a2f256a118608cc023bcd35990494a014` | Reconcile intended delta; not a wholesale tree replacement |
| #118 | Asset Management: BQ for a new building or a renovation/extension (draft, on #82) | `a776a7641d67ccc220c27a0876b31e6d31cbf323` | Reconcile intended delta; not a wholesale tree replacement |
| #119 | JA switch-over: side-by-side reports incl. guard pay, ACT-set numbers, per-area switch, JA history import | `b5a5ba5b32eb6634c8ac0b8a7d0b6ef42050973f` | Reconcile intended delta; not a wholesale tree replacement |
| #120 | Guard pay run: monthly pay from attendance and ACT formulas, COO approval, payslips, bank file | `0f8ed471a163d745e7411835b69e59db0658f1b0` | Already included by ancestry; preserve main |
| #121 | Guards on their own phones: face plus PIN sign-in, on-duty location, SOS and heartbeat to CMS (switch, off by default) | `26040193d32ff3fbb276a9f86ccff6c747f87cbd` | Reconcile intended delta; not a wholesale tree replacement |
| #122 | Quality package 1d: service faults, supplier ratings, objectives, controlled documents, management review | `b165b880cd50ead435b5f5e76db1caabf34b2f92` | Reconcile intended delta; not a wholesale tree replacement |
| #123 | Handover note for Fitri: native guard phone app (docs only) | `f140e34e44528b16e7749552414fec3cebe25681` | Reconcile intended delta; not a wholesale tree replacement |
| #127 | Daily cash buffer: pay by bank or e-wallet only; cash only when listed and given | `15c20e763617a108f2b25e2fdf97441cd6c6e936` | Reconcile intended delta; not a wholesale tree replacement |
| #128 | FWM: record foreign worker recruitment steps | `46aa97b8f138a8c9a4ef495f9a3cb1a2ff839ad2` | Reconcile intended delta; not a wholesale tree replacement |

## Reconciled cross-feature behavior

- Preserve requester confirmation of IT resolution, existing mail/SharePoint/OBO protections, and bounded provider error handling rather than restoring older draft behavior.
- Merge proof-backed mobilisation with existing W12 CMS activation; combine standing plans and meeting invitations with recurring/toolbox meetings. Reject ambiguous combinations rather than silently choosing a schedule.
- Keep ACT checks with existing lead identities. Do not invent an obsolete deputy role or broaden staff permissions to accommodate old test fixtures.
- Withdrawn or replaced memos do not reappear in the legacy unread-reminder path.
- Task creation uses independent UUID identities, not the count of rows visible to the caller. Company walls and RLS do not become an identity allocator.
- Guard-phone biometric routes authenticate the active, unlocked device before expensive face computation and recheck existing controls afterward. Guard-phone activation remains separate.
- CEO/COO special cash-buffer amounts stay in the Finance cash ledger with receipts, approvals and audit. They do not enter man-hour or staff/guard payslip projections. This does not erase real work hours, ordinary salary or evidence, and does not establish tax treatment. See `CASH_BUFFER_REPORTING_BOUNDARY.md`.
- Salary-calculator defaults are visibly estimates while approved settings are unavailable; failure to fetch current settings is not presented as authoritative law.

## Operational acceptance still required

Fitri must test the exact merged version with each staff role before rollout, verify restricted-owner database upgrade instructions separately, and confirm provider-specific credentials/consent without enabling unrelated services. First-use offline OCR needs a manual-entry fallback: its local model assets are lazy-loaded, not automatically cached. Measure low-end-phone startup and memory, because the combined UI bundle is large. Synthetic CI is necessary for source integration, not a substitute for real staff UAT or a permission to deploy.
