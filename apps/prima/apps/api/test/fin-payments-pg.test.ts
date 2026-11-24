// Finance payments in their own table on PostgreSQL (Finance study gap B3, Fauzan 23 Nov 2026). Before module
// fin-payments-v1 payments stay inside the Finance status row as today; after it each payment is one row under the
// company wall, the old ones are moved once, and the Finance screens and steps work unchanged. Synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { GROUP_EMPLOYER_ID, myt } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const NOW = myt('2026-11-23', '10:00');
const T1 = GROUP_EMPLOYER_ID;
const MODULE = resolve(__dirname, '../../../../db/modules/fin-payments-v1.sql');

async function admin(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

describe('Finance payments in their own table (PostgreSQL)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('moves every payment out once, keeps the order, and the steps work through the table', async () => {
    const before = (await admin(`SELECT company_id, data->'payments' AS p FROM prima.fin_status WHERE jsonb_array_length(coalesce(data->'payments','[]'::jsonb)) > 0`)).rows as { company_id: string; p: { id: string }[] }[];
    assert.ok(before.length > 0, 'the sample has payments to move');
    const total = before.reduce((n, r) => n + r.p.length, 0);
    const deskIds = async () => (await db.asUser('u-fd', (svc, u) => svc.finance.desk(u), () => NOW)).companies.find((c) => c.companyId === T1)!.payments.map((p) => p.id);
    const shown = await deskIds();
    await admin(readFileSync(MODULE, 'utf8'));
    await admin(readFileSync(MODULE, 'utf8')); // repeat-safe
    assert.equal((await admin('SELECT count(*)::int AS n FROM prima.fin_payments')).rows[0].n, total);
    assert.equal((await admin(`SELECT count(*)::int AS n FROM prima.fin_status WHERE jsonb_array_length(coalesce(data->'payments','[]'::jsonb)) > 0`)).rows[0].n, 0);
    const t1 = before.find((r) => r.company_id === T1)!;
    const rows = (await admin(`SELECT data FROM prima.fin_payments WHERE company_id = $1 ORDER BY (data->>'seq')::int`, [T1])).rows as { data: { payment: { id: string } } }[];
    assert.deepEqual(rows.map((r) => r.data.payment.id), t1.p.map((p) => p.id));
    // The desk shows the same payments after the move.
    assert.deepEqual(await deskIds(), shown);
    // A new payment and its review write only rows of the table.
    const p = await db.asUser('u-fin-t1-de1', async (svc, u) => {
      const f = (await svc.finance.desk(u)).companies.find((c) => c.companyId === T1)!;
      return svc.finance.createPayment(u, T1, { payeeId: 'payee-pwvsb-001', purpose: 'UAT stationery', amount: 99.5, dueOn: '2026-12-01', bankId: f.banks[0].id, sqlRef: 'PI-B3-PG', evidence: ['inv.pdf'] });
    }, () => NOW);
    await db.asUser('u-fin-t1-dep', (svc, u) => svc.finance.paymentStep(u, T1, p.id, 'review', { comment: 'Matches the quotation.' }), () => NOW);
    const row = (await admin(`SELECT data FROM prima.fin_payments WHERE id = $1`, [`${T1}:${p.id}`])).rows[0];
    assert.equal(row.data.payment.status, 'reviewed');
    assert.equal((await admin(`SELECT jsonb_array_length(coalesce(data->'payments','[]'::jsonb)) AS n FROM prima.fin_status WHERE company_id = $1`, [T1])).rows[0].n, 0);
  });

  it('keeps the company wall, and refuses deletes and a payment under another company', async () => {
    // Under the company wall a system sign-in with no grant for a company sees none of its payment rows.
    const co = (await admin(`SELECT company_id FROM prima.fin_payments WHERE company_id <> $1 LIMIT 1`, [T1])).rows[0].company_id as string;
    const outsider = await db.asUser('u-tender-watcher', (_svc, _u, store) => store.list('finPayments', { companyId: [co] }), () => NOW);
    assert.equal(outsider.length, 0);
    const priv = (await admin(`SELECT has_table_privilege('prima_app', 'prima.fin_payments', 'DELETE') AS d`)).rows[0];
    assert.equal(priv.d, false);
    await assert.rejects(
      admin(`INSERT INTO prima.fin_payments (id, company_id, data) VALUES ('co-x:pay-1', 'co-x', '{"id":"co-x:pay-1","companyId":"co-x","seq":0,"payment":{"id":"pay-2","amount":5}}')`),
      /fin_payments_id_is_company_payment/,
    );
  });
});
