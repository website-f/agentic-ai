import { sha256Hex } from './audit';
import type { IsoDate, ItJob, ItJobKind, ItTicket, ItTicketCategory, User } from './types';

/**
 * Bringing open IT work into Prima in batches (Fauzan, 31 Oct 2026, task T9): the CEO gives rows copied from Excel or
 * a CSV, reviews a preview, and approves the batch once. First slice: open help requests and open jobs only, new items
 * only, nothing updated, merged or deleted. Nothing is guessed: a required value that is missing or unreadable is an
 * error on its row, and that row is left out.
 */
export type ItImportKind = 'tickets' | 'jobs';

export const IT_IMPORT_MAX_ROWS = 200;
export const IT_IMPORT_MAX_CHARS = 200_000;
/** Longest value Prima keeps for each field; a longer one is an error on its row, never cut short. */
export const IT_IMPORT_MAX_LEN = { source: 200, title: 120, requester: 80, detail: 1000 } as const;

type TicketField = 'title' | 'category' | 'priority' | 'requester' | 'channel' | 'raisedOn' | 'detail' | 'itPerson';
type JobField = 'title' | 'kind' | 'priority' | 'technical' | 'doer' | 'dueOn' | 'detail';
export type ItImportField = TicketField | JobField;

/** Column headings Prima recognises, compared without case, spaces or punctuation. */
const HEADINGS: Record<ItImportKind, Record<string, string[]>> = {
  tickets: {
    title: ['title', 'subject', 'issue', 'problem', 'request', 'whatiswrong', 'summary'],
    category: ['about', 'category', 'type'],
    priority: ['urgency', 'priority'],
    requester: ['requester', 'raisedby', 'requestedby', 'askedby', 'from', 'staff', 'user'],
    channel: ['channel', 'via', 'how', 'reachedby'],
    raisedOn: ['date', 'raised', 'raisedon', 'dateraised', 'created', 'reportedon'],
    detail: ['detail', 'details', 'description', 'notes', 'note'],
    itPerson: ['itperson', 'assignedto', 'assignee', 'handledby', 'pic'],
  },
  jobs: {
    title: ['title', 'job', 'task', 'work'],
    kind: ['kind', 'type', 'category'],
    priority: ['urgency', 'priority'],
    technical: ['technical', 'tech', 'itleadcheck'],
    doer: ['doer', 'assignedto', 'assignee', 'pic', 'itperson', 'owner'],
    dueOn: ['due', 'duedate', 'dueon', 'deadline'],
    detail: ['detail', 'details', 'description', 'notes', 'note'],
  },
};

const REQUIRED: Record<ItImportKind, string[]> = {
  tickets: ['title', 'requester', 'channel', 'priority'],
  jobs: ['title', 'doer', 'dueOn', 'priority'],
};

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** One record of the table: its row number in the sheet (the heading row is 1), its cells, and what is wrong with its layout. */
export interface ItImportRecord {
  row: number;
  cells: string[];
  errors: string[];
}

export interface ItImportTable {
  records: ItImportRecord[];
  /** Problems with the whole table; any of them stops the batch. */
  problems: string[];
}

/**
 * Rows from text pasted out of Excel (tab-separated) or a CSV file (commas, with "quoted, values"). Row numbers are the
 * sheet's: blank rows still count, and a quoted cell running over several lines stays one row. Nothing is repaired: a
 * quote that never closes stops the table, and a row whose quotes are broken is marked with an error.
 */
