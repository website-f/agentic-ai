// Security gates before real staff data (pre-publication review R1-R3, Fauzan 31 Oct 2026): hashed PINs, department
// walls and offboarding. Mock data only.
import { describe, expect, it } from 'vitest';
import {
  AccessClosed,
  AccessDenied,
  BadRequest,
  DEMO_PIN_KEEPER,
  MemoryStore,
  PinsOff,
  PrimaService,
  activeGrants,
  dataWalls,
  demoPin,
  generateDataset,
  isPinHash,
  myt,
  pinKeeper,
  verifyChain,
} from '../src';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');

function fresh(now = NOW) {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => now) };
}

describe('PIN hashing', () => {
  it('keeps only a keyed salted hash, matches the right PIN and never a plain one', () => {
    const k = pinKeeper('k'.repeat(40));
    const a = k.hash('4821');
    const b = k.hash('4821');
    expect(isPinHash(a)).toBe(true);
    expect(a).not.toContain('4821');
    expect(a).not.toBe(b);
    expect(k.matches(a, '4821')).toBe(true);
    expect(k.matches(a, '4822')).toBe(false);
    expect(k.matches('4821', '4821')).toBe(false);
    expect(k.matches(null, '4821')).toBe(false);
    // Another key cannot check it: a copy of the database alone gives nothing away.
    expect(pinKeeper('x'.repeat(40)).matches(a, '4821')).toBe(false);
  });

  it('switches PIN checks off without a usable key, instead of weakening them', () => {
    for (const key of [null, '', 'short-key']) {
      const k = pinKeeper(key);
      expect(k.on).toBe(false);
      expect(() => k.hash('4821')).toThrow(PinsOff);
      expect(() => k.matches(DEMO_PIN_KEEPER.hash('4821'), '4821')).toThrow(PinsOff);
    }
  });

  it('stores no PIN as typed in the mock data', () => {
    const { ds } = fresh();
    expect(ds.people.some((p) => 'pin' in p)).toBe(false);
    expect(ds.people.every((p) => !p.staffNo || isPinHash(p.pinHash))).toBe(true);
  });

  it('refuses every PIN when the service has no key', async () => {
    const { svc, ds } = fresh();
    svc.pins = pinKeeper(null);
    const dev = await svc.user('u-dev-sasa-001');
    const person = ds.people.find((p) => p.companyId === 'co-sasa' && p.status === 'active')!;
    const cp = ds.checkpoints.find((c) => c.siteId === dev.siteIds[0])!;
    await expect(svc.scanCheckpoint(dev, { staffNo: person.staffNo, pin: demoPin(person.staffNo), tagCode: cp.tagCode })).rejects.toThrow(/switched off/);
  });

  it('lets HR or the company office set a PIN, never the person, a guard or another company', async () => {
    const { svc, ds } = fresh();
    const p = ds.people.find((x) => x.companyId === 'co-sasa' && x.role === 'guard' && x.status === 'active')!;
    const hr = await svc.user('u-pwvsb-hr');
    const cm = await svc.user('u-cm-sasa');
    await expect(svc.setStaffPin(await svc.user('u-cm-arsh'), p.id, '4821')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setStaffPin(await svc.user('u-it-ex1'), p.id, '4821')).rejects.toBeInstanceOf(AccessDenied);
    for (const weak of ['1111', '1234', '9876', '12', 'abcd', '1234567'])
      await expect(svc.setStaffPin(cm, p.id, weak)).rejects.toBeInstanceOf(BadRequest);
    await svc.setStaffPin(hr, p.id, '4821');
    const saved = ds.people.find((x) => x.id === p.id)!;
    expect(DEMO_PIN_KEEPER.matches(saved.pinHash, '4821')).toBe(true);
    const entry = ds.audit.find((e) => e.action === 'person.pin' && e.entityId === p.id)!;
    expect(entry.summary).not.toContain('4821');
    // Nobody sets their own.
    const me = ds.people.find((x) => x.id === cm.personId)!;
    await expect(svc.setStaffPin(cm, me.id, '4821')).rejects.toThrow(/nobody sets their own/);
    // The new PIN signs a patrol scan; the old test PIN no longer does.
    const dev = ds.users.find((u) => u.role === 'site_device' && u.companyIds.includes('co-sasa'))!;
    const cp = ds.checkpoints.find((c) => c.siteId === dev.siteIds[0])!;
    await expect(svc.scanCheckpoint(dev, { staffNo: p.staffNo, pin: demoPin(p.staffNo), tagCode: cp.tagCode })).rejects.toThrow(/PIN is wrong/);
    expect((await svc.scanCheckpoint(dev, { staffNo: p.staffNo, pin: '4821', tagCode: cp.tagCode })).scan).toBeTruthy();
    expect(verifyChain(ds.audit)).toBeNull();
  });

  it('refuses a PIN scan by a person who has left, with the same message as a wrong PIN', async () => {
    const { svc, ds } = fresh();
    const dev = await svc.user('u-dev-sasa-001');
    const p = ds.people.find((x) => x.companyId === 'co-sasa' && x.role === 'guard' && x.status === 'active')!;
    p.status = 'left';
    const cp = ds.checkpoints.find((c) => c.siteId === dev.siteIds[0])!;
    await expect(svc.scanCheckpoint(dev, { staffNo: p.staffNo, pin: demoPin(p.staffNo), tagCode: cp.tagCode })).rejects.toThrow(/Staff number or PIN is wrong/);
  });
});

