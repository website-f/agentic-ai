import { api } from '../api';
import { RecordButton } from './RecordForm';
import { useApp } from '../App';
import { Chip, ExpiryChip, Kpi, Loading, ErrorNotice, n, useLoad } from '../ui';

export function Overview() {
  const { go, setCompanyId } = useApp();
  const { data, error } = useLoad(() => api.overview(), []);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="the group" />
      </div>
    );

  const pilots = data.filter((r) => r.hasDetail);
  const sum = (k: 'shiftsToday' | 'presentNow' | 'noShowToday' | 'unfilledToday' | 'openCases' | 'p1Open' | 'credentialIssues') =>
    pilots.reduce((s, r) => s + (r[k] === 'UNKNOWN' ? 0 : (r[k] as number)), 0);
  const licenceBad = data.filter((r) => r.licenceStatus === 'OVERDUE').length;
  const licenceUnknown = data.filter((r) => r.licenceStatus === 'UNKNOWN').length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Group today</h1>
          <p>
            {data.length} companies. Live figures come only from the {pilots.length} pilot companies; the rest show Unknown until their data is connected.
            Unknown is never counted as fine.
          </p>
        </div>
      </div>

      <div className="kpis">
        <Kpi label="Shifts today" value={sum('shiftsToday')} note="Pilot companies" />
        <Kpi label="On duty now" value={sum('presentNow')} tone="ok" />
        <Kpi label="No-shows" value={sum('noShowToday')} tone={sum('noShowToday') ? 'crit' : undefined} note="Started 15+ min ago, no clock-in" />
        <Kpi label="Unfilled shifts" value={sum('unfilledToday')} tone={sum('unfilledToday') ? 'warn' : undefined} />
        <Kpi label="Open cases" value={sum('openCases')} note={`${sum('p1Open')} at P1`} tone={sum('p1Open') ? 'crit' : undefined} />
        <Kpi label="Licences expired" value={licenceBad} tone={licenceBad ? 'crit' : 'ok'} note={`${licenceUnknown} companies with a missing record`} />
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Companies</h2>
          <span className="muted small">Select a pilot company to open it</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Licences</th>
                <th className="num">Guards</th>
                <th className="num">Sites</th>
                <th className="num">On duty</th>
                <th className="num">No-shows</th>
                <th className="num">Open cases</th>
                <th className="num">Papers to fix</th>
                <th>Your access</th>
                <th>Company master</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr
                  key={r.company.id}
                  className={r.hasDetail ? 'clickable' : undefined}
                  onClick={() => {
                    if (!r.hasDetail) return;
                    setCompanyId(r.company.id);
                    go({ view: 'company' });
                  }}
                >
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.company.name}</div>
                    <div className="muted small">
                      {r.company.isPilot ? 'Pilot' : 'Summary only'} · {r.company.state}
                    </div>
                  </td>
                  <td>
                    <ExpiryChip status={r.licenceStatus} />
                    <div className="muted small">
                      {r.licences
                        .filter((l) => l.status !== 'OK')
                        .map((l) => l.label)
                        .join(', ') || 'All valid'}
                    </div>
                  </td>
                  <td className="num">{n(r.guards)}</td>
                  <td className="num">{n(r.sites)}</td>
                  <td className="num">{n(r.presentNow)}</td>
                  <td className="num">{n(r.noShowToday)}</td>
                  <td className="num">
                    {n(r.openCases)}
                    {r.p1Open !== 'UNKNOWN' && r.p1Open > 0 && (
                      <div>
                        <Chip tone="crit">{r.p1Open} P1</Chip>
                      </div>
                    )}
                  </td>
                  <td className="num">{n(r.credentialIssues)}</td>
                  <td>{r.canAct ? <Chip tone="info">Act</Chip> : <Chip tone="neutral">Monitor</Chip>}</td>
                  <td><RecordButton kind="company" companyId={r.company.id} label="Verify company" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
