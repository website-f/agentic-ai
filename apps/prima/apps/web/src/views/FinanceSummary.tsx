import { useState } from 'react';
import { api, type FinSummary } from '../api';
import { ErrorNotice, Loading, dateLabel, dateTimeLabel, useLoad } from '../ui';
import '../styles/fin-monitor.css';

/**
 * F3 (Fauzan, 11 Nov 2026): one page each month for the CEO instead of opening each company. All companies in rows, the
 * group total on top. Red only for: cash short within 4 weeks, bank reconciliation not done after the 10th, books not
 * closed after the 15th, unbilled sites, a site under its target margin. A figure from SQL Account older than 48 hours
 * shows Unknown, never a number. Read-only; print it from the browser.
 */

type Row = FinSummary['rows'][number];
const rm = (n: number | null) => (n == null ? '–' : `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);

function Money({ v }: { v: { value: number | null; unknown: boolean } }) {
  if (v.unknown) return <span className="fm-unknown">Unknown</span>;
  return <>{rm(v.value)}</>;
}

function Cells({ r }: { r: Row }) {
  return (
    <>
      <td className="fm-num">
        <Money v={r.cash} />
      </td>
      <td className={r.shortSoon ? 'fm-red' : undefined}>{r.shortWeek ? `Week of ${dateLabel(r.shortWeek)}` : r.cash.unknown ? <span className="fm-unknown">Unknown</span> : 'None in 13 weeks'}</td>
      <td className="fm-num">{rm(r.due30)}</td>
      <td className="fm-num">
        <Money v={r.over90} />
        {r.daysToCollect.value != null && <span className="fm-sub">{r.daysToCollect.value} days to collect</span>}
      </td>
      <td className={`fm-num${r.bankRec.late ? ' fm-red' : ''}`}>
        {r.bankRec.done} / {r.bankRec.total}
      </td>
      <td className={r.closed.late ? 'fm-red' : undefined}>{r.closed.done ? 'Closed' : r.closed.late ? 'Not closed' : 'Open'}</td>
      <td className="fm-num">{r.exceptions}</td>
      <td className={`fm-num${r.unbilled ? ' fm-red' : ''}`}>{r.unbilled}</td>
      <td className={`fm-num${r.belowTarget ? ' fm-red' : ''}`}>{r.belowTarget}{r.targetNotSet && <span className="fm-sub">target not set</span>}</td>
      <td>{r.packReviewed ? `${r.packReviewed.by}, ${dateTimeLabel(r.packReviewed.at)}` : 'Not reviewed'}</td>
    </>
  );
}

export function FinanceSummaryView() {
  const [period, setPeriod] = useState<string | undefined>(undefined);
  const { data, error } = useLoad(() => api.finSummary(period), [period]);
  return (
    <div className="page fm-page fm-summary">
      <header className="k-head fm-head">
        <div className="k-head-text">
          <h1>Monthly finance page</h1>
          <p className="k-head-sub">
            One page for every company, the group total on top. Red marks only cash short within 4 weeks, a bank reconciliation not done after the 10th,
            books not closed after the 15th, unbilled sites and sites below their target margin. Figures from SQL Account older than 48 hours show
            Unknown. Prima monitors only; SQL Account is the book of record.
          </p>
        </div>
        <div className="k-head-actions">
          {data && (
            <select className="select" aria-label="Month" value={data.period} onChange={(e) => setPeriod(e.target.value)}>
              {data.periods.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </header>
      {error ? (
        <ErrorNotice error={error} />
      ) : !data ? (
        <Loading what="the monthly finance page" />
      ) : (
        <>
          <p className="fm-print-title">
            Monthly finance page, {data.period} · printed {dateLabel(data.today)}
          </p>
          {!data.ready && (
            <div className="notice" data-tone="info">
              <span data-no-translate>{data.period}</span>: <span>the page is complete after the books close on the 15th; until then the figures are still moving.</span>
            </div>
          )}
          <section className="fm-card" aria-labelledby="fm-sum-h">
            <div className="fm-card-head">
              <div>
                <h2 id="fm-sum-h">
                  <span data-no-translate>{data.period}</span> · <span>Companies</span>: {data.rows.length}
                </h2>
                <p>
                  <span>Need attention</span>: {data.red} · <span>Cash is the latest bank statement balance; the short week comes from the 13-week forecast.</span>
                </p>
              </div>
            </div>
            <div className="fm-card-body">
              <div className="fm-table-wrap">
                <table className="fm-table fm-sum-table">
                  <thead>
                    <tr>
                      <th scope="col">Company</th>
                      <th scope="col" className="fm-num">
                        Cash today
                      </th>
                      <th scope="col">Cash runs short</th>
                      <th scope="col" className="fm-num">
                        Due in 30 days
                      </th>
                      <th scope="col" className="fm-num">
                        Debtors 90+ days
                      </th>
                      <th scope="col" className="fm-num">
                        Banks reconciled by 10th
                      </th>
                      <th scope="col">Books closed by 15th</th>
                      <th scope="col" className="fm-num">
                        Open exceptions
                      </th>
                      <th scope="col" className="fm-num">
                        Unbilled sites
                      </th>
                      <th scope="col" className="fm-num">
                        Sites below target
                      </th>
                      <th scope="col">Pack reviewed by</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr data-total>
                      <th scope="row">
                        Group total
                        {data.group.unknownCash > 0 && (
                          <span className="fm-sub">
                            <span>Unknown, not in the total</span>: {data.group.unknownCash}
                          </span>
                        )}
                      </th>
                      <Cells r={data.group.row} />
                    </tr>
                    {data.rows.map((r) => (
                      <tr key={r.companyId}>
                        <th scope="row">{r.company}</th>
                        <Cells r={r} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
