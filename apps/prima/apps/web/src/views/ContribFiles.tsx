// P128 (Fitri, 24 Nov 2026): contribution files in the Payroll app. HR, the Chief of Staff, the COO or Finance upload
// any salary sheet (their own format: Excel, CSV, Word, PDF printed from Excel, or rows pasted); Prima reads it on this
// device, works out SOCSO, EIS, SKBBK and EPF for each person with its own statutory tables, and gives PERKESO's file
// ready to submit: the ASSIST text file and the converter workbook, plus a check sheet and the EPF list. Three steps:
// Upload, Check, Download. Each file made is kept with the employer (the server counts it again) so it can be
// downloaded again; every download is in the audit log.
import { useEffect, useMemo, useState } from 'react';
import { takeHandedFile, useScreenUploader } from '../upload-handlers';
import { ocrPdfPieces } from '../pdf-ocr';
import { CheckCircleIcon, DownloadSimpleIcon, FileArrowUpIcon, WarningCircleIcon } from '@phosphor-icons/react';
import {
  FIGURE_LABEL,
  PAY_KEYS,
  cleanGrid,
  contribCheckCsv,
  contribEpfCsv,
  contribRow,
  contribTotals,
  employerCodeProblem,
  extractPdfPieces,
  guessWageTicks,
  headerSignature,
  isXlsFile,
  matchCompany,
  parseCsv,
  payGridFromPdf,
  payKeyInfo,
  payPeople,
  perkesoTextFile,
  perkesoTextFileName,
  perkesoXlsm,
  periodIn,
  readDocxTables,
  readPaySheet,
  readXls,
  readXlsx,
  totalsCheck,
  wagesOf,
  type ContribDownloadKind,
  type ContribFileRecord,
  type ContribPerson,
  type ContribRow,
  type PayColumn,
  type PayKey,
  type PaySheet,
  type PdfTextPiece,
  type ReadPeople,
  type WageGuess,
} from '@prima/core';
import { api, type ContribBoard } from '../api';
import { useRouteTab } from '../App';
import { Select } from '../SearchSelect';
import { Card, Empty, PageHead, Stat, Stats, Steps, type StepState } from '../kit';
import { Chip, ErrorNotice, Loading, dateTimeLabel, useAction, useLoad } from '../ui';
import '../styles/import.css';
import '../styles/payroll.css';
import '../styles/contrib.css';

declare const __DEMO__: boolean;

const ACCEPT =
  '.xlsx,.xlsm,.xls,.csv,.txt,.tsv,.docx,.pdf,text/csv,text/plain,application/pdf,application/vnd.ms-excel,application/vnd.ms-excel.sheet.macroEnabled.12,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const rm = (n: number) => n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthLabel = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString('en-MY', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const SHOW_ROWS = 300;

type Step = 'upload' | 'check' | 'download';
type Tab = 'new' | 'records';

export function ContribFilesView() {
  const { data, error } = useLoad(() => api.contributionFiles(), []);
  const [tab, setTab] = useRouteTab<Tab>('new', ['new', 'records']);
  // P129: the toolbar's Upload here (or on Staff payroll) starts New file with the chosen file.
  const [handed, setHanded] = useState<File | null>(() => takeHandedFile('contribfiles'));
  useScreenUploader('contribfiles', {
    key: 'salary-sheet',
    label: 'Salary sheet: SOCSO, EIS, SKBBK and EPF',
    detail: 'Any salary sheet (Excel, CSV, PDF or Word) is read on this device; you check each person, then download the PERKESO file and the converter workbook.',
    unavailable: data && !data.employers.length ? 'No employer is open to you here.' : null,
    open: (f) => {
      setTab('new');
      if (f) setHanded(f);
    },
  });
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="contribution files" />;
  return (
    <div className="page pay">
      <PageHead
        title="Contribution files"
        sub="Upload any salary sheet. Prima works out SOCSO, EIS, SKBBK and EPF for each person with its own statutory tables, and gives you PERKESO's file ready to submit."
      >
        <div className="tabbar" role="tablist" aria-label="Contribution files">
          <button role="tab" aria-selected={tab === 'new'} onClick={() => setTab('new')}>
            New file
          </button>
          <button role="tab" aria-selected={tab === 'records'} onClick={() => setTab('records')}>
            Saved files
          </button>
        </div>
      </PageHead>
      {tab === 'new' ? <NewFile board={data} handed={handed} onHandedRead={() => setHanded(null)} /> : <Records board={data} />}
    </div>
  );
}

// ---------- Reading a file on this device ----------

async function inflate(bytes: Uint8Array, format: 'deflate' | 'deflate-raw'): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream(format))).arrayBuffer());
}

