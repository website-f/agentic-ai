// Arisha's reviewed handoff into the T9 import, against a real local PostgreSQL through the restricted app role
// (prima_app, forced row-level security). Run with DATABASE_URL pointing at a throwaway local database: it is reset.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { sha256Hex, verifyChain, type AuditEntry } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';
import { extractionAudit } from '../src/arisha-it-extraction-audit';
import { ItImportReviewController, itImportEnabled } from '../src/arisha-it-import.controller';
import { tidyReviews } from '../src/tidy-reviews';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

const SOURCE = 'UAT note: printer UAT-PG-1 jammed, raised by UAT Staff A over Teams, urgency P2.';

/** Change a stored review as the database owner with triggers off, to stand in for time passing. Test only. */
async function asOwner(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    await c.query(`SET session_replication_role = replica`);
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

/** Run SQL as the app role with a chosen user, the way the API does. */
async function asRole(userId: string, sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE prima_app');
    await c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.company_ids', '', true)`, [userId]);
    const res = await c.query(sql, params);
    await c.query('COMMIT');
    return res;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}

let n = 0;
async function extraction(db: Db, text = SOURCE) {
  n += 1;
  const attemptId = `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
  await extractionAudit(db).append({ attemptId, actorId: 'u-fauzan', at: new Date().toISOString(), phase: 'terminal', sourceSha256: sha256Hex(text), sourceLength: text.length, kind: 'tickets', selfDeclaredDataClass: 'synthetic', consentVersion: 'it-extraction-v1', outcome: 'success' });
  return { id: attemptId, text };
}

function part(ex: { id: string; text: string }, title: string) {
  return {
    extractionId: ex.id,
    source: { label: 'UAT Teams note', sha256: sha256Hex(ex.text), canonicalText: ex.text },
    rows: [{ fields: { title, category: 'device', priority: 'P2', requester: 'UAT Staff A', channel: 'Teams', raisedOn: null, detail: null, itPerson: null } }],
  };
}

describe('Arisha IT import review on PostgreSQL', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('two approvals of the same review at once import once', async () => {
    const ex = await extraction(db);
    const { review } = await db.asUser('u-fauzan', (svc, u) => svc.itImportReviews.create(u, { requestId: crypto.randomUUID(), kind: 'tickets', parts: [part(ex, 'UAT PG printer jam one')] }));
    const before = (await asRole('u-fauzan', 'SELECT count(*)::int AS n FROM prima.it_tickets')).rows[0].n;
    const body = { version: 1, previewToken: review.previewToken, skipRows: [] };
    const both = await Promise.all([0, 1].map(() => db.asUser('u-fauzan', (svc, u) => svc.itImportReviews.approve(u, review.id, body))));
    assert.deepEqual(both[0].created, both[1].created);
    assert.deepEqual(both.map((b) => b.already).sort(), [false, true]);
    const after = (await asRole('u-fauzan', 'SELECT count(*)::int AS n FROM prima.it_tickets')).rows[0].n;
    assert.equal(after, before + 1);
    const row = (await asRole('u-fauzan', 'SELECT data FROM prima.it_import_reviews WHERE id = $1', [review.id])).rows[0].data;
    assert.equal(row.status, 'committed');
    assert.equal(JSON.stringify(row).includes('jammed, raised by'), false, 'the source text is never stored');
  });

  it('an edit racing an approval: one wins cleanly, the other is told to reload', async () => {
    const ex = await extraction(db);
    const { review } = await db.asUser('u-fauzan', (svc, u) => svc.itImportReviews.create(u, { requestId: crypto.randomUUID(), kind: 'tickets', parts: [part(ex, 'UAT PG printer jam two')] }));
    const results = await Promise.allSettled([
      db.asUser('u-fauzan', (svc, u) => svc.itImportReviews.approve(u, review.id, { version: 1, previewToken: review.previewToken, skipRows: [] })),
      db.asUser('u-fauzan', (svc, u) => svc.itImportReviews.update(u, review.id, { version: 1, parts: [{ extractionId: ex.id, rows: [{ rowId: 'p1-r1', fields: { ...part(ex, 'UAT PG printer jam two, edited').rows[0].fields } }] }] })),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    assert.equal(lost.reason.name, 'ReviewConflict');
    const row = (await asRole('u-fauzan', 'SELECT data FROM prima.it_import_reviews WHERE id = $1', [review.id])).rows[0].data;
    assert.equal(row.version, 2);
  });

  it('only the CEO’s own rows: other users see and write nothing, nobody deletes, a closed review never changes', async () => {
    const ex = await extraction(db);
    const { review } = await db.asUser('u-fauzan', (svc, u) => svc.itImportReviews.create(u, { requestId: crypto.randomUUID(), kind: 'tickets', parts: [part(ex, 'UAT PG printer jam three')] }));
    for (const id of ['u-coo', 'u-fd', 'u-audit', 'u-it-lead', 'u-it-mgr']) {
      assert.equal((await asRole(id, 'SELECT id FROM prima.it_import_reviews')).rowCount, 0, `${id} reads nothing`);
      assert.equal((await asRole(id, `UPDATE prima.it_import_reviews SET data = data || '{"version": 9}' WHERE id = $1`, [review.id])).rowCount, 0);
      await assert.rejects(asRole(id, 'INSERT INTO prima.it_import_reviews (id, data) VALUES ($1, $2)', ['r-x', { id: 'r-x', actorId: id, kind: 'tickets', status: 'reviewing' }]), /row-level security|starts open/);
      await assert.rejects(db.asUser(id, (svc, u) => svc.itImportReviews.get(u, review.id)), /only the CEO/);
    }
    // The CEO's own login cannot write a review for someone else, or delete one.
    await assert.rejects(asRole('u-fauzan', 'INSERT INTO prima.it_import_reviews (id, data) VALUES ($1, $2)', ['r-y', { id: 'r-y', actorId: 'u-coo', kind: 'tickets', status: 'reviewing' }]), /row-level security|starts open/);
    await assert.rejects(asRole('u-fauzan', 'DELETE FROM prima.it_import_reviews WHERE id = $1', [review.id]), /permission denied/);
    // A review change must raise its version.
    await assert.rejects(asRole('u-fauzan', `UPDATE prima.it_import_reviews SET data = data || '{"parts": []}' WHERE id = $1`, [review.id]), /raise its version/);
    await db.asUser('u-fauzan', (svc, u) => svc.itImportReviews.approve(u, review.id, { version: 1, previewToken: review.previewToken, skipRows: [] }));
    await assert.rejects(asRole('u-fauzan', `UPDATE prima.it_import_reviews SET data = data || '{"status": "reviewing", "version": 5}' WHERE id = $1`, [review.id]), /does not change/);
    await assert.rejects(asRole('u-fauzan', `UPDATE prima.it_import_reviews SET data = data || '{"purged": true}' WHERE id = $1`, [review.id]), /does not change/);
  });

  it('every stored review has its required fields and starts open at version 1, owned by u-fauzan', async () => {
    const ex = await extraction(db);
    const { review } = await db.asUser('u-fauzan', (svc, u) => svc.itImportReviews.create(u, { requestId: crypto.randomUUID(), kind: 'tickets', parts: [part(ex, 'UAT PG printer jam four')] }));
    const good = (await asRole('u-fauzan', 'SELECT data FROM prima.it_import_reviews WHERE id = $1', [review.id])).rows[0].data;
    const id = '11111111-1111-4111-8111-111111111111';
    const ins = (data: object) => asRole('u-fauzan', 'INSERT INTO prima.it_import_reviews (id, data) VALUES ($1, $2)', [id, { ...good, id, ...data }]);
    for (const bad of [{ parts: {} }, { version: '1' }, { reviewedHash: 'XYZ' }, { createdAt: 'yesterday' }, { purged: 'no' }, { previewToken: '' }, { counts: null }]) {
      await assert.rejects(ins(bad), /check constraint|starts open/, JSON.stringify(bad));
    }
    for (const bad of [{ status: 'committed' }, { version: 2 }, { purged: true }, { receipt: { created: [] } }, { purgeAfter: '2026-12-01T00:00:00.000Z' }]) {
      await assert.rejects(ins(bad), /starts open|check constraint/, JSON.stringify(bad));
    }
    // Every required key: a review without it is refused, and no change may remove it.
    const keys = ['id', 'actorId', 'kind', 'parts', 'counts', 'reviewedHash', 'previewToken', 'status', 'version', 'receipt', 'createdAt', 'updatedAt', 'expiresAt', 'purgeAfter', 'purged', 'requestHash'];
    assert.deepEqual(Object.keys(good).sort(), [...keys].sort());
    for (const k of keys) {
      const rest = { ...good, id };
      delete (rest as Record<string, unknown>)[k];
      await assert.rejects(asRole('u-fauzan', 'INSERT INTO prima.it_import_reviews (id, data) VALUES ($1, $2)', [id, rest]), /check constraint|starts open|row-level security/, `insert without ${k}`);
      await assert.rejects(asRole('u-fauzan', k === 'version' ? 'UPDATE prima.it_import_reviews SET data = data - $2::text WHERE id = $1' : 'UPDATE prima.it_import_reviews SET data = (data - $2::text) || jsonb_build_object(\'version\', 2) WHERE id = $1', [review.id, k]), /check constraint|keeps its owner|raise its version|row-level security|new row violates|open review|closes as|expires only/, `update removing ${k}`);
      // receipt and purgeAfter are null on an open review already, so only the other keys can be nulled wrongly.
      if (k !== 'receipt' && k !== 'purgeAfter')
        await assert.rejects(asRole('u-fauzan', k === 'version' ? 'UPDATE prima.it_import_reviews SET data = data || jsonb_build_object($2::text, null) WHERE id = $1' : 'UPDATE prima.it_import_reviews SET data = data || jsonb_build_object($2::text, null) || jsonb_build_object(\'version\', 2) WHERE id = $1', [review.id, k]), /check constraint|keeps its owner|raise its version|starts open|row-level security|new row violates|open review|closes as|expires only/, `update nulling ${k}`);
    }
    assert.equal((await asRole('u-fauzan', 'SELECT data FROM prima.it_import_reviews WHERE id = $1', [review.id])).rows[0].data.version, 1);
    // The policy names the CEO account itself, not only "the signed-in user".
    await asOwner(`UPDATE prima.users SET data = data || '{"opsTier": "ceo"}' WHERE id = 'u-coo'`);
    try {
      await assert.rejects(asRole('u-coo', 'INSERT INTO prima.it_import_reviews (id, data) VALUES ($1, $2)', [id, { ...good, id, actorId: 'u-coo' }]), /row-level security/);
    } finally {
      await asOwner(`UPDATE prima.users SET data = data || '{"opsTier": "coo"}' WHERE id = 'u-coo'`);
    }
    // A change raises the version by exactly one, and the start and expiry times never move.
    await assert.rejects(asRole('u-fauzan', `UPDATE prima.it_import_reviews SET data = data || '{"version": 5}' WHERE id = $1`, [review.id]), /raise its version by one/);
    await assert.rejects(asRole('u-fauzan', `UPDATE prima.it_import_reviews SET data = data || '{"version": 2, "expiresAt": "2099-01-01T00:00:00.000Z"}' WHERE id = $1`, [review.id]), /keeps its owner/);
    await assert.rejects(asRole('u-fauzan', `UPDATE prima.it_import_reviews SET data = data || '{"status": "expired"}' WHERE id = $1`, [review.id]), /expires only after its time/);
    // Even after its time, the CEO's login cannot expire it directly: only the audited retention function can.
    await asOwner(`UPDATE prima.it_import_reviews SET data = data || '{"expiresAt": "2026-01-01T00:00:00.000Z"}' WHERE id = $1`, [review.id]);
    await assert.rejects(asRole('u-fauzan', `UPDATE prima.it_import_reviews SET data = data || '{"status": "expired", "purgeAfter": "2026-01-31T00:00:00.000Z"}' WHERE id = $1`, [review.id]), /through the retention job/);
    await assert.rejects(asRole('u-fauzan', `UPDATE prima.it_import_reviews SET data = data || '{"version": 2, "status": "committed", "purgeAfter": "2026-12-01T00:00:00.000Z", "receipt": {"created": []}, "parts": []}' WHERE id = $1`, [review.id]), /closes as it was reviewed/);
  });

  it('expiry and clearing run in the database, from a request or the daily job, changing only what they may', async () => {
    const ex = await extraction(db);
    const open = (await db.asUser('u-fauzan', (svc, u) => svc.itImportReviews.create(u, { requestId: crypto.randomUUID(), kind: 'tickets', parts: [part(ex, 'UAT PG printer jam five')] }))).review;
    const ex2 = await extraction(db);
    const done = (await db.asUser('u-fauzan', (svc, u) => svc.itImportReviews.create(u, { requestId: crypto.randomUUID(), kind: 'tickets', parts: [part(ex2, 'UAT PG printer jam six')] }))).review;
    await db.asUser('u-fauzan', (svc, u) => svc.itImportReviews.approve(u, done.id, { version: 1, previewToken: done.previewToken, skipRows: [] }));
    // Time passes: the open review is past its 24 hours.
    await asOwner(`UPDATE prima.it_import_reviews SET data = data || '{"expiresAt": "2026-01-01T00:00:00.000Z"}' WHERE id = $1`, [open.id]);
    const seen = await db.asUser('u-fauzan', (svc, u) => svc.itImportReviews.get(u, open.id));
    assert.equal(seen.review.status, 'expired');
    assert.equal(seen.review.version, open.version, 'expiry does not change the version');
    assert.equal(seen.review.purgeAfter, '2026-01-31T00:00:00.000Z', 'kept 30 days from its expiry time');
    await assert.rejects(db.asUser('u-fauzan', (svc, u) => svc.itImportReviews.approve(u, open.id, { version: 1, previewToken: open.previewToken, skipRows: [] })), /expired/);
    // Before its keeping time, a closed review cannot be cleared, even by the CEO's login.
    const clear = `UPDATE prima.it_import_reviews SET data = data || jsonb_build_object('purged', true, 'parts', (SELECT jsonb_agg(p || '{"rows": []}') FROM jsonb_array_elements(data->'parts') p)) WHERE id = $1`;
    await assert.rejects(asRole('u-fauzan', clear, [done.id]), /does not change/);
    await asOwner(`UPDATE prima.it_import_reviews SET data = data || '{"purgeAfter": "2026-01-01T00:00:00.000Z"}' WHERE id = $1`, [done.id]);
    // After it, clearing may not touch anything else: not the receipt, not a part's fingerprint, not the counts.
    await assert.rejects(asRole('u-fauzan', `UPDATE prima.it_import_reviews SET data = data || '{"purged": true, "counts": {}}' WHERE id = $1`, [done.id]), /does not change/);
    await assert.rejects(asRole('u-fauzan', `UPDATE prima.it_import_reviews SET data = data || '{"purged": true, "parts": []}' WHERE id = $1`, [done.id]), /does not change/);
    const before = (await asRole('u-fauzan', 'SELECT data FROM prima.it_import_reviews WHERE id = $1', [done.id])).rows[0].data;
    // The daily job, through the app role and the database function only.
    const c = new Client({ connectionString: URL });
    await c.connect();
    const out = await tidyReviews(c as never, 'UAT daily job').finally(() => c.end());
    assert.equal(out.purged >= 1, true);
    const after = (await asRole('u-fauzan', 'SELECT data FROM prima.it_import_reviews WHERE id = $1', [done.id])).rows[0].data;
    assert.equal(after.purged, true);
    assert.deepEqual(after.parts.map((p: { rows: unknown[] }) => p.rows), [[]]);
    const strip = (d: Record<string, unknown>) => ({ ...d, parts: (d.parts as Record<string, unknown>[]).map((p) => ({ ...p, rows: [] })), purged: null, updatedAt: null });
    assert.deepEqual(strip(after), strip(before));
    const audit = await asRole('u-fauzan', `SELECT data FROM prima.audit WHERE data->>'entityId' = ANY($1) AND data->>'entity' = 'it_import_review'`, [[open.id, done.id]]);
    const actions = audit.rows.map((r) => `${r.data.action} by ${r.data.actor}`);
    assert.ok(actions.some((a) => a.startsWith('it.import.review.expire by ')));
    assert.ok(actions.includes('it.import.review.purge by UAT daily job'));
    assert.equal(JSON.stringify(audit.rows).includes('printer'), false);
    // The database wrote those entries itself, and the chain still verifies end to end.
    const chain = (await asOwner('SELECT data FROM prima.audit ORDER BY seq')).rows.map((r) => r.data as AuditEntry);
    assert.equal(verifyChain(chain), null);
    // Only the CEO's own requests or the daily job may run it, always saying who; and the app role cannot write audit
    // entries through the internal function.
    await assert.rejects(asRole('u-coo', 'SELECT * FROM prima.tidy_it_import_reviews($1)', ['COO']), /Only the CEO/);
    // A second account given the CEO tier is still refused: interactive clean-up is for u-fauzan only.
    await asOwner(`UPDATE prima.users SET data = data || '{"opsTier": "ceo"}' WHERE id = 'u-coo'`);
    try {
      await assert.rejects(asRole('u-coo', 'SELECT * FROM prima.tidy_it_import_reviews($1)', ['COO as CEO tier']), /Only the CEO/);
    } finally {
      await asOwner(`UPDATE prima.users SET data = data || '{"opsTier": "coo"}' WHERE id = 'u-coo'`);
    }
    await assert.rejects(asRole('u-fauzan', 'SELECT * FROM prima.tidy_it_import_reviews($1)', ['']), /Say who/);
    await assert.rejects(asRole('u-fauzan', `SELECT prima.audit_append_internal('x', 'y', 'z', 'w', 'v')`), /permission denied/);
    const direct = await asRole('u-fauzan', 'SELECT * FROM prima.tidy_it_import_reviews($1)', ['UAT direct call']);
    assert.equal(direct.rowCount, 0, 'nothing left to tidy');
  });

  it('stays off unless ARISHA_IT_IMPORT_ENABLED is exactly true', async () => {
    const was = process.env.ARISHA_IT_IMPORT_ENABLED;
    try {
      for (const v of [undefined, '', 'false', 'TRUE', '1']) {
        if (v === undefined) delete process.env.ARISHA_IT_IMPORT_ENABLED;
        else process.env.ARISHA_IT_IMPORT_ENABLED = v;
        assert.equal(itImportEnabled(), false);
        const c = new ItImportReviewController(db);
        assert.throws(() => c.create({}, { kind: 'tickets', parts: [] }), (e: { getStatus?: () => number }) => e.getStatus?.() === 503);
        assert.throws(() => c.approve({}, '00000000-0000-4000-9000-000000000001', {}), (e: { getStatus?: () => number }) => e.getStatus?.() === 503);
        assert.throws(() => c.refresh({}, '00000000-0000-4000-9000-000000000001', {}), (e: { getStatus?: () => number }) => e.getStatus?.() === 503);
      }
      process.env.ARISHA_IT_IMPORT_ENABLED = 'true';
      // On, but without a verified Microsoft sign-in: refused, not served.
      assert.throws(() => new ItImportReviewController(db).create({}, {}), (e: { getStatus?: () => number }) => e.getStatus?.() === 403);
      assert.throws(() => new ItImportReviewController(db).status({}), (e: { getStatus?: () => number }) => e.getStatus?.() === 403);
    } finally {
      if (was === undefined) delete process.env.ARISHA_IT_IMPORT_ENABLED;
      else process.env.ARISHA_IT_IMPORT_ENABLED = was;
    }
  });

  it('two creates with the same request ID at once make one review', async () => {
    const ex = await extraction(db);
    const body = { requestId: crypto.randomUUID(), kind: 'tickets', parts: [part(ex, 'UAT PG printer jam seven')] };
    const both = await Promise.all([0, 1].map(() => db.asUser('u-fauzan', (svc, u) => svc.itImportReviews.create(u, JSON.parse(JSON.stringify(body))))));
    assert.deepEqual(both.map((b) => b.review.id), [body.requestId, body.requestId]);
    assert.deepEqual(both.map((b) => b.replayed).sort(), [false, true]);
    assert.equal((await asRole('u-fauzan', 'SELECT count(*)::int AS n FROM prima.it_import_reviews WHERE id = $1', [body.requestId])).rows[0].n, 1);
    const creates = await asRole('u-fauzan', `SELECT count(*)::int AS n FROM prima.audit WHERE data->>'entityId' = $1 AND data->>'action' = 'it.import.review.create'`, [body.requestId]);
    assert.equal(creates.rows[0].n, 1);
  });

  it('readiness reports a missing protection or right in the database', async () => {
    const problems = () => db.asUser('u-fauzan', (svc) => svc.itImportReviews.problems());
    assert.deepEqual(await problems(), []);
    await asOwner('ALTER TABLE prima.it_import_reviews DISABLE TRIGGER it_import_review_guard');
    try {
      assert.ok((await problems()).some((p) => /guard trigger/.test(p)));
    } finally {
      await asOwner('ALTER TABLE prima.it_import_reviews ENABLE TRIGGER it_import_review_guard');
    }
    await asOwner('REVOKE UPDATE ON prima.it_import_reviews FROM prima_app');
    try {
      assert.ok((await problems()).some((p) => /cannot read, add or change/.test(p)));
    } finally {
      await asOwner('GRANT UPDATE ON prima.it_import_reviews TO prima_app');
    }
    await asOwner('GRANT DELETE ON prima.it_import_reviews TO prima_app');
    try {
      assert.ok((await problems()).some((p) => /may remove/.test(p)));
    } finally {
      await asOwner('REVOKE DELETE ON prima.it_import_reviews FROM prima_app');
    }
    assert.deepEqual(await problems(), []);
  });
});

