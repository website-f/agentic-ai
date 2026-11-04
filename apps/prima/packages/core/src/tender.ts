// Tender checklist drafting (Fauzan, 25 Oct 2026): an AI agent reads the tender papers and the arahan petender
// (instructions to tenderers) and drafts what to do; the Director Office Administrator checks the draft.

import type { Company, IsoDate, Tender, TenderBidPart, TenderPaperKind, TenderProtocolStep, TenderRecord } from './types';

export interface DraftItem {
  label: string;
  detail: string;
  /** Where in the papers the requirement comes from, e.g. "Arahan para 5". */
  ref: string;
  needsDocument: boolean;
}

/** Reads a tender's papers and drafts its checklist. Production plugs in the AI agent here. */
export interface TenderReader {
  readonly name: string;
  /** True when the reader really reads the files; false for the test version's sample draft. */
  readonly readsFiles: boolean;
  draft(tender: Tender, papers: { name: string; kind: TenderPaperKind }[]): DraftItem[];
}

/** The eight folders of the Director Office data list (11 Oct 2026). */
export const TENDER_PAPER_LABEL: Record<TenderPaperKind, string> = {
  IKLAN: '01 Iklan (notice)',
  ARAHAN: '02 Arahan petender',
  TEKNIKAL: '03 Teknikal',
  KEWANGAN: '04 Kewangan',
  HARGA: '05 Harga (price schedule)',
  TAKLIMAT: '06 Taklimat (briefing, site visit)',
  PINDAAN: '07 Pindaan (amendments)',
  PENGHANTARAN: '08 Penghantaran (submission)',
};

/** Parts of the bid a file belongs to (Fauzan, 28 Oct 2026). */
export const TENDER_BID_PART_LABEL: Record<TenderBidPart, string> = {
  TEKNIKAL: 'Teknikal',
  KEWANGAN: 'Kewangan',
  HARGA: 'Harga',
  LAIN: 'Lain-lain',
};

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const SUFFIX = /\s*\b(sdn\.?\s*bhd\.?|sendirian\s+berhad|berhad|bhd\.?)\s*$/i;

/**
 * The ways a company's name can appear in a bid file: the full name, the name without Sdn Bhd, and the company code as
 * a whole word (Fauzan, 28 Oct 2026: the technical part must not carry the company name anywhere).
 */
export function companyNameForms(c: Pick<Company, 'name' | 'code'>): { long: string[]; words: string[] } {
  const full = c.name.replace(/\s*\(mock\)\s*/i, '').trim();
  const short = full.replace(SUFFIX, '').trim();
  const long = [...new Set([full, short].map(squash).filter((x) => x.length >= 6))];
  const words = c.code && c.code.length >= 3 ? [c.code.toLowerCase()] : [];
  return { long, words };
}

