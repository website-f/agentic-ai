import type { FinSettingsValues } from "./types";
import { AccessDenied } from "./access";
import { isLead } from "./finance";
import { isoDate } from "./finance";
import { noSecrets } from "./finance";
import { requireReason } from "./finance";
import { text } from "./finance";
import type { FinCashCtx } from "./finance-cash";
import { RULES } from "./rules";
import { BadRequest } from "./service";
import { NotFound } from "./service";
import { addDays } from "./time";
import { daysBetween } from "./time";
import type { FinSign } from "./types";
import type { FinStatus } from "./types";
import type { Id } from "./types";
import type { IsoDate } from "./types";


type Out<T> = { patch: Partial<FinStatus>; action: string; summary: string; result: T };
const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (v: unknown, what: string, zero = false): number => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || (!zero && n === 0) || n > 1_000_000_000) throw new BadRequest(`${what}: give an amount in RM.`);
  return r2(n);
};
const staff = (ctx: FinCashCtx) => {
  if (!ctx.a || ctx.a.kind === 'viewer' || ctx.a.kind === 'coo') throw new AccessDenied('view', '(Finance staff)');
};
function addMonth(d: IsoDate): IsoDate {
  const [y, m, day] = d.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}
function addPeriods(p: string, k: number): string {
  const [y, m] = p.split('-').map(Number);
  const t = y * 12 + (m - 1) + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

// ---------- 18. Withholding tax ----------

export type FinWhtType = 'services' | 'royalty' | 'interest' | 'contract' | 'other_income';
export interface FinWht {
  id: Id;
  companyId: Id;
  paymentId: Id | null;
  payee: string;
  country: string;
  type: FinWhtType;
  gross: number;
  rate: number;
  tax: number;
  /** The day the non-resident was paid or credited. */
  paidOn: IsoDate;
  dueOn: IsoDate;
  /** A tax treaty rate, with the certificate of residence on file. */
  treaty: { rate: number; doc: string } | null;
  added: FinSign;
  remitted: (FinSign & { on: IsoDate; receipt: string; amount: number; penalty: number }) | null;
  checked: FinSign | null;
}

export function finWhtDue(paidOn: IsoDate): IsoDate {
  return addMonth(paidOn);
}

/** The late payment penalty: 10% of the tax not paid by the due day (s.107A(4), s.109(2), s.109B(2)). */
export function finWhtPenalty(w: Pick<FinWht, 'tax' | 'dueOn'>, on: IsoDate): number {
  return on > w.dueOn ? r2(w.tax * (RULES.financeWht.value.latePenaltyPct / 100)) : 0;
}

export function finWhtAction(ctx: FinCashCtx, f: FinStatus, action: string, input: Record<string, unknown>): Out<unknown> {
  staff(ctx);
  const list = f.wht ?? [];
  const save = (w: FinWht) => ({ wht: list.some((x) => x.id === w.id) ? list.map((x) => (x.id === w.id ? w : x)) : [...list, w] });
  const rates = RULES.financeWht.value.rates;
  if (action === 'add') {
    const type = (Object.keys(rates) as FinWhtType[]).find((k) => k === input.type);
    if (!type) throw new BadRequest(`Type: ${Object.keys(rates).join(', ')}.`);
    const p = typeof input.paymentId === 'string' && input.paymentId ? (f.payments ?? []).find((x) => x.id === input.paymentId) : null;
    if (input.paymentId && !p) throw new NotFound('Payment');
    if (p && list.some((x) => x.paymentId === p.id)) throw new BadRequest('This payment already has its withholding tax.');
    const gross = p ? p.amount : money(input.gross, 'Gross amount paid or credited');
    const paidOn = p?.releasedOn ?? isoDate(input.paidOn, 'Day paid or credited');
    if (paidOn > ctx.today) throw new BadRequest('The day paid cannot be in the future.');
    const treatyRate = input.treatyRate == null || input.treatyRate === '' ? null : Number(input.treatyRate);
    if (treatyRate != null && (!Number.isFinite(treatyRate) || treatyRate < 0 || treatyRate >= rates[type]))
      throw new BadRequest(`A treaty rate is lower than the ${rates[type]}% rate.`);
    const treaty =
      treatyRate != null ? { rate: treatyRate, doc: noSecrets(text(input.treatyDoc, 'Certificate of residence (file name)', 3, 200), 'Document') } : null;
    const rate = treaty ? treaty.rate : rates[type];
    // Paid net (the payee gets the gross less the tax) unless the company bears it; the tax is on the gross.
    const w: FinWht = {
      id: `wht-${f.companyId}-${String(list.length + 1).padStart(3, '0')}`,
      companyId: f.companyId,
      paymentId: p?.id ?? null,
      payee: p?.payee ?? noSecrets(text(input.payee, 'Non-resident paid', 2, 160), 'Payee'),
      country: noSecrets(text(input.country, 'Country of residence', 2, 60), 'Country'),
      type,
      gross,
      rate,
      tax: r2((gross * rate) / 100),
      paidOn,
      dueOn: finWhtDue(paidOn),
      treaty,
      added: ctx.sign(),
      remitted: null,
      checked: null,
    };
    return {
      patch: save(w),
      action: 'finance.wht.added',
      summary: `Withholding tax ${type} ${rate}% on RM${gross.toFixed(2)} to ${w.payee} (${w.country}): RM${w.tax.toFixed(2)} due to LHDN by ${w.dueOn}.`,
      result: w,
    };
  }
  const w = list.find((x) => x.id === input.whtId);
  if (!w) throw new NotFound('Withholding tax');
  if (action === 'remit') {
    if (w.remitted) throw new BadRequest('Already remitted.');
    const on = isoDate(input.on ?? ctx.today, 'Day paid to LHDN');
    if (on > ctx.today) throw new BadRequest('The day cannot be in the future.');
    const penalty = finWhtPenalty(w, on);
    const amount = money(input.amount, 'Amount paid to LHDN');
    if (Math.abs(amount - r2(w.tax + penalty)) >= 0.005)
      throw new BadRequest(`Pay exactly RM${(w.tax + penalty).toFixed(2)} (tax${penalty ? ` and the 10% late penalty RM${penalty.toFixed(2)}` : ''}).`);
    const next: FinWht = {
      ...w,
      remitted: { ...ctx.sign(), on, receipt: noSecrets(text(input.receipt, "LHDN's receipt number", 3, 60), 'Receipt'), amount, penalty },
    };
    return {
      patch: save(next),
      action: 'finance.wht.remitted',
      summary: `Withholding tax ${w.id} RM${amount.toFixed(2)} paid to LHDN on ${on} (${next.remitted!.receipt}).`,
      result: next,
    };
  }
  if (action === 'check') {
    if (!ctx.reviewer) throw new AccessDenied('view', '(the deputy, the team leader, the Finance Director or the CEO checks it)');
    if (!w.remitted) throw new BadRequest('Check it once it is paid to LHDN.');
    if (w.checked) throw new BadRequest('Already checked.');
    if ([w.added.byId, w.remitted.byId].includes(ctx.user.id)) throw new AccessDenied('view', '(not by whoever entered or paid it)');
    const next: FinWht = { ...w, checked: ctx.sign(text(input.comment, 'What you checked (receipt, rate, form)', 5, 300)) };
    return { patch: save(next), action: 'finance.wht.checked', summary: `Withholding tax ${w.id} checked.`, result: next };
  }
  throw new BadRequest('Unknown action.');
}

// ---------- 21. Prepayments and accruals ----------

export interface FinSchedule {
  id: Id;
  companyId: Id;
  kind: 'prepayment' | 'accrual';
  what: string;
  /** Where it goes in SQL Account (expense account), as staff name it. */
  account: string;
  total: number;
  /** First month, YYYY-MM, and how many months. */
  from: string;
  months: number;
  added: FinSign;
  /** Each month's journal in SQL Account. */
  posted: { period: string; jv: string; by: string; byId: Id; at: string }[];
  stopped: FinSign | null;
}

/** Each month's amount: the total spread evenly, the last month taking the cents left over. */
export function finScheduleLines(s: FinSchedule) {
  const each = Math.floor((s.total / s.months) * 100) / 100;
  return Array.from({ length: s.months }, (_, i) => {
    const period = addPeriods(s.from, i);
    const amount = i === s.months - 1 ? r2(s.total - each * (s.months - 1)) : each;
    const post = s.posted.find((p) => p.period === period) ?? null;
    return { period, amount, posted: post };
  });
}

export function finScheduleAction(ctx: FinCashCtx, f: FinStatus, action: string, input: Record<string, unknown>): Out<unknown> {
  staff(ctx);
  const list = f.schedules ?? [];
  const save = (s: FinSchedule) => ({ schedules: list.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? s : x)) : [...list, s] });
  if (action === 'add') {
    const kind = input.kind === 'accrual' ? 'accrual' : input.kind === 'prepayment' ? 'prepayment' : null;
    if (!kind) throw new BadRequest('Type: prepayment or accrual.');
    const from = typeof input.from === 'string' && /^\d{4}-\d{2}$/.test(input.from) ? input.from : '';
    if (!from) throw new BadRequest('First month (YYYY-MM).');
    const months = Number(input.months);
    if (!Number.isInteger(months) || months < 1 || months > 60) throw new BadRequest('Months: 1 to 60.');
    const s: FinSchedule = {
      id: `sch-${f.companyId}-${String(list.length + 1).padStart(3, '0')}`,
      companyId: f.companyId,
      kind,
      what: noSecrets(text(input.what, 'What it is (e.g. fire insurance 2027)', 3, 160), 'What'),
      account: noSecrets(text(input.account, 'SQL Account expense account', 2, 80), 'Account'),
      total: money(input.total, 'Total'),
      from,
      months,
      added: ctx.sign(),
      posted: [],
      stopped: null,
    };
    return {
      patch: save(s),
      action: 'finance.schedule.added',
      summary: `${kind} "${s.what}" RM${s.total.toFixed(2)} over ${months} month(s) from ${from}.`,
      result: s,
    };
  }
  const s = list.find((x) => x.id === input.scheduleId);
  if (!s) throw new NotFound('Schedule');
  if (action === 'post') {
    const period = typeof input.period === 'string' ? input.period : '';
    const line = finScheduleLines(s).find((x) => x.period === period);
    if (!line) throw new BadRequest('That month is not on the schedule.');
    if (line.posted) throw new BadRequest('Already posted.');
    const sign = ctx.sign();
    const next: FinSchedule = {
      ...s,
      posted: [
        ...s.posted,
        { period, jv: noSecrets(text(input.jv, 'SQL Account journal number', 2, 40), 'Journal'), by: sign.by, byId: sign.byId, at: sign.at },
      ],
    };
    return {
      patch: save(next),
      action: 'finance.schedule.posted',
      summary: `"${s.what}" ${period}: RM${line.amount.toFixed(2)} posted (${next.posted[next.posted.length - 1].jv}).`,
      result: next,
    };
  }
  if (action === 'stop') {
    if (!ctx.senior) throw new AccessDenied('view', '(the team leader, the Finance Director or the CEO stops a schedule)');
    const why = requireReason(input.comment, 'stop it (policy cancelled, cost billed)');
    const next: FinSchedule = { ...s, stopped: ctx.sign(why) };
    return { patch: save(next), action: 'finance.schedule.stopped', summary: `"${s.what}" stopped: ${why}`, result: next };
  }
  throw new BadRequest('Unknown action.');
}

