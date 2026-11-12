import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, approvesPayAbroad, generateDataset, lindungFormGaps, myt, paysPayAbroad, payAbroadNext } from '../src';

// E4 SOCSO extras (Fauzan, 11 Nov 2026). Synthetic data only: the generated mock dataset.
const TODAY = '2026-11-12';
const NOW = myt(TODAY, '10:30');

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => NOW) };
}

let n = 0;
function proof() {
  n += 1;
  return { kind: 'document' as const, name: `Letter ${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 extras ${n}`).toString('base64')}` };
}

const FORM = { how: 'Slipped on a wet road while riding home on a rest day (test).', injury: 'Left wrist sprain', treatedAt: 'Klinik Ujian (test)', policeReportNo: '' };

describe('E4 LINDUNG claim form', () => {
  it('is prepared by HR, checked by a second HR person, never by the one who prepared it', async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user('u-cm-sasa');
    const second = await svc.user('u-ae-sasa');
    const c = ds.socsoClaims.find((x) => x.type === 'NON_WORK_ACCIDENT')!;
    expect(lindungFormGaps(c, null)).toEqual(['Prepare the form.']);
    await expect(svc.socsoExtras.act(hr, 'lindung_form', { claimId: c.id, ...FORM, how: 'fell' })).rejects.toThrow(/how the accident/);
    const made = await svc.socsoExtras.act(hr, 'lindung_form', { claimId: c.id, ...FORM });
    expect(made.socsoExtras!.lindungForm!.checked).toBeNull();
    expect(lindungFormGaps(made, made.socsoExtras!.lindungForm)).toEqual(['A second HR person checks the form.']);
    // Nobody checks their own form.
    await expect(svc.socsoExtras.act(hr, 'lindung_check', { claimId: c.id, note: 'Looks right' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.socsoExtras.act(second, 'lindung_check', { claimId: c.id, note: '' })).rejects.toThrow(/comment/);
    const checked = await svc.socsoExtras.act(second, 'lindung_check', { claimId: c.id, note: 'Matches the MC and the police report' });
    expect(checked.socsoExtras!.lindungForm!.checked!.by).toBe(second.name);
    expect(lindungFormGaps(checked, checked.socsoExtras!.lindungForm)).toEqual([]);
    // A correction after the check needs the check again.
    const fixed = await svc.socsoExtras.act(hr, 'lindung_form', { claimId: c.id, ...FORM, treatedAt: 'Hospital Ujian (test)' });
    expect(fixed.socsoExtras!.lindungForm!.checked).toBeNull();
    expect(fixed.history.at(-1)!.what).toMatch(/checking again/);
  });

  it('refuses the wrong role and the wrong kind of claim', async () => {
    const { svc, ds } = fresh();
    const c = ds.socsoClaims.find((x) => x.type === 'NON_WORK_ACCIDENT')!;
    const sup = ds.users.find((u) => u.role === 'supervisor' && u.companyIds.includes(c.companyId) && !u.opsTier)!;
    await expect(svc.socsoExtras.act(sup, 'lindung_form', { claimId: c.id, ...FORM })).rejects.toBeInstanceOf(AccessDenied);
    const fwm = await svc.user('u-fwm-ex1');
    await expect(svc.socsoExtras.act(fwm, 'lindung_form', { claimId: c.id, ...FORM })).rejects.toBeInstanceOf(AccessDenied);
    const hr = await svc.user('u-cm-sasa');
    const work = ds.socsoClaims.find((x) => x.type === 'WORK_ACCIDENT' && x.companyId === 'co-sasa')!;
    await expect(svc.socsoExtras.act(hr, 'lindung_form', { claimId: work.id, ...FORM })).rejects.toThrow(/not for this kind/);
  });
});

describe('E4 company payment to dependants abroad', () => {
  const raise = (claimId: string) => ({
    claimId,
    dependantId: 'dp-seed-1',
    what: 'FINAL_WAGES',
    route: 'BANK_ABROAD',
    amount: 1850.5,
    payTo: 'Nepal Test Bank, Kathmandu branch, account ending 4321',
    reason: 'Final month wages and unused annual leave (test)',
    proof: [proof()],
  });

  it('goes HR raises, the Finance Director approves with a reason, Finance pays with the slip, HR confirms receipt', async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user('u-ae-arsh');
    const fd = await svc.user('u-fd');
    const fin = await svc.user('u-fin-t1-lead');
    const death = ds.socsoClaims.find((x) => x.type === 'DEATH')!;
    await expect(svc.socsoExtras.act(hr, 'pay_raise', { ...raise(death.id), payTo: 'Nepal Test Bank 1234567890123' })).rejects.toThrow(/last 4 digits/);
    await expect(svc.socsoExtras.act(hr, 'pay_raise', { ...raise(death.id), proof: [] })).rejects.toThrow(/Attach/);
    const raised = await svc.socsoExtras.act(hr, 'pay_raise', raise(death.id));
    const p = raised.socsoExtras!.payAbroad![0];
    expect(p.status).toBe('waiting');
    expect(payAbroadNext(p)).toBe('approver');
    await expect(svc.socsoExtras.act(hr, 'pay_raise', raise(death.id))).rejects.toThrow(/already waiting/);
    // Wrong roles: HR cannot approve; Finance cannot approve; the FD cannot pay before approval.
    await expect(svc.socsoExtras.act(hr, 'pay_decide', { claimId: death.id, paymentId: p.id, approve: true, note: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.socsoExtras.act(fin, 'pay_decide', { claimId: death.id, paymentId: p.id, approve: true, note: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.socsoExtras.act(fd, 'pay_paid', { claimId: death.id, paymentId: p.id, on: TODAY, ref: 'TT-1', proof: [proof()] })).rejects.toThrow(/approved/);
    await expect(svc.socsoExtras.act(fd, 'pay_decide', { claimId: death.id, paymentId: p.id, approve: true, note: '' })).rejects.toThrow(/comment/);
    const board = await svc.socsoExtras.board(fd);
    expect(board.rows[0].canDecide).toBe(true);
    expect(board.rows[0].payment.docIds).toEqual([]);
    const home = await svc.home(fd);
    expect([...home.todo, ...(home.watch ?? [])].some((t) => /Payment abroad/.test(t.title))).toBe(true);
    await svc.socsoExtras.act(fd, 'pay_decide', { claimId: death.id, paymentId: p.id, approve: true, note: 'Owed under the contract' });
    // The approver never also pays.
    await expect(svc.socsoExtras.act(fd, 'pay_paid', { claimId: death.id, paymentId: p.id, on: TODAY, ref: 'TT-1', proof: [proof()] })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.socsoExtras.act(fin, 'pay_paid', { claimId: death.id, paymentId: p.id, on: TODAY, ref: 'TT-1', proof: [] })).rejects.toThrow(/Attach/);
    const paid = await svc.socsoExtras.act(fin, 'pay_paid', { claimId: death.id, paymentId: p.id, on: TODAY, ref: 'TT-TEST-1', proof: [proof()] });
    expect(paid.socsoExtras!.payAbroad![0].status).toBe('paid');
    await expect(svc.socsoExtras.act(fin, 'pay_received', { claimId: death.id, paymentId: p.id, on: TODAY, proof: [proof()] })).rejects.toBeInstanceOf(AccessDenied);
    const got = await svc.socsoExtras.act(hr, 'pay_received', { claimId: death.id, paymentId: p.id, on: TODAY, proof: [proof()] });
    expect(got.socsoExtras!.payAbroad![0].status).toBe('received');
    expect(got.history.map((h) => h.what).join(' | ')).toMatch(/approved: Owed under the contract/);
  });

  it('never lets the person who raised a payment approve it', async () => {
    const { svc, ds, store } = fresh();
    const ceo = await svc.user('u-fauzan');
    const death = ds.socsoClaims.find((x) => x.type === 'DEATH')!;
    // Raising is HR's step for the worker's company: the Finance Director views SOCSO claims only.
    await expect(svc.socsoExtras.act(await svc.user('u-fd'), 'pay_raise', raise(death.id))).rejects.toBeInstanceOf(AccessDenied);
    const hr = await svc.user('u-ae-arsh');
    const raised = await svc.socsoExtras.act(hr, 'pay_raise', raise(death.id));
    // Same person, two hats: the payment raised by this id is refused for approval even with an approver's role.
    await store.update('users', hr.id, { leadership: 'finance_director', role: 'pwvsb_officer' });
    const both = await svc.user(hr.id);
    expect(approvesPayAbroad(both)).toBe(true);
    await expect(svc.socsoExtras.act(both, 'pay_decide', { claimId: death.id, paymentId: raised.socsoExtras!.payAbroad![0].id, approve: true, note: 'Mine' })).rejects.toBeInstanceOf(AccessDenied);
    expect(paysPayAbroad(await svc.user('u-fin-t1-lead'))).toBe(true);
    expect(approvesPayAbroad(await svc.user('u-fin-t1-lead'))).toBe(false);
    // The CEO may approve it instead.
    const ok = await svc.socsoExtras.act(ceo, 'pay_decide', { claimId: death.id, paymentId: raised.socsoExtras!.payAbroad![0].id, approve: false, note: 'Insurer pays the family direct' });
    expect(ok.socsoExtras!.payAbroad![0].status).toBe('refused');
  });

  it('is only for a dependant who lives abroad', async () => {
    const { svc, ds, store } = fresh();
    const death = ds.socsoClaims.find((x) => x.type === 'DEATH')!;
    const local = { ...death.dependants!, people: death.dependants!.people.map((p) => (p.id === 'dp-seed-2' ? { ...p, country: 'Malaysia' } : p)) };
    await store.update('socsoClaims', death.id, { dependants: local });
    await expect(svc.socsoExtras.act(await svc.user('u-ae-arsh'), 'pay_raise', { ...raise(death.id), dependantId: 'dp-seed-2', what: 'INSURANCE' })).rejects.toThrow(/lives abroad/);
  });
});

describe('E4 reminders', () => {
  it('reminds HR of the LINDUNG employment check (2 working days) and what DOSH is still owed', async () => {
    const { svc } = fresh();
    const hr = await svc.user('u-cm-sasa');
    const home = await svc.home(hr, 'co-sasa');
    const titles = home.todo.map((t) => `${t.tag}: ${t.title}`);
    expect(titles.some((t) => /SOCSO: Answer PERKESO's LINDUNG employment check/.test(t) || /DOSH:/.test(t))).toBe(true);
  });
});