export function parseItImportTable(text: string): ItImportTable {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const first = src.split('\n', 1)[0] ?? '';
  const sep = first.includes('\t') ? '\t' : ',';
  const csv = sep === ',';
  const records: ItImportRecord[] = [];
  const problems: string[] = [];
  let rec: ItImportRecord = { row: 1, cells: [], errors: [] };
  let cell = '';
  // 'start' before a cell's first character, 'quoted' inside quotes, 'closed' after the closing quote, 'plain' otherwise.
  let state: 'start' | 'quoted' | 'closed' | 'plain' = 'start';
  const fault = (e: string) => {
    if (!rec.errors.includes(e)) rec.errors.push(e);
  };
  const endCell = () => {
    rec.cells.push(state === 'quoted' || state === 'closed' ? cell : cell.trim());
    cell = '';
    state = 'start';
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (state === 'quoted') {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') state = 'closed';
      else cell += ch;
    } else if (ch === sep) endCell();
    else if (ch === '\n') {
      endCell();
      records.push(rec);
      rec = { row: rec.row + 1, cells: [], errors: [] };
    } else if (state === 'closed') {
      if (ch !== ' ') fault('Text follows a closing quote mark. Put the whole cell in quotes, with "" for a quote mark inside it.');
    } else if (ch === '"' && state === 'start' && cell.trim() === '') {
      cell = '';
      state = 'quoted';
    } else if (ch === '"' && csv) {
      fault('A quote mark sits inside a cell that is not in quotes. Put the whole cell in quotes, with "" for a quote mark inside it.');
      cell += ch;
      state = 'plain';
    } else {
      cell += ch;
      if (ch !== ' ') state = 'plain';
    }
  }
  if (state === 'quoted') problems.push(`The quote mark opened on row ${rec.row} is never closed, so the rows after it cannot be read.`);
  endCell();
  records.push(rec);
  const kept = records.filter((r) => r.cells.some((c) => c.trim() !== '') || r.errors.length);
  const width = kept[0]?.cells.length ?? 0;
  for (const r of kept.slice(1)) {
    const used = r.cells.length - [...r.cells].reverse().findIndex((c) => c.trim() !== '');
    if (r.cells.some((c) => c.trim() !== '') && used > width)
      r.errors.push(`This row has ${used} cells but the heading row has ${width}${csv ? ': a value with a comma may need quotes' : ''}.`);
  }
  return { records: kept, problems };
}

/** Which column holds which field: the first heading that matches each field. */
export function mapItImportHeadings(kind: ItImportKind, headings: string[]): Partial<Record<ItImportField, number>> {
  const out: Partial<Record<ItImportField, number>> = {};
  const keys = headings.map(squash);
  for (const [field, names] of Object.entries(HEADINGS[kind])) {
    const at = keys.findIndex((k) => names.includes(k));
    if (at >= 0 && !Object.values(out).includes(at)) out[field as ItImportField] = at;
  }
  return out;
}

