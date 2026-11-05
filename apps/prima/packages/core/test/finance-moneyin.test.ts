import { describe, expect, it } from 'vitest';
import {
  MemoryStore,
  PrimaService,
  finContractMonthly,
  finMoneyInExceptions,
  finStampPenalty,
  finStampRefundLawBy,
  finStampState,
  generateDataset,
  myt,
} from '../src';
type FinStampItem = import('../src').FinStampItem;
type Contract = import('../src').Contract;

// Money in (Fauzan, 2 Nov 2026: yes to suggestions 1, 2 and 5): every contract billed in SQL Account, government
// claims followed up until paid, money in with no invoice allocated within 7 days. Dummy data only, never staging.
const TODAY = '2026-10-31';
const NOW = myt(TODAY, '10:00');
const C = 'co-09'; // Finance team 1
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const base = ds.contracts.find((c) => c.companyId === 'co-sasa')!;
  const v = base.versions[base.versions.length - 1];
  const mk = (id: string, ref: string, client: string, over: Partial<Contract>, ver: Partial<typeof v>): Contract => ({
    ...base,
    id,
    ref,
    clientName: client,
    companyId: C,
    clientAccountId: null,
    startOn: '2025-01-01',
    endOn: '2027-12-31',
    state: 'active',
    ...over,
    versions: [{ ...v, effectiveFrom: '2025-01-01', ...ver }],
  });
  ds.contracts.push(
    mk('ct-mock-fixed', 'CT-FIX-1', 'Mock Mall Sdn Bhd', {}, { billingMethod: 'FIXED', fixedFee: 10000 }),
    mk('ct-mock-m1', 'CT-M1-1', 'Mock Factory Sdn Bhd', {}, { billingMethod: 'M1', fixedFee: null }),
    mk('ct-mock-later', 'CT-NEW-1', 'Mock Starts Later', { startOn: '2026-11-01' }, { billingMethod: 'FIXED', fixedFee: 500 }),
  );
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  const F = () => ds.finStatus.find((x) => x.companyId === C)!;
  return { ds, svc, F };
};
const who = (svc: PrimaService, ...ids: string[]) => Promise.all(ids.map((id) => svc.user(id)));

describe('Billing to invoice (suggestion 1)', () => {
  it('lists every contract that ran in the month and names a missing invoice at the close', async () => {
    const { ds, svc, F } = fresh();
    const [de1, de2, dep] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-dep');
    const fixed = ds.contracts.find((c) => c.id === 'ct-mock-fixed')!;
    expect(finContractMonthly(fixed, '2026-09')).toBe(10000);
    let view = (await svc.financeControls.view(de1, C)).moneyIn;
    expect(view.billing.map((r) => r.contractRef).sort()).toEqual(['CT-FIX-1', 'CT-M1-1']);
    expect(finMoneyInExceptions(F(), ds.contracts, '2026-09', TODAY).filter((e) => e.key.startsWith('bill:'))).toHaveLength(2);
    // An invoice off the contract amount needs a note.
    await expect(
      svc.financeControls.billingAction(de1, C, 'invoice', {
        contractId: 'ct-mock-fixed',
        period: '2026-09',
        invoiceNo: 'IV-0901',
        invoiceDate: '2026-09-30',
        amount: 9000,
      }),
    ).rejects.toThrow(/not the contract/);
    await svc.financeControls.billingAction(de1, C, 'invoice', {
      contractId: 'ct-mock-fixed',
      period: '2026-09',
      invoiceNo: 'IV-0901',
      invoiceDate: '2026-09-30',
      amount: 10000,
    });
    // The same invoice number is not used for two contracts.
    await expect(
      svc.financeControls.billingAction(de1, C, 'invoice', {
        contractId: 'ct-mock-m1',
        period: '2026-09',
        invoiceNo: 'iv-0901',
        invoiceDate: '2026-09-30',
        amount: 4321,
      }),
    ).rejects.toThrow(/already recorded/);
    // Only a senior corrects a recorded invoice.
    await expect(
      svc.financeControls.billingAction(de2, C, 'invoice', {
        contractId: 'ct-mock-fixed',
        period: '2026-09',
        invoiceNo: 'IV-0902',
        invoiceDate: '2026-09-30',
        amount: 10000,
        note: 'Wrong number typed',
      }),
    ).rejects.toThrow();
    // No invoice: a reason, checked by someone else.
    await svc.financeControls.billingAction(de1, C, 'none', {
      contractId: 'ct-mock-m1',
      period: '2026-09',
      reason: 'Site suspended all of September (client letter on file)',
    });
    await expect(svc.financeControls.billingAction(de1, C, 'check', { contractId: 'ct-mock-m1', period: '2026-09', comment: 'ok' })).rejects.toThrow();
    expect(finMoneyInExceptions(F(), ds.contracts, '2026-09', TODAY).map((e) => e.text)).toEqual([expect.stringMatching(/waiting for someone else to check/)]);
    await svc.financeControls.billingAction(dep, C, 'check', { contractId: 'ct-mock-m1', period: '2026-09', comment: 'Suspension letter seen' });
    expect(finMoneyInExceptions(F(), ds.contracts, '2026-09', TODAY)).toEqual([]);
    view = (await svc.financeControls.view(de1, C)).moneyIn;
    expect(view.billing.map((r) => r.status).sort()).toEqual(['invoiced', 'none_checked']);
    // The close names nothing and says it is done.
    const desk = await svc.finance.desk(dep);
    expect(desk.companies.find((x) => x.companyId === C)!.close.check.done.join(' ')).toMatch(/Every contract that ran in 2026-09/);
  });
});

