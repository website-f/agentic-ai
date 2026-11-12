// K8 / N1 (Fauzan, 11 Nov 2026: "Do also AI data manager and file manager, so it sends to correct places when bulk
// data are loaded"): one screen for bulk loads.
//  - Spreadsheet: the file is read on this device; Prima proposes which record it belongs to and the field of every
//    column (core bulk-manager.ts, built on the P90 matcher), holds the columns it is unsure of, and flags rows that look
//    wrong or repeated. The person confirms; then the record's own import checks every row and saves (the module
//    owner), or for staff data HR sends it to the staff directory and the HR Director or the CEO approves it.
//  - Many files: certificates, permits, contracts, photos. Prima proposes the document type and whose HR file each goes
//    on (from file names only, matched on the server against the people this person keeps files for). Unsure files
//    are held. Each confirmed file is filed through the HR file's own permission check.
//  - Load records: who loaded, the plan, who confirmed or approved, what went where.
// The AI part (Arisha on Azure OpenAI) is switched off; with it on, it sees masked headings, value shapes and masked
// file names only. Everything here works without it.
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircleIcon, ClockCounterClockwiseIcon, FilesIcon, FileArrowUpIcon, SparkleIcon, TableIcon, WarningIcon } from '@phosphor-icons/react';
import {
  STAFF_DIRECTORY_KIND,
  cleanGrid,
  flagRows,
  pickSheet,
  planColumns,
  prepareSheet,
  rankDestinations,
  staffDirectoryCsv,
  valueShape,
  type BulkColumnPlan,
  type BulkDocType,
  type BulkTarget,
  type DestinationGuess,
  type ImportKind,
  type OrgImportReceipt,
  type SmartLevel,
  type StaffDirectoryPreview,
} from '@prima/core';
import { api, ApiError } from '../api';
import type { BulkBoard, BulkLoadRow, BulkPlacements } from '../api/bulk';
import { Select } from '../SearchSelect';
import { Card, Empty, PageHead, Stat, Stats, Steps, type StepState } from '../kit';
import { Chip, ErrorNotice, Loading, RefreshContext, dateTimeLabel, useLoad } from '../ui';
import { ImportDrawer, sheetsOf } from './ImportDrawer';
import { useLang, type Lang } from '../i18n';
import '../styles/bulk.css';

const MAX_SHEET_FILE = 8_000_000;
const MAX_DOC = 690_000;
const LEVEL: Record<SmartLevel, [string, 'ok' | 'info' | 'warn']> = { sure: ['Sure', 'ok'], likely: ['Likely', 'info'], check: ['Check this', 'warn'] };
/** A sentence with numbers or names in it, in the person's language (the screen's translator matches whole sentences only). */
const say = (lang: Lang, en: string, ms: string, mix?: string) => (lang === 'en' ? en : lang === 'mix' ? (mix ?? ms) : ms);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** The matcher's plain-words reasons (core bulk-manager.ts) in Bahasa Melayu for the screen; the record keeps the English. */
const WHY_MS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^(.+) is empty\.$/, (m) => `${m[1]} kosong.`],
  [/^(.+) is not a date Prima can read\.$/, (m) => `${m[1]} bukan tarikh yang boleh dibaca oleh Prima.`],
  [/^(.+) is not a number\.$/, (m) => `${m[1]} bukan nombor.`],
  [/^(.+) is not an email address\.$/, (m) => `${m[1]} bukan alamat emel.`],
  [/^(.+) is not a 12-digit IC number\.$/, (m) => `${m[1]} bukan nombor KP 12 digit.`],
  [/^(.+) is not one of the choices\.$/, (m) => `${m[1]} bukan salah satu pilihan.`],
  [/^Same as row (\d+)\.$/, (m) => `Sama seperti baris ${m[1]}.`],
  [/^(.+) repeats row (\d+)\.$/, (m) => `${m[1]} mengulangi baris ${m[2]}.`],
  [/^The file name says "(.+)"\.$/, (m) => `Nama fail menyebut "${m[1]}".`],
  [/^The file name fits more than one type \((.+)\)\. Check it\.$/, (m) => `Nama fail sesuai dengan lebih daripada satu jenis (${m[1]}). Semak.`],
  [/^Left out by the person loading\.$/, () => 'Tidak dimasukkan oleh orang yang memuatkan.'],
  [/^Held: no person chosen\.$/, () => 'Ditahan: tiada orang dipilih.'],
  [/^Not filed: (.+)$/, (m) => `Tidak difailkan: ${m[1]}`],
];
const why = (lang: Lang, text: string) => {
  if (lang === 'en') return text;
  for (const [re, fn] of WHY_MS) {
    const m = text.match(re);
    if (m) return fn(m);
  }
  return text;
};
const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : String(e));

type Tab = 'data' | 'files' | 'loads';

