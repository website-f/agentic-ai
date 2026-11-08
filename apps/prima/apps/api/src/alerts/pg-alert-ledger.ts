import type { Pool } from 'pg';
import type { AlertLedger } from './alerts';

/** The sent-record in PostgreSQL (alerts-ledger-v1.sql). Every statement runs as prima_app. */
export class PgAlertLedger implements AlertLedger {
  constructor(private readonly pool: Pool) {}

  private async asApp<R>(sql: string, params: unknown[]): Promise<R[]> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE prima_app');
      const r = await c.query(sql, params);
      await c.query('COMMIT');
      return r.rows as R[];
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  /** True only once the reviewed migration has made the table with its version marker. */
  async ready(): Promise<boolean> {
    const r = await this.pool.query(`SELECT obj_description(to_regclass('prima.alert_deliveries'), 'pg_class') AS marker`);
    return r.rows[0]?.marker === 'prima-alerts-ledger-v1';
  }

  async claim(id: string, channel: 'email' | 'teams'): Promise<boolean> {
    const rows = await this.asApp<{ id: string }>('INSERT INTO prima.alert_deliveries (id, channel) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id', [id, channel]);
    return rows.length === 1;
  }

  async release(id: string): Promise<void> {
    await this.asApp('DELETE FROM prima.alert_deliveries WHERE id = $1', [id]);
  }
}
