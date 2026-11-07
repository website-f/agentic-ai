import { describe, expect, it } from 'vitest';
import { AccessDenied, BadRequest, MemoryStore, PrimaService, demoPin, generateDataset, makeTestInhouseKey, myt, openSealed, sealForInhouse } from '../src';

// Synthetic data only. The one-stop guard duty device (Fauzan, 6 Nov 2026).
const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');
const jpeg = (n: number) => `data:image/jpeg;base64,${Buffer.from(`synthetic gate photo ${n}`).toString('base64')}`;

async function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  const dev = await svc.user('u-dev-sasa-001');
  const site = ds.sites.find((s) => s.id === dev.siteIds[0])!;
  const guard = ds.people.find((p) => p.companyId === site.companyId && p.status === 'active' && p.staffNo && p.pinHash)!;
  const sign = { staffNo: guard.staffNo!, pin: demoPin(guard.staffNo!) };
  const photo = (n: number) => ({ image: jpeg(n), lat: site.lat, lng: site.lng, accuracyM: 8 });
  return { ds, svc, dev, site, sign, photo };
}
const visitor = (over: Record<string, unknown> = {}) => ({
  name: 'Sample Visitor',
  idKind: 'mykad' as const,
  idNumber: '900101-14-5678',
  idRead: 'scan' as const,
  company: 'Sample Supplies',
  host: 'Clinic admin',
  purpose: 'Deliver forms',
  face: { score: 0.93, live: true },
  ...over,
});

