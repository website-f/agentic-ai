import type { Dataset } from "./types";
import type { IsoDate } from "./types";
import { isRealDate } from "./time";
import { REGIONS } from "./regions";





/**
 * Add and edit forms for the records each department keeps (Fauzan, 27 Oct 2026: "check all system, where suppose to
 * add button ... it will be the main frame to discuss with developer"). One list of record kinds with their fields, who
 * keeps them, and which screen the button sits on. Workflow steps (approvals, payments, issues, counts) keep their own
 * screens and rules; these forms cover the plain records behind them.
 */

export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'bool' | 'ref';

export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: [string, string][];
  /** For 'ref': the records to choose from, limited to the same company where the record has one. */
  ref?: 'sites' | 'vaults' | 'insurancePolicies' | 'armsSuppliers' | 'amUnits' | 'branches' | 'cmsAccounts';
  min?: number;
  max?: number;
  help?: string;
  /** Set when the record is created and not changed afterwards. */
  createOnly?: boolean;
  /** Restricted: shown in full only on this form, masked to the last 4 everywhere else, the audit log included. */
  restricted?: boolean;
}

export interface RecordKindSpec {
  kind: RecordKind;
  label: string;
  table: keyof Dataset;
  companyScoped: boolean;
  /** Who adds and edits it, in words, for the screen and the developer. */
  keptBy: string;
  /** The screen the Add and Edit buttons are on. */
  screen: string;
  fields: FieldSpec[];
  /** What the form never changes, and why. */
  note?: string;
}

export type RecordKind =
  | 'company'
  | 'site'
  | 'post'
  | 'checkpoint'
  | 'licence'
  | 'insurancePolicy'
  | 'insuranceClaim'
  | 'insuranceGuarantee'
  | 'vehicle'
  | 'stockItem'
  | 'hostel'
  | 'officeStaff'
  | 'vault'
  | 'firearm'
  | 'dealerLicence'
  | 'phoneExtension'
  | 'siteSystem'
  | 'armsAgreement'
  | 'armsSupplier'
  | 'supplierItem'
  | 'cmsStaff'
  | 'amUnit'
  | 'amTenancy'
  | 'amWorkOrder'
  | 'amAsset'
  | 'itDomain';

const yesNo = (key: string, label: string, help?: string): FieldSpec => ({ key, label, type: 'bool', help });
const date = (key: string, label: string, required = false, help?: string): FieldSpec => ({ key, label, type: 'date', required, help });
const text = (key: string, label: string, required = false, help?: string): FieldSpec => ({ key, label, type: 'text', required, help });
const num = (key: string, label: string, required = false, min = 0, max?: number): FieldSpec => ({ key, label, type: 'number', required, min, max });
const pick = (key: string, label: string, options: [string, string][], required = true): FieldSpec => ({ key, label, type: 'select', options, required });
const ref = (key: string, label: string, r: NonNullable<FieldSpec['ref']>, required = true, createOnly = false): FieldSpec => ({
  key,
  label,
  type: 'ref',
  ref: r,
  required,
  createOnly,
});

