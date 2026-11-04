import { api } from '../api';
import { useApp } from '../App';
import { ErrorNotice, Kpi, Loading, useLoad } from '../ui';
import { LeavePanel } from './Leave';
import { PayChangesPanel } from './PayChanges';

/** PWVSB central HR monitors every company's workforce papers; each company stays the employer and acts (V7 s.89). */
export function HrView() {
  const { setCompanyId, go } = useApp();
  const { data, error } = useLoad(() => api.hrMonitor(), []);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="HR monitor" />
      </div>
    );
  const detail = data.rows.filter((r) => r.hasDetail);
  const sum = (k: 'staff' | 'blocked' | 'kdnMissing' | 'kdnPending' | 'csgPast' | 'foreignPermits') => detail.reduce((n, r) => n + (r.hasDetail ? r[k] : 0), 0);
  const cell = (v: number, tone: 'crit' | 'warn') => (
    <td className="num" data-tone={v ? tone : undefined} style={v ? { color: `var(--${tone})`, fontWeight: 600 } : undefined}>
      {v}
    </td>
  );
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>HR monitor</h1>
          <p>
            Workforce papers for every company. PWVSB HR follows up; each company is the employer and makes the change. Companies with no data loaded yet show
            Unknown, never as fine.
          </p>
        </div>
      </div>
      <div className="kpis">
        <Kpi label="Staff (companies with data)" value={sum('staff')} />
        <Kpi label="Cannot work today" value={sum('blocked')} tone={sum('blocked') ? 'crit' : 'ok'} note="A rule blocks them" />
        <Kpi label="No KDN card or submission" value={sum('kdnMissing')} tone={sum('kdnMissing') ? 'crit' : 'ok'} />
        <Kpi
          label="Foreign worker papers"
          value={sum('foreignPermits')}
          tone={sum('foreignPermits') ? 'warn' : 'ok'}
          note="PLKS, passport, FOMEMA, insurance"
        />
      </div>
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th className="num">Staff</th>
                <th className="num hide-sm">Nepali</th>
                <th className="num">Cannot work</th>
                <th className="num hide-sm">No KDN</th>
                <th className="num hide-sm">KDN vetting pending</th>
                <th className="num hide-sm">CSG due (year 1)</th>
                <th className="num">CSG overdue</th>
                <th className="num hide-sm">Foreign papers</th>
                <th className="num hide-sm">Over 60</th>
                <th className="num hide-sm">Face not enrolled</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) =>
                r.hasDetail ? (
                  <tr
                    key={r.company.id}
                    className="clickable"
                    onClick={() => {
                      setCompanyId(r.company.id);
                      go({ view: 'people' });
                    }}
                  >
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.company.name}</div>
                      {r.company.isPilot && <div className="muted small">Pilot</div>}
                    </td>
                    <td className="num">{r.staff}</td>
                    <td className="num hide-sm">{r.nepali}</td>
                    {cell(r.blocked, 'crit')}
                    <td className="num hide-sm">{r.kdnMissing}</td>
                    <td className="num hide-sm">{r.kdnPending}</td>
                    <td className="num hide-sm">{r.csgDue}</td>
                    {cell(r.csgPast, 'crit')}
                    <td className="num hide-sm">{r.foreignPermits}</td>
                    <td className="num hide-sm">{r.overAge}</td>
                    <td className="num hide-sm">{r.faceNotEnrolled}</td>
                  </tr>
                ) : (
                  <tr key={r.company.id}>
                    <td>
                      <div>{r.company.name}</div>
                    </td>
                    <td colSpan={10} className="muted small">
                      Unknown: staff data not loaded yet
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </section>
      <p className="muted small">Select a company to see its guards and their papers.</p>
      <PayChangesPanel />
      <LeavePanel />
    </div>
  );
}
