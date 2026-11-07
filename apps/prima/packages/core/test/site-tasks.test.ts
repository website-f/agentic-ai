import { describe, expect, it } from 'vitest';
import { AccessDenied, BadRequest, CLIENT_NEEDS, MemoryStore, NEED_TOPICS, PrimaService, demoPin, generateDataset, myt } from '../src';

// Synthetic data only. Client needs discussed by the OM, and site tasks on the shared device (Fauzan, 6 Nov 2026).
const TODAY = '2026-10-26'; // a Monday
const NOW = myt(TODAY, '10:30');
const jpeg = (n: number) => `data:image/jpeg;base64,${Buffer.from(`synthetic task photo ${n}`).toString('base64')}`;

async function setup(now = NOW) {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => now);
  const dev = await svc.user('u-dev-sasa-001');
  const site = ds.sites.find((s) => s.id === dev.siteIds[0])!;
  const om = await svc.user('u-om-klang');
  const signOf = (role: string) => {
    const p = ds.people.find((x) => x.companyId === site.companyId && x.status === 'active' && x.staffNo && x.pinHash && x.role === role)!;
    return { staffNo: p.staffNo!, pin: demoPin(p.staffNo!) };
  };
  const photo = (n: number) => ({ image: jpeg(n), lat: site.lat, lng: site.lng, accuracyM: 8 });
  return { ds, svc, dev, site, om, signOf, photo };
}

