# Director Office and company secretary: study gaps (23 Nov 2026)

Owner decisions: Fauzan, 23 Nov 2026, on the study note "Director Office and company secretary" (answers "1. Yes 2. Yes
3. Yes. Dcos also can key in on behalf 4. Yes. Do the gap"). Source in the repository is not deployment, migration or
operational acceptance.

## What changed

| # | Gap | What Prima does now | Code |
| --- | --- | --- | --- |
| B1 | No company file was ever made outside the test data, so on a real database the Company secretary screen was empty and "save company file" failed. | When Corporate Admin (the Deputy Chief of Staff, the Chief of Staff or the named filing executive) opens the board, every company without a file gets one made from its company record: SSM number and incorporation date, year end month December (the group's year ends 31 December). Nothing else is invented. The company file form now takes the incorporation date, the year end month, the secretary firm, its licence and the auditor. | `packages/core/src/corp-year.ts`, `ensureCorpYear` in `service.ts`, `CompanyFile.tsx` |
| B2 | Annual return and financial statements filings existed only in test data. | Prima opens the annual return 90 days before it is due (30 days after the anniversary) and the financial statements filing from the year end (circulate within 6 months, lodge within 30 days). A filing missed by more than 60 days is not reopened (it went before Prima). Never opened twice. Audit line `corp.year.opened`, opened by "Prima". | same |
| B3 | Yearly audits existed only in test data; a signed audit did not move the financial statements. | Prima opens the audit of each year end with the auditor on the company file and the standard papers list. The financial statements filing shows "Audit signed: ready to circulate" or "Audit not signed yet". | same, `fsReadiness` |
| B4 | The Director Office page still led with tenders. | The DOA's own work comes first: weekly digest, CEO instructions, legal flags, reports and meetings counter, cash lists. Tenders follow; once the Marketing desk has started they are headed "monitor only (Marketing runs the bids)". | `DirectorOffice.tsx`, `tenderBoard().marketingDeskOn` |
| B5 | On the Reports board a company counted as "on the app" only with the old pilot mark, so any other company showed Unknown forever. | A company with an open company manager or admin executive sign-in is on the app (missing or late shows); a company with nobody signed in still shows unknown, never compliant. Same on the ACT report monitor and the Director Office counter. | `companiesOnApp` in `service.ts` |
| B6 | The Director Office KPIs and ACT's check list still counted tenders. | New Work KPI adapter `director-office-desk`: minutes of a Director Office meeting from the meeting end (proposed target 3 office days) and the check of a minutes summary (proposed 1 office day). ACT's checks for the Director Office: reports received, meetings and minutes, CEO instructions. | `work-kpi-director-office.ts`, rule RPT-MONTHLY |
| B7 | The filing type "Other" could not be opened. | Corporate Admin opens another filing (what, due date, legal basis) on the Filings tab. `POST /api/corporate/filings`. | `openCorpFiling` |

## Decisions built

- **D1** The Chief of Staff stands in for the Deputy Chief of Staff on the Company secretary screen while the Deputy is
  on approved leave (approve or reject corporate changes, record filing steps, check company files, open filings). The
  screen says so and every audit line adds "Chief of Staff standing in for the Deputy Chief of Staff on leave". The
  Deputy names one Chief of Staff office executive per company (or for every company) to record filing steps
  (`GET/POST /api/corporate/filing-exec`, with a reason). That executive never approves a change, checks a company file
  or opens a filing, sees only the companies they are named for, and needs a company access line for each company
  (Accounts and Access). Chief of Staff office staff now pass the corporate data wall so the named executive can work;
  the service still shows each person only what their role allows.
- **D2** Only the Director Office Administrator (the head of the Director Office on the organisation chart) and the CEO
  change the list of reports due. Until a head of the Director Office is named, the Director Office's own staff keep it
  (the office is the Administrator). A director sign-in no longer changes it.
- **D3** The company secretary firm keys in its own lodgement (MBRS reference) and the SSM receipt for the companies it
  serves; it does not mark papers ready. The Deputy (and the named executive) can still key in on its behalf.
- **D4** The audit is signed within 5 months of the year end (rule COR-SECRETARY, now the owner's decision).

## Database

No new database module and no SQL change. Company files, filings and audits use the existing `corp_profiles`,
`corp_filings` and `corp_audits` tables; the new fields (`fyEnd`, `openedBy`, `filingExec`) live in the record's data.
The corporate wall is computed by the API from the sign-in (`seesCorporate`), so the Chief of Staff office change needs
no migration. Module `central-admin-walls-v1` (already on the run list) still adds the restrictive wall.

## Not changed

- Home reminders for report senders come with draft PR #161 (monthly reports made by Prima).
- Prima never lodges, signs or files anything; a filing stays awaiting acknowledgement until the SSM receipt is in.
