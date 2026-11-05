# 2. Roles and access

Prima decides on the **server** who may see and do what. The menu only hides screens a person does not need; every
button is checked again by the server, and the database enforces the same company and department walls. A screen
showing a button never means the person may press it.

## 2.1 The seven sign-in roles

| Role | Who | What they see |
|---|---|---|
| **Group leadership** (`director`) | The Director Office sign-in that stands in for every pilot role | Everything group leaders see |
| **PWVSB** (`pwvsb_officer`) | All central staff and leaders, refined by department, tier, leadership and job fields (below) | Their own line of work; group data only if a group leader |
| **Company Manager** (`company_manager`) | Head of a licensed company (Company Manager or GM) | Their own company in full, including pay and arms |
| **Admin Executive** (`admin_exec`) | The company's office executives | Their company's admin work: licences, tenders, quotations, guards, insurance |
| **Supervisor** (`supervisor`) | Officers stationed at a site, and patrolling officers (`opsTier: patrol`) | Only their own sites and their own people |
| **Site device** (`site_device`) | The shared phone or tablet kept at a guard post | One site only: face clock in/out, NFC patrol, incident, leave reason, SOS |
| **Guard (own view)** (`guard`) | A guard or officer signing in on their own phone | Only their own record, view only |

System feeds (JA, door, Planner, CMS, tracker, Asset Management, WhatsApp) have their own sign-ins marked
`integration`. They can never open screens.

## 2.2 Refinements on a PWVSB account

| Field | Values | Effect |
|---|---|---|
| Department | operations, hr, arms_control, chief_of_staff, cms, director_office, fwm, pdpa, transport, asset, finance, it, legal, audit, procurement | Decides the person's menu ("line of work") |
| Operations tier (`opsTier`) | patrol, om (Operations Manager), regional (Regional OM), ogm (Operations General Manager), ops_director, coo, ceo | Place in the operations ladder; COO and CEO are group leaders |
| Operations sector | government (Goodwill Empire), private (Sasa Team) | Which side an OM or Regional OM works for |
| Leadership | chairman, vice_chairman, finance_director, cos (Chief of Staff), deputy_cos | Group leaders; the Chief of Staff and Deputy are also the **HR Director** |
| IT role | manager, lead, executive | IT Manager supervises and accepts work (not technical); IT Lead checks technical work |
| ACT role and team | lead (Director), auditor, enforcement; team 1 or 2 | ACT head sees everything to audit it |
| Finance team and role | team 1 to 7; leader, deputy, data_entry | Each team works its own companies; the FD sets teams each year |
| FWM role | manager, deputy, executive, despatch | The despatch carries papers and does not open worker records or payslips |
| Procurement role | manager, executive, storekeeper | Goodwill's Inventory Manager sets rental and sale prices |
| Asset role | director | The Asset Director approves rent letters and notices of demand |
| Flags | creditOfficer, corpSecretary | PWVSB credit officer; company secretary (view-only SSM filings) |
| Branch | a branch ID | A far-branch manager runs the branch, not the company office |

## 2.3 Group data is for group leaders only

Owner decision, 26 Oct 2026: group-wide data is seen only by the **CEO, COO, Finance Director, Chief of Staff, Deputy
Chief of Staff, Chairman and Vice Chairman** (and the **ACT head**, who sees everything in order to audit it). Everyone
else sees only their own line of work and the things they are part of.

Further narrowing:

- **Company overview** ("Company today"): group leaders, plus the company's own manager and admin executives.
- **Arms detail**: CMS, Arms Control, the COO, CEO, Chairman, Vice Chairman and ACT head. Not the Finance Director or the
  Chiefs of Staff. A company manager sees their own company; a supervisor only their own people.
- **Person records and payslips**: FWM sees foreign workers only; central HR sees Malaysian workers and staff only; the
  company manager sees everyone in their own company.
- **Finance screen**: the Finance Director, CEO, Chairman, Vice Chairman, ACT head and Finance team members. The COO sees
  only his own payment approvals there.

## 2.4 How PWVSB reaches a company: authority grants

A PWVSB person sees a company only through a **dated authority grant** derived from a management agreement or board
mandate (`monitor` or `act`). An `act` grant allows only: view, edit and publish rosters, lock attendance, raise and
update cases. **Closing a case always stays with the company.** PWVSB is itself the employer of central staff, so HR and
group leaders need no grant to see PWVSB's own staff.

What the company roles may do in their own company:

| Action | Company Manager | Admin Executive | Supervisor | Site device |
|---|---|---|---|---|
| View | yes | yes | own sites | own site |
| Edit roster | yes | yes | yes | |
| Publish roster, lock attendance | yes | | yes | |
| Raise and update cases | yes | yes | yes | raise only |
| Close cases | yes | | | |
| Tenders and quotations: view, prepare | yes | yes | | |
| Approve a quotation | yes | | | |
| Arms: view and handle | yes | | yes | |
| Insurance view | yes | yes | | |
| Attendance follow-up | yes | yes | yes | |
| Record a disciplinary step | yes | | yes | |
| Site visit, patrol time | yes (visit, patrol) | | visit | |
| Guard profile; pay | yes; yes | yes; yes | profile only | |
| Ask for leave for someone | yes | yes | yes | yes |
| Clock in, patrol scan | | | | yes |

