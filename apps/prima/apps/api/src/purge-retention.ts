// Part N16 (Fitri package, 13 Nov 2026): the J5 clean-up job, for the other keep periods. Run once a day by the
// operator or a scheduled job with the administrator database login (the app role cannot delete):
//   node dist/src/purge-retention.js --by "<name or job>"            (counts what would go)
//   node dist/src/purge-retention.js --by "<name or job>" --apply    (deletes, one audit entry with the counts)
// What goes, each by its rule:
//   - site gate (visitor and vehicle) records older than SITE-GATE keepYears (7 years, the law allows 2 to 7);
//   - CMS proof video clips past their keep date (CMS-DISPATCH videoKeepDays, 90 days) that are not attached to a case.
// Location readings stay with purge-locations (J5). Personnel records (7 years after the last day, HR-RECORDS-KEEP)
// and applicants are not deleted by a job: HR decides each one. A record under an open legal hold that names it is never
// deleted (holds on gate records and clips need db/modules/central-admin-legal-holds-v2.sql, run by the CEO).
// D1 (Fauzan, 23 Nov 2026): --apply deletes only while the PDPA officer's weekly OK is valid (module pdpa-officer-v1);
// counting what would go needs no OK.
import { RULES, fromMs } from '@prima/core';
import { Pool, type PoolClient } from 'pg';
import { PgStore } from './pg-store';
import { notePurgeRun, requirePurgeOk } from './purge-ok';

export async function purgeRetention(client: PoolClient, by: string, apply: boolean, now = Date.now()) {
  if (!by.trim()) throw new Error('Say who is running this (--by).');
  const gateYears = Math.max(RULES.siteGate.value.keepYearsMin, Math.min(RULES.siteGate.value.keepYearsMax, RULES.siteGate.value.keepYears));
  const gateCut = new Date(now - Math.round(gateYears * 365.25) * 86_400_000).toISOString();
  const today = fromMs(now).slice(0, 10);
  await client.query('BEGIN');
  try {
    const ok = apply ? await requirePurgeOk(client, today) : null;
    // Fauzan's audit of 4b708ae (P2): a hold is open while its "released" is null (the hold stores released: {by, byId,
    // at} once released), and it protects only the record it names: the same table and the same id.
    const hasHolds = (await client.query(`SELECT to_regclass('prima.legal_holds') IS NOT NULL AS ok`)).rows[0].ok;
    const held = (tbl: string) =>
      hasHolds
        ? `AND NOT EXISTS (SELECT 1 FROM prima.legal_holds h WHERE h.data->>'tbl' = '${tbl}' AND h.data->>'refId' = t.id AND coalesce(h.data->'released', 'null'::jsonb) = 'null'::jsonb)`
        : '';
    const run = (sql: string, params: unknown[]) => client.query(apply ? `DELETE FROM ${sql}` : `SELECT 1 FROM ${sql}`, params);
    const gate = (await run(`prima.gate_entries t WHERE (t.data->>'inAt')::timestamptz < $1::timestamptz ${held('gate_entries')}`, [gateCut])).rowCount ?? 0;
    const videos = (await run(`prima.evidence_videos t WHERE t.data->>'caseId' IS NULL AND (t.data->>'keepUntil')::date < $1::date ${held('evidence_videos')}`, [today])).rowCount ?? 0;
    if (apply && gate + videos > 0)
      await new PgStore(client).audit({
        at: fromMs(now),
        actor: by.trim(),
        companyId: null,
        action: 'RETENTION_PURGE',
        entity: 'retention',
        entityId: 'daily',
        summary: `Kept periods ended: ${gate} site gate record(s) before ${gateCut.slice(0, 10)} (${gateYears} years), ${videos} CMS clip(s) past their keep date and not on a case. Under the PDPA officer's OK ${ok!.id} (${ok!.by})`,
      });
    if (ok) await notePurgeRun(client, ok.id, { at: fromMs(now), by: by.trim(), what: `${gate} site gate record(s), ${videos} CMS clip(s)` });
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    return { gate, videos, gateCut, gateYears, applied: apply, okId: ok?.id ?? null };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const by = args[args.indexOf('--by') + 1] ?? '';
  (async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();
    try {
      const r = await purgeRetention(client, args.includes('--by') ? by : '', args.includes('--apply'));
      console.log(JSON.stringify(r));
    } finally {
      client.release();
      await pool.end();
    }
  })().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
