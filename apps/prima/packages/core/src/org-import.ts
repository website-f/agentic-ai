// Real-data import: key the existing records once, from a spreadsheet, through the same checks as the forms
// (connect-departments, 2 Nov 2026).
//
// Going live means loading what already exists: sites, posts, licences, insurance, vehicles, hostels, office staff,
// stock items, domains. Typing hundreds of rows into forms is slow and error-prone; a separate loader would bypass the
// permission and validation rules. So the import runs every row through the record form's own save (saveRecord):
// the same person may import who may add the record by hand, and every row gets the same checks and audit entry.
//
//  1. Preview (dry run): each row is saved inside a transaction that is then rolled back, so the preview shows the
//     exact errors a real save would give. Nothing is kept. The preview returns a fingerprint (SHA-256) of the file.
//  2. Import: the person sends the same file with that fingerprint. The file must be unchanged and every row clean;
//     then all rows are saved in one transaction (all or none) and an import receipt is kept.
//  3. The same file cannot be imported twice (the fingerprint is refused a second time).
//
// Imported records are existing ones, so they do not start hand-overs between departments (no "new joiner" to-dos for
// staff already working). Restricted fields (IC and passport numbers) are never echoed back in the preview.
// The CEO's company master data and the arms register are not importable: they keep their own reviewed paths.

import { sha256Hex } from './audit';
import { cleanupCanonical } from './it-cleanup-hash';
import { RECORD_KINDS, type RecordKind, type RecordValues } from './records';
import type { Store } from './store';
import type { Id, IsoDateTime, User } from './types';
import { orgLinksOn, withoutHandOvers } from './org-links';

/** Record kinds that may be imported in bulk. */
export const IMPORTABLE_KINDS: readonly RecordKind[] = Object.freeze([
  'site',
  'post',
  'checkpoint',
  'licence',
  'insurancePolicy',
  'insuranceGuarantee',
  'vehicle',
  'stockItem',
  'hostel',
  'officeStaff',
  'amUnit',
  'amAsset',
  'itDomain',
] as RecordKind[]);

export const IMPORT_MAX_ROWS = 500;
export const IMPORT_MAX_BYTES = 1_000_000;

export interface OrgImportReceipt {
  id: Id;
  /** SHA-256 of kind, company and the cleaned rows. */
  fingerprint: string;
  kind: RecordKind;
  companyId: Id | null;
  rows: number;
  recordIds: Id[];
  byId: Id;
  by: string;
  at: IsoDateTime;
}

export interface ImportRowResult {
  row: number;
  ok: boolean;
  problems: string[];
  /** What will be saved, restricted fields masked to the last 4. */
  values: Record<string, string>;
}

/** The narrow part of PrimaService the import uses. */
export interface ImportSaver {
  recordForm(user: User, kind: RecordKind, id: Id | null, companyId: Id | null): Promise<{
    spec: (typeof RECORD_KINDS)[RecordKind];
    companyId: Id | null;
    options: Record<string, [string, string][]>;
    chooseCompany?: [string, string][] | null;
  }>;
  saveRecord(user: User, kind: RecordKind, id: Id | null, companyId: Id | null, raw: RecordValues): Promise<unknown>;
}

export class ImportError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 409,
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and line breaks inside quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (quoted) throw new ImportError('The file has a quote that is never closed.', 400);
  row.push(field);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

/** True only for a date on the calendar: 2027-02-30 and 2027-13-01 are not. */
function realDate(iso: string): boolean {
  const t = Date.parse(iso + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === iso;
}

const norm = (x: string) => x.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

/** A spreadsheet value to the form's value: yes/no, select by key or label, refs by id or name, dd/mm/yyyy dates. */
function convert(
  f: (typeof RECORD_KINDS)[RecordKind]['fields'][number],
  raw: string,
  options: [string, string][] | undefined,
): { value: unknown; problem?: string } {
  const v = raw.trim();
  if (v === '') return { value: f.type === 'bool' ? false : null };
  switch (f.type) {
    case 'bool': {
      const n = v.toLowerCase();
      if (['yes', 'y', 'true', '1', 'ya'].includes(n)) return { value: true };
      if (['no', 'n', 'false', '0', 'tidak'].includes(n)) return { value: false };
      return { value: null, problem: `${f.label}: write yes or no.` };
    }
    case 'date': {
      const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
      const iso = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : v;
      // A date that is not on the calendar (30/02, 31/04) is refused here, not stored as text.
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso) && !realDate(iso))
        return { value: null, problem: `${f.label}: "${v}" is not a real date.` };
      return { value: iso };
    }
    case 'number':
      return { value: v.replace(/,/g, '') };
    case 'select': {
      const hit = (f.options ?? []).filter(([k, label]) => k === v || norm(label) === norm(v) || norm(k) === norm(v));
      return hit.length === 1 ? { value: hit[0][0] } : { value: v };
    }
    case 'ref': {
      const hit = (options ?? []).filter(([k, label]) => k === v || norm(label) === norm(v));
      if (hit.length === 1) return { value: hit[0][0] };
      return { value: null, problem: hit.length ? `${f.label}: "${v}" matches more than one; use the id.` : `${f.label}: "${v}" is not on the list.` };
    }
    default:
      return { value: v };
  }
}

