// Cloud file storage for app-captured photos and proof (5 Nov 2026). Synthetic data and an in-memory file backend
// only; the Azure backend is driven against a fake HTTP function, never a real storage account.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { BadRequest, MemoryStore, PrimaService, generateDataset, myt, type Store } from '@prima/core';
import { AzureBlobFiles, FILE_REF_PREFIX, FileStore, MemoryFiles, cacheMb, fileBackendFromEnv, fileStoreConfig } from '../src/file-store';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');
const jpeg = (n: number) => 'data:image/jpeg;base64,' + Buffer.from(`synthetic-photo-${n}-`.repeat(200)).toString('base64');
const pdf = (n: number) => 'data:application/pdf;base64,' + Buffer.from(`%PDF-1.4 synthetic ${n} `.repeat(200)).toString('base64');

function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const raw = new MemoryStore(ds);
  const backend = new MemoryFiles();
  const files = new FileStore(backend);
  const store = files.wrap(raw);
  return { ds, raw, backend, files, store, svc: new PrimaService(store, () => NOW) };
}

describe('file store settings', () => {
  it('is off unless switched on, and refuses half-filled settings', () => {
    assert.equal(fileStoreConfig({}), null);
    assert.equal(fileStoreConfig({ FILE_STORE: 'off' }), null);
    assert.equal(fileBackendFromEnv({}), null);
    assert.throws(() => fileStoreConfig({ FILE_STORE: 's3' }), /off or azure-blob/);
    assert.throws(() => fileStoreConfig({ FILE_STORE: 'azure-blob' }), /FILE_STORE_ACCOUNT/);
    assert.throws(() => fileStoreConfig({ FILE_STORE: 'azure-blob', FILE_STORE_ACCOUNT: 'Bad_Name' }), /FILE_STORE_ACCOUNT/);
    assert.throws(() => fileStoreConfig({ FILE_STORE: 'azure-blob', FILE_STORE_ACCOUNT: 'stexample', FILE_STORE_CONTAINER: 'Evidence!' }), /CONTAINER/);
    assert.throws(() => fileStoreConfig({ FILE_STORE: 'azure-blob', FILE_STORE_ACCOUNT: 'stexample', FILE_STORE_CLIENT_ID: 'not-a-guid' }), /CLIENT_ID/);
    assert.deepEqual(fileStoreConfig({ FILE_STORE: 'azure-blob', FILE_STORE_ACCOUNT: 'stexample' }), { account: 'stexample', container: 'evidence', clientId: null });
    // A mistyped cache size must not turn into an unlimited cache.
    assert.equal(cacheMb(undefined), 64);
    assert.equal(cacheMb('0'), 0);
    assert.equal(cacheMb('128'), 128);
    for (const bad of ['abc', '-1', '1.5', '5000']) assert.throws(() => cacheMb(bad), /FILE_STORE_CACHE_MB/);
  });
});

