// Read memo for read-only screens (review G2, 3 Nov 2026). Synthetic data only.
import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt, readMemo } from '../src';

const TODAY = '2026-11-03';
const NOW = myt(TODAY, '10:30');

describe('read memo', () => {
  it('reads a list once, gives each caller its own array, and forgets everything after any write', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const base = new MemoryStore(ds);
    let reads = 0;
    const list = base.list.bind(base);
    base.list = (async (t: never, f: never) => {
      reads++;
      return list(t, f);
    }) as typeof base.list;
    const m = readMemo(base);
    const a = await m.list('sites', { companyId: 'co-sasa' });
    const b = await m.list('sites', { companyId: 'co-sasa' });
    expect(reads).toBe(1);
    expect(a).not.toBe(b);
    a.reverse();
    expect(b[0]).toBe((await m.list('sites', { companyId: 'co-sasa' }))[0]);
    await m.list('cases', {});
    await m.list('cases', {});
    expect(reads).toBe(3); // cases is not memoised
    await m.update('sites', b[0].id, { name: 'Renamed (synthetic)' });
    const c = await m.list('sites', { companyId: 'co-sasa' });
    expect(reads).toBe(4);
    expect(c.find((s) => s.id === b[0].id)!.name).toBe('Renamed (synthetic)');
  });

  it('the home gives the same answer with the memo, and the service store is restored after', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    const before = (svc as unknown as { store: unknown }).store;
    const [x, y] = await Promise.all([svc.home(await svc.user('u-coo')), svc.home(await svc.user('u-fauzan'))]);
    expect((svc as unknown as { store: unknown }).store).toBe(before);
    expect(JSON.stringify(await svc.home(await svc.user('u-coo')))).toBe(JSON.stringify(x));
    expect(y.title).toBe('Executive view');
  });
});
