// J1 (P100, Fauzan 11 Nov 2026): the client portal on PostgreSQL through the real controllers: the signed personal link,
// the access code, the session cookie, the client's own page and PDFs only, sending, and the staff routes with their
// wrong-role refusals. Synthetic seed data and a synthetic PDF on a throwaway local database.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { AccessDenied, myt } from '@prima/core';
import { ClientPortalController, ClientPortalStaffController, ShareReportPdfController } from '../src/client-portal.controller';
import { portalCsp, portalHomePage, signPortalRef, verifyPortalRef } from '../src/client-portal';
import { signShare } from '../src/share-links';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const SECRET = 'synthetic-share-link-secret-for-tests-0001';
const PDF = `data:application/pdf;base64,${Buffer.from('%PDF-1.4 synthetic report').toString('base64')}`;

/** A small stand-in for the Express response the controllers write to. */
function fakeRes() {
  const r = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '' as unknown,
    location: '',
    contentType: '',
    setHeader(k: string, v: string) {
      r.headers[k.toLowerCase()] = v;
    },
    type(t: string) {
      r.contentType = t;
      return r;
    },
    status(n: number) {
      r.statusCode = n;
      return r;
    },
    send(b: unknown) {
      r.body = b;
      return r;
    },
    redirect(n: number, l: string) {
      r.statusCode = n;
      r.location = l;
      return r;
    },
  };
  return r;
}
const cookieOf = (r: ReturnType<typeof fakeRes>) => (r.headers['set-cookie'] ?? '').split(';')[0];

