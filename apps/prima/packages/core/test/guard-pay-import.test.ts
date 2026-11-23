import { describe, expect, it } from 'vitest';
import {
  AccessDenied,
  GUARD_PAY_IMPORT_FIELDS,
  MemoryStore,
  PrimaService,
  generateDataset,
  guardPayImportDiffs,
  guardPayImportItems,
  guardPayImportRows,
  guardPayNumber,
  idFitsMasked,
  matchGuardPayRow,
  mergeGuardPayExtras,
  myt,
  prepareSheet,
  readXls,
  smartMatch,
  type GuardPayImportPerson,
  type GuardPayLine,
} from '../src';
import { guardPayPrep } from './guard-pay-preparer';
import { buildXls } from './xls-fixture';

// Guard pay Add and Import (Fitri, 23 Nov 2026). Synthetic data only: made-up people and amounts.
const TODAY = '2026-11-05';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW, daysBack: 40 });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
};

/** The matched field of each column of a sheet, as the drawer shows it before the person changes anything. */
const mapped = (rows: string[][]) => {
  const p = prepareSheet(rows, GUARD_PAY_IMPORT_FIELDS);
  const m = smartMatch(p.table, GUARD_PAY_IMPORT_FIELDS, { headerRow: 0 });
  return { table: p.table, mapping: m.columns.map((c) => c.field), byHeader: Object.fromEntries(m.columns.map((c) => [c.header, c.field])) };
};

describe('guard pay import: reading a file', () => {
  it('finds the header under a title block and matches Malay column names', () => {
    const { byHeader } = mapped([
      ['SENARAI GAJI PENGAWAL'],
      ['BULAN: OKTOBER 2026'],
      [],
      ['BIL', 'NO. PEKERJA', 'NAMA', 'NO. K/P', 'HARI BEKERJA', 'OT (JAM)', 'ELAUN', 'POTONGAN', 'CATATAN', 'PCB', 'PENDAHULUAN', 'GAJI BERSIH'],
      ['1', 'G0001', 'Ali bin Abu', '900101-01-1234', '26', '52', '150.00', '20.00', 'Uniform no. 4', '0', '200', '2,150.00'],
      ['2', 'G0002', 'Siti binti Omar', '910202-02-2345', '24', '48', 'RM 100', '', '', '12.50', '', '1,980.50'],
    ]);
    expect(byHeader['NO. PEKERJA']).toBe('staffNo');
    expect(byHeader['NAMA']).toBe('name');
    expect(byHeader['NO. K/P']).toBe('idFull');
    expect(byHeader['HARI BEKERJA']).toBe('daysWorked');
    expect(byHeader['OT (JAM)']).toBe('otHours');
    expect(byHeader['ELAUN']).toBe('allowance');
    expect(byHeader['POTONGAN']).toBe('deduction');
    expect(byHeader['CATATAN']).toBe('note');
    expect(byHeader['PCB']).toBe('pcb');
    expect(byHeader['PENDAHULUAN']).toBe('advance');
    expect(byHeader['GAJI BERSIH']).toBe('net');
    expect(byHeader['BIL']).toBeNull();
  });

  it('matches English column names', () => {
    const { byHeader } = mapped([
      ['Employee No', 'Employee Name', 'IC No', 'Days Worked', 'Overtime Hours', 'Allowance', 'Other Deduction', 'Remarks', 'Salary Advance', 'Gross Pay'],
      ['G0001', 'Ali bin Abu', '900101011234', '26', '52', '150', '20', 'Uniform no. 4', '200', '2400'],
    ]);
    expect(byHeader['Employee No']).toBe('staffNo');
    expect(byHeader['Employee Name']).toBe('name');
    expect(byHeader['IC No']).toBe('idFull');
    expect(byHeader['Days Worked']).toBe('daysWorked');
    expect(byHeader['Overtime Hours']).toBe('otHours');
    expect(byHeader['Allowance']).toBe('allowance');
    expect(byHeader['Other Deduction']).toBe('deduction');
    expect(byHeader['Remarks']).toBe('note');
    expect(byHeader['Salary Advance']).toBe('advance');
    expect(byHeader['Gross Pay']).toBe('gross');
  });

  it('reads the rows: amounts as offices type them, blank rows left out, problems named per row', () => {
    expect(guardPayNumber('RM 1,250.50')).toBe(1250.5);
    expect(guardPayNumber('(50)')).toBe(-50);
    expect(guardPayNumber('12.5 jam')).toBe(12.5);
    expect(guardPayNumber('-')).toBeNull();
    expect(guardPayNumber('')).toBeNull();
    expect(guardPayNumber('lima puluh')).toBe('bad');
    const table = [
      ['No. Pekerja', 'Nama', 'Elaun', 'Potongan', 'Catatan', 'PCB', 'Hari Bekerja'],
      ['G0001', 'Ali', 'RM150', '20', 'Uniform no. 4', '0', '26'],
      ['', '', '', '', '', '', ''],
      ['G0002', 'Siti', 'abc', '', '', '', ''],
      ['', '', '100', '', '', '', ''],
      ['Disediakan oleh', '', '', '', '', '', ''],
    ];
    const mapping = ['staffNo', 'name', 'allowance', 'deduction', 'note', 'pcb', 'daysWorked'];
    const { rows, problems } = guardPayImportRows(table, mapping);
    expect(rows).toEqual([{ row: 2, staffNo: 'G0001', name: 'Ali', allowance: 150, deduction: 20, note: 'Uniform no. 4', pcb: 0, compare: { daysWorked: 26 } }]);
    expect(problems.map((p) => p.row)).toEqual([4, 5]);
    expect(problems[0].message).toMatch(/Allowance.*not an amount/);
    expect(problems[1].message).toMatch(/No staff number, IC or name/);
  });

  it('reads an Excel 97-2003 (.xls) sheet: shared text, numbers, a formula and a date', () => {
    const bytes = buildXls('Gaji', [
      ['No. Pekerja', 'Nama', 'Elaun', 'Tarikh'],
      ['G0001', 'Ali bin Abu', 150.5, { date: 46326 }],
      ['G0002', 'Siti binti Omar', 100, { formula: 'ok' }],
    ]);
    const [sheet] = readXls(bytes);
    expect(sheet.name).toBe('Gaji');
    expect(sheet.rows[0]).toEqual(['No. Pekerja', 'Nama', 'Elaun', 'Tarikh']);
    expect(sheet.rows[1].slice(0, 3)).toEqual(['G0001', 'Ali bin Abu', '150.5']);
    expect(sheet.rows[1][3]).toMatch(/^2026-/);
    expect(sheet.rows[2]).toEqual(['G0002', 'Siti binti Omar', '100', 'ok']);
    // A small workbook kept in the compound file's mini stream reads the same.
    const small = buildXls('S', [['A', 1]], { mini: true });
    expect(readXls(small)[0].rows).toEqual([['A', '1']]);
    expect(() => readXls(new Uint8Array(600))).toThrow(/not an Excel 97-2003/);
  });
});

