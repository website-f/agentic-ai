import { Select } from '../SearchSelect';
import { useState } from 'react';
import { api, type FinCeoSummary, type FinSiteProfit, type FinUnbilled } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateTimeLabel, useAction, useLoad } from '../ui';
import { Search } from '../kit';

/**
 * Finance monitoring F1-F3 (Fauzan, 11 Nov 2026): unbilled sites, profit per site against a target margin, and one page
 * a month for the CEO. Prima monitors only; SQL Account stays the book of record.
 */

const rm = (n: number | null | undefined) => (n == null ? 'Unknown' : `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const rmK = (n: number | null | undefined) => (n == null ? 'Unknown' : `RM${Math.round(n).toLocaleString('en-MY')}`);

function lastMonth() {
  const d = new Date(Date.now() + 8 * 3_600_000);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

// ---------- F1 ----------

type Flag = FinUnbilled['companies'][number]['rows'][number]['flags'][number];

export function UnbilledSitesPanel({ companyId }: { companyId?: string }) {
  const [month, setMonth] = useState(lastMonth());
  const [n, setN] = useState(0);
  const { data, error } = useLoad(() => api.finUnbilled(month), [month, n]);
  const act = useAction();
  const [clearing, setClearing] = useState<{ companyId: string; siteId: string; flag: Flag } | null>(null);
  const [reason, setReason] = useState('');
  // P105: with 100+ sites the list is searched and filtered, open flags first, and each company shows a few rows at first.
  const [q, setQ] = useState('');
  const [co, setCo] = useState('');
  const [openOnly, setOpenOnly] = useState(true);
  const [more, setMore] = useState<Record<string, boolean>>({});
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="unbilled sites" />;
  const companies = companyId ? data.companies.filter((c) => c.companyId === companyId) : data.companies;
  const needle = q.trim().toLowerCase();
  const shownCos = companies
    .filter((c) => !co || c.companyId === co)
    .map((c) => ({
      ...c,
      rows: c.rows.filter((r) => (!openOnly || r.flags.some((f) => !f.cleared)) && (!needle || `${r.siteName} ${r.contractRef ?? ''}`.toLowerCase().includes(needle))),
    }))
    .filter((c) => c.rows.length > 0);
  const PER_COMPANY = 15;
  const clear = async () => {
    if (!clearing) return;
    const r = await act.run(() => api.finClearUnbilled({ companyId: clearing.companyId, period: data.period, siteId: clearing.siteId, kind: clearing.flag.kind, reason }), 'Flag cleared.');
    if (r) {
      setClearing(null);
      setReason('');
      setN((x) => x + 1);
    }
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Every site with guards is billed, {data.period}</h3>
        <input className="input" type="month" style={{ width: 160 }} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />
      </div>
      <p className="muted small" style={{ padding: '0 12px' }}>
        From attendance: every site where guards clocked hours, and every site with a live contract. A flag is cleared only by a Finance reviewer with a reason, never by whoever recorded the invoice.
      </p>
      <ErrorNotice error={act.error} />
      <div className="kpis">
        <Kpi label="Sites flagged" value={companies.reduce((k, c) => k + c.sitesFlagged, 0)} tone={companies.some((c) => c.sitesFlagged) ? 'crit' : 'ok'} />
        <Kpi label="Open flags" value={companies.reduce((k, c) => k + c.open, 0)} tone={companies.some((c) => c.open) ? 'warn' : 'ok'} />
      </div>
      {companies.length === 0 && <p className="muted" style={{ padding: 12 }}>No site had guards or a live contract in {data.period}.</p>}
      {companies.length > 0 && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '8px 12px' }}>
          <Search value={q} onChange={setQ} placeholder="Search site or contract" label="Search site or contract" />
          {!companyId && companies.length > 1 && (
            <Select className="select" aria-label="Company" value={co} onChange={(e) => setCo(e.target.value)}>
              <option value="">All companies</option>
              {companies.map((c) => (
                <option key={c.companyId} value={c.companyId}>
                  {c.companyName}
                </option>
              ))}
            </Select>
          )}
          <label className="small row" style={{ gap: 6, alignItems: 'center', minHeight: 44 }}>
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Only sites with an open flag
          </label>
        </div>
      )}
      {companies.length > 0 && shownCos.length === 0 && (
        <p className="muted" style={{ padding: 12 }}>
          {openOnly && !needle && !co ? 'No open flags: every site is billed.' : 'No site matches.'}
        </p>
      )}
      {shownCos.map((c) => (
        <div key={c.companyId} style={{ overflowX: 'auto' }}>
          <h4 style={{ margin: '12px 12px 4px' }}>
            {c.companyName} <span className="muted small">({c.rows.length})</span>
          </h4>
          <table className="table">
            <thead>
              <tr>
                <th>Site</th>
                <th>Contract</th>
                <th style={{ textAlign: 'right' }}>Hours worked</th>
                <th style={{ textAlign: 'right' }}>Hours billed</th>
                <th style={{ textAlign: 'right' }}>Expected</th>
                <th style={{ textAlign: 'right' }}>Invoiced</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {(more[c.companyId] ? c.rows : c.rows.slice(0, PER_COMPANY)).map((r) => (
                <tr key={r.siteId}>
                  <td data-no-translate>{r.siteName}</td>
                  <td>
                    {r.contractRef ?? '–'}
                    {r.method && <span className="muted small"> {r.method}</span>}
                    {r.sharedSites > 1 && <span className="muted small"> ({r.sharedSites} sites)</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>{r.hoursWorked}</td>
                  <td style={{ textAlign: 'right' }}>
                    {r.hoursBilled ?? '–'}
                    {r.hoursDifference != null && r.hoursDifference !== 0 && <span className="muted small"> ({r.hoursDifference > 0 ? '+' : ''}{r.hoursDifference})</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>{r.expected == null ? '–' : rm(r.expected)}</td>
                  <td style={{ textAlign: 'right' }}>{r.invoice ? `${r.invoice.no} ${rm(r.invoice.amount)}` : '–'}</td>
                  <td>
                    {r.flags.length === 0 && <Chip tone="ok">Billed</Chip>}
                    {r.flags.map((f) => (
                      <div key={f.kind} style={{ marginBottom: 4 }}>
                        <Chip tone={f.cleared ? 'neutral' : 'crit'}>{f.label}</Chip> <span className="small">{f.text}</span>
                        {f.cleared ? (
                          <div className="muted small">
                            Cleared by {f.cleared.sign.by}, {dateTimeLabel(f.cleared.sign.at)}: {f.cleared.reason}
                          </div>
                        ) : clearing && clearing.companyId === c.companyId && clearing.siteId === r.siteId && clearing.flag.kind === f.kind ? (
                          // P105: the reason box opens under the flag itself, not at the foot of a long list.
                          <div className="panel" style={{ marginTop: 6 }}>
                            <label className="field">
                              <span>Why (needed, for example "free month in contract")</span>
                              <textarea className="textarea" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                            </label>
                            <button className="btn btn-sm btn-primary" disabled={act.busy || reason.trim().length < 10} onClick={clear}>
                              Clear the flag
                            </button>{' '}
                            <button className="btn btn-sm" onClick={() => setClearing(null)}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          data.canClear && (
                            <button className="link-button small" onClick={() => (setClearing({ companyId: c.companyId, siteId: r.siteId, flag: f }), setReason(''))}>
                              Clear with a reason
                            </button>
                          )
                        )}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {c.rows.length > PER_COMPANY && (
            <button className="btn btn-sm" style={{ margin: '6px 12px' }} onClick={() => setMore((m) => ({ ...m, [c.companyId]: !m[c.companyId] }))}>
              {more[c.companyId] ? 'Show fewer' : <>Show all <span className="muted">{c.rows.length}</span></>}
            </button>
          )}
        </div>
      ))}
    </section>
  );
}

// ---------- F2 ----------

type SiteRow = FinSiteProfit['sites'][number];

export function SiteProfitPanel() {
  const [month, setMonth] = useState(lastMonth());
  const [n, setN] = useState(0);
  const { data, error } = useLoad(() => api.finSiteProfit(month), [month, n]);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [underOnly, setUnderOnly] = useState(false);
  const [all, setAll] = useState(false);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="site profit" />;
  const needle = q.trim().toLowerCase();
  const rows = data.sites.filter((s) => (!underOnly || s.belowTarget || s.tone === 'crit') && (!needle || `${s.siteName} ${s.companyName}`.toLowerCase().includes(needle)));
  const PAGE = 25;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Profit per site, {data.month}</h3>
        <input className="input" type="month" style={{ width: 160 }} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />
      </div>
      <p className="notice" data-tone="info">
        {data.basis}. Costs: guard pay (overtime at the pay law rate), employer EPF, SOCSO, EIS and levy, hostel, Goodwill items, shared costs per guard and the management fee where the FD or the CEO says it comes off site profit.
      </p>
      <div className="kpis">
        <Kpi label="Sites under target" value={data.belowTarget} tone={data.belowTarget ? 'crit' : 'ok'} note={data.targets.group?.pct == null ? 'Group target not set' : `Group target ${data.targets.group.pct}%`} />
        <Kpi label="Sites" value={data.sites.length} tone="neutral" />
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '8px 12px' }}>
        <Search value={q} onChange={setQ} placeholder="Search site or company" label="Search site or company" />
        <label className="small row" style={{ gap: 6, alignItems: 'center', minHeight: 44 }}>
          <input type="checkbox" checked={underOnly} onChange={(e) => setUnderOnly(e.target.checked)} /> Only sites under target or at a loss
        </label>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Site</th>
              <th>Company</th>
              <th style={{ textAlign: 'right' }}>Revenue</th>
              <th style={{ textAlign: 'right' }}>Margin</th>
              <th style={{ textAlign: 'right' }}>Target</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(all ? rows : rows.slice(0, PAGE)).map((s) => (
              <SiteLine key={s.siteId} s={s} open={open === s.siteId} onOpen={() => setOpen(open === s.siteId ? null : s.siteId)} />
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="muted" style={{ padding: 12 }}>No site matches.</p>}
        {rows.length > PAGE && (
          <button className="btn btn-sm" style={{ margin: '6px 12px' }} onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : <>Show all <span className="muted">{rows.length}</span></>}
          </button>
        )}
      </div>
      {data.canSet && <TargetForm data={data} onSaved={() => setN((x) => x + 1)} />}
    </section>
  );
}

function SiteLine({ s, open, onOpen }: { s: SiteRow; open: boolean; onOpen: () => void }) {
  return (
    <>
      <tr onClick={onOpen} style={{ cursor: 'pointer' }}>
        <td data-no-translate>{s.siteName}</td>
        <td data-no-translate>{s.companyName}</td>
        <td style={{ textAlign: 'right' }}>{rmK(s.revenue)}</td>
        <td style={{ textAlign: 'right' }}>
          {rmK(s.margin)}
          {s.marginPct != null && <span className="muted small"> ({s.marginPct}%)</span>}
        </td>
        <td style={{ textAlign: 'right' }}>{s.target ? `${s.target.pct}%` : <span className="muted small">Target not set</span>}</td>
        <td>{s.belowTarget ? <Chip tone="crit">Under target by {s.belowTarget.gap} pts</Chip> : s.tone === 'unknown' ? <Chip tone="unknown">Incomplete</Chip> : <Chip tone={s.tone === 'crit' ? 'crit' : 'ok'}>{s.tone === 'crit' ? 'Loss' : 'OK'}</Chip>}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6}>
            <div className="small">
              <div>
                Hours paid {s.clockedHours}, hours billed {s.contractedHours}. Guard pay {rm(s.guardCost)}, employer contributions {rm(s.statutory)}, hostel {rm(s.hostel)}, Goodwill items {rm(s.itemCharges)}
                {s.sharedCosts.map((x) => `, ${x.label} ${x.amount == null ? 'rate not set' : rm(x.amount)}`).join('')}, management fee {s.managementFeeInProfit ? rm(s.managementFee) : 'not taken off'}.
              </div>
              {s.belowTarget?.why.map((w) => <div key={w}>• {w}</div>)}
              {s.notes.map((x) => (
                <div key={x} className="muted">
                  {x}
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function TargetForm({ data, onSaved }: { data: FinSiteProfit; onSaved: () => void }) {
  const act = useAction();
  const [companyId, setCompanyId] = useState('');
  const [pct, setPct] = useState('');
  const [reason, setReason] = useState('');
  const [rates, setRates] = useState<Record<string, string>>({});
  const [ratesWhy, setRatesWhy] = useState('');
  return (
    <div className="panel" style={{ margin: 12 }}>
      <h4>Target margin (the FD or the CEO, with a reason)</h4>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Select className="input" value={companyId} onChange={(e) => setCompanyId(e.target.value)} aria-label="For">
          <option value="">Group default</option>
          {data.targets.companies.map((c) => (
            <option key={c.companyId} value={c.companyId}>
              {c.name}
              {c.own?.pct != null ? ` (now ${c.own.pct}%)` : ''}
            </option>
          ))}
        </Select>
        <input className="input" style={{ width: 120 }} inputMode="decimal" placeholder="% (empty clears)" value={pct} onChange={(e) => setPct(e.target.value)} />
      </div>
      <label className="field">
        <span>Why</span>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <ErrorNotice error={act.error} />
      <button
        className="btn btn-primary"
        disabled={act.busy || reason.trim().length < 10}
        onClick={async () => {
          const r = await act.run(() => api.finSetSiteTarget({ companyId: companyId || null, pct: pct.trim() === '' ? null : Number(pct), reason }), 'Target saved.');
          if (r) {
            setPct('');
            setReason('');
            onSaved();
          }
        }}
      >
        Save target
      </button>
      <h4 style={{ marginTop: 16 }}>Shared costs per guard a month (RM)</h4>
      {Object.entries(data.costRates.labels).map(([k, label]) => (
        <div key={k} className="list-item" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span style={{ flex: '1 1 220px' }}>{label}</span>
          <input
            className="input"
            style={{ width: 140 }}
            inputMode="decimal"
            placeholder={(data.costRates.rates as Record<string, number | undefined>)[k] == null ? 'Rate not set' : String((data.costRates.rates as Record<string, number>)[k])}
            value={rates[k] ?? ''}
            onChange={(e) => setRates((x) => ({ ...x, [k]: e.target.value }))}
          />
        </div>
      ))}
      <label className="field">
        <span>Where the rates come from</span>
        <input className="input" value={ratesWhy} onChange={(e) => setRatesWhy(e.target.value)} />
      </label>
      <button
        className="btn"
        disabled={act.busy || ratesWhy.trim().length < 10 || !Object.values(rates).some((v) => v.trim())}
        onClick={async () => {
          const body: Record<string, number | null> = {};
          for (const [k, v] of Object.entries(rates)) if (v.trim()) body[k] = Number(v);
          const r = await act.run(() => api.finSetSiteCosts({ rates: body, reason: ratesWhy }), 'Rates saved.');
          if (r) {
            setRates({});
            setRatesWhy('');
            onSaved();
          }
        }}
      >
        Save rates
      </button>
    </div>
  );
}

// ---------- F3 ----------

type CeoRow = FinCeoSummary['rows'][number];

export function CeoSummaryTab() {
  const { data, error } = useLoad(() => api.finCeoSummary(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="the monthly page" />;
  const t = data.totals;
  const red = (r: CeoRow, k: string) => (r.red.includes(k) ? { color: 'var(--crit, #b42318)', fontWeight: 600 } : undefined);
  return (
    <div className="print-sheet">
      <div className="panel-head">
        <h3>Monthly finance page, {data.period}</h3>
        <button className="btn no-print" onClick={() => window.print()}>
          Print
        </button>
      </div>
      <p className="muted small">
        {data.ready ? 'Ready: the month closed on the 15th.' : 'Not final yet: the month closes on the 15th.'} A figure from SQL Account older than {data.staleHours} hours shows Unknown. Read-only.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" data-no-translate>
          <thead>
            <tr>
              <th>Company</th>
              <th style={{ textAlign: 'right' }}>Cash today</th>
              <th>Cash short from</th>
              <th style={{ textAlign: 'right' }}>Due in 30 days</th>
              <th style={{ textAlign: 'right' }}>Debtors over 90 days</th>
              <th style={{ textAlign: 'right' }}>Days to collect</th>
              <th>Banks reconciled</th>
              <th>Books closed</th>
              <th style={{ textAlign: 'right' }}>Open exceptions</th>
              <th style={{ textAlign: 'right' }}>Unbilled sites</th>
              <th style={{ textAlign: 'right' }}>Sites under target</th>
              <th>Pack reviewed by</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ fontWeight: 600 }}>
              <td>Group ({t.companies})</td>
              <td style={{ textAlign: 'right' }}>{t.cash == null ? `Unknown (${t.cashUnknown})` : rmK(t.cash)}</td>
              <td style={t.shortWithin4 ? { color: 'var(--crit, #b42318)' } : undefined}>{t.shortWithin4 ? `${t.shortWithin4} within 4 weeks` : '–'}</td>
              <td style={{ textAlign: 'right' }}>{rmK(t.due30)}</td>
              <td style={{ textAlign: 'right' }}>{rmK(t.over90)}</td>
              <td />
              <td>
                {t.bankRec.done} / {t.bankRec.total}
              </td>
              <td>
                {t.closed} / {t.companies}
              </td>
              <td style={{ textAlign: 'right' }}>{t.openExceptions}</td>
              <td style={{ textAlign: 'right', ...(t.unbilledSites ? { color: 'var(--crit, #b42318)' } : {}) }}>{t.unbilledSites}</td>
              <td style={{ textAlign: 'right', ...(t.belowTarget ? { color: 'var(--crit, #b42318)' } : {}) }}>{t.belowTarget}</td>
              <td>
                {t.reviewed} / {t.companies}
              </td>
            </tr>
            {data.rows.map((r) => (
              <tr key={r.companyId}>
                <td>{r.company}</td>
                <td style={{ textAlign: 'right' }}>{rmK(r.cash)}</td>
                <td style={red(r, 'cash')}>{r.firstShortWeek ?? '–'}</td>
                <td style={{ textAlign: 'right' }}>{rmK(r.due30)}</td>
                <td style={{ textAlign: 'right' }}>{rmK(r.over90)}</td>
                <td style={{ textAlign: 'right' }}>{r.daysToCollect == null ? 'Unknown' : r.daysToCollect}</td>
                <td style={red(r, 'bankRec')}>
                  {r.bankRec.done} / {r.bankRec.total}
                </td>
                <td style={red(r, 'close')}>{r.closed ? 'Closed' : r.closeStatus.replace('_', ' ')}</td>
                <td style={{ textAlign: 'right' }}>{r.openExceptions}</td>
                <td style={{ textAlign: 'right', ...red(r, 'unbilled') }}>{r.unbilledSites}</td>
                <td style={{ textAlign: 'right', ...red(r, 'belowTarget') }}>{r.belowTarget}</td>
                <td>{r.packReviewed ? `${r.packReviewed.by}, ${dateTimeLabel(r.packReviewed.at)}` : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function FinanceSitesTab() {
  return (
    <>
      <UnbilledSitesPanel />
      <SiteProfitPanel />
    </>
  );
}
