import { useState } from 'react';
import { finOpenRevision } from '@prima/core';
import { api, type FinControls } from '../api';
import { Chip, ErrorNotice, useAction, type Tone } from '../ui';

/**
 * Budget revisions and three-statement forecasts (masterplan section 08, items 76 and 78; 3 Nov 2026). The service checks who
 * may do each step: the team leader or deputy drafts a revision, the Finance Director and the CEO both approve it; a
 * forecast is prepared by Finance and approved by the FD or the CEO, never by whoever prepared or sent it.
 */

type PV = FinControls['plan'];
const rm = (n: number | null | undefined) => (n == null ? '–' : `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const LINES = [
  'revenue',
  'guard_cost',
  'staff_cost',
  'statutory',
  'premises',
  'vehicles',
  'equipment',
  'insurance',
  'other_opex',
  'finance_cost',
  'tax',
  'capex',
] as const;
const OPENING = ['cash', 'receivables', 'inventory', 'fixedAssets', 'otherAssets', 'payables', 'borrowings', 'otherLiabilities', 'equity'] as const;
const PERIOD = [
  'revenue',
  'operatingCosts',
  'depreciation',
  'financeCost',
  'tax',
  'capex',
  'disposals',
  'receivables',
  'inventory',
  'otherAssets',
  'payables',
  'otherLiabilities',
  'borrowingsIn',
  'borrowingsRepaid',
  'dividends',
  'equityIn',
] as const;
const tone = (s: string): Tone => (s === 'approved' ? 'ok' : s === 'returned' ? 'crit' : s === 'superseded' || s === 'withdrawn' ? 'info' : 'warn');

/** "120000" spreads evenly over 12 months; 12 numbers give each month. */
function twelve(s: string): number[] | null {
  const parts = s
    .split(/[,;\s]+/)
    .filter(Boolean)
    .map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 12) return parts;
  if (parts.length !== 1) return null;
  const each = Math.round((parts[0] / 12) * 100) / 100;
  return Array.from({ length: 12 }, (_, i) => (i < 11 ? each : Math.round((parts[0] - each * 11) * 100) / 100));
}

export function Plan3({ v, pv, canAct, me }: { v: FinControls; pv: PV; canAct: boolean; me: string }) {
  const act = useAction();
  const role = v.planRole;
  const approver = role === 'director' || role === 'ceo';
  const preparer = role === 'leader' || role === 'deputy' || approver;
  const drafter = preparer;
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  // The input is built inside the action, so a typing mistake shows as an error instead of breaking the page.
  const go = (action: string, input: Record<string, unknown> | (() => Record<string, unknown>), msg: string) =>
    act.run(async () => api.finControlAction(v.companyId, 'plan', action, { year: pv.year, ...(typeof input === 'function' ? input() : input) }), msg);
  const revFigures = () => {
    const out: Record<string, number[]> = {};
    for (const l of LINES) {
      const t = (f[`rev-${l}`] ?? '').trim();
      if (!t) continue;
      const m = twelve(t);
      if (!m) throw new Error(`${l}: give one yearly amount or 12 monthly amounts.`);
      out[l] = m;
    }
    return out;
  };
  const num = (k: string) => Number((f[k] ?? '').replace(/,/g, '')) || 0;
  const fc3Input = () => {
    const rows = (f.fcQuarters ?? '')
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
    const periods = rows.map((r, i) => {
      const n = r.split(/[,;\t]+/).map((x) => Number(x.trim()));
      if (n.length !== PERIOD.length || n.some((x) => !Number.isFinite(x)))
        throw new Error(`Quarter ${i + 1}: give ${PERIOD.length} amounts in the order shown.`);
      return Object.fromEntries(PERIOD.map((k, j) => [k, n[j]]));
    });
    return {
      kind: f.fcKind || 'quarterly',
      asOf: f.fcAsOf || v.period,
      scenario: f.fcScenario || 'base',
      assumptions: f.fcAssumptions,
      openingSource: f.fcSource,
      opening: Object.fromEntries(OPENING.map((k) => [k, num(`op-${k}`)])),
      periods,
    };
  };
  if (pv.plan?.budget.status !== 'approved') return null;
  const open = finOpenRevision(pv.revisions);
  return (
    <div className="fin-pad">
      <ErrorNotice error={act.error} />
      <h4 className="fin-my">Budget revisions</h4>
      <p className="muted small">
        The approved budget is kept as it is. A revision applies from an open month onward once the Finance Director or the CEO approves it with a comment
        (either is enough); whoever drafted or sent it does not approve it, and the FD and the CEO never both write the same revision.
      </p>
      {pv.revisions.map((r) => (
        <div key={r.no} className="list-item small">
          <Chip tone={tone(r.status)}>{r.status}</Chip>
          <span>
            Revision {r.no} from {r.fromMonth}: {r.reason} · drafted by {r.prepared.by}
            {r.fdApproved ? ` · approved by the FD (${r.fdApproved.by}): "${r.fdApproved.comment}"` : ''}
            {r.ceoApproved ? ` · approved by the CEO (${r.ceoApproved.by}): "${r.ceoApproved.comment}"` : ''}
            {r.status === 'submitted' ? ' · waiting for the FD or the CEO' : ''}
            {r.returned && r.status === 'returned' ? ` · returned by ${r.returned.by}: "${r.returned.comment}"` : ''}
          </span>
          {canAct && ['draft', 'submitted', 'returned'].includes(r.status) && (r.authorIds.includes(me) || r.submitted?.byId === me) && (
            <span className="row">
              <input
                className="input"
                aria-label="Withdraw reason"
                placeholder="Why withdraw (10+ characters)"
                value={f[`rw-${r.no}`] ?? ''}
                onChange={set(`rw-${r.no}`)}
              />
              <button
                className="btn btn-sm"
                disabled={act.busy || (f[`rw-${r.no}`] ?? '').trim().length < 10}
                onClick={() => go('withdrawRevision', { no: r.no, comment: f[`rw-${r.no}`] }, 'Revision withdrawn.')}
              >
                Withdraw
              </button>
            </span>
          )}
          {canAct && approver && r.status === 'submitted' && !r.authorIds.includes(me) && !(role === 'director' ? r.fdApproved : r.ceoApproved) && (
            <span className="row">
              <input
                className="input"
                aria-label="Revision comment"
                placeholder="Comment (needed; 10+ to return)"
                value={f[`rc-${r.no}`] ?? ''}
                onChange={set(`rc-${r.no}`)}
              />
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy || !(f[`rc-${r.no}`] ?? '').trim()}
                onClick={() => go('approveRevision', { no: r.no, comment: f[`rc-${r.no}`] }, 'Revision approved.')}
              >
                Approve
              </button>
              <button
                className="btn btn-sm"
                disabled={act.busy || (f[`rc-${r.no}`] ?? '').trim().length < 10}
                onClick={() => go('returnRevision', { no: r.no, comment: f[`rc-${r.no}`] }, 'Revision returned.')}
              >
                Return
              </button>
            </span>
          )}
        </div>
      ))}
      {canAct && drafter && open?.status === 'draft' && (
        <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => go('submitRevision', {}, 'Revision sent to the FD and the CEO.')}>
          Send revision {open.no} for approval
        </button>
      )}
      {canAct && drafter && open?.status !== 'submitted' && (
        <details>
          <summary>{open ? `Change revision ${open.no}` : 'Draft a budget revision'}</summary>
          <label className="field">
            <span>First month it applies (an open month, YYYY-MM)</span>
            <input className="input" value={f.revFrom ?? ''} onChange={set('revFrom')} placeholder={`${pv.year}-12`} />
          </label>
          {LINES.map((l) => (
            <label key={l} className="field">
              <span>{l} (one yearly amount or 12 monthly amounts; earlier months keep the budget in force)</span>
              <input className="input" value={f[`rev-${l}`] ?? ''} onChange={set(`rev-${l}`)} />
            </label>
          ))}
          <label className="field">
            <span>Why the budget is revised (10+ characters)</span>
            <textarea className="textarea" rows={2} value={f.revReason ?? ''} onChange={set('revReason')} />
          </label>
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() => go('revise', () => ({ fromMonth: f.revFrom, months: revFigures(), reason: f.revReason }), 'Revision saved.')}
          >
            Save revision
          </button>
        </details>
      )}

      <h4 className="fin-subhead">Three-statement forecasts</h4>
      <p className="muted small">
        Profit and loss, balance sheet and cash flow, linked: Prima works the cash flow out from the profit and the balance sheet movements, and the closing
        cash ties to the balance sheet. The opening must balance and agree to the reviewed SQL Account figures for that month, including the cash, when there
        are any. The FD or the CEO approves, never whoever prepared or sent it.
      </p>
      {pv.threeStatements.map((x) => (
        <details key={x.id} className="list-item small fin-block">
          <summary>
            <Chip tone={tone(x.status)}>{x.status}</Chip> {x.kind} · {x.scenario} · from {x.asOf} · version {x.version} · prepared by {x.prepared.by}
            {x.approved ? ` · approved by ${x.approved.by}: "${x.approved.comment}"` : ''}
            {x.computed.shortfalls.length > 0 && <Chip tone="crit">Cash below zero {x.computed.shortfalls.join(', ')}</Chip>}
          </summary>
          <p className="muted">Assumptions: {x.assumptions}</p>
          {x.computed.problems.map((p) => (
            <p key={p} className="notice" data-tone="crit">
              {p}
            </p>
          ))}
          <div className="fin-scroll">
            <table className="table small">
              <thead>
                <tr>
                  <th>Quarter end</th>
                  <th>Revenue</th>
                  <th>Profit</th>
                  <th>Operating cash</th>
                  <th>Investing</th>
                  <th>Financing</th>
                  <th>Closing cash</th>
                  <th>Assets</th>
                  <th>Liabilities</th>
                  <th>Equity</th>
                  <th>Balances</th>
                </tr>
              </thead>
              <tbody>
                {x.computed.rows.map((r) => (
                  <tr key={r.quarterEnd}>
                    <td>{r.quarterEnd}</td>
                    <td>{rm(r.pl.revenue)}</td>
                    <td>{rm(r.pl.profit)}</td>
                    <td>{rm(r.cf.operating)}</td>
                    <td>{rm(r.cf.investing)}</td>
                    <td>{rm(r.cf.financing)}</td>
                    <td>{rm(r.cf.closing)}</td>
                    <td>{rm(r.bs.assets)}</td>
                    <td>{rm(r.bs.liabilities)}</td>
                    <td>{rm(r.bs.equity)}</td>
                    <td>{Math.abs(r.bs.difference) < 0.005 ? 'Yes' : rm(r.bs.difference)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {x.computed.ledger ? (
            <p className="muted">Opening checked against the reviewed SQL Account balance sheet for {x.computed.ledger.period}.</p>
          ) : (
            <p className="muted">
              No reviewed SQL Account figures for {x.asOf} yet: the opening is as typed from {x.openingSource}.
            </p>
          )}
          {canAct && ['draft', 'submitted', 'returned'].includes(x.status) && (x.authorIds.includes(me) || x.submitted?.byId === me) && (
            <span className="row">
              <input
                className="input"
                aria-label="Forecast withdraw reason"
                placeholder="Why withdraw (10+ characters)"
                value={f[`fw-${x.id}`] ?? ''}
                onChange={set(`fw-${x.id}`)}
              />
              <button
                className="btn btn-sm"
                disabled={act.busy || (f[`fw-${x.id}`] ?? '').trim().length < 10}
                onClick={() => go('fc3Withdraw', { id: x.id, comment: f[`fw-${x.id}`] }, 'Forecast withdrawn.')}
              >
                Withdraw
              </button>
            </span>
          )}
          {canAct && preparer && x.status === 'draft' && (
            <button className="btn btn-sm" disabled={act.busy} onClick={() => go('fc3Submit', { id: x.id }, 'Forecast sent for approval.')}>
              Send for approval
            </button>
          )}
          {canAct && approver && x.status === 'submitted' && !x.authorIds.includes(me) && (
            <span className="row">
              <input
                className="input"
                aria-label="Forecast comment"
                placeholder="Comment (needed; 10+ to return)"
                value={f[`fc-${x.id}`] ?? ''}
                onChange={set(`fc-${x.id}`)}
              />
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy || !(f[`fc-${x.id}`] ?? '').trim()}
                onClick={() => go('fc3Approve', { id: x.id, comment: f[`fc-${x.id}`] }, 'Forecast approved.')}
              >
                Approve
              </button>
              <button
                className="btn btn-sm"
                disabled={act.busy || (f[`fc-${x.id}`] ?? '').trim().length < 10}
                onClick={() => go('fc3Return', { id: x.id, comment: f[`fc-${x.id}`] }, 'Forecast returned.')}
              >
                Return
              </button>
            </span>
          )}
        </details>
      ))}
      {canAct && preparer && (
        <details>
          <summary>Prepare a three-statement forecast</summary>
          <div className="row">
            <select className="input" aria-label="Kind" value={f.fcKind ?? 'quarterly'} onChange={set('fcKind')}>
              <option value="quarterly">Quarterly (from a quarter end)</option>
              <option value="yearly">Yearly</option>
            </select>
            <select className="input" aria-label="Scenario" value={f.fcScenario ?? 'base'} onChange={set('fcScenario')}>
              <option value="base">Base</option>
              <option value="downside">Downside</option>
              <option value="upside">Upside</option>
            </select>
            <input
              className="input"
              aria-label="Starts from month"
              placeholder={`From month (closed), e.g. ${v.period}`}
              value={f.fcAsOf ?? ''}
              onChange={set('fcAsOf')}
            />
          </div>
          <label className="field">
            <span>Assumptions (guards and sites, rates, collection days, capital spending, loans)</span>
            <textarea className="textarea" rows={2} value={f.fcAssumptions ?? ''} onChange={set('fcAssumptions')} />
          </label>
          <label className="field">
            <span>Opening balance sheet from (the SQL Account balance sheet filed)</span>
            <input className="input" value={f.fcSource ?? ''} onChange={set('fcSource')} />
          </label>
          <div className="row">
            {OPENING.map((k) => (
              <label key={k} className="field fin-flex">
                <span>Opening {k}</span>
                <input className="input" inputMode="decimal" value={f[`op-${k}`] ?? ''} onChange={set(`op-${k}`)} />
              </label>
            ))}
          </div>
          <label className="field">
            <span>
              One line per quarter, {PERIOD.length} amounts separated by commas, in this order: {PERIOD.join(', ')}
            </span>
            <textarea className="textarea" rows={4} value={f.fcQuarters ?? ''} onChange={set('fcQuarters')} />
          </label>
          <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => go('fc3Save', fc3Input, 'Forecast saved.')}>
            Save forecast
          </button>
        </details>
      )}
    </div>
  );
}
