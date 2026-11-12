import type { FinSettingsValues } from "./types";
import { AccessDenied } from "./access";
import { isoDate } from "./finance";
import { noSecrets } from "./finance";
import { requireComment } from "./finance";
import { requireReason } from "./finance";
import { text } from "./finance";
import type { FinCashCtx } from "./finance-cash";
import { finContractEndOn } from "./finance-contract-end";
import { periodEnd } from "./payroll";
import { RULES } from "./rules";
import { BadRequest } from "./service";
import { NotFound } from "./service";
import { addDays } from "./time";
import { daysBetween } from "./time";
import type { ClientAccount } from "./types";
import type { Contract } from "./types";
import type { FinSign } from "./types";
import type { FinStatement } from "./types";
import type { FinStatementLine } from "./types";
import type { FinStatus } from "./types";
import type { Id } from "./types";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";


const round2 = (n: number) => Math.round(n * 100) / 100;
const norm = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, '');
const R = () => RULES.financeMoneyIn.value;

/** One contract's invoice for one month, or the reason there is none. */
export interface FinBillingLine {
  id: Id;
  contractId: Id;
  contractRef: string;
  client: string;
  period: string;
  /** The contract's monthly amount when Prima can work it out (fixed fee, or Method 2 contracted hours), else null. */
  expected: number | null;
  invoice: { no: string; date: IsoDate; amount: number; note: string; by: string; byId: Id; at: IsoDateTime } | null;
  none: { reason: string; by: string; byId: Id; at: IsoDateTime; checked: FinSign | null } | null;
  history: { what: string; by: string; at: IsoDateTime }[];
}

export type FinGovtStatus = 'submitted' | 'queried' | 'paid' | 'cancelled';
/** A claim (invoice) submitted to a government client, followed up until the money is on the bank statement. */
export interface FinGovtClaim {
  id: Id;
  agency: string;
  contractId: Id | null;
  /** The SQL Account invoice number. */
  invoiceNo: string;
  amount: number;
  /** The government system's reference (ePerolehan, iGFMAS, MyGPIS, the agency's letter or file number). */
  claimRef: string;
  submittedOn: IsoDate;
  expectedBy: IsoDate;
  status: FinGovtStatus;
  nextOn: IsoDate | null;
  log: {
    kind: 'submitted' | 'follow' | 'query' | 'resubmit' | 'paid' | 'unpaid' | 'cancel';
    text: string;
    by: string;
    byId: Id;
    at: IsoDateTime;
    on?: IsoDate;
  }[];
  paid: { statementId: Id; lineId: Id; date: IsoDate; amount: number; how: 'auto' | 'hand'; by: string } | null;
  opened: FinSign;
}

type Out<T> = { patch: Partial<FinStatus>; action: string; summary: string; result: T };

function money(v: unknown, field: string): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) throw new BadRequest(`${field} must be more than RM0.00.`);
  if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) throw new BadRequest(`${field} has at most 2 decimal places (sen).`);
  return round2(n);
}
const finance = (ctx: FinCashCtx) => {
  if (!ctx.a || ctx.a.kind === 'viewer' || ctx.a.kind === 'coo') throw new AccessDenied('view', '(Finance staff do this)');
  return ctx.a;
};
const needReviewer = (ctx: FinCashCtx, what: string) => {
  finance(ctx);
  if (!ctx.reviewer) throw new AccessDenied('view', `(the deputy, the team leader, the Finance Director or the CEO ${what})`);
};
const monthOf = (d: IsoDate) => d.slice(0, 7);

// ---------- Billing to invoice (1) ----------

/** The contract's monthly amount for a whole month, when it can be worked out from the contract alone. */
export function finContractMonthly(c: Contract, period: string): number | null {
  const end = periodEnd(period);
  // Part months (starting or ending inside the month) are billed pro rata, so no fixed expectation.
  if (c.startOn > `${period}-01` || c.endOn < end) return null;
  const v = [...c.versions].filter((x) => x.effectiveFrom <= end).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  if (!v) return null;
  if (v.billingMethod === 'FIXED') return v.fixedFee && v.fixedFee > 0 ? round2(v.fixedFee) : null;
  if (v.billingMethod === 'M2') {
    const sum = v.posts.reduce((n, p) => n + p.guards * (p.contractedHours ?? 0) * p.rate, 0);
    return sum > 0 ? round2(sum) : null;
  }
  // Methods 1 and 3 bill the hours actually worked; the amount comes from the attendance, not the contract.
  return null;
}

