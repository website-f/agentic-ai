import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt, offlinePayloadHash, type AuditEntry, type ItJob } from '../src';

// Offline work on staff-controlled devices, synced later (Fauzan, 31 Oct 2026). Dummy data only.
const TODAY = '2026-10-31';
const START = myt(TODAY, '10:00');

function fresh(allowed?: string[]) {
  const ds = generateDataset({ today: TODAY, now: START });
  const clock = { now: START };
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => clock.now);
  const job = ds.itJobs.find((j) => j.status === 'doing') as ItJob;
  const doer = job.assigneeId;
  const otherId = ['u-it-ex2', 'u-it-ex3', 'u-it-ex4'].find((id) => id !== doer)!;
  return { ds, store, svc, clock, job, doer, otherId, offline: svc.offlineSync(allowed ?? [doer, otherId]) };
}

const help = (title = 'UAT printer on floor 2 offline') => ({ title, category: 'DEVICE', priority: 'P2', detail: 'UAT detail' });
const op = (kind: string, payload: unknown, opId: string = crypto.randomUUID()) => ({ opId, kind, createdAt: '2026-10-31T09:00:00+08:00', payload });
/** Each operation carries the lease it was saved under (unless it already names one). */
const batch = (leaseId: string, ops: Record<string, unknown>[]) => ({ ops: ops.map((o) => ({ leaseId, ...o })) });