describe('J1 client portal (PostgreSQL, real controllers)', () => {
  let db: Db;
  let om = '';
  let clientId = '';
  let companyId = '';
  before(async () => {
    process.env.SHARE_LINK_SECRET = SECRET;
    process.env.SHARE_LINK_BASE = 'https://prima.example.test';
    await resetDb(URL, myt('2026-11-12', '10:00'));
    db = new Db();
    // Find an OM who manages a client, and give that client a monthly report kept as a PDF.
    const oms = (await db.pool.query(`SELECT id FROM prima.users WHERE data->>'opsTier' = 'om' ORDER BY id`)).rows.map((x) => x.id as string);
    for (const id of oms) {
      const desk = await db.asUser(id, (svc, u) => svc.clientPortalDesk(u)).catch(() => null);
      const c = desk?.clients.find((x) => x.canManage);
      if (c) {
        om = id;
        clientId = c.clientId;
        companyId = c.companyId;
        break;
      }
    }
    assert.ok(om, 'an OM with a client');
    await db.pool.query(`INSERT INTO prima.evidence_docs (id, company_id, data) VALUES ('doc-syn-report', $1, $2)`, [
      companyId,
      { id: 'doc-syn-report', companyId, caseId: null, followUpId: null, name: 'report.pdf', mime: 'application/pdf', bytes: 30, sha256: 'x', data: PDF, caption: 'Synthetic report', uploadedBy: 'Synthetic', receivedAt: '2026-11-01T09:00:00+08:00' },
    ]);
    await db.pool.query(`UPDATE prima.client_accounts SET data = jsonb_set(data, '{reports}', coalesce(data->'reports', '[]'::jsonb) || $2::jsonb) WHERE id = $1`, [
      clientId,
      JSON.stringify([{ period: '2025-12', at: '2026-01-05T09:00:00+08:00', by: 'Synthetic', docId: 'doc-syn-report' }]),
    ]);
  });
  after(async () => {
    delete process.env.SHARE_LINK_SECRET;
    delete process.env.SHARE_LINK_BASE;
    await db.onModuleDestroy();
  });

  it('signs links, refuses forged ones, and allows no scripts', () => {
    const t = signPortalRef({ c: 'co-a', k: 'cl-1', u: 'cpu-1' }, SECRET);
    assert.deepEqual(verifyPortalRef(t, SECRET), { c: 'co-a', k: 'cl-1', u: 'cpu-1' });
    assert.equal(verifyPortalRef(t, 'another-synthetic-secret-of-enough-length'), null);
    const forged = Buffer.from(JSON.stringify({ c: 'co-b', k: 'cl-1', u: 'cpu-1' })).toString('base64url');
    assert.equal(verifyPortalRef(`${forged}.${t.split('.')[1]}`, SECRET), null);
    assert.ok(!portalCsp().includes('script-src') && portalCsp().includes("form-action 'self'"));
    const html = portalHomePage('en', { clientName: '<script>x</script>', companyName: 'A', person: { name: 'P', post: 'Q' }, sites: [], reports: [], slips: [], requestKinds: [], raised: [] }, 'k', null, null);
    assert.ok(!html.includes('<script>x') && html.includes('&lt;script&gt;'));
  });

  it('runs the whole portal for one client and refuses the wrong roles', async () => {
    const staff = new ClientPortalStaffController(db);
    const portal = new ClientPortalController(db);
    const opened = await staff.open(om, clientId, { name: 'Synthetic Client Person', post: 'Facilities Manager' });
    assert.match(opened.url ?? '', /^https:\/\/prima\.example\.test\/api\/portal\/[\w-]+\.[\w-]+\/start$/);
    const ref = opened.url!.split('/api/portal/')[1].split('/')[0];
    // The company manager of another company and a guard are refused; the COO only watches.
    const otherCm = (await db.pool.query(`SELECT id FROM prima.users WHERE data->>'role' = 'company_manager' AND NOT (data->'companyIds' ? $1) LIMIT 1`, [companyId])).rows[0]?.id;
    if (otherCm) await assert.rejects(staff.open(otherCm, clientId, { name: 'Other Person', post: 'Manager' }), (e) => e instanceof AccessDenied || /not found/.test(String(e)));
    await assert.rejects(staff.open('u-coo', clientId, { name: 'Other Person', post: 'Manager' }), (e) => e instanceof AccessDenied);
    // A wrong code, then the right one: a session cookie.
    let res = fakeRes();
    await portal.signIn(ref, 'en', { code: 'AAAA-AAAA-AAAA-AAAA' }, res as never);
    assert.equal(res.statusCode, 401);
    res = fakeRes();
    await portal.signIn(ref, 'en', { code: opened.code }, res as never);
    assert.equal(res.statusCode, 303);
    assert.match(res.headers['set-cookie'], /HttpOnly; Secure; SameSite=Strict/);
    const cookie = cookieOf(res);
    // The page: own client only, the PDF listed.
    res = fakeRes();
    await portal.home(ref, 'ms', undefined, undefined, cookie, res as never);
    assert.equal(res.statusCode, 200);
    assert.match(String(res.body), /doc\/report\/2025-12/);
    assert.match(String(res.body), /Portal pelanggan|Selamat datang/);
    // Sending needs the page's own form key.
    res = fakeRes();
    await portal.send(ref, 'en', { kind: 'request', requestKind: 'temporary', text: 'Two extra guards on Saturday', f: 'forged' }, cookie, res as never);
    assert.equal(res.location, 'start?lang=en');
    const key = /name="f" value="([^"]+)"/.exec(await pageOf(portal, ref, cookie))![1];
    res = fakeRes();
    await portal.send(ref, 'en', { kind: 'request', requestKind: 'temporary', text: 'Two extra guards on Saturday', f: key }, cookie, res as never);
    assert.equal(res.location, 'home?lang=en&sent=request');
    const reqs = (await db.pool.query(`SELECT data->'requests' AS r FROM prima.client_accounts WHERE id = $1`, [clientId])).rows[0].r as { viaPortal?: boolean; from: string }[];
    assert.ok(reqs.some((q) => q.viaPortal && q.from === 'Synthetic Client Person (Facilities Manager)'));
    // The PDF, and nothing without the session.
    res = fakeRes();
    await portal.doc(ref, 'report', '2025-12', cookie, res as never);
    assert.equal(res.contentType, 'application/pdf');
    assert.ok(Buffer.isBuffer(res.body) && (res.body as Buffer).toString().startsWith('%PDF'));
    res = fakeRes();
    await portal.doc(ref, 'report', '2025-12', undefined, res as never);
    assert.equal(res.statusCode, 404);
    // A new code ends the old session at once.
    await staff.reset(om, clientId, opened.user.id, { reason: 'Synthetic reset' });
    res = fakeRes();
    await portal.home(ref, 'en', undefined, undefined, cookie, res as never);
    assert.equal(res.statusCode, 404);
  });

  it('serves a report PDF through a live report link only', async () => {
    const cm = (await db.pool.query(`SELECT id FROM prima.users WHERE data->>'role' = 'company_manager' AND data->'companyIds' ? $1 LIMIT 1`, [companyId])).rows[0].id as string;
    const made = await db.asUser(cm, (svc, u) => svc.createClientShareLink(u, clientId, { recipient: 'Synthetic recipient', from: '2025-12-01', to: '2025-12-31', days: 7 }));
    const token = signShare({ c: made.companyId, k: made.clientId, l: made.link.id }, SECRET);
    const pdfs = new ShareReportPdfController(db);
    let res = fakeRes();
    await pdfs.pdf(token, '2025-12', res as never);
    assert.equal(res.contentType, 'application/pdf');
    res = fakeRes();
    await pdfs.pdf(token, '2025-11', res as never);
    assert.equal(res.statusCode, 404);
    await db.asUser(cm, (svc, u) => svc.revokeClientShareLink(u, clientId, made.link.id, 'Synthetic revoke'));
    res = fakeRes();
    await pdfs.pdf(token, '2025-12', res as never);
    assert.equal(res.statusCode, 404);
  });
});

async function pageOf(portal: ClientPortalController, ref: string, cookie: string): Promise<string> {
  const r = fakeRes();
  await portal.home(ref, 'en', undefined, undefined, cookie, r as never);
  return String(r.body);
}
