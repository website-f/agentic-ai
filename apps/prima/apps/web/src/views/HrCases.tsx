import { useState } from "react";
import { api } from "../api";
import { useApp } from "../App";
import {
  Chip,
  ErrorNotice,
  Loading,
  dateLabel,
  dateTimeLabel,
  useAction,
  useLoad,
} from "../ui";

/**
 * HR Phase 3, slice 3E (Fauzan, 2 Nov 2026): each staff member's HR file. Misconduct with the right to be heard,
 * the sexual harassment inquiry (Employment Act Part XVA, confidential), grievances and performance. HR records,
 * the HR Director records a serious outcome, and the app never decides.
 */
const KIND_LABEL = {
  misconduct: "Misconduct",
  sexual_harassment: "Sexual harassment complaint",
  grievance: "Grievance",
  performance: "Performance",
} as const;
const STEP_LABEL = {
  note: "Note",
  verbal_warning: "Verbal warning",
  written_warning: "Written warning",
  final_warning: "Final warning",
  show_cause: "Show-cause letter",
  reply: "Staff member's reply",
  suspension_pending_inquiry: "Suspension before the inquiry",
  inquiry_set: "Inquiry panel set",
  inquiry_held: "Inquiry held",
  refuse_inquiry: "Inquiry refused (written reasons)",
  outcome: "Outcome",
  closed: "Closed",
} as const;
type StepKind = keyof typeof STEP_LABEL;
type Outcome =
  | "no_action"
  | "warning"
  | "suspension"
  | "downgrade"
  | "dismissal";

function keepsHr(u: {
  role: string;
  department?: string | null;
  leadership?: string | null;
}) {
  return (
    (u.role === "pwvsb_officer" && u.department === "hr") ||
    u.leadership === "cos" ||
    u.leadership === "deputy_cos"
  );
}

