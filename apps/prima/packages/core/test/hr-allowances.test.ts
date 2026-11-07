import { afterEach, describe, expect, it } from 'vitest';
import { AccessDenied, BadRequest, MemoryStore, PrimaService, RULES, generateDataset, staffPaySums, type User } from '../src';

const TODAY = '2026-11-03';
const NOW = '2026-11-03T02:00:00.000Z';

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const base = ds.users.find((u) => u.id === 'u-pwvsb-hr')!;
  // Synthetic Chief of Staff and Vice Chairman: the pilot persona list has neither.
  const cos = { ...base, id: 'u-cos-test', name: 'CoS (test)', department: 'chief_of_staff', leadership: 'cos' } as User;
  const vc = { ...base, id: 'u-vc-test', name: 'VC (test)', department: null, leadership: 'vice_chairman' } as unknown as User;
  ds.users.push(cos, vc);
  let t = Date.parse(NOW);
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => new Date((t += 1000)).toISOString());
  const setDay = (day: string) => {
    t = Date.parse(`${day}T02:00:00.000Z`);
  };
  const u = (id: string) => ds.users.find((x) => x.id === id)!;
  const staff = ds.users.find((x) => x.department === 'it' && x.personId && x.itRole !== 'manager' && x.itRole !== 'lead')!;
  const person = ds.people.find((p) => p.id === staff.personId)!;
  return { ds, store, svc, setDay, hr: u('u-pwvsb-hr'), ceo: u('u-fauzan'), cm: u('u-cm-sasa'), cos, vc, staff, person };
}

const pilot = RULES.pilot.value.on;
afterEach(() => {
  (RULES.pilot.value as { on: boolean }).on = pilot;
});

const TYPE = { name: 'Shift allowance (synthetic)', frequency: 'monthly' as const, usualAmount: 200, cap: 300, epf: true, socso: true, pcb: true, hrd: true, basis: 'Synthetic test basis', active: true, note: '' };

