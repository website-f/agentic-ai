// Automatic Prima accounts for the Agentic Office (P75). Anyone in the office who opens Prima for the first time, with
// no staff record of their own, gets their own Prima account, made here, with access from their office role. The
// office decides who and which role; this service decides what an office account can ever be:
//  - its id is always `u-off-<office user id>`, and it only ever creates or changes rows with that prefix, never a
//    staff record IT, HR or the clean slate made;
//  - its role is one of OFFICE_ROLES only, its companies must exist, its department is one of OFFICE_DEPARTMENTS;
//  - it never sets leadership, opsTier, integration, entraOid or any other field; a closed account stays closed.
// Each change goes on Prima's audit chain ('OFFICE_ACCOUNT'), in the same transaction, like entra-link.ts.
//
// Why a separate service: Prima's API login (prima_api) may only read prima.users, by design. Writing sign-in accounts
// needs the schema owner, which never runs inside the API. So this small program holds the owner connection, listens
// only on the internal networks, and does exactly one thing: POST /accounts, signed by the office (office.ts, via
// "system", with OFFICE_SIGNING_SECRET). Anything else is refused.
//   node dist/src/office-accounts.js        (PORT, default 3100; DATABASE_URL = the owner URL)
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fromMs, type User, type UserRole } from '@prima/core';
import { Pool, type PoolClient } from 'pg';
import { officeSecret, verifyOffice } from './office';
import { PgStore } from './pg-store';

export const OFFICE_ACCOUNT_PREFIX = 'u-off-';

/**
 * The roles an office account may have (least privilege, packages/core/src/access.ts):
 *  - admin_exec: a company's manager view without the Company Manager's decisions. seesCompanyOverview() gives it the
 *    company's total overview (Prima's own branch managers have this role), but not commercial.approve, arms.handle
 *    (and so not the arms wall), attendance.discipline, case.close, nor the staff_company, staff_movements or mandates
 *    walls that company_manager adds.
 *  - pwvsb_officer: central staff. A group role with no grant, no department and no leadership passes no company
 *    check (can() needs a dated grant) and no department or HR/pay wall (dataWalls()): their own staff record, clock,
 *    leave and claims only (staffClockUser in hr.ts). 'guard' is not offered: it is a guard's own sign-in, with no
 *    staff clock, leave or claims.
 */
export const OFFICE_ROLES: readonly UserRole[] = ['admin_exec', 'pwvsb_officer'];
/** Departments that open no data wall or company right by themselves (dataWalls, can and the registered walls). */
export const OFFICE_DEPARTMENTS: readonly NonNullable<User['department']>[] = ['transport', 'procurement'];

const OFFICE_USER_ID = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const COMPANY_ID = /^[A-Za-z0-9_-]{1,60}$/;
const FIELDS = new Set(['officeUserId', 'name', 'title', 'role', 'companyIds', 'department']);
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export interface OfficeAccountInput {
  officeUserId: string;
  name: string;
  title: string;
  role: UserRole;
  companyIds: string[];
  department?: User['department'];
}

export interface OfficeAccountResult {
  id: string;
  name: string;
  role: UserRole;
  companyIds: string[];
  created: boolean;
  /** A closed account is left exactly as it is (offboarding): the office shows Prima's own refusal. */
  closed: boolean;
}

/** A request this service refuses (400): bad input, an unknown company, a role or field it never sets. */
export class AccountRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountRefused';
  }
}

/** The Prima id of an office person's own account: `u-off-` and their office user id, which must be plain. */
export function officeAccountId(officeUserId: unknown): string {
  if (typeof officeUserId !== 'string' || !OFFICE_USER_ID.test(officeUserId)) throw new AccountRefused('The office user id is not valid.');
  return `${OFFICE_ACCOUNT_PREFIX}${officeUserId}`;
}

function text(v: unknown, what: string, min: number, max: number): string {
  if (typeof v !== 'string') throw new AccountRefused(`${what} must be text.`);
  const s = v.trim().replace(/\s+/g, ' ');
  if (s.length < min || s.length > max || CONTROL.test(s)) throw new AccountRefused(`${what} must be ${min}-${max} plain characters.`);
  return s;
}

/** The input, checked field by field; anything outside the allow-list is refused, not ignored. */
export function checkAccountInput(raw: unknown): OfficeAccountInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AccountRefused('Send one account as a JSON object.');
  const o = raw as Record<string, unknown>;
  const extra = Object.keys(o).filter((k) => !FIELDS.has(k));
  if (extra.length) throw new AccountRefused(`An office account cannot set ${extra.sort().join(', ')}.`);
  officeAccountId(o.officeUserId);
  if (typeof o.role !== 'string' || !OFFICE_ROLES.includes(o.role as UserRole))
    throw new AccountRefused(`An office account's role must be one of ${OFFICE_ROLES.join(', ')}.`);
  if (!Array.isArray(o.companyIds) || o.companyIds.length < 1 || o.companyIds.length > 5)
    throw new AccountRefused('An office account belongs to one to five companies.');
  const companyIds = [...new Set(o.companyIds.map((c) => (typeof c === 'string' && COMPANY_ID.test(c) ? c : '')))];
  if (companyIds.includes('')) throw new AccountRefused('A company id is not valid.');
  if (o.department !== undefined && o.department !== null && !OFFICE_DEPARTMENTS.includes(o.department as never))
    throw new AccountRefused(`An office account's department must be one of ${OFFICE_DEPARTMENTS.join(', ')}.`);
  return {
    officeUserId: o.officeUserId as string,
    name: text(o.name, 'The name', 1, 120),
    title: text(o.title ?? '', 'The title', 0, 120),
    role: o.role as UserRole,
    companyIds,
    ...(o.department ? { department: o.department as User['department'] } : {}),
  };
}

