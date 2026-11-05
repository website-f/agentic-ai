// Face recognition for staff clock in (Fauzan, 2 Nov 2026; free engine on the phone). The phone sends a descriptor; the
// server scores it against the face HR approved. Mock data only, never staging.
import { describe, expect, it } from 'vitest';
import { AccessDenied, BadRequest, FACE_DESCRIPTOR_LEN, MemoryStore, PrimaService, faceScore, generateDataset, myt } from '../src';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '08:40');
const img = 'data:image/jpeg;base64,' + btoa('face');
const me = Array.from({ length: FACE_DESCRIPTOR_LEN }, (_, i) => Math.sin(i + 1) / 10);
const other = me.map((x, i) => x + (i % 2 ? 0.12 : -0.12));
const shot = (descriptor: number[] | null, live = true) => ({ image: img, capturedAt: NOW, lat: null, lng: null, accuracyM: null, face: { score: 1, live }, descriptor });

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  let now = NOW;
  const svc = new PrimaService(new MemoryStore(ds), () => now);
  return { ds, svc, later: (min: number) => (now = new Date(Date.parse(now) + min * 60_000).toISOString()) };
}

describe('Face recognition for staff clock in', () => {
  it('scores the same face as a match and a different face as not, on the server', () => {
    expect(faceScore(me, me)).toBe(1);
    expect(faceScore(me, other)).toBeLessThan(0.8);
  });

  it('registers on the phone, waits for HR, and never lets anyone approve their own face', async () => {
    const { svc, ds } = fresh();
    const u = await svc.user('u-cm-inas');
    expect((await svc.myFace(u)).status).toBe('none');
    await expect(svc.registerFace(u, { photo: img, descriptor: [1, 2, 3] })).rejects.toBeInstanceOf(BadRequest);
    await svc.registerFace(u, { photo: img, descriptor: me });
    expect((await svc.myFace(u)).status).toBe('pending');
    expect(JSON.stringify(await svc.myFace(u))).not.toContain(String(me[0]));
    const hr = await svc.user('u-pwvsb-hr');
    const list = await svc.faceReviews(hr);
    expect(list.pending.find((r) => r.personId === u.personId)?.photo).toBe(img);
    await expect(svc.decideFace(hr, u.personId!, true, '')).rejects.toThrow(/comment/);
    for (const id of ['u-cm-sasa', 'u-coo', 'u-fd', 'u-ae-arsh']) await expect(svc.faceReviews(await svc.user(id))).rejects.toBeInstanceOf(AccessDenied);
    await svc.decideFace(hr, u.personId!, true, 'Matches the staff photo');
    expect(ds.people.find((p) => p.id === u.personId)!.faceEnrolledOn).toBe(TODAY);
    // HR's own face goes to someone else in HR.
    await svc.registerFace(hr, { photo: img, descriptor: me });
    await expect(svc.decideFace(hr, hr.personId!, true, 'Me')).rejects.toThrow(/Someone else/);
    await svc.decideFace(await svc.user('u-cos'), hr.personId!, true, 'Checked');
  });

  it('asks for a face check after a sign-in clock in, and flags a face that does not match or does not move', async () => {
    const { svc } = fresh();
    const u = await svc.user('u-cm-inas');
    await svc.registerFace(u, { photo: img, descriptor: me });
    await svc.decideFace(await svc.user('u-pwvsb-hr'), u.personId!, true, 'OK');
    const clock = (await svc.staffSessionStart(u))!;
    expect(clock.flags).toContain('FACE_PENDING');
    await expect(svc.staffFaceCheck(u, shot(null))).rejects.toThrow(/No face/);
    const done = await svc.staffFaceCheck(u, shot(other));
    expect(done.flags).not.toContain('FACE_PENDING');
    expect(done.flags).toContain('FACE_NOT_MATCHED');
    // The score the phone sent (1) is ignored; the server sets it.
    expect(done.faceCheck!.face!.score).toBeLessThan(0.8);
    expect(done.faceCheck!.image).toBe(img);
    await expect(svc.staffFaceCheck(u, shot(me))).rejects.toThrow(/already done/);
  });

  it('passes a matching face, and keeps clocking photo-only without an approved face', async () => {
    const { svc, later } = fresh();
    const u = await svc.user('u-cm-inas');
    const plain = (await svc.staffSessionStart(u))!;
    expect(plain.flags).not.toContain('FACE_PENDING');
    await svc.staffSessionEnd(u);
    later(60);
    await svc.registerFace(u, { photo: img, descriptor: me });
    await svc.decideFace(await svc.user('u-pwvsb-hr'), u.personId!, true, 'OK');
    await svc.staffSessionStart(u);
    const ok = await svc.staffFaceCheck(u, shot(me));
    expect(ok.flags).toEqual([]);
    expect(ok.faceCheck!.face).toEqual({ score: 1, live: true });
    const still = await svc.staffSessionEnd(u);
    expect(still).toBeDefined();
    later(60);
    await svc.staffSessionStart(u);
    const noMove = await svc.staffFaceCheck(u, shot(me, false));
    expect(noMove.flags).toContain('NO_LIVENESS');
  });

  it('lets HR remove a face with a reason, after which clocking is photo-only again', async () => {
    const { svc, ds } = fresh();
    const u = await svc.user('u-cm-inas');
    const hr = await svc.user('u-pwvsb-hr');
    await svc.registerFace(u, { photo: img, descriptor: me });
    await svc.decideFace(hr, u.personId!, true, 'OK');
    await expect(svc.registerFace(u, { photo: img, descriptor: me })).rejects.toThrow(/already registered/);
    await expect(svc.removeFace(hr, u.personId!, '')).rejects.toThrow(/comment/);
    await svc.removeFace(hr, u.personId!, 'Wrong person photo');
    expect(ds.people.find((p) => p.id === u.personId)!.faceEnrolledOn).toBeNull();
    expect((await svc.staffSessionStart(u))!.flags).not.toContain('FACE_PENDING');
  });
});
