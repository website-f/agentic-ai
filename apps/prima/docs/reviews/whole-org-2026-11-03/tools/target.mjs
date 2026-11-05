// Fail-closed destinations for the review's load tools (Arisha review, 3 Nov 2026). Every tool that connects to a
// database or sends requests goes through here, and is refused BEFORE any connection or write unless the effective
// destination is this machine and (for the database) a disposable prima_stress/base/scratch/test database.
// - Database: the URL may carry no query string at all (pg reads ?host=, ?hostaddr=, ?options= and more from it), no
//   PG* environment overrides are allowed, and the client is built from explicit fields, never from the string.
//   After connecting, the server itself must report a loopback or socket address and the same database name.
// - API: plain http to localhost/127.0.0.1/[::1], no user info, no query or fragment, and redirects are refused.
import pg from '/home/claude/prima-secure-app/node_modules/pg/lib/index.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const DISPOSABLE = /^prima_(stress|base|scratch|test)[a-z0-9_]*$/;
const PG_ENV = ['PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS', 'PGSSLMODE'];

export class Refused extends Error {}

/** Checks a database URL; returns explicit connection fields or throws Refused. Pure: no connection is made. */
export function localDbConfig(url, env = process.env) {
  let u;
  try {
    u = new URL(url ?? '');
  } catch {
    throw new Refused('Refused: DATABASE_URL is not a URL.');
  }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') throw new Refused('Refused: only postgres:// URLs.');
  if (u.search || u.hash) throw new Refused('Refused: the database URL may not carry query settings (they can point elsewhere).');
  if (!LOCAL_HOSTS.has(u.hostname)) throw new Refused('Refused: local database only.');
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!DISPOSABLE.test(database)) throw new Refused('Refused: the database name must be prima_stress, prima_base, prima_scratch or prima_test*.');
  const set = PG_ENV.filter((k) => env[k] !== undefined && env[k] !== '');
  if (set.length) throw new Refused(`Refused: unset ${set.join(', ')} first.`);
  if (env.STRESS_DISPOSABLE_DB !== 'yes') throw new Refused('Refused: set STRESS_DISPOSABLE_DB=yes to confirm the database may be changed.');
  const port = u.port ? Number(u.port) : 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Refused('Refused: bad port.');
  return {
    host: u.hostname === '[::1]' ? '::1' : u.hostname,
    port,
    database,
    user: decodeURIComponent(u.username || 'postgres'),
    password: decodeURIComponent(u.password || ''),
  };
}

/** Connects to the checked local database and confirms, from the server's side, where it landed. */
export async function connectLocalDb(url, env = process.env) {
  const cfg = localDbConfig(url, env);
  const c = new pg.Client(cfg);
  await c.connect();
  const r = await c.query('SELECT current_database() AS db, inet_server_addr()::text AS addr');
  const { db, addr } = r.rows[0];
  const loopback = addr === null || /^(127\.|::1(\/128)?$)/.test(addr);
  if (db !== cfg.database || !loopback) {
    await c.end();
    throw new Refused(`Refused: the server reports ${db} at ${addr}; expected ${cfg.database} on this machine.`);
  }
  return c;
}

/** Checks an API base URL; returns it normalised or throws Refused. Pure: no request is made. */
export function localApiBase(base) {
  let u;
  try {
    u = new URL(base ?? '');
  } catch {
    throw new Refused('Refused: BASE is not a URL.');
  }
  if (u.protocol !== 'http:') throw new Refused('Refused: the local API is plain http.');
  if (u.username || u.password) throw new Refused('Refused: no user info in BASE.');
  if (u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) throw new Refused('Refused: BASE is the server address only.');
  if (!LOCAL_HOSTS.has(u.hostname)) throw new Refused('Refused: local API only.');
  return `http://${u.host}`;
}

/** fetch for the checked local API: paths only, redirects refused. */
export function localFetch(base) {
  const root = localApiBase(base);
  return (path, init = {}) => {
    if (typeof path !== 'string' || !path.startsWith('/api/') || path.startsWith('//')) throw new Refused('Refused: API paths only.');
    return fetch(root + path, { ...init, redirect: 'error' });
  };
}

/** Runs a tool's setup; on Refused prints the reason and exits 2 before anything else happens. */
export async function orRefuse(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Refused) {
      console.error(e.message);
      process.exit(2);
    }
    throw e;
  }
}
