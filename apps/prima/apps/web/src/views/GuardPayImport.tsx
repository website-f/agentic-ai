// Guard pay Add and Import (Fitri, 23 Nov 2026: "for guard pay, add import button, from csv, excel, pdf and other and auto
// reads the columns and add into our data for guard pay, because now the guard pay don't have any button to add data and
// import"). The Add and Import menus at the top of Guard pay, shown only to the person the Company Manager named to prepare
// a company's run (the server's own rule, sent with the board); the server checks every row again.
//
// What comes in is what the pay run lets the preparer key in by hand: allowances and other one-off pay, deductions with
// their reason, and the PCB. Days, hours, advances and pay in a file are compared with Prima's own figures and shown,
// never written: those are fixed at the attendance, leave or advance record (core guard-pay-import.ts).
import { useEffect, useMemo, useState } from 'react';
import { CheckCircleIcon, DownloadSimpleIcon, FileArrowUpIcon } from '@phosphor-icons/react';
import {
  GUARD_PAY_IMPORT_FIELDS,
  GUARD_PAY_IMPORT_RULE,
  cleanGrid,
  extractPdfTable,
  findHeader,
  guardPayImportRows,
  headerSignature,
  isXlsFile,
  normHeader,
  parseCsv,
  pickSheet,
  prepareSheet,
  readXls,
  smartMatch,
  toCsv,
  type GuardPayImportRow,
  type SmartColumn,
  type SmartLevel,
  type XlsxSheet,
} from '@prima/core';
import { api, ApiError, type GuardPayBoard, type GuardPayImportResult } from '../api';
import { Select } from '../SearchSelect';
import { Steps, type StepState } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, useAction, useLoad } from '../ui';
import { AddImportMenu } from './AddImportMenu';
import { sheetsOf } from './ImportDrawer';
import '../styles/import.css';

declare const __DEMO__: boolean;