/** Text pieces of a PDF through the PDF reader (pdf.js, served from this site) when Prima's own reader finds none. */
async function pdfjsPieces(bytes: Uint8Array): Promise<PdfTextPiece[]> {
  if (__DEMO__) return [];
  const base = new URL(`${import.meta.env.BASE_URL}pdf/`, location.href).href;
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.min.mjs`;
  const task = pdfjs.getDocument({ data: bytes, wasmUrl: `${base}wasm/`, disableFontFace: true, stopAtErrors: false });
  try {
    const doc = await task.promise;
    const out: PdfTextPiece[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, 60); n++) {
      const page = await doc.getPage(n);
      for (const it of (await page.getTextContent()).items)
        if ('str' in it && it.str.trim()) {
          const x = Number(it.transform[4]) || 0;
          const size = Math.abs(Number(it.transform[3])) || Number(it.height) || 8;
          out.push({ x, y: Number(it.transform[5]) || 0, right: x + (Number(it.width) || it.str.length * size * 0.5), size, text: it.str, page: n - 1 });
        }
      page.cleanup();
    }
    return out;
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

/** Any file to rows of cell text: every sheet of a workbook, the tables of a Word file, a PDF by where its text sits. */
async function readAnyFile(f: File, progress?: (msg: string) => void): Promise<string[][][]> {
  const name = f.name.toLowerCase();
  const bytes = new Uint8Array(await f.arrayBuffer());
  if (name.endsWith('.pdf') || f.type === 'application/pdf') {
    let pieces = await extractPdfPieces(bytes, (b) => inflate(b, 'deflate')).catch(() => [] as PdfTextPiece[]);
    let grid = payGridFromPdf(pieces);
    if (grid.filter((r) => r.length >= 3).length < 2) {
      pieces = await pdfjsPieces(bytes).catch(() => []);
      grid = payGridFromPdf(pieces);
    }
    // P129: no text in the PDF (a scan, or printed to a picture): read the page pictures with OCR on this device.
    if (grid.filter((r) => r.length >= 3).length < 2) {
      pieces = await ocrPdfPieces(bytes, progress).catch((e: unknown) => {
        throw new Error(`This PDF is a picture (a scan), and reading it with OCR did not work: ${e instanceof Error ? e.message : String(e)} Ask for the Excel copy, or paste the rows.`);
      });
      grid = payGridFromPdf(pieces);
    }
    if (grid.filter((r) => r.length >= 3).length < 2) throw new Error('No table could be read from this PDF, even with OCR (the scan may be too faint or skewed). Ask for the Excel copy, or paste the rows.');
    return [grid];
  }
  if (name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.tsv') || f.type === 'text/csv') return [pastedRows(new TextDecoder().decode(bytes))];
  if (name.endsWith('.docx')) return (await readDocxTables(bytes, (b) => inflate(b, 'deflate-raw'))).map((s) => s.rows);
  if (name.endsWith('.xls') || isXlsFile(bytes)) return readXls(bytes).map((s) => s.rows);
  return (await readXlsx(bytes, (b) => inflate(b, 'deflate-raw'))).map((s) => s.rows);
}

/** Text pasted from Excel (tabs), a CSV, or a printed list (columns two or more spaces apart). */
function pastedRows(text: string): string[][] {
  const lines = text.replace(/\r/g, '').split('\n');
  if (lines.some((l) => l.includes('\t'))) return lines.map((l) => l.split('\t'));
  if (lines.filter((l) => l.includes(',')).length >= Math.max(2, lines.filter((l) => l.trim()).length / 2)) return parseCsv(text);
  return lines.map((l) => l.trim().split(/\s{2,}|\s*\|\s*/));
}

/** The sheet most like a salary list: the one whose heading names the most pay columns. */
function bestSheet(grids: string[][][]): PaySheet | null {
  let best: PaySheet | null = null;
  let score = -1;
  for (const g of grids) {
    const grid = cleanGrid(g);
    if (grid.length < 2) continue;
    const s = readPaySheet(grid);
    const n = s.columns.filter((c) => c.key).length * 10 + Math.min(s.body.length, 500) / 100;
    if (n > score) {
      best = s;
      score = n;
    }
  }
  return best;
}

const layoutKey = (sheet: PaySheet) => `prima.contrib.layout.${headerSignature(sheet.columns.map((c) => c.header))}`;
function rememberedColumns(sheet: PaySheet): PayColumn[] | null {
  try {
    const v = localStorage.getItem(layoutKey(sheet));
    if (!v) return null;
    const saved = JSON.parse(v) as { index: number; key: PayKey | null; epf: boolean; socso: boolean }[];
    if (saved.length !== sheet.columns.length) return null;
    return sheet.columns.map((c, i) => ({ ...c, key: saved[i].key, epf: saved[i].epf, socso: saved[i].socso, score: saved[i].key === c.key ? c.score : 1 }));
  } catch {
    return null;
  }
}
function rememberColumns(sheet: PaySheet, cols: PayColumn[]) {
  try {
    localStorage.setItem(layoutKey(sheet), JSON.stringify(cols.map((c) => ({ index: c.index, key: c.key, epf: c.epf, socso: c.socso }))));
  } catch {
    /* private window: the reader still works, the choice is just not remembered */
  }
}

function download(name: string, data: BlobPart, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const FILES: { kind: ContribDownloadKind; label: string; note: string; primary?: boolean }[] = [
  { kind: 'perkeso_txt', label: 'PERKESO file for ASSIST (.txt)', note: 'Upload this in the PERKESO ASSIST portal: SOCSO, EIS and SKBBK together.', primary: true },
  { kind: 'perkeso_xlsm', label: 'PERKESO converter (.xlsm)', note: "The same figures in PERKESO's Excel converter, with its Convert button." },
  { kind: 'check_csv', label: 'Check sheet with EPF (.csv)', note: 'Every person: the wages used, each share and the rule applied.' },
  { kind: 'epf_csv', label: 'EPF list (.csv)', note: 'IC, name, wages and both EPF shares, to key in or check on i-Akaun.' },
];

/** Write one of the files from a kept record (the server's own figures), then tell the server it left Prima. */
async function giveFile(rec: ContribFileRecord, kind: ContribDownloadKind) {
  const rows = rec.rows ?? [];
  const stem = `${rec.period} ${rec.companyId}`;
  if (kind === 'perkeso_txt') download(perkesoTextFileName(rec.employerCode, new Date()), perkesoTextFile(rows, { employerCode: rec.employerCode, mycoid: rec.mycoid, period: rec.period }), 'text/plain');
  else if (kind === 'perkeso_xlsm') download(`SOCSO SKBBK SIP ${stem}.xlsm`, perkesoXlsm(rows, { employerCode: rec.employerCode, period: rec.period }) as BlobPart, 'application/vnd.ms-excel.sheet.macroEnabled.12');
  else if (kind === 'check_csv') download(`Contribution check ${stem}.csv`, contribCheckCsv(rows, rec.period), 'text/csv;charset=utf-8');
  else download(`EPF list ${stem}.csv`, contribEpfCsv(rows, rec.period), 'text/csv;charset=utf-8');
  await api.contributionFileDownloaded(rec.companyId, rec.id, kind);
}

// ---------- New file: Upload, Check, Download ----------

type Edit = Partial<Pick<ContribPerson, 'id' | 'name' | 'nationality' | 'age' | 'skbbkOptOut' | 'include'>>;

function NewFile({ board, handed, onHandedRead }: { board: ContribBoard; handed?: File | null; onHandedRead?: () => void }) {
  const act = useAction();
  const [step, setStep] = useState<Step>('upload');
  const [companyId, setCompanyId] = useState(board.employers[0]?.companyId ?? '');
  const [period, setPeriod] = useState(board.period);
  const [source, setSource] = useState('');
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<PaySheet | null>(null);
  const [cols, setCols] = useState<PayColumn[]>([]);
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [editing, setEditing] = useState<number | null>(null);
  const [show, setShow] = useState<'all' | 'fix' | 'diff'>('all');
  const [showCols, setShowCols] = useState(false);
  const employer = board.employers.find((e) => e.companyId === companyId);
  const [code, setCode] = useState(employer?.socso?.replace(/[^A-Za-z0-9]/g, '') ?? '');
  const [mycoid, setMycoid] = useState('');
  const [saved, setSaved] = useState<{ key: string; rec: ContribFileRecord } | null>(null);
  // The employer's own PERKESO code, as kept in Staff payroll, when the employer changes.
  useEffect(() => setCode(employer?.socso?.replace(/[^A-Za-z0-9]/g, '').toUpperCase() ?? ''), [employer?.socso, companyId]);

  const read: ReadPeople | null = useMemo(() => (sheet ? payPeople({ ...sheet, columns: cols }, period) : null), [sheet, cols, period]);
  const people: ContribPerson[] = useMemo(
    () =>
      (read?.people ?? []).map((p, i) => {
        const e = edits[i] ?? {};
        const base = { ...p, socsoWage: wagesOf(read!.cells[i], cols, 'socso'), epfWage: wagesOf(read!.cells[i], cols, 'epf') };
        const id = e.id != null ? e.id.toUpperCase().replace(/[^A-Z0-9]/g, '') : base.id;
        const ageFromId = e.id != null && e.age == null && /^\d{12}$/.test(id);
        return { ...base, ...e, id, ...(ageFromId ? icAge(id, period) : {}) };
      }),
    [read, edits, cols, period],
  );
  const rows: ContribRow[] = useMemo(() => people.map((p) => contribRow(p, period)), [people, period]);
  const totals = useMemo(() => contribTotals(rows), [rows]);
  const guesses: WageGuess[] = useMemo(() => (read && sheet ? guessWageTicks(read, cols, period).filter((g) => g.matches > g.lawMatches && g.matches >= g.of * 0.6) : []), [read, sheet, cols, period]);
  const fileTotals = useMemo(() => (read ? totalsCheck(read.people, read.totals) : []), [read]);
  const saveKey = JSON.stringify([companyId, period, code.trim().toUpperCase(), mycoid.trim().toUpperCase(), source, people]);

  function load(grids: string[][][], name: string) {
    const s = bestSheet(grids);
    if (!s || s.body.length < 1) throw new Error('No list with rows was found in this file.');
    if (!s.columns.some((c) => c.key === 'name' || c.key === 'id')) throw new Error('No name or IC column was found. Check that the file has a heading row (for example NAMA, NO. K/P, GAJI POKOK).');
    const found = periodIn(s.titles.join(' ')) ?? periodIn(name);
    if (found) setPeriod(found);
    const who = s.titles.map((t) => matchCompany(t, board.employers.map((e) => ({ id: e.companyId, name: e.companyName })))).find(Boolean);
    if (who) setCompanyId(who.id);
    setSheet(s);
    setCols(rememberedColumns(s) ?? s.columns);
    setEdits({});
    setSource(name);
    setSaved(null);
    setStep('check');
  }

  async function readFile(f: File | undefined) {
    if (!f) return;
    if (f.size > board.rule.maxFileBytes) return setError('The file is too big. Keep only the sheet with the salaries, then choose it again.');
    setError(null);
    setBusy('Reading on this device…');
    await new Promise((r) => setTimeout(r, 30));
    try {
      load(await readAnyFile(f, setBusy), f.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  // P129: a file handed over from the toolbar's Upload is read at once.
  useEffect(() => {
    if (!handed) return;
    onHandedRead?.();
    void readFile(handed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handed]);

  function readPaste() {
    setError(null);
    try {
      load([pastedRows(paste)], 'Pasted list');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function setCol(i: number, patch: Partial<PayColumn>) {
    setCols((cur) => {
      const next = cur.map((c) => ({ ...c }));
      const key = patch.key;
      if (key !== undefined) {
        const info = key ? payKeyInfo(key) : null;
        // One column per single meaning: the one it was on before is let go.
        if (key && !info?.many) for (const c of next) if (c.key === key && c.index !== i) Object.assign(c, { key: null, score: 0 });
        Object.assign(next[i], { key, score: 1, epf: info?.epf ?? false, socso: info?.socso ?? false });
      } else Object.assign(next[i], patch);
      if (sheet) rememberColumns(sheet, next);
      return next;
    });
  }

  function useFileWay(g: WageGuess) {
    setCols((cur) => cur.map((c) => (c.key && payKeyInfo(c.key).kind === 'earning' ? { ...c, [g.scheme]: g.ticked.includes(c.index) } : c)));
  }
  function useLawWay() {
    setCols((cur) => cur.map((c) => (c.key && payKeyInfo(c.key).kind === 'earning' ? { ...c, epf: payKeyInfo(c.key).epf ?? false, socso: payKeyInfo(c.key).socso ?? false } : c)));
  }

  async function give(kind: ContribDownloadKind) {
    const needsCode = kind === 'perkeso_txt' || kind === 'perkeso_xlsm';
    if (needsCode && employerCodeProblem(code)) return setError(employerCodeProblem(code));
    setError(null);
    await act.run(async () => {
      let rec = saved?.key === saveKey ? saved.rec : null;
      if (!rec) {
        rec = await api.saveContributionFile({ companyId, period, fileName: source, employerCode: code.trim().toUpperCase(), mycoid: mycoid.trim().toUpperCase(), rows: people });
        setSaved({ key: saveKey, rec });
      }
      await giveFile(rec, kind);
      return rec;
    }, 'Downloaded. The file is kept in Saved files.');
  }

  const stepState = (s: Step): StepState => {
    const order: Step[] = ['upload', 'check', 'download'];
    return order.indexOf(s) < order.indexOf(step) ? 'done' : s === step ? 'now' : 'todo';
  };
  const shown = rows.map((r, i) => ({ r, i })).filter(({ r }) => (show === 'fix' ? r.include && r.problems.length > 0 : show === 'diff' ? r.include && r.diffs.length > 0 : true));

  return (
    <div className="cf-flow">
      <Steps
        steps={[
          { label: 'Upload', state: stepState('upload'), note: source || undefined },
          { label: 'Check', state: stepState('check') },
          { label: 'Download', state: stepState('download') },
        ]}
      />
      {error && <ErrorNotice error={error} />}
      <ErrorNotice error={act.error} />

      {step === 'upload' && (
        <Card title="1. Upload the salary sheet">
          <div className="cf-fields">
            <label className="field">
              <span className="label">Employer</span>
              <Select className="select" aria-label="Employer" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                {board.employers.map((e) => (
                  <option key={e.companyId} value={e.companyId}>
                    {e.companyName}
                  </option>
                ))}
              </Select>
            </label>
            <label className="field">
              <span className="label">Wage month</span>
              <input className="input" type="month" aria-label="Wage month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
            </label>
          </div>
          {!board.employers.length && <div className="notice" data-tone="warn">No employer is open to you here. Staff payroll employers come from your company access.</div>}
          <label className={`imp-drop${busy || !companyId ? ' imp-drop-off' : ''}`}>
            <FileArrowUpIcon size={30} aria-hidden="true" />
            <strong>{busy ?? 'Choose the salary sheet'}</strong>
            <span className="muted small">Any format: Excel (.xlsx, .xls, .xlsm), CSV, Word (.docx), PDF, or text</span>
            <input type="file" accept={ACCEPT} disabled={!!busy || !companyId} onChange={(e) => void readFile(e.target.files?.[0])} />
          </label>
          <label className="field">
            <span className="label">Or paste the rows (with the column names)</span>
            <textarea className="input" rows={4} aria-label="Or paste the rows (with the column names)" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Copy the cells in Excel, then paste here" />
          </label>
          <div className="imp-actions">
            <button className="btn" disabled={!paste.trim() || !companyId} onClick={readPaste}>
              Read the pasted rows
            </button>
          </div>
          <p className="muted small">The file is read on this device. Nothing is sent until you download a file; then the figures are kept with the employer.</p>
        </Card>
      )}

      {step === 'check' && sheet && (
        <>
          <Stats>
            <Stat label="People read" value={totals.people} />
            <Stat label="In the PERKESO file" value={totals.inPerkeso} tone="ok" />
            <Stat label="To fix" value={totals.problems} tone={totals.problems ? 'warn' : 'ok'} onClick={() => setShow('fix')} />
            <Stat label="Differ from the file" value={totals.differences} tone={totals.differences ? 'info' : 'ok'} onClick={() => setShow('diff')} />
          </Stats>
          <Card
            title={`2. Check: ${monthLabel(period)}`}
            sub={employer?.companyName}
            actions={
              <button className="btn btn-ghost" onClick={() => setShowCols((v) => !v)}>
                {showCols ? 'Hide the columns' : 'Columns read from the file'}
              </button>
            }
          >
            {guesses.map((g) => (
              <div key={g.scheme} className="notice" data-tone="info">
                <strong>{g.scheme === 'epf' ? 'Your file counts EPF on:' : 'Your file counts SOCSO, EIS and SKBBK on:'}</strong>{' '}
                {g.ticked.map((i) => cols[i]?.header || payKeyInfo(cols[i]?.key ?? 'basic').label).join(', ') || '-'}
                <div className="muted small">
                  <span>The law counts the columns ticked below. Matches with the file's way:</span> {g.matches}/{g.of} · <span>with the law's way:</span> {g.lawMatches}/{g.of}
                </div>
                <div className="imp-actions">
                  <button className="btn" onClick={() => useFileWay(g)}>
                    Count like the file
                  </button>
                  <button className="btn btn-ghost" onClick={useLawWay}>
                    Count by the law
                  </button>
                </div>
              </div>
            ))}
            {fileTotals.length > 0 && (
              <div className="notice" data-tone="warn">
                <strong>The file's own totals line does not match its rows:</strong>
                <ul>
                  {fileTotals.map((t) => (
                    <li key={t.key}>
                      <span>{t.key === 'gross' ? 'Gross pay' : FIGURE_LABEL[t.key]}</span>: <span>file total</span> {rm(t.file)} · <span>rows read</span> {rm(t.read)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {showCols && <ColumnsTable sheet={sheet} cols={cols} onChange={setCol} />}
            <div className="tabbar" role="tablist" aria-label="Show">
              <button role="tab" aria-selected={show === 'all'} onClick={() => setShow('all')}>
                Everyone
              </button>
              <button role="tab" aria-selected={show === 'fix'} onClick={() => setShow('fix')}>
                To fix
              </button>
              <button role="tab" aria-selected={show === 'diff'} onClick={() => setShow('diff')}>
                Differ from the file
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th className="num">Wages for SOCSO</th>
                    <th className="num">SOCSO employer</th>
                    <th className="num">SOCSO employee</th>
                    <th className="num">EIS employer</th>
                    <th className="num">EIS employee</th>
                    <th className="num">SKBBK employee</th>
                    <th className="num">Wages for EPF</th>
                    <th className="num">EPF employer</th>
                    <th className="num">EPF employee</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, SHOW_ROWS).map(({ r, i }) => (
                    <PersonRow key={i} r={r} editing={editing === i} onEdit={() => setEditing(editing === i ? null : i)} onChange={(e) => setEdits((cur) => ({ ...cur, [i]: { ...cur[i], ...e } }))} />
                  ))}
                  {!shown.length && (
                    <tr>
                      <td colSpan={11} className="muted">
                        Nothing to show here.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <th>Total</th>
                    <th className="num">{rm(totals.socsoWage)}</th>
                    <th className="num">{rm(totals.socsoEr)}</th>
                    <th className="num">{rm(totals.socsoEe)}</th>
                    <th className="num">{rm(totals.eisEr)}</th>
                    <th className="num">{rm(totals.eisEe)}</th>
                    <th className="num">{rm(totals.skbbk)}</th>
                    <th className="num">{rm(totals.epfWage)}</th>
                    <th className="num">{rm(totals.epfEr)}</th>
                    <th className="num">{rm(totals.epfEe)}</th>
                    <th />
                  </tr>
                </tfoot>
              </table>
            </div>
            {shown.length > SHOW_ROWS && <p className="muted small">Showing the first {SHOW_ROWS}. Every person is in the files.</p>}
            {read && read.problems.map((p) => <div key={p.row} className="notice" data-tone="warn">{p.message}</div>)}
            <p className="muted small">
              Worked with Prima's statutory tables for the month: SOCSO and EIS by PERKESO's wage bands (ceiling RM6,000), SKBBK (LINDUNG 24 Jam) for the employee, EPF by the Third Schedule. The server counts again when the file is kept.
            </p>
            <div className="imp-actions">
              <button className="btn btn-ghost" onClick={() => setStep('upload')}>
                Back
              </button>
              <button className="btn btn-primary" disabled={!totals.inPerkeso && !totals.epfWage} onClick={() => setStep('download')}>
                Next: download
              </button>
            </div>
          </Card>
        </>
      )}

      {step === 'download' && (
        <Card title="3. Download and submit" sub={`${employer?.companyName ?? ''} · ${monthLabel(period)}`}>
          <div className="cf-fields">
            <label className="field">
              <span className="label">PERKESO employer code</span>
              <input className="input" aria-label="PERKESO employer code" maxLength={12} value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="12 letters and digits" />
              {code && employerCodeProblem(code) && <span className="muted small">{employerCodeProblem(code)}</span>}
            </label>
            <label className="field">
              <span className="label">MyCoID / SSM number (optional)</span>
              <input className="input" aria-label="MyCoID / SSM number (optional)" maxLength={20} value={mycoid} onChange={(e) => setMycoid(e.target.value.toUpperCase())} />
            </label>
          </div>
          {!employer?.socso && <p className="muted small">Set the employer's PERKESO code once in Staff payroll, EPF and SOCSO tables, and it is filled in here.</p>}
          <Stats>
            <Stat label="In the PERKESO file" value={totals.inPerkeso} />
            <Stat label="SOCSO (both shares)" value={rm(totals.socsoEr + totals.socsoEe)} />
            <Stat label="EIS (both shares)" value={rm(totals.eisEr + totals.eisEe)} />
            <Stat label="SKBBK" value={rm(totals.skbbk)} />
            <Stat label="EPF (both shares)" value={rm(totals.epfEr + totals.epfEe)} />
          </Stats>
          {totals.problems > 0 && (
            <div className="notice" data-tone="warn">
              <WarningCircleIcon size={16} aria-hidden="true" /> <span>Some people still have something to fix. People with no IC or SOCSO number are left out of the PERKESO file.</span>
            </div>
          )}
          <div className="cf-files">
            {FILES.map((f) => (
              <div key={f.kind} className="cf-file">
                <button className={`btn${f.primary ? ' btn-primary' : ''}`} disabled={act.busy} onClick={() => void give(f.kind)}>
                  <DownloadSimpleIcon size={16} aria-hidden="true" /> {f.label}
                </button>
                <span className="muted small">{f.note}</span>
              </div>
            ))}
          </div>
          {saved && (
            <div className="notice" data-tone="ok">
              <CheckCircleIcon size={16} aria-hidden="true" /> <span>Kept in Saved files. You can download it again there.</span>
            </div>
          )}
          <div className="imp-actions">
            <button className="btn btn-ghost" onClick={() => setStep('check')}>
              Back
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}

function icAge(id: string, period: string): Pick<ContribPerson, 'age' | 'ageFrom' | 'nationality'> {
  const yy = Number(id.slice(0, 2));
  const [y] = period.split('-').map(Number);
  const born = new Date(Date.UTC((yy > y % 100 ? 1900 : 2000) + yy, Number(id.slice(2, 4)) - 1, Number(id.slice(4, 6))));
  const on = new Date(`${period}-01T00:00:00Z`);
  let age = on.getUTCFullYear() - born.getUTCFullYear();
  if (on.getUTCMonth() < born.getUTCMonth() || (on.getUTCMonth() === born.getUTCMonth() && on.getUTCDate() < born.getUTCDate())) age--;
  return { age: Number.isFinite(age) ? age : null, ageFrom: 'ic', nationality: 'MY' };
}

function ColumnsTable({ sheet, cols, onChange }: { sheet: PaySheet; cols: PayColumn[]; onChange: (i: number, patch: Partial<PayColumn>) => void }) {
  const sample = (i: number) => sheet.body.map((r) => r[i] ?? '').find((v) => v && v !== '-') ?? '';
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Column in the file</th>
            <th>Meaning</th>
            <th>Counts for EPF</th>
            <th>Counts for SOCSO</th>
            <th>Example</th>
          </tr>
        </thead>
        <tbody>
          {cols.map((c, i) => {
            const earning = !!c.key && payKeyInfo(c.key).kind === 'earning';
            return (
              <tr key={i}>
                <td>{c.header || <span className="muted">(no heading)</span>}</td>
                <td>
                  <Select className="select" aria-label="Meaning" value={c.key ?? ''} onChange={(e) => onChange(i, { key: (e.target.value || null) as PayKey | null })}>
                    <option value="">Not used</option>
                    {PAY_KEYS.map((k) => (
                      <option key={k.key} value={k.key}>
                        {k.label}
                      </option>
                    ))}
                  </Select>
                  {c.key && c.score < 0.85 && <Chip tone="warn">Check this</Chip>}
                </td>
                <td>{earning ? <input type="checkbox" aria-label="Counts for EPF" checked={c.epf} onChange={(e) => onChange(i, { epf: e.target.checked })} /> : null}</td>
                <td>{earning ? <input type="checkbox" aria-label="Counts for SOCSO" checked={c.socso} onChange={(e) => onChange(i, { socso: e.target.checked })} /> : null}</td>
                <td className="muted small" data-no-translate>
                  {sample(i).slice(0, 30)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PersonRow({ r, editing, onEdit, onChange }: { r: ContribRow; editing: boolean; onEdit: () => void; onChange: (e: Edit) => void }) {
  const tone = !r.include ? 'neutral' : r.problems.length ? 'warn' : r.diffs.length ? 'info' : 'ok';
  const label = !r.include ? 'Left out' : r.problems.length ? 'To fix' : r.diffs.length ? 'Differs' : 'OK';
  const money = (v: number) => (r.include ? rm(v) : '-');
  return (
    <>
      <tr className={r.include ? undefined : 'muted'}>
        <td>
          <strong data-no-translate>{r.name || '-'}</strong>
          <div className="muted small">
            <span data-no-translate>{r.id || '-'}</span> · <span>{r.nationality === 'MY' ? 'Malaysian' : 'Foreign'}</span>
            {r.age != null && (
              <>
                {' '}
                · <span>Age</span> {r.age}
              </>
            )}
            {r.include && r.socsoWage > 0 && (
              <>
                {' '}
                · <span>{r.category === 1 ? 'SOCSO First Category' : 'SOCSO Second Category'}</span>
              </>
            )}
          </div>
        </td>
        <td className="num">{money(r.socsoWage)}</td>
        <td className="num">{money(r.socsoEr)}</td>
        <td className="num">{money(r.socsoEe)}</td>
        <td className="num">{money(r.eisEr)}</td>
        <td className="num">{money(r.eisEe)}</td>
        <td className="num">{money(r.skbbk)}</td>
        <td className="num">{money(r.epfWage)}</td>
        <td className="num">{money(r.epfEr)}</td>
        <td className="num">{money(r.epfEe)}</td>
        <td>
          <Chip tone={tone}>{label}</Chip>{' '}
          <button className="btn btn-ghost btn-sm" onClick={onEdit}>
            {editing ? 'Close' : 'Change'}
          </button>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={11}>
            <div className="cf-edit">
              <label className="field">
                <span className="label">IC or SOCSO number</span>
                <input className="input" aria-label="IC or SOCSO number" defaultValue={r.id} onBlur={(e) => onChange({ id: e.target.value })} />
              </label>
              <label className="field">
                <span className="label">Name</span>
                <input className="input" aria-label="Name" defaultValue={r.name} onBlur={(e) => onChange({ name: e.target.value })} />
              </label>
              <label className="field">
                <span className="label">Nationality</span>
                <Select className="select" aria-label="Nationality" value={r.nationality} onChange={(e) => onChange({ nationality: e.target.value === 'FOREIGN' ? 'FOREIGN' : 'MY' })}>
                  <option value="MY">Malaysian (or permanent resident)</option>
                  <option value="FOREIGN">Foreign worker</option>
                </Select>
              </label>
              <label className="field">
                <span className="label">Age on the 1st of the month</span>
                <input className="input" type="number" min={14} max={99} aria-label="Age on the 1st of the month" defaultValue={r.age ?? ''} onBlur={(e) => onChange({ age: e.target.value ? Math.floor(Number(e.target.value)) : null })} />
              </label>
              <label className="cf-check">
                <input type="checkbox" checked={r.skbbkOptOut} disabled={r.nationality !== 'MY'} onChange={(e) => onChange({ skbbkOptOut: e.target.checked })} /> <span>Opted out of SKBBK (LINDUNG 24 Jam form on file)</span>
              </label>
              <label className="cf-check">
                <input type="checkbox" checked={r.include} onChange={(e) => onChange({ include: e.target.checked })} /> <span>In the files</span>
              </label>
            </div>
            <ul className="cf-why small">
              {r.rules.map((x) => (
                <li key={x}>{x}</li>
              ))}
              {r.problems.map((x) => (
                <li key={x} className="cf-bad">
                  {x}
                </li>
              ))}
              {r.diffs.map((d) => (
                <li key={d.key}>
                  <span>{FIGURE_LABEL[d.key]}</span>: <span>file</span> {rm(d.file)} · <span>Prima</span> {rm(d.prima)}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------- Saved files ----------

function Records({ board }: { board: ContribBoard }) {
  const act = useAction();
  if (!board.records.length)
    return (
      <Empty title="No contribution files yet">
        Upload a salary sheet in New file. Each file you download is kept here, so you can download it again.
      </Empty>
    );
  const again = (r: (typeof board.records)[number], kind: ContribDownloadKind) =>
    act.run(async () => {
      const rec = await api.contributionFile(r.companyId, r.id);
      if (!rec.rows) throw new Error('This older file keeps its totals only. Upload the salary sheet again to make its files.');
      if ((kind === 'perkeso_txt' || kind === 'perkeso_xlsm') && employerCodeProblem(rec.employerCode)) throw new Error('This file was kept without the PERKESO employer code. Upload the salary sheet again and give the code.');
      await giveFile(rec, kind);
    }, 'Downloaded.');
  return (
    <Card title="Saved files" flush>
      <ErrorNotice error={act.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Wage month</th>
              <th>Employer</th>
              <th>From the file</th>
              <th>Kept by</th>
              <th className="num">People</th>
              <th className="num">SOCSO, EIS and SKBBK</th>
              <th className="num">EPF</th>
              <th>Status</th>
              <th>Download again</th>
            </tr>
          </thead>
          <tbody>
            {board.records.map((r) => (
              <tr key={r.id}>
                <td>{monthLabel(r.period)}</td>
                <td>{r.companyName}</td>
                <td className="small" data-no-translate>
                  {r.fileName}
                </td>
                <td className="small">
                  <span data-no-translate>{r.by}</span>
                  <div className="muted">{dateTimeLabel(r.at)}</div>
                </td>
                <td className="num">
                  {r.totals.inPerkeso}/{r.totals.people}
                </td>
                <td className="num">{rm(r.totals.socsoEr + r.totals.socsoEe + r.totals.eisEr + r.totals.eisEe + r.totals.skbbk)}</td>
                <td className="num">{rm(r.totals.epfEr + r.totals.epfEe)}</td>
                <td>
                  <Chip tone={r.status === 'downloaded' ? 'ok' : 'info'}>{r.status === 'downloaded' ? 'Downloaded' : 'Checked'}</Chip>
                </td>
                <td>
                  {r.rowsKept ? (
                    <div className="cf-again">
                      {FILES.map((f) => (
                        <button key={f.kind} className="btn btn-ghost btn-sm" disabled={act.busy} onClick={() => void again(r, f.kind)}>
                          {f.kind === 'perkeso_txt' ? '.txt' : f.kind === 'perkeso_xlsm' ? '.xlsm' : f.kind === 'check_csv' ? 'Check' : 'EPF'}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="muted small">Totals only</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