/** The contracts that ran for at least a day in the month and so must be billed. */
export function finBillingDue(contracts: Contract[], companyId: Id, period: string) {
  const start = `${period}-01`;
  const end = periodEnd(period);
  return contracts
    // A terminated contract is billed only up to the day it ended (Fauzan, 2 Nov 2026: suggestion 24).
    .filter((c) => c.companyId === companyId && ['ready', 'active', 'suspended', 'terminated'].includes(c.state) && c.startOn <= end && finContractEndOn(c) >= start)
    .sort((a, b) => a.clientName.localeCompare(b.clientName) || a.ref.localeCompare(b.ref))
    .map((c) => ({ contract: c, expected: finContractMonthly(c, period) }));
}

const billingId = (contractId: Id, period: string) => `bill-${contractId}-${period}`;

export function finBillingAction(
  ctx: FinCashCtx,
  f: FinStatus,
  contracts: Contract[],
  openFrom: string,
  action: string,
  input: Record<string, unknown>,
  clients: ClientAccount[] = [],
): Out<unknown> {
  finance(ctx);
  const period = typeof input.period === 'string' && /^\d{4}-\d{2}$/.test(input.period) ? input.period : '';
  if (!period || period >= monthOf(ctx.today)) throw new BadRequest('Choose a finished month (YYYY-MM).');
  if (period < openFrom) throw new BadRequest(`${period} is closed; record late invoices in the month they were raised.`);
  const due = finBillingDue(contracts, f.companyId, period).find((x) => x.contract.id === input.contractId);
  if (!due) throw new NotFound('Contract that ran in the month');
  const c = due.contract;
  const list = f.billing ?? [];
  const id = billingId(c.id, period);
  const old = list.find((x) => x.id === id) ?? null;
  const base: FinBillingLine = old ?? {
    id,
    contractId: c.id,
    contractRef: c.ref,
    client: c.clientName,
    period,
    expected: due.expected,
    invoice: null,
    none: null,
    history: [],
  };
  const sign = ctx.sign();
  const save = (line: FinBillingLine) => (old ? list.map((x) => (x.id === id ? line : x)) : [...list, line]);
  if (action === 'invoice') {
    const no = noSecrets(text(input.invoiceNo, 'SQL Account invoice number', 2, 40), 'Invoice number');
    const date = isoDate(input.invoiceDate, 'Invoice date');
    if (date < `${period}-01` || date > ctx.today) throw new BadRequest(`The invoice date is in ${period} or later, and not in the future.`);
    const amount = money(input.amount, 'Invoice amount');
    const clash = list.find((x) => x.id !== id && x.invoice && norm(x.invoice.no) === norm(no));
    if (clash) throw new BadRequest(`Invoice ${no} is already recorded for ${clash.client} (${clash.contractRef}, ${clash.period}).`);
    let note = typeof input.note === 'string' ? input.note.trim().slice(0, 300) : '';
    // Against the contract's monthly amount, else against what the company recorded sending to the client.
    const sent = clients.find((x) => x.id === c.clientAccountId)?.invoices?.find((x) => x.period === period)?.amount ?? null;
    const target = due.expected ?? sent;
    const diffPct = target ? (Math.abs(amount - target) / target) * 100 : 0;
    if (diffPct > (ctx.fs?.billDiffPct ?? R().billDiffPct))
      note = requireReason(
        input.note,
        `the invoice is RM${amount.toFixed(2)}, not the ${due.expected ? "contract's" : 'amount sent to the client,'} RM${target!.toFixed(2)}`,
      );
    if (old?.invoice) {
      if (!ctx.senior) throw new AccessDenied('view', '(the team leader, the Finance Director or the CEO corrects a recorded invoice)');
      note = requireReason(input.note, 'correct the recorded invoice');
    }
    const line: FinBillingLine = {
      ...base,
      expected: due.expected,
      invoice: { no, date, amount, note, by: sign.by, byId: sign.byId, at: sign.at },
      none: null,
      history: [
        ...base.history,
        {
          what: `${old?.invoice ? `corrected from ${old.invoice.no} RM${old.invoice.amount.toFixed(2)} to` : 'invoice'} ${no} RM${amount.toFixed(2)}${note ? `: ${note}` : ''}`,
          by: sign.by,
          at: sign.at,
        },
      ],
    };
    return {
      patch: { billing: save(line) },
      action: 'finance.billing.invoice',
      summary: `${c.clientName} (${c.ref}) ${period}: invoice ${no} RM${amount.toFixed(2)} in SQL Account${note ? ` (${note})` : ''}.`,
      result: line,
    };
  }
  if (action === 'none') {
    if (old?.invoice) throw new BadRequest(`Invoice ${old.invoice.no} is already recorded for this month.`);
    const reason = requireReason(input.reason ?? input.comment, 'say there is no invoice');
    const line: FinBillingLine = {
      ...base,
      none: { reason, by: sign.by, byId: sign.byId, at: sign.at, checked: null },
      history: [...base.history, { what: `no invoice: ${reason}`, by: sign.by, at: sign.at }],
    };
    return {
      patch: { billing: save(line) },
      action: 'finance.billing.none',
      summary: `${c.clientName} (${c.ref}) ${period}: no invoice, waiting for a check: ${reason}`,
      result: line,
    };
  }
  if (action === 'check') {
    needReviewer(ctx, 'checks a month with no invoice');
    if (!old?.none || old.none.checked) throw new BadRequest('There is no "no invoice" reason waiting for a check.');
    if (old.none.byId === ctx.user.id) throw new AccessDenied('view', '(someone other than the person who gave the reason checks it)');
    if (input.ok === false) {
      const why = requireReason(input.comment, 'send it back');
      const line: FinBillingLine = { ...old, none: null, history: [...old.history, { what: `"no invoice" not accepted: ${why}`, by: sign.by, at: sign.at }] };
      return {
        patch: { billing: save(line) },
        action: 'finance.billing.none_returned',
        summary: `${c.clientName} (${c.ref}) ${period}: "no invoice" not accepted, bill it: ${why}`,
        result: line,
      };
    }
    const comment = requireComment(input.comment, 'agree there is no invoice');
    const line: FinBillingLine = {
      ...old,
      none: { ...old.none, checked: { ...sign, comment } },
      history: [...old.history, { what: `"no invoice" checked: ${comment}`, by: sign.by, at: sign.at }],
    };
    return {
      patch: { billing: save(line) },
      action: 'finance.billing.none_checked',
      summary: `${c.clientName} (${c.ref}) ${period}: no invoice, checked: ${comment}`,
      result: line,
    };
  }
  throw new BadRequest('Unknown billing action.');
}

