// CMS commissioning (masterplan §191 follow-up, Fauzan "proceed work", 3 Nov 2026): signed service scope, contacts verified
// by a CMS test call, Arms Control and client acceptance, and coverage measured in contracted minutes. Mock data only.
import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, NotFound, PrimaService, addDays, cmsResponseKpis, contractedCoverage, contractedIntervals, fromMs, generateDataset, myt, observe, observedStateAt, toMs, windowProblem } from '../src';
import type { ObservedSegment, SiteSystem } from '../src';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');
const ID = 'ct-co-arsh-new1';

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  const contract = ds.contracts.find((x) => x.id === ID)!;
  const siteId = ds.sites.find((s) => s.companyId === contract.companyId)!.id;
  contract.siteIds = [siteId];
  ds.siteSystems = ds.siteSystems.filter((x) => x.siteId !== siteId);
  ds.siteSystems.push({ id: 'sys-comm-cctv', companyId: contract.companyId, siteId, kind: 'CCTV', name: 'Sample NVR', linked: true, status: 'online', cameras: 4, camerasOnline: 4, lastHeartbeatAt: NOW, observed: [{ state: 'up', from: myt(TODAY, '10:00'), last: NOW }] });
  if (!ds.users.some((u) => u.role === 'supervisor' && u.siteIds.includes(siteId))) ds.users.find((u) => u.role === 'supervisor')!.siteIds.push(siteId);
  if (!ds.users.some((u) => u.opsTier === 'regional' && u.companyIds.includes(contract.companyId))) ds.users.find((u) => u.opsTier === 'regional')!.companyIds.push(contract.companyId);
  return { ds, store, svc, contract, siteId };
}

/** A linked alarm panel at the site and an acknowledged test alarm from it (synthetic). */
function addPanel(ds: ReturnType<typeof generateDataset>, companyId: string, siteId: string, alarm = true) {
  ds.siteSystems.push({ id: 'sys-comm-panel', companyId, siteId, kind: 'ALARM_PANEL', name: 'Sample panel', linked: true, status: 'online', cameras: null, camerasOnline: null, lastHeartbeatAt: NOW, observed: [{ state: 'up', from: myt(TODAY, '10:00'), last: NOW }] });
  if (alarm) ds.siteAlarms.push(panelAlarm(companyId, siteId, 'ev-panel-test', 'sys-comm-panel', myt(TODAY, '10:05'), true));
}

function panelAlarm(companyId: string, siteId: string, eventId: string, deviceId: string, at: string, acked: boolean) {
  return { id: `cms-${eventId}`, companyId, siteId, kind: 'INTRUSION', source: `CMS app: test (${deviceId})`, at, status: acked ? 'closed' : 'new', ackAt: acked ? at : null, ackBy: acked ? 'Operator' : null, verdict: acked ? 'false' : null, caseId: null, note: null, cmsKind: 'INTRUSION', cmsEventId: eventId, summary: 'Test alarm' } as never;
}

const scope = (siteId: string, over: Record<string, unknown> = {}) => ({
  sites: [{ siteId, from: '19:00', to: '07:00' }],
  services: ['cctv', 'alarm'] as ('cctv' | 'alarm')[],
  signedRef: 'CMS-SOW-TEST-01',
  clientSignatory: 'Sample Client Signatory',
  signedOn: TODAY,
  ...over,
});

async function people(svc: PrimaService) {
  return {
    cm: await svc.user('u-cm-arsh'),
    ae: await svc.user('u-ae-arsh'),
    cmsHead: await svc.user('u-cms-head'),
    arms: await svc.user('u-pwvsb-arms'),
    armsAsst: await svc.user('u-pwvsb-arms-asst'),
  };
}

