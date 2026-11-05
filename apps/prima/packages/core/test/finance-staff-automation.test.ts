import { describe, expect, it } from 'vitest';
import { GROUP_EMPLOYER_ID, MemoryStore, PrimaService, finPayrollFinal, generateDataset, myt } from '../src';

// Automation to make Finance staff work easier (Fauzan, 2 Nov 2026: "Yes proceed" to A1-A17). Prima fills things in
// and reminds; people still review and approve, and nothing is paid by Prima. Dummy data only, never staging.
const TODAY = '2026-10-31';
const NOW = myt(TODAY, '10:00');
const P = TODAY.slice(0, 7);

async function setup(consent = true) {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  ds.staffPayRuns = ds.staffPayRuns.filter((r) => r.id !== `sp-${GROUP_EMPLOYER_ID}-${P}`);
  for (const p of ds.people.filter((x) => x.companyId === GROUP_EMPLOYER_ID && !x.bank)) p.bank = { bank: 'Maybank', accountMasked: '****0001' };
  const u = Object.fromEntries(await Promise.all(['u-pwvsb-hr', 'u-cos', 'u-vchair', 'u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-dep', 'u-fd'].map(async (id) => [id, await svc.user(id)])));
  const F = ds.finStatus.find((f) => f.companyId === GROUP_EMPLOYER_ID)!;
  const add = async (body: string, extra: Record<string, unknown> = {}) => {
    const r = (await svc.financeControls.regularAction(u['u-fin-t1-de1'], GROUP_EMPLOYER_ID, 'add', {
      kind: 'statutory', body, fromPayroll: true, name: `${body} staff (mock)`, payeeId: 'payee-pwvsb-001', reference: `${body} employer no`, method: 'transfer', bankId: F.banks[0].id, every: 'monthly', dueDay: 5, firstDue: '2026-11-05', ...extra,
    })) as { id: string };
    await svc.financeControls.regularAction(u['u-fin-t1-dep'], GROUP_EMPLOYER_ID, 'check', { regularId: r.id, comment: 'Agreed to the registration letter (mock)' });
    return r.id;
  };
  const run = await svc.prepareStaffPay(u['u-pwvsb-hr'], GROUP_EMPLOYER_ID, P);
  await svc.staffPayStep(u['u-pwvsb-hr'], run.id, 'submit');
  await svc.staffPayStep(u['u-cos'], run.id, 'approve', { note: 'Checked (synthetic)' });
  if (consent) await svc.staffPayStep(await svc.user('u-coo'), run.id, 'coo_approve', { note: 'Approved (synthetic)' });
  return { ds, svc, u, F, add, run };
}

