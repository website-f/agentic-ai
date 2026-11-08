// P90 (Fitri, 9 Nov 2026): foreign workers added by hand and imported from any file, and the new import kinds, through
// the real API service on PostgreSQL with the company walls on. Negative authorization: only the people who may add the
// record by hand may import it; a refused row leaves nothing. The route checks its fields and acts as the signed-in
// user. Synthetic seed data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXTRA_IMPORTS, normaliseTable, prepareSheet, smartMatch, toCsv, type AlignField } from '@prima/core';
import { AppController } from '../src/controllers';
import { OrgController, importAiOn } from '../src/org.controller';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
process.env.DEV_TOKEN_SECRET = process.env.DEV_TOKEN_SECRET ?? 'test-secret';
process.env.PRIMA_ORG_LINKS = 'true';
const sql = (f: string) => readFileSync(resolve(process.cwd(), /[\\/]apps[\\/]api$/.test(process.cwd()) ? `../../db/modules/${f}` : `db/modules/${f}`), 'utf8');

/** What the browser does before sending: prepare, match, normalise. */
function browserSide(rows: string[][], kind: 'fwWorker' | 'branch' | 'purSupplier') {
  const fields = EXTRA_IMPORTS[kind].fields as AlignField[];
  const prep = prepareSheet(rows, fields);
  const m = smartMatch(prep.table, fields, { headerRow: prep.headerRow });
  return { csv: toCsv(normaliseTable(prep.table, 0, m.columns, fields)), mapping: m.columns.map((c) => c.field ?? '') };
}

