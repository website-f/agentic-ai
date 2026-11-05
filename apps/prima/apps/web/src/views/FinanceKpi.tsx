import { api } from '../api';
import { ErrorNotice, Loading, useLoad } from '../ui';

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
      <section className="panel">
        <div className="panel-head">
          <h3>Speed by stage</h3>
        </div>
        <div className="list">
          {data.overall.stages.length === 0 && <div className="empty">Nothing finished this month yet.</div>}
          {data.overall.stages.map((s) => (
            <div key={s.stage} className="list-item" style={{ flexWrap: 'wrap', gap: 6 }}>
              <span style={{ flex: '1 1 220px' }}>
                {STAGE[s.stage] ?? s.stage} <span className="muted small">{s.checking ? '· checking' : '· staff work'}</span>
              </span>
              <span className="small">
                {s.count} · median {h(s.medianMinutes)} · target {h(s.targetMinutes)} · on time {p(s.onTimePct)}
              </span>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Quality</h3>
        </div>
        <div className="list">
          <div className="list-item">
            Payments released: {q.payments.finished} · first time {p(q.payments.firstPassPct)} (target {data.targets.kpiFirstPassPct}%) · returns {q.payments.returnCycles} · lapsed {q.payments.lapses}
          </div>
          <div className="list-item">
            Closes approved: {q.closes.approved} · first time {p(q.closes.firstPassPct)} · reopened {q.closes.reopens}
          </div>
          {data.notTimed.map((u) => (
            <div key={u} className="list-item muted small">
              {u}
            </div>
          ))}
          {data.unknown.map((u) => (
            <div key={u} className="list-item muted small">
              Unknown: {u}
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>People (by name)</h3>
        </div>
        <div className="list">
          {data.people.map((x) => (
            <div key={x.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
              <strong>{x.name}</strong>
              {x.stages.map((s) => (
                <span key={s.stage} className="small">
                  {STAGE[s.stage] ?? s.stage}: {s.count} · median {h(s.medianMinutes)} · target {h(s.targetMinutes)} · on time {p(s.onTimePct)}
                </span>
              ))}
            </div>
          ))}
          {data.preparers.map((x) => (
            <div key={`p-${x.id}`} className="list-item small">
              {x.by} prepared {x.finished} released payment(s): first time {p(x.firstPassPct)}, returns {x.returns}
              {x.reasons.length ? ` (${x.reasons.join('; ')})` : ''}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
