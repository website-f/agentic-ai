// P93 (Fitri, 9 Nov 2026): who may add foreign workers and their old paper dates, and the board's phone sign-in state,
// through the real API service on PostgreSQL with the company walls on. Negative authorization: the Chief of Staff,
// the COO, a company manager, HR and despatch are refused at the server; a refused row leaves nothing. Synthetic data.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXTRA_IMPORTS, normaliseTable, prepareSheet, smartMatch, toCsv, type AlignField } from '@prima/core';
import { AccessDenied } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
process.env.DEV_TOKEN_SECRET = process.env.DEV_TOKEN_SECRET ?? 'test-secret';
process.env.PRIMA_ORG_LINKS = 'true';
process.env.PIN_PEPPER = process.env.PIN_PEPPER ?? 'p93-synthetic-pepper-for-tests-only-0123456789';
const sql = (f: string) => readFileSync(resolve(process.cwd(), /[\\/]apps[\\/]api$/.test(process.cwd()) ? `../../db/modules/${f}` : `db/modules/${f}`), 'utf8');

const NOT_ADDERS = ['u-cos', 'u-coo', 'u-cm-sasa', 'u-pwvsb-hr', 'u-fwm-desp'];

describe('P93 foreign workers on PostgreSQL', () => {
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
  const input = (staffNo: string) => ({ companyId: 'co-sasa', branchId: 'br-sasa-1', staffNo, name: 'Synthetic P93 Worker', dob: '1991-02-03', hiredOn: today });

  it('the owner adds a worker as FWM does; everyone else is refused and nothing is kept', async () => {
    for (const uid of NOT_ADDERS) await assert.rejects(db.asUser(uid, (svc, u) => svc.addFwWorker(u, input(`P93-PG-${uid}`))), AccessDenied, uid);
    assert.equal(await count("SELECT count(*) n FROM prima.people WHERE data->>'staffNo' LIKE 'P93-PG-u-%'"), 0);
    const r = await db.asUser('u-fauzan', (svc, u) => svc.addFwWorker(u, { ...input('P93-PG-OWN'), permitExpiresOn: '2027-12-31' }));
    assert.equal(r.papers, 1);
    assert.equal(await count("SELECT count(*) n FROM prima.audit WHERE data->>'action'='fwm.worker.add' AND data->>'summary' LIKE '%P93-PG-OWN%'"), 1);
    const owner = await db.asUser('u-fauzan', (svc, u) => svc.fwmBoard(u));
    assert.equal(owner.canWork, true);
    assert.equal(owner.canRecordPaper, false);
    assert.ok(owner.workers.some((w) => w.staffNo === 'P93-PG-OWN'));
    assert.ok(owner.workers.every((w) => w.papers.every((p) => p.number === null)));
    const cos = await db.asUser('u-cos', (svc, u) => svc.fwmBoard(u));
    assert.deepEqual([cos.canWork, cos.workers.length, cos.branches.length], [false, 0, 0]);
  });

  it('old paper dates import as opening records only where Prima has none; others cannot import them', async () => {
    await db.asUser('u-fwm-ex1', (svc, u) => svc.addFwWorker(u, input('P93-PG-OPEN')));
    const sheet = [
      ['ID Pekerja', 'Jenis Dokumen', 'No. Dokumen', 'Tarikh Tamat'],
      ['P93-PG-OPEN', 'PLKS', 'PLKS-PG-1', '30/06/2027'],
      ['P93-PG-OPEN', 'Pasport', 'PQ7654321', '31/01/2031'],
      ['P93-PG-OPEN', 'PLKS', 'PLKS-PG-2', '30/06/2028'],
    ];
    const fields = EXTRA_IMPORTS.fwPaper.fields as AlignField[];
    const prep = prepareSheet(sheet, fields);
    const m = smartMatch(prep.table, fields, { headerRow: prep.headerRow });
    const csv = toCsv(normaliseTable(prep.table, 0, m.columns, fields));
    const mapping = m.columns.map((c) => c.field ?? '');
    const p = await db.asUser('u-fwm-ex1', (svc, u) => svc.orgImport.preview(u, 'fwPaper', 'co-sasa', csv, { mapping }));
    assert.deepEqual(p.rows.map((r) => r.ok), [true, true, false]);
    assert.ok(!JSON.stringify(p).includes('PQ7654321'));
    for (const uid of NOT_ADDERS) {
      const q = await db.asUser(uid, (svc, u) => svc.orgImport.preview(u, 'fwPaper', 'co-sasa', csv, { mapping, skip: [4] }));
      assert.equal(q.canImport, false, uid);
      await assert.rejects(db.asUser(uid, (svc, u) => svc.orgImport.commit(u, 'fwPaper', 'co-sasa', csv, q.fingerprint, { mapping, skip: [4] })), uid);
    }
    const before = await count('SELECT count(*) n FROM prima.credentials');
    const ok = await db.asUser('u-fwm-ex1', (svc, u) => svc.orgImport.preview(u, 'fwPaper', 'co-sasa', csv, { mapping, skip: [4] }));
    const receipt = await db.asUser('u-fwm-ex1', (svc, u) => svc.orgImport.commit(u, 'fwPaper', 'co-sasa', csv, ok.fingerprint, { mapping, skip: [4] }));
    assert.equal(receipt.rows, 2);
    assert.equal(await count('SELECT count(*) n FROM prima.credentials'), before + 2);
    const rows = (
      await db.pool.query("SELECT c.data FROM prima.credentials c JOIN prima.people p ON p.id = c.data->>'personId' WHERE p.data->>'staffNo'='P93-PG-OPEN'")
    ).rows.map((x) => x.data);
    assert.deepEqual(rows.map((c) => [c.type, c.source, c.number, c.docIds.length]).sort(), [
      ['PASSPORT', 'typed', '****4321', 0],
      ['PLKS_PERMIT', 'typed', 'PLKS-PG-1', 0],
    ]);
    assert.equal(await count("SELECT count(*) n FROM prima.audit WHERE data->>'action'='fwm.paper.opening'"), 2);
    // The copy rule holds: the next permit is refused without its copy.
    const person = rows[0].personId as string;
    await assert.rejects(
      db.asUser('u-fwm-ex1', (svc, u) => svc.recordFwPaper(u, person, 'PLKS_PERMIT', { mode: 'new', number: 'PLKS-PG-3', issuedOn: today, expiresOn: '2028-06-30' }, [])),
      /Attach a copy/,
    );
  });

  it('the board shows each worker’s phone sign-in under the company wall; FWM cannot enrol it, the company office can', async () => {
    const np = (
      await db.pool.query(
        "SELECT u.id uid, p.id pid, p.data->>'staffNo' staff FROM prima.users u JOIN prima.people p ON p.id = u.data->>'personId' WHERE u.data->>'role'='guard' AND p.data->>'nationality'='NP' AND p.company_id='co-sasa' AND p.data->>'status'='active' LIMIT 1",
      )
    ).rows[0] as { uid: string; pid: string; staff: string };
    assert.ok(np, 'a synthetic Nepali guard with a guard sign-in');
    const row = async () => (await db.asUser('u-fwm-ex1', (svc, u) => svc.fwmBoard(u))).workers.find((w) => w.id === np.pid)!;
    assert.equal((await row()).phone.login, true);
    assert.equal((await row()).phone.canEnrol, false);
    await assert.rejects(db.asUser('u-fwm-ex1', (svc, u) => svc.guardPhone.issueCode(u, np.pid)), AccessDenied);
    await db.asUser('u-cm-sasa', (svc, u) => svc.setStaffPin(u, np.pid, '4826'));
    const code = await db.asUser('u-cm-sasa', (svc, u) => svc.guardPhone.issueCode(u, np.pid));
    assert.equal((await row()).phone.state, 'issued');
    const r = await db.asUser(np.uid, (svc, u) => svc.guardPhone.enrol(u, { phoneId: code.phoneId, code: code.code, staffNo: np.staff, deviceLabel: 'Android test' }));
    assert.equal(r.ok, true);
    const ready = await row();
    assert.equal(ready.phone.state, 'active');
    assert.ok(!JSON.stringify(ready).includes(code.code.replace('-', '')));
    // The worker's own duty, on their own sign-in: their own record only.
    const duty = await db.asUser(np.uid, (svc, u) => svc.myDuty(u));
    assert.equal(duty.person.id, np.pid);
  });
});
