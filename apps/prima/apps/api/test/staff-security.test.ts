// Security gates before real staff data, proved in the database itself (pre-publication review R1-R3, Fauzan
// 31 Oct 2026): department walls on group-wide tables, offboarding through prima.close_access only, and no PIN kept
// as typed. Uses the same throwaway local database as rls.test.ts and resets it. Mock data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { AccessClosed, DEMO_PIN_KEY, activeGrants, type AuthorityGrant, type User } from '@prima/core';
import { userForEntra } from '../src/auth';
import { Db, apiPinKeeper } from '../src/db';
import { linkEntra } from '../src/entra-link';
import { hashPins } from '../src/hash-pins';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

/** One statement as the API's runtime role, with the given walls (and optionally a user) set for the transaction. */
async function asApp(walls: string, sql: string, params: unknown[] = [], userId = 'u-nobody') {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE prima_app');
    await c.query(`SELECT set_config('app.walls', $1, true)`, [walls]);
    await c.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    const res = await c.query(sql, params);
    await c.query('COMMIT');
    return res;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}

async function admin<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows as T[];
  } finally {
    await c.end();
  }
}

const count = async (walls: string, table: string, userId?: string) => Number((await asApp(walls, `SELECT count(*) AS n FROM prima.${table}`, [], userId)).rows[0].n);

