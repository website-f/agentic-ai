import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt, type AutoReport } from '../src';

// The Director Office sets what each monthly report must have and what is added; owners leave out optional parts and
// add their own, carried to next month (Fauzan, 23 Nov 2026). Synthetic data.
const fresh = () => {
  const ds = generateDataset({ today: '2026-11-23', now: myt('2026-11-23', '10:00') });
  const store = new MemoryStore(ds);
  let now = myt('2026-12-01', '09:00');
  const svc = new PrimaService(store, () => now);
  return { store, svc, at: (d: string) => (now = myt(d, '09:00')) };
};
type Settings = { canSet: boolean; reports: { id: string; kind: string; primaParts: string[] }[] };
type Row = { id: string; kind: string; defId?: string; missing: string[] };
type Sec = { title: string; must?: boolean; source?: string; hidden?: boolean; hint?: string };

describe('What each monthly report must have', () => {
  it('only the Director Office sets it; others are refused', async () => {
    const { svc } = fresh();
    const doa = await svc.user('u-pwvsb-doa');
    const s = (await svc.autoReportAct(doa, 'layouts', {})) as Settings;
    expect(s.canSet).toBe(true);
    const company = s.reports.find((r) => r.kind === 'company')!;
    expect(company.primaParts.length).toBeGreaterThan(0);
    expect(s.reports.some((r) => r.kind === 'client') && s.reports.some((r) => r.kind === 'group')).toBe(true);
    const cm = await svc.user('u-cm-sasa');
    await expect(svc.autoReportAct(cm, 'layouts', {})).rejects.toThrow();
    await expect(svc.autoReportAct(cm, 'setLayout', { reportId: company.id, parts: [], added: [], note: 'try' })).rejects.toThrow();
    await expect(svc.autoReportAct(doa, 'setLayout', { reportId: company.id, parts: [], added: [] })).rejects.toThrow(/what changed/i);
  });

  it('applies must-have, left-out and added parts; send waits until must-have parts are filled', async () => {
    const { svc, store } = fresh();
    const doa = await svc.user('u-pwvsb-doa');
    const s = (await svc.autoReportAct(doa, 'layouts', {})) as Settings;
    const company = s.reports.find((r) => r.kind === 'company')!;
    const [first, second] = company.primaParts;
    await svc.autoReportAct(doa, 'setLayout', {
      reportId: company.id,
      parts: [
        { title: second, use: 'off' },
        { title: first, use: 'must' },
      ],
      added: [{ title: 'Issues for the Director', hint: 'Anything the Director must decide this month', must: true }],
      note: 'Director wants issues every month.',
    });
    const cm = await svc.user('u-cm-sasa');
    const mine = (await svc.autoReportAct(cm, 'mine', {})) as { reports: Row[] };
    const row = mine.reports.find((r) => r.kind === 'company' && r.id.includes(`ar-${company.id}-`))!;
    expect(row.missing).toContain('Issues for the Director');
    const v = (await svc.autoReportAct(cm, 'view', { id: row.id })) as { sectionsList: Sec[] };
    expect(v.sectionsList.some((x) => x.title === second)).toBe(false);
    expect(v.sectionsList[0]).toMatchObject({ title: first, must: true });
    const added = v.sectionsList.findIndex((x) => x.title === 'Issues for the Director');
    expect(v.sectionsList[added]).toMatchObject({ source: 'added', must: true, hint: 'Anything the Director must decide this month' });
    // A must-have part cannot be left out, and the report cannot be sent until it is filled.
    await expect(svc.autoReportAct(cm, 'hide', { id: row.id, index: added })).rejects.toThrow(/must be in/);
    await expect(svc.autoReportAct(cm, 'send', { id: row.id })).rejects.toThrow(/Issues for the Director/);
    await svc.autoReportAct(cm, 'note', { id: row.id, index: added, text: 'Need a decision on the new site rate.' });
    await svc.autoReportAct(cm, 'send', { id: row.id, note: 'Checked.' });
    expect(((await store.get('autoReports', row.id)) as AutoReport).status).toBe('sent');
  });

  it('Prima still sends on the due day with the empty must-have parts named', async () => {
    const { svc, store, at } = fresh();
    const doa = await svc.user('u-pwvsb-doa');
    const s = (await svc.autoReportAct(doa, 'layouts', {})) as Settings;
    const dept = s.reports.find((r) => r.kind === 'department')!;
    await svc.autoReportAct(doa, 'setLayout', { reportId: dept.id, parts: [], added: [{ title: 'Staff matters', hint: '', must: true }], note: 'Add staff matters.' });
    await svc.autoReportAct(doa, 'run', {});
    at('2026-12-28');
    await svc.autoReportAct(doa, 'run', {});
    const subs = await store.list('reportSubmissions', { period: '2026-11' });
    const sub = subs.find((x) => x.defId === dept.id)!;
    expect(sub.note).toMatch(/Must-have parts empty: Staff matters/);
  });

  it('the owner leaves out optional parts and adds their own; both carry to next month', async () => {
    const { svc, store, at } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const mine = (await svc.autoReportAct(cm, 'mine', {})) as { reports: Row[] };
    const row = mine.reports.find((r) => r.kind === 'company')!;
    const v = (await svc.autoReportAct(cm, 'view', { id: row.id })) as { sectionsList: Sec[] };
    const leaveOut = v.sectionsList[0].title;
    await svc.autoReportAct(cm, 'hide', { id: row.id, index: 0 });
    await svc.autoReportAct(cm, 'addPart', { id: row.id, title: 'Client visits by the manager', text: 'Visited 4 sites.' });
    await expect(svc.autoReportAct(cm, 'addPart', { id: row.id, title: 'Client visits by the manager' })).rejects.toThrow(/already/);
    const pdf = (await svc.autoReportAct(cm, 'download', { id: row.id, format: 'csv' })) as { data: string };
    expect(pdf.data).toContain('Visited 4 sites.');
    expect(pdf.data).not.toContain(`"${leaveOut}"`);
    // Another company's office cannot change it.
    await expect(svc.autoReportAct(await svc.user('u-cm-arsh'), 'hide', { id: row.id, index: 1 })).rejects.toThrow();
    // Next month the same choices are there.
    at('2027-01-02');
    const next = (await svc.autoReportAct(cm, 'mine', {})) as { reports: (Row & { period?: string })[] };
    const nextRow = next.reports.find((r) => r.kind === 'company' && r.id === row.id.replace('2026-11', '2026-12'))!;
    const nv = (await svc.autoReportAct(cm, 'view', { id: nextRow.id })) as { sectionsList: Sec[] };
    expect(nv.sectionsList.find((x) => x.title === leaveOut)?.hidden).toBe(true);
    expect(nv.sectionsList.some((x) => x.title === 'Client visits by the manager' && x.source === 'own')).toBe(true);
    // The Director Office can fix the parts so owners cannot add their own.
    const doa = await svc.user('u-pwvsb-doa');
    const defId = ((await store.get('autoReports', nextRow.id)) as AutoReport).defId;
    await svc.autoReportAct(doa, 'setLayout', { reportId: defId, parts: [], added: [], ownParts: false, note: 'Fixed parts.' });
    await expect(svc.autoReportAct(cm, 'addPart', { id: nextRow.id, title: 'Another part' })).rejects.toThrow(/fixed/);
  });
});