/** The billing list for a month: each contract with its invoice, the reason there is none, or nothing yet. */
export function finBillingRows(f: FinStatus, contracts: Contract[], clients: ClientAccount[], period: string) {
  return finBillingDue(contracts, f.companyId, period).map(({ contract: c, expected }) => {
    const line = (f.billing ?? []).find((x) => x.id === billingId(c.id, period)) ?? null;
    const sent = clients.find((a) => a.id === c.clientAccountId)?.invoices?.find((x) => x.period === period) ?? null;
    return {
      contractId: c.id,
      contractRef: c.ref,
      client: c.clientName,
      state: c.state,
      period,
      expected,
      // What the company recorded sending to the client (Clients screen), to compare.
      sentAmount: sent?.amount ?? null,
      invoice: line?.invoice ?? null,
      none: line?.none ?? null,
      status: line?.invoice
        ? ('invoiced' as const)
        : line?.none?.checked
          ? ('none_checked' as const)
          : line?.none
            ? ('none_to_check' as const)
            : ('missing' as const),
    };
  });
}

// ---------- Government claims (2) ----------

const openClaim = (c: FinGovtClaim) => c.status === 'submitted' || c.status === 'queried';
const lastTouch = (c: FinGovtClaim) => c.log.reduce((d, l) => (l.at.slice(0, 10) > d ? l.at.slice(0, 10) : d), c.submittedOn);

/** A claim past its expected payment date with no follow-up within the follow-up days (or past the next follow-up date). */
export function finGovtStale(c: FinGovtClaim, today: IsoDate, followUpDays: number = R().govtFollowUpDays): boolean {
  if (!openClaim(c) || today <= c.expectedBy) return false;
  return (c.nextOn != null && c.nextOn < today) || daysBetween(lastTouch(c), today) > followUpDays;
}

