// Guide cards: one role-scoped mapping for the screen and Arisha (Arisha review section A, 2 Nov 2026). Synthetic data.
import { describe, expect, it } from 'vitest';
import { GUIDE_VERSION, IMPORTABLE_KINDS, SERVER_FIELD_RULES, MemoryStore, arishaGuideView, guideCardsFor, withOrgLinks, PrimaService, RECORD_KINDS, allGuideCards, generateDataset, guideCardProblems, myt, registerGuideCards } from '../src';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');
function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  return { ds, svc, user: (id: string) => ds.users.find((u) => u.id === id)! };
}

describe('guide cards', () => {
  it('every card has BM and English, says what is entered once, names a source and whom to ask, and invents no field', () => {
    const cards = allGuideCards();
    expect(cards.length).toBeGreaterThanOrEqual(Object.keys(RECORD_KINDS).length + 2);
    expect(cards.flatMap(guideCardProblems)).toEqual([]);
    for (const c of cards) expect(c.version).toBe(GUIDE_VERSION);
  });

  it('shows a record card only to people the server lets keep that record, and nothing to a system feed', async () => {
    const { ds, svc, user } = fresh();
    for (const u of ds.users.filter((x) => !x.integration).slice(0, 40)) {
      const kinds = new Set(svc.recordKindsFor(u));
      const recordCards = svc.guideCards(u).cards.filter((c) => c.id.startsWith('record.'));
      expect(recordCards.map((c) => c.id.slice(7)).sort()).toEqual([...kinds].sort());
    }
    for (const f of ds.users.filter((x) => x.integration)) expect(svc.guideCards(f).cards).toEqual([]);
    const itCards = svc.guideCards(user('u-it-mgr')).cards.map((c) => c.id);
    const hrCards = svc.guideCards(user('u-pwvsb-hr')).cards.map((c) => c.id);
    expect(itCards).toContain('record.itDomain');
    expect(hrCards).not.toContain('record.itDomain');
  });

  it('takes the fields from the real form and tells who receives the record automatically', () => {
    const staff = allGuideCards().find((c) => c.id === 'record.officeStaff')!;
    expect(staff.fields.map((f) => f.key)).toEqual(RECORD_KINDS.officeStaff.fields.map((f) => f.key));
    expect(staff.feeds.map((f) => f.desk)).toContain('IT');
    // Restricted fields never carry an example value.
    for (const f of RECORD_KINDS.officeStaff.fields.filter((x) => x.restricted)) expect(staff.fields.find((g) => g.key === f.key)!.example).toMatch(/no example/);
    // A form whose note names a check step never claims "no reviewer" (office staff pay waits for the HR Director).
    expect(staff.steps.review.en).toMatch(/Chief of Staff or Deputy/);
    for (const c of allGuideCards().filter((x) => x.id.startsWith('record.'))) {
      const note = RECORD_KINDS[c.id.slice(7) as keyof typeof RECORD_KINDS].note;
      if (note) expect(c.steps.review.en).toContain(note);
    }
    const domain = allGuideCards().find((c) => c.id === 'record.itDomain')!;
    expect(domain.enteredOnce.en).toMatch(/Import/);
  });

  it('says what the server adds beyond the form marks, and each rule is real (refused when broken)', async () => {
    const { svc, user } = fresh();
    const hr = user('u-pwvsb-hr');
    const card = allGuideCards().find((c) => c.id === 'record.officeStaff')!;
    expect(card.fields.find((f) => f.key === 'idFull')!.rule?.en).toMatch(/Needed when adding/);
    const ok = { staffNo: 'SYN-G1', name: 'Synthetic Guide', jobTitle: 'Admin Executive', branchId: 'br-pwvsb-hq', employmentType: 'permanent', hiredOn: '2026-11-01', nationality: 'MY', idFull: '900101011234', gender: 'F', dob: '1990-01-01', phone: '012-345 6789', basicPay: 3000, payReason: 'Offer letter', status: 'active' };
    const broken: Record<string, Record<string, unknown>> = {
      idFull: { idFull: '' },
      email: { email: 'not-an-email' },
      phone: { phone: 'call me' },
      emergencyPhone: { emergencyPhone: 'call me' },
      probationEndsOn: { employmentType: 'probation' },
      contractEndsOn: { employmentType: 'contract' },
      branchId: { branchId: 'br-does-not-exist' },
    };
    expect(Object.keys(broken).sort()).toEqual(Object.keys(SERVER_FIELD_RULES.officeStaff!).sort());
    for (const [k, change] of Object.entries(broken))
      await expect(svc.saveRecord(hr, 'officeStaff', null, 'pwvsb', { ...ok, staffNo: `SYN-G-${k}`, ...change } as never), k).rejects.toThrow();
    await expect(svc.saveRecord(hr, 'officeStaff', null, 'pwvsb', ok as never)).resolves.toBeTruthy();
  });

  it('refuses a second, different card under an id already used', () => {
    const card = { ...allGuideCards()[0], id: 'test.once', allowed: () => true, sources: [{ what: { bm: 'x', en: 'x' }, askDesk: 'it' as const }] };
    registerGuideCards([card as never]);
    registerGuideCards([card as never]);
    expect(() => registerGuideCards([{ ...card } as never])).toThrow(/already registered/);
  });

  it('shows the import card only to someone who may add an importable kind', () => {
    const { ds, svc } = fresh();
    for (const u of ds.users.filter((x) => !x.integration).slice(0, 60)) {
      const may = svc.recordKindsFor(u).some((k) => (IMPORTABLE_KINDS as readonly string[]).includes(k));
      expect({ id: u.id, shown: svc.guideCards(u).cards.some((c) => c.id === 'org.import') }).toEqual({ id: u.id, shown: may });
    }
    const someone = ds.users.find((x) => !x.integration)!;
    expect(guideCardsFor(someone, []).cards.map((c) => c.id)).not.toContain('org.import');
  });

  it('says whether hand-overs are switched on in this environment', () => {
    const { ds } = fresh();
    const off = new PrimaService(new MemoryStore(ds), () => NOW);
    const on = new PrimaService(withOrgLinks(new MemoryStore(ds)), () => NOW);
    const u = ds.users.find((x) => x.id === 'u-it-mgr')!;
    const card = (svc: PrimaService) => svc.guideCards(u).cards.find((c) => c.id === 'org.handover.close')!;
    expect(off.guideCards(u).handovers).toBe('off');
    expect(card(off).status).toBe('off');
    expect(card(off).notVerified[0].en).toMatch(/switched off here/);
    expect(on.guideCards(u).handovers).toBe('on');
    expect(card(on).status).toBe('ready');
  });

  it('never promises a hand-over or an import that this environment would not do (review of 9092c89)', async () => {
    const { ds } = fresh();
    const off = new PrimaService(new MemoryStore(ds), () => NOW);
    const on = new PrimaService(withOrgLinks(new MemoryStore(ds)), () => NOW);
    const hr = ds.users.find((x) => x.id === 'u-pwvsb-hr')!;
    const staff = (svc: PrimaService) => svc.guideCards(hr).cards.find((c) => c.id === 'record.officeStaff')!;
    // On: the joiner card says which desks get it. Off: it names none and says so.
    expect(staff(on).feeds.length).toBeGreaterThan(0);
    expect(staff(off).feeds).toEqual([]);
    expect(staff(off).notVerified[0].en).toMatch(/not told automatically/);
    for (const c of off.guideCards(hr).cards) expect({ id: c.id, feeds: c.feeds }).toEqual({ id: c.id, feeds: [] });
    // Import follows the same switch: the card says off and the service refuses, so the two always agree.
    const imp = off.guideCards(hr).cards.find((c) => c.id === 'org.import')!;
    expect(imp.status).toBe('off');
    await expect(off.orgImport.preview(hr, 'officeStaff', 'pwvsb', 'staffNo,name\n')).rejects.toThrow(/switched off/);
    await expect(off.orgImport.commit(hr, 'officeStaff', 'pwvsb', 'staffNo,name\n', 'a'.repeat(64))).rejects.toThrow(/switched off/);
    expect(on.guideCards(hr).cards.find((c) => c.id === 'org.import')!.status).toBe('ready');
  });

  it("Arisha's task_guide reads exactly the person's cards from the same call", () => {
    const { ds, svc } = fresh();
    for (const u of ds.users.filter((x) => !x.integration).slice(0, 40)) {
      const screen = svc.guideCards(u);
      const arisha = svc.arishaGuide(u);
      expect(arisha.version).toBe(screen.version);
      expect(arisha.handovers).toBe(screen.handovers);
      expect(arisha.cards.map((c) => c.id)).toEqual(screen.cards.map((c) => c.id));
      expect(arisha).toEqual(arishaGuideView(screen));
      for (const c of arisha.cards) expect(c.fields.map((f) => f.key)).toEqual(screen.cards.find((x) => x.id === c.id)!.fields.map((f) => f.key));
    }
    const u = ds.users.find((x) => x.id === 'u-it-mgr')!;
    expect(svc.arishaGuide(u, 'record.itDomain').cards.map((c) => c.id)).toEqual(['record.itDomain']);
    expect(svc.arishaGuide(u, 'record.officeStaff').cards).toEqual([]);
    for (const f of ds.users.filter((x) => x.integration)) expect(svc.arishaGuide(f).cards).toEqual([]);
  });
});
