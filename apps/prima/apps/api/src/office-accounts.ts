// Automatic Prima accounts for the Agentic Office (P75). Anyone in the office who opens Prima for the first time, with
// no staff record of their own, gets their own Prima account, made here, with access from their office role. The
// office decides who and which role; this service decides what an office account can ever be:
//  - its id is always `u-off-<office user id>`, and it only ever creates or changes rows with that prefix, never a
//    staff record IT, HR or the clean slate made;
//  - its role is one of OFFICE_ROLES only, its companies must exist, its department is one of OFFICE_DEPARTMENTS;
//  - it never sets leadership, opsTier, integration, entraOid or any other field; a closed account stays closed.
// Each change goes on Prima's audit chain ('OFFICE_ACCOUNT'), in the same transaction, like entra-link.ts.
//
// P81: with the real staff loaded, most people who open Prima already have an office staff record (a person) but no
// sign-in. The account is then linked to that record, once, so "My details", the staff clock and payroll are theirs:
// the active office record with the same email (any of their mailboxes, case-insensitive), else, with no email match,
// the one record of the same name in the same company that has no email. Never a record another sign-in holds, never
// a guess between two. The central employers (PWVSB, Merdeka Network, Goodwill Empire, Sasa Team) have no company
// record but employ staff, so an account may be made there; it is always central staff (pwvsb_officer), never a
// company's admin role over the central employer's own staff.
// The role follows the linked record (the lead's decision, 6 Nov 2026): a licensed company's own office staff are that
// company's office, as Prima models it (one Company Manager or GM plus admin executives, Fauzan 2 Nov 2026), so an
// account linked to a record in a licensed company is admin_exec for exactly that one company, which must be the
// company the office mapped the person's branch to. A record in a central employer is reached only by central staff
// (pwvsb_officer). Worked out again on every call from the record, so it is idempotent and audited.
//
// Why a separate service: Prima's API login (prima_api) may only read prima.users, by design. Writing sign-in accounts
// needs the schema owner, which never runs inside the API. So this small program holds the owner connection, listens
// only on the internal networks, and does exactly one thing: POST /accounts, signed by the office (office.ts, via
// "system", with OFFICE_SIGNING_SECRET). Anything else is refused.
//   node dist/src/office-accounts.js        (PORT, default 3100; DATABASE_URL = the owner URL)
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { CENTRAL_EMPLOYER_IDS, fromMs, isCentralEmployer, type User, type UserRole } from '@prima/core';
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
const FIELDS = new Set(['officeUserId', 'name', 'title', 'role', 'companyIds', 'department', 'email']);
const EMAIL = /^[^\s@]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export interface OfficeAccountInput {
  officeUserId: string;
  name: string;
  title: string;
  role: UserRole;
  companyIds: string[];
  department?: User['department'];
  /** P81: the person's office sign-in email, only to find their staff record (never stored on the account). */
  email?: string;
}

export interface OfficeAccountResult {
  id: string;
  name: string;
  role: UserRole;
  companyIds: string[];
  /** P81: the staff record the account is linked to, if any. */
  personId?: string;
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
  let email: string | undefined;
  if (o.email !== undefined && o.email !== null && o.email !== '') {
    email = text(o.email, 'The email', 3, 254).toLowerCase();
    if (!EMAIL.test(email)) throw new AccountRefused('The email is not an email address.');
  }
  // P81: a central employer's staff are central staff. An admin_exec there would read every central staff record.
  const role = companyIds.some(isCentralEmployer) ? 'pwvsb_officer' : (o.role as UserRole);
  return {
    officeUserId: o.officeUserId as string,
    name: text(o.name, 'The name', 1, 120),
    title: text(o.title ?? '', 'The title', 0, 120),
    role,
    companyIds,
    ...(o.department ? { department: o.department as User['department'] } : {}),
    ...(email ? { email } : {}),
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
    const rows = await client.query('SELECT id FROM prima.companies WHERE id = ANY($1::text[])', [input.companyIds]);
    const known = new Set(rows.rows.map((r) => r.id as string));
    // P81: a central employer has no company record and is always known.
    const unknown = input.companyIds.filter((c) => !known.has(c) && !isCentralEmployer(c));
    if (unknown.length) throw new AccountRefused(`No Prima company ${unknown.join(', ')}.`);

    const u = await client.query('SELECT data FROM prima.users WHERE id = $1 FOR UPDATE', [id]);
    const old = (u.rows[0]?.data as User | undefined) ?? null;
    if (old?.integration) throw new AccountRefused('A system feed is never an office account.');
    if (old?.accessClosedFrom) {
      await client.query('COMMIT');
      return { id, name: old.name, role: old.role, companyIds: old.companyIds, created: false, closed: true };
    }
    // P81: the person's own staff record: the one already linked, else found now (findOwnRecord). Its company decides
    // the role (see the top of this file), every time, so a second call changes nothing.
    const linkedBefore = old?.personId ? await recordCompany(client, old.personId, input) : null;
    const found = old?.personId ? null : await findOwnRecord(client, id, input);
    const access = accessFor(input, linkedBefore ?? found?.companyId ?? null);
    let user: User;
    if (old) {
      // Only the allowed fields change; whatever else the record holds (an entraOid IT linked, its sites) stays.
      const { department: _drop, ...rest } = old;
      user = {
        ...rest,
        name: input.name,
        title: input.title,
        role: access.role,
        companyIds: access.companyIds,
        ...(input.department ? { department: input.department } : {}),
        ...(found ? { personId: found.personId } : {}),
      };
      await client.query(`UPDATE prima.users SET data = $2 WHERE id = $1 AND id LIKE 'u-off-%'`, [id, user]);
    } else {
      user = {
        id,
        name: input.name,
        title: input.title,
        role: access.role,
        companyIds: access.companyIds,
        siteIds: [],
        ...(input.department ? { department: input.department } : {}),
        ...(found ? { personId: found.personId } : {}),
      };
      await client.query(`INSERT INTO prima.users (id, data) VALUES ($1, $2)`, [id, user]);
    }
    const what = `${user.role} for ${user.companyIds.join(', ')}${input.department ? `, ${input.department}` : ''}`;
    const link = found ? `; linked to staff record ${found.personId} (same ${found.by})` : '';
    const why = access.role !== input.role ? ` (the office asked ${input.role}; ${access.why})` : '';
    const changed = old && (old.role !== user.role || old.companyIds.join(',') !== user.companyIds.join(','));
    const summary = old
      ? `Office account ${input.name} updated: ${what}${changed ? ` (was ${old.role} for ${old.companyIds.join(', ')})` : ''}${why}${link}`
      : `Office account ${input.name} created: ${what}${why}${link}`;
    await new PgStore(client).audit({ at: fromMs(now), actor: by.trim(), companyId: user.companyIds[0] ?? null, action: 'OFFICE_ACCOUNT', entity: 'user', entityId: id, summary });
    await client.query('COMMIT');
    return { id, name: user.name, role: user.role, companyIds: user.companyIds, ...(user.personId ? { personId: user.personId } : {}), created: !old, closed: false };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  }
}

