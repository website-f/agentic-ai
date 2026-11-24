// Part P (Fitri package, FWM papers S1-S7 and T1-T3, Fauzan 13-14 Nov 2026): foreign worker hostel / work site moves
// (form BPPS/HOSTEL/FWM/001/2026), hostel needs (form BPPK/HOSTEL/FWM/001/2026), hostel inventory and checks (BRI),
// damage / loss (BKK), maintenance (BP) and the monthly visit report (BRB). The service checks who may act on every
// call; the screens only show what the service allows. Made-up data only in tests.
import { actsAsOpsDirector, isOgm, isOpsDirector } from './ops-access';
import { AccessDenied, isGroupLeader } from "./access";
import { BadRequest, NotFound } from "./service";
import type { PrimaService } from "./service";
import type { Store } from "./store";
import { addDays, daysBetween } from "./time";
import type { Credential, Hostel, HostelStay, Id, IsoDate, IsoDateTime, Person, Site, User } from "./types";
import { registerWall } from "./walls";
import { sha256Hex } from "./audit";

// ---------- Settings (FWM keeps them; defaults from the papers) ----------

export interface FwHostelSettings {
  id: 'fw-hostel';
  /** Working days a move must be raised ahead; less needs "urgent" with a reason (S4). */
  moveLeadWorkingDays: number;
  /** Reminder timeframes in working days (S2 sec. 7, T2): PIC agreements, FWM check, HQ + Ketua Operasi. */
  moveStepDays: { pic: number; fwm: number; approve: number };
  /** Hours after Receive before FWM is reminded / the OD or OGM is told (P6). */
  closeRemindHours: number;
  closeEscalateHours: number;
  /** Check frequencies in days (P14): weekly, monthly, 6-monthly audit, FWM sweep. */
  checkDays: { weekly: number; monthly: number; audit: number; sweep: number };
  /** Damage report deadline to FWM, hours (T3 circular 24 h). */
  damageReportHours: number;
  /** Maintenance response targets, days (P16). */
  maintDays: { critical: number; normal: number };
  /** Hostel needs timeframes, days (P8 change, T1). */
  needDays: { fwmCheck: number; approve: number; buy: number; receipt: number };
  /** Penalty price list (T3 sec. 10), RM, from a date; "current price" items are entered by FWM with a receipt. */
  prices: { from: IsoDate; items: Record<string, number>; by: string; reason: string }[];
  /** Days to pay a penalty before the written notice (default: about the next pay cut-off). */
  penaltyPayDays: number;
  /** V5 (Part V, 14 Nov 2026): working days from the last approval to the move done (received); +1 more tells the OD / OGM. */
  moveDoneWorkingDays?: number;
  history: { at: IsoDateTime; by: string; what: string }[];
}

export const FW_HOSTEL_DEFAULTS: Omit<FwHostelSettings, 'history'> = {
  id: 'fw-hostel',
  moveLeadWorkingDays: 3,
  moveStepDays: { pic: 1, fwm: 1, approve: 1 },
  closeRemindHours: 24,
  closeEscalateHours: 48,
  checkDays: { weekly: 7, monthly: 30, audit: 182, sweep: 90 },
  damageReportHours: 24,
  maintDays: { critical: 1, normal: 3 },
  needDays: { fwmCheck: 1, approve: 2, buy: 7, receipt: 1 },
  // T3 sec. 10 / policy 8 (FWM, 2 Oct 2026). Effective from the policy start date (Fauzan, P-I).
  prices: [{ from: '2026-10-02', items: { 'Room / locker key': 30, 'Single mattress': 250, 'Single steel bed': 200, 'Locker / wardrobe': 200, Fan: 120, 'Plastic chair': 30 }, by: 'FWM policy FWM/POLISI/INVENTORIHOSTEL/DATA/2026/001', reason: 'T3 price list' }],
  penaltyPayDays: 14,
  moveDoneWorkingDays: 3,
};

/** V7 (Part V, FWM briefing 21 Oct 2026): why a hostel needs request is refused (pick one; "other" needs text). */
export const HOSTEL_NEED_REJECT_REASONS = {
  FORM_INCOMPLETE: 'Borang tidak lengkap',
  NOT_JUSTIFIED: 'Alasan tidak wajar',
  WRONG_DETAILS: 'Maklumat salah',
  AGAINST_POLICY: 'Bercanggah dengan polisi',
  NO_BUDGET: 'Tiada bajet',
  OTHER: 'Lain-lain',
} as const;
export type HostelNeedRejectReason = keyof typeof HOSTEL_NEED_REJECT_REASONS;

// ---------- Records ----------

export type FwMoveReason = 'SITE_CHANGE' | 'HOSTEL_NEED' | 'COMPANY_INSTRUCTION' | 'OPERATIONS' | 'HOSTEL_CLOSING' | 'RULE_BREACH';
export const FW_MOVE_REASONS: Record<FwMoveReason, { ms: string; en: string }> = {
  SITE_CHANGE: { ms: 'Pertukaran site kerja', en: 'Change of work site' },
  HOSTEL_NEED: { ms: 'Pertukaran / keperluan hostel', en: 'Change or need of hostel' },
  COMPANY_INSTRUCTION: { ms: 'Arahan syarikat', en: 'Company instruction' },
  OPERATIONS: { ms: 'Keperluan operasi / site baharu', en: 'Operations or new site needs' },
  HOSTEL_CLOSING: { ms: 'Hostel ditutup', en: 'Hostel closing' },
  RULE_BREACH: { ms: 'Melanggar peraturan hostel', en: 'Breach of hostel rules' },
};

export type FwMoveStep = 'originPic' | 'newPic' | 'fwm' | 'hq' | 'ketua';
export const FW_MOVE_STEP_LABEL: Record<FwMoveStep, string> = {
  originPic: 'PIC origin site agrees to release',
  newPic: 'PIC new site agrees to take',
  fwm: 'FWM checks',
  hq: 'Company head approves (HQ)',
  ketua: 'Ketua Operasi approves (OD / OGM)',
};

export interface FwSign {
  by: string;
  byId: Id;
  at: IsoDateTime;
  note: string;
  /** The OM's own submit covered this step (no second click). */
  bySubmit?: boolean;
}

export interface FwMoveWorker {
  personId: Id;
  name: string;
  staffNo: string;
  employerCompanyId: Id;
  fromSiteId: Id | null;
  fromHostelId: Id | null;
  job: string;
}

export interface FwMove {
  id: Id;
  /** The form code staff recognise. */
  form: 'BPPS/HOSTEL/FWM/001/2026';
  /** The employer (permit company) of the workers; the wall is on this and the new site's company. */
  companyId: Id;
  newCompanyId: Id;
  newArrival: boolean;
  workers: FwMoveWorker[];
  originPicId: Id | null;
  newPicId: Id;
  toSiteId: Id;
  toJob: string;
  toHostelId: Id | null;
  leaveHostelOn: IsoDate | null;
  startOn: IsoDate;
  reason: FwMoveReason;
  justification: string;
  urgent: { reason: string } | null;
  type: 'HOSTEL' | 'SITE' | 'BOTH' | 'ARRIVAL';
  warnings: string[];
  raisedBy: string;
  raisedById: Id;
  raisedAt: IsoDateTime;
  status: 'submitted' | 'returned' | 'rejected' | 'approved' | 'released' | 'moved' | 'received' | 'closed' | 'cancelled';
  steps: Partial<Record<FwMoveStep, FwSign>>;
  /** Earlier rounds when FWM returned the request for correction (S4). */
  rounds: { returnedBy: string; at: IsoDateTime; reason: string; steps: Partial<Record<FwMoveStep, FwSign>> }[];
  rejected: (FwSign & { step: FwMoveStep }) | null;
  release: (FwSign & { attendanceChecked: boolean; itemsReturned: string[]; roomChecked: boolean; gaps: { item: string; note: string; personId: Id | null }[]; damageIds: Id[] }) | null;
  transit: (FwSign & { transport: string; on: IsoDate; carries: string[] }) | null;
  receive: (FwSign & { arrived: boolean; identity: 'face' | 'card'; briefing: boolean; room: string | null; gaps: { item: string; note: string; personId: Id | null }[]; stayIds: Id[]; damageIds: Id[] }) | null;
  close: (FwSign & { jaRef: string; headcountOk: boolean; documentsKept: boolean }) | null;
  /** Company head of the employer told when the new site is another company's (no extra step). */
  employerNoticeTo: Id | null;
  cancelled: (FwSign) | null;
  /** Workers whose passport or permit copy FWM has not filed (FWM's task, never the OM's). */
  papersToFile?: Id[];
}

export type HostelNeedReason = 'REPLACE_DAMAGED' | 'MORE_WORKERS' | 'VERIFIED_LOSS' | 'AUDIT' | 'MANAGEMENT' | 'TOO_OLD' | 'OTHER';
export const HOSTEL_NEED_REASONS: Record<HostelNeedReason, { ms: string; en: string }> = {
  REPLACE_DAMAGED: { ms: 'Ganti barang rosak', en: 'Replace damaged items' },
  MORE_WORKERS: { ms: 'Pertambahan pekerja', en: 'More workers' },
  VERIFIED_LOSS: { ms: 'Kehilangan yang disahkan', en: 'Verified loss' },
  AUDIT: { ms: 'Keperluan audit', en: 'Audit requirement' },
  MANAGEMENT: { ms: 'Arahan pengurusan', en: 'Management instruction' },
  TOO_OLD: { ms: 'Barang terlalu lama / perlu dilupuskan', en: 'Items too old / need disposal' },
  OTHER: { ms: 'Lain-lain', en: 'Other' },
};

export interface HostelNeed {
  id: Id;
  form: 'BPPK/HOSTEL/FWM/001/2026';
  companyId: Id;
  hostelId: Id;
  /** Copied so Asset Management sees the hostel by name and address only (no residents, no bills). */
  hostelName: string;
  hostelAddress: string;
  sector: 'private' | 'government';
  items: { name: string; qty: number; kind: 'item' | 'repair' }[];
  reason: HostelNeedReason;
  justification: string;
  neededBy: IsoDate;
  quotes: { name: string; sha256: string; data: string }[];
  /** What the OM saw when asking (P8): residents, beds, items in good condition, open findings. */
  seen: { residents: number; beds: number; goodItems: Record<string, number>; openFindings: number };
  /** Where it came from: an OM request, or FWM's decision on a damage report (P15 replace). */
  fromDamageId: Id | null;
  raisedBy: string;
  raisedById: Id;
  raisedAt: IsoDateTime;
  status: 'submitted' | 'returned' | 'fwm_checked' | 'approved' | 'rejected' | 'ordered' | 'delivered' | 'received';
  fwm: FwSign | null;
  decision: (FwSign & { approve: boolean }) | null;
  returns: { by: string; at: IsoDateTime; reason: string }[];
  /** Asset Management's links: one purchase request (items) and/or one work order (repairs). */
  amAssetId: Id | null;
  amWorkOrderId: Id | null;
  delivered: (FwSign & { on: IsoDate }) | null;
  received: (FwSign & { photo: string }) | null;
}

export interface HostelItemLine {
  name: string;
  area: string;
  qty: number;
  good: number;
  damaged: number;
  missing: number;
}

/** The hostel's inventory list (P7). Changed only by a verified count, a received need, a closed damage report, a Part U disposal case or a move. */
export interface HostelInventory {
  id: Id;
  kind: 'inventory';
  companyId: Id;
  hostelId: Id;
  lines: HostelItemLine[];
  history: { at: IsoDateTime; by: string; source: 'count' | 'need' | 'damage' | 'disposal' | 'move'; ref: Id; what: string }[];
}

export interface HostelCheck {
  id: Id;
  kind: 'check';
  companyId: Id;
  hostelId: Id;
  freq: 'weekly' | 'monthly' | 'audit' | 'sweep';
  on: IsoDate;
  ticks: Record<string, boolean>;
  note: string;
  photos: { sha256: string; data: string }[];
  /** The hostel supervisor named as the one who reported, when the OM records for him (P13). */
  reportedById: Id | null;
  by: string;
  byId: Id;
  at: IsoDateTime;
  /** Monthly visit report (BRB): figures at the time. */
  report: { residents: number; beds: number; lines: number; damaged: number; missing: number; openDamage: number; openMaint: number } | null;
}

export interface HostelCount {
  id: Id;
  kind: 'count';
  form: 'BRI/HOSTEL/FWM001/2026';
  companyId: Id;
  hostelId: Id;
  openedBy: string;
  openedById: Id;
  openedAt: IsoDateTime;
  lines: (HostelItemLine & { note: string; photo: string | null })[];
  countedBy: string | null;
  countedById: Id | null;
  countedAt: IsoDateTime | null;
  status: 'open' | 'counted' | 'verified';
  verified: FwSign | null;
  /** The company head's one-tap acknowledgement (not an approval, never blocks). */
  ack: FwSign | null;
}

export type DamageCause = 'WEAR' | 'ACCIDENT' | 'NEGLIGENCE' | 'MISUSE' | 'VANDALISM' | 'UNKNOWN';
export type DamageAction = 'replace' | 'repair' | 'dispose' | 'discipline' | 'none';

export interface HostelPenalty {
  personId: Id;
  item: string;
  amount: number;
  priceFrom: string;
  dueOn: IsoDate;
  status: 'due' | 'paid' | 'notice' | 'deduction_asked' | 'deduction_approved' | 'deduction_refused';
  paid: (FwSign & { slip: string; amount: number }) | null;
  notice: FwSign | null;
  ask: FwSign | null;
  hr: (FwSign & { decision: 'approve' | 'reduce' | 'spread' | 'refuse'; amount: number; months: number; flags: string[] }) | null;
}

export interface HostelDamage {
  id: Id;
  kind: 'damage';
  form: 'BKK/HOSTEL/KEROSAKAN/FWM/001/2026';
  companyId: Id;
  hostelId: Id;
  lines: { item: string; qty: number }[];
  workerIds: Id[];
  cause: DamageCause;
  suggested: DamageAction;
  note: string;
  photos: { sha256: string; data: string }[];
  reportedById: Id | null;
  by: string;
  byId: Id;
  at: IsoDateTime;
  /** Found on a move (release / receive), a check, or reported any time. */
  source: 'report' | 'move' | 'check';
  status: 'reported' | 'decided' | 'closed';
  decision: (FwSign & { action: DamageAction; negligenceBy: Id | null; finding: string }) | null;
  penalty: HostelPenalty | null;
  links: { needId?: Id; maintId?: Id; disposalRef?: string; hrCaseRef?: string };
  closed: FwSign | null;
}

