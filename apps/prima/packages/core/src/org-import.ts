// Real-data import: key the existing records once, from a spreadsheet, through the same checks as the forms
// (connect-departments, 2 Nov 2026).
//
// Going live means loading what already exists: sites, posts, licences, insurance, vehicles, hostels, office staff,
// stock items, domains. Typing hundreds of rows into forms is slow and error-prone; a separate loader would bypass the
// permission and validation rules. So the import runs every row through the record form's own save (saveRecord):
// the same person may import who may add the record by hand, and every row gets the same checks and audit entry.
//
//  1. Preview (dry run): each row is saved inside a transaction that is then rolled back, so the preview shows the
//     exact errors a real save would give. Nothing is kept. The preview returns a fingerprint (SHA-256) of the file.
//  2. Import: the person sends the same file with that fingerprint. The file must be unchanged and every row clean;
//     then all rows are saved in one transaction (all or none) and an import receipt is kept.
//  3. The same file cannot be imported twice (the fingerprint is refused a second time).
//
// Imported records are existing ones, so they do not start hand-overs between departments (no "new joiner" to-dos for
// staff already working). Restricted fields (IC and passport numbers) are never echoed back in the preview.
// The CEO's company master data and the arms register are not importable: they keep their own reviewed paths.
//
// P81 (any spreadsheet, auto-aligned): the file no longer has to be the template. The header row is found wherever it
// is, each column is matched to a field (import-align.ts) and the person may change any match before importing; rows
// may be skipped (the commit is all or none for the rows chosen); a "Company" column sends each row to the company it
// names. Clients, contracts and leave entitlements import too, each row through the same service call as its own form
// (addClientAccount, addContract, setLeaveOverride), never a side door.

import { sha256Hex } from './audit';
import { BILLING_METHOD_LABEL } from './contracts';
import { cleanupCanonical } from './it-cleanup-hash';
import { COMPANY_FIELD, alignColumns, findHeaderRow, matchCompany, matchOption, normBool, normDate, normHeader, normMoney, type AlignField, type ColumnMatch } from './import-align';
import { RECORD_KINDS, type FieldSpec, type RecordKind, type RecordValues } from './records';
import type { Store } from './store';
import type { BillingMethod, Dataset, Id, IsoDate, IsoDateTime, LeaveOverrideKind, PurCategory, User } from './types';
import { orgLinksOn, withoutHandOvers } from './org-links';
import { OpsImportRows, P91_IMPORTS, P91_IMPORT_KINDS, isP91Kind, type P91ImportKind, type P91ImportSaver } from './org-import-ops';

/** P81: records that are not plain record forms but have their own add path, imported row by row through it. */
export type ExtraImportKind = 'client' | 'contract' | 'leaveEntitlement' | P90ImportKind | P91ImportKind;
/**
 * P90 ("Import from any file", Fitri 9 Nov 2026): more screens that keep records staff bring from old spreadsheets.
 * Each row goes through the screen's own add (addFwWorker, addPurSupplier, addPublicHoliday, addBranch, the IT manual
 * asset record), with that add's own permission check: the import never lets anyone write what they could not add by hand.
 */
export type P90ImportKind = 'fwWorker' | 'purSupplier' | 'publicHoliday' | 'branch' | 'itAsset';

/** Supplier categories, as the Procurement screen names them. */
export const PUR_CATEGORY_WORDS: [string, string][] = [
  ['UNIFORM', 'Uniform'],
  ['GUARD_EQUIPMENT', 'Guard equipment'],
  ['DEVICE', 'Device'],
  ['PATROL_DEVICE', 'Patrol device'],
  ['CLEANING', 'Cleaning'],
  ['SERVICES', 'Services'],
  ['IT', 'IT'],
  ['OTHER', 'Other'],
];

export const IT_ASSET_KINDS: [string, string][] = [
  ['LAPTOP', 'Laptop'],
  ['DESKTOP', 'Desktop'],
  ['PHONE', 'Phone'],
  ['TABLET', 'Tablet'],
  ['PRINTER', 'Printer'],
  ['NETWORK', 'Network device'],
  ['CCTV', 'CCTV'],
  ['OTHER', 'Other'],
];
export type ImportKind = RecordKind | ExtraImportKind;

export interface ImportSpec {
  kind: ImportKind;
  label: string;
  table: keyof Dataset;
  companyScoped: boolean;
  keptBy: string;
  screen: string;
  fields: (FieldSpec & { words?: string[] })[];
  note?: string;
}

const sitesField: FieldSpec = {
  key: 'sites',
  label: 'Sites',
  type: 'text',
  help: 'Site codes or names of this company, separated by commas. Leave empty if none yet.',
};

