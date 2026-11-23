import { AccessDenied, isGroupLeader } from './access';
import { sha256Bytes, toHex } from './audit';
import { keyInAllowed, keyInRulesRead, keyInValuesIn } from './key-in';
import { keyInFileKind, type KeyInFileKind } from './key-in-files';
import { BadRequest, NotFound } from './service';
import type { Store } from './store';
import type { Id, IsoDate, IsoDateTime, User } from './types';
import { registerWall } from './walls';

/**
 * Data and file manager, "Fail lama" (Fauzan, 23 Nov 2026: "Do also a data and file manager. As staff upload all old
 * data we have, even the hard copy scan to computer").
 *
 * Staff put the group's old records into Prima: old computer files as they are, and paper scanned to the computer.
 * System first (Fauzan, 23 Nov 2026: "Use system more than ai"): the document is read on the person's own device, the
 * rules here suggest its folder, date, reference and title, and the person only checks them. No online reader is used
 * by this module. Nothing is deleted: a file put in by mistake is set aside with a reason and stays on record.
 *
 * Who sees a file: the unit that owns it (one company's office, or one central department), the person who put it
 * in, and the group leaders. Staff and pay files are restricted: only the person who put them in, central HR and
 * the group leaders. The same walls are enforced again in the database (module archive-v1).
 *
 * The bytes never sit in a database row: they go to the private file storage (ArchiveBytes) in pieces, because a
 * scan is larger than one request may be. The row keeps the size and SHA-256 the server itself read back, and every
 * opening checks them again.
 */

export const ARCHIVE_FOLDERS = [
  'finance',
  'clients',
  'tenders',
  'licences',
  'staff',
  'pay',
  'company',
  'insurance',
  'assets',
  'operations',
  'letters',
  'other',
] as const;
export type ArchiveFolder = (typeof ARCHIVE_FOLDERS)[number];

export const ARCHIVE_FOLDER_LABELS: Record<ArchiveFolder, { bm: string; en: string; hint: string }> = {
  finance: { bm: 'Kewangan', en: 'Finance', hint: 'invoices, receipts, payment vouchers, bank papers, tax' },
  clients: { bm: 'Pelanggan & kontrak', en: 'Clients and contracts', hint: 'contracts, award letters, client letters' },
  tenders: { bm: 'Tender', en: 'Tenders', hint: 'tender papers, quotations sent, submission slips' },
  licences: { bm: 'Lesen & permit', en: 'Licences and permits', hint: 'KDN, PBT, SSM renewals, permits, certificates' },
  staff: { bm: 'Fail staf (terhad)', en: 'Staff files (restricted)', hint: 'offer letters, staff records, warnings, leave papers' },
  pay: { bm: 'Gaji & caruman (terhad)', en: 'Pay and contributions (restricted)', hint: 'payslips, payroll lists, EPF, SOCSO, PCB' },
  company: { bm: 'Syarikat & lembaga', en: 'Company and board', hint: 'SSM papers, resolutions, minutes, agreements' },
  insurance: { bm: 'Insurans', en: 'Insurance', hint: 'policies, cover notes, claims' },
  assets: { bm: 'Aset & kenderaan', en: 'Assets and vehicles', hint: 'grants, road tax, purchase papers, warranties' },
  operations: { bm: 'Operasi & laporan', en: 'Operations and reports', hint: 'site reports, rosters, incident reports, audits' },
  letters: { bm: 'Surat & memo', en: 'Letters and memos', hint: 'letters in and out, memos, notices' },
  other: { bm: 'Lain-lain', en: 'Other', hint: 'anything that fits nowhere else' },
};

/** Folders only the person who put the file in, central HR and the group leaders may open. */
export const ARCHIVE_RESTRICTED: readonly ArchiveFolder[] = ['staff', 'pay'];
export const archiveRestricted = (folder: ArchiveFolder): boolean => ARCHIVE_RESTRICTED.includes(folder);

export const ARCHIVE_RULE = {
  id: 'ARCHIVE',
  /** One piece of a file in one request (the API takes 3 MB of JSON; base64 adds a third). */
  partBytes: 1_500_000,
  /**
   * The largest file kept (Fauzan, 23 Nov 2026: "Increase mb size to 200mb"; it was 25 MB). A file this size is never
   * held whole by the server: it arrives, is checked and is given back in pieces.
   */
  maxFileBytes: 200 * 1024 * 1024,
  /** The document's own words kept for searching. */
  maxWordsChars: 6_000,
  pageSize: 50,
  /** Files in one list read (search looks at the newest this many of the units the person may see). */
  maxListed: 5_000,
};

