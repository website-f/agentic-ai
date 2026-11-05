import { useState } from 'react';
import { api, type FinDashboard, type FinPack } from '../api';
import { BankIcon, CalendarCheckIcon, ChartLineUpIcon, MapPinIcon, PrinterIcon, ReceiptIcon, WarningOctagonIcon } from '@phosphor-icons/react';
import { Chip, ErrorNotice, Loading, dateLabel, useAction, useLoad } from '../ui';
import { Card, Stat, Stats } from '../kit';

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
    <>
      <div className="fin-stats3">
        <Stats>
          <Stat
            label="Short of cash within 13 weeks"
            value={data.attention.shortOfCash}
            tone={data.attention.shortOfCash ? 'crit' : 'ok'}
            note="Companies"
            icon={<WarningOctagonIcon size={18} />}
          />
          <Stat
            label="Invoices over 90 days"
            value={<span className="fin-fig">{rm(t.over90)}</span>}
            tone={t.over90 ? 'crit' : 'ok'}
            note={`${data.attention.over90} company(ies)`}
            icon={<ReceiptIcon size={18} />}
          />
          <Stat
            label="Months not closed"
            value={data.attention.closeOpen}
            tone={data.attention.closeOpen ? 'warn' : 'ok'}
            note={data.period}
            icon={<CalendarCheckIcon size={18} />}
          />
          <Stat
            label="Sites losing money"
            value={data.attention.lossSites}
            tone={data.attention.lossSites ? 'warn' : 'ok'}
            note="Estimate, see the pack"
            icon={<MapPinIcon size={18} />}
          />
          <Stat
            label="Cash in the bank"
            value={<span className="fin-fig">{rm(t.cash)}</span>}
            tone="ok"
            note={`End of ${data.period}, from statements loaded`}
            icon={<BankIcon size={18} />}
          />
          <Stat
            label="Profit this month"
            value={<span className="fin-fig">{rm(t.profitMonth)}</span>}
            tone={t.profitMonth < t.budgetProfitMonth ? 'warn' : 'ok'}
            note={`Budget ${rm(t.budgetProfitMonth)}; year to date ${rm(t.profitYtd)}`}
            icon={<ChartLineUpIcon size={18} />}
          />
        </Stats>
      </div>
      <Card title={`Companies, ${data.period}`} sub="Press a company for its monthly pack" flush>
        <table className="fin-table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Close</th>
              <th className="fin-num">Cash</th>
              <th className="fin-num">Profit (vs budget)</th>
              <th className="fin-num">Over 90 days</th>
              <th className="fin-num">Days to collect</th>
              <th className="fin-num">Payroll % of revenue</th>
              <th>Watch</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <DashRow
                key={r.companyId}
                r={r}
                selected={open === r.companyId}
                onOpen={() => {
                  setOpen(open === r.companyId ? null : r.companyId);
                  setTimeout(() => document.getElementById('fin-pack')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
                }}
              />
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td />
              <td className="fin-num">{rm(t.cash)}</td>
              <td className="fin-num">
                {rm(t.profitMonth)} <span className="muted">(budget {rm(t.budgetProfitMonth)})</span>
              </td>
              <td className="fin-num">{rm(t.over90)}</td>
              <td />
              <td />
              <td />
            </tr>
          </tfoot>
        </table>
      </Card>
      {open && (
        <div id="fin-pack" className="fin-anchor">
          <PackView companyId={open} />
        </div>
      )}
    </>
  );
}

