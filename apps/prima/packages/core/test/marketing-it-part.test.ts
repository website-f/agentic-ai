// IT tenders on the Marketing desk (item AH12; Fauzan 22 Nov 2026 D5: Marketing lodges, IT writes the technical part
// and the IT price). Synthetic records only.
import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, addDays, generateDataset } from '../src';

const TODAY = '2026-11-23';
const NOW = '2026-11-23T03:00:00.000Z';
let n = 0;
const proof = (name?: string) => ({ kind: 'document' as const, name: name ?? `File ${++n}.pdf`, data: 'data:application/pdf;base64,' + btoa(`%PDF-1.4 synthetic it part ${++n}\n%%EOF`) });

describe('IT part of a Marketing desk bid (AH12)', () => {
  it('Marketing sends it to IT, IT prepares and hands it back, and the bid waits for the hand-over', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    await svc.startMarketingDesk(await svc.user('u-fauzan'), TODAY, 'Marketing does all from today');
    const covers = (id: string) => ds.grants.some((g) => g.userId === id && g.companyId === 'co-sasa');
    const own = ds.users.find((u) => u.marketingRole === 'executive' && covers(u.id))!;
    const other = ds.users.find((u) => u.marketingRole === 'executive' && !covers(u.id))!;
    for (const l of ds.licences.filter((x) => x.companyId === 'co-sasa')) l.expiresOn = addDays(TODAY, 400);
    await svc.recordTenderOpportunity(own, { kind: 'TENDER', ref: 'MKT-IT-1', title: 'CCTV for district offices (mock)', buyer: 'Buyer (mock)', channel: 'GOVERNMENT', source: 'ePerolehan', closesOn: addDays(TODAY, 20), guards: 0, note: '', companyIds: ['co-sasa'] });
    const t = ds.tenders.find((x) => x.ref === 'MKT-IT-1')!;

    await expect(svc.sendTenderToIt(other, t.id, { codes: ['210104'] })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.sendTenderToIt(await svc.user('u-pwvsb-doa'), t.id, { codes: ['210104'] })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.sendTenderToIt(own, t.id, { codes: ['210103'] })).rejects.toThrow(/does not hold code 210103/);
    const task = await svc.sendTenderToIt(own, t.id, { codes: ['210104'], items: ['Technical proposal'] });
    await expect(svc.sendTenderToIt(own, t.id, { codes: ['210104'] })).rejects.toThrow(/already with IT/);
    expect(task.tenderId).toBe(t.id);
    expect(task.companyDocs).toEqual([]);
    const keys = task.steps!.map((s) => s.key);
    for (const k of ['askdocs', 'gotdocs', 'submit', 'confirm']) expect(keys).not.toContain(k);
    expect(task.steps!.find((s) => s.key === 'result')!.after).toBe('handover');

    const row = async () => (await svc.commercial(own, 'co-sasa')).tenders.find((r) => r.tender.id === t.id)!;
    expect((await row()).itPart).toMatchObject({ stage: 'preparing', handedOver: null, partsTotal: 1 });

    // IT runs its usual timeline, without the company papers and without lodging.
    const mgr = await svc.user('u-it-mgr');
    const ex1 = await svc.user('u-it-ex1');
    const lead = await svc.user('u-it-lead');
    const step = (u: typeof mgr, key: string, i: Record<string, unknown> = {}) => svc.itTenderStep(u, task.id, 'step', { key, ...i });
    await step(mgr, 'found');
    await step(mgr, 'go');
    await step(ex1, 'download');
    await step(ex1, 'read');
    await svc.itTenderStep(mgr, task.id, 'fileName', { index: 0, fileName: 'Lampiran A' });
    await svc.itTenderStep(ex1, task.id, 'done', { index: 0, proof: [proof('Lampiran A.pdf')], checked: true });
    await step(ex1, 'draft');
    await step(lead, 'check');
    await step(mgr, 'price');
    await step(await svc.user('u-coo'), 'leaders', { note: 'Price fine' });
    await expect(step(ex1, 'submit', { proof: [proof()] })).rejects.toThrow();
    // Get the desk bid to "preparing" the usual way.
    await svc.addTenderPapers(own, t.id, 'ARAHAN', [proof()]);
    await svc.draftTenderChecklist(own, t.id);
    for (const s of (await row()).protocol.filter((s) => !s.done && !s.step.auto && s.step.before === 'preparing'))
      await svc.doTenderStep(own, t.id, s.step.id, 'ok', s.step.needsDocument ? [proof()] : []);
    await svc.updateTender(own, t.id, 'preparing');
    await expect(svc.submitTender(own, t.id, '', [proof()])).rejects.toThrow(/not handed over the IT part/);
    expect((await step(mgr, 'handover', { note: 'Marketing executive (mock)' })).stage).toBe('handed_over');
    expect((await row()).itPart!.handedOver?.by).toBe(mgr.name);
    // Marketing never sees the IT files or the IT price through the bid row; after the hand-over the bid can go on.
    expect(JSON.stringify(await row())).not.toContain('Lampiran A.pdf');
    await expect(svc.submitTender(own, t.id, '', [proof()])).rejects.not.toThrow(/IT part/);
  });
});
