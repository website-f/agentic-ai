// Offline site survey (Fauzan, 4 Nov 2026) against a real, throwaway local PostgreSQL: the company wall, the write-once
// photos, the database guard on a sent survey, the closed answer before the module is installed, and two resends at once.
// Synthetic data only; no provider calls.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { fromMs, sha256Hex, SurveyStorageMissing } from '@prima/core';
import { resetDb } from '../src/reset-db';

const base = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(base).hostname)) throw Error('Disposable localhost database required');
const DBNAME = 'prima_site_survey_test';
const url = new URL(base);
url.pathname = '/' + DBNAME;
const URL_ = url.toString();
const path = (f: string) => resolve(process.cwd(), process.cwd().endsWith('/apps/api') ? '../../' + f : f);

let db: import('../src/db').Db;
const saved = process.env.DATABASE_URL;

async function connect(cs = URL_) {
  const c = new Client({ connectionString: cs });
  await c.connect();
  return c;
}

async function asApp<T>(userId: string, companyIds: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = await connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE prima_app');
    await c.query(`SELECT set_config('app.company_ids', $1, true), set_config('app.user_id', $2, true)`, [companyIds, userId]);
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}

let n = 0;
const img = (tag: string) => `data:image/jpeg;base64,${Buffer.from(`synthetic survey jpeg ${tag} ${Date.now()}`).toString('base64')}`;
function survey(images: string[], over: Record<string, unknown> = {}) {
  n += 1;
  const t = Date.now();
  return {
    id: `svy-${n.toString(16).padStart(8, '0')}-1111-4000-8000-${t.toString(16).padStart(12, '0').slice(-12)}`,
    companyId: 'co-sasa',
    place: 'Synthetic warehouse (mock)',
    address: 'Jalan Ujian',
    startedAt: fromMs(t - 3 * 3600_000),
    finishedAt: fromMs(t - 2 * 3600_000),
    lat: 1.47,
    lng: 103.9,
    accuracyM: 15,
    details: { siteType: 'warehouse', lighting: 'poor', fence: 'partial' },
    posts: [{ name: 'Gate', coverHours: 24, shiftHours: 12, guardsPerShift: 1 }],
    findings: 'Synthetic findings for the database test.',
    photos: images.map((i) => ({ sha256: sha256Hex(i), bytes: 40, caption: '', capturedAt: fromMs(t - 2.5 * 3600_000), lat: 1.47, lng: 103.9, accuracyM: 10 })),
    ...over,
  };
}

before(async () => {
  const c = await connect(base);
  try {
    await c.query(`DROP DATABASE IF EXISTS ${DBNAME} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${DBNAME}`);
  } finally {
    await c.end();
  }
  await resetDb(URL_);
  process.env.DATABASE_URL = URL_;
  const { Db } = await import('../src/db');
  db = new Db();
});

after(async () => {
  await db?.onModuleDestroy();
  process.env.DATABASE_URL = saved;
  const c = await connect(base);
  try {
    await c.query(`DROP DATABASE IF EXISTS ${DBNAME} WITH (FORCE)`);
  } finally {
    await c.end();
  }
});

it('answers "not switched on" before the module is installed, so phones keep their surveys', async () => {
  await assert.rejects(
    db.asUser('u-cm-sasa', (svc, u) => svc.siteSurveys.receive(u, survey([img('x')]))),
    (e) => e instanceof SurveyStorageMissing,
  );
  const c = await connect();
  try {
    await c.query(readFileSync(path('db/modules/site-surveys-v1.sql'), 'utf8'));
  } finally {
    await c.end();
  }
});

it('receives, takes photos, keeps the company wall and lets the Project Director fill the lead', async () => {
  const lead = await asApp('u-cm-sasa', 'co-sasa', async (c) => (await c.query(`SELECT data FROM prima.sales_leads WHERE data->>'stage' = 'researched' LIMIT 1`)).rows[0].data);
  // Two first sends of a new survey at once: one row, both get the same receipt, no server error.
  const twice = survey([img('t')]);
  const both = await Promise.all([1, 2].map(() => db.asUser('u-cm-sasa', (svc, u) => svc.siteSurveys.receive(u, twice))));
  assert.ok(both.every((r) => r.id === twice.id && r.missing.length === 1));
  assert.equal((await asApp('u-cm-sasa', 'co-sasa', (c) => c.query('SELECT 1 FROM prima.site_surveys WHERE id = $1', [twice.id]))).rowCount, 1);
  const images = [img('a'), img('b')];
  const body = survey(images, { leadId: lead.id, place: '' });
  const first = await db.asUser('u-cm-sasa', (svc, u) => svc.siteSurveys.receive(u, body));
  assert.deepEqual(first.missing, [1, 2]);
  // Two resends at once (the phone lost the answer twice): one row, same receipt.
  const again = await Promise.all([1, 2].map(() => db.asUser('u-cm-sasa', (svc, u) => svc.siteSurveys.receive(u, body))));
  assert.ok(again.every((r) => r.id === body.id));
  for (const [i, image] of images.entries()) await db.asUser('u-cm-sasa', (svc, u) => svc.siteSurveys.addPhoto(u, body.id, { n: i + 1, image }));

  // Another company's sign-in reads nothing of it at the database.
  assert.equal((await asApp('u-cm-arsh', 'co-arsh', (c) => c.query('SELECT 1 FROM prima.site_surveys WHERE id = $1', [body.id]))).rowCount, 0);
  assert.equal((await asApp('u-cm-arsh', 'co-arsh', (c) => c.query(`SELECT 1 FROM prima.site_survey_photos WHERE data->>'surveyId' = $1`, [body.id]))).rowCount, 0);
  await assert.rejects(db.asUser('u-cm-arsh', (svc, u) => svc.siteSurveys.detail(u, body.id)), /not found/i);

  await assert.rejects(db.asUser('u-gm-sasa', (svc, u) => svc.siteSurveys.review(u, body.id, 'accepted', 'fine')), /Project Director only/);
  const done = await db.asUser('u-coo', (svc, u) => svc.siteSurveys.review(u, body.id, 'accepted', 'Synthetic acceptance'));
  assert.equal(done.status, 'accepted');
  const l = await asApp('u-coo', 'co-sasa', async (c) => (await c.query('SELECT data FROM prima.sales_leads WHERE id = $1', [lead.id])).rows[0].data);
  assert.equal(l.stage, 'surveyed');
  assert.equal(l.survey.guardsNeeded, 2);
});