/** True when the text carries one of the name forms. Long forms are matched with spaces and punctuation ignored. */
export function hasCompanyName(text: string, forms: { long: string[]; words: string[] }): boolean {
  const sq = squash(text);
  if (forms.long.some((f) => sq.includes(f))) return true;
  const lower = text.toLowerCase();
  return forms.words.some((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[^a-z0-9]/g, '')}([^a-z0-9]|$)`).test(lower));
}

/** The part of the bid an IT tender item belongs to by its label: the price schedule is Harga, the rest Teknikal. */
export const itemPart = (label: string): TenderBidPart => (/price|harga/i.test(label) ? 'HARGA' : 'TEKNIKAL');

const plainName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Why an uploaded file name is refused, or null: it must be the name the tender asks for and never carry the company name. */
export function bidFileNameProblem(uploaded: string, required: string, forms: { long: string[]; words: string[] }): string | null {
  if (hasCompanyName(uploaded.replace(/\.[a-z0-9]{2,4}$/i, ''), forms))
    return `The file name "${uploaded}" carries the company name. Rename it to "${required}", the name the tender asks for.`;
  const want = plainName(required);
  const got = plainName(uploaded);
  const gotBase = got.replace(/\.[a-z0-9]{2,4}$/, '');
  if (got !== want && !(!/\.[a-z0-9]{2,4}$/.test(want) && gotBase === want))
    return `Rename the file to "${required}" exactly, as the tender asks. It is now "${uploaded}".`;
  return null;
}

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return out;
}

async function inflate(raw: string): Promise<string | null> {
  const DS = (globalThis as { DecompressionStream?: new (f: string) => TransformStream<Uint8Array, Uint8Array> }).DecompressionStream;
  if (!DS) return null;
  try {
    const bytes = Uint8Array.from(raw, (ch) => ch.charCodeAt(0) & 0xff);
    const stream = new Blob([bytes]).stream().pipeThrough(new DS('deflate'));
    return latin1(new Uint8Array(await new Response(stream).arrayBuffer()));
  } catch {
    return null;
  }
}

function pdfStrings(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/\(((?:\\.|[^\\)])*)\)/g))
    out.push(
      m[1]
        .replace(/\\([0-7]{1,3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)))
        .replace(/\\(.)/g, '$1'),
    );
  for (const m of src.matchAll(/<([0-9a-fA-F\s]{4,})>/g)) {
    const hex = m[1].replace(/\s+/g, '');
    const codes = hex.match(/../g)?.map((h) => parseInt(h, 16)) ?? [];
    if (codes[0] === 0xfe && codes[1] === 0xff) {
      let t = '';
      for (let i = 2; i + 1 < codes.length; i += 2) t += String.fromCharCode((codes[i] << 8) | codes[i + 1]);
      out.push(t);
    } else out.push(String.fromCharCode(...codes));
  }
  return out;
}

/**
 * Looks for the company name in a bid file: the PDF's file properties (author, title, creator, XMP) and the text the
 * app can read. Pictures and scanned pages cannot be read, so readText is false and a person must check them.
 */
export async function scanBidFile(dataUrl: string, forms: { long: string[]; words: string[] }): Promise<{ readText: boolean; where: string[] }> {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m || m[1] !== 'application/pdf') return { readText: false, where: [] };
  let raw: string;
  try {
    raw = latin1(Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0)));
  } catch {
    return { readText: false, where: [] };
  }
  const where: string[] = [];
  const meta = [...raw.matchAll(/\/(Author|Title|Subject|Creator|Producer|Keywords|Company)\s*(\((?:\\.|[^\\)])*\)|<[0-9a-fA-F\s]*>)/g)]
    .flatMap((x) => pdfStrings(x[2]))
    .join(' ');
  const xmp = [...raw.matchAll(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/g)].map((x) => x[0].replace(/<[^>]+>/g, ' ')).join(' ');
  if (hasCompanyName(meta + ' ' + xmp, forms)) where.push('file properties');
  const texts: string[] = [];
  for (const obj of raw.split(/\bendobj\b/)) {
    const s = /^([\s\S]*?)\bstream\r?\n([\s\S]*?)\r?\n?endstream/.exec(obj);
    if (!s) continue;
    const dict = s[1];
    if (/\/Subtype\s*\/Image/.test(dict)) continue;
    const body = /\/FlateDecode/.test(dict) ? await inflate(s[2]) : /\/Filter/.test(dict) ? null : s[2];
    if (!body) continue;
    if (/\b(Tj|TJ|')\b/.test(body)) texts.push(...pdfStrings(body));
  }
  const text = texts.join(' ');
  const readText = text.replace(/\s+/g, '').length >= 3;
  if (readText && hasCompanyName(text, forms)) where.push('text');
  return { readText, where };
}

const S02 = '02 Kelayakan & dokumen asas';
const S03 = '03 Dokumen teknikal';
const S04 = '04 Kewangan & kelulusan harga';
const S05 = '05 Semakan akhir & penghantaran';

/**
 * The Director Office's tender guide, "Panduan Kerja Tender" V1.0 (discussion of 11 Oct 2026), sections 02 to 05,
 * worded as in the guide. Section 02 is confirmed before pricing starts; the rest before the bid is lodged.
 */
export const TENDER_GUIDE_V1: TenderProtocolStep[] = (
  [
    [S02, '01', 'Arahan tender dan pindaan telah diperoleh', 'Simpan versi terkini; senaraikan dokumen yang belum boleh diakses.'],
    [S02, '02', 'Syarikat dan penandatangan dikenal pasti', 'Semak SSM, profil, kuasa tandatangan dan nama pada sijil.'],
    [S02, '03', 'MOF dan kod bidang menepati syarat', 'Semak kod yang diminta, tempoh sah dan status pendaftaran.'],
    [S02, '04', 'KDN dan kelulusan operasi menepati syarat', 'Semak lesen, negeri/cawangan, bersenjata/CIT jika diminta.'],
    [S02, '05', 'Sekatan Bumiputera / lokaliti disemak', 'Ikut syarat sebenar; jangan anggap semua syarikat layak.'],
    [S02, '06', 'Pendaftaran portal dan akses dokumen tersedia', 'Semak akaun pembida, sijil digital dan akses yang diperlukan.'],
    [S02, '07', 'Taklimat / lawatan wajib telah dipenuhi', 'Simpan bukti wakil yang dibenarkan dan rekod kehadiran.', { needsDocument: true }],
    [S02, '08', 'Pendaftaran / pembelian dokumen dipenuhi', 'Semak tarikh akhir, resit dan hak mendapatkan dokumen.', { needsDocument: true }],
    [S02, '09', 'Dokumen tambahan kelayakan disemak', 'TCC, PIKM, PBT, insurans atau lesen lain hanya jika disyaratkan.'],
    [S03, '01', 'Borang teknikal wajib disenaraikan', 'Rekod nama/nombor borang dan keperluan setiap lampiran.'],
    [S03, '02', 'Pengawal, pos, syif dan jam liputan disahkan', 'Isi mengikut spesifikasi; jelaskan angka yang bercanggah.'],
    [S03, '03', 'Pelan operasi dan penyeliaan disediakan', 'Masukkan penempatan, rondaan, pelaporan dan tindak balas.'],
    [S03, '04', 'Kelayakan serta latihan pengawal disediakan', 'Umur, saringan, CSG, latihan dan lesen khusus jika diminta.'],
    [S03, '05', 'Pengawal ganti dan mobilisasi dirancang', 'Nyatakan cara memenuhi liputan dan tarikh mula kontrak.'],
    [S03, '06', 'Peralatan dan brosur disediakan', 'Jenis, kuantiti, guard tour, komunikasi dan bukti spesifikasi.'],
    [S03, '07', 'Pengalaman dan bukti kontrak dilampirkan', 'Pilih pengalaman yang memenuhi tempoh/jenis yang diminta.'],
    [S03, '08', 'Dokumen sokongan teknikal lengkap', 'Insurans, KWSP/PERKESO, pejabat operasi jika diminta.'],
    [S03, '09', 'Identiti, tandatangan dan susunan disemak', 'Teknikal tidak boleh ada nama syarikat di mana-mana: kepala surat, cop, footer, sifat fail; semak saksi.'],
    [S04, '01', 'Penyata bank bagi bulan yang tepat tersedia', 'Rekod bulan, akaun, halaman dan pengesahan yang diminta.'],
    [S04, '02', 'Pengesahan bank / kemudahan kredit lengkap', 'Guna borang sebenar; sertakan pengesahan jika disyaratkan.'],
    [S04, '03', 'Akaun kewangan bagi tahun yang tepat tersedia', 'Semak audit, kunci kira-kira dan borang berkaitan.'],
    [S04, '04', 'TCC dan pengisytiharan kewangan lengkap', 'Semak syarikat, pemilik benefisial dan akuan lain jika diminta.'],
    [S04, '05', 'Jadual harga menggunakan unit yang betul', 'Bilangan pengawal, jam/bulan, tempoh dan jumlah kontrak.'],
    [S04, '06', 'Kos pekerja dan pengganti telah dikira', 'Gaji, OT, caruman dan liputan mengikut data yang disahkan.'],
    [S04, '07', 'Kos operasi, margin dan cukai telah dikira', 'Uniform, peralatan, penyeliaan serta cukai yang berkenaan.'],
    [S04, '08', 'Kiraan dan konsistensi harga disemak', 'Semak formula, jumlah, pembundaran dan kesamaan semua borang.'],
    [
      S04,
      '09',
      'Harga akhir diluluskan pengurusan',
      'Rekod versi harga, pelulus dan tarikh; jangan ubah tanpa kelulusan.',
      { needsDocument: true, managerOnly: true },
    ],
    [S05, '01', 'Semua borang dan lampiran dipadankan', 'Bandingkan satu per satu dengan senarai semak rasmi.'],
    [S05, '02', 'Tandatangan, tarikh, cop dan saksi lengkap', 'Semak pihak berkuasa menandatangani dan setiap ruang wajib.'],
    [S05, '03', 'Teknikal dan kewangan dipisahkan dengan betul', 'Semak identiti syarikat dan larangan harga dalam teknikal.'],
    [S05, '04', 'Fail dan muat naik mematuhi arahan', 'Nama fail ikut nama yang diminta tender, bukan nama syarikat; format, saiz dan ruang muat naik.'],
    [S05, '05', 'Kaedah dan destinasi hantar telah disahkan', 'Portal/alamat, sampul dan salinan asal; selesaikan percanggahan.'],
    [S05, '06', 'Orang kedua telah menyemak tawaran penuh', 'Catat nama penyemak dan pembetulan; bukan hanya tanda sendiri.', { auto: 'MANAGER' }],
    [S05, '07', 'Kelulusan akhir untuk hantar diperoleh', 'Harga dan dokumen lengkap; item wajib belum siap diselesaikan.', { auto: 'MANAGER' }],
    [S05, '08', 'Penghantaran dibuat sebelum tarikh tutup', 'Tanda Selesai hanya selepas penghantaran sebenar diterima.', { auto: 'SLIP' }],
    [S05, '09', 'Bukti penerimaan dan versi akhir disimpan', 'Resit/nombor transaksi, masa, fail akhir dan rekod susulan.', { auto: 'SLIP' }],
  ] as [string, string, string, string, Partial<TenderProtocolStep>?][]
).map(([section, n, label, detail, more]) => ({
  id: `g${section.slice(0, 2)}_${n}`,
  code: `${section.slice(0, 2)}.${n}`,
  section,
  label,
  detail,
  before: section === S02 ? ('preparing' as const) : ('submitted' as const),
  needsDocument: false,
  ...more,
}));

/** Days to the nearest of the closing date and the buyer's mandatory dates still ahead: URGENT at 3 or less, SHORT WINDOW at 7. */
export function tenderPriority(t: Tender, today: IsoDate): { level: 'URGENT' | 'SHORT' | null; days: number; what: string } {
  const r = t.record ?? {};
  const dates: { on: IsoDate; what: string }[] = [{ on: t.closesOn, what: 'closing' }];
  if (r.briefing?.mandatory && r.briefing.on) dates.push({ on: r.briefing.on, what: 'mandatory briefing' });
  if (r.siteVisit?.mandatory && r.siteVisit.on) dates.push({ on: r.siteVisit.on, what: 'mandatory site visit' });
  if (r.docsBy) dates.push({ on: r.docsBy, what: 'document purchase' });
  const ahead = dates.filter((d) => d.on >= today).sort((a, b) => a.on.localeCompare(b.on));
  const next = ahead[0] ?? { on: t.closesOn, what: 'closing' };
  const days = Math.round((Date.parse(next.on) - Date.parse(today)) / 86_400_000);
  return { level: days <= 3 ? 'URGENT' : days <= 7 ? 'SHORT' : null, days, what: next.what };
}

/** Price reduction scenarios of the data list: as advertised, then 3%, 4.99% and 9.99% below. */
export const PRICE_SCENARIOS = [0, 3, 4.99, 9.99] as const;

/**
 * Average contract revenue per guard-hour from the indicative price (data list, 11 Oct 2026):
 * indicative / months / 30.5 / posts manned a day / shift hours. Not a wage and not an approved bid. Nothing is
 * rounded before the end; if any input is missing the check waits.
 */
export function tenderHourly(
  r: TenderRecord | undefined,
):
  | { ok: false; missing: string[] }
  | { ok: true; posts: number; monthly: number; hourly: number; scenarios: { cut: number; total: number; hourly: number }[] } {
  const missing: string[] = [];
  const total = r?.indicativeTotal ?? null;
  const months = r?.contractMonths ?? null;
  const posts = (r?.dayPosts ?? 0) + (r?.nightPosts ?? 0);
  const hours = r?.shiftHours ?? null;
  if (!total || total <= 0) missing.push('indicative price');
  if (!months || months <= 0) missing.push('contract months');
  if (!posts) missing.push('posts a day');
  if (!hours || hours <= 0) missing.push('shift hours');
  if (missing.length) return { ok: false, missing };
  const per = (v: number) => v / months! / 30.5 / posts / hours!;
  return {
    ok: true,
    posts,
    monthly: total! / months!,
    hourly: per(total!),
    scenarios: PRICE_SCENARIOS.map((cut) => {
      const t = total! * (1 - cut / 100);
      return { cut, total: t, hourly: per(t) };
    }),
  };
}

/**
 * Test version only: a sample draft from the tender's type and size, the kind of list the agent is expected to give.
 * It does not read the files.
 */
export const sampleTenderReader: TenderReader = {
  name: 'Sample draft (test version, does not read the files)',
  readsFiles: false,
  draft(t) {
    const items: DraftItem[] = [];
    if (t.channel === 'GOVERNMENT') {
      items.push(
        {
          label: 'MOF certificate for the security services code, valid',
          detail: 'Copy of the MOF registration showing the code the tender asks for.',
          ref: 'Arahan para 3',
          needsDocument: true,
        },
        {
          label: 'Bumiputera status certificate, if the tender asks for it',
          detail: 'Only where the arahan limits the tender to Bumiputera companies.',
          ref: 'Arahan para 3',
          needsDocument: false,
        },
        {
          label: 'Attend the site visit or briefing and keep the attendance slip',
          detail: 'Usually compulsory; a bid without the slip is rejected.',
          ref: 'Arahan para 6',
          needsDocument: true,
        },
        {
          label: 'Contract experience list for the last 3 years',
          detail: 'With client letters or contract copies.',
          ref: 'Arahan para 8',
          needsDocument: false,
        },
        { label: 'Audited accounts for 3 years and 3 months of bank statements', detail: '', ref: 'Arahan para 9', needsDocument: false },
        { label: 'Integrity pledge (Surat Akuan Pembida) signed', detail: 'Signed by the authorised director.', ref: 'Arahan para 11', needsDocument: true },
      );
    } else {
      items.push(
        { label: 'Company profile with KDN licence copy', detail: '', ref: 'Request for proposal 2', needsDocument: false },
        {
          label: 'Insurance certificates (public liability, employees)',
          detail: 'Valid to the end of the contract term asked for.',
          ref: 'Request for proposal 4',
          needsDocument: false,
        },
        { label: 'Client references', detail: 'Two or three current clients of a similar size.', ref: 'Request for proposal 5', needsDocument: false },
      );
    }
    items.push(
      {
        label: `Manpower plan for ${t.guards} guards at ${t.sites} site${t.sites === 1 ? '' : 's'}`,
        detail: 'Posts, shifts, relief and supervisors.',
        ref: 'Specification 2',
        needsDocument: false,
      },
      {
        label: 'Price schedule signed and stamped',
        detail: 'Use the form in the papers; no change to its wording.',
        ref: 'Forms, price schedule',
        needsDocument: true,
      },
    );
    if (t.armed)
      items.push({ label: 'Firearm permits and armed guard list', detail: 'Arms Control checks the list.', ref: 'Specification 4', needsDocument: false });
    return items;
  },
};
