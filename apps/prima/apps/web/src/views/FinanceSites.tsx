import { useState } from 'react';
import { api, type UnbilledSites } from '../api';
import { Chip, ErrorNotice, Loading, dateTimeLabel, useAction, useLoad } from '../ui';
import '../styles/fin-monitor.css';

/**
 * F1 and F2 (Fauzan, 11 Nov 2026): every site where guards worked is billed, and each site's profit against the target
 * margin. Prima monitors only: SQL Account stays the book of record and nothing here posts to it.
 */

const rm = (n: number | null | undefined) => (n == null ? 'Unknown' : `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const hrs = (n: number | null | undefined) => (n == null ? '–' : `${n.toLocaleString('en-MY', { maximumFractionDigits: 1 })} h`);

function Head({ children }: { children?: React.ReactNode }) {
  return (
    <header className="k-head fm-head">
      <div className="k-head-text">
        <h1>Site billing and profit</h1>
        <p className="k-head-sub">
          Every site where guards clocked hours, checked against its contract, its invoice and the client&apos;s sign-off, and each site&apos;s profit against
          the target margin. An estimate from Prima data; SQL Account is the book of record.
        </p>
      </div>
      {children}
    </header>
  );
}

export function FinanceSitesView() {
  return (
    <div className="page fm-page">
      <Head />
      <Unbilled />
    </div>
  );
}

// ---------- F1: unbilled sites ----------

function Unbilled() {
  const [period, setPeriod] = useState<string | undefined>(undefined);
  const [n, setN] = useState(0);
  const { data, error } = useLoad(() => api.unbilledSites(period), [period, n]);
  const [q, setQ] = useState('');
  const [onlyFlagged, setOnlyFlagged] = useState(true);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="the billing check" />;
  const flagged = data.companies.reduce((s, c) => s + c.flagged, 0);
  const sites = data.companies.reduce((s, c) => s + c.rows.length, 0);
  return (
    <>
      <div className="fm-tiles">
        <div className="fm-tile" data-tone={flagged ? 'crit' : undefined}>
          <span className="fm-tile-label">Sites flagged</span>
          <span className="fm-tile-value">{flagged}</span>
          <span className="fm-tile-note">of {sites} sites where guards worked in {data.period}</span>
        </div>
        <div className="fm-tile">
          <span className="fm-tile-label">Companies</span>
          <span className="fm-tile-value">{data.companies.length}</span>
          <span className="fm-tile-note">You see these companies</span>
        </div>
        <div className="fm-tile">
          <span className="fm-tile-label">Invoice below hours worked</span>
          <span className="fm-tile-value">{data.diffPct}%</span>
          <span className="fm-tile-note">Flagged beyond this difference (Finance settings)</span>
        </div>
      </div>
      <section className="fm-card" aria-labelledby="fm-unb-h">
        <div className="fm-card-head">
          <div>
            <h2 id="fm-unb-h">Sites where guards worked</h2>
            <p>
              A site is flagged when guards worked but no contract covers it, its contract has no invoice for the month, the client&apos;s sign-off is
              missing or disputed, or an hours-worked invoice is below the hours times the rate. A Finance reviewer clears a flag with a reason, never the
              person who recorded the invoice.
            </p>
          </div>
        </div>
        <div className="fm-card-body">
          <div className="fm-tools">
            <select className="select" aria-label="Month" value={data.period} onChange={(e) => setPeriod(e.target.value)}>
              {data.periods.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <input className="input" aria-label="Find a site or company" placeholder="Find a site or company" value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="check">
              <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} /> Flagged only
            </label>
          </div>
          {data.companies.map((c) => {
            const rows = c.rows.filter(
              (r) => (!onlyFlagged || r.flagged) && (!q.trim() || `${r.siteName} ${c.companyName}`.toLowerCase().includes(q.trim().toLowerCase())),
            );
            if (!rows.length) return null;
            return (
              <div key={c.companyId} className="fm-table-wrap">
                <h3 className="fm-company">{c.companyName}</h3>
                <table className="fm-table">
                  <thead>
                    <tr>
                      <th scope="col">Site</th>
                      <th scope="col" className="fm-num">
                        Hours worked
                      </th>
                      <th scope="col" className="fm-num">
                        Hours billed
                      </th>
                      <th scope="col" className="fm-num">
                        Invoiced
                      </th>
                      <th scope="col">Check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.siteId} data-tone={r.flagged ? 'crit' : undefined}>
                        <th scope="row">
                          {r.siteName}
                          <span className="fm-sub">
                            {r.guards} guard(s){r.contracts.length ? ` · ${r.contracts.map((x) => x.ref).join(', ')}` : ''}
                          </span>
                        </th>
                        <td className="fm-num">{hrs(r.hoursWorked)}</td>
                        <td className="fm-num">
                          {hrs(r.hoursBilled)}
                          {r.hoursDifference != null && r.hoursDifference !== 0 && <span className="fm-sub">{r.hoursDifference > 0 ? `+${r.hoursDifference}` : r.hoursDifference} h</span>}
                        </td>
                        <td className="fm-num">
                          {r.invoiced == null ? '–' : rm(r.invoiced)}
                          {r.expected != null && <span className="fm-sub">hours give {rm(r.expected)}</span>}
                        </td>
                        <td>
                          {r.flags.length === 0 ? (
                            <Chip tone="ok">Billed</Chip>
                          ) : (
                            <ul className="fm-flags">
                              {r.flags.map((f) => (
                                <Flag key={f.key} f={f} companyId={c.companyId} canClear={c.canClear} onDone={() => setN((x) => x + 1)} />
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
          {sites === 0 && <p className="muted">No guard hours clocked in Prima for {data.period}.</p>}
        </div>
      </section>
    </>
  );
}

type FlagRow = UnbilledSites['companies'][number]['rows'][number]['flags'][number];
const FLAG_LABEL: Record<FlagRow['kind'], string> = {
  no_contract: 'Guards on site, no contract',
  not_invoiced: 'Worked, not invoiced',
  no_signoff: 'No client sign-off',
  below_hours: 'Invoice lower than hours worked',
};

function Flag({ f, companyId, canClear, onDone }: { f: FlagRow; companyId: string; canClear: boolean; onDone: () => void }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <li>
      <Chip tone={f.cleared ? 'neutral' : 'crit'}>{f.cleared ? `Cleared: ${FLAG_LABEL[f.kind]}` : FLAG_LABEL[f.kind]}</Chip>
      <span className="fm-sub">{f.text}</span>
      {f.cleared && (
        <span className="fm-sub">
          {f.cleared.by}, {dateTimeLabel(f.cleared.at)}: {f.cleared.reason}
        </span>
      )}
      {!f.cleared && canClear && !open && (
        <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
          Clear with a reason
        </button>
      )}
      {open && (
        <div className="fm-form">
          <label className="field fm-span">
            <span className="label">Reason (needed), for example &quot;free month in the contract&quot;</span>
            <input className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </label>
          <ErrorNotice error={act.error} />
          <div className="fm-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={act.busy || reason.trim().length < 5}
              onClick={async () => {
                if (await act.run(() => api.clearUnbilledFlag(companyId, { key: f.key, reason: reason.trim() }), 'Flag cleared.')) onDone();
              }}
            >
              Clear the flag
            </button>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
