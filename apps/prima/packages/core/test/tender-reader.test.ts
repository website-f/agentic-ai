// Tender paper reader (Marketing item AH9; Fauzan 23 Nov 2026 "Use system more than ai"). Synthetic papers only.
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, addDays, generateDataset, pdfText, ruleTenderReader, type Tender } from '../src';

const TODAY = '2026-11-23';
const NOW = '2026-11-23T03:00:00.000Z';

function pdf(name: string, lines: string[]): { kind: 'document'; name: string; data: string } {
  const esc = (s: string) => s.replace(/[()\\]/g, (c) => `\\${c}`);
  const content = deflateSync(Buffer.from(lines.map((l, i) => `BT /F1 12 Tf 20 ${700 - i * 14} Td (${esc(l)}) Tj ET`).join('\n')));
  const body = Buffer.concat([
    Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/Contents 4 0 R>>endobj\n4 0 obj<</Length ${content.length}/Filter/FlateDecode>>stream\n`),
    content,
    Buffer.from('\nendstream\nendobj\ntrailer<</Root 1 0 R>>\n%%EOF'),
  ]);
  return { kind: 'document', name, data: 'data:application/pdf;base64,' + body.toString('base64') };
}
const scanned = (name: string) => ({ kind: 'document' as const, name, data: 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n1 0 obj<</Type/XObject/Subtype/Image/Length 3>>stream\nabc\nendstream\nendobj\n%%EOF').toString('base64') });

const ARAHAN = [
  'ARAHAN KEPADA PETENDER (mock).',
  'Petender hendaklah berdaftar dengan Kementerian Kewangan (MOF) di bawah kod bidang 222301 dan 222302.',
  'Tender ini terbuka kepada syarikat Bumiputera sahaja.',
  'Lesen KDN di bawah Akta Agensi Persendirian 1971 yang sah hendaklah dikemukakan.',
  'Salinan penyata bank tiga (3) bulan terkini.',
  'Penyata kewangan yang diaudit bagi dua (2) tahun terakhir.',
  'Taklimat tender adalah wajib dan akan diadakan pada 1 Disember 2026 jam 10 pagi.',
  'Pengalaman sekurang-kurangnya 3 tahun dalam perkhidmatan kawalan keselamatan.',
  'Petender hendaklah menandatangani Pakatan Integriti dan mengisi Lampiran A1, Lampiran A2 dan Borang B.',
  'Tawaran hendaklah sah laku selama 90 hari dari tarikh tutup.',
];

describe('Tender paper reader (AH9)', () => {
  it('reads the text of a PDF and finds nothing in a scanned page', async () => {
    expect(await pdfText(pdf('A.pdf', ['Hello tender (mock)']).data)).toContain('Hello tender (mock)');
    expect(await pdfText(scanned('Scan.pdf').data)).toBeNull();
    expect(await pdfText('data:image/png;base64,AAAA')).toBeNull();
  });

  it('drafts items from the rules, with where they were found, and keeps the usual ones not found', async () => {
    const text = (await pdfText(pdf('Arahan.pdf', ARAHAN).data))!;
    const t = { channel: 'GOVERNMENT' } as Tender;
    const items = await ruleTenderReader.draft(t, [{ name: 'Arahan.pdf', kind: 'ARAHAN', text }]);
    const labels = items.map((i) => i.label);
    expect(labels).toContain('MOF registration with code 222301, 222302, valid to the closing date');
    expect(labels).toContain('Bumiputera status certificate (Sijil Taraf Bumiputera)');
    expect(labels).toContain('Bank statements for the last 3 months');
    expect(labels).toContain('Audited accounts for the last 2 years');
    expect(labels).toContain('Attend the mandatory briefing on 1 Disember 2026 and keep the attendance slip');
    expect(labels).toContain('Experience letters or contracts for the last 3 years');
    expect(labels).toContain('Offer valid for 90 days');
    expect(labels.find((l) => l.startsWith('Fill in and sign the forms named'))).toBe('Fill in and sign the forms named: Lampiran A1, Lampiran A2, Borang B');
    expect(items.find((i) => i.label.startsWith('Bank statements'))!.ref).toBe('Arahan.pdf');
    // SSM is usual for a government tender but not in these papers: listed, marked not found.
    expect(items.find((i) => i.label.startsWith('SSM'))!.ref).toBe('Not found in the papers');
    // Nothing invented: a site visit is not in the papers and is not usual.
    expect(labels.some((l) => /site visit/.test(l))).toBe(false);
    // A private tender is not given the government's usual items.
    const priv = await ruleTenderReader.draft({ channel: 'PRIVATE' } as Tender, [{ name: 'RFP.pdf', kind: 'ARAHAN', text: 'Request for proposal (mock). Public liability insurance is required.' }]);
    expect(priv.map((i) => i.label)).toEqual(['KDN private agency licence, valid, with the states or armed work asked', 'Insurance cover asked (public liability, workers)']);
  });

  it('drafts a desk bid checklist from the uploaded papers and names the papers it could not read', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    await svc.startMarketingDesk(await svc.user('u-fauzan'), TODAY, 'Marketing does all from today');
    const own = ds.users.find((u) => u.marketingRole === 'executive' && ds.grants.some((g) => g.userId === u.id && g.companyId === 'co-sasa'))!;
    await svc.recordTenderOpportunity(own, { kind: 'TENDER', ref: 'RD-1', title: 'Guarding (mock)', buyer: 'Buyer (mock)', channel: 'GOVERNMENT', source: 'Portal', closesOn: addDays(TODAY, 20), guards: 5, note: '', companyIds: ['co-sasa'] });
    const t = ds.tenders.find((x) => x.ref === 'RD-1')!;
    await svc.addTenderPapers(own, t.id, 'ARAHAN', [pdf('Arahan Petender.pdf', ARAHAN)]);
    await svc.addTenderPapers(own, t.id, 'TAKLIMAT', [scanned('Notis taklimat (imbasan).pdf')]);
    const done = await svc.draftTenderChecklist(own, t.id);
    expect(done.checklistRead).toMatchObject({ read: ['Arahan Petender.pdf'], unread: ['Notis taklimat (imbasan).pdf'] });
    expect(done.checklist![0].label).toBe('Read by hand: Notis taklimat (imbasan).pdf');
    expect(done.checklist!.some((c) => c.label === 'Bank statements for the last 3 months' && c.source === 'ai')).toBe(true);
    expect(ds.audit.some((a) => a.action === 'tender.checklist_draft' && a.entityId === t.id)).toBe(true);
  });
});
