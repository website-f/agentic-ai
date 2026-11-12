import { Select } from '../SearchSelect';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircleIcon, DownloadSimpleIcon, FileArrowUpIcon, MagnifyingGlassIcon, SparkleIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import {
  COMPANY_FIELD,
  EXTRA_IMPORTS,
  IMPORTABLE_KINDS,
  RECORD_KINDS,
  cleanGrid,
  extractPdfTable,
  headerSignature,
  importSpec,
  normHeader,
  normaliseTable,
  parseCsv,
  pickSheet,
  prepareSheet,
  readDocxTables,
  readXlsx,
  smartMatch,
  toCsv,
  valueShape,
  type AlignField,
  type ImportKind,
  type OrgImportReceipt,
  type PreparedSheet,
  type RecordKind,
  type SmartColumn,
  type SmartLevel,
  type XlsxSheet,
} from '@prima/core';
import { api, ApiError, type OrgImportPreview, type OrgImportTemplate } from '../api';
import { useApp } from '../App';
import { Steps, type StepState } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, RefreshContext, dateTimeLabel } from '../ui';
import { useRecordKinds } from './RecordForm';
import '../styles/import.css';

/**
 * P81: "Import" next to "Add". P90 (Fitri, 9 Nov 2026: "upload any kind of file that matches and contains the data"):
 * the file may be Excel, CSV, a Word table or a PDF list, in any layout. Prima reads it here on the device, finds the
 * sheet and the header row, and matches every column to the record's fields with the in-browser matcher (core
 * import-match.ts: words in English and Malay, typos, what the values look like, the best whole assignment, a confidence
 * per match). The person checks the matches (the unsure ones are marked), then every row is checked by the server
 * through the same save as the Add form without keeping anything; rows are fixed or skipped; the chosen rows are
 * imported all or none, with a receipt and an audit entry. A layout the person confirmed is remembered on this device.
 */

const isRecordKind = (k: ImportKind): k is RecordKind => Object.prototype.hasOwnProperty.call(RECORD_KINDS, k);
/** P91: a field's header words from the kind's spec in core (the same table the server checks with). */
function specWords(kind: ImportKind, key: string): string[] | undefined {
  try {
    return (importSpec(kind).fields.find((f) => f.key === key) as { words?: string[] } | undefined)?.words;
  } catch {
    return undefined;
  }
}
const MAX_FILE = 8_000_000;
const MAX_CSV = 1_000_000;
const SEVERAL = '*';
const ACCEPT = '.xlsx,.xlsm,.csv,.txt,.tsv,.docx,.pdf,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** The browser's own decoders: raw deflate for the zip inside .xlsx and .docx, zlib deflate for PDF streams. */
async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function inflatePdf(b: Uint8Array): Promise<Uint8Array> {
  const reader = new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      size += value.length;
      if (size > 8_000_000) break;
    }
  } catch {
    if (!parts.length) throw new Error('unreadable');
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const x of parts) {
    out.set(x, at);
    at += x.length;
  }
  return out;
}

/** Any supported file to its sheets of cell text. K8: the bulk load helper reads files the same way. */
export async function sheetsOf(f: File): Promise<XlsxSheet[]> {
  const name = f.name.toLowerCase();
  if (name.endsWith('.xls') || name.endsWith('.numbers') || name.endsWith('.ods') || name.endsWith('.doc'))
    throw new Error('This is an older or other office format. Open it and save it as Excel (.xlsx), Word (.docx), PDF or CSV, then choose it again.');
  if (name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.tsv') || f.type === 'text/csv') {
    const text = await f.text();
    const tabs = name.endsWith('.tsv') || (text.split('\n', 3).join('').includes('\t') && !text.split('\n', 1)[0].includes(','));
    const rows = tabs ? text.split(/\r?\n/).map((l) => l.split('\t')) : parseCsv(text);
    return [{ name: f.name, rows }];
  }
  const bytes = new Uint8Array(await f.arrayBuffer());
  if (name.endsWith('.pdf') || f.type === 'application/pdf') {
    const rows = await extractPdfTable(bytes, inflatePdf);
    if (rows.filter((r) => r.length >= 2).length < 2)
      throw new Error('No table could be read from this PDF. A scanned paper is a picture: type it into the template, or ask for the Excel copy.');
    return [{ name: f.name, rows }];
  }
  if (name.endsWith('.docx')) return readDocxTables(bytes, inflateRaw);
  return readXlsx(bytes, inflateRaw);
}