describe('Finance automation (A2-A4, A13)', () => {
  it('does not fill statutory payments from a payroll only the CoS has approved (final approval still owed)', async () => {
    const { svc, u, add } = await setup(false);
    await add('EPF');
    const out = await svc.financeControls.prepareRegularDue(u['u-fin-t1-de2'], GROUP_EMPLOYER_ID);
    expect(out.filledFromPayroll.some((x) => x.startsWith('EPF staff (mock)'))).toBe(false);
    expect(finPayrollFinal('approved')).toBe(false);
    for (const st of ['consented', 'coo_approved', 'paid']) expect(finPayrollFinal(st)).toBe(true);
  });
  it('prepares every regular transfer due within 7 days with one press, the payroll amounts filled in by Prima', async () => {
    const { svc, u, F, add, run } = await setup();
    const epfId = await add('EPF');
    const pcbId = await add('LHDN PCB');
    const today = await svc.financeToday(u['u-fin-t1-de2']);
    expect(today.some((t) => /due within 7 days to prepare/.test(t.title))).toBe(true);
    const out = await svc.financeControls.prepareRegularDue(u['u-fin-t1-de2'], GROUP_EMPLOYER_ID);
    const epf = Math.round(run.lines.reduce((n, l) => n + l.epfEe + l.epfEr, 0) * 100) / 100;
    expect(out.filledFromPayroll.some((x) => x.startsWith('EPF staff (mock) 2026-11'))).toBe(true);
    const ids = out.prepared.filter((p) => p.regularId === epfId || p.regularId === pcbId);
    // PCB may be RM0 at these pay levels; EPF never is.
    expect(ids.find((p) => p.regularId === epfId)).toMatchObject({ period: '2026-11', amount: epf });
    const pay = F.payments!.find((p) => p.id === ids[0].id) ?? (await svc.finance.desk(u['u-fd'])).companies.find((c) => c.companyId === GROUP_EMPLOYER_ID)!.payments.find((p) => p.id === ids[0].id)!;
    expect(pay.steps[0]).toMatchObject({ step: 'prepared', byId: 'u-fin-t1-de2' });
    // Pressing again prepares nothing twice.
    const again = await svc.financeControls.prepareRegularDue(u['u-fin-t1-de2'], GROUP_EMPLOYER_ID);
    expect(again.prepared.filter((p) => p.regularId === epfId)).toEqual([]);
  });

  it('lets the Finance Director approve reviewed regular payments together with one comment, each still checked', async () => {
    const { svc, u, add } = await setup();
    const epfId = await add('EPF');
    const perkesoId = await add('PERKESO');
    const out = await svc.financeControls.prepareRegularDue(u['u-fin-t1-de2'], GROUP_EMPLOYER_ID);
    const ids = out.prepared.filter((p) => [epfId, perkesoId].includes(p.regularId)).map((p) => p.id);
    expect(ids).toHaveLength(2);
    for (const id of ids) await svc.finance.paymentStep(u['u-fin-t1-dep'], GROUP_EMPLOYER_ID, id, 'review', { comment: 'Agreed to the payroll list' });
    // Only the FD or the CEO; a comment is needed; an ordinary payment id is refused, the rest go through.
    await expect(svc.financeControls.regularAction(u['u-fin-t1-dep'], GROUP_EMPLOYER_ID, 'approveBatch', { paymentIds: ids, comment: 'OK all' })).rejects.toThrow();
    await expect(svc.financeControls.regularAction(u['u-fd'], GROUP_EMPLOYER_ID, 'approveBatch', { paymentIds: ids, comment: '' })).rejects.toThrow();
    const r = (await svc.financeControls.regularAction(u['u-fd'], GROUP_EMPLOYER_ID, 'approveBatch', { paymentIds: [...ids, 'pay-not-there'], comment: 'Statutory for October agreed to payroll' })) as {
      approved: string[];
      refused: { id: string }[];
    };
    expect(r.approved.sort()).toEqual([...ids].sort());
    expect(r.refused.map((x) => x.id)).toEqual(['pay-not-there']);
    const desk = await svc.finance.desk(u['u-fd']);
    const saved = desk.companies.find((c) => c.companyId === GROUP_EMPLOYER_ID)!.payments.filter((p) => ids.includes(p.id));
    expect(saved.every((p) => p.status === 'approved' && p.steps.at(-1)!.comment.startsWith('Statutory for October agreed to payroll'))).toBe(true);
  });

  it('puts one line for the Finance day at the top of home, and marks payments due within a day urgent', async () => {
    const { svc, u, add } = await setup();
    await add('EPF', { dueDay: 1, firstDue: '2026-11-01' });
    const today = await svc.financeToday(u['u-fin-t1-de2']);
    expect(today.some((t) => /due today or tomorrow/.test(t.title) && t.tone === 'crit')).toBe(true);
    expect(today.length).toBeGreaterThan(3);
    expect(today[0].title).toMatch(/^Your Finance day: \d+ things waiting, \d+ urgent/);
    // The Finance Director's home starts with the same kind of line once three or more Finance things wait.
    const fd = (await svc.home(u['u-fd'])).todo.filter((t) => t.tag === 'Finance');
    expect(fd.length).toBeGreaterThan(3);
    expect(fd[0].title).toMatch(/^Your Finance day/);
    await expect(svc.financeToday(await svc.user('u-guard-sasa-1'))).rejects.toThrow();
  });
});

