import { describe, expect, it, vi } from 'vitest';
import { ArishaContextService, generateDataset, MemoryStore, type ArishaContextKind, type User } from '../src';
import { arishaMayReadContext } from '../src/arisha-policy';

const NOW = '2026-10-30T04:00:00.000Z';
const TODAY = '2026-10-30';
function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const user = (id: string) => ds.users.find(u => u.id === id)!;
  return { ds, store, context: new ArishaContextService(store, () => NOW), ceo: user('u-fauzan'), act: user('u-audit'), coo: user('u-coo'), fd: user('u-fd'), it: user('u-it-mgr'), cid: 'co-sasa' };
}
const kinds: ArishaContextKind[] = ['operations', 'compliance', 'finance-papers'];

describe('Arisha aggregate-only executive context', () => {
  it('uses exact leader identities and independent role-scoped read permissions', async () => {
    const { context, ceo, act, coo, fd, it, store, cid } = fresh();
    for (const leader of [ceo, act]) for (const kind of kinds) await expect(context.summary(leader, kind, cid)).resolves.toMatchObject({ context: kind });
    expect(kinds.map(k => arishaMayReadContext(coo, k))).toEqual([true, false, false]);
    expect(kinds.map(k => arishaMayReadContext(fd, k))).toEqual([false, false, true]);
    await expect(context.summary(coo, 'operations', cid)).resolves.toBeDefined();
    await expect(context.summary(fd, 'finance-papers', cid)).resolves.toBeDefined();
    const reads = vi.spyOn(store, 'list');
    reads.mockClear();
    for (const [user, kind] of [[it, 'operations'], [coo, 'finance-papers'], [fd, 'operations'], [{ ...ceo, id: 'other-ceo' }, 'operations'], [{ ...act, actRole: undefined }, 'compliance'], [{ ...ceo, integration: 'feed' }, 'operations']] as [User, string][]) {
      await expect(context.summary(user, kind, cid)).rejects.toThrow();
    }
    for (const kind of ['__proto__', 'sql', 'payroll', 'bank', 'Operations', '']) await expect(context.summary(ceo, kind, cid)).rejects.toThrow();
    expect(reads).not.toHaveBeenCalled();
  });

  it('supports ACT cross-company summaries only through current grants', async () => {
    const { context, act, ds, cid } = fresh();
    const all = await context.summary(act, 'operations');
    expect(all.scope.coveredCompanyIds.length).toBeGreaterThan(1);
    expect(all.scope.coveredCompanyIds).toContain(cid);
    for (const g of ds.grants.filter(g => g.userId === act.id && g.companyId === cid)) g.validTo = '2026-10-29';
    await expect(context.summary(act, 'operations', cid)).rejects.toThrow();
    const after = await context.summary(act, 'operations');
    expect(after.scope.coveredCompanyIds).not.toContain(cid);
    const expected = ds.sites.filter(s => after.scope.coveredCompanyIds.includes(s.companyId)).length;
    expect(after.metrics.find(m => m.code === 'operations.sites.recorded')?.count).toBe(expected);
  });

  it('requires grants even if a malformed account role would otherwise use companyIds', async () => {
    const { context, ceo, ds, cid } = fresh();
    ds.grants = ds.grants.filter(g => g.userId !== ceo.id);
    await expect(context.summary({ ...ceo, role: 'company_manager', companyIds: [cid] }, 'operations', cid)).rejects.toThrow();
    const empty = await context.summary(ceo, 'operations');
    expect(empty.scope.coveredCompanyIds).toEqual([]);
    expect(empty.metrics.every(m => m.count === 0)).toBe(true);
    expect(empty.warnings.join(' ')).toMatch(/Zero counts do not mean/);
    for (const id of ['missing-company', '__proto__', 'a'.repeat(61), '../secrets']) await expect(context.summary(ceo, 'operations', id)).rejects.toThrow();
  });

  it('counts only requested-company records and emits bounded record references, never source text', async () => {
    const { context, act, ds, cid, store } = fresh();
    const sentinel = 'SENSITIVE employee bank medical whistle password instruction';
    const site = ds.sites.find(s => s.companyId === cid)!;
    site.name = sentinel; site.address = sentinel; site.client = sentinel;
    ds.checkpoints.find(c => c.companyId === cid)!.tagCode = sentinel;
    const reads = vi.spyOn(store, 'list');
    const summary = await context.summary(act, 'operations', cid);
    expect(summary.scope.coveredCompanyIds).toEqual([cid]);
    for (const table of ['sites', 'posts', 'checkpoints'] as const) {
      const metric = summary.metrics.find(m => m.source.table === table)!;
      expect(metric.count).toBe(ds[table].filter(r => r.companyId === cid).length);
      expect(metric.source.refs.length).toBeLessThanOrEqual(5);
      expect(metric.source.refs.every(id => ds[table].some(r => r.id === id && r.companyId === cid))).toBe(true);
    }
    expect(JSON.stringify(summary)).not.toContain(sentinel);
    expect(reads.mock.calls.map(([table]) => table)).toEqual(['grants', 'companies', 'sites', 'posts', 'checkpoints']);
  });

  it('treats unknown, malformed and absent expiry evidence as unknown rather than success', async () => {
    const { context, ceo, ds, cid } = fresh();
    ds.licences = [
      { id: 'lic-old', companyId: cid, type: 'KDN_LICENCE', reference: 'sensitive-ref', expiresOn: '2026-10-29' },
      { id: 'lic-today', companyId: cid, type: 'KDN_LICENCE', reference: '', expiresOn: '2026-10-30' },
      { id: 'lic-soon', companyId: cid, type: 'KDN_LICENCE', reference: '', expiresOn: '2026-11-29' },
      { id: 'lic-later', companyId: cid, type: 'KDN_LICENCE', reference: '', expiresOn: '2026-11-30' },
      { id: 'lic-unknown', companyId: cid, type: 'KDN_LICENCE', reference: '', expiresOn: null },
      { id: 'lic-invalid', companyId: cid, type: 'KDN_LICENCE', reference: '', expiresOn: '2026-02-31' },
    ];
    const summary = await context.summary(ceo, 'compliance', cid);
    expect(summary.metrics.map(m => m.count)).toEqual([6, 1, 2, 2]);
    expect(JSON.stringify(summary)).not.toContain('sensitive-ref');
    ds.licences = [];
    const empty = await context.summary(ceo, 'compliance', cid);
    expect(empty.metrics.every(m => m.count === 0)).toBe(true);
    expect(empty.warnings.join(' ')).toMatch(/no recorded licences/);
  });

  it('returns only finance-paper status counts, not financial/person data or document labels', async () => {
    const { context, fd, ds, cid, store } = fresh();
    const row = ds.finStatus.find(f => f.companyId === cid)!;
    const sentinel = 'PRIVATE_BANK_ACCOUNT_MEDICAL_PAYROLL';
    const item = { label: sentinel, dueOn: TODAY, by: sentinel, at: NOW };
    row.audit = [{ ...item, id: 'paper-a', status: 'todo' }, { ...item, id: 'paper-b', status: 'prepared' }];
    row.tax = [{ ...item, id: 'paper-c', status: 'reviewed' }, { ...item, id: 'paper-d', status: 'sent' }, { ...item, id: 'paper-e', status: 'unexpected' as never }];
    row.banks = [{ name: sentinel } as never];
    row.sqlLastAt = NOW;
    const reads = vi.spyOn(store, 'list');
    const summary = await context.summary(fd, 'finance-papers', cid);
    expect(summary.metrics.map(m => m.count)).toEqual([5, 1, 1, 1, 1, 1]);
    expect(summary.metrics.every(m => m.source.table === 'finStatus' && m.source.sourceUpdatedAt === null)).toBe(true);
    expect(summary.metrics.every(m => m.source.refs.every(id => id === row.id))).toBe(true);
    expect(JSON.stringify(summary)).not.toContain(sentinel);
    expect(JSON.stringify(summary)).not.toContain('paper-a');
    expect(reads.mock.calls.map(([table]) => table)).toEqual(['grants', 'companies', 'finStatus']);
  });

  it('distinguishes retrieval time from source freshness and makes no mutations', async () => {
    const { context, ceo, ds, cid } = fresh();
    const before = JSON.stringify(ds);
    for (const kind of kinds) {
      const summary = await context.summary(ceo, kind, cid);
      expect(summary.observedAt).toBe(NOW);
      expect(summary.metrics.every(m => m.source.sourceUpdatedAt === null)).toBe(true);
      expect(summary.warnings.join(' ')).toMatch(/sourceUpdatedAt is unknown/);
      expect(summary.warnings.join(' ')).toMatch(/not organization completeness, compliance certification or runtime health/);
      expect(JSON.stringify(summary).length).toBeLessThan(10_000);
    }
    expect(JSON.stringify(ds)).toBe(before);
  });

  it('bounds large authorized scopes and explicitly reports truncated and missing company coverage', async () => {
    const { context, act, ds } = fresh();
    const template = ds.companies[0];
    for (let i = 0; i < 100; i++) {
      const id = `co-context-${String(i).padStart(3, '0')}`;
      ds.companies.push({ ...template, id, code: id });
      ds.grants.push({ id: `grant-${id}`, companyId: id, userId: act.id, validFrom: '2026-01-01', validTo: '2026-12-31', scope: 'monitor', basis: 'synthetic' });
    }
    ds.grants.push({ id: 'missing-grant', companyId: 'co-unavailable', userId: act.id, validFrom: '2026-01-01', validTo: '2026-12-31', scope: 'monitor', basis: 'synthetic' });
    const summary = await context.summary(act, 'operations');
    expect(summary.scope.coveredCompanyIds).toHaveLength(50);
    expect(summary.warnings.join(' ')).toMatch(/Scope truncated/);
    expect(summary.warnings.join(' ')).toMatch(/company records are unavailable/);
    expect(JSON.stringify(summary).length).toBeLessThan(10_000);
    await expect(context.summary(act, 'operations', 'co-context-099')).resolves.toMatchObject({ scope: { coveredCompanyIds: ['co-context-099'] } });
  });
});
