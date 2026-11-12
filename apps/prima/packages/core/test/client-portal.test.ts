import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, generateDataset, myt, type ClientAccount } from '../src';

// J1 (Fauzan, 11 Nov 2026): the client portal. The OM opens sign-ins, the company manager monitors (and may close one),
// the COO oversees; the client sees only their own client's papers and sends ratings, complaints and requests that land
// on the client's record. Synthetic data only.
const TODAY = '2026-11-12';
const NOW = myt(TODAY, '10:00');

async function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  // An OM who acts on a client: try the operations users until one may open a sign-in on some client.
  const accounts = ds.clientAccounts.filter((a) => a.stage !== 'ended' && a.siteIds.length);
  for (const u of ds.users.filter((x) => x.role === 'pwvsb_officer' && x.department === 'operations' && x.opsTier === 'om')) {
    const user = await svc.user(u.id);
    for (const a of accounts) {
      const role = (await svc.clientPortalDesk(user).catch(() => null))?.clients.find((c) => c.clientId === a.id)?.canManage;
      if (role) return { ds, store, svc, om: user, a };
    }
  }
  throw new Error('no OM with a client in the seed');
}

describe('J1 client portal', () => {
  it('lets the OM open a sign-in, the client sign in with the code, see own papers and send feedback', async () => {
    const { ds, store, svc, om, a } = await setup();
    const opened = await svc.openClientPortal(om, a.id, { name: 'Synthetic Client Person', post: 'Facilities Manager' });
    expect(opened.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(JSON.stringify(opened.user)).not.toContain('codeHash');
    const stored = (await store.get('clientAccounts', a.id))!.portalUsers![0];
    expect(stored.codeHash).not.toContain(opened.code);
    const portal = svc.clientPortal();
    expect(await portal.signIn(a.companyId, a.id, opened.user.id, 'WRONG-CODE-0000-0000')).toEqual({ ok: false, locked: false });
    const ok = await portal.signIn(a.companyId, a.id, opened.user.id, opened.code.toLowerCase());
    expect(ok).toMatchObject({ ok: true, version: 1 });
    const home = await portal.home(a.companyId, a.id, opened.user.id, 1);
    expect(home.clientName).toBe(a.name);
    expect(home.sites.map((s) => s.id).sort()).toEqual([...a.siteIds].sort());
    // Another client of the same company is never reachable with this sign-in.
    const other = ds.clientAccounts.find((x) => x.companyId === a.companyId && x.id !== a.id);
    if (other) await expect(portal.home(a.companyId, other.id, opened.user.id, 1)).rejects.toThrow(/not available/);
    await portal.send(a.companyId, a.id, opened.user.id, 1, { kind: 'rating', score: 4, text: 'Good guards' });
    await portal.send(a.companyId, a.id, opened.user.id, 1, { kind: 'complaint', text: 'Gate was left open at night', siteId: a.siteIds[0] });
    await portal.send(a.companyId, a.id, opened.user.id, 1, { kind: 'request', requestKind: 'temporary', text: 'Two extra guards for the event on Saturday' });
    await expect(portal.send(a.companyId, a.id, opened.user.id, 1, { kind: 'request', requestKind: 'nope', text: 'Something long enough' })).rejects.toThrow(/asking for/);
    await expect(portal.send(a.companyId, a.id, opened.user.id, 1, { kind: 'complaint', text: 'x', siteId: 'site-not-mine' })).rejects.toThrow(/own sites/);
    const cur = (await store.get('clientAccounts', a.id)) as ClientAccount;
    expect(cur.ratings.at(-1)).toMatchObject({ score: 4, via: 'portal', from: 'Synthetic Client Person (Facilities Manager)' });
    expect(cur.complaints?.at(-1)).toMatchObject({ via: 'portal', siteId: a.siteIds[0] });
    const req = cur.requests!.at(-1)!;
    expect(req).toMatchObject({ viaPortal: true, kind: 'temporary', status: 'open' });
    // The OM closes the request where they already work; the client sees the answer.
    await svc.closeClientRequest(om, a.id, req.id, { status: 'done', outcome: 'Two guards booked for Saturday' });
    const after = await portal.home(a.companyId, a.id, opened.user.id, 1);
    expect(after.raised.find((r) => r.kind === 'request')).toMatchObject({ status: 'done', answer: 'Two guards booked for Saturday' });
    expect((await svc.clientPortalDesk(om)).clients.find((c) => c.clientId === a.id)?.waiting.map((w) => w.kind)).toEqual(['complaint']);
  });

  it('locks again after a lock has run out (audit P100: a past lock no longer resets the count on every wrong code)', async () => {
    const { store, om, a } = await setup();
    let now = NOW;
    const svc = new PrimaService(store, () => now);
    const o = await svc.openClientPortal(om, a.id, { name: 'Synthetic Third Person', post: 'Admin Officer' });
    const portal = svc.clientPortal();
    const wrong = () => portal.signIn(a.companyId, a.id, o.user.id, 'AAAA-AAAA-AAAA-AAAA');
    for (let i = 0; i < 4; i++) expect(await wrong()).toEqual({ ok: false, locked: false });
    expect(await wrong()).toEqual({ ok: false, locked: true });
    now = myt(TODAY, '10:31'); // the 30-minute lock has run out
    for (let i = 0; i < 4; i++) expect(await wrong()).toEqual({ ok: false, locked: false });
    expect(await wrong()).toEqual({ ok: false, locked: true });
    expect(await portal.signIn(a.companyId, a.id, o.user.id, o.code)).toEqual({ ok: false, locked: true });
    now = myt(TODAY, '11:02');
    expect(await portal.signIn(a.companyId, a.id, o.user.id, o.code)).toMatchObject({ ok: true });
  });

  it('locks after five wrong codes, ends sessions on reset and close, and refuses the wrong roles', async () => {
    const { ds, svc, om, a } = await setup();
    const o = await svc.openClientPortal(om, a.id, { name: 'Synthetic Second Person', post: 'Head of Security' });
    const portal = svc.clientPortal();
    for (let i = 0; i < 4; i++) expect(await portal.signIn(a.companyId, a.id, o.user.id, 'AAAA-AAAA-AAAA-AAAA')).toEqual({ ok: false, locked: false });
    expect(await portal.signIn(a.companyId, a.id, o.user.id, 'AAAA-AAAA-AAAA-AAAA')).toEqual({ ok: false, locked: true });
    expect(await portal.signIn(a.companyId, a.id, o.user.id, o.code)).toEqual({ ok: false, locked: true });
    // A new code (with a reason) unlocks and raises the session version; the old session stops.
    await expect(svc.resetClientPortal(om, a.id, o.user.id, '')).rejects.toThrow(/reason/);
    const r = await svc.resetClientPortal(om, a.id, o.user.id, 'Locked out');
    expect(await portal.signIn(a.companyId, a.id, o.user.id, o.code)).toEqual({ ok: false, locked: false });
    expect(await portal.signIn(a.companyId, a.id, o.user.id, r.code)).toMatchObject({ ok: true, version: 2 });
    await expect(portal.home(a.companyId, a.id, o.user.id, 1)).rejects.toThrow(/not available/);
    // Wrong roles: the company manager and the COO may not open or reset; a guard and another company's manager see nothing.
    const cm = await svc.user(ds.users.find((u) => u.role === 'company_manager' && u.companyIds.includes(a.companyId))!.id);
    const coo = await svc.user('u-coo');
    await expect(svc.openClientPortal(cm, a.id, { name: 'Someone Else', post: 'Manager' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.openClientPortal(coo, a.id, { name: 'Someone Else', post: 'Manager' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.resetClientPortal(coo, a.id, o.user.id, 'No')).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.clientPortalDesk(coo)).clients.some((c) => c.clientId === a.id && !c.canManage && !c.canClose)).toBe(true);
    const otherCm = ds.users.find((u) => u.role === 'company_manager' && !u.companyIds.includes(a.companyId));
    if (otherCm) expect((await svc.clientPortalDesk(await svc.user(otherCm.id))).clients.some((c) => c.clientId === a.id)).toBe(false);
    const guard = await svc.user(ds.users.find((u) => u.role === 'guard')!.id);
    await expect(svc.clientPortalDesk(guard)).rejects.toBeInstanceOf(AccessDenied);
    // The company manager monitors and may close it, with a reason; then the client is out.
    await svc.closeClientPortal(cm, a.id, o.user.id, 'Person left the client');
    await expect(portal.home(a.companyId, a.id, o.user.id, 2)).rejects.toThrow(/not available/);
    expect(await portal.signIn(a.companyId, a.id, o.user.id, r.code)).toEqual({ ok: false, locked: false });
  });
});
