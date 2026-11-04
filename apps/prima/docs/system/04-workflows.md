# 4. Workflows

Each workflow below lists who does each step and where. "Screen" names are the menu labels in the app (see
[screens/](screens/README.md)). Steps marked *(candidate)* exist only in the combined candidate, not yet on main.
Department hand-overs created by a save are listed in the [hand-over map](reference/handover-map.md).

## Operations

### W1. A guard's shift: roster, clock-in, patrol, clock-out
1. The company (admin executive, supervisor or company manager) builds the week on **Roster**; the company manager or
   supervisor **publishes** it. Prima warns on hours over 12 a day, no rest day, guards not allowed to work (expired KDN
   card, over 60, foreign guard at a government site).
2. At the post, the guard clocks in by **face** on the **Site device** (from 60 minutes before the shift).
3. During the shift the guard taps each **NFC checkpoint** with staff number and PIN. A checkpoint missed beyond the
   site's patrol time is flagged.
4. The guard clocks out by face. Records that reach the server 5 minutes or more late are marked offline sync.
5. **Attendance** shows each day; the supervisor or company manager locks it.

### W2. A no-show or failed check: alert, replacement, follow-up
1. A guard misses clock-in or fails a check: the company **PIC is alerted every 5 minutes** until someone acts
   (**Attendance**, "Alerting the PIC now"); CMS sees the same alert and may call the guard.
2. The PIC acts: tells the guard, places a replacement under the post, or excuses with a reason.
3. If the PIC has not acted within 15 minutes, the **OM may step in** for the company.
4. Repeated absence appears in "Absence and discipline". A disciplinary step is recorded by the company manager or
   supervisor; the app suggests the handbook step but never issues it.

### W3. A case from report to closure
1. Raised on **Cases** (or **Report incident** on the site device) with severity P1 to P4 and **proof** (stamped photo
   or document). While the JA app owns incidents, they are reported there instead.
2. The level in charge **acknowledges**. Ladder: site officer, patrolling officer, OM, Regional OM. A level that does not
   act in time (15/60/240/1440 minutes by severity, *proposed*) alerts the next.
3. Above the Regional OM, only by an **Escalate** decision with a reason: OGM (government) or Operations Director
   (private), COO, CEO. The CEO's home shows only cases that reached the CEO's own step.
4. **Resolve** with proof; the Regional OM confirms it fully resolved; the company **closes** it (only the company can
   close).

### W4. Leave or an absence reason
1. A guard asks on the site device (staff number + face), or company staff ask for them; office staff ask from **My
   details**. MC documents are attached.
2. Guards and officers: the **OM or higher** decides. Staff: the HR administrator or higher decides, then the Vice
   Chairman consents.
3. Not answered in 12 hours: the request moves up a level. A refused request can be corrected and sent again as a new
   request; the refused one stays on record.

### W5. New client and contract to go-live *(contracts on main; CMS step candidate)*
1. A lead is researched on **Tenders & quotes > Leads** (SSM search, payment record, current provider, site survey). A
   slow or unknown payer needs the company manager to accept the risk. A lead another group company is chasing shows
   as a conflict.
2. A quotation is prepared by the admin executive, approved by the company manager, sent and accepted (W9).
3. The company manager records the signed contract on **Contracts**; mobilisation opens against 12 workstreams due from
   10 days before to 30 days after the start (including W12 CMS activation).
4. Items are marked done; non-critical ones may be risk-accepted. The company manager signs the **Ready-to-Operate
   Certificate** once every critical item is done, then **Go live**.
5. Reviews at day 1, 7, 14 and 30; day 30 checks the first invoice against the contract. Billing changes only through a
   recorded **variation**.
6. On **Clients** the OM and officers log visits, monthly reports, complaints and satisfaction; the company records each
   invoice sent with proof. The company manager can make a time-limited, read-only **client report link**.

### W6. Branch month and settlement *(candidate, PR #61)*
1. A new branch is proposed, its papers and bank accounts verified, a project code set, then activated.
2. Each month the branch prepares its month; it is agreed to SQL Account.
3. The **company manager approves the settlement** under the signed model (A, B or C). Settlements are held while the
   branch is unreconciled, wages or EPF are unpaid, or the licence has an issue.