describe('allowances HR sets (Fauzan, 3 Nov 2026)', () => {
  it('only HR keeps the list; each change needs a reason, a basis and is audited', async () => {
    const { svc, store, hr, cm, staff } = fresh();
    await expect(svc.saveAllowanceType(cm, TYPE)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.saveAllowanceType(staff, TYPE)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.saveAllowanceType(hr, { ...TYPE, basis: '' })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.saveAllowanceType(hr, { ...TYPE, usualAmount: 400 })).rejects.toThrow(/above the cap/);
    const t = await svc.saveAllowanceType(hr, TYPE);
    await expect(svc.saveAllowanceType(hr, { ...TYPE })).rejects.toThrow(/already on the list/);
    await expect(svc.saveAllowanceType(hr, { ...TYPE, id: t.id, epf: false })).rejects.toThrow(/why/);
    const changed = await svc.saveAllowanceType(hr, { ...TYPE, id: t.id, epf: false, note: 'Checked again (synthetic)' });
    expect([changed.epf, changed.changes.length]).toEqual([false, 1]);
    const audit = (await store.list('audit', {})).filter((a) => a.entityId === t.id);
    expect(audit.map((a) => a.action)).toEqual(['hr.allowance_type.add', 'hr.allowance_type.change']);
    expect(audit[1].summary).toMatch(/was EPF yes/);
    // A company head (payroll view only) reads the list but not the staff settings; ordinary staff read nothing.
    expect(await svc.allowanceTypes(cm)).toMatchObject({ canEdit: false, staff: null });
    await expect(svc.allowanceTypes(staff)).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.allowanceTypes(hr)).staff!.length).toBeGreaterThan(0);
  });

  it('a staff member\'s monthly allowances wait for the HR Director, then the Vice Chairman, and are paid only then', async () => {
    (RULES.pilot.value as { on: boolean }).on = false;
    const ctx = fresh();
    const { svc, store, hr, ceo, cos, vc, staff, person } = ctx;
    const before = person.allowances ?? [];
    const t = await svc.saveAllowanceType(hr, TYPE);
    const req = { allowances: [{ typeId: t.id, amount: 250 }, { typeId: 'alw-phone', amount: 150 }], effectiveOn: '2026-12-01', reason: 'New post (synthetic)' };
    await expect(svc.requestAllowanceChange(staff, person.id, req)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.requestAllowanceChange(hr, person.id, { ...req, allowances: [{ typeId: t.id, amount: 350 }] })).rejects.toThrow(/capped/);
    await expect(svc.requestAllowanceChange(hr, person.id, { ...req, allowances: [{ typeId: 'nope', amount: 10 }] })).rejects.toThrow(/from the list/);
    await expect(svc.requestAllowanceChange(hr, person.id, { ...req, reason: '' })).rejects.toThrow(/reason/);
    const c = await svc.requestAllowanceChange(hr, person.id, req);
    expect([c.kind, c.status, c.to]).toEqual(['ALLOWANCE', 'pending', 400]);
    await expect(svc.requestAllowanceChange(hr, person.id, req)).rejects.toThrow(/already waiting/);
    expect((await store.get('people', person.id))!.allowances).toEqual(before);
    // Order: the VC cannot consent before the HR Director; HR cannot verify its own; a comment is needed.
    await expect(svc.decidePayChange(vc, c.id, true, 'Setuju (synthetic)')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.decidePayChange(hr, c.id, true, 'Setuju (synthetic)')).rejects.toThrow();
    await expect(svc.decidePayChange(cos, c.id, true, '')).rejects.toThrow();
    await svc.decidePayChange(cos, c.id, true, 'Ikut jawatan baru (synthetic)');
    expect((await store.get('people', person.id))!.allowances).toEqual(before);
    await expect(svc.decidePayChange(ceo, c.id, true, 'Setuju (synthetic)')).rejects.toBeInstanceOf(AccessDenied);
    const consented = await svc.decidePayChange(vc, c.id, true, 'Setuju (synthetic)');
    // Consented on 3 Nov for 1 Dec (Arisha main retest, 4 Nov 2026): nothing on the record changes before the date.
    expect([consented.status, consented.applied]).toEqual(['verified', null]);
    expect((await store.get('people', person.id))!.allowances).toEqual(before);
    await expect(svc.requestAllowanceChange(hr, person.id, { ...req, allowances: [{ typeId: 'alw-phone', amount: 100 }] })).rejects.toThrow(/already waiting/);
    expect((await svc.applyDueStaffMovements(hr)).applied).toEqual([]);
    const { setDay } = ctx;
    setDay('2026-12-01');
    await expect(svc.applyDueStaffMovements(staff)).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.applyDueStaffMovements(hr)).applied).toEqual([c.id]);
    expect((await svc.applyDueStaffMovements(hr)).applied).toEqual([]);
    expect((await store.get('people', person.id))!.allowances).toEqual([
      { typeId: t.id, label: TYPE.name, amount: 250 },
      { typeId: 'alw-phone', label: 'Phone allowance', amount: 150 },
    ]);
    const audit = (await store.list('audit', {})).filter((a) => a.entityId === person.id && a.action.startsWith('pay.allowance'));
    expect(audit.map((a) => a.action)).toEqual(['pay.allowance.request', 'pay.allowance.verify', 'pay.allowance.consent', 'pay.allowance.apply']);
  });

  it('an allowance change does not block a basic pay change, and a stale one is refused at consent', async () => {
    (RULES.pilot.value as { on: boolean }).on = false;
    const { svc, store, hr, cos, vc, person } = fresh();
    const c = await svc.requestAllowanceChange(hr, person.id, { allowances: [{ typeId: 'alw-car', amount: 500 }], effectiveOn: TODAY, reason: 'Yearly review (synthetic)' });
    // A promotion with new pay is still allowed while the allowance change waits.
    const m = await svc.prepareStaffMovement(hr, { personId: person.id, kind: 'promotion', toCompanyId: null, effectiveOn: TODAY, reason: 'Naik pangkat (synthetic)', basicPay: 6111 });
    expect(m.status).toBe('waiting');
    await svc.decidePayChange(cos, c.id, true, 'OK (synthetic)');
    await store.update('people', person.id, { allowances: [{ label: 'Changed elsewhere (synthetic)', amount: 1 }] });
    await expect(svc.decidePayChange(vc, c.id, true, 'Setuju (synthetic)')).rejects.toThrow(/changed after this was keyed/);
  });

  it('payroll counts an allowance for EPF, SOCSO, PCB and HRD only where HR ticked it', () => {
    const base = { basic: 4000, unpaidDays: 0, unpaidDivisor: 26, claims: 0, age: 35, nationality: 'MY' as const, pcbEntered: null, period: '2026-11', lindungOptedOut: true };
    const all = staffPaySums({ ...base, allowances: [{ label: 'Travel (synthetic)', amount: 1000, fixed: true }] });
    const out = staffPaySums({ ...base, allowances: [{ label: 'Travel (synthetic)', amount: 1000, fixed: true, epf: false, socso: false, pcb: false, hrd: false }] });
    expect([all.gross, out.gross]).toEqual([5000, 5000]);
    expect([all.epfWage, out.epfWage, out.socsoWage, out.taxable]).toEqual([5000, 4000, 4000, 4000]);
    expect(out.epfEe).toBeLessThan(all.epfEe);
    expect(out.socsoEe).toBeLessThan(all.socsoEe);
    expect(out.hrd).toBeLessThan(all.hrd);
    expect(out.net).toBeGreaterThan(all.net);
  });

  it('a one-off in the payroll month comes from the list and keeps its ticks', async () => {
    const { svc, store, hr } = fresh();
    const run = (await store.list('staffPayRuns', {})).find((r) => r.stage === 'draft') ?? null;
    expect(run).not.toBeNull();
    if (!run) return;
    const line = run.lines[0];
    await expect(svc.setStaffPayLine(hr, run.id, line.personId, { extra: [{ label: 'x', amount: 10, typeId: 'alw-phone' }] })).rejects.toThrow(/not a one-off/);
    const saved = await svc.setStaffPayLine(hr, run.id, line.personId, { extra: [{ label: 'ignored', amount: 300, typeId: 'alw-travel' }] });
    const extra = saved.allowanceLines.find((a) => !a.fixed)!;
    expect([extra.label, extra.epf, extra.socso]).toEqual(['Travel allowance (test entry)', false, false]);
    expect(saved.epfWage).toBe(saved.gross - 300);
  });
});

