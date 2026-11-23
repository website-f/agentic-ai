// Data and file manager (Fauzan, 23 Nov 2026: "Do also a data and file manager. As staff upload all old data we have,
// even the hard copy scan to computer"). Synthetic users and files only.
import { describe, expect, it } from 'vitest';
import { ARCHIVE_RULE, MemoryArchiveBytes, MemoryStore, PrimaService, archiveMaySee, archiveOwnersOf, archiveSuggest, generateDataset, myt } from '../src';

const NOW = myt('2026-11-23', '10:00');
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const PDF = new TextEncoder().encode('%PDF-1.4 synthetic invoice INV-1 total RM 10.00');

function setup(storage = true) {
  const ds = generateDataset({ today: '2026-11-23', now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  const bytes = new MemoryArchiveBytes();
  if (storage) svc.archiveBytes = bytes;
  return { ds, svc, bytes, as: (id: string) => svc.user(id) };
}
async function add(svc: PrimaService, user: Awaited<ReturnType<PrimaService['user']>>, fileName: string, data: Uint8Array, details: Record<string, unknown> = {}) {
  const s = await svc.archive.start(user, { fileName, size: data.length, ...details });
  for (let i = 0; i < s.parts; i++) await svc.archive.part(user, s.id, i, b64(data.subarray(i * s.partBytes, (i + 1) * s.partBytes)));
  return svc.archive.finish(user, s.id, { checked: true });
}

describe('archive: the rules suggest, the person checks', () => {
  it('suggests the folder, date, reference and title from the name and the words', () => {
    expect(archiveSuggest('INV_2021-0457_Syarikat_Maju.pdf', 'TAX INVOICE\nInvoice No: INV-2021/0457\nDate: 14/03/2021\nGrand Total RM 3,480.00', 'pdf')).toEqual({
      folder: 'finance', title: 'INV 2021-0457 Syarikat Maju', docDate: '2021-03-14', ref: null, origin: 'file',
    });
    expect(archiveSuggest('scan0012.jpg', 'SLIP GAJI\nKWSP 11%\nBulan: Mei 2019', 'image')).toMatchObject({ folder: 'pay', origin: 'scan' });
    expect(archiveSuggest('lesen KDN 2020.pdf', '', 'pdf')).toMatchObject({ folder: 'licences', origin: 'scan', docDate: null });
    expect(archiveSuggest('IMG_0001.png', null, 'image')).toMatchObject({ folder: 'other', title: 'IMG 0001' });
    expect(archiveSuggest('surat 2018-07-02.docx', 'Ruj. Kami: PW/HQ/18/044\nTuan,', 'word')).toMatchObject({ folder: 'letters', ref: 'PW/HQ/18/044', docDate: '2018-07-02' });
  });
});

describe('archive: putting a file in', () => {
  it('keeps a file in pieces, reads it back, and lists it without bytes or storage key', async () => {
    const { svc, as, ds } = setup();
    const fin = await as('u-finance-am');
    const big = new Uint8Array(ARCHIVE_RULE.partBytes + 1000).fill(65);
    big.set(PDF);
    const r = await add(svc, fin, 'old invoices 2019.pdf', big, { folder: 'finance', docDate: '2019-06-30', words: 'Invoice No INV-1 Syarikat Contoh' });
    expect(r.duplicateOf).toBeNull();
    expect(r.file).toMatchObject({ status: 'filed', size: big.length, kind: 'pdf', folder: 'finance', year: 2019, checked: true, owner: 'dept:finance', mayEdit: true });
    expect(r.file).not.toHaveProperty('key');
    expect(r.file).not.toHaveProperty('words');
    expect(ds.archiveFiles[0].parts).toBe(2);
    const list = await svc.archive.list(fin, { q: 'syarikat contoh' });
    expect(list.total).toBe(1);
    expect(list.files[0].snippet).toContain('Syarikat Contoh');
    expect(list.counts).toEqual({ finance: 1 });
    const opened = await svc.archive.open(fin, r.file.id);
    expect(opened).toMatchObject({ size: big.length, parts: 2, partBytes: ARCHIVE_RULE.partBytes });
    expect(r.file).not.toHaveProperty('pass');
    expect(list.files[0]).not.toHaveProperty('pass');
    // The bytes come in pieces, only with the pass that the logged opening gave.
    const p0 = await svc.archive.openPart(fin, opened.id, 0, opened.pass);
    const p1 = await svc.archive.openPart(fin, opened.id, 1, opened.pass);
    expect([p0.length, p1.length]).toEqual([ARCHIVE_RULE.partBytes, 1000]);
    expect(Array.from(p0.subarray(0, PDF.length))).toEqual(Array.from(PDF));
    await expect(svc.archive.openPart(fin, opened.id, 0, 'guess')).rejects.toThrow(/not opened first/);
    await expect(svc.archive.openPart(fin, opened.id, 0, undefined)).rejects.toThrow(/not opened first/);
    await expect(svc.archive.openPart(fin, opened.id, 2, opened.pass)).rejects.toThrow(/No such piece/);
    await expect(svc.archive.openPart(await as('u-transport'), opened.id, 0, opened.pass)).rejects.toThrow(/not found/i);
    expect(ds.audit.filter((a) => a.action.startsWith('archive.')).map((a) => a.action)).toEqual(['archive.filed', 'archive.opened']);
  });
  it('marks the same file added twice as a duplicate and opens the kept one', async () => {
    const { svc, as } = setup();
    const fin = await as('u-finance-am');
    const a = await add(svc, fin, 'a.pdf', PDF);
    const b = await add(svc, fin, 'copy of a.pdf', PDF);
    expect(b.file.status).toBe('duplicate');
    expect(b.duplicateOf?.id).toBe(a.file.id);
    expect((await svc.archive.list(fin)).total).toBe(1);
  });
  it('refuses what it must not keep', async () => {
    const { svc, as } = setup();
    const fin = await as('u-finance-am');
    await expect(svc.archive.start(fin, { fileName: 'tool.exe', size: 10 })).rejects.toThrow(/not kept/);
    for (const n of ['setup.BAT', 'app.apk', 'run.ps1', 'x.js']) await expect(svc.archive.start(fin, { fileName: n, size: 10 })).rejects.toThrow(/not kept/);
    await expect(svc.archive.start(fin, { fileName: 'a.pdf', size: ARCHIVE_RULE.maxFileBytes + 1 })).rejects.toThrow(/200 MB/);
    await expect(svc.archive.start(fin, { fileName: 'a.pdf', size: 0 })).rejects.toThrow(/empty/);
    await expect(svc.archive.start(fin, { fileName: 'a.pdf', size: 10, owner: 'company:co-sasa' })).rejects.toThrow();
    await expect(svc.archive.start(fin, { fileName: 'a.pdf', size: 10, docDate: '2031-01-01' })).rejects.toThrow(/future/);
    // A program renamed to .pdf is caught from the bytes the server reads back.
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0]);
    await expect(add(svc, fin, 'invoice.pdf', exe)).rejects.toThrow(/program/);
    // A program under a name Prima does not read is still a program.
    await expect(add(svc, fin, 'photos.zip', exe)).rejects.toThrow(/program/);
    await expect(add(svc, fin, 'macapp.dat', new Uint8Array([0xcf, 0xfa, 0xed, 0xfe, 7, 0, 0, 1]))).rejects.toThrow(/program/);
    // A missing piece: the file is not kept.
    const s = await svc.archive.start(fin, { fileName: 'b.pdf', size: PDF.length });
    await expect(svc.archive.finish(fin, s.id)).rejects.toThrow();
    await expect(svc.archive.part(fin, s.id, 5, b64(PDF))).rejects.toThrow(/No such piece/);
    await expect(svc.archive.part(fin, s.id, 0, 'not base64!')).rejects.toThrow(/not valid/);
  });
  it('keeps every other kind of file as it is: zip, video, voice, drawings, Outlook messages, no extension', async () => {
    const { svc, as } = setup();
    const fin = await as('u-finance-am');
    const kept: [string, Uint8Array, string][] = [
      ['site photos.zip', new Uint8Array([0x50, 0x4b, 3, 4, 20, 0, 0, 0, 8, 0]), 'application/zip'],
      ['gate cctv.mp4', new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34]), 'video/mp4'],
      ['voice note.m4a', new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41]), 'audio/mp4'],
      ['floor plan.dwg', new TextEncoder().encode('AC1032 synthetic drawing'), 'application/octet-stream'],
      ['letter from client.msg', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), 'application/vnd.ms-outlook'],
      ['README', new TextEncoder().encode('old notes with no extension'), 'application/octet-stream'],
    ];
    for (const [name, bytes, mime] of kept) {
      const r = await add(svc, fin, name, bytes);
      expect(r.file.status, name).toBe('filed');
      expect((await svc.archive.open(fin, r.file.id)).mime, name).toBe(mime);
    }
  });
  it('says plainly when file storage is not switched on, and keeps nothing', async () => {
    const { svc, as, ds } = setup(false);
    await expect(svc.archive.start(await as('u-finance-am'), { fileName: 'a.pdf', size: 10 })).rejects.toThrow(/not switched on/);
    expect(ds.archiveFiles).toHaveLength(0);
    expect((await svc.archive.list(await as('u-finance-am'))).storage).toBe(false);
  });
});

