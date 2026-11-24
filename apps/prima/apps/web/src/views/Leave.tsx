import { Select } from '../SearchSelect';
import { useState } from 'react';
import { LEAVE_LABEL, type LeaveKind, type ProofInput } from '@prima/core';
import { api, type LeaveList } from '../api';
import { Chip, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';
import { ProofPicker } from './Proof';
import { Person } from '../kit';
import { DataTable } from '../DataTable';
import { VcRecordForm } from './VcRecord';



export const LEAVE_KINDS: LeaveKind[] = [
  "ANNUAL",
  "SICK",
  "HOSPITAL",
  "EMERGENCY",
  "UNPAID",
  "ABSENCE_REASON",
  "MATERNITY",
  "PATERNITY",
];

/**
 * Leave and absence requests waiting for a decision (Fauzan, 25 Oct 2026). Guards and officers: the OM or higher
 * decides; other staff: the HR administrator or higher, then the Vice Chairman consents (Fauzan, 1 Nov 2026).
 * Unanswered requests move up a level every 12 hours.
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
      {/* P107: the requests as a data table (search, kind / company / "for me" filters, sort, pages); the reason, who
          decided so far and the Decide box sit under each row. */}
      <div className="lv-dt-pad">
        <DataTable
          label={title}
          stateKey={`leave.requests.${companyId ?? "all"}`}
          rows={data.rows}
          rowKey={(r) => r.request.id}
          searchPlaceholder="Search name, staff no. or reason"
          searchText={(r) => `${r.person.staffNo} ${r.request.reason}`}
          rowTone={(r) => (r.canDecide ? "info" : undefined)}
          empty={<div className="empty">No request is waiting.</div>}
          filters={[
            {
              id: "mine",
              label: "Show",
              value: (r) => (r.canDecide ? "mine" : "others"),
              options: [
                { value: "mine", label: "For me to decide" },
                { value: "others", label: "With someone else" },
              ],
            },
            { id: "kind", label: "Kind", value: (r) => r.request.kind, optionLabel: (k) => LEAVE_LABEL[k as LeaveKind] ?? k },
            { id: "company", label: "Company", value: (r) => r.companyName },
            { id: "with", label: "Waiting with", value: (r) => r.waitingWith?.label ?? "" },
          ]}
          columns={[
            {
              id: "name",
              label: "Name",
              value: (r) => r.person.name,
              phone: "title",
              render: (r) => <Person name={r.person.name} sub={`${r.person.staffNo} · ${r.companyName}`} size={32} />,
            },
            { id: "kind", label: "Kind", value: (r) => LEAVE_LABEL[r.request.kind], translate: true },
            {
              id: "from",
              label: "Dates",
              value: (r) => r.request.from,
              sort: "date",
              render: (r) => (
                <span>
                  {dateLabel(r.request.from)}
                  {r.request.to !== r.request.from ? ` to ${dateLabel(r.request.to)}` : ""}
                </span>
              ),
            },
            { id: "days", label: "Days", value: (r) => r.request.days, sort: "number", hideBelow: 1100 },
            { id: "asked", label: "Asked", value: (r) => r.request.requestedAt, sort: "date", hideBelow: 1280, render: (r) => dateTimeLabel(r.request.requestedAt) },
            {
              id: "with",
              label: "Waiting with",
              value: (r) => r.waitingWith?.label ?? "",
              render: (r) =>
                r.waitingWith ? (
                  <Chip tone={r.waitingWith.level === "OM" || r.waitingWith.level === "HR" ? "info" : "warn"}>
                    With {r.waitingWith.label}
                    {r.waitingWith.person !== "Not assigned" ? ` (${r.waitingWith.person})` : ""}
                  </Chip>
                ) : (
                  "–"
                ),
            },
          ]}
          rowDetail={(r) => <LeaveRow r={r} />}
        />
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
  const [recording, setRecording] = useState(false);
  const act = useAction();
  const q = r.request;
  const consent = !!r.hrApproval;
  const authorise = !!r.managerStage;
  const needsComment = r.staffLeave;
  const decide = (approve: boolean) =>
    act.run(
      () => api.decideLeave(q.id, approve, note),
      approve
        ? authorise
          ? "Authorised. HR now decides."
          : consent
          ? "Consented. The leave is approved."
          : r.staffLeave
            ? "Approved. It now waits for the Vice Chairman's consent."
            : "Approved."
        : consent
          ? "Consent refused. The leave is rejected."
          : "Rejected.",
    );
  // P107: the request's reason, who asked and decided so far, and the Decide box, under its row in the table.
  return (
    <div className="lv-dt-detail">
      <div
        className="row"
        style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}
      >
        <div>
          <div className="muted small">
            {q.days} day{q.days === 1 ? "" : "s"}
          </div>
          <div className="small">{q.reason}</div>
          <div className="muted small">
            Asked {dateTimeLabel(q.requestedAt)} by {q.requestedBy}
            {q.proofIds.length
              ? ` · ${q.proofIds.length} document(s)`
              : " · no document"}
          </div>
          {r.managerAuthorised && (
            <div className="muted small">
              Authorised by the Company Manager ({r.managerAuthorised.by}) on{" "}
              {dateTimeLabel(r.managerAuthorised.at)}: {r.managerAuthorised.note}
            </div>
          )}
          {r.hrApproval && (
            <div className="muted small">
              Approved by HR ({r.hrApproval.by}) on{" "}
              {dateTimeLabel(r.hrApproval.at)}: {r.hrApproval.note}
            </div>
          )}
        </div>
      </div>
      {r.canRecordVc && !recording && !open && (
        <div>
          <button className="btn btn-sm" onClick={() => setRecording(true)}>
            Record the Vice Chairman's answer
          </button>
        </div>
      )}
      {r.canRecordVc && recording && (
        <VcRecordForm refText={`${r.person.staffNo} leave ${q.from}`} send={(body) => api.recordLeaveVc(q.id, body)} onClose={() => setRecording(false)} />
      )}
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
            placeholder={
              needsComment
                ? "Comment (needed to approve or reject; a short one is fine to approve)"
                : "Note (required to reject)"
            }
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <ErrorNotice error={act.error} />
          <div className="row">
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || (needsComment && !note.trim())}
              onClick={() => decide(true)}
            >
              {authorise ? "Authorise" : consent ? "Consent" : "Approve"}
            </button>
            <button
              className="btn btn-sm"
              disabled={act.busy}
              onClick={() => decide(false)}
            >
              {authorise ? "Refuse" : consent ? "Refuse consent" : "Reject"}
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
  prefill,
}: {
  personId?: string;
  staffNo?: string;
  face?: () => { score: number; live: boolean } | null;
  onDone: () => void;
  /** A refused request to correct and send again as a new request (the refused one stays on record). */
  prefill?: { kind: LeaveKind; from: string; to: string; reason: string; illness?: string; clinic?: string; mcNo?: string; correctsId?: string; reusedDocs?: number } | null;
}) {
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  const [kind, setKind] = useState<LeaveKind>(prefill?.kind ?? "ANNUAL");
  const [from, setFrom] = useState(prefill?.from ?? today);
  const [to, setTo] = useState(prefill?.to ?? today);
  const [reason, setReason] = useState(prefill?.reason ?? "");
  const [proof, setProof] = useState<ProofInput[]>([]);
  const [illness, setIllness] = useState(prefill?.illness ?? "");
  const [clinic, setClinic] = useState(prefill?.clinic ?? "");
  const [mcNo, setMcNo] = useState(prefill?.mcNo ?? "");
  // A correction of your own refused request reuses its MC documents (the server checks it is yours and refused).
  const reused = prefill?.correctsId && (kind === "SICK" || kind === "HOSPITAL") ? (prefill.reusedDocs ?? 0) : 0;
  const act = useAction();
  const needsMc = kind === "SICK" || kind === "HOSPITAL";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label className="field">
        <span className="label">What for</span>
        <Select
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
        </Select>
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
        required={needsMc && !reused}
      />
      {reused > 0 && (
        <span className="muted small">
          {reused} document{reused === 1 ? "" : "s"} from the refused request {reused === 1 ? "is" : "are"} kept with this one. Add another only if HR asked for it.
        </span>
      )}
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
              ((!proof.length && !reused) ||
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
                  correctsId: prefill?.correctsId ?? null,
                }),
              "Request sent. The OM decides for guards and officers; for staff, HR decides and the Vice Chairman consents. It moves up if nobody decides within 12 hours.",
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
