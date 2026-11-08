import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, staffPayStatutoryKey, dataWalls, staffPayRole, type Store, type StaffPayRun } from '../src';
import { DEFAULT_STATUTORY } from '../src/statutory';
const TODAY = '2026-11-07', NOW = '2026-11-07T02:00:00.000Z';
async function fresh(period = '2026-11') {
  const ds = generateDataset({ today: TODAY, now: NOW });
  // All participating synthetic staff have a payable own account; account-validation tests live elsewhere.
  for (const person of ds.people.filter((p) => p.companyId === 'co-sasa' && p.role === 'office'))
    { person.bank = { bank: 'Synthetic bank', accountMasked: '****1234' }; person.hiredOn = '2020-01-01'; person.leaving = undefined; }
  let tick = Date.parse(NOW);
  const store = new MemoryStore(ds), svc = new PrimaService(store, () => new Date(tick += 1000).toISOString());
  const hr = await svc.user('u-pwvsb-hr'), ceo = await svc.user('u-fauzan'), cos = await svc.user('u-cos'), coo = await svc.user('u-coo'), finance = await svc.user('u-fd');
  const existing = await store.get('staffPayRuns', `sp-co-sasa-${period}`);
  if (existing) await store.update('staffPayRuns', existing.id, { stage: 'draft' });
  const run = await svc.prepareStaffPay(hr, 'co-sasa', period);
  const settings = (rate = 0.12) => ({ ...structuredClone(DEFAULT_STATUTORY), epf: { ...DEFAULT_STATUTORY.epf, eeRate: rate } });
  const change = (month = period, rate = 0.12) => svc.setStatutory(ceo, { effectiveFrom: month, settings: settings(rate), reason: 'Synthetic statutory change' });
  const atStage = async (stage: StaffPayRun['stage']) => store.update('staffPayRuns', run.id, { stage, approved: { by: cos.name, byId: cos.id, at: NOW, note: 'Synthetic approval' } });
  return { svc, store, hr, ceo, cos, coo, finance, run, change, atStage, settings };
}
describe('effective-month statutory inputs are bound to staff payroll', () => {
  it('grants the narrow statutory read wall exactly to existing payroll Finance roles', () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    for (const user of ds.users) {
      expect(dataWalls(user).includes('statutory_read')).toBe(staffPayRole(user) === 'finance');
      for (const altered of [
        { ...user, integration: 'ja' as const },
        { ...user, role: 'guard' as const, department: 'finance', financeTeam: 1 },
        { ...user, role: 'site_device' as const, department: 'finance', financeTeam: 1 },
      ]) expect(dataWalls(altered).includes('statutory_read')).toBe(false);
    }
  });

  it('blocks stale submission; recalculation preserves allowances and uses new rates', async () => {
    const { svc, hr, run, change } = await fresh();
    await change();
    await expect(svc.staffPayStep(hr, run.id, 'submit')).rejects.toThrow(/Statutory contribution settings/);
    const rebuilt = await svc.prepareStaffPay(hr, run.companyId, run.period);
    expect(rebuilt.lines[0].statutoryInputs).not.toBe(run.lines[0].statutoryInputs);
    expect(rebuilt.lines[0].allowanceLines).toEqual(run.lines[0].allowanceLines);
    expect(rebuilt.lines.some((l, i) => l.epfEe !== run.lines[i].epfEe)).toBe(true);
    await expect(svc.staffPayStep(hr, run.id, 'submit')).resolves.toMatchObject({ stage: 'submitted' });
  });
  it.each([['submitted', 'approve', 'cos'], ['approved', 'coo_approve', 'coo'], ['coo_approved', 'pay', 'finance']] as const)('blocks stale %s progression; allows return', async (stage, action, who) => {
    const ctx = await fresh(); await ctx.atStage(stage); await ctx.change();
    await expect(ctx.svc.staffPayStep(ctx[who], ctx.run.id, action, { note: 'Synthetic review', bankRef: 'TEST-ONLY', pcbChecked: true })).rejects.toThrow(/Statutory contribution settings/);
    expect((await ctx.store.get('staffPayRuns', ctx.run.id))!.stage).toBe(stage);
    await expect(ctx.svc.staffPayStep(ctx[who], ctx.run.id, 'return', { note: 'Recalculate using current effective rates' })).resolves.toMatchObject({ stage: 'draft' });
  });
  it('does not invalidate earlier months or months before a scheduled change', async () => {
    const oct = await fresh('2026-10'); await oct.change('2026-11');
    await expect(oct.svc.staffPayStep(oct.hr, oct.run.id, 'submit')).resolves.toMatchObject({ stage: 'submitted' });
    const nov = await fresh(); await nov.change('2026-12');
    await expect(nov.svc.staffPayStep(nov.hr, nov.run.id, 'submit')).resolves.toMatchObject({ stage: 'submitted' });
  });
  it('ignores metadata/object ordering but binds numeric contribution settings', async () => {
    const a = structuredClone(DEFAULT_STATUTORY), b = { ...structuredClone(a), lawRef: 'Different explanatory reference only' };
    b.epf = Object.fromEntries(Object.entries(b.epf).reverse()) as typeof b.epf;
    expect(staffPayStatutoryKey(a)).toBe(staffPayStatutoryKey(b));
    const { svc, ceo, hr, run } = await fresh();
    await svc.setStatutory(ceo, { effectiveFrom: run.period, settings: b, reason: 'Clarify legal citation only' });
    await expect(svc.staffPayStep(hr, run.id, 'submit')).resolves.toMatchObject({ stage: 'submitted' });
    b.epf.eeRate += 0.01; expect(staffPayStatutoryKey(a)).not.toBe(staffPayStatutoryKey(b));
  });
  it('blocks unbound legacy lines until recalculated', async () => {
    const { svc, store, hr, run } = await fresh();
    await store.update('staffPayRuns', run.id, { lines: run.lines.map(({ statutoryInputs: _old, ...line }) => line) });
    await expect(svc.staffPayStep(hr, run.id, 'submit')).rejects.toThrow(/were not recorded/);
    await svc.prepareStaffPay(hr, run.companyId, run.period);
    await expect(svc.staffPayStep(hr, run.id, 'submit')).resolves.toMatchObject({ stage: 'submitted' });
  });
  it('rechecks rates under setter lock before progression', async () => {
    const { svc, store, hr, run, change, settings } = await fresh();
    const version = await change(run.period, DEFAULT_STATUTORY.epf.eeRate), locks: string[] = [];
    (store as Store).lock = async (table, id) => { locks.push(`${table}:${id}`); if (table === 'statutoryVersions') await store.update('statutoryVersions', version.id, { settings: settings() }); };
    await expect(svc.staffPayStep(hr, run.id, 'submit')).rejects.toThrow(/Statutory contribution settings/);
    expect(locks.slice(0, 2)).toEqual(['statutoryVersions:statutory', `staffPayRuns:${run.id}`]);
    expect((await store.get('staffPayRuns', run.id))!.stage).toBe('draft');
  });
  it('blocks unpaid stale exports; preserves paid historical exports', async () => {
    const { svc, finance, run, atStage, change } = await fresh(); await atStage('coo_approved'); await change();
    await expect(svc.staffPayExport(finance, run.id, 'bank')).rejects.toThrow(/Statutory contribution settings/);
    await atStage('paid'); await expect(svc.staffPayExport(finance, run.id, 'bank')).resolves.toHaveProperty('body');
  });
});