export interface HostelMaint {
  id: Id;
  kind: 'maint';
  form: 'BP/HOSTEL/MAINT/FWM/001/2026';
  companyId: Id;
  hostelId: Id;
  hostelName: string;
  hostelAddress: string;
  sector: 'private' | 'government';
  what: string;
  critical: boolean;
  costBy: 'company' | 'landlord' | 'other';
  before: { sha256: string; data: string }[];
  quotes: { contractor: string; amount: number; doc: string }[];
  residents: number;
  reportedById: Id | null;
  by: string;
  byId: Id;
  at: IsoDateTime;
  dueOn: IsoDate;
  status: 'reported' | 'fwm_checked' | 'approved' | 'rejected' | 'ordered' | 'landlord' | 'done' | 'closed';
  fwm: FwSign | null;
  decision: (FwSign & { approve: boolean }) | null;
  /** Critical repairs skip the OD/OGM step; the OD/OGM is told at once. */
  toldAt: IsoDateTime | null;
  workOrderId: Id | null;
  /** Two quotes only with the Asset Director's reason on the work order. */
  twoQuotesReason: string | null;
  contractorNotice: (FwSign & { contractor: string; on: IsoDate }) | null;
  landlordDueOn: IsoDate | null;
  done: (FwSign & { after: { sha256: string; data: string }[] }) | null;
}

export type HostelRec = HostelInventory | HostelCheck | HostelCount | HostelDamage | HostelMaint;

// ---------- Who is who ----------

export type FwHostelRole = 'fwm' | 'om' | 'company' | 'sector' | 'coo' | 'leader' | 'act' | 'asset';

/** P9: FWM (not despatch), the OM, the company head / admin exec, OD / OGM, the COO, group leaders, ACT (read), Asset Management (needs only). */
export function fwHostelRole(user: User): FwHostelRole | null {
  if (user.integration) return null;
  if (user.department === 'fwm' && user.fwmRole !== 'despatch') return 'fwm';
  if (user.opsTier === 'om') return 'om';
  if (user.role === 'company_manager' || user.role === 'admin_exec') return 'company';
  if (isOpsDirector(user) || isOgm(user)) return 'sector';
  if (user.opsTier === 'coo' || user.opsTier === 'ceo') return 'coo';
  if (isGroupLeader(user)) return 'leader';
  if (user.department === 'audit') return 'act';
  if (user.department === 'asset') return 'asset';
  return null;
}
registerWall('fw_hostel', (u) => {
  const r = fwHostelRole(u);
  return r === 'fwm' || r === 'coo' || r === 'leader' || r === 'act';
});
registerWall('hostel_need_am', (u) => fwHostelRole(u) === 'asset');

// ---------- Pure helpers ----------

const photoRe = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/;
export function photoList(raw: unknown, min: number, what: string, max = 6): { sha256: string; data: string }[] {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length < min) throw new BadRequest(min === 1 ? `Add a photo (${what}).` : `Add at least ${min} photos (${what}).`);
  if (list.length > max) throw new BadRequest(`At most ${max} photos.`);
  return list.map((p) => {
    const data = String(p ?? '');
    if (!photoRe.test(data)) throw new BadRequest('Take the photo with the app camera (JPEG or PNG).');
    if (data.length > 2_000_000) throw new BadRequest('A photo is too large.');
    return { sha256: sha256Hex(data), data };
  });
}

const txt = (v: unknown, what: string, min = 3, max = 500) => {
  const s = String(v ?? '').trim();
  if (s.length < min) throw new BadRequest(`${what}: write at least ${min} characters.`);
  return s.slice(0, max);
};
const isDate = (v: unknown): v is IsoDate => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** V5: an approved move not yet received after the target working days (late), and one day more (tell the OD / OGM). */
export function moveDoneLate(m: Pick<FwMove, 'status' | 'steps'>, today: IsoDate, target: number, holidays: Set<IsoDate>): { days: number; target: number; escalate: boolean } | null {
  if (!['approved', 'released', 'moved'].includes(m.status)) return null;
  const last = Object.values(m.steps).map((x) => x?.at ?? '').sort().at(-1);
  if (!last) return null;
  const days = workingDaysUntil(last.slice(0, 10), today, holidays);
  return days > target ? { days, target, escalate: days > target + 1 } : null;
}

/** Working days from today until a date: weekends and the company's public holidays are not counted. */
export function workingDaysUntil(today: IsoDate, on: IsoDate, holidays: Set<IsoDate>): number {
  let n = 0;
  for (let d = addDays(today, 1); d <= on; d = addDays(d, 1)) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6 && !holidays.has(d)) n++;
  }
  return n;
}

/** The working day N working days after a date (for reminders). */
export function addWorkingDaysExcept(from: IsoDate, n: number, holidays: Set<IsoDate>): IsoDate {
  let d = from;
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6 && !holidays.has(d)) left--;
  }
  return d;
}

export type PaperState = 'valid' | 'expiring' | 'expired' | 'missing';
export function paperState(c: Credential | undefined, on: IsoDate): PaperState {
  if (!c) return 'missing';
  if (c.expiresOn && c.expiresOn < on) return 'expired';
  if (c.expiresOn && daysBetween(on, c.expiresOn) <= 30) return 'expiring';
  return 'valid';
}

/** The warnings shown on a move (never a block, except "urgent" needs a reason). */
export function moveWarnings(i: {
  leadDays: number;
  workingDays: number;
  otherCompany: { employer: string; site: string } | null;
  papers: { name: string; permit: PaperState; passport: PaperState }[];
  hostelFull: { name: string; residents: number; beds: number } | null;
  cert: 'missing' | 'expired' | 'ok' | null;
}): string[] {
  const out: string[] = [];
  if (i.workingDays < i.leadDays) out.push(`Starts in ${i.workingDays} working day(s), less than ${i.leadDays}: urgent`);
  if (i.otherCompany) out.push(`Works at ${i.otherCompany.site} site, employer stays ${i.otherCompany.employer}`);
  for (const p of i.papers) {
    if (p.permit !== 'valid') out.push(`${p.name}: permit ${p.permit}`);
    if (p.passport !== 'valid') out.push(`${p.name}: passport ${p.passport}`);
  }
  if (i.hostelFull) out.push(`${i.hostelFull.name} full on the move date (${i.hostelFull.residents} of ${i.hostelFull.beds} beds)`);
  if (i.cert === 'missing') out.push('New hostel has no accommodation certificate on record');
  if (i.cert === 'expired') out.push('New hostel accommodation certificate has expired');
  return out;
}

/** The price of an item on a date from FWM's price list (P15); null when the item has no listed price. */
export function priceOn(prices: FwHostelSettings['prices'], item: string, on: IsoDate): { amount: number; from: IsoDate } | null {
  const list = prices.filter((p) => p.from <= on).sort((a, b) => a.from.localeCompare(b.from)).at(-1);
  const amount = list?.items[item];
  return list && amount != null ? { amount, from: list.from } : null;
}

/** Employment Act 1955 s.24 flags shown to HR on a deduction; never a refusal. */
export function deductionFlags(amount: number, monthlyWage: number | null, otherDeductions: number): string[] {
  const out = ['Employment Act 1955 s.24(4): a damage deduction generally needs the worker’s written agreement or the Labour Director General’s permission.'];
  if (monthlyWage != null && amount + otherDeductions > monthlyWage * 0.5) out.push('s.24(8): all deductions this month would pass 50% of wages.');
  return out;
}

// ---------- The service ----------

export class FwMoveService {
  constructor(
    private store: Store,
    private svc: PrimaService,
  ) {}

  private now() {
    return this.svc.now();
  }
  private today() {
    return this.svc.today();
  }

  private async installed(t: 'fwMoves' | 'hostelNeeds' | 'hostelRecs') {
    return !this.store.hasTable || (await this.store.hasTable(t));
  }
  private async need(t: 'fwMoves' | 'hostelNeeds' | 'hostelRecs') {
    if (!(await this.installed(t))) throw new BadRequest('Hostel moves and needs are not installed in this database yet (module fw-moves-v1, run by the CEO).');
  }

  async settings(): Promise<FwHostelSettings> {
    const row = (await this.installed('hostelRecs')) ? ((await this.store.get('hostelRecs', 'fw-hostel')) as unknown as FwHostelSettings | null) : null;
    return { ...FW_HOSTEL_DEFAULTS, history: [], ...(row ?? {}) };
  }

  /** FWM changes the timeframes, check frequencies or the price list, with a reason (no fixed values in the code). */
  async setSettings(user: User, patch: Partial<Omit<FwHostelSettings, 'id' | 'history'>>, reason: string) {
    if (fwHostelRole(user) !== 'fwm') throw new AccessDenied('hr.monitor', '(FWM keeps the hostel settings)');
    const why = txt(reason, 'Reason');
    await this.need('hostelRecs');
    const at = this.now();
    const cur = await this.settings();
    const next: FwHostelSettings = { ...cur };
    const nums = (o: Record<string, unknown> | undefined, base: Record<string, number>) => {
      if (!o) return base;
      const out = { ...base };
      for (const [k, v] of Object.entries(o)) {
        if (!(k in base)) continue;
        const n = Number(v);
        if (!(n >= 0 && n <= 400)) throw new BadRequest(`${k}: 0 to 400.`);
        out[k] = n;
      }
      return out;
    };
    if (patch.moveLeadWorkingDays != null) next.moveLeadWorkingDays = Math.max(0, Math.min(30, Math.round(Number(patch.moveLeadWorkingDays))));
    next.moveStepDays = nums(patch.moveStepDays as never, cur.moveStepDays) as FwHostelSettings['moveStepDays'];
    next.checkDays = nums(patch.checkDays as never, cur.checkDays) as FwHostelSettings['checkDays'];
    next.maintDays = nums(patch.maintDays as never, cur.maintDays) as FwHostelSettings['maintDays'];
    next.needDays = nums(patch.needDays as never, cur.needDays) as FwHostelSettings['needDays'];
    if (patch.moveDoneWorkingDays != null) next.moveDoneWorkingDays = Math.max(1, Math.min(30, Math.round(Number(patch.moveDoneWorkingDays))));
    if (patch.penaltyPayDays != null) next.penaltyPayDays = Math.max(1, Math.min(60, Math.round(Number(patch.penaltyPayDays))));
    if (patch.prices) {
      const p = (patch.prices as FwHostelSettings['prices']).at(-1);
      if (!p || !isDate(p.from)) throw new BadRequest('Price list: give the date it applies from.');
      const items: Record<string, number> = {};
      for (const [k, v] of Object.entries(p.items ?? {})) {
        const n = Math.round(Number(v) * 100) / 100;
        if (!k.trim() || !(n >= 0)) throw new BadRequest('Price list: each item needs a name and a price in RM.');
        items[k.trim().slice(0, 60)] = n;
      }
      next.prices = [...cur.prices.filter((x) => x.from !== p.from), { from: p.from, items, by: user.name, reason: why }];
    }
    next.history = [...cur.history, { at, by: user.name, what: why }].slice(-50);
    await this.store.transaction(async (tx) => {
      const old = await tx.get('hostelRecs', 'fw-hostel');
      const { id: _id, ...rest } = next;
      if (old) await tx.update('hostelRecs', 'fw-hostel', rest as never);
      else await tx.insert('hostelRecs', { ...next, companyId: null } as never);
      await tx.audit({ at, actor: user.name, companyId: null, action: 'fw.hostel_settings', entity: 'fw_hostel_settings', entityId: 'fw-hostel', summary: `Hostel settings changed: ${why}` });
    });
    return next;
  }

  private async companies(user: User): Promise<Id[]> {
    return this.svc.visibleCompanyIdsOf(user);
  }

  private omSites(user: User): Promise<Set<Id>> {
    return this.svc.omSiteIdsOf(user);
  }

  private async holidays(companyId: Id, years: number[]): Promise<Set<IsoDate>> {
    const lists = await this.store.list('publicHolidayLists', { companyId: [companyId] }).catch(() => []);
    const out = new Set<IsoDate>();
    for (const l of lists) if (years.includes(l.year) && !l.replacedBy) for (const d of l.days ?? []) out.add(d.date);
    return out;
  }

  /** The site a worker works at now: from the person's record (set on Receive), else the latest shift in 60 days. */
  private async currentSite(p: Person): Promise<Id | null> {
    if (p.workSiteId) return p.workSiteId;
    const shifts = (await this.store.list('shifts', { companyId: [p.companyId], personId: p.id }).catch(() => [])).filter((s) => s.date >= addDays(this.today(), -60));
    return shifts.sort((a, b) => b.date.localeCompare(a.date))[0]?.siteId ?? null;
  }

  private openStay(stays: HostelStay[], personId: Id, on: IsoDate) {
    return stays.find((s) => s.personId === personId && s.from <= on && (!s.to || s.to >= on)) ?? null;
  }

  /** The hostels an OM sees: hostels where workers of his own sites live (P2). */
  private async omHostelIds(user: User): Promise<Set<Id>> {
    const ids = await this.companies(user);
    const stays = await this.store.list('hostelStays', { companyId: ids });
    const today = this.today();
    const out = new Set<Id>();
    const mySites = await this.omSites(user);
    const people = await this.store.list('people', { id: [...new Set(stays.filter((s) => !s.to || s.to >= today).map((s) => s.personId))] });
    for (const s of stays) {
      if (s.to && s.to < today) continue;
      const p = people.find((x) => x.id === s.personId);
      if (!p) continue;
      const site = await this.currentSite(p);
      if (site && mySites.has(site)) out.add(s.hostelId);
    }
    for (const h of await this.store.list('hostels', { companyId: ids })) if (h.omUserId === user.id) out.add(h.id);
    return out;
  }

  private async hostelFor(user: User, hostelId: Id): Promise<Hostel> {
    const role = fwHostelRole(user);
    if (!role || role === 'asset') throw new AccessDenied('view', '(hostels)');
    const h = await this.store.get('hostels', hostelId);
    if (!h || !(await this.companies(user)).includes(h.companyId)) throw new NotFound('Hostel');
    if (role === 'om' && !(await this.omHostelIds(user)).has(h.id)) throw new AccessDenied('view', '(not a hostel of your sites)');
    return h;
  }

