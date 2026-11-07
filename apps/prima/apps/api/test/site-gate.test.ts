// The site device's police-grade gate record against a real local PostgreSQL (Fauzan, 6 Nov 2026): the full IC travels
// sealed for the in-house server, the database never holds it readable, and only the in-house server's own sign-in
// collects and confirms, through the company wall. Synthetic data only; the test resets the throwaway database.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createHmac } from 'node:crypto';
import { Client } from 'pg';
import { demoPin, makeTestInhouseKey, openSealed, sealForInhouse, type User } from '@prima/core';
import { Db, apiInhouseKey } from '../src/db';
import { resetDb } from '../src/reset-db';
import { verifyFeed } from '../src/auth';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

describe('Site gate record for police: sealed full ID for the in-house server', () => {
  let db: Db;
  let owner: Client;
  before(async () => {
    await resetDb(URL);
    db = new Db();
    owner = new Client({ connectionString: URL });
    await owner.connect();
  });
  after(async () => {
    await owner.end();
    await db.onModuleDestroy();
  });

  it('reads the in-house public key from the environment and refuses a private key', async () => {
    const k = await makeTestInhouseKey();
    assert.equal(apiInhouseKey({}), null);
    assert.equal(apiInhouseKey({ INHOUSE_PUBLIC_KEY_JWK: JSON.stringify(k.privateJwk), INHOUSE_KEY_ID: 'k1' }), null);
    assert.equal(apiInhouseKey({ INHOUSE_PUBLIC_KEY_JWK: '{not json', INHOUSE_KEY_ID: 'k1' }), null);
    const got = apiInhouseKey({ INHOUSE_PUBLIC_KEY_JWK: JSON.stringify(k.jwk), INHOUSE_KEY_ID: 'k1' })!;
    assert.equal(got.keyId, 'k1');
    assert.equal('d' in got.jwk, false);
  });

  it('the in-house feed is off until its key and signing secret are set, then needs a fresh signed call', () => {
    const body = Buffer.from('{"limit":10}');
    const now = Date.now();
    const ts = new Date(now).toISOString();
    delete process.env.INHOUSE_API_KEY;
    delete process.env.INHOUSE_SIGNING_SECRET;
    assert.equal(verifyFeed({ 'x-api-key': 'x', 'x-timestamp': ts, 'x-signature': 'x' }, body, now, 'INHOUSE'), false);
    process.env.INHOUSE_API_KEY = 'test-inhouse-key';
    process.env.INHOUSE_SIGNING_SECRET = 'test-inhouse-signing';
    const sig = createHmac('sha256', 'test-inhouse-signing').update(`${ts}.`).update(body).digest('hex');
    assert.equal(verifyFeed({ 'x-api-key': 'test-inhouse-key', 'x-timestamp': ts, 'x-signature': sig }, body, now, 'INHOUSE'), true);
    // A key for another feed does not open this one.
    assert.equal(verifyFeed({ 'x-api-key': 'test-inhouse-key', 'x-timestamp': ts, 'x-signature': sig }, body, now, 'ANALYTICS'), false);
  });

  it('stores only the sealed copy; the in-house server collects it through the company wall and confirms', async () => {
    const key = await makeTestInhouseKey('pg-inhouse-1');
    const dev = (await owner.query("SELECT data FROM prima.users WHERE id = 'u-dev-sasa-001'")).rows[0].data as User;
    const site = (await owner.query('SELECT data FROM prima.sites WHERE id = $1', [dev.siteIds[0]])).rows[0].data as { id: string; companyId: string; lat: number; lng: number };
    const guard = (
      await owner.query("SELECT data FROM prima.people WHERE data->>'companyId' = $1 AND data->>'status' = 'active' AND data->>'staffNo' IS NOT NULL AND data->>'pinHash' IS NOT NULL LIMIT 1", [site.companyId])
    ).rows[0].data as { staffNo: string };
    const sealed = await sealForInhouse({ keyId: key.keyId, jwk: key.jwk }, { id_number: '880202-10-4321', id_photo: 'data:image/jpeg;base64,c3ludGhldGlj' });
    const r = await db.asUser('u-dev-sasa-001', (svc, u) =>
      svc.gateIn(u, {
        staffNo: guard.staffNo,
        pin: demoPin(guard.staffNo),
        kind: 'visitor',
        clientRef: 'pg-gate-0001',
        visitor: { name: 'Synthetic Visitor', idKind: 'mykad', idLast4: '4321', idRead: 'photo', host: 'Office', purpose: 'Meeting', face: { score: 0.95, live: true } },
        sealed,
        photo: { image: `data:image/jpeg;base64,${Buffer.from('pg synthetic visitor').toString('base64')}`, lat: site.lat, lng: site.lng, accuracyM: 8 },
      }),
    );
    assert.deepEqual(r.entry.flags, []);
    const raw = await owner.query("SELECT data::text AS t FROM prima.gate_entries WHERE id = $1", [r.entry.id]);
    assert.ok(!raw.rows[0].t.includes('880202'));
    const audit = await owner.query("SELECT count(*)::int AS n FROM prima.audit WHERE data::text LIKE '%880202%'");
    assert.equal(audit.rows[0].n, 0);
    // A resend after a lost signal is the same entry.
    const again = await db.asUser('u-dev-sasa-001', (svc, u) =>
      svc.gateIn(u, { staffNo: guard.staffNo, pin: demoPin(guard.staffNo), kind: 'visitor', clientRef: 'pg-gate-0001', visitor: null, sealed, photo: null }),
    );
    assert.equal(again.resent, true);
    // Staff screens cannot collect the sealed copies.
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.inhouseQueue(u)));
    const q = await db.asUser('u-inhouse-server', (svc, u) => svc.inhouseQueue(u, 50));
    const mine = q.find((x) => x.id === r.entry.id)!;
    assert.ok(mine, 'the in-house server sees the queued entry through its company grant');
    assert.equal((await openSealed(key.privateJwk, mine.sealed)).id_number, '880202-10-4321');
    assert.deepEqual(await db.asUser('u-inhouse-server', (svc, u) => svc.inhouseConfirm(u, [r.entry.id])), { confirmed: 1 });
    const after_ = await db.asUser('u-inhouse-server', (svc, u) => svc.inhouseQueue(u, 50));
    assert.equal(after_.some((x) => x.id === r.entry.id), false);
  });
});
