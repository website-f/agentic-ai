// Monthly reports Prima makes by itself on PostgreSQL (Fauzan, 23 Nov 2026). Under the real walls: not installed until
// the module is run; a company's report stays behind its company wall; a department report has no company and is read
// by group sign-ins only; nothing is deleted and a sent report is not changed. Synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { myt, type PrimaService, type User } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';
import { runAutoReports } from '../src/auto-reports-online';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const NOW = myt('2026-12-01', '09:00');
type Mine = { installed: boolean; reports: { id: string; kind: string; owner: boolean; status: string }[] };

describe('Monthly reports made by Prima (PostgreSQL)', () => {
  let db: Db;
  const as = <T>(id: string, fn: (svc: PrimaService, u: User) => Promise<T>) => db.asUser(id, fn, () => NOW);
  const sql = async (q: string) => {
    const c = new Client({ connectionString: URL });
    await c.connect();
    try {
      return await c.query(q);
    } finally {
      await c.end();
    }
  };
  before(async () => {
    await resetDb(URL, myt('2026-11-23', '10:00'));
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('says not installed until the module is run, and the daily run does nothing', async () => {
    const mine = (await as('u-cm-sasa', (svc, u) => svc.autoReportAct(u, 'mine', {}))) as Mine;
    assert.equal(mine.installed, false);
    const run = await runAutoReports(db, () => NOW);
    assert.equal(run.installed, false);
    await sql(readFileSync(resolve(__dirname, '../../../../db/modules/auto-reports-v1.sql'), 'utf8'));
    await db.onModuleDestroy();
    db = new Db();
  });

  it('keeps company reports behind the company wall and department reports for group sign-ins', async () => {
    const sasa = (await as('u-cm-sasa', (svc, u) => svc.autoReportAct(u, 'mine', {}))) as Mine;
    assert.equal(sasa.installed, true);
    const own = sasa.reports.filter((r) => r.kind === 'company');
    assert.ok(own.length > 0);
    const arsh = (await as('u-cm-arsh', (svc, u) => svc.autoReportAct(u, 'mine', {}))) as Mine;
    assert.ok(!arsh.reports.some((r) => own.some((o) => o.id === r.id)));
    await assert.rejects(as('u-cm-arsh', (svc, u) => svc.autoReportAct(u, 'view', { id: own[0].id })));
    // The department report is made by its own staff and read by ACT, never by a company office.
    const hr = (await as('u-pwvsb-hr', (svc, u) => svc.autoReportAct(u, 'mine', {}))) as Mine;
    const dept = hr.reports.find((r) => r.kind === 'department' && r.owner)!;
    assert.ok(dept);
    const act = (await as('u-audit', (svc, u) => svc.autoReportAct(u, 'mine', {}))) as Mine;
    assert.ok(act.reports.some((r) => r.id === dept.id));
    await assert.rejects(as('u-cm-sasa', (svc, u) => svc.autoReportAct(u, 'view', { id: dept.id })));
    const rows = await sql(`SELECT count(*)::int AS n FROM prima.auto_reports WHERE company_id IS NULL AND data->>'kind' IN ('company','client')`);
    assert.equal(rows.rows[0].n, 0);
  });

  it('the Director Office sets what a report must have; a company office reads it but cannot write it', async () => {
    const set = (await as('u-pwvsb-doa', (svc, u) => svc.autoReportAct(u, 'layouts', {}))) as { reports: { id: string; kind: string }[] };
    const dept = set.reports.find((r) => r.kind === 'department')!;
    await as('u-pwvsb-doa', (svc, u) => svc.autoReportAct(u, 'setLayout', { reportId: dept.id, parts: [], added: [{ title: 'Staff matters', hint: 'Joiners and leavers', must: false }], note: 'Add staff matters.' }));
    const rows = await sql(`SELECT data FROM prima.auto_report_layouts WHERE id = '${dept.id}'`);
    assert.equal(rows.rows[0].data.added[0].title, 'Staff matters');
    await assert.rejects(as('u-cm-sasa', (svc, u) => svc.autoReportAct(u, 'setLayout', { reportId: dept.id, parts: [], added: [], note: 'try' })));
    // Under the wall a company sign-in reads the layout but cannot write one.
    const read = await sql(`BEGIN; SET LOCAL ROLE prima_app; SELECT set_config('app.company_ids', 'co-sasa', true); SELECT count(*)::int AS n FROM prima.auto_report_layouts; COMMIT;`);
    assert.ok((read as unknown as { rows: { n: number }[] }[])[3].rows[0].n >= 1);
    await assert.rejects(
      sql(`BEGIN; SET LOCAL ROLE prima_app; SELECT set_config('app.company_ids', 'co-sasa', true); INSERT INTO prima.auto_report_layouts (id, data) VALUES ('x', '{"id":"x","parts":[],"added":[]}'); COMMIT;`),
      /row-level security/,
    );
  });

  it('sends a checked report to the Director Office, then refuses changes and deletes', async () => {
    const sasa = (await as('u-cm-sasa', (svc, u) => svc.autoReportAct(u, 'mine', {}))) as Mine;
    const r = sasa.reports.find((x) => x.kind === 'company' && x.status === 'made')!;
    await as('u-cm-sasa', (svc, u) => svc.autoReportAct(u, 'note', { id: r.id, index: 0, text: 'Checked against the bank.' }));
    await as('u-cm-sasa', (svc, u) => svc.autoReportAct(u, 'send', { id: r.id, note: 'Checked.' }));
    const subs = await sql(`SELECT count(*)::int AS n FROM prima.report_submissions WHERE data->>'companyId' = 'co-sasa' AND data->>'period' = '2026-11'`);
    assert.ok(subs.rows[0].n >= 1);
    await assert.rejects(sql(`UPDATE prima.auto_reports SET data = jsonb_set(data, '{name}', '"changed"') WHERE id = '${r.id}'`), /not changed/);
    await assert.rejects(
      sql(`BEGIN; SET LOCAL ROLE prima_app; SELECT set_config('app.company_ids', 'co-sasa', true); DELETE FROM prima.auto_reports WHERE id = '${r.id}'; COMMIT;`),
      /permission denied/,
    );
  });

  it('the Director Office Make now on the due day sends the unsent department reports, marked not checked', async () => {
    const later = myt('2026-12-26', '09:00');
    const res = (await db.asUser('u-pwvsb-doa', (svc, u) => svc.autoReportAct(u, 'run', {}), () => later)) as { sent: number };
    assert.ok(res.sent > 0);
    const rows = await sql(`SELECT data FROM prima.auto_reports WHERE data->>'kind' = 'department'`);
    assert.ok(rows.rows.every((x) => x.data.status === 'sent'));
    assert.ok(rows.rows.some((x) => x.data.sent.checked === false));
  });
});
