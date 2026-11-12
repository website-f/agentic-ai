import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, generateDataset, myt, vehicleTransferRole, vehicleUserOn, type User } from '../src';

// E6 (Fauzan, 11 Nov 2026): moving vehicles between group companies. Transport asks, a second Transport member or the
// COO approves with a comment (never the asker), Transport records the handover and only then the vehicle moves.
// Synthetic data only.
const TODAY = '2026-11-12';
const NOW = myt(TODAY, '10:00');

async function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  const u = async (id: string) => svc.user(id);
  const second: User = { id: 'u-transport-2', name: 'Synthetic Transport Two', title: 'Transport executive', role: 'pwvsb_officer', department: 'transport', companyIds: [], siteIds: [] };
  await store.insert('users', second);
  return {
    ds,
    store,
    svc,
    transport: await u('u-transport'),
    transport2: await u('u-transport-2'),
    coo: await u('u-coo'),
    ogm: await u('u-ogm'),
    fd: await u('u-fd'),
    cm: await u(ds.users.find((x) => x.role === 'company_manager')!.id),
    guard: await u(ds.users.find((x) => x.role === 'guard')!.id),
  };
}

describe('E6 vehicle moves between group companies', () => {
  it('asks, approves by someone else, and moves the vehicle only at the handover', async () => {
    const { ds, store, svc, transport, transport2, coo, ogm } = await setup();
    const other = ds.companies.find((c) => c.id !== 'co-sasa')!;
    const t = await svc.requestVehicleTransfer(transport, { vehicleId: 'veh-sasa-1', toCompanyId: other.id, wantedOn: '2026-11-15', reason: 'Needed for the new sites' });
    expect(t).toMatchObject({ status: 'requested', fromCompanyId: 'co-sasa', toCompanyId: other.id, companyId: 'co-sasa' });
    // Nothing moved yet.
    expect(vehicleUserOn((await store.get('vehicles', 'veh-sasa-1'))!, '2026-11-20')).toBe('co-sasa');
    // A second open move for the same vehicle is refused.
    await expect(svc.requestVehicleTransfer(transport2, { vehicleId: 'veh-sasa-1', toCompanyId: 'pgl', wantedOn: '2026-11-15', reason: 'Another move' })).rejects.toThrow(/already has an open move/);
    // The asker cannot approve their own request; the COO's board shows it to decide, the OGM only watches.
    await expect(svc.decideVehicleTransfer(transport, t.id, true, 'Fine by me')).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.vehicleTransferBoard(transport)).moves[0]).toMatchObject({ canDecide: false, mine: true });
    expect((await svc.vehicleTransferBoard(coo)).moves[0]).toMatchObject({ canDecide: true, canHandOver: false });
    expect((await svc.vehicleTransferBoard(ogm)).moves[0]).toMatchObject({ canDecide: false, canCancel: false });
    await expect(svc.decideVehicleTransfer(ogm, t.id, true, 'Watching only')).rejects.toBeInstanceOf(AccessDenied);
    // A comment is required.
    await expect(svc.decideVehicleTransfer(transport2, t.id, true, '')).rejects.toThrow(/comment/);
    const ok = await svc.decideVehicleTransfer(transport2, t.id, true, 'Checked with both companies');
    expect(ok).toMatchObject({ status: 'approved', decision: { approve: true, by: 'Synthetic Transport Two', role: 'transport' } });
    await expect(svc.decideVehicleTransfer(coo, t.id, false, 'Too late')).rejects.toThrow(/already decided/);
    // Handover: the COO watches but does not hand over; keys must be ticked; two different people.
    const ho = { on: TODAY, odometerKm: 48210, handedBy: 'Synthetic Driver A', receivedBy: 'Synthetic Supervisor B', condition: 'Good, small scratch rear bumper', items: ['keys', 'road_tax'] };
    await expect(svc.handOverVehicleTransfer(coo, t.id, ho)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.handOverVehicleTransfer(transport, t.id, { ...ho, items: ['road_tax'] })).rejects.toThrow(/keys/);
    await expect(svc.handOverVehicleTransfer(transport, t.id, { ...ho, receivedBy: 'synthetic driver a' })).rejects.toThrow(/two different people/);
    await expect(svc.handOverVehicleTransfer(transport, t.id, { ...ho, on: '2026-11-13' })).rejects.toThrow(/not in the future/);
    const done = await svc.handOverVehicleTransfer(transport, t.id, ho);
    expect(done).toMatchObject({ status: 'handed_over', handover: { odometerKm: 48210, items: ['keys', 'road_tax'] } });
    const v = (await store.get('vehicles', 'veh-sasa-1'))!;
    expect(v.companyId).toBe('co-sasa');
    expect(vehicleUserOn(v, '2026-11-11')).toBe('co-sasa');
    expect(vehicleUserOn(v, TODAY)).toBe(other.id);
    expect(v.usedBy?.at(-1)?.reason).toContain(t.ref);
    expect(v.log.at(-1)?.what).toContain('Synthetic Driver A to Synthetic Supervisor B');
    const audit = (await store.list('audit', {})).filter((a) => a.entityId === 'veh-sasa-1' && (a.action.startsWith('fleet.transfer') || a.action === 'fleet.move'));
    expect(audit.map((a) => a.action)).toEqual(['fleet.transfer.request', 'fleet.transfer.approve', 'fleet.move']);
    expect(audit[2].summary).toContain('Owner stays');
    // A handed-over move cannot be cancelled or handed over twice.
    await expect(svc.cancelVehicleTransfer(transport, t.id, 'Oops')).rejects.toThrow(/open move/);
    await expect(svc.handOverVehicleTransfer(transport, t.id, ho)).rejects.toThrow(/approved move/);
  });

  it('lets the COO approve or return, and Transport or the COO cancel with a reason', async () => {
    const { svc, transport, coo } = await setup();
    const a = await svc.requestVehicleTransfer(transport, { vehicleId: 'veh-sasa-1', toCompanyId: 'pgl', wantedOn: TODAY, reason: 'Back to the PGL yard' });
    const r = await svc.decideVehicleTransfer(coo, a.id, false, 'Keep it at Sasa until December');
    expect(r).toMatchObject({ status: 'returned', decision: { approve: false, role: 'coo' } });
    const b = await svc.requestVehicleTransfer(transport, { vehicleId: 'veh-sasa-1', toCompanyId: 'pgl', wantedOn: '2026-12-01', reason: 'Back to the PGL yard in December' });
    await expect(svc.cancelVehicleTransfer(coo, b.id, '')).rejects.toThrow(/reason/);
    expect(await svc.cancelVehicleTransfer(coo, b.id, 'Plan changed')).toMatchObject({ status: 'cancelled', cancelled: { reason: 'Plan changed' } });
  });

  it('refuses the wrong roles, bad input, and the old direct move', async () => {
    const { svc, transport, coo, fd, cm, guard } = await setup();
    for (const u of [coo, fd, cm, guard]) await expect(svc.requestVehicleTransfer(u, { vehicleId: 'veh-sasa-1', toCompanyId: 'pgl', wantedOn: TODAY, reason: 'Not Transport' })).rejects.toBeInstanceOf(AccessDenied);
    for (const u of [cm, guard]) await expect(svc.vehicleTransferBoard(u)).rejects.toBeInstanceOf(AccessDenied);
    expect(vehicleTransferRole(fd)).toBe('monitor');
    expect(vehicleTransferRole(cm)).toBeNull();
    await expect(svc.requestVehicleTransfer(transport, { vehicleId: 'veh-sasa-1', toCompanyId: 'co-sasa', wantedOn: TODAY, reason: 'Same company' })).rejects.toThrow(/already uses/);
    await expect(svc.requestVehicleTransfer(transport, { vehicleId: 'veh-sasa-1', toCompanyId: 'co-nope', wantedOn: TODAY, reason: 'Unknown company' })).rejects.toThrow(/Choose the company/);
    await expect(svc.requestVehicleTransfer(transport, { vehicleId: 'veh-sasa-1', toCompanyId: 'pgl', wantedOn: TODAY, reason: 'x' })).rejects.toThrow(/reason/);
    await expect(svc.requestVehicleTransfer(transport, { vehicleId: 'veh-sasa-1', toCompanyId: 'pgl', wantedOn: '2026-09-01', reason: 'Too far back' })).rejects.toThrow(/first day of last month/);
    await expect(svc.moveVehicleUse(transport, 'veh-sasa-1', { companyId: 'pgl', from: TODAY, reason: 'Direct' })).rejects.toThrow(/approved by someone else/);
    await expect(svc.moveVehicleUse(coo, 'veh-sasa-1', { companyId: 'pgl', from: TODAY, reason: 'Direct' })).rejects.toThrow(/Transport department/);
  });
});
