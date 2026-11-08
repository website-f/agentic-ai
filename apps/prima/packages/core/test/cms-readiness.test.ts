// CMS site readiness (audit decision 4, Fauzan 5 Nov 2026). Synthetic seed data only.
import { describe, expect, it } from 'vitest';
import { CMS_READINESS_ITEMS, MemoryStore, PrimaService, generateDataset, looksLikeSecret, readinessFingerprint, readinessView } from '../src';

const TODAY = '2026-11-05';
const NOW = '2026-11-05T02:00:00.000Z';

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
}

const CCTV = {
  kind: 'CCTV_RECORDER' as const,
  brand: 'Brand A',
  model: 'NVR-16',
  count: 1,
  owner: 'client' as const,
  clientChoiceRef: 'Client letter 2026-11-01',
  vendorName: 'Synthetic Installer Sdn Bhd',
  vendorPhone: '+60 3-0000 0000',
  linkMethod: 'ONVIF Profile S',
  linkConfirmed: 'yes' as const,
};

async function fillAll(svc: PrimaService, userId: string, siteId: string) {
  const u = await svc.user(userId);
  await svc.saveCmsReadinessDevice(u, siteId, CCTV);
  for (const spec of CMS_READINESS_ITEMS) {
    await svc.setCmsReadinessAnswer(u, siteId, spec.key, { value: 'yes', note: 'Synthetic note', ref: spec.needsRef ? 'REF-1' : null });
  }
}

