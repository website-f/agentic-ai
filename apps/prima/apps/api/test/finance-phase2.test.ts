// Finance Phase 2 against a real local PostgreSQL (throwaway database; the tests reset it). Proves the payment and
// close records save through the restricted database login, that separation of duties holds on the real store, and
// that a Finance team cannot reach another team's company books. Dummy data only, never staging.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
process.env.DEV_TOKEN_SECRET = process.env.DEV_TOKEN_SECRET ?? 'test-secret';

async function rowOf(id: string) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return (await c.query('SELECT data FROM prima.fin_status WHERE id=$1', [id])).rows[0]?.data;
  } finally {
    await c.end();
  }
}

describe('Finance Phase 2 on PostgreSQL', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('saves a payment through prepare, review, approve and release, each by a different person', async () => {
    const f = await rowOf('fin-pwvsb');
    assert.equal(f.team, 1);
    const p = await db.asUser('u-fin-t1-de1', (svc, u) =>
      svc.finance.createPayment(u, 'pwvsb', {
        payeeId: 'payee-pwvsb-001',
        purpose: 'API UAT',
        amount: 999.99,
        dueOn: '2026-12-01',
        bankId: f.banks[0].id,
        sqlRef: 'PI-API-UAT-1',
        evidence: ['API UAT invoice.pdf'],
      }),
    );
    await assert.rejects(db.asUser('u-fin-t1-de1', (svc, u) => svc.finance.paymentStep(u, 'pwvsb', p.id, 'review', { comment: 'self' })), /prepared/);
    await db.asUser('u-fin-t1-dep', (svc, u) => svc.finance.paymentStep(u, 'pwvsb', p.id, 'review', { comment: 'Checked.' }));
    // Only the Finance Director or the CEO approves (Fauzan, 1 Nov 2026).
    await assert.rejects(db.asUser('u-fin-t1-lead', (svc, u) => svc.finance.paymentStep(u, 'pwvsb', p.id, 'approve', { comment: 'OK.' })), /Finance Director or the CEO/);
    await db.asUser('u-fd', (svc, u) => svc.finance.paymentStep(u, 'pwvsb', p.id, 'approve', { comment: 'OK.' }));
    await assert.rejects(db.asUser('u-fd', (svc, u) => svc.finance.paymentStep(u, 'pwvsb', p.id, 'release', { bankRef: 'API-REF-1' })), /approved/);
    await db.asUser('u-fin-t1-de2', (svc, u) => svc.finance.paymentStep(u, 'pwvsb', p.id, 'release', { bankRef: 'API-REF-1', accountLast4: '1000', accountName: 'SYARIKAT BEKALAN PEJABAT' }));
    const saved = (await rowOf('fin-pwvsb')).payments.find((x: { id: string }) => x.id === p.id);
    assert.equal(saved.status, 'released');
    assert.deepEqual(
      saved.steps.map((s: { byId: string }) => s.byId),
      ['u-fin-t1-de1', 'u-fin-t1-dep', 'u-fd', 'u-fin-t1-de2'],
    );
  });

  it('lets the COO approve an operations payment through the restricted login, and nothing else', async () => {
    const f = await rowOf('fin-pwvsb');
    const p = await db.asUser('u-fin-t1-de1', (svc, u) =>
      svc.finance.createPayment(u, 'pwvsb', {
        payeeId: 'payee-pwvsb-001',
        purpose: 'API UAT operations',
        amount: 456.78,
        dueOn: '2026-12-01',
        bankId: f.banks[0].id,
        sqlRef: 'PI-API-UAT-OPS',
        evidence: ['API UAT ops invoice.pdf'],
        subject: 'operations',
      }),
    );
    assert.equal(p.needs, 'coo');
    await db.asUser('u-fin-t1-dep', (svc, u) => svc.finance.paymentStep(u, 'pwvsb', p.id, 'review', { comment: 'Checked.' }));
    await assert.rejects(db.asUser('u-fd', (svc, u) => svc.finance.paymentStep(u, 'pwvsb', p.id, 'approve', { comment: 'OK.' })), /COO or the CEO/);
    const q = await db.asUser('u-coo', (svc, u) => svc.finance.cooDesk(u));
    assert.deepEqual(q.payments.find((x) => x.id === p.id)?.may, ['approve', 'return']);
    await db.asUser('u-coo', (svc, u) => svc.finance.cooStep(u, 'pwvsb', p.id, 'approve', { comment: 'For the site patrol.' }));
    await assert.rejects(db.asUser('u-coo', (svc, u) => svc.finance.desk(u)));
    const saved = (await rowOf('fin-pwvsb')).payments.find((x: { id: string }) => x.id === p.id);
    assert.equal(saved.status, 'approved');
    assert.deepEqual(saved.steps.map((s: { byId: string }) => s.byId), ['u-fin-t1-de1', 'u-fin-t1-dep', 'u-coo']);
  });

  it('saves FD settings and an automatic bank reconciliation through the restricted login', async () => {
    await assert.rejects(db.asUser('u-fin-t2-lead', (svc, u) => svc.finance.setSettings(u, { values: { approvalExpiryDays: 20 }, comment: 'x' })), /Finance Director or the CEO/);
    await db.asUser('u-fd', (svc, u) => svc.finance.setSettings(u, { values: { approvalExpiryDays: 20 }, comment: 'Finance meeting.' }));
    // A Team 2 leader reads the group settings kept on PWVSB's row.
    const v = await db.asUser('u-fin-t2-lead', (svc, u) => svc.finance.settingsView(u));
    assert.equal(v.values.approvalExpiryDays, 20);
    const f = await rowOf('fin-pwvsb');
    const bankId = f.banks[1]?.id ?? f.banks[0].id;
    const period = await db.asUser('u-fd', async (svc) => svc.finance.closePeriod());
    const d = `${period}-05`;
    await db.asUser('u-fin-t1-de1', (svc, u) =>
      svc.financeControls.statementAction(u, 'pwvsb', 'load', { bankId, period, opening: 1000, closing: 900, csv: `${d},IBG PV-API-9,REF1,-100.00`, source: 'api.csv' }),
    );
    const out = (await db.asUser('u-fin-t1-dep', (svc, u) =>
      svc.financeControls.bankRecAction(u, 'pwvsb', 'run', { bankId, period, ledgerOpening: 1000, ledgerClosing: 900, ledgerCsv: `${d},PV-API-9,Supplier,0,100.00`, source: 'sql.csv' }),
    )) as { rec: { id: string }; result: { difference: number; matchedLines: number } };
    assert.equal(out.result.difference, 0);
    assert.equal(out.result.matchedLines, 1);
    await db.asUser('u-fin-t1-lead', (svc, u) => svc.financeControls.bankRecAction(u, 'pwvsb', 'review', { recId: out.rec.id, rev: 1, comment: 'Agrees.' }));
    const saved = (await rowOf('fin-pwvsb')).bankRecs.find((x: { id: string }) => x.id === out.rec.id);
    assert.equal(saved.reviewed.byId, 'u-fin-t1-lead');
  });

  it('keeps another team out of the books and the ACT head read-only', async () => {
    const other = (await db.asUser('u-fd', (svc, u) => svc.finance.desk(u))).companies.find((c) => c.team === 2)!;
    await assert.rejects(
      db.asUser('u-fin-t1-de1', (svc, u) => svc.finance.closeStep(u, other.companyId, 'evidence', { bankId: other.banks[0].id, ref: 'rec.pdf' })),
      /not found/,
    );
    await assert.rejects(
      db.asUser('u-audit', (svc, u) => svc.finance.closeStep(u, other.companyId, 'evidence', { bankId: other.banks[0].id, ref: 'rec.pdf' })),
      /Not allowed/,
    );
    const mine = await db.asUser('u-fin-t1-lead', (svc, u) => svc.finance.desk(u));
    assert.ok(mine.companies.length > 0 && mine.companies.every((c) => c.team === 1));
  });

  it('records a bank pack item with the reviewer’s comment', async () => {
    const desk = await db.asUser('u-fin-t1-de1', (svc, u) => svc.finance.desk(u));
    const item = desk.companies.find((c) => c.companyId === 'pwvsb')!.bank[0];
    await db.asUser('u-fin-t1-lead', (svc, u) => svc.setFinPack(u, 'pwvsb', 'bank', item.id, 'prepared'));
    // The team leader could review by role, but not a paper they prepared.
    await assert.rejects(db.asUser('u-fin-t1-lead', (svc, u) => svc.setFinPack(u, 'pwvsb', 'bank', item.id, 'reviewed', 'self')), /Not allowed/);
    await db.asUser('u-fin-t1-dep', (svc, u) => svc.setFinPack(u, 'pwvsb', 'bank', item.id, 'reviewed', 'Agrees to statement.'));
    const saved = (await rowOf('fin-pwvsb')).bank.find((x: { id: string }) => x.id === item.id);
    assert.equal(saved.status, 'reviewed');
    assert.equal(saved.comment, 'Agrees to statement.');
    assert.equal(saved.preparedById, 'u-fin-t1-lead');
  });

  it('saves a payee, its call-back check and a held payment through the restricted login', async () => {
    const added = (await db.asUser('u-fin-t1-de1', (svc, u) =>
      svc.financeControls.payeeAction(u, 'pwvsb', 'add', {
        kind: 'supplier',
        name: 'API Payee Test',
        regNo: 'SSM-API-0001',
        bank: 'Maybank',
        accountLast4: '4321',
        accountName: 'API PAYEE TEST',
        source: 'Supplier form',
      }),
    )) as { id: string };
    // The person who entered the details does not verify them.
    await assert.rejects(
      db.asUser('u-fin-t1-de1', (svc, u) =>
        svc.financeControls.payeeAction(u, 'pwvsb', 'verify', { payeeId: added.id, method: 'callback', contact: 'Ali', numberSource: 'Number on file since 2024', comment: 'ok' }),
      ),
      /Not allowed/,
    );
    await db.asUser('u-fin-t1-dep', (svc, u) =>
      svc.financeControls.payeeAction(u, 'pwvsb', 'verify', { payeeId: added.id, method: 'callback', contact: 'Ali (accounts)', numberSource: 'Number on file since 2024', comment: 'Called back, confirmed.' }),
    );
    const saved = (await rowOf('fin-pwvsb')).payees.find((x: { id: string }) => x.id === added.id);
    assert.equal(saved.status, 'verified');
    assert.equal(saved.verified.byId, 'u-fin-t1-dep');
    // Another team's Finance staff cannot touch this company's payees.
    const other = (await db.asUser('u-fd', (svc, u) => svc.finance.desk(u))).companies.find((c) => c.team === 2)!;
    await assert.rejects(db.asUser('u-fin-t1-de1', (svc, u) => svc.financeControls.view(u, other.companyId)), /not found/);
  });

  it('keeps a lapsed approval returned and logged when the release that found it is refused (fresh connection)', async () => {
    const f = await rowOf('fin-pwvsb');
    const at = (d: string) => () => `${d}T10:00:00+08:00`;
    const p = await db.asUser(
      'u-fin-t1-de1',
      (svc, u) => svc.finance.createPayment(u, 'pwvsb', { payeeId: 'payee-pwvsb-001', purpose: 'API lapse', amount: 31.31, dueOn: '2026-12-01', bankId: f.banks[0].id, sqlRef: 'PI-API-LAPSE', evidence: ['lapse.pdf'] }),
      at('2026-11-02'),
    );
    await db.asUser('u-fin-t1-dep', (svc, u) => svc.finance.paymentStep(u, 'pwvsb', p.id, 'review', { comment: 'Checked.' }), at('2026-11-02'));
    await db.asUser('u-fd', (svc, u) => svc.finance.paymentStep(u, 'pwvsb', p.id, 'approve', { comment: 'OK.' }), at('2026-11-02'));
    const late = at('2026-12-05');
    await assert.rejects(
      db.asUser('u-fin-t1-de2', (svc, u) => svc.finance.paymentStep(u, 'pwvsb', p.id, 'release', { bankRef: 'API-LAPSE-1', accountLast4: '1000', accountName: 'SYARIKAT BEKALAN PEJABAT' }), late),
      /Approval lapsed on 2026-1[12]-\d\d.*back to the preparer/,
    );
    // Read back on a new connection: the release did not happen, the return and its audit entry were committed.
    const saved = (await rowOf('fin-pwvsb')).payments.find((x: { id: string }) => x.id === p.id);
    assert.equal(saved.status, 'returned');
    assert.equal(saved.releasedOn, null);
    assert.equal(saved.steps.at(-1).byId, 'prima:auto');
    const c = new Client({ connectionString: URL });
    await c.connect();
    try {
      const logs = await c.query("SELECT data FROM prima.audit WHERE data->>'action'='finance.payment.lapsed' AND data->>'summary' LIKE $1", [`%${p.id}%`]);
      assert.equal(logs.rowCount, 1);
    } finally {
      await c.end();
    }
    // A second attempt is refused again without logging twice; any other refusal (a cancel without a reason) rolls back.
    await assert.rejects(db.asUser('u-fin-t1-dep', (svc, u) => svc.finance.paymentStep(u, 'pwvsb', p.id, 'return', { comment: 'Lapsed, approve again.' }), late), /back to the preparer/);
    await assert.rejects(db.asUser('u-fin-t1-de1', (svc, u) => svc.finance.paymentStep(u, 'pwvsb', p.id, 'cancel', { comment: 'x' }), late), /reason|10/);
    const again = (await rowOf('fin-pwvsb')).payments.find((x: { id: string }) => x.id === p.id);
    assert.equal(again.steps.length, saved.steps.length);
  });

  it('serves Finance KPIs through the restricted login to the allowed roles only', async () => {
    const v = await db.asUser('u-fd', (svc, u) => svc.financeKpi.view(u, '2026-11'));
    assert.equal(v.scope, 'all');
    assert.equal(v.provisional, true);
    const lead = await db.asUser('u-fin-t1-lead', (svc, u) => svc.financeKpi.view(u));
    assert.equal(lead.scope, 'team 1');
    await assert.rejects(db.asUser('u-fin-t1-de1', (svc, u) => svc.financeKpi.view(u)), /Finance KPIs/);
  });

  it('runs a company head payment request through the chain on the restricted login (Fauzan, 1 Nov 2026)', async () => {
    const r = await db.asUser('u-cm-sasa', (svc, u) =>
      svc.financeRequests.create(u, 'co-sasa', {
        subject: 'operations',
        sector: 'government',
        title: 'Guard salary October (API UAT)',
        purpose: 'Monthly salary for guards at government sites (mock).',
        amount: 1234.5,
        payee: 'Guards payroll (mock)',
        dueOn: '2026-12-01',
        calc: 'Mock calculation for the API test',
        evidence: ['api-uat.pdf'],
      }),
    );
    // Another company's head cannot touch it; the Operations Director is not the head for government sites.
    await assert.rejects(db.asUser('u-cm-arsh', (svc, u) => svc.financeRequests.step(u, 'co-sasa', r.id, 'cancel', { comment: 'Not needed any more' })));
    await assert.rejects(db.asUser('u-opsdir', (svc, u) => svc.financeRequests.step(u, 'co-sasa', r.id, 'head', { comment: 'ok' })));
    await db.asUser('u-ogm', (svc, u) => svc.financeRequests.step(u, 'co-sasa', r.id, 'head', { comment: 'Headcount agrees.' }));
    const team = (await rowOf('fin-co-sasa')).team;
    await db.asUser(`u-fin-t${team}-lead`, (svc, u) => svc.financeRequests.step(u, 'co-sasa', r.id, 'verify', { comment: 'Calculation agrees.' }));
    await db.asUser('u-coo', (svc, u) => svc.financeRequests.step(u, 'co-sasa', r.id, 'approve', { comment: 'Approved.' }));
    const saved = (await rowOf('fin-co-sasa')).requests.find((x: { id: string }) => x.id === r.id);
    assert.equal(saved.status, 'approved');
    assert.deepEqual(
      saved.steps.map((s: { byId: string }) => s.byId),
      ['u-ogm', `u-fin-t${team}-lead`, 'u-coo'],
    );
  });
  it('saves a regular bill, its check, the bill and its payment, and a guarantee, through the restricted login (Fauzan, 2 Nov 2026)', async () => {
    const bankId = (await rowOf('fin-pwvsb')).banks[0].id;
    const r = (await db.asUser('u-fin-t1-de1', (svc, u) =>
      svc.financeControls.regularAction(u, 'pwvsb', 'add', { kind: 'bill', name: 'API electricity', payeeId: 'payee-pwvsb-004', reference: 'TNB API-1', method: 'transfer', bankId, every: 'monthly', dueDay: 20, firstDue: '2026-01-20' }),
    )) as { id: string };
    await assert.rejects(db.asUser('u-fin-t1-de1', (svc, u) => svc.financeControls.regularAction(u, 'pwvsb', 'check', { regularId: r.id, comment: 'Agreed to letter' })), /Not allowed/);
    await db.asUser('u-fin-t1-dep', (svc, u) => svc.financeControls.regularAction(u, 'pwvsb', 'check', { regularId: r.id, comment: 'Agreed to the TNB letter' }));
    const v = (await db.asUser('u-fin-t1-lead', (svc, u) => svc.financeControls.view(u, 'pwvsb'))) as { regular: { id: string; next: { period: string }[] }[]; hostel: unknown[] };
    const period = v.regular.find((x) => x.id === r.id)!.next.at(-1)!.period;
    assert.ok(Array.isArray(v.hostel));
    await db.asUser('u-fin-t1-de1', (svc, u) => svc.financeControls.regularAction(u, 'pwvsb', 'bill', { regularId: r.id, period, amount: 640.2, doc: 'TNB bill.pdf' }));
    const p = (await db.asUser('u-fin-t1-de2', (svc, u) =>
      svc.finance.createPayment(u, 'pwvsb', { regularId: r.id, regularPeriod: period, purpose: 'Electricity', amount: 640.2, dueOn: `${period}-20`, bankId, sqlRef: 'PV-API-TNB', evidence: ['TNB bill.pdf'] }),
    )) as { id: string; payeeId: string };
    assert.equal(p.payeeId, 'payee-pwvsb-004');
    const row = await rowOf('fin-pwvsb');
    assert.equal(row.regular.find((x: { id: string }) => x.id === r.id).dues.find((d: { period: string }) => d.period === period).paymentId, p.id);
    const g = (await db.asUser('u-fin-t1-de1', (svc, u) =>
      svc.financeControls.guaranteeAction(u, 'pwvsb', 'add', { kind: 'BG', issuer: 'API Bank', number: 'BG-API-1', beneficiary: 'API client', purpose: 'API tender', amount: 10000, collateral: 2000, bankId, issuedOn: '2026-01-01', expiresOn: '2027-01-01', doc: 'BG letter.pdf' }),
    )) as { id: string };
    await db.asUser('u-fin-t1-dep', (svc, u) => svc.financeControls.guaranteeAction(u, 'pwvsb', 'check', { guaranteeId: g.id, comment: 'Agreed to the bank letter' }));
    assert.equal((await rowOf('fin-pwvsb')).guarantees.find((x: { id: string }) => x.id === g.id).status, 'active');
  });
  it('saves a staff member’s own zakat choice through the restricted login, and nobody else’s (Fauzan, 2 Nov 2026)', async () => {
    await db.asUser('u-ae-arsh', (svc, u) => svc.setMyZakat(u, { body: 'Zakat Kedah', percent: 2.5 }));
    const v = (await db.asUser('u-ae-arsh', (svc, u) => svc.myZakat(u))) as { choice: { body: string; percent: number } | null };
    assert.deepEqual([v.choice?.body, v.choice?.percent], ['Zakat Kedah', 2.5]);
    await assert.rejects(db.asUser('u-guard-sasa-1', (svc, u) => svc.setMyZakat(u, { body: 'Zakat Kedah', percent: 2.5 })));
  });
  it('keeps EPF and PERKESO tables and employer numbers through the restricted login, used only once checked (Fauzan, 2 Nov 2026)', async () => {
    const before = (await db.asUser('u-pwvsb-hr', (svc, u) => svc.statTables(u))) as { inForce: { id: string; version: string }[]; canLoad: boolean };
    assert.equal(before.canLoad, true);
    assert.equal(before.inForce.find((t) => t.id === 'EPF-A')?.version, 'built-in');
    await db.asUser('u-pwvsb-hr', (svc, u) => svc.loadStatTable(u, { id: 'EIS', from: '2027-01', source: 'PERKESO EIS notice (API mock)', doc: 'eis-api.pdf', rows: '30\t0.05\t0.05\n6000\t12.00\t12.00' }));
    await assert.rejects(db.asUser('u-pwvsb-hr', (svc, u) => svc.checkStatTable(u, { id: 'EIS', version: 'v2', decision: 'check', comment: 'Self check' })));
    await db.asUser('u-fd', (svc, u) => svc.checkStatTable(u, { id: 'EIS', version: 'v2', decision: 'check', comment: 'Against the PDF (API mock)' }));
    const saved = (await rowOf('fin-pwvsb')).statutoryTables;
    assert.deepEqual(saved.map((t: { id: string; version: string; status: string }) => `${t.id} ${t.version} ${t.status}`), ['EIS v2 checked']);
    const after = (await db.asUser('u-cos', (svc, u) => svc.statTables(u, '2027-01'))) as { inForce: { id: string; version: string }[] };
    assert.equal(after.inForce.find((t) => t.id === 'EIS')?.version, 'v2');
    await db.asUser('u-fin-t1-lead', (svc, u) => svc.setEmployerNos(u, 'pwvsb', { epf: '12345678', socso: 'E1234567890X', lhdnE: 'E 9876543210', hrd: null }));
    assert.equal((await rowOf('fin-pwvsb')).employerNos.epf, '12345678');
    await assert.rejects(db.asUser('u-guard-sasa-1', (svc, u) => svc.setEmployerNos(u, 'pwvsb', { epf: '12345678' })));
  });
  it('prepares regular payments due within 7 days and approves them together through the restricted login (A3, A4)', async () => {
    const f = await rowOf('fin-pwvsb');
    const bankId = f.banks[0].id;
    const r = (await db.asUser('u-fin-t1-de1', (svc, u) =>
      svc.financeControls.regularAction(u, 'pwvsb', 'add', { kind: 'rent', name: 'API office rent', payeeId: 'payee-pwvsb-001', reference: 'API-RENT-1', method: 'transfer', bankId, every: 'monthly', dueDay: 3, firstDue: '2026-11-03', amount: 2500 }),
    )) as { id: string };
    await db.asUser('u-fin-t1-dep', (svc, u) => svc.financeControls.regularAction(u, 'pwvsb', 'check', { regularId: r.id, comment: 'Agreed to the tenancy (API mock)' }));
    const out = (await db.asUser('u-fin-t1-de2', (svc, u) => svc.financeControls.regularAction(u, 'pwvsb', 'prepareDue', {}))) as { prepared: { id: string; regularId: string }[] };
    const mine = out.prepared.filter((p) => p.regularId === r.id);
    assert.equal(mine.length, 1);
    await db.asUser('u-fin-t1-dep', (svc, u) => svc.finance.paymentStep(u, 'pwvsb', mine[0].id, 'review', { comment: 'Agreed to the tenancy' }));
    const b = (await db.asUser('u-fd', (svc, u) => svc.financeControls.regularAction(u, 'pwvsb', 'approveBatch', { paymentIds: [mine[0].id], comment: 'Rent agreed to the tenancy' }))) as { approved: string[] };
    assert.deepEqual(b.approved, [mine[0].id]);
    assert.equal((await rowOf('fin-pwvsb')).payments.find((x: { id: string }) => x.id === mine[0].id).status, 'approved');
    const today = (await db.asUser('u-fin-t1-de2', (svc, u) => svc.financeToday(u))) as unknown[];
    assert.ok(Array.isArray(today));
  });
  it('keeps bank mandates, petty cash and the custodian’s own vouchers through the restricted login (Fauzan, 2 Nov 2026)', async () => {
    const f = await rowOf('fin-pwvsb');
    const bankId = f.banks[0].id;
    const m = (await db.asUser('u-fin-t1-de1', (svc, u) =>
      svc.financeControls.mandateAction(u, 'pwvsb', 'add', { bankId, rule: 'any_one', people: [{ userId: 'u-fin-t1-de2', role: 'portal_approver' }], docs: ['API mandate.pdf'] }),
    )) as { id: string };
    await assert.rejects(db.asUser('u-fin-t1-de1', (svc, u) => svc.financeControls.mandateAction(u, 'pwvsb', 'check', { mandateId: m.id, comment: 'Self check here' })), /Not allowed/);
    await db.asUser('u-fin-t1-dep', (svc, u) => svc.financeControls.mandateAction(u, 'pwvsb', 'check', { mandateId: m.id, comment: 'Agreed to the API bank letter' }));
    assert.equal((await rowOf('fin-pwvsb')).mandates.find((x: { id: string }) => x.id === m.id).status, 'active');
    const pc = (await db.asUser('u-fin-t1-de1', (svc, u) =>
      svc.financeControls.pettyAction(u, 'pwvsb', 'add', { office: 'API office', custodianId: 'u-pwvsb-hr', payeeId: 'payee-pwvsb-004', bankId, float: 300 }),
    )) as { id: string };
    await db.asUser('u-fin-t1-dep', (svc, u) => svc.financeControls.pettyAction(u, 'pwvsb', 'check', { pettyId: pc.id, comment: 'API float form' }));
    // The custodian is outside Finance: records a voucher and sees their own float, nothing else.
    await db.asUser('u-pwvsb-hr', (svc, u) => svc.financeControls.pettyAction(u, 'pwvsb', 'voucher', { pettyId: pc.id, amount: 45.5, purpose: 'API courier', receipt: 'api-receipt.jpg' }));
    const mine = (await db.asUser('u-pwvsb-hr', (svc, u) => svc.financeControls.cashMine(u))) as { petty: { id: string; expected: number }[] }[];
    assert.equal(mine.flatMap((x) => x.petty).find((x) => x.id === pc.id)?.expected, 254.5);
    await assert.rejects(db.asUser('u-ae-arsh', (svc, u) => svc.financeControls.pettyAction(u, 'pwvsb', 'voucher', { pettyId: pc.id, amount: 10, purpose: 'Not mine', receipt: 'x.jpg' })));
    assert.ok(Array.isArray(await db.asUser('u-pwvsb-hr', (svc, u) => svc.financeControls.advancesForHr(u))));
  });
  it('keeps a government claim found on the bank statement and a checked money-in allocation through the restricted login (Fauzan, 2 Nov 2026)', async () => {
    const f = await rowOf('fin-pwvsb');
    const bankId = f.banks[1]?.id ?? f.banks[0].id;
    const period = await db.asUser('u-fin-t1-de1', async (svc) => svc.finance.closePeriod());
    const c = (await db.asUser('u-fin-t1-de1', (svc, u) =>
      svc.financeControls.govtAction(u, 'pwvsb', 'add', { agency: 'API mock agency', invoiceNo: 'IV-API-GOV-1', amount: 4321.09, claimRef: 'IGFMAS-API-1', submittedOn: `${period}-02` }),
    )) as { id: string };
    const csv = [`${period}-12,IBG CREDIT IV-API-GOV-1,X1,4321.09`, `${period}-13,CASH DEPOSIT,,250.00`].join('\n');
    await db.asUser('u-fin-t1-lead', (svc, u) => svc.financeControls.statementAction(u, 'pwvsb', 'load', { bankId, period, opening: 100, closing: 4671.09, csv, source: 'api-govt.csv' }));
    const row = await rowOf('fin-pwvsb');
    assert.equal(row.govtClaims.find((x: { id: string }) => x.id === c.id).status, 'paid');
    const st = row.statements.find((x: { bankId: string; period: string }) => x.bankId === bankId && x.period === period);
    const cash = st.lines.find((l: { amount: number }) => l.amount === 250);
    await db.asUser('u-fin-t1-de1', (svc, u) => svc.financeControls.moneyInAction(u, 'pwvsb', 'allocate', { statementId: st.id, lineId: cash.id, to: 'invoice', ref: 'IV-API-77', payer: 'API mock client' }));
    await assert.rejects(db.asUser('u-fin-t1-de1', (svc, u) => svc.financeControls.moneyInAction(u, 'pwvsb', 'check', { statementId: st.id, lineId: cash.id, comment: 'Self' })));
    await db.asUser('u-fin-t1-dep', (svc, u) => svc.financeControls.moneyInAction(u, 'pwvsb', 'check', { statementId: st.id, lineId: cash.id, comment: 'Deposit slip seen (API mock)' }));
    const line = (await rowOf('fin-pwvsb')).statements.find((x: { id: string }) => x.id === st.id).lines.find((l: { id: string }) => l.id === cash.id);
    assert.equal(line.match.checked.byId, 'u-fin-t1-dep');
  });

  it('saves a daily cash list: Finance lists, the FD approves, the COO counts and pays through the restricted login', async () => {
    const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); // Malaysia time
    const to = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
    const v = await db.asUser('u-fin-t1-de1', (svc, u) => svc.financeControls.view(u, 'pwvsb'));
    const bankId = v.statements[0].bank.id;
    const l = (await db.asUser('u-fin-t1-de1', (svc, u) =>
      svc.financeControls.dailyCashAction(u, 'pwvsb', 'add', { period: 'week', from: day, to, bankId, purpose: 'Casual workers paid daily in cash (API mock)', people: [{ name: 'Mock Worker', idLast4: '4321', work: 'Mock site', dailyRate: 80 }] }),
    )) as { id: string; total: number; people: { id: string }[] };
    await db.asUser('u-fin-t1-de1', (svc, u) => svc.financeControls.dailyCashAction(u, 'pwvsb', 'submit', { listId: l.id }));
    await assert.rejects(db.asUser('u-fauzan', (svc, u) => svc.financeControls.dailyCashAction(u, 'pwvsb', 'approve', { listId: l.id, comment: 'ok' })), /only the Finance Director/);
    await db.asUser('u-fd', (svc, u) => svc.financeControls.dailyCashAction(u, 'pwvsb', 'approve', { listId: l.id, comment: 'Approved (API mock).' }));
    await db.asUser('u-fin-t1-de1', (svc, u) => svc.financeControls.dailyCashAction(u, 'pwvsb', 'withdraw', { listId: l.id, on: today, amount: l.total, ref: 'CHQ API-1' }));
    await db.asUser('u-fin-t1-de1', (svc, u) => svc.financeControls.dailyCashAction(u, 'pwvsb', 'handover', { listId: l.id, toId: 'u-coo', amount: l.total }));
    await db.asUser('u-coo', (svc, u) => svc.financeControls.dailyCashAction(u, 'pwvsb', 'received', { listId: l.id, handoverId: 'h1', counted: l.total }));
    await db.asUser('u-coo', (svc, u) => svc.financeControls.dailyCashAction(u, 'pwvsb', 'pay', { listId: l.id, personId: l.people[0].id, day, idLast4: '4321', proof: 'Pay sheet API-1' }));
    await assert.rejects(db.asUser('u-coo', (svc, u) => svc.financeControls.dailyCashAction(u, 'pwvsb', 'withdraw', { listId: l.id, on: day, amount: 1, ref: 'x' })));
    const saved = (await rowOf('fin-pwvsb')).dailyCash.find((x: { id: string }) => x.id === l.id);
    assert.equal(saved.payouts.length, 1);
    assert.equal(saved.payouts[0].sign.byId, 'u-coo');
    assert.equal(saved.approved.byId, 'u-fd');
  });

  it('keeps both sides of an intercompany balance on the group row through the restricted login, and a 13-week forecast line', async () => {
    const period = await db.asUser('u-fd', async (svc) => svc.finance.closePeriod());
    // Team 2 records co-arsh's side; team 1 records PWVSB's side. Both land on PWVSB's row.
    await db.asUser('u-fin-t2-lead', (svc, u) => svc.financeControls.icAction(u, 'co-arsh', 'record', { period, withId: 'pwvsb', kind: 'loan', balance: -20000, sqlRef: 'IC-PWVSB LOAN (API mock)' }));
    await assert.rejects(db.asUser('u-fin-t2-lead', (svc, u) => svc.financeControls.icAction(u, 'co-09', 'record', { period, withId: 'pwvsb', kind: 'loan', balance: -1, sqlRef: 'x' })));
    await db.asUser('u-fin-t1-de1', (svc, u) => svc.financeControls.icAction(u, 'pwvsb', 'record', { period, withId: 'co-arsh', kind: 'loan', balance: 20000, sqlRef: 'IC-ARSH LOAN (API mock)' }));
    const v = await db.asUser('u-fin-t2-lead', (svc, u) => svc.financeControls.view(u, 'co-arsh'));
    const pair = v.intercompany.pairs.find((x) => x.period === period && x.withId === 'pwvsb' && x.kind === 'loan')!;
    assert.equal(pair.status, 'agreed');
    assert.equal((await rowOf('fin-pwvsb')).intercompany.length >= 2, true);
    await db.asUser('u-fin-t1-de1', (svc, u) => svc.financeControls.cash13Action(u, 'pwvsb', 'add', { direction: 'in', on: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), amount: 1000, label: 'Mock collection (API)' }));
    assert.equal((await rowOf('fin-pwvsb')).cash13.length, 1);
  });
  it('serves the monthly pack and the dashboard through the restricted login, only for companies the person sees (suggestions 25, 27)', async () => {
    const p = await db.asUser('u-fin-t1-de1', (svc, u) => svc.financeControls.pack(u, 'co-09'));
    assert.equal(p.mayReview, false);
    await assert.rejects(db.asUser('u-fin-t2-lead', (svc, u) => svc.financeControls.pack(u, 'co-09')));
    const mine = await db.asUser('u-fin-t1-de1', (svc, u) => svc.financeControls.dashboard(u));
    assert.equal(mine.rows.every((r) => ['pwvsb', 'co-09', 'co-16', 'co-23', 'co-30', 'co-37'].includes(r.companyId)), true);
    const all = await db.asUser('u-fd', (svc, u) => svc.financeControls.dashboard(u));
    assert.equal(all.rows.length > mine.rows.length, true);
  });
  it('records a hostel bill payment in Finance through the restricted login, and FWM sees it paid with the record (Fauzan, 2 Nov 2026)', async () => {
    const c = new Client({ connectionString: URL });
    await c.connect();
    const bill = (await c.query("SELECT data FROM prima.hostel_bills WHERE data->>'status' = 'coo_approved' LIMIT 1")).rows[0]?.data;
    const team = (await c.query('SELECT data FROM prima.fin_status WHERE company_id=$1', [bill.companyId])).rows[0].data;
    await c.end();
    const lead = `u-fin-t${team.team}-lead`;
    const on = bill.cooApproval.at.slice(0, 10);
    await db.asUser(lead, (svc, u) => svc.financeControls.hostelAction(u, bill.companyId, 'paid', { billId: bill.id, bankId: team.banks[0].id, on, ref: 'IBG-API-MOCK-1' }));
    const seen = await db.asUser('u-fwm-ex1', async (svc, u) => (await svc.hostelBoard(u)).hostels.flatMap((h) => h.bills).find((b) => b.bill.id === bill.id)!);
    assert.equal(seen.bill.status, 'paid');
    assert.equal(seen.bill.financePaid?.ref, 'IBG-API-MOCK-1');
    assert.equal(seen.waitingOn, 'Paid, recorded by Finance');
  });
  it('keeps a client deposit through the restricted login and checks it by someone else (suggestion 3)', async () => {
    const d = (await db.asUser('u-fin-t1-de1', (svc, u) => svc.financeControls.depositAction(u, 'co-09', 'add', { kind: 'retention', client: 'Mock Client Bhd', amount: 5000, heldSince: '2026-01-01', doc: 'Clause 7 (mock)' }))) as { id: string };
    await assert.rejects(db.asUser('u-fin-t1-de1', (svc, u) => svc.financeControls.depositAction(u, 'co-09', 'check', { depositId: d.id, comment: 'Checked to clause 7' })));
    await db.asUser('u-fin-t1-dep', (svc, u) => svc.financeControls.depositAction(u, 'co-09', 'check', { depositId: d.id, comment: 'Checked to clause 7' }));
    assert.equal((await rowOf('fin-co-09')).clientDeposits[0].status, 'held');
    await assert.rejects(db.asUser('u-fin-t2-lead', (svc, u) => svc.financeControls.depositAction(u, 'co-09', 'add', { kind: 'deposit', client: 'X', amount: 1, heldSince: '2026-01-01', doc: 'x x x' })));
  });
  it('keeps withholding tax and auditor requests through the restricted login; the payment to LHDN is checked by someone else (suggestions 18, 23)', async () => {
    const w = (await db.asUser('u-fin-t1-de1', (svc, u) => svc.financeControls.whtAction(u, 'co-09', 'add', { type: 'royalty', payee: 'Mock Licensor Ltd', country: 'United Kingdom', gross: 5000, paidOn: '2026-10-01' }))) as { id: string; tax: number };
    assert.equal(w.tax, 500);
    await db.asUser('u-fin-t1-de1', (svc, u) => svc.financeControls.whtAction(u, 'co-09', 'remit', { whtId: w.id, on: '2026-10-20', receipt: 'MOCK-RCPT-1', amount: 500 }));
    await assert.rejects(db.asUser('u-fin-t1-de1', (svc, u) => svc.financeControls.whtAction(u, 'co-09', 'check', { whtId: w.id, comment: 'Receipt and rate checked' })));
    await db.asUser('u-fin-t1-dep', (svc, u) => svc.financeControls.whtAction(u, 'co-09', 'check', { whtId: w.id, comment: 'Receipt and rate checked' }));
    await db.asUser('u-fin-t1-dep', (svc, u) => svc.financeControls.auditAction(u, 'co-09', 'add', { year: 2025, item: 'Bank confirmations\nLoan agreements', ownerId: 'u-fin-t1-de1' }));
    const row = await rowOf('fin-co-09');
    assert.ok(row.wht[0].checked);
    assert.equal(row.auditRequests.length, 2);
    await assert.rejects(db.asUser('u-fin-t2-lead', (svc, u) => svc.financeControls.whtAction(u, 'co-09', 'add', { type: 'royalty', payee: 'X', country: 'UK', gross: 1, paidOn: '2026-10-01' })));
  });
  it('pays a matched Procurement purchase and warns Operations about a client over its credit limit, through the restricted logins (suggestions 4, 10)', async () => {
    const c = new Client({ connectionString: URL });
    await c.connect();
    const payee = {
      id: 'payee-sasa-up',
      name: 'Uniform Pro Supplies Sdn Bhd (mock)',
      kind: 'supplier',
      regNo: 'mock',
      bank: 'Maybank',
      accountLast4: '7889',
      accountName: 'UNIFORM PRO SUPPLIES',
      status: 'verified',
      entered: { by: 'Finance Deputy 1', byId: 'u-fin-t1-dep', at: '2026-09-23T22:00:00+08:00', comment: 'mock' },
      verified: { by: 'Finance Director', byId: 'u-fd', at: '2026-09-24T08:00:00+08:00', comment: 'Confirmed by phone.', method: 'callback', contact: 'mock', numberSource: 'mock' },
      history: [],
    };
    await c.query(`UPDATE prima.fin_status SET data = jsonb_set(data, '{payees}', $1::jsonb) WHERE id='fin-co-sasa'`, [JSON.stringify([payee])]);
    await c.end();
    const bankId = (await rowOf('fin-co-sasa')).banks[0].id;
    const p = (await db.asUser('u-fin-t4-lead', (svc, u) =>
      svc.finance.createPayment(u, 'co-sasa', { payeeId: payee.id, purpose: 'Uniforms', amount: 2800, dueOn: '2026-11-10', bankId, sqlRef: 'PI-API-1', purchaseId: 'pr-co-sasa-6' }),
    )) as { id: string; needs: string };
    assert.equal(p.needs, 'coo');
    const board = await db.asUser('u-fd', (svc, u) => svc.purBoard(u));
    assert.equal(board.requests.find((r) => r.req.id === 'pr-co-sasa-6')!.paid!.paymentId, p.id);
    await db.asUser('u-fd', (svc, u) => svc.financeControls.creditAction(u, 'co-sasa', 'limit', { clientAccountId: 'cl-st-sasa-002', limit: 1000, comment: 'Mock limit for the test' }));
    await db.asUser('u-fin-t4-lead', (svc, u) => svc.financeControls.creditAction(u, 'co-sasa', 'balance', { clientAccountId: 'cl-st-sasa-002', owed: 5000, oldestUnpaidOn: '2026-10-01' }));
    const post = { siteId: 'st-sasa-002', name: 'Gate API (mock)', shiftStructure: 'A', guardsPerShift: 1 };
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.saveRecord(u, 'post', null, 'co-sasa', post)), /Finance warning/);
    await db.asUser('u-cm-sasa', (svc, u) => svc.saveRecord(u, 'post', null, 'co-sasa', { ...post, creditReason: 'Variation order signed by the client (mock)' }));
    assert.equal((await rowOf('fin-co-sasa')).creditOverrides.length, 1);
  });
});
