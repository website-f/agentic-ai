import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt, type AutoReport } from '../src';

// Monthly reports Prima makes by itself (Fauzan, 23 Nov 2026: "Let system automaticly create every month report
// needed"; decision card: the owner checks, Prima sends on the due day, client reports wait for a person). Synthetic data.
const TODAY = '2026-12-01';
const fresh = (today = TODAY) => {
  const ds = generateDataset({ today: '2026-11-23', now: myt('2026-11-23', '10:00') });
  const store = new MemoryStore(ds);
  let now = myt(today, '09:00');
  const svc = new PrimaService(store, () => now);
  return { ds, store, svc, at: (d: string) => (now = myt(d, '09:00')) };
};
type Mine = { reports: { id: string; kind: string; owner: boolean; status: string; scopeName: string; name: string; period: string }[]; canRun: boolean; month: string | null };

describe('Monthly reports made by Prima', () => {
  it('makes the company reports for last month when the company office opens Reports, owned by that office only', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const mine = (await svc.autoReportAct(cm, 'mine', {})) as Mine;
    expect(mine.month).toBe('2026-11');
    const own = mine.reports.filter((r) => r.kind === 'company');
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((r) => r.owner && r.period === '2026-11' && r.status === 'made')).toBe(true);
    // Another company's office sees none of Sasa's.
    const other = (await svc.autoReportAct(await svc.user('u-cm-arsh'), 'mine', {})) as Mine;
    expect(other.reports.some((r) => own.some((o) => o.id === r.id))).toBe(false);
    // Opening again makes no second copy.
    const again = (await svc.autoReportAct(cm, 'mine', {})) as Mine;
    expect(again.reports.filter((r) => r.kind === 'company').length).toBe(own.length);
  });

  it('fills figures from Prima records, lets the owner key in and upload, then sends to the Director Office', async () => {
    const { svc, store } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const mine = (await svc.autoReportAct(cm, 'mine', {})) as Mine;
    const r = mine.reports.find((x) => x.kind === 'company')!;
    const v = (await svc.autoReportAct(cm, 'view', { id: r.id })) as { sectionsList: { title: string; lines: string[] }[] };
    expect(v.sectionsList.some((s) => s.lines.some((l) => /Headcount|invoices|Shifts/.test(l)))).toBe(true);
    const last = v.sectionsList.length - 1;
    await svc.autoReportAct(cm, 'note', { id: r.id, index: last, text: 'Two new sites start in December.' });
    await svc.autoReportAct(cm, 'upload', { id: r.id, name: 'P&L.pdf', data: `data:application/pdf;base64,${btoa('%PDF-1.4 synthetic')}` });
    // A department officer cannot key in a company report.
    await expect(svc.autoReportAct(await svc.user('u-pwvsb-hr'), 'note', { id: r.id, index: 0, text: 'x' })).rejects.toThrow();
    const pdf = (await svc.autoReportAct(cm, 'download', { id: r.id })) as { data: string };
    expect(pdf.data.startsWith('data:application/pdf;base64,')).toBe(true);
    const csv = (await svc.autoReportAct(cm, 'download', { id: r.id, format: 'csv' })) as { data: string };
    expect(csv.data).toContain('Two new sites start in December.');
    await svc.autoReportAct(cm, 'send', { id: r.id, note: 'Checked.' });
    const rec = (await store.get('autoReports', r.id)) as AutoReport;
    expect(rec.status).toBe('sent');
    expect(rec.sent!.checked).toBe(true);
    const subs = await store.list('reportSubmissions', { period: '2026-11' });
    expect(subs.some((s) => s.defId === rec.defId && s.companyId === 'co-sasa')).toBe(true);
    await expect(svc.autoReportAct(cm, 'send', { id: r.id })).rejects.toThrow(/already sent/);
  });

  it('makes each department report on the ACT form for its own staff; ACT and the Director Office read it', async () => {
    const { svc } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const mine = (await svc.autoReportAct(hr, 'mine', {})) as Mine;
    const dept = mine.reports.filter((r) => r.kind === 'department');
    expect(dept.length).toBeGreaterThan(0);
    expect(dept.every((r) => r.owner)).toBe(true);
    const v = (await svc.autoReportAct(hr, 'view', { id: dept[0].id })) as { sectionsList: { title: string; lines: string[] }[] };
    expect(v.sectionsList.find((s) => /People/.test(s.title))!.lines.length).toBeGreaterThan(0);
    const act = (await svc.autoReportAct(await svc.user('u-audit'), 'mine', {})) as Mine;
    expect(act.reports.some((r) => r.id === dept[0].id && !r.owner)).toBe(true);
    const doa = (await svc.autoReportAct(await svc.user('u-pwvsb-doa'), 'mine', {})) as Mine;
    expect(doa.canRun).toBe(true);
    expect(doa.reports.some((r) => r.id === dept[0].id)).toBe(true);
    // A company manager never reads a department report.
    await expect(svc.autoReportAct(await svc.user('u-cm-sasa'), 'view', { id: dept[0].id })).rejects.toThrow();
  });

  it('Make now by the Director Office makes every report including the group report for the CEO', async () => {
    const { svc } = fresh();
    const doa = await svc.user('u-pwvsb-doa');
    const res = (await svc.autoReportAct(doa, 'run', {})) as { made: number; sent: number };
    expect(res.made).toBeGreaterThan(0);
    const mine = (await svc.autoReportAct(doa, 'mine', {})) as Mine;
    expect(mine.reports.some((r) => r.kind === 'group' && r.owner)).toBe(true);
    await expect(svc.autoReportAct(await svc.user('u-cm-sasa'), 'run', {})).rejects.toThrow();
  });

  it('on the due day Prima sends an unsent internal report itself, marked not checked, but never a client report', async () => {
    const { svc, store, at } = fresh();
    const doa = await svc.user('u-pwvsb-doa');
    await svc.autoReportAct(doa, 'run', {});
    await svc.autoReportAct(await svc.user('u-cm-sasa'), 'mine', {});
    const before = (await store.list('autoReports', {})) as AutoReport[];
    expect(before.length).toBeGreaterThan(0);
    at('2026-12-26');
    await svc.autoReportAct(doa, 'run', {});
    const after = (await store.list('autoReports', {})) as AutoReport[];
    const internal = after.filter((r) => (r.kind === 'company' || r.kind === 'department') && r.due <= '2026-12-26');
    expect(internal.length).toBeGreaterThan(0);
    expect(internal.every((r) => r.status === 'sent')).toBe(true);
    expect(internal.some((r) => r.sent && !r.sent.checked)).toBe(true);
    expect(after.filter((r) => r.kind === 'client').every((r) => r.status === 'made')).toBe(true);
    const dep = internal.find((r) => r.kind === 'department')!;
    const subs = await store.list('reportSubmissions', { defId: dep.defId, period: '2026-11' });
    expect(subs.length).toBe(1);
  });

  it('tells the owner on Home, red once overdue', async () => {
    const { svc, at } = fresh();
    const cm = await svc.user('u-cm-sasa');
    await svc.autoReportAct(cm, 'mine', {});
    const home = await svc.home(cm);
    expect(home.todo.some((t) => t.tag === 'Report' && /check and send/.test(t.title))).toBe(true);
    at('2026-12-08');
    const later = await svc.home(cm);
    expect(later.todo.some((t) => t.tag === 'Report' && t.tone === 'crit')).toBe(true);
  });

  it('makes nothing before the make day of the month', async () => {
    const { svc } = fresh('2026-11-23');
    // 23 Nov is after the 1st, so October is the month; nothing is made for the month still running.
    const mine = (await svc.autoReportAct(await svc.user('u-cm-sasa'), 'mine', {})) as Mine;
    expect(mine.reports.every((r) => r.period === '2026-10')).toBe(true);
  });
});
