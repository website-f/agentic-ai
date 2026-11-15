/**
 * Packaging proposal for the client requirements and yearly self-audit module (Fauzan said yes on 8 Nov 2026 to
 * installing it with the combined merge): pinned bytes, base, install order and statement checks. Files only; nothing
 * here touches db/release-manifest.json or any database.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = resolve(process.cwd(), process.cwd().endsWith('/apps/api') ? '../..' : '.');
const read = (p: string) => readFileSync(resolve(ROOT, p));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const proposal = JSON.parse(read('db/proposed/client-codes-module.json').toString()) as {
  base: { path: string; sha256: string };
  after: string[];
  modules: { id: string; path: string; sha256: string; requires: string[]; repeatSafe: boolean }[];
};
const manifest = JSON.parse(read('db/release-manifest.json').toString()) as { base: { sha256: string }; modules: { id: string }[] };

describe('client codes packaging proposal (files)', () => {
  it('pins the module bytes on the same base as the release manifest', () => {
    assert.equal(proposal.base.sha256, manifest.base.sha256);
    assert.equal(sha(read(proposal.base.path)), proposal.base.sha256);
    for (const m of proposal.modules) assert.equal(sha(read(m.path)), m.sha256, `${m.id} bytes differ from the proposal`);
  });
  it('is on the release list (A3, Fauzan 11 Nov 2026) with the proposal\'s bytes, dependencies and order', () => {
    const order = manifest.modules.map((m) => m.id);
    for (const m of proposal.modules) {
      const entry = (manifest.modules as unknown as { id: string; path: string; sha256: string; requires: string[] }[]).find((x) => x.id === m.id);
      assert.ok(entry, `${m.id} is on the release list`);
      assert.equal(entry.path, m.path);
      assert.equal(entry.sha256, m.sha256);
      assert.deepEqual(entry.requires, m.requires);
      for (const a of (proposal as { after?: string[] }).after ?? []) assert.ok(order.indexOf(a) < order.indexOf(m.id), `${m.id} installs after ${a}`);
    }
  });
  it('has no destructive or grant-widening statement; it drops only its own company wall policy', () => {
    for (const m of proposal.modules) {
      const sql = read(m.path).toString().replace(/--.*$/gm, '');
      assert.doesNotMatch(sql, /\b(DROP\s+TABLE|DROP\s+FUNCTION|TRUNCATE|DELETE\s+FROM|GRANT\s+ALL|GRANT\s+DELETE|ALTER\s+ROLE|CREATE\s+ROLE|DISABLE\s+ROW|SECURITY\s+DEFINER)\b/i);
      for (const d of sql.match(/DROP\s+POLICY\s+IF\s+EXISTS\s+\w+\s+ON\s+[\w.%$]+/gi) ?? []) assert.match(d, /company_wall ON prima\.%1\$I$/i, d);
      assert.match(sql, /FORCE ROW LEVEL SECURITY/);
      for (const t of ['client_codes', 'client_code_checks', 'client_inspections', 'self_audits']) assert.ok(sql.includes(`'${t}'`), t);
    }
  });
});