describe('guard pay import: finding the guard and the items', () => {
  const people: GuardPayImportPerson[] = [
    { personId: 'p1', staffNo: '00123', name: 'Ali bin Abu', idMasked: '900101-**-***4' },
    { personId: 'p2', staffNo: 'G0002', name: 'Siti binti Omar', idMasked: '910202-**-***5' },
    { personId: 'p3', staffNo: 'G0003', name: 'Muthu a/l Raju', idMasked: '880303-**-***6' },
    { personId: 'p4', staffNo: 'G0004', name: 'Ah Kow', idMasked: '880303-**-***6', waiting: true },
  ];
  const who = (r: Parameters<typeof matchGuardPayRow>[0]) => {
    const m = matchGuardPayRow(r, people);
    return 'person' in m ? m.person.personId : m.error;
  };
  it('by staff number (leading zeros and case do not matter), IC on the shown digits, or name', () => {
    expect(who({ row: 2, staffNo: '123' })).toBe('p1');
    expect(who({ row: 2, staffNo: 'g0002' })).toBe('p2');
    expect(idFitsMasked('900101-01-1234', '900101-**-***4')).toBe(true);
    expect(idFitsMasked('900101-01-1235', '900101-**-***4')).toBe(false);
    expect(who({ row: 2, ic: '900101011234' })).toBe('p1');
    expect(who({ row: 2, name: 'SITI BINTI OMAR' })).toBe('p2');
    expect(who({ row: 2, name: 'Siti Omar' })).toBe('p2');
    expect(who({ row: 2, name: 'Muthu Raju' })).toBe('p3');
  });
  it('never pays the wrong person: a name that does not fit the number, unknown, ambiguous or waiting guards are problems', () => {
    expect(who({ row: 2, staffNo: 'G0002', name: 'Ali bin Abu' })).toMatch(/Siti binti Omar in Prima, not "Ali bin Abu"/);
    expect(who({ row: 2, staffNo: 'X999' })).toMatch(/No guard or officer in this run has staff number X999/);
    expect(who({ row: 2, ic: '880303031236' })).toMatch(/more than one guard/);
    expect(who({ row: 2, ic: '880303031236', name: 'Muthu a/l Raju' })).toBe('p3');
    expect(who({ row: 2, staffNo: 'G0004' })).toMatch(/absence waits/);
    expect(who({ row: 2, name: 'Nobody Here' })).toMatch(/No guard or officer in this run is called/);
    expect(who({ row: 2 })).toMatch(/No staff number, IC or name/);
  });
  it('turns a row into one-off items; the same import again replaces its own items only', () => {
    const a = guardPayImportItems({ row: 2, allowance: 150, otherPay: 50, deduction: 20, note: 'Uniform no. 4', uniformNo: 4 });
    expect(a.errors).toEqual([]);
    expect(a.items).toEqual([
      { label: 'Allowance: Uniform no. 4', amount: 150 },
      { label: 'Other pay: Uniform no. 4', amount: 50 },
      { label: 'Deduction: Uniform no. 4', amount: -20, uniformNo: 4 },
    ]);
    expect(guardPayImportItems({ row: 2, allowance: 150 }).items).toEqual([{ label: 'Allowance (imported)', amount: 150 }]);
    expect(guardPayImportItems({ row: 2, deduction: 20 }).errors.join(' ')).toMatch(/reason for the deduction/);
    expect(guardPayImportItems({ row: 2, allowance: -5 }).errors.join(' ')).toMatch(/Deduction column/);
    const kept = [{ label: 'Night shift top-up', amount: 30 }, { label: 'Allowance (imported)', amount: 100 }];
    expect(mergeGuardPayExtras(kept, [{ label: 'Allowance (imported)', amount: 150 }])).toEqual([
      { label: 'Night shift top-up', amount: 30 },
      { label: 'Allowance (imported)', amount: 150 },
    ]);
  });
  it('compares days, hours, advance and pay with what Prima worked out, and says where to fix them', () => {
    const line = { daysWorked: 24, otHours: 48, restDaysWorked: 0, holidaysWorked: 1, advance: 0, gross: 2000, net: 1800 } as GuardPayLine;
    const notes = guardPayImportDiffs({ daysWorked: 26, otHours: 48, advance: 200, net: 1800 }, line);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatch(/Days worked: file 26, Prima 24\. Correct the attendance or leave record/);
    expect(notes[1]).toMatch(/Advance \(RM\): file RM200\.00, Prima RM0\.00\. Advances come only from the Advances screen/);
  });
});

