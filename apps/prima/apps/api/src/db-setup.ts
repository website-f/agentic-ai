// Prepares a staging or live database without ever wiping it. Run as the database administrator, as a one-off job
// (Azure Container Apps job), never by the API itself:
//  - an empty database gets the schema and a clean slate: the companies, the staff accounts with their company
//    grants, and the settings the screens need. No sites, guards, cases, tickets or other records: the CEO fills
//    those in Prima (Fauzan, 28 Oct 2026, go-live).
//  - a database that already has records keeps every one of them: only new tables, walls and grants are added.
//  - the API's own login (PRIMA_API_DB_USER, default prima_api, password PRIMA_API_DB_PASSWORD) is created or its
//    password reset; with no password given, an existing login only has its reads restated. It may only read the staff and grant lists it needs to sign people in, and switch to
//    prima_app, the company-wall role, for everything else. It owns nothing and cannot change the schema; the
//    administrator login stays out of the running API.
//  - ENTRA_BOOTSTRAP_LINKS ("u-fauzan=<object id>,...") links the first Microsoft accounts so the CEO can sign in
//    before IT has a database tool; an existing link is never changed. Each link goes on the audit chain.
//  - P81: PRIMA_REAL_DATA (a path to a real-data JSON file, mounted read-only) loads the group's real companies and
//    staff into an empty database instead of the clean slate's sample companies and sign-ins (core real-data.ts). The
//    file is personal data: only counts are logged. Without it, nothing changes.
import { readFileSync } from 'node:fs';
import { dateOf, generateDataset, parseRealData, realDataSummary, realDataset, type Dataset, type RealDataFile } from '@prima/core';
import { Pool, type PoolClient } from 'pg';
import { nowMyt } from './db';
import { linkEntra } from './entra-link';
import { insertDataset } from './reset-db';
import { migrationSha, migrationSql } from './schema';

/** What a clean slate keeps from the generated dataset: who signs in, which companies exist, and settings. */
export const CLEAN_SLATE_KEEP: (keyof Dataset)[] = [
  'companies',
  'users',
  'grants',
  'cmsSettings',
  'cmsShifts',
  'itSettings',
  'webSettings',
  'tenderProtocols',
  'reportDefs',
  'claimRates',
];

export function cleanSlate(ds: Dataset): Dataset {
  const out = { ...ds } as Record<string, unknown>;
  for (const [k, v] of Object.entries(ds)) {
    if (Array.isArray(v) && !CLEAN_SLATE_KEEP.includes(k as keyof Dataset)) out[k] = [];
  }
  return out as unknown as Dataset;
}

/** P81: the real-data file PRIMA_REAL_DATA names, checked; null when it names none. A bad file stops the setup. */
export function readRealData(env: NodeJS.ProcessEnv = process.env): RealDataFile | null {
  const path = env.PRIMA_REAL_DATA?.trim();
  if (!path) return null;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    throw new Error(`PRIMA_REAL_DATA names ${path}, which cannot be read (${(e as NodeJS.ErrnoException).code ?? 'error'}). Put the file there or clear PRIMA_REAL_DATA.`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw.replace(/^﻿/, ''));
  } catch {
    throw new Error(`PRIMA_REAL_DATA: ${path} is not JSON. Build it again with apps/prima/scripts/build-real-data.mjs.`);
  }
  return parseRealData(json);
}

/** What an empty database is loaded with: the real companies and staff when a file is given, else the clean slate. */
export function firstDataset(now: string, real: RealDataFile | null): Dataset {
  const generated = generateDataset({ today: dateOf(now), now });
  return real ? realDataset(generated, real, { today: dateOf(now) }) : cleanSlate(generated);
}

export function parseBootstrapLinks(raw: string | undefined): { userId: string; oid: string }[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [userId, oid] = pair.split('=').map((x) => x?.trim() ?? '');
      if (!userId || !oid) throw new Error(`ENTRA_BOOTSTRAP_LINKS entry "${pair}" must look like u-id=<object id>.`);
      return { userId, oid: oid.toLowerCase() };
    });
}

const ROLE_NAME = /^[a-z_][a-z0-9_]{2,62}$/;