export const EXTRA_IMPORTS: Record<ExtraImportKind, ImportSpec> = {
  client: {
    kind: 'client',
    label: 'Client',
    table: 'clientAccounts',
    companyScoped: true,
    keptBy: 'Company manager, or Operations for clients in their area',
    screen: 'Clients',
    note: 'Each client opens as a new client of the company, with its onboarding checklist, exactly as the Add client form does.',
    fields: [{ key: 'name', label: 'Client', type: 'text', required: true, words: ['client name', 'nama pelanggan', 'pelanggan', 'customer', 'klien', 'agensi'] }, sitesField, { key: 'contractEndsOn', label: 'Contract ends on', type: 'date' }],
  },
  contract: {
    kind: 'contract',
    label: 'Client contract',
    table: 'contracts',
    companyScoped: true,
    keptBy: 'Company manager',
    screen: 'Contracts',
    note: 'Each contract is recorded as the Add contract form records it (awarded, with its mobilisation list). A client of the same name is linked. Attach each signed copy afterwards on its first mobilisation item.',
    fields: [
      { key: 'clientName', label: 'Client', type: 'text', required: true },
      sitesField,
      { key: 'signedRef', label: 'Signed contract or award reference', type: 'text', required: true },
      { key: 'startOn', label: 'Starts on', type: 'date', required: true },
      { key: 'endOn', label: 'Ends on', type: 'date', required: true },
      { key: 'billingMethod', label: 'Billing method', type: 'select', required: true, options: Object.entries(BILLING_METHOD_LABEL) as [string, string][] },
      { key: 'rate', label: 'Rate per guard-hour (RM)', type: 'number', min: 0 },
      { key: 'fixedFee', label: 'Monthly fee (RM)', type: 'number', min: 0, help: 'For a fixed monthly fee.' },
      { key: 'contractedHours', label: 'Contracted hours a month', type: 'number', min: 0, help: 'Method 2 only.' },
    ],
  },
  leaveEntitlement: {
    kind: 'leaveEntitlement',
    label: 'Leave days above the Act',
    table: 'people',
    companyScoped: true,
    keptBy: 'HR',
    screen: 'HR, Leave',
    note: 'For office staff whose leave days are above the Employment Act, as in their contract. HR may give more, never less; each row is saved as HR saves it by hand.',
    fields: [
      { key: 'staffNo', label: 'Staff number', type: 'text', required: true, help: 'Or the name exactly as in Prima.' },
      {
        key: 'leaveKind',
        label: 'Leave',
        type: 'select',
        required: true,
        options: [
          ['ANNUAL', 'Annual leave'],
          ['SICK', 'Sick leave'],
          ['MATERNITY', 'Maternity leave'],
          ['PATERNITY', 'Paternity leave'],
        ],
      },
      { key: 'days', label: 'Days a year', type: 'number', required: true, min: 1, max: 365 },
      { key: 'note', label: 'Reason', type: 'text', required: true, help: 'For example the contract clause or the old system.' },
    ],
  },
  fwWorker: {
    kind: 'fwWorker',
    label: 'Foreign worker',
    table: 'people',
    companyScoped: true,
    keptBy: 'FWM',
    screen: 'Foreign workers',
    note: 'Each worker is added as FWM adds one by hand, with the paper dates given. Prima keeps only the last 4 characters of a passport number. Papers typed from an old list show as "Typed in, copy not seen" until FWM records the copy.',
    fields: [
      { key: 'staffNo', label: 'Staff number', type: 'text', required: true, words: ['worker no', 'worker id', 'no pekerja asing', 'fw no'] },
      { key: 'name', label: 'Name', type: 'text', required: true, words: ['worker name', 'nama pekerja asing', 'name as passport', 'nama seperti pasport'] },
      { key: 'branch', label: 'Branch', type: 'text', required: true, help: 'The branch name as in Prima.' },
      { key: 'nationality', label: 'Nationality', type: 'text', help: 'Prima holds Nepali foreign workers for now.' },
      { key: 'dob', label: 'Date of birth', type: 'date', required: true },
      { key: 'hiredOn', label: 'Joined on', type: 'date', required: true, words: ['arrival date', 'tarikh tiba', 'date of arrival', 'tarikh masuk kerja'] },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'passportNo', label: 'Passport number', type: 'text', restricted: true, help: 'Only the last 4 characters are kept.' },
      { key: 'passportIssuedOn', label: 'Passport issued on', type: 'date' },
      { key: 'passportExpiresOn', label: 'Passport expires on', type: 'date' },
      { key: 'permitNo', label: 'Work permit (PLKS) number', type: 'text' },
      { key: 'permitIssuedOn', label: 'Work permit issued on', type: 'date' },
      { key: 'permitExpiresOn', label: 'Work permit (PLKS) expires on', type: 'date' },
      { key: 'fomemaExpiresOn', label: 'FOMEMA medical expires on', type: 'date' },
      { key: 'insuranceExpiresOn', label: 'Foreign worker insurance expires on', type: 'date' },
      { key: 'spikpaExpiresOn', label: 'SPIKPA expires on', type: 'date' },
    ],
  },
  purSupplier: {
    kind: 'purSupplier',
    label: 'Supplier',
    table: 'purSuppliers',
    companyScoped: true,
    keptBy: 'Procurement',
    screen: 'Procurement',
    note: 'Each supplier is registered as Procurement registers one by hand. Finance still verifies each bank account and reviews each supplier; nothing is paid from an imported row.',
    fields: [
      { key: 'name', label: 'Supplier', type: 'text', required: true, words: ['supplier', 'supplier name', 'nama pembekal', 'pembekal', 'vendor', 'vendor name', 'company name', 'nama syarikat'] },
      { key: 'ssmNo', label: 'SSM number', type: 'text', required: true },
      { key: 'categories', label: 'Categories', type: 'text', help: 'Uniform, Guard equipment, Device, Patrol device, Cleaning, Services, IT or Other; several separated by commas.' },
      { key: 'bankName', label: 'Bank', type: 'text', required: true },
      { key: 'bankAccount', label: 'Bank account number', type: 'text', required: true, restricted: true },
      { key: 'coiDeclared', label: 'Conflict of interest declared', type: 'bool' },
      { key: 'abcAck', label: 'Anti-bribery acknowledged', type: 'bool' },
    ],
  },
  publicHoliday: {
    kind: 'publicHoliday',
    label: 'Public holiday',
    table: 'publicHolidays',
    companyScoped: false,
    keptBy: 'HR',
    screen: 'HR, Holidays',
    note: 'Each holiday is added as HR adds one by hand. Leave the states empty for a national holiday.',
    fields: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'name', label: 'Holiday', type: 'text', required: true, words: ['holiday', 'cuti', 'nama cuti', 'perayaan', 'occasion', 'cuti umum', 'public holiday'] },
      { key: 'states', label: 'States', type: 'text', help: 'Empty for the whole country; several separated by commas.' },
      { key: 'note', label: 'Note', type: 'text' },
    ],
  },
  branch: {
    kind: 'branch',
    label: 'Branch',
    table: 'branches',
    companyScoped: true,
    keptBy: 'Company manager',
    screen: 'Branches',
    note: 'Each branch starts as proposed, as the Add branch form makes it; its setup and approval follow as usual.',
    fields: [
      { key: 'name', label: 'Branch', type: 'text', required: true, words: ['branch', 'branch name', 'cawangan', 'nama cawangan'] },
      { key: 'state', label: 'State', type: 'text', required: true },
      {
        key: 'model',
        label: 'Model',
        type: 'select',
        required: true,
        options: [
          ['A', 'Model A'],
          ['B', 'Model B'],
          ['C', 'Model C'],
        ],
      },
    ],
  },
  itAsset: {
    kind: 'itAsset',
    label: 'IT equipment',
    table: 'itAssets',
    companyScoped: true,
    keptBy: 'IT',
    screen: 'IT',
    note: 'Each device is recorded as IT records existing equipment by hand (spare, not connected to anything). A purchase is never made from an imported row.',
    fields: [
      { key: 'tag', label: 'Asset tag', type: 'text', required: true },
      { key: 'serial', label: 'Serial number', type: 'text', required: true },
      { key: 'kind', label: 'Device kind', type: 'select', required: true, options: IT_ASSET_KINDS, words: ['device type', 'jenis peranti', 'equipment type'] },
      { key: 'model', label: 'Model', type: 'text', required: true },
      { key: 'location', label: 'Location', type: 'text', required: true },
      { key: 'unitLabel', label: 'Unit or department', type: 'text', words: ['department', 'jabatan', 'unit', 'bahagian', 'user', 'pengguna'] },
      { key: 'boughtOn', label: 'Bought on', type: 'date' },
      { key: 'warrantyTo', label: 'Warranty until', type: 'date' },
    ],
  },
  // P91: Operations, Security, Equipment and HR records (org-import-ops.ts).
  ...P91_IMPORTS,
};

