import { scaled } from './scale.mjs';
import { connectLocalDb, localDbConfig, orRefuse } from './target.mjs';
const reset = await import('/home/claude/prima-secure-app/apps/api/dist/src/reset-db.js');
const schema = await import('/home/claude/prima-secure-app/apps/api/dist/src/schema.js');
const url = process.env.DATABASE_URL;
// Fail closed (Arisha review, 3 Nov 2026): this script DROPS the prima schema. It runs only against a local database
// whose name says it is disposable, and only when the operator says so explicitly (see target.mjs). Checked before
// anything else happens.
await orRefuse(() => localDbConfig(url));
const now = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 19) + '+08:00';
const today = now.slice(0, 10);
const out = { scale: {} };
const ds = scaled(today, now, out);
console.log(out.scale);
const c = await orRefuse(() => connectLocalDb(url));
await c.query('DROP SCHEMA IF EXISTS prima CASCADE');
await c.query(schema.migrationSql());
await c.query(schema.companyOfficeModuleSql());
const t = Date.now();
await reset.insertDataset(c, ds);
console.log('inserted in', Date.now() - t, 'ms');
const r = await c.query("select pg_size_pretty(pg_database_size(current_database()))"); console.log('db size', r.rows[0]);
await c.end();
