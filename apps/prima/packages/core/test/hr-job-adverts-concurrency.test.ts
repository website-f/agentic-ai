import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt, type Store } from '../src';

// A serialized in-memory unit of work exercises rechecks inside transaction boundaries.
// This is not a PostgreSQL row-lock/RLS integration test.
class SerializedStore extends MemoryStore {
  private tail: Promise<unknown> = Promise.resolve();
  locks: string[] = [];
  async lock(table: string, id: string) { this.locks.push(`${table}:${id}`); }
  override transaction<R>(fn: (store: Store) => Promise<R>): Promise<R> {
    const task = this.tail.then(() => fn(this));
    this.tail = task.catch(() => undefined);
    return task;
  }
}
async function setup() {
  const today = '2026-10-26'; let time = Date.parse(myt(today, '09:00'));
  const store = new SerializedStore(generateDataset({ today, now: new Date(time).toISOString() }));
  const svc = new PrimaService(store, () => new Date(time += 1000).toISOString());
  const hr = await svc.user('u-pwvsb-hr'); const cm = await svc.user('u-cm-arsh');
  const v = await svc.raiseVacancy(cm, { companyId: 'co-arsh', title: 'Synthetic clerk', department: 'Admin', headcount: 1, reason: 'Synthetic vacancy', payFrom: 1800, payTo: 2100, category: 'staff' });
  await svc.vacancyStep(await svc.user('u-fauzan'), v.id, 'ceo_approve', 'Approved');
  await svc.vacancyStep(cm, v.id, 'sign', 'Signed');
  return { store, svc, hr, cm, id: v.id, today };
}
describe('HR applicant transaction rechecks', () => {
  it('serializes concurrent duplicates on the vacancy', async () => {
    const { store, svc, hr, id, today } = await setup();
    const add = () => svc.addApplicant(hr, id, { name: 'Synthetic person', email: 'synthetic@example.test', source: 'other', appliedOn: today });
    const result = await Promise.allSettled([add(), add()]);
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await store.list('applicants', {})).filter(a => a.vacancyId === id)).toHaveLength(1);
    expect(store.locks.filter(l => l === `vacancies:${id}`).length).toBeGreaterThanOrEqual(2);
  });
  it('does not overhire when two offered candidates race for one place', async () => {
    const { store, svc, hr, id, today } = await setup();
    const ids: string[] = [];
    for (const n of [1, 2]) {
      const a = await svc.addApplicant(hr, id, { name: `Synthetic ${n}`, email: `synthetic${n}@example.test`, source: 'other', appliedOn: today });
      await svc.applicantStep(hr, a.id, 'shortlisted', '');
      await svc.applicantStep(hr, a.id, 'interview', '', '2026-10-28T02:00:00Z');
      await svc.applicantStep(hr, a.id, 'offered', 'Synthetic offer');
      ids.push(a.id);
    }
    const result = await Promise.allSettled(ids.map(a => svc.applicantStep(hr, a, 'hired', 'Synthetic acceptance')));
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await store.list('applicants', {})).filter(a => a.vacancyId === id && a.status === 'hired')).toHaveLength(1);
  });
});
