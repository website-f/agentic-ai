import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, addDays, generateDataset, longMcDays, longestMc, myt, permitsOnMc } from '../src';

// E8 Foreign workers (Fauzan, 11 Nov 2026). Synthetic data only: the generated mock dataset.
const TODAY = '2026-11-12';
const NOW = myt(TODAY, '10:30');

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => NOW) };
}

let n = 0;
function paper() {
  n += 1;
  return { kind: 'document' as const, name: `Memo ${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 memo ${n}`).toString('base64')}` };
}

describe('E8 hostel stays and the check-out memo', () => {
  it('checks a worker in, refuses a second stay, and ends the stay only when the FWM Manager approves the memo', async () => {
    const { svc, ds } = fresh();
    const fwm = await svc.user('u-fwm-ex1');
    const mgr = await svc.user('u-fwm-mgr');
    const board = await svc.fwExtras.staysBoard(fwm);
    const h = board.hostels.find((x) => x.hostel.id === 'hs-sasa-klang')!;
    expect(h.residents).toBeGreaterThan(0);
    const newcomer = h.candidates[0];
    const inn = (await svc.fwExtras.act(fwm, 'check_in', { hostelId: h.hostel.id, personId: newcomer.id, from: TODAY, room: 'B2' })) as { id: string };
    await expect(svc.fwExtras.act(fwm, 'check_in', { hostelId: h.hostel.id, personId: newcomer.id, from: TODAY })).rejects.toThrow(/already has a hostel stay/);
    // The memo needs the signed copy and the reason for anything missing.
    const memo = { stayId: inn.id, outOn: addDays(TODAY, 3), reason: 'REPATRIATION', keyReturned: false, beddingReturned: true, lockerCleared: true, roomOk: true, damage: '', owedNote: '', workerAck: 'SIGNED' };
    await expect(svc.fwExtras.act(fwm, 'memo', { ...memo, proof: [paper()] })).rejects.toThrow(/not returned/);
    await expect(svc.fwExtras.act(fwm, 'memo', { ...memo, damage: 'Key lost (test)' })).rejects.toThrow(/Attach the memo/);
    await svc.fwExtras.act(fwm, 'memo', { ...memo, damage: 'Key lost (test)', owedNote: 'Key RM15 (test), for HR', proof: [paper()] });
    await expect(svc.fwExtras.act(fwm, 'memo', { ...memo, damage: 'Key lost (test)', proof: [paper()] })).rejects.toThrow(/already waiting/);
    // Wrong roles: the executive who prepared it cannot approve, nor can an FWM executive or HR.
    await expect(svc.fwExtras.act(fwm, 'memo_decide', { stayId: inn.id, approve: true, note: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.fwExtras.act(await svc.user('u-pwvsb-hr'), 'memo_decide', { stayId: inn.id, approve: true, note: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.fwExtras.act(mgr, 'memo_decide', { stayId: inn.id, approve: false, note: '' })).rejects.toThrow(/comment/);
    // FWM has its own board, not the Home dashboard: the reminder items are what the FWM screens and alerts show.
    expect((await svc.fwExtras.homeItems(mgr)).some((t) => /check-out memo/.test(t.title))).toBe(true);
    expect((await svc.fwExtras.homeItems(fwm)).some((t) => /check-out memo/.test(t.title))).toBe(false);
    const back = (await svc.fwExtras.act(mgr, 'memo_decide', { stayId: inn.id, approve: false, note: 'Witness signature missing' })) as { to: string | null };
    expect(back.to).toBeNull();
    await svc.fwExtras.act(fwm, 'memo', { ...memo, damage: 'Key lost (test)', workerAck: 'REFUSED', proof: [paper()] });
    const done = (await svc.fwExtras.act(mgr, 'memo_decide', { stayId: inn.id, approve: true, note: 'Signed by two witnesses' })) as { to: string | null };
    expect(done.to).toBe(addDays(TODAY, 3));
    expect(ds.audit.some((a) => a.action === 'hostel.checkout_approve')).toBe(true);
  });

  it('refuses a full hostel, a worker of another company, and people who do not keep hostels', async () => {
    const { svc, ds, store } = fresh();
    const fwm = await svc.user('u-fwm-ex1');
    const h = ds.hostels.find((x) => x.id === 'hs-sasa-klang')!;
    const other = ds.people.find((p) => p.companyId !== h.companyId && p.role === 'guard' && p.status === 'active')!;
    await expect(svc.fwExtras.act(fwm, 'check_in', { hostelId: h.id, personId: other.id, from: TODAY })).rejects.toThrow(/different companies/);
    const sup = ds.users.find((u) => u.role === 'supervisor' && u.companyIds.includes('co-sasa'))!;
    const free = (await svc.fwExtras.staysBoard(fwm)).hostels.find((x) => x.hostel.id === h.id)!.candidates[0];
    await expect(svc.fwExtras.act(sup, 'check_in', { hostelId: h.id, personId: free.id, from: TODAY })).rejects.toBeInstanceOf(AccessDenied);
    await store.update('hostels', h.id, { beds: (await svc.fwExtras.staysBoard(fwm)).hostels.find((x) => x.hostel.id === h.id)!.residents });
    await expect(svc.fwExtras.act(fwm, 'check_in', { hostelId: h.id, personId: free.id, from: TODAY })).rejects.toThrow(/full/);
  });
});

describe('E8 permit task during long SOCSO MC', () => {
  it('counts long MC from the day PERKESO pays (rule SOCSO-INJURY-MC) and finds the run of days', () => {
    expect(longMcDays()).toBe(4);
    expect(longestMc([{ from: '2026-11-01', to: '2026-11-03' }, { from: '2026-11-04', to: '2026-11-10' }])).toEqual({ days: 10, from: '2026-11-01', to: '2026-11-10' });
  });

  it('lists a Nepali worker on long MC whose PLKS comes due, and FWM sends the OM the task once', async () => {
    const { svc, ds, store } = fresh();
    const w = ds.people.find((p) => p.nationality === 'NP' && p.status === 'active' && p.companyId === 'co-sasa')!;
    // Synthetic: a PLKS expiring in 60 days and a SOCSO claim with MC from yesterday for 14 days.
    await store.insert('credentials', { id: 'cr-test-plks', companyId: w.companyId, personId: w.id, type: 'PLKS_PERMIT', number: 'TEST', issuedOn: TODAY, expiresOn: addDays(TODAY, 60) } as never);
    const claim = ds.socsoClaims.find((c) => c.companyId === 'co-sasa' && c.type === 'WORK_ACCIDENT')!;
    await store.update('socsoClaims', claim.id, { personId: w.id, status: 'UNDER_REVIEW', mcs: [{ from: addDays(TODAY, -1), to: addDays(TODAY, 12), docId: null }] });
    const rows = permitsOnMc([w], await store.list('socsoClaims', {}), await store.list('credentials', { personId: w.id }), [], TODAY);
    expect(rows.map((r) => r.paper)).toContain('PLKS_PERMIT');
    const fwm = await svc.user('u-fwm-ex1');
    const board = await svc.fwExtras.permitsBoard(fwm);
    const row = board.rows.find((r) => r.personId === w.id && r.paper === 'PLKS_PERMIT')!;
    expect(row.canSend).toBe(true);
    expect((await svc.fwExtras.homeItems(fwm)).some((t) => /long SOCSO MC need a permit task/.test(t.title))).toBe(true);
    // Wrong roles: the OM and the company manager cannot send it; the FWM despatch cannot either.
    await expect(svc.fwExtras.act(await svc.user('u-om-klang'), 'permit_task', { personId: w.id, paper: 'PLKS_PERMIT' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.fwExtras.act(await svc.user('u-cm-sasa'), 'permit_task', { personId: w.id, paper: 'PLKS_PERMIT' })).rejects.toBeInstanceOf(AccessDenied);
    const task = (await svc.fwExtras.act(fwm, 'permit_task', { personId: w.id, paper: 'PLKS_PERMIT' })) as { kind: string; what: string };
    expect(task.kind).toBe('PERMIT_ON_MC');
    expect(task.what).toMatch(/\[PLKS_PERMIT\]/);
    await expect(svc.fwExtras.act(fwm, 'permit_task', { personId: w.id, paper: 'PLKS_PERMIT' })).rejects.toThrow(/already open/);
    // A short MC (3 days) is sick leave, not long MC: nothing to send.
    await store.update('socsoClaims', claim.id, { mcs: [{ from: TODAY, to: addDays(TODAY, 2), docId: null }] });
    expect((await svc.fwExtras.permitsBoard(fwm)).rows.some((r) => r.personId === w.id)).toBe(false);
  });
});
