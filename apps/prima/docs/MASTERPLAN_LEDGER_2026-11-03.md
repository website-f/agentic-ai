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
| 146 | **Branch rights, obligations and approval limits**. Draft PR: #61 `7c0ce2f`: step-in/step-out with reasons; manager approval with comment, no self-approval (main had the action review on sample data) | V12.1 all % flexible | COO | #61 `7c0ce2f` | `branch-ledger.test.ts`, `branch-ledger-pg.test.ts` | None: not merged | Approval limits not set by owner | Not accepted: draft, review open |
| 147 | **Branch-originated opportunity to contract**. Draft PR: #61 `7c0ce2f`: lead names the branch that found it; manager sees prospects worked by two branches; contracting stays with the company | none | Branch Manager / COO | #61 `7c0ce2f` | `branch-ledger.test.ts`, `branch-ledger-pg.test.ts` | None: not merged | none | Not accepted: draft, review open |
| 148 | **Branch accounts, payments and reconciliation**. Draft PR: #61 `7c0ce2f`: company branch bank (company's exact name), SQL project ledger, partner entity (SSM no.); adder never verifies; Finance validates and a second Finance person records payout | Controls only where money moves (2 Nov) | FD | #61 `7c0ce2f` | `branch-ledger.test.ts`, `branch-ledger-pg.test.ts` | None: not merged | Bank statements per branch; SQL ledger read waits for SQL connector (E62) | Not accepted: draft, review open |
| 149 | **Branch payroll and employer obligations**. Draft PR: #61 `7c0ce2f`: every month carries the payroll run or JA pay summary reference; company stays employer (guard pay itself stays in JA) | Guard pay stays in JA (27 Oct) | HR / FD | #61 `7c0ce2f` | `branch-ledger.test.ts`, `branch-ledger-pg.test.ts` | None: not merged | JA pay feed | Not accepted: draft, review open |
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