describe('allowance retest (Arisha main, 4 Nov 2026)', () => {
  const draftFor = async (svc: PrimaService, store: MemoryStore, ds: ReturnType<typeof generateDataset>, hr: User, companyId: string) => {
    for (const p of ds.people) if (p.companyId === companyId && p.role === 'office' && !p.bank) p.bank = { bank: 'Test Bank', accountMasked: '****0000' } as never;
    const id = `sp-${companyId}-${TODAY.slice(0, 7)}`;
    const r = await store.get('staffPayRuns', id);
    if (r && r.stage !== 'draft') await store.update('staffPayRuns', id, { stage: 'draft' });
    return svc.prepareStaffPay(hr, companyId, TODAY.slice(0, 7));
  };

  it('a consented change for a later date does not block this month and is refused into a submitted month', async () => {
    (RULES.pilot.value as { on: boolean }).on = false;
    const { svc, store, ds, hr, cos, vc, person, setDay } = fresh();
    const c = await svc.requestAllowanceChange(hr, person.id, { allowances: [{ typeId: 'alw-phone', amount: 90 }], effectiveOn: '2026-12-01', reason: 'Telefon (synthetic)' });
    await svc.decidePayChange(cos, c.id, true, 'Semak (synthetic)');
    await svc.decidePayChange(vc, c.id, true, 'Setuju (synthetic)');
    const run = await draftFor(svc, store, ds, hr, person.companyId);
    expect((await svc.staffPayRun(hr, run.id)).blockers.join(' ')).not.toMatch(/allowance change/);
    // December's month is already submitted when the day comes: the change waits with the reason.
    setDay('2026-12-01');
    await store.insert('staffPayRuns', { ...run, id: `sp-${person.companyId}-2026-12`, period: '2026-12', stage: 'submitted' });
    const r = await svc.applyDueStaffMovements(hr);
    expect(r.failed.map((f) => f.id)).toEqual([c.id]);
    expect(r.failed[0].message).toMatch(/already submitted/);
    expect((await store.get('payChanges', c.id))!.applied).toBeNull();
  });

  it('one-offs of one type add up to its monthly cap, with any fixed amount of that type', async () => {
    const { svc, store, ds, hr, person } = fresh();
    const t = await svc.saveAllowanceType(hr, { ...TYPE, name: 'Event duty (synthetic)', frequency: 'one_off', usualAmount: null, cap: 300 });
    const run = await draftFor(svc, store, ds, hr, person.companyId);
    await expect(svc.setStaffPayLine(hr, run.id, person.id, { extra: [{ label: '', amount: 200, typeId: t.id }, { label: '', amount: 200, typeId: t.id }] })).rejects.toThrow(/capped at RM300/);
    const ok = await svc.setStaffPayLine(hr, run.id, person.id, { extra: [{ label: '', amount: 150, typeId: t.id }, { label: '', amount: 150, typeId: t.id }] });
    expect(ok.allowanceLines.filter((a) => !a.fixed).length).toBe(2);
  });

  it('an HRD-ticked one-off counts for the HRD levy; an HRD-off one-off and an unlisted one do not', () => {
    const base = { basic: 4000, unpaidDays: 0, unpaidDivisor: 26, claims: 0, age: 35, nationality: 'MY' as const, pcbEntered: null, period: '2026-11', lindungOptedOut: true };
    const none = staffPaySums({ ...base, allowances: [] });
    const on = staffPaySums({ ...base, allowances: [{ label: 'One-off (synthetic)', amount: 1000, fixed: false, epf: true, socso: true, pcb: true, hrd: true }] });
    const off = staffPaySums({ ...base, allowances: [{ label: 'One-off (synthetic)', amount: 1000, fixed: false, epf: true, socso: true, pcb: true, hrd: false }] });
    const unlisted = staffPaySums({ ...base, allowances: [{ label: 'One-off (synthetic)', amount: 1000, fixed: false }] });
    expect(on.hrd).toBeGreaterThan(none.hrd);
    expect([off.hrd, unlisted.hrd]).toEqual([none.hrd, none.hrd]);
  });

  for (const tick of ['epf', 'socso', 'pcb', 'hrd'] as const)
    it(`a one-off whose type's ${tick.toUpperCase()} tick changes makes the draft stale until recalculated`, async () => {
      const { svc, store, ds, hr, person } = fresh();
      const t = await svc.saveAllowanceType(hr, { ...TYPE, name: `One-off ${tick} (synthetic)`, frequency: 'one_off', usualAmount: null, cap: 500 });
      const run = await draftFor(svc, store, ds, hr, person.companyId);
      const line0 = await svc.setStaffPayLine(hr, run.id, person.id, { extra: [{ label: '', amount: 200, typeId: t.id }] });
      expect(line0.allowanceLines.find((a) => a.typeId === t.id)![tick]).toBe(true);
      expect((await svc.staffPayRun(hr, run.id)).blockers.join(' ')).not.toMatch(/one-off allowance changed/);
      await svc.saveAllowanceType(hr, { ...TYPE, ...{ name: `One-off ${tick} (synthetic)`, frequency: 'one_off' as const, usualAmount: null, cap: 500 }, id: t.id, [tick]: false, note: 'Checked again (synthetic)' });
      await expect(svc.staffPayStep(hr, run.id, 'submit', { note: 'Hantar (synthetic)' })).rejects.toThrow(/ticks of a one-off allowance changed/);
      // The draft keeps what it showed until HR recalculates; the recalculation takes the new tick.
      expect((await store.get('staffPayRuns', run.id))!.lines.find((l) => l.personId === person.id)!.allowanceLines.find((a) => a.typeId === t.id)![tick]).toBe(true);
      await svc.prepareStaffPay(hr, person.companyId, TODAY.slice(0, 7));
      expect((await store.get('staffPayRuns', run.id))!.lines.find((l) => l.personId === person.id)!.allowanceLines.find((a) => a.typeId === t.id)![tick]).toBe(false);
      expect((await svc.staffPayRun(hr, run.id)).blockers.join(' ')).not.toMatch(/one-off allowance changed/);
    });

  it('a type change after submission leaves the submitted month exactly as it was', async () => {
    const { svc, store, ds, hr, person } = fresh();
    const t = await svc.saveAllowanceType(hr, { ...TYPE, name: 'Submitted one-off (synthetic)', frequency: 'one_off', usualAmount: null, cap: 500 });
    const run = await draftFor(svc, store, ds, hr, person.companyId);
    await svc.setStaffPayLine(hr, run.id, person.id, { extra: [{ label: '', amount: 200, typeId: t.id }] });
    await svc.staffPayStep(hr, run.id, 'submit', { note: 'Hantar (synthetic)' });
    const before = JSON.stringify((await store.get('staffPayRuns', run.id))!.lines);
    await svc.saveAllowanceType(hr, { ...TYPE, name: 'Submitted one-off (synthetic)', frequency: 'one_off', usualAmount: null, cap: 500, id: t.id, epf: false, note: 'Checked again (synthetic)' });
    expect(JSON.stringify((await store.get('staffPayRuns', run.id))!.lines)).toBe(before);
  });
});