/** The unit that owns a file: `company:<companyId>` or `dept:<department>`. */
export type ArchiveOwner = string;
const OWNER = /^(company|dept):[A-Za-z0-9_-]{1,60}$/;

export interface ArchiveFile {
  id: Id;
  owner: ArchiveOwner;
  folder: ArchiveFolder;
  restricted: boolean;
  title: string;
  /** The date on the document, when known. */
  docDate: IsoDate | null;
  year: number | null;
  ref: string | null;
  fileName: string;
  kind: KeyInFileKind;
  mime: string;
  /** 'scan' for paper scanned or photographed, 'file' for a file made on a computer. */
  origin: 'scan' | 'file';
  /** Set by the server from the bytes it read back; 0 and '' while the file is still coming in. */
  size: number;
  sha256: string;
  /** Where the bytes are kept in file storage. Never shown to a browser. */
  key: string;
  parts: number;
  /** Given only by `open` (which is logged) and asked for with every piece of the file. Never shown in a list. */
  pass: string;
  /** The document's own words, read on the person's device, for searching. */
  words: string;
  status: 'uploading' | 'filed' | 'duplicate' | 'set_aside';
  /** For a duplicate: the file already kept. */
  sameAs: Id | null;
  /** The person looked at the suggested details and confirmed them. */
  checked: boolean;
  uploadedById: Id;
  uploadedBy: string;
  at: IsoDateTime;
  setAside: { byId: Id; by: string; at: IsoDateTime; reason: string } | null;
  history: { at: IsoDateTime; by: string; what: string }[];
}

/** What a browser gets: never the storage key. */
export type ArchiveFileView = Omit<ArchiveFile, 'key' | 'words' | 'pass'> & { mayEdit: boolean; snippet: string | null };

/** Where the bytes live. The API gives the private Azure Blob store; the demo and tests keep them in memory. */
export interface ArchiveBytes {
  putPart(key: string, index: number, bytes: Uint8Array): Promise<void>;
  /** Joins the pieces into the file and reads it back: the size and SHA-256 are the server's own. */
  finish(key: string, parts: number, mime: string): Promise<{ size: number; sha256: string; head: Uint8Array }>;
  /** The size and SHA-256 of the file as it is in storage now, read piece by piece. */
  fingerprint(key: string): Promise<{ size: number; sha256: string }>;
  /** `length` bytes of the file from `start` (fewer at the end of the file). */
  getRange(key: string, start: number, length: number): Promise<Uint8Array>;
}

export const archiveSha256 = (bytes: Uint8Array): string => toHex(sha256Bytes(bytes));

