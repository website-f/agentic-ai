import { useState } from 'react';
import { api, type SiteHoursBoard } from '../api';
import { Chip, ErrorNotice, Loading, dateTimeLabel, useAction, useLoad } from '../ui';
import { PublicHolidaysPanel } from './PublicHolidays';

/**
 * Site man-hours (Fauzan, 6 Nov 2026): each site's allowed man-hours for the month (guards per shift x hours covered a
 * day x days in the month, for every post), the hours rostered and worked, and a flag for any site over. The
 * Operations Director (private site) or the OGM (government site) approves extra hours with a reason before salary.
 */

type Row = SiteHoursBoard['rows'][number];
type Cause = SiteHoursBoard['causes'][number]['id'];

const STATUS: Record<Row['check']['status'], [string, 'ok' | 'warn' | 'crit' | 'info']> = {
  over: ['Over the total: needs approval', 'crit'],
  roster_over: ['Roster over the total', 'warn'],
  pace: ['Heading over', 'warn'],
  approved: ['Extra hours approved', 'ok'],
  within: ['Within the total', 'ok'],
};
const h = (n: number) => `${n.toLocaleString('en-MY', { maximumFractionDigits: 1 })} h`;

export function SiteHoursView() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [tab, setTab] = useState<'hours' | 'holidays'>('hours');
  const tabs = (
    <div className="row" style={{ gap: 6, marginBottom: 12 }}>
      <button className={`btn btn-sm ${tab === 'hours' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('hours')}>
        Man-hours
      </button>
      <button className={`btn btn-sm ${tab === 'holidays' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('holidays')}>
        Public holidays
      </button>
    </div>
  );
  if (tab === 'holidays')
    return (
      <div className="page">
        <h1>Site man-hours</h1>
        {tabs}
        <PublicHolidaysPanel companyId={companyId} onCompany={setCompanyId} />
      </div>
    );
  return <SiteHoursBoardView companyId={companyId} setCompanyId={setCompanyId} tabs={tabs} />;
}

