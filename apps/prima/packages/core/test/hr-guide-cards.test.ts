import { describe, expect, it } from 'vitest';
import { AccessDenied, BadRequest, HR_GUIDE_CARDS, NotFound, HR_GUIDE_CHECKED_AGAINST, MemoryStore, PrimaService, RECORD_KINDS, generateDataset, hasOwnStaffRecord, hrGuideCardsFor } from '../src';

const TODAY = '2026-11-02';
const NOW = '2026-11-02T02:00:00.000Z';
const DESKS = new Set(['hr', 'it', 'finance', 'chief_of_staff', 'company_office', 'coo', 'ceo']);

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  let t = Date.parse(NOW);
  const svc = new PrimaService(new MemoryStore(ds), () => new Date((t += 1000)).toISOString());
  const user = (id: string) => ds.users.find((u) => u.id === id)!;
  return { ds, svc, user };
}

describe('HR guide cards in the shared guide-card shape (Arisha review, section A)', () => {
  it('every card has BM and English, says what is entered once, names a desk (never a person) and the method checked', () => {
    expect(HR_GUIDE_CARDS.length).toBe(15);
    for (const c of HR_GUIDE_CARDS) {
      const texts = [c.title, c.purpose, c.who, c.screen.action, c.enteredOnce, ...Object.values(c.steps), ...c.sources.map((s) => s.what), ...c.notVerified];
      for (const x of texts) {
        expect(x.bm.trim(), c.id).not.toBe('');
        expect(x.en.trim(), c.id).not.toBe('');
      }
      expect(c.enteredOnce.en.length, c.id).toBeGreaterThanOrEqual(20);
      expect(c.sources.length, c.id).toBeGreaterThan(0);
      for (const s of c.sources) expect(s.askDesk ? DESKS.has(s.askDesk) : !!s.askName?.trim(), c.id).toBe(true);
      expect(HR_GUIDE_CHECKED_AGAINST[c.id], c.id).toBeTruthy();
      expect(JSON.stringify(c).toLowerCase(), c.id).not.toMatch(/password:|enter your (password|mfa)/);
    }
  });

  it('the new staff card uses the real Office staff form fields only', () => {
    const c = HR_GUIDE_CARDS.find((x) => x.id === 'hr.new-staff')!;
    const real = new Set(RECORD_KINDS.officeStaff.fields.map((f) => f.key));
    expect(c.fields!.length).toBe(real.size);
    for (const f of c.fields!) expect(real.has(f.key)).toBe(true);
  });

  it('shows a task only to people the server lets start it; a system feed gets none', async () => {
    const { ds, svc, user } = fresh();
    const ids = (u: Parameters<typeof hrGuideCardsFor>[0]) => hrGuideCardsFor(u).map((c) => c.id);
    const hr = user('u-pwvsb-hr');
    const cm = user('u-cm-sasa');
    const ceo = user('u-fauzan');
    const feed = user('u-ja-sync');
    const staff = ds.users.find((u) => !u.integration && u.role === 'pwvsb_officer' && u.department === 'it' && hasOwnStaffRecord(u))!;
    expect(ids(hr)).toEqual(expect.arrayContaining(['hr.filings', 'hr.overtime', 'hr.new-staff', 'hr.leave-decide']));
    expect(ids(cm)).toEqual(expect.arrayContaining(['hr.vacancy', 'hr.guard-papers', 'hr.osh-incident']));
    expect(ids(cm)).not.toContain('hr.filings');
    expect(ids(cm)).not.toContain('hr.overtime');
    expect(ids(staff)).toEqual(expect.arrayContaining(['hr.leave-apply', 'hr.clock-in']));
    expect(ids(staff)).not.toContain('hr.filings');
    expect(ids(ceo)).toContain('hr.hr-case');
    expect(ids(feed)).toEqual([]);
    // The server agrees: someone without the filing or overtime card is refused by the action itself.
    await expect(svc.recordHrFiling(cm, { kind: 'CP22' as never, companyId: cm.companyIds[0], personId: null, period: '2026-11', ref: 'TEST-1', filedOn: TODAY })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setStaffOvertime(staff, { enabled: true, normal: 1.5, restDay: 2, publicHoliday: 3, personIds: [], comment: 'test only' })).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('Arisha review at 5a1eeb8 (3 Nov 2026)', () => {
  it('staff payroll guidance follows the payroll rule: an ordinary Finance officer whom the payroll refuses gets no card', async () => {
    const { ds, svc } = fresh();
    const base = ds.users.find((u) => u.id === 'u-pwvsb-hr')!;
    const officer = { ...base, id: 'u-fin-test', name: 'Finance Officer (test)', department: 'finance', financeTeam: null } as typeof base;
    const team = { ...officer, id: 'u-fin-team-test', financeTeam: 'payments' } as unknown as typeof base;
    const has = (u: typeof base) => hrGuideCardsFor(u).some((c) => c.id === 'hr.staff-payroll');
    expect(has(officer)).toBe(false);
    await expect(svc.staffPayRun(officer, 'any')).rejects.toBeInstanceOf(AccessDenied);
    expect(has(team)).toBe(true);
    expect(has(base)).toBe(true);
    expect(has(ds.users.find((u) => u.id === 'u-cm-sasa')!)).toBe(false);
  });

  it('correcting a refused sick leave reuses its clinic, illness, MC number and MC documents, once, for the staff member only', async () => {
    const { ds, svc } = fresh();
    const me = ds.users.find((u) => u.department === 'it' && u.personId)!;
    const other = ds.users.find((u) => u.department === 'it' && u.personId && u.id !== me.id)!;
    const hr = ds.users.find((u) => u.id === 'u-pwvsb-hr')!;
    const doc = { kind: 'document' as const, name: 'mc-test.pdf', data: 'data:application/pdf;base64,JVBERi0xLjQK' };
    const mc = { kind: 'SICK' as const, from: TODAY, to: TODAY, reason: 'Demam (sintetik)', illness: 'Demam', clinic: 'Klinik Ujian', mcNo: 'KU-0001' };
    const first = (await svc.requestLeave(me, { personId: me.personId!, ...mc, proof: [doc] })) as { id: string; proofIds: string[] };
    // Pending: nothing to correct yet.
    await expect(svc.requestLeave(me, { personId: me.personId!, ...mc, correctsId: first.id })).rejects.toBeInstanceOf(BadRequest);
    await svc.decideLeave(hr, first.id, false, 'Tarikh salah (synthetic)');
    // Someone else cannot carry this MC into their own request.
    await expect(svc.requestLeave(other, { personId: other.personId!, ...mc, correctsId: first.id })).rejects.toBeInstanceOf(NotFound);
    const again = (await svc.requestLeave(me, { personId: me.personId!, ...mc, correctsId: first.id })) as { id: string; proofIds: string[]; mcNo: string; clinic: string; illness: string; correctsId: string };
    expect(again.proofIds).toEqual(first.proofIds);
    expect([again.mcNo, again.clinic, again.illness, again.correctsId]).toEqual(['KU-0001', 'Klinik Ujian', 'Demam', first.id]);
    // Only once: a second correction of the same refusal is refused.
    await expect(svc.requestLeave(me, { personId: me.personId!, ...mc, correctsId: first.id })).rejects.toThrow(/already corrected/);
  });
});