// ---------- 22. Fixed assets and capital allowances ----------

export type FinAssetClass = 'general' | 'heavy_vehicle' | 'office' | 'computer' | 'motor_car' | 'small_value' | 'building';
export interface FinAsset {
  id: Id;
  companyId: Id;
  name: string;
  /** SQL Account's fixed asset code, so the two lists can be agreed. */
  sqlCode: string;
  cls: FinAssetClass;
  cost: number;
  acquiredOn: IsoDate;
  /** Motor car only: bought new and cost RM150,000 or less (qualifying cost up to RM100,000, else RM50,000). */
  newCarUnder150k?: boolean;
  disposed: (FinSign & { on: IsoDate; proceeds: number }) | null;
  added: FinSign;
}

/** The capital allowance for a year of assessment (calendar year, 31 Dec year end): initial in the year bought, annual each year until used up. */
/**
 * The company's tax size (Fauzan, 2 Nov 2026: most companies have paid-up capital up to RM1.1 million; Merdeka, PWVSB and
 * Sutera Engineering RM5 million). Income Tax Act 1967 Schedule 1 para 2A: an SME has paid-up capital of RM2.5 million or
 * less and gross business income of RM50 million or less, and is not more than 50% owned (directly or indirectly) by a
 * company above RM2.5 million paid-up, nor owns more than 50% of one. The FD records the facts; Prima works out the result.
 */
