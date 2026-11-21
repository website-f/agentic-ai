import { Select } from '../SearchSelect';
import { useState } from 'react';
import { api, type FinCeoSummary, type FinSiteProfit, type FinUnbilled } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateTimeLabel, useAction, useLoad } from '../ui';
import { DataTable, type DtColumn, type DtFilter } from '../DataTable';

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

type UnbilledRow = FinUnbilled['companies'][number]['rows'][number];
/** P107: one table row: a site with its company (the table lists every company's sites together). */
type UnbilledLine = { companyId: string; companyName: string; r: UnbilledRow };

export function UnbilledSitesPanel({ companyId }: { companyId?: string }) {
  const [month, setMonth] = useState(lastMonth());
  const [n, setN] = useState(0);
  const { data, error } = useLoad(() => api.finUnbilled(month), [month, n]);
  const act = useAction();
  const [clearing, setClearing] = useState<{ companyId: string; siteId: string; flag: Flag } | null>(null);
  const [reason, setReason] = useState('');
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="unbilled sites" />;
  const companies = companyId ? data.companies.filter((c) => c.companyId === companyId) : data.companies;
  // P107: with 100+ sites the list is one data table (search, filters, sort, pages; cards on a phone) in place of a
  // table per company with its own "Show all"; it opens on the sites with an open flag, as the old tick box did.
  const lines: UnbilledLine[] = companies.flatMap((c) => c.rows.map((r) => ({ companyId: c.companyId, companyName: c.companyName, r })));
  const isOpen = (x: UnbilledLine) => x.r.flags.some((f) => !f.cleared);
  const openCount = lines.filter(isOpen).length;
  const flagLabels = new Map<string, string>();
  for (const x of lines) for (const f of x.r.flags) flagLabels.set(f.kind, f.label);
  const coNames = new Map(companies.map((c) => [c.companyId, c.companyName]));
  const several = !companyId && companies.length > 1;
  const clear = async () => {
    if (!clearing) return;
    const r = await act.run(() => api.finClearUnbilled({ companyId: clearing.companyId, period: data.period, siteId: clearing.siteId, kind: clearing.flag.kind, reason }), 'Flag cleared.');
    if (r) {
      setClearing(null);
      setReason('');
      setN((x) => x + 1);
    }
  };
  const clearingRow = (x: UnbilledLine) => !!clearing && clearing.companyId === x.companyId && clearing.siteId === x.r.siteId;
  const columns: DtColumn<UnbilledLine>[] = [
    { id: 'site', label: 'Site', value: (x) => x.r.siteName, phone: 'title', render: (x) => <span data-no-translate>{x.r.siteName}</span> },
    ...(several ? [{ id: 'company', label: 'Company', value: (x: UnbilledLine) => x.companyName, phone: 'sub' as const, hideBelow: 1100 }] : []),
    {
      id: 'contract',
      label: 'Contract',
      value: (x) => x.r.contractRef,
      phone: several ? 'hidden' : 'sub',
      render: (x) => (
        <>
          {x.r.contractRef ?? '–'}
          {x.r.method && <span className="muted small"> {x.r.method}</span>}
          {x.r.sharedSites > 1 && <span className="muted small"> ({x.r.sharedSites} sites)</span>}
        </>
      ),
    },
    { id: 'worked', label: 'Hours worked', value: (x) => x.r.hoursWorked, sort: 'number', render: (x) => x.r.hoursWorked },
    {
      id: 'billed',
      label: 'Hours billed',
      value: (x) => x.r.hoursBilled,
      sort: 'number',
      phone: 'hidden',
      render: (x) => (
        <>
          {x.r.hoursBilled ?? '–'}
          {x.r.hoursDifference != null && x.r.hoursDifference !== 0 && <span className="muted small"> ({x.r.hoursDifference > 0 ? '+' : ''}{x.r.hoursDifference})</span>}
        </>
      ),
    },
    { id: 'expected', label: 'Expected', value: (x) => x.r.expected, sort: 'money', render: (x) => (x.r.expected == null ? '–' : rm(x.r.expected)) },
    { id: 'invoiced', label: 'Invoiced', value: (x) => x.r.invoice?.amount, sort: 'money', render: (x) => (x.r.invoice ? `${x.r.invoice.no} ${rm(x.r.invoice.amount)}` : '–') },
    {
      id: 'flags',
      label: 'Flags',
      value: (x) => x.r.flags.map((f) => f.label).join(', ') || 'Billed',
      translate: true,
      sort: false,
      render: (x) => (
        <>
          {x.r.flags.length === 0 && <Chip tone="ok">Billed</Chip>}
          {x.r.flags.map((f) => (
            <div key={f.kind} style={{ marginBottom: 4 }}>
              <Chip tone={f.cleared ? 'neutral' : 'crit'}>{f.label}</Chip> <span className="small">{f.text}</span>
              {f.cleared ? (
                <div className="muted small">
                  Cleared by {f.cleared.sign.by}, {dateTimeLabel(f.cleared.sign.at)}: {f.cleared.reason}
                </div>
              ) : clearingRow(x) && clearing!.flag.kind === f.kind ? null : (
                data.canClear && (
                  <button className="link-button small" onClick={() => (setClearing({ companyId: x.companyId, siteId: x.r.siteId, flag: f }), setReason(''))}>
                    Clear with a reason
                  </button>
                )
              )}
            </div>
          ))}
        </>
      ),
    },
  ];
  const filters: DtFilter<UnbilledLine>[] = [
    {
      id: 'show',
      label: 'Show',
      value: (x) => (isOpen(x) ? 'open' : x.r.flags.length ? 'cleared' : 'billed'),
      options: [
        { value: 'open', label: 'Only sites with an open flag' },
        { value: 'cleared', label: 'Flags cleared' },
        { value: 'billed', label: 'Billed' },
      ],
    },
    { id: 'flag', label: 'Flags', value: (x) => x.r.flags.map((f) => f.kind), optionLabel: (k) => flagLabels.get(k) ?? k },
    ...(several ? [{ id: 'company', label: 'Company', value: (x: UnbilledLine) => x.companyId, optionLabel: (id: string) => coNames.get(id) ?? id, allLabel: 'All companies' }] : []),
  ];
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
      {companies.length > 0 && openCount === 0 && <p className="muted" style={{ padding: '0 12px' }}>No open flags: every site is billed.</p>}
      {companies.length > 0 && (
        <div style={{ padding: '0 12px 12px' }}>
          <DataTable
            label="Every site with guards is billed"
            stateKey={companyId ? 'company.unbilled' : 'fin.unbilled'}
            rows={lines}
            rowKey={(x) => `${x.companyId}:${x.r.siteId}`}
            columns={columns}
            filters={filters}
            defaults={openCount > 0 ? { f: { show: 'open' } } : undefined}
            searchPlaceholder="Search site or contract"
            rowDetail={(x) =>
              clearingRow(x) ? (
                // P105: the reason box opens under the site itself, not at the foot of a long list.
                <div className="panel" style={{ margin: 0 }}>
                  <div style={{ marginBottom: 6 }}>
                    <Chip tone="crit">{clearing!.flag.label}</Chip> <span className="small">{clearing!.flag.text}</span>
                  </div>
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
              ) : undefined
            }
          />
        </div>
      )}
    </section>
  );
}

