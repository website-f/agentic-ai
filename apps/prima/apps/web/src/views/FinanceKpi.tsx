import { api } from '../api';
import { ErrorNotice, Loading, useLoad } from '../ui';
import { Card, Empty } from '../kit';

const STAGE: Record<string, string> = {
  review: 'Payment review',
  release: 'Payment release',
  rework: 'Rework after a return (staff)',
  close_review: 'Close review',
};
const h = (x: number | null) => (x == null ? 'Unknown' : `${x} min`);
const p = (x: number | null) => (x == null ? '–' : `${x}%`);

/**
 * Finance KPIs (Fauzan, 1 Nov 2026): speed from when the work reaches each person, and quality. Provisional targets;
 * people listed by name, never ranked; for monitoring only.
 */
export function FinanceKpiTab() {
  const { data, error } = useLoad(() => api.finKpi(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="KPIs" />;
  const q = data.overall.quality;
  return (
    <>
      <p className="notice" data-tone="info">
        {data.period}, {data.scope}. Measured from {data.measuredFrom}. Targets are provisional until the pilot calibrates them. {data.note}
      </p>
      <Card title="Speed by stage" sub="From when the work reaches each person" flush>
        {data.overall.stages.length === 0 ? (
          <Empty title="Nothing finished this month yet." />
        ) : (
          <table className="fin-table">
            <thead>
              <tr>
                <th>Stage</th>
                <th>Kind</th>
                <th className="fin-num">Count</th>
                <th className="fin-num">Median</th>
                <th className="fin-num">Target</th>
                <th className="fin-num">On time</th>
              </tr>
            </thead>
            <tbody>
              {data.overall.stages.map((s) => (
                <tr key={s.stage}>
                  <td>{STAGE[s.stage] ?? s.stage}</td>
                  <td className="muted">{s.checking ? 'checking' : 'staff work'}</td>
                  <td className="fin-num">{s.count}</td>
                  <td className="fin-num">{h(s.medianMinutes)}</td>
                  <td className="fin-num">{h(s.targetMinutes)}</td>
                  <td className="fin-num">{p(s.onTimePct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Quality" flush>
        <div className="fin-rows">
          <div className="fin-kv">
            <span>Payments released: {q.payments.finished}</span>
            <span className="muted small fin-right-text">
              first time {p(q.payments.firstPassPct)} (target {data.targets.kpiFirstPassPct}%) · returns {q.payments.returnCycles} · lapsed {q.payments.lapses}
            </span>
          </div>
          <div className="fin-kv">
            <span>Closes approved: {q.closes.approved}</span>
            <span className="muted small fin-right-text">
              first time {p(q.closes.firstPassPct)} · reopened {q.closes.reopens}
            </span>
          </div>
          {data.notTimed.map((u) => (
            <div key={u} className="fin-kv muted small">
              {u}
            </div>
          ))}
          {data.unknown.map((u) => (
            <div key={u} className="fin-kv muted small">
              Unknown: {u}
            </div>
          ))}
        </div>
      </Card>
      <Card title="People (by name)" sub="Listed by name, never ranked; for monitoring only" flush>
        {data.people.length > 0 && (
          <table className="fin-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Stage</th>
                <th className="fin-num">Count</th>
                <th className="fin-num">Median</th>
                <th className="fin-num">Target</th>
                <th className="fin-num">On time</th>
              </tr>
            </thead>
            <tbody>
              {data.people.flatMap((x) =>
                x.stages.map((s, i) => (
                  <tr key={`${x.id}-${s.stage}`}>
                    {i === 0 && (
                      <td rowSpan={x.stages.length} className="fin-strong">
                        {x.name}
                      </td>
                    )}
                    <td>{STAGE[s.stage] ?? s.stage}</td>
                    <td className="fin-num">{s.count}</td>
                    <td className="fin-num">{h(s.medianMinutes)}</td>
                    <td className="fin-num">{h(s.targetMinutes)}</td>
                    <td className="fin-num">{p(s.onTimePct)}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        )}
        {data.people.some((x) => x.stages.length === 0) && (
          <div className="fin-rows">
            {data.people
              .filter((x) => x.stages.length === 0)
              .map((x) => (
                <div key={x.id} className="fin-kv">
                  <strong>{x.name}</strong>
                </div>
              ))}
          </div>
        )}
        {data.preparers.length > 0 && (
          <div className="fin-rows fin-sep">
            {data.preparers.map((x) => (
              <div key={`p-${x.id}`} className="fin-kv small">
                {x.by} prepared {x.finished} released payment(s): first time {p(x.firstPassPct)}, returns {x.returns}
                {x.reasons.length ? ` (${x.reasons.join('; ')})` : ''}
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
