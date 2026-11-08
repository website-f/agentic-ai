import { Select } from '../SearchSelect';
import { useContext, useEffect, useMemo, useState } from 'react';
import { CheckCircleIcon, DownloadSimpleIcon, FileXlsIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import {
  COMPANY_FIELD,
  IMPORTABLE_KINDS,
  RECORD_KINDS,
  cleanGrid,
  parseCsv,
  readXlsx,
  toCsv,
  type ImportKind,
  type OrgImportReceipt,
  type RecordKind,
  type XlsxSheet,
} from '@prima/core';
import { api, ApiError, type OrgImportPreview, type OrgImportTemplate } from '../api';
import { useApp } from '../App';
import { Steps, type StepState } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, RefreshContext, dateTimeLabel } from '../ui';
import { useRecordKinds } from './RecordForm';
import '../styles/import.css';

/**
 * P81: "Import" next to "Add". The old system's spreadsheet (Excel or CSV, any layout) goes in as it is: Prima finds the
 * header row, matches each column to the record's fields (shown, and changeable), checks every row through the same save
 * as the Add form without keeping anything, lets the person fix or skip rows, then imports the chosen rows all or none.
 */

const isRecordKind = (k: ImportKind): k is RecordKind => Object.prototype.hasOwnProperty.call(RECORD_KINDS, k);
const MAX_FILE = 8_000_000;
const MAX_CSV = 1_000_000;
const SEVERAL = '*';