export interface FinTaxProfile {
  paidUp: number;
  grossIncome: number;
  /** More than 50% owned by, or owning more than 50% of, a company with paid-up capital above RM2.5 million. */
  bigRelated: boolean;
  sme: boolean;
  set: FinSign;
}

/** C4 (Fauzan, 11 Nov 2026): the year-end rates and caps in force, the Finance Director's settings over the rule. */
export function finYearEndRule(s?: Partial<FinSettingsValues>) {
  const r = RULES.financeYearEnd.value;
  if (!s) return r;
  return {
    ...r,
    initialPct: s.caInitialPct ?? r.initialPct,
    annualPct: {
      general: s.caGeneralPct ?? r.annualPct.general,
      heavy_vehicle: s.caHeavyVehiclePct ?? r.annualPct.heavy_vehicle,
      office: s.caOfficePct ?? r.annualPct.office,
      computer: s.caComputerPct ?? r.annualPct.computer,
      motor_car: s.caMotorCarPct ?? r.annualPct.motor_car,
    },
    smallValueMax: s.smallValueMax ?? r.smallValueMax,
    smallValueCap: s.smallValueCap ?? r.smallValueCap,
    motorCarCapNew: s.motorCarCapNew ?? r.motorCarCapNew,
    motorCarCapOther: s.motorCarCapOther ?? r.motorCarCapOther,
    smePaidUpMax: s.smePaidUpMax ?? r.smePaidUpMax,
    smeIncomeMax: s.smeIncomeMax ?? r.smeIncomeMax,
    auditRequestDays: s.auditRequestDays ?? r.auditRequestDays,
  };
}

