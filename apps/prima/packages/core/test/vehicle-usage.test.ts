import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, fuelFlags, generateDataset, monthUsage, myt } from '../src';

// Transport usage (Fauzan, 5 Nov 2026): fuel cards, subsidy cards, fill-ups with checks, reviews, the month's usage.
// Synthetic data only.
const TODAY = '2026-11-05';
const NOW = myt(TODAY, '10:00');
const RECEIPT = [{ kind: 'document' as const, name: 'receipt.pdf', data: 'data:application/pdf;base64,JVBERi0xLjQK' }];

async function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  const u = async (id: string) => svc.user(id);
  return {
    ds,
    store,
    svc,
    transport: await u('u-transport'),
    coo: await u('u-coo'),
    ogm: await u('u-ogm'),
    ceo: await u('u-fauzan'),
    fd: await u('u-fd'),
    cm: await u('u-cm-inas'),
    guard: await u(ds.users.find((x) => x.role === 'guard')!.id),
  };
}

const fill = (o: Partial<Parameters<PrimaService['recordFuel']>[2]> = {}) => ({
  at: myt('2026-11-04', '18:00'),
  paidWith: 'CASH' as const,
  fuel: 'RON95' as const,
  litres: 30,
  amountRm: 59.4,
  odometerKm: 151_950,
  station: 'Synthetic station',
  driver: 'Synthetic driver',
  ...o,
});

