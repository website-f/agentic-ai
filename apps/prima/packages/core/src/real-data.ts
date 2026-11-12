// P81: Prima with the group's real companies and staff instead of sample data (Fauzan, 6 Nov 2026: "reinstall with only
// the real companies from the list and their staff"). A small versioned JSON file, built from the staff list outside
// the repository (apps/prima/scripts/build-real-data.mjs), is read by db-setup when the database is empty
// (PRIMA_REAL_DATA). The file holds personal data, so it never sits in the repository, a test or a log.
//
// What a real-data dataset holds, and what it does not:
//  - one company record per licensed company, and one for Prisma Wiramaju (asset management). The central employers
//    (PWVSB, Merdeka Network, Goodwill Empire, Sasa Team) keep their structural ids and, as before, have no company record;
//  - the settings the clean slate keeps (REAL_DATA_SETTINGS), with the sample author names taken off;
//  - the CEO's sign-in (u-fauzan) with a grant to every company, and the system feeds with the grants their walls need;
//  - one office staff record per real person, in their employer and department. What the list does not say (IC, birth
//    date, joining date, phone, staff number, nationality, pay, branch) stays empty: "not recorded yet" (missingStaffFacts),
//    never invented. Payroll refuses to pay a record without its birth date, joining date or nationality.
//  - no sample people, sample sign-ins, "(mock)" companies, licences, branches, sites or rosters.

import { GOV_OPS_COMPANY_ID, GROUP_EMPLOYER_ID, IT_COMPANY_ID, LOGISTICS_COMPANY_ID, LOGISTICS_COMPANY_NAME, PRIVATE_OPS_COMPANY_ID, PWVSB_HQ_BRANCH, isCentralEmployer } from './access';
import { sha256Hex } from './audit';
import { regionOfState } from './regions';
import { addDays } from './time';
import type { AuthorityGrant, Company, Dataset, Id, IsoDate, Nationality, Person, User } from './types';

export const REAL_DATA_FORMAT = 'prima-real-data';
export const REAL_DATA_VERSION = 1;

/**
 * What a company is in the group. Only 'licensed' and 'asset' get a company record. E5 (Fauzan, 11 Nov 2026): Perfect
 * Global Logistics ('logistics') is also an employer of staff (the Transport department), a central employer like the rest.
 */
export type RealCompanyRole = 'licensed' | 'central' | 'gov_ops' | 'private_ops' | 'asset' | 'it' | 'logistics';
export const REAL_COMPANY_ROLES: readonly RealCompanyRole[] = ['licensed', 'central', 'gov_ops', 'private_ops', 'asset', 'it', 'logistics'];

/** The structural employer ids the code depends on, by role. */
export const STRUCTURAL_COMPANY_IDS: Readonly<Record<'central' | 'gov_ops' | 'private_ops' | 'it' | 'logistics', Id>> = {
  central: GROUP_EMPLOYER_ID,
  gov_ops: GOV_OPS_COMPANY_ID,
  private_ops: PRIVATE_OPS_COMPANY_ID,
  it: IT_COMPANY_ID,
  logistics: LOGISTICS_COMPANY_ID,
};

/**
 * Other names the staff list and the office's branches use for the central employers, for the office's branch-to-company
 * suggestion (api/office/companies). Names of units and companies only, never of people.
 */
export const CENTRAL_ALIASES: Readonly<Record<Id, readonly string[]>> = {
  [GROUP_EMPLOYER_ID]: [
    'PW Venture Sdn Bhd',
    'PW Venture',
    'PWVSB',
    'Unit HR',
    'Unit Kewangan',
    'Unit Kewangan (Leader)',
    'Unit Kewangan (DE)',
    'Unit Audit',
    'Unit Audit / Audit HQ',
    'Audit HQ',
    'Control Room',
    'Unit Nepal',
    'Pengurusan Nepal',
  ],
  [IT_COMPANY_ID]: ['Merdeka Network Sdn Bhd', 'Merdeka Network', 'Unit IT'],
  [GOV_OPS_COMPANY_ID]: [
    'Goodwill Empire Sdn Bhd',
    'Goodwill Empire',
    'Unit Pengurusan Sekolah',
    'Unit Pengurusan KBK',
    'Pengurusan Sekolah PKK / KBK',
    'Operasi KL / Selangor',
    'Operasi Johor',
    'Operasi Melaka',
    'Operasi Pahang',
    'Operasi Kelantan',
    'Operasi Terengganu',
    'Operasi Perak',
    'Operasi Kedah / Perlis',
    'Operasi Kedah',
    'Operasi Sabah',
    'Operasi Sarawak',
  ],
  [PRIVATE_OPS_COMPANY_ID]: ['Sasa Team Sdn Bhd', 'Sasa Team'],
  [LOGISTICS_COMPANY_ID]: [LOGISTICS_COMPANY_NAME, 'Perfect Global Logistics', 'PGL'],
};

