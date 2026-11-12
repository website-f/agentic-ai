import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, RULES, addDays, generateDataset, myt, noticeWeeks, resignAddMonths, resignationNotice, resignationProcedure, serviceYears } from '../src';

// E10 Staff resignation (Fauzan, 11 Nov 2026). Synthetic data only: the generated mock dataset.
const TODAY = '2026-11-12';
const NOW = myt(TODAY, '10:30');

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => NOW) };
}

describe('E10 notice period', () => {
  it('is 1 month under 1 year of service and 3 months for 1 year or more (rule HR-RESIGN-NOTICE)', () => {
    expect(RULES.resignationNotice.value).toEqual({ underOneYearMonths: 1, oneYearOrMoreMonths: 3 });
    expect(resignationNotice('2026-06-01', TODAY)).toMatchObject({ months: 1, earliestLastDay: '2026-12-12' });
    expect(resignationNotice('2020-01-01', TODAY)).toMatchObject({ months: 3, earliestLastDay: '2027-02-12' });
    expect(resignAddMonths('2027-01-31', 1)).toBe('2027-02-28');
  });

  it('is never shorter than Employment Act s.12 for any length of service', () => {
    for (let days = 0; days <= 365 * 30; days += 17) {
      const hired = addDays(TODAY, -days);
      for (const on of [TODAY, '2027-01-31', '2027-02-01', '2028-02-29']) {
        const n = resignationNotice(hired, on);
        const act = addDays(on, noticeWeeks(serviceYears(hired, on)) * 7);
        expect(n.earliestLastDay >= act).toBe(true);
        expect(n.earliestLastDay >= n.byCompany).toBe(true);
      }
    }
  });

  it('writes the procedure in English and Malay with the approved numbers', () => {
    const p = resignationProcedure();
    expect(p.en.body).toMatch(/1 month if you have worked here less than 1 year; 3 months if you have worked here 1 year or more/);
    expect(p.ms.body).toMatch(/1 bulan jika anda bekerja di sini kurang daripada 1 tahun; 3 bulan/);
    expect(p.en.body).toMatch(/section 12/);
    expect(p.ms.body).toMatch(/seksyen 12/);
  });
});

describe('E10 resignation steps', () => {
  it('the staff member gives notice; HR accepts with a comment and the last day goes on the staff record', async () => {
    const { svc, store } = fresh();
    const me = await svc.user('u-ae-arsh');
    const hr = await svc.user('u-pwvsb-hr');
    const mine = await svc.resignations.mine(me);
    expect(mine.allowed).toBe(true);
    const r = await svc.resignations.act(me, 'submit', { reason: 'Moving to another state (test)' });
    expect(r.status).toBe('submitted');
    expect(r.askedLastDay).toBe(mine.notice!.earliestLastDay);
    await expect(svc.resignations.act(me, 'submit', {})).rejects.toThrow(/already on record/);
    // Wrong roles: the staff member cannot accept their own; a company manager is not HR.
    await expect(svc.resignations.act(me, 'accept', { id: r.id, note: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.resignations.act(await svc.user('u-cm-arsh'), 'accept', { id: r.id, note: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.resignations.act(hr, 'accept', { id: r.id, note: '' })).rejects.toThrow(/comment/);
    const home = await svc.resignations.homeItems(hr);
    expect(home.some((h) => /resignation\(s\) to accept/.test(h.title))).toBe(true);
    const ok = await svc.resignations.act(hr, 'accept', { id: r.id, note: 'Handover plan agreed with the head' });
    expect(ok.status).toBe('accepted');
    const p = await store.get('people', me.personId!);
    expect(p!.leaving).toMatchObject({ kind: 'resigned', noticeOn: TODAY, lastDayOn: r.earliestLastDay });
    await expect(svc.resignations.act(me, 'withdraw', { id: r.id })).rejects.toThrow(/speak to HR/);
  });

  it('a shorter notice waits for the HR Director, never the staff member or the HR person who asked', async () => {
    const { svc, store } = fresh();
    const me = await svc.user('u-ae-arsh');
    const hr = await svc.user('u-pwvsb-hr');
    const cos = await svc.user('u-cos');
    const r = await svc.resignations.act(me, 'submit', { lastDayOn: addDays(TODAY, 10) });
    await expect(svc.resignations.act(hr, 'accept', { id: r.id, note: 'Early leave', lastDayOn: addDays(TODAY, 10) })).rejects.toThrow(/shorter notice/);
    const w = await svc.resignations.act(hr, 'accept', { id: r.id, note: 'Staff asked to leave early', lastDayOn: addDays(TODAY, 10), shortReason: 'Joining a family business; head agrees (test)' });
    expect(w.status).toBe('waiver_waiting');
    expect((await store.get('people', me.personId!))!.leaving ?? null).toBeNull();
    await expect(svc.resignations.act(hr, 'waiver_decide', { id: r.id, approve: true, note: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.resignations.act(cos, 'waiver_decide', { id: r.id, approve: true, note: '' })).rejects.toThrow(/comment/);
    const agreed = await svc.resignations.act(cos, 'waiver_decide', { id: r.id, approve: true, note: 'Agreed; no pay in place of notice' });
    expect(agreed.status).toBe('accepted');
    expect((await store.get('people', me.personId!))!.leaving!.lastDayOn).toBe(addDays(TODAY, 10));
  });

  it('HR enters a signed letter only with the letter; guards are not on this procedure; a refused waiver goes back to HR', async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const cos = await svc.user('u-cos');
    const staff = ds.people.find((p) => p.role === 'office' && p.status === 'active' && !p.leaving && p.companyId === 'co-sasa')!;
    await expect(svc.resignations.act(hr, 'submit', { personId: staff.id })).rejects.toThrow(/signed resignation letter/);
    const letter = { kind: 'document' as const, name: 'Letter.pdf', data: `data:application/pdf;base64,${Buffer.from('%PDF-1.4 resign').toString('base64')}` };
    const r = await svc.resignations.act(hr, 'submit', { personId: staff.id, noticeOn: addDays(TODAY, -2), lastDayOn: addDays(TODAY, 5), proof: [letter] });
    expect(r.given.byStaff).toBe(false);
    const guard = ds.people.find((p) => p.role === 'guard' && p.status === 'active')!;
    await expect(svc.resignations.act(hr, 'submit', { personId: guard.id, proof: [letter] })).rejects.toThrow(/office staff/);
    await svc.resignations.act(await svc.user('u-dcos'), 'accept', { id: r.id, note: 'Short', lastDayOn: addDays(TODAY, 5), shortReason: 'Health reasons (test)' });
    const back = await svc.resignations.act(cos, 'waiver_decide', { id: r.id, approve: false, note: 'Full notice needed for the handover' });
    expect(back.status).toBe('submitted');
  });
});