export function finIsSme(p: Pick<FinTaxProfile, 'paidUp' | 'grossIncome' | 'bigRelated'>, s?: Partial<FinSettingsValues>) {
  const r = finYearEndRule(s);
  return p.paidUp <= r.smePaidUpMax && p.grossIncome <= r.smeIncomeMax && !p.bigRelated;
}

export function finCapitalAllowances(assets: FinAsset[], year: number, sme: boolean | null = null, s?: Partial<FinSettingsValues>) {
  const r = finYearEndRule(s);
  const rows = assets
    .filter((a) => Number(a.acquiredOn.slice(0, 4)) <= year && !(a.disposed && Number(a.disposed.on.slice(0, 4)) < year))
    .map((a) => {
      const qe = a.cls === 'motor_car' ? Math.min(a.cost, a.newCarUnder150k ? r.motorCarCapNew : r.motorCarCapOther) : a.cost;
      if (a.cls === 'building')
        return {
          assetId: a.id,
          name: a.name,
          cls: a.cls,
          qe,
          initial: 0,
          annual: 0,
          total: 0,
          residual: qe,
          note: 'Not plant or machinery: industrial building allowance only if it qualifies',
        };
      if (a.cls === 'small_value') {
        const first = Number(a.acquiredOn.slice(0, 4)) === year;
        return {
          assetId: a.id,
          name: a.name,
          cls: a.cls,
          qe,
          initial: 0,
          annual: first ? qe : 0,
          total: first ? qe : 0,
          residual: 0,
          note: `Small value asset (RM${r.smallValueMax} or less each): 100% in the year bought`,
        };
      }
      const aa = r.annualPct[a.cls] / 100;
      const ia = r.initialPct / 100;
      let residual = qe;
      let initial = 0;
      let annual = 0;
      for (let y = Number(a.acquiredOn.slice(0, 4)); y <= year && residual > 0.005; y++) {
        const i = y === Number(a.acquiredOn.slice(0, 4)) ? Math.min(residual, qe * ia) : 0;
        const an = Math.min(residual - i, qe * aa);
        residual -= i + an;
        if (y === year) [initial, annual] = [i, an];
      }
      return {
        assetId: a.id,
        name: a.name,
        cls: a.cls,
        qe: r2(qe),
        initial: r2(initial),
        annual: r2(annual),
        total: r2(initial + annual),
        residual: r2(Math.max(0, residual)),
        note: '',
      };
    });
  const smallTotal = rows.filter((x) => x.cls === 'small_value').reduce((n, x) => n + x.total, 0);
  return {
    year,
    rows,
    total: r2(rows.reduce((n, x) => n + x.total, 0)),
    // The RM20,000 yearly cap on small value assets does not apply to an SME; unknown size shows the cap as a warning.
    smallValueOverCap: sme !== true && smallTotal > r.smallValueCap ? r2(smallTotal - r.smallValueCap) : 0,
    sme,
  };
}