/** Tests and the single-file demo only. */
export class MemoryArchiveBytes implements ArchiveBytes {
  readonly parts = new Map<string, Uint8Array>();
  readonly files = new Map<string, Uint8Array>();
  async putPart(key: string, index: number, bytes: Uint8Array) {
    this.parts.set(`${key}#${index}`, bytes.slice());
  }
  async finish(key: string, parts: number) {
    const list: Uint8Array[] = [];
    for (let i = 0; i < parts; i++) {
      const p = this.parts.get(`${key}#${i}`);
      if (!p) throw new Error('A piece of the file is missing.');
      list.push(p);
    }
    const all = new Uint8Array(list.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of list) {
      all.set(p, at);
      at += p.length;
    }
    this.files.set(key, all);
    for (let i = 0; i < parts; i++) this.parts.delete(`${key}#${i}`);
    return { size: all.length, sha256: archiveSha256(all), head: all.slice(0, 16) };
  }
  private file(key: string) {
    const f = this.files.get(key);
    if (!f) throw new Error('A stored file is missing from file storage.');
    return f;
  }
  async fingerprint(key: string) {
    const f = this.file(key);
    return { size: f.length, sha256: archiveSha256(f) };
  }
  async getRange(key: string, start: number, length: number) {
    return this.file(key).slice(start, start + length);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Who

/** Anyone who fills forms may put files in: not guards, shared site devices, system sign-ins or closed accounts. */
export const archiveAllowed = (user: User, today?: string): boolean => keyInAllowed(user, today);

/** Central HR opens the restricted staff and pay files of every unit (HR governs HR in every company). */
export function holdsArchiveHr(user: User): boolean {
  return !user.integration && user.role === 'pwvsb_officer' && user.department === 'hr';
}
registerWall('archive_all', isGroupLeader);
registerWall('archive_hr', holdsArchiveHr);

/** The units a person files for: their central department, or else each company office they belong to. */

export function archiveOwnersOf(user: User): ArchiveOwner[] {
  if (user.role === 'pwvsb_officer' && user.department && /^[A-Za-z0-9_-]{1,60}$/.test(user.department)) return [`dept:${user.department}`];
  const companies = [...user.companyIds].filter((c) => /^[A-Za-z0-9_-]{1,60}$/.test(c)).sort().map((c) => `company:${c}`);
  // A group leader with no department or company of their own files under the leadership office.
  return companies.length || !isGroupLeader(user) ? companies : ['dept:leadership'];
}

export function archiveMaySee(user: User, f: Pick<ArchiveFile, 'owner' | 'restricted' | 'uploadedById'>): boolean {
  if (user.integration) return false;
  if (f.uploadedById === user.id || isGroupLeader(user)) return true;
  if (f.restricted) return holdsArchiveHr(user);
  return archiveOwnersOf(user).includes(f.owner);
}

// ---------------------------------------------------------------------------------------------------------------
// System first: suggest the details from the file's name and its own words

const FOLDER_WORDS: Record<Exclude<ArchiveFolder, 'other'>, string[]> = {
  pay: ['payslip', 'slip gaji', 'penyata gaji', 'payroll', 'kwsp', 'epf', 'perkeso', 'socso', 'pcb', 'borang ea', 'ea form', 'caruman'],
  staff: ['offer letter', 'surat tawaran', 'letter of appointment', 'surat lantikan', 'warning letter', 'surat amaran', 'resignation', 'perletakan jawatan', 'cuti', 'leave form', 'resume', 'curriculum vitae', 'show cause', 'tunjuk sebab'],
  tenders: ['tender', 'sebut harga', 'quotation', 'sebutharga', 'petender', 'e-perolehan', 'eperolehan', 'bill of quantities'],
  clients: ['contract', 'kontrak', 'agreement', 'perjanjian', 'letter of award', 'surat setuju terima', 'sst', 'purchase order', 'pesanan belian', 'service level'],
  licences: ['lesen', 'licence', 'license', 'permit', 'kdn', 'pbt', 'sijil', 'certificate', 'esims', 'bomba', 'majlis perbandaran', 'majlis bandaraya'],
  insurance: ['insurance', 'insurans', 'takaful', 'policy no', 'no. polisi', 'cover note', 'sum insured'],
  assets: ['road tax', 'cukai jalan', 'geran', 'vehicle registration', 'puspakom', 'warranty', 'waranti', 'asset', 'aset', 'serial no'],
  company: ['ssm', 'suruhanjaya syarikat', 'resolution', 'resolusi', 'board of directors', 'lembaga pengarah', 'minutes of meeting', 'minit mesyuarat', 'form 24', 'form 49', 'annual return', 'memorandum'],
  finance: ['invoice', 'invois', 'receipt', 'resit', 'payment voucher', 'baucar', 'bank statement', 'penyata bank', 'debit note', 'credit note', 'statement of account', 'lhdn', 'cukai', 'tax', 'audit report', 'laporan audit'],
  operations: ['incident report', 'laporan kejadian', 'site visit', 'lawatan tapak', 'roster', 'jadual tugas', 'occurrence book', 'buku kejadian', 'laporan bulanan', 'monthly report', 'patrol'],
  letters: ['surat', 'letter', 'memo', 'notis', 'notice', 'ruj. kami', 'our ref', 'tuan/puan', 'dear sir'],
};

export interface ArchiveSuggestion {
  folder: ArchiveFolder;
  title: string;
  docDate: IsoDate | null;
  ref: string | null;
  origin: 'scan' | 'file';
}

/**
 * Suggests where a file goes and what it is, by fixed rules: the folder from words in the name and the text, the
 * date and reference as the key-in rules read them (or the first date printed), the title from the file name. The
 * person checks every suggestion; an unsure folder is 'other'.
 */
export function archiveSuggest(fileName: string, words: string | null, kind: KeyInFileKind): ArchiveSuggestion {
  const base = fileName.replace(/\.[A-Za-z0-9]{1,6}$/, '');
  const title = base.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled';
  const text = `${base.replace(/[_-]+/g, ' ')}\n${(words ?? '').slice(0, 12_000)}`.toLowerCase();
  let folder: ArchiveFolder = 'other';
  let best = 0;
  for (const [f, list] of Object.entries(FOLDER_WORDS) as [ArchiveFolder, string[]][]) {
    const score = list.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);
    // The order of FOLDER_WORDS settles a tie: the more sensitive folders come first.
    if (score > best) {
      best = score;
      folder = f;
    }
  }
  const read = Object.fromEntries(keyInRulesRead('other', words ?? '').map((f) => [f.name, f.value]));
  const firstDate = keyInValuesIn('date', (words ?? '').slice(0, 4_000))[0]?.value;
  const nameDate = keyInValuesIn('date', base.replace(/_/g, '-'))[0]?.value;
  const docDate = (typeof read.paperDate === 'string' ? read.paperDate : null) ?? (typeof firstDate === 'string' ? firstDate : null) ?? (typeof nameDate === 'string' ? nameDate : null);
  return {
    folder,
    title,
    docDate,
    ref: typeof read.ref === 'string' ? read.ref.slice(0, 60) : null,
    origin: kind === 'image' || (kind === 'pdf' && !(words ?? '').trim()) ? 'scan' : 'file',
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Service

const text = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, max);
const isoDate = (v: unknown): IsoDate | null => {
  const s = String(v ?? '');
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s ? s : null;
};
const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint', odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation',
  txt: 'text/plain', csv: 'text/csv', tsv: 'text/tab-separated-values', md: 'text/plain', json: 'application/json', xml: 'application/xml', rtf: 'application/rtf', eml: 'message/rfc822', htm: 'text/plain', html: 'text/plain',
};
/** Documents Prima can read on the device; a file with one of these names must really be that kind of file. */
const READ_EXT = new Set(Object.keys(EXT_MIME));
/**
 * Every other kind of file is kept as it is (Fauzan, 23 Nov 2026: "Make sure all type of file"): zip, video, voice,
 * drawings, Outlook messages, anything. It is stored and handed back for the person's own program, never read or shown
 * inside Prima. Only programs and scripts are refused, because a stored program can carry a virus to whoever opens it.
 */
const KEPT_MIME: Record<string, string> = {
  zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed', gz: 'application/gzip', tar: 'application/x-tar',
  mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo', mkv: 'video/x-matroska', '3gp': 'video/3gpp', webm: 'video/webm',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/opus', amr: 'audio/amr',
  msg: 'application/vnd.ms-outlook', ics: 'text/calendar', vcf: 'text/vcard',
};
export const ARCHIVE_PROGRAM_EXT: readonly string[] = [
  'exe', 'com', 'bat', 'cmd', 'msi', 'msp', 'scr', 'pif', 'cpl', 'dll', 'sys', 'drv', 'ocx', 'vbs', 'vbe', 'js', 'jse', 'mjs', 'wsf', 'wsh',
  'ps1', 'psm1', 'hta', 'jar', 'apk', 'xapk', 'app', 'dmg', 'pkg', 'deb', 'rpm', 'sh', 'bash', 'reg', 'lnk', 'inf', 'scf', 'gadget', 'appx', 'msix',
];
/** The extension a file is kept under: its own, or "bin" when it has none. Null only for programs and scripts. */
export function archiveExt(fileName: string): string | null {
  const e = (/\.([A-Za-z0-9]{1,6})$/.exec(fileName.trim())?.[1] ?? '').toLowerCase();
  if (ARCHIVE_PROGRAM_EXT.includes(e)) return null;
  return e || 'bin';
}
/** What a kept file is handed back as; anything unknown goes back as plain bytes to save, never to show. */
const archiveMime = (ext: string): string => EXT_MIME[ext] ?? KEPT_MIME[ext] ?? 'application/octet-stream';

export interface ArchiveDetails {
  folder?: unknown;
  title?: unknown;
  docDate?: unknown;
  ref?: unknown;
  origin?: unknown;
  words?: unknown;
  checked?: unknown;
}

export interface ArchiveQuery {
  owner?: string;
  folder?: string;
  year?: number;
  q?: string;
  status?: 'filed' | 'to_check' | 'set_aside' | 'mine';
  page?: number;
}

export class ArchiveService {
  constructor(
    private store: Store,
    private now: () => IsoDateTime,
    private bytes: ArchiveBytes | null,
  ) {}