/**
 * Create or update one office person's own Prima account, in one transaction, audited. Only `u-off-` rows; a closed
 * account is left as it is. `client` is an owner connection (prima.users is read-only to the API's login).
 */
export async function upsertOfficeAccount(client: PoolClient, raw: unknown, by: string, now = Date.now()): Promise<OfficeAccountResult> {
  if (!by.trim()) throw new AccountRefused('Say who is making the change.');
  const input = checkAccountInput(raw);
  const id = officeAccountId(input.officeUserId);
  if (!id.startsWith(OFFICE_ACCOUNT_PREFIX)) throw new AccountRefused('Only office accounts are changed here.');
  await client.query('BEGIN');
  try {
    // Companies sit behind the company wall, FORCEd even for the schema owner: open it for exactly the asked ids.
    await client.query(`SELECT set_config('app.company_ids', $1, true)`, [input.companyIds.join(',')]);
    const found = await client.query('SELECT id FROM prima.companies WHERE id = ANY($1::text[])', [input.companyIds]);
    const known = new Set(found.rows.map((r) => r.id as string));
    const unknown = input.companyIds.filter((c) => !known.has(c));
    if (unknown.length) throw new AccountRefused(`No Prima company ${unknown.join(', ')}.`);

    const u = await client.query('SELECT data FROM prima.users WHERE id = $1 FOR UPDATE', [id]);
    const old = (u.rows[0]?.data as User | undefined) ?? null;
    if (old?.integration) throw new AccountRefused('A system feed is never an office account.');
    if (old?.accessClosedFrom) {
      await client.query('COMMIT');
      return { id, name: old.name, role: old.role, companyIds: old.companyIds, created: false, closed: true };
    }
    let user: User;
    if (old) {
      // Only the allowed fields change; whatever else the record holds (an entraOid IT linked, its sites) stays.
      const { department: _drop, ...rest } = old;
      user = { ...rest, name: input.name, title: input.title, role: input.role, companyIds: input.companyIds, ...(input.department ? { department: input.department } : {}) };
      await client.query(`UPDATE prima.users SET data = $2 WHERE id = $1 AND id LIKE 'u-off-%'`, [id, user]);
    } else {
      user = { id, name: input.name, title: input.title, role: input.role, companyIds: input.companyIds, siteIds: [], ...(input.department ? { department: input.department } : {}) };
      await client.query(`INSERT INTO prima.users (id, data) VALUES ($1, $2)`, [id, user]);
    }
    const what = `${input.role} for ${input.companyIds.join(', ')}${input.department ? `, ${input.department}` : ''}`;
    const summary = old
      ? `Office account ${input.name} updated: ${what}${old.role !== input.role || old.companyIds.join(',') !== input.companyIds.join(',') ? ` (was ${old.role} for ${old.companyIds.join(', ')})` : ''}`
      : `Office account ${input.name} created: ${what}`;
    await new PgStore(client).audit({ at: fromMs(now), actor: by.trim(), companyId: input.companyIds[0] ?? null, action: 'OFFICE_ACCOUNT', entity: 'user', entityId: id, summary });
    await client.query('COMMIT');
    return { id, name: user.name, role: user.role, companyIds: user.companyIds, created: !old, closed: false };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  }
}

// ---------------------------------------------------------------- the service

const BODY_LIMIT = 16 * 1024;

class TooLarge extends Error {}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new TooLarge());
        req.destroy();
        return;
      }
      parts.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

/** The service's one handler: GET /health, and POST /accounts signed by the office itself (via "system"). */
export function accountsHandler(pool: Pick<Pool, 'connect'>, env: NodeJS.ProcessEnv = process.env, clock: () => number = Date.now) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = req.url ?? '';
      if (req.method === 'GET' && url === '/health') return send(res, 200, { ok: true });
      if (url !== '/accounts') return send(res, 404, { message: 'Not found.' });
      if (req.method !== 'POST') return send(res, 405, { message: 'Only POST.' });
      const declared = Number(req.headers['content-length'] ?? 0);
      if (declared > BODY_LIMIT) return send(res, 413, { message: 'Too large.' });
      const body = await readBody(req);
      const call = verifyOffice(req.headers as Record<string, unknown>, 'POST', url, body, clock(), env);
      if (!call || call.via !== 'system') return send(res, 401, { message: 'Only the Agentic Office may ask this.' });
      let input: unknown;
      try {
        input = JSON.parse(body.toString('utf8'));
      } catch {
        return send(res, 400, { message: 'The body is not JSON.' });
      }
      const client = await pool.connect();
      try {
        return send(res, 200, await upsertOfficeAccount(client, input, 'Agentic Office', clock()));
      } finally {
        client.release();
      }
    } catch (e) {
      if (e instanceof TooLarge) return send(res, 413, { message: 'Too large.' });
      if (e instanceof AccountRefused) return send(res, 400, { message: e.message });
      console.error(`office-accounts: ${(e as Error).message}`);
      if (!res.headersSent) send(res, 500, { message: 'The account could not be saved. Try again.' });
    }
  };
}

export function startAccounts(env: NodeJS.ProcessEnv = process.env): Server {
  if (!officeSecret(env)) throw new Error('OFFICE_SIGNING_SECRET (32 characters or more) is not set.');
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  pool.on('error', (e) => console.error(`office-accounts: database connection dropped: ${e.message}`));
  const server = createServer((req, res) => void accountsHandler(pool, env)(req, res));
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  const port = Number(env.PORT ?? 3100);
  server.listen(port, () => console.log(`office-accounts: listening on ${port}`));
  const stop = () => server.close(() => void pool.end());
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  return server;
}

if (require.main === module) {
  try {
    startAccounts();
  } catch (e) {
    console.error(`office-accounts: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}