describe('One-stop guard duty device', () => {
  it('keeps a signed post log; lines are never edited, a correction is a new line', async () => {
    const { svc, ds, dev, sign } = await setup();
    await expect(svc.addPostLog(dev, { ...sign, pin: sign.pin === '0000' ? '1111' : '0000', kind: 'routine', text: 'All clear' })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.addPostLog(dev, { ...sign, kind: 'routine', text: '' })).rejects.toThrow(/Write what happened/);
    const a = await svc.addPostLog(dev, { ...sign, kind: 'observation', text: 'Side gate lock loose' });
    expect(a.staffNo).toBe(sign.staffNo);
    expect(a.at).toBe(NOW);
    const b = await svc.addPostLog(dev, { ...sign, kind: 'other', text: 'Correction: it is the rear gate lock', correctsId: a.id });
    expect(b.correctsId).toBe(a.id);
    const v = await svc.dutyDevice(dev);
    expect(v.postLog[0].id).toBe(b.id);
    expect(ds.audit.filter((x) => x.action === 'site.post_log')).toHaveLength(2);
    // Only the shared device writes the post log.
    await expect(svc.addPostLog(await svc.user('u-cm-sasa'), { ...sign, kind: 'routine', text: 'x y z' })).rejects.toBeInstanceOf(AccessDenied);
  });

  it('records a visitor with the face checked against the IC; without a sealed full ID it keeps only the last 4 and warns', async () => {
    const { svc, ds, dev, sign, photo, site } = await setup();
    await expect(svc.gateIn(dev, { ...sign, kind: 'visitor', visitor: visitor({ host: '' }), photo: photo(1) })).rejects.toThrow(/visiting/);
    const r = await svc.gateIn(dev, { ...sign, kind: 'visitor', visitor: visitor(), vehicle: { plate: 'wxy 1234', plateRead: 'scan' }, photo: photo(2) });
    expect(r.entry.visitor!.idLast4).toBe('5678');
    expect(JSON.stringify(ds.gateEntries)).not.toContain('900101');
    expect(JSON.stringify(ds.audit.slice(-1))).not.toContain('900101');
    expect(r.entry.visitor!.faceCheck).toBe('match');
    expect(r.entry.vehicle).toEqual({ plate: 'WXY1234', plateRead: 'scan', listed: 'allowed' });
    expect(r.entry.flags).toEqual(['FULL_ID_NOT_SEALED']);
    expect(r.entry.inhouse.status).toBe('nothing_sealed');
    expect(r.entry.keepUntil).toBe('2033-10-26');
    expect(ds.evidencePhotos.find((p) => p.id === r.entry.photoIds[0])!.gateEntryId).toBe(r.entry.id);
    expect((await svc.dutyDevice(dev)).inside.some((g) => g.id === r.entry.id)).toBe(true);
    const out = await svc.gateOut(dev, r.entry.id, sign);
    expect(out.outAt).toBe(NOW);
    await expect(svc.gateOut(dev, r.entry.id, sign)).rejects.toThrow(/Already/);
    // The company sees the log; another company does not.
    const log = await svc.siteDutyLog(await svc.user('u-cm-sasa'), site.id);
    expect(log.gates.find((g) => g.id === r.entry.id)!.photos).toHaveLength(1);
    await expect(svc.siteDutyLog(await svc.user('u-cm-inas'), site.id)).rejects.toBeInstanceOf(AccessDenied);
  });

  it('flags a face that does not match, a typed ID and an unknown plate; a plate on watch tells CMS', async () => {
    const { svc, ds, dev, sign, photo } = await setup();
    const r = await svc.gateIn(dev, { ...sign, kind: 'visitor', visitor: visitor({ face: { score: 0.4, live: true }, idRead: 'typed' }), vehicle: { plate: 'ABC9', plateRead: 'typed' }, photo: photo(3) });
    expect(r.entry.flags).toEqual(['FACE_NOT_MATCHED', 'ID_TYPED', 'FULL_ID_NOT_SEALED', 'PLATE_UNKNOWN', 'PLATE_TYPED']);
    expect(r.alarmId).toBeNull();
    const nf = await svc.gateIn(dev, { ...sign, kind: 'visitor', visitor: visitor({ face: null }), photo: photo(4) });
    expect(nf.entry.flags).toContain('FACE_NOT_CHECKED');
    const w = await svc.gateIn(dev, { ...sign, kind: 'vehicle', vehicle: { plate: 'VBA 3311', plateRead: 'scan' }, photo: photo(5) });
    expect(w.entry.flags).toContain('PLATE_ON_WATCH');
    const alarm = ds.siteAlarms.find((a) => a.id === w.alarmId)!;
    expect(alarm.kind).toBe('VEHICLE_WATCH');
    expect(alarm.status).toBe('new');
    // A photo cannot be reused, and a vehicle entry needs a plate.
    await expect(svc.gateIn(dev, { ...sign, kind: 'vehicle', vehicle: { plate: 'WXY1234', plateRead: 'scan' }, photo: photo(5) })).rejects.toThrow(/already used/);
    await expect(svc.gateIn(dev, { ...sign, kind: 'vehicle', vehicle: { plate: '', plateRead: 'scan' }, photo: photo(6) })).rejects.toThrow(/plate/);
  });

  it('seals the full IC number and picture for the in-house server: Prima holds only the sealed copy, the in-house server opens it', async () => {
    const { svc, ds, dev, sign, photo, site } = await setup();
    const key = await makeTestInhouseKey('inhouse-test-1');
    svc.inhouseKey = { keyId: key.keyId, jwk: key.jwk };
    expect((await svc.dutyDevice(dev)).inhouseKey!.keyId).toBe('inhouse-test-1');
    const sealed = await sealForInhouse(svc.inhouseKey, { id_number: '900101-14-5678', id_photo: jpeg(90) });
    const r = await svc.gateIn(dev, { ...sign, kind: 'visitor', clientRef: 'dev-0001-abcd', visitor: visitor({ idNumber: undefined, idLast4: '5678', idRead: 'photo' }), sealed, photo: photo(10) });
    expect(r.entry.flags).toEqual([]);
    expect(r.entry.visitor!.idRead).toBe('photo');
    expect(r.entry.inhouse.status).toBe('queued');
    // Nothing readable in Prima: not in the record, the audit or the screens.
    expect(JSON.stringify(ds.gateEntries)).not.toContain('900101');
    expect(JSON.stringify(ds.audit)).not.toContain('900101');
    const log = await svc.siteDutyLog(await svc.user('u-cm-sasa'), site.id);
    const row = log.gates.find((g) => g.id === r.entry.id)!;
    expect(row).not.toHaveProperty('sealed');
    expect(row.sealedContents).toEqual(['id_number', 'id_photo']);
    expect((await svc.dutyDevice(dev)).inside.find((g) => g.id === r.entry.id)).not.toHaveProperty('sealed');
    // Only the in-house server's own sign-in collects and confirms.
    await expect(svc.inhouseQueue(await svc.user('u-cm-sasa'))).rejects.toBeInstanceOf(AccessDenied);
    const inhouse = await svc.user('u-inhouse-server');
    const q = await svc.inhouseQueue(inhouse);
    expect(q.map((x) => x.id)).toContain(r.entry.id);
    const opened = await openSealed(key.privateJwk, q.find((x) => x.id === r.entry.id)!.sealed);
    expect(opened.id_number).toBe('900101-14-5678');
    // A changed bundle does not open.
    const bad = { ...sealed, plainSha256: '0'.repeat(64) };
    await expect(openSealed(key.privateJwk, bad)).rejects.toThrow(/changed/);
    await expect(svc.inhouseConfirm(await svc.user('u-cm-sasa'), [r.entry.id])).rejects.toBeInstanceOf(AccessDenied);
    expect(await svc.inhouseConfirm(inhouse, [r.entry.id, r.entry.id])).toEqual({ confirmed: 1 });
    expect(ds.gateEntries.find((g) => g.id === r.entry.id)!.inhouse.status).toBe('delivered');
    expect((await svc.inhouseQueue(inhouse)).map((x) => x.id)).not.toContain(r.entry.id);
    // A malformed bundle is refused.
    await expect(svc.gateIn(dev, { ...sign, kind: 'visitor', clientRef: 'dev-0002-abcd', visitor: visitor(), sealed: { ...sealed, alg: 'none' } as never, photo: photo(11) })).rejects.toThrow(/sealed/);
  });

  it('accepts entries written offline once: device time kept, marked sent later, a resend changes nothing', async () => {
    const { svc, ds, dev, sign, photo } = await setup();
    const earlier = myt(TODAY, '08:05');
    const a = await svc.gateIn(dev, { ...sign, kind: 'vehicle', clientRef: 'dev-off-0001', recordedAt: earlier, vehicle: { plate: 'WXY1234', plateRead: 'photo' }, photo: photo(20) });
    expect(a.entry.inAt).toBe(earlier);
    expect(a.entry.receivedAt).toBe(NOW);
    expect(a.entry.flags).toContain('SENT_LATER');
    const again = await svc.gateIn(dev, { ...sign, kind: 'vehicle', clientRef: 'dev-off-0001', recordedAt: earlier, vehicle: { plate: 'WXY1234', plateRead: 'photo' }, photo: photo(20) });
    expect(again.resent).toBe(true);
    expect(ds.gateEntries.filter((g) => g.clientRef === 'dev-off-0001')).toHaveLength(1);
    const out = await svc.gateOut(dev, a.entry.id, { ...sign, recordedAt: myt(TODAY, '09:00') });
    expect(out.outAt).toBe(myt(TODAY, '09:00'));
    expect((await svc.gateOut(dev, a.entry.id, { ...sign, recordedAt: myt(TODAY, '09:00') })).id).toBe(a.entry.id);
    const p1 = await svc.addPostLog(dev, { ...sign, kind: 'routine', text: 'Round done while offline', clientRef: 'dev-pl-0001', recordedAt: earlier });
    const p2 = await svc.addPostLog(dev, { ...sign, kind: 'routine', text: 'Round done while offline', clientRef: 'dev-pl-0001', recordedAt: earlier });
    expect(p2.id).toBe(p1.id);
    expect(p1.at).toBe(earlier);
    expect(ds.postLogs.filter((l) => l.clientRef === 'dev-pl-0001')).toHaveLength(1);
    // Future times and entries older than the offline limit are refused.
    await expect(svc.addPostLog(dev, { ...sign, kind: 'routine', text: 'From the future', clientRef: 'dev-pl-0002', recordedAt: myt(TODAY, '11:30') })).rejects.toThrow(/clock is ahead/);
    await expect(svc.addPostLog(dev, { ...sign, kind: 'routine', text: 'Too old', clientRef: 'dev-pl-0003', recordedAt: myt('2026-10-10', '10:00') })).rejects.toThrow(/older than/);
    await expect(svc.addPostLog(dev, { ...sign, kind: 'routine', text: 'Bad ref', clientRef: 'x' })).rejects.toThrow(/device reference/);
  });

  it('takes a page of the written in/out book: pages sealed for the in-house server, day and line count recorded', async () => {
    const { svc, ds, dev, sign } = await setup();
    const key = await makeTestInhouseKey();
    svc.inhouseKey = { keyId: key.keyId, jwk: key.jwk };
    await expect(svc.gateIn(dev, { ...sign, kind: 'paper_log', clientRef: 'dev-pap-0001', paper: { coversDate: '2026-10-25', lines: 18 } })).rejects.toThrow(/Photograph/);
    const sealed = await sealForInhouse(svc.inhouseKey, { paper_pages: [jpeg(30), jpeg(31)] });
    await expect(svc.gateIn(dev, { ...sign, kind: 'paper_log', clientRef: 'dev-pap-0002', paper: { coversDate: '2026-10-27', lines: 18 }, sealed })).rejects.toThrow(/last 31 days/);
    const r = await svc.gateIn(dev, { ...sign, kind: 'paper_log', clientRef: 'dev-pap-0003', paper: { coversDate: '2026-10-25', lines: 18, note: 'Client guardhouse book' }, sealed });
    expect(r.entry.paper).toEqual({ coversDate: '2026-10-25', lines: 18, note: 'Client guardhouse book' });
    expect(r.entry.outAt).toBe(r.entry.inAt);
    expect(r.entry.inhouse.status).toBe('queued');
    expect((await svc.dutyDevice(dev)).inside.some((g) => g.id === r.entry.id)).toBe(false);
    expect(ds.audit.slice(-1)[0].summary).toMatch(/written book page for 2026-10-25 \(18 lines\)/);
    expect((await openSealed(key.privateJwk, r.entry.sealed!)).paper_pages).toHaveLength(2);
  });
});