  private async ready() {
    if (this.store.hasTable && !(await this.store.hasTable('archiveFiles')))
      throw new BadRequest('The data and file manager is not installed in this database yet (module archive-v1).');
  }
  private storage(): ArchiveBytes {
    if (!this.bytes) throw new BadRequest('File storage is not switched on yet, so files cannot be kept. The CEO switches it on (docs/FILE_STORAGE.md).');
    return this.bytes;
  }
  private must(user: User) {
    if (!archiveAllowed(user, this.now().slice(0, 10))) throw new AccessDenied('view', 'the data and file manager');
  }
  private details(input: ArchiveDetails, was: Pick<ArchiveFile, 'folder' | 'title' | 'docDate' | 'ref' | 'origin' | 'checked'>) {
    const folder = input.folder === undefined ? was.folder : (ARCHIVE_FOLDERS as readonly string[]).includes(String(input.folder)) ? (input.folder as ArchiveFolder) : null;
    if (!folder) throw new BadRequest('Choose a folder from the list.');
    const title = input.title === undefined ? was.title : text(input.title, 120);
    if (!title) throw new BadRequest('Give the file a title.');
    const docDate = input.docDate === undefined ? was.docDate : input.docDate == null || input.docDate === '' ? null : isoDate(input.docDate);
    if (input.docDate && !docDate) throw new BadRequest('The date on the document is not a real date.');
    if (docDate && docDate > this.now().slice(0, 10)) throw new BadRequest('The date on the document cannot be in the future.');
    const ref = input.ref === undefined ? was.ref : text(input.ref, 60) || null;
    const origin = input.origin === undefined ? was.origin : input.origin === 'scan' ? 'scan' : 'file';
    return { folder, restricted: archiveRestricted(folder), title, docDate, year: docDate ? Number(docDate.slice(0, 4)) : null, ref, origin: origin as 'scan' | 'file', checked: input.checked === undefined ? was.checked : input.checked === true };
  }
  private view(user: User, f: ArchiveFile, q = ''): ArchiveFileView {
    const { key: _key, pass: _pass, words, ...rest } = f;
    let snippet: string | null = null;
    if (q) {
      const at = words.toLowerCase().indexOf(q);
      if (at >= 0) snippet = words.slice(Math.max(0, at - 40), at + q.length + 60).replace(/\s+/g, ' ').trim();
    }
    return { ...rest, mayEdit: f.status !== 'set_aside' && (f.uploadedById === user.id || archiveOwnersOf(user).includes(f.owner) || isGroupLeader(user)), snippet };
  }

