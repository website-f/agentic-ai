# P90: Prima menu, search, home screen navigator and who sees what

Fitri, 9 Nov 2026: "in prima sidebar there are too many things and navs. Add a search bar to search what they want
directly and group the navs accordingly ... make sure all staff have their own roles and limit what they can see and do."

Branch `p90-nav`. Not merged, not deployed. No database change, no server change, no new environment variable.

## What changed for staff

1. **Search the menu.** A search box sits at the top of the side menu and at the top of the phone's "More" sheet (the
   More sheet searches the whole menu, including the four bottom tabs). It finds a screen by:
   - its label in English, Bahasa Melayu or BM + English (whatever language the screen is in);
   - its section or group name ("Operations", "Pay", "Foreign workers" ...);
   - everyday words in both languages, e.g. "gaji" or "salary" finds Staff payroll, Guard pay, Pay formulas, Salary
     calculator and the advances; "cuti" or "leave" finds My details, HR monitor, Attendance and Hand-overs;
     "pekerja asing", "FW" or "worker" finds Foreign workers, Recruitment cost, Nepali EPF/SOCSO, Arrival cash and Hostels.
   Keyboard: `/` or Ctrl+K (Cmd+K) puts the cursor in the box from anywhere (on a phone-width window it opens More with
   the box ready); up and down arrows move, Enter opens, Esc clears (a second Esc leaves the box). The matching part of
   each label is highlighted; each result shows its section and group underneath. No result says so in plain words with
   a hint ("Try another word, such as pay, leave or site."). Only screens the person already has are searched.
2. **Sections that open and close, with small groups inside.** The six sections stay (Today, Operations, People and HR,
   Business and finance, Compliance and governance, IT and systems); each is now split into small groups (table below).
   Each section heading shows how many screens it holds and opens or closes with a click. The choice is remembered per
   person in this browser (`localStorage` key `prima.nav.open.<userId>`, wrapped in try/catch; without storage the menu
   simply starts in its default state). Default: a menu of up to 24 screens starts fully open; a longer one (group
   leaders, company managers, admin executives, most PWVSB officers) starts with Today and the section of the open screen
   open. Opening a screen always opens its section, and the open screen is scrolled into view. A short menu (8 screens or
   fewer: guards, the site device, the FWM despatch) stays one plain list with no search box.
3. **"All your screens" on the home screen.** After the to-do cards and the key numbers: a "Find a screen" search box,
   "Recently opened" (the last six screens this person opened in this browser, `prima.nav.recent.<userId>`), then one
   card per section (icon, name, count) with its screens in their groups, each with a one-line plain description. Long
   cards show six screens and "Show all N". Phone first: one column on a phone, two at 768px, three or more at 1366px+.
   It lists exactly the person's own menu, so each role sees its own. Home is in the menu of group leadership, company
   managers, admin executives and supervisors (as before); other PWVSB officers start on their work screen and use the
   menu search.

Screen keys (`ViewName`) and every menu label are unchanged, so Arisha's screen guides still match. Arisha's Home guide
gained one how-to ("How to find a screen"), and the Workflow time & quality guide no longer names supervisors.

## Sections and groups (every menu screen exactly once; `scripts/nav-catalog.test.mjs` checks it)

| Section | Group | Screens |
|---|---|---|
| Today | Dashboards | Home, Group, Company today, Company office, Director Office, Reports |
| | My work | Duty / My details, Clock, Work, Meetings, Memos |
| Operations | Sites and areas | Regional ops, Sites, Far branches, Site survey, Site man-hours |
| | Guards and duty | Guards / People, Roster, Guard duty plans, Attendance, Cleaning plans |
| | Incidents and security | Cases, Arms control, CMS, CMS site readiness, Site device |
| | Equipment and vehicles | Items and equipment, Site stock and fittings, Vehicles |
| People and HR | Staff | HR monitor, Staff directory, Staff clock, Work KPIs, Hand-overs |
| | Pay | Staff payroll, Guard pay, Pay formulas, Salary calculator, Statutory rates, Wage advances, Advances and loans, Arrival cash |
| | Claims and welfare | Claims, SOCSO claims |
| | Foreign workers | Foreign workers, Recruitment cost, Nepali EPF/SOCSO, Hostels |
| Business and finance | Clients and sales | Tenders & quotes, Clients, Contracts |
| | Payments and buying | Finance, Payment requests, Requests, Procurement, PWVSB credit |
| | Companies and assets | Branches, Asset Management, Insurance |
| | JA Group app | JA app data, Switch from JA |
| Compliance and governance | Licences and readiness | Licences, Renewals, RBA readiness, Yearly self-audit |
| | Audit and quality | ACT, Audit trail, Quality and compliance / Guard skills / Supplier ratings, Speak up and assurance |
| | Company governance | Mandates, Governance registers, Company secretary, PDPA |
| IT and systems | IT help | IT, HR / IT coordination, IT purchase fulfilment |
| | Systems and data | Connections, Websites, Continuity, Workflow time & quality, AI data preview |