export function finAssetAction(ctx: FinCashCtx, f: FinStatus, action: string, input: Record<string, unknown>): Out<unknown> {
  staff(ctx);
  const list = f.fixedAssets ?? [];
  const save = (a: FinAsset) => ({ fixedAssets: list.some((x) => x.id === a.id) ? list.map((x) => (x.id === a.id ? a : x)) : [...list, a] });
  const classes = Object.keys(RULES.financeYearEnd.value.annualPct).concat(['small_value', 'building']) as FinAssetClass[];
  if (action === 'add') {
    const cls = classes.find((k) => k === input.cls);
    if (!cls) throw new BadRequest(`Class: ${classes.join(', ')}.`);
    const cost = money(input.cost, 'Cost');
    if (cls === 'small_value' && cost > finYearEndRule(ctx.fs).smallValueMax)
      throw new BadRequest(`A small value asset costs RM${finYearEndRule(ctx.fs).smallValueMax} or less.`);
    const acquiredOn = isoDate(input.acquiredOn, 'Bought on');
    if (acquiredOn > ctx.today) throw new BadRequest('"Bought on" cannot be in the future.');
    const sqlCode = noSecrets(text(input.sqlCode, 'SQL Account asset code', 1, 40), 'Code');
    if (list.some((x) => x.sqlCode === sqlCode && !x.disposed)) throw new BadRequest('That SQL Account code is already on the list.');
    const a: FinAsset = {
      id: `fa-${f.companyId}-${String(list.length + 1).padStart(4, '0')}`,
      companyId: f.companyId,
      name: noSecrets(text(input.name, 'Asset', 2, 160), 'Asset'),
      sqlCode,
      cls,
      cost,
      acquiredOn,
      ...(cls === 'motor_car' ? { newCarUnder150k: input.newCarUnder150k === true || input.newCarUnder150k === 'yes' } : {}),
      disposed: null,
      added: ctx.sign(),
    };
    return {
      patch: save(a),
      action: 'finance.asset.added',
      summary: `Asset ${a.sqlCode} ${a.name} (${cls}) RM${cost.toFixed(2)} bought ${acquiredOn}.`,
      result: a,
    };
  }
  if (action === 'profile') {
    if (!ctx.a || !isLead(ctx.a)) throw new AccessDenied('view', "(the Finance Director or the CEO records the company's tax size)");
    const paidUp = money(input.paidUp, 'Paid-up capital', true);
    const grossIncome = money(input.grossIncome, 'Gross business income, last year', true);
    if (typeof input.bigRelated !== 'boolean')
      throw new BadRequest(
        'Say whether a company above RM2.5 million paid-up owns more than 50% of this one, or this one owns more than 50% of it (yes or no).',
      );
    const p = { paidUp, grossIncome, bigRelated: input.bigRelated };
    const profile: FinTaxProfile = { ...p, sme: finIsSme(p, ctx.fs), set: ctx.sign(text(input.comment ?? 'From SSM and the accounts', 'Where it comes from', 3, 300)) };
    return {
      patch: { taxProfile: profile },
      action: 'finance.tax.profile',
      summary: `Tax size: paid-up RM${paidUp.toFixed(2)}, gross income RM${grossIncome.toFixed(2)}, ${p.bigRelated ? 'related to a big company' : 'no big related company'}: ${profile.sme ? 'SME' : 'not an SME'}.`,
      result: profile,
    };
  }
  if (action === 'agree') {
    // The register in SQL Account at a year end: its total cost must equal the list, or the difference is explained.
    if (!ctx.reviewer) throw new AccessDenied('view', '(the deputy, the team leader, the Finance Director or the CEO agrees the register)');
    const year = Number(input.year);
    if (!Number.isInteger(year) || year < 2000 || year > Number(ctx.today.slice(0, 4))) throw new BadRequest('Year end (e.g. 2026).');
    const sqlCost = money(input.sqlCost, "SQL Account register's total cost", true);
    const listCost = r2(
      list.filter((x) => x.acquiredOn <= `${year}-12-31` && !(x.disposed && x.disposed.on <= `${year}-12-31`)).reduce((n, x) => n + x.cost, 0),
    );
    const diff = r2(sqlCost - listCost);
    const note = Math.abs(diff) >= 0.005 ? requireReason(input.comment, `explain the RM${diff.toFixed(2)} difference`) : '';
    const rec = { year, sqlCost, listCost, diff, sign: ctx.sign(note) };
    return {
      patch: { faAgreed: [...(f.faAgreed ?? []).filter((x) => x.year !== year), rec] },
      action: 'finance.asset.agreed',
      summary: `Fixed assets ${year}: SQL Account RM${sqlCost.toFixed(2)}, list RM${listCost.toFixed(2)}${diff ? `, difference RM${diff.toFixed(2)}: ${note}` : ', agreed'}.`,
      result: rec,
    };
  }
  const a = list.find((x) => x.id === input.assetId);
  if (!a) throw new NotFound('Asset');
  if (action === 'dispose') {
    if (a.disposed) throw new BadRequest('Already disposed.');
    const on = isoDate(input.on ?? ctx.today, 'Disposed on');
    const next: FinAsset = {
      ...a,
      disposed: {
        ...ctx.sign(requireReason(input.comment, 'record the disposal (sold, scrapped, lost)')),
        on,
        proceeds: money(input.proceeds ?? 0, 'Proceeds', true),
      },
    };
    return {
      patch: save(next),
      action: 'finance.asset.disposed',
      summary: `Asset ${a.sqlCode} ${a.name} disposed ${on}: ${next.disposed!.comment}.`,
      result: next,
    };
  }
  throw new BadRequest('Unknown action.');
}

