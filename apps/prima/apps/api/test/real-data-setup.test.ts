// P81: db-setup with PRIMA_REAL_DATA, the group's real companies and staff loaded into an empty database instead of the
// clean slate. Synthetic companies and people only. The database part runs the way Azure and the VPS run it: as a
// database administrator that is NOT a superuser, in its own throwaway database.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client, Pool } from 'pg';
import { CENTRAL_EMPLOYER_IDS, REAL_DATA_SETTINGS, RealDataError, type Company, type Person, type User } from '@prima/core';
import { CLEAN_SLATE_KEEP, firstDataset, readRealData, setupDb } from '../src/db-setup';
import { upsertOfficeAccount } from '../src/office-accounts';

const NOW = '2026-11-06T10:00:00+08:00';
const FILE = {
  format: 'prima-real-data',
  version: 1,
  source: 'synthetic test list',
  companies: [
    { key: 'pwvsb', name: 'Central Example Sdn Bhd', role: 'central' },
    { key: 'goodwill', name: 'Gov Ops Example Sdn Bhd', role: 'gov_ops' },
    { key: 'co-alpha-guard', name: 'Alpha Guard Sdn Bhd', role: 'licensed', aliases: ['ALPHA GUARD'] },
    { key: 'co-gamma-asset', name: 'Gamma Asset Sdn Bhd', role: 'asset' },
  ],
  staff: [
    { name: 'Synthetic Central One', email: 'central.one@example.test', company: 'pwvsb', unit: 'hr', roleHint: 'staff' },
    { name: 'Synthetic Region Two', email: null, company: 'goodwill', unit: 'operations', area: 'johor', roleHint: 'staff' },
    { name: 'Synthetic Alpha Three', email: 'alpha.three@example.test', company: 'co-alpha-guard', roleHint: 'manager', title: 'Management' },
  ],
};

const dir = mkdtempSync(join(tmpdir(), 'prima-real-'));
const path = join(dir, 'real.json');
writeFileSync(path, JSON.stringify(FILE));
after(() => rmSync(dir, { recursive: true, force: true }));

describe('PRIMA_REAL_DATA: reading the file', () => {
  it('is off without the setting: an empty database gets the clean slate exactly as before', () => {
    assert.equal(readRealData({}), null);
    assert.equal(readRealData({ PRIMA_REAL_DATA: '  ' }), null);
    const ds = firstDataset(NOW, null);
    assert.equal(ds.companies.length, 38);
    assert.ok(ds.users.length > 10);
    assert.equal(ds.people.length, 0);
  });

  it('keeps only settings the clean slate keeps', () => {
    for (const k of REAL_DATA_SETTINGS) assert.ok(CLEAN_SLATE_KEEP.includes(k), k);
  });

  it('refuses a missing, unreadable or wrong file in plain words, without its contents', () => {
    assert.throws(() => readRealData({ PRIMA_REAL_DATA: join(dir, 'nope.json') }), /cannot be read \(ENOENT\)\. Put the file there or clear PRIMA_REAL_DATA/);
    const notJson = join(dir, 'bad.json');
    writeFileSync(notJson, '{ secret person');
    assert.throws(() => readRealData({ PRIMA_REAL_DATA: notJson }), (e: Error) => /is not JSON/.test(e.message) && !e.message.includes('secret'));
    const wrong = join(dir, 'wrong.json');
    writeFileSync(wrong, JSON.stringify({ ...FILE, version: 9 }));
    assert.throws(() => readRealData({ PRIMA_REAL_DATA: wrong }), RealDataError);
  });

  it('reads a good file (a byte order mark from Windows too) into the real dataset', () => {
    const bom = join(dir, 'bom.json');
    writeFileSync(bom, `﻿${JSON.stringify(FILE)}`);
    const real = readRealData({ PRIMA_REAL_DATA: bom });
    assert.ok(real);
    const ds = firstDataset(NOW, real);
    assert.deepEqual(ds.companies.map((c) => c.id).sort(), ['co-alpha-guard', 'co-gamma-asset']);
    assert.equal(ds.people.length, 3);
    assert.ok(ds.users.every((u) => u.id === 'u-fauzan' || u.integration));
  });
});

const BASE = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
const DBNAME = 'prima_real_setup_test';
const ADMIN = 'prima_real_setup_admin';
const RUNTIME = 'prima_api_real_test';

function urlAs(user: string, password = 'local-only') {
  const u = new URL(BASE);
  u.username = user;
  u.password = password;
  u.pathname = `/${DBNAME}`;
  return u.toString();
}

async function superuser<R>(fn: (c: Client) => Promise<R>, url = BASE): Promise<R> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

function inspect<R>(fn: (c: Client) => Promise<R>): Promise<R> {
  const u = new URL(BASE);
  u.pathname = `/${DBNAME}`;
  return superuser(fn, u.toString());
}