export function finGovtAction(ctx: FinCashCtx, f: FinStatus, action: string, input: Record<string, unknown>): Out<unknown> {
  finance(ctx);
  const list = f.govtClaims ?? [];
  const sign = ctx.sign();
  const logOf = (kind: FinGovtClaim['log'][number]['kind'], t: string, on?: IsoDate) => ({
    kind,
    text: t,
    by: sign.by,
    byId: sign.byId,
    at: sign.at,
    ...(on ? { on } : {}),
  });
  const nextOnOf = (v: unknown) => {
    if (v == null || v === '') return addDays(ctx.today, ctx.fs?.govtFollowUpDays ?? R().govtFollowUpDays);
    const d = isoDate(v, 'Next follow-up');
    if (d <= ctx.today || daysBetween(ctx.today, d) > 60) throw new BadRequest('The next follow-up is after today and within 60 days.');
    return d;
  };
  if (action === 'add') {
    const agency = text(input.agency, 'Government client (ministry, department or agency)', 3, 120);
    const invoiceNo = noSecrets(text(input.invoiceNo, 'SQL Account invoice number', 2, 40), 'Invoice number');
    if (list.some((c) => c.status !== 'cancelled' && norm(c.invoiceNo) === norm(invoiceNo)))
      throw new BadRequest(`Invoice ${invoiceNo} already has a claim here.`);
    const amount = money(input.amount, 'Claim amount');
    const claimRef = noSecrets(text(input.claimRef, 'Claim reference (ePerolehan, iGFMAS, letter or file number)', 2, 80), 'Claim reference');
    const submittedOn = isoDate(input.submittedOn, 'Date submitted');
    if (submittedOn > ctx.today) throw new BadRequest('The claim is recorded once it is submitted.');
    const expectedBy = input.expectedBy ? isoDate(input.expectedBy, 'Expected payment date') : addDays(submittedOn, ctx.fs?.govtPayDays ?? R().govtPayDays);
    if (expectedBy < submittedOn) throw new BadRequest('Payment is expected after the claim is submitted.');
    const contractId = typeof input.contractId === 'string' && input.contractId ? input.contractId.slice(0, 120) : null;
    const id = `govt-${f.companyId}-${String(list.length + 1).padStart(3, '0')}`;
    const note = typeof input.comment === 'string' ? input.comment.trim().slice(0, 300) : '';
    const claim: FinGovtClaim = {
      id,
      agency,
      contractId,
      invoiceNo,
      amount,
      claimRef,
      submittedOn,
      expectedBy,
      status: 'submitted',
      nextOn: expectedBy,
      log: [logOf('submitted', `Submitted ${submittedOn} (${claimRef}), payment expected by ${expectedBy}${note ? `: ${note}` : ''}`, submittedOn)],
      paid: null,
      opened: sign,
    };
    const m = finMatchGovt(f.statements ?? [], [...list, claim], sign.at);
    return {
      patch: { govtClaims: m.claims, ...(m.matched ? { statements: m.statements } : {}) },
      action: 'finance.govt.added',
      summary: `Government claim ${id}: ${agency}, invoice ${invoiceNo} RM${amount.toFixed(2)}, ${claimRef}, submitted ${submittedOn}, expected by ${expectedBy}${m.matched ? '; already found on the bank statement' : ''}.`,
      result: m.claims.find((x) => x.id === id),
    };
  }
  const c = list.find((x) => x.id === input.claimId);
  if (!c) throw new NotFound('Government claim');
  const save = (n: FinGovtClaim) => list.map((x) => (x.id === c.id ? n : x));
  if (action === 'follow' || action === 'query') {
    if (!openClaim(c)) throw new BadRequest('That claim is not waiting for payment.');
    const t = requireReason(
      input.comment,
      action === 'query' ? 'record what the agency asked to correct' : 'record the follow-up (who you spoke to and what they said)',
    );
    const nextOn = nextOnOf(input.nextOn);
    const n: FinGovtClaim = { ...c, status: action === 'query' ? 'queried' : c.status, nextOn, log: [...c.log, logOf(action, t)] };
    return {
      patch: { govtClaims: save(n) },
      action: `finance.govt.${action}`,
      summary: `Government claim ${c.id} (${c.agency}, ${c.invoiceNo}): ${action === 'query' ? 'queried' : 'followed up'}: ${t}. Next ${nextOn}.`,
      result: n,
    };
  }
  if (action === 'resubmit') {
    if (!openClaim(c)) throw new BadRequest('That claim is not waiting for payment.');
    const on = isoDate(input.submittedOn, 'Date resubmitted');
    if (on > ctx.today || on < c.submittedOn) throw new BadRequest('The resubmission date is between the first submission and today.');
    const claimRef = input.claimRef ? noSecrets(text(input.claimRef, 'Claim reference', 2, 80), 'Claim reference') : c.claimRef;
    const expectedBy = addDays(on, ctx.fs?.govtPayDays ?? R().govtPayDays);
    const t = requireReason(input.comment, 'say what was corrected');
    const n: FinGovtClaim = {
      ...c,
      status: 'submitted',
      claimRef,
      expectedBy,
      nextOn: expectedBy,
      log: [...c.log, logOf('resubmit', `Resubmitted ${on} (${claimRef}), expected by ${expectedBy}: ${t}`, on)],
    };
    return {
      patch: { govtClaims: save(n) },
      action: 'finance.govt.resubmit',
      summary: `Government claim ${c.id} resubmitted ${on}, expected by ${expectedBy}: ${t}`,
      result: n,
    };
  }
  if (action === 'paid') {
    if (!openClaim(c)) throw new BadRequest('That claim is not waiting for payment.');
    const statements = f.statements ?? [];
    const st = statements.find((x) => x.id === input.statementId);
    const line = st?.lines.find((l) => l.id === input.lineId);
    if (!st || !line) throw new NotFound('Bank statement line');
    if (line.match) throw new BadRequest('That bank line is already matched.');
    if (line.amount <= 0) throw new BadRequest('Choose money in.');
    if (line.date < c.submittedOn) throw new BadRequest('That money came in before the claim was submitted.');
    let t = requireComment(input.comment, 'link the payment');
    // Agencies sometimes deduct (late delivery penalties, retention): a different amount says why.
    if (Math.abs(line.amount - c.amount) >= 0.005)
      t = requireReason(input.comment, `link RM${line.amount.toFixed(2)} to a RM${c.amount.toFixed(2)} claim (say what the agency deducted)`);
    const lines = st.lines.map((l) =>
      l.id === line.id ? { ...l, match: { kind: 'govt' as const, claimId: c.id, by: sign.by, byId: sign.byId, at: sign.at } } : l,
    );
    const n: FinGovtClaim = {
      ...c,
      status: 'paid',
      nextOn: null,
      paid: { statementId: st.id, lineId: line.id, date: line.date, amount: line.amount, how: 'hand', by: sign.by },
      log: [...c.log, logOf('paid', `RM${line.amount.toFixed(2)} on the bank statement ${line.date}: ${t}`)],
    };
    return {
      patch: { govtClaims: save(n), statements: statements.map((x) => (x.id === st.id ? { ...st, lines } : x)) },
      action: 'finance.govt.paid',
      summary: `Government claim ${c.id} (${c.agency}, ${c.invoiceNo}) paid RM${line.amount.toFixed(2)} on ${line.date}: ${t}`,
      result: n,
    };
  }
  if (action === 'cancel') {
    if (!ctx.senior) throw new AccessDenied('view', '(the team leader, the Finance Director or the CEO cancels a claim)');
    if (!openClaim(c)) throw new BadRequest('That claim is not waiting for payment.');
    const why = requireReason(input.comment, 'cancel the claim');
    const n: FinGovtClaim = { ...c, status: 'cancelled', nextOn: null, log: [...c.log, logOf('cancel', why)] };
    return { patch: { govtClaims: save(n) }, action: 'finance.govt.cancel', summary: `Government claim ${c.id} cancelled: ${why}`, result: n };
  }
  throw new BadRequest('Unknown government claim action.');
}

