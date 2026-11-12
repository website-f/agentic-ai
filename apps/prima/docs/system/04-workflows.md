# 4. Workflows

Each workflow below lists who does each step and where. "Screen" names are the menu labels in the app (see
[screens/](screens/README.md)). Department hand-overs created by a save are listed in the
[hand-over map](reference/handover-map.md).

Updated 12 Nov 2026 to match the workflow map (codes such as PAY-1 or AM-1 in brackets) and Fauzan's decisions of
11 Nov 2026 (handover item codes, for example C2 or B1). Every workflow below is in the code on main (30ac5a0 and the
office copy); the earlier *(candidate)* marks are gone. Being in the code is not the same as working live: a workflow
whose database part is not installed yet shows "DB not installed" until the CEO-run install (handover A3), and every
connection (Teams, email, Power BI, payments, face engine, guard phone) stays switched off until Fauzan says.
*(Being built)* marks a decision of 11 Nov 2026 that is not in the code yet. The pay, hours and finance decisions of the
same day (C1, C1b, C3, B1, B1b, B2, F1, F9, F11) are described as decided; each is built as its own item in the same
round, so check that item's change before relying on it live. All departments start on 18 Nov 2026.

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
3. Not answered in time, the request moves up a level (rule LEAVE-ESCALATE; C3, 11 Nov 2026: 1 working day per level,
   weekends and public holidays not counted). A refused request can be corrected and sent again as a new request; the
   refused one stays on record.
4. Office staff leave still needs the Vice Chairman's consent (B3, unchanged until the Chief of Staff and HR decide).

### W5. New client and contract to go-live (COM-1)
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

### W6. Branch month and settlement
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

### W9. Quotation (COM-2)
1. Admin executive prepares (draft); numbers can be corrected with a reason (audited). C10 (11 Nov 2026): the cost
   check flags a price below wages, overtime, EPF, SOCSO and EIS, plus hostel and transport for Nepali guards and
   uniform and equipment for all guards, each from a rate entered in the app, never a preset number *(being built)*.
2. **Send to manager for approval**; the company manager approves or returns for changes. The preparer never approves
   their own.
3. Marked sent to client, then accepted or rejected. A won lead needs an accepted quotation.

## People

### W10. Staff joining (HR-1, HR-2)
1. HR keys the new staff member once on the staff form (**People**). The **CEO approved the vacancy** first and the
   company head signed it; for a PWVSB central post the **CEO approves and signs** in one step (C2, 11 Nov 2026).
   Job posts are approved in Prima and posted by hand until the social accounts connect (about May 2027, C11).
   Real staff are loaded in bulk through **Staff directory** with HR's approval step (K2), never by typing SQL.
2. Hand-overs go out: HR opens the **HR/IT joining request**; IT prepares the Microsoft account, device and Prima access;
   Finance adds the person to staff payroll; the Chief of Staff checks group medical cover; the company office is told.
3. Prima lists the filings with their last day (CP22, SOCSO registration and others) on **HR monitor > Joining and
   leaving**; HR records each as filed.
4. Probation is confirmed or extended when due.

### W11. Staff leaving
1. HR records the last day. Access closes from the next day (or HR, the HR Director or CEO closes it now).
2. The HR/IT leaving request asks IT to remove access and collect devices; the store lists items to collect.
3. Filings (CP22A and others) are listed with their deadlines; the EA figures are drafted.

### W12. Monthly staff payroll (PAY-1)
1. HR prepares each employer's month on **Staff payroll** (EPF, SOCSO, EIS, LINDUNG, PCB estimate, HRD, zakat, one-off
   allowances from HR's list) and submits it to the Chief of Staff. Part month (join, leave or transfer): daily rate =
   monthly salary / 26 x working days employed, with the working on the payslip; HR may correct with a reason (C1).
   Staff overtime, including CMS control-room overtime from the CMS roster, goes into the run behind an on/off switch
   HR controls (J3, C12) *(being built)*.
