# Record kinds and their forms (generated)

One Add/Edit form engine (`packages/core/src/records.ts`, `RECORD_KINDS`) serves the plain records below. The Add and Edit buttons show only to the people who keep that kind of record, and the server checks again on save. Every save writes the record and a hash-chained audit line with the old and new value of each field.

Some records are deliberately never typed in: stock on hand (it moves only by goods received, issue and return), guards and officers (they are keyed in the JA Group app), and feeds from SQL Account, JA, door, alarm and CCTV systems.

## Company master record (`company`)

- **Kept by:** Head of Company (draft), Deputy Chief of Staff (checks against SSM), CEO
- **Screen:** Group today, Companies
- **Company scoped:** yes
- **Note:** Updates the existing company ID in place. Company code, linked staff, contracts, and historical records remain unchanged. The Head of Company saves a draft; the Deputy Chief of Staff (never the person who saved the draft) or the CEO checks the SSM source document before marking verified; no personal director IDs or bank data.

| Field | Type | Required | Notes |
|---|---|---|---|
| Registered company name | text | yes |  |
| SSM registration number | text | yes |  |
| Incorporation or registration date | date |  |  |
| Registered address | textarea |  |  |
| Business address | textarea |  |  |
| Primary state | text | yes |  |
| Head of company | text |  |  |
| Source document reference | text | yes | Name and reference of the SSM document reviewed. Do not paste personal IDs or upload confidential documents into AI chat. |
| Source review status | select | yes | Choices: Draft, waiting for the SSM check, Checked against the SSM source |

## Site (`site`)

- **Kept by:** Company manager or admin executive
- **Screen:** Sites
- **Company scoped:** yes

| Field | Type | Required | Notes |
|---|---|---|---|
| Site code | text | yes |  |
| Site name | text | yes |  |
| Client | text | yes |  |
| Address | textarea | yes |  |
| Branch | ref |  | Picks a branches record |
| State | select |  | Choices: Pulau Pinang, Kedah, Perlis, Perak, Selangor, Kuala Lumpur, Putrajaya, Negeri Sembilan, Melaka, Johor, Pahang, Terengganu, Kelantan, Sarawak, Sabah, Labuan; Needed when the site has no branch: the OM and Regional OM for this state then cover it. |
| Latitude | number | yes |  |
| Longitude | number | yes |  |
| Clock-in area (metres) | number | yes |  |
| Risk | select | yes | Choices: Low, Medium, High |
| Sector | select | yes | Choices: Private, Government |
| Armed site | bool |  | Needs an arms agreement, police approval and armed guards. |

## Post at a site (`post`)

- **Kept by:** Company manager or admin executive
- **Screen:** Sites
- **Company scoped:** yes

| Field | Type | Required | Notes |
|---|---|---|---|
| Site | ref | yes | Set when created, not edited later; Picks a sites record |
| Post name | text | yes |  |
| Shift pattern | select | yes | Choices: A: 2 x 12 hours, B: 3 x 8 hours, C: day only, D: night only, E: office hours |
| Guards per shift | number | yes |  |

## Patrol checkpoint (`checkpoint`)

- **Kept by:** Company manager or admin executive
- **Screen:** Sites
- **Company scoped:** yes

| Field | Type | Required | Notes |
|---|---|---|---|
| Site | ref | yes | Set when created, not edited later; Picks a sites record |
| Checkpoint name | text | yes |  |
| NFC tag code | text | yes | The code written on the NFC tag. |

## Company licence or registration (`licence`)

- **Kept by:** Company manager or admin executive
- **Screen:** Licences
- **Company scoped:** yes

| Field | Type | Required | Notes |
|---|---|---|---|
| Kind | select | yes | Choices: KDN licence, MOF registration, Insurance, SSM annual return, Council premise licence, Council signboard licence, Vendor registration (client or agency panel), ISO certification, Fire certificate, Other compliance |
| Which one | text |  | For example "MBPJ premise licence, Petaling Jaya office", "Petronas vendor panel", "ISO 9001". |
| Issued by | text |  |  |
| Reference number | text | yes |  |
| Expires on | date |  | Leave empty only if not known: it then shows as Unknown, never green. |

