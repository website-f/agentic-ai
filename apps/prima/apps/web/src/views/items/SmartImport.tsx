// P98 (Fitri, 11 Nov 2026: "where is ... Import to import the whole file (Excel, CSV, PDF)? Whatever the format, the
// algorithm must be advanced enough to check all the columns and put them in, with all the records there"): one import
// for every item list and stock report, in four steps.
//  1. Files: one or several at once (the item list, the stock balance and the stock card together). Excel, CSV, Word
//     and older Excel saved as web pages are read on this device; a PDF is read by the server from where each piece of
//     text sits on the page (item-report.ts).
//  2. Columns: each file's columns as Prima read them, with the field each holds; any can be changed.
//  3. Items: the files merged into one list by item code; new or an update of an item already in Prima; the category
//     and tracking of each stock group; every item checked by the server exactly as the import will save it.
//  4. Import: in batches (a 700-item list or a 160-page stock card never times out), a summary at the end, and the QR
//     labels of the items to print.
// Nothing is saved before step 4, and only through the Items screen's own actions with their checks.
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircleIcon, DownloadSimpleIcon, FileArrowUpIcon, PrinterIcon, TrashIcon, WarningIcon, XIcon } from '@phosphor-icons/react';
import {
  ITEM_CATEGORIES,
  ITEM_LIST_COLUMNS,
  ITEM_REPORT_FIELDS,
  ITEM_REPORT_LAYOUT_LABEL,
  extractPdfTable,
  itemCategoryGuess,
  itemListRow,
  itemsFromTable,
  mergeItemFiles,
  parseCsv,
  primaCodeOf,
  readDocxTables,
  readXlsx,
  reportFromGrid,
  toCsv,
  type ItemCategory,
  type ItemListOutcome,
  type ItemReportField,
  type ItemsRead,
  type MergedItem,
  type ReportTable,
} from '@prima/core';
import { api, type ItemBoard } from '../../api';
import { Select } from '../../SearchSelect';
import { useBackClose } from '../../back-close';
import { Steps } from '../../kit';
import { Chip, ErrorNotice, RefreshContext } from '../../ui';
import { CAT_LABEL, downloadText, partyName } from './shared';
import { TypeLabelPrint } from './TypeLabels';

