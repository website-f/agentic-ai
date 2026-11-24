// Company administration gaps (Fauzan, 23 Nov 2026, study "How company administration works in Prima"):
// B1 the office duty checklist follows the central Marketing tender desk; B2 the tenders desk is renamed; D1 admin
// executives prepare office requests and the company head checks and sends; and "Company also monitor what happen with
// operation or hr of its own company, while they dont do it, but they see it" (decision card: watch, keep sign-offs).
// Mock data only.
import { describe, expect, it } from 'vitest';
import { AccessDenied, BadRequest, MemoryStore, OFFICE_DESKS, PrimaService, RULES, can, generateDataset, myt } from '../src';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');
let n = 0;
const doc = () => ({ kind: 'document' as const, name: `Bill ${++n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 bill ${n}`).toString('base64')}` });

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
}

describe('B1 and B2: tenders belong to the Marketing desk', () => {
  it('keeps no tender preparation in the office duty template, only answering and approving Marketing', () => {
    const t = RULES.groupDuties.value.template;
    const ids = [...t.company_manager, ...t.admin_exec].map((l) => l.id);
    expect(ids).not.toEqual(expect.arrayContaining(['cm-tender']));
    for (const gone of ['cm-tender', 'cm-bigtender', 'ae-eptender', 'ae-tendersum']) expect(ids).not.toContain(gone);
    expect(ids).toEqual(expect.arrayContaining(['cm-bidnotice', 'cm-bidprice', 'ae-papers', 'ae-ep']));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names the desk for quotations and Marketing bids and routes office requests to the office desk', () => {
    const tenders = OFFICE_DESKS.find((d) => d.desk === 'tenders')!;
    expect(tenders.label).toBe('Quotations and Marketing bids');
    expect(tenders.views).toContain('marketing');
    expect(OFFICE_DESKS.find((d) => d.desk === 'office')!.views).toContain('requests');
  });
});

describe('D1: executives prepare office requests, the head checks and sends', () => {
  it('runs executive draft, head check with a comment, Chief of Staff, COO; a return goes back to the executive', async () => {
    const { svc } = fresh();
    const [ae, cm, cos, coo] = await Promise.all(['u-ae-arsh', 'u-cm-arsh', 'u-cos', 'u-coo'].map((id) => svc.user(id)));
    const board = await svc.expenseBoard(ae);
    expect(board.can.office).toBe(true);
    expect(board.can.sendOffice).toBe(false);
    const r = await svc.saveExpense(ae, { kind: 'OFFICE', companyId: 'co-arsh', period: '2026-10', category: 'UTILITIES', lines: [{ item: 'Electricity', amount: 412.5 }] }, [doc()]);
    // The executive's send goes to the head, not the Chief of Staff.
    expect((await svc.submitExpense(ae, r.id)).status).toBe('head_check');
    expect((await svc.expenseBoard(cos)).requests.find((x) => x.id === r.id)!.canCos).toBe(false);
    await expect(svc.decideExpense(cos, r.id, 'approve', 'ok')).rejects.toBeInstanceOf(AccessDenied);
    // The head sees it waiting and on the company work list.
    const headRow = (await svc.expenseBoard(cm)).requests.find((x) => x.id === r.id)!;
    expect(headRow.canHead).toBe(true);
    expect(headRow.waitingOn).toBe('Company head to check and send');
    // The executive cannot check their own; the head cannot reject, only send back; a comment is needed.
    await expect(svc.decideExpense(ae, r.id, 'approve', 'ok')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.decideExpense(cm, r.id, 'reject', 'No')).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.decideExpense(cm, r.id, 'approve', ' ')).rejects.toThrow(/reason/);
    await svc.decideExpense(cm, r.id, 'return', 'Attach the full bill, both pages');
    expect((await svc.expenseBoard(ae)).requests.find((x) => x.id === r.id)!.canEdit).toBe(true);
    await svc.saveExpense(ae, { id: r.id, kind: 'OFFICE', companyId: 'co-arsh', period: '2026-10', category: 'UTILITIES', lines: [{ item: 'Electricity', amount: 412.5 }] }, [doc()]);
    await svc.submitExpense(ae, r.id);
    const sent = await svc.decideExpense(cm, r.id, 'approve', 'Matches the TNB bill');
    expect(sent.status).toBe('submitted');
    expect(sent.headCheck!.by).toBe(cm.name);
    expect((await svc.decideExpense(cos, r.id, 'approve', 'Within budget')).status).toBe('cos_approved');
    expect((await svc.decideExpense(coo, r.id, 'approve', 'Approved')).status).toBe('approved');
  });

  it("keeps the head's own request going straight to the Chief of Staff, and refuses branch managers and other companies", async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-arsh');
    const r = await svc.saveExpense(cm, { kind: 'OFFICE', companyId: 'co-arsh', period: '2026-10', category: 'RENT', lines: [{ item: 'Office rent', amount: 1800 }] }, [doc()]);
    expect((await svc.submitExpense(cm, r.id)).status).toBe('submitted');
    const ae = await svc.user('u-ae-arsh');
    await expect(
      svc.saveExpense(ae, { kind: 'OFFICE', companyId: 'co-sasa', period: '2026-10', category: 'RENT', lines: [{ item: 'Rent', amount: 1 }] }),
    ).rejects.toBeInstanceOf(AccessDenied);
    const bm = ds.users.find((u) => u.role === 'admin_exec' && u.branchId);
    if (bm) {
      const u = await svc.user(bm.id);
      await expect(
        svc.saveExpense(u, { kind: 'OFFICE', companyId: u.companyIds[0], period: '2026-10', category: 'RENT', lines: [{ item: 'Rent', amount: 1 }] }),
      ).rejects.toBeInstanceOf(AccessDenied);
    }
    // An executive sees only office requests, never an Operations Manager's claim.
    expect((await svc.expenseBoard(ae)).requests.every((x) => x.kind === 'OFFICE' && x.companyId === 'co-arsh')).toBe(true);
  });
});

describe('The company watches operations and HR, and keeps its sign-offs (Fauzan, 23 Nov 2026)', () => {
  it('lets the head and executives see but not run rosters, attendance, case steps or HR files', async () => {
    const { svc, ds } = fresh();
    const g = ds.grants;
    const [cm, ae] = await Promise.all(['u-cm-sasa', 'u-ae-sasa'].map((id) => svc.user(id)));
    for (const u of [cm, ae]) {
      expect(can(u, g, TODAY, 'view', 'co-sasa')).toBe(true);
      expect(can(u, g, TODAY, 'hr.profile', 'co-sasa')).toBe(true);
      expect(can(u, g, TODAY, 'case.raise', 'co-sasa')).toBe(true);
      for (const a of ['roster.edit', 'roster.publish', 'attendance.lock', 'attendance.followup', 'case.update', 'site.patrol', 'site.visit'] as const)
        expect(can(u, g, TODAY, a, 'co-sasa')).toBe(false);
    }
    // Sign-offs the head keeps: closing a case, deciding discipline, authorising leave; quotations stay.
    for (const a of ['case.close', 'attendance.discipline', 'leave.request', 'commercial.approve'] as const) expect(can(cm, g, TODAY, a, 'co-sasa')).toBe(true);
    for (const a of ['case.close', 'attendance.discipline', 'leave.request', 'commercial.approve'] as const) expect(can(ae, g, TODAY, a, 'co-sasa')).toBe(false);
    // The HR file: the company sees it, HR keeps it.
    const guard = ds.people.find((p) => p.companyId === 'co-sasa' && p.role === 'guard' && p.nationality === 'MY' && p.status === 'active')!;
    const prof = await svc.guardProfile(cm, guard.id);
    expect(prof.hiring.canUpload).toBe(false);
    await expect(svc.uploadHiringDoc(ae, guard.id, 'AGREEMENT', [doc()])).rejects.toBeInstanceOf(AccessDenied);
    await svc.uploadHiringDoc(await svc.user('u-pwvsb-hr'), guard.id, 'AGREEMENT', [doc()]);
    // A site shift: the company sees the roster but cannot assign.
    const shift = ds.shifts.find((s) => s.companyId === 'co-sasa' && s.status === 'draft')!;
    await expect(svc.assignShift(cm, shift.id, null)).rejects.toBeInstanceOf(AccessDenied);
  });

  it("still works the company's own cases with no site, but not a site case's steps", async () => {
    const { svc } = fresh();
    const [cm, ae] = await Promise.all(['u-cm-sasa', 'u-ae-sasa'].map((id) => svc.user(id)));
    const pdf = doc();
    const c = await svc.raiseCase(ae, { companyId: 'co-sasa', siteId: null, type: 'COMPLAINT', severity: 'P3', title: 'Invoice query', description: '', proof: [pdf] });
    await svc.updateCase(ae, c.id, 'resolve', 'Credit note sent', [doc()]);
    // Nobody closes what they resolved; the head closes it.
    expect((await svc.updateCase(cm, c.id, 'close', 'Client agreed')).status).toBe('closed');
  });
});