## Insurance policy (`insurancePolicy`)

- **Kept by:** Company manager, admin executive or the Chief of Staff
- **Screen:** Insurance
- **Company scoped:** yes

| Field | Type | Required | Notes |
|---|---|---|---|
| Cover | select | yes | Choices: Public liability, Group personal accident, Group hospitalisation, Foreign worker hospitalisation, Fidelity guarantee, Armed service, Cash in transit, Motor fleet, Fire and office |
| Insurer | text | yes |  |
| Broker | text |  |  |
| Policy number | text | yes |  |
| Sum insured (RM) | number | yes |  |
| Premium (RM) | number | yes |  |
| Starts on | date | yes |  |
| Expires on | date | yes |  |
| Premium due on | date | yes |  |
| Premium paid on | date |  |  |
| Renewal | select | yes | Choices: Not started, Getting quotes, Renewed |

## Insurance claim (`insuranceClaim`)

- **Kept by:** Company manager, admin executive or the Chief of Staff
- **Screen:** Insurance
- **Company scoped:** yes

| Field | Type | Required | Notes |
|---|---|---|---|
| Policy | ref | yes | Set when created, not edited later; Picks a insurancePolicies record |
| Claim reference | text | yes |  |
| What happened | textarea | yes |  |
| Incident on | date | yes |  |
| Amount claimed (RM) | number | yes |  |

## Bond or guarantee (`insuranceGuarantee`)

- **Kept by:** Company manager, admin executive or the Chief of Staff
- **Screen:** Insurance
- **Company scoped:** yes

| Field | Type | Required | Notes |
|---|---|---|---|
| Kind | select | yes | Choices: Performance bond, Tender bond, Bank guarantee, Insurance guarantee |
| Issued by | text | yes |  |
| In favour of | text | yes |  |
| Contract or tender | text | yes |  |
| Amount (RM) | number | yes |  |
| Fee (RM) | number | yes |  |
| Issued on | date | yes |  |
| Expires on | date | yes |  |
| Contract ends on | date | yes |  |
| Released on | date |  |  |

## Vehicle (`vehicle`)

- **Kept by:** Transport head
- **Screen:** Vehicles
- **Company scoped:** yes
- **Note:** Trips, payments and the log keep their own buttons.

| Field | Type | Required | Notes |
|---|---|---|---|
| Plate number | text | yes |  |
| Make and model | text | yes |  |
| Kind | select | yes | Choices: Car, Van, Motorcycle, Patrol car, Lorry |
| Odometer (km) | number | yes |  |
| Road tax expires | date | yes |  |
| Insurance expires | date | yes |  |
| PUSPAKOM due | date |  |  |
| Permit expires | date |  |  |
| Next service date | date | yes |  |
| Next service (km) | number | yes |  |
| GPS tracker ID | text |  |  |
| Dashcam ID | text |  |  |
| Driver health monitor fitted | bool |  |  |

## Store item (`stockItem`)

- **Kept by:** Procurement executive
- **Screen:** Procurement, Store
- **Company scoped:** yes
- **Note:** Stock on hand changes only through goods received, issues and returns, never by typing it in.

| Field | Type | Required | Notes |
|---|---|---|---|
| Item code | text | yes |  |
| Item | text | yes |  |
| Kind | select | yes | Choices: Uniform, Guard equipment, Device (radio, bodycam, translation), Patrol device or NFC token, Cleaning equipment or product |
| Size | text |  |  |
| Used up (not returned) | bool |  |  |
| Goodwill charges the company | select |  | Choices: Monthly rental, One-off sale |
| Rental per month (RM) | number |  | Set by the Inventory Manager only. Left empty, the bill shows the price as missing. |
| Sale price (RM) | number |  | Set by the Inventory Manager only. Left empty, the bill shows the price as missing. |
| Reorder when stock falls to | number | yes |  |
| Opening stock counted | number | yes | Set when created, not edited later; Only when the item is first added, from a physical count. |

