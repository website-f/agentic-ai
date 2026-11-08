import { addDays } from "./time";
import { daysBetween } from "./time";
import { weekday } from "./time";
import type { Id } from "./types";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";


export type CleaningWorkKind =
  | 'toilet'
  | 'sweep'
  | 'mop'
  | 'vacuum'
  | 'wipe'
  | 'rubbish'
  | 'grass_cut'
  | 'hedge_trim'
  | 'drain'
  | 'water_plants'
  | 'landscape'
  | 'glass'
  | 'other';

export type CleaningUnit = 'm2' | 'units' | 'm';

/**
 * How often the client wants an area done.
 * per_day: N rounds each working day, each in its own part of the day.
 * per_week: N working days a week, spread evenly.
 * every_weeks: one full round every N weeks; the area is split across the working days of the first finishWithinDays
 *   days of each cycle (grass: every 2 weeks, finished within 15 days).
 * every_months: once every N months, on the first working day of the month.
 * as_needed: not planned; listed for the supervisor.
 * always: must hold all the time (soap, tissue, bin liners); the supervisor checks it on each round.
 */
export type CleaningFrequency =
  | { kind: 'per_day'; times: number }
  | { kind: 'per_week'; times: number }
  | { kind: 'every_weeks'; weeks: number; finishWithinDays: number }
  | { kind: 'every_months'; months: number }
  | { kind: 'as_needed' }
  | { kind: 'always' };

export interface CleaningArea {
  id: Id;
  /** e.g. "Block A toilets", "Field and slopes". */
  name: string;
  work: CleaningWorkKind;
  /** Size in the unit: m² for floors and grass, units for toilet cubicles and bins, metres for drains. */
  size: number;
  unit: CleaningUnit;
  frequency: CleaningFrequency;
  /** Work rate per hour for one person, set by the OM; null uses the default for the kind (rule CLEAN-RATES). */
  ratePerHour: number | null;
  /** The client's quality standard for this area, shown to the cleaner and checked by the supervisor. */
  quality: string;
  /** The contract item this area answers, e.g. "Jadual 1A (a)". */
  scopeRef: string;
  /** Where the area is on the site map, as a percentage of the map's width and height. */
  pin: { x: number; y: number } | null;
  /** Earliest and latest time of day the client allows, HH:MM; null for any time. */
  notBefore: string | null;
  notAfter: string | null;
  /**
   * The client must sign an acknowledgement slip that this work was done properly (Fauzan, 4 Nov 2026: e.g. grass
   * cutting needs the school's slip, which usually carries a comment). Missing means no slip is needed.
   */
  clientAck?: boolean;
}

/** One day of the week's working hours; null is a rest day. Breaks are taken in turns (two groups). */
export interface CleaningDayHours {
  start: string;
  end: string;
  breakMin: number;
}

export type CleaningCrewRole = 'cleaner' | 'supervisor';

/**
 * A worker on the site's cleaning crew. Cleaners and supervisors do not sign in yet (Fauzan, 4 Nov 2026): the OM keeps
 * the crew list and records what the supervisor reports. personId links a person record when HR has one.
 */
export interface CleaningCrewMember {
  id: Id;
  name: string;
  role: CleaningCrewRole;
  /** Two-session schools: session 2 works the later hours (contract: 7am-4pm and 9am-6pm). */
  session: 1 | 2;
  personId: Id | null;
}

export interface CleaningSite {
  id: Id;
  companyId: Id;
  siteId: Id;
  /** Which template the scope started from; the OM may change every area afterwards. */
  template: 'kpm_school' | 'custom';
  /** The client's contract or letter reference for this scope. */
  contractRef: string;
  /** Workers the contract requires on site each working day (KPM Lampiran A2 column E). */
  requiredHeadcount: number;
  /** Facts from the client's quantity schedule (KPM Lampiran A2): acres, blocks, floors and toilet cubicles. */
  facts: { acres: number | null; blocks: number | null; floors: number | null; toiletCubicles: number | null };
  /** Working hours for each day of the week, index 0 = Sunday. */
  week: (CleaningDayHours | null)[];
  /** A school with two sessions: session 2's hours on full working days; the contract splits the crew 60:40. */
  secondSession: { start: string; end: string } | null;
  /** Public holidays and other days the site does not work. */
  closedDays: IsoDate[];
  /** First day of the 2-weekly and monthly cycles (usually the contract start). */
  cycleStart: IsoDate;
  /**
   * The OM's own planner timings for this site (Fauzan, 4 Nov 2026: each site has different sizes, so the OM may change
   * them). Missing values use CLEANING_RULES.
   */
  timings?: Partial<CleaningTimings> | null;
  /** A worker's monthly wage in RM, used only to estimate the contract's deduction for a missing worker. */
  monthlyWage: number | null;
  /** The site map uploaded by the OM (kept as a document behind the company wall). */
  map: { docId: Id; name: string; mime: 'application/pdf' | 'image/jpeg' | 'image/png' } | null;
  crew: CleaningCrewMember[];
  areas: CleaningArea[];
  /** Machines and tools the site must have (KPM Lampiran A3), with how many the contract requires. */
  equipment: CleaningEquipment[];
  /** Cleaning supplies with the usage budget per working day (Fauzan, 4 Nov 2026: no over-use and no under-giving). */
  supplies: CleaningSupply[];
  version: number;
  updatedBy: string;
  updatedAt: IsoDateTime;
}

export interface CleaningEquipment {
  id: Id;
  /** e.g. Vacuum cleaner, Grass cutter, Mop set. */
  name: string;
  /** How many the client's contract requires at this site. */
  required: number;
  /** At contract end: taken back unless the contract hands it over (Fauzan, 4 Nov 2026). Missing means take back. */
  atEnd?: 'take_back' | 'hand_over';
  handOverRef?: string;
}

export interface CleaningSupply {
  id: Id;
  /** e.g. Floor cleaner, Toilet roll, Hand soap, Rubbish bags. */
  name: string;
  /** e.g. litre, roll, pack, bottle. */
  unit: string;
  /** Expected use per working day, set by the OM (the budget the usage is measured against). */
  perDay: number;
  /** Brands the client approved (KPM Lampiran A4), for the store and the supervisor to check. */
  approvedBrands: string;
}

/**
 * Cleaning stock movements at a site. 'delivery': the store or OM sends supplies or equipment to the site, and the
 * supervisor confirms what actually arrived. 'check': the supervisor counts what is on site, with photo proof.
 */