describe('guard pay import: the server write', () => {
  const setup = async () => {
    const { svc } = fresh();
    const prep = await guardPayPrep(svc);
    const run = await svc.prepareGuardPay(prep, 'co-arsh', '2026-10', []);
    return { svc, prep, run, store: (svc as unknown as { store: MemoryStore }).store };
  };

  it('the named preparer checks then saves through the line rules, all or none, with an audit entry per line', async () => {
    const { svc, prep, run, store } = await setup();
    const [a, b] = run.lines;
    const rows = [
      { row: 2, staffNo: a.staffNo, allowance: 120, note: 'Night shift', compare: { daysWorked: a.daysWorked + 2 } },
      { row: 3, name: b.name, pcb: 15.5 },
    ];
    const check = await svc.importGuardPayLines(prep, run.id, { rows, dryRun: true, source: 'gaji-okt.xlsx' });
    expect(check.counts).toMatchObject({ rows: 2, change: 2, problem: 0 });
    expect(check.rows[0].items).toEqual([{ label: 'Allowance: Night shift', amount: 120 }]);
    expect(check.rows[0].after!.gross - check.rows[0].before!.gross).toBeCloseTo(120, 2);
    expect(check.rows[0].notes.join(' ')).toMatch(/Days worked: file/);
    // A check keeps nothing.
    expect((await store.get('guardPayRuns', run.id))!.lines.find((l) => l.personId === a.personId)!.items.some((x) => x.kind === 'extra')).toBe(false);
    await expect(svc.importGuardPayLines(prep, run.id, { rows, source: 'gaji-okt.xlsx' })).rejects.toThrow(/reason/);
    const auditsBefore = (await store.list('audit', {})).length;
    const saved = await svc.importGuardPayLines(prep, run.id, { rows, note: 'October allowances from the site office sheet', source: 'gaji-okt.xlsx' });
    expect(saved.saved).toBe(2);
    const after = (await store.get('guardPayRuns', run.id))!;
    const la = after.lines.find((l) => l.personId === a.personId)!;
    expect(la.items.filter((x) => x.kind === 'extra').map((x) => [x.label, x.amount])).toEqual([['Allowance: Night shift', 120]]);
    expect(la.flags.join(' ')).toMatch(/COO checks/);
    const lb = after.lines.find((l) => l.personId === b.personId)!;
    expect(lb.pcb).toBe(15.5);
    expect(lb.pcbSource).toBe('entered');
    const audits = (await store.list('audit', {})).slice(auditsBefore);
    expect(audits.filter((x) => x.action === 'guardpay.line')).toHaveLength(2);
    expect(audits.find((x) => x.action === 'guardpay.import')!.summary).toMatch(/2 line\(s\) changed from gaji-okt\.xlsx.*Reason: October allowances/);
    // The same file again changes nothing (its items are replaced, not added twice).
    const again = await svc.importGuardPayLines(prep, run.id, { rows, dryRun: true });
    expect(again.counts).toMatchObject({ change: 0, same: 2 });
    await expect(svc.importGuardPayLines(prep, run.id, { rows, note: 'Same file again by mistake' })).rejects.toThrow(/Nothing to change/);
  });

  it('a row breaking a line rule (a loan taken as a deduction, an unknown guard) stops the whole import', async () => {
    const { svc, prep, run, store } = await setup();
    const [a, b] = run.lines;
    const rows = [
      { row: 2, staffNo: a.staffNo, allowance: 80, note: 'Festive' },
      { row: 3, staffNo: b.staffNo, deduction: 50, note: 'Pinjaman koperasi' },
      { row: 4, staffNo: 'NO-SUCH-GUARD', allowance: 10 },
    ];
    const check = await svc.importGuardPayLines(prep, run.id, { rows, dryRun: true });
    expect(check.rows.map((r) => r.status)).toEqual(['change', 'problem', 'problem']);
    expect(check.rows[1].errors.join(' ')).toMatch(/approved record/);
    await expect(svc.importGuardPayLines(prep, run.id, { rows, note: 'October sheet from the site office' })).rejects.toThrow(/2 row\(s\) have a problem/);
    const line = (await store.get('guardPayRuns', run.id))!.lines.find((l) => l.personId === a.personId)!;
    expect(line.items.some((x) => x.kind === 'extra')).toBe(false);
  });

  it('keeps everyone but the named preparer out, on the direct call too, and only a draft changes', async () => {
    const { svc, prep, run, store } = await setup();
    const rows = [{ row: 2, staffNo: run.lines[0].staffNo, allowance: 50, note: 'Test' }];
    const body = { rows, note: 'Synthetic test import of one row' };
    for (const id of ['u-coo', 'u-cm-arsh', 'u-pwvsb-hr', 'u-fin-t1-lead']) {
      const u = await svc.user(id);
      await expect(svc.importGuardPayLines(u, run.id, body)).rejects.toBeInstanceOf(AccessDenied);
      await expect(svc.importGuardPayLines(u, run.id, { ...body, dryRun: true })).rejects.toBeInstanceOf(AccessDenied);
    }
    for (const id of ['u-guard-sasa-1', 'u-cm-sasa']) await expect(svc.importGuardPayLines(await svc.user(id), run.id, body)).rejects.toThrow();
    expect((await store.get('guardPayRuns', run.id))!.lines.every((l) => !l.items.some((x) => x.kind === 'extra'))).toBe(true);
    for (const l of run.lines.filter((x) => !x.bank)) await store.update('people', l.personId, { bank: { bank: 'Test Bank', accountMasked: '****9999' } });
    await svc.prepareGuardPay(prep, 'co-arsh', '2026-10');
    await svc.guardPayStep(prep, run.id, 'submit');
    await expect(svc.importGuardPayLines(prep, run.id, body)).rejects.toThrow(/Only a draft/);
  });
});
