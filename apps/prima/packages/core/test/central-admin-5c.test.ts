import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, generateDataset, myt } from '../src';

// Central Admin 5C (Fauzan, 2 Nov 2026): each company renews its own licences, registrations and certificates;
// Central Admin monitors and confirms the new expiry. Master plan W15: an expired security licence blocks new
// contracts. Dummy data only.
const TODAY = '2026-11-02';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => NOW) };
};
const KDN = 'lic-co-sasa-kdn_licence';

describe('Renewals: each company renews, Central Admin monitors', () => {
  it('shows each company its own renewals and Central Admin all of them, and nobody else', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const own = await svc.renewalBoard(cm);
    expect(own.rows.every((r) => r.licence.companyId === 'co-sasa')).toBe(true);
    const kdn = own.rows.find((r) => r.licence.id === KDN)!;
    // KDN licence expires 30 Dec 2026, inside the 120-day lead: due, case can be opened.
    expect(kdn).toMatchObject({ status: 'DUE', stage: 'due', leadDays: 120 });
    expect(kdn.can.open).toBe(true);
    const dcos = await svc.renewalBoard(await svc.user('u-dcos'));
    expect(new Set(dcos.rows.map((r) => r.licence.companyId)).size).toBeGreaterThan(1);
    expect(dcos.rows.every((r) => !r.can.open)).toBe(true);
    for (const id of ['u-fwm-ex1', 'u-pwvsb-hr', 'u-transport']) await expect(svc.renewalBoard(await svc.user(id))).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.renewalStep(await svc.user('u-cm-arsh'), KDN, 'open')).rejects.toThrow(/not found/i);
  });

  it('settles a renewal in 7 steps: papers, sign (never the preparer), fee, submit, agency, renewed, confirmed', async () => {
    const { svc, store } = fresh();
    const ae = await svc.user('u-bm-sasa-1');
    const cm = await svc.user('u-cm-sasa');
    const dcos = await svc.user('u-dcos');
    // Central Admin monitors; it does not open or work the company's renewal.
    await expect(svc.renewalStep(dcos, KDN, 'open')).rejects.toBeInstanceOf(AccessDenied);
    let l = await svc.renewalStep(ae, KDN, 'open');
    expect(l.renewal!.papers.length).toBeGreaterThan(5);
    await expect(svc.renewalStep(cm, KDN, 'sign')).rejects.toThrow(/every paper/);
    await svc.renewalStep(ae, KDN, 'addPaper', { name: 'IGP approval letters (mock)' });
    l = (await store.get('licences', KDN))!;
    for (let i = 0; i < l.renewal!.papers.length; i++) await svc.renewalStep(ae, KDN, 'paper', { index: i });
    // An admin executive cannot sign; the manager who prepared nothing signs.
    await expect(svc.renewalStep(ae, KDN, 'sign')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.renewalStep(cm, KDN, 'submit', { ref: 'KDN-ONLINE-1' })).rejects.toThrow(/signs/);
    await svc.renewalStep(cm, KDN, 'sign');
    await expect(svc.renewalStep(ae, KDN, 'submit', { ref: 'KDN-ONLINE-1' })).rejects.toThrow(/Finance payment/);
    await svc.renewalStep(ae, KDN, 'fee', { ref: 'FIN-PAY-0042', amount: 1500 });
    await svc.renewalStep(ae, KDN, 'submit', { ref: 'KDN-ONLINE-1' });
    await svc.renewalStep(dcos, KDN, 'agency', { note: 'KDN asked for the CSG list again (mock)' });
    await expect(svc.renewalStep(ae, KDN, 'renewed', { newExpiresOn: '2026-01-01', ref: 'KDN/PA/8235/2027' })).rejects.toThrow(/new expiry/);
    l = await svc.renewalStep(ae, KDN, 'renewed', { newExpiresOn: '2027-12-31', ref: 'KDN/PA/8235/2027' });
    expect(l.expiresOn).toBe('2027-12-31');
    // Central Admin confirms with a note; the company never confirms its own renewal.
    await expect(svc.renewalStep(ae, KDN, 'confirm', { note: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.renewalStep(dcos, KDN, 'confirm', { note: '' })).rejects.toThrow(/note/);
    l = await svc.renewalStep(dcos, KDN, 'confirm', { note: 'Matches the certificate (mock)' });
    expect(l.renewal).toBeNull();
    expect(l.renewals![0]).toMatchObject({ oldExpiresOn: '2026-12-30', newExpiresOn: '2027-12-31' });
    expect((await svc.renewalBoard(cm)).rows.find((r) => r.licence.id === KDN)!.stage).toBe('ok');
  });

  it('refuses a manager signing papers they prepared, and lets Central Admin query a wrong date', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const gm = await svc.user('u-gm-sasa');
    const dcos = await svc.user('u-dcos');
    const l = await svc.renewalStep(cm, KDN, 'open');
    for (let i = 0; i < l.renewal!.papers.length; i++) await svc.renewalStep(cm, KDN, 'paper', { index: i });
    await expect(svc.renewalStep(cm, KDN, 'sign')).rejects.toThrow(/another company manager/);
    await svc.renewalStep(gm, KDN, 'sign');
    await svc.renewalStep(cm, KDN, 'fee', { ref: 'no fee' });
    await svc.renewalStep(cm, KDN, 'submit', { ref: 'KDN-ONLINE-2' });
    await svc.renewalStep(cm, KDN, 'renewed', { newExpiresOn: '2028-12-31', ref: 'KDN/PA/8235/2028' });
    const q = await svc.renewalStep(dcos, KDN, 'confirm', { ok: false, note: 'Certificate says 2027-12-31 (mock)' });
    expect(q.expiresOn).toBe('2026-12-30');
    expect(q.renewal!.renewed).toBeNull();
  });

  it('steps late renewals up to the Deputy CoS, then CoS at 14 days, then CEO at 30', async () => {
    const { svc, store } = fresh();
    const MOF = 'lic-co-sasa-mof_registration';
    const level = async () => (await svc.renewalBoard(await svc.user('u-dcos'))).rows.find((r) => r.licence.id === MOF)!.escalatedTo;
    await store.update('licences', MOF, { expiresOn: '2026-10-30' });
    expect(await level()).toBe('Deputy Chief of Staff');
    await store.update('licences', MOF, { expiresOn: '2026-10-10' });
    expect(await level()).toBe('Chief of Staff');
    await store.update('licences', MOF, { expiresOn: '2026-09-01' });
    expect(await level()).toBe('CEO');
    const seen = async (id: string) => {
      const h = await svc.home(await svc.user(id));
      return [...h.todo, ...(h.watch ?? [])].some((t) => t.tag === 'Renewals' && /expired/.test(t.title));
    };
    for (const id of ['u-dcos', 'u-cos', 'u-fauzan']) expect(await seen(id)).toBe(true);
    // The company sees its own expired item as a to-do to renew.
    expect((await svc.home(await svc.user('u-cm-sasa'))).todo.some((t) => t.tag === 'Renewals' && /MOF/.test(t.title))).toBe(true);
  });
});