// ---------- 23. Auditor requests ----------

export interface FinAuditRequest {
  id: Id;
  companyId: Id;
  /** The financial year audited (31 Dec year end). */
  year: number;
  item: string;
  askedOn: IsoDate;
  ownerId: Id;
  owner: string;
  dueOn: IsoDate;
  added: FinSign;
  sent: (FinSign & { on: IsoDate; doc: string }) | null;
}

export function finAuditRequestAction(ctx: FinCashCtx, f: FinStatus, action: string, input: Record<string, unknown>): Out<unknown> {
  staff(ctx);
  const list = f.auditRequests ?? [];
  const save = (x: FinAuditRequest) => ({ auditRequests: list.some((y) => y.id === x.id) ? list.map((y) => (y.id === x.id ? x : y)) : [...list, x] });
  if (action === 'add') {
    const owner = typeof input.ownerId === 'string' ? ctx.userById(input.ownerId) : undefined;
    if (!owner) throw new BadRequest('Choose who prepares it.');
    const askedOn = isoDate(input.askedOn ?? ctx.today, 'Asked on');
    const year = Number(input.year);
    if (!Number.isInteger(year) || year < 2000 || year > Number(ctx.today.slice(0, 4))) throw new BadRequest('The year audited (e.g. 2026).');
    const items = String(input.item ?? '')
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 50);
    if (!items.length) throw new BadRequest("List the auditor's items, one per line.");
    const dueOn = isoDate(input.dueOn ?? addDays(askedOn, finYearEndRule(ctx.fs).auditRequestDays), 'Due on');
    const added = items.map((it, i) => ({
      id: `aud-${f.companyId}-${year}-${String(list.length + i + 1).padStart(3, '0')}`,
      companyId: f.companyId,
      year,
      item: noSecrets(it.slice(0, 300), 'Item'),
      askedOn,
      ownerId: owner.id,
      owner: owner.name,
      dueOn,
      added: ctx.sign(),
      sent: null,
    }));
    return {
      patch: { auditRequests: [...list, ...added] },
      action: 'finance.audit.requested',
      summary: `${added.length} auditor request(s) for ${year}, prepared by ${owner.name}, due ${dueOn}.`,
      result: added,
    };
  }
  const r = list.find((x) => x.id === input.requestId);
  if (!r) throw new NotFound('Auditor request');
  if (action === 'sent') {
    if (r.sent) throw new BadRequest('Already sent.');
    const next: FinAuditRequest = {
      ...r,
      sent: { ...ctx.sign(), on: ctx.today, doc: noSecrets(text(input.doc, 'What was sent (file name or SharePoint link)', 3, 300), 'Document') },
    };
    return { patch: save(next), action: 'finance.audit.sent', summary: `Auditor request "${r.item}" sent.`, result: next };
  }
  throw new BadRequest('Unknown action.');
}

