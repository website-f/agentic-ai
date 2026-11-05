// CMS commissioning on PostgreSQL 16 with row-level security (masterplan §191 follow-up, 3 Nov 2026). Throwaway local
// database, mock data only: the company manager records the signed scope, the CMS desk verifies contacts under its own
// walls, and company staff or HR cannot verify, accept or read the commissioning list.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

describe('CMS commissioning (database)', () => {
  let db: Db;
  const id = 'ct-cl-st-arsh-001';
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('records the scope as the company manager and lets only the CMS desk verify contacts', async () => {
    const c = await db.asUser('u-cm-arsh', async (_svc, _u, store) => store.get('contracts', id));
    assert.ok(c && c.siteIds.length === 1);
    await assert.rejects(
      db.asUser('u-ae-arsh', (svc, u) => svc.setCmsService(u, id, { sites: [{ siteId: c!.siteIds[0], from: '19:00', to: '07:00' }], services: ['cctv'], signedRef: 'CMS-SOW-DB-01', clientSignatory: 'Sample Signatory', signedOn: '2026-10-20' })),
    );
    const saved = await db.asUser('u-cm-arsh', (svc, u) => svc.setCmsService(u, id, { sites: [{ siteId: c!.siteIds[0], from: '19:00', to: '07:00' }], services: ['cctv'], signedRef: 'CMS-SOW-DB-01', clientSignatory: 'Sample Signatory', signedOn: '2026-10-20' }));
    const svcRec = saved.cmsService!;
    assert.equal(svcRec.version, 1);
    assert.deepEqual(
      svcRec.contacts.map((x) => x.role),
      ['site_supervisor', 'company_manager', 'regional_om'],
    );
    // Company staff, another company and HR cannot verify.
    await assert.rejects(db.asUser('u-ae-arsh', (svc, u) => svc.verifyCmsContact(u, id, 0, 1, 'Test call answered, number confirmed')));
    await assert.rejects(db.asUser('u-cm-inas', (svc, u) => svc.verifyCmsContact(u, id, 0, 1, 'Test call answered, number confirmed')));
    await assert.rejects(db.asUser('u-pwvsb-hr', (svc, u) => svc.verifyCmsContact(u, id, 0, 1, 'Test call answered, number confirmed')));
    // The CMS desk sees the row and verifies under its own walls.
    const desk = await db.asUser('u-cms-head', (svc, u) => svc.cmsCommissioning(u));
    assert.ok(desk.rows.some((r) => r.contractId === id));
    assert.equal(desk.canAccept, false);
    for (let i = 0; i < svcRec.contacts.length; i++) await db.asUser('u-cms-head', (svc, u) => svc.verifyCmsContact(u, id, i, 1, 'Test call answered, number confirmed'));
    const after1 = await db.asUser('u-cm-arsh', async (_svc, _u, store) => store.get('contracts', id));
    assert.ok(after1!.cmsService!.contacts.every((x) => x.verifiedAt));
    // A stale version is refused.
    await assert.rejects(db.asUser('u-pwvsb-arms', (svc, u) => svc.acceptCmsService(u, id, 'operator', 2, { note: 'Ready for night watch' })), /scope changed/);
    // The CMS desk (not Arms Control) cannot accept for operation, and client acceptance waits for CMS.
    await assert.rejects(db.asUser('u-cms-head', (svc, u) => svc.acceptCmsService(u, id, 'operator', 1, { note: 'Ready for night watch' })));
    await assert.rejects(db.asUser('u-cm-arsh', (svc, u) => svc.acceptCmsService(u, id, 'client', 1, { clientName: 'Sample Client', ref: 'ACC-DB-01' })), /accepts the service first/);
    // Acceptance tests (Arisha main, 3 Nov 05:24Z): company staff cannot record one; CCTV needs an up report from the
    // CMS app, which the CMS link writes under its own walls through a status snapshot.
    await assert.rejects(db.asUser('u-ae-arsh', (svc, u) => svc.recordCmsTest(u, id, 1, 'cctv', c!.siteIds[0], 'Live view checked from CMS')));
    await assert.rejects(db.asUser('u-cms-head', (svc, u) => svc.recordCmsTest(u, id, 1, 'cctv', c!.siteIds[0], 'Live view checked from CMS')), /not reported this CCTV up/);
    const snap = await db.asUser('u-cms-link', (svc, u) => svc.cmsIngest(u, { events: [], closedAlarms: [], status: { at: new Date(Date.now() - 60_000).toISOString(), devices: [{ deviceId: 'sys-st-arsh-001-cctv', state: 'online' }] } }));
    assert.equal(snap.statusObserved, 1);
    const tested = await db.asUser('u-cms-head', (svc, u) => svc.recordCmsTest(u, id, 1, 'cctv', c!.siteIds[0], 'Live view checked from CMS'));
    assert.equal(tested.cmsService!.tests![0].basis, 'prima_record');
    // Every step is in the audit trail.
    const audit = await db.asUser('u-cm-arsh', async (_svc, _u, store) => (await store.list('audit', { companyId: 'co-arsh' })).filter((a) => a.action === 'contract.cms_service' && a.entityId === id));
    assert.equal(audit.length, svcRec.contacts.length + 1);
  });

  it('refuses the commissioning list to company staff and HR', async () => {
    await assert.rejects(db.asUser('u-ae-arsh', (svc, u) => svc.cmsCommissioning(u)));
    await assert.rejects(db.asUser('u-pwvsb-hr', (svc, u) => svc.cmsCommissioning(u)));
  });
});
