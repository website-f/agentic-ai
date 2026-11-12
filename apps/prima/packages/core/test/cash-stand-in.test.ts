import { describe, expect, it } from 'vitest';
import { AccessDenied, cashDeciderStandIn, type MemoryStore } from '../src';
import { ArrivalCashService } from '../src/arrival-cash';
import { fixture } from './cash-test-fixture';

// P100 B2 (Fauzan, 11 Nov 2026: "the FD can stand in for the CEO when needed"). Synthetic data only.
async function setup() {
  const x = await fixture();
  x.guard.nationality = 'NP';
  x.ds.credentials = x.ds.credentials.filter((c) => c.personId !== x.guard.id || c.type !== 'PLKS_PERMIT');
  const store = (x.svc as unknown as { store: MemoryStore }).store;
  const arrival = new ArrivalCashService(store, x.now);
  const fwm = x.user('u-fwm-mgr');
  const act = (u: typeof fwm, a: string, b: Record<string, unknown>) => arrival.action(u, x.companyId, a, b);
  const r = await act(fwm, 'request', { personId: x.guard.id, siteId: x.site.id, arrivedOn: '2026-10-01', months: 3, amount: 300, requestId: 'request-1', purpose: 'Food while awaiting PLKS (test)', awaitingPlks: true, withoutWages: true, recentArrivalConfirmed: true });
  const decide = (u: typeof fwm, reason = 'Checked the arrival list (test)') => act(u, 'decide', { id: r.id, requestId: 'request-1', personId: x.guard.id, amount: 300, approved: true, reason });
  return { ...x, store, fwm, act, r, decide };
}

describe('P100 B2: the FD stands in for the CEO on cash decisions', () => {
  it('stand-in off: the FD is refused; the CEO turns it on for dates away; the FD decides with a reason and the CEO is told', async () => {
    const x = await setup();
    await expect(x.decide(x.fd)).rejects.toBeInstanceOf(AccessDenied);
    // Only the CEO turns it on, with a reason.
    await expect(x.svc.payAction(x.fd, 'cash-stand-in-set', { kind: 'dates', from: '2026-10-31', to: '2026-11-03', reason: 'Away (test)' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(x.svc.payAction(x.ceo, 'cash-stand-in-set', { kind: 'dates', from: '2026-10-31', to: '2026-11-03', reason: 'no' })).rejects.toThrow(/reason/i);
    const s = (await x.svc.payAction(x.ceo, 'cash-stand-in-set', { kind: 'dates', from: '2026-10-31', to: '2026-11-03', reason: 'Overseas trip (test)' })) as { id: string };
    await expect(x.decide(x.fd, '')).rejects.toThrow(/required|reason/i);
    const done = await x.decide(x.fd);
    expect(done.requests[0].decision?.byId).toBe(x.fd.id);
    expect(done.requests[0].decision?.reason).toMatch(/Standing in for the CEO/);
    const ceoView = (await x.svc.payView(x.ceo, 'cash-stand-in', {})) as { unseen: { ref: string }[]; onNow: boolean };
    expect(ceoView.onNow).toBe(true);
    expect(ceoView.unseen.map((u) => u.ref)).toEqual(['request-1']);
    await x.svc.payAction(x.ceo, 'cash-stand-in-seen', { id: s.id });
    expect(((await x.svc.payView(x.ceo, 'cash-stand-in', {})) as { unseen: unknown[] }).unseen).toHaveLength(0);
    // Ended early with a reason: the FD is refused again.
    await x.svc.payAction(x.ceo, 'cash-stand-in-end', { id: s.id, reason: 'Back early (test)' });
    expect(((await x.svc.payView(x.fd, 'cash-stand-in', {})) as { onNow: boolean }).onNow).toBe(false);
    // Nobody else sees or sets it.
    await expect(x.svc.payView(x.finance, 'cash-stand-in', {})).rejects.toBeInstanceOf(AccessDenied);
    await expect(x.svc.payAction(x.user('u-coo'), 'cash-stand-in-set', { kind: 'dates', from: '2026-10-31', to: '2026-10-31', reason: 'Not mine (test)' })).rejects.toBeInstanceOf(AccessDenied);
  });

  it('for one named request only, never a request the FD made, and exceptional guard cash the same way', async () => {
    const x = await setup();
    await x.svc.payAction(x.ceo, 'cash-stand-in-set', { kind: 'request', area: 'arrival', companyId: x.companyId, ref: 'request-other', reason: 'Decide that one for me (test)' });
    await expect(x.decide(x.fd)).rejects.toBeInstanceOf(AccessDenied);
    await x.svc.payAction(x.ceo, 'cash-stand-in-set', { kind: 'request', area: 'arrival', companyId: x.companyId, ref: 'request-1', reason: 'Decide this one for me (test)' });
    await x.decide(x.fd);
    // Never a request the FD made, even with a stand-in on.
    await expect(cashDeciderStandIn(x.store, x.fd, 'arrival', x.companyId, 'request-1', [x.fd.id], '2026-10-31')).rejects.toThrow(/You made this request/);
    // Exceptional guard cash: an FD approval without a stand-in for that day is refused; with one, it is kept labelled.
    const body = x.body('fd');
    const row = body.rows[0] as { approval: { byId: string; standInReason?: string } };
    row.approval.byId = x.fd.id;
    row.approval.standInReason = 'Standing in while the CEO travels (test)';
    await expect(x.action(x.doa, 'submit', body)).rejects.toThrow(/stand-in/);
    await x.svc.payAction(x.ceo, 'cash-stand-in-set', { kind: 'dates', from: '2026-10-31', to: '2026-10-31', reason: 'Away today (test)' });
    const ok = (await x.action(x.doa, 'submit', body))[0];
    expect(ok.approval.standIn?.reason).toMatch(/Standing in/);
  });
});
