import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, generateDataset, inCentralAdminRollout, inPilot, isCompanySecretary, isCorpAdminOwner, myt } from '../src';

// Central Admin 5A (Fauzan, 1 Nov 2026): head office Corporate Admin (the Deputy Chief of Staff) records filings; the
// Chief of Staff and the company secretary monitor; each company views its own; every approval carries a reason;
// nobody approves a change they raised. Dummy data only.
const TODAY = '2026-11-01';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
};

describe('Central Admin roles', () => {
  it('marks the Deputy Chief of Staff as owner and the secretary as a view-only monitor, never a spoofed or system sign-in', async () => {
    const { svc } = fresh();
    const dcos = await svc.user('u-dcos');
    const cos = await svc.user('u-cos');
    const sec = await svc.user('u-cosec');
    expect(isCorpAdminOwner(dcos)).toBe(true);
    expect(isCorpAdminOwner(cos)).toBe(false);
    expect(isCompanySecretary(sec)).toBe(true);
    // A company manager or an integration that claims the flags is refused.
    expect(isCompanySecretary({ ...(await svc.user('u-cm-sasa')), corpSecretary: true })).toBe(false);
    expect(isCorpAdminOwner({ ...dcos, integration: 'ja' })).toBe(false);
    expect(isCompanySecretary({ ...sec, integration: 'planner' })).toBe(false);
  });

  it('admits only the Central Admin team to the rollout, and none of them is in the IT pilot by default', async () => {
    const { svc } = fresh();
    for (const id of ['u-cos', 'u-dcos', 'u-pwvsb-doa', 'u-cosec']) expect(inCentralAdminRollout(await svc.user(id))).toBe(true);
    for (const id of ['u-cm-sasa', 'u-ae-arsh', 'u-fd', 'u-legal', 'u-pwvsb-hr', 'u-vchair']) expect(inCentralAdminRollout(await svc.user(id))).toBe(false);
    expect(inPilot(await svc.user('u-cosec'))).toBe(false);
  });
});

describe('Company filings: head office records, everyone else views', () => {
  it('lets only the Deputy Chief of Staff record filing steps', async () => {
    const { svc } = fresh();
    const dcos = await svc.user('u-dcos');
    const f = (await svc.corpBoard(dcos)).filings.find((x) => x.filing.status === 'open' && x.filing.companyId === 'co-sasa')!;
    // P78: the owner (u-fauzan) records filings too, as master administrator (owner-admin-governance.test.ts).
    for (const id of ['u-cm-sasa', 'u-gm-sasa', 'u-cos', 'u-cosec', 'u-chair'])
      await expect(svc.corpFilingStep(await svc.user(id), f.filing.id, 'prepare')).rejects.toBeInstanceOf(AccessDenied);
    // Another company's manager cannot even see it.
    await expect(svc.corpFilingStep(await svc.user('u-cm-arsh'), f.filing.id, 'prepare')).rejects.toThrow(/not found/i);
    expect((await svc.corpFilingStep(dcos, f.filing.id, 'prepare')).status).toBe('prepared');
    // The company and the secretary still see the filing.
    expect((await svc.corpBoard(await svc.user('u-cm-sasa'))).filings.some((x) => x.filing.id === f.filing.id)).toBe(true);
    expect((await svc.corpBoard(await svc.user('u-cosec'))).filings.some((x) => x.filing.id === f.filing.id)).toBe(true);
  });

  it('shows the secretary filings and changes but no buttons, and no legal matters', async () => {
    const { svc } = fresh();
    const sec = await svc.user('u-cosec');
    const b = await svc.corpBoard(sec);
    expect(b.roles).toEqual(['secretary']);
    expect(b.changes.every((c) => !c.canDecide && !c.canRecordBoard)).toBe(true);
    await expect(svc.corpAuditLegal(sec)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.raiseCorpChange(sec, 'co-sasa', { kind: 'DIRECTOR', title: 'x', detail: '' })).rejects.toBeInstanceOf(AccessDenied);
  });

  it('puts overdue filings on the Deputy Chief of Staff home, not as to-dos for the company', async () => {
    const { svc } = fresh();
    const dcos = (await svc.home(await svc.user('u-dcos'))).todo.filter((t) => t.tag === 'Company secretary');
    expect(dcos.length).toBeGreaterThan(0);
  });
});

