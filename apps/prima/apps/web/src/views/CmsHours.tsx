import { useState } from 'react';
import { api } from '../api';
import { ErrorNotice, Loading, useLoad } from '../ui';

/**
 * CMS staff hours for a month, view only for HR (Fauzan, 5 Nov 2026: "Rest hours can be set by arms control. Hr just
 * view it."). Arms Control keeps the roster and the rest setting on the CMS screen.
 */
export function CmsHoursPanel() {
  const [month, setMonth] = useState('');
  const { data, error } = useLoad(() => api.cmsHours(month || undefined), [month]);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>CMS staff hours</h2>
        <input className="input" type="month" aria-label="Month" value={month || data?.month || ''} onChange={(e) => setMonth(e.target.value)} />
      </div>
      <ErrorNotice error={error} />
      {!data && !error && <Loading what="CMS hours" />}
      {data && (
        <>
          <p className="muted small" style={{ padding: '10px 16px 0' }}>
            View only. Arms Control sets the roster and the rest between shifts: now {data.restRules.minRestHours} hours. By law nobody works more than{' '}
            {data.restRules.maxHours} hours in a row or more than {data.restRules.maxDaysInRow} days without a rest day. Hours are from clock-in to clock-out;
            this is not a payslip.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="num">Seats</th>
                  <th className="num">Worked</th>
                  <th className="num">Hours</th>
                  <th className="num">Late in</th>
                  <th className="num">Left early</th>
                  <th className="num">No clock-out</th>
                  <th className="num">Missed</th>
                  <th className="num">Taken off</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="muted">
                      No CMS seats in this month.
                    </td>
                  </tr>
                )}
                {data.rows.map((h) => (
                  <tr key={h.staffId}>
                    <td>{h.name}</td>
                    <td className="num">{h.seats}</td>
                    <td className="num">{h.worked}</td>
                    <td className="num">{h.hours}</td>
                    <td className="num">{h.late}</td>
                    <td className="num">{h.early}</td>
                    <td className="num">{h.noClockOut}</td>
                    <td className="num">{h.missed}</td>
                    <td className="num">{h.takenOff}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