/**
 * Government payments found on the loaded bank statements: money in for the claim's amount, on or after it was
 * submitted, with the invoice number or claim reference on the line when more than one fits.
 */
export function finMatchGovt(statements: FinStatement[], claims: FinGovtClaim[], at: IsoDateTime) {
  const sts = statements.map((st) => ({ ...st, lines: [...st.lines] }));
  let matched = 0;
  const out = claims.map((c) => {
    if (!openClaim(c)) return c;
    const cands: { st: (typeof sts)[number]; i: number }[] = [];
    for (const st of sts)
      st.lines.forEach((l, i) => {
        if (!l.match && l.amount > 0 && Math.abs(l.amount - c.amount) < 0.005 && l.date >= (c.log[0].on ?? c.submittedOn)) cands.push({ st, i });
      });
    const refs = [norm(c.invoiceNo), norm(c.claimRef)].filter((r) => r.length >= 4);
    const byRef = cands.filter(({ st, i }) => refs.some((r) => norm(`${st.lines[i].ref} ${st.lines[i].description}`).includes(r)));
    const pick = byRef.length === 1 ? byRef[0] : byRef.length === 0 && cands.length === 1 ? cands[0] : null;
    if (!pick) return c;
    const line = pick.st.lines[pick.i];
    pick.st.lines[pick.i] = { ...line, match: { kind: 'govt', claimId: c.id, by: 'Prima (automatic)', at } };
    matched += 1;
    return {
      ...c,
      status: 'paid' as const,
      nextOn: null,
      paid: { statementId: pick.st.id, lineId: line.id, date: line.date, amount: line.amount, how: 'auto' as const, by: 'Prima (automatic)' },
      log: [
        ...c.log,
        {
          kind: 'paid' as const,
          text: `RM${line.amount.toFixed(2)} found on the bank statement ${line.date}`,
          by: 'Prima (automatic)',
          byId: 'prima:auto',
          at,
        },
      ],
    };
  });
  return { statements: sts, claims: out, matched };
}

