import { afterEach, describe, expect, it } from 'vitest';
import { AccessDenied, BadRequest, MemoryStore, PrimaService, RULES, generateDataset } from '../src';

/**
 * P78 (Agentic Office): the owner, signed in as Prima's CEO record, is the master administrator. In People and HR it
 * may do every maker step (prepare the staff payroll, key HR records, open cases, log PDPA requests); checks and
 * approvals stay with their own people, and nobody approves a record they entered.
 */

const TODAY = '2026-10-26';
const NOW = '2026-10-26T02:30:00.000Z';

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => NOW) };
}

const pilot = RULES.pilot.value.on;
afterEach(() => {
  (RULES.pilot.value as { on: boolean }).on = pilot;
});

describe('P78: the owner in People and HR', () => {
  it('prepares a staff payroll month and keys its lines, and never approves a month it prepared', async () => {
    (RULES.pilot.value as { on: boolean }).on = true;
    const { svc, store } = fresh();
    const owner = await svc.user('u-fauzan');
    const hr = await svc.user('u-pwvsb-hr');
    const cos = await svc.user('u-cos');
    const board = await svc.staffPayroll(owner);
    expect(board.role).toBe('view');
    expect(board.canPrepare).toBe(true);
    expect((await svc.staffPayroll(await svc.user('u-cm-sasa'))).canPrepare).toBe(false);

    // A month HR prepared and submitted: the owner approves it in the Chief of Staff's place (pilot).
    const hrRun = await svc.staffPayRun(owner, 'sp-pwvsb-2026-10');
    expect(hrRun.run.stage).toBe('submitted');
    expect(hrRun.can.approve).toBe(true);
    expect((await svc.staffPayStep(owner, 'sp-pwvsb-2026-10', 'approve', { note: 'Checked against the staff list' })).stage).toBe('approved');

    // The owner prepares (recalculates) a draft month and keys a line, like HR.
    const id = 'sp-co-inas-2026-10';
    const run = await svc.prepareStaffPay(owner, 'co-inas', '2026-10');
    expect(run.prepared?.byId).toBe(owner.id);
    const view = await svc.staffPayRun(owner, id);
    expect(view.can.prepare).toBe(true);
    const line = await svc.setStaffPayLine(owner, id, view.run.lines[0].personId, { pcb: 12 });
    expect(line.pcbSource).toBe('entered');

    // Once submitted, the owner cannot approve the month it prepared; the Chief of Staff can.
    await store.transaction(async (tx) => {
      await tx.update('staffPayRuns', id, { stage: 'submitted', submitted: { by: hr.name, byId: hr.id, at: NOW, note: '' } });
    });
    expect((await svc.staffPayRun(owner, id)).can.approve).toBe(false);
    await expect(svc.staffPayStep(owner, id, 'approve', { note: 'Looks fine' })).rejects.toBeInstanceOf(BadRequest);
    expect((await svc.staffPayroll(owner)).runs.find((r) => r.id === id)?.mineToAct).toBe(false);
    expect((await svc.staffPayStep(cos, id, 'approve', { note: 'Checked' })).stage).toBe('approved');

    // Others still cannot prepare.
    await expect(svc.prepareStaffPay(await svc.user('u-cm-sasa'), 'co-sasa', '2026-10')).rejects.toBeInstanceOf(AccessDenied);
  });

  it('keys HR records and starts HR workflows; HR decisions stay with HR, and the CEO never approves its own vacancy', async () => {
    const { svc } = fresh();
    const owner = await svc.user('u-fauzan');
    const cm = await svc.user('u-cm-sasa');
    expect((await svc.publicHolidays(owner, '2026')).canEdit).toBe(true);
    await svc.addPublicHoliday(owner, { date: '2026-12-31', name: 'Company day (test)', states: null, compulsory: null, note: '' });
    await expect(svc.addPublicHoliday(cm, { date: '2026-12-30', name: 'Not allowed', states: null, compulsory: null, note: '' })).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.hrCases(owner)).canOpen).toBe(true);
    expect((await svc.staffMovements(owner)).canPrepare).toBe(true);
    expect((await svc.appraisals(owner)).canOpen).toBe(true);
    expect((await svc.hrPolicies(owner)).canPublish).toBe(true);
    expect((await svc.allowanceTypes(owner)).canEdit).toBe(true);
    await svc.hrJoinLeave(owner);

    const vac = await svc.vacancies(owner);
    expect(vac.canRaise).toBe(true);
    const v = await svc.raiseVacancy(owner, { companyId: 'co-sasa', title: 'Admin clerk', department: 'Admin', headcount: 1, reason: 'Replacement for a leaver', payFrom: null, payTo: null });
    expect((await svc.vacancies(owner)).rows.find((r) => r.id === v.id)?.canCeo).toBe(false);
  });

  it('opens the other People and HR workflows: PDPA, memos, FWM, hostels, requests and SOCSO', async () => {
    (RULES.pilot.value as { on: boolean }).on = true;
    const { svc } = fresh();
    const owner = await svc.user('u-fauzan');
    const pdpa = await svc.pdpaBoard(owner);
    expect(pdpa.role).toBe('monitor');
    expect(pdpa.canAdd).toBe(true);
    const req = await svc.addPdpaRequest(owner, { companyId: 'co-sasa', kind: 'ACCESS', subjectName: 'A guard (test)', subjectKind: 'guard', detail: 'Asks for a copy of the data kept.', receivedOn: TODAY });
    // Working the request on stays with the PDPA officer.
    await expect(svc.pdpaRequestStep(owner, req.id, 'verify', 'Identity seen')).rejects.toBeInstanceOf(AccessDenied);

    const memos = await svc.memos(owner);
    expect(memos.canPublish).toEqual(expect.arrayContaining(['STAFF', 'FIELD']));
    await svc.publishMemo(owner, 'FIELD', 'Test memo (P78)', 'Read this, please.');
    const cooMay = (await svc.memos(await svc.user('u-coo'))).canPublish;
    expect(cooMay).toContain('FIELD');
    expect(cooMay).not.toContain('STAFF');

    expect((await svc.fwmBoard(owner)).canWork).toBe(true);
    expect((await svc.fwmWelfare(owner)).canRecord).toBe(true);
    expect((await svc.hostelBoard(owner)).canAddBill).toBe(true);
    expect((await svc.expenseBoard(owner)).can).toEqual({ opsClaim: true, office: true });
    expect((await svc.socsoClaims(owner)).canStart).toBe(true);
  });
});
