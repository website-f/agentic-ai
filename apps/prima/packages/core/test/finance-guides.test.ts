import { describe, expect, it } from 'vitest';
import {
  FINANCE_GUIDE_CARD_SPECS,
  FIN_GUIDES,
  GROUP_EMPLOYER_ID,
  MemoryStore,
  PrimaService,
  finGuidesFor,
  finGuidesText,
  generateDataset,
  myt,
  type FinGuide,
} from '../src';

// Guide cards (Arisha main's review, 2 Nov 2026, section A): every card is bilingual and role-scoped, and the made-up
// example on each entry card is accepted by the real service, so the fields on the card are the fields Prima reads.
const TODAY = '2026-10-31';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const cm = ds.users.find((u) => u.id === 'u-cm-sasa')!;
  ds.users.push({ ...cm, id: 'u-cm-09', name: 'Company Manager 09 (mock)', companyIds: ['co-09'] });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
};
const card = (id: string) => FIN_GUIDES.find((g) => g.id === id)!;
const example = (g: FinGuide) => Object.fromEntries(g.fields.map((f) => [f.key, f.example]));

describe('Finance guide cards', () => {
  it('are in Bahasa Melayu and English, versioned, with a purpose, a place, sources, whom to ask and what shows it is done', () => {
    for (const g of FIN_GUIDES) {
      const texts = [
        g.title,
        g.purpose,
        g.where,
        g.done,
        ...g.sources,
        ...g.ask,
        ...g.reused,
        ...g.steps,
        ...g.recover,
        ...g.fields.flatMap((f) => [f.label, f.format]),
      ];
      for (const t of texts) expect([g.id, t.ms.length > 2, t.en.length > 2]).toEqual([g.id, true, true]);
      expect(g.version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
      expect(g.sources.length && g.ask.length && g.steps.length).toBeTruthy();
      // Contacts are roles, never invented personal names or e-mail addresses.
      expect(JSON.stringify(g.ask)).not.toMatch(/@|\bu-[a-z]/);
    }
    expect(JSON.stringify(card('fin.payment.release').notes)).toMatch(/not making the bank transfer/);
  });

  it("accept each entry card's example in the real service", async () => {
    const { svc } = fresh();
    const [de1, cm] = await Promise.all(['u-fin-t1-de1', 'u-cm-09'].map((id) => svc.user(id)));
    const p = await svc.finance.createPayment(de1, GROUP_EMPLOYER_ID, example(card('fin.payment.prepare')) as never);
    expect(p.status).toBe('prepared');
    const r = await svc.financeRequests.create(cm, 'co-09', example(card('fin.request.create')));
    expect(r.status).toBe('head_review');
    await expect(svc.financeControls.dailyCashAction(de1, 'co-09', 'add', example(card('fin.dailycash.list')))).rejects.toThrow(/Legacy/);
    expect(JSON.stringify(card('fin.dailycash.list'))).toContain('manual OM request');
  });

  it('are scoped to the role: staff see their own tasks, managers theirs, others none', async () => {
    const { svc } = fresh();
    const ids = async (u: string) => finGuidesFor(await svc.user(u)).map((g) => g.id);
    expect(await ids('u-fin-t1-de1')).toEqual(expect.arrayContaining(['fin.payment.prepare', 'fin.payment.release', 'fin.dailycash.list']));
    expect(await ids('u-fin-t1-de1')).not.toContain('fin.payment.approve');
    expect(await ids('u-fd')).toContain('fin.payment.approve');
    expect(await ids('u-fd')).not.toContain('fin.dailycash.collector');
    expect(await ids('u-coo')).toEqual(expect.arrayContaining(['fin.payment.approve', 'fin.dailycash.collector', 'fin.request.check']));
    expect(await ids('u-cm-09')).toEqual(['fin.request.create']);
    expect(await ids('u-ogm')).toEqual(['fin.request.check']);
    expect(await ids('u-pwvsb-hr')).toEqual([]);
    expect(await ids('u-guard-sasa-1')).toEqual([]);
    // Arisha gets the same list and nothing more.
    const text = finGuidesText(await svc.user('u-cm-09'), 'ms');
    expect(text).toMatch(/Buat permintaan bayaran/);
    expect(text).not.toMatch(/Lulus atau pulangkan bayaran|Rekod pelepasan/);
  });

  it('are also given in the shared guide-card shape (PR #56) with the same text and the same role check', async () => {
    const { svc } = fresh();
    expect(FINANCE_GUIDE_CARD_SPECS.map((c) => c.id)).toEqual(FIN_GUIDES.map((c) => c.id));
    for (const c of FINANCE_GUIDE_CARD_SPECS) {
      const f = card(c.id);
      expect([c.title, c.purpose, c.dept]).toEqual([{ bm: f.title.ms, en: f.title.en }, { bm: f.purpose.ms, en: f.purpose.en }, 'finance']);
      expect(c.fields?.map((x) => x.key)).toEqual(f.fields.map((x) => x.key));
      expect(JSON.stringify(c.sources)).not.toMatch(/@|\bu-[a-z]/);
    }
    // Shared guideCardProblems rule: every source names a desk from the hand-over map or whom to ask.
    const desks = ['finance', 'procurement', 'company_office'];
    const nobody = FINANCE_GUIDE_CARD_SPECS.flatMap((c) =>
      c.sources.filter((s) => (s.askDesk === null ? !s.askName?.trim() : !desks.includes(s.askDesk))).map(() => c.id),
    );
    expect(nobody).toEqual([]);
    for (const id of ['u-fin-t1-de1', 'u-fd', 'u-coo', 'u-cm-09', 'u-ogm', 'u-pwvsb-hr', 'u-guard-sasa-1']) {
      const u = await svc.user(id);
      expect([id, FINANCE_GUIDE_CARD_SPECS.filter((c) => c.allowed(u)).map((c) => c.id)]).toEqual([id, finGuidesFor(u).map((c) => c.id)]);
    }
  });
});