describe('Bank statements made easier (A5-A7) and the close list (A9, L2)', () => {
  it('reads the columns of the usual Malaysian bank exports', async () => {
    const { parseStatementCsv } = await import('../src');
    const cimb = parseStatementCsv(
      ['Transaction Date,Description,Cheque/Ref No,Withdrawal,Deposit,Balance', '01/09/2026,OPENING BALANCE,,,,10000.00', '03/09/2026,IBG TNB,TNB123,"1,234.56",,8765.44', '05/09/2026,DUITNOW FROM CLIENT,DN99,,500.00,9265.44'].join('\n'),
    );
    expect(cimb.map((l) => [l.date, l.amount, l.ref])).toEqual([
      ['2026-09-01', 0, ''],
      ['2026-09-03', -1234.56, 'TNB123'],
      ['2026-09-05', 500, 'DN99'],
    ]);
    const maybank = parseStatementCsv(['Entry Date,Transaction Description,Transaction Amount,Statement Balance', '03 Sep 2026,SERVICE CHARGE,1.00-,9999.00', '04-09-2026,CASH DEPOSIT,"2,000.00",11999.00', 'Total,,,'].join('\n'));
    expect(maybank.map((l) => [l.date, l.amount, l.description])).toEqual([
      ['2026-09-03', -1, 'SERVICE CHARGE'],
      ['2026-09-04', 2000, 'CASH DEPOSIT'],
    ]);
    // No header: the older 4-column layout still works.
    expect(parseStatementCsv('2026-09-03,TRF,ABC,-10')[0].amount).toBe(-10);
  });

  it('suggests the payment for an unmatched bank line, remembers explanations, and ticks what is already done on the close', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    const F = () => ds.finStatus.find((f) => f.companyId === GROUP_EMPLOYER_ID)!;
    F().payments = (F().payments ?? []).filter((p) => !(p.status === 'released' && p.releasedOn?.startsWith('2026-09')));
    const [de1, de2, dep, fd] = await Promise.all(['u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-dep', 'u-fd'].map((id) => svc.user(id)));
    const bankId = F().banks[0].id;
    const p = await svc.finance.createPayment(de1, GROUP_EMPLOYER_ID, { payeeId: 'payee-pwvsb-001', purpose: 'Sept supplies', amount: 777.77, dueOn: '2026-09-10', bankId, sqlRef: 'PI-SUG-1', evidence: ['i.pdf'] });
    await svc.finance.paymentStep(dep, GROUP_EMPLOYER_ID, p.id, 'review', { comment: 'ok' });
    await svc.finance.paymentStep(fd, GROUP_EMPLOYER_ID, p.id, 'approve', { comment: 'Supplies.' });
    F().payments!.find((x) => x.id === p.id)!.steps.find((x) => x.step === 'approved')!.at = myt('2026-09-08', '09:00');
    await svc.finance.paymentStep(de2, GROUP_EMPLOYER_ID, p.id, 'release', { bankRef: 'M2U-SUG', releasedOn: '2026-09-08', accountLast4: '1000', accountName: 'SYARIKAT BEKALAN PEJABAT' });
    // The bank took it 6 days later with another reference: too far for Prima to match on its own.
    const csv = ['Date,Description,Ref,Amount', '2026-09-14,IBG PAYMENT,XYZ,-777.77', '2026-09-30,SERVICE CHARGE 0925,,-2.00'].join('\n');
    await svc.financeControls.statementAction(dep, GROUP_EMPLOYER_ID, 'load', { bankId, period: '2026-09', opening: 1000, closing: 220.23, csv, source: 'm2u-sep.csv' });
    let v = await svc.financeControls.view(fd, GROUP_EMPLOYER_ID);
    const lines = v.statements.find((s) => s.bank.id === bankId)!.lines;
    expect(lines[0].suggest).toEqual([expect.objectContaining({ paymentId: p.id, days: 6 })]);
    await svc.financeControls.statementAction(dep, GROUP_EMPLOYER_ID, 'match', { statementId: `stmt-${bankId}-2026-09`, lineId: lines[0].id, paymentId: p.id, comment: "Accepted Prima's suggestion: same amount" });
    // Remember the bank charge; a rule above the cap is refused.
    await expect(
      svc.financeControls.statementAction(dep, GROUP_EMPLOYER_ID, 'explain', { statementId: `stmt-${bankId}-2026-09`, lineId: lines[1].id, comment: 'Monthly bank service charge', remember: true, maxAmount: 999999 }),
    ).rejects.toThrow(/up to RM/);
    const ex = (await svc.financeControls.statementAction(dep, GROUP_EMPLOYER_ID, 'explain', { statementId: `stmt-${bankId}-2026-09`, lineId: lines[1].id, comment: 'Monthly bank service charge', remember: true })) as { rule: { pattern: string; maxAmount: number } };
    expect(ex.rule).toMatchObject({ pattern: 'SERVICECHARGE', maxAmount: 4 });
    // August's statement: Prima explains the same kind of line by itself, but not a bigger one.
    await svc.financeControls.statementAction(de1, GROUP_EMPLOYER_ID, 'load', { bankId, period: '2026-08', opening: 1000, closing: 992, csv: ['Date,Description,Ref,Amount', '2026-08-31,SERVICE CHARGE 0825,,-2.00', '2026-08-31,SERVICE CHARGE EXTRA,,-6.00'].join('\n'), source: 'm2u-aug.csv' });
    const aug = F().statements!.find((s) => s.period === '2026-08' && s.bankId === bankId)!;
    expect(aug.lines.map((l) => l.match?.kind ?? null)).toEqual(['other', null]);
    expect(aug.lines[0].match).toMatchObject({ by: 'Prima (automatic)', ruleId: expect.any(String) });
    v = await svc.financeControls.view(fd, GROUP_EMPLOYER_ID);
    expect(v.matchRules[0].used).toBe(1);
    // The close list shows what Prima already confirmed.
    const desk = await svc.finance.desk(fd);
    const done = desk.companies.find((c) => c.companyId === GROUP_EMPLOYER_ID)!.close.check.done;
    expect(done.some((d) => /statement loaded, every payment out matched or explained/.test(d))).toBe(true);
  });
});

