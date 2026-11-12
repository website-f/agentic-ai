import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, RULES, finCash13Items, generateDataset, myt } from '../src';

// P100 F11 (Fauzan, 11 Nov 2026): office staff are paid on the 29th of the same month; guards stay on the 7th.
describe('P100 F11: staff payroll approved and paid by the 29th of the same month', () => {
  it('the rules: staff on the 29th with the earlier steps, guards on the 7th, the cash forecast on the 29th', () => {
    expect(RULES.staffPayroll.value.payByDay).toBe(29);
    expect(RULES.staffPayroll.value.steps).toEqual({ submitBy: 22, cosBy: 24, cooBy: 26 });
    expect(RULES.guardPayroll.value.payByDay).toBe(7);
    expect(RULES.financeForecast13.value.payDay).toBe(29);
    expect(RULES.financeForecast13.label).toBe('Policy');
    expect(RULES.staffPayroll.source).toMatch(/Approved by Fauzan, 11 Nov 2026 \(F11\)/);
  });

  it("this month's run is due on the 29th, each step shows its date, and late after the 29th", async () => {
    const TODAY = '2026-11-27';
    const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:00') });
    ds.staffPayRuns = [];
    let now = myt(TODAY, '10:00');
    const svc = new PrimaService(new MemoryStore(ds), () => now);
    const hr = await svc.user('u-pwvsb-hr');
    const board = await svc.staffPayroll(hr);
    expect(board.rule.dueThisMonth).toBe('2026-11-29');
    const run = await svc.prepareStaffPay(hr, board.employers[0].companyId, '2026-11');
    const row = (await svc.staffPayroll(hr)).runs.find((r) => r.id === run.id)!;
    expect(row.dueBy).toBe('2026-11-22');
    expect(row.stepLate).toBe(true);
    expect(row.late).toBe(false);
    now = myt('2026-11-30', '10:00');
    const after = (await svc.staffPayroll(hr)).runs.find((r) => r.id === run.id)!;
    expect(after.late).toBe(true);
    // A guard never sees the staff payroll board.
    await expect(svc.staffPayroll(await svc.user('u-guard-sasa-1'))).rejects.toThrow(/Not allowed/);
  });

  it("the 13-week forecast puts the month's staff payroll on the 29th of the same month", () => {
    const ds = generateDataset({ today: '2026-11-05', now: myt('2026-11-05', '10:00') });
    const f = ds.finStatus[0];
    const runs = ds.staffPayRuns.filter((r) => r.companyId === f.companyId);
    const items = finCash13Items(f, runs, '2026-11-05').out.filter((x) => x.source === 'payroll');
    for (const x of items) expect(x.on.slice(8, 10) === '29' || x.overdue).toBe(true);
    expect(items.some((x) => x.label.includes('2026-11') && x.on === '2026-11-29')).toBe(true);
  });
});
