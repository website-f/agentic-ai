import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt } from '../src';

// Client satisfaction monitored (Fauzan, 2 Nov 2026). Synthetic data only.
const TODAY = '2026-11-02';
const NOW = myt(TODAY, '10:00');
const doc = (n: number) => ({ kind: 'document' as const, name: `Feedback ${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 feedback ${n}`).toString('base64')}` });

async function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  const om = await svc.user('u-om-klang');
  const acct = (await svc.clientBoard(om)).accounts.find((a) => a.canAct && a.stage === 'active')!;
  // Start from a clean history for this client.
  await store.update('clientAccounts', acct.id, { ratings: [], complaints: [], contacts: [] });
  for (const v of ds.siteVisits.filter((v) => acct.siteIds.includes(v.siteId))) await store.update('siteVisits', v.id, { siteId: 'elsewhere' });
  const later = (day: string) => new PrimaService(store, () => myt(day, '10:00'));
  return { ds, store, svc, om, acct, later };
}

const issuesOf = async (svc: PrimaService, id: string) => (await svc.clientBoard(await svc.user('u-coo'))).accounts.find((a) => a.id === id)!.issues.map((i) => i.what);

describe('Client satisfaction', () => {
  it('records who at the client gave the rating and how, with the email or form attached when that is how it came', async () => {
    const { svc, om, acct, store } = await setup();
    await expect(svc.clientRating(om, acct.id, 4, '', { via: 'meeting' })).rejects.toThrow(/who at the client/);
    await expect(svc.clientRating(om, acct.id, 4, '', { from: 'Synthetic PIC', via: 'fax' as 'call' })).rejects.toThrow(/how the client gave it/);
    await expect(svc.clientRating(om, acct.id, 4, '', { from: 'Synthetic PIC', via: 'email' })).rejects.toThrow(/Attach the client's email/);
    await svc.clientRating(om, acct.id, 4, 'Happy with the night shift', { from: 'Synthetic PIC, Facilities', via: 'form', proof: [doc(1)] });
    const a = (await store.get('clientAccounts', acct.id))!;
    expect(a.ratings.at(-1)).toMatchObject({ score: 4, from: 'Synthetic PIC, Facilities', via: 'form' });
    expect(a.ratings.at(-1)!.docId).toBeTruthy();
    expect((await store.list('audit', {})).at(-1)!.summary).toMatch(/satisfaction 4 of 5, from Synthetic PIC, Facilities by form/);
    // The company manager monitors but does not record.
    const cm = (await store.list('users', {})).find((u) => u.role === 'company_manager' && u.companyIds.includes(acct.companyId));
    if (cm) await expect(svc.clientRating(cm, acct.id, 5, '', { from: 'X Y', via: 'call' })).rejects.toThrow();
  });

  it('flags a fall, and a low rating with no visit or meeting within 7 days', async () => {
    const { svc, om, acct, later } = await setup();
    await svc.clientRating(om, acct.id, 5, '', { from: 'Synthetic PIC', via: 'meeting' });
    await svc.clientRating(om, acct.id, 2, 'Guard asleep twice', { from: 'Synthetic PIC', via: 'call' });
    let issues = await issuesOf(svc, acct.id);
    expect(issues).toContain('Satisfaction fell from 5 to 2');
    expect(issues.join(' ')).toMatch(/Unhappy client \(rated 2 of 5 by Synthetic PIC\)/);
    expect(issues).toContain('Visit or meet the client about the low rating by 2026-11-09');
    issues = await issuesOf(later('2026-11-10'), acct.id);
    expect(issues).toContain('No visit or meeting since the low rating (due by 2026-11-09)');
    // A meeting after the rating clears the follow-up flag (the low score itself stays until the client rates again).
    await later('2026-11-10').clientContact(om, acct.id, 'meeting', 'Agreed a new patrol plan');
    issues = await issuesOf(later('2026-11-10'), acct.id);
    expect(issues.join(' ')).not.toMatch(/since the low rating/);
  });

  it('keeps complaints open until what was done is recorded, overdue after 7 days, and warns on 3 in 90 days', async () => {
    const { svc, om, acct, later, store } = await setup();
    await expect(svc.clientComplaint(om, acct.id, { from: 'Synthetic PIC', via: 'call', what: '' })).rejects.toThrow(/what the complaint is/);
    await expect(svc.clientComplaint(om, acct.id, { from: 'Synthetic PIC', via: 'call', what: 'Late', siteId: 'not-theirs' })).rejects.toThrow(/this client's sites/);
    await svc.clientComplaint(om, acct.id, { from: 'Synthetic PIC', via: 'call', what: 'Gate left open at night', siteId: acct.siteIds[0] ?? null });
    expect(await issuesOf(svc, acct.id)).toContain('Open complaint: Gate left open at night');
    const s2 = later('2026-11-12');
    expect((await issuesOf(s2, acct.id)).join(' ')).toMatch(/Complaint open 10 days: Gate left open at night/);
    const id = (await store.get('clientAccounts', acct.id))!.complaints![0].id;
    await expect(s2.resolveClientComplaint(om, acct.id, id, '')).rejects.toThrow(/what was done/);
    await s2.resolveClientComplaint(om, acct.id, id, 'Guard briefed; gate check added to patrol');
    await expect(s2.resolveClientComplaint(om, acct.id, id, 'Again')).rejects.toThrow(/already closed/);
    expect((await issuesOf(s2, acct.id)).join(' ')).not.toMatch(/Complaint open|Open complaint/);
    expect((await store.list('audit', {})).at(-1)!.summary).toMatch(/closed after 10 days/);
    await s2.clientComplaint(om, acct.id, { from: 'Synthetic PIC', via: 'email', what: 'Uniform untidy' });
    await s2.clientComplaint(om, acct.id, { from: 'Synthetic PIC', via: 'visit', what: 'Visitor log incomplete' });
    expect(await issuesOf(s2, acct.id)).toContain('3 complaints in 90 days');
  });

});