export interface CleaningStockEntry {
  id: Id;
  companyId: Id;
  siteId: Id;
  /** client_ack: the client's signed acknowledgement slip for work done (the slip is in proofIds; details in ack). */
  kind: 'delivery' | 'check' | 'client_ack';
  date: IsoDate;
  /** Supply counts: sent (delivery), received (delivery, by the supervisor) or on hand (check). */
  supplies: { supplyId: Id; sent: number | null; counted: number | null }[];
  /** Equipment: sent (delivery) or working and broken (check). */
  equipment: { equipmentId: Id; sent: number | null; working: number | null; broken: number | null }[];
  note: string;
  by: string;
  byId: Id;
  at: IsoDateTime;
  /** Supervisor's confirmation of a delivery: what arrived, who, when. */
  received: { by: string; byId: Id; at: IsoDateTime; note: string } | null;
  /** Proof: photo or document ids (rule CLEAN-STOCK-PROOF: a stock check and a receipt need at least one). */
  proofIds: Id[];
  /** kind client_ack only. */
  ack?: CleaningClientAck | null;
}

/**
 * The client's acknowledgement slip for work done (Fauzan, 4 Nov 2026): the OM uploads the signed slip with what it says.
 * The entry's date is the day the client signed. It covers the listed areas' work from `from` to `to`.
 */
export interface CleaningClientAck {
  areaIds: Id[];
  from: IsoDate;
  to: IsoDate;
  /** Who signed for the client, with their post, e.g. "Penolong Kanan HEM". */
  signer: string;
  outcome: 'accepted' | 'not_accepted';
  /** The client's comment written on the slip, copied by the OM. */
  comment: string;
  /** What the OM will do about the comment. */
  action: string;
}

/** Work kinds whose areas need the client's slip by default (the OM can tick or untick any area). */
export const CLIENT_ACK_DEFAULT_WORK: CleaningWorkKind[] = ['grass_cut', 'hedge_trim'];

/** One area's work that needs a slip: days done in a period, and the slips that cover them. */
export interface ClientAckStatus {
  areaId: Id;
  name: string;
  /** Days with the area's work done or checked. */
  workDays: IsoDate[];
  /** Days covered by an accepted slip. */
  acknowledged: IsoDate[];
  /** Days covered only by a slip the client did not accept: redo the work and get a new slip. */
  rejected: IsoDate[];
  /** Days with no slip yet. */
  outstanding: IsoDate[];
}

/**
 * Which of the areas needing a slip have work done with no slip yet. A later accepted slip clears a day an earlier slip
 * did not accept.
 */
export function clientAckStatus(
  site: Pick<CleaningSite, 'areas'>,
  days: Pick<CleaningDay, 'date' | 'tasks'>[],
  acks: Pick<CleaningStockEntry, 'date' | 'at' | 'ack'>[],
): ClientAckStatus[] {
  const sorted = acks.filter((a) => a.ack).sort((a, b) => a.at.localeCompare(b.at));
  return site.areas
    .filter((a) => a.clientAck)
    .map((area) => {
      const workDays = [...new Set(days.filter((d) => d.tasks.some((t) => t.type === 'work' && t.areaId === area.id && (t.status === 'done' || t.status === 'checked'))).map((d) => d.date))].sort();
      const acknowledged: IsoDate[] = [];
      const rejected: IsoDate[] = [];
      const outstanding: IsoDate[] = [];
      for (const d of workDays) {
        const cover = sorted.filter((x) => x.ack!.areaIds.includes(area.id) && x.ack!.from <= d && x.ack!.to >= d);
        const last = cover.at(-1);
        if (!last) outstanding.push(d);
        else if (last.ack!.outcome === 'accepted') acknowledged.push(d);
        else rejected.push(d);
      }
      return { areaId: area.id, name: area.name, workDays, acknowledged, rejected, outstanding };
    });
}

export type CleaningTaskType = 'briefing' | 'work' | 'break' | 'inspect' | 'round' | 'report';
/** not_needed: the supervisor saw the area did not need the job that day (Fauzan, 4 Nov 2026); its time goes to other due work. */
export type CleaningTaskStatus = 'planned' | 'done' | 'checked' | 'redo' | 'missed' | 'not_needed';

export interface CleaningTask {
  id: Id;
  crewId: Id;
  type: CleaningTaskType;
  /** The area worked or checked; null for briefings, breaks and reports. */
  areaId: Id | null;
  /** The planned job this task belongs to: area, round and part. Inspections point at the work task they check. */
  jobKey: string | null;
  checksTaskId: Id | null;
  title: string;
  /** HH:MM, minute-by-minute. */
  start: string;
  end: string;
  minutes: number;
  /** Part n of a big area split between people or days. */
  part: { n: number; of: number } | null;
  /** Size of the part in the area's unit. */
  size: number | null;
  /** Placed after the client's latest time or the round's window. */
  late: boolean;
  status: CleaningTaskStatus;
  doneBy: string | null;
  doneById: Id | null;
  doneAt: IsoDateTime | null;
  checkedBy: string | null;
  checkedById: Id | null;
  checkedAt: IsoDateTime | null;
  note: string;
}

export interface CleaningUncovered {
  jobKey: string;
  areaId: Id;
  title: string;
  minutes: number;
  reason: string;
}

export interface CleaningDay {
  /** cday-<siteId>-<date> */
  id: Id;
  companyId: Id;
  siteId: Id;
  date: IsoDate;
  planVersion: number;
  status: 'draft' | 'published';
  hours: CleaningDayHours | null;
  /** People the supervisor or OM marked absent for the day; the plan leaves them out. */
  absentIds: Id[];
  tasks: CleaningTask[];
  uncovered: CleaningUncovered[];
  /** Areas that are "as needed" or "always": the supervisor's list for the day. */
  watchList: { areaId: Id; title: string; quality: string; kind: 'as_needed' | 'always' }[];
  summary: CleaningSummary;
  generatedAt: IsoDateTime;
  generatedBy: string;
  publishedAt: IsoDateTime | null;
  publishedBy: string | null;
  log: { at: IsoDateTime; by: string; what: string }[];
}

