import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, addDays, generateDataset, hostelCheckOutMemo, longMcPermitTask, myt } from '../src';

// E8 (Fitri package, Fauzan 11 Nov 2026): hostels and stays kept in Prima by FWM, the check-out memo, and the permit
// task while a worker is on long SOCSO MC. Synthetic data only: the generated mock dataset.
const TODAY = '2026-11-05';
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:00') });
  const svc = new PrimaService(new MemoryStore(ds), () => myt(TODAY, '10:00'));
  return { ds, svc };
};

describe('hostels in Prima (E8)', () => {
  it('FWM checks a worker in and out with the memo; others cannot', async () => {
    const { ds, svc } = fresh();
    const fwm = await svc.user('u-fwm-ex1');
    const h = { id: 'hs-sample-b', companyId: 'co-sasa', name: 'Sample hostel B (mock)', address: 'Sample road, Klang', beds: 1, tenure: 'RENTED' as const, sector: 'private' as const };
    ds.hostels.push(h);
    const free = ds.people.find((p) => p.companyId === 'co-sasa' && p.nationality === 'NP' && p.status === 'active' && !ds.hostelStays.some((s) => s.personId === p.id))!;
    const living = ds.hostelStays.find((s) => s.companyId === 'co-sasa' && !s.to)!;
    // One hostel at a time.
    await expect(svc.hostelCheckIn(fwm, { hostelId: h.id, personId: living.personId, from: TODAY })).rejects.toThrow(/check them out there first/);
    const stay = await svc.hostelCheckIn(fwm, { hostelId: h.id, personId: free.id, from: TODAY });
    // Never over the beds.
    const other = ds.people.find((p) => p.companyId === 'co-sasa' && p.nationality === 'NP' && p.status === 'active' && p.id !== free.id && !ds.hostelStays.some((s) => s.personId === p.id))!;
    await expect(svc.hostelCheckIn(fwm, { hostelId: h.id, personId: other.id, from: TODAY })).rejects.toThrow(/beds are taken/);
    // The company and an outsider cannot check anyone in or out.
    const cm = ds.users.find((u) => u.role === 'company_manager' && u.companyIds.includes('co-sasa'))!;
    await expect(svc.hostelCheckIn(await svc.user(cm.id), { hostelId: h.id, personId: other.id, from: TODAY })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.hostelCheckOut(await svc.user(cm.id), { stayId: stay.id, on: TODAY, reason: 'RESIGNED', keysReturned: true, roomCondition: 'clean', utilitiesSettled: true, belongings: 'none' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.hostelCheckOut(fwm, { stayId: stay.id, on: TODAY, reason: 'RESIGNED', keysReturned: false, roomCondition: 'okay', utilitiesSettled: true, belongings: '' })).rejects.toThrow(/belongings/);
    const out = await svc.hostelCheckOut(fwm, { stayId: stay.id, on: TODAY, reason: 'REPATRIATED', keysReturned: false, roomCondition: 'Clean, one chair broken', utilitiesSettled: false, belongings: 'none' });
    expect(out.to).toBe(TODAY);
    expect(out.checkOut!.openPoints).toEqual(['Keys not returned', 'Utility excess for the part month not yet worked out']);
    expect(out.checkOut!.text.ms).toMatch(/Memo keluar asrama/);
    await expect(svc.hostelCheckOut(fwm, { stayId: stay.id, on: TODAY, reason: 'OTHER', keysReturned: true, roomCondition: 'ok', utilitiesSettled: true, belongings: 'none' })).rejects.toThrow(/already checked out/);
    const board = await svc.hostelBoard(await svc.user(cm.id));
    expect(board.canManageStays).toBe(false);
    expect(board.stays.some((r) => r.stay.id === stay.id && r.stay.checkOut)).toBe(true);
    expect(board.openCheckOuts).toBeGreaterThan(0);
  });

  it('the memo lists belongings left as an open point, and none as nothing', () => {
    const base = { hostelName: 'H', personName: 'Sample Worker', staffNo: 'S1', from: '2026-10-01', on: '2026-11-01', reason: 'RESIGNED' as const, keysReturned: true, roomCondition: 'ok', utilitiesSettled: true };
    expect(hostelCheckOutMemo({ ...base, belongings: 'none' }).openPoints).toEqual([]);
    expect(hostelCheckOutMemo({ ...base, belongings: 'a suitcase' }).openPoints).toEqual(['Belongings left: a suitcase']);
    expect(hostelCheckOutMemo({ ...base, belongings: 'tiada' }).text.en).toMatch(/31 nights/);
  });
});

describe('permit task during long SOCSO MC (E8)', () => {
  it('flags papers running out during or soon after a long MC, and not for a short one', () => {
    const creds = [{ type: 'PLKS_PERMIT' as const, expiresOn: addDays(TODAY, 20) }, { type: 'PASSPORT' as const, expiresOn: addDays(TODAY, 400) }];
    const claim = (from: string, to: string) => ({ id: 'sc-1', personId: 'p', status: 'APPROVED' as const, mcs: [{ from, to, docId: null }] });
    expect(longMcPermitTask([claim(addDays(TODAY, -3), addDays(TODAY, 5))], creds, TODAY)).toBeNull();
    const t = longMcPermitTask([claim(addDays(TODAY, -10), addDays(TODAY, 30))], creds, TODAY)!;
    expect(t.mcDays).toBe(41);
    expect(t.papers).toEqual([{ paper: 'PLKS_PERMIT', expiresOn: addDays(TODAY, 20), beforeMcEnds: true }]);
    // A closed claim, or an MC that has ended, does not count.
    expect(longMcPermitTask([{ ...claim(addDays(TODAY, -10), addDays(TODAY, 30)), status: 'CLOSED' }], creds, TODAY)).toBeNull();
    expect(longMcPermitTask([claim(addDays(TODAY, -40), addDays(TODAY, -1))], creds, TODAY)).toBeNull();
  });

  it('shows on the FWM board with the MC end date only', async () => {
    const { ds, svc } = fresh();
    const np = ds.people.find((p) => p.companyId === 'co-sasa' && p.nationality === 'NP' && p.status === 'active')!;
    const tpl = ds.socsoClaims[0];
    ds.socsoClaims.push({ ...tpl, id: 'sc-long-mc', companyId: np.companyId, personId: np.id, status: 'UNDER_REVIEW', mcs: [{ from: addDays(TODAY, -7), to: addDays(TODAY, 21), docId: null }], closedAt: null });
    ds.credentials = ds.credentials.filter((c) => !(c.personId === np.id && c.type === 'PLKS_PERMIT'));
    ds.credentials.push({ id: 'cr-long-mc', companyId: np.companyId, personId: np.id, type: 'PLKS_PERMIT', number: 'UAT-1', issuedOn: '2025-12-01', expiresOn: addDays(TODAY, 40) });
    const board = await svc.fwmBoard(await svc.user('u-fwm-ex1'));
    const row = board.longMc.find((r) => r.person.id === np.id)!;
    expect(row.mcUntil).toBe(addDays(TODAY, 21));
    expect(row.papers.find((x) => x.paper === 'PLKS_PERMIT')).toMatchObject({ expiresOn: addDays(TODAY, 40), beforeMcEnds: false });
    expect(JSON.stringify(row)).not.toMatch(/description|diagnos/i);
  });
});
