import { useState } from 'react';
import { api, type WorkKpi } from '../api';
import { ErrorNotice, Loading, useLoad } from '../ui';
import { Card, PageHead, Stat, Stats } from '../kit';

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
  const done = (d: Dept) => d.work.reduce((n, r) => n + r.count, 0) + d.checking.reduce((n, r) => n + r.count, 0);
  const finished = (d: Dept) => d.quality.reduce((n, q) => n + q.finished, 0);
  const active = data.departments.filter((d) => done(d) + finished(d) > 0).length;
  return (
    <div className="page">
      <PageHead
        title="Work KPIs"
        sub={`Speed and quality (${data.scope}). Time counts from ${data.measuredFrom}. Nobody presses start or stop.`}
        actions={
          <label className="field wk-month">
            <span className="label">Month</span>
            <input className="input" type="month" value={period || data.period} onChange={(e) => setPeriod(e.target.value)} />
          </label>
        }
      />
      <div className="notice" data-tone="info" role="note">
        {data.provisional ? `Targets are provisional (version ${data.targetsVersion}). ` : `Targets: version ${data.targetsVersion}. `}
        {data.targetsNote} Approvals are not timed: each person is timed on their own part only. {data.note}
      </div>
      <Stats>
        <Stat label="Departments" value={data.departments.length} note={`${active} with timed work this month`} />
        <Stat label="Steps timed" value={data.departments.reduce((n, d) => n + done(d), 0)} />
        <Stat label="Work finished" value={data.departments.reduce((n, d) => n + finished(d), 0)} />
      </Stats>
      {data.departments.map((d) => {
        const quiet = done(d) + finished(d) === 0;
        return (
          <Card
            key={d.dept}
            title={d.label}
            sub={quiet ? 'No timed work, checking or finished work this month.' : `${done(d)} steps timed · ${finished(d)} finished`}
          >
            {!quiet && (
              <div className="wk-blocks">
                <div className="wk-block">
                  <h3>Staff work</h3>
                  <StageTable rows={d.work} empty="No timed work this month." />
                </div>
                <div className="wk-block">
                  <h3>Checking work</h3>
                  <StageTable rows={d.checking} empty="No timed checking this month." />
                </div>
                <div className="wk-block">
                  <h3>Quality</h3>
                  <QualityTable rows={d.quality} />
                </div>
                {d.people.length > 0 && (
                  <details className="wk-people">
                    <summary>By person ({d.people.length}), listed by name</summary>
                    {d.people.map((p) => (
                      <div key={p.name} className="wk-block">
                        <h4>{p.name}</h4>
                        <StageTable rows={p.stages} empty="" />
                      </div>
                    ))}
                  </details>
                )}
              </div>
            )}
            {(d.unknown.length > 0 || d.notTimed.length > 0) && (
              <details className="wk-notes">
                <summary>
                  What is not counted ({d.unknown.length + d.notTimed.length})
                </summary>
                <ul>
                  {d.unknown.map((u) => (
                    <li key={u}>
                      <span className="wk-tag">Not measured yet</span> {u}.
                    </li>
                  ))}
                  {d.notTimed.map((u) => (
                    <li key={u}>
                      <span className="wk-tag">Not timed by decision</span> {u}.
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>
        );
      })}
    </div>
  );
}
