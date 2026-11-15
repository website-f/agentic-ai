// A12 (Fitri package, Fauzan 11 Nov 2026): make guard sign-ins in bulk for one company, then the office issues each
// guard's phone code in the app. Run by IT on the server with the administrator database login, never from the web:
//   node dist/src/guard-logins.js <company id> --by "<IT person>"            (lists what would be made)
//   node dist/src/guard-logins.js <company id> --by "<IT person>" --apply    (makes them, one audit entry)
// A sign-in made here is own-view only (no grants); the guard still needs a PIN and an enrolled phone to use it.
import { fromMs, guardLoginsToCreate, type Person, type User } from '@prima/core';
import { Pool, type PoolClient } from 'pg';
import { PgStore } from './pg-store';

export async function createGuardLogins(client: PoolClient, companyId: string, by: string, apply: boolean, now = Date.now()) {
  if (!by.trim()) throw new Error('Say who is making the change (--by).');
  await client.query('BEGIN');
  try {
    const c = await client.query('SELECT 1 FROM prima.companies WHERE id = $1', [companyId]);
    if (!c.rowCount) throw new Error(`No company ${companyId}.`);
    const people = (await client.query('SELECT data FROM prima.people WHERE company_id = $1', [companyId])).rows.map((r) => r.data as Person);
    const users = (await client.query('SELECT data FROM prima.users FOR UPDATE')).rows.map((r) => r.data as User);
    const plan = guardLoginsToCreate(people, users);
    if (apply && plan.create.length) {
      for (const u of plan.create) await client.query('INSERT INTO prima.users (id, data) VALUES ($1, $2)', [u.id, u]);
      await new PgStore(client).audit({
        at: fromMs(now),
        actor: by.trim(),
        companyId,
        action: 'GUARD_LOGINS_BULK',
        entity: 'company',
        entityId: companyId,
        summary: `${plan.create.length} guard sign-in(s) made for ${companyId} (own view only); ${plan.skipped.length} skipped`,
      });
    }
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    return { ...plan, applied: apply };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const byAt = args.indexOf('--by');
  const by = byAt >= 0 ? (args[byAt + 1] ?? '') : '';
  const companyId = args.find((a, i) => !a.startsWith('--') && i !== byAt + 1) ?? '';
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  void (async () => {
    const client = await pool.connect();
    try {
      const r = await createGuardLogins(client, companyId, by, args.includes('--apply'));
      console.log(`${r.applied ? 'Made' : 'Would make'} ${r.create.length} sign-in(s); skipped ${r.skipped.length}.`);
      for (const s of r.skipped) console.log(`  skipped ${s.personId}: ${s.why}`);
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    } finally {
      client.release();
      await pool.end();
    }
  })();
}
