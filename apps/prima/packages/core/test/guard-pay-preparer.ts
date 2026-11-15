// B1 (Fauzan, 11 Nov 2026): each Company Manager names who prepares the company's guard pay run. Tests that prepare a
// run add one synthetic company executive in the companies they need and have each Company Manager name them.
import type { Attendance, PrimaService, Shift, User } from '../src';

export const PREP_ID = 'u-test-gp-prep';

// B1b: the synthetic attendance has late arrivals and early leaves; a test about something else first puts each
// locked shift on its shift times (the same as the company excusing it), so hours recorded match hours paid.
export async function guardPayPrep(svc: PrimaService, companyIds: string[] = ['co-sasa', 'co-arsh', 'co-inas'], alignAttendance = true): Promise<User> {
  type S = {
    get(t: 'users', id: string): Promise<User | null>;
    insert(t: 'users', row: User): Promise<unknown>;
    list(t: 'users'): Promise<User[]>;
    list(t: 'attendance', w: { companyId: string }): Promise<Attendance[]>;
    list(t: 'shifts', w: { companyId: string }): Promise<Shift[]>;
    update(t: 'attendance', id: string, patch: Partial<Attendance>): Promise<unknown>;
  };
  const store = (svc as unknown as { store: S }).store;
  if (alignAttendance)
    for (const co of companyIds) {
      const shifts = new Map((await store.list('shifts', { companyId: co })).map((s) => [s.id, s]));
      const atts = await store.list('attendance', { companyId: co });
      const len = (sh: Shift) => Date.parse(sh.end) - Date.parse(sh.start);
      // A guard who works shifts of different lengths in a month is paid on one formula, so the hours would not match:
      // give the odd shifts the guard's usual length.
      const usual = new Map<string, number>();
      for (const pid of new Set(atts.map((a) => a.personId))) {
        const counts = new Map<number, number>();
        for (const a of atts) if (a.personId === pid && a.shiftId && shifts.get(a.shiftId)) counts.set(len(shifts.get(a.shiftId)!), (counts.get(len(shifts.get(a.shiftId)!)) ?? 0) + 1);
        const top = [...counts.entries()].sort((x, y) => y[1] - x[1])[0];
        if (top) usual.set(pid, top[0]);
      }
      for (const a of atts) {
        const sh = a.shiftId ? shifts.get(a.shiftId) : undefined;
        if (!sh || !a.clockIn || !a.clockOut) continue;
        const want = usual.get(a.personId) ?? len(sh);
        if (len(sh) !== want) {
          await store.update('attendance', a.id, { shiftId: null, clockIn: sh.start, clockOut: new Date(Date.parse(sh.start) + want).toISOString() });
          continue;
        }
        if (a.clockIn !== sh.start || a.clockOut !== sh.end) await store.update('attendance', a.id, { clockIn: sh.start, clockOut: sh.end });
      }
    }
  if (!(await store.get('users', PREP_ID)))
    await store.insert('users', { id: PREP_ID, name: 'Synthetic Pay Preparer', title: 'Admin Executive (synthetic test)', role: 'admin_exec', companyIds, siteIds: [] } as User);
  const users = await store.list('users');
  for (const co of companyIds) {
    const cm = users.find((u) => u.role === 'company_manager' && u.companyIds.includes(co) && !u.integration);
    if (!cm) throw new Error(`no company manager in ${co}`);
    await svc.setGuardPayPreparers(cm, co, { userIds: [PREP_ID], reason: 'Synthetic test: names the pay preparer.' });
  }
  return (await svc.user(PREP_ID))!;
}
