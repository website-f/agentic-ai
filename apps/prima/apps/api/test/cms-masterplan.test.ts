// Masterplan §191 and §195 on PostgreSQL 16 with row-level security. Throwaway local database, mock data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

describe('CMS activation and KPIs (database)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('checks CMS activation with what the company user can see, and refuses the step for a contract without a site', async () => {
    const id = 'ct-co-arsh-new1';
    const c = await db.asUser('u-ae-arsh', async (_svc, _u, store) => store.get('contracts', id));
    assert.ok(c);
    const item = c!.mobilisation.find((i) => i.check === 'cms_activation');
    assert.ok(item, 'the new contract carries the CMS step');
    await assert.rejects(
      db.asUser('u-ae-arsh', (svc, u) => svc.setMobItem(u, id, item!.id, 'done', '')),
      /no site is on this contract yet/,
    );
    const site = await db.asUser('u-ae-arsh', async (_svc, _u, store) => (await store.list('sites', { companyId: 'co-arsh' }))[0]);
    const gaps = await db.asUser('u-ae-arsh', (svc) => svc.cmsActivationGaps('co-arsh', [site.id]));
    // Under the company wall the user still finds its own company manager: no false "nobody to call".
    assert.ok(!gaps.includes('no company manager for CMS to call'), gaps.join('; '));
    // Another company's executive reads nothing of this contract.
    assert.equal(await db.asUser('u-cm-inas', async (_svc, _u, store) => store.get('contracts', id)), undefined);
  });

  it('serves the response and coverage KPIs on the CMS board, and refuses HR', async () => {
    const b = await db.asUser('u-cms-head', (svc, u) => svc.cms(u));
    const k = b.ops.kpis;
    assert.equal(k.targetSec, b.settings.alarmAckSec);
    assert.ok(k.coverage.linkedSystems > 0);
    assert.equal(k.coverage.online + k.coverage.offline + k.coverage.unknown <= k.coverage.linkedSystems, true);
    assert.equal(
      k.byCompany.reduce((n, c) => n + c.alarms, 0),
      k.all.alarms,
    );
    await assert.rejects(db.asUser('u-pwvsb-hr', (svc, u) => svc.cms(u)));
  });
});