describe('staff data security gates (database)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('keeps no PIN as typed in the database, only keyed hashes', async () => {
    const [r] = await admin<{ plain: string; hashed: string }>(
      `SELECT count(*) FILTER (WHERE data ? 'pin') AS plain, count(*) FILTER (WHERE data->>'pinHash' LIKE 'h1$%') AS hashed FROM prima.people`,
    );
    assert.equal(Number(r.plain), 0);
    assert.ok(Number(r.hashed) > 0);
  });

  it('refuses the test PIN key and a missing key in production, so PIN checks fail closed', () => {
    assert.equal(apiPinKeeper({ NODE_ENV: 'production' }).on, false);
    assert.equal(apiPinKeeper({ NODE_ENV: 'production', PIN_PEPPER: DEMO_PIN_KEY }).on, false);
    assert.equal(apiPinKeeper({ NODE_ENV: 'production', PIN_PEPPER: 'too-short' }).on, false);
    assert.equal(apiPinKeeper({ NODE_ENV: 'production', PIN_PEPPER: 'p'.repeat(40) }).on, true);
  });

  it('shows department tables only through their wall', async () => {
    for (const t of ['am_units', 'am_assets', 'am_depn_postings', 'pdpa_cases', 'pdpa_dpos', 'bcm_systems', 'act_audits', 'act_findings']) {
      assert.equal(await count('', t), 0, `${t} with no wall`);
      assert.equal(await count('offboard', t), 0, `${t} with only the HR wall`);
    }
    assert.ok((await count('asset_read', 'am_units')) > 0);
    assert.ok((await count('pdpa', 'pdpa_cases')) > 0);
    assert.ok((await count('bcm', 'bcm_systems')) > 0);
    assert.ok((await count('act', 'act_findings')) > 0);
    assert.equal(await count('asset_read,pdpa,bcm', 'act_findings'), 0, 'another wall does not open ACT');
  });

  it('keeps full ICs and salary accounts behind the HR wall: Finance reads accounts only, others nothing', async () => {
    await admin(`INSERT INTO prima.staff_ids (id, data) VALUES ('pr-wall', '{"id":"pr-wall","idFull":"880202101234"}') ON CONFLICT DO NOTHING`);
    await admin(`INSERT INTO prima.staff_accounts (id, data) VALUES ('pr-wall', '{"id":"pr-wall","accountFull":"5566778899"}') ON CONFLICT DO NOTHING`);
    for (const walls of ['', 'offboard', 'asset_read,asset_write,act,pdpa,bcm']) {
      assert.equal(await count(walls, 'staff_ids'), 0, `staff_ids with walls '${walls}'`);
      assert.equal(await count(walls, 'staff_accounts'), 0, `staff_accounts with walls '${walls}'`);
    }
    assert.equal(await count('staff_accounts', 'staff_ids'), 0, 'Finance never reads the full IC');
    assert.equal(await count('staff_accounts', 'staff_accounts'), 1);
    assert.equal(await count('staff_ids,staff_accounts', 'staff_ids'), 1);
    // A company manager reads their own company's staff numbers only, and never writes them (Fauzan, 1 Nov 2026).
    await admin(`INSERT INTO prima.staff_ids (id, data) VALUES ('pr-cm', '{"id":"pr-cm","companyId":"co-sasa","idFull":"1"}') ON CONFLICT DO NOTHING`);
    const asCm = async (companies: string, sql: string) => {
      const c = new Client({ connectionString: URL });
      await c.connect();
      try {
        await c.query('BEGIN');
        await c.query('SET LOCAL ROLE prima_app');
        await c.query(`SELECT set_config('app.walls', 'staff_company', true)`);
        await c.query(`SELECT set_config('app.company_ids', $1, true)`, [companies]);
        const r = await c.query(sql);
        await c.query('COMMIT');
        return r;
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        await c.end();
      }
    };
    assert.equal((await asCm('co-sasa', 'SELECT id FROM prima.staff_ids')).rows.map((r) => r.id).join(), 'pr-cm');
    assert.equal((await asCm('co-arsh', 'SELECT id FROM prima.staff_ids')).rowCount, 0);
    assert.equal((await asCm('co-sasa', `UPDATE prima.staff_ids SET data = data || '{"idFull":"2"}' WHERE id = 'pr-cm'`)).rowCount, 0);
    await assert.rejects(asCm('co-sasa', `INSERT INTO prima.staff_ids (id, data) VALUES ('pr-y', '{"id":"pr-y","companyId":"co-sasa"}')`), /row-level security/);
    await assert.rejects(asApp('staff_accounts', `INSERT INTO prima.staff_ids (id, data) VALUES ('pr-x', '{"id":"pr-x"}')`), /row-level security/);
    // Through the API: HR saves a new staff member; the number lands behind the wall, not on the person row.
    const saved = await db.asUser('u-pwvsb-hr', async (svc, user) => {
      const form = await svc.recordForm(user, 'officeStaff', null, 'pwvsb');
      return svc.saveRecord(user, 'officeStaff', null, 'pwvsb', {
        staffNo: 'PWV902', name: 'Wall Test', jobTitle: 'HR Executive', branchId: form.options.branchId[0][0], employmentType: 'probation',
        hiredOn: '2026-11-01', probationEndsOn: '2027-05-01', nationality: 'MY', idFull: '770707-07-7777', gender: 'M', dob: '1977-07-07',
        phone: '012-345 6789', bankName: 'Maybank', bankAccountFull: '1234567890', basicPay: 3000, payReason: 'Offer letter', status: 'active',
      });
    });
    const id = (saved as { id: string }).id;
    const [row] = await admin<{ d: string }>(`SELECT data::text AS d FROM prima.people WHERE id = $1`, [id]);
    assert.ok(!row.d.includes('770707077777') && !row.d.includes('770707-07-7777') && !row.d.includes('1234567890'));
    const [ids] = await admin<{ n: string }>(`SELECT count(*) AS n FROM prima.staff_ids WHERE id = $1`, [id]);
    assert.equal(Number(ids.n), 1);
  });

  it('shows a registered face only to its owner and HR, and never lets the owner approve it', async () => {
    const face = (status: string) => JSON.stringify({ id: 'pr-face', userId: 'u-owner', status, descriptor: [] });
    await admin(`INSERT INTO prima.staff_faces (id, data) VALUES ('pr-face', $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`, [face('pending')]);
    assert.equal(await count('', 'staff_faces', 'u-owner'), 1, 'the owner sees their own');
    assert.equal(await count('', 'staff_faces', 'u-someone'), 0, 'another person sees nothing');
    assert.equal(await count('staff_company,staff_ids,staff_accounts', 'staff_faces', 'u-cm'), 0, 'company managers and Finance see nothing');
    assert.equal(await count('staff_faces', 'staff_faces', 'u-hr'), 1, 'HR sees it');
    await assert.rejects(asApp('', `UPDATE prima.staff_faces SET data = $1 WHERE id = 'pr-face'`, [face('approved')], 'u-owner'), /row-level security/);
    const ok = await asApp('staff_faces', `UPDATE prima.staff_faces SET data = $1 WHERE id = 'pr-face'`, [face('approved')], 'u-hr');
    assert.equal(ok.rowCount, 1);
  });

  it('registers, approves and checks a face through the API under the walls', async () => {
    const d = Array.from({ length: 128 }, (_, i) => Math.sin(i + 1) / 10);
    const img = 'data:image/jpeg;base64,' + Buffer.from('face').toString('base64');
    await db.asUser('u-cm-inas', (svc, u) => svc.registerFace(u, { photo: img, descriptor: d }));
    const personId = await db.asUser('u-cm-inas', async (_svc, u) => u.personId!);
    await db.asUser('u-pwvsb-hr', (svc, u) => svc.decideFace(u, personId, true, 'Matches the staff photo'));
    await db.asUser('u-cm-inas', (svc, u) => svc.staffSessionStart(u));
    const done = await db.asUser('u-cm-inas', (svc, u) =>
      svc.staffFaceCheck(u, { image: img, capturedAt: new Date().toISOString(), lat: null, lng: null, accuracyM: null, face: { score: 0, live: true }, descriptor: d }),
    );
    assert.equal(done.faceCheck?.face?.score, 1);
    assert.ok(!done.flags.includes('FACE_PENDING'));
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.faceReviews(u)));
  });

  it('keeps public holidays, working from home permission and flexible work requests through the API (slice 3C)', async () => {
    const year = new Date().getUTCFullYear() + 1;
    await db.asUser('u-pwvsb-hr', (svc, u) => svc.addPublicHoliday(u, { date: `${year}-12-24`, name: 'Group family day', states: null, compulsory: null, note: 'HR extra day' }));
    const seen = await db.asUser('u-it-ex3', (svc, u) => svc.publicHolidays(u, String(year)));
    assert.ok(seen.holidays.some((h) => h.name === 'Group family day'));
    assert.equal(seen.canEdit, false);
    await assert.rejects(db.asUser('u-it-ex3', (svc, u) => svc.addPublicHoliday(u, { date: `${year}-12-26`, name: 'Mine', states: null, compulsory: null, note: '' })));
    const de = await db.asUser('u-fin-t1-de2', async (_svc, u) => u.personId!);
    await db.asUser('u-pwvsb-hr', (svc, u) => svc.setWfhAllowed(u, de, false, 'Office work for now'));
    assert.equal((await db.asUser('u-fin-t1-de2', (svc, u) => svc.myRemote(u))).eligible, false);
    const r = await db.asUser('u-it-ex3', (svc, u) => svc.requestFlex(u, { kind: 'hours', detail: '8.00 to 5.00', reason: 'School run', from: `${year}-01-05`, to: null }));
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.decideFlex(u, r.id, true, 'ok')));
    const done = await db.asUser('u-pwvsb-hr', (svc, u) => svc.decideFlex(u, r.id, true, 'Fine, the team covers it'));
    assert.equal(done.status, 'approved');
  });

  it('runs vacancies and HR filings through the company wall (slice 3B)', async () => {
    const v = await db.asUser('u-cm-arsh', (svc, u) => svc.raiseVacancy(u, { companyId: 'co-arsh', title: 'Admin executive', department: 'Admin', headcount: 1, reason: 'Replacement', payFrom: null, payTo: null }));
    assert.equal(await count('co-sasa', 'vacancies'), 0, 'another company sees nothing');
    await db.asUser('u-fauzan', (svc, u) => svc.vacancyStep(u, v.id, 'ceo_approve', 'Approved'));
    const signed = await db.asUser('u-cm-arsh', (svc, u) => svc.vacancyStep(u, v.id, 'sign', 'Signed'));
    assert.equal(signed.status, 'open');
    const b = await db.asUser('u-pwvsb-hr', (svc, u) => svc.hrJoinLeave(u));
    assert.ok(Array.isArray(b.filings));
    await assert.rejects(db.asUser('u-fd', (svc, u) => svc.hrJoinLeave(u)));
    const reg = await db.asUser('u-pwvsb-hr', (svc, u) => svc.employeeRegister(u, 'pwvsb'));
    assert.ok(reg.body.split('\n').length > 2);
  });

  it('keeps a sexual harassment case behind the hr_cases wall, even for the company that can see the staff member (slice 3E)', async () => {
    const row = (confidential: boolean) => JSON.stringify({ id: 'hrc-test', companyId: 'co-sasa', confidential });
    await admin(`INSERT INTO prima.hr_cases (id, company_id, data) VALUES ('hrc-test', 'co-sasa', $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`, [row(true)]);
    const seen = async (walls: string) => {
      const c = new Client({ connectionString: URL });
      await c.connect();
      try {
        await c.query('BEGIN');
        await c.query('SET LOCAL ROLE prima_app');
        await c.query(`SELECT set_config('app.walls', $1, true)`, [walls]);
        await c.query(`SELECT set_config('app.company_ids', 'co-sasa', true)`);
        const n = Number((await c.query(`SELECT count(*) AS n FROM prima.hr_cases WHERE id = 'hrc-test'`)).rows[0].n);
        await c.query('COMMIT');
        return n;
      } finally {
        await c.end();
      }
    };
    assert.equal(await seen('staff_company'), 0, 'the company manager does not see a confidential case');
    assert.equal(await seen('hr_cases'), 1, 'HR sees it');
    await admin(`UPDATE prima.hr_cases SET data = $1 WHERE id = 'hrc-test'`, [row(false)]);
    assert.equal(await seen(''), 1, 'a non-confidential case is visible to the company');
    const c = await db.asUser('u-pwvsb-hr', async (svc, u) => {
      const staff = (await svc.user('u-it-ex3')).personId!;
      return svc.openHrCase(u, { personId: staff, kind: 'sexual_harassment', title: 'Complaint about remarks', complainantId: null, receivedOn: new Date().toISOString().slice(0, 10), note: 'Received' });
    });
    assert.equal(c.confidential, true);
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.hrCaseStep(u, c.id, { kind: 'note', note: 'x' })));
  });

  it('keeps office OSH records behind the company wall and lets only HR or the named coordinator keep them', async () => {
    const coordId = await db.asUser('u-it-ex3', async (_svc, u) => u.personId!);
    const companyId = (await db.asUser('u-pwvsb-hr', (svc, u) => svc.officeOsh(u))).staff.find((s) => s.personId === coordId)!.companyId;
    await assert.rejects(db.asUser('u-it-ex3', (svc, u) => svc.recordOfficeAssessment(u, { companyId, workplace: 'Level 3', assessedOn: new Date().toISOString().slice(0, 10), hazards: 2, highRisks: 0, controls: '' })));
    await db.asUser('u-pwvsb-hr', (svc, u) => svc.appointOshCoordinator(u, { companyId, personId: coordId, appointedOn: new Date().toISOString().slice(0, 10), trainingRef: null, note: '' }));
    const i = await db.asUser('u-it-ex3', (svc, u) =>
      svc.reportOshIncident(u, { companyId, incident: 'accident', occurredOn: new Date().toISOString().slice(0, 10), personId: null, serious: false, description: 'Synthetic slip at the pantry' }),
    );
    assert.equal(await count('co-sasa', 'office_osh'), 0, 'another company sees nothing');
    const done = await db.asUser('u-it-ex3', (svc, u) => svc.recordOshReport(u, i.id, { reportedOn: new Date().toISOString().slice(0, 10), ref: 'JKKP6-TEST' }));
    assert.equal(done.kind === 'incident' && done.reported?.ref, 'JKKP6-TEST');
    await assert.rejects(db.asUser('u-it-ex1', (svc, u) => svc.officeOsh(u)));
  });

  it('keeps training, appraisals and policy acknowledgements through the API under the company wall (slice 3F)', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const staffPerson = await db.asUser('u-it-ex3', async (_svc, u) => u.personId!);
    await db.asUser('u-pwvsb-hr', (svc, u) =>
      svc.recordTraining(u, { personId: staffPerson, course: 'Synthetic course', provider: 'Synthetic', from: today, to: today, hours: 4, cost: null, hrdRef: null, certificateRef: null }),
    );
    assert.equal((await db.asUser('u-it-ex3', (svc, u) => svc.trainingRecords(u))).rows.length, 1);
    assert.equal(await count('co-sasa', 'staff_training'), 0, 'another company sees nothing');
    const mgr = await db.asUser('u-it-ex1', async (_svc, u) => u.id);
    const a = await db.asUser('u-pwvsb-hr', (svc, u) => svc.openAppraisal(u, { personId: staffPerson, year: today.slice(0, 4), appraiserId: mgr }));
    await assert.rejects(db.asUser('u-pwvsb-hr', (svc, u) => svc.rateAppraisal(u, a.id, { rating: 4, strengths: 'Not the appraiser', improve: '', trainingNeeds: '' })));
    await db.asUser('u-it-ex1', (svc, u) => svc.rateAppraisal(u, a.id, { rating: 4, strengths: 'Synthetic strengths', improve: '', trainingNeeds: '' }));
    await db.asUser('u-it-ex3', (svc, u) => svc.commentAppraisal(u, a.id, ''));
    const p = await db.asUser('u-pwvsb-hr', (svc, u) => svc.publishPolicy(u, { id: null, kind: 'handbook', title: 'Synthetic handbook', body: 'Synthetic handbook text for the test.' }));
    await db.asUser('u-it-ex3', (svc, u) => svc.acknowledgePolicy(u, p.id));
    const seen = await db.asUser('u-pwvsb-hr', (svc, u) => svc.hrPolicies(u));
    assert.ok(!seen.rows.find((r) => r.id === p.id)!.missing!.some((m) => m.personId === staffPerson));
  });

  it('lets HR and the guard’s own company head record CSG under the company wall, and no other company', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const [{ id: guardId }] = await admin<{ id: string }>(`SELECT id FROM prima.people WHERE company_id = 'co-sasa' AND data->>'role' = 'guard' AND data->>'status' = 'active' LIMIT 1`);
    await db.asUser('u-cm-sasa', (svc, u) => svc.recordGuardPaper(u, { personId: guardId, type: 'CSG_TRAINING', number: 'CSG-TEST-1', issuedOn: today, expiresOn: null }));
    await db.asUser('u-pwvsb-hr', (svc, u) => svc.recordGuardPaper(u, { personId: guardId, type: 'TNG_TRAINING', number: 'TNG-TEST-1', issuedOn: today, expiresOn: null }));
    await assert.rejects(db.asUser('u-cm-arsh', (svc, u) => svc.recordGuardPaper(u, { personId: guardId, type: 'CSG_TRAINING', number: 'CSG-TEST-2', issuedOn: today, expiresOn: null })));
    const seen = await db.asUser('u-cm-sasa', (svc, u) => svc.guardTraining(u));
    assert.deepEqual(seen.summary.map((s) => s.companyId), ['co-sasa']);
    assert.equal(seen.rows.find((r) => r.personId === guardId)?.csg.level, 'ok');
  });

  it('lets ACT read Asset Management records but never change them', async () => {
    const [{ id }] = await admin<{ id: string }>('SELECT id FROM prima.am_units LIMIT 1');
    const upd = await asApp('asset_read,act', `UPDATE prima.am_units SET data = data || '{"note":"x"}' WHERE id = $1`, [id]);
    assert.equal(upd.rowCount, 0);
    await assert.rejects(
      asApp('asset_read,act', `INSERT INTO prima.am_units (id, data) VALUES ('am-test', '{"id":"am-test"}')`),
      /row-level security/,
    );
    const ok = await asApp('asset_read,asset_write', `UPDATE prima.am_units SET data = data || '{}' WHERE id = $1`, [id]);
    assert.equal(ok.rowCount, 1);
  });

  it("shows the owner of an ACT finding their own finding, and nobody else's", async () => {
    const [f] = await admin<{ id: string; owner: string }>(`SELECT id, data->>'ownerUserId' AS owner FROM prima.act_findings LIMIT 1`);
    const mine = await asApp('', `SELECT id FROM prima.act_findings`, [], f.owner);
    assert.ok(mine.rows.some((r) => r.id === f.id));
    assert.ok(mine.rows.every((r) => r.id !== undefined));
    const total = await count('act', 'act_findings');
    assert.ok(mine.rowCount! < total, 'an owner sees only their own');
  });

  it('sends each request the walls the person passes, so a department head reads only their department', async () => {
    const seen = (uid: string, table: string) => db.asUser(uid, async (svc) => (await (svc as unknown as { store: { list(t: string, f: object): Promise<unknown[]> } }).store.list(table, {})).length);
    assert.ok((await seen('u-asset-mm', 'amUnits')) > 0);
    assert.equal(await seen('u-asset-mm', 'pdpaCases'), 0);
    assert.equal(await seen('u-it-ex1', 'amUnits'), 0);
    assert.ok((await seen('u-it-ex1', 'bcmSystems')) > 0);
    assert.equal(await seen('u-pwvsb-hr', 'actAudits'), 0);
    assert.ok((await seen('u-fauzan', 'pdpaCases')) > 0);
  });

  it('keeps company secretary records, legal matters and mandates behind their Central Admin walls', async () => {
    // The proposed Central Admin module is not in the release manifest yet; install it here, in the throwaway database.
    await admin(readFileSync(resolve(__dirname, '../../../../db/modules/central-admin-walls-v1.sql'), 'utf8'));
    // Every company visible, as for a group sign-in: only the wall decides.
    const [{ ids }] = await admin<{ ids: string }>(`SELECT string_agg(DISTINCT company_id, ',') AS ids FROM prima.corp_filings`);
    const n = async (walls: string, table: string) => {
      const c = new Client({ connectionString: URL });
      await c.connect();
      try {
        await c.query('BEGIN');
        await c.query('SET LOCAL ROLE prima_app');
        await c.query(`SELECT set_config('app.walls', $1, true), set_config('app.company_ids', $2, true)`, [walls, ids]);
        const r = await c.query(`SELECT count(*) AS n FROM prima.${table}`);
        await c.query('ROLLBACK');
        return Number(r.rows[0].n);
      } finally {
        await c.end();
      }
    };
    for (const t of ['corp_profiles', 'corp_filings', 'corp_changes', 'corp_audits', 'legal_matters', 'gov_mandates']) {
      assert.equal(await n('', t), 0, `${t} with no wall`);
      assert.equal(await n('asset_read,asset_write,act,pdpa,bcm,offboard', t), 0, `${t} with every other wall`);
    }
    assert.ok((await n('corporate', 'corp_filings')) > 0);
    assert.equal(await n('corporate', 'legal_matters'), 0, 'the corporate wall does not open legal matters');
    assert.ok((await n('legal', 'legal_matters')) > 0);
    assert.ok((await n('mandates', 'gov_mandates')) > 0);
    // The wall narrows the company wall, never widens it: no company visible, nothing comes through.
    const c = new Client({ connectionString: URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE prima_app');
      await c.query(`SELECT set_config('app.walls', 'corporate,legal,mandates', true)`);
      assert.equal(Number((await c.query('SELECT count(*) AS n FROM prima.corp_filings')).rows[0].n), 0);
      await assert.rejects(
        c.query(`INSERT INTO prima.corp_filings (id, company_id, data) VALUES ('cf-x', 'co-sasa', '{"id":"cf-x","companyId":"co-sasa"}')`),
        /row-level security/,
      );
      await c.query('ROLLBACK');
    } finally {
      await c.end();
    }
  });

  it('gives each person the Central Admin walls their work needs', async () => {
    const seen = (uid: string, table: string) => db.asUser(uid, async (svc) => (await (svc as unknown as { store: { list(t: string, f: object): Promise<unknown[]> } }).store.list(table, {})).length);
    assert.ok((await seen('u-cm-sasa', 'corpFilings')) > 0);
    assert.ok((await seen('u-cm-sasa', 'govMandates')) > 0);
    assert.ok((await seen('u-cosec', 'corpFilings')) > 0);
    assert.equal(await seen('u-cosec', 'legalMatters'), 0, 'the company secretary does not see legal matters');
    assert.equal(await seen('u-cosec', 'govMandates'), 0);
    assert.ok((await seen('u-legal', 'legalMatters')) > 0);
    assert.ok((await seen('u-dcos', 'corpChanges')) >= 0);
    // Central departments with company grants for other work see none of it.
    for (const uid of ['u-pwvsb-hr', 'u-fwm-ex1']) {
      assert.equal(await seen(uid, 'corpFilings'), 0, uid);
      assert.equal(await seen(uid, 'legalMatters'), 0, uid);
      assert.equal(await seen(uid, 'govMandates'), 0, uid);
    }
  });

  it('keeps the Central Admin panel firms working before and after their module is installed, behind the walls', async () => {
    // Not installed: audits are checked against the starting list and nobody can add a firm.
    const before = await db.asUser('u-dcos', (svc, u) => svc.panelBoard(u));
    assert.equal(before.installed, false);
    assert.ok((await db.asUser('u-dcos', (svc, u) => svc.corpAuditLegal(u))).audits.length >= 0);
    await assert.rejects(
      db.asUser('u-dcos', (svc, u) => svc.addPanelFirm(u, { kind: 'AUDIT', name: 'Audit firm 1 (mock)', regNo: 'AF 1 (mock)', appointedOn: '2026-01-10' })),
      /not set up/,
    );
    await admin(readFileSync(resolve(__dirname, '../../../../db/modules/central-admin-panel-v1.sql'), 'utf8'));
    await db.asUser('u-dcos', (svc, u) => svc.addPanelFirm(u, { kind: 'AUDIT', name: 'Audit firm 1 (mock)', regNo: 'AF 1 (mock)', appointedOn: '2026-01-10' }));
    await db.asUser('u-legal', (svc, u) => svc.addPanelFirm(u, { kind: 'LAW', name: 'Law firm 1 (mock)', regNo: 'LF 1 (mock)', appointedOn: '2026-01-10' }));
    await assert.rejects(
      db.asUser('u-dcos', (svc, u) => svc.addPanelFirm(u, { kind: 'LAW', name: 'Law firm 2 (mock)', regNo: 'LF 2 (mock)', appointedOn: '2026-01-10' })),
      /legal keeps/,
    );
    const seen = (uid: string) => db.asUser(uid, async (svc) => (await (svc as unknown as { store: { list(t: string, f: object): Promise<unknown[]> } }).store.list('panelFirms', {})).length);
    assert.equal(await seen('u-dcos'), 2);
    assert.equal(await seen('u-legal'), 2);
    for (const uid of ['u-pwvsb-hr', 'u-fwm-ex1']) assert.equal(await seen(uid), 0, uid);
    await assert.rejects(
      asApp('asset_read,act,offboard', `INSERT INTO prima.panel_firms (id, data) VALUES ('pf-x', '{"id":"pf-x"}')`),
      /row-level security/,
    );
    await assert.rejects(asApp('corporate', `DELETE FROM prima.panel_firms`), /permission denied/);
  });

  it('never lets the API change accounts or grants directly', async () => {
    await assert.rejects(asApp('offboard', `UPDATE prima.users SET data = data || '{"accessClosedFrom":"2026-01-01"}' WHERE id = 'u-it-ex3'`), /permission denied/);
    await assert.rejects(asApp('offboard', `UPDATE prima.grants SET data = data WHERE id = 'x'`), /permission denied/);
  });

  it('closes access only for HR, the HR Director or the CEO, never your own, the CEO or a system feed', async () => {
    const closed = JSON.stringify({ by: 'Test', at: '2026-10-31T10:00:00+08:00', reason: 'Test' });
    const call = (walls: string, target: string, userId = 'u-pwvsb-hr') =>
      asApp(walls, `SELECT prima.close_access($1, $2::date, $3::jsonb) AS n`, [target, '2030-01-01', closed], userId);
    await assert.rejects(call('', 'u-it-ex3'), /Only HR/);
    await assert.rejects(call('asset_read,asset_write,act,pdpa,bcm', 'u-it-ex3'), /Only HR/);
    await assert.rejects(call('offboard', 'u-pwvsb-hr'), /own access/);
    await assert.rejects(call('offboard', 'u-fauzan'), /cannot be closed/);
    await assert.rejects(call('offboard', 'u-ja-sync'), /cannot be closed/);
    const [{ data }] = await admin<{ data: User }>(`SELECT data FROM prima.users WHERE id = 'u-it-ex3'`);
    assert.equal(data.accessClosedFrom, undefined, 'nothing changed by the refused calls');
  });

  it('files a JA guard through the feed: full numbers behind the HR wall, guard rows only, FWM reads foreign passports only (slice 3G)', async () => {
    const code = (await admin<{ code: string }>(`SELECT data->>'code' AS code FROM prima.companies WHERE id = 'co-sasa'`))[0].code;
    const g = {
      company: code, externalId: 'G-RLS-1', updatedAt: '2026-10-26T10:00:00+08:00', staffNo: 'JA-RLS-1', name: 'Synthetic Guard', nationality: 'NP',
      role: 'guard', status: 'active', dob: '1992-02-02', hiredOn: '2025-03-01', state: 'Selangor', idFull: 'NP-TEST-998877', accountFull: '99887766', bankName: 'Test Bank', basicPay: 1800,
    };
    const r = await db.asUser('u-ja-sync', (svc, u) => svc.jaIngest(u, 'guard', [g]));
    assert.equal(r.accepted, 1, JSON.stringify(r.rejected));
    const [rec] = await admin<{ d: string }>(`SELECT data::text AS d FROM prima.ja_records WHERE id = 'ja:guard:co-sasa:G-RLS-1'`);
    assert.ok(!rec.d.includes('NP-TEST-998877') && !rec.d.includes('99887766'), 'no full number on the JA record');
    const pid = JSON.parse(rec.d).guard.personId as string;
    const [person] = await admin<{ d: string }>(`SELECT data::text AS d FROM prima.people WHERE id = $1`, [pid]);
    assert.ok(!person.d.includes('NP-TEST-998877'), 'no full number on the person');
    const [ids] = await admin<{ d: string }>(`SELECT data::text AS d FROM prima.staff_ids WHERE id = $1`, [pid]);
    assert.equal(JSON.parse(ids.d).guard, true);
    assert.equal(JSON.parse(ids.d).foreign, true);
    // The feed's wall touches guard rows only.
    const asWall = async (walls: string, companies: string, sql: string) => {
      const c = new Client({ connectionString: URL });
      await c.connect();
      try {
        await c.query('BEGIN');
        await c.query('SET LOCAL ROLE prima_app');
        await c.query(`SELECT set_config('app.walls', $1, true)`, [walls]);
        await c.query(`SELECT set_config('app.company_ids', $1, true)`, [companies]);
        const res = await c.query(sql);
        await c.query('COMMIT');
        return res;
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        await c.end();
      }
    };
    await admin(`INSERT INTO prima.staff_ids (id, data) VALUES ('pr-office', '{"id":"pr-office","companyId":"co-sasa","idFull":"1"}') ON CONFLICT DO NOTHING`);
    const seen = async (walls: string, companies = 'co-sasa') => (await asWall(walls, companies, `SELECT id FROM prima.staff_ids WHERE id IN ('pr-office', '${pid}') ORDER BY id`)).rows.map((x) => x.id);
    assert.deepEqual(await seen('guard_feed'), [pid], 'the feed sees its guard, not office staff');
    assert.deepEqual(await seen('guard_feed', 'co-arsh'), [], 'only for companies it is granted');
    await assert.rejects(asWall('guard_feed', 'co-sasa', `INSERT INTO prima.staff_ids (id, data) VALUES ('pr-feed-x', '{"id":"pr-feed-x","companyId":"co-sasa"}')`), /row-level security/);
    assert.deepEqual(await seen('fw_ids'), [pid], 'FWM reads the foreign guard passport only');
    assert.equal((await asWall('fw_ids', 'co-sasa', `SELECT id FROM prima.staff_accounts WHERE id = '${pid}'`)).rowCount, 0, 'FWM never reads the account');
    assert.equal((await asWall('fw_ids', 'co-sasa', `UPDATE prima.staff_ids SET data = data WHERE id = '${pid}'`)).rowCount, 0, 'FWM never changes it');
    // Wrong company: the feed's wall never writes a guard row for a company it is not granted.
    await assert.rejects(
      asWall('guard_feed', 'co-sasa', `INSERT INTO prima.staff_ids (id, data) VALUES ('pr-arsh-g', '{"id":"pr-arsh-g","companyId":"co-arsh","guard":true}')`),
      /row-level security/,
    );
    await assert.rejects(
      asWall('guard_feed', 'co-sasa', `INSERT INTO prima.staff_accounts (id, data) VALUES ('pr-arsh-g', '{"id":"pr-arsh-g","companyId":"co-arsh","guard":true}')`),
      /row-level security/,
    );
  });

  it('keeps the HR legal points behind the directors-only hr_legal wall (review, 2 Nov 2026)', async () => {
    await db.asUser('u-cos', (svc, u) => svc.updateHrLegalCheck(u, 'face-data', { status: 'in_review', directorId: 'u-cos', note: 'Synthetic check' }));
    for (const walls of ['', 'staff_ids,staff_accounts,staff_faces,hr_cases,offboard', 'staff_company'])
      assert.equal(await count(walls, 'hr_legal_checks'), 0, `no row with walls '${walls}'`);
    assert.equal(await count('hr_legal', 'hr_legal_checks'), 1);
    await assert.rejects(asApp('staff_ids', `INSERT INTO prima.hr_legal_checks (id, data) VALUES ('x', '{"id":"x"}')`), /row-level security/);
    await assert.rejects(db.asUser('u-pwvsb-hr', (svc, u) => svc.hrLegalChecks(u)));
    const ceo = await db.asUser('u-fauzan', (svc, u) => svc.hrLegalChecks(u));
    assert.equal(ceo.rows.find((r) => r.id === 'face-data')!.status, 'in_review');
  });

  it('refuses a JA row that matches an office staff member, on PostgreSQL, and keeps the rest of the delivery (review, 2 Nov 2026)', async () => {
    const code = (await admin<{ code: string }>(`SELECT data->>'code' AS code FROM prima.companies WHERE id = 'co-sasa'`))[0].code;
    const [office] = await admin<{ id: string; staff_no: string; d: string }>(
      `SELECT id, data->>'staffNo' AS staff_no, data::text AS d FROM prima.people WHERE data->>'companyId' = 'co-sasa' AND data->>'role' = 'office' ORDER BY id LIMIT 1`,
    );
    assert.ok(office, 'the mock data has an office staff member in the company');
    const base = { company: code, updatedAt: '2026-10-26T10:00:00+08:00', name: 'Synthetic Guard', nationality: 'MY', role: 'guard', status: 'active', dob: '1991-01-01', hiredOn: '2025-01-01', idFull: '910101-01-0001', accountFull: '11112222' };
    // A guard whose full IC row HR already keeps without the guard mark: hidden from the feed's wall, so the insert
    // collides. The savepoint must undo that guard alone.
    await admin(`INSERT INTO prima.staff_ids (id, data) VALUES ('p-ja-co-sasa-JA-HIDDEN', '{"id":"p-ja-co-sasa-JA-HIDDEN","companyId":"co-sasa","idFull":"HR-KEPT"}') ON CONFLICT DO NOTHING`);
    const r = await db.asUser('u-ja-sync', (svc, u) =>
      svc.jaIngest(u, 'guard', [
        { ...base, externalId: 'G-COLLIDE', staffNo: office.staff_no },
        { ...base, externalId: 'G-HIDDEN', staffNo: 'JA-HIDDEN' },
        { ...base, externalId: 'G-FINE', staffNo: 'JA-FINE', idFull: '910101-01-0002' },
      ]),
    );
    assert.deepEqual(r.rejected.map((x) => x.externalId).sort(), ['G-COLLIDE', 'G-HIDDEN']);
    assert.ok(r.rejected.every((x) => !/prima\.|policy|duplicate key|staff_ids/i.test(x.reason)), JSON.stringify(r.rejected));
    assert.equal(r.accepted, 1);
    const [after] = await admin<{ d: string }>(`SELECT data::text AS d FROM prima.people WHERE id = $1`, [office.id]);
    assert.equal(after.d, office.d, 'the office staff member is unchanged');
    assert.equal((await admin(`SELECT 1 FROM prima.people WHERE id = 'p-ja-co-sasa-JA-HIDDEN'`)).length, 0, 'the refused guard left nothing behind');
    const [kept] = await admin<{ f: string }>(`SELECT data->>'idFull' AS f FROM prima.staff_ids WHERE id = 'p-ja-co-sasa-JA-HIDDEN'`);
    assert.equal(kept.f, 'HR-KEPT');
    assert.equal((await admin(`SELECT 1 FROM prima.ja_records WHERE id IN ('ja:guard:co-sasa:G-COLLIDE', 'ja:guard:co-sasa:G-HIDDEN')`)).length, 0);
    const [fine] = await admin<{ d: string }>(`SELECT data::text AS d FROM prima.ja_records WHERE id = 'ja:guard:co-sasa:G-FINE'`);
    assert.ok(fine && !fine.d.includes('910101-01-0002'), 'the good guard is filed, masked');
  });

  it("refuses a leaver's every request and Microsoft sign-in once HR closes the access, and ends their grants", async () => {
    const oid = '0c0c0c0c-0000-4000-8000-0000000000a1';
    const c = await db.pool.connect();
    try {
      await linkEntra(c, 'u-om-klang', oid, 'Test');
    } finally {
      c.release();
    }
    const before = await db.asUser('u-om-klang', async (_svc, u) => u);
    assert.equal(before.id, 'u-om-klang');
    const r = await db.asUser('u-pwvsb-hr', (svc, hr) => svc.closeAccess(hr, 'u-om-klang', { reason: 'Resigned (test)' }));
    assert.ok(r.grantsEnded > 0);
    await assert.rejects(db.asUser('u-om-klang', async (_svc, u) => u), AccessClosed);
    await assert.rejects(userForEntra(db, { oid, tid: 'x' } as never), /closed from/);
    const today = r.from;
    const grants = (await admin<{ data: AuthorityGrant }>(`SELECT data FROM prima.grants WHERE data->>'userId' = 'u-om-klang'`)).map((g) => g.data);
    assert.deepEqual(activeGrants(before, grants, today), []);
    const [audit] = await admin<{ n: string }>(`SELECT count(*) AS n FROM prima.audit WHERE data->>'action' = 'user.access.close' AND data->>'entityId' = 'u-om-klang'`);
    assert.equal(Number(audit.n), 1);
    // Someone outside HR is refused by the service before the database is asked.
    await assert.rejects(db.asUser('u-it-mgr', (svc, u) => svc.closeAccess(u, 'u-it-ex4', { reason: 'Resigned' })), /closes access/);
  });

  it('sets a PIN through HR, keeps only its hash and never logs the PIN', async () => {
    const [p] = await admin<{ id: string }>(`SELECT id FROM prima.people WHERE company_id = 'co-sasa' AND data->>'role' = 'guard' AND data->>'status' = 'active' LIMIT 1`);
    await db.asUser('u-pwvsb-hr', (svc, hr) => svc.setStaffPin(hr, p.id, '5823'));
    const [row] = await admin<{ data: { pinHash: string } }>('SELECT data FROM prima.people WHERE id = $1', [p.id]);
    assert.match(row.data.pinHash, /^h1\$/);
    assert.ok(apiPinKeeper({}).matches(row.data.pinHash, '5823'));
    const logged = await admin<{ s: string }>(`SELECT data->>'summary' AS s FROM prima.audit WHERE data->>'action' = 'person.pin' AND data->>'entityId' = $1`, [p.id]);
    assert.equal(logged.length, 1);
    assert.doesNotMatch(logged[0].s, /5823/);
  });

  it('turns PINs kept as typed into hashes only when told to, with the real key, and never prints them', async () => {
    await admin(`UPDATE prima.people SET data = (data - 'pinHash') || '{"pin":"7391"}' WHERE id = (SELECT id FROM prima.people WHERE company_id = 'co-sasa' ORDER BY id LIMIT 1)`);
    await admin(`UPDATE prima.people SET data = (data - 'pinHash') || '{"pin":""}' WHERE id = (SELECT id FROM prima.people WHERE company_id = 'co-arsh' ORDER BY id LIMIT 1)`);
    // Review of PR #34: a person with an old typed PIN (A) whom HR then gives a new PIN (B). Only B may work afterwards,
    // and the conversion must keep B's hash, never bring back A.
    const [{ id: ab }] = await admin<{ id: string }>(`SELECT id FROM prima.people WHERE company_id = 'co-sasa' AND data->>'role' = 'guard' AND data->>'status' = 'active' ORDER BY id OFFSET 1 LIMIT 1`);
    await admin(`UPDATE prima.people SET data = (data - 'pinHash') || '{"pin":"6152"}' WHERE id = $1`, [ab]);
    await db.asUser('u-pwvsb-hr', (svc, hr) => svc.setStaffPin(hr, ab, '8274'));
    const [afterSet] = await admin<{ data: { pin?: string | null; pinHash: string } }>('SELECT data FROM prima.people WHERE id = $1', [ab]);
    assert.equal(afterSet.data.pin ?? null, null, 'setting a new PIN blanks the typed one at once');
    const key = { PIN_PEPPER: 'q'.repeat(40) };
    const c = await db.pool.connect();
    try {
      await assert.rejects(hashPins(c, 'Test', true, { PIN_PEPPER: DEMO_PIN_KEY }), /Nothing was changed/);
      await assert.rejects(hashPins(c, '', true, key), /--by/);
      assert.deepEqual(await hashPins(c, 'Test', false, key), { hashed: 1, kept: 1, cleared: 1, applied: false });
      assert.equal((await admin(`SELECT 1 FROM prima.people WHERE data ? 'pin'`)).length, 3, 'a dry run changes nothing');
      assert.deepEqual(await hashPins(c, 'Test', true, key), { hashed: 1, kept: 1, cleared: 1, applied: true });
    } finally {
      c.release();
    }
    assert.equal((await admin(`SELECT 1 FROM prima.people WHERE data ? 'pin'`)).length, 0);
    const [row] = await admin<{ data: { pinHash: string } }>(`SELECT data FROM prima.people WHERE company_id = 'co-sasa' ORDER BY id LIMIT 1`);
    assert.ok(apiPinKeeper({ NODE_ENV: 'production', ...key }).matches(row.data.pinHash, '7391'));
    const [abRow] = await admin<{ data: { pinHash: string } }>('SELECT data FROM prima.people WHERE id = $1', [ab]);
    assert.equal(abRow.data.pinHash, afterSet.data.pinHash, 'the conversion keeps the hash HR set');
    assert.ok(db.pins.matches(abRow.data.pinHash, '8274'));
    assert.equal(db.pins.matches(abRow.data.pinHash, '6152'), false);
    const [entry] = await admin<{ s: string }>(`SELECT data->>'summary' AS s FROM prima.audit WHERE data->>'action' = 'PIN_HASH'`);
    assert.match(entry.s, /1 hashed, 1 already reset by HR .*, 1 empty/);
    assert.doesNotMatch(entry.s, /7391/);
  });
});