export function BulkLoad() {
  const { version } = useContext(RefreshContext);
  const board = useLoad(() => api.bulk.board(), [version]);
  const [tab, setTab] = useState<Tab>('data');
  const b = board.data;
  let body;
  if (board.loading && !b) body = <Loading what="the bulk load" />;
  else if (board.error || !b) body = <ErrorNotice error={board.error} />;
  else if (!b.can.data && !b.can.files)
    body = (
      <Card>
        <Empty title="You do not keep any record that loads in bulk.">Ask the department that keeps the record to load the file.</Empty>
      </Card>
    );
  else
    body = (
      <>
        <div className="bl-tabs" role="tablist" aria-label="Bulk load">
          {b.can.data && (
            <button role="tab" type="button" aria-selected={tab === 'data'} onClick={() => setTab('data')}>
              <TableIcon size={18} aria-hidden="true" />
              <span>Spreadsheet</span>
            </button>
          )}
          {b.can.files && (
            <button role="tab" type="button" aria-selected={tab === 'files'} onClick={() => setTab('files')}>
              <FilesIcon size={18} aria-hidden="true" />
              <span>Many files</span>
            </button>
          )}
          <button role="tab" type="button" aria-selected={tab === 'loads'} onClick={() => (setTab('loads'), board.reload())}>
            <ClockCounterClockwiseIcon size={18} aria-hidden="true" />
            <span>Load records</span>
            {b.loads.length > 0 && <span className="bl-tab-n">{b.loads.length}</span>}
          </button>
        </div>
        {/* Each tab stays mounted, so a half-done load is still there when the person looks at the records and comes back. */}
        {b.can.data && (
          <div hidden={tab !== 'data'}>
            <DataLoad board={b} onDone={() => (board.reload(), setTab('loads'))} />
          </div>
        )}
        {b.can.files && (
          <div hidden={tab !== 'files'}>
            <FilesLoad board={b} onDone={() => (board.reload(), setTab('loads'))} />
          </div>
        )}
        {(tab === 'loads' || (tab === 'data' && !b.can.data) || (tab === 'files' && !b.can.files)) && <Loads loads={b.loads} />}
      </>
    );
  return (
    <div className="page bl">
      <PageHead
        title="Bulk load"
        sub="Load a whole spreadsheet or many files at once. Prima proposes where everything goes; you check it, and nothing is saved until you confirm. Every load keeps a record."
      />
      {body}
    </div>
  );
}

// ---------------------------------------------------------------- spreadsheet

type DataStep = 'file' | 'where' | 'rows' | 'load' | 'done';
const DATA_STEPS: DataStep[] = ['file', 'where', 'rows', 'load', 'done'];

function stepStates(now: DataStep): StepState[] {
  const at = DATA_STEPS.indexOf(now);
  return DATA_STEPS.slice(0, 4).map((_, i) => (i < at ? 'done' : i === at ? 'now' : 'todo'));
}

