import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, guardHolidayDates, holidayListCheck, holidayListDue, holidayPayLost, holidaysInMonth, myt, type User } from '../src';

// Public holidays (Fauzan, 6 Nov 2026). Synthetic data only; the moving dates are placeholders, not the gazette.
const at = (today: string) => {
  const now = myt(today, '10:00');
  const ds = generateDataset({ today: '2026-11-06', now: myt('2026-11-06', '10:00') });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => now) };
};
const user = (ds: ReturnType<typeof generateDataset>, id: string) => ds.users.find((u) => u.id === id) as User;
const list = (y: number): { date: string; label: string }[] =>
  [
    ['01-01', "New Year's Day"],
    ['02-01', 'Federal Territory Day'],
    ['02-06', 'Chinese New Year (test)'],
    ['02-07', 'Chinese New Year 2 (test)'],
    ['03-10', 'Hari Raya Aidilfitri (test)'],
    ['03-11', 'Hari Raya Aidilfitri 2 (test)'],
    ['05-01', 'Labour Day'],
    ['06-07', "Agong's birthday (test)"],
    ['08-31', 'National Day'],
    ['09-16', 'Malaysia Day'],
    ['12-25', 'Christmas Day'],
  ].map(([md, label]) => ({ date: `${y}-${md}`, label }));

describe('public holidays (rule PAY-PUBLIC-HOLIDAYS)', () => {
  it('needs 11 dated, named days in the year; missing compulsory days are flags, not refusals', () => {
    expect(holidayListCheck(2027, list(2027))).toEqual({ refuse: null, flags: [] });
    expect(holidayListCheck(2027, list(2027).slice(0, 10)).refuse).toMatch(/exactly 11/);
    expect(holidayListCheck(2027, list(2026)).refuse).toMatch(/not in 2027/);
    const dup = list(2027);
    dup[2] = { ...dup[1] };
    expect(holidayListCheck(2027, dup).refuse).toMatch(/twice/);
    const noMalaysiaDay = list(2027).map((d) => (d.date.endsWith('09-16') ? { date: '2027-09-17', label: 'Other' } : d));
    const c = holidayListCheck(2027, noMalaysiaDay);
    expect(c.refuse).toBeNull();
    expect(c.flags.join(' ')).toMatch(/Malaysia Day/);
  });

  it('due by 10 December, reminded from 1 December', () => {
    expect(holidayListDue(2027, '2026-11-30')).toMatchObject({ remind: false, late: false, dueOn: '2026-12-10' });
    expect(holidayListDue(2027, '2026-12-01')).toMatchObject({ remind: true, late: false });
    expect(holidayListDue(2027, '2026-12-11')).toMatchObject({ remind: true, late: true });
  });

  it('a holiday on a rest day moves to the next working day; absence next to a holiday loses its pay', () => {
    const moved = guardHolidayDates(['2027-08-31', '2027-09-16'], new Set(['2027-08-31', '2027-09-01']));
    expect(moved).toEqual([
      { date: '2027-09-02', movedFrom: '2027-08-31' },
      { date: '2027-09-16', movedFrom: null },
    ]);
    const work = ['2027-08-29', '2027-08-30', '2027-09-01', '2027-09-02'];
    expect(holidayPayLost('2027-08-31', work, new Set())).toBe(false);
    expect(holidayPayLost('2027-08-31', work, new Set(['2027-08-30']))).toBe(true);
    expect(holidayPayLost('2027-08-31', work, new Set(['2027-09-01']))).toBe(true);
    expect(holidayPayLost('2027-08-31', work, new Set(['2027-08-29']))).toBe(false);
  });

  it('the Operations Director or the OGM sets a list, never the OM; a reason is kept and versions are kept', async () => {
    const { ds, svc } = at('2026-12-02');
    const board = await svc.publicHolidayBoard(user(ds, 'u-ogm'), { companyId: 'co-sasa', year: 2027 });
    expect(board.missing.length).toBeGreaterThan(0);
    expect(board.company.canSet).toBe(true);
    const base = { companyId: 'co-sasa', year: 2027, days: list(2027), reason: 'Gazette 2027 (test)' };
    await expect(svc.setPublicHolidays(user(ds, 'u-coo'), base)).rejects.toThrow(/Not allowed/);
    await expect(svc.setPublicHolidays(user(ds, 'u-om-klang'), base)).rejects.toThrow(/Operations Director or the OGM/);
    await expect(svc.setPublicHolidays(user(ds, 'u-ogm'), { ...base, reason: '' })).rejects.toThrow(/reason/);
    const v1 = await svc.setPublicHolidays(user(ds, 'u-ogm'), base);
    expect(v1).toMatchObject({ version: 1, state: null, setByTier: 'ogm', lawFlags: [] });
    const states = board.states.map((s) => s.state!);
    if (states[0]) {
      await expect(svc.setPublicHolidays(user(ds, 'u-om-klang'), { ...base, state: states[0] })).rejects.toThrow(/Not allowed/);
      const v = await svc.setPublicHolidays(user(ds, 'u-opsdir'), { ...base, state: states[0], reason: 'State list (test)' });
      expect(v).toMatchObject({ state: states[0], setByTier: 'ops_director' });
    }
    const v2 = await svc.setPublicHolidays(user(ds, 'u-ogm'), { ...base, reason: 'Corrected a date (test)' });
    expect(v2.version).toBe(2);
    expect(ds.publicHolidayLists.find((l) => l.id === v1.id)!.replacedBy).toBe(v2.id);
    expect(ds.audit.filter((a) => a.action === 'ops.public_holidays.set').length).toBeGreaterThanOrEqual(2);
    // The pay run reads the month's days: the state list first, else the company list.
    expect(holidaysInMonth(ds.publicHolidayLists, 'co-sasa', '2027-08', 'Nowhere').map((d) => d.date)).toEqual(['2027-08-31']);
    await expect(svc.setPublicHolidays(user(ds, 'u-ogm'), { ...base, year: 2025 })).rejects.toThrow(/past year/);
  });

  it('reminds the OGM from 1 December and flags the CEO after 10 December', async () => {
    // The OGM has no home page: the reminder shows on the operations board.
    const early = at('2026-11-20');
    expect((await early.svc.regionalOps(user(early.ds, 'u-ogm'))).reminders).toEqual([]);
    const dec = at('2026-12-03');
    expect((await dec.svc.regionalOps(user(dec.ds, 'u-ogm'))).reminders[0]?.title).toMatch(/Set the 2027 public holidays by 2026-12-10/);
    expect((await dec.svc.regionalOps(user(dec.ds, 'u-opsdir'))).reminders[0]?.detail).toMatch(/missing/);
    expect((await dec.svc.regionalOps(user(dec.ds, 'u-om-klang'))).reminders).toEqual([]);
    const ceo = dec.ds.users.find((u) => u.opsTier === 'ceo')!;
    const ceoBefore = await dec.svc.home(ceo);
    expect(JSON.stringify(ceoBefore)).not.toMatch(/2027 public holidays not set/);
    const late = at('2026-12-11');
    expect(JSON.stringify(await late.svc.home(ceo))).toMatch(/2027 public holidays not set/);
  });
});