/** Takes back government payments found on a replaced statement or an unmatched line: the claim waits again. */
export function finUnmatchGovt(claims: FinGovtClaim[], hit: (p: { statementId: Id; lineId: Id }) => boolean, at: IsoDateTime): FinGovtClaim[] {
  return claims.map((c) =>
    c.status === 'paid' && c.paid && hit(c.paid)
      ? {
          ...c,
          status: 'submitted' as const,
          paid: null,
          nextOn: c.expectedBy,
          log: [
            ...c.log,
            {
              kind: 'unpaid' as const,
              text: 'The bank line was unmatched or its statement replaced; waiting for the payment again',
              by: 'Prima (automatic)',
              byId: 'prima:auto',
              at,
            },
          ],
        }
      : c,
  );
}

// ---------- Unidentified money in (5) ----------

type Located = { st: FinStatement; line: FinStatementLine };
function moneyIn(f: FinStatus): Located[] {
  return (f.statements ?? []).flatMap((st) => st.lines.filter((l) => l.amount > 0).map((line) => ({ st, line })));
}

/** Money in with no match yet, oldest first, with how many days it has waited. */
export function finUnidentified(f: FinStatus, today: IsoDate, limit: number = R().unidentifiedDays) {
  const claims = (f.govtClaims ?? []).filter(openClaim);
  return moneyIn(f)
    .filter(({ line }) => !line.match)
    .sort((a, b) => a.line.date.localeCompare(b.line.date))
    .map(({ st, line }) => {
      const days = daysBetween(line.date, today);
      return {
        statementId: st.id,
        bankId: st.bankId,
        lineId: line.id,
        date: line.date,
        description: line.description,
        ref: line.ref,
        amount: line.amount,
        days,
        allocateBy: addDays(line.date, limit),
        late: days > limit,
        // Government claims for the same amount, to link with one press.
        suggest: claims
          .filter((c) => Math.abs(c.amount - line.amount) < 0.005 && line.date >= c.submittedOn)
          .map((c) => ({ claimId: c.id, agency: c.agency, invoiceNo: c.invoiceNo })),
      };
    });
}

/** Allocations waiting for someone other than the allocator to check them. */
export function finAllocationsToCheck(f: FinStatus) {
  return moneyIn(f).flatMap(({ st, line }) =>
    line.match?.kind === 'allocated' && !line.match.checked
      ? [{ statementId: st.id, lineId: line.id, date: line.date, amount: line.amount, description: line.description, ...line.match }]
      : [],
  );
}

export const FIN_ALLOCATE_TO = ['invoice', 'intercompany', 'refund', 'other'] as const;

