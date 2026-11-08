import { AccessDenied } from "./access";
import { isoDate } from "./finance";
import { noSecrets } from "./finance";
import { requireComment } from "./finance";
import { requireReason } from "./finance";
import { text } from "./finance";
import type { FinCashCtx } from "./finance-cash";
import { RULES } from "./rules";
import { BadRequest } from "./service";
import { NotFound } from "./service";
import { addDays } from "./time";
import { daysBetween } from "./time";
import type { Contract } from "./types";
import type { FinSign } from "./types";
import type { FinStatus } from "./types";
import type { Id } from "./types";
import type { IsoDate } from "./types";


const round2 = (n: number) => Math.round(n * 100) / 100;
const R = () => RULES.financeStamp.value;

export type FinStampKind = 'client_contract' | 'tenancy' | 'loan' | 'hire_purchase' | 'supplier' | 'other';
export const FIN_STAMP_KINDS: FinStampKind[] = ['client_contract', 'tenancy', 'loan', 'hire_purchase', 'supplier', 'other'];
export type FinStampStatus = 'to_stamp' | 'stamped' | 'refund_open' | 'refund_submitted' | 'refunded' | 'refund_refused' | 'closed';

export interface FinStampItem {
  id: Id;
  kind: FinStampKind;
  title: string;
  counterparty: string;
  contractId: Id | null;
  /** The value the duty is worked out on (contract sum, yearly rent, loan amount); for information. */
  value: number | null;
  signedOn: IsoDate;
  stampBy: IsoDate;
  status: FinStampStatus;
  entered: FinSign;
  /** The STAMPS certificate: number, date, duty and any late penalty; checked by someone else. */
  stamped: { certNo: string; on: IsoDate; duty: number; penalty: number; sign: FinSign; checked: FinSign | null } | null;
  /** Cancelled agreement: the refund ("unstamp") procedure. */
  refund: {
    cancelledOn: IsoDate;
    reason: string;
    claimBy: IsoDate;
    /** The law's last day to apply (s.57: 12 months from the agreement's date). Missing on refunds opened before 2 Nov 2026. */
    lawBy?: IsoDate;
    docs: string[];
    /** Who listed the documents: neither they nor whoever opened the refund submits it. */
    docsBy: Id | null;
    opened: FinSign;
    submitted: { on: IsoDate; ref: string; sign: FinSign } | null;
    outcome: { result: 'approved' | 'refused'; amount: number; on: IsoDate; note: string; sign: FinSign } | null;
    /** The refund found on the bank statement (Finance links the line). */
    received: { statementId: Id; lineId: Id; date: IsoDate; amount: number; by: string } | null;
  } | null;
  log: { text: string; by: string; at: string }[];
}

function addMonths(d: IsoDate, months: number): IsoDate {
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(day, last))).toISOString().slice(0, 10);
}

/** The late stamping penalty the law sets (s.47A(1)) for an agreement stamped on `on` with this duty. */
export function finStampPenalty(duty: number, stampBy: IsoDate, on: IsoDate): number {
  if (on <= stampBy) return 0;
  const p = R().latePenalty;
  const band = on <= addMonths(stampBy, p.withinMonths) ? p.first : p.after;
  return Math.round(Math.max(band.min, (duty * band.pct) / 100) * 100) / 100;
}

/** The last day the law allows to apply for the refund of a cancelled agreement (s.57: 12 months from its date). */
export function finStampRefundLawBy(signedOn: IsoDate): IsoDate {
  return addMonths(signedOn, R().refundLimitMonths);
}

type Out<T> = { patch: Partial<FinStatus>; action: string; summary: string; result: T };

function money(v: unknown, field: string, allowZero = false): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : Number.NaN;
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) throw new BadRequest(`${field} must be ${allowZero ? 'RM0.00 or more' : 'more than RM0.00'}.`);
  if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) throw new BadRequest(`${field} has at most 2 decimal places (sen).`);
  return round2(n);
}
const finance = (ctx: FinCashCtx) => {
  if (!ctx.a || ctx.a.kind === 'viewer' || ctx.a.kind === 'coo') throw new AccessDenied('view', '(Finance staff do this)');
  return ctx.a;
};

