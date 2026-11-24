import { useState } from 'react';
import { fromJaSalaryType2, isJaSalaryType2 } from '@prima/core';
import { api } from '../api';
import { useApp } from '../App';
import { ErrorNotice, useAction, useLoad } from '../ui';
import { parseCsv } from './JaSwitch';

/**
 * JA uploads (Fauzan, 23 Nov 2026: "Guard salary upload from ja app. And roaster builder and roaster uploaded from ja
 * app."; "OM uploads both"; "Let company also can upload. Which ever"). The roster is built in the JA Group app and the
 * salary is worked out there; the OM covering the site or the company office saves JA's export as CSV and uploads it here.
 */

const PAY_COLUMNS = ['staffNo', 'basic', 'otHours', 'otPay', 'allowances', 'epf', 'socso', 'eis', 'pcb', 'otherDeductions', 'gross', 'net', 'paidOn'];
const ROSTER_COLUMNS = ['staffNo', 'date', 'start', 'end', 'post'];

/** Column names in JA's file may be written "Staff No", "staff_no" or "STAFFNO"; they all read as staffNo. */
export function mapColumns(rows: Record<string, string>[], wanted: string[]): Record<string, string>[] {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const byKey = new Map(wanted.map((w) => [key(w), w]));
  return rows.map((r) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) {
      const w = byKey.get(key(k));
      if (w) out[w] = v;
    }
    return out;
  });
}

function templateHref(columns: string[]) {
  return `data:text/csv;charset=utf-8,${encodeURIComponent(columns.join(',') + '\n')}`;
}

type Result = { title: string; lines: string[]; rejected: { line: number; staffNo: string; reason: string }[] };

export function JaUploadsPanel() {
  const { me } = useApp();
  const opts = useLoad(() => api.jaUploadOptions(), []);
  const pay = useAction();
  const roster = useAction();
  const thisMonth = me.now.slice(0, 7);
  const [payCompany, setPayCompany] = useState('');
  const [payMonth, setPayMonth] = useState(thisMonth);
  const [payFile, setPayFile] = useState<{ name: string; rows: Record<string, string>[]; ja?: boolean } | null>(null);
  const [site, setSite] = useState('');
  const [rosterMonth, setRosterMonth] = useState(thisMonth);
  const [rosterFile, setRosterFile] = useState<{ name: string; rows: Record<string, string>[] } | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const o = opts.data;
  if (!o || (!o.payCompanies.length && !o.rosterSites.length)) return null;
  const companyId = payCompany || o.payCompanies[0]?.id || '';
  const siteId = site || o.rosterSites[0]?.id || '';

  const readFile = async (f: File | undefined, wanted: string[]) => {
    if (!f) return null;
    const raw = parseCsv(await f.text());
    // JA's own "Monthly Salary Type 2" report, saved as CSV, is read as it comes (Fauzan's sample files, 23 Nov 2026).
    if (wanted === PAY_COLUMNS && raw.length && isJaSalaryType2(Object.keys(raw[0]))) return { name: f.name, rows: fromJaSalaryType2(raw), ja: true };
    return { name: f.name, rows: mapColumns(raw, wanted), ja: false };
  };

  return (
    <section className="panel" style={{ padding: 12, marginBottom: 12 }}>
      <h2 style={{ marginTop: 0 }}>Upload from the JA app</h2>
      <p className="muted small">
        Build the roster and work out the salary in the JA Group app, save its export as CSV (Excel: Save As, CSV) and upload it here. The OM covering the site or
        the company office uploads, whichever is easier. Lines Prima cannot read are listed with the reason and nothing is guessed.
      </p>

      {o.rosterSites.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <strong>Roster</strong>
          <div className="muted small">
            Columns: {ROSTER_COLUMNS.join(', ')} (date YYYY-MM-DD, times like 07:00; an end before the start runs to the next day; post may be left empty when the site
            has one post). <a href={templateHref(ROSTER_COLUMNS)} download="ja-roster-template.csv">Template</a>
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            <select className="select" value={siteId} onChange={(e) => setSite(e.target.value)} style={{ maxWidth: 320 }}>
              {o.rosterSites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.companyName} · {s.name}
                </option>
              ))}
            </select>
            <input className="input" type="month" value={rosterMonth} onChange={(e) => setRosterMonth(e.target.value)} style={{ maxWidth: 160 }} />
            <input className="input" type="file" accept=".csv,text/csv" onChange={async (e) => setRosterFile(await readFile(e.target.files?.[0], ROSTER_COLUMNS))} />
            <button
              className="btn btn-primary btn-sm"
              disabled={roster.busy || !rosterFile || !siteId}
              onClick={async () => {
                const r = await roster.run(() => api.jaUploadRoster({ siteId, month: rosterMonth, fileName: rosterFile!.name, rows: rosterFile!.rows }), 'Roster uploaded');
                if (r)
                  setResult({
                    title: `Roster ${r.month}`,
                    lines: [`${r.published} duty line(s) published`, `${r.removed} earlier duty line(s) taken off from today`],
                    rejected: r.rejected,
                  });
              }}
            >
              Upload roster
            </button>
          </div>
          {rosterFile && <div className="muted small">{rosterFile.rows.length} line(s) read from {rosterFile.name}.</div>}
          <ErrorNotice error={roster.error} />
        </div>
      )}

      {o.payCompanies.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <strong>Guard salary</strong>
          <div className="muted small">
            Upload JA's Monthly Salary Type 2 report saved as CSV as it is, or a file with these columns: {PAY_COLUMNS.join(', ')} (amounts in RM; net must be gross less the deductions). Prima keeps it as JA's pay for the month and does not pay from
            it. <a href={templateHref(PAY_COLUMNS)} download="ja-salary-template.csv">Template</a>
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            <select className="select" value={companyId} onChange={(e) => setPayCompany(e.target.value)} style={{ maxWidth: 320 }}>
              {o.payCompanies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input className="input" type="month" value={payMonth} max={thisMonth} onChange={(e) => setPayMonth(e.target.value)} style={{ maxWidth: 160 }} />
            <input className="input" type="file" accept=".csv,text/csv" onChange={async (e) => setPayFile(await readFile(e.target.files?.[0], PAY_COLUMNS))} />
            <button
              className="btn btn-primary btn-sm"
              disabled={pay.busy || !payFile || !companyId}
              onClick={async () => {
                const r = await pay.run(() => api.jaUploadPay({ companyId, period: payMonth, fileName: payFile!.name, rows: payFile!.rows }), 'Salary file uploaded');
                if (r) setResult({ title: `Salary ${r.period}`, lines: [`${r.accepted} guard line(s) kept`, `Total net RM${r.totalNet.toFixed(2)}`], rejected: r.rejected });
              }}
            >
              Upload salary
            </button>
          </div>
          {payFile && (
            <div className="muted small">
              {payFile.rows.length} line(s) read from {payFile.name}
              {payFile.ja ? ' (JA Monthly Salary Type 2 report, read as it is)' : ''}.
            </div>
          )}
          <ErrorNotice error={pay.error} />
        </div>
      )}

      {result && (
        <div className="notice small" data-tone={result.rejected.length ? 'warn' : 'ok'}>
          <strong>{result.title}:</strong> {result.lines.join('; ')}; {result.rejected.length} line(s) refused.
          {result.rejected.slice(0, 50).map((x) => (
            <div key={x.line}>
              Line {x.line} ({x.staffNo}): {x.reason}
            </div>
          ))}
          {result.rejected.length > 50 && <div>… and {result.rejected.length - 50} more.</div>}
        </div>
      )}
    </section>
  );
}
