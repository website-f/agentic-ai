import { describe, expect, it } from 'vitest';
import {
  GROUP_EMPLOYER_ID,
  finRequestInMenu,
  MemoryStore,
  PrimaService,
  builtInStatTables,
  generateDataset,
  myt,
  staffPayDirectorChecks,
  statTableFor,
  statTableVerified,
} from '../src';

// Arisha main's review of PR #49 at a602127 (2 Nov 2026): negative tests for approval editors, cash custody and the
// statutory tables, and the correction and resubmission path keeping evidence and history. Dummy data only.
const TODAY = '2026-10-31';
const NOW = myt(TODAY, '10:00');
const T1 = GROUP_EMPLOYER_ID; // Team 1 keeps PWVSB's books
const CO = 'co-09'; // also Team 1

const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const cm = ds.users.find((u) => u.id === 'u-cm-sasa')!;
  ds.users.push({ ...cm, id: 'u-cm-09', name: 'Company Manager 09 (mock)', companyIds: [CO] });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  return { ds, svc, F: (c = T1) => ds.finStatus.find((x) => x.companyId === c)! };
};
const who = (svc: PrimaService, ...ids: string[]) => Promise.all(ids.map((id) => svc.user(id)));
let n = 0;
const pay = (ds: ReturnType<typeof generateDataset>, over: Record<string, unknown> = {}) => ({
  payeeId: 'payee-pwvsb-001',
  purpose: 'Stationery (mock)',
  amount: 401 + ++n,
  dueOn: '2026-11-15',
  bankId: ds.finStatus.find((x) => x.companyId === T1)!.banks[0].id,
  sqlRef: `PI-REV-${n}`,
  evidence: ['invoice.pdf'],
  ...over,
});

describe('Payment approval: only the right person, never their own, never edited after approval', () => {
  it('refuses approval by anyone outside the approver set, and by the preparer or reviewer', async () => {
    const { ds, svc } = fresh();
    const [de1, de2, dep, lead, fd, ceo, coo, act, hr] = await who(
      svc,
      'u-fin-t1-de1',
      'u-fin-t1-de2',
      'u-fin-t1-dep',
      'u-fin-t1-lead',
      'u-fd',
      'u-fauzan',
      'u-coo',
      'u-audit',
      'u-pwvsb-hr',
    );
    const p = await svc.finance.createPayment(de1, T1, pay(ds));
    // Not reviewed yet: nobody approves.
    await expect(svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: 'ok' })).rejects.toThrow();
    // The preparer does not review their own payment.
    await expect(svc.finance.paymentStep(de1, T1, p.id, 'review', { comment: 'ok' })).rejects.toThrow();
    await svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'Agrees to the invoice.' });
    // Data entry, the reviewer, the team leader, the COO (Finance subject), ACT and HR never approve a Finance payment.
    for (const u of [de1, de2, dep, lead, coo, act, hr]) await expect(svc.finance.paymentStep(u, T1, p.id, 'approve', { comment: 'ok' })).rejects.toThrow();
    // A blank or whitespace comment is refused for the FD too.
    await expect(svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: '   ' })).rejects.toThrow();
    expect((await svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: 'Approved.' })).status).toBe('approved');
    // After approval: no second approval, no edit, no resubmission, and the approver does not release.
    await expect(svc.finance.paymentStep(ceo, T1, p.id, 'approve', { comment: 'Again' })).rejects.toThrow();
    await expect(svc.finance.paymentStep(de1, T1, p.id, 'resubmit', { amount: 9999, comment: 'Changed after approval' })).rejects.toThrow();
    await expect(svc.finance.paymentStep(fd, T1, p.id, 'release', { bankRef: 'M2U-1234', accountLast4: '1000', accountName: 'x' })).rejects.toThrow();
    // The FD who prepares a payment does not approve it; the CEO does.
    const own = await svc.finance.createPayment(fd, T1, pay(ds));
    await svc.finance.paymentStep(dep, T1, own.id, 'review', { comment: 'Agrees.' });
    await expect(svc.finance.paymentStep(fd, T1, own.id, 'approve', { comment: 'Mine' })).rejects.toThrow();
    expect((await svc.finance.paymentStep(ceo, T1, own.id, 'approve', { comment: 'Approved by the CEO.' })).status).toBe('approved');
  });

  it('corrects a returned payment without losing documents or the history, and it needs a fresh review and approval', async () => {
    const { ds, svc } = fresh();
    const [de1, dep, fd] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fd');
    const p = await svc.finance.createPayment(de1, T1, pay(ds, { amount: 500, evidence: ['invoice.pdf', 'delivery order.pdf'] }));
    await svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'Agrees.' });
    await svc.finance.paymentStep(fd, T1, p.id, 'return', { comment: 'The invoice says RM450, not RM500.' });
    // Only the preparer corrects it.
    await expect(svc.finance.paymentStep(dep, T1, p.id, 'resubmit', { amount: 450 })).rejects.toThrow();
    // Sending a shorter document list does not drop the earlier documents.
    const r = await svc.finance.paymentStep(de1, T1, p.id, 'resubmit', {
      amount: 450,
      evidence: ['credit note CN-7.pdf'],
      comment: 'Corrected to the invoice',
    });
    expect(r.status).toBe('prepared');
    expect(r.amount).toBe(450);
    expect(r.evidence).toEqual(['invoice.pdf', 'delivery order.pdf', 'credit note CN-7.pdf']);
    expect(r.steps.map((s) => s.step)).toEqual(['prepared', 'reviewed', 'returned', 'resubmitted']);
    const last = r.steps[r.steps.length - 1].comment;
    expect(last).toMatch(/Corrected to the invoice/);
    expect(last).toMatch(/amount RM500\.00 to RM450\.00/);
    expect(last).toMatch(/documents added: credit note CN-7\.pdf/);
    // The old review does not carry over: approval needs a new review first.
    await expect(svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: 'ok' })).rejects.toThrow();
  });
});