describe('archive: who sees what', () => {
  it('a unit sees its own files; restricted folders are for the uploader, central HR and group leaders', async () => {
    const { svc, as } = setup();
    const fin = await as('u-finance-am');
    const hr = await as('u-pwvsb-hr');
    const transport = await as('u-transport');
    const ceo = await as('u-fauzan');
    expect(archiveOwnersOf(fin)).toEqual(['dept:finance']);
    expect(archiveOwnersOf(ceo)).toEqual(['dept:leadership']);
    const open = await add(svc, fin, 'bank letter.pdf', PDF, { folder: 'finance' });
    const pay = await add(svc, transport, 'driver payslips 2020.pdf', new TextEncoder().encode('%PDF-1.4 payslips (mock)'), { folder: 'pay' });
    expect(pay.file.restricted).toBe(true);
    // Transport does not see Finance's file; Finance does not see Transport's pay file.
    expect((await svc.archive.list(transport)).files.map((f) => f.id)).toEqual([pay.file.id]);
    expect((await svc.archive.list(fin)).files.map((f) => f.id)).toEqual([open.file.id]);
    await expect(svc.archive.open(fin, pay.file.id)).rejects.toThrow(/not found/i);
    await expect(svc.archive.open(transport, open.file.id)).rejects.toThrow(/not found/i);
    // Central HR sees the restricted pay file but not Finance's ordinary file; the CEO sees both.
    expect((await svc.archive.list(hr)).files.map((f) => f.id)).toEqual([pay.file.id]);
    expect((await svc.archive.list(ceo)).total).toBe(2);
    expect((await svc.archive.open(hr, pay.file.id)).fileName).toBe('driver payslips 2020.pdf');
  });
  it('guards, shared devices and system sign-ins have no file manager', async () => {
    const { svc, as } = setup();
    await expect(svc.archive.list(await as('u-guard-sasa-1'))).rejects.toThrow();
    await expect(svc.archive.start(await as('u-guard-sasa-1'), { fileName: 'a.pdf', size: 10 })).rejects.toThrow();
    const fin = await as('u-finance-am');
    expect(archiveMaySee({ ...fin, integration: true } as typeof fin, { owner: 'dept:finance', restricted: false, uploadedById: 'x' })).toBe(false);
  });
  it("one person cannot finish or add pieces to another person's upload", async () => {
    const { svc, as } = setup();
    const fin = await as('u-finance-am');
    const s = await svc.archive.start(fin, { fileName: 'a.pdf', size: PDF.length });
    await expect(svc.archive.part(await as('u-fauzan'), s.id, 0, b64(PDF))).rejects.toThrow();
    await expect(svc.archive.finish(await as('u-transport'), s.id)).rejects.toThrow();
  });
});

