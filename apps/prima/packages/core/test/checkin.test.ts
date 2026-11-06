// P81: staff check-in by place (checkin.ts, checkin-service.ts). Synthetic companies, staff and places only.
import { describe, expect, it } from 'vitest';
import {
  AccessDenied,
  BadRequest,
  CHECKIN_DEFAULT_RADIUS_M,
  FACE_DESCRIPTOR_LEN,
  MemoryStore,
  PrimaService,
  RefusedAfterSave,
  STATE_CAPITALS,
  accuracyProblem,
  checkinDecision,
  checkinScope,
  evaluateCheckin,
  fromMs,
  generateDataset,
  haversineM,
  isOutstation,
  mayEditCheckin,
  myt,
  weekdayOf,
  type CheckinPlace,
  type CheckinRule,
  type Company,
  type User,
} from '../src';

const TODAY = '2026-11-06';
const NOW = myt(TODAY, '08:30');
/** Metres per degree of latitude on the sphere haversineM uses. */
const M_PER_DEG = (Math.PI / 180) * 6_371_008.8;
const north = (p: { lat: number; lng: number }, m: number) => ({ lat: p.lat + m / M_PER_DEG, lng: p.lng });
const HQ = { lat: 3.1579, lng: 101.7123 };
const KUANTAN = STATE_CAPITALS.find((c) => c.city === 'Kuantan')!;

const place = (over: Partial<CheckinPlace> = {}): CheckinPlace => ({
  id: 'cp-1',
  companyId: 'co-t1',
  name: 'Head office',
  address: '',
  lat: HQ.lat,
  lng: HQ.lng,
  radiusM: 150,
  active: true,
  createdAt: NOW,
  createdBy: 'HR',
  updatedAt: NOW,
  updatedBy: 'HR',
  ...over,
});
const fieldRule = (over: Partial<CheckinRule> = {}): CheckinRule => ({
  id: 'u-x',
  userId: 'u-x',
  userName: 'X',
  companyId: 'co-t1',
  kind: 'field',
  placeId: null,
  zones: [{ label: 'Kuantan and around', lat: KUANTAN.lat, lng: KUANTAN.lng, radiusM: 50_000 }],
  outstationWeekdays: [],
  outstation: [],
  note: '',
  updatedAt: NOW,
  updatedBy: 'HR',
  ...over,
});

