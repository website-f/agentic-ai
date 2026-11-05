// Contract end and money held by clients (Fauzan, 2 Nov 2026: yes to suggestions 3 and 24 and automation A11).
//
// 3. Client deposits and retention sums held by clients are listed per contract, checked by a second person (money owed
//    to the company), claimed back once the contract ends, and found on the bank statement by Prima when paid back.
// 24 and A11. When a contract ends or is terminated, billing stops at that day and the follow-ups open by themselves:
//    the final invoice, each deposit or retention to claim back, each IG/BG to release and its collateral, and, for an
//    agreement cancelled before it started, the stamp duty refund. People do and check each one; Prima only lists them
//    and finds the money on the bank statement.

import { AccessDenied } from './access';
import { isLead, isoDate, noSecrets, requireReason, text } from './finance';
import type { FinCashCtx } from './finance-cash';
import { RULES } from './rules';
import { BadRequest, NotFound } from './service';
import { addDays, daysBetween } from './time';
import type { Contract, FinSign, FinStatement, FinStatus, Id, IsoDate } from './types';

export interface FinClientDeposit {
  id: Id;
  companyId: Id;
  contractId: Id | null;
  client: string;
  kind: 'deposit' | 'retention';
  amount: number;
  /** When the client took it (deposit paid, or first retention deducted). */
  heldSince: IsoDate;
  /** When the client should pay it back, if the contract says; otherwise worked out from the contract's end. */
  dueBackOn: IsoDate | null;
  status: 'pending' | 'held' | 'claimed' | 'refunded' | 'written_off';
  added: FinSign & { doc: string };
  checked: FinSign | null;
  claim: (FinSign & { on: IsoDate; ref: string; docs: string[] }) | null;
  refund: { statementId: Id; lineId: Id; date: IsoDate; amount: number } | null;
  writtenOff: (FinSign & { amount: number }) | null;
}

/** The day a contract stopped: the day it was terminated, else its end date. */
export function finContractEndOn(c: Pick<Contract, 'endOn' | 'endedOn'>): IsoDate {
  return c.endedOn && c.endedOn < c.endOn ? c.endedOn : c.endOn;
}

/** The day a deposit or retention is expected back: as agreed, else the contract's end plus the claim days. */
export function finDepositDueBack(d: FinClientDeposit, contracts: Contract[]): IsoDate | null {
  if (d.dueBackOn) return d.dueBackOn;
  const c = d.contractId ? contracts.find((x) => x.id === d.contractId) : null;
  return c ? addDays(finContractEndOn(c), RULES.financeContractEnd.value.claimWithinDays) : null;
}

type Out<T> = { patch: Partial<FinStatus>; action: string; summary: string; result: T };

const money = (v: unknown, what: string): number => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 100_000_000) throw new BadRequest(`${what}: give an amount in RM.`);
  return Math.round(n * 100) / 100;
};

