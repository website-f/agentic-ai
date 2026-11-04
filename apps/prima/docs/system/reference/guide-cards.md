# Task guide cards (generated)

Guide cards are read-only, step-by-step help for each task, Bahasa Melayu first with English. The screen and Arisha read the same cards, so Arisha's answers match the screen. A card never saves, approves or sends anything, and it shows a task only to people the server already lets do it.

This index lists the English title, who does it, where (screen and button) and its build status. The full card (fields, sources, whom to ask, what happens after Save) is shown in the app and in the source files.

Registered in the shared guide (`guide-registry.ts`): ACT, Central Admin, Finance, HR, Company office. Still read from their own module files: Operations (`ops-guide-cards.ts`), Special Ops and Asset Management (`special-ops-guide.ts`), Work rebalancing (`work-rebalance-guide.ts`). Finance also has its own payment guides (`finance-guides.ts`) and IT has its own in-app IT guide.

## ACT

| Task | Who | Screen and action | Status |
|---|---|---|---|
| Plan the fix for an ACT finding | Only the owner named on that finding. | ACT (act): My findings: fill in Cause, Fix and Done by, then Save the plan. | Ready |
| Mark an ACT finding fixed | Only the owner named on the finding, after the plan is saved. | ACT (act): My findings: fill in Proof, then Mark fixed. | Ready |
| Check the fix for a finding | The Auditor of the team holding the finding, or the ACT Director. High findings: the Auditor can only send back. | ACT (act): Findings: fill in What you checked, then Fix works, close or Not fixed. | Ready |
| Follow up an owner who is late | The Enforcement officer or Auditor of the team holding the finding, or the ACT Director. | ACT (act): Findings: choose how, fill in What the owner said, then Record follow-up. | Ready |
| Record work the Director gave you (audit or report review) | The Auditor of the team given the work, or the ACT Director. | ACT (act): Team work: fill in Done on, Result and What was checked, then Record done. | Ready |
| Set a workflow’s timing | The ACT Director only. | ACT (act): Workflow timing: Set timing, choose the review, fill in the steps and reason, then Save. | Ready |
| Field check of a workflow (every 6 months) | Any ACT staff member. | ACT (act): Workflow timing: Record field check, fill in where, when and the real time of each step. | Ready |
| Check a record pattern in an investigation | The ACT Director or an Auditor opens it; the team given it adds evidence and notes; only the Director closes. | ACT (act): Patterns and investigations: Open investigation, add evidence and notes; the Director closes with the outcome. | Ready |

## All departments

| Task | Who | Screen and action | Status |
|---|---|---|---|
| Finish a hand-over from another department | Only the receivers named on that hand-over. | Hand-overs (handovers): My hand-overs: open the record, then Done or Not needed. | Ready |
| Import existing records from a spreadsheet | Anyone who may add that kind of record. | Hand-overs (handovers): Import: choose the kind, attach the CSV, Check the file, then Import. | Ready |
| See Arisha’s advice on rebalancing your team’s work | Managers with staff under them. | Kerja / Work → Rebalance (Arisha advice) (work): Read the advice and the facts under it. | Ready |
| Move a task to another staff member | A manager in the person’s line, or group leadership. | Kerja / Work → My team → (orang / person) (work): Press "Move or readjust" → "Move to someone else". | Ready |
| Change a task’s due time or priority | A manager in the person’s line, or group leadership. | Kerja / Work → My team → (orang / person) (work): Press "Move or readjust" → "Readjust". | Ready |

## Arms Control

| Task | Who | Screen and action | Status |
|---|---|---|---|
| Add or edit: Armoury or safe | Kept by: Arms Control. The Add button shows only for them. | Arms (None): Press Add (or Edit on an existing record). | Ready |
| Add or edit: Firearm | Kept by: Arms Control. The Add button shows only for them. | Arms (None): Press Add (or Edit on an existing record). | Ready |
| Add or edit: Arms dealer licence | Kept by: Arms Control. The Add button shows only for them. | Arms Control (None): Press Add (or Edit on an existing record). | Ready |
| Add or edit: Armed job agreement | Kept by: Arms Control. The Add button shows only for them. | Arms Control (None): Press Add (or Edit on an existing record). | Ready |
| Add or edit: Arms supplier | Kept by: Arms Control. The Add button shows only for them. | Arms Control, Suppliers (None): Press Add (or Edit on an existing record). | Ready |
| Add or edit: Price list item | Kept by: Arms Control. The Add button shows only for them. | Arms Control, Suppliers (None): Press Add (or Edit on an existing record). | Ready |
| Add or edit: CMS staff member | Kept by: Arms Control. The Add button shows only for them. | CMS, Staff (None): Press Add (or Edit on an existing record). | Ready |