Moves from the old six lists: Staff clock (Today to People and HR), Memos (People and HR to Today), PDPA (People and HR to
Compliance), Requests (People and HR to Business and finance), Vehicles stays in Operations, Continuity (Compliance to IT),
Quality (Compliance, unchanged section). Group names show only inside a section holding more than 6 of the person's
screens, so short menus are not cluttered.

## Who sees what: how it was checked

- **Method.** In the demo build every made-up sign-in (98 people, with `prima-demo-all-staff` so the pilot limit does
  not hide anyone) was signed in and its menu recorded, before and after this change (`matrix.cjs`, headless Edge). For
  15 representative people (CEO, company manager, admin executive, branch manager, site officer, patrolling officer,
  IT executive, FWM despatch, company secretary, storekeeper, head of transport, guard, site device, HR admin, Finance
  team leader) every screen in their menu was then opened and any red error notice recorded
  (`errscan.cjs`). The menu filter in `App.tsx` (`NAV` roles plus the extra checks in `Shell`) was read rule by rule
  against the server checks in `packages/core`.
- **Rule kept:** the menu is only a convenience; the server decides. Nothing was widened and nothing was hidden from the
  CEO, the Chairman, the Vice Chairman or other group leadership.

### Tightened (menu only; the server already gives these people nothing there)

| Screen | Removed for | Why |
|---|---|---|
| Workflow time & quality (`it-metrics`) | Supervisors (site officers and patrolling officers, 14 demo sign-ins) | The screen times IT jobs, IT help requests and website requests only. The server (`ItMetricAuthorityResolver.choices/resolve`) offers a person only stages of IT jobs they work, IT or website requests they raised or must confirm. A supervisor's menu has no IT screen to raise a request, so the screen was always an empty technical page for them. Office staff keep it. |

### Looked at and kept (doubtful points for Fauzan or the module owners; not changed)

1. **HR / IT coordination for supervisors and the FWM driver.** Looks like an office screen, but the server
   (`HrItIntakeService.visible`) shows a person only requests about themselves, so a joining officer can fill in their
   own details (the "self_details" step lists supervisors and guards). Kept. If officers never join through it, it can be
   removed for them later.
2. **Every PWVSB officer sees ACT, RBA readiness, Speak up and assurance, Hand-overs, Connections, IT, Vehicles, Claims,
   Staff payroll, Memos and Meetings.** These are deliberate owner rules: own findings to fix, own ethics declaration,
   own Microsoft 365 check, ask IT, request a vehicle, own claims, own payslips. The server scopes each to the person.
3. **Admin executives (and branch managers) see Insurance, Hostels and Nepali EPF/SOCSO.** The menu lists admin
   executives on purpose (company insurance; a branch repays its own Nepali EPF/SOCSO). The server scopes to their
   company or branch. Worth confirming with Fauzan that every admin executive, not only the branch manager, should see
   Insurance and Hostels.
4. **Supervisors see Clients, SOCSO claims and Arms control.** Deliberate (officers act on clients; report injuries;
   firearms for their own people), server-scoped.
5. **Director Office for the CEO** shows one red notice inside the screen ("Not allowed: view for company (exceptional
   guard cash: authorized DOA or Finance only)"). It is one panel of the screen refusing, not the screen; the CEO keeps
   it. The panel owner may want to hide that panel for people the server refuses.
6. **Work** shows "Duplicate id ... in workTasks" in the demo for company staff on some reloads: a demo-data issue, not
   a permission one.
7. **Connections** says "Status unavailable" in the demo because no Microsoft 365 is connected there; expected.
8. **PWVSB officers who are not group leaders have no Home**, so no "All your screens" card view (they still have the
   menu search). Giving them Home needs the server's home dashboard for their role; not done here.