describe('Payment requests: correction keeps documents; nobody acts on their own request; no edits after approval', () => {
  const salary = {
    subject: 'operations',
    sector: 'government',
    title: 'Guard salary October',
    purpose: 'Monthly salary for guards at government sites (mock).',
    amount: 48250,
    payee: 'Guards payroll',
    dueOn: '2026-11-07',
    calc: '25 guards x RM1,700 + OT RM5,750 (mock)',
    evidence: ['ja-payroll-oct.pdf'],
  };
  it('runs return, edit and resubmission', async () => {
    const { svc } = fresh();
    const [cm, ogm, lead, coo, fd] = await who(svc, 'u-cm-09', 'u-ogm', 'u-fin-t1-lead', 'u-coo', 'u-fd');
    const R = svc.financeRequests;
    const r = await R.create(cm, CO, salary);
    await expect(R.step(cm, CO, r.id, 'head', { comment: 'Mine' })).rejects.toThrow();
    await R.step(ogm, CO, r.id, 'head', { comment: 'Headcount agrees.' });
    await R.step(lead, CO, r.id, 'return', { comment: 'The overtime figure does not match JA.' });
    await expect(R.step(lead, CO, r.id, 'resubmit', { ...salary, amount: 1 })).rejects.toThrow();
    const back = await R.step(cm, CO, r.id, 'resubmit', { ...salary, amount: 47900, evidence: ['ja-ot-corrected.pdf'], comment: 'OT corrected' });
    expect(back.status).toBe('head_review');
    expect(back.evidence).toEqual(['ja-payroll-oct.pdf', 'ja-ot-corrected.pdf']);
    expect(back.steps.map((s) => s.step)).toEqual(['head_approved', 'returned', 'resubmitted']);
    expect(back.steps[2].comment).toMatch(/amount RM48250\.00 to RM47900\.00/);
    await R.step(ogm, CO, r.id, 'head', { comment: 'Agrees again.' });
    await R.step(lead, CO, r.id, 'verify', { comment: 'Calculation agrees with JA.' });
    await expect(R.step(fd, CO, r.id, 'approve', { comment: 'ok' })).rejects.toThrow();
    await R.step(coo, CO, r.id, 'approve', { comment: 'Approved for payment.' });
    // After approval: no resubmission and no second approval.
    await expect(R.step(cm, CO, r.id, 'resubmit', { ...salary, amount: 60000 })).rejects.toThrow();
    await expect(R.step(coo, CO, r.id, 'approve', { comment: 'Again' })).rejects.toThrow();
  });
});

describe('Daily cash custody', () => {
  const people = [{ name: 'Ali bin Abu', idLast4: '1234', work: 'Harvest', dailyRate: 100, days: ['2026-10-30', '2026-10-31'], pay: 'cash' }];
  // Cash only when the Director Office lists the person and the COO or CEO gives it (Fauzan, 6 Nov 2026).
  const amountOf = async (svc: PrimaService, doa: Awaited<ReturnType<PrimaService['user']>>, listId: string, personId: string) =>
    (await svc.financeControls.dailyCashMine(doa)).decisions.find((d) => d.id === listId)!.people.find((p) => p.id === personId)!.amount;
  const giveCash = async (svc: Awaited<ReturnType<typeof fresh>>['svc'], listId: string, personId: string) => {
    const [doa, ceo] = await who(svc, 'u-pwvsb-doa', 'u-fauzan');
    await svc.financeControls.dailyCashAction(doa, CO, 'listCash', { listId, personId, reason: 'Will not work unless paid in cash daily (mock)', site: 'Harvest site (mock)', amount: await amountOf(svc, doa, listId, personId) });
    await svc.financeControls.dailyCashAction(ceo, CO, 'decideCash', { listId, personId, give: true, comment: 'Cash given for this list (mock)' });
  };
  // The Director Office uploads each signed receipt before Finance settles (Fauzan, 6 Nov 2026).
  const uploadReceipts = async (svc: Awaited<ReturnType<typeof fresh>>['svc'], listId: string) => {
    const doa = await svc.user('u-pwvsb-doa');
    for (const r of (await svc.financeControls.dailyCashMine(doa)).receipts.filter((x) => x.listId === listId))
      await svc.financeControls.dailyCashAction(doa, CO, 'receipt', { listId, payoutId: r.payoutId, name: 'Signed receipt (mock).png', data: `data:image/png;base64,${Buffer.from(`mock ${listId} ${r.payoutId}`).toString('base64')}` });
  };
  it('8 November: legacy add cannot bypass the manual guard-cash handover', async () => {
    const { svc } = fresh();
    for (const id of ['u-fin-t1-de1','u-fd','u-fauzan','u-coo','u-pwvsb-doa']) await expect(svc.financeControls.dailyCashAction(await svc.user(id), CO, 'add', {})).rejects.toThrow(/Legacy daily cash/);
  });

  it('8 November: legacy approve cannot bypass the manual guard-cash handover', async () => {
    const { svc } = fresh();
    for (const id of ['u-fin-t1-de1','u-fd','u-fauzan','u-coo','u-pwvsb-doa']) await expect(svc.financeControls.dailyCashAction(await svc.user(id), CO, 'approve', {})).rejects.toThrow(/Legacy daily cash/);
  });

  it('8 November: legacy pay cannot bypass the manual guard-cash handover', async () => {
    const { svc } = fresh();
    for (const id of ['u-fin-t1-de1','u-fd','u-fauzan','u-coo','u-pwvsb-doa']) await expect(svc.financeControls.dailyCashAction(await svc.user(id), CO, 'pay', {})).rejects.toThrow(/Legacy daily cash/);
  });
});

