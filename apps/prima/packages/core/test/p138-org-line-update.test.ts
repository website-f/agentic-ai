import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt } from '../src';
import type { User } from '../src';

const NOW = myt('2026-11-26', '12:47');
describe('repro: CEO puts a person (who has someone under) under the Chief of Staff', () => {
  it('saves', async () => {
    const ds = generateDataset({ today: '2026-11-26', now: NOW });
    const base = ds.users.find((u) => u.id === 'u-it-ex1')!;
    const mk = (id: string, name: string, extra: Partial<User> = {}): User => ({ ...base, id, name, title: 'Staff', department: undefined, itRole: undefined, headOf: undefined, deputyOf: undefined, reportsToId: undefined, personId: undefined, ...extra } as User);
    ds.users.push(mk('u-off-a1', 'Nur A'), mk('u-off-a2', 'Nur A'), mk('u-off-cos', 'Zee', { leadership: 'cos', department: 'hr', title: 'Chief of Staff' }));
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    const ceo = await svc.user('u-fauzan');
    await svc.org.setLine(ceo, { userId: 'u-off-a1', managerId: 'u-fauzan', reason: 'top' });
    await svc.org.setLine(ceo, { userId: 'u-off-a2', managerId: 'u-off-a1', reason: 'under a1' });
    await svc.org.setLine(ceo, { userId: 'u-off-cos', managerId: 'u-fauzan', reason: 'cos to ceo' });
    const r = await svc.org.setLine(ceo, { userId: 'u-off-a1', managerId: 'u-off-cos', reason: 'test' });
    expect(r.managerId).toBe('u-off-cos');
  });
});

describe('P138: changing an existing line or head never sends the row id (the PostgreSQL store refuses it)', () => {
  it('updates with the fields only', async () => {
    const ds = generateDataset({ today: '2026-11-26', now: NOW });
    const store = new MemoryStore(ds);
    const real = store.transaction.bind(store);
    // Make the memory store as strict as the PostgreSQL one about id in an update.
    (store as unknown as { transaction: typeof real }).transaction = (fn) =>
      real(async (tx) => {
        const update = tx.update.bind(tx);
        tx.update = (async (table: string, id: string, patch: Record<string, unknown>) => {
          if ('id' in patch) throw new Error('id and companyId cannot be changed');
          return update(table as never, id, patch as never);
        }) as typeof tx.update;
        return fn(tx);
      });
    const svc = new PrimaService(store, () => NOW);
    const ceo = await svc.user('u-fauzan');
    await svc.org.setLine(ceo, { userId: 'u-it-ex1', managerId: 'u-it-mgr', reason: 'first' });
    const r = await svc.org.setLine(ceo, { userId: 'u-it-ex1', managerId: 'u-it-lead', reason: 'changed' });
    expect(r.managerId).toBe('u-it-lead');
  });
});