## Arms Control (CMS settings)

| Task | Who | Screen and action | Status |
|---|---|---|---|
| Add or edit: Phone extension | Kept by: Arms Control (CMS settings). The Add button shows only for them. | CMS, Phone desk (None): Press Add (or Edit on an existing record). | Ready |
| Add or edit: CCTV or alarm panel | Kept by: Arms Control (CMS settings). The Add button shows only for them. | CMS, Sites (None): Press Add (or Edit on an existing record). | Ready |

## Arms Control (Special Ops)

| Task | Who | Screen and action | Status |
|---|---|---|---|
| Raise an arms request | The licensed company (company manager) or Arms Control. | Arms control (arms): Arms control → your company → Arms requests → New arms request | Ready |
| Correct a request sent back | The licensed company (company manager) or Arms Control. | Arms control (arms): Arms control → your company → Arms requests → "Correct and resubmit" (the requester only) | Ready |
| Review an arms request | The Arms Control Department, not the requester. | Arms control (arms): Arms control → Requests → "Pass to company" or "Send back" | Ready |
| Authorise an arms request | The company manager (holder of the A licence). | Arms control (arms): Arms control → your company → Arms requests → "Authorise" or "Refuse" | Ready |
| Plan an armed job | The company manager (holder of the A licence). | Arms control (arms): Arms control → your company → Armed jobs → Plan an armed job | Ready |
| Update an armed job | The company manager (holder of the A licence). | Arms control (arms): Arms control → your company → Armed jobs → the job line | Ready |

## Asset Management

| Task | Who | Screen and action | Status |
|---|---|---|---|
| Record a rent payment | The Asset Management team. | Asset Management (assets): Asset Management → Rent and arrears → the unit → Record payment | Ready |
| Record a rent follow-up | The Asset Management team. | Asset Management (assets): Asset Management → Rent and arrears → the unit → Record follow-up | Ready |
| Record WhatsApp reminder consent | The Asset Management team. | Asset Management (assets): Asset Management → Rent and arrears → WhatsApp reminders → Agreed / Stop | Partly built |
| Ask to buy furniture or fittings | The Asset Management team. | Asset Management (assets): Asset Management → Purchases → Ask | Ready |
| Receive a bought asset | The Asset Management team. | Asset Management (assets): Asset Management → Purchases → the approved line → Received | Ready |
| Decide a purchase request | The Finance Director (up to RM10,000), the COO or the CEO; never the asker. | Asset Management (assets): Asset Management → Purchases → Approve / Refuse | Ready |

## Asset Management team

| Task | Who | Screen and action | Status |
|---|---|---|---|
| Add or edit: Rental unit | Kept by: Asset Management team. The Add button shows only for them. | Asset Management, Units (None): Press Add (or Edit on an existing record). | Ready |
| Add or edit: Tenant and agreement | Kept by: Asset Management team. The Add button shows only for them. | Asset Management, Units (None): Press Add (or Edit on an existing record). | Ready |
| Add or edit: Work order | Kept by: Asset Management team. The Add button shows only for them. | Asset Management, Maintenance (None): Press Add (or Edit on an existing record). | Ready |
| Add or edit: Asset (non-electronic) | Kept by: Asset Management team. The Add button shows only for them. | Asset Management, Assets (None): Press Add (or Edit on an existing record). | Ready |

## Central Admin

