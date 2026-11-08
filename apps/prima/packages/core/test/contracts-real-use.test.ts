import { describe, expect, it } from 'vitest';
import { AccessDenied, BadRequest, MemoryStore, NotFound, PrimaService, addDays, generateDataset, myt } from '../src';

// Contracts and site mobilisation for real use (5 Nov 2026: "Build all that still not build"). Synthetic data only.
const TODAY = '2026-11-05';
const NOW = myt(TODAY, '10:00');
let n = 0;
const doc = (name = 'paper') => {
  n += 1;
  return { kind: 'document' as const, name: `${name} ${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 ${name} ${n}`).toString('base64')}` };
};

async function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  const om = await svc.user('u-om-klang');
  const cm = await svc.user('u-cm-sasa');
  // No admin executive is seeded for Sasa: a synthetic one, like Arrow Shield's.
  const aeArsh = (await store.get('users', 'u-ae-arsh'))!;
  await store.insert('users', { ...aeArsh, id: 'u-ae-sasa-test', name: 'Synthetic Admin Exec', companyIds: ['co-sasa'] });
  const ae = await svc.user('u-ae-sasa-test');
  // A Sasa client in the OM's area, with a clean CRM history.
  const acct = (await svc.clientBoard(om)).accounts.find((a) => a.canAct && a.stage === 'active' && a.companyId === 'co-sasa' && a.siteIds.length)!;
  await store.update('clientAccounts', acct.id, { people: [], renewal: null, renewals: [] });
  return { ds, store, svc, om, cm, ae, acct, coo: await svc.user('u-coo'), cmOther: await svc.user('u-cm-arsh') };
}

/** The base input for a new contract starting tomorrow at the given site. */
const input = (accountId: string | null, siteId: string, ref: string) => ({
  companyId: 'co-sasa',
  clientAccountId: accountId,
  clientName: 'Pusat Logistik Ujian',
  siteIds: [siteId],
  startOn: addDays(TODAY, 1),
  endOn: addDays(TODAY, 731),
  billingMethod: 'M1' as const,
  rate: 11.5,
  fixedFee: null,
  signedRef: ref,
  proof: [doc('signed contract')],
});

describe('Contracts for real use', () => {
  it('records the signed paper with its copy, posts, service levels and terms, and the client in Clients follows', async () => {
    const { svc, store, cm, acct } = await setup();
    const site = acct.siteIds[0];
    const opt = (await svc.contracts(cm)).canAdd[0];
    expect(opt.sites.find((s) => s.id === site)!.posts.length).toBeGreaterThan(0);
    const bad = { ...input(acct.id, site, 'SASA/LOA/1'), paperKind: 'loa' as const, posts: [{ label: 'Gate', guards: 0, hoursPerDay: 12, rate: 10 }] };
    await expect(svc.addContract(cm, bad)).rejects.toThrow(/Each post needs/);
    await expect(svc.addContract(cm, { ...bad, posts: null, sla: { monthlyReportByDay: 40 } })).rejects.toThrow(/service levels/);
    await expect(svc.addContract(cm, { ...bad, posts: null, bond: { amount: 5000, ref: '', expiresOn: addDays(TODAY, 400) } })).rejects.toThrow(/bond/);
    await expect(svc.addContract(cm, { ...bad, posts: null, proof: [] })).rejects.toThrow(/letter of award/);
    const c = await svc.addContract(cm, {
      ...bad,
      posts: [
        { label: 'Main gate', guards: 2, hoursPerDay: 12, rate: 11, armed: false },
        { label: 'Patrol', guards: 1, hoursPerDay: 12, rate: 12, armed: false },
      ],
      poRef: 'PO-7781',
      sla: { replaceAbsentMinutes: 45, incidentReportHours: 12, monthlyReportByDay: 5 },
      penalties: 'RM100 an hour unmanned',
      paymentDays: 45,
      noticeDays: 60,
      bond: { amount: 12000, ref: 'BG-001', expiresOn: addDays(TODAY, 800) },
    });
    expect(c.paper).toMatchObject({ kind: 'loa', poRef: 'PO-7781' });
    expect(c.terms).toEqual({ paymentDays: 45, noticeDays: 60, bond: { amount: 12000, ref: 'BG-001', expiresOn: addDays(TODAY, 800) } });
    expect(c.versions[0].posts.map((p) => p.rate)).toEqual([11, 12]);
    expect(c.versions[0].sla.replaceAbsentMinutes).toBe(45);
    // The paper is the first item's proof, and it is kept with the contract.
    expect(c.mobilisation[0]).toMatchObject({ status: 'done', proofIds: [c.paper!.docId] });
    expect((await svc.contractProof(cm, c.id)).docs.map((d) => d.id)).toEqual([c.paper!.docId]);
    // The client's contract end follows the new contract when it is later.
    expect((await store.get('clientAccounts', acct.id))!.contractEndsOn! >= addDays(TODAY, 731)).toBe(true);
  });

  it('marks items done only with proof, by the right people, and opens them again only with a reason', async () => {
    const { svc, cm, ae, om, acct, coo, cmOther } = await setup();
    const c = await svc.addContract(cm, input(acct.id, acct.siteIds[0], 'SASA/CT/R2'));
    const opsItem = c.mobilisation.find((i) => i.owner === 'operations' && !i.auto)!;
    const officeItem = c.mobilisation.find((i) => i.owner === 'company' && i.status === 'open' && !i.auto)!;
    const hrItem = c.mobilisation.find((i) => i.owner === 'hr')!;
    // Operations marks only the site items; the company office records the rest, including HR's.
    await expect(svc.setMobItem(om, c.id, officeItem.id, 'done', '', null, [doc()])).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setMobItem(om, c.id, hrItem.id, 'done', '', null, [doc()])).rejects.toThrow(/for HR/);
    await expect(svc.setMobItem(om, c.id, opsItem.id, 'done', '')).rejects.toThrow(/proof/);
    await svc.setMobItem(om, c.id, opsItem.id, 'done', 'Survey with the client', null, [doc('survey')]);
    await svc.setMobItem(ae, c.id, hrItem.id, 'done', 'HR registered 4 guards', null, [doc('perkeso')]);
    await expect(svc.setMobItem(ae, c.id, hrItem.id, 'done', '', null, [doc()])).rejects.toThrow(/already done/);
    // Leadership watches; another company sees nothing.
    await expect(svc.setMobItem(coo, c.id, officeItem.id, 'done', '', null, [doc()])).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setMobItem(cmOther, c.id, officeItem.id, 'done', '', null, [doc()])).rejects.toBeInstanceOf(NotFound);
    await expect(svc.contractProof(cmOther, c.id)).rejects.toBeInstanceOf(NotFound);
    await expect(svc.setMobItem(ae, c.id, hrItem.id, 'open', '')).rejects.toThrow(/why/);
    const back = await svc.setMobItem(ae, c.id, hrItem.id, 'open', 'Wrong guard list');
    const it = back.mobilisation.find((i) => i.id === hrItem.id)!;
    expect(it.status).toBe('open');
    expect(it.proofIds).toEqual([]);
    expect(it.log!.map((l) => l.status)).toEqual(['done', 'open']);
    expect((await svc.contractProof(coo, c.id)).docs.length).toBe(3);
    // The company manager may add a client-specific item; nobody else.
    await expect(svc.addMobItem(ae, c.id, { workstream: 'W4', label: 'Client induction for guards', dueOn: TODAY, critical: true, owner: 'operations' })).rejects.toBeInstanceOf(AccessDenied);
    const added = await svc.addMobItem(cm, c.id, { workstream: 'W4', label: 'Client induction for guards', dueOn: TODAY, critical: true, owner: 'operations' });
    expect(added.mobilisation.at(-1)).toMatchObject({ extra: true, critical: true, round: 1 });
  });

  it('checks the roster, guard clearance and client contacts itself, and certifies only when they pass', async () => {
    const { svc, store, cm, ae, acct } = await setup();
    // Find a site of this client whose first week is fully rostered with cleared guards.
    const c = await svc.addContract(cm, input(acct.id, acct.siteIds[0], 'SASA/CT/R3'));
    const row = (await svc.contracts(cm)).rows.find((r) => r.contract.id === c.id)!;
    expect(row.checks!.round).toBe(1);
    expect(row.checks!.client_contacts.ok).toBe(false);
    const contacts = c.mobilisation.find((i) => i.auto === 'client_contacts')!;
    await expect(svc.setMobItem(ae, c.id, contacts.id, 'done', '')).rejects.toThrow(/Not yet: Add in the client file/);
    for (const [role, name] of [['decision', 'Pengurus Ujian'], ['site', 'Penyelia Ujian'], ['finance', 'Akaun Ujian']] as const)
      await svc.addClientPerson(cm, acct.id, { name, position: 'Test', role, phone: '0312345678', email: '', main: role === 'decision' });
    await svc.setMobItem(ae, c.id, contacts.id, 'done', '');
    // Roster: make every first-week shift at the site filled by one guard, then block that guard.
    const shifts = (await store.list('shifts', { companyId: 'co-sasa' })).filter((s) => s.siteId === acct.siteIds[0] && s.date >= addDays(TODAY, 1) && s.date <= addDays(TODAY, 7));
    expect(shifts.length).toBeGreaterThan(0);
    const guard = shifts.find((s) => s.personId)!.personId!;
    for (const s of shifts) await store.update('shifts', s.id, { personId: guard });
    const roster = c.mobilisation.find((i) => i.auto === 'roster')!;
    const clear = c.mobilisation.find((i) => i.auto === 'guard_clearance')!;
    await svc.setMobItem(ae, c.id, roster.id, 'done', '');
    const person = (await store.get('people', guard))!;
    await store.update('people', guard, { status: 'suspended' });
    await expect(svc.setMobItem(ae, c.id, clear.id, 'done', '')).rejects.toThrow(/not cleared to deploy/);
    await store.update('people', guard, { status: person.status });
    const chk = (await svc.contracts(cm)).rows.find((r) => r.contract.id === c.id)!.checks!;
    expect(chk.guard_clearance.ok).toBe(true);
    await svc.setMobItem(ae, c.id, clear.id, 'done', '');
    // Client due diligence and assignment instructions are checked from their records (PIKM/ISO review, 5 Nov 2026).
    const dd = c.mobilisation.find((i) => i.auto === 'client_diligence')!;
    const ai = c.mobilisation.find((i) => i.auto === 'assignment_instructions')!;
    await expect(svc.setMobItem(ae, c.id, dd.id, 'done', '')).rejects.toThrow(/due diligence not started/);
    await expect(svc.setMobItem(ae, c.id, ai.id, 'done', '')).rejects.toThrow(/not written/);
    await svc.clientQuality.diligenceAct(ae, 'start', { accountId: acct.id });
    for (const kind of ['identity', 'authority', 'purpose', 'credit', 'conflict', 'site_risk', 'pdpa'])
      await svc.clientQuality.diligenceAct(ae, 'check', { accountId: acct.id, kind, status: 'clear', ref: `REF-${kind} (mock)` });
    await svc.clientQuality.diligenceAct(cm, 'decide', { accountId: acct.id, result: 'accepted', note: 'All checks clear (mock)' });
    await svc.setMobItem(ae, c.id, dd.id, 'done', '');
    const sitePosts = await store.list('posts', { siteId: acct.siteIds[0] });
    await svc.clientQuality.instructionsAct(ae, 'save', {
      siteId: acct.siteIds[0],
      general: 'Control the main gate, patrol every hour, keep the key and visitor logbooks (mock).',
      emergency: 'Police 999, Bomba 994, client duty manager 03-1234 5678 (mock)',
      reporting: 'Report to the site officer; incidents in the app within 15 minutes (mock).',
      posts: sitePosts.map((p) => ({ postId: p.id, duties: 'Check every vehicle and visitor pass at this post (mock).' })),
    });
    await expect(svc.setMobItem(ae, c.id, ai.id, 'done', '')).rejects.toThrow(/not signed by the client/);
    await svc.clientQuality.instructionsAct(ae, 'client_signed', { siteId: acct.siteIds[0], name: 'Encik Pelanggan (mock)', role: 'Facility manager', on: TODAY, ref: 'File AI-1 (mock)' });
    await svc.setMobItem(ae, c.id, ai.id, 'done', '');
    // Every other critical item with proof; the rest accepted for a while by the company manager.
    await svc.contractStep(cm, c.id, 'mobilise');
    let cur = (await store.get('contracts', c.id))!;
    for (const i of cur.mobilisation.filter((x) => x.critical && x.status !== 'done')) await svc.setMobItem(ae, c.id, i.id, 'done', '', null, [doc()]);
    cur = (await store.get('contracts', c.id))!;
    for (const i of cur.mobilisation.filter((x) => !x.critical && x.status === 'open' && x.offset <= 0))
      await svc.setMobItem(cm, c.id, i.id, 'risk_accepted', 'Arrives in the first week', addDays(TODAY, 10));
    // A guard suspended after the tick fails the check again at certification.
    await store.update('people', guard, { status: 'suspended' });
    await expect(svc.contractStep(cm, c.id, 'certify')).rejects.toThrow(/Not ready any more/);
    await store.update('people', guard, { status: person.status });
    const ready = await svc.contractStep(cm, c.id, 'certify', 'Checked on site');
    expect(ready.state).toBe('ready');
  });

  it('opens an expansion round for a material variation, which needs its own Ready-to-Operate', async () => {
    const { svc, store, cm, ae, acct } = await setup();
    const live = (await svc.contracts(cm)).rows.find((r) => r.contract.state === 'active' && r.contract.clientAccountId === acct.id)!.contract;
    const sites = (await svc.contracts(cm)).canAdd[0].sites;
    const extra = sites.find((s) => !live.siteIds.includes(s.id) && !s.armed)!;
    const v = {
      effectiveFrom: addDays(TODAY, 7),
      billingMethod: live.versions.at(-1)!.billingMethod,
      posts: [...live.versions.at(-1)!.posts, { postId: null, label: 'New block gate', guards: 1, hoursPerDay: 12, armed: false, rate: 11 }],
      fixedFee: null,
      signedRef: 'SASA/VAR/77',
      reason: 'Second building added',
      addSiteIds: [extra.id],
      proof: [doc('variation')],
    };
    await expect(svc.addContractVariation(cm, live.id, { ...v, effectiveFrom: addDays(live.endOn, 1) })).rejects.toThrow(/renewal first/);
    const after = await svc.addContractVariation(cm, live.id, v);
    expect(after.siteIds).toContain(extra.id);
    expect(after.rounds).toHaveLength(1);
    const round = after.rounds![0];
    expect(round).toMatchObject({ round: 2, siteIds: [extra.id], startOn: addDays(TODAY, 7), certified: null });
    const items = after.mobilisation.filter((i) => i.round === 2);
    expect(items.length).toBeGreaterThan(10);
    expect(items.some((i) => i.workstream === 'W1')).toBe(false);
    expect((await store.get('clientAccounts', acct.id))!.siteIds).toContain(extra.id);
    expect(after.variationDocs).toHaveLength(1);
    const row = (await svc.contracts(cm)).rows.find((r) => r.contract.id === live.id)!;
    expect(row.checks!.round).toBe(2);
    expect(row.rounds[0].canCertify).toBe(false);
    await expect(svc.certifyContractRound(cm, live.id, 2)).rejects.toThrow(/Not ready/);
    await expect(svc.certifyContractRound(ae, live.id, 2)).rejects.toBeInstanceOf(AccessDenied);
    // The same reference twice is refused.
    await expect(svc.addContractVariation(cm, live.id, { ...v, effectiveFrom: addDays(TODAY, 8), proof: [doc()] })).rejects.toThrow(/already recorded/);
  });

  it('moves the end date by a signed renewal, here or from the renewal signed in Clients', async () => {
    const { svc, store, cm, ae, acct } = await setup();
    const ends = addDays(TODAY, 50);
    const live = (await store.list('contracts', { companyId: 'co-sasa' })).find((c) => c.clientAccountId === acct.id && c.state === 'active')!;
    await store.update('contracts', live.id, { endOn: ends });
    await store.update('clientAccounts', acct.id, { contractEndsOn: ends });
    await svc.decideClientRenewal(cm, acct.id, { choice: 'renew', pricePct: 0, reason: 'Good client' });
    await svc.sendClientRenewalOffer(ae, acct.id, [doc('offer')]);
    await svc.answerClientRenewal(ae, acct.id, { choice: 'accepted', note: 'Two years', newEndsOn: addDays(TODAY, 780), proof: [doc('signed renewal')] });
    const c = (await store.get('contracts', live.id))!;
    expect(c.endOn).toBe(addDays(TODAY, 780));
    expect(c.renewals!.at(-1)).toMatchObject({ via: 'clients', fromEndOn: ends, toEndOn: addDays(TODAY, 780) });
    expect((await svc.crmClient(cm, acct.id)).issues.some((i) => /still ends/.test(i.what))).toBe(false);
    // Recorded here: needs the copy and a later date; the client follows.
    await expect(svc.renewContract(cm, live.id, { newEndOn: addDays(TODAY, 700), signedRef: 'R2', proof: [doc()] })).rejects.toThrow(/after/);
    await expect(svc.renewContract(cm, live.id, { newEndOn: addDays(TODAY, 900), signedRef: 'R2', proof: [] })).rejects.toThrow(/copy/);
    await expect(svc.renewContract(ae, live.id, { newEndOn: addDays(TODAY, 900), signedRef: 'R2', proof: [doc()] })).rejects.toBeInstanceOf(AccessDenied);
    const r = await svc.renewContract(cm, live.id, { newEndOn: addDays(TODAY, 900), signedRef: 'R2', proof: [doc()] });
    expect(r.endOn).toBe(addDays(TODAY, 900));
    expect((await store.get('clientAccounts', acct.id))!.contractEndsOn).toBe(addDays(TODAY, 900));
    // The same signed renewal cannot be recorded twice.
    await expect(svc.renewContract(cm, live.id, { newEndOn: addDays(TODAY, 1200), signedRef: 'r2', proof: [doc()] })).rejects.toThrow(/already recorded/);
  });

  it('ties a contract recorded without a client to the client in Clients', async () => {
    const { svc, store, cm, cmOther, acct } = await setup();
    const loose = (await store.list('contracts', { companyId: 'co-sasa' })).find((c) => !c.clientAccountId)!;
    const row = (await svc.contracts(cm)).rows.find((r) => r.contract.id === loose.id)!;
    expect(row.client).toBeNull();
    expect(row.tone).not.toBe('ok');
    const other = (await store.list('clientAccounts', { companyId: 'co-arsh' }))[0];
    await expect(svc.linkContractClient(cm, loose.id, other.id)).rejects.toThrow(/this company/);
    await expect(svc.linkContractClient(cmOther, loose.id, acct.id)).rejects.toBeInstanceOf(NotFound);
    const tied = await svc.linkContractClient(cm, loose.id, acct.id);
    expect(tied).toMatchObject({ clientAccountId: acct.id, clientName: acct.name });
    await expect(svc.linkContractClient(cm, loose.id, acct.id)).rejects.toBeInstanceOf(BadRequest);
  });
});

describe('Contracts review fixes (5 Nov 2026)', () => {
  it('keeps the papers of contracts outside its area from Operations, and checks the risk date and post ids', async () => {
    const { svc, cm, om, acct } = await setup();
    const rows = (await svc.contracts(om)).rows;
    const outside = rows.find((r) => r.role === 'view');
    const inside = rows.find((r) => r.role === 'staff');
    expect(outside && inside).toBeTruthy();
    await expect(svc.contractProof(om, outside!.contract.id)).rejects.toBeInstanceOf(NotFound);
    await expect(svc.contractProof(om, inside!.contract.id)).resolves.toBeTruthy();

    const site = acct.siteIds[0];
    await expect(
      svc.addContract(cm, { ...input(acct.id, site, 'SASA/FIX/1'), posts: [{ postId: 'post-not-here', label: 'Gate', guards: 1, hoursPerDay: 12, rate: 10 }] }),
    ).rejects.toThrow(/not at the chosen sites/);
    const c = await svc.addContract(cm, input(acct.id, site, 'SASA/FIX/2'));
    const item = c.mobilisation.find((i) => !i.critical && i.status === 'open')!;
    await expect(svc.setMobItem(cm, c.id, item.id, 'risk_accepted', 'Synthetic', '2026-12')).rejects.toBeInstanceOf(BadRequest);
  });
});
