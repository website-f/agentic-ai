import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  AccessClosed,
  DEMO_PIN_KEY,
  PrimaService,
  accessClosed,
  dataWalls,
  dateOf,
  fromMs,
  isGroupRole,
  pinKeeper,
  tenantCompanyIds,
  type AuthorityGrant,
  type PinKeeper,
  type User,
  type Store,
} from '@prima/core';
import { Pool } from 'pg';
import { PgStore } from './pg-store';
import { migrationSha } from './schema';

export function nowMyt(): string {
  return fromMs(Date.now());
}

/**
 * The key for staff PIN hashes (pin.ts): PIN_PEPPER, a Key Vault secret of 32+ characters. In production a missing,
 * short or test key switches PIN checks off (refused with a clear message) instead of weakening them. Local runs and
 * tests use the test key, which the mock data was hashed with.
 */
export function apiPinKeeper(env: NodeJS.ProcessEnv = process.env): PinKeeper {
  const key = env.PIN_PEPPER;
  if (env.NODE_ENV === 'production') return pinKeeper(key && key !== DEMO_PIN_KEY ? key : null);
  return pinKeeper(key || DEMO_PIN_KEY);
}

@Injectable()
export class Db implements OnModuleDestroy {
  readonly pool = makePool();
  readonly pins = apiPinKeeper();

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Run one request as a user. The user and their grants are read first; then the
   * transaction drops to the prima_app role with app.company_ids set, so row-level
   * security, not only application code, keeps each company's records apart. app.walls
   * carries the department walls the person passes (access.ts dataWalls), for the
   * group-wide department tables. A closed account (offboarding) is refused here, so no
   * route can serve a leaver whatever way they signed in.
   */
  async asUser<R>(userId: string, fn: (svc: PrimaService, user: User, store: Store) => Promise<R>, clock: () => string = nowMyt): Promise<R> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const u = await client.query('SELECT data FROM prima.users WHERE id = $1', [userId]);
      if (u.rowCount === 0) throw new UnknownUser();
      const user = u.rows[0].data as User;
      if (accessClosed(user, dateOf(clock()))) throw new AccessClosed(user.accessClosedFrom!);
      const g = await client.query('SELECT data FROM prima.grants WHERE data->>$1 = $2', ['userId', userId]);
      const grants = g.rows.map((r) => r.data as AuthorityGrant);
      const companies = tenantCompanyIds(user, grants, dateOf(clock()));
      await client.query('SET LOCAL ROLE prima_app');
      await client.query(`SELECT set_config('app.company_ids', $1, true)`, [companies.join(',')]);
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [user.id]);
      await client.query(`SELECT set_config('app.group_user', $1, true)`, [isGroupRole(user) ? 'on' : 'off']);
      await client.query(`SELECT set_config('app.walls', $1, true)`, [dataWalls(user).join(',')]);
      const store = new PgStore(client);
      const svc = new PrimaService(store, clock);
      svc.pins = this.pins;
      const out = await fn(svc, user, store);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
}

function makePool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url && process.env.NODE_ENV === 'production') throw new Error('DATABASE_URL is not set.');
  const pool = new Pool({
    connectionString: url ?? 'postgres://postgres@localhost:5432/prima',
    max: Number(process.env.DB_POOL_MAX ?? 10),
    // Fail fast instead of hanging a request when the database is away, and let Azure close idle connections.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    // No single statement may hold a connection for more than 30 seconds.
    statement_timeout: 30_000,
    idle_in_transaction_session_timeout: 60_000,
  });
  // A connection the server drops while idle (Azure maintenance, failover) must not crash the API: log it and let
  // the pool open a new one.
  pool.on('error', (e) => console.error(`Database connection dropped: ${e.message}`));
  return pool;
}

/** The login the API must use on Azure: least privilege, made by db-setup.ts. */
export function expectedApiLogin(env: NodeJS.ProcessEnv = process.env): string {
  return env.PRIMA_API_DB_USER || 'prima_api';
}

/**
 * Refuses to run the API as anything stronger than its own restricted login: not a superuser, not able to bypass the
 * company wall, make roles or databases, not the owner of the Prima schema and not able to change it. Run at start-up
 * in production, so a wrong DATABASE_URL (for example the administrator's) stops the API instead of serving.
 */
export async function assertRestrictedLogin(pool: Pick<Pool, 'query'>, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const r = await pool.query(
    `SELECT current_user AS who, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
            has_schema_privilege(current_user, 'prima', 'CREATE') AS can_create,
            EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname = 'prima' AND pg_has_role(current_user, n.nspowner, 'USAGE')) AS owns
       FROM pg_roles r WHERE r.rolname = current_user`,
  );
  const row = r.rows[0];
  const want = expectedApiLogin(env);
  if (!row) throw new Error('The API could not read its own database login.');
  if (row.who !== want) throw new Error(`The API must connect as ${want}, not ${row.who}. Check DATABASE_URL.`);
  if (row.rolsuper || row.rolbypassrls || row.rolcreaterole || row.rolcreatedb || row.can_create || row.owns)
    throw new Error(`The database login ${row.who} has more rights than the API may hold. Run the database setup job again.`);
}

/** The schema version the database was last set up with, and the one this build of the API needs. */
export async function schemaState(pool: Pick<Pool, 'query'>): Promise<{ current: boolean; expected: string; applied: string | null }> {
  const expected = migrationSha();
  const has = await pool.query(`SELECT to_regclass('prima.schema_info') IS NOT NULL AS ok`);
  const applied = has.rows[0].ok ? ((await pool.query('SELECT migration_sha256 FROM prima.schema_info WHERE id = 1')).rows[0]?.migration_sha256 ?? null) : null;
  return { current: applied === expected, expected, applied };
}

/**
 * Refuses to run on a database whose schema is older than this build expects. Routine deploys never migrate (they hold
 * no administrator rights); the CEO runs the database setup job first (infra/run-db-migration.sh).
 */
export async function assertSchemaCurrent(pool: Pick<Pool, 'query'>): Promise<void> {
  const s = await schemaState(pool);
  if (!s.current)
    throw new Error(
      `The database schema is ${s.applied ? `version ${s.applied.slice(0, 12)}` : 'not marked'}, but this API needs ${s.expected.slice(0, 12)}. Run the database setup job (infra/run-db-migration.sh) first.`,
    );
}

export class UnknownUser extends Error {
  constructor() {
    super('Unknown user');
    this.name = 'UnknownUser';
  }
}