describe('PINs after offboarding (review of PR #34)', () => {
  /** A company office person with a Prima account, their site device and a checkpoint there. */
  async function officeWithAccount() {
    const { svc, ds } = fresh();
    const user = ds.users.find((u) => u.role === 'admin_exec' && u.personId && ds.people.find((p) => p.id === u.personId)?.companyId === 'co-sasa')!;
    const person = ds.people.find((p) => p.id === user.personId)!;
    const dev = ds.users.find((u) => u.role === 'site_device' && u.companyIds.includes('co-sasa'))!;
    const cp = ds.checkpoints.find((c) => c.siteId === dev.siteIds[0])!;
    const scan = (s: PrimaService = svc) => s.scanCheckpoint(dev, { staffNo: person.staffNo, pin: demoPin(person.staffNo), tagCode: cp.tagCode });
    return { svc, ds, user, person, scan };
  }

  it('stops site-device and witness PINs once the linked Prima account is closed', async () => {
    const { svc, ds, user, person, scan } = await officeWithAccount();
    expect((await scan()).scan).toBeTruthy();
    await svc.closeAccess(await svc.user('u-pwvsb-hr'), user.id, { reason: 'Dismissed' });
    expect(ds.people.find((p) => p.id === person.id)!.status).toBe('active');
    await expect(scan()).rejects.toThrow(/Staff number or PIN is wrong/);
    // As a witness too: a store count needs a second person by PIN.
    const sk = await svc.user('u-proc-store1');
    const item = ds.stockItems.find((i) => i.companyId === 'co-sasa')!;
    await expect(svc.stockCount(sk, item.id, item.onHand, { staffNo: person.staffNo, pin: demoPin(person.staffNo) })).rejects.toThrow(/PIN is wrong/);
    const cm = await svc.user('u-cm-sasa');
    await expect(svc.setStaffPin(cm, person.id, '4821')).rejects.toThrow(/has left/);
  });

  it('stops PINs from the day after a last working day recorded ahead, and keeps them closed when access closes later', async () => {
    const { ds, person, scan, user } = await officeWithAccount();
    person.leaving = { kind: 'resigned', noticeOn: TODAY, lastDayOn: '2026-10-27', reason: 'New job', by: 'HR', at: NOW };
    const onLastDay = new PrimaService(new MemoryStore(ds), () => myt('2026-10-27', '09:00'));
    expect((await scan(onLastDay)).scan).toBeTruthy();
    const dayAfter = new PrimaService(new MemoryStore(ds), () => myt('2026-10-28', '09:00'));
    await expect(scan(dayAfter)).rejects.toThrow(/Staff number or PIN is wrong/);
    // A closing date set in advance also cuts the PIN from that day.
    person.leaving = null;
    ds.users.find((u) => u.id === user.id)!.accessClosedFrom = '2026-11-02';
    expect((await scan(new PrimaService(new MemoryStore(ds), () => myt('2026-11-01', '09:00')))).scan).toBeTruthy();
    await expect(scan(new PrimaService(new MemoryStore(ds), () => myt('2026-11-02', '09:00')))).rejects.toThrow(/Staff number or PIN is wrong/);
  });

  it('blanks an old typed PIN when HR sets a new one, so only the new one works', async () => {
    const { svc, ds } = fresh();
    const p = ds.people.find((x) => x.companyId === 'co-sasa' && x.role === 'guard' && x.status === 'active')!;
    (p as unknown as { pin: string | null }).pin = '6152';
    p.pinHash = null;
    await svc.setStaffPin(await svc.user('u-pwvsb-hr'), p.id, '8274');
    const saved = ds.people.find((x) => x.id === p.id)! as unknown as { pin: string | null; pinHash: string };
    expect(saved.pin).toBeNull();
    expect(DEMO_PIN_KEEPER.matches(saved.pinHash, '8274')).toBe(true);
    expect(DEMO_PIN_KEEPER.matches(saved.pinHash, '6152')).toBe(false);
  });
});