describe('P90 import and add on PostgreSQL', () => {
  let db: Db;
  let today: string;
  before(async () => {
    await resetDb(URL);
    db = new Db();
    await db.pool.query(sql('org-links-v1.sql'));
    today = await db.asUser('u-fwm-ex1', async (svc) => svc.today());
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  const count = async (q: string, p: unknown[] = []) => Number((await db.pool.query(q, p)).rows[0].n);

  it('FWM adds a worker by hand: papers typed, passport kept to the last 4; despatch and a company manager are refused', async () => {
    const input = { companyId: 'co-sasa', branchId: 'br-sasa-1', staffNo: 'P90-HAND-1', name: 'Synthetic Hand Worker', dob: '1991-02-03', hiredOn: today, passportNo: 'PZ9876543', passportExpiresOn: '2032-01-31', permitExpiresOn: '2027-12-31' };
    for (const uid of ['u-fwm-desp', 'u-cm-sasa', 'u-pwvsb-hr', 'u-it-mgr']) await assert.rejects(db.asUser(uid, (svc, u) => svc.addFwWorker(u, input)), uid);
    assert.equal(await count("SELECT count(*) n FROM prima.people WHERE data->>'staffNo'='P90-HAND-1'"), 0);
    const r = await db.asUser('u-fwm-ex1', (svc, u) => svc.addFwWorker(u, input));
    assert.equal(r.papers, 2);
    const row = (await db.pool.query("SELECT data FROM prima.people WHERE data->>'staffNo'='P90-HAND-1'")).rows[0].data;
    assert.equal(row.nationality, 'NP');
    assert.ok(!JSON.stringify(row).includes('PZ9876543'));
    const papers = (await db.pool.query("SELECT data FROM prima.credentials WHERE data->>'personId'=$1", [row.id])).rows.map((x) => x.data);
    assert.deepEqual(papers.map((p) => [p.type, p.source, p.number]).sort(), [
      ['PASSPORT', 'typed', '****6543'],
      ['PLKS_PERMIT', 'typed', ''],
    ]);
    await assert.rejects(db.asUser('u-fwm-ex2', (svc, u) => svc.addFwWorker(u, input)), /already in Prima/);
  });

  it('FWM imports an old list all or none; a bad row stops it; others are refused row by row and at commit', async () => {
    const sheet = [
      ['SENARAI PEKERJA ASING'],
      ['ID Pekerja', 'Nama', 'Cawangan', 'Tkh Lahir', 'Tarikh Masuk', 'No. Pasport', 'Tamat Pasport', 'Tamat PLKS'],
      ['P90-IMP-1', 'Synthetic Imported One', 'Sasa Selangor', '12/03/1988', '01/06/2020', 'PA1112223', '15/04/2031', '30/09/2027'],
      ['P90-IMP-2', 'Synthetic Imported Two', 'Sasa Kuala Lumpur', '23/07/1992', '15/09/2021', 'PA4445556', '01/05/2030', '31/01/2027'],
      ['P90-IMP-3', 'Synthetic Imported Three', 'No Such Branch', '05/11/1985', '01/01/2022', 'PA7778889', '30/06/2029', '30/06/2027'],
    ];
    const b = browserSide(sheet, 'fwWorker');
    const before = await count('SELECT count(*) n FROM prima.people');
    const p = await db.asUser('u-fwm-ex1', (svc, u) => svc.orgImport.preview(u, 'fwWorker', 'co-sasa', b.csv, { mapping: b.mapping }));
    assert.deepEqual(p.rows.map((r) => [r.row, r.ok]), [[2, true], [3, true], [4, false]]);
    assert.match(p.rows[2].problems.join(' '), /No Such Branch/);
    assert.ok(!JSON.stringify(p).includes('PA1112223'));
    assert.equal(await count('SELECT count(*) n FROM prima.people'), before);
    // Committing without the bad row skipped is refused; nothing is kept.
    await assert.rejects(db.asUser('u-fwm-ex1', (svc, u) => svc.orgImport.commit(u, 'fwWorker', 'co-sasa', b.csv, p.fingerprint, { mapping: b.mapping })));
    assert.equal(await count('SELECT count(*) n FROM prima.people'), before);
    // Despatch and a company manager: every row refused, commit refused.
    for (const uid of ['u-fwm-desp', 'u-cm-sasa']) {
      const q = await db.asUser(uid, (svc, u) => svc.orgImport.preview(u, 'fwWorker', 'co-sasa', b.csv, { mapping: b.mapping, skip: [4] }));
      assert.equal(q.canImport, false, uid);
      await assert.rejects(db.asUser(uid, (svc, u) => svc.orgImport.commit(u, 'fwWorker', 'co-sasa', b.csv, q.fingerprint, { mapping: b.mapping, skip: [4] })), uid);
    }
    const ok = await db.asUser('u-fwm-ex1', (svc, u) => svc.orgImport.preview(u, 'fwWorker', 'co-sasa', b.csv, { mapping: b.mapping, skip: [4] }));
    assert.equal(ok.canImport, true);
    const receipt = await db.asUser('u-fwm-ex1', (svc, u) => svc.orgImport.commit(u, 'fwWorker', 'co-sasa', b.csv, ok.fingerprint, { mapping: b.mapping, skip: [4] }));
    assert.equal(receipt.rows, 2);
    assert.deepEqual(receipt.skippedRows, [4]);
    assert.equal(await count('SELECT count(*) n FROM prima.people'), before + 2);
    assert.equal(await count("SELECT count(*) n FROM prima.org_imports WHERE data->>'kind'='fwWorker'"), 1);
    assert.equal(await count("SELECT count(*) n FROM prima.audit WHERE data->>'action'='org.import'"), 1);
    // The same file again: refused.
    await assert.rejects(db.asUser('u-fwm-ex1', (svc, u) => svc.orgImport.commit(u, 'fwWorker', 'co-sasa', b.csv, ok.fingerprint, { mapping: b.mapping, skip: [4] })), /already imported/);
    // On the board with the typed source.
    const board = await db.asUser('u-fwm-ex1', (svc, u) => svc.fwmBoard(u));
    assert.equal(board.workers.find((w) => w.staffNo === 'P90-IMP-1')?.papers.find((x) => x.paper === 'PLKS_PERMIT')?.source, 'typed');
  });

  it('branches and suppliers import only for the people who add them by hand', async () => {
    const br = browserSide([['Nama Cawangan', 'Negeri', 'Model'], ['Sasa P90 North', 'Kedah', 'B']], 'branch');
    const denied = await db.asUser('u-fwm-ex1', (svc, u) => svc.orgImport.preview(u, 'branch', 'co-sasa', br.csv, { mapping: br.mapping }));
    assert.equal(denied.canImport, false);
    const p = await db.asUser('u-cm-sasa', (svc, u) => svc.orgImport.preview(u, 'branch', 'co-sasa', br.csv, { mapping: br.mapping }));
    assert.equal(p.canImport, true, JSON.stringify(p.rows));
    await db.asUser('u-cm-sasa', (svc, u) => svc.orgImport.commit(u, 'branch', 'co-sasa', br.csv, p.fingerprint, { mapping: br.mapping }));
    assert.equal(await count("SELECT count(*) n FROM prima.branches WHERE data->>'name'='Sasa P90 North' AND data->>'status'='proposed'"), 1);
    const sup = browserSide([['Vendor Name', 'ROC No', 'Bank', 'Acc No'], ['Synthetic P90 Supplies', 'SSM-P90-1', 'Synthetic Bank', '1234567890']], 'purSupplier');
    const no = await db.asUser('u-cm-sasa', (svc, u) => svc.orgImport.preview(u, 'purSupplier', 'co-sasa', sup.csv, { mapping: sup.mapping }));
    assert.equal(no.canImport, false);
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.orgImport.commit(u, 'purSupplier', 'co-sasa', sup.csv, no.fingerprint, { mapping: sup.mapping })));
    assert.equal(await count("SELECT count(*) n FROM prima.pur_suppliers WHERE data->>'ssmNo'='SSM-P90-1'"), 0);
  });
});

