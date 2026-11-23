// Shared login list on PostgreSQL (Fauzan, 23 Nov 2026). Before module shared-logins-v1 nothing works; after it, the
// database itself keeps the walls: who reads a row, who adds one, that the owner only records a password change, and
// that no row may carry a password field. Synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { myt } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const NOW = myt('2026-11-23', '09:00');

async function admin(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

const ssm = { system: 'SSM e-Info (synthetic)', url: 'https://portal.example.test/login', companyId: 'co-sasa', place: 'microsoft_tile', ownerId: 'u-cm-sasa', backupId: 'u-ae-sasa', userIds: ['u-pwvsb-hr'], lastChanged: '2026-11-01' };
const raw = (id: string, fn: (store: any) => Promise<unknown>) => db.asUser(id, (svc) => fn((svc as any).store), () => NOW);
let db: Db;

describe('Shared login list (PostgreSQL)', () => {
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('says it is not installed before the module, and Home stays quiet', async () => {
    await assert.rejects(db.asUser('u-it-lead', (svc, u) => svc.sharedLogins.board(u), () => NOW), /shared-logins-v1/);
    assert.deepEqual(await db.asUser('u-cm-sasa', (svc, u) => svc.sharedLogins.homeItems(u), () => NOW), []);
  });

  it('IT adds a login; the row rule shows it only to those who may see it', async () => {
    // Company names for IT come from the Accounts and Access module, which is installed first.
    await admin(readFileSync(resolve(__dirname, '../../../../db/modules/accounts-access-v1.sql'), 'utf8'));
    await admin(readFileSync(resolve(__dirname, '../../../../db/modules/shared-logins-v1.sql'), 'utf8'));
    const r = await db.asUser('u-it-lead', (svc, u) => svc.sharedLogins.save(u, ssm), () => NOW);
    const ids = async (id: string) => ((await raw(id, (s) => s.list('sharedLogins', {}))) as { id: string }[]).map((x) => x.id);
    for (const id of ['u-it-lead', 'u-cm-sasa', 'u-ae-sasa', 'u-pwvsb-hr', 'u-fauzan', 'u-cos']) assert.deepEqual(await ids(id), [r.id], id);
    const others = (await admin(`SELECT id FROM prima.users WHERE data->>'role' = 'company_manager' AND NOT (data->'companyIds' ? 'co-sasa') LIMIT 1`)).rows[0].id;
    assert.deepEqual(await ids(others), []);
    const board = await db.asUser('u-cm-sasa', (svc, u) => svc.sharedLogins.board(u), () => NOW);
    assert.equal(board.rows[0]!.state, 'ok');
    assert.equal(board.rows[0]!.companyName !== null, true);
    // The audit entry carries no company, so IT (who sees no company) can write it.
    const a = (await admin(`SELECT company_id FROM prima.audit WHERE data->>'action' = 'shared_login.added'`)).rows;
    assert.deepEqual(a, [{ company_id: null }]);
  });

  it('the database refuses a password field, a row added by anyone but IT or the CEO, and a moved row', async () => {
    const row = (await admin('SELECT data FROM prima.shared_logins LIMIT 1')).rows[0].data;
    await assert.rejects(raw('u-it-lead', (s) => s.insert('sharedLogins', { ...row, id: 'slg-x1', system: 'X (synthetic)', password: 'not-a-real-secret' })), /check constraint/);
    await assert.rejects(raw('u-cm-sasa', (s) => s.insert('sharedLogins', { ...row, id: 'slg-x2', system: 'Y (synthetic)' })), /row-level security/);
    await assert.rejects(raw('u-pwvsb-hr', (s) => s.insert('sharedLogins', { ...row, id: 'slg-x3', system: 'Z (synthetic)' })), /row-level security/);
    await assert.rejects(raw('u-it-lead', (s) => s.update('sharedLogins', row.id, { department: 'finance' })), /stays with its company/);
  });

  it('the owner records a password change and nothing else; a plain user cannot write', async () => {
    const id = (await admin('SELECT id FROM prima.shared_logins LIMIT 1')).rows[0].id;
    await assert.rejects(raw('u-cm-sasa', (s) => s.update('sharedLogins', id, { system: 'Renamed by owner' })), /only record a password change/);
    await assert.rejects(raw('u-cm-sasa', (s) => s.update('sharedLogins', id, { people: ['u-cm-sasa', 'u-ae-sasa', 'u-pwvsb-hr', 'u-coo'] })), /adds people/);
    // A user on the row who is neither owner nor backup: the update touches no row.
    await assert.rejects(raw('u-pwvsb-hr', (s) => s.update('sharedLogins', id, { lastChanged: '2026-11-23' })));
    const done = await db.asUser('u-cm-sasa', (svc, u) => svc.sharedLogins.recordChange(u, { id, date: '2026-11-23', reason: 'Synthetic 90-day change' }), () => NOW);
    assert.equal(done.lastChanged, '2026-11-23');
    assert.equal((await admin('SELECT data->>\'lastChanged\' AS d FROM prima.shared_logins WHERE id = $1', [id])).rows[0].d, '2026-11-23');
  });

  it('a master row is the CEO only, in the database too', async () => {
    const master = { system: 'Microsoft 365 admin (synthetic)', department: 'ceo_master', place: 'vault', ownerId: 'u-fauzan', backupId: 'u-coo', lastChanged: '2026-11-23' };
    await assert.rejects(db.asUser('u-it-lead', (svc, u) => svc.sharedLogins.save(u, master), () => NOW), /CEO only/);
    const m = await db.asUser('u-fauzan', (svc, u) => svc.sharedLogins.save(u, master), () => NOW);
    for (const id of ['u-coo', 'u-it-lead', 'u-cos']) {
      const seen = (await raw(id, (s) => s.list('sharedLogins', {}))) as { id: string }[];
      assert.equal(seen.some((x) => x.id === m.id), false, id);
    }
    const row = (await admin('SELECT data FROM prima.shared_logins WHERE id = $1', [m.id])).rows[0].data;
    await assert.rejects(raw('u-it-lead', (s) => s.insert('sharedLogins', { ...row, id: 'slg-m2', system: 'Azure owner (synthetic)' })), /row-level security/);
    // The backup named on a master row still cannot change it.
    await assert.rejects(raw('u-coo', (s) => s.update('sharedLogins', m.id, { lastChanged: '2026-11-23' })));
  });

  it('group-wide in the database: central companies, and heads read their own department or company only', async () => {
    const add = (input: Record<string, unknown>) => db.asUser('u-it-lead', (svc, u) => svc.sharedLogins.save(u, { place: 'vault', ownerId: 'u-it-lead', backupId: 'u-it-mgr', lastChanged: '2026-11-20', ...input }), () => NOW);
    const fwm = await add({ system: 'MyIMMs (synthetic)', department: 'fwm' });
    const fin = await add({ system: 'Bank maker (synthetic)', department: 'finance' });
    const gw = await add({ system: 'SSM e-Info Goodwill (synthetic)', companyId: 'goodwill' });
    const st = await add({ system: 'LHDN e-Invoice Sasa Team (synthetic)', companyId: 'sasateam' });
    const ids = async (id: string) => new Set(((await raw(id, (s) => s.list('sharedLogins', {}))) as { id: string }[]).map((x) => x.id));
    const fwmSees = await ids('u-fwm-mgr');
    assert.equal(fwmSees.has(fwm.id), true);
    assert.equal(fwmSees.has(fin.id) || fwmSees.has(gw.id), false);
    const ogm = await ids('u-ogm');
    assert.equal(ogm.has(gw.id), true);
    assert.equal(ogm.has(st.id) || ogm.has(fwm.id), false);
    const od = await ids('u-opsdir');
    assert.equal(od.has(st.id) && !od.has(gw.id), true);
    // A head named in the organisation chart (headOf): the Head of Transport reads Transport and its company only.
    const tr = await add({ system: 'JPJ portal (synthetic)', department: 'transport' });
    const pgl = await add({ system: 'SSM e-Info PGL (synthetic)', companyId: 'pgl' });
    const trSees = await ids('u-transport');
    assert.equal(trSees.has(tr.id) && trSees.has(pgl.id), true);
    assert.equal(trSees.has(fwm.id) || trSees.has(gw.id), false);
    // The kind of portal is checked in the database too.
    await assert.rejects(admin(`INSERT INTO prima.shared_logins (id, data) VALUES ('x-kind', jsonb_build_object('id','x-kind','status','active','place','vault','kind','Bad Kind!','department','it','people','[]'::jsonb))`), /check/i);
    // A bank row holds the last 4 digits only: a full account number is refused by the database itself.
    await assert.rejects(admin(`INSERT INTO prima.shared_logins (id, data) VALUES ('x-acct', jsonb_build_object('id','x-acct','status','active','place','vault','kind','bank','department','finance','people','[]'::jsonb,'accounts', jsonb_build_array('512345678901')))`), /check/i);
    const bankRow = await add({ system: 'Maybank2E maker PWVSB (synthetic)', kind: 'bank', provider: 'Maybank', accounts: ['1234', '5678'], companyId: 'pwvsb' });
    assert.deepEqual(bankRow.accounts, ['1234', '5678']);
    // An FWM executive is not the head: nothing unless named.
    assert.equal((await ids('u-fwm-ex1')).has(fwm.id), false);
    // IT's pick list holds the central companies even though they are not security companies.
    const board = await db.asUser('u-it-lead', (svc, u) => svc.sharedLogins.board(u), () => NOW);
    for (const id of ['pwvsb', 'merdeka', 'goodwill', 'sasateam', 'pgl']) assert.equal(board.companies.some((c) => c.id === id), true, id);
    assert.equal(board.rows.find((r) => r.id === gw.id)!.companyName, 'Goodwill Empire Sdn Bhd');
  });

  it('IT adds a kind of portal and makes it usual; nobody else may, in the database too', async () => {
    const k = await db.asUser('u-it-lead', (svc, u) => svc.sharedLogins.saveKind(u, { label: 'PTJ land office (synthetic)', usual: 'security' }), () => NOW);
    assert.equal(k.key, 'ptj_land_office_synthetic');
    // A Company Manager reads the kinds but cannot add one: refused by the service and by the database row rule.
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.sharedLogins.saveKind(u, { label: 'Client portal (synthetic)', usual: 'none' }), () => NOW), /IT and the CEO/);
    await assert.rejects(raw('u-cm-sasa', (s) => s.insert('sharedLoginKinds', { id: 'x_cm', label: 'By a manager', usual: 'none', active: true, updatedBy: 'x', updatedAt: NOW })), /row-level security|policy/i);
    const cm = await db.asUser('u-cm-sasa', (svc, u) => svc.sharedLogins.board(u), () => NOW);
    assert.equal(cm.kinds.some((x) => x.key === k.key), true);
    assert.equal(cm.coverage.find((c) => c.key === 'c:co-sasa')!.missing.includes(k.key), true);
    // A login of the new kind fills the gap.
    await db.asUser('u-it-lead', (svc, u) => svc.sharedLogins.save(u, { ...ssm, system: 'PTJ Sasa (synthetic)', kind: k.key }), () => NOW);
    const after = await db.asUser('u-cm-sasa', (svc, u) => svc.sharedLogins.board(u), () => NOW);
    assert.equal(after.coverage.find((c) => c.key === 'c:co-sasa')!.missing.includes(k.key), false);
    await assert.rejects(admin(`INSERT INTO prima.shared_login_kinds (id, data) VALUES ('x_bad', jsonb_build_object('id','x_bad','label','Bad','usual','sometimes','active',true))`), /check/i);
  });
});