// ---------- Close, home and view ----------

export function finYearEndExceptions(f: FinStatus, period: string, today: IsoDate) {
  const out: { key: string; text: string }[] = [];
  for (const w of f.wht ?? [])
    if (!w.remitted && w.dueOn.slice(0, 7) <= period)
      out.push({ key: `wht:${w.id}`, text: `Withholding tax RM${w.tax.toFixed(2)} on ${w.payee} due ${w.dueOn}, not paid to LHDN` });
  for (const s of f.schedules ?? []) {
    if (s.stopped) continue;
    for (const l of finScheduleLines(s))
      if (l.period <= period && !l.posted && l.period >= addPeriods(today.slice(0, 7), -3))
        out.push({
          key: `sch:${s.id}:${l.period}`,
          text: `${s.kind === 'prepayment' ? 'Prepayment' : 'Accrual'} "${s.what}" ${l.period}: RM${l.amount.toFixed(2)} not posted in SQL Account`,
        });
  }
  return out;
}

export function finYearEndHome(f: FinStatus, period: string, today: IsoDate, userId: Id, reviewer: boolean) {
  return {
    whtLate: (f.wht ?? []).filter((w) => !w.remitted && w.dueOn < today).length,
    whtSoon: (f.wht ?? []).filter((w) => !w.remitted && w.dueOn >= today && daysBetween(today, w.dueOn) <= 7).length,
    whtToCheck: reviewer ? (f.wht ?? []).filter((w) => w.remitted && !w.checked && w.added.byId !== userId && w.remitted.byId !== userId).length : 0,
    toPost: (f.schedules ?? []).filter(
      (s) => !s.stopped && finScheduleLines(s).some((l) => l.period <= period && !l.posted && l.period >= addPeriods(today.slice(0, 7), -3)),
    ).length,
    auditMine: (f.auditRequests ?? []).filter((r) => !r.sent && r.ownerId === userId).length,
    auditLate: (f.auditRequests ?? []).filter((r) => !r.sent && r.dueOn < today).length,
  };
}

export function finYearEndView(f: FinStatus, today: IsoDate, s?: Partial<FinSettingsValues>) {
  const year = Number(today.slice(0, 4)) - (today.slice(5) < '04-01' ? 1 : 0);
  return {
    wht: (f.wht ?? []).map((w) => ({ ...w, late: !w.remitted && w.dueOn < today, penaltyNow: w.remitted ? w.remitted.penalty : finWhtPenalty(w, today) })),
    whtRates: RULES.financeWht.value.rates,
    schedules: (f.schedules ?? []).map((s) => ({ ...s, lines: finScheduleLines(s) })),
    assets: f.fixedAssets ?? [],
    allowances: finCapitalAllowances(f.fixedAssets ?? [], year, f.taxProfile?.sme ?? null, s),
    taxProfile: f.taxProfile ?? null,
    agreed: (f.faAgreed ?? []).sort((a, b) => b.year - a.year),
    audit: (f.auditRequests ?? [])
      .map((r) => ({ ...r, late: !r.sent && r.dueOn < today }))
      .sort((a, b) => Number(!!a.sent) - Number(!!b.sent) || a.dueOn.localeCompare(b.dueOn)),
    year,
  };
}