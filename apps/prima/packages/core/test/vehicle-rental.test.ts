import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt, rentInEffect, rentedAtMonthEnd, vehicleUserOn } from '../src';

// Vehicles rented from Perfect Global Logistics (Fauzan, 5 Nov 2026): Transport records, the FD or the CEO sets the
// rent with a reason, the OGM and the COO monitor. Synthetic data only.
const TODAY = '2026-11-05';
const NOW = myt(TODAY, '10:00');

async function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  const u = async (id: string) => svc.user(id);
  return { ds, store, svc, transport: await u('u-transport'), fd: await u('u-fd'), ceo: await u('u-fauzan'), coo: await u('u-coo'), ogm: await u('u-ogm') };
}

describe('vehicles rented from Perfect Global Logistics', () => {
  it('lets Transport record a rented vehicle with a reason, the FD or the CEO set the rent, and bills the month', async () => {
    const { store, svc, transport, fd, ceo } = await setup();
    await svc.recordVehicleRental(transport, 'veh-sasa-1', { ownerId: 'pgl', since: '2026-10-01', reason: 'Synthetic: moved to PGL fleet' });
    let r = await svc.vehicleRentals(fd, '2026-10');
    let row = r.vehicles.find((v) => v.vehicleId === 'veh-sasa-1')!;
    expect(row).toMatchObject({ ownerName: 'Perfect Global Logistics Sdn Bhd', billed: true, rent: null, amount: null });
    expect(r.bills.find((b) => b.companyId === 'co-sasa')).toMatchObject({ amount: null, unknownPlates: ['WXY 1234'] });
    await svc.setVehicleRent(fd, 'veh-sasa-1', { monthly: 2200, agreementRef: 'SYN-PGL-R1', reason: 'Rental agreement', from: '2026-10' });
    await svc.setVehicleRent(ceo, 'veh-sasa-1', { monthly: 2500, agreementRef: 'SYN-PGL-R2', reason: 'Addendum', from: '2026-12' });
    r = await svc.vehicleRentals(fd, '2026-10');
    expect(r.bills.find((b) => b.companyId === 'co-sasa')).toMatchObject({ ownerId: 'pgl', vehicles: 1, amount: 2200, unknownPlates: [] });
    row = r.vehicles.find((v) => v.vehicleId === 'veh-sasa-1')!;
    expect(row.later.map((l) => l.monthly)).toEqual([2500]);
    expect(row.changes.map((c) => c.reason)).toEqual(['Addendum', 'Rental agreement', 'Synthetic: moved to PGL fleet']);
    const v = (await store.get('vehicles', 'veh-sasa-1'))!;
    expect(rentInEffect(v.rental, '2026-11')?.monthly).toBe(2200);
    expect(rentInEffect(v.rental, '2027-01')?.monthly).toBe(2500);
    const audit = (await store.list('audit', {})).filter((a) => a.action.startsWith('fleet.ren'));
    expect(audit.map((a) => a.action)).toEqual(['fleet.rental', 'fleet.rent', 'fleet.rent']);
    expect(audit[1].summary).toBe('WXY 1234: Rent RM2200.00 a month from 2026-10 (agreement SYN-PGL-R1), was not set. Reason: Rental agreement');
  });

  it('bills a month only when the vehicle is still rented on its last day, and keeps earlier months after it ends', async () => {
    const { store, svc, transport, fd } = await setup();
    await svc.recordVehicleRental(transport, 'veh-sasa-1', { ownerId: 'pgl', since: '2026-10-15', reason: 'Synthetic' });
    await svc.setVehicleRent(fd, 'veh-sasa-1', { monthly: 1000, agreementRef: 'SYN', reason: 'Agreement', from: '2026-10' });
    await svc.endVehicleRental(transport, 'veh-sasa-1', { on: '2026-11-20', reason: 'Returned to PGL' });
    const v = (await store.get('vehicles', 'veh-sasa-1'))!;
    expect(rentedAtMonthEnd(v.rental, '2026-10')).toBe(true);
    expect(rentedAtMonthEnd(v.rental, '2026-11')).toBe(false);
    expect((await svc.vehicleRentals(fd, '2026-10')).bills[0]).toMatchObject({ amount: 1000 });
    expect((await svc.vehicleRentals(fd, '2026-11')).bills).toEqual([]);
    // A new rental must start after the last one ended.
    await expect(svc.recordVehicleRental(transport, 'veh-sasa-1', { ownerId: 'pgl', since: '2026-11-20', reason: 'Overlap' })).rejects.toThrow(/after the last one ended/);
    // Rented again later from the same company keeps the rent history, and October's bill does not change.
    await svc.recordVehicleRental(transport, 'veh-sasa-1', { ownerId: 'pgl', since: '2026-11-25', reason: 'Back on rent' });
    expect((await svc.vehicleRentals(fd, '2026-11')).bills[0]).toMatchObject({ amount: 1000 });
    expect((await svc.vehicleRentals(fd, '2026-10')).bills[0]).toMatchObject({ amount: 1000, ownerId: 'pgl' });
    // Rented next from another group company: the earlier months stay with Perfect Global Logistics.
    await svc.endVehicleRental(transport, 'veh-sasa-1', { on: '2026-11-30', reason: 'Back to PGL yard' });
    await svc.recordVehicleRental(transport, 'veh-sasa-1', { ownerId: 'goodwill', since: '2026-12-01', reason: 'Synthetic: Goodwill vehicle' });
    expect((await svc.vehicleRentals(fd, '2026-10')).bills[0]).toMatchObject({ ownerId: 'pgl', amount: 1000 });
    expect((await svc.vehicleRentals(fd, '2026-11')).bills[0]).toMatchObject({ ownerId: 'pgl', amount: 1000 });
    expect((await store.get('vehicles', 'veh-sasa-1'))!.rental!.past!.map((p) => p.since)).toEqual(['2026-10-15', '2026-11-25']);
  });

  it('refuses the wrong people, missing reasons, old dates and double rentals', async () => {
    const { ds, svc, transport, fd, ceo, coo, ogm } = await setup();
    const rec = { ownerId: 'pgl', since: '2026-11-01', reason: 'Synthetic' };
    for (const u of [fd, ceo, coo, ogm]) await expect(svc.recordVehicleRental(u, 'veh-sasa-1', rec)).rejects.toThrow(/Transport department/);
    await expect(svc.recordVehicleRental(transport, 'veh-sasa-1', { ...rec, reason: ' ' })).rejects.toThrow(/reason/);
    await expect(svc.recordVehicleRental(transport, 'veh-sasa-1', { ...rec, since: '2026-09-30' })).rejects.toThrow(/last month/);
    await expect(svc.recordVehicleRental(transport, 'veh-sasa-1', { ...rec, ownerId: 'co-nope' })).rejects.toThrow(/group company/);
    await expect(svc.recordVehicleRental(transport, 'veh-sasa-1', { ...rec, ownerId: 'co-sasa' })).rejects.toThrow(/Choose the group company|itself/);
    await expect(svc.setVehicleRent(fd, 'veh-sasa-1', { monthly: 100, agreementRef: 'X', reason: 'Too soon' })).rejects.toThrow(/not rented/);
    await svc.recordVehicleRental(transport, 'veh-sasa-1', rec);
    await expect(svc.recordVehicleRental(transport, 'veh-sasa-1', rec)).rejects.toThrow(/already rented/);
    const rent = { monthly: 900, agreementRef: 'SYN', reason: 'Agreement' };
    for (const u of [transport, coo, ogm]) await expect(svc.setVehicleRent(u, 'veh-sasa-1', rent)).rejects.toThrow(/Finance Director or the CEO/);
    await expect(svc.setVehicleRent(fd, 'veh-sasa-1', { ...rent, reason: '' })).rejects.toThrow(/reason/);
    await expect(svc.setVehicleRent(fd, 'veh-sasa-1', { ...rent, monthly: 0 })).rejects.toThrow(/monthly rent/);
    await expect(svc.setVehicleRent(fd, 'veh-sasa-1', { ...rent, from: '2026-09' })).rejects.toThrow(/last month/);
    await svc.setVehicleRent(fd, 'veh-sasa-1', rent);
    await expect(svc.setVehicleRent(ceo, 'veh-sasa-1', rent)).rejects.toThrow(/already the rent/);
    await expect(svc.endVehicleRental(fd, 'veh-sasa-1', { on: '2026-11-30', reason: 'X' })).rejects.toThrow(/Transport department/);
    await expect(svc.endVehicleRental(transport, 'veh-sasa-1', { on: '2026-10-31', reason: 'Before start' })).rejects.toThrow(/not before the rental started/);
    // Who sees rented vehicles: Transport, the FD, the CEO, the COO and the OGM; not an OM or a company manager.
    for (const u of [transport, fd, ceo, coo, ogm]) await svc.vehicleRentals(u);
    const cm = ds.users.find((u) => u.role === 'company_manager')!;
    for (const id of ['u-om-klang', cm.id]) await expect(svc.vehicleRentals(await svc.user(id))).rejects.toThrow(/Transport department, the OGM/);
    // Only Transport can start rentals; only the FD or the CEO set rents.
    expect((await svc.vehicleRentals(transport)).canRecord).toBe(true);
    expect((await svc.vehicleRentals(fd)).canSetRent).toBe(true);
    expect((await svc.vehicleRentals(coo))).toMatchObject({ canRecord: false, canSetRent: false, notRented: [] });
  });

  it('moves a vehicle owned by one company to another company\'s use; the rent follows the user at month end', async () => {
    const { ds, store, svc, transport, fd, coo } = await setup();
    const other = ds.companies.find((c) => c.id !== 'co-sasa')!;
    await svc.recordVehicleRental(transport, 'veh-sasa-1', { ownerId: 'pgl', since: '2026-10-01', reason: 'PGL manages it' });
    await svc.setVehicleRent(fd, 'veh-sasa-1', { monthly: 1500, agreementRef: 'SYN', reason: 'Agreement', from: '2026-10' });
    await svc.moveVehicleUse(transport, 'veh-sasa-1', { companyId: other.id, from: '2026-11-10', reason: 'Needed at their sites' });
    const v = (await store.get('vehicles', 'veh-sasa-1'))!;
    expect(v.companyId).toBe('co-sasa');
    expect(vehicleUserOn(v, '2026-11-09')).toBe('co-sasa');
    expect(vehicleUserOn(v, '2026-11-10')).toBe(other.id);
    // October stays with the owner company; November goes to the company using it on the 30th.
    expect((await svc.vehicleRentals(fd, '2026-10')).bills).toEqual([expect.objectContaining({ companyId: 'co-sasa', amount: 1500 })]);
    const nov = await svc.vehicleRentals(fd, '2026-11');
    expect(nov.bills).toEqual([expect.objectContaining({ companyId: other.id, amount: 1500 })]);
    expect(nov.vehicles[0]).toMatchObject({ ownedById: 'co-sasa', companyId: other.id });
    // Today (5 Nov) the owner still uses it: the move starts on the 10th.
    expect((await svc.fleetBoard(transport)).board.find((x) => x.id === 'veh-sasa-1')?.usedByName).toBeNull();
    const audit = (await store.list('audit', {})).filter((a) => a.action === 'fleet.move');
    expect(audit[0].summary).toContain('Reason: Needed at their sites');
    expect(audit[0].summary).toContain('Owner stays');
    // Refusals: not Transport, no reason, same company, not after the last move, old date, unknown company.
    for (const u of [fd, coo]) await expect(svc.moveVehicleUse(u, 'veh-sasa-1', { companyId: 'co-sasa', from: '2026-11-20', reason: 'X y z' })).rejects.toThrow(/Transport department/);
    await expect(svc.moveVehicleUse(transport, 'veh-sasa-1', { companyId: 'co-sasa', from: '2026-11-20', reason: '' })).rejects.toThrow(/reason/);
    await expect(svc.moveVehicleUse(transport, 'veh-sasa-1', { companyId: other.id, from: '2026-11-20', reason: 'Again' })).rejects.toThrow(/already uses/);
    await expect(svc.moveVehicleUse(transport, 'veh-sasa-1', { companyId: 'co-sasa', from: '2026-11-10', reason: 'Same day' })).rejects.toThrow(/after the last one/);
    await expect(svc.moveVehicleUse(transport, 'veh-sasa-1', { companyId: 'co-nope', from: '2026-11-20', reason: 'Nope' })).rejects.toThrow(/Choose the company/);
    // Moving back to the owner, or to a central company such as Perfect Global Logistics itself, works.
    await svc.moveVehicleUse(transport, 'veh-sasa-1', { companyId: 'pgl', from: '2026-11-28', reason: 'Back to the PGL yard' });
    expect((await svc.vehicleRentals(fd, '2026-11')).bills).toEqual([expect.objectContaining({ companyId: 'pgl', companyName: 'Perfect Global Logistics Sdn Bhd' })]);
  });

  it('employs the Transport department under Perfect Global Logistics', async () => {
    const { ds } = await setup();
    const t = ds.users.find((u) => u.id === 'u-transport')!;
    expect(ds.people.find((p) => p.id === t.personId)?.companyId).toBe('pgl');
  });
});
