// Daily retention for Arisha IT import reviews (Fauzan, 31 Oct 2026): a review left open 24 hours expires, and 30 days
// after a review closes its reviewed rows are cleared, leaving fingerprints, counts and the receipt. Run once a day by the
// operator or a scheduled job, as the API's database login (it acts only through the app role and the database function):
//   node dist/src/tidy-reviews.js --by "<name or job>"
// The database function writes each change to the audit chain itself, with no value in it. This never touches IT tickets or jobs that were imported, and
// it does not change database backups (Azure keeps those for the server's own backup retention).
import { Pool, type PoolClient } from 'pg';
import { PgStore } from './pg-store';

export async function tidyReviews(client: PoolClient, by: string): Promise<{ expired: number; purged: number }> {
  if (!by.trim()) throw new Error('Say who is running this (--by).');
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL ROLE prima_app');
    // The database function admits only the CEO's own requests or this job, and audits each change itself.
    await client.query(`SELECT set_config('app.job', 'review-tidy', true)`);
    const changed = await new PgStore(client).tidyItImportReviews(by.trim());
    await client.query('COMMIT');
    return { expired: changed.filter((c) => c.outcome === 'expired').length, purged: changed.filter((c) => c.outcome === 'purged').length };
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
  pool
    .connect()
    .then(async (client) => {
      try {
        const out = await tidyReviews(client, by);
        console.log(`Reviews expired: ${out.expired}; reviews cleared: ${out.purged}.`);
      } finally {
        client.release();
      }
    })
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