function SiteHoursBoardView({ companyId, setCompanyId, tabs }: { companyId: string | null; setCompanyId: (id: string) => void; tabs: JSX.Element }) {
  const [month, setMonth] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const { data, error } = useLoad(() => api.siteHoursBoard({ companyId, month }), [companyId, month]);
  if (error)
    return (
      <div className="page">
        <h1>Site man-hours</h1>
        <p className="muted">{error}</p>
      </div>
    );
  if (!data) return <Loading what="site man-hours" />;
  const flagged = data.rows.filter((r) => r.check.status !== 'within');
  const rows = showAll ? data.rows : flagged;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Site man-hours</h1>
        <p className="muted">
          Each site may use up to its total man-hours a month: guards per shift x hours covered a day x days in the month, for every post. For
          example 2 guards on 12-hour shifts round the clock for 30 days is 4 people and 1,440 hours. Any site over its total is flagged. The
          Operations Director (private sites) or the OGM (government sites) approves the extra hours with a reason before salary.
        </p>
        <p className="small">
          {data.approverTier === 'ops_director'
            ? 'You approve extra hours at private sites.'
            : data.approverTier === 'ogm'
              ? 'You approve extra hours at government sites.'
              : 'You can see the hours. The Operations Director or the OGM approves extra hours.'}
        </p>
        <p className="notice" data-tone="info">
          Test data. Hours worked are clock-in to clock-out inside the rostered shift; hours with no shift (for example a new guard on on-the-job
          training) count in full. A night shift counts in the month it starts.
        </p>
        {!data.ready && (
          <p className="notice" data-tone="warn">
            Approvals are not switched on in this database yet. The hours are still counted; nothing can be approved until the pay formulas
            module is installed with approval.
          </p>
        )}
      </div>

      {tabs}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <select className="input" aria-label="Company" value={data.companyId} onChange={(e) => setCompanyId(e.target.value)}>
          {data.companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input className="input" type="month" aria-label="Month" value={data.month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
      </div>

      <div className="kpis" style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', marginBottom: 12 }}>
        <Kpi label="Sites" value={String(data.totals.sites)} />
        <Kpi label="People needed" value={String(data.totals.people)} />
        <Kpi label="Allowed this month" value={h(data.totals.allowedHours)} />
        <Kpi label="Worked so far" value={h(data.totals.workedHours)} />
        <Kpi label="Over the total" value={String(data.totals.over + data.totals.rosterOver)} tone={data.totals.over + data.totals.rosterOver ? 'crit' : undefined} />
        <Kpi label="Heading over" value={String(data.totals.pace)} tone={data.totals.pace ? 'warn' : undefined} />
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>{showAll ? 'All sites' : 'Sites to look at'}</h2>
          <button className="btn btn-sm btn-ghost" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Show only flagged sites' : `Show all ${data.rows.length} sites`}
          </button>
        </div>
        <div className="list">
          {rows.length === 0 && <div className="empty">Every site is within its total man-hours.</div>}
          {rows.map((r) => (
            <SiteRow key={r.siteId} r={r} month={data.month} causes={data.causes} />
          ))}
        </div>
      </section>
      <p className="muted small">
        Rule {data.rule.id}: {data.rule.source}
      </p>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'crit' }) {
  return (
    <div className="card" style={{ padding: 10 }}>
      <div className="muted small">{label}</div>
      <div style={{ fontWeight: 700, fontSize: 18, color: tone === 'crit' ? 'var(--crit, #b42318)' : tone === 'warn' ? 'var(--warn, #b54708)' : undefined }}>{value}</div>
    </div>
  );
}

function SiteRow({ r, month, causes }: { r: Row; month: string; causes: SiteHoursBoard['causes'] }) {
  const [open, setOpen] = useState(false);
  const [extra, setExtra] = useState(String(r.check.needsApproval || ''));
  const [cause, setCause] = useState<Cause>('training');
  const [reason, setReason] = useState('');
  const act = useAction();
  const [label, tone] = STATUS[r.check.status];
  const c = r.check;
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 600 }}>
          {r.siteName} <span className="muted small">({r.siteCode}, {r.sector === 'government' ? 'government' : 'private'})</span>
        </div>
        <Chip tone={tone}>{label}</Chip>
      </div>
      <div className="small">
        Allowed {h(c.allowedHours)} ({r.allowed.people} people)
        {c.approvedExtra ? ` + ${h(c.approvedExtra)} approved` : ''} · Rostered {h(c.rosteredHours)} · Worked {h(c.workedHours)}
        {c.allowedSoFar < c.allowedHours ? ` (allowed so far ${h(c.allowedSoFar)})` : ''}
      </div>
      {r.notRosteredHours > 0 && <div className="small">Hours with no shift (for example on-the-job training): {h(r.notRosteredHours)}</div>}
      {c.needsApproval > 0 && (
        <div className="small" style={{ fontWeight: 600 }}>
          {h(c.needsApproval)} over. {r.approver} approves.
        </div>
      )}
      {r.approvals.map((a) => (
        <div key={a.id} className="muted small">
          {a.approvedBy}, {dateTimeLabel(a.approvedAt)}: {h(a.extraHours)} approved ({causes.find((x) => x.id === a.cause)?.label ?? a.cause}). {a.reason}
        </div>
      ))}
      <button className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(!open)}>
        {open ? 'Hide posts' : 'Show posts'}
      </button>
      {open && (
        <table className="table small">
          <thead>
            <tr>
              <th>Post</th>
              <th>Shifts</th>
              <th>Guards per shift</th>
              <th>People</th>
              <th>Allowed</th>
            </tr>
          </thead>
          <tbody>
            {r.allowed.posts.map((p) => (
              <tr key={p.postId}>
                <td>{p.name}</td>
                <td>{p.structureLabel}</td>
                <td>{p.guardsPerShift}</td>
                <td>{p.people}</td>
                <td>{h(p.allowedHours)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {r.canApprove && (c.needsApproval > 0 || open) && (
        <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', marginTop: 4 }}>
          <input className="input" type="number" min={1} step={0.5} aria-label="Extra hours" placeholder="Extra hours" value={extra} onChange={(e) => setExtra(e.target.value)} />
          <select className="input" aria-label="Why" value={cause} onChange={(e) => setCause(e.target.value as Cause)}>
            {causes.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
          <input className="input" aria-label="Reason" placeholder="Reason (kept with the approval)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <ErrorNotice error={act.error} />
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy}
            onClick={() =>
              act.run(() => api.approveSiteHours({ siteId: r.siteId, month, extraHours: Number(extra), cause, reason }), 'Extra hours approved.').then((x) => {
                if (x) setReason('');
              })
            }
          >
            Approve extra hours
          </button>
        </div>
      )}
    </div>
  );
}
