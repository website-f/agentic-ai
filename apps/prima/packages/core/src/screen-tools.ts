import { AccessDenied, isActHead, isGroupLeader } from './access';
import type { ArchiveFolder } from './archive';
import { zipFiles } from './am-bq-xlsx';
import type { ImportKind } from './org-import';
import type { RecordKind } from './records';
import { BadRequest } from './service';
import { simplePdf } from './simple-pdf';
import { holdsSpeakUpHr } from './speak-up';
import type { Store } from './store';
import type { User } from './types';

/**
 * Upload, Key in and Download on every screen and tab (Fauzan, 23 Nov 2026: "After we check upload button for all tab or
 * all deparment. Dont have upload, key in , download").
 *
 * One toolbar sits above every screen. It adds no new authority and no new table:
 * - Upload keeps a file in the data and file manager ("Old files and data", module archive-v1), filed for the person's
 *   own unit, in the folder this screen suggests. The archive's own walls decide who may see it.
 * - Key in opens the plain record forms this screen holds (the record form engine; only for the people who keep that
 *   kind of record, and the server checks again) and points to the screen's own forms on the open tab. Screens that are
 *   read-only by design say why instead.
 * - Download gives what the person already sees on the open tab, as Excel or PDF. The server only ever sent them what
 *   their walls allow, so a download can never hold more. Every download is logged first (audit `export.download`);
 *   sensitive data (pay, medical, bank, firearms, speak-up, personal details) needs a reason, and speak-up lists are
 *   downloaded only by the people who handle speak-up reports.
 */

export type ExportSensitivity = 'pay' | 'medical' | 'bank' | 'firearms' | 'speakup' | 'personal';

export const EXPORT_SENSITIVITY_LABELS: Record<ExportSensitivity, { bm: string; en: string }> = {
  pay: { bm: 'gaji dan bayaran', en: 'pay' },
  medical: { bm: 'perubatan', en: 'medical' },
  bank: { bm: 'bank', en: 'bank' },
  firearms: { bm: 'senjata api', en: 'firearms' },
  speakup: { bm: 'aduan (speak up)', en: 'speak-up' },
  personal: { bm: 'butiran peribadi', en: 'personal details' },
};

export interface ScreenTools {
  /** The archive folder an upload from this screen goes to first; the person may change it. */
  folder: ArchiveFolder;
  /** Plain record kinds keyed in from this screen (shown only to their keepers). */
  records?: RecordKind[];
  /**
   * Other records this screen loads from a file with its own Import (P81/P90/P91 import kinds that are not plain record
   * forms). Upload offers these and the importable `records` (screen-upload.ts); the server checks every row again.
   */
  imports?: ImportKind[];
  /** When nothing is keyed in on this screen by design, why (shown instead of forms). */
  readOnly?: string;
  /** Sensitive data on every tab of this screen. Tabs may add more (see exportSensitivity). */
  sensitive?: ExportSensitivity;
  /** No toolbar at all (the site device). */
  none?: boolean;
}

const s = (folder: ArchiveFolder, more: Omit<ScreenTools, 'folder'> = {}): ScreenTools => ({ folder, ...more });

