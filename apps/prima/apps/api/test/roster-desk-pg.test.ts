// Guard roster screens against a real local PostgreSQL (Part O, Fauzan 13-14 Nov 2026): before the module is installed
// every call says so; after it, the roster chain, corrections, breaks and the guard's own signature work as the app
// role under row-level security, and the database triggers accept exactly these writes. Synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { monthDates, type RosterStatus } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const SITE = 'st-sasa-001';

function lines(a: string, b: string, month: string) {
  return monthDates(month).flatMap((date, i) => {
    const on = i % 2 === 0 ? a : b;
    const off = i % 2 === 0 ? b : a;
    return [
      { personId: on, date, planned: 'WORK_D' as RosterStatus, plannedStart: `${date}T08:00:00+08:00`, plannedEnd: `${date}T20:00:00+08:00` },
      { personId: off, date, planned: 'OFF_REST' as RosterStatus },
    ];
  });
}

describe('guard roster desk in the database', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('says it is not installed, then runs the whole chain as the app role', async () => {
    const month = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 7);
    const coverage = { effectiveFrom: `${month}-01`, calendar: { kind: 'every_day' }, shifts: [{ code: 'D', start: '08:00', end: '20:00', posts: 1 }], minActive: 1, armed: false, clientLimits: {}, billing: 'fixed_monthly_post', breakPermissionRef: null, reason: 'Synthetic contract schedule', documentRef: 'CONTRACT-SYNTHETIC' };
    await assert.rejects(db.asUser('u-opsdir', (svc, u) => svc.saveSiteCoverage(u, SITE, coverage as never)), /guard roster is not installed/);
    await assert.rejects(db.asUser('u-om-klang', (svc, u) => svc.rosterBoard(u, SITE, month)), /guard roster is not installed/);

    const admin = new Client({ connectionString: URL });
    await admin.connect();
    await admin.query(readFileSync(join(__dirname, '../../../../db/modules/guard-roster-v1.sql'), 'utf8'));
    const people = await admin.query(`SELECT data->>'id' AS id FROM prima.people WHERE data->>'companyId' = 'co-sasa' AND data->>'role' = 'guard' AND data->>'status' = 'active' ORDER BY data->>'staffNo' LIMIT 3`);
    const guardPerson = (await admin.query(`SELECT data->>'personId' AS p FROM prima.users WHERE id = 'u-guard-sasa-1'`)).rows[0].p as string;
    await admin.end();
    const a = guardPerson;
    const b = people.rows.map((r) => r.id as string).find((x) => x !== a)!;

    await db.asUser('u-opsdir', (svc, u) => svc.saveSiteCoverage(u, SITE, coverage as never));
    await assert.rejects(db.asUser('u-ogm', (svc, u) => svc.saveSiteCoverage(u, SITE, coverage as never)));
    const saved = await db.asUser('u-om-klang', (svc, u) => svc.saveRosterDraft(u, SITE, month, { days: lines(a, b, month) }));
    assert.equal(saved.findings.filter((f) => f.level === 'block').length, 0, JSON.stringify(saved.findings.filter((f) => f.level === 'block').slice(0, 3)));
    const v1 = saved.version.id;
    await db.asUser('u-om-klang', (svc, u) => svc.rosterStep(u, v1, 'submit', 'Synthetic month ready'));
    await assert.rejects(db.asUser('u-om-klang', (svc, u) => svc.rosterStep(u, v1, 'publish', 'own')));
    await db.asUser('u-opsdir', (svc, u) => svc.rosterStep(u, v1, 'publish', 'Checked'));

    // The day is recorded once; a correction needs the OD and evidence; the database trigger accepts exactly that.
    const day = (await db.asUser('u-om-klang', (svc, u) => svc.rosterBoard(u, SITE, month))).days.find((d) => d.date === `${month}-01` && d.planned === 'WORK_D')!;
    await db.asUser('u-om-klang', (svc, u) => svc.recordRosterActual(u, day.id, 'ABS'));
    await db.asUser('u-opsdir', (svc, u) => svc.decideRosterAbsence(u, day.id, true, 'No call, no show, synthetic'));
    await db.asUser('u-om-klang', (svc, u) => svc.proposeRosterCorrection(u, day.id, { to: 'WORK_D', evidence: 'ATT-SYNTHETIC', reason: 'Clocked in, device offline' }));
    const fixed = await db.asUser('u-opsdir', (svc, u) => svc.decideRosterCorrection(u, day.id, true, 'Evidence checked'));
    assert.equal(fixed.actual, 'WORK_D');
    const brk = await db.asUser('u-om-klang', (svc, u) => svc.recordRosterBreak(u, day.id, { slot: 'A', start: `${month}-01T12:00:00+08:00`, end: `${month}-01T13:00:00+08:00`, relieved: true, confirm: true }));
    assert.equal(brk.confirmedById, 'u-om-klang');
    await db.asUser('u-opsdir', (svc, u) => svc.recordRosterEvidence(u, SITE, { rule: 'weekly_rest', kind: 'jtk_permit', documentRef: 'JTK-SYNTHETIC', from: `${month}-01`, to: `${month}-28` }));

    // A new version after publishing, then publishing it marks the first replaced.
    // Review of PR #141 (D4): past days stay as published, so the swap is from today on; a full swap is refused.
    const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
    if (today > `${month}-01`)
      await assert.rejects(db.asUser('u-om-klang', (svc, u) => svc.saveRosterDraft(u, SITE, month, { days: lines(b, a, month), changeReason: 'Synthetic swap' })), /has passed: past days stay as published/);
    const swapDays = [...lines(a, b, month).filter((d) => d.date < today), ...lines(b, a, month).filter((d) => d.date >= today)];
    const v2 = await db.asUser('u-om-klang', (svc, u) => svc.saveRosterDraft(u, SITE, month, { days: swapDays, changeReason: 'Synthetic swap' }));
    await db.asUser('u-om-klang', (svc, u) => svc.rosterStep(u, v2.version.id, 'submit', 'Swap'));
    await db.asUser('u-opsdir', (svc, u) => svc.rosterStep(u, v2.version.id, 'publish', 'Approved swap'));
    const board = await db.asUser('u-opsdir', (svc, u) => svc.rosterBoard(u, SITE, month));
    assert.equal(board.versions.find((v) => v.id === v1)?.status, 'replaced');

    // Allowance and lump sum with the guard's own signature; the CEO alone switches it on.
    const al = await db.asUser('u-om-klang', (svc, u) => svc.proposeGuardAllowance(u, SITE, { personId: a, type: 'transport', basis: 'per_duty', amount: 5, from: `${month}-01`, reason: 'Synthetic approved memo' }));
    await db.asUser('u-cos', (svc, u) => svc.decideGuardAllowance(u, al.id, 'verify', true, 'Checked'));
    await db.asUser('u-coo', (svc, u) => svc.decideGuardAllowance(u, al.id, 'approve', true, 'Approved'));
    const ls = await db.asUser('u-opsdir', (svc, u) => svc.proposeLumpSum(u, SITE, { personId: a, target: 2300, from: month }));
    await db.asUser('u-coo', (svc, u) => svc.approveLumpSum(u, ls.id, 'Within budget'));
    const signed = await db.asUser('u-guard-sasa-1', (svc, u) => svc.decideMyLumpSum(u, ls.id, 'sign'));
    assert.equal(signed.status, 'signed');
    await assert.rejects(db.asUser('u-opsdir', (svc, u) => svc.setLumpSumSwitch(u, SITE, true, 'Not my switch')));
    await db.asUser('u-fauzan', (svc, u) => svc.setLumpSumSwitch(u, SITE, true, 'Synthetic pilot'));
    const mine = await db.asUser('u-guard-sasa-1', (svc, u) => svc.myRoster(u, month));
    assert.equal(mine.agreements[0].status, 'signed');
    assert.ok(mine.days.length > 0);

    // Another company's operations staff never see the rows (company wall).
    const check = new Client({ connectionString: URL });
    await check.connect();
    try {
      await check.query('BEGIN');
      await check.query('SET LOCAL ROLE prima_app');
      await check.query(`SELECT set_config('app.company_ids', 'co-arsh', true), set_config('app.group_user', 'off', true)`);
      assert.equal((await check.query('SELECT count(*)::int AS n FROM prima.roster_versions')).rows[0].n, 0);
      await check.query('ROLLBACK');
    } finally {
      await check.end();
    }
  });
});
