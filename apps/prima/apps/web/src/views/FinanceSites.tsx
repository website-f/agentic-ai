import { useState } from 'react';
import { api, type SiteMargins, type UnbilledSites } from '../api';
import { useApp } from '../App';
import { Chip, ErrorNotice, Loading, dateTimeLabel, useAction, useLoad } from '../ui';
import '../styles/fin-monitor.css';

/**
 * F1 and F2 (Fauzan, 11 Nov 2026): every site where guards worked is billed, and each site's profit against the target
 * margin. Prima monitors only: SQL Account stays the book of record and nothing here posts to it.
 */

const rm = (n: number | null | undefined) => (n == null ? 'Unknown' : `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const hrs = (n: number | null | undefined) => (n == null ? '–' : `${n.toLocaleString('en-MY', { maximumFractionDigits: 1 })} h`);
type Tab = 'unbilled' | 'margins';

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
  const { me } = useApp();
  // A company manager sees the billing check for their own company; profit per site is for Finance, the COO and the CEO.
  const margins = me.user.role !== 'company_manager';
  const [tab, setTab] = useState<Tab>('unbilled');
  return (
    <div className="page fm-page">
      <Head />
      {margins && (
        <div className="tabbar" role="tablist" aria-label="Site billing and profit">
          <button role="tab" aria-selected={tab === 'unbilled'} onClick={() => setTab('unbilled')}>
            Unbilled sites
          </button>
          <button role="tab" aria-selected={tab === 'margins'} onClick={() => setTab('margins')}>
            Profit per site
          </button>
        </div>
      )}
      {tab === 'unbilled' || !margins ? <Unbilled /> : <Margins />}
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

// ---------- F2: profit per site ----------

function Margins() {
  const [month, setMonth] = useState<string | undefined>(undefined);
  const { data, error } = useLoad(() => api.siteMargins(month), [month]);
  const [q, setQ] = useState('');
  const [below, setBelow] = useState(false);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="profit per site" />;
  const shown = data.sites.filter((s) => (!below || s.belowTarget) && (!q.trim() || `${s.siteName} ${s.companyName}`.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <>
      <div className="fm-tiles">
        <div className="fm-tile" data-tone={data.belowTarget ? 'crit' : undefined}>
          <span className="fm-tile-label">Sites below target</span>
          <span className="fm-tile-value">{data.belowTarget}</span>
          <span className="fm-tile-note">of {data.sites.length} sites in {data.month}</span>
        </div>
        <div className="fm-tile" data-tone={data.targetNotSet ? 'unknown' : undefined}>
          <span className="fm-tile-label">Target not set</span>
          <span className="fm-tile-value">{data.targetNotSet}</span>
          <span className="fm-tile-note">Companies with no target margin (FD or CEO, Rate book)</span>
        </div>
        <div className="fm-tile">
          <span className="fm-tile-label">Overtime rate used</span>
          <span className="fm-tile-value">{data.otRate}x</span>
          <span className="fm-tile-note">From the pay law in force</span>
        </div>
      </div>
      <section className="fm-card" aria-labelledby="fm-mar-h">
        <div className="fm-card-head">
          <div>
            <h2 id="fm-mar-h">Profit per site</h2>
            <p>{data.basis}</p>
          </div>
        </div>
        <div className="fm-card-body">
          <div className="fm-tools">
            <input className="input" type="month" aria-label="Month" value={data.month} max={data.month} onChange={(e) => setMonth(e.target.value || undefined)} />
            <input className="input" aria-label="Find a site or company" placeholder="Find a site or company" value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="check">
              <input type="checkbox" checked={below} onChange={(e) => setBelow(e.target.checked)} /> Below target only
            </label>
          </div>
          {shown.length === 0 ? (
            <p className="muted">No site matches this.</p>
          ) : (
            <div className="fm-table-wrap">
              <table className="fm-table">
                <thead>
                  <tr>
                    <th scope="col">Site</th>
                    <th scope="col" className="fm-num">
                      Revenue
                    </th>
                    <th scope="col" className="fm-num">
                      Cost
                    </th>
                    <th scope="col" className="fm-num">
                      Margin
                    </th>
                    <th scope="col" className="fm-num">
                      Target
                    </th>
                    <th scope="col">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((s) => (
                    <tr key={s.siteId} data-tone={s.belowTarget ? 'crit' : undefined}>
                      <th scope="row">
                        {s.siteName}
                        <span className="fm-sub">{s.companyName}</span>
                      </th>
                      <td className="fm-num">{rm(s.revenue)}</td>
                      <td className="fm-num">
                        {rm(s.totalCost)}
                        <span className="fm-sub">
                          pay {rm(s.guardCost)} · EPF/SOCSO/EIS {rm(s.statutory)} · shared {s.sharedCost == null ? 'Rate not set' : rm(s.sharedCost)}
                        </span>
                      </td>
                      <td className="fm-num">
                        <span className={s.belowTarget ? 'fm-red' : s.marginPct == null ? 'fm-unknown' : undefined}>{s.marginPct == null ? 'Unknown' : `${s.marginPct}%`}</span>
                        <span className="fm-sub">{rm(s.margin)}</span>
                      </td>
                      <td className="fm-num">{s.targetPct == null ? <span className="fm-notset">Target not set</span> : `${s.targetPct}%`}</td>
                      <td>
                        {s.why.length ? (
                          <ul className="fm-reasons">
                            {s.why.map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="fm-sub">{s.notes[0] ?? '–'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