  // ---------- P1 residents ----------

  /** P1: FWM or the hostel's company adds a stay; an open stay elsewhere ends the day before. Over the beds is shown red, never refused. */
  async addStay(user: User, input: { hostelId: Id; personId: Id; from: IsoDate; room?: string | null }) {
    const role = fwHostelRole(user);
    if (role !== 'fwm' && role !== 'company') throw new AccessDenied('hr.monitor', '(FWM or the company office records who sleeps where)');
    const h = await this.hostelFor(user, input.hostelId);
    const p = await this.store.get('people', input.personId);
    if (!p || p.companyId !== h.companyId) throw new BadRequest('Pick a worker of the company that owns or rents this hostel.');
    if (p.nationality === 'MY') throw new BadRequest('Hostels here are for foreign workers.');
    if (p.status === 'left') throw new BadRequest('This worker has left.');
    if (!isDate(input.from)) throw new BadRequest('Give the date from.');
    return this.store.transaction((tx) => this.placeStay(tx, user, h, p, input.from, input.room ?? null, 'P1'));
  }

  private async placeStay(tx: Store, user: User, h: Hostel, p: Person, from: IsoDate, room: string | null, why: string): Promise<HostelStay> {
    const stays = await tx.list('hostelStays', { companyId: [p.companyId] });
    const at = this.now();
    for (const s of stays.filter((x) => x.personId === p.id && (!x.to || x.to >= from) && x.from < from)) {
      await tx.update('hostelStays', s.id, { to: addDays(from, -1), endReason: `Moved to ${h.name} (${why})` });
    }
    if (stays.some((x) => x.personId === p.id && x.from === from && !x.to)) throw new BadRequest('This worker already has a stay starting that day.');
    const stay: HostelStay = { id: `stay-${p.id}-${from}-${globalThis.crypto.randomUUID().slice(0, 6)}`, companyId: h.companyId, hostelId: h.id, personId: p.id, personName: p.name, from, to: null, room: room ? String(room).trim().slice(0, 40) : null, checkedInBy: { by: user.name, byId: user.id, at }, checkOut: null };
    await tx.insert('hostelStays', stay);
    await tx.audit({ at, actor: user.name, companyId: h.companyId, action: 'hostel.stay_add', entity: 'hostel_stay', entityId: stay.id, summary: `${p.name} sleeps at ${h.name} from ${from} (${why}).` });
    return stay;
  }

  /** P1: end a stay with a reason. */
  async endStay(user: User, stayId: Id, to: IsoDate, reason: string) {
    const role = fwHostelRole(user);
    if (role !== 'fwm' && role !== 'company') throw new AccessDenied('hr.monitor', '(FWM or the company office)');
    const s = await this.store.get('hostelStays', stayId);
    if (!s || !(await this.companies(user)).includes(s.companyId)) throw new NotFound('Stay');
    if (s.to) throw new BadRequest('This stay has already ended.');
    if (!isDate(to) || to < s.from) throw new BadRequest('Give the end date, not before the start.');
    const why = txt(reason, 'Reason');
    const at = this.now();
    return this.store.transaction(async (tx) => {
      const u = await tx.update('hostelStays', s.id, { to, endReason: why });
      await tx.audit({ at, actor: user.name, companyId: s.companyId, action: 'hostel.stay_end', entity: 'hostel_stay', entityId: s.id, summary: `${s.personName}'s stay ended ${to}: ${why}` });
      return u;
    });
  }

  /** P-G and P13: FWM records the accommodation certificate; the OM (or FWM) names the hostel supervisor from a date. */
  async setHostelDetails(user: User, hostelId: Id, input: { cert?: { number: string; issuedOn: IsoDate; expiresOn: IsoDate; doc?: string | null } | null; supervisor?: { personId: Id | null; from: IsoDate } | null; usedByManager?: boolean }, reason: string) {
    const role = fwHostelRole(user);
    const h = await this.hostelFor(user, hostelId);
    const why = txt(reason, 'Reason');
    const patch: Partial<Hostel> = {};
    const at = this.now();
    if (input.cert !== undefined) {
      if (role !== 'fwm') throw new AccessDenied('hr.monitor', '(FWM records the accommodation certificate)');
      const c = input.cert;
      if (c && (!c.number?.trim() || !isDate(c.issuedOn) || !isDate(c.expiresOn) || c.expiresOn < c.issuedOn)) throw new BadRequest('Certificate: number, issue date and expiry date.');
      patch.cert = c ? { number: c.number.trim().slice(0, 60), issuedOn: c.issuedOn, expiresOn: c.expiresOn, doc: c.doc && photoRe.test(c.doc) ? c.doc : null, by: user.name, at } : null;
    }
    if (input.supervisor !== undefined) {
      if (role !== 'om' && role !== 'fwm' && role !== 'company') throw new AccessDenied('hr.monitor', '(the OM sets the hostel supervisor)');
      const s = input.supervisor;
      if (!s || !isDate(s.from)) throw new BadRequest('Supervisor: pick the person and the date from.');
      let name: string | null = null;
      if (s.personId) {
        const p = await this.store.get('people', s.personId);
        if (!p || p.companyId !== h.companyId) throw new BadRequest('Pick a worker of this hostel’s company.');
        name = p.name;
      }
      patch.supervisor = { personId: s.personId, name, from: s.from, by: user.name, at };
      patch.supervisorHistory = [...(h.supervisorHistory ?? []), ...(h.supervisor ? [h.supervisor] : [])].slice(-30);
      if (role === 'om') patch.omUserId = user.id;
    }
    if (input.usedByManager !== undefined) {
      if (role !== 'fwm') throw new AccessDenied('hr.monitor', '(FWM)');
      patch.usedByNepalManager = !!input.usedByManager;
    }
    return this.store.transaction(async (tx) => {
      const u = await tx.update('hostels', h.id, patch);
      await tx.audit({ at, actor: user.name, companyId: h.companyId, action: 'hostel.details', entity: 'hostel', entityId: h.id, summary: `${h.name}: ${Object.keys(patch).join(', ')} changed: ${why}` });
      return u;
    });
  }

  // ---------- P3 / P4 moves ----------

  private async personFor(user: User, personId: Id): Promise<Person> {
    const p = await this.store.get('people', personId);
    if (!p || !(await this.companies(user)).includes(p.companyId)) throw new NotFound('Worker');
    if (p.nationality === 'MY') throw new BadRequest('Moves here are for foreign workers (FWM).');
    if (p.status === 'left') throw new BadRequest(`${p.name} has left.`);
    return p;
  }

  private async siteOf(id: Id): Promise<Site> {
    const s = await this.store.get('sites', id);
    if (!s) throw new NotFound('Site');
    return s;
  }

  /** P3: the OM (or FWM for a new arrival) raises a move for one or more workers going the same way. */
  async raiseMove(user: User, input: {
    personIds: Id[];
    newArrival?: boolean;
    originPicId?: Id | null;
    newPicId: Id;
    toSiteId: Id;
    toJob?: string;
    toHostelId?: Id | null;
    leaveHostelOn?: IsoDate | null;
    startOn: IsoDate;
    reason: FwMoveReason;
    justification: string;
    urgentReason?: string | null;
  }) {
    const role = fwHostelRole(user);
    const newArrival = !!input.newArrival;
    if (role !== 'om' && role !== 'company' && !(role === 'fwm' && newArrival)) throw new AccessDenied('hr.monitor', '(the site OM raises a move; FWM may raise a new arrival placement)');
    await this.need('fwMoves');
    const ids = [...new Set(Array.isArray(input.personIds) ? input.personIds : [])];
    if (!ids.length || ids.length > 40) throw new BadRequest('Pick 1 to 40 workers.');
    if (!(input.reason in FW_MOVE_REASONS)) throw new BadRequest('Pick the reason for the move.');
    const justification = txt(input.justification, 'Justification', 5);
    if (!isDate(input.startOn)) throw new BadRequest('Give the date starting at the new site.');
    if (input.leaveHostelOn != null && !isDate(input.leaveHostelOn)) throw new BadRequest('Give the date leaving the current hostel.');
    const toSite = await this.siteOf(input.toSiteId);
    if (!(await this.companies(user)).includes(toSite.companyId) && role !== 'fwm') throw new AccessDenied('view', toSite.companyId);
    const newPic = await this.store.get('users', input.newPicId);
    if (!newPic || newPic.opsTier !== 'om' || !(await this.omSites(newPic)).has(toSite.id)) throw new BadRequest('Pick the OM of the new site as the new PIC.');
    const people = await Promise.all(ids.map((id) => this.personFor(user, id)));
    const mySites = await this.omSites(user);
    const employer = people[0].companyId;
    if (people.some((p) => p.companyId !== employer)) throw new BadRequest('One request is for workers of one employer. Raise another request for the others.');
    const workers: FwMoveWorker[] = [];
    const today = this.today();
    const stays = await this.store.list('hostelStays', { companyId: [employer] });
    for (const p of people) {
      const fromSiteId = newArrival ? null : await this.currentSite(p);
      if (!newArrival && role === 'om' && (!fromSiteId || !mySites.has(fromSiteId)) && !mySites.has(toSite.id))
        throw new AccessDenied('view', `(${p.name} is not at one of your sites)`);
      workers.push({ personId: p.id, name: p.name, staffNo: p.staffNo, employerCompanyId: p.companyId, fromSiteId, fromHostelId: newArrival ? null : (this.openStay(stays, p.id, today)?.hostelId ?? null), job: String(input.toJob ?? p.jobTitle ?? 'Guard').slice(0, 60) });
    }
    const fromSites = [...new Set(workers.map((w) => w.fromSiteId).filter((x): x is Id => !!x))];
    if (fromSites.length > 1) throw new BadRequest('Workers in one request leave from one site. Raise another request for the others.');
    let originPicId: Id | null = null;
    if (!newArrival) {
      originPicId = input.originPicId ?? (role === 'om' ? user.id : null);
      const op = originPicId ? await this.store.get('users', originPicId) : null;
      if (!op || op.opsTier !== 'om' || (fromSites[0] && !(await this.omSites(op)).has(fromSites[0]))) throw new BadRequest('Pick the OM of the current site as the origin PIC.');
    }
    let toHostel: Hostel | null = null;
    if (input.toHostelId) {
      toHostel = (await this.store.get('hostels', input.toHostelId)) ?? null;
      if (!toHostel) throw new NotFound('Hostel');
    }
    const sameHostel = !toHostel || workers.every((w) => w.fromHostelId === toHostel!.id);
    const sameSite = workers.every((w) => w.fromSiteId === toSite.id);
    const type: FwMove['type'] = newArrival ? 'ARRIVAL' : sameSite && sameHostel ? (() => { throw new BadRequest('Nothing changes: pick a new site or a new hostel.'); })() : sameSite ? 'HOSTEL' : sameHostel ? 'SITE' : 'BOTH';
    // Warnings (never a block, except urgent needs a reason).
    const st = await this.settings();
    const years = [...new Set([today.slice(0, 4), input.startOn.slice(0, 4)].map(Number))];
    const wd = workingDaysUntil(today, input.startOn, await this.holidays(toSite.companyId, years));
    const urgentReason = String(input.urgentReason ?? '').trim();
    if (wd < st.moveLeadWorkingDays && urgentReason.length < 5) throw new BadRequest(`The start date is ${wd} working day(s) away, less than ${st.moveLeadWorkingDays}. Tick urgent and give the reason.`);
    const companies = await this.store.list('companies', { id: [employer, toSite.companyId] });
    const cname = (id: Id) => companies.find((c) => c.id === id)?.name ?? id;
    const creds = await this.store.list('credentials', { companyId: [employer], personId: people.map((p) => p.id) });
    const papers = people.map((p) => ({
      name: p.name,
      permit: paperState(creds.find((c) => c.personId === p.id && c.type === 'PLKS_PERMIT'), input.startOn),
      passport: paperState(creds.find((c) => c.personId === p.id && c.type === 'PASSPORT'), input.startOn),
    }));
    let hostelFull: { name: string; residents: number; beds: number } | null = null;
    let cert: 'missing' | 'expired' | 'ok' | null = null;
    if (toHostel && !sameHostel) {
      const hs = await this.store.list('hostelStays', { companyId: [toHostel.companyId] });
      const residents = hs.filter((s) => s.hostelId === toHostel!.id && s.from <= input.startOn && (!s.to || s.to >= input.startOn)).length;
      if (residents + workers.length > toHostel.beds) hostelFull = { name: toHostel.name, residents: residents + workers.length, beds: toHostel.beds };
      cert = !toHostel.cert ? 'missing' : toHostel.cert.expiresOn < input.startOn ? 'expired' : 'ok';
    }
    const warnings = moveWarnings({ leadDays: st.moveLeadWorkingDays, workingDays: wd, otherCompany: toSite.companyId !== employer ? { employer: cname(employer), site: cname(toSite.companyId) } : null, papers, hostelFull, cert });
    const at = this.now();
    const sign: FwSign = { by: user.name, byId: user.id, at, note: justification, bySubmit: true };
    const steps: FwMove['steps'] = {};
    if (originPicId === user.id) steps.originPic = sign;
    if (input.newPicId === user.id) steps.newPic = sign;
    const move: FwMove = {
      id: `fwm-${Date.parse(at).toString(36)}-${globalThis.crypto.randomUUID().slice(0, 6)}`,
      form: 'BPPS/HOSTEL/FWM/001/2026',
      companyId: employer,
      newCompanyId: toSite.companyId,
      newArrival,
      workers,
      originPicId,
      newPicId: input.newPicId,
      toSiteId: toSite.id,
      toJob: workers[0].job,
      toHostelId: toHostel?.id ?? null,
      leaveHostelOn: input.leaveHostelOn ?? null,
      startOn: input.startOn,
      reason: input.reason,
      justification,
      urgent: wd < st.moveLeadWorkingDays ? { reason: urgentReason.slice(0, 300) } : null,
      type,
      warnings,
      raisedBy: user.name,
      raisedById: user.id,
      raisedAt: at,
      status: 'submitted',
      steps,
      rounds: [],
      rejected: null,
      release: null,
      transit: null,
      receive: null,
      close: null,
      employerNoticeTo: null,
      cancelled: null,
    };
    // FWM files missing papers (behind the fw_ids wall); the OM is never asked (P-F): they show on FWM's board.
    move.papersToFile = people.filter((_, i) => papers[i].permit === 'missing' || papers[i].passport === 'missing').map((p) => p.id);
    await this.store.transaction(async (tx) => {
      await tx.insert('fwMoves', move);
      await tx.audit({ at, actor: user.name, companyId: employer, action: 'fw.move_raise', entity: 'fw_move', entityId: move.id, summary: `${type} move of ${workers.length} worker(s) to ${toSite.name} from ${input.startOn}${warnings.length ? `; warnings: ${warnings.join('; ')}` : ''}` });
    });
    return move;
  }

