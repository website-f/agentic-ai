// Regular payments and guarantees (Fauzan, 2 Nov 2026): "how about hostel payment, hire purchase payment, bills payment,
// building loan payment, pcb payment, zakat payment ... we have also insurance payment, insurance guarantee, IG, BG.
// IG can claim back the cash collateral when the IG is expired or released from client."
//
// One list per company of what it pays again and again. Prima works out each due date, has transfers paid as ordinary
// Prima payments for exactly the due amount, finds direct debits on the loaded bank statement, warns before and after
// the due date, and keeps the month-end close open while one is unpaid or unseen. Guarantees: Prima watches the expiry,
// the client's release, the claim for the cash collateral and finds the refund on the bank statement. Hostel bills stay
// paid by the companies (FWM's flow); Finance sees them and Prima finds each paid one on the company's bank statement.
// Prima never approves or pays anything.
import { AccessDenied } from './access';
import { isLead, isoDate, noSecrets, requireReason, text, type FinActor } from './finance';
import { BadRequest, NotFound } from './service';
import { addDays, dateOf, daysBetween } from './time';
import type {
  FinGuarantee,
  FinRegular,
  FinRegularDue,
  FinRegularEvery,
  FinRegularKind,
  FinSettingsValues,
  FinSign,
  FinStatement,
  FinStatus,
  FinSubject,
  HostelBill,
  Id,
  IsoDate,
  IsoDateTime,
  User,
} from './types';

export const FIN_REGULAR_KINDS: FinRegularKind[] = ['hire_purchase', 'loan', 'bill', 'rent', 'insurance', 'statutory', 'zakat', 'tax', 'levy', 'other'];
/** Statutory bodies (paid by the 15th of the next month, except CP204 instalments on the 15th of each month). */
export const FIN_STATUTORY_BODIES = ['EPF', 'PERKESO', 'HRD Corp', 'LHDN PCB', 'LHDN CP204'];
/** Bodies whose monthly amount the staff payroll works out (EPF and SOCSO tables, PCB, HRD levy). */
export const FIN_PAYROLL_BODIES = ['EPF', 'PERKESO', 'HRD Corp', 'LHDN PCB'];
/** The zakat bodies the companies pay (Fauzan, 2 Nov 2026). */
export const FIN_ZAKAT_BODIES = ['Zakat Kuala Lumpur', 'Zakat Selangor', 'Zakat Kedah', 'Zakat Perlis'];
/** Kinds that are always Finance payments, approved by the Finance Director (Fauzan, 2 Nov 2026: "1. fd") or the CEO. */
const FD_KINDS: FinRegularKind[] = ['statutory', 'zakat', 'tax', 'levy'];
const SUBJECTS: FinSubject[] = ['finance', 'operations', 'it', 'fwm', 'inventory', 'transport', 'goodwill'];
/** How many days ahead a due date shows and a payment is prepared; how far ahead an expiry is warned. */
export const FIN_REGULAR_RULE = { aheadDays: 7, expiryWarnDays: 60, unusualHigh: 1.25, unusualLow: 0.5, claimWaitDays: 30, claimAfterDays: 14 };

const round2 = (n: number) => Math.round(n * 100) / 100;
const norm = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, '');
const AUTO = 'Prima (automatic)';

function money(v: unknown, field: string, allowZero = false): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : Number.NaN;
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) throw new BadRequest(`${field} must be ${allowZero ? 'RM0.00 or more' : 'more than RM0.00'}.`);
  return round2(n);
}
function docs(v: unknown, field: string, min = 1): string[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? [v] : [];
  if (list.length < min) throw new BadRequest(`Attach ${min === 1 ? 'the' : `at least ${min}`} ${field}.`);
  return list.slice(0, 10).map((d, i) => noSecrets(text(d, `${field} ${i + 1}`, 2, 300), field));
}

// ---------- Due dates ----------