describe('P90 routes', () => {
  it('the add route checks its fields and binds the signed-in user; client fields cannot set the company of someone else', async () => {
    const calls: unknown[][] = [];
    const svc = { addFwWorker: async (...a: unknown[]) => calls.push(a) };
    const db = { asUser: async (id: string, fn: (s: unknown, u: unknown) => unknown) => fn(svc, { id }) };
    const c = new AppController(db as never);
    const ok = { companyId: 'co-sasa', branchId: 'br-sasa-1', staffNo: 'X1', name: 'Synthetic', dob: '1990-01-01', hiredOn: '2022-01-01' };
    for (const bad of [{ ...ok, dob: '1/1/1990' }, { ...ok, staffNo: 7 }, { ...ok, name: 'x'.repeat(121) }, { ...ok, permitExpiresOn: 'soon' }, { ...ok, companyId: undefined }])
      assert.throws(() => c.fwAddWorker('u-signed-in', bad as never), JSON.stringify(bad));
    assert.equal(calls.length, 0);
    await c.fwAddWorker('u-signed-in', { ...ok, recordedBy: 'someone else', source: 'prima' } as never);
    const [user, input] = calls[0] as [{ id: string }, Record<string, unknown>];
    assert.equal(user.id, 'u-signed-in');
    assert.equal('recordedBy' in input, false);
    assert.equal('source' in input, false);
  });

  it('the AI helper is off unless switched on, and never sends values', async () => {
    assert.equal(importAiOn({}), false);
    assert.equal(importAiOn({ PRIMA_IMPORT_AI_ENABLED: 'true' }), false); // Arisha AI itself is off here
    const c = new OrgController({ asUser: async () => assert.fail('no database call when off') } as never);
    assert.deepEqual(c.importAiState(), { on: false });
    await assert.rejects(c.importAiColumns('u-signed-in', 'fwWorker', { columns: [{ index: 0, header: 'X', shapes: ['PA1234567'] }] }, {} as never), /not switched on/);
  });
});
