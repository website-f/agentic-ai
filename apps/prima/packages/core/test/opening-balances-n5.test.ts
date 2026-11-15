// Part N5 (Fitri package, 13 Nov 2026): opening balances for staff who started before Prima. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { GROUP_EMPLOYER_ID, MemoryStore, PrimaService, generateDataset, myt } from '../src';

const TODAY = '2026-11-14';
const NOW = myt(TODAY, '10:00');

describe('N5 opening balances', () => {
  it('5 days taken before Prima show 5 fewer days left only after a second HR check; the EA draft adds the year-to-date figures', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    const hr1 = await svc.user('u-pwvsb-hr');
    const hr2 = ds.users.find((u) => u.leadership === 'cos')!;
    const staff = ds.people.find((p) => p.companyId === GROUP_EMPLOYER_ID && p.role === 'office' && p.status === 'active' && p.id !== hr1.personId && p.id !== hr2.personId)!;
    const before = (await svc.guardProfile(hr1, staff.id)).leave.balances.annual.left;
    // Not HR: refused.
    await expect(svc.setOpeningBalance(await svc.user('u-cm-sasa'), staff.id, { asAt: '2026-11-13', annual: 5, reason: 'x' })).rejects.toThrow();
    await expect(svc.setOpeningBalance(hr1, staff.id, { asAt: '2026-11-13', annual: 5 })).rejects.toThrow();
    await svc.setOpeningBalance(hr1, staff.id, { asAt: '2026-11-13', annual: 5, sick: 2, gross: 30000, epf: 3300, socsoEis: 150, pcb: 1200, months: 10, reason: 'From the old payroll file (mock).' });
    expect((await svc.guardProfile(hr1, staff.id)).leave.balances.annual.left).toBe(before);
    // The person who entered it cannot check it.
    await expect(svc.checkOpeningBalance(hr1, staff.id, 'Fine')).rejects.toThrow(/second HR person/);
    await svc.checkOpeningBalance(hr2, staff.id, 'Agreed to the old leave card (mock).');
    const b = (await svc.guardProfile(hr1, staff.id)).leave.balances;
    expect(b.annual.left).toBe(Math.max(0, before - 5));
    expect(b.opening).toMatchObject({ annual: 5, sick: 2 });
    const ea = await svc.eaDraft(hr1, GROUP_EMPLOYER_ID, '2026');
    expect(ea.openingBalances).toBe(1);
    expect(ea.body).toContain(staff.staffNo);
    expect(ea.body).toMatch(/1200\.00|PCB/);
  });

  it('bulk load: each row by staff number, refused rows listed, every row still waits for the check', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    const hr1 = await svc.user('u-pwvsb-hr');
    const staff = ds.people.filter((p) => p.companyId === GROUP_EMPLOYER_ID && p.role === 'office' && p.status === 'active' && p.id !== hr1.personId).slice(0, 2);
    const csv = `staffNo,asAt,annual,gross\n${staff[0].staffNo},2026-11-13,3,20000\n${staff[1].staffNo},2026-11-13,-1,0\nNOPE-1,2026-11-13,1,0\n`;
    const r = await svc.loadOpeningBalances(hr1, GROUP_EMPLOYER_ID, csv, 'Old system export (mock).');
    expect([r.inFile, r.loaded, r.refused.length]).toEqual([3, 1, 2]);
    const list = await svc.openingBalances(hr1, GROUP_EMPLOYER_ID);
    expect(list.find((x) => x.personId === staff[0].id)?.opening?.checked).toBeNull();
  });
});
