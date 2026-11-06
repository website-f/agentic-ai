import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, generateDataset, myt } from '../src';

// Masterplan items Fauzan approved on 3 Nov 2026 ("Yes build all not build"): §103 KPKT licence check on PWVSB loans,
// §126 adviser budgets and invoices, §243 emergency delegation and succession register. Synthetic data only.
const TODAY = '2026-11-02';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => NOW) };
};
const loan = {
  kind: 'LOAN' as const,
  purpose: 'Working capital (mock)',
  secured: true,
  principal: 100000,
  ratePct: 8,
  startOn: '2026-10-01',
  signedOn: '2026-09-28',
  termMonths: 12,
  agreementRef: 'AGR-1 (mock)',
  templateId: 'TEMPLATE-1',
  collateral: 'NONE' as const,
  collateralRef: null,
  chargeCreatedOn: null,
};

describe('§103 KPKT licence check on PWVSB loans (directors only, no staff block)', () => {
  it('lets the credit officer record a loan without a check, flags it to the directors, and clears it when the Deputy records a valid licence', async () => {
    const { svc, store } = fresh();
    const officer = await svc.user('u-credit');
    const dcos = await svc.user('u-dcos');
    const ceo = await svc.user('u-fauzan');
    const l = await svc.addCreditLoan(officer, 'co-sasa', loan);
    expect((await svc.creditBoard(officer)).rows.find((r) => r.loan.id === l.id)!.licenceState).toBe('unchecked');
    let flags = await svc.directorLegalFlags(ceo);
    const f = flags.rows.find((r) => r.kind === 'LENDER_LICENCE_NOT_CHECKED' && r.records[0].id === l.id)!;
    expect(f).toMatchObject({ status: 'open', responsibleAssumed: true });
    expect(f.source).toMatch(/Moneylenders Act 1951/);
    // Staff see no statute text and get no block.
    expect(JSON.stringify(await (svc as unknown as { creditHome(u: unknown): Promise<unknown> }).creditHome(officer))).not.toMatch(/KPKT|Moneylenders/);
    const check = { ref: 'KPKT-1 (mock)', validTo: '2027-06-30', note: 'Counsel confirmed the licence copy (mock)' };
    for (const id of ['u-credit', 'u-cos', 'u-cm-sasa', 'u-legal'])
      await expect(svc.creditCheckLenderLicence(await svc.user(id), l.id, check)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.creditCheckLenderLicence(dcos, l.id, { ...check, note: 'ok' })).rejects.toThrow(/how it was checked/i);
    await expect(svc.creditCheckLenderLicence(dcos, l.id, { ...check, validTo: '2027-02-30' })).rejects.toThrow(/real date/);
    await svc.creditCheckLenderLicence(dcos, l.id, check);
    flags = await svc.directorLegalFlags(ceo);
    expect(flags.rows.some((r) => r.records[0]?.id === l.id && r.kind.startsWith('LENDER_LICENCE'))).toBe(false);
    const b = await svc.creditBoard(dcos);
    expect(b.canCheckLicence).toBe(true);
    expect(b.lastLicence).toEqual({ ref: 'KPKT-1 (mock)', validTo: '2027-06-30' });
    expect((await store.list('audit', {})).some((a) => a.action === 'credit.licence.check' && /valid on the loan date 2026-09-28/.test(a.summary))).toBe(true);
  });

  it('records a licence that had expired by the loan date as not valid, for the directors', async () => {
    const { svc } = fresh();
    const l = await svc.addCreditLoan(await svc.user('u-credit'), 'co-sasa', loan);
    await svc.creditCheckLenderLicence(await svc.user('u-dcos'), l.id, { ref: 'KPKT-0 (mock)', validTo: '2026-09-01', note: 'Old copy on file (mock)' });
    const f = (await svc.directorLegalFlags(await svc.user('u-fauzan'))).rows.find((r) => r.records[0]?.id === l.id && r.kind.startsWith('LENDER'))!;
    expect(f.kind).toBe('LENDER_LICENCE_NOT_VALID');
    expect(f.detail).toMatch(/valid to 2026-09-01/);
    expect(JSON.stringify(f)).not.toMatch(/compliant"/);
  });

  it('re-tests a recorded licence when the signing date is corrected (Arisha round 3 repro), directors only', async () => {
    const { svc, store } = fresh();
    const officer = await svc.user('u-credit');
    const dcos = await svc.user('u-dcos');
    const ceo = await svc.user('u-fauzan');
    const l = await svc.addCreditLoan(officer, 'co-sasa', loan);
    await svc.creditCheckLenderLicence(dcos, l.id, { ref: 'KPKT-2 (mock)', validTo: '2026-09-30', note: 'Counsel confirmed the copy (mock)' });
    const row = async () => (await svc.creditBoard(dcos)).rows.find((r) => r.loan.id === l.id)!;
    const flag = async () => (await svc.directorLegalFlags(ceo)).rows.find((r) => r.records[0]?.id === l.id && r.kind.startsWith('LENDER'));
    expect((await row()).licenceState).toBe('checked');
    expect(await flag()).toBeUndefined();
    await svc.creditCorrectRecord(officer, l.id, { field: 'signedOn', signedOn: '2026-10-20', reason: 'Signing date was keyed wrongly (mock)' });
    expect((await row()).licenceState).toBe('not_valid');
    expect((await row()).licenceLoanDate).toBe('2026-10-20');
    expect((await store.get('creditLoans', l.id))!.lenderLicence!.validOnLoanDate).toBe(false);
    const f = (await flag())!;
    expect(f.kind).toBe('LENDER_LICENCE_NOT_VALID');
    expect(f.detail).toMatch(/before the loan date 2026-10-20/);
    expect(
      (await store.list('audit', {})).some((a) => a.action === 'credit.signed.correct' && /now NOT valid on the loan date 2026-10-20/.test(a.summary)),
    ).toBe(true);
    // Staff still see no licence notice and are not blocked.
    expect(JSON.stringify(await (svc as unknown as { creditHome(u: unknown): Promise<unknown> }).creditHome(officer))).not.toMatch(/KPKT|Moneylenders/);
    // Clearing the signing date falls back to the start date (1 Oct), still after the expiry; correcting back restores it.
    await svc.creditCorrectRecord(officer, l.id, { field: 'signedOn', signedOn: null, reason: 'Signing date not known yet (mock)' });
    expect((await row()).licenceState).toBe('not_valid');
    await svc.creditCorrectRecord(officer, l.id, { field: 'signedOn', signedOn: '2026-09-28', reason: 'Confirmed from the signed copy (mock)' });
    expect((await row()).licenceState).toBe('checked');
    expect(await flag()).toBeUndefined();
  });
});

describe('§126 adviser budgets and invoices', () => {
  const firm = async (svc: PrimaService, kind: 'AUDIT' | 'LAW' = 'AUDIT') =>
    svc.addPanelFirm(await svc.user(kind === 'LAW' ? 'u-legal' : 'u-dcos'), {
      kind,
      name: `${kind} firm (mock)`,
      regNo: 'AF 1 (mock)',
      appointedOn: '2026-01-10',
    });

  it('keeper proposes, the Finance Director agrees with a reason (never the proposer); spend and over-budget follow the invoices', async () => {
    const { svc, store } = fresh();
    const dcos = await svc.user('u-dcos');
    const fd = await svc.user('u-fd');
    const f = await firm(svc);
    await expect(svc.adviserMoneyStep(fd, f.id, 'budget', { year: '2026', amount: 1000, reason: 'Yearly audit fee (mock)' })).rejects.toBeInstanceOf(
      AccessDenied,
    );
    await expect(svc.adviserMoneyStep(dcos, f.id, 'budget', { year: '2025', amount: 1000, reason: 'Yearly audit fee (mock)' })).rejects.toThrow(/this year/);
    await expect(svc.adviserMoneyStep(dcos, f.id, 'budget', { year: '2026', amount: 1000, reason: 'no' })).rejects.toThrow(/based on/);
    await svc.adviserMoneyStep(dcos, f.id, 'budget', { year: '2026', amount: 1000, reason: 'Yearly audit fee (mock)' });
    await expect(svc.adviserMoneyStep(dcos, f.id, 'agree', { year: '2026', note: 'fine' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.adviserMoneyStep(fd, f.id, 'agree', { year: '2026', note: '' })).rejects.toThrow(/reason/);
    let row = (await svc.panelBoard(fd)).firms.find((x) => x.firm.id === f.id)!;
    expect(row).toMatchObject({ budget: null, noBudget: true, canAgree: true });
    await svc.adviserMoneyStep(fd, f.id, 'agree', { year: '2026', note: 'In line with last year (mock)' });
    // Invoices: keyed once by the keeper, checked by someone else.
    await expect(svc.adviserMoneyStep(dcos, f.id, 'invoice', { no: 'INV-1', on: '2026-11-30', amount: 800, forWhat: 'Interim audit (mock)' })).rejects.toThrow(
      /future/,
    );
    await svc.adviserMoneyStep(dcos, f.id, 'invoice', { no: 'INV-1', on: '2026-10-30', amount: 800, forWhat: 'Interim audit (mock)' });
    await expect(svc.adviserMoneyStep(dcos, f.id, 'invoice', { no: 'inv-1', on: '2026-10-30', amount: 1, forWhat: 'Again (mock)' })).rejects.toThrow(
      /already recorded/,
    );
    let inv = (await store.get('panelFirms', f.id))!.invoices![0];
    const cos = await svc.user('u-cos');
    const evidence = { evidenceRef: 'Signed interim report (mock)', note: 'Interim audit field work done (mock)' };
    await expect(svc.adviserMoneyStep(dcos, f.id, 'check', { invoiceId: inv.id, result: 'passed', note: 'ok' })).rejects.toThrow(/Someone other/);
    await expect(svc.adviserMoneyStep(fd, f.id, 'check', { invoiceId: inv.id, result: 'passed', note: 'ok' })).rejects.toThrow(/confirmed with evidence/);
    await svc.adviserMoneyStep(cos, f.id, 'accept', { invoiceId: inv.id, ...evidence });
    await svc.adviserMoneyStep(fd, f.id, 'check', { invoiceId: inv.id, result: 'queried', note: 'Hours do not match the engagement letter (mock)' });
    await svc.adviserMoneyStep(dcos, f.id, 'resubmit', { invoiceId: inv.id, no: 'INV-1A', on: '2026-10-30', amount: 700, forWhat: 'Interim audit (mock)' });
    inv = (await store.get('panelFirms', f.id))!.invoices![0];
    expect(inv).toMatchObject({ no: 'INV-1A', amount: 700, check: null, acceptance: null });
    expect(inv.history).toHaveLength(1);
    expect(inv.history![0].acceptance?.evidenceRef).toBe('Signed interim report (mock)');
    await svc.adviserMoneyStep(cos, f.id, 'accept', { invoiceId: inv.id, ...evidence });
    await svc.adviserMoneyStep(fd, f.id, 'check', { invoiceId: inv.id, result: 'passed', note: 'Matches the letter (mock)' });
    await svc.adviserMoneyStep(dcos, f.id, 'invoice', { no: 'INV-2', on: '2026-11-01', amount: 400, forWhat: 'Final audit (mock)' });
    const inv2 = (await store.get('panelFirms', f.id))!.invoices![1];
    expect(JSON.stringify(await svc.home(cos))).toMatch(/Confirm the service for 1 adviser invoice/);
    await svc.adviserMoneyStep(cos, f.id, 'accept', { invoiceId: inv2.id, ...evidence });
    row = (await svc.panelBoard(fd)).firms.find((x) => x.firm.id === f.id)!;
    expect(row).toMatchObject({ budget: 1000, spent: 1100, overBudget: true, invoicesToCheck: 1 });
    const home = JSON.stringify(await svc.home(fd));
    expect(home).toMatch(/adviser invoice to check/);
    expect(home).toMatch(/adviser invoice to link to SQL Account/);
    expect(home).toMatch(/over this year/);
    const log = (await store.list('audit', {})).filter((a) => a.action.startsWith('panel.money.'));
    expect(log.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'panel.money.budget',
        'panel.money.agree',
        'panel.money.invoice',
        'panel.money.accept',
        'panel.money.check',
        'panel.money.resubmit',
      ]),
    );
    expect(log.find((a) => a.action === 'panel.money.check' && /passed/.test(a.summary))!.summary).toMatch(/Prima does not pay/);
  });

  it('service acceptance is independent (billed company manager, never keyer or checker) and the SQL Account entry must be in the billed company’s books', async () => {
    const { svc, store } = fresh();
    const dcos = await svc.user('u-dcos');
    const fd = await svc.user('u-fd');
    const cm = await svc.user('u-cm-sasa');
    const f = await firm(svc);
    await svc.adviserMoneyStep(dcos, f.id, 'invoice', {
      no: 'S-1',
      on: '2026-10-15',
      amount: 300,
      forWhat: 'Sasa secretarial filing (mock)',
      companyId: 'co-sasa',
    });
    const inv = (await store.get('panelFirms', f.id))!.invoices![0];
    const ev = { invoiceId: inv.id, evidenceRef: 'SSM receipt 123 (mock)', note: 'Annual return lodged (mock)' };
    // Only the billed company's manager confirms; not the keyer, not another company, not the Finance Director.
    for (const id of ['u-dcos', 'u-cm-arsh', 'u-fd', 'u-cos'])
      await expect(svc.adviserMoneyStep(await svc.user(id), f.id, 'accept', ev)).rejects.toThrow(id === 'u-dcos' ? /Someone other/ : /manager confirms/);
    await expect(svc.adviserMoneyStep(cm, f.id, 'accept', { ...ev, evidenceRef: '' })).rejects.toThrow(/evidence/);
    expect((await svc.panelBoard(cm)).firms.find((x) => x.firm.id === f.id)!.invoices[0]).toMatchObject({
      canAccept: true,
      canCheck: false,
      entityId: 'co-sasa',
    });
    await svc.adviserMoneyStep(cm, f.id, 'accept', ev);
    await expect(svc.adviserMoneyStep(cm, f.id, 'accept', ev)).rejects.toThrow(/already confirmed/);
    await expect(svc.adviserMoneyStep(fd, f.id, 'ap', { invoiceId: inv.id, entityId: 'co-sasa', apRef: 'PI-1', postedOn: '2026-10-20' })).rejects.toThrow(
      /passed to Finance/,
    );
    await svc.adviserMoneyStep(fd, f.id, 'check', { invoiceId: inv.id, result: 'passed', note: 'Matches the engagement (mock)' });
    const ap = { invoiceId: inv.id, entityId: 'co-sasa', apRef: 'PI-1 (mock)', postedOn: '2026-10-20' };
    await expect(svc.adviserMoneyStep(dcos, f.id, 'ap', ap)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.adviserMoneyStep(fd, f.id, 'ap', { ...ap, entityId: 'pwvsb' })).rejects.toThrow(/billed to .*books in SQL Account/);
    await expect(svc.adviserMoneyStep(fd, f.id, 'ap', { ...ap, entityId: 'co-arsh' })).rejects.toThrow(/not another company/);
    await expect(svc.adviserMoneyStep(fd, f.id, 'ap', { ...ap, postedOn: '2026-10-01' })).rejects.toThrow(/not before the invoice/);
    await svc.adviserMoneyStep(fd, f.id, 'ap', ap);
    expect((await store.get('panelFirms', f.id))!.invoices![0].ap).toMatchObject({ entityId: 'co-sasa', apRef: 'PI-1 (mock)' });
    await expect(svc.adviserMoneyStep(fd, f.id, 'ap', ap)).rejects.toThrow(/already linked/);
    // The same SQL document number cannot be linked twice in one company's books.
    await svc.adviserMoneyStep(dcos, f.id, 'invoice', { no: 'S-2', on: '2026-10-16', amount: 50, forWhat: 'Second filing (mock)', companyId: 'co-sasa' });
    const inv2 = (await store.get('panelFirms', f.id))!.invoices![1];
    await svc.adviserMoneyStep(cm, f.id, 'accept', { ...ev, invoiceId: inv2.id });
    await svc.adviserMoneyStep(fd, f.id, 'check', { invoiceId: inv2.id, result: 'passed', note: 'Fine (mock)' });
    await expect(svc.adviserMoneyStep(fd, f.id, 'ap', { ...ap, invoiceId: inv2.id, apRef: 'pi-1 (MOCK)' })).rejects.toThrow(/already linked to another/);
    // Spaces, dots, slashes and dashes do not make a different reference (Arisha round 5b).
    await expect(svc.adviserMoneyStep(fd, f.id, 'ap', { ...ap, invoiceId: inv2.id, apRef: 'PI 1 (mock)' })).rejects.toThrow(/already linked to another/);
    await expect(svc.adviserMoneyStep(fd, f.id, 'ap', { ...ap, invoiceId: inv2.id, apRef: 'P.I/1 (Mock)' })).rejects.toThrow(/already linked to another/);
    const log = (await store.list('audit', {})).filter((a) => a.action === 'panel.money.ap');
    expect(log[0].summary).toMatch(/Prima posts and pays nothing/);
  });

  it('the person who confirmed the service never checks the invoice', async () => {
    const { svc, store } = fresh();
    const f = await firm(svc);
    const dcos = await svc.user('u-dcos');
    // The Chief of Staff keys nothing here; the Deputy keys, the CoS confirms, so the Deputy cannot also be the checker
    // (keyer) and the CoS is not a checker; the Finance Director checks.
    await svc.adviserMoneyStep(dcos, f.id, 'invoice', { no: 'P-1', on: '2026-10-15', amount: 100, forWhat: 'PWVSB audit (mock)' });
    const inv = (await store.get('panelFirms', f.id))!.invoices![0];
    await svc.adviserMoneyStep(await svc.user('u-cos'), f.id, 'accept', { invoiceId: inv.id, evidenceRef: 'Report (mock)', note: 'Report received (mock)' });
    await expect(svc.adviserMoneyStep(await svc.user('u-cos'), f.id, 'check', { invoiceId: inv.id, result: 'passed', note: 'ok (mock)' })).rejects.toThrow(
      /Someone other than the person who confirmed/,
    );
  });

  it('keeps law firm fees keyed once on the legal matter', async () => {
    const { svc } = fresh();
    const f = await firm(svc, 'LAW');
    await expect(
      svc.adviserMoneyStep(await svc.user('u-legal'), f.id, 'invoice', { no: 'L-1', on: '2026-10-01', amount: 100, forWhat: 'Advice (mock)' }),
    ).rejects.toThrow(/keyed once/);
    await svc.adviserMoneyStep(await svc.user('u-legal'), f.id, 'budget', { year: '2026', amount: 5000, reason: 'Litigation budget (mock)' });
    const row = (await svc.panelBoard(await svc.user('u-fd'))).firms.find((x) => x.firm.id === f.id)!;
    expect(row.proposedBudget?.amount).toBe(5000);
  });
});

describe('§243 emergency delegation and succession register', () => {
  const line = {
    kind: 'EMERGENCY' as const,
    post: 'Company Manager',
    holderId: 'u-cm-sasa',
    delegateId: 'u-gm-sasa',
    scope: 'Day-to-day company decisions (mock)',
    from: '2026-11-01',
    to: '2026-11-30',
    reason: 'Manager on medical leave (mock)',
  };

  it('company manager records, the CEO or CoS approves with a reason (never the recorder or the delegate), and the delegate sees it', async () => {
    const { svc, store } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const cos = await svc.user('u-cos');
    const ceo = await svc.user('u-fauzan');
    await expect(svc.addDelegation(await svc.user('u-cm-arsh'), 'co-sasa', line)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.addDelegation(await svc.user('u-fwm-ex1'), 'co-sasa', line)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.addDelegation(cm, 'co-sasa', { ...line, delegateId: 'u-cm-sasa' })).rejects.toThrow(/someone other than the post holder/);
    await expect(svc.addDelegation(cm, 'co-sasa', { ...line, to: null })).rejects.toThrow(/end date/);
    await expect(svc.addDelegation(cm, 'co-sasa', { ...line, to: '2026-10-01' })).rejects.toThrow(/not before the start/);
    await expect(svc.addDelegation(cm, 'co-sasa', { ...line, from: '2026-02-30' })).rejects.toThrow(/real date/);
    const d = await svc.addDelegation(cm, 'co-sasa', line);
    expect(d.approved).toBeNull();
    let b = await svc.delegationBoard(cm);
    expect(b.rows[0]).toMatchObject({ state: 'pending', canApprove: false, canEnd: true });
    expect(b.note).toMatch(/does not give anyone access/);
    await expect(svc.delegationStep(cm, d.id, 'approve', 'fine')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.delegationStep(cos, d.id, 'approve', 'Covered (mock)')).rejects.toThrow(/Add competency evidence/);
    expect(JSON.stringify(await svc.home(cos))).not.toMatch(/delegation to approve/);
    // Competency evidence is a reference to HR's record; the delegate never adds their own.
    await expect(
      svc.delegationStep(await svc.user('u-gm-sasa'), d.id, 'evidence', 'I am fit (mock)', { competencyKind: 'hr_training', competencyRef: 'TRN-1' }),
    ).rejects.toBeTruthy();
    await svc.delegationStep(cm, d.id, 'evidence', 'Completed the manager course in 2025 (mock)', {
      competencyKind: 'hr_training',
      competencyRef: 'HR training TRN-1 (mock)',
    });
    await expect(svc.delegationStep(cos, d.id, 'approve', '')).rejects.toThrow(/reason/);
    expect(JSON.stringify(await svc.home(cos))).toMatch(/delegation to approve/);
    await svc.delegationStep(cos, d.id, 'approve', 'Covered while the manager is away (mock)');
    // One leader approval puts it in force (Fauzan 3 Nov 2026); nothing is left to approve.
    b = await svc.delegationBoard(ceo);
    expect(b.rows.find((r) => r.delegation.id === d.id)).toMatchObject({ state: 'active', approvalsNeeded: 0, canApprove: false });
    await expect(svc.delegationStep(ceo, d.id, 'approve', 'Agreed (mock)')).rejects.toThrow(/Only a line waiting/);
    // The delegate sees the line that names them, even without the register.
    const gm = await svc.user('u-gm-sasa');
    expect((await svc.delegationBoard(gm)).rows.map((r) => r.delegation.id)).toContain(d.id);
    await svc.delegationStep(cm, d.id, 'end', 'Manager back at work (mock)');
    expect((await svc.delegationBoard(ceo)).rows.find((r) => r.delegation.id === d.id)!.state).toBe('ended');
    expect((await store.list('audit', {})).filter((a) => a.action.startsWith('delegation.')).map((a) => a.action)).toEqual([
      'delegation.add',
      'delegation.evidence',
      'delegation.approve',
      'delegation.end',
    ]);
  });

  it('group posts sit under PWVSB: the CEO records a succession, the Chairman approves; the person who acts never approves their own line', async () => {
    const { svc } = fresh();
    const cos = await svc.user('u-cos');
    const ceo = await svc.user('u-fauzan');
    const g = { ...line, post: 'Chief Executive Officer', holderId: 'u-fauzan', delegateId: 'u-cos', kind: 'SUCCESSION' as const, to: null };
    await expect(svc.addDelegation(await svc.user('u-cm-sasa'), 'pwvsb', g)).rejects.toBeInstanceOf(AccessDenied);
    const d = await svc.addDelegation(ceo, 'pwvsb', g);
    // The person who acts never approves (and the CoS never approves a succession at all).
    await expect(svc.delegationStep(cos, d.id, 'approve', 'I accept (mock)')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.delegationStep(cos, d.id, 'evidence', 'Mine (mock)', { competencyKind: 'document', competencyRef: 'Self (mock)' })).rejects.toThrow(
      /cannot do this on their own/,
    );
    // Succession needs the board resolution as well as competency evidence.
    await svc.delegationStep(ceo, d.id, 'evidence', 'Appraised outstanding 2025 (mock)', { competencyKind: 'hr_appraisal', competencyRef: 'APR-2025 (mock)' });
    await expect(svc.delegationStep(await svc.user('u-chair'), d.id, 'approve', 'Agreed (mock)')).rejects.toThrow(/board resolution/);
    await expect(svc.delegationStep(ceo, d.id, 'evidence', 'x', { boardRef: 'BR 1/2026 (mock)', boardOn: '2026-12-01' })).rejects.toThrow(/not in the future/);
    await svc.delegationStep(ceo, d.id, 'evidence', '', { boardRef: 'BR 1/2026 (mock)', boardOn: '2026-10-30' });
    await expect(svc.delegationStep(ceo, d.id, 'approve', 'Mine (mock)')).rejects.toThrow(/Someone other/);
    // Fauzan 3 Nov 06:32Z: a succession is approved only by the Chairman (or the CEO with his consent). The CEO recorded
    // this one, so only the Chairman route is open; the COO cannot approve it.
    await expect(svc.delegationStep(await svc.user('u-coo'), d.id, 'approve', 'Agreed (mock)')).rejects.toBeInstanceOf(AccessDenied);
    await svc.delegationStep(await svc.user('u-chair'), d.id, 'approve', 'Agreed (mock)');
    expect((await svc.delegationBoard(ceo)).rows.find((r) => r.delegation.id === d.id)!.state).toBe('active');
    const b = await svc.delegationBoard(ceo);
    expect(b.canRecordFor.map((c) => c.id)).toContain('pwvsb');
    expect(b.people.every((p) => Object.keys(p).sort().join() === 'id,name,title')).toBe(true);
  });

  const approved = async (svc: PrimaService, over: Partial<typeof line> = {}) => {
    const cm = await svc.user('u-cm-sasa');
    const d = await svc.addDelegation(cm, 'co-sasa', { ...line, ...over });
    await svc.delegationStep(cm, d.id, 'evidence', 'Acted as manager before (mock)', { competencyKind: 'document', competencyRef: 'Memo 7 (mock)' });
    await svc.delegationStep(await svc.user('u-cos'), d.id, 'approve', 'Yes (mock)');
    return d;
  };

  it('critical-role inventory: listed posts show cover from a succession line or a successor ready now; leaders see posts with no cover', async () => {
    const { svc, store } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const ceo = await svc.user('u-fauzan');
    await expect(
      svc.addCriticalRole(await svc.user('u-fwm-ex1'), 'co-sasa', {
        post: 'Company Manager',
        holderId: 'u-cm-sasa',
        whyCritical: 'Signs for the company (mock)',
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.addCriticalRole(cm, 'co-sasa', { post: 'Company Manager', holderId: 'u-cm-sasa', whyCritical: 'x' })).rejects.toThrow(
      /why the post is critical/,
    );
    const c = await svc.addCriticalRole(cm, 'co-sasa', {
      post: 'Company Manager',
      holderId: 'u-cm-sasa',
      whyCritical: 'Signs contracts and payroll for the company (mock)',
      successors: [{ userId: 'u-gm-sasa', readiness: 'ready_later' }],
    });
    await expect(svc.addCriticalRole(cm, 'co-sasa', { post: 'company manager', holderId: 'u-cm-sasa', whyCritical: 'Again (mock) again' })).rejects.toThrow(
      /already on the list/,
    );
    expect((await svc.delegationBoard(ceo)).criticalRoles.find((r) => r.role.id === c.id)).toMatchObject({ covered: false });
    expect(JSON.stringify(await svc.home(await svc.user('u-cos')))).toMatch(/1 critical post with no cover/);
    // A succession line for the listed post: post and holder come from the inventory (keyed once).
    const d = await svc.addDelegation(cm, 'co-sasa', { ...line, kind: 'SUCCESSION', to: null, post: 'ignored', holderId: null, criticalRoleId: c.id });
    expect(d).toMatchObject({ post: 'Company Manager', holderId: 'u-cm-sasa', criticalRoleId: c.id });
    await svc.delegationStep(cm, d.id, 'evidence', 'Course done (mock)', {
      competencyKind: 'hr_training',
      competencyRef: 'TRN-2 (mock)',
      boardRef: 'BR 9 (mock)',
      boardOn: '2026-10-01',
    });
    await svc.delegationStep(await svc.user('u-chair'), d.id, 'approve', 'Yes (mock)');
    expect((await svc.delegationBoard(ceo)).criticalRoles.find((r) => r.role.id === c.id)).toMatchObject({ covered: true });
    await svc.criticalRoleStep(cm, c.id, 'review', { note: 'Still critical (mock)', successors: [{ userId: 'u-gm-sasa', readiness: 'ready_now' }] });
    expect((await store.get('criticalRoles', c.id))!.successors[0].readiness).toBe('ready_now');
    expect((await store.list('audit', {})).some((a) => a.action === 'critical_role.review')).toBe(true);
  });

  it('time-limited access is asked of IT by help request, never granted by Prima; ending or revoking asks for removal', async () => {
    const { svc, store } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const ceo = await svc.user('u-fauzan');
    const gm = await svc.user('u-gm-sasa');
    const pending = await svc.addDelegation(cm, 'co-sasa', line);
    await expect(
      svc.delegationStep(cm, pending.id, 'access', 'Needs the mailbox (mock)', { systems: 'Company shared mailbox read', until: '2026-11-20' }),
    ).rejects.toThrow(/approved line/);
    const d = await approved(svc);
    const usersBefore = JSON.stringify(await store.list('users', {}));
    await expect(svc.delegationStep(gm, d.id, 'access', 'Me (mock)', { systems: 'Mailbox', until: '2026-11-20' })).rejects.toBeTruthy();
    await expect(
      svc.delegationStep(cm, d.id, 'access', 'Needs the mailbox (mock)', { systems: 'Company shared mailbox read', until: '2026-12-15' }),
    ).rejects.toThrow(/not after the delegation ends/);
    await svc.delegationStep(cm, d.id, 'access', 'Needs the mailbox (mock)', { systems: 'Company shared mailbox read', until: '2026-11-20' });
    let row = (await svc.delegationBoard(cm)).rows.find((r) => r.delegation.id === d.id)!;
    expect(row.delegation.access).toMatchObject({ systems: 'Company shared mailbox read', until: '2026-11-20', removal: null });
    expect(row.accessTicket).toMatchObject({ status: 'open' });
    const tickets = await store.list('itTickets', {});
    const t = tickets.find((x) => x.id === row.delegation.access!.ticketId)!;
    expect(t).toMatchObject({ category: 'ACCOUNT', raisedById: 'u-cm-sasa', status: 'open' });
    expect(t.detail).toMatch(/Prima changed no access/);
    // Nothing about any account changed.
    expect(JSON.stringify(await store.list('users', {}))).toBe(usersBefore);
    await expect(svc.delegationStep(cm, d.id, 'access', 'Again (mock)', { systems: 'x y z', until: '2026-11-20' })).rejects.toThrow(/already asked/);
    // Revoke: a leader, for cause; raises the removal request.
    await expect(svc.delegationStep(cm, d.id, 'revoke', 'Not needed (mock)')).rejects.toBeInstanceOf(AccessDenied);
    await svc.delegationStep(ceo, d.id, 'revoke', 'Misused the mailbox (mock)');
    row = (await svc.delegationBoard(ceo)).rows.find((r) => r.delegation.id === d.id)!;
    expect(row.state).toBe('ended');
    expect(row.delegation.ended).toMatchObject({ revoked: true });
    expect(row.delegation.access!.removal).toMatchObject({ by: ceo.name });
    const removal = (await store.list('itTickets', {})).find((x) => x.id === row.delegation.access!.removal!.ticketId)!;
    expect(removal.title).toMatch(/^Remove time-limited access/);
    expect(JSON.stringify(await svc.home(ceo))).not.toMatch(/Ask IT to remove access/);
    expect((await store.list('audit', {})).filter((a) => a.action === 'delegation.revoke')[0].summary).toMatch(/IT request/);
  });

  it('an access end date that passes shows a removal task until removal is asked', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const d = await approved(svc, { from: '2026-10-20', to: '2026-11-30' });
    await svc.delegationStep(cm, d.id, 'access', 'Needs the mailbox (mock)', { systems: 'Shared mailbox read', until: '2026-11-02' });
    // The access end date is today; tomorrow it has passed.
    const later = new PrimaService((svc as unknown as { store: MemoryStore }).store, () => myt('2026-11-03', '09:00'));
    expect(JSON.stringify(await later.home(await later.user('u-cm-sasa')))).toMatch(/Ask IT to remove access for 1 delegation/);
    await later.delegationStep(await later.user('u-cm-sasa'), d.id, 'access-remove', 'Access end date passed (mock)');
    expect(JSON.stringify(await later.home(await later.user('u-cm-sasa')))).not.toMatch(/Ask IT to remove access/);
  });

  it('hands chosen open work of the holder to the person who acts, and back', async () => {
    const { svc, store } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const now = NOW;
    const task = (id: string, userId: string, status: 'open' | 'done' = 'open') =>
      store.insert('workTasks', {
        id,
        userId,
        userName: userId,
        companyId: 'co-sasa',
        title: `Task ${id} (mock)`,
        doneMeans: 'Done (mock)',
        source: 'own',
        playbookItemId: null,
        period: null,
        assignedBy: null,
        assignedById: null,
        createdAt: now,
        dueAt: now,
        priority: 'normal',
        status,
        evidence: null,
        late: null,
        review: null,
        planner: null,
      });
    await task('wt-a', 'u-cm-sasa');
    await task('wt-b', 'u-cm-sasa', 'done');
    await task('wt-c', 'u-cos');
    const d = await approved(svc);
    const row = (await svc.delegationBoard(cm)).rows.find((r) => r.delegation.id === d.id)!;
    expect(row.canTransfer).toBe(true);
    const open = (await svc.delegationBoard(cm)).openWork['u-cm-sasa'].map((t) => t.id);
    expect(open).toContain('wt-a');
    expect(open).not.toContain('wt-b');
    await expect(svc.delegationStep(cm, d.id, 'transfer', 'Cover (mock)', { taskIds: ['wt-b'] })).rejects.toThrow(/open work of the post holder/);
    await expect(svc.delegationStep(cm, d.id, 'transfer', 'Cover (mock)', { taskIds: ['wt-c'] })).rejects.toThrow(/open work of the post holder/);
    await expect(svc.delegationStep(await svc.user('u-gm-sasa'), d.id, 'transfer', 'Cover (mock)', { taskIds: ['wt-a'] })).rejects.toBeTruthy();
    await svc.delegationStep(cm, d.id, 'transfer', 'Cover while away (mock)', { taskIds: ['wt-a'] });
    expect((await store.get('workTasks', 'wt-a'))!.userId).toBe('u-gm-sasa');
    await svc.delegationStep(cm, d.id, 'end', 'Back (mock)');
    expect(JSON.stringify(await svc.home(cm))).toMatch(/Work to hand back/);
    await svc.delegationStep(cm, d.id, 'handback', 'Manager back (mock)');
    expect((await store.get('workTasks', 'wt-a'))!.userId).toBe('u-cm-sasa');
    expect((await store.get('delegations', d.id))!.transfers![0].returned).toBeTruthy();
  });

  it('evidence is fixed once a leader approves: it cannot be replaced on a line in force (Arisha round 5b repro, one approval per Fauzan)', async () => {
    const { svc, store } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const cos = await svc.user('u-cos');
    const d = await svc.addDelegation(cm, 'co-sasa', line);
    await svc.delegationStep(cm, d.id, 'evidence', 'Acted as manager before (mock)', { competencyKind: 'document', competencyRef: 'Memo 7 (mock)' });
    await svc.delegationStep(cos, d.id, 'approve', 'On the memo (mock)');
    await expect(
      svc.delegationStep(cm, d.id, 'evidence', 'A different record (mock)', { competencyKind: 'hr_training', competencyRef: 'TRN-9 (mock)' }),
    ).rejects.toThrow(/before approval/);
    const kept = (await store.get('delegations', d.id))!;
    expect(kept.competency!.ref).toBe('Memo 7 (mock)');
    expect(kept.approved!.byId).toBe('u-cos');
  });

  it('a closed account is never ready cover, a successor, or a person approved, given access or handed work (Arisha round 5b repro)', async () => {
    const { svc, store } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const cos = await svc.user('u-cos');
    const c = await svc.addCriticalRole(cm, 'co-sasa', {
      post: 'Company Manager',
      holderId: 'u-cm-sasa',
      whyCritical: 'Signs contracts and payroll for the company (mock)',
      successors: [{ userId: 'u-gm-sasa', readiness: 'ready_now' }],
    });
    expect((await svc.delegationBoard(cos)).criticalRoles.find((r) => r.role.id === c.id)).toMatchObject({ covered: true, leftSuccessors: [] });
    // A pending line and an approved one, both naming the same person, before they leave.
    const pending = await svc.addDelegation(cm, 'co-sasa', { ...line, post: 'Deputy (mock)' });
    await svc.delegationStep(cm, pending.id, 'evidence', 'Acted before (mock)', { competencyKind: 'document', competencyRef: 'Memo 8 (mock)' });
    const live = await approved(svc);
    await store.update('users', 'u-gm-sasa', { accessClosedFrom: TODAY });
    // Coverage: the closed successor no longer counts, on the board and on the leaders' home.
    expect((await svc.delegationBoard(cos)).criticalRoles.find((r) => r.role.id === c.id)).toMatchObject({
      covered: false,
      leftSuccessors: ['Hamdan bin Yusof'],
    });
    expect(JSON.stringify(await svc.home(cos))).toMatch(/1 critical post with no cover/);
    // Review: neither a closed successor nor keeping the list as it is.
    await expect(
      svc.criticalRoleStep(cm, c.id, 'review', { note: 'Still critical (mock)', successors: [{ userId: 'u-gm-sasa', readiness: 'ready_now' }] }),
    ).rejects.toThrow(/account is closed/);
    await expect(svc.criticalRoleStep(cm, c.id, 'review', { note: 'Still critical (mock)' })).rejects.toThrow(/has left/);
    await expect(
      svc.addCriticalRole(cm, 'co-sasa', {
        post: 'Finance lead (mock)',
        holderName: 'vacant',
        whyCritical: 'Pays the bills (mock)',
        successors: [{ userId: 'u-gm-sasa', readiness: 'ready_now' }],
      }),
    ).rejects.toThrow(/staff list/);
    // The lines: no approval, no access, no hand-over; the board says to end them.
    const row = (await svc.delegationBoard(cos)).rows.find((r) => r.delegation.id === pending.id)!;
    expect(row).toMatchObject({ delegateClosed: true, canApprove: false });
    expect(JSON.stringify(await svc.home(cos))).not.toMatch(/delegation to approve/);
    await expect(svc.delegationStep(cos, pending.id, 'approve', 'Yes (mock)')).rejects.toThrow(/account is closed/);
    expect((await svc.delegationBoard(cos)).rows.find((r) => r.delegation.id === live.id)).toMatchObject({ canRequestAccess: false, canTransfer: false });
    await expect(svc.delegationStep(cm, live.id, 'access', 'Needs mail (mock)', { systems: 'Company mailbox (mock)', until: '2026-11-20' })).rejects.toThrow(
      /account is closed/,
    );
    const task = (await store.list('workTasks', {})).find((t) => t.userId === 'u-cm-sasa' && (t.status === 'open' || t.status === 'returned'));
    if (task) await expect(svc.delegationStep(cm, live.id, 'transfer', 'Hand over (mock)', { taskIds: [task.id] })).rejects.toThrow(/account is closed/);
    // Ending still works.
    await svc.delegationStep(cm, live.id, 'end', 'Delegate left (mock)');
  });

  it('one leader approves an ordinary delegation (Fauzan 3 Nov 2026); the board says when nobody is left to approve', async () => {
    const { svc, store } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const ceo = await svc.user('u-fauzan');
    const d = await svc.addDelegation(cm, 'co-sasa', line);
    expect((await svc.delegationBoard(ceo)).rows.find((r) => r.delegation.id === d.id)).toMatchObject({ approversShort: false, approvalsNeeded: 1 });
    // A succession the Chairman recorded? He cannot record; but with the Chairman's account closed nobody can approve one.
    const s = await svc.addDelegation(ceo, 'pwvsb', {
      ...line,
      post: 'Chief Executive Officer',
      holderId: 'u-fauzan',
      delegateId: 'u-cos',
      kind: 'SUCCESSION',
      to: null,
    });
    expect((await svc.delegationBoard(ceo)).rows.find((r) => r.delegation.id === s.id)).toMatchObject({ approversShort: false });
    await store.update('users', 'u-chair', { accessClosedFrom: TODAY });
    expect((await svc.delegationBoard(ceo)).rows.find((r) => r.delegation.id === s.id)).toMatchObject({ approversShort: true });
  });

  it('succession: only the Chairman approves, or the CEO with the Chairman’s consent; never the COO or CoS (Fauzan 3 Nov 2026 06:32Z)', async () => {
    const { svc, store } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const ceo = await svc.user('u-fauzan');
    const chair = await svc.user('u-chair');
    const ready = async () => {
      const d = await svc.addDelegation(cm, 'co-sasa', { ...line, kind: 'SUCCESSION', to: null });
      await svc.delegationStep(cm, d.id, 'evidence', 'Course done (mock)', {
        competencyKind: 'hr_training',
        competencyRef: 'TRN-3 (mock)',
        boardRef: 'BR 10 (mock)',
        boardOn: '2026-10-01',
      });
      return d;
    };
    const state = async (id: string) => (await svc.delegationBoard(ceo)).rows.find((r) => r.delegation.id === id)!;
    // COO and CoS are refused, and are not offered the button.
    const a = await ready();
    for (const id of ['u-coo', 'u-cos']) {
      const u = await svc.user(id);
      expect((await svc.delegationBoard(u)).rows.find((r) => r.delegation.id === a.id)!.canApprove).toBe(false);
      await expect(svc.delegationStep(u, a.id, 'approve', 'Yes (mock)')).rejects.toBeInstanceOf(AccessDenied);
    }
    // The Chairman alone puts it in force.
    expect(JSON.stringify(await svc.home(chair))).toMatch(/1 succession to approve/);
    await svc.delegationStep(chair, a.id, 'approve', 'Board agreed (mock)');
    expect((await state(a.id)).state).toBe('active');
    expect((await store.get('delegations', a.id))!.approvals!.map((x) => x.as)).toEqual(['chairman']);
    // The CEO alone does not: it waits for the Chairman's consent.
    const b = await ready();
    await svc.delegationStep(ceo, b.id, 'approve', 'Ready (mock)');
    expect(await state(b.id)).toMatchObject({ state: 'pending', awaitingChairman: true, approvalsNeeded: 1 });
    await expect(svc.delegationStep(ceo, b.id, 'approve', 'Again (mock)')).rejects.toThrow(/second, different/);
    await expect(svc.delegationStep(await svc.user('u-coo'), b.id, 'approve', 'Yes (mock)')).rejects.toBeInstanceOf(AccessDenied);
    await svc.delegationStep(chair, b.id, 'approve', 'Consent (mock)');
    expect((await state(b.id)).state).toBe('active');
    expect((await store.get('delegations', b.id))!.approvals!.map((x) => x.as)).toEqual(['ceo', 'chairman_consent']);
    expect(
      (await store.list('audit', {}))
        .filter((x) => x.entityId === b.id && x.action === 'delegation.approve')
        .map((x) => x.summary)
        .join(' '),
    ).toMatch(/waits for the Chairman.*with the Chairman’s consent/);
    // The CEO as recorder (or as the successor) cannot approve: only the Chairman route is open.
    const c = await svc.addDelegation(ceo, 'pwvsb', {
      ...line,
      post: 'Chief Executive Officer',
      holderId: 'u-fauzan',
      delegateId: 'u-cos',
      kind: 'SUCCESSION',
      to: null,
    });
    await svc.delegationStep(ceo, c.id, 'evidence', 'Appraised (mock)', {
      competencyKind: 'hr_appraisal',
      competencyRef: 'APR (mock)',
      boardRef: 'BR 11 (mock)',
      boardOn: '2026-10-01',
    });
    await expect(svc.delegationStep(ceo, c.id, 'approve', 'Mine (mock)')).rejects.toThrow(/Someone other/);
    // Ordinary delegations are unchanged: one leader (here the CoS) is enough.
    const e = await svc.addDelegation(cm, 'co-sasa', line);
    await svc.delegationStep(cm, e.id, 'evidence', 'Memo (mock)', { competencyKind: 'document', competencyRef: 'Memo 9 (mock)' });
    await expect(svc.delegationStep(chair, e.id, 'approve', 'Yes (mock)')).rejects.toBeInstanceOf(AccessDenied);
    await svc.delegationStep(await svc.user('u-cos'), e.id, 'approve', 'Yes (mock)');
    expect((await state(e.id)).state).toBe('active');
  });
});

describe('§125 legal hold on files', () => {
  it('PWVSB legal or the Deputy holds a record for an open matter; every later change keeps the earlier version; staff are not blocked or told', async () => {
    const { svc, store, ds } = fresh();
    const legal = await svc.user('u-legal');
    const m = ds.legalMatters.find((x) => x.companyId === 'co-sasa' && x.status === 'open')!;
    const c = ds.cases.find((x) => x.companyId === 'co-sasa')!;
    const other = ds.cases.find((x) => x.companyId !== 'co-sasa')!;
    const input = { tbl: 'cases' as const, refId: c.id, reason: 'Evidence for the Industrial Court claim (mock)' };
    // P78: the owner (master administrator) may place a hold too; releasing one stays with legal and the Deputy.
    for (const id of ['u-cm-sasa', 'u-cos', 'u-fd'])
      await expect(svc.placeLegalHold(await svc.user(id), m.id, input)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.placeLegalHold(legal, m.id, { ...input, reason: 'x' })).rejects.toThrow(/why the record is held/);
    await expect(svc.placeLegalHold(legal, m.id, { ...input, refId: other.id })).rejects.toThrow(/same company/);
    const board = await svc.legalHoldBoard(legal);
    expect(board.candidates[m.id].cases.map((x) => x.id)).toContain(c.id);
    const h = await svc.placeLegalHold(legal, m.id, input);
    await expect(svc.placeLegalHold(await svc.user('u-dcos'), m.id, input)).rejects.toThrow(/already on hold/);
    expect((await store.get('legalMatters', m.id))!.updates.at(-1)!.text).toMatch(/Legal hold placed on Case/);
    // Staff work goes on: the change is saved and the earlier content kept.
    await store.update('cases', c.id, { title: 'Changed by staff (mock)' });
    await store.update('cases', other.id, { title: 'Not held (mock)' });
    const versions = await store.list('legalHoldVersions', {});
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ holdId: h.id, tbl: 'cases', refId: c.id });
    expect((versions[0].before as { title: string }).title).toBe(c.title);
    expect((await store.get('cases', c.id))!.title).toBe('Changed by staff (mock)');
    // Staff see nothing about the hold; the group leaders see the list (directors' view).
    await expect(svc.legalHoldBoard(await svc.user('u-cm-sasa'))).rejects.toBeInstanceOf(AccessDenied);
    const ceoBoard = await svc.legalHoldBoard(await svc.user('u-fauzan'));
    expect(ceoBoard.rows[0]).toMatchObject({ versions: 1, canRelease: false });
    expect(ceoBoard.canPlace).toBe(true);
    await expect(svc.releaseLegalHold(await svc.user('u-fauzan'), h.id, 'Matter settled (mock)')).rejects.toBeInstanceOf(AccessDenied);
    // Release: legal or the Deputy, with a reason; afterwards changes are not kept.
    await expect(svc.releaseLegalHold(await svc.user('u-cm-sasa'), h.id, 'Matter settled (mock)')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.releaseLegalHold(legal, h.id, 'ok')).rejects.toThrow(/why the hold is released/);
    await svc.releaseLegalHold(await svc.user('u-dcos'), h.id, 'Matter settled (mock)');
    await store.update('cases', c.id, { title: 'After release (mock)' });
    expect(await store.list('legalHoldVersions', {})).toHaveLength(1);
    expect((await store.list('audit', {})).filter((a) => a.action.startsWith('legal.hold.')).map((a) => a.action)).toEqual([
      'legal.hold.place',
      'legal.hold.release',
    ]);
  });
});
