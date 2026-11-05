import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, RULES, addDays, agencyScorecard, generateDataset, myt } from '../src';

// Responsible recruitment and worker welfare (masterplan §240): FWM asks each new foreign worker privately what they
// paid to get the job, checks who holds the passport and has a regular welfare talk. Fauzan approved building every
// remaining masterplan item on 3 Nov 2026. Dummy data only.
const TODAY = '2026-11-03';
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:00') });
  const svc = new PrimaService(new MemoryStore(ds), () => myt(TODAY, '10:00'));
  const np = ds.people.find((p) => p.companyId === 'co-sasa' && p.nationality === 'NP' && p.role === 'guard' && p.status !== 'left')!;
  const my = ds.people.find((p) => p.companyId === 'co-sasa' && p.nationality === 'MY' && p.status !== 'left')!;
  return { ds, svc, np, my };
};
const pdf = (name: string) => ({ kind: 'document' as const, name, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 ${name}`).toString('base64')}` });

describe('Arrival fee check and agency scorecard', () => {
  it('records no fee as clear, once per worker', async () => {
    const { svc, np } = fresh();
    const fwm = await svc.user('u-fwm-ex1');
    const c = await svc.recordFwCheck(fwm, np.id, { kind: 'ARRIVAL_FEE', checkedOn: TODAY, agency: 'UAT Agency One', paidAnything: false }, []);
    expect(c.status).toBe('clear');
    await expect(svc.recordFwCheck(fwm, np.id, { kind: 'ARRIVAL_FEE', checkedOn: TODAY, agency: 'UAT Agency One', paidAnything: false }, [])).rejects.toThrow(/already on record/);
    const board = await svc.fwmWelfare(fwm);
    expect(board.workers.find((w) => w.person.id === np.id)!.feeDue).toBe(false);
  });

  it('opens a follow-up when a fee is found; someone else closes it once the agency pays the worker back', async () => {
    const { svc, np, ds } = fresh();
    const fwm = await svc.user('u-fwm-ex1');
    await expect(svc.recordFwCheck(fwm, np.id, { kind: 'ARRIVAL_FEE', checkedOn: TODAY, agency: 'UAT Agency Two', paidAnything: true, amount: 0, paidTo: 'Broker' }, [])).rejects.toThrow(/amount/);
    await expect(svc.recordFwCheck(fwm, np.id, { kind: 'ARRIVAL_FEE', checkedOn: TODAY, agency: 'UAT Agency Two', paidAnything: true, amount: 4000, paidTo: '' }, [])).rejects.toThrow(/who the worker paid/);
    const c = await svc.recordFwCheck(fwm, np.id, { kind: 'ARRIVAL_FEE', checkedOn: TODAY, agency: 'UAT Agency Two', paidAnything: true, amount: 4000, paidTo: 'UAT broker in Kathmandu' }, []);
    expect(c.status).toBe('open');
    // The audit entry says a check was done; it is kept at group level and names no amount, agency or broker.
    expect(ds.audit.at(-1)!).toMatchObject({ companyId: null });
    expect(ds.audit.at(-1)!.summary).not.toMatch(/4000|broker|Agency Two/i);
    // Nobody closes a follow-up they opened.
    await expect(svc.closeFwCheck(fwm, c.id, { note: 'Agency paid it back.', repaid: 4000 }, [pdf('slip.pdf')])).rejects.toThrow(/Nobody closes/);
    const other = await svc.user('u-fwm-mgr');
    await expect(svc.closeFwCheck(other, c.id, { note: 'Agency paid it back.', repaid: 5000 }, [pdf('slip.pdf')])).rejects.toThrow(/RM0 to RM4000/);
    await expect(svc.closeFwCheck(other, c.id, { note: 'Agency paid it back.', repaid: 4000 }, [])).rejects.toThrow(/repayment slip/);
    const closed = await svc.closeFwCheck(other, c.id, { note: 'Agency paid it back in cash, worker signed.', repaid: 4000 }, [pdf('uat-repayment-slip.pdf')]);
    expect(closed).toMatchObject({ status: 'closed', repaid: 4000, closedBy: other.name });
    await expect(svc.closeFwCheck(other, c.id, { note: 'Again', repaid: 0 }, [])).rejects.toThrow(/not open/);
    const score = (await svc.fwmWelfare(other)).agencies.find((a) => a.agency === 'UAT Agency Two')!;
    expect(score).toMatchObject({ checked: 1, feesFound: 1, paid: 4000, repaid: 4000, open: 0 });
  });

  it('scores agencies ignoring case and spaces, worst first', () => {
    const base = { companyId: 'c', personId: 'p', checkedOn: TODAY, note: '', docIds: [], by: 'x', byId: 'x', at: '', closeNote: null, closedBy: null, closedById: null, closedAt: null };
    const rows = agencyScorecard([
      { ...base, id: '1', kind: 'ARRIVAL_FEE', agency: 'Good Agency', paidAnything: false, status: 'clear' },
      { ...base, id: '2', kind: 'ARRIVAL_FEE', agency: 'bad  agency', paidAnything: true, amount: 3000, status: 'open' },
      { ...base, id: '3', kind: 'ARRIVAL_FEE', agency: 'Bad Agency', paidAnything: true, amount: 2000, repaid: 2000, status: 'closed' },
      { ...base, id: '4', kind: 'WELFARE', concerns: [], status: 'clear' },
    ]);
    expect(rows.map((r) => [r.agency, r.checked, r.feesFound, r.paid, r.repaid, r.open])).toEqual([
      ['bad  agency', 2, 2, 5000, 2000, 1],
      ['Good Agency', 1, 0, 0, 0, 0],
    ]);
  });
});

