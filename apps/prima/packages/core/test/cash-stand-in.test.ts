import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService } from '../src';
import { ArrivalCashService } from '../src/arrival-cash';
import { fixture } from './cash-test-fixture';

// B2 (Fauzan, 11 Nov 2026): the FD can stand in for the CEO on cash when needed. Synthetic data only.
async function setup() {
  const x = await fixture();
  x.guard.nationality = 'NP';
  x.guard.bank = null;
  x.ds.credentials = x.ds.credentials.filter((c) => c.personId !== x.guard.id || c.type !== 'PLKS_PERMIT');
  const store = new MemoryStore(x.ds);
  const arrival = new ArrivalCashService(store, x.now);
  const svc = new PrimaService(store, x.now);
  const fwm = x.user('u-fwm-mgr');
  const act = (u: typeof fwm, a: string, b: Record<string, unknown>) => arrival.action(u, x.companyId, a, b);
  const r = await act(fwm, 'request', { personId: x.guard.id, siteId: x.site.id, arrivedOn: '2026-10-01', months: 3, amount: 300, requestId: 'request-1', purpose: 'Food while awaiting PLKS', awaitingPlks: true, withoutWages: true, recentArrivalConfirmed: true });
  const decide = (u: typeof fwm, reason = 'Synthetic decision while the CEO is away') => act(u, 'decide', { id: r.id, requestId: 'request-1', personId: x.guard.id, amount: 300, approved: true, reason });
  return { ...x, store, svc, act, r, decide, fwm };
}

describe('Finance Director cash stand-in (B2)', () => {
  it('arrival cash: off, the FD is refused; on for the dates, the FD decides with a reason and the CEO is told', async () => {
    const x = await setup();
    await expect(x.decide(x.fd)).rejects.toBeInstanceOf(AccessDenied);
    // Only the CEO turns it on, with a reason.
    await expect(x.svc.setCashStandIn(x.fd, { action: 'away', from: '2026-10-30', to: '2026-11-02', reason: 'FD tries to switch it on' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(x.svc.setCashStandIn(x.ceo, { action: 'away', from: '2026-10-30', to: '2026-11-02', reason: '' })).rejects.toThrow(/reason/);
    await x.svc.setCashStandIn(x.ceo, { action: 'away', from: '2026-10-30', to: '2026-11-02', reason: 'Abroad for the client visit' });
    const done = await x.decide(x.fd);
    expect(done.requests[0].decision).toMatchObject({ approved: true, byId: x.fd.id });
    expect(done.requests[0].decision!.standIn).toMatch(/CEO away 2026-10-30 to 2026-11-02/);
    const board = await x.svc.cashStandInBoard(x.ceo);
    expect(board.unseen).toHaveLength(1);
    expect(board.unseen[0]).toMatchObject({ kind: 'arrival', ref: 'request-1', byId: x.fd.id, amount: 300 });
    await x.svc.setCashStandIn(x.ceo, { action: 'seen', id: 'all' });
    expect((await x.svc.cashStandInBoard(x.ceo)).unseen).toHaveLength(0);
  });

  it('a named request: the FD decides that one only, once; ending the dates turns it off again', async () => {
    const x = await setup();
    await x.svc.setCashStandIn(x.ceo, { action: 'request', kind: 'arrival', companyId: x.companyId, ref: 'other-request', reason: 'Please decide that one for me' });
    await expect(x.decide(x.fd)).rejects.toBeInstanceOf(AccessDenied);
    await x.svc.setCashStandIn(x.ceo, { action: 'request', kind: 'arrival', companyId: x.companyId, ref: 'request-1', reason: 'Please decide this one for me' });
    await x.decide(x.fd);
    const board = await x.svc.cashStandInBoard(x.fd);
    expect(board.requests.map((r) => r.ref)).toEqual(['other-request']);
    const w = await x.svc.setCashStandIn(x.ceo, { action: 'away', from: '2026-10-31', to: '2026-10-31', reason: 'One day away' });
    await x.svc.setCashStandIn(x.ceo, { action: 'end', id: w.windows[0].id, reason: 'Back early' });
    expect((await x.svc.cashStandInBoard(x.ceo)).activeWindow).toBeNull();
  });

  it('exceptional guard cash: the FD may be the approver only while the stand-in covers it, with a reason', async () => {
    const x = await fixture();
    const svc = x.svc;
    const withFd = (tag: string, reason?: string) => {
      const b = x.body(tag);
      b.rows[0].approval = { ...b.rows[0].approval, byId: x.fd.id, ...(reason ? { reason } : {}) } as never;
      return b;
    };
    await expect(x.action(x.doa, 'submit', withFd('a', 'CEO away, FD approved by phone note'))).rejects.toThrow(/CEO/);
    await svc.setCashStandIn(x.ceo, { action: 'away', from: '2026-10-31', to: '2026-11-03', reason: 'Abroad for the client visit' });
    await expect(x.action(x.doa, 'submit', withFd('b'))).rejects.toThrow(/reason/);
    const [row] = await x.action(x.doa, 'submit', withFd('c', 'CEO away, FD approved by signed note'));
    expect(row.approval).toMatchObject({ byId: x.fd.id, reason: 'CEO away, FD approved by signed note' });
    expect(row.approval.standIn).toMatch(/CEO away/);
    // The approved row moves on to preparation as a CEO-approved one would.
    await x.action(x.finance, 'prepare', { id: row.id, ref: 'withdrawal-1', custodianId: x.finance.id });
    expect((await svc.cashStandInBoard(x.ceo)).unseen.map((u) => u.kind)).toEqual(['exceptional']);
  });
});