describe('archive: correcting and setting aside', () => {
  it('details are corrected with a history; nothing is deleted; a set-aside file leaves the list but stays on record', async () => {
    const { svc, as, ds } = setup();
    const fin = await as('u-finance-am');
    const r = await add(svc, fin, 'a.pdf', PDF);
    const v = await svc.archive.setDetails(fin, r.file.id, { folder: 'clients', title: 'Contract with Client A (mock)', docDate: '2020-02-29', ref: 'C-1' });
    expect(v).toMatchObject({ folder: 'clients', year: 2020, ref: 'C-1' });
    expect(v.history.at(-1)?.what).toMatch(/Changed folder, title, docDate, ref/);
    await expect(svc.archive.setDetails(fin, r.file.id, { docDate: '2020-02-30' })).rejects.toThrow(/real date/);
    await expect(svc.archive.setDetails(fin, r.file.id, { folder: 'secret' })).rejects.toThrow(/folder/);
    await expect(svc.archive.setDetails(await as('u-transport'), r.file.id, { title: 'Mine now' })).rejects.toThrow();
    await expect(svc.archive.setAside(fin, r.file.id, 'no')).rejects.toThrow(/why/);
    await svc.archive.setAside(fin, r.file.id, 'Wrong company file (mock)');
    expect((await svc.archive.list(fin)).total).toBe(0);
    expect((await svc.archive.list(fin, { status: 'set_aside' })).total).toBe(1);
    expect(ds.archiveFiles).toHaveLength(1);
    await expect(svc.archive.setDetails(fin, r.file.id, { title: 'Again' })).rejects.toThrow(/kept file/);
  });
  it('a file whose bytes changed in storage is not opened', async () => {
    const { svc, as, bytes, ds } = setup();
    const fin = await as('u-finance-am');
    const r = await add(svc, fin, 'a.pdf', PDF);
    bytes.files.set(ds.archiveFiles[0].key, new TextEncoder().encode('%PDF-1.4 something else entirely, same?'));
    await expect(svc.archive.open(fin, r.file.id)).rejects.toThrow(/no longer matches/);
  });
  it('Home reminds the person of their own unchecked files', async () => {
    const { svc, as } = setup();
    const fin = await as('u-finance-am');
    const s = await svc.archive.start(fin, { fileName: 'a.pdf', size: PDF.length });
    await svc.archive.part(fin, s.id, 0, b64(PDF));
    await svc.archive.finish(fin, s.id, { checked: false });
    expect((await svc.archive.homeItems(fin))[0]?.title).toMatch(/1 old file/);
    expect((await svc.archive.list(fin, { status: 'to_check' })).total).toBe(1);
  });
});