2. The **Chief of Staff (or Deputy) approves**, then the **COO approves**, each with a comment. Either may return it to HR.
3. **Finance pays** through the bank's payroll service, marks it paid and posts to SQL Account. Fauzan, 11 Nov 2026
   (F11): office staff are paid on the **29th of the same month**, so approvals and reminders come before it. Prima
   only drafts the bank, SQL, EPF, SOCSO and PCB files.
4. Staff see and download their own payslips.

Guards and officers are paid from the JA Group app (W12b is a trial only).

### W12b. Guard pay run, TRIAL ONLY (PAY-2)
1. Fauzan, 11 Nov 2026 (B1): **each security company prepares its own run**; the Company Manager names the preparer(s)
   in the company with a reason and sees every run of the company. HR and OMs no longer prepare.
2. Hours paid must equal hours recorded (attendance plus approved leave, public holidays, training and MC days); a line
   that does not match cannot be saved and the run cannot be submitted (B1b). The fix is to the attendance or leave
   record, with its own approval. Paid leave is at basic pay only (C1b); a mid-month joiner is paid the hours worked.
3. The **COO approves** (the CEO stands in during the pilot) with a reason; nobody approves a month they prepared.
4. The pay formulas come from the ACT Director (W31b); public holiday pay is 2 extra days on top of the day (E13).
   Uniform and item deductions are switched off until management and legal decide; equipment is never charged. EPF,
   SOCSO and PCB are outside the 50% deduction cap (E12). The JA app keeps paying guards until Prima takes over
   (1 August 2027).

### W13. Pay change and staff movement
1. HR sets a new basic pay or salary account on the staff form; it takes effect only after the **HR Director verifies**,
   Finance verifies a salary account change, and the **Vice Chairman consents** to the amount.
2. Promotion: HR prepares, HR Director, CEO, then Vice Chairman consents. Transfer to another group company is fresh
   employment with the group start date kept. Secondment needs CEO consent. Nothing changes until the effective date,
   when HR or the CEO applies it.

### W14. Staff claim (HR-9)
1. The staff member scans receipts into **My receipts** (on-phone reading) and claims now or later. Travel needs a trip
   **approved before going**.
2. The **company head verifies** with a comment; **HR checks** against the policy; the Chief of Staff approves trips that
   were not pre-approved or are more than 10% off system km.
3. The **COO approves every claim**: there are no approval value limits yet (B4, Fauzan 11 Nov 2026: set later with
   real data, by the CEO on **Settings > Approval limits**). **Finance pays** and records the reference.

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
4. Welfare: arrival fee check, passport check and private welfare talk every 90 days. A fee, a passport held without
   consent or a concern opens a follow-up that **someone else closes**.
5. Permit reminders before expiry (G10, approved 11 Nov 2026): KDN guard card 60 days, PLKS 90, passport 180, FOMEMA 60,
   foreign worker insurance 60. Overdue hostel bills go to the Chief of Staff after 1 day, the COO after 7 and the CEO
   after 14 (G11).

## Special operations

### W17. Firearm issue and return
1. Before an armed shift, **Arms control > Readiness** shows go or no-go (licence, training, local guard only).
2. The company issues the firearm on **Arms control**: scan the RFID tag, witness types their own staff number and PIN.
3. Overdue: alert at 15 minutes, escalate at 30, possible-loss case at 2 hours (G7, approved 11 Nov 2026). A vault door
   opened with no matching record is flagged after 15 minutes. The RFID scan stays optional until tags can be fitted (C7).
4. Return with scan and witness; vault counts recorded; ammunition differences are never silently adjusted.

### W18. Arms request
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
4. Commissioning: CMS operators verify each call-out contact with a test call; Arms Control accepts the service once
   every contact is verified; the company records the client's acceptance.
5. Messages to a site device are acknowledged within 60 seconds (urgent), 3 minutes (alert) and 15 minutes
   (instruction); video is kept 90 days (G8). CMS device connections come later (D12).

