import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, companyNameForms, generateDataset, hasCompanyName } from '../src';

const TODAY = '2026-10-28';
const NOW = '2026-10-28T03:00:00.000Z';

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
}

/** A small PDF: the page text in a compressed stream, and the author in the file properties. */
function pdf(name: string, text: string, author = 'Admin'): { kind: 'document'; name: string; data: string } {
  const content = deflateSync(Buffer.from(`BT /F1 12 Tf 20 60 Td [(${text.slice(0, 9)})-20(${text.slice(9)})] TJ ET`));
  const body = Buffer.concat([
    Buffer.from(
      `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/Contents 4 0 R>>endobj\n4 0 obj<</Length ${content.length}/Filter/FlateDecode>>stream\n`,
    ),
    content,
    Buffer.from(`\nendstream\nendobj\n5 0 obj<</Author(${author})/Title(Bid)>>endobj\ntrailer<</Root 1 0 R/Info 5 0 R>>\n%%EOF`),
  ]);
  return { kind: 'document', name, data: 'data:application/pdf;base64,' + body.toString('base64') };
}

describe('tender bid files (Fauzan, 28 Oct 2026)', () => {
  it('finds the company name in its usual forms, not inside other words', () => {
    const f = companyNameForms({ name: 'Sasa Security Services Sdn Bhd', code: 'SASA' });
    expect(hasCompanyName('SASA SECURITY SERVICES SDN. BHD.', f)).toBe(true);
    expect(hasCompanyName('sasa-security-services', f)).toBe(true);
    expect(hasCompanyName('Logo SASA di kepala surat', f)).toBe(true);
    expect(hasCompanyName('Sasaran perkhidmatan kawalan', f)).toBe(false);
  });

  it('names each file as the tender asks and keeps the company name out of the technical part', async () => {
    const { svc, ds } = fresh();
    const doa = await svc.user('u-pwvsb-doa');
    const cm = await svc.user('u-cm-sasa');
    const t = ds.tenders.find((x) => x.companyId === 'co-sasa' && x.status === 'open' && !x.verifications?.length)!;
    await expect(svc.setTenderBidFiles(doa, t.id, [{ part: 'TEKNIKAL', required: 'Sasa Teknikal.pdf' }])).rejects.toThrow(/company name/);
    await svc.setTenderBidFiles(doa, t.id, [
      { part: 'TEKNIKAL', required: 'Dokumen Teknikal.pdf' },
      { part: 'HARGA', required: 'Jadual Harga.pdf' },
    ]);
    const [tek, hrg] = ds.tenders.find((x) => x.id === t.id)!.bidFiles!;
    const up = (id: string, p: ReturnType<typeof pdf>) => svc.uploadTenderBidFile(cm, t.id, id, [p]);
    await expect(up(tek.id, pdf('Sasa Security Services Sdn Bhd - Teknikal.pdf', 'Pelan operasi'))).rejects.toThrow(/carries the company name/);
    await expect(up(tek.id, pdf('teknikal.pdf', 'Pelan operasi'))).rejects.toThrow(/Rename the file to "Dokumen Teknikal.pdf"/);
    await expect(up(tek.id, pdf('Dokumen Teknikal.pdf', 'Disediakan oleh Sasa Security Services Sdn. Bhd.'))).rejects.toThrow(/technical file \(text\)/);
    await expect(up(tek.id, pdf('Dokumen Teknikal.pdf', 'Pelan operasi', 'Sasa Security Services'))).rejects.toThrow(/\(file properties\)/);
    await up(tek.id, pdf('dokumen teknikal.PDF', 'Sasaran pelan operasi dan rondaan'));
    let row = ds.tenders.find((x) => x.id === t.id)!.bidFiles!;
    expect(row[0].scan).toEqual({ readText: true, where: [] });
    // Only the technical part is checked for the name; the price schedule is signed in the company's name.
    await up(hrg.id, pdf('Jadual Harga.pdf', 'Sasa Security Services Sdn Bhd'));
    // The preparer still checks the technical file page by page, because a scan cannot be read in full.
    const board = await svc.commercial(cm, 'co-sasa');
    expect(board.tenders.find((r) => r.tender.id === t.id)!.bidFileGaps).toEqual(['check "Dokumen Teknikal.pdf" has no company name']);
    await expect(svc.confirmTenderBidFile(cm, t.id, hrg.id)).rejects.toThrow(/Only technical/);
    await svc.confirmTenderBidFile(cm, t.id, tek.id);
    row = ds.tenders.find((x) => x.id === t.id)!.bidFiles!;
    expect(row[0].confirmedBy).toBe(cm.name);
    // Uploading the technical file again clears the check.
    await up(tek.id, pdf('Dokumen Teknikal.pdf', 'Pelan operasi versi 2'));
    expect(ds.tenders.find((x) => x.id === t.id)!.bidFiles![0].confirmedBy).toBeNull();
  });

  it('will not sign or lodge a bid whose files are not ready', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const t = ds.tenders.find((x) => x.companyId === 'co-sasa' && x.verifications?.length)!;
    for (const l of ds.licences.filter((x) => x.companyId === 'co-sasa')) l.expiresOn = '2028-01-01';
    t.bidFiles![0].confirmedBy = null;
    await expect(svc.submitTender(cm, t.id, 'Lodged', [pdf('Slip.pdf', 'Slip')])).rejects.toThrow(/bid files are not ready/);
    await svc.verifyTender(cm, t.id, false, 'Check the technical file');
    await expect(svc.verifyTender(cm, t.id, true, '')).rejects.toThrow(/check "Dokumen Teknikal.pdf"/);
    ds.tenders.find((x) => x.id === t.id)!.bidFiles = [];
    await expect(svc.verifyTender(cm, t.id, true, '')).rejects.toThrow(/list of file names/);
  });
});
