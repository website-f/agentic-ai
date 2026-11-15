import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, addDays, checkAssignment, deployability, generateDataset, myt } from '../src';

// E9 (Fitri package, PIKM/ISO, Fauzan 11 Nov 2026): yearly medical from 56, site risk briefing before the first
// shift, 7-year personnel records, the client information pack, office alarm and CCTV records. Synthetic data only.
const TODAY = '2026-11-05';
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:00') });
  const svc = new PrimaService(new MemoryStore(ds), () => myt(TODAY, '10:00'));
  return { ds, svc };
};

describe('quality items (E9)', () => {
  it('warns when a guard aged 56 or over has no current yearly medical', () => {
    const { ds } = fresh();
    const g = ds.people.find((p) => p.role === 'guard' && p.status === 'active')!;
    const old = { ...g, dob: '1969-01-01' };
    const young = { ...g, dob: '1990-01-01' };
    const creds = ds.credentials.filter((c) => c.personId === g.id);
    expect(deployability(old, creds, TODAY, false).some((f) => f.code === 'MEDICAL_56' && f.level === 'warn')).toBe(true);
    expect(deployability(young, creds, TODAY, false).some((f) => f.code === 'MEDICAL_56')).toBe(false);
    const med = { id: 'cr-med', companyId: g.companyId, personId: g.id, type: 'MEDICAL_CHECK' as const, number: 'CLINIC-1', issuedOn: addDays(TODAY, -30), expiresOn: addDays(TODAY, 335) };
    expect(deployability(old, [...creds, med], TODAY, false).some((f) => f.code === 'MEDICAL_56')).toBe(false);
  });

  it('asks for the site risk briefing before the first shift at a medium or high risk site, and records it', async () => {
    const { ds, svc } = fresh();
    const site = ds.sites.find((s) => s.risk !== 'low' && ds.shifts.some((x) => x.siteId === s.id && x.personId))!;
    const shift = ds.shifts.find((x) => x.siteId === site.id && x.personId)!;
    const person = ds.people.find((p) => p.id === shift.personId)!;
    const creds = ds.credentials.filter((c) => c.personId === person.id);
    const first = checkAssignment({ person, credentials: creds, shift, site, otherShifts: [] });
    expect(first.some((f) => f.code === 'RISK_BRIEFING')).toBe(true);
    // Not the first shift there: no warning.
    const earlier = { ...shift, id: 'sh-earlier', date: addDays(shift.date, -7), start: shift.start, end: shift.end };
    expect(checkAssignment({ person, credentials: creds, shift, site, otherShifts: [earlier] }).some((f) => f.code === 'RISK_BRIEFING')).toBe(false);
    // Another company's office cannot record it; the company office can, with what it covered.
    const guardUser = ds.users.find((u) => u.role === 'company_manager' && !u.companyIds.includes(site.companyId));
    if (guardUser) await expect(svc.recordRiskBriefing(await svc.user(guardUser.id), { personId: person.id, siteId: site.id, on: TODAY, note: 'site risks and post orders' })).rejects.toBeInstanceOf(AccessDenied);
    const cm = ds.users.find((u) => u.role === 'company_manager' && u.companyIds.includes(site.companyId))!;
    await expect(svc.recordRiskBriefing(await svc.user(cm.id), { personId: person.id, siteId: site.id, on: TODAY, note: 'x' })).rejects.toThrow(/what the briefing covered/);
    const cred = await svc.recordRiskBriefing(await svc.user(cm.id), { personId: person.id, siteId: site.id, on: addDays(shift.date, -1) < TODAY ? addDays(shift.date, -1) : TODAY, note: 'Site risks, post orders, who to call' });
    const after = checkAssignment({ person, credentials: [...creds, cred], shift: { ...shift, date: shift.date < TODAY ? TODAY : shift.date }, site, otherShifts: [] });
    expect(after.some((f) => f.code === 'RISK_BRIEFING')).toBe(false);
    await expect(svc.recordRiskBriefing(await svc.user(cm.id), { personId: person.id, siteId: site.id, on: cred.issuedOn, note: 'Site risks, post orders, who to call' })).rejects.toThrow(/already recorded/);
  });

  it('builds the client information pack from records, showing what is missing as unknown', async () => {
    const { ds, svc } = fresh();
    const client = ds.clientAccounts[0];
    const cm = ds.users.find((u) => u.role === 'company_manager' && u.companyIds.includes(client.companyId))!;
    const pack = await svc.clientInfoPack(await svc.user(cm.id), client.id);
    expect(pack.client.id).toBe(client.id);
    expect(pack.papers.map((p) => p.what)).toContain('KDN security licence');
    expect(pack.contacts.at(-1)!.step).toMatch(/CMS/);
    expect(pack.complaints.length).toBe(3);
    // Another company's manager cannot open it.
    const other = ds.users.find((u) => u.role === 'company_manager' && !u.companyIds.includes(client.companyId))!;
    await expect(svc.clientInfoPack(await svc.user(other.id), client.id)).rejects.toThrow();
  });

  it('keeps personnel records 7 years after the last day, and lists office alarm and CCTV as renewals', async () => {
    const { ds, svc } = fresh();
    const hr = ds.users.find((u) => u.department === 'hr')!;
    const staff = ds.people.find((p) => p.role === 'office' && p.status === 'active')!;
    const g = await svc.leavingGuide(await svc.user(hr.id), staff.id);
    expect(g.recordsKeptUntil > addDays(g.on, 7 * 365)).toBe(true);
    const { LICENCE_LABEL } = await import('../src');
    expect(LICENCE_LABEL.OFFICE_ALARM).toMatch(/alarm/);
    expect(LICENCE_LABEL.OFFICE_CCTV).toMatch(/CCTV/);
  });
});
