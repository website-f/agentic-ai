import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, centralAdminGuideFor, generateDataset, myt } from '../src';

// P78 (Agentic Office): the owner, signed in as Prima's CEO record, is the master administrator. On the mandates,
// company secretary and renewals screens he may register and start every record; the board, PWVSB legal, the Deputy
// Chief of Staff, the company manager and Central Admin keep their checks, and nobody approves what they entered.
// Dummy data only.
const TODAY = '2026-11-03';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
};

describe('Owner as master administrator: mandates', () => {
  it('lets the owner register and end a mandate, while the board confirms and legal verifies', async () => {
    const { svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const b = await svc.govBoard(ceo);
    expect(b.roles).toContain('control');
    const m = await svc.addGovMandate(ceo, 'co-inas', {
      kind: 'MANAGEMENT_AGREEMENT',
      ref: 'MA-OWNER-1',
      title: 'Operations support',
      signedOn: '2026-10-30',
      validFrom: '2026-11-01',
      validTo: null,
      powers: [{ area: 'OPERATIONS', scope: 'monitor', limit: null }],
    });
    expect(m.addedById).toBe('u-fauzan');
    // The owner is neither the company's board nor PWVSB legal.
    await expect(svc.govMandateStep(ceo, m.id, 'confirm', { resolutionRef: 'BR-1' })).rejects.toThrow(/board/);
    await svc.govMandateStep(await svc.user('u-cm-inas'), m.id, 'confirm', { resolutionRef: 'BR/INAS/2026/09' });
    await expect(svc.govMandateStep(ceo, m.id, 'verify', { note: 'ok' })).rejects.toThrow(/legal/);
    await svc.govMandateStep(await svc.user('u-legal'), m.id, 'verify', { note: 'Signed copy matches' });
    const ended = await svc.govMandateStep(ceo, m.id, 'terminate', { note: 'Replaced by a new agreement' });
    expect(ended.terminated?.by).toBe(ceo.name);
    // Another director-role sign-in that is not the CEO still only watches.
    await expect(
      svc.addGovMandate(await svc.user('u-chair'), 'co-inas', {
        kind: 'BOARD_MANDATE',
        ref: 'MA-2',
        title: 'x',
        signedOn: '2026-10-30',
        validFrom: '2026-11-01',
        validTo: null,
        powers: m.powers,
      }),
    ).rejects.toThrow(/registers mandates/);
  });
});

describe('Owner as master administrator: company secretary', () => {
  it('lets the owner add a filing and record its steps', async () => {
    const { svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const b = await svc.corpBoard(ceo);
    expect(b.canFile.map((c) => c.id)).toContain('co-arsh');
    expect(b.canRaise.map((c) => c.id)).toContain('co-arsh');
    await expect(svc.addCorpFiling(ceo, 'co-arsh', { kind: 'ANNUAL_RETURN', title: 'Annual return 2026', dueOn: '2026-02-30', basis: 'Companies Act 2016 s.68' })).rejects.toThrow(/real date/);
    await expect(svc.addCorpFiling(ceo, 'co-arsh', { kind: 'ANNUAL_RETURN', title: 'Annual return 2026', dueOn: '2026-12-15', basis: '' })).rejects.toThrow(/rule/);
    const f = await svc.addCorpFiling(ceo, 'co-arsh', { kind: 'ANNUAL_RETURN', title: 'Annual return 2026', dueOn: '2026-12-15', basis: 'Companies Act 2016 s.68' });
    expect(f.status).toBe('open');
    await expect(svc.addCorpFiling(ceo, 'co-arsh', { kind: 'ANNUAL_RETURN', title: 'Annual return 2026', dueOn: '2026-12-15', basis: 'Companies Act 2016 s.68' })).rejects.toThrow(/already/);
    const row = (await svc.corpBoard(ceo)).filings.find((x) => x.filing.id === f.id)!;
    expect(row.canWork).toBe(true);
    await svc.corpFilingStep(ceo, f.id, 'prepare');
    await svc.corpFilingStep(ceo, f.id, 'lodge', { ref: 'MBRS-123' });
    expect((await svc.corpFilingStep(ceo, f.id, 'receipt', { ref: 'SSM-9' })).status).toBe('acknowledged');
    // The company manager views filings but does not add them; the Deputy Chief of Staff does.
    await expect(svc.addCorpFiling(await svc.user('u-cm-arsh'), 'co-arsh', { kind: 'OTHER', title: 'Other lodgement', dueOn: '2026-12-01', basis: 'Companies Act 2016' })).rejects.toThrow(
      /Corporate Admin/,
    );
    expect((await svc.addCorpFiling(await svc.user('u-dcos'), 'co-arsh', { kind: 'OTHER', title: 'Other lodgement', dueOn: '2026-12-01', basis: 'Companies Act 2016' })).status).toBe('open');
  });

  it('lets the owner ask for a board change, which the Deputy Chief of Staff decides, never the owner', async () => {
    const { svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const c = await svc.raiseCorpChange(ceo, 'co-arsh', { kind: 'DIRECTOR', title: 'Appoint a new director', detail: '' });
    expect(c.raisedById).toBe('u-fauzan');
    expect((await svc.corpBoard(ceo)).changes.find((x) => x.change.id === c.id)!.canDecide).toBe(false);
    await expect(svc.decideCorpChange(ceo, c.id, 'approve', 'Fine', 'MA cl. 4.2')).rejects.toThrow(/Deputy Chief of Staff/);
    await svc.decideCorpChange(await svc.user('u-dcos'), c.id, 'approve', 'Within the agreement', 'MA cl. 4.2');
    expect((await svc.corpBoard(ceo)).changes.find((x) => x.change.id === c.id)!.canRecordBoard).toBe(true);
    const done = await svc.recordCorpBoard(ceo, c.id, 'BR/ARSH/2026/11', '2026-11-03');
    expect(done.status).toBe('board_done');
    expect(done.filingId).toBeTruthy();
  });
});

describe('Owner as master administrator: renewals', () => {
  it('lets the owner open and work a renewal, while the company manager signs and Central Admin confirms', async () => {
    const { svc, ds } = fresh();
    const ceo = await svc.user('u-fauzan');
    const b = await svc.renewalBoard(ceo);
    const row = b.rows.find((r) => r.licence.companyId === 'co-arsh' && !r.licence.renewal)!;
    expect(row.can.open).toBe(true);
    const id = row.licence.id;
    await svc.renewalStep(ceo, id, 'open');
    let l = (await svc.renewalBoard(ceo)).rows.find((r) => r.licence.id === id)!;
    for (let i = 0; i < l.licence.renewal!.papers.length; i++) await svc.renewalStep(ceo, id, 'paper', { index: i });
    l = (await svc.renewalBoard(ceo)).rows.find((r) => r.licence.id === id)!;
    expect(l.stage).toBe('to_sign');
    expect(l.can.sign).toBe(false);
    await expect(svc.renewalStep(ceo, id, 'sign')).rejects.toThrow(/company manager signs/);
    expect(ds.users.some((u) => u.id === 'u-cm-arsh')).toBe(true);
    await svc.renewalStep(await svc.user('u-cm-arsh'), id, 'sign');
    await svc.renewalStep(ceo, id, 'fee', { ref: 'no fee' });
    await svc.renewalStep(ceo, id, 'submit', { ref: 'PORTAL-77' });
    await svc.renewalStep(ceo, id, 'renewed', { newExpiresOn: '2028-12-31', ref: 'CERT-2028' });
    await expect(svc.renewalStep(ceo, id, 'confirm', { ok: true, note: 'ok' })).rejects.toThrow(/Central Admin/);
  });

  it('shows the owner the guide cards for the steps he can now do', async () => {
    const { svc } = fresh();
    const ids = centralAdminGuideFor(await svc.user('u-fauzan')).cards.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['renewal', 'company-file-draft']));
    expect(ids).not.toContain('company-file-check');
  });
});