| Task | Who | Screen and action | Status |
|---|---|---|---|
| Company file: prepare the draft | The Head of Company (company manager) or the Deputy Chief of Staff. | Company secretary (corporate): Company secretary > Company files tab > "Open and edit" > "Save as draft". | Ready |
| Company file: check against SSM | The Deputy Chief of Staff, never on their own draft. | Company secretary (corporate): Company secretary > Company files > "Open" > "Check against SSM". | Ready |
| Licence and registration renewal | An admin executive prepares; a company manager who did not prepare the papers signs; the Deputy Chief of Staff confirms. | Renewals (renewals): Renewals > choose the licence > "Open renewal", tick the papers, "Sign the application", "Record fee", "Record submission", "Record new certificate". | Ready |
| Panel firms | The Deputy Chief of Staff for audit and secretary firms; PWVSB legal for law firms. | Company secretary (corporate): Company secretary > Panel firms > "Add firm", "Record review", "Take off the panel". | Partly built |
| PWVSB credit: record, stamping and collateral correction | The credit officer. | PWVSB credit (credit): PWVSB credit > "Record new financing"; inside a loan: "Record repayment", "Agreement stamped", "Correct collateral record", "Correct stamping, charge or signing date". | Ready |
| Director Office: reports, meetings and CEO instructions | The Director Office Administrator. | Director Office (doa): Director Office > reports, meetings and CEO instructions. | Ready |
| My tasks: finish with proof | The task owner. | Work (work): Work > the task > "Finish with proof", "Ask for more time" or "Stuck? Ask for help", then "Send". | Ready |
| Legal flags (directors only) | The director named on each flag. | Director Office (doa): Director Office > Legal flags > "History". | Ready |
| KPKT licence check for PWVSB loans | The Deputy Chief of Staff, with counsel’s confirmation. | PWVSB credit (credit): PWVSB credit > open a loan > "Record licence check". | Partly built |
| Adviser budgets and invoices | The keeper of the list proposes budgets and records invoices; the Finance Director agrees budgets; someone else checks each invoice. | Company secretary (corporate): Company secretary > Panel firms > "Propose budget", "Agree budget", "Record invoice", "Pass to Finance", "Query". | Partly built |
| Emergency delegation and succession register | The CEO or the Chief of Staff for group posts; the company manager for the company’s posts; approved by the CEO or the Chief of Staff. | Company secretary (corporate): Company secretary > Delegations > "Record delegation", "Approve", "End". | Partly built |

## Company manager or admin executive

| Task | Who | Screen and action | Status |
|---|---|---|---|
| Add or edit: Site | Kept by: Company manager or admin executive. The Add button shows only for them. | Sites (None): Press Add (or Edit on an existing record). | Ready |
| Add or edit: Post at a site | Kept by: Company manager or admin executive. The Add button shows only for them. | Sites (None): Press Add (or Edit on an existing record). | Ready |
| Add or edit: Patrol checkpoint | Kept by: Company manager or admin executive. The Add button shows only for them. | Sites (None): Press Add (or Edit on an existing record). | Ready |
| Add or edit: Company licence or registration | Kept by: Company manager or admin executive. The Add button shows only for them. | Licences (None): Press Add (or Edit on an existing record). | Ready |

## Company manager, admin executive or the Chief of Staff

| Task | Who | Screen and action | Status |
|---|---|---|---|
| Add or edit: Insurance policy | Kept by: Company manager, admin executive or the Chief of Staff. The Add button shows only for them. | Insurance (None): Press Add (or Edit on an existing record). | Ready |
| Add or edit: Insurance claim | Kept by: Company manager, admin executive or the Chief of Staff. The Add button shows only for them. | Insurance (None): Press Add (or Edit on an existing record). | Ready |
| Add or edit: Bond or guarantee | Kept by: Company manager, admin executive or the Chief of Staff. The Add button shows only for them. | Insurance (None): Press Add (or Edit on an existing record). | Ready |

## Company office

