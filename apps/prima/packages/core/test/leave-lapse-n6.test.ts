// Part N6 (Fauzan, 13 Nov 2026): no carry-forward; staff see their annual leave left in November and December.
import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, RULES, generateDataset, myt } from '../src';

function at(today: string) {
  const ds = generateDataset({ today, now: myt(today, '09:00') });
  const svc = new PrimaService(new MemoryStore(ds), () => myt(today, '09:00'));
  const u = ds.users.find((x) => x.personId && ds.people.find((p) => p.id === x.personId && p.role === 'office' && p.status === 'active') && x.role === 'pwvsb_officer' && x.opsTier !== 'ceo')!;
  return { svc, u };
}

describe('N6 leave lapses on 31 December', () => {
  it('no carry-forward by rule; a reminder in November, none in October', async () => {
    expect(RULES.leaveYearEnd.value.carryForwardDays).toBe(0);
    const nov = at('2026-11-14');
    const b = (await nov.svc.guardProfile(nov.u, nov.u.personId!)).leave.balances;
    expect(b.lapse).toMatchObject({ on: '2026-12-31', carryForward: 0 });
    // A company manager's Home carries the reminder too.
    const cm = await nov.svc.user('u-cm-sasa');
    if (cm.personId) expect(JSON.stringify(await nov.svc.home(cm))).toMatch(/lapses on 31 December|annual leave day/);
    const oct = at('2026-10-14');
    expect((await oct.svc.guardProfile(oct.u, oct.u.personId!)).leave.balances.lapse).toBeNull();
  });
});
