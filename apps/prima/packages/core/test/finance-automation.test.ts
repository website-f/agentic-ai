import { describe, expect, it } from 'vitest';
import { AccessDenied, GROUP_EMPLOYER_ID, MemoryStore, PrimaService, finSstOnReceipt, generateDataset, myt } from '../src';
type FinStatusT = import('../src').FinStatus;

// Finance automation by system rules (Fauzan, 1 Nov 2026: "1. Ok 2. Ok 3. Ok 4. ... 8/108 x payment receive 5. Yes").
// Prima prepares, matches, checks and reminds; it never approves. Dummy data only, never staging.
const TODAY = '2026-10-31';
const NOW = myt(TODAY, '10:00');
const T1 = GROUP_EMPLOYER_ID;
const fresh = (now = NOW) => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => now);
  return { ds, svc, F: () => ds.finStatus.find((x) => x.companyId === T1)!, CO: () => ds.finStatus.find((x) => x.team === 1 && x.companyId !== T1)! };
};
const who = (svc: PrimaService, ...ids: string[]) => Promise.all(ids.map((id) => svc.user(id)));
const approvedOn = (f: FinStatusT, id: string, day: string) => {
  f.payments!.find((x) => x.id === id)!.steps.find((x) => x.step === 'approved')!.at = myt(day, '09:00');
};

describe('1. Prima fills the monthly packs from what it holds; people still review', () => {
  it('fills the statement and payment items, saves them only when someone acts, and the preparer rule still holds', async () => {
    const { svc, F } = fresh();
    const [de, de2, dep, fd] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-dep', 'u-fd');
    // Only this test's payment is released in September.
    F().payments = (F().payments ?? []).filter((p) => !(p.status === 'released' && p.releasedOn?.startsWith('2026-09')));
    const bankId = F().banks[0].id;
    const p = await svc.finance.createPayment(de, T1, { payeeId: 'payee-pwvsb-001', purpose: 'Sept supplies', amount: 1234.56, dueOn: '2026-09-20', bankId, sqlRef: 'PI-AUTO-1', evidence: ['i.pdf'] });
    await svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'ok' });
    await svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: 'Supplies for September.' });
    approvedOn(F(), p.id, '2026-09-18');
    await svc.finance.paymentStep(de2, T1, p.id, 'release', { bankRef: 'M2U778899', releasedOn: '2026-09-18', accountLast4: '1000', accountName: 'SYARIKAT BEKALAN PEJABAT' });
    const csv = ['Date,Description,Ref,Amount', '2026-09-18,IBG SYARIKAT BEKALAN,M2U778899,-1234.56'].join('\n');
    await svc.financeControls.statementAction(de, T1, 'load', { bankId, period: '2026-09', opening: 10000, closing: 8765.44, csv, source: 'm2u-sep.csv' });
    const c = (await svc.finance.desk(dep)).companies.find((x) => x.companyId === T1)!;
    const stmt = c.bank.find((i) => i.id === `bank-2026-09-stmt-${bankId}`)!;
    expect(stmt).toMatchObject({ status: 'prepared', by: 'Prima (automatic)', preparedById: 'prima:auto' });
    expect(stmt.auto!.join(' ')).toMatch(/m2u-sep.csv/);
    const support = c.payment.find((i) => i.id === 'pay-2026-09-support')!;
    expect(support.status).toBe('prepared');
    expect(support.auto!.join(' ')).toMatch(new RegExp(`${p.id}.*approved by .*Supplies for September.*1 document`));
    expect(c.payment.find((i) => i.id === 'pay-2026-09-release')!.auto).toEqual([`${p.id}: bank reference M2U778899, released 2026-09-18`]);
    // Not filled without the data: the SQL Account voucher listing and statutory receipts stay with staff.
    expect(c.payment.find((i) => i.id === 'pay-2026-09-pv')!.status).toBe('todo');
    // Nothing is saved until someone acts; a review still needs a comment and a reviewer.
    expect(F().bank ?? []).not.toContainEqual(expect.objectContaining({ id: stmt.id }));
    await expect(svc.setFinPack(de, T1, 'bank', stmt.id, 'reviewed', 'ok')).rejects.toThrow(/review/);
    await expect(svc.setFinPack(dep, T1, 'bank', stmt.id, 'reviewed', ' ')).rejects.toThrow(/comment/);
    const done = await svc.setFinPack(dep, T1, 'bank', stmt.id, 'reviewed', 'Statement agrees to the portal.');
    expect(done).toMatchObject({ status: 'reviewed', preparedById: 'prima:auto', reviewedById: 'u-fin-t1-dep' });
    // Acting on one item does not freeze the other filled items.
    expect((F().payment ?? []).some((i) => i.preparedById === 'prima:auto')).toBe(false);
  });
});