describe('PRIMA_REAL_DATA: setting up an empty database', () => {
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(BASE).hostname)) throw Error('Disposable localhost database required');
  let admin: Pool;
  before(async () => {
    await superuser(async (c) => {
      await c.query(`DROP DATABASE IF EXISTS ${DBNAME} WITH (FORCE)`);
      for (const r of [RUNTIME, ADMIN]) {
        if ((await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [r])).rowCount) {
          await c.query(`REASSIGN OWNED BY ${r} TO current_user`).catch(() => undefined);
          await c.query(`DROP OWNED BY ${r}`).catch(() => undefined);
          await c.query(`DROP ROLE ${r}`);
        }
      }
      await c.query(`CREATE ROLE ${ADMIN} LOGIN CREATEROLE CREATEDB PASSWORD 'local-only'`);
      await c.query(`CREATE DATABASE ${DBNAME} OWNER ${ADMIN}`);
      if ((await c.query(`SELECT 1 FROM pg_roles WHERE rolname = 'prima_app'`)).rowCount) await c.query(`GRANT prima_app TO ${ADMIN} WITH ADMIN OPTION, INHERIT FALSE, SET FALSE`);
    });
    admin = new Pool({ connectionString: urlAs(ADMIN), max: 1 });
  });
  after(async () => {
    await admin.end();
    await superuser((c) => c.query(`DROP DATABASE IF EXISTS ${DBNAME} WITH (FORCE)`)).catch(() => undefined);
  });

  it('loads the real companies and staff, the CEO with every company, and no sample record', async () => {
    const c = await admin.connect();
    try {
      const r = await setupDb(c, { PRIMA_API_DB_USER: RUNTIME, PRIMA_API_DB_PASSWORD: 'x'.repeat(32), PRIMA_REAL_DATA: path }, NOW);
      assert.equal(r.created, true);
      assert.equal(r.realData, '2 companies, 3 staff (2 with an email)');
    } finally {
      c.release();
    }
    await inspect(async (s) => {
      const rows = async <T>(sql: string) => (await s.query(sql)).rows.map((x) => x.data as T);
      const companies = await rows<Company>('SELECT data FROM prima.companies');
      assert.deepEqual(companies.map((x) => x.id).sort(), ['co-alpha-guard', 'co-gamma-asset']);
      assert.ok(!companies.some((x) => /mock/i.test(x.name)));
      const users = await rows<User>('SELECT data FROM prima.users');
      assert.ok(users.some((u) => u.id === 'u-fauzan'));
      assert.ok(users.every((u) => u.id === 'u-fauzan' || u.integration), 'no sample sign-in');
      const people = await rows<Person>('SELECT data FROM prima.people');
      assert.equal(people.length, 3);
      assert.deepEqual(people.map((p) => p.companyId).sort(), ['co-alpha-guard', 'goodwill', 'pwvsb']);
      const grants = (await s.query(`SELECT company_id FROM prima.grants WHERE data->>'userId' = 'u-fauzan'`)).rows.map((x) => x.company_id as string).sort();
      assert.deepEqual(grants, ['co-alpha-guard', 'co-gamma-asset']);
      for (const t of ['sites', 'shifts', 'cases', 'licences', 'branches', 'cms_shifts']) assert.equal(Number((await s.query(`SELECT count(*) AS n FROM prima.${t}`)).rows[0].n), 0, t);
      assert.ok(Number((await s.query(`SELECT count(*) AS n FROM prima.report_defs`)).rows[0].n) > 0);
    });
  });

  it('a second run leaves the database as it is, whatever the file says', async () => {
    const c = await admin.connect();
    try {
      const r = await setupDb(c, { PRIMA_API_DB_USER: RUNTIME, PRIMA_REAL_DATA: join(dir, 'nope.json') }, NOW);
      assert.equal(r.created, false);
      assert.equal(r.realData, null);
    } finally {
      c.release();
    }
  });

  it('an office sign-in with a staff member email is linked to their record', async () => {
    // As the schema owner, like prima-accounts on the server.
    const pool = new Pool({ connectionString: urlAs(ADMIN), max: 1 });
    const client = await pool.connect();
    try {
      const got = await upsertOfficeAccount(client, { officeUserId: 'us_p81real', name: 'Central One', title: 'Staff', role: 'pwvsb_officer', companyIds: ['pwvsb'], email: 'CENTRAL.ONE@example.test' }, 'Agentic Office');
      const person = await inspect(async (s) => (await s.query(`SELECT id FROM prima.people WHERE data->>'email' = 'central.one@example.test'`)).rows[0].id as string);
      assert.equal(got.personId, person);
      assert.ok(CENTRAL_EMPLOYER_IDS.includes(got.companyIds[0]));
      assert.equal(got.role, 'pwvsb_officer');
      // A licensed company's own office staff: that company's admin_exec, through the wall as the non-superuser owner.
      const alpha = await upsertOfficeAccount(client, { officeUserId: 'us_p81alpha', name: 'Alpha Three', title: 'Staff', role: 'pwvsb_officer', companyIds: ['co-alpha-guard'], email: 'alpha.three@example.test' }, 'Agentic Office');
      assert.deepEqual([alpha.role, alpha.companyIds, !!alpha.personId], ['admin_exec', ['co-alpha-guard'], true]);
    } finally {
      client.release();
      await pool.end();
    }
  });
});
