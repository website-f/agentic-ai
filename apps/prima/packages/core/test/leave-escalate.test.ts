import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, RULES, addWorkingMs, generateDataset, leaveEscalationStep, myt, workingMsBetween } from '../src';

// P100 C3 (Fauzan, 11 Nov 2026): guard leave moves up one level per working day; weekends and public holidays do not count.
const DAY = 86_400_000;
const none = new Set<string>();

describe('P100 C3: one working day per level', () => {
  it('the rule says 1 working day for guards and keeps 12 hours for office staff', () => {
    expect(RULES.leaveEscalate.value.guardWorkingDays).toBe(1);
    expect(RULES.leaveEscalate.value.officeHours).toBe(12);
    expect(RULES.leaveEscalate.source).toMatch(/Approved by Fauzan, 11 Nov 2026/);
  });

  it('a request on Friday 15:00 moves up on Monday 15:00, not over the weekend', () => {
    // 13 Nov 2026 is a Friday.
    const fri = myt('2026-11-13', '15:00');
    expect(leaveEscalationStep(fri, myt('2026-11-14', '15:00'), 5, 1, none).step).toBe(0);
    expect(leaveEscalationStep(fri, myt('2026-11-16', '14:59'), 5, 1, none).step).toBe(0);
    expect(leaveEscalationStep(fri, myt('2026-11-16', '15:00'), 5, 1, none).step).toBe(1);
    expect(leaveEscalationStep(fri, myt('2026-11-13', '16:00'), 5, 1, none).nextAt).toBe(myt('2026-11-16', '15:00'));
  });

  it('a public holiday does not count either', () => {
    const mon = myt('2026-11-16', '10:00');
    const holiday = new Set(['2026-11-17']);
    expect(workingMsBetween(mon, myt('2026-11-18', '10:00'), holiday)).toBe(DAY);
    expect(leaveEscalationStep(mon, myt('2026-11-17', '23:00'), 5, 1, holiday).step).toBe(0);
    expect(addWorkingMs(mon, DAY, holiday)).toBe(myt('2026-11-18', '10:00'));
    // Four working days to the top (CEO) and no further.
    expect(leaveEscalationStep(mon, myt('2026-12-31', '10:00'), 5, 1, holiday)).toEqual({ step: 4, nextAt: null });
  });

  it("a guard's request on the leave list shows the next move a working day later", async () => {
    const TODAY = '2026-11-13';
    const NOW = myt(TODAY, '15:00');
    const ds = generateDataset({ today: TODAY, now: NOW });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    const ceo = await svc.user('u-fauzan');
    // A guard on the usual ladder (not a JV branch, whose Branch Manager decides).
    for (const guard of ds.people.filter((p) => p.role === 'guard' && p.status === 'active').slice(0, 40)) {
      const id = `lv-c3-${guard.id}`;
      ds.leaveRequests.push({ id, companyId: guard.companyId, personId: guard.id, kind: 'ANNUAL', from: '2026-11-25', to: '2026-11-25', days: 1, reason: 'Family (test)', proofIds: [], requestedAt: NOW, requestedBy: guard.name, via: 'company', status: 'pending', decidedBy: null, decidedAt: null, decisionNote: null } as never);
      const row = (await svc.leaveRequests(ceo, {})).rows.find((r) => r.request.id === id);
      if (row?.waitingWith?.level !== 'OM') continue;
      expect(row.waitingWith.nextAt).toBe(myt('2026-11-16', '15:00'));
      return;
    }
    throw new Error('no guard on the usual ladder in the sample data');
  });
});