describe('transport usage', () => {
  it('lets only Transport keep cards: last 4 digits only, one vehicle at a time, ended with a reason', async () => {
    const { svc, transport, coo, store } = await setup();
    await expect(svc.addVehicleCard(coo, 'veh-arsh-1', { kind: 'FUEL', issuer: 'Syn Oil', last4: '1234', fuel: 'RON95', holder: 'Office', since: '2026-11-01', reason: 'New card' })).rejects.toThrow(/Transport/);
    await expect(
      svc.addVehicleCard(transport, 'veh-arsh-1', { kind: 'FUEL', issuer: 'Syn Oil', last4: '4111111111111234', fuel: 'RON95', holder: 'Office', since: '2026-11-01', reason: 'New card' }),
    ).rejects.toThrow(/last 4 digits/);
    await svc.addVehicleCard(transport, 'veh-arsh-1', { kind: 'FUEL', issuer: 'Syn Oil', last4: '1234', fuel: 'RON95', monthlyLimitRm: 100, holder: 'Office', since: '2026-11-01', reason: 'New card' });
    await expect(
      svc.addVehicleCard(transport, 'veh-arsh-1', { kind: 'SUBSIDY', issuer: 'Syn fleet subsidy', last4: '7777', fuel: 'LPG', holder: 'Office', since: '2026-11-01', reason: 'New card' }),
    ).rejects.toThrow(/diesel or petrol/);
    await expect(
      svc.addVehicleCard(transport, 'veh-inas-1', { kind: 'FUEL', issuer: 'syn oil', last4: '1234', fuel: 'RON95', holder: 'Office', since: '2026-11-01', reason: 'Same card' }),
    ).rejects.toThrow(/already kept for PKM 5678/);
    await expect(svc.endVehicleCard(transport, 'veh-arsh-1', 'vc-veh-arsh-1-1', { on: '2026-11-04', reason: '' })).rejects.toThrow(/reason/);
    await svc.endVehicleCard(transport, 'veh-arsh-1', 'vc-veh-arsh-1-1', { on: '2026-11-04', reason: 'Moved to the motorcycle' });
    await svc.addVehicleCard(transport, 'veh-inas-1', { kind: 'FUEL', issuer: 'syn oil', last4: '1234', fuel: 'RON95', holder: 'Office', since: '2026-11-05', reason: 'Moved here' });
    const v = (await store.get('vehicles', 'veh-arsh-1'))!;
    expect(v.cards![0]).toMatchObject({ endedOn: '2026-11-04', last4: '1234' });
    expect(JSON.stringify(v)).not.toContain('4111111111111234');
    const audit = (await store.list('audit', {})).filter((a) => a.action.startsWith('fleet.card'));
    expect(audit.map((a) => a.action)).toEqual(['fleet.card_add', 'fleet.card_end', 'fleet.card_add']);
  });

  it('records a fill-up with the checks, and only someone else reviews a flagged one', async () => {
    const { svc, transport, coo, ogm, fd, store } = await setup();
    await svc.setVehicleFuel(transport, 'veh-arsh-1', { fuelType: 'RON95', tankLitres: 60, reason: 'From the vehicle papers' });
    await svc.addVehicleCard(transport, 'veh-arsh-1', { kind: 'FUEL', issuer: 'Syn Oil', last4: '1234', fuel: 'RON95', monthlyLimitRm: 100, holder: 'Office', since: '2026-10-01', reason: 'New card' });
    const a = await svc.recordFuel(transport, 'veh-arsh-1', fill({ at: myt('2026-11-01', '09:00'), odometerKm: 151_500, paidWith: 'FUEL_CARD', cardId: 'vc-veh-arsh-1-1' }), RECEIPT);
    expect(a.fill.flags).toEqual([]);
    await expect(svc.recordFuel(transport, 'veh-arsh-1', fill({ odometerKm: 151_800 }), RECEIPT)).rejects.toThrow(/already on a fill-up of PKM 5678/);
    // Over the tank, over the card limit, wrong fuel for the vehicle, no receipt.
    const b = await svc.recordFuel(transport, 'veh-arsh-1', fill({ litres: 70, amountRm: 140, fuel: 'RON97', paidWith: 'FUEL_CARD', cardId: 'vc-veh-arsh-1-1' }));
    expect(b.fill.flags.sort()).toEqual(['NO_RECEIPT', 'OVER_LIMIT', 'OVER_TANK', 'WRONG_FUEL'].sort());
    await expect(svc.reviewFuel(transport, 'veh-arsh-1', b.fill.id, { outcome: 'EXPLAINED', reason: 'Fine' })).rejects.toThrow(/Someone else/);
    await expect(svc.reviewFuel(fd, 'veh-arsh-1', b.fill.id, { outcome: 'EXPLAINED', reason: 'Fine' })).rejects.toThrow(/reviews fill-ups/);
    await expect(svc.reviewFuel(coo, 'veh-arsh-1', a.fill.id, { outcome: 'EXPLAINED', reason: 'Fine' })).rejects.toThrow(/no check/);
    await expect(svc.reviewFuel(coo, 'veh-arsh-1', b.fill.id, { outcome: 'RECOVER', reason: 'Personal car', recoverRm: 500 })).rejects.toThrow(/up to RM140.00/);
    await svc.reviewFuel(coo, 'veh-arsh-1', b.fill.id, { outcome: 'RECOVER', reason: 'Filled a personal car', recoverRm: 80 });
    await expect(svc.reviewFuel(ogm, 'veh-arsh-1', b.fill.id, { outcome: 'CASE', reason: 'Again' })).rejects.toThrow(/Already reviewed/);
    const v = (await store.get('vehicles', 'veh-arsh-1'))!;
    expect(v.fuel![1].review).toMatchObject({ by: coo.name, outcome: 'RECOVER', recoverRm: 80 });
    const audit = (await store.list('audit', {})).filter((x) => x.action === 'fleet.fuel_review');
    expect(audit[0].summary).toBe('PKM 5678: fill-up 2026-11-04 (70 litres, RM140.00) recover RM80.00 from Synthetic driver. Reason: Filled a personal car');
  });

  it('flags a subsidy card used on another vehicle, over its quota, and a card of the wrong kind is refused', async () => {
    const { svc, transport } = await setup();
    // veh-sasa-1 keeps a mock diesel subsidy card (quota 300 litres), with 62 litres already in November in the seed.
    await expect(svc.recordFuel(transport, 'veh-arsh-1', fill({ paidWith: 'FUEL_CARD', cardId: 'vc-veh-sasa-1-1' }), RECEIPT)).rejects.toThrow(/subsidy card, not a fuel card/);
    const r = await svc.recordFuel(transport, 'veh-arsh-1', fill({ paidWith: 'SUBSIDY_CARD', cardId: 'vc-veh-sasa-1-1', fuel: 'RON95', litres: 290 }), RECEIPT);
    expect(r.fill.flags).toEqual(expect.arrayContaining(['CARD_OTHER_VEHICLE', 'WRONG_FUEL', 'OVER_QUOTA']));
    expect(r.fill.cardVehicleId).toBe('veh-sasa-1');
  });

  it('lets the driver the vehicle is out with record a fill-up, and nobody else outside Transport', async () => {
    const { svc, transport, cm, guard } = await setup();
    const rq = await svc.requestVehicle(cm, { purpose: 'Synthetic site visit', from: myt(TODAY, '10:30'), to: myt(TODAY, '17:00') });
    await svc.decideVehicleRequest(transport, rq.id, true, 'veh-arsh-1', 'Vehicle available for approved visit');
    await expect(svc.recordFuel(cm, 'veh-arsh-1', fill({ at: myt(TODAY, '09:59') }), RECEIPT)).rejects.toThrow(/Transport department or the driver/);
    await svc.vehicleOut(transport, 'veh-arsh-1', rq.id, 151_900);
    await expect(svc.recordFuel(cm, 'veh-arsh-1', fill({ at: myt('2026-11-04', '10:00') }), RECEIPT)).rejects.toThrow(/before the vehicle went out/);
    const r = await svc.recordFuel(cm, 'veh-arsh-1', fill({ at: myt(TODAY, '10:00'), driver: 'Someone else' }), RECEIPT);
    expect(r.fill).toMatchObject({ driver: cm.name, recordedById: cm.id });
    await expect(svc.recordFuel(cm, 'veh-inas-1', fill({ at: myt(TODAY, '10:00') }), RECEIPT)).rejects.toThrow(/driver/);
    await expect(svc.recordFuel(guard, 'veh-arsh-1', fill({ at: myt(TODAY, '10:00') }), RECEIPT)).rejects.toThrow();
    const mine = await svc.vehicleUsage(cm);
    expect(mine.role).toBe('driver');
    expect(mine.vehicles).toEqual([]);
    expect(mine.mine.map((m) => m.plate)).toEqual(['PKM 5678']);
    await expect(svc.vehicleUsage(guard)).rejects.toThrow();
    await expect(svc.recordFuel(transport, 'veh-arsh-1', fill({ at: myt('2026-09-01', '10:00') }), RECEIPT)).rejects.toThrow(/within 31 days/);
    await expect(svc.recordFuel(transport, 'veh-arsh-1', fill({ at: myt('2026-11-06', '10:00') }), RECEIPT)).rejects.toThrow(/future/);
  });

  it('shows the month to Transport, the COO, the OGM and leaders, with tracker distance Unknown', async () => {
    const { svc, transport, coo, ogm, ceo, cm } = await setup();
    for (const u of [transport, coo, ogm, ceo]) {
      const r = await svc.vehicleUsage(u, '2026-10');
      expect(r.vehicles.length).toBeGreaterThan(0);
    }
    const r = await svc.vehicleUsage(coo, '2026-11');
    expect(r.role).toBe('monitor');
    const hilux = r.vehicles.find((v) => v.plate === 'WXY 1234')!;
    expect(hilux.trackerKm).toBeNull();
    expect(hilux.cards.map((c) => c.last4)).toEqual(['4401', '7720']);
    expect(r.toReview.map((f) => f.flagLabels).flat()).toContain('Km per litre far from this vehicle’s usual');
    // The seed's flagged fill-up was recorded by Transport, so Transport cannot review it; the COO can.
    expect(r.toReview.find((f) => f.plate === 'WXY 1234')!.canReview).toBe(true);
    expect((await svc.vehicleUsage(transport, '2026-11')).toReview.find((f) => f.plate === 'WXY 1234')!.canReview).toBe(false);
    await expect(svc.vehicleUsage(cm)).rejects.toThrow();
  });
});

