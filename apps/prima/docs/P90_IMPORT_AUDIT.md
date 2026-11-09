# P90: Add and "Import from any file" on every screen that keeps records

Fitri, 9 Nov 2026: "some pages don't have a button to add data, e.g. in Prima FWM, foreign workers… make sure there's a button
to add via Excel or any files… even if this file has different columns and format… not only FWM pages, do a full audit".

This audit covers every menu screen (NAV in `apps/web/src/App.tsx`, 81 entries on base 16232dd). For each screen: the
records staff would bring from old spreadsheets, whether the screen has an **Add** and an **Import**, and the server create
path (whose permission check the import reuses: an import row is saved through the same call as Add, so nobody can import
what they could not add by hand).

Legend: **P90** = added in P90; **P91** = added in P91 (Items, 9 Nov 2026). "Workflow" = the screen holds work in progress (approvals, cases, tasks, pay runs),
not master records; those are not bulk-loaded, because each item needs its own approval or evidence.

## Screens that keep master records

| Screen (menu) | Records | Add | Import | Create path and permission |
|---|---|---|---|---|
| Foreign workers (`fwm`) | Foreign workers with passport, PLKS, FOMEMA, insurance, SPIKPA dates | **P90** "Add foreign worker" | **P90** `fwWorker` | **P90** `addFwWorker`: FWM staff only (`fwmRoleOf === 'staff'`, the same check as adding from the JA app); Nepali, age 18-60, own branch, staff number once |
| Sites (`sites`) | Sites, posts, checkpoints | yes | yes (`site`, `post`, `checkpoint`) | `saveRecord`, company desk (site also the OGM) |
| Guards (`people`) | Office staff | yes (`officeStaff`) | yes | `saveRecord`, HR |
| Guards (`people`) | Guards and officers | no (by design) | no (by design) | Guards come from the JA Group app feed (`records.ts`: "Guards and officers come from the JA Group app and are not added here"). Not changed: a second source of guard records needs the CEO's decision. History from JA is loaded through "Switch from JA". |
| Licences, Renewals, Company today | Licences | yes | yes (`licence`) | `saveRecord`, company desk |
| Insurance | Policies, claims, guarantees | yes | yes (3 kinds) | `saveRecord`, company desk or Chief of Staff |
| Vehicles (`fleet`) | Vehicles | yes | yes (`vehicle`) | `saveRecord`, Transport |
| Hostels | Hostels | yes | yes (`hostel`) | `saveRecord`, company desk or FWM |
| Clients | Clients | yes | yes (`client`) | `addClientAccount` |
| Contracts | Client contracts | yes | yes (`contract`) | `addContract`, company manager |
| Procurement (`purchasing`) | Store stock items | yes | yes (`stockItem`) | `saveRecord`, Procurement (Goodwill Empire) |
| Procurement (`purchasing`) | Suppliers | yes | **P90** `purSupplier` | `addPurSupplier`, Procurement (`purCanAddSupplier`); Finance still verifies each bank account and reviews each supplier |
| Branches | Branches | yes | **P90** `branch` | `addBranch`, company manager; each starts as proposed |
| HR monitor (`hr`) | Public holidays | yes | **P90** `publicHoliday` | `addPublicHoliday`, HR (`hrMaker`) |
| HR monitor (`hr`) | Leave days above the Act | yes | yes (`leaveEntitlement`) | `setLeaveOverride`, HR |
| IT (`it`) | IT equipment (existing devices) | yes (manual record) | **P90** `itAsset` | IT manual record `create('asset')`: IT manager/lead/executive or the owner; duplicate tag or serial refused |
| IT purchase fulfilment (`it-procurement`) | Approved IT purchases | no (by design) | **P90** `itAsset` (equipment bought before Prima) | Purchases are raised on IT and pass their approvals; importing purchases would skip money approvals, so only existing equipment is loadable here |
| Websites | Domains and websites | **P90** "Add domain" | **P90** `itDomain` on the screen (was only in Hand-overs) | `saveRecord`, IT manager or team |
| Asset Management (`assets`) | Rental units, fixed assets, work orders | yes | yes (`amUnit`, `amAsset`, `amWorkOrder`) | `saveRecord`, asset team |
| Asset Management (`assets`) | Tenancies | yes | no | A tenancy edits an existing unit (not a new record); left to the unit form |
| CMS | Phone extensions, CMS staff, CCTV and alarm panels | yes | yes (3 kinds) | `saveRecord`, Arms Control |
| Arms control | Arms suppliers, price list | yes | yes | `saveRecord`, Arms Control |
| Arms control | Vaults, firearms, dealer licences, armed agreements | yes | no (by design) | Kept on their own reviewed path (P81 decision) |
| Items and equipment (`items`) | Item types (catalogue) | **P91** "Add" menu at the top of the screen: "New item type"; and "New item type" at the top of the Item types tab | **P91** `itemType` | `sku.add` (`importItemType`): store staff or managers of any company, IT for IT devices; code made from name and size when the file has none; firearms refused (Arms Control) |
| Items and equipment (`items`) | Serialised units from the old asset list | **P91** "Add" menu: "Register items" (opens the register, labels printed and scanned back) and at the top of the Stock and labels tab; the scanner offers "Register this item" for an old barcode it does not know, keeping that code as the old tag | **P91** `itemUnit` | `item.register` (`importItemUnit`): store staff, managers or IT of the owner company (Company column or chosen company; central parties too). Each unit gets a new Prima ID, no label yet, on "Labels to print or scan back", an opening balance not yet verified; old tag kept (`legacyRef`, refused twice per company), old location, condition and holder kept as a reference (`legacyFrom`); IT devices whose serial or tag is in the IT register are linked |
| Items and equipment (`items`) | Bulk stock (opening balances) | **P91** "Register items" with an item type counted by quantity ("Add stock") | **P91** `itemStock` | `lot.add` (`importItemStock`): store staff or managers of the owner company; into the owner's store, the old location kept in the note |
| Items and equipment (`items`) | Current holders from the old system | n/a (by design) | no (by design) | A holder is set only by a handover that the person confirms themselves, after the printed label is scanned back and the item checked (P85 rules). The old holder is kept on the unit as "Held by (old record)" so the store hands it over through the normal handover. |
| Items and equipment (`items`) | Past uniform issues | yes (Uniforms tab, by guard or in bulk for a site, zone or region) | no | `uniform.past` already records counts in bulk with a source; not changed |
| Hand-overs | Every importable kind | n/a | yes, all kinds | The generic import screen |