describe('Settings reach reports already made', () => {
  it('an unsent report follows new settings at once and keeps the owner notes; a sent one is untouched', async () => {
    const { svc, store } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const mine = (await svc.autoReportAct(cm, 'mine', {})) as { reports: Row[] };
    const [a, b] = mine.reports.filter((r) => r.kind === 'company');
    await svc.autoReportAct(cm, 'note', { id: a.id, index: 0, text: 'Kept note.' });
    await svc.autoReportAct(cm, 'send', { id: b.id });
    const doa = await svc.user('u-pwvsb-doa');
    const defA = ((await store.get('autoReports', a.id)) as AutoReport).defId;
    const defB = ((await store.get('autoReports', b.id)) as AutoReport).defId;
    const sentBefore = JSON.stringify(((await store.get('autoReports', b.id)) as AutoReport).sections);
    for (const id of [defA, defB]) await svc.autoReportAct(doa, 'setLayout', { reportId: id, parts: [], added: [{ title: 'Issues for the Director', hint: '', must: true }], note: 'Add issues.' });
    const ra = (await store.get('autoReports', a.id)) as AutoReport;
    expect(ra.sections.some((x) => x.title === 'Issues for the Director' && x.must)).toBe(true);
    expect(ra.sections[0].note).toBe('Kept note.');
    expect(JSON.stringify(((await store.get('autoReports', b.id)) as AutoReport).sections)).toBe(sentBefore);
  });
});

describe('Who sets what each report must have', () => {
  it('the head of the Director Office and the CEO; other Director Office staff only read', async () => {
    const { svc, store } = fresh();
    const doa = await svc.user('u-pwvsb-doa');
    await store.transaction(async (tx) => {
      await tx.insert('users', { ...doa, id: 'u-do-staff', name: 'Synthetic DO officer', headOf: [] });
    });
    const staff = await svc.user('u-do-staff');
    const s = (await svc.autoReportAct(staff, 'layouts', {})) as Settings;
    expect(s.canSet).toBe(false);
    const id = s.reports[0].id;
    await expect(svc.autoReportAct(staff, 'setLayout', { reportId: id, parts: [], added: [], note: 'Try it.' })).rejects.toThrow(/head of the Director Office/);
    const ceo = await svc.user('u-fauzan');
    expect(((await svc.autoReportAct(ceo, 'layouts', {})) as Settings).canSet).toBe(true);
    await svc.autoReportAct(ceo, 'setLayout', { reportId: id, parts: [], added: [], note: 'CEO sets it.' });
    expect(((await svc.autoReportAct(doa, 'layouts', {})) as Settings).canSet).toBe(true);
  });
});