/** Every screen in the menu. A test checks this list matches the menu, so a new screen cannot be left out. */
export const SCREEN_TOOLS: Record<string, ScreenTools> = {
  home: s('other', { readOnly: 'Home lists your work from every screen. Key in on the screen the work belongs to.' }),
  overview: s('company', { records: ['company'] }),
  company: s('company', { records: ['company'], imports: ['licence'] }),
  office: s('company'),
  sites: s('operations', { records: ['site', 'post', 'checkpoint'] }),
  roster: s('operations'),
  guardroster: s('operations'),
  duty: s('operations'),
  cleaning: s('operations'),
  sitestock: s('operations', { imports: ['siteKitItem'] }),
  people: s('staff', { records: ['officeStaff'], imports: ['guardPaper'], sensitive: 'personal' }),
  attendance: s('operations', { readOnly: 'Attendance comes from the clock and the JA Group app feed. It is corrected through the screen’s own steps, never typed over.' }),
  cases: s('operations'),
  compliance: s('licences', { records: ['licence'] }),
  selfaudit: s('operations'),
  rba: s('company'),
  commercial: s('tenders', { imports: ['tender'] }),
  ops: s('operations', { imports: ['site'] }),
  hr: s('staff', { imports: ['leaveEntitlement', 'publicHoliday', 'staffTraining', 'guardPaper'], sensitive: 'personal' }),
  insurance: s('insurance', { records: ['insurancePolicy', 'insuranceClaim', 'insuranceGuarantee'] }),
  arms: s('operations', { records: ['vault', 'firearm', 'dealerLicence', 'armsAgreement', 'armsSupplier', 'supplierItem'], sensitive: 'firearms' }),
  cms: s('operations', { records: ['phoneExtension', 'siteSystem', 'cmsStaff'] }),
  cmsready: s('operations', { records: ['siteSystem'], imports: ['cmsDevice'] }),
  audit: s('other', { readOnly: 'The audit trail is written by Prima itself and is never typed in or changed.' }),
  device: s('operations', { none: true }),
  doa: s('letters'),
  marketing: s('tenders', { imports: ['tender', 'client'] }),
  reports: s('operations', { readOnly: 'Reports are worked out from the records. Key in on the screen the record belongs to.' }),
  surveys: s('clients'),
  meetings: s('letters'),
  mine: s('staff', { sensitive: 'personal' }),
  clock: s('staff', { sensitive: 'personal' }),
  staffclock: s('staff', { sensitive: 'personal' }),
  work: s('operations'),
  branchwork: s('operations'),
  fwm: s('staff', { imports: ['fwWorker', 'fwPaper'], sensitive: 'personal' }),
  socso: s('staff', { sensitive: 'medical' }),
  fwcost: s('finance'),
  fwstat: s('pay', { sensitive: 'pay' }),
  hostels: s('assets', { records: ['hostel'] }),
  claims: s('finance', { sensitive: 'medical' }),
  memos: s('letters'),
  pdpa: s('company', { imports: ['pdpaRegisterItem', 'pdpaProduct'], sensitive: 'personal' }),
  fleet: s('assets', { records: ['vehicle'], imports: ['fuelCard'] }),
  clients: s('clients', { imports: ['client'] }),
  requests: s('finance'),
  payreq: s('finance', { sensitive: 'bank' }),
  ja: s('operations', { readOnly: 'JA app data is read from the JA Group app. Change it in the JA Group app.' }),
  jaswitch: s('operations'),
  assets: s('assets', { records: ['amUnit', 'amTenancy', 'amWorkOrder', 'amAsset'] }),
  staffpay: s('pay', { sensitive: 'pay' }),
  // P128: the salary sheet is uploaded on the screen itself (read on the device); its own downloads are audited.
  contribfiles: s('pay', { sensitive: 'pay', readOnly: 'Upload the salary sheet in New file: Prima reads it and works out the contributions. Nothing is keyed in by hand here.' }),
  guardpay: s('pay', { sensitive: 'pay' }),
  advances: s('pay', { sensitive: 'pay' }),
  statutory: s('pay'),
  arrivalcash: s('pay', { sensitive: 'pay' }),
  loans: s('pay', { sensitive: 'pay' }),
  finance: s('finance', { imports: ['finBankAccount'], sensitive: 'bank' }),
  contracts: s('clients', { imports: ['contract'] }),
  branches: s('company', { imports: ['branch'] }),
  it: s('assets', { records: ['itDomain'], imports: ['itAsset'] }),
  'it-metrics': s('operations', { readOnly: 'Times and quality are measured by Prima from each job’s own steps.' }),
  'work-kpi': s('operations', { readOnly: 'KPIs are measured by Prima from each job’s own steps.' }),
  'it-procurement': s('assets', { imports: ['itAsset'] }),
  'hr-it-intake': s('staff'),
  'staff-directory': s('staff', { records: ['officeStaff'], sensitive: 'personal' }),
  orgchart: s('staff', { records: ['officeStaff'] }),
  accounts: s('other', { sensitive: 'personal' }),
  archive: s('other'),
  'data-cleanup': s('other', { readOnly: 'The checker only finds records to fix. Fix each one on its own screen.' }),
  assistant: s('other'),
  'shared-logins': s('other'),
  websites: s('other', { records: ['itDomain'] }),
  corporate: s('company', { imports: ['corpFiling', 'corpAudit', 'legalMatter'] }),
  renewals: s('licences', { imports: ['licence'] }),
  credit: s('finance', { sensitive: 'bank' }),
  purchasing: s('finance', { records: ['stockItem'], imports: ['purSupplier'] }),
  items: s('assets', { imports: ['itemType', 'itemUnit', 'itemStock'] }),
  governance: s('company'),
  quality: s('operations'),
  grc: s('other', { imports: ['grcObligation'] }),
  registers: s('company', { imports: ['regRisk'] }),
  act: s('operations'),
  payformulas: s('pay'),
  sitehours: s('operations'),
  salarycalc: s('pay', { sensitive: 'pay', readOnly: 'The calculator works a month out from the records; nothing is saved from it.' }),
  continuity: s('other', { imports: ['bcmSystem'] }),
  connections: s('other', { readOnly: 'Your own Microsoft 365 links. Nothing is keyed in here.' }),
  'it-extraction': s('other'),
  handovers: s('letters'),
  // Agentic Office screens (P121): the SOP guide is read-only text; asking for equipment files under assets.
  sop: s('other', { readOnly: 'The SOP and workflow guide is read-only text. Nothing is keyed in here.' }),
  equiprequests: s('assets'),
};