describe('Government claims (suggestion 2)', () => {
  it('tracks a claim from submission to payment found on the bank statement', async () => {
    const { svc, F } = fresh();
    const [de1, de2, dep] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-dep');
    const c = (await svc.financeControls.govtAction(de1, C, 'add', {
      agency: 'Jabatan Kerja Raya Selangor (mock)',
      invoiceNo: 'IV-GOV-77',
      amount: 54321.5,
      claimRef: 'IGFMAS-2026-0091',
      submittedOn: '2026-09-10',
    })) as { id: string; expectedBy: string };
    expect(c.expectedBy).toBe('2026-09-24');
    const home = await svc.financeControls.home(dep);
    expect(home.some((t) => /government claim\(s\) overdue and not followed up/.test(t.title))).toBe(true);
    expect(finMoneyInExceptions(F(), null, '2026-09', TODAY).some((e) => e.key === `govt:${c.id}`)).toBe(true);
    await expect(svc.financeControls.govtAction(de1, C, 'follow', { claimId: c.id, comment: 'ok' })).rejects.toThrow(/Say why|at least/);
    await svc.financeControls.govtAction(de1, C, 'follow', { claimId: c.id, comment: 'Called Puan Aminah at JKR finance: in iGFMAS for payment next week' });
    expect(finMoneyInExceptions(F(), null, '2026-09', TODAY).some((e) => e.key === `govt:${c.id}`)).toBe(false);
    // The payment arrives: loading the statement finds it by the invoice number.
    const bankId = F().banks[0].id;
    const csv = [
      '2026-09-14,IBG CREDIT JKR SELANGOR IV-GOV-77,PAY123,54321.50',
      '2026-09-15,CASH DEP UNKNOWN,,1200.00',
      '2026-09-16,IBG CREDIT KLIENT XYZ,,780.00',
    ].join('\n');
    await svc.financeControls.statementAction(de2, C, 'load', { bankId, period: '2026-09', opening: 1000, closing: 57301.5, csv, source: 'm2u-oct.csv' });
    const claim = F().govtClaims!.find((x) => x.id === c.id)!;
    expect(claim.status).toBe('paid');
    expect(claim.paid).toMatchObject({ how: 'auto', amount: 54321.5, date: '2026-09-14' });
    // Unmatching the line puts the claim back to waiting.
    const st = F().statements!.find((s) => s.bankId === bankId && s.period === '2026-09')!;
    const line = st.lines.find((l) => l.match?.kind === 'govt')!;
    const lead = await svc.user('u-fin-t1-lead');
    await svc.financeControls.statementAction(lead, C, 'unmatch', { statementId: st.id, lineId: line.id, comment: 'Wrong account, testing the unmatch' });
    expect(F().govtClaims!.find((x) => x.id === c.id)!.status).toBe('submitted');
  });
});