## Hostel (`hostel`)

- **Kept by:** Foreign Worker Management, or the company manager or admin executive
- **Screen:** Hostels
- **Company scoped:** yes

| Field | Type | Required | Notes |
|---|---|---|---|
| Hostel name | text | yes |  |
| Address | textarea | yes |  |
| Beds | number | yes |  |
| Owned or rented | select | yes | Choices: Rented, Owned |
| For | select | yes | Choices: Private sector guards, Government sector guards |

## Office staff member (`officeStaff`)

- **Kept by:** HR
- **Screen:** People
- **Company scoped:** yes
- **Note:** Guards and officers come from the JA Group app and are not added here. A new basic pay waits for the Chief of Staff or Deputy (HR Director) to verify it; the current pay stays until then. A new salary account waits for the HR Director and Finance to verify it, and the staff member is told. The full IC and bank account show only on this form.

| Field | Type | Required | Notes |
|---|---|---|---|
| Staff number | text | yes |  |
| Name | text | yes |  |
| Job title | text | yes |  |
| Department | text |  |  |
| Reports to | text |  |  |
| Branch | ref | yes | Picks a branches record |
| Employment | select | yes | Choices: On probation, Permanent, Fixed-term contract |
| Joined on | date | yes |  |
| Probation ends on | date |  |  |
| Contract ends on | date |  |  |
| Nationality | select | yes | Choices: Malaysian, Nepali |
| IC or passport number | text |  | Restricted: shown only behind the data wall; In full. Needed for a new staff member. Other screens show the last 4. |
| Gender | select | yes | Choices: Female, Male |
| Date of birth | date | yes |  |
| Marital status | select |  | Choices: Single, Married, Divorced, Widowed |
| Children (for PCB) | number |  |  |
| Phone | text | yes |  |
| Email | text |  |  |
| Home address | textarea |  |  |
| Emergency contact | text |  |  |
| Emergency contact phone | text |  |  |
| EPF (KWSP) number | text |  |  |
| SOCSO (PERKESO) number | text |  |  |
| Income tax (LHDN) number | text |  |  |
| Salary bank | text |  |  |
| Salary account number | text |  | Restricted: shown only behind the data wall; In full. Other screens show the last 4. A new account is used only after the HR Director and Finance both verify it. |
| Basic pay (RM a month) | number | yes |  |
| Reason for the pay | text |  | Needed when the pay is new or changes, e.g. offer letter, increment, promotion. |
| New pay starts on | date |  | Leave empty for today. |
| Status | select | yes | Choices: Active, Suspended, Left |
| Leaving | select |  | Choices: Resigned, Employment ended by the company, Contract ended, Retired |
| Notice given on | date |  |  |
| Last working day | date |  |  |
| Reason for leaving | text |  |  |

## Armoury or safe (`vault`)

- **Kept by:** Arms Control
- **Screen:** Arms
- **Company scoped:** yes
- **Note:** Counts, alarms and CCTV come from their own records and feeds.

| Field | Type | Required | Notes |
|---|---|---|---|
| Name | text | yes |  |
| Kind | select | yes | Choices: Company armoury, Police station, Client site safe |
| Site (for a client safe) | ref |  | Picks a sites record |
| State | text | yes |  |
| Police approval reference | text | yes |  |
| Approval expires | date |  |  |
| Custodian | text | yes |  |
| A licence holder | text |  |  |

## Firearm (`firearm`)

- **Kept by:** Arms Control
- **Screen:** Arms
- **Company scoped:** yes
- **Note:** Issue, return, missing and police deposit keep their own steps; the status never changes from this form. The full serial number is seen only here, by Arms Control.

