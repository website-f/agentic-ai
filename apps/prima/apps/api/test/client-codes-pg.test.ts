// Client requirements and the yearly self-audit against a real local PostgreSQL (Fauzan, 6 Nov 2026, after the IKEA
// IWAY audit): the new tables (proposed module client-codes-v1) sit behind the company wall, the covering OM and ACT keep a site's client code, and only
// the company records its self-audit. Synthetic data only; the test resets the throwaway database.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { selfAuditItems, type User } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

describe('Client requirements and yearly self-audit on PostgreSQL', () => {
  let db: Db;
  let owner: Client;
  before(async () => {
    await resetDb(URL);
    db = new Db();
    owner = new Client({ connectionString: URL });
    await owner.connect();
    // Before the module is installed: the screens say so in words and the company home still opens with no reminder.
    const cm = (await owner.query("SELECT data FROM prima.users WHERE id = 'u-cm-sasa'")).rows[0].data as User;
    const home = await db.asUser('u-cm-sasa', (svc, u) => svc.home(u, cm.companyIds[0]));
    assert.equal(home.todo.some((t) => t.tag === 'Self-audit'), false);
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.selfAuditBoard(u, cm.companyIds[0])), /not installed/);
    // Proposed module, installed here only on the throwaway test database.
    const moduleSql = readFileSync(resolve(__dirname, '../../../../db/modules/client-codes-v1.sql'), 'utf8');
    await owner.query(moduleSql);
    await owner.query(moduleSql); // repeat-safe: a second run changes nothing
  });
  after(async () => {
    await owner.end();
    await db.onModuleDestroy();
  });

  it('the OM switches on IWAY and checks a requirement; ACT checks too; another company sees nothing', async () => {
    const dev = (await owner.query("SELECT data FROM prima.users WHERE id = 'u-dev-sasa-001'")).rows[0].data as User;
    const siteId = dev.siteIds[0];
    const code = await db.asUser('u-om-klang', (svc, u) => svc.saveClientCode(u, siteId, { template: 'IWAY' }));
    await db.asUser('u-om-klang', (svc, u) => svc.checkClientRequirement(u, code.id, { reqCode: 'G5.1', result: 'met', note: 'Attendance records kept in Prima' }));
    await db.asUser('u-audit', (svc, u) => svc.checkClientRequirement(u, code.id, { reqCode: 'G4.4', result: 'not_met', note: 'No grievance poster in Nepali' }));
    const rows = await owner.query('SELECT company_id FROM prima.client_code_checks WHERE data->>\'codeId\' = $1', [code.id]);
    assert.equal(rows.rowCount, 2);
    const b = await db.asUser('u-cm-sasa', (svc, u) => svc.clientCodeBoard(u, siteId));
    assert.equal(b.canKeep, false);
    assert.equal(b.codes[0].counted.met, 1);
    assert.equal(b.codes[0].counted.notMet, 1);
    // Another company's manager is refused, and its database role cannot read the rows.
    await assert.rejects(db.asUser('u-cm-arsh', (svc, u) => svc.clientCodeBoard(u, siteId)));
    await assert.rejects(db.asUser('u-cm-arsh', (svc, u) => svc.checkClientRequirement(u, code.id, { reqCode: 'G5.1', result: 'met', note: 'Attendance records kept in Prima' })));
    // The Operations Director decides the client report for this private site; the OM who keeps the code cannot.
    const site = (await owner.query('SELECT data FROM prima.sites WHERE id = $1', [siteId])).rows[0].data as { sector?: string };
    const decider = (site.sector ?? 'private') === 'private' ? 'u-opsdir' : 'u-ogm';
    await assert.rejects(db.asUser('u-om-klang', (svc, u) => svc.setClientReport(u, code.id, { send: true, how: 'Monthly', reason: 'Client asked for it' })));
    const decided = await db.asUser(decider, (svc, u) => svc.setClientReport(u, code.id, { send: true, how: 'Monthly with the client report', reason: 'IKEA asks for the IWAY status' }));
    assert.equal(decided.clientReport?.send, true);
    await assert.rejects(db.asUser('u-om-johor', (svc, u) => svc.saveClientCode(u, siteId, { template: 'CUSTOM', name: 'Sample code', requirements: [{ code: 'X', text: 'Something' }] })));
  });

  it('only the company records its self-audit, and the reminder goes once it is done', async () => {
    const cm = (await owner.query("SELECT data FROM prima.users WHERE id = 'u-cm-sasa'")).rows[0].data as User;
    const companyId = cm.companyIds[0];
    const lines = selfAuditItems('company').map((it) => ({ key: it.key, result: 'ok' as const }));
    await assert.rejects(db.asUser('u-om-klang', (svc, u) => svc.saveSelfAudit(u, companyId, { scope: 'company', lines })));
    await assert.rejects(db.asUser('u-cm-arsh', (svc, u) => svc.saveSelfAudit(u, companyId, { scope: 'company', lines })));
    const before_ = await db.asUser('u-cm-sasa', (svc, u) => svc.home(u, companyId));
    assert.ok(before_.todo.some((t) => t.tag === 'Self-audit' && t.title.startsWith('Company office')));
    const a = await db.asUser('u-cm-sasa', (svc, u) => svc.saveSelfAudit(u, companyId, { scope: 'company', lines }));
    const row = await owner.query('SELECT company_id FROM prima.self_audits WHERE id = $1', [a.id]);
    assert.equal(row.rows[0].company_id, companyId);
    const after_ = await db.asUser('u-cm-sasa', (svc, u) => svc.home(u, companyId));
    assert.equal(after_.todo.some((t) => t.tag === 'Self-audit' && t.title.startsWith('Company office')), false);
    const watch = await db.asUser('u-audit', (svc, u) => svc.selfAuditBoard(u, companyId));
    assert.equal(watch.canDo, false);
    assert.equal(watch.audits.length, 1);
  });
});
