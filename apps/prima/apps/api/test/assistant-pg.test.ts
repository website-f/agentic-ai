// The Prima helper's skill library and personal style on PostgreSQL (Fauzan, 23 Nov 2026). Before module assistant-v1
// the helper still fills forms but says the library is not installed; after it, a style and a person's own skills are
// theirs alone, a team skill is read by that team only, a saved skill is only retired, and nothing is deleted, even with
// the application bypassed. Synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { myt, type PrimaService, type User } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const NOW = myt('2026-11-23', '10:00');
const MODULE = resolve(__dirname, '../../../../db/modules/assistant-v1.sql');

async function admin(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

describe('Prima helper memory (PostgreSQL)', () => {
  let db: Db;
  const as = <R>(id: string, fn: (svc: PrimaService, u: User) => Promise<R>) => db.asUser(id, fn, () => NOW);
  const rows = (id: string) => as(id, async (svc) => ((await (svc as any).store.list('assistantMemory', {})) as { id: string }[]).map((r) => r.id).sort());

  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('fills forms before the module, and says the library is not installed', async () => {
    const h = await as('u-proc-manager', (svc, u) => svc.assistant.home(u));
    assert.equal(h.installed, false);
    assert.ok(h.actions.some((a) => a.id === 'site-supplies'));
    const r = await as('u-proc-manager', (svc, u) => svc.assistant.understand(u, { text: 'Laptop saya rosak, segera' }));
    assert.equal(r.draft.actionId, 'it-help');
    await assert.rejects(as('u-proc-manager', (svc, u) => svc.assistant.saveSkill(u, { name: 'x skill', actionId: 'leave' })), /assistant-v1/);
  });

  let team = '';
  let mine = '';
  it('keeps a team skill for the team and a style for its owner only', async () => {
    await admin(readFileSync(MODULE, 'utf8'));
    await admin(readFileSync(MODULE, 'utf8')); // repeat-safe
    team = (await as('u-proc-manager', (svc, u) => svc.assistant.saveSkill(u, { scope: 'team', owner: 'dept:procurement', name: 'New site start-up', words: ['tapak baharu'], actionId: 'site-supplies', values: { forNewSite: true } }))).id;
    mine = (await as('u-proc-store1', (svc, u) => svc.assistant.saveSkill(u, { name: 'My leave', words: ['cuti saya'], actionId: 'leave', values: { kind: 'ANNUAL' } }))).id;
    await as('u-proc-store1', (svc, u) => svc.assistant.setStyle(u, { signOff: 'Terima kasih' }));
    assert.deepEqual(await rows('u-proc-store1'), [mine, team, 'style-u-proc-store1'].sort());
    // The team head reads the team skill, not the storekeeper's own skill or style.
    assert.deepEqual(await rows('u-proc-manager'), [team]);
    // Another department reads none of it.
    assert.deepEqual(await rows('u-transport'), []);
    const s = await as('u-proc-store1', (svc, u) => svc.assistant.style(u));
    assert.equal(s.signOff, 'Terima kasih');
  });

  it('refuses a forged row, a changed skill, a moved owner and a delete', async () => {
    const row = (await admin('SELECT data FROM prima.assistant_memory WHERE id = $1', [team])).rows[0].data;
    // Another department publishing into procurement's library.
    await assert.rejects(as('u-transport', (svc) => (svc as any).store.insert('assistantMemory', { ...row, id: 'skl-forged-1', byId: 'u-transport' })), /row-level security/);
    // A style written for someone else.
    await assert.rejects(as('u-transport', (svc) => (svc as any).store.insert('assistantMemory', { id: 'style-u-proc-store1', kind: 'style', owner: 'u-proc-store1', lang: null, signOff: 'x', tone: 'short', usual: {}, words: [], updatedAt: NOW })));
    // An own skill saved in another person's name.
    await assert.rejects(as('u-proc-store1', (svc) => (svc as any).store.insert('assistantMemory', { ...row, id: 'skl-forged-2', scope: 'me', owner: 'u-proc-store1', byId: 'u-proc-manager' })), /row-level security|check constraint/);
    await assert.rejects(as('u-proc-manager', (svc) => (svc as any).store.update('assistantMemory', team, { values: { forNewSite: false } })), /only retired/);
    await assert.rejects(as('u-proc-manager', (svc) => (svc as any).store.update('assistantMemory', team, { owner: 'dept:it' })), /never changes/);
    // Someone else's style is not even found.
    await assert.rejects(as('u-proc-manager', (svc) => (svc as any).store.update('assistantMemory', 'style-u-proc-store1', { signOff: 'Changed' })));
    const del = new Client({ connectionString: URL });
    await del.connect();
    try {
      await del.query('BEGIN');
      await del.query('SET LOCAL ROLE prima_app');
      await assert.rejects(del.query('DELETE FROM prima.assistant_memory'), /permission denied/);
      await del.query('ROLLBACK');
    } finally {
      await del.end();
    }
  });

  it('retires a team skill with a reason; it stays, and no longer helps', async () => {
    await assert.rejects(as('u-proc-store1', (svc, u) => svc.assistant.retireSkill(u, { id: team, reason: 'Not mine to retire' })), /head or manager/);
    await as('u-proc-manager', (svc, u) => svc.assistant.retireSkill(u, { id: team, reason: 'Replaced by a new checklist' }));
    await assert.rejects(as('u-proc-manager', (svc) => (svc as any).store.update('assistantMemory', team, { retired: null })), /retired skill is not changed/);
    const skills = await as('u-proc-store1', (svc, u) => svc.assistant.skills(u));
    assert.deepEqual(skills.map((s) => s.id), [mine]);
    assert.equal((await admin('SELECT count(*)::int AS n FROM prima.assistant_memory')).rows[0].n, 3);
  });

  it('sends an IT help request as the person, and learns their usual choices', async () => {
    const r = await as('u-proc-store1', (svc, u) => svc.assistant.send(u, { actionId: 'it-help', text: 'Printer rosak', values: { category: 'DEVICE', priority: 'P3', title: 'Printer rosak (mock)', detail: '' } }));
    assert.equal(r.sent, true);
    assert.equal(r.learned, true);
    const s = await as('u-proc-store1', (svc, u) => svc.assistant.style(u));
    assert.deepEqual(s.usual['it-help'], { category: 'DEVICE', priority: 'P3' });
    const acts = (await admin(`SELECT data->>'action' AS a FROM prima.audit WHERE data->>'action' LIKE 'assistant.%' ORDER BY seq`)).rows.map((x) => x.a);
    assert.deepEqual(acts, ['assistant.skill', 'assistant.skill', 'assistant.skill_retired', 'assistant.sent']);
  });
});