| Task | Who | Screen and action | Status |
|---|---|---|---|
| Share out the office desks | The company office head only: the GM where there is one, otherwise the Company Manager. | Company office (office): Desks panel → "Share out desks" → "Save desks". | Ready |
| My desk work today | The company office head and executives. | Company office (office): Work panel → "Show only mine" → open the line. | Ready |
| Covering a desk while the owner is away | The backup the head set. | Company office (office): Home → "You hold … today", or the Desks panel. | Ready |
| Other companies your office runs | The Chief of Staff sets which office runs the company, with a reason. The office head shares out the desks; executives work the desks they hold. | Company office (office): The "Companies your office also runs" panel → choose the company. | Ready |
| Prepare a quotation | The company admin team who may prepare quotations. | Tenders and quotations (commercial): "New quotation" → "Save draft" → open the draft → "Send to manager for approval". | Partly built |
| Approve or return a quotation | The Company Manager / GM. | Tenders and quotations (commercial): Open a "Waiting for approval" quotation → "Approve" or "Return for changes". | Ready |
| Correct a returned quotation | The company admin team who may prepare quotations. | Tenders and quotations (commercial): Open the "Returned for changes" quotation → "Correct guards, rate or date" → "Save correction" → open it again → "Send to manager for approval". | Ready |
| Monitor all company offices | Group leaders only (CEO, COO, FD, CoS, DCoS, Chairman, Vice Chairman). | Company office (office): "All office work, by desk" → pick a company to see its office. | Ready |

## Finance

| Task | Who | Screen and action | Status |
|---|---|---|---|
| Prepare a payment | Finance data entry Finance team deputy Finance team leader Finance Director CEO | Finance > Payments tab > "New payment" button (finance): Finance > Payments tab > "New payment" button | Ready |
| Review a payment | Finance team deputy Finance team leader Finance Director CEO | Finance > Payments > "Waiting for you" > open the row > "Review" or "Return" (finance): Finance > Payments > "Waiting for you" > open the row > "Review" or "Return" | Ready |
| Approve or return a payment | Finance Director CEO COO | Finance > Payments > open the row > "Approve" or "Return" (COO: Finance screen, "Payments to approve") (finance): Finance > Payments > open the row > "Approve" or "Return" (COO: Finance screen, "Payments to approve") | Ready |
| Record the release | Finance data entry Finance team deputy Finance team leader | Finance > Payments > open an "Approved" payment > "Record release" (finance): Finance > Payments > open an "Approved" payment > "Record release" | Ready |
| Make a payment request | Company manager | Payment requests > "New payment request" (payreq): Payment requests > "New payment request" | Ready |
| Check or approve a payment request | Department head Finance team deputy Finance team leader Finance Director CEO COO | Payment requests > "Waiting for you" > open > your step's button or "Return" (payreq): Payment requests > "Waiting for you" > open > your step's button or "Return" | Ready |
| Daily cash pay list | Finance data entry Finance team deputy Finance team leader | Finance > Checks > choose the company > Paying out > Daily cash pay > "New list" (finance): Finance > Checks > choose the company > Paying out > Daily cash pay > "New list" | Ready |
| Hold and pay the daily cash | CEO COO | Finance > "Daily cash you hold" (finance): Finance > "Daily cash you hold" | Ready |
| Enter a management fee from the agreement | The Finance Director or the CEO. | Finance (finance): Management fees: Enter or Change on that company. | Ready |
| Check the monthly management fee bills | Finance, the COO and the CEO; the OGM (Goodwill only); the Operations Director (Sasa Team only). | Finance (finance): Management fee bills (draft): choose the month. | Ready |

## Foreign Worker Management, or the company manager or admin executive

| Task | Who | Screen and action | Status |
|---|---|---|---|
| Add or edit: Hostel | Kept by: Foreign Worker Management, or the company manager or admin executive. The Add button shows only for them. | Hostels (None): Press Add (or Edit on an existing record). | Ready |

## Goodwill Empire (store)

| Task | Who | Screen and action | Status |
|---|---|---|---|
| Issue a Goodwill item to a guard | Goodwill's storekeepers and Procurement. | Procurement (purchasing): Store: choose the item, Issue, choose the guard, the OM and the patrolling officer. | Ready |

## Government Operations

| Task | Who | Screen and action | Status |
|---|---|---|---|
| Pass on a Goodwill item: OM, patrolling officer, guard | The named OM; the OGM may record the patrolling officer's and guard's steps. | Duty (mine): Goodwill items: Receive, then Pass on with a signature or slip. | Ready |

## Government Operations (Goodwill Empire)