/** Words in a tab's name that make its download sensitive, whatever the screen. Checked in this order. */
const TAB_WORDS: [ExportSensitivity, RegExp][] = [
  ['speakup', /speak.?up|whistle|aduan|pemberi maklumat/i],
  ['firearms', /firearm|senjata|vault|peti besi|ammunition|peluru|arms\b/i],
  ['medical', /medical|perubatan|\bmc\b|hospital|clinic|klinik|sick|sakit/i],
  ['bank', /\bbank|account no|akaun bank/i],
  ['pay', /\bpay\b|payroll|payslip|salary|gaji|wage|upah|epf|kwsp|socso|perkeso|pcb|advance|pendahuluan|loan|pinjaman/i],
];

/** How sensitive a download of this tab is: the tab's own words first, then the screen. */
export function exportSensitivity(screen: string, tab: string | null | undefined): ExportSensitivity | null {
  const words = String(tab ?? '');
  for (const [kind, re] of TAB_WORDS) if (re.test(words)) return kind;
  if (screen === 'grc' && /speak|aduan/i.test(words)) return 'speakup';
  return SCREEN_TOOLS[screen]?.sensitive ?? null;
}

export const EXPORT_RULE = {
  id: 'EXPORT',
  /** A sensitive download needs a reason this long at least. */
  reasonMinChars: 10,
  maxRows: 20_000,
  maxSheets: 12,
  maxCellChars: 2_000,
};

/** Speak-up lists leave Prima only with the people who handle speak-up reports. */
export function mayDownloadSpeakUp(user: User): boolean {
  return isActHead(user) || holdsSpeakUpHr(user);
}

/** Whether the toolbar's Download shows for this person on this screen and tab (the server checks again). */
export function exportAllowed(user: User, screen: string, tab?: string | null): boolean {
  if (user.integration || user.role === 'site_device') return false;
  const tools = SCREEN_TOOLS[screen];
  if (!tools || tools.none) return false;
  if (exportSensitivity(screen, tab) === 'speakup') return mayDownloadSpeakUp(user);
  return true;
}

export interface ExportLogInput {
  screen?: unknown;
  tab?: unknown;
  format?: unknown;
  rows?: unknown;
  reason?: unknown;
  companyId?: unknown;
}

