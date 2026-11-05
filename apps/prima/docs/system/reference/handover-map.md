# Hand-over map between departments (generated)

Fauzan, 2 Nov 2026: "Key in once and all department get the data needed." When one desk saves a record, Prima sends each listed desk either a **to-do** (something to act on, with a due time) or an **info** notice. Each person sees theirs on the **Hand-overs** screen. A hand-over is a link to the record; the screen it opens still checks the person's own permissions.

Source: `packages/core/src/org-links.ts` (`ORG_FLOWS`), combined candidate round 5. This map arrives with PR #56 (Connect departments), which is not merged to main.

**Desks**: hr = HR, it = IT, finance = Finance, fwm = Foreign Worker Management, procurement = Procurement and Goodwill store, asset = Asset Management, legal = Legal, pdpa = PDPA officer, cms = CMS command centre, transport = Transport, chief_of_staff = Chief of Staff office, director_office = Director Office, act = ACT (Audit, Compliance and Transformation), company_office = Company office (manager and admin executives), coo = COO, ceo = CEO

**Never routed** (these actions never create a hand-over, by design): `grc.whistle`, `arms.`, `hr.case_`, `pdpa.`, `staff.face_`, `person.pin`, `user.access.review`, `it.access.`, `confidentiality.`, `file.open`

## New office staff joins

- **Keyed by:** HR
- **Record:** Office staff record (HR form)
- **Status:** Live (on main)
- **Note:** HR keys the staff once on the record form. IT works from the HR/IT joining request (hr-it-intake) for that person; the hand-over is done only once IT has recorded the Microsoft identity there, and not needed only when HR cancels it.

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| HR | todo | Open the HR/IT joining request for this person, so IT can prepare the account and device. | 1 days |
| IT | todo | Prepare the Microsoft account, device and Prima access through the joining intake. | 3 days |
| Finance | todo | Add the new staff to the staff payroll; the salary account is verified separately. | 7 days |
| Chief of Staff office | todo | Check the new staff is added to the group medical and insurance cover. | 7 days |
| Company office (manager and admin executives) | info | A new staff member is joining your company. |  |

## Staff leaves: access closed

- **Keyed by:** HR
- **Record:** Leaving date on the staff record
- **Status:** Live (on main)
- **Note:** Prima closes the account itself on the day; these are the steps outside Prima.

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| IT | todo | Disable the Microsoft account and collect devices and access cards. | 1 days |
| Finance | todo | Prepare the final pay and stop the salary from the leaving date. | 7 days |
| Procurement and Goodwill store | info | Collect any uniform or equipment issued to the leaver. |  |

## Basic pay change