/** The API's runtime login: least privilege, switches to prima_app for every request (db.ts). */
async function apiLogin(client: PoolClient, env: NodeJS.ProcessEnv): Promise<void> {
  const password = env.PRIMA_API_DB_PASSWORD ?? '';
  const user = env.PRIMA_API_DB_USER || 'prima_api';
  if (!ROLE_NAME.test(user)) throw new Error('PRIMA_API_DB_USER must be a plain lower-case name.');
  if (!password) {
    // No new password given: an existing login keeps its password and gets any read it needs that a newer schema adds.
    if ((await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [user])).rowCount) await apiReads(client, user);
    return;
  }
  if (password.length < 24) throw new Error('PRIMA_API_DB_PASSWORD must be at least 24 characters.');
  const lit = (await client.query('SELECT quote_literal($1) AS q', [password])).rows[0].q as string;
  const found = await client.query('SELECT rolsuper OR rolbypassrls AS strong FROM pg_roles WHERE rolname = $1', [user]);
  if (found.rows[0]?.strong) throw new Error(`${user} is a superuser or bypasses row-level security; use another name.`);
  // New roles start with no superuser, role-making, database-making or RLS bypass rights; only those are re-stated.
  await client.query(
    found.rowCount
      ? `ALTER ROLE ${user} LOGIN NOINHERIT NOCREATEDB NOCREATEROLE PASSWORD ${lit}`
      : `CREATE ROLE ${user} LOGIN NOINHERIT PASSWORD ${lit}`,
  );
  const db = (await client.query('SELECT quote_ident(current_database()) AS d')).rows[0].d as string;
  await client.query(`GRANT CONNECT ON DATABASE ${db} TO ${user}`);
  await apiReads(client, user);
  // PostgreSQL 16+: switch to prima_app (SET), never act with its rights silently (no INHERIT).
  await client.query(`GRANT prima_app TO ${user} WITH INHERIT FALSE, SET TRUE`);
}

/** What the API login reads before it switches to prima_app: the staff and grant lists, and the schema version. */
async function apiReads(client: PoolClient, user: string): Promise<void> {
  await client.query(`GRANT USAGE ON SCHEMA prima TO ${user}`);
  await client.query(`GRANT SELECT ON prima.users, prima.grants, prima.schema_info TO ${user}`);
}

/** Any number above zero: one setup at a time when two API copies start together. */
const SETUP_LOCK = 4_177_001;

export interface SetupResult {
  created: boolean;
  linked: string[];
  /** P81: counts of the real data loaded (an empty database and PRIMA_REAL_DATA), else null. */
  realData: string | null;
}

export async function setupDb(client: PoolClient, env: NodeJS.ProcessEnv = process.env, now = nowMyt()): Promise<SetupResult> {
  await client.query('SELECT pg_advisory_lock($1)', [SETUP_LOCK]);
  try {
    // The schema file only adds (CREATE ... IF NOT EXISTS, policies and grants restated), so it runs on every deploy:
    // a new table or wall reaches a database that is already in use, and no row is ever removed.
    await client.query(migrationSql());
    // Loaded only into a database with no staff accounts yet (the load is one transaction, so a failed one leaves none).
    // Not counted on companies: the company wall hides them from a non-superuser administrator.
    const empty = await client.query('SELECT NOT EXISTS (SELECT 1 FROM prima.users) AS ok');
    const created = empty.rows[0].ok as boolean;
    // P81: the file is read only for an empty database; a database in use never looks at it.
    const real = created ? readRealData(env) : null;
    if (created) await insertDataset(client, firstDataset(now, real));
    await apiLogin(client, env);
    await client.query(
      `INSERT INTO prima.schema_info (id, migration_sha256, applied_at) VALUES (1, $1, now())
       ON CONFLICT (id) DO UPDATE SET migration_sha256 = EXCLUDED.migration_sha256, applied_at = EXCLUDED.applied_at`,
      [migrationSha()],
    );

    const linked: string[] = [];
    for (const { userId, oid } of parseBootstrapLinks(env.ENTRA_BOOTSTRAP_LINKS)) {
      const u = await client.query(`SELECT data->>'entraOid' AS oid FROM prima.users WHERE id = $1`, [userId]);
      if (u.rowCount === 0) throw new Error(`ENTRA_BOOTSTRAP_LINKS names ${userId}, which has no staff record.`);
      if (u.rows[0].oid) continue;
      const taken = await client.query(`SELECT 1 FROM prima.users WHERE lower(data->>'entraOid') = $1`, [oid]);
      if (taken.rowCount) continue;
      await linkEntra(client, userId, oid, 'Staging setup (ENTRA_BOOTSTRAP_LINKS)');
      linked.push(userId);
    }
    return { created, linked, realData: real ? realDataSummary(real) : null };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [SETUP_LOCK]);
  }
}

if (require.main === module && process.argv.includes('--check-real-data')) {
  // P81: checks the file before a reinstall wipes anything (deploy/scripts/prima-reinstall.sh). Counts only.
  try {
    const real = readRealData();
    console.log(real ? `Real data OK: ${realDataSummary(real)}.` : 'PRIMA_REAL_DATA is not set: an empty database gets the clean slate.');
  } catch (e) {
    console.error(`Real data refused: ${(e as Error).message}`);
    process.exitCode = 1;
  }
} else if (require.main === module) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  pool
    .connect()
    .then((client) => setupDb(client).finally(() => client.release()))
    .then((r) =>
      console.log(
        `Database setup: ${r.created ? (r.realData ? `loaded the real data (${r.realData})` : 'created a clean slate') : 'already set up, left as is'}${r.linked.length ? `; linked ${r.linked.join(', ')}` : ''}.`,
      ),
    )
    .catch((e: Error) => {
      console.error(`Database setup failed: ${e.message}`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
