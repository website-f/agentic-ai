// Link a staff record to its Microsoft 365 account, or remove the link. Run by IT on the server, never from the web:
//   node dist/src/entra-link.js <prima user id> <entra object id> --by "<IT person>"
//   node dist/src/entra-link.js <prima user id> --unlink --by "<IT person>"
// The object ID is on the user's page in the Microsoft Entra admin centre. Each change goes on the audit chain.
import { fromMs, type User } from '@prima/core';
import { Pool, type PoolClient } from 'pg';
import { PgStore } from './pg-store';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function linkEntra(client: PoolClient, userId: string, oid: string | null, by: string, now = Date.now()): Promise<string> {
  if (!by.trim()) throw new Error('Say who is making the change (--by).');
  if (oid !== null && !GUID.test(oid)) throw new Error('The Microsoft object ID must be a GUID.');
  const id = oid?.toLowerCase() ?? null;
  await client.query('BEGIN');
  try {
    const u = await client.query('SELECT data FROM prima.users WHERE id = $1 FOR UPDATE', [userId]);
    if (u.rowCount === 0) throw new Error(`No staff record ${userId}.`);
    const user = u.rows[0].data as User;
    if (user.integration) throw new Error('A system feed cannot be linked to a Microsoft account.');
    if (id) {
      const taken = await client.query(`SELECT id FROM prima.users WHERE lower(data->>'entraOid') = $1 AND id <> $2`, [id, userId]);
      if (taken.rowCount) throw new Error(`That Microsoft account is already linked to ${taken.rows[0].id}. Unlink it there first.`);
      await client.query(`UPDATE prima.users SET data = jsonb_set(data, '{entraOid}', to_jsonb($2::text)) WHERE id = $1`, [userId, id]);
    } else {
      await client.query(`UPDATE prima.users SET data = data - 'entraOid' WHERE id = $1`, [userId]);
    }
    const summary = id
      ? `${user.name} linked to Microsoft account ${id}${user.entraOid ? ` (was ${user.entraOid})` : ''}`
      : `${user.name} unlinked from Microsoft account ${user.entraOid ?? '(none)'}`;
    await new PgStore(client).audit({ at: fromMs(now), actor: by.trim(), companyId: null, action: id ? 'ENTRA_LINK' : 'ENTRA_UNLINK', entity: 'user', entityId: userId, summary });
    await client.query('COMMIT');
    return summary;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const byAt = args.indexOf('--by');
  const by = byAt >= 0 ? (args[byAt + 1] ?? '') : '';
  const rest = args.filter((_, i) => i !== byAt && i !== byAt + 1);
  const [userId, second] = rest;
  const oid = second === '--unlink' ? null : (second ?? '');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  pool
    .connect()
    .then((client) => linkEntra(client, userId ?? '', oid, by).finally(() => client.release()))
    .then((s) => console.log(s))
    .catch((e: Error) => {
      console.error(e.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
