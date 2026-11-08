import { describe, expect, it } from 'vitest';
import { buildWorkKpi, type Dataset, type WorkKpiScope } from '../src';

// Central Admin on the Work KPIs screen. Synthetic data only.
const SCOPE: WorkKpiScope = { depts: ['chief_of_staff', 'company_office', 'finance'], companyIds: null, label: 'All' };
const at = (d: string, t: string) => `2026-11-${d}T${t}:00+08:00`;
const mark = (by: string, when: string, extra: object = {}) => ({ by, byId: `u-${by}`, at: when, note: 'ok', ...extra });
const dept = (r: ReturnType<typeof buildWorkKpi>, d: string) => r.departments.find((x) => x.dept === d)!;

describe('Central Admin work KPI adapter', () => {
  it('times lodging against the due date, the renewal steps from arrival, and never the manager’s signature', () => {
    const data = {
      corpFilings: [
        { id: 'f1', companyId: 'co-a', kind: 'AR', title: 'Annual return', dueOn: '2026-11-04', basis: 's.68', status: 'acknowledged', prepared: { by: 'Admin (mock)', at: at('03', '09:00') }, lodged: { by: 'Admin (mock)', at: at('03', '11:00'), ref: 'x', on: '2026-11-03' }, receipt: { by: 'Admin (mock)', at: at('03', '12:00'), ref: 'r' } },
        // Prepared but never lodged: preparation time stays Unknown, nothing is timed.
        { id: 'f2', companyId: 'co-a', kind: 'AR', title: 'Annual return', dueOn: '2026-11-04', basis: 's.68', status: 'prepared', prepared: { by: 'Admin (mock)', at: at('03', '09:00') }, lodged: null, receipt: null },
      ],
      licences: [
        {
          id: 'l1', companyId: 'co-a', type: 'MAJLIS_PREMISE', reference: 'x', expiresOn: '2026-12-31',
          renewal: {
            openedOn: '2026-11-02', openedBy: 'Exec (mock)', openedById: 'u-e',
            papers: [{ name: 'Form', done: mark('Exec (mock)', at('02', '10:30')) }, { name: 'Photo', done: mark('Exec (mock)', at('02', '09:30')) }],
            signed: mark('Manager (mock)', at('03', '15:00')),
            fee: { ...mark('Finance Exec (mock)', at('04', '09:00')), ref: 'PV1', amount: 100 },
            submitted: { ...mark('Exec (mock)', at('04', '10:00')), ref: 's', on: '2026-11-04' },
            agencyNotes: [], returns: [],
            renewed: { ...mark('Exec (mock)', at('05', '09:00')), newExpiresOn: '2027-12-31', oldExpiresOn: '2026-12-31', certificateRef: 'C1' },
            confirmed: mark('Deputy CoS (mock)', at('05', '09:30')),
          },
        },
      ],
      corpProfiles: [],
    } as unknown as Partial<Dataset>;
    const r = buildWorkKpi(data, SCOPE, '2026-11');
    const cos = dept(r, 'chief_of_staff');
    expect(cos.work).toEqual([expect.objectContaining({ workflow: 'ssm_filing', stage: 'lodge', count: 1, medianMinutes: 120, onTimePct: 100 })]);
    expect(cos.checking).toEqual([expect.objectContaining({ workflow: 'renewal', stage: 'confirm', medianMinutes: 30, target: expect.stringMatching(/proposed/) })]);
    expect(cos.unknown.join(' ')).toMatch(/Preparing an SSM filing/);
    const co = dept(r, 'company_office');
    expect(co.work).toEqual([
      expect.objectContaining({ workflow: 'renewal', stage: 'papers', medianMinutes: 120 }),
      expect.objectContaining({ workflow: 'renewal', stage: 'submit', medianMinutes: 60 }),
    ]);
    // The manager signs: an approval, never timed.
    expect(co.people.map((p) => p.name)).toEqual(['Exec (mock)']);
    expect(co.notTimed.join(' ')).toMatch(/signature on a renewal/);
    expect(co.quality[0]).toMatchObject({ workflow: 'renewal', finished: 1, returns: 0, evidenceCompletePct: 100 });
    // Finance pays the fee from the signature.
    expect(dept(r, 'finance').work).toEqual([expect.objectContaining({ workflow: 'renewal', stage: 'fee', medianMinutes: 180 })]);
  });

  it('leaves a returned round of papers out of speed', () => {
    const data = {
      licences: [{ id: 'l2', companyId: 'co-a', type: 'ISO_CERT', reference: 'x', expiresOn: null, renewal: { openedOn: '2026-11-02', openedBy: 'Exec (mock)', openedById: 'u-e', papers: [{ name: 'Form', done: mark('Exec (mock)', at('03', '10:00')) }], signed: mark('Manager (mock)', at('03', '11:00')), fee: null, submitted: null, agencyNotes: [], returns: [mark('Manager (mock)', at('02', '15:00'))], renewed: null, confirmed: null } }],
    } as unknown as Partial<Dataset>;
    expect(dept(buildWorkKpi(data, SCOPE, '2026-11'), 'company_office').work).toEqual([]);
  });
  it('never gives one person the time of papers others ticked', () => {
    const data = {
      licences: [{ id: 'l3', companyId: 'co-a', type: 'ISO_CERT', reference: 'x', expiresOn: null, renewal: { openedOn: '2026-11-02', openedBy: 'Exec (mock)', openedById: 'u-e', papers: [{ name: 'Form', done: mark('Exec A (mock)', at('02', '10:00')) }, { name: 'Photo', done: mark('Exec B (mock)', at('02', '11:00')) }], signed: mark('Manager (mock)', at('02', '12:00')), fee: null, submitted: null, agencyNotes: [], returns: [], renewed: null, confirmed: null } }],
    } as unknown as Partial<Dataset>;
    const co = dept(buildWorkKpi(data, SCOPE, '2026-11'), 'company_office');
    expect(co.work).toEqual([expect.objectContaining({ workflow: 'renewal', stage: 'papers', count: 1 })]);
    expect(co.people.map((p) => p.name)).toEqual(['Company office (papers shared by several people)']);
  });
});