describe('Unidentified money in (suggestion 5)', () => {
  it('lists money in with no match, allocates it, and someone else checks', async () => {
    const { svc, F } = fresh();
    const [de1, de2, dep] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-dep');
    const bankId = F().banks[0].id;
    const csv = ['2026-09-15,CASH DEP UNKNOWN,,1200.00', '2026-09-28,IBG CREDIT KLIENT XYZ,,780.00'].join('\n');
    await svc.financeControls.statementAction(de2, C, 'load', { bankId, period: '2026-09', opening: 1000, closing: 2980, csv, source: 'm2u-oct.csv' });
    let mi = (await svc.financeControls.view(de1, C)).moneyIn;
    expect(mi.unidentified.map((u) => [u.amount, u.late])).toEqual([
      [1200, true],
      [780, true],
    ]);
    expect(mi.unidentified[1].allocateBy).toBe('2026-10-05');
    expect(finMoneyInExceptions(F(), null, '2026-09', TODAY).map((e) => e.key)).toEqual([expect.stringMatching(/^unid:/), expect.stringMatching(/^unid:/)]);
    const u = mi.unidentified[0];
    await expect(
      svc.financeControls.moneyInAction(de1, C, 'allocate', { statementId: u.statementId, lineId: u.lineId, to: 'other', ref: 'x1', payer: 'Unknown' }),
    ).rejects.toThrow();
    await svc.financeControls.moneyInAction(de1, C, 'allocate', {
      statementId: u.statementId,
      lineId: u.lineId,
      to: 'invoice',
      ref: 'IV-0815',
      payer: 'Mock Mall Sdn Bhd (cash at branch)',
    });
    // Waiting for a check: named at the close; the allocator cannot check it.
    expect(finMoneyInExceptions(F(), null, '2026-09', TODAY).map((e) => e.key.split(':')[0])).toEqual(['unid', 'alloc']);
    await expect(svc.financeControls.moneyInAction(de1, C, 'check', { statementId: u.statementId, lineId: u.lineId, comment: 'ok' })).rejects.toThrow();
    // A data entry clerk is not a checker.
    await expect(svc.financeControls.moneyInAction(de2, C, 'check', { statementId: u.statementId, lineId: u.lineId, comment: 'ok' })).rejects.toThrow();
    expect((await svc.financeControls.home(dep)).some((t) => /allocation\(s\) to check/.test(t.title))).toBe(true);
    await svc.financeControls.moneyInAction(dep, C, 'check', {
      statementId: u.statementId,
      lineId: u.lineId,
      comment: 'Cash deposit slip names Mock Mall, IV-0815',
    });
    expect(finMoneyInExceptions(F(), null, '2026-09', TODAY).map((e) => e.key.split(':')[0])).toEqual(['unid']);
    mi = (await svc.financeControls.view(de1, C)).moneyIn;
    expect(mi.allocated).toHaveLength(1);
    expect(mi.unidentified).toHaveLength(1);
  });
});