describe('department walls', () => {
  it('gives each department only its own walls, and a fifth office user none', () => {
    const { ds } = fresh();
    const walls = (id: string) => dataWalls(ds.users.find((u) => u.id === id)!);
    expect(walls('u-asset-mm')).toEqual(['asset_read', 'asset_write']);
    expect(walls('u-pdpa')).toEqual(['pdpa']);
    expect(walls('u-it-ex1')).toEqual(['bcm', 'login_handover']);
    // Arisha main, 84b056e: IT reads the login handover, never the movement row (pay, private reason).
    expect(walls('u-it-ex1')).not.toContain('staff_movements');
    expect(walls('u-pwvsb-hr')).toEqual(['offboard', 'staff_ids', 'staff_accounts', 'staff_faces', 'hr_cases', 'staff_movements', 'login_handover']);
    // HR wall (slice 3A part 3): Finance reads salary accounts, never the full IC.
    expect(walls('u-fd')).toContain('staff_accounts');
    expect(walls('u-fd')).not.toContain('staff_ids');
    // ACT audits assets but never writes them, ACT head included.
    expect(walls('u-act-aud2')).toEqual(['asset_read', 'act', 'corporate', 'legal']);
    expect(walls('u-audit')).toContain('asset_read');
    expect(walls('u-audit')).not.toContain('asset_write');
    // PWVSB legal reads arms requests for their legal check (Special Ops slice 4C), so it passes the arms wall only.
    expect(walls('u-legal')).toEqual(['arms', 'corporate', 'legal', 'mandates']);
    // The company manager sees and handles their own company's firearms (Special Ops slice 4A: the arms wall).
    expect(walls('u-cm-sasa')).toEqual(['arms', 'corporate', 'legal', 'mandates', 'staff_company', 'staff_movements']);
    // System feeds hold no wall, except the Asset Management system feed (Special Ops 4G), which updates the units it reports.
    for (const u of ds.users.filter((x) => x.integration && !['am', 'whatsapp', 'ja'].includes(String(x.integration)))) expect(dataWalls(u)).toEqual([]);
    for (const k of ['am', 'whatsapp']) expect(dataWalls(ds.users.find((x) => x.integration === k)!)).toEqual(['asset_read', 'asset_write']);
    // Central Admin walls (5A part 2): legal sees all three; a company manager sees its company file and mandates; the
    // company secretary sees company secretary records only.
    expect(walls('u-legal')).toEqual(['arms', 'corporate', 'legal', 'mandates']);
    expect(walls('u-cm-sasa')).toEqual(['arms', 'corporate', 'legal', 'mandates', 'staff_company', 'staff_movements']);
    expect(walls('u-cosec')).toEqual(['corporate']);
    // Slice 3G: FWM reads foreign workers' passports only; the JA feed keeps guard rows only.
    for (const id of ['u-transport', 'u-proc-exec']) expect(walls(id)).toEqual([]);
    expect(walls('u-fwm-ex1')).toEqual(['fw_ids']);
    expect(walls('u-ja-sync')).toEqual(['guard_feed']);
    // A company manager reads only their own staff's numbers (Fauzan, 1 Nov 2026).
    expect(walls('u-cm-sasa')).toEqual(['arms', 'corporate', 'legal', 'mandates', 'staff_company', 'staff_movements']);
    for (const u of ds.users.filter((x) => x.integration && !['am', 'whatsapp', 'ja'].includes(String(x.integration)))) expect(dataWalls(u)).toEqual([]);
  });

  it('keeps the screens and the walls in step: no wall, no board', async () => {
    const { svc } = fresh();
    const it = await svc.user('u-it-ex1');
    await expect(svc.amBoard(it)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.pdpaRights(it)).rejects.toBeInstanceOf(AccessDenied);
    const pdpa = await svc.user('u-pdpa');
    await expect(svc.bcmBoard(pdpa)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.amBoard(pdpa)).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('offboarding', () => {
  it('lets HR close access now: sign-in refused, grants ended, audited', async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const target = ds.users.find((u) => u.id === 'u-om-klang')!;
    expect(activeGrants(target, ds.grants, TODAY).length).toBeGreaterThan(0);
    await expect(svc.closeAccess(hr, target.id, { reason: '' })).rejects.toThrow(/reason/);
    await expect(svc.closeAccess(hr, target.id, { from: '2026-10-01', reason: 'Resigned' })).rejects.toThrow(/today or on a later day/);
    const r = await svc.closeAccess(hr, target.id, { reason: 'Resigned' });
    expect(r.from).toBe(TODAY);
    expect(r.grantsEnded).toBeGreaterThan(0);
    await expect(svc.user(target.id)).rejects.toBeInstanceOf(AccessClosed);
    await expect(svc.user(target.id)).rejects.toBeInstanceOf(AccessDenied);
    expect(activeGrants(ds.users.find((u) => u.id === target.id)!, ds.grants, TODAY)).toEqual([]);
    expect(ds.audit.some((e) => e.action === 'user.access.close' && e.entityId === target.id)).toBe(true);
    await expect(svc.closeAccess(hr, target.id, { reason: 'Again' })).rejects.toThrow(/already closed/);
    expect(verifyChain(ds.audit)).toBeNull();
  });

  it('closes from a later day only from that day', async () => {
    const { svc, ds } = fresh();
    await svc.closeAccess(await svc.user('u-cos'), 'u-om-johor', { from: '2026-11-30', reason: 'Contract ends' });
    expect((await svc.user('u-om-johor')).accessClosedFrom).toBe('2026-11-30');
    const later = new PrimaService(new MemoryStore(ds), () => myt('2026-11-30', '08:00'));
    await expect(later.user('u-om-johor')).rejects.toBeInstanceOf(AccessClosed);
  });

  it('refuses anyone else, closing your own access, the CEO and system feeds', async () => {
    const { svc } = fresh();
    for (const id of ['u-it-mgr', 'u-coo', 'u-fd', 'u-audit', 'u-cm-sasa', 'u-om-klang'])
      await expect(svc.closeAccess(await svc.user(id), 'u-it-ex1', { reason: 'Resigned' })).rejects.toBeInstanceOf(AccessDenied);
    const hr = await svc.user('u-pwvsb-hr');
    await expect(svc.closeAccess(hr, 'u-pwvsb-hr', { reason: 'Resigned' })).rejects.toThrow(/nobody closes their own/);
    await expect(svc.closeAccess(hr, 'u-fauzan', { reason: 'Resigned' })).rejects.toThrow(/CEO/);
    await expect(svc.closeAccess(hr, 'u-ja-sync', { reason: 'Resigned' })).rejects.toThrow(/system feed/);
  });

  it("closes a leaver's account from the day after the last working day HR records", async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const leaver = ds.users.find((u) => u.id === 'u-it-ex2')!;
    const values = (await svc.recordForm(hr, 'officeStaff', leaver.personId!, null)).values;
    await svc.saveRecord(hr, 'officeStaff', leaver.personId!, null, {
      ...values,
      leavingKind: 'resigned',
      noticeOn: TODAY,
      lastDayOn: '2026-11-25',
      leavingReason: 'New job',
    });
    const after = ds.users.find((u) => u.id === leaver.id)!;
    expect(after.accessClosedFrom).toBe('2026-11-26');
    expect(after.accessClosed!.reason).toContain('New job');
    // Still works on the last day.
    await expect(new PrimaService(new MemoryStore(ds), () => myt('2026-11-25', '17:00')).user(leaver.id)).resolves.toBeTruthy();
    await expect(new PrimaService(new MemoryStore(ds), () => myt('2026-11-26', '08:00')).user(leaver.id)).rejects.toBeInstanceOf(AccessClosed);
    // HR sees the account on the staff profile.
    const detail = await svc.personDetail(hr, leaver.personId!);
    expect(detail.accounts).toEqual([expect.objectContaining({ userId: leaver.id, closedFrom: '2026-11-26' })]);
    expect(verifyChain(ds.audit)).toBeNull();
  });
});