/** Record kinds that may be imported in bulk. */
export const IMPORTABLE_KINDS: readonly ImportKind[] = Object.freeze([
  'site',
  'post',
  'checkpoint',
  'licence',
  'insurancePolicy',
  'insuranceGuarantee',
  'vehicle',
  'stockItem',
  'hostel',
  'officeStaff',
  'amUnit',
  'amAsset',
  'itDomain',
  // P81: the audit's other kinds with a plain form (arms register kinds stay out: vault, firearm, dealer licence,
  // armed job agreements keep their own reviewed paths).
  'insuranceClaim',
  'amWorkOrder',
  'phoneExtension',
  'siteSystem',
  'cmsStaff',
  'armsSupplier',
  'supplierItem',
  'client',
  'contract',
  'leaveEntitlement',
  // P90: Fitri's audit (9 Nov 2026), see docs/P90_IMPORT_AUDIT.md.
  'fwWorker',
  'purSupplier',
  'publicHoliday',
  'branch',
  'itAsset',
  // P91: see docs/P91_ADD_IMPORT_OPS.md.
  ...P91_IMPORT_KINDS,
] as ImportKind[]);

export const IMPORT_MAX_ROWS = 500;
export const IMPORT_MAX_BYTES = 1_000_000;

const isRecordKind = (k: ImportKind): k is RecordKind => Object.prototype.hasOwnProperty.call(RECORD_KINDS, k);

/** The fields and keeper of an importable kind. */
export function importSpec(kind: ImportKind): ImportSpec {
  if (!IMPORTABLE_KINDS.includes(kind)) throw new ImportError('This kind of record is not imported in bulk.', 400);
  return isRecordKind(kind) ? (RECORD_KINDS[kind] as ImportSpec) : EXTRA_IMPORTS[kind as ExtraImportKind];
}

export interface OrgImportReceipt {
  id: Id;
  /** SHA-256 of kind, company and the cleaned rows. */
  fingerprint: string;
  kind: ImportKind;
  companyId: Id | null;
  rows: number;
  recordIds: Id[];
  byId: Id;
  by: string;
  at: IsoDateTime;
  /** P81: rows of the file the person chose not to import. */
  skippedRows?: number[];
  /** P81: the companies the rows went to, when a Company column sent them to more than one. */
  companyIds?: Id[];
}

export interface ImportRowResult {
  row: number;
  ok: boolean;
  /** P81: left out by the person; not checked, not imported. */
  skipped: boolean;
  problems: string[];
  /** What will be saved, restricted fields masked to the last 4. */
  values: Record<string, string>;
  /** P81: the company the row goes to (from a Company column), and whether the name was a close guess. */
  company: { id: Id; name: string; guess: boolean } | null;
}

export interface ImportOptions {
  /** The field for each column of the header row ('' for a column not used). Without it, Prima's own matching. */
  mapping?: string[] | null;
  /** The header row, as an index into the file's rows (blank rows not counted). Without it, Prima finds it. */
  headerRow?: number | null;
  /** File row numbers (as the preview gives them) not to import. */
  skip?: number[] | null;
}

type RecordFormLike = {
  spec: (typeof RECORD_KINDS)[RecordKind];
  companyId: Id | null;
  options: Record<string, [string, string][]>;
  chooseCompany?: [string, string][] | null;
};