function DashRow({ r, onOpen, selected }: { r: Row; onOpen: () => void; selected: boolean }) {
  const diff = vs(r.profitMonth, r.budgetProfitMonth);
  return (
    <tr className="fin-click" data-selected={selected ? 'yes' : undefined} onClick={onOpen}>
      <td>
        <button type="button" className="fin-link" aria-expanded={selected} onClick={(e) => (e.stopPropagation(), onOpen())} aria-label={`Open the monthly pack of ${r.company}`}>
          {r.company}
        </button>
      </td>
      <td>
        <Chip tone={r.closeStatus === 'approved' ? 'ok' : 'warn'}>{r.closeStatus === 'approved' ? 'Closed' : `Open (${r.openExceptions})`}</Chip>
      </td>
      <td className="fin-num">{r.cash == null ? 'no statement' : rm(r.cash)}</td>
      <td className="fin-num">
        {rm(r.profitMonth)}
        {diff != null && (
          <span className="muted">
            {' '}
            ({diff >= 0 ? '+' : ''}
            {rm(diff)})
          </span>
        )}
      </td>
      <td className="fin-num">{rm(r.over90)}</td>
      <td className="fin-num">{r.daysToCollect ?? '–'}</td>
      <td className="fin-num">{r.payrollPct == null ? '–' : `${r.payrollPct}%`}</td>
      <td>
        <span className="fin-chips">
          {r.firstShortWeek && <Chip tone="crit">Short from {dateLabel(r.firstShortWeek)}</Chip>}
          {r.lossSites > 0 && <Chip tone="warn">{r.lossSites} site(s) at a loss</Chip>}
          {r.packReviewed && <Chip tone="ok">Pack reviewed</Chip>}
        </span>
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
    <section className="k-card fin-pack" aria-label="Monthly pack">
      <div className="k-card-head">
        <div className="k-card-title">
          <h2>
            Monthly pack: {d.company}, {d.period}
          </h2>
          <p>
            Filled by Prima from Finance&apos;s records.{' '}
            {data.reviewed
              ? `Reviewed by ${data.reviewed.by} on ${dateLabel(data.reviewed.at.slice(0, 10))}: ${data.reviewed.comment}. Figures as reviewed.`
              : 'Not reviewed yet.'}
          </p>
        </div>
        <div className="k-card-actions">
          <select className="select" aria-label="Month" value={d.period} onChange={(e) => setPeriod(e.target.value)}>
            {data.periods.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <button type="button" className="btn btn-sm" onClick={() => window.print()}>
            <PrinterIcon size={14} aria-hidden="true" />
            Print
          </button>
        </div>
      </div>
      <div className="k-card-body fin-pack-body">
        <div className="fin-pack-grid">
          <section className="fin-pane fin-pane-wide">
            <h3>Profit against budget</h3>
            {pm ? (
              <div className="fin-scroll">
                <table className="fin-table fin-table-plain">
                  <thead>
                    <tr>
                      <th />
                      <th className="fin-num">Month</th>
                      <th className="fin-num">Budget</th>
                      <th className="fin-num">Year to date</th>
                      <th className="fin-num">Budget</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Revenue</td>
                      <td className="fin-num">{rm(pm.revenue)}</td>
                      <td className="fin-num">{rm(pm.budgetRevenue)}</td>
                      <td className="fin-num">{rm(py?.revenue)}</td>
                      <td className="fin-num">{rm(py?.budgetRevenue)}</td>
                    </tr>
                    <tr>
                      <td>Costs</td>
                      <td className="fin-num">{rm(pm.costs)}</td>
                      <td className="fin-num">{rm(pm.budgetCosts)}</td>
                      <td className="fin-num">{rm(py?.costs)}</td>
                      <td className="fin-num">{rm(py?.budgetCosts)}</td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row">Profit</th>
                      <td className="fin-num">{rm(pm.profit)}</td>
                      <td className="fin-num">{rm(pm.budgetProfit)}</td>
                      <td className="fin-num">{rm(py?.profit)}</td>
                      <td className="fin-num">{rm(py?.budgetProfit)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <p className="muted small">No budget or SQL Account figures for this year yet.</p>
            )}
          </section>
          <section className="fin-pane">
            <h3>Cash</h3>
            <div className="fin-lines">
              {d.cash.banks.map((b) => (
                <div key={b.bank} className="fin-line">
                  <span>{b.bank}</span>
                  <span className={b.closing == null ? 'muted small' : 'fin-num'}>{b.closing == null ? 'no statement loaded' : rm(b.closing)}</span>
                </div>
              ))}
              <div className="fin-line fin-line-total">
                <span>Total</span>
                <span className="fin-num">{rm(d.cash.total)}</span>
              </div>
            </div>
            <p className={d.cash.firstShortWeek ? 'small fin-crit' : 'muted small'}>
              {d.cash.firstShortWeek
                ? `Short of cash from the week of ${dateLabel(d.cash.firstShortWeek)} (lowest ${rm(d.cash.lowest13)})`
                : 'No shortfall in the next 13 weeks'}
            </p>
          </section>
          <section className="fin-pane">
            <h3>Invoices and collection</h3>
            {d.ar ? (
              <div className="fin-lines">
                <div className="fin-line">
                  <span>Owed by clients</span>
                  <span className="fin-num">{rm(d.ar.total)}</span>
                </div>
                <div className="fin-line">
                  <span>of which over 90 days</span>
                  <span className="fin-num">{rm(d.ar.over90)}</span>
                </div>
                <div className="fin-line">
                  <span>Invoice problem case(s) open</span>
                  <span className="fin-num">{d.ar.openCases}</span>
                </div>
              </div>
            ) : (
              <p className="muted small">No ageing for the month yet.</p>
            )}
            <div className="fin-lines">
              <div className="fin-line">
                <span>Days to collect</span>
                <span className="fin-num">{d.health.daysToCollect ?? '–'}</span>
              </div>
              <div className="fin-line">
                <span>Payroll of revenue</span>
                <span className="fin-num">{d.health.payrollPct == null ? '–' : `${d.health.payrollPct}%`}</span>
              </div>
            </div>
          </section>
          <section className="fin-pane">
            <h3>Loans and collateral</h3>
            {d.loans.length === 0 && d.intercompanyLoans.length === 0 && (
              <p className="muted small">No loans or hire purchase on the regular payments list.</p>
            )}
            <div className="fin-lines">
              {d.loans.map((l) => (
                <div key={l.name} className="fin-line">
                  <span>
                    {l.name}
                    <span className="muted small fin-block">
                      {l.remaining} left{l.outstandingEstimate != null ? ` (about ${rm(l.outstandingEstimate)})` : ''}
                    </span>
                  </span>
                  <span className="fin-num">{rm(l.instalment)} a month</span>
                </div>
              ))}
              {d.intercompanyLoans.map((l) => (
                <div key={l.with} className="fin-line">
                  <span>
                    Intercompany loan with {l.with} <span className="muted small">({l.status})</span>
                  </span>
                  <span className="fin-num">{rm(l.balance)}</span>
                </div>
              ))}
              <div className="fin-line">
                <span>Cash collateral held for guarantees ({d.collateral.items.length})</span>
                <span className="fin-num">{rm(d.collateral.total)}</span>
              </div>
            </div>
          </section>
        </div>
        <section className="fin-pane fin-pane-flat">
          <h3>Profit per site (estimate)</h3>
          <p className="muted small">
            Money collected where Prima knows it (government claims paid), else the month&apos;s invoice; less the guards&apos; cost and shared costs at{' '}
            {rm(d.health.perGuardCost)} a guard.
          </p>
          <div className="fin-scroll fin-framed">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Contract</th>
                  <th className="fin-num">Guards</th>
                  <th className="fin-num">Money</th>
                  <th className="fin-num">Cost</th>
                  <th className="fin-num">Profit</th>
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
                    <td className="fin-num">{s.guards}</td>
                    <td className="fin-num">
                      {rm(s.revenue)} {s.basis && <span className="muted">({s.basis})</span>}
                    </td>
                    <td className="fin-num">{rm(s.cost)}</td>
                    <td className="fin-num" data-neg={(s.profit ?? 0) < 0 ? 'yes' : undefined}>
                      {rm(s.profit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <ErrorNotice error={act.error} />
      </div>
      {data.mayReview && (
        <div className="k-card-foot fin-foot-form">
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
        <div className="k-card-foot fin-foot-note muted small">
          The pack is reviewed once the month&apos;s close is approved ({d.close.openExceptions} item(s) still open on the close).
        </div>
      )}
    </section>
  );
}
