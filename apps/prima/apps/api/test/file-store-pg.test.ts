// Cloud file storage against a real local PostgreSQL, as the API's restricted role with the company wall on: the row
// in the database keeps only a reference, and the company wall still decides who sees the photo. In-memory file
// backend and synthetic data only. Run with DATABASE_URL pointing at a throwaway local database: the test resets it.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { Db } from '../src/db';
import { FileStore, MemoryFiles } from '../src/file-store';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

async function admin(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows;
  } finally {
    await c.end();
  }
}

describe('file storage with PostgreSQL and the company wall', () => {
  let db: Db;
  const backend = new MemoryFiles();
  before(async () => {
    await resetDb(URL);
    db = new Db();
    (db as unknown as { files: FileStore }).files = new FileStore(backend);
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('saves the photo outside the row and the wall still keeps other companies out', async () => {
    const image = 'data:image/jpeg;base64,' + Buffer.from('synthetic-pg-photo-'.repeat(300)).toString('base64');
    const picked = await db.asUser('u-cm-sasa', async (svc, u, store) => {
      const c = (await store.list('cases', { companyId: 'co-sasa' })).find((x) => x.siteId && x.status !== 'closed')!;
      const site = (await store.get('sites', c.siteId!))!;
      const p = await svc.addCasePhoto(u, c.id, { image, lat: site.lat, lng: site.lng, accuracyM: 5, capturedAt: svc.now() });
      return { caseId: c.id, photoId: p.id };
    });
    const rows = await admin('SELECT data FROM prima.evidence_photos WHERE id = $1', [picked.photoId]);
    assert.match(rows[0].data.image, /^prima-file:v1:evidencePhotos\/co-sasa\/[0-9a-f]{64}\.jpg$/);
    assert.equal(backend.blobs.size, 1);
    const seen = await db.asUser('u-cm-sasa', (svc, u) => svc.caseDetail(u, picked.caseId));
    assert.equal(seen.photos.find((p) => p.id === picked.photoId)!.image, image);
    // Inas's manager cannot reach Sasa's case or its photo row at all.
    await assert.rejects(db.asUser('u-cm-inas', (svc, u) => svc.caseDetail(u, picked.caseId)));
    assert.equal(await db.asUser('u-cm-inas', (_s, _u, store) => store.get('evidencePhotos', picked.photoId)), undefined);
  });
});