/** The narrow part of PrimaService the import uses. */
export interface ImportSaver extends P91ImportSaver {
  recordForm(user: User, kind: RecordKind, id: Id | null, companyId: Id | null): Promise<RecordFormLike>;
  saveRecord(user: User, kind: RecordKind, id: Id | null, companyId: Id | null, raw: RecordValues): Promise<unknown>;
  addClientAccount(user: User, input: { companyId: Id; name: string; siteIds: Id[]; contractEndsOn: IsoDate | null }): Promise<{ id: Id }>;
  addContract(
    user: User,
    input: {
      companyId: Id;
      clientAccountId: Id | null;
      clientName: string;
      siteIds: Id[];
      startOn: IsoDate;
      endOn: IsoDate;
      billingMethod: BillingMethod;
      rate: number;
      fixedFee: number | null;
      contractedHours?: number | null;
      signedRef: string;
    },
    opts?: { imported?: boolean },
  ): Promise<{ id: Id }>;
  setLeaveOverride(user: User, personId: Id, kind: LeaveOverrideKind, days: number | null, note: string): Promise<unknown>;
  /** P90 kinds: the screen's own add, permission check included. */
  addFwWorker(user: User, input: FwWorkerInput): Promise<{ person: { id: Id } }>;
  addPurSupplier(
    user: User,
    companyId: Id,
    input: { name: string; ssmNo: string; categories: PurCategory[]; bankName: string; bankAccount: string; coiDeclared: boolean; abcAck: boolean },
  ): Promise<{ id: Id }>;
  addPublicHoliday(user: User, input: { date: IsoDate; name: string; states: string[] | null; compulsory: null; note: string }): Promise<unknown>;
  addBranch(user: User, companyId: Id, input: { name: string; state: string; model: 'A' | 'B' | 'C' }): Promise<{ id: Id }>;
  importItAsset(
    user: User,
    companyId: Id,
    input: { tag: string; serial: string; kind: string; model: string; location: string; unitLabel: string; boughtOn: IsoDate | null; warrantyTo: IsoDate | null },
  ): Promise<{ id: Id }>;
}

/** P90: a foreign worker added by FWM by hand or from an old list (no JA record needed). */
export interface FwWorkerInput {
  companyId: Id;
  branchId: Id;
  staffNo: string;
  name: string;
  nationality?: string | null;
  dob: IsoDate;
  hiredOn: IsoDate;
  phone?: string | null;
  passportNo?: string | null;
  passportIssuedOn?: IsoDate | null;
  passportExpiresOn?: IsoDate | null;
  permitNo?: string | null;
  permitIssuedOn?: IsoDate | null;
  permitExpiresOn?: IsoDate | null;
  fomemaExpiresOn?: IsoDate | null;
  insuranceExpiresOn?: IsoDate | null;
  spikpaExpiresOn?: IsoDate | null;
}

export class ImportError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 409,
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and line breaks inside quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (quoted) throw new ImportError('The file has a quote that is never closed.', 400);
  row.push(field);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

/**
 * A spreadsheet value to the form's value: yes/no (English or Malay), a choice by key, label or Malay word, refs by id
 * or name, dates as typed in Malaysia or as Excel serials, amounts with RM and commas.
 */
function convert(f: FieldSpec, raw: string, options: [string, string][] | undefined): { value: unknown; problem?: string } {
  const v = raw.trim();
  if (v === '') return { value: f.type === 'bool' ? false : null };
  switch (f.type) {
    case 'bool': {
      const b = normBool(v);
      return b === null ? { value: null, problem: `${f.label}: write yes or no (ya or tidak).` } : { value: b };
    }
    case 'date': {
      const d = normDate(v);
      // A date that is not on the calendar (30/02, 31/04) is refused here, not stored as text.
      if (d.matched && !d.iso) return { value: null, problem: `${f.label}: "${v}" is not a real date.` };
      if (!d.matched) return { value: null, problem: `${f.label}: "${v}" is not a date. Write it as DD/MM/YYYY.` };
      return { value: d.iso };
    }
    case 'number': {
      const n = normMoney(v);
      return n === null ? { value: null, problem: `${f.label}: "${v.slice(0, 40)}" is not a number.` } : { value: n };
    }
    case 'select': {
      const hit = matchOption(v, f.options ?? []);
      // Unknown choices go on to the form's own check, which names the field ("Choose ... from the list").
      return hit !== null ? { value: hit } : { value: v };
    }
    case 'ref': {
      const exact = (options ?? []).filter(([k, label]) => k === v || normHeader(label) === normHeader(v));
      // The list shows "code name" (or "policy number cover"): the code or number alone names it too.
      let hit = exact.length ? exact : (options ?? []).filter(([, label]) => normHeader(label).startsWith(normHeader(v) + ' '));
      // "PL-446289" also prefixes last year's renewed "PL-446289-P" once punctuation is dropped: a code typed exactly
      // as its first word names that one.
      if (hit.length > 1) {
        const word = hit.filter(([, label]) => label.trim().split(/\s+/)[0].toLowerCase() === v.toLowerCase());
        if (word.length === 1) hit = word;
      }
      if (hit.length === 1) return { value: hit[0][0] };
      return { value: null, problem: hit.length ? `${f.label}: "${v}" matches more than one; use the code.` : `${f.label}: "${v}" is not on the list.` };
    }
    default:
      return { value: v };
  }
}

const DRY = Symbol('dry-run');

/** Run work and roll all of it back (database savepoint, or a snapshot in the in-memory store). */
async function rolledBack<R>(store: Store, fn: () => Promise<R>): Promise<R> {
  let out: R | undefined;
  const unit = store.cleanupTransaction ? store.cleanupTransaction.bind(store) : store.transaction.bind(store);
  try {
    await unit(async () => {
      out = await fn();
      throw DRY;
    });
  } catch (e) {
    if (e !== DRY) throw e;
  }
  return out as R;
}

/** Two people importing the same records at the same moment: the database's unique keys let only one through. */
const SAME_TIME = 'Someone else has already imported these records, or is importing them now. Nothing of yours was saved; check the list first.';
function sameTimeClash(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === '23505';
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'This row could not be saved.';
}

const COMPANY_ALIGN: AlignField = { key: COMPANY_FIELD, label: 'Company', type: 'text' };