function DataLoad({ board, onDone }: { board: BulkBoard; onDone: () => void }) {
  const { lang } = useLang();
  const [step, setStep] = useState<DataStep>('file');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<string[][] | null>(null);
  const [guesses, setGuesses] = useState<DestinationGuess[]>([]);
  const [kind, setKind] = useState('');
  const [plan, setPlan] = useState<BulkColumnPlan[]>([]);
  const [placed, setPlaced] = useState<(string | null)[]>([]);
  const [decided, setDecided] = useState<boolean[]>([]);
  const [leaveOut, setLeaveOut] = useState<Set<number>>(new Set());
  const [aiUsed, setAiUsed] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<{ loaded: number; refused: number; target: string; waiting: boolean } | null>(null);
  const [sdOn, setSdOn] = useState<boolean | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const target = board.targets.find((t) => t.kind === kind) ?? null;

  useEffect(() => {
    if (!board.targets.some((t) => t.kind === STAFF_DIRECTORY_KIND)) return;
    api.staffDirectoryStatus().then((s) => setSdOn(s.enabled && s.ready), () => setSdOn(false));
  }, [board.targets]);

  function choose(k: string, t = table) {
    const tg = board.targets.find((x) => x.kind === k);
    setKind(k);
    if (!tg || !t) return;
    const p = planColumns(t, tg);
    setPlan(p);
    setPlaced(p.map((c) => c.field));
    setDecided(p.map((c) => !c.held));
    setAiNote(null);
  }

  async function read(f: File | undefined) {
    if (!f) return;
    setError(null);
    if (f.size > MAX_SHEET_FILE) return setError('The file is too big. Keep only the sheet you need.');
    setBusy('Reading the file on this device…');
    try {
      const sheets = (await sheetsOf(f)).map((s) => ({ ...s, rows: cleanGrid(s.rows) }));
      const all = board.targets.flatMap((t) => t.fields);
      const best = pickSheet(sheets, all);
      const rows = sheets[best]?.rows ?? [];
      if (rows.length < 2) throw new Error('No list with rows was found in this file.');
      // Read the header row once with every destination's words, then score each destination on that table.
      const prep = prepareSheet(rows, all);
      if (prep.table.length < 2) throw new Error('This sheet has no rows under the column names.');
      const g = rankDestinations(prep.table, board.targets, f.name);
      setFileName(f.name);
      setTable(prep.table);
      setGuesses(g);
      setLeaveOut(new Set());
      setAiUsed(false);
      // Sure or likely: proposed. Unsure: held, the person chooses.
      if (g[0] && g[0].level !== 'check') choose(g[0].kind, prep.table);
      else {
        setKind('');
        setPlan([]);
      }
      setStep('where');
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  }

  async function askAi() {
    if (!table) return;
    setBusy('Asking Arisha AI with masked column names and value shapes only (no values are sent)…');
    setError(null);
    try {
      const columns = table[0].map((h, i) => ({ index: i, header: h, samples: table.slice(1, 4).map((r) => valueShape(r[i] ?? '')) }));
      const r = await api.bulk.aiPlan({ fileName, columns });
      setAiUsed(true);
      if (r.kind && r.kind !== kind) choose(r.kind);
      if (r.matches.length) {
        setPlaced((cur) => cur.map((f, i) => (decided[i] ? f : (r.matches.find((m) => m.index === i)?.field ?? f))));
        setAiNote(say(lang, `Arisha AI suggested ${plural(r.matches.length, 'column', 'columns')}. They stay held until you confirm each one.`, `Arisha AI mencadangkan ${r.matches.length} lajur. Ia kekal ditahan sehingga anda mengesahkan setiap satu.`, `Arisha AI cadangkan ${r.matches.length} column. Ia kekal held sampai anda confirm satu-satu.`));
      } else setAiNote(say(lang, 'Arisha AI had no sure suggestion. Place the columns yourself.', 'Arisha AI tiada cadangan yang pasti. Letakkan lajur sendiri.', 'Arisha AI tiada cadangan yang pasti. Letak column sendiri.'));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  }

  const mapping = placed.map((f, i) => (decided[i] ? f : null));
  const used = new Set(mapping.filter(Boolean));
  const missing = target ? target.fields.filter((f) => f.required && !used.has(f.key)) : [];
  const held = plan.filter((c, i) => c.held && !decided[i]);
  const flags = useMemo(() => (table && target ? flagRows(table, mapping, target) : []), [table, target, mapping.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const flagged = useMemo(() => [...new Set(flags.map((f) => f.row))], [flags]);
  const rowsInFile = table ? table.slice(1).filter((r) => r.some((c) => String(c ?? '').trim())).length : 0;

  function setField(i: number, key: string) {
    setPlaced((cur) => cur.map((f, j) => (j === i ? key || null : key && f === key ? null : f)));
    setDecided((cur) => cur.map((d, j) => (j === i ? true : d)));
  }

  function toRows() {
    setLeaveOut(new Set(flagged));
    setStep('rows');
  }

  function refusedList(extra: { row: number; reasons: string[] }[] = []) {
    const by = new Map<number, string[]>();
    for (const f of flags) if (leaveOut.has(f.row)) by.set(f.row, [...(by.get(f.row) ?? []), ...f.reasons]);
    for (const r of leaveOut) if (!by.has(r)) by.set(r, ['Left out by the person loading.']);
    for (const x of extra) by.set(x.row, [...new Set([...(by.get(x.row) ?? []), ...x.reasons])]);
    return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([row, reasons]) => ({ row, reasons: reasons.slice(0, 6) }));
  }
  const planOut = () => plan.map((c, i) => ({ header: c.header, field: mapping[i] }));

  async function recordImport(r: OrgImportReceipt, refused: { row: number; reasons: string[] }[]) {
    try {
      const load = await api.bulk.recordData({ via: 'import', receiptId: r.id, fileName, rowsInFile, plan: planOut(), refused: refusedList(refused), aiUsed });
      setDone({ loaded: load.loaded, refused: load.refused.length, target: load.targetLabel, waiting: false });
    } catch (e) {
      setError(errText(e));
      setDone({ loaded: r.rows, refused: r.skippedRows?.length ?? 0, target: target?.label ?? '', waiting: false });
    }
    setImporting(false);
    setStep('done');
  }

  /** Staff data: HR sends it to the staff directory; rows the directory refuses are left out with its reason. */
  async function sendStaff() {
    if (!table) return;
    setBusy('Checking the rows with the staff directory…');
    setError(null);
    try {
      const out = new Set(leaveOut);
      const extra: { row: number; reasons: string[] }[] = [];
      let p: StaffDirectoryPreview | null = null;
      for (let round = 0; round < 3; round++) {
        const kept = table
          .slice(1)
          .map((_, i) => i + 2)
          .filter((row) => !out.has(row) && table[row - 1].some((c) => String(c ?? '').trim()));
        const text = staffDirectoryCsv(table, mapping, [...out]);
        p = (await api.staffDirectoryAct('preview', { text, source: fileName })) as StaffDirectoryPreview;
        if (p.missingColumns.length) throw new Error(`The staff directory needs these columns: ${p.missingColumns.join(', ')}.`);
        const bad = p.rows.filter((x) => x.errors.length);
        if (!bad.length) {
          if (!p.ready) throw new Error('Every row is already in the staff directory. Nothing to send.');
          const sent = (await api.staffDirectoryAct('submit', { text, source: fileName, fingerprint: p.fingerprint })) as { id: string; rows: number };
          const load = await api.bulk.recordData({ via: 'staffDirectory', batchId: sent.id, fileName, rowsInFile, plan: planOut(), refused: refusedList(extra).filter((x) => out.has(x.row)), aiUsed });
          setDone({ loaded: load.loaded, refused: load.refused.length, target: load.targetLabel, waiting: true });
          setStep('done');
          return;
        }
        for (const x of bad) {
          const fileRow = kept[x.row - 2];
          if (fileRow === undefined) continue;
          out.add(fileRow);
          extra.push({ row: fileRow, reasons: x.errors });
        }
        setLeaveOut(new Set(out));
      }
      throw new Error('Some rows are still refused by the staff directory. Check them and try again.');
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  }

  const states = stepStates(step === 'done' ? 'done' : step);
  const restart = () => {
    setStep('file');
    setTable(null);
    setKind('');
    setPlan([]);
    setDone(null);
    setError(null);
  };
  const otherGuesses = guesses.filter((g) => g.kind !== kind).slice(0, 3);
  const guess = guesses.find((g) => g.kind === kind);

  return (
    <div className="bl-flow">
      <Steps
        steps={[
          { label: 'Choose the file', state: states[0] },
          { label: 'Where it goes', state: states[1] },
          { label: 'Check the rows', state: states[2] },
          { label: 'Confirm and load', state: states[3] },
        ]}
      />
      {busy && (
        <div className="bl-busy" role="status">
          <span>{busy}</span>
          <span className="bl-bar" aria-hidden="true" />
        </div>
      )}
      {error && <ErrorNotice error={error} />}

      {step === 'file' && (
        <Card title="Choose the spreadsheet" sub="Excel, CSV, a Word table or a PDF list, in any layout. It is read here on this device; nothing is sent until you confirm.">
          <label
            className="bl-drop"
            data-drag={dragging || undefined}
            onDragOver={(e) => (e.preventDefault(), setDragging(true))}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void read(e.dataTransfer.files?.[0]);
            }}
          >
            <FileArrowUpIcon size={34} weight="duotone" aria-hidden="true" />
            <strong>Choose a file or drop it here</strong>
            <span className="muted small">Staff, sites, items, clients, foreign workers and more: Prima finds where it belongs.</span>
            <input ref={input} type="file" accept=".xlsx,.xlsm,.csv,.txt,.tsv,.docx,.pdf" onChange={(e) => void read(e.target.files?.[0])} />
          </label>
          <p className="muted small bl-note">You can load only into records your role keeps. For staff data, HR sends it and the HR Director or the CEO approves it.</p>
        </Card>
      )}

      {step === 'where' && table && (
        <>
          <Card
            title="Where it goes"
            sub={say(lang, `${fileName}: ${plural(rowsInFile, 'row', 'rows')}, ${plural(table[0].length, 'column', 'columns')}.`, `${fileName}: ${rowsInFile} baris, ${table[0].length} lajur.`, `${fileName}: ${rowsInFile} row, ${table[0].length} column.`)}
            actions={
              board.ai ? (
                <button type="button" className="btn" onClick={() => void askAi()} disabled={!!busy}>
                  <SparkleIcon size={16} aria-hidden="true" /> Ask Arisha AI
                </button>
              ) : undefined
            }
          >
            {guess ? (
              <div className="bl-dest" data-level={guess.level}>
                <div className="bl-dest-main">
                  <span className="bl-dest-label">Prima suggests</span>
                  <strong>{target?.label}</strong>
                  <span className="muted small">{guess.why}</span>
                  <span className="muted small">{say(lang, `Kept by: ${target?.keptBy}. Confirmed by: ${target?.confirmBy}.`, `Disimpan oleh: ${target?.keptBy}. Disahkan oleh: ${target?.confirmBy}.`, `Disimpan oleh: ${target?.keptBy}. Confirm oleh: ${target?.confirmBy}.`)}</span>
                </div>
                <Chip tone={LEVEL[guess.level][1]}>{LEVEL[guess.level][0]}</Chip>
              </div>
            ) : (
              <div className="bl-held-box" role="note">
                <WarningIcon size={18} aria-hidden="true" />
                <span>Prima is not sure where this file goes. It is held for you: choose the record below.</span>
              </div>
            )}
            <div className="bl-choose">
              <label className="bl-label" htmlFor="bl-dest">
                Record it goes to
              </label>
              <Select id="bl-dest" searchable value={kind} onChange={(e) => choose(e.target.value)}>
                <option value="">Choose…</option>
                {guesses.map((g) => (
                  <option key={g.kind} value={g.kind}>
                    {`${board.targets.find((t) => t.kind === g.kind)?.label ?? g.kind} (${Math.round(g.fit * 100)}%)`}
                  </option>
                ))}
              </Select>
              {otherGuesses.length > 0 && (
                <div className="bl-alts">
                  <span className="muted small">Other places it could go:</span>
                  {otherGuesses.map((g) => (
                    <button key={g.kind} type="button" className="bl-alt" onClick={() => choose(g.kind)}>
                      {board.targets.find((t) => t.kind === g.kind)?.label} <span className="muted">{Math.round(g.fit * 100)}%</span>
                    </button>
                  ))}
                </div>
              )}
              {kind === STAFF_DIRECTORY_KIND && sdOn === false && <p className="bl-warn small">The staff directory is not switched on here yet. IT turns it on after the CEO approves it.</p>}
            </div>
            {aiNote && <p className="muted small">{aiNote}</p>}
          </Card>

          {target && (
            <Card title="Each column" sub="Check the field of each column. Columns Prima is unsure of are held for you: place them or leave them out." flush>
              <ul className="bl-cols">
                {plan.map((c, i) => {
                  const sample = table.slice(1).map((r) => r[c.index] ?? '').find((v) => String(v).trim()) ?? '';
                  const isHeld = c.held && !decided[i];
                  return (
                    <li key={c.index} className="bl-col" data-held={isHeld || undefined}>
                      <div className="bl-col-head">
                        <strong>{c.header || `Column ${c.index + 1}`}</strong>
                        {sample && <span className="muted small bl-sample">{`${say(lang, 'e.g.', 'cth.')} ${String(sample).slice(0, 40)}`}</span>}
                      </div>
                      <div className="bl-col-pick">
                        <Select aria-label={`Field for ${c.header || `column ${c.index + 1}`}`} searchable value={decided[i] ? (placed[i] ?? '') : ''} onChange={(e) => setField(i, e.target.value)}>
                          <option value="">{isHeld ? 'Held: choose…' : 'Not used'}</option>
                          {target.fields.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label}
                              {f.required ? ' *' : ''}
                            </option>
                          ))}
                        </Select>
                        {isHeld && (
                          <div className="bl-held-actions">
                            {(placed[i] ?? c.suggested) && (
                              <button type="button" className="btn btn-sm" onClick={() => setField(i, (placed[i] ?? c.suggested)!)}>
                                {`${say(lang, 'Use:', 'Guna:')} ${target.fields.find((f) => f.key === (placed[i] ?? c.suggested))?.label ?? ''}`}
                              </button>
                            )}
                            <button type="button" className="btn btn-sm" onClick={() => setField(i, '')}>
                              Leave it out
                            </button>
                          </div>
                        )}
                        {!isHeld && decided[i] && placed[i] && c.level && placed[i] === c.suggested && <Chip tone={LEVEL[c.level][1]}>{LEVEL[c.level][0]}</Chip>}
                      </div>
                      {isHeld && <span className="muted small">{c.why}</span>}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
          <div className="bl-foot">
            {missing.length > 0 && <span className="bl-warn small">{`${say(lang, 'Needed and not placed:', 'Perlu tetapi belum diletakkan:', 'Perlu tapi belum diletak:')} ${missing.map((f) => f.label).join(', ')}.`}</span>}
            {held.length > 0 && <span className="bl-warn small">{say(lang, `${held.length} column${held.length === 1 ? ' is' : 's are'} held for you.`, `${held.length} lajur ditahan untuk anda.`, `${held.length} column di-hold untuk anda.`)}</span>}
            <button type="button" className="btn" onClick={restart}>
              Choose another file
            </button>
            <button type="button" className="btn btn-primary bl-big" disabled={!target || held.length > 0 || missing.length > 0 || (kind === STAFF_DIRECTORY_KIND && sdOn === false)} onClick={toRows}>
              Next: check the rows
            </button>
          </div>
        </>
      )}

      {step === 'rows' && table && target && (
        <>
          <Stats>
            <Stat label="Rows in the file" value={rowsInFile} />
            <Stat label="Look fine" value={rowsInFile - flagged.length} tone="ok" />
            <Stat label="Look wrong" value={new Set(flags.filter((f) => f.kind === 'wrong').map((f) => f.row)).size} tone={flags.some((f) => f.kind === 'wrong') ? 'warn' : 'ok'} />
            <Stat label="Repeated" value={new Set(flags.filter((f) => f.kind === 'duplicate').map((f) => f.row)).size} tone={flags.some((f) => f.kind === 'duplicate') ? 'warn' : 'ok'} />
          </Stats>
          <Card title="Rows to check" sub={flagged.length ? 'These rows are left out unless you keep them. The record’s own check runs on every row before anything is saved.' : 'No row looks wrong or repeated. The record’s own check still runs on every row before anything is saved.'} flush>
            {flagged.length === 0 ? (
              <Empty title="Every row looks fine." />
            ) : (
              <ul className="bl-rows">
                {flagged.map((row) => {
                  const fs = flags.filter((f) => f.row === row);
                  const out = leaveOut.has(row);
                  return (
                    <li key={row} className="bl-row" data-out={out || undefined}>
                      <div className="bl-row-main">
                        <strong>{say(lang, `Row ${row}`, `Baris ${row}`, `Row ${row}`)}</strong>
                        {fs.map((f) => (
                          <Chip key={f.kind} tone="warn">
                            {f.kind === 'wrong' ? 'Looks wrong' : 'Repeated'}
                          </Chip>
                        ))}
                        <span className="muted small">{fs.flatMap((f) => f.reasons.map((r) => why(lang, r))).join(' ')}</span>
                      </div>
                      <label className="bl-check">
                        <input
                          type="checkbox"
                          checked={out}
                          onChange={(e) =>
                            setLeaveOut((cur) => {
                              const n = new Set(cur);
                              if (e.target.checked) n.add(row);
                              else n.delete(row);
                              return n;
                            })
                          }
                        />
                        Leave out
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <div className="bl-foot">
            <button type="button" className="btn" onClick={() => setStep('where')}>
              Back
            </button>
            <button type="button" className="btn btn-primary bl-big" onClick={() => setStep('load')}>
              Next: confirm
            </button>
          </div>
        </>
      )}

      {step === 'load' && table && target && (
        <Card title="Confirm and load" sub="Nothing has been saved yet.">
          <PlanSummary lang={lang} target={target} fileName={fileName} rows={rowsInFile} leaveOut={leaveOut.size} plan={planOut()} />
          {kind === STAFF_DIRECTORY_KIND ? (
            <>
              <p className="small">You send these rows to the staff directory. The HR Director or the CEO approves them, never the person who sent them. Rows the staff directory refuses are left out with its reason.</p>
              <div className="bl-foot">
                <button type="button" className="btn" onClick={() => setStep('rows')}>
                  Back
                </button>
                <button type="button" className="btn btn-primary bl-big" disabled={!!busy} onClick={() => void sendStaff()}>
                  Send for approval
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="small">The record’s own import opens with your plan. It checks every row exactly as the Add form does; you import all the rows kept, or none.</p>
              <div className="bl-foot">
                <button type="button" className="btn" onClick={() => setStep('rows')}>
                  Back
                </button>
                <button type="button" className="btn btn-primary bl-big" onClick={() => setImporting(true)}>
                  Open the import
                </button>
              </div>
            </>
          )}
        </Card>
      )}

      {importing && table && target && (
        <ImportDrawer
          kind={kind as ImportKind}
          companyId={null}
          start={{ fileName, table, mapping: mapping.map((m) => m ?? ''), skip: [...leaveOut] }}
          onImported={(r, refused) => void recordImport(r, refused)}
          onClose={() => setImporting(false)}
        />
      )}

      {step === 'done' && done && (
        <Card>
          <div className="bl-done">
            <CheckCircleIcon size={40} weight="fill" aria-hidden="true" />
            <strong>{done.waiting ? 'Sent for approval' : 'Loaded'}</strong>
            <span>
              {done.waiting
                ? say(lang, `${plural(done.loaded, 'row', 'rows')} sent to ${done.target}; ${done.refused} left out with the reason kept.`, `${done.loaded} baris dihantar ke ${done.target}; ${done.refused} tidak dimasukkan, sebabnya disimpan.`, `${done.loaded} row dihantar ke ${done.target}; ${done.refused} tidak dimasukkan, sebab disimpan.`)
                : say(lang, `${plural(done.loaded, 'row', 'rows')} saved in ${done.target}; ${done.refused} left out with the reason kept.`, `${done.loaded} baris disimpan dalam ${done.target}; ${done.refused} tidak dimasukkan, sebabnya disimpan.`, `${done.loaded} row disimpan dalam ${done.target}; ${done.refused} tidak dimasukkan, sebab disimpan.`)}
            </span>
            {done.waiting && <span className="muted small">The HR Director or the CEO approves it on the Staff directory screen. The load record shows when it is approved.</span>}
            <div className="bl-foot">
              <button type="button" className="btn" onClick={restart}>
                Load another file
              </button>
              <button type="button" className="btn btn-primary" onClick={onDone}>
                See the load record
              </button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function PlanSummary({ lang, target, fileName, rows, leaveOut, plan }: { lang: Lang; target: BulkTarget; fileName: string; rows: number; leaveOut: number; plan: { header: string; field: string | null }[] }) {
  const used = plan.filter((p) => p.field);
  return (
    <dl className="bl-facts">
      <div>
        <dt>File</dt>
        <dd>{fileName}</dd>
      </div>
      <div>
        <dt>Goes to</dt>
        <dd>
          {target.label} ({target.screen})
        </dd>
      </div>
      <div>
        <dt>Rows</dt>
        <dd>{say(lang, `${rows - leaveOut} to load, ${leaveOut} left out`, `${rows - leaveOut} untuk dimuatkan, ${leaveOut} tidak dimasukkan`, `${rows - leaveOut} untuk di-load, ${leaveOut} tidak dimasukkan`)}</dd>
      </div>
      <div>
        <dt>Columns</dt>
        <dd>
          {used.map((p) => `${p.header} → ${target.fields.find((f) => f.key === p.field)?.label ?? p.field}`).join('; ') || say(lang, 'None', 'Tiada')}
        </dd>
      </div>
    </dl>
  );
}

// ---------------------------------------------------------------- many files

interface FileRow {
  file: File;
  name: string;
  mime: string;
  docType: BulkDocType;
  docLevel: SmartLevel;
  docWhy: string;
  personId: string;
  personLabel: string;
  level: SmartLevel;
  why: string;
  options: { id: string; label: string }[];
  leaveOut: boolean;
  state: 'ready' | 'filing' | 'filed' | 'failed';
  note?: string;
  docId?: string;
}

const OK_MIME = /^(application\/pdf|image\/jpeg|image\/png)$/;

/** A picture made small enough to file (long side 1600 px, JPEG), on this device. */
async function shrink(f: File): Promise<string> {
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => bad(new Error('This picture cannot be read.'));
      i.src = url;
    });
    let side = 1600;
    for (let q = 0.82; q > 0.3; q -= 0.12, side = Math.round(side * 0.85)) {
      const k = Math.min(1, side / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      const data = c.toDataURL('image/jpeg', q);
      if (data.length * 0.75 < MAX_DOC) return data;
    }
    throw new Error('This picture is too large even made smaller.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
const dataUrlOf = (f: File) =>
  new Promise<string>((ok, bad) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => bad(new Error('The file cannot be read.'));
    r.readAsDataURL(f);
  });

function FilesLoad({ board, onDone }: { board: BulkBoard; onDone: () => void }) {
  const { lang } = useLang();
  const [rows, setRows] = useState<FileRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ filed: number; held: number } | null>(null);
  const [aiUsed, setAiUsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const types = board.docTypes;

  async function choose(list: FileList | null) {
    const files = [...(list ?? [])].slice(0, 200);
    if (!files.length) return;
    setError(null);
    setDone(null);
    setBusy(say(lang, `Reading ${plural(files.length, 'file name', 'file names')}…`, `Membaca ${files.length} nama fail…`, `Baca ${files.length} nama file…`));
    try {
      const p: BulkPlacements = await api.bulk.place(files.map((f) => ({ name: f.name, mime: f.type })));
      setRows(
        files.map((f, i) => {
          const x = p.files[i];
          const okType = OK_MIME.test(f.type);
          return {
            file: f,
            name: f.name,
            mime: f.type,
            docType: x.doc.type,
            docLevel: x.doc.level,
            docWhy: x.doc.why,
            personId: x.who.personId ?? '',
            personLabel: x.who.label ?? '',
            level: x.who.level,
            why: x.who.why,
            options: [...(x.who.personId ? [{ id: x.who.personId, label: x.who.label ?? x.who.personId }] : []), ...x.who.others],
            // Unsure files are held: no person chosen until the person loading places them.
            leaveOut: !okType,
            state: 'ready',
            note: okType ? undefined : 'Only PDF, JPEG and PNG files are filed.',
          };
        }),
      );
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  }

  async function askAi() {
    if (!rows) return;
    setBusy('Asking Arisha AI with masked file names only…');
    try {
      const r = await api.bulk.aiFiles(rows.map((x) => ({ name: x.name, mime: x.mime })));
      setAiUsed(true);
      setRows((cur) => cur!.map((x, i) => (x.docLevel === 'check' ? { ...x, docType: r.types.find((t) => t.index === i)?.type ?? x.docType, docWhy: 'Suggested by Arisha AI from the masked file name. Check it.' } : x)));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  }

  const update = (i: number, patch: Partial<FileRow>) => setRows((cur) => cur!.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const ready = rows?.filter((x) => !x.leaveOut && x.personId && x.state !== 'filed') ?? [];
  const heldRows = rows?.filter((x) => !x.leaveOut && !x.personId) ?? [];

  async function fileAll() {
    if (!rows) return;
    setError(null);
    const placed: { file: string; personId: string; docType: BulkDocType; docId: string }[] = [];
    const held: { file: string; reason: string }[] = [];
    const out = [...rows];
    for (let i = 0; i < out.length; i++) {
      const x = out[i];
      if (x.leaveOut || !x.personId) {
        held.push({ file: x.name, reason: x.leaveOut ? (x.note ?? 'Left out by the person loading.') : 'Held: no person chosen.' });
        continue;
      }
      if (x.state === 'filed' && x.docId) {
        placed.push({ file: x.name, personId: x.personId, docType: x.docType, docId: x.docId });
        continue;
      }
      setBusy(say(lang, `Filing ${i + 1} of ${out.length}: ${x.name}`, `Memfailkan ${i + 1} daripada ${out.length}: ${x.name}`, `Filing ${i + 1} daripada ${out.length}: ${x.name}`));
      update(i, { state: 'filing' });
      try {
        const data = x.mime.startsWith('image/') && x.file.size > MAX_DOC ? await shrink(x.file) : await dataUrlOf(x.file);
        if (data.length * 0.75 > MAX_DOC + 2000) throw new Error('Too large (over 700 KB). Scan it smaller and file it again.');
        const r = await api.bulk.file({ personId: x.personId, docType: x.docType, name: x.name, data });
        out[i] = { ...x, state: 'filed', docId: r.docId };
        update(i, { state: 'filed', docId: r.docId, note: undefined });
        placed.push({ file: x.name, personId: x.personId, docType: x.docType, docId: r.docId });
      } catch (e) {
        update(i, { state: 'failed', note: errText(e) });
        held.push({ file: x.name, reason: `Not filed: ${errText(e)}` });
      }
    }
    setBusy('Keeping the load record…');
    try {
      if (placed.length || held.length) await api.bulk.recordFiles({ placed, held, aiUsed });
      setDone({ filed: placed.length, held: held.length });
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bl-flow">
      {busy && (
        <div className="bl-busy" role="status">
          <span>{busy}</span>
          <span className="bl-bar" aria-hidden="true" />
        </div>
      )}
      {error && <ErrorNotice error={error} />}
      {!rows && (
        <Card title="Choose many files" sub="Certificates, permits, contracts, photos. Prima reads the file names, suggests what each is and whose HR file it goes on, and you confirm.">
          <label
            className="bl-drop"
            data-drag={dragging || undefined}
            onDragOver={(e) => (e.preventDefault(), setDragging(true))}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void choose(e.dataTransfer.files);
            }}
          >
            <FilesIcon size={34} weight="duotone" aria-hidden="true" />
            <strong>Choose the files or drop them here</strong>
            <span className="muted small">PDF, JPEG or PNG, up to 700 KB each (pictures are made smaller on this device). Name files with the staff number for a sure match.</span>
            <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(e) => void choose(e.target.files)} />
          </label>
          <p className="muted small bl-note">Files go only on the files of people you keep: HR for office staff, the company for its guards, FWM for its workers.</p>
        </Card>
      )}
      {rows && !done && (
        <>
          <Stats>
            <Stat label="Files" value={rows.length} />
            <Stat label="Ready to file" value={ready.length} tone="ok" />
            <Stat label="Held for you" value={heldRows.length} tone={heldRows.length ? 'warn' : 'ok'} />
            <Stat label="Left out" value={rows.filter((x) => x.leaveOut).length} tone="neutral" />
          </Stats>
          <Card
            title="Where each file goes"
            sub="Check the type and the person of each file. A file with no sure match is held: choose the person or leave it out."
            actions={
              board.ai ? (
                <button type="button" className="btn" onClick={() => void askAi()} disabled={!!busy}>
                  <SparkleIcon size={16} aria-hidden="true" /> Ask Arisha AI for the types
                </button>
              ) : undefined
            }
            flush
          >
            <ul className="bl-files">
              {rows.map((x, i) => (
                <FileItem key={`${x.name}-${i}`} row={x} types={types} onChange={(p) => update(i, p)} />
              ))}
            </ul>
          </Card>
          <div className="bl-foot">
            <button type="button" className="btn" onClick={() => setRows(null)}>
              Choose other files
            </button>
            <button type="button" className="btn btn-primary bl-big" disabled={!!busy || !ready.length} onClick={() => void fileAll()}>
              {say(lang, `File ${plural(ready.length, 'document', 'documents')}`, `Failkan ${ready.length} dokumen`, `File ${ready.length} dokumen`)}
            </button>
          </div>
        </>
      )}
      {done && (
        <Card>
          <div className="bl-done">
            <CheckCircleIcon size={40} weight="fill" aria-hidden="true" />
            <strong>Filed</strong>
            <span>{say(lang, `${plural(done.filed, 'document', 'documents')} filed on people’s HR files; ${done.held} held or left out, with the reason kept.`, `${done.filed} dokumen difailkan dalam fail HR; ${done.held} ditahan atau tidak dimasukkan, sebabnya disimpan.`, `${done.filed} dokumen di-file dalam fail HR; ${done.held} di-hold atau tidak dimasukkan, sebab disimpan.`)}</span>
            <div className="bl-foot">
              <button type="button" className="btn" onClick={() => (setRows(null), setDone(null))}>
                File more
              </button>
              <button type="button" className="btn btn-primary" onClick={onDone}>
                See the load record
              </button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function FileItem({ row, types, onChange }: { row: FileRow; types: BulkBoard['docTypes']; onChange: (p: Partial<FileRow>) => void }) {
  const { lang } = useLang();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setFound([]);
    let live = true;
    const t = window.setTimeout(() => api.bulk.people(q).then((r) => live && setFound(r), () => undefined), 250);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [q]);
  const options = [...row.options, ...found.filter((f) => !row.options.some((o) => o.id === f.id))];
  const held = !row.personId && !row.leaveOut;
  return (
    <li className="bl-file" data-held={held || undefined} data-out={row.leaveOut || undefined} data-state={row.state}>
      <div className="bl-file-head">
        <strong className="bl-file-name" title={row.name}>
          {row.name}
        </strong>
        <span className="muted small">{`${Math.max(1, Math.round(row.file.size / 1000))} KB`}</span>
        {row.state === 'filed' && <Chip tone="ok">Filed</Chip>}
        {row.state === 'failed' && <Chip tone="crit">Not filed</Chip>}
        {held && <Chip tone="warn">Held for you</Chip>}
      </div>
      <div className="bl-file-grid">
        <label className="bl-field">
          <span className="bl-label">Document type</span>
          <Select value={row.docType} disabled={row.state === 'filed'} onChange={(e) => onChange({ docType: e.target.value as BulkDocType, docLevel: 'sure', docWhy: 'You chose this.' })}>
            {types.map((t) => (
              <option key={t.key} value={t.key}>
                {lang === 'en' ? t.label : t.ms}
              </option>
            ))}
          </Select>
          <span className="muted small">
            <Chip tone={LEVEL[row.docLevel][1]}>{LEVEL[row.docLevel][0]}</Chip> {why(lang, row.docWhy)}
          </span>
        </label>
        <div className="bl-field">
          <span className="bl-label">Person</span>
          <Select
            aria-label={`Person for ${row.name}`}
            searchable
            value={row.personId}
            disabled={row.state === 'filed'}
            onChange={(e) => onChange({ personId: e.target.value, personLabel: options.find((o) => o.id === e.target.value)?.label ?? '', level: 'sure', why: 'You chose this.' })}
          >
            <option value="">{options.length ? 'Choose…' : 'Search below…'}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
          {row.state !== 'filed' && <input className="input bl-find" placeholder="Find by name or staff number" aria-label={`Find a person for ${row.name}`} value={q} onChange={(e) => setQ(e.target.value)} />}
          <span className="muted small">
            {row.personId && <Chip tone={LEVEL[row.level][1]}>{LEVEL[row.level][0]}</Chip>} {row.why}
          </span>
        </div>
      </div>
      {row.note && <span className={row.state === 'failed' ? 'bl-warn small' : 'muted small'}>{row.note}</span>}
      {row.state !== 'filed' && (
        <label className="bl-check">
          <input type="checkbox" checked={row.leaveOut} onChange={(e) => onChange({ leaveOut: e.target.checked })} /> Leave out
        </label>
      )}
    </li>
  );
}

// ---------------------------------------------------------------- load records

function Loads({ loads }: { loads: BulkLoadRow[] }) {
  const { lang } = useLang();
  const [find, setFind] = useState('');
  const shown = loads.filter((l) => !find.trim() || `${l.targetLabel} ${l.fileNames.join(' ')} ${l.loadedBy}`.toLowerCase().includes(find.trim().toLowerCase()));
  if (!loads.length)
    return (
      <Card>
        <Empty title="No bulk loads yet.">Every load you make is recorded here: who loaded it, the plan, who confirmed or approved it, and what went where.</Empty>
      </Card>
    );
  return (
    <div className="bl-flow">
      <input className="input" placeholder="Find a load by record, file or person" aria-label="Find a load" value={find} onChange={(e) => setFind(e.target.value)} />
      <ul className="bl-loads">
        {shown.map((l) => (
          <li key={l.id} className="bl-load">
            <details>
              <summary>
                <span className="bl-load-main">
                  <strong>{l.targetLabel}</strong>
                  <span className="muted small">
                    {`${dateTimeLabel(l.at)} · ${l.loadedBy} · ${l.fileNames.length === 1 ? l.fileNames[0] : say(lang, `${l.fileNames.length} files`, `${l.fileNames.length} fail`, `${l.fileNames.length} file`)}`}
                  </span>
                </span>
                <span className="bl-load-chips">
                  <Chip tone="ok">{l.kind === 'files' ? say(lang, `${l.loaded} filed`, `${l.loaded} difailkan`, `${l.loaded} di-file`) : l.approval ? say(lang, `${l.loaded} sent`, `${l.loaded} dihantar`) : say(lang, `${l.loaded} loaded`, `${l.loaded} dimuatkan`, `${l.loaded} di-load`)}</Chip>
                  {(l.refused.length > 0 || l.held.length > 0) && <Chip tone="warn">{say(lang, `${l.refused.length + l.held.length} left out`, `${l.refused.length + l.held.length} tidak dimasukkan`)}</Chip>}
                  {l.approval && <Chip tone={l.approval.status === 'approved' ? 'ok' : l.approval.status === 'returned' ? 'crit' : 'info'}>{l.approval.status === 'approved' ? 'Approved' : l.approval.status === 'returned' ? 'Returned' : 'Waiting for approval'}</Chip>}
                  {l.aiUsed && <Chip tone="info">Arisha AI asked</Chip>}
                </span>
              </summary>
              <dl className="bl-facts">
                <div>
                  <dt>Loaded by</dt>
                  <dd>{l.loadedBy}</dd>
                </div>
                <div>
                  <dt>Confirmed by</dt>
                  <dd>{l.confirmedBy}</dd>
                </div>
                {l.approval && (
                  <div>
                    <dt>Approved by</dt>
                    <dd>{l.approval.by ? `${l.approval.by}, ${dateTimeLabel(l.approval.at ?? '')}${l.approval.comment ? `: ${l.approval.comment}` : ''}` : say(lang, 'Waiting for the HR Director or the CEO', 'Menunggu Pengarah HR atau CEO', 'Tunggu HR Director atau CEO')}</dd>
                  </div>
                )}
                {l.kind === 'data' && (
                  <div>
                    <dt>Rows</dt>
                    <dd>{say(lang, `${l.rowsInFile} in the file, ${l.loaded} ${l.approval ? 'sent' : 'loaded'}, ${l.refused.length} left out`, `${l.rowsInFile} dalam fail, ${l.loaded} ${l.approval ? 'dihantar' : 'dimuatkan'}, ${l.refused.length} tidak dimasukkan`)}</dd>
                  </div>
                )}
                {l.plan.length > 0 && (
                  <div>
                    <dt>Plan</dt>
                    <dd>{l.plan.map((p) => `${p.header || '-'} → ${p.field ?? say(lang, 'not used', 'tidak digunakan')}`).join('; ')}</dd>
                  </div>
                )}
              </dl>
              {l.refused.length > 0 && (
                <ul className="bl-sublist">
                  {l.refused.map((r) => (
                    <li key={r.row}>
                      <strong>{say(lang, `Row ${r.row}`, `Baris ${r.row}`, `Row ${r.row}`)}</strong> <span className="muted">{r.reasons.map((x) => why(lang, x)).join(' ')}</span>
                    </li>
                  ))}
                </ul>
              )}
              {l.placed.length > 0 && (
                <ul className="bl-sublist">
                  {l.placed.map((p) => (
                    <li key={p.docId}>
                      <strong>{p.file}</strong> <span className="muted">→ {p.person}</span>
                    </li>
                  ))}
                </ul>
              )}
              {l.held.length > 0 && (
                <ul className="bl-sublist">
                  {l.held.map((h, i) => (
                    <li key={i}>
                      <strong>{h.file}</strong> <span className="muted">{why(lang, h.reason)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

