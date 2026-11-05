// What Prima sends the CMS app (CMS plan section 3): companies, sites, devices, the people to call and the shifts and
// patrol rounds to watch. Prima stays the master; the CMS app never edits these, it only reads the latest copy.

export type Sector = 'government' | 'private';

/** The people CMS may tell, by role. Matches the "Who CMS tells" table in the plan. */
export type Role =
  | 'guard'
  | 'site_post'
  | 'gate_guard'
  | 'site_supervisor'
  | 'company_manager'
  | 'company_oncall'
  | 'patrolling_officer'
  | 'operations_manager'
  | 'regional_om'
  | 'armoury_keeper'
  | 'a_licence_holder'
  | 'cit_crew_leader'
  | 'building_management'
  | 'it'
  | 'transport_head'
  | 'arms_control'
  | 'ogm'
  | 'operations_director'
  | 'coo'
  | 'ceo';

export interface Contact {
  name: string;
  /** Phone for SMS or voice call-out. Mock numbers only until real people are loaded. */
  phone: string;
}

export interface Site {
  id: string;
  companyId: string;
  name: string;
  sector: Sector;
  /** People for this site by role. A role missing here falls back to the company, then the group. */
  contacts: Partial<Record<Role, Contact>>;
  /** Grace after shift start before a missing clock-in raises a no-show (minutes). */
  clockInGraceMin?: number;
}

export interface Company {
  id: string;
  name: string;
  contacts: Partial<Record<Role, Contact>>;
}

export interface Device {
  id: string;
  siteId: string;
  kind: 'camera' | 'recorder' | 'alarm_panel' | 'gate' | 'anpr' | 'door' | 'vault_sensor' | 'rfid_reader' | 'tracker' | 'gateway';
  /** Alarm panels: the account number they send in SIA DC-09. */
  account?: string;
  /** Minutes without a heartbeat before the device shows as offline. */
  silentAfterMin: number;
}

export interface Shift {
  id: string;
  siteId: string;
  postName: string;
  guardId: string;
  guardName: string;
  start: string;
  end: string;
}

export interface PatrolRound {
  id: string;
  siteId: string;
  checkpointId: string;
  checkpointName: string;
  guardId: string;
  /** When the checkpoint must be scanned, and how late it may be. */
  dueAt: string;
  lateAfterMin: number;
}

export interface Directory {
  /** When Prima made this copy. */
  asOf: string;
  companies: Company[];
  sites: Site[];
  devices: Device[];
  shifts: Shift[];
  patrolRounds: PatrolRound[];
  /** Group people: Arms Control, OGM, Operations Director, COO, CEO, Transport head, IT. */
  group: Partial<Record<Role, Contact>>;
}

export function emptyDirectory(): Directory {
  return { asOf: new Date(0).toISOString(), companies: [], sites: [], devices: [], shifts: [], patrolRounds: [], group: {} };
}

/** Checks a directory from Prima. Returns reasons it is refused; empty means fine. */
export function directoryProblems(d: unknown): string[] {
  if (!d || typeof d !== 'object') return ['not an object'];
  const x = d as Record<string, unknown>;
  const out: string[] = [];
  if (typeof x.asOf !== 'string' || Number.isNaN(Date.parse(x.asOf))) out.push('asOf not a time');
  for (const f of ['companies', 'sites', 'devices', 'shifts', 'patrolRounds'] as const) if (!Array.isArray(x[f])) out.push(`${f} missing`);
  if (out.length) return out;
  const companies = new Set((x.companies as Company[]).map((c) => c.id));
  const sites = new Map((x.sites as Site[]).map((s) => [s.id, s]));
  for (const s of x.sites as Site[]) {
    if (!companies.has(s.companyId)) out.push(`site ${s.id}: company ${s.companyId} not listed`);
    if (s.sector !== 'government' && s.sector !== 'private') out.push(`site ${s.id}: sector must be government or private`);
  }
  for (const dv of x.devices as Device[]) if (!sites.has(dv.siteId)) out.push(`device ${dv.id}: site ${dv.siteId} not listed`);
  for (const sh of x.shifts as Shift[]) {
    if (!sites.has(sh.siteId)) out.push(`shift ${sh.id}: site ${sh.siteId} not listed`);
    if (Number.isNaN(Date.parse(sh.start)) || Number.isNaN(Date.parse(sh.end)) || Date.parse(sh.end) <= Date.parse(sh.start)) out.push(`shift ${sh.id}: times not valid`);
  }
  for (const p of x.patrolRounds as PatrolRound[]) if (!sites.has(p.siteId)) out.push(`patrol ${p.id}: site ${p.siteId} not listed`);
  const accounts = new Map<string, string>();
  for (const dv of (x.devices as Device[]).filter((v) => v.account)) {
    const seen = accounts.get(dv.account!);
    if (seen) out.push(`alarm account ${dv.account} used by ${seen} and ${dv.id}`);
    accounts.set(dv.account!, dv.id);
  }
  return out;
}

export class DirectoryIndex {
  readonly sites: Map<string, Site>;
  readonly companies: Map<string, Company>;
  readonly devices: Map<string, Device>;
  readonly byAccount: Map<string, Device>;

  constructor(readonly d: Directory) {
    this.sites = new Map(d.sites.map((s) => [s.id, s]));
    this.companies = new Map(d.companies.map((c) => [c.id, c]));
    this.devices = new Map(d.devices.map((v) => [v.id, v]));
    this.byAccount = new Map(d.devices.filter((v) => v.account).map((v) => [v.account!, v]));
  }

  /** The person for a role at a site: the site's own, then its company's, then the group's. */
  contact(siteId: string, role: Role): Contact | null {
    const site = this.sites.get(siteId);
    const company = site ? this.companies.get(site.companyId) : undefined;
    return site?.contacts[role] ?? company?.contacts[role] ?? this.d.group[role] ?? null;
  }
}
