import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt } from '../src';

// Payment requests by the company head (Fauzan, 1 Nov 2026): "the approval for guard salary in government, the company
// head create, operation head approve, then finance approve the calculation correct. Then coo approve it. Then finance
// will proses the payment." Dummy data only, never staging.
const TODAY = '2026-10-31';
const NOW = myt(TODAY, '10:00');
const CO = 'co-09';
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const cm = ds.users.find((u) => u.id === 'u-cm-sasa')!;
  ds.users.push({ ...cm, id: 'u-cm-09', name: 'Company Manager 09 (mock)', companyIds: [CO] });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  return { ds, svc, F: () => ds.finStatus.find((x) => x.companyId === CO)! };
};
const who = (svc: PrimaService, ...ids: string[]) => Promise.all(ids.map((id) => svc.user(id)));
const salary = {
  subject: 'operations',
  sector: 'government',
  title: 'Guard salary October, government sites',
  purpose: 'Monthly salary for guards at government sites (mock).',
  amount: 48250,
  payee: 'Guards payroll (bank payroll file)',
  dueOn: '2026-11-07',
  calc: '25 guards x RM1,700 basic + overtime RM5,750 (JA payroll export, mock)',
  evidence: ['ja-payroll-oct.pdf'],
};

describe('payment requests: company head, department head, Finance check, COO, then Finance pays', () => {
  it('runs the government guard salary chain in order, each person once, and the COO approval becomes the payment approval', async () => {
    const { svc, F } = fresh();
    const [cm, ogm, opsdir, lead, dep, coo, fd, de1, de2] = await who(svc, 'u-cm-09', 'u-ogm', 'u-opsdir', 'u-fin-t1-lead', 'u-fin-t1-dep', 'u-coo', 'u-fd', 'u-fin-t1-de1', 'u-fin-t1-de2');
    const R = svc.financeRequests;
    // Only the company's own head creates it, and Operations needs government or private.
    await expect(R.create(lead, CO, salary)).rejects.toThrow(/company head/);
    await expect(R.create(cm, CO, { ...salary, sector: undefined })).rejects.toThrow(/government or private/);
    const r = await R.create(cm, CO, salary);
    expect(r.status).toBe('head_review');
    // Government sites: the OGM approves, not the Operations Director; the creator never approves.
    await expect(R.step(opsdir, CO, r.id, 'head', { comment: 'ok' })).rejects.toThrow();
    await expect(R.step(cm, CO, r.id, 'head', { comment: 'ok' })).rejects.toThrow(/Not allowed/);
    // Nothing can be skipped: the COO cannot approve before Finance checked the calculation.
    await expect(R.step(coo, CO, r.id, 'approve', { comment: 'ok' })).rejects.toThrow(/Not allowed/);
    await expect(R.step(ogm, CO, r.id, 'head', { comment: ' ' })).rejects.toThrow(/comment/);
    expect((await R.step(ogm, CO, r.id, 'head', { comment: 'Headcount agrees with the roster.' })).status).toBe('finance_verify');
    // Finance (the company's team leader or deputy) checks the calculation.
    await expect(R.step(de1, CO, r.id, 'verify', { comment: 'ok' })).rejects.toThrow(/Not allowed/);
    expect((await R.step(lead, CO, r.id, 'verify', { comment: 'Calculation agrees with the JA payroll export.' })).status).toBe('final_approval');
    // Finance payments go to the FD, but this is Operations: the COO (or the CEO) approves, never the FD.
    await expect(R.step(fd, CO, r.id, 'approve', { comment: 'ok' })).rejects.toThrow(/Not allowed/);
    expect((await R.step(coo, CO, r.id, 'approve', { comment: 'Approved for payment.' })).status).toBe('approved');
    // Each person was told in turn; now Finance prepares the payment from it.
    const bankId = F().banks[0].id;
    const desk = (await svc.finance.desk(de1)).companies.find((c) => c.companyId === CO)!;
    expect(desk.requests.map((x) => x.id)).toEqual([r.id]);
    await expect(svc.finance.createPayment(de1, CO, { requestId: r.id, payeeId: 'payee-co-09-001', purpose: 'Guard salary', amount: 48000, dueOn: '2026-11-07', bankId, sqlRef: 'PV-SAL-1', evidence: ['file.pdf'] })).rejects.toThrow(/approved RM48250.00/);
    const p = await svc.finance.createPayment(de1, CO, { requestId: r.id, payeeId: 'payee-co-09-001', purpose: 'Guard salary', amount: 48250, dueOn: '2026-11-07', bankId, sqlRef: 'PV-SAL-1', evidence: ['file.pdf'], subject: 'finance' });
    // What it is for comes from the request, whatever the preparer chose, so the approver cannot be switched.
    expect([p.subject, p.needs, p.requestId]).toEqual(['operations', 'coo', r.id]);
    await expect(svc.finance.createPayment(de2, CO, { requestId: r.id, payeeId: 'payee-co-09-003', purpose: 'Guard salary', amount: 48250, dueOn: '2026-11-07', bankId, sqlRef: 'PV-SAL-2', evidence: ['file.pdf'] })).rejects.toThrow(/already being paid/);
    // The review makes it approved with the COO's approval copied: no second approval anywhere.
    const reviewed = await svc.finance.paymentStep(dep, CO, p.id, 'review', { comment: 'Payment matches the request.' });
    expect(reviewed.status).toBe('approved');
    expect(reviewed.steps.find((x) => x.step === 'approved')).toMatchObject({ byId: 'u-coo' });
    const done = await svc.finance.paymentStep(de2, CO, p.id, 'release', { bankRef: 'M2U-SAL-1', accountLast4: '1000', accountName: 'SYARIKAT BEKALAN PEJABAT' });
    expect(done.status).toBe('released');
  });

  it('a return goes back to the company head and the whole chain approves again', async () => {
    const { svc } = fresh();
    const [cm, ogm, lead, dep, coo] = await who(svc, 'u-cm-09', 'u-ogm', 'u-fin-t1-lead', 'u-fin-t1-dep', 'u-coo');
    const R = svc.financeRequests;
    const r = await R.create(cm, CO, salary);
    await R.step(ogm, CO, r.id, 'head', { comment: 'ok' });
    await expect(R.step(lead, CO, r.id, 'return', { comment: 'short' })).rejects.toThrow();
    expect((await R.step(lead, CO, r.id, 'return', { comment: 'Overtime is not in the JA export; correct it.' })).status).toBe('returned');
    expect((await svc.financeRequests.home(cm)).map((x) => x.title)).toEqual(['1 payment request(s) returned to you']);
    const again = await R.step(cm, CO, r.id, 'resubmit', { amount: 42500, calc: '25 guards x RM1,700 basic, no overtime (mock)', comment: 'Removed overtime.' });
    expect([again.status, again.amount]).toEqual(['head_review', 42500]);
    // The OGM approves again; the deputy (not the leader who returned it... any checker who has not acted this round) checks.
    await R.step(ogm, CO, r.id, 'head', { comment: 'ok again' });
    await R.step(dep, CO, r.id, 'verify', { comment: 'Now agrees.' });
    expect((await R.step(coo, CO, r.id, 'approve', { comment: 'Approved.' })).status).toBe('approved');
  });

  it('Finance requests need no department head and are approved by the FD or the CEO; nobody acts twice', async () => {
    const { svc } = fresh();
    const [cm, lead, fd, coo, ceo] = await who(svc, 'u-cm-09', 'u-fin-t1-lead', 'u-fd', 'u-coo', 'u-fauzan');
    const R = svc.financeRequests;
    const r = await R.create(cm, CO, { ...salary, subject: 'finance', sector: null, title: 'Audit fee', purpose: 'Statutory audit fee for FY2025 (mock).', amount: 9000, calc: 'Engagement letter fee (mock)' });
    expect(r.status).toBe('finance_verify');
    await R.step(fd, CO, r.id, 'verify', { comment: 'Fee agrees with the engagement letter.' });
    // The FD checked it, so the FD does not also approve it; the COO never approves Finance requests.
    await expect(R.step(fd, CO, r.id, 'approve', { comment: 'ok' })).rejects.toThrow(/acts twice/);
    await expect(R.step(coo, CO, r.id, 'approve', { comment: 'ok' })).rejects.toThrow(/not found/);
    expect((await R.step(ceo, CO, r.id, 'approve', { comment: 'Approved.' })).status).toBe('approved');
    void lead;
  });

  it('Goodwill Empire requests are approved first by the OGM as department head, then Finance, then the COO', async () => {
    const { svc } = fresh();
    const [cm, ogm, opsdir, lead, coo, fd] = await who(svc, 'u-cm-09', 'u-ogm', 'u-opsdir', 'u-fin-t1-lead', 'u-coo', 'u-fd');
    const R = svc.financeRequests;
    const r = await R.create(cm, CO, { ...salary, subject: 'goodwill', sector: null, title: 'Goodwill supplies', purpose: 'Goodwill Empire stock purchase (mock).', amount: 3200, calc: 'Supplier quote Q-1 (mock)' });
    expect(r.status).toBe('head_review');
    // Only the OGM is the Goodwill Empire department head (Fauzan, 2 Nov 2026).
    await expect(R.step(opsdir, CO, r.id, 'head', { comment: 'ok' })).rejects.toThrow();
    await expect(R.step(coo, CO, r.id, 'head', { comment: 'ok' })).rejects.toThrow();
    expect((await R.step(ogm, CO, r.id, 'head', { comment: 'Needed for the Goodwill outlet.' })).status).toBe('finance_verify');
    expect((await R.step(lead, CO, r.id, 'verify', { comment: 'Quote agrees.' })).status).toBe('final_approval');
    // A COO department: the FD does not approve it.
    await expect(R.step(fd, CO, r.id, 'approve', { comment: 'ok' })).rejects.toThrow(/Not allowed/);
    expect((await R.step(coo, CO, r.id, 'approve', { comment: 'Approved.' })).status).toBe('approved');
  });

  it('a company head sees only their company, and another company head cannot act on it', async () => {
    const { svc, ds } = fresh();
    const [cm] = await who(svc, 'u-cm-09');
    const r = await svc.financeRequests.create(cm, CO, salary);
    const sasa = await svc.user('u-cm-sasa');
    expect((await svc.financeRequests.list(sasa)).requests.some((x) => x.id === r.id)).toBe(false);
    await expect(svc.financeRequests.step(sasa, CO, r.id, 'cancel', { comment: 'Not needed any more' })).rejects.toThrow();
    void ds;
  });
});