  /** Which step(s) this user may sign now on this move (P4 order and roles). */
  private async signable(user: User, m: FwMove): Promise<FwMoveStep[]> {
    if (m.status !== 'submitted') return [];
    const signed = Object.values(m.steps).filter((s): s is FwSign => !!s && !s.bySubmit).some((s) => s.byId === user.id);
    if (signed) return [];
    const site = await this.siteOf(m.toSiteId);
    const out: FwMoveStep[] = [];
    const picsDone = (m.newArrival || !!m.steps.originPic) && !!m.steps.newPic;
    if (!m.newArrival && !m.steps.originPic && user.id === m.originPicId) out.push('originPic');
    if (!m.steps.newPic && user.id === m.newPicId) out.push('newPic');
    if (user.id === m.raisedById) return out.filter((s) => s === 'originPic' || s === 'newPic');
    const role = fwHostelRole(user);
    if (picsDone && !m.steps.fwm && role === 'fwm') out.push('fwm');
    if (m.steps.fwm && !m.steps.hq && user.role === 'company_manager' && user.companyIds.includes(m.newCompanyId)) out.push('hq');
    const ketua = site.sector === 'government' ? isOgm(user) : actsAsOpsDirector(user);
    if (m.steps.fwm && !m.steps.ketua && ketua && (await this.companies(user)).includes(m.newCompanyId)) out.push('ketua');
    return out;
  }

  private async moveFor(user: User, id: Id): Promise<FwMove> {
    const m = await this.store.get('fwMoves', id);
    if (!m) throw new NotFound('Move');
    if (!(await this.canSeeMove(user, m))) throw new NotFound('Move');
    return m;
  }

  private async canSeeMove(user: User, m: FwMove): Promise<boolean> {
    const role = fwHostelRole(user);
    if (!role || role === 'asset') return false;
    if (role === 'fwm' || role === 'coo' || role === 'leader' || role === 'act') return true;
    if (role === 'om') {
      const mine = await this.omSites(user);
      return user.id === m.originPicId || user.id === m.newPicId || user.id === m.raisedById || mine.has(m.toSiteId) || m.workers.some((w) => !!w.fromSiteId && mine.has(w.fromSiteId));
    }
    if (role === 'company') return user.companyIds.includes(m.newCompanyId) || user.companyIds.includes(m.companyId);
    if (role === 'sector') {
      const site = await this.siteOf(m.toSiteId);
      return (site.sector === 'government' ? isOgm(user) : isOpsDirector(user)) && (await this.companies(user)).includes(m.newCompanyId);
    }
    return false;
  }

  /** P4: sign one step with a comment; reject or (FWM only) return to the OM for correction. */
  async decideMove(user: User, id: Id, step: FwMoveStep, decision: 'approve' | 'reject' | 'return', note: string) {
    const m = await this.moveFor(user, id);
    const can = await this.signable(user, m);
    if (!can.includes(step)) throw new AccessDenied('hr.monitor', `(${FW_MOVE_STEP_LABEL[step]} is not yours to sign now)`);
    const why = txt(note, decision === 'approve' ? 'Comment' : 'Reason');
    if (decision === 'return' && step !== 'fwm') throw new BadRequest('Only FWM returns a request for correction.');
    const at = this.now();
    const sign: FwSign = { by: user.name, byId: user.id, at, note: why };
    return this.store.transaction(async (tx) => {
      await tx.lock?.('fwMoves', m.id);
      const cur = (await tx.get('fwMoves', m.id))!;
      if (cur.status !== 'submitted' || cur.steps[step]) throw new BadRequest('This step changed meanwhile. Open the move again.');
      let patch: Partial<FwMove>;
      if (decision === 'reject') patch = { status: 'rejected', rejected: { ...sign, step } };
      else if (decision === 'return') patch = { status: 'returned', rounds: [...cur.rounds, { returnedBy: user.name, at, reason: why, steps: cur.steps }], steps: {} };
      else {
        const steps = { ...cur.steps, [step]: sign };
        const done = (cur.newArrival || steps.originPic) && steps.newPic && steps.fwm && steps.hq && steps.ketua;
        patch = { steps, ...(done ? { status: 'approved' as const, employerNoticeTo: cur.newCompanyId !== cur.companyId ? cur.companyId : null } : {}) };
      }
      const u = await tx.update('fwMoves', m.id, patch);
      await tx.audit({ at, actor: user.name, companyId: m.companyId, action: `fw.move_${decision}`, entity: 'fw_move', entityId: m.id, summary: `${FW_MOVE_STEP_LABEL[step]}: ${decision}: ${why}` });
      return u;
    });
  }

  /** The OM corrects a returned request and sends it again (earlier rounds kept). */
  async resubmitMove(user: User, id: Id, input: { startOn?: IsoDate; toHostelId?: Id | null; justification?: string; urgentReason?: string | null }) {
    const m = await this.moveFor(user, id);
    if (m.status !== 'returned') throw new BadRequest('Only a returned request is sent again.');
    if (user.id !== m.raisedById) throw new AccessDenied('hr.monitor', '(the OM who raised it corrects it)');
    const at = this.now();
    const patch: Partial<FwMove> = { status: 'submitted', steps: {} };
    if (input.startOn) {
      if (!isDate(input.startOn)) throw new BadRequest('Give the start date.');
      patch.startOn = input.startOn;
    }
    if (input.toHostelId !== undefined) patch.toHostelId = input.toHostelId;
    if (input.justification) patch.justification = txt(input.justification, 'Justification', 5);
    const sign: FwSign = { by: user.name, byId: user.id, at, note: 'Corrected and sent again', bySubmit: true };
    patch.steps = { ...(m.originPicId === user.id ? { originPic: sign } : {}), ...(m.newPicId === user.id ? { newPic: sign } : {}) };
    return this.store.transaction(async (tx) => {
      const u = await tx.update('fwMoves', m.id, patch);
      await tx.audit({ at, actor: user.name, companyId: m.companyId, action: 'fw.move_resubmit', entity: 'fw_move', entityId: m.id, summary: 'Move corrected and sent again' });
      return u;
    });
  }

  /** P5 release by the origin OM: attendance, items returned, room checked; a gap opens a damage report (not a charge). */
  async releaseMove(user: User, id: Id, input: { attendanceChecked: boolean; itemsReturned: string[]; roomChecked: boolean; gaps?: { item: string; note: string; personId?: Id | null }[]; photos?: string[]; note?: string }) {
    const m = await this.moveFor(user, id);
    if (m.status !== 'approved') throw new BadRequest('A worker moves only after the move is approved.');
    if (m.newArrival) throw new BadRequest('A new arrival has no release.');
    if (user.id !== m.originPicId && !(fwHostelRole(user) === 'company' && user.companyIds.includes(m.companyId))) throw new AccessDenied('hr.monitor', '(the origin OM releases)');
    if (!input.attendanceChecked || !input.roomChecked) throw new BadRequest('Check attendance and the room first.');
    const gaps = (input.gaps ?? []).map((g) => ({ item: txt(g.item, 'Item', 2, 80), note: String(g.note ?? '').slice(0, 300), personId: g.personId ?? null }));
    const at = this.now();
    const sign: FwSign = { by: user.name, byId: user.id, at, note: String(input.note ?? '').slice(0, 300) };
    return this.store.transaction(async (tx) => {
      const damageIds: Id[] = [];
      const hostelId = m.workers[0].fromHostelId;
      if (gaps.length) {
        if (!hostelId) throw new BadRequest('No current hostel to report the gap against.');
        const photos = photoList(input.photos, 1, 'what is missing or damaged');
        damageIds.push(await this.openDamage(tx, user, { companyId: m.companyId, hostelId, lines: gaps.map((g) => ({ item: g.item, qty: 1 })), workerIds: [...new Set(gaps.map((g) => g.personId).filter((x): x is Id => !!x))], cause: 'UNKNOWN', suggested: 'none', note: `Found on release of move ${m.id}: ${gaps.map((g) => `${g.item} ${g.note}`).join('; ')}`, photos, source: 'move', reportedById: null }));
      }
      const u = await tx.update('fwMoves', m.id, { status: 'released', release: { ...sign, attendanceChecked: true, itemsReturned: (input.itemsReturned ?? []).map((x) => String(x).slice(0, 60)), roomChecked: true, gaps, damageIds } });
      await tx.audit({ at, actor: user.name, companyId: m.companyId, action: 'fw.move_release', entity: 'fw_move', entityId: m.id, summary: `Released${gaps.length ? `; ${gaps.length} gap(s) reported to FWM` : ''}` });
      return u;
    });
  }

  /** P5 move: transport and what the worker carries. */
  async transitMove(user: User, id: Id, input: { transport: string; on: IsoDate; carries: string[] }) {
    const m = await this.moveFor(user, id);
    if (m.status !== 'released' && !(m.newArrival && m.status === 'approved')) throw new BadRequest('Release the worker first.');
    if (![m.originPicId, m.newPicId].includes(user.id) && fwHostelRole(user) !== 'fwm') throw new AccessDenied('hr.monitor', '(the OMs or FWM arrange the move)');
    if (!isDate(input.on)) throw new BadRequest('Give the move date.');
    const at = this.now();
    return this.store.transaction(async (tx) => {
      const u = await tx.update('fwMoves', m.id, { status: 'moved', transit: { by: user.name, byId: user.id, at, note: '', transport: txt(input.transport, 'Transport', 2, 200), on: input.on, carries: (input.carries ?? []).map((x) => String(x).slice(0, 60)) } });
      await tx.audit({ at, actor: user.name, companyId: m.companyId, action: 'fw.move_transit', entity: 'fw_move', entityId: m.id, summary: `Moving on ${input.on}` });
      return u;
    });
  }

  /** P5 receive by the new OM: arrived, identity, bed given (creates the stay, ends the old one), briefing; the worker's site is updated. */
  async receiveMove(user: User, id: Id, input: { arrived: boolean; identity: 'face' | 'card'; briefing: boolean; room?: string | null; gaps?: { item: string; note: string; personId?: Id | null }[]; photos?: string[]; note?: string }) {
    const m = await this.moveFor(user, id);
    if (m.status !== 'moved') throw new BadRequest('The move must be on its way first.');
    if (user.id !== m.newPicId && !(fwHostelRole(user) === 'company' && user.companyIds.includes(m.newCompanyId))) throw new AccessDenied('hr.monitor', '(the new site OM receives)');
    if (!input.arrived || !input.briefing || (input.identity !== 'face' && input.identity !== 'card')) throw new BadRequest('Confirm arrival, identity (face or worker card) and the safety and hostel rules briefing.');
    const gaps = (input.gaps ?? []).map((g) => ({ item: txt(g.item, 'Item', 2, 80), note: String(g.note ?? '').slice(0, 300), personId: g.personId ?? null }));
    const at = this.now();
    const hostel = m.toHostelId ? await this.store.get('hostels', m.toHostelId) : null;
    return this.store.transaction(async (tx) => {
      const stayIds: Id[] = [];
      if (hostel) {
        for (const w of m.workers) {
          if (w.fromHostelId === hostel.id) continue;
          const p = (await tx.get('people', w.personId))!;
          stayIds.push((await this.placeStay(tx, user, hostel, p, m.startOn, input.room ?? null, `move ${m.id}`)).id);
        }
      }
      for (const w of m.workers) await tx.update('people', w.personId, { workSiteId: m.toSiteId, workSiteFrom: m.startOn });
      const damageIds: Id[] = [];
      if (gaps.length && hostel) {
        const photos = photoList(input.photos, 1, 'what is missing or damaged');
        damageIds.push(await this.openDamage(tx, user, { companyId: hostel.companyId, hostelId: hostel.id, lines: gaps.map((g) => ({ item: g.item, qty: 1 })), workerIds: [], cause: 'UNKNOWN', suggested: 'none', note: `Found on receipt of move ${m.id}`, photos, source: 'move', reportedById: null }));
      }
      const u = await tx.update('fwMoves', m.id, { status: 'received', receive: { by: user.name, byId: user.id, at, note: String(input.note ?? '').slice(0, 300), arrived: true, identity: input.identity, briefing: true, room: input.room ?? null, gaps, stayIds, damageIds } });
      await tx.audit({ at, actor: user.name, companyId: m.companyId, action: 'fw.move_receive', entity: 'fw_move', entityId: m.id, summary: `Received at ${m.toSiteId}${stayIds.length ? `; ${stayIds.length} bed(s) given` : ''}` });
      return u;
    });
  }

  /** P6: FWM closes the move with the JA reference. */
  async closeMove(user: User, id: Id, input: { jaRef: string; headcountOk: boolean; documentsKept: boolean; note?: string }) {
    const m = await this.moveFor(user, id);
    if (fwHostelRole(user) !== 'fwm') throw new AccessDenied('hr.monitor', '(FWM closes a move)');
    if (m.status !== 'received') throw new BadRequest('Only a received move is closed.');
    if (!input.headcountOk || !input.documentsKept) throw new BadRequest('Confirm the worker list, headcount and documents.');
    const at = this.now();
    return this.store.transaction(async (tx) => {
      const u = await tx.update('fwMoves', m.id, { status: 'closed', close: { by: user.name, byId: user.id, at, note: String(input.note ?? '').slice(0, 300), jaRef: txt(input.jaRef, 'JA reference', 2, 60), headcountOk: true, documentsKept: true } });
      await tx.audit({ at, actor: user.name, companyId: m.companyId, action: 'fw.move_close', entity: 'fw_move', entityId: m.id, summary: `Closed; JA ${input.jaRef}` });
      return u;
    });
  }