// ---------- F2 ----------

type SiteRow = FinSiteProfit['sites'][number];

/** A site's state in words, as its chip says it (the filter and the sort use it). */
const siteStatus = (s: SiteRow) => (s.belowTarget ? 'Under target' : s.tone === 'unknown' ? 'Incomplete' : s.tone === 'crit' ? 'Loss' : 'OK');

const SITE_COLUMNS: DtColumn<SiteRow>[] = [
  { id: 'site', label: 'Site', value: (s) => s.siteName, phone: 'title', render: (s) => <span data-no-translate>{s.siteName}</span> },
  { id: 'company', label: 'Company', value: (s) => s.companyName, phone: 'sub', render: (s) => <span data-no-translate>{s.companyName}</span> },
  { id: 'revenue', label: 'Revenue', value: (s) => s.revenue, sort: 'money', render: (s) => rmK(s.revenue) },
  {
    id: 'margin',
    label: 'Margin',
    value: (s) => s.margin,
    sort: 'money',
    render: (s) => (
      <>
        {rmK(s.margin)}
        {s.marginPct != null && <span className="muted small"> ({s.marginPct}%)</span>}
      </>
    ),
  },
  { id: 'target', label: 'Target', value: (s) => s.target?.pct, sort: 'number', phone: 'hidden', render: (s) => (s.target ? `${s.target.pct}%` : <span className="muted small">Target not set</span>) },
  {
    id: 'status',
    label: 'Status',
    value: siteStatus,
    translate: true,
    render: (s) =>
      s.belowTarget ? <Chip tone="crit">Under target by {s.belowTarget.gap} pts</Chip> : s.tone === 'unknown' ? <Chip tone="unknown">Incomplete</Chip> : <Chip tone={s.tone === 'crit' ? 'crit' : 'ok'}>{s.tone === 'crit' ? 'Loss' : 'OK'}</Chip>,
  },
];
const SITE_FILTERS: DtFilter<SiteRow>[] = [
  { id: 'company', label: 'Company', value: (s) => s.companyName, allLabel: 'All companies' },
  {
    id: 'status',
    label: 'Status',
    // The old tick box "Only sites under target or at a loss" is the first choice.
    value: (s) => [...(s.belowTarget || s.tone === 'crit' ? ['needs'] : []), siteStatus(s)],
    options: [
      { value: 'needs', label: 'Only sites under target or at a loss' },
      { value: 'Under target', label: 'Under target' },
      { value: 'Loss', label: 'Loss' },
      { value: 'Incomplete', label: 'Incomplete' },
      { value: 'OK', label: 'OK' },
    ],
  },
];