/** Add (from the contract or the client's letter), check (someone else), claim back, write off (FD or CEO). */
export function finDepositAction(ctx: FinCashCtx, f: FinStatus, contracts: Contract[], action: string, input: Record<string, unknown>): Out<unknown> {
  if (!ctx.a || ctx.a.kind === 'viewer' || ctx.a.kind === 'coo') throw new AccessDenied('view', '(Finance staff keep deposits and retention)');
  const list = f.clientDeposits ?? [];
  const save = (d: FinClientDeposit) => ({ clientDeposits: list.some((x) => x.id === d.id) ? list.map((x) => (x.id === d.id ? d : x)) : [...list, d] });
  if (action === 'add') {
    const kind = input.kind === 'retention' ? 'retention' : input.kind === 'deposit' ? 'deposit' : null;
    if (!kind) throw new BadRequest('Type: deposit or retention.');
    const contractId = typeof input.contractId === 'string' && input.contractId ? input.contractId : null;
    const c = contractId ? contracts.find((x) => x.id === contractId && x.companyId === f.companyId) : null;
    if (contractId && !c) throw new NotFound('Contract');
    const heldSince = isoDate(input.heldSince, 'Held since');
    if (heldSince > ctx.today) throw new BadRequest('"Held since" cannot be in the future.');
    const dueBackOn = input.dueBackOn ? isoDate(input.dueBackOn, 'Due back on') : null;
    const d: FinClientDeposit = {
      id: `dep-${f.companyId}-${String(list.length + 1).padStart(3, '0')}`,
      companyId: f.companyId,
      contractId,
      client: c ? c.clientName : noSecrets(text(input.client, 'Client', 2, 160), 'Client'),
      kind,
      amount: money(input.amount, 'Amount held'),
      heldSince,
      dueBackOn,
      status: 'pending',
      added: { ...ctx.sign(), doc: noSecrets(text(input.doc, 'The contract clause or receipt it is in', 3, 300), 'Document') },
      checked: null,
      claim: null,
      refund: null,
      writtenOff: null,
    };
    return {
      patch: save(d),
      action: 'finance.deposit.added',
      summary: `${kind} RM${d.amount.toFixed(2)} held by ${d.client}${c ? ` (${c.ref})` : ''}; waiting for a second person to check.`,
      result: d,
    };
  }
  const d = list.find((x) => x.id === input.depositId);
  if (!d) throw new NotFound('Deposit or retention');
  if (action === 'check') {
    if (!ctx.reviewer) throw new AccessDenied('view', '(the deputy, the team leader, the Finance Director or the CEO checks it)');
    if (d.status !== 'pending') throw new BadRequest('Nothing to check.');
    if (d.added.byId === ctx.user.id) throw new AccessDenied('view', '(nobody checks what they entered)');
    const next: FinClientDeposit = { ...d, status: 'held', checked: ctx.sign(text(input.comment, 'What you checked it against', 5, 300)) };
    return { patch: save(next), action: 'finance.deposit.checked', summary: `${d.kind} ${d.id} for ${d.client} checked.`, result: next };
  }
  if (d.status === 'pending') throw new BadRequest('A second person checks it first.');
  if (action === 'claim') {
    if (d.status !== 'held') throw new BadRequest('Only money still held is claimed back.');
    const due = finDepositDueBack(d, contracts);
    const c = d.contractId ? contracts.find((x) => x.id === d.contractId) : null;
    const ended = c ? finContractEndOn(c) <= ctx.today : false;
    if (!ended && !(due && due <= ctx.today) && !input.comment) throw new BadRequest('The contract has not ended; say why it is claimed back now.');
    const on = isoDate(input.on ?? ctx.today, 'Claim date');
    if (on > ctx.today) throw new BadRequest('The claim date cannot be in the future.');
    const ref = noSecrets(text(input.ref, 'Claim letter reference', 3, 60), 'Reference');
    const docs = (Array.isArray(input.docs) ? input.docs : String(input.docs ?? '').split('\n'))
      .map((x) => String(x).trim())
      .filter(Boolean)
      .slice(0, 10);
    if (!docs.length) throw new BadRequest("List the claim letter (and the client's release, if any).");
    const next: FinClientDeposit = {
      ...d,
      status: 'claimed',
      claim: { ...ctx.sign(typeof input.comment === 'string' ? input.comment.slice(0, 300) : ''), on, ref, docs },
    };
    return {
      patch: save(next),
      action: 'finance.deposit.claimed',
      summary: `${d.kind} RM${d.amount.toFixed(2)} claimed back from ${d.client} (${ref}). Prima looks for it on the bank statement.`,
      result: next,
    };
  }
  if (action === 'writeOff') {
    if (!isLead(ctx.a)) throw new AccessDenied('view', '(only the Finance Director or the CEO writes it off)');
    if (!['held', 'claimed'].includes(d.status)) throw new BadRequest('Only money not yet paid back is written off.');
    if (d.added.byId === ctx.user.id || d.claim?.byId === ctx.user.id) throw new AccessDenied('view', '(not by whoever entered or claimed it)');
    const why = requireReason(input.comment, 'write it off');
    const next: FinClientDeposit = { ...d, status: 'written_off', writtenOff: { ...ctx.sign(why), amount: d.amount } };
    return {
      patch: save(next),
      action: 'finance.deposit.written_off',
      summary: `${d.kind} RM${d.amount.toFixed(2)} from ${d.client} written off: ${why}`,
      result: next,
    };
  }
  throw new BadRequest('Unknown action.');
}