/** The full names of the central employers, for the office's list of Prima companies. */
export const CENTRAL_FULL_NAMES: Readonly<Record<Id, string>> = {
  [GROUP_EMPLOYER_ID]: 'PW Venture Sdn Bhd (PWVSB)',
  [IT_COMPANY_ID]: 'Merdeka Network Sdn Bhd',
  [GOV_OPS_COMPANY_ID]: 'Goodwill Empire Sdn Bhd',
  [PRIVATE_OPS_COMPANY_ID]: 'Sasa Team Sdn Bhd',
  [LOGISTICS_COMPANY_ID]: LOGISTICS_COMPANY_NAME,
};

/** Departments a staff member's unit maps to (the central departments of types.ts User['department']). */
export type RealUnit = 'hr' | 'it' | 'finance' | 'audit' | 'cms' | 'fwm' | 'operations' | 'asset' | 'transport';
export const REAL_UNIT_LABEL: Readonly<Record<RealUnit, string>> = {
  // E5 (Fauzan, 11 Nov 2026): Perfect Global Logistics employs the Transport department.
  transport: 'Transport',
  hr: 'HR',
  it: 'IT',
  finance: 'Finance',
  audit: 'Audit, Compliance and Transformation',
  cms: 'Control Room (CMS)',
  fwm: 'Foreign Worker Management',
  operations: 'Operations',
  asset: 'Asset Management',
};

/** Goodwill Empire's regional operations offices ("OPERASI ..." on the staff list). */
export const REAL_AREAS: Readonly<Record<string, { label: string; states: string[] }>> = {
  'kl-selangor': { label: 'KL / Selangor', states: ['Kuala Lumpur', 'Selangor'] },
  johor: { label: 'Johor', states: ['Johor'] },
  melaka: { label: 'Melaka', states: ['Melaka'] },
  pahang: { label: 'Pahang', states: ['Pahang'] },
  kelantan: { label: 'Kelantan', states: ['Kelantan'] },
  terengganu: { label: 'Terengganu', states: ['Terengganu'] },
  perak: { label: 'Perak', states: ['Perak'] },
  'kedah-perlis': { label: 'Kedah / Perlis', states: ['Kedah', 'Perlis'] },
  sabah: { label: 'Sabah', states: ['Sabah'] },
  sarawak: { label: 'Sarawak', states: ['Sarawak'] },
};

export type RealRoleHint = 'manager' | 'leader' | 'staff';

export interface RealCompany {
  /** 'pwvsb', 'goodwill', 'sasateam', 'merdeka' or 'pgl' for the central employers; 'co-<name>' for a company record. */
  key: Id;
  name: string;
  role: RealCompanyRole;
  registrationNo?: string | null;
  address?: string | null;
  aliases?: string[];
}

export interface RealStaff {
  name: string;
  email?: string | null;
  otherEmails?: string[];
  /** The key of the employer in `companies`. */
  company: Id;
  unit?: RealUnit | null;
  /** A REAL_AREAS key, for Goodwill Empire's regional staff. */
  area?: string | null;
  title?: string | null;
  roleHint: RealRoleHint;
}

export interface RealDataFile {
  format: typeof REAL_DATA_FORMAT;
  version: typeof REAL_DATA_VERSION;
  builtAt?: string | null;
  source?: string | null;
  companies: RealCompany[];
  staff: RealStaff[];
}

/** A file that is not a valid real-data file; the message says where and what. */
export class RealDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RealDataError';
  }
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const EMAIL = /^[^\s@]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/;
const COMPANY_KEY = /^co-[a-z0-9][a-z0-9-]{1,58}$/;

function text(v: unknown, where: string, max: number, optional = false): string | null {
  if ((v === undefined || v === null || v === '') && optional) return null;
  if (typeof v !== 'string') throw new RealDataError(`${where} must be text.`);
  const s = v.trim().replace(/\s+/g, ' ');
  if (!s && optional) return null;
  if (!s || s.length > max || CONTROL.test(s)) throw new RealDataError(`${where} must be 1-${max} plain characters.`);
  return s;
}