export function finAllocateAction(ctx: FinCashCtx, f: FinStatus, action: string, input: Record<string, unknown>): Out<unknown> {
  finance(ctx);
  const statements = f.statements ?? [];
  const st = statements.find((x) => x.id === input.statementId);
  const line = st?.lines.find((l) => l.id === input.lineId);
  if (!st || !line) throw new NotFound('Bank statement line');
  if (line.amount <= 0) throw new BadRequest('Only money in is allocated here.');
  const sign = ctx.sign();
  const put = (match: FinStatementLine['match']) =>
    statements.map((x) => (x.id === st.id ? { ...st, lines: st.lines.map((l) => (l.id === line.id ? { ...l, match } : l)) } : x));
  if (action === 'allocate') {
    if (line.match) throw new BadRequest('That bank line is already matched.');
    const to = FIN_ALLOCATE_TO.find((x) => x === input.to);
    if (!to) throw new BadRequest('Say what the money is for: an invoice, a transfer between group companies, a refund, or something else.');
    const ref = noSecrets(
      text(
        input.ref,
        to === 'invoice'
          ? 'SQL Account invoice number(s)'
          : to === 'intercompany'
            ? 'The group company and its reference'
            : to === 'refund'
              ? 'What was refunded (supplier, deposit, Customs)'
              : 'Reference',
        2,
        120,
      ),
      'Reference',
    );
    const payer = text(input.payer, 'Who paid (as the bank or the remittance shows)', 2, 120);
    const note =
      to === 'other'
        ? requireReason(input.note, 'allocate it to something other than an invoice')
        : typeof input.note === 'string'
          ? input.note.trim().slice(0, 300)
          : '';
    const match = { kind: 'allocated' as const, to, ref, payer, note, by: sign.by, byId: sign.byId, at: sign.at, checked: null };
    return {
      patch: { statements: put(match) },
      action: 'finance.moneyin.allocated',
      summary: `Money in ${line.date} RM${line.amount.toFixed(2)} from ${payer} allocated to ${to} ${ref}${note ? `: ${note}` : ''}. Post it in SQL Account; someone else checks it.`,
      result: match,
    };
  }
  if (action === 'check') {
    needReviewer(ctx, 'checks an allocation');
    const m = line.match;
    if (m?.kind !== 'allocated' || m.checked) throw new BadRequest('That line has no allocation waiting for a check.');
    if (m.byId === ctx.user.id) throw new AccessDenied('view', '(someone other than the person who allocated it checks it)');
    if (input.ok === false) {
      const why = requireReason(input.comment, 'send the allocation back');
      return {
        patch: { statements: put(null) },
        action: 'finance.moneyin.returned',
        summary: `Allocation of ${line.date} RM${line.amount.toFixed(2)} (${m.to} ${m.ref}) sent back, unidentified again: ${why}`,
        result: { ok: true },
      };
    }
    const comment = requireComment(input.comment, 'check the allocation');
    const match = { ...m, checked: { ...sign, comment } };
    return {
      patch: { statements: put(match) },
      action: 'finance.moneyin.checked',
      summary: `Allocation of ${line.date} RM${line.amount.toFixed(2)} (${m.to} ${m.ref}) checked: ${comment}`,
      result: match,
    };
  }
  throw new BadRequest('Unknown action.');
}

// ---------- Close, home and view ----------

/** Named at the month-end close: contracts not billed, government claims overdue and not followed up, money in not allocated. */
export function finMoneyInExceptions(f: FinStatus, contracts: Contract[] | null, period: string, today: IsoDate, s?: Partial<FinSettingsValues>) {
  const out: { key: string; text: string }[] = [];
  const end = periodEnd(period);
  if (contracts)
    for (const r of finBillingRows(f, contracts, [], period)) {
      if (r.status === 'missing')
        out.push({ key: `bill:${r.contractId}:${period}`, text: `${r.client} (contract ${r.contractRef}) has no invoice in SQL Account for ${period}` });
      if (r.status === 'none_to_check')
        out.push({
          key: `bill:${r.contractId}:${period}`,
          text: `${r.client} (contract ${r.contractRef}): "no invoice for ${period}" is waiting for someone else to check it`,
        });
    }
  for (const c of (f.govtClaims ?? []).filter((x) => finGovtStale(x, today, s?.govtFollowUpDays)))
    out.push({
      key: `govt:${c.id}`,
      text: `Government claim ${c.invoiceNo} (${c.agency}, RM${c.amount.toFixed(2)}) was expected by ${c.expectedBy} and has not been followed up`,
    });
  for (const u of finUnidentified(f, today, s?.unidentifiedDays))
    if (u.date <= end && u.late)
      out.push({
        key: `unid:${u.lineId}`,
        text: `Money in RM${u.amount.toFixed(2)} on ${u.date} (${u.description}) is still unidentified after ${u.days} days`,
      });
  for (const a of finAllocationsToCheck(f))
    if (a.date <= end)
      out.push({
        key: `alloc:${a.lineId}`,
        text: `Allocation of RM${a.amount.toFixed(2)} on ${a.date} to ${a.to} ${a.ref} is waiting for someone else to check it`,
      });
  return out;
}

