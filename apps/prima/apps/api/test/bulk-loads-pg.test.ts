// K8 / N1 (Fauzan, 11 Nov 2026): the bulk load helper on PostgreSQL with the walls on: the repeat-safe module, forced
// row-level security on the load records (the loader and oversight read; nobody writes in someone else's name, a site
// officer not at all; no change or delete), a worker list loaded through FWM's own import, a staff list through HR and
// the HR Director's approval, and many files filed only on people whose file the person keeps. Also the AI request:
// off by default, and the request that would be sent carries no IC number or name (checked on the HTTP body itself).
// Synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { AccessDenied, STAFF_DIRECTORY_TARGET, bulkTargetOf, flagRows, normaliseTable, planColumns, prepareSheet, rankDestinations, smartMatch, staffDirectoryCsv, toCsv } from '@prima/core';
import { askArisha } from '../src/arisha';
import { BulkManagerController, bulkAiFilesPayload, bulkAiOn, bulkAiPlanPayload } from '../src/bulk-manager.controller';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
process.env.DEV_TOKEN_SECRET = process.env.DEV_TOKEN_SECRET ?? 'test-secret';
process.env.PRIMA_ORG_LINKS = 'true';
const sql = (f: string) => readFileSync(resolve(process.cwd(), /[\\/]apps[\\/]api$/.test(process.cwd()) ? `../../db/modules/${f}` : `db/modules/${f}`), 'utf8');

async function admin(q: string, p: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(q, p);
  } finally {
    await c.end();
  }
}
/** A raw statement as the runtime role, signed in as someone (the wall the database itself keeps). */
async function asApp(q: string, p: unknown[], userId: string) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE prima_app');
    await c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.group_user', 'on', true)`, [userId]);
    const r = await c.query(q, p);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}

const FW = [
  ['ID Pekerja', 'Nama', 'Cawangan', 'Tkh Lahir', 'Tarikh Masuk', 'No. Pasport'],
  ['K8-FW-1', 'Synthetic Bulk One', 'Sasa Selangor', '12/03/1988', '01/06/2020', 'PA1112223'],
  ['K8-FW-2', 'Synthetic Bulk Two', 'Sasa Selangor', '23/07/1992', '15/09/2021', 'PA4445556'],
  ['K8-FW-3', '', 'Sasa Selangor', 'soon', '15/09/2021', 'PA7778889'],
];
const STAFF = [
  ['Kumpulan', 'Syarikat', 'Nama Kakitangan', 'Jawatan', 'Emel'],
  ['central_unit', 'UNIT IT', 'Synthetic Staff One', 'EKSEKUTIF IT', 'k8.one@example.test'],
  ['central_unit', 'UNIT KEWANGAN', 'Synthetic Staff Two', 'EKSEKUTIF', 'k8.two@example.test'],
  ['central_unit', 'UNIT AUDIT', '', 'AUDITOR', 'k8.three@example.test'],
];