function email(v: unknown, where: string): string | null {
  const s = text(v, where, 254, true);
  if (s === null) return null;
  const e = s.toLowerCase();
  if (!EMAIL.test(e)) throw new RealDataError(`${where} is not an email address.`);
  return e;
}

/** The file, checked field by field. Throws a RealDataError naming the first problem; never echoes personal values. */
export function parseRealData(raw: unknown): RealDataFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new RealDataError('The real-data file must be one JSON object.');
  const o = raw as Record<string, unknown>;
  if (o.format !== REAL_DATA_FORMAT) throw new RealDataError(`The file is not a Prima real-data file (format must be "${REAL_DATA_FORMAT}").`);
  if (o.version !== REAL_DATA_VERSION) throw new RealDataError(`This Prima reads real-data version ${REAL_DATA_VERSION}; the file is version ${String(o.version)}.`);
  if (!Array.isArray(o.companies) || o.companies.length < 1 || o.companies.length > 500) throw new RealDataError('companies must list 1 to 500 companies.');
  if (!Array.isArray(o.staff) || o.staff.length > 20_000) throw new RealDataError('staff must be a list of at most 20,000 people.');

  const companies: RealCompany[] = [];
  const keys = new Set<string>();
  o.companies.forEach((c0, i) => {
    const where = `companies[${i}]`;
    if (!c0 || typeof c0 !== 'object' || Array.isArray(c0)) throw new RealDataError(`${where} must be an object.`);
    const c = c0 as Record<string, unknown>;
    const role = c.role as RealCompanyRole;
    if (!REAL_COMPANY_ROLES.includes(role)) throw new RealDataError(`${where}.role must be one of ${REAL_COMPANY_ROLES.join(', ')}.`);
    const key = text(c.key, `${where}.key`, 60)!;
    if (role === 'licensed' || role === 'asset') {
      if (!COMPANY_KEY.test(key)) throw new RealDataError(`${where}.key must look like co-<name> (lower case letters, digits and -).`);
    } else if (key !== STRUCTURAL_COMPANY_IDS[role]) {
      throw new RealDataError(`${where}.key must be "${STRUCTURAL_COMPANY_IDS[role]}" for the ${role} company.`);
    }
    if (keys.has(key)) throw new RealDataError(`${where}.key ${key} is listed twice.`);
    keys.add(key);
    const aliases = c.aliases === undefined || c.aliases === null ? [] : c.aliases;
    if (!Array.isArray(aliases) || aliases.length > 20) throw new RealDataError(`${where}.aliases must be a list of at most 20 names.`);
    companies.push({
      key,
      name: text(c.name, `${where}.name`, 200)!,
      role,
      registrationNo: text(c.registrationNo, `${where}.registrationNo`, 40, true),
      address: text(c.address, `${where}.address`, 400, true),
      aliases: [...new Set(aliases.map((a, k) => text(a, `${where}.aliases[${k}]`, 200)!))],
    });
  });
  if (!companies.some((c) => c.role === 'central')) throw new RealDataError('The central company (PWVSB, key "pwvsb") must be listed.');

  const staff: RealStaff[] = [];
  const emails = new Map<string, number>();
  o.staff.forEach((s0, i) => {
    const where = `staff[${i}]`;
    if (!s0 || typeof s0 !== 'object' || Array.isArray(s0)) throw new RealDataError(`${where} must be an object.`);
    const s = s0 as Record<string, unknown>;
    const company = text(s.company, `${where}.company`, 60)!;
    if (!keys.has(company)) throw new RealDataError(`${where}.company names no company in the file.`);
    const unit = s.unit === undefined || s.unit === null ? null : (s.unit as RealUnit);
    if (unit !== null && !(unit in REAL_UNIT_LABEL)) throw new RealDataError(`${where}.unit must be one of ${Object.keys(REAL_UNIT_LABEL).join(', ')}.`);
    const area = s.area === undefined || s.area === null ? null : String(s.area);
    if (area !== null && !(area in REAL_AREAS)) throw new RealDataError(`${where}.area must be one of ${Object.keys(REAL_AREAS).join(', ')}.`);
    const roleHint = s.roleHint as RealRoleHint;
    if (!['manager', 'leader', 'staff'].includes(roleHint)) throw new RealDataError(`${where}.roleHint must be manager, leader or staff.`);
    const other = s.otherEmails === undefined || s.otherEmails === null ? [] : s.otherEmails;
    if (!Array.isArray(other) || other.length > 5) throw new RealDataError(`${where}.otherEmails must be a list of at most 5 addresses.`);
    const main = email(s.email, `${where}.email`);
    const others = [...new Set(other.map((e, k) => email(e, `${where}.otherEmails[${k}]`)!))].filter((e) => e !== main);
    for (const e of [main, ...others]) {
      if (!e) continue;
      if (emails.has(e)) throw new RealDataError(`${where} has the same email as staff[${emails.get(e)}]: one mailbox, one person.`);
      emails.set(e, i);
    }
    staff.push({
      name: text(s.name, `${where}.name`, 120)!,
      email: main,
      ...(others.length ? { otherEmails: others } : {}),
      company,
      unit,
      area,
      title: text(s.title, `${where}.title`, 120, true),
      roleHint,
    });
  });
  return {
    format: REAL_DATA_FORMAT,
    version: REAL_DATA_VERSION,
    builtAt: text(o.builtAt, 'builtAt', 40, true),
    source: text(o.source, 'source', 200, true),
    companies,
    staff,
  };
}

