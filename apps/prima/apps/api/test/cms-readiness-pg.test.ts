// CMS site readiness on a real PostgreSQL with the company wall (row-level security). Synthetic seed data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';
import { CMS_READINESS_ITEMS } from '@prima/core';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
process.env.DEV_TOKEN_SECRET = process.env.DEV_TOKEN_SECRET ?? 'test-secret';

const DEVICE = {
  kind: 'CCTV_RECORDER' as const,
  brand: 'Brand A',
  model: 'NVR-8',
  count: 1,
  owner: 'client' as const,
  clientChoiceRef: 'Synthetic client letter',
  vendorName: 'Synthetic Installer',
  vendorPhone: '+60 3-0000 0000',
  linkMethod: 'ONVIF Profile S',
  linkConfirmed: 'yes' as const,
};

describe('CMS site readiness on PostgreSQL', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('saves through the company wall, refuses other companies, and binds the check to the content', async () => {
    const board = await db.asUser('u-cm-sasa', (svc, u) => svc.cmsReadiness(u));
    const siteId = board.sites.find((r) => r.site.companyId === 'co-sasa' && r.view.status === 'not_started')!.site.id;
    await db.asUser('u-cm-sasa', (svc, u) => svc.saveCmsReadinessDevice(u, siteId, DEVICE));
    for (const spec of CMS_READINESS_ITEMS) {
      await db.asUser('u-cm-sasa', (svc, u) => svc.setCmsReadinessAnswer(u, siteId, spec.key, { value: 'yes', note: 'Synthetic', ref: spec.needsRef ? 'REF-1' : null }));
    }
    // Another company's manager cannot reach the row at all.
    await assert.rejects(db.asUser('u-cm-arsh', (svc, u) => svc.saveCmsReadinessDevice(u, siteId, DEVICE)), /not found/i);
    const seen = (await db.asUser('u-pwvsb-arms-asst', (svc, u) => svc.cmsReadiness(u))).sites.find((r) => r.site.id === siteId)!;
    assert.equal(seen.view.status, 'ready_for_check');
    assert.equal(seen.canCheck, true);
    await assert.rejects(
      db.asUser('u-pwvsb-arms-asst', (svc, u) => svc.reviewCmsReadiness(u, siteId, { decision: 'pass', note: 'Checked', fingerprint: 'stale' })),
      /changed/i,
    );
    const done = await db.asUser('u-pwvsb-arms-asst', (svc, u) =>
      svc.reviewCmsReadiness(u, siteId, { decision: 'pass', note: 'Checked letters and survey', fingerprint: seen.view.fingerprint }),
    );
    assert.equal(done.status, 'ready_to_connect');
    assert.equal(done.connected, false);
    const again = (await db.asUser('u-cm-sasa', (svc, u) => svc.cmsReadiness(u))).sites.find((r) => r.site.id === siteId)!;
    assert.equal(again.view.status, 'ready_to_connect');
    assert.equal(again.readiness.devices[0].brand, 'Brand A');
  });
});