describe('Stamp duty and the refund of a cancelled agreement (suggestion 19)', () => {
  it('stamps within 30 days, checks the certificate, and refunds duty on a cancelled contract', async () => {
    const { svc, F } = fresh();
    const [de1, de2, dep, lead] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-dep', 'u-fin-t1-lead');
    const it0 = (await svc.financeControls.stampAction(de1, C, 'add', {
      kind: 'client_contract',
      contractId: 'ct-mock-fixed',
      signedOn: '2026-09-15',
      value: 120000,
    })) as { id: string; stampBy: string };
    expect(it0.stampBy).toBe('2026-10-15');
    // Past the 30 days: late on home and at the close.
    expect((await svc.financeControls.home(dep)).some((t) => /past the 30-day stamping limit/.test(t.title))).toBe(true);
    await expect(
      svc.financeControls.stampAction(de1, C, 'stamped', { stampId: it0.id, certNo: 'ADJ-2026-0001', on: '2026-10-20', duty: 600, penalty: 0 }),
    ).rejects.toThrow(/law's penalty is RM60\.00/);
    // s.47A(1): within 3 months of the deadline, RM50 or 10% of the duty (RM60 here); the law's figure needs no reason.
    await svc.financeControls.stampAction(de1, C, 'stamped', { stampId: it0.id, certNo: 'ADJ-2026-0001', on: '2026-10-20', duty: 600, penalty: 60 });
    await expect(svc.financeControls.stampAction(de1, C, 'check', { stampId: it0.id, comment: 'mine' })).rejects.toThrow();
    await svc.financeControls.stampAction(dep, C, 'check', { stampId: it0.id, comment: 'Certificate matches STAMPS' });
    // Cancelled: the refund ("unstamp") procedure.
    await svc.financeControls.stampAction(de1, C, 'cancelled', {
      stampId: it0.id,
      cancelledOn: '2026-10-25',
      comment: 'Client withdrew before the start date (mutual termination letter)',
    });
    // s.57: the law allows 12 months from the agreement's date; Prima's target is 30 days from the cancellation.
    expect(F().stampDuty!.find((x) => x.id === it0.id)!.refund).toMatchObject({ claimBy: '2026-11-24', lawBy: '2027-09-15' });
    await expect(svc.financeControls.stampAction(de1, C, 'docs', { stampId: it0.id, docs: ['Stamped agreement', 'Termination letter'] })).rejects.toThrow(
      /at least 3/,
    );
    await svc.financeControls.stampAction(de1, C, 'docs', {
      stampId: it0.id,
      docs: ['Stamped agreement + certificate ADJ-2026-0001', 'Mutual termination letter', 'Receipt for duty paid', 'Statutory declaration'],
    });
    // Neither the opener nor the preparer submits.
    await expect(svc.financeControls.stampAction(de1, C, 'submit', { stampId: it0.id, on: '2026-10-28', ref: 'STAMPS-RF-01' })).rejects.toThrow(
      /someone other/,
    );
    await svc.financeControls.stampAction(de2, C, 'submit', { stampId: it0.id, on: '2026-10-28', ref: 'STAMPS-RF-01' });
    await svc.financeControls.stampAction(lead, C, 'outcome', {
      stampId: it0.id,
      result: 'approved',
      amount: 600,
      on: '2026-10-30',
      comment: 'Refund approved, penalty not refunded',
    });
    const item = F().stampDuty!.find((x) => x.id === it0.id)!;
    expect(item.status).toBe('refunded');
    expect(item.refund!.outcome).toMatchObject({ result: 'approved', amount: 600 });
  });

  it('follows the published Stamp Act limits: s.47A penalty bands and the s.57 twelve months', () => {
    expect(finStampPenalty(600, '2026-10-15', '2026-10-15')).toBe(0);
    expect(finStampPenalty(300, '2026-10-15', '2026-11-01')).toBe(50); // 10% is RM30, the minimum RM50 applies
    expect(finStampPenalty(2000, '2026-10-15', '2027-01-15')).toBe(200); // within 3 months: 10%
    expect(finStampPenalty(2000, '2026-10-15', '2027-01-16')).toBe(400); // after 3 months: 20%
    expect(finStampPenalty(100, '2026-10-15', '2027-03-01')).toBe(100); // after 3 months, minimum RM100
    expect(finStampRefundLawBy('2025-02-28')).toBe('2026-02-28');
    const old = {
      status: 'refund_open',
      signedOn: '2025-09-01',
      refund: { claimBy: '2025-10-30', lawBy: '2026-09-01' },
    } as unknown as FinStampItem;
    expect(finStampState(old, '2026-10-31')).toMatchObject({ late: true, what: expect.stringMatching(/12 months the law allows/) });
  });
});
