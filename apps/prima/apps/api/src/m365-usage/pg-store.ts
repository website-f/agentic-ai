import type { Pool } from 'pg';
import type { UsageSnapshot } from '@prima/core';

/** Where the daily snapshot is kept. */
export interface UsageStore {
  ready(): Promise<boolean>;
  save(s: UsageSnapshot): Promise<void>;
  latest(): Promise<UsageSnapshot | null>;
}

export class MemoryUsageStore implements UsageStore {
  readonly days = new Map<string, UsageSnapshot>();
  constructor(private readonly installed = true) {}
  async ready() {
    return this.installed;
  }
  async save(s: UsageSnapshot) {
    this.days.set(s.asOf, s);
  }
  async latest() {
    const last = [...this.days.keys()].sort().at(-1);
    return last ? this.days.get(last)! : null;
  }
}

/** db/modules/m365-usage-v1.sql. Every statement runs as prima_app. */
export class PgUsageStore implements UsageStore {
  constructor(private readonly pool: Pool) {}

  private async asApp<R>(fn: (q: (sql: string, params: unknown[]) => Promise<R[]>) => Promise<void | R[]>): Promise<R[]> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE prima_app');
      let rows: R[] = [];
      const out = await fn(async (sql, params) => (rows = (await c.query(sql, params)).rows as R[]));
      await c.query('COMMIT');
      return (out as R[] | undefined) ?? rows;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  async ready(): Promise<boolean> {
    const r = await this.pool.query(`SELECT obj_description(to_regclass('prima.m365_usage_days'), 'pg_class') AS marker`);
    return r.rows[0]?.marker === 'prima-m365-usage-v1';
  }

  async save(s: UsageSnapshot): Promise<void> {
    await this.asApp(async (q) => {
      await q(
        `INSERT INTO prima.m365_usage_days (as_of, data, fetched_at) VALUES ($1, $2, now())
         ON CONFLICT (as_of) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`,
        [s.asOf, JSON.stringify(s)],
      );
      await q(`DELETE FROM prima.m365_usage_days WHERE as_of < ($1::date - 90)`, [s.asOf]);
    });
  }

  async latest(): Promise<UsageSnapshot | null> {
    const rows = await this.asApp<{ data: UsageSnapshot }>(async (q) => q('SELECT data FROM prima.m365_usage_days ORDER BY as_of DESC LIMIT 1', []));
    return rows[0]?.data ?? null;
  }
}
