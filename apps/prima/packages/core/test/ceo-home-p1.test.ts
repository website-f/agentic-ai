import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt } from '../src';

// Fauzan, 3 Nov 2026 (G6): the CEO's Do today holds only cases that have reached the CEO's own step; open P1 cases still
// being worked by operations are one Monitor line. The line was built but dropped from the home when #130 merged the
// low-margin watch, so P1 cases below the CEO showed nowhere on the CEO home. Synthetic data only.

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');

describe('CEO home: open P1 cases below the CEO', () => {
  it('appear as one Monitor line, not in Do today', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const store = new MemoryStore(ds);
    const svc = new PrimaService(store, () => NOW);
    const ceo = await svc.user('u-fauzan');
    const openP1 = ds.cases.filter((c) => c.severity === 'P1' && c.status !== 'closed' && c.status !== 'resolved');
    expect(openP1.length).toBeGreaterThan(0);
    const home = await svc.home(ceo);
    const p1 = home.watch.filter((w) => w.tag === 'P1 cases');
    expect(p1).toHaveLength(1);
    const n = Number(/^(\d+) open P1 case/.exec(p1[0].title)?.[1]);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(openP1.length);
    expect(p1[0].go).toEqual({ view: 'cases' });
    expect(home.todo.some((t) => t.tag === 'P1 cases')).toBe(false);
  });
});
