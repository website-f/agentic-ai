import { describe, expect, it } from 'vitest';
import { AccessDenied, GROUP_EMPLOYER_ID, MemoryStore, PrimaService, generateDataset, myt, sqlCloseBlockers, sqlEnqueue, sqlPostingKey, sqlPvPayload, syncKey, RULES } from '../src';
import { FakeSqlPoster } from './fakes/fake-sql-poster';
type FinStatusT = import('../src').FinStatus;
type Job = import('../src').SqlPostingJob;

// SQL Account posting link, Build 1 (Fauzan, 13 Nov 2026). Synthetic data and a fake SQL Account only.
const TODAY = '2026-10-31';
const NOW = myt(TODAY, '10:00');
const T1 = GROUP_EMPLOYER_ID;
const BOOK = 'BOOK-PWVSB-TEST';
const PAYEE = 'payee-pwvsb-001';
const NAME = 'SYARIKAT BEKALAN PEJABAT';
const sign = (byId = 'u-x') => ({ by: byId, byId, at: '2026-10-01T02:00:00.000Z', comment: 'synthetic' });

const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  let now = NOW;
  const svc = new PrimaService(store, () => now);
  const F = () => ds.finStatus.find((x) => x.companyId === T1)!;
  const jobs = () => ds.sqlPostings.filter((j) => j.companyId === T1);
  const at = (day: string, time = '10:00') => {
    now = myt(day, time);
  };
  return { ds, svc, F, jobs, at };
};
const who = (svc: PrimaService, ...ids: string[]) => Promise.all(ids.map((id) => svc.user(id)));

/** Confirmed set-up, approved chart of accounts with bank codes. */
const COPY = 'SYN-COPY-BOOK';
const setUp = (f: FinStatusT) => {
  f.sqlDiscovery = {
    companyFile: BOOK,
    // D4 (Fauzan, 23 Nov 2026): Prima posts to a copy of the book first.
    copyBook: COPY,
    deployment: 'on_premises',
    version: '5.2025.1038.875',
    modules: { restApi: 'yes', asset: 'unknown', project: 'unknown', consolidation: 'unknown', bankFeed: 'unknown' },
    partnerDoc: 'synthetic-partner-letter.pdf',
    recorded: sign('u-fin-t1-de1'),
    confirmed: sign('u-fd'),
  };
  f.coaMaps = [{ version: 1, from: '2026-01', accounts: [], na: [], banks: f.banks.map((b, i) => ({ bankId: b.id, code: `310-00${i}` })), projects: [], note: '', proposed: sign('u-fin-t1-de1'), approved: sign('u-fd'), returned: null }];
};

let seq = 0;
async function release(svc: PrimaService, F: () => FinStatusT, amount: number) {
  const [de, de2, dep, fd] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-dep', 'u-fd');
  seq += 1;
  const p = await svc.finance.createPayment(de, T1, { payeeId: PAYEE, purpose: `Synthetic supplies ${seq}`, amount, dueOn: '2026-09-20', bankId: F().banks[0].id, sqlRef: `PI-SYN-${seq}`, evidence: ['i.pdf'], invoiceNo: `SYN-${seq}` });
  await svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'ok' });
  await svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: 'Synthetic supplies approved.' });
  F().payments!.find((x) => x.id === p.id)!.steps.find((x) => x.step === 'approved')!.at = myt('2026-09-18', '09:00');
  await svc.finance.paymentStep(de2, T1, p.id, 'release', { bankRef: `M2U-${seq}`, releasedOn: '2026-09-18', accountLast4: '1000', accountName: NAME });
  return p.id;
}

/** Everything switched on: the API flag, a fake poster, the company and payment vouchers, the payee's checked code. */
async function switchOn(svc: PrimaService, F: () => FinStatusT, fake: FakeSqlPoster) {
  const [de, dep, fd] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fd');
  setUp(F());
  svc.sqlPostingEnabled = true;
  svc.sqlPoster = fake;
  await svc.financeSqlPosting.setSwitch(fd, T1, { on: true, docTypes: { GL_PV: true }, reason: 'Parallel month on the copy book (synthetic).' });
  await svc.financeSqlPosting.codeAction(de, T1, 'payeeCode', { payeeId: PAYEE, code: '400-S001' });
  await svc.financeSqlPosting.codeAction(dep, T1, 'payeeCodeCheck', { payeeId: PAYEE, comment: 'Matches the SQL supplier list' });
}

