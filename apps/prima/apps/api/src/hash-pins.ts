// Turns any PIN still kept as typed (from before PINs were hashed, 31 Oct 2026) into its keyed hash, and removes the
// typed one. A record that already has a hash (HR set a new PIN since) keeps that hash: the old typed PIN is only
// removed, never brought back. Run once by the database administrator, never by the API, with the same PIN_PEPPER the API has:
//   node dist/src/hash-pins.js --by "<name>"            shows how many records would change; changes nothing
//   node dist/src/hash-pins.js --by "<name>" --apply    makes the change, in one transaction, on the audit chain
// A record with an empty or malformed PIN loses it and gets none: HR sets a new one. The PINs themselves are never
// printed or logged. Staging started as a clean slate with no guard PINs, so it is expected to find little or nothing.
import { CENTRAL_EMPLOYER_IDS, PIN_PATTERN, fromMs, isPinHash } from '@prima/core';
import { Pool, type PoolClient } from 'pg';
import { apiPinKeeper } from './db';
import { PgStore } from './pg-store';

export interface HashPinsResult {
  hashed: number;
  /** Already hashed (a newer PIN set by HR): only the old typed PIN removed. */
  kept: number;
  cleared: number;
  applied: boolean;
}

export async function hashPins(client: PoolClient, by: string, apply: boolean, env: NodeJS.ProcessEnv = process.env, now = Date.now()): Promise<HashPinsResult> {
  if (!by.trim()) throw new Error('Say who is running this (--by).');
  const keeper = apiPinKeeper({ ...env, NODE_ENV: 'production' });
  if (!keeper.on) throw new Error('PIN_PEPPER must be the API key from Key Vault (32+ characters, not the test key). Nothing was changed.');
  await client.query('BEGIN');
  try {
    // Staff records sit behind the company wall even for the administrator: open it for every company named anywhere.
    const ids = await client.query(
      `SELECT array_agg(DISTINCT c) AS ids FROM (
         SELECT company_id AS c FROM prima.grants
         UNION SELECT jsonb_array_elements_text(data->'companyIds') FROM prima.users
         UNION SELECT unnest($1::text[])) x`,
      [[...CENTRAL_EMPLOYER_IDS]],
    );
    await client.query(`SELECT set_config('app.company_ids', $1, true)`, [(ids.rows[0].ids ?? []).join(',')]);
    const rows = await client.query(`SELECT id, data->>'pin' AS pin, data->>'pinHash' AS hash FROM prima.people WHERE data ? 'pin' FOR UPDATE`);
    let hashed = 0;
    let kept = 0;
    let cleared = 0;
    for (const r of rows.rows as { id: string; pin: string | null; hash: string | null }[]) {
      if (isPinHash(r.hash)) {
        kept += 1;
        if (apply) await client.query(`UPDATE prima.people SET data = data - 'pin' WHERE id = $1`, [r.id]);
        continue;
      }
      const ok = typeof r.pin === 'string' && PIN_PATTERN.test(r.pin);
      if (ok) hashed += 1;
      else cleared += 1;
      if (!apply) continue;
      await client.query(`UPDATE prima.people SET data = (data - 'pin') || jsonb_build_object('pinHash', $2::text) WHERE id = $1`, [
        r.id,
        ok ? keeper.hash(r.pin!) : null,
      ]);
    }
    if (apply && hashed + kept + cleared > 0)
      await new PgStore(client).audit({
        at: fromMs(now),
        actor: by.trim(),
        companyId: null,
        action: 'PIN_HASH',
        entity: 'people',
        entityId: 'all',
        summary: `Staff PINs kept as typed turned into hashes: ${hashed} hashed, ${kept} already reset by HR (old PIN removed, new kept), ${cleared} empty or malformed removed (HR sets new ones).`,
      });
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    return { hashed, kept, cleared, applied: apply };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const byAt = args.indexOf('--by');
  const by = byAt >= 0 ? (args[byAt + 1] ?? '') : '';
  const apply = args.includes('--apply');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  pool
    .connect()
    .then((client) => hashPins(client, by, apply).finally(() => client.release()))
    .then((r) =>
      console.log(
        `${r.applied ? 'Done' : 'Dry run, nothing changed'}: ${r.hashed} PIN(s) ${r.applied ? 'hashed' : 'to hash'}, ${r.kept} already reset by HR (old PIN ${r.applied ? 'removed' : 'to remove'}), ${r.cleared} empty or malformed ${r.applied ? 'removed' : 'to remove'}.`,
      ),
    )
    .catch((e: Error) => {
      console.error(e.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