describe('2. a lapsed approval goes back to the preparer by itself', () => {
  it('returns it with a system step, never approves or releases, and the preparer resubmits', async () => {
    const { svc, ds, F } = fresh();
    const [de, dep, fd] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fd');
    const p = await svc.finance.createPayment(de, T1, { payeeId: 'payee-pwvsb-001', purpose: 'Lapse test', amount: 77, dueOn: '2026-11-20', bankId: F().banks[0].id, sqlRef: 'PI-LAPSE-1', evidence: ['i.pdf'] });
    await svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'ok' });
    await svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: 'ok' });
    const later = new PrimaService(new MemoryStore(ds), () => myt('2026-11-30', '09:00'));
    const [deL, fdL] = await who(later, 'u-fin-t1-de1', 'u-fd');
    // The day it lapses, it is returned; the FD cannot approve it again before it is resubmitted and reviewed.
    const row = (await later.finance.desk(fdL)).companies.find((c) => c.companyId === T1)!.payments.find((x) => x.id === p.id)!;
    expect([row.status, row.may.includes('approve'), row.may.includes('release')]).toEqual(['returned', false, false]);
    const re = await later.finance.paymentStep(deL, T1, p.id, 'resubmit', { comment: 'Still due.' });
    expect(re.steps.map((s) => [s.step, s.byId])).toEqual([
      ['prepared', 'u-fin-t1-de1'],
      ['reviewed', 'u-fin-t1-dep'],
      ['approved', 'u-fd'],
      ['returned', 'prima:auto'],
      ['resubmitted', 'u-fin-t1-de1'],
    ]);
    expect(re.status).toBe('prepared');
  });
});

describe('3. slow steps are shown to the Finance Director and the CEO', () => {
  it('lists payments waiting for review or approval longer than the FD set', async () => {
    const { svc, ds, F } = fresh();
    const [de, dep, fd] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fd');
    await svc.finance.setSettings(fd, { values: { escalateAfterDays: 2 }, comment: 'Two days is enough.' });
    for (const f of ds.finStatus) for (const p of f.payments ?? []) if (p.status === 'prepared' || p.status === 'reviewed') p.status = 'cancelled';
    const a = await svc.finance.createPayment(de, T1, { payeeId: 'payee-pwvsb-001', purpose: 'Slow review', amount: 10, dueOn: '2026-11-20', bankId: F().banks[0].id, sqlRef: 'PI-SLOW-1', evidence: ['i.pdf'] });
    const b = await svc.finance.createPayment(de, T1, { payeeId: 'payee-pwvsb-001', purpose: 'Slow approval', amount: 20, dueOn: '2026-11-20', bankId: F().banks[0].id, sqlRef: 'PI-SLOW-2', evidence: ['i.pdf'] });
    await svc.finance.paymentStep(dep, T1, b.id, 'review', { comment: 'ok' });
    const titles = async (svc2: PrimaService, id: string) => (await svc2.finance.home(await svc2.user(id))).map((t) => `${t.title} | ${t.detail}`);
    expect((await titles(svc, 'u-fd')).some((t) => /waiting 2\+ days/.test(t) && (t.includes(a.id) || t.includes(b.id)))).toBe(false);
    const later = new PrimaService(new MemoryStore(ds), () => myt('2026-11-02', '09:00'));
    for (const id of ['u-fd', 'u-fauzan']) {
      const t = await titles(later, id);
      expect(t.find((x) => /waiting 2\+ days for review/.test(x))).toMatch(new RegExp(a.id));
      expect(t.find((x) => /waiting 2\+ days for approval/.test(x))).toMatch(new RegExp(b.id));
    }
    // Staff are not escalated to.
    expect((await titles(later, 'u-fin-t1-de1')).some((t) => /waiting 2\+ days/.test(t))).toBe(false);
    await expect(svc.finance.setSettings(fd, { values: { escalateAfterDays: 0 }, comment: 'x' })).rejects.toThrow(/1 to 30/);
  });
});

