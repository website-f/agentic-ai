# FWM department check: gaps built

Fauzan, 23 Nov 2026: "Do the gap" on the FWM department check (study note "FWM department check (23 Nov 2026)"). That
covers the five gaps to build now (B1-B5) and the four decisions, taken as recommended (D1-D4). Source only. Nothing
here is merged, migrated or deployed until Fauzan says so.

## What was built

| # | What | Where | Rule |
|---|---|---|---|
| B1 | **Load dates.** FWM loads the paper dates it already keeps (PLKS, passport, FOMEMA, insurance, SPIKPA, KDN letter) from a CSV file or cells pasted from Excel. It checks the preview and then presses Load. A loaded date shows as "From the list, copy not seen" and the ladder runs on it at once. Recording the copy with the same dates (New paper received) confirms it. A list never replaces a date recorded from a copy, a later date, or a paper issued after the list's. Up to 3,000 rows at a time. | Foreign workers > Load dates | FWM-BULK-LOAD |
| B2 | **Hostel certificate reminders.** FWM records each certificate (number, issue and expiry date, optional photo, reason) with Record certificate on the Hostels screen. The accommodation certificate (Act 446) is reminded 90, 60 and 30 days before it expires. Expired shows red. FWM sees it on Do today (top of Foreign workers) and in the Hostel certificates tab. The owning company's manager sees it on their home page. It is a reminder, never a block. | Foreign workers > Hostel certificates; company manager home | FWM-HOSTEL-CERT |
| B3 | **Levy.** The levy paid (amount, date, receipt or FWCMS reference) is recorded with the work permit renewal, or afterwards with Record levy paid. A renewal without it shows "Levy not recorded". A change needs a reason. | Papers > Renewal submitted / Record levy paid | FWM-LEVY |
| B4 | **Exit files.** There is one file per leaver: the reason, last day, check-out memo, flight (when the worker goes home), and the reports to the Labour Department and to Immigration with their proof. The report due date is 30 days for contract end, year 10 or going home, and 14 days for resigning, absconding, termination or death. These days are **Unverified** and must be confirmed before go-live. A file closes only when everything is on record and the last day has passed. A closed file whose staff record is still active is flagged. | Foreign workers > Leavers and missing | FWM-EXIT (Unverified) |
| B5 | **Who owns which company.** The FWM Manager gives each company to an FWM Executive, or to the Deputy or the Manager. Each paper on the board names its owner, and an Executive can filter to "My companies". The Manager and the Deputy can still act on any worker. | Foreign workers > Who owns which company | FWM-CASELOAD |
| D1 | **Levy on the debit note.** When another company or branch used the worker, its share of the levy (levy / 12 x days used / days in the month) is added to the same EPF/SOCSO debit note and repaid with it. The share comes from the levy recorded on a PLKS renewal paid in the 12 months before the month. | Nepali EPF/SOCSO | FWM-LEVY |
| D2 | **Missing workers.** The OM, the company manager or FWM raises a case only after 3 days missing with no contact, and says how they tried to reach the worker. FWM records the police report and the Immigration notice with copies, and an exit file then opens on its own. If the worker turns up, FWM or whoever raised the case closes it as found. Nothing is automatic, and Prima never marks a worker as absconded by itself. | Foreign workers > Leavers and missing (OMs: Missing worker) | FWM-ABSCOND |
| D3 | **Quotas.** This is a light tracker of each company's quota applications (KESUMA eQuota). It records the application, then approved (the letter is required) or rejected, the places and places used, and the expiry: 12 months from approval unless the letter says otherwise. While places are still unused, Do today reminds FWM at 90, 60 and 30 days. | Foreign workers > Quotas | FWM-QUOTA |
| D4 | **fw-moves-v1** (moves and hostel needs) goes on the after-merge run list together with the new module below. | Go-live run list | |

## Who can do what (enforced in the service)

| Action | Who | Refused for |
|---|---|---|
| Load dates, record levy, exit files, quotas, police and Immigration reports | FWM Manager, Deputy, Executives | Despatch, OMs, company managers, HR, leaders |
| Raise a missing worker | OM, company manager (own company), FWM | Despatch; another company |
| Close a missing-worker case as found | FWM, or whoever raised it | Others |
| Set the caseload | FWM Manager only | Deputy, Executives, everyone else |
| See exit files and quotas | FWM, group leaders; company manager (own company) | OM (sees only the cases they raised) |
| Papers of exits, absconding and quotas (`fwx-`, `fwa-`, `fwq-`) | FWM and group leaders | Company managers, OMs |

Passport numbers stay as their last 4 characters. No IC numbers are kept.

## Database

- **New module `db/modules/fw-gaps-v1.sql`** creates the table `prima.fw_gap_recs` (exit files, missing-worker cases, quotas, caseload). It has the company wall with forced RLS, no DELETE, append-only history, a fixed id, kind, company and worker, and exactly one caseload row per company (`fwcl-<company>`). It is **not** in the release manifest. It goes on the after-merge run list (`infra/run-db-migration.sh`, staging first). Until it runs, those tabs say the module is not installed.
- **Also on the run list: `db/modules/fw-moves-v1.sql`** (D4, moves and hostel needs, already in main).
- Bulk dates, levy and hostel reminders need no new table. They use `prima.credentials` (new source value `list`), `prima.fw_renewals` (new `levy` field), `prima.fw_stat_charges` (new optional `levy` on a line; the total includes it) and `prima.hostels`.

## Checks (23 Nov 2026, local)

- Core: `packages/core/test/fw-gaps.test.ts` (10 tests), plus the full core suite.
- PostgreSQL: `apps/api/test/fw-gaps-pg.test.ts` (2 tests): the list load without the module, a clear refusal before install, the company wall, roles, append-only history, fixed identity, the caseload row and no delete. Plus the full API suite on local PostgreSQL 16.
- Not done: browser UAT on staff devices, staging migration.
