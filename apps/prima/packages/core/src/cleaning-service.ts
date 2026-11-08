import { AccessDenied } from "./access";
import { can } from "./access";
import { isActHead } from "./access";
import { isGroupLeader } from "./access";
import { visibleCompanyIds } from "./access";
import { sha256Hex } from "./audit";
import { CLEANING_DEFAULT_RATE } from "./cleaning";
import { CLEANING_TIMING_KEYS } from "./cleaning";
import { CLEANING_TIMING_LABEL } from "./cleaning";
import type { CleaningTimings } from "./cleaning";
import { planCleaningDay } from "./cleaning";
import { planPeople } from "./cleaning";
import { setupProblems } from "./cleaning";
import { stockStatus } from "./cleaning";
import { clientAckStatus } from "./cleaning";
import { workingDay } from "./cleaning";
import { isHhmm } from "./cleaning";
import { toMin } from "./cleaning";
import type { CleaningArea } from "./cleaning";
import type { CleaningClientAck } from "./cleaning";
import type { CleaningDay } from "./cleaning";
import type { CleaningDayHours } from "./cleaning";
import type { CleaningFrequency } from "./cleaning";
import type { CleaningSite } from "./cleaning";
import type { CleaningStockEntry } from "./cleaning";
import type { CleaningTask } from "./cleaning";
import type { CleaningUnit } from "./cleaning";
import type { CleaningWorkKind } from "./cleaning";
import { checkTimeMark } from "./cleaning-proof";
import { TIME_MARK_LABEL } from "./cleaning-proof";
import { RULES } from "./rules";
import { siteKitStatus } from "./site-kit";
import type { SiteKit } from "./site-kit";
import type { SiteKitCategory } from "./site-kit";
import type { SiteKitOwner } from "./site-kit";
import { BadRequest } from "./service";
import { NotFound } from "./service";
import { ReviewConflict } from "./service";
import type { Store } from "./store";
import { addDays } from "./time";
import { dateOf } from "./time";
import { fromMs } from "./time";
import { toMs } from "./time";
import type { AuthorityGrant } from "./types";
import type { EvidenceDoc } from "./types";
import type { Id } from "./types";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";
import type { Site } from "./types";
import type { User } from "./types";


export type CleaningAccess = 'manage' | 'view';

/**
 * What the app that runs the work (the JA app or another, Fauzan 4 Nov 2026) must send back each month for each site,
 * so it can be matched with Prima's published plan line by line. Prima keeps the plan; the other app reports actuals.
 */
export const CLEANING_MONTHLY_RETURN = {
  version: 1,
  perSite: ['siteId (Prima site id)', 'month (YYYY-MM)', 'contractRef'],
  perDay: [
    'date',
    'workersPresent (cleaners + supervisors, by name or staff id)',
    'workersAbsent (by name or staff id, with reason)',
    'per planned task id: status done | checked | redo | missed, done time, checked time',
    'per check: time-marked photo id and the time printed on it',
  ],
  perMonth: [
    'supplies counted on hand at each stock check',
    'deliveries received with counts and photo',
    'equipment working and broken at each check',
    "client acknowledgement slips: date signed, who signed, areas and days covered, accepted or not, the client's comment, and the scanned slip",
  ],
  rules: [
    'Task ids come from the published plan; work not in the plan is reported as an extra line with the area and minutes.',
    'A photo is accepted once only, across all days and sites.',
    'Headcount is compared with the contract (required workers per day); a missing worker is a deduction day.',
  ],
} as const;

/** A time-marked photo from the supervisor, uploaded by the OM. */
export interface CleaningProofInput {
  /** JPEG or PNG as a data URL. */
  image: string;
  /** The time printed on the photo, YYYY-MM-DDTHH:MM, as the OM reads it. */
  stampedAt: string;
  caption?: string;
}

export type CleaningSetupInput = Omit<CleaningSite, 'id' | 'companyId' | 'siteId' | 'map' | 'version' | 'updatedBy' | 'updatedAt'>;

const WORK_KINDS = Object.keys(CLEANING_DEFAULT_RATE) as CleaningWorkKind[];
const UNITS: CleaningUnit[] = ['m2', 'units', 'm'];
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** How far back the screens look for work still waiting for the client's slip, and how late a slip may be recorded. */
export const SLIP_LOOKBACK_DAYS = 62;

const setupId = (siteId: Id) => `clean-${siteId}`;
const dayId = (siteId: Id, date: IsoDate) => `cday-${siteId}-${date}`;

function text(v: unknown, what: string, max: number, required = true): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new BadRequest(`${what} is needed.`);
  if (s.length > max) throw new BadRequest(`${what} is too long (at most ${max} characters).`);
  return s;
}

function num(v: unknown, what: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new BadRequest(`${what} must be a number from ${min} to ${max}.`);
  return v;
}

function int(v: unknown, what: string, min: number, max: number): number {
  const n = num(v, what, min, max);
  if (!Number.isInteger(n)) throw new BadRequest(`${what} must be a whole number.`);
  return n;
}

function hours(v: unknown, what: string): CleaningDayHours | null {
  if (v === null) return null;
  const h = v as Partial<CleaningDayHours>;
  if (!isHhmm(h?.start) || !isHhmm(h?.end)) throw new BadRequest(`${what}: give start and end as HH:MM.`);
  if (toMin(h.end) - toMin(h.start) < 60) throw new BadRequest(`${what}: the day must be at least an hour long.`);
  const breakMin = int(h.breakMin, `${what} break`, 0, 180);
  return { start: h.start, end: h.end, breakMin };
}

function frequency(v: unknown, what: string): CleaningFrequency {
  const f = v as Partial<CleaningFrequency> & Record<string, unknown>;
  switch (f?.kind) {
    case 'per_day':
      return { kind: 'per_day', times: int(f.times, `${what}: times a day`, 1, 8) };
    case 'per_week':
      return { kind: 'per_week', times: int(f.times, `${what}: times a week`, 1, 7) };
    case 'every_weeks': {
      const weeks = int(f.weeks, `${what}: weeks`, 1, 12);
      return { kind: 'every_weeks', weeks, finishWithinDays: int(f.finishWithinDays, `${what}: finish within days`, 1, weeks * 7 + 7) };
    }
    case 'every_months':
      return { kind: 'every_months', months: int(f.months, `${what}: months`, 1, 12) };
    case 'as_needed':
    case 'always':
      return { kind: f.kind };
    default:
      throw new BadRequest(`${what}: choose how often.`);
  }
}

/** Checks a set-up from the screen and returns a clean copy. */
export function checkSetup(input: CleaningSetupInput): CleaningSetupInput {
  if (input.template !== 'kpm_school' && input.template !== 'custom') throw new BadRequest('Choose a template.');
  if (!Array.isArray(input.week) || input.week.length !== 7) throw new BadRequest('Give the hours for each day of the week.');
  const week = input.week.map((h, i) => hours(h, ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i]));
  if (!week.some(Boolean)) throw new BadRequest('At least one working day is needed.');
  const second = input.secondSession == null ? null : input.secondSession;
  if (second && (!isHhmm(second.start) || !isHhmm(second.end) || toMin(second.end) <= toMin(second.start)))
    throw new BadRequest('Second session: give start and end as HH:MM.');
  if (!Array.isArray(input.closedDays) || input.closedDays.length > 400 || input.closedDays.some((d) => typeof d !== 'string' || !DATE.test(d)))
    throw new BadRequest('Closed days must be dates (YYYY-MM-DD).');
  if (typeof input.cycleStart !== 'string' || !DATE.test(input.cycleStart)) throw new BadRequest('Give the first day of the grass and monthly cycles.');
  const facts = input.facts ?? { acres: null, blocks: null, floors: null, toiletCubicles: null };
  const opt = (v: unknown, what: string, max: number) => (v == null ? null : num(v, what, 0, max));
  if (!Array.isArray(input.crew) || input.crew.length > 200) throw new BadRequest('The crew list is not valid.');
  const crewIds = new Set<string>();
  const crew = input.crew.map((c, i) => {
    if (typeof c?.id !== 'string' || !ID.test(c.id) || crewIds.has(c.id)) throw new BadRequest(`Crew line ${i + 1}: the id is not valid.`);
    crewIds.add(c.id);
    if (c.role !== 'cleaner' && c.role !== 'supervisor') throw new BadRequest(`Crew line ${i + 1}: choose cleaner or supervisor.`);
    if (c.session !== 1 && c.session !== 2) throw new BadRequest(`Crew line ${i + 1}: session is 1 or 2.`);
    if (c.session === 2 && !second) throw new BadRequest(`Crew line ${i + 1}: session 2 needs the second session hours.`);
    return { id: c.id, name: text(c.name, `Crew line ${i + 1} name`, 120), role: c.role, session: c.session, personId: typeof c.personId === 'string' && c.personId ? c.personId.slice(0, 60) : null };
  });
  if (!Array.isArray(input.areas) || input.areas.length > 100) throw new BadRequest('At most 100 areas per site.');
  const areaIds = new Set<string>();
  const areas = input.areas.map((a, i): CleaningArea => {
    const what = `Area ${i + 1}`;
    if (typeof a?.id !== 'string' || !ID.test(a.id) || areaIds.has(a.id)) throw new BadRequest(`${what}: the id is not valid.`);
    areaIds.add(a.id);
    if (!WORK_KINDS.includes(a.work)) throw new BadRequest(`${what}: choose the kind of work.`);
    if (!UNITS.includes(a.unit)) throw new BadRequest(`${what}: choose m², units or m.`);
    const pin = a.pin == null ? null : { x: num(a.pin.x, `${what} map x`, 0, 100), y: num(a.pin.y, `${what} map y`, 0, 100) };
    for (const t of [a.notBefore, a.notAfter]) if (t != null && !isHhmm(t)) throw new BadRequest(`${what}: times are HH:MM.`);
    return {
      id: a.id,
      name: text(a.name, `${what} name`, 160),
      work: a.work,
      size: num(a.size, `${what} size`, 0, 10_000_000),
      unit: a.unit,
      frequency: frequency(a.frequency, what),
      ratePerHour: a.ratePerHour == null ? null : num(a.ratePerHour, `${what} rate per hour`, 0.1, 100_000),
      quality: text(a.quality, `${what} quality standard`, 300, false),
      scopeRef: text(a.scopeRef, `${what} contract item`, 120, false),
      pin,
      notBefore: a.notBefore ?? null,
      notAfter: a.notAfter ?? null,
      clientAck: a.clientAck === true,
    };
  });
  if (!Array.isArray(input.equipment) || input.equipment.length > 100) throw new BadRequest('At most 100 equipment lines.');
  if (!Array.isArray(input.supplies) || input.supplies.length > 100) throw new BadRequest('At most 100 supply lines.');
  const eqIds = new Set<string>();
  const equipment = input.equipment.map((e, i) => {
    if (typeof e?.id !== 'string' || !ID.test(e.id) || eqIds.has(e.id)) throw new BadRequest(`Equipment line ${i + 1}: the id is not valid.`);
    eqIds.add(e.id);
    const atEnd = e.atEnd === 'hand_over' ? ('hand_over' as const) : ('take_back' as const);
    const handOverRef = text(e.handOverRef, `Equipment line ${i + 1} contract clause`, 120, false);
    if (atEnd === 'hand_over' && !handOverRef) throw new BadRequest(`Equipment line ${i + 1}: give the contract clause that hands it over.`);
    return { id: e.id, name: text(e.name, `Equipment line ${i + 1} name`, 120), required: int(e.required, `Equipment line ${i + 1} required`, 0, 1000), atEnd, handOverRef };
  });
  const suIds = new Set<string>();
  const supplies = input.supplies.map((s, i) => {
    if (typeof s?.id !== 'string' || !ID.test(s.id) || suIds.has(s.id)) throw new BadRequest(`Supply line ${i + 1}: the id is not valid.`);
    suIds.add(s.id);
    return {
      id: s.id,
      name: text(s.name, `Supply line ${i + 1} name`, 120),
      unit: text(s.unit, `Supply line ${i + 1} unit`, 20),
      perDay: num(s.perDay, `Supply line ${i + 1} use per day`, 0, 100_000),
      approvedBrands: text(s.approvedBrands, `Supply line ${i + 1} brands`, 300, false),
    };
  });
  return {
    template: input.template,
    contractRef: text(input.contractRef, 'Contract reference', 120, false),
    requiredHeadcount: int(input.requiredHeadcount, 'Workers the contract requires', 0, 500),
    facts: {
      acres: opt(facts.acres, 'Acres', 100_000),
      blocks: opt(facts.blocks, 'Blocks', 1000),
      floors: opt(facts.floors, 'Floors', 5000),
      toiletCubicles: opt(facts.toiletCubicles, 'Toilet cubicles', 10_000),
    },
    week,
    secondSession: second ? { start: second.start, end: second.end } : null,
    closedDays: [...new Set(input.closedDays)].sort(),
    cycleStart: input.cycleStart,
    monthlyWage: input.monthlyWage == null ? null : num(input.monthlyWage, 'Monthly wage', 0, 100_000),
    timings: timings(input.timings),
    crew,
    areas,
    equipment,
    supplies,
  };
}

