import { describe, expect, it } from 'vitest';
import { AccessDenied, GROUP_EMPLOYER_ID, MemoryStore, PrimaService, builtInStatTables, generateDataset, myt, parseStatRows, statShare } from '../src';

// EPF and PERKESO contribution tables kept row by row (Fauzan, 2 Nov 2026: "Make sure epf and socso have table for it.
// Make sure the system have the information stored ... Epf or socso publish their table of calculation"), and the
// statutory payments filled from the approved payroll (automation A1). Dummy data only, never staging.
const TODAY = '2026-10-31';
const NOW = myt(TODAY, '10:00');
const P = TODAY.slice(0, 7);

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  ds.staffPayRuns = ds.staffPayRuns.filter((r) => r.id !== `sp-${GROUP_EMPLOYER_ID}-${P}`);
  for (const p of ds.people.filter((x) => x.companyId === GROUP_EMPLOYER_ID && !x.bank)) p.bank = { bank: 'Maybank', accountMasked: '****0001' };
  return { ds, svc };
}
const table = (id: string) => builtInStatTables().find((t) => t.id === id)!;

describe('EPF and PERKESO tables kept in Prima', () => {
  it('reproduces the published rows it was checked against', () => {
    const epf = table('EPF-A');
    for (const [wage, er, ee] of [
      [15, 3, 3],
      [30, 6, 5],
      [1710, 224, 190],
      [5000, 650, 550],
      [5050, 612, 561],
      [20000, 2400, 2200],
    ])
      expect(statShare(epf, wage)).toMatchObject({ er, ee });
    // Above RM20,000: 12% and 11% of the whole wage, rounded up to the ringgit.
    expect(statShare(epf, 25000.5)).toMatchObject({ er: 3001, ee: 2751 });
    const socso = table('SOCSO-1');
    for (const [wage, er, ee] of [
      [20, 0.4, 0.1],
      [550, 9.65, 2.75],
      [1050, 18.35, 5.25],
      [2550, 44.65, 12.75],
      [4050, 70.85, 20.25],
      [5950, 104.15, 29.75],
      [9000, 104.15, 29.75],
    ])
      expect(statShare(socso, wage)).toMatchObject({ er, ee });
    expect(statShare(table('EIS'), 5950)).toMatchObject({ er: 11.9, ee: 11.9 });
    expect(statShare(table('EIS'), 9000)).toMatchObject({ er: 11.9, ee: 11.9, band: 'Above RM6,000.00 (ceiling)' });
  });

  it('reads a pasted table and refuses rows with gaps or bad amounts', () => {
    expect(parseStatRows('0.01\t30.00\t0.40\t0.10\n30.01\t50.00\t0.70\t0.20')).toEqual([
      { upTo: 30, er: 0.4, ee: 0.1 },
      { upTo: 50, er: 0.7, ee: 0.2 },
    ]);
    expect(() => parseStatRows('0.01\t30.00\t0.40\t0.10\n40.01\t50.00\t0.70\t0.20')).toThrow(/row before ended/);
    expect(() => parseStatRows('0.01\t30.00\t0.40\nx')).toThrow();
    expect(() => parseStatRows('30\t0.40\t0.10\n20\t0.70\t0.20')).toThrow(/do not follow/);
  });

  it('keeps checked reference tables without silently replacing month-effective payroll authority', async () => {
    const { svc, ds } = fresh();
    const [hr, fd, cos, fin, staff] = await Promise.all(['u-pwvsb-hr', 'u-fd', 'u-cos', 'u-fin-t1-lead', 'u-fin-t1-de1'].map((id) => svc.user(id)));
    // A pretend new PERKESO table: every row RM1 more for the employer.
    const rows = table('SOCSO-1')
      .rows.map((r) => `${r.upTo}\t${(r.er + 1).toFixed(2)}\t${r.ee.toFixed(2)}`)
      .join('\n');
    await expect(svc.loadStatTable(await svc.user('u-guard-sasa-1'), { id: 'SOCSO-1', from: P, source: 'PERKESO notice (mock)', doc: 'x.pdf', rows })).rejects.toBeInstanceOf(AccessDenied);
    const loaded = await svc.loadStatTable(hr, { id: 'SOCSO-1', from: P, source: 'PERKESO contribution table notice (mock)', doc: 'Jadual caruman (mock).pdf', rows });
    expect(loaded.table).toMatchObject({ version: 'v2', status: 'loaded' });
    expect(loaded.changeCount).toBe(table('SOCSO-1').rows.length);
    // Loading and checking never activate reference rows for payroll.
    let run = await svc.prepareStaffPay(hr, GROUP_EMPLOYER_ID, P);
    const l0 = run.lines.find((l) => l.gross > 1000 && l.age < 60)!;
    expect(l0.statBands).toBeUndefined();
    expect(l0.statutoryInputs).toBeTruthy();
    // Nobody checks their own load; Finance staff and HR do not check; the Finance Director, CoS or CEO does.
    await expect(svc.checkStatTable(staff, { id: 'SOCSO-1', version: 'v2', decision: 'check', comment: 'Looks right' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.checkStatTable(cos, { id: 'SOCSO-1', version: 'v2', decision: 'check', comment: '' })).rejects.toThrow(/what you checked/i);
    await svc.checkStatTable(fd, { id: 'SOCSO-1', version: 'v2', decision: 'check', comment: 'Every row against the PERKESO PDF (mock)' });
    run = await svc.prepareStaffPay(hr, GROUP_EMPLOYER_ID, P);
    const l1 = run.lines.find((l) => l.personId === l0.personId)!;
    expect(l1.socsoEr).toBe(l0.socsoEr);
    expect(l1.statutoryInputs).toBe(l0.statutoryInputs);
    expect(l1.statBands).toBeUndefined();
    expect(run.tables).toBeUndefined();
    const v = await svc.statTables(fin);
    expect(v).toMatchObject({ calculationSource: 'month_effective_statutory_settings', tableApplication: 'review_only' });
    expect(v.inForce.find((t) => t.id === 'SOCSO-1')).toMatchObject({ version: 'v2', status: 'checked' });
    expect(v.history.map((t) => t.version)).toEqual(['v2']);
    // The loader cannot check their own: the Finance Director loads, the CoS checks.
    await svc.loadStatTable(fd, { id: 'EIS', from: '2027-01', source: 'PERKESO EIS notice (mock)', doc: 'eis.pdf', rows: '30\t0.05\t0.05\n6000\t12\t12' });
    await expect(svc.checkStatTable(fd, { id: 'EIS', version: 'v2', decision: 'check', comment: 'Checked it' })).rejects.toBeInstanceOf(AccessDenied);
    await svc.checkStatTable(cos, { id: 'EIS', version: 'v2', decision: 'reject', comment: 'Rows missing against the PDF' });
    expect(ds.finStatus.find((f) => f.companyId === GROUP_EMPLOYER_ID)!.statutoryTables!.map((t) => `${t.id} ${t.version} ${t.status}`)).toEqual(['SOCSO-1 v2 checked']);
  });

  it('keeps staff and employer numbers on the contribution files and flags what is missing', async () => {
    const { svc, ds } = fresh();
    const [hr, cos, vc, fin] = await Promise.all(['u-pwvsb-hr', 'u-cos', 'u-coo', 'u-fin-t1-lead'].map((id) => svc.user(id)));
    const someone = ds.people.find((p) => p.companyId === GROUP_EMPLOYER_ID && p.role === 'office' && p.status === 'active')!;
    expect(someone.epfNo && someone.socsoNo && someone.taxNo).toBeTruthy();
    someone.epfNo = undefined;
    await svc.setEmployerNos(fin, GROUP_EMPLOYER_ID, { epf: 'EPF 12345678', socso: 'E1234567890X', lhdnE: 'E 9876543210', hrd: null });
    await expect(svc.setEmployerNos(await svc.user('u-guard-sasa-1'), GROUP_EMPLOYER_ID, { epf: '1' })).rejects.toBeInstanceOf(AccessDenied);
    const run = await svc.prepareStaffPay(hr, GROUP_EMPLOYER_ID, P);
    expect(run.lines.find((l) => l.personId === someone.id)!.flags).toContain('No EPF (KWSP) number on record');
    await svc.staffPayStep(hr, run.id, 'submit');
    await svc.staffPayStep(cos, run.id, 'approve', { note: 'CoS checked payroll (mock)' });
    await svc.staffPayStep(vc, run.id, 'coo_approve', { note: 'COO approved payroll (mock)' });
    const epf = (await svc.staffPayExport(fin, run.id, 'epf')).body.split('\n');
    expect(epf[0]).toBe('Employer EPF number,EPF 12345678');
    expect(epf[1]).toBe('Staff no,Name,IC / passport,EPF member no,Wages,Employee,Employer');
    expect(epf.find((l) => l.startsWith(someone.staffNo))).toContain('MISSING: ask HR');
    expect((await svc.staffPayExport(fin, run.id, 'socso')).body.split('\n')[0]).toBe('Employer PERKESO code,E1234567890X');
  });

  it('fills the EPF, PERKESO, PCB and HRD payments from the approved payroll (A1)', async () => {
    const { svc, ds } = fresh();
    const [hr, cos, vc, de1, dep] = await Promise.all(['u-pwvsb-hr', 'u-cos', 'u-coo', 'u-fin-t1-de1', 'u-fin-t1-dep'].map((id) => svc.user(id)));
    const run = await svc.prepareStaffPay(hr, GROUP_EMPLOYER_ID, P);
    const F = ds.finStatus.find((f) => f.companyId === GROUP_EMPLOYER_ID)!;
    const add = async (body: string) => {
      const r = (await svc.financeControls.regularAction(de1, GROUP_EMPLOYER_ID, 'add', {
        kind: 'statutory', body, fromPayroll: true, name: `${body} staff (mock)`, payeeId: 'payee-pwvsb-001', reference: `${body} employer no (mock)`, method: 'transfer', bankId: F.banks[0].id, every: 'monthly', dueDay: 15, firstDue: '2026-11-15',
      })) as { id: string };
      await svc.financeControls.regularAction(dep, GROUP_EMPLOYER_ID, 'check', { regularId: r.id, comment: 'Agreed to the employer registration letter (mock)' });
      return r.id;
    };
    const epfId = await add('EPF');
    const perkesoId = await add('PERKESO');
    await expect(svc.financeControls.regularAction(de1, GROUP_EMPLOYER_ID, 'add', { kind: 'statutory', body: 'LHDN CP204', fromPayroll: true })).rejects.toThrow();
    // Not approved yet: nothing to fill from.
    await expect(svc.financeControls.regularAction(de1, GROUP_EMPLOYER_ID, 'bill', { regularId: epfId, period: '2026-11' })).rejects.toThrow(/not approved yet/);
    await svc.staffPayStep(hr, run.id, 'submit');
    await svc.staffPayStep(cos, run.id, 'approve', { note: 'CoS checked payroll (mock)' });
    await svc.staffPayStep(vc, run.id, 'coo_approve', { note: 'COO approved payroll (mock)' });
    const epf = Math.round(run.lines.reduce((n, l) => n + l.epfEe + l.epfEr, 0) * 100) / 100;
    const perkeso = Math.round(run.lines.reduce((n, l) => n + l.socsoEe + l.socsoEr + l.eisEe + l.eisEr + l.lindungEe, 0) * 100) / 100;
    // Prima fills the amount and the document; a different amount is refused.
    await expect(svc.financeControls.regularAction(de1, GROUP_EMPLOYER_ID, 'bill', { regularId: epfId, period: '2026-11', amount: epf + 1 })).rejects.toThrow(/works out RM/);
    const r1 = (await svc.financeControls.regularAction(de1, GROUP_EMPLOYER_ID, 'bill', { regularId: epfId, period: '2026-11' })) as { dues: { period: string; bill: { amount: number; doc: string } }[] };
    expect(r1.dues.find((d) => d.period === '2026-11')!.bill).toMatchObject({ amount: epf, doc: `Prima staff payroll ${P}: EPF list` });
    const r2 = (await svc.financeControls.regularAction(de1, GROUP_EMPLOYER_ID, 'bill', { regularId: perkesoId, period: '2026-11' })) as { dues: { period: string; bill: { amount: number } }[] };
    expect(r2.dues.find((d) => d.period === '2026-11')!.bill.amount).toBe(perkeso);
  });
});
