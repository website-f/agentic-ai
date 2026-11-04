# 3. Business rules

This page explains the rules in business terms. The exact numbers, their legal or policy source and their approval
status are in the generated [rule register](reference/rule-register.md). Where a number here is marked *proposed*, it is
not yet approved by the owner.

## 3.1 Principles every screen follows

1. **The licensed company decides its own matters.** PWVSB monitors, coordinates and acts only under a signed mandate.
   Closing cases, approving quotations, handling firearms and signing licence renewals stay with the company.
2. **Nobody approves, checks or releases their own work.** The maker never checks, the checker never approves, and the
   approver never releases or receives. The server refuses it; the screen does not just hide the button.
3. **Every decision carries a reason.** Every approver gives at least a comment (owner, 31 Oct 2026). Sending back,
   refusing, escalating and stepping in always need a reason.
4. **Proof, not ticks.** Cases are reported, verified, resolved and confirmed with photo or document proof
   (`CASE-PROOF`). Photos come only from the in-app camera with a burned-in time and GPS stamp; the server keeps its own
   time and a SHA-256 fingerprint. "Paid" comes only from a recorded payment, never from a tick.
5. **Unknown is never green.** A figure with no source, a feed that is late, or an obligation with no proof shows as
   Unknown, never as zero, fine or compliant.
6. **Key once, reuse everywhere.** A record is keyed once by the desk that owns it and handed to every desk that needs it
   (the [hand-over map](reference/handover-map.md)). Nobody types the same thing twice.
7. **Prima never pays, files or sends on its own.** Money moves in the bank portal; filings go to LHDN, PERKESO, KWSP,
   SSM, KDN and Customs by staff; messages are sent from the person's own Outlook, WhatsApp or phone. Prima drafts,
   checks, reminds and keeps the reference.
8. **Never charge the guard.** Uniforms and equipment are never charged to guards; lost items go through confirmation.
9. **Controls only where the job needs them** (owner, 2 Nov 2026). Money, pay, bank details and sensitive data get
   second checks; routine work is trusted. Reasons and no self-approval stay everywhere.
10. **Nothing is automatic discipline.** Overdue work is shown to the next level; discipline is always a person's
    decision, recorded with the right to be heard.
11. **Legal points belong to the directors.** Staff screens show the task to do. The legal citation, its source, the
    records it touches and its status are shown only in the directors' legal panels. An open legal point is never shown
    as compliant.
12. **External connections stay unconfigured until verified.** An entered URL, a saved setup request or a successful
    sign-in never turns into a "Connected" claim.

## 3.2 Approval chains (who approves what)