/** The OM's own planner timings for a site (Fauzan, 4 Nov 2026); only the keys the OM changed are kept. */
function timings(t: unknown): Partial<CleaningTimings> | null {
  if (t == null) return null;
  if (typeof t !== 'object' || Array.isArray(t)) throw new BadRequest('Planner timings are not valid.');
  const v = t as Record<string, unknown>;
  const out: Partial<CleaningTimings> = {};
  const bounds: Record<Exclude<(typeof CLEANING_TIMING_KEYS)[number], 'breakFrom'>, [number, number]> = {
    briefingMin: [0, 60],
    moveMin: [0, 60],
    maxPartMin: [15, 480],
    inspectMin: [1, 60],
    roundEveryMin: [30, 600],
    roundMin: [5, 120],
    reportMin: [0, 60],
  };
  for (const k of Object.keys(v)) if (!(CLEANING_TIMING_KEYS as readonly string[]).includes(k)) throw new BadRequest('Planner timings are not valid.');
  for (const k of CLEANING_TIMING_KEYS) {
    if (v[k] == null || v[k] === '') continue;
    if (k === 'breakFrom') {
      if (!isHhmm(v[k])) throw new BadRequest(`${CLEANING_TIMING_LABEL[k]}: give HH:MM.`);
      out.breakFrom = v[k] as string;
    } else {
      const [lo, hi] = bounds[k];
      out[k] = int(v[k], CLEANING_TIMING_LABEL[k], lo, hi);
    }
  }
  return Object.keys(out).length ? out : null;
}

export class CleaningService {
  constructor(
    private store: Store,
    private clock: () => IsoDateTime,
    /** The sites an operations manager covers in a company (PrimaService.opsSiteScope). */
    private siteScope: (user: User, companyId: Id) => Promise<(s: Site) => boolean>,
  ) {}

  private now(): IsoDateTime {
    return fromMs(toMs(this.clock()));
  }
  private today(): IsoDate {
    return dateOf(this.clock());
  }
  private async grants(): Promise<AuthorityGrant[]> {
    return this.store.list('grants');
  }

  /**
   * manage: the OM covering the site, the Regional OM over it, or the OGM for government sites (Gov Ops cleaning).
   * view: the OGM for every cleaning site, the Operations Director, COO, group leadership, ACT head, and the company
   * manager or admin executives of the site's company. null: no access.
   */
  async access(user: User, site: Site): Promise<CleaningAccess | null> {
    const g = await this.grants();
    const today = this.today();
    if (!can(user, g, today, 'view', site.companyId)) return null;
    if (user.role === 'pwvsb_officer' && user.department === 'operations') {
      const tier = user.opsTier ?? '';
      if ((tier === 'om' || tier === 'regional' || tier === 'ogm') && (await this.siteScope(user, site.companyId))(site)) return 'manage';
      if (tier === 'ogm' || tier === 'ops_director' || tier === 'coo') return 'view';
      return null;
    }
    if (isGroupLeader(user) || isActHead(user)) return 'view';
    // Procurement and Inventory monitors supplies and equipment at every site (Fauzan, 4 Nov 2026).
    if (user.role === 'pwvsb_officer' && user.department === 'procurement') return 'view';
    if (user.role === 'company_manager' || user.role === 'admin_exec') return 'view';
    return null;
  }

  private async siteOf(user: User, siteId: Id): Promise<{ site: Site; access: CleaningAccess }> {
    const site = await this.store.get('sites', siteId);
    if (!site) throw new NotFound('Site');
    const access = await this.access(user, site);
    if (!access) throw new AccessDenied('view', site.companyId);
    return { site, access };
  }

  private async manage(user: User, siteId: Id): Promise<Site> {
    const { site, access } = await this.siteOf(user, siteId);
    if (access !== 'manage') throw new AccessDenied('roster.edit', site.companyId);
    return site;
  }

  private async setupFor(siteId: Id): Promise<CleaningSite> {
    const s = await this.store.get('cleaningSites', setupId(siteId));
    if (!s) throw new NotFound('Cleaning set-up');
    return s;
  }

  // ---------- Board ----------

  /** Every cleaning site the user may see, with today's progress, headcount, gaps and stock flags. */
  async board(user: User, date?: IsoDate) {
    const on = date && DATE.test(date) ? date : this.today();
    const ids = visibleCompanyIds(user, await this.grants(), this.today());
    const setups = ids.length ? await this.store.list('cleaningSites', { companyId: ids }) : [];
    const sites = new Map((ids.length ? await this.store.list('sites', { companyId: ids }) : []).map((s) => [s.id, s]));
    const companies = new Map((await this.store.list('companies', { id: ids })).map((c) => [c.id, c.name]));
    const rows = [];
    for (const setup of setups) {
      const site = sites.get(setup.siteId);
      if (!site) continue;
      const access = await this.access(user, site);
      if (!access) continue;
      const day = await this.store.get('cleaningDays', dayId(site.id, on));
      const work = (day?.tasks ?? []).filter((t) => t.type === 'work');
      const entries = await this.store.list('cleaningStock', { companyId: site.companyId, siteId: site.id });
      const stock = stockStatus(setup, entries);
      const slips = await this.slipStatus(setup, entries, addDays(this.today(), -SLIP_LOOKBACK_DAYS), this.today());
      rows.push({
        siteId: site.id,
        siteName: site.name,
        client: site.client,
        companyId: site.companyId,
        companyName: companies.get(site.companyId) ?? site.companyId,
        access,
        working: workingDay(setup, on),
        day: day ? { status: day.status, summary: day.summary, uncovered: day.uncovered.length } : null,
        tasks: { total: work.filter((t) => t.status !== 'not_needed').length, notNeeded: work.filter((t) => t.status === 'not_needed').length, done: work.filter((t) => t.status === 'done' || t.status === 'checked').length, checked: work.filter((t) => t.status === 'checked').length, redo: work.filter((t) => t.status === 'redo').length, missed: work.filter((t) => t.status === 'missed').length },
        stockFlags: stock.supplies.filter((s) => !s.flags.includes('ok') && !s.flags.includes('no_check')).length + stock.equipment.filter((e) => (e.missing ?? 0) > 0).length,
        noStockCheck: stock.supplies.some((s) => s.flags.includes('no_check')),
        problems: setupProblems(setup).length,
        slipsOutstanding: slips.reduce((n, x) => n + x.outstanding.length + x.rejected.length, 0),
      });
    }
    rows.sort((a, b) => a.companyName.localeCompare(b.companyName) || a.siteName.localeCompare(b.siteName));
    // Sites the user could start cleaning on (managers only).
    const startable: { siteId: Id; siteName: string; companyName: string }[] = [];
    const have = new Set(setups.map((s) => s.siteId));
    for (const site of sites.values()) {
      if (have.has(site.id)) continue;
      if ((await this.access(user, site)) === 'manage') startable.push({ siteId: site.id, siteName: site.name, companyName: companies.get(site.companyId) ?? site.companyId });
    }
    startable.sort((a, b) => a.companyName.localeCompare(b.companyName) || a.siteName.localeCompare(b.siteName));
    return { date: on, today: this.today(), rows, startable, canManageAny: rows.some((r) => r.access === 'manage') || startable.length > 0 };
  }