/** The settings a real-data dataset keeps from the generated one (db-setup's CLEAN_SLATE_KEEP without sample rows). */
export const REAL_DATA_SETTINGS: readonly (keyof Dataset)[] = ['cmsSettings', 'itSettings', 'webSettings', 'tenderProtocols', 'reportDefs', 'claimRates'];

/** The CEO's own sign-in: the office's owner opens Prima as it (P74). */
export const CEO_USER_ID = 'u-fauzan';

/** What an office staff record loaded from the staff list does not say yet, in words, for HR to fill in. */
export function missingStaffFacts(p: Person): string[] {
  const out: string[] = [];
  if (!p.staffNo) out.push('staff number');
  if (p.nationality !== 'MY' && p.nationality !== 'NP') out.push('nationality');
  if (!p.idMasked) out.push('IC or passport number');
  if (!p.dob) out.push('date of birth');
  if (!p.hiredOn) out.push('date joined');
  if (!p.phone) out.push('phone');
  if (!p.branchId) out.push('branch');
  return out;
}

/** What payroll cannot work without: EPF, SOCSO and the part-month all depend on them. */
export function staffPayGaps(p: Person): string[] {
  const out: string[] = [];
  if (p.nationality !== 'MY' && p.nationality !== 'NP') out.push('nationality');
  if (!p.dob) out.push('date of birth');
  if (!p.hiredOn) out.push('date joined');
  return out;
}

const STOP = new Set(['sdn', 'bhd', 'm', 'and']);
/** Short code from a company name: initials, e.g. "Arrow Shield Security Services Sdn Bhd" gives ASSS. */
function companyCode(name: string, taken: Set<string>): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w.toLowerCase()));
  const base = (words.map((w) => (/^\d+$/.test(w) ? w : w[0])).join('') || 'CO').slice(0, 6);
  let code = base;
  for (let n = 2; taken.has(code); n++) code = `${base}${n}`;
  taken.add(code);
  return code;
}

/**
 * The dataset to load into an empty database from a real-data file. `base` is the generated dataset (any of its
 * sample rows are dropped here, whatever the caller passed); only its settings, the CEO's sign-in and the system feeds
 * are kept.
 */