| Field | Type | Required | Notes |
|---|---|---|---|
| Kept in | ref | yes | Picks a vaults record |
| Tag | text | yes |  |
| Kind | select | yes | Choices: Shotgun, Revolver, Pistol |
| Serial number | text | yes | Restricted: shown only behind the data wall; As stamped on the firearm and its licence. Set once. Other screens show only the last 4. |
| RFID tag | text |  | Scan the tag with the vault reader, or type the code printed on it. Leave empty only if not tagged yet. |
| Firearm licence reference | text | yes |  |
| Licence expires | date | yes |  |
| Service due | date |  |  |
| Held for | select | yes | Choices: Operations, Trade stock (dealer licence) |

## Arms dealer licence (`dealerLicence`)

- **Kept by:** Arms Control
- **Screen:** Arms Control
- **Company scoped:** yes

| Field | Type | Required | Notes |
|---|---|---|---|
| Status | select | yes | Choices: Planned, Applied, Approved, Refused, Expired |
| Reference | text |  |  |
| Applied on | date |  |  |
| Expires on | date |  |  |
| Note | textarea |  |  |

## Phone extension (`phoneExtension`)

- **Kept by:** Arms Control (CMS settings)
- **Screen:** CMS, Phone desk
- **Company scoped:** yes
- **Note:** Online status comes from the phone system.

| Field | Type | Required | Notes |
|---|---|---|---|
| Extension | text | yes |  |
| Who or where | text | yes |  |
| Forward to CMS when not answered | bool |  |  |
| Forward after (seconds) | number |  |  |

## CCTV or alarm panel (`siteSystem`)

- **Kept by:** Arms Control (CMS settings)
- **Screen:** CMS, Sites
- **Company scoped:** yes
- **Note:** Online and recording status come from the recorder or panel itself.

| Field | Type | Required | Notes |
|---|---|---|---|
| Site | ref | yes | Set when created, not edited later; Picks a sites record |
| Kind | select | yes | Choices: CCTV recorder, Alarm panel |
| Name | text | yes |  |
| Linked to CMS | bool |  |  |
| Cameras | number |  |  |

## Armed job agreement (`armsAgreement`)

- **Kept by:** Arms Control
- **Screen:** Arms Control
- **Company scoped:** yes

| Field | Type | Required | Notes |
|---|---|---|---|
| Client | text | yes |  |
| Site | ref |  | Picks a sites record |
| Job | select |  | Choices: Armed site guarding, Bodyguard, Cash in transit, Cash deposit machine, Cash vault |
| Armed posts | number | yes |  |
| Signed on | date |  |  |
| Ends on | date |  |  |
| Insurer | text |  |  |
| Policy reference | text |  |  |
| Insurance expires | date |  |  |

## Arms supplier (`armsSupplier`)

- **Kept by:** Arms Control
- **Screen:** Arms Control, Suppliers
- **Company scoped:** no (group-wide)

| Field | Type | Required | Notes |
|---|---|---|---|
| Supplier | text | yes |  |
| Supplies | text | yes | Firearms, Ammunition, Servicing or Equipment, separated by commas. |
| Dealer licence reference | text |  |  |
| Licence expires | date |  |  |
| Contact | text | yes |  |

## Price list item (`supplierItem`)

- **Kept by:** Arms Control
- **Screen:** Arms Control, Suppliers
- **Company scoped:** no (group-wide)

| Field | Type | Required | Notes |
|---|---|---|---|
| Supplier | ref | yes | Set when created, not edited later; Picks a armsSuppliers record |
| Category | select | yes | Choices: Firearm, Ammunition, Servicing, Equipment |
| Item | text | yes |  |
| Specification | text |  |  |
| Unit | text | yes |  |
| Price per unit (RM) | number | yes |  |
| Price valid until | date |  |  |
| Lead time (days) | number |  |  |
| Minimum order | number |  |  |

## CMS staff member (`cmsStaff`)

- **Kept by:** Arms Control
- **Screen:** CMS, Staff
- **Company scoped:** no (group-wide)

