import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, alertItem, inAppAlerts, generateDataset, myt, planAlerts, renderAlertEmail, renderTeamsCard, type AlertItem, type HomeItem } from '../src';

// Alerts to Teams and email (staff usability rule 7, Fauzan 4-5 Nov 2026). Mock data only.
const TODAY = '2026-11-05';
const NOW = myt(TODAY, '08:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
};
const item = (over: Partial<HomeItem> = {}): HomeItem => ({ tone: 'crit', tag: 'P1 case', title: 'Fence broken', detail: 'Sasa · C-1', go: { view: 'cases', caseId: 'c1', companyId: 'co1' }, ...over });

describe('alert items come from each person\'s own to-do', () => {
  it('gives an IT executive their own jobs, and the IT Manager the jobs waiting for a check, never their own', async () => {
    const { svc, ds } = fresh();
    const ex1 = await svc.user('u-it-ex1');
    const mgr = await svc.user('u-it-mgr');
    const mine = ds.itJobs.filter((j) => j.assigneeId === ex1.id && ['todo', 'doing', 'returned'].includes(j.status));
    const items = await svc.alertItems(ex1);
    for (const j of mine) expect(items.some((i) => i.title.startsWith(`${j.ref}:`))).toBe(true);
    // Nobody else's job is sent to this person as their own.
    const others = ds.itJobs.filter((j) => j.assigneeId !== ex1.id).map((j) => `${j.ref}:`);
    expect(items.filter((i) => i.tag === 'IT job' && others.some((r) => i.title.startsWith(r)))).toEqual([]);
    const mgrItems = await svc.alertItems(mgr);
    const ownChecks = mgrItems.filter((i) => i.tag === 'IT job to check' && ds.itJobs.some((j) => j.assigneeId === mgr.id && i.title.startsWith(`${j.ref}:`)));
    expect(ownChecks).toEqual([]);
  });

  it('sends guards and connected systems nothing', async () => {
    const { svc, ds } = fresh();
    const guard = ds.users.find((u) => u.role === 'guard');
    if (guard) expect(await svc.alertItems(guard)).toEqual([]);
    const sys = ds.users.find((u) => u.integration);
    if (sys) expect(await svc.alertItems(sys)).toEqual([]);
  });

  it('works for a company manager through their home list', async () => {
    const { svc, ds } = fresh();
    const cm = ds.users.find((u) => u.role === 'company_manager')!;
    const items = await svc.alertItems(cm);
    expect(Array.isArray(items)).toBe(true);
  });
});

describe('what is sent and when', () => {
  const a = alertItem(item());
  const b = alertItem(item({ tone: 'warn', tag: 'Licence', title: 'Licence due', go: { view: 'compliance', companyId: 'co1' } }));
  const ok = alertItem(item({ tone: 'ok', tag: 'Done', title: 'All fine', go: { view: 'home' } }));

  it('keeps one key for the same work even when the daily wording changes', () => {
    expect(alertItem(item({ detail: '3 days ago' })).key).toBe(alertItem(item({ detail: '4 days ago' })).key);
    expect(alertItem(item({ go: { view: 'cases', caseId: 'c2', companyId: 'co1' } })).key).not.toBe(a.key);
  });

  it('sends an urgent item once, and the digest lists everything still waiting', () => {
    const sent = new Set<string>();
    expect(planAlerts([a, b, ok, a], 'urgent', (k) => sent.has(k))).toEqual([a]);
    sent.add(a.key);
    expect(planAlerts([a, b, ok], 'urgent', (k) => sent.has(k))).toEqual([]);
    expect(planAlerts([a, b, ok, b], 'digest', () => true)).toEqual([a, b]);
  });

  it('writes Bahasa Melayu, links to the screen, escapes record text and names no AI tool', () => {
    const evil: AlertItem = { ...a, title: '<script>x</script> & co' };
    const m = renderAlertEmail('digest', [evil, b], { appUrl: 'https://prima.example.invalid/', today: TODAY });
    expect(m.subject).toBe(`Prima Secure: 2 perkara perlu tindakan anda hari ini (${TODAY})`);
    expect(m.text).toMatch(/Buka Prima Secure untuk bertindak/);
    expect(m.text).toMatch(/https:\/\/prima\.example\.invalid\/#cases/);
    expect(m.html).not.toMatch(/<script>/);
    expect(m.html).toMatch(/&lt;script&gt;/);
    const card = JSON.stringify(renderTeamsCard('it', [a], { appUrl: null }));
    for (const s of [m.subject, m.text, m.html, card]) expect(s).not.toMatch(/\bAI\b|Arisha|Claude|ChatGPT|OpenAI/);
    expect(card).not.toMatch(/Action\.OpenUrl/);
  });

  it('posts only counts by kind to a Teams channel, never a title, detail or name', () => {
    const secret = alertItem(item({ title: 'Tender T-9 confidential price', detail: 'Ahmad · pay case' }));
    const card = JSON.stringify(renderTeamsCard('it', [secret, a, b], { appUrl: null }));
    expect(card).toMatch(/3 perkara SEGERA baharu \(it\)/);
    expect(card).toMatch(/\*\*P1 case\*\*: 2/);
    for (const s of ['Tender T-9', 'confidential', 'Ahmad', 'Fence broken', 'Licence due', 'Sasa']) expect(card).not.toContain(s);
  });

  it('shows the same items in the app bell, red first, and leaves out finished ones', () => {
    expect(inAppAlerts([b, ok, a, b])).toEqual([a, b]);
  });

  it('gives the signed-in person the same items in the bell as in their alerts', async () => {
    const { svc } = fresh();
    const ex1 = await svc.user('u-it-ex1');
    const bell = await svc.myAlerts(ex1);
    expect(bell.length).toBeGreaterThan(0);
    expect(bell.map((i) => i.key).sort()).toEqual(inAppAlerts((await svc.alertItems(ex1)).map(alertItem)).map((i) => i.key).sort());
    expect(bell[0].tone).toBe('crit');
  });

  it('caps a long list and counts the rest', () => {
    const many = Array.from({ length: 20 }, (_, i) => alertItem(item({ title: `Case ${i}`, go: { view: 'cases', caseId: `c${i}` } })));
    const m = renderAlertEmail('urgent', many, { appUrl: null, today: TODAY });
    expect(m.text).toMatch(/dan 5 lagi/);
    expect(m.text.match(/^- \[SEGERA\]/gm)!.length).toBe(15);
  });
});