export function finStampAction(ctx: FinCashCtx, f: FinStatus, contracts: Contract[], action: string, input: Record<string, unknown>): Out<unknown> {
  finance(ctx);
  const list = f.stampDuty ?? [];
  const sign = ctx.sign();
  const logOf = (t: string) => ({ text: t, by: sign.by, at: sign.at });
  if (action === 'add') {
    const kind = FIN_STAMP_KINDS.find((k) => k === input.kind);
    if (!kind) throw new BadRequest('Choose what kind of agreement it is.');
    const contractId = typeof input.contractId === 'string' && input.contractId ? input.contractId : null;
    const c = contractId ? contracts.find((x) => x.id === contractId && x.companyId === f.companyId) : null;
    if (contractId && !c) throw new NotFound('Contract');
    if (contractId && list.some((x) => x.contractId === contractId && x.status !== 'closed'))
      throw new BadRequest('That contract is already on the stamp duty list.');
    const title = c ? `${c.ref} ${c.clientName}` : text(input.title, 'Agreement (what and with whom)', 3, 160);
    const counterparty = c ? c.clientName : text(input.counterparty, 'The other party', 2, 120);
    const signedOn = isoDate(input.signedOn, 'Date signed');
    if (signedOn > ctx.today) throw new BadRequest('The agreement is listed once it is signed.');
    const value = input.value == null || input.value === '' ? null : money(input.value, 'Value');
    const id = `stamp-${f.companyId}-${String(list.length + 1).padStart(3, '0')}`;
    const item: FinStampItem = {
      id,
      kind,
      title,
      counterparty,
      contractId,
      value,
      signedOn,
      stampBy: addDays(signedOn, R().stampDays),
      status: 'to_stamp',
      entered: sign,
      stamped: null,
      refund: null,
      log: [logOf(`Signed ${signedOn}; stamp by ${addDays(signedOn, R().stampDays)}`)],
    };
    return {
      patch: { stampDuty: [...list, item] },
      action: 'finance.stamp.added',
      summary: `Stamp duty: ${title} signed ${signedOn}, stamp by ${item.stampBy}.`,
      result: item,
    };
  }
  const it = list.find((x) => x.id === input.stampId);
  if (!it) throw new NotFound('Agreement on the stamp duty list');
  const save = (n: FinStampItem) => list.map((x) => (x.id === it.id ? n : x));
  if (action === 'stamped') {
    if (it.status !== 'to_stamp') throw new BadRequest('That agreement is not waiting to be stamped.');
    const certNo = noSecrets(text(input.certNo, 'STAMPS certificate number', 3, 60), 'Certificate number');
    const on = isoDate(input.on, 'Date stamped');
    if (on < it.signedOn || on > ctx.today) throw new BadRequest('The stamping date is between signing and today.');
    const duty = money(input.duty, 'Duty paid', true);
    const penalty = money(input.penalty ?? 0, 'Late penalty', true);
    const lawPenalty = finStampPenalty(duty, it.stampBy, on);
    if (Math.abs(penalty - lawPenalty) >= 0.005)
      requireReason(input.comment, `record a penalty of RM${penalty.toFixed(2)} when the law's penalty is RM${lawPenalty.toFixed(2)} (s.47A)`);
    const n: FinStampItem = {
      ...it,
      status: 'stamped',
      stamped: { certNo, on, duty, penalty, sign, checked: null },
      log: [...it.log, logOf(`Stamped ${on}, certificate ${certNo}, duty RM${duty.toFixed(2)}${penalty ? `, penalty RM${penalty.toFixed(2)}` : ''}`)],
    };
    return {
      patch: { stampDuty: save(n) },
      action: 'finance.stamp.stamped',
      summary: `Stamp duty: ${it.title} stamped ${on} (${certNo}), duty RM${duty.toFixed(2)}${penalty ? ` + late penalty RM${penalty.toFixed(2)}` : ''}; someone else checks the certificate.`,
      result: n,
    };
  }
  if (action === 'check') {
    if (!ctx.reviewer) throw new AccessDenied('view', '(the deputy, the team leader, the Finance Director or the CEO checks a stamp certificate)');
    if (!it.stamped || it.stamped.checked) throw new BadRequest('No stamp certificate waiting for a check.');
    if (it.stamped.sign.byId === ctx.user.id) throw new AccessDenied('view', '(someone other than the person who recorded it checks it)');
    if (input.ok === false) {
      const why = requireReason(input.comment, 'send it back');
      const n: FinStampItem = { ...it, status: 'to_stamp', stamped: null, log: [...it.log, logOf(`Certificate sent back: ${why}`)] };
      return { patch: { stampDuty: save(n) }, action: 'finance.stamp.returned', summary: `Stamp duty: ${it.title} certificate sent back: ${why}`, result: n };
    }
    const comment = requireComment(input.comment, 'check the certificate');
    const n: FinStampItem = { ...it, stamped: { ...it.stamped, checked: { ...sign, comment } }, log: [...it.log, logOf(`Certificate checked: ${comment}`)] };
    return {
      patch: { stampDuty: save(n) },
      action: 'finance.stamp.checked',
      summary: `Stamp duty: ${it.title} certificate ${it.stamped.certNo} checked: ${comment}`,
      result: n,
    };
  }
  if (action === 'cancelled') {
    // The agreement is cancelled: start the refund ("unstamp"), or close it when nothing was paid.
    if (!['to_stamp', 'stamped'].includes(it.status)) throw new BadRequest('That agreement is already cancelled or closed.');
    const cancelledOn = isoDate(input.cancelledOn, 'Date cancelled');
    if (cancelledOn < it.signedOn || cancelledOn > ctx.today) throw new BadRequest('The cancellation date is between signing and today.');
    const reason = requireReason(input.comment, 'record the cancellation');
    if (!it.stamped || it.stamped.duty + it.stamped.penalty === 0) {
      const n: FinStampItem = { ...it, status: 'closed', log: [...it.log, logOf(`Cancelled ${cancelledOn} before any duty was paid: ${reason}`)] };
      return {
        patch: { stampDuty: save(n) },
        action: 'finance.stamp.closed',
        summary: `Stamp duty: ${it.title} cancelled ${cancelledOn} before stamping: ${reason}`,
        result: n,
      };
    }
    const lawBy = finStampRefundLawBy(it.signedOn);
    const target = addDays(cancelledOn, R().refundTargetDays);
    const claimBy = target < lawBy ? target : lawBy;
    const n: FinStampItem = {
      ...it,
      status: 'refund_open',
      refund: { cancelledOn, reason, claimBy, lawBy, docs: [], docsBy: null, opened: sign, submitted: null, outcome: null, received: null },
      log: [...it.log, logOf(`Cancelled ${cancelledOn}: ${reason}. Refund application to be submitted by ${claimBy} (the law allows until ${lawBy}, s.57)`)],
    };
    return {
      patch: { stampDuty: save(n) },
      action: 'finance.stamp.refund_opened',
      summary: `Stamp duty: ${it.title} cancelled ${cancelledOn}; refund of RM${it.stamped.duty.toFixed(2)} to claim by ${claimBy}: ${reason}`,
      result: n,
    };
  }
  const r = it.refund;
  if (!r) throw new BadRequest('That agreement has no refund open.');
  if (action === 'docs') {
    if (it.status !== 'refund_open') throw new BadRequest('The documents are prepared before the application is submitted.');
    const docs = (Array.isArray(input.docs) ? input.docs : []).slice(0, 20).map((d, i) => noSecrets(text(d, `Document ${i + 1}`, 2, 200), 'Document'));
    if (docs.length < R().refundMinDocs) throw new BadRequest(`List at least ${R().refundMinDocs} documents: ${R().refundDocs.join('; ')}.`);
    const n: FinStampItem = { ...it, refund: { ...r, docs, docsBy: ctx.user.id }, log: [...it.log, logOf(`Refund pack: ${docs.join('; ')}`)] };
    return {
      patch: { stampDuty: save(n) },
      action: 'finance.stamp.refund_docs',
      summary: `Stamp duty refund ${it.id}: ${docs.length} documents ready.`,
      result: n,
    };
  }
  if (action === 'submit') {
    if (it.status !== 'refund_open') throw new BadRequest('That refund is not waiting to be submitted.');
    if (r.docs.length < R().refundMinDocs) throw new BadRequest('Prepare the document pack first.');
    if (r.opened.byId === ctx.user.id || r.docsBy === ctx.user.id)
      throw new AccessDenied('view', '(someone other than the person who prepared the refund submits it)');
    const on = isoDate(input.on, 'Date submitted');
    if (on > ctx.today || on < r.cancelledOn) throw new BadRequest('The submission date is between the cancellation and today.');
    const ref = noSecrets(text(input.ref, 'LHDN application reference', 3, 80), 'Reference');
    const lawBy = r.lawBy ?? finStampRefundLawBy(it.signedOn);
    if (on > lawBy) requireReason(input.comment, `submit after ${lawBy}, the 12 months the law allows (s.57); LHDN may refuse it`);
    const n: FinStampItem = {
      ...it,
      status: 'refund_submitted',
      refund: { ...r, submitted: { on, ref, sign } },
      log: [...it.log, logOf(`Refund application submitted ${on}, ${ref}`)],
    };
    return {
      patch: { stampDuty: save(n) },
      action: 'finance.stamp.refund_submitted',
      summary: `Stamp duty refund ${it.id} submitted to LHDN ${on} (${ref}).`,
      result: n,
    };
  }
  if (action === 'outcome') {
    if (it.status !== 'refund_submitted') throw new BadRequest('That refund is not waiting for LHDN.');
    const result = input.result === 'approved' ? 'approved' : input.result === 'refused' ? 'refused' : null;
    if (!result) throw new BadRequest('Say whether LHDN approved or refused it.');
    const on = isoDate(input.on, 'Date of the answer');
    const amount = result === 'approved' ? money(input.amount, 'Amount approved') : 0;
    const note = requireComment(input.comment, 'record LHDN’s answer');
    const n: FinStampItem = {
      ...it,
      status: result === 'approved' ? 'refunded' : 'refund_refused',
      refund: { ...r, outcome: { result, amount, on, note, sign } },
      log: [...it.log, logOf(`LHDN ${result} ${on}${result === 'approved' ? ` RM${amount.toFixed(2)}` : ''}: ${note}`)],
    };
    return {
      patch: { stampDuty: save(n) },
      action: 'finance.stamp.refund_outcome',
      summary: `Stamp duty refund ${it.id}: LHDN ${result}${result === 'approved' ? ` RM${amount.toFixed(2)}` : ''}: ${note}`,
      result: n,
    };
  }
  if (action === 'received') {
    if (it.status !== 'refunded' || r.received) throw new BadRequest('That refund is not waiting for the money.');
    const statements = f.statements ?? [];
    const st = statements.find((x) => x.id === input.statementId);
    const line = st?.lines.find((l) => l.id === input.lineId);
    if (!st || !line) throw new NotFound('Bank statement line');
    if (line.match) throw new BadRequest('That bank line is already matched.');
    if (Math.abs(line.amount - r.outcome!.amount) >= 0.005)
      throw new BadRequest(`The bank line is RM${line.amount.toFixed(2)}; LHDN approved RM${r.outcome!.amount.toFixed(2)}.`);
    const lines = st.lines.map((l) =>
      l.id === line.id ? { ...l, match: { kind: 'other' as const, note: `Stamp duty refund ${it.id}`, by: sign.by, byId: sign.byId, at: sign.at } } : l,
    );
    const n: FinStampItem = {
      ...it,
      status: 'closed',
      refund: { ...r, received: { statementId: st.id, lineId: line.id, date: line.date, amount: line.amount, by: sign.by } },
      log: [...it.log, logOf(`Refund RM${line.amount.toFixed(2)} on the bank statement ${line.date}`)],
    };
    return {
      patch: { stampDuty: save(n), statements: statements.map((x) => (x.id === st.id ? { ...st, lines } : x)) },
      action: 'finance.stamp.refund_received',
      summary: `Stamp duty refund ${it.id} received ${line.date} RM${line.amount.toFixed(2)}.`,
      result: n,
    };
  }
  throw new BadRequest('Unknown stamp duty action.');
}