function dayIn(period: string, day: number): IsoDate {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${String(Math.min(day, last)).padStart(2, '0')}`;
}
function addMonths(period: string, k: number): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + k, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const STEP: Record<FinRegularEvery, number> = { monthly: 1, quarterly: 3, yearly: 12 };

/** Every due date from the first one up to `until` (and never after the last one), with what is stored for each. */
export function finRegularDues(r: FinRegular, until: IsoDate): FinRegularDue[] {
  const out: FinRegularDue[] = [];
  const stored = new Map(r.dues.map((d) => [d.period, d]));
  const end = r.lastDue && r.lastDue < until ? r.lastDue : until;
  for (let p = r.firstDue.slice(0, 7), i = 0; i < 600; p = addMonths(p, STEP[r.every]), i++) {
    const dueOn = dayIn(p, r.dueDay);
    if (dueOn > end) break;
    if (dueOn < r.firstDue) continue;
    out.push(stored.get(p) ?? { period: p, dueOn, bill: null, paymentId: null, debited: null });
  }
  return out;
}

/** The amount due: the fixed instalment, or what this period's bill or contribution file says. */
export function finRegularExpected(r: FinRegular, d: FinRegularDue): number | null {
  return r.amount ?? d.bill?.amount ?? null;
}

export type FinRegularState = 'upcoming' | 'no_bill' | 'due' | 'prepared' | 'paid' | 'late' | 'not_seen';

/** Where one due date stands. A direct debit is "not seen" once its month's statement is loaded and the bank line is not there. */
export function finRegularState(f: FinStatus, r: FinRegular, d: FinRegularDue, today: IsoDate, s: Pick<FinSettingsValues, 'matchDays'>): FinRegularState {
  const expected = finRegularExpected(r, d);
  const soon = daysBetween(today, d.dueOn) <= FIN_REGULAR_RULE.aheadDays;
  if (r.method === 'direct_debit') {
    if (d.debited) return 'paid';
    const lastDay = addDays(d.dueOn, s.matchDays);
    const loaded = [d.dueOn.slice(0, 7), lastDay.slice(0, 7)].every((p) => (f.statements ?? []).some((st) => st.bankId === r.bankId && st.period === p));
    if (today > lastDay && loaded) return 'not_seen';
    if (expected == null) return soon || today > d.dueOn ? 'no_bill' : 'upcoming';
    return today > lastDay ? 'late' : soon ? 'due' : 'upcoming';
  }
  const p = d.paymentId ? (f.payments ?? []).find((x) => x.id === d.paymentId) : null;
  if (p && p.status === 'released') return 'paid';
  if (p && !['cancelled'].includes(p.status)) return today > d.dueOn ? 'late' : 'prepared';
  if (expected == null) return soon || today > d.dueOn ? 'no_bill' : 'upcoming';
  return today > d.dueOn ? 'late' : soon ? 'due' : 'upcoming';
}

/** For createPayment: the due date being paid, its exact amount, and the payee and subject the payment must carry. */
export function finRegularForPayment(f: FinStatus, regularId: unknown, period: unknown, today: IsoDate) {
  const r = (f.regular ?? []).find((x) => x.id === regularId);
  if (!r) throw new NotFound('Regular payment');
  if (r.status !== 'active') throw new BadRequest(`${r.name} is ${r.status === 'pending' ? 'waiting to be checked by a second person' : 'ended'}; it cannot be paid from the list.`);
  if (r.method !== 'transfer') throw new BadRequest(`${r.name} is paid by direct debit; Prima finds it on the bank statement.`);
  const d = finRegularDues(r, addDays(today, 40)).find((x) => x.period === period);
  if (!d) throw new BadRequest(`${r.name} has no payment due for ${String(period)}.`);
  const live = d.paymentId ? (f.payments ?? []).find((x) => x.id === d.paymentId && x.status !== 'cancelled') : null;
  if (live) throw new BadRequest(`${r.name} ${d.period} is already being paid (${live.id}).`);
  const expected = finRegularExpected(r, d);
  if (expected == null) throw new BadRequest(`Record the ${d.period} bill or contribution file for ${r.name} first; the payment must equal it.`);
  return { r, d, expected };
}

/** Links (or unlinks, with null) a payment to a due date. */
export function finRegularLink(list: FinRegular[], regularId: Id, period: string, paymentId: Id | null, until: IsoDate): FinRegular[] {
  return list.map((r) => {
    if (r.id !== regularId) return r;
    const d = finRegularDues(r, until).find((x) => x.period === period) ?? r.dues.find((x) => x.period === period);
    if (!d) return r;
    return { ...r, dues: [...r.dues.filter((x) => x.period !== period), { ...d, paymentId }] };
  });
}

// ---------- Finding money on the bank statement ----------

/**
 * Looks on the loaded statements for direct debits on the list, guarantee collateral paid back, and hostel bills the
 * company paid. Each line is taken once; a line two items could fit is left for a person, never guessed.
 */
export function finMatchRegular(f: FinStatus, statements: FinStatement[], hostelBills: HostelBill[], s: Pick<FinSettingsValues, 'matchDays'>, today: IsoDate, at: IsoDateTime) {
  const sts = statements.map((st) => ({ ...st, lines: [...st.lines] }));
  let regular = f.regular ?? [];
  let guarantees = f.guarantees ?? [];
  let found = 0;
  const pickOne = (cands: { st: (typeof sts)[number]; i: number }[], ref: string[]) => {
    const keys = ref.map(norm).filter((k) => k.length >= 4);
    const byRef = keys.length ? cands.filter(({ st, i }) => keys.some((k) => norm(`${st.lines[i].ref} ${st.lines[i].description}`).includes(k))) : [];
    return byRef.length === 1 ? byRef[0] : byRef.length === 0 && cands.length === 1 ? cands[0] : null;
  };
  // Direct debits.
  regular = regular.map((r) => {
    if (r.status !== 'active' || r.method !== 'direct_debit') return r;
    let dues = r.dues;
    for (const d of finRegularDues(r, addDays(today, s.matchDays))) {
      if (d.debited) continue;
      const amt = finRegularExpected(r, d);
      if (amt == null) continue;
      const cands: { st: (typeof sts)[number]; i: number }[] = [];
      for (const st of sts)
        if (st.bankId === r.bankId)
          st.lines.forEach((l, i) => {
            if (!l.match && l.amount < 0 && Math.abs(-l.amount - amt) < 0.005 && Math.abs(daysBetween(d.dueOn, l.date)) <= s.matchDays) cands.push({ st, i });
          });
      const pick = pickOne(cands, [r.reference, r.payee.split(/\s+/)[0] ?? '']);
      if (!pick) continue;
      const line = pick.st.lines[pick.i];
      pick.st.lines[pick.i] = { ...line, match: { kind: 'regular', regularId: r.id, period: d.period, by: AUTO, at } };
      dues = [...dues.filter((x) => x.period !== d.period), { ...d, debited: { statementId: pick.st.id, lineId: line.id, date: line.date } }];
      found += 1;
    }
    return dues === r.dues ? r : { ...r, dues };
  });
  // Guarantee collateral paid back: once the client released it, it expired, or the claim went in.
  guarantees = guarantees.map((g) => {
    if (g.refund || g.collateral <= 0 || !['active', 'released', 'claimed'].includes(g.status)) return g;
    const from = [g.release?.on, g.claim?.on, g.status === 'active' ? g.expiresOn : undefined].filter(Boolean).sort()[0];
    if (!from) return g;
    const cands: { st: (typeof sts)[number]; i: number }[] = [];
    for (const st of sts)
      if (st.bankId === g.bankId)
        st.lines.forEach((l, i) => {
          if (!l.match && l.amount > 0 && Math.abs(l.amount - g.collateral) < 0.005 && l.date >= addDays(from, -s.matchDays)) cands.push({ st, i });
        });
    const pick = pickOne(cands, [g.number, g.claim?.ref ?? '']);
    if (!pick) return g;
    const line = pick.st.lines[pick.i];
    pick.st.lines[pick.i] = { ...line, match: { kind: 'guarantee', guaranteeId: g.id, by: AUTO, at } };
    found += 1;
    return { ...g, status: 'refunded' as const, refund: { statementId: pick.st.id, lineId: line.id, date: line.date, amount: line.amount } };
  });
  // Hostel bills paid (FWM's flow, or keyed in by Finance): the money must have left one of the company's accounts.
  // When Finance keyed the payment in, only that account is searched and its reference is used.
  const seen = new Set(sts.flatMap((st) => st.lines.flatMap((l) => (l.match?.kind === 'hostel' ? [l.match.hostelBillId] : []))));
  const hostelSeen: { billId: Id; statementId: Id; lineId: Id; date: IsoDate; amount: number; bankId: Id }[] = [];
  for (const b of hostelBills) {
    const paidOn = finHostelPaidOn(b);
    if (!paidOn || seen.has(b.id)) continue;
    const fp = b.financePaid;
    const cands: { st: (typeof sts)[number]; i: number }[] = [];
    for (const st of sts)
      if (!fp || st.bankId === fp.bankId)
        st.lines.forEach((l, i) => {
          if (!l.match && l.amount < 0 && Math.abs(-l.amount - b.amount) < 0.005 && Math.abs(daysBetween(paidOn, l.date)) <= s.matchDays) cands.push({ st, i });
        });
    const pick = pickOne(cands, [fp?.ref ?? '', b.id]);
    if (!pick) continue;
    const line = pick.st.lines[pick.i];
    pick.st.lines[pick.i] = { ...line, match: { kind: 'hostel', hostelBillId: b.id, by: AUTO, at } };
    seen.add(b.id);
    hostelSeen.push({ billId: b.id, statementId: pick.st.id, lineId: line.id, date: line.date, amount: -line.amount, bankId: pick.st.bankId });
    found += 1;
  }
  return { statements: sts, regular, guarantees, found, hostelSeen };
}

/** The day a hostel bill was paid: as Finance keyed it in, else the day the company uploaded the slip. Null if unpaid. */
export function finHostelPaidOn(b: HostelBill): IsoDate | null {
  if (b.status !== 'paid') return null;
  return b.financePaid?.on ?? (b.slip ? dateOf(b.slip.at) : null);
}

/** Takes back what was found on a statement that is replaced or a line that is unmatched. */
export function finUnmatchRegular(f: FinStatus, hit: (m: { statementId: Id; lineId: Id }) => boolean): Pick<FinStatus, 'regular' | 'guarantees'> {
  return {
    regular: (f.regular ?? []).map((r) => (r.dues.some((d) => d.debited && hit(d.debited)) ? { ...r, dues: r.dues.map((d) => (d.debited && hit(d.debited) ? { ...d, debited: null } : d)) } : r)),
    guarantees: (f.guarantees ?? []).map((g) =>
      g.refund && hit(g.refund) ? { ...g, refund: null, status: g.claim ? ('claimed' as const) : g.release ? ('released' as const) : ('active' as const) } : g,
    ),
  };
}

/** A hostel bill marked paid with no money seen leaving the company's account, once that month's statements are loaded. */
export function finHostelUnseen(f: FinStatus, bills: HostelBill[], s: Pick<FinSettingsValues, 'matchDays'>, today: IsoDate): HostelBill[] {
  const seen = new Set((f.statements ?? []).flatMap((st) => st.lines.flatMap((l) => (l.match?.kind === 'hostel' ? [l.match.hostelBillId] : []))));
  return bills.filter((b) => {
    const on = finHostelPaidOn(b);
    if (!on || seen.has(b.id)) return false;
    if (daysBetween(on, today) <= s.matchDays) return false;
    return f.banks.length > 0 && f.banks.every((bk) => (f.statements ?? []).some((st) => st.bankId === bk.id && st.period === on.slice(0, 7)));
  });
}

// ---------- Close exceptions and home ----------

/** What keeps a month's close open: a due date in the month not paid, not seen on the statement, or with no bill. */
export function finRegularExceptions(f: FinStatus, period: string, today: IsoDate, s: Pick<FinSettingsValues, 'matchDays'>): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  for (const r of f.regular ?? []) {
    if (r.status !== 'active') continue;
    for (const d of finRegularDues(r, today).filter((x) => x.period === period)) {
      const st = finRegularState(f, r, d, today, s);
      const what = `${r.name} (${r.payee}) due ${d.dueOn}`;
      if (st === 'not_seen') out.push({ key: `regular:${r.id}:${d.period}`, text: `Direct debit ${what} RM${finRegularExpected(r, d)?.toFixed(2) ?? '?'} is not on the bank statement` });
      else if (st === 'no_bill') out.push({ key: `regular:${r.id}:${d.period}`, text: `${what}: the bill or contribution file is not recorded` });
      else if (st === 'late' || st === 'prepared' || st === 'due') out.push({ key: `regular:${r.id}:${d.period}`, text: `${what} is not paid` });
    }
  }
  for (const g of f.guarantees ?? []) {
    if (g.collateral > 0 && ['active', 'released'].includes(g.status) && daysBetween(g.release?.on ?? g.expiresOn, today) > FIN_REGULAR_RULE.claimWaitDays && (g.release || g.expiresOn < today))
      out.push({ key: `guarantee:${g.id}`, text: `${g.kind} ${g.number} (${g.beneficiary}) ${g.release ? 'was released' : 'expired'}: claim back the RM${g.collateral.toFixed(2)} cash collateral from ${g.issuer}` });
  }
  return out;
}

/** Counts for the Finance home, for one company. */
export function finRegularHome(f: FinStatus, a: FinActor, userId: Id, today: IsoDate, s: Pick<FinSettingsValues, 'matchDays'>) {
  const c = { toCheck: 0, toPay: 0, dueSoon: 0, late: 0, noBill: 0, notSeen: 0, expiring: 0, gToCheck: 0, gExpiring: 0, gClaim: 0, gWaiting: 0, collateral: 0 };
  const reviewer = isLead(a) || a.kind === 'leader' || a.kind === 'deputy';
  for (const r of f.regular ?? []) {
    if (r.status === 'pending' && reviewer && r.added.byId !== userId) c.toCheck += 1;
    if (r.status !== 'active') continue;
    if (r.expiresOn && daysBetween(today, r.expiresOn) <= FIN_REGULAR_RULE.expiryWarnDays) c.expiring += 1;
    for (const d of finRegularDues(r, addDays(today, FIN_REGULAR_RULE.aheadDays))) {
      const st = finRegularState(f, r, d, today, s);
      // A bill the payroll works out is filled by Prima when the payment is prepared (A1/A2): it counts as ready to prepare.
      const payrollBill = st === 'no_bill' && ((r.kind === 'statutory' && r.fromPayroll) || (r.kind === 'zakat' && r.zakatFor === 'staff'));
      if ((st === 'due' || payrollBill) && r.method === 'transfer') {
        c.toPay += 1;
        // Reminders 7, 3 and 1 day before (A13): due within a day is shown as urgent.
        if (daysBetween(today, d.dueOn) <= 1) c.dueSoon += 1;
      }
      else if (st === 'late') c.late += 1;
      else if (st === 'no_bill') c.noBill += 1;
      else if (st === 'not_seen' && daysBetween(d.dueOn, today) <= 92) c.notSeen += 1;
    }
  }
  for (const g of f.guarantees ?? []) {
    if (g.status === 'pending' && reviewer && g.added.byId !== userId) c.gToCheck += 1;
    if (['active', 'released', 'claimed'].includes(g.status)) c.collateral += g.collateral;
    if (g.status === 'active' && daysBetween(today, g.expiresOn) <= FIN_REGULAR_RULE.expiryWarnDays && g.expiresOn >= today) c.gExpiring += 1;
    if (g.collateral > 0 && ['active', 'released'].includes(g.status) && (g.release || g.expiresOn < today) && daysBetween(g.release?.on ?? g.expiresOn, today) >= FIN_REGULAR_RULE.claimAfterDays) c.gClaim += 1;
    if (g.status === 'claimed' && g.claim && daysBetween(g.claim.on, today) > FIN_REGULAR_RULE.claimWaitDays) c.gWaiting += 1;
  }
  c.collateral = round2(c.collateral);
  return c;
}

/** The list as the screen shows it: the next due dates and where each stands. */
export function finRegularView(f: FinStatus, today: IsoDate, s: Pick<FinSettingsValues, 'matchDays'>) {
  const until = addDays(today, 40);
  const regular = (f.regular ?? []).map((r) => {
    const dues = finRegularDues(r, until)
      .slice(-6)
      .map((d) => ({ ...d, expected: finRegularExpected(r, d), state: r.status === 'active' ? finRegularState(f, r, d, today, s) : null }));
    const paid = (f.payments ?? []).filter((p) => p.regularId === r.id && p.status === 'released').length + r.dues.filter((d) => d.debited).length;
    return { ...r, next: dues, paidCount: paid, remaining: r.financed ? Math.max(0, r.financed.instalments - paid) : null };
  });
  const guarantees = (f.guarantees ?? []).map((g) => ({
    ...g,
    daysToExpiry: daysBetween(today, g.expiresOn),
    claimNow: g.collateral > 0 && ['active', 'released'].includes(g.status) && (!!g.release || g.expiresOn < today),
  }));
  return {
    regular,
    guarantees,
    collateralHeld: round2((f.guarantees ?? []).filter((g) => ['active', 'released', 'claimed'].includes(g.status)).reduce((n, g) => n + g.collateral, 0)),
    kinds: FIN_REGULAR_KINDS,
    statutoryBodies: FIN_STATUTORY_BODIES,
    zakatBodies: FIN_ZAKAT_BODIES,
  };
}

// ---------- Changes ----------

export interface FinRegularCtx {
  user: User;
  a: FinActor;
  today: IsoDate;
  sign: (comment?: string) => FinSign;
  reviewer: boolean;
  senior: boolean;
  /**
   * What a wage month's staff payroll (approved or later) owes a body: zakat per zakat body, and for EPF, PERKESO,
   * LHDN PCB and HRD Corp the statutory total. Null when that payroll is not approved yet.
   */
  payrollOwes?: (wagePeriod: string, body: string) => number | null;
}

function regularFields(f: FinStatus, input: Record<string, unknown>) {
  const kind = FIN_REGULAR_KINDS.find((k) => k === input.kind);
  if (!kind) throw new BadRequest(`Type must be one of: ${FIN_REGULAR_KINDS.join(', ')}.`);
  const name = noSecrets(text(input.name, 'Name', 3, 120), 'Name');
  const payee = (f.payees ?? []).find((p) => p.id === input.payeeId);
  if (!payee) throw new BadRequest("Choose the payee from this company's payee list (add and verify it first).");
  const reference = noSecrets(text(input.reference, 'Agreement, account, policy or employer number', 3, 60), 'Reference');
  let body: string | null = null;
  let zakatFor: FinRegular['zakatFor'] = null;
  let fromPayroll = false;
  if (kind === 'statutory') {
    body = FIN_STATUTORY_BODIES.find((b) => b === input.body) ?? null;
    if (!body) throw new BadRequest(`Choose who it is paid to: ${FIN_STATUTORY_BODIES.join(', ')}.`);
    // Automation A1 (Fauzan, 2 Nov 2026): the amount comes straight from the approved staff payroll.
    fromPayroll = input.fromPayroll === true && FIN_PAYROLL_BODIES.includes(body);
    if (input.fromPayroll === true && !fromPayroll) throw new BadRequest(`${body} is not worked out by the staff payroll.`);
  }
  if (kind === 'zakat') {
    body = FIN_ZAKAT_BODIES.find((b) => b === input.body) ?? null;
    if (!body) throw new BadRequest(`Choose the zakat body: ${FIN_ZAKAT_BODIES.join(', ')}.`);
    zakatFor = input.zakatFor === 'business' ? 'business' : input.zakatFor === 'staff' ? 'staff' : null;
    if (!zakatFor) throw new BadRequest('Say whether this is zakat deducted from staff salaries or the company’s business zakat.');
  }
  const method = input.method === 'direct_debit' ? 'direct_debit' : input.method === 'transfer' ? 'transfer' : null;
  if (!method) throw new BadRequest('Say how it is paid: direct debit or transfer.');
  if (!f.banks.some((b) => b.id === input.bankId)) throw new BadRequest("Choose one of this company's bank accounts.");
  const every = (['monthly', 'quarterly', 'yearly'] as const).find((e) => e === input.every);
  if (!every) throw new BadRequest('How often: monthly, quarterly or yearly.');
  const dueDay = Number(input.dueDay);
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) throw new BadRequest('Due day must be 1 to 31.');
  const firstDue = isoDate(input.firstDue, 'First due date');
  const lastDue = input.lastDue == null || input.lastDue === '' ? null : isoDate(input.lastDue, 'Last due date');
  if (lastDue && lastDue < firstDue) throw new BadRequest('The last due date is before the first.');
  const fixed = input.amount == null || input.amount === '' ? null : money(input.amount, 'Instalment');
  if ((kind === 'hire_purchase' || kind === 'loan') && fixed == null) throw new BadRequest('Give the monthly instalment from the agreement.');
  if ((kind === 'hire_purchase' || kind === 'loan') && !lastDue) throw new BadRequest('Give the last instalment date from the agreement.');
  let financed: FinRegular['financed'] = null;
  if (kind === 'hire_purchase' || kind === 'loan') {
    const instalments = Number(input.instalments);
    if (!Number.isInteger(instalments) || instalments < 1 || instalments > 600) throw new BadRequest('Number of instalments must be 1 to 600.');
    financed = {
      principal: money(input.principal, 'Amount financed'),
      instalments,
      security: noSecrets(text(input.security, kind === 'loan' ? 'Property or asset the loan is secured on' : 'Vehicle or asset (registration number)', 2, 120), 'Security'),
    };
  }
  const expiresOn = kind === 'insurance' ? isoDate(input.expiresOn, 'Policy end date') : null;
  let subject: FinSubject = 'finance';
  if (!FD_KINDS.includes(kind) && input.subject != null && input.subject !== '') {
    if (!SUBJECTS.includes(input.subject as FinSubject)) throw new BadRequest(`Subject must be one of ${SUBJECTS.join(', ')}.`);
    subject = input.subject as FinSubject;
  }
  return { kind, name, payeeId: payee.id, payee: payee.name, reference, body, zakatFor, fromPayroll, method, bankId: input.bankId as Id, every, dueDay, firstDue, lastDue, amount: fixed, financed, expiresOn, subject } as const;
}

export function finRegularAction(ctx: FinRegularCtx, f: FinStatus, action: string, input: Record<string, unknown>) {
  const list = f.regular ?? [];
  const save = (r: FinRegular) => ({ regular: list.some((x) => x.id === r.id) ? list.map((x) => (x.id === r.id ? r : x)) : [...list, r] });
  if (action === 'add') {
    const fields = regularFields(f, input);
    if (list.some((x) => x.status !== 'ended' && x.payeeId === fields.payeeId && norm(x.reference) === norm(fields.reference) && x.kind === fields.kind))
      throw new BadRequest('This payee and reference are already on the list. Change that one instead.');
    const r: FinRegular = { id: `reg-${f.companyId}-${String(list.length + 1).padStart(3, '0')}`, companyId: f.companyId, ...fields, status: 'pending', added: ctx.sign(), checked: null, ended: null, dues: [] };
    return { patch: save(r), action: 'finance.regular.added', summary: `Regular payment ${r.id} added: ${r.name} to ${r.payee}, ${r.every} on day ${r.dueDay}, ${r.amount == null ? 'amount from each bill' : `RM${r.amount.toFixed(2)}`}, ${r.method.replace('_', ' ')}. Waiting for a second person to check.`, result: r };
  }
  const r = list.find((x) => x.id === input.regularId);
  if (!r) throw new NotFound('Regular payment');
  if (action === 'check') {
    if (!ctx.reviewer) throw new AccessDenied('view', '(the deputy, the team leader, the Finance Director or the CEO checks the list)');
    if (r.status !== 'pending') throw new BadRequest('Nothing to check.');
    if (r.added.byId === ctx.user.id) throw new AccessDenied('view', '(nobody checks a regular payment they entered or changed)');
    const comment = text(input.comment, 'What you checked it against (agreement, bill, letter)', 5, 300);
    const next: FinRegular = { ...r, status: 'active', checked: ctx.sign(comment) };
    return { patch: save(next), action: 'finance.regular.checked', summary: `Regular payment ${r.id} (${r.name}) checked against: ${comment}`, result: next };
  }
  if (action === 'change') {
    if (r.status === 'ended') throw new BadRequest('It has ended.');
    const fields = regularFields(f, { ...r, ...input, payeeId: input.payeeId ?? r.payeeId });
    const why = requireReason(input.comment, 'change it');
    // Changing the amount, the account, the payee or the dates sends it back for a second person to check.
    const next: FinRegular = { ...r, ...fields, status: 'pending', added: ctx.sign(why), checked: null };
    return { patch: save(next), action: 'finance.regular.changed', summary: `Regular payment ${r.id} (${r.name}) changed (${why}); waiting for a second person to check.`, result: next };
  }
  if (action === 'end') {
    if (!ctx.senior) throw new AccessDenied('view', '(the team leader, the Finance Director or the CEO ends a regular payment)');
    const why = requireReason(input.comment, 'end it (settled, sold, closed)');
    const next: FinRegular = { ...r, status: 'ended', ended: ctx.sign(why) };
    return { patch: save(next), action: 'finance.regular.ended', summary: `Regular payment ${r.id} (${r.name}) ended: ${why}`, result: next };
  }
  if (action === 'bill') {
    if (r.status !== 'active') throw new BadRequest('Only a checked regular payment takes bills.');
    if (r.amount != null) throw new BadRequest(`${r.name} has a fixed amount of RM${r.amount.toFixed(2)}; change it if the agreement changed.`);
    const d = finRegularDues(r, addDays(ctx.today, 40)).find((x) => x.period === input.period);
    if (!d) throw new BadRequest(`${r.name} has no payment due for ${String(input.period)}.`);
    if (d.debited || (d.paymentId && (f.payments ?? []).some((p) => p.id === d.paymentId && p.status !== 'cancelled')))
      throw new BadRequest('That due date is already being paid; the bill can no longer change.');
    // Staff zakat (Fauzan, 2 Nov 2026) and, from automation A1, EPF, PERKESO, PCB and HRD levy: what Finance pays the
    // body is exactly what the staff payroll of the wage month before the due date worked out. Prima fills it in.
    const payroll = (r.kind === 'zakat' && r.zakatFor === 'staff') || (r.kind === 'statutory' && r.fromPayroll);
    let amount: number;
    let doc: string;
    if (payroll && r.body && ctx.payrollOwes) {
      const wage = addMonths(d.period, -1);
      const owed = ctx.payrollOwes(wage, r.body);
      if (owed == null) throw new BadRequest(`The ${wage} staff payroll is not approved yet; the amount for ${r.body} comes from it.`);
      amount = input.amount == null || input.amount === '' ? owed : money(input.amount, 'Billed amount');
      if (Math.abs(owed - amount) >= 0.005) throw new BadRequest(`The ${wage} staff payroll ${r.kind === 'zakat' ? 'deducted' : 'works out'} RM${owed.toFixed(2)} for ${r.body}; the amount must be the same.`);
      doc = input.doc == null || input.doc === '' ? `Prima staff payroll ${wage}: ${r.body} list` : docs(input.doc, 'contribution file')[0];
    } else {
      amount = money(input.amount, 'Billed amount');
      doc = docs(input.doc, r.kind === 'statutory' ? 'contribution file or e-PCB summary' : r.kind === 'zakat' ? 'zakat deduction list' : 'bill')[0];
    }
    // Unusual amount: well above or below the last three bills needs an explanation.
    const last = r.dues.filter((x) => x.bill && x.period < d.period).sort((x, y) => y.period.localeCompare(x.period)).slice(0, 3);
    const avg = last.length ? last.reduce((n, x) => n + x.bill!.amount, 0) / last.length : null;
    const odd = avg != null && (amount > avg * FIN_REGULAR_RULE.unusualHigh || amount < avg * FIN_REGULAR_RULE.unusualLow);
    const unusual = odd ? requireReason(input.unusual, `explain why RM${amount.toFixed(2)} differs so much from the usual RM${round2(avg!).toFixed(2)}`) : null;
    const next: FinRegular = { ...r, dues: [...r.dues.filter((x) => x.period !== d.period), { ...d, bill: { ...ctx.sign(), amount, doc, unusual } }] };
    return { patch: save(next), action: 'finance.regular.bill', summary: `${r.name} ${d.period}: RM${amount.toFixed(2)} recorded from ${doc}${unusual ? ` (unusual: ${unusual})` : ''}.`, result: next };
  }
  throw new BadRequest('Unknown action.');
}

export function finGuaranteeAction(ctx: FinRegularCtx, f: FinStatus, action: string, input: Record<string, unknown>) {
  const list = f.guarantees ?? [];
  const save = (g: FinGuarantee) => ({ guarantees: list.some((x) => x.id === g.id) ? list.map((x) => (x.id === g.id ? g : x)) : [...list, g] });
  if (action === 'add') {
    const kind = input.kind === 'BG' ? 'BG' : input.kind === 'IG' ? 'IG' : null;
    if (!kind) throw new BadRequest('Type: IG (insurance guarantee) or BG (bank guarantee).');
    if (!f.banks.some((b) => b.id === input.bankId)) throw new BadRequest('Choose the account the collateral is paid back into.');
    const issuedOn = isoDate(input.issuedOn, 'Issue date');
    const expiresOn = isoDate(input.expiresOn, 'Expiry date');
    if (expiresOn <= issuedOn) throw new BadRequest('The expiry is not after the issue date.');
    const number = noSecrets(text(input.number, 'Guarantee number', 3, 60), 'Guarantee number');
    if (list.some((g) => norm(g.number) === norm(number) && g.status !== 'ended')) throw new BadRequest('This guarantee number is already on the list.');
    const g: FinGuarantee = {
      id: `gtee-${f.companyId}-${String(list.length + 1).padStart(3, '0')}`,
      companyId: f.companyId,
      kind,
      issuer: noSecrets(text(input.issuer, kind === 'IG' ? 'Insurer' : 'Bank', 2, 120), 'Issuer'),
      number,
      beneficiary: noSecrets(text(input.beneficiary, 'Client it is given to', 2, 160), 'Client'),
      contractId: typeof input.contractId === 'string' && input.contractId ? input.contractId : null,
      purpose: noSecrets(text(input.purpose, 'Contract or tender it secures', 3, 200), 'Purpose'),
      amount: money(input.amount, 'Guarantee amount'),
      collateral: money(input.collateral ?? 0, 'Cash collateral', true),
      bankId: input.bankId as Id,
      issuedOn,
      expiresOn,
      status: 'pending',
      added: ctx.sign(docs(input.doc, 'guarantee letter')[0]),
      checked: null,
      release: null,
      claim: null,
      refund: null,
      called: null,
      extensions: [],
    };
    if (g.collateral > g.amount) throw new BadRequest('The collateral is more than the guarantee.');
    return { patch: save(g), action: 'finance.guarantee.added', summary: `${kind} ${number} for ${g.beneficiary} (${g.purpose}) RM${g.amount.toFixed(2)}, collateral RM${g.collateral.toFixed(2)}, expires ${expiresOn}; waiting for a second person to check.`, result: g };
  }
  const g = list.find((x) => x.id === input.guaranteeId);
  if (!g) throw new NotFound('Guarantee');
  const doc = () => docs(input.doc, 'document')[0];
  if (action === 'check') {
    if (!ctx.reviewer) throw new AccessDenied('view', '(the deputy, the team leader, the Finance Director or the CEO checks it)');
    if (g.status !== 'pending') throw new BadRequest('Nothing to check.');
    if (g.added.byId === ctx.user.id) throw new AccessDenied('view', '(nobody checks a guarantee they entered)');
    const next: FinGuarantee = { ...g, status: 'active', checked: ctx.sign(text(input.comment, 'What you checked it against', 5, 300)) };
    return { patch: save(next), action: 'finance.guarantee.checked', summary: `${g.kind} ${g.number} checked.`, result: next };
  }
  if (g.status === 'pending') throw new BadRequest('A second person checks it first.');
  if (action === 'release') {
    if (g.status !== 'active') throw new BadRequest('Only an active guarantee is released.');
    const on = isoDate(input.on ?? ctx.today, 'Release date');
    if (on > ctx.today) throw new BadRequest('The release date cannot be in the future.');
    const next: FinGuarantee = { ...g, status: 'released', release: { ...ctx.sign(), on, doc: doc() } };
    return { patch: save(next), action: 'finance.guarantee.released', summary: `${g.kind} ${g.number}: client's release letter recorded (${on}).`, result: next };
  }
  if (action === 'claim') {
    if (g.collateral <= 0) throw new BadRequest('There is no cash collateral to claim back.');
    if (!(g.status === 'released' || (g.status === 'active' && g.expiresOn < ctx.today))) throw new BadRequest('Claim the collateral once the client released the guarantee or it expired.');
    const on = isoDate(input.on ?? ctx.today, 'Claim date');
    const next: FinGuarantee = { ...g, status: 'claimed', claim: { ...ctx.sign(), on, ref: noSecrets(text(input.ref, "The issuer's claim reference", 3, 60), 'Reference'), docs: docs(input.docs, 'claim documents') } };
    return { patch: save(next), action: 'finance.guarantee.claimed', summary: `${g.kind} ${g.number}: claim for RM${g.collateral.toFixed(2)} collateral sent to ${g.issuer} (${next.claim!.ref}). Prima looks for the refund on the bank statement.`, result: next };
  }
  if (action === 'extend') {
    if (g.status !== 'active') throw new BadRequest('Only an active guarantee is extended.');
    const to = isoDate(input.to, 'New expiry date');
    if (to <= g.expiresOn) throw new BadRequest('The new expiry is not later.');
    const next: FinGuarantee = { ...g, expiresOn: to, extensions: [...g.extensions, { ...ctx.sign(), from: g.expiresOn, to, doc: doc() }] };
    return { patch: save(next), action: 'finance.guarantee.extended', summary: `${g.kind} ${g.number} extended from ${g.expiresOn} to ${to}.`, result: next };
  }
  if (action === 'called') {
    if (!isLead(ctx.a)) throw new AccessDenied('view', '(the Finance Director or the CEO records a guarantee the client called)');
    if (!['active', 'released'].includes(g.status)) throw new BadRequest('Only an active guarantee can be called.');
    const amount = money(input.amount, 'Amount the client claimed');
    if (amount > g.amount) throw new BadRequest('The claim is more than the guarantee.');
    const next: FinGuarantee = { ...g, status: 'called', called: { ...ctx.sign(requireReason(input.comment, 'record the call')), amount, doc: doc() } };
    return { patch: save(next), action: 'finance.guarantee.called', summary: `${g.kind} ${g.number} called by ${g.beneficiary} for RM${amount.toFixed(2)}: ${next.called!.comment}`, result: next };
  }
  if (action === 'end') {
    if (!ctx.senior) throw new AccessDenied('view', '(the team leader, the Finance Director or the CEO closes it)');
    if (g.collateral > 0 && !g.refund && g.status !== 'called') throw new BadRequest('The collateral has not been seen coming back on the bank statement yet.');
    const why = requireReason(input.comment, 'close it');
    const next: FinGuarantee = { ...g, status: 'ended' };
    return { patch: save(next), action: 'finance.guarantee.ended', summary: `${g.kind} ${g.number} closed: ${why}`, result: next };
  }
  throw new BadRequest('Unknown action.');
}