  // ---------- One site ----------

  /** A site's set-up, the day's plan (saved, or a preview when not made yet), stock and proof list. */
  async site(user: User, siteId: Id, date?: IsoDate) {
    const { site, access } = await this.siteOf(user, siteId);
    const on = date && DATE.test(date) ? date : this.today();
    const setup = await this.store.get('cleaningSites', setupId(siteId));
    const saved = setup ? await this.store.get('cleaningDays', dayId(siteId, on)) : undefined;
    const preview = setup && !saved ? planCleaningDay({ site: setup, date: on, people: planPeople(setup), absentIds: [] }) : null;
    const entries = setup ? (await this.store.list('cleaningStock', { companyId: site.companyId, siteId })).sort((a, b) => b.at.localeCompare(a.at)) : [];
    const ids = new Set<Id>([setup?.id ?? '', saved?.id ?? '', ...entries.map((e) => e.id)]);
    const docs = setup ? (await this.store.list('evidenceDocs', { companyId: site.companyId })).filter((d) => d.cleaningId && ids.has(d.cleaningId)) : [];
    const meta = (d: EvidenceDoc) => ({
      id: d.id,
      name: d.name,
      caption: d.caption,
      mime: d.mime,
      uploadedBy: d.uploadedBy,
      receivedAt: d.receivedAt,
      cleaningId: d.cleaningId ?? null,
      timeMark: d.timeMark ?? null,
      timeMarkLabel: d.timeMark ? TIME_MARK_LABEL[d.timeMark.check] : null,
    });
    const map = setup?.map ? docs.find((d) => d.id === setup.map!.docId) : undefined;
    return {
      site: { id: site.id, name: site.name, client: site.client, address: site.address, companyId: site.companyId, sector: site.sector ?? 'private' },
      access,
      date: on,
      today: this.today(),
      setup: setup ?? null,
      mapData: map?.data ?? null,
      problems: setup ? setupProblems(setup) : [],
      day: saved ?? null,
      preview: preview ? { ...preview, date: on } : null,
      stock: setup ? stockStatus(setup, entries) : null,
      entries: entries.filter((e) => e.kind !== 'client_ack').slice(0, 40),
      slips: setup ? entries.filter((e) => e.kind === 'client_ack').slice(0, 40) : [],
      slipStatus: setup ? await this.slipStatus(setup, entries, addDays(this.today(), -SLIP_LOOKBACK_DAYS), this.today()) : [],
      proofs: docs.filter((d) => d.id !== setup?.map?.docId).map(meta),
      rules: { stock: RULES.cleaningStock, rates: RULES.cleaningRates, proof: RULES.cleaningProof },
    };
  }

  /** A proof photo (or the map) for someone who may see the site. */
  async proof(user: User, siteId: Id, docId: Id) {
    const { site } = await this.siteOf(user, siteId);
    const d = await this.store.get('evidenceDocs', docId);
    const setup = await this.store.get('cleaningSites', setupId(siteId));
    if (!d || d.companyId !== site.companyId || !d.cleaningId || !setup) throw new NotFound('Proof');
    const mine =
      d.cleaningId === setup.id ||
      d.cleaningId.startsWith(`cday-${siteId}-`) ||
      (await this.store.get('cleaningStock', d.cleaningId))?.siteId === siteId;
    if (!mine) throw new NotFound('Proof');
    return { id: d.id, name: d.name, mime: d.mime, data: d.data, caption: d.caption, timeMark: d.timeMark ?? null };
  }

  // ---------- Set-up ----------