export function HrCasesPanel() {
  const { me } = useApp();
  const u = me.user;
  const allowed =
    keepsHr(u) || u.opsTier === "ceo" || u.role === "company_manager";
  const list = useLoad(
    () => (allowed ? api.hrCases() : Promise.resolve(null)),
    [allowed],
  );
  const staff = useLoad(
    () => (keepsHr(u) ? api.hrLeaveSettings() : Promise.resolve(null)),
    [u.id],
  );
  const act = useAction();
  const [opening, setOpening] = useState(false);
  const [f, setF] = useState({
    personId: "",
    kind: "misconduct" as keyof typeof KIND_LABEL,
    title: "",
    complainantId: "",
    receivedOn: "",
    note: "",
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [st, setSt] = useState({
    kind: "note" as StepKind,
    note: "",
    panelIds: "",
    hearingOn: "",
    proven: "",
    outcome: "" as "" | Outcome,
    days: "",
  });
  if (!allowed) return null;
  if (list.error) return <ErrorNotice error={list.error} />;
  if (!list.data) return <Loading what="HR cases" />;
  const d = list.data;
  const people = staff.data?.staff ?? [];
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Staff HR files</h2>
          <div className="muted small">
            What happened with each staff member. The staff member is told the
            charge in writing and heard before any inquiry. Sexual harassment
            complaints are confidential to HR, the HR Director and the CEO.
          </div>
        </div>
        <Chip tone="info">
          {d.rows.filter((r) => r.status === "open").length} open
        </Chip>
      </div>
      <div className="list">
        {d.rows.length === 0 && <div className="empty">No cases.</div>}
        {d.rows.slice(0, 40).map((c) => (
          <div
            key={c.id}
            className="list-item"
            style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}
          >
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 600 }}>
                  {c.person?.name ?? c.personId} · {KIND_LABEL[c.kind]}
                </div>
                <div className="muted small">
                  {c.title} · received {dateLabel(c.receivedOn)}
                  {c.shAnswerBy
                    ? ` · inquire or answer in writing by ${dateLabel(c.shAnswerBy)}`
                    : ""}
                  {c.replyOverdue ? " · reply overdue" : ""}
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                {c.confidential && <Chip tone="crit">confidential</Chip>}
                <Chip tone={c.status === "open" ? "warn" : "neutral"}>
                  {c.status}
                </Chip>
                <button
                  className="btn btn-sm"
                  onClick={() => setOpenId(openId === c.id ? null : c.id)}
                >
                  {openId === c.id ? "Close" : "File"}
                </button>
              </div>
            </div>
            {openId === c.id && (
              <>
                <ol style={{ margin: "0 0 0 18px" }} className="small">
                  {c.steps.map((s, i) => (
                    <li key={i}>
                      <b>{STEP_LABEL[s.kind]}</b> · {dateTimeLabel(s.at)} ·{" "}
                      {s.by}: {s.note}
                      {s.replyDue ? ` (reply by ${dateLabel(s.replyDue)})` : ""}
                      {s.panel
                        ? ` (panel: ${s.panel.join(", ")}, hearing ${s.hearingOn ? dateLabel(s.hearingOn) : ""})`
                        : ""}
                      {s.proven != null
                        ? ` (${s.proven ? "proven" : "not proven"})`
                        : ""}
                      {s.outcome
                        ? ` (${s.outcome.replace("_", " ")}${s.suspensionDays ? `, ${s.suspensionDays} days` : ""})`
                        : ""}
                    </li>
                  ))}
                </ol>
                {(c.canAct || c.canDecideOutcome) && (
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 6 }}
                  >
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      <select
                        className="select"
                        value={st.kind}
                        onChange={(e) =>
                          setSt({ ...st, kind: e.target.value as StepKind })
                        }
                        aria-label="Step"
                      >
                        {(Object.keys(STEP_LABEL) as StepKind[])
                          .filter(
                            (k) =>
                              (k === "outcome"
                                ? c.canDecideOutcome
                                : c.canAct) &&
                              (k !== "refuse_inquiry" ||
                                c.kind === "sexual_harassment"),
                          )
                          .map((k) => (
                            <option key={k} value={k}>
                              {STEP_LABEL[k]}
                            </option>
                          ))}
                      </select>
                      {st.kind === "inquiry_set" && (
                        <>
                          <select
                            className="select"
                            multiple
                            aria-label="Inquiry panel"
                            value={st.panelIds ? st.panelIds.split(",") : []}
                            onChange={(e) =>
                              setSt({
                                ...st,
                                panelIds: Array.from(
                                  e.target.selectedOptions,
                                  (o) => o.value,
                                ).join(","),
                              })
                            }
                          >
                            {people
                              .filter(
                                (p) =>
                                  p.personId !== c.personId &&
                                  p.personId !== c.complainantId,
                              )
                              .map((p) => (
                                <option key={p.personId} value={p.personId}>
                                  {p.name}
                                </option>
                              ))}
                          </select>
                          <input
                            className="input"
                            type="date"
                            aria-label="Hearing day"
                            value={st.hearingOn}
                            onChange={(e) =>
                              setSt({ ...st, hearingOn: e.target.value })
                            }
                          />
                        </>
                      )}
                      {st.kind === "inquiry_held" && (
                        <select
                          className="select"
                          value={st.proven}
                          onChange={(e) =>
                            setSt({ ...st, proven: e.target.value })
                          }
                          aria-label="Proven"
                        >
                          <option value="">Proven?</option>
                          <option value="yes">Proven</option>
                          <option value="no">Not proven</option>
                        </select>
                      )}
                      {st.kind === "outcome" && (
                        <select
                          className="select"
                          value={st.outcome}
                          onChange={(e) =>
                            setSt({ ...st, outcome: e.target.value as Outcome })
                          }
                          aria-label="Outcome"
                        >
                          <option value="">Outcome</option>
                          <option value="no_action">No action</option>
                          <option value="warning">Warning</option>
                          <option value="suspension">
                            Suspension without wages
                          </option>
                          <option value="downgrade">Downgrade</option>
                          <option value="dismissal">Dismissal</option>
                        </select>
                      )}
                      {(st.kind === "suspension_pending_inquiry" ||
                        st.outcome === "suspension") && (
                        <input
                          className="input"
                          style={{ width: 90 }}
                          inputMode="numeric"
                          placeholder="Days"
                          aria-label="Days"
                          value={st.days}
                          onChange={(e) =>
                            setSt({ ...st, days: e.target.value })
                          }
                        />
                      )}
                    </div>
                    <input
                      className="input"
                      placeholder="What happened (needed)"
                      aria-label="What happened"
                      value={st.note}
                      onChange={(e) => setSt({ ...st, note: e.target.value })}
                    />
                    <button
                      className="btn btn-sm btn-primary"
                      style={{ alignSelf: "flex-start" }}
                      disabled={act.busy || !st.note.trim()}
                      onClick={async () => {
                        const r = await act.run(
                          () =>
                            api.hrCaseStep(c.id, {
                              kind: st.kind,
                              note: st.note,
                              panelIds: st.panelIds
                                ? st.panelIds
                                    .split(",")
                                    .map((x) => x.trim())
                                    .filter(Boolean)
                                : undefined,
                              hearingOn: st.hearingOn || null,
                              proven: st.proven ? st.proven === "yes" : null,
                              outcome: st.outcome || null,
                              suspensionDays: st.days ? Number(st.days) : null,
                            }),
                          "Recorded.",
                        );
                        if (r) {
                          setSt({
                            kind: "note",
                            note: "",
                            panelIds: "",
                            hearingOn: "",
                            proven: "",
                            outcome: "",
                            days: "",
                          });
                          list.reload();
                        }
                      }}
                    >
                      Record
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
      {d.canOpen && !opening && (
        <button
          className="btn btn-sm"
          style={{ alignSelf: "flex-start", marginTop: 8 }}
          onClick={() => setOpening(true)}
        >
          Open a case
        </button>
      )}
      {opening && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            marginTop: 8,
          }}
        >
          <div className="grid-2">
            <label className="field">
              <span className="label">Staff member</span>
              <select
                className="select"
                value={f.personId}
                onChange={(e) => setF({ ...f, personId: e.target.value })}
                aria-label="Staff member"
              >
                <option value="">Choose</option>
                {people
                  .filter((p) => !p.own)
                  .map((p) => (
                    <option key={p.personId} value={p.personId}>
                      {p.name} ({p.staffNo})
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span className="label">Kind</span>
              <select
                className="select"
                value={f.kind}
                onChange={(e) =>
                  setF({
                    ...f,
                    kind: e.target.value as keyof typeof KIND_LABEL,
                  })
                }
                aria-label="Kind"
              >
                {(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map(
                  (k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="field">
              <span className="label">Complainant (if any)</span>
              <select
                className="select"
                value={f.complainantId}
                onChange={(e) => setF({ ...f, complainantId: e.target.value })}
                aria-label="Complainant"
              >
                <option value="">None</option>
                {people
                  .filter((p) => !p.own && p.personId !== f.personId)
                  .map((p) => (
                    <option key={p.personId} value={p.personId}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span className="label">Received on</span>
              <input
                className="input"
                type="date"
                value={f.receivedOn}
                onChange={(e) => setF({ ...f, receivedOn: e.target.value })}
                aria-label="Received on"
              />
            </label>
          </div>
          <input
            className="input"
            placeholder="What the case is about"
            aria-label="What the case is about"
            value={f.title}
            onChange={(e) => setF({ ...f, title: e.target.value })}
          />
          <input
            className="input"
            placeholder="First note"
            aria-label="First note"
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
          />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-primary"
              disabled={
                act.busy ||
                !f.personId ||
                f.title.trim().length < 5 ||
                !f.receivedOn
              }
              onClick={async () => {
                const r = await act.run(
                  () =>
                    api.openHrCase({
                      ...f,
                      complainantId: f.complainantId || null,
                    }),
                  "Case opened.",
                );
                if (r) {
                  setOpening(false);
                  list.reload();
                }
              }}
            >
              Open case
            </button>
            <button className="btn" onClick={() => setOpening(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}
