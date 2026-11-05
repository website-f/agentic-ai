// Guard screens read only the guard's own rows (review, 3 Nov 2026: ready for 8,000+ guards). Synthetic data only.
import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt } from '../src';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');

describe('guard screens at scale', () => {
  it("gives one person's attendance issues exactly as the whole-company list does", async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    const issues = (svc as unknown as { attendanceIssues: (c: string[], f: string, t: string, p?: string) => Promise<{ personId: string | null; key: string }[]> }).attendanceIssues.bind(svc);
    const all = await issues(['co-sasa'], '2026-09-26', TODAY);
    const people = [...new Set(all.map((i) => i.personId).filter((p): p is string => !!p))].slice(0, 12);
    expect(people.length).toBeGreaterThan(3);
    for (const p of people) expect(await issues(['co-sasa'], '2026-09-26', TODAY, p)).toEqual(all.filter((i) => i.personId === p));
  });

  it("does not read the whole company's people or attendance for one guard's Duty screen", async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const store = new MemoryStore(ds);
    const wide: string[] = [];
    const list = store.list.bind(store);
    store.list = (async (t: never, f?: Record<string, unknown>, r?: never) => {
      if ((t === 'people' || t === 'attendance' || t === 'shifts' || t === 'posts') && f && 'companyId' in f && !('personId' in f)) wide.push(t);
      if (t === 'users' && (!f || Object.keys(f).length === 0)) wide.push('users');
      return list(t, f as never, r);
    }) as typeof store.list;
    const svc = new PrimaService(store, () => NOW);
    const duty = await svc.myDuty(await svc.user('u-guard-sasa-1'));
    expect(duty).toBeDefined();
    expect(wide).toEqual([]);
  });
});
