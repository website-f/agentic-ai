# P91: Prima as apps

Fitri, 9 Nov 2026: "Prima full revamp: the sidebar is still too overwhelming. When people go to Prima they see a simple,
mobile-friendly home with many category cards (like Grab). Each category is like a microservice: click HR and the sidebar
changes to HR only, like going to a different realm, with a back button. The home has a search to go straight there; the
home sidebar is only the everyday things."

## What a person sees

- **Home** (`#home`): a greeting, one search for every app and screen (Malay, English or everyday words such as "gaji"),
  shortcuts to the person's own screens (clock, work, meetings…), the **app cards** (each with a red number when items on
  the home list wait for this person in that app), what they opened lately, then the existing decisions, key numbers and
  monitor list. The side menu holds only the Home space: dashboards and My work, plus an **Apps** button.
- **An app** (`#@hr`): its own page with the screens in small groups, each with one plain line, and "Waiting for you"
  (the home list's items for this app). The side menu becomes that app only: **All apps** (back), the app's name, a
  **switch app** grid, a search over everything, and the app's screens.
- **Phone**: bottom tabs Home, Apps (a sheet with the app grid and search), Search, the person's own Clock or Work, More.
  Inside an app a bar under the top bar has Back, the app's name, and its screens in a strip that scrolls sideways. The
  phone's Back button leaves the app (going in or out of an app is a history step; moving inside one is not).
- A short menu (under 12 screens, or one app only: guards, site officers, a site device) keeps the one plain list it had.

## The apps (nav-catalog.ts `NAV_SECTIONS`)

| Space | Screens |
|---|---|
| Home (side menu on the home screen) | Home, Group, Company today, Reports; Clock, Work, Meetings, Memos, My details |
| Operations | Regional ops, Sites, Far branches, Site survey, Site man-hours; Guards, Roster, Duty plans, Attendance, Cleaning |
| Security | Cases, Arms control, CMS, CMS readiness, Site device |
| Equipment | Items, Site stock, Vehicles, Asset Management |
| HR | HR monitor, Staff directory, Staff clock, Work KPIs, Hand-overs; Claims, SOCSO claims |
| Payroll | Staff payroll, Guard pay; Pay formulas, Salary calculator, Statutory rates; Wage advances, Advances and loans |
| Foreign workers | FWM, Recruitment cost, Nepali EPF/SOCSO, Hostels, Arrival cash |
| Clients and sales | Tenders and quotes, Clients, Contracts |
| Finance | Finance, Payment requests, PWVSB credit; Procurement, Requests; Branches, Insurance |
| Compliance | Licences, Renewals, RBA, Self-audit; ACT, Audit trail, Quality, Speak up |
| Management | Company office, Director Office; Mandates, Registers, Company secretary, PDPA |
| IT and systems | IT, HR/IT coordination, IT purchases; Connections, Websites, Continuity, Workflow time, AI data preview; JA app, Switch from JA |

## What did not change

- Who may open a screen: still the menu filter in `App.tsx` and the server. Apps only show the screens a person already
  had; an app with none of their screens is not shown.
- People whose menu has no Home dashboard (central staff such as Operations, Finance, IT) get a home made of the app
  cards and their main screens only. It reads no dashboard data, so they see nothing new.
- Search words, screen descriptions and the Malay rows from P90 are kept; `scripts/nav-catalog.test.mjs` checks every
  screen sits in one group of one space and every app has a short line with a Malay row.