4. Branch actions not reviewed in 3 days go to the company manager's home, after 7 days to PWVSB.

## Commercial

### W7. A tender from notice to submission
1. The admin executive uploads the papers (notice, arahan petender, specification, forms) on **Tenders & quotes**.
2. The Director Office's AI-drafted **checklist** is checked and confirmed by the Director Office Administrator.
3. The company decides **Teruskan / Tangguh / Tidak bida** with a reason (company manager or Director Office). Questions
   go to the buyer in writing.
4. The admin executive ticks each **protocol step** with who and when; a tender cannot move on with a step not done.
5. Bid files are named as the tender asks; the technical part carries no company name (checked by the app).
6. The **preparer signs**, then the **company manager signs**, then the **submission slip** is recorded. Outcome: won,
   lost or no bid.

### W8. Joint tender (several group companies)
1. The Director Office chooses which companies enter the same tender and sends them the checked checklist.
2. Each company's admin executive fills its own bid; its company manager verifies with the submission slip.
3. 24 hours after closing, the CEO's home shows the joint report: how many entered, filled the guide and slipped.

### W9. Quotation
1. Admin executive prepares (draft); numbers can be corrected with a reason (audited).
2. **Send to manager for approval**; the company manager approves or returns for changes. The preparer never approves
   their own.
3. Marked sent to client, then accepted or rejected. A won lead needs an accepted quotation.

## People

### W10. Staff joining *(candidate for HR Phase 3 and hand-overs)*
1. HR keys the new staff member once on the staff form (**People**). The **CEO approved the vacancy** first and the
   company head signed it.
2. Hand-overs go out: HR opens the **HR/IT joining request**; IT prepares the Microsoft account, device and Prima access;
   Finance adds the person to staff payroll; the Chief of Staff checks group medical cover; the company office is told.
3. Prima lists the filings with their last day (CP22, SOCSO registration and others) on **HR monitor > Joining and
   leaving**; HR records each as filed.
4. Probation is confirmed or extended when due.

### W11. Staff leaving
1. HR records the last day. Access closes from the next day (or HR, the HR Director or CEO closes it now).
2. The HR/IT leaving request asks IT to remove access and collect devices; the store lists items to collect.
3. Filings (CP22A and others) are listed with their deadlines; the EA figures are drafted.

### W12. Monthly staff payroll
1. HR prepares each employer's month on **Staff payroll** (EPF, SOCSO, EIS, LINDUNG, PCB estimate, HRD, zakat, one-off
   allowances from HR's list) and submits it to the Chief of Staff.
2. The **Chief of Staff (or Deputy) approves**, then the **COO approves**, each with a comment. Either may return it to HR.
3. **Finance pays** through the bank's payroll service, marks it paid and posts to SQL Account (by the 7th). Prima only
   drafts the bank, SQL, EPF, SOCSO and PCB files.
4. Staff see and download their own payslips.

Guards and officers are paid from the JA Group app, not here.

### W13. Pay change and staff movement
1. HR sets a new basic pay or salary account on the staff form; it takes effect only after the **HR Director verifies**,
   Finance verifies a salary account change, and the **Vice Chairman consents** to the amount.
2. Promotion: HR prepares, HR Director, CEO, then Vice Chairman consents. Transfer to another group company is fresh
   employment with the group start date kept. Secondment needs CEO consent. Nothing changes until the effective date,
   when HR or the CEO applies it.

### W14. Staff claim
1. The staff member scans receipts into **My receipts** (on-phone reading) and claims now or later. Travel needs a trip
   **approved before going**.
2. The **company head verifies** with a comment; **HR checks** against the policy; the Chief of Staff approves trips that
   were not pre-approved or are more than 10% off system km.
