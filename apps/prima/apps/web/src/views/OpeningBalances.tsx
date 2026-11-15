import { useState } from 'react';
import { api } from '../api';
import { ErrorNotice, useAction, useLoad } from '../ui';

/**
 * Part N5 (Fitri package, 13 Nov 2026): opening balances for staff who started before Prima: leave taken this year
 * and year-to-date pay, as at the day before Prima. HR enters one or loads a file with a reason; a second HR person
 * checks each one before it counts on the leave screen and in the EA draft.
 */
export function OpeningBalancesButton({ companyId }: { companyId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-sm" onClick={() => setOpen((o) => !o)}>
        {open ? 'Close opening balances' : 'Opening balances'}
      </button>
      {open && <OpeningBalances companyId={companyId} />}
    </>
  );
}

const FIELDS: [string, string][] = [
  ['asAt', 'As at (YYYY-MM-DD)'],
  ['annual', 'Annual leave taken'],
  ['sick', 'Sick leave taken'],
  ['hospital', 'Hospital days taken'],
  ['unpaid', 'Unpaid leave'],
  ['gross', 'Gross pay to date (RM)'],
  ['epf', 'EPF employee (RM)'],
  ['socsoEis', 'SOCSO and EIS employee (RM)'],
  ['pcb', 'PCB (RM)'],
  ['zakat', 'Zakat (RM)'],
  ['months', 'Months paid'],
];

function OpeningBalances({ companyId }: { companyId: string }) {
  const v = useLoad(() => api.openingBalances(companyId), [companyId]);
  const act = useAction();
  const [edit, setEdit] = useState<string | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [csv, setCsv] = useState('');
  const [why, setWhy] = useState('');
  const [check, setCheck] = useState<Record<string, string>>({});
  return (
    <section className="panel" style={{ width: '100%' }}>
      <div className="panel-head">
        <h3>Opening balances (before Prima)</h3>
      </div>
      <p className="muted small" style={{ padding: '0 12px' }}>
        Leave already taken this year and pay to date before Prima. A second HR person checks each one; only then does it count in leave left and the EA form.
      </p>
      <ErrorNotice error={act.error ?? v.error} />
      <div style={{ padding: 12, display: 'grid', gap: 6 }}>
        <label className="field">
          <span>Load a file (CSV: staffNo, asAt, annual, sick, hospital, unpaid, gross, epf, socsoEis, pcb, zakat, months)</span>
          <input type="file" accept=".csv,text/csv" onChange={async (e) => setCsv((await e.target.files?.[0]?.text()) ?? '')} />
        </label>
        <label className="field">
          <span>Why (needed)</span>
          <input className="input" value={why} onChange={(e) => setWhy(e.target.value)} />
        </label>
        <button
          className="btn btn-sm"
          disabled={act.busy || !csv.trim()}
          onClick={() =>
            act
              .run(() => api.loadOpeningBalances(companyId, csv, why), (r) => {
                const x = r as { inFile: number; loaded: number; refused: unknown[] };
                return `${x.loaded} of ${x.inFile} loaded; ${x.refused.length} refused. Each now needs the second HR check.`;
              })
              .then((r) => r && (setCsv(''), v.reload()))
          }
        >
          Load the file
        </button>
      </div>
      <div className="list">
        {(v.data ?? []).map((p) => (
          <div key={p.personId} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
              <span>
                {p.staffNo} {p.name}
              </span>
              <button className="btn btn-sm" onClick={() => (setEdit(edit === p.personId ? null : p.personId), setF({}))}>
                {p.opening ? 'Change' : 'Enter'}
              </button>
            </div>
            {p.opening && (
              <div className="muted small">
                As at {p.opening.asAt}: annual {p.opening.leave.annual}, sick {p.opening.leave.sick}, hospital {p.opening.leave.hospital}, unpaid {p.opening.leave.unpaid} days; gross RM
                {p.opening.pay.gross.toFixed(2)}, PCB RM{p.opening.pay.pcb.toFixed(2)} · entered by {p.opening.by}
                {p.opening.checked ? ` · checked by ${p.opening.checked.by}` : ' · waiting for the second HR check'}
              </div>
            )}
            {p.mayCheck && (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <input className="input" aria-label="Check comment" placeholder="Comment (needed)" value={check[p.personId] ?? ''} onChange={(e) => setCheck((m) => ({ ...m, [p.personId]: e.target.value }))} />
                <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.checkOpeningBalance(p.personId, check[p.personId] ?? ''), 'Checked.').then((r) => r && v.reload())}>
                  Checked
                </button>
              </div>
            )}
            {edit === p.personId && (
              <div style={{ display: 'grid', gap: 6 }}>
                {FIELDS.map(([k, l]) => (
                  <label key={k} className="field">
                    <span>{l}</span>
                    <input className="input" value={f[k] ?? ''} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} />
                  </label>
                ))}
                <label className="field">
                  <span>Why (needed)</span>
                  <input className="input" value={f.reason ?? ''} onChange={(e) => setF((x) => ({ ...x, reason: e.target.value }))} />
                </label>
                <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => act.run(() => api.setOpeningBalance(p.personId, f), 'Saved. A second HR person checks it next.').then((r) => r && (setEdit(null), v.reload()))}>
                  Save
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
