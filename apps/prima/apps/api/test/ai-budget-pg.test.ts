// The helpers' AI budget on PostgreSQL (module ai-budget-v1). Fauzan's retest, 23 Nov 2026: "Paid AI - activation
// blocker: spending limits reset after a server restart. Keep it off until budget tracking is durable." Synthetic only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client, Pool } from 'pg';
import { PgAiBudget } from '../src/ai-budget';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
const MODULE = resolve(__dirname, '../../../../db/modules/ai-budget-v1.sql');
const KIND = 'key-in';
const MONTH = '2026-11';

async function admin(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

describe('AI budget kept in the database', () => {
  let pool: Pool;
  before(async () => {
    pool = new Pool({ connectionString: URL, max: 8 });
    await admin('DROP TABLE IF EXISTS prima.ai_spend CASCADE');
    await admin('DROP FUNCTION IF EXISTS prima.ai_spend_reserve(text,text,text,numeric,numeric), prima.ai_spend_settle(text,text,text,numeric,numeric), prima.ai_spend_get(text,text,text)');
  });
  after(async () => {
    await pool.end();
  });

  it('is not ready before the module is installed', async () => {
    assert.equal(await new PgAiBudget(pool, 25).ready(), false);
    await assert.rejects(new PgAiBudget(pool, 25).reserve(KIND, 'dept:finance', MONTH, 0.01));
  });

  it('keeps the spend after a restart (a new server), within the cap', async () => {
    await admin(readFileSync(MODULE, 'utf8'));
    await admin(readFileSync(MODULE, 'utf8')); // repeat-safe
    const first = new PgAiBudget(pool, 25);
    assert.equal(await first.ready(), true);
    assert.equal(await first.reserve(KIND, 'dept:finance', MONTH, 20), true);
    await first.settle(KIND, 'dept:finance', MONTH, 20, 24.5);
    // The server restarts: a fresh object, same database.
    const restarted = new PgAiBudget(pool, 25);
    assert.equal(await restarted.spentUsd(KIND, 'dept:finance', MONTH), 24.5);
    assert.equal(await restarted.reserve(KIND, 'dept:finance', MONTH, 1), false, 'the cap still holds after the restart');
    assert.equal(await restarted.reserve(KIND, 'dept:finance', MONTH, 0.5), true);
    // Another team and next month start at zero.
    assert.equal(await restarted.spentUsd(KIND, 'dept:hr', MONTH), 0);
    assert.equal(await restarted.reserve(KIND, 'dept:finance', '2026-12', 1), true);
  });

  it('two servers reserving at once cannot both slip under the cap', async () => {
    const a = new PgAiBudget(pool, 25);
    const b = new PgAiBudget(pool, 25);
    const team = 'company:co-sasa';
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).reserve(KIND, team, MONTH, 5)));
    assert.equal(results.filter(Boolean).length, 5);
    assert.equal(await a.spentUsd(KIND, team, MONTH), 25);
  });

  it('the application role cannot change or delete the spend directly, and bad amounts are refused', async () => {
    const c = await pool.connect();
    try {
      for (const sql of ["UPDATE prima.ai_spend SET spent_usd = 0", 'DELETE FROM prima.ai_spend', "INSERT INTO prima.ai_spend (kind, team, month) VALUES ('key-in', 'dept:x', '2026-11')", 'SELECT * FROM prima.ai_spend']) {
        await c.query('BEGIN');
        await c.query('SET LOCAL ROLE prima_app');
        await assert.rejects(c.query(sql), /permission denied/);
        await c.query('ROLLBACK');
      }
    } finally {
      c.release();
    }
    const budget = new PgAiBudget(pool, 25);
    assert.equal(await budget.reserve(KIND, 'dept:finance', MONTH, -1), false);
    await assert.rejects(budget.settle(KIND, 'dept:finance', MONTH, 500, 0), /out of range/);
    await assert.rejects(budget.reserve('BAD KIND', 'dept:finance', MONTH, 0.01), /check constraint/);
  });
});