/**
 * Cross-module (Fauzan, 2 Nov 2026: "automate across prima app"): for a staff payroll month, where each payment the
 * payroll owes stands in Finance: EPF, PERKESO, PCB, HRD and staff zakat, due the month after. HR and the Chief of Staff
 * see them on the payroll run without asking Finance. Only the body, due day, amount and state; no bank details.
 */
export function finPayrollRemittances(f: FinStatus, runPeriod: string, today: IsoDate) {
  const [y, m] = runPeriod.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const out: { body: string; dueOn: IsoDate; amount: number | null; state: 'not_listed' | 'no_bill' | 'to_prepare' | 'prepared' | 'approved' | 'paid' | 'late'; paidOn: IsoDate | null; seenInBank: boolean }[] = [];
  for (const r of f.regular ?? []) {
    if (r.status !== 'active' || !r.body) continue;
    const payroll = (r.kind === 'statutory' && FIN_PAYROLL_BODIES.includes(r.body)) || (r.kind === 'zakat' && r.zakatFor === 'staff');
    if (!payroll) continue;
    const d = finRegularDues(r, `${next}-31`).find((x) => x.period === next);
    if (!d) continue;
    const p = d.paymentId ? (f.payments ?? []).find((x) => x.id === d.paymentId) : null;
    const paid = !!d.debited || p?.status === 'released';
    const state = paid
      ? 'paid'
      : p && p.status === 'approved'
        ? 'approved'
        : p && ['prepared', 'reviewed'].includes(p.status)
          ? 'prepared'
          : d.dueOn < today
            ? 'late'
            : !d.bill && r.amount == null
              ? 'no_bill'
              : 'to_prepare';
    out.push({ body: r.body, dueOn: d.dueOn, amount: finRegularExpected(r, d), state, paidOn: d.debited?.date ?? p?.releasedOn ?? null, seenInBank: !!d.debited || !!p?.cleared });
  }
  return out.sort((a, b) => a.body.localeCompare(b.body));
}
