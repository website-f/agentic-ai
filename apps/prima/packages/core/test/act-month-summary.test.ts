import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt } from '../src';

// The ACT Director's one page a month for the CEO (Fauzan, 23 Nov 2026: "Do the gap"). Synthetic data only.
const TODAY = '2026-11-05';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => NOW) };
};

describe('ACT month summary for the CEO', () => {
  it('is read by ACT and the CEO, and refused to company managers and staff outside ACT', async () => {
    const { svc } = fresh();
    for (const id of ['u-audit', 'u-act-mgr', 'u-act-aud1', 'u-fauzan']) {
      const s = await svc.actMonthSummary(await svc.user(id));
      expect(s.month).toBe('2026-10');
    }
    await expect(svc.actMonthSummary(await svc.user('u-cm-arsh'))).rejects.toThrow(/ACT and group leadership/);
  });

  it('counts findings opened and closed in the month and lists what is escalated now', async () => {
    const { svc } = fresh();
    const dir = await svc.user('u-audit');
    const before = await svc.actMonthSummary(dir, '2026-11');
    const enf = await svc.user('u-act-enf1');
    const cm = await svc.user('u-cm-arsh');
    const f = await svc.raiseActFinding(enf, { companyId: 'co-arsh', area: 'ARMS', source: 'workflow_audit', title: 'Key log gap', detail: '', severity: 'high', evidence: 'Synthetic log pages', ownerUserId: cm.id });
    await svc.actFindingStep(cm, f.id, 'plan', { rootCause: 'No second signer', solution: 'Two signatures', targetOn: '2026-11-20' });
    await svc.actFindingStep(cm, f.id, 'fixed', { proof: 'Synthetic log with two signatures' });
    await svc.actFindingStep(dir, f.id, 'check', { ok: true, note: 'Seen the log' });
    const after = await svc.actMonthSummary(dir, '2026-11');
    expect(after.findings.opened).toBe(before.findings.opened + 1);
    expect(after.findings.openedHigh).toBe(before.findings.openedHigh + 1);
    expect(after.findings.closed).toBe(before.findings.closed + 1);
    // Every escalated row is an open finding at least one day overdue, sent to the right level.
    const board = await svc.actBoard(dir);
    const escalated = board.findings.filter((r) => r.escalatedTo);
    expect(after.escalated.map((e) => e.id).sort()).toEqual(escalated.map((r) => r.finding.id).sort());
    for (const e of after.escalated) expect(['Chief of Staff', 'COO', 'CEO']).toContain(e.escalatedTo);
  });

  it('never shows investigations, and ignores a bad or future month', async () => {
    const { svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const s = await svc.actMonthSummary(ceo, '2027-01');
    expect(s.month).toBe('2026-10');
    expect((await svc.actMonthSummary(ceo, 'x')).month).toBe('2026-10');
    expect(JSON.stringify(s)).not.toMatch(/investigation/i);
  });
});
