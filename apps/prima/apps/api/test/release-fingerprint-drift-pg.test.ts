// Fauzan's audit of 4b708ae (14 Nov 2026), P1: release readiness must notice a weakened or extra database access policy.
// On a disposable local PostgreSQL: install the pay formulas module exactly, then (1) open its dept_wall policy to
// USING(true) WITH CHECK(true), (2) add an extra allow-all policy, (3) replace a trigger function's body. Each must make
// the module NOT ready. Synthetic, schema only; no rows are read.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { fingerprintProblems, moduleCatalogProblems } from '../src/release-catalog';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new globalThis.URL(URL).hostname)) throw Error('Disposable localhost database required');

describe('release fingerprints catch a weakened payroll wall (audit P1)', () => {
  let c: Client;
  before(async () => {
    await resetDb(URL);
    c = new Client({ connectionString: URL });
    await c.connect();
    await c.query(readFileSync(join(__dirname, '../../../../db/modules/pay-formulas-v1.sql'), 'utf8'));
  });
  after(async () => {
    await c.end();
  });

  it('the exact module is ready', async () => {
    assert.deepEqual(await fingerprintProblems(c, 'pay_formulas'), []);
    assert.deepEqual(await moduleCatalogProblems(c, 'pay_formulas'), []);
  });

  it('dept_wall opened to everyone is refused, and passes again once restored', async () => {
    await c.query('ALTER POLICY dept_wall ON prima.pay_formulas USING (true) WITH CHECK (true)');
    assert.deepEqual(await fingerprintProblems(c, 'pay_formulas'), ['Catalogue entry policy:pay_formulas.dept_wall is missing or changed.']);
    assert.deepEqual(await moduleCatalogProblems(c, 'pay_formulas'), ['RELEASE_PAY_FORMULAS_NOT_READY']);
    await c.query("ALTER POLICY dept_wall ON prima.pay_formulas USING (prima.has_wall('act')) WITH CHECK (prima.has_wall('act'))");
    assert.deepEqual(await fingerprintProblems(c, 'pay_formulas'), []);
  });

  it('a policy given to another role is refused', async () => {
    await c.query("ALTER POLICY dept_wall ON prima.pay_formulas TO prima_app");
    assert.deepEqual(await fingerprintProblems(c, 'pay_formulas'), ['Catalogue entry policy:pay_formulas.dept_wall is missing or changed.']);
    await c.query('ALTER POLICY dept_wall ON prima.pay_formulas TO public');
    assert.deepEqual(await fingerprintProblems(c, 'pay_formulas'), []);
  });

  it('an extra allow-all policy is refused', async () => {
    await c.query('CREATE POLICY audit_allow_all ON prima.pay_formulas USING (true) WITH CHECK (true)');
    assert.deepEqual(await fingerprintProblems(c, 'pay_formulas'), ['Catalogue entry policy:pay_formulas.audit_allow_all is not part of the release.']);
    assert.deepEqual(await moduleCatalogProblems(c, 'pay_formulas'), ['RELEASE_PAY_FORMULAS_NOT_READY']);
    await c.query('DROP POLICY audit_allow_all ON prima.pay_formulas');
    assert.deepEqual(await fingerprintProblems(c, 'pay_formulas'), []);
  });

  it('a changed function body or an extra trigger is refused', async () => {
    const fn = (await c.query(`SELECT p.oid::regprocedure::text AS sig, pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'prima' AND p.prokind = 'f' AND p.prorettype = 'trigger'::regtype ORDER BY 1`)).rows;
    const mine = fn.find((f) => /pay_formula|pay_law|site_hours|public_holiday/.test(f.sig));
    if (mine) {
      await c.query(`CREATE OR REPLACE FUNCTION ${mine.sig} RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`);
      assert.ok((await fingerprintProblems(c, 'pay_formulas')).some((p) => p.includes('function:')));
      await c.query(mine.def);
      assert.deepEqual(await fingerprintProblems(c, 'pay_formulas'), []);
    }
    await c.query('CREATE FUNCTION prima.audit_noop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$');
    await c.query('CREATE TRIGGER audit_noop BEFORE UPDATE ON prima.pay_formulas FOR EACH ROW EXECUTE FUNCTION prima.audit_noop()');
    assert.deepEqual(await fingerprintProblems(c, 'pay_formulas'), ['Catalogue entry trigger:pay_formulas.audit_noop is not part of the release.']);
    await c.query('DROP TRIGGER audit_noop ON prima.pay_formulas; DROP FUNCTION prima.audit_noop()');
    assert.deepEqual(await fingerprintProblems(c, 'pay_formulas'), []);
  });
});