9. **IT purchase fulfilment for Finance staff.** The menu shows it to every Finance officer; the server
   (`ItProcurementService.actor`) lets in only the Finance team named in the IT purchase finance authority
   (`itPurchaseFinanceAuthorities/merdeka`), plus IT, the COO, the CEO, the Finance Director and ACT. In the demo no team
   is named, so Finance staff get "Not allowed". It was not hidden, because the browser does not know which team is named
   and hiding it would also hide it from that team. Follow-up: send the named team with the sign-in and show the screen
   only to it.
10. **Arrival cash** shows "Company books not found" for a Finance team leader in the demo: demo data, not permission.
11. **Guards** in the main app see Duty, Speak up and assurance, Items and equipment, and Memos; the **site device** sees
   only Site device. Both correct.

## Menu per role and department (demo build, after P90)

People with exactly the same menu are grouped. "Supervisor" means site officers and patrolling officers; "PWVSB" means
central staff; Group leadership sees the same as the CEO except where a rule names the CEO.

Result of the before/after comparison: exactly 13 sign-ins changed (the site officer and 12 patrolling officers lost
Workflow time & quality); every other menu is identical to before P90.

| Who (demo sign-ins with this exact menu) | Kind | Screens | Menu |
|---|---|---|---|
| Chief Executive Officer (1) | Group leadership | 77 | ACT, AI data preview, Advances and loans, Arms control, Arrival cash, Asset Management, Attendance, Audit trail, Branches, CMS, CMS site readiness, Cases, Cleaning plans, Clients, Company office, Company secretary, Company today, Connections, Continuity, Contracts, Director Office, Far branches, Finance, Foreign workers, Governance registers, Group, Guard duty plans, Guard pay, HR / IT coordination, HR monitor, Hand-overs, Home, Hostels, IT, IT purchase fulfilment, Insurance, Items and equipment, JA app data, Licences, Mandates, Meetings, Memos, Nepali EPF/SOCSO, PDPA, PWVSB credit, Pay formulas, Payment requests, People, Procurement, Quality and compliance, RBA readiness, Recruitment cost, Regional ops, Renewals, Reports, Requests, Roster, SOCSO claims, Salary calculator, Site man-hours, Site stock and fittings, Site survey, Sites, Speak up and assurance, Staff clock, Staff directory, Staff payroll, Statutory rates, Switch from JA, Tenders & quotes, Vehicles, Wage advances, Websites, Work, Work KPIs, Workflow time & quality, Yearly self-audit. |
| Chief Operating Officer; Director, Audit, Compliance and Transformation (2) | PWVSB | 77 | ACT, Advances and loans, Arms control, Asset Management, Attendance, Audit trail, Branches, CMS, CMS site readiness, Cases, Claims, Cleaning plans, Clients, Clock, Company office, Company secretary, Company today, Connections, Continuity, Contracts, Director Office, Far branches, Finance, Foreign workers, Governance registers, Group, Guard duty plans, Guard pay, HR / IT coordination, HR monitor, Hand-overs, Home, Hostels, IT, IT purchase fulfilment, Insurance, Items and equipment, JA app data, Licences, Mandates, Meetings, Memos, My details, Nepali EPF/SOCSO, PDPA, PWVSB credit, Pay formulas, Payment requests, People, Procurement, Quality and compliance, RBA readiness, Recruitment cost, Regional ops, Renewals, Reports, Requests, Roster, SOCSO claims, Salary calculator, Site man-hours, Site stock and fittings, Site survey, Sites, Speak up and assurance, Staff clock, Staff payroll, Statutory rates, Switch from JA, Tenders & quotes, Vehicles, Wage advances, Websites, Work, Work KPIs, Workflow time & quality, Yearly self-audit. |
| Chief of Staff and HR Director, Director Office; Deputy Chief of Staff and HR Director (2) | PWVSB | 75 | ACT, Advances and loans, Asset Management, Attendance, Audit trail, Branches, CMS site readiness, Cases, Claims, Cleaning plans, Clients, Clock, Company office, Company secretary, Company today, Connections, Continuity, Contracts, Director Office, Far branches, Foreign workers, Governance registers, Group, Guard duty plans, Guard pay, HR / IT coordination, HR monitor, Hand-overs, Home, Hostels, IT, IT purchase fulfilment, Insurance, Items and equipment, JA app data, Licences, Mandates, Meetings, Memos, My details, Nepali EPF/SOCSO, PDPA, PWVSB credit, Pay formulas, Payment requests, People, Procurement, Quality and compliance, RBA readiness, Recruitment cost, Regional ops, Renewals, Reports, Requests, Roster, SOCSO claims, Salary calculator, Site man-hours, Site stock and fittings, Site survey, Sites, Speak up and assurance, Staff clock, Staff directory, Staff payroll, Statutory rates, Switch from JA, Tenders & quotes, Vehicles, Wage advances, Websites, Work, Work KPIs, Workflow time & quality, Yearly self-audit. |
| Finance Director (1) | PWVSB | 75 | ACT, Advances and loans, Asset Management, Attendance, Audit trail, Branches, CMS site readiness, Cases, Claims, Cleaning plans, Clients, Clock, Company office, Company secretary, Company today, Connections, Continuity, Contracts, Director Office, Far branches, Finance, Foreign workers, Governance registers, Group, Guard duty plans, Guard pay, HR / IT coordination, HR monitor, Hand-overs, Home, Hostels, IT, IT purchase fulfilment, Insurance, Items and equipment, JA app data, Licences, Mandates, Meetings, Memos, My details, Nepali EPF/SOCSO, PDPA, PWVSB credit, Pay formulas, Payment requests, People, Procurement, Quality and compliance, RBA readiness, Recruitment cost, Regional ops, Renewals, Reports, Requests, Roster, SOCSO claims, Salary calculator, Site man-hours, Site stock and fittings, Site survey, Sites, Speak up and assurance, Staff clock, Staff payroll, Statutory rates, Switch from JA, Tenders & quotes, Vehicles, Wage advances, Websites, Work, Work KPIs, Workflow time & quality, Yearly self-audit. |
| Chairman; Vice Chairman (2) | PWVSB | 73 | ACT, Advances and loans, Arms control, Asset Management, Attendance, Audit trail, Branches, CMS, CMS site readiness, Cases, Cleaning plans, Clients, Company office, Company secretary, Company today, Connections, Continuity, Contracts, Director Office, Far branches, Finance, Foreign workers, Governance registers, Group, Guard duty plans, Guard pay, HR / IT coordination, HR monitor, Hand-overs, Home, Hostels, IT, IT purchase fulfilment, Insurance, Items and equipment, JA app data, Licences, Mandates, Meetings, Memos, Nepali EPF/SOCSO, PDPA, PWVSB credit, Pay formulas, Payment requests, People, Procurement, Quality and compliance, RBA readiness, Recruitment cost, Regional ops, Renewals, Reports, Requests, Roster, SOCSO claims, Salary calculator, Site man-hours, Site stock and fittings, Site survey, Sites, Speak up and assurance, Staff clock, Staff payroll, Statutory rates, Switch from JA, Tenders & quotes, Vehicles, Wage advances, Websites, Work, Workflow time & quality, Yearly self-audit. |
| Company Manager; General Manager; Company Manager, heads two companies (5) | Company Manager | 61 | ACT, Arms control, Attendance, Audit trail, Branches, CMS site readiness, Cases, Claims, Cleaning plans, Clients, Clock, Company office, Company secretary, Company today, Connections, Contracts, Far branches, Foreign workers, Governance registers, Guard duty plans, Guard pay, Guards, HR / IT coordination, Hand-overs, Home, Hostels, IT, Insurance, Items and equipment, JA app data, Licences, Mandates, Meetings, Memos, My details, Nepali EPF/SOCSO, PWVSB credit, Payment requests, Procurement, Quality and compliance, RBA readiness, Recruitment cost, Renewals, Reports, Requests, Roster, SOCSO claims, Site man-hours, Site survey, Sites, Speak up and assurance, Staff clock, Staff payroll, Switch from JA, Tenders & quotes, Vehicles, Websites, Work, Work KPIs, Workflow time & quality, Yearly self-audit. |
| Admin Executive; Admin Executive, website content owner for two companies (7) | Admin Executive | 46 | Attendance, Branches, CMS site readiness, Cases, Claims, Cleaning plans, Clients, Clock, Company office, Company secretary, Company today, Connections, Contracts, Governance registers, Guard duty plans, Guards, HR / IT coordination, Hand-overs, Home, Hostels, IT, Insurance, Items and equipment, JA app data, Licences, Meetings, Memos, My details, Nepali EPF/SOCSO, Procurement, RBA readiness, Renewals, Reports, Roster, SOCSO claims, Site man-hours, Site survey, Sites, Speak up and assurance, Staff payroll, Tenders & quotes, Vehicles, Websites, Work, Workflow time & quality, Yearly self-audit. |
| Branch Manager (9) | Admin Executive | 46 | Attendance, Branches, CMS site readiness, Cases, Claims, Cleaning plans, Clients, Clock, Company secretary, Company today, Connections, Contracts, Far branches, Governance registers, Guard duty plans, Guards, HR / IT coordination, Hand-overs, Home, Hostels, IT, Insurance, Items and equipment, JA app data, Licences, Meetings, Memos, My details, Nepali EPF/SOCSO, Procurement, RBA readiness, Renewals, Reports, Roster, SOCSO claims, Site man-hours, Site survey, Sites, Speak up and assurance, Staff payroll, Tenders & quotes, Vehicles, Websites, Work, Workflow time & quality, Yearly self-audit. |
| Operations Director, private sector sites (1) | PWVSB | 44 | ACT, Attendance, CMS site readiness, Cases, Claims, Cleaning plans, Clients, Clock, Connections, Contracts, Far branches, Guard duty plans, Guards, HR / IT coordination, Hand-overs, Hostels, IT, Items and equipment, JA app data, Meetings, Memos, My details, PDPA, Payment requests, Procurement, Quality and compliance, RBA readiness, Regional ops, Reports, Roster, SOCSO claims, Salary calculator, Site man-hours, Site stock and fittings, Site survey, Sites, Speak up and assurance, Staff payroll, Switch from JA, Vehicles, Wage advances, Work, Work KPIs, Workflow time & quality. |
| Operations General Manager, government sector sites (1) | PWVSB | 43 | ACT, Attendance, CMS site readiness, Cases, Claims, Cleaning plans, Clients, Clock, Connections, Contracts, Far branches, Guard duty plans, Guards, HR / IT coordination, Hand-overs, Hostels, IT, Items and equipment, JA app data, Meetings, Memos, My details, Payment requests, Procurement, Quality and compliance, RBA readiness, Regional ops, Reports, Roster, SOCSO claims, Salary calculator, Site man-hours, Site stock and fittings, Site survey, Sites, Speak up and assurance, Staff payroll, Switch from JA, Vehicles, Wage advances, Work, Work KPIs, Workflow time & quality. |
| Regional Operations Manager, Central; Regional Operations Manager, Northern; Regional Operations Manager, Southern (3) | PWVSB | 41 | ACT, Attendance, CMS site readiness, Cases, Claims, Cleaning plans, Clients, Clock, Connections, Contracts, Far branches, Foreign workers, Guard duty plans, Guards, HR / IT coordination, Hand-overs, IT, Items and equipment, JA app data, Meetings, Memos, My details, Quality and compliance, RBA readiness, Regional ops, Reports, Roster, SOCSO claims, Salary calculator, Site man-hours, Site stock and fittings, Site survey, Sites, Speak up and assurance, Staff payroll, Switch from JA, Vehicles, Wage advances, Work, Work KPIs, Workflow time & quality. |
| Operations Manager, Selangor and Kuala Lumpur; Operations Manager, Johor and Melaka (2) | PWVSB | 41 | ACT, Attendance, CMS site readiness, Cases, Claims, Cleaning plans, Clients, Clock, Connections, Contracts, Far branches, Foreign workers, Guard duty plans, Guards, HR / IT coordination, Hand-overs, IT, Items and equipment, JA app data, Meetings, Memos, My details, Quality and compliance, RBA readiness, Regional ops, Reports, Requests, Roster, SOCSO claims, Salary calculator, Site man-hours, Site stock and fittings, Site survey, Sites, Speak up and assurance, Staff payroll, Switch from JA, Vehicles, Wage advances, Work, Workflow time & quality. |
| HR Admin, central HR (1) | PWVSB | 33 | ACT, Advances and loans, Claims, Clock, Connections, Guard pay, HR / IT coordination, HR monitor, Hand-overs, Hostels, IT, Items and equipment, JA app data, Meetings, Memos, My details, People, Quality and compliance, RBA readiness, Reports, SOCSO claims, Site man-hours, Speak up and assurance, Staff clock, Staff directory, Staff payroll, Statutory rates, Switch from JA, Vehicles, Wage advances, Work, Work KPIs, Workflow time & quality. |
| Finance Team Leader, Team (7) | PWVSB | 32 | ACT, Advances and loans, Arrival cash, Asset Management, Claims, Clock, Connections, Finance, Guard pay, HR / IT coordination, Hand-overs, IT, IT purchase fulfilment, Items and equipment, Meetings, Memos, My details, Nepali EPF/SOCSO, Payment requests, Procurement, RBA readiness, Recruitment cost, Reports, Speak up and assurance, Staff payroll, Statutory rates, Vehicles, Wage advances, Websites, Work, Work KPIs, Workflow time & quality. |
| Auditor, ACT Team 1, PWVSB; Enforcement Officer, ACT Team 1, PWVSB; Auditor, ACT Team 2, PWVSB; Enforcement Officer, ACT Team 2, PWVSB (4) | PWVSB | 32 | ACT, Audit trail, Claims, Cleaning plans, Clock, Connections, Far branches, Governance registers, HR / IT coordination, Hand-overs, IT, IT purchase fulfilment, Items and equipment, Meetings, Memos, My details, Pay formulas, Quality and compliance, RBA readiness, Renewals, Reports, Salary calculator, Site man-hours, Speak up and assurance, Staff payroll, Statutory rates, Switch from JA, Vehicles, Websites, Work, Workflow time & quality, Yearly self-audit. |
| PWVSB group monitoring (1) | PWVSB | 31 | ACT, Attendance, CMS site readiness, Cases, Claims, Cleaning plans, Clock, Connections, Guard duty plans, Guards, HR / IT coordination, Hand-overs, IT, Meetings, Memos, My details, Quality and compliance, RBA readiness, Regional ops, Reports, Roster, SOCSO claims, Site man-hours, Site stock and fittings, Site survey, Sites, Speak up and assurance, Staff payroll, Vehicles, Work, Workflow time & quality. |
| Finance Deputy, Team (1) | PWVSB | 31 | ACT, Advances and loans, Arrival cash, Asset Management, Claims, Clock, Connections, Finance, Guard pay, HR / IT coordination, Hand-overs, IT, IT purchase fulfilment, Items and equipment, Meetings, Memos, My details, Nepali EPF/SOCSO, Payment requests, Procurement, RBA readiness, Recruitment cost, Reports, Speak up and assurance, Staff payroll, Statutory rates, Vehicles, Wage advances, Websites, Work, Workflow time & quality. |
| Finance Data Entry Executive, Team (2) | PWVSB | 30 | ACT, Advances and loans, Arrival cash, Asset Management, Claims, Clock, Connections, Finance, Guard pay, HR / IT coordination, Hand-overs, IT, IT purchase fulfilment, Items and equipment, Meetings, Memos, My details, Nepali EPF/SOCSO, Procurement, RBA readiness, Recruitment cost, Reports, Speak up and assurance, Staff payroll, Statutory rates, Vehicles, Wage advances, Websites, Work, Workflow time & quality. |
| FWM Manager, Foreign Worker Management (1) | PWVSB | 27 | ACT, Arrival cash, Claims, Clock, Connections, Foreign workers, Guards, HR / IT coordination, Hand-overs, Hostels, IT, JA app data, Meetings, Memos, My details, Nepali EPF/SOCSO, Payment requests, RBA readiness, Recruitment cost, Reports, Speak up and assurance, Staff payroll, Switch from JA, Vehicles, Work, Work KPIs, Workflow time & quality. |
| Credit Officer, PWVSB financing to the companies (1) | PWVSB | 26 | ACT, Arrival cash, Asset Management, Claims, Clock, Connections, HR / IT coordination, Hand-overs, IT, IT purchase fulfilment, Items and equipment, Meetings, Memos, My details, Nepali EPF/SOCSO, PWVSB credit, Procurement, RBA readiness, Recruitment cost, Reports, Speak up and assurance, Staff payroll, Vehicles, Websites, Work, Workflow time & quality. |
| Finance Executive (1) | PWVSB | 25 | ACT, Arrival cash, Asset Management, Claims, Clock, Connections, HR / IT coordination, Hand-overs, IT, IT purchase fulfilment, Items and equipment, Meetings, Memos, My details, Nepali EPF/SOCSO, Procurement, RBA readiness, Recruitment cost, Reports, Speak up and assurance, Staff payroll, Vehicles, Websites, Work, Workflow time & quality. |
| IT Manager, Merdeka Network (1) | Merdeka Network | 25 | ACT, Claims, Clock, Connections, Continuity, HR / IT coordination, Hand-overs, IT, IT purchase fulfilment, Items and equipment, Meetings, Memos, My details, Payment requests, RBA readiness, Reports, Speak up and assurance, Staff clock, Staff directory, Staff payroll, Vehicles, Websites, Work, Work KPIs, Workflow time & quality. |
| FWM Deputy Manager (1) | PWVSB | 25 | ACT, Claims, Clock, Connections, Foreign workers, Guards, HR / IT coordination, Hand-overs, Hostels, IT, JA app data, Meetings, Memos, My details, Nepali EPF/SOCSO, RBA readiness, Recruitment cost, Reports, Speak up and assurance, Staff payroll, Switch from JA, Vehicles, Work, Work KPIs, Workflow time & quality. |
| FWM Executive (3) | PWVSB | 24 | ACT, Claims, Clock, Connections, Foreign workers, Guards, HR / IT coordination, Hand-overs, Hostels, IT, JA app data, Meetings, Memos, My details, Nepali EPF/SOCSO, RBA readiness, Recruitment cost, Reports, Speak up and assurance, Staff payroll, Switch from JA, Vehicles, Work, Workflow time & quality. |
| IT Lead, Merdeka Network (1) | Merdeka Network | 23 | ACT, Claims, Clock, Connections, Continuity, HR / IT coordination, Hand-overs, IT, IT purchase fulfilment, Items and equipment, Meetings, Memos, My details, RBA readiness, Reports, Speak up and assurance, Staff directory, Staff payroll, Vehicles, Websites, Work, Work KPIs, Workflow time & quality. |
| Arms Control Manager, Arms Control Department (1) | PWVSB | 23 | ACT, Arms control, Audit trail, CMS, CMS site readiness, Cases, Claims, Clock, Connections, HR / IT coordination, Hand-overs, IT, Meetings, Memos, My details, RBA readiness, Reports, Speak up and assurance, Staff payroll, Vehicles, Work, Work KPIs, Workflow time & quality. |
| IT Executive, Merdeka Network (4) | Merdeka Network | 22 | ACT, Claims, Clock, Connections, Continuity, HR / IT coordination, Hand-overs, IT, IT purchase fulfilment, Items and equipment, Meetings, Memos, My details, RBA readiness, Reports, Speak up and assurance, Staff directory, Staff payroll, Vehicles, Websites, Work, Workflow time & quality. |
| Arms Control Assistant, Arms Control Department (1) | PWVSB | 22 | ACT, Arms control, Audit trail, CMS, CMS site readiness, Cases, Claims, Clock, Connections, HR / IT coordination, Hand-overs, IT, Meetings, Memos, My details, RBA readiness, Reports, Speak up and assurance, Staff payroll, Vehicles, Work, Workflow time & quality. |
| CMS Head Control, command centre (2) | PWVSB | 21 | ACT, Arms control, CMS, CMS site readiness, Claims, Clock, Connections, Far branches, HR / IT coordination, Hand-overs, IT, JA app data, Meetings, Memos, My details, RBA readiness, Speak up and assurance, Staff payroll, Vehicles, Work, Workflow time & quality. |
| Legal Counsel, PWVSB (1) | PWVSB | 21 | ACT, Claims, Clock, Company secretary, Connections, Governance registers, HR / IT coordination, Hand-overs, IT, Mandates, Meetings, Memos, My details, PWVSB credit, RBA readiness, Reports, Speak up and assurance, Staff payroll, Vehicles, Work, Workflow time & quality. |
| Procurement and Inventory Executive, PWVSB (1) | PWVSB | 21 | ACT, Claims, Clock, Connections, HR / IT coordination, Hand-overs, IT, Items and equipment, Meetings, Memos, My details, Procurement, RBA readiness, Reports, Site stock and fittings, Speak up and assurance, Staff payroll, Supplier ratings, Vehicles, Work, Workflow time & quality. |
| Storekeeper, Procurement and Inventory, PWVSB (2) | PWVSB | 20 | ACT, Claims, Clock, Connections, HR / IT coordination, Hand-overs, IT, Items and equipment, Meetings, Memos, My details, Procurement, RBA readiness, Reports, Site stock and fittings, Speak up and assurance, Staff payroll, Vehicles, Work, Workflow time & quality. |
| Director Office Administrator (1) | PWVSB | 20 | ACT, Claims, Clock, Connections, Director Office, Guard pay, HR / IT coordination, Hand-overs, IT, Meetings, Memos, My details, RBA readiness, Reports, Speak up and assurance, Staff payroll, Tenders & quotes, Vehicles, Work, Workflow time & quality. |
| Patrolling Officer (12) | Supervisor | 20 | Arms control, Attendance, CMS site readiness, Cases, Clients, Clock, Duty, Guard skills, Guards, HR / IT coordination, Home, Items and equipment, JA app data, Memos, Roster, SOCSO claims, Site survey, Sites, Speak up and assurance, Work. **Removed in P90:** Workflow time & quality. |
| PDPA Officer (1) | PWVSB | 19 | ACT, Claims, Clock, Connections, HR / IT coordination, Hand-overs, IT, Meetings, Memos, My details, PDPA, RBA readiness, Reports, Speak up and assurance, Staff payroll, Vehicles, Work, Work KPIs, Workflow time & quality. |
| Asset Director, Asset Management (1) | PWVSB | 19 | ACT, Asset Management, Claims, Clock, Connections, HR / IT coordination, Hand-overs, IT, Meetings, Memos, My details, RBA readiness, Reports, Speak up and assurance, Staff payroll, Vehicles, Work, Work KPIs, Workflow time & quality. |
| Site Officer (1) | Supervisor | 19 | Arms control, Attendance, CMS site readiness, Cases, Clients, Clock, Duty, Guard skills, Guards, HR / IT coordination, Home, Items and equipment, Memos, Roster, SOCSO claims, Site survey, Sites, Speak up and assurance, Work. **Removed in P90:** Workflow time & quality. |
| Head of Transport (1) | PWVSB | 18 | ACT, Claims, Clock, Connections, HR / IT coordination, Hand-overs, IT, Meetings, Memos, My details, Payment requests, RBA readiness, Reports, Speak up and assurance, Staff payroll, Vehicles, Work, Workflow time & quality. |
| Maintenance Manager, Asset Management; Rental Executive, Asset Management; Resort Executive, Asset Management (3) | PWVSB | 18 | ACT, Asset Management, Claims, Clock, Connections, HR / IT coordination, Hand-overs, IT, Meetings, Memos, My details, RBA readiness, Reports, Speak up and assurance, Staff payroll, Vehicles, Work, Workflow time & quality. |
| Company secretary (1) | PWVSB | 17 | ACT, Claims, Clock, Company secretary, Connections, HR / IT coordination, Hand-overs, IT, Meetings, Memos, My details, RBA readiness, Speak up and assurance, Staff payroll, Vehicles, Work, Workflow time & quality. |
| Guard, own view only (2) | Guard (own view) | 4 | Duty, Items and equipment, Memos, Speak up and assurance. |
| FWM driver cum despatch (1) | PWVSB | 3 | Clock, Foreign workers, HR / IT coordination. |
| Shared site device (1) | Site device | 1 | Site device. |

## Files

- `apps/web/src/nav-catalog.ts`: sections, groups, one-line descriptions, search words, search and highlight, remembered
  sections and recently opened screens.
- `apps/web/src/NavMenu.tsx`, `apps/web/src/styles/nav.css`: the menu (side menu and More sheet) and the home navigator styles.
- `apps/web/src/views/AllScreens.tsx`: "All your screens" on Home; `views/Home.tsx` places it after the key numbers.
- `apps/web/src/App.tsx`: old `NAV_GROUPS`/`navSections` replaced by the catalog; the menu passed to Home; the
  `it-metrics` tightening; the recently opened list.
- `apps/web/src/i18n.ts`: one block of rows "P90: menu sections ..." and "P90: one line per screen ...".
- `scripts/nav-catalog.test.mjs`: every menu screen in exactly one group, every screen described, Malay rows present,
  everyday words covered.
