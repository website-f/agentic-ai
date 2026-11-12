// K2 (Fauzan, 11 Nov 2026: "Yes, turn on" the staff directory bulk load). End to end on PostgreSQL with the
// staff-directory module and its row-level security, through the API's own service and route switch: HR loads a
// made-up file of 50 people plus one bad row, the bad row is refused with its reason, the HR Director approves with a
// comment, and all 50 appear exactly once. The switch stays an environment setting (STAFF_DIRECTORY_ENABLED); the test
// sets it only in this process. Synthetic rows only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';
import { StaffDirectoryController, staffDirectoryEnabled } from '../src/staff-directory.controller';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
process.env.DEV_TOKEN_SECRET = process.env.DEV_TOKEN_SECRET ?? 'test-secret';
const sql = (f: string) => readFileSync(resolve(process.cwd(), /[\\/]apps[\\/]api$/.test(process.cwd()) ? `../../db/modules/${f}` : `db/modules/${f}`), 'utf8');

const HEAD = 'group,org_unit,name,title,email,account_type,entra_status,verified,account_status';
const UNITS = ['UNIT IT', 'UNIT KEWANGAN', 'UNIT AUDIT', 'OPERASI JOHOR', 'OPERASI UTARA'];
const FIFTY = Array.from({ length: 50 }, (_, i) => {
  const n = String(i + 1).padStart(2, '0');
  const unit = UNITS[i % UNITS.length];
  return `${unit.startsWith('OPERASI') ? 'operations_region' : 'central_unit'},${unit},Kakitangan Contoh ${n},EKSEKUTIF,contoh${n}@example.test,Outlook HQ,Aktif,Telah Disahkan,Sedang digunakan`;
});
const BAD = 'central_unit,UNIT IT,,EKSEKUTIF,rosak@example.test,Outlook HQ,Aktif,Telah Disahkan,Sedang digunakan';
const TEXT = [HEAD, ...FIFTY.slice(0, 30), BAD, ...FIFTY.slice(30)].join('\n');
const SRC = 'synthetic-staff-50.csv';

describe('K2 staff directory bulk load on PostgreSQL', () => {
  let db: Db;
  const was = process.env.STAFF_DIRECTORY_ENABLED;
  before(async () => {
    await resetDb(URL);
    db = new Db();
    await db.pool.query(sql('staff-directory-v1.sql'));
  });
  after(async () => {
    if (was === undefined) delete process.env.STAFF_DIRECTORY_ENABLED;
    else process.env.STAFF_DIRECTORY_ENABLED = was;
    await db.onModuleDestroy();
  });

  it('stays off unless the environment switches it on', async () => {
    assert.equal(staffDirectoryEnabled({}), false);
    assert.equal(staffDirectoryEnabled({ STAFF_DIRECTORY_ENABLED: 'yes' }), false);
    assert.equal(staffDirectoryEnabled({ STAFF_DIRECTORY_ENABLED: 'true' }), true);
    delete process.env.STAFF_DIRECTORY_ENABLED;
    const c = new StaffDirectoryController(db);
    assert.deepEqual(await c.status('u-pwvsb-hr'), { enabled: false, ready: false });
    assert.throws(() => c.act('u-pwvsb-hr', 'preview', { text: TEXT, source: SRC }), /not switched on/);
  });

  it('HR loads 50 made-up people; the bad row is refused with its reason; the HR Director approves; all 50 appear once', async () => {
    process.env.STAFF_DIRECTORY_ENABLED = 'true';
    const c = new StaffDirectoryController(db);
    assert.deepEqual(await c.status('u-pwvsb-hr'), { enabled: true, ready: true });
    const p = (await c.act('u-pwvsb-hr', 'preview', { text: TEXT, source: SRC })) as unknown as { fingerprint: string; ready: number; rows: { row: number; errors: string[] }[] };
    assert.equal(p.ready, 50);
    const bad = p.rows.filter((r) => r.errors.length);
    assert.deepEqual(bad.map((r) => r.row), [32]);
    assert.match(bad[0].errors.join(' '), /Name is missing/);
    await assert.rejects(c.act('u-pwvsb-hr', 'submit', { text: TEXT, source: SRC, fingerprint: p.fingerprint }), /Fix row 32 first, or leave it out: row 32: Name is missing/);
    // IT may read the directory but not send a batch.
    await assert.rejects(c.act('u-it-mgr', 'submit', { text: TEXT, source: SRC, fingerprint: p.fingerprint, leaveOutBad: true }));
    const sent = (await c.act('u-pwvsb-hr', 'submit', { text: TEXT, source: SRC, fingerprint: p.fingerprint, leaveOutBad: true })) as unknown as { id: string; rows: number; refused: number };
    assert.deepEqual([sent.rows, sent.refused], [50, 1]);
    // HR cannot approve its own batch; the HR Director (Chief of Staff) approves with a comment.
    await assert.rejects(c.act('u-pwvsb-hr', 'decide', { batchId: sent.id, approve: true, comment: 'Own batch.' }));
    const d = (await c.act('u-cos', 'decide', { batchId: sent.id, approve: true, comment: 'Synthetic list checked.' })) as unknown as { added: number };
    assert.equal(d.added, 50);
    const rows = (await db.pool.query("SELECT data->>'name' AS name FROM prima.staff_directory")).rows.map((r) => r.name as string);
    assert.equal(rows.length, 50);
    assert.equal(new Set(rows).size, 50);
    const board = (await c.board('u-pwvsb-hr')) as unknown as { batches: { inFile: number; rows: number; refused: { row: number; reasons: string[] }[]; status: string; decidedBy: string }[] };
    assert.deepEqual(
      board.batches.map((b) => [b.status, b.inFile, b.rows, b.refused.length]),
      [['approved', 51, 50, 1]],
    );
    assert.match(board.batches[0].refused[0].reasons.join(' '), /Name is missing/);
    // The same file again is refused: nobody appears twice.
    await assert.rejects(c.act('u-pwvsb-hr', 'submit', { text: TEXT, source: SRC, fingerprint: p.fingerprint, leaveOutBad: true }), /already in the directory/);
    assert.equal(Number((await db.pool.query('SELECT count(*) n FROM prima.staff_directory')).rows[0].n), 50);
  });
});
