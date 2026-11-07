import { describe, expect, it } from 'vitest';
import { AccessDenied, BadRequest, MemoryStore, PrimaService, RULES, demoPin, generateDataset, myt, toMs, fromMs } from '../src';

// Synthetic data only. CMS messages to site shared devices (Fauzan, 6 Nov 2026).
const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');

function fresh(now = NOW) {
  const ds = generateDataset({ today: TODAY, now: NOW });
  let clock = now;
  const svc = new PrimaService(new MemoryStore(ds), () => clock);
  return { ds, svc, setNow: (t: string) => (clock = t) };
}
const jpeg = (n: number) => `data:image/jpeg;base64,${Buffer.from(`synthetic photo ${n}`).toString('base64')}`;
const webm = (n: number) => `data:video/webm;base64,${Buffer.from(`synthetic clip ${n}`).toString('base64')}`;

async function setup() {
  const f = fresh();
  const dev = await f.svc.user('u-dev-sasa-001');
  const head = await f.svc.user('u-cms-head');
  const site = f.ds.sites.find((s) => s.id === dev.siteIds[0])!;
  const guard = f.ds.people.find((p) => p.companyId === site.companyId && p.status === 'active' && p.staffNo && p.pinHash)!;
  const pin = { staffNo: guard.staffNo!, pin: demoPin(guard.staffNo!) };
  return { ...f, dev, head, site, guard, pin, at: { lat: site.lat, lng: site.lng, accuracyM: 8 } };
}