  /** Cancel a move not yet received, with a reason (no delete). */
  async cancelMove(user: User, id: Id, reason: string) {
    const m = await this.moveFor(user, id);
    if (user.id !== m.raisedById && fwHostelRole(user) !== 'fwm') throw new AccessDenied('hr.monitor', '(the OM who raised it, or FWM)');
    if (['received', 'closed', 'cancelled', 'rejected'].includes(m.status)) throw new BadRequest('This move can no longer be cancelled.');
    const why = txt(reason, 'Reason');
    const at = this.now();
    return this.store.transaction(async (tx) => {
      const u = await tx.update('fwMoves', m.id, { status: 'cancelled', cancelled: { by: user.name, byId: user.id, at, note: why } });
      await tx.audit({ at, actor: user.name, companyId: m.companyId, action: 'fw.move_cancel', entity: 'fw_move', entityId: m.id, summary: `Cancelled: ${why}` });
      return u;
    });
  }

  /** P6: closed and received moves against JA's worker site and hostel; JA moves Prima never approved. */
  async jaDifferences(user: User) {
    if (fwHostelRole(user) !== 'fwm') throw new AccessDenied('hr.monitor', '(FWM)');
    const ids = await this.companies(user);
    const [moves, ja, hostels, sites, stays] = await Promise.all([
      this.store.list('fwMoves', { companyId: ids }),
      this.store.list('jaRecords', { companyId: ids }).catch(() => []),
      this.store.list('hostels', { companyId: ids }),
      this.store.list('sites', { companyId: ids }),
      this.store.list('hostelStays', { companyId: ids }),
    ]);
    const nowMs = Date.parse(this.now());
    const workers = ja.filter((r) => r.dataset === 'worker' && r.worker).map((r) => r.worker!);
    const norm = (s: string | null | undefined) => String(s ?? '').trim().toLowerCase();
    const out: { moveId: Id | null; staffNo: string; what: string; ja: string; prima: string }[] = [];
    const moved = new Set<string>();
    for (const m of moves.filter((x) => x.status === 'received' || x.status === 'closed')) {
      const hostel = hostels.find((h) => h.id === m.toHostelId);
      const site = sites.find((s) => s.id === m.toSiteId);
      const late = m.receive && nowMs - Date.parse(m.receive.at) > 24 * 3_600_000;
      for (const w of m.workers) {
        moved.add(w.staffNo);
        const j = workers.find((x) => x.staffNo === w.staffNo);
        const okHostel = !hostel || norm(j?.hostel) === norm(hostel.name);
        const okSite = !site || norm(j?.siteCode) === norm(site.code);
        if (late && (!okHostel || !okSite)) out.push({ moveId: m.id, staffNo: w.staffNo, what: 'JA still shows the old place 24 h after receipt', ja: `${j?.siteCode ?? 'no site'} / ${j?.hostel ?? 'no hostel'}`, prima: `${site?.code ?? ''} / ${hostel?.name ?? ''}` });
      }
    }
    const today = this.today();
    for (const j of workers) {
      if (moved.has(j.staffNo) || !j.hostel) continue;
      const people = await this.store.list('people', { companyId: ids, staffNo: j.staffNo }).catch(() => []);
      const p = people[0];
      if (!p) continue;
      const s = this.openStay(stays, p.id, today);
      const h = hostels.find((x) => x.id === s?.hostelId);
      if (h && norm(h.name) !== norm(j.hostel)) out.push({ moveId: null, staffNo: j.staffNo, what: 'Moved in JA without approval in Prima', ja: j.hostel, prima: h.name });
    }
    return out;
  }

  // ---------- P7 / P13-P17 inventory, checks, damage, maintenance ----------

  private async inventory(tx: Store, h: Hostel): Promise<HostelInventory> {
    const id = `inv-${h.id}`;
    const cur = (await tx.get('hostelRecs', id)) as HostelInventory | null;
    if (cur) return cur;
    const inv: HostelInventory = { id, kind: 'inventory', companyId: h.companyId, hostelId: h.id, lines: [], history: [] };
    await tx.insert('hostelRecs', inv);
    return inv;
  }

  /** The only ways the list changes (T3 policy 4.2). */
  private async changeList(tx: Store, user: User, h: Hostel, source: HostelInventory['history'][number]['source'], ref: Id, apply: (lines: HostelItemLine[]) => HostelItemLine[], what: string) {
    const inv = await this.inventory(tx, h);
    const lines = apply(inv.lines.map((l) => ({ ...l })));
    await tx.update('hostelRecs', inv.id, { lines, history: [...inv.history, { at: this.now(), by: user.name, source, ref, what }].slice(-300) } as never);
  }

  /** Part U U12 disposal or a move between hostels changes the list too (called from those flows). */
  async listChangeFrom(user: User, hostelId: Id, source: 'disposal' | 'move', ref: Id, changes: { name: string; good?: number; damaged?: number; missing?: number }[]) {
    const role = fwHostelRole(user);
    if (role !== 'fwm' && role !== 'asset') throw new AccessDenied('hr.monitor', '(FWM)');
    const h = (await this.store.get('hostels', hostelId)) ?? (() => { throw new NotFound('Hostel'); })();
    await this.store.transaction((tx) =>
      this.changeList(tx, user, h, source, ref, (lines) => {
        for (const c of changes) {
          const l = lines.find((x) => x.name === c.name);
          if (!l) continue;
          l.good = Math.max(0, l.good + (c.good ?? 0));
          l.damaged = Math.max(0, l.damaged + (c.damaged ?? 0));
          l.missing = Math.max(0, l.missing + (c.missing ?? 0));
          l.qty = l.good + l.damaged + l.missing;
        }
        return lines;
      }, `${source} ${ref}`),
    );
  }

  /** P14 first count (BRI): FWM opens it; the OM or supervisor counts by area; FWM verifies (never the counter); the company head acknowledges. */
  async openCount(user: User, hostelId: Id) {
    if (fwHostelRole(user) !== 'fwm') throw new AccessDenied('hr.monitor', '(FWM opens a first count)');
    await this.need('hostelRecs');
    const h = await this.hostelFor(user, hostelId);
    const at = this.now();
    const c: HostelCount = { id: `cnt-${h.id}-${Date.parse(at).toString(36)}-${globalThis.crypto.randomUUID().slice(0, 4)}`, kind: 'count', form: 'BRI/HOSTEL/FWM001/2026', companyId: h.companyId, hostelId: h.id, openedBy: user.name, openedById: user.id, openedAt: at, lines: [], countedBy: null, countedById: null, countedAt: null, status: 'open', verified: null, ack: null };
    await this.store.transaction(async (tx) => {
      await tx.insert('hostelRecs', c);
      await tx.audit({ at, actor: user.name, companyId: h.companyId, action: 'hostel.count_open', entity: 'hostel_count', entityId: c.id, summary: `First count opened for ${h.name}` });
    });
    return c;
  }

  async submitCount(user: User, countId: Id, lines: { name: string; area: string; qty: number; good: number; damaged: number; missing: number; note?: string; photo?: string | null }[]) {
    const c = (await this.store.get('hostelRecs', countId)) as HostelCount | null;
    if (!c || c.kind !== 'count') throw new NotFound('Count');
    const role = fwHostelRole(user);
    await this.hostelFor(user, c.hostelId);
    if (role !== 'om' && role !== 'company') throw new AccessDenied('hr.monitor', '(the OM or the hostel supervisor counts)');
    if (c.status !== 'open') throw new BadRequest('This count is already sent.');
    if (!Array.isArray(lines) || !lines.length || lines.length > 200) throw new BadRequest('Give 1 to 200 lines.');
    const clean = lines.map((l, i) => {
      const n = (v: unknown) => {
        const x = Number(v);
        if (!Number.isInteger(x) || x < 0 || x > 9999) throw new BadRequest(`Line ${i + 1}: whole numbers.`);
        return x;
      };
      const good = n(l.good), damaged = n(l.damaged), missing = n(l.missing);
      return { name: txt(l.name, `Line ${i + 1} item`, 2, 80), area: txt(l.area, `Line ${i + 1} area`, 2, 40), qty: good + damaged + missing, good, damaged, missing, note: String(l.note ?? '').slice(0, 200), photo: l.photo && photoRe.test(l.photo) ? l.photo : null };
    });
    const at = this.now();
    return this.store.transaction(async (tx) => {
      const u = await tx.update('hostelRecs', c.id, { lines: clean, countedBy: user.name, countedById: user.id, countedAt: at, status: 'counted' } as never);
      await tx.audit({ at, actor: user.name, companyId: c.companyId, action: 'hostel.count_submit', entity: 'hostel_count', entityId: c.id, summary: `${clean.length} line(s) counted` });
      return u;
    });
  }

  async verifyCount(user: User, countId: Id, note: string) {
    if (fwHostelRole(user) !== 'fwm') throw new AccessDenied('hr.monitor', '(FWM verifies)');
    const c = (await this.store.get('hostelRecs', countId)) as HostelCount | null;
    if (!c || c.kind !== 'count') throw new NotFound('Count');
    if (c.status !== 'counted') throw new BadRequest('Nothing to verify yet.');
    if (c.countedById === user.id) throw new BadRequest('You counted it. Someone else in FWM verifies.');
    const why = txt(note, 'Comment');
    const h = (await this.store.get('hostels', c.hostelId))!;
    const at = this.now();
    return this.store.transaction(async (tx) => {
      const u = await tx.update('hostelRecs', c.id, { status: 'verified', verified: { by: user.name, byId: user.id, at, note: why } } as never);
      await this.changeList(tx, user, h, 'count', c.id, () => c.lines.map(({ note: _n, photo: _p, ...l }) => l), 'Verified count');
      await tx.audit({ at, actor: user.name, companyId: c.companyId, action: 'hostel.count_verify', entity: 'hostel_count', entityId: c.id, summary: `Count verified: ${why}` });
      return u;
    });
  }

  async ackCount(user: User, countId: Id) {
    const c = (await this.store.get('hostelRecs', countId)) as HostelCount | null;
    if (!c || c.kind !== 'count') throw new NotFound('Count');
    if (user.role !== 'company_manager' || !user.companyIds.includes(c.companyId)) throw new AccessDenied('view', '(the company head acknowledges)');
    if (c.status !== 'verified' || c.ack) throw new BadRequest('Nothing to acknowledge.');
    const at = this.now();
    return this.store.update('hostelRecs', c.id, { ack: { by: user.name, byId: user.id, at, note: 'Seen' } } as never);
  }

  /** P14 routine checks: weekly (2 photos), monthly visit (BRB report), 6-monthly audit, FWM sweep. */
  async recordCheck(user: User, hostelId: Id, input: { freq: HostelCheck['freq']; ticks: Record<string, boolean>; note?: string; photos: string[]; reportedById?: Id | null }) {
    const role = fwHostelRole(user);
    const h = await this.hostelFor(user, hostelId);
    await this.need('hostelRecs');
    const freq = input.freq;
    if (!['weekly', 'monthly', 'audit', 'sweep'].includes(freq)) throw new BadRequest('Pick the kind of check.');
    if ((freq === 'audit' || freq === 'sweep') && role !== 'fwm') throw new AccessDenied('hr.monitor', '(FWM does the audit and the sweep)');
    if ((freq === 'weekly' || freq === 'monthly') && role !== 'om' && role !== 'company' && role !== 'fwm') throw new AccessDenied('hr.monitor', '(the OM or the supervisor checks)');
    const photos = photoList(input.photos, freq === 'weekly' ? 2 : 2, freq === 'monthly' ? 'inside and outside' : 'the hostel');
    if (input.reportedById && h.supervisor?.personId !== input.reportedById) throw new BadRequest('Reported by: pick the hostel supervisor.');
    const at = this.now();
    const today = this.today();
    let report: HostelCheck['report'] = null;
    if (freq === 'monthly') {
      const [stays, recs] = await Promise.all([this.store.list('hostelStays', { companyId: [h.companyId] }), this.store.list('hostelRecs', { companyId: [h.companyId], hostelId: h.id })]);
      const inv = recs.find((r) => r.kind === 'inventory') as HostelInventory | undefined;
      report = {
        residents: stays.filter((s) => s.hostelId === h.id && s.from <= today && (!s.to || s.to >= today)).length,
        beds: h.beds,
        lines: inv?.lines.length ?? 0,
        damaged: inv?.lines.reduce((n, l) => n + l.damaged, 0) ?? 0,
        missing: inv?.lines.reduce((n, l) => n + l.missing, 0) ?? 0,
        openDamage: recs.filter((r) => r.kind === 'damage' && r.status !== 'closed').length,
        openMaint: recs.filter((r) => r.kind === 'maint' && r.status !== 'closed').length,
      };
    }
    const c: HostelCheck = { id: `chk-${h.id}-${freq}-${Date.parse(at).toString(36)}-${globalThis.crypto.randomUUID().slice(0, 4)}`, kind: 'check', companyId: h.companyId, hostelId: h.id, freq, on: today, ticks: Object.fromEntries(Object.entries(input.ticks ?? {}).slice(0, 30).map(([k, v]) => [k.slice(0, 60), !!v])), note: String(input.note ?? '').slice(0, 500), photos, reportedById: input.reportedById ?? null, by: user.name, byId: user.id, at, report };
    await this.store.transaction(async (tx) => {
      await tx.insert('hostelRecs', c);
      await tx.audit({ at, actor: user.name, companyId: h.companyId, action: 'hostel.check', entity: 'hostel_check', entityId: c.id, summary: `${freq} check of ${h.name}` });
    });
    return c;
  }

  private async openDamage(tx: Store, user: User, i: Omit<HostelDamage, 'id' | 'kind' | 'form' | 'by' | 'byId' | 'at' | 'status' | 'decision' | 'penalty' | 'links' | 'closed'>): Promise<Id> {
    const at = this.now();
    const d: HostelDamage = { ...i, id: `dmg-${i.hostelId}-${Date.parse(at).toString(36)}-${globalThis.crypto.randomUUID().slice(0, 4)}`, kind: 'damage', form: 'BKK/HOSTEL/KEROSAKAN/FWM/001/2026', by: user.name, byId: user.id, at, status: 'reported', decision: null, penalty: null, links: {}, closed: null };
    await tx.insert('hostelRecs', d);
    await tx.audit({ at, actor: user.name, companyId: i.companyId, action: 'hostel.damage_report', entity: 'hostel_damage', entityId: d.id, summary: `Damage / loss reported: ${i.lines.map((l) => `${l.qty} x ${l.item}`).join(', ')}` });
    return d.id;
  }

