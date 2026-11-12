// J5 and G9 (Fauzan, 11 Nov 2026: "Keep staff location readings 90 days" and "90-day location deletion: BUILD"): the
// daily job that deletes location readings past the keep period (rule HR-STAFF-KEEP, 90 days) through the database's
// own function prima.purge_location_readings (db/modules/location-retention-v1.sql). It runs inside the API once a day
// (first 5 minutes after start), and can be run by hand: node dist/src/location-retention.js. Until the module is
// installed (CEO-run migration) it does nothing and says so once. LOCATION_RETENTION=off stops it. Each run with
// something deleted goes on the audit chain (counts only: no person, place or reading).
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { RULES, fromMs } from '@prima/core';
import { Db } from './db';
import { PgStore } from './pg-store';

export interface RetentionResult {
  installed: boolean;
  staff: number;
  guards: number;
  photos: number;
}

export async function runLocationRetention(client: PoolClient, keepDays = RULES.staffTrackKeepDays.value, nowMs = Date.now()): Promise<RetentionResult> {
  const ready = (await client.query(`SELECT to_regprocedure('prima.purge_location_readings(integer)') IS NOT NULL AS ok`)).rows[0]?.ok === true;
  if (!ready) return { installed: false, staff: 0, guards: 0, photos: 0 };
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL ROLE prima_app');
    await client.query(`SELECT set_config('app.job', 'location-retention', true)`);
    const r = (await client.query('SELECT prima.purge_location_readings($1) AS r', [keepDays])).rows[0].r as { staff: number; guards: number; photos: number };
    if (r.staff + r.guards + r.photos > 0)
      await new PgStore(client).audit({
        at: fromMs(nowMs),
        actor: 'Location retention (automatic)',
        companyId: null,
        action: 'privacy.location_retention',
        entity: 'location_readings',
        entityId: 'retention',
        summary: `Readings older than ${keepDays} days deleted: ${r.staff} staff clock, ${r.guards} guard phone; ${r.photos} check-in photo${r.photos === 1 ? '' : 's'} dropped (rule HR-STAFF-KEEP).`,
      });
    await client.query('COMMIT');
    return { installed: true, ...r };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  }
}

@Injectable()
export class LocationRetentionJob implements OnModuleInit, OnModuleDestroy {
  private timers: NodeJS.Timeout[] = [];
  private warned = false;
  constructor(private db: Db) {}

  onModuleInit() {
    if (process.env.LOCATION_RETENTION === 'off' || process.env.NODE_ENV === 'test') return;
    const run = () => void this.once().catch((e) => console.error(`Location retention failed: ${e instanceof Error ? e.message : e}`));
    const first = setTimeout(run, 5 * 60_000);
    const daily = setInterval(run, 24 * 3_600_000);
    first.unref?.();
    daily.unref?.();
    this.timers.push(first, daily);
  }

  onModuleDestroy() {
    for (const t of this.timers) clearTimeout(t);
  }

  async once(): Promise<RetentionResult> {
    const client = await this.db.pool.connect();
    try {
      const r = await runLocationRetention(client);
      if (!r.installed && !this.warned) {
        this.warned = true;
        console.log('Location retention is not installed in this database yet (module location-retention-v1, CEO-run migration).');
      }
      return r;
    } finally {
      client.release();
    }
  }
}

if (require.main === module) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  pool
    .connect()
    .then(async (client) => {
      try {
        const r = await runLocationRetention(client);
        console.log(r.installed ? `Deleted ${r.staff} staff clock and ${r.guards} guard phone readings; dropped ${r.photos} check-in photos.` : 'Module location-retention-v1 is not installed.');
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
