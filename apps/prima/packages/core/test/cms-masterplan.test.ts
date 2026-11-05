// Masterplan §191 (CMS activation in client mobilisation) and §195 (CMS coverage and response KPIs), 3 Nov 2026.
// Mock data only, in memory. §193 (CMS restart and saved state) is tested in apps/cms.
import { describe, expect, it } from 'vitest';
import { AccessDenied, BadRequest, CMS_ACTIVATION_LABEL, MemoryStore, PrimaService, addDays, cmsResponseKpis, generateDataset, myt, toMs } from '../src';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => NOW) };
}

describe('§191 CMS activation during client mobilisation', () => {
  it('adds the CMS step to every new mobilisation, last, so earlier item ids do not change', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-arsh');
    const c = (await svc.contracts(cm)).rows.find((r) => r.contract.id === 'ct-co-arsh-new1')!.contract;
    const last = c.mobilisation.at(-1)!;
    expect(last.workstream).toBe('W12');
    expect(last.check).toBe('cms_activation');
    expect(last.label).toBe(CMS_ACTIVATION_LABEL);
    expect(last.critical).toBe(false);
    expect(c.mobilisation.filter((i) => i.check === 'cms_activation')).toHaveLength(1);
  });

  it('cannot be ticked by hand: Prima checks the link, a signal from CMS and the call-out contacts first', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-arsh');
    const ae = await svc.user('u-ae-arsh');
    const id = 'ct-co-arsh-new1';
    const contract = ds.contracts.find((x) => x.id === id)!;
    const item = contract.mobilisation.find((i) => i.check === 'cms_activation')!;
    // A new client: the contract has no site until one is recorded.
    expect(contract.siteIds).toEqual([]);
    await expect(svc.setMobItem(ae, id, item.id, 'done', '')).rejects.toThrow(/no site is on this contract yet/);
    // Start from one site with nothing linked.
    const siteId = ds.sites.find((s) => s.companyId === contract.companyId)!.id;
    contract.siteIds = [siteId];
    ds.siteSystems = ds.siteSystems.filter((x) => x.siteId !== siteId);
    ds.siteAlarms = ds.siteAlarms.filter((x) => x.siteId !== siteId);
    await expect(svc.setMobItem(ae, id, item.id, 'done', '')).rejects.toThrow(/CMS is not active yet: .*no CCTV or alarm panel linked and tested/);
    // Linked but silent for more than a day: still refused.
    ds.siteSystems.push({
      id: 'sys-test-cctv',
      companyId: contract.companyId,
      siteId,
      kind: 'CCTV',
      name: 'Sample NVR',
      linked: true,
      status: 'online',
      cameras: 4,
      camerasOnline: 4,
      lastHeartbeatAt: myt(addDays(TODAY, -2), '10:00'),
    });
    await expect(svc.setMobItem(ae, id, item.id, 'done', '')).rejects.toThrow(/has not heard from it in the last 24 hours/);
    // A test alarm sent through the CMS app counts as CMS hearing from the site.
    ds.siteAlarms.push({
      id: 'cms-test-1',
      companyId: contract.companyId,
      siteId,
      kind: 'INTRUSION',
      source: 'CMS app: test',
      at: myt(TODAY, '10:00'),
      status: 'closed',
      ackAt: myt(TODAY, '10:01'),
      ackBy: 'CMS app',
      verdict: 'false',
      caseId: null,
      note: 'Test alarm during mobilisation',
      cmsKind: 'INTRUSION',
      cmsEventId: 'ev-test-1',
      summary: 'Test alarm',
    } as (typeof ds.siteAlarms)[number]);
    // Contacts: without a site supervisor CMS has nobody on site to call.
    const sups = ds.users.filter((u) => u.role === 'supervisor' && u.siteIds.includes(siteId));
    for (const u of sups) u.siteIds = u.siteIds.filter((x) => x !== siteId);
    const missing = await svc.cmsActivationGaps(contract.companyId, contract.siteIds);
    expect(missing.some((m) => /no site supervisor/.test(m))).toBe(true);
    expect(missing.some((m) => /linked and tested|not heard/.test(m) && m.includes(ds.sites.find((s) => s.id === siteId)!.name))).toBe(false);
    for (const u of sups) u.siteIds.push(siteId);
    if (!sups.length) ds.users.find((u) => u.role === 'supervisor')!.siteIds.push(siteId);
    // Without a Regional OM CMS has nobody above the company to call.
    const regional = ds.users.filter((u) => u.opsTier === 'regional' && u.companyIds.includes(contract.companyId));
    for (const u of regional) u.companyIds = u.companyIds.filter((x) => x !== contract.companyId);
    // A Regional OM also covers a company through the region's monitoring grant; take those away too.
    const romGrants = ds.grants.filter((g) => g.companyId === contract.companyId && ds.users.some((u) => u.id === g.userId && u.opsTier === 'regional'));
    ds.grants = ds.grants.filter((g) => !romGrants.includes(g));
    await expect(svc.setMobItem(ae, id, item.id, 'done', '')).rejects.toThrow(/no Regional OM for CMS to call/);
    ds.grants.push(...romGrants);
    if (!romGrants.length) ds.users.find((u) => u.opsTier === 'regional')!.companyIds.push(contract.companyId);
    expect(await svc.cmsActivationGaps(contract.companyId, contract.siteIds)).toEqual([]);
    // Technically ready, but the signed scope, verified contacts and acceptances are still missing (cms-commissioning.test.ts).
    await expect(svc.setMobItem(ae, id, item.id, 'done', 'Test alarm received by CMS')).rejects.toThrow(/no signed CMS service scope recorded/);
  });

  it('may be risk-accepted by the company manager for a site with no CMS equipment yet, with a reason and a date', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-arsh');
    const ae = await svc.user('u-ae-arsh');
    const id = 'ct-co-arsh-new1';
    const item = ds.contracts.find((x) => x.id === id)!.mobilisation.find((i) => i.check === 'cms_activation')!;
    await expect(svc.setMobItem(ae, id, item.id, 'risk_accepted', 'No panel yet', addDays(TODAY, 10))).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setMobItem(cm, id, item.id, 'risk_accepted', '', addDays(TODAY, 10))).rejects.toBeInstanceOf(BadRequest);
    const r = await svc.setMobItem(cm, id, item.id, 'risk_accepted', 'Client panel installed in week 2', addDays(TODAY, 10));
    expect(r.mobilisation.find((i) => i.id === item.id)!.status).toBe('risk_accepted');
  });

  it('never counts a heartbeat or test alarm dated in the future as CMS having heard from the site (Arisha 03:32Z)', async () => {
    const { svc, ds } = fresh();
    const contract = ds.contracts.find((x) => x.id === 'ct-co-arsh-new1')!;
    const siteId = ds.sites.find((s) => s.companyId === contract.companyId)!.id;
    ds.siteSystems = ds.siteSystems.filter((x) => x.siteId !== siteId);
    ds.siteAlarms = ds.siteAlarms.filter((x) => x.siteId !== siteId);
    const silent = /has not heard from it in the last 24 hours/;
    const gaps = () => svc.cmsActivationGaps(contract.companyId, [siteId]);
    ds.siteSystems.push({ id: 'sys-future', companyId: contract.companyId, siteId, kind: 'CCTV', name: 'Sample NVR', linked: true, status: 'online', cameras: 2, camerasOnline: 2, lastHeartbeatAt: myt(addDays(TODAY, 365), '10:00') });
    expect((await gaps()).some((m) => silent.test(m))).toBe(true); // one year ahead
    ds.siteSystems[ds.siteSystems.length - 1].lastHeartbeatAt = myt(TODAY, '10:31'); // one minute ahead
    expect((await gaps()).some((m) => silent.test(m))).toBe(true);
    ds.siteSystems[ds.siteSystems.length - 1].lastHeartbeatAt = null;
    ds.siteAlarms.push({ id: 'cms-future', companyId: contract.companyId, siteId, kind: 'INTRUSION', source: 'CMS app: test', at: myt(addDays(TODAY, 365), '10:00'), status: 'new', ackAt: null, ackBy: null, verdict: null, caseId: null, note: null, cmsKind: 'INTRUSION', cmsEventId: 'ev-future', summary: 'Test alarm' } as (typeof ds.siteAlarms)[number]);
    expect((await gaps()).some((m) => silent.test(m))).toBe(true);
    // The edges still count: exactly now, and exactly 24 hours ago.
    ds.siteSystems[ds.siteSystems.length - 1].lastHeartbeatAt = NOW;
    expect((await gaps()).some((m) => silent.test(m))).toBe(false);
    ds.siteSystems[ds.siteSystems.length - 1].lastHeartbeatAt = myt(addDays(TODAY, -1), '10:30');
    expect((await gaps()).some((m) => silent.test(m))).toBe(false);
  });

  it('refuses when the contract has no site yet', async () => {
    const { svc } = fresh();
    expect(await svc.cmsActivationGaps('co-arsh', [])).toEqual(['no site is on this contract yet']);
  });
});