describe('payment requests: a lapsed payment sends the request back through the chain', () => {
  it('returns the request to the company head when its payment lapses, and the payment waits for a fresh approval', async () => {
    const { svc, ds, F } = fresh();
    const [cm, ogm, lead, coo, de1, dep] = await who(svc, 'u-cm-09', 'u-ogm', 'u-fin-t1-lead', 'u-coo', 'u-fin-t1-de1', 'u-fin-t1-dep');
    const R = svc.financeRequests;
    const r = await R.create(cm, CO, salary);
    await R.step(ogm, CO, r.id, 'head', { comment: 'ok' });
    await R.step(lead, CO, r.id, 'verify', { comment: 'ok' });
    await R.step(coo, CO, r.id, 'approve', { comment: 'ok' });
    const p = await svc.finance.createPayment(de1, CO, { requestId: r.id, payeeId: 'payee-co-09-001', purpose: 'Guard salary', amount: 48250, dueOn: '2026-11-07', bankId: F().banks[0].id, sqlRef: 'PV-SAL-9', evidence: ['f.pdf'] });
    await svc.finance.paymentStep(dep, CO, p.id, 'review', { comment: 'ok' });
    const later = new PrimaService(new MemoryStore(ds), () => myt('2026-12-15', '09:00'));
    const [deL, depL, cmL] = await who(later, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-cm-09');
    await later.finance.desk(deL);
    await later.finance.paymentStep(deL, CO, p.id, 'resubmit', { comment: 'Still due.' });
    expect(F().requests!.find((x) => x.id === r.id)!.status).toBe('returned');
    // Until the whole chain approves the request again, the payment cannot go on.
    await expect(later.finance.paymentStep(depL, CO, p.id, 'review', { comment: 'ok' })).rejects.toThrow(/approved again/);
    expect((await later.financeRequests.home(cmL)).map((x) => x.title)).toEqual(['1 payment request(s) returned to you']);
  });
});