3. The **COO approves** (unless under the CEO's limit). **Finance pays** and records the reference.

### W15. SOCSO (PERKESO) claim
1. The OM or HR presses **Start SOCSO claim** on the person's profile; Prima asks what happened and when the company was
   told, and gives the deadlines and paper checklist.
2. HR submits Form 34 in ASSIST (PERKESO has no API) and records each step: papers sent, reviewing, approved or rejected,
   appeal, paid.
3. MC pay follows `HR-INJURY-MC`. Rehabilitation: return-to-work plan, appointments and **work restrictions** that stop
   the roster placing the person on unsuitable posts; weekly check-ins.

### W16. Foreign worker papers
1. Each paper sits on the reminder ladder (120/90/60/30/15/7 days) on **Foreign workers**.
2. FWM sends the OM a **dated task**; the OM uploads proof; FWM accepts or sends back.
3. **Renewal submitted** with its receipt pauses the ladder. Late steps escalate FWM, Chief of Staff, COO, CEO.
4. Welfare *(candidate, PR #62)*: arrival fee check, passport check and private welfare talk every 90 days. A fee, a
   passport held without consent or a concern opens a follow-up that **someone else closes**.

## Special operations

### W17. Firearm issue and return
1. Before an armed shift, **Arms control > Readiness** shows go or no-go (licence, training, local guard only).
2. The company issues the firearm on **Arms control**: scan the RFID tag, witness types their own staff number and PIN.
3. Overdue: alert at 15 minutes, escalate at 30, possible-loss case at 2 hours.
4. Return with scan and witness; vault counts recorded; ammunition differences are never silently adjusted.

### W18. Arms request *(candidate, PR #53)*
1. The company raises an arms request on **Arms control**.
2. **Arms Control reviews**, then passes it to the company or sends it back (the requester corrects and resubmits saying
   what changed).
3. The **company manager (A licence holder) authorises** or refuses; **Legal clears** or stops; the PDRM or KDN reference
   is recorded; the **COO or CEO approves the spend**.
4. **Someone other than the requester verifies**; the register is reconciled; closed. Every decision takes a reason.

### W19. CMS shift and alarms
1. Arms Control plans the CMS roster (1 Head Control + 1 Monitor Officer every shift) and sets CMS parameters.
2. Operators acknowledge emergencies and alarms; a false alarm is agreed by Head Control (second person).
3. CMS handles missed IP-phone calls and call-backs, and watches vault door events and attendance alerts. CMS monitors
   and escalates; the company decides.
4. Commissioning *(candidate)*: CMS operators verify each call-out contact with a test call; Arms Control accepts the
   service once every contact is verified; the company records the client's acceptance.

## Finance *(candidate, PR #49, unless stated)*

### W20. A payment
1. Finance data entry prepares the payment on **Finance > Payments** with the SQL Account document and evidence.
   Prima fills what it knows from the last payment to that payee.
2. The team deputy or leader **reviews**.
3. The approver by subject (FD or CEO; the COO for his departments on **Finance > Payments to approve**) approves or
   returns with a comment. A returned payment is corrected and resubmitted with its history.
4. Someone who did not approve **releases it in the bank portal** and records the bank reference, confirming the
   account's last 4 digits and name.
5. Approval may instead be given in Teams or SharePoint (FD/CEO choose per payment, never both); every approver's
   comment is copied into Prima.

### W21. Payment request from a company
1. The company head creates the request on **Payment requests** saying what it is for.
2. The head of that department approves; Finance checks the calculation; the COO (or FD for Finance) approves.
3. Finance prepares and pays it (W20) without a second approval.

### W22. Month-end close
1. Bank statements are loaded and reconciled with SQL Account's ledger (Prima pairs lines; staff explain the rest).
2. Ageing, e-Invoice, SST, intercompany and the other monthly checks are done on **Finance > Checks**.
3. The team **sends the close for review**; the reviewer marks it reviewed; the **FD or CEO approves the financials**
   only when SQL is closed, every bank is reconciled with its report, FS-01/02/06 are RM0.00 and exceptions are
   explained.
4. The bank pack and payment pack are reviewed and sent; the monthly company pack is signed off for the board.

### W23. Daily cash pay
1. Finance lists the people paid daily in cash for the week or month and ticks their days.
2. **Only the FD approves.** Finance prepares the cash and hands it to the COO or CEO.
3. The COO or CEO confirms the count, pays each listed person and gives back what was not paid; Finance counts and banks
   it.

## Support departments

### W24. IT help request *(on main)*
1. Anyone asks on **IT > Ask IT for help** (or IT logs it for someone not on the system).
2. The IT Manager assigns it, or an IT person takes it; it is resolved.
3. **The person who asked confirms** "Yes, it is fixed" or "Not fixed" (reopens with the same IT person) within 3 days;
   unanswered after that, it shows as not answered. IT never confirms its own fix.
4. A request 24 hours past its time limit goes to the COO.

### W25. IT job *(on main)*
1. The IT Manager **gives a job** with a named doer and due date (from the IT plan; Arisha may suggest, the manager
   decides).
2. The doer starts and **submits as done with proof**. A technical job gets the **IT Lead's technical check** first.
3. The **IT Manager accepts** or sends back. Nobody accepts their own work; the IT Lead's work is checked by the IT
   Manager too. While the IT Manager is away the COO accepts.
4. A job 3 days late goes to the COO, 7 days to the CEO. The COO may decide anyone's job with a reason; the person in
   charge is told.

### W26. IT or operational purchase
1. IT (or the Procurement executive) raises the purchase with **3 supplier quotes and an online price**, all with
   documents. A chosen quote more than 5% above online needs a reason.
2. **COO then CEO approve** (in Prima; Teams approval integration pending).
3. The order is placed; the goods are received and tagged (IT) or received by a storekeeper (Procurement). Finance
   matches the order, the goods and the e-Invoice before entering it in SQL Account.
4. A rejected request is corrected and sent again with fresh quotes and a fresh approval round.

### W27. Store items to a guard (Goodwill Empire)
1. The store issues to a person, or to the OM to carry: store, OM, patrolling officer, guard.
2. Each person confirms receiving on their own screen (**My details > Items issued to me**), signing on screen or with a
   signed slip and photo. Proof files are checked against the fingerprint in the audit log.
3. Anything not confirmed or disputed shows to Procurement. Items are never charged to the guard.

### W28. Website quarterly review and DNS change *(on main)*
1. IT starts the cycle; the company answers what must change (the IT Manager records it for companies not yet on the
   system); IT prepares; approvals; publication recorded; tests after publication; the company verifies.
2. DNS changes: raised with a before-check, approved by the IT Lead, done, after-check, closed or rolled back.

### W29. Licence renewal *(candidate, PR #52)*
1. Prima opens the renewal ahead of expiry. The company adds the papers, the **company manager signs** (never the
   preparer), the fee goes through Finance, the submission is recorded, the agency is followed up.
2. The new certificate and expiry are recorded; **Central Admin confirms** the new expiry or queries it. Late renewals
   step up.

### W30. Corporate change and SSM filings
1. The company asks PWVSB to approve a corporate change; the **Deputy Chief of Staff approves or rejects with a reason**
   citing the signed clause; the board resolution is recorded.
2. Corporate Admin records each SSM filing: papers ready, secretary lodged, SSM receipt. The company secretary views.

### W31. ACT finding
1. ACT raises a finding; the **owner** saves a plan (cause, fix, date) and marks it fixed with proof.
2. The team's **Auditor verifies** ("Fix works, close" or "Not fixed"); Enforcement follows up.
3. Overdue findings go to the Chief of Staff, then COO (14 days) and CEO (30 days). Never punished automatically.

### W32. Speak up report
1. Anyone sends a report on **Speak up and assurance**, anonymously if they wish.
2. The handler acknowledges (within 7 days, *proposed*), investigates and proposes closing; a **second handler agrees**
   before it closes. A report never reaches anyone it names.

### W33. Memo
1. Only the **Chief of Staff** publishes to all staff; only the **COO** publishes to all guards and officers.
2. Readers press "I have read this"; the publisher sees who has read it.

### W34. Hand-over between departments *(candidate, PR #56)*
1. A desk saves a record (for example HR adds a staff member).
2. Prima creates a **to-do** or **info** for each receiving desk with a due time.
3. The receiving person opens it from **Hand-overs**, does the work on their own screen and marks it **Done**, **Not
   needed** or **Noted**. ACT and leaders see what is late or has nobody to receive it.
