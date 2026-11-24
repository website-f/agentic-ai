import { useEffect, useMemo, useState, type RefObject } from 'react';
import { FileArrowUpIcon } from '@phosphor-icons/react';
import {
  RECORD_KINDS,
  SCREEN_TOOLS,
  importSpec,
  isTableFile,
  pastedRows,
  rankImportKinds,
  screenImportKinds,
  type ImportKind,
  type KindFit,
  type XlsxSheet,
} from '@prima/core';
import { api } from '../api';
import { Chip, Drawer, ErrorNotice, Loading } from '../ui';
import { DataTable, type DtColumn } from '../DataTable';
import { onUploadersChange, screenUploaders, type UploadHandler } from '../upload-handlers';
import { ArchiveUpload } from './Archive';
import { ImportDrawer, sheetsOf, type ImportStart } from './ImportDrawer';
import { useRecordKinds } from './RecordForm';
import '../styles/import.css';

/**
 * Upload on every screen (Fitri, 24 Nov 2026: "in all prima pages there's upload, key in and download, but got this
 * error 'The file manager is not installed in this database yet.' ... for upload make sure it is the same as import").
 *
 * One flow: the person picks any file (or pastes rows). A table (Excel .xlsx/.xls, CSV, text, Word table, PDF list) is
 * read here on the device; the screen's own records are scored against its columns (core screen-upload.ts) and the best
 * fit is proposed. The person may pick another. The rows then go through the screen's own Import (ImportDrawer): the
 * columns are matched and checked, every row is checked by the server through the record's own save, the rows are
 * sorted, searched, fixed or left out, and the chosen rows are saved all or none with a receipt and an audit entry.
 * Who may write each record stays the server's rule.
 *
 * A file that is not a table (a scan, a photo, a zip) or holds none of this screen's records is kept as a file in
 * "Old files and data" when the file manager is installed here. When it is not, the person is told plainly what that
 * needs and what can be done now, never the raw "not installed" error.
 */

const MAX_TABLE_BYTES = 8_000_000;

type Step = 'pick' | 'reading' | 'choose' | 'file';
type Archive = { state: 'loading' } | { state: 'ready' } | { state: 'off'; why: 'notInstalled' | 'noStorage' | 'noUnit' } | { state: 'error'; message: string };

const isRecordKind = (k: ImportKind) => Object.prototype.hasOwnProperty.call(RECORD_KINDS, k);
const FIT: Record<KindFit['level'], [string, 'ok' | 'info' | 'warn' | 'neutral']> = {
  good: ['Good fit', 'ok'],
  maybe: ['Possible fit', 'info'],
  poor: ['Does not fit', 'neutral'],
};

/** P129: the screen's own importers (guard pay lines, a salary sheet), kept up to date while the drawer is open. */
function useUploaders(screen: string): UploadHandler[] {
  const [list, setList] = useState(() => screenUploaders(screen));
  useEffect(() => onUploadersChange(() => setList(screenUploaders(screen))), [screen]);
  return list;
}