/** Money in on the statements that pays back a claimed (or due) deposit: same amount, after the claim or the end. */
export function finMatchDeposits(statements: FinStatement[], deposits: FinClientDeposit[], contracts: Contract[], at: string) {
  const sts = statements.map((st) => ({ ...st, lines: [...st.lines] }));
  let found = 0;
  const next = deposits.map((d) => {
    if (d.refund || !['held', 'claimed'].includes(d.status)) return d;
    const c = d.contractId ? contracts.find((x) => x.id === d.contractId) : null;
    const from = d.claim?.on ?? (c ? finContractEndOn(c) : null);
    if (!from) return d;
    const cands: { st: (typeof sts)[number]; i: number }[] = [];
    for (const st of sts)
      st.lines.forEach((l, i) => {
        if (!l.match && l.amount > 0 && Math.abs(l.amount - d.amount) < 0.005 && l.date >= addDays(from, -7)) cands.push({ st, i });
      });
    const keys = [d.claim?.ref, c?.ref, d.client.split(/\s+/)[0]]
      .filter((k): k is string => !!k && k.length >= 3)
      .map((k) => k.toUpperCase().replace(/[^A-Z0-9]/g, ''));
    const byRef = cands.filter(({ st, i }) =>
      keys.some((k) =>
        `${st.lines[i].ref} ${st.lines[i].description}`
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')
          .includes(k),
      ),
    );
    const pick = byRef.length === 1 ? byRef[0] : byRef.length === 0 && cands.length === 1 ? cands[0] : null;
    if (!pick) return d;
    const line = pick.st.lines[pick.i];
    pick.st.lines[pick.i] = { ...line, match: { kind: 'deposit', depositId: d.id, by: 'Prima', at } };
    found += 1;
    return { ...d, status: 'refunded' as const, refund: { statementId: pick.st.id, lineId: line.id, date: line.date, amount: line.amount } };
  });
  return { statements: sts, deposits: next, found };
}

/** Takes back a refund whose statement was replaced or whose line was unmatched. */
export function finUnmatchDeposits(deposits: FinClientDeposit[], hit: (m: { statementId: Id; lineId: Id }) => boolean): FinClientDeposit[] {
  return deposits.map((d) => (d.refund && hit(d.refund) ? { ...d, refund: null, status: d.claim ? ('claimed' as const) : ('held' as const) } : d));
}

export type FinEndStepKind = 'final_invoice' | 'deposit' | 'guarantee' | 'stamp_refund';
export interface FinEndStep {
  kind: FinEndStepKind;
  text: string;
  done: boolean;
  /** When it should be done by; past means late. */
  by: IsoDate | null;
}

/**
 * Every contract that ended in the last year, with its follow-ups and whether each is done. Prima opens these by itself
 * the day the contract ends or is terminated (A11); billing stops at that day.
 */
