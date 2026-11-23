// Proposals on the Marketing desk (item AH8; Fauzan 23 Nov 2026: our own offer to a private client, without tender
// papers). Synthetic records only.
import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PROPOSAL_CHECKLIST, PrimaService, addDays, generateDataset } from '../src';

const TODAY = '2026-11-23';
const NOW = '2026-11-23T03:00:00.000Z';
let n = 0;
const proof = () => ({ kind: 'document' as const, name: `Proposal file ${++n}.pdf`, data: 'data:application/pdf;base64,' + btoa(`%PDF-1.4 synthetic proposal ${n}\n%%EOF`) });
const input = { companyId: 'co-sasa', client: 'Test Mall Sdn Bhd (mock)', title: 'Guarding for a shopping mall (mock)', scope: '6 day posts, 4 night posts, 12-hour shifts', contact: 'Facilities manager (mock)', sendBy: addDays(TODAY, 7), guards: 14, sites: 1 };

describe('Marketing proposal (AH8)', () => {
  it('is started only by covering Marketing staff after the desk starts, and runs to "sent" without tender papers', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    const covers = (id: string) => ds.grants.some((g) => g.userId === id && g.companyId === 'co-sasa');
    const own = ds.users.find((u) => u.marketingRole === 'executive' && covers(u.id))!;
    const other = ds.users.find((u) => u.marketingRole === 'executive' && !covers(u.id))!;
    const dep = await svc.user('u-mkt-dep');
    const cm = await svc.user('u-cm-sasa');
    const ae = await svc.user('u-ae-sasa');
    for (const l of ds.licences.filter((x) => x.companyId === 'co-sasa')) l.expiresOn = addDays(TODAY, 400);

    await expect(svc.startProposal(own, input)).rejects.toThrow(/has not started/);
    await svc.startMarketingDesk(await svc.user('u-fauzan'), TODAY, 'Marketing does all from today');
    for (const u of [other, cm, ae, await svc.user('u-pwvsb-doa')]) await expect(svc.startProposal(u, input)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.startProposal(own, { ...input, client: '' })).rejects.toThrow(/client/);
    await expect(svc.startProposal(own, { ...input, sendBy: addDays(TODAY, -1) })).rejects.toThrow(/past/);
    await expect(svc.startProposal(own, { ...input, guards: 1.5 })).rejects.toThrow(/whole numbers/);

    const p = await svc.startProposal(own, input);
    expect(p).toMatchObject({ desk: 'MARKETING', channel: 'PRIVATE', status: 'open', buyer: input.client });
    expect(p.checklist!.map((c) => c.id)).toEqual(PROPOSAL_CHECKLIST.map((c) => c.id));
    expect(ds.audit.some((a) => a.action === 'proposal.start' && a.entityId === p.id)).toBe(true);
    // The company manager is told and may say "do not bid".
    expect((await svc.home(cm, 'co-sasa')).todo.some((i) => /Marketing will send a proposal/.test(i.title))).toBe(true);
    // No tender papers and no protocol: the checklist is fixed.
    await expect(svc.draftTenderChecklist(own, p.id)).rejects.toThrow(/proposal checklist/);
    const row = async () => (await svc.commercial(own, 'co-sasa')).tenders.find((r) => r.tender.id === p.id)!;
    expect((await row()).protocol).toEqual([]);
    expect((await row()).stage).toMatch(/start preparing the proposal/);
    await svc.updateTender(own, p.id, 'preparing');
    await expect(svc.doTenderStep(ae, p.id, 'prp_client', 'ok')).rejects.toBeInstanceOf(AccessDenied);
    for (const c of p.checklist!) {
      if (c.id === 'prp_experience') await svc.doTenderStep(own, p.id, c.id, 'New company, no similar client yet', [], { status: 'na' });
      else await svc.doTenderStep(own, p.id, c.id, 'ok', c.needsDocument ? [proof()] : []);
    }
    // A "does not apply" still waits for a supervisor, but needs no arahan reference.
    expect((await row()).stage).not.toMatch(/send it/i);
    await svc.confirmTenderNa(dep, p.id, 'prp_experience', true, 'Fine for a new company');
    // Sign-off as for a desk bid: preparer, Marketing check, company manager (price).
    await svc.verifyTender(own, p.id, true, '');
    await svc.verifyTender(dep, p.id, false, 'Validity period missing from the letter');
    expect(ds.tenders.find((x) => x.id === p.id)!.checkCaught).toHaveLength(1);
    await svc.verifyTender(own, p.id, true, '');
    await svc.verifyTender(dep, p.id, true, 'Checked, letter and price schedule agree');
    await svc.verifyTender(cm, p.id, true, 'Price approved');
    expect((await row()).stage).toMatch(/Send it to the client/);
    await svc.recordTenderHours(own, p.id, 1.5);
    await expect(svc.submitTender(own, p.id, 'Emailed', [])).rejects.toThrow(/copy of the proposal/);
    const sent = await svc.submitTender(own, p.id, 'Emailed to the facilities manager', [proof()]);
    expect(sent.status).toBe('submitted');
    // The board counts proposals apart from tenders; a proposal does not clear the red.
    const board = await svc.marketingBoard(await svc.user('u-mkt-mgr'));
    const sasa = board.rows.find((r) => r.companyId === 'co-sasa')!;
    expect(sasa).toMatchObject({ entered: 0, proposals: 1 });
    expect(board.totals.proposals).toBe(1);
    // Won or lost is recorded by Marketing as for a desk bid.
    expect((await svc.updateTender(own, p.id, 'won')).status).toBe('won');
  });

  it('reminds Marketing, never the COO, when a proposal is late, and still lets it be sent', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    let now = NOW;
    const svc = new PrimaService(new MemoryStore(ds), () => now);
    const covers = (id: string) => ds.grants.some((g) => g.userId === id && g.companyId === 'co-sasa');
    const own = ds.users.find((u) => u.marketingRole === 'executive' && covers(u.id))!;
    await svc.startMarketingDesk(await svc.user('u-fauzan'), TODAY, 'Marketing does all from today');
    const p = await svc.startProposal(own, { ...input, sendBy: addDays(TODAY, 1) });
    now = '2026-11-26T03:00:00.000Z';
    const alerts = (await svc.marketingBoard(own)).alerts.filter((a) => a.go.tenderId === p.id);
    expect(alerts.map((a) => a.level)).toEqual(['closing']);
    expect(alerts[0].title).toMatch(/late/);
    expect((await svc.home(await svc.user('u-coo'))).todo.some((i) => i.title.includes(p.title))).toBe(false);
    expect((await svc.updateTender(own, p.id, 'preparing')).status).toBe('preparing');
  });
});
