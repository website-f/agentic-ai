// D1 (Fauzan, 23 Nov 2026: "Do the gap" on the PDPA officer check): data past its keep period is deleted only while the
// PDPA officer's OK for the week is valid (db/modules/pdpa-officer-v1.sql). Counting what would go needs no OK. Each run
// that deletes is added to the OK, so the officer sees what the clean-up did under it.
import type { PoolClient } from 'pg';

/** The OK valid on this day, or an error that says what is missing. Call inside the job's transaction. */
export async function requirePurgeOk(client: PoolClient, today: string): Promise<{ id: string; by: string }> {
  const has = (await client.query(`SELECT to_regclass('prima.pdpa_purge_oks') IS NOT NULL AS ok`)).rows[0].ok;
  if (!has) throw new Error('The clean-up deletes only with the PDPA officer’s OK, and the OK is not installed yet (module pdpa-officer-v1). Nothing was deleted.');
  const r = await client.query(
    `SELECT id, data->>'by' AS by FROM prima.pdpa_purge_oks
      WHERE (data->>'okOn')::date <= $1::date AND (data->>'validUntil')::date >= $1::date
      ORDER BY data->>'okOn' DESC LIMIT 1 FOR UPDATE`,
    [today],
  );
  if (!r.rows.length) throw new Error('No PDPA officer OK for the clean-up is valid today. Ask the PDPA officer (PDPA screen, Keep periods). Nothing was deleted.');
  return { id: r.rows[0].id, by: r.rows[0].by };
}

/** Adds this run to the OK it ran under. */
export async function notePurgeRun(client: PoolClient, okId: string, run: { at: string; by: string; what: string }) {
  await client.query(`UPDATE prima.pdpa_purge_oks SET data = jsonb_set(data, '{runs}', coalesce(data->'runs', '[]'::jsonb) || $2::jsonb) WHERE id = $1`, [okId, JSON.stringify([run])]);
}