describe('Geofence maths', () => {
  it('measures great-circle distance', () => {
    expect(haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(M_PER_DEG, 3);
    const a = { lat: 3.139, lng: 101.6869 };
    const b = { lat: 1.4927, lng: 103.7414 };
    expect(haversineM(a, b)).toBeCloseTo(haversineM(b, a), 6);
    expect(haversineM(a, a)).toBe(0);
    // Kuala Lumpur to Johor Bahru is a little under 300 km in a straight line.
    expect(haversineM(a, b) / 1000).toBeGreaterThan(280);
    expect(haversineM(a, b) / 1000).toBeLessThan(300);
  });

  it('counts the edge of the circle as inside, and a step past it as outside', () => {
    const p = north(HQ, 149.9);
    expect(evaluateCheckin({ ...p, date: TODAY, rule: null, places: [place()] }).verdict).toBe('in_area');
    const out = evaluateCheckin({ ...north(HQ, 150.6), date: TODAY, rule: null, places: [place()] });
    expect(out.verdict).toBe('out_of_area');
    expect(out.nearest).toMatchObject({ label: 'Head office', radiusM: 150, outsideByM: 1 });
    const exact = north(HQ, 200);
    const d = haversineM(exact, HQ);
    expect(evaluateCheckin({ ...exact, date: TODAY, rule: null, places: [place({ radiusM: d })] }).verdict).toBe('in_area');
  });

  it('refuses a rough or unknown accuracy and accepts 100 m', () => {
    expect(accuracyProblem(100)).toBeNull();
    expect(accuracyProblem(8)).toBeNull();
    expect(accuracyProblem(101)).toMatch(/accurate to about 101 m/);
    expect(accuracyProblem(null)).toMatch(/did not say/);
    expect(accuracyProblem(Number.NaN)).toMatch(/did not say/);
  });
});

describe('Who checks in where', () => {
  it("uses the company's active offices by default, then the old personal base, else no place", () => {
    const two = [place(), place({ id: 'cp-2', name: 'Branch', lat: 3.0, lng: 101.5 }), place({ id: 'cp-3', name: 'Old office', lat: 3.2, lng: 101.8, active: false })];
    const atBranch = evaluateCheckin({ lat: 3.0, lng: 101.5, date: TODAY, rule: null, places: two });
    expect(atBranch).toMatchObject({ verdict: 'in_area', rule: 'office', matched: { label: 'Branch' } });
    expect(evaluateCheckin({ lat: 3.2, lng: 101.8, date: TODAY, rule: null, places: two }).verdict).toBe('out_of_area');
    const base = { name: 'Home branch', lat: 4, lng: 101, radiusM: 200 };
    expect(evaluateCheckin({ lat: 4, lng: 101, date: TODAY, rule: null, places: [], base })).toMatchObject({ verdict: 'in_area', rule: 'base' });
    expect(evaluateCheckin({ lat: 4, lng: 101, date: TODAY, rule: null, places: [] })).toMatchObject({ verdict: 'no_place', rule: 'none' });
  });

  it('holds a person to one place, and falls back to the offices when that place is archived', () => {
    const rule = fieldRule({ kind: 'place', placeId: 'cp-2', zones: [] });
    const places = [place(), place({ id: 'cp-2', name: 'Client site office', lat: 3.0, lng: 101.5 })];
    expect(evaluateCheckin({ ...HQ, date: TODAY, rule, places }).verdict).toBe('out_of_area');
    expect(evaluateCheckin({ lat: 3.0, lng: 101.5, date: TODAY, rule, places })).toMatchObject({ verdict: 'in_area', rule: 'place' });
    places[1].active = false;
    expect(evaluateCheckin({ ...HQ, date: TODAY, rule, places })).toMatchObject({ verdict: 'in_area', rule: 'office' });
  });

  it('lets field staff work anywhere in their zones or at the office, and anywhere on outstation days', () => {
    const rule = fieldRule();
    expect(evaluateCheckin({ ...north(KUANTAN, 30_000), date: TODAY, rule, places: [place()] })).toMatchObject({ verdict: 'in_area', rule: 'field' });
    expect(evaluateCheckin({ ...HQ, date: TODAY, rule, places: [place()] }).matched?.label).toBe('Head office');
    const far = north(KUANTAN, 80_000);
    const out = evaluateCheckin({ ...far, date: TODAY, rule, places: [place()] });
    expect(out.verdict).toBe('out_of_area');
    expect(out.nearest?.outsideByM).toBe(30_000);
    const trip = fieldRule({ outstation: [{ from: TODAY, to: '2026-11-08', note: 'Johor tender' }] });
    expect(isOutstation(trip, TODAY)).toBe(true);
    expect(isOutstation(trip, '2026-11-09')).toBe(false);
    expect(evaluateCheckin({ ...far, date: TODAY, rule: trip, places: [] })).toMatchObject({ verdict: 'in_area', outstation: true });
    const weekly = fieldRule({ outstationWeekdays: [weekdayOf(TODAY)] });
    expect(evaluateCheckin({ ...far, date: TODAY, rule: weekly, places: [] }).verdict).toBe('in_area');
    // Outstation is for field rules only.
    expect(isOutstation({ ...trip, kind: 'office' }, TODAY)).toBe(false);
  });

  it('blocks or flags outside the area per company, and never blocks a check-out', () => {
    expect(checkinDecision('in_area', 'block', 'in')).toEqual({ outcome: 'accepted', reasonNeeded: false });
    expect(checkinDecision('no_place', 'block', 'in')).toEqual({ outcome: 'accepted', reasonNeeded: false });
    expect(checkinDecision('out_of_area', 'block', 'in')).toEqual({ outcome: 'blocked', reasonNeeded: false });
    expect(checkinDecision('out_of_area', 'flag', 'in')).toEqual({ outcome: 'flagged', reasonNeeded: true });
    expect(checkinDecision('out_of_area', 'block', 'out')).toEqual({ outcome: 'flagged', reasonNeeded: true });
  });
});

// ---------- The service, on a synthetic group ----------

const co = (id: string, name: string) => ({ id, code: id.toUpperCase(), name, isPilot: false, headOfCompany: '', state: 'Pahang', guardCount: 0, siteCount: 0 }) as Company;
const person = (id: string, over: Partial<User>): User => ({ id, name: id, title: 'Staff', role: 'admin_exec', companyIds: ['co-t1'], siteIds: [], ...over }) as User;

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  ds.companies.push(co('co-t1', 'Test One Sdn Bhd'), co('co-t2', 'Test Two Sdn Bhd'));
  ds.users.push(
    person('u-t-mgr', { name: 'Manager One', role: 'company_manager' }),
    person('u-t-mgr2', { name: 'Manager Two', role: 'company_manager', companyIds: ['co-t2'] }),
    person('u-t-staff', { name: 'Staff One' }),
    person('u-t-staff2', { name: 'Staff Two' }),
    person('u-t-staff3', { name: 'Staff Three', companyIds: ['co-t2'] }),
    person('u-t-sup', { name: 'Supervisor', role: 'supervisor' }),
    person('u-t-guard', { name: 'Guard', role: 'guard' }),
    person('u-t-hr', { name: 'HR Admin', role: 'pwvsb_officer', department: 'hr', companyIds: [] }),
  );
  let now = NOW;
  const svc = new PrimaService(new MemoryStore(ds), () => now);
  return { ds, svc, later: (min: number) => (now = fromMs(Date.parse(now) + min * 60_000)), u: (id: string) => svc.user(id) };
}
const at = (p: { lat: number; lng: number }, accuracyM: number | null = 12, reason?: string) => ({ ...p, accuracyM, capturedAt: NOW, reason });
const found = { status: 'found' as const, text: 'Jalan Ampang, Kuala Lumpur' };

