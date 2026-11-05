import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, checkRecordValues, generateDataset, isRealDate, myt, RECORD_KINDS } from '../src';

// Arisha main's review of PR #52 (2 Nov 2026): impossible dates are refused before any record is accepted; missing
// collateral has an audited correction path; a returned company file is fixed and resubmitted with its earlier checks
// kept; legal flags go only to the directors. Dummy data only.
const TODAY = '2026-11-02';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => NOW) };
};
const KDN = 'lic-co-sasa-kdn_licence';
const loan = {
  kind: 'LOAN' as const,
  purpose: 'Working capital (mock)',
  secured: true,
  principal: 100000,
  ratePct: 8,
  startOn: '2026-09-15',
  termMonths: 12,
  agreementRef: 'AGR-1 (mock)',
  templateId: 'TEMPLATE-1',
  collateral: 'BENEFICIAL_INTEREST' as const,
  collateralRef: null,
  chargeCreatedOn: null,
};

describe('Impossible dates are refused (review defect 1)', () => {
  it('knows a real calendar date', () => {
    for (const d of ['2026-02-28', '2028-02-29', '2026-12-31']) expect(isRealDate(d)).toBe(true);
    for (const d of ['2026-02-31', '2027-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '2026-1-1', '', null, 20260101]) expect(isRealDate(d)).toBe(false);
  });

  it('refuses 31 February in the licence record form', () => {
    const spec = RECORD_KINDS.licence;
    const date = spec.fields.find((f) => f.type === 'date')!;
    const { problems } = checkRecordValues(spec, { [date.key]: '2027-02-31' }, false);
    expect(problems.join(' ')).toMatch(/real date/);
  });

  it('refuses an impossible new expiry, so a renewal can never close as OK on it', async () => {
    const { svc, store } = fresh();
    const ae = await svc.user('u-bm-sasa-1');
    const cm = await svc.user('u-cm-sasa');
    const dcos = await svc.user('u-dcos');
    let l = await svc.renewalStep(ae, KDN, 'open');
    for (let i = 0; i < l.renewal!.papers.length; i++) await svc.renewalStep(ae, KDN, 'paper', { index: i });
    await svc.renewalStep(cm, KDN, 'sign');
    await svc.renewalStep(ae, KDN, 'fee', { ref: 'FIN-PAY-1 (mock)', amount: 1500 });
    await expect(svc.renewalStep(ae, KDN, 'submit', { ref: 'KDN-ONLINE-1', on: '2026-02-30' })).rejects.toThrow(/real date/);
    await svc.renewalStep(ae, KDN, 'submit', { ref: 'KDN-ONLINE-1' });
    await svc.renewalStep(dcos, KDN, 'agency', { note: 'Queried (mock)' });
    await expect(svc.renewalStep(ae, KDN, 'renewed', { newExpiresOn: '2027-02-31', ref: 'KDN/PA/1 (mock)' })).rejects.toThrow(/new expiry/);
    l = (await store.get('licences', KDN))!;
    expect(l.expiresOn).toBe('2026-12-30');
  });

  it('refuses impossible dates in the company file, panel, credit and one-time report', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    await expect(svc.saveCompanyFile(cm, 'co-sasa', { directors: [{ name: 'Director X (mock)', appointedOn: '2020-02-30' }] })).rejects.toThrow(/real date/);
    await expect(
      svc.addPanelFirm(await svc.user('u-dcos'), { kind: 'AUDIT', name: 'Audit firm 9 (mock)', regNo: 'AF-9 (mock)', appointedOn: '2026-02-29' }),
    ).rejects.toThrow(/real date/);
    const officer = await svc.user('u-credit');
    await expect(svc.addCreditLoan(officer, 'co-sasa', { ...loan, startOn: '2026-09-31' })).rejects.toThrow(/real date/);
    const l = await svc.addCreditLoan(officer, 'co-sasa', loan);
    await expect(svc.creditStamped(officer, l.id, 'ST-1 (mock)', '2026-10-32')).rejects.toThrow(/real date/);
    const doa = await svc.user('u-pwvsb-doa');
    const keep = (await svc.reports(doa)).editList!;
    await expect(
      svc.setReportDefs(
        doa,
        [...keep, { id: '', name: 'Year-end', detail: '', from: 'company', frequency: 'once', dueDay: 1, active: true, dueOn: '2026-11-31' }],
        'add',
      ),
    ).rejects.toThrow();
  });
});

describe('Collateral correction (review defect 2)', () => {
  it('lets only the credit officer correct the collateral, with a reason, keeping old and new values', async () => {
    const { svc, store } = fresh();
    const officer = await svc.user('u-credit');
    const l = await svc.addCreditLoan(officer, 'co-sasa', loan);
    expect((await svc.creditBoard(officer)).rows.find((r) => r.loan.id === l.id)!.collateralMissing).toBe(true);
    const fix = { kind: 'BENEFICIAL_INTEREST' as const, agreementRef: 'BIA-1 (mock)', reason: 'Signed copy found in the PWVSB file' };
    for (const id of ['u-cm-sasa', 'u-cos', 'u-fauzan'])
      await expect(svc.creditCorrectCollateral(await svc.user(id), l.id, fix)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.creditCorrectCollateral(officer, l.id, { ...fix, reason: '' })).rejects.toThrow(/why/);
    await expect(svc.creditCorrectCollateral(officer, l.id, { ...fix, reason: '   ' })).rejects.toThrow(/why/);
    await expect(svc.creditCorrectCollateral(officer, l.id, { ...fix, agreementRef: '' })).rejects.toThrow(/reference/);
    await expect(svc.creditCorrectCollateral(officer, l.id, { ...fix, kind: 'ASSET_CHARGE' })).rejects.toThrow(/charge/);
    await expect(svc.creditCorrectCollateral(officer, l.id, { ...fix, kind: 'BOGUS' as never })).rejects.toThrow(/kind/);
    const after = await svc.creditCorrectCollateral(officer, l.id, fix);
    expect(after.collateral).toEqual({ kind: 'BENEFICIAL_INTEREST', agreementRef: 'BIA-1 (mock)' });
    expect(after.corrections).toEqual([
      expect.objectContaining({ from: 'BENEFICIAL_INTEREST', to: 'BENEFICIAL_INTEREST BIA-1 (mock)', reason: fix.reason, byId: 'u-credit' }),
    ]);
    // The money terms are untouched.
    expect(after).toMatchObject({ principal: l.principal, ratePct: l.ratePct, schedule: l.schedule });
    await expect(svc.creditCorrectCollateral(officer, l.id, fix)).rejects.toThrow(/Nothing changed/);
    expect((await svc.creditBoard(officer)).rows.find((r) => r.loan.id === l.id)!.collateralMissing).toBe(false);
    const log = (await store.list('audit', {})).filter((a) => a.action === 'credit.collateral.correct');
    expect(log).toHaveLength(1);
    expect(log[0].summary).toMatch(/Signed copy found/);
  });
});

describe('Company file return, edit and resubmit (review)', () => {
  it('keeps the sent-back check when the file is fixed and resubmitted', async () => {
    const { svc, store } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const dcos = await svc.user('u-dcos');
    await svc.saveCompanyFile(cm, 'co-sasa', { directors: [{ name: 'Director X (mock)', appointedOn: '2020-01-01' }] });
    await svc.checkCompanyFile(dcos, 'co-sasa', { ok: false, ssmRef: 'EXTRACT-1 (mock)', mismatches: ['Appointment date differs'] });
    const p = await svc.saveCompanyFile(cm, 'co-sasa', { directors: [{ name: 'Director X (mock)', appointedOn: '2020-01-02' }] });
    expect(p.file).toMatchObject({ status: 'draft', mismatches: [] });
    expect(p.file!.history).toEqual([
      expect.objectContaining({ status: 'mismatch', by: dcos.name, ssmRef: 'EXTRACT-1 (mock)', mismatches: ['Appointment date differs'] }),
    ]);
    const save = (await store.list('audit', {})).filter((a) => a.action === 'corp.file.save').pop()!;
    expect(save.summary).toMatch(/corrected and resubmitted/);
    await svc.checkCompanyFile(dcos, 'co-sasa', { ok: true, ssmRef: 'EXTRACT-2 (mock)', note: 'Matches now' });
  });
});

describe('Legal flags only in the directors’ view (common rule)', () => {
  it('shows staff a task, never a legal discrepancy, and gives the directors source, records, owner, status and history', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const officer = await svc.user('u-credit');
    await svc.saveCompanyFile(cm, 'co-sasa', {
      beneficialOwners: [{ name: 'Late owner (mock)', basis: 'Over 25% of votes', since: '2026-10-01', ssmNotifiedOn: null }],
    });
    const l = await svc.addCreditLoan(officer, 'co-sasa', loan);
    // Staff: the owner is a task with its date; no "late", no Act, no legal-only block.
    const [f] = await svc.companyFiles(cm, 'co-sasa');
    expect(f.boLate).toEqual([]);
    expect(f.boDue.map((b) => b.name)).toEqual(['Late owner (mock)']);
    const staffItems = [
      JSON.stringify(await svc.home(cm, 'co-sasa')),
      // The credit officer's own reminders (the officer has a board, not a home).
      JSON.stringify(await (svc as unknown as { creditHome(u: unknown): Promise<unknown> }).creditHome(officer)),
    ];
    for (const h of staffItems) expect(h).not.toMatch(/Companies Act|Stamp Act|s\.47A|not notified to SSM|Legal flags/);
    expect(staffItems[1]).toMatch(/agreement not stamped/);
    expect(JSON.stringify(await svc.home(cm, 'co-sasa'))).toMatch(/notify SSM of a beneficial owner/);
    // The officer can still record stamping: no legal-only block on the work.
    for (const id of ['u-cm-sasa', 'u-credit', 'u-bm-sasa-1', 'u-pwvsb-doa', 'u-fwm-ex1'])
      await expect(svc.directorLegalFlags(await svc.user(id))).rejects.toBeInstanceOf(AccessDenied);
    const ceo = await svc.user('u-fauzan');
    const flags = await svc.directorLegalFlags(ceo);
    const bo = flags.rows.find((r) => r.kind === 'BO_NOT_NOTIFIED' && r.title.includes('Late owner'))!;
    expect(bo).toMatchObject({ status: 'open', companyId: 'co-sasa', since: '2026-10-15' });
    expect(bo.source).toMatch(/Companies Act 2016/);
    expect(bo.responsible).toMatch(/Deputy Chief of Staff/);
    expect(bo.history.some((h) => h.action === 'corp.file.save')).toBe(true);
    const st = flags.rows.find((r) => r.kind === 'AGREEMENT_NOT_STAMPED' && r.records[0].id === l.id)!;
    expect(st).toMatchObject({ status: 'open', responsibleAssumed: true });
    expect(st.source).toMatch(/Stamp Act 1949 s\.47A/);
    expect(st.history.some((h) => h.action.startsWith('credit.'))).toBe(true);
    expect(flags.rows.every((r) => r.status === 'open')).toBe(true);
    expect(JSON.stringify(await svc.home(ceo))).toMatch(/legal point/);
    // Once stamped, the flag closes; nothing is ever labelled compliant here.
    await svc.creditStamped(officer, l.id, 'ST-1 (mock)', '2026-10-30');
    expect((await svc.directorLegalFlags(ceo)).rows.some((r) => r.records[0].id === l.id && r.kind === 'AGREEMENT_NOT_STAMPED')).toBe(false);
    expect(JSON.stringify(await svc.directorLegalFlags(ceo))).not.toMatch(/compliant"/);
  });
});

// Round 2 (Arisha main, 2 Nov 2026 16:16Z): a stamp, charge lodgement or signing date already recorded can be corrected,
// with a reason and history; the stamping clock runs from the signing date and no order between signing and start is forced.
describe('Corrections to records already stamped or lodged (review round 2)', () => {
  it('corrects or takes off a recorded stamp, with a reason, history and audit; only the credit officer', async () => {
    const { svc, store } = fresh();
    const officer = await svc.user('u-credit');
    const l = await svc.addCreditLoan(officer, 'co-sasa', loan);
    const fix = { field: 'stamp' as const, ref: 'ST-2 (mock)', on: '2026-10-01', reason: 'Wrong certificate keyed in' };
    await expect(svc.creditCorrectRecord(officer, l.id, fix)).rejects.toThrow(/No stamping is recorded/);
    await svc.creditStamped(officer, l.id, 'ST-1 (mock)', '2026-10-02');
    for (const id of ['u-cm-sasa', 'u-cos', 'u-fauzan'])
      await expect(svc.creditCorrectRecord(await svc.user(id), l.id, fix)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.creditCorrectRecord(officer, l.id, { ...fix, reason: 'no' })).rejects.toThrow(/why/);
    await expect(svc.creditCorrectRecord(officer, l.id, { ...fix, on: '2026-02-30' })).rejects.toThrow(/real date/);
    await expect(svc.creditCorrectRecord(officer, l.id, { ...fix, on: '2026-12-01' })).rejects.toThrow(/future/);
    await expect(svc.creditCorrectRecord(officer, l.id, { ...fix, ref: 'ST-1 (mock)', on: '2026-10-02' })).rejects.toThrow(/Nothing changed/);
    const after = await svc.creditCorrectRecord(officer, l.id, fix);
    expect(after.stamped).toEqual({ ref: 'ST-2 (mock)', on: '2026-10-01' });
    expect(after).toMatchObject({ principal: l.principal, ratePct: l.ratePct, schedule: l.schedule });
    // Stamped in error: take it off, and the agreement is back to "not stamped".
    const off = await svc.creditCorrectRecord(officer, l.id, { field: 'stamp', ref: null, on: null, reason: 'Recorded on the wrong loan' });
    expect(off.stamped).toBeNull();
    expect(off.corrections!.map((c) => [c.field, c.from, c.to])).toEqual([
      ['stamp', 'ST-1 (mock) on 2026-10-02', 'ST-2 (mock) on 2026-10-01'],
      ['stamp', 'ST-2 (mock) on 2026-10-01', 'not stamped'],
    ]);
    expect((await svc.creditBoard(officer)).rows.find((r) => r.loan.id === l.id)!.stampState).not.toBe('ok');
    const log = (await store.list('audit', {})).filter((a) => a.action === 'credit.stamp.correct');
    expect(log).toHaveLength(2);
    expect(log[1].summary).toMatch(/wrong loan/);
  });

  it('corrects a lodged charge and refuses half a lodgement or a date before creation', async () => {
    const { svc, store } = fresh();
    const officer = await svc.user('u-credit');
    const l = await svc.addCreditLoan(officer, 'co-sasa', {
      ...loan,
      collateral: 'ASSET_CHARGE',
      collateralRef: 'CHG-1 (mock)',
      chargeCreatedOn: '2026-09-20',
    });
    await svc.creditChargeLodged(officer, l.id, 'SSM-1 (mock)', '2026-10-05');
    const base = { field: 'charge' as const, createdOn: '2026-09-20', reason: 'SSM reference mistyped' };
    await expect(svc.creditCorrectRecord(officer, l.id, { ...base, ssmRef: 'SSM-2 (mock)', lodgedOn: null })).rejects.toThrow(/both/);
    await expect(svc.creditCorrectRecord(officer, l.id, { ...base, ssmRef: 'SSM-2 (mock)', lodgedOn: '2026-09-01' })).rejects.toThrow(/before the charge/);
    const after = await svc.creditCorrectRecord(officer, l.id, { ...base, ssmRef: 'SSM-2 (mock)', lodgedOn: '2026-10-05' });
    expect(after.charge).toEqual({ createdOn: '2026-09-20', lodgedOn: '2026-10-05', ssmRef: 'SSM-2 (mock)' });
    expect((await store.list('audit', {})).some((a) => a.action === 'credit.charge.correct' && /mistyped/.test(a.summary))).toBe(true);
  });

  it('counts the stamping clock from the signing date when recorded, and never forces signing before start', async () => {
    const { svc } = fresh();
    const officer = await svc.user('u-credit');
    const ceo = await svc.user('u-fauzan');
    // No signing date: counted from the start date, and the row and flag say so.
    const a = await svc.addCreditLoan(officer, 'co-sasa', loan);
    let row = (await svc.creditBoard(officer)).rows.find((r) => r.loan.id === a.id)!;
    expect(row).toMatchObject({ stampFrom: 'start', stampDays: 48, stampState: 'overdue' });
    let flag = (await svc.directorLegalFlags(ceo)).rows.find((r) => r.kind === 'AGREEMENT_NOT_STAMPED' && r.records[0].id === a.id)!;
    expect(flag.records[0].label).toMatch(/signing date not recorded/);
    expect(flag.detail).toMatch(/counted from the start date/);
    // Signed after the start date (allowed: no order is forced): the clock moves to the signing date.
    await expect(svc.creditCorrectRecord(officer, a.id, { field: 'signedOn', signedOn: '2026-11-30', reason: 'From the signed copy' })).rejects.toThrow(
      /future/,
    );
    await svc.creditCorrectRecord(officer, a.id, { field: 'signedOn', signedOn: '2026-10-20', reason: 'From the signed copy' });
    row = (await svc.creditBoard(officer)).rows.find((r) => r.loan.id === a.id)!;
    expect(row).toMatchObject({ stampFrom: 'signed', stampDays: 13 });
    expect((await svc.directorLegalFlags(ceo)).rows.some((r) => r.kind === 'AGREEMENT_NOT_STAMPED' && r.records[0].id === a.id)).toBe(false);
    // Recorded at entry, before the start date, is also fine.
    const b = await svc.addCreditLoan(officer, 'co-sasa', { ...loan, startOn: '2026-11-01', signedOn: '2026-10-25' });
    expect(b.signedOn).toBe('2026-10-25');
    await expect(svc.addCreditLoan(officer, 'co-sasa', { ...loan, signedOn: '2026-02-29' })).rejects.toThrow(/signing date/);
    flag = (await svc.directorLegalFlags(ceo)).rows.find((r) => r.kind === 'AGREEMENT_NOT_STAMPED' && r.records[0].id === b.id)!;
    expect(flag).toBeUndefined();
  });
});