export function SiteProfitPanel() {
  const [month, setMonth] = useState(lastMonth());
  const [n, setN] = useState(0);
  const { data, error } = useLoad(() => api.finSiteProfit(month), [month, n]);
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="site profit" />;
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
      {/* P107: one data table (search, filters, sort, pages; cards on a phone); a row still opens its cost detail under it. */}
      <div style={{ padding: '0 12px 12px' }}>
        <DataTable
          label="Profit per site"
          stateKey="fin.siteProfit"
          rows={data.sites}
          rowKey={(s) => s.siteId}
          columns={SITE_COLUMNS}
          filters={SITE_FILTERS}
          searchPlaceholder="Search site or company"
          onRowClick={(s) => setOpen(open === s.siteId ? null : s.siteId)}
          rowDetail={(s) => (open === s.siteId ? <SiteDetail s={s} /> : undefined)}
          empty={<p className="muted">No site matches.</p>}
        />
      </div>
      {data.canSet && <TargetForm data={data} onSaved={() => setN((x) => x + 1)} />}
    </section>
  );
}

function SiteDetail({ s }: { s: SiteRow }) {
  return (
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

const RED = { color: 'var(--crit, #b42318)', fontWeight: 600 } as const;
const red = (r: CeoRow, k: string) => (r.red.includes(k) ? RED : undefined);
const closeText = (r: CeoRow) => (r.closed ? 'Closed' : r.closeStatus.replace('_', ' '));
/** The figures a row shows in red, by the column that shows them. */
const RED_LABEL: Record<string, string> = { cash: 'Cash short from', bankRec: 'Banks reconciled', close: 'Books closed', unbilled: 'Unbilled sites', belowTarget: 'Sites under target' };

const CEO_COLUMNS: DtColumn<CeoRow>[] = [
  { id: 'company', label: 'Company', value: (r) => r.company, phone: 'title', render: (r) => <span data-no-translate>{r.company}</span> },
  { id: 'cash', label: 'Cash today', value: (r) => r.cash, sort: 'money', render: (r) => rmK(r.cash) },
  { id: 'short', label: 'Cash short from', value: (r) => r.firstShortWeek, phone: 'hidden', render: (r) => <span style={red(r, 'cash')}>{r.firstShortWeek ?? '–'}</span> },
  { id: 'due30', label: 'Due in 30 days', value: (r) => r.due30, sort: 'money', phone: 'hidden', render: (r) => rmK(r.due30) },
  { id: 'over90', label: 'Debtors over 90 days', value: (r) => r.over90, sort: 'money', render: (r) => rmK(r.over90) },
  { id: 'days', label: 'Days to collect', value: (r) => r.daysToCollect, sort: 'number', phone: 'hidden', render: (r) => (r.daysToCollect == null ? 'Unknown' : r.daysToCollect) },
  {
    id: 'bankRec',
    label: 'Banks reconciled',
    value: (r) => (r.bankRec.total ? r.bankRec.done / r.bankRec.total : null),
    sort: 'number',
    search: false,
    align: 'left',
    phone: 'hidden',
    render: (r) => (
      <span style={red(r, 'bankRec')}>
        {r.bankRec.done} / {r.bankRec.total}
      </span>
    ),
  },
  { id: 'close', label: 'Books closed', value: closeText, translate: true, render: (r) => <span style={red(r, 'close')}>{closeText(r)}</span> },
  { id: 'exceptions', label: 'Open exceptions', value: (r) => r.openExceptions, sort: 'number', phone: 'hidden', render: (r) => r.openExceptions },
  { id: 'unbilled', label: 'Unbilled sites', value: (r) => r.unbilledSites, sort: 'number', render: (r) => <span style={red(r, 'unbilled')}>{r.unbilledSites}</span> },
  { id: 'belowTarget', label: 'Sites under target', value: (r) => r.belowTarget, sort: 'number', phone: 'hidden', render: (r) => <span style={red(r, 'belowTarget')}>{r.belowTarget}</span> },
  {
    id: 'pack',
    label: 'Pack reviewed by',
    value: (r) => r.packReviewed?.by,
    phone: 'hidden',
    render: (r) => (r.packReviewed ? `${r.packReviewed.by}, ${dateTimeLabel(r.packReviewed.at)}` : '–'),
  },
];
const CEO_FILTERS: DtFilter<CeoRow>[] = [
  {
    id: 'books',
    label: 'Books closed',
    value: (r) => (r.closed ? 'closed' : 'open'),
    options: [
      { value: 'closed', label: 'Closed' },
      { value: 'open', label: 'Not closed' },
    ],
  },
  { id: 'red', label: 'Needs attention', value: (r) => r.red, optionLabel: (k) => RED_LABEL[k] ?? k },
];

export function CeoSummaryTab() {
  const { data, error } = useLoad(() => api.finCeoSummary(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="the monthly page" />;
  const t = data.totals;
  return (
    <div className="print-sheet">
      {/* P107: the table's search, filters and page buttons stay off the printed page (no stylesheet edit needed). */}
      <style>{'@media print { .print-sheet .dt-bar, .print-sheet .dt-foot { display: none; } }'}</style>
      <div className="panel-head">
        <h3>Monthly finance page, {data.period}</h3>
        <button className="btn no-print" onClick={() => window.print()}>
          Print
        </button>
      </div>
      <p className="muted small">
        {data.ready ? 'Ready: the month closed on the 15th.' : 'Not final yet: the month closes on the 15th.'} A figure from SQL Account older than {data.staleHours} hours shows Unknown. Read-only.
      </p>
      {/* P107: the group line (the old table's first row) sits above the companies table, figure for figure. */}
      <h4 style={{ margin: '12px 0 4px' }}>Group ({t.companies})</h4>
      <div className="kpis">
        <Kpi label="Cash today" value={t.cash == null ? `Unknown (${t.cashUnknown})` : rmK(t.cash)} />
        <Kpi label="Cash short from" value={t.shortWithin4 ? `${t.shortWithin4} within 4 weeks` : '–'} tone={t.shortWithin4 ? 'crit' : undefined} />
        <Kpi label="Due in 30 days" value={rmK(t.due30)} />
        <Kpi label="Debtors over 90 days" value={rmK(t.over90)} />
        <Kpi label="Banks reconciled" value={`${t.bankRec.done} / ${t.bankRec.total}`} />
        <Kpi label="Books closed" value={`${t.closed} / ${t.companies}`} />
        <Kpi label="Open exceptions" value={t.openExceptions} />
        <Kpi label="Unbilled sites" value={t.unbilledSites} tone={t.unbilledSites ? 'crit' : undefined} />
        <Kpi label="Sites under target" value={t.belowTarget} tone={t.belowTarget ? 'crit' : undefined} />
        <Kpi label="Pack reviewed by" value={`${t.reviewed} / ${t.companies}`} />
      </div>
      <DataTable
        label="Monthly finance page"
        stateKey="fin.ceoSummary"
        rows={data.rows}
        rowKey={(r) => r.companyId}
        columns={CEO_COLUMNS}
        filters={CEO_FILTERS}
        defaults={{ size: 50 }}
        searchPlaceholder="Search companies"
      />
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
