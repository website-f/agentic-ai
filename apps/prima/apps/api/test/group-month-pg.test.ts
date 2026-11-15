// Part Y on PostgreSQL (monthly JA Group meeting and duty checklists, 14 Nov 2026): the group_month_recs walls. Unit HR
// sets the meeting; the company office records pay method counts and JTK rows and builds and submits its report; the
// company manager verifies; another company reads none of it; Internal Audit reads; history is append-only and nothing
// is deleted; a duty checklist line opens as the person's own task under row-level security. Synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { myt, RULES, type GmRec } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const NOW = myt('2026-12-01', '10:00');

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

describe('Part Y monthly group meeting records (PostgreSQL)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });
  const as = <T>(uid: string, fn: (svc: any, u: any) => Promise<T>) => db.asUser(uid, fn, () => NOW);
  const act = (uid: string, op: string, i: Record<string, unknown> = {}) => as(uid, (svc, u) => svc.groupMonthAct(u, op, i));
  const list = async (uid: string) => (await as(uid, (svc) => svc.store.list('groupMonthRecs', {}))) as GmRec[];

  it('refuses with a clear message before the module is installed', async () => {
    await assert.rejects(act('u-pwvsb-hr', 'setMeeting', { period: '2026-11', meetingOn: '2026-12-14' }), /group-monthly-v1/);
  });

  it('company office, manager verify, other-company and Audit walls, append-only history and no delete', async () => {
    await admin(mod('group-monthly-v1.sql'));
    await act('u-pwvsb-hr', 'setMeeting', { period: '2026-11', meetingOn: '2026-12-14' });
    await assert.rejects(act('u-ae-sasa', 'setMeeting', { period: '2026-11', meetingOn: '2026-12-15' }));
    await act('u-ae-sasa', 'payMethod', { companyId: 'co-sasa', period: '2026-11', transfer: 10, noAccount: 1, cash: 0 });
    await act('u-ae-sasa', 'jtk', { companyId: 'co-sasa', type: 'audit', ref: 'JTK/PG/1', receivedOn: '2026-11-05' });
    await assert.rejects(act('u-ae-arsh', 'payMethod', { companyId: 'co-sasa', period: '2026-11', transfer: 1, noAccount: 0, cash: 0 }));
    await act('u-ae-sasa', 'reportBuild', { scope: 'co:co-sasa', period: '2026-11' });
    const ticks = Object.fromEntries(RULES.groupMonthly.value.items.map((x) => [x.key, 'tiada_perubahan']));
    await act('u-ae-sasa', 'reportSave', { scope: 'co:co-sasa', period: '2026-11', ticks, notes: { '13': 'Fail tersusun (test)', '14': 'Baik (test)' } });
    await act('u-ae-sasa', 'reportSubmit', { scope: 'co:co-sasa', period: '2026-11' });
    await assert.rejects(act('u-ae-sasa', 'reportDecide', { scope: 'co:co-sasa', period: '2026-11', verdict: 'verify', comment: 'ok' }));
    await act('u-cm-sasa', 'reportDecide', { scope: 'co:co-sasa', period: '2026-11', verdict: 'verify', comment: 'Disahkan (test)' });

    const mine = await list('u-ae-sasa');
    assert.ok(mine.some((r) => r.kind === 'report' && r.status === 'verified'));
    const other = await list('u-ae-arsh');
    assert.equal(other.filter((r) => r.companyId === 'co-sasa').length, 0, 'another company reads none of Sasa');
    assert.ok(other.some((r) => r.kind === 'meeting'), 'everyone sees the meeting row');
    const audit = await list('u-audit');
    assert.ok(audit.some((r) => r.kind === 'report' && r.companyId === 'co-sasa'));
    const hr = await list('u-pwvsb-hr');
    assert.ok(hr.some((r) => r.kind === 'jtk'));
    await assert.rejects(admin(`DELETE FROM prima.group_month_recs WHERE data->>'kind' = 'jtk'`), /never deleted/);
    await assert.rejects(admin(`UPDATE prima.group_month_recs SET data = jsonb_set(data, '{history}', '[]'::jsonb) WHERE data->>'kind' = 'report'`), /append-only/);
    await assert.rejects(admin(`UPDATE prima.group_month_recs SET data = jsonb_set(jsonb_set(data, '{companyId}', '"co-arsh"'), '{history}', data->'history' || '[{"note":"x"}]'::jsonb) WHERE data->>'kind' = 'jtk'`), /immutable/);
  });

  it('a duty checklist line opens as the person\'s task under row-level security and replaces the draft playbook', async () => {
    await assert.rejects(act('u-ae-sasa', 'dutyLoad', { scope: 'co:co-sasa', role: 'admin_exec', picId: 'u-ae-sasa' }));
    const r = (await act('u-cm-sasa', 'dutyLoad', { scope: 'co:co-sasa', role: 'admin_exec', picId: 'u-ae-sasa' })) as { added: number };
    assert.equal(r.added, RULES.groupDuties.value.template.admin_exec.length);
    const w = (await as('u-ae-sasa', (svc, u) => svc.myWork(u))) as { open: { playbookItemId: string | null }[] };
    assert.ok(w.open.some((t) => t.playbookItemId?.startsWith('duty:')));
    assert.ok(!w.open.some((t) => t.playbookItemId && !t.playbookItemId.startsWith('duty:')));
    assert.equal((await list('u-ae-arsh')).filter((x) => x.kind === 'duty').length, 0);
  });
  it('Part Z2: Unit HR changes the group calendar with a reason; nothing else can pose as the settings row', async () => {
    await assert.rejects(act('u-ae-sasa', 'setCalendar', { items: [{ text: 'Gaji', fromDay: 7, toDay: 7 }], reason: 'test' }));
    await act('u-pwvsb-hr', 'setCalendar', { items: [{ text: 'Gaji', fromDay: 7, toDay: 7 }], reason: 'Ubah (test)' });
    const c = (await act('u-ae-sasa', 'calendar')) as { items: { text: string }[] };
    assert.deepEqual(c.items.map((x) => x.text), ['Gaji']);
    await assert.rejects(admin(`INSERT INTO prima.group_month_recs (id, data) VALUES ('gm-fake', '{"id":"gm-fake","kind":"settings","history":[]}')`), /check/i);
  });
});