export const RECORD_KINDS: Record<RecordKind, RecordKindSpec> = {
  company: {
    kind: 'company',
    label: 'Company master record',
    table: 'companies',
    companyScoped: true,
    keptBy: 'Head of Company (draft), Deputy Chief of Staff (checks against SSM), CEO',
    screen: 'Group today, Companies',
    note: 'Updates the existing company ID in place. Company code, linked staff, contracts, and historical records remain unchanged. The Head of Company saves a draft; the Deputy Chief of Staff (never the person who saved the draft) or the CEO checks the SSM source document before marking verified; no personal director IDs or bank data.',
    fields: [
      text('name', 'Registered company name', true),
      text('ssmNo', 'SSM registration number', true),
      date('registeredOn', 'Incorporation or registration date'),
      { key: 'registeredAddress', label: 'Registered address', type: 'textarea' },
      { key: 'businessAddress', label: 'Business address', type: 'textarea' },
      text('state', 'Primary state', true),
      text('headOfCompany', 'Head of company'),
      text('sourceRef', 'Source document reference', true, 'Name and reference of the SSM document reviewed. Do not paste personal IDs or upload confidential documents into AI chat.'),
      pick('verificationStatus', 'Source review status', [
        ['draft', 'Draft, waiting for the SSM check'],
        ['verified', 'Checked against the SSM source'],
      ]),
    ],
  },
  site: {
    kind: 'site',
    label: 'Site',
    table: 'sites',
    companyScoped: true,
    keptBy: 'Company manager or admin executive',
    screen: 'Sites',
    fields: [
      text('code', 'Site code', true),
      text('name', 'Site name', true),
      text('client', 'Client', true),
      { key: 'address', label: 'Address', type: 'textarea', required: true },
      ref('branchId', 'Branch', 'branches', false),
      {
        ...pick('state', 'State', REGIONS.flatMap((r) => r.states.map((st) => [st, st] as [string, string])), false),
        help: 'Needed when the site has no branch: the OM and Regional OM for this state then cover it.',
      },
      num('lat', 'Latitude', true, -90, 90),
      num('lng', 'Longitude', true, -180, 180),
      num('geofenceM', 'Clock-in area (metres)', true, 30, 2000),
      pick('risk', 'Risk', [
        ['low', 'Low'],
        ['medium', 'Medium'],
        ['high', 'High'],
      ]),
      pick('sector', 'Sector', [
        ['private', 'Private'],
        ['government', 'Government'],
      ]),
      yesNo('armed', 'Armed site', 'Needs an arms agreement, police approval and armed guards.'),
    ],
  },
  post: {
    kind: 'post',
    label: 'Post at a site',
    table: 'posts',
    companyScoped: true,
    keptBy: 'Company manager or admin executive',
    screen: 'Sites',
    fields: [
      ref('siteId', 'Site', 'sites', true, true),
      text('name', 'Post name', true),
      pick('shiftStructure', 'Shift pattern', [
        ['A', 'A: 2 x 12 hours'],
        ['B', 'B: 3 x 8 hours'],
        ['C', 'C: day only'],
        ['D', 'D: night only'],
        ['E', 'E: office hours'],
      ]),
      num('guardsPerShift', 'Guards per shift', true, 1, 50),
    ],
  },
  checkpoint: {
    kind: 'checkpoint',
    label: 'Patrol checkpoint',
    table: 'checkpoints',
    companyScoped: true,
    keptBy: 'Company manager or admin executive',
    screen: 'Sites',
    fields: [
      ref('siteId', 'Site', 'sites', true, true),
      text('name', 'Checkpoint name', true),
      text('tagCode', 'NFC tag code', true, 'The code written on the NFC tag.'),
    ],
  },
  licence: {
    kind: 'licence',
    label: 'Company licence or registration',
    table: 'licences',
    companyScoped: true,
    keptBy: 'Company manager or admin executive',
    screen: 'Licences',
    fields: [
      pick('type', 'Kind', [
        ['KDN_LICENCE', 'KDN licence'],
        ['MOF_REGISTRATION', 'MOF registration'],
        ['INSURANCE', 'Insurance'],
        ['SSM_ANNUAL_RETURN', 'SSM annual return'],
        ['MAJLIS_PREMISE', 'Council premise licence'],
        ['MAJLIS_SIGNBOARD', 'Council signboard licence'],
        ['VENDOR_PANEL', 'Vendor registration (client or agency panel)'],
        ['ISO_CERT', 'ISO certification'],
        ['FIRE_CERT', 'Fire certificate'],
        ['OTHER_COMPLIANCE', 'Other compliance'],
      ]),
      text('title', 'Which one', false, 'For example "MBPJ premise licence, Petaling Jaya office", "Petronas vendor panel", "ISO 9001".'),
      text('issuer', 'Issued by', false),
      text('reference', 'Reference number', true),
      date('expiresOn', 'Expires on', false, 'Leave empty only if not known: it then shows as Unknown, never green.'),
    ],
  },
  insurancePolicy: {
    kind: 'insurancePolicy',
    label: 'Insurance policy',
    table: 'insurancePolicies',
    companyScoped: true,
    keptBy: 'Company manager, admin executive or the Chief of Staff',
    screen: 'Insurance',
    fields: [
      pick('kind', 'Cover', [
        ['PUBLIC_LIABILITY', 'Public liability'],
        ['GROUP_PERSONAL_ACCIDENT', 'Group personal accident'],
        ['GROUP_HOSPITALISATION', 'Group hospitalisation'],
        ['FW_HOSPITALISATION', 'Foreign worker hospitalisation'],
        ['FIDELITY_GUARANTEE', 'Fidelity guarantee'],
        ['ARMED_SERVICE', 'Armed service'],
        ['CASH_IN_TRANSIT', 'Cash in transit'],
        ['MOTOR_FLEET', 'Motor fleet'],
        ['FIRE_OFFICE', 'Fire and office'],
      ]),
      text('insurer', 'Insurer', true),
      text('broker', 'Broker'),
      text('policyNo', 'Policy number', true),
      num('sumInsured', 'Sum insured (RM)', true),
      num('premium', 'Premium (RM)', true),
      date('startsOn', 'Starts on', true),
      date('expiresOn', 'Expires on', true),
      date('premiumDueOn', 'Premium due on', true),
      pick('renewal', 'Renewal', [
        ['not_started', 'Not started'],
        ['quotes', 'Getting quotes'],
      ]),
      text('scheduleRef', 'Policy schedule kept at', false, 'Document name or SharePoint link of the policy schedule or certificate.'),
    ],
    note: 'Paying the premium (with Finance’s payment reference), renewing and cancelling are their own steps on the Insurance screen, so last year’s policy is never overwritten.',
  },
  insuranceClaim: {
    kind: 'insuranceClaim',
    label: 'Insurance claim',
    table: 'insuranceClaims',
    companyScoped: true,
    keptBy: 'Company manager, admin executive or the Chief of Staff',
    screen: 'Insurance',
    fields: [
      ref('policyId', 'Policy', 'insurancePolicies', true, true),
      text('ref', 'Claim reference', true),
      { key: 'what', label: 'What happened', type: 'textarea', required: true },
      date('incidentOn', 'Incident on', true),
      num('amountClaimed', 'Amount claimed (RM)', true),
      // Telling the insurer, documents, the insurer's answer and money received are claim steps with their own
      // checks (masterplan 61), not fields anyone keeping the record may type.
    ],
  },
  insuranceGuarantee: {
    kind: 'insuranceGuarantee',
    label: 'Bond or guarantee',
    table: 'insuranceGuarantees',
    companyScoped: true,
    keptBy: 'Company manager, admin executive or the Chief of Staff',
    screen: 'Insurance',
    fields: [
      pick('kind', 'Kind', [
        ['PERFORMANCE_BOND', 'Performance bond'],
        ['TENDER_BOND', 'Tender bond'],
        ['BANK_GUARANTEE', 'Bank guarantee'],
        ['INSURANCE_GUARANTEE', 'Insurance guarantee'],
      ]),
      text('issuer', 'Issued by', true),
      text('beneficiary', 'In favour of', true),
      text('contractRef', 'Contract or tender', true),
      num('amount', 'Amount (RM)', true),
      num('fee', 'Fee (RM)', true),
      date('issuedOn', 'Issued on', true),
      date('expiresOn', 'Expires on', true),
      date('contractEndsOn', 'Contract ends on', true),
      date('releasedOn', 'Released on'),
    ],
  },
  vehicle: {
    kind: 'vehicle',
    label: 'Vehicle',
    table: 'vehicles',
    companyScoped: true,
    keptBy: 'Transport head',
    screen: 'Vehicles',
    note: 'Trips, payments and the log keep their own buttons.',
    fields: [
      text('plate', 'Plate number', true),
      text('model', 'Make and model', true),
      pick('kind', 'Kind', [
        ['CAR', 'Car'],
        ['VAN', 'Van'],
        ['MOTORCYCLE', 'Motorcycle'],
        ['PATROL_CAR', 'Patrol car'],
        ['LORRY', 'Lorry'],
      ]),
      num('odometerKm', 'Odometer (km)', true),
      date('roadTax', 'Road tax expires', true),
      date('insurance', 'Insurance expires', true),
      date('puspakom', 'PUSPAKOM due'),
      date('permit', 'Permit expires'),
      date('serviceDueOn', 'Next service date', true),
      num('serviceDueKm', 'Next service (km)', true),
      text('trackerId', 'GPS tracker ID'),
      text('dashcamId', 'Dashcam ID'),
      yesNo('healthMonitor', 'Driver health monitor fitted'),
    ],
  },
  stockItem: {
    kind: 'stockItem',
    label: 'Store item',
    table: 'stockItems',
    companyScoped: true,
    keptBy: 'Procurement executive',
    screen: 'Procurement, Store',
    note: 'Stock on hand changes only through goods received, issues and returns, never by typing it in.',
    fields: [
      text('sku', 'Item code', true),
      text('name', 'Item', true),
      pick('kind', 'Kind', [
        ['UNIFORM', 'Uniform'],
        ['EQUIPMENT', 'Guard equipment'],
        ['DEVICE', 'Device (radio, bodycam, translation)'],
        ['PATROL_DEVICE', 'Patrol device or NFC token'],
        ['CLEANING', 'Cleaning equipment or product'],
      ]),
      text('size', 'Size'),
      yesNo('consumable', 'Used up (not returned)'),
      pick(
        'charge',
        'Goodwill charges the company',
        [
          ['rental', 'Monthly rental'],
          ['sale', 'One-off sale'],
        ],
        false,
      ),
      { ...num('rentalMonthly', 'Rental per month (RM)'), help: 'Set by the Inventory Manager only. Left empty, the bill shows the price as missing.' },
      { ...num('salePrice', 'Sale price (RM)'), help: 'Set by the Inventory Manager only. Left empty, the bill shows the price as missing.' },
      num('reorderAt', 'Reorder when stock falls to', true),
      { ...num('onHand', 'Opening stock counted', true), createOnly: true, help: 'Only when the item is first added, from a physical count.' },
    ],
  },
  hostel: {
    kind: 'hostel',
    label: 'Hostel',
    table: 'hostels',
    companyScoped: true,
    keptBy: 'Foreign Worker Management, or the company manager or admin executive',
    screen: 'Hostels',
    fields: [
      text('name', 'Hostel name', true),
      { key: 'address', label: 'Address', type: 'textarea', required: true },
      num('beds', 'Beds', true, 1, 2000),
      pick('tenure', 'Owned or rented', [
        ['RENTED', 'Rented'],
        ['OWNED', 'Owned'],
      ]),
      pick('sector', 'For', [
        ['private', 'Private sector guards'],
        ['government', 'Government sector guards'],
      ]),
    ],
  },
  officeStaff: {
    kind: 'officeStaff',
    label: 'Office staff member',
    table: 'people',
    companyScoped: true,
    keptBy: 'HR',
    screen: 'People',
    note: 'Guards and officers come from the JA Group app and are not added here. A new basic pay waits for the Chief of Staff or Deputy (HR Director) to verify it; the current pay stays until then. A new salary account waits for the HR Director and Finance to verify it, and the staff member is told. The full IC and bank account show only on this form.',
    fields: [
      text('staffNo', 'Staff number', true),
      text('name', 'Name', true),
      text('jobTitle', 'Job title', true),
      text('department', 'Department'),
      text('reportsTo', 'Reports to'),
      ref('branchId', 'Branch', 'branches'),
      pick('employmentType', 'Employment', [
        ['probation', 'On probation'],
        ['permanent', 'Permanent'],
        ['contract', 'Fixed-term contract'],
      ]),
      date('hiredOn', 'Joined on', true),
      date('probationEndsOn', 'Probation ends on'),
      date('contractEndsOn', 'Contract ends on'),
      pick('nationality', 'Nationality', [
        ['MY', 'Malaysian'],
        ['NP', 'Nepali'],
      ]),
      {
        key: 'idFull',
        label: 'IC or passport number',
        type: 'text',
        restricted: true,
        help: 'In full. Needed for a new staff member. Other screens show the last 4.',
      },
      pick('gender', 'Gender', [
        ['F', 'Female'],
        ['M', 'Male'],
      ]),
      date('dob', 'Date of birth', true),
      pick(
        'maritalStatus',
        'Marital status',
        [
          ['single', 'Single'],
          ['married', 'Married'],
          ['divorced', 'Divorced'],
          ['widowed', 'Widowed'],
        ],
        false,
      ),
      num('children', 'Children (for PCB)', false, 0, 20),
      text('phone', 'Phone', true),
      text('email', 'Email'),
      { key: 'address', label: 'Home address', type: 'textarea' },
      text('emergencyName', 'Emergency contact'),
      text('emergencyPhone', 'Emergency contact phone'),
      text('epfNo', 'EPF (KWSP) number'),
      text('socsoNo', 'SOCSO (PERKESO) number'),
      text('taxNo', 'Income tax (LHDN) number'),
      text('bankName', 'Salary bank'),
      { key: 'bankAccountFull', label: 'Salary account number', type: 'text', restricted: true, help: 'In full. Other screens show the last 4. A new account is used only after the HR Director and Finance both verify it.' },
      num('basicPay', 'Basic pay (RM a month)', true),
      text('payReason', 'Reason for the pay', false, 'Needed when the pay is new or changes, e.g. offer letter, increment, promotion.'),
      date('payEffectiveOn', 'New pay starts on', false, 'Leave empty for today.'),
      pick('status', 'Status', [
        ['active', 'Active'],
        ['suspended', 'Suspended'],
        ['left', 'Left'],
      ]),
      pick(
        'leavingKind',
        'Leaving',
        [
          ['resigned', 'Resigned'],
          ['terminated', 'Employment ended by the company'],
          ['contract_end', 'Contract ended'],
          ['retired', 'Retired'],
        ],
        false,
      ),
      date('noticeOn', 'Notice given on'),
      date('lastDayOn', 'Last working day'),
      text('leavingReason', 'Reason for leaving'),
    ],
  },
  vault: {
    kind: 'vault',
    label: 'Armoury or safe',
    table: 'vaults',
    companyScoped: true,
    keptBy: 'Arms Control',
    screen: 'Arms',
    note: 'Counts, alarms and CCTV come from their own records and feeds.',
    fields: [
      text('name', 'Name', true),
      pick('kind', 'Kind', [
        ['COMPANY_ARMOURY', 'Company armoury'],
        ['POLICE_STATION', 'Police station'],
        ['CLIENT_SAFE', 'Client site safe'],
      ]),
      ref('siteId', 'Site (for a client safe)', 'sites', false),
      text('state', 'State', true),
      text('approvalRef', 'Police approval reference', true),
      date('approvalExpiresOn', 'Approval expires'),
      text('custodian', 'Custodian', true),
      text('aLicenceHolder', 'A licence holder'),
    ],
  },
  firearm: {
    kind: 'firearm',
    label: 'Firearm',
    table: 'firearms',
    companyScoped: true,
    keptBy: 'Arms Control',
    screen: 'Arms',
    note: 'Issue, return, missing and police deposit keep their own steps; the status never changes from this form. The full serial number is seen only here, by Arms Control.',
    fields: [
      ref('vaultId', 'Kept in', 'vaults'),
      text('tag', 'Tag', true),
      pick('kind', 'Kind', [
        ['Shotgun', 'Shotgun'],
        ['Revolver', 'Revolver'],
        ['Pistol', 'Pistol'],
      ]),
      {
        ...text('serial', 'Serial number', true, 'As stamped on the firearm and its licence. Set once. Other screens show only the last 4.'),
        restricted: true,
      },
      text('rfidTag', 'RFID tag', false, 'Scan the tag with the vault reader, or type the code printed on it. Leave empty only if not tagged yet.'),
      text('licenceRef', 'Firearm licence reference', true),
      date('licenceExpiresOn', 'Licence expires', true),
      date('serviceDueOn', 'Service due'),
      pick('ownership', 'Held for', [
        ['OPERATIONAL', 'Operations'],
        ['TRADE', 'Trade stock (dealer licence)'],
      ]),
    ],
  },
  dealerLicence: {
    kind: 'dealerLicence',
    label: 'Arms dealer licence',
    table: 'dealerLicences',
    companyScoped: true,
    keptBy: 'Arms Control',
    screen: 'Arms Control',
    fields: [
      pick('status', 'Status', [
        ['planned', 'Planned'],
        ['applied', 'Applied'],
        ['approved', 'Approved'],
        ['refused', 'Refused'],
        ['expired', 'Expired'],
      ]),
      text('reference', 'Reference'),
      date('appliedOn', 'Applied on'),
      date('expiresOn', 'Expires on'),
      { key: 'note', label: 'Note', type: 'textarea' },
    ],
  },
  phoneExtension: {
    kind: 'phoneExtension',
    label: 'Phone extension',
    table: 'phoneExtensions',
    companyScoped: true,
    keptBy: 'Arms Control (CMS settings)',
    screen: 'CMS, Phone desk',
    note: 'Online status comes from the phone system.',
    fields: [
      text('ext', 'Extension', true),
      text('label', 'Who or where', true),
      yesNo('forwardToCms', 'Forward to CMS when not answered'),
      num('forwardAfterSec', 'Forward after (seconds)', false, 5, 120),
    ],
  },
  siteSystem: {
    kind: 'siteSystem',
    label: 'CCTV or alarm panel',
    table: 'siteSystems',
    companyScoped: true,
    keptBy: 'Arms Control (CMS settings)',
    screen: 'CMS, Sites',
    note: 'Online and recording status come from the recorder or panel itself.',
    fields: [
      ref('siteId', 'Site', 'sites', true, true),
      pick('kind', 'Kind', [
        ['CCTV', 'CCTV recorder'],
        ['ALARM_PANEL', 'Alarm panel'],
      ]),
      text('name', 'Name', true),
      yesNo('linked', 'Linked to CMS'),
      num('cameras', 'Cameras'),
    ],
  },
  armsAgreement: {
    kind: 'armsAgreement',
    label: 'Armed job agreement',
    table: 'armsAgreements',
    companyScoped: true,
    keptBy: 'Arms Control',
    screen: 'Arms Control',
    fields: [
      text('client', 'Client', true),
      ref('siteId', 'Site', 'sites', false),
      pick(
        'jobKind',
        'Job',
        [
          ['', 'Armed site guarding'],
          ['BODYGUARD', 'Bodyguard'],
          ['CIT', 'Cash in transit'],
          ['CDM', 'Cash deposit machine'],
          ['CASH_VAULT', 'Cash vault'],
        ],
        false,
      ),
      num('armedPosts', 'Armed posts', true, 0, 200),
      date('signedOn', 'Signed on'),
      date('endsOn', 'Ends on'),
      text('insurer', 'Insurer'),
      text('policyRef', 'Policy reference'),
      date('insuranceExpiresOn', 'Insurance expires'),
    ],
  },
  armsSupplier: {
    kind: 'armsSupplier',
    label: 'Arms supplier',
    table: 'armsSuppliers',
    companyScoped: false,
    keptBy: 'Arms Control',
    screen: 'Arms Control, Suppliers',
    fields: [
      text('name', 'Supplier', true),
      text('supplies', 'Supplies', true, 'Firearms, Ammunition, Servicing or Equipment, separated by commas.'),
      text('licenceRef', 'Dealer licence reference'),
      date('licenceExpiresOn', 'Licence expires'),
      text('contact', 'Contact', true),
    ],
  },
  supplierItem: {
    kind: 'supplierItem',
    label: 'Price list item',
    table: 'supplierItems',
    companyScoped: false,
    keptBy: 'Arms Control',
    screen: 'Arms Control, Suppliers',
    fields: [
      ref('supplierId', 'Supplier', 'armsSuppliers', true, true),
      pick('category', 'Category', [
        ['Firearm', 'Firearm'],
        ['Ammunition', 'Ammunition'],
        ['Servicing', 'Servicing'],
        ['Equipment', 'Equipment'],
      ]),
      text('name', 'Item', true),
      text('spec', 'Specification'),
      text('unit', 'Unit', true),
      num('unitPrice', 'Price per unit (RM)', true),
      date('priceValidUntil', 'Price valid until'),
      num('leadTimeDays', 'Lead time (days)'),
      num('minOrder', 'Minimum order'),
    ],
  },
  cmsStaff: {
    kind: 'cmsStaff',
    label: 'CMS staff member',
    table: 'cmsStaff',
    companyScoped: false,
    keptBy: 'Arms Control',
    screen: 'CMS, Staff',
    fields: [
      text('name', 'Name', true),
      pick('post', 'Can work as', [
        ['BOTH', 'Head Control and Monitor Officer'],
        ['HEAD_CONTROL', 'Head Control'],
        ['MONITOR_OFFICER', 'Monitor Officer'],
      ]),
      text('ext', 'Desk extension', true),
      yesNo('active', 'Active'),
      ref('userId', 'Prima account', 'cmsAccounts', false),
    ],
    note: 'Clock-in, clock-out and the shift handover go by the Prima account linked here, never by the name on the roster. Without an account the person can be rostered but cannot clock in.',
  },
  amUnit: {
    kind: 'amUnit',
    label: 'Rental unit',
    table: 'amUnits',
    companyScoped: false,
    keptBy: 'Asset Management team',
    screen: 'Asset Management, Units',
    note: 'The tenant and agreement are on their own form; rent paid on the Rent tab.',
    fields: [
      text('code', 'Unit code', true),
      pick('type', 'Type', [
        ['RESIDENTIAL', 'Residential'],
        ['COMMERCIAL', 'Commercial'],
        ['INDUSTRIAL', 'Industrial'],
        ['LAND', 'Land'],
      ]),
      text('name', 'Name', true),
      text('town', 'Town', true),
      text('state', 'State', true),
      text('ownerEntity', 'Owned by (entity)', true),
      num('sizeSqft', 'Size (sq ft)', true),
      num('askingRent', 'Asking rent (RM a month)', true),
      pick('status', 'Status', [
        ['vacant', 'Vacant'],
        ['let', 'Let'],
        ['maintenance', 'Under maintenance'],
        ['reserved', 'Reserved'],
      ]),
      date('insuranceExpiry', 'Insurance expires', true),
      date('assessmentDue', 'Assessment (cukai taksiran) due', true),
      date('quitRentDue', 'Quit rent (cukai tanah) due', true),
    ],
  },
  amTenancy: {
    kind: 'amTenancy',
    label: 'Tenant and agreement',
    table: 'amUnits',
    companyScoped: false,
    keptBy: 'Asset Management team',
    screen: 'Asset Management, Units',
    note: 'A new tenancy starts billing from its first month. Ending it keeps the payment history in the audit log.',
    fields: [
      text('tenant', 'Tenant', true),
      text('tenantPhone', 'Tenant phone', false, 'For the Call and WhatsApp buttons, e.g. 012-345 6789.'),
      text('tenantEmail', 'Tenant email', false, 'For the Email button.'),
      yesNo('internal', 'Group office or state branch'),
      date('startOn', 'Starts on', true),
      date('endOn', 'Ends on', true),
      num('rent', 'Rent (RM a month)', true),
      num('deposit', 'Deposit (RM)', true),
      num('utilityDeposit', 'Utility deposit (RM)', true),
      yesNo('stamped', 'Agreement stamped (LHDN)'),
      yesNo('ended', 'End this tenancy now', 'The unit becomes vacant from today.'),
    ],
  },
  amWorkOrder: {
    kind: 'amWorkOrder',
    label: 'Work order',
    table: 'amWorkOrders',
    companyScoped: false,
    keptBy: 'Asset Management team',
    screen: 'Asset Management, Maintenance',
    fields: [
      ref('unitId', 'Unit', 'amUnits', false),
      text('title', 'Work to do', true),
      pick('source', 'Raised from', [
        ['tenant', 'Tenant complaint'],
        ['planned', 'Planned maintenance'],
        ['inspection', 'Inspection'],
      ]),
      date('dueOn', 'Due on', true),
      pick('status', 'Status', [
        ['open', 'Open'],
        ['in_progress', 'In progress'],
        ['done', 'Done'],
      ]),
      text('contractor', 'Contractor'),
      num('cost', 'Cost (RM)'),
      date('doneOn', 'Done on'),
    ],
  },
  amAsset: {
    kind: 'amAsset',
    label: 'Asset (non-electronic)',
    table: 'amAssets',
    companyScoped: false,
    keptBy: 'Asset Management team',
    screen: 'Asset Management, Assets',
    note: 'Disposal and end-of-life reviews keep their own steps.',
    fields: [
      { ...text('tag', 'Asset tag', true), createOnly: true },
      text('description', 'Description', true),
      pick('category', 'Category', [
        ['FURNITURE', 'Furniture'],
        ['FITTING', 'Fitting'],
        ['RENOVATION', 'Renovation'],
        ['OTHER', 'Other'],
      ]),
      text('ownerEntity', 'Owned by (entity)', true),
      text('location', 'Location', true),
      { ...num('cost', 'Cost (RM)', true), createOnly: true },
      { ...date('boughtOn', 'Bought on', true), createOnly: true },
      pick('condition', 'Condition', [
        ['good', 'Good'],
        ['fair', 'Fair'],
        ['poor', 'Poor'],
      ]),
      text('keeper', 'Kept by', true),
      date('lastCheckedOn', 'Last checked on'),
    ],
  },
  itDomain: {
    kind: 'itDomain',
    label: 'Domain or website',
    table: 'itDomains',
    companyScoped: false,
    keptBy: 'IT',
    screen: 'IT, Domains and websites',
    note: 'Whether it is up comes from the website check.',
    fields: [
      text('name', 'Domain or address', true),
      pick('kind', 'Kind', [
        ['domain', 'Domain'],
        ['website', 'Website'],
      ]),
      text('registrar', 'Registrar or host', true),
      date('expiresOn', 'Expires on', false, 'Leave empty only if not known: it then shows as a problem.'),
      date('sslExpiresOn', 'SSL certificate expires'),
    ],
  }
};