| Matter | Prepared by | Checked by | Approved by | Then |
|---|---|---|---|---|
| Staff payroll (monthly) | HR | | Chief of Staff (or Deputy), then COO | Finance pays and posts to SQL Account |
| Salary amount (yearly or on review) | HR | HR Director verifies | Vice Chairman consents | Takes effect |
| Basic pay or salary account change | HR | HR Director and Finance verify | Vice Chairman consents to the amount | |
| Staff claim | Staff member (or HR for pilot staff) | Company head verifies with a comment; HR checks | COO (no COO needed below the limit the CEO sets) | Finance pays |
| Trip before travelling | Staff member | | Chief of Staff (if not pre-approved or >10% off system km) | Claim picks the approved trip |
| Staff leave (non-guard) | Staff | | HR administrator or higher, then Vice Chairman consents | |
| Guard and officer leave | Guard (site device) or company staff | | OM or higher | Moves up every 12 hours if unanswered |
| Payment (Finance) | Finance data entry | Team deputy or leader | By subject: FD or CEO; the COO for operations, IT, FWM, inventory, transport and Goodwill | Released in the bank portal by someone who did not approve |
| Payment request (company) | Company head | Head of that department approves; Finance checks the calculation | COO (or FD for Finance) | Finance prepares and pays; the request approval is the payment approval |
| Regular payments (statutory, zakat) | Finance | | FD (or CEO), can approve the reviewed batch together | |
| Daily cash pay | Finance lists | | Finance Director only | COO or CEO pays the cash; Finance counts and banks what is returned |
| Budget revision | Team leader or deputy | | FD **and** CEO | |
| Three-statement forecast | Finance | | FD or CEO (not the preparer or sender) | |
| Month-end close | Finance team | Reviewer | FD or CEO, only when SQL is closed, banks reconciled, FS-01/02/06 at RM0.00 | |
| IT or electronic purchase | IT | 3 quotes + online price; >5% above online needs a reason | COO then CEO | Finance pays; IT receives and tags |
| Operational equipment purchase | Procurement executive | 3 quotes + online price; supplier due diligence | COO then CEO | Storekeeper receives; Finance matches PO, goods and e-Invoice |
| Operation claim | Operations Manager | | COO | |
| Office consumables, utilities, rent | Company manager | | Chief of Staff, then COO (final) | |
| Hostel bill | Owning company asks | FWM checks | Operations Director (private) or OGM (government), then COO | Company pays and uploads the slip |
| Quotation | Admin executive | | Company manager (within written authority) | Sent to client |
| Tender bid | Admin executive ticks the protocol | Preparer signs | Company manager signs | Submission slip |
| Vacancy | HR or company manager | | CEO approves; company head signs | |
| Promotion | HR | HR Director | CEO, then Vice Chairman consents | Applied on the effective date |
| Transfer or secondment | HR | | Per chain; secondment needs CEO consent | Transfer is fresh employment, group start date kept |
| Corporate structure change | Company | | PWVSB (Deputy Chief of Staff) with a reason, citing the signed clause | Board resolution recorded |
| Licence renewal | Company prepares papers | Company manager signs (never the preparer) | Central Admin confirms the new expiry | |
| Arms request | Company | Arms Control reviews | Company manager (A licence holder) authorises; Legal clears; COO or CEO approves spend | Someone other than the requester verifies |
| Branch settlement | Branch | | Company manager under the signed agreement | |
| PWVSB credit default | Credit officer | Bank and subledger reconciled, cure period passed | Credit officer, then Finance Director (legal on a template's first default) | Enforcement case opens; ownership never changes by software |
| ACT improvement | ACT | | COO or CEO | |
| Delegation or succession | Recorder | Evidence (competency; board resolution for succession) | One of CEO, COO or Chief of Staff, never the recorder or the delegate | |
| Approval value limits | | | CEO sets (empty means no limit) | |

The **COO may step in** and accept or return anyone's work, with a reason, only in the departments he directly monitors
(`COO-MONITORS`: IT, Operations, FWM, operations procurement, Transport). The person who was in charge is told.

## 3.3 Operations

- **Working time** (Employment Act): at most 12 hours a day including overtime; one rest day a week. Minimum rest between
  shifts of 8 hours, and 15-minute grace for late clock-in and early clock-out, are *proposed*.
- **Clock-in** opens 60 minutes before the shift. Guards clock in by **face** (match threshold 0.80, *to tune*). A failed
  face check is recorded and opens a P3 identity case; it never refuses the guard.
- **Patrols** are recorded only by tapping coded **NFC tags** (Android Chrome only, so site phones must be Android).
  Default every 2 hours; the Regional OM can set 15 to 480 minutes to follow the client. A patrolling officer commands at
  most 60 guards; an officer shared by several companies is paid by each in proportion to its guards.
- **Guard eligibility**: no guards over 60; a guard may work while KDN vetting is pending only once submitted in eSIMS;
  CSG training within the first year; Nepali guards work only at private sites, and **foreign guards never carry arms**.
- **Attendance alerts**: the company PIC is alerted every 5 minutes until someone acts; if the PIC has not acted within
  15 minutes Operations (OM) may step in for the company.
- **Cases** have severities P1 to P4. Escalation: site officer, patrolling officer, OM, then the Regional OM confirms
  fully resolved. If a level does not act within 15/60/240/1440 minutes (P1/P2/P3/P4, *proposed*), the next level is
  alerted. Above the Regional OM only big matters, by decision: OGM (government) or Operations Director (private), COO,
  CEO.
- **Clients**: a visit or meeting every 30 days, the monthly report by the 7th, the invoice sent with proof within 10
  days after month end, satisfaction rated every 90 days with who gave it (all *proposed* except the invoice rule).
- **Contracts**: a signed contract or letter of award opens mobilisation against 12 workstreams. Critical items block
  go-live; others may be risk-accepted for up to 30 days. Go-live needs the Site Ready-to-Operate Certificate, then
  reviews at day 1, 7, 14 and 30. Billing Method 1 = hours a day x 30.5 x posts; Method 2 = contracted hours; Method 3 =
  hours a day x days in month; or a fixed fee. The method changes only by a signed variation.
- **Branches** sit inside their licensed company. Model A: the company keeps a signed % of billing; B: salaried manager;
  C: a signed % of net profit. Settlements are held while a bank account is unreconciled, wages or EPF are unpaid, or the
  licence has an issue. Wages are never held.

## 3.4 People

- **Leave** follows the Employment Act (8/12/16 days annual by service; maternity 98 days; paternity; at least 11
  public holidays including the compulsory five). Nepali guards get at most 12 days annual leave as in their contract.
- **Sick leave and SOCSO**: MC and hospitalisation are paid at basic pay only, as the law requires. No paid sick leave on
  days PERKESO pays temporary disablement (MC of 4 days or more on an accepted case); injury MC of 3 days or less is
  company sick leave; longer MC is held until PERKESO decides.
- **Minimum wage** RM1,700 a month from 1 Feb 2025. Overtime is built but **off** until HR turns it on and sets rates
  (never below the Act).
- **Joining and leaving**: Prima works out the filings and the last day for each (CP22, SOCSO registration, CP22A and
  others) and reminds about probation and retirement. Retrenchment is a guide, not an automatic step.
- **Discipline** follows the Employment Act with the right to be heard. One group handbook for every guard; a warning
  is valid 12 months. Sexual harassment inquiries are confidential (Part XVA).
- **Staff claims**: medical up to RM1,000 a year (dental inside), optical RM500 every 2 years, yearly check-up
  separately; travel at the per-km rate the Chief of Staff publishes monthly; RM25 food over 90 km; hotel up to RM200 and
  RM50 food a night. Claims within 60 days.
- **Staff clock**: hours 8.30 am to 5.30 pm with a one-hour flexible break. Location is followed only while clocked in;
  no location for 30 minutes shows Unknown (*proposed*). Working from home only after probation, with the playbook signed
  off and results at standard; two check-ins (11:00, 15:00) and an end-of-day report on home days (*proposed*).
  Flexible working requests (s.60P) are answered in writing within 60 days.
- **Foreign workers**: papers remind at 120, 90, 60, 30 and 15 days (15 is urgent), escalating FWM, Chief of Staff (30),
  COO (15), CEO (7). A renewal submitted with its receipt pauses the ladder. Year-10 cap then 6 months home. Passport
  must be valid 12 months at PLKS renewal. Zero recruitment fees; passport location and a private welfare talk at least
  every 90 days; the worker keeps their passport.
- **Hostels**: utilities above RM30 (electricity) and RM20 (water) a head are shared by bed, with notices before any
  deduction and a signed contract clause on file. No accommodation deduction.

## 3.5 Arms

- The licensed company issues, receives and counts firearms; PWVSB Arms Control monitors and coordinates; CMS watches.
- Every issue and return has a **witness** who types their own staff number and PIN. Firearms carry an RFID tag scanned
  at the vault (scan not yet compulsory).
- A firearm not back 15 minutes after due alerts, 30 minutes escalates, 2 hours opens a possible-loss case. A vault door
  opening with no issue, return or count within 15 minutes is flagged.
- Loss or destruction is reported to the police within 14 days (Arms Act s.7(1)). Shooting practice at least every 6
  months. The register book and the online register are both kept and checked.
- Arms requests follow a ten-step path (Arms Control reviews, the company authorises, Legal clears, spend approved,
  verified, register reconciled). Arms trading and import is built but **off** until the CEO switches it on with an
  approved dealer licence.

## 3.6 Finance

- **SQL Account is the books.** Prima shows whether each company's books are complete, reconciled and closed, and holds
  approvals and evidence. Figures older than 48 hours are Unknown. Banks reconciled by the 10th; month closed by the 15th.
- **Payments**: prepared with the SQL document and evidence, reviewed by someone else, approved by someone who neither
  prepared nor reviewed, released by someone who did not approve. Approval is by subject matter. Approvals expire after
  30 days; payments from RM500,000 notify the CEO.
- **Paid to the right person**: a payee is verified by call-back on a number from an independent source; a bank detail
  change holds every unreleased payment to that payee until re-verified.
- **Tax and statutory**: SST at 8% above the RM500,000 threshold; e-Invoice per entity; withholding tax on non-resident
  payments; stamp duty within 30 days; CP204 by the 15th; Form C within 7 months of year end. Financial year ends 31 Dec.
- **Credit**: private clients have credit limits; Operations is warned before adding a post for a client over its limit
  or with an invoice unpaid over 90 days.

## 3.7 Central admin, governance and assurance

- **Renewals** start ahead of expiry (KDN licence 120 days, MOF 90, insurance 90, SSM 60) and step up when late (0, 14,
  30 days). An expired security licence blocks new contracts for that company.
- **Tenders**: a company bids only with a valid KDN licence and insurance; MOF registration for government tenders
  (`COM-TENDER-ELIGIBLE`). Files are named as the tender asks; the technical part carries no company name anywhere
  (`TENDER-FILES`).
- **Mandates**: areas without a live mandate show as Unknown, never covered.
- **PWVSB credit**: a beneficial-interest agreement is collateral only. Interest at most 12% secured, 18% unsecured
  (Moneylenders Act). Charges lodged with SSM within 30 days. Enforcement steps 7 to 9 stay off until counsel approves.
- **ACT findings** are fixed within 14/30/60 days by severity; overdue goes to the Chief of Staff, then the COO after 14
  days and the CEO after 30. High-risk workflows are audited every 6 months, the rest yearly.
- **Speak up**: anyone may report, anonymously if they wish; a report never reaches anyone it names; closures need a
  second handler.
- **PDPA**: breaches to the PDP Commissioner within 72 hours and to affected people within 7 days when harm is
  significant; access and correction requests within 21 days.
- **Continuity**: every system keeps three copies (cloud, own server, emergency). Restore tests every 6 months, drills
  yearly. A copy with no record is Unknown.
