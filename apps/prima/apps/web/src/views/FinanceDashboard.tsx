import { useState } from 'react';
import { api, type FinDashboard, type FinPack } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, useAction, useLoad } from '../ui';

/**
 * The Finance dashboard and each company's monthly pack (Fauzan, 2 Nov 2026: "bring out the key important data in a
 * dashboard"; suggestions 25 and 27). Prima fills everything; a reviewer signs the pack off once the month is closed.
 */

type Row = FinDashboard['rows'][number];
const rm = (n: number | null | undefined) => (n == null ? '–' : `RM${Math.round(n).toLocaleString('en-MY')}`);
const vs = (a: number | null, b: number | null) => (a == null || b == null ? null : a - b);

export function FinanceDashboardTab() {
  const { data, error } = useLoad(() => api.finDashboard(), []);
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="dashboard" />;
  const t = data.totals;
  return (
    <div>
      <div className="kpis">
        <Kpi label="Cash in the bank" value={rm(t.cash)} tone="ok" note={`End of ${data.period}, from statements loaded`} />
        <Kpi
          label="Profit this month"
          value={rm(t.profitMonth)}
          tone={t.profitMonth < t.budgetProfitMonth ? 'warn' : 'ok'}
          note={`Budget ${rm(t.budgetProfitMonth)}; year to date ${rm(t.profitYtd)}`}
        />
        <Kpi label="Invoices over 90 days" value={rm(t.over90)} tone={t.over90 ? 'crit' : 'ok'} note={`${data.attention.over90} company(ies)`} />
        <Kpi label="Short of cash within 13 weeks" value={data.attention.shortOfCash} tone={data.attention.shortOfCash ? 'crit' : 'ok'} note="Companies" />
        <Kpi label="Months not closed" value={data.attention.closeOpen} tone={data.attention.closeOpen ? 'warn' : 'ok'} note={data.period} />
        <Kpi label="Sites losing money" value={data.attention.lossSites} tone={data.attention.lossSites ? 'warn' : 'ok'} note="Estimate, see the pack" />
      </div>
      <section className="panel">
        <div className="panel-head">
          <h3>Companies, {data.period}</h3>
          <span className="muted small">Press a company for its monthly pack</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table small">
            <thead>
              <tr>
                <th>Company</th>
                <th>Close</th>
                <th style={{ textAlign: 'right' }}>Cash</th>
                <th style={{ textAlign: 'right' }}>Profit (vs budget)</th>
                <th style={{ textAlign: 'right' }}>Over 90 days</th>
                <th style={{ textAlign: 'right' }}>Days to collect</th>
                <th style={{ textAlign: 'right' }}>Payroll % of revenue</th>
                <th>Watch</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <DashRow
                  key={r.companyId}
                  r={r}
                  onOpen={() => {
                    setOpen(open === r.companyId ? null : r.companyId);
                    setTimeout(() => document.getElementById('fin-pack')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {open && (
        <div id="fin-pack">
          <PackView companyId={open} />
        </div>
      )}
    </div>
  );
}

function DashRow({ r, onOpen }: { r: Row; onOpen: () => void }) {
  const diff = vs(r.profitMonth, r.budgetProfitMonth);
  return (
    <tr onClick={onOpen} style={{ cursor: 'pointer' }}>
      <td>
        <button className="link-button" onClick={(e) => (e.stopPropagation(), onOpen())} aria-label={`Open the monthly pack of ${r.company}`}>
          {r.company}
        </button>
      </td>
      <td>
        <Chip tone={r.closeStatus === 'approved' ? 'ok' : 'warn'}>{r.closeStatus === 'approved' ? 'Closed' : `Open (${r.openExceptions})`}</Chip>
      </td>
      <td style={{ textAlign: 'right' }}>{r.cash == null ? 'no statement' : rm(r.cash)}</td>
      <td style={{ textAlign: 'right' }}>
        {rm(r.profitMonth)}
        {diff != null && (
          <span className="muted">
            {' '}
            ({diff >= 0 ? '+' : ''}
            {rm(diff)})
          </span>
        )}
      </td>
      <td style={{ textAlign: 'right' }}>{rm(r.over90)}</td>
      <td style={{ textAlign: 'right' }}>{r.daysToCollect ?? '–'}</td>
      <td style={{ textAlign: 'right' }}>{r.payrollPct == null ? '–' : `${r.payrollPct}%`}</td>
      <td>
        {r.firstShortWeek && <Chip tone="crit">Short from {dateLabel(r.firstShortWeek)}</Chip>}{' '}
        {r.lossSites > 0 && <Chip tone="warn">{r.lossSites} site(s) at a loss</Chip>} {r.packReviewed && <Chip tone="ok">Pack reviewed</Chip>}
      </td>
    </tr>
  );
}

function PackView({ companyId }: { companyId: string }) {
  const [period, setPeriod] = useState<string | undefined>(undefined);
  const { data, error } = useLoad(() => api.finPack(companyId, period), [companyId, period]);
  const act = useAction();
  const [comment, setComment] = useState('');
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="pack" />;
  const d = data.data;
  const pm = d.profit?.month;
  const py = d.profit?.ytd;
  return (
    <section className="panel" aria-label="Monthly pack">
      <div className="panel-head">
        <div>
          <h3>
            Monthly pack: {d.company}, {d.period}
          </h3>
          <div className="muted small">
            Filled by Prima from Finance&apos;s records.{' '}
            {data.reviewed
              ? `Reviewed by ${data.reviewed.by} on ${dateLabel(data.reviewed.at.slice(0, 10))}: ${data.reviewed.comment}. Figures as reviewed.`
              : 'Not reviewed yet.'}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <select className="select" aria-label="Month" value={d.period} onChange={(e) => setPeriod(e.target.value)}>
            {data.periods.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <button className="btn btn-sm" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </div>
      <div className="panel-body">
        <div className="grid2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
          <div>
            <h4>Profit against budget</h4>
            {pm ? (
              <table className="table small">
                <tbody>
                  <tr>
                    <th />
                    <th style={{ textAlign: 'right' }}>Month</th>
                    <th style={{ textAlign: 'right' }}>Budget</th>
                    <th style={{ textAlign: 'right' }}>Year to date</th>
                    <th style={{ textAlign: 'right' }}>Budget</th>
                  </tr>
                  <tr>
                    <td>Revenue</td>
                    <td style={{ textAlign: 'right' }}>{rm(pm.revenue)}</td>
                    <td style={{ textAlign: 'right' }}>{rm(pm.budgetRevenue)}</td>
                    <td style={{ textAlign: 'right' }}>{rm(py?.revenue)}</td>
                    <td style={{ textAlign: 'right' }}>{rm(py?.budgetRevenue)}</td>
                  </tr>
                  <tr>
                    <td>Costs</td>
                    <td style={{ textAlign: 'right' }}>{rm(pm.costs)}</td>
                    <td style={{ textAlign: 'right' }}>{rm(pm.budgetCosts)}</td>
                    <td style={{ textAlign: 'right' }}>{rm(py?.costs)}</td>
                    <td style={{ textAlign: 'right' }}>{rm(py?.budgetCosts)}</td>
                  </tr>
                  <tr>
                    <th>Profit</th>
                    <th style={{ textAlign: 'right' }}>{rm(pm.profit)}</th>
                    <th style={{ textAlign: 'right' }}>{rm(pm.budgetProfit)}</th>
                    <th style={{ textAlign: 'right' }}>{rm(py?.profit)}</th>
                    <th style={{ textAlign: 'right' }}>{rm(py?.budgetProfit)}</th>
                  </tr>
                </tbody>
              </table>
            ) : (
              <div className="muted small">No budget or SQL Account figures for this year yet.</div>
            )}
          </div>
          <div>
            <h4>Cash</h4>
            {d.cash.banks.map((b) => (
              <div key={b.bank} className="small">
                {b.bank}: {b.closing == null ? 'no statement loaded' : rm(b.closing)}
              </div>
            ))}
            <div className="small">
              <strong>Total {rm(d.cash.total)}</strong>
              {d.cash.firstShortWeek
                ? ` · short of cash from the week of ${dateLabel(d.cash.firstShortWeek)} (lowest ${rm(d.cash.lowest13)})`
                : ' · no shortfall in the next 13 weeks'}
            </div>
          </div>
          <div>
            <h4>Invoices and collection</h4>
            {d.ar ? (
              <div className="small">
                Owed by clients {rm(d.ar.total)}, of which over 90 days {rm(d.ar.over90)}; {d.ar.openCases} invoice problem case(s) open.
              </div>
            ) : (
              <div className="muted small">No ageing for the month yet.</div>
            )}
            <div className="small">
              Days to collect: {d.health.daysToCollect ?? '–'} · payroll {d.health.payrollPct == null ? '–' : `${d.health.payrollPct}%`} of revenue
            </div>
          </div>
          <div>
            <h4>Loans and collateral</h4>
            {d.loans.length === 0 && d.intercompanyLoans.length === 0 && (
              <div className="muted small">No loans or hire purchase on the regular payments list.</div>
            )}
            {d.loans.map((l) => (
              <div key={l.name} className="small">
                {l.name}: {rm(l.instalment)} a month, {l.remaining} left{l.outstandingEstimate != null ? ` (about ${rm(l.outstandingEstimate)})` : ''}
              </div>
            ))}
            {d.intercompanyLoans.map((l) => (
              <div key={l.with} className="small">
                Intercompany loan with {l.with}: {rm(l.balance)} ({l.status})
              </div>
            ))}
            <div className="small">
              Cash collateral held for guarantees: {rm(d.collateral.total)} ({d.collateral.items.length})
            </div>
          </div>
        </div>
        <h4>Profit per site (estimate)</h4>
        <div className="muted small">
          Money collected where Prima knows it (government claims paid), else the month&apos;s invoice; less the guards&apos; cost and shared costs at{' '}
          {rm(d.health.perGuardCost)} a guard.
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table small">
            <thead>
              <tr>
                <th>Contract</th>
                <th style={{ textAlign: 'right' }}>Guards</th>
                <th style={{ textAlign: 'right' }}>Money</th>
                <th style={{ textAlign: 'right' }}>Cost</th>
                <th style={{ textAlign: 'right' }}>Profit</th>
              </tr>
            </thead>
            <tbody>
              {d.health.sites.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No contracts ran this month.
                  </td>
                </tr>
              )}
              {d.health.sites.map((s) => (
                <tr key={s.contractId}>
                  <td>
                    {s.client} · {s.contractRef}
                  </td>
                  <td style={{ textAlign: 'right' }}>{s.guards}</td>
                  <td style={{ textAlign: 'right' }}>
                    {rm(s.revenue)} {s.basis && <span className="muted">({s.basis})</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>{rm(s.cost)}</td>
                  <td style={{ textAlign: 'right', color: (s.profit ?? 0) < 0 ? 'var(--crit, #b3261e)' : undefined }}>{rm(s.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.mayReview && (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            <input
              className="input"
              aria-label="Review comment"
              placeholder="Review comment for the board"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !comment.trim()}
              onClick={() => act.run(() => api.finControlAction(companyId, 'pack', 'review', { period: d.period, comment }), 'Pack reviewed for the board.')}
            >
              Reviewed for the board
            </button>
          </div>
        )}
        {!data.mayReview && !data.reviewed && d.close.status !== 'approved' && (
          <div className="muted small" style={{ marginTop: 8 }}>
            The pack is reviewed once the month&apos;s close is approved ({d.close.openExceptions} item(s) still open on the close).
          </div>
        )}
        <ErrorNotice error={act.error} />
      </div>
    </section>
  );
}