describe('offline sync', () => {
  it('is for allowed staff only: not others, not integrations, not shared site devices', async () => {
    const { svc, offline, doer } = fresh();
    for (const id of ['u-fauzan', 'u-coo', 'u-it-mgr']) {
      const u = await svc.user(id);
      await expect(offline.lease(u, { deviceLabel: 'UAT phone' })).rejects.toThrow(/not switched on for you/);
      await expect(offline.sync(u, batch('x', [op('helpRequest', help())]))).rejects.toThrow(/not switched on for you/);
    }
    const me = await svc.user(doer);
    const off = fresh([]).offline;
    await expect(off.lease(me, { deviceLabel: 'UAT phone' })).rejects.toThrow(/not switched on/);
    await expect(svc.offlineSync([doer]).lease({ ...me, integration: 'ja' } as never, { deviceLabel: 'UAT phone' })).rejects.toThrow(/not switched on/);
    await expect(svc.offlineSync([doer]).lease({ ...me, role: 'site_device' } as never, { deviceLabel: 'UAT phone' })).rejects.toThrow(/not switched on/);
  });

  it('applies a help request once; a retry after a lost answer returns the same receipt', async () => {
    const { store, svc, offline, doer, clock } = fresh();
    const me = await svc.user(doer);
    const lease = await offline.lease(me, { deviceLabel: 'UAT phone' });
    expect(Date.parse(lease.expiresAt) - Date.parse(lease.issuedAt)).toBe(72 * 3_600_000);
    const one = op('helpRequest', help());
    clock.now = myt(TODAY, '15:00');
    const first = await offline.sync(me, batch(lease.id, [one]));
    expect(first.receipts[0]).toMatchObject({ status: 'applied', replayed: false });
    const t = await store.get('itTickets', first.receipts[0].resultId!);
    expect(t).toMatchObject({ raisedById: doer, offlineOpId: one.opId, at: myt(TODAY, '15:00') });
    // The answer was lost: ask for the receipt, then send again; nothing is created twice.
    expect((await offline.receipts(me, { opIds: [one.opId] }))[0]).toMatchObject({ status: 'applied', resultId: t!.id });
    const again = await offline.sync(me, batch(lease.id, [JSON.parse(JSON.stringify(one))]));
    expect(again.receipts[0]).toMatchObject({ status: 'applied', resultId: t!.id, replayed: true });
    expect((await store.list('itTickets', {})).filter((x) => x.offlineOpId === one.opId)).toHaveLength(1);
    // The same ID with different content is refused, not applied.
    const reused = await offline.sync(me, batch(lease.id, [{ ...one, payload: help('Something else') }]));
    expect(reused.receipts[0]).toMatchObject({ status: 'conflict', reason: 'op_id_reused' });
    expect((await store.list('itTickets', {})).filter((x) => x.title === 'Something else')).toHaveLength(0);
  });

  it('counts the 72 hours on the server clock: late work is refused but stays on the device to review', async () => {
    const { store, svc, offline, doer, clock } = fresh();
    const me = await svc.user(doer);
    const lease = await offline.lease(me, { deviceLabel: 'UAT phone' });
    clock.now = myt('2026-11-03', '10:00');
    const late = op('helpRequest', help());
    // The device clock says it was saved in time; only the server's time counts.
    late.createdAt = myt(TODAY, '11:00');
    const out = await offline.sync(me, batch(lease.id, [late]));
    expect(out.receipts[0]).toMatchObject({ status: 'rejected', reason: 'lease_expired', resultId: null });
    expect((await store.list('itTickets', {})).filter((x) => x.offlineOpId === late.opId)).toHaveLength(0);
    // Its ID stays used for good: sending it again later, even under a new lease, never runs it.
    const fresh2 = await offline.lease(me, { deviceLabel: 'UAT phone' });
    const replay = await offline.sync(me, batch(fresh2.id, [late]));
    expect(replay.receipts[0]).toMatchObject({ status: 'rejected', reason: 'lease_expired', replayed: true });
  });

  it('binds each operation to the lease it was saved under: a newer lease never extends older work', async () => {
    const { store, svc, offline, doer, clock } = fresh();
    const me = await svc.user(doer);
    const old = await offline.lease(me, { deviceLabel: 'UAT phone' });
    clock.now = myt('2026-11-02', '10:00');
    const newer = await offline.lease(me, { deviceLabel: 'UAT phone' });
    clock.now = myt('2026-11-03', '10:30');
    // Saved under the old lease, never sent before, and sent after it ended while the newer one is still open.
    const unseen = { ...op('helpRequest', help('UAT unseen old work')), leaseId: old.id };
    const out = await offline.sync(me, { ops: [unseen, { ...op('helpRequest', help('UAT current work')), leaseId: newer.id }] });
    expect(out.receipts.map((r) => [r.status, r.reason])).toEqual([['rejected', 'lease_expired'], ['applied', null]]);
    expect((await store.list('itTickets', {})).filter((x) => x.offlineOpId === unseen.opId)).toHaveLength(0);
    // Each operation must name its lease; the batch-level lease of the first draft is refused.
    await expect(offline.sync(me, { leaseId: newer.id, ops: [op('helpRequest', help())] })).rejects.toThrow(/Send the operations/);
    await expect(offline.sync(me, { ops: [op('helpRequest', help())] })).rejects.toThrow(/lease it was saved under/);
  });

  it('another account cannot use someone else\'s lease, and an access closed since is refused', async () => {
    const { store, svc, offline, doer, otherId } = fresh();
    const me = await svc.user(doer);
    const other = await svc.user(otherId);
    const lease = await offline.lease(me, { deviceLabel: 'UAT shared laptop' });
    const out = await offline.sync(other, batch(lease.id, [op('helpRequest', help())]));
    expect(out.receipts[0]).toMatchObject({ status: 'rejected', reason: 'lease_not_valid' });
    // Revoked: the IT role is taken away before the device syncs a job note.
    const job = (await store.list('itJobs', {})).find((j) => j.assigneeId === doer && j.status === 'doing')!;
    await store.update('users', doer, { department: 'finance', itRole: undefined } as never);
    const revoked = await svc.user(doer);
    const note = await offline.sync(revoked, batch(lease.id, [op('jobNote', { targetId: job.id, baseVersion: job.log.length, note: 'UAT note' })]));
    expect(note.receipts[0]).toMatchObject({ status: 'rejected', reason: 'not_allowed' });
    expect((await store.get('itJobs', job.id))!.log.length).toBe(job.log.length);
  });

  it('holds a likely duplicate and a changed job for the person to decide; never created or appended blindly', async () => {
    const { store, svc, offline, doer, job, otherId } = fresh();
    const me = await svc.user(doer);
    const lease = await offline.lease(me, { deviceLabel: 'UAT phone' });
    await svc.raiseItTicket(me, { category: 'DEVICE', priority: 'P2', title: 'UAT printer on floor 2 offline', detail: '' });
    const dup = op('helpRequest', help('UAT Printer on floor 2 OFFLINE!'));
    const stale = op('jobNote', { targetId: job.id, baseVersion: job.log.length - 1, note: 'UAT stale note' });
    const ok = op('jobNote', { targetId: job.id, baseVersion: job.log.length, note: 'UAT current note' });
    const before = (await store.list('itTickets', {})).length;
    const out = await offline.sync(me, batch(lease.id, [dup, stale, ok]));
    expect(out.receipts.map((r) => [r.status, r.reason])).toEqual([
      ['needs_review', 'duplicate_suspected'],
      ['needs_review', 'job_changed'],
      ['applied', null],
    ]);
    expect((await store.list('itTickets', {})).length).toBe(before);
    const log = (await store.get('itJobs', job.id))!.log;
    expect(log.map((l) => l.note)).toContain('UAT current note');
    expect(log.map((l) => l.note)).not.toContain('UAT stale note');
    // The person sends the duplicate anyway (same content only) and discards the stale note. Each once.
    await expect(offline.resolve(me, dup.opId, { action: 'send', payload: help('different') })).rejects.toThrow(/not the content/);
    const sent = await offline.resolve(me, dup.opId, { action: 'send', payload: dup.payload });
    expect(sent).toMatchObject({ status: 'applied' });
    expect((await store.list('itTickets', {})).length).toBe(before + 1);
    await expect(offline.resolve(me, dup.opId, { action: 'send', payload: dup.payload })).rejects.toThrow(/already applied/);
    expect(await offline.resolve(me, stale.opId, { action: 'discard' })).toMatchObject({ status: 'discarded' });
    await expect(offline.resolve(me, stale.opId, { action: 'send', payload: stale.payload })).rejects.toThrow(/already discarded/);
    // Nobody else decides your held work.
    const other = await svc.user(otherId);
    await expect(offline.resolve(other, dup.opId, { action: 'discard' })).rejects.toThrow(/not found/);
  });

  it('refuses bad batches whole, and bad content per operation, with codes only in the audit', async () => {
    const { store, svc, offline, doer } = fresh();
    const me = await svc.user(doer);
    const lease = await offline.lease(me, { deviceLabel: 'UAT phone' });
    const one = op('helpRequest', help());
    await expect(offline.sync(me, batch(lease.id, [one, one]))).rejects.toThrow(/twice/);
    await expect(offline.sync(me, batch(lease.id, Array.from({ length: 51 }, () => op('helpRequest', help()))))).rejects.toThrow(/1 to 50/);
    await expect(offline.sync(me, batch(lease.id, [{ ...one, opId: 'abc' }]))).rejects.toThrow(/UUID v4/);
    const out = await offline.sync(
      me,
      batch(lease.id, [op('helpRequest', { ...help(), extra: 1 }), op('deleteEverything', {}), op('jobNote', { targetId: 'itj-nope', baseVersion: 0, note: 'x' })]),
    );
    expect(out.receipts.map((r) => r.reason)).toEqual(['bad_payload', 'bad_payload', 'not_found']);
    const lines = (await store.list('audit', {})).filter((e: AuditEntry) => e.entity === 'offline_op');
    expect(lines).toHaveLength(3);
    for (const e of lines) expect(e.summary).not.toMatch(/UAT|printer|floor/);
    expect(offlinePayloadHash('helpRequest', { b: 1, a: 2 })).toBe(offlinePayloadHash('helpRequest', { a: 2, b: 1 }));
  });
});