/** A date written 2026-10-31, 31/10/2026 or 31-10-2026; anything else is unreadable. */
export function readItImportDate(raw: string): IsoDate | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let hit = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (hit) [y, m, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  else if ((hit = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) [d, m, y] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function readPriority(raw: string): 'P1' | 'P2' | 'P3' | null {
  const s = squash(raw);
  if (['p1', '1', 'high', 'urgent', 'critical'].includes(s)) return 'P1';
  if (['p2', '2', 'medium', 'normal'].includes(s)) return 'P2';
  if (['p3', '3', 'low'].includes(s)) return 'P3';
  return null;
}

function readCategory(raw: string): ItTicketCategory | null {
  const s = squash(raw);
  if (!s || s === 'other') return 'OTHER';
  if (['account', 'password', 'login', 'signin'].includes(s)) return 'ACCOUNT';
  if (['device', 'laptop', 'desktop', 'pc', 'printer', 'phone', 'tablet'].includes(s)) return 'DEVICE';
  if (['m365', 'microsoft365', 'office', 'outlook', 'teams', 'email', 'onedrive', 'sharepoint'].includes(s)) return 'M365';
  if (['network', 'wifi', 'internet', 'lan', 'vpn'].includes(s)) return 'NETWORK';
  if (['prima', 'app'].includes(s)) return 'PRIMA';
  return null;
}

function readChannel(raw: string): NonNullable<ItTicket['channel']> | null {
  const s = squash(raw);
  if (s === 'teams') return 'teams';
  if (s === 'email' || s === 'mail') return 'email';
  if (s === 'phone' || s === 'call' || s === 'whatsapp') return 'phone';
  if (s === 'inperson' || s === 'walkin' || s === 'desk') return 'in_person';
  return null;
}

function readKind(raw: string): ItJobKind | null {
  const s = squash(raw);
  if (!s) return 'task';
  return (['task', 'install', 'check', 'training', 'access', 'other'] as const).find((k) => k === s) ?? null;
}

function readYesNo(raw: string): boolean | null {
  const s = squash(raw);
  if (!s || ['no', 'n', 'false', '0'].includes(s)) return false;
  if (['yes', 'y', 'true', '1'].includes(s)) return true;
  return null;
}

/** An IT person by Prima ID or by name; "(mock)" placeholders match without the marker. Never the IT Manager. */
function findItPerson(raw: string, it: User[]): User | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const plain = (n: string) => n.toLowerCase().replace(/\s*\(mock\)\s*$/, '').trim();
  const hits = it.filter((u) => u.itRole !== 'manager' && (u.id.toLowerCase() === s || plain(u.name) === plain(s)));
  return hits.length === 1 ? hits[0] : null;
}

export interface ItImportRow {
  /** The row's number in the sheet, counting the heading row as 1. */
  row: number;
  sourceRef: string;
  errors: string[];
  warnings: string[];
  /** Left out because it repeats an earlier row of this batch or an open item already in Prima. */
  duplicateOf: string | null;
  ticket?: Pick<ItTicket, 'title' | 'category' | 'priority' | 'detail' | 'at'> & { raisedFor: string; channel: NonNullable<ItTicket['channel']>; itPersonId: string | null; itPerson: string | null };
  job?: Pick<ItJob, 'title' | 'kind' | 'priority' | 'technical' | 'dueOn' | 'detail'> & { doerId: string; doer: string };
}

export interface ItImportPreview {
  kind: ItImportKind;
  source: string;
  headings: string[];
  mapping: Partial<Record<ItImportField, string>>;
  missingColumns: string[];
  /** Problems with the whole table (a quote never closed, two columns read as one field); any of them stops the batch. */
  problems: string[];
  rows: ItImportRow[];
  /** Rows that would be created: no errors and not duplicates. */
  ready: number;
  /**
   * A fingerprint of exactly what this preview shows: the input and every row's outcome and values. Approving sends it
   * back, and the batch is refused if a fresh check of the same input no longer matches it.
   */
  previewToken: string;
}

/** The fingerprint of a batch's input alone, kept with what it created, so a retry under its batch ID must bring the same rows. */
export function itImportInputHash(kind: ItImportKind, source: string, text: string): string {
  return sha256Hex(JSON.stringify(['it-import-input-v1', kind, source.trim(), text]));
}

/** The fingerprint of a preview: everything it shows except warnings and the clock time given to undated rows. */
export function itImportToken(p: Omit<ItImportPreview, 'previewToken'>, text: string): string {
  const rows = p.rows.map((r) => [
    r.row,
    r.sourceRef,
    r.errors,
    r.duplicateOf,
    r.ticket ? { ...r.ticket, at: r.ticket.at.slice(0, 10) } : null,
    r.job ?? null,
  ]);
  return sha256Hex(JSON.stringify(['it-import-v1', p.kind, p.source, text, p.headings, p.mapping, p.missingColumns, p.problems, rows]));
}

/**
 * Check every row of a batch without changing anything. `itUsers` are the IT department's staff records; `openTickets`
 * and `openJobs` are the open items already in Prima, for the duplicate check; `now` is the server's time.
 */
export function previewItImport(input: {
  kind: ItImportKind;
  text: string;
  source: string;
  itUsers: User[];
  openTickets: ItTicket[];
  openJobs: ItJob[];
  now: string;
}): ItImportPreview {
  const { kind, itUsers, now } = input;
  const today = now.slice(0, 10);
  const source = input.source.trim();
  const table = parseItImportTable(input.text);
  const head = table.records[0];
  const headings = head?.cells ?? [];
  const problems = [...table.problems];
  if (head && head.row !== 1) problems.push(`The heading row must be row 1; row 1 is blank.`);
  if (head?.errors.length) problems.push(`The heading row cannot be read: ${head.errors.join(' ')}`);
  const map = mapItImportHeadings(kind, headings);
  for (const [field, names] of Object.entries(HEADINGS[kind])) {
    const cols = headings.filter((h) => names.includes(squash(h)));
    if (cols.length > 1) problems.push(`Columns ${cols.map((c) => `"${c}"`).join(' and ')} are both read as ${field}. Rename or remove one.`);
  }
  const missingColumns = REQUIRED[kind].filter((f) => map[f as ItImportField] == null);
  const mapping: ItImportPreview['mapping'] = {};
  for (const [f, i] of Object.entries(map)) mapping[f as ItImportField] = headings[i as number];
  const seen = new Map<string, number>();
  const rows = table.records.slice(1).map((rec): ItImportRow => {
    const { cells, row: rowNo } = rec;
    const get = (f: ItImportField) => (map[f] == null ? '' : (cells[map[f]!] ?? '').trim());
    const errors: string[] = [...rec.errors];
    const warnings: string[] = [];
    const out: ItImportRow = { row: rowNo, sourceRef: `${source}, row ${rowNo}`, errors, warnings, duplicateOf: null };
    const tooLong = (label: string, value: string, max: number) => {
      if (value.length > max) errors.push(`${label} is ${value.length} characters; the most is ${max}. Shorten it in the sheet.`);
    };
    const title = get('title');
    if (title.length < 3) errors.push('No title.');
    tooLong('Title', title, IT_IMPORT_MAX_LEN.title);
    const priority = readPriority(get('priority'));
    if (!priority) errors.push(get('priority') ? `Urgency "${get('priority')}" is not P1, P2 or P3.` : 'No urgency.');
    const detail = get('detail');
    tooLong('Detail', detail, IT_IMPORT_MAX_LEN.detail);
    let key = '';
    if (kind === 'tickets') {
      const raisedFor = get('requester');
      if (raisedFor.length < 2) errors.push('No requester.');
      tooLong('Requester', raisedFor, IT_IMPORT_MAX_LEN.requester);
      const channel = readChannel(get('channel'));
      if (!channel) errors.push(get('channel') ? `How they reached IT, "${get('channel')}", is not Teams, email, phone or in person.` : 'No channel.');
      const category = readCategory(get('category'));
      if (!category) errors.push(`What it is about, "${get('category')}", is not recognised.`);
      else if (!get('category')) warnings.push('No "about": set to Other.');
      let at = now;
      const rawDate = get('raisedOn');
      if (!rawDate) warnings.push('No date raised: the import time is used.');
      else {
        const d = readItImportDate(rawDate);
        if (!d) errors.push(`Date raised "${rawDate}" is unreadable.`);
        else if (d > today) errors.push('Date raised is in the future.');
        else at = d === today ? now : `${d}T09:00:00+08:00`;
      }
      const rawPerson = get('itPerson');
      const person = rawPerson ? findItPerson(rawPerson, itUsers) : null;
      if (rawPerson && !person) errors.push(`IT person "${rawPerson}" is not the IT Lead or an IT Executive in Prima.`);
      if (!errors.length)
        out.ticket = { title, category: category!, priority: priority!, detail, at, raisedFor, channel: channel!, itPersonId: person?.id ?? null, itPerson: person?.name ?? null };
      key = `${squash(title)}|${squash(raisedFor)}`;
      const open = input.openTickets.find((t) => t.status !== 'resolved' && squash(t.title) === squash(title) && squash(t.raisedFor ?? t.raisedBy) === squash(raisedFor));
      if (open) out.duplicateOf = `${open.ref}, already open in Prima`;
    } else {
      const rawDoer = get('doer');
      const doer = rawDoer ? findItPerson(rawDoer, itUsers) : null;
      if (!doer) errors.push(rawDoer ? `Doer "${rawDoer}" is not the IT Lead or an IT Executive in Prima.` : 'No doer.');
      const rawDue = get('dueOn');
      const dueOn = rawDue ? readItImportDate(rawDue) : null;
      if (!dueOn) errors.push(rawDue ? `Due date "${rawDue}" is unreadable.` : 'No due date.');
      else if (dueOn < today) warnings.push('Due date has passed: it shows as late.');
      const kindOf = readKind(get('kind'));
      if (!kindOf) errors.push(`Kind "${get('kind')}" is not task, install, check, training, access or other.`);
      const technical = readYesNo(get('technical'));
      if (technical == null) errors.push(`Technical "${get('technical')}" is not yes or no.`);
      if (!errors.length) out.job = { title, kind: kindOf!, priority: priority!, technical: technical!, dueOn: dueOn!, detail, doerId: doer!.id, doer: doer!.name };
      key = `${squash(title)}|${doer?.id ?? squash(rawDoer)}`;
      const open = input.openJobs.find((j) => !['accepted', 'cancelled'].includes(j.status) && squash(j.title) === squash(title) && j.assigneeId === doer?.id);
      if (open) out.duplicateOf = `${open.ref}, already open in Prima`;
    }
    if (!out.duplicateOf && title.length >= 3) {
      const earlier = seen.get(key);
      if (earlier) out.duplicateOf = `row ${earlier} of this batch`;
      else seen.set(key, rowNo);
    }
    return out;
  });
  if (head && !rows.length) problems.push('There are no rows under the heading row.');
  const p = {
    kind,
    source,
    headings,
    mapping,
    missingColumns,
    problems,
    rows,
    ready: missingColumns.length || problems.length ? 0 : rows.filter((r) => !r.errors.length && !r.duplicateOf).length,
  };
  return { ...p, previewToken: itImportToken(p, input.text) };
}
