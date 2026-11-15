// Review of PR #141, batch 2 (B2): employer recoveries on staff pay (stay damage, company item damage or loss) never take
// more than half of gross pay; EPF, SOCSO, EIS, PCB and zakat are outside that limit (Fauzan, 11 Nov 2026 round 3 Q3).
// What is left carries to the next month. Made-up people and amounts only, in memory.
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.restoreAllMocks());
import { MemoryStore, PrimaService, ShortStayService, buildStaffPayLine, generateDataset, type Person } from '../src';

const TODAY = '2026-11-03';
const NOW = '2026-11-03T02:00:00.000Z';

describe('staff pay recoveries: half-of-gross limit (B2)', () => {
  const person = (): Person => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const p = ds.people.find((x) => x.role === 'office' && (x.basicPay ?? 0) > 0)!;
    return { ...p, basicPay: 3000, allowances: [], hiredOn: '2020-01-01', leaving: null } as Person;
  };
  const line = (recoveries: { id: string; label: string; amount: number }[]) =>
    buildStaffPayLine({ person: person(), period: '2026-11', unpaidDivisor: 26, leaves: [], claims: [], recoveries, kept: { extra: [], pcb: 0 } });

  it('takes recoveries in order up to half of gross and carries the rest', () => {
    const l = line([
      { id: 'r-a', label: 'Damage A (test)', amount: 1000 },
      { id: 'r-b', label: 'Damage B (test)', amount: 2000 },
      { id: 'r-c', label: 'Damage C (test)', amount: 50 },
    ]);
    expect(l.gross).toBe(3000);
    expect(l.recoveries).toBe(1500);
    expect(l.recoveryIds).toEqual(['r-a']);
    expect(l.recoveryParts).toEqual([
      { id: 'r-a', amount: 1000 },
      { id: 'r-b', amount: 500 },
    ]);
    expect(l.flags.join(' ')).toMatch(/RM500\.00 of RM2000\.00 deducted .*RM1500\.00 carries to the next month/);
    expect(l.flags.join(' ')).toMatch(/Damage C \(test\): RM0\.00 of RM50\.00/);
  });

  it('statutory deductions do not use up the limit', () => {
    const l = line([{ id: 'r-a', label: 'Damage A (test)', amount: 1500 }]);
    expect(l.recoveries).toBe(1500);
    expect(l.recoveryIds).toEqual(['r-a']);
    // Net = gross less statutory less the full half of gross.
    expect(l.deductions).toBeGreaterThan(1500);
  });

  it('the next month takes only what is left of a part-taken recovery', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    // Start with no earlier staff runs in the made-up data, so October and November are both prepared here.
    ds.staffPayRuns.splice(0, ds.staffPayRuns.length);
    const store = new MemoryStore(ds);
    let t = Date.parse(NOW);
    const svc = new PrimaService(store, () => new Date((t += 1000)).toISOString());
    const hr = ds.users.find((u) => u.id === 'u-pwvsb-hr')!;
    const staff = ds.users.find((x) => x.department === 'it' && x.personId && x.itRole !== 'manager' && x.itRole !== 'lead')!;
    const p = ds.people.find((x) => x.id === staff.personId)!;
    for (const x of ds.people) if (x.companyId === p.companyId && x.role === 'office' && !x.bank) x.bank = { bank: 'Test Bank', accountMasked: '****0000' } as never;
    const big = Math.round(((p.basicPay ?? 0) + 1000) * 100) / 100;
    // The service builds a short-stay helper on each call, so the made-up recovery is put on its prototype.
    vi.spyOn(ShortStayService.prototype, 'recoveriesDue').mockImplementation(async (pid: string) => (pid === p.id ? [{ id: 'ssr-test-1', bookingId: 'BK-TEST', amount: big } as never] : []));
    const oct = await svc.prepareStaffPay(hr, p.companyId, '2026-10');
    const l1 = oct.lines.find((l) => l.personId === p.id)!;
    expect(l1.recoveryIds ?? []).toEqual([]);
    const taken = l1.recoveryParts![0].amount;
    expect(taken).toBeLessThanOrEqual(l1.gross / 2);
    const nov = await svc.prepareStaffPay(hr, p.companyId, '2026-11');
    const l2 = nov.lines.find((l) => l.personId === p.id)!;
    const second = l2.recoveryParts![0].amount;
    expect(Math.round((taken + second) * 100) / 100).toBeLessThanOrEqual(big);
    expect(second).toBe(Math.min(Math.round((big - taken) * 100) / 100, Math.floor(l2.gross * 50) / 100));
  });
});