/** What needs doing: unstamped agreements, certificates to check, refunds to submit, LHDN answers and refund money awaited. */
export function finStampState(it: FinStampItem, today: IsoDate) {
  const r = it.refund;
  if (it.status === 'to_stamp') return { late: today > it.stampBy, due: daysBetween(today, it.stampBy) <= 7, what: `Stamp by ${it.stampBy}` };
  if (it.status === 'stamped' && it.stamped && !it.stamped.checked) return { late: false, due: true, what: 'Certificate to check' };
  if (it.status === 'refund_open' && r) {
    const lawBy = r.lawBy ?? finStampRefundLawBy(it.signedOn);
    if (today > lawBy) return { late: true, due: true, what: `Refund not submitted within the 12 months the law allows (by ${lawBy}, s.57)` };
    return { late: today > r.claimBy, due: daysBetween(today, r.claimBy) <= 14, what: `Refund to submit by ${r.claimBy} (law: by ${lawBy})` };
  }
  if (it.status === 'refund_submitted' && r?.submitted) {
    const late = daysBetween(r.submitted.on, today) > R().lhdnAnswerDays;
    return { late, due: late, what: `Waiting for LHDN since ${r.submitted.on}` };
  }
  if (it.status === 'refunded' && r?.outcome && !r.received) {
    const late = daysBetween(r.outcome.on, today) > R().refundMoneyDays;
    return { late, due: late, what: `Refund RM${r.outcome.amount.toFixed(2)} not yet in the bank` };
  }
  return { late: false, due: false, what: '' };
}