| Task | Who | Screen and action | Status |
|---|---|---|---|
| Monitor government sites: profit, pay, leave, clients | The OGM, government OMs and Regional OMs (own area), group leadership. | Regional ops (ops): Sites panel: choose the month and a tab. | Partly built |

## HR

| Task | Who | Screen and action | Status |
|---|---|---|---|
| Add or edit: Office staff member | Kept by: HR. The Add button shows only for them. | People (None): Press Add (or Edit on an existing record). | Ready |
| Apply for leave | Office staff with their own staff record. | My details (mine): Leave → Ask for leave | Ready |
| Clock in and out | Office staff with their own staff record. Guards clock in on the site device. | Clock (clock): Clock in, then Clock out. | Ready |
| Ask for flexible hours or days | Active office staff. | Clock (clock): Ask for flexible hours or days | Ready |
| My policies, training and appraisal | Active office staff. | Clock (clock): The policies, appraisal and training sections. | Ready |
| Report an office accident or dangerous occurrence | HR, the company manager, and that company’s OSH coordinator. | HR (hr): Office OSH → report an incident | Partly built |
| New office staff member | HR only. | People (people): Press Add (Office staff member). | Ready |
| Decide staff leave | HR decides; the Vice Chairman (the CEO during the pilot) consents. | HR (hr): Leave requests → Decide | Ready |
| Record a statutory filing | HR only. | HR (hr): Joining and leaving → Filings | Ready |
| Vacancy | HR or the company manager raises it; the CEO approves; the company head signs. | HR (hr): Vacancies | Partly built |
| HR case, discipline or sexual harassment | HR opens it; only the HR Director or the CEO records the outcome. | HR (hr): HR cases | Ready |
| Guard KDN card, vetting, CSG and TNG | HR, the guard’s company manager, and Operations for their area. | Guards (people): Guard training and papers | Ready |
| Training and yearly appraisal (HR) | HR only. | HR (hr): Training / Appraisals | Ready |
| Basic pay change | HR asks; the Chief of Staff or Deputy verifies; the Vice Chairman consents. | HR (hr): Pay changes | Ready |
| Monthly staff payroll | HR prepares, the Chief of Staff approves, the COO approves, Finance pays. | Staff payroll (staffpay): Open the month, then your step with a comment. | Partly built |
| Staff overtime settings | HR only. | HR (hr): Staff overtime | Partly built |

## Head of Company (draft), Deputy Chief of Staff (checks against SSM), CEO

| Task | Who | Screen and action | Status |
|---|---|---|---|
| Add or edit: Company master record | Kept by: Head of Company (draft), Deputy Chief of Staff (checks against SSM), CEO. The Add button shows only for them. | Group today, Companies (None): Press Add (or Edit on an existing record). | Partly built |

## IT

| Task | Who | Screen and action | Status |
|---|---|---|---|
| Add or edit: Domain or website | Kept by: IT. The Add button shows only for them. | IT, Domains and websites (None): Press Add (or Edit on an existing record). | Ready |

## Operations

| Task | Who | Screen and action | Status |
|---|---|---|---|
| Record client satisfaction | OMs, Regional OMs, the OGM, the Operations Director and officers (own area). | Clients (clients): Open the client, Act, fill in who and how, choose the score, Save rating. | Ready |
| Log and close a client complaint | OMs, Regional OMs, the OGM, the Operations Director and officers (own area). | Clients (clients): Open the client, Act, write the complaint in the note, Log complaint; close it with what was done. | Ready |

## Private Operations (Sasa Team)

| Task | Who | Screen and action | Status |
|---|---|---|---|
| Monitor private sites: profit, pay, leave, clients | The Operations Director, private OMs and Regional OMs (own area), group leadership. | Regional ops (ops): Sites panel: choose the month and a tab. | Partly built |

## Procurement executive

| Task | Who | Screen and action | Status |
|---|---|---|---|
| Add or edit: Store item | Kept by: Procurement executive. The Add button shows only for them. | Procurement, Store (None): Press Add (or Edit on an existing record). | Ready |

## Transport head

| Task | Who | Screen and action | Status |
|---|---|---|---|
| Add or edit: Vehicle | Kept by: Transport head. The Add button shows only for them. | Vehicles (None): Press Add (or Edit on an existing record). | Ready |
