# P90 page-by-page UX pass

Fitri (9 Nov 2026): "page UI/UX faulty, e.g. in the Prima Surveys page the whole page has no generous spacing ... there
are many pages like this in Prima. Check them one by one thoroughly without missing any."

This is the checklist of every menu screen, checked in the demo build at 1366px (computer) and 390px (phone), in
Bahasa Melayu (the default, and the longest text), with spot checks in English and in dark mode. Screens were opened as
the demo CEO (Fauzan, sees 77 of the menu screens) and as the COO for the three screens only other people have (My clock,
My duty, Claims). Every tab on every screen was also opened by script and checked for content running off the screen,
wrapped buttons and touching boxes (195 tab views; findings fixed or noted below).

## Root cause

`App.tsx` rendered each screen straight into `.main`. The page padding, width and rhythm lived only on a `.page` class
that each screen had to draw itself. Two screens did not (Site survey, Staff directory), and any screen that returned
only a loading line or an error had none either, so their content sat flush against the sidebar with no width limit.

## Root fix (every screen)

- `App.tsx`: every screen is wrapped in `<div className="view-host">`. `styles/ux.css` gives that frame the page
  padding (28px computer, 16px phone), the max width (1360px, 1480px on very wide screens) and the 24px rhythm whenever
  the screen does not draw its own `.page` (`.view-host:not(:has(> .page))`). Screens that do draw `.page` are unchanged.
- `styles/ux.css` (new, loaded last from `main.tsx`), shared rules:
  - Page head: title and its line of explanation never touch; long page text reads at most 82 characters a line; a
    company or month picker in a page head is its own size, not a full-width bar.
  - Phone page head: the main action is full width under the title (first in line), the other actions share the row.
  - Room at the bottom of every page for the Arisha button (96px computer) and for the bottom tabs plus the Arisha button
    (136px phone).
  - Notices: a notice with no tone was a hard black frame, now a quiet note; `unknown` keeps its violet, `neutral` is
    grey.
  - Cards: forms, fields, buttons and plain blocks placed straight inside a `.panel` (no `.panel-body`) sat flush on the
    card edges; they now get the card padding. A button straight in a card is its own size. A table straight in a card
    lines its outer cells up with the card text.
  - Tables: a table wider than its card scrolls inside the card with a soft edge shadow showing there is more; on a phone
    the first column (the row's name) stays in view and chips in a table stay on one line; short figures (`td.num`,
    mono) never wrap ("11 / 11").
  - Figures: a long figure in a tile (more than 9 characters, e.g. RM1,466,400) is set a size smaller so it never
    breaks inside the number (`data-long` on `Kpi` in `ui.tsx` and `Stat` in `kit.tsx`).
  - Tiles on a phone: an odd last tile takes the whole row instead of leaving a blank half.
  - Segmented choices scroll sideways instead of hiding their last option on a phone.
  - A status chip next to a card or company title keeps its whole word; the title wraps instead.
  - List rows drawn as link buttons (Cleaning) or as plain `.item` rows (Panel firms, Legal holds, Company files) get
    row padding, dividers and no underline.

Not changed on purpose (other engineers own them): `Home.tsx`, the sidebar/NAV markup, `Arisha.tsx`, `Launcher.tsx`,
camera/scanner screens, and every `<select>` element (only the width of a picker in a page head is set by CSS).

## Screens

