// Part Z (Fitri package, duty-map gaps Z1-Z13, Fauzan 14 Nov 2026: "Add any that still missing in prima app").
// Made-up data only, in memory. PostgreSQL is tested apart in apps/api/test/duty-registers-pg.test.ts.
import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, REG_KINDS, RULES, generateDataset, myt, type User } from '../src';

function fresh(today = '2026-11-20') {
  const ds = generateDataset({ today, now: myt(today, '10:00') });
  const store = new MemoryStore(ds);
  const clock = { now: myt(today, '10:00') };
  const svc = new PrimaService(store, () => clock.now);
  const reg = async (uid: string, op: string, i: Record<string, unknown> = {}) => svc.registerAct(await svc.user(uid), op, i);
  const gm = async (uid: string, op: string, i: Record<string, unknown> = {}) => svc.groupMonthAct(await svc.user(uid), op, i);
  return { ds, svc, reg, gm, clock };
}
const CO = 'co-sasa';

describe('Part Z duty registers', () => {
  it('Z4/Z5: the company office records, the manager checks with a comment, nobody checks their own, and a checked record is fixed', async () => {
    const { reg } = fresh();
    const f = { kind: 'factoring', companyId: CO, provider: 'Penyedia T (test)', period: '2026-11', requestedOn: '2026-11-05', invoices: 'INV-T-1, INV-T-2', amount: 5000, stampedBeforePpd: 'yes', status: 'requested' };
    await expect(reg('u-pwvsb-hr', 'put', f)).rejects.toBeInstanceOf(AccessDenied);
    await expect(reg('u-ae-sasa', 'put', { ...f, stampedBeforePpd: undefined })).rejects.toThrow(/required/);
    await expect(reg('u-ae-sasa', 'put', { ...f, period: 'Nov' })).rejects.toThrow(/YYYY-MM/);
    const r = (await reg('u-ae-sasa', 'put', f)) as { id: string; status: string };
    expect(r.status).toBe('submitted');
    await expect(reg('u-ae-sasa-2', 'check', { id: r.id, verdict: 'check', comment: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(reg('u-cm-sasa', 'check', { id: r.id, verdict: 'check', comment: '' })).rejects.toThrow(/comment/);
    await reg('u-cm-sasa', 'check', { id: r.id, verdict: 'return', comment: 'Lampirkan invois (test)' });
    await reg('u-ae-sasa', 'put', { ...f, id: r.id, invoices: 'INV-T-1, INV-T-2, INV-T-3' });
    const c = (await reg('u-cm-sasa', 'check', { id: r.id, verdict: 'check', comment: 'Disemak (test)' })) as { status: string; d: { checkedBy: string } };
    expect(c.status).toBe('checked');
    await expect(reg('u-ae-sasa', 'put', { ...f, id: r.id })).rejects.toThrow(/checked/);
    // The manager who keeps a record of their own cannot check it.
    const own = (await reg('u-cm-sasa', 'put', { ...f, period: '2026-10' })) as { id: string };
    await expect(reg('u-cm-sasa', 'check', { id: own.id, verdict: 'check', comment: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    // The board counts it and a periodic register is no longer missing this month.
    const b = (await reg('u-ae-sasa', 'board', { companyId: CO })) as { registers: { kind: string; rows: number; missing: string | null }[] };
    const fac = b.registers.find((x) => x.kind === 'factoring')!;
    expect(fac.rows).toBe(2);
    expect(fac.missing).toBeNull();
    expect(b.registers.find((x) => x.kind === 'principalMeeting')).toBeUndefined();
  });

  it('Z6/Z8: confidential registers, staff number only, no IC or bank numbers', async () => {
    const { reg } = fresh();
    const p = { kind: 'ptptn', companyId: CO, staffNo: 'S-0101', monthly: 100, from: '2026-01-01' };
    await expect(reg('u-ae-sasa', 'put', { ...p, staffNo: 'Ahmad Bin Ali' })).rejects.toThrow(/staff number/);
    await expect(reg('u-ae-sasa', 'put', { ...p, ref: '900101-14-5555' })).rejects.toThrow(/IC/);
    await expect(reg('u-ae-sasa', 'put', { ...p, ref: '1234 5678 9012' })).rejects.toThrow(/bank account/);
    await reg('u-ae-sasa', 'put', p);
    // PTPTN is confidential: the office and HR read it, the Chief of Staff (a group leader) does not.
    expect(((await reg('u-pwvsb-hr', 'list', { kind: 'ptptn', companyId: CO })) as { rows: unknown[] }).rows).toHaveLength(1);
    await expect(reg('u-cos', 'list', { kind: 'ptptn', companyId: CO })).rejects.toBeInstanceOf(AccessDenied);
    // The FWM blacklist: FWM keeps it, Finance does not see it.
    await reg('u-fwm-ex1', 'put', { kind: 'fwBlacklist', workerRef: 'FW-T-9', reportedOn: '2026-11-10' });
    await expect(reg('u-fd', 'put', { kind: 'fwBlacklist', workerRef: 'FW-T-9', reportedOn: '2026-11-10' })).rejects.toBeInstanceOf(AccessDenied);
    expect(((await reg('u-fd', 'list', { kind: 'fwBlacklist' })) as { rows: unknown[] }).rows).toHaveLength(0);
  });

  it('Z7: the welfare fund is checked by the approver the Chief of Staff names, never the HR preparer', async () => {
    const { reg } = fresh();
    const r = (await reg('u-pwvsb-hr', 'put', { kind: 'clubFund', gift: 'wedding', staffNo: 'S-0202', amount: 200 })) as { id: string };
    await expect(reg('u-dcos', 'check', { id: r.id, verdict: 'check', comment: 'ok' })).rejects.toThrow(/not set yet/);
    await expect(reg('u-pwvsb-hr', 'setApprover', { userId: 'u-dcos', reason: 'test' })).rejects.toBeInstanceOf(AccessDenied);
    await reg('u-cos', 'setApprover', { userId: 'u-dcos', reason: 'Pelulus tabung (test)' });
    await expect(reg('u-cos', 'check', { id: r.id, verdict: 'check', comment: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    expect(((await reg('u-dcos', 'check', { id: r.id, verdict: 'check', comment: 'Lulus (test)' })) as { status: string }).status).toBe('checked');
    // Kuliah dhuha has no checker: a record is closed on entry.
    expect(((await reg('u-pwvsb-hr', 'put', { kind: 'kuliahDhuha', heldOn: '2026-11-13', attended: 30 })) as { status: string }).status).toBe('closed');
  });

  it('Z10: the rental month sets paid repairs against the checked repair budget, for Asset Management and group leaders only', async () => {
    const { reg } = fresh();
    await expect(reg('u-ae-sasa', 'rentalMonth', {})).rejects.toBeInstanceOf(AccessDenied);
    const b = (await reg('u-asset-mm', 'put', { kind: 'repairBudget', period: '2026-11', budget: 3000 })) as { id: string };
    await reg('u-asset-dir', 'check', { id: b.id, verdict: 'check', comment: 'Bajet ok (test)' });
    const m = (await reg('u-asset-mm', 'rentalMonth', { month: '2026-11' })) as { repairBudget: number; repairPaid: number; over: boolean; homes: number };
    expect(m.repairBudget).toBe(3000);
    expect(m.over).toBe(m.repairPaid > 3000);
    expect(m.homes).toBeGreaterThanOrEqual(0);
  });

  it('every register kind names its keeper, checker and fields; Z items covered', () => {
    const items = new Set(REG_KINDS.map((k) => k.item));
    for (const z of ['Z4', 'Z5', 'Z6', 'Z7', 'Z8', 'Z9', 'Z10', 'Z11', 'Z12', 'Z13']) expect(items.has(z)).toBe(true);
    for (const k of REG_KINDS) expect(k.fields.length).toBeGreaterThan(0);
  });
});

describe('Part Z1/Z2/Z3 on the duty checklists and licences', () => {
  it('Z1: the named checker reviews a duty task, never the person in charge; the layout shows number, window and status', async () => {
    const { svc, gm } = fresh('2026-12-01');
    const SC = `co:${CO}`;
    await expect(gm('u-cm-sasa', 'dutyAdd', { scope: SC, text: 'Laporan semak (test)', every: 'monthly', fromDay: 1, toDay: 3, picId: 'u-ae-sasa', checkerId: 'u-ae-sasa' })).rejects.toThrow(/self-check/);
    await expect(gm('u-cm-sasa', 'dutyAdd', { scope: SC, text: 'Laporan semak (test)', every: 'monthly', fromDay: 1, toDay: 3, picId: 'u-ae-sasa', checkerId: 'u-ae-sasa-2' })).rejects.toThrow(/manager or director/);
    await gm('u-cm-sasa', 'dutyAdd', { scope: SC, text: 'Laporan semak (test)', every: 'monthly', fromDay: 1, toDay: 3, picId: 'u-ae-sasa', checkerId: 'u-gm-sasa' });
    const ae = await svc.user('u-ae-sasa');
    const w = (await svc.myWork(ae)) as { open: { id: string; title: string }[] };
    const t = w.open.find((x) => x.title === 'Laporan semak (test)')!;
    await svc.workTaskDone(ae, t.id, { note: 'Siap (test)', ref: 'fail (test)' });
    await expect(svc.workTaskReview(ae, t.id, true, 'ok')).rejects.toBeInstanceOf(AccessDenied);
    await svc.workTaskReview(await svc.user('u-gm-sasa'), t.id, true, 'Disemak (test)');
    const d = (await gm('u-cm-sasa', 'duties', { scope: SC })) as { lines: { no: number; text: string; status: string; checkerName: string | null; window: string }[]; calendar: { items: unknown[] } };
    const line = d.lines.find((x) => x.text === 'Laporan semak (test)')!;
    expect(line.no).toBe(1);
    expect(line.status).toBe('disemak');
    expect(line.checkerName).toBeTruthy();
    expect(d.calendar.items.length).toBe(RULES.groupDuties.value.calendar.length);
  });

  it('Z2: Unit HR or the Director Office changes the group calendar with a reason', async () => {
    const { gm } = fresh();
    await expect(gm('u-ae-sasa', 'setCalendar', { items: [{ text: 'Gaji', fromDay: 7, toDay: 7 }], reason: 'test' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(gm('u-pwvsb-hr', 'setCalendar', { items: [{ text: 'Gaji', fromDay: 7, toDay: 7 }] })).rejects.toThrow(/why/);
    await expect(gm('u-pwvsb-hr', 'setCalendar', { items: [{ text: 'Baki', every: 'weekly' }], reason: 'Ubah (test)' })).rejects.toThrow(/weekday/);
    const c = (await gm('u-pwvsb-doa', 'setCalendar', { items: [{ text: 'Gaji', fromDay: 7, toDay: 7 }, { text: 'Baki', every: 'weekly', weekday: 4 }], reason: 'Ubah (test)' })) as { items: { text: string }[]; reason: string };
    expect(c.items.map((x) => x.text)).toEqual(['Gaji', 'Baki']);
    expect(c.reason).toBe('Ubah (test)');
    expect(((await gm('u-ae-sasa', 'calendar')) as { items: unknown[] }).items).toHaveLength(2);
  });

  it('Z3: the new licence types have reminder lead days', () => {
    for (const t of ['PIKM_MEMBERSHIP', 'MOF_DIGITAL_CERT', 'BUMIPUTERA_STATUS', 'BOND', 'CARRY_USE', 'CNU', 'AMRA', 'LHDN_TCC', 'CIDB']) {
      expect((RULES.licenceLeadDays.value as Record<string, number>)[t]).toBeGreaterThan(0);
    }
  });
});
void (null as unknown as User);