describe('§195 CMS coverage and response KPIs', () => {
  it('shows time to acknowledge against the CMS setting, waiting alarms, false alarms and unknown systems on the CMS board', async () => {
    const { svc, ds } = fresh();
    const head = await svc.user('u-cms-head');
    const k = (await svc.cms(head)).ops.kpis;
    const set = (await svc.cms(head)).settings;
    expect(k.targetSec).toBe(set.alarmAckSec);
    const nowMs = toMs(NOW);
    const recent = ds.siteAlarms.filter((a) => toMs(a.at) >= nowMs - 86_400_000 && toMs(a.at) <= nowMs);
    expect(k.all.alarms).toBe(recent.length);
    expect(k.all.waitingOverTarget).toBe(recent.filter((a) => a.status === 'new' && (nowMs - toMs(a.at)) / 1000 > set.alarmAckSec).length);
    const linked = ds.siteSystems.filter((x) => x.linked);
    expect(k.coverage.linkedSystems).toBe(linked.length);
    expect(k.coverage.unknown).toBe(linked.filter((x) => x.status === 'unknown').length);
    expect(k.coverage.online).toBe(linked.filter((x) => x.status === 'online').length);
    expect(k.byCompany.reduce((n, c) => n + c.alarms, 0)).toBe(k.all.alarms);
    // Acknowledging a waiting alarm moves it from waiting to acknowledged.
    const waiting = recent.find((a) => a.status === 'new')!;
    await svc.acknowledgeAlarm(head, waiting.id);
    const k2 = (await svc.cms(head)).ops.kpis;
    expect(k2.all.acknowledged).toBe(k.all.acknowledged + 1);
    expect(k2.all.waitingOverTarget).toBeLessThanOrEqual(k.all.waitingOverTarget);
  });

  it('works out medians, the 90% figure, over-target counts and the false rate exactly', () => {
    const at = (min: number) => myt(TODAY, `10:${String(min).padStart(2, '0')}`);
    const base = { companyId: 'co-x', siteId: 's-1', kind: 'INTRUSION', source: 't', verdict: null, caseId: null, note: null, cmsKind: null, cmsEventId: null, summary: 's', ackBy: 'op' };
    const alarms = [
      { ...base, id: 'a1', at: at(0), ackAt: at(1), status: 'closed', verdict: 'false' },
      { ...base, id: 'a2', at: at(0), ackAt: at(3), status: 'closed', verdict: 'real' },
      { ...base, id: 'a3', at: at(10), ackAt: null, status: 'new' },
      { ...base, id: 'a4', at: at(29), ackAt: null, status: 'new' },
    ] as unknown as Parameters<typeof cmsResponseKpis>[1];
    const systems = [
      { id: 'y1', companyId: 'co-x', siteId: 's-1', kind: 'CCTV', name: 'n', linked: true, status: 'unknown', cameras: 1, camerasOnline: 0, lastHeartbeatAt: null },
      { id: 'y2', companyId: 'co-x', siteId: 's-1', kind: 'ALARM_PANEL', name: 'p', linked: true, status: 'online', cameras: null, camerasOnline: null, lastHeartbeatAt: NOW },
      { id: 'y3', companyId: 'co-x', siteId: 's-2', kind: 'CCTV', name: 'n', linked: false, status: 'online', cameras: 1, camerasOnline: 1, lastHeartbeatAt: NOW },
    ] as Parameters<typeof cmsResponseKpis>[2];
    const sites = [
      { id: 's-1', companyId: 'co-x' },
      { id: 's-2', companyId: 'co-x' },
    ] as Parameters<typeof cmsResponseKpis>[3];
    const k = cmsResponseKpis([{ id: 'co-x', name: 'Sample Co' }] as Parameters<typeof cmsResponseKpis>[0], alarms, systems, sites, 60, toMs(at(30)));
    expect(k.all).toMatchObject({ alarms: 4, acknowledged: 2, ackMedianSec: 60, ackP90Sec: 180, ackOverTarget: 1, waitingOverTarget: 1, closed: 2, falseAlarms: 1, falseRatePct: 50 });
    // A system that was never linked is not counted; an unlinked site is listed; unknown is not online.
    expect(k.coverage).toEqual({ linkedSystems: 2, online: 1, offline: 0, unknown: 1, unknownPct: 50, sitesNotLinked: 1 });
    expect(k.byCompany[0].companyName).toBe('Sample Co');
  });

  it('stays behind the CMS desk wall', async () => {
    const { svc } = fresh();
    await expect(svc.cms(await svc.user('u-pwvsb-hr'))).rejects.toBeInstanceOf(AccessDenied);
  });
});