describe('photos and documents in cloud storage', () => {
  it('keeps an incident photo outside the row and gives back the exact same picture', async () => {
    const { ds, raw, backend, svc } = setup();
    const c = ds.cases.find((x) => x.companyId === 'co-sasa' && x.siteId && x.status === 'open')!;
    const site = ds.sites.find((x) => x.id === c.siteId)!;
    const cm = await svc.user('u-cm-sasa');
    const image = jpeg(1);
    const photo = await svc.addCasePhoto(cm, c.id, { image, lat: site.lat, lng: site.lng, accuracyM: 6, capturedAt: myt(TODAY, '10:28') });
    // The row in the database holds only a reference, filed under its kind of record and its company.
    const row = (await raw.get('evidencePhotos', photo.id))!;
    assert.match(row.image, /^prima-file:v1:evidencePhotos\/co-sasa\/[0-9a-f]{64}\.jpg$/);
    assert.equal(backend.blobs.size, 1);
    const bytes = Buffer.from(image.slice(image.indexOf(',') + 1), 'base64');
    assert.ok(backend.blobs.get(row.image.slice(FILE_REF_PREFIX.length))!.equals(bytes));
    // Screens get the picture back unchanged, and its fingerprint still matches.
    const d = await svc.caseDetail(cm, c.id);
    const back = d.photos.find((p) => p.id === photo.id)!;
    assert.equal(back.image, image);
    assert.equal(createHash('sha256').update(back.image).digest('hex'), photo.sha256);
    // Taking the same photo again is still refused, as before.
    await assert.rejects(svc.addCasePhoto(cm, c.id, { image, lat: site.lat, lng: site.lng }), /already attached/);
    // Another company still cannot see or add to the case.
    await assert.rejects(svc.caseDetail(await svc.user('u-cm-inas'), c.id));
  });

  it('moves files nested inside records and leaves small or other values in place', async () => {
    const { raw, backend, store } = setup();
    const doc = pdf(1);
    const job = { id: 'job-files-1', companyId: null, note: 'short text', proof: [{ name: 'Form.pdf', mime: 'application/pdf', data: doc }, { name: 'tiny', data: 'data:image/png;base64,AAAA' }], svg: 'data:image/svg+xml;utf8,' + 'x'.repeat(3000) };
    await store.insert('itJobs', job as never);
    const row = (await raw.get('itJobs', 'job-files-1')) as unknown as typeof job;
    assert.match(row.proof[0].data, /^prima-file:v1:itJobs\/group\/[0-9a-f]{64}\.pdf$/);
    assert.equal(row.proof[1].data, 'data:image/png;base64,AAAA');
    assert.equal(row.svg, job.svg);
    assert.equal(row.note, 'short text');
    assert.equal(backend.blobs.size, 1);
    // The caller's object is never changed.
    assert.equal(job.proof[0].data, doc);
    const read = (await store.get('itJobs', 'job-files-1')) as unknown as typeof job;
    assert.deepEqual(read, job);
    const listed = (await store.list('itJobs')).find((j) => j.id === 'job-files-1') as unknown as typeof job;
    assert.deepEqual(listed, job);
    // Adding a second proof through an update moves only the new file; the first is not sent again.
    const doc2 = pdf(2);
    const puts = backend.puts;
    const updated = (await store.update('itJobs', 'job-files-1', { proof: [...read.proof, { name: 'Second.pdf', mime: 'application/pdf', data: doc2 }] } as never)) as unknown as typeof job;
    assert.equal(updated.proof[2].data, doc2);
    assert.equal(backend.puts, puts + 1);
    assert.equal(backend.blobs.size, 2);
    // Inside a transaction too.
    await store.transaction(async (tx) => tx.insert('itJobs', { id: 'job-files-2', companyId: null, proof: [{ data: pdf(3) }] } as never));
    assert.match(((await raw.get('itJobs', 'job-files-2')) as unknown as typeof job).proof[0].data, /^prima-file:v1:/);
  });

  it('leaves files in rows that database rules hash (IT purchases), and still refuses forged references there', async () => {
    const { raw, backend, store } = setup();
    const quote = { supplier: 'Synthetic Supplier', amount: 1, ref: 'Q1', proof: [{ name: 'q.pdf', mime: 'application/pdf', data: pdf(7) }] };
    await store.insert('itPurchases', { id: 'pur-files-1', companyId: null, quotes: [quote] } as never);
    const row = (await raw.get('itPurchases', 'pur-files-1')) as unknown as { quotes: (typeof quote)[] };
    // The procurement module hashes the stored purchase in the database, so the file must stay exactly where it was.
    assert.equal(row.quotes[0].proof[0].data, pdf(7));
    assert.equal(backend.blobs.size, 0);
    await assert.rejects(store.insert('itPurchases', { id: 'pur-forged', companyId: null, note: `${FILE_REF_PREFIX}itJobs/group/${'b'.repeat(64)}.pdf` } as never), BadRequest);
    // A reference planted straight into such a row is never opened.
    await raw.insert('itPurchases', { id: 'pur-planted', companyId: null, note: `${FILE_REF_PREFIX}itJobs/group/${'c'.repeat(64)}.pdf` } as never);
    assert.equal(((await store.get('itPurchases', 'pur-planted')) as unknown as { note: string }).note.startsWith(FILE_REF_PREFIX), true);
    assert.equal(backend.gets, 0);
  });

  it('fetches the files of a whole list together, once per file', async () => {
    const { raw, backend, store } = setup();
    const shared = pdf(20);
    for (let i = 0; i < 12; i += 1) await store.insert('itJobs', { id: `job-list-${i}`, companyId: null, proof: [{ data: i % 2 ? shared : pdf(30 + i) }] } as never);
    const fresh = new FileStore(backend).wrap(raw);
    backend.gets = 0;
    const rows = (await fresh.list('itJobs')).filter((j) => j.id.startsWith('job-list-')) as unknown as { proof: { data: string }[] }[];
    assert.equal(rows.length, 12);
    assert.equal(rows[1].proof[0].data, shared);
    assert.equal(rows[2].proof[0].data, pdf(32));
    // Six different files plus one shared one.
    assert.equal(backend.gets, 7);
  });

  it('refuses a reference sent from outside and a reference moved to another company or record kind', async () => {
    const { raw, store, files } = setup();
    // Nobody can type a file reference into any field to open someone else's file.
    await assert.rejects(store.insert('itJobs', { id: 'job-forged', companyId: null, note: `${FILE_REF_PREFIX}evidencePhotos/co-sasa/${'a'.repeat(64)}.jpg` } as never), BadRequest);
    await assert.rejects(store.update('itJobs', 'job-forged', { note: `${FILE_REF_PREFIX}x` } as never), BadRequest);
    // A reference copied straight into another company's row (bypassing the API) does not open.
    const ref = await files.save('evidenceDocs', 'co-sasa', pdf(9));
    assert.ok(ref);
    await raw.insert('evidenceDocs', { id: 'doc-moved', companyId: 'co-inas', caseId: null, followUpId: null, name: 'x', mime: 'application/pdf', bytes: 1, sha256: 'x', data: ref, caption: '', uploadedBy: 'x', receivedAt: NOW });
    await assert.rejects(store.get('evidenceDocs', 'doc-moved'), /does not belong/);
    await raw.insert('itJobs', { id: 'job-moved', companyId: 'co-sasa', proof: [{ data: ref }] } as never);
    await assert.rejects(store.get('itJobs', 'job-moved'), /does not belong/);
  });

  it('refuses a file that changed in storage', async () => {
    const { raw, backend, store } = setup();
    await store.insert('itJobs', { id: 'job-tamper', companyId: null, proof: [{ data: pdf(4) }] } as never);
    const ref = ((await raw.get('itJobs', 'job-tamper')) as unknown as { proof: { data: string }[] }).proof[0].data;
    const name = ref.slice(FILE_REF_PREFIX.length);
    backend.blobs.set(name, Buffer.from('changed'));
    // A fresh store has no cached copy, so it reads storage and catches the change.
    const again = new FileStore(backend).wrap(raw);
    await assert.rejects(again.get('itJobs', 'job-tamper'), /changed since it was saved/);
    backend.blobs.delete(name);
    await assert.rejects(new FileStore(backend).wrap(raw).get('itJobs', 'job-tamper'), /missing/);
  });

  it('leaves old rows that still hold their file readable', async () => {
    const { ds, store } = setup();
    const old = ds.evidenceDocs[0] ?? null;
    if (old) assert.deepEqual(await store.get('evidenceDocs', old.id), old);
    const p = ds.evidencePhotos[0] ?? null;
    if (p) assert.deepEqual(await store.get('evidencePhotos', p.id), p);
  });

  it('a store without file storage behaves exactly as before', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const plain: Store = new MemoryStore(ds);
    await plain.insert('itJobs', { id: 'job-plain', companyId: null, proof: [{ data: pdf(5) }] } as never);
    assert.equal(((await plain.get('itJobs', 'job-plain')) as unknown as { proof: { data: string }[] }).proof[0].data, pdf(5));
  });
});