describe('CMS service scope (company manager)', () => {
  it('validates the signed scope and lists the call-out contacts to verify', async () => {
    const { svc, siteId } = fresh();
    const { cm, ae } = await people(svc);
    await expect(svc.setCmsService(ae, ID, scope(siteId))).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setCmsService(cm, ID, scope(siteId, { signedRef: 'x' }))).rejects.toThrow(/reference of the signed/);
    await expect(svc.setCmsService(cm, ID, scope(siteId, { clientSignatory: '' }))).rejects.toThrow(/signatory/);
    await expect(svc.setCmsService(cm, ID, scope(siteId, { signedOn: addDays(TODAY, 1) }))).rejects.toThrow(/not in the future/);
    await expect(svc.setCmsService(cm, ID, scope(siteId, { signedOn: '2026-02-30' }))).rejects.toThrow(/real date/);
    await expect(svc.setCmsService(cm, ID, scope(siteId, { services: [] }))).rejects.toThrow(/services/);
    await expect(svc.setCmsService(cm, ID, scope(siteId, { services: ['cctv', 'teleport'] }))).rejects.toThrow(/services/);
    await expect(svc.setCmsService(cm, ID, scope(siteId, { sites: [] }))).rejects.toThrow(/Choose the sites/);
    await expect(svc.setCmsService(cm, ID, scope(siteId, { sites: [{ siteId: 'st-not-here', from: '00:00', to: '24:00' }] }))).rejects.toThrow(/not on this contract/);
    await expect(svc.setCmsService(cm, ID, scope(siteId, { sites: [{ siteId, from: '08:00', to: '08:00' }] }))).rejects.toThrow(/no length/);
    await expect(svc.setCmsService(cm, ID, scope(siteId, { sites: [{ siteId, from: '25:00', to: '08:00' }] }))).rejects.toThrow(/HH:MM/);
    const c = await svc.setCmsService(cm, ID, scope(siteId));
    const s = c.cmsService!;
    expect(s.version).toBe(1);
    expect(s.contacts.map((x) => x.role)).toEqual(['site_supervisor', 'company_manager', 'regional_om']);
    expect(s.contacts.every((x) => x.verifiedAt === null)).toBe(true);
    expect(s.operatorAcceptance).toBeNull();
    expect(s.recordedById).toBe(cm.id);
  });

  it('refuses a scope when CMS has nobody to call', async () => {
    const { svc, ds, siteId } = fresh();
    for (const u of ds.users) if (u.role === 'supervisor') u.siteIds = u.siteIds.filter((x) => x !== siteId);
    await expect(svc.setCmsService(await svc.user('u-cm-arsh'), ID, scope(siteId))).rejects.toThrow(/no site supervisor/);
  });
});

