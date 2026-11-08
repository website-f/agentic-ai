import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, addDays, generateDataset, myt, requireApprovalReason } from '../src';

// Every approval in Prima has a reason, at least a short comment (Fauzan, 31 Oct 2026: "every approval need reason to
// approve it. the smallest is ok"; "at least a comment", every approver). Dummy data only.
const TODAY = '2026-10-26';
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:30') });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => myt(TODAY, '10:30')) };
};
const NEEDS = /Write a comment to [a-z ]+\. A short one is fine\./;

describe('requireApprovalReason', () => {
  it('refuses a blank comment and keeps any short one', () => {
    for (const blank of ['', '   ', '\n\t', undefined, null]) expect(() => requireApprovalReason(blank)).toThrow(NEEDS);
    expect(() => requireApprovalReason('', 'consent')).toThrow('Write a comment to consent. A short one is fine.');
    expect(requireApprovalReason(' ok ')).toBe('ok');
    expect(requireApprovalReason('x'.repeat(600))).toHaveLength(500);
  });
});

// Each approval point named here must call requireApprovalReason on its approve path. Adding an approval without a reason, or
// dropping the check from one of these, fails this test. IT job accept and technical check are on draft PR #41.
const APPROVALS = [
  'decideLeave', 'reviewArmsRequest', 'reviewFalseAlarm', 'confirmTenderNa', 'decideTender', 'verifyTender', 'quotationAction',
  'reviewFwmTask', 'remoteDecide', 'remoteReview', 'workTaskReview', 'checkHostelBill', 'approveHostelBill',
  'decideTrip', 'cosDecideClaim', 'hrDecideClaim', 'cooDecideClaim', 'decideExpense', 'decideVehicleRequest',
  'pdpaRequestStep', 'amDecideReversal', 'amDecideLetter', 'decidePayChange', 'decideItAccess', 'reviewItAccount',
  'actImprovementStep', 'grcCheck', 'whistleReview', 'decideGift', 'govMandateStep', 'purSupplierStep', 'confirmStockLoss',
  'creditDecide', 'decideCorpChange', 'approveBranchSettlement', 'reviewBranchAction', 'amDisposalStep', 'purStep', 'staffPayStep', 'itBuyStep',
];