const clean = (v: unknown, max: number) =>
  String(v ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

export class ExportService {
  constructor(
    private store: Store,
    private now: () => string,
  ) {}

  /**
   * Logs a download before the file is made. The web makes the file only after this succeeds, and prints the
   * reference on it, so every file that leaves Prima can be traced to a person, a time and a reason.
   */
  async log(user: User, input: ExportLogInput) {
    const screen = clean(input.screen, 40);
    const tab = clean(input.tab, 80) || null;
    if (!SCREEN_TOOLS[screen] || SCREEN_TOOLS[screen].none) throw new BadRequest('This screen has no download.');
    if (!exportAllowed(user, screen, tab)) throw new AccessDenied('view', `(download of ${screen}${tab ? `, ${tab}` : ''})`);
    const format = input.format === 'pdf' || input.format === 'xlsx' || input.format === 'csv' ? input.format : null;
    if (!format) throw new BadRequest('Choose Excel, CSV or PDF.');
    const rows = Number(input.rows);
    if (!Number.isInteger(rows) || rows < 0 || rows > EXPORT_RULE.maxRows) throw new BadRequest(`A download holds at most ${EXPORT_RULE.maxRows} rows.`);
    const sensitivity = exportSensitivity(screen, tab);
    const reason = clean(input.reason, 300);
    if (sensitivity && reason.length < EXPORT_RULE.reasonMinChars) throw new BadRequest(`Say why you need this ${EXPORT_SENSITIVITY_LABELS[sensitivity].en} download (at least ${EXPORT_RULE.reasonMinChars} letters).`);
    const given = clean(input.companyId, 80);
    const companyId = given && (isGroupLeader(user) || user.companyIds.includes(given)) ? given : null;
    const at = this.now();
    const ref = `EXP-${at.slice(0, 10).replace(/-/g, '')}-${globalThis.crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    await this.store.audit({
      at,
      actor: user.name,
      companyId,
      action: 'export.download',
      entity: 'screen',
      entityId: screen,
      summary: `Downloaded ${format === 'xlsx' ? 'Excel' : format === 'csv' ? 'CSV' : 'PDF'} of ${screen}${tab ? ` / ${tab}` : ''}: ${rows} row${rows === 1 ? '' : 's'}.${sensitivity ? ` Sensitive (${sensitivity}). Reason: ${reason}` : ''} Ref ${ref}.`,
    });
    return { ref, at, by: user.name, sensitivity };
  }
}

// ---------- Files: what the person sees, as Excel or PDF ----------

export interface ExportSheet {
  name: string;
  header: string[];
  rows: string[][];
}

export interface ExportStamp {
  title: string;
  ref: string;
  at: string;
  by: string;
  sensitivity: ExportSensitivity | null;
}

const xmlEsc = (v: string) =>
  v
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const colName = (n: number): string => {
  let out = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) out = String.fromCharCode(65 + ((x - 1) % 26)) + out;
  return out;
};

/**
 * A plain number stays a number in Excel; anything else is text. Numbers with a leading zero, long digit strings
 * (IC, account and phone numbers) and anything starting = + - @ are kept as text, so nothing turns into a formula.
 */
const asNumber = (v: string): number | null => {
  const t = v.replace(/,/g, '').trim();
  if (!/^-?(0|[1-9]\d{0,9})(\.\d{1,4})?$/.test(t)) return null;
  return Number(t);
};

function sheetXml(sheet: ExportSheet, stampLines: string[]): string {
  const rows: string[] = [];
  let r = 0;
  const cell = (c: number, v: string, style = 0) => {
    const ref = `${colName(c)}${r}`;
    const st = style ? ` s="${style}"` : '';
    const n = style === 0 ? asNumber(v) : null;
    return n !== null ? `<c r="${ref}"${st}><v>${n}</v></c>` : `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v.slice(0, EXPORT_RULE.maxCellChars))}</t></is></c>`;
  };
  for (const line of stampLines) {
    r++;
    rows.push(`<row r="${r}">${cell(1, line, r === 1 ? 2 : 3)}</row>`);
  }
  r++;
  rows.push(`<row r="${r}"/>`);
  r++;
  rows.push(`<row r="${r}">${sheet.header.map((h, i) => cell(i + 1, h, 1)).join('')}</row>`);
  for (const row of sheet.rows) {
    r++;
    rows.push(`<row r="${r}">${row.map((v, i) => cell(i + 1, v)).join('')}</row>`);
  }
  const widths = sheet.header.map((h, i) => Math.min(60, Math.max(10, h.length + 2, ...sheet.rows.slice(0, 200).map((x) => (x[i] ?? '').length + 2))));
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    (widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '') +
    `<sheetData>${rows.join('')}</sheetData>` +
    '</worksheet>'
  );
}

/** Lines printed at the top of every file: what it is, who took it, when, and the log reference. */
export function exportStampLines(stamp: ExportStamp): string[] {
  return [
    stamp.title,
    `Downloaded by ${stamp.by} on ${stamp.at.slice(0, 16).replace('T', ' ')} UTC. Ref ${stamp.ref}.`,
    stamp.sensitivity
      ? `SULIT / CONFIDENTIAL: ${EXPORT_SENSITIVITY_LABELS[stamp.sensitivity].en} data. Need to know only. Do not forward.`
      : 'For PWVSB Security Group work only.',
  ];
}

const sheetName = (n: string, used: Set<string>) => {
  let base = n.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28) || 'Sheet';
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 25)} ${i}`;
  used.add(name.toLowerCase());
  return name;
};

