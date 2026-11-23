// Marketing desk (Fauzan, 22-23 Nov 2026): one central Marketing department prepares and lodges every tender in each
// company's name. Synthetic records only.
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, RULES, addDays, can, checkCaughtItems, generateDataset, isMarketing, isMarketingLead, verifyChain, type Dataset, type User } from '../src';

const TODAY = '2026-11-23';
const NOW = '2026-11-23T03:00:00.000Z';

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  let now = NOW;
  const svc = new PrimaService(new MemoryStore(ds), () => now);
  return { ds, svc, at: (t: string) => (now = t) };
}

function pdf(name: string, text: string): { kind: 'document'; name: string; data: string } {
  const content = deflateSync(Buffer.from(`BT /F1 12 Tf 20 60 Td [(${text})] TJ ET`));
  const body = Buffer.concat([
    Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/Contents 4 0 R>>endobj\n4 0 obj<</Length ${content.length}/Filter/FlateDecode>>stream\n`),
    content,
    Buffer.from('\nendstream\nendobj\n5 0 obj<</Author(Staff)/Title(Bid)>>endobj\ntrailer<</Root 1 0 R/Info 5 0 R>>\n%%EOF'),
  ]);
  return { kind: 'document', name, data: 'data:application/pdf;base64,' + body.toString('base64') };
}
let n = 0;
const proof = () => pdf(`Paper ${++n}.pdf`, `Paper ${n}`);

/** The Tender Executive who covers a company, and one who does not. */
function execs(ds: Dataset, companyId: string) {
  const covers = (u: User) => ds.grants.some((g) => g.userId === u.id && g.companyId === companyId);
  const all = ds.users.filter((u) => u.marketingRole === 'executive');
  return { own: all.find(covers)!, other: all.find((u) => !covers(u))! };
}

const base = { kind: 'TENDER', ref: 'MKT-0001', title: 'Guarding services, test zone (mock)', buyer: 'Test Utility (mock)', channel: 'GOVERNMENT' as const, source: 'Public portal', closesOn: addDays(TODAY, 20), guards: 10, note: '' };

async function startDesk(svc: PrimaService) {
  return svc.startMarketingDesk(await svc.user('u-fauzan'), TODAY, 'Marketing does all from today');
}

describe('Marketing department (Fauzan, 22-23 Nov 2026)', () => {
  it('splits a check note into items, one per line', () => {
    expect(checkCaughtItems('a\n  2) Bank letter expired\n* SST registration missing\n\n')).toEqual(['Bank letter expired', 'SST registration missing']);
    expect(checkCaughtItems('ok!')).toEqual(['ok!']);
    expect(checkCaughtItems(Array.from({ length: 40 }, (_, i) => `Item ${i}`).join('\n'))).toHaveLength(30);
  });

  it('has a Manager, a Deputy and 7 Tender Executives who reach companies only through their grants', async () => {
    const { ds } = fresh();
    const team = ds.users.filter(isMarketing);
    expect(team.filter((u) => u.marketingRole === 'executive')).toHaveLength(7);
    expect(team.filter(isMarketingLead).map((u) => u.marketingRole).sort()).toEqual(['deputy', 'manager']);
    const { own, other } = execs(ds, 'co-sasa');
    expect(can(own, ds.grants, TODAY, 'tender.work', 'co-sasa')).toBe(true);
    expect(can(other, ds.grants, TODAY, 'tender.work', 'co-sasa')).toBe(false);
    // Tender work only: quotations and price approval stay with the company.
    expect(can(own, ds.grants, TODAY, 'commercial.prepare', 'co-sasa')).toBe(false);
    expect(can(own, ds.grants, TODAY, 'commercial.approve', 'co-sasa')).toBe(false);
    // Nobody outside Marketing gets tender.work, whatever grants they hold.
    for (const id of ['u-pwvsb-doa', 'u-cm-sasa', 'u-ae-sasa', 'u-fauzan', 'u-it-mgr']) {
      const u = ds.users.find((x) => x.id === id);
      if (u) expect(can(u, ds.grants, TODAY, 'tender.work', 'co-sasa')).toBe(false);
    }
    expect(RULES.marketingDesk.label).toBe('Policy');
  });

  it('changes nothing until the CEO or the COO starts the desk', async () => {
    const { svc, ds } = fresh();
    const { own } = execs(ds, 'co-sasa');
    const doa = await svc.user('u-pwvsb-doa');
    for (const id of ['u-pwvsb-doa', 'u-cm-sasa', 'u-mkt-mgr', own.id])
      await expect(svc.startMarketingDesk(await svc.user(id), TODAY, 'try')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.startMarketingDesk(await svc.user('u-fauzan'), addDays(TODAY, -1), 'late')).rejects.toThrow(/past/);
    await expect(svc.startMarketingDesk(await svc.user('u-fauzan'), TODAY, '')).rejects.toThrow();
    // Before the start the Director Office still holds the protocol and Marketing cannot record tenders.
    expect((await svc.tenderProtocol(doa)).canEdit).toBe(true);
    expect((await svc.tenderProtocol(await svc.user('u-mkt-mgr'))).canEdit).toBe(false);
    await expect(svc.recordTenderOpportunity(own, { ...base, companyIds: ['co-sasa'] })).rejects.toBeInstanceOf(AccessDenied);
    const o = await svc.recordTenderOpportunity(doa, { ...base, companyIds: ['co-sasa'] });
    const t = ds.tenders.find((x) => x.companyId === 'co-sasa' && x.ref === base.ref)!;
    expect(o.entries).toHaveLength(1);
    expect(t.desk).toBeUndefined();
    await startDesk(svc);
    await expect(startDesk(svc)).rejects.toThrow(/already started/);
    expect(ds.audit.some((a) => a.action === 'tender.marketing_desk')).toBe(true);
    // After the start: Marketing leads hold the protocol; the Director Office monitors.
    expect((await svc.tenderProtocol(doa)).canEdit).toBe(false);
    expect((await svc.tenderProtocol(await svc.user('u-mkt-mgr'))).canEdit).toBe(true);
    // A bid the company started before the desk is finished by the company, not by Marketing.
    await expect(svc.addTenderPapers(own, t.id, 'ARAHAN', [proof()])).rejects.toBeInstanceOf(AccessDenied);
    await svc.addTenderPapers(await svc.user('u-ae-sasa'), t.id, 'ARAHAN', [proof()]);
    expect(verifyChain(ds.audit)).toBeNull();
  });

  it('runs a desk bid: executive prepares, Manager or Deputy checks, company manager approves, executive lodges', async () => {
    const { svc, ds } = fresh();
    await startDesk(svc);
    const { own, other } = execs(ds, 'co-sasa');
    const mgr = await svc.user('u-mkt-mgr');
    const dep = await svc.user('u-mkt-dep');
    const cm = await svc.user('u-cm-sasa');
    const ae = await svc.user('u-ae-sasa');
    const doa = await svc.user('u-pwvsb-doa');
    for (const l of ds.licences.filter((x) => x.companyId === 'co-sasa')) l.expiresOn = addDays(TODAY, 400);
    // An executive records a tender only for a company they cover.
    await expect(svc.recordTenderOpportunity(other, { ...base, companyIds: ['co-sasa'] })).rejects.toBeInstanceOf(AccessDenied);
    await svc.recordTenderOpportunity(own, { ...base, companyIds: ['co-sasa'] });
    const id = ds.tenders.find((x) => x.companyId === 'co-sasa' && x.ref === base.ref)!.id;
    const t = () => ds.tenders.find((x) => x.id === id)!;
    expect(t().desk).toBe('MARKETING');
    // The company manager is told and has 1 day to say "do not bid".
    expect(Date.parse(t().bidNotice!.until) - Date.parse(t().bidNotice!.at)).toBe(RULES.marketingDesk.value.noBidNoticeHours * 3_600_000);
    expect((await svc.home(cm, 'co-sasa')).todo.some((i) => /Marketing will bid/.test(i.title))).toBe(true);
    // The company's admin team, the Director Office and other executives cannot work a desk bid.
    for (const u of [ae, cm, doa, other]) await expect(svc.addTenderPapers(u, id, 'ARAHAN', [proof()])).rejects.toBeInstanceOf(AccessDenied);
    await svc.addTenderPapers(own, id, 'ARAHAN', [proof()]);
    await svc.draftTenderChecklist(own, id);
    expect(t().checklist!.length).toBeGreaterThan(3);
    // No "teruskan" decision and no Director Office checklist review are needed on a desk bid.
    const row = async (u: User) => (await svc.commercial(u, 'co-sasa')).tenders.find((r) => r.tender.id === id)!;
    for (const s of (await row(own)).protocol.filter((s) => !s.done && !s.step.auto && s.step.before === 'preparing'))
      await svc.doTenderStep(own, id, s.step.id, 'ok', s.step.needsDocument ? [proof()] : []);
    expect((await svc.updateTender(own, id, 'preparing')).status).toBe('preparing');
    await expect(svc.doTenderStep(ae, id, (await row(own)).checklist[0].item.id, 'ok', [])).rejects.toBeInstanceOf(AccessDenied);
    for (const s of (await row(own)).protocol.filter((s) => !s.done && !s.step.auto)) await svc.doTenderStep(own, id, s.step.id, 'ok', s.step.needsDocument ? [proof()] : []);
    for (const c of (await row(own)).checklist.filter((c) => !c.done)) await svc.doTenderStep(own, id, c.item.id, 'ok', c.item.needsDocument ? [proof()] : []);
    await svc.setTenderBidFiles(own, id, [
      { part: 'TEKNIKAL', required: 'Dokumen Teknikal.pdf' },
      { part: 'HARGA', required: 'Jadual Harga.pdf' },
    ]);
    const [tek, hrg] = t().bidFiles!;
    await svc.uploadTenderBidFile(own, id, tek.id, [pdf('Dokumen Teknikal.pdf', 'Pelan operasi dan rondaan')]);
    await svc.uploadTenderBidFile(own, id, hrg.id, [pdf('Jadual Harga.pdf', 'Jadual harga')]);
    await svc.confirmTenderBidFile(own, id, tek.id);
    // Sign-off: preparer, then the Marketing check, then the company manager. Nobody signs twice or out of turn.
    expect((await row(own)).myCheck).toBe('PREPARER');
    await expect(svc.verifyTender(cm, id, true, 'too early')).rejects.toBeInstanceOf(AccessDenied);
    // A Manager who prepares a bid personally cannot also check it; the check then goes to the Deputy.
    await svc.verifyTender(mgr, id, true, '');
    await expect(svc.verifyTender(mgr, id, true, 'my own work')).rejects.toBeInstanceOf(AccessDenied);
    // The Deputy sends it back with a reason; the signatures are cleared and the executive signs.
    await expect(svc.verifyTender(own, id, false, 'not mine to send back')).rejects.toBeInstanceOf(AccessDenied);
    await svc.verifyTender(dep, id, false, 'Executive to sign as preparer');
    expect(t().verifications).toEqual([]);
    await svc.verifyTender(own, id, true, '');
    expect((await row(own)).nextCheck).toBe('CHECK');
    // AH14: each line the Marketing check sends back is one item the first pass missed, counted for the preparer.
    await svc.verifyTender(dep, id, false, '1. Price schedule file not named as the tender asks\n- Company search older than 90 days\n-');
    expect(t().checkCaught!.at(-1)).toMatchObject({ byId: dep.id, preparerId: own.id, items: ['Price schedule file not named as the tender asks', 'Company search older than 90 days'] });
    expect(t().checkCaught![0]).toMatchObject({ preparerId: mgr.id, items: ['Executive to sign as preparer'] });
    await svc.verifyTender(own, id, true, '');
    for (const u of [own, other, cm, ae, doa]) await expect(svc.verifyTender(u, id, true, 'not mine')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.verifyTender(dep, id, true, '')).rejects.toThrow();
    await svc.verifyTender(dep, id, true, 'Checked against the tender papers, nothing compulsory missing');
    for (const u of [own, dep, ae, doa]) await expect(svc.verifyTender(u, id, true, 'not mine')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.submitTender(own, id, 'Lodged', [proof()])).rejects.toThrow();
    await expect(svc.verifyTender(cm, id, true, '')).rejects.toThrow();
    await svc.verifyTender(cm, id, true, 'Price and bid approved');
    expect(t().verifications!.map((v) => v.level)).toEqual(['PREPARER', 'CHECK', 'MANAGER']);
    // Marketing lodges; the company's admin team does not.
    await expect(svc.submitTender(ae, id, 'Lodged', [proof()])).rejects.toBeInstanceOf(AccessDenied);
    // The hours worked are recorded by Marketing staff before lodging; they feed the average on the board.
    await expect(svc.submitTender(own, id, 'Lodged in the portal', [proof()])).rejects.toThrow(/working hours/);
    for (const u of [ae, cm, doa, other]) await expect(svc.recordTenderHours(u, id, 2)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.recordTenderHours(own, id, 0.1)).rejects.toThrow(/quarter hours/);
    await svc.recordTenderHours(own, id, 2.5);
    await svc.recordTenderHours(own, id, 0.5, 'price schedule redo');
    const done = await svc.submitTender(own, id, 'Lodged in the portal', [proof()]);
    expect(done.status).toBe('submitted');
    // The tracker counts it for the company; an executive sees only the companies they cover.
    const wide = await svc.marketingBoard(mgr);
    expect(wide.rows.find((r) => r.companyId === 'co-sasa')).toMatchObject({ entered: 1, tone: 'ok' });
    expect(wide.rows.length).toBe(ds.companies.length);
    expect(wide.rows.filter((r) => r.tone === 'crit').length).toBe(wide.totals.zero);
    expect(wide.staff).toHaveLength(9);
    expect(wide.totals.avgHours).toBe(3);
    expect(wide.staff.find((x) => x.id === own.id)).toMatchObject({ bids: 1, avgHours: 3, caught: 2 });
    expect(wide.staff.find((x) => x.id === mgr.id)!.caught).toBe(1);
    expect(wide.totals).toMatchObject({ caught: 3, sentBack: 2, firstPassClean: 0, lodged: 1 });
    expect(wide.staff.find((x) => x.id === other.id)).toMatchObject({ bids: 0, avgHours: null });
    // A company that has entered needs no reason; one with none gets its reason from the executive who covers it.
    await expect(svc.setNoEntryReason(own, 'co-sasa', 'No suitable tender found this month')).rejects.toThrow(/has entered/);
    const idle = wide.rows.find((r) => r.tone === 'crit' && ds.grants.some((g) => g.userId === own.id && g.companyId === r.companyId))!;
    expect(idle.reason).toBeNull();
    for (const u of [other, cm, doa, await svc.user('u-fauzan')])
      await expect(svc.setNoEntryReason(u, idle.companyId, 'No suitable tender found this month')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setNoEntryReason(own, idle.companyId, 'none')).rejects.toThrow(/sentence/);
    await svc.setNoEntryReason(own, idle.companyId, 'MOF registration expired, renewal sent on 20 Nov');
    await svc.setNoEntryReason(mgr, idle.companyId, 'MOF registration expired; renewal with the ministry');
    const after = await svc.marketingBoard(mgr);
    expect(after.rows.find((r) => r.companyId === idle.companyId)!.reason).toMatchObject({ by: mgr.name, reason: 'MOF registration expired; renewal with the ministry' });
    expect(after.totals.noReason).toBe(after.totals.zero - 1);
    // Re-setting the protocol keeps the desk start and the reasons.
    const p = await svc.tenderProtocol(mgr);
    await svc.setTenderProtocol(mgr, { steps: p.protocol.steps, note: 'No change, saved again' });
    expect((await svc.marketingBoard(mgr)).rows.find((r) => r.companyId === idle.companyId)!.reason).not.toBeNull();
    const narrow = await svc.marketingBoard(other);
    expect(narrow.rows.some((r) => r.companyId === 'co-sasa')).toBe(false);
    expect(narrow.staff.map((s) => s.id)).toEqual([other.id]);
    expect(JSON.stringify(wide)).not.toMatch(/estMonthly|monthlyTotal|data:application/);
    for (const u of [cm, ae, doa]) await expect(svc.marketingBoard(u)).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.marketingBoard(await svc.user('u-fauzan'))).deskOn).toBe(true);
    expect(verifyChain(ds.audit)).toBeNull();
  });

  it('lets only the company manager say "do not bid", and shows the COO a company that keeps refusing', async () => {
    const { svc, ds } = fresh();
    await startDesk(svc);
    const { own } = execs(ds, 'co-sasa');
    const cm = await svc.user('u-cm-sasa');
    await svc.recordTenderOpportunity(own, { ...base, companyIds: ['co-sasa'] });
    const id = ds.tenders.find((x) => x.companyId === 'co-sasa' && x.ref === base.ref)!.id;
    // Only the company manager says "do not bid"; Marketing then stops and the company's count shows it.
    await expect(svc.decideTender(own, id, 'TIDAK_BIDA', 'Not ours to say')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.decideTender(cm, id, 'TIDAK_BIDA', '')).rejects.toThrow(/reason/);
    const stopped = await svc.decideTender(cm, id, 'TIDAK_BIDA', 'Site too far from our branch');
    expect(stopped.status).toBe('no_bid');
    await expect(svc.addTenderPapers(own, id, 'ARAHAN', [proof()])).rejects.toThrow();
    const b = await svc.marketingBoard(await svc.user('u-mkt-mgr'));
    expect(b.rows.find((r) => r.companyId === 'co-sasa')).toMatchObject({ noBid: 1, repeatNoBid: false });
    // A second refusal in the month is shown to the COO.
    await svc.recordTenderOpportunity(own, { ...base, ref: 'MKT-0002', companyIds: ['co-sasa'] });
    const id2 = ds.tenders.find((x) => x.companyId === 'co-sasa' && x.ref === 'MKT-0002')!.id;
    await svc.decideTender(cm, id2, 'TIDAK_BIDA', 'No guards free');
    const coo = ds.users.find((u) => u.opsTier === 'coo')!;
    expect((await svc.home(coo)).todo.some((i) => /said "do not bid" 2 times/.test(i.title))).toBe(true);
  });

  it('keeps quotations with the company and warns when a bid is closing', async () => {
    const { svc, ds, at } = fresh();
    await startDesk(svc);
    const { own } = execs(ds, 'co-sasa');
    expect((await svc.commercial(own, 'co-sasa')).quotations).toEqual([]);
    expect((await svc.tenderBoard(own)).quotationsWaiting).toEqual([]);
    await expect(
      svc.createQuotation(own, 'co-sasa', { client: 'Test JMB', siteName: 'Tower A', tenderId: null, guards: 4, hoursPerDay: 12, ratePerGuard: 3200, validDays: 30 }),
    ).rejects.toBeInstanceOf(AccessDenied);
    await svc.recordTenderOpportunity(own, { ...base, closesOn: addDays(TODAY, 3), companyIds: ['co-sasa'] });
    const levels = async () => (await svc.marketingBoard(own)).alerts.map((a) => a.level);
    expect(await levels()).toEqual(['closing']);
    // One day before closing the COO is told.
    at('2026-11-25T03:00:00.000Z');
    expect(await levels()).toEqual(['coo']);
    const coo = ds.users.find((u) => u.opsTier === 'coo')!;
    expect((await svc.home(coo)).todo.some((i) => /closes tomorrow, not lodged/.test(i.title))).toBe(true);
  });
});