/**
 * P81: the role and companies an account gets from its own staff record. A record in a licensed company the office
 * mapped the person to makes them that company's office staff: admin_exec for that one company, never more. Anything
 * else keeps what the office asked (central staff stay pwvsb_officer; checkAccountInput already made a central
 * employer's account central staff).
 */
export function accessFor(
  input: Pick<OfficeAccountInput, 'role' | 'companyIds'>,
  recordCompanyId: string | null,
): { role: UserRole; companyIds: string[]; why: string } {
  if (recordCompanyId && !isCentralEmployer(recordCompanyId) && input.companyIds.includes(recordCompanyId))
    return { role: 'admin_exec', companyIds: [recordCompanyId], why: `their own staff record is in ${recordCompanyId}, so they are its office staff` };
  return { role: input.role, companyIds: input.companyIds, why: '' };
}

/**
 * Where an office account may look for its person's record: central staff in the central employers, and the licensed
 * companies the office mapped the person to. Never a company the office did not name.
 */
function searchable(input: Pick<OfficeAccountInput, 'role' | 'companyIds'>): string[] {
  return [...new Set([...(input.role === 'pwvsb_officer' ? CENTRAL_EMPLOYER_IDS : []), ...input.companyIds.filter((c) => !isCentralEmployer(c))])];
}

/** The company of the record an account is already linked to, when it is one the account may reach; else null. */
async function recordCompany(client: PoolClient, personId: string, input: Pick<OfficeAccountInput, 'role' | 'companyIds'>): Promise<string | null> {
  const where = searchable(input);
  if (!where.length) return null;
  await client.query(`SELECT set_config('app.company_ids', $1, true)`, [where.join(',')]);
  const r = await client.query(`SELECT company_id FROM prima.people WHERE id = $1 AND company_id = ANY($2::text[])`, [personId, where]);
  return (r.rows[0]?.company_id as string | undefined) ?? null;
}

/**
 * P81: the active office staff record that is this person's own, or null. Looks only where searchable() allows. By
 * email first (any of the record's mailboxes); with no email match, by the same name in one of the account's
 * companies, among records that have no email. Exactly one record, held by no other sign-in, or none.
 */
export async function findOwnRecord(
  client: PoolClient,
  accountId: string,
  input: Pick<OfficeAccountInput, 'name' | 'email' | 'companyIds' | 'role'>,
): Promise<{ personId: string; companyId: string; by: 'email' | 'name' } | null> {
  const where = searchable(input);
  if (!where.length) return null;
  await client.query(`SELECT set_config('app.company_ids', $1, true)`, [where.join(',')]);
  const free = async (rows: { id: string; company_id: string }[]) => {
    if (rows.length !== 1) return null;
    const held = await client.query(`SELECT 1 FROM prima.users WHERE data->>'personId' = $1 AND id <> $2`, [rows[0].id, accountId]);
    return held.rowCount ? null : rows[0];
  };
  // The wall is named in the query too: a superuser (a local test, a repair run) passes row-level security.
  const active = `data->>'role' = 'office' AND data->>'status' = 'active'`;
  if (input.email) {
    const byEmail = await client.query(
      `SELECT id, company_id FROM prima.people WHERE ${active} AND company_id = ANY($2::text[])
         AND (lower(data->>'email') = $1 OR coalesce(data->'otherEmails', '[]'::jsonb) ? $1)`,
      [input.email, where],
    );
    if (byEmail.rowCount) {
      const r = await free(byEmail.rows);
      return r ? { personId: r.id, companyId: r.company_id, by: 'email' } : null;
    }
  }
  const name = input.name.trim().replace(/\s+/g, ' ').toLowerCase();
  const byName = await client.query(
    `SELECT id, company_id FROM prima.people WHERE ${active} AND coalesce(data->>'email', '') = '' AND company_id = ANY($2::text[])
       AND lower(regexp_replace(trim(data->>'name'), '\\s+', ' ', 'g')) = $1`,
    [name, input.companyIds.filter((c) => where.includes(c))],
  );
  const r = await free(byName.rows);
  return r ? { personId: r.id, companyId: r.company_id, by: 'name' } : null;
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