describe('Check-in places: who may set them', () => {
  it('gives the owner, leaders and HR every company, a manager their own, and nobody else any', async () => {
    const { u } = fresh();
    expect(checkinScope(await u('u-t-hr'))).toBe('all');
    expect(checkinScope(await u('u-t-mgr'))).toEqual(['co-t1']);
    expect(checkinScope(await u('u-t-staff'))).toBeNull();
    expect(checkinScope(await u('u-t-sup'))).toBeNull();
    expect(mayEditCheckin(await u('u-t-mgr'), 'co-t2')).toBe(false);
  });

  it('refuses places, rules and reviews to anyone outside that scope', async () => {
    const { svc, u } = fresh();
    const input = { companyId: 'co-t1', name: 'Head office', address: '', lat: HQ.lat, lng: HQ.lng };
    await expect(svc.saveCheckinPlace(await u('u-t-staff'), input)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.checkinSetup(await u('u-t-staff'))).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.checkinReviews(await u('u-t-sup'))).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.saveCheckinPlace(await u('u-t-mgr2'), input)).rejects.toBeInstanceOf(AccessDenied);
    const p = await svc.saveCheckinPlace(await u('u-t-mgr'), input);
    expect(p.radiusM).toBe(CHECKIN_DEFAULT_RADIUS_M);
    await expect(svc.saveCheckinPlace(await u('u-t-mgr'), { ...input, radiusM: 10 })).rejects.toThrow(/between 25 m/);
    await expect(svc.setCheckinPolicy(await u('u-t-mgr2'), 'co-t1', 'block')).rejects.toBeInstanceOf(AccessDenied);
    // Nobody sets their own rule; a manager cannot set another company's staff.
    await expect(svc.setCheckinRules(await u('u-t-mgr'), ['u-t-mgr'], { kind: 'office' })).rejects.toThrow(/Someone else/);
    await expect(svc.setCheckinRules(await u('u-t-mgr'), ['u-t-staff3'], { kind: 'office' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setCheckinRules(await u('u-t-hr'), ['u-t-guard'], { kind: 'office' })).rejects.toThrow(/site device/);
    // HR sets rules in bulk; a place of another company is refused.
    const other = await svc.saveCheckinPlace(await u('u-t-hr'), { ...input, companyId: 'co-t2', name: 'Two HQ' });
    await expect(svc.setCheckinRules(await u('u-t-hr'), ['u-t-staff', 'u-t-staff3'], { kind: 'place', placeId: other.id })).rejects.toThrow(/another company/);
    expect(await svc.setCheckinRules(await u('u-t-hr'), ['u-t-staff', 'u-t-staff2'], { kind: 'place', placeId: p.id })).toEqual({ updated: 2 });
    const setup = await svc.checkinSetup(await u('u-t-mgr'));
    expect(setup.companies.map((c) => c.id)).toEqual(['co-t1']);
    expect(setup.staff.find((s) => s.userId === 'u-t-staff')?.rule?.kind).toBe('place');
    expect(setup.staff.some((s) => s.userId === 'u-t-staff3')).toBe(false);
  });
});