describe('4. SST is 8/108 of the money received and must agree with the invoices (8% of the bill)', () => {
  it('works the tax out from receipts, checks the invoices and the declaration, and keeps the old path for older returns', async () => {
    expect(finSstOnReceipt(108_000, 0.08)).toBe(8_000);
    expect(finSstOnReceipt(10_800, 0.08)).toBe(800);
    const { svc, CO } = fresh();
    const co = CO().companyId;
    const [de] = await who(svc, 'u-fin-t1-de1');
    const base = { month: '2026-08', source: 'SQL receipts Jul-Aug.pdf', received: 1_080_000 };
    await expect(svc.financeControls.sstAction(de, co, 'prepare', { ...base, invoiceSst: 80_000, declared: 86_400 })).rejects.toThrow(/not 8\/108 of the RM1080000.00 received \(RM80000.00\)/);
    await expect(svc.financeControls.sstAction(de, co, 'prepare', { ...base, invoiceSst: 79_000, declared: 80_000 })).rejects.toThrow(/invoices paid \(RM79000.00\) does not agree/);
    const ret = (await svc.financeControls.sstAction(de, co, 'prepare', { ...base, invoiceSst: 80_000.4, declared: 80_000 })) as { taxableValue: number; received: number; invoiceSst: number };
    expect([ret.taxableValue, ret.received, ret.invoiceSst]).toEqual([1_000_000, 1_080_000, 80_000.4]);
    // A part payment explained is accepted.
    const ok = (await svc.financeControls.sstAction(de, co, 'prepare', { ...base, invoiceSst: 79_000, declared: 80_000, differenceNote: 'Client paid INV-55 short by RM13,500' })) as { declared: number };
    expect(ok.declared).toBe(80_000);
    const v = await svc.financeControls.view(de, co);
    expect(v.sst!.returns.find((r) => r.from === '2026-07')).toMatchObject({ expected: 80_000, basis: 'receipts' });
    // Review finding: a new return always carries both sides; the old value x rate input is refused.
    await expect(svc.financeControls.sstAction(de, co, 'prepare', { month: '2026-08', source: 'x.pdf', received: 1_080_000, declared: 80_000 })).rejects.toThrow(/SST shown on the invoices/);
    await expect(svc.financeControls.sstAction(de, co, 'prepare', { month: '2026-08', source: 'x.pdf', taxableValue: 1_000_000, declared: 80_000 })).rejects.toThrow(/money received/);
    // An older stored return (value x rate, no receipts) still reads, marked as the old basis.
    const f = CO();
    f.sst!.returns = f.sst!.returns.map((r) => (r.from === '2026-07' ? { ...r, received: undefined, invoiceSst: undefined, taxableValue: 1_000_000 } : r));
    expect((await svc.financeControls.view(de, co)).sst!.returns.find((r) => r.from === '2026-07')).toMatchObject({ expected: 80_000, basis: 'legacy' });
  });
});