/** The layout this person confirmed for this record and these column names, on this device. */
const layoutKey = (kind: ImportKind, header: string[]) => `prima.import.layout.${kind}.${headerSignature(header)}`;
function rememberedLayout(kind: ImportKind, header: string[]): Record<string, string> | null {
  try {
    const v = localStorage.getItem(layoutKey(kind, header));
    return v ? (JSON.parse(v) as Record<string, string>) : null;
  } catch {
    return null;
  }
}
function rememberLayout(kind: ImportKind, header: string[], mapping: string[]) {
  try {
    const m: Record<string, string> = {};
    header.forEach((h, i) => {
      if (mapping[i] && normHeader(h)) m[normHeader(h)] = mapping[i];
    });
    localStorage.setItem(layoutKey(kind, header), JSON.stringify(m));
  } catch {
    /* private window or storage full: the matcher still works, it is just not remembered */
  }
}

export function ImportButton({
  kind,
  companyId = null,
  label = 'Import from file',
  choices,
}: {
  kind: ImportKind;
  companyId?: string | null;
  label?: string;
  /** The companies the page's own Add offers ([id, name]); without it, the Add form's list or the person's companies. */
  choices?: [string, string][];
}) {
  const kinds = useRecordKinds();
  const [open, setOpen] = useState(false);
  if (!IMPORTABLE_KINDS.includes(kind)) return null;
  // Record kinds: the same people the Add button shows for. Other kinds sit next to their page's own Add, which the
  // page already shows only to those who may add; the server checks every row again either way.
  if (isRecordKind(kind) && !kinds.has(kind)) return null;
  return (
    <>
      <button
        className="btn btn-sm"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title="Load existing records from Excel, CSV, Word or PDF"
      >
        <UploadSimpleIcon size={16} weight="bold" aria-hidden="true" />
        {label}
      </button>
      {open && <ImportDrawer kind={kind} companyId={companyId} choices={choices} onClose={() => setOpen(false)} />}
    </>
  );
}

type Step = 'file' | 'map' | 'check' | 'done';
const STEP_ORDER: Step[] = ['file', 'map', 'check', 'done'];
const LEVEL: Record<SmartLevel, [string, 'ok' | 'info' | 'warn']> = {
  sure: ['Sure', 'ok'],
  likely: ['Likely', 'info'],
  check: ['Check this', 'warn'],
};

type Err = { message: string; findings: [] } | null;
const errOf = (e: unknown): Err => ({ message: e instanceof ApiError || e instanceof Error ? e.message : String(e), findings: [] });

/** What each column is matched to, and how sure: from the matcher, then the person's own choices. */
type ColState = { field: string; level: SmartLevel | null; how: SmartColumn['how']; why: string };

/** K8: a file the bulk load helper already read and planned: its table (header row first), the field of each column. */
export interface ImportStart {
  fileName: string;
  table: string[][];
  mapping: string[];
  /** Rows (file numbering) the person chose to leave out in the plan. */
  skip?: number[];
}