  /** P15: the OM (or for the supervisor) files a damage / loss report to FWM; photos required. */
  async reportDamage(user: User, hostelId: Id, input: { lines: { item: string; qty: number }[]; workerIds?: Id[]; cause: DamageCause; suggested: DamageAction; note: string; photos: string[]; reportedById?: Id | null }) {
    const role = fwHostelRole(user);
    if (role !== 'om' && role !== 'company' && role !== 'fwm') throw new AccessDenied('hr.monitor', '(the OM reports damage)');
    await this.need('hostelRecs');
    const h = await this.hostelFor(user, hostelId);
    const photos = photoList(input.photos, 1, 'the damage');
    if (!['WEAR', 'ACCIDENT', 'NEGLIGENCE', 'MISUSE', 'VANDALISM', 'UNKNOWN'].includes(input.cause)) throw new BadRequest('Pick the cause.');
    if (!['replace', 'repair', 'dispose', 'discipline', 'none'].includes(input.suggested)) throw new BadRequest('Pick the suggested action.');
    const lines = (input.lines ?? []).map((l) => ({ item: txt(l.item, 'Item', 2, 80), qty: Math.max(1, Math.min(999, Math.round(Number(l.qty) || 1))) }));
    if (!lines.length) throw new BadRequest('Name at least one item.');
    const stays = await this.store.list('hostelStays', { companyId: [h.companyId] });
    const today = this.today();
    const residents = new Set(stays.filter((s) => s.hostelId === h.id && s.from <= today && (!s.to || s.to >= addDays(today, -30))).map((s) => s.personId));
    const workerIds = [...new Set(input.workerIds ?? [])];
    if (workerIds.some((w) => !residents.has(w))) throw new BadRequest('Workers involved: pick from the residents.');
    let id = '';
    await this.store.transaction(async (tx) => {
      id = await this.openDamage(tx, user, { companyId: h.companyId, hostelId: h.id, lines, workerIds, cause: input.cause, suggested: input.suggested, note: txt(input.note, 'Note', 3, 500), photos, source: 'report', reportedById: input.reportedById ?? null });
    });
    return (await this.store.get('hostelRecs', id)) as HostelDamage;
  }

  /** P15 step 3: FWM decides the action with a reason after its short investigation; replace -> one need, repair -> maintenance. */
  async decideDamage(user: User, damageId: Id, input: { action: DamageAction; finding: string; negligenceBy?: Id | null; item?: string; currentPrice?: number | null }) {
    if (fwHostelRole(user) !== 'fwm') throw new AccessDenied('hr.monitor', '(FWM decides)');
    const d = (await this.store.get('hostelRecs', damageId)) as HostelDamage | null;
    if (!d || d.kind !== 'damage') throw new NotFound('Damage report');
    if (d.status !== 'reported') throw new BadRequest('Already decided.');
    if (!['replace', 'repair', 'dispose', 'discipline', 'none'].includes(input.action)) throw new BadRequest('Pick the action.');
    const finding = txt(input.finding, 'Finding', 5);
    const h = (await this.store.get('hostels', d.hostelId))!;
    const at = this.now();
    const st = await this.settings();
    let penalty: HostelPenalty | null = null;
    if (input.negligenceBy) {
      if (!['NEGLIGENCE', 'MISUSE', 'VANDALISM'].includes(d.cause) && !/neglig|vandal|misuse|cuai/i.test(finding)) throw new BadRequest('A charge needs FWM’s finding of negligence or vandalism.');
      if (!d.workerIds.includes(input.negligenceBy)) throw new BadRequest('Name a worker involved in this report.');
      const item = input.item ?? d.lines[0].item;
      const listed = priceOn(st.prices, item, d.at.slice(0, 10));
      const amount = listed?.amount ?? (input.currentPrice != null && Number(input.currentPrice) > 0 ? Math.round(Number(input.currentPrice) * 100) / 100 : null);
      if (amount == null) throw new BadRequest(`${item} is not on the price list: give the current price from a receipt or quote.`);
      const qty = d.lines.find((l) => l.item === item)?.qty ?? 1;
      penalty = { personId: input.negligenceBy, item, amount: Math.round(amount * qty * 100) / 100, priceFrom: listed ? `price list from ${listed.from}` : 'current price (FWM, with receipt or quote)', dueOn: addDays(this.today(), st.penaltyPayDays), status: 'due', paid: null, notice: null, ask: null, hr: null };
    }
    return this.store.transaction(async (tx) => {
      const links: HostelDamage['links'] = {};
      if (input.action === 'replace') {
        const need = await this.makeNeed(tx, user, h, { items: d.lines.map((l) => ({ name: l.item, qty: l.qty, kind: 'item' as const })), reason: 'REPLACE_DAMAGED', justification: `From damage report ${d.id}: ${finding}`, neededBy: addDays(this.today(), 7), quotes: [], fromDamageId: d.id, status: 'fwm_checked', fwm: { by: user.name, byId: user.id, at, note: finding } });
        links.needId = need.id;
      }
      if (input.action === 'dispose') links.disposalRef = 'Part U U12 disposal case (Asset Management)';
      if (input.action === 'discipline') links.hrCaseRef = 'HR discipline case';
      const u = await tx.update('hostelRecs', d.id, { status: 'decided', decision: { by: user.name, byId: user.id, at, note: finding, action: input.action, negligenceBy: input.negligenceBy ?? null, finding }, penalty, links } as never);
      await tx.audit({ at, actor: user.name, companyId: d.companyId, action: 'hostel.damage_decide', entity: 'hostel_damage', entityId: d.id, summary: `${input.action}${penalty ? `; worker to pay RM${penalty.amount} (${penalty.priceFrom})` : ''}: ${finding}` });
      return u;
    });
  }

  /** P7 / P-H: the worker pays first (FWM records the slip); unpaid -> written notice; still unpaid -> FWM asks HR; HR decides with a reason. */
  async penaltyStep(user: User, damageId: Id, step: 'paid' | 'notice' | 'ask' | 'hr', input: { slip?: string; amount?: number; note?: string; decision?: 'approve' | 'reduce' | 'spread' | 'refuse'; months?: number }) {
    const d = (await this.store.get('hostelRecs', damageId)) as HostelDamage | null;
    if (!d || d.kind !== 'damage' || !d.penalty) throw new NotFound('Penalty');
    const role = fwHostelRole(user);
    const p = d.penalty;
    const at = this.now();
    const sign: FwSign = { by: user.name, byId: user.id, at, note: String(input.note ?? '').slice(0, 300) };
    let next: HostelPenalty;
    if (step === 'paid') {
      if (role !== 'fwm') throw new AccessDenied('hr.monitor', '(FWM records the payment)');
      if (!['due', 'notice'].includes(p.status)) throw new BadRequest('Not waiting for payment.');
      if (!input.slip || !photoRe.test(input.slip)) throw new BadRequest('Upload the slip or receipt.');
      next = { ...p, status: 'paid', paid: { ...sign, slip: input.slip, amount: Math.round(Number(input.amount ?? p.amount) * 100) / 100 } };
    } else if (step === 'notice') {
      if (role !== 'fwm') throw new AccessDenied('hr.monitor', '(FWM issues the notice)');
      if (p.status !== 'due' || this.today() <= p.dueOn) throw new BadRequest(`The notice is issued only after the due date ${p.dueOn} when unpaid.`);
      next = { ...p, status: 'notice', notice: sign };
    } else if (step === 'ask') {
      if (role !== 'fwm') throw new AccessDenied('hr.monitor', '(FWM asks HR)');
      if (p.status !== 'notice') throw new BadRequest('Issue the written notice first.');
      next = { ...p, status: 'deduction_asked', ask: { ...sign, note: txt(input.note, 'Reason') } };
    } else {
      const hr = !user.integration && user.role === 'pwvsb_officer' && (user.department === 'hr' || user.leadership === 'cos' || user.leadership === 'deputy_cos');
      if (!hr) throw new AccessDenied('hr.monitor', '(HR decides a deduction)');
      if (p.status !== 'deduction_asked') throw new BadRequest('No deduction asked.');
      if (p.ask?.byId === user.id) throw new BadRequest('You asked for it. Someone else decides.');
      const decision = input.decision;
      if (!decision || !['approve', 'reduce', 'spread', 'refuse'].includes(decision)) throw new BadRequest('Approve, reduce, spread over months or refuse.');
      const amount = decision === 'reduce' ? Math.round(Number(input.amount) * 100) / 100 : p.amount;
      if (decision === 'reduce' && !(amount > 0 && amount < p.amount)) throw new BadRequest('Give the reduced amount.');
      const months = decision === 'spread' ? Math.max(2, Math.min(12, Math.round(Number(input.months) || 2))) : 1;
      const person = await this.store.get('people', p.personId);
      const flags = deductionFlags(amount / months, person?.basicPay ?? null, 0);
      next = { ...p, status: decision === 'refuse' ? 'deduction_refused' : 'deduction_approved', hr: { ...sign, note: txt(input.note, 'Reason'), decision, amount, months, flags } };
    }
    return this.store.transaction(async (tx) => {
      const u = await tx.update('hostelRecs', d.id, { penalty: next } as never);
      await tx.audit({ at, actor: user.name, companyId: d.companyId, action: `hostel.penalty_${step}`, entity: 'hostel_damage', entityId: d.id, summary: `Penalty ${next.status}${next.hr ? ` (${next.hr.decision} RM${next.hr.amount}${next.hr.months > 1 ? ` over ${next.hr.months} months` : ''})` : ''}` });
      return u;
    });
  }

  /** P15 step 4: closed when the action is done; the list is updated. */
  async closeDamage(user: User, damageId: Id, note: string) {
    if (fwHostelRole(user) !== 'fwm') throw new AccessDenied('hr.monitor', '(FWM closes)');
    const d = (await this.store.get('hostelRecs', damageId)) as HostelDamage | null;
    if (!d || d.kind !== 'damage') throw new NotFound('Damage report');
    if (d.status !== 'decided') throw new BadRequest('Decide it first.');
    const h = (await this.store.get('hostels', d.hostelId))!;
    const at = this.now();
    const why = txt(note, 'Comment');
    return this.store.transaction(async (tx) => {
      await this.changeList(tx, user, h, 'damage', d.id, (lines) => {
        for (const l of d.lines) {
          const x = lines.find((y) => y.name === l.item);
          if (!x) continue;
          const fixed = d.decision?.action === 'repair' || d.decision?.action === 'replace';
          if (!fixed) {
            const n = Math.min(x.good, l.qty);
            x.good -= n;
            x.damaged += n;
          }
        }
        return lines;
      }, `Damage report closed (${d.decision?.action})`);
      const u = await tx.update('hostelRecs', d.id, { status: 'closed', closed: { by: user.name, byId: user.id, at, note: why } } as never);
      await tx.audit({ at, actor: user.name, companyId: d.companyId, action: 'hostel.damage_close', entity: 'hostel_damage', entityId: d.id, summary: `Closed: ${why}` });
      return u;
    });
  }

  /** P16 (BP): the OM's maintenance request; before photos required; 3 quotes (2 only with the Asset Director's reason later); critical tells OM, FWM and OD/OGM at once. */
  async requestMaint(user: User, hostelId: Id, input: { what: string; critical: boolean; costBy: HostelMaint['costBy']; before: string[]; quotes?: { contractor: string; amount: number; doc: string }[]; reportedById?: Id | null }) {
    const role = fwHostelRole(user);
    if (role !== 'om' && role !== 'company' && role !== 'fwm') throw new AccessDenied('hr.monitor', '(the OM asks for a repair)');
    await this.need('hostelRecs');
    const h = await this.hostelFor(user, hostelId);
    const before = photoList(input.before, 1, 'before the repair');
    if (!['company', 'landlord', 'other'].includes(input.costBy)) throw new BadRequest('Who bears the cost: company, landlord or other.');
    const quotes = (input.quotes ?? []).slice(0, 5).map((q) => ({ contractor: txt(q.contractor, 'Contractor', 2, 100), amount: Math.round(Number(q.amount) * 100) / 100, doc: photoRe.test(String(q.doc ?? '')) || /^data:application\/pdf;base64,/.test(String(q.doc ?? '')) ? String(q.doc) : '' }));
    if (input.costBy === 'company' && quotes.length < 2) throw new BadRequest('Attach 3 contractor quotes (2 only when the Asset Director gives a reason).');
    const st = await this.settings();
    const at = this.now();
    const stays = await this.store.list('hostelStays', { companyId: [h.companyId] });
    const today = this.today();
    const m: HostelMaint = {
      id: `mnt-${h.id}-${Date.parse(at).toString(36)}-${globalThis.crypto.randomUUID().slice(0, 4)}`, kind: 'maint', form: 'BP/HOSTEL/MAINT/FWM/001/2026', companyId: h.companyId, hostelId: h.id, hostelName: h.name, hostelAddress: h.address, sector: h.sector,
      what: txt(input.what, 'What is damaged', 5), critical: !!input.critical, costBy: input.costBy, before, quotes,
      residents: stays.filter((s) => s.hostelId === h.id && s.from <= today && (!s.to || s.to >= today)).length,
      reportedById: input.reportedById ?? null, by: user.name, byId: user.id, at, dueOn: addDays(today, input.critical ? st.maintDays.critical : st.maintDays.normal),
      status: input.costBy === 'landlord' ? 'landlord' : 'reported', fwm: null, decision: null, toldAt: input.critical ? at : null, workOrderId: null, twoQuotesReason: null, contractorNotice: null, landlordDueOn: input.costBy === 'landlord' ? addDays(today, input.critical ? st.maintDays.critical : st.maintDays.normal) : null, done: null,
    };
    await this.store.transaction(async (tx) => {
      await tx.insert('hostelRecs', m);
      await tx.audit({ at, actor: user.name, companyId: h.companyId, action: m.critical ? 'hostel.maint_critical' : 'hostel.maint_request', entity: 'hostel_maint', entityId: m.id, summary: `${m.critical ? 'CRITICAL: OM, FWM and the OD/OGM told at once. ' : ''}${h.name}: ${m.what}${m.costBy === 'landlord' ? ' (landlord to fix)' : ''}` });
    });
    return m;
  }