describe('Corporate changes: the Deputy Chief of Staff approves with a reason, the Chief of Staff monitors', () => {
  it('refuses the Chief of Staff, an approval without a reason, and Corporate Admin raising its own change', async () => {
    const { svc } = fresh();
    const dcos = await svc.user('u-dcos');
    const cos = await svc.user('u-cos');
    const cm = await svc.user('u-cm-sasa');
    // Corporate Admin decides changes, so it never raises one (nobody approves their own request).
    await expect(svc.raiseCorpChange(dcos, 'co-sasa', { kind: 'DIRECTOR', title: 'x', detail: '' })).rejects.toBeInstanceOf(AccessDenied);
    const c = await svc.raiseCorpChange(cm, 'co-sasa', { kind: 'DIRECTOR', title: 'Appoint director Y (mock)', detail: '' });
    // The Chief of Staff monitors only (Fauzan, 2 Nov 2026): sees it, cannot decide it.
    const cosRow = (await svc.corpBoard(cos)).changes.find((x) => x.change.id === c.id)!;
    expect(cosRow.canDecide).toBe(false);
    await expect(svc.decideCorpChange(cos, c.id, 'approve', 'Looks fine', 'cl. 7.2')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.decideCorpChange(dcos, c.id, 'approve', '   ', 'cl. 7.2')).rejects.toThrow(/reason/);
    await expect(svc.decideCorpChange(await svc.user('u-cosec'), c.id, 'approve', 'ok', 'cl. 7.2')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.decideCorpChange(cm, c.id, 'approve', 'ok', 'cl. 7.2')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.decideCorpChange(await svc.user('u-fauzan'), c.id, 'approve', 'ok', 'cl. 7.2')).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.corpBoard(dcos)).changes.find((x) => x.change.id === c.id)!.canDecide).toBe(true);
    const ok = await svc.decideCorpChange(dcos, c.id, 'approve', 'Board seat agreed (mock)', 'Management agreement cl. 7.2');
    expect(ok.pwvsb).toMatchObject({ note: 'Board seat agreed (mock)', clauseRef: 'Management agreement cl. 7.2' });
    // Corporate Admin may record the board resolution for the company; the SSM filing opens with a 14-day clock.
    const done = await svc.recordCorpBoard(dcos, c.id, 'BR/SASA/1', '2026-11-01');
    expect(done.status).toBe('board_done');
  });
});

describe('Company record form (5A part 3): the Head of Company drafts, Corporate Admin checks against SSM', () => {
  const draft = {
    name: 'Sasa Security Services Sdn Bhd (mock)',
    ssmNo: '201901002101',
    registeredOn: '2019-01-14',
    registeredAddress: 'No. 1 Jalan Contoh, Selangor (mock)',
    state: 'Selangor',
    sourceRef: 'SSM company profile (mock), dated 2026-11-01',
    verificationStatus: 'draft',
  };

  it('lets the Head of Company save its own company as a draft only, and never another company', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    await expect(svc.saveRecord(cm, 'company', null, 'co-sasa', { ...draft, verificationStatus: 'verified' })).rejects.toThrow(/draft/);
    await svc.saveRecord(cm, 'company', null, 'co-sasa', draft);
    const row = ds.companies.find((c) => c.id === 'co-sasa')!;
    expect(row).toMatchObject({ verificationStatus: 'draft', draftById: 'u-cm-sasa', verifiedBy: null });
    await expect(svc.saveRecord(await svc.user('u-cm-arsh'), 'company', null, 'co-sasa', draft)).rejects.toBeInstanceOf(AccessDenied);
    // Admin executives, the Chief of Staff, the company secretary and system feeds do not keep it.
    for (const id of ['u-bm-sasa-1', 'u-cos', 'u-cosec', 'u-fd', 'u-coo'])
      await expect(svc.saveRecord(await svc.user(id), 'company', null, 'co-sasa', draft)).rejects.toThrow();
    await expect(svc.saveRecord({ ...cm, integration: 'ja' }, 'company', null, 'co-sasa', draft)).rejects.toBeInstanceOf(AccessDenied);
  });

  it('has the Deputy Chief of Staff verify a draft someone else saved, never their own', async () => {
    const { svc, ds } = fresh();
    const dcos = await svc.user('u-dcos');
    await svc.saveRecord(dcos, 'company', null, 'co-inas', { ...draft, name: 'Inas Guard Services Sdn Bhd (mock)', ssmNo: '201801009999' });
    await expect(
      svc.saveRecord(dcos, 'company', null, 'co-inas', { ...draft, name: 'Inas Guard Services Sdn Bhd (mock)', ssmNo: '201801009999', verificationStatus: 'verified' }),
    ).rejects.toThrow(/someone else/);
    await svc.saveRecord(await svc.user('u-cm-sasa'), 'company', null, 'co-sasa', draft);
    await svc.saveRecord(dcos, 'company', null, 'co-sasa', { ...draft, verificationStatus: 'verified' });
    expect(ds.companies.find((c) => c.id === 'co-sasa')).toMatchObject({ verificationStatus: 'verified', verifiedBy: dcos.name, draftById: 'u-cm-sasa' });
  });
});
