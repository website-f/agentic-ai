import type { GuardPayHours } from '@prima/core';
import { Chip, dateLabel } from '../ui';
import '../styles/pay-p100.css';

/**
 * P100 B1b (Fauzan, 11 Nov 2026: "Salary and total working hours must match"): the hours recorded for a month beside the
 * hours its pay line pays. A line whose totals differ is held: the fix is the attendance or leave record (with its own
 * approval and reason), never the pay line.
 */
const h = (n: number) => `${n.toLocaleString('en-MY', { maximumFractionDigits: 2 })} h`;
const WHY: Record<GuardPayHours['days'][number]['why'], string> = {
  short: 'Worked less than the normal day paid',
  over: 'Worked past the shift the formula pays',
  not_worked: 'Basic paid for days with no attendance or leave',
};

/** The one-line summary on a pay line: recorded, paid and whether they match. */
export function HoursChip({ hours }: { hours?: GuardPayHours }) {
  if (!hours) return null;
  return (
    <span className="pp-hours-chip" data-match={hours.match ? 'yes' : 'no'}>
      <span>
        {h(hours.recorded.total)} recorded · {h(hours.paid.total)} paid
      </span>
      <Chip tone={hours.match ? 'ok' : 'crit'}>{hours.match ? 'Hours match' : 'Hours do not match'}</Chip>
    </span>
  );
}

/** Recorded and paid side by side, row by row, with the days that do not match. */
export function PayHoursTable({ hours }: { hours?: GuardPayHours }) {
  if (!hours) return <p className="muted small">Hours were not compared on this older calculation. Recalculate the month to see them.</p>;
  const recorded: [string, number][] = [
    ['Hours worked (attendance)', hours.recorded.worked],
    ['Paid leave, training and MC days', hours.recorded.leave],
    ['Public holidays off', hours.recorded.holidays],
  ];
  const paid: [string, number][] = [
    ['Normal hours', hours.paid.normal],
    ['Overtime', hours.paid.ot],
    ['Rest-day hours', hours.paid.restDay],
    ['Public holiday hours worked', hours.paid.holiday],
    ['Paid leave, training and MC days', hours.paid.leave],
    ['Public holidays off', hours.paid.holidays],
    ['Days paid with nothing recorded', hours.paid.notWorked],
  ];
  return (
    <section className="pp-hours" aria-label="Hours recorded and paid" data-match={hours.match ? 'yes' : 'no'}>
      <div className="pp-hours-cols">
        <div className="pp-hours-col">
          <h4>Hours recorded</h4>
          <dl>
            {recorded.filter(([, v], k) => v || k === 0).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{h(v)}</dd>
              </div>
            ))}
          </dl>
          <div className="pp-hours-total">
            <span>Total recorded</span>
            <strong>{h(hours.recorded.total)}</strong>
          </div>
        </div>
        <div className="pp-hours-col">
          <h4>Hours paid</h4>
          <dl>
            {paid.filter(([, v], k) => v || k === 0).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{h(v)}</dd>
              </div>
            ))}
          </dl>
          <div className="pp-hours-total">
            <span>Total paid</span>
            <strong>{h(hours.paid.total)}</strong>
          </div>
        </div>
      </div>
      {hours.match ? (
        <p className="pp-ok-note">Hours paid equal the hours recorded.</p>
      ) : (
        <div className="pp-blocked" role="alert">
          <strong>Hours do not match, so this line is held.</strong> It cannot be changed, submitted or approved until the attendance or
          leave record is corrected (with its own approval and reason).
          {hours.days.length > 0 && (
            <ul>
              {hours.days.map((d) => (
                <li key={`${d.date}-${d.why}`}>
                  {d.why === 'not_worked' ? 'This month' : dateLabel(d.date)}: {h(d.recorded)} recorded, {h(d.paid)} paid. {WHY[d.why]}.
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
