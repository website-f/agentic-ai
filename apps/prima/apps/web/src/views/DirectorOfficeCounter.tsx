import { Select } from '../SearchSelect';
import { useState } from "react";
import { api } from "../api";
import type { DirectorOfficeCounter } from "../api/types";
import { DataTable, type DtColumn, type DtFilter } from "../DataTable";
import {
  Chip,
  Drawer,
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
type Sender = DirectorOfficeCounter["reports"]["senders"][number];
type Group = DirectorOfficeCounter["meetings"]["groups"][number];
const SENDER_FILTERS: DtFilter<Sender>[] = [
  { id: "app", label: "On Prima", value: (s) => (s.onApp ? "yes" : "no"), options: [{ value: "yes", label: "On Prima" }, { value: "no", label: "Not on Prima yet" }] },
];

export function DirectorOfficeCounterPanel() {
  const { data, error } = useLoad(() => api.directorOfficeCounter(), []);
  const [m, setM] = useState<number | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // P91: the counter is for people who see every meeting; others who open Director Office see no red "Not allowed" box.
  if (error && /^Not allowed:/.test(String((error as unknown as { message?: string })?.message ?? error))) return null;
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
  const senderLog = (s: Sender) =>
    s.log.filter((l) => (l.period.includes("-W") ? l.label.replace("Week of ", "").slice(0, 7) : l.period) === month);
  const openSender = data.reports.senders.find((s) => s.key === open);
  const senderColumns: DtColumn<Sender>[] = [
    {
      id: "name",
      label: "Company or department",
      value: (s) => s.name,
      render: (s) => (
        <span>
          <strong>{s.name}</strong>
          {!s.onApp && <span className="muted small"> (not on Prima yet)</span>}
        </span>
      ),
      phone: "title",
    },
    { id: "sent", label: "Sent", value: (s) => (s.onApp ? s.months[i].onTime + s.months[i].late : null), sort: "number", render: (s) => (s.onApp ? `${s.months[i].onTime + s.months[i].late} of ${s.months[i].expected}` : "-") },
    { id: "onTime", label: "On time", value: (s) => s.months[i].onTime, sort: "number" },
    { id: "late", label: "Late", value: (s) => s.months[i].late, sort: "number" },
    { id: "missing", label: "Not sent", value: (s) => s.months[i].missing, sort: "number" },
  ];
  const groupColumns: DtColumn<Group>[] = [
    { id: "name", label: "Company, department or group", value: (g) => g.name, render: (g) => <strong>{g.name}</strong>, phone: "title" },
    { id: "held", label: "Held", value: (g) => g.months[i].held, sort: "number" },
    { id: "minutes", label: "Minutes in", value: (g) => g.months[i].minutes, sort: "number" },
    { id: "noMinutes", label: "No minutes", value: (g) => g.months[i].noMinutes, sort: "number" },
    { id: "summary", label: "Summary checked", value: (g) => g.months[i].summaryChecked, sort: "number", hideBelow: 1100 },
    { id: "scheduled", label: "Still to come", value: (g) => g.months[i].scheduled, sort: "number", hideBelow: 1100 },
    { id: "cancelled", label: "Cancelled", value: (g) => g.months[i].cancelled, sort: "number", hideBelow: 1100 },
  ];
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
      <DataTable
        label="Reports counter"
        stateKey="board.doa.counter.reports"
        rows={data.reports.senders}
        rowKey={(s) => s.key}
        columns={senderColumns}
        filters={SENDER_FILTERS}
        onRowClick={(s) => setOpen(s.key)}
        empty={<div className="muted small">No reports are set yet.</div>}
      />
      {openSender && (
        <Drawer title={openSender.name} sub={`Reports, ${monthLabel(month)}`} onClose={() => setOpen(null)}>
          {senderLog(openSender).length === 0 && <div className="muted small">No report was due this month.</div>}
          {senderLog(openSender).map((l) => (
            <div key={l.report + l.period} className="row small" style={{ gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
              <Chip tone={STATUS[l.status]?.tone ?? "neutral"}>{STATUS[l.status]?.text ?? l.status}</Chip>
              <span>
                {l.report} · {l.label} · due {dateLabel(l.due)}
                {l.sentAt ? ` · sent ${dateTimeLabel(l.sentAt)} by ${l.by}` : ""}
              </span>
            </div>
          ))}
        </Drawer>
      )}

      <h4 style={{ margin: "12px 0 4px" }}>Meetings, {monthLabel(month)}</h4>
      <DataTable
        label="Meetings counter"
        stateKey="board.doa.counter.meetings"
        rows={data.meetings.groups.filter((gr) => Object.values(gr.months[i]).some((v) => v > 0))}
        rowKey={(g) => g.key}
        columns={groupColumns}
        phoneFacts={6}
        empty={<div className="muted small">No meetings this month.</div>}
      />
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