describe('Check-in and check-out', () => {
  it('records the point, accuracy, server time and address, opens the clock, and closes it at check-out', async () => {
    const { svc, u, later } = fresh();
    await svc.saveCheckinPlace(await u('u-t-mgr'), { companyId: 'co-t1', name: 'Head office', address: '', lat: HQ.lat, lng: HQ.lng });
    const staff = await u('u-t-staff');
    const r = await svc.checkIn(staff, 'in', { ...at(north(HQ, 40)), verdict: 'out_of_area' } as never, found);
    expect(r.event).toMatchObject({ kind: 'in', verdict: 'in_area', outcome: 'accepted', accuracyM: 12, address: found.text, addressStatus: 'found', at: NOW, review: null });
    expect(r.event.matched).toMatchObject({ label: 'Head office', distanceM: 40 });
    expect(r.clock && !r.clock.out).toBe(true);
    await expect(svc.checkIn(staff, 'in', at(HQ))).rejects.toThrow(/Check out first/);
    expect((await svc.myCheckin(staff)).state).toBe('in');
    later(480);
    const out = await svc.checkIn(staff, 'out', at(north(HQ, 20)));
    expect(out.event.kind).toBe('out');
    expect(out.clock?.out).toMatchObject({ source: 'checkin', distanceM: 20, accuracyM: 12 });
    // Checked out for the day: opening Prima again does not start a new clock; a new check-in does.
    expect(await svc.staffSessionStart(staff)).toBeNull();
    await expect(svc.checkIn(staff, 'out', at(HQ))).rejects.toThrow(/Check in first/);
    later(5);
    expect((await svc.checkIn(staff, 'in', at(HQ))).clock?.out).toBeNull();
  });

  it('asks to retry a rough reading and saves nothing', async () => {
    const { svc, u, ds } = fresh();
    const staff = await u('u-t-staff');
    await expect(svc.checkIn(staff, 'in', at(HQ, 140))).rejects.toThrow(/accurate to about 140 m/);
    await expect(svc.checkIn(staff, 'in', at(HQ, null))).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.checkIn(staff, 'in', { lat: 200, lng: 0, accuracyM: 5 })).rejects.toThrow(/No location/);
    expect(ds.checkinEvents).toHaveLength(0);
    const preview = await svc.checkinPreview(staff, at(HQ, 140));
    expect(preview).toMatchObject({ accuracyOk: false, kind: 'in' });
  });

  it('takes an out-of-area check-in only with a reason, flags it and sends it for review', async () => {
    const { svc, u, ds } = fresh();
    await svc.saveCheckinPlace(await u('u-t-mgr'), { companyId: 'co-t1', name: 'Head office', address: '', lat: HQ.lat, lng: HQ.lng });
    const staff = await u('u-t-staff');
    const away = north(HQ, 2_000);
    expect(await svc.checkinPreview(staff, at(away), found)).toMatchObject({ verdict: 'out_of_area', outcome: 'flagged', reasonNeeded: true, address: found.text });
    await expect(svc.checkIn(staff, 'in', at(away))).rejects.toThrow(/1,850 m outside Head office/);
    await expect(svc.checkIn(staff, 'in', at(away, 12, 'ok'))).rejects.toThrow(/short reason/);
    expect(ds.checkinEvents).toHaveLength(0);
    const r = await svc.checkIn(staff, 'in', at(away, 12, 'Meeting at the client office'));
    expect(r.event).toMatchObject({ outcome: 'flagged', reason: 'Meeting at the client office', review: { status: 'open' } });
    expect(r.clock?.flags).toContain('OUT_OF_AREA');
    const mgr = await u('u-t-mgr');
    const list = await svc.checkinReviews(mgr);
    expect(list.open.map((e) => e.id)).toEqual([r.event.id]);
    await expect(svc.checkinReviews(await u('u-t-mgr2'))).resolves.toMatchObject({ open: [] });
    await expect(svc.decideCheckin(mgr, r.event.id, 'cleared', '')).rejects.toThrow(/comment/);
    await svc.decideCheckin(mgr, r.event.id, 'cleared', 'Client meeting confirmed');
    const after = await svc.checkinReviews(mgr);
    expect(after.open).toHaveLength(0);
    expect(after.decided[0].review).toMatchObject({ status: 'cleared', by: 'Manager One' });
    await expect(svc.decideCheckin(mgr, r.event.id, 'upheld', 'again')).rejects.toThrow(/already reviewed/);
  });

  it("refuses an out-of-area check-in when the company blocks, keeps the attempt for review, and still lets people check out", async () => {
    const { svc, u, ds } = fresh();
    const mgr = await u('u-t-mgr');
    await svc.saveCheckinPlace(mgr, { companyId: 'co-t1', name: 'Head office', address: '', lat: HQ.lat, lng: HQ.lng });
    await svc.setCheckinPolicy(mgr, 'co-t1', 'block');
    const staff = await u('u-t-staff');
    const away = north(HQ, 900);
    expect(await svc.checkinPreview(staff, at(away))).toMatchObject({ outcome: 'blocked', reasonNeeded: false });
    await expect(svc.checkIn(staff, 'in', at(away, 12, 'At home'))).rejects.toBeInstanceOf(RefusedAfterSave);
    expect(ds.checkinEvents).toHaveLength(1);
    expect(ds.checkinEvents[0]).toMatchObject({ outcome: 'blocked', clockId: null, review: { status: 'open' } });
    expect((await svc.myCheckin(staff)).state).toBe('none');
    expect((await svc.checkinReviews(mgr)).open).toHaveLength(1);
    await svc.checkIn(staff, 'in', at(HQ));
    const out = await svc.checkIn(staff, 'out', at(away, 12, 'Left for a site visit'));
    expect(out.event.outcome).toBe('flagged');
  });

  it('checks field staff against their working area and outstation days', async () => {
    const { svc, u } = fresh();
    const hr = await u('u-t-hr');
    await svc.setCheckinRules(hr, ['u-t-staff2'], {
      kind: 'field',
      zones: [{ label: 'Kuantan and around', lat: KUANTAN.lat, lng: KUANTAN.lng, radiusM: 50_000 }],
      outstation: [{ from: '2026-11-10', to: '2026-11-12', note: 'Johor' }],
    });
    const staff = await u('u-t-staff2');
    expect((await svc.checkinPreview(staff, at(north(KUANTAN, 30_000)))).verdict).toBe('in_area');
    expect((await svc.checkinPreview(staff, at(north(KUANTAN, 70_000)))).verdict).toBe('out_of_area');
    await svc.setCheckinRules(hr, ['u-t-staff2'], {
      kind: 'field',
      zones: [{ label: 'Kuantan and around', lat: KUANTAN.lat, lng: KUANTAN.lng, radiusM: 50_000 }],
      outstation: [{ from: TODAY, to: TODAY, note: 'Johor tender' }],
    });
    const r = await svc.checkIn(staff, 'in', at(STATE_CAPITALS.find((c) => c.city === 'Johor Bahru')!));
    expect(r.event).toMatchObject({ verdict: 'in_area', outstation: true, outcome: 'accepted', rule: 'field' });
    await expect(svc.setCheckinRules(hr, ['u-t-staff2'], { kind: 'field', zones: [] })).rejects.toThrow(/at least one working area/);
    await expect(
      svc.setCheckinRules(hr, ['u-t-staff2'], { kind: 'field', zones: [{ label: 'Too big', lat: 3, lng: 101, radiusM: 900_000 }] }),
    ).rejects.toThrow(/radius/);
  });

  it('fills a slow address later, for the person themself only', async () => {
    const { svc, u } = fresh();
    const staff = await u('u-t-staff');
    const r = await svc.checkIn(staff, 'in', at(HQ), { status: 'pending', text: null });
    expect(r.event.verdict).toBe('no_place');
    expect(await svc.checkinSetAddress(await u('u-t-staff2'), r.event.id, found)).toBe(false);
    expect(await svc.checkinSetAddress(staff, r.event.id, found)).toBe(true);
    expect(await svc.checkinSetAddress(staff, r.event.id, { status: 'found', text: 'Elsewhere' })).toBe(false);
    expect((await svc.myCheckin(staff)).today[0]).toMatchObject({ address: found.text, addressStatus: 'found' });
  });

  it('does the waiting face check with the check-in, scored on the server', async () => {
    const { svc, u, ds } = fresh();
    const desc = Array.from({ length: FACE_DESCRIPTOR_LEN }, (_, i) => Math.sin(i + 1) / 10);
    ds.users.find((x) => x.id === 'u-t-staff')!.personId = 'p-t-staff';
    ds.staffFaces.push({ id: 'p-t-staff', personId: 'p-t-staff', userId: 'u-t-staff', companyId: 'co-t1', descriptor: desc, photo: '', status: 'approved', submittedAt: NOW, decidedBy: 'HR', decidedById: 'u-t-hr', decidedAt: NOW, note: 'ok' });
    const staff = await u('u-t-staff');
    expect((await svc.staffSessionStart(staff))!.flags).toContain('FACE_PENDING');
    expect((await svc.myCheckin(staff)).mine).toMatchObject({ faceEnrolled: true, facePending: true });
    const image = 'data:image/jpeg;base64,' + btoa('checkin-face');
    const r = await svc.checkIn(staff, 'in', { ...at(HQ), face: { image, descriptor: desc, live: true } });
    expect(r.event.face).toEqual({ score: 1, live: true });
    expect(r.clock?.flags).not.toContain('FACE_PENDING');
    expect(r.clock?.faceCheck?.image).toBe(image);
  });

  it('guards clock on the site device, not with a check-in', async () => {
    const { svc, u } = fresh();
    await expect(svc.checkIn(await u('u-t-guard'), 'in', at(HQ))).rejects.toThrow(/site device/);
    expect((await svc.myCheckin(await u('u-t-guard'))).allowed).toBe(false);
  });
});
