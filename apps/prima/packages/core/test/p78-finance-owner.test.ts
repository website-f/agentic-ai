import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, generateDataset, myt } from '../src';

// P78 (Agentic Office): the owner, signed in as Prima's CEO record, is the master administrator. On the Finance screens
// he enters what Finance enters by hand (payment requests, bank accounts, papers for the auditor and the tax agent,
// a new company's books, PWVSB financing and its records); approvals keep their own people and nobody approves what
// they entered. Synthetic data only.
const TODAY = '2026-11-02';
const NOW = myt(TODAY, '10:00');
const CO = 'co-09';

function fresh(edit?: (ds: ReturnType<typeof generateDataset>) => void) {
  const ds = generateDataset({ today: TODAY, now: NOW });
  edit?.(ds);
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  return { ds, svc };
}

const request = {
  subject: 'finance',
  title: 'Audit fee, first instalment',
  purpose: 'First instalment of the statutory audit fee (synthetic).',
  amount: 8500,
  payee: 'Synthetic Audit PLT',
  dueOn: '2026-11-20',
  calc: 'Engagement letter: RM17,000 in two instalments',
  evidence: ['engagement-letter.pdf'],
};

describe('P78: the owner enters Finance records; checks and approvals keep their people', () => {
  it('raises a payment request for any company, and never approves it himself', async () => {
    const { svc } = fresh();
    const [owner, lead, fd] = await Promise.all(['u-fauzan', 'u-fin-t1-lead', 'u-fd'].map((id) => svc.user(id)));
    const list = await svc.financeRequests.list(owner);
    expect(list.canCreate).toContain(CO);
    expect(list.companyNames[CO]).toBeTruthy();
    const r = await svc.financeRequests.create(owner, CO, request);
    expect(r.status).toBe('finance_verify');
    // The Finance check is its team's; then the final approval is the FD's, not the owner who raised it.
    await svc.financeRequests.step(lead, CO, r.id, 'verify', { comment: 'Agrees with the engagement letter.' });
    await expect(svc.financeRequests.step(owner, CO, r.id, 'approve', { comment: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.financeRequests.step(fd, CO, r.id, 'approve', { comment: 'Approved.' })).status).toBe('approved');
  });

  it('adds a company bank account (only the last 4 digits), and data entry may not', async () => {
    const { svc, ds } = fresh();
    const [owner, de] = await Promise.all(['u-fauzan', 'u-fin-t1-de1'].map((id) => svc.user(id)));
    const before = ds.finStatus.find((f) => f.companyId === CO)!.banks.length;
    await expect(svc.finance.addBankAccount(owner, CO, { bank: 'Maybank', last4: '12345', purpose: 'payroll' })).rejects.toThrow(/last 4 digits/);
    await expect(svc.finance.addBankAccount(owner, CO, { bank: 'Maybank', last4: '1234', purpose: 'savings' })).rejects.toThrow(/operating, payroll or collection/);
    const acct = await svc.finance.addBankAccount(owner, CO, { bank: 'Maybank', last4: '1234', purpose: 'payroll' });
    expect(acct).toMatchObject({ accountMasked: '****1234', purpose: 'payroll', reconciledTo: null });
    await expect(svc.finance.addBankAccount(owner, CO, { bank: 'maybank', last4: '1234', purpose: 'payroll' })).rejects.toThrow(/already/);
    const board = await svc.finBoard(owner);
    expect(board.rows.find((r) => r.status.companyId === CO)!.status.banks).toHaveLength(before + 1);
    await expect(svc.finance.addBankAccount(de, CO, { bank: 'CIMB', last4: '9876', purpose: 'operating' })).rejects.toBeInstanceOf(AccessDenied);
  });

  it('starts the books for a company that has none, once', async () => {
    const { svc } = fresh((ds) => {
      const base = ds.companies.find((c) => c.id === CO)!;
      ds.companies.push({ ...base, id: 'co-p78', name: 'Synthetic New Security Sdn Bhd' });
      // A company added after go-live comes with its group grants (the owner's and the Finance Director's).
      for (const g of ds.grants.filter((x) => x.companyId === CO && (x.userId === 'u-fauzan' || x.userId === 'u-fd' || x.userId === 'u-fin-t1-lead')))
        ds.grants.push({ ...g, id: `${g.id}-p78`, companyId: 'co-p78' });
    });
    const [owner, lead] = await Promise.all(['u-fauzan', 'u-fin-t1-lead'].map((id) => svc.user(id)));
    expect((await svc.finance.settingsView(owner)).noBooks.map((c) => c.companyId)).toContain('co-p78');
    await expect(svc.finance.startBooks(lead, 'co-p78', { team: 1, fyEnd: '12-31' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.finance.startBooks(owner, 'co-p78', { team: 9, fyEnd: '12-31' })).rejects.toThrow(/Team/);
    await expect(svc.finance.startBooks(owner, 'co-p78', { team: 2, fyEnd: '02-30' })).rejects.toThrow(/year end/);
    const f = await svc.finance.startBooks(owner, 'co-p78', { team: 2, fyEnd: '06-30' });
    expect(f).toMatchObject({ id: 'fin-co-p78', team: 2, fyEnd: '06-30', banks: [], sqlLastAt: null });
    expect(f.tests).toHaveLength(12);
    await expect(svc.finance.startBooks(owner, 'co-p78', { team: 2, fyEnd: '06-30' })).rejects.toThrow(/already/);
    expect((await svc.finance.settingsView(owner)).noBooks.map((c) => c.companyId)).not.toContain('co-p78');
    expect((await svc.finBoard(owner)).rows.find((r) => r.status.companyId === 'co-p78')!.tone).toBe('unknown');
  });

  it('adds a paper for the auditor and moves it along, but someone else reviews what he prepared', async () => {
    const { svc } = fresh();
    const [owner, lead] = await Promise.all(['u-fauzan', 'u-fin-t1-lead'].map((id) => svc.user(id)));
    const row = (await svc.finBoard(owner)).rows.find((r) => r.status.companyId === CO)!;
    expect(row.canSet).toBe(true);
    await expect(svc.addFinPaper(owner, CO, 'audit', { label: 'x', dueOn: '2026-12-01' })).rejects.toThrow(/what the paper is/);
    const item = await svc.addFinPaper(owner, CO, 'audit', { label: 'Schedule of other receivables', dueOn: '2026-12-01' });
    expect(item.status).toBe('todo');
    await svc.setFinPack(owner, CO, 'audit', item.id, 'prepared');
    await expect(svc.setFinPack(owner, CO, 'audit', item.id, 'reviewed', 'Looks right.')).rejects.toBeInstanceOf(AccessDenied);
    const team = row.status.team;
    const reviewer = team === 1 ? lead : await svc.user('u-fd');
    expect((await svc.setFinPack(reviewer, CO, 'audit', item.id, 'reviewed', 'Agrees with the ledger.')).status).toBe('reviewed');
  });

  it('records PWVSB financing and its stamping and repayments; a group leader who is not the owner may not', async () => {
    const { svc } = fresh();
    const [owner, coo] = await Promise.all(['u-fauzan', 'u-coo'].map((id) => svc.user(id)));
    const board = await svc.creditBoard(owner);
    expect(board.owner).toBe(true);
    expect(board.canRecordFor.map((c) => c.id)).toContain('co-sasa');
    const loan = {
      kind: 'LOAN' as const,
      purpose: 'Working capital (synthetic)',
      secured: true,
      principal: 60000,
      ratePct: 8,
      startOn: '2026-10-01',
      termMonths: 6,
      agreementRef: 'AGR-P78',
      templateId: 'TEMPLATE-1',
      collateral: 'NONE' as const,
      collateralRef: null,
      chargeCreatedOn: null,
    };
    await expect(svc.addCreditLoan(coo, 'co-sasa', loan)).rejects.toBeInstanceOf(AccessDenied);
    const l = await svc.addCreditLoan(owner, 'co-sasa', loan);
    await svc.creditStamped(owner, l.id, 'ST-P78', '2026-10-20');
    const paid = await svc.creditRepayment(owner, l.id, 1, l.schedule[0].amount, 'BANK-REF-1', '2026-11-01');
    expect(paid.schedule[0].paidAmount).toBe(l.schedule[0].amount);
  });
});