const DRY = Symbol('dry-run');

/** Run work and roll all of it back (database savepoint, or a snapshot in the in-memory store). */
async function rolledBack<R>(store: Store, fn: () => Promise<R>): Promise<R> {
  let out: R | undefined;
  const unit = store.cleanupTransaction ? store.cleanupTransaction.bind(store) : store.transaction.bind(store);
  try {
    await unit(async () => {
      out = await fn();
      throw DRY;
    });
  } catch (e) {
    if (e !== DRY) throw e;
  }
  return out as R;
}

/** Two people importing the same records at the same moment: the database's unique keys let only one through. */
const SAME_TIME = 'Someone else has already imported these records, or is importing them now. Nothing of yours was saved; check the list first.';
function sameTimeClash(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === '23505';
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'This row could not be saved.';
}

export class OrgImportService {
  constructor(
    private store: Store,
    private saver: ImportSaver,
    private now: () => IsoDateTime,
  ) {}

  /** The template for a kind: the column headers, with which are needed and the choices. */
  template(kind: RecordKind) {
    if (!IMPORTABLE_KINDS.includes(kind)) throw new ImportError('This kind of record is not imported in bulk.', 400);
    const spec = RECORD_KINDS[kind];
    return {
      kind,
      label: spec.label,
      keptBy: spec.keptBy,
      companyScoped: spec.companyScoped,
      columns: spec.fields.map((f) => ({
        key: f.key,
        label: f.label,
        required: !!f.required,
        type: f.type,
        choices: f.type === 'select' ? (f.options ?? []).map(([, l]) => l) : undefined,
        help: f.help ?? null,
      })),
      csvHeader: spec.fields.map((f) => f.key).join(','),
    };
  }

  private async prepare(user: User, kind: RecordKind, companyId: Id | null, csv: string) {
    if (!IMPORTABLE_KINDS.includes(kind)) throw new ImportError('This kind of record is not imported in bulk.', 400);
    if (typeof csv !== 'string' || !csv.trim()) throw new ImportError('Attach the file (CSV, first row the column names).', 400);
    if (csv.length > IMPORT_MAX_BYTES) throw new ImportError('The file is too big; split it into parts of 500 rows.', 400);
    // Same permission as adding one record by hand; throws for anyone who does not keep this record.
    const form = await this.saver.recordForm(user, kind, null, companyId);
    if (form.chooseCompany) throw new ImportError('Choose the company the records belong to.', 400);
    const spec = form.spec;
    const table = parseCsv(csv);
    if (table.length < 2) throw new ImportError('The file has no rows under the column names.', 400);
    if (table.length - 1 > IMPORT_MAX_ROWS) throw new ImportError(`At most ${IMPORT_MAX_ROWS} rows at a time.`, 400);
    const header = table[0];
    const fieldOf = header.map((h) => spec.fields.find((f) => norm(f.key) === norm(h) || norm(f.label) === norm(h)) ?? null);
    const seen = new Set<string>();
    const ignored = header.filter((_, i) => !fieldOf[i]).map((h) => h.trim()).filter(Boolean);
    const missing = spec.fields.filter((f) => f.required && !fieldOf.includes(f)).map((f) => f.label);
    const rows = table.slice(1).map((cells, i) => {
      const problems: string[] = [];
      const raw: RecordValues = {};
      fieldOf.forEach((f, c) => {
        if (!f) return;
        const { value, problem } = convert(f, cells[c] ?? '', form.options[f.key]);
        if (problem) problems.push(problem);
        (raw as Record<string, unknown>)[f.key] = value;
      });
      const key = cleanupCanonical(raw);
      if (seen.has(key)) problems.push('The same row appears earlier in the file.');
      seen.add(key);
      return { row: i + 2, raw, problems };
    });
    const fingerprint = sha256Hex(cleanupCanonical({ kind, companyId: form.companyId, rows: rows.map((r) => r.raw) }));
    return { spec, companyId: form.companyId, rows, ignored, missing, fingerprint };
  }

