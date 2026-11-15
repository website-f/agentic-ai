// Part N8 (Fitri package, 13 Nov 2026): Report a problem, answered by IT support. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt } from '../src';

const NOW = myt('2026-11-18', '10:00');

describe('N8 report a problem', () => {
  it('a staff member reports with the screen name; IT support sees it and replies; the person sees the reply; others see nothing', async () => {
    const ds = generateDataset({ today: '2026-11-18', now: NOW });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    const staff = await svc.user('u-cm-sasa');
    const other = await svc.user('u-pwvsb-hr');
    const it = ds.users.find((u) => u.department === 'it' && u.role === 'pwvsb_officer')!;
    await expect(svc.problems.report(staff, { what: 'x', screen: 'people' })).rejects.toThrow(/what went wrong/);
    await expect(svc.problems.report(staff, { what: 'Save button does nothing', screen: 'people', photo: 'data:text/html;base64,AAAA' })).rejects.toThrow(/PNG/);
    const r = await svc.problems.report(staff, { what: 'Save button does nothing on the staff form', screen: 'people' });
    expect(r.screen).toBe('people');
    expect((await svc.problems.list(other)).reports).toHaveLength(0);
    await expect(svc.problems.reply(other, r.id, 'Try again')).rejects.toThrow(/IT support/);
    const box = await svc.problems.list(it);
    expect(box.support).toBe(true);
    expect(box.reports[0].mayReply).toBe(true);
    await svc.problems.reply(it, r.id, 'Fixed; please try again (mock).');
    const mine = await svc.problems.list(staff);
    expect(mine.reports[0]).toMatchObject({ status: 'answered' });
    expect(mine.reports[0].replies[0].text).toMatch(/Fixed/);
  });
});