describe('Passport custody and welfare talks', () => {
  it('passport with the worker is clear; with the company it needs signed consent, or a follow-up opens', async () => {
    const { svc, np } = fresh();
    const fwm = await svc.user('u-fwm-ex2');
    expect((await svc.recordFwCheck(fwm, np.id, { kind: 'PASSPORT', checkedOn: TODAY, heldBy: 'worker' }, [])).status).toBe('clear');
    expect((await svc.recordFwCheck(fwm, np.id, { kind: 'PASSPORT', checkedOn: TODAY, heldBy: 'company' }, [pdf('uat-consent.pdf')])).status).toBe('clear');
    const held = await svc.recordFwCheck(fwm, np.id, { kind: 'PASSPORT', checkedOn: TODAY, heldBy: 'company', note: 'Kept in the site office drawer' }, []);
    expect(held.status).toBe('open');
    const mgr = await svc.user('u-fwm-mgr');
    let w = (await svc.fwmWelfare(mgr)).workers.find((x) => x.person.id === np.id)!;
    expect(w).toMatchObject({ passportHolder: 'company', passportConsented: false });
    // Closing needs a structured custody result and the matching paper (Arisha main review, 3 Nov 2026).
    await expect(svc.closeFwCheck(mgr, held.id, { note: 'Given back to the worker.' }, [pdf('uat-receipt.pdf')])).rejects.toThrow(/how it ended/);
    await expect(svc.closeFwCheck(mgr, held.id, { note: 'Given back to the worker.', custody: 'worker' }, [])).rejects.toThrow(/signed receipt/);
    expect((await svc.closeFwCheck(mgr, held.id, { note: 'Given back to the worker.', custody: 'worker' }, [pdf('uat-receipt.pdf')])).status).toBe('closed');
    const board = await svc.fwmWelfare(mgr);
    w = board.workers.find((x) => x.person.id === np.id)!;
    // Custody and the KPI now show the passport back with the worker.
    expect(w).toMatchObject({ passportHolder: 'worker', passportConsented: false });
    expect(board.workers.filter((x) => x.passportHolder === 'company')).toHaveLength(board.counts.passportWithCompany);
    expect(board.counts.passportNoConsent).toBe(0);
  });

  it('rule FWM-PASSPORT-CONSENT is the approved owner decision and keeps the legal flag', () => {
    expect(RULES.fwmPassportConsentDoc).toMatchObject({ id: 'FWM-PASSPORT-CONSENT', value: true });
    expect(RULES.fwmPassportConsentDoc.source).toMatch(/Approved by Fauzan, 3 Nov 2026/);
    expect(RULES.fwmPassportConsentDoc.source).toMatch(/does not read the document/);
  });

  it('a passport follow-up closed by signed consent leaves it with the company, consented', async () => {
    const { svc, np } = fresh();
    const held = await svc.recordFwCheck(await svc.user('u-fwm-ex2'), np.id, { kind: 'PASSPORT', checkedOn: TODAY, heldBy: 'company' }, []);
    const mgr = await svc.user('u-fwm-mgr');
    await expect(svc.closeFwCheck(mgr, held.id, { note: 'Consent signed by the worker.', custody: 'company' }, [])).rejects.toThrow(/consent the worker signed/);
    await svc.closeFwCheck(mgr, held.id, { note: 'Consent signed by the worker.', custody: 'company' }, [pdf('uat-consent.pdf')]);
    const board = await svc.fwmWelfare(mgr);
    expect(board.workers.find((x) => x.person.id === np.id)).toMatchObject({ passportHolder: 'company', passportConsented: true });
    expect(board.counts.passportNoConsent).toBe(0);
    // Custody belongs to passport follow-ups only.
    const talk = await svc.recordFwCheck(await svc.user('u-fwm-ex2'), np.id, { kind: 'WELFARE', checkedOn: TODAY, concerns: ['PAY'], note: 'UAT late pay' }, []);
    await expect(svc.closeFwCheck(mgr, talk.id, { note: 'Arrears paid.', custody: 'worker' }, [])).rejects.toThrow(/Only a passport/);
  });

  it('a concern needs the worker\'s words and opens a follow-up; the audit trail leaves the detail out', async () => {
    const { svc, np, ds } = fresh();
    const fwm = await svc.user('u-fwm-ex3');
    await expect(svc.recordFwCheck(fwm, np.id, { kind: 'WELFARE', checkedOn: TODAY, concerns: ['TREATMENT'] }, [])).rejects.toThrow(/what the worker raised/);
    const c = await svc.recordFwCheck(fwm, np.id, { kind: 'WELFARE', checkedOn: TODAY, concerns: ['TREATMENT', 'HOURS'], note: 'UAT supervisor shouts at night shift' }, []);
    expect(c.status).toBe('open');
    const audit = ds.audit.at(-1)!;
    expect(audit.companyId).toBeNull();
    expect(audit.summary).not.toMatch(/supervisor|Treatment|hours|concern/i);
    expect((await svc.recordFwCheck(fwm, np.id, { kind: 'WELFARE', checkedOn: TODAY, concerns: [] }, [])).status).toBe('clear');
  });

  it('shows checks as due when never done or older than the rule, and not due after a check today', async () => {
    const { svc, np } = fresh();
    const fwm = await svc.user('u-fwm-ex1');
    const before = (await svc.fwmWelfare(fwm)).workers.find((w) => w.person.id === np.id)!;
    expect(before).toMatchObject({ feeDue: true, passportDue: true, welfareDue: true, passportDaysSince: null });
    await svc.recordFwCheck(fwm, np.id, { kind: 'PASSPORT', checkedOn: addDays(TODAY, -95), heldBy: 'worker' }, []);
    await svc.recordFwCheck(fwm, np.id, { kind: 'WELFARE', checkedOn: TODAY, concerns: [] }, []);
    const after = (await svc.fwmWelfare(fwm)).workers.find((w) => w.person.id === np.id)!;
    expect(after).toMatchObject({ passportDue: true, passportDaysSince: 95, welfareDue: false, welfareDaysSince: 0 });
  });

  it('refuses impossible dates, a sub-sen amount and two fee checks pressed at once', async () => {
    const { svc, np, ds } = fresh();
    const fwm = await svc.user('u-fwm-ex1');
    for (const checkedOn of ['2026-02-30', '2026-13-01', '1999-12-31', '03/11/2026', '']) {
      await expect(svc.recordFwCheck(fwm, np.id, { kind: 'WELFARE', checkedOn, concerns: [] }, [])).rejects.toThrow(/today or earlier/);
    }
    for (const amount of [0.001, -5, Number.NaN, Infinity, 100_001]) {
      await expect(svc.recordFwCheck(fwm, np.id, { kind: 'ARRIVAL_FEE', checkedOn: TODAY, agency: 'UAT Agency', paidAnything: true, amount, paidTo: 'UAT broker' }, [])).rejects.toThrow(/amount/);
    }
    await expect(svc.recordFwCheck(fwm, np.id, { kind: 'WELFARE', checkedOn: TODAY, concerns: ['NOPE' as never], note: 'something' }, [])).rejects.toThrow(/from the list/);
    await expect(svc.recordFwCheck(fwm, np.id, { kind: 'BOGUS' as never, checkedOn: TODAY }, [])).rejects.toThrow(/kind of check/);
    const mgr = await svc.user('u-fwm-mgr');
    const both = await Promise.allSettled([
      svc.recordFwCheck(fwm, np.id, { kind: 'ARRIVAL_FEE', checkedOn: TODAY, agency: 'UAT Agency', paidAnything: false }, []),
      svc.recordFwCheck(mgr, np.id, { kind: 'ARRIVAL_FEE', checkedOn: TODAY, agency: 'UAT Agency', paidAnything: true, amount: 100, paidTo: 'UAT broker' }, []),
    ]);
    expect(both.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(ds.fwWelfareChecks.filter((c) => c.personId === np.id && c.kind === 'ARRIVAL_FEE')).toHaveLength(1);
  });

  it('refuses a Malaysian worker and a future date', async () => {
    const { svc, np, my } = fresh();
    const fwm = await svc.user('u-fwm-ex1');
    await expect(svc.recordFwCheck(fwm, my.id, { kind: 'WELFARE', checkedOn: TODAY, concerns: [] }, [])).rejects.toThrow(/foreign workers only/);
    await expect(svc.recordFwCheck(fwm, np.id, { kind: 'WELFARE', checkedOn: addDays(TODAY, 1), concerns: [] }, [])).rejects.toThrow(/today or earlier/);
  });
});

describe('History of past checks (Arisha main review, 3 Nov 2026)', () => {
  it('keeps an older concern and how each follow-up was closed, for FWM and the leaders only', async () => {
    const { svc, np } = fresh();
    const fwm = await svc.user('u-fwm-ex1');
    const old = await svc.recordFwCheck(fwm, np.id, { kind: 'WELFARE', checkedOn: addDays(TODAY, -40), concerns: ['HOUSING'], note: 'UAT hostel roof leaks' }, []);
    await svc.closeFwCheck(await svc.user('u-fwm-mgr'), old.id, { note: 'UAT roof fixed by the landlord.' }, [pdf('uat-roof.pdf')]);
    await svc.recordFwCheck(fwm, np.id, { kind: 'WELFARE', checkedOn: TODAY, concerns: [] }, []);
    const board = await svc.fwmWelfare(await svc.user('u-fwm-ex3'));
    const w = board.workers.find((x) => x.person.id === np.id)!;
    // The latest talk had no concern, but the older one is still in the history with its closing.
    expect(w.welfare!.concerns).toEqual([]);
    expect(w.history.map((c) => c.id)).toContain(old.id);
    expect(w.history.find((c) => c.id === old.id)).toMatchObject({ status: 'closed', closeNote: 'UAT roof fixed by the landlord.', closedBy: expect.any(String), note: 'UAT hostel roof leaks' });
    expect(board.closed.map((x) => x.check.id)).toEqual([old.id]);
    expect(await svc.fwmDocs(await svc.user('u-fwm-ex3'), old.id)).toHaveLength(1);
    expect((await svc.fwmWelfare(await svc.user('u-coo'))).closed).toHaveLength(1);
    // The company manager gets neither history nor closed cases.
    const cm = await svc.fwmWelfare(await svc.user('u-cm-sasa'));
    expect(cm.closed).toEqual([]);
    expect(cm.workers.every((x) => x.history.length === 0)).toBe(true);
    expect(JSON.stringify(cm)).not.toContain('roof');
  });
});

describe('Who sees and does what', () => {
  it('only FWM officers record; the despatch driver and the OM see nothing', async () => {
    const { svc, np } = fresh();
    for (const id of ['u-fwm-desp', 'u-om-klang']) {
      const u = await svc.user(id);
      await expect(svc.fwmWelfare(u)).rejects.toBeInstanceOf(AccessDenied);
      await expect(svc.recordFwCheck(u, np.id, { kind: 'WELFARE', checkedOn: TODAY, concerns: [] }, [])).rejects.toBeInstanceOf(AccessDenied);
    }
    await expect(svc.recordFwCheck(await svc.user('u-cm-sasa'), np.id, { kind: 'WELFARE', checkedOn: TODAY, concerns: [] }, [])).rejects.toBeInstanceOf(AccessDenied);
  });

  it('the company manager sees passport custody only, never fees or concerns, so nobody can tell who spoke up', async () => {
    const { svc, np } = fresh();
    const fwm = await svc.user('u-fwm-ex1');
    const fee = await svc.recordFwCheck(fwm, np.id, { kind: 'ARRIVAL_FEE', checkedOn: TODAY, agency: 'UAT Agency Three', paidAnything: true, amount: 8000, paidTo: 'UAT sub-agent' }, [pdf('uat-statement.pdf')]);
    const talk = await svc.recordFwCheck(fwm, np.id, { kind: 'WELFARE', checkedOn: TODAY, concerns: ['PAY'], note: 'UAT pay came late twice' }, []);
    const pass = await svc.recordFwCheck(fwm, np.id, { kind: 'PASSPORT', checkedOn: TODAY, heldBy: 'company', note: 'UAT kept in office' }, []);
    const cm = await svc.user('u-cm-sasa');
    const board = await svc.fwmWelfare(cm);
    expect(board.confidential).toBe(false);
    expect(board.agencies).toEqual([]);
    expect(board.counts.feesFound).toBeNull();
    expect(board.counts.open).toBe(1);
    const w = board.workers.find((x) => x.person.id === np.id)!;
    // Dates and due flags stay (the company plans the talks), but not the records themselves.
    expect(w).toMatchObject({ fee: null, welfare: null, feeDue: false, welfareDue: false, welfareDaysSince: 0, open: 1 });
    expect(w.passport).toMatchObject({ id: pass.id, heldBy: 'company', status: 'open', note: '' });
    expect(board.open.map((o) => o.check.id)).toEqual([pass.id]);
    expect(board.open.every((o) => !o.canClose && o.check.note === '')).toBe(true);
    const text = JSON.stringify(board);
    for (const secret of ['8000', 'UAT sub-agent', 'UAT Agency Three', 'pay came late', talk.id, fee.id, 'UAT kept in office']) expect(text).not.toContain(secret);
    // Nor through the audit trail or the papers.
    const mine = (await svc.auditLog(cm)).entries.filter((e) => e.action.startsWith('fwm.check'));
    expect(mine.map((e) => e.action)).toEqual(['fwm.check.passport']);
    expect(JSON.stringify((await svc.auditLog(cm)).entries)).not.toMatch(/UAT sub-agent|UAT Agency Three|pay came late/);
    // The group leaders still see every entry.
    expect((await svc.auditLog(await svc.user('u-fauzan'))).entries.filter((e) => e.action.startsWith('fwm.check')).map((e) => e.action).sort()).toEqual(['fwm.check.arrival_fee', 'fwm.check.passport', 'fwm.check.welfare']);
    await expect(svc.fwmDocs(cm, fee.id)).rejects.toBeInstanceOf(AccessDenied);
    expect(await svc.fwmDocs(await svc.user('u-fwm-mgr'), fee.id)).toHaveLength(1);
    // The CEO sees the full detail.
    const ceo = await svc.fwmWelfare(await svc.user('u-fauzan'));
    expect(ceo.open.map((o) => o.check.id).sort()).toEqual([fee.id, talk.id, pass.id].sort());
  });

  it('another company manager sees none of Sasa\'s workers; HR, ACT, OM and despatch are refused papers', async () => {
    const { svc, np, ds } = fresh();
    const fwm = await svc.user('u-fwm-ex1');
    const pass = await svc.recordFwCheck(fwm, np.id, { kind: 'PASSPORT', checkedOn: TODAY, heldBy: 'company' }, []);
    const inas = await svc.fwmWelfare(await svc.user('u-cm-inas'));
    expect(inas.workers.some((w) => w.person.id === np.id)).toBe(false);
    expect(inas.open).toHaveLength(0);
    await expect(svc.closeFwCheck(await svc.user('u-cm-inas'), pass.id, { note: 'Given back to the worker.', custody: 'worker' }, [pdf('r.pdf')])).rejects.toBeInstanceOf(AccessDenied);
    // An ACT (audit) account picked by department, so the test holds before and after the ACT restructure renames it.
    const act = ds.users.find((u) => u.department === 'audit' && u.actRole !== 'lead')!.id;
    for (const id of ['u-om-klang', 'u-fwm-desp', act]) {
      await expect(svc.fwmDocs(await svc.user(id), pass.id)).rejects.toBeInstanceOf(AccessDenied);
    }
  });

  it('the COO and CEO may close a follow-up in place of FWM, recorded as such; others may not', async () => {
    const { svc, np, ds } = fresh();
    const fwm = await svc.user('u-fwm-ex1');
    const a = await svc.recordFwCheck(fwm, np.id, { kind: 'WELFARE', checkedOn: TODAY, concerns: ['HOUSING'], note: 'UAT hostel fan broken' }, []);
    const b = await svc.recordFwCheck(fwm, np.id, { kind: 'WELFARE', checkedOn: TODAY, concerns: ['HOURS'], note: 'UAT no rest day last week' }, []);
    await expect(svc.closeFwCheck(await svc.user('u-cm-sasa'), a.id, { note: 'Fan replaced by the company.' }, [])).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.closeFwCheck(await svc.user('u-coo'), a.id, { note: 'ok' }, [])).rejects.toThrow(/how it was dealt with/);
    expect((await svc.closeFwCheck(await svc.user('u-coo'), a.id, { note: 'Fan replaced, seen on my visit.' }, [])).status).toBe('closed');
    expect(ds.audit.at(-1)!.summary).toMatch(/by the COO in place of FWM/);
    expect((await svc.closeFwCheck(await svc.user('u-fauzan'), b.id, { note: 'Roster fixed with the OM.' }, [])).status).toBe('closed');
    expect(ds.audit.at(-1)!.summary).toMatch(/by the CEO in place of FWM/);
  });
});