## Finance (FIN-*)

### W20. A payment
1. Finance data entry prepares the payment on **Finance > Payments** with the SQL Account document and evidence.
   Prima fills what it knows from the last payment to that payee.
2. The team deputy or leader **reviews**.
3. The approver by subject (FD or CEO; the COO for his departments on **Finance > Payments to approve**) approves or
   returns with a comment. A returned payment is corrected and resubmitted with its history.
4. Someone who did not approve **releases it in the bank portal** and records the bank reference, confirming the
   account's last 4 digits and name. The CEO is told of every payment from RM200,000 (F1, 11 Nov 2026; the FD may
   adjust it later in Finance settings). An approval expires after 30 days.
5. Approval may instead be given in Teams or SharePoint (FD/CEO choose per payment, never both); every approver's
   comment is copied into Prima. Teams approval stays switched off until Fauzan says (D4).

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

### W23. Cash decisions
1. The daily cash pay route is closed and its old limits are removed (F9, 11 Nov 2026).
2. Cash decisions (arrival cash advance, exceptional guard cash) are the **CEO's**. B2 (11 Nov 2026): the CEO can turn on
   a stand-in so the **FD decides** while the CEO is away or for one named request; the FD's decision needs a reason,
   the CEO is told, and the FD never decides a request they made *(being built)*. Finance and a legal adviser review
   the cash treatment before real cash is used.

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
2. **COO then CEO approve every purchase** (no value limits yet, B4; Teams approval stays off).
3. The order is placed; the goods are received and tagged (IT) or received by a storekeeper (Procurement). Finance
   matches the order, the goods and the e-Invoice before entering it in SQL Account.
4. A rejected request is corrected and sent again with fresh quotes and a fresh approval round.

### W27. Store items to a guard (Goodwill Empire)
1. The store issues to a person, or to the OM to carry: store, OM, patrolling officer, guard.
2. Each person confirms receiving on their own screen (**My details > Items issued to me**), signing on screen or with a
   signed slip and photo. Proof files are checked against the fingerprint in the audit log.
3. Anything not confirmed or disputed shows to Procurement. Items are never charged to the guard.
4. Uniform request (I1, 11 Nov 2026): a Government OM or Regional OM asks for a guard's uniform (1 to 3 pieces, with a
   reason); 3 free pieces in 12 months, the 4th and 5th only if the guard pays (receipt and amount, never from pay), the
   6th refused. The store issues to the OM or refuses with a reason *(being built; its database part waits for the CEO)*.
5. Each company keeps its own SQL Account book (E11, 11 Nov 2026); Goodwill Empire Sdn Bhd is on the item register's
   company list with its own book, entered and verified by Finance.

### W28. Website quarterly review and DNS change *(on main)*
1. IT starts the cycle; the company answers what must change (the IT Manager records it for companies not yet on the
   system); IT prepares; approvals; publication recorded; tests after publication; the company verifies.
2. DNS changes: raised with a before-check, approved by the IT Lead, done, after-check, closed or rolled back.

### W29. Licence renewal
1. Prima opens the renewal ahead of expiry. The company adds the papers, the **company manager signs** (never the
   preparer), the fee goes through Finance, the submission is recorded, the agency is followed up.
2. The new certificate and expiry are recorded; **Central Admin confirms** the new expiry or queries it. Late renewals
   step up.

### W30. Corporate change and SSM filings
1. The company asks PWVSB to approve a corporate change; the **Deputy Chief of Staff approves or rejects with a reason**
   citing the signed clause; the board resolution is recorded.
2. Corporate Admin records each SSM filing: papers ready, secretary lodged, SSM receipt. The company secretary views.

