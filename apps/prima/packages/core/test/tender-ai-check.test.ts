// The AI check of a desk bid's checklist against the tender papers (Fauzan, 23 Nov 2026 decision card: "Yes, AI checks
// once, person answers"). The AI is a stub here; synthetic papers only.
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, addDays, generateDataset, tenderAiExcerpt, tenderAiFlags, tenderAiPapers, TENDER_AI_CHECK_MAX_CHARS, type TenderAiCheckInput } from '../src';

const TODAY = '2026-11-23';
const NOW = '2026-11-23T03:00:00.000Z';
function pdf(name: string, lines: string[]) {
  const content = deflateSync(Buffer.from(lines.map((l, i) => `BT /F1 12 Tf 20 ${700 - i * 14} Td (${l.replace(/[()\\]/g, (c) => `\\${c}`)}) Tj ET`).join('\n')));
  const body = Buffer.concat([
    Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/Contents 4 0 R>>endobj\n4 0 obj<</Length ${content.length}/Filter/FlateDecode>>stream\n`),
    content,
    Buffer.from('\nendstream\nendobj\ntrailer<</Root 1 0 R>>\n%%EOF'),
  ]);
  return { kind: 'document' as const, name, data: 'data:application/pdf;base64,' + body.toString('base64') };
}
let n = 0;
const file = (name?: string) => pdf(name ?? `File ${++n}.pdf`, [`Synthetic file ${++n} (mock)`]);
const ARAHAN = ['Petender hendaklah berdaftar dengan MOF kod bidang 222301.', 'Sijil keahlian PPKKM yang sah hendaklah dilampirkan.', 'Penyata bank enam (6) bulan terkini.'];

async function deskBid() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  await svc.startMarketingDesk(await svc.user('u-fauzan'), TODAY, 'Marketing does all from today');
  const covers = (id: string) => ds.grants.some((g) => g.userId === id && g.companyId === 'co-sasa');
  const own = ds.users.find((u) => u.marketingRole === 'executive' && covers(u.id))!;
  for (const l of ds.licences.filter((x) => x.companyId === 'co-sasa')) l.expiresOn = addDays(TODAY, 400);
  await svc.recordTenderOpportunity(own, { kind: 'TENDER', ref: 'AIC-1', title: 'Guarding (mock)', buyer: 'Buyer (mock)', channel: 'GOVERNMENT', source: 'Portal', closesOn: addDays(TODAY, 20), guards: 5, note: '', companyIds: ['co-sasa'] });
  const id = ds.tenders.find((x) => x.ref === 'AIC-1')!.id;
  const t = () => ds.tenders.find((x) => x.id === id)!;
  await svc.addTenderPapers(own, id, 'ARAHAN', [pdf('Arahan.pdf', ARAHAN)]);
  await svc.draftTenderChecklist(own, id);
  const row = async () => (await svc.commercial(own, 'co-sasa')).tenders.find((r) => r.tender.id === id)!;
  for (const s of (await row()).protocol.filter((s) => !s.done && !s.step.auto && s.step.before === 'preparing')) await svc.doTenderStep(own, id, s.step.id, 'ok', s.step.needsDocument ? [file()] : []);
  await svc.updateTender(own, id, 'preparing');
  for (const s of (await row()).protocol.filter((s) => !s.done && !s.step.auto)) await svc.doTenderStep(own, id, s.step.id, 'ok', s.step.needsDocument ? [file()] : []);
  for (const c of (await row()).checklist.filter((c) => !c.done)) await svc.doTenderStep(own, id, c.item.id, 'ok', c.item.needsDocument ? [file()] : []);
  await svc.setTenderBidFiles(own, id, [{ part: 'HARGA', required: 'Jadual Harga.pdf' }]);
  await svc.uploadTenderBidFile(own, id, t().bidFiles![0].id, [file('Jadual Harga.pdf')]);
  return { ds, svc, own, id, t, dep: await svc.user('u-mkt-dep'), mgr: await svc.user('u-mkt-mgr') };
}

describe('AI check of the tender checklist', () => {
  it('keeps only points whose words are really in the paper, and cuts very long papers', () => {
    const papers = [{ name: 'Arahan.pdf', text: ARAHAN.join(' ') }];
    const { flags, dropped } = tenderAiFlags(
      {
        flags: [
          { kind: 'MISSING', what: 'PPKKM membership certificate', quote: 'Sijil keahlian PPKKM yang sah', paper: 'Arahan.pdf' },
          { kind: 'MISSING', what: 'Invented requirement', quote: 'Sijil yang tidak wujud dalam kertas', paper: 'Arahan.pdf' },
          { kind: 'DIFFERENT', what: 'Six months of statements', quote: 'penyata BANK enam (6)', paper: 'Other.pdf' },
          { kind: 'WRONG', what: 'x', quote: 'y', paper: 'Arahan.pdf' },
        ],
      },
      papers,
    );
    expect(flags.map((f) => f.what)).toEqual(['PPKKM membership certificate']);
    expect(dropped).toBe(3);
    expect(() => tenderAiFlags('nonsense', papers)).toThrow();
    const big = tenderAiPapers([{ name: 'A', text: 'mesti '.repeat(Math.ceil((TENDER_AI_CHECK_MAX_CHARS - 10) / 6)).slice(0, TENDER_AI_CHECK_MAX_CHARS - 10) }, { name: 'B', text: 'wajib '.repeat(10) }, { name: 'C', text: 'syarat' }, { name: 'D', text: null }]);
    expect(big.partial).toEqual(['B']);
    expect(big.skipped).toEqual(['C']);
    // Only the requirement lines (with a line either side) are sent, word for word.
    const paper = ['Kandungan', 'Bab 1 Pengenalan', 'Sejarah agensi', 'Logo dan visi', 'Misi', 'Penyata bank enam (6) bulan terkini hendaklah dilampirkan.', 'Nota kaki', 'Penutup'].join('\n');
    const ex = tenderAiExcerpt(paper);
    expect(ex).toBe(['Misi', 'Penyata bank enam (6) bulan terkini hendaklah dilampirkan.', 'Nota kaki'].join('\n'));
    expect(tenderAiExcerpt('A\nmesti hadir\nB\nC\nD\nwajib daftar\nE')).toBe('A\nmesti hadir\nB\n...\nD\nwajib daftar\nE');
  });

  it('runs once when the preparer signs, and the Marketing check waits until every point is answered', async () => {
    const { svc, own, id, t, dep, mgr } = await deskBid();
    const calls: TenderAiCheckInput[] = [];
    const ai = async (input: TenderAiCheckInput) => {
      calls.push(input);
      return {
        flags: [
          { kind: 'MISSING', what: 'PPKKM membership certificate', quote: 'Sijil keahlian PPKKM yang sah hendaklah dilampirkan', paper: 'Arahan.pdf' },
          { kind: 'DIFFERENT', what: 'Bank statements for 6 months, not 3', quote: 'Penyata bank enam (6) bulan terkini', paper: 'Arahan.pdf' },
          { kind: 'MISSING', what: 'Made-up item', quote: 'This sentence is not in any paper', paper: 'Arahan.pdf' },
        ],
      };
    };
    await svc.verifyTender(own, id, true, '', ai);
    expect(calls).toHaveLength(1);
    // Only the papers' text and the checklist labels are sent: no staff names.
    expect(calls[0].papers.map((p) => p.name)).toEqual(['Arahan.pdf']);
    expect(JSON.stringify(calls[0])).not.toContain(own.name);
    expect(t().aiCheck).toMatchObject({ read: ['Arahan.pdf'], dropped: 1, error: null });
    expect(t().aiCheck!.flags.map((f) => f.kind)).toEqual(['MISSING', 'DIFFERENT']);
    await expect(svc.verifyTender(dep, id, true, 'Checked against the papers')).rejects.toThrow(/Answer every point the AI check raised first \(2 open\)/);
    // The preparer and other executives cannot answer; the Deputy must give a reason.
    await expect(svc.answerTenderAiFlag(own, id, 'aif-1', 'FIXED', 'Added it')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.answerTenderAiFlag(dep, id, 'aif-1', 'FIXED', '')).rejects.toThrow(/what was fixed/);
    // Sending back keeps the AI check; it does not run again when the preparer signs again.
    await svc.verifyTender(dep, id, false, 'Add the PPKKM certificate');
    await svc.verifyTender(own, id, true, '', ai);
    expect(calls).toHaveLength(1);
    await svc.answerTenderAiFlag(dep, id, 'aif-1', 'FIXED', 'PPKKM certificate added to the checklist and attached');
    await svc.answerTenderAiFlag(mgr, id, 'aif-2', 'NOT_NEEDED', 'Amendment 1 changed it to 3 months');
    expect(t().aiCheck!.flags.every((f) => f.answer)).toBe(true);
    await svc.verifyTender(dep, id, true, 'Checked against the papers and the AI points');
    await expect(svc.answerTenderAiFlag(mgr, id, 'aif-2', 'FIXED', 'late')).rejects.toThrow(/already given/);
  });

  it('lets the bid go on when the AI cannot run or is switched off', async () => {
    const { svc, own, id, t, dep } = await deskBid();
    await svc.verifyTender(own, id, true, '', async () => {
      throw new Error('MODEL_UNAVAILABLE');
    });
    expect(t().aiCheck).toMatchObject({ flags: [], error: expect.stringMatching(/could not run/) });
    await svc.verifyTender(dep, id, true, 'Checked against the papers');
    // With the switch off nothing is recorded.
    const other = await deskBid();
    await other.svc.verifyTender(other.own, other.id, true, '');
    expect(other.t().aiCheck).toBeUndefined();
  });
});