export function finStampExceptions(f: FinStatus, today: IsoDate) {
  const out: { key: string; text: string }[] = [];
  for (const it of f.stampDuty ?? []) {
    const s = finStampState(it, today);
    if (s.late || (it.status === 'stamped' && it.stamped && !it.stamped.checked))
      out.push({ key: `stamp:${it.id}:${it.status}`, text: `Stamp duty, ${it.title}: ${s.what}${s.late ? ' (late)' : ''}` });
  }
  return out;
}

export function finStampHome(f: FinStatus, userId: Id, reviewer: boolean, today: IsoDate) {
  const items = f.stampDuty ?? [];
  return {
    stampLate: items.filter((x) => x.status === 'to_stamp' && today > x.stampBy).length,
    stampDue: items.filter((x) => x.status === 'to_stamp' && today <= x.stampBy && daysBetween(today, x.stampBy) <= 7).length,
    stampToCheck: reviewer ? items.filter((x) => x.stamped && !x.stamped.checked && x.stamped.sign.byId !== userId).length : 0,
    refundOpen: items.filter((x) => x.status === 'refund_open').length,
    refundLate: items.filter((x) => finStampState(x, today).late && x.status !== 'to_stamp').length,
  };
}

/** The list, plus contracts that look like they need an entry: signed but not listed, or ended early with duty paid. */
export function finStampView(f: FinStatus, contracts: Contract[], today: IsoDate) {
  const items = [...(f.stampDuty ?? [])].sort((a, b) => Number(b.status !== 'closed') - Number(a.status !== 'closed') || b.signedOn.localeCompare(a.signedOn));
  const listed = new Set(items.map((x) => x.contractId).filter(Boolean));
  const mine = contracts.filter((c) => c.companyId === f.companyId);
  return {
    rule: RULES.financeStamp,
    items: items.map((x) => ({ ...x, state: finStampState(x, today) })),
    // A11 (contract cancelled or ended early): a stamped contract that was terminated before its end date.
    endedEarly: items
      .filter((x) => x.status === 'stamped' && x.contractId)
      .flatMap((x) => {
        const c = mine.find((k) => k.id === x.contractId);
        return c && c.state === 'terminated' ? [{ stampId: x.id, contractRef: c.ref, client: c.clientName, endOn: c.endOn }] : [];
      }),
    // New contracts signed in the last 90 days that are not on the list yet.
    notListed: mine
      .filter((c) => !listed.has(c.id) && c.versions.length && daysBetween(c.versions[0].at.slice(0, 10), today) <= 90)
      .slice(0, 20)
      .map((c) => ({ contractId: c.id, ref: c.ref, client: c.clientName, signedOn: c.versions[0].at.slice(0, 10) })),
    contracts: mine.map((c) => ({ id: c.id, ref: c.ref, client: c.clientName })),
  };
}