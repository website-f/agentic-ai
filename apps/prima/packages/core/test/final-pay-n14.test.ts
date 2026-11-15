// Part N14 (Fitri package, 13 Nov 2026): the final pay worked out for HR to check. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { GROUP_EMPLOYER_ID, MemoryStore, PrimaService, generateDataset, myt } from '../src';

const TODAY = '2026-11-14';
const NOW = myt(TODAY, '10:00');

describe('N14 final pay', () => {
  it('works out the last month, unused leave and notice short; HR saves with a reason on any change; not HR is refused', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    const hr = await svc.user('u-pwvsb-hr');
    const p = ds.people.find((x) => x.companyId === GROUP_EMPLOYER_ID && x.role === 'office' && x.status === 'active' && x.id !== hr.personId && (x.basicPay ?? 0) > 0 && x.hiredOn < '2025-01-01')!;
    // Resigned on 1 Nov, last day 30 Nov: 29 days given of 3 months (1 year or more of service).
    p.leaving = { kind: 'resigned', noticeOn: '2026-11-01', lastDayOn: '2026-11-30', reason: 'Resigned (mock)', by: 'HR', at: NOW };
    const g = await svc.leavingGuide(hr, p.id);
    const f = g.finalPay;
    expect(f.lastMonth).toMatchObject({ from: '2026-11-01', to: '2026-11-30' });
    expect(f.lastMonth.basic).toBe(p.basicPay);
    expect(f.unusedLeave.monthsCounted).toBe(11);
    expect(f.notice.shortDays).toBe(g.resignation.days - 29);
    expect(f.notice.owedBy).toBe('staff');
    expect(f.notice.amount).toBeCloseTo(((p.basicPay ?? 0) / 30) * f.notice.shortDays, 1);
    await expect(svc.setFinalPay(await svc.user('u-cm-sasa'), p.id, { reason: 'ok' })).rejects.toThrow();
    await expect(svc.setFinalPay(hr, p.id, { unusedLeave: 1, reason: 'short' })).rejects.toThrow(/differ/);
    const saved = await svc.setFinalPay(hr, p.id, { unusedLeave: 1, reason: 'Two leave days were taken on paper before Prima (mock).' });
    expect(saved.changed).toEqual(['unusedLeave']);
    expect(saved.figures.unusedLeave).toBe(1);
  });
});