describe('CMS site readiness', () => {
  it('lets the company record its own sites, and keeps other companies and outsiders out', async () => {
    const { svc, ds } = fresh();
    const sasa = ds.sites.find((s) => s.companyId === 'co-sasa')!;
    const cm = await svc.user('u-cm-sasa');
    const board = await svc.cmsReadiness(cm);
    expect(board.sites.length).toBeGreaterThan(0);
    expect(board.sites.every((r) => r.site.companyId === 'co-sasa')).toBe(true);
    expect(board.sites.find((r) => r.site.id === sasa.id)!.canRecord).toBe(true);
    expect(board.sites.every((r) => !r.canCheck)).toBe(true);
    expect(board.tiles.connected).toBe(0);

    const res = await svc.saveCmsReadinessDevice(cm, sasa.id, CCTV);
    expect(res.status).toBe('in_progress');
    expect(res.connected).toBe(false);

    // Another company's manager cannot see or change Sasa's site.
    const other = await svc.user('u-cm-arsh');
    expect((await svc.cmsReadiness(other)).sites.some((r) => r.site.id === sasa.id)).toBe(false);
    await expect(svc.saveCmsReadinessDevice(other, sasa.id, CCTV)).rejects.toThrow(/not found/i);
    // HR has no line here.
    await expect(svc.setCmsReadinessAnswer(await svc.user('u-pwvsb-hr'), sasa.id, 'power', { value: 'yes', note: 'UPS' })).rejects.toThrow();
  });

  it('limits a supervisor to their own sites', async () => {
    const { svc, ds } = fresh();
    const sv = await svc.user('u-sv-sasa');
    const mine = (await svc.cmsReadiness(sv)).sites.map((r) => r.site.id).sort();
    expect(mine).toEqual([...sv.siteIds].sort());
    const notMine = ds.sites.find((s) => s.companyId === 'co-sasa' && !sv.siteIds.includes(s.id))!;
    await expect(svc.saveCmsReadinessDevice(sv, notMine.id, CCTV)).rejects.toThrow();
  });

  it('records the client’s brand as given and never treats it as connected', async () => {
    const { svc, ds } = fresh();
    const site = ds.sites.find((s) => s.companyId === 'co-sasa')!;
    const before = ds.siteSystems.filter((x) => x.siteId === site.id).map((x) => ({ ...x }));
    await fillAll(svc, 'u-cm-sasa', site.id);
    const r = ds.sites.find((s) => s.id === site.id)!.cmsReadiness!;
    expect(r.devices[0].brand).toBe('Brand A');
    expect(readinessView(r).status).toBe('ready_for_check');
    // Site systems (the live link record) are untouched.
    expect(ds.siteSystems.filter((x) => x.siteId === site.id)).toEqual(before);
  });

  it('counts unknown and missing as not done, and a vendor "no" as needing a fix', async () => {
    const { svc, ds } = fresh();
    const site = ds.sites.find((s) => s.companyId === 'co-sasa')!;
    const cm = await svc.user('u-cm-sasa');
    let v = await svc.saveCmsReadinessDevice(cm, site.id, { ...CCTV, linkConfirmed: 'unknown', linkMethod: '' });
    expect(v.items.find((i) => i.key === 'links')!.state).toBe('unknown');
    const dev = ds.sites.find((s) => s.id === site.id)!.cmsReadiness!.devices[0];
    v = await svc.saveCmsReadinessDevice(cm, site.id, { ...CCTV, id: dev.id, linkConfirmed: 'no', note: 'Vendor has no open interface' });
    expect(v.items.find((i) => i.key === 'links')!.state).toBe('gap');
    expect(v.status).toBe('needs_fix');
    // CCTV notice is needed only when a camera is listed.
    const empty = readinessView(null);
    expect(empty.status).toBe('not_started');
    expect(empty.items.find((i) => i.key === 'privacyNotice')!.state).toBe('not_needed');
  });

  it('refuses a yes without its proof, a no without a reason, and anything that looks like a password', async () => {
    const { svc, ds } = fresh();
    const site = ds.sites.find((s) => s.companyId === 'co-sasa')!;
    const cm = await svc.user('u-cm-sasa');
    await expect(svc.setCmsReadinessAnswer(cm, site.id, 'consent', { value: 'yes', note: '' })).rejects.toThrow(/proof/i);
    await expect(svc.setCmsReadinessAnswer(cm, site.id, 'power', { value: 'no', note: '' })).rejects.toThrow(/missing/i);
    await expect(svc.setCmsReadinessAnswer(cm, site.id, 'adminHolder', { value: 'yes', note: 'Encik A, password: abc123' })).rejects.toThrow(/password/i);
    await expect(svc.saveCmsReadinessDevice(cm, site.id, { ...CCTV, note: 'pin=1234' })).rejects.toThrow(/password/i);
    await expect(svc.saveCmsReadinessDevice(cm, site.id, { ...CCTV, brand: '' })).rejects.toThrow(/brand/i);
    await expect(svc.setCmsReadinessAnswer(cm, site.id, 'nope' as never, { value: 'yes', note: 'x' })).rejects.toThrow(/unknown/i);
    expect(looksLikeSecret('Admin login held by IT Manager')).toBe(false);
  });

  it('lets Arms Control check, never the person who recorded it, and binds the check to the content seen', async () => {
    const { svc, ds } = fresh();
    const site = ds.sites.find((s) => s.companyId === 'co-sasa')!;
    const arms = await svc.user('u-pwvsb-arms');
    const asst = await svc.user('u-pwvsb-arms-asst');
    await fillAll(svc, 'u-pwvsb-arms', site.id);
    const row = (await svc.cmsReadiness(arms)).sites.find((r) => r.site.id === site.id)!;
    expect(row.recordedPart).toBe(true);
    expect(row.canCheck).toBe(false);
    const fp = row.view.fingerprint;
    await expect(svc.reviewCmsReadiness(arms, site.id, { decision: 'pass', note: 'Looks fine', fingerprint: fp })).rejects.toThrow(/own work/i);

    // The company manager cannot check, even with the right fingerprint.
    await expect(svc.reviewCmsReadiness(await svc.user('u-cm-sasa'), site.id, { decision: 'pass', note: 'ok ok', fingerprint: fp })).rejects.toThrow(/not allowed/i);
    // A reason is required.
    await expect(svc.reviewCmsReadiness(asst, site.id, { decision: 'pass', note: '', fingerprint: fp })).rejects.toThrow(/reason/i);
    // A stale fingerprint is refused.
    await expect(svc.reviewCmsReadiness(asst, site.id, { decision: 'pass', note: 'Checked', fingerprint: 'old' })).rejects.toThrow(/changed/i);

    const done = await svc.reviewCmsReadiness(asst, site.id, { decision: 'pass', note: 'Checked survey and letters', fingerprint: fp });
    expect(done.status).toBe('ready_to_connect');
    expect(done.connected).toBe(false);
    await expect(svc.reviewCmsReadiness(asst, site.id, { decision: 'pass', note: 'Again', fingerprint: fp })).rejects.toThrow(/already/i);
    expect(ds.audit.some((a) => a.action === 'cms.readiness.check' && a.entityId === site.id && a.actor === asst.name)).toBe(true);

    // Any change afterwards voids the check until it is checked again.
    const after = await svc.setCmsReadinessAnswer(await svc.user('u-cm-sasa'), site.id, 'power', { value: 'yes', note: 'UPS 2 hours' });
    expect(after.status).toBe('ready_for_check');
    expect(after.staleCheck?.by).toBe(asst.name);
  });

  it('returns with a reason, and a fix clears the return', async () => {
    const { svc, ds } = fresh();
    const site = ds.sites.find((s) => s.companyId === 'co-sasa')!;
    await fillAll(svc, 'u-cm-sasa', site.id);
    const asst = await svc.user('u-pwvsb-arms-asst');
    const fp = readinessFingerprint(ds.sites.find((s) => s.id === site.id)!.cmsReadiness);
    const back = await svc.reviewCmsReadiness(asst, site.id, { decision: 'return', note: 'Survey photo missing the recorder room', fingerprint: fp });
    expect(back.status).toBe('needs_fix');
    expect(back.returned?.note).toMatch(/recorder room/);
    const fixed = await svc.setCmsReadinessAnswer(await svc.user('u-cm-sasa'), site.id, 'survey', { value: 'yes', note: '', ref: 'REF-2 with recorder room' });
    expect(fixed.status).toBe('ready_for_check');
    expect(fixed.returned).toBeNull();
  });

  it('shows CMS staff the sites without letting them record or check', async () => {
    const { svc, ds } = fresh();
    const site = ds.sites.find((s) => s.companyId === 'co-sasa')!;
    const cms = await svc.user('u-cms-head');
    const board = await svc.cmsReadiness(cms);
    expect(board.sites.length).toBeGreaterThan(0);
    expect(board.sites.every((r) => !r.canRecord && !r.canCheck)).toBe(true);
    await expect(svc.saveCmsReadinessDevice(cms, site.id, CCTV)).rejects.toThrow(/not allowed/i);
  });

  it('ships mock sites at every stage so the screen can be tried', async () => {
    const { svc } = fresh();
    const board = await svc.cmsReadiness(await svc.user('u-pwvsb-arms'));
    const statuses = new Set(board.sites.map((r) => r.view.status));
    for (const s of ['not_started', 'in_progress', 'needs_fix', 'ready_for_check', 'ready_to_connect'] as const) expect(statuses.has(s)).toBe(true);
    expect(board.tiles.connected).toBe(0);
    // The mock check stays valid only because the checker recorded nothing.
    const ready = board.sites.find((r) => r.view.status === 'ready_to_connect')!;
    expect(ready.view.check?.by).toBeTruthy();
    expect(board.sites.find((r) => r.view.status === 'needs_fix' && r.view.returned)).toBeTruthy();
  });
});