## Add exists, no import yet (lower value or needs its own review)

| Screen | Records | Create path | Why not in P90 |
|---|---|---|---|
| HR monitor (`hr`) | Staff training records | `recordTraining` | Next candidate (HR or scoped manager) |
| Guards (`people`) | Guard papers (KDN card, CSG, TNG) | `recordGuardPaper` | Next candidate; guards themselves come from JA |
| Foreign workers | Paper renewals for existing workers | `recordFwPaper` | A renewed paper needs its copy attached (rule); typed dates are only accepted when a worker is first added |
| Staff directory | Office staff directory | own CSV batch with CoS approval | Already has its own reviewed batch path |
| Switch from JA | JA history | own staged import with ACT approval | Already has its own reviewed path |
| Recruitment cost (`fwcost`) | Worker placements | `recordFwPlacement` | Money rule (charges follow); left to the form |
| Site man-hours (`sitehours`) | Holiday lists per state | `setPublicHolidays` | Ops Director/OGM list; HR's holiday import covers the list itself |
| Others | Credit loans, mandates, statutory filings, legal matters, BCM systems, guard loans, fuel cards, CMS readiness devices, site kit, tenders, bank accounts, PDPA products | each screen's own add | Few records each, or money/legal approvals attached |

## Workflow and dashboard screens (no master records to load)

Home, Group, Company office, Roster (shifts), Guard duty plans, Cleaning plans, Attendance, Cases, Yearly self-audit, RBA
readiness, Tenders & quotes, Regional ops, Audit trail, Site device, Director Office, Reports, Site survey, Meetings, Duty,
Clock, Staff clock, Work, Far branches, SOCSO claims, Nepali EPF/SOCSO, Claims, PDPA, Requests, Payment requests, JA app
data, Finance, PWVSB credit, Speak up and assurance, ACT, Pay formulas, Salary calculator, Mandates, Company secretary,
AI data preview, Connections, Continuity, Work KPIs, Workflow time & quality, HR / IT coordination, Staff payroll, Guard pay,
Wage advances, Statutory rates, Arrival cash, Advances and loans, Memos, Governance registers, Quality and compliance.

## How the import reads any file (P90)

- Files: Excel `.xlsx`/`.xlsm` (every sheet; the sheet most like the record's list is chosen), CSV/TSV/TXT, Word `.docx`
  tables, PDF lists made by a computer (text and positions read on the device; a scanned PDF is a picture and is refused
  with plain words). Old `.xls`/`.doc`/`.ods` are refused with "save it as .xlsx". All read in the browser, nothing uploaded
  until the rows are checked.
- The matcher (`packages/core/src/import-match.ts`, TypeScript in the browser, the same job numpy/pandas would do, with no
  server round trip): header words in English and Malay mapped to concepts with short forms and typos (Jaro-Winkler),
  P81's synonym table, a profile of each column's values (dates with day/month order worked out from the values, Excel
  serials, Malaysian IC, passport, phone, email, money, plate, yes/no, country, a known list, uniqueness, fill), the
  Hungarian method for the best whole assignment (each column once, each field once), a confidence per match; unsure ones
  are flagged "Check this". Group titles over the header, totals and signature lines, repeated page headers and
  "Name (Passport)" columns are handled. Values are normalised (dates to ISO, IC with dashes, countries to codes).
- A layout the person confirmed is remembered on that device (localStorage, by the column names) and matched at once next time.
- Optional AI helper (`PRIMA_IMPORT_AI_ENABLED=true`, default off, and Arisha AI must be on): only for columns the
  matcher could not place; it is sent the column names and value shapes ("AA9999999", "99/99/9999") and the field names,
  never values (the server reshapes whatever is sent). Suggestions are marked for the person to confirm.
- The server then checks every row through the record's own save (dry run), the person fixes or skips rows, and the
  chosen rows are imported all or none with a receipt (fingerprint, refused a second time) and an audit entry (P81).