/** What the person sees, as an Excel workbook: one sheet per table, the stamp on top of each. */
export function exportXlsx(sheets: ExportSheet[], stamp: ExportStamp): Uint8Array {
  if (!sheets.length) sheets = [{ name: 'Data', header: [''], rows: [] }];
  sheets = sheets.slice(0, EXPORT_RULE.maxSheets);
  const enc = new TextEncoder();
  const used = new Set<string>();
  const names = sheets.map((x) => sheetName(x.name, used));
  const lines = exportStampLines(stamp);
  const ct =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';
  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';
  const wb =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets>${names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
    '</workbook>';
  const wbRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>';
  const styles =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFD9E2F3"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="4">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';
  return zipFiles([
    { name: '[Content_Types].xml', data: enc.encode(ct) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: 'xl/workbook.xml', data: enc.encode(wb) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(wbRels) },
    { name: 'xl/styles.xml', data: enc.encode(styles) },
    ...sheets.map((sh, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(sheetXml(sh, lines)) })),
  ]);
}

/** What the person sees, as a plain PDF: the stamp, then each table as "Column: value" blocks so nothing is cut. */
export function exportPdf(sheets: ExportSheet[], stamp: ExportStamp): Uint8Array {
  const lines = [...exportStampLines(stamp), ''];
  for (const sh of sheets.slice(0, EXPORT_RULE.maxSheets)) {
    lines.push(`== ${sh.name} (${sh.rows.length}) ==`);
    const plain = sh.header.length <= 1 || sh.header.every((h) => !h);
    sh.rows.forEach((row, i) => {
      if (plain) lines.push(row.filter(Boolean).join('  ·  ').slice(0, EXPORT_RULE.maxCellChars));
      else {
        lines.push(`${i + 1}. ${sh.header[0] ? `${sh.header[0]}: ` : ''}${row[0] ?? ''}`);
        for (let c = 1; c < row.length; c++) if (row[c]) lines.push(`    ${sh.header[c] ? `${sh.header[c]}: ` : ''}${row[c].slice(0, EXPORT_RULE.maxCellChars)}`);
      }
    });
    lines.push('');
  }
  return simplePdf(lines);
}

/**
 * What the person sees as CSV (Fauzan, 23 Nov 2026: "Because payroll or epf sometimes use csv"). Only the columns and
 * rows, with no stamp lines, so another system can read it; the log reference goes in the file name instead. A cell
 * that starts with = + - @ is kept as text with a leading apostrophe, so a spreadsheet never runs it as a formula.
 * More than one table: each starts with its name on a line of its own, after a blank line.
 */
export function exportCsv(sheets: ExportSheet[]): Uint8Array {
  const cell = (v: string) => {
    let t = String(v ?? '').slice(0, EXPORT_RULE.maxCellChars);
    if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t)) t = `'${t}`;
    return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const line = (r: string[]) => r.map(cell).join(',');
  const parts = sheets.slice(0, EXPORT_RULE.maxSheets).map((sh) => [...(sheets.length > 1 ? [cell(sh.name)] : []), line(sh.header), ...sh.rows.map(line)].join('\r\n'));
  // A byte-order mark so Excel opens Malay and other letters correctly.
  return new TextEncoder().encode('﻿' + parts.join('\r\n\r\n') + '\r\n');
}
