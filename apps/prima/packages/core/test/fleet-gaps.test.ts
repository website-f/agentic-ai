import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt } from '../src';

// Transport check gaps (Fauzan, 23 Nov 2026: "Do the gap"). Synthetic data only.
const TODAY = '2026-11-23';
const NOW = myt(TODAY, '10:00');
const DOC = [{ kind: 'document' as const, name: 'paper.pdf', data: 'data:application/pdf;base64,JVBERi0xLjQK' }];
const DOC2 = [{ kind: 'document' as const, name: 'paper2.pdf', data: 'data:application/pdf;base64,JVBERi0xLjUK' }];
const DOC3 = [{ kind: 'document' as const, name: 'paper3.pdf', data: 'data:application/pdf;base64,JVBERi0xLjYK' }];
const doc = (n: number) => [{ kind: 'document' as const, name: `p${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-${n}`).toString('base64')}` }];

async function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  const u = async (id: string) => svc.user(id);
  return { ds, store, svc, transport: await u('u-transport'), ogm: await u('u-ogm'), coo: await u('u-coo'), staff: await u('u-it-lead'), cos: await u('u-cos') };
}

describe('Transport and fleet gaps', () => {
  it('gap 1: the OGM sees the full Vehicles board, read only', async () => {
    const { svc, ogm } = await setup();
    const b = await svc.fleetBoard(ogm);
    expect(b.role).toBe('leader');
    expect(b.board.length).toBeGreaterThan(0);
    expect(b.ogm).toBe(true);
    await expect(svc.vehicleIn(ogm, 'veh-pwvsb-1', 41_100, '')).rejects.toThrow(/Transport/);
  });

  it('gap 2: nobody decides their own request; the OGM decides a Transport person\'s own', async () => {
    const { svc, transport, ogm, staff } = await setup();
    const own = await svc.requestVehicle(transport, { purpose: 'Collect parts', from: myt(TODAY, '14:00'), to: myt(TODAY, '16:00') });
    await expect(svc.decideVehicleRequest(transport, own.id, true, 'veh-inas-1', 'ok')).rejects.toThrow(/own vehicle request/);
    const r = await svc.decideVehicleRequest(ogm, own.id, true, 'veh-inas-1', 'Approved for parts');
    expect(r.status).toBe('approved');
    const other = await svc.requestVehicle(staff, { purpose: 'Site visit', from: myt(TODAY, '14:00'), to: myt(TODAY, '15:00') });
    // D3: the OGM stands in for the Head of Transport on any booking.
    await svc.decideVehicleRequest(ogm, other.id, true, 'veh-sasa-1', 'Standing in for Transport');
    const b = await svc.fleetBoard(ogm);
    expect(b.requests.find((x) => x.id === own.id)?.fromTransport).toBe(true);
  });

  it('gap 3: a monitored vehicle never goes out to a typed name', async () => {
    const { svc, transport } = await setup();
    await expect(svc.vehicleOut(transport, 'veh-sasa-1', null, 999_999, 'Someone')).rejects.toThrow(/staff list/);
  });

  it('gap 4: no vehicle out with insurance or road tax expired', async () => {
    const { svc, transport } = await setup();
    await expect(svc.vehicleOut(transport, 'veh-arsh-1', null, 999_999, 'Someone')).rejects.toThrow(/Insurance expired/);
  });

  it('gaps 5 and 6: Do today, and company-car km from the trip log', async () => {
    const { svc, store, transport, coo, staff } = await setup();
    const today = await svc.fleetToday(transport);
    expect(today.some((t) => t.tag === 'Vehicle' && /expired/.test(t.title))).toBe(true);
    const cooHome = await svc.home(coo);
    expect(cooHome.todo.some((t) => t.go.view === 'fleet')).toBe(true);
    const v = (await store.get('vehicles', 'veh-inas-1'))!;
    await svc.vehicleOut(transport, v.id, null, v.odometerKm, undefined, staff.id);
    await svc.vehicleIn(transport, v.id, v.odometerKm + 84, 'Back');
    const km = await (svc as unknown as { systemKm: (u: unknown, d: string, k: string) => Promise<number | null> }).systemKm(staff, TODAY, 'COMPANY_CAR');
    expect(km).toBe(84);
  });

  it('gaps 7 and 8: accidents, summonses linked to the driver, licences that stop a vehicle going out', async () => {
    const { svc, store, transport, staff, coo } = await setup();
    const v = (await store.get('vehicles', 'veh-inas-1'))!;
    // An expired licence on file stops the vehicle going out.
    await svc.fleetRecordAct(transport, 'licence', { driverUserId: staff.id, classes: 'B2 D', expiresOn: '2026-11-01' }, DOC);
    await expect(svc.vehicleOut(transport, v.id, null, v.odometerKm, undefined, staff.id)).rejects.toThrow(/licence expired/);
    await svc.fleetRecordAct(transport, 'licence', { driverUserId: staff.id, classes: 'D', expiresOn: '2029-01-01' }, DOC2);
    const lic = (await svc.fleetRecords(transport)).records.filter((r) => r.kind === 'LICENCE');
    expect(lic.map((r) => r.status).sort()).toEqual(['closed', 'open']);
    await svc.vehicleOut(transport, v.id, null, v.odometerKm, undefined, staff.id);
    // The driver may report an accident in the vehicle out with them; not a summons.
    const acc = await svc.fleetRecordAct(staff, 'accident', { vehicleId: v.id, at: NOW, place: 'Jalan Ujian', what: 'Scraped a pillar' }, DOC3);
    expect(acc.driverUserId).toBe(staff.id);
    await expect(svc.fleetRecordAct(staff, 'summons', { vehicleId: v.id, at: NOW, issuer: 'JPJ', ref: 'S1', what: 'Speeding' }, DOC3)).rejects.toThrow(/only Transport/);
    const sum = await svc.fleetRecordAct(transport, 'summons', { vehicleId: v.id, at: NOW, issuer: 'AES', ref: 'AES-001', what: 'Speeding', amountRm: 150, dueOn: '2026-11-20' }, doc(4));
    expect(sum.driver).toBe(staff.name);
    await expect(svc.fleetRecordAct(transport, 'summons', { vehicleId: v.id, at: NOW, issuer: 'AES', ref: 'AES-001', what: 'Again' }, doc(5))).rejects.toThrow(/already recorded/);
    expect((await svc.fleetToday(coo)).some((t) => t.tag === 'Summons')).toBe(true);
    // The driver sees only their own records.
    expect((await svc.fleetRecords(staff)).records.every((r) => r.driverUserId === staff.id)).toBe(true);
    // Closing needs a comment and proof.
    await expect(svc.fleetRecordAct(transport, 'close', { id: sum.id, outcome: 'PAID', note: '' }, DOC)).rejects.toThrow(/comment/);
    const closed = await svc.fleetRecordAct(transport, 'close', { id: sum.id, outcome: 'PAID', note: 'Paid online' }, doc(6));
    expect(closed.status).toBe('closed');
    // D2: the company paid; the driver at the wheel pays it back, deduction only with signed consent.
    expect((await svc.fleetToday(transport)).some((t) => /recover AES AES-001/.test(t.title))).toBe(true);
    await expect(svc.fleetRecordAct(transport, 'recover', { id: sum.id, how: 'DEDUCT', note: 'Deduct next month' }, [])).rejects.toThrow(/signed consent/);
    const rec = await svc.fleetRecordAct(transport, 'recover', { id: sum.id, how: 'DEDUCT', note: 'Deduct next month' }, doc(7));
    expect(rec.recovery).toMatchObject({ how: 'DEDUCT', amountRm: 150 });
    await expect(svc.fleetRecordAct(transport, 'recover', { id: sum.id, how: 'COMPANY_BEARS', note: 'Again' }, [])).rejects.toThrow(/Already/);
  });

  it('D1 and D4: driving limits are Policy; old or high-km vehicles go to the COO for review', async () => {
    const { svc, store, coo } = await setup();
    const { RULES, DRIVER_HOURS } = await import('../src');
    expect(RULES.fleetDriving.label).toBe('Policy');
    expect(DRIVER_HOURS.speedLimitKmh).toBe(90);
    await store.update('vehicles', 'veh-inas-1', { registeredOn: '2015-01-10' });
    expect((await svc.fleetToday(coo)).some((t) => t.tag === 'Replacement' && /years old/.test(t.detail))).toBe(true);
  });

  it('D3: the named Head of Transport decides bookings, the OGM stands in, other Transport staff do not', async () => {
    const { svc, store, ds, transport, ogm, staff } = await setup();
    const other = { ...ds.users.find((u) => u.id === 'u-transport')!, id: 'u-transport-2', name: 'Synthetic Transport Clerk', personId: null, headOf: undefined };
    await store.insert('users', other as never);
    await store.update('users', 'u-transport', { headOf: ['d_transport'] });
    const clerk = await svc.user('u-transport-2');
    const head = await svc.user('u-transport');
    const rq = await svc.requestVehicle(staff, { purpose: 'Bank run', from: myt(TODAY, '14:00'), to: myt(TODAY, '15:00') });
    await expect(svc.decideVehicleRequest(clerk, rq.id, true, 'veh-inas-1', 'ok')).rejects.toThrow(/Head of Transport/);
    expect((await svc.fleetBoard(clerk)).decidesBookings).toBe(false);
    await svc.decideVehicleRequest(head, rq.id, true, 'veh-inas-1', 'Approved');
    const rq2 = await svc.requestVehicle(staff, { purpose: 'Post office', from: myt(TODAY, '16:00'), to: myt(TODAY, '17:00') });
    await svc.decideVehicleRequest(ogm, rq2.id, true, 'veh-inas-1', 'Standing in');
    void transport;
  });
});
