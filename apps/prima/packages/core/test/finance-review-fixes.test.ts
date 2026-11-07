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
  it('keeps the approver, the person who withdrew and the collector apart from counting the cash back', async () => {
    const { svc, F } = fresh();
    const [de1, de2, dep, fd, ceo, coo] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-dep', 'u-fd', 'u-fauzan', 'u-coo');
    const l = (await svc.financeControls.dailyCashAction(de1, CO, 'add', {
      period: 'week',
      from: '2026-10-30',
      to: '2026-11-02',
      bankId: F(CO).banks[0].id,
      purpose: 'Harvest workers paid in cash daily (mock)',
      people,
    })) as { id: string; people: { id: string }[] };
    const act = (u: typeof de1, action: string, input: Record<string, unknown> = {}) =>
      svc.financeControls.dailyCashAction(u, CO, action, { listId: l.id, ...input });
    // Returned by the FD: corrected with each person's days, the log keeps the return.
    await giveCash(svc, l.id, l.people[0].id);
    await act(de1, 'submit');
    await act(fd, 'return', { comment: 'Ali did not work on the 31st.' });
    const edited = (await act(de1, 'edit', { people: [{ ...people[0], days: ['2026-10-30'] }] })) as { total: number; log: { text: string }[] };
    expect(edited.total).toBe(100);
    expect(edited.log.map((x) => x.text).join('\n')).toMatch(/Returned by the FD: Ali did not work/);
    await act(de1, 'submit');
    // Only the FD approves, never the CEO or the preparer.
    await expect(act(ceo, 'approve', { comment: 'ok' })).rejects.toThrow();
    await act(fd, 'approve', { comment: 'Approved for one day.' });
    // No edits after approval.
    await expect(act(de1, 'edit', { people })).rejects.toThrow(/not yet sent/);
    // The FD who approved never handles the cash.
    await expect(act(fd, 'withdraw', { on: TODAY, amount: 100, ref: 'CHQ 1' })).rejects.toThrow(/approved the list/);
    await act(de1, 'withdraw', { on: TODAY, amount: 100, ref: 'CHQ 1' });
    await expect(act(fd, 'handover', { toId: coo.id, amount: 100 })).rejects.toThrow(/approved the list/);
    await expect(act(de1, 'handover', { toId: de2.id, amount: 100 })).rejects.toThrow(/only to the COO or the CEO/);
    await act(de1, 'handover', { toId: coo.id, amount: 100 });
    // Finance never pays the workers; the CEO cannot confirm cash handed to the COO.
    await expect(act(de2, 'pay', { personId: l.people[0].id, day: '2026-10-30', idLast4: '1234', proof: 'sheet 1' })).rejects.toThrow();
    await expect(act(ceo, 'received', { handoverId: 'h1', counted: 100 })).rejects.toThrow();
    // A count that differs needs a reason.
    await expect(act(coo, 'received', { handoverId: 'h1', counted: 90 })).rejects.toThrow(/Say why/);
    await act(coo, 'received', { handoverId: 'h1', counted: 100 });
    await act(coo, 'pay', { personId: l.people[0].id, day: '2026-10-30', idLast4: '1234', proof: 'Pay sheet 1 (mock)' });
    await act(coo, 'giveBack', { amount: 0 });
    // The collector, the person who withdrew and handed over, and the approving FD do not count it back.
    await uploadReceipts(svc, l.id);
    for (const u of [coo, de1, fd]) await expect(act(u, 'settle', { counted: 0 })).rejects.toThrow();
    expect(((await act(dep, 'settle', { counted: 0 })) as { status: string }).status).toBe('settled');
  });

  it('Round 3: the FD who changed a list does not approve it, and only the person holding the cash pays from it', async () => {
    const { svc, F } = fresh();
    const [de1, de2, fd, ceo, coo] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2', 'u-fd', 'u-fauzan', 'u-coo');
    const l = (await svc.financeControls.dailyCashAction(de1, CO, 'add', {
      period: 'week',
      from: '2026-10-30',
      to: '2026-11-02',
      bankId: F(CO).banks[0].id,
      purpose: 'Harvest workers paid in cash daily (mock)',
      people,
    })) as { id: string; people: { id: string }[] };
    const act = (u: typeof de1, action: string, input: Record<string, unknown> = {}) =>
      svc.financeControls.dailyCashAction(u, CO, action, { listId: l.id, ...input });
    // Defect 1: the FD changes another preparer's draft, staff send it, and the FD may not approve it.
    const changed = (await act(fd, 'edit', { people: [{ ...people[0], dailyRate: 150 }] })) as { total: number; edits: { byId: string }[] };
    expect(changed.total).toBe(300);
    expect(changed.edits.map((e) => e.byId)).toEqual([fd.id]);
    await act(de2, 'submit');
    await expect(act(fd, 'approve', { comment: 'ok' })).rejects.toThrow(/changed/);
    // Returning it stays open, and the CEO is still not an approver.
    await expect(act(ceo, 'approve', { comment: 'ok' })).rejects.toThrow();
    await act(fd, 'return', { comment: 'I changed the rate, so someone else must approve it.' });

    // Defect 2: cash handed to and counted by the COO only; the CEO, who received nothing, cannot pay or give back.
    const l2 = (await svc.financeControls.dailyCashAction(de1, CO, 'add', {
      period: 'week',
      from: '2026-10-30',
      to: '2026-10-31',
      bankId: F(CO).banks[0].id,
      purpose: 'Harvest workers paid in cash daily (mock)',
      people: [{ ...people[0], name: 'Abu bin Ali', idLast4: '5678', days: ['2026-10-31'] }],
    })) as { id: string; people: { id: string }[] };
    const act2 = (u: typeof de1, action: string, input: Record<string, unknown> = {}) =>
      svc.financeControls.dailyCashAction(u, CO, action, { listId: l2.id, ...input });
    await giveCash(svc, l2.id, l2.people[0].id);
    await act2(de1, 'submit');
    await act2(fd, 'approve', { comment: 'Approved, unchanged by me.' });
    await act2(de1, 'withdraw', { on: TODAY, amount: 100, ref: 'CHQ 2' });
    await act2(de1, 'handover', { toId: coo.id, amount: 100 });
    await act2(coo, 'received', { handoverId: 'h1', counted: 100 });
    const pay2 = { personId: l2.people[0].id, day: '2026-10-31', idLast4: '5678', proof: 'Pay sheet 2 (mock)' };
    await expect(act2(ceo, 'pay', pay2)).rejects.toThrow(/hold none/);
    await expect(act2(ceo, 'giveBack', { amount: 100 })).rejects.toThrow();
    await act2(coo, 'pay', pay2);
    await act2(coo, 'giveBack', { amount: 0 });
  });

  it('Round 4: cash split between the COO and the CEO is given back by each holder for their own share, then settled once', async () => {
    const { svc, F } = fresh();
    const [de1, dep, fd, ceo, coo] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fd', 'u-fauzan', 'u-coo');
    const l = (await svc.financeControls.dailyCashAction(de1, CO, 'add', {
      period: 'week',
      from: '2026-10-30',
      to: '2026-10-31',
      bankId: F(CO).banks[0].id,
      purpose: 'Harvest workers paid in cash daily (mock)',
      people: [{ name: 'Siti binti Abu', idLast4: '4321', work: 'Harvest', dailyRate: 50, days: ['2026-10-30', '2026-10-31'], pay: 'cash' }],
    })) as { id: string; people: { id: string }[] };
    const act = (u: typeof de1, action: string, input: Record<string, unknown> = {}) =>
      svc.financeControls.dailyCashAction(u, CO, action, { listId: l.id, ...input });
    await giveCash(svc, l.id, l.people[0].id);
    await act(de1, 'submit');
    await act(fd, 'approve', { comment: 'Approved for two days.' });
    await act(de1, 'withdraw', { on: TODAY, amount: 100, ref: 'CHQ 3' });
    await act(de1, 'handover', { toId: coo.id, amount: 50 });
    await act(de1, 'handover', { toId: ceo.id, amount: 50 });
    await act(coo, 'received', { handoverId: 'h1', counted: 50 });
    await act(ceo, 'received', { handoverId: 'h2', counted: 50 });
    // The COO pays one day from his own RM50 and gives back nothing; the list waits for the CEO.
    await act(coo, 'pay', { personId: l.people[0].id, day: '2026-10-30', idLast4: '4321', proof: 'Pay sheet 3 (mock)' });
    const half = (await act(coo, 'giveBack', { amount: 0 })) as { status: string; giveBack: unknown; giveBacks: { byId: string; amount: number }[] };
    expect(half.status).toBe('with_collector');
    expect(half.giveBack).toBeNull();
    expect(half.giveBacks).toMatchObject([{ byId: coo.id, amount: 0 }]);
    // The COO holds nothing more: no second give back, no paying from the CEO's cash; nobody settles yet.
    await expect(act(coo, 'giveBack', { amount: 0 })).rejects.toThrow(/already given back/);
    await expect(act(coo, 'pay', { personId: l.people[0].id, day: '2026-10-31', idLast4: '4321', proof: 'Pay sheet 4 (mock)' })).rejects.toThrow(/hold none/);
    await expect(act(dep, 'settle', { counted: 0 })).rejects.toThrow(/not waiting to be settled/);
    // Giving back a different amount from what the CEO holds needs a reason.
    await expect(act(ceo, 'giveBack', { amount: 100 })).rejects.toThrow(/Say why|reason/i);
    const all = (await act(ceo, 'giveBack', { amount: 50 })) as { status: string; giveBack: { amount: number } };
    expect(all.status).toBe('returned');
    expect(all.giveBack.amount).toBe(50);
    // Neither holder, nor whoever withdrew and handed it over, counts it back; another Finance person settles once.
    await uploadReceipts(svc, l.id);
    for (const u of [coo, ceo, de1, fd]) await expect(act(u, 'settle', { counted: 50, depositRef: 'DEP 3' })).rejects.toThrow();
    const done = (await act(dep, 'settle', { counted: 50, depositRef: 'DEP 3' })) as { status: string; settled: { difference: number } };
    expect(done).toMatchObject({ status: 'settled', settled: { difference: 0 } });
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
