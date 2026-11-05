// HR Phase 3, office OSH (Fauzan, 2 Nov 2026): OSH coordinator, office risk assessment, DOSH reports. Mock data only.
import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, addDays, filingsDue, generateDataset, myt } from '../src';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '09:00');

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  let t = Date.parse(NOW);
  const svc = new PrimaService(new MemoryStore(ds), () => new Date((t += 1000)).toISOString());
  return { ds, svc };
}

describe('Office OSH', () => {
  it('flags employers of 5 or more without a coordinator, and HR alone names one', async () => {
    const { svc } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const staff = await svc.user('u-it-ex3');
    const b = await svc.officeOsh(hr);
    const row = b.rows.find((r) => r.companyId === staff.companyIds[0] || b.staff.some((s) => s.personId === staff.personId && s.companyId === r.companyId))!;
    expect(row.needsCoordinator).toBe(true);
    await expect(
      svc.appointOshCoordinator(await svc.user('u-cm-sasa'), { companyId: row.companyId, personId: staff.personId!, appointedOn: TODAY, trainingRef: null, note: '' }),
    ).rejects.toBeInstanceOf(AccessDenied);
    await svc.appointOshCoordinator(hr, { companyId: row.companyId, personId: staff.personId!, appointedOn: TODAY, trainingRef: 'NIOSH-OSHC-1', note: '' });
    const after = (await svc.officeOsh(hr)).rows.find((r) => r.companyId === row.companyId)!;
    expect(after.needsCoordinator).toBe(false);
    expect(after.coordinator!.name).toBe(staff.name);
    // A new coordinator ends the old one.
    const other = (await svc.officeOsh(hr)).staff.find((s) => s.companyId === row.companyId && s.personId !== staff.personId)!;
    await svc.appointOshCoordinator(hr, { companyId: row.companyId, personId: other.personId, appointedOn: TODAY, trainingRef: null, note: 'Handover' });
    expect((await svc.officeOsh(hr)).rows.find((r) => r.companyId === row.companyId)!.coordinator!.personId).toBe(other.personId);
  });

  it('lets the coordinator record an office risk assessment and an accident, with the DOSH form due in 7 days', async () => {
    const { svc } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const coord = await svc.user('u-it-ex3');
    const companyId = (await svc.officeOsh(hr)).staff.find((s) => s.personId === coord.personId)!.companyId;
    await expect(
      svc.recordOfficeAssessment(coord, { companyId, workplace: 'Level 3', assessedOn: TODAY, hazards: 6, highRisks: 1, controls: 'Cable trays fitted' }),
    ).rejects.toBeInstanceOf(AccessDenied);
    await svc.appointOshCoordinator(hr, { companyId, personId: coord.personId!, appointedOn: TODAY, trainingRef: null, note: '' });
    await expect(svc.recordOfficeAssessment(coord, { companyId, workplace: 'Level 3', assessedOn: TODAY, hazards: 6, highRisks: 1, controls: '' })).rejects.toThrow(/high risks/);
    const a = await svc.recordOfficeAssessment(coord, { companyId, workplace: 'Level 3', assessedOn: TODAY, hazards: 6, highRisks: 1, controls: 'Cable trays fitted in the server room' });
    expect(a.nextReviewOn > addDays(TODAY, 360)).toBe(true);
    const i = await svc.reportOshIncident(coord, { companyId, incident: 'accident', occurredOn: TODAY, personId: coord.personId!, serious: false, description: 'Slipped on a wet floor at the pantry' });
    expect(i.reportBy).toBe(addDays(TODAY, 7));
    const board = await svc.officeOsh(coord);
    expect(board.rows.every((r) => r.companyId === companyId)).toBe(true);
    expect(board.rows[0].incidents[0].form).toBe('JKKP 6');
    await expect(svc.recordOshReport(coord, i.id, { reportedOn: TODAY, ref: '' })).rejects.toThrow(/reference/);
    await svc.recordOshReport(coord, i.id, { reportedOn: TODAY, ref: 'JKKP6-0001' });
    await expect(svc.recordOshReport(hr, i.id, { reportedOn: TODAY, ref: 'again' })).rejects.toThrow(/Already/);
    // Someone not in HR, not the coordinator and not the company manager cannot see or record anything.
    const other = await svc.user('u-it-ex1');
    await expect(svc.officeOsh(other)).rejects.toBeInstanceOf(AccessDenied);
    await expect(
      svc.reportOshIncident(other, { companyId, incident: 'accident', occurredOn: TODAY, personId: null, serious: false, description: 'Not allowed to record this' }),
    ).rejects.toBeInstanceOf(AccessDenied);
  });

  it('puts the JKKP 8 yearly summary on the filing list in January, due 31 January', () => {
    const { ds } = fresh();
    const f = filingsDue(ds.people, [], '2027-01-05').filter((x) => x.kind === 'JKKP8');
    expect(f.length).toBeGreaterThan(0);
    expect(f[0].period).toBe('2026');
    expect(f[0].latestBy).toBe('2027-01-31');
    expect(filingsDue(ds.people, [], TODAY).some((x) => x.kind === 'JKKP8')).toBe(false);
  });
});