- **Keyed by:** HR
- **Record:** Pay change request
- **Status:** Live (on main)
- **Note:** Approval stays CoS then COO with VC consent (HR #51). No amount is shown in the hand-over.

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| Finance | info | A pay change is waiting for approval; it reaches payroll once approved. |  |

## Salary account change

- **Keyed by:** HR
- **Record:** Salary account change
- **Status:** Live (on main)
- **Note:** The masked account is on the request; Finance verifies it by call-back (payee checks in Finance #49).

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| Finance | todo | Verify the new salary account with the staff before the next pay run. | 3 days |

## Staff claim submitted

- **Keyed by:** HR
- **Record:** Medical, optical or travel claim
- **Status:** Live (on main)
- **Note:** Receipt wallet and payment list are in Finance #49.

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| Finance | info | A staff claim is on its way; it joins the payment list once approved. |  |

## Expense submitted

- **Keyed by:** Company office (manager and admin executives)
- **Record:** Expense request
- **Status:** Live (on main)

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| Finance | info | An expense is on its way; it joins the payment list once approved. |  |

## Purchase raised

- **Keyed by:** Procurement and Goodwill store
- **Record:** Purchase request with quotes
- **Status:** Live (on main)
- **Note:** Three quotes and COO/CEO approval stay inside Procurement and IT.

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| Finance | info | A purchase is being approved; expect the supplier invoice and payment. |  |

## Goodwill store issues equipment to a guard

- **Keyed by:** Procurement and Goodwill store
- **Record:** Stock issue (rental or sale, bill-to company)
- **Status:** Live (on main)
- **Note:** The billing draft itself is Gov Ops #54.

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| Finance | info | A Goodwill billing line was added for this company (rental or sale). |  |
| Company office (manager and admin executives) | info | Equipment was issued to one of your guards; it will be billed by Goodwill. |  |

## Guard disputes an equipment hand-over

- **Keyed by:** Company office (manager and admin executives)
- **Record:** Signed receipt disputed
- **Status:** Live (on main)
- **Note:** Gov Ops #54.

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| Procurement and Goodwill store | todo | Resolve the disputed hand-over with the OM and the guard. | 3 days |
| ACT (Audit, Compliance and Transformation) | info | An equipment hand-over was disputed. |  |

## Merdeka bills device rental

- **Keyed by:** IT
- **Record:** IT rental bill
- **Status:** Live (on main)
- **Note:** Payment is recorded by Finance on the same bill (IT pilot).

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| Finance | todo | Record the Merdeka rental invoice in SQL Account for this company. | 7 days |
| Company office (manager and admin executives) | info | Merdeka sent this month’s device rental bill. |  |

## Hostel bill received

- **Keyed by:** Foreign Worker Management
- **Record:** Hostel bill
- **Status:** Live (on main)

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| Finance | todo | Pay the hostel bill by its due date and record the payment once. | 7 days |

## Hostel bill paid

- **Keyed by:** Finance
- **Record:** Hostel payment (account, day, reference)
- **Status:** Direct (the receiving desk works it on its own screen)
- **Note:** Finance #49 already shows the payment on FWM’s hostel screen; this adds the notice.

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| Foreign Worker Management | info | The hostel bill is paid; the record is on the bill. |  |

## Foreign worker permit renewal submitted

- **Keyed by:** Foreign Worker Management
- **Record:** PLKS / passport / FOMEMA renewal
- **Status:** Live (on main)

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| Finance | todo | Prepare payment of the levy and renewal fees for this renewal. | 5 days |
| Company office (manager and admin executives) | info | A permit renewal was submitted for one of your workers. |  |

## SOCSO claim started

- **Keyed by:** HR
- **Record:** SOCSO claim
- **Status:** Live (on main)

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| Finance | info | A SOCSO claim may change sick pay (EA s.60F(4)); hold the affected days until settled. |  |
| Company office (manager and admin executives) | info | A SOCSO claim was started for one of your staff. |  |

## Serious site case raised

- **Keyed by:** Company office (manager and admin executives)
- **Record:** Case (incident) report
- **Status:** Live (on main)
- **Note:** Only P1 and P2 cases (the two most urgent of the guidebook severities). Escalation inside operations is unchanged.

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| CMS command centre | info | A serious case was raised at a site; watch it until closed. |  |
| Chief of Staff office | todo | Check whether an insurance claim or notice to the insurer is needed. | 3 days |
| COO | info | A serious case was raised at a site. |  |

## Site risk assessment with high risks

- **Keyed by:** Company office (manager and admin executives)
- **Record:** OSH risk assessment
- **Status:** Live (on main)

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| HR | todo | The OSH coordinator reviews the high risks and the controls. | 7 days |

## New client

- **Keyed by:** Company office (manager and admin executives)
- **Record:** Client account and sites
- **Status:** Live (on main)

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| Finance | todo | Open the customer in SQL Account with the e-Invoice details. | 5 days |
| CMS command centre | info | A new client and its sites are coming on; prepare monitoring. |  |

## Client leaves

- **Keyed by:** Company office (manager and admin executives)
- **Record:** Client offboarding
- **Status:** Live (on main)

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| Finance | todo | Final invoice, deposit refund and guarantee release for this client. | 14 days |
| Procurement and Goodwill store | todo | Collect Goodwill equipment from the client’s sites. | 14 days |
| IT | todo | Collect site devices and close site system accounts. | 14 days |
| CMS command centre | info | Stop monitoring the client’s sites on the last day. |  |

## Contract signed, mobilisation opened

- **Keyed by:** Company office (manager and admin executives)
- **Record:** Contract
- **Status:** Live (on main)
- **Note:** The W15 stop (an expired licence blocks a new contract) is Central Admin 5C, not built yet.

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| Finance | todo | Set up the billing schedule from the contract. | 7 days |
| Chief of Staff office | todo | Check insurance and the performance guarantee cover the contract. | 7 days |
| Procurement and Goodwill store | todo | Prepare equipment for the new site’s guards. | 7 days |
| HR | info | A new contract needs manpower; see the mobilisation plan. |  |
| CMS command centre | info | A new site will need monitoring from its start date. |  |

## Contract changed

- **Keyed by:** Company office (manager and admin executives)
- **Record:** Contract variation
- **Status:** Live (on main)

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| Finance | info | A contract changed; check the billing schedule. |  |

## Invoice sent to a client

- **Keyed by:** Company office (manager and admin executives)
- **Record:** Client invoice sent
- **Status:** Live (on main)
- **Note:** Receipts are matched on the bank statement in Finance #49.

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| Finance | info | An invoice went out; expect the receipt in the bank statement. |  |

## PWVSB lends to a company

- **Keyed by:** Finance
- **Record:** Credit loan
- **Status:** Live (on main)
- **Note:** Enforcement stays off until counsel validates (V10).

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| Legal | todo | Prepare the loan agreement and stamping. | 7 days |
| Company office (manager and admin executives) | info | A PWVSB loan to your company was recorded. |  |

## Legal matter opened

- **Keyed by:** Legal
- **Record:** Legal matter
- **Status:** Live (on main)

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| Company office (manager and admin executives) | info | A legal matter was opened for your company. |  |
| Finance | info | A legal matter was opened; consider a provision. |  |

## Asset disposed

- **Keyed by:** Asset Management
- **Record:** Asset disposal
- **Status:** Live (on main)
- **Note:** ACT already watches unposted disposals.

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| Finance | todo | Post the disposal in SQL Account. | 7 days |

## Branch settlement approved

- **Keyed by:** Company office (manager and admin executives)
- **Record:** Branch settlement
- **Status:** Live (on main)

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| Finance | todo | Pay the branch manager’s share as approved. | 7 days |

## Bad debt written off

- **Keyed by:** Finance
- **Record:** Receivable write-off
- **Status:** Live (on main)
- **Note:** Finance #49.

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| ACT (Audit, Compliance and Transformation) | info | A receivable was written off. |  |
| Company office (manager and admin executives) | info | A client debt of your company was written off. |  |

## Supplier or payee bank details changed

- **Keyed by:** Finance
- **Record:** Payee change
- **Status:** Live (on main)
- **Note:** Finance #49.

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| ACT (Audit, Compliance and Transformation) | info | Payee bank details changed (fraud watch). |  |

## Bank guarantee called or claimed

- **Keyed by:** Finance
- **Record:** Guarantee
- **Status:** Live (on main)
- **Note:** Finance #49.

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| Legal | todo | Review the guarantee call and the contract position. | 3 days |
| Company office (manager and admin executives) | info | A guarantee of your company was called or claimed. |  |

## Office OSH incident

- **Keyed by:** HR
- **Record:** OSH incident
- **Status:** Live (on main)
- **Note:** HR #51.

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| Chief of Staff office | todo | Check whether an insurance claim is needed. | 3 days |

## Licence renewal fee to pay

- **Keyed by:** Company office (manager and admin executives)
- **Record:** Licence renewal case (KDN, majlis, vendor panel, ISO, fire)
- **Status:** Live (on main)
- **Note:** Central Admin #52 (5C). A lapsed licence already blocks a new contract there (W15).

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| Finance | todo | Pay the renewal fee so the submission is not held up. | 3 days |

## Licence renewed

- **Keyed by:** Company office (manager and admin executives)
- **Record:** Licence renewal case
- **Status:** Live (on main)
- **Note:** Central Admin #52 (5C).

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| Legal | info | A licence was renewed; update tender and contract papers that quote it. |  |
| Company office (manager and admin executives) | info | Your licence was renewed; use the new copy in tenders. |  |

## Guard attendance, patrol and pay from the JA app

- **Keyed by:** Company office (manager and admin executives)
- **Record:** JA app records
- **Status:** Waits (needs a feed or decision first)
- **Note:** Waits for the JA app API (request documents sent 2 Nov 2026).

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| CMS command centre | info | No-shows and SOS alerts within 1 minute. |  |
| Finance | info | Guard pay summary per company for payment and SQL Account. |  |

## SQL Account postings read back

- **Keyed by:** Finance
- **Record:** SQL Account ledger
- **Status:** Waits (needs a feed or decision first)
- **Note:** Waits for a read-only SQL Account link; staff paste the export today.

| Goes to | Kind | What they do | Due |
|---|---|---|---|
| ACT (Audit, Compliance and Transformation) | info | Postings missing in SQL Account show as ACT signals. |  |