describe('transport usage review fixes', () => {
  it('keeps receipt times in Malaysia time, so the month is the Malaysian month', async () => {
    const { svc, transport } = await setup();
    // 31 Oct 16:30 UTC is 1 Nov 00:30 in Malaysia.
    const r = await svc.recordFuel(transport, 'veh-arsh-1', fill({ at: '2026-10-31T16:30:00.000Z' }), RECEIPT);
    expect(r.fill.at).toBe('2026-11-01T00:30:00+08:00');
  });

  it('never lets the driver review their own fill-up, even when Transport recorded it', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const store = new MemoryStore(ds);
    const svc = new PrimaService(store, () => NOW);
    const transport = await svc.user('u-transport');
    const coo = await svc.user('u-coo');
    // The COO drives the van; Transport records a flagged fill-up (no receipt) with the COO as the driver.
    const v = (await store.get('vehicles', 'veh-arsh-1'))!;
    await store.update('vehicles', v.id, { out: { requestId: null, driver: coo.name, driverUserId: coo.id, at: myt('2026-11-04', '08:00'), km: 151_900 } });
    const r = await svc.recordFuel(transport, 'veh-arsh-1', fill({ driver: coo.name }));
    expect(r.fill.driverUserId).toBe(coo.id);
    await expect(svc.reviewFuel(coo, 'veh-arsh-1', r.fill.id, { outcome: 'EXPLAINED', reason: 'Mine' })).rejects.toThrow(/as the driver/);
    expect((await svc.vehicleUsage(coo)).toReview.find((f) => f.id === r.fill.id)!.canReview).toBe(false);
  });

  it('refuses a card already used on another vehicle on an overlapping day, and a subsidy card for the wrong fuel', async () => {
    const { svc, transport } = await setup();
    await svc.addVehicleCard(transport, 'veh-arsh-1', { kind: 'FUEL', issuer: 'Syn Oil', last4: '1234', fuel: 'RON95', holder: 'Office', since: '2026-10-01', reason: 'New card' });
    await svc.endVehicleCard(transport, 'veh-arsh-1', 'vc-veh-arsh-1-1', { on: '2026-11-03', reason: 'Moving it' });
    await expect(
      svc.addVehicleCard(transport, 'veh-inas-1', { kind: 'FUEL', issuer: 'Syn Oil', last4: '1234', fuel: 'RON95', holder: 'Office', since: '2026-11-02', reason: 'Moved' }),
    ).rejects.toThrow(/until 2026-11-03/);
    await svc.addVehicleCard(transport, 'veh-inas-1', { kind: 'FUEL', issuer: 'Syn Oil', last4: '1234', fuel: 'RON95', holder: 'Office', since: '2026-11-04', reason: 'Moved' });
    // veh-sasa-1 takes diesel in the seed.
    await expect(
      svc.addVehicleCard(transport, 'veh-sasa-1', { kind: 'SUBSIDY', issuer: 'Syn fleet subsidy', last4: '2222', fuel: 'RON95', holder: 'Office', since: '2026-11-01', reason: 'Wrong fuel' }),
    ).rejects.toThrow(/takes DIESEL/);
  });
});