describe('Statutory tables: built-in copies and estimates are never treated as verified', () => {
  it('uses only checked tables as verified, and shows the directors what is not', async () => {
    for (const t of builtInStatTables()) {
      expect(t.status).toBe('built_in');
      expect(statTableVerified(t)).toBe(false);
      expect(t.checked).toBeNull();
    }
    // A loaded table that nobody checked is never used, however new.
    const base = builtInStatTables().find((t) => t.id === 'EPF-A')!;
    const loaded = { ...base, version: 'v2', status: 'loaded' as const, from: '2026-01' };
    expect(statTableFor('EPF-A', '2026-10', [loaded]).version).toBe('built-in');
    const checked = { ...loaded, status: 'checked' as const };
    expect(statTableVerified(statTableFor('EPF-A', '2026-10', [checked]))).toBe(true);
    // The director-only list: unresolved, with source, affected records and who answers for it.
    const items = staffPayDirectorChecks({
      period: '2026-10',
      tables: [
        { id: 'EPF-A', version: 'built-in', status: 'built_in' },
        { id: 'EIS', version: 'v2', status: 'checked' },
      ],
      lines: [{ name: 'Staff A (mock)', pcbSource: 'estimate', pcb: 120 }],
    });
    expect(items.map((x) => x.key)).toEqual(['table:EPF-A:built-in', 'pcb:2026-10']);
    for (const x of items) {
      expect(x.status).toBe('Unresolved');
      expect(x.source.length).toBeGreaterThan(5);
      expect(x.responsible).toMatch(/Director|Chief of Staff/);
      expect(JSON.stringify(x)).not.toMatch(/compliant/i);
    }
  });

  it('shows the list on a payroll run to directors only, and never stops HR preparing it', async () => {
    const { svc, ds } = fresh();
    const P = TODAY.slice(0, 7);
    ds.staffPayRuns = ds.staffPayRuns.filter((r) => r.id !== `sp-${GROUP_EMPLOYER_ID}-${P}`);
    for (const p of ds.people.filter((x) => x.companyId === GROUP_EMPLOYER_ID && !x.bank)) p.bank = { bank: 'Maybank', accountMasked: '****0001' };
    const [hr, cos, fd, de1] = await who(svc, 'u-pwvsb-hr', 'u-cos', 'u-fd', 'u-fin-t1-de1');
    const run = await svc.prepareStaffPay(hr, GROUP_EMPLOYER_ID, P);
    expect(run.lines.length).toBeGreaterThan(0);
    expect((await svc.staffPayRun(hr, run.id)).directorChecks).toEqual([]);
    expect((await svc.staffPayRun(de1, run.id)).directorChecks).toEqual([]);
    for (const u of [cos, fd]) {
      const v = await svc.staffPayRun(u, run.id);
      expect(v.directorChecks.length).toBeGreaterThan(0);
      expect(v.directorChecks.every((x) => x.status === 'Unresolved')).toBe(true);
    }
  });
});

describe('Payment requests menu (found in the browser run, 2 Nov 2026)', () => {
  it('is shown to the department heads, Finance checkers and approvers who act on requests, not to other staff', async () => {
    const { svc } = fresh();
    for (const id of ['u-ogm', 'u-opsdir', 'u-fin-t1-lead', 'u-fin-t1-dep', 'u-fd', 'u-coo', 'u-fauzan', 'u-cm-sasa'])
      expect([id, finRequestInMenu(await svc.user(id))]).toEqual([id, true]);
    for (const id of ['u-fin-t1-de1', 'u-pwvsb-hr', 'u-guard-sasa-1']) expect([id, finRequestInMenu(await svc.user(id))]).toEqual([id, false]);
  });
});