  /** Save the site's cleaning set-up. A new set-up starts cleaning on the site; later saves need the version seen. */
  async saveSetup(user: User, siteId: Id, input: CleaningSetupInput, expectedVersion: number | null) {
    const site = await this.manage(user, siteId);
    const clean = checkSetup(input);
    const now = this.now();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('sites', siteId);
      const cur = await tx.get('cleaningSites', setupId(siteId));
      if (cur && cur.version !== expectedVersion) throw new ReviewConflict('Someone changed this set-up. Load it again and redo your change.');
      if (!cur && expectedVersion !== null) throw new ReviewConflict('This set-up was removed or never saved. Load it again.');
      const row: CleaningSite = {
        ...clean,
        id: setupId(siteId),
        companyId: site.companyId,
        siteId,
        map: cur?.map ?? null,
        version: (cur?.version ?? 0) + 1,
        updatedBy: user.name,
        updatedAt: now,
      };
      if (cur) await tx.update('cleaningSites', row.id, row);
      else await tx.insert('cleaningSites', row);
      await tx.audit({
        at: now,
        actor: user.name,
        companyId: site.companyId,
        action: cur ? 'cleaning.setup.update' : 'cleaning.setup.create',
        entity: 'cleaning_site',
        entityId: row.id,
        summary: `${cur ? 'Updated' : 'Started'} cleaning at ${site.name}: ${row.areas.length} areas, crew ${row.crew.length}, contract needs ${row.requiredHeadcount} (version ${row.version})`,
      });
      return row;
    });
  }

  /** Upload the site map (PDF, JPEG or PNG). */
  async setMap(user: User, siteId: Id, input: { name: string; data: string }, expectedVersion: number) {
    const site = await this.manage(user, siteId);
    const m = /^data:(application\/pdf|image\/jpeg|image\/png);base64,[A-Za-z0-9+/=]+$/.exec(input.data ?? '');
    if (!m) throw new BadRequest('The map must be a PDF, JPEG or PNG file.');
    const bytes = Math.floor(((input.data.length - input.data.indexOf(',') - 1) * 3) / 4);
    const max = RULES.cleaningProof.value.maxMapBytes;
    if (bytes > max) throw new BadRequest(`The map is too large (over ${Math.round(max / 1000)} KB). Save it smaller.`);
    const now = this.now();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('sites', siteId);
      const cur = await tx.get('cleaningSites', setupId(siteId));
      if (!cur) throw new BadRequest('Save the set-up first, then upload the map.');
      if (cur.version !== expectedVersion) throw new ReviewConflict('Someone changed this set-up. Load it again.');
      const sha256 = sha256Hex(input.data);
      const id = `doc-${sha256.slice(0, 16)}`;
      if (!(await tx.get('evidenceDocs', id)))
        await tx.insert('evidenceDocs', {
          id,
          companyId: site.companyId,
          caseId: null,
          followUpId: null,
          cleaningId: cur.id,
          name: text(input.name, 'Map name', 120, false) || 'Site map',
          mime: m[1] as EvidenceDoc['mime'],
          bytes,
          sha256,
          data: input.data,
          caption: `Site map: ${site.name}`,
          uploadedBy: user.name,
          receivedAt: now,
        });
      const row = await tx.update('cleaningSites', cur.id, {
        map: { docId: id, name: text(input.name, 'Map name', 120, false) || 'Site map', mime: m[1] as 'application/pdf' | 'image/jpeg' | 'image/png' },
        version: cur.version + 1,
        updatedBy: user.name,
        updatedAt: now,
      });
      await tx.audit({ at: now, actor: user.name, companyId: site.companyId, action: 'cleaning.map', entity: 'cleaning_site', entityId: cur.id, summary: `Site map uploaded for ${site.name} (${Math.round(bytes / 1000)} KB, ${sha256.slice(0, 12)})` });
      return row;
    });
  }

  // ---------- The day's plan ----------

  /**
   * Make (or re-make) the day's plan. Before the day is published it is simply rebuilt. A published day of today is
   * re-planned from now: done and checked work stays, the rest is placed again on the people present.
   */
  async makePlan(user: User, siteId: Id, date: IsoDate, absentIds: Id[]) {
    const site = await this.manage(user, siteId);
    if (!DATE.test(date)) throw new BadRequest('Choose a date.');
    const today = this.today();
    if (date < today) throw new BadRequest('A past day cannot be planned again.');
    if (date > addDays(today, 31)) throw new BadRequest('Plan at most 31 days ahead.');
    const now = this.now();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('sites', siteId);
      const setup = await tx.get('cleaningSites', setupId(siteId));
      if (!setup) throw new BadRequest('Set up cleaning on this site first.');
      const crewIds = new Set(setup.crew.map((c) => c.id));
      const absent = [...new Set(absentIds)].filter((id) => crewIds.has(id));
      if (absent.length !== new Set(absentIds).size) throw new BadRequest('Someone marked absent is not on this crew.');
      const cur = await tx.get('cleaningDays', dayId(siteId, date));
      const replan = !!cur && cur.status === 'published' && date === today;
      const keep = cur ? cur.tasks.filter((t) => t.status !== 'planned') : [];
      const fromTime = replan ? now.slice(11, 16) : null;
      const out = planCleaningDay({ site: setup, date, people: planPeople(setup), absentIds: absent, keep, fromTime });
      if (!out.hours) throw new BadRequest(`${date} is not a working day at this site.`);
      // Done, checked and missed work keeps its record; work sent back for redo is placed again as new work.
      const tasks = out.tasks;
      const what = replan ? `Re-planned from ${fromTime} (${absent.length} absent)` : cur ? 'Plan made again' : 'Plan made';
      const row: CleaningDay = {
        id: dayId(siteId, date),
        companyId: site.companyId,
        siteId,
        date,
        planVersion: setup.version,
        status: cur?.status ?? 'draft',
        hours: out.hours,
        absentIds: absent,
        tasks,
        uncovered: out.uncovered,
        watchList: out.watchList,
        summary: out.summary,
        generatedAt: now,
        generatedBy: user.name,
        publishedAt: cur?.publishedAt ?? null,
        publishedBy: cur?.publishedBy ?? null,
        log: [...(cur?.log ?? []), { at: now, by: user.name, what }],
      };
      if (cur) await tx.update('cleaningDays', row.id, row);
      else await tx.insert('cleaningDays', row);
      await tx.audit({
        at: now,
        actor: user.name,
        companyId: site.companyId,
        action: replan ? 'cleaning.day.replan' : 'cleaning.day.plan',
        entity: 'cleaning_day',
        entityId: row.id,
        summary: `${what} for ${site.name} on ${date}: ${out.tasks.filter((t) => t.type === 'work').length} jobs, ${out.uncovered.length} not covered, short ${out.summary.headcountShort} workers`,
      });
      return row;
    });
  }

  /** Publish the day's plan: from now on the OM records each task against it. */
  async publish(user: User, siteId: Id, date: IsoDate) {
    const site = await this.manage(user, siteId);
    const now = this.now();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('sites', siteId);
      const cur = await tx.get('cleaningDays', dayId(siteId, date));
      if (!cur) throw new BadRequest('Make the plan first.');
      if (cur.status === 'published') throw new BadRequest('This day is already published.');
      if (date < this.today()) throw new BadRequest('A past day cannot be published.');
      const setup = await tx.get('cleaningSites', setupId(siteId));
      if (!setup || setup.version !== cur.planVersion) throw new ReviewConflict('The set-up changed after this plan was made. Make the plan again, then publish.');
      const row = await tx.update('cleaningDays', cur.id, { status: 'published', publishedAt: now, publishedBy: user.name, log: [...cur.log, { at: now, by: user.name, what: 'Published' }] });
      await tx.audit({ at: now, actor: user.name, companyId: site.companyId, action: 'cleaning.day.publish', entity: 'cleaning_day', entityId: cur.id, summary: `Published the cleaning plan for ${site.name} on ${date}` });
      return row;
    });
  }

  /** Checks and saves one time-marked proof photo; refuses a photo used before. */
  private async saveProof(tx: Store, user: User, companyId: Id, linkId: Id, day: IsoDate, p: CleaningProofInput, caption: string): Promise<EvidenceDoc> {
    const m = /^data:(image\/jpeg|image\/png);base64,[A-Za-z0-9+/=]+$/.exec(p?.image ?? '');
    if (!m) throw new BadRequest('Proof must be a JPEG or PNG photo with the time mark on it.');
    const bytes = Math.floor(((p.image.length - p.image.indexOf(',') - 1) * 3) / 4);
    const max = RULES.cleaningProof.value.maxPhotoBytes;
    if (bytes > max) throw new BadRequest(`The photo is too large (over ${Math.round(max / 1000)} KB). Send it smaller.`);
    let timeMark;
    try {
      timeMark = checkTimeMark(p.image, p.stampedAt, day, this.now());
    } catch (e) {
      throw new BadRequest((e as Error).message);
    }
    const sha256 = sha256Hex(p.image);
    const id = `doc-${sha256.slice(0, 16)}`;
    const used = await tx.get('evidenceDocs', id);
    if (used) throw new BadRequest(`This photo was already used as proof (${used.caption || used.name}, ${used.receivedAt.slice(0, 10)}). Use a new photo.`);
    const doc: EvidenceDoc = {
      id,
      companyId,
      caseId: null,
      followUpId: null,
      cleaningId: linkId,
      timeMark,
      name: `Time-marked photo ${p.stampedAt.replace('T', ' ')}`,
      mime: m[1] as EvidenceDoc['mime'],
      bytes,
      sha256,
      data: p.image,
      caption: `${caption}${p.caption ? `: ${text(p.caption, 'Caption', 200, false)}` : ''}`.slice(0, 200),
      uploadedBy: user.name,
      receivedAt: this.now(),
    };
    await tx.insert('evidenceDocs', doc);
    return doc;
  }

  /**
   * The OM records what the supervisor reported for one or more tasks of a published day:
   * done (by the cleaner), checked (the supervisor passed it; needs a time-marked photo), redo (failed the check; a
   * time-marked photo and a reason), missed (not done; a reason). One photo can cover several tasks of the same area.
   */
  async recordTasks(
    user: User,
    siteId: Id,
    date: IsoDate,
    input: { taskIds: Id[]; action: 'done' | 'checked' | 'redo' | 'missed' | 'not_needed'; note: string; proof: CleaningProofInput | null; expectedStatuses?: Record<Id, CleaningTask['status']> },
  ) {
    const site = await this.manage(user, siteId);
    const ids = [...new Set(input.taskIds ?? [])];
    if (!ids.length || ids.length > 30) throw new BadRequest('Choose 1 to 30 tasks.');
    if (!['done', 'checked', 'redo', 'missed', 'not_needed'].includes(input.action)) throw new BadRequest('Choose what happened.');
    const note = text(input.note, 'Note', 500, false);
    if ((input.action === 'redo' || input.action === 'missed' || input.action === 'not_needed') && !note) throw new BadRequest('Say why (what the supervisor found).');
    if ((input.action === 'checked' || input.action === 'redo') && !input.proof)
      throw new BadRequest("Attach the supervisor's time-marked photo for the check.");
    // Not needed today (Fauzan, 4 Nov 2026): the photo shows the area did not need the job, so a skip is never just a word.
    if (input.action === 'not_needed' && !input.proof) throw new BadRequest("Attach the supervisor's time-marked photo showing the area does not need the job today.");
    if (input.action === 'not_needed' && date !== this.today()) throw new BadRequest('Only today\'s work can be marked not needed.');
    const now = this.now();
    if (date > this.today()) throw new BadRequest('Work on a future day cannot be recorded yet.');
    return this.store.transaction(async (tx) => {
      await tx.lock?.('cleaningDays', dayId(siteId, date));
      const day = await tx.get('cleaningDays', dayId(siteId, date));
      if (!day) throw new NotFound('Cleaning day');
      if (day.status !== 'published') throw new BadRequest('Publish the plan before recording work.');
      const byId = new Map(day.tasks.map((t) => [t.id, t]));
      const chosen = ids.map((id) => {
        const t = byId.get(id);
        if (!t || t.type !== 'work') throw new BadRequest('Only planned work can be recorded.');
        if (input.expectedStatuses && input.expectedStatuses[id] !== undefined && input.expectedStatuses[id] !== t.status)
          throw new ReviewConflict('Someone already recorded one of these tasks. Load the day again.');
        const ok: Record<typeof input.action, CleaningTask['status'][]> = {
          done: ['planned', 'redo'],
          checked: ['done'],
          redo: ['done'],
          missed: ['planned', 'redo'],
          not_needed: ['planned'],
        };
        if (!ok[input.action].includes(t.status)) throw new BadRequest(`"${t.title}" is ${t.status}; it cannot be marked ${input.action}.`);
        return t;
      });
      if (input.proof && new Set(chosen.map((t) => t.areaId)).size > 1) throw new BadRequest('One photo covers tasks of one area only.');
      const proof = input.proof ? await this.saveProof(tx, user, site.companyId, day.id, date, input.proof, `${site.name} ${date}: ${chosen[0].title}`) : null;
      const mark = proof ? ` [proof ${proof.id}]` : '';
      const tasks = day.tasks.map((t) => {
        if (!ids.includes(t.id)) return t;
        const n = note ? `${note}${mark}` : mark.trim();
        if (input.action === 'done' || input.action === 'missed' || input.action === 'not_needed')
          return { ...t, status: input.action, doneBy: user.name, doneById: user.id, doneAt: now, note: [t.note, n].filter(Boolean).join(' | ').slice(0, 1000) };
        return { ...t, status: input.action, checkedBy: user.name, checkedById: user.id, checkedAt: now, note: [t.note, n].filter(Boolean).join(' | ').slice(0, 1000) };
      });
      // The supervisor's check task follows the work it checks.
      const doneChecks = tasks.map((t) =>
        t.type === 'inspect' && t.checksTaskId && ids.includes(t.checksTaskId) && (input.action === 'checked' || input.action === 'redo')
          ? { ...t, status: 'done' as const, doneBy: user.name, doneById: user.id, doneAt: now }
          : t,
      );
      let patch: Partial<CleaningDay> = { tasks: doneChecks };
      if (input.action === 'not_needed') {
        // The freed time goes to other due work at once: re-plan the rest of today from now, keeping every record.
        const setup = await tx.get('cleaningSites', setupId(siteId));
        if (setup) {
          const out = planCleaningDay({ site: setup, date, people: planPeople(setup), absentIds: day.absentIds, keep: doneChecks.filter((t) => t.status !== 'planned'), fromTime: now.slice(11, 16) });
          if (out.hours) patch = { tasks: out.tasks, uncovered: out.uncovered, watchList: out.watchList, summary: out.summary, generatedAt: now, generatedBy: user.name };
        }
      }
      const what = `${input.action === 'not_needed' ? 'not needed today' : input.action}: ${chosen.length} task${chosen.length === 1 ? '' : 's'}${proof ? ' with a time-marked photo' : ''}${input.action === 'not_needed' ? '; rest of the day re-planned' : ''}`;
      const row = await tx.update('cleaningDays', day.id, { ...patch, log: [...day.log, { at: now, by: user.name, what }] });
      await tx.audit({
        at: now,
        actor: user.name,
        companyId: site.companyId,
        action: `cleaning.task.${input.action}`,
        entity: 'cleaning_day',
        entityId: day.id,
        summary: `${site.name} ${date}: ${input.action} ${chosen.map((t) => t.title).join('; ').slice(0, 300)}${proof ? ` (photo ${proof.timeMark?.stampedAt}, ${proof.timeMark?.check})` : ''}`,
      });
      return row;
    });
  }

  // ---------- Monthly report (Fauzan, 4 Nov 2026) ----------

  /**
   * Plan against actual for one site and month: each working day's jobs planned, done, checked, sent back, missed or
   * not recorded, work the plan could not cover, workers short of the contract with the deduction estimate, and
   * supplies used against budget. The same figures are what the JA app or any other app must send back each month
   * (CLEANING_MONTHLY_RETURN), so the two can be matched line by line.
   */
  async monthly(user: User, siteId: Id, month: string) {
    const { site, access } = await this.siteOf(user, siteId);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? '')) throw new BadRequest('Choose a month (YYYY-MM).');
    const setup = await this.setupFor(siteId);
    const first = `${month}-01`;
    const days: IsoDate[] = [];
    for (let d = first; d.startsWith(month); d = addDays(d, 1)) days.push(d);
    const saved = new Map((await this.store.list('cleaningDays', { companyId: site.companyId, siteId })).filter((d) => d.date.startsWith(month)).map((d) => [d.date, d]));
    const today = this.today();
    const lines = days
      .filter((d) => workingDay(setup, d) || saved.has(d))
      .map((d) => {
        const day = saved.get(d);
        const work = (day?.tasks ?? []).filter((t) => t.type === 'work');
        const count = (st: CleaningTask['status']) => work.filter((t) => t.status === st).length;
        return {
          date: d,
          status: day ? day.status : d > today ? 'not_planned_yet' : 'not_planned',
          planned: work.length,
          done: count('done'),
          checked: count('checked'),
          redo: count('redo'),
          missed: count('missed'),
          notNeeded: count('not_needed'),
          notRecorded: d < today ? count('planned') : 0,
          uncoveredMin: day?.summary.uncoveredMinutes ?? 0,
          required: setup.requiredHeadcount,
          present: day ? day.summary.presentCleaners + day.summary.supervisors : null,
          short: day?.summary.headcountShort ?? null,
          deduction: day?.summary.deductionEstimate ?? null,
        };
      });
    const sum = (k: 'planned' | 'done' | 'checked' | 'redo' | 'missed' | 'notNeeded' | 'notRecorded' | 'uncoveredMin') => lines.reduce((n, l) => n + l[k], 0);
    const entries = (await this.store.list('cleaningStock', { companyId: site.companyId, siteId })).filter((e) => e.date <= `${month}-31`);
    const checks = entries.filter((e) => e.kind === 'check' && e.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date));
    const supplies = setup.supplies.map((sup) => {
      // Use between consecutive checks inside the month, from counts and deliveries received in between.
      let used = 0;
      let budget = 0;
      let measured = false;
      for (let i = 1; i < checks.length; i++) {
        const st = stockStatus(setup, [...entries.filter((e) => e.kind === 'delivery'), checks[i - 1], checks[i]]).supplies.find((x) => x.supply.id === sup.id)!;
        if (st.used !== null && st.budget !== null) {
          used += st.used;
          budget += st.budget;
          measured = true;
        }
      }
      return { supply: sup.name, unit: sup.unit, used: measured ? Math.round(used * 100) / 100 : null, budget: measured ? Math.round(budget * 100) / 100 : null, usePct: measured && budget ? Math.round((used / budget) * 100) : null };
    });
    const deliveries = entries.filter((e) => e.kind === 'delivery' && e.date.startsWith(month));
    const planned = sum('planned');
    const slipStatus = await this.slipStatus(setup, entries, first, days.at(-1)!);
    const slips = entries
      .filter((e) => e.kind === 'client_ack' && e.ack && e.ack.from <= days.at(-1)! && e.ack.to >= first)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => ({ id: e.id, signedOn: e.date, signer: e.ack!.signer, outcome: e.ack!.outcome, comment: e.ack!.comment, action: e.ack!.action, from: e.ack!.from, to: e.ack!.to, areas: e.ack!.areaIds.map((id) => setup.areas.find((a) => a.id === id)?.name ?? id), proofIds: e.proofIds, by: e.by }));
    return {
      site: { id: site.id, name: site.name, client: site.client },
      access,
      month,
      contractRef: setup.contractRef,
      lines,
      totals: {
        workingDays: lines.length,
        daysPublished: lines.filter((l) => l.status === 'published').length,
        planned,
        done: sum('done'),
        checked: sum('checked'),
        redo: sum('redo'),
        missed: sum('missed'),
        notNeeded: sum('notNeeded'),
        notRecorded: sum('notRecorded'),
        uncoveredMin: sum('uncoveredMin'),
        workerDaysShort: lines.reduce((n, l) => n + (l.short ?? 0), 0),
        deductionEstimate: Math.round(lines.reduce((n, l) => n + (l.deduction ?? 0), 0) * 100) / 100,
        checkedPct: planned ? Math.round((sum('checked') / planned) * 100) : null,
        stockChecks: checks.length,
        deliveries: deliveries.length,
        slipsReceived: slips.length,
        slipsNotAccepted: slips.filter((x) => x.outcome === 'not_accepted').length,
        slipDaysOutstanding: slipStatus.reduce((n, x) => n + x.outstanding.length, 0),
        shortDeliveries: deliveries.filter((d) => d.received && (d.supplies.some((x) => (x.counted ?? 0) < (x.sent ?? 0)) || d.equipment.some((x) => (x.working ?? 0) < (x.sent ?? 0)))).length,
      },
      supplies,
      slips,
      slipStatus,
      returnSpec: CLEANING_MONTHLY_RETURN,
    };
  }

  // ---------- Client acknowledgement slips (Fauzan, 4 Nov 2026) ----------

  /** Areas needing a slip with the days done between two dates, and which days a slip covers. */
  private async slipStatus(setup: CleaningSite, entries: CleaningStockEntry[], from: IsoDate, to: IsoDate) {
    if (!setup.areas.some((a) => a.clientAck)) return [];
    const days = (await this.store.list('cleaningDays', { companyId: setup.companyId, siteId: setup.siteId })).filter((d) => d.date >= from && d.date <= to);
    return clientAckStatus(setup, days, entries.filter((e) => e.kind === 'client_ack'));
  }

  /**
   * The OM uploads the client's signed slip for work done (e.g. the school's slip for grass cutting) with who signed, the
   * areas and days it covers, whether the client accepted the work and the comment written on it. The scan or photo of
   * the slip is kept behind the company wall; the same file cannot be used twice. A slip that does not accept the work
   * leaves those days open until the work is redone and a new slip is signed.
   */
  async recordClientAck(
    user: User,
    siteId: Id,
    input: { signedOn: IsoDate; from: IsoDate; to: IsoDate; areaIds: Id[]; signer: string; outcome: CleaningClientAck['outcome']; comment: string; action: string; slip: { name: string; data: string } },
  ) {
    const site = await this.manage(user, siteId);
    const setup = await this.setupFor(siteId);
    const today = this.today();
    for (const d of [input.signedOn, input.from, input.to]) if (!DATE.test(d ?? '')) throw new BadRequest('Give the date signed and the first and last day of the work.');
    if (input.signedOn > today) throw new BadRequest('The slip cannot be signed in the future.');
    if (input.from > input.to) throw new BadRequest('The first day of the work is after the last day.');
    if (input.to > input.signedOn) throw new BadRequest('The slip cannot cover work after the day it was signed.');
    if (input.from < addDays(today, -SLIP_LOOKBACK_DAYS)) throw new BadRequest(`A slip is recorded within ${SLIP_LOOKBACK_DAYS} days of the work.`);
    if (addDays(input.from, 31) < input.to) throw new BadRequest('One slip covers at most 31 days of work.');
    const areaIds = [...new Set(input.areaIds ?? [])];
    if (!areaIds.length || areaIds.length > 30) throw new BadRequest('Choose the work the slip is for.');
    for (const id of areaIds) if (!setup.areas.some((a) => a.id === id)) throw new BadRequest('One of the chosen areas is not on this site.');
    if (input.outcome !== 'accepted' && input.outcome !== 'not_accepted') throw new BadRequest('Say whether the client accepted the work.');
    const signer = text(input.signer, 'Who signed for the client', 120);
    const comment = text(input.comment, "The client's comment", 1000, false);
    if (input.outcome === 'not_accepted' && !comment) throw new BadRequest("Copy the client's comment: why the work was not accepted.");
    const action = text(input.action, 'What you will do', 500, false);
    if (input.outcome === 'not_accepted' && !action) throw new BadRequest('Say what will be done about it (e.g. redo by a date).');
    const m = /^data:(application\/pdf|image\/jpeg|image\/png);base64,[A-Za-z0-9+/=]+$/.exec(input.slip?.data ?? '');
    if (!m) throw new BadRequest('Attach the signed slip as a photo or scan (JPEG, PNG or PDF).');
    const bytes = Math.floor(((input.slip.data.length - input.slip.data.indexOf(',') - 1) * 3) / 4);
    const max = RULES.cleaningProof.value.maxMapBytes;
    if (bytes > max) throw new BadRequest(`The slip file is too large (over ${Math.round(max / 1000)} KB). Save it smaller.`);
    const now = this.now();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('sites', siteId);
      const sha256 = sha256Hex(input.slip.data);
      const docId = `doc-${sha256.slice(0, 16)}`;
      const used = await tx.get('evidenceDocs', docId);
      if (used) throw new BadRequest(`This file was already used (${used.caption || used.name}, ${used.receivedAt.slice(0, 10)}). Attach the slip itself.`);
      const id = `cack-${siteId}-${sha256.slice(0, 12)}`;
      const names = areaIds.map((a) => setup.areas.find((x) => x.id === a)!.name);
      await tx.insert('evidenceDocs', {
        id: docId,
        companyId: site.companyId,
        caseId: null,
        followUpId: null,
        cleaningId: id,
        name: text(input.slip.name, 'File name', 120, false) || 'Client slip',
        mime: m[1] as EvidenceDoc['mime'],
        bytes,
        sha256,
        data: input.slip.data,
        caption: `Client slip ${input.signedOn} (${input.outcome === 'accepted' ? 'accepted' : 'not accepted'}): ${names.join(', ')}`.slice(0, 200),
        uploadedBy: user.name,
        receivedAt: now,
      });
      const row: CleaningStockEntry = {
        id,
        companyId: site.companyId,
        siteId,
        kind: 'client_ack',
        date: input.signedOn,
        supplies: [],
        equipment: [],
        note: '',
        by: user.name,
        byId: user.id,
        at: now,
        received: null,
        proofIds: [docId],
        ack: { areaIds, from: input.from, to: input.to, signer, outcome: input.outcome, comment, action },
      };
      await tx.insert('cleaningStock', row);
      await tx.audit({
        at: now,
        actor: user.name,
        companyId: site.companyId,
        action: 'cleaning.client_ack',
        entity: 'cleaning_stock',
        entityId: id,
        summary: `${site.name}: client slip signed ${input.signedOn} by ${signer}, ${input.outcome === 'accepted' ? 'accepted' : 'NOT accepted'}, ${names.join(', ')} ${input.from} to ${input.to}${comment ? `; comment: ${comment.slice(0, 120)}` : ''}`,
      });
      return row;
    });
  }

  // ---------- Site fittings (Fauzan, 4 Nov 2026) ----------

  /** A site's fittings plan and status. Every site can have one, cleaning or security. */
  async siteKit(user: User, siteId: Id) {
    const { site, access } = await this.siteOf(user, siteId);
    const kit = (await this.store.get('siteKits', `kit-${siteId}`)) ?? null;
    const ids = new Set(kit?.records.flatMap((r) => r.proofIds) ?? []);
    const proofs = kit ? (await this.store.list('evidenceDocs', { companyId: site.companyId })).filter((d) => ids.has(d.id)).map((d) => ({ id: d.id, caption: d.caption, timeMark: d.timeMark ?? null, receivedAt: d.receivedAt })) : [];
    return { site: { id: site.id, name: site.name, client: site.client, companyId: site.companyId }, access, kit, status: kit ? siteKitStatus(kit, this.today()) : null, proofs };
  }

  /** The OM plans what the site needs. Saving a new list needs the version seen. */
  async saveSiteKit(user: User, siteId: Id, items: unknown, expectedVersion: number | null) {
    const site = await this.manage(user, siteId);
    if (!Array.isArray(items) || items.length > 100) throw new BadRequest('At most 100 fittings per site.');
    const cats: SiteKitCategory[] = ['furniture', 'shelter', 'fan_light', 'cctv', 'equipment', 'other'];
    const owners: SiteKitOwner[] = ['company', 'client', 'rented'];
    const seen = new Set<string>();
    const clean = items.map((x: Record<string, unknown>, i: number) => {
      if (typeof x?.id !== 'string' || !ID.test(x.id) || seen.has(x.id)) throw new BadRequest(`Line ${i + 1}: the id is not valid.`);
      seen.add(x.id);
      if (!cats.includes(x.category as SiteKitCategory)) throw new BadRequest(`Line ${i + 1}: choose a kind.`);
      if (!owners.includes(x.owner as SiteKitOwner)) throw new BadRequest(`Line ${i + 1}: choose who owns it.`);
      const atEnd = x.atEnd === 'hand_over' ? ('hand_over' as const) : ('take_back' as const);
      const handOverRef = text(x.handOverRef, `Line ${i + 1} contract clause`, 120, false);
      if (atEnd === 'hand_over' && !handOverRef) throw new BadRequest(`Line ${i + 1}: give the contract clause that hands it over.`);
      return { id: x.id, name: text(x.name, `Line ${i + 1} name`, 120), category: x.category as SiteKitCategory, required: int(x.required, `Line ${i + 1} needed`, 0, 1000), owner: x.owner as SiteKitOwner, note: text(x.note, `Line ${i + 1} note`, 300, false), atEnd, handOverRef };
    });
    const now = this.now();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('sites', siteId);
      const cur = await tx.get('siteKits', `kit-${siteId}`);
      if ((cur?.version ?? null) !== expectedVersion) throw new ReviewConflict('Someone changed this list. Load it again.');
      const row: SiteKit = { id: `kit-${siteId}`, companyId: site.companyId, siteId, items: clean, records: cur?.records ?? [], gifts: cur?.gifts ?? [], version: (cur?.version ?? 0) + 1, updatedBy: user.name, updatedAt: now };
      if (cur) await tx.update('siteKits', row.id, row);
      else await tx.insert('siteKits', row);
      await tx.audit({ at: now, actor: user.name, companyId: site.companyId, action: 'site_kit.plan', entity: 'site_kit', entityId: row.id, summary: `Fittings plan for ${site.name}: ${clean.map((c) => `${c.required} ${c.name}`).join(', ').slice(0, 300)}` });
      return row;
    });
  }

  /** The OM records an install or the monthly check, with the supervisor's time-marked photo. */
  async recordSiteKit(user: User, siteId: Id, input: { kind: 'install' | 'check'; date: IsoDate; lines: unknown; note: string; proof: CleaningProofInput }, expectedVersion: number) {
    const site = await this.manage(user, siteId);
    if (input.kind !== 'install' && input.kind !== 'check') throw new BadRequest('Choose install or check.');
    const today = this.today();
    if (!DATE.test(input.date ?? '') || input.date > today || input.date < addDays(today, -2)) throw new BadRequest('Record today or the last 2 days.');
    if (!input.proof) throw new BadRequest("Attach the supervisor's time-marked photo.");
    const now = this.now();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('sites', siteId);
      const cur = await tx.get('siteKits', `kit-${siteId}`);
      if (!cur) throw new BadRequest('Plan the fittings first.');
      if (cur.version !== expectedVersion) throw new ReviewConflict('Someone changed this list. Load it again.');
      const ids = new Set(cur.items.map((i) => i.id));
      const seen = new Set<string>();
      const lines = (Array.isArray(input.lines) ? input.lines : []).map((l: Record<string, unknown>) => {
        if (typeof l?.itemId !== 'string' || !ids.has(l.itemId) || seen.has(l.itemId)) throw new BadRequest('A line is not on this site.');
        seen.add(l.itemId);
        const inPlace = int(l.inPlace, 'In place', 0, 1000);
        const broken = int(l.broken ?? 0, 'Broken', 0, 1000);
        if (broken > inPlace) throw new BadRequest('Broken cannot be more than in place.');
        return { itemId: l.itemId, inPlace, working: inPlace - broken, broken };
      });
      if (!lines.length) throw new BadRequest('Give at least one line.');
      if (input.kind === 'check' && lines.length !== cur.items.length) throw new BadRequest('A check counts every item on the list (0 if none).');
      const recId = `kitrec-${siteId}-${input.date}-${cur.records.length + 1}`;
      const proof = await this.saveProof(tx, user, site.companyId, recId, input.date, input.proof, `${site.name} ${input.date}: fittings ${input.kind}`);
      const rec = { id: recId, kind: input.kind, date: input.date, lines, note: text(input.note, 'Note', 500, false), by: user.name, byId: user.id, at: now, proofIds: [proof.id] };
      const row = await tx.update('siteKits', cur.id, { records: [...cur.records, rec].slice(-120), version: cur.version + 1, updatedBy: user.name, updatedAt: now });
      await tx.audit({ at: now, actor: user.name, companyId: site.companyId, action: `site_kit.${input.kind}`, entity: 'site_kit', entityId: cur.id, summary: `Fittings ${input.kind} at ${site.name}: ${lines.map((l) => `${l.itemId} ${l.working}/${l.inPlace}`).join(', ').slice(0, 300)} (photo ${proof.timeMark?.stampedAt}, ${proof.timeMark?.check})` });
      return row;
    });
  }

  // ---------- Contract end: take everything back (Fauzan, 4 Nov 2026) ----------

  /**
   * Management (COO or CEO) approves giving an item to the client at contract end, with a reason. Items the contract
   * hands over need no approval. ref: kit:<itemId> for fittings or clean:<equipmentId> for cleaning equipment.
   */
  async approveGift(user: User, siteId: Id, input: { ref: string; qty: number; reason: string }) {
    const { site } = await this.siteOf(user, siteId);
    const mgmt = user.role === 'director' || (user.role === 'pwvsb_officer' && (user.opsTier === 'coo' || user.opsTier === 'ceo'));
    if (!mgmt) throw new AccessDenied('roster.publish', site.companyId);
    const reason = text(input.reason, 'Reason', 500);
    const qty = int(input.qty, 'Quantity', 1, 1000);
    const now = this.now();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('sites', siteId);
      const kit = await tx.get('siteKits', `kit-${siteId}`);
      const setup = await tx.get('cleaningSites', setupId(siteId));
      const name = this.refName(input.ref, kit, setup);
      if (!name) throw new BadRequest('That item is not on this site.');
      const base: SiteKit = kit ?? { id: `kit-${siteId}`, companyId: site.companyId, siteId, items: [], records: [], gifts: [], version: 0, updatedBy: user.name, updatedAt: now };
      const gifts = [...(base.gifts ?? []).filter((g) => g.ref !== input.ref), { ref: input.ref, qty, reason, by: user.name, byId: user.id, at: now }];
      const row = { ...base, gifts, version: base.version + 1, updatedBy: user.name, updatedAt: now };
      if (kit) await tx.update('siteKits', row.id, row);
      else await tx.insert('siteKits', row);
      await tx.audit({ at: now, actor: user.name, companyId: site.companyId, action: 'site_kit.gift', entity: 'site_kit', entityId: row.id, summary: `Approved giving ${qty} ${name} to the client of ${site.name} at contract end: ${reason}` });
      return row;
    });
  }

  private refName(ref: string, kit: SiteKit | undefined, setup: CleaningSite | undefined): string | null {
    if (typeof ref !== 'string') return null;
    if (ref.startsWith('kit:')) return kit?.items.find((i) => i.id === ref.slice(4))?.name ?? null;
    if (ref.startsWith('clean:')) return setup?.equipment.find((e) => e.id === ref.slice(6))?.name ?? null;
    return null;
  }

  /** What must come back from the site at contract end: every fitting and cleaning equipment we own or rent, less hand-overs. */
  async closeOutList(user: User, siteId: Id) {
    const { site, access } = await this.siteOf(user, siteId);
    const kit = await this.store.get('siteKits', `kit-${siteId}`);
    const setup = await this.store.get('cleaningSites', setupId(siteId));
    const st = kit ? siteKitStatus(kit, this.today()) : null;
    const eq = setup ? stockStatus(setup, await this.store.list('cleaningStock', { companyId: site.companyId, siteId })).equipment : [];
    const gift = (ref: string) => kit?.gifts?.find((g) => g.ref === ref) ?? null;
    const lines = [
      ...(kit?.items ?? [])
        .filter((i) => i.owner !== 'client')
        .map((i) => {
          const inPlace = st?.items.find((x) => x.item.id === i.id)?.inPlace ?? i.required;
          return { ref: `kit:${i.id}`, name: i.name, owner: i.owner, inPlace, atEnd: i.atEnd ?? 'take_back', handOverRef: i.handOverRef ?? '', gift: gift(`kit:${i.id}`) };
        }),
      ...(setup?.equipment ?? []).map((e) => {
        const x = eq.find((y) => y.equipment.id === e.id);
        return { ref: `clean:${e.id}`, name: e.name, owner: 'company' as const, inPlace: x?.working != null ? x.working + (x.broken ?? 0) : e.required, atEnd: e.atEnd ?? 'take_back', handOverRef: e.handOverRef ?? '', gift: gift(`clean:${e.id}`) };
      }),
    ];
    const done = kit?.records.filter((r) => r.kind === 'take_back') ?? [];
    const back = (ref: string) => done.reduce((n, r) => n + (r.lines.find((l) => l.itemId === ref)?.takenBack ?? 0), 0);
    const given = (ref: string) => done.reduce((n, r) => n + (r.lines.find((l) => l.itemId === ref)?.handedOver ?? 0), 0);
    const out = lines.map((l) => {
      const mayGive = l.atEnd === 'hand_over' ? l.inPlace : (l.gift?.qty ?? 0);
      const notRecovered = done.length ? Math.max(0, l.inPlace - back(l.ref) - given(l.ref)) : null;
      return { ...l, mayGive, takenBack: back(l.ref), handedOver: given(l.ref), notRecovered };
    });
    return { site: { id: site.id, name: site.name, client: site.client }, access, lines: out, closed: done.length > 0, notRecovered: out.reduce((n, l) => n + (l.notRecovered ?? 0), 0) };
  }

  /** The OM records what came back from the site at contract end and what was handed over, with a time-marked photo. */
  async recordTakeBack(user: User, siteId: Id, input: { date: IsoDate; lines: unknown; note: string; proof: CleaningProofInput }) {
    const site = await this.manage(user, siteId);
    const today = this.today();
    if (!DATE.test(input.date ?? '') || input.date > today || input.date < addDays(today, -2)) throw new BadRequest('Record today or the last 2 days.');
    if (!input.proof) throw new BadRequest("Attach the supervisor's time-marked photo of the items collected.");
    const list = await this.closeOutList(user, siteId);
    const byRef = new Map(list.lines.map((l) => [l.ref, l]));
    const seen = new Set<string>();
    const lines = (Array.isArray(input.lines) ? input.lines : []).map((x: Record<string, unknown>) => {
      const l = typeof x?.ref === 'string' ? byRef.get(x.ref) : undefined;
      if (!l || seen.has(l.ref)) throw new BadRequest('A line is not on this site.');
      seen.add(l.ref);
      const takenBack = int(x.takenBack, 'Taken back', 0, 1000);
      const handedOver = int(x.handedOver ?? 0, 'Handed over', 0, 1000);
      if (handedOver > l.mayGive - l.handedOver)
        throw new BadRequest(`${l.name}: only ${Math.max(0, l.mayGive - l.handedOver)} may be handed over (the contract clause or management's approval).`);
      return { itemId: l.ref, inPlace: l.inPlace, working: 0, broken: 0, takenBack, handedOver };
    });
    if (!lines.length) throw new BadRequest('Give at least one line.');
    const now = this.now();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('sites', siteId);
      const kit = await tx.get('siteKits', `kit-${siteId}`);
      const base: SiteKit = kit ?? { id: `kit-${siteId}`, companyId: site.companyId, siteId, items: [], records: [], gifts: [], version: 0, updatedBy: user.name, updatedAt: now };
      const recId = `kitrec-${siteId}-${input.date}-${base.records.length + 1}`;
      const proof = await this.saveProof(tx, user, site.companyId, recId, input.date, input.proof, `${site.name} ${input.date}: items taken back at contract end`);
      const rec = { id: recId, kind: 'take_back' as const, date: input.date, lines, note: text(input.note, 'Note', 500, false), by: user.name, byId: user.id, at: now, proofIds: [proof.id] };
      const row = { ...base, records: [...base.records, rec].slice(-120), version: base.version + 1, updatedBy: user.name, updatedAt: now };
      if (kit) await tx.update('siteKits', row.id, row);
      else await tx.insert('siteKits', row);
      const missing = lines.reduce((n, l) => n + Math.max(0, l.inPlace - (l.takenBack ?? 0) - (l.handedOver ?? 0)), 0);
      await tx.audit({ at: now, actor: user.name, companyId: site.companyId, action: 'site_kit.take_back', entity: 'site_kit', entityId: row.id, summary: `Contract end at ${site.name}: ${lines.reduce((n, l) => n + (l.takenBack ?? 0), 0)} items back, ${lines.reduce((n, l) => n + (l.handedOver ?? 0), 0)} handed over, ${missing} not recovered (photo ${proof.timeMark?.stampedAt})` });
      return row;
    });
  }

  // ---------- Inventory across every site (Fauzan, 4 Nov 2026) ----------

  /**
   * Procurement and Inventory monitors supplies and equipment at every site, guard uniforms included (Fauzan, 4 Nov
   * 2026). Read-only. Per site: the cleaning store (budget flags, equipment short of the contract, deliveries waiting
   * to be received, last check) and what the guards working there were issued from the company store (no uniform on
   * record, not yet confirmed by the guard, disputed, lost or damaged waiting for the company manager).
   * Who: Procurement and Inventory, the OGM (it runs the department), Operations Director, COO, group leadership and
   * the ACT head for every site they see; OMs for the sites they cover.
   */
  async inventoryBoard(user: User) {
    const all =
      (user.role === 'pwvsb_officer' && (user.department === 'procurement' || ['ogm', 'ops_director', 'coo'].includes(user.opsTier ?? ''))) ||
      isGroupLeader(user) ||
      isActHead(user);
    const om = user.role === 'pwvsb_officer' && user.department === 'operations' && (user.opsTier === 'om' || user.opsTier === 'regional');
    if (!all && !om) throw new AccessDenied('view', '(site inventory)');
    const today = this.today();
    const ids = visibleCompanyIds(user, await this.grants(), today);
    if (!ids.length) return { rows: [], totals: { sites: 0, cleaningFlags: 0, noUniform: 0, unconfirmed: 0, disputed: 0, lostWaiting: 0, fittingsShort: 0, fittingsCheckDue: 0, notRecovered: 0 }, rule: RULES.cleaningStock };
    const companies = new Map((await this.store.list('companies', { id: ids })).map((c) => [c.id, c.name]));
    const sites = await this.store.list('sites', { companyId: ids });
    const setups = new Map((await this.store.list('cleaningSites', { companyId: ids })).map((x) => [x.siteId, x]));
    const stock = await this.store.list('cleaningStock', { companyId: ids });
    const items = new Map((await this.store.list('stockItems', { companyId: ids })).map((i) => [i.id, i]));
    const issues = await this.store.list('stockIssues', { companyId: ids });
    const from = addDays(today, -14);
    const shifts = (await this.store.list('shifts', { companyId: ids })).filter((x) => x.personId && x.date >= from && x.date <= today);
    const people = new Map((await this.store.list('people', { companyId: ids })).map((p) => [p.id, p]));
    const kits = new Map((await this.store.list('siteKits', { companyId: ids })).map((k) => [k.siteId, k]));
    const scopes = new Map<Id, (s: Site) => boolean>();
    const rows = [];
    for (const site of sites) {
      if (!all) {
        if (!scopes.has(site.companyId)) scopes.set(site.companyId, await this.siteScope(user, site.companyId));
        if (!scopes.get(site.companyId)!(site)) continue;
      }
      const setup = setups.get(site.id);
      const cs = setup ? stockStatus(setup, stock.filter((e) => e.siteId === site.id)) : null;
      const guardIds = [...new Set(shifts.filter((x) => x.siteId === site.id).map((x) => x.personId!))].filter((id) => people.get(id)?.status === 'active');
      const held = issues.filter((i) => guardIds.includes(i.personId) && !i.returned);
      const uniformFor = new Set(held.filter((i) => items.get(i.itemId)?.kind === 'UNIFORM').map((i) => i.personId));
      const security = guardIds.length
        ? {
            guards: guardIds.length,
            noUniform: guardIds.filter((id) => !uniformFor.has(id)).map((id) => ({ id, name: people.get(id)!.name, staffNo: people.get(id)!.staffNo })),
            unconfirmed: held.filter((i) => !i.acknowledged && !i.disputed).length,
            disputed: held.filter((i) => !!i.disputed).length,
            lostWaiting: issues.filter((i) => guardIds.includes(i.personId) && i.returned && (i.returned.condition === 'lost' || i.returned.condition === 'damaged') && !i.returned.confirmed).length,
            held: [...held.reduce((m, i) => {
              const it = items.get(i.itemId);
              const k = it ? `${it.kind}|${it.name}` : `?|${i.itemId}`;
              m.set(k, (m.get(k) ?? 0) + i.qty);
              return m;
            }, new Map<string, number>())].map(([k, qty]) => ({ kind: k.split('|')[0], name: k.split('|')[1], qty })).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)),
          }
        : null;
      const kit = kits.get(site.id);
      const ks = kit ? siteKitStatus(kit, today) : null;
      const fittings = ks
        ? {
            items: ks.items.filter((i) => (i.short ?? 0) > 0 || (i.broken ?? 0) > 0 || i.lastOn === null).map((i) => ({ name: i.item.name, owner: i.item.owner, required: i.item.required, working: i.working, broken: i.broken })),
            checkDue: ks.checkDue && !kit!.records.some((r) => r.kind === 'take_back'),
            lastRecord: ks.lastRecord,
            notRecovered: kit!.records
              .filter((r) => r.kind === 'take_back')
              .flatMap((r) => r.lines)
              .reduce((n, l) => n + Math.max(0, l.inPlace - (l.takenBack ?? 0) - (l.handedOver ?? 0)), 0),
          }
        : null;
      if (!cs && !security && !fittings) continue;
      rows.push({
        siteId: site.id,
        siteName: site.name,
        companyId: site.companyId,
        companyName: companies.get(site.companyId) ?? site.companyId,
        cleaning: cs
          ? {
              flagged: cs.supplies.filter((x) => !x.flags.includes('ok')).map((x) => ({ name: x.supply.name, unit: x.supply.unit, onHand: x.onHand, usePct: x.usePct, daysLeft: x.daysLeft, shortDelivered: x.shortDelivered, flags: x.flags })),
              equipmentShort: cs.equipment.filter((e) => (e.missing ?? 0) > 0 || (e.broken ?? 0) > 0).map((e) => ({ name: e.equipment.name, required: e.equipment.required, working: e.working, broken: e.broken })),
              pendingDeliveries: cs.pendingDeliveries.length,
              lastCheck: cs.supplies[0]?.lastCheck ?? cs.equipment[0]?.lastCheck ?? null,
            }
          : null,
        security,
        fittings,
      });
    }
    rows.sort((a, b) => a.companyName.localeCompare(b.companyName) || a.siteName.localeCompare(b.siteName));
    return {
      rows,
      totals: {
        sites: rows.length,
        cleaningFlags: rows.reduce((n, r) => n + (r.cleaning ? r.cleaning.flagged.length + r.cleaning.equipmentShort.length : 0), 0),
        noUniform: rows.reduce((n, r) => n + (r.security?.noUniform.length ?? 0), 0),
        unconfirmed: rows.reduce((n, r) => n + (r.security?.unconfirmed ?? 0), 0),
        disputed: rows.reduce((n, r) => n + (r.security?.disputed ?? 0), 0),
        lostWaiting: rows.reduce((n, r) => n + (r.security?.lostWaiting ?? 0), 0),
        fittingsShort: rows.reduce((n, r) => n + (r.fittings?.items.length ?? 0), 0),
        fittingsCheckDue: rows.filter((r) => r.fittings?.checkDue).length,
        notRecovered: rows.reduce((n, r) => n + (r.fittings?.notRecovered ?? 0), 0),
      },
      rule: RULES.cleaningStock,
    };
  }

  // ---------- Supplies and equipment ----------

  private stockLines(setup: CleaningSite, input: { supplies?: unknown; equipment?: unknown }, mode: 'sent' | 'counted' | 'check') {
    const supplies = Array.isArray(input.supplies) ? input.supplies : [];
    const equipment = Array.isArray(input.equipment) ? input.equipment : [];
    const sIds = new Set(setup.supplies.map((s) => s.id));
    const eIds = new Set(setup.equipment.map((e) => e.id));
    const seen = new Set<string>();
    const s = supplies.map((x: { supplyId?: unknown; qty?: unknown }) => {
      if (typeof x?.supplyId !== 'string' || !sIds.has(x.supplyId) || seen.has(x.supplyId)) throw new BadRequest('A supply line is not on this site.');
      seen.add(x.supplyId);
      const q = num(x.qty, 'Quantity', 0, 1_000_000);
      return { supplyId: x.supplyId, sent: mode === 'sent' ? q : null, counted: mode === 'sent' ? null : q };
    });
    const e = equipment.map((x: { equipmentId?: unknown; qty?: unknown; broken?: unknown }) => {
      if (typeof x?.equipmentId !== 'string' || !eIds.has(x.equipmentId) || seen.has(x.equipmentId)) throw new BadRequest('An equipment line is not on this site.');
      seen.add(x.equipmentId);
      const q = int(x.qty, 'Quantity', 0, 10_000);
      return {
        equipmentId: x.equipmentId,
        sent: mode === 'sent' ? q : null,
        working: mode === 'sent' ? null : q,
        broken: mode === 'check' ? int(x.broken ?? 0, 'Broken', 0, 10_000) : null,
      };
    });
    if (!s.length && !e.length) throw new BadRequest('Give at least one line.');
    return { supplies: s, equipment: e };
  }

  /** The OM (or store, through the OM) records supplies and equipment sent to the site. */
  async recordDelivery(user: User, siteId: Id, input: { date: IsoDate; supplies?: unknown; equipment?: unknown; note: string }) {
    const site = await this.manage(user, siteId);
    if (!DATE.test(input.date ?? '') || input.date > this.today() || input.date < addDays(this.today(), -31)) throw new BadRequest('Give the delivery date (within the last 31 days).');
    const setup = await this.setupFor(siteId);
    const lines = this.stockLines(setup, input, 'sent');
    const now = this.now();
    return this.store.transaction(async (tx) => {
      const row: CleaningStockEntry = {
        id: `cstk-${siteId}-${now.replace(/\D/g, '').slice(0, 14)}-${sha256Hex(`${user.id}${now}${Math.random()}`).slice(0, 6)}`,
        companyId: site.companyId,
        siteId,
        kind: 'delivery',
        date: input.date,
        ...lines,
        note: text(input.note, 'Note', 500, false),
        by: user.name,
        byId: user.id,
        at: now,
        received: null,
        proofIds: [],
      };
      await tx.insert('cleaningStock', row);
      await tx.audit({ at: now, actor: user.name, companyId: site.companyId, action: 'cleaning.stock.deliver', entity: 'cleaning_stock', entityId: row.id, summary: `Sent to ${site.name}: ${lines.supplies.length} supply and ${lines.equipment.length} equipment lines` });
      return row;
    });
  }

  /**
   * The OM records what the supervisor says actually arrived, with the supervisor's time-marked photo. A count below
   * what was sent shows as a short delivery (under-giving) on the board.
   */
  async receiveDelivery(user: User, siteId: Id, entryId: Id, input: { supplies?: unknown; equipment?: unknown; note: string; proof: CleaningProofInput }) {
    const site = await this.manage(user, siteId);
    const setup = await this.setupFor(siteId);
    const now = this.now();
    if (!input.proof) throw new BadRequest("Attach the supervisor's time-marked photo of what arrived.");
    return this.store.transaction(async (tx) => {
      await tx.lock?.('cleaningStock', entryId);
      const cur = await tx.get('cleaningStock', entryId);
      if (!cur || cur.siteId !== siteId || cur.kind !== 'delivery') throw new NotFound('Delivery');
      if (cur.received) throw new BadRequest('This delivery was already received.');
      const got = this.stockLines(setup, input, 'counted');
      const sentS = new Set(cur.supplies.map((x) => x.supplyId));
      const sentE = new Set(cur.equipment.map((x) => x.equipmentId));
      if (got.supplies.some((x) => !sentS.has(x.supplyId)) || got.equipment.some((x) => !sentE.has(x.equipmentId)))
        throw new BadRequest('Count only the lines that were sent.');
      if (got.supplies.length !== sentS.size || got.equipment.length !== sentE.size) throw new BadRequest('Count every line that was sent (0 if nothing arrived).');
      const proof = await this.saveProof(tx, user, site.companyId, cur.id, this.today(), input.proof, `${site.name}: delivery received`);
      const supplies = cur.supplies.map((x) => ({ ...x, counted: got.supplies.find((y) => y.supplyId === x.supplyId)!.counted }));
      const equipment = cur.equipment.map((x) => ({ ...x, working: got.equipment.find((y) => y.equipmentId === x.equipmentId)!.working }));
      const short = supplies.filter((x) => (x.counted ?? 0) < (x.sent ?? 0)).length + equipment.filter((x) => (x.working ?? 0) < (x.sent ?? 0)).length;
      const row = await tx.update('cleaningStock', cur.id, {
        supplies,
        equipment,
        received: { by: user.name, byId: user.id, at: now, note: text(input.note, 'Note', 500, false) },
        proofIds: [...cur.proofIds, proof.id],
      });
      await tx.audit({ at: now, actor: user.name, companyId: site.companyId, action: 'cleaning.stock.receive', entity: 'cleaning_stock', entityId: cur.id, summary: `Received at ${site.name}${short ? `, ${short} line(s) short` : ', all as sent'} (photo ${proof.timeMark?.stampedAt}, ${proof.timeMark?.check})` });
      return row;
    });
  }

  /** The supervisor's count of supplies on hand and equipment working or broken, recorded by the OM with a time-marked photo. */
  async stockCheck(user: User, siteId: Id, input: { date: IsoDate; supplies?: unknown; equipment?: unknown; note: string; proof: CleaningProofInput }) {
    const site = await this.manage(user, siteId);
    const today = this.today();
    if (!DATE.test(input.date ?? '') || input.date > today || input.date < addDays(today, -2)) throw new BadRequest('A stock check is for today or the last 2 days.');
    if (!input.proof) throw new BadRequest("Attach the supervisor's time-marked photo of the store.");
    const setup = await this.setupFor(siteId);
    const lines = this.stockLines(setup, input, 'check');
    const now = this.now();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('sites', siteId);
      const id = `cstk-${siteId}-${input.date}-check`;
      if (await tx.get('cleaningStock', id)) throw new BadRequest('A stock check was already recorded for this day.');
      const proof = await this.saveProof(tx, user, site.companyId, id, input.date, input.proof, `${site.name} ${input.date}: stock check`);
      const row: CleaningStockEntry = {
        id,
        companyId: site.companyId,
        siteId,
        kind: 'check',
        date: input.date,
        ...lines,
        note: text(input.note, 'Note', 500, false),
        by: user.name,
        byId: user.id,
        at: now,
        received: null,
        proofIds: [proof.id],
      };
      await tx.insert('cleaningStock', row);
      await tx.audit({ at: now, actor: user.name, companyId: site.companyId, action: 'cleaning.stock.check', entity: 'cleaning_stock', entityId: row.id, summary: `Stock check at ${site.name} on ${input.date} (photo ${proof.timeMark?.stampedAt}, ${proof.timeMark?.check})` });
      return row;
    });
  }
}