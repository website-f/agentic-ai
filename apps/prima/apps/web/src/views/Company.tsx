import { api } from '../api';
import { useApp } from '../App';
import { Chip, ErrorNotice, ExpiryChip, Kpi, Loading, Sev, dateLabel, hhmm, useLoad } from '../ui';

export function CompanyView() {
  const { companyId, go } = useApp();
  const { data, error } = useLoad(() => api.dashboard(companyId), [companyId]);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="today's picture" />
      </div>
    );
  const { row, today, attention, cases, branches } = data;

  if (!row.hasDetail) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <h1>{data.company.name}</h1>
            <p>No detailed data for this company yet. Only licence dates are held. Operational figures show Unknown until the company is connected.</p>
          </div>
        </div>
        <Licences licences={row.licences} />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{data.company.name}</h1>
          <p>
            Head of company: {data.company.headOfCompany} · Branches: {branches.map((b) => `${b.name} (Model ${b.model})`).join(', ')}
          </p>
        </div>
      </div>

      <div className="kpis">
        <Kpi label="Shifts today" value={today.total} />
        <Kpi label="On duty" value={today.onDuty + today.lateOnDuty} tone="ok" note={today.lateOnDuty ? `${today.lateOnDuty} came late` : 'All on time'} />
        <Kpi label="No-shows" value={today.noShow} tone={today.noShow ? 'crit' : 'ok'} note={today.awaiting ? `${today.awaiting} starting now` : undefined} />
        <Kpi label="Unfilled today" value={today.unfilled} tone={today.unfilled ? 'warn' : 'ok'} note={`${attention.unfilledNext7} in next 7 days`} />
        <Kpi label="Later today" value={today.upcoming} />
        <Kpi label="Finished" value={today.done} />
      </div>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <h2>No-shows right now</h2>
            <Chip tone={attention.noShows.length ? 'crit' : 'ok'}>{attention.noShows.length}</Chip>
          </div>
          <div className="list">
            {attention.noShows.length === 0 && <div className="empty">Everyone due on duty has clocked in.</div>}
            {attention.noShows.slice(0, 12).map((s) => (
              <div key={s.id} className="list-item">
                <div>
                  <div style={{ fontWeight: 600 }}>{s.personName}</div>
                  <div className="muted small">
                    {s.siteName} · {s.postName}
                  </div>
                </div>
                <div className="mono small">from {hhmm(s.start)}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Rostered but not allowed to work</h2>
            <Chip tone={attention.blockedRostered.length ? 'crit' : 'ok'}>{attention.blockedRostered.length}</Chip>
          </div>
          <div className="list">
            {attention.blockedRostered.length === 0 && <div className="empty">Every rostered guard has valid papers for the next 7 days.</div>}
            {attention.blockedRostered.slice(0, 12).map((b) => (
              <button key={b.personId} className="list-item" onClick={() => go({ view: 'people', personId: b.personId })}>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {b.name} <span className="mono muted">{b.staffNo}</span>
                  </div>
                  <div className="small" style={{ color: 'var(--crit)' }}>
                    {b.reasons.join(' ')}
                  </div>
                  <div className="muted small">
                    Next: {b.siteName}, {dateLabel(b.shiftStart)} {hhmm(b.shiftStart)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <h2>Open cases</h2>
            <button className="btn btn-sm" onClick={() => go({ view: 'cases' })}>
              All cases
            </button>
          </div>
          <div className="list">
            {cases.filter((c) => c.status !== 'resolved').length === 0 && <div className="empty">No open cases.</div>}
            {cases
              .filter((c) => c.status !== 'resolved')
              .slice(0, 8)
              .map((c) => (
                <button key={c.id} className="list-item" onClick={() => go({ view: 'cases', caseId: c.id })}>
                  <div className="row" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                    <Sev s={c.severity} />
                    <div>
                      <div style={{ fontWeight: 600 }}>{c.title}</div>
                      <div className="muted small">{c.siteName}</div>
                    </div>
                  </div>
                  {c.sla === 'breached' ? <Chip tone="crit">Response late</Chip> : <Chip tone="neutral">{c.status}</Chip>}
                </button>
              ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Guard papers to fix</h2>
            <Chip tone={attention.credentialIssues.length ? 'warn' : 'ok'}>{attention.credentialIssues.length}</Chip>
          </div>
          <div className="list">
            {attention.credentialIssues.slice(0, 10).map((c, i) => (
              <button key={i} className="list-item" onClick={() => go({ view: 'people', personId: c.personId })}>
                <div>
                  <div style={{ fontWeight: 600 }}>{c.name}</div>
                  <div className="muted small">{c.message}</div>
                </div>
                <ExpiryChip status={c.status} daysLeft={c.daysLeft} text={c.chip} />
              </button>
            ))}
          </div>
        </section>
      </div>

      <Licences licences={row.licences} />
    </div>
  );
}

function Licences({
  licences,
}: {
  licences: { type: string; label: string; expiresOn: string | null; status: 'OK' | 'DUE' | 'OVERDUE' | 'UNKNOWN'; daysLeft: number | null }[];
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Company licences</h2>
        <span className="muted small">Reminders start: KDN 120 days, MOF 90, insurance 90, SSM 60</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Licence</th>
              <th>Expires</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {licences.map((l) => (
              <tr key={l.type}>
                <td>{l.label}</td>
                <td className="num">{l.expiresOn ? dateLabel(l.expiresOn) : 'No record'}</td>
                <td>
                  <ExpiryChip status={l.status} daysLeft={l.daysLeft} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