export interface CleaningSummary {
  requiredHeadcount: number;
  rosteredCleaners: number;
  presentCleaners: number;
  supervisors: number;
  /** Workers short of the contract's headcount today (present cleaners + supervisors vs required). */
  headcountShort: number;
  /** Estimated contract deduction for the missing workers today: monthly wage / 30.5 x missing (contract clause 8). */
  deductionEstimate: number | null;
  workMinutes: number;
  availableMinutes: number;
  uncoveredMinutes: number;
  /** Cleaners needed to cover all planned work at this site's hours. */
  cleanersNeeded: number;
}

// ---------- Rules (proposed defaults, for Fauzan's approval) ----------

/**
 * Work rate for one person per hour, by kind, used when the OM has not set a rate on the area. Proposed from common
 * cleaning industry figures, for approval (rule CLEAN-RATES): the OM changes any area to match the site.
 */
export const CLEANING_DEFAULT_RATE: Record<CleaningWorkKind, { perHour: number; unit: CleaningUnit }> = {
  toilet: { perHour: 10, unit: 'units' },
  sweep: { perHour: 400, unit: 'm2' },
  mop: { perHour: 250, unit: 'm2' },
  vacuum: { perHour: 250, unit: 'm2' },
  wipe: { perHour: 150, unit: 'm2' },
  rubbish: { perHour: 30, unit: 'units' },
  grass_cut: { perHour: 300, unit: 'm2' },
  hedge_trim: { perHour: 40, unit: 'm' },
  drain: { perHour: 60, unit: 'm' },
  water_plants: { perHour: 120, unit: 'units' },
  landscape: { perHour: 100, unit: 'm2' },
  glass: { perHour: 40, unit: 'm2' },
  other: { perHour: 100, unit: 'm2' },
};

export const CLEANING_RULES = {
  /** Morning briefing for the whole crew, minutes. */
  briefingMin: 10,
  /** Walking and setting up between two different areas, minutes. */
  moveMin: 5,
  /** A big area is split into parts of at most this many minutes so it can be shared. */
  maxPartMin: 90,
  /** The supervisor's check of one finished task, minutes. */
  inspectMin: 5,
  /** The supervisor's round of the "always" items, every so many minutes, taking roundMin. */
  roundEveryMin: 120,
  roundMin: 15,
  /** End of day report to the OM, minutes. */
  reportMin: 15,
  /** The first break group starts at this time; the second group starts when the first comes back (in turns). */
  breakFrom: '12:00',
  /** Days in a month for the contract's daily deduction (KPM: monthly wage / 30.5). */
  deductionDays: 30.5,
} as const;

/** The planner timings an OM may change per site. */
export type CleaningTimings = { -readonly [K in keyof typeof CLEANING_RULES]: (typeof CLEANING_RULES)[K] extends string ? string : number };
export const CLEANING_TIMING_KEYS = ['briefingMin', 'moveMin', 'maxPartMin', 'inspectMin', 'roundEveryMin', 'roundMin', 'reportMin', 'breakFrom'] as const;
export const CLEANING_TIMING_LABEL: Record<(typeof CLEANING_TIMING_KEYS)[number], string> = {
  briefingMin: 'Morning briefing (min)',
  moveMin: 'Walk between areas (min)',
  maxPartMin: 'Longest part of a big job (min)',
  inspectMin: 'Supervisor check of one task (min)',
  roundEveryMin: 'Supervisor round every (min)',
  roundMin: 'Supervisor round takes (min)',
  reportMin: 'End of day report (min)',
  breakFrom: 'First break group starts (HH:MM)',
};

/** The timings the planner uses at a site: the OM's own where set, else the defaults. */
export function siteTimings(site: Pick<CleaningSite, 'timings'>): CleaningTimings {
  return { ...CLEANING_RULES, ...(site.timings ?? {}) } as CleaningTimings;
}

/**
 * Stock rules (CLEAN-STOCK, Fauzan 4 Nov 2026): use above 100% of the budget is over-use; below 50% means supplies
 * may not be reaching the areas (soap, tissue not refilled) or were under-given; reorder when on hand covers fewer than
 * 7 working days; a received count lower than sent is a short delivery.
 */
export const CLEANING_STOCK_RULES = { overUsePct: 100, underUsePct: 50, reorderDays: 7 } as const;

export const CLEANING_WORK_LABEL: Record<CleaningWorkKind, { en: string; bm: string }> = {
  toilet: { en: 'Toilets and wash areas', bm: 'Tandas dan bilik air' },
  sweep: { en: 'Sweep', bm: 'Menyapu' },
  mop: { en: 'Mop floors', bm: 'Mengemop lantai' },
  vacuum: { en: 'Vacuum carpets', bm: 'Hampagas permaidani' },
  wipe: { en: 'Wipe furniture and fittings', bm: 'Mengelap perabot' },
  rubbish: { en: 'Collect rubbish and bins', bm: 'Kutip sampah dan tong' },
  grass_cut: { en: 'Grass cutting', bm: 'Memotong rumput' },
  hedge_trim: { en: 'Hedges and shrubs', bm: 'Memangkas semak' },
  drain: { en: 'Clean drains', bm: 'Mencuci longkang' },
  water_plants: { en: 'Water plants', bm: 'Menyiram pokok' },
  landscape: { en: 'Landscape and plants', bm: 'Landskap dan pokok' },
  glass: { en: 'Glass and windows', bm: 'Cermin dan tingkap' },
  other: { en: 'Other work', bm: 'Kerja lain' },
};

export const CLEANING_UNIT_LABEL: Record<CleaningUnit, string> = { m2: 'm²', units: 'units', m: 'm' };

export function frequencyLabel(f: CleaningFrequency): string {
  switch (f.kind) {
    case 'per_day':
      return f.times === 1 ? 'Once a day' : `${f.times} times a day`;
    case 'per_week':
      return f.times === 1 ? 'Once a week' : `${f.times} times a week`;
    case 'every_weeks':
      return `Every ${f.weeks} week${f.weeks === 1 ? '' : 's'}, round finished within ${f.finishWithinDays} days`;
    case 'every_months':
      return f.months === 1 ? 'Once a month' : `Every ${f.months} months`;
    case 'as_needed':
      return 'As needed';
    case 'always':
      return 'All the time';
  }
}

// ---------- Time helpers ----------