describe('L2 the posting queue', () => {
  it('a released payment with posting off gives exactly one waiting job with its reason; a draft gives none', async () => {
    const { svc, F, jobs } = fresh();
    const de = await svc.user('u-fin-t1-de1');
    const before = jobs().length;
    await svc.finance.createPayment(de, T1, { payeeId: PAYEE, purpose: 'Draft only', amount: 77, dueOn: '2026-09-20', bankId: F().banks[0].id, sqlRef: 'PI-SYN-D', evidence: ['i.pdf'], invoiceNo: 'SYN-D' });
    expect(jobs().length).toBe(before);
    const id = await release(svc, F, 101.5);
    const mine = jobs().filter((j) => j.sourceId === id);
    expect(mine.length).toBe(1);
    expect(mine[0]).toMatchObject({ status: 'not_ready', docType: 'GL_PV', revision: 1, companyId: T1 });
    expect(mine[0].reasons.join(' ')).toMatch(/switched off for this company/);
    expect(mine[0].key).toBe(sqlPostingKey(T1, null, 'GL_PV', `payment:${id}`, 1));
  });

  it('the same record twice is one job; changed content is the next revision with a new key', async () => {
    const { svc, F, jobs, ds } = fresh();
    const id = await release(svc, F, 202);
    const store = new MemoryStore(ds);
    const p = F().payments!.find((x) => x.id === id)!;
    const again = await sqlEnqueue(store, F(), 'payment', id, sqlPvPayload(F(), p), NOW);
    expect(again!.id).toBe(jobs().find((j) => j.sourceId === id)!.id);
    const changed = await sqlEnqueue(store, F(), 'payment', id, { ...sqlPvPayload(F(), p)!, amount: 203 }, NOW);
    expect(changed!.revision).toBe(2);
    expect(new Set(jobs().filter((j) => j.sourceId === id).map((j) => j.key)).size).toBe(2);
  });

  it('item register keys use the shared key with the confirmed book', () => {
    expect(syncKey('co-1', 'sales_delivery', 'mv-1', 1)).toBe('co-1|book-not-confirmed|sales_delivery|mv-1|r1');
    expect(syncKey('co-1', 'sales_delivery', 'mv-1', 1, 'BOOK-A')).toBe('co-1|BOOK-A|sales_delivery|mv-1|r1');
    expect(RULES.financeSqlPosting.label).toBe('Policy');
  });
});

describe('the payment SQL document number once Prima posts vouchers (Fauzan, 14 Nov 2026)', () => {
  it('is required while posting is off; optional and the bill only once payment vouchers are switched on', async () => {
    const { svc, F } = fresh();
    const [de, fd] = await who(svc, 'u-fin-t1-de1', 'u-fd');
    const base = { payeeId: PAYEE, purpose: 'Synthetic bill pay', amount: 55, dueOn: '2026-09-20', bankId: F().banks[0].id, evidence: ['i.pdf'] };
    await expect(svc.finance.createPayment(de, T1, { ...base, sqlRef: '', invoiceNo: 'SYN-R1' })).rejects.toThrow(/SQL Account document number is needed/);
    setUp(F());
    await svc.financeSqlPosting.setSwitch(fd, T1, { on: true, docTypes: { GL_PV: true }, reason: 'Parallel month on the copy book.' });
    const p = await svc.finance.createPayment(de, T1, { ...base, sqlRef: '', invoiceNo: 'SYN-R2' });
    expect(p.sqlRef).toBe('');
    await expect(svc.finance.createPayment(de, T1, { ...base, amount: 56, sqlRef: 'PV-000777', invoiceNo: 'SYN-R3' })).rejects.toThrow(/posts the payment voucher itself/);
  });
});