type Target = { id: string; companyName: string; period: string; laterOf: boolean };
type Err = { message: string; findings: [] } | null;
const errOf = (e: unknown): Err => ({ message: e instanceof ApiError || e instanceof Error ? e.message : String(e), findings: [] });
const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthLabel = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString('en-MY', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const targetLabel = (t: Target) => `${t.companyName}, ${monthLabel(t.period)}${t.laterOf ? ' (later run)' : ''}`;
const ACCEPT = '.xlsx,.xlsm,.xls,.csv,.txt,.tsv,.docx,.pdf,text/csv,text/plain,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const USE_LABEL = { match: 'Finds the guard', write: 'Saved on the pay line', compare: 'Compared only' } as const;
const LEVEL: Record<SmartLevel, [string, 'ok' | 'info' | 'warn']> = { sure: ['Sure', 'ok'], likely: ['Likely', 'info'], check: ['Check this', 'warn'] };
const SHOW_ROWS = 200;

/** The draft runs this person may change: a company they were named to prepare (server-sent), still a draft. */
function targetsOf(data: GuardPayBoard): { targets: Target[]; prepares: boolean } {
  const mine = new Set(data.employers.filter((e) => e.prepares).map((e) => e.companyId));
  const targets = data.runs
    .filter((r) => r.stage === 'draft' && mine.has(r.companyId))
    .map((r) => ({ id: r.id, companyName: r.companyName, period: r.period, laterOf: r.id.includes('-later-') }));
  return { targets, prepares: mine.size > 0 && data.on };
}

/** Add and Import at the top of Guard pay. Nothing shows for someone who prepares no company's run. */
export function GuardPayAddImport({ data }: { data: GuardPayBoard }) {
  const [open, setOpen] = useState<'add' | 'import' | null>(null);
  const { targets, prepares } = targetsOf(data);
  // Not the named preparer: say who gets Add and Import instead of showing nothing.
  if (!prepares)
    return (
      <span className="muted" style={{ fontSize: 13, alignSelf: 'center' }}>
        Add and Import show for the person the Company Manager names to prepare (Prepared by, in the By company table).
      </span>
    );
  return (
    <>
      <AddImportMenu
        addLabel="Add"
        importLabel="Import"
        entries={[{ key: 'guard-pay-line', label: 'Allowance, deduction or PCB for one guard', onAdd: () => setOpen('add') }, { key: 'guard-pay-file', label: 'Allowances, deductions and PCB from a file', onImport: () => setOpen('import') }]}
      />
      {open === 'add' && <AddDrawer targets={targets} onClose={() => setOpen(null)} />}
      {open === 'import' && <GuardPayImportDrawer targets={targets} onClose={() => setOpen(null)} />}
    </>
  );
}

function RunPicker({ targets, value, onChange }: { targets: Target[]; value: string; onChange: (id: string) => void }) {
  if (!targets.length)
    return (
      <div className="notice" data-tone="info">
        No draft pay run to change. Prepare the month first (By company table), then add or import its allowances, deductions and PCB.
      </div>
    );
  return (
    <label className="field">
      <span className="label">Pay run</span>
      <Select className="select" aria-label="Pay run" value={value} onChange={(e) => onChange(e.target.value)}>
        {targets.map((t) => (
          <option key={t.id} value={t.id}>
            {targetLabel(t)}
          </option>
        ))}
      </Select>
    </label>
  );
}

/** What the server found for each row: the guard, the items, pay before and after, problems and differences. */
function ResultRows({ result, problemsOnly }: { result: GuardPayImportResult; problemsOnly?: boolean }) {
  const rows = problemsOnly ? result.rows.filter((r) => r.status === 'problem' || r.notes.length) : result.rows;
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">Row</th>
              <th>Guard</th>
              <th>What is saved</th>
              <th className="num">Net pay</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, SHOW_ROWS).map((r) => (
              <tr key={r.row}>
                <td className="num">{r.row}</td>
                <td>
                  {r.personId ? (
                    <>
                      <strong>{r.name}</strong> <span className="muted small">{r.staffNo}</span>
                    </>
                  ) : (
                    <span className="muted">{[r.staffNo, r.name].filter(Boolean).join(' ') || '-'}</span>
                  )}
                </td>
                <td className="small">
                  {r.items.map((x) => (
                    <div key={x.label}>
                      {x.label} {rm(x.amount)}
                    </div>
                  ))}
                  {r.pcb != null && (
                    <div>
                      PCB {rm(r.pcb)}
                    </div>
                  )}
                  {r.errors.map((e) => (
                    <div key={e} style={{ color: 'var(--crit, #b91c1c)' }}>
                      {e}
                    </div>
                  ))}
                  {r.notes.map((n) => (
                    <div key={n} style={{ color: 'var(--warn, #b45309)' }}>
                      {n}
                    </div>
                  ))}
                </td>
                <td className="num">
                  {r.before ? rm(r.before.net) : '-'}
                  {r.after && <div className="small">→ {rm(r.after.net)}</div>}
                </td>
                <td>
                  {r.status === 'problem' ? <Chip tone="crit">Problem</Chip> : r.status === 'change' ? <Chip tone="ok">Changes</Chip> : <Chip tone="neutral">No change</Chip>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > SHOW_ROWS && (
        <p className="muted small">
          The first {SHOW_ROWS} rows are shown; every row is checked.
        </p>
      )}
    </>
  );
}

function Tally({ result }: { result: GuardPayImportResult }) {
  return (
    <div className="imp-tally row" style={{ gap: 6, flexWrap: 'wrap' }}>
      <Chip tone="ok">
        {result.counts.change} <span>lines change</span>
      </Chip>
      <Chip tone="neutral">
        {result.counts.same} <span>already the same</span>
      </Chip>
      <Chip tone={result.counts.problem ? 'crit' : 'neutral'}>
        {result.counts.problem} <span>with a problem</span>
      </Chip>
      <span className="small">
        <span>Gross pay change</span> {rm(result.delta.gross)} · <span>Net pay change</span> {rm(result.delta.net)}
      </span>
    </div>
  );
}

// ---------- Add: one guard ----------

type Kind = 'allowance' | 'otherPay' | 'deduction';

function AddDrawer({ targets, onClose }: { targets: Target[]; onClose: () => void }) {
  const [runId, setRunId] = useState(targets[0]?.id ?? '');
  const { data: run, error: runError } = useLoad(() => (runId ? api.guardPayRun(runId) : Promise.resolve(null)), [runId]);
  const act = useAction();
  const [personId, setPersonId] = useState('');
  const [kind, setKind] = useState<Kind>('allowance');
  const [amount, setAmount] = useState('');
  const [uniformNo, setUniformNo] = useState('');
  const [pcb, setPcb] = useState('');
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState<GuardPayImportResult | null>(null);
  const [checkErr, setCheckErr] = useState<Err>(null);
  const [checking, setChecking] = useState(false);
  const [saved, setSaved] = useState<GuardPayImportResult | null>(null);
  useEffect(() => {
    setPersonId('');
    setChecked(null);
  }, [runId]);
  const row = (): GuardPayImportRow => ({
    row: 1,
    personId,
    ...(amount.trim() ? { [kind]: Number(amount) } : {}),
    ...(kind === 'deduction' && uniformNo ? { uniformNo: Number(uniformNo) } : {}),
    ...(pcb.trim() ? { pcb: Number(pcb) } : {}),
    note: reason.trim(),
  });
  const filled = !!personId && (amount.trim() !== '' || pcb.trim() !== '') && reason.trim().length >= 5 && (amount.trim() === '' || Number.isFinite(Number(amount))) && (pcb.trim() === '' || Number.isFinite(Number(pcb)));
  const check = async () => {
    setChecking(true);
    setCheckErr(null);
    try {
      setChecked(await api.importGuardPayLines(runId, { rows: [row()], note: reason.trim(), dryRun: true, source: 'the Add form' }));
    } catch (e) {
      setCheckErr(errOf(e));
    } finally {
      setChecking(false);
    }
  };
  const save = async () => {
    const r = await act.run(() => api.importGuardPayLines(runId, { rows: [row()], note: reason.trim(), dryRun: false, source: 'the Add form' }), 'Saved on the pay line. The COO sees it flagged.');
    if (r) setSaved(r);
  };
  const edit = (f: () => void) => {
    f();
    setChecked(null);
  };
  return (
    <Drawer title="Add to guard pay" sub="One guard's allowance, deduction or PCB, on a draft run" onClose={onClose}>
      {saved ? (
        <div className="imp-step imp-done">
          <CheckCircleIcon size={40} weight="fill" aria-hidden="true" />
          <h3>Saved on the pay line</h3>
          <ResultRows result={saved} />
          <p className="muted small">It is in the audit log. The COO sees the item flagged when the month is submitted.</p>
          <div className="imp-actions">
            <button className="btn btn-primary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          <RunPicker targets={targets} value={runId} onChange={(id) => edit(() => setRunId(id))} />
          {runError && <ErrorNotice error={runError} />}
          {runId && !run && !runError && <Loading what="the pay run" />}
          {run && (
            <>
              <label className="field">
                <span className="label">Guard or officer</span>
                <Select className="select" aria-label="Guard or officer" searchable value={personId} onChange={(e) => edit(() => setPersonId(e.target.value))}>
                  <option value="">Choose…</option>
                  {[...run.run.lines]
                    .sort((a, b) => a.staffNo.localeCompare(b.staffNo))
                    .map((l) => (
                      <option key={l.personId} value={l.personId}>
                        {`${l.staffNo} ${l.name}`}
                      </option>
                    ))}
                </Select>
              </label>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <label className="field" style={{ minWidth: 170 }}>
                  <span className="label">What</span>
                  <Select className="select" aria-label="What" value={kind} onChange={(e) => edit(() => setKind(e.target.value as Kind))}>
                    <option value="allowance">Allowance</option>
                    <option value="otherPay">Other pay</option>
                    <option value="deduction">Deduction</option>
                  </Select>
                </label>
                <label className="field" style={{ maxWidth: 160 }}>
                  <span className="label">Amount (RM)</span>
                  <input className="input" inputMode="decimal" aria-label="Amount (RM)" value={amount} onChange={(e) => edit(() => setAmount(e.target.value))} />
                </label>
                {kind === 'deduction' && (
                  <label className="field" style={{ minWidth: 190 }}>
                    <span className="label">Uniform</span>
                    <Select className="select" aria-label="Uniform" value={uniformNo} onChange={(e) => edit(() => setUniformNo(e.target.value))}>
                      <option value="">Not a uniform</option>
                      <option value="4">4th uniform (guard pays)</option>
                      <option value="5">5th uniform (guard pays)</option>
                    </Select>
                  </label>
                )}
                <label className="field" style={{ maxWidth: 160 }}>
                  <span className="label">PCB (RM), optional</span>
                  <input className="input" inputMode="decimal" aria-label="PCB (RM), optional" placeholder="PCB from e-PCB" value={pcb} onChange={(e) => edit(() => setPcb(e.target.value))} />
                </label>
              </div>
              <label className="field">
                <span className="label">Reason (shown on the item and in the audit log)</span>
                <input className="input" aria-label="Reason" maxLength={50} placeholder="e.g. Night shift allowance, October" value={reason} onChange={(e) => edit(() => setReason(e.target.value))} />
              </label>
              <p className="muted small">
                Advances and loans are taken back only from their approved record (Advances and loans screen). Days, hours and overtime come from locked attendance: correct the attendance or leave record instead.
              </p>
              <ErrorNotice error={checkErr ?? act.error} />
              {checked && (
                <>
                  <Tally result={checked} />
                  <ResultRows result={checked} />
                </>
              )}
              <div className="imp-actions">
                <button className="btn" disabled={!filled || checking || act.busy} onClick={() => void check()}>
                  Check
                </button>
                <button className="btn btn-primary" disabled={!checked || checked.counts.change !== 1 || act.busy} onClick={() => void save()}>
                  Save
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}

// ---------- Import: a file or pasted text ----------

/** The browser's raw deflate (zip parts of .xlsx and .docx) and zlib deflate (PDF streams). */
async function inflate(bytes: Uint8Array, format: 'deflate' | 'deflate-raw'): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream(format))).arrayBuffer());
}

/** A PDF table through the PDF reader (pdf.js, served from this site) when the built-in reader finds no columns. */
async function pdfRows(bytes: Uint8Array): Promise<string[][]> {
  if (__DEMO__) return [];
  const base = new URL(`${import.meta.env.BASE_URL}pdf/`, location.href).href;
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.min.mjs`;
  const task = pdfjs.getDocument({ data: bytes, wasmUrl: `${base}wasm/`, disableFontFace: true, stopAtErrors: false });
  try {
    const doc = await task.promise;
    const out: string[][] = [];
    for (let n = 1; n <= Math.min(doc.numPages, 60); n++) {
      const page = await doc.getPage(n);
      const items: { s: string; x: number; y: number; w: number; h: number }[] = [];
      for (const it of (await page.getTextContent()).items) if ('str' in it && it.str.trim()) items.push({ s: it.str.trim(), x: Number(it.transform[4]) || 0, y: Number(it.transform[5]) || 0, w: Number(it.width) || 0, h: Number(it.height) || 10 });
      // Words at the same height are one line; a gap wider than a letter or two starts a new cell.
      const lines: (typeof items)[] = [];
      for (const it of items.sort((a, b) => b.y - a.y || a.x - b.x)) {
        const line = lines.find((l) => Math.abs(l[0].y - it.y) <= Math.max(2, it.h * 0.4));
        if (line) line.push(it);
        else lines.push([it]);
      }
      for (const l of lines) {
        const cells: string[] = [];
        let end = -Infinity;
        for (const it of l.sort((a, b) => a.x - b.x)) {
          if (cells.length && it.x - end < it.h * 0.9) cells[cells.length - 1] += ` ${it.s}`;
          else cells.push(it.s);
          end = it.x + it.w;
        }
        out.push(cells);
      }
      page.cleanup();
    }
    return out;
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

/** Any file the guard pay import takes, to sheets of cell text. Read here on the device; nothing is uploaded to read it. */
async function readGuardPayFile(f: File): Promise<XlsxSheet[]> {
  const name = f.name.toLowerCase();
  const bytes = new Uint8Array(await f.arrayBuffer());
  if (name.endsWith('.xls') || isXlsFile(bytes)) return readXls(bytes);
  if (name.endsWith('.pdf') || f.type === 'application/pdf') {
    const rows = await extractPdfTable(bytes, (b) => inflate(b, 'deflate')).catch(() => [] as string[][]);
    if (rows.filter((r) => r.length >= 3).length >= 2) return [{ name: f.name, rows }];
    const more = await pdfRows(bytes).catch(() => [] as string[][]);
    if (more.filter((r) => r.length >= 3).length >= 2) return [{ name: f.name, rows: more }];
    throw new Error('No table could be read from this PDF. A scanned paper is a picture: ask for the Excel copy, or type the figures in with Add.');
  }
  return sheetsOf(f);
}

/** Text pasted from Excel (tabs), a CSV, or a printed list (columns two or more spaces apart). */
function pastedRows(text: string): string[][] {
  const lines = text.replace(/\r/g, '').split('\n');
  if (lines.some((l) => l.includes('\t'))) return lines.map((l) => l.split('\t'));
  if (lines.filter((l) => l.includes(',')).length >= Math.max(2, lines.filter((l) => l.trim()).length / 2)) return parseCsv(text);
  return lines.map((l) => l.trim().split(/\s{2,}|\s*\|\s*/));
}

const layoutKey = (header: string[]) => `prima.guardpay.import.layout.${headerSignature(header)}`;
function remembered(header: string[]): Record<string, string> | null {
  try {
    const v = localStorage.getItem(layoutKey(header));
    return v ? (JSON.parse(v) as Record<string, string>) : null;
  } catch {
    return null;
  }
}
function remember(header: string[], mapping: string[]) {
  try {
    const m: Record<string, string> = {};
    header.forEach((h, i) => mapping[i] && normHeader(h) && (m[normHeader(h)] = mapping[i]));
    localStorage.setItem(layoutKey(header), JSON.stringify(m));
  } catch {
    /* private window or storage full: the matcher still works, it is just not remembered */
  }
}

type Step = 'file' | 'map' | 'check' | 'done';
const STEPS: Step[] = ['file', 'map', 'check', 'done'];

function GuardPayImportDrawer({ targets, onClose }: { targets: Target[]; onClose: () => void }) {
  const act = useAction();
  const fields = GUARD_PAY_IMPORT_FIELDS;
  const [runId, setRunId] = useState(targets[0]?.id ?? '');
  const [step, setStep] = useState<Step>('file');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Err>(null);
  const [source, setSource] = useState('');
  const [paste, setPaste] = useState('');
  const [sheets, setSheets] = useState<XlsxSheet[] | null>(null);
  const [sheet, setSheet] = useState(0);
  const [table, setTable] = useState<string[][] | null>(null);
  const [rowNos, setRowNos] = useState<number[]>([]);
  const [cols, setCols] = useState<SmartColumn[]>([]);
  const [mapping, setMapping] = useState<string[]>([]);
  const [problems, setProblems] = useState<{ row: number; message: string }[]>([]);
  const [rows, setRows] = useState<GuardPayImportRow[]>([]);
  const [result, setResult] = useState<GuardPayImportResult | null>(null);
  const [leaveOut, setLeaveOut] = useState(false);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState<GuardPayImportResult | null>(null);
  const target = targets.find((t) => t.id === runId);

  /** Find the header row and match the columns on this device (a fraction of a second, even for a long file). */
  function matchSheet(raw: string[][]) {
    const grid = cleanGrid(raw);
    const hr = findHeader(grid, fields);
    const p = prepareSheet(grid, fields, hr);
    if (p.table.length < 2) throw new Error('This sheet has no rows under the column names.');
    if (p.table.length - 1 > GUARD_PAY_IMPORT_RULE.maxRows) throw new Error(`This sheet has more than ${GUARD_PAY_IMPORT_RULE.maxRows} rows. Split it into smaller files.`);
    // The file's own row numbers (as Excel shows them), for every message.
    const dropped = new Set(p.droppedRows);
    const nos: number[] = [];
    for (let n = hr + 2; nos.length < p.table.length - 1 && n < hr + 2 + grid.length + 10; n++) if (!dropped.has(n)) nos.push(n);
    const m = smartMatch(p.table, fields, { headerRow: 0, remembered: remembered(p.table[0]) });
    setTable(p.table);
    setRowNos(nos);
    setCols(m.columns);
    setMapping(m.columns.map((c) => c.field ?? ''));
    setResult(null);
    setStep('map');
  }

  async function load(get: () => Promise<XlsxSheet[]>, name: string) {
    setError(null);
    setBusy('Reading on this device…');
    // Let the screen show that it is busy before a long file is read.
    await new Promise((r) => setTimeout(r, 30));
    try {
      const all = (await get()).map((s) => ({ ...s, rows: cleanGrid(s.rows) }));
      if (!all.some((s) => s.rows.length >= 2)) throw new Error('No list with rows was found in this file.');
      const best = pickSheet(all, fields);
      setSheets(all);
      setSheet(best);
      setSource(name);
      matchSheet(all[best].rows);
    } catch (e) {
      setError(errOf(e));
    } finally {
      setBusy(null);
    }
  }

  const readFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > GUARD_PAY_IMPORT_RULE.maxFileBytes) return setError(errOf('The file is too big. Keep only the sheet with the guards, then choose it again.'));
    void load(() => readGuardPayFile(f), f.name);
  };

  const fieldOf = (k: string) => fields.find((f) => f.key === k);
  const used = new Set(mapping.filter(Boolean));
  const canCheck = fields.some((f) => f.use === 'match' && used.has(f.key)) && fields.some((f) => f.use !== 'match' && used.has(f.key));

  function choose(col: number, key: string) {
    setMapping((cur) => cur.map((m, i) => (i === col ? key : key && m === key ? '' : m)));
    setResult(null);
  }

  async function check() {
    if (!table || !runId) return;
    const { rows: rs, problems: ps } = guardPayImportRows(table, mapping.map((m) => m || null), (i) => rowNos[i] ?? i + 2);
    setProblems(ps);
    setRows(rs);
    setLeaveOut(false);
    if (!rs.length) {
      setResult(null);
      setStep('check');
      return;
    }
    setBusy(`Checking ${rs.length} rows against the pay line's own rules…`);
    setError(null);
    try {
      setResult(await api.importGuardPayLines(runId, { rows: rs, note: '', dryRun: true, source }));
      remember(table[0], mapping);
      setStep('check');
    } catch (e) {
      setError(errOf(e));
    } finally {
      setBusy(null);
    }
  }

  const serverProblems = result?.counts.problem ?? 0;
  const anyProblem = serverProblems + problems.length > 0;
  const toSend = useMemo(() => {
    if (!result) return [];
    const ok = new Set(result.rows.filter((r) => r.status === 'change').map((r) => r.row));
    return rows.filter((r) => ok.has(r.row));
  }, [result, rows]);

  async function commit() {
    if (!toSend.length) return;
    const r = await act.run(() => api.importGuardPayLines(runId, { rows: toSend, note: note.trim(), dryRun: false, source }), (x) => `${x.saved} pay lines saved.`);
    if (r) {
      setSaved(r);
      setStep('done');
    }
  }

  const template = () => {
    const head = ['Staff number', 'IC number', 'Name', 'Allowance (RM)', 'Other pay (RM)', 'Deduction (RM)', 'Reason or note', 'Uniform number (4th set or later)', 'PCB (RM)', 'Days worked', 'Overtime hours'];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + toCsv([head])], { type: 'text/csv;charset=utf-8' }));
    a.download = 'Guard pay items template.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const stepState = (s: Step): StepState => {
    const at = STEPS.indexOf(step);
    const i = STEPS.indexOf(s);
    return i < at ? 'done' : i === at ? 'now' : 'todo';
  };

  return (
    <Drawer title="Import guard pay items" sub={target ? targetLabel(target) : 'Allowances, deductions and PCB from a file'} onClose={onClose}>
      <Steps
        steps={[
          { label: 'Upload', state: stepState('file') },
          { label: 'Check columns', state: stepState('map') },
          { label: 'Check rows', state: stepState('check') },
          { label: 'Done', state: stepState('done') },
        ]}
      />
      {busy && (
        <div className="imp-busy" role="status" aria-live="polite">
          <span className="imp-bar" aria-hidden="true" />
          <span>{busy}</span>
        </div>
      )}
      <ErrorNotice error={error} />

      {step === 'file' && (
        <div className="imp-step">
          <RunPicker targets={targets} value={runId} onChange={setRunId} />
          <p className="muted small">
            Use the sheet you already have: Excel (.xlsx or the older .xls), CSV, a table in Word, a list saved as PDF, or text copied from Excel. Any column order, English or Malay column names, a title above the table is fine. Prima reads it on this device, finds each guard by staff number, IC or name, and checks every row with the same rules as keying it in. Nothing is saved until you press Import.
          </p>
          <p className="muted small">
            Saved: allowances, other pay, deductions (with their reason) and PCB. Compared only: days worked, overtime hours, rest days, public holidays, advances, gross and net pay. A difference is fixed at the attendance, leave or advance record, not here.
          </p>
          <label className={`imp-drop${runId ? '' : ' imp-drop-off'}`}>
            <FileArrowUpIcon size={30} aria-hidden="true" />
            <strong>{source || 'Choose the file'}</strong>
            <span className="muted small">Excel (.xlsx, .xls), CSV, text, Word (.docx) or PDF</span>
            <input type="file" accept={ACCEPT} disabled={!runId || !!busy} style={{ display: 'none' }} onChange={(e) => readFile(e.target.files?.[0])} />
          </label>
          <label className="field">
            <span className="label">Or paste the rows (with the column names)</span>
            <textarea className="input" rows={4} aria-label="Or paste the rows (with the column names)" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Copy the cells in Excel, then paste here" />
          </label>
          <div className="imp-actions">
            <button className="btn btn-sm btn-ghost" onClick={template}>
              <DownloadSimpleIcon size={16} aria-hidden="true" />
              Template
            </button>
            <button className="btn" disabled={!runId || !paste.trim() || !!busy} onClick={() => void load(async () => [{ name: 'Pasted', rows: pastedRows(paste) }], 'pasted text')}>
              Read the pasted rows
            </button>
          </div>
        </div>
      )}

      {step === 'map' && table && (
        <div className="imp-step">
          {sheets && sheets.length > 1 && (
            <label className="field">
              <span className="label">Sheet</span>
              <Select
                className="select"
                aria-label="Sheet"
                value={String(sheet)}
                onChange={(e) => {
                  const i = Number(e.target.value);
                  setSheet(i);
                  try {
                    matchSheet(sheets[i].rows);
                  } catch (x) {
                    setError(errOf(x));
                  }
                }}
              >
                {sheets.map((s, i) => (
                  <option key={i} value={String(i)}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <p className="muted small">
            Each column of the file and what it was matched to. Change any match; a column left on Not used is ignored. Needed: one column that finds the guard (staff number, IC or name) and at least one figure.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Column in the file</th>
                  <th>First values</th>
                  <th>Use as</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cols.map((c, i) => {
                  const f = fieldOf(mapping[i]);
                  const manual = mapping[i] !== (c.field ?? '');
                  return (
                    <tr key={c.index}>
                      <td>
                        <strong>{c.header || `Column ${c.index + 1}`}</strong>
                      </td>
                      <td className="small muted">{c.profile.sample.join(' · ').slice(0, 60)}</td>
                      <td>
                        <Select className="select" aria-label={`Use of column ${c.header || c.index + 1}`} value={mapping[i]} onChange={(e) => choose(i, e.target.value)}>
                          <option value="">Not used</option>
                          {(['match', 'write', 'compare'] as const).map((u) => (
                            <optgroup key={u} label={USE_LABEL[u]}>
                              {fields
                                .filter((x) => x.use === u)
                                .map((x) => (
                                  <option key={x.key} value={x.key}>
                                    {x.label}
                                  </option>
                                ))}
                            </optgroup>
                          ))}
                        </Select>
                      </td>
                      <td>
                        {f && (manual ? <Chip tone="neutral">Your choice</Chip> : c.level && <Chip tone={LEVEL[c.level][1]} title={c.why}>{LEVEL[c.level][0]}</Chip>)}
                        {f && <div className="muted small">{USE_LABEL[f.use]}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="imp-actions imp-sticky">
            <button className="btn" disabled={!!busy} onClick={() => setStep('file')}>
              Back
            </button>
            <button className="btn btn-primary" disabled={!!busy || !canCheck} onClick={() => void check()}>
              Check the rows
            </button>
          </div>
        </div>
      )}

      {step === 'check' && (
        <div className="imp-step">
          {result && <Tally result={result} />}
          {problems.length > 0 && (
            <div className="notice" data-tone="warn">
              <strong>Rows that could not be read</strong>
              <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                {problems.slice(0, 50).map((p) => (
                  <li key={p.row}>
                    <span>Row</span> {p.row}: {p.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!rows.length && <p className="notice" data-tone="warn">No row with a guard and a figure was found. Check the columns.</p>}
          {result && (
            <>
              <label className="row small" style={{ gap: 6 }}>
                <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} />
                Show only rows with a problem or a difference
              </label>
              <ResultRows result={result} problemsOnly={problemsOnly} />
            </>
          )}
          {anyProblem && toSend.length > 0 && (
            <label className="row small" style={{ gap: 6 }}>
              <input type="checkbox" checked={leaveOut} onChange={(e) => setLeaveOut(e.target.checked)} />
              Leave out the rows with a problem and import the rest
            </label>
          )}
          {toSend.length > 0 && (
            <label className="field">
              <span className="label">Reason for this import (kept in the audit log)</span>
              <input className="input" aria-label="Reason for this import" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. October allowances from the site office sheet" />
            </label>
          )}
          <ErrorNotice error={act.error} />
          <div className="imp-actions imp-sticky">
            <button className="btn" disabled={act.busy} onClick={() => setStep('map')}>
              Back
            </button>
            <button className="btn btn-primary" disabled={act.busy || !toSend.length || note.trim().length < 5 || (anyProblem && !leaveOut)} onClick={() => void commit()}>
              Import
            </button>
          </div>
        </div>
      )}

      {step === 'done' && saved && (
        <div className="imp-step imp-done">
          <CheckCircleIcon size={40} weight="fill" aria-hidden="true" />
          <h3>
            {saved.saved} <span>pay lines saved</span>
          </h3>
          <Tally result={saved} />
          <p className="muted small">
            Every line went through the same checks as keying it in, and each is in the audit log with the reason. The COO sees the items flagged when the month is submitted. Next time a file with these column names is matched the same way on this device.
          </p>
          <div className="imp-actions">
            <button className="btn btn-primary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      )}
    </Drawer>
  );
}