| # | Screen (menu) | View | Seen as | 1366 / 390 | What was fixed |
|---|---|---|---|---|---|
| 1 | Home | `home` | CEO | checked / checked | ok (owned by the nav/home engineer; not changed here) |
| 2 | Work | `work` | CEO | checked / checked | phone: the By department table keeps the department column in view while the numbers scroll sideways; scroll shadow shows there is more |
| 3 | Group | `overview` | CEO | checked / checked | company card status chip no longer cut ("Ambil tindaka" → "Ambil tindakan"); the title wraps instead |
| 4 | Company today | `company` | CEO | checked / checked | ok |
| 5 | Company office | `office` | CEO | checked / checked | ok; phone: page actions full width |
| 6 | Director Office | `doa` | CEO | checked / checked | phone: the Waiting/Being worked on/All switch scrolls instead of hiding "All"; page action full width |
| 7 | Reports | `reports` | CEO | checked / checked | phone: "Change the report list" full width under the title |
| 8 | Meetings | `meetings` | CEO | checked / checked | phone: odd last tile takes the whole row; New meeting full width |
| 9 | Staff clock | `staffclock` | CEO | checked / checked | the "no office door readings" notice drew a hard black frame; now the violet Unknown notice |
| 10 | Regional ops | `ops` | CEO | checked / checked | tables scroll inside their card with a first column kept in view on a phone |
| 11 | Cases | `cases` | CEO | checked / checked | phone: Raise a case full width |
| 12 | Sites | `sites` | CEO | checked / checked | phone: Add site full width, Import beside it |
| 13 | Roster | `roster` | CEO | checked / checked | phone: Add shifts full width; roster grid unchanged (has its own sticky column) |
| 14 | Guard duty plans | `duty` | CEO | checked / checked | duty-plan columns scroll inside the card with an edge shadow (they were cut off at the right with no hint) |
| 15 | Cleaning plans | `cleaning` | CEO | checked / checked | site rows were underlined link text flush on the card edge with no dividers; now padded rows with dividers, no underline, chips aligned (left on a phone) |
| 16 | Site stock and fittings | `sitestock` | CEO | checked / checked | ok |
| 17 | Guards | `people` | CEO | checked / checked | phone: staff table keeps the name column in view (wider, not cut to 12rem); actions full width |
| 18 | Attendance | `attendance` | CEO | checked / checked | ok |
| 19 | Arms control | `arms` | CEO | checked / checked | phone: CMS management full width |
| 20 | CMS | `cms` | CEO | checked / checked | ok |
| 21 | CMS site readiness | `cmsready` | CEO | checked / checked | "11 / 11" no longer breaks onto two lines; phone: site column kept in view, table scrolls |
| 22 | Site survey | `surveys` | CEO | checked / checked | WORST: no page padding (title, intro, notice and button flush against the sidebar), no structure. Now the page frame, the kit page head with New site survey on the right (full width on a phone), Send now beside it, the list in a card and an empty state with what to do next |
| 23 | Far branches | `branchwork` | CEO | checked / checked | ok |
| 24 | Vehicles | `fleet` | CEO | checked / checked | phone: Add vehicle full width, Import under it |
| 25 | Site man-hours | `sitehours` | CEO | checked / checked | long rule paragraph under the page now reads in comfortable lines (max 82ch) |
| 26 | Items and equipment | `items` | CEO | checked / checked | ok (scanner/camera not touched) |
| 27 | HR monitor | `hr` | CEO | checked / checked | phone: tables scroll inside their cards |
| 28 | Foreign workers | `fwm` | CEO | checked / checked | ok |
| 29 | SOCSO claims | `socso` | CEO | checked / checked | phone: Start a claim full width |
| 30 | Recruitment cost | `fwcost` | CEO | checked / checked | title and explanation touched (no gap); now 6px apart |
| 31 | Nepali EPF/SOCSO | `fwstat` | CEO | checked / checked | title and explanation touched (no gap); now 6px apart |
| 32 | Hostels | `hostels` | CEO | checked / checked | phone: Add hostel full width, Import under it |
| 33 | PDPA | `pdpa` | CEO | checked / checked | ok |
| 34 | Requests | `requests` | CEO | checked / checked | ok |
| 35 | Pay formulas | `payformulas` | CEO | checked / checked | the "choose a formula for a place" and "which formula pays here" forms sat flush on the card edges; now padded like the card text |
| 36 | Salary calculator | `salarycalc` | CEO | checked / checked | Formula and month fields flush on the card edges; salary table cut at the right (stray 18px margin); warning notice had no tone. All fixed |
| 37 | Work KPIs | `work-kpi` | CEO | checked / checked | phone: Step column kept in view, tables scroll |
| 38 | Staff directory | `staff-directory` | CEO | checked / checked | WORST: no page frame at all (two loose cards, no padding, title inside a card). Now page frame + kit page head with the explanation, tiles on their own, search box grows, empty state with icon |
| 39 | Staff payroll | `staffpay` | CEO | checked / checked | ok |
| 40 | Guard pay | `guardpay` | CEO | checked / checked | ok |
| 41 | Wage advances | `advances` | CEO | checked / checked | ok |
| 42 | Statutory rates | `statutory` | CEO | checked / checked | "Add a contribution" button and the new-contribution fields sat on the card edge; now padded |
| 43 | Arrival cash | `arrivalcash` | CEO | checked / checked | WORST: title was a small h2, full-width company box, hard black notice, text glued under it, unpadded cards. Fixed with CSS only (file comes from upstream #137): page-size title, picker 440px, quiet notice, gaps, padded cards |
| 44 | Advances and loans | `loans` | CEO | checked / checked | the empty "No advance or loan recorded" line had no bottom padding in its card |
| 45 | Memos | `memos` | CEO | checked / checked | phone: memo title was squeezed to one word a line by the status chip; now title first, status and arrow on the next line |
| 46 | Hand-overs | `handovers` | CEO | checked / checked | ok |
| 47 | Tenders & quotes | `commercial` | CEO | checked / checked | phone: Add tender and New quotation full width; tender pipeline columns unchanged |
| 48 | Insurance | `insurance` | CEO | checked / checked | phone: Add policy full width |
| 49 | Clients | `clients` | CEO | checked / checked | ok (pipeline stage buttons are two-line by design) |
| 50 | Payment requests | `payreq` | CEO | checked / checked | ok |
| 51 | JA app data | `ja` | CEO | checked / checked | ok |
| 52 | Switch from JA | `jaswitch` | CEO | checked / checked | phone: Areas tables keep the area column in view and scroll |
| 53 | Asset Management | `assets` | CEO | checked / checked | phone: Add unit full width, other actions share the row. Maintenance tab: the due-date column ("tarikh akhir 22 Okt 2026") ran over its 130px column in Malay; the column now fits its text |
| 54 | Contracts | `contracts` | CEO | checked / checked | phone: odd last tile takes the whole row |
| 55 | Branches | `branches` | CEO | checked / checked | ok |
| 56 | Finance | `finance` | CEO | checked / checked | ok |
| 57 | PWVSB credit | `credit` | CEO | checked / checked | ok |
| 58 | Procurement | `purchasing` | CEO | checked / checked | ok |
| 59 | Licences | `compliance` | CEO | checked / checked | ok |
| 60 | Yearly self-audit | `selfaudit` | CEO | checked / checked | ok |
| 61 | RBA readiness | `rba` | CEO | checked / checked | company picker in the page head no longer a full-width bar on a computer (440px) |
| 62 | Audit trail | `audit` | CEO | checked / checked | ok |
| 63 | Speak up and assurance | `grc` | CEO | checked / checked | ok |
| 64 | ACT | `act` | CEO | checked / checked | ok |
| 65 | Mandates | `governance` | CEO | checked / checked | ok |
| 66 | Company secretary | `corporate` | CEO | checked / checked | Panel firms tab (also Legal holds, Company files rows): rows drawn as .item had no style and sat flush on the card edge with no divider; now padded list rows with dividers and the status chip on the right |
| 67 | Renewals | `renewals` | CEO | checked / checked | ok |
| 68 | Continuity | `continuity` | CEO | checked / checked | ok |
| 69 | Governance registers | `registers` | CEO | checked / checked | WORST: "RM1,466,400" broke inside the number (RM1,466,40 / 0); long figures now a size smaller. "Set the board limit" button was a bar across the card; now its own size and padded |
| 70 | Quality and compliance | `quality` | CEO | checked / checked | ok |
| 71 | AI data preview | `it-extraction` | CEO | checked / checked | ok |
| 72 | Connections | `connections` | CEO | checked / checked | ok |
| 73 | IT | `it` | CEO | checked / checked | Who does what table: first column kept in view on a phone, edge shadow shows more columns. Phone: Purchases and Joiners/leavers rows ran 8-18px past the card; now wrap inside it |
| 74 | IT purchase fulfilment | `it-procurement` | CEO | checked / checked | ok |
| 75 | Workflow time & quality | `it-metrics` | CEO | checked / checked | phone: coverage chips no longer grow into tall pills; table scrolls with the workflow column in view |
| 76 | HR / IT coordination | `hr-it-intake` | CEO | checked / checked | ok |
| 77 | Websites | `websites` | CEO | checked / checked | ok |
| 78 | Clock | `clock` | COO | checked / checked | ok (COO; camera/attendance screens not touched) |
| 79 | Duty | `mine` | COO | checked / checked | ok (COO) |
| 80 | Claims | `claims` | COO | checked / checked | ok (COO) |

## Left as is (noted)

- Home (`home`): on a 390px phone the Growth card is 9px wider than its column (`.growth-companies`). Home belongs to the
  nav/home engineer in this round; not touched here.
- Dark mode: all new rules use the theme tokens (`--surface`, `--line`, `--accent`, `--unknown`), so they follow the
  office's light/dark choice; spot-checked on Site survey, Staff directory, Arrival cash, Cleaning, Work and Salary
  calculator.
- The site device screen (`device`) is only for the site-device sign-in, which is not in the demo's pilot sign-in list,
  so it was not opened; it draws its own `.page` and gets the same shared rules. The guard phone (`#guard-phone`) is a
  separate full-screen app outside the menu and was not part of this pass.