describe('one card for two vehicles (Fauzan, 5 Nov 2026)', () => {
  it('needs the Transport head consent with a reason, and counts the one limit across both vehicles', async () => {
    const { svc, transport, coo, store } = await setup();
    const card = { kind: 'FUEL' as const, issuer: 'Syn Oil', last4: '4321', fuel: 'RON95' as const, monthlyLimitRm: 100, holder: 'Office', since: '2026-11-01', reason: 'New card' };
    await svc.addVehicleCard(transport, 'veh-arsh-1', card);
    await expect(svc.addVehicleCard(transport, 'veh-inas-1', card)).rejects.toThrow(/Transport head consents/);
    await expect(svc.addVehicleCard(transport, 'veh-inas-1', { ...card, shareConsent: true, shareReason: '' })).rejects.toThrow(/reason the Transport head consents/);
    await expect(svc.addVehicleCard(transport, 'veh-inas-1', { ...card, monthlyLimitRm: 500, shareConsent: true, shareReason: 'Both patrol the same area' })).rejects.toThrow(/limit of RM100/);
    await expect(svc.addVehicleCard(coo, 'veh-inas-1', { ...card, shareConsent: true, shareReason: 'Both patrol the same area' })).rejects.toThrow(/Transport/);
    await expect(svc.addVehicleCard(transport, 'veh-pwvsb-1', { ...card, last4: '9999', shareConsent: true, shareReason: 'Not needed' })).rejects.toThrow(/no consent is needed/);
    await svc.addVehicleCard(transport, 'veh-inas-1', { ...card, shareConsent: true, shareReason: 'Both patrol the same area' });
    const bike = (await store.get('vehicles', 'veh-inas-1'))!;
    expect(bike.cards![0].sharedConsent).toMatchObject({ by: transport.name, reason: 'Both patrol the same area', withPlates: ['PKM 5678'] });
    // RM60 on the van and RM50 on the motorcycle: over the card's one RM100 limit.
    const a = await svc.recordFuel(transport, 'veh-arsh-1', fill({ at: myt('2026-11-02', '09:00'), amountRm: 60, paidWith: 'FUEL_CARD', cardId: 'vc-veh-arsh-1-1' }), RECEIPT);
    expect(a.fill.flags).not.toContain('OVER_LIMIT');
    const b = await svc.recordFuel(
      transport,
      'veh-inas-1',
      fill({ at: myt('2026-11-03', '09:00'), litres: 5, amountRm: 50, odometerKm: 30_700, paidWith: 'FUEL_CARD', cardId: bike.cards![0].id }),
      [{ kind: 'document' as const, name: 'r2.pdf', data: 'data:application/pdf;base64,JVBERi0xLjUK' }],
    );
    expect(b.fill.flags).toContain('OVER_LIMIT');
    expect(b.fill.flags).not.toContain('CARD_OTHER_VEHICLE');
    // Paying on the motorcycle with the van's record of the same consented card is still the motorcycle's card.
    const c = await svc.recordFuel(
      transport,
      'veh-inas-1',
      fill({ at: myt('2026-11-04', '09:00'), litres: 4, amountRm: 8, odometerKm: 30_800, paidWith: 'FUEL_CARD', cardId: 'vc-veh-arsh-1-1' }),
      [{ kind: 'document' as const, name: 'r3.pdf', data: 'data:application/pdf;base64,JVBERi0xLjYK' }],
    );
    expect(c.fill.flags).not.toContain('CARD_OTHER_VEHICLE');
    expect(c.fill.cardId).toBe(bike.cards![0].id);
    const usage = await svc.vehicleUsage(coo, '2026-11');
    expect(usage.vehicles.find((v) => v.plate === 'BNH 902')!.cards[0]).toMatchObject({ monthRm: 118, alsoOn: ['PKM 5678'] });
    expect(usage.vehicles.find((v) => v.plate === 'PKM 5678')!.cards[0]).toMatchObject({ monthRm: 118, alsoOn: ['BNH 902'], consent: { reason: 'Both patrol the same area' } });
    const audit = (await store.list('audit', {})).filter((x) => x.action === 'fleet.card_add').pop()!;
    expect(audit.summary).toContain('Transport head consent to also using it for PKM 5678: Both patrol the same area');
  });
});