const ACCEPT = '.xlsx,.xlsm,.xls,.csv,.tsv,.txt,.docx,.pdf,text/csv,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_FILE = 12_000_000;
/** Items checked and imported per request: small enough never to time out, large enough to be quick. */
export const IMPORT_BATCH = 100;

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function inflatePdf(b: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** An older Excel file: often a web page or an XML sheet saved with .xls; a true binary .xls must be saved again. */
function readXlsLike(bytes: Uint8Array): string[][] {
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new Error('This is an old binary Excel file (.xls). Open it in Excel and save it as .xlsx (Excel Workbook), or as CSV, then choose it again.');
  const text = new TextDecoder().decode(bytes);
  if (/<table|<Workbook/i.test(text)) {
    const doc = new DOMParser().parseFromString(text, /<Workbook/i.test(text) ? 'application/xml' : 'text/html');
    const rows = [...doc.getElementsByTagName('tr'), ...doc.getElementsByTagName('Row')];
    return rows.map((r) => [...r.children].filter((c) => /^(td|th|cell)$/i.test(c.localName)).map((c) => (c.textContent ?? '').trim()));
  }
  return text.split(/\r?\n/).map((l) => l.split('\t'));
}

/** Any supported file to a table of the report it holds. */
export async function readItemFile(f: File): Promise<ReportTable> {
  const name = f.name.toLowerCase();
  if (f.size > MAX_FILE) throw new Error('The file is larger than 12 MB. Split it, or export the report in parts.');
  if (name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.tsv') || f.type === 'text/csv') {
    const text = await f.text();
    const tabs = name.endsWith('.tsv') || (text.split('\n', 3).join('').includes('\t') && !text.split('\n', 1)[0].includes(','));
    return reportFromGrid(tabs ? text.split(/\r?\n/).map((l) => l.split('\t')) : parseCsv(text));
  }
  const bytes = new Uint8Array(await f.arrayBuffer());
  if (name.endsWith('.pdf') || f.type === 'application/pdf') {
    try {
      return await api.itemImportRead(base64(bytes));
    } catch (e) {
      // The demo (and a server without the reader) reads the PDF here instead, by its text positions only.
      if (!(e instanceof Error) || !/PDF_READ_LOCAL|not found|404/i.test(e.message)) throw e;
      const rows = await extractPdfTable(bytes, inflatePdf);
      if (rows.filter((r) => r.length >= 2).length < 2) throw new Error('No table could be read from this PDF. A scanned paper is a picture: ask for the report as Excel.');
      return reportFromGrid(rows);
    }
  }
  if (name.endsWith('.xls')) return reportFromGrid(readXlsLike(bytes));
  if (name.endsWith('.docx')) {
    const sheets = await readDocxTables(bytes, inflateRaw);
    return best(sheets.map((s) => reportFromGrid(s.rows)));
  }
  if (name.endsWith('.doc')) throw new Error('This is an old Word file (.doc). Open it in Word and save it as .docx or PDF, then choose it again.');
  const sheets = await readXlsx(bytes, inflateRaw);
  return best(sheets.map((s) => reportFromGrid(s.rows)));
}
/** The sheet or table with the most item rows. */
const best = (ts: ReportTable[]) => ts.reduce((a, b) => (itemsFromTable(b, b.preset).items.length > itemsFromTable(a, a.preset).items.length ? b : a), ts[0]);

interface FileState {
  id: string;
  name: string;
  size: number;
  status: 'reading' | 'ready' | 'error';
  error?: string;
  table?: ReportTable;
  fields: (ItemReportField | null)[];
  read?: ItemsRead;
}

type Status = 'new' | 'update' | 'same' | 'problem';
interface Plan {
  item: MergedItem;
  key: string;
  include: boolean;
  status: Status;
  outcome?: ItemListOutcome;
  problems: string[];
}
type GroupChoice = { category: ItemCategory | 'auto'; tracking: 'BULK' | 'SERIALIZED' };

const fieldOptions: [string, string][] = [['', 'Not used'], ...ITEM_REPORT_FIELDS.map((f): [string, string] => [f.key, f.label])];
const keyOf = (m: MergedItem) => (m.code || m.name).toUpperCase().replace(/\s+/g, ' ').trim();

/** The company named in a report's title block, among the companies this person may add stock for. */
function partyFromReport(data: ItemBoard, parties: string[], company: string | null): string | null {
  if (!company) return null;
  const words = (s: string) => s.toUpperCase().replace(/\b(SDN|BHD|BERHAD|PLT|ENTERPRISE)\b|[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  const want = words(company);
  const hit = parties.filter((p) => {
    const have = words(partyName(data, p));
    return have.length > 0 && have.every((w) => want.includes(w));
  });
  return hit.length === 1 ? hit[0] : null;
}

export function SmartImport({ data, onClose }: { data: ItemBoard; onClose: () => void }) {
  const { bump } = useContext(RefreshContext);
  const parties = data.addRights?.parties ?? [];
  const [files, setFiles] = useState<FileState[]>([]);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [party, setParty] = useState<string>('');
  const [groups, setGroups] = useState<Record<string, GroupChoice>>({});
  const [off, setOff] = useState<Set<string>>(new Set());
  const [server, setServer] = useState<Map<string, { outcome?: ItemListOutcome; problems: string[] }>>(new Map());
  const [run, setRun] = useState<{ phase: 'check' | 'import'; done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ outcomes: ItemListOutcome[]; failed: { key: string; problems: string[] }[]; already: number } | null>(null);
  const [labels, setLabels] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useBackClose(true, onClose);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !run && onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose, run]);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const fresh: FileState[] = [...list].map((f, k) => ({ id: `${Date.now()}-${k}-${f.name}`, name: f.name, size: f.size, status: 'reading', fields: [] }));
    setFiles((cur) => [...cur, ...fresh]);
    setServer(new Map());
    [...list].forEach((f, k) => {
      const id = fresh[k].id;
      readItemFile(f).then(
        (table) => {
          const read = itemsFromTable(table, table.preset);
          setFiles((cur) => cur.map((x) => (x.id === id ? { ...x, status: 'ready', table, fields: [...table.preset], read } : x)));
          setParty((p) => p || partyFromReport(data, parties, table.company) || '');
        },
        (e: unknown) => setFiles((cur) => cur.map((x) => (x.id === id ? { ...x, status: 'error', error: e instanceof Error ? e.message : String(e) } : x))),
      );
    });
  };
  const setField = (id: string, col: number, f: ItemReportField | null) => {
    setServer(new Map());
    setFiles((cur) =>
      cur.map((x) => {
        if (x.id !== id || !x.table) return x;
        const fields = x.fields.map((v, i) => (i === col ? f : v === f && f ? null : v));
        return { ...x, fields, read: itemsFromTable(x.table, fields) };
      }),
    );
  };

  const ready = files.filter((f) => f.status === 'ready' && f.read);
  const merged = useMemo(() => mergeItemFiles(ready.map((f) => ({ file: f.name, layout: f.table!.layout, asOf: f.table!.asOf, items: f.read!.items }))), [ready.map((f) => `${f.id}:${f.fields.join(',')}`).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stock groups with Prima's category guessed from the names in each.
  const groupList = useMemo(() => {
    const m = new Map<string, { n: number; guess: Map<ItemCategory, number> }>();
    for (const it of merged) {
      const g = it.group ?? '(no group)';
      const e = m.get(g) ?? { n: 0, guess: new Map() };
      e.n++;
      const c = itemCategoryGuess(it.name, it.group);
      e.guess.set(c, (e.guess.get(c) ?? 0) + 1);
      m.set(g, e);
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [merged]);
  const choiceOf = (g: string | null): GroupChoice => groups[g ?? '(no group)'] ?? { category: 'auto', tracking: 'BULK' };
  const categoryOf = (m: MergedItem): ItemCategory => {
    const c = choiceOf(m.group).category;
    return c === 'auto' ? itemCategoryGuess(m.name, m.group) : c;
  };

  // New or update, against what this person sees in the catalogue; the server's check replaces it.
  const plans: Plan[] = useMemo(() => {
    const bySource = new Map(data.skus.filter((s) => s.sourceCode).map((s) => [String(s.sourceCode).toUpperCase(), s]));
    const byCode = new Map(data.skus.filter((s) => !s.sourceCode).map((s) => [s.code, s]));
    return merged.map((item) => {
      const key = keyOf(item);
      const s = server.get(key);
      const known = bySource.get(item.code.toUpperCase().replace(/\s+/g, ' ').trim()) ?? byCode.get(primaCodeOf(item.code, item.name));
      const status: Status = s?.problems.length ? 'problem' : s?.outcome ? (s.outcome.action === 'create' ? 'new' : s.outcome.action) : known ? 'update' : 'new';
      return { item, key, include: !off.has(key), status, outcome: s?.outcome, problems: s?.problems ?? [] };
    });
  }, [merged, server, off, data.skus]);

  const rowsFor = (ps: Plan[]) => ps.map((p) => itemListRow(p.item, categoryOf(p.item), choiceOf(p.item.group).tracking));
  const batches = (ps: Plan[]) => {
    const out: Plan[][] = [];
    for (let i = 0; i < ps.length; i += IMPORT_BATCH) out.push(ps.slice(i, i + IMPORT_BATCH));
    return out;
  };
  const opts = { mapping: [...ITEM_LIST_COLUMNS] as string[], headerRow: 0 };
  const csvOf = (ps: Plan[]) => toCsv([[...ITEM_LIST_COLUMNS], ...rowsFor(ps)]);

  /** Step 3: every chosen item through the server's check (saved and rolled back), a batch at a time. */
  async function check() {
    setError(null);
    const chosen = plans.filter((p) => p.include);
    const out = new Map<string, { outcome?: ItemListOutcome; problems: string[] }>();
    setRun({ phase: 'check', done: 0, total: chosen.length });
    try {
      for (const b of batches(chosen)) {
        const p = await api.org.importPreview('itemList', party || null, csvOf(b), opts);
        p.rows.forEach((r, i) => out.set(b[i].key, { outcome: r.outcome, problems: r.problems }));
        setRun((x) => x && { ...x, done: Math.min(x.total, x.done + b.length) });
      }
      setServer(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRun(null);
    }
  }

  /** Step 4: the chosen items without problems, a batch at a time; each batch all or none, with its receipt. */
  async function importAll() {
    setError(null);
    const chosen = plans.filter((p) => p.include && !p.problems.length);
    const outcomes: ItemListOutcome[] = [];
    const failed: { key: string; problems: string[] }[] = [];
    let already = 0;
    setRun({ phase: 'import', done: 0, total: chosen.length });
    try {
      for (const b of batches(chosen)) {
        const csv = csvOf(b);
        const p = await api.org.importPreview('itemList', party || null, csv, opts);
        if (p.alreadyImported) {
          already += b.length;
        } else {
          const bad = p.rows.map((r, i) => (r.ok ? -1 : i)).filter((i) => i >= 0);
          for (const i of bad) failed.push({ key: b[i].key, problems: p.rows[i].problems });
          const skip = bad.map((i) => p.rows[i].row);
          const fp = bad.length ? (await api.org.importPreview('itemList', party || null, csv, { ...opts, skip })).fingerprint : p.fingerprint;
          if (bad.length < b.length) {
            const r = await api.org.importCommit('itemList', party || null, csv, fp, { ...opts, skip });
            outcomes.push(...((r as { outcomes?: ItemListOutcome[] }).outcomes ?? []));
          }
        }
        setRun((x) => x && { ...x, done: Math.min(x.total, x.done + b.length) });
      }
      setResult({ outcomes, failed, already });
      setStep(4);
      bump();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (outcomes.length) {
        setResult({ outcomes, failed, already });
        setStep(4);
        bump();
      }
    } finally {
      setRun(null);
    }
  }

  const counts = {
    all: plans.length,
    new: plans.filter((p) => p.status === 'new').length,
    update: plans.filter((p) => p.status === 'update').length,
    same: plans.filter((p) => p.status === 'same').length,
    problem: plans.filter((p) => p.status === 'problem').length,
    withQty: plans.filter((p) => p.item.qty !== null).length,
    warn: plans.filter((p) => p.item.warnings.length || p.outcome?.notes.length).length,
  };
  const checked = server.size > 0;
  const steps = [
    { label: 'Files', state: step > 1 ? 'done' : 'now' },
    { label: 'Columns', state: step > 2 ? 'done' : step === 2 ? 'now' : 'todo' },
    { label: 'Items', state: step > 3 ? 'done' : step === 3 ? 'now' : 'todo' },
    { label: 'Import', state: step === 4 ? 'done' : 'todo' },
  ] as const;

  return createPortal(
    <div className="smi-wrap" role="dialog" aria-modal="true" aria-label="Import items from files">
      <div className="smi-scrim" onClick={() => !run && onClose()} />
      <section className="smi">
        <header className="smi-head">
          <div>
            <h2>Import items from files</h2>
            <p className="muted small smi-sub">Item lists and stock reports from the old system: Excel, CSV, Word or PDF. Nothing is saved until you press Import.</p>
          </div>
          <button className="btn btn-ghost smi-x" type="button" onClick={onClose} disabled={!!run} aria-label="Close">
            <XIcon size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="smi-steps">
          <Steps steps={steps.map((s) => ({ label: s.label, state: s.state }))} />
        </div>
        <p className="smi-step-mini">
          Step <span>{step}</span> of 4: {steps[step - 1].label}
        </p>
        <div className="smi-body">
          {step === 1 && (
            <>
              <button type="button" className="smi-drop" onClick={() => input.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => (e.preventDefault(), addFiles(e.dataTransfer.files))}>
                <FileArrowUpIcon size={36} aria-hidden="true" />
                <strong>Choose files</strong>
                <span className="muted">Excel (.xlsx, .xls), CSV, Word (.docx) or PDF. Choose several at once: the item list, the stock balance and the stock card go together.</span>
              </button>
              <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ''))} />
              {files.length > 0 && (
                <ul className="smi-files">
                  {files.map((f) => (
                    <li key={f.id} data-status={f.status}>
                      <span className="smi-file-main">
                        <strong>{f.name}</strong>
                        {f.status === 'reading' && <span className="muted small">Reading…</span>}
                        {f.status === 'error' && <span className="smi-bad small">{f.error}</span>}
                        {f.status === 'ready' && f.table && f.read && (
                          <span className="muted small">
                            {ITEM_REPORT_LAYOUT_LABEL[f.table.layout]}
                            {f.table.asOf ? <> · as at {f.table.asOf}</> : null} · <span>{f.read.items.length}</span> items
                            {f.table.declaredTotal !== null && (
                              <>
                                {' '}
                                ·{' '}
                                {f.table.declaredTotal === f.read.items.length ? (
                                  <span className="smi-ok">the report's own total agrees</span>
                                ) : (
                                  <span className="smi-bad">
                                    the report says <span>{f.table.declaredTotal}</span>
                                  </span>
                                )}
                              </>
                            )}
                          </span>
                        )}
                      </span>
                      <button className="btn btn-ghost" type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((cur) => cur.filter((x) => x.id !== f.id))}>
                        <TrashIcon size={18} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <label className="isc-field smi-party">
                Opening stock goes to
                <Select className="input" value={party} onChange={(e) => setParty(e.target.value)}>
                  <option value="">Choose the company that holds this stock…</option>
                  {parties.map((p) => (
                    <option key={p} value={p}>
                      {partyName(data, p)}
                    </option>
                  ))}
                </Select>
                <span className="muted small">Quantities become this company's opening stock, only for items it has no stock of yet.</span>
              </label>
            </>
          )}

          {step === 2 &&
            ready.map((f) => (
              <details key={f.id} className="smi-cols" open>
                <summary>
                  <strong>{f.name}</strong>
                  <span className="muted small">
                    {ITEM_REPORT_LAYOUT_LABEL[f.table!.layout]} · <span>{f.read!.items.length}</span> items · <span>{f.table!.rows.length}</span> lines
                  </span>
                </summary>
                <p className="muted small">
                  Each column as Prima read it. Change the field where it is wrong; the items are read again at once. Lines printed on every page (title, company, page numbers, the header again) and totals are left out:{' '}
                  <span>{f.table!.dropped.repeated + f.table!.dropped.totals}</span>.
                </p>
                <div className="smi-colgrid">
                  {f.table!.header.map((h, i) => {
                    const sample = f.table!.rows.filter((r) => !r.kind || r.kind === 'data').map((r) => r.cells[i]).filter(Boolean).slice(0, 3);
                    return (
                      <div key={i} className="smi-col" data-used={!!f.fields[i] || undefined}>
                        <span className="smi-col-head">{h || `Column ${i + 1}`}</span>
                        <span className="muted small smi-col-sample">{sample.join(' · ') || '(empty)'}</span>
                        <Select className="input" aria-label={`Field for ${h || `column ${i + 1}`}`} value={f.fields[i] ?? ''} onChange={(e) => setField(f.id, i, (e.target.value || null) as ItemReportField | null)}>
                          {fieldOptions.map(([k, l]) => (
                            <option key={k} value={k}>
                              {l}
                            </option>
                          ))}
                        </Select>
                      </div>
                    );
                  })}
                </div>
                {f.read!.skipped.length > 0 && (
                  <p className="notice small" data-tone="warn">
                    <span>{f.read!.skipped.length}</span> lines not read: {f.read!.skipped.slice(0, 3).map((s) => s.reason).join(' ')}
                  </p>
                )}
              </details>
            ))}

          {step === 3 && (
            <ItemsStep
              data={data}
              plans={plans}
              counts={counts}
              checked={checked}
              groupList={groupList}
              choiceOf={choiceOf}
              categoryOf={categoryOf}
              setGroup={(g, c) => {
                setServer(new Map());
                setGroups((cur) => ({ ...cur, [g]: { ...choiceOf(g === '(no group)' ? null : g), ...c } }));
              }}
              toggle={(key, on) => setOff((cur) => {
                const n = new Set(cur);
                if (on) n.delete(key);
                else n.add(key);
                return n;
              })}
              setAll={(keys, on) => setOff((cur) => {
                const n = new Set(cur);
                for (const k of keys) if (on) n.delete(k);
                else n.add(k);
                return n;
              })}
            />
          )}

          {step === 4 && result && (
            <Summary data={data} result={result} party={party} onLabels={() => setLabels(true)} />
          )}

          {run && (
            <div className="smi-progress" role="status" aria-live="polite">
              <span>{run.phase === 'check' ? 'Checking items with the server…' : 'Importing…'}</span>
              <progress max={run.total} value={run.done} />
              <span className="muted small">
                <span>{run.done}</span> / <span>{run.total}</span>
              </span>
            </div>
          )}
          <ErrorNotice error={error} />
        </div>
        <footer className="smi-foot">
          {step === 1 && (
            <>
              <span className="muted small">{ready.length ? <><span>{merged.length}</span> items in <span>{ready.length}</span> files</> : 'No file read yet.'}</span>
              <button className="btn btn-primary it-big" type="button" disabled={!ready.length || files.some((f) => f.status === 'reading')} onClick={() => setStep(2)}>
                Next: check the columns
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <button className="btn" type="button" onClick={() => setStep(1)}>
                Back
              </button>
              <button className="btn btn-primary it-big" type="button" disabled={!merged.length} onClick={() => setStep(3)}>
                Next: check <span>{merged.length}</span> items
              </button>
            </>
          )}
          {step === 3 && (
            <>
              <button className="btn" type="button" disabled={!!run} onClick={() => setStep(2)}>
                Back
              </button>
              {!party && <span className="smi-bad small">Choose the company for the opening stock (step 1), or the quantities are not added.</span>}
              {!checked ? (
                <button className="btn btn-primary it-big" type="button" disabled={!!run || !plans.some((p) => p.include) || !party} onClick={() => void check()}>
                  Check <span>{plans.filter((p) => p.include).length}</span> items
                </button>
              ) : (
                <button className="btn btn-primary it-big" type="button" disabled={!!run || !plans.some((p) => p.include && !p.problems.length)} onClick={() => void importAll()}>
                  Import <span>{plans.filter((p) => p.include && !p.problems.length).length}</span> items
                </button>
              )}
            </>
          )}
          {step === 4 && (
            <button className="btn btn-primary it-big" type="button" onClick={onClose}>
              Done
            </button>
          )}
        </footer>
      </section>
      {labels && result && (
        <TypeLabelPrint
          skuIds={result.outcomes.map((o) => o.id)}
          data={data}
          onClose={() => setLabels(false)}
        />
      )}
    </div>,
    document.body,
  );
}

const STATUS: Record<Status, [string, 'ok' | 'info' | 'neutral' | 'crit']> = {
  new: ['New', 'ok'],
  update: ['Update', 'info'],
  same: ['No change', 'neutral'],
  problem: ['Problem', 'crit'],
};
const PAGE = 60;

function ItemsStep({
  data,
  plans,
  counts,
  checked,
  groupList,
  choiceOf,
  categoryOf,
  setGroup,
  toggle,
  setAll,
}: {
  data: ItemBoard;
  plans: Plan[];
  counts: Record<string, number>;
  checked: boolean;
  groupList: [string, { n: number; guess: Map<ItemCategory, number> }][];
  choiceOf: (g: string | null) => GroupChoice;
  categoryOf: (m: MergedItem) => ItemCategory;
  setGroup: (g: string, c: Partial<GroupChoice>) => void;
  toggle: (key: string, on: boolean) => void;
  setAll: (keys: string[], on: boolean) => void;
}) {
  const [filter, setFilter] = useState<'all' | Status | 'warn'>('all');
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PAGE);
  const money = data.seesMoney !== false;
  const list = plans.filter((p) => {
    if (filter === 'warn' ? !(p.item.warnings.length || p.outcome?.notes.length) : filter !== 'all' && p.status !== filter) return false;
    if (!q) return true;
    const t = q.toUpperCase();
    return p.item.code.toUpperCase().includes(t) || p.item.name.toUpperCase().includes(t) || (p.item.group ?? '').toUpperCase().includes(t);
  });
  return (
    <>
      <div className="smi-sum">
        {(
          [
            ['all', 'All', counts.all],
            ['new', 'New', counts.new],
            ['update', 'Update', counts.update],
            ['same', 'No change', counts.same],
            ['problem', 'Problems', counts.problem],
            ['warn', 'To look at', counts.warn],
          ] as const
        ).map(([k, l, n]) => (
          <button key={k} type="button" className="smi-chip" aria-pressed={filter === k} onClick={() => (setFilter(k), setShown(PAGE))}>
            <span>{l}</span> <strong>{n}</strong>
          </button>
        ))}
      </div>
      <p className="muted small">
        {checked
          ? 'Checked by the server exactly as the import will save them. Items with a problem are left out; untick any item you do not want.'
          : 'New or update is worked out from the catalogue you can see; press Check to have the server check every item as it will be saved.'}
      </p>
      <details className="smi-groups">
        <summary>
          <strong>Stock groups</strong> <span className="muted small">{groupList.length}</span> <span className="muted small">Prima's category and how each is tracked</span>
        </summary>
        <div className="smi-group-list">
          {groupList.map(([g, e]) => {
            const c = choiceOf(g === '(no group)' ? null : g);
            const top = [...e.guess.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'other';
            return (
              <div key={g} className="smi-group">
                <span className="smi-group-name">
                  <strong>{g}</strong> <span className="muted small"><span>{e.n}</span> items</span>
                </span>
                <Select className="input" aria-label={`Category for ${g}`} value={c.category} onChange={(ev) => setGroup(g, { category: ev.target.value as ItemCategory | 'auto' })}>
                  <option value="auto">Guess from each name (mostly {CAT_LABEL[top]})</option>
                  {ITEM_CATEGORIES.map((k) => (
                    <option key={k} value={k}>
                      {CAT_LABEL[k]}
                    </option>
                  ))}
                </Select>
                <Select className="input" aria-label={`Tracking for ${g}`} value={c.tracking} onChange={(ev) => setGroup(g, { tracking: ev.target.value as 'BULK' | 'SERIALIZED' })}>
                  <option value="BULK">Counted by quantity</option>
                  <option value="SERIALIZED">Each unit has its own label</option>
                </Select>
              </div>
            );
          })}
        </div>
      </details>
      <div className="smi-tools">
        <input className="input" type="search" placeholder="Search code, name or group" value={q} onChange={(e) => (setQ(e.target.value), setShown(PAGE))} aria-label="Search items" />
        <button className="btn" type="button" onClick={() => setAll(list.map((p) => p.key), true)}>
          Tick all shown
        </button>
        <button className="btn" type="button" onClick={() => setAll(list.map((p) => p.key), false)}>
          Untick all shown
        </button>
      </div>
      <div className="smi-table" role="table" aria-label="Items to import">
        <div className="smi-tr smi-th" role="row">
          <span role="columnheader" />
          <span role="columnheader">Item</span>
          <span role="columnheader">Group and category</span>
          <span role="columnheader">Units</span>
          <span role="columnheader">Stock</span>
          <span role="columnheader">Status</span>
        </div>
        {list.slice(0, shown).map((p) => {
          const it = p.item;
          // The server's notes once checked (they say the same as the reading's warnings, and more).
          const notes = [...p.problems, ...(p.outcome ? p.outcome.notes : it.warnings)];
          return (
            <div key={p.key} className="smi-tr" role="row" data-off={!p.include || undefined}>
              <span role="cell" className="smi-tick">
                <input type="checkbox" checked={p.include} aria-label={`Import ${it.code || it.name}`} onChange={(e) => toggle(p.key, e.target.checked)} />
              </span>
              <span role="cell" className="smi-item">
                <strong>{it.name}</strong>
                <span className="mono small muted">
                  {it.code || '(no code)'} → {p.outcome?.code ?? primaCodeOf(it.code, it.name)}
                </span>
                <span className="muted small">{it.files.join(', ')}</span>
              </span>
              <span role="cell" className="small">
                <span>{it.group ?? '(no group)'}</span>
                <span className="muted"> · {CAT_LABEL[categoryOf(it)]}</span>
              </span>
              <span role="cell" className="small mono">
                {it.units.length
                  ? it.units.map((u, k) => (
                      <span key={k} className="smi-unit">
                        {u.uom}
                        {u.rate && u.rate !== 1 ? ` x${u.rate}` : ''}
                        {money && (u.cost || u.price) ? ` · ${u.cost ?? '-'} / ${u.price ?? '-'}` : ''}
                      </span>
                    ))
                  : (it.qtyUom ?? '')}
                {money && it.lastCost && <span className="smi-unit muted">last cost {it.lastCost.cost}</span>}
              </span>
              <span role="cell" className="small">
                {it.qty === null ? (
                  <span className="muted">-</span>
                ) : (
                  <>
                    <strong className="mono" data-neg={it.qty < 0 || undefined}>
                      {it.qty}
                    </strong>
                    {it.qtyFrom?.asOf && <span className="muted"> as at {it.qtyFrom.asOf}</span>}
                  </>
                )}
                {it.card && (
                  <span className="muted smi-unit">
                    card: in {it.card.in}, out {it.card.out}
                  </span>
                )}
                {p.outcome?.stock === 'added' && <Chip tone="ok">Opening stock</Chip>}
                {p.outcome?.stock === 'kept' && <Chip tone="warn">Stock kept</Chip>}
              </span>
              <span role="cell" className="smi-status">
                <Chip tone={STATUS[p.status][1]}>{STATUS[p.status][0]}</Chip>
                {notes.length > 0 && (
                  <span className={p.problems.length ? 'smi-bad small' : 'muted small'}>
                    {p.problems.length ? <WarningIcon size={14} aria-hidden="true" /> : null} {notes.join(' ')}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {list.length > shown && (
        <button className="btn" type="button" onClick={() => setShown(shown + PAGE * 4)}>
          Show more (<span>{list.length - shown}</span> more)
        </button>
      )}
      {!list.length && <p className="muted">No items match.</p>}
    </>
  );
}

function Summary({
  data,
  result,
  party,
  onLabels,
}: {
  data: ItemBoard;
  result: { outcomes: ItemListOutcome[]; failed: { key: string; problems: string[] }[]; already: number };
  party: string;
  onLabels: () => void;
}) {
  const o = result.outcomes;
  const n = (f: (x: ItemListOutcome) => boolean) => o.filter(f).length;
  const report = () =>
    downloadText(
      'import-summary.csv',
      toCsv([
        ['Prima code', 'What happened', 'Opening stock', 'Notes'],
        ...o.map((x) => [x.code, x.action, x.stock, x.notes.join(' ')]),
        ...result.failed.map((f) => [f.key, 'not imported', '', f.problems.join(' ')]),
      ]),
    );
  return (
    <div className="smi-done">
      <p className="smi-done-head">
        <CheckCircleIcon size={28} aria-hidden="true" /> <span>{o.length}</span> items imported
      </p>
      <dl className="smi-facts">
        <div>
          <dt>New item types</dt>
          <dd>{n((x) => x.action === 'create')}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{n((x) => x.action === 'update')}</dd>
        </div>
        <div>
          <dt>No change</dt>
          <dd>{n((x) => x.action === 'same')}</dd>
        </div>
        <div>
          <dt>Opening stock added{party ? ` (${partyName(data, party)})` : ''}</dt>
          <dd>{n((x) => x.stock === 'added')}</dd>
        </div>
        <div>
          <dt>Stock already in Prima, kept</dt>
          <dd>{n((x) => x.stock === 'kept')}</dd>
        </div>
        <div>
          <dt>Not imported (problems)</dt>
          <dd>{result.failed.length}</dd>
        </div>
        {result.already > 0 && (
          <div>
            <dt>Already imported before</dt>
            <dd>{result.already}</dd>
          </div>
        )}
      </dl>
      <p className="muted small">Every item type has its own QR code and barcode, made from its code. Print them for shelves and bins; scanning one opens the item.</p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary it-big" type="button" onClick={onLabels} disabled={!o.length}>
          <PrinterIcon size={18} aria-hidden="true" /> Print QR labels for these items
        </button>
        <button className="btn it-big" type="button" onClick={report}>
          <DownloadSimpleIcon size={18} aria-hidden="true" /> Download the summary (CSV)
        </button>
      </div>
    </div>
  );
}