describe('Client needs list and site tasks', () => {
  it('has a discussion list with questions and what can be done for every topic', () => {
    expect(CLIENT_NEEDS.length).toBeGreaterThanOrEqual(8);
    for (const t of NEED_TOPICS) {
      expect(t.ask.length).toBeGreaterThan(0);
      expect(t.canDo.length).toBeGreaterThan(0);
    }
    expect(new Set(NEED_TOPICS.map((t) => t.key)).size).toBe(NEED_TOPICS.length);
  });

  it('the covering OM records the client discussion; the company manager and an OM elsewhere cannot', async () => {
    const { svc, ds, site, om } = await setup();
    const input = { clientContact: 'Principal (sample)', answers: { 'access.visitors': { answer: 'Parents must show IC at pick-up', concern: 'high' as const } }, agreed: 'Check IC against the pick-up list.' };
    const r = await svc.saveNeedsReview(om, site.id, input);
    expect(r.answers['access.visitors'].concern).toBe('high');
    await expect(svc.saveNeedsReview(om, site.id, { ...input, answers: { 'made.up': { answer: 'x', concern: 'low' } } })).rejects.toThrow(/Unknown topic/);
    await expect(svc.saveNeedsReview(om, site.id, { ...input, answers: {} })).rejects.toThrow(/at least one/);
    await expect(svc.saveNeedsReview(await svc.user('u-cm-sasa'), site.id, input)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.saveNeedsReview(await svc.user('u-om-johor'), site.id, input)).rejects.toBeInstanceOf(AccessDenied);
    // The company manager sees the board but may not set tasks.
    const board = await svc.siteTaskBoard(await svc.user('u-cm-sasa'), site.id);
    expect(board.canSet).toBe(false);
    expect(board.reviews[0].id).toBe(r.id);
    expect(ds.audit.some((a) => a.action === 'site.needs_review' && a.summary.includes('high concern'))).toBe(true);
  });

  it('sets tasks that show on the shared device on their days, and only the right rank may sign them off', async () => {
    const { svc, ds, dev, site, om, signOf, photo } = await setup();
    const t = await svc.setSiteTask(om, site.id, { title: 'Lock the back gate and photograph it', forRole: 'guard', days: [1, 2, 3, 4, 5], byTime: '19:00', proof: 'photo', needTopic: 'access.entrances' });
    const sat = await svc.setSiteTask(om, site.id, { title: 'Saturday fence check', forRole: 'guard', days: [6], proof: 'none' });
    const po = await svc.setSiteTask(om, site.id, { title: 'Weekly visit by the patrolling officer', forRole: 'patrol_officer', days: [1], proof: 'none' });
    await expect(svc.setSiteTask(om, site.id, { title: 'No days', forRole: 'guard', proof: 'none' })).rejects.toThrow(/days/);
    await expect(svc.setSiteTask(om, site.id, { title: 'Bad time', forRole: 'guard', days: [1], byTime: '25:00', proof: 'none' })).rejects.toThrow(/Time/);
    await expect(svc.setSiteTask(await svc.user('u-cm-sasa'), site.id, { title: 'Not mine', forRole: 'guard', days: [1], proof: 'none' })).rejects.toBeInstanceOf(AccessDenied);
    const today = (await svc.dutyDevice(dev)).tasks;
    expect(today.map((x) => x.id)).toContain(t.id);
    expect(today.map((x) => x.id)).not.toContain(sat.id);
    // A photo task needs a photo; a guard cannot sign off the patrolling officer's task.
    const guard = signOf('guard');
    await expect(svc.doSiteTask(dev, t.id, { ...guard, result: 'done' })).rejects.toThrow(/photo/);
    await expect(svc.doSiteTask(dev, po.id, { ...guard, result: 'done' })).rejects.toThrow(/patrolling officer/);
    await expect(svc.doSiteTask(dev, sat.id, { ...guard, result: 'done' })).rejects.toThrow(/not due/);
    const log = await svc.doSiteTask(dev, t.id, { ...guard, result: 'done', photo: photo(1) });
    expect(log.photoIds).toHaveLength(1);
    expect(ds.evidencePhotos.find((p) => p.id === log.photoIds[0])!.siteTaskLogId).toBe(log.id);
    await expect(svc.doSiteTask(dev, t.id, { ...guard, result: 'done', photo: photo(2) })).rejects.toThrow(/already/);
    const done = await svc.doSiteTask(dev, po.id, { ...signOf('patrol_officer'), result: 'not_done', note: 'Road flooded, coming tomorrow' });
    expect(done.result).toBe('not_done');
    await expect(svc.doSiteTask(dev, po.id, { ...signOf('patrol_officer'), result: 'not_done', note: '' })).rejects.toBeInstanceOf(BadRequest);
    const after = (await svc.dutyDevice(dev)).tasks;
    expect(after.find((x) => x.id === t.id)!.state).toBe('done');
    // Only the device signs off tasks.
    await expect(svc.doSiteTask(om, t.id, { ...guard, result: 'done', photo: photo(3) })).rejects.toBeInstanceOf(AccessDenied);
  });

  it('shows late, missed and stopped tasks to the OM; an offline sign-off is saved once', async () => {
    const { svc, dev, site, om, signOf, photo } = await setup(myt(TODAY, '21:00'));
    const t = await svc.setSiteTask(om, site.id, { title: 'Lock-up round with photo', forRole: 'officer', days: [0, 1, 2, 3, 4, 5, 6], byTime: '20:00', proof: 'photo' });
    let board = await svc.siteTaskBoard(om, site.id);
    const row = board.tasks.find((x) => x.id === t.id)!;
    expect(row.week[row.week.length - 1].state).toBe('late');
    // Seeded tasks from three days ago were missed on the days before.
    const seeded = board.tasks.find((x) => x.ref.endsWith('T001'))!;
    expect(seeded.week.some((d) => d.state === 'missed')).toBe(true);
    // An officer may do it; written at 20:40 offline, sent twice.
    const rec = myt(TODAY, '20:40');
    const a = await svc.doSiteTask(dev, t.id, { ...signOf('supervisor'), result: 'done', photo: photo(9), recordedAt: rec });
    const b = await svc.doSiteTask(dev, t.id, { ...signOf('supervisor'), result: 'done', photo: photo(9), recordedAt: rec });
    expect(b.id).toBe(a.id);
    expect(a.at).toBe(rec);
    expect(a.late).toBe(true);
    // A late sign-off is shown apart on the OM board, and someone else cannot quietly ride on it.
    const lateRow = (await svc.siteTaskBoard(om, site.id)).tasks.find((x) => x.id === t.id)!;
    expect(lateRow.week[lateRow.week.length - 1].state).toBe('done_late');
    await expect(svc.doSiteTask(dev, t.id, { ...signOf('patrol_officer'), result: 'done', photo: photo(10), recordedAt: rec })).rejects.toThrow(/already recorded/);
    await expect(svc.setSiteTask(om, site.id, { title: 'Bad end date', forRole: 'guard', days: [1], proof: 'none', until: 'soon' as never })).rejects.toThrow(/end date/);
    await expect(svc.stopSiteTask(om, t.id, '')).rejects.toThrow(/why/);
    await svc.stopSiteTask(om, t.id, 'Client now locks up themselves');
    board = await svc.siteTaskBoard(om, site.id);
    expect(board.tasks.find((x) => x.id === t.id)!.status).toBe('stopped');
    expect((await svc.dutyDevice(dev)).tasks.some((x) => x.id === t.id)).toBe(false);
  });

  it('the OM turns gate check-in on the shared device off and on; anyone inside can still be signed out', async () => {
    const { svc, ds, dev, site, om, signOf, photo } = await setup();
    const g = signOf('guard');
    const inside = await svc.gateIn(dev, { ...g, kind: 'vehicle', clientRef: 'dev-gate-off-01', vehicle: { plate: 'WXY1234', plateRead: 'photo' }, photo: photo(40) });
    await expect(svc.setGateLog(await svc.user('u-cm-sasa'), site.id, false, 'Desktop system')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setGateLog(om, site.id, false, '')).rejects.toThrow(/Say how/);
    await svc.setGateLog(om, site.id, false, 'Client desktop visitor system at the lobby');
    expect((await svc.dutyDevice(dev)).gateOn).toBe(false);
    expect((await svc.siteTaskBoard(om, site.id)).gateLog.on).toBe(false);
    await expect(svc.gateIn(dev, { ...g, kind: 'vehicle', clientRef: 'dev-gate-off-02', vehicle: { plate: 'WXY1234', plateRead: 'photo' }, photo: photo(41) })).rejects.toThrow(/off for this site/);
    // A resend of an entry saved before it was turned off still answers.
    expect((await svc.gateIn(dev, { ...g, kind: 'vehicle', clientRef: 'dev-gate-off-01', vehicle: { plate: 'WXY1234', plateRead: 'photo' }, photo: photo(40) })).resent).toBe(true);
    expect((await svc.gateOut(dev, inside.entry.id, g)).outAt).toBeTruthy();
    await expect(svc.setGateLog(om, site.id, false, 'again')).rejects.toThrow(/already off/);
    await svc.setGateLog(om, site.id, true, 'Desktop system broken, use the device');
    expect((await svc.dutyDevice(dev)).gateOn).toBe(true);
    expect(ds.audit.filter((a) => a.action === 'site.gate_log')).toHaveLength(2);
  });
});