export function toMin(hhmm: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) throw new Error(`Time must be HH:MM, got ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function fromMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function isHhmm(s: unknown): s is string {
  return typeof s === 'string' && /^([01]\d|2[0-3]):([0-5]\d)$/.test(s);
}

const roundUp5 = (n: number) => Math.max(5, Math.ceil(n / 5) * 5);

/** Minutes one person needs for a size of an area. */
export function minutesFor(area: Pick<CleaningArea, 'work' | 'size' | 'ratePerHour'>, size = area.size): number {
  const rate = area.ratePerHour && area.ratePerHour > 0 ? area.ratePerHour : CLEANING_DEFAULT_RATE[area.work].perHour;
  return roundUp5((size / rate) * 60);
}

// ---------- Templates ----------

/** KPM school hours (Lampiran A1 s.4(a)): Mon-Fri 7am-4pm with a 1-hour break (1h30 on Friday), Saturday 7am-12.30pm, no break. */
export function kpmWeek(weekend: 'sat_sun' | 'fri_sat'): (CleaningDayHours | null)[] {
  const full = { start: '07:00', end: '16:00', breakMin: 60 };
  if (weekend === 'sat_sun')
    // Sunday rest; Saturday is a half day with no break (contract: work on Saturday 7.00am to 12.30pm).
    return [null, full, full, full, full, { ...full, breakMin: 90 }, { start: '07:00', end: '12:30', breakMin: 0 }];
  // Friday and Saturday weekend states (s.4(b)): Sunday to Thursday full days, Saturday 7am-12pm.
  return [full, full, full, full, full, null, { start: '07:00', end: '12:00', breakMin: 0 }];
}

/**
 * Areas of a KPM school from its quantity schedule (Lampiran A2) and the scope (Jadual 1A). Sizes the contract does not
 * give (floor m², drain length, field m²) start at 0 and must be measured by the OM before the plan can use them.
 */
export function kpmSchoolAreas(facts: CleaningSite['facts'], twoSession: boolean): CleaningArea[] {
  const a = (
    id: string,
    name: string,
    work: CleaningWorkKind,
    size: number,
    unit: CleaningUnit,
    frequency: CleaningFrequency,
    quality: string,
    scopeRef: string,
    notBefore: string | null = null,
  ): CleaningArea => ({ id, name, work, size, unit, frequency, ratePerHour: null, quality, scopeRef, pin: null, notBefore, notAfter: null, clientAck: CLIENT_ACK_DEFAULT_WORK.includes(work) });
  const acresM2 = facts.acres ? Math.round(facts.acres * 4046.86) : 0;
  return [
    a('toilets', 'Toilets, wash rooms, ablution and changing rooms', 'toilet', facts.toiletCubicles ?? 0, 'units',
      { kind: 'per_day', times: twoSession ? 4 : 2 }, 'Clean, dry and no bad smell', 'Jadual 1A (a)'),
    a('supplies', 'Bin liners, hand soap and toilet tissue', 'other', 0, 'units', { kind: 'always' },
      'Bins always lined; antiseptic soap and toilet roll always there', 'Jadual 1A (a)(vi),(viii),(ix)'),
    a('floors', 'Corridors, stairs, offices, classrooms and halls (sweep and mop)', 'mop', 0, 'm2',
      { kind: 'per_day', times: 2 }, 'Clean and tidy', 'Jadual 1A (b)(i)'),
    a('fittings', 'Furniture and fittings (not lab apparatus)', 'wipe', 0, 'm2', { kind: 'per_day', times: 2 },
      'Clean and tidy', 'Jadual 1A (b)(iii)'),
    a('carpets', 'Carpets (vacuum)', 'vacuum', 0, 'm2', { kind: 'per_week', times: 2 }, 'Clean and tidy', 'Jadual 1A (b)(iv)'),
    a('rubbish', 'Rubbish bins around buildings and grounds', 'rubbish', 0, 'units', { kind: 'per_day', times: 2 },
      'Clean and tidy; rubbish to the approved collection point', 'Jadual 1A (c)(i),(iii)'),
    a('mosquito', 'No mosquito breeding places', 'other', 0, 'units', { kind: 'always' }, 'No mosquito breeding places',
      'Jadual 1A (c)(v)'),
    a('grass', 'Field, slopes, roadside, drain edges and 2 ft outside the fence (grass)', 'grass_cut', acresM2, 'm2',
      { kind: 'every_weeks', weeks: 2, finishWithinDays: 15 }, 'Grass cut to not less than 2 cm and not more than 4 cm',
      'Jadual 1A (d)'),
    a('hedges', 'Hedges, shrubs and creepers along buildings, fences and drains', 'hedge_trim', 0, 'm',
      { kind: 'every_weeks', weeks: 2, finishWithinDays: 14 }, 'Tidy; no nest for dangerous animals', 'Jadual 1A (e)(i)'),
    a('drains', 'Drains around the buildings', 'drain', 0, 'm', { kind: 'per_week', times: 1 },
      'Drains clean, water flows, no mosquito breeding', 'Jadual 1A (e)(ii)'),
    a('pots', 'Water potted plants', 'water_plants', 0, 'units', { kind: 'per_day', times: 1 },
      'Plants healthy and tidy', 'Jadual 1A (f)(i)', '07:00'),
    a('fertilise', 'Fertilise plants', 'landscape', 0, 'm2', { kind: 'every_weeks', weeks: 2, finishWithinDays: 14 },
      'Plants healthy and tidy', 'Jadual 1A (f)(iii)'),
    a('soil', 'Loosen soil at plant bases', 'landscape', 0, 'm2', { kind: 'every_months', months: 2 },
      'Plants healthy and tidy', 'Jadual 1A (f)(v)'),
    a('extra', 'Wash bins, cut back dry branches, replant (as needed)', 'other', 0, 'units', { kind: 'as_needed' },
      'Clean and tidy', 'Jadual 1A (c)(iv),(e)(iii),(f)(vi)'),
  ];
}

// ---------- Which jobs are due on a date ----------

export interface CleaningJob {
  key: string;
  area: CleaningArea;
  title: string;
  size: number;
  minutes: number;
  part: { n: number; of: number } | null;
  /** Minutes from midnight. */
  earliest: number;
  deadline: number;
  round: number;
}

export function workingDay(site: Pick<CleaningSite, 'week' | 'closedDays'>, date: IsoDate): boolean {
  return !!site.week[weekday(date)] && !site.closedDays.includes(date);
}

/** Working days from a to b inclusive. */
function workingDaysBetween(site: Pick<CleaningSite, 'week' | 'closedDays'>, from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (workingDay(site, d)) out.push(d);
  return out;
}

/** Monday of the week a date falls in. */
function weekStart(date: IsoDate): IsoDate {
  return addDays(date, -((weekday(date) + 6) % 7));
}

/** Split a size into parts that each take at most maxPartMin. */
function splitParts(area: CleaningArea, size: number, maxPartMin: number = CLEANING_RULES.maxPartMin): number[] {
  const total = minutesFor(area, size);
  const parts = Math.max(1, Math.ceil(total / maxPartMin));
  if (parts === 1) return [size];
  const each = size / parts;
  return Array.from({ length: parts }, (_, i) => (i === parts - 1 ? size - each * (parts - 1) : each));
}

const sizeText = (n: number, unit: CleaningUnit) => `${Math.round(n).toLocaleString('en-MY')} ${CLEANING_UNIT_LABEL[unit]}`;

export function dueJobs(site: CleaningSite, date: IsoDate, hours: CleaningDayHours): CleaningJob[] {
  const jobs: CleaningJob[] = [];
  const dayStart = toMin(hours.start);
  const dayEnd = toMin(hours.end);
  const span = dayEnd - dayStart;
  for (const area of site.areas) {
    if (!(area.size > 0)) continue;
    const f = area.frequency;
    const lo = area.notBefore ? Math.max(dayStart, toMin(area.notBefore)) : dayStart;
    const hi = area.notAfter ? Math.min(dayEnd, toMin(area.notAfter)) : dayEnd;
    const push = (round: number, size: number, earliest: number, deadline: number, label: string) => {
      const parts = splitParts(area, size, siteTimings(site).maxPartMin);
      parts.forEach((s, i) =>
        jobs.push({
          key: `${area.id}:${round}:${i + 1}`,
          area,
          title: `${area.name}${label}${parts.length > 1 ? ` (part ${i + 1} of ${parts.length}, about ${sizeText(s, area.unit)})` : ''}`,
          size: s,
          minutes: minutesFor(area, s),
          part: parts.length > 1 ? { n: i + 1, of: parts.length } : null,
          earliest,
          deadline,
          round,
        }),
      );
    };
    if (f.kind === 'per_day') {
      const times = Math.max(1, Math.min(8, Math.floor(f.times)));
      // On a short day (Saturday) the rounds share the shorter day.
      for (let r = 1; r <= times; r++) {
        const earliest = Math.max(lo, dayStart + Math.floor(((r - 1) * span) / times));
        const deadline = Math.min(hi, dayStart + Math.floor((r * span) / times));
        push(r, area.size, earliest, Math.max(deadline, earliest), times > 1 ? `, round ${r} of ${times}` : '');
      }
    } else if (f.kind === 'per_week') {
      const ws = weekStart(date);
      const days = workingDaysBetween(site, ws, addDays(ws, 6));
      const times = Math.max(1, Math.min(days.length, Math.floor(f.times)));
      // Evenly spread: pick day indexes floor(i * n / times).
      const picks = new Set(Array.from({ length: times }, (_, i) => days[Math.floor((i * days.length) / times)]));
      if (picks.has(date)) push(1, area.size, lo, hi, '');
    } else if (f.kind === 'every_weeks') {
      const cycleDays = Math.max(1, Math.floor(f.weeks)) * 7;
      const offset = ((daysBetween(site.cycleStart, date) % cycleDays) + cycleDays) % cycleDays;
      const cycleStart = addDays(date, -offset);
      const windowDays = Math.max(1, Math.min(cycleDays, Math.floor(f.finishWithinDays)));
      const days = workingDaysBetween(site, cycleStart, addDays(cycleStart, windowDays - 1));
      const idx = days.indexOf(date);
      if (idx >= 0) {
        const share = area.size / days.length;
        const label = ` (day ${idx + 1} of ${days.length} of this round, about ${sizeText(share, area.unit)})`;
        const parts = splitParts(area, share, siteTimings(site).maxPartMin);
        parts.forEach((s, i) =>
          jobs.push({
            key: `${area.id}:c${idx + 1}:${i + 1}`,
            area,
            title: `${area.name}${label}${parts.length > 1 ? `, part ${i + 1} of ${parts.length}` : ''}`,
            size: s,
            minutes: minutesFor(area, s),
            part: parts.length > 1 ? { n: i + 1, of: parts.length } : null,
            earliest: lo,
            deadline: hi,
            round: 1,
          }),
        );
      }
    } else if (f.kind === 'every_months') {
      const months = Math.max(1, Math.floor(f.months));
      const [cy, cm] = site.cycleStart.split('-').map(Number);
      const [y, m] = date.split('-').map(Number);
      const diff = (y - cy) * 12 + (m - cm);
      if (diff >= 0 && diff % months === 0) {
        const first = workingDaysBetween(site, `${date.slice(0, 7)}-01`, date)[0];
        if (first === date) push(1, area.size, lo, hi, '');
      }
    }
  }
  // Earliest window first, then the tighter deadline, then the longer job (it is harder to fit).
  return jobs.sort((a, b) => a.earliest - b.earliest || a.deadline - b.deadline || b.minutes - a.minutes || a.key.localeCompare(b.key));
}

// ---------- The day's plan ----------

export interface PlanPerson {
  crewId: Id;
  name: string;
  role: CleaningCrewRole;
  session: 1 | 2;
}

export function planPeople(site: Pick<CleaningSite, 'crew'>): PlanPerson[] {
  return site.crew.map((c) => ({ crewId: c.id, name: c.name, role: c.role, session: c.session }));
}

export interface PlanInput {
  site: CleaningSite;
  date: IsoDate;
  people: PlanPerson[];
  absentIds: Id[];
  /** Tasks already done, checked or missed today, kept as they are when re-planning (redo work is placed again). */
  keep?: CleaningTask[];
  /** Re-planning during the day: nothing new starts before this time (HH:MM). */
  fromTime?: string | null;
}

export interface PlanOutput {
  hours: CleaningDayHours | null;
  tasks: CleaningTask[];
  uncovered: CleaningUncovered[];
  watchList: CleaningDay['watchList'];
  summary: CleaningSummary;
}

interface Timeline {
  person: PlanPerson;
  start: number;
  end: number;
  breakStart: number;
  breakEnd: number;
  free: number;
  lastAreaId: Id | null;
  workMin: number;
}

/** First start >= t where [start, start+d) avoids the break; null when it does not fit before the day ends. */
function fit(tl: Timeline, t: number, d: number): number | null {
  let s = Math.max(t, tl.start);
  if (tl.breakEnd > tl.breakStart && s < tl.breakEnd && s + d > tl.breakStart) s = Math.max(s, tl.breakEnd);
  return s + d <= tl.end ? s : null;
}

function blank(crewId: Id, type: CleaningTaskType, title: string, start: number, end: number, extra: Partial<CleaningTask> = {}): CleaningTask {
  return {
    id: '',
    crewId,
    type,
    areaId: null,
    jobKey: null,
    checksTaskId: null,
    title,
    start: fromMin(start),
    end: fromMin(end),
    minutes: end - start,
    part: null,
    size: null,
    late: false,
    status: 'planned',
    doneBy: null,
    doneById: null,
    doneAt: null,
    checkedBy: null,
    checkedById: null,
    checkedAt: null,
    note: '',
    ...extra,
  };
}

/**
 * Builds the day: who works, when each person takes their break (in turns), the morning briefing, every due job placed
 * minute by minute on the cleaner who can finish it first, the supervisor's check after each job, rounds of the
 * "always" items and the end of day report. What cannot fit is listed as not covered, with the reason.
 */
export function planCleaningDay(input: PlanInput): PlanOutput {
  const { site, date } = input;
  const R = siteTimings(site);
  const hours = workingDay(site, date) ? site.week[weekday(date)] : null;
  const watchList: CleaningDay['watchList'] = site.areas
    .filter((a) => a.frequency.kind === 'always' || a.frequency.kind === 'as_needed')
    .map((a) => ({ areaId: a.id, title: a.name, quality: a.quality, kind: a.frequency.kind as 'always' | 'as_needed' }));
  const present = input.people.filter((p) => !input.absentIds.includes(p.crewId));
  const cleaners = present.filter((p) => p.role === 'cleaner');
  const supervisors = present.filter((p) => p.role === 'supervisor');
  const summaryBase = {
    requiredHeadcount: site.requiredHeadcount,
    rosteredCleaners: input.people.filter((p) => p.role === 'cleaner').length,
    presentCleaners: cleaners.length,
    supervisors: supervisors.length,
  };
  if (!hours) {
    return {
      hours: null,
      tasks: [],
      uncovered: [],
      watchList,
      summary: { ...summaryBase, headcountShort: 0, deductionEstimate: null, workMinutes: 0, availableMinutes: 0, uncoveredMinutes: 0, cleanersNeeded: 0 },
    };
  }
  const second = site.secondSession && hours.breakMin > 0 ? site.secondSession : null;
  const from = input.fromTime ? toMin(input.fromTime) : null;
  // Breaks in turns (contract: "secara bergilir"): alternate people go in the first or the second group.
  let turn = 0;
  const tl = (p: PlanPerson): Timeline => {
    const start = p.session === 2 && second ? toMin(second.start) : toMin(hours.start);
    const end = p.session === 2 && second ? toMin(second.end) : toMin(hours.end);
    const group = hours.breakMin > 0 ? turn++ % 2 : 0;
    const breakStart = hours.breakMin > 0 ? toMin(R.breakFrom) + group * hours.breakMin : 0;
    const breakEnd = hours.breakMin > 0 ? breakStart + hours.breakMin : 0;
    return { person: p, start, end, breakStart, breakEnd, free: start, lastAreaId: null, workMin: 0 };
  };
  const team = [...supervisors, ...cleaners].sort((a, b) => a.role.localeCompare(b.role) || a.crewId.localeCompare(b.crewId));
  const lines = new Map(team.map((p) => [p.crewId, tl(p)]));
  const tasks: CleaningTask[] = [];
  const kept = (input.keep ?? []).filter((t) => t.status === 'done' || t.status === 'checked' || t.status === 'missed' || t.status === 'not_needed');
  const keptKeys = new Set(kept.filter((t) => t.type === 'work').map((t) => t.jobKey));
  const keptChecks = new Set(kept.filter((t) => t.type === 'inspect').map((t) => t.checksTaskId));
  // Kept tasks stay on their person's line.
  for (const t of kept) {
    const line = lines.get(t.crewId);
    // A job not needed today keeps its record but frees its time for other work.
    if (line && t.status !== 'not_needed') line.free = Math.max(line.free, toMin(t.end));
    tasks.push(t);
  }
  for (const line of lines.values()) {
    if (from !== null) line.free = Math.max(line.free, from);
    if (line.breakEnd > line.breakStart) tasks.push(blank(line.person.crewId, 'break', 'Break (in turns)', line.breakStart, line.breakEnd));
  }
  // Morning briefing for everyone who starts at the opening time (not when re-planning later in the day).
  if (from === null) {
    for (const line of lines.values()) {
      if (line.start !== toMin(hours.start)) continue;
      const end = line.start + R.briefingMin;
      tasks.push(
        blank(line.person.crewId, 'briefing', line.person.role === 'supervisor' ? 'Brief the crew: attendance, PPE, today\'s plan' : 'Briefing with the supervisor', line.start, end),
      );
      line.free = end;
    }
  }
  const uncovered: CleaningUncovered[] = [];
  const jobs = dueJobs(site, date, hours).filter((j) => !keptKeys.has(j.key));
  const cleanerLines = [...lines.values()].filter((l) => l.person.role === 'cleaner');
  const placedWork: CleaningTask[] = [];
  for (const job of jobs) {
    if (!cleanerLines.length) {
      uncovered.push({ jobKey: job.key, areaId: job.area.id, title: job.title, minutes: job.minutes, reason: 'No cleaner present' });
      continue;
    }
    let best: { line: Timeline; start: number } | null = null;
    for (const line of cleanerLines) {
      const move = line.lastAreaId && line.lastAreaId !== job.area.id ? R.moveMin : 0;
      const s = fit(line, Math.max(line.free + move, job.earliest, from ?? 0), job.minutes);
      if (s === null) continue;
      const end = s + job.minutes;
      // Finish first; on a tie, the person with less work so far (spreads the load evenly).
      if (!best || end < best.start + job.minutes || (end === best.start + job.minutes && line.workMin < best.line.workMin)) best = { line, start: s };
    }
    if (!best) {
      uncovered.push({ jobKey: job.key, areaId: job.area.id, title: job.title, minutes: job.minutes, reason: 'Not enough cleaner time today' });
      continue;
    }
    const end = best.start + job.minutes;
    const t = blank(best.line.person.crewId, 'work', job.title, best.start, end, {
      areaId: job.area.id,
      jobKey: job.key,
      part: job.part,
      size: Math.round(job.size * 10) / 10,
      late: end > job.deadline,
      note: job.area.quality,
    });
    tasks.push(t);
    placedWork.push(t);
    best.line.free = end;
    best.line.lastAreaId = job.area.id;
    best.line.workMin += job.minutes;
  }
  // Ids are stable for the same plan: date, person and start.
  const idOf = (t: CleaningTask, i: number) => `ct-${date.replace(/-/g, '')}-${t.crewId}-${t.start.replace(':', '')}-${t.type}-${i}`;
  tasks.forEach((t, i) => {
    if (!t.id) t.id = idOf(t, i);
  });
  // The supervisor checks each finished job, in the order they finish, spread across supervisors.
  const supLines = [...lines.values()].filter((l) => l.person.role === 'supervisor');
  if (supLines.length) {
    const always = site.areas.filter((a) => a.frequency.kind === 'always');
    // Rounds of the "always" items first, so checks fit around them.
    if (always.length) {
      const names = always.map((a) => a.name).join('; ');
      supLines.forEach((line, si) => {
        for (let t = line.start + R.briefingMin + 60 + si * 30; t + R.roundMin <= line.end; t += R.roundEveryMin) {
          if (from !== null && t < from) continue;
          const s = fit(line, t, R.roundMin);
          if (s === null || s !== t) continue;
          tasks.push(blank(line.person.crewId, 'round', `Round: ${names}`, s, s + R.roundMin, { id: `ct-${date.replace(/-/g, '')}-${line.person.crewId}-round-${s}`, note: 'Check every item holds all the time' }));
        }
      });
    }
    const busy = (crewId: Id) =>
      tasks.filter((t) => t.crewId === crewId && t.type !== 'break' && t.status !== 'not_needed').map((t) => [toMin(t.start), toMin(t.end)] as const);
    const overlaps = (crewId: Id, s: number, e: number) => busy(crewId).some(([a, b]) => s < b && e > a);
    // End of day report to the OM: its slot is kept before the checks are placed.
    for (const line of supLines) {
      const s = line.end - R.reportMin;
      if (from !== null && s < from) continue;
      if (!overlaps(line.person.crewId, s, line.end))
        tasks.push(blank(line.person.crewId, 'report', 'End of day report to the OM', s, line.end, { id: `ct-${date.replace(/-/g, '')}-${line.person.crewId}-report` }));
    }
    for (const w of [...placedWork].sort((a, b) => a.end.localeCompare(b.end))) {
      if (keptChecks.has(w.id)) continue;
      let placed = false;
      for (const line of [...supLines].sort((a, b) => a.workMin - b.workMin)) {
        let s = fit(line, Math.max(toMin(w.end), from ?? 0), R.inspectMin);
        while (s !== null && overlaps(line.person.crewId, s, s + R.inspectMin)) s = fit(line, s + 5, R.inspectMin);
        if (s === null) continue;
        tasks.push(
          blank(line.person.crewId, 'inspect', `Check: ${w.title}`, s, s + R.inspectMin, {
            id: `ct-${date.replace(/-/g, '')}-${line.person.crewId}-check-${w.id}`,
            areaId: w.areaId,
            checksTaskId: w.id,
            note: w.note,
          }),
        );
        line.workMin += R.inspectMin;
        placed = true;
        break;
      }
      if (!placed) uncovered.push({ jobKey: `check:${w.jobKey}`, areaId: w.areaId ?? '', title: `Supervisor check: ${w.title}`, minutes: R.inspectMin, reason: 'Not enough supervisor time today' });
    }
  } else if (placedWork.length) {
    uncovered.push({ jobKey: 'supervisor', areaId: '', title: 'Supervisor checks', minutes: placedWork.length * R.inspectMin, reason: 'No supervisor present: the OM must check or send cover' });
  }
  tasks.sort((a, b) => a.crewId.localeCompare(b.crewId) || a.start.localeCompare(b.start) || a.type.localeCompare(b.type));
  const workMinutes = dueJobs(site, date, hours).reduce((n, j) => n + j.minutes, 0);
  const avail = (l: Timeline) => l.end - l.start - (l.breakEnd - l.breakStart) - (l.start === toMin(hours.start) ? R.briefingMin : 0);
  const availableMinutes = cleanerLines.reduce((n, l) => n + avail(l), 0);
  const perCleaner = Math.max(1, toMin(hours.end) - toMin(hours.start) - hours.breakMin - R.briefingMin);
  // Movement between areas costs time too; count it in the need.
  const cleanersNeeded = Math.ceil((workMinutes + jobsMoves(dueJobs(site, date, hours), R.moveMin)) / perCleaner);
  const headcountShort = Math.max(0, site.requiredHeadcount - cleaners.length - supervisors.length);
  return {
    hours,
    tasks,
    uncovered,
    watchList,
    summary: {
      ...summaryBase,
      headcountShort,
      deductionEstimate: site.monthlyWage && headcountShort ? Math.round((site.monthlyWage / R.deductionDays) * headcountShort * 100) / 100 : null,
      workMinutes,
      availableMinutes,
      uncoveredMinutes: uncovered.reduce((n, u) => n + u.minutes, 0),
      cleanersNeeded,
    },
  };
}

function jobsMoves(jobs: CleaningJob[], moveMin: number): number {
  return Math.max(0, jobs.length - 1) * moveMin;
}

/** The task a person should be doing at a time of day (HH:MM), and the next one. */
export function nowAndNext(tasks: CleaningTask[], crewId: Id, at: string): { now: CleaningTask | null; next: CleaningTask | null } {
  const mine = tasks.filter((t) => t.crewId === crewId).sort((a, b) => a.start.localeCompare(b.start));
  const now = mine.find((t) => t.start <= at && at < t.end) ?? null;
  const next = mine.find((t) => t.start > at) ?? null;
  return { now, next };
}

/** Problems with a set-up that stop a good plan, in plain words for the OM. */
export function setupProblems(site: CleaningSite): string[] {
  const out: string[] = [];
  const cleaners = site.crew.filter((c) => c.role === 'cleaner');
  if (!site.crew.some((c) => c.role === 'supervisor')) out.push('No cleaning supervisor in the crew.');
  if (!cleaners.length) out.push('No cleaners in the crew.');
  if (site.crew.length < site.requiredHeadcount)
    out.push(`The contract needs ${site.requiredHeadcount} workers on site; the crew has ${site.crew.length}.`);
  if (site.secondSession && cleaners.length) {
    const s1 = site.crew.filter((c) => c.session === 1).length;
    const want = Math.round(site.crew.length * 0.6);
    if (s1 !== want) out.push(`Two-session school: the contract splits the crew 60:40, so ${want} in session 1; now ${s1}.`);
  }
  const unsized = site.areas.filter((a) => a.frequency.kind !== 'always' && a.frequency.kind !== 'as_needed' && !(a.size > 0));
  if (unsized.length) out.push(`Measure ${unsized.length} area${unsized.length === 1 ? '' : 's'} (size 0 is left out of the plan): ${unsized.map((a) => a.name).join('; ')}.`);
  if (!site.map) out.push('Upload the site map so cleaners can see where each area is.');
  return out;
}

// ---------- Supplies and equipment ----------

export type SupplyFlag = 'over_use' | 'under_use' | 'reorder' | 'short_delivery' | 'no_check' | 'ok';

export interface SupplyStatus {
  supply: CleaningSupply;
  onHand: number | null;
  lastCheck: IsoDate | null;
  /** Use between the last two checks, worked out from counts and deliveries received in between. */
  used: number | null;
  /** Budget for the same days: perDay x working days. */
  budget: number | null;
  usePct: number | null;
  /** Sent minus received over all deliveries in the window. */
  shortDelivered: number;
  daysLeft: number | null;
  flags: SupplyFlag[];
}

export interface EquipmentStatus {
  equipment: CleaningEquipment;
  working: number | null;
  broken: number | null;
  /** Required minus working; positive is missing. */
  missing: number | null;
  lastCheck: IsoDate | null;
}

/**
 * Supplies and equipment at a site from its stock entries: usage between the last two checks against the budget,
 * short deliveries, days left, and equipment short of the contract. Deliveries count once the supervisor received them.
 */
export function stockStatus(
  site: Pick<CleaningSite, 'supplies' | 'equipment' | 'week' | 'closedDays'>,
  entries: CleaningStockEntry[],
): { supplies: SupplyStatus[]; equipment: EquipmentStatus[]; pendingDeliveries: CleaningStockEntry[] } {
  const R = CLEANING_STOCK_RULES;
  const checks = entries.filter((e) => e.kind === 'check').sort((a, b) => a.at.localeCompare(b.at));
  const deliveries = entries.filter((e) => e.kind === 'delivery').sort((a, b) => a.at.localeCompare(b.at));
  const last = checks.at(-1) ?? null;
  const prev = checks.at(-2) ?? null;
  const supplies = site.supplies.map((sup): SupplyStatus => {
    const count = (e: CleaningStockEntry | null) => e?.supplies.find((x) => x.supplyId === sup.id)?.counted ?? null;
    const onHand = count(last);
    let used: number | null = null;
    let budget: number | null = null;
    const p = count(prev);
    if (last && prev && onHand !== null && p !== null) {
      const received = deliveries
        .filter((d) => d.received && d.received.at > prev.at && d.received.at <= last.at)
        .reduce((n, d) => n + (d.supplies.find((x) => x.supplyId === sup.id)?.counted ?? 0), 0);
      used = Math.max(0, p + received - onHand);
      const days = workingDaysBetween(site, addDays(prev.date, 1), last.date).length;
      budget = Math.round(sup.perDay * days * 100) / 100;
    }
    const shortDelivered = deliveries
      .filter((d) => d.received)
      .reduce((n, d) => {
        const x = d.supplies.find((y) => y.supplyId === sup.id);
        return n + Math.max(0, (x?.sent ?? 0) - (x?.counted ?? 0));
      }, 0);
    const usePct = used !== null && budget ? Math.round((used / budget) * 100) : null;
    const daysLeft = onHand !== null && sup.perDay > 0 ? Math.floor(onHand / sup.perDay) : null;
    const flags: SupplyFlag[] = [];
    if (!last) flags.push('no_check');
    if (usePct !== null && usePct > R.overUsePct) flags.push('over_use');
    if (usePct !== null && usePct < R.underUsePct) flags.push('under_use');
    if (daysLeft !== null && daysLeft < R.reorderDays) flags.push('reorder');
    if (shortDelivered > 0) flags.push('short_delivery');
    if (!flags.length) flags.push('ok');
    return { supply: sup, onHand, lastCheck: last?.date ?? null, used, budget, usePct, shortDelivered, daysLeft, flags };
  });
  const lastEq = [...checks].reverse().find((c) => c.equipment.length) ?? null;
  const equipment = site.equipment.map((eq): EquipmentStatus => {
    const x = lastEq?.equipment.find((y) => y.equipmentId === eq.id);
    const working = x?.working ?? null;
    return { equipment: eq, working, broken: x?.broken ?? null, missing: working === null ? null : Math.max(0, eq.required - working), lastCheck: lastEq?.date ?? null };
  });
  return { supplies, equipment, pendingDeliveries: deliveries.filter((d) => !d.received) };
}

/** KPM school equipment (Lampiran A3 B) and common supplies, as a starting list the OM edits. Quantities start at the contract's minimum where it gives one. */
export function kpmSchoolStock(): { equipment: CleaningEquipment[]; supplies: CleaningSupply[] } {
  const eq = (id: string, name: string, required: number): CleaningEquipment => ({ id, name, required });
  const su = (id: string, name: string, unit: string, perDay: number): CleaningSupply => ({ id, name, unit, perDay, approvedBrands: '' });
  return {
    equipment: [
      eq('vacuum', 'Vacuum cleaner', 1),
      eq('broom-set', 'Broom and dustpan set', 2),
      eq('mop-set', 'Mop set', 2),
      eq('grass-cutter', 'Grass cutter', 1),
      eq('pruner', 'Shears or sickle', 1),
      eq('barrow', 'Wheelbarrow', 1),
      eq('hoe', 'Hoe', 1),
      eq('drain-scoop', 'Drain scoop', 1),
      eq('hose', 'Garden hose (over 20 m)', 2),
    ],
    supplies: [
      su('floor-cleaner', 'Floor cleaner', 'litre', 0),
      su('toilet-cleaner', 'Toilet bowl cleaner', 'litre', 0),
      su('hand-soap', 'Antiseptic hand soap', 'litre', 0),
      su('tissue', 'Toilet roll', 'roll', 0),
      su('bags', 'Rubbish bags', 'piece', 0),
      su('freshener', 'Toilet freshener', 'can', 0),
    ],
  };
}