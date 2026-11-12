import { describe, expect, it } from 'vitest';
import { GROUP_EMPLOYER_ID, MemoryStore, PrimaService, RULES, finRetentionUpdate, generateDataset, myt } from '../src';

// C4 (Fauzan, 11 Nov 2026): the 14 finance and insurance rules confirmed, every number an FD setting with a reason and a
// start date, F8 retention on tenders with a 2-monthly status update, F9 no daily cash limits, F13 guarantees followed
// until settled with a 30-day reminder. Synthetic data only.
const TODAY = '2026-11-12';
const T1 = GROUP_EMPLOYER_ID;

function setup() {
  const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:00') });
  const store = new MemoryStore(ds);
  let now = myt(TODAY, '10:00');
  const svc = new PrimaService(store, () => now);
  return { ds, store, svc, setDay: (d: string) => (now = myt(d, '10:00')) };
}

describe('C4 finance and insurance rules', () => {
  it('marks F1-F14 confirmed (FIN-CASH13 belongs to the payroll item) with the new values', () => {
    const ids = ['financePayments', 'financeControls', 'financeMoneyIn', 'financeYearEnd', 'financeSupplierStatements', 'financeCredit', 'financeBanking', 'financeContractEnd', 'financeDailyCash', 'financeIntercompany', 'financeCash', 'insurancePremiumDays', 'insuranceClaimNoticeDays'] as const;
    for (const k of ids) {
      expect(RULES[k].label, k).toBe('Policy');
      expect(RULES[k].source, k).toMatch(/Approved by Fauzan, 11 Nov 2026/);
    }
    expect(RULES.financePayments.value.ceoNoticeFrom).toBe(200_000);
    expect(RULES.financePayments.value.approvalExpiryDays).toBe(30);
    expect(RULES.financeIntercompany.value.explainMax).toBe(1000);
    expect(RULES.financeCash.value.pettyFloatMax).toBe(500);
    expect(RULES.financeCash.value.pettyVoucherMax).toBe(50);
    expect(RULES.financeCash.value.advanceSettleDays).toBe(30);
    expect(RULES.financeDailyCash.value).not.toHaveProperty('maxDailyRate');
    expect(RULES.financeDailyCash.value).not.toHaveProperty('maxPeople');
    expect(RULES.financeContractEnd.value.retentionUpdateMonths).toBe(2);
    expect(RULES.insurancePremiumDays.value).toEqual({ dueDays: 14, earlyDays: 30, guaranteeRemindDays: 30 });
    expect(RULES.insuranceClaimNoticeDays.value).toBe(30);
  });

  it('shows every number in Finance settings; the FD changes one with a reason, now or from a later day', async () => {
    const { svc, setDay } = setup();
    const fd = await svc.user('u-fd');
    const v = await svc.finance.settingsView(fd);
    expect(v.values).toMatchObject({ ceoNoticeFrom: 200_000, icExplainMax: 1000, pettyFloatMax: 500, pettyVoucherMax: 50, premiumEarlyDays: 30, premiumDueDays: 14, guaranteeRemindDays: 30, claimNoticeDays: 30, retentionUpdateMonths: 2, caInitialPct: 20, smallValueMax: 2000 });
    for (const g of v.groups) for (const k of g.keys) expect(v.limits, k).toHaveProperty(k);
    await expect(svc.finance.setSettings(fd, { values: { icExplainMax: 1500 } })).rejects.toThrow(/comment/);
    await svc.finance.setSettings(fd, { values: { icExplainMax: 1500 }, comment: 'Synthetic: auditor agreed' });
    expect((await svc.finance.settingsView(fd)).values.icExplainMax).toBe(1500);
    // From a later day: not in force until then.
    await expect(svc.finance.setSettings(fd, { values: { ceoNoticeFrom: 250_000 }, comment: 'Synthetic', from: '2026-11-01' })).rejects.toThrow(/never in the past/);
    await svc.finance.setSettings(fd, { values: { ceoNoticeFrom: 250_000 }, comment: 'Synthetic: board paper', from: '2026-12-01' });
    let view = await svc.finance.settingsView(fd);
    expect(view.values.ceoNoticeFrom).toBe(200_000);
    expect(view.scheduled).toHaveLength(1);
    expect(view.values.icExplainMax).toBe(1500);
    setDay('2026-12-01');
    view = await svc.finance.settingsView(fd);
    expect(view.values.ceoNoticeFrom).toBe(250_000);
    expect(view.values.icExplainMax).toBe(1500);
  });

  it('refuses settings changes from anyone but the FD or the CEO', async () => {
    const { ds, svc } = setup();
    for (const id of ['u-fin-t1-lead', 'u-fin-t1-de1', 'u-coo', ds.users.find((u) => u.role === 'company_manager')!.id]) {
      const u = await svc.user(id);
      await expect(svc.finance.setSettings(u, { values: { icExplainMax: 9 }, comment: 'Synthetic' }), id).rejects.toThrow();
    }
  });

  it('F8: retention on a tender gets a status update every 2 months until it is back', async () => {
    const { ds, svc, setDay } = setup();
    const C = svc.financeControls;
    const [lead, dep] = await Promise.all([svc.user('u-fin-t1-lead'), svc.user('u-fin-t1-dep')]);
    const tender = ds.tenders.find((t) => t.companyId === T1) ?? null;
    const input = { kind: 'retention', client: 'Synthetic Ministry', amount: 25000, heldSince: '2026-10-01', doc: 'Letter of award clause 7 (synthetic)', ...(tender ? { tenderId: tender.id } : {}) };
    await expect(C.depositAction(lead, T1, 'add', { ...input, tenderId: 'tender-nope' })).rejects.toThrow(/Tender/);
    const d = (await C.depositAction(lead, T1, 'add', input)) as { id: string; tenderRef: string | null };
    if (tender) expect(d.tenderRef).toBe(tender.ref);
    await C.depositAction(dep, T1, 'check', { depositId: d.id, comment: 'Agreed to the award letter' });
    let view = await C.view(lead, T1);
    let row = view.contractEnd.deposits.find((x) => x.id === d.id)!;
    expect(row.update).toMatchObject({ due: false, dueOn: '2027-01-12' });
    setDay('2027-01-12');
    view = await C.view(lead, T1);
    row = view.contractEnd.deposits.find((x) => x.id === d.id)!;
    expect(row.update?.due).toBe(true);
    expect((await C.home(lead)).some((h) => /retention status update/.test(h.title))).toBe(true);
    await expect(C.depositAction(lead, T1, 'status', { depositId: d.id, comment: 'no' })).rejects.toThrow();
    await C.depositAction(lead, T1, 'status', { depositId: d.id, comment: 'Agency finance says the release is with the treasury (synthetic)' });
    view = await C.view(lead, T1);
    row = view.contractEnd.deposits.find((x) => x.id === d.id)!;
    expect(row.update).toMatchObject({ due: false, lastOn: '2027-01-12', dueOn: '2027-03-12' });
    // A deposit (not retention) has no status reminder.
    expect(finRetentionUpdate({ ...row, kind: 'deposit' }, '2030-01-01')).toBeNull();
  });

  it('F13: an IG or BG due within 30 days is reminded to Finance until it is settled', async () => {
    const { ds, svc } = setup();
    const C = svc.financeControls;
    const [de1, dep] = await Promise.all([svc.user('u-fin-t1-de1'), svc.user('u-fin-t1-dep')]);
    const bankId = ds.finStatus.find((x) => x.companyId === T1)!.banks[0].id;
    const g = (await C.guaranteeAction(de1, T1, 'add', { kind: 'BG', issuer: 'Synthetic Bank', number: 'BG-SYN-1', beneficiary: 'Synthetic client', purpose: 'Synthetic tender bond', amount: 30000, collateral: 0, bankId, issuedOn: '2026-01-02', expiresOn: '2026-12-01', doc: 'BG letter (synthetic).pdf' })) as { id: string };
    await C.guaranteeAction(dep, T1, 'check', { guaranteeId: g.id, comment: 'Agreed to the bank letter' });
    const items = await C.home(dep);
    expect(items.some((h) => /IG\/BG due within 30 days/.test(h.title))).toBe(true);
  });
});