describe('vehicle fuel and its subsidy card', () => {
  it('refuses changing a vehicle to a fuel its subsidy card does not buy', async () => {
    const { svc, transport } = await setup();
    await expect(svc.setVehicleFuel(transport, 'veh-sasa-1', { fuelType: 'RON95', tankLitres: 80, reason: 'Wrong' })).rejects.toThrow(/ending 4401 .* buys DIESEL/);
  });
});

describe('fuel checks', () => {
  const base = { id: 'v', fuelType: 'DIESEL' as const, tankLitres: 80 };
  const f = (id: string, day: number, km: number, litres: number) => ({
    id,
    at: `2026-10-${String(day).padStart(2, '0')}T02:00:00.000Z`,
    litres,
    odometerKm: km,
    amountRm: litres * 2,
    cardId: null,
    fuel: 'DIESEL' as const,
    docId: 'd',
    paidWith: 'CASH' as const,
  });
  const fills = [f('1', 1, 1000, 40), f('2', 5, 1400, 40), f('3', 9, 1800, 40), f('4', 13, 2200, 40)];

  it('flag km per litre only after enough fill-ups, and odometer out of order', () => {
    expect(fuelFlags({ ...base, fuel: fills }, f('5', 17, 2600, 41), null, { rm: 0, litres: 0 })).toEqual([]);
    expect(fuelFlags({ ...base, fuel: fills }, f('5', 17, 2300, 40), null, { rm: 0, litres: 0 })).toEqual(['KM_PER_LITRE']);
    expect(fuelFlags({ ...base, fuel: fills.slice(0, 2) }, f('5', 17, 1500, 40), null, { rm: 0, litres: 0 })).toEqual([]);
    expect(fuelFlags({ ...base, fuel: fills }, f('5', 7, 2000, 40), null, { rm: 0, litres: 0 })).toEqual(['ODOMETER_ORDER']);
    expect(fuelFlags({ ...base, fuel: fills }, { ...f('5', 13, 2210, 5), at: '2026-10-13T03:00:00.000Z' }, null, { rm: 0, litres: 0 })).toContain('TOO_SOON');
  });

  it('work out the month from odometer readings, Unknown when there is no basis', () => {
    expect(monthUsage(fills, '2026-10')).toMatchObject({ fills: 4, litres: 160, km: 1200, kmPerLitre: 10, rmPerKm: 0.2 });
    expect(monthUsage([fills[0]], '2026-10')).toMatchObject({ fills: 1, km: null, kmPerLitre: null, rmPerKm: null });
    expect(monthUsage(fills, '2026-11')).toMatchObject({ fills: 0, km: null });
  });
});