describe('Tax and statutory calendar from the year end (A10)', () => {
  it('builds the deadlines for a 31 December year end and ticks what Prima sees or Finance records', async () => {
    const { finTaxDeadlines } = await import('../src');
    const f = { fyEnd: '12-31', sst: { registered: true, sstNo: 'W10-0000-00000000', cycleStartMonth: 1, last12Months: null, returns: [] }, einvoice: undefined } as never;
    const d = finTaxDeadlines(f, 2026);
    const due = (k: string) => d.find((x) => x.key === k)?.dueOn;
    expect(due('formc:2025-12-31')).toBe('2026-07-31');
    expect(due('circulate:2025-12-31')).toBe('2026-06-30');
    expect(due('cp204est:2027-01-01')).toBe('2026-12-02');
    expect(due('cp204a:2026-01-01:6')).toBe('2026-06-30');
    expect(due('ea:2025')).toBe('2026-02-28');
    expect(due('forme:2025')).toBe('2026-03-31');
    expect(due('epf:2026-09')).toBe('2026-10-15');
    // SST-02 for Jan-Feb is due by the end of March.
    expect(due('sst:2026-01')).toBe('2026-03-31');
    const ds = generateDataset({ today: TODAY, now: NOW });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    const de1 = await svc.user('u-fin-t1-de1');
    const F = ds.finStatus.find((x) => x.companyId === GROUP_EMPLOYER_ID)!;
    F.fyEnd = '12-31';
    await expect(svc.financeControls.taxAction(de1, GROUP_EMPLOYER_ID, 'file', { key: 'cp204est:2027-01-01', ref: 'x', filedOn: '2026-10-30' })).rejects.toThrow(/reference/);
    await expect(svc.financeControls.taxAction(de1, GROUP_EMPLOYER_ID, 'file', { key: 'cp204est:2027-01-01', ref: 'e-CP204 ACK 123', filedOn: '2026-12-01' })).rejects.toThrow(/future/);
    await svc.financeControls.taxAction(de1, GROUP_EMPLOYER_ID, 'file', { key: 'cp204est:2027-01-01', ref: 'e-CP204 ACK 123', filedOn: '2026-10-30' });
    const v = await svc.financeControls.view(de1, GROUP_EMPLOYER_ID);
    expect(v.taxCalendar.find((x) => x.key === 'cp204est:2027-01-01')).toMatchObject({ status: 'done', doneBy: expect.stringContaining('e-CP204 ACK 123') });
    expect(v.taxCalendar.find((x) => x.key === 'epf:2026-10')).toMatchObject({ dueOn: '2026-11-15', status: 'upcoming' });
  });
});