describe('K8 bulk loads on PostgreSQL', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
    await db.pool.query(sql('org-links-v1.sql'));
    await db.pool.query(sql('staff-directory-v1.sql'));
    await admin(sql('bulk-loads-v1.sql'));
    // Repeat-safe: the office's prima-setup runs it on every start.
    await admin(sql('bulk-loads-v1.sql'));
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('installs one table with forced row-level security; the runtime role cannot change or delete a record', async () => {
    const r = await admin(`SELECT c.relrowsecurity, c.relforcerowsecurity, has_table_privilege('prima_app', c.oid, 'UPDATE') AS upd, has_table_privilege('prima_app', c.oid, 'DELETE') AS del
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'prima' AND c.relname = 'bulk_loads'`);
    assert.deepEqual(r.rows, [{ relrowsecurity: true, relforcerowsecurity: true, upd: false, del: false }]);
  });

  let fwLoad = '';
  it('a worker list goes to Foreign workers after FWM confirms; the left-out rows keep their reasons; others cannot claim it', async () => {
    const fwm = await db.asUser('u-fwm-ex1', async (_s, u) => u);
    const targets = await db.asUser('u-fwm-ex1', (svc, u) => svc.bulkManager.targets(u));
    const prep = prepareSheet(FW, bulkTargetOf('fwWorker').fields);
    assert.equal(rankDestinations(prep.table, targets, 'pekerja.xlsx')[0].kind, 'fwWorker');
    const target = targets.find((t) => t.kind === 'fwWorker')!;
    const plan = planColumns(prep.table, target);
    const mapping = plan.map((c) => c.field ?? c.suggested ?? '');
    const flags = flagRows(prep.table, mapping, target);
    assert.deepEqual(flags.map((f) => f.row), [4]);
    const m = smartMatch(prep.table, target.fields, { headerRow: 0 });
    const csv = toCsv(normaliseTable(prep.table, 0, m.columns.map((c, i) => ({ ...c, field: mapping[i] || null })), target.fields));
    const p = await db.asUser('u-fwm-ex1', (svc, u) => svc.orgImport.preview(u, 'fwWorker', 'co-sasa', csv, { mapping, headerRow: 0, skip: [4] }));
    assert.equal(p.canImport, true, JSON.stringify(p.rows.map((r) => r.problems)));
    const receipt = await db.asUser('u-fwm-ex1', (svc, u) => svc.orgImport.commit(u, 'fwWorker', 'co-sasa', csv, p.fingerprint, { mapping, headerRow: 0, skip: [4] }));
    const input = { via: 'import', receiptId: receipt.id, fileName: 'pekerja.xlsx', rowsInFile: 3, plan: plan.map((c, i) => ({ header: c.header, field: mapping[i] || null })), refused: flags.map((f) => ({ row: f.row, reasons: f.reasons })) };
    await assert.rejects(db.asUser('u-fwm-ex2', (svc, u) => svc.bulkManager.recordData(u, input)), /not one you made/);
    const load = await db.asUser('u-fwm-ex1', (svc, u) => svc.bulkManager.recordData(u, input));
    fwLoad = load.id;
    assert.equal(load.loaded, 2);
    assert.equal(load.loadedBy, fwm.name);
    assert.deepEqual(load.refused.map((r) => r.row), [4]);
    assert.ok(!JSON.stringify((await admin('SELECT data FROM prima.bulk_loads WHERE id=$1', [load.id])).rows[0].data).includes('PA1112223'));
  });

  it('the loader and oversight read a load record; a colleague does not; nobody writes one in someone else’s name', async () => {
    const n = async (uid: string) => (await asApp('SELECT count(*)::int AS n FROM prima.bulk_loads WHERE id=$1', [fwLoad], uid)).rows[0].n;
    assert.equal(await n('u-fwm-ex1'), 1);
    assert.equal(await n('u-audit'), 1);
    assert.equal(await n('u-coo'), 1);
    assert.equal(await n('u-fwm-ex2'), 0);
    assert.equal(await n('u-cm-sasa'), 0);
    const forged = { id: 'bl-forged', kind: 'data', target: 'fwWorker', loadedById: 'u-fwm-ex1', plan: [], refused: [], placed: [] };
    await assert.rejects(asApp('INSERT INTO prima.bulk_loads (id, data) VALUES ($1, $2::jsonb)', ['bl-forged', JSON.stringify(forged)], 'u-fwm-ex2'), /row-level security/);
    // A site officer may not add a record even in their own name.
    const own = { ...forged, id: 'bl-officer', loadedById: 'u-sv-sasa' };
    await assert.rejects(asApp('INSERT INTO prima.bulk_loads (id, data) VALUES ($1, $2::jsonb)', ['bl-officer', JSON.stringify(own)], 'u-sv-sasa'), /row-level security/);
    const upd = await asApp(`UPDATE prima.bulk_loads SET data = data || '{"loaded":0}' WHERE id=$1`, [fwLoad], 'u-fwm-ex1').catch((e) => e);
    assert.ok(upd instanceof Error && /permission denied/.test(upd.message));
    await assert.rejects(db.asUser('u-sv-sasa', (svc, u) => svc.bulkManager.board(u)), (e) => e instanceof AccessDenied);
  });

  it('a staff list goes to the staff directory through HR; the record shows the HR Director’s approval', async () => {
    const prep = prepareSheet(STAFF, STAFF_DIRECTORY_TARGET.fields);
    const plan = planColumns(prep.table, STAFF_DIRECTORY_TARGET);
    const mapping = plan.map((c) => c.field);
    const flags = flagRows(prep.table, mapping, STAFF_DIRECTORY_TARGET);
    assert.deepEqual(flags.map((f) => [f.row, f.reasons]), [[4, ['Name is empty.']]]);
    const text = staffDirectoryCsv(prep.table, mapping, [4]);
    const p = await db.asUser('u-pwvsb-hr', (svc, u) => svc.staffDirectory.preview(u, { text, source: 'k8-staff.csv' }));
    const sent = await db.asUser('u-pwvsb-hr', (svc, u) => svc.staffDirectory.submit(u, { text, source: 'k8-staff.csv', fingerprint: p.fingerprint }));
    const load = await db.asUser('u-pwvsb-hr', (svc, u) =>
      svc.bulkManager.recordData(u, { via: 'staffDirectory', batchId: sent.id, fileName: 'k8-staff.csv', rowsInFile: 3, plan: plan.map((c) => ({ header: c.header, field: c.field })), refused: flags.map((f) => ({ row: f.row, reasons: f.reasons })) }),
    );
    assert.equal(load.loaded, 2);
    await db.asUser('u-cos', (svc, u) => svc.staffDirectory.decide(u, { batchId: sent.id, approve: true, comment: 'Synthetic list checked.' }));
    const seen = (await db.asUser('u-pwvsb-hr', (svc, u) => svc.bulkManager.loads(u))).find((l) => l.id === load.id)!;
    assert.equal(seen.approval?.status, 'approved');
    assert.equal(Number((await admin("SELECT count(*) n FROM prima.staff_directory WHERE data->>'batchId'=$1", [sent.id])).rows[0].n), 2);
  });

  it('files many documents only on people whose file the person keeps', async () => {
    const office = (await admin("SELECT data FROM prima.people WHERE data->>'role'='office' AND data->>'status'<>'left' LIMIT 1")).rows[0].data;
    const pdf = `data:application/pdf;base64,${Buffer.from('%PDF-1.4 synthetic k8').toString('base64')}`;
    const place = await db.asUser('u-pwvsb-hr', (svc, u) => svc.bulkManager.placeFiles(u, [{ name: `${office.staffNo}_kontrak.pdf`, mime: 'application/pdf' }]));
    assert.equal(place.files[0].who.personId, office.id);
    assert.equal(place.files[0].doc.type, 'contract');
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.bulkManager.fileOne(u, { personId: office.id, docType: 'contract', name: 'k.pdf', data: pdf })));
    const filed = await db.asUser('u-pwvsb-hr', (svc, u) => svc.bulkManager.fileOne(u, { personId: office.id, docType: 'contract', name: `${office.staffNo}_kontrak.pdf`, data: pdf }));
    const load = await db.asUser('u-pwvsb-hr', (svc, u) => svc.bulkManager.recordFiles(u, { placed: [{ file: `${office.staffNo}_kontrak.pdf`, personId: office.id, docType: 'contract', docId: filed.docId }], held: [{ file: 'scan9.pdf', reason: 'No name or number.' }] }));
    assert.deepEqual([load.loaded, load.held.length], [1, 1]);
  });
});