  /** Step 1: says a file is coming. Nothing is kept until every piece has arrived and the file is checked. */
  async start(user: User, input: { owner?: unknown; fileName?: unknown; size?: unknown } & ArchiveDetails) {
    this.must(user);
    await this.ready();
    this.storage();
    const owners = archiveOwnersOf(user);
    const owner = String(input.owner ?? owners[0] ?? '');
    if (!OWNER.test(owner) || !owners.includes(owner)) throw new AccessDenied('view', 'filing for that company or department');
    const fileName = text(input.fileName, 160).replace(/[\\/:*?"<>|]/g, '_');
    const ext = archiveExt(fileName);
    if (!ext) throw new BadRequest('Programs and scripts (.exe, .bat, .apk and the like) are not kept. Every other kind of file is.');
    const size = Number(input.size);
    if (!Number.isInteger(size) || size < 1) throw new BadRequest('The file is empty.');
    if (size > ARCHIVE_RULE.maxFileBytes) throw new BadRequest('The file is larger than 200 MB. Save a long scan as two or more files.');
    const d = this.details({ ...input, title: input.title ?? fileName.replace(/\.[A-Za-z0-9]{1,6}$/, '') }, { folder: 'other', title: '', docDate: null, ref: null, origin: 'file', checked: false });
    const at = this.now();
    const id = `arc-${Date.parse(at).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const row: ArchiveFile = {
      id, owner, ...d, fileName, kind: 'unknown', mime: archiveMime(ext), size: 0, sha256: '',
      key: `archive/${owner.replace(':', '-')}/${id}.${ext}`, parts: Math.ceil(size / ARCHIVE_RULE.partBytes), pass: toHex(globalThis.crypto.getRandomValues(new Uint8Array(16))),
      words: text(String(input.words ?? '').replace(/\r\n?/g, '\n'), ARCHIVE_RULE.maxWordsChars), status: 'uploading', sameAs: null,
      uploadedById: user.id, uploadedBy: user.name, at, setAside: null, history: [],
    };
    await this.store.insert('archiveFiles', row);
    return { id, parts: row.parts, partBytes: ARCHIVE_RULE.partBytes };
  }

  private async mine(user: User, id: Id): Promise<ArchiveFile> {
    const f = await this.store.get('archiveFiles', id);
    if (!f || !archiveMaySee(user, f)) throw new NotFound('File');
    if (f.uploadedById !== user.id) throw new AccessDenied('view', "another person's upload");
    if (f.status !== 'uploading') throw new BadRequest('This file has already been kept.');
    return f;
  }

  /** Step 2: one piece of the file (base64), in any order. */
  async part(user: User, id: Id, index: number, base64: unknown) {
    this.must(user);
    await this.ready();
    const f = await this.mine(user, id);
    if (!Number.isInteger(index) || index < 0 || index >= f.parts) throw new BadRequest('No such piece of this file.');
    if (typeof base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > Math.ceil(ARCHIVE_RULE.partBytes / 3) * 4 + 4) throw new BadRequest('The piece of the file is not valid.');
    const bytes = decodeBase64(base64);
    if (!bytes.length || bytes.length > ARCHIVE_RULE.partBytes) throw new BadRequest('The piece of the file is not valid.');
    await this.storage().putPart(f.key, index, bytes);
    return { ok: true };
  }

  /**
   * Step 3: joins the pieces, reads the file back and keeps it. The size, SHA-256 and kind come from the bytes the
   * server read, not from the browser. The same file already kept for the same unit is marked a duplicate.
   */
  async finish(user: User, id: Id, input: ArchiveDetails = {}) {
    this.must(user);
    await this.ready();
    const f = await this.mine(user, id);
    const d = this.details(input, f);
    const got = await this.storage().finish(f.key, f.parts, f.mime);
    if (got.size < 1 || got.size > ARCHIVE_RULE.maxFileBytes || !/^[0-9a-f]{64}$/.test(got.sha256)) throw new BadRequest('The file did not arrive whole. Please add it again.');
    const kind = keyInFileKind(f.fileName, f.mime, got.head);
    // A program is never kept, whatever its name (Windows, Linux and Mac programs, from the first bytes). A file under a
    // document name must really be that document; any other kind of file is kept as it is, unread.
    const h = got.head;
    const program = (h[0] === 0x4d && h[1] === 0x5a) || (h[0] === 0x7f && h[1] === 0x45 && h[2] === 0x4c && h[3] === 0x46) || ([0xfe, 0xcf, 0xce].includes(h[0]) && h[1] === 0xfa && h[2] === 0xed && [0xfe, 0xce].includes(h[3])) || (h[0] === 0xcf && h[1] === 0xfa && h[2] === 0xed && h[3] === 0xfe) || (h[0] === 0xca && h[1] === 0xfe && h[2] === 0xba && h[3] === 0xbe);
    const ext = (/\.([A-Za-z0-9]{1,6})$/.exec(f.fileName.trim())?.[1] ?? '').toLowerCase();
    if (program) throw new BadRequest('This is a program, and programs are not kept. Every other kind of file is.');
    if (kind === 'unknown' && READ_EXT.has(ext)) throw new BadRequest(`This is not really a .${ext} file. Save it again from its own program and add it.`);
    return this.store.transaction(async (tx) => {
      const same = (await tx.list('archiveFiles', { owner: f.owner })).find((x) => x.id !== f.id && x.sha256 === got.sha256 && (x.status === 'filed' || x.status === 'set_aside'));
      const at = this.now();
      const words = input.words === undefined ? f.words : text(String(input.words ?? '').replace(/\r\n?/g, '\n'), ARCHIVE_RULE.maxWordsChars);
      const patch: Partial<ArchiveFile> = { ...d, kind, size: got.size, sha256: got.sha256, words, status: same ? 'duplicate' : 'filed', sameAs: same?.id ?? null, history: [{ at, by: user.name, what: same ? 'Added; the same file was already kept.' : 'Added.' }] };
      const row = await tx.update('archiveFiles', f.id, patch);
      await tx.audit({ at, actor: user.name, companyId: f.owner.startsWith('company:') ? f.owner.slice(8) : null, action: same ? 'archive.duplicate' : 'archive.filed', entity: 'archive_file', entityId: f.id, summary: `${same ? 'Duplicate of a kept file' : 'File kept'} in ${d.folder} for ${f.owner} (${got.size} bytes, sha256 ${got.sha256.slice(0, 12)}).` });
      return { file: this.view(user, row), duplicateOf: same ? this.view(user, same) : null };
    });
  }

  /** The files the person may see, newest first, never with their bytes or storage key. */
  async list(user: User, query: ArchiveQuery = {}) {
    this.must(user);
    if (this.store.hasTable && !(await this.store.hasTable('archiveFiles'))) return { installed: false as const, storage: !!this.bytes, owners: archiveOwnersOf(user), files: [] as ArchiveFileView[], total: 0, page: 0, pages: 0, counts: {} as Record<string, number>, toCheck: 0, leader: isGroupLeader(user) };
    const owners = archiveOwnersOf(user);
    const q = text(query.q, 80).toLowerCase();
    const all = (await this.store.list('archiveFiles', {})).filter((f) => archiveMaySee(user, f) && f.status !== 'uploading' && f.status !== 'duplicate');
    all.sort((a, b) => b.at.localeCompare(a.at));
    const pool = all.slice(0, ARCHIVE_RULE.maxListed);
    const live = pool.filter((f) => f.status === 'filed');
    const counts: Record<string, number> = {};
    for (const f of live) counts[f.folder] = (counts[f.folder] ?? 0) + 1;
    const toCheck = live.filter((f) => !f.checked && f.uploadedById === user.id).length;
    const hit = pool.filter((f) => {
      if (query.status === 'set_aside' ? f.status !== 'set_aside' : f.status !== 'filed') return false;
      if (query.status === 'to_check' && (f.checked || f.uploadedById !== user.id)) return false;
      if (query.status === 'mine' && f.uploadedById !== user.id) return false;
      if (query.owner && f.owner !== query.owner) return false;
      if (query.folder && f.folder !== query.folder) return false;
      if (query.year && f.year !== query.year) return false;
      if (q && ![f.title, f.ref ?? '', f.fileName, f.words].some((s) => s.toLowerCase().includes(q))) return false;
      return true;
    });
    const pages = Math.ceil(hit.length / ARCHIVE_RULE.pageSize);
    const page = Math.min(Math.max(0, Math.trunc(Number(query.page) || 0)), Math.max(0, pages - 1));
    return {
      installed: true as const,
      storage: !!this.bytes,
      owners,
      leader: isGroupLeader(user),
      files: hit.slice(page * ARCHIVE_RULE.pageSize, (page + 1) * ARCHIVE_RULE.pageSize).map((f) => this.view(user, f, q)),
      total: hit.length,
      page,
      pages,
      counts,
      toCheck,
    };
  }

  /** Opens a file: the bytes are checked against the size and SHA-256 kept when it was added, and the opening is logged. */
  private async openable(user: User, id: Id): Promise<ArchiveFile> {
    this.must(user);
    await this.ready();
    const f = await this.store.get('archiveFiles', id);
    if (!f || !archiveMaySee(user, f) || f.status === 'uploading') throw new NotFound('File');
    const src = f.status === 'duplicate' && f.sameAs ? await this.store.get('archiveFiles', f.sameAs) : f;
    if (!src || !archiveMaySee(user, src)) throw new NotFound('File');
    return src;
  }

  /**
   * Opening a file: the server checks that the file in storage is still the one that was added (size and SHA-256),
   * logs the opening, and says how many pieces to fetch. The bytes then come piece by piece from `openPart`, which
   * asks for the pass given here, so no piece is handed out without a logged opening.
   */
  async open(user: User, id: Id) {
    const src = await this.openable(user, id);
    const now = await this.storage().fingerprint(src.key);
    if (now.size !== src.size || now.sha256 !== src.sha256) throw new BadRequest('This file no longer matches the record made when it was added, so it is not opened. Tell IT.');
    const at = this.now();
    await this.store.audit({ at, actor: user.name, companyId: src.owner.startsWith('company:') ? src.owner.slice(8) : null, action: 'archive.opened', entity: 'archive_file', entityId: src.id, summary: `Opened ${src.restricted ? 'a restricted file' : 'a file'} in ${src.folder} of ${src.owner}.` });
    return { id: src.id, fileName: src.fileName, mime: src.mime, size: src.size, sha256: src.sha256, parts: Math.ceil(src.size / ARCHIVE_RULE.partBytes), partBytes: ARCHIVE_RULE.partBytes, pass: src.pass };
  }

  /** One piece of an opened file. `id` and `pass` are the ones `open` gave. */
  async openPart(user: User, id: Id, index: number, pass: unknown): Promise<Uint8Array> {
    const src = await this.openable(user, id);
    if (typeof pass !== 'string' || !src.pass || pass !== src.pass) throw new AccessDenied('view', 'a file that was not opened first');
    if (!Number.isInteger(index) || index < 0 || index >= Math.ceil(src.size / ARCHIVE_RULE.partBytes)) throw new BadRequest('No such piece of this file.');
    const start = index * ARCHIVE_RULE.partBytes;
    const want = Math.min(ARCHIVE_RULE.partBytes, src.size - start);
    const bytes = await this.storage().getRange(src.key, start, want);
    if (bytes.length !== want) throw new BadRequest('This file no longer matches the record made when it was added, so it is not opened. Tell IT.');
    return bytes;
  }

  /** The person corrects or confirms the details. Moving a file into or out of a restricted folder is logged. */
  async setDetails(user: User, id: Id, input: ArchiveDetails) {
    this.must(user);
    await this.ready();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('archiveFiles', id);
      const f = await tx.get('archiveFiles', id);
      if (!f || !archiveMaySee(user, f)) throw new NotFound('File');
      if (f.status !== 'filed') throw new BadRequest('Only a kept file can be changed.');
      if (!this.view(user, f).mayEdit) throw new AccessDenied('view', 'changing this file');
      const d = this.details(input, f);
      // Only the person who put it in, or a group leader, takes a file out of a restricted folder.
      if (f.restricted && !d.restricted && f.uploadedById !== user.id && !isGroupLeader(user)) throw new AccessDenied('view', 'taking a file out of a restricted folder');
      const at = this.now();
      const changed = (['folder', 'title', 'docDate', 'ref', 'origin'] as const).filter((k) => d[k] !== f[k]);
      const what = changed.length ? `Changed ${changed.join(', ')}${d.checked && !f.checked ? '; checked' : ''}.` : d.checked && !f.checked ? 'Checked.' : null;
      if (!what) return this.view(user, f);
      const row = await tx.update('archiveFiles', id, { ...d, history: [...f.history, { at, by: user.name, what }].slice(-30) });
      await tx.audit({ at, actor: user.name, companyId: f.owner.startsWith('company:') ? f.owner.slice(8) : null, action: 'archive.details', entity: 'archive_file', entityId: id, summary: `${what}${f.folder !== d.folder ? ` Folder ${f.folder} to ${d.folder}.` : ''}` });
      return this.view(user, row);
    });
  }

  /** A file put in by mistake is set aside with a reason. It stays on record and is never deleted. */
  async setAside(user: User, id: Id, reason: unknown) {
    this.must(user);
    await this.ready();
    const why = text(reason, 300);
    if (why.length < 5) throw new BadRequest('Say why the file is set aside (a few words).');
    return this.store.transaction(async (tx) => {
      await tx.lock?.('archiveFiles', id);
      const f = await tx.get('archiveFiles', id);
      if (!f || !archiveMaySee(user, f)) throw new NotFound('File');
      if (f.status !== 'filed') throw new BadRequest('Only a kept file can be set aside.');
      if (!this.view(user, f).mayEdit) throw new AccessDenied('view', 'setting this file aside');
      const at = this.now();
      const row = await tx.update('archiveFiles', id, { status: 'set_aside', setAside: { byId: user.id, by: user.name, at, reason: why }, history: [...f.history, { at, by: user.name, what: `Set aside: ${why}` }].slice(-30) });
      await tx.audit({ at, actor: user.name, companyId: f.owner.startsWith('company:') ? f.owner.slice(8) : null, action: 'archive.set_aside', entity: 'archive_file', entityId: id, summary: `File set aside: ${why}` });
      return this.view(user, row);
    });
  }

  /** Home: the person's own files still waiting for their check. */
  async homeItems(user: User) {
    if (!archiveAllowed(user, this.now().slice(0, 10))) return [];
    if (this.store.hasTable && !(await this.store.hasTable('archiveFiles'))) return [];
    const n = (await this.store.list('archiveFiles', { uploadedById: user.id })).filter((f) => f.status === 'filed' && !f.checked).length;
    return n ? [{ tone: 'info' as const, tag: 'Files', title: `${n} old file(s) waiting for your check`, detail: 'Open the data and file manager and confirm the folder, date and title.', go: { view: 'archive' as const } }] : [];
  }
}

function decodeBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
