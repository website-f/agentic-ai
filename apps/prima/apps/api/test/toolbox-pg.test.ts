// Part X on PostgreSQL (company and department toolbox meetings, 14 Nov 2026): the toolbox_recs walls. The company
// office builds and submits; the company manager verifies; Finance records receipts and SULIT items; another company
// reads nothing; SULIT rows are not readable by an admin executive; history is append-only and nothing is deleted.
// Synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { myt, RULES, type ToolboxRec } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const NOW = myt('2026-11-18', '10:00');

async function admin(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}
const mod = (f: string) => readFileSync(resolve(__dirname, `../../../../db/modules/${f}`), 'utf8');

describe('Part X toolbox records (PostgreSQL)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
    await admin(mod('toolbox-v1.sql'));
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('company office, Finance, SULIT and other-company walls, append-only history and no delete', async () => {
    const as = <T>(uid: string, fn: (svc: any, u: any) => Promise<T>) => db.asUser(uid, fn, () => NOW);
    const act = (uid: string, op: string, i: Record<string, unknown>) => as(uid, (svc, u) => svc.toolboxAct(u, op, i));
    const list = async (uid: string) => (await as(uid, (svc) => svc.store.list('toolboxRecs', {}))) as ToolboxRec[];

    const m = (await as('u-cm-sasa', (svc, u) =>
      svc.scheduleMeeting(u, { companyId: null, kind: 'toolbox', title: 'Toolbox (test)', start: myt('2026-11-17', '09:00'), end: myt('2026-11-17', '10:00'), location: 'HQ', attendees: [], agenda: 'Standard', seriesKey: 'co-office:co-sasa' }),
    )) as { id: string };
    await act('u-ae-sasa', 'build', { meetingId: m.id });
    await act('u-ae-sasa', 'line', { scope: 'co:co-sasa', section: 'g', matter: 'Fail surat bank (test)', status: 'baru' });
    const keys = RULES.toolbox.value.agenda.company.map((x) => x.key);
    await act('u-ae-sasa', 'draft', { meetingId: m.id, text: 'Minit toolbox (test), semua seksyen dibincang.', ticks: Object.fromEntries(keys.map((k) => [k, 'nochange'])) });
    await act('u-ae-sasa', 'submit', { meetingId: m.id });
    await act('u-cm-sasa', 'verify', { meetingId: m.id, comment: 'Disahkan (test)' });
    const held = (await admin(`SELECT data->>'status' AS s FROM prima.meetings WHERE id=$1`, [m.id])).rows[0].s;
    assert.equal(held, 'held');

    await act('u-fd', 'personal', { companyId: 'co-sasa', what: 'Pinjaman kenderaan', name: 'Director A (test)', amount: 1200 });
    await act('u-ae-sasa', 'branch', { companyId: 'co-sasa', state: 'Kedah', kdnStatus: 'lulus' });
    const ae = await list('u-ae-sasa');
    assert.ok(ae.some((r) => r.kind === 'minutes'));
    assert.ok(ae.some((r) => r.kind === 'branch'));
    assert.equal(ae.filter((r) => r.kind === 'personal').length, 0);
    assert.equal((await list('u-fd')).filter((r) => r.kind === 'personal').length, 1);
    assert.equal((await list('u-cm-arsh')).filter((r) => r.companyId === 'co-sasa').length, 0);

    const fake = (kind: string, companyId: string | null, id: string, scope = `co:${companyId}`): ToolboxRec => ({ id, kind: kind as ToolboxRec['kind'], scope, companyId, status: 'active', d: {}, by: 'x', byId: 'x', at: NOW, history: [] });
    await assert.rejects(as('u-ae-sasa', (svc) => svc.store.insert('toolboxRecs', fake('personal', 'co-sasa', 'tbx-fake-1'))), /row-level security|permission denied/);
    await assert.rejects(as('u-cm-arsh', (svc) => svc.store.insert('toolboxRecs', fake('line', 'co-sasa', 'tbx-fake-2'))), /row-level security|permission denied/);
    await assert.rejects(as('u-cm-sasa', (svc) => svc.store.insert('toolboxRecs', fake('settings', null, 'tbx-fake-3', 'group'))), /row-level security|permission denied/);
    await assert.rejects(as('u-cm-sasa', (svc) => svc.store.insert('toolboxRecs', fake('siteTalk', 'co-sasa', 'tbx-fake-4'))), /row-level security|permission denied/);
    await assert.rejects(as('u-it-ex1', (svc) => svc.store.insert('toolboxRecs', fake('line', null, 'tbx-fake-5', 'dept:hr'))), /row-level security|permission denied/);

    const min = ae.find((r) => r.kind === 'minutes')!;
    await assert.rejects(admin(`UPDATE prima.toolbox_recs SET data = jsonb_set(data,'{history}','[]'::jsonb) WHERE id=$1`, [min.id]), /append-only/);
    await assert.rejects(admin(`UPDATE prima.toolbox_recs SET data = jsonb_set(data,'{companyId}','"co-arsh"'::jsonb) WHERE id=$1`, [min.id]), /immutable/);
    await assert.rejects(admin(`DELETE FROM prima.toolbox_recs WHERE id=$1`, [min.id]), /never deleted/);
    const grants = (await admin(`SELECT privilege_type FROM information_schema.role_table_grants WHERE table_schema='prima' AND table_name='toolbox_recs' AND grantee='prima_app'`)).rows.map((x) => x.privilege_type).sort();
    assert.deepEqual(grants, ['INSERT', 'SELECT', 'UPDATE']);
  });
});