describe('K8 AI request', () => {
  it('is off unless switched on, and refused before any database call', async () => {
    assert.equal(bulkAiOn({}), false);
    assert.equal(bulkAiOn({ PRIMA_BULK_AI_ENABLED: 'true' }), false); // Arisha AI itself is off here
    const c = new BulkManagerController({ asUser: async () => assert.fail('no database call when off') } as never);
    await assert.rejects(c.aiPlan('u-pwvsb-hr', { columns: [] }, {} as never), /not switched on/);
    await assert.rejects(c.aiFiles('u-pwvsb-hr', { files: [] }, {} as never), /not switched on/);
  });

  it('the HTTP body sent to Azure OpenAI holds no IC number, name or whole record, even from a changed browser', async () => {
    const bodies: string[] = [];
    const http = (async (_url: string, init: { body: string }) => {
      bodies.push(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{"kind":"staffDirectory","matches":[]}' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const cfg = { endpoint: 'https://synthetic.openai.azure.com', deployment: 'synthetic', apiVersion: '2024-10-21' };
    // A changed browser sends raw values as "samples" and a person's line as the headings.
    const plan = bulkAiPlanPayload(
      {
        fileName: 'Synthetic Person 900101-14-5678.xlsx',
        columns: [
          { index: 0, header: 'Synthetic Person', samples: ['Another Synthetic Name', 'Third Made Up'] },
          { index: 1, header: '900101-14-5678', samples: ['880202-10-1234', '870303014321', '850404-08-5555'] },
          { index: 2, header: 'No KP', samples: ['900101145678'] },
        ],
      },
      [STAFF_DIRECTORY_TARGET, bulkTargetOf('fwWorker')],
    );
    const files = bulkAiFilesPayload({ files: [{ name: 'Synthetic Person_900101-14-5678_sijil.pdf', mime: 'application/pdf' }] });
    for (const input of [plan, files]) await askArisha(cfg, async () => 'synthetic-token', input, http);
    assert.equal(bodies.length, 2);
    for (const body of bodies) {
      for (const secret of ['Synthetic Person', 'Another', 'Third Made', '900101', '5678', '880202', '870303014321', '850404', '900101145678']) assert.ok(!body.includes(secret), `${secret} reached the AI`);
      // The request carries no tools: the AI only suggests.
      assert.ok(!JSON.parse(body).tools, 'no tools offered');
    }
  });
});
