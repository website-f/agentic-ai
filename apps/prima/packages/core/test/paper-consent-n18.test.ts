// Part N18 (Fitri package, 14 Nov 2026): paper PDPA consent gates face sign-in and location. Synthetic data only;
// faces are synthetic numbers, never a real face.
import { describe, expect, it } from 'vitest';
import { FACE_DESCRIPTOR_LEN, MemoryStore, PrimaService, generateDataset, myt } from '../src';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '08:40');
const me = Array.from({ length: FACE_DESCRIPTOR_LEN }, (_, i) => Math.sin(i + 1) / 10);
const pic = (name: string) => 'data:image/jpeg;base64,' + btoa(name);
const PIN = '4826';
const face = () => ({ engine: 'phone' as const, descriptor: me, live: true, photo: pic('signin') });

async function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  const cm = await svc.user('u-cm-sasa');
  const g = await svc.user('u-guard-sasa-1');
  const person = ds.people.find((p) => p.id === g.personId)!;
  await svc.setStaffPin(cm, person.id, PIN);
  const code = await svc.guardPhone.issueCode(cm, person.id);
  const r = await svc.guardPhone.enrol(g, { phoneId: code.phoneId, code: code.code, staffNo: person.staffNo, deviceLabel: 'Android test' });
  if (!r.ok) throw new Error(r.message);
  const reg = await svc.guardPhone.registerFace(g, r.device, { pin: PIN, photo: pic('reg'), descriptor: me, descriptorBy: 'phone' });
  expect(reg.ok).toBe(true);
  await svc.decideFace(await svc.user('u-pwvsb-hr'), person.id, true, 'Matches the guard card photo');
  return { ds, svc, g, person, device: r.device, pdpa: await svc.user('u-pdpa'), cos: await svc.user('u-cos') };
}

describe('N18 paper consent gate', () => {
  it('gate off: face sign-in works as before', async () => {
    const f = await setup();
    expect(await f.svc.paperConsent.gateOn()).toBe(false);
    expect((await f.svc.guardPhone.signIn(f.g, f.device, { pin: PIN, face: face() })).ok).toBe(true);
  });

  it('gate on: refused without a record, works after the paper consent, stops after a recorded withdrawal', async () => {
    const f = await setup();
    await expect(f.svc.paperConsent.setGate(await f.svc.user('u-cm-sasa'), true, 'Synthetic')).rejects.toThrow(/PDPA officer|Chief of Staff/);
    await f.svc.paperConsent.setGate(f.cos, true, 'Paper round started (synthetic)');
    const no = await f.svc.guardPhone.signIn(f.g, f.device, { pin: PIN, face: face() });
    expect(no).toMatchObject({ ok: false, reason: 'no_consent' });
    expect(no.ok ? '' : no.message).toMatch(/signed PDPA consent on paper/);
    // Only the PDPA officer records; no scan is needed; the IC number is never asked.
    await expect(f.svc.paperConsent.record(f.cos, { personId: f.person.id, scope: 'face', signedOn: TODAY, paperRef: 'PDPA/SYN/001' })).rejects.toThrow(/PDPA officer/);
    await expect(f.svc.paperConsent.record(f.pdpa, { personId: f.person.id, scope: 'face', signedOn: '2099-01-01', paperRef: 'PDPA/SYN/001' })).rejects.toThrow(/future/);
    const [c] = await f.svc.paperConsent.record(f.pdpa, { staffNo: f.person.staffNo, scope: 'face', signedOn: TODAY, paperRef: 'PDPA/SYN/001' });
    expect(c).toMatchObject({ scope: 'face', paperRef: 'PDPA/SYN/001', docId: null, personId: f.person.id });
    const ok = await f.svc.guardPhone.signIn(f.g, f.device, { pin: PIN, face: face() });
    expect(ok.ok).toBe(true);
    // Location was not consented to: the heartbeat keeps no location.
    if (ok.ok) {
      const hb = await f.svc.guardPhone.heartbeat(f.g, ok.session.id, { lat: 3.1, lng: 101.6, accuracyM: 10 });
      expect(['no_consent', 'off_duty']).toContain(hb.location);
    }
    // Withdrawal through the consent register switches face off.
    await f.svc.withdrawPdpaConsent(f.pdpa, c.id, TODAY, 'Letter received (synthetic); face sign-in stops');
    expect(await f.svc.paperConsent.allowed(f.person.id, 'face')).toBe(false);
    expect(await f.svc.guardPhone.signIn(f.g, f.device, { pin: PIN, face: face() })).toMatchObject({ ok: false, reason: 'no_consent' });
    const board = await f.svc.paperConsent.board(f.pdpa);
    expect(board.consents[0].withdrawn).toBeTruthy();
  });

  it('gate on: a staff member without location consent cannot send location; the clock keeps no GPS', async () => {
    const f = await setup();
    await f.svc.paperConsent.setGate(f.pdpa, true, 'Paper round started (synthetic)');
    const staff = await f.svc.user('u-pwvsb-hr');
    const clock = await f.svc.staffClockIn(staff, { image: pic('clock'), capturedAt: NOW, lat: 3.1, lng: 101.6, accuracyM: 10, face: null });
    expect(clock.in.lat).toBeNull();
    await expect(f.svc.staffPing(staff, { lat: 3.1, lng: 101.6, accuracyM: 10 })).rejects.toThrow(/signed PDPA consent on paper/);
    await f.svc.paperConsent.record(f.pdpa, { personId: staff.personId, scope: 'both', signedOn: TODAY, paperRef: 'PDPA/SYN/002' });
    expect(await f.svc.paperConsent.allowed(staff.personId, 'location')).toBe(true);
    expect(await f.svc.paperConsent.allowed(staff.personId, 'face')).toBe(true);
  });
});
