import type { Pool } from 'pg';
import type { AiBudget } from '@prima/core';

/**
 * The helpers' monthly spend per agent in PostgreSQL (module ai-budget-v1; Fauzan's retest, 23 Nov 2026: "spending
 * limits reset after a server restart. Keep it off until budget tracking is durable"). Survives restarts and is shared
 * by every server; the reserve takes a row lock in the database, so two servers cannot both slip under the cap. The API
 * calls only the module's three functions, as prima_app, in short transactions of their own.
 */
export class PgAiBudget implements AiBudget {
  readonly durable = true;
  private installed = false;
  constructor(private readonly pool: Pick<Pool, 'connect'>, private readonly capUsd: number) {}

  private async run<T>(sql: string, params: unknown[], pick: (row: Record<string, unknown>) => T): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE prima_app');
      const r = await client.query(sql, params);
      await client.query('COMMIT');
      return pick(r.rows[0] ?? {});
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async ready(): Promise<boolean> {
    if (this.installed) return true;
    this.installed = await this.run(`SELECT to_regprocedure('prima.ai_spend_reserve(text,text,text,numeric,numeric)') IS NOT NULL AND to_regprocedure('prima.ai_spend_settle(text,text,text,numeric,numeric)') IS NOT NULL AS ok`, [], (r) => r.ok === true);
    return this.installed;
  }

  spentUsd(kind: string, team: string, month: string): Promise<number> {
    return this.run('SELECT prima.ai_spend_get($1, $2, $3) AS v', [kind, team, month], (r) => Number(r.v ?? 0));
  }

  reserve(kind: string, team: string, month: string, worstUsd: number): Promise<boolean> {
    if (!(worstUsd >= 0)) return Promise.resolve(false);
    return this.run('SELECT prima.ai_spend_reserve($1, $2, $3, $4, $5) AS ok', [kind, team, month, worstUsd.toFixed(6), this.capUsd], (r) => r.ok === true);
  }

  async settle(kind: string, team: string, month: string, reservedUsd: number, actualUsd: number): Promise<void> {
    await this.run('SELECT prima.ai_spend_settle($1, $2, $3, $4, $5)', [kind, team, month, Math.max(0, reservedUsd).toFixed(6), Math.max(0, actualUsd).toFixed(6)], () => undefined);
  }
}