/** Counts for Finance home. */
export function finMoneyInHome(f: FinStatus, ctx: { userId: Id; reviewer: boolean }, contracts: Contract[] | null, period: string, today: IsoDate, s?: Partial<FinSettingsValues>) {
  const rows = contracts ? finBillingRows(f, contracts, [], period) : [];
  const claims = f.govtClaims ?? [];
  const unid = finUnidentified(f, today, s?.unidentifiedDays);
  return {
    billMissing: rows.filter((r) => r.status === 'missing').length,
    billToCheck: ctx.reviewer ? rows.filter((r) => r.status === 'none_to_check' && r.none?.byId !== ctx.userId).length : 0,
    govtOverdue: claims.filter((c) => openClaim(c) && c.expectedBy < today).length,
    govtOverdueAmount: round2(claims.filter((c) => openClaim(c) && c.expectedBy < today).reduce((n, c) => n + c.amount, 0)),
    govtStale: claims.filter((c) => finGovtStale(c, today, s?.govtFollowUpDays)).length,
    govtFollowToday: claims.filter((c) => openClaim(c) && c.nextOn != null && c.nextOn <= today).length,
    unidentified: unid.length,
    unidentifiedLate: unid.filter((u) => u.late).length,
    allocToCheck: ctx.reviewer ? finAllocationsToCheck(f).filter((a) => a.byId !== ctx.userId).length : 0,
  };
}

/** The Money in tab: billing for the chosen month, government claims, unidentified money in and allocations to check. */
export function finMoneyInView(f: FinStatus, contracts: Contract[], clients: ClientAccount[], period: string, today: IsoDate, s?: Partial<FinSettingsValues>) {
  const claims = [...(f.govtClaims ?? [])].sort((a, b) => Number(openClaim(b)) - Number(openClaim(a)) || a.expectedBy.localeCompare(b.expectedBy));
  return {
    period,
    rule: { ...RULES.financeMoneyIn, value: { ...RULES.financeMoneyIn.value, ...(s ? { billDiffPct: s.billDiffPct ?? R().billDiffPct, govtPayDays: s.govtPayDays ?? R().govtPayDays, govtFollowUpDays: s.govtFollowUpDays ?? R().govtFollowUpDays, unidentifiedDays: s.unidentifiedDays ?? R().unidentifiedDays } : {}) } },
    billing: finBillingRows(f, contracts, clients, period),
    contracts: contracts.filter((c) => c.companyId === f.companyId).map((c) => ({ id: c.id, ref: c.ref, client: c.clientName })),
    govt: claims
      .filter((c) => openClaim(c) || daysBetween(c.log[c.log.length - 1].at.slice(0, 10), today) <= 92)
      .map((c) => ({
        ...c,
        overdue: openClaim(c) && c.expectedBy < today,
        stale: finGovtStale(c, today, s?.govtFollowUpDays),
        daysOut: openClaim(c) ? daysBetween(c.submittedOn, today) : null,
      })),
    unidentified: finUnidentified(f, today, s?.unidentifiedDays),
    toCheck: finAllocationsToCheck(f),
    // Recently allocated and checked, for reference.
    allocated: moneyIn(f)
      .flatMap(({ st, line }) =>
        line.match?.kind === 'allocated' && line.match.checked
          ? [{ statementId: st.id, lineId: line.id, date: line.date, amount: line.amount, ...line.match }]
          : [],
      )
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 30),
  };
}