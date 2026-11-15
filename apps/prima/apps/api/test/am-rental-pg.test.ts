// Real PostgreSQL: Part V rental homes (Fitri package, 14 Nov 2026). Synthetic data only; DATABASE_URL is a throwaway
// local database that this test resets. Installs the proposed module db/modules/am-rental-v1.sql (NOT on the release
// list; the CEO runs it).
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const mod = (f: string) => readFileSync(resolve(__dirname, `../../../../db/modules/${f}`), 'utf8');
const PDF = (n: string) => [{ kind: 'document' as const, name: `${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from('%PDF-1.4 synthetic ' + n).toString('base64')}` }];

describe('rental homes on PostgreSQL', () => {
  let db: Db;
  let owner: Client;
  let unitId = '';
  let ownerEntity = '';
  before(async () => {
    await resetDb(URL);
    db = new Db();
    owner = new Client({ connectionString: URL });
    await owner.connect();
    const u = (await owner.query(`SELECT id, data FROM prima.am_units WHERE data->>'type' = 'RESIDENTIAL' AND coalesce(data->>'office','false') <> 'true' LIMIT 1`)).rows[0];
    unitId = u.id;
    ownerEntity = u.data.ownerEntity;
    await owner.query(`UPDATE prima.am_units SET data = data || '{"tenancy": null, "status": "vacant", "askingRent": 1200}'::jsonb WHERE id = $1`, [unitId]);
  });
  after(async () => {
    await owner.end();
    await db.onModuleDestroy();
  });

  it('says in words that the module is not installed yet', async () => {
    await assert.rejects(db.asUser('u-asset-re1', (svc, u) => svc.amRentalAct(u, 'listingOpen', { unitId })), /not installed/);
  });

  it('records behind the Asset Management wall; proposer cannot approve; history append-only; nothing deleted', async () => {
    await owner.query(mod('am-rental-v1.sql'));
    await db.asUser('u-asset-dir', (svc, u) => svc.amRentalAct(u, 'owner', { reason: 'Synthetic owner', ownerEntity, companyNo: '202001000001', bankName: 'Bank Contoh', bankAccount: '1234567890', edsRole: true, edsStaffIds: ['u-asset-re1'], signatories: [{ name: 'Pengarah Contoh', kind: 'DIRECTOR' }] }));
    await db.asUser('u-asset-re1', (svc, u) => svc.amRentalAct(u, 'unitInfo', { unitId, bedrooms: 3, bathrooms: 2, building: 'TERRACE', propertyKind: 'HOUSE', availableOn: '2026-12-01', contactPhone: '012-345 6789', address: 'No 1, Jalan Contoh', photos: PDF('front') }));
    const l = (await db.asUser('u-asset-re1', (svc, u) => svc.amRentalAct(u, 'listingOpen', { unitId }))) as { id: string };
    await db.asUser('u-asset-re1', (svc, u) => svc.amRentalAct(u, 'terms', { id: l.id, rent: 1200, deposit: 2400 }));
    const approved = (await db.asUser('u-asset-dir', (svc, u) => svc.amRentalAct(u, 'termsDecide', { id: l.id, approve: true, note: 'Synthetic market rate' }))) as { version: number };
    assert.equal(approved.version, 3);
    const ad = (await db.asUser('u-asset-re1', (svc, u) => svc.amRentalAct(u, 'advert', { id: l.id, platform: 'MUDAH', link: 'https://example.com/ad', photosChecked: true, screenshot: PDF('shot') }))) as { status: string };
    assert.equal(ad.status, 'DIIKLANKAN');
    // A company manager is outside the wall: reads nothing and cannot open the board.
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.amRentalAct(u, 'board', {})), /Asset Management/);
    await owner.query('BEGIN');
    await owner.query('SET LOCAL ROLE prima_app');
    await owner.query(`SELECT set_config('app.user_id', 'u-cm-sasa', true)`);
    const n = (await owner.query(`SELECT count(*)::int AS n FROM prima.am_rental_recs`)).rows[0].n;
    await owner.query('ROLLBACK');
    assert.equal(n, 0);
    await assert.rejects(owner.query(`UPDATE prima.am_rental_recs SET data = jsonb_set(data, '{history}', '[]'::jsonb) WHERE id = $1`, [l.id]), /append-only/);
    await assert.rejects(owner.query(`DELETE FROM prima.am_rental_recs WHERE id = $1`, [l.id]), /never deleted/);
    const b = (await db.asUser('u-asset-dir', (svc, u) => svc.amRentalAct(u, 'board', {}))) as { listings: { status: string }[]; owners: { d: { bankAccount: string } }[] };
    assert.equal(b.listings[0].status, 'DIIKLANKAN');
    assert.equal(b.owners[0].d.bankAccount, '******7890');
  });

  it('only Finance confirms the deposit; the agreement stays locked until it is in full', async () => {
    const app = (await db.asUser('u-asset-re1', (svc, u) =>
      svc.amRentalAct(u, 'application', { unitId, conditionsExplained: true, applicant: { name: 'Pemohon Sintetik', net: 3000 }, spouse: { name: 'P', net: 2000 }, occupants: 4, declarationSigned: true, annexSignedOn: '2026-11-18', docs: PDF('ic') }),
    )) as { id: string };
    const stepAs = (uid: string, i: Record<string, unknown>) => db.asUser(uid, (svc, u) => svc.amRentalAct(u, 'appStep', { id: app.id, ...i }));
    await stepAs('u-asset-re1', { step: 'check', note: 'Synthetic check' });
    await stepAs('u-asset-re1', { step: 'assess', recommendation: 'Synthetic recommendation' });
    await stepAs('u-asset-re1', { step: 'forDecision' });
    await stepAs('u-asset-dir', { step: 'decide', approve: true, note: 'Synthetic approval' });
    await stepAs('u-vchair', { step: 'consent', note: 'Synthetic consent' });
    await stepAs('u-asset-re1', { step: 'dpr' });
    await assert.rejects(stepAs('u-asset-re1', { step: 'depositConfirm', amount: 3600, bankRef: 'X' }), /Finance/);
    await stepAs('u-finance-am', { step: 'depositConfirm', amount: 1000, bankRef: 'B1' });
    await db.asUser('u-asset-dir', (svc, u) => svc.amRentalAct(u, 'setSettings', { reason: 'Synthetic template', template: 'agreement', file: PDF('tpl') }));
    await assert.rejects(db.asUser('u-asset-re1', (svc, u) => svc.amRentalAct(u, 'agreementOpen', { appId: app.id })), /in full/);
    await stepAs('u-finance-am', { step: 'depositConfirm', amount: 2600, bankRef: 'B2' });
    const ag = (await db.asUser('u-asset-re1', (svc, u) => svc.amRentalAct(u, 'agreementOpen', { appId: app.id }))) as { status: string; d: { fields: { rent: number } } };
    assert.equal(ag.status, 'DRAF');
    assert.equal(ag.d.fields.rent, 1200);
  });
});