### W31. ACT finding (ACT-1)
ACT (C6, 11 Nov 2026): the **ACT Director** heads ACT; the **ACT Manager** leads the work and is the second checker;
**Team A** and **Team B** each have an Auditor (team lead) and an Enforcement officer. Each team sees its own work; the
Director and the ACT Manager see both.
1. ACT raises a finding; the **owner** saves a plan (cause, fix, date) and marks it fixed with proof.
2. The team's **Auditor checks** ("Fix works" or "Not fixed"); Enforcement follows up. Medium and low findings close on
   that check. A **high finding** then needs the **ACT Manager's second check** (the Director may also give it), never by
   the first checker or whoever raised it.
3. Overdue findings go to the Chief of Staff, then COO (14 days) and CEO (30 days). Never punished automatically.

### W31b. Guard pay formulas and the JA switch-over (PAY-6, ACT-4)
1. The ACT team prepares pay formula amounts; the **ACT Director** (or the CEO) makes them live and chooses where each
   applies (group, region, company, site). Real amounts still come from the ACT Director.
2. JA switch-over: Prima and JA run the same month side by side; every difference is explained; the **ACT Manager**
   (or the Director) checks the report, never someone who explained a difference in it; the CEO switches the area. The
   switch date is not picked yet (D10).

### W32. Speak up report
1. Anyone sends a report on **Speak up and assurance**, anonymously if they wish.
2. The handler acknowledges (within 7 days, *proposed*), investigates and proposes closing; a **second handler agrees**
   before it closes. A report never reaches anyone it names.
3. H1 and H2 (11 Nov 2026): replies sent at the same moment are all kept, and a database wall keeps the report text to
   the handler, the second handler, a named reporter and HR (read only, never a report naming them); leaders and ACT see
   counts only *(being built)*.

### W33. Memo
1. Only the **Chief of Staff** publishes to all staff; only the **COO** publishes to all guards and officers.
2. Readers press "I have read this" within 3 days (G14); the publisher sees who has read it and can remind the rest.

### W34. Hand-over between departments
1. A desk saves a record (for example HR adds a staff member).
2. Prima creates a **to-do** or **info** for each receiving desk with a due time.
3. The receiving person opens it from **Hand-overs**, does the work on their own screen and marks it **Done**, **Not
   needed** or **Noted**. ACT and leaders see what is late or has nobody to receive it. A central employer (PWVSB,
   Merdeka Network, Goodwill Empire, Sasa Team and Perfect Global Logistics, which employs Transport, E5) has no
   company office, so no company-office line is written for its staff.

## Asset Management and governance

### W35. Asset Management variation order (AM-1)
1. After the award, every price change is a variation order (VO) with the contractor's reference and a reason.
2. The Asset Director approves (and the COO too when all VOs pass 10% of the award or the price passes RM50,000).
3. C13 (11 Nov 2026): **every VO, whatever its value, then needs the CEO's consent and then the Chairman's** before it
   is approved and the price changes. Value limits come later. Nobody takes two steps; the asker takes none.

### W36. Related-party deal (GOV-REGISTERS)
1. A related-party deal is recorded in the governance registers.
2. C9 (11 Nov 2026): the CEO, and nobody else, gets an information notice. No board-resolution limit and no block for
   now; limits are set later *(being built)*.

## Settings

### W37. Settings staff enter from 18 Nov (J7)
1. **Settings** (Home menu) lists every setting with its owner and whether it is set yet ("Not set" badges): rates
   (IT device rental, foreign worker recruitment cost, management fees, mileage per km, vehicle rent, quotation cost
   lines), pay rules (guard pay formulas, pay law settings, statutory rates, allowance list), public holidays 2027 (HR
   for staff; the Operations Director or OGM for guards, due 10 Dec 2026), staff directory and company office desks,
   approval limits (decided later) and the staff email Send rules and Power BI report list (server settings kept by IT,
   switched off).
2. Rates are entered in the app with the date they start; a charge with no rate for its date shows "rate not set" and
   is not billed (C5). A person sees the state of the settings their job keeps; for others they see the owner.