describe('5. every variance has an owner and a due day; the FD or the CEO accepts the explanation', () => {
  const months = (n: number) => Array(12).fill(n);
  it('owner is the team leader, due on the FD day, late ones go to the FD; nobody accepts their own', async () => {
    const { svc } = fresh();
    const [de, dep, lead, fd, ceo] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fin-t1-lead', 'u-fd', 'u-fauzan');
    await svc.financeControls.planAction(dep, T1, 'draft', { year: 2026, months: { revenue: months(100_000) }, assumptions: '120 guards at RM2,900; no new contracts' });
    await svc.financeControls.planAction(dep, T1, 'submit', { year: 2026, seq: 1 });
    await svc.financeControls.planAction(fd, T1, 'approve', { year: 2026, seq: 2, comment: 'Approved.' });
    await svc.financeControls.planAction(de, T1, 'actuals', { year: 2026, month: '2026-09', values: { revenue: 80_000 }, source: 'SQL P&L Sep.pdf' });
    const plan = (await svc.financeControls.view(fd, T1)).plan;
    expect(plan.toExplain[0]).toMatchObject({ key: '2026-09:revenue', owner: 'Team 1 leader', dueOn: '2026-10-15', overdue: true });
    const home = async (id: string) => (await svc.financeControls.home(await svc.user(id))).map((t) => t.title);
    expect((await home('u-fin-t1-lead')).some((t) => /1 budget variance\(s\) to explain, 1 past the due day/.test(t))).toBe(true);
    expect((await home('u-fd')).some((t) => /1 budget variance\(s\) not explained by the due day/.test(t))).toBe(true);
    await svc.financeControls.planAction(lead, T1, 'explain', { year: 2026, key: '2026-09:revenue', text: 'Kepong client terminated mid-September' });
    expect((await svc.financeControls.view(fd, T1)).plan.toAccept).toHaveLength(1);
    expect((await home('u-fd')).some((t) => /1 variance explanation\(s\) to accept/.test(t))).toBe(true);
    await expect(svc.financeControls.planAction(lead, T1, 'acceptVariance', { year: 2026, key: '2026-09:revenue', comment: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.financeControls.planAction(fd, T1, 'acceptVariance', { year: 2026, key: '2026-09:revenue', comment: ' ' })).rejects.toThrow(/comment/);
    await svc.financeControls.planAction(ceo, T1, 'acceptVariance', { year: 2026, key: '2026-09:revenue', comment: 'Agreed; forecast updated.' });
    expect((await svc.financeControls.view(fd, T1)).plan.toAccept).toHaveLength(0);
    // The FD explains one himself: he cannot accept his own explanation; the CEO can.
    await svc.financeControls.planAction(fd, T1, 'explain', { year: 2026, key: '2026-09:revenue', text: 'Re-explained after the client meeting' });
    await expect(svc.financeControls.planAction(fd, T1, 'acceptVariance', { year: 2026, key: '2026-09:revenue', comment: 'ok' })).rejects.toThrow(/own explanation/);
    void dep;
  });
});

describe("review findings on e53c5f6 (Arisha main, 1 Nov 2026)", () => {
  const months = (n: number) => Array(12).fill(n);
  it('an accepted variance explanation stands only for the figures it was written for', async () => {
    const { svc } = fresh();
    const [de, dep, lead, fd, ceo] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fin-t1-lead', 'u-fd', 'u-fauzan');
    await svc.financeControls.planAction(dep, T1, 'draft', { year: 2026, months: { revenue: months(100_000) }, assumptions: '120 guards at RM2,900; no new contracts' });
    await svc.financeControls.planAction(dep, T1, 'submit', { year: 2026, seq: 1 });
    await svc.financeControls.planAction(fd, T1, 'approve', { year: 2026, seq: 2, comment: 'Approved.' });
    await svc.financeControls.planAction(de, T1, 'actuals', { year: 2026, month: '2026-09', values: { revenue: 80_000 }, source: 'SQL P&L Sep.pdf' });
    await svc.financeControls.planAction(lead, T1, 'explain', { year: 2026, key: '2026-09:revenue', text: 'Kepong client terminated mid-September' });
    await expect(svc.financeControls.planAction(lead, T1, 'explain', { year: 2026, key: '2026-13:revenue', text: 'Not a real month here' })).rejects.toThrow(/Which variance/);
    // The actual changes before acceptance: the explanation no longer counts and cannot be accepted.
    await svc.financeControls.planAction(de, T1, 'actuals', { year: 2026, month: '2026-09', values: { revenue: 70_000 }, source: 'SQL P&L Sep v2.pdf' });
    let plan = (await svc.financeControls.view(fd, T1)).plan;
    expect(plan.toExplain.map((x) => [x.key, x.changed])).toEqual([['2026-09:revenue', true]]);
    expect(plan.toAccept).toHaveLength(0);
    await expect(svc.financeControls.planAction(ceo, T1, 'acceptVariance', { year: 2026, key: '2026-09:revenue', comment: 'ok' })).rejects.toThrow(/figures changed/);
    await svc.financeControls.planAction(lead, T1, 'explain', { year: 2026, key: '2026-09:revenue', text: 'Kepong lost and a short-paid invoice' });
    await svc.financeControls.planAction(ceo, T1, 'acceptVariance', { year: 2026, key: '2026-09:revenue', comment: 'Agreed.' });
    expect((await svc.financeControls.view(fd, T1)).plan.toAccept).toHaveLength(0);
    // Changed again after acceptance: it needs a new explanation and a new acceptance.
    await svc.financeControls.planAction(de, T1, 'actuals', { year: 2026, month: '2026-09', values: { revenue: 75_000 }, source: 'SQL P&L Sep v3.pdf' });
    plan = (await svc.financeControls.view(fd, T1)).plan;
    expect(plan.toExplain.map((x) => x.key)).toEqual(['2026-09:revenue']);
  });

  it('someone whose work a filled pack lists may review it, another person verifies, and a change after review sends it back', async () => {
    const { svc, F } = fresh();
    const [de, de2, dep, lead, fd] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-dep', 'u-fin-t1-lead', 'u-fd');
    F().payments = (F().payments ?? []).filter((p) => !(p.status === 'released' && p.releasedOn?.startsWith('2026-09')));
    const bankId = F().banks[0].id;
    const p = await svc.finance.createPayment(de, T1, { payeeId: 'payee-pwvsb-001', purpose: 'Sept supplies', amount: 50, dueOn: '2026-09-20', bankId, sqlRef: 'PI-AUTO-9', evidence: ['i.pdf'] });
    await svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'ok' });
    await svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: 'ok' });
    approvedOn(F(), p.id, '2026-09-18');
    await svc.finance.paymentStep(de2, T1, p.id, 'release', { bankRef: 'M2U-9', releasedOn: '2026-09-18', accountLast4: '1000', accountName: 'SYARIKAT BEKALAN PEJABAT' });
    const item = (await svc.finance.desk(lead)).companies.find((c) => c.companyId === T1)!.payment.find((i) => i.id === 'pay-2026-09-release')!;
    expect(new Set(item.autoBy)).toEqual(new Set(['u-fin-t1-de1', 'u-fin-t1-dep', 'u-fd', 'u-fin-t1-de2']));
    // Fauzan, 1 Nov 2026: someone whose work it lists may review it, but another person must also verify. The deputy's
    // review is kept and the item stays prepared; a second listed person cannot be that other person.
    const first = await svc.setFinPack(dep, T1, 'payment', item.id, 'reviewed', 'References agree.');
    expect([first.status, first.contributorReview?.byId]).toEqual(['prepared', 'u-fin-t1-dep']);
    await expect(svc.setFinPack(fd, T1, 'payment', item.id, 'reviewed', 'ok')).rejects.toThrow(/does not list verifies/);
    const done = await svc.setFinPack(lead, T1, 'payment', item.id, 'reviewed', 'Release references agree.');
    expect(done.autoKey).toBe(item.autoKey);
    // The data changes after review: the item goes back to prepared, marked changed, and needs a new review.
    F().payments!.find((x) => x.id === p.id)!.bankRef = 'M2U-9-CORRECTED';
    const again = (await svc.finance.desk(lead)).companies.find((c) => c.companyId === T1)!.payment.find((i) => i.id === item.id)!;
    expect([again.status, again.autoChanged]).toEqual(['prepared', true]);
    expect(again.auto).toEqual([`${p.id}: bank reference M2U-9-CORRECTED, released 2026-09-18`]);
    const re = await svc.setFinPack(lead, T1, 'payment', item.id, 'reviewed', 'Corrected reference agrees.');
    expect([re.status, re.autoChanged]).toEqual(['reviewed', false]);
  });
});