/** Whether the file manager can keep files here: read from the server's own answer, never assumed. */
function useArchiveState(): Archive {
  const [s, setS] = useState<Archive>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    api.archive({ status: 'mine', page: 0 }).then(
      (d) => live && setS(!d.installed ? { state: 'off', why: 'notInstalled' } : !d.storage ? { state: 'off', why: 'noStorage' } : !d.owners.length ? { state: 'off', why: 'noUnit' } : { state: 'ready' }),
      (e: unknown) => {
        if (!live) return;
        const message = e instanceof Error ? e.message : String(e);
        // A server that refuses the list because the module is missing says so in words; that is "not installed" too.
        setS(/not installed/i.test(message) ? { state: 'off', why: 'notInstalled' } : { state: 'error', message });
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return s;
}

/** Import or Upload buttons on the open tab itself (guard pay lines, attendance reports, item lists have their own). */
function tabImports(root: HTMLElement | null): HTMLButtonElement[] {
  const seen = new Set<string>();
  return [...(root?.querySelectorAll('button') ?? [])].filter((b) => {
    if (b.closest('[data-screen-tools], .drawer, .scrim, [role=dialog], [role=menu]') || b.disabled || !b.getClientRects().length) return false;
    const text = (b.innerText ?? b.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!/^(import|upload|muat naik|load )/i.test(text) || seen.has(text)) return false;
    seen.add(text);
    return true;
  });
}

export default function ScreenUpload({
  screen,
  title,
  contentRef,
  onKeyIn,
  onClose,
}: {
  screen: string;
  title: string;
  contentRef: RefObject<HTMLDivElement>;
  /** Opens the toolbar's Key in for this screen. */
  onKeyIn: () => void;
  onClose: () => void;
}) {
  const tools = SCREEN_TOOLS[screen];
  const recordKinds = useRecordKinds();
  const archive = useArchiveState();
  const uploaders = useUploaders(screen);
  const usable = uploaders.filter((u) => !u.unavailable);
  const [step, setStep] = useState<Step>('pick');
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [table, setTable] = useState<{ name: string; sheets: XlsxSheet[] } | null>(null);
  /** Why the file was not read as rows, in plain words (a scan, a picture, an older format). */
  const [notRows, setNotRows] = useState<string | null>(null);
  const [chosen, setChosen] = useState<ImportKind | null>(null);
  const [importing, setImporting] = useState<ImportStart | null>(null);
  const [paste, setPaste] = useState('');
  const [dragging, setDragging] = useState(false);

  // The records this person may load here: record forms only for their keepers (as the Add and Import buttons); the
  // screen's other import kinds are offered and the server checks every row.
  const kinds = useMemo(() => screenImportKinds(screen).filter((k) => !isRecordKind(k) || recordKinds.has(k as never)), [screen, recordKinds]);
  const ranked = useMemo(() => (table ? rankImportKinds(table.sheets, kinds) : []), [table, kinds]);
  const own = step === 'pick' ? tabImports(contentRef.current) : [];

  function rowsRead(name: string, sheets: XlsxSheet[]) {
    setTable({ name, sheets });
    const best = rankImportKinds(sheets, kinds)[0];
    setChosen(best && best.level !== 'poor' ? best.kind : null);
    setStep(kinds.length || usable.length ? 'choose' : 'file');
  }

  /** Hands the file to the screen's own import and closes this drawer. */
  function giveOwn(u: UploadHandler, f?: File | null) {
    onClose();
    u.open(f ?? undefined);
  }

  async function take(f: File | undefined) {
    if (!f) return;
    // P129: a screen whose records load through its own import (Guard pay, Staff payroll) takes the file there at once.
    if (!kinds.length && usable.length === 1 && isTableFile(f.name)) return giveOwn(usable[0], f);
    setError(null);
    setFile(f);
    setTable(null);
    setNotRows(null);
    setChosen(null);
    if (!isTableFile(f.name)) {
      setNotRows('This is not a table Prima can read as rows (a scan, a photo, a zip or the like).');
      return setStep('file');
    }
    if (f.size > MAX_TABLE_BYTES) {
      setNotRows('The file is too big to read as rows here. Keep only the sheet you need, up to 500 rows, to load it into records.');
      return setStep('file');
    }
    setStep('reading');
    try {
      const sheets = (await sheetsOf(f)).filter((s) => s.rows.filter((r) => r.some((c) => String(c ?? '').trim())).length >= 2);
      if (!sheets.length) throw new Error('No list with rows was found in this file.');
      rowsRead(f.name, sheets);
    } catch (e) {
      // A scanned PDF, an older format or a broken file: not rows, but it may still be kept as a file.
      setNotRows(e instanceof Error ? e.message : String(e));
      setStep('file');
    }
  }

  function takePaste() {
    setError(null);
    const rows = pastedRows(paste);
    if (rows.length < 2) return setError('Paste the column names and at least one row under them.');
    setFile(null);
    setNotRows(null);
    rowsRead('Pasted rows', [{ name: 'Pasted rows', rows }]);
  }

  // The import itself: the screen's own Import drawer, started at the column check with the rows already read.
  if (importing && chosen)
    return (
      <ImportDrawer
        kind={chosen}
        companyId={null}
        initial={importing}
        onBack={() => {
          setImporting(null);
          setStep('choose');
        }}
        onClose={onClose}
      />
    );

  const fit = ranked.find((r) => r.kind === chosen) ?? null;
  const keepAsFile = archive.state === 'ready' && !!file;

  return (
    <Drawer title={title} onClose={onClose}>
      <div className="imp-step up-flow">
        {error && <ErrorNotice error={error} />}

        {step === 'pick' && (
          <>
            <p className="muted small">
              {uploaders.length && !kinds.length
                ? 'Choose the file. It goes straight into this screen’s own import: the columns are matched and every row is checked before anything is saved.'
                : kinds.length
                ? 'Choose any file. A list (Excel, CSV, a table in Word or PDF) is read on this device and matched to the records of this screen: you check the columns, sort and check every row, then save. Nothing is saved until you press Import.'
                : 'Choose any file. This screen keeps no records that load from a list, so a file is kept as a file in "Old files and data" where the file manager is switched on.'}
            </p>
            {kinds.length > 0 && (
              <p className="muted small">
                {`Records of this screen: ${kinds.map((k) => importSpec(k).label).join(', ')}.`}
              </p>
            )}
            {uploaders.length > 0 && <OwnImports uploaders={uploaders} onUse={(u) => giveOwn(u, file)} />}
            {!kinds.length && !usable.length && archive.state === 'off' && (
              <>
                <OffNotice why={archive.why} rowsHere={false} />
                <div className="imp-actions">
                  <button className="btn btn-primary" onClick={onKeyIn}>
                    Key in
                  </button>
                </div>
              </>
            )}
            {(kinds.length > 0 || usable.length > 0 || archive.state !== 'off') && (
              <label
                className={`imp-drop${dragging ? ' imp-drop-on' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  void take(e.dataTransfer.files?.[0]);
                }}
              >
                <FileArrowUpIcon size={30} aria-hidden="true" />
                <strong>Drop the file here, or choose it</strong>
                <span className="muted small">Excel (.xlsx or .xls), CSV, Word (.docx) or PDF lists are read into records; any other file can be kept as a file</span>
                <input
                  type="file"
                  aria-label="File to upload"
                  onChange={(e) => {
                    void take(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
            )}
            {kinds.length > 0 && (
              <details className="imp-more">
                <summary>Or paste rows copied from Excel or a table</summary>
                <textarea
                  className="input"
                  rows={6}
                  aria-label="Rows to paste"
                  placeholder="Column names on the first line, then one row per line"
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                />
                <div className="imp-actions">
                  <button className="btn btn-sm" disabled={!paste.trim()} onClick={takePaste}>
                    Read the pasted rows
                  </button>
                </div>
              </details>
            )}
            {own.length > 0 && (
              <div>
                <h3 className="small">This tab&apos;s own import</h3>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {own.map((b, i) => (
                    <button
                      key={i}
                      className="btn btn-sm"
                      onClick={() => {
                        onClose();
                        b.scrollIntoView({ block: 'center' });
                        b.click();
                      }}
                    >
                      {(b.innerText ?? '').trim()}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!kinds.length && tools?.readOnly && (
              <p className="small muted" role="status">
                {tools.readOnly}
              </p>
            )}
          </>
        )}

        {step === 'reading' && <Loading what="the file" />}

        {step === 'choose' && table && (
          <>
            <p className="small">
              <strong>{table.name}</strong>
              {table.sheets.length > 1 && <span className="muted">{` · ${table.sheets.length} sheets`}</span>}
            </p>
            {usable.length > 0 && <OwnImports uploaders={usable} onUse={(u) => giveOwn(u, file)} withFile={!!file} />}
            {kinds.length > 0 && (
            <fieldset className="up-kinds">
              <legend className="small">Which records does it hold?</legend>
              {ranked.map((r) => (
                <label key={r.kind} className="up-kind" data-on={chosen === r.kind || undefined}>
                  <input type="radio" name="up-kind" checked={chosen === r.kind} onChange={() => setChosen(r.kind)} />
                  <span className="up-kind-body">
                    <span className="up-kind-head">
                      <strong>{r.label}</strong>
                      <Chip tone={FIT[r.level][1]}>{FIT[r.level][0]}</Chip>
                      {r.rows > 0 && <span className="muted small">{`${r.rows} row${r.rows === 1 ? '' : 's'}`}</span>}
                      {r.rows > 0 && table.sheets.length > 1 && <span className="muted small" data-no-translate="">{table.sheets[r.sheet]?.name ?? ''}</span>}
                    </span>
                    {r.found.length > 0 && <span className="muted small">{`Columns found: ${listOf(r.found, 6)}`}</span>}
                    {r.missing.length > 0 && r.level !== 'poor' && <span className="muted small">{`Needed but not found: ${listOf(r.missing, 4)}. You can match or fill them on the next steps.`}</span>}
                  </span>
                </label>
              ))}
            </fieldset>
            )}
            {kinds.length > 0 && !ranked.some((r) => r.level !== 'poor') && (
              <p className="notice" data-tone="warn">
                None of this screen&apos;s records matches the columns of this file. Pick the record yourself to match the columns by hand, or keep the file as a file.
              </p>
            )}
            {fit?.level === 'poor' && <p className="muted small">Few columns match. You will match them by hand on the next step.</p>}
            <div className="imp-actions imp-sticky">
              <button className="btn" onClick={() => setStep('pick')}>
                Back
              </button>
              {file && (
                <button className="btn" onClick={() => setStep('file')}>
                  Keep it as a file instead
                </button>
              )}
              {kinds.length > 0 && <button className="btn btn-primary" disabled={!chosen} onClick={() => chosen && setImporting({ fileName: table.name, sheets: table.sheets, sheet: fit?.sheet })}>
                Check the columns
              </button>}
            </div>
          </>
        )}

        {step === 'file' && (
          <>
            {file && (
              <p className="small">
                <strong>{file.name}</strong>
              </p>
            )}
            {notRows && <p className="muted small">{notRows}</p>}
            {table && <TablePreview sheets={table.sheets} />}
            {archive.state === 'loading' && <Loading what="the file manager" />}
            {archive.state === 'error' && <ErrorNotice error={archive.message} />}
            {keepAsFile && (
              <>
                <p className="muted small">
                  The file is kept in &quot;Old files and data&quot; for your unit. Only your unit, you and the group leaders can open it; staff and pay files are more
                  restricted. A photo or paper for one record (a claim receipt, say) is attached on that record&apos;s own form.
                </p>
                <ArchiveUpload folder={tools?.folder ?? 'other'} files={file ? [file] : undefined} />
              </>
            )}
            {archive.state === 'ready' && !file && (
              <p className="muted small">Choose the file itself (not pasted rows) to keep it as a file.</p>
            )}
            {archive.state === 'off' && <OffNotice why={archive.why} rowsHere={kinds.length > 0} />}
            <div className="imp-actions">
              <button className="btn" onClick={() => setStep(table && kinds.length ? 'choose' : 'pick')}>
                Back
              </button>
              {table && kinds.length > 0 && step === 'file' && archive.state !== 'ready' && (
                <button className="btn" onClick={() => setStep('choose')}>
                  Pick the record yourself
                </button>
              )}
              {archive.state !== 'ready' && (
                <button className="btn btn-primary" onClick={onKeyIn}>
                  Key in
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}

/** P129: the screen's own importers, each with what happens next, or why it cannot be used now. */
function OwnImports({ uploaders, onUse, withFile }: { uploaders: UploadHandler[]; onUse: (u: UploadHandler) => void; withFile?: boolean }) {
  return (
    <div className="up-own">
      <h3 className="small">Load it into this screen</h3>
      {uploaders.map((u) => (
        <div key={u.key} className="up-own-card" data-off={u.unavailable ? '' : undefined}>
          <div className="up-own-body">
            <strong>{u.label}</strong>
            <span className="muted small">{u.unavailable ?? u.detail}</span>
          </div>
          {!u.unavailable && (
            <button className="btn btn-primary btn-sm" onClick={() => onUse(u)}>
              {withFile ? 'Use this file' : 'Open'}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

type PreviewRow = { n: number; cells: string[] };

/**
 * P129 (Fitri: "check all the columns ... can sort it and then save it"): a list that holds none of this screen's
 * records is shown before it is kept as old data: its columns as the file names them, every row sortable and
 * searchable, so the person checks it is the right file. It is then kept whole in "Old files and data", where its words
 * are searchable.
 */
function TablePreview({ sheets }: { sheets: XlsxSheet[] }) {
  const [at, setAt] = useState(0);
  const sheet = sheets[Math.min(at, sheets.length - 1)];
  const rows = (sheet?.rows ?? []).filter((r) => r.some((c) => String(c ?? '').trim()));
  const header = (rows[0] ?? []).map((c, i) => String(c ?? '').trim() || `Column ${i + 1}`);
  const width = Math.min(30, Math.max(header.length, ...rows.slice(1, 200).map((r) => r.length)));
  const body: PreviewRow[] = rows.slice(1, 1001).map((r, i) => ({ n: i + 2, cells: Array.from({ length: width }, (_, c) => String(r[c] ?? '').trim()) }));
  const money = (v: string) => v.replace(/^RM\s*/i, '').replace(/,/g, '');
  const num = (c: number) => {
    const filled = body.filter((r) => r.cells[c]);
    return filled.length > 0 && filled.every((r) => /^-?\d*\.?\d+$/.test(money(r.cells[c])));
  };
  const numeric = Array.from({ length: width }, (_, c) => num(c));
  const columns: DtColumn<PreviewRow>[] = Array.from({ length: width }, (_, c) => ({
    id: `c${c}`,
    label: header[c] ?? `Column ${c + 1}`,
    value: (r: PreviewRow) => (numeric[c] ? Number(money(r.cells[c])) || 0 : r.cells[c]),
    render: (r: PreviewRow) => r.cells[c],
    sort: numeric[c] ? 'number' : 'text',
    align: numeric[c] ? 'right' : 'left',
  }));
  if (!body.length) return null;
  return (
    <div className="up-preview">
      <p className="small">
        <strong>What the file holds</strong>
        <span className="muted">{` · ${body.length}${rows.length - 1 > body.length ? ` of ${rows.length - 1}` : ''} rows · ${width} columns. Sort or search to check it before keeping it.`}</span>
      </p>
      {sheets.length > 1 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {sheets.map((sh, i) => (
            <button key={i} className={`btn btn-sm${i === at ? ' btn-primary' : ''}`} onClick={() => setAt(i)} data-no-translate="">
              {sh.name || `Sheet ${i + 1}`}
            </button>
          ))}
        </div>
      )}
      <DataTable label="Rows of the file" rows={body} rowKey={(r) => String(r.n)} columns={columns} searchText={(r) => r.cells.join(' ')} />
    </div>
  );
}

/** "A, B, C and 2 more". */
function listOf(xs: string[], max: number): string {
  return xs.slice(0, max).join(', ') + (xs.length > max ? ` and ${xs.length - max} more` : '');
}

/** Files cannot be kept as files here: why, in plain words, and what can be done now. Never the raw server error. */
function OffNotice({ why, rowsHere }: { why: 'notInstalled' | 'noStorage' | 'noUnit'; rowsHere: boolean }) {
  return (
    <div className="notice" data-tone="warn" role="status">
      <p className="small">
        {why === 'notInstalled'
          ? 'Keeping a file as a file (a scan, a photo, a zip) needs the file manager, which an administrator has not switched on here yet. Ask your administrator to switch it on.'
          : why === 'noStorage'
            ? 'Keeping a file as a file needs file storage, which an administrator has not switched on here yet.'
            : 'You have no unit to keep files for, so the file cannot be kept as a file.'}
      </p>
      <p className="small">What you can do now:</p>
      <ul className="small">
        {rowsHere && <li>Upload the same records as an Excel, CSV, Word or PDF list: they are read into records, no file manager needed.</li>}
        <li>Key in the record on this screen&apos;s own form.</li>
      </ul>
    </div>
  );
}
