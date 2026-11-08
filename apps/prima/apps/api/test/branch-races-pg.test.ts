// Cross-action races on the branch ledger (Arisha main, 4 Nov 2026). Each case pauses one request inside its save
// while holding its locks, starts the other, then lets the first finish, and runs in both orders. Synthetic seed data
// on a throwaway local PostgreSQL; DATABASE_URL must point at it.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { agreementOn, branchSplit, type PrimaService, type Store, type User } from '@prima/core';
import { Pool } from 'pg';
import { Db, nowMyt } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

/** The seed's Branch Manager of a branch: they prepare only their own branch's months (Fauzan, 4 Nov 2026). */
const bmOf = (branchId: string) => `u-bm-${branchId.slice(3)}`;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn` as `userId`, but hold its first save (store.transaction) until `release` resolves. `paused` resolves once
 * the request has done its reads and checks and is about to write, still holding every lock it took.
 */
function paused<R>(db: Db, userId: string, fn: (svc: PrimaService, u: User) => Promise<R>, release: Promise<void>) {
  let markPaused!: () => void;
  const at = new Promise<void>((r) => (markPaused = r));
  const run = db.asUser(userId, (svc, u, store: Store) => {
    const orig = store.transaction.bind(store);
    let first = true;
    store.transaction = (async (body: Parameters<Store['transaction']>[0]) => {
      if (first) {
        first = false;
        markPaused();
        await release;
      }
      return orig(body);
    }) as Store['transaction'];
    return fn(svc, u);
  });
  // A request refused before it reaches its save never pauses: let the caller go on.
  run.then(markPaused, markPaused);
  return { at, run };
}

/** The second request either finishes early (no lock held it back: the defect) or waits; give it time to show which. */
async function race<A, B>(first: (release: Promise<void>) => { at: Promise<void>; run: Promise<A> }, second: () => Promise<B>) {
  let open!: () => void;
  const release = new Promise<void>((r) => (open = r));
  const a = first(release);
  await a.at;
  const b = second();
  const early = await Promise.race([b.then(() => 'done', () => 'done'), wait(400).then(() => 'waiting')]);
  open();
  const [ra, rb] = await Promise.allSettled([a.run, b]);
  return { ra, rb, secondFinishedWhileFirstHeld: early === 'done' };
}

describe('branch ledger cross-action races on PostgreSQL', () => {
  let db: Db;
  let fin: string;
  let period: string;
  let pick: { branchId: string; siteId: string }[];
  // Model B (salaried) branches: a month carries the Branch Manager's salary line at the signed amount.
  const salaried = new Map<string, number>();
  before(async () => {
    await resetDb(URL);
    db = new Db();
    const today = nowMyt().slice(0, 10);
    const [y, m] = today.slice(0, 7).split('-').map(Number);
    // Months well before the seeded ones, so every case starts from no month at all.
    period = `${m <= 6 ? y - 1 : y}-${String(((m - 7 + 12) % 12) + 1).padStart(2, '0')}`;
    const s = await db.asUser('u-fauzan', async (_svc, _u, store) => {
      const st = (await store.list('finStatus', { companyId: ['co-sasa'] }))[0];
      const users = await store.list('users', {});
      const finId = users.filter((x) => x.department === 'finance' && x.financeTeam === st.team).map((x) => x.id)[0];
      const contracts = await store.list('contracts', { companyId: ['co-sasa'] });
      const sites = await store.list('sites', { companyId: ['co-sasa'] });
      const branches = await store.list('branches', { companyId: ['co-sasa'] });
      const out: { branchId: string; siteId: string }[] = [];
      for (const b of branches.filter((x) => x.status !== 'proposed' && x.status !== 'closed')) {
        const site = sites.find((x) => x.branchId === b.id && contracts.some((c) => c.state === 'active' && c.siteIds.includes(x.id)));
        if (site) out.push({ branchId: b.id, siteId: site.id });
        const a = (b.agreements ?? []).at(-1);
        if (a?.model === 'B' && a.managerSalary != null) salaried.set(b.id, a.managerSalary);
      }
      return { finId, out };
    });
    fin = s.finId;
    pick = s.out;
    assert.ok(pick.length >= 3, 'the synthetic seed has three working branches with a signed site');
    for (const [i, p] of pick.slice(0, 3).entries()) await db.asUser(fin, (svc, u) => svc.setBranchProjectCode(u, p.branchId, `RACE-${i}`));
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  const lines = (siteId: string, invoice: string, billing: number) => {
    const branchId = pick.find((x) => x.siteId === siteId)?.branchId ?? '';
    return [
      { kind: 'billing', ref: invoice, siteId, amount: billing },
      { kind: 'wages', ref: 'PAY-RACE', amount: 10_000 },
      ...(salaried.has(branchId) ? [{ kind: 'manager_salary', ref: 'PAY-RACE-BM', amount: salaried.get(branchId)! }] : []),
    ];
  };

  for (const order of ['preparation first', 'approval first'] as const) {
    it(`preparation and approval of one month never leave an approved month with changed billing (${order})`, async () => {
      const p = pick[0];
      const month = order === 'preparation first' ? period : prevOf(period);
      const prep = (billing: number) => (svc: PrimaService, u: User) =>
        svc.prepareBranchSettlement(u, p.branchId, { period: month, payrollRef: 'JA-RACE', lines: lines(p.siteId, `IV-RACE-${order}-${billing}`, billing) });
      const draft = await db.asUser(bmOf(p.branchId), prep(40_000));
      const approve = (svc: PrimaService, u: User) => svc.approveBranchSettlement(u, draft.id, 'Checked the draft');
      const r =
        order === 'preparation first'
          ? await race((rel) => paused(db, bmOf(p.branchId), prep(55_000), rel), () => db.asUser('u-cm-sasa', approve))
          : await race((rel) => paused(db, 'u-cm-sasa', approve, rel), () => db.asUser(bmOf(p.branchId), prep(55_000)));
      assert.equal(r.secondFinishedWhileFirstHeld, false, 'the second request waited for the first');
      const cur = await db.asUser('u-cm-sasa', async (_svc, _u, store) => (await store.get('branchSettlements', draft.id))!);
      const billing = cur.lines!.filter((l) => l.kind === 'billing').reduce((t, l) => t + l.amount, 0);
      if (order === 'preparation first') {
        // The correction committed first; the approval then approved the corrected month.
        assert.equal(r.ra.status, 'fulfilled');
        assert.equal(cur.status, 'approved');
        assert.equal(billing, 55_000);
        const steps = cur.steps!.map((s) => s.what);
        assert.ok(steps.lastIndexOf('approved') > Math.max(steps.lastIndexOf('corrected'), steps.lastIndexOf('prepared')));
      } else {
        // The approval committed first; the preparation is refused and the approved figures stay.
        assert.equal(r.ra.status, 'fulfilled');
        assert.equal(r.rb.status, 'rejected');
        assert.match(String((r.rb as PromiseRejectedResult).reason), /already approved/);
        assert.equal(cur.status, 'approved');
        assert.equal(billing, 40_000);
      }
    });
  }

  for (const order of ['A first', 'B first'] as const) {
    it(`one invoice number cannot be taken by two branches at once (${order})`, async () => {
      const [x, y] = order === 'A first' ? [pick[1], pick[2]] : [pick[2], pick[1]];
      const invoice = `IV-SHARED-${order}`;
      const prep = (q: { branchId: string; siteId: string }) => (svc: PrimaService, u: User) =>
        svc.prepareBranchSettlement(u, q.branchId, { period: prevOf(prevOf(order === 'A first' ? period : prevOf(period))), payrollRef: 'JA-RACE', lines: lines(q.siteId, invoice, 20_000) });
      const r = await race((rel) => paused(db, bmOf(x.branchId), prep(x), rel), () => db.asUser(bmOf(y.branchId), prep(y)));
      assert.equal(r.secondFinishedWhileFirstHeld, false, 'the second branch waited for the first');
      assert.equal(r.ra.status, 'fulfilled');
      assert.equal(r.rb.status, 'rejected');
      assert.match(String((r.rb as PromiseRejectedResult).reason), /already in/);
      const holders = await db.asUser('u-cm-sasa', async (_svc, _u, store) =>
        (await store.list('branchSettlements', { companyId: ['co-sasa'] })).filter((s) => (s.lines ?? []).some((l) => l.ref.toUpperCase() === invoice.toUpperCase())),
      );
      assert.equal(holders.length, 1);
    });
  }

  for (const order of ['A first', 'B first'] as const) {
    it(`one SQL project code cannot be set on two branches at once (${order})`, async () => {
      const [x, y] = order === 'A first' ? [pick[0], pick[1]] : [pick[1], pick[0]];
      const code = `RACE-CODE-${order === 'A first' ? 'A' : 'B'}`;
      const set = (q: { branchId: string }) => (svc: PrimaService, u: User) => svc.setBranchProjectCode(u, q.branchId, code);
      const r = await race((rel) => paused(db, fin, set(x), rel), () => db.asUser(fin, set(y)));
      assert.equal(r.secondFinishedWhileFirstHeld, false, 'the second branch waited for the first');
      assert.equal(r.ra.status, 'fulfilled');
      assert.equal(r.rb.status, 'rejected');
      assert.match(String((r.rb as PromiseRejectedResult).reason), /already uses project code/);
      const using = await db.asUser('u-cm-sasa', async (_svc, _u, store) => (await store.list('branches', { companyId: ['co-sasa'] })).filter((b) => b.setup?.sqlProjectCode === code));
      assert.equal(using.length, 1);
    });
  }
  it('approving an older draft month checks that month\'s own holds and split (Arisha main, 4 Nov 2026)', async () => {
    const p = pick[0];
    const month = prevOf(prevOf(prevOf(prevOf(period))));
    const draft = await db.asUser(bmOf(p.branchId), (svc, u) =>
      svc.prepareBranchSettlement(u, p.branchId, { period: month, payrollRef: 'JA-RACE', lines: lines(p.siteId, `IV-OLD-${month}`, 30_000) }),
    );
    // The board shows only the latest month of this branch, not this older draft.
    const board = await db.asUser('u-cm-sasa', (svc, u) => svc.branchBoard(u));
    assert.notEqual(board.rows.find((r) => r.branch.id === p.branchId)!.settlement?.id, draft.id);
    // A company hold (bank not reconciled), set directly in the synthetic database.
    const admin = new Pool({ connectionString: URL });
    const banks = (await admin.query(`SELECT data->'banks' AS b FROM prima.fin_status WHERE company_id = 'co-sasa'`)).rows[0].b;
    await admin.query(`UPDATE prima.fin_status SET data = jsonb_set(data, '{banks}', $1::jsonb) WHERE company_id = 'co-sasa'`, [
      JSON.stringify(banks.map((b: Record<string, unknown>) => ({ ...b, reconciledTo: '2020-01-31' }))),
    ]);
    try {
      await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.approveBranchSettlement(u, draft.id, 'Older month')), /Held: .*not reconciled/);
    } finally {
      await admin.query(`UPDATE prima.fin_status SET data = jsonb_set(data, '{banks}', $1::jsonb) WHERE company_id = 'co-sasa'`, [JSON.stringify(banks)]);
      await admin.end();
    }
    const ok = await db.asUser('u-cm-sasa', (svc, u) => svc.approveBranchSettlement(u, draft.id, 'Older month, holds cleared'));
    assert.equal(ok.status, 'approved');
    const summary = await db.asUser('u-fauzan', async (_svc, _u, store) => (await store.list('audit', {})).find((a) => a.entityId === draft.id && a.action === 'branch.settlement')!.summary);
    assert.doesNotMatch(summary, /undefined|NaN/);
    assert.match(summary, /company RM\d/);
  });

  for (const order of ['approval first', 'agreement first'] as const) {
    it(`a new agreement and an approval of the same branch go one after the other (${order})`, async () => {
      const p = order === 'approval first' ? pick[1] : pick[2];
      const month = prevOf(prevOf(prevOf(prevOf(prevOf(period)))));
      // The seed has settled later months on every branch, which would refuse any back-dated agreement; clear this
      // branch's settled seed months in the synthetic database so the race itself decides the outcome.
      const admin = new Pool({ connectionString: URL });
      await admin.query(`DELETE FROM prima.branch_settlements WHERE company_id = 'co-sasa' AND data->>'branchId' = $1 AND data->>'status' IN ('approved', 'validated', 'paid')`, [p.branchId]);
      await admin.end();
      const draft = await db.asUser(bmOf(p.branchId), (svc, u) =>
        svc.prepareBranchSettlement(u, p.branchId, { period: month, payrollRef: 'JA-RACE', lines: lines(p.siteId, `IV-AGR-${order}`, 40_000) }),
      );
      const agreement = (svc: PrimaService, u: User) =>
        svc.addBranchAgreement(u, p.branchId, { effectiveFrom: `${month}-01`, model: 'A', managerName: 'Synthetic Manager', managerKind: 'employee', pct: 70, managerSalary: null, signedRef: `AGR-RACE-${order}` });
      const approve = (svc: PrimaService, u: User) => svc.approveBranchSettlement(u, draft.id, 'Checked the split');
      const r =
        order === 'approval first'
          ? await race((rel) => paused(db, 'u-cm-sasa', approve, rel), () => db.asUser('u-cm-sasa', agreement))
          : await race((rel) => paused(db, 'u-cm-sasa', agreement, rel), () => db.asUser('u-cm-sasa', approve));
      assert.equal(r.secondFinishedWhileFirstHeld, false, 'the second request waited for the first');
      assert.equal(r.ra.status, 'fulfilled');
      const { branch, settlement, summary } = await db.asUser('u-fauzan', async (_svc, _u, store) => ({
        branch: (await store.get('branches', p.branchId))!,
        settlement: (await store.get('branchSettlements', draft.id))!,
        summary: (await store.list('audit', {})).find((a) => a.entityId === draft.id && a.action === 'branch.settlement')!.summary,
      }));
      if (order === 'approval first') {
        // The month was approved first, so the back-dated agreement is refused.
        assert.equal(r.rb.status, 'rejected');
        assert.match(String((r.rb as PromiseRejectedResult).reason), /already settled/);
      } else assert.equal(r.rb.status, 'fulfilled');
      // Whatever the order, the approval recorded the split of the agreement in force for the month now.
      const split = branchSplit(agreementOn(branch.agreements, `${month}-28`), settlement);
      assert.match(summary, new RegExp(`company RM${split.companyShare.toFixed(2)}, manager RM${split.managerShare.toFixed(2)}`));
    });
  }
});

function prevOf(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
