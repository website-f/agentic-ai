// Real-use PDPA registers and insurance register against a real local PostgreSQL (throwaway database, reset here).
// Synthetic seed data only. Proves the PDPA wall, no deletion, the history guards and the "not installed" message.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
process.env.DEV_TOKEN_SECRET = process.env.DEV_TOKEN_SECRET ?? 'test-secret';

let n = 0;
function doc() {
  n += 1;
  return { kind: 'document' as const, name: `Consent ${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF consent ${n} ${Date.now()}`).toString('base64')}` };
}

async function owner<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Runs one statement as the app role with the given department walls. */
async function asApp(walls: string, sql: string, params: unknown[] = []) {
  return owner(async (c) => {
    await c.query('BEGIN');
    try {
      await c.query('SET LOCAL ROLE prima_app');
      await c.query(`SELECT set_config('app.walls', $1, true)`, [walls]);
      const r = await c.query(sql, params);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
  });
}

describe('PDPA register module in PostgreSQL', () => {
  let db: Db;
  before(async () => {
    const ds = await resetDb(URL);
    // Optional module is applied only to this disposable test database, never activated by reset/startup.
    await owner(async c => {
      await c.query(readFileSync(join(__dirname,'../../../../db/modules/pdpa-register-v1.sql'),'utf8'));
      for (const [table,rows] of [['pdpa_register',ds.pdpaRegister],['pdpa_consents',ds.pdpaConsents],['pdpa_settings',ds.pdpaSettings]] as const)
        for (const row of rows) await c.query(`INSERT INTO prima.${table}(id,data) VALUES($1,$2)`,[row.id,row]);
    });
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('shows the register to the PDPA officer and the Operations Director only', async () => {
    const board = await db.asUser('u-pdpa', (svc, u) => svc.pdpaRegisterBoard(u));
    assert.equal(board.role, 'officer');
    assert.ok(board.rows.length >= 4);
    const mon = await db.asUser('u-opsdir', (svc, u) => svc.pdpaRegisterBoard(u));
    assert.equal(mon.role, 'monitor');
    await assert.rejects(db.asUser('u-pwvsb-hr', (svc, u) => svc.pdpaRegisterBoard(u)));
    // Outside the PDPA wall the database itself shows nothing and refuses writes.
    assert.equal((await asApp('', 'SELECT count(*)::int AS n FROM prima.pdpa_register')).rows[0].n, 0);
    assert.equal((await asApp('', 'SELECT count(*)::int AS n FROM prima.pdpa_consents')).rows[0].n, 0);
    await assert.rejects(asApp('', `INSERT INTO prima.pdpa_register (id, data) VALUES ('x', '{"id":"x"}')`), /row-level security/);
    assert.ok((await asApp('pdpa', 'SELECT count(*)::int AS n FROM prima.pdpa_register')).rows[0].n >= 4);
  });

  it('never deletes, keeps retired entries and withdrawn consents unchanged, and allows one live consent per person', async () => {
    await assert.rejects(asApp('pdpa', `DELETE FROM prima.pdpa_register`), /permission denied/);
    await assert.rejects(asApp('pdpa', `DELETE FROM prima.pdpa_consents`), /permission denied/);
    const added = await db.asUser('u-pdpa', (svc, u) =>
      svc.savePdpaRegisterItem(u, null, {
        companyId: null,
        activity: 'Applicant CVs',
        system: 'Prima: Job posts',
        subjects: ['applicant'],
        dataKinds: 'Name, phone, CV',
        sensitive: false,
        purpose: 'Hiring',
        basis: 'CONSENT',
        retentionDays: 180,
        disposal: 'Deleted after 180 days',
        sharedWith: '',
        outsideMalaysia: '',
        ownerDept: 'HR',
        noticeGiven: true,
        dpia: 'not_needed',
      }),
    );
    // An edit through PostgreSQL keeps the company and saves the change.
    const base = (await db.asUser('u-pdpa', (svc, u) => svc.pdpaRegisterBoard(u))).rows.find((r) => r.item.id === added.id)!.item;
    const { id: _i, reviewedOn: _r, reviewedBy: _b, createdBy: _c, createdAt: _a, updatedBy: _u, updatedAt: _t, retired: _x, ...form } = base;
    await db.asUser('u-pdpa', (svc, u) => svc.savePdpaRegisterItem(u, added.id, { ...form, retentionDays: 90 }));
    await assert.rejects(db.asUser('u-pdpa', (svc, u) => svc.savePdpaRegisterItem(u, added.id, { ...form, companyId: 'co-sasa' })), /does not change/);
    const input = { registerId: added.id, subjectName: 'Applicant (mock)', subjectRef: 'APP-1', subjectKind: 'applicant' as const, noticeVersion: 'v1', givenOn: '2026-01-05' };
    // Two officers saving the same person at once: one succeeds, one is refused.
    const both = await Promise.allSettled([
      db.asUser('u-pdpa', (svc, u) => svc.recordPdpaConsent(u, input, [doc()])),
      db.asUser('u-pdpa', (svc, u) => svc.recordPdpaConsent(u, input, [doc()])),
    ]);
    assert.equal(both.filter((r) => r.status === 'fulfilled').length, 1);
    const consent = (both.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ id: string }>).value;
    // The database index refuses a second live consent even if the application check were skipped.
    await assert.rejects(
      asApp('pdpa', `INSERT INTO prima.pdpa_consents (id, data) VALUES ('dup', jsonb_build_object('id','dup','registerId',$1::text,'subjectRef','app-1','withdrawn',null))`, [added.id]),
      /pdpa_consent_live/,
    );
    await db.asUser('u-pdpa', (svc, u) => svc.withdrawPdpaConsent(u, consent.id, '2026-02-01', 'Letter: withdraws'));
    await assert.rejects(asApp('pdpa', `UPDATE prima.pdpa_consents SET data = data || '{"withdrawn":null}' WHERE id = $1`, [consent.id]), /withdrawn consent/);
    await db.asUser('u-pdpa', (svc, u) => svc.pdpaRegisterStep(u, added.id, 'retire', 'Hiring moved to the HR system'));
    await assert.rejects(asApp('pdpa', `UPDATE prima.pdpa_register SET data = data || '{"retired":null}' WHERE id = $1`, [added.id]), /retired register entry/);
  });

  it('renews and pays insurance under the company wall and keeps last year as history', async () => {
    const view = await db.asUser('u-cm-sasa', (svc, u) => svc.insurance(u));
    const unpaid = view.policies.find((r) => r.premium !== 'paid')!;
    await db.asUser('u-cm-sasa', (svc, u) => svc.recordInsurancePremium(u, unpaid.policy.id, { paidOn: view.today, ref: 'PV-PG-1' }));
    await assert.rejects(db.asUser('u-cm-arsh', (svc, u) => svc.recordInsurancePremium(u, unpaid.policy.id, { paidOn: view.today, ref: 'PV-PG-2' })));
    const due = view.policies.find((r) => r.cover.status === 'DUE' && !r.renewedBy)!;
    const start = due.policy.expiresOn;
    const next = await db.asUser('u-cm-sasa', (svc, u) =>
      svc.renewInsurancePolicy(u, due.policy.id, {
        insurer: 'Mock Insurer',
        broker: null,
        policyNo: 'PG-RENEW-1',
        sumInsured: 100_000,
        premium: 1000,
        startsOn: start,
        expiresOn: `${Number(start.slice(0, 4)) + 1}${start.slice(4)}`,
        premiumDueOn: start,
        scheduleRef: null,
      }),
    );
    const after = await db.asUser('u-cm-sasa', (svc, u) => svc.insurance(u));
    assert.equal(after.policies.find((r) => r.policy.id === due.policy.id)!.renewedBy!.id, next.id);
    assert.ok(after.history.some((h) => h.why === 'renewed'));
    const audit = await owner((c) => c.query(`SELECT count(*)::int AS n FROM prima.audit WHERE data->>'action' IN ('insurance.premium','insurance.renew')`));
    assert.ok(audit.rows[0].n >= 2);
  });

  it('keeps the PDPA settings behind the wall, never under 2 years, switched only by the Chief of Staff', async () => {
    await assert.rejects(db.asUser('u-pdpa', (svc, u) => svc.setPdpaSettings(u, { enabled: false }, 'Testing')));
    await db.asUser('u-cos', (svc, u) => svc.setPdpaSettings(u, { enabled: false }, 'Pause for the pilot'));
    await db.asUser('u-pdpa', (svc, u) => svc.setPdpaSettings(u, { keepYears: 3 }, 'Insurer asks for 3 years'));
    const board = await db.asUser('u-opsdir', (svc, u) => svc.pdpaBoard(u));
    assert.equal(board.settings.enabled, false);
    assert.equal(board.settings.keepYears, 3);
    assert.equal(board.settings.history.length, 2);
    // The database itself refuses a keep period under 2 years and hides the row outside the PDPA wall.
    await assert.rejects(asApp('pdpa', `UPDATE prima.pdpa_settings SET data = data || '{"keepYears":1}' WHERE id = 'pdpa'`), /check constraint/);
    assert.equal((await asApp('', 'SELECT count(*)::int AS n FROM prima.pdpa_settings')).rows[0].n, 0);
    await assert.rejects(asApp('pdpa', `DELETE FROM prima.pdpa_settings`), /permission denied/);
    // Two changes at the same moment both land, one after the other, with both in the history.
    await Promise.all([
      db.asUser('u-cos', (svc, u) => svc.setPdpaSettings(u, { enabled: true }, 'Pilot over')),
      db.asUser('u-pdpa', (svc, u) => svc.setPdpaSettings(u, { keepYears: 4 }, 'Four years')),
    ]);
    const both = await db.asUser('u-opsdir', (svc, u) => svc.pdpaBoard(u));
    assert.equal(both.settings.enabled, true);
    assert.equal(both.settings.keepYears, 4);
    assert.equal(both.settings.history.length, 4);
    // The CEO keeps the data register with the PDPA officer, in the database too.
    const ceoEntry = await db.asUser('u-fauzan', (svc, u) =>
      svc.savePdpaRegisterItem(u, null, { companyId: null, activity: 'Board papers (mock)', system: 'Prima: Meetings', subjects: ['staff'], dataKinds: 'Names', sensitive: false, purpose: 'Board meetings', basis: 'LEGAL_DUTY', retentionDays: 2555, disposal: 'Shredded', sharedWith: '', outsideMalaysia: '', ownerDept: 'Director Office', noticeGiven: true, dpia: 'not_needed' }),
    );
    assert.ok(ceoEntry.id);
    const audit = await owner((c) => c.query(`SELECT count(*)::int AS n FROM prima.audit WHERE data->>'action' = 'pdpa.settings'`));
    assert.equal(audit.rows[0].n, 4);
  });

  it('says the register is not installed when the module is missing, instead of showing an empty register', async () => {
    await owner((c) => c.query('DROP TABLE prima.pdpa_consents, prima.pdpa_register, prima.pdpa_settings'));
    try {
      await assert.rejects(db.asUser('u-pdpa', (svc, u) => svc.pdpaRegisterBoard(u)), /not installed in the database yet/);
      // The rest of the PDPA screen keeps working.
      const board = await db.asUser('u-pdpa', (svc, u) => svc.pdpaBoard(u));
      assert.ok(board.cases.length > 0);
      assert.equal(board.settings.installed, false);
      assert.equal(board.settings.keepYears, 2);
      await assert.rejects(db.asUser('u-cos', (svc, u) => svc.setPdpaSettings(u, { enabled: false }, 'Testing')), /not installed/);
      // Adding an entry says so in words too, instead of a server error.
      await assert.rejects(
        db.asUser('u-pdpa', (svc, u) => svc.savePdpaRegisterItem(u, null, { companyId: null, activity: 'Mock entry', system: 'Prima', subjects: ['staff'], dataKinds: 'Names', sensitive: false, purpose: 'Testing', basis: 'CONTRACT', retentionDays: 30, disposal: 'Deleted', sharedWith: '', outsideMalaysia: '', ownerDept: 'IT', noticeGiven: true, dpia: 'not_needed' })),
        /not installed in the database yet/,
      );
    } finally {
      await owner((c) => c.query(readFileSync(join(__dirname, '../../../../db/modules/pdpa-register-v1.sql'), 'utf8')));
    }
  });
});