type Company = { id: Id; name: string; code?: string };
type Form = { companyId: Id | null; options: Record<string, [string, string][]> };

export class OrgImportService {
  private opsRows: OpsImportRows | null = null;
  constructor(
    private store: Store,
    private saver: ImportSaver,
    private now: () => IsoDateTime,
  ) {}

  /** The template for a kind: the column headers, with which are needed and the choices. */
  template(kind: ImportKind) {
    const spec = importSpec(kind);
    return {
      kind,
      label: spec.label,
      keptBy: spec.keptBy,
      companyScoped: spec.companyScoped,
      note: spec.note ?? null,
      columns: spec.fields.map((f) => ({
        key: f.key,
        label: f.label,
        required: !!f.required,
        type: f.type,
        choices: f.type === 'select' ? (f.options ?? []).map(([, l]) => l) : undefined,
        help: f.help ?? null,
      })),
      csvHeader: spec.fields.map((f) => f.key).join(','),
    };
  }

  /** The companies a Company column may name: those the person keeps this record for. */
  private async companyChoices(user: User, kind: ImportKind): Promise<Company[]> {
    const all = (await this.store.list('companies', {})) as unknown as Company[];
    if (!isRecordKind(kind)) return all.map((c) => ({ id: c.id, name: c.name, code: c.code }));
    let form: RecordFormLike;
    try {
      form = await this.saver.recordForm(user, kind, null, null);
    } catch {
      return [];
    }
    const byId = new Map(all.map((c) => [c.id, c]));
    return (form.chooseCompany ?? []).map(([id, label]) => {
      const c = byId.get(id);
      return c ? { id, name: c.name, code: c.code } : { id, name: label };
    });
  }

  /** The form for one company: its permission check (throws for someone who does not keep it) and lists. */
  private async formFor(user: User, kind: ImportKind, spec: ImportSpec, cid: Id | null): Promise<Form> {
    if (isRecordKind(kind)) {
      const form = await this.saver.recordForm(user, kind, null, cid);
      if (form.chooseCompany) throw new ImportError('Choose the company the records belong to, or add a Company column.', 400);
      return { companyId: form.companyId, options: form.options };
    }
    if (spec.companyScoped && !cid) throw new ImportError('Choose the company the records belong to, or add a Company column.', 400);
    return { companyId: cid, options: {} };
  }

  private async prepare(user: User, kind: ImportKind, companyId: Id | null, csv: string, opt: ImportOptions = {}) {
    const spec = importSpec(kind);
    if (typeof csv !== 'string' || !csv.trim()) throw new ImportError('Attach the file (Excel or CSV).', 400);
    if (csv.length > IMPORT_MAX_BYTES) throw new ImportError('The file is too big; split it into parts of 500 rows.', 400);
    // Same permission as adding one record by hand; throws for anyone who does not keep this record.
    const base = spec.companyScoped && !companyId ? null : await this.formFor(user, kind, spec, companyId);
    const table = parseCsv(csv);
    const fields: AlignField[] = [...(spec.fields as AlignField[]), ...(spec.companyScoped ? [COMPANY_ALIGN] : [])];
    let headerRow = findHeaderRow(table, fields);
    if (opt.headerRow !== undefined && opt.headerRow !== null) {
      if (!Number.isInteger(opt.headerRow) || opt.headerRow < 0 || opt.headerRow >= table.length) throw new ImportError('Choose a header row inside the file.', 400);
      headerRow = opt.headerRow;
    }
    const header = table[headerRow] ?? [];
    const body = table.slice(headerRow + 1);
    if (!body.length) throw new ImportError('The file has no rows under the column names.', 400);
    if (body.length > IMPORT_MAX_ROWS) throw new ImportError(`At most ${IMPORT_MAX_ROWS} rows at a time.`, 400);
    const width = Math.max(header.length, ...body.map((r) => r.length));
    const head = Array.from({ length: width }, (_, i) => header[i] ?? '');
    const auto = alignColumns(head, body, fields);
    let columns: ColumnMatch[] = auto;
    if (opt.mapping) {
      if (!Array.isArray(opt.mapping) || opt.mapping.length > width + 1) throw new ImportError('The column choices do not fit this file. Check the file again.', 400);
      const seen = new Map<string, number>();
      columns = auto.map((c) => {
        const want = typeof opt.mapping![c.index] === 'string' ? opt.mapping![c.index] : '';
        if (want && !fields.some((f) => f.key === want)) throw new ImportError('A column is set to a field this record does not have.', 400);
        if (want && seen.has(want)) throw new ImportError(`Two columns are set to "${fields.find((f) => f.key === want)!.label}". Choose one of them.`, 400);
        if (want) seen.set(want, c.index);
        return want === c.field ? c : { ...c, field: want || null, how: want ? 'manual' : null, score: want ? 1 : 0 };
      });
    }
    const fieldOf = columns.map((c) => fields.find((f) => f.key === c.field) ?? null);
    const companyCol = columns.findIndex((c) => c.field === COMPANY_FIELD);
    if (spec.companyScoped && !base && companyCol < 0) throw new ImportError('Choose the company the records belong to, or add a Company column.', 400);
    const choices = companyCol >= 0 ? await this.companyChoices(user, kind) : [];
    const forms = new Map<string, Promise<Form>>();
    const formOf = (cid: Id | null) => {
      const key = cid ?? '';
      if (base && cid === base.companyId) return Promise.resolve(base);
      if (!forms.has(key)) forms.set(key, this.formFor(user, kind, spec, cid));
      return forms.get(key)!;
    };
    const missing = spec.fields.filter((f) => f.required && !fieldOf.includes(f as AlignField)).map((f) => f.label);
    const ignored = columns.filter((c) => !c.field && c.header).map((c) => c.header);
    const skip = new Set((opt.skip ?? []).filter((n) => Number.isInteger(n)));
    const companyName = new Map(choices.map((c) => [c.id, c.name]));
    const seen = new Set<string>();
    const rows: { row: number; skipped: boolean; companyId: Id | null; company: ImportRowResult['company']; raw: RecordValues; problems: string[] }[] = [];
    for (const [i, cells] of body.entries()) {
      const rowNo = headerRow + 2 + i;
      const problems: string[] = [];
      let cid: Id | null = base?.companyId ?? null;
      let company: ImportRowResult['company'] = null;
      if (companyCol >= 0) {
        const text = (cells[companyCol] ?? '').trim();
        const hit = text ? matchCompany(text, choices) : null;
        if (hit) {
          cid = hit.id;
          company = { id: hit.id, name: companyName.get(hit.id) ?? hit.id, guess: !hit.exact };
        } else if (text) problems.push(`Company "${text.slice(0, 80)}" is not one of the companies you keep this record for.`);
        else if (!base) problems.push('Company is empty on this row.');
      }
      let form: Form | null = null;
      if (!problems.length || !spec.companyScoped)
        try {
          form = await formOf(cid);
        } catch (e) {
          problems.push(messageOf(e));
        }
      const raw: RecordValues = {};
      fieldOf.forEach((f, c) => {
        if (!f || f.key === COMPANY_FIELD) return;
        const { value, problem } = convert(f as FieldSpec, cells[c] ?? '', form?.options[f.key]);
        if (problem) problems.push(problem);
        (raw as Record<string, unknown>)[f.key] = value;
      });
      const skipped = skip.has(rowNo);
      if (!skipped) {
        const key = cleanupCanonical({ cid, raw });
        if (seen.has(key)) problems.push('The same row appears earlier in the file.');
        seen.add(key);
      }
      rows.push({ row: rowNo, skipped, companyId: form?.companyId ?? cid, company, raw, problems });
    }
    const chosen = rows.filter((r) => !r.skipped);
    const baseId = base?.companyId ?? null;
    // One company and nothing skipped prints exactly as before P81, so a file imported then is still refused now.
    const fingerprint = sha256Hex(
      cleanupCanonical({ kind, companyId: baseId, rows: chosen.map((r) => (r.companyId === baseId ? r.raw : { ...r.raw, [COMPANY_FIELD]: r.companyId })) }),
    );
    const sample = (i: number, f: AlignField | null) =>
      body
        .map((r) => (r[i] ?? '').trim())
        .filter(Boolean)
        .slice(0, 3)
        .map((v) => (f?.restricted ? `••••${v.slice(-4)}` : v.slice(0, 60)));
    return {
      spec,
      companyId: baseId,
      headerRow,
      columns: columns.map((c, i) => ({ ...c, sample: sample(c.index, fieldOf[i]) })),
      fields: fields.map((f) => ({ key: f.key, label: f.label, required: !!f.required, type: f.type })),
      rows,
      ignored,
      missing,
      fingerprint,
    };
  }