describe('6 and 7. cash needed for approved payments and the budget warning (1 Nov 2026)', () => {
  const sign = { by: 'Test', byId: 'u-fd', at: myt('2026-09-01', '09:00') };
  it('shows each bank balance against approved payments due in 7 and 30 days, and warns the FD when short', async () => {
    const { svc, F } = fresh();
    const [de, dep, fd] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fd');
    const bankId = F().banks[0].id;
    for (const p of F().payments ?? []) if (p.bankId === bankId && ['approved', 'released'].includes(p.status)) p.status = 'cancelled';
    F().statements = [
      { id: 'st-old', bankId, period: '2026-08', opening: 0, closing: 99999, lines: [], loaded: { ...sign, source: 'aug.csv' } },
      { id: 'st-sep', bankId, period: '2026-09', opening: 0, closing: 1000, lines: [], loaded: { ...sign, source: 'sep.csv' } },
    ];
    const pay = async (amount: number, dueOn: string, ref: string) => {
      const p = await svc.finance.createPayment(de, T1, { payeeId: 'payee-pwvsb-001', purpose: ref, amount, dueOn, bankId, sqlRef: ref, evidence: ['i.pdf'] });
      await svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'ok' });
      return svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: 'ok' });
    };
    await pay(600, '2026-11-03', 'PI-CASH-1');
    await pay(500, '2026-11-20', 'PI-CASH-2');
    // A payment released after the statement's month end comes off the balance.
    F().payments!.push({ ...F().payments!.find((p) => p.sqlRef === 'PI-CASH-1')!, id: 'pay-out-oct', sqlRef: 'PI-OCT', status: 'released', amount: 300, releasedOn: '2026-10-05' });
    const cash = (await svc.finance.desk(fd)).companies.find((c) => c.companyId === T1)!.cash.find((x) => x.bankId === bankId)!;
    expect(cash).toMatchObject({ balance: 700, balanceAsOf: '2026-09-30', due7: 600, due30: 1100, short7: 0, short30: 400 });
    await pay(250, '2026-10-20', 'PI-CASH-3'); // overdue counts as due now
    const again = (await svc.finance.desk(fd)).companies.find((c) => c.companyId === T1)!.cash.find((x) => x.bankId === bankId)!;
    expect([again.due7, again.short7]).toEqual([850, 150]);
    const titles = (await svc.finance.home(fd)).map((t) => `${t.title} | ${t.detail}`);
    expect(titles.some((t) => /short of cash for payments due in 7 days \|.*short RM150\.00/.test(t))).toBe(true);
    // A bank with no statement loaded has no balance and no warning, never a guessed figure.
    F().statements = [];
    const none = (await svc.finance.desk(fd)).companies.find((c) => c.companyId === T1)!.cash.find((x) => x.bankId === bankId)!;
    expect([none.balance, none.short7]).toEqual([null, null]);
  });

  it('warns the reviewer and approver when a payment takes a budget line over, and never blocks or approves', async () => {
    const { svc, F } = fresh();
    const [de, dep, fd] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fd');
    const bankId = F().banks[0].id;
    const months = Array(12).fill(1000);
    F().plans = [
      {
        year: 2026,
        budget: { months: { premises: months }, assumptions: 'test', status: 'approved', prepared: sign, approved: sign, returned: null },
        actuals: { premises: [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, null, null] },
        forecasts: [],
        variances: [],
      } as never,
    ];
    await expect(svc.finance.createPayment(de, T1, { payeeId: 'payee-pwvsb-001', purpose: 'Office rent', amount: 1, dueOn: '2026-11-20', bankId, sqlRef: 'PI-B0', evidence: ['i.pdf'], budgetLine: 'revenue' })).rejects.toThrow(/Budget line/);
    await expect(svc.finance.createPayment(de, T1, { payeeId: 'payee-pwvsb-001', purpose: 'Office rent', amount: 1, dueOn: '2026-11-20', bankId, sqlRef: 'PI-B0', evidence: ['i.pdf'], budgetLine: 'nonsense' })).rejects.toThrow(/Budget line/);
    const a = await svc.finance.createPayment(de, T1, { payeeId: 'payee-pwvsb-001', purpose: 'Rent Nov', amount: 1500, dueOn: '2026-11-20', bankId, sqlRef: 'PI-B1', evidence: ['i.pdf'], budgetLine: 'premises' });
    const row = async (id: string) => (await svc.finance.desk(fd)).companies.find((c) => c.companyId === T1)!.payments.find((x) => x.id === id)!;
    expect((await row(a.id)).budget).toEqual({ line: 'premises', year: 2026, budget: 12000, committed: 11500, over: 0 });
    const b = await svc.finance.createPayment(de, T1, { payeeId: 'payee-pwvsb-001', purpose: 'Rent Dec', amount: 1200, dueOn: '2026-12-20', bankId, sqlRef: 'PI-B2', evidence: ['i.pdf'], budgetLine: 'premises' });
    expect((await row(b.id)).budget!.over).toBe(700);
    // A warning only: the payment still goes through the normal review and approval, with comments.
    await svc.finance.paymentStep(dep, T1, b.id, 'review', { comment: 'Over budget: two months of rent arrears, agreed.' });
    expect((await svc.finance.paymentStep(fd, T1, b.id, 'approve', { comment: 'Accepted over budget.' })).status).toBe('approved');
    // A cancelled payment no longer counts; no line means no check.
    await svc.finance.paymentStep(de, T1, a.id, 'cancel', { comment: 'Paid by landlord offset.' });
    expect((await row(b.id)).budget!.over).toBe(0);
    const c = await svc.finance.createPayment(de, T1, { payeeId: 'payee-pwvsb-001', purpose: 'Misc', amount: 50, dueOn: '2026-11-21', bankId, sqlRef: 'PI-B3', evidence: ['i.pdf'] });
    expect((await row(c.id)).budget).toBeNull();
  });
});
