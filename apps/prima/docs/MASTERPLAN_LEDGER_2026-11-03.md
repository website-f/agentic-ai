# Prima Secure: master readiness and canonical subsection ledger

**Refreshed 7 November 2026 (UTC). Documentation-only update to PR #61.**

This refresh supersedes the readiness claims and counts in the preserved 3 November snapshot below. It does not certify acceptance, authorize deployment, change application code or resolve PR merge conflicts. The filename is retained to preserve the existing ledger identity.

## A. Latest owner direction and responsibilities

Fauzan's 7 November direction after the master-readiness review:

- **Arisha:** refresh this existing PR #61 ledger only.
- **Fitri:** reconcile/integrate the departmental drafts and prepare the migration/recovery work. This records Fauzan's assignment; it is not evidence that Fitri has received or completed it.
- **UAT:** to be done later. Deferred timing is not a waiver of acceptance before real operational use.
- **“Can we release draft all?”:** a question, not release authorization. All drafts can be candidates for one planned release, but their current separate checks do not prove combined compatibility. Preserve gates; do not bulk merge or activate from this ledger.
- No main merge, deployment, live migration, provider/tenant grants, branch-protection change or communication to Fitri is performed by this documentation refresh.

The group programme starts **18 November**, not 15 November. This is a common training/orientation start, not automatic full cutover. The 18 December basic-data checkpoint remains conditional; learning continues through March 2027. Fitri's 12 November target is not a verified completion claim.

## B. Evidence baseline and limits

Canonical requirement source: **82-page PWVSB Super App Unified Masterplan V1–V15, 24 October 2026**. Its chapter 19 maps 121 subsections in chapters 01–13. This refresh retains every canonical row and the old evidence trail, adds current source/PR disposition, and covers chapters 14–19 separately.