  /** P16 steps 4-5: FWM checks; OD (private) / OGM (government) approves (critical skips it); Asset Management opens the work order. */
  async maintStep(user: User, maintId: Id, step: 'fwm' | 'approve' | 'reject' | 'order' | 'contractor' | 'done' | 'close', input: { note?: string; contractor?: string; on?: IsoDate; twoQuotesReason?: string; after?: string[] }) {
    const m = (await this.store.get('hostelRecs', maintId)) as HostelMaint | null;
    if (!m || m.kind !== 'maint') throw new NotFound('Maintenance request');
    const role = fwHostelRole(user);
    const at = this.now();
    const sign: FwSign = { by: user.name, byId: user.id, at, note: String(input.note ?? '').slice(0, 300) };
    let patch: Partial<HostelMaint> = {};
    let wo: { id: Id; title: string; source: 'inspection'; raisedOn: IsoDate; dueOn: IsoDate; status: 'open'; cost: number | null; contractor: string | null; doneOn: null; unitId: null; propertyId: null; hostelId: Id; hostelMaintId: Id } | null = null;
    if (step === 'fwm') {
      if (role !== 'fwm') throw new AccessDenied('hr.monitor', '(FWM checks)');
      if (m.status !== 'reported') throw new BadRequest('Not waiting for FWM.');
      patch = { status: m.critical ? 'approved' : 'fwm_checked', fwm: { ...sign, note: txt(input.note, 'FWM report') } };
    } else if (step === 'approve' || step === 'reject') {
      const ok = m.sector === 'government' ? isOgm(user) : actsAsOpsDirector(user);
      if (!ok || user.integration) throw new AccessDenied('hr.monitor', m.sector === 'government' ? '(the OGM approves)' : '(the Operations Director approves)');
      if (m.status !== 'fwm_checked') throw new BadRequest('Not waiting for approval.');
      if (m.byId === user.id) throw new BadRequest('You asked for it. Someone else approves.');
      patch = { status: step === 'approve' ? 'approved' : 'rejected', decision: { ...sign, note: txt(input.note, 'Reason'), approve: step === 'approve' } };
    } else if (step === 'order') {
      if (role !== 'asset') throw new AccessDenied('view', '(Asset Management opens the work order)');
      if (m.status !== 'approved' || m.workOrderId) throw new BadRequest('Not approved, or already ordered.');
      if (m.quotes.length < 3) {
        if (user.assetRole !== 'director') throw new BadRequest('Only 3 quotes, or 2 with the Asset Director’s reason.');
        patch.twoQuotesReason = txt(input.twoQuotesReason, 'Why 2 quotes are enough', 10);
      }
      const low = [...m.quotes].sort((a, b) => a.amount - b.amount)[0];
      wo = { id: `wo-hostel-${m.id}`, title: `${m.hostelName}: ${m.what}`.slice(0, 140), source: 'inspection', raisedOn: this.today(), dueOn: m.dueOn, status: 'open', cost: low?.amount ?? null, contractor: null, doneOn: null, unitId: null, propertyId: null, hostelId: m.hostelId, hostelMaintId: m.id };
      patch = { ...patch, status: 'ordered', workOrderId: wo.id };
    } else if (step === 'contractor') {
      if (role !== 'asset') throw new AccessDenied('view', '(Asset Management)');
      if (m.status !== 'ordered') throw new BadRequest('Order it first.');
      if (!input.on || !isDate(input.on)) throw new BadRequest('Give the work date.');
      patch = { contractorNotice: { ...sign, contractor: txt(input.contractor, 'Contractor', 2, 100), on: input.on } };
    } else if (step === 'done') {
      if (role !== 'om' && role !== 'company') throw new AccessDenied('hr.monitor', '(the OM or supervisor confirms the work)');
      await this.hostelFor(user, m.hostelId);
      if (m.status !== 'ordered' && m.status !== 'landlord') throw new BadRequest('Nothing to confirm.');
      patch = { status: 'done', done: { ...sign, after: photoList(input.after, 1, 'after the repair') } };
    } else {
      if (role !== 'fwm' && role !== 'asset') throw new AccessDenied('hr.monitor', '(FWM or Asset Management closes)');
      if (m.status !== 'done') throw new BadRequest('The OM confirms the work with after photos first.');
      patch = { status: 'closed' };
    }
    return this.store.transaction(async (tx) => {
      if (wo) await tx.insert('amWorkOrders', wo as never);
      const u = await tx.update('hostelRecs', m.id, patch as never);
      await tx.audit({ at, actor: user.name, companyId: m.companyId, action: `hostel.maint_${step}`, entity: 'hostel_maint', entityId: m.id, summary: `${m.hostelName}: ${step}${sign.note ? `: ${sign.note}` : ''}` });
      return u;
    });
  }

  // ---------- P8 needs ----------

  private async makeNeed(tx: Store, user: User, h: Hostel, i: Pick<HostelNeed, 'items' | 'reason' | 'justification' | 'neededBy' | 'quotes' | 'fromDamageId' | 'status' | 'fwm'>): Promise<HostelNeed> {
    const at = this.now();
    const today = this.today();
    const [stays, recs] = await Promise.all([tx.list('hostelStays', { companyId: [h.companyId] }), tx.list('hostelRecs', { companyId: [h.companyId], hostelId: h.id })]);
    const inv = recs.find((r) => r.kind === 'inventory') as HostelInventory | undefined;
    const need: HostelNeed = {
      id: `hn-${h.id}-${Date.parse(at).toString(36)}-${globalThis.crypto.randomUUID().slice(0, 4)}`, form: 'BPPK/HOSTEL/FWM/001/2026', companyId: h.companyId, hostelId: h.id, hostelName: h.name, hostelAddress: h.address, sector: h.sector,
      ...i,
      seen: { residents: stays.filter((s) => s.hostelId === h.id && s.from <= today && (!s.to || s.to >= today)).length, beds: h.beds, goodItems: Object.fromEntries((inv?.lines ?? []).map((l) => [l.name, l.good])), openFindings: recs.filter((r) => r.kind === 'damage' && r.status !== 'closed').length },
      raisedBy: user.name, raisedById: user.id, raisedAt: at, decision: null, returns: [], amAssetId: null, amWorkOrderId: null, delivered: null, received: null,
    };
    await tx.insert('hostelNeeds', need);
    await tx.audit({ at, actor: user.name, companyId: h.companyId, action: 'hostel.need_raise', entity: 'hostel_need', entityId: need.id, summary: `${h.name}: ${need.items.map((x) => `${x.qty} x ${x.name}`).join(', ')}` });
    return need;
  }

  /** P8: the OM raises a hostel need; Prima shows residents, beds, current items and open findings next to it. */
  async raiseNeed(user: User, hostelId: Id, input: { items: { name: string; qty: number; kind?: 'item' | 'repair' }[]; reason: HostelNeedReason; justification: string; neededBy: IsoDate; quotes?: { name: string; data: string }[] }) {
    const role = fwHostelRole(user);
    if (role !== 'om' && role !== 'company') throw new AccessDenied('hr.monitor', '(the OM raises a hostel need)');
    await this.need('hostelNeeds');
    const h = await this.hostelFor(user, hostelId);
    if (!(input.reason in HOSTEL_NEED_REASONS)) throw new BadRequest('Pick the reason.');
    if (!isDate(input.neededBy)) throw new BadRequest('Give the date needed.');
    const items = (input.items ?? []).slice(0, 30).map((x) => ({ name: txt(x.name, 'Item', 2, 80), qty: Math.max(1, Math.min(999, Math.round(Number(x.qty) || 0))), kind: x.kind === 'repair' ? ('repair' as const) : ('item' as const) }));
    if (!items.length) throw new BadRequest('Name at least one item.');
    const quotes = (input.quotes ?? []).slice(0, 2).map((q) => {
      const data = String(q.data ?? '');
      if (!photoRe.test(data) && !/^data:application\/pdf;base64,/.test(data)) throw new BadRequest('A quotation must be a photo or a PDF.');
      return { name: String(q.name ?? 'Quotation').slice(0, 80), sha256: sha256Hex(data), data };
    });
    return this.store.transaction((tx) => this.makeNeed(tx, user, h, { items, reason: input.reason, justification: txt(input.justification, 'Justification', 5), neededBy: input.neededBy, quotes, fromDamageId: null, status: 'submitted', fwm: null }));
  }

  private async needFor(user: User, id: Id): Promise<HostelNeed> {
    const n = await this.store.get('hostelNeeds', id);
    if (!n) throw new NotFound('Hostel need');
    const role = fwHostelRole(user);
    if (role === 'asset') {
      if (!['approved', 'ordered', 'delivered', 'received'].includes(n.status)) throw new NotFound('Hostel need');
      return n;
    }
    if (!role) throw new NotFound('Hostel need');
    if (role === 'om') await this.hostelFor(user, n.hostelId);
    else if (!(await this.companies(user)).includes(n.companyId)) throw new NotFound('Hostel need');
    return n;
  }

  /** P8 steps 1-2: FWM verifies (or returns); OD (private) / OGM (government) approves or rejects the need with a reason. */
  async decideNeed(user: User, id: Id, step: 'fwm' | 'return' | 'approve' | 'reject', note: string, rejectReason?: string | null) {
    const n = await this.needFor(user, id);
    let why = txt(note, step === 'fwm' ? 'Comment' : 'Reason');
    if (step === 'reject') {
      // V7: the reason is picked from the list; "other" is the text itself.
      const r = String(rejectReason ?? '') as HostelNeedRejectReason;
      if (!(r in HOSTEL_NEED_REJECT_REASONS)) throw new BadRequest('Pick why it is refused: form incomplete, reason not justified, wrong details, against policy, no budget, or other.');
      why = r === 'OTHER' ? why : `${HOSTEL_NEED_REJECT_REASONS[r]}: ${why}`;
    }
    const role = fwHostelRole(user);
    const at = this.now();
    const sign: FwSign = { by: user.name, byId: user.id, at, note: why };
    let patch: Partial<HostelNeed>;
    if (step === 'fwm' || step === 'return') {
      if (role !== 'fwm') throw new AccessDenied('hr.monitor', '(FWM verifies)');
      if (n.status !== 'submitted') throw new BadRequest('Not waiting for FWM.');
      patch = step === 'fwm' ? { status: 'fwm_checked', fwm: sign } : { status: 'returned', returns: [...n.returns, { by: user.name, at, reason: why }] };
    } else {
      const ok = n.sector === 'government' ? isOgm(user) : actsAsOpsDirector(user);
      if (!ok || user.integration) throw new AccessDenied('hr.monitor', n.sector === 'government' ? '(the OGM approves)' : '(the Operations Director approves)');
      if (n.status !== 'fwm_checked') throw new BadRequest('FWM verifies first.');
      if (n.raisedById === user.id) throw new BadRequest('You raised it. Someone else approves.');
      patch = { status: step === 'approve' ? 'approved' : 'rejected', decision: { ...sign, approve: step === 'approve' } };
    }
    return this.store.transaction(async (tx) => {
      const u = await tx.update('hostelNeeds', n.id, patch);
      await tx.audit({ at, actor: user.name, companyId: n.companyId, action: `hostel.need_${step}`, entity: 'hostel_need', entityId: n.id, summary: `${n.hostelName}: ${step}: ${why}` });
      return u;
    });
  }

  /** The OM corrects a returned need and sends it again. */
  async resubmitNeed(user: User, id: Id, justification: string) {
    const n = await this.needFor(user, id);
    if (n.status !== 'returned' || n.raisedById !== user.id) throw new BadRequest('Only the OM who raised a returned need sends it again.');
    return this.store.update('hostelNeeds', n.id, { status: 'submitted', justification: txt(justification, 'Justification', 5) });
  }

  /** P8 step 3: Asset Management raises exactly one linked purchase request (items) or one work order (repairs); its own money approval applies. */
  async orderNeed(user: User, id: Id, input: { estCost: number; category?: 'FURNITURE' | 'FITTING'; reason: string }) {
    if (fwHostelRole(user) !== 'asset') throw new AccessDenied('view', '(Asset Management buys hostel needs)');
    const n = await this.needFor(user, id);
    if (n.status !== 'approved') throw new BadRequest('Only an approved need is ordered.');
    if (n.amAssetId || n.amWorkOrderId) throw new BadRequest('This need already has its purchase.');
    const items = n.items.filter((x) => x.kind === 'item');
    const repairs = n.items.filter((x) => x.kind === 'repair');
    const companies = await this.store.list('companies', { id: [n.companyId] }).catch(() => []);
    const owner = companies[0]?.name ?? n.companyId;
    let assetId: Id | null = null;
    if (items.length) {
      const a = await this.svc.amBuyRequest(user, { description: `Hostel need ${n.hostelName}: ${items.map((x) => `${x.qty} x ${x.name}`).join(', ')}`.slice(0, 140), category: input.category ?? 'FURNITURE', qty: items.reduce((s, x) => s + x.qty, 0), estCost: input.estCost, location: n.hostelName, ownerEntity: owner, reason: `${txt(input.reason, 'Reason')} (approved need ${n.id})`, hostelId: n.hostelId, hostelNeedId: n.id });
      assetId = a.id;
    }
    const at = this.now();
    return this.store.transaction(async (tx) => {
      let woId: Id | null = null;
      if (repairs.length) {
        woId = `wo-hneed-${n.id}`;
        await tx.insert('amWorkOrders', { id: woId, title: `${n.hostelName}: ${repairs.map((x) => x.name).join(', ')}`.slice(0, 140), source: 'inspection', raisedOn: this.today(), dueOn: n.neededBy, status: 'open', cost: null, contractor: null, doneOn: null, unitId: null, propertyId: null, hostelId: n.hostelId, hostelNeedId: n.id } as never);
      }
      const u = await tx.update('hostelNeeds', n.id, { status: 'ordered', amAssetId: assetId, amWorkOrderId: woId });
      await tx.audit({ at, actor: user.name, companyId: null, action: 'hostel.need_order', entity: 'hostel_need', entityId: n.id, summary: `${n.hostelName}: purchase ${assetId ?? '-'}, work order ${woId ?? '-'}` });
      return u;
    });
  }