export function realDataset(base: Dataset, file: RealDataFile, opts: { today: IsoDate }): Dataset {
  const out = {} as Record<string, unknown>;
  for (const [k, v] of Object.entries(base)) out[k] = Array.isArray(v) ? [] : v;
  const ds = out as unknown as Dataset;
  // Settings stay; who set them in the sample data does not (those are sample names).
  const author = (r: Record<string, unknown>) => {
    const x = { ...r };
    for (const f of ['setBy', 'updatedBy']) if (typeof x[f] === 'string') x[f] = 'Prima default settings';
    if ('tenderExecId' in x) x.tenderExecId = null;
    return x;
  };
  for (const k of REAL_DATA_SETTINGS) (out as Record<string, unknown[]>)[k] = ((base[k] as unknown[]) ?? []).map((r) => author(r as Record<string, unknown>));

  const ceo = base.users.find((u) => u.id === CEO_USER_ID);
  if (!ceo) throw new RealDataError(`The generated dataset has no ${CEO_USER_ID}: Prima cannot be set up without its CEO record.`);
  const feeds = base.users.filter((u) => !!u.integration);
  ds.users = [{ ...ceo }, ...feeds.map((u) => ({ ...u, companyIds: [], siteIds: [] }))] as User[];

  const codes = new Set<string>();
  ds.companies = file.companies
    .filter((c) => c.role === 'licensed' || c.role === 'asset')
    .map(
      (c): Company => ({
        id: c.key,
        code: companyCode(c.name, codes),
        name: c.name,
        isPilot: false,
        // Not on the staff list: the Head of Company fills these in on the company form.
        headOfCompany: '',
        state: '',
        guardCount: 0,
        siteCount: 0,
        ...(c.registrationNo ? { ssmNo: c.registrationNo } : {}),
        ...(c.address ? { registeredAddress: c.address } : {}),
        sourceRef: file.source ? `Staff list (${file.source})` : 'Staff list',
        verificationStatus: 'draft',
        groupRole: c.role === 'asset' ? 'asset' : 'licensed',
        ...(c.aliases?.length ? { aliases: c.aliases } : {}),
      }),
    );

  // The grants the walls need: the CEO sees every company (P74, the owner is the master administrator); the CMS link
  // and the JA Group feed read every company as before. Dated, like every grant, and renewed by the Director Office.
  const from = addDays(opts.today, -30);
  const to = addDays(opts.today, 335);
  const grant = (id: string, userId: Id, companyId: Id, basis: string): AuthorityGrant => ({ id, userId, companyId, scope: 'monitor', basis, validFrom: from, validTo: to });
  ds.grants = ds.companies.flatMap((c) => [
    grant(`gr-fauzan-${c.id}`, CEO_USER_ID, c.id, 'Management agreement with PWVSB (to be verified)'),
    ...(ds.users.some((u) => u.id === 'u-cms-link') ? [grant(`gr-cms-link-${c.id}`, 'u-cms-link', c.id, 'CMS Command Centre app link (system), Special Ops slice 4E, 2 Nov 2026')] : []),
    ...(ds.users.some((u) => u.id === 'u-ja-sync') ? [grant(`gr-ja-${c.id}`, 'u-ja-sync', c.id, 'JA Group app data feed (system), Fauzan 26 Oct 2026')] : []),
  ]);

  const ids = new Set<string>();
  ds.people = file.staff.map((s): Person => {
    const key = s.email ?? `${s.company}|${s.name.toLowerCase()}`;
    let id = `pr-${sha256Hex(key).slice(0, 12)}`;
    for (let n = 2; ids.has(id); n++) id = `pr-${sha256Hex(`${key}#${n}`).slice(0, 12)}`;
    ids.add(id);
    const area = s.area ? REAL_AREAS[s.area] : null;
    return {
      id,
      companyId: s.company,
      // Central staff all sit at the one head office (access.ts PWVSB_HQ_BRANCH); a company's branch is not on the list.
      branchId: isCentralEmployer(s.company) ? PWVSB_HQ_BRANCH : '',
      // Not on the staff list: "not recorded yet" (missingStaffFacts), for HR to fill in. Never a made-up value.
      staffNo: '',
      name: s.name,
      nationality: '' as Nationality,
      idMasked: '',
      dob: '',
      phone: '',
      role: 'office',
      status: 'active',
      hiredOn: '',
      faceEnrolledOn: null,
      ...(s.title ? { jobTitle: s.title } : {}),
      ...(s.unit ? { department: REAL_UNIT_LABEL[s.unit] } : {}),
      ...(s.email ? { email: s.email } : {}),
      ...(s.otherEmails?.length ? { otherEmails: s.otherEmails } : {}),
      ...(area ? { area: { label: area.label, regionId: regionOfState(area.states[0])?.id ?? '', states: area.states } } : {}),
    };
  });
  return ds;
}

/** Counts only, for logs: a real-data file is personal data. */
export function realDataSummary(file: RealDataFile): string {
  const companies = file.companies.filter((c) => c.role === 'licensed' || c.role === 'asset').length;
  const withEmail = file.staff.filter((s) => s.email).length;
  return `${companies} companies, ${file.staff.length} staff (${withEmail} with an email)`;
}