export type RecordValues = Record<string, string | number | boolean | null>;

/** Checks and tidies the values against the fields; returns the problems in plain words. */
export function checkRecordValues(spec: RecordKindSpec, raw: RecordValues, creating: boolean): { values: RecordValues; problems: string[] } {
  const values: RecordValues = {};
  const problems: string[] = [];
  for (const f of spec.fields) {
    if (f.createOnly && !creating) continue;
    const v = raw[f.key];
    const empty = v === undefined || v === null || v === '';
    if (f.type === 'bool') {
      values[f.key] = v === true || v === 'true';
      continue;
    }
    if (empty) {
      if (f.required) problems.push(`${f.label} is needed.`);
      values[f.key] = null;
      continue;
    }
    if (f.type === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n)) problems.push(`${f.label} must be a number.`);
      else if (f.min !== undefined && n < f.min) problems.push(`${f.label} must be at least ${f.min}.`);
      else if (f.max !== undefined && n > f.max) problems.push(`${f.label} must be at most ${f.max}.`);
      values[f.key] = n;
    } else if (f.type === 'date') {
      if (!isRealDate(String(v))) problems.push(`${f.label} must be a real date.`);
      values[f.key] = String(v) as IsoDate;
    } else if (f.type === 'select') {
      if (!f.options!.some(([k]) => k === v)) problems.push(`Choose ${f.label.toLowerCase()} from the list.`);
      values[f.key] = String(v);
    } else {
      const s = String(v).trim();
      const max = f.type === 'textarea' ? 1000 : 160;
      if (s.length > max) problems.push(`${f.label} is too long.`);
      values[f.key] = s.slice(0, max);
    }
  }
  return { values, problems };
}
