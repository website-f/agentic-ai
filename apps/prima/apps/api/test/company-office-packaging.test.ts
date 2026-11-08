/**
 * Packaging proposal for the company office module (Arisha main review and combined rehearsal, 2 Nov 2026): pinned
 * bytes, base, install order, catalogue check, repeat-safety and drift, on a disposable localhost PostgreSQL only.
 * Nothing here touches db/release-manifest.json or any shared database. Synthetic rows only.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { migrationSql } from '../src/schema';
import { companyOfficeProblems } from '../src/company-office-readiness';

const ROOT = resolve(process.cwd(), process.cwd().endsWith('/apps/api') ? '../..' : '.');
const read = (p: string) => readFileSync(resolve(ROOT, p));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const proposal = JSON.parse(read('db/proposed/company-office-module.json').toString()) as {
  base: { path: string; sha256: string };
  after: string[];
  modules: { id: string; path: string; sha256: string; requires: string[]; repeatSafe: boolean }[];
};
const manifest = JSON.parse(read('db/release-manifest.json').toString()) as { base: { sha256: string }; modules: { id: string }[] };

describe('company office packaging proposal (files)', () => {
  it('pins the module bytes on the same base as the release manifest', () => {
    assert.equal(proposal.base.sha256, manifest.base.sha256);
    assert.equal(sha(read(proposal.base.path)), proposal.base.sha256);
    for (const m of proposal.modules) assert.equal(sha(read(m.path)), m.sha256, `${m.id} bytes differ from the proposal`);
  });
  it('installs after every manifest module and stays out of the manifest until approved', () => {
    // Agentic Office: the office release activates this module (its database already has it). It must sit in the
    // manifest after everything upstream installs first, with the proposal's exact bytes. Upstream keeps it a proposal.
    const order = manifest.modules.map((m) => m.id);
    for (const m of proposal.modules) {
      const at = order.indexOf(m.id);
      const pinned = (manifest.modules as Array<{ id: string; path?: string; sha256?: string }>)[at];
      if (at < 0) continue; // still a proposal here: nothing to check beyond the after list
      assert.deepEqual({ path: pinned.path, sha256: pinned.sha256 }, { path: m.path, sha256: m.sha256 });
    }
    for (const id of proposal.after ?? []) assert.ok(order.includes(id), `${id} is installed before this proposal`);
    for (const m of proposal.modules) { const at = order.indexOf(m.id); if (at >= 0) for (const id of proposal.after ?? []) assert.ok(order.indexOf(id) < at, `${id} before ${m.id}`); }
  });
  it('has no destructive or grant-widening statement; it drops only its own policy', () => {
    for (const m of proposal.modules) {
      const sql = read(m.path).toString().replace(/--.*$/gm, '');
      assert.doesNotMatch(
        sql,
        /\b(DROP\s+TABLE|DROP\s+FUNCTION|TRUNCATE|DELETE\s+FROM|GRANT\s+ALL|GRANT\s+DELETE|ALTER\s+ROLE|CREATE\s+ROLE|DISABLE\s+ROW)\b/i,
      );
      // Each module drops only its own policies.
      const own =
        m.id === 'company_office'
          ? /company_wall ON prima\.company_desks$/i
          : /run_links_(read|setter_insert|setter_update|ceo_insert|ceo_update) ON prima\.company_run_links$/i;
      for (const d of sql.match(/DROP\s+POLICY\s+IF\s+EXISTS\s+\w+\s+ON\s+[\w.]+/gi) ?? []) assert.match(d, own, d);
    }
  });
});

const BASE = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(BASE).hostname)) throw Error('Requires disposable localhost PostgreSQL');
const DB = 'prima_company_office_pack_test';
const OWNER = 'prima_company_office_pack_owner';
const url = new URL(BASE);
url.pathname = '/' + DB;
url.username = OWNER;
url.password = 'local-test-only';
async function owner<T>(fn: (c: Client) => Promise<T>) {
  const c = new Client({ connectionString: url.toString() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
async function su<T>(fn: (c: Client) => Promise<T>) {
  const u = new URL(BASE);
  u.pathname = '/' + DB;
  const c = new Client({ connectionString: u.toString() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
const install = () => owner((c) => c.query(read('db/modules/company-office-v1.sql').toString()));

describe('company office packaging proposal (throwaway database)', () => {
  before(async () => {
    const c = new Client({ connectionString: BASE });
    await c.connect();
    try {
      await c.query(`DROP DATABASE IF EXISTS ${DB} WITH(FORCE)`);
      if (!(await c.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [OWNER])).rowCount)
        await c.query(`CREATE ROLE ${OWNER} LOGIN CREATEDB CREATEROLE PASSWORD 'local-test-only'`);
      if ((await c.query("SELECT 1 FROM pg_roles WHERE rolname='prima_app'")).rowCount) await c.query(`GRANT prima_app TO ${OWNER} WITH ADMIN OPTION`);
      await c.query(`CREATE DATABASE ${DB} OWNER ${OWNER}`);
    } finally {
      await c.end();
    }
    await owner(async (a) => {
      assert.equal((await a.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0].rolsuper, false);
      await a.query(migrationSql());
    });
  });
  after(async () => {
    const c = new Client({ connectionString: BASE });
    await c.connect();
    try {
      await c.query(`DROP DATABASE IF EXISTS ${DB} WITH(FORCE)`);
    } finally {
      await c.end();
    }
  });

  it('reports the module missing on the base, installs as a non-superuser owner, and a second run keeps rows', async () => {
    const before = await owner(companyOfficeProblems);
    assert.deepEqual(before, ['Table prima.company_desks is missing (run db/modules/company-office-v1.sql).']);
    await install();
    assert.deepEqual(await owner(companyOfficeProblems), []);
    await su((c) =>
      c.query(
        `INSERT INTO prima.company_desks(id, company_id, data) VALUES ('desk-co-syn-people', 'co-syn', '{"id":"desk-co-syn-people","companyId":"co-syn","desk":"people"}')`,
      ),
    );
    await install();
    assert.deepEqual(await owner(companyOfficeProblems), []);
    assert.equal((await su((c) => c.query(`SELECT 1 FROM prima.company_desks WHERE id = 'desk-co-syn-people'`))).rowCount, 1);
  });

  it('a second run repairs a widened grant and a replaced policy', async () => {
    await owner((c) => c.query('GRANT DELETE ON prima.company_desks TO prima_app'));
    await owner((c) => c.query('DROP POLICY company_wall ON prima.company_desks'));
    assert.ok((await owner(companyOfficeProblems)).length >= 2);
    await install();
    assert.deepEqual(await owner(companyOfficeProblems), []);
  });

  it('notices drift against the attested definitions, never a substring match (Arisha main review, 3 Nov 2026)', async () => {
    const drift = [
      // The wall
      ['DROP POLICY company_wall ON prima.company_desks', /company_wall is missing/],
      ['ALTER POLICY company_wall ON prima.company_desks USING (true) WITH CHECK (true)', /no longer matches the reviewed company wall/],
      [
        'ALTER POLICY company_wall ON prima.company_desks USING (company_id = ANY (prima.visible_companies()) OR true) WITH CHECK (company_id = ANY (prima.visible_companies()))',
        /no longer matches the reviewed company wall/,
      ],
      [
        'ALTER POLICY company_wall ON prima.company_desks USING (company_id = ANY (prima.visible_companies())) WITH CHECK (company_id = ANY (prima.visible_companies()) OR true)',
        /no longer matches the reviewed company wall/,
      ],
      ['ALTER POLICY company_wall ON prima.company_desks TO prima_app', /different mode, command or roles/],
      ['CREATE POLICY desks_extra ON prima.company_desks FOR SELECT USING (true)', /Unexpected policy company_desks\.desks_extra/],
      [
        'DROP POLICY company_wall ON prima.company_desks; CREATE POLICY company_wall ON prima.company_desks AS RESTRICTIVE USING (company_id = ANY (prima.visible_companies())) WITH CHECK (company_id = ANY (prima.visible_companies()))',
        /different mode, command or roles/,
      ],
      // The function the wall is bound to
      [
        'CREATE OR REPLACE FUNCTION prima.visible_companies() RETURNS text[] LANGUAGE sql STABLE AS $$ SELECT ARRAY(SELECT company_id FROM prima.company_desks) $$',
        /visible_companies\(\) differs from the reviewed definition/,
      ],
      [
        "CREATE FUNCTION public.visible_companies() RETURNS text[] LANGUAGE sql STABLE AS $$ SELECT ARRAY['co-all'] $$; DROP POLICY company_wall ON prima.company_desks; CREATE POLICY company_wall ON prima.company_desks USING (company_id = ANY (public.visible_companies())) WITH CHECK (company_id = ANY (public.visible_companies()))",
        /not bound to prima\.visible_companies/,
      ],
      // Constraints, same name but another expression
      ['ALTER TABLE prima.company_desks DROP CONSTRAINT company_desks_desk_known', /company_desks_desk_known is missing/],
      [
        "ALTER TABLE prima.company_desks DROP CONSTRAINT company_desks_desk_known, ADD CONSTRAINT company_desks_desk_known CHECK (data->>'desk' IS NOT NULL)",
        /company_desks_desk_known on prima\.company_desks differs/,
      ],
      [
        "ALTER TABLE prima.company_desks DROP CONSTRAINT company_desks_id_format, ADD CONSTRAINT company_desks_id_format CHECK (id = 'desk-' || company_id || '-' || (data->>'desk') OR true)",
        /company_desks_id_format on prima\.company_desks differs/,
      ],
      ['ALTER TABLE prima.company_desks ADD CONSTRAINT extra_check CHECK (true)', /Unexpected constraint extra_check/],
      // Table shape, RLS, grants, triggers, indexes
      ['ALTER TABLE prima.company_desks ALTER COLUMN company_id DROP NOT NULL', /Columns of prima\.company_desks differ/],
      ['ALTER TABLE prima.company_desks ADD COLUMN extra text', /Columns of prima\.company_desks differ/],
      ['ALTER TABLE prima.company_desks NO FORCE ROW LEVEL SECURITY', /not forced/],
      ['GRANT DELETE ON prima.company_desks TO prima_app', /prima_app may delete rows/],
      ['REVOKE UPDATE ON prima.company_desks FROM prima_app', /prima_app privileges on prima\.company_desks differ/],
      ['GRANT SELECT ON prima.company_desks TO PUBLIC', /PUBLIC holds privileges/],
      ['GRANT UPDATE (data) ON prima.company_desks TO PUBLIC', /Column-level privileges/],
      ['DROP INDEX prima.company_desks_company_idx', /company_desks_company_idx is missing/],
      ['CREATE INDEX extra_idx ON prima.company_desks (data)', /Unexpected index extra_idx/],
      [
        'CREATE FUNCTION prima.desks_noop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$; CREATE TRIGGER desks_noop BEFORE INSERT ON prima.company_desks FOR EACH ROW EXECUTE FUNCTION prima.desks_noop()',
        /Unexpected trigger desks_noop/,
      ],
    ] as const;
    for (const [sql, want] of drift) {
      await owner(async (c) => {
        await c.query('BEGIN');
        try {
          await c.query(sql);
          const p = await companyOfficeProblems(c);
          assert.ok(
            p.some((x) => want.test(x)),
            `${sql} -> ${JSON.stringify(p)}`,
          );
        } finally {
          await c.query('ROLLBACK');
        }
      });
    }
    assert.deepEqual(await owner(companyOfficeProblems), []);
  });

  it('reads the same result whatever the search_path', async () => {
    await owner(async (c) => {
      await c.query('BEGIN');
      try {
        await c.query('SET LOCAL search_path = prima, public');
        assert.deepEqual(await companyOfficeProblems(c), []);
      } finally {
        await c.query('ROLLBACK');
      }
    });
  });
});
