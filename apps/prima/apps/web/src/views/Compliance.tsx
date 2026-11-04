import { useState } from 'react';
import { api } from '../api';
import { ErrorNotice, ExpiryChip, Kpi, Loading, dateLabel, useLoad } from '../ui';
import { RecordButton } from './RecordForm';

export function ComplianceView() {
  const { data, error } = useLoad(() => api.compliance(), []);
  const [show, setShow] = useState<'problems' | 'all'>('problems');
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="licences" />
      </div>
    );
  const rows = data.licences.filter((l) => show === 'all' || l.status !== 'OK');
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Company licences</h1>
          <p>
            KDN licence, MOF registration, group insurance and SSM annual return for every company you can see. Reminders start 120, 90, 90 and 60 days before
            expiry. Filing is done by a person; the app keeps the date and receipt.
          </p>
        </div>
        <div className="seg">
          <button aria-pressed={show === 'problems'} onClick={() => setShow('problems')}>
            Needs action
          </button>
          <button aria-pressed={show === 'all'} onClick={() => setShow('all')}>
            All
          </button>
        </div>
      </div>
      <div className="kpis">
        <Kpi label="Expired" value={data.summary.overdue} tone={data.summary.overdue ? 'crit' : 'ok'} />
        <Kpi label="No record" value={data.summary.unknown} tone={data.summary.unknown ? 'unknown' : 'ok'} note="Counted as a problem until found" />
        <Kpi label="Due soon" value={data.summary.due} tone={data.summary.due ? 'warn' : 'ok'} />
        <Kpi label="Valid" value={data.summary.ok} tone="ok" />
      </div>
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Licence</th>
                <th>Expires</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={`${l.companyId}-${l.type}`}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{l.companyName}</div>
                    {l.isPilot && <div className="muted small">Pilot</div>}
                  </td>
                  <td>{l.label}</td>
                  <td className="num">{l.expiresOn ? dateLabel(l.expiresOn) : 'No record'}</td>
                  <td>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <ExpiryChip status={l.status} daysLeft={l.daysLeft} />
                      {l.id ? (
                        <RecordButton kind="licence" id={l.id} label="Update" />
                      ) : (
                        <RecordButton kind="licence" companyId={l.companyId} label="Add record" />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <div className="empty">Nothing needs action.</div>}
        </div>
      </section>
    </div>
  );
}
