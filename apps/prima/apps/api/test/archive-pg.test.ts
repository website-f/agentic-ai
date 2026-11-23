// Data and file manager on PostgreSQL (Fauzan, 23 Nov 2026). Before module archive-v1 it says it is not installed;
// after it, the walls hold in the database even when the application is bypassed, nothing is deleted, and a kept
// file's fingerprint never changes. File storage is the in-memory stand-in. Synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { myt, type PrimaService, type User } from '@prima/core';
import { BackendArchiveBytes } from '../src/archive-bytes';
import { Db } from '../src/db';
import { MemoryFiles } from '../src/file-store';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const NOW = myt('2026-11-23', '10:00');
const PDF = Buffer.from('%PDF-1.4 synthetic old record');

async function admin(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

describe('Data and file manager (PostgreSQL)', () => {
  let db: Db;
  const files = new MemoryFiles();
  const bytes = new BackendArchiveBytes(files);
  const as = <R>(id: string, fn: (svc: PrimaService, u: User) => Promise<R>) =>
    db.asUser(id, (svc, u) => {
      svc.archiveBytes = bytes;
      return fn(svc, u);
    }, () => NOW);
  const add = (id: string, fileName: string, data: Buffer, details: Record<string, unknown> = {}) =>
    as(id, async (svc, u) => {
      const s = await svc.archive.start(u, { fileName, size: data.length, ...details });
      await svc.archive.part(u, s.id, 0, data.toString('base64'));
      return svc.archive.finish(u, s.id, { checked: true });
    });

  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('says it is not installed before the module, and lists nothing', async () => {
    await assert.rejects(as('u-finance-am', (svc, u) => svc.archive.start(u, { fileName: 'a.pdf', size: 10 })), /archive-v1/);
    const l = await as('u-finance-am', (svc, u) => svc.archive.list(u));
    assert.equal(l.installed, false);
  });

  let finId = '';
  let payId = '';
  it('keeps a file after the module is installed; the bytes are not in the row', async () => {
    await admin(readFileSync(resolve(__dirname, '../../../../db/modules/archive-v1.sql'), 'utf8'));
    // Repeat-safe.
    await admin(readFileSync(resolve(__dirname, '../../../../db/modules/archive-v1.sql'), 'utf8'));
    const r = await add('u-finance-am', 'bank letter 2019.pdf', PDF, { folder: 'finance', words: 'Bank letter (mock)' });
    finId = r.file.id;
    assert.equal(r.file.status, 'filed');
    const row = (await admin('SELECT data FROM prima.archive_files WHERE id = $1', [finId])).rows[0].data;
    assert.equal(row.size, PDF.length);
    assert.match(row.sha256, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(row).includes(PDF.toString('base64')));
    assert.ok(files.blobs.has(row.key));
    payId = (await add('u-transport', 'driver payslips 2020.pdf', Buffer.from('%PDF-1.4 synthetic payslips'), { folder: 'pay' })).file.id;
  });

  it('the database itself keeps units apart, with the application bypassed', async () => {
    const ids = (id: string) => as(id, async (svc) => (await (svc as any).store.list('archiveFiles', {})).map((f: { id: string }) => f.id).sort());
    assert.deepEqual(await ids('u-finance-am'), [finId]);
    assert.deepEqual(await ids('u-transport'), [payId]);
    // Central HR reads the restricted pay file, not Finance's ordinary file. A group leader reads both.
    assert.deepEqual(await ids('u-pwvsb-hr'), [payId]);
    assert.deepEqual(await ids('u-fauzan'), [finId, payId].sort());
    // A guard reads nothing.
    assert.deepEqual(await ids('u-guard-sasa-1'), []);
  });

  it('refuses a forged insert, a delete, and a change to a kept file\'s fingerprint, unit or uploader', async () => {
    const row = (await admin('SELECT data FROM prima.archive_files WHERE id = $1', [finId])).rows[0].data;
    // For another unit, or in another person's name, or already "filed".
    await assert.rejects(as('u-transport', (svc) => (svc as any).store.insert('archiveFiles', { ...row, id: 'arc-forged-1', key: row.key.replace(/arc-[a-z0-9-]+/, 'arc-forged-1'), status: 'uploading', uploadedById: 'u-transport' })), /row-level security/);
    await assert.rejects(as('u-finance-am', (svc) => (svc as any).store.insert('archiveFiles', { ...row, id: 'arc-forged-2', key: row.key.replace(/arc-[a-z0-9-]+/, 'arc-forged-2'), status: 'uploading', uploadedById: 'u-fauzan' })), /row-level security/);
    await assert.rejects(as('u-finance-am', (svc) => (svc as any).store.insert('archiveFiles', { ...row, id: 'arc-forged-3', key: row.key.replace(/arc-[a-z0-9-]+/, 'arc-forged-3') })), /row-level security/);
    await assert.rejects(as('u-finance-am', (svc) => (svc as any).store.update('archiveFiles', finId, { sha256: 'a'.repeat(64) })), /fingerprint never change/);
    await assert.rejects(as('u-finance-am', (svc) => (svc as any).store.update('archiveFiles', finId, { owner: 'dept:hr' })), /never change/);
    await assert.rejects(as('u-finance-am', (svc) => (svc as any).store.update('archiveFiles', finId, { uploadedById: 'u-fauzan' })), /never change/);
    // Transport cannot touch Finance's row at all: the update finds nothing.
    await assert.rejects(as('u-transport', (svc) => (svc as any).store.update('archiveFiles', finId, { title: 'Mine' })));
    const del = new Client({ connectionString: URL });
    await del.connect();
    try {
      await del.query('BEGIN');
      await del.query('SET LOCAL ROLE prima_app');
      await assert.rejects(del.query('DELETE FROM prima.archive_files'), /permission denied/);
      await del.query('ROLLBACK');
    } finally {
      await del.end();
    }
  });

  it('opens with a fingerprint check, corrects details, and sets aside without deleting', async () => {
    const o = await as('u-finance-am', (svc, u) => svc.archive.open(u, finId));
    const piece = await as('u-finance-am', (svc, u) => svc.archive.openPart(u, o.id, 0, o.pass));
    assert.equal(Buffer.from(piece).toString(), PDF.toString());
    await assert.rejects(as('u-finance-am', (svc, u) => svc.archive.openPart(u, o.id, 0, 'guess')), /not opened first/);
    await assert.rejects(as('u-transport', (svc, u) => svc.archive.openPart(u, o.id, 0, o.pass)), /not found/i);
    await assert.rejects(as('u-transport', (svc, u) => svc.archive.open(u, finId)), /not found/i);
    const v = await as('u-finance-am', (svc, u) => svc.archive.setDetails(u, finId, { title: 'Bank letter June 2019 (mock)', docDate: '2019-06-30' }));
    assert.equal(v.year, 2019);
    await as('u-finance-am', (svc, u) => svc.archive.setAside(u, finId, 'Belongs to another company (mock)'));
    await assert.rejects(as('u-finance-am', (svc) => (svc as any).store.update('archiveFiles', finId, { title: 'Changed after' })), /set aside or marked duplicate/);
    assert.equal((await admin('SELECT count(*)::int AS n FROM prima.archive_files')).rows[0].n, 2);
    const acts = (await admin(`SELECT data->>'action' AS a FROM prima.audit WHERE data->>'action' LIKE 'archive.%' ORDER BY seq`)).rows.map((r) => r.a);
    assert.deepEqual(acts, ['archive.filed', 'archive.filed', 'archive.opened', 'archive.details', 'archive.set_aside']);
  });
});