it('the database refuses a changed survey, a second decision, a forged surveyor and changing or removing photos', async () => {
  const images = [img('g')];
  const body = survey(images);
  await db.asUser('u-cm-sasa', (svc, u) => svc.siteSurveys.receive(u, body));
  await db.asUser('u-cm-sasa', (svc, u) => svc.siteSurveys.addPhoto(u, body.id, { n: 1, image: images[0] }));
  const upd = (patch: string) =>
    asApp('u-cm-sasa', 'co-sasa', (c) => c.query(`UPDATE prima.site_surveys SET data = data || $1::jsonb WHERE id = $2`, [patch, body.id]));
  await assert.rejects(upd(JSON.stringify({ findings: 'rewritten afterwards' })), /cannot be changed/);
  await assert.rejects(upd(JSON.stringify({ contentSha256: 'f'.repeat(64) })), /cannot be changed/);
  await assert.rejects(upd(JSON.stringify({ status: 'receiving_photos' })), /only moves forward/);
  await assert.rejects(upd(JSON.stringify({ status: 'accepted', review: { byId: 'u-cm-sasa', by: 'x', at: fromMs(Date.now()), outcome: 'accepted', reason: 'self' } })), /own survey/);
  await assert.rejects(
    asApp('u-cm-sasa', 'co-sasa', (c) => c.query(`UPDATE prima.site_survey_photos SET data = data WHERE data->>'surveyId' = $1`, [body.id])),
    /permission denied/,
  );
  await assert.rejects(asApp('u-cm-sasa', 'co-sasa', (c) => c.query(`DELETE FROM prima.site_survey_photos WHERE data->>'surveyId' = $1`, [body.id])), /permission denied/);
  await assert.rejects(asApp('u-cm-sasa', 'co-sasa', (c) => c.query(`DELETE FROM prima.site_surveys WHERE id = $1`, [body.id])), /permission denied/);

  const forged = { ...survey([img('f')]) };
  const row = { ...forged, surveyorId: 'u-coo', status: 'receiving_photos', review: null, contentSha256: 'a'.repeat(64) };
  await assert.rejects(
    asApp('u-cm-sasa', 'co-sasa', (c) => c.query('INSERT INTO prima.site_surveys (id, company_id, data) VALUES ($1, $2, $3)', [row.id, 'co-sasa', row])),
    /only as the person who made it/,
  );

  // A survey with no photos (photography not allowed) may start with the Project Director, but only with a reason.
  const none = survey([], { noPhotoReason: 'Protected place, no photography' });
  assert.equal((await db.asUser('u-cm-sasa', (svc, u) => svc.siteSurveys.receive(u, none))).status, 'submitted');
  const bare = { ...survey([]), surveyorId: 'u-cm-sasa', status: 'submitted', review: null, noPhotoReason: '', photos: [], contentSha256: 'b'.repeat(64) };
  await assert.rejects(
    asApp('u-cm-sasa', 'co-sasa', (c) => c.query('INSERT INTO prima.site_surveys (id, company_id, data) VALUES ($1, $2, $3)', [bare.id, 'co-sasa', bare])),
    /photos still coming/,
  );

  await db.asUser('u-coo', (svc, u) => svc.siteSurveys.review(u, body.id, 'returned', 'Synthetic return'));
  await assert.rejects(db.asUser('u-opsdir', (svc, u) => svc.siteSurveys.review(u, body.id, 'accepted', 'Second decision')), /already been decided/);
  await assert.rejects(
    upd(JSON.stringify({ status: 'accepted', review: { byId: 'u-opsdir', by: 'x', at: fromMs(Date.now()), outcome: 'accepted', reason: 'again' } })),
    /cannot be decided again|only moves forward/,
  );
});