describe('Client reminders and payees from e-Invoices (A12, A16)', () => {
  it('drafts reminders at 30, 60 and 90 days and stops once one is marked sent', async () => {
    const { finArReminders } = await import('../src');
    const base = { id: 'ar-1', invoiceNo: 'INV-1', invoiceDate: '2026-07-01', customer: 'Client Sdn Bhd (mock)', amount: 5000, outstanding: 5000, eInvoiceUuid: null, reason: 'dispute', detail: '', status: 'open', opened: { by: 'x', byId: 'x', at: '2026-07-01T00:00:00+08:00', comment: '' }, log: [], nextOn: null, reissue: null, provision: null, writeOff: null } as never;
    const f = { arCases: [base] } as never;
    const r = finArReminders(f, '2026-10-31');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ level: 3, days: 122 });
    expect(r[0].subject).toMatch(/^Final reminder: invoice INV-1/);
    expect(r[0].text).toContain('RM5,000.00');
    const sent = { arCases: [{ ...(base as object), log: [{ kind: 'reminder', text: 'sent', by: 'x', byId: 'x', at: '2026-10-20T10:00:00+08:00' }] }] } as never;
    expect(finArReminders(sent, '2026-10-31')).toEqual([]);
  });

  it('reads the supplier from a MyInvois e-Invoice, JSON or XML', async () => {
    const { finPayeeFromEInvoice } = await import('../src');
    const json = JSON.stringify({
      Invoice: [
        {
          AccountingSupplierParty: [
            {
              Party: [
                {
                  PartyIdentification: [{ ID: [{ _: 'C21638015020', schemeID: 'TIN' }] }, { ID: [{ _: '202001234567', schemeID: 'BRN' }] }],
                  PostalAddress: [{ CityName: [{ _: 'Kuala Lumpur' }], PostalZone: [{ _: '50480' }], AddressLine: [{ Line: [{ _: 'Lot 66, Jalan Mock' }] }] }],
                  PartyLegalEntity: [{ RegistrationName: [{ _: 'Supplier Mock Sdn Bhd' }] }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(finPayeeFromEInvoice(json)).toEqual({ name: 'Supplier Mock Sdn Bhd', tin: 'C21638015020', brn: '202001234567', address: 'Lot 66, Jalan Mock, 50480 Kuala Lumpur' });
    const xml = '<Invoice><cac:AccountingSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="TIN">C1</cbc:ID></cac:PartyIdentification><cac:PartyLegalEntity><cbc:RegistrationName>X Sdn Bhd</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty></Invoice>';
    expect(finPayeeFromEInvoice(xml)).toMatchObject({ name: 'X Sdn Bhd', tin: 'C1', brn: null });
    expect(() => finPayeeFromEInvoice('{"Invoice":[]}')).toThrow(/No supplier/);
  });
});
