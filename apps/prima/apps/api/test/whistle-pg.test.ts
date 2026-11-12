// Speak-up (whistleblowing) controls against a real local PostgreSQL (Fauzan, 11 Nov 2026, before the feature goes
// live): (1) replies and handler messages sent at the same moment are all kept, none overwritten; (2) the RBA committee
// row on PWVSB's record is not readable in full by any account with database read access: other offices get names and
// seats only, through the roster table of module rba-committee-roster-v1 (the office's fix on top of rba-readiness-v1,
// run by prima-setup on every start). Synthetic data only; the test resets the throwaway database.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import type { User } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const modulePath = (name: string) => resolve(__dirname, `../../../../db/modules/${name}.sql`);

describe('Speak-up and RBA committee controls on PostgreSQL', () => {
  let db: Db;
  let owner: Client;
  before(async () => {
    await resetDb(URL);
    db = new Db();
    owner = new Client({ connectionString: URL });
    await owner.connect();
    for (const m of ['client-codes-v1', 'rba-readiness-v1', 'rba-committee-roster-v1']) {
      const sql = readFileSync(modulePath(m), 'utf8');
      await owner.query(sql);
      await owner.query(sql); // repeat-safe
    }
  });
  after(async () => {
    await owner.end();
    await db.onModuleDestroy();
  });

  const messagesOf = async (id: string) =>
    ((await owner.query('SELECT data FROM prima.whistle_reports WHERE id = $1', [id])).rows[0].data as { messages?: { from: string; text: string }[]; notes: { text: string }[]; status: string }) ;

  it('replies sent at the same moment are all kept (reporter and handler)', async () => {
    const { code } = await db.asUser('u-it-ex3', (svc, u) =>
      svc.submitWhistle(u, { anonymous: true, companyId: null, category: 'MISCONDUCT', summary: 'A synthetic report: cash asked for better shifts at a site.', implicatedUserIds: [] }),
    );
    const id = (await owner.query("SELECT id FROM prima.whistle_reports WHERE data->>'code' = $1", [code])).rows[0].id as string;
    await db.asUser('u-audit', (svc, u) => svc.whistleMessage(u, id, 'Which site, and roughly when? (synthetic)'));

    // Six reporter replies and two handler messages, all at once, each in its own database transaction.
    const replies = Array.from({ length: 6 }, (_, i) => `Synthetic reporter reply number ${i + 1}.`);
    const handler = ['Synthetic handler update A.', 'Synthetic handler update B.'];
    await Promise.all([
      ...replies.map((t) => db.asUser('u-it-ex3', (svc, u) => svc.whistleReply(u, code, t, false))),
      ...handler.map((t) => db.asUser('u-audit', (svc, u) => svc.whistleMessage(u, id, t))),
    ]);
    const r = await messagesOf(id);
    const texts = (r.messages ?? []).map((m) => m.text);
    for (const t of [...replies, ...handler]) assert.ok(texts.includes(t), `lost: ${t}`);
    assert.equal(texts.length, 1 + replies.length + handler.length);

    // A handler's note and a reporter's retaliation report at the same moment: both survive.
    await Promise.all([
      db.asUser('u-audit', (svc, u) => svc.whistleStep(u, id, 'note', 'Synthetic handler note while the reporter writes.')),
      db.asUser('u-it-ex3', (svc, u) => svc.whistleReply(u, code, 'Synthetic: my shifts were cut after I reported.', true)),
    ]);
    const r2 = await messagesOf(id);
    assert.ok(r2.notes.some((n) => n.text === 'Synthetic handler note while the reporter writes.'));
    assert.ok((r2.messages ?? []).some((m) => m.text === 'Synthetic: my shifts were cut after I reported.'));
  });

  it('the module removes the open read rule and walls the RBA tables for the API role only', async () => {
    const p = await owner.query(`SELECT tablename, policyname, roles::text AS roles FROM pg_policies WHERE schemaname = 'prima'
      AND tablename IN ('rba_committees', 'rba_trace_reviews', 'ethics_declarations', 'rba_committee_rosters') ORDER BY 1, 2`);
    assert.ok(!p.rows.some((r) => r.policyname === 'committee_read'), 'committee_read is gone');
    for (const t of ['rba_committees', 'rba_trace_reviews', 'ethics_declarations'])
      assert.deepEqual(p.rows.filter((r) => r.tablename === t).map((r) => [r.policyname, r.roles]), [['company_wall', '{prima_app}']]);
    const f = await owner.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'prima.rba_committee_rosters'::regclass`);
    assert.deepEqual(f.rows[0], { relrowsecurity: true, relforcerowsecurity: true });
  });

  it('a read-only account cannot read the committee row; offices see names and seats only', async () => {
    const c = await db.asUser('u-cos', (svc, u) => svc.nameRbaCommittee(u, { memberUserIds: ['u-opsdir', 'u-cm-sasa'], others: [{ name: 'Synthetic Outside Member' }], note: 'Synthetic private note from the CoS' }));
    // A plain read-only database account (SELECT granted on both tables, no session set up) reads nothing at all.
    await owner.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prima_test_reader') THEN CREATE ROLE prima_test_reader NOLOGIN; END IF; END $$`);
    await owner.query('GRANT USAGE ON SCHEMA prima TO prima_test_reader');
    await owner.query('GRANT SELECT ON prima.rba_committees, prima.rba_committee_rosters TO prima_test_reader');
    assert.equal((await owner.query('SELECT 1 FROM prima.rba_committee_rosters')).rowCount, 1, 'the roster row exists');
    await owner.query('BEGIN');
    try {
      await owner.query('SET LOCAL ROLE prima_test_reader');
      // Even with a forged office session the reader role has no policy on either table.
      await owner.query(`SELECT set_config('app.user_id', 'u-cos', true), set_config('app.user_role', 'pwvsb_officer', true), set_config('app.company_ids', 'pwvsb', true)`);
      assert.equal((await owner.query('SELECT * FROM prima.rba_committees')).rowCount, 0);
      assert.equal((await owner.query('SELECT * FROM prima.rba_committee_rosters')).rowCount, 0);
    } finally {
      await owner.query('ROLLBACK');
    }
    // The application role with no company open and no office sign-in (a guard, a site device, an empty session) sees
    // neither the naming nor the roster.
    for (const role of ['', 'guard', 'site_device']) {
      await owner.query('BEGIN');
      try {
        await owner.query('SET LOCAL ROLE prima_app');
        await owner.query(`SELECT set_config('app.company_ids', '', true), set_config('app.user_id', $1, true), set_config('app.user_role', $2, true)`, [role ? 'u-synthetic' : '', role]);
        assert.equal((await owner.query('SELECT * FROM prima.rba_committees')).rowCount, 0);
        assert.equal((await owner.query('SELECT * FROM prima.rba_committee_rosters')).rowCount, 0, `roster hidden from role '${role}'`);
      } finally {
        await owner.query('ROLLBACK');
      }
    }
    // The roster cannot carry anything beyond names and seats, whatever writes it.
    await assert.rejects(
      owner.query(`UPDATE prima.rba_committee_rosters SET data = jsonb_set(data, '{note}', '"leak"')`),
      /rba_roster_fields/,
    );
    await assert.rejects(
      owner.query(`UPDATE prima.rba_committee_rosters SET data = jsonb_set(data, '{members,0,userId}', '"u-opsdir"')`),
      /rba_roster_members/,
    );
    // A company head (another company's office, no PWVSB wall) reads the roster: names and seats, nothing else.
    const raw = await db.asUser('u-cm-sasa', async (_svc, _u, store) => store.list('rbaCommittees'));
    assert.equal(raw.length, 0, 'the full committee row stays behind the PWVSB wall');
    const b = await db.asUser('u-cm-sasa', (svc, u) => svc.rbaBoard(u));
    const cur = b.committee.current as Record<string, unknown> | null;
    assert.ok(cur);
    assert.equal(cur.id, c.id);
    assert.deepEqual(
      (cur.members as unknown[]).map((m) => Object.keys(m as object).sort()),
      [['name', 'seat'], ['name', 'seat'], ['name', 'seat']],
    );
    for (const k of ['note', 'namedById', 'replacedById', 'companyId']) assert.ok(!(k in cur), `${k} must not reach a company head`);
    const roster = await db.asUser('u-cm-sasa', async (_svc, _u, store) => store.list('rbaCommitteeRosters'));
    assert.equal(roster.length, 1);
    assert.ok(!JSON.stringify(roster).includes('Synthetic private note') && !JSON.stringify(roster).includes('u-opsdir'));
    // A guard's session reads no roster.
    const guard = (await owner.query("SELECT id FROM prima.users WHERE data->>'role' = 'guard' LIMIT 1")).rows[0]?.id as string | undefined;
    if (guard) assert.equal((await db.asUser(guard, async (_svc, _u, store) => store.list('rbaCommitteeRosters'))).length, 0);
    assert.ok(!JSON.stringify(cur).includes('Synthetic private note'));
    // A second naming in the same year rewrites the one roster row (names and seats of the new naming only).
    const c2 = await db.asUser('u-cos', (svc, u) => svc.nameRbaCommittee(u, { memberUserIds: ['u-opsdir', 'u-cm-sasa'], note: 'Synthetic second note' }));
    const b2 = await db.asUser('u-cm-sasa', (svc, u) => svc.rbaBoard(u));
    assert.equal((b2.committee.current as { id: string }).id, c2.id);
    assert.equal((b2.committee.current as { members: unknown[] }).members.length, 2);
    assert.equal((await owner.query('SELECT 1 FROM prima.rba_committee_rosters')).rowCount, 1);
    // The Chief of Staff, who names the committee, still sees the full row.
    const cos = await db.asUser('u-cos', (svc, u) => svc.rbaBoard(u));
    assert.equal((cos.committee.current as { note?: string }).note, 'Synthetic second note');
  });
});
