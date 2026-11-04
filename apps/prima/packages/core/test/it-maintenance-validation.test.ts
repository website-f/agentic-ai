import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt } from '../src';
const fresh = async () => {
  const now = myt('2026-10-31', '10:00');
  const ds = generateDataset({ today: '2026-10-31', now });
  const svc = new PrimaService(new MemoryStore(ds), () => now);
  const user = await svc.user('u-it-mgr');
  const asset = ds.itAssets.find(a => a.status !== 'disposed')!;
  return { ds, svc, user, asset };
};
describe('maintenance input integrity (synthetic pilot)', () => {
  it('rejects invalid kind and malformed costs without asset or audit changes', async () => {
    const { ds, svc, user, asset } = await fresh();
    const before = JSON.stringify(asset), auditCount = ds.audit.length;
    await expect(svc.itMaintenance(user, asset.id, 'unexpected_kind' as never, 'Synthetic note', 0)).rejects.toThrow(/service or repair/);
    for (const value of [NaN, Infinity, -Infinity, -1, null, undefined, '10', true, Number.MAX_SAFE_INTEGER])
      await expect(svc.itMaintenance(user, asset.id, 'repair', 'Synthetic note', value as number)).rejects.toThrow(/finite nonnegative/);
    expect(JSON.stringify(asset)).toBe(before);
    expect(ds.audit.length).toBe(auditCount);
  });
  it('preserves zero-cost work and rounding without imposing a purchase approval ceiling', async () => {
    const { svc, user, asset } = await fresh();
    await svc.itMaintenance(user, asset.id, 'service', 'Synthetic free service', 0);
    const result = await svc.itMaintenance(user, asset.id, 'repair', 'Synthetic cost rounding', 1_000_001.239);
    expect(result.maintenance!.slice(-2).map(x => x.cost)).toEqual([0, 1_000_001.24]);
  });
  it('preserves authorization and disposed-asset refusal', async () => {
    const { ds, svc, asset } = await fresh();
    const before = JSON.stringify(asset), audits = ds.audit.length;
    await expect(svc.itMaintenance(await svc.user('u-fd'), asset.id, 'repair', 'Synthetic note', 1)).rejects.toThrow();
    expect(JSON.stringify(asset)).toBe(before); expect(ds.audit.length).toBe(audits);
    asset.status = 'disposed';
    await expect(svc.itMaintenance(await svc.user('u-it-mgr'), asset.id, 'repair', 'Synthetic note', 1)).rejects.toThrow(/disposed/);
    expect(ds.audit.length).toBe(audits);
  });
});