/** The browser's own raw-deflate decoder, for the zip inside an .xlsx. */
async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function ImportButton({
  kind,
  companyId = null,
  label = 'Import',
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
        title="Load existing records from an Excel or CSV file"
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
const HOW: Record<string, [string, 'ok' | 'info' | 'warn' | 'neutral']> = {
  name: ['Same name', 'ok'],
  synonym: ['Known word', 'ok'],
  fuzzy: ['Close spelling', 'info'],
  shape: ['From the values', 'warn'],
  manual: ['You chose', 'neutral'],
};

type Err = { message: string; findings: [] } | null;
const errOf = (e: unknown): Err => ({ message: e instanceof ApiError || e instanceof Error ? e.message : String(e), findings: [] });

function ImportDrawer({
  kind,
  companyId: given,
  choices: offered,
  onClose,
}: {
  kind: ImportKind;
  companyId: string | null;
  choices?: [string, string][];
  onClose: () => void;
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
  const [grid, setGrid] = useState<string[][] | null>(null);
  const [preview, setPreview] = useState<OrgImportPreview | null>(null);
  const [mapping, setMapping] = useState<string[] | null>(null);
  const [headerRow, setHeaderRow] = useState<number | null>(null);
  const [skip, setSkip] = useState<number[]>([]);
  const [fixing, setFixing] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<OrgImportReceipt | null>(null);

  useEffect(() => {
    let live = true;
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
  const csv = useMemo(() => (grid ? toCsv(grid) : ''), [grid]);

  async function check(over: { mapping?: string[] | null; headerRow?: number | null; skip?: number[]; grid?: string[][] } = {}, next: Step = 'check') {
    const g = over.grid ?? grid;
    if (!g) return;
    const body = toCsv(g);
    if (body.length > MAX_CSV) return setError(errOf('The sheet is too big for one import. Split it into files of up to 500 rows.'));
    const m = over.mapping === undefined ? mapping : over.mapping;
    const h = over.headerRow === undefined ? headerRow : over.headerRow;
    const s = over.skip ?? skip;
    setBusy(`Checking ${Math.max(0, g.length - 1)} row${g.length === 2 ? '' : 's'} against the form's own rules…`);
    setError(null);
    try {
      const p = await api.org.importPreview(kind, cid, body, { mapping: m, headerRow: h, skip: s });
      setPreview(p);
      setMapping(p.columns.map((c) => c.field ?? ''));
      setHeaderRow(p.headerRow);
      setStep(next);
    } catch (e) {
      setError(errOf(e));
    } finally {
      setBusy(null);
    }
  }

  async function readFile(f: File | undefined) {
    if (!f) return;
    setError(null);
    if (f.size > MAX_FILE) return setError(errOf('The file is too big. Keep only the sheet you need, up to 500 rows.'));
    const name = f.name.toLowerCase();
    if (name.endsWith('.xls') || name.endsWith('.numbers') || name.endsWith('.ods'))
      return setError(errOf('Prima reads Excel .xlsx and CSV files. Open this file in Excel and save it as .xlsx (Excel Workbook).'));
    setBusy('Reading the file…');
    try {
      let rows: string[][];
      if (name.endsWith('.csv') || name.endsWith('.txt') || f.type === 'text/csv') {
        rows = cleanGrid(parseCsv(await f.text()));
        setSheets(null);
      } else {
        const all = (await readXlsx(new Uint8Array(await f.arrayBuffer()), inflateRaw)).map((s) => ({ ...s, rows: cleanGrid(s.rows) }));
        const first = Math.max(0, all.findIndex((s) => s.rows.length > 1));
        setSheets(all);
        setSheet(first);
        rows = all[first].rows;
      }
      setFileName(f.name);
      await loadGrid(rows);
    } catch (e) {
      setError(errOf(e));
    } finally {
      setBusy(null);
    }
  }

  async function loadGrid(rows: string[][]) {
    if (rows.length < 2) return setError(errOf('This sheet has no rows under the column names.'));
    setGrid(rows);
    setSkip([]);
    setFixing(null);
    setPreview(null);
    await check({ grid: rows, mapping: null, headerRow: null, skip: [] }, 'map');
  }

  async function commit() {
    if (!preview || !grid) return;
    setBusy(`Importing ${preview.okRows} row${preview.okRows === 1 ? '' : 's'}. All of them are saved, or none…`);
    setError(null);
    try {
      const r = await api.org.importCommit(kind, cid, csv, preview.fingerprint, { mapping, headerRow, skip });
      setReceipt(r);
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

  return (
    <Drawer title={tpl ? `Import: ${tpl.label.toLowerCase()} records` : 'Import'} sub={tpl ? `Kept by: ${tpl.keptBy}` : undefined} onClose={close}>
      <Steps
        steps={[
          { label: 'Choose the file', state: stepState('file') },
          { label: 'Match the columns', state: stepState('map') },
          { label: 'Check the rows', state: stepState('check') },
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
            Use the file from the old system as it is: Excel (.xlsx) or CSV, any column order, English or Malay column names, a title above the
            table is fine. Prima matches the columns, you check them, then every row is checked exactly as the Add form checks it. Nothing is saved
            until you press Import.
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
          <label className={`imp-drop${ready ? '' : ' imp-drop-off'}`}>
            <FileXlsIcon size={28} aria-hidden="true" />
            <strong>{fileName || 'Choose an Excel or CSV file'}</strong>
            <span className="muted small">.xlsx or .csv, up to 500 rows</span>
            <input
              type="file"
              accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={!ready || !!busy}
              aria-label="Excel or CSV file"
              onChange={(e) => {
                void readFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          <TemplateLink tpl={tpl} />
        </div>
      )}

      {tpl && step === 'map' && preview && grid && (
        <div className="imp-step">
          {sheets && sheets.length > 1 && (
            <label className="field">
              <span className="label">Sheet</span>
              <Select
                className="select"
                value={sheet}
                onChange={(e) => {
                  const i = Number(e.target.value);
                  setSheet(i);
                  void loadGrid(sheets[i].rows);
                }}
              >
                {sheets.map((s, i) => (
                  <option key={i} value={i}>
                    {s.name} ({Math.max(0, s.rows.length - 1)} rows)
                  </option>
                ))}
              </Select>
            </label>
          )}
          <label className="field">
            <span className="label">The column names are on</span>
            <Select
              className="select"
              value={preview.headerRow}
              onChange={(e) => void check({ headerRow: Number(e.target.value), mapping: null, skip: [] }, 'map')}
            >
              {grid.slice(0, 15).map((r, i) => (
                <option key={i} value={i}>
                  Row {i + 1}: {r.filter((c) => c.trim()).slice(0, 4).join(' · ').slice(0, 70)}
                </option>
              ))}
            </Select>
          </label>
          {preview.missingColumns.length > 0 && (
            <p className="notice" data-tone="crit">
              No column is matched to: {preview.missingColumns.join(', ')}. Choose the column for each below; these are needed.
            </p>
          )}
          <ul className="imp-cols">
            {preview.columns.map((c, i) => {
              const how = c.field ? HOW[c.how ?? 'manual'] : null;
              return (
                <li key={c.index} className="imp-col" data-used={c.field ? 'yes' : 'no'}>
                  <div className="imp-col-head">
                    <strong>{c.header || `Column ${c.index + 1}`}</strong>
                    {how && <Chip tone={how[1]}>{how[0]}</Chip>}
                  </div>
                  {c.sample.length > 0 && <span className="imp-col-sample">{c.sample.join(' · ')}</span>}
                  <Select
                    className="select"
                    aria-label={`Field for column ${c.header || c.index + 1}`}
                    value={mapping?.[i] ?? ''}
                    onChange={(e) => {
                      const m = [...(mapping ?? preview.columns.map((x) => x.field ?? ''))];
                      // One column per field: choosing a field here frees it from any other column.
                      const v = e.target.value;
                      for (let j = 0; j < m.length; j++) if (v && m[j] === v) m[j] = '';
                      m[i] = v;
                      setMapping(m);
                    }}
                  >
                    <option value="">Not used</option>
                    {preview.fields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.key === COMPANY_FIELD ? 'Company (each row to the company it names)' : f.label}
                        {f.required ? ' (needed)' : ''}
                      </option>
                    ))}
                  </Select>
                </li>
              );
            })}
          </ul>
          <div className="imp-actions">
            <button className="btn" disabled={!!busy} onClick={() => setStep('file')}>
              Back
            </button>
            <button className="btn btn-primary" disabled={!!busy} onClick={() => void check({}, 'check')}>
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
            setGrid(g);
            setFixing(null);
            void check({ grid: g });
          }}
          onBack={() => setStep('map')}
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
            checks and is in the audit log. The receipt ({receipt.id}) stops the same file being imported twice.
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
  onSkip: (row: number, on: boolean) => void;
  onFix: (row: number, cells: Record<number, string>) => void;
  onBack: () => void;
  onImport: () => void;
}) {
  const bad = preview.rows.filter((r) => !r.ok && !r.skipped);
  const skipped = preview.rows.filter((r) => r.skipped);
  const good = preview.rows.filter((r) => r.ok);
  const used = preview.columns.filter((c) => c.field);
  const label = (key: string) => preview.fields.find((f) => f.key === key)?.label ?? key;
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
