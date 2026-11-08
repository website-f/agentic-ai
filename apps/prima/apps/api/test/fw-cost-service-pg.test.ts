// Recruitment cost through the real API service on PostgreSQL with the company wall on: a back-dated placement racing
// the monthly draft, and a draft retried at once. The module SQL is applied to the throwaway local database only (it
// is not part of the release). Synthetic seed data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
process.env.DEV_TOKEN_SECRET = process.env.DEV_TOKEN_SECRET ?? 'test-secret';
const mod = (f: string) => readFileSync(resolve(process.cwd(), process.cwd().endsWith('/apps/api') ? `../../db/modules/${f}` : `db/modules/${f}`), 'utf8');
// Placements also check the EPF and SOCSO recharge locks (rule FW-RECHARGE), so both modules are applied together.
const moduleSql = () => mod('fw-recruitment-cost-v1.sql') + '\n' + mod('fw-epf-socso-recharge-v1.sql');

describe('recruitment cost on PostgreSQL', () => {
  let db: Db;
  let workers: string[];
  let last: string;
  before(async () => {
    await resetDb(URL);
    db = new Db();
    await db.pool.query(moduleSql());
    workers = (await db.pool.query("SELECT id FROM prima.people WHERE company_id='co-sasa' AND data->>'nationality'='NP' AND data->>'status'<>'left' ORDER BY id LIMIT 3")).rows.map((r) => r.id);
    const today = await db.asUser('u-fd', async (svc) => svc.today());
    const [y, m] = today.slice(0, 7).split('-').map(Number);
    last = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    await db.asUser('u-fwm-ex1', (svc, u) => svc.recordFwPlacement(u, workers[0], { hostCompanyId: 'co-arsh', from: `${last}-02` }, []));
    await db.asUser('u-fd', (svc, u) => svc.setFwCostRate(u, { kind: 'charge', monthlyPerWorker: 250, from: last, note: 'Synthetic charge rate' }));
    await db.asUser('u-fd', (svc, u) => svc.setFwCostRate(u, { kind: 'payback', monthlyPerWorker: 200, from: last, note: 'Synthetic payback rate' }));
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('a back-dated placement racing the draft: either it is refused, or the draft includes it; never a silent miss', async () => {
    const r = await Promise.allSettled([
      db.asUser('u-fin-t1-lead', (svc, u) => svc.draftFwCostMonth(u, last)),
      db.asUser('u-fwm-ex2', (svc, u) => svc.recordFwPlacement(u, workers[1], { hostCompanyId: 'co-arsh', from: `${last}-05` }, [])),
    ]);
    assert.equal(r[0].status, 'fulfilled');
    const host = (await db.pool.query("SELECT data FROM prima.fw_cost_charges WHERE data->>'direction'='host_pays_fwm' AND data->>'month'=$1 AND data->>'status'<>'rejected'", [last])).rows.map((x) => x.data);
    const people = host.flatMap((c) => c.lines.map((l: { personId: string }) => l.personId));
    if (r[1].status === 'fulfilled') assert.ok(people.includes(workers[1]), 'placement saved before the draft is in the draft');
    else assert.match(String((r[1] as PromiseRejectedResult).reason?.message), /already drafted/);
    assert.ok(people.includes(workers[0]));
    // Whatever the order, no live placement in that month is left out of its charges.
    const placed = (await db.pool.query("SELECT data->>'personId' AS p FROM prima.fw_placements WHERE data->>'from' <= $1", [`${last}-31`])).rows.map((x) => x.p);
    for (const p of placed) assert.ok(people.includes(p), p);
  });

  it('two drafts of the same month at once leave one set of charges', async () => {
    await db.asUser('u-fauzan', (svc, u) => svc.decideFwCostCharges(u, { month: last, approve: false, note: 'Retry test' }));
    const r = await Promise.allSettled([
      db.asUser('u-fin-t1-lead', (svc, u) => svc.draftFwCostMonth(u, last)),
      db.asUser('u-fin-t1-dep', (svc, u) => svc.draftFwCostMonth(u, last)),
    ]);
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
    const live = await db.pool.query("SELECT 1 FROM prima.fw_cost_charges WHERE data->>'month'=$1 AND data->>'status'='draft'", [last]);
    assert.equal(live.rowCount, 2); // one host (Arrow Shield) and one owner (Sasa)
  });

  // Arisha main review (3 Nov 2026 09:24Z): a backdated rate must not slip in beside a draft. Another connection holds
  // the shared recruitment-cost lock while the action under test waits on it, then changes the data and lets go.
  const holdLock = async () => {
    const c = await db.pool.connect();
    await c.query('BEGIN');
    await c.query("SELECT pg_advisory_xact_lock(hashtext('fw-cost:fwrate'))");
    return c;
  };
  const pending = async <T,>(p: Promise<T>) => {
    let done = false;
    p.then(() => (done = true), () => (done = true));
    await new Promise((r) => setTimeout(r, 400));
    return done;
  };
  const rejectLive = () => db.pool.query("UPDATE prima.fw_cost_charges SET data = data || '{\"status\":\"rejected\",\"decidedById\":\"u-test\"}'::jsonb WHERE data->>'month'=$1 AND data->>'status'<>'rejected'", [last]);

  it('order 1: a draft lands while the backdated rate waits; the rate then sees it and is refused', async () => {
    await rejectLive();
    const holder = await holdLock();
    const setter = db.asUser('u-fd', (svc, u) => svc.setFwCostRate(u, { kind: 'charge', monthlyPerWorker: 150, from: last, note: 'Synthetic backdated rate' }));
    assert.equal(await pending(setter), false, 'the rate waits on the shared lock');
    // The "draft" commits while the setter waits.
    await holder.query("INSERT INTO prima.fw_cost_charges (id, company_id, data) VALUES ('fwcc-host-co-arsh-race', 'co-arsh', jsonb_build_object('id','fwcc-host-co-arsh-race','direction','host_pays_fwm','companyId','co-arsh','branchId',null,'month',$1::text,'rate',100,'lines','[]'::jsonb,'total',100,'status','draft','draftedById','u-fin-t1-lead','paidDocIds','[]'::jsonb))", [last]);
    await holder.query('COMMIT');
    holder.release();
    await assert.rejects(setter, /already charged/);
    const steps = (await db.pool.query("SELECT data->'charge' AS c FROM prima.fw_cost_rates WHERE id='fwrate'")).rows[0].c;
    assert.ok(!steps.some((s: { monthlyPerWorker: number }) => s.monthlyPerWorker === 150), 'no RM150 step was saved');
  });

  it('order 2: a backdated rate lands while the draft waits; the draft then uses it', async () => {
    await rejectLive();
    const holder = await holdLock();
    const draft = db.asUser('u-fin-t1-lead', (svc, u) => svc.draftFwCostMonth(u, last));
    assert.equal(await pending(draft), false, 'the draft waits on the shared lock');
    await holder.query(
      "UPDATE prima.fw_cost_rates SET data = jsonb_set(data, '{charge}', (data->'charge') || jsonb_build_array(jsonb_build_object('monthlyPerWorker',175,'from',$1::text,'note','Synthetic','by','x','byId','x','at','2099-01-01T00:00:00+08:00'))) WHERE id='fwrate'",
      [last],
    );
    await holder.query('COMMIT');
    holder.release();
    const rows = await draft;
    const host = rows.find((r) => r.direction === 'host_pays_fwm')!;
    assert.equal(host.rate, 175);
  });

  it('both orders under a real race: no live charge is ever priced differently from the rate now in force', async () => {
    for (let i = 0; i < 4; i++) {
      await rejectLive();
      await Promise.allSettled([
        db.asUser('u-fin-t1-lead', (svc, u) => svc.draftFwCostMonth(u, last)),
        db.asUser('u-fd', (svc, u) => svc.setFwCostRate(u, { kind: 'charge', monthlyPerWorker: 200 + i, from: last, note: 'Synthetic race rate' })),
      ]);
      const inForce = await db.asUser('u-fd', async (svc, u) => (await svc.fwCostBoard(u)).rates!.history!.charge.filter((s) => s.from <= last).sort((a, b) => b.from.localeCompare(a.from) || b.at.localeCompare(a.at)));
      const live = (await db.pool.query("SELECT data FROM prima.fw_cost_charges WHERE data->>'month'=$1 AND data->>'status'<>'rejected' AND data->>'direction'='host_pays_fwm'", [last])).rows.map((x) => x.data);
      for (const c of live) assert.equal(c.rate, inForce[0].monthlyPerWorker, `run ${i}: charge ${c.id} priced at ${c.rate}`);
    }
  });

  it('the host company manager reads placements under its own job at the database boundary, and cannot change them', async () => {
    const arsh = await db.asUser('u-cm-arsh', (svc, u) => svc.fwCostBoard(u));
    const mine = arsh.placements.filter((p) => p.hostCompanyId === 'co-arsh');
    assert.ok(mine.length >= 1);
    assert.ok(mine.every((p) => p.person && p.person.name && p.note === '' && p.docIds.length === 0));
    assert.ok(!arsh.placements.some((p) => p.hostCompanyId !== 'co-arsh' && p.companyId !== 'co-arsh'));
    const inas = await db.asUser('u-cm-inas', (svc, u) => svc.fwCostBoard(u));
    assert.equal(inas.placements.length, 0);
    // Read only: the host's sign-in cannot update or insert an owner's placement row.
    await assert.rejects(db.asUser('u-cm-arsh', (_svc, _u, store) => store.update('fwPlacements', mine[0].id, { note: 'host edit' })));
    await assert.rejects(db.asUser('u-cm-arsh', (_svc, _u, store) => store.insert('fwPlacements', { ...mine[0], id: 'fwp-forged' })));
    // The owner's placement row and staff record stay out of the host's reach at the database: the host reads only
    // its own fw_placement_hosts rows, which cannot hold notes, papers or the recorder.
    assert.equal(await db.asUser('u-cm-arsh', (_svc, _u, store) => store.get('fwPlacements', mine[0].id)), undefined);
    assert.equal((await db.asUser('u-cm-arsh', (_svc, _u, store) => store.list('fwPlacements', {}))).filter((p) => p.companyId !== 'co-arsh').length, 0);
    assert.equal(await db.asUser('u-cm-arsh', (_svc, _u, store) => store.get('people', mine[0].personId)), undefined);
    const hv = await db.asUser('u-cm-arsh', (_svc, _u, store) => store.get('fwPlacementHosts', mine[0].id));
    assert.deepEqual(Object.keys(hv!).sort(), ['companyId', 'from', 'hostBranchId', 'id', 'ownerCompanyId', 'ownerName', 'personId', 'staffNo', 'to', 'workerName']);
    // Inserted directly (no update trigger in the way), any shape but the exact ten fields is refused.
    const bad = (patch: string, minus = '') =>
      db.pool.query(`INSERT INTO prima.fw_placement_hosts (id, company_id, data) SELECT 'fwp-shape', company_id, (data || jsonb_build_object('id','fwp-shape') || '${patch}'::jsonb)${minus} FROM prima.fw_placement_hosts WHERE id=$1`, [mine[0].id]);
    await assert.rejects(bad('{"note":"leak"}'), /fw_placement_hosts_shape/);
    await assert.rejects(db.asUser('u-cm-inas', (_svc, _u, store) => store.update('fwPlacementHosts', mine[0].id, { to: '2026-01-01' })));
    // Exact ten-field allowlist: an extra key or a missing key is refused at the database.
    await assert.rejects(bad('{"extra":1}'), /fw_placement_hosts_shape/);
    await assert.rejects(bad('{}', " - 'ownerName'"), /fw_placement_hosts_shape/);
    await bad('{}').then(() => db.pool.query("DELETE FROM prima.fw_placement_hosts WHERE id='fwp-shape'")); // the exact ten fields pass
    // The host's own sign-in reads its rows but cannot change or add them; only FWM writes, and only the last day, once.
    await assert.rejects(db.asUser('u-cm-arsh', (_svc, _u, store) => store.update('fwPlacementHosts', mine[0].id, { to: '2026-01-01' })));
    await assert.rejects(db.asUser('u-cm-arsh', (_svc, _u, store) => store.insert('fwPlacementHosts', { ...(hv as object), id: 'fwp-host-forged' } as never)));
    await assert.rejects(db.asUser('u-fwm-ex1', (_svc, _u, store) => store.update('fwPlacementHosts', mine[0].id, { workerName: 'Changed' } as never)), /only the last day/);
    const open = (await db.pool.query("SELECT id FROM prima.fw_placement_hosts WHERE company_id='co-arsh' AND data->'to' = 'null'::jsonb LIMIT 1")).rows[0]?.id;
    if (open) {
      await db.asUser('u-fwm-ex1', (_svc, _u, store) => store.update('fwPlacementHosts', open, { to: '2026-01-02' }));
      await assert.rejects(db.asUser('u-fwm-ex1', (_svc, _u, store) => store.update('fwPlacementHosts', open, { to: '2026-01-03' })), /only the last day/);
    }
  });

  it('only the CEO reads the CEO log; every other role\'s board response carries none of it', async () => {
    await db.asUser('u-fauzan', (svc, u) => svc.addFwCostLegalNote(u, { note: 'Synthetic CEO-only legal detail' }));
    for (const id of ['u-fd', 'u-fin-t1-lead', 'u-fwm-mgr', 'u-cm-arsh', 'u-cm-sasa']) {
      const text = JSON.stringify(await db.asUser(id, (svc, u) => svc.fwCostBoard(u)));
      assert.ok(!/Synthetic CEO-only legal detail|legalNotes|Private Agencies Act/.test(text), id);
      await assert.rejects(db.asUser(id, (svc, u) => svc.addFwCostLegalNote(u, { note: 'Not my log' })), id);
    }
    // Write responses too: the FD setting a rate gets the rate steps back, never the CEO's notes.
    const res = await db.asUser('u-fd', (svc, u) => svc.setFwCostRate(u, { kind: 'payback', monthlyPerWorker: 210, from: '2099-01', note: 'Synthetic future rate' }));
    assert.ok(!/Synthetic CEO-only legal detail|legalNotes/.test(JSON.stringify(res)));
    const ceo = await db.asUser('u-fauzan', (svc, u) => svc.fwCostBoard(u));
    assert.equal(ceo.legal?.notes[0].note, 'Synthetic CEO-only legal detail');
  });
});
