import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt } from '../src';

// P78 (Agentic Office): the owner, signed in as Prima's CEO record, is the master administrator. On the ACT, audit,
// legal, assurance and continuity screens he may enter and start every record; checks and approvals keep their own
// people, and nobody approves what they entered. Dummy data only.
const TODAY = '2026-11-03';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
};

describe('Owner as master administrator: ACT', () => {
  it('lets the owner raise a finding and record an audit, while ACT keeps the checks', async () => {
    const { svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const b = await svc.actBoard(ceo);
    expect(b.canRaise).toBe(true);
    expect(b.canRecordAudit).toBe(true);
    expect(b.canCheck).toBe(false);
    const f = await svc.raiseActFinding(ceo, {
      companyId: 'co-arsh',
      area: 'ATTENDANCE',
      source: 'manual',
      title: 'Sign-in sheets missing at a site',
      detail: '',
      severity: 'medium',
      evidence: 'Visit on 2 Nov',
      ownerUserId: 'u-cm-arsh',
    });
    expect(f.raisedById).toBe('u-fauzan');
    expect(f.team).toBeNull();
    const a = await svc.recordActAudit(ceo, { area: 'ATTENDANCE', companyId: 'co-arsh', doneOn: '2026-11-02', result: 'findings', note: 'Ten sheets sampled', findingIds: [f.id] });
    expect(a.by).toBe('Fauzan');
    // The owner cannot check a fix or close work given to an ACT team.
    await expect(svc.actFindingStep(ceo, f.id, 'check', { ok: true, note: 'x' })).rejects.toThrow(/Auditor/);
    // Another Director-role sign-in that is not the CEO stays a watcher.
    const chair = await svc.user('u-chair');
    await expect(svc.raiseActFinding(chair, { companyId: null, area: 'IT', source: 'manual', title: 'x', detail: '', severity: 'low', evidence: 'e', ownerUserId: 'u-cos' })).rejects.toThrow(
      /Only ACT staff/,
    );
  });

  it('never lets the owner approve an improvement he proposed; the COO approves it', async () => {
    const { svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const i = await svc.addActImprovement(ceo, { title: 'Weekly roster check', benefit: 'Fewer gaps', findingIds: [], ownerUserId: 'u-cm-arsh', targetOn: '2026-12-31', steps: ['Set the check'] });
    expect(i.ledById).toBe('u-fauzan');
    expect((await svc.actBoard(ceo)).improvements.find((r) => r.improvement.id === i.id)!.canApprove).toBe(false);
    await expect(svc.actImprovementStep(ceo, i.id, 'approve', { note: 'ok' })).rejects.toThrow(/Someone other/);
    await svc.actImprovementStep(await svc.user('u-coo'), i.id, 'approve', { note: 'ok' });
  });
});

describe('Owner as master administrator: audit, legal, assurance and continuity', () => {
  it('registers a statutory audit and records its steps; the manager alone agrees adjustments', async () => {
    const { svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const board = await svc.corpAuditLegal(ceo);
    expect(board.auditCompanies).toContain('co-arsh');
    expect(board.matterCompanies).toContain('co-arsh');
    const a = await svc.addCorpAudit(ceo, 'co-arsh', { fyEnd: '2027-06-30', auditorFirm: 'Audit firm 1 (mock)', fee: 20000, pbc: ['Trial balance', 'Bank confirmations'] });
    expect(a.pbc.map((p) => p.dueOn)).toEqual(['2027-08-09', '2027-08-16']);
    await expect(svc.addCorpAudit(ceo, 'co-arsh', { fyEnd: '2028-12-31', auditorFirm: 'Audit firm 1 (mock)', fee: null, pbc: ['x'] })).rejects.toThrow(/more than a year|already/);
    await expect(svc.addCorpAudit(ceo, 'co-arsh', { fyEnd: '2026-06-30', auditorFirm: 'X', fee: null, pbc: ['x'] })).rejects.toThrow(/audit firm/);
    // A company manager registers their own company's audit; another company's is refused.
    await svc.addCorpAudit(await svc.user('u-cm-arsh'), 'co-arsh', { fyEnd: '2023-03-31', auditorFirm: 'Audit firm 2 (mock)', fee: null, pbc: ['Ledger'] });
    await expect(svc.addCorpAudit(await svc.user('u-cm-sasa'), 'co-arsh', { fyEnd: '2022-03-31', auditorFirm: 'Audit firm 2 (mock)', fee: null, pbc: ['Ledger'] })).rejects.toThrow();
    await svc.corpAuditStep(ceo, a.id, 'planning', { on: '2026-11-01' });
    await svc.corpAuditStep(ceo, a.id, 'add_adjustment', { desc: 'Accrual', amount: 1000 });
    await expect(svc.corpAuditStep(ceo, a.id, 'agree_adjustment', { index: 0 })).rejects.toThrow(/manager agrees/);
    const m = (await svc.addLegalMatter(ceo, 'co-arsh', {
      title: 'Demand from a supplier',
      kind: 'DEMAND',
      counterparty: 'Supplier (mock)',
      side: 'respondent',
      exposure: 5000,
      lawyer: 'Tetuan Mock',
      nextOn: null,
      nextWhat: '',
    })) as { id: string };
    await svc.legalMatterStep(ceo, m.id, 'update', { text: 'Reply sent' });
  });

  it('adds an obligation and records proof; internal audit checks it, never the recorder', async () => {
    const { svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    expect((await svc.grcBoard(ceo)).obligationCompanies).toContain('co-arsh');
    const o = await svc.addGrcObligation(ceo, 'co-arsh', { stream: 'OSH', title: 'Fire drill at head office', basis: 'Fire Services Act 1988', everyMonths: 12 });
    await expect(svc.addGrcObligation(ceo, 'co-arsh', { stream: 'OSH', title: 'fire drill at head office', basis: 'x y z', everyMonths: 12 })).rejects.toThrow(/already/);
    await expect(svc.addGrcObligation(ceo, 'co-arsh', { stream: 'OSH', title: 'Other', basis: 'Act', everyMonths: 0 })).rejects.toThrow(/how often/);
    const row = (await svc.grcBoard(ceo)).obligations.find((r) => r.item.id === o.id)!;
    expect(row.state).toBe('unknown');
    expect(row.canProve).toBe(true);
    await svc.grcEvidence(ceo, o.id, '2026-11-01', 'Drill report 1/2026');
    await expect(svc.grcCheck(ceo, o.id, true, '')).rejects.toThrow();
    await svc.grcCheck(await svc.user('u-audit'), o.id, true, 'Seen the report');
  });

  it('lists a continuity system and records backups and drills; the Chairman only watches', async () => {
    const { svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    expect((await svc.bcmBoard(ceo)).canRecord).toBe(true);
    const s = await svc.addBcmSystem(ceo, {
      name: 'Payroll test system',
      impact: 'Staff are not paid',
      rtoHours: 8,
      rpoHours: 24,
      copies: [{ site: 'CLOUD', where: 'Azure Malaysia West (mock)', inMalaysia: true }],
    });
    expect((await svc.bcmBoard(ceo)).systems.find((r) => r.system.id === s.id)!.state).toBe('unknown');
    await svc.bcmRecord(ceo, s.id, 0, 'backup', {});
    const chair = await svc.user('u-chair');
    expect((await svc.bcmBoard(chair)).canRecord).toBe(false);
    await expect(svc.addBcmSystem(chair, { name: 'x2', impact: 'abc', rtoHours: 1, rpoHours: 1, copies: [{ site: 'CLOUD', where: 'x', inMalaysia: true }] })).rejects.toThrow();
  });
});
