import { Select } from '../SearchSelect';
import { Fragment, useState } from "react";
import { api } from "../api";
import type { DirectorOfficeCounter } from "../api/types";
import {
  Chip,
  ErrorNotice,
  Kpi,
  Loading,
  dateLabel,
  dateTimeLabel,
  useLoad,
} from "../ui";

const MONTH = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const monthLabel = (key: string) =>
  `${MONTH[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
const STATUS: Record<
  string,
  { text: string; tone: "ok" | "warn" | "crit" | "neutral" }
> = {
  on_time: { text: "On time", tone: "ok" },
  late: { text: "Late", tone: "warn" },
  missing: { text: "Not sent", tone: "crit" },
  unknown: { text: "Not on Prima yet", tone: "neutral" },
};

/**
 * The Director Office's counter of reports and meetings (Fauzan, 4 Nov 2026): every report each company and
 * department sent each month, with the date and time sent, and every meeting with whether its minutes are in.
 */
export function DirectorOfficeCounterPanel() {
  const { data, error } = useLoad(() => api.directorOfficeCounter(), []);
  const [m, setM] = useState<number | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="report and meeting counter" />;
  const i = m ?? data.months.length - 1;
  const month = data.months[i];
  const rt = data.reports.totals[i];
  const mt = data.meetings.totals[i];
  const sent = rt.onTime + rt.late;
  const missing = data.meetings.missingMinutes.filter(
    (x) => x.start.slice(0, 7) === month,
  );
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Reports and meetings counter</h3>
        <Select
          value={i}
          onChange={(e) => setM(Number(e.target.value))}
          aria-label="Month"
        >
          {data.months.map((x, k) => (
            <option key={x} value={k}>
              {monthLabel(x)}
            </option>
          ))}
        </Select>
      </div>
      <p className="muted small" style={{ margin: "0 0 8px" }}>
        A weekly report counts in the month its week starts; a monthly report in
        its own month. A meeting counts in the month it was held.
      </p>
      <div className="kpis">
        <Kpi
          label="Reports sent"
          value={`${sent} of ${rt.expected - rt.unknown}`}
          note={
            rt.unknown
              ? `${rt.unknown} more from companies not on Prima yet`
              : undefined
          }
        />
        <Kpi label="Sent late" value={rt.late} tone={rt.late ? "warn" : "ok"} />
        <Kpi
          label="Not sent"
          value={rt.missing}
          tone={rt.missing ? "crit" : "ok"}
        />
        <Kpi label="Meetings held" value={mt.held} />
        <Kpi label="Minutes in" value={`${mt.minutes} of ${mt.held}`} />
        <Kpi
          label="Held, no minutes"
          value={mt.noMinutes}
          tone={mt.noMinutes ? "crit" : "ok"}
        />
      </div>

      <h4 style={{ margin: "12px 0 4px" }}>Reports, {monthLabel(month)}</h4>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Company or department</th>
              <th className="num">Sent</th>
              <th className="num">On time</th>
              <th className="num">Late</th>
              <th className="num">Not sent</th>
            </tr>
          </thead>
          <tbody>
            {data.reports.senders.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No reports are set yet.
                </td>
              </tr>
            )}
            {data.reports.senders.map((s) => {
              const c = s.months[i];
              const log = s.log.filter(
                (l) =>
                  (l.period.includes("-W")
                    ? l.label.replace("Week of ", "").slice(0, 7)
                    : l.period) === month,
              );
              return (
                <Fragment key={s.key}>
                  <tr
                    style={{ cursor: "pointer" }}
                    onClick={() => setOpen(open === s.key ? null : s.key)}
                  >
                    <td>
                      {open === s.key ? "▾ " : "▸ "}
                      {s.name}
                      {!s.onApp && (
                        <span className="muted small"> (not on Prima yet)</span>
                      )}
                    </td>
                    <td className="num">
                      {s.onApp ? `${c.onTime + c.late} of ${c.expected}` : "-"}
                    </td>
                    <td className="num">{c.onTime}</td>
                    <td className="num">{c.late}</td>
                    <td className="num">{c.missing}</td>
                  </tr>
                  {open === s.key && (
                    <tr>
                      <td colSpan={5}>
                        {log.length === 0 && (
                          <div className="muted small">
                            No report was due this month.
                          </div>
                        )}
                        {log.map((l) => (
                          <div
                            key={l.report + l.period}
                            className="row small"
                            style={{
                              gap: 6,
                              flexWrap: "wrap",
                              marginBottom: 2,
                            }}
                          >
                            <Chip tone={STATUS[l.status]?.tone ?? "neutral"}>
                              {STATUS[l.status]?.text ?? l.status}
                            </Chip>
                            <span>
                              {l.report} · {l.label} · due {dateLabel(l.due)}
                              {l.sentAt
                                ? ` · sent ${dateTimeLabel(l.sentAt)} by ${l.by}`
                                : ""}
                            </span>
                          </div>
                        ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <h4 style={{ margin: "12px 0 4px" }}>Meetings, {monthLabel(month)}</h4>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Company, department or group</th>
              <th className="num">Held</th>
              <th className="num">Minutes in</th>
              <th className="num">No minutes</th>
              <th className="num hide-sm">Summary checked</th>
              <th className="num hide-sm">Still to come</th>
              <th className="num hide-sm">Cancelled</th>
            </tr>
          </thead>
          <tbody>
            {data.meetings.groups.filter((gr) =>
              Object.values(gr.months[i]).some((v) => v > 0),
            ).length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No meetings this month.
                </td>
              </tr>
            )}
            {data.meetings.groups
              .filter((gr) => Object.values(gr.months[i]).some((v) => v > 0))
              .map((gr) => {
                const c = gr.months[i];
                return (
                  <tr key={gr.key}>
                    <td>{gr.name}</td>
                    <td className="num">{c.held}</td>
                    <td className="num">{c.minutes}</td>
                    <td className="num">{c.noMinutes}</td>
                    <td className="num hide-sm">{c.summaryChecked}</td>
                    <td className="num hide-sm">{c.scheduled}</td>
                    <td className="num hide-sm">{c.cancelled}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      {missing.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="small" style={{ fontWeight: 600 }}>
            Held without minutes
          </div>
          {missing.map((x) => (
            <div key={x.id} className="muted small">
              {dateTimeLabel(x.start)} · {x.title} · {x.owner} · organiser{" "}
              {x.organiser}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
