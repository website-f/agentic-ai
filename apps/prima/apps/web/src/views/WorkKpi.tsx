import { useState } from 'react';
import { api, type WorkKpi } from '../api';
import { ErrorNotice, Loading, useLoad } from '../ui';

type Dept = WorkKpi['departments'][number];
type Stage = Dept['work'][number];
type Quality = Dept['quality'][number];

const words = (s: string) => s.replaceAll('_', ' ');
const mins = (m: number | null) => (m == null ? 'Unknown' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`);
const rate = (p: number | null) => (p == null ? 'Unknown' : `${p}%`);
const count = (n: number | null) => (n == null ? 'Unknown' : String(n));

function StageTable({ rows, empty }: { rows: Stage[]; empty: string }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Step</th>
            <th>Done</th>
            <th>Median time</th>
            <th>Target</th>
            <th>On time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.workflow}.${r.stage}`}>
              <td>
                {words(r.workflow)}: {words(r.stage)}
              </td>
              <td>{r.count}</td>
              <td>
                {mins(r.medianMinutes)}
                {r.clock === 'round_the_clock' ? ' (round the clock)' : ' (office hours)'}
              </td>
              <td>{r.target}</td>
              <td>{rate(r.onTimePct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QualityTable({ rows }: { rows: Quality[] }) {
  if (!rows.length) return <p className="muted">Nothing finished this month.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Work</th>
            <th>Finished</th>
            <th>First time right</th>
            <th>Returns</th>
            <th>Reopened</th>
            <th>Proof complete</th>
            <th>Requester confirmed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((q) => (
            <tr key={q.workflow}>
              <td>{words(q.workflow)}</td>
              <td>{q.finished}</td>
              <td>{rate(q.firstPassPct)}</td>
              <td>{count(q.returns)}</td>
              <td>{count(q.reopens)}</td>
              <td>{rate(q.evidenceCompletePct)}</td>
              <td>{rate(q.requesterConfirmedPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Work KPIs (Fauzan, 1 Nov 2026, started 5 Nov 2026): speed from when work reaches each person, and quality, for every
 * department the viewer keeps KPIs for. Read-only; people are listed by name, never ranked.
 */
export function WorkKpiView() {
  const [period, setPeriod] = useState('');
  const { data, error } = useLoad(() => api.workKpi(period || undefined), [period]);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="work KPIs" />
      </div>
    );
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Work KPIs</h1>
          <p>
            Speed and quality ({data.scope}). Time counts from {data.measuredFrom}. Nobody presses start or stop.
          </p>
        </div>
        <label className="field">
          Month
          <input type="month" value={period || data.period} onChange={(e) => setPeriod(e.target.value)} />
        </label>
      </div>
      <p role="note">
        {data.provisional ? `Targets are provisional (version ${data.targetsVersion}). ` : `Targets: version ${data.targetsVersion}. `}{data.targetsNote}{' '}
        Approvals are not timed: each person is timed on their own part only. {data.note}
      </p>
      {data.departments.map((d) => (
        <section className="panel" key={d.dept}>
          <h2>{d.label}</h2>
          <h3>Staff work</h3>
          <StageTable rows={d.work} empty="No timed work this month." />
          <h3>Checking work</h3>
          <StageTable rows={d.checking} empty="No timed checking this month." />
          <h3>Quality</h3>
          <QualityTable rows={d.quality} />
          {d.people.length > 0 && (
            <details>
              <summary>By person ({d.people.length}), listed by name</summary>
              {d.people.map((p) => (
                <div key={p.name}>
                  <h4>{p.name}</h4>
                  <StageTable rows={p.stages} empty="" />
                </div>
              ))}
            </details>
          )}
          {(d.unknown.length > 0 || d.notTimed.length > 0) && (
            <ul className="muted">
              {d.unknown.map((u) => (
                <li key={u}>Not measured yet: {u}.</li>
              ))}
              {d.notTimed.map((u) => (
                <li key={u}>Not timed by decision: {u}.</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