- Current main: `b1325ea3bb36885ed6275fb7892709a19713c9b4`, tested tree `29b19bc6c53edf1efb96a0dfa0db7066141673c6`.
- [PR 129](https://github.com/fauzan4377/prima-secure-app/pull/129) merged7 Nov 09:21:49 UTC. It combines six reviewed repair branches and ancestry, **not every departmental draft**.
- 18/18 premerge jobs passed. [Post-merge CI42359424221](https://github.com/fauzan4377/prima-secure-app/actions/runs/42359424221) also succeeded on exact main at 09:33 UTC. These are source/synthetic engineering checks, not actual staff/provider acceptance.
- Main manifest base: `0b2ffca438ca3067458fde56358a69d3eebe50aa63ba338e455552e6f7f4799c`. Five existing modules only: procurement, rental corrections, cleanup, metrics, job email. Guard-pay, pay-formula and item modules are not newly activated.
- The 7 Nov public-runtime check found HTTP200/ok, but runtime schema expected/applied old base `4b4cf4d3…`; `ready:true` applied to the five existing modules and `providerVerified:false`. This is evidence of older staging availability, not deployment of this main or acceptance of every module. Recheck runtime before release; no Azure control-plane or real-user inspection is claimed.
- Main protection was reported disabled by GitHub. Changing protection is a separate authorized settings action, not included here.
- The detailed 3 Nov row descriptions/test references are historical locating evidence. This refresh verifies current PR disposition and known main changes; it does **not** independently retest every subrequirement. Unverified details remain unverified, not silently complete or absent.

### B1. Current source references

PR states below were freshly read during this refresh. Mergeability can change; recheck before integration. `false` means GitHub reports a conflict/dirty combination, not proof the feature itself is defective. PR 61 head is the pre-refresh snapshot; the documentation commit carrying this file supersedes it without changing application code.

| Ref | Exact reviewed head | State | GitHub mergeable | Integration owner |
|---|---|---|---|---|
| [#49](https://github.com/fauzan4377/prima-secure-app/pull/49) | `afbdcd4f25a2716d5ff020b02431fa7b46743c34` | Open draft | false | Fitri; acceptance owners remain department-specific |
| [#51](https://github.com/fauzan4377/prima-secure-app/pull/51) | `7bb0981c1ea47dd6b0a0e62951f594627eb24920` | Merged | Not applicable | Completed source merge |
| [#52](https://github.com/fauzan4377/prima-secure-app/pull/52) | `af699865b3ae87e1a155293f3f56563565e52316` | Open draft | false | Fitri; acceptance owners remain department-specific |
| [#53](https://github.com/fauzan4377/prima-secure-app/pull/53) | `4f1ed5fd37c784f8b4fba9fe42f69211a902fc6d` | Open draft | false | Fitri; acceptance owners remain department-specific |
| [#54](https://github.com/fauzan4377/prima-secure-app/pull/54) | `a93249e01c664a954fddbcb8d40ebe1d28c05916` | Open draft | false | Fitri; acceptance owners remain department-specific |
| [#55](https://github.com/fauzan4377/prima-secure-app/pull/55) | `ebf6e4d00850e9b7065c7ae4ad3968e00e84634d` | Open draft | false | Fitri; acceptance owners remain department-specific |
| [#56](https://github.com/fauzan4377/prima-secure-app/pull/56) | `c76c1afb22d7c92220279db3d762aa018ad47806` | Open draft | false | Fitri; acceptance owners remain department-specific |
| [#57](https://github.com/fauzan4377/prima-secure-app/pull/57) | `39c2c70ddeb98cfafb9b134e4c7e3919831f773e` | Open draft | false | Fitri; acceptance owners remain department-specific |
| [#58](https://github.com/fauzan4377/prima-secure-app/pull/58) | `242aefa4ca273d0803f8c3e39464f8275cbed63d` | Open draft | false | Fitri; acceptance owners remain department-specific |
| [#60](https://github.com/fauzan4377/prima-secure-app/pull/60) | `1bbe4a9d8a865d595ebb2e8e061e5729dbef6e06` | Open draft | false | Fitri; acceptance owners remain department-specific |
| [#61](https://github.com/fauzan4377/prima-secure-app/pull/61) | `0cce56a134f661f5ac85d6f5753398a6dc9e0c66` | Open draft | false | Fitri; acceptance owners remain department-specific |
| [#62](https://github.com/fauzan4377/prima-secure-app/pull/62) | `de70175f20e2ad93c3aa6942b3bb8252d0d8939c` | Open draft | false | Fitri; acceptance owners remain department-specific |
| [#63](https://github.com/fauzan4377/prima-secure-app/pull/63) | `f25bee57b48c5cf0fe1603a51e568556ce144999` | Open draft | true | Fitri; acceptance owners remain department-specific |
| [#129](https://github.com/fauzan4377/prima-secure-app/pull/129) | `77e9cbb133e57388384ba8e5954cd38fbbee1e2b` | Merged | Not applicable | Completed source merge |

### B2. Readiness vocabulary

Track independently: **source/merge**, **combined tests**, **migration/deployment**, **configuration/provider**, **real UAT**, **business acceptance/live**. A single “Ready” label is insufficient.

- Green: accepted on the intended deployed release, with evidence and owner sign-off.
- Amber: source/test evidence exists but one or more deployment/configuration/acceptance steps remain.
- Red: a known blocking gap.
- Grey: evidence not obtained.

No overall completion percentage is published. Do not reuse the old 104/12/4/1 counts. No subsection is marked operationally accepted by this refresh. This is absence of verified acceptance evidence, not a claim no work occurred elsewhere.

## C. Later decisions overriding stale row text

| Topic | Current interpretation / required treatment |
|---|---|
| Stock ownership | Goodwill transfers/sells to the purchasing company (e.g. Sasa Security); track owner, custodian, location and condition separately using one item identity. Do not reuse the old claim that Goodwill permanently owns all equipment. |
| Uniforms/payroll | Equipment and payroll source proposals differ. Management/legal decision and implementation reconciliation remain required before real use; do not select a deduction policy in this ledger. |
| Payroll | Guard payroll remains side-by-side trial (`primaPays:false`); statutory bands/effective dates and full-month reconciliation remain open. |
| Foreign-worker medical | RM200 per eligible worker **per year**, not per month; separate from statutory medical/leave obligations. |
| Offline | Later instruction requires ongoing work and synchronization after internet returns, with 72-hour access/re-authentication boundary. Offline repair code merged, but enrollment/recovery and physical-device acceptance remain open. The old blanket “offline deferred” sentence is superseded. |
| Power BI | Still deferred. |
| Delegation/succession | Ordinary delegation and succession are different. Succession requires relevant leader approval plus Chairman/VC consent with date/time. Reconcile conflicting draft authority rules rather than preserving an older snapshot as policy. |
| Director Office | Government tenders, CEO reports, and minutes/actions for every Director Office meeting. Private-sector tenders remain COO/SasaTeam. Tracking does not grant approval authority. |
| Standards | ISO 9001:2015 is the first mapping. Do not reopen the specifically excluded PIKM cross-company shareholder/director ownership point. |
| Arisha | Present staff IT guidance is deterministic/read-only; full document finding, workflow execution and leave-cover automation are not established by that guide. Board Q&A has a separate acceptance scope. |
| Language | English for current owner replies; Malay where specifically requested for staff materials. |

## D. Current canonical subsection overlay (121 rows)

Each row retains its canonical ID, requirement and original accountable role. The source reference is refreshed to the exact current-head tableB1; historical implementation/test detail remains in appendixH. **For every row: deployed version = not verified for the intended new release; real UAT = later per owner; acceptance/sign-off = not obtained.** A provider/physical/legal gate still applies even if the row is merged.

Fitri owns technical integration/migration; the listed process owner owns real data and business acceptance. Individual people and acceptance dates must be confirmed, not invented.

| § | Requirement | Process owner | Current source / dependency | Current readiness evidence | Next required proof / blocker |
|---|---|---|---|---|---|
| 83 | Group management hierarchy | CEO / Chief of Staff | Main b1325ea3; #52 draft (B1) | Merged/base source plus draft dependencies | Revalidate historical gap: Real people and Entra links for every leader |
| 84 | Legal-entity autonomy and board responsibility | Deputy CoS (Corporate Admin) | #52 draft | Draft; later decision overrides old wording | Do not reopen excluded PIKM cross-company ownership point; verify actual mandates |
| 85 | Company identity and licence dossier | Head of Company; DCoS checks vs SSM | #52 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: SSM profiles from Permata; PWVSB KPKT licence record missing |
| 86 | Director Office mandates and controlled instructions | Director Office Administrator / CEO | #52 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Real mandates and signed letters |
| 87 | Nationwide regional and state permissions | Operations Director / OGM / ROM | Main b1325ea3; #54 draft (B1) | Merged/base source plus draft dependencies | Revalidate historical gap: Real region/state assignments; no branch-creation screen |
| 95 | Multi-company tenancy and company-aware permissions | IT Lead (platform) | Main b1325ea3; #52 draft (B1), #53 draft (B1), #56 draft (B1), #57 draft (B1) | Merged/base source plus draft dependencies | Revalidate historical gap: PostgreSQL RLS proven on main only; module walls unpackaged |
| 96 | Management reporting versus statutory consolidation | Finance Director | #49 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Live SQL Account feed (staff paste exports today) |
| 101 | Authority registry: management agreements and board mandates | Deputy CoS / counsel | #52 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Signed agreements; counsel validation |
| 102 | Separation of ownership, rights and control | Deputy CoS / counsel | #52 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Counsel validation |
| 115 | Company master file and statutory register | Deputy CoS | #52 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: SSM extracts from Permata |
| 116 | Company-secretary appointment and performance | Deputy CoS | #52 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Secretary performance measures not defined |
| 117 | Corporate obligations and statutory calendar | Deputy CoS; each company renews | #52 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Real filing dates |
| 118 | Filing case with evidence and acknowledgment | Deputy CoS | #52 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: SSM acknowledgements (manual upload) |
| 119 | Board resolutions and signatory authorities | Deputy CoS | #52 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Signed resolutions |
| 120 | External auditor appointment and fees | Deputy CoS | #52 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Real panel names entered by staff |
| 121 | External audit lifecycle | Deputy CoS + FD | #52 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Auditor portals; real cycle dates |
| 122 | Auditor requests and SQL Account evidence | Finance Director | #49 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: SQL Account evidence is pasted, not fetched |
| 123 | Law-firm engagement lifecycle | Deputy CoS | #52 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Engagement letters |
| 124 | Litigation, claims and deadlines | Deputy CoS | #52 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Court deadlines entered by staff |
| 125 | Legal confidentiality, holds and conflicts | Deputy CoS | #52 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: **Open:** legal hold enforcement on files not built (hold is recorded, files are not frozen) |
| 126 | Adviser invoices and budgets | Deputy CoS + FD | #52 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Budget per adviser |
| 145 | Branch formation and management agreements | COO / Operations Director | #61 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Real agreements and KDN refs keyed by staff. Business case + 13-week cash at formation and branch treasury (bank balance, float, payroll due, Unknown when older than 3 days: rule decided by Fauzan 3 Nov 07:42Z) added on #61 after Arisha's 3 Nov 03:32Z note; figures are recorded by Finance, no live bank read |
| 146 | Branch rights, obligations and approval limits | COO | #61 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Approval limits not set by owner. JV rules (Fauzan 4 Nov 2026) added on #61: JV Branch Manager buys from any supplier with no approval, company asks but never blocks, arms only via Arms Control, CEO sets each branch's management fee %, CEO flagged when a month's profit is under 10% of billing (see docs/BRANCHES_LEDGER.md) |
| 147 | Branch-originated opportunity to contract | Branch Manager / COO | #61 draft (B1) | Draft; integration and combined validation pending | Process owner to supply real data, normal/failure-path evidence and signed acceptance |
| 148 | Branch accounts, payments and reconciliation | FD | #61 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Bank statements per branch; SQL ledger read waits for SQL connector (E62) |
| 149 | Branch payroll and employer obligations | HR / FD | #61 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: JA pay feed. JV branch (4 Nov 2026): branch office staff pay from Prima staff payroll goes into the month's P&L; the JV Branch Manager decides branch staff leave and sets branch office staff pay (Fauzan: "Yes they set it them self"), company and HR monitor |
| 150 | Branch as SQL project/profit centre | FD | #61 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Real SQL Account project codes; no direct SQL read |
| 162 | Three business models: master classification | COO | Main b1325ea3 | Main source/base; detailed acceptance not evidenced | Revalidate historical gap: Signed % per branch |
| 163 | Model A: configurable percentage of eligible billing | COO / FD | Main b1325ea3; #61 draft (B1) | Merged/base source plus draft dependencies | Revalidate historical gap: Real billing lines keyed by staff |
| 164 | Model B: company-operated branch with salary | COO / HR | Main b1325ea3 | Main source/base; detailed acceptance not evidenced | Process owner to supply real data, normal/failure-path evidence and signed acceptance |
| 165 | Model C: configurable share of agreed net profit | COO / FD | Main b1325ea3; #61 draft (B1) | Merged/base source plus draft dependencies | Revalidate historical gap: Net-profit definition signed |
| 166 | Company profit versus PWVSB fees and financing | FD | #54 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Fee amounts |
| 167 | Contract-based monthly distribution waterfall | FD | Main b1325ea3; #61 draft (B1) | Merged/base source plus draft dependencies | Revalidate historical gap: Real contract billing |
| 169 | Settlement statement, ledger agreement and sign-off | FD / Branch Manager | #61 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Ledger agreement by hand until SQL connector |
| 170 | No unauthorized branch bank or licence proxy | ACT / FD | #61 draft (B1) | Draft; integration and combined validation pending | Process owner to supply real data, normal/failure-path evidence and signed acceptance |
| 157 | Branch termination, step-in and asset recovery | COO / counsel | #61 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Counsel template |
| 20 | Sales CRM and tender qualifications | COO (private) / DOA (government) | Main CRM/KPI repair plus #54 draft | Merged partial; draft dependency | Prove tender/client record through mobilisation and billing |
| 4 | Contracted coverage and three billing methods | Company Manager / FD | Main b1325ea3; #49 draft (B1) | Merged/base source plus draft dependencies | Revalidate historical gap: Real contracts |
| 21 | Client contract, insurance and SLAs | Company Manager | Main b1325ea3; #52 draft (B1) | Merged/base source plus draft dependencies | Revalidate historical gap: Real insurance policies |
| 237 | Statutory-checked client mobilization and first billing | Company Manager / OM | Main b1325ea3 | Main source/base; detailed acceptance not evidenced | Revalidate historical gap: Real sites/posts |
| 25 | Client satisfaction and account profitability | COO + Company Manager | Main CRM/KPI plus #54 and #61 drafts | Merged partial; client-share draft | Permitted expiring client links; profitability, client feedback/requests and acceptance |
| 242 | Client termination, transfer and final settlement | COO / FD | #49 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Final settlement with SQL Account |
| 5 | Service rosters, shifts, breaks and attendance | OM / ROM | Main HR/payroll/site-device code; #54 dependency | Merged partial; real-device acceptance open | Observed shift/rest/relief cycle; offline enrollment and recovery |
| 22 | Patrolling-officer oversight and NFC guard tour | Patrolling Officer / OM | Main b1325ea3; #54 draft (B1) | Merged/base source plus draft dependencies | Revalidate historical gap: JA patrol feed; signed NFC tags |
| 38 | Patrolling-officer field SOP | Patrolling Officer | Main b1325ea3 | Main source/base; detailed acceptance not evidenced | Revalidate historical gap: JA owns guard patrol |
| 6 | HR leave, attendance and benefits | HR | Main via #51 and #129 | HR source merged; deployment and business acceptance not evidenced | Official statutory inputs, leave/payroll reconciliation; RM200 annual foreign-worker medical cap |
| 7 | Foreign-security-worker recruitment to repatriation | FWM Manager | Main b1325ea3 | Main source/base; detailed acceptance not evidenced | Revalidate historical gap: JTKSM/JIM/KDN portals manual |
| 36 | Guard licensing, training and deployment readiness | HR (all companies) + company head | Main b1325ea3 | HR source merged; deployment and business acceptance not evidenced | Revalidate historical gap: JA sync back (3G partly) |
| 37 | Office training and learning evidence | HR | Main b1325ea3 | HR source merged; deployment and business acceptance not evidenced | Revalidate historical gap: HRD Corp claim refs entered by staff |
| 232 | Employee grievance and disciplinary case | HR / HR Director | Main b1325ea3 | HR source merged; deployment and business acceptance not evidenced | Revalidate historical gap: Real panels |
| 240 | Responsible recruitment and worker welfare | FWM | #62 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Agent audits keyed by staff; does not close wider FWM lifecycle (7) or hostel/CLQ (8) gaps |
| 8 | Accommodation and CLQ sourcing to closure | FWM | Main b1325ea3 | Main source/base; detailed acceptance not evidenced | Revalidate historical gap: JA hostel feed |
| 9 | Hostel electricity/water budgets and invoice controls | FWM / FD | Main b1325ea3; #53 draft (B1) | Merged/base source plus draft dependencies | Revalidate historical gap: Real bills |
| 57 | Fleet, vehicle utilization and transport | Transport head + CMS | #53 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Tracker vendor feed |
| 231 | Occupational safety and site hazard response | HR (office) / Ops (site) | Main b1325ea3 | HR source merged; deployment and business acceptance not evidenced | Revalidate historical gap: Site HIRARC per post |
| 34 | KDN security licence annual readiness | Company admin; Central Admin monitors | #52 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: KDN portal manual |
| 35 | MOF and ePerolehan renewal | Company admin | #52 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: ePerolehan manual |
| 234 | Corporate, employer and employment tax | FD / HR | Main b1325ea3; #49 draft (B1) | Merged/base source plus draft dependencies | Revalidate historical gap: e-PCB check by Finance |
| 244 | Cross-company statutory and contract calendar | DCoS monitors | #52 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Real dates |
| 69 | Accounting ledger system-of-record principles | FD | #49 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: No live SQL connector (E62) |
| 70 | Utilize native SQL Account functionality | FD | #49 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: SQL usage monitor uses pasted data |
| 71 | SQL edition, modules, integration and accounting data | FD / IT Lead | #49 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: **Open:** interface only, switched off; no live SQL Account reader; edition and API per company not confirmed |
| 72 | Chart of accounts and cost dimension mapping | FD | #49 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Real chart and project codes; FD to decide if a missing mapping blocks close |
| 73 | Mandatory bank reconciliation | FD + teams | #49 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Bank feeds; staff paste SQL ledger |
| 74 | Customer aging and collections | FD | #49 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: SQL ageing pasted |
| 75 | Supplier aging and payment obligations | FD | #49 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: SQL AP pasted |
| 76 | Profit and loss, balance sheet and cash-flow agreement | FD | #49 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Real SQL report figures |
| 77 | Financial close and independent review | FD / CEO | #49 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: SQL close status manual |
| 78 | Budgets, scenario plans and 13-week cash forecast | FD | #49 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: **Open:** three-statement (P&L, balance sheet, cash-flow) forecasts and approved budget revision workflow not confirmed built; 13-week cash forecast is built. Real budget inputs |
| 79 | Accounting links to inventories and fixed assets | FD / Asset | Main item outbox plus #49 draft | Interface only; no item SQL sending adapter | Entity/book/SKU mapping and acknowledged idempotent reconciliation |
| 80 | Group Finance dashboards and operating scorecards | FD / CEO | #49 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Power BI deferred |
| 49 | Purchase request to verified payment | Procurement exec / COO+CEO | Main b1325ea3 | Main source/base; detailed acceptance not evidenced | Revalidate historical gap: Supplier bank verification by FD (G8) |
| 53 | Procurement policy and sourcing methods | Procurement | Main b1325ea3 | Main source/base; detailed acceptance not evidenced | Process owner to supply real data, normal/failure-path evidence and signed acceptance |
| 54 | Central and regional warehouse, uniform inventory | Inventory / Goodwill store | Main item code via #129; #54 draft | Merged partial; item module not activated | Goodwill seller-to-buyer transfer, opening count, SQL adapter, uniform policy |
| 55 | Returnable equipment and fixed-asset register | Asset / IT | Main item/IT assets via #129; #53 draft | Merged partial; non-IT expansion draft | Physical custody, serial/bulk mapping, maintenance and ownership reconciliation |
| 56 | Technology rollout, site asset custody | IT / OM | Main b1325ea3 | Main source/base; detailed acceptance not evidenced | Revalidate historical gap: Real devices |
| 58 | Company property, rentals and hostel assets | Asset Mgmt dept / IT | Main b1325ea3; #53 draft (B1) | Merged/base source plus draft dependencies | Revalidate historical gap: Asset Mgmt developer API |
| 59 | Planned maintenance, repairs and work orders | IT / Asset | Main b1325ea3 | Main source/base; detailed acceptance not evidenced | Revalidate historical gap: Non-IT work orders |
| 60 | Stock transfers, loss, theft and disposal | Inventory Manager | Main item transfer/loss source via #129; #54 draft | Merged partial; item module not activated | Witnessed transfers/returns/loss/disposal; physical and accounting reconciliation |
| 61 | Insurance and warranty response | Asset / FD | Main base screen plus claim steps in #61 | Draft claim workflow; warranty gap | Real claim lifecycle and insurer/bank reconciliation; warranty scope |
| 239 | Supplier and subcontractor assurance | Procurement / FD | Main b1325ea3 | Main source/base; detailed acceptance not evidenced | Revalidate historical gap: Real supplier documents |
| 103 | KPKT licensing: verification gate | DCoS / counsel | #52 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Real PWVSB KPKT licence not keyed |
| 104 | Financing case, drawdown and repayment | FD / DCoS | #52 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Real loans |
| 105 | Loan accounting and borrower-lender reconciliation | FD | #52 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: SQL loan ledger |
| 134 | Collateral is security, not present ownership | DCoS / counsel | #52 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Counsel |
| 135 | Default automatically triggers a process, not a transfer | DCoS | #52 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Counsel |
| 136 | Notices, legal reviews and lawful enforcement | DCoS / counsel | #52 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Counsel |
| 138 | Default and cure determination with ledger evidence | FD / DCoS | #52 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Ledger evidence |
| 182 | Federated multi-company monitoring scope | Arms Control Manager (CMS under Arms Control) | #53 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Real site directory push |
| 183 | 24-hour duty operator and shift handover | Head Control | Main b1325ea3 | Main source/base; detailed acceptance not evidenced | Revalidate historical gap: Real roster |
| 184 | Live guard coverage and attendance | CMS / OM | #53 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: JA attendance feed |
| 185 | Supervisor patrols and NFC guard tours | CMS | #53 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: JA patrol feed |
| 186 | CCTV, recording health and AI analytics | CMS | #53 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: CCTV vendor list not supplied |
| 187 | ANPR, barrier gates, turnstiles and access control | CMS | #53 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: ANPR/VMS vendor feeds |
| 188 | Panic, sensor and infrastructure alarms | CMS | #53 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Panel keys; alarm vendors |
| 189 | Event correlation, dispatch and incident handling | CMS operator | #53 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: SMS/voice provider |
| 190 | CMS dashboard and response queue | CMS | #53 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Hosting not approved |
| 191 | CMS activation during client onboarding | CMS / Company Manager | #53 draft (B1) | Draft; integration and combined validation pending | Process owner to supply real data, normal/failure-path evidence and signed acceptance |
| 192 | Device integration contracts and event schema | IT Lead | #53 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Brand profiles |
| 193 | CMS cybersecurity, evidence and resilience | IT Lead | #53 draft and main site-device code | Partial; provider/recovery gaps | Durable CMS storage/operator identity, real vendor feeds and recovery drills |
| 195 | CMS coverage and response performance indicators | Arms Control Manager | #53 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Live events |
| 201 | Applicable KDN/PDRM authority and scope checks | Arms Control Manager | #53 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Real licences |
| 203 | Controlled arms, ammunition and custodian records | Arms Control | #53 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Real serials (Arms Control only) |
| 204 | Approved armoury/vault and physical verification | Arms Control | #53 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: RFID tags at pilot vault |
| 205 | Authorization-to-disposal firearm lifecycle | Arms Control | #53 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Police notices manual |
| 206 | Armed guard and shift readiness | Arms Control / OM | #53 draft (B1) | Draft; integration and combined validation pending | Process owner to supply real data, normal/failure-path evidence and signed acceptance |
| 207 | Custody and movement authorization trail | Arms Control | #53 draft (B1) | Draft; integration and combined validation pending | Process owner to supply real data, normal/failure-path evidence and signed acceptance |
| 208 | Ammunition accountability and discrepancies | Arms Control | #53 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Real counts |
| 210 | Armed-service supervision and SOP assurance | Arms Control | #53 draft (B1) | Draft; integration and combined validation pending | Process owner to supply real data, normal/failure-path evidence and signed acceptance |
| 211 | Serious incident and statutory-notification assessment | Arms Control | #53 draft (B1) | Draft; integration and combined validation pending | Process owner to supply real data, normal/failure-path evidence and signed acceptance |
| 212 | Armed-client onboarding and coverage | Arms Control / COO | #53 draft (B1) | Draft; integration and combined validation pending | Process owner to supply real data, normal/failure-path evidence and signed acceptance |
| 221 | Arms Control departmental ownership vs CMS monitoring | Arms Control / CMS | #53 draft (B1) | Draft; integration and combined validation pending | Process owner to supply real data, normal/failure-path evidence and signed acceptance |
| 222 | Vault CCTV, recording continuity and alert escalation | Arms Control | #53 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Vault CCTV feed |
| 224 | Armed-client insurance, service pricing and contracts | Arms Control / CoS | #53 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Real policies |
| 225 | Future firearms buying/selling: disabled until authorized | CEO switch | #53 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Counsel/PDRM on trade stock |
| 233 | Anti-corruption, gifts, tender integrity and whistleblowing | ACT | Main b1325ea3; #55 draft (B1) | Merged/base source plus draft dependencies | Process owner to supply real data, normal/failure-path evidence and signed acceptance |
| 235 | National incident command and continuity | IT + group leadership | Main b1325ea3; #56 draft (B1) | Merged/base source plus draft dependencies | Revalidate historical gap: No real backups yet |
| 236 | Personal data, cybersecurity and breach notification | PDPA officer | Main b1325ea3 | Main source/base; detailed acceptance not evidenced | Revalidate historical gap: DPIA; pen test |
| 238 | Risk-based independent internal audits | ACT Director | #55 draft (B1) | Draft; integration and combined validation pending | Process owner to supply real data, normal/failure-path evidence and signed acceptance |
| 241 | Fraud anomalies, investigations and forensic controls | ACT | #55 draft (B1) | Draft; integration and combined validation pending | Revalidate historical gap: Face provider for fix 13 |
| 243 | Emergency delegation and succession | CEO / CoS | #52 draft | Draft; authority conflict must be reconciled | Separate ordinary delegation from succession: leader approval plus Chairman/VC consent and timestamp |

## E. Cross-cutting chapters 14–19

| Chapter | Current source position | Required evidence / next action | Owner |
|---|---|---|---|
|14 Shared journeys, IDs, workflow contracts | Main shell; #56/#57 drafts; role/handover acceptance not established | Trace one record across departments without re-entry or scope expansion; identity and source-of-record mapping | Fitri + CoS + department owners |
|15 Architecture, security and integrations | Main company walls and repair tests; partial providers; deployed schema older | Versioned migration/recovery package, real tenant/provider checks, offline enrollment/recovery, retention and capacity tests | Fitri + IT checker; relevant data owners |
|16 Balanced scorecards | IT and reviewed HR/CRM KPI source on main; Finance/CMS/Growth draft extensions | Approved formulas/targets, real baseline, completeness/freshness and “unknown” handling | FD/COO/CoS + department owners |
|17 Release gates | PR 129 checks passed, not full operational gate | Scope freeze, combined candidate, production-like rehearsal, UAT later, formal go/no-go | Fitri prepares; leadership/process owners accept |
|18 Decisions and prerequisites | Documented open questions remain | Resolve uniform/statutory/retention/vendor/mapping decisions with named accountable person and evidence | CEO + relevant owner/counsel |
|19 Traceability |121-row historical source retained and current overlay added | Continue updating this ledger on exact release; link evidence and signed acceptance per row, not aggregate optimism | Arisha ledger review; Fitri technical evidence; business owners sign-off |

## F. Masterplan release gates and all-draft question

The canonical plan(pp 77–78) requires legal-entity/mandate evidence, cross-company negative tests, one observed live shift cycle, a full parallel payroll/billing/bank reconciliation cycle, signed settled A/B/C branch examples, SQL bank/AR/AP/GL/financial-statement agreement, actual camera-loss alert and vault/CMS/arms incident drill, official filing acknowledgements, misuse/duplicate/late-evidence/AI-error/outage tests, and a multi-owner go/no-go with rollback/contingency.

**No full operational release is certified.** All drafts may be planned as a combined release candidate only after Fitri reconciles dependencies/conflicts, preserves existing work and tests the exact combination. Marking a draft ready for review, merging source, deploying to staging and releasing for live operations are four different actions. This refresh performs none of them. UAT later means the real-use gate remains pending, not waived.

## G. Action/evidence register

| Item | Next action | Owner per latest direction | Current status | Completion evidence required |
|---|---|---|---|---|
|Ledger refresh | Update same file, preserve121 IDs/history; verify documentation-only diff | Arisha | This refresh; publication verified separately | Remote blob/commit and unchanged application files |
|Draft integration | Select included/excluded scope; reconcile #49/#52–58/#60–63 and other relevant feature dependencies with main | Fitri | Assigned by Fauzan; not communicated/completed by this refresh | Exact candidate SHA, reviewed diff, combined CI and dependency record |
|Migration/recovery | Package actual0b2ffca4 base transition; rehearse representative restore/migration/rollback | Fitri | Pending | Immutable package/version, logs, reconciliation, rollback/restore evidence |
|Provider readiness | SQL entity/book/SKU mapping and adapter; trusted Teams source/consumer; selected Microsoft permissions | Fitri with Finance/IT owners | Not accepted | Real permitted identities/resources, deny/revoke/retry/replay tests, reconciliation |
|Policy | Uniform treatment, statutory inputs, data retention/key/disclosure procedures | CEO + HR/Finance/Compliance/counsel | Open | Dated decision, implemented controls and tests |
|Real UAT | Five common and three high-risk tasks per department; actual identities/devices | Department owners with IT | Later per Fauzan | Pass/fail, time/errors, downstream output, exceptions and sign-off |
|Release decision | Formal go/no-go after applicable gates | Fauzan + relevant leadership/process owners | Not authorized by ledger refresh | Explicit release scope/version/conditions and approval |

## H. Preserved historical snapshot — NOT current readiness

The following original3Nov content is retained verbatim for audit/history. Its counts, PR states, deployment assertions and owner decisions are superseded where sectionsA–G differ. Do not use this appendix as the current readiness summary.

<details>
<summary>Original 3 November ledger and all historical evidence</summary>

# Prima Secure: masterplan subsection ledger

Prepared 3 Nov 2026 (MYT) for the combined review (brought forward from Thursday 5 Nov at Fauzan's request). Revised 3 Nov 03:35Z after Arisha main's review of `946dc01`. It answers Arisha main's 2 Nov 16:16Z request for a subsection-level ledger. It is an evidence map. It is not an acceptance certificate, a deployment claim or a statement that the masterplan is "all built".

## 1. What was compared

- **Requirement source:** *PWVSB Super App Unified Masterplan V1 to V15* (Word version in project uploads, `02ff87a4…`). Its chapter 19 "Canonical subsection traceability" lists **121 subsections in chapters 01 to 13**. Every one of them is a row below. Chapters 14 to 17 (architecture, metrics, release gates) are in section 6.
- **Later owner decisions:** taken from the project record (Fauzan's decisions 24 Oct to 2 Nov 2026). The "Latest amendment" column gives the newest one I found per subsection.
- **Code, pinned (one snapshot, 3 Nov 2026 03:35Z):** every row below is read against these heads. A row's "Where and commit" names the commit where the work was found; the head in this table contains it. Re-pin before quoting a row after this time.

| Ref | Snapshot head | Scope | GitHub CI on this exact head |
|---|---|---|---|
| main | `0ead549` | IT pilot (PR #50) + October sample-data screens | Staging deploy runs in section 4 |
| PR #49 Finance | `77cbab2` | Phase 2 Finance incl. 71/72/76 | green: runs 41563108044 (PR), 41563102907 (push) |
| PR #51 HR | `84e78eb` | 3A-3G | green: 41558383714, 41558377232 |
| PR #52 Central Admin | `19a7040` | 5A-5G, W15, 103/126/243 | green: 41557146438, 41557139892 |
| PR #53 Special Ops | `6defaa9` | 4A-4H, CMS app, 191/193/195 | green: 41556755262, 41556749879 |
| PR #54 Gov/Private Ops | `de364af` | Goodwill, Sasa Team, procurement | green: 41556421779, 41556417326 |
| PR #55 ACT | `ebf6e4d` | ACT department incl. 241 | green: 41558247914 (attempt 2), 41558240310 |
| PR #56 Connect departments | `74c508a` | key once, handovers, go-live checks | CI result on this head not read here; owner thread to supply |
| PR #57 Company office | `56c0617` | company offices | green: 41556769630 |
| PR #58 Work rebalancing | `242aefa` | delegate/readjust work | green: 41542941427 (attempt 2) |
| PR #61 Branches | the commit carrying this file (business case, treasury) | chapter 03 branches + this ledger | earlier heads green (7c0ce2f, 946dc01, c52a44d); this head reported separately |
| PR #62 FW welfare | `a19cdb1` | 240 | green: 41559844394 |

Each PR is tested on its own. **No combined candidate containing all of these exists yet** (#61 is not yet in it; the Connect departments thread is reconciling), so green per-PR CI does not show the PRs work together.

## 2. Headline

| Level | Subsections | Meaning |
|---|---|---|
| Draft PR | 104 | Code written and tested on synthetic data in an open draft PR; not merged, migrated or deployed |
| Sample-data screen on main only | 12 | October demo-level screen; no real-use version |
| Staff UAT pending (IT pilot on main) | 4 | Merged and deployed to staging by workflow; staff UAT not done |
| Partial | 1 | 193 CMS resilience: file store built; DB store and Entra operator sign-in plan only |
| **Accepted** | **0** | No subsection has owner or staff acceptance evidence |

Counted from the state column of the 121 rows in section 10 (104 + 12 + 4 + 1 = 121). **"All built" cannot be claimed.** A draft PR row means source code exists; it is not a live integration and not an accepted user journey (sections 4 and 5).

## 3. Three kinds of progress, kept apart

1. **Source updates in draft PRs** (this ledger's "Draft PR" rows). Examples from 3 Nov: SQL Account interface and FS-01..FS-12 statement checks (#49), branch lifecycle and month workflows (#61), recruitment and welfare checks (#62), CMS activation and KPIs (#53), KPKT check, adviser budgets and delegation register (#52), fraud anomalies and investigations (#55).
2. **Live integrations**: none of the above is connected to a live provider. See section 5.
3. **Accepted user journeys**: none. Browser checks reported by build threads are headless runs on the demo build with synthetic data, not staff UAT.

Local test results quoted in rows ("per #NN thread") are the build thread's own report on synthetic data; PostgreSQL results are on a throwaway local PostgreSQL 16, not staging.

## 4. Deployment proof

- **Staging deploy** workflow run 41382096652 succeeded on `9c03cbf` (merge of PR #50) on 2 Nov 03:15Z. **Exact SPA cutover** run 41399587980 succeeded on `0ead549` on 2 Nov 06:23Z.
- That proves the workflow ran. It does not prove the staging database migration state, tenant grants, runtime health or any staff journey.
- **No draft PR is deployed.** Every "Draft PR" row has no deployment proof.

## 5. Coded interface versus live connection

| Connection | Coded where | Live? |
|---|---|---|
| Microsoft sign-in (Entra) | main | Deployed to staging; per-staff account links not verified here |
| SharePoint selected libraries | main (metadata only) | Not connected: tenant consent/config not verified |
| Microsoft 365 Connections page | PR #60 | Off by default; tenant steps pending |
| Outlook email copied to a job | PR #39 | Not registered; Mail.Read consent pending |
| Teams / SharePoint approvals | PR #49 | Off; no Graph calls |
| Power BI | PR #39 | **Deferred** (owner) |
| SQL Account | PR #49 read-only connector interface | **Switched off**; no reader installed; edition/API per company not confirmed; staff record figures from SQL reports |
| MyInvois / Customs / banks | none | Manual |
| JA app | main (`jaIngest`); PR #51 guard feed; CMS app JA adaptor (#53) | Receivers coded only; JA side not built; no live traffic |
| CMS Command Centre app | PR #53 `apps/cms` | Not hosted; file store only; operator keys stand in for Entra |
| CMS alarm/ANPR/tracker vendors | PR #53 adaptors | No vendor connected |
| WhatsApp rent reminders | PR #53 | Off; separate approval needed |
| Arisha AI (Azure OpenAI) | main (four leaders), PR #49 A8 | A8 off pending verified Azure endpoint |
| Staff face check | PR #51 | Not live; server face scoring needs a face provider |

## 6. Cross-cutting chapters 14 to 17

| Chapter | Requirement | State |
|---|---|---|
| 14 One shell, IDs, workflow contracts | Single app shell and role menus on main; per-department rollout switches in #51/#52/#53/#56 | Draft; switches must be combined |
| 15 Architecture and security | RLS company walls on main; department walls as add-on SQL modules in #52/#53/#56/#57/#62 | Add-on modules need versioned release-manifest entries; #62 `fw-welfare-v1.sql` is outside the manifest; no install authorized |
| 15 System-of-record ownership | SQL Account = ledger, JA = guards, Prima = control | Interfaces only (section 5) |
| 16 Metrics and monitoring truth states | IT timing on main; Finance KPI #49; CMS KPIs #53; "Unknown, never green" in #49/#53 | Draft |
| 17 Release gates | Go-live check and restore drill scripts in #56 | Backups, monitoring, pen test, DPIA, real data import, per-staff UAT all open |

## 7. Corrections since the first version

- Removed: the 2 Nov statement that GitHub CI was failing on every PR head. That was an Actions billing stop; every head in section 1 except #56 has a green run quoted above.
- Removed: the statement that the Finance 13-week cash forecast was missing. It is built (FIN-CASH13); the stale rows in `docs/FINANCE_PHASE2.md` were fixed on #49 at `2b69001`.
- Removed: "Not built (14)" and the old 4/82/19/2/14 headline. All 14 were built as draft source on 3 Nov; the headline is recounted in section 2.
- **Welfare (240, #62 `a19cdb1`) is a draft outside the release manifest. It does not close the wider foreign-worker lifecycle (row 7) or hostel/CLQ (row 8) gaps, which remain sample-data only.**
- 193 stays partial.

### 7a. Detailed requirements still open inside mapped rows (Arisha main, 3 Nov 03:32Z)

The 121 subsection IDs are all mapped, but a row label does not prove that every detailed requirement in that subsection is built, or that any staff journey works. These are known open details:

| Detail | Row | State |
|---|---|---|
| Branch treasury; business case and 13-week cash at formation | 145 | Added on #61 (this head); synthetic tests only |
| Legal hold enforcement on files | 125 | Open (hold recorded, files not frozen) |
| Client portal | 25 | First step drafted in PR #61: read-only expiring report links (Fauzan's choice 3 Nov). Client sign-in, feedback and requests still open |
| Insurance claims workflow | 61, 21 | Added on #61 (claim steps: insurer told, documents, offer, manager accepts, Finance records money; docs/INSURANCE_CLAIMS.md). Warranty claims still open |
| Three-statement forecasts | 78, 76 | Open: not confirmed built; Finance thread to confirm |
| Approved budget revisions | 78 | Open: not confirmed built; Finance thread to confirm |
| Live SQL Account reader | 71 | Open: interface only, switched off |
| CMS DB resilience, operator Entra sign-in, real device/provider acceptance | 193, 182-195 | Open |

## 8. Scope

Only **offline work** (#46, #48) and **Power BI** (#39) are deferred by the owner. Everything else stays in scope as an open gap, including the 12 sample-only rows, the partial row 193, the 4 IT rows awaiting staff UAT, and open review findings per PR. Gaps that cannot close before review are flagged, not marked complete.

Sample-data only (12): 162, 164 branches (model classification, Model B); 20 CRM and tenders; 237 mobilisation; 5 rosters; 38 field SOP; 7 FWM lifecycle; 8 hostels; 61 insurance/warranty; 239 supplier assurance; 183 CMS duty handover; 236 PDPA.

## 9. Method and limits

- "Where and commit" names the PR or main and the latest commit on that ref whose diff touches code matching the subsection's identifiers (`git log -G`). It locates the work; it is not a reviewed implementation sign-off. Verify a row before quoting it outside this ledger.
- "Test evidence" lists test files on that ref that exercise the same identifiers. Passing tests are unit level on synthetic data.
- Owners are the masterplan role as amended by Fauzan's decisions. Real people are not named; staff enter real data in the app.

## 10. Subsection ledger (121 rows)

State legend: every row is **Not accepted**. The reason is given (sample data only, draft review open, staff UAT pending, partial, not started).


### 01 Enterprise control and organisation

| § | Requirement | Latest amendment | Owner | Where and commit | Test evidence | Deployment proof | Missing data / integration | State |
|---|---|---|---|---|---|---|---|---|
| 83 | **Group management hierarchy**. Sample-data screen on main+Draft PR: Group leader views on main (isGroupLeader); Director Office desk in PR #52 (5E) | Group data only for CEO/COO/FD/CoS/DCoS/Chairman/VC (Fauzan 26 Oct); Director Office = 8 members (1 Nov) | CEO / Chief of Staff | main `68582be`; #52 `ecb20f1` | `core.test.ts` | main part: Staging deploy run 41382096652 (9c03cbf) + SPA 41399587980 (0ead549); no runtime UAT; PR part: none | Real people and Entra links for every leader | Not accepted: draft, review open |
| 84 | **Legal-entity autonomy and board responsibility**. Draft PR: Board records and DCoS-only corporate change approval with reason | Company boards separate from PWVSB; each PWVSB person on one board only (1 Nov) | Deputy CoS (Corporate Admin) | #52 `089937c` | `central-admin-5a.test.ts`, `central-admin-5b.test.ts` | None: not merged | Real board registers from Permata | Not accepted: draft, review open |
| 85 | **Company identity and licence dossier**. Draft PR: Company record draft by Head of Company, DCoS checks vs SSM (5A part 3, 5B company file) | 5A company record draft by Head of Company, DCoS checks (2 Nov) | Head of Company; DCoS checks vs SSM | #52 `7b68b77` | `central-admin-5b.test.ts`, `central-admin-guide.test.ts`, `central-admin-review.test.ts` | None: not merged | SSM profiles from Permata; PWVSB KPKT licence record missing | Not accepted: draft, review open |
| 86 | **Director Office mandates and controlled instructions**. Draft PR: Mandates with reasons; Director Office desk and CEO instruction tracker (5E) | CEO instruction tracker added (1 Nov); every approval needs a reason (31 Oct) | Director Office Administrator / CEO | #52 `089937c` | `central-admin-5d.test.ts`, `central-admin-5e.test.ts` | None: not merged | Real mandates and signed letters | Not accepted: draft, review open |
| 87 | **Nationwide regional and state permissions**. Draft PR: Site state fallback, opsSector, Goodwill 7 regions, private side (Sasa Team) | Gov side = Goodwill Empire 7 regions; private = Sasa Team (2 Nov) | Operations Director / OGM / ROM | #54 `9e24e1f`; #51 `fbe80d8` | `gov-ops-monitor.test.ts`, `gov-procurement-golive.test.ts`, `private-ops-monitor.test.ts`, `rls.test.ts` | None: not merged | Real region/state assignments; no branch-creation screen | Not accepted: draft, review open |
| 95 | **Multi-company tenancy and company-aware permissions**. IT pilot code on main+Draft PR: Company RLS + department walls on main (IT pilot); HR/admin/arms/CMS/org/office walls in draft PRs (modules unpackaged) | Department walls (PR #34, 31 Oct); per-department walls in each phase PR | IT Lead (platform) | main `9dc0f9e`; #51 `ef33d50`; #52 `0bfb335`; #53 `ffa24b1`; #56 `05b4a4a`; #57 `620e794` | `connections-auth.test.ts`, `hr-it-rls.test.ts`, `it-cleanup-rls.test.ts`, `hr-3g-3d.test.ts` | main part: Staging deploy run 41382096652 (9c03cbf) + SPA 41399587980 (0ead549); no runtime UAT; PR part: none | PostgreSQL RLS proven on main only; module walls unpackaged | Not accepted: draft, review open |
| 96 | **Management reporting versus statutory consolidation**. Draft PR: Group view and monthly pack (management view only) | SQL Account stays system of record (V6, 27 Oct) | Finance Director | #49 `f9a63a9` | `finance-controls.test.ts`, `finance-phase2.test.ts` | None: not merged | Live SQL Account feed (staff paste exports today) | Not accepted: draft, review open |
| 101 | **Authority registry: management agreements and board mandates**. Draft PR: Mandates register, legal verification with reason (5A/5D) | V8 authority via management agreements + board mandates | Deputy CoS / counsel | #52 `11f6867` | `central-admin-packaging.test.ts`, `central-admin-5b.test.ts`, `central-admin-5d.test.ts` | None: not merged | Signed agreements; counsel validation | Not accepted: draft, review open |
| 102 | **Separation of ownership, rights and control**. Draft PR: Collateral-only credit records (5G); ownership never changes | V10: beneficiary agreements = collateral only | Deputy CoS / counsel | #52 `ecb20f1` | `central-admin-5b.test.ts`, `central-admin-5g.test.ts`, `central-admin-review.test.ts` | None: not merged | Counsel validation | Not accepted: draft, review open |

### 02 Corporate affairs, secretaries, legal

| § | Requirement | Latest amendment | Owner | Where and commit | Test evidence | Deployment proof | Missing data / integration | State |
|---|---|---|---|---|---|---|---|---|
| 115 | **Company master file and statutory register**. Draft PR: Company file + statutory register (5B) | DCoS alone records filings; companies view and supply papers (1-2 Nov) | Deputy CoS | #52 `7b68b77` | `central-admin-5a.test.ts`, `central-admin-5b.test.ts`, `central-admin-guide.test.ts` | None: not merged | SSM extracts from Permata | Not accepted: draft, review open |
| 116 | **Company-secretary appointment and performance**. Draft PR: Company secretary view-only sign-in; performance measures not defined | Company secretary monitors, view only (2 Nov) | Deputy CoS | #52 `7b68b77` | `central-admin-rollout.test.ts`, `central-admin-5a.test.ts`, `central-admin-5b.test.ts` | None: not merged | Secretary performance measures not defined | Not accepted: draft, review open |
| 117 | **Corporate obligations and statutory calendar**. Draft PR: Renewals calendar 5C (KDN 120, majlis 60, vendor 90, ISO 120) | Renewals done by each company, Central Admin monitors; lead times KDN 120/majlis 60/vendor 90/ISO 120 (2 Nov) | Deputy CoS; each company renews | #52 `7b68b77` | `central-admin-5a.test.ts`, `central-admin-5c.test.ts`, `central-admin-5d.test.ts` | None: not merged | Real filing dates | Not accepted: draft, review open |
| 118 | **Filing case with evidence and acknowledgment**. Draft PR: Filing steps by DCoS with evidence | Only DCoS records filing steps (2 Nov) | Deputy CoS | #52 `11f6867` | `central-admin-5a.test.ts`, `central-admin-5e.test.ts` | None: not merged | SSM acknowledgements (manual upload) | Not accepted: draft, review open |
| 119 | **Board resolutions and signatory authorities**. Draft PR: Board resolution record; changes approved by DCoS with reason | Company manager raises; DCoS alone approves with reason; CoS monitors (2 Nov) | Deputy CoS | #52 `089937c` | `central-admin-5a.test.ts`, `central-admin-5b.test.ts` | None: not merged | Signed resolutions | Not accepted: draft, review open |
| 120 | **External auditor appointment and fees**. Draft PR: Panel firms list (staff-kept) 5D | Audit firm panel is a staff-kept list (2 Nov) | Deputy CoS | #52 `089937c` | `central-admin-5b.test.ts`, `central-admin-5d.test.ts` | None: not merged | Real panel names entered by staff | Not accepted: draft, review open |
| 121 | **External audit lifecycle**. Draft PR: Audit cycle steps 5D | COR remainder (27 Oct) | Deputy CoS + FD | #52 `11f6867` | `staff-security.test.ts`, `core.test.ts` | None: not merged | Auditor portals; real cycle dates | Not accepted: draft, review open |
| 122 | **Auditor requests and SQL Account evidence**. Draft PR: Monthly audit file pack; SQL evidence pasted, not fetched | Monthly audit file pack (Finance PR #49) | Finance Director | #49 `701fe5b` | `finance-phase2.test.ts`, `finance-yearend.test.ts` | None: not merged | SQL Account evidence is pasted, not fetched | Not accepted: draft, review open |
| 123 | **Law-firm engagement lifecycle**. Draft PR: Legal matters behind legal wall (5D) | Legal matters walled; secretary never sees legal (2 Nov) | Deputy CoS | #52 `7b68b77` | `central-admin-packaging.test.ts`, `central-admin-5d.test.ts`, `central-admin-guide.test.ts` | None: not merged | Engagement letters | Not accepted: draft, review open |
| 124 | **Litigation, claims and deadlines**. Draft PR: Legal matter deadlines (5D) | Legal wall (5A part 2) | Deputy CoS | #52 `11f6867` | `central-admin-packaging.test.ts` | None: not merged | Court deadlines entered by staff | Not accepted: draft, review open |
| 125 | **Legal confidentiality, holds and conflicts**. Draft PR: Legal wall; director-only legal verification view | Director-only legal verification view (Arisha/Fauzan, 2 Nov) | Deputy CoS | #52 `11f6867` | `central-admin-packaging.test.ts` | None: not merged | **Open:** legal hold enforcement on files not built (hold is recorded, files are not frozen) | Not accepted: draft, review open |
| 126 | **Adviser invoices and budgets**. Draft PR: #52 `6fffc33`: yearly adviser budgets (DCoS proposes, FD agrees); audit/secretary invoices checked by FD or DCoS, never the keyer, then passed to Finance (Prima does not pay) | none recorded | Deputy CoS + FD | #52 `6fffc33` | per #52 thread: core 734, API PG 694 | None: not merged | Budget per adviser | Not accepted: draft, review open |

### 03 Branches and profit settlement

| § | Requirement | Latest amendment | Owner | Where and commit | Test evidence | Deployment proof | Missing data / integration | State |
|---|---|---|---|---|---|---|---|---|
| 145 | **Branch formation and management agreements**. Draft PR: #61 `7c0ce2f`: company manager proposes a branch; activation gate (agreement, KDN/premises/insurance refs, SQL project code, legal employer, verified company bank) | V11/V12: branch never a separate employer | COO / Operations Director | #61 `7c0ce2f` | `branch-ledger.test.ts`, `branch-ledger-pg.test.ts` | None: not merged | Real agreements and KDN refs keyed by staff. Business case + 13-week cash at formation and branch treasury (bank balance, float, payroll due, Unknown when older than 3 days: rule decided by Fauzan 3 Nov 07:42Z) added on #61 after Arisha's 3 Nov 03:32Z note; figures are recorded by Finance, no live bank read | Not accepted: draft, review open |
| 146 | **Branch rights, obligations and approval limits**. Draft PR: #61 `7c0ce2f`: step-in/step-out with reasons; manager approval with comment, no self-approval (main had the action review on sample data) | V12.1 all % flexible | COO | #61 `7c0ce2f` | `branch-ledger.test.ts`, `branch-ledger-pg.test.ts`, `branch-jv.test.ts`, `branch-jv-pg.test.ts` | None: not merged | Approval limits not set by owner. JV rules (Fauzan 4 Nov 2026) added on #61: JV Branch Manager buys from any supplier with no approval, company asks but never blocks, arms only via Arms Control, CEO sets each branch's management fee %, CEO flagged when a month's profit is under 10% of billing (see docs/BRANCHES_LEDGER.md) | Not accepted: draft, review open |
| 147 | **Branch-originated opportunity to contract**. Draft PR: #61 `7c0ce2f`: lead names the branch that found it; manager sees prospects worked by two branches; contracting stays with the company | none | Branch Manager / COO | #61 `7c0ce2f` | `branch-ledger.test.ts`, `branch-ledger-pg.test.ts` | None: not merged | none | Not accepted: draft, review open |
| 148 | **Branch accounts, payments and reconciliation**. Draft PR: #61 `7c0ce2f`: company branch bank (company's exact name), SQL project ledger, partner entity (SSM no.); adder never verifies; Finance validates and a second Finance person records payout | Controls only where money moves (2 Nov) | FD | #61 `7c0ce2f` | `branch-ledger.test.ts`, `branch-ledger-pg.test.ts` | None: not merged | Bank statements per branch; SQL ledger read waits for SQL connector (E62) | Not accepted: draft, review open |
| 149 | **Branch payroll and employer obligations**. Draft PR: #61 `7c0ce2f`: every month carries the payroll run or JA pay summary reference; company stays employer (guard pay itself stays in JA) | Guard pay stays in JA (27 Oct) | HR / FD | #61 `7c0ce2f` | `branch-ledger.test.ts`, `branch-ledger-pg.test.ts`, `branch-jv.test.ts`, `branch-jv-pg.test.ts` | None: not merged | JA pay feed. JV branch (4 Nov 2026): branch office staff pay from Prima staff payroll goes into the month's P&L; the JV Branch Manager decides branch staff leave and sets branch office staff pay (Fauzan: "Yes they set it them self"), company and HR monitor | Not accepted: draft, review open |
| 150 | **Branch as SQL project/profit centre**. Draft PR: #61 `7c0ce2f`: Finance sets a unique SQL project code per branch; no month without it | SQL Account system of record | FD | #61 `7c0ce2f` | `branch-ledger.test.ts`, `branch-ledger-pg.test.ts` | None: not merged | Real SQL Account project codes; no direct SQL read | Not accepted: draft, review open |
| 162 | **Three business models: master classification**. Sample-data screen on main: Branch model A/B/C field on sample data | V12/V12.1 three models, all % flexible | COO | main `6ea8f97` | `core.test.ts` | Staging deploy run 41382096652 (9c03cbf) + SPA 41399587980 (0ead549); no runtime UAT | Signed % per branch | Not accepted: sample data only |
| 163 | **Model A: configurable percentage of eligible billing**. Split on main (sample data); Draft PR: #61 `7c0ce2f` adds billing from cited invoice lines of signed work, credit notes, true-ups, one invoice per branch month | V12.1 | COO / FD | main `6ea8f97` + #61 `7c0ce2f` | `core.test.ts`, `branch-ledger.test.ts`, `branch-ledger-pg.test.ts` | Split only: staging per main; #61 None: not merged | Real billing lines keyed by staff | Not accepted: draft, review open |
| 164 | **Model B: company-operated branch with salary**. Sample-data screen on main: Model B appears in sample data only | V12 | COO / HR | main `6ea8f97` | none | Staging deploy run 41382096652 (9c03cbf) + SPA 41399587980 (0ead549); no runtime UAT | none | Not accepted: sample data only |
| 165 | **Model C: configurable share of agreed net profit**. Split on main (sample data); Draft PR: #61 `7c0ce2f` adds net profit = billing less every cost kind (incl. management fee, shared cost, bad debt, provisions) | V12 | COO / FD | main `6ea8f97` + #61 `7c0ce2f` | `core.test.ts`, `branch-ledger.test.ts`, `branch-ledger-pg.test.ts` | Split only: staging per main; #61 None: not merged | Net-profit definition signed | Not accepted: draft, review open |
| 166 | **Company profit versus PWVSB fees and financing**. Draft PR: Management fee screen (amounts still open) | Management fee amounts still open (2 Nov) | FD | #54 `9e24e1f` | `procurement-stock-lock.test.ts`, `gov-ops-monitor.test.ts`, `ops-guide-cards.test.ts` | None: not merged | Fee amounts | Not accepted: draft, review open |
| 167 | **Contract-based monthly distribution waterfall**. Split on main (sample data); Draft PR: #61 `7c0ce2f` prepares the month from cited lines, finished months only | V12 | FD | main `6ea8f97` + #61 `7c0ce2f` | `core.test.ts`, `branch-ledger.test.ts`, `branch-ledger-pg.test.ts` | Split only: staging per main; #61 None: not merged | Real contract billing | Not accepted: draft, review open |
| 169 | **Settlement statement, ledger agreement and sign-off**. Draft PR: #61 `7c0ce2f`: manager approves with comment, Finance validates against SQL project ledger (not preparer/approver), second Finance person pays with bank ref, return/correct history | V12 | FD / Branch Manager | #61 `7c0ce2f` | `branch-ledger.test.ts`, `branch-ledger-pg.test.ts` | None: not merged | Ledger agreement by hand until SQL connector | Not accepted: draft, review open |
| 170 | **No unauthorized branch bank or licence proxy**. Draft PR: #61 `7c0ce2f`: branch bank must be in company's exact name; partner needs SSM no., personal accounts refused; partner paid only after verification | V12 Fauzan rule: every matter controlled by the licensed company | ACT / FD | #61 `7c0ce2f` | `branch-ledger.test.ts`, `branch-ledger-pg.test.ts` | None: not merged | none | Not accepted: draft, review open |
| 157 | **Branch termination, step-in and asset recovery**. Draft PR: #61 `7c0ce2f`: six ordered closing steps with notes; close refused while a prepared month is unpaid; step-in with reasons | V11 | COO / counsel | #61 `7c0ce2f` | `branch-ledger.test.ts`, `branch-ledger-pg.test.ts` | None: not merged | Counsel template | Not accepted: draft, review open |

### 04 CRM, tenders, contracts, clients

| § | Requirement | Latest amendment | Owner | Where and commit | Test evidence | Deployment proof | Missing data / integration | State |
|---|---|---|---|---|---|---|---|---|
| 20 | **Sales CRM and tender qualifications**. Sample-data screen on main: Sales leads, tenders, joint tenders on sample data; tender document reader is a sample | Tenders tick-only, preparer then manager signs (26 Oct); file names per tender (28 Oct) | COO (private) / DOA (government) | main `6ea8f97` | `core.test.ts` | Staging deploy run 41382096652 (9c03cbf) + SPA 41399587980 (0ead549); no runtime UAT | Tender document reader is a sample | Not accepted: sample data only |
| 4 | **Contracted coverage and three billing methods**. Sample-data screen on main+Draft PR: Billing methods on sample data; billing-to-invoice in Finance PR #49 | Billing Method 1/2/3 + fixed fee | Company Manager / FD | main `9dc0f9e`; #49 `06aa7f3` | `websites.test.ts`, `finance-automation.test.ts`, `finance-cash.test.ts`, `finance-controls.test.ts` | main part: Staging deploy run 41382096652 (9c03cbf) + SPA 41399587980 (0ead549); no runtime UAT; PR part: none | Real contracts | Not accepted: draft, review open |
| 21 | **Client contract, insurance and SLAs**. Sample-data screen on main+Draft PR: Contracts on sample data; W15 expired-licence block in PR #52 | W15 hard stop: expired licence blocks new contract (2 Nov, PR #52) | Company Manager | main `03aa2a6`; #52 `ecb20f1` | `rls.test.ts`, `core.test.ts`, `central-admin-5c.test.ts` | main part: Staging deploy run 41382096652 (9c03cbf) + SPA 41399587980 (0ead549); no runtime UAT; PR part: none | Real insurance policies | Not accepted: draft, review open |
| 237 | **Statutory-checked client mobilization and first billing**. Sample-data screen on main: Mobilisation W1-W11 on sample data | Client mobilisation W1-W11 (27 Oct) | Company Manager / OM | main `6ea8f97` | `core.test.ts` | Staging deploy run 41382096652 (9c03cbf) + SPA 41399587980 (0ead549); no runtime UAT | Real sites/posts | Not accepted: sample data only |
| 25 | **Client satisfaction and account profitability**. Draft PR: Client satisfaction (PR #54); client report links (PR #61) | COO client board requested 26 Oct; satisfaction in PR #54 | COO + Company Manager | #54 `9e24e1f` | `procurement-stock-lock.test.ts`, `client-satisfaction.test.ts` | None: not merged | **Open:** no client sign-in, feedback or requests; report links need SHARE_LINK_SECRET and SHARE_LINK_BASE set, and client_accounts has no row-level security (company check is in code); satisfaction recorded by staff | Not accepted: draft, review open |
| 242 | **Client termination, transfer and final settlement**. Draft PR: Contract-end checks (Finance) | Contract-end checks (Finance PR #49) | COO / FD | #49 `95555fb` | `finance-contract-end.test.ts` | None: not merged | Final settlement with SQL Account | Not accepted: draft, review open |

### 05 Guard operations, HR, worker lifecycle

| § | Requirement | Latest amendment | Owner | Where and commit | Test evidence | Deployment proof | Missing data / integration | State |
|---|---|---|---|---|---|---|---|---|
| 5 | **Service rosters, shifts, breaks and attendance**. Sample-data screen on main: Roster/attendance screens on sample data; guards live in JA | Guards stay in JA; Prima monitors via feed (26 Oct) | OM / ROM | main `6ea8f97` | `rls.test.ts`, `core.test.ts` | Staging deploy run 41382096652 (9c03cbf) + SPA 41399587980 (0ead549); no runtime UAT | JA attendance feed not live | Not accepted: sample data only |
| 22 | **Patrolling-officer oversight and NFC guard tour**. Sample-data screen on main+Draft PR: NFC patrol on sample data; gov ops monitor in PR #54 | NFC only, no QR (24 Oct); max 60 guards per officer | Patrolling Officer / OM | main `9dc0f9e`; #54 `9e24e1f` | `rls.test.ts`, `core.test.ts`, `staff-security.test.ts`, `procurement-stock-lock.test.ts` | main part: Staging deploy run 41382096652 (9c03cbf) + SPA 41399587980 (0ead549); no runtime UAT; PR part: none | JA patrol feed; signed NFC tags | Not accepted: draft, review open |
| 38 | **Patrolling-officer field SOP**. Sample-data screen on main: Site visits with photo proof on sample data | Photo evidence with GPS/time/SHA-256 (25 Oct) | Patrolling Officer | main `6ea8f97` | `rls.test.ts`, `core.test.ts` | Staging deploy run 41382096652 (9c03cbf) + SPA 41399587980 (0ead549); no runtime UAT | JA owns guard patrol | Not accepted: sample data only |
| 6 | **HR leave, attendance and benefits**. Draft PR: Leave in full (3C), VC consent (3A) | HR governs; VC consents to staff leave (1-2 Nov) | HR | #51 `5a1eeb8` | `hr-leave.test.ts`, `hr-phase3a.test.ts`, `pilot-routing.test.ts` | None: not merged | Real leave balances | Not accepted: draft, review open |
| 7 | **Foreign-security-worker recruitment to repatriation**. Sample-data screen on main: FWM board, tasks and renewal ladder on sample data (v36); no real-use PR | FWM ladder 120/90/60/30/15/7; Nepal channel; Year 10 cap (26 Oct) | FWM Manager | main `6ea8f97` | `coo-monitors.test.ts` | Staging deploy run 41382096652 (9c03cbf) + SPA 41399587980 (0ead549); no runtime UAT | JTKSM/JIM/KDN portals manual | Not accepted: sample data only |
| 36 | **Guard licensing, training and deployment readiness**. Draft PR: Guard training/papers board (KDN card, eSIMS, CSG, TNG) | HR manages guard training papers (2 Nov) | HR (all companies) + company head | #51 `5a1eeb8` | `guard-training.test.ts`, `hr-3g-3d.test.ts` | None: not merged | JA sync back (3G partly) | Not accepted: draft, review open |
| 37 | **Office training and learning evidence**. Draft PR: Staff training records 3F | Slice 3F (2 Nov) | HR | #51 `ef33d50` | `staff-security.test.ts` | None: not merged | HRD Corp claim refs entered by staff | Not accepted: draft, review open |
| 232 | **Employee grievance and disciplinary case**. Draft PR: HR cases, show-cause, inquiry, confidential harassment (3E) | Slice 3E; discipline never automatic | HR / HR Director | #51 `5a1eeb8` | `hr-cases.test.ts` | None: not merged | Real panels | Not accepted: draft, review open |
| 240 | **Responsible recruitment and worker welfare**. Draft PR: #62 `ce58033`: arrival fee checks, agency scorecard, passport custody checks, welfare talks with follow-ups | FWM design v3 (26 Oct) | FWM | #62 `ce58033` | per #62 thread: API PG 682/682, 10 new core tests | None: not merged; new DB module `fw-welfare-v1.sql` not in release manifest, not applied | Agent audits keyed by staff; does not close wider FWM lifecycle (7) or hostel/CLQ (8) gaps | Not accepted: draft, review open |

### 06 Accommodation, transport, safety

| § | Requirement | Latest amendment | Owner | Where and commit | Test evidence | Deployment proof | Missing data / integration | State |
|---|---|---|---|---|---|---|---|---|
| 8 | **Accommodation and CLQ sourcing to closure**. Sample-data screen on main: Hostel board on sample data; JA owns hostels | Hostels in JA, Prima screens stay until JA API live (27 Oct); hostels with FWM (1 Nov) | FWM | main `6ea8f97` | `core.test.ts` | Staging deploy run 41382096652 (9c03cbf) + SPA 41399587980 (0ead549); no runtime UAT | JA hostel feed | Not accepted: sample data only |
| 9 | **Hostel electricity/water budgets and invoice controls**. Sample-data screen on main+Draft PR: Hostel bills on sample data; WhatsApp rent reminders (off) in PR #53 | No rent deduction; utilities only, legality flagged (23 Oct) | FWM / FD | main `6ea8f97`; #53 `e8fa96c` | `core.test.ts`, `rent-reminders.test.ts` | main part: Staging deploy run 41382096652 (9c03cbf) + SPA 41399587980 (0ead549); no runtime UAT; PR part: none | Real bills | Not accepted: draft, review open |
| 57 | **Fleet, vehicle utilization and transport**. Draft PR: Transport 4F: tracker endpoint, JPJ hours, consent | Driver health/dashcam can be on (1 Nov); JPJ hours apply to CIT vans | Transport head + CMS | #53 `e8fa96c` | `special-ops-4b-4h.test.ts`, `cms.test.ts` | None: not merged | Tracker vendor feed | Not accepted: draft, review open |
| 231 | **Occupational safety and site hazard response**. Draft PR: Office OSH coordinator, HIRARC, DOSH JKKP 6/7/8; site HIRARC sample only | Office OSH in PR #51 (2 Nov) | HR (office) / Ops (site) | #51 `5a1eeb8` | `hr-osh.test.ts` | None: not merged | Site HIRARC per post | Not accepted: draft, review open |

### 07 Licences, tenders, tax

| § | Requirement | Latest amendment | Owner | Where and commit | Test evidence | Deployment proof | Missing data / integration | State |
|---|---|---|---|---|---|---|---|---|
| 34 | **KDN security licence annual readiness**. Draft PR: KDN renewal calendar (5C); licence screens on sample data | Renewals by each company (2 Nov) | Company admin; Central Admin monitors | #52 `7b68b77` | `central-admin-5c.test.ts`, `central-admin-review.test.ts` | None: not merged | KDN portal manual | Not accepted: draft, review open |
| 35 | **MOF and ePerolehan renewal**. Draft PR: MOF/vendor renewals (5C) | 5C vendor renewals (2 Nov) | Company admin | #52 `089937c` | `central-admin-5c.test.ts` | None: not merged | ePerolehan manual | Not accepted: draft, review open |
| 234 | **Corporate, employer and employment tax**. Draft PR: Tax calendar, WHT (Finance); CP22/EA/Borang E filings (HR 3B) | No tax agent, use published law (2 Nov) | FD / HR | #49 `f738ee7`; #51 `5a1eeb8` | `finance-phase2.test.ts`, `finance-hostel-link.test.ts`, `finance-regular.test.ts`, `hr-guide-cards.test.ts` | None: not merged | e-PCB check by Finance | Not accepted: draft, review open |
| 244 | **Cross-company statutory and contract calendar**. Draft PR: Cross-company deadline calendar (5C) | 5C (2 Nov) | DCoS monitors | #52 `7b68b77` | `central-admin-5c.test.ts`, `central-admin-5d.test.ts`, `central-admin-5e.test.ts` | None: not merged | Real dates | Not accepted: draft, review open |

### 08 SQL Account finance control

| § | Requirement | Latest amendment | Owner | Where and commit | Test evidence | Deployment proof | Missing data / integration | State |
|---|---|---|---|---|---|---|---|---|
| 69 | **Accounting ledger system-of-record principles**. Draft PR: SQL Account kept as ledger; Prima holds document numbers and checks | V6: SQL Account is system of financial record | FD | #49 `06aa7f3` | `finance-automation.test.ts`, `finance-controls.test.ts`, `finance-moneyin.test.ts` | None: not merged | No live SQL connector (E62) | Not accepted: draft, review open |
| 70 | **Utilize native SQL Account functionality**. Draft PR: Finance checks on SQL Account usage (pasted data) | Prima ensures full use of SQL Account (27 Oct) | FD | #49 `06aa7f3` | `finance-automation.test.ts`, `finance-controls.test.ts`, `finance-moneyin.test.ts` | None: not merged | SQL usage monitor uses pasted data | Not accepted: draft, review open |
| 71 | **SQL edition, modules, integration and accounting data**. Draft PR: #49 `0ceb488`: read-only SQL Account connector interface, switched off; nothing calls SQL Account; reads gated on confirmed set-up, API access and approved mapping, each read checked once and journalled | Discovery questions V6-1..12 | FD / IT Lead | #49 `0ceb488` | `finance-ledger.test.ts` (7); browser check /mnt/project-files/finance/uat-2026-11-03/ | None: not merged; connector off | **Open:** interface only, switched off; no live SQL Account reader; edition and API per company not confirmed | Not accepted: draft, review open; connector not connected |
| 72 | **Chart of accounts and cost dimension mapping**. Draft PR: #49 `0ceb488`: company SQL codes to group lines, one ledger code per bank account, contract-to-project codes; FD or CEO approves (never proposer); monthly versions | V6 | FD | #49 `0ceb488` | `finance-ledger.test.ts` (7); browser check /mnt/project-files/finance/uat-2026-11-03/ | None: not merged | Real chart and project codes; FD to decide if a missing mapping blocks close | Not accepted: draft, review open |
| 73 | **Mandatory bank reconciliation**. Draft PR: Automatic bank reconciliation vs pasted SQL ledger | Automatic bank reconciliation vs SQL export (1 Nov) | FD + teams | #49 `06aa7f3` | `finance-phase2.test.ts`, `finance-controls.test.ts` | None: not merged | Bank feeds; staff paste SQL ledger | Not accepted: draft, review open |
| 74 | **Customer aging and collections**. Draft PR: Monthly ageing, invoice cases, bad debt | Bad debt 90/180 days; FD/CEO write-off (1 Nov) | FD | #49 `161eee8` | `finance-phase2.test.ts`, `receipts.test.ts`, `finance-automation.test.ts` | None: not merged | SQL ageing pasted | Not accepted: draft, review open |
| 75 | **Supplier aging and payment obligations**. Draft PR: Regular payments, supplier statements top 10 | Regular payments list (2 Nov) | FD | #49 `95b8374` | `finance-group9.test.ts`, `staff-zakat.test.ts` | None: not merged | SQL AP pasted | Not accepted: draft, review open |
| 76 | **Profit and loss, balance sheet and cash-flow agreement**. Draft PR: #49 `0ceb488`: FS-01..FS-12 from figures Finance records from SQL reports, reviewed by someone other than the recorder; FS-01/02/06 block close, others are close exceptions; FS-11 from intercompany pairs | V6 | FD | #49 `0ceb488` | `finance-ledger.test.ts` (7); browser check /mnt/project-files/finance/uat-2026-11-03/ | None: not merged | Real SQL report figures | Not accepted: draft, review open |
| 77 | **Financial close and independent review**. Draft PR: Month-end close with independent review | Close blocked while SQL stale or bank not reconciled (31 Oct) | FD / CEO | #49 | none | None: not merged | SQL close status manual | Not accepted: draft, review open |
| 78 | **Budgets, scenario plans and 13-week cash forecast**. Draft PR: Budget, rolling forecast and 13-week cash forecast (finance-forecast13.ts) | 13-week forecast built (finance-forecast13.ts, PR #49) | FD | #49 `06aa7f3` | `finance-answers.test.ts`, `finance-automation.test.ts`, `finance-controls.test.ts` | None: not merged | **Open:** three-statement (P&L, balance sheet, cash-flow) forecasts and approved budget revision workflow not confirmed built; 13-week cash forecast is built. Real budget inputs | Not accepted: draft, review open |
| 79 | **Accounting links to inventories and fixed assets**. Sample-data screen on main+Draft PR: Depreciation journals on sample data; fixed assets in Finance year-end | Depreciation journals for SQL Account (27 Oct) | FD / Asset | main `6ea8f97`; #49 `a602127` | `core.test.ts` | main part: Staging deploy run 41382096652 (9c03cbf) + SPA 41399587980 (0ead549); no runtime UAT; PR part: none | Capital allowance rates Unverified | Not accepted: draft, review open |
| 80 | **Group Finance dashboards and operating scorecards**. Draft PR: Finance dashboard and key numbers; Power BI deferred | Key numbers on FD/CEO/COO home; Unknown not zero (2 Nov) | FD / CEO | #49 `b12ac54` | none | None: not merged | Power BI deferred | Not accepted: draft, review open |

### 09 Procurement, inventory, assets

| § | Requirement | Latest amendment | Owner | Where and commit | Test evidence | Deployment proof | Missing data / integration | State |
|---|---|---|---|---|---|---|---|---|
| 49 | **Purchase request to verified payment**. IT pilot code on main+Sample-data screen on main: IT purchase route on main (pilot); group purchasing on sample data | 3 quotes + online price (5% tolerance); purchases paid only against posted 3-way match (2 Nov) | Procurement exec / COO+CEO | main `6ea8f97` | `core.test.ts` | Staging deploy run 41382096652 (9c03cbf) + SPA 41399587980 (0ead549); no runtime UAT | Supplier bank verification by FD (G8) | Not accepted: staff UAT pending |
| 53 | **Procurement policy and sourcing methods**. IT pilot code on main: 3 quotes + online comparison in IT procurement (main) | 3 quotes + dated online comparison | Procurement | main `6b80964` | `procurement-rls.test.ts`, `it-procurement.test.ts` | Staging deploy run 41382096652 (9c03cbf) + SPA 41399587980 (0ead549); no runtime UAT | none | Not accepted: staff UAT pending |
| 54 | **Central and regional warehouse, uniform inventory**. Draft PR: Goodwill store, issue/return locks, signed receipt chain | Goodwill owns and bills all guard equipment (2 Nov) | Inventory / Goodwill store | #54 `b5a255f` | `procurement-stock-lock.test.ts`, `gov-procurement-golive.test.ts` | None: not merged | Opening stock witnessed count | Not accepted: draft, review open |
| 55 | **Returnable equipment and fixed-asset register**. IT pilot code on main+Draft PR: IT asset register (pilot); non-IT asset 4G in PR #53 | IT assets live pilot; rentals by manager-set rates | Asset / IT | main `6ea8f97`; #53 `4007d85` | `it-operations.test.ts`, `core.test.ts` | main part: Staging deploy run 41382096652 (9c03cbf) + SPA 41399587980 (0ead549); no runtime UAT; PR part: none | Non-IT asset register data | Not accepted: draft, review open |
| 56 | **Technology rollout, site asset custody**. IT pilot code on main: IT asset custody, issue/return (pilot) | Devices kept at site and shared (23 Oct) | IT / OM | main `35b7f9f` | `rental-corrections.test.ts` | Staging deploy run 41382096652 (9c03cbf) + SPA 41399587980 (0ead549); no runtime UAT | Real devices | Not accepted: staff UAT pending |
| 58 | **Company property, rentals and hostel assets**. IT pilot code on main+Draft PR: IT rentals and inspections (pilot); asset/hostel 4G in PR #53 | Asset Mgmt own system feeds Prima by API (26 Oct) | Asset Mgmt dept / IT | main `3d7433b`; #53 `c23806a` | `it-cleanup-catalog.test.ts`, `it-cleanup-rls.test.ts`, `it-cleanup-service-pg.test.ts`, `rent-reminders.test.ts` | main part: Staging deploy run 41382096652 (9c03cbf) + SPA 41399587980 (0ead549); no runtime UAT; PR part: none | Asset Mgmt developer API | Not accepted: draft, review open |
| 59 | **Planned maintenance, repairs and work orders**. IT pilot code on main: IT maintenance with locked history (pilot) | Six-month inspection plan (IT pilot) | IT / Asset | main `587b15d` | `it-cleanup-rls.test.ts`, `it-cleanup-service-pg.test.ts`, `it-maintenance-route.test.ts` | Staging deploy run 41382096652 (9c03cbf) + SPA 41399587980 (0ead549); no runtime UAT | Non-IT work orders | Not accepted: staff UAT pending |
| 60 | **Stock transfers, loss, theft and disposal**. Draft PR: Loss confirmation never own; disposal on sample data | Loss confirmed never by own (2 Nov) | Inventory Manager | #54 | none | None: not merged | none | Not accepted: draft, review open |
| 61 | **Insurance and warranty response**. Sample-data screen on main: Insurance screen on sample data | none | Asset / FD | main `587b15d` | `it-cleanup-rls.test.ts`, `it-cleanup-service-pg.test.ts`, `it-corrections-sql.test.ts` | Staging deploy run 41382096652 (9c03cbf) + SPA 41399587980 (0ead549); no runtime UAT | Claim steps added on #61 (synthetic tests); **Open:** warranty claims; insurer contacts; staff UAT | Not accepted: sample data only |
| 239 | **Supplier and subcontractor assurance**. Sample-data screen on main: Supplier steps on sample data; FD bank verification gap G8 | FD verifies supplier bank before quoting (G8) | Procurement / FD | main `6ea8f97` | `core.test.ts` | Staging deploy run 41382096652 (9c03cbf) + SPA 41399587980 (0ead549); no runtime UAT | Real supplier documents | Not accepted: sample data only |

### 10 PWVSB financing and collateral

| § | Requirement | Latest amendment | Owner | Where and commit | Test evidence | Deployment proof | Missing data / integration | State |
|---|---|---|---|---|---|---|---|---|
| 103 | **KPKT licensing: verification gate**. Draft PR: #52 `6fffc33`: DCoS records PWVSB KPKT licence check per loan (number, valid-to, how checked); unchecked/invalid shown only in directors' legal flags | Credit moved to Central Admin 5G (1 Nov) | DCoS / counsel | #52 `6fffc33` | per #52 thread: core 734, API PG 694, browser 28/28 | None: not merged | Real PWVSB KPKT licence not keyed | Not accepted: draft, review open |
| 104 | **Financing case, drawdown and repayment**. Draft PR: Credit loans/repayments (5G) | 5G (PR #52) | FD / DCoS | #52 `11f6867` | `central-admin-5g.test.ts`, `central-admin-review.test.ts` | None: not merged | Real loans | Not accepted: draft, review open |
| 105 | **Loan accounting and borrower-lender reconciliation**. Draft PR: Credit board (5G); SQL ledger link missing | 5G | FD | #52 `7b68b77` | `central-admin-5g.test.ts`, `central-admin-guide.test.ts`, `central-admin-review.test.ts` | None: not merged | SQL loan ledger | Not accepted: draft, review open |
| 134 | **Collateral is security, not present ownership**. Draft PR: Collateral records only, never ownership | V10 collateral only, never ownership | DCoS / counsel | #52 `ecb20f1` | `central-admin-5g.test.ts`, `central-admin-review.test.ts`, `central-admin-browser-uat.mjs` | None: not merged | Counsel | Not accepted: draft, review open |
| 135 | **Default automatically triggers a process, not a transfer**. Draft PR: Default opens a case; enforcement off | Default opens case only; enforcement off | DCoS | #52 `2270652` | `central-admin-rollout.test.ts`, `central-admin-5a.test.ts` | None: not merged | Counsel | Not accepted: draft, review open |
| 136 | **Notices, legal reviews and lawful enforcement**. Draft PR: Enforcement steps 7-9 off until counsel | Steps 7-9 off until counsel | DCoS / counsel | #52 `ecb20f1` | `central-admin-packaging.test.ts` | None: not merged | Counsel | Not accepted: draft, review open |
| 138 | **Default and cure determination with ledger evidence**. Draft PR: Dispute/cure records (5G) | V10 | FD / DCoS | #52 `7b68b77` | `central-admin-5g.test.ts`, `central-admin-review.test.ts` | None: not merged | Ledger evidence | Not accepted: draft, review open |

### 11 Central Monitoring System

| § | Requirement | Latest amendment | Owner | Where and commit | Test evidence | Deployment proof | Missing data / integration | State |
|---|---|---|---|---|---|---|---|---|
| 182 | **Federated multi-company monitoring scope**. Draft PR: CMS app directory push from Prima; CMS wall | CMS monitors, company controls (V13/V15) | Arms Control Manager (CMS under Arms Control) | #53 `eeb62a8` | `cms.test.ts`, `special-ops-4b-4h.test.ts`, `special-ops-guide.test.ts` | None: not merged | Real site directory push | Not accepted: draft, review open |
| 183 | **24-hour duty operator and shift handover**. Sample-data screen on main: CMS roster and handover on sample data | 1 Head Control + 1 Monitor per shift (25 Oct) | Head Control | main `6ea8f97` | `rls.test.ts`, `core.test.ts` | Staging deploy run 41382096652 (9c03cbf) + SPA 41399587980 (0ead549); no runtime UAT | Real roster | Not accepted: sample data only |
| 184 | **Live guard coverage and attendance**. Draft PR: No-show alerts from JA feed in CMS app | PIC alert every 5 min until acted (25 Oct) | CMS / OM | #53 `7056c2b` | `cms.test.ts` | None: not merged | JA attendance feed | Not accepted: draft, review open |
| 185 | **Supervisor patrols and NFC guard tours**. Draft PR: Missed checkpoint alerts in CMS app | NFC only | CMS | #53 `4007d85` | `cms.test.ts` | None: not merged | JA patrol feed | Not accepted: draft, review open |
| 186 | **CCTV, recording health and AI analytics**. Draft PR: Device health (unknown never green); no CCTV vendor link | Device never heard = unknown, never green (PR #53) | CMS | #53 `337242b` | `special-ops-4b-4h.test.ts` | None: not merged | CCTV vendor list not supplied | Not accepted: draft, review open |
| 187 | **ANPR, barrier gates, turnstiles and access control**. Draft PR: ANPR adaptor; CMS never opens gates | CMS never opens gates (PR #53) | CMS | #53 `eeb62a8` | `cms.test.ts`, `cms-close-dialog-uat.cjs` | None: not merged | ANPR/VMS vendor feeds | Not accepted: draft, review open |
| 188 | **Panic, sensor and infrastructure alarms**. Draft PR: SIA DC-09 adaptor; encrypted frames refused | DC-09 adaptor; encrypted frames refused until keys | CMS | #53 `4007d85` | `cms.test.ts`, `special-ops-4b-4h.test.ts` | None: not merged | Panel keys; alarm vendors | Not accepted: draft, review open |
| 189 | **Event correlation, dispatch and incident handling**. Draft PR: Routing and escalation; close needs real/false + note | Escalation OM->ROM->OGM/OD->COO->CEO | CMS operator | #53 `7056c2b` | `cms.test.ts` | None: not merged | SMS/voice provider | Not accepted: draft, review open |
| 190 | **CMS dashboard and response queue**. Draft PR: Operator dashboard (CMS app) | Separate CMS app (2 Nov) | CMS | #53 | none | None: not merged | Hosting not approved | Not accepted: draft, review open |
| 191 | **CMS activation during client onboarding**. Draft PR: #53 `e1a8b2a`: W12 CMS activation step in client onboarding | none | CMS / Company Manager | #53 `e1a8b2a` | per #53 thread; docs/SPECIAL_OPS_REVIEW_BUNDLE.md "Masterplan items built 3 Nov" | None: not merged | none | Not accepted: draft, review open |
| 192 | **Device integration contracts and event schema**. Draft PR: Signed common event format (HMAC) | Signed common event format (PR #53) | IT Lead | #53 `e8fa96c` | none | None: not merged | Brand profiles | Not accepted: draft, review open |
| 193 | **CMS cybersecurity, evidence and resilience**. Partly built: #53 `e1a8b2a` CMS file store built; DB store and Entra operator sign-in still plan only | Durability + operator sign-in plan doc (PR #53) | IT Lead | #53 `e1a8b2a` | `rls.test.ts`, `core.test.ts`; per #53 thread; docs/SPECIAL_OPS_REVIEW_BUNDLE.md "Masterplan items built 3 Nov" | None: not merged | **Open:** CMS DB store, Entra operator sign-in, and real device/provider acceptance not established | Not accepted: partial |
| 195 | **CMS coverage and response performance indicators**. Draft PR: #53 `e1a8b2a`: CMS coverage and response KPIs | none | Arms Control Manager | #53 `e1a8b2a` | per #53 thread; docs/SPECIAL_OPS_REVIEW_BUNDLE.md "Masterplan items built 3 Nov" | None: not merged | Live events | Not accepted: draft, review open |

### 12 Arms Control

| § | Requirement | Latest amendment | Owner | Where and commit | Test evidence | Deployment proof | Missing data / integration | State |
|---|---|---|---|---|---|---|---|---|
| 201 | **Applicable KDN/PDRM authority and scope checks**. Draft PR: Licence checks; A-licence holder authorises | Company A-licence holder authorises arms requests (1 Nov) | Arms Control Manager | #53 `268e382` | `special-ops-4b-4h.test.ts` | None: not merged | Real licences | Not accepted: draft, review open |
| 203 | **Controlled arms, ammunition and custodian records**. Draft PR: Full arms register incl. ammunition (4B) | 4B full register (PR #53) | Arms Control | #53 `268e382` | `special-ops.test.ts`, `special-ops-4b-4h.test.ts` | None: not merged | Real serials (Arms Control only) | Not accepted: draft, review open |
| 204 | **Approved armoury/vault and physical verification**. Draft PR: Vault counts, vault watch | Vault watch 60 min; RFID compulsory 30 days after tagging (1 Nov) | Arms Control | #53 `268e382` | `special-ops.test.ts`, `cms.test.ts`, `special-ops-4b-4h.test.ts` | None: not merged | RFID tags at pilot vault | Not accepted: draft, review open |
| 205 | **Authorization-to-disposal firearm lifecycle**. Draft PR: Firearm lifecycle (4B) | 4B | Arms Control | #53 `4007d85` | `special-ops-4b-4h.test.ts` | None: not merged | Police notices manual | Not accepted: draft, review open |
| 206 | **Armed guard and shift readiness**. Draft PR: ARMS-LOCAL-ONLY, armed post readiness | Foreign guards never armed (2 Nov) | Arms Control / OM | #53 `268e382` | `special-ops-4b-4h.test.ts`, `special-ops.test.ts` | None: not merged | none | Not accepted: draft, review open |
| 207 | **Custody and movement authorization trail**. Draft PR: Witnessed issue/return, overdue ladder | Witnessed issue/return; ARMS-OVERDUE 15/30/120 | Arms Control | #53 `4007d85` | `special-ops-4b-4h.test.ts`, `special-ops.test.ts` | None: not merged | none | Not accepted: draft, review open |
| 208 | **Ammunition accountability and discrepancies**. Draft PR: Ammunition accountability (4B) | 4B | Arms Control | #53 `268e382` | `special-ops.test.ts`, `special-ops-4b-4h.test.ts` | None: not merged | Real counts | Not accepted: draft, review open |
| 210 | **Armed-service supervision and SOP assurance**. Draft PR: Arms requests 4C | 4C/4D | Arms Control | #53 `4007d85` | `rls.test.ts`, `core.test.ts` | None: not merged | none | Not accepted: draft, review open |
| 211 | **Serious incident and statutory-notification assessment**. Draft PR: Police notices (4B) | 4B police notices | Arms Control | #53 `ffa24b1` | none | None: not merged | none | Not accepted: draft, review open |
| 212 | **Armed-client onboarding and coverage**. Draft PR: Armed jobs + CIT readiness (4D) | 4D armed jobs + CIT readiness | Arms Control / COO | #53 `268e382` | `special-ops-4b-4h.test.ts`, `special-ops.test.ts` | None: not merged | none | Not accepted: draft, review open |
| 221 | **Arms Control departmental ownership vs CMS monitoring**. Draft PR: Arms wall vs CMS wall | Arms Control coordinates, company authorises, CMS monitors (V15) | Arms Control / CMS | #53 `4007d85` | `special-ops-4b-4h.test.ts`, `special-ops.test.ts` | None: not merged | none | Not accepted: draft, review open |
| 222 | **Vault CCTV, recording continuity and alert escalation**. Draft PR: Vault door 15 min rule; vault CCTV feed not connected | 15 min door rule (1 Nov) | Arms Control | #53 `4007d85` | `core.test.ts` | None: not merged | Vault CCTV feed | Not accepted: draft, review open |
| 224 | **Armed-client insurance, service pricing and contracts**. Draft PR: Armed/CIT cover check on Arms Control board | Armed cover on Arms Control board (PR #53) | Arms Control / CoS | #53 `4007d85` | `special-ops.test.ts` | None: not merged | Real policies | Not accepted: draft, review open |
| 225 | **Future firearms buying/selling: disabled until authorized**. Draft PR: Trading flow behind CEO-only switch, off (4H) | Trading off until CEO go-live; mechanism ready (1 Nov) | CEO switch | #53 `c23806a` | `special-ops-4b-4h.test.ts`, `special-ops.test.ts` | None: not merged | Counsel/PDRM on trade stock | Not accepted: draft, review open |

### 13 Integrity, privacy, crisis, audit

| § | Requirement | Latest amendment | Owner | Where and commit | Test evidence | Deployment proof | Missing data / integration | State |
|---|---|---|---|---|---|---|---|---|
| 233 | **Anti-corruption, gifts, tender integrity and whistleblowing**. Sample-data screen on main+Draft PR: Gifts, speak-up on sample data; ACT department PR #55 | ACT dept + 2 teams (PR #55) | ACT | main `8822cfd`; #55 `deb3d3c` | `arisha-context.test.ts`, `core.test.ts` | main part: Staging deploy run 41382096652 (9c03cbf) + SPA 41399587980 (0ead549); no runtime UAT; PR part: none | none | Not accepted: draft, review open |
| 235 | **National incident command and continuity**. Sample-data screen on main+Draft PR: BCM board on sample data; go-live check + restore drill script in PR #56 | BCM 4 systems x copies; Malaysia rule dropped (28 Oct) | IT + group leadership | main `9dc0f9e`; #56 | `core.test.ts`, `staff-security.test.ts` | main part: Staging deploy run 41382096652 (9c03cbf) + SPA 41399587980 (0ead549); no runtime UAT; PR part: none | No real backups yet | Not accepted: draft, review open |
| 236 | **Personal data, cybersecurity and breach notification**. Sample-data screen on main: PDPA board, requests, DPO register on sample data; Phase 6 | PDPA to Phase 6; DPO + DPIA approved (1 Nov) | PDPA officer | main `0f74fff` | `staff-security.test.ts`, `core.test.ts` | Staging deploy run 41382096652 (9c03cbf) + SPA 41399587980 (0ead549); no runtime UAT | DPIA; pen test | Not accepted: sample data only |
| 238 | **Risk-based independent internal audits**. Draft PR: ACT audits, findings, reports, field checks | ACT reports + field checks (PR #55) | ACT Director | #55 `3ade20c` | `act-report-form-pg.test.ts` | None: not merged | none | Not accepted: draft, review open |
| 241 | **Fraud anomalies, investigations and forensic controls**. Draft PR: #55 `81e58f8`: ACT-FRAUD anomaly finder (5 fixed checks), investigations with SHA-256 evidence and custody log, Director-only close; insider fix 16 done, 13 partly (reused clock photo refused; server face scoring needs a face provider) | Insider abuse fixes 1-12,14,15 merged (28 Oct) | ACT | #55 `81e58f8` | per #55 thread: core 694, API PG 682, browser 11/11 (demo) | None: not merged | Face provider for fix 13 | Not accepted: draft, review open |
| 243 | **Emergency delegation and succession**. Draft PR: #52 `6fffc33`: delegation register approved by CEO or CoS (never recorder or delegate), grants no access; new DB module `central_admin_delegations` (release owner must regenerate ops bundle) | none | CEO / CoS | #52 `6fffc33` | per #52 thread: core 734, API PG 694 | None: not merged | Delegation matrix not entered; migration not run | Not accepted: draft, review open |

## Updates after first save

- 3 Nov 2026 ~00:30Z: chapter 03 rows corrected (main already had the A/B/C split on sample data) and updated for draft PR #61 `7c0ce2f` (branch lifecycle and month ledger). Rows 103, 126, 243 updated for draft PR #52 `6fffc33` as reported by the Central Admin thread. Headline counts in section 2 were not recounted.
- 3 Nov 2026 ~00:35Z: row 240 updated for draft PR #62 `ce58033` (FWM thread) and row 241 for draft PR #55 `81e58f8` (ACT thread). PR #61 headless browser check on the demo build: Branches opens for company manager, branch manager and CEO at 1280/390 px with no page errors or sideways scroll; company manager proposed a branch, saw the activation gaps and saved papers. Not phone UAT by staff.
- 3 Nov 2026 ~00:35Z: rows 71, 72, 76 updated for draft PR #49 `0ceb488` (Finance thread). Stale 13-week rows in docs/FINANCE_PHASE2.md fixed at 2b69001.
- 3 Nov 2026 ~00:36Z: rows 191, 193 (partial), 195 updated for draft PR #53 `e1a8b2a` (Special Ops thread).


</details>
