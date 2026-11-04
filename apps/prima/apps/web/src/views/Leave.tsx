import { useState } from "react";
import { LEAVE_LABEL, type LeaveKind, type ProofInput } from "@prima/core";
import { api, type LeaveList } from "../api";
import {
  Chip,
  ErrorNotice,
  Loading,
  dateLabel,
  dateTimeLabel,
  useAction,
  useLoad,
} from "../ui";
import { ProofPicker } from "./Proof";

export const LEAVE_KINDS: LeaveKind[] = [
  "ANNUAL",
  "SICK",
  "HOSPITAL",
  "EMERGENCY",
  "UNPAID",
  "ABSENCE_REASON",
];

/**
 * Leave and absence requests waiting for a decision (Fauzan, 25 Oct 2026). Guards and officers: the OM or higher
 * decides; other staff: the HR administrator or higher. Unanswered requests move up a level every 12 hours.
 */
export function LeavePanel({
  companyId,
  title = "Leave and absence requests",
}: {
  companyId?: string;
  title?: string;
}) {
  const { data, error } = useLoad(
    () => api.leaveRequests({ companyId }),
    [companyId],
  );
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="leave requests" />;
  const mine = data.rows.filter((r) => r.canDecide).length;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <Chip tone={mine ? "warn" : "ok"}>
          {mine ? `${mine} for you` : `${data.rows.length} waiting`}
        </Chip>
      </div>
      <div className="list">
        {data.rows.length === 0 && (
          <div className="empty">No request is waiting.</div>
        )}
        {data.rows.map((r) => (
          <LeaveRow key={r.request.id} r={r} />
        ))}
      </div>
      <div className="muted small" style={{ padding: "8px 12px" }}>
        Moves up a level after every {data.rule.value} hours without a decision
        (rule {data.rule.id}).
      </div>
    </section>
  );
}

function LeaveRow({ r }: { r: LeaveList["rows"][number] }) {
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const act = useAction();
  const q = r.request;
  const decide = (approve: boolean) =>
    act.run(
      () => api.decideLeave(q.id, approve, note),
      approve ? "Approved." : "Rejected.",
    );
  return (
    <div
      className="list-item"
      style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}
    >
      <div
        className="row"
        style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}
      >
        <div>
          <div style={{ fontWeight: 600 }}>
            {r.person.name} · {LEAVE_LABEL[q.kind]}
          </div>
          <div className="muted small">
            {r.person.staffNo} · {r.companyName} · {dateLabel(q.from)}
            {q.to !== q.from ? ` to ${dateLabel(q.to)}` : ""} ({q.days} day
            {q.days === 1 ? "" : "s"})
          </div>
          <div className="small">{q.reason}</div>
          <div className="muted small">
            Asked {dateTimeLabel(q.requestedAt)} by {q.requestedBy}
            {q.proofIds.length
              ? ` · ${q.proofIds.length} document(s)`
              : " · no document"}
          </div>
        </div>
        {r.waitingWith && (
          <Chip
            tone={
              r.waitingWith.level === "OM" || r.waitingWith.level === "HR"
                ? "info"
                : "warn"
            }
          >
            With {r.waitingWith.label}
            {r.waitingWith.person !== "Not assigned"
              ? ` (${r.waitingWith.person})`
              : ""}
          </Chip>
        )}
      </div>
      {r.canDecide && !open && (
        <div>
          <button className="btn btn-sm" onClick={() => setOpen(true)}>
            Decide
          </button>
        </div>
      )}
      {r.canDecide && open && (
        <>
          <input
            className="input"
            aria-label="Decision note"
            placeholder="Note (required to reject)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <ErrorNotice error={act.error} />
          <div className="row">
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy}
              onClick={() => decide(true)}
            >
              Approve
            </button>
            <button
              className="btn btn-sm"
              disabled={act.busy}
              onClick={() => decide(false)}
            >
              Reject
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Ask for leave or give the reason for an absence, for a guard (site device) or by company staff for someone. */
export function LeaveForm({
  personId,
  staffNo,
  face,
  onDone,
}: {
  personId?: string;
  staffNo?: string;
  face?: () => { score: number; live: boolean } | null;
  onDone: () => void;
}) {
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  const [kind, setKind] = useState<LeaveKind>("ANNUAL");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState("");
  const [proof, setProof] = useState<ProofInput[]>([]);
  const [illness, setIllness] = useState("");
  const [clinic, setClinic] = useState("");
  const [mcNo, setMcNo] = useState("");
  const act = useAction();
  const needsMc = kind === "SICK" || kind === "HOSPITAL";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label className="field">
        <span className="label">What for</span>
        <select
          className="select"
          value={kind}
          onChange={(e) => setKind(e.target.value as LeaveKind)}
          aria-label="Kind of leave"
        >
          {LEAVE_KINDS.map((k) => (
            <option key={k} value={k}>
              {LEAVE_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <div className="grid-2">
        <label className="field">
          <span className="label">From</span>
          <input
            className="input"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="First day"
          />
        </label>
        <label className="field">
          <span className="label">To</span>
          <input
            className="input"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="Last day"
          />
        </label>
      </div>
      <label className="field">
        <span className="label">Reason</span>
        <input
          className="input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-label="Reason"
          placeholder="e.g. fever, clinic MC"
        />
      </label>
      {needsMc && (
        <div className="grid-2">
          <label className="field">
            <span className="label">Illness, as on the MC</span>
            <input
              className="input"
              value={illness}
              onChange={(e) => setIllness(e.target.value)}
              aria-label="Illness"
              placeholder="e.g. acute gastroenteritis"
            />
          </label>
          <label className="field">
            <span className="label">Clinic or hospital</span>
            <input
              className="input"
              value={clinic}
              onChange={(e) => setClinic(e.target.value)}
              aria-label="Clinic"
              placeholder="e.g. Klinik Mediviron Klang"
            />
          </label>
          <label className="field">
            <span className="label">MC serial number</span>
            <input
              className="input mono"
              value={mcNo}
              onChange={(e) => setMcNo(e.target.value)}
              aria-label="MC serial number"
              placeholder="Printed on the MC"
            />
          </label>
        </div>
      )}
      <ProofPicker
        site={null}
        refText="Leave"
        items={proof}
        onChange={setProof}
        documentsOnly
        required={needsMc}
      />
      {needsMc && (
        <span className="muted small">
          Attach the medical certificate. Inform the company within 48 hours.
          Guards' MCs are approved by the OM; office staff's by HR.
        </span>
      )}
      <ErrorNotice error={act.error} />
      <div className="row">
        <button
          className="btn btn-primary"
          disabled={
            act.busy ||
            reason.trim().length < 3 ||
            (needsMc &&
              (!proof.length ||
                illness.trim().length < 3 ||
                clinic.trim().length < 3 ||
                mcNo.trim().length < 3)) ||
            (!personId && !staffNo)
          }
          onClick={async () => {
            const r = await act.run(
              () =>
                api.requestLeave({
                  personId: personId ?? null,
                  staffNo: staffNo ?? null,
                  face: face ? face() : null,
                  kind,
                  from,
                  to,
                  reason,
                  illness: needsMc ? illness : null,
                  clinic: needsMc ? clinic : null,
                  mcNo: needsMc ? mcNo : null,
                  proof,
                }),
              "Request sent. The OM or HR decides; it moves up if nobody does within 12 hours.",
            );
            if (r) onDone();
          }}
        >
          Send request
        </button>
      </div>
    </div>
  );
}