describe('Master plan W15: an expired security licence goes to the directors, never a staff block', () => {
  // Fauzan, 2 Nov 2026 14:59Z: no legal-only blocks for staff; the directors see the legal flag.
  it('records the contract, flags the renewal as urgent, and lists the contract on the directors’ legal flag', async () => {
    const { svc, store } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const opt = (await svc.contracts(cm)).canAdd[0];
    const input = {
      companyId: 'co-sasa',
      clientAccountId: null,
      clientName: 'Pusat Data Cyberjaya (mock)',
      siteIds: [opt.sites[0].id],
      startOn: '2026-11-15',
      endOn: '2028-11-14',
      billingMethod: 'M1' as const,
      rate: 11.5,
      fixedFee: null,
      signedRef: 'SASA/CT/NEW-W15',
    };
    await store.update('licences', KDN, { expiresOn: '2026-10-31' });
    const c = await svc.addContract(cm, input);
    expect((await svc.renewalBoard(cm)).companies.find((x) => x.id === 'co-sasa')!.kdnExpired).toBe(true);
    await expect(svc.directorLegalFlags(cm)).rejects.toBeInstanceOf(AccessDenied);
    const flag = (await svc.directorLegalFlags(await svc.user('u-fauzan'))).rows.find((r) => r.id === `kdn:${KDN}`)!;
    expect(flag).toMatchObject({ kind: 'SECURITY_LICENCE_EXPIRED', status: 'open', since: '2026-10-31' });
    expect(flag.records.map((r) => r.id)).toEqual([KDN, c.id]);
    await store.update('licences', KDN, { expiresOn: '2027-12-31' });
    expect((await svc.directorLegalFlags(await svc.user('u-fauzan'))).rows.some((r) => r.id === `kdn:${KDN}`)).toBe(false);
  });
});
