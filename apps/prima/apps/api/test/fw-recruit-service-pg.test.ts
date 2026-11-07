// Recruitment steps through the real API service on PostgreSQL with the company wall on: two officers opening the same
// worker at once, two clearers racing, and what a company manager can and cannot read. The module SQL is applied to
// the throwaway local database only (it is not part of the release). Synthetic seed data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
process.env.DEV_TOKEN_SECRET = process.env.DEV_TOKEN_SECRET ?? 'test-secret';
const sql = (f: string) => readFileSync(resolve(process.cwd(), process.cwd().endsWith('/apps/api') ? `../../db/modules/${f}` : `db/modules/${f}`), 'utf8');
let n = 0;
const pdf = (name: string) => ({ kind: 'document' as const, name, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 ${name} ${Date.now()} ${(n += 1)}`).toString('base64')}` });
const addDays = (d: string, k: number) => new Date(Date.parse(`${d}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);

describe('foreign worker recruitment steps on PostgreSQL', () => {
  let db: Db;
  let today: string;
  let worker: { id: string; staffNo: string };
  before(async () => {
    await resetDb(URL);
    db = new Db();
    // The zero-fee step reads the arrival fee check, so the welfare module goes in first.
    await db.pool.query(sql('fw-welfare-v1.sql'));
    await db.pool.query(sql('fw-recruit-v1.sql'));
    worker = (await db.pool.query("SELECT id, data->>'staffNo' AS \"staffNo\" FROM prima.people WHERE company_id='co-sasa' AND data->>'nationality'='NP' AND data->>'status'<>'left' ORDER BY id LIMIT 1")).rows[0];
    today = await db.asUser('u-fwm-ex1', async (svc) => svc.today());
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  const open = (uid: string, name: string, last4: string) =>
    db.asUser(uid, (svc, u) => svc.openFwRecruitFile(u, { companyId: 'co-sasa', candidateName: name, passportLast4: last4, country: 'NP', agency: 'UAT Agency', plannedTravelOn: addDays(today, 20) }));

  async function steps(id: string) {
    type Step = 'AGENCY_LICENCE' | 'EMBASSY' | 'INTERVIEW' | 'AGE' | 'CONTRACT';
    const rec = (step: Step, input: Record<string, unknown>, proof: ReturnType<typeof pdf>[]) =>
      db.asUser('u-fwm-ex1', (svc, u) => svc.recordFwRecruitStep(u, id, step, { on: today, ...input }, proof));
    await rec('AGENCY_LICENCE', { licenceNo: 'UAT-LIC-1', licenceExpiresOn: addDays(today, 300) }, [pdf('licence.pdf')]);
    await rec('EMBASSY', { reference: 'UAT-EMB-1' }, [pdf('embassy.pdf')]);
    await rec('INTERVIEW', { interviewer: 'UAT Interviewer', passed: true }, []);
    await rec('AGE', { dob: '1994-03-03' }, [pdf('passport.pdf')]);
    await rec('CONTRACT', { languages: ['en', 'ms', 'ne'] }, [pdf('contract.pdf')]);
  }

  it('two officers opening the same worker at once leave exactly one file', async () => {
    const r = await Promise.allSettled([open('u-fwm-ex1', 'UAT Race', '1111'), open('u-fwm-ex2', 'UAT Race', '1111')]);
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
    const rows = await db.pool.query("SELECT 1 FROM prima.fw_recruit_files WHERE data->>'candidateName'='UAT Race'");
    assert.equal(rows.rowCount, 1);
  });

  it('two clearers racing: one clears, the other is refused', async () => {
    const f = await open('u-fwm-ex1', 'UAT Clear', '2222');
    await steps(f.id);
    const r = await Promise.allSettled([
      db.asUser('u-fwm-mgr', (svc, u) => svc.clearFwRecruitFile(u, f.id)),
      db.asUser('u-fwm-dep', (svc, u) => svc.clearFwRecruitFile(u, f.id)),
    ]);
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
    assert.match(String((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason?.message), /in progress/);
  });

  it('the Sasa company manager reads step status only; Inas reads nothing of Sasa', async () => {
    const f = await open('u-fwm-ex1', 'UAT Seen', '3333');
    await steps(f.id);
    await db.asUser('u-fwm-mgr', (svc, u) => svc.clearFwRecruitFile(u, f.id));
    await db.asUser('u-fwm-ex1', (svc, u) => svc.recordFwRecruitArrival(u, f.id, { arrivedOn: today, staffNo: worker.staffNo }));
    await db.asUser('u-fwm-ex1', (svc, u) => svc.recordFwCheck(u, worker.id, { kind: 'ARRIVAL_FEE', checkedOn: today, agency: 'UAT Agency', paidAnything: false }, []));
    const lead = await db.asUser('u-fwm-mgr', (svc, u) => svc.fwmRecruitment(u));
    assert.equal(lead.files.find((r) => r.file.id === f.id)?.zeroFee, 'confirmed');
    const board = await db.asUser('u-cm-sasa', (svc, u) => svc.fwmRecruitment(u));
    const text = JSON.stringify(board);
    for (const secret of ['1994-03-03', 'UAT-LIC-1', 'UAT-EMB-1']) assert.ok(!text.includes(secret), secret);
    assert.ok(board.files.some((r) => r.file.id === f.id));
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.fwmDocs(u, f.id)));
    const inas = await db.asUser('u-cm-inas', (svc, u) => svc.fwmRecruitment(u));
    assert.ok(!inas.files.some((r) => r.file.id === f.id));
    await assert.rejects(db.asUser('u-cm-inas', (svc, u) => svc.stopFwRecruitFile(u, f.id, { reason: 'Not ours to stop.' })));
  });
});
