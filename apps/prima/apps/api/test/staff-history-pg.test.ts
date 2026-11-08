import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

async function admin<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows as T[];
  } finally {
    await c.end();
  }
}

const IC = '880808-08-8888';
const guard = (code: string, over: Record<string, unknown> = {}) => ({
  company: code,
  externalId: `PGH-${code}`,
  updatedAt: new Date().toISOString(),
  staffNo: `PGH-${code}-01`,
  name: 'Ujian Sejarah PG',
  nationality: 'MY',
  role: 'guard',
  status: 'active',
  dob: '1988-08-08',
  hiredOn: '2026-01-05',
  state: 'Selangor',
  idFull: IC,
  ...over,
});

// Group employment history on PostgreSQL with row level security (synthetic data only; Fauzan, 4 Nov 2026).
describe('group employment history under PostgreSQL walls', () => {
  let db: Db;
  let codes: Record<string, string>;
  let pa = '';
  let pb = '';
  before(async () => {
    await resetDb(URL);
    db = new Db();
    codes = Object.fromEntries((await admin<{ id: string; data: { code: string } }>(`SELECT id, data FROM prima.companies`)).map((r) => [r.id, r.data.code]));
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('the JA feed links a guard who left Sasa and came back at Inas, without the number in any history table', async () => {
    const one = await db.asUser('u-ja-sync', (svc, u) =>
      svc.jaIngest(u, 'guard', [guard(codes['co-sasa'], { status: 'left', hiredOn: '2019-03-01', leftOn: '2022-06-30', leftHow: 'terminated', csg: { certificateNo: 'CSG-PGH', doneOn: '2019-09-01' } })]),
    );
    assert.deepEqual(one.rejected, []);
    const two = await db.asUser('u-ja-sync', (svc, u) => svc.jaIngest(u, 'guard', [guard(codes['co-inas'], { idFull: '880808088888' })]));
    assert.deepEqual(two.rejected, []);
    const links = await admin<{ id: string; data: { groupPersonId: string; companyId: string } }>(`SELECT id, data FROM prima.person_links WHERE data->>'companyId' IN ('co-sasa','co-inas') AND id LIKE 'p-ja-%PGH%'`);
    assert.equal(links.length, 2);
    assert.equal(links[0].data.groupPersonId, links[1].data.groupPersonId);
    pa = links.find((l) => l.data.companyId === 'co-sasa')!.id;
    pb = links.find((l) => l.data.companyId === 'co-inas')!.id;
    for (const t of ['person_links', 'group_people', 'group_person_notes', 'hire_checks']) {
      const rows = await admin<{ n: number }>(`SELECT count(*)::int AS n FROM prima.${t} WHERE data::text LIKE '%880808%'`);
      assert.equal(rows[0].n, 0, t);
    }
  });

  it('HR reads the whole history; company heads and OMs read no row at all; a company head cannot forge a link', async () => {
    const hr = await db.asUser('u-pwvsb-hr', (svc, u) => svc.groupHistory(u, pb));
    assert.equal(hr.linked && hr.shape, 'hr');
    assert.ok(hr.linked && hr.employments.length === 2 && hr.employments[0].ended === 'terminated');
    // Fauzan, 4 Nov 2026: only the Regional OM and above, by number. The database itself gives others no row.
    for (const id of ['u-cm-inas', 'u-cm-arsh', 'u-om-klang', 'u-rom-south', 'u-coo']) {
      const rows = await db.asUser(id, async (_svc, _u, store) => ({
        groups: await store.list('groupPeople', {}),
        notes: await store.list('groupPersonNotes', {}),
        links: await store.list('personLinks', {}),
      }));
      assert.equal(rows.groups.length + rows.notes.length + rows.links.length, 0, id);
    }
    await assert.rejects(db.asUser('u-cm-inas', (svc, u) => svc.groupHistory(u, pb)));
    await assert.rejects(db.asUser('u-rom-south', (svc, u) => svc.groupHistory(u, pb)));
    await assert.rejects(
      db.asUser('u-cm-inas', (_svc, _u, store) =>
        store.insert('personLinks', { id: 'x-forged', personId: pb, companyId: 'co-inas', groupPersonId: 'gp-x', idKey: null, method: 'hr_link', foreign: false, guard: true, linkedAt: '2026-11-04T00:00:00Z', linkedBy: 'x', linkedById: 'x', note: null }),
      ),
    );
  });

  it('the ROM looks up one person by number across companies; red notice; the COO decides do not hire again by lookup', async () => {
    await assert.rejects(db.asUser('u-pwvsb-hr', (svc, u) => svc.setRehire(u, { personId: pb, status: 'do_not_rehire', reason: 'Ditamatkan selepas siasatan 2022 (ujian PG)' })));
    await db.asUser('u-cos', (svc, u) => svc.setRehire(u, { personId: pb, status: 'do_not_rehire', reason: 'Ditamatkan selepas siasatan 2022 (ujian PG)' }));
    // The ROM reads no row, yet the lookup (a database function) answers for the number typed: summary and red notice.
    const r = await db.asUser('u-rom-south', (svc, u) => svc.historyLookup(u, { idFull: IC, nationality: 'MY' }));
    assert.equal(r.known, true);
    assert.equal(r.doNotRehire, true);
    assert.equal(r.rehireNotes, null);
    assert.deepEqual(r.summary!.employments.map((e) => e.to), ['2022-06-30', null]);
    assert.match(r.summary!.employments[0].companyName, /Sasa/);
    assert.doesNotMatch(JSON.stringify(r), /terminated|siasatan|PGH-|880808/);
    const checks = await admin<{ data: { idMasked: string; userId: string } }>(`SELECT data FROM prima.hire_checks WHERE data->>'userId' = 'u-rom-south'`);
    assert.equal(checks.length, 1);
    assert.equal(checks[0].data.idMasked, '********8888');
    // Company heads cannot look up; without the wall the database function refuses too.
    await assert.rejects(db.asUser('u-cm-arsh', (svc, u) => svc.historyLookup(u, { idFull: IC, nationality: 'MY' })));
    await assert.rejects(
      db.asUser('u-cm-arsh', async (_svc, _u, store) => (store as unknown as { groupHistoryLookup: (k: string) => Promise<unknown> }).groupHistoryLookup('k1$x')),
      /Not allowed/,
    );
    await assert.rejects(
      db.asUser('u-rom-south', async (_svc, _u, store) =>
        (store as unknown as { historySetMark: (k: string, m: unknown, e: unknown) => Promise<unknown> }).historySetMark('k1$x', { status: 'eligible', setAt: 'x', setBy: 'x' }, { status: 'eligible', reason: 'Ujian tanpa kuasa', by: 'x', byId: 'x', at: 'x' }),
      ),
      /Not allowed/,
    );
    // The COO reads the reasons and lifts the mark with a reason, through the database function.
    const c = await db.asUser('u-coo', (svc, u) => svc.historyLookup(u, { idFull: IC, nationality: 'MY' }));
    assert.ok(c.rehireNotes!.some((n) => /siasatan/.test(n.reason)));
    await db.asUser('u-coo', (svc, u) => svc.markByLookup(u, { idFull: IC, nationality: 'MY', status: 'check_first', reason: 'Disemak semula oleh COO (ujian PG)' }));
    const again = await db.asUser('u-rom-south', (svc, u) => svc.historyLookup(u, { idFull: IC, nationality: 'MY' }));
    assert.equal(again.doNotRehire, false);
    assert.equal(again.rehire!.status, 'check_first');
    const notes = await admin<{ data: { rehire: { reason: string; status: string }[] } }>(`SELECT data FROM prima.group_person_notes`);
    assert.ok(notes.some((n) => n.data.rehire.map((x) => x.status).join() === 'do_not_rehire,check_first'));
  });

  it('a feed not granted the earlier companies still files the guard; HR links the record from the board', async () => {
    await admin(`DELETE FROM prima.grants WHERE data->>'userId' = 'u-ja-sync' AND data->>'companyId' IN ('co-sasa', 'co-inas')`);
    const r = await db.asUser('u-ja-sync', (svc, u) =>
      svc.jaIngest(u, 'guard', [guard(codes['co-arsh'], { externalId: 'PGH-3', staffNo: 'PGH-3', hiredOn: '2026-10-01' })]),
    );
    assert.deepEqual(r.rejected, []);
    const pc = (await admin<{ id: string }>(`SELECT id FROM prima.people WHERE data->>'staffNo' = 'PGH-3'`))[0].id;
    // The feed found the person (by the database function) but cannot change a summary of companies it is not granted.
    assert.equal((await admin(`SELECT 1 FROM prima.person_links WHERE id = $1`, [pc])).length, 0);
    const board = await db.asUser('u-pwvsb-hr', (svc, u) => svc.groupHistoryBoard(u));
    assert.ok(board.counts.unlinked > 0);
    await db.asUser('u-pwvsb-hr', (svc, u) => svc.linkExistingRecords(u));
    const [lc] = await admin<{ data: { groupPersonId: string } }>(`SELECT data FROM prima.person_links WHERE id = $1`, [pc]);
    const [lb] = await admin<{ data: { groupPersonId: string } }>(`SELECT data FROM prima.person_links WHERE id = $1`, [pb]);
    assert.equal(lc.data.groupPersonId, lb.data.groupPersonId);
    const g = await admin<{ data: { employments: unknown[] } }>(`SELECT data FROM prima.group_people WHERE id = $1`, [lb.data.groupPersonId]);
    assert.equal(g[0].data.employments.length, 3);
  });

  it('HR adds an old-file employment and carries the CSG certificate; the KDN card never carries', async () => {
    await db.asUser('u-pwvsb-hr', (svc, u) => svc.addOldEmployment(u, { personId: pb, companyId: 'co-arsh', role: 'guard', from: '2012-01-01', to: '2014-12-31', ended: 'resigned', sourceRef: 'Fail lama 12/A (ujian PG)' }));
    const cm = await db.asUser('u-rom-central', (svc, u) => svc.historyLookup(u, { idFull: IC, nationality: 'MY' }));
    assert.ok(cm.summary!.employments.some((e) => e.source === 'old_file'));
    assert.doesNotMatch(JSON.stringify(cm), /Fail lama/);
    const csg = (await admin<{ id: string }>(`SELECT id FROM prima.credentials WHERE data->>'personId' = $1 AND data->>'type' = 'CSG_TRAINING'`, [pa]))[0].id;
    const row = await db.asUser('u-pwvsb-hr', (svc, u) => svc.carryHistoryPaper(u, { personId: pb, credentialId: csg }));
    assert.equal(row.companyId, 'co-inas');
    await assert.rejects(db.asUser('u-cm-inas', (svc, u) => svc.carryHistoryPaper(u, { personId: pb, credentialId: csg })));
  });

  // Arisha main review of e854efa (4 Nov 2026): the self-decision guard and the population limits on PostgreSQL.
  it('COO, OGM and Operations Director cannot decide about their own history; the database guard reads the links', async () => {
    for (const id of ['u-coo', 'u-ogm', 'u-opsdir']) {
      await admin(`UPDATE prima.users SET data = data || jsonb_build_object('personId', $1::text) WHERE id = $2`, [pb, id]);
      await db.asUser(id, (svc, u) => svc.historyLookup(u, { idFull: IC, nationality: 'MY' }));
      await assert.rejects(
        db.asUser(id, (svc, u) => svc.markByLookup(u, { idFull: IC, nationality: 'MY', status: 'eligible', reason: 'Boleh diambil semula (ujian PG)' })),
        /own history/,
        id,
      );
      await admin(`UPDATE prima.users SET data = data - 'personId' WHERE id = $1`, [id]);
    }
    // Without the personId, the same COO decision goes through the function.
    await db.asUser('u-coo', (svc, u) => svc.historyLookup(u, { idFull: IC, nationality: 'MY' }));
    await db.asUser('u-coo', (svc, u) => svc.markByLookup(u, { idFull: IC, nationality: 'MY', status: 'check_first', reason: 'Disemak semula oleh COO (ujian PG 2)' }));
  });

  it('an HR officer neither looks up nor reads foreign workers; the HR Director and FWM management do', async () => {
    const r = await db.asUser('u-ja-sync', (svc, u) =>
      svc.jaIngest(u, 'guard', [guard(codes['co-arsh'], { externalId: 'PGH-NP', staffNo: 'PGH-NP', nationality: 'NP', name: 'Ujian Nepal PG', dob: '1995-05-05', idFull: 'PA7777777' })]),
    );
    assert.deepEqual(r.rejected, []);
    await assert.rejects(db.asUser('u-pwvsb-hr', (svc, u) => svc.historyLookup(u, { idFull: 'PA7777777', nationality: 'NP' })), /Malaysians/);
    // The database function itself returns nothing foreign to an HR officer, whatever the API asks.
    const key = await db.asUser('u-pwvsb-hr', async (svc) => svc.idLinks.key('PA7777777', 'NP')!);
    const officer = await db.asUser('u-pwvsb-hr', async (_svc, _u, store) => ({
      lookup: await (store as unknown as { groupHistoryLookup: (k: string) => Promise<{ groups: unknown[] }> }).groupHistoryLookup(key),
      groups: await store.list('groupPeople', {}),
      links: await store.list('personLinks', {}),
    }));
    assert.equal(officer.lookup.groups.length, 0);
    assert.ok(officer.groups.length > 0 && officer.groups.every((g) => g.foreign === false));
    assert.ok(officer.links.every((l) => l.foreign === false));
    const director = await db.asUser('u-cos', (svc, u) => svc.historyLookup(u, { idFull: 'PA7777777', nationality: 'NP' }));
    assert.equal(director.known, true);
    const fwm = await db.asUser('u-fwm-mgr', (svc, u) => svc.historyLookup(u, { idFull: 'PA7777777', nationality: 'NP' }));
    assert.equal(fwm.known, true);
    assert.ok(fwm.record);
    // FWM management's function call never returns a Malaysian.
    const myKey = await db.asUser('u-fwm-mgr', async (svc) => svc.idLinks.key(IC, 'MY')!);
    const fwmMy = await db.asUser('u-fwm-mgr', async (_svc, _u, store) => (store as unknown as { groupHistoryLookup: (k: string) => Promise<{ groups: unknown[] }> }).groupHistoryLookup(myKey));
    assert.equal(fwmMy.groups.length, 0);
  });
});