  /** P8 step 4: Asset Management records delivery; the OM (or supervisor) confirms receipt with a photo, which raises the list counts. */
  async needDelivered(user: User, id: Id, on: IsoDate) {
    if (fwHostelRole(user) !== 'asset') throw new AccessDenied('view', '(Asset Management)');
    const n = await this.needFor(user, id);
    if (n.status !== 'ordered') throw new BadRequest('Order it first.');
    if (!isDate(on) || on > this.today()) throw new BadRequest('Give the delivery date, not in the future.');
    const at = this.now();
    return this.store.update('hostelNeeds', n.id, { status: 'delivered', delivered: { by: user.name, byId: user.id, at, note: '', on } });
  }

  async needReceived(user: User, id: Id, photo: string, note?: string) {
    const role = fwHostelRole(user);
    if (role !== 'om' && role !== 'company') throw new AccessDenied('hr.monitor', '(the OM or supervisor confirms receipt)');
    const n = await this.needFor(user, id);
    if (n.status !== 'delivered') throw new BadRequest('Not delivered yet.');
    const [p] = photoList([photo], 1, 'the goods at the hostel', 1);
    const h = (await this.store.get('hostels', n.hostelId))!;
    const at = this.now();
    return this.store.transaction(async (tx) => {
      await this.changeList(tx, user, h, 'need', n.id, (lines) => {
        for (const it of n.items.filter((x) => x.kind === 'item')) {
          const l = lines.find((x) => x.name === it.name);
          if (l) {
            l.good += it.qty;
            l.qty += it.qty;
          } else lines.push({ name: it.name, area: 'Rooms', qty: it.qty, good: it.qty, damaged: 0, missing: 0 });
        }
        return lines;
      }, 'Delivered need received');
      const u = await tx.update('hostelNeeds', n.id, { status: 'received', received: { by: user.name, byId: user.id, at, note: String(note ?? '').slice(0, 300), photo: p.data } });
      await tx.audit({ at, actor: user.name, companyId: n.companyId, action: 'hostel.need_received', entity: 'hostel_need', entityId: n.id, summary: `${n.hostelName}: goods received` });
      return u;
    });
  }

  // ---------- Boards (P10, P17) ----------

  /** The FWM / OM / company / sector board: moves, needs, hostels with capacity and certificate, checks due, damage, maintenance. */
  async board(user: User) {
    const role = fwHostelRole(user);
    if (!role) throw new AccessDenied('view', '(hostels)');
    const today = this.today();
    const nowMs = Date.parse(this.now());
    const st = await this.settings();
    if (role === 'asset') {
      const needs = (await this.installed('hostelNeeds')) ? (await this.store.list('hostelNeeds', {})).filter((n) => ['approved', 'ordered', 'delivered', 'received'].includes(n.status)) : [];
      const maints = (await this.installed('hostelRecs')) ? ((await this.store.list('hostelRecs', {})) as HostelRec[]).filter((r): r is HostelMaint => r.kind === 'maint' && ['approved', 'ordered', 'done'].includes(r.status)) : [];
      // Asset Management: hostel name, address and company only; no residents, no worker names.
      return { role, needs: needs.map(({ seen: _s, raisedBy: _r, ...n }) => n), maints: maints.map(({ reportedById: _x, residents: _y, ...m }) => m), moves: [], hostels: [], settings: null, tiles: { needsToOrder: needs.filter((n) => n.status === 'approved').length, repairsToOrder: maints.filter((m) => m.status === 'approved').length } };
    }
    const ids = await this.companies(user);
    const omHostels = role === 'om' ? await this.omHostelIds(user) : null;
    const [hostels, stays, moves, needs, recs] = await Promise.all([
      this.store.list('hostels', { companyId: ids }),
      this.store.list('hostelStays', { companyId: ids }),
      (await this.installed('fwMoves')) ? this.store.list('fwMoves', {}) : Promise.resolve([] as FwMove[]),
      (await this.installed('hostelNeeds')) ? this.store.list('hostelNeeds', { companyId: ids }) : Promise.resolve([] as HostelNeed[]),
      (await this.installed('hostelRecs')) ? this.store.list('hostelRecs', { companyId: ids }) : Promise.resolve([] as HostelRec[]),
    ]);
    const mine = hostels.filter((h) => !omHostels || omHostels.has(h.id));
    const hostelRows = mine.map((h) => {
      const residents = stays.filter((s) => s.hostelId === h.id && s.from <= today && (!s.to || s.to >= today)).length;
      const checks = (recs as HostelRec[]).filter((r): r is HostelCheck => r.kind === 'check' && r.hostelId === h.id);
      const last = (f: HostelCheck['freq']) => checks.filter((c) => c.freq === f).map((c) => c.on).sort().at(-1) ?? null;
      // Never checked counts as due yesterday, so it shows as overdue at once.
      const due = (f: keyof FwHostelSettings['checkDays']) => {
        const l = last(f);
        return l ? addDays(l, st.checkDays[f]) : addDays(today, -1);
      };
      const certState = !h.cert ? 'missing' : h.cert.expiresOn < today ? 'expired' : 'ok';
      return {
        hostel: { id: h.id, name: h.name, address: h.address, beds: h.beds, companyId: h.companyId, sector: h.sector, supervisor: h.supervisor ?? null, cert: h.cert ? { number: h.cert.number, expiresOn: h.cert.expiresOn } : null, usedByNepalManager: !!h.usedByNepalManager },
        residents,
        over: residents > h.beds,
        certState,
        checks: { weeklyDue: due('weekly'), monthlyDue: due('monthly'), auditDue: due('audit'), sweepDue: due('sweep'), weeklyLate: due('weekly') < today, monthlyLate: due('monthly') < today, sweepLate: due('sweep') < today },
        inventory: ((recs as HostelRec[]).find((r) => r.kind === 'inventory' && r.hostelId === h.id) as HostelInventory | undefined)?.lines ?? [],
        openDamage: (recs as HostelRec[]).filter((r) => r.kind === 'damage' && r.hostelId === h.id && r.status !== 'closed').length,
        openMaint: (recs as HostelRec[]).filter((r) => r.kind === 'maint' && r.hostelId === h.id && r.status !== 'closed').length,
      };
    });
    const seeMoves: FwMove[] = [];
    for (const m of moves) if (await this.canSeeMove(user, m)) seeMoves.push(m);
    const moveRows = [];
    for (const m of seeMoves.sort((a, b) => b.raisedAt.localeCompare(a.raisedAt)).slice(0, 200)) {
      const late = m.status === 'received' && m.receive ? (nowMs - Date.parse(m.receive.at)) / 3_600_000 : 0;
      moveRows.push({ move: { ...m, workers: m.workers.map((w) => ({ ...w })) }, canSign: await this.signable(user, m), notClosedHours: m.status === 'received' ? Math.floor(late) : 0, escalated: late > st.closeEscalateHours, moveLate: moveDoneLate(m, today, st.moveDoneWorkingDays ?? 3, ['approved', 'released', 'moved'].includes(m.status) ? await this.holidays(m.newCompanyId, [Number(today.slice(0, 4)) - 1, Number(today.slice(0, 4))]) : new Set()) });
    }
    const damages = (recs as HostelRec[]).filter((r): r is HostelDamage => r.kind === 'damage' && (!omHostels || omHostels.has(r.hostelId)));
    const maints = (recs as HostelRec[]).filter((r): r is HostelMaint => r.kind === 'maint' && (!omHostels || omHostels.has(r.hostelId)));
    const counts = (recs as HostelRec[]).filter((r): r is HostelCount => r.kind === 'count' && (!omHostels || omHostels.has(r.hostelId)));
    const needRows = needs.filter((n) => !omHostels || omHostels.has(n.hostelId));
    return {
      role,
      settings: role === 'fwm' ? st : null,
      hostels: hostelRows,
      moves: moveRows,
      needs: needRows,
      damages: damages.map((d) => ({ ...d, photos: d.photos.map((p) => ({ sha256: p.sha256 })) })),
      maints: maints.map((m) => ({ ...m, before: m.before.map((p) => ({ sha256: p.sha256 })) })),
      counts,
      tiles: {
        movesWaiting: moveRows.filter((r) => r.move.status === 'submitted').length,
        movesNotClosed24h: moveRows.filter((r) => r.notClosedHours >= st.closeRemindHours).length,
        hostelsOver: hostelRows.filter((h) => h.over).length,
        checksOverdue: hostelRows.filter((h) => h.checks.weeklyLate || h.checks.monthlyLate).length,
        notVisited90: hostelRows.filter((h) => h.checks.sweepLate).length,
        needsWaiting: needRows.filter((n) => ['submitted', 'fwm_checked'].includes(n.status)).length,
        openDamage: damages.filter((d) => d.status !== 'closed').length,
        openMaint: maints.filter((m) => m.status !== 'closed').length,
      },
      reasons: { move: FW_MOVE_REASONS, need: HOSTEL_NEED_REASONS },
    };
  }

  /** Do today items: overdue checks for the OM, steps waiting on the user, moves not closed, late repairs. */
  async homeItems(user: User): Promise<{ tone: 'warn' | 'crit'; tag: string; title: string; detail: string; go: { view: 'hostels' } }[]> {
    const role = fwHostelRole(user);
    if (!role || role === 'act' || role === 'leader') return [];
    if (!(await this.installed('fwMoves')) || !(await this.installed('hostelRecs'))) return [];
    const b = await this.board(user).catch(() => null);
    if (!b) return [];
    const out: { tone: 'warn' | 'crit'; tag: string; title: string; detail: string; go: { view: 'hostels' } }[] = [];
    if ('moves' in b && Array.isArray(b.moves))
      for (const r of b.moves as { move: FwMove; canSign: FwMoveStep[]; notClosedHours: number }[]) {
        if (r.canSign.length) out.push({ tone: 'warn', tag: 'Hostel move', title: `${FW_MOVE_STEP_LABEL[r.canSign[0]]}: ${r.move.workers.length} worker(s)`, detail: `Start ${r.move.startOn}`, go: { view: 'hostels' } });
        const ml = (r as { moveLate?: ReturnType<typeof moveDoneLate> }).moveLate;
        if (ml && role === 'om') out.push({ tone: 'crit', tag: 'Hostel move', title: `Move not done ${ml.days} working day(s) after approval`, detail: `Target ${ml.target} working days. ${r.move.workers.length} worker(s)`, go: { view: 'hostels' } });
        if (ml?.escalate && role === 'sector') out.push({ tone: 'crit', tag: 'Hostel move', title: `Move still not done ${ml.days} working day(s) after approval`, detail: r.move.id, go: { view: 'hostels' } });
        if (role === 'fwm' && r.notClosedHours >= 24) out.push({ tone: 'crit', tag: 'Hostel move', title: `Close the move in JA and Prima (${r.notClosedHours} h since receipt)`, detail: r.move.id, go: { view: 'hostels' } });
      }
    if (role === 'om' && 'hostels' in b)
      for (const h of b.hostels as { hostel: { name: string }; checks: { weeklyLate: boolean; monthlyLate: boolean } }[]) {
        if (h.checks.weeklyLate) out.push({ tone: 'warn', tag: 'Hostel check', title: `Weekly check overdue: ${h.hostel.name}`, detail: 'Clean, safe, things working, 2 photos', go: { view: 'hostels' } });
        if (h.checks.monthlyLate) out.push({ tone: 'warn', tag: 'Hostel check', title: `Monthly visit overdue: ${h.hostel.name}`, detail: 'Inventory and visit report', go: { view: 'hostels' } });
      }
    return out.slice(0, 20);
  }

  /** One entry point for the screens and the API: every action named here, checked inside its own method. */
  async act(user: User, action: string, b: Record<string, unknown>): Promise<unknown> {
    const id = String(b.id ?? '').slice(0, 160);
    const o = <T>(k: string) => b[k] as T;
    switch (action) {
      case 'addStay': return this.addStay(user, { hostelId: id, personId: o<string>('personId'), from: o<string>('from'), room: o<string | null>('room') });
      case 'endStay': return this.endStay(user, id, o<string>('to'), o<string>('reason'));
      case 'hostelDetails': return this.setHostelDetails(user, id, { ...(b.cert !== undefined ? { cert: o('cert') } : {}), ...(b.supervisor !== undefined ? { supervisor: o('supervisor') } : {}), ...(b.usedByManager !== undefined ? { usedByManager: !!b.usedByManager } : {}) }, o<string>('reason'));
      case 'raiseMove': return this.raiseMove(user, b as never);
      case 'decideMove': return this.decideMove(user, id, o<FwMoveStep>('step'), o<'approve' | 'reject' | 'return'>('decision'), o<string>('note'));
      case 'resubmitMove': return this.resubmitMove(user, id, b as never);
      case 'releaseMove': return this.releaseMove(user, id, b as never);
      case 'transitMove': return this.transitMove(user, id, b as never);
      case 'receiveMove': return this.receiveMove(user, id, b as never);
      case 'closeMove': return this.closeMove(user, id, b as never);
      case 'cancelMove': return this.cancelMove(user, id, o<string>('reason'));
      case 'openCount': return this.openCount(user, id);
      case 'submitCount': return this.submitCount(user, id, o('lines'));
      case 'verifyCount': return this.verifyCount(user, id, o<string>('note'));
      case 'ackCount': return this.ackCount(user, id);
      case 'recordCheck': return this.recordCheck(user, id, b as never);
      case 'reportDamage': return this.reportDamage(user, id, b as never);
      case 'decideDamage': return this.decideDamage(user, id, b as never);
      case 'penaltyStep': return this.penaltyStep(user, id, o('step'), b as never);
      case 'closeDamage': return this.closeDamage(user, id, o<string>('note'));
      case 'requestMaint': return this.requestMaint(user, id, b as never);
      case 'maintStep': return this.maintStep(user, id, o('step'), b as never);
      case 'raiseNeed': return this.raiseNeed(user, id, b as never);
      case 'decideNeed': return this.decideNeed(user, id, o('step'), o<string>('note'), o<string | null>('rejectReason'));
      case 'resubmitNeed': return this.resubmitNeed(user, id, o<string>('justification'));
      case 'orderNeed': return this.orderNeed(user, id, b as never);
      case 'needDelivered': return this.needDelivered(user, id, o<string>('on'));
      case 'needReceived': return this.needReceived(user, id, o<string>('photo'), o<string>('note'));
      case 'settings': return this.setSettings(user, o('patch') ?? {}, o<string>('reason'));
      default: throw new BadRequest('Unknown hostel action.');
    }
  }

}