export function ImportDrawer({
  kind,
  companyId: given,
  choices: offered,
  onClose,
  start,
  onImported,
}: {
  kind: ImportKind;
  companyId: string | null;
  choices?: [string, string][];
  onClose: () => void;
  /** K8: start at the column check with the bulk load helper's plan, instead of choosing a file. */
  start?: ImportStart;
  /** K8: told when the rows are imported (the receipt, and the problems of the rows left out). */
  onImported?: (r: OrgImportReceipt, refused: { row: number; reasons: string[] }[]) => void;
}) {
  const { me } = useApp();
  const { bump } = useContext(RefreshContext);
  const [tpl, setTpl] = useState<OrgImportTemplate | null>(null);
  const [choices, setChoices] = useState<[string, string][] | null>(null);
  const [companyId, setCompanyId] = useState(given ?? '');
  const [step, setStep] = useState<Step>('file');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Err>(null);
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<XlsxSheet[] | null>(null);
  const [sheet, setSheet] = useState(0);
  const [prep, setPrep] = useState<PreparedSheet | null>(null);
  const [cols, setCols] = useState<SmartColumn[] | null>(null);
  const [state, setState] = useState<ColState[]>([]);
  const [grid, setGrid] = useState<string[][] | null>(null);
  const [preview, setPreview] = useState<OrgImportPreview | null>(null);
  const [skip, setSkip] = useState<number[]>([]);
  const [fixing, setFixing] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<OrgImportReceipt | null>(null);
  const [aiOn, setAiOn] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let live = true;
    api.org.importAiState().then((s) => live && setAiOn(!!s?.on), () => undefined);
    api.org.importTemplate(kind).then(
      async (t) => {
        if (!live) return;
        setTpl(t);
        if (!t.companyScoped || given) return setChoices([]);
        // The companies this person keeps the record for: the Add form's own list (HR's for leave days).
        let list: [string, string][];
        if (offered) list = offered;
        else if (isRecordKind(kind) || kind === 'leaveEntitlement') {
          const f = await api.recordForm(isRecordKind(kind) ? kind : 'officeStaff', null, null).catch(() => null);
          list = f?.chooseCompany ?? (f?.companyId ? [[f.companyId, f.companyId]] : []);
        } else list = me.companies.map((c): [string, string] => [c.id, `${c.code} ${c.name}`]);
        if (!live) return;
        setChoices(list);
        if (list.length === 1) setCompanyId(list[0][0]);
      },
      (e) => live && setError(errOf(e)),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the page's list is read once, when the drawer opens.
  }, [kind, given]);

  const cid = companyId === SEVERAL ? null : companyId || null;
  /** The record's fields as the matcher sees them (choices as their labels), and the Company column when it applies. */
  const fields: AlignField[] = useMemo(
    () =>
      tpl
        ? [
            ...tpl.columns.map((c) => ({
              key: c.key,
              label: c.label,
              type: c.type as AlignField['type'],
              required: c.required,
              options: c.choices?.map((l): [string, string] => [l, l]),
              // P91: the spec's own column words (English and Malay) from the template and the spec reach the matcher.
              words: [...new Set([...('words' in c && c.words ? c.words : []), ...(specWords(tpl.kind, c.key) ?? [])])],
            })),
            ...(tpl.companyScoped ? [{ key: COMPANY_FIELD, label: 'Company', type: 'text' as const }] : []),
          ]
        : [],
    [tpl],
  );
  // K8: the bulk load helper's plan: matched here as usual, then each column set to the field the person confirmed.
  const started = useRef(false);
  useEffect(() => {
    if (!start || started.current || !fields.length) return;
    started.current = true;
    setFileName(start.fileName);
    const m = smartMatch(start.table, fields, { headerRow: 0 });
    setPrep({ table: start.table, headerRow: 0, droppedRows: [], splits: [] });
    setCols(m.columns);
    setState(m.columns.map((c, i) => (start.mapping[i] ? { field: start.mapping[i], level: 'sure', how: 'manual', why: 'Placed in the bulk load plan you confirmed.' } : { field: '', level: null, how: null, why: '' })));
    setSkip(start.skip ?? []);
    setStep('map');
  }, [start, fields]);
  const fieldLabel = (key: string) => (key === COMPANY_FIELD ? 'Company (each row to the company it names)' : (fields.find((f) => f.key === key)?.label ?? key));

  /** Match a sheet here on the device: no network, a fraction of a second. */
  function matchSheet(rows: string[][], headerRow?: number | null) {
    const p = prepareSheet(rows, fields, headerRow ?? null);
    if (p.table.length < 2) return setError(errOf('This sheet has no rows under the column names.'));
    const m = smartMatch(p.table, fields, { headerRow: 0, remembered: rememberedLayout(kind, p.table[0]) });
    setPrep(p);
    setCols(m.columns);
    setState(m.columns.map((c) => ({ field: c.field ?? '', level: c.level, how: c.how, why: c.why })));
    setPreview(null);
    setSkip([]);
    setFixing(null);
    setAiNote(null);
    setStep('map');
  }

  async function readFile(f: File | undefined) {
    if (!f) return;
    setError(null);
    if (f.size > MAX_FILE) return setError(errOf('The file is too big. Keep only the sheet you need, up to 500 rows.'));
    setBusy('Reading the file on this device…');
    try {
      const all = (await sheetsOf(f)).map((s) => ({ ...s, rows: cleanGrid(s.rows) }));
      const usable = all.filter((s) => s.rows.length >= 2);
      if (!usable.length) throw new Error('No list with rows was found in this file.');
      const best = pickSheet(all, fields);
      setSheets(all);
      setSheet(best);
      setFileName(f.name);
      matchSheet(all[best].rows);
    } catch (e) {
      setError(errOf(e));
    } finally {
      setBusy(null);
    }
  }

  const mapping = state.map((s) => s.field);
  const used = new Set(mapping.filter(Boolean));
  const missing = fields.filter((f) => f.required && !used.has(f.key));
  const toCheck = state.filter((s) => s.field && s.level === 'check').length;

  function choose(col: number, field: string) {
    setState((cur) =>
      cur.map((s, i) => {
        // One column per field: choosing a field for this column frees it from any other.
        if (i === col) return { field, level: field ? 'sure' : null, how: field ? 'manual' : null, why: field ? 'You chose this.' : '' };
        if (field && s.field === field) return { field: '', level: null, how: null, why: '' };
        return s;
      }),
    );
  }
  /** The field side: put this field on that column (or on none). */
  function chooseForField(field: string, col: number | null) {
    setState((cur) =>
      cur.map((s, i) => {
        if (i === col) return { field, level: 'sure', how: 'manual', why: 'You chose this.' };
        if (s.field === field) return { field: '', level: null, how: null, why: '' };
        return s;
      }),
    );
  }

  async function askAi() {
    if (!prep || !cols) return;
    const free = cols.filter((c, i) => !state[i].field && c.profile.fill > 0).map((c) => ({ index: c.index, header: c.header, shapes: c.profile.sample.map(valueShape) }));
    if (!free.length) return;
    setBusy('Asking Arisha AI about the column names and value shapes (no values are sent)…');
    setError(null);
    try {
      const r = await api.org.importAiColumns(kind, free);
      const taken = new Set(mapping.filter(Boolean));
      let n = 0;
      setState((cur) =>
        cur.map((s, i) => {
          const hit = r.matches.find((m) => m.index === i);
          if (!hit || s.field || taken.has(hit.field)) return s;
          taken.add(hit.field);
          n++;
          return { field: hit.field, level: 'check', how: 'ai', why: 'Suggested by Arisha AI from the column name and value shapes only. Check it.' };
        }),
      );
      setAiNote(n ? `${n} suggestion${n === 1 ? '' : 's'} from Arisha AI, marked "Check this".` : 'Arisha AI had no sure suggestion. Choose the columns yourself.');
    } catch (e) {
      setError(errOf(e));
    } finally {
      setBusy(null);
    }
  }

  async function check(over: { skip?: number[]; grid?: string[][] } = {}) {
    if (!prep || !cols) return;
    const g = over.grid ?? grid ?? normaliseTable(prep.table, 0, cols.map((c, i) => ({ index: c.index, field: state[i].field || null, profile: c.profile })), fields);
    const body = toCsv(g);
    if (body.length > MAX_CSV) return setError(errOf('The sheet is too big for one import. Split it into files of up to 500 rows.'));
    const s = over.skip ?? skip;
    setBusy(`Checking ${Math.max(0, g.length - 1)} row${g.length === 2 ? '' : 's'} against the form's own rules…`);
    setError(null);
    try {
      const p = await api.org.importPreview(kind, cid, body, { mapping, headerRow: 0, skip: s });
      setGrid(g);
      setPreview(p);
      setStep('check');
    } catch (e) {
      setError(errOf(e));
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    if (!preview || !grid || !prep) return;
    setBusy(`Importing ${preview.okRows} row${preview.okRows === 1 ? '' : 's'}. All of them are saved, or none…`);
    setError(null);
    try {
      const r = await api.org.importCommit(kind, cid, toCsv(grid), preview.fingerprint, { mapping, headerRow: 0, skip });
      rememberLayout(kind, prep.table[0], mapping);
      setReceipt(r);
      onImported?.(r, preview.rows.filter((x) => x.skipped || !x.ok).map((x) => ({ row: x.row, reasons: x.problems.length ? x.problems : ['Left out by the person loading.'] })));
      setStep('done');
    } catch (e) {
      setError(errOf(e));
    } finally {
      setBusy(null);
    }
  }

  const close = () => {
    if (receipt) bump();
    onClose();
  };

  const stepState = (s: Step): StepState => {
    const at = STEP_ORDER.indexOf(step);
    const i = STEP_ORDER.indexOf(s);
    return i < at ? 'done' : i === at ? 'now' : 'todo';
  };

  const needCompany = !!tpl?.companyScoped && !given;
  const ready = tpl && choices !== null && (!needCompany || !!companyId);
  const unmatched = cols ? cols.filter((c, i) => !state[i]?.field && c.profile.fill > 0).length : 0;

  return (
    <Drawer title={tpl ? `Import: ${tpl.label.toLowerCase()} records` : 'Import'} sub={tpl ? `Kept by: ${tpl.keptBy}` : undefined} onClose={close}>
      <Steps
        steps={[
          { label: 'Upload', state: stepState('file') },
          { label: 'Check columns', state: stepState('map') },
          { label: 'Check rows', state: stepState('check') },
          { label: 'Done', state: stepState('done') },
        ]}
      />
      {!tpl && !error && <Loading what="the import" />}
      {busy && (
        <div className="imp-busy" role="status" aria-live="polite">
          <span className="imp-bar" aria-hidden="true" />
          <span>{busy}</span>
        </div>
      )}
      <ErrorNotice error={error} />

      {tpl && step === 'file' && (
        <div className="imp-step">
          <p className="muted small">
            Use the file you already have: Excel, CSV, a table in Word, or a list saved as PDF. Any column order, English or Malay column names, a
            title above the table is fine. Prima reads it on this device and matches the columns; you check them, then every row is checked exactly as
            the Add form checks it. Nothing is saved until you press Import.
          </p>
          {tpl.note && <p className="muted small">{tpl.note}</p>}
          {needCompany && choices && (
            <label className="field">
              <span className="label">Which company are these records for?</span>
              <Select className="select" aria-label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                <option value="">Choose…</option>
                {choices.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
                {choices.length > 1 && <option value={SEVERAL}>Several: the file has a Company column</option>}
              </Select>
            </label>
          )}
          {needCompany && choices?.length === 0 && <p className="notice" data-tone="warn">You do not keep this record for any company.</p>}
          <label
            className={`imp-drop${ready ? '' : ' imp-drop-off'}${dragging ? ' imp-drop-on' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              if (ready && !busy) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (ready && !busy) void readFile(e.dataTransfer.files?.[0]);
            }}
          >
            <FileArrowUpIcon size={30} aria-hidden="true" />
            <strong>{fileName || 'Drop the file here, or choose it'}</strong>
            <span className="muted small">Excel (.xlsx), CSV, Word (.docx) or PDF, up to 500 rows</span>
            <input
              type="file"
              accept={ACCEPT}
              disabled={!ready || !!busy}
              aria-label="File to import"
              onChange={(e) => {
                void readFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          <TemplateLink tpl={tpl} />
        </div>
      )}

      {tpl && step === 'map' && prep && cols && (
        <div className="imp-step">
          {sheets && sheets.length > 1 && (
            <label className="field">
              <span className="label">Sheet</span>
              <select
                className="select"
                value={sheet}
                onChange={(e) => {
                  const i = Number(e.target.value);
                  setSheet(i);
                  matchSheet(sheets[i].rows);
                }}
              >
                {sheets.map((s, i) => (
                  <option key={i} value={i}>
                    {s.name} ({Math.max(0, s.rows.length - 1)} rows)
                  </option>
                ))}
              </select>
            </label>
          )}
          <details className="imp-more">
            <summary>The column names are not on the right row?</summary>
            <label className="field">
              <span className="label">The column names are on</span>
              <select className="select" defaultValue="" onChange={(e) => e.target.value !== '' && matchSheet(sheets?.[sheet]?.rows ?? [], Number(e.target.value))}>
                <option value="">Found by Prima</option>
                {(sheets?.[sheet]?.rows ?? []).slice(0, 15).map((r, i) => (
                  <option key={i} value={i}>
                    Row {i + 1}: {r.filter((c) => c.trim()).slice(0, 4).join(' · ').slice(0, 70)}
                  </option>
                ))}
              </select>
            </label>
          </details>
          <div className="imp-tally">
            <span data-tone="ok">
              <strong>{state.filter((s) => s.field).length}</strong> columns matched
            </span>
            <span data-tone={toCheck ? 'crit' : 'ok'}>
              <strong>{toCheck}</strong> to check
            </span>
            <span data-tone="neutral">
              <strong>{Math.max(0, prep.table.length - 1)}</strong> rows
            </span>
          </div>
          {(prep.droppedRows.length > 0 || prep.splits.length > 0) && (
            <p className="muted small">
              {prep.droppedRows.length > 0 && `Left out as totals, signatures or repeated headings: row${prep.droppedRows.length === 1 ? '' : 's'} ${prep.droppedRows.join(', ')}. `}
              {prep.splits.map(([a, b]) => `"${a}" had a second value in brackets, now its own column "${b}". `).join('')}
            </p>
          )}
          {missing.length > 0 && (
            <p className="notice" data-tone="crit">
              Not found in the file: {missing.map((f) => f.label).join(', ')}. Choose the column for each below; these are needed.
            </p>
          )}
          {aiOn && unmatched > 0 && (
            <div className="imp-ai">
              <span className="muted small">
                {unmatched} column{unmatched === 1 ? '' : 's'} not matched. Arisha AI can suggest from the column names and the shape of the values (for example
                &quot;AA9999999&quot;), never the values themselves.
              </span>
              <button className="btn btn-sm" disabled={!!busy} onClick={() => void askAi()}>
                <SparkleIcon size={16} aria-hidden="true" />
                Ask Arisha AI
              </button>
            </div>
          )}
          {aiNote && <p className="muted small">{aiNote}</p>}
          <ul className="imp-map" aria-label="Fields and the columns matched to them">
            {fields.map((f) => {
              const col = state.findIndex((s) => s.field === f.key);
              const c = col >= 0 ? cols[col] : null;
              const st = col >= 0 ? state[col] : null;
              const lv = st?.level ? LEVEL[st.level] : null;
              return (
                <li key={f.key} className="imp-map-row" data-state={!c ? (f.required ? 'missing' : 'none') : st?.level === 'check' ? 'check' : 'ok'}>
                  <div className="imp-map-field">
                    <strong>{fieldLabel(f.key)}</strong>
                    {f.required && <span className="imp-need">Needed</span>}
                  </div>
                  <ColumnPicker
                    columns={cols}
                    value={col >= 0 ? col : null}
                    usedBy={(i) => (state[i]?.field && state[i].field !== f.key ? fieldLabel(state[i].field) : null)}
                    onChange={(i) => chooseForField(f.key, i)}
                    label={`Column for ${f.label}`}
                  />
                  <div className="imp-map-meta">
                    {lv && (
                      <Chip tone={lv[1]} title={st?.why}>
                        {lv[0]}
                        {cols && c && st?.how !== 'manual' && st?.how !== 'remembered' ? ` ${Math.round((c.confidence || 0) * 100)}%` : ''}
                      </Chip>
                    )}
                    {st?.how === 'remembered' && <Chip tone="neutral">Remembered</Chip>}
                    {st?.how === 'ai' && <Chip tone="info">AI</Chip>}
                    {c && c.profile.sample.length > 0 && <span className="imp-col-sample">{c.profile.sample.join(' · ').slice(0, 90)}</span>}
                    {st?.why && st.how !== 'manual' && <span className="imp-why">{st.why}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
          {cols.some((c, i) => !state[i].field && c.header) && (
            <p className="muted small">
              Not used:{' '}
              {cols
                .filter((c, i) => !state[i].field && c.header)
                .map((c) => c.header)
                .join(', ')}
              .
            </p>
          )}
          <div className="imp-actions imp-sticky">
            <button className="btn" disabled={!!busy} onClick={() => setStep('file')}>
              Back
            </button>
            <button className="btn btn-primary" disabled={!!busy || missing.length > 0} onClick={() => void check({ skip: [] })}>
              Check the rows
            </button>
          </div>
        </div>
      )}

      {tpl && step === 'check' && preview && grid && (
        <CheckStep
          preview={preview}
          grid={grid}
          busy={!!busy}
          fixing={fixing}
          setFixing={setFixing}
          label={fieldLabel}
          onSkip={(row, on) => {
            const s = on ? [...skip, row] : skip.filter((x) => x !== row);
            setSkip(s);
            setFixing(null);
            void check({ skip: s });
          }}
          onFix={(row, cells) => {
            const g = grid.map((r) => [...r]);
            const r = g[row - 1];
            for (const [col, v] of Object.entries(cells)) {
              while (r.length <= Number(col)) r.push('');
              r[Number(col)] = v;
            }
            setFixing(null);
            void check({ grid: g });
          }}
          onBack={() => {
            setGrid(null);
            setStep('map');
          }}
          onImport={() => void commit()}
        />
      )}

      {step === 'done' && receipt && (
        <div className="imp-step imp-done">
          <CheckCircleIcon size={40} weight="fill" aria-hidden="true" />
          <h3>
            {receipt.rows} {tpl?.label.toLowerCase()} record{receipt.rows === 1 ? '' : 's'} imported
          </h3>
          <p className="muted small">
            From {fileName}, by {receipt.by}, {dateTimeLabel(receipt.at)}.
            {receipt.skippedRows?.length ? ` Rows skipped: ${receipt.skippedRows.join(', ')}.` : ''} Every row went through the Add form&apos;s own
            checks and is in the audit log. The receipt ({receipt.id}) stops the same file being imported twice. Next time a file with these column names
            is matched the same way on this device.
          </p>
          <div className="imp-actions">
            <button className="btn btn-primary" onClick={close}>
              Close
            </button>
          </div>
        </div>
      )}
    </Drawer>
  );
}

/** A column chooser with a search box: the column name and its first values, for a phone as for a PC. */
function ColumnPicker({
  columns,
  value,
  usedBy,
  onChange,
  label,
}: {
  columns: SmartColumn[];
  value: number | null;
  usedBy: (i: number) => string | null;
  onChange: (i: number | null) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    // Escape closes the list only (not the whole drawer).
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('mousedown', off);
    box.current?.addEventListener('keydown', esc);
    const el = box.current;
    return () => {
      document.removeEventListener('mousedown', off);
      el?.removeEventListener('keydown', esc);
    };
  }, [open]);
  const name = (c: SmartColumn) => c.header || `Column ${c.index + 1}`;
  const shown = columns.filter((c) => !q.trim() || `${name(c)} ${c.profile.sample.join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="imp-pick" ref={box}>
      <button type="button" className="imp-pick-btn" aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)}>
        {value === null ? <span className="muted">Not in the file</span> : <span>{name(columns[value])}</span>}
      </button>
      {open && (
        <div className="imp-pick-pop">
          <div className="imp-pick-search">
            <MagnifyingGlassIcon size={16} aria-hidden="true" />
            <input className="input" autoFocus value={q} placeholder="Search the columns" aria-label="Search the columns" onChange={(e) => setQ(e.target.value)} />
          </div>
          <ul role="listbox" aria-label={label}>
            <li>
              <button
                type="button"
                role="option"
                aria-selected={value === null}
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                <span className="muted">Not in the file</span>
              </button>
            </li>
            {shown.map((c) => (
              <li key={c.index}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === c.index}
                  onClick={() => {
                    onChange(c.index);
                    setOpen(false);
                    setQ('');
                  }}
                >
                  <strong>{name(c)}</strong>
                  {c.profile.sample.length > 0 && <span className="imp-col-sample">{c.profile.sample.join(' · ').slice(0, 70)}</span>}
                  {usedBy(c.index) && <span className="imp-why">Now used for {usedBy(c.index)}</span>}
                </button>
              </li>
            ))}
            {!shown.length && <li className="muted small imp-pick-none">No column has that.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function TemplateLink({ tpl }: { tpl: OrgImportTemplate }) {
  const download = () => {
    const blob = new Blob(['﻿' + toCsv([tpl.columns.map((c) => c.label)])], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${tpl.label} template.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const needed = tpl.columns.filter((c) => c.required).map((c) => c.label);
  return (
    <div className="imp-template">
      <span className="muted small">
        Starting from nothing? The template has every column. Needed: {needed.join(', ') || 'none'}.
        {tpl.companyScoped ? ' Add a "Company" column to load several companies at once.' : ''}
      </span>
      <button className="btn btn-sm btn-ghost" onClick={download}>
        <DownloadSimpleIcon size={16} aria-hidden="true" />
        Template
      </button>
    </div>
  );
}

function CheckStep({
  preview,
  grid,
  busy,
  fixing,
  setFixing,
  label,
  onSkip,
  onFix,
  onBack,
  onImport,
}: {
  preview: OrgImportPreview;
  grid: string[][];
  busy: boolean;
  fixing: number | null;
  setFixing: (row: number | null) => void;
  label: (key: string) => string;
  onSkip: (row: number, on: boolean) => void;
  onFix: (row: number, cells: Record<number, string>) => void;
  onBack: () => void;
  onImport: () => void;
}) {
  const bad = preview.rows.filter((r) => !r.ok && !r.skipped);
  const skipped = preview.rows.filter((r) => r.skipped);
  const good = preview.rows.filter((r) => r.ok);
  const used = preview.columns.filter((c) => c.field);
  return (
    <div className="imp-step">
      <div className="imp-tally">
        <span data-tone="ok">
          <strong>{preview.okRows}</strong> ready
        </span>
        <span data-tone={preview.badRows ? 'crit' : 'ok'}>
          <strong>{preview.badRows}</strong> to fix
        </span>
        <span data-tone="neutral">
          <strong>{preview.skippedRows}</strong> skipped
        </span>
      </div>
      {preview.alreadyImported && (
        <p className="notice" data-tone="warn">
          This file was already imported by {preview.alreadyImported.by} on {dateTimeLabel(preview.alreadyImported.at)}.
        </p>
      )}
      {preview.missingColumns.length > 0 && (
        <p className="notice" data-tone="crit">
          Columns needed: {preview.missingColumns.join(', ')}. Go back and match them.
        </p>
      )}
      {bad.length > 0 && (
        <section>
          <h3 className="imp-h">Rows to fix or skip</h3>
          <ul className="imp-rows">
            {bad.slice(0, 100).map((r) => (
              <li key={r.row} className="imp-row" data-tone="crit">
                <div className="imp-row-head">
                  <strong>Row {r.row}</strong>
                  {r.company && <Chip tone={r.company.guess ? 'warn' : 'neutral'}>{r.company.name}</Chip>}
                  <span className="imp-row-btns">
                    <button className="btn btn-sm" disabled={busy} onClick={() => setFixing(fixing === r.row ? null : r.row)}>
                      {fixing === r.row ? 'Cancel' : 'Fix'}
                    </button>
                    <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => onSkip(r.row, true)}>
                      Skip
                    </button>
                  </span>
                </div>
                <ul className="imp-problems">
                  {r.problems.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
                {fixing === r.row && (
                  <RowFix
                    cells={grid[r.row - 1] ?? []}
                    columns={used.map((c) => ({ index: c.index, label: c.field === COMPANY_FIELD ? 'Company' : label(c.field!) }))}
                    busy={busy}
                    onSave={(cells) => onFix(r.row, cells)}
                  />
                )}
              </li>
            ))}
          </ul>
          {bad.length > 100 && <p className="muted small">And {bad.length - 100} more. Fix the file and choose it again for that many.</p>}
          {bad.length > 1 && (
            <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => bad.forEach((r) => onSkip(r.row, true))}>
              Skip all {bad.length} rows to fix
            </button>
          )}
        </section>
      )}
      {skipped.length > 0 && (
        <section>
          <h3 className="imp-h">Skipped</h3>
          <ul className="imp-chips">
            {skipped.map((r) => (
              <li key={r.row}>
                <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => onSkip(r.row, false)} title="Include this row again">
                  Row {r.row} · include again
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {good.length > 0 && (
        <section>
          <h3 className="imp-h">Ready ({good.length})</h3>
          <ul className="imp-rows">
            {good.slice(0, 8).map((r) => (
              <li key={r.row} className="imp-row" data-tone="ok">
                <div className="imp-row-head">
                  <strong>Row {r.row}</strong>
                  {r.company && <Chip tone={r.company.guess ? 'warn' : 'neutral'}>{r.company.name}</Chip>}
                </div>
                <span className="imp-row-values">
                  {Object.entries(r.values)
                    .slice(0, 4)
                    .map(([k, v]) => `${label(k)}: ${v}`)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
          {good.length > 8 && <p className="muted small">And {good.length - 8} more ready.</p>}
        </section>
      )}
      <div className="imp-actions imp-sticky">
        <button className="btn" disabled={busy} onClick={onBack}>
          Back to columns
        </button>
        <button className="btn btn-primary" disabled={busy || !preview.canImport} onClick={onImport}>
          Import {preview.okRows} row{preview.okRows === 1 ? '' : 's'}
        </button>
      </div>
      {!preview.canImport && !preview.alreadyImported && preview.okRows > 0 && (
        <p className="muted small">Fix or skip every row above first. The import saves all the chosen rows or none.</p>
      )}
    </div>
  );
}

function RowFix({
  cells,
  columns,
  busy,
  onSave,
}: {
  cells: string[];
  columns: { index: number; label: string }[];
  busy: boolean;
  onSave: (cells: Record<number, string>) => void;
}) {
  const [v, setV] = useState<Record<number, string>>(() => Object.fromEntries(columns.map((c) => [c.index, cells[c.index] ?? ''])));
  return (
    <div className="imp-fix">
      {columns.map((c) => (
        <label key={c.index} className="field">
          <span className="label">{c.label}</span>
          <input className="input" value={v[c.index] ?? ''} onChange={(e) => setV({ ...v, [c.index]: e.target.value })} />
        </label>
      ))}
      <div>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onSave(v)}>
          Save and check again
        </button>
      </div>
    </div>
  );
}

/**
 * P90: "Add" for records whose screen had no add form (FWM foreign workers): the record's own fields (from its import
 * template), with lists for the choices the page knows (branches), saved through the page's own create call.
 */
export function QuickAddButton({
  kind,
  label,
  options,
  fixed,
  save,
}: {
  kind: ImportKind;
  label: string;
  /** Choices for a field, by key ([value, label]); e.g. branches. */
  options?: Record<string, [string, string][]>;
  /** Values the page sets itself (e.g. the company of the chosen branch). */
  fixed?: (values: Record<string, string>) => Record<string, string>;
  save: (values: Record<string, string | null>) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-sm btn-primary" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && <QuickAddDrawer kind={kind} title={label} options={options} fixed={fixed} save={save} onClose={() => setOpen(false)} />}
    </>
  );
}

export function QuickAddDrawer({
  kind,
  title,
  options,
  fixed,
  save,
  onClose,
}: {
  kind: ImportKind;
  title: string;
  options?: Record<string, [string, string][]>;
  fixed?: (values: Record<string, string>) => Record<string, string>;
  save: (values: Record<string, string | null>) => Promise<unknown>;
  onClose: () => void;
}) {
  const { bump } = useContext(RefreshContext);
  const [tpl, setTpl] = useState<OrgImportTemplate | null>(null);
  const [v, setV] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Err>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    api.org.importTemplate(kind).then(setTpl, (e) => setError(errOf(e)));
  }, [kind]);
  const submit = async () => {
    if (!tpl) return;
    setBusy(true);
    setError(null);
    try {
      const out: Record<string, string | null> = {};
      for (const c of tpl.columns) out[c.key] = (v[c.key] ?? '').trim() || null;
      await save({ ...out, ...(fixed ? fixed(v) : {}) });
      setDone(true);
      bump();
    } catch (e) {
      setError(errOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer title={title} sub={tpl ? `Kept by: ${tpl.keptBy}` : undefined} onClose={onClose}>
      {!tpl && !error && <Loading what="the form" />}
      <ErrorNotice error={error} />
      {done ? (
        <div className="imp-step imp-done">
          <CheckCircleIcon size={40} weight="fill" aria-hidden="true" />
          <h3>Saved</h3>
          <p className="muted small">The record is in Prima and in the audit log.</p>
          <div className="imp-actions">
            <button
              className="btn"
              onClick={() => {
                setV({});
                setDone(false);
              }}
            >
              Add another
            </button>
            <button className="btn btn-primary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      ) : (
        tpl && (
          <form
            className="imp-step"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {tpl.note && <p className="muted small">{tpl.note}</p>}
            {tpl.columns.map((c) => {
              const list = options?.[c.key] ?? (c.type === 'select' ? (c.choices ?? []).map((l): [string, string] => [l, l]) : null);
              return (
                <label key={c.key} className="field">
                  <span className="label">
                    {c.label}
                    {c.required ? '' : ' (if known)'}
                  </span>
                  {list ? (
                    <Select className="select" required={c.required} value={v[c.key] ?? ''} onChange={(e) => setV({ ...v, [c.key]: e.target.value })}>
                      <option value="">Choose…</option>
                      {list.map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <input
                      className="input"
                      type={c.type === 'date' ? 'date' : c.type === 'number' ? 'number' : 'text'}
                      required={c.required}
                      value={v[c.key] ?? ''}
                      onChange={(e) => setV({ ...v, [c.key]: e.target.value })}
                    />
                  )}
                  {c.help && <span className="muted small">{c.help}</span>}
                </label>
              );
            })}
            <div className="imp-actions imp-sticky">
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                Save
              </button>
            </div>
          </form>
        )
      )}
    </Drawer>
  );
}