describe('allowance review (Arisha main, d6c8765)', () => {
  const ready = (ds: ReturnType<typeof generateDataset>, companyId: string) => {
    for (const p of ds.people) if (p.companyId === companyId && p.role === 'office' && !p.bank) p.bank = { bank: 'Test Bank', accountMasked: '****0000' } as never;
  };

  it('a consent after the start date never writes into a submitted month: it waits with the reason, then applies once the month is back with HR', async () => {
    (RULES.pilot.value as { on: boolean }).on = false;
    const { svc, store, ds, hr, cos, vc, person } = fresh();
    ready(ds, person.companyId);
    const runId = `sp-${person.companyId}-${TODAY.slice(0, 7)}`;
    await store.update('staffPayRuns', runId, { stage: 'submitted' });
    const before = person.allowances ?? [];
    const c = await svc.requestAllowanceChange(hr, person.id, { allowances: [{ typeId: 'alw-phone', amount: 60 }], effectiveOn: '2026-11-01', reason: 'Telefon (synthetic)' });
    await svc.decidePayChange(cos, c.id, true, 'Semak (synthetic)');
    const done = await svc.decidePayChange(vc, c.id, true, 'Setuju (synthetic)');
    expect([done.status, done.applied]).toEqual(['verified', null]);
    expect(done.note).toMatch(/already submitted/);
    expect((await store.get('people', person.id))!.allowances ?? []).toEqual(before);
    expect((await svc.applyDueStaffMovements(hr)).failed.map((f) => f.id)).toEqual([c.id]);
    await store.update('staffPayRuns', runId, { stage: 'draft' });
    expect((await svc.applyDueStaffMovements(hr)).applied).toEqual([c.id]);
    expect((await store.get('people', person.id))!.allowances!.map((a) => a.amount)).toEqual([60]);
  });

  it('last month prepared today keeps last month\'s allowances and basic pay; this month takes the new ones', async () => {
    (RULES.pilot.value as { on: boolean }).on = false;
    const { svc, store, ds, hr, ceo, cos, vc, person } = fresh();
    ready(ds, person.companyId);
    for (const r of await store.list('staffPayRuns', { companyId: person.companyId })) if (r.period === '2026-10') await store.delete?.('staffPayRuns', r.id);
    ds.staffPayRuns = ds.staffPayRuns.filter((r) => !(r.companyId === person.companyId && r.period === '2026-10'));
    const oldBasic = person.basicPay;
    const oldAllowances = JSON.stringify((person.allowances ?? []).map((a) => a.amount));
    const c = await svc.requestAllowanceChange(hr, person.id, { allowances: [{ typeId: 'alw-phone', amount: 75 }], effectiveOn: '2026-11-01', reason: 'Telefon (synthetic)' });
    await svc.decidePayChange(cos, c.id, true, 'Semak (synthetic)');
    expect((await svc.decidePayChange(vc, c.id, true, 'Setuju (synthetic)')).applied).not.toBeNull();
    const m = await svc.prepareStaffMovement(hr, { personId: person.id, kind: 'promotion', toCompanyId: null, effectiveOn: TODAY, reason: 'Naik pangkat (synthetic)', basicPay: 6543 });
    await svc.staffMovementStep(cos, m.id, true, 'OK (synthetic)');
    await svc.staffMovementStep(ceo, m.id, true, 'OK (synthetic)');
    await svc.staffMovementStep(vc, m.id, true, 'Setuju (synthetic)');
    const oct = await svc.prepareStaffPay(hr, person.companyId, '2026-10');
    const octLine = oct.lines.find((l) => l.personId === person.id)!;
    expect(octLine.basic).toBe(oldBasic);
    expect(JSON.stringify(octLine.allowanceLines.filter((a) => a.fixed).map((a) => a.amount))).toBe(oldAllowances);
    // The October draft is not stale just because November's pay is different.
    expect((await svc.staffPayRun(hr, oct.id)).blockers.join(' ')).not.toMatch(/changed for/);
    const nov = await svc.prepareStaffPay(hr, person.companyId, '2026-11');
    const novLine = nov.lines.find((l) => l.personId === person.id)!;
    expect([novLine.basic, novLine.allowanceLines.filter((a) => a.fixed).map((a) => a.amount)]).toEqual([6543, [75]]);
  });

  it('impossible or out-of-range dates are refused for allowances and movements', async () => {
    const { svc, hr, person } = fresh();
    for (const d of ['2026-02-30', '2026-13-01', '2026-11-31', 'soon'])
      await expect(svc.requestAllowanceChange(hr, person.id, { allowances: [{ typeId: 'alw-phone', amount: 50 }], effectiveOn: d, reason: 'Telefon (synthetic)' })).rejects.toThrow(/real date/);
    await expect(svc.requestAllowanceChange(hr, person.id, { allowances: [{ typeId: 'alw-phone', amount: 50 }], effectiveOn: '1990-01-01', reason: 'Telefon (synthetic)' })).rejects.toThrow(/before/);
    await expect(svc.prepareStaffMovement(hr, { personId: person.id, kind: 'promotion', toCompanyId: null, effectiveOn: '2026-02-29', reason: 'Naik pangkat (synthetic)', jobTitle: 'Senior (synthetic)' })).rejects.toThrow(/real date/);
  });

  it('a cap lowered after the draft blocks submission until the one-off is lowered', async () => {
    const { svc, store, ds, hr, person } = fresh();
    ready(ds, person.companyId);
    const t = await svc.saveAllowanceType(hr, { ...TYPE, name: 'Cap check (synthetic)', frequency: 'one_off', usualAmount: null, cap: 300 });
    const run = await svc.prepareStaffPay(hr, person.companyId, TODAY.slice(0, 7));
    await svc.setStaffPayLine(hr, run.id, person.id, { extra: [{ label: '', amount: 250, typeId: t.id }] });
    await svc.saveAllowanceType(hr, { ...TYPE, name: 'Cap check (synthetic)', frequency: 'one_off', usualAmount: null, cap: 200, id: t.id, note: 'Lower cap (synthetic)' });
    expect((await svc.staffPayRun(hr, run.id)).blockers.join(' ')).toMatch(/Over the allowance cap now/);
    await expect(svc.staffPayStep(hr, run.id, 'submit', { note: 'Hantar (synthetic)' })).rejects.toThrow(/cap/);
    // Recalculating alone keeps HR's amount and stays blocked; lowering it clears the block.
    await svc.prepareStaffPay(hr, person.companyId, TODAY.slice(0, 7));
    expect((await svc.staffPayRun(hr, run.id)).blockers.join(' ')).toMatch(/Over the allowance cap now/);
    await expect(svc.setStaffPayLine(hr, run.id, person.id, { extra: [{ label: '', amount: 250, typeId: t.id }] })).rejects.toThrow(/capped/);
    await svc.setStaffPayLine(hr, run.id, person.id, { extra: [{ label: '', amount: 200, typeId: t.id }] });
    expect((await svc.staffPayStep(hr, run.id, 'submit', { note: 'Hantar (synthetic)' })).stage).toBe('submitted');
  });
});