  private shown(spec: (typeof RECORD_KINDS)[RecordKind], raw: RecordValues): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of spec.fields) {
      const v = (raw as Record<string, unknown>)[f.key];
      if (v === null || v === undefined || v === '') continue;
      const s = String(v);
      out[f.key] = f.restricted ? `••••${s.slice(-4)}` : s.slice(0, 160);
    }
    return out;
  }

  /** Dry run: every row through the real save, then everything rolled back. */
  /** Import runs with the hand-over layer (same switch, same database module); the guide card says the same. */
  private assertOn() {
    if (!orgLinksOn(this.store)) throw new ImportError('Import is switched off here until the release owner turns hand-overs and import on.', 403);
  }

  async preview(user: User, kind: RecordKind, companyId: Id | null, csv: string) {
    this.assertOn();
    const p = await this.prepare(user, kind, companyId, csv);
    const results: ImportRowResult[] = await rolledBack(this.store, () =>
      withoutHandOvers(this.store, async () => {
        const out: ImportRowResult[] = [];
        for (const r of p.rows) {
          const problems = [...r.problems];
          if (!problems.length && !p.missing.length) {
            try {
              await this.store.transaction(() => this.saver.saveRecord(user, kind, null, p.companyId, r.raw));
            } catch (e) {
              problems.push(messageOf(e));
            }
          }
          out.push({ row: r.row, ok: !problems.length && !p.missing.length, problems, values: this.shown(p.spec, r.raw) });
        }
        return out;
      }),
    );
    const already = (await this.store.list('orgImports', {})).find((x) => x.fingerprint === p.fingerprint) ?? null;
    return {
      kind,
      label: p.spec.label,
      companyId: p.companyId,
      fingerprint: p.fingerprint,
      rows: results,
      okRows: results.filter((r) => r.ok).length,
      badRows: results.filter((r) => !r.ok).length,
      missingColumns: p.missing,
      ignoredColumns: p.ignored,
      alreadyImported: already ? { at: already.at, by: already.by } : null,
      canImport: !already && !p.missing.length && results.every((r) => r.ok),
    };
  }

  /** Import the previewed file: unchanged, every row clean, never twice. All rows or none. */
  async commit(user: User, kind: RecordKind, companyId: Id | null, csv: string, fingerprint: string) {
    this.assertOn();
    const p = await this.prepare(user, kind, companyId, csv);
    if (!/^[0-9a-f]{64}$/.test(fingerprint ?? '') || fingerprint !== p.fingerprint)
      throw new ImportError('The file changed since the preview. Preview it again.', 409);
    if (p.missing.length) throw new ImportError(`Columns needed: ${p.missing.join(', ')}.`, 400);
    const bad = p.rows.filter((r) => r.problems.length);
    if (bad.length) throw new ImportError(`Fix rows ${bad.map((r) => r.row).slice(0, 10).join(', ')} first.`, 400);
    return this.commitOnce(user, kind, p).catch((e) => {
      if (sameTimeClash(e)) throw new ImportError(SAME_TIME, 409);
      throw e;
    });
  }

  private commitOnce(user: User, kind: RecordKind, p: Awaited<ReturnType<OrgImportService['prepare']>>) {
    return this.store.transaction(async (tx) => {
      const receipts = await tx.list('orgImports', {});
      if (receipts.some((x) => x.fingerprint === p.fingerprint)) throw new ImportError('This file was already imported.', 409);
      const before = new Set((await tx.list(p.spec.table as never, {})).map((r) => (r as { id: Id }).id));
      await withoutHandOvers(tx, async () => {
        for (const r of p.rows) {
          try {
            await this.saver.saveRecord(user, kind, null, p.companyId, r.raw);
          } catch (e) {
            if (sameTimeClash(e)) throw new ImportError(SAME_TIME, 409);
            throw new ImportError(`Row ${r.row}: ${messageOf(e)} Nothing was imported.`, 400);
          }
        }
      });
      const recordIds = (await tx.list(p.spec.table as never, {})).map((r) => (r as { id: Id }).id).filter((id) => !before.has(id));
      const at = this.now();
      const receipt: OrgImportReceipt = {
        id: `oimp-${p.fingerprint.slice(0, 16)}`,
        fingerprint: p.fingerprint,
        kind,
        companyId: p.companyId,
        rows: p.rows.length,
        recordIds,
        byId: user.id,
        by: user.name,
        at,
      };
      await tx.insert('orgImports', receipt);
      await tx.audit({
        at,
        actor: user.name,
        companyId: p.companyId,
        action: 'org.import',
        entity: 'org_import',
        entityId: receipt.id,
        summary: `${p.rows.length} ${p.spec.label.toLowerCase()} record${p.rows.length === 1 ? '' : 's'} imported from a file (fingerprint ${p.fingerprint.slice(0, 12)}).`,
      });
      return receipt;
    });
  }
}