Leave decisions: guards and officers are decided by the **Operations Manager or higher**; other staff by the **HR
administrator or higher**, then the Vice Chairman consents. Unanswered requests move up a level every 12 hours.

## 2.5 Menus by department ("line of work")

A non-leader PWVSB person sees only the screens of their department below, plus the personal screens everyone has (My
details, Clock, Work, Claims, Staff payroll for own payslips, Memos, Vehicles request, IT help, Connections, Speak up,
ACT findings they own, Hand-overs). Group leaders see every screen marked for directors.

| Department | Screens |
|---|---|
| Operations | Regional ops, Procurement, Clients, Contracts, Requests, JA app data, PDPA, Hostels, Sites, Roster, Guards, Attendance, Cases, Foreign workers, SOCSO claims, Reports, Meetings |
| HR | HR monitor, JA app data, People, SOCSO claims, Staff clock, Hostels, Claims, Staff payroll, Reports, Meetings |
| Arms Control | Arms control, CMS, Cases, Audit trail, Reports, Meetings |
| CMS | CMS, JA app data, Arms control, Vehicles |
| Director Office | Director Office, Tenders & quotes, Reports, Meetings |
| Chief of Staff | Requests, Claims, Staff payroll, Insurance, Reports, Meetings |
| FWM | Foreign workers, JA app data, Hostels, People, Reports, Meetings |
| PDPA | PDPA, Vehicles, Reports, Meetings |
| Transport | Vehicles, Reports, Meetings |
| Asset Management | Asset Management, Reports, Meetings |
| Finance | Finance, Staff payroll, Asset Management, PWVSB credit, Procurement, Websites, Reports, Meetings |
| IT | IT, Websites, Connections, Continuity, Reports, Meetings |
| Legal | PWVSB credit, Mandates, Company secretary, Reports, Meetings |
| ACT (audit) | ACT, Speak up and assurance, Audit trail, Websites, Renewals, Reports, Meetings |
| Procurement | Procurement, Reports, Meetings |

Further rules inside operations: Contracts, Clients, JA data and Foreign workers need OM or above; Requests needs OM;
Procurement, Hostels and PDPA need OGM or Operations Director. Far branches show to the branch manager, company manager,
OM and above, ACT and CMS. The IT Manager also sees the IT team's Staff clock (view only).

Each role's first screens (and the phone tab bar):

| Role | First screens |
|---|---|
| Group leaders | Home, Group, Regional ops, Cases |
| Company Manager | Home, Company today, Roster, Tenders & quotes |
| Admin Executive | Home, Licences, Tenders & quotes, Guards |
| Supervisor | Home, Roster, Sites, Cases |
| Operations | Regional ops, Cases, Sites, Roster |
| HR | HR monitor, People, SOCSO claims, Staff clock |
| Arms Control | Arms control, CMS, Cases, Audit trail |
| Finance | Finance, Staff payroll, Asset Management |
| IT | IT, Websites, Clock |

Clock and Work always sit right after the first screen, because staff use them daily.

## 2.6 Data walls

Some group-wide tables have no company column, so the company wall cannot separate them. Each request also carries the
**department walls** the person passes, and the database lets a row through only on a wall the person holds:

| Wall | Who holds it |
|---|---|
| asset_read / asset_write | Asset Management team (write), Finance and leaders oversee (read); ACT reads only |
| act | ACT staff and group leaders |
| pdpa | PDPA officer and monitors |
| bcm | IT (records) and viewers of Continuity |
| offboard | HR, HR Director, CEO (close a leaver's access) |
| corporate, legal, mandates | Company secretary, legal and leaders as each screen describes |
| staff_ids, staff_accounts, staff_company | Who may see full IC numbers, salary accounts, and a company's own staff numbers |
| staff_faces | HR and the HR Director (approve face registrations) |
| hr_cases | HR, the HR Director and the CEO |
| fw_ids | FWM (not the despatch) |
| hr_legal | Directors only (HR legal points) |
| guard_feed | The JA feed sign-in |

## 2.7 Signing in

- **Office staff** sign in with their company **Microsoft 365** account (Entra). The account is linked to a Prima user by
  its Entra object ID, recorded by IT through an audited script, never by name or email.
- **Guards and supervisors** clock in by **face** on the shared site device, and record patrols by tapping NFC tags with
  their staff number and PIN. PINs are stored hashed and never shown again.
- **Development and the test version** offer a "choose who to sign in as" list. On a server this exists only when
  `ALLOW_DEV_LOGIN=true`.
- **Closed accounts**: when HR records a leaver's last day, access closes from the next day; HR, the HR Director or the
  CEO can close it now. A closed account opens nothing.
- **Signing in clocks staff in**; signing out clocks them out.

## 2.8 The pilot and department rollouts

- Rule `PILOT-IT` (owner, 28 Oct 2026): the system starts with the **IT department**. Only the IT team, the COO, the CEO,
  the ACT head, the HR administrator and the Finance Director sign in, and they run the whole system with their own
  menus. Everyone else reaches them on Teams, email or phone; for example the HR administrator enters claims for IT staff
  who are not signed in, and the IT Manager records company answers for websites.
- Each further department joins when the CEO **starts its rollout** (server setting `PRIMA_ROLLOUTS`, never a request
  field). Registered rollouts: Central Admin, Company office, Finance, Government Operations and Procurement, HR, Private
  Operations, Special Operations. An unknown rollout admits nobody.