export function finContractEnds(f: FinStatus, contracts: Contract[], today: IsoDate) {
  const rule = RULES.financeContractEnd.value;
  const out: { contract: { id: Id; ref: string; client: string; endOn: IsoDate; terminated: boolean }; steps: FinEndStep[]; open: number; late: number }[] = [];
  for (const c of contracts) {
    if (c.companyId !== f.companyId) continue;
    const end = finContractEndOn(c);
    if (end > today || daysBetween(end, today) > rule.showDays) continue;
    const ranAtAll = c.startOn <= end && c.state !== 'awarded' && c.state !== 'mobilising';
    const steps: FinEndStep[] = [];
    if (ranAtAll) {
      const lastPeriod = end.slice(0, 7);
      const line = (f.billing ?? []).find((b) => b.contractId === c.id && b.period === lastPeriod);
      steps.push({
        kind: 'final_invoice',
        text: `Final invoice for ${lastPeriod} (to ${end})`,
        done: !!(line?.invoice || line?.none),
        by: addDays(end, rule.finalInvoiceDays),
      });
    }
    for (const d of (f.clientDeposits ?? []).filter((x) => x.contractId === c.id)) {
      const by = finDepositDueBack(d, contracts);
      steps.push({
        kind: 'deposit',
        text: `${d.kind === 'deposit' ? 'Deposit' : 'Retention'} RM${d.amount.toFixed(2)}: ${d.status === 'refunded' ? `paid back ${d.refund!.date}` : d.status === 'written_off' ? 'written off' : d.status === 'claimed' ? `claimed ${d.claim!.on}, waiting for the money` : 'claim it back'}`,
        done: d.status === 'refunded' || d.status === 'written_off',
        by,
      });
    }
    for (const g of (f.guarantees ?? []).filter((x) => x.contractId === c.id)) {
      const done = g.status === 'ended' || g.status === 'refunded' || g.status === 'called' || (g.status === 'released' && g.collateral <= 0);
      steps.push({
        kind: 'guarantee',
        text: `${g.kind} ${g.number}: ${done ? 'settled' : g.status === 'active' ? 'ask the client for the release letter' : g.collateral > 0 ? `claim back RM${g.collateral.toFixed(2)} collateral` : 'close it'}`,
        done,
        by: addDays(end, rule.claimWithinDays),
      });
    }
    // An agreement cancelled before the service started: its stamp duty can be refunded (s.57, within 12 months).
    if (c.state === 'terminated' && !ranAtAll)
      for (const s of (f.stampDuty ?? []).filter((x) => x.contractId === c.id && x.status === 'stamped'))
        steps.push({ kind: 'stamp_refund', text: `Stamp duty refund for ${s.title}: open it under Stamp duty`, done: false, by: addDays(end, 30) });
    for (const s of (f.stampDuty ?? []).filter((x) => x.contractId === c.id && x.refund))
      steps.push({
        kind: 'stamp_refund',
        text: `Stamp duty refund for ${s.title}: ${s.status.replace('_', ' ')}`,
        done: ['refunded', 'refund_refused', 'closed'].includes(s.status),
        by: s.refund!.claimBy,
      });
    const open = steps.filter((x) => !x.done).length;
    out.push({
      contract: { id: c.id, ref: c.ref, client: c.clientName, endOn: end, terminated: c.state === 'terminated' },
      steps,
      open,
      late: steps.filter((x) => !x.done && x.by && x.by < today).length,
    });
  }
  return out.sort((a, b) => b.open - a.open || b.contract.endOn.localeCompare(a.contract.endOn));
}

export function finContractEndHome(f: FinStatus, contracts: Contract[], today: IsoDate, userId: Id, reviewer: boolean) {
  const ends = finContractEnds(f, contracts, today);
  return {
    endsOpen: ends.filter((e) => e.open > 0).length,
    endsLate: ends.filter((e) => e.late > 0).length,
    depositToCheck: reviewer ? (f.clientDeposits ?? []).filter((d) => d.status === 'pending' && d.added.byId !== userId).length : 0,
  };
}

/** Everything the panel needs: deposits held, contracts that ended and their follow-ups, and contracts to link to. */
export function finContractEndView(f: FinStatus, contracts: Contract[], today: IsoDate) {
  const mine = contracts.filter((c) => c.companyId === f.companyId);
  return {
    deposits: (f.clientDeposits ?? []).map((d) => ({
      ...d,
      dueBack: finDepositDueBack(d, contracts),
      contractRef: mine.find((c) => c.id === d.contractId)?.ref ?? null,
    })),
    ends: finContractEnds(f, contracts, today),
    contracts: mine.map((c) => ({ id: c.id, ref: c.ref, client: c.clientName, endOn: finContractEndOn(c) })).sort((a, b) => a.client.localeCompare(b.client)),
  };
}