describe('Azure Blob backend', () => {
  type Call = { url: string; init: RequestInit };
  function fakeAzure(responses: ((c: Call) => Response)[]) {
    const calls: Call[] = [];
    const http = (async (url: string, init: RequestInit = {}) => {
      const c = { url: String(url), init };
      calls.push(c);
      const r = responses.shift();
      if (!r) throw new Error('unexpected call');
      return r(c);
    }) as unknown as typeof fetch;
    return { calls, http };
  }
  const env = { IDENTITY_ENDPOINT: 'http://localhost:42356/msi/token', IDENTITY_HEADER: 'synthetic-header' };
  const cfg = { account: 'stexample', container: 'evidence', clientId: '00000000-0000-4000-8000-000000000001' };
  const token = () => new Response(JSON.stringify({ access_token: 'synthetic-token', expires_on: String(Math.floor(Date.now() / 1000) + 3600) }), { status: 200 });

  it('signs in with the managed identity and writes once, with a checksum', async () => {
    const { calls, http } = fakeAzure([token, () => new Response(null, { status: 201 }), () => new Response(null, { status: 409 })]);
    const az = new AzureBlobFiles(cfg, env, http);
    const bytes = Buffer.from('synthetic bytes');
    await az.put('evidencePhotos/co-sasa/abc.jpg', bytes, 'image/jpeg');
    await az.put('evidencePhotos/co-sasa/abc.jpg', bytes, 'image/jpeg');
    const t = new URL(calls[0].url);
    assert.equal(t.searchParams.get('resource'), 'https://storage.azure.com/');
    assert.equal(t.searchParams.get('client_id'), cfg.clientId);
    assert.equal((calls[0].init.headers as Record<string, string>)['X-IDENTITY-HEADER'], 'synthetic-header');
    assert.equal(calls[1].url, 'https://stexample.blob.core.windows.net/evidence/evidencePhotos/co-sasa/abc.jpg');
    const h = calls[1].init.headers as Record<string, string>;
    assert.equal(calls[1].init.method, 'PUT');
    assert.equal(h.authorization, 'Bearer synthetic-token');
    assert.equal(h['if-none-match'], '*');
    assert.equal(h['x-ms-blob-type'], 'BlockBlob');
    assert.equal(h['content-md5'], createHash('md5').update(bytes).digest('base64'));
    assert.equal(calls[1].init.redirect, 'error');
    // The token is reused, not fetched for every file.
    assert.equal(calls.length, 3);
  });

  it('asks for one token when many files are saved at once', async () => {
    const { calls, http } = fakeAzure([token, ...Array.from({ length: 5 }, () => () => new Response(null, { status: 201 }))]);
    const az = new AzureBlobFiles(cfg, env, http);
    await Promise.all([1, 2, 3, 4, 5].map((n) => az.put(`a/b/${n}.jpg`, Buffer.from(String(n)), 'image/jpeg')));
    assert.equal(calls.filter((c) => c.url.startsWith(env.IDENTITY_ENDPOINT)).length, 1);
  });

  it('reports refusals and missing files plainly, and never builds a strange address', async () => {
    const { http } = fakeAzure([token, () => new Response('no', { status: 403 }), () => new Response(null, { status: 404 })]);
    const az = new AzureBlobFiles(cfg, env, http);
    await assert.rejects(az.put('a/b/c.jpg', Buffer.from('x'), 'image/jpeg'), /refused to save a file \(403\)/);
    await assert.rejects(az.get('a/b/c.jpg'), /missing/);
    await assert.rejects(az.get('../other/x'), /Invalid file name/);
    await assert.rejects(new AzureBlobFiles(cfg, {}, http).get('a/b/c.jpg'), /no managed identity/);
  });

  it('start-up check writes and reads back a probe', async () => {
    const probe = Buffer.from('prima file store check\n');
    const { calls, http } = fakeAzure([token, () => new Response(null, { status: 201 }), () => new Response(new Uint8Array(probe), { status: 200 })]);
    await new AzureBlobFiles(cfg, env, http).check();
    // Written once, like every file, so a write-once container still passes.
    assert.equal((calls[1].init.headers as Record<string, string>)['if-none-match'], '*');
    assert.match(calls[1].url, /\/_check\/[0-9a-f]{64}\.txt$/);
    const bad = fakeAzure([token, () => new Response(null, { status: 201 }), () => new Response('other', { status: 200 })]);
    await assert.rejects(new AzureBlobFiles(cfg, env, bad.http).check(), /different file/);
  });
});
