// A12 (Fitri package, Fauzan 11 Nov 2026): location readings are kept for the set days (guard phones OPS-GUARD-PHONE
// keepPingsDays, staff clock HR-STAFF-KEEP), then deleted. Run once a day by the operator or a scheduled job with the
// administrator database login (the app role cannot delete):
//   node dist/src/purge-locations.js --by "<name or job>"            (counts what would go)
//   node dist/src/purge-locations.js --by "<name or job>" --apply    (deletes, one audit entry with the counts)
// Only the reading rows go; sessions, clock-ins, SOS alerts and cases keep their own records. Backups follow the
// server's own backup retention. D1 (Fauzan, 23 Nov 2026): --apply deletes only while the PDPA officer's weekly OK is
// valid (module pdpa-officer-v1); counting what would go needs no OK.
import { RULES, fromMs, locationCutoff } from '@prima/core';
import { Pool, type PoolClient } from 'pg';
import { PgStore } from './pg-store';
import { notePurgeRun, requirePurgeOk } from './purge-ok';

export async function purgeLocations(client: PoolClient, by: string, apply: boolean, now = Date.now()) {
  if (!by.trim()) throw new Error('Say who is running this (--by).');
  const guardCut = locationCutoff(now, RULES.guardPhone.value.keepPingsDays);
  const staffCut = locationCutoff(now, RULES.staffTrackKeepDays.value);
  await client.query('BEGIN');
  try {
    const ok = apply ? await requirePurgeOk(client, fromMs(now).slice(0, 10)) : null;
    const q = (table: string, cut: string) =>
      apply
        ? client.query(`DELETE FROM prima.${table} WHERE (data->>'receivedAt')::timestamptz < $1::timestamptz`, [cut])
        : client.query(`SELECT 1 FROM prima.${table} WHERE (data->>'receivedAt')::timestamptz < $1::timestamptz`, [cut]);
    const guard = (await q('guard_pings', guardCut)).rowCount ?? 0;
    const staff = (await q('location_pings', staffCut)).rowCount ?? 0;
    if (apply && guard + staff > 0)
      await new PgStore(client).audit({
        at: fromMs(now),
        actor: by.trim(),
        companyId: null,
        action: 'LOCATION_PURGE',
        entity: 'location',
        entityId: 'daily',
        summary: `Location readings deleted: ${guard} guard phone reading(s) before ${guardCut}, ${staff} staff reading(s) before ${staffCut}. Under the PDPA officer's OK ${ok!.id} (${ok!.by})`,
      });
    if (ok) await notePurgeRun(client, ok.id, { at: fromMs(now), by: by.trim(), what: `${guard} guard phone and ${staff} staff location reading(s)` });
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    return { guard, staff, guardCut, staffCut, applied: apply, okId: ok?.id ?? null };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const byAt = args.indexOf('--by');
  const by = byAt >= 0 ? (args[byAt + 1] ?? '') : '';
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  void (async () => {
    const client = await pool.connect();
    try {
      const r = await purgeLocations(client, by, args.includes('--apply'));
      console.log(`${r.applied ? 'Deleted' : 'Would delete'} ${r.guard} guard phone and ${r.staff} staff location reading(s).`);
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    } finally {
      client.release();
      await pool.end();
    }
  })();
}