describe('allowance retest (Arisha main, a07f0e8)', () => {
  const ready = (ds: ReturnType<typeof generateDataset>, companyId: string) => {
    for (const p of ds.people) if (p.companyId === companyId && p.role === 'office' && !p.bank) p.bank = { bank: 'Test Bank', accountMasked: '****0000' } as never;
  };

  it('a cap cannot go below a fixed allowance; a fixed-only line over the cap blocks the draft', async () => {
    const { svc, store, ds, hr, person } = fresh();
    ready(ds, person.companyId);
    const t = await svc.saveAllowanceType(hr, { ...TYPE, name: 'Fixed cap (synthetic)', frequency: 'monthly', usualAmount: null, cap: 300 });
    await store.update('people', person.id, { allowances: [{ typeId: t.id, label: t.name, amount: 250 }] });
    await expect(svc.saveAllowanceType(hr, { ...TYPE, name: 'Fixed cap (synthetic)', frequency: 'monthly', usualAmount: null, cap: 200, id: t.id, note: 'Lower (synthetic)' })).rejects.toThrow(/below what/);
    await svc.saveAllowanceType(hr, { ...TYPE, name: 'Fixed cap (synthetic)', frequency: 'monthly', usualAmount: null, cap: 250, id: t.id, note: 'Lower to the amount paid (synthetic)' });
    const run = await svc.prepareStaffPay(hr, person.companyId, TODAY.slice(0, 7));
    expect((await svc.staffPayRun(hr, run.id)).blockers.join(' ')).not.toMatch(/Over the allowance cap/);
    // A cap that got below a fixed amount some other way (older data) still blocks the month with no one-off on the line.
    await store.update('allowanceTypes', t.id, { cap: 200 });
    expect((await svc.staffPayRun(hr, run.id)).blockers.join(' ')).toMatch(/Over the allowance cap now: .*RM250, cap RM200/);
    await expect(svc.staffPayStep(hr, run.id, 'submit', { note: 'Hantar (synthetic)' })).rejects.toThrow(/cap/);
  });

  it('backdating is limited: not before last month, never before a change already approved', async () => {
    (RULES.pilot.value as { on: boolean }).on = false;
    const { svc, hr, cos, vc, person } = fresh();
    const req = (effectiveOn: string, amount = 40) => svc.requestAllowanceChange(hr, person.id, { allowances: [{ typeId: 'alw-phone', amount }], effectiveOn, reason: 'Telefon (synthetic)' });
    await expect(req('2026-09-30')).rejects.toThrow(/2026-10-01 at the earliest/);
    const c = await req('2026-11-02');
    await svc.decidePayChange(cos, c.id, true, 'Semak (synthetic)');
    expect((await svc.decidePayChange(vc, c.id, true, 'Setuju (synthetic)')).applied).not.toBeNull();
    await expect(req('2026-11-01', 45)).rejects.toThrow(/already approved/);
    await req('2026-11-02', 45);
  });

  it('payroll history follows effective dates, not the order changes were applied', async () => {
    const { svc, store, ds, hr, person } = fresh();
    ready(ds, person.companyId);
    ds.staffPayRuns = ds.staffPayRuns.filter((r) => !(r.companyId === person.companyId && r.period === '2026-10'));
    const A = [{ typeId: 'alw-phone', label: 'Phone allowance', amount: 100 }];
    const B = [{ typeId: 'alw-phone', label: 'Phone allowance', amount: 200 }];
    const base = { companyId: person.companyId, personId: person.id, reason: 'Synthetic history', requestedBy: 'HR', requestedById: 'u-pwvsb-hr', requestedAt: NOW, status: 'verified' as const, decidedBy: 'VC', note: null, kind: 'ALLOWANCE' as const };
    // Applied out of order (older data): the December change was decided first, the 20 November change later.
    await store.insert('payChanges', { ...base, id: 'pc-hist-dec', from: 100, to: 200, effectiveOn: '2026-12-01', decidedAt: '2026-11-01T01:00:00.000Z', allowancesFrom: A, allowancesTo: B, applied: { at: NOW, by: 'HR' } });
    await store.insert('payChanges', { ...base, id: 'pc-hist-nov', from: 0, to: 100, effectiveOn: '2026-11-20', decidedAt: '2026-11-02T01:00:00.000Z', allowancesFrom: [], allowancesTo: A, applied: { at: NOW, by: 'HR' } });
    await store.update('people', person.id, { allowances: B });
    const fixed = async (period: string) => (await svc.prepareStaffPay(hr, person.companyId, period)).lines.find((l) => l.personId === person.id)!.allowanceLines.filter((a) => a.fixed).map((a) => a.amount);
    expect(await fixed('2026-10')).toEqual([]);
    expect(await fixed('2026-11')).toEqual([100]);
  });
});