describe('contact verification and acceptance', () => {
  it('walks scope, verified contacts, Arms Control acceptance and client acceptance before W12 can be done', async () => {
    const { svc, ds, siteId, contract } = fresh();
    const { cm, ae, cmsHead, arms } = await people(svc);
    addPanel(ds, contract.companyId, siteId);
    const item = ds.contracts.find((x) => x.id === ID)!.mobilisation.find((i) => i.check === 'cms_activation')!;
    await expect(svc.setMobItem(ae, ID, item.id, 'done', 'ok')).rejects.toThrow(/no signed CMS service scope/);
    let c = await svc.setCmsService(cm, ID, scope(siteId));
    // Not the company's own staff, not with an old version, not without a note.
    await expect(svc.verifyCmsContact(ae, ID, 0, 1, 'Test call answered by supervisor')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.verifyCmsContact(cmsHead, ID, 0, 2, 'Test call answered by supervisor')).rejects.toThrow(/scope changed/);
    await expect(svc.verifyCmsContact(cmsHead, ID, 0, 1, 'ok')).rejects.toThrow(/how the contact was verified/);
    await expect(svc.verifyCmsContact(cmsHead, ID, 9, 1, 'Test call answered by supervisor')).rejects.toBeInstanceOf(NotFound);
    // Operator acceptance waits for every contact.
    await expect(svc.acceptCmsService(arms, ID, 'operator', 1, { note: 'Ready for night watch' })).rejects.toThrow(/Verify every call-out contact first/);
    for (let i = 0; i < c.cmsService!.contacts.length; i++) c = await svc.verifyCmsContact(cmsHead, ID, i, 1, 'Test call answered, number confirmed');
    await expect(svc.verifyCmsContact(cmsHead, ID, 0, 1, 'Test call answered again')).rejects.toThrow(/already verified/);
    expect(c.cmsService!.contacts.every((x) => x.verifiedBy === cmsHead.name)).toBe(true);
    // Each signed service is tested at each site before CMS accepts.
    await expect(svc.acceptCmsService(arms, ID, 'operator', 1, { note: 'Ready for night watch' })).rejects.toThrow(/no acceptance test recorded/);
    c = await svc.recordCmsTest(cmsHead, ID, 1, 'cctv', siteId, 'Live view checked from CMS');
    c = await svc.recordCmsTest(cmsHead, ID, 1, 'alarm', siteId, 'Test zone triggered, alarm received');
    expect(c.cmsService!.tests!.map((t) => t.basis)).toEqual(['prima_record', 'prima_record']);
    expect(c.cmsService!.tests![1].evidence).toMatch(/cms-ev-panel-test/);
    // Client acceptance waits for CMS; the CMS desk (not Arms Control) cannot accept for operation.
    await expect(svc.acceptCmsService(cm, ID, 'client', 1, { clientName: 'Sample Client', ref: 'ACC-01' })).rejects.toThrow(/accepts the service first/);
    await expect(svc.acceptCmsService(cmsHead, ID, 'operator', 1, { note: 'Ready for night watch' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.acceptCmsService(arms, ID, 'operator', 1, { note: 'ok' })).rejects.toThrow(/reason/);
    c = await svc.acceptCmsService(arms, ID, 'operator', 1, { note: 'Ready for night watch' });
    await expect(svc.acceptCmsService(arms, ID, 'operator', 1, { note: 'Ready again' })).rejects.toThrow(/already accepted/);
    await expect(svc.setMobItem(ae, ID, item.id, 'done', 'ok')).rejects.toThrow(/no client acceptance recorded/);
    await expect(svc.acceptCmsService(ae, ID, 'client', 1, { clientName: 'Sample Client', ref: 'ACC-01' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.acceptCmsService(cm, ID, 'client', 1, { clientName: 'Sample Client', ref: '' })).rejects.toThrow(/written acceptance/);
    c = await svc.acceptCmsService(cm, ID, 'client', 1, { clientName: 'Sample Client', ref: 'ACC-01' });
    expect(c.cmsService!.clientAcceptance!.recordedBy).toBe(cm.name);
    const done = await svc.setMobItem(ae, ID, item.id, 'done', 'CMS live');
    expect(done.mobilisation.find((i) => i.id === item.id)!.status).toBe('done');
    // Signing a new scope starts again and reopens W12.
    const again = await svc.setCmsService(cm, ID, scope(siteId, { sites: [{ siteId, from: '00:00', to: '24:00' }], signedRef: 'CMS-SOW-TEST-02' }));
    expect(again.cmsService!.version).toBe(2);
    expect(again.cmsService!.operatorAcceptance).toBeNull();
    expect(again.mobilisation.find((i) => i.id === item.id)!.status).toBe('open');
    const audit = ds.audit.filter((a) => a.action === 'contract.cms_service');
    expect(audit.length).toBe(7); // three contacts, two tests, operator, client
    expect(again.cmsService!.tests).toEqual([]);
  });

  it('nobody verifies their own number, and whoever recorded the scope cannot accept it for CMS', async () => {
    const { svc, ds, siteId } = fresh();
    const { cmsHead, arms, armsAsst } = await people(svc);
    await svc.setCmsService(await svc.user('u-cm-arsh'), ID, scope(siteId));
    // Put an Arms Control user on the call-out list and check they cannot verify themselves.
    const fresh2 = ds.contracts.find((x) => x.id === ID)!;
    fresh2.cmsService!.contacts[1] = { ...fresh2.cmsService!.contacts[1], userId: arms.id, name: arms.name };
    await expect(svc.verifyCmsContact(arms, ID, 1, 1, 'Test call answered, number confirmed')).rejects.toThrow(/own contact/);
    // Recorder cannot accept.
    fresh2.cmsService!.recordedById = arms.id;
    for (let i = 0; i < fresh2.cmsService!.contacts.length; i++) if (i !== 1) await svc.verifyCmsContact(cmsHead, ID, i, 1, 'Test call answered, number confirmed');
    await svc.verifyCmsContact(armsAsst, ID, 1, 1, 'Test call answered, number confirmed');
    await expect(svc.acceptCmsService(arms, ID, 'operator', 1, { note: 'Ready for night watch' })).rejects.toThrow(/recorded the scope cannot accept/);
  });

  it('Arms Control cannot accept while the site is technically not ready', async () => {
    const { svc, ds, siteId } = fresh();
    const { cm, cmsHead, arms } = await people(svc);
    let c = await svc.setCmsService(cm, ID, scope(siteId, { services: ['cctv'] }));
    for (let i = 0; i < c.cmsService!.contacts.length; i++) c = await svc.verifyCmsContact(cmsHead, ID, i, 1, 'Test call answered, number confirmed');
    await svc.recordCmsTest(cmsHead, ID, 1, 'cctv', siteId, 'Live view checked from CMS');
    ds.siteSystems.find((x) => x.id === 'sys-comm-cctv')!.lastHeartbeatAt = myt(addDays(TODAY, -3), '10:00');
    await expect(svc.acceptCmsService(arms, ID, 'operator', 1, { note: 'Ready for night watch' })).rejects.toThrow(/Not ready for CMS: .*not heard/);
  });

  it('alarm and patrol scope cannot be commissioned with only CCTV linked (Arisha main, 3 Nov 05:24Z)', async () => {
    const { svc, ds, siteId, contract } = fresh();
    const { cm, ae, cmsHead, arms } = await people(svc);
    let c = await svc.setCmsService(cm, ID, scope(siteId, { services: ['cctv', 'alarm', 'patrol'] }));
    for (let i = 0; i < c.cmsService!.contacts.length; i++) c = await svc.verifyCmsContact(cmsHead, ID, i, 1, 'Test call answered, number confirmed');
    await svc.recordCmsTest(cmsHead, ID, 1, 'cctv', siteId, 'Live view checked from CMS');
    // Only CCTV is linked: the alarm test is refused and acceptance names the missing panel.
    await expect(svc.recordCmsTest(cmsHead, ID, 1, 'alarm', siteId, 'Test zone triggered')).rejects.toThrow(/No alarm panel is linked/);
    await expect(svc.acceptCmsService(arms, ID, 'operator', 1, { note: 'Ready for night watch' })).rejects.toThrow(/Alarm panel response: no alarm panel linked/);
    // A panel with no acknowledged alarm from it is not tested; an alarm from the camera, an unacknowledged or a future
    // panel alarm do not count.
    addPanel(ds, contract.companyId, siteId, false);
    ds.siteAlarms.push(panelAlarm(contract.companyId, siteId, 'ev-cctv-only', 'sys-comm-cctv', myt(TODAY, '10:05'), true));
    ds.siteAlarms.push(panelAlarm(contract.companyId, siteId, 'ev-panel-unack', 'sys-comm-panel', myt(TODAY, '10:05'), false));
    ds.siteAlarms.push(panelAlarm(contract.companyId, siteId, 'ev-panel-future', 'sys-comm-panel', myt(addDays(TODAY, 1), '10:05'), true));
    await expect(svc.recordCmsTest(cmsHead, ID, 1, 'alarm', siteId, 'Test zone triggered')).rejects.toThrow(/No acknowledged CMS alarm from this site's alarm panel/);
    ds.siteAlarms.push(panelAlarm(contract.companyId, siteId, 'ev-panel-ok', 'sys-comm-panel', myt(TODAY, '10:10'), true));
    await svc.recordCmsTest(cmsHead, ID, 1, 'alarm', siteId, 'Test zone triggered, alarm received');
    // Patrol runs in the JA app: attested by the operator and labelled so; company staff cannot record tests.
    await expect(svc.recordCmsTest(ae, ID, 1, 'patrol', siteId, 'Checkpoint scan seen')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.acceptCmsService(arms, ID, 'operator', 1, { note: 'Ready for night watch' })).rejects.toThrow(/Patrol watch: no acceptance test recorded/);
    const p = await svc.recordCmsTest(cmsHead, ID, 1, 'patrol', siteId, 'Checkpoint scan seen on CMS from JA');
    expect(p.cmsService!.tests!.find((t) => t.service === 'patrol')!.basis).toBe('operator_attested');
    await expect(svc.recordCmsTest(cmsHead, ID, 1, 'patrol', siteId, 'Checkpoint scan seen again')).rejects.toThrow(/already recorded/);
    await expect(svc.recordCmsTest(cmsHead, ID, 1, 'attendance', siteId, 'Clock-in seen on CMS')).rejects.toThrow(/not in the signed scope/);
    await expect(svc.recordCmsTest(cmsHead, ID, 2, 'patrol', siteId, 'Checkpoint scan seen again')).rejects.toThrow(/scope changed/);
    const ok = await svc.acceptCmsService(arms, ID, 'operator', 1, { note: 'Ready for night watch' });
    expect(ok.cmsService!.operatorAcceptance).not.toBeNull();
  });

  it('a CCTV test needs a recent up report from the CMS app, not an old or future one', async () => {
    const { svc, ds, siteId } = fresh();
    const { cm, cmsHead } = await people(svc);
    await svc.setCmsService(cm, ID, scope(siteId, { services: ['cctv'] }));
    const cctv = ds.siteSystems.find((x) => x.id === 'sys-comm-cctv')!;
    cctv.observed = [{ state: 'up', from: '2026-01-05T01:00:00+08:00', last: '2026-01-05T01:00:00+08:00' }];
    await expect(svc.recordCmsTest(cmsHead, ID, 1, 'cctv', siteId, 'Live view checked from CMS')).rejects.toThrow(/not reported this CCTV up/);
    cctv.observed = [{ state: 'up', from: myt(addDays(TODAY, 2), '01:00'), last: myt(addDays(TODAY, 2), '01:00') }];
    await expect(svc.recordCmsTest(cmsHead, ID, 1, 'cctv', siteId, 'Live view checked from CMS')).rejects.toThrow(/not reported this CCTV up/);
  });

  it('flags contacts that changed after signing', async () => {
    const { svc, ds, siteId } = fresh();
    await svc.setCmsService(await svc.user('u-cm-arsh'), ID, scope(siteId));
    const c = ds.contracts.find((x) => x.id === ID)!;
    expect((await svc.cmsServiceGaps(c)).some((g) => /contacts changed/.test(g))).toBe(false);
    c.cmsService!.contacts[0] = { ...c.cmsService!.contacts[0], userId: 'u-somebody-else' };
    expect((await svc.cmsServiceGaps(c)).some((g) => /contacts changed/.test(g))).toBe(true);
  });

  it('the CMS desk lists commissioning work; company staff and HR are refused', async () => {
    const { svc, siteId } = fresh();
    const { cm, ae, cmsHead, arms } = await people(svc);
    await svc.setCmsService(cm, ID, scope(siteId));
    const desk = await svc.cmsCommissioning(cmsHead);
    expect(desk.canAccept).toBe(false);
    const row = desk.rows.find((r) => r.contractId === ID)!;
    expect(row.gaps.some((g) => /not verified by a CMS test call/.test(g))).toBe(true);
    expect((await svc.cmsCommissioning(arms)).canAccept).toBe(true);
    await expect(svc.cmsCommissioning(ae)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.cmsCommissioning(await svc.user('u-pwvsb-hr'))).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('coverage in contracted minutes', () => {
  const sys = (over: Partial<SiteSystem> = {}): SiteSystem => ({ id: 's1', companyId: 'co', siteId: 'st', kind: 'CCTV', name: 'NVR', linked: true, status: 'online', cameras: 1, camerasOnline: 1, lastHeartbeatAt: myt(TODAY, '09:00'), ...over });
  const day = [toMs(myt(addDays(TODAY, -1), '10:30')), toMs(NOW)] as const;

  it('checks windows', () => {
    expect(windowProblem('00:00', '24:00')).toBeNull();
    expect(windowProblem('19:00', '07:00')).toBeNull();
    expect(windowProblem('07:00', '07:00')).toMatch(/no length/);
    expect(windowProblem('7:00', '09:00')).toMatch(/HH:MM/);
    expect(windowProblem('00:00', '24:30')).toMatch(/HH:MM/);
  });

  it('counts a night window across midnight and a whole day', () => {
    const night = contractedIntervals({ from: '19:00', to: '07:00' }, day[0], day[1]);
    expect(night.reduce((n, [s, e]) => n + (e - s), 0) / 60_000).toBe(720);
    const whole = contractedIntervals({ from: '00:00', to: '24:00' }, day[0], day[1]);
    expect(whole.reduce((n, [s, e]) => n + (e - s), 0) / 60_000).toBe(1440);
    const office = contractedIntervals({ from: '09:00', to: '17:00' }, day[0], day[1]);
    // 25 Oct 10:30-17:00 (390) + 26 Oct 09:00-10:30 (90)
    expect(office.reduce((n, [s, e]) => n + (e - s), 0) / 60_000).toBe(480);
  });

  const at = (d: number, hhmm: string) => myt(addDays(TODAY, d), hhmm);
  const build = (obs: ['up' | 'down', string][]) => obs.reduce((l, [st, t]) => observe(l, st, t), [] as ObservedSegment[]);
  const snapshots = (from: string, to: string, everyMin = 5) => {
    const out: ['up', string][] = [];
    for (let t = toMs(from); t <= toMs(to); t += everyMin * 60_000) out.push(['up', fromMs(t)]);
    return out;
  };

  it('Arisha 1: a system last heard in January is unknown in October, never reachable', () => {
    const jan = sys({ status: 'unknown', lastHeartbeatAt: '2026-01-05T01:00:00+08:00', observed: build([['up', '2026-01-05T01:00:00+08:00']]) });
    const whole = contractedCoverage('st', { from: '00:00', to: '24:00' }, [jan], toMs(at(-1, '00:00')), toMs(at(0, '00:00')));
    expect(whole).toMatchObject({ contractedMin: 1440, reachableMin: 0, downMin: 0, unknownMin: 1440, reachablePct: 0 });
  });

  it('Arisha 2: a first report at 23:59 credits only the time from 23:59, not the day before it', () => {
    const late = sys({ observed: build([['up', at(-1, '23:59')]]) });
    const r = contractedCoverage('st', { from: '00:00', to: '24:00' }, [late], toMs(at(-1, '00:00')), toMs(at(0, '00:00')));
    expect(r).toMatchObject({ reachableMin: 1, unknownMin: 1439, downMin: 0 });
  });

  it('Arisha 3: OFF 01:00, ON 02:00, then a late OFF stamped 01:30 gives 60 down minutes, in any arrival order', () => {
    const s1 = sys({ observed: build([['down', at(0, '01:00')], ['up', at(0, '02:00')], ['down', at(0, '01:30')]]) });
    const r = contractedCoverage('st', { from: '00:00', to: '24:00' }, [s1], toMs(at(0, '00:00')), toMs(at(0, '03:00')));
    expect(r.downMin).toBe(60);
    expect(r.reachableMin).toBe(15); // 02:00 plus the 15 minute evidence window; nothing reported after
    expect(r.unknownMin).toBe(180 - 60 - 15);
    const orders: ['up' | 'down', string][][] = [
      [['down', at(0, '01:30')], ['down', at(0, '01:00')], ['up', at(0, '02:00')]],
      [['up', at(0, '02:00')], ['down', at(0, '01:30')], ['down', at(0, '01:00')]],
    ];
    for (const o of orders) expect(contractedCoverage('st', { from: '00:00', to: '24:00' }, [sys({ observed: build(o) })], toMs(at(0, '00:00')), toMs(at(0, '03:00'))).downMin).toBe(60);
  });

  it('counts reachable only while status reports keep coming, down only when every system was down', () => {
    const w = { from: '19:00', to: '07:00' };
    const day = [toMs(at(-1, '10:30')), toMs(NOW)] as const;
    // Reports every 5 minutes all night, except an outage 23:00-01:00.
    const steady = sys({ observed: build([...snapshots(at(-1, '19:00'), at(-1, '22:55')), ['down', at(-1, '23:00')], ...snapshots(at(0, '01:00'), at(0, '07:00'))]) });
    expect(contractedCoverage('st', w, [steady], day[0], day[1])).toMatchObject({ contractedMin: 720, downMin: 120, reachableMin: 600, unknownMin: 0 });
    // A second system up at the time: CMS still reached the site.
    const other = sys({ id: 's2', observed: build(snapshots(at(-1, '19:00'), at(0, '07:00'))) });
    expect(contractedCoverage('st', w, [steady, other], day[0], day[1]).downMin).toBe(0);
    // Reports that stop: unknown 15 minutes after the last one, never covered.
    const stops = sys({ observed: build(snapshots(at(-1, '19:00'), at(-1, '20:00'))) });
    expect(contractedCoverage('st', w, [stops], day[0], day[1])).toMatchObject({ reachableMin: 75, unknownMin: 645 });
    // A down report with nothing after it is down for the evidence window, then unknown.
    expect(contractedCoverage('st', w, [sys({ observed: build([['down', at(0, '06:00')]]) })], day[0], day[1])).toMatchObject({ downMin: 15, unknownMin: 705 });
    // One system down and the other never heard from: unknown, not down and not covered.
    expect(contractedCoverage('st', w, [sys({ observed: build([['down', at(-1, '19:00')], ['down', at(0, '07:00')]]) }), sys({ id: 's3' })], day[0], day[1])).toMatchObject({ downMin: 0, reachableMin: 0, unknownMin: 720 });
    // Never observed, no system, unlinked: all unknown.
    expect(contractedCoverage('st', w, [sys()], day[0], day[1])).toMatchObject({ unknownMin: 720, reachableMin: 0 });
    expect(contractedCoverage('st', w, [], day[0], day[1]).unknownMin).toBe(720);
    expect(contractedCoverage('st', w, [sys({ linked: false, observed: build(snapshots(at(-1, '19:00'), at(0, '07:00'))) })], day[0], day[1]).unknownMin).toBe(720);
    // Reports in the future are not evidence.
    expect(contractedCoverage('st', w, [sys({ observed: build([['up', at(30, '01:00')]]) })], day[0], day[1]).unknownMin).toBe(720);
  });

  it('keeps runs compact and in time order whatever order observations arrive in', () => {
    const forward = build(snapshots(at(0, '01:00'), at(0, '03:00')));
    expect(forward).toEqual([{ state: 'up', from: at(0, '01:00'), last: at(0, '03:00') }]);
    expect(build(snapshots(at(0, '01:00'), at(0, '03:00')).reverse())).toEqual(forward);
    // A gap longer than the evidence window starts a new run.
    expect(build([['up', at(0, '01:00')], ['up', at(0, '01:30')]]).length).toBe(2);
    // A late down inside an up run splits it; the rest of the run counts as down until its last report.
    const split = build([...snapshots(at(0, '01:00'), at(0, '02:00')), ['down', at(0, '01:30')]]);
    expect(split.map((x) => x.state)).toEqual(['up', 'down', 'up']);
    expect(observedStateAt(split, toMs(at(0, '02:05')))).toBe('up');
    expect(observedStateAt(split, toMs(at(0, '03:00')))).toBe('unknown');
    let many: ObservedSegment[] = [];
    for (let i = 0; i < 600; i++) many = observe(many, i % 2 ? 'up' : 'down', fromMs(toMs(at(0, '00:00')) + i * 60_000));
    expect(many.length).toBe(500);
  });

  it('the CMS app status snapshot and device events become observations in Prima, in time order', async () => {
    const { svc, ds } = fresh();
    const feed = await svc.user('u-cms-link');
    const sysId = 'sys-st-sasa-003-cctv';
    const ev = (id: string, kind: string, t: string) => ({ id, kind, companyId: 'co-sasa', siteId: 'st-sasa-003', deviceId: sysId, source: 'test', occurredAt: t, receivedAt: t, summary: kind, detail: {} });
    const iso = (hhmm: string) => new Date(toMs(at(0, hhmm))).toISOString();
    await svc.cmsIngest(feed, { events: [ev('evt-off-commission-1', 'DEVICE_OFFLINE', iso('01:00'))], closedAlarms: [] });
    await svc.cmsIngest(feed, { events: [ev('evt-on-commission-1', 'DEVICE_ONLINE', iso('02:00'))], closedAlarms: [] });
    // A late OFF stamped 01:30 arrives after the ON: the shown status stays online.
    const late = await svc.cmsIngest(feed, { events: [ev('evt-off-commission-2', 'DEVICE_OFFLINE', iso('01:30'))], closedAlarms: [] });
    expect(late.health).toBe(1);
    const sys1 = ds.siteSystems.find((x) => x.id === sysId)!;
    expect(sys1.status).toBe('online');
    expect(sys1.observed!.map((x) => x.state)).toEqual(['down', 'up']);
    // A status snapshot: online devices become up observations; unknown states and unknown devices are skipped.
    const r = await svc.cmsIngest(feed, { events: [], closedAlarms: [], status: { at: iso('02:05'), devices: [{ deviceId: sysId, state: 'online' }, { deviceId: 'sys-nope', state: 'online' }, { deviceId: sysId, state: 'unknown' }] } });
    expect(r.statusObserved).toBe(1);
    expect(ds.siteSystems.find((x) => x.id === sysId)!.observed!.at(-1)).toEqual({ state: 'up', from: fromMs(toMs(at(0, '02:00'))), last: fromMs(toMs(at(0, '02:05'))) });
    // A snapshot dated well in the future is not evidence.
    const ahead = await svc.cmsIngest(feed, { events: [], closedAlarms: [], status: { at: new Date(toMs(NOW) + 3_600_000).toISOString(), devices: [{ deviceId: sysId, state: 'online' }] } });
    expect(ahead.statusObserved).toBe(0);
  });

  it('the CMS board shows contracted minutes and counts contracts without a signed scope', async () => {
    const { ds, siteId, contract } = fresh();
    const companies = ds.companies.filter((c) => c.id === contract.companyId);
    const none = cmsResponseKpis(companies, [], ds.siteSystems, ds.sites, 120, toMs(NOW), [contract]);
    expect(none.contracted.contractsWithoutScope).toBeGreaterThanOrEqual(0);
    contract.cmsService = { version: 1, sites: [{ siteId, from: '19:00', to: '07:00' }], services: ['cctv'], signedRef: 'R', clientSignatory: 'S', signedOn: TODAY, recordedBy: 'x', recordedById: 'x', recordedAt: NOW, contacts: [], operatorAcceptance: null, clientAcceptance: null };
    // Reports every 5 minutes all night except an outage 05:00-06:00.
    let obs: ObservedSegment[] = [];
    for (let t = toMs(myt(addDays(TODAY, -1), '19:00')); t <= toMs(myt(TODAY, '07:00')); t += 5 * 60_000) {
      const d = t >= toMs(myt(TODAY, '05:00')) && t < toMs(myt(TODAY, '06:00'));
      obs = observe(obs, d ? 'down' : 'up', fromMs(t));
    }
    ds.siteSystems.find((x) => x.id === 'sys-comm-cctv')!.observed = obs;
    const k = cmsResponseKpis(companies, [], ds.siteSystems, ds.sites, 120, toMs(NOW), [contract]);
    expect(k.contracted).toMatchObject({ contractedMin: 720, downMin: 60, reachableMin: 660, unknownMin: 0 });
  });
});

