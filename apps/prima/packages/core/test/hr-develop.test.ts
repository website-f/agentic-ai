// HR Phase 3, slice 3F (Fauzan, 2 Nov 2026): training, appraisal, handbook acknowledgements. Mock data only.
import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, generateDataset, myt } from '../src';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '09:00');

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  let t = Date.parse(NOW);
  let shift = 0;
  const svc = new PrimaService(new MemoryStore(ds), () => new Date((t += 1000) + shift).toISOString());
  return { ds, svc, later: (days: number) => (shift += days * 86_400_000) };
}

describe('Training, appraisal and policies (slice 3F)', () => {
  it('lets HR record training that the staff member sees, and nobody else outside HR or the company', async () => {
    const { svc } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const staff = await svc.user('u-it-ex3');
    await expect(
      svc.recordTraining(staff, { personId: staff.personId!, course: 'Excel advanced', provider: 'X', from: TODAY, to: TODAY, hours: 7, cost: null, hrdRef: null, certificateRef: null }),
    ).rejects.toBeInstanceOf(AccessDenied);
    await svc.recordTraining(hr, { personId: staff.personId!, course: 'Excel advanced', provider: 'Synthetic Academy', from: TODAY, to: TODAY, hours: 7, cost: 450, hrdRef: 'HRD-0001', certificateRef: null });
    const mine = await svc.trainingRecords(staff);
    expect(mine.rows).toHaveLength(1);
    expect(mine.canRecord).toBe(false);
    expect((await svc.trainingRecords(await svc.user('u-it-ex1'))).rows).toHaveLength(0);
  });

  it('runs an appraisal: HR opens, the appraiser rates, the staff member reads, HR closes; nobody appraises themselves', async () => {
    const { svc } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const staff = await svc.user('u-it-ex3');
    const mgr = await svc.user('u-it-ex1');
    await expect(svc.openAppraisal(hr, { personId: staff.personId!, year: '2026', appraiserId: staff.id })).rejects.toThrow(/themselves/);
    await expect(svc.openAppraisal(hr, { personId: hr.personId!, year: '2026', appraiserId: mgr.id })).rejects.toThrow(/Someone else/);
    const a = await svc.openAppraisal(hr, { personId: staff.personId!, year: '2026', appraiserId: mgr.id });
    await expect(svc.openAppraisal(hr, { personId: staff.personId!, year: '2026', appraiserId: mgr.id })).rejects.toThrow(/already/);
    await expect(svc.rateAppraisal(hr, a.id, { rating: 4, strengths: 'Good work all year', improve: '', trainingNeeds: '' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.rateAppraisal(mgr, a.id, { rating: 7, strengths: 'Good work all year', improve: '', trainingNeeds: '' })).rejects.toThrow(/Rate from/);
    await expect(svc.rateAppraisal(mgr, a.id, { rating: 4, strengths: '', improve: '', trainingNeeds: '' })).rejects.toThrow(/comment/);
    await svc.rateAppraisal(mgr, a.id, { rating: 4, strengths: 'Closed tickets on time', improve: 'Document fixes', trainingNeeds: 'Azure basics' });
    expect((await svc.appraisals(staff)).rows[0].canComment).toBe(true);
    await expect(svc.closeAppraisal(hr, a.id, 'Done')).rejects.toThrow(/Wait/);
    await svc.commentAppraisal(staff, a.id, 'Agreed, thank you');
    await expect(svc.closeAppraisal(hr, a.id, '')).rejects.toThrow(/comment/);
    const done = await svc.closeAppraisal(hr, a.id, 'Filed');
    expect(done.status).toBe('closed');
    await expect(svc.appraisals(await svc.user('u-fd'))).resolves.toMatchObject({ rows: [] });
  });

  it('hides the rating from the staff member until the appraiser sends it, and lets HR close after the reply days', async () => {
    const { svc, later } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const staff = await svc.user('u-it-ex3');
    const mgr = await svc.user('u-it-ex1');
    const a = await svc.openAppraisal(hr, { personId: staff.personId!, year: '2026', appraiserId: mgr.id });
    expect((await svc.appraisals(staff)).rows[0].rating).toBeNull();
    await svc.rateAppraisal(mgr, a.id, { rating: 3, strengths: 'Steady work', improve: '', trainingNeeds: '' });
    later(15);
    expect((await svc.closeAppraisal(hr, a.id, 'No reply after 14 days')).status).toBe('closed');
  });

  it('asks every office staff member to acknowledge each policy version', async () => {
    const { svc } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const staff = await svc.user('u-it-ex3');
    await expect(svc.publishPolicy(staff, { id: null, kind: 'it_use', title: 'IT use', body: 'Use company devices for work only.' })).rejects.toBeInstanceOf(AccessDenied);
    const p = await svc.publishPolicy(hr, { id: null, kind: 'it_use', title: 'IT use', body: 'Use company devices for work only, and lock the screen.' });
    expect((await svc.hrPolicies(staff)).rows[0].canAck).toBe(true);
    await svc.acknowledgePolicy(staff, p.id);
    await expect(svc.acknowledgePolicy(staff, p.id)).rejects.toThrow(/Already/);
    const before = (await svc.hrPolicies(hr)).rows[0];
    expect(before.missing!.some((m) => m.personId === staff.personId)).toBe(false);
    await svc.publishPolicy(hr, { id: p.id, kind: 'it_use', title: 'IT use', body: 'Use company devices for work only, lock the screen, and report loss within 24 hours.' });
    const again = (await svc.hrPolicies(staff)).rows[0];
    expect(again.version).toBe(2);
    expect(again.canAck).toBe(true);
    await svc.acknowledgePolicy(staff, p.id);
    expect((await svc.hrPolicies(staff)).rows[0].myAck).not.toBeNull();
  });
});