describe('older pay history applied out of date order (Arisha main retest of beea18d)', () => {
  it('a basic pay change dated October but applied after a November one blocks November until HR keys a correction', async () => {
    const { svc, store, ds, hr, person } = fresh();
    for (const p of ds.people) if (p.companyId === person.companyId && p.role === 'office' && !p.bank) p.bank = { bank: 'Test Bank', accountMasked: '****0000' } as never;
    const base = { companyId: person.companyId, personId: person.id, reason: 'Older data (synthetic)', requestedBy: 'HR', requestedById: 'u-pwvsb-hr', requestedAt: NOW, status: 'verified' as const, decidedBy: 'VC', note: null, kind: 'PAY' as const };
    // Older code: the 1 November change was decided first; a 15 October change was decided after it and wrote the record.
    await store.insert('payChanges', { ...base, id: 'pc-old-nov', from: 4000, to: 5000, effectiveOn: '2026-11-01', decidedAt: '2026-11-01T01:00:00.000Z' });
    await store.insert('payChanges', { ...base, id: 'pc-old-oct', from: 3000, to: 4000, effectiveOn: '2026-10-15', decidedAt: '2026-11-02T01:00:00.000Z' });
    await store.update('people', person.id, { basicPay: 4000 });
    const run = await svc.prepareStaffPay(hr, person.companyId, '2026-11');
    expect((await svc.staffPayRun(hr, run.id)).blockers.join(' ')).toMatch(/Pay history out of date order for .*record basic RM4000, by date basic RM5000/);
    await expect(svc.staffPayStep(hr, run.id, 'submit', { note: 'Hantar (synthetic)' })).rejects.toThrow(/out of date order/);
    // HR keys a correcting change dated today; once it is in force the month is consistent again.
    await store.insert('payChanges', { ...base, id: 'pc-fix', from: 4000, to: 5000, effectiveOn: TODAY, decidedAt: '2026-11-03T03:00:00.000Z' });
    await store.update('people', person.id, { basicPay: 5000 });
    await svc.prepareStaffPay(hr, person.companyId, '2026-11');
    expect((await svc.staffPayRun(hr, run.id)).blockers.join(' ')).not.toMatch(/out of date order/);
  });

  it('history kept in date order never blocks', async () => {
    const { svc, store, ds, hr, person } = fresh();
    for (const p of ds.people) if (p.companyId === person.companyId && p.role === 'office' && !p.bank) p.bank = { bank: 'Test Bank', accountMasked: '****0000' } as never;
    const base = { companyId: person.companyId, personId: person.id, reason: 'In order (synthetic)', requestedBy: 'HR', requestedById: 'u-pwvsb-hr', requestedAt: NOW, status: 'verified' as const, decidedBy: 'VC', note: null, kind: 'PAY' as const };
    await store.insert('payChanges', { ...base, id: 'pc-in-1', from: 3000, to: 4000, effectiveOn: '2026-10-15', decidedAt: '2026-10-15T01:00:00.000Z' });
    await store.insert('payChanges', { ...base, id: 'pc-in-2', from: 4000, to: 5000, effectiveOn: '2026-11-01', decidedAt: '2026-11-01T01:00:00.000Z' });
    await store.update('people', person.id, { basicPay: 5000 });
    const run = await svc.prepareStaffPay(hr, person.companyId, '2026-11');
    expect((await svc.staffPayRun(hr, run.id)).blockers.join(' ')).not.toMatch(/out of date order/);
  });
});