  private shown(spec: ImportSpec, raw: RecordValues): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of spec.fields) {
      const v = (raw as Record<string, unknown>)[f.key];
      if (v === null || v === undefined || v === '') continue;
      const s = String(v);
      out[f.key] = f.restricted ? `••••${s.slice(-4)}` : s.slice(0, 160);
    }
    return out;
  }

  /** Sites named in a cell ("S-01, Menara A"), as ids of this company's sites. */
  private async siteIds(cid: Id, text: unknown): Promise<Id[]> {
    const names = String(text ?? '')
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!names.length) return [];
    const sites = (await this.store.list('sites', { companyId: [cid] })) as unknown as { id: Id; code: string; name: string }[];
    return names.map((n) => {
      const k = normHeader(n);
      const hit = sites.filter((s) => s.id === n || normHeader(s.code) === k || normHeader(s.name) === k);
      if (hit.length !== 1) throw new ImportError(hit.length ? `Site "${n}" matches more than one site; use its code.` : `Site "${n}" is not a site of this company.`, 400);
      return hit[0].id;
    });
  }

  /** One row through the record's own save. Returns the new record's id where the save gives it. */
  private async saveRow(user: User, kind: ImportKind, cid: Id | null, raw: RecordValues): Promise<Id | null> {
    if (isRecordKind(kind)) {
      await this.saver.saveRecord(user, kind, null, cid, raw);
      return null;
    }
    const v = raw as Record<string, unknown>;
    if (isP91Kind(kind)) return (this.opsRows ??= new OpsImportRows(this.store, this.saver)).save(user, kind, v);
    const companyId = cid as Id;
    const num = (x: unknown) => (x === null || x === undefined || x === '' ? null : Number(x));
    if (kind === 'client') {
      const a = await this.saver.addClientAccount(user, {
        companyId,
        name: String(v.name ?? ''),
        siteIds: await this.siteIds(companyId, v.sites),
        contractEndsOn: (v.contractEndsOn as IsoDate | null) ?? null,
      });
      return a.id;
    }
    if (kind === 'contract') {
      const name = String(v.clientName ?? '').trim();
      const accounts = (await this.store.list('clientAccounts', { companyId })) as unknown as { id: Id; name: string; stage: string }[];
      const acct = accounts.filter((a) => a.stage !== 'ended' && normHeader(a.name) === normHeader(name));
      const c = await this.saver.addContract(user, {
        companyId,
        clientAccountId: acct.length === 1 ? acct[0].id : null,
        clientName: name,
        siteIds: await this.siteIds(companyId, v.sites),
        startOn: String(v.startOn ?? ''),
        endOn: String(v.endOn ?? ''),
        billingMethod: String(v.billingMethod ?? '') as BillingMethod,
        rate: num(v.rate) ?? 0,
        fixedFee: num(v.fixedFee),
        contractedHours: num(v.contractedHours),
        signedRef: String(v.signedRef ?? ''),
      }, { imported: true });
      return c.id;
    }
    if (kind === 'fwWorker') {
      const want = String(v.branch ?? '').trim();
      const branches = (await this.store.list('branches', { companyId: [companyId] })) as unknown as { id: Id; name: string; state: string; status?: string }[];
      const open = branches.filter((b) => b.status !== 'closed');
      const k = normHeader(want);
      let hit = open.filter((b) => b.id === want || normHeader(b.name) === k);
      // "Kuala Lumpur" for the "KL Branch": a branch named by its state, when only one branch is in that state.
      if (!hit.length) hit = open.filter((b) => normHeader(b.state) === k || normHeader(b.name).includes(k));
      if (hit.length !== 1) throw new ImportError(hit.length ? `Branch "${want}" matches more than one branch; use its full name.` : `Branch "${want}" is not a branch of this company.`, 400);
      const d = (x: unknown) => (x === null || x === undefined || x === '' ? null : String(x));
      const r = await this.saver.addFwWorker(user, {
        companyId,
        branchId: hit[0].id,
        staffNo: String(v.staffNo ?? ''),
        name: String(v.name ?? ''),
        nationality: d(v.nationality),
        dob: String(v.dob ?? ''),
        hiredOn: String(v.hiredOn ?? ''),
        phone: d(v.phone),
        passportNo: d(v.passportNo),
        passportIssuedOn: d(v.passportIssuedOn),
        passportExpiresOn: d(v.passportExpiresOn),
        permitNo: d(v.permitNo),
        permitIssuedOn: d(v.permitIssuedOn),
        permitExpiresOn: d(v.permitExpiresOn),
        fomemaExpiresOn: d(v.fomemaExpiresOn),
        insuranceExpiresOn: d(v.insuranceExpiresOn),
        spikpaExpiresOn: d(v.spikpaExpiresOn),
      });
      return r.person.id;
    }
    if (kind === 'purSupplier') {
      const cats = String(v.categories ?? '')
        .split(/[,;\n/]+/)
        .map((x) => x.trim())
        .filter(Boolean);
      const categories = cats.map((c) => {
        const hit = matchOption(c, PUR_CATEGORY_WORDS);
        if (!hit) throw new ImportError(`Category "${c.slice(0, 40)}" is not one of: ${PUR_CATEGORY_WORDS.map(([, l]) => l).join(', ')}.`, 400);
        return hit as PurCategory;
      });
      const s = await this.saver.addPurSupplier(user, companyId, {
        name: String(v.name ?? ''),
        ssmNo: String(v.ssmNo ?? ''),
        categories: [...new Set(categories)],
        bankName: String(v.bankName ?? ''),
        bankAccount: String(v.bankAccount ?? '').replace(/[\s-]/g, ''),
        coiDeclared: v.coiDeclared === true,
        abcAck: v.abcAck === true,
      });
      return s.id;
    }
    if (kind === 'publicHoliday') {
      const states = String(v.states ?? '')
        .split(/[,;\n]+/)
        .map((x) => x.trim())
        .filter(Boolean);
      const r = (await this.saver.addPublicHoliday(user, { date: String(v.date ?? ''), name: String(v.name ?? ''), states: states.length ? states : null, compulsory: null, note: String(v.note ?? '') })) as { id?: Id } | undefined;
      return r?.id ?? null;
    }
    if (kind === 'branch') {
      const b = await this.saver.addBranch(user, companyId, { name: String(v.name ?? ''), state: String(v.state ?? ''), model: String(v.model ?? '') as 'A' | 'B' | 'C' });
      return b.id;
    }
    if (kind === 'itAsset') {
      const a = await this.saver.importItAsset(user, companyId, {
        tag: String(v.tag ?? ''),
        serial: String(v.serial ?? ''),
        kind: String(v.kind ?? ''),
        model: String(v.model ?? ''),
        location: String(v.location ?? ''),
        unitLabel: String(v.unitLabel ?? ''),
        boughtOn: (v.boughtOn as IsoDate | null) ?? null,
        warrantyTo: (v.warrantyTo as IsoDate | null) ?? null,
      });
      return a.id;
    }
    // leaveEntitlement: the staff member by staff number (or the exact name) within this company.
    const who = String(v.staffNo ?? '').trim();
    const people = ((await this.store.list('people', { companyId: [companyId] })) as unknown as { id: Id; staffNo: string; name: string; role: string }[]).filter(
      (p) => p.role === 'office',
    );
    const byNo = people.filter((p) => normHeader(p.staffNo) === normHeader(who));
    const hit = byNo.length ? byNo : people.filter((p) => normHeader(p.name) === normHeader(who));
    if (hit.length !== 1) throw new ImportError(hit.length ? `"${who}" matches more than one staff member; use the staff number.` : `No office staff member "${who}" in this company.`, 400);
    const days = Number(v.days);
    if (!Number.isInteger(days)) throw new ImportError('Days a year must be a whole number.', 400);
    await this.saver.setLeaveOverride(user, hit[0].id, String(v.leaveKind ?? '') as LeaveOverrideKind, days, String(v.note ?? ''));
    return hit[0].id;
  }

  /** Import runs with the hand-over layer (same switch, same database module); the guide card says the same. */
  private assertOn() {
    if (!orgLinksOn(this.store)) throw new ImportError('Import is switched off here until the release owner turns hand-overs and import on.', 403);
  }

  /** Dry run: every chosen row through the real save, then everything rolled back. */
  async preview(user: User, kind: ImportKind, companyId: Id | null, csv: string, opt: ImportOptions = {}) {
    this.assertOn();
    const p = await this.prepare(user, kind, companyId, csv, opt);
    const results: ImportRowResult[] = await rolledBack(this.store, () =>
      withoutHandOvers(this.store, async () => {
        const out: ImportRowResult[] = [];
        for (const r of p.rows) {
          const problems = [...r.problems];
          if (!r.skipped && !problems.length && !p.missing.length) {
            try {
              await this.store.transaction(() => this.saveRow(user, kind, r.companyId, r.raw));
            } catch (e) {
              problems.push(messageOf(e));
            }
          }
          out.push({
            row: r.row,
            ok: !r.skipped && !problems.length && !p.missing.length,
            skipped: r.skipped,
            problems: r.skipped ? [] : problems,
            values: this.shown(p.spec, r.raw),
            company: r.company,
          });
        }
        return out;
      }),
    );
    const already = (await this.store.list('orgImports', {})).find((x) => x.fingerprint === p.fingerprint) ?? null;
    const chosen = results.filter((r) => !r.skipped);
    return {
      kind,
      label: p.spec.label,
      companyId: p.companyId,
      fingerprint: p.fingerprint,
      headerRow: p.headerRow,
      columns: p.columns,
      fields: p.fields,
      rows: results,
      okRows: chosen.filter((r) => r.ok).length,
      badRows: chosen.filter((r) => !r.ok).length,
      skippedRows: results.filter((r) => r.skipped).length,
      missingColumns: p.missing,
      ignoredColumns: p.ignored,
      alreadyImported: already ? { at: already.at, by: already.by } : null,
      canImport: !already && !p.missing.length && chosen.length > 0 && chosen.every((r) => r.ok),
    };
  }

  /** Import the previewed file: unchanged, every chosen row clean, never twice. All chosen rows or none. */
  async commit(user: User, kind: ImportKind, companyId: Id | null, csv: string, fingerprint: string, opt: ImportOptions = {}) {
    this.assertOn();
    const p = await this.prepare(user, kind, companyId, csv, opt);
    if (!/^[0-9a-f]{64}$/.test(fingerprint ?? '') || fingerprint !== p.fingerprint)
      throw new ImportError('The file changed since the preview. Preview it again.', 409);
    if (p.missing.length) throw new ImportError(`Columns needed: ${p.missing.join(', ')}.`, 400);
    const chosen = p.rows.filter((r) => !r.skipped);
    if (!chosen.length) throw new ImportError('Every row is skipped. Choose at least one row to import.', 400);
    const bad = chosen.filter((r) => r.problems.length);
    if (bad.length) throw new ImportError(`Fix or skip rows ${bad.map((r) => r.row).slice(0, 10).join(', ')} first.`, 400);
    return this.commitOnce(user, kind, p).catch((e) => {
      if (sameTimeClash(e)) throw new ImportError(SAME_TIME, 409);
      throw e;
    });
  }

  private commitOnce(user: User, kind: ImportKind, p: Awaited<ReturnType<OrgImportService['prepare']>>) {
    const chosen = p.rows.filter((r) => !r.skipped);
    // P81: the database transaction makes it all or none; the in-memory store (demo, tests) has no rollback of its
    // own, so there the snapshot unit wraps it and a refused row puts back what the earlier rows wrote.
    const unit = <R,>(fn: (tx: Store) => Promise<R>): Promise<R> =>
      this.store.cleanupTransaction ? this.store.cleanupTransaction(() => this.store.transaction(fn)) : this.store.transaction(fn);
    return unit(async (tx) => {
      const receipts = await tx.list('orgImports', {});
      if (receipts.some((x) => x.fingerprint === p.fingerprint)) throw new ImportError('This file was already imported.', 409);
      const before = new Set((await tx.list(p.spec.table as never, {})).map((r) => (r as { id: Id }).id));
      const returned: Id[] = [];
      await withoutHandOvers(tx, async () => {
        for (const r of chosen) {
          try {
            const id = await this.saveRow(user, kind, r.companyId, r.raw);
            if (id) returned.push(id);
          } catch (e) {
            if (sameTimeClash(e)) throw new ImportError(SAME_TIME, 409);
            throw new ImportError(`Row ${r.row}: ${messageOf(e)} Nothing was imported.`, 400);
          }
        }
      });
      // Public holidays give back the year's list, not the new row: their ids are read from the table, as records' are.
      const recordIds = isRecordKind(kind) || kind === 'publicHoliday'
        ? (await tx.list(p.spec.table as never, {})).map((r) => (r as { id: Id }).id).filter((id) => !before.has(id))
        : [...new Set(returned)];
      const at = this.now();
      const companyIds = [...new Set(chosen.map((r) => r.companyId).filter((x): x is Id => !!x))];
      const skippedRows = p.rows.filter((r) => r.skipped).map((r) => r.row);
      const receipt: OrgImportReceipt = {
        id: `oimp-${p.fingerprint.slice(0, 16)}`,
        fingerprint: p.fingerprint,
        kind,
        companyId: p.companyId ?? (companyIds.length === 1 ? companyIds[0] : null),
        rows: chosen.length,
        recordIds,
        byId: user.id,
        by: user.name,
        at,
        ...(skippedRows.length ? { skippedRows } : {}),
        ...(companyIds.length > 1 ? { companyIds } : {}),
      };
      await tx.insert('orgImports', receipt);
      await tx.audit({
        at,
        actor: user.name,
        companyId: receipt.companyId,
        action: 'org.import',
        entity: 'org_import',
        entityId: receipt.id,
        summary: `${chosen.length} ${p.spec.label.toLowerCase()} record${chosen.length === 1 ? '' : 's'} imported from a file${skippedRows.length ? `, ${skippedRows.length} row${skippedRows.length === 1 ? '' : 's'} skipped` : ''}${companyIds.length > 1 ? `, into ${companyIds.length} companies` : ''} (fingerprint ${p.fingerprint.slice(0, 12)}).`,
      });
      return receipt;
    });
  }
}