describe('L4 codes before anything posts', () => {
  it('waits for a missing code; a code typed but not checked does not release it; checked, it becomes ready by itself', async () => {
    const { svc, F, jobs } = fresh();
    const [de, de2, dep, fd] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-dep', 'u-fd');
    setUp(F());
    svc.sqlPostingEnabled = true;
    svc.sqlPoster = new FakeSqlPoster();
    await svc.financeSqlPosting.setSwitch(fd, T1, { on: true, docTypes: { GL_PV: true }, reason: 'Parallel month on the copy book.' });
    const id = await release(svc, F, 303);
    const job = () => jobs().find((j) => j.sourceId === id)!;
    expect(job().reasons.join(' ')).toMatch(/no checked SQL Account code/);
    await svc.financeSqlPosting.codeAction(de, T1, 'payeeCode', { payeeId: PAYEE, code: '400-s001' });
    expect(job().status).toBe('not_ready');
    await expect(svc.financeSqlPosting.codeAction(de, T1, 'payeeCodeCheck', { payeeId: PAYEE, comment: 'self' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.financeSqlPosting.codeAction(de2, T1, 'payeeCodeCheck', { payeeId: PAYEE, comment: 'clerk' })).rejects.toBeInstanceOf(AccessDenied);
    await svc.financeSqlPosting.codeAction(dep, T1, 'payeeCodeCheck', { payeeId: PAYEE, comment: 'Matches the SQL supplier list' });
    expect(job()).toMatchObject({ status: 'ready', reasons: [] });
    expect((job().payload as { payeeCode: string }).payeeCode).toBe('400-S001');
  });

  it('only the FD or the CEO switches, with a reason; supplier bills cannot be switched on yet', async () => {
    const { svc, F } = fresh();
    const [lead, fd] = await who(svc, 'u-fin-t1-lead', 'u-fd');
    setUp(F());
    await expect(svc.financeSqlPosting.setSwitch(lead, T1, { on: true, docTypes: { GL_PV: true }, reason: 'Leader tries it here.' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.financeSqlPosting.setSwitch(fd, T1, { on: true, docTypes: { GL_PV: true }, reason: 'short' })).rejects.toThrow(/reason/);
    await expect(svc.financeSqlPosting.setSwitch(fd, T1, { on: true, docTypes: { AP_PI: true }, reason: 'Supplier bills as well please.' })).rejects.toThrow(/waits for SQL support/);
    F().sqlDiscovery!.confirmed = null;
    await expect(svc.financeSqlPosting.setSwitch(fd, T1, { on: true, docTypes: { GL_PV: true }, reason: 'Not confirmed yet though.' })).rejects.toThrow(/Confirm the company's SQL Account set-up/);
  });
});

describe('L5 sending, retries and "did it go in?"', () => {
  it('posts once and keeps the document number; nothing is sent while SQL_POSTING_ENABLED is off', async () => {
    const { svc, F, jobs } = fresh();
    const fd = await svc.user('u-fd');
    const fake = new FakeSqlPoster();
    await switchOn(svc, F, fake);
    const id = await release(svc, F, 404);
    svc.sqlPostingEnabled = false;
    expect((await svc.financeSqlPosting.sendNow(fd)).off).toMatch(/switched off/);
    expect(fake.calls).toBe(0);
    svc.sqlPostingEnabled = true;
    const r = await svc.financeSqlPosting.sendNow(fd);
    expect(r.posted).toBe(1);
    const job = jobs().find((j) => j.sourceId === id)!;
    expect(job).toMatchObject({ status: 'posted', sqlDocNo: 'PV-000001', book: COPY });
    expect(F().payments!.find((p) => p.id === id)!.sqlPost?.docNo).toBe('PV-000001');
    await svc.financeSqlPosting.sendNow(fd);
    expect(fake.docs.length).toBe(1);
  });

  it('a timeout after sending is looked up, never sent again; without look-up it goes to Finance', async () => {
    const { svc, F, jobs } = fresh();
    const fd = await svc.user('u-fd');
    const fake = new FakeSqlPoster();
    await switchOn(svc, F, fake);
    const a = await release(svc, F, 505);
    fake.next = ['timeout_saved'];
    await svc.financeSqlPosting.sendNow(fd);
    expect(jobs().find((j) => j.sourceId === a)!.status).toBe('posted');
    expect(fake.docs.length).toBe(1);

    const other = fresh();
    const fake2 = new FakeSqlPoster({ canFind: false });
    await switchOn(other.svc, other.F, fake2);
    const b = await release(other.svc, other.F, 506);
    fake2.next = ['timeout_saved'];
    await other.svc.financeSqlPosting.sendNow(await other.svc.user('u-fd'));
    await other.svc.financeSqlPosting.sendNow(await other.svc.user('u-fd'));
    expect(other.jobs().find((j) => j.sourceId === b)!.status).toBe('manual_review');
    expect(fake2.calls).toBe(1);
    expect(fake2.docs.length).toBe(1);
  });

  it('8 jobs give 8 documents and no duplicates; a refusal keeps its reason; a network error waits to retry', async () => {
    const { svc, F, jobs } = fresh();
    const fd = await svc.user('u-fd');
    const fake = new FakeSqlPoster();
    await switchOn(svc, F, fake);
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push(await release(svc, F, 600 + i));
    fake.next = ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'reject', 'network'];
    await Promise.all([svc.financeSqlPosting.sendNow(fd), svc.financeSqlPosting.sendNow(fd)]);
    await svc.financeSqlPosting.sendNow(fd);
    const mine = jobs().filter((j) => ids.includes(j.sourceId));
    expect(mine.filter((j) => j.status === 'posted').length).toBe(8);
    expect(new Set(fake.docs.map((d) => d.ourRef)).size).toBe(fake.docs.length);
    expect(fake.docs.length).toBe(8);
    const refused = mine.find((j) => j.status === 'rejected')!;
    expect(refused.reasons[0]).toMatch(/does not exist/);
    const retry = mine.find((j) => j.status === 'retryable_error')!;
    expect(retry.tries).toBe(1);
    expect(Date.parse(retry.nextTryAt!)).toBe(Date.parse(NOW) + 5 * 60_000);
  });
});

describe('L6 daily match check and the exceptions list', () => {
  it('a document changed in SQL Account fails the next morning; explained by one person, checked by another; the close waits', async () => {
    const { svc, F, jobs, at, ds } = fresh();
    const [de, de2, dep, fd] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-dep', 'u-fd');
    const fake = new FakeSqlPoster();
    await switchOn(svc, F, fake);
    const a = await release(svc, F, 707);
    const b = await release(svc, F, 708);
    await svc.financeSqlPosting.sendNow(fd);
    fake.docs.find((d) => d.ourRef?.includes(a))!.amount = 770;
    at('2026-11-01', '06:00');
    const r = await svc.financeSqlPosting.checkNow(dep);
    expect(r.checked).toBe(2);
    expect(jobs().find((j) => j.sourceId === a)!.status).toBe('check_failed');
    expect(jobs().find((j) => j.sourceId === b)!.status).toBe('checked_ok');
    const ex = ds.sqlPostingExceptions.find((e) => e.kind === 'differs')!;
    expect(ex.text).toMatch(/amount RM770.00, Prima posted RM707.00/);
    expect(ds.sqlPostingExceptions.some((e) => e.kind === 'totals')).toBe(true);
    const store = new MemoryStore(ds);
    expect((await sqlCloseBlockers(store, T1)).join(' ')).toMatch(/not explained and checked/);
    await expect(svc.financeSqlPosting.exceptionAction(de, ex.id, 'explain', { comment: 'short' })).rejects.toThrow(/10 characters/);
    await svc.financeSqlPosting.exceptionAction(de, ex.id, 'explain', { comment: 'Typed over in SQL Account by mistake; corrected back to 707.' });
    await expect(svc.financeSqlPosting.exceptionAction(de, ex.id, 'check', { comment: 'mine' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.financeSqlPosting.exceptionAction(de2, ex.id, 'check', { comment: 'clerk' })).rejects.toBeInstanceOf(AccessDenied);
    await svc.financeSqlPosting.exceptionAction(dep, ex.id, 'check', { comment: 'Seen PV corrected in SQL Account' });
    for (const e of ds.sqlPostingExceptions.filter((x) => x.id !== ex.id)) {
      await svc.financeSqlPosting.exceptionAction(de, e.id, 'explain', { comment: 'Same correction as the other one.' });
      await svc.financeSqlPosting.exceptionAction(dep, e.id, 'check', { comment: 'ok seen' });
    }
    expect(await sqlCloseBlockers(store, T1)).toEqual([]);
  });

  it('a job left refused 2 working days is listed; a payment changed after posting must be reversed in SQL Account', async () => {
    const { svc, F, at, ds } = fresh();
    const [de, fd] = await who(svc, 'u-fin-t1-de1', 'u-fd');
    const fake = new FakeSqlPoster();
    await switchOn(svc, F, fake);
    const a = await release(svc, F, 808);
    const b = await release(svc, F, 809);
    fake.next = ['reject', 'ok'];
    await svc.financeSqlPosting.sendNow(fd);
    F().payments!.find((p) => p.id === b)!.status = 'cancelled';
    at('2026-11-03', '06:00');
    await svc.financeSqlPosting.check();
    const kinds = ds.sqlPostingExceptions.map((e) => `${e.kind}:${e.sourceId}`);
    expect(kinds).toContain(`stuck:${a}`);
    expect(kinds).toContain(`reverse:${b}`);
    const rev = ds.sqlPostingExceptions.find((e) => e.kind === 'reverse')!;
    await expect(svc.financeSqlPosting.exceptionAction(de, rev.id, 'explain', { comment: 'Reversed in SQL Account today.' })).rejects.toThrow(/reverses or corrects/);
    await svc.financeSqlPosting.check();
    expect(ds.sqlPostingExceptions.filter((e) => e.kind === 'reverse').length).toBe(1);
  });

  it('a finished payment with no job is urgent; a pasted export finds a voucher typed by hand as well', async () => {
    const { svc, F, at, ds, jobs } = fresh();
    const [de, fd] = await who(svc, 'u-fin-t1-de1', 'u-fd');
    const fake = new FakeSqlPoster();
    await switchOn(svc, F, fake);
    const a = await release(svc, F, 909);
    const b = await release(svc, F, 910);
    ds.sqlPostings = ds.sqlPostings.filter((j) => j.sourceId !== b);
    await svc.financeSqlPosting.sendNow(fd);
    at('2026-11-02', '06:00');
    await svc.financeSqlPosting.check();
    expect(ds.sqlPostingExceptions.some((e) => e.kind === 'no_job' && e.sourceId === `payment:${b}`)).toBe(true);
    const pv = jobs().find((j) => j.sourceId === a)!;
    const r = await svc.financeSqlPosting.pasteListing(de, T1, `${pv.sqlDocNo},2026-09-18,909.00,PRIMA-${a}-r1\nPV-HAND-1,2026-09-18,909.00,typed`);
    expect(r.raised).toBe(1);
    expect(ds.sqlPostingExceptions.find((e) => e.kind === 'not_from_prima')).toMatchObject({ origin: 'pasted_export', sqlDocNo: null });
  });
});

describe('L3.3 customer receipts and L7 who sees what', () => {
  it('a receipt found on the bank statement queues one customer payment that waits for the customer code', async () => {
    const { svc, F, jobs } = fresh();
    const [de1, lead] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-lead');
    const ar = svc.financeControls;
    const bankId = F().banks[0].id;
    const c = (await ar.arAction(de1, T1, 'open', { invoiceNo: 'IV-SQ-1', invoiceDate: '2026-05-01', customer: 'Client (mock)', amount: 3000, reason: 'refused', detail: 'Client delayed payment.' })) as { id: string };
    await ar.arAction(de1, T1, 'payment', { caseId: c.id, amount: 3000, ref: 'OR-SQ-1', on: '2026-09-15', bankId });
    expect(jobs().filter((j) => j.docType === 'AR_PM').length).toBe(0);
    const csv = ['Date,Description,Ref,Amount', '2026-09-16,IBG CLIENT MOCK,OR-SQ-1,3000.00'].join('\n');
    await ar.statementAction(lead, T1, 'load', { bankId, period: '2026-09', opening: 0, closing: 3000, csv, source: 'sep.csv' });
    const got = jobs().filter((j) => j.docType === 'AR_PM') as Job[];
    expect(got.length).toBe(1);
    expect(got[0].payload).toMatchObject({ invoiceNo: 'IV-SQ-1', amount: 3000, date: '2026-09-16', customerCode: null });
    expect(got[0].reasons.join(' ')).toMatch(/customer code/);
  });

  it('a team sees only its companies, the FD sees all, the COO sees only the count', async () => {
    const { svc, F, at } = fresh();
    const [t2, fd, coo] = await who(svc, 'u-fin-t2-lead', 'u-fd', 'u-coo');
    const fake = new FakeSqlPoster();
    await switchOn(svc, F, fake);
    await release(svc, F, 111);
    const v2 = await svc.financeSqlPosting.view(t2);
    expect(v2.companies.some((c) => c.companyId === T1)).toBe(false);
    const vfd = await svc.financeSqlPosting.view(fd);
    expect(vfd.companies.find((c) => c.companyId === T1)!.jobs.length).toBeGreaterThan(0);
    await expect(svc.financeSqlPosting.view(coo)).rejects.toBeInstanceOf(AccessDenied);
    expect(await svc.financeSqlPosting.exceptionCount(coo)).toBeNull();
    await svc.financeSqlPosting.sendNow(fd);
    at('2026-11-02', '06:00');
    await svc.financeSqlPosting.check();
    expect(await svc.financeSqlPosting.exceptionCount(coo)).toBe(1); // the knock-off by hand for the bill it pays
  });
});