describe('every approval point asks for a reason (source sweep)', () => {
  const src = readFileSync(join(__dirname, '../src/service.ts'), 'utf8');
  const body = (name: string) => {
    const start = src.search(new RegExp(`\\n  async ${name}\\(`));
    expect(start, `${name} not found`).toBeGreaterThan(0);
    const next = src.indexOf('\n  async ', start + 10);
    return src.slice(start, next < 0 ? undefined : next);
  };
  it.each(APPROVALS)('%s enforces a reason directly or through its decision engine', (name) => {
    const equivalent: Record<string, RegExp> = {
      decideExpense: /if \(decision === 'approve' && !text\) throw new BadRequest/,
      govMandateStep: /if \(!note\) throw new BadRequest\('Give a reason for verifying/,
      decideCorpChange: /if \(!text\) throw new BadRequest\(decision === 'reject'/,
      approveBranchSettlement: /if \(text.length < 3\) throw new BadRequest\('Give a comment with the approval/,
    };
    if (name === 'reviewArmsRequest') {
      expect(body(name)).toMatch(/this\.armsRequestStep\(user, requestId, decision, note\)/);
      expect(body('armsRequestStep')).toMatch(/if \(decision && why.length < 3\) throw new BadRequest/);
    } else expect(body(name)).toMatch(equivalent[name] ?? /requireApprovalReason\(/);
  });
});

describe('approvals refuse an empty comment and accept a short one', () => {
  it('leave', async () => {
    const { svc, ds } = fresh();
    const dev = await svc.user('u-dev-sasa-001');
    const site = ds.sites.find((s) => s.id === dev.siteIds[0])!;
    const g = ds.people.find((p) => p.companyId === 'co-sasa' && p.branchId === site.branchId && p.role === 'guard' && p.status === 'active')!;
    const q = await svc.requestLeave(dev, { staffNo: g.staffNo, face: { score: 0.93, live: true }, from: addDays(TODAY, 3), to: addDays(TODAY, 4), reason: 'Family wedding', kind: 'ANNUAL' });
    const om = ds.users.find((u) => u.opsTier === 'om' && u.areaStates!.includes(ds.branches.find((b) => b.id === g.branchId)!.state))!;
    await expect(svc.decideLeave(om, q.id, true, '  ')).rejects.toThrow(NEEDS);
    expect((await svc.leaveRequests(om)).rows.find((r) => r.request.id === q.id)!.request.status).toBe('pending');
    const done = await svc.decideLeave(om, q.id, true, 'ok');
    expect(done.status).toBe('approved');
    expect(done.decisionNote).toBe('ok');
  });

  it('quotation', async () => {
    const { svc } = fresh();
    const ae = await svc.user('u-ae-arsh');
    const cm = await svc.user('u-cm-arsh');
    const q = await svc.createQuotation(ae, 'co-arsh', { client: 'Test JMB', siteName: 'Tower A', tenderId: null, guards: 4, hoursPerDay: 12, ratePerGuard: 3200, validDays: 30 });
    await svc.quotationAction(ae, q.id, 'submit');
    await expect(svc.quotationAction(cm, q.id, 'approve')).rejects.toThrow(NEEDS);
    await expect(svc.quotationAction(cm, q.id, 'approve', '')).rejects.toThrow(NEEDS);
    const ok = await svc.quotationAction(cm, q.id, 'approve', 'Rate checked');
    expect(ok.status).toBe('approved');
    expect(ok.note).toBe('Rate checked');
  });

  it('tender T/B confirmation keeps the comment on the item and in the audit', async () => {
    const { svc, ds } = fresh();
    const ae = await svc.user('u-ae-arsh');
    const doa = await svc.user('u-pwvsb-doa');
    const t = ds.tenders.find((x) => x.companyId === 'co-arsh' && x.status === 'open')!;
    await svc.doTenderStep(ae, t.id, 'g02_07', 'Tiada taklimat dalam notis', [], { status: 'na', ref: 'Notis para 4' });
    await expect(svc.confirmTenderNa(doa, t.id, 'g02_07', true)).rejects.toThrow(NEEDS);
    const after = await svc.confirmTenderNa(doa, t.id, 'g02_07', true, 'Notice has no briefing');
    expect(after.protocolDone!.find((x) => x.stepId === 'g02_07')!.naConfirmNote).toBe('Notice has no briefing');
    expect(ds.audit.at(-1)!.summary).toMatch(/Notice has no briefing/);
  });

  it('branch settlement', async () => {
    const { svc, ds } = fresh();
    const sasa = await svc.user('u-cm-sasa');
    const row = (await svc.branchBoard(sasa)).rows.find((r) => r.canApprove)!;
    await expect(svc.approveBranchSettlement(sasa, row.settlement!.id, '')).rejects.toThrow(/comment with the approval/);
    const s = await svc.approveBranchSettlement(sasa, row.settlement!.id, 'Figures agree with the ledger');
    expect(s.status).toBe('approved');
    expect(s.approveNote).toBe('Figures agree with the ledger');
    expect(ds.audit.at(-1)!.summary).toMatch(/Figures agree with the ledger/);
  });

  it('trip before travel', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-inas');
    const cos = await svc.user('u-cos');
    const asked = await svc.requestTrip(cm, { date: TODAY, destination: 'Client site, Seremban', purpose: 'Quarterly client review' });
    await expect(svc.decideTrip(cos, asked.id, true, '')).rejects.toThrow(NEEDS);
    await svc.decideTrip(cos, asked.id, true, 'ok');
  });

  it('the CEO access-list review through the IT screen passes the comment on', async () => {
    const { svc, ds } = fresh();
    const ceo = await svc.user('u-fauzan');
    await expect(svc.itAct(ceo, 'reviewAccount', { id: 'itac-5' })).rejects.toThrow(NEEDS);
    expect(await svc.itAct(ceo, 'reviewAccount', { id: 'itac-5', note: 'List matches the admin centre' })).toMatchObject({ reviewedOn: TODAY });
    expect(ds.audit.at(-1)!.summary).toMatch(/List matches the admin centre/);
  });

  it('a rejection still needs its own longer reason', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-inas');
    const cos = await svc.user('u-cos');
    const asked = await svc.requestTrip(cm, { date: TODAY, destination: 'Client site, Seremban', purpose: 'Quarterly client review' });
    await expect(svc.decideTrip(cos, asked.id, false, 'no')).rejects.toThrow(/Say why/);
  });
});