describe('CMS messages to site shared devices', () => {
  it('CMS sends an urgent alert, the device takes it with PIN, sends stamped photo and video, CMS finds it real and the company gets the case', async () => {
    const { svc, ds, dev, head, site, pin, at } = await setup();
    const d = await svc.sendDispatch(head, { siteId: site.id, level: 'urgent', title: 'Smoke at the gate', message: 'Go to the main gate now and record what you see.', proof: 'photo_or_video' });
    expect(d.status).toBe('sent');
    const onDevice = await svc.deviceDispatches(dev);
    const mine = onDevice.open.find((x) => x.id === d.id)!;
    expect(mine.level).toBe('urgent');
    expect(mine.repeatSec).toBe(RULES.siteDispatch.value.repeatSec.urgent);
    expect((await svc.dispatchSeen(dev, d.id)).status).toBe('received');

    // Proof needs the message taken first, and a wrong PIN is refused.
    await expect(svc.addDispatchPhoto(dev, d.id, { image: jpeg(1), ...at })).rejects.toThrow(/Take the message first/);
    await expect(svc.acknowledgeDispatch(dev, d.id, { staffNo: pin.staffNo, pin: '0000' === pin.pin ? '1111' : '0000' })).rejects.toBeInstanceOf(BadRequest);
    const taken = await svc.acknowledgeDispatch(dev, d.id, pin);
    expect(taken.ack!.staffNo).toBe(pin.staffNo);
    await expect(svc.acknowledgeDispatch(dev, d.id, pin)).rejects.toThrow(/already taken/);

    // Reply needs proof first.
    await expect(svc.replyDispatch(dev, d.id, 'All clear')).rejects.toThrow(/photo or a video/);
    const ph = await svc.addDispatchPhoto(dev, d.id, { image: jpeg(1), ...at, capturedAt: myt(TODAY, '10:29') });
    expect(ph.place).toBe('on_site');
    expect(ph.receivedAt).toBe(NOW);
    expect(ph.sha256).toHaveLength(64);
    await expect(svc.addDispatchPhoto(dev, d.id, { image: jpeg(1), ...at })).rejects.toThrow(/already sent/);
    await expect(svc.addDispatchPhoto(dev, d.id, { image: jpeg(9), lat: null, lng: null })).rejects.toThrow(/geo-tagged/);

    const cam = ds.siteSystems.find((x) => x.kind === 'BODYCAM' && x.siteId === site.id)!;
    const v = await svc.addDispatchVideo(dev, d.id, { video: webm(1), durationSec: 12, source: 'bodycam', bodycamId: cam.id, lat: site.lat + 0.03, lng: site.lng, accuracyM: 10 });
    expect(v.source).toBe('bodycam');
    expect(v.place).toBe('away');
    expect(v.keepUntil > TODAY).toBe(true);
    expect(v.video).toBe('');
    await expect(svc.addDispatchVideo(dev, d.id, { video: webm(2), durationSec: 120, ...at })).rejects.toThrow(/at most/);
    await expect(svc.addDispatchVideo(dev, d.id, { video: 'https://example.com/clip.mp4', durationSec: 5, ...at })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.addDispatchVideo(dev, d.id, { video: webm(3), durationSec: 5, source: 'bodycam', bodycamId: 'sys-other', ...at })).rejects.toThrow(/not linked/);

    const replied = await svc.replyDispatch(dev, d.id, 'Rubbish burning outside the fence, no fire inside');
    expect(replied.status).toBe('proof_sent');

    const view = await svc.cmsDispatches(head);
    const row = view.open.find((x) => x.dispatch.id === d.id)!;
    expect(row.photos).toHaveLength(1);
    expect(row.videos[0].video).not.toBe('');
    const closed = await svc.closeDispatch(head, d.id, 'real', 'Photo and bodycam show smoke at the fence line');
    const c = ds.cases.find((x) => x.id === closed.closed!.caseId)!;
    expect(c.companyId).toBe(site.companyId);
    expect(c.severity).toBe('P1');
    const detail = await svc.caseDetail(await svc.user('u-cm-sasa'), c.id);
    expect(detail.photos.some((p) => p.id === ph.id)).toBe(true);
    expect(detail.videos.some((x) => x.id === v.id)).toBe(true);
    await expect(svc.closeDispatch(head, d.id, 'real', 'again')).rejects.toThrow(/already closed/);
    expect(ds.audit.filter((a) => a.entityId === d.id).map((a) => a.action)).toEqual([
      'cms.dispatch_send',
      'cms.dispatch_ack',
      'cms.dispatch_proof',
      'cms.dispatch_proof',
      'cms.dispatch_reply',
      'cms.dispatch_close',
    ]);
  });

  it('an AI detection stays unverified; nothing found closes the alarm as false for Head Control review', async () => {
    const { svc, ds, dev, head, site, pin, at } = await setup();
    const feed = await svc.user('u-analytics-feed');
    await expect(svc.recordAnalyticsDetection(head, { siteId: site.id, system: 'cctv', device: 'CAM-02', label: 'Person', confidence: 0.9 })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.recordAnalyticsDetection(feed, { siteId: site.id, system: 'cctv', device: 'CAM-02', label: 'Person', confidence: 4 })).rejects.toBeInstanceOf(BadRequest);
    const a = await svc.recordAnalyticsDetection(feed, { siteId: site.id, system: 'cctv', device: 'CAM-02 car park', label: 'Person loitering', confidence: 0.71 });
    expect(a.detection!.verified).toBe(false);
    expect((await svc.cmsDispatches(head)).detections.some((x) => x.alarm.id === a.id && x.device)).toBe(true);

    // An alert must ask for proof.
    await expect(svc.sendDispatch(head, { siteId: site.id, level: 'alert', title: 'Check car park', message: 'Check the car park', proof: 'none', alarmId: a.id })).rejects.toThrow(/verify/);
    const d = await svc.sendDispatch(head, { siteId: site.id, level: 'alert', title: 'Check car park', message: 'Camera 2 shows someone in the car park. Check and take a photo.', proof: 'photo', alarmId: a.id });
    expect(d.origin).toBe('ai_cctv');
    expect(ds.siteAlarms.find((x) => x.id === a.id)!.status).toBe('acknowledged');
    // The device does not see the analytics detail.
    const slim = (await svc.deviceDispatches(dev)).open.find((x) => x.id === d.id)!;
    expect(slim.fromAi).toBe(true);
    expect(JSON.stringify(slim)).not.toContain('loitering');

    await svc.acknowledgeDispatch(dev, d.id, pin);
    await expect(svc.closeDispatch(head, d.id, 'nothing_found', 'Looks clear')).rejects.toThrow(/not sent the proof/);
    await svc.addDispatchPhoto(dev, d.id, { image: jpeg(5), ...at });
    await svc.closeDispatch(head, d.id, 'nothing_found', 'Photo shows an empty car park');
    const alarm = ds.siteAlarms.find((x) => x.id === a.id)!;
    expect(alarm.status).toBe('closed');
    expect(alarm.verdict).toBe('false');
    expect((await svc.cms(head)).ops.falseToReview.some((x) => x.alarm.id === a.id)).toBe(true);
  });

  it('keeps the device to its own site and only the CMS desk sends or closes', async () => {
    const { svc, ds, dev, head, site } = await setup();
    const otherSite = ds.sites.find((s) => s.companyId === site.companyId && s.id !== site.id)!;
    await expect(svc.sendDispatch(head, { siteId: otherSite.id, level: 'instruction', title: 'Lock gate', message: 'Lock the side gate at 22:00', proof: 'none' })).rejects.toThrow(/no shared device/);
    await expect(svc.sendDispatch(await svc.user('u-cm-sasa'), { siteId: site.id, level: 'instruction', title: 'Lock gate', message: 'Lock the side gate', proof: 'none' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.sendDispatch(await svc.user('u-cm-inas'), { siteId: site.id, level: 'urgent', title: 'Go', message: 'Go to the gate', proof: 'photo' })).rejects.toBeInstanceOf(AccessDenied);
    const d = await svc.sendDispatch(head, { siteId: site.id, level: 'instruction', title: 'Lock gate', message: 'Lock the side gate at 22:00', proof: 'none' });
    await expect(svc.deviceDispatches(head)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.cmsDispatches(dev)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.closeDispatch(dev, d.id, 'done', 'done')).rejects.toBeInstanceOf(AccessDenied);
    // A device at another site cannot open it.
    const otherDev = { ...dev, id: 'u-dev-x', siteIds: [otherSite.id] };
    await expect(svc.acknowledgeDispatch(otherDev, d.id, { staffNo: 'X', pin: '1' })).rejects.toThrow();
    // Nobody took it: CMS cannot close it as done, only withdraw it with a reason.
    await expect(svc.closeDispatch(head, d.id, 'done', 'done')).rejects.toThrow(/Nobody at the site/);
    await expect(svc.cancelDispatch(head, d.id, '')).rejects.toThrow(/why/);
    expect((await svc.cancelDispatch(head, d.id, 'Sent to the wrong site')).status).toBe('cancelled');
  });

  it('tells CMS when an urgent alert is not taken in time', async () => {
    const { svc, head, site, setNow } = await setup();
    const d = await svc.sendDispatch(head, { siteId: site.id, level: 'urgent', title: 'Intruder', message: 'Go to the rear fence now', proof: 'video' });
    expect((await svc.cms(head)).alerts.some((a) => a.title.includes(d.ref))).toBe(false);
    setNow(fromMs(toMs(NOW) + (RULES.siteDispatch.value.ackSec.urgent + 5) * 1000));
    const late = (await svc.cms(head)).alerts.find((a) => a.title.includes(d.ref))!;
    expect(late.tone).toBe('crit');
    expect((await svc.cmsDispatches(head)).open.find((x) => x.dispatch.id === d.id)!.ackLate).toBe(true);
  });
});