| Field | Type | Required | Notes |
|---|---|---|---|
| Name | text | yes |  |
| Can work as | select | yes | Choices: Head Control and Monitor Officer, Head Control, Monitor Officer |
| Desk extension | text | yes |  |
| Active | bool |  |  |

## Rental unit (`amUnit`)

- **Kept by:** Asset Management team
- **Screen:** Asset Management, Units
- **Company scoped:** no (group-wide)
- **Note:** The tenant and agreement are on their own form; rent paid on the Rent tab.

| Field | Type | Required | Notes |
|---|---|---|---|
| Unit code | text | yes |  |
| Type | select | yes | Choices: Residential, Commercial, Industrial, Land |
| Name | text | yes |  |
| Town | text | yes |  |
| State | text | yes |  |
| Owned by (entity) | text | yes |  |
| Size (sq ft) | number | yes |  |
| Asking rent (RM a month) | number | yes |  |
| Status | select | yes | Choices: Vacant, Let, Under maintenance, Reserved |
| Insurance expires | date | yes |  |
| Assessment (cukai taksiran) due | date | yes |  |
| Quit rent (cukai tanah) due | date | yes |  |

## Tenant and agreement (`amTenancy`)

- **Kept by:** Asset Management team
- **Screen:** Asset Management, Units
- **Company scoped:** no (group-wide)
- **Note:** A new tenancy starts billing from its first month. Ending it keeps the payment history in the audit log.

| Field | Type | Required | Notes |
|---|---|---|---|
| Tenant | text | yes |  |
| Tenant phone | text |  | For the Call and WhatsApp buttons, e.g. 012-345 6789. |
| Tenant email | text |  | For the Email button. |
| Group office or state branch | bool |  |  |
| Starts on | date | yes |  |
| Ends on | date | yes |  |
| Rent (RM a month) | number | yes |  |
| Deposit (RM) | number | yes |  |
| Utility deposit (RM) | number | yes |  |
| Agreement stamped (LHDN) | bool |  |  |
| End this tenancy now | bool |  | The unit becomes vacant from today. |

## Work order (`amWorkOrder`)

- **Kept by:** Asset Management team
- **Screen:** Asset Management, Maintenance
- **Company scoped:** no (group-wide)

| Field | Type | Required | Notes |
|---|---|---|---|
| Unit | ref |  | Picks a amUnits record |
| Work to do | text | yes |  |
| Raised from | select | yes | Choices: Tenant complaint, Planned maintenance, Inspection |
| Due on | date | yes |  |
| Status | select | yes | Choices: Open, In progress, Done |
| Contractor | text |  |  |
| Cost (RM) | number |  |  |
| Done on | date |  |  |

## Asset (non-electronic) (`amAsset`)

- **Kept by:** Asset Management team
- **Screen:** Asset Management, Assets
- **Company scoped:** no (group-wide)
- **Note:** Disposal and end-of-life reviews keep their own steps.

| Field | Type | Required | Notes |
|---|---|---|---|
| Asset tag | text | yes | Set when created, not edited later |
| Description | text | yes |  |
| Category | select | yes | Choices: Furniture, Fitting, Renovation, Other |
| Owned by (entity) | text | yes |  |
| Location | text | yes |  |
| Cost (RM) | number | yes | Set when created, not edited later |
| Bought on | date | yes | Set when created, not edited later |
| Condition | select | yes | Choices: Good, Fair, Poor |
| Kept by | text | yes |  |
| Last checked on | date |  |  |

## Domain or website (`itDomain`)

- **Kept by:** IT
- **Screen:** IT, Domains and websites
- **Company scoped:** no (group-wide)
- **Note:** Whether it is up comes from the website check.

| Field | Type | Required | Notes |
|---|---|---|---|
| Domain or address | text | yes |  |
| Kind | select | yes | Choices: Domain, Website |
| Registrar or host | text | yes |  |
| Expires on | date |  | Leave empty only if not known: it then shows as a problem. |
| SSL certificate expires | date |  |  |
