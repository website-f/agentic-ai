import { useState } from "react";
import {
  SCREENING_CHECK_LABEL,
  SCREENING_RESULT_LABEL,
  SCREENING_SUBJECT_LABEL,
  type ScreeningCheckKind,
  type ScreeningSubject,
} from "@prima/core";
import { api } from "../api";
import { useApp } from "../App";
import {
  Chip,
  ErrorNotice,
  Kpi,
  Loading,
  dateLabel,
  useAction,
  useLoad,
} from "../ui";

/**
 * Screening case file (PIKM/ISO review, Fauzan 5 Nov 2026): one case per person screened, before hire and again when
 * due. HR records each check with the authority's reference; Prima fills in what HR already holds (the KDN licence
 * record). The HR Director decides with a reason, never on a case they opened. The CEO and ACT read only.
 */
const STATUS_TONE = {
  pending: "warn",
  clear: "ok",
  concern: "crit",
  not_needed: "info",
} as const;
const STATUS_LABEL = {
  pending: "to do",
  clear: "clear",
  concern: "concern",
  not_needed: "not needed",
} as const;

export function ScreeningPanel() {
  const b = useLoad(() => api.screening().catch(() => null), []);
  const myId = useApp().me?.user.id;
  const act = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const v = (k: string) => f[k] ?? "";
  const set = (k: string, x: string) => setF((o) => ({ ...o, [k]: x }));
  if (!b.data) return b.loading ? <Loading what="screening" /> : null;
  const d = b.data;
  const works = d.role === "hr" || d.role === "decide";
  const subject = (v("subject") || "guard") as ScreeningSubject;
  const company = subject === "director" || subject === "shareholder";
  const run = (fn: () => Promise<unknown>, ok: string, reset: string[] = []) =>
    void act.run(fn, ok).then(
      (r) =>
        r &&
        (setF((o) => ({
          ...o,
          ...Object.fromEntries(reset.map((k) => [k, ""])),
        })),
        b.reload()),
    );
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Screening</h2>
          <div className="muted small">
            One case file per person: each check with the authority's reference,
            then the HR Director's decision. Repeat screening falls due on its
            own.
          </div>
        </div>
      </div>
      <div className="kpis">
        <Kpi label="Open cases" value={d.kpis.open} />
        <Kpi
          label="Ready to decide"
          value={d.kpis.readyToDecide}
          tone={d.kpis.readyToDecide ? "warn" : undefined}
        />
        <Kpi
          label="Working, KDN vetting pending"
          value={d.kpis.vettingPending}
        />
        <Kpi
          label="Repeat due"
          value={d.kpis.repeatDue}
          tone={d.kpis.repeatDue ? "warn" : undefined}
        />
        {d.kpis.endEmployment > 0 && (
          <Kpi
            label="Vetting failed: end employment"
            value={d.kpis.endEmployment}
            tone="crit"
          />
        )}
      </div>
      <div className="list">
        {d.rows.length === 0 && (
          <div className="empty">No screening cases yet.</div>
        )}
        {d.rows.map((r) => {
          const c = r.case;
          const done = c.checks.filter((k) => k.status !== "pending").length;
          const isOpen = open === c.id;
          return (
            <div
              key={c.id}
              className="list-item"
              style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}
            >
              <div>
                <span style={{ fontWeight: 600 }}>{c.name}</span> ·{" "}
                {SCREENING_SUBJECT_LABEL[c.subject]} · {r.companyName} ·{" "}
                {c.purpose === "repeat" ? "repeat screening" : "new"}{" "}
                {c.status === "open" ? (
                  <Chip
                    tone={r.canClear || r.canClearPending ? "warn" : "info"}
                  >
                    {done} of {c.checks.length} checks done
                  </Chip>
                ) : c.status === "decided" && c.decision ? (
                  <Chip
                    tone={c.decision.result === "not_cleared" ? "crit" : "ok"}
                  >
                    {SCREENING_RESULT_LABEL[c.decision.result]}
                  </Chip>
                ) : (
                  <Chip tone="info">withdrawn</Chip>
                )}{" "}
                {r.concerns.length > 0 && <Chip tone="crit">concern</Chip>}{" "}
                {r.mustEndEmployment && (
                  <Chip tone="crit">vetting failed: end employment now</Chip>
                )}{" "}
                {r.repeatState === "overdue" && (
                  <Chip tone="crit">repeat overdue</Chip>
                )}
                {r.repeatState === "due_soon" && (
                  <Chip tone="warn">
                    repeat due {dateLabel(c.repeatDueOn!)}
                  </Chip>
                )}
              </div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <button
                  className="btn btn-sm"
                  onClick={() => setOpen(isOpen ? null : c.id)}
                >
                  {isOpen ? "Hide" : "Open file"}
                </button>
                {r.canRepeat && (
                  <button
                    className="btn btn-sm"
                    disabled={act.busy}
                    onClick={() =>
                      run(
                        () => api.screeningRepeat(c.id),
                        "Repeat screening opened.",
                      )
                    }
                  >
                    Start repeat screening
                  </button>
                )}
              </div>
              {isOpen && (
                <div style={{ display: "grid", gap: 6 }}>
                  <div className="muted small">
                    Opened by {c.openedBy} on {dateLabel(c.at.slice(0, 10))}. ID
                    on file: {c.idMasked || "not given"}.
                  </div>
                  <div className="table-wrap">
                    <table className="table small">
                      <thead>
                        <tr>
                          <th>Check</th>
                          <th>Result</th>
                          <th>Reference</th>
                          <th>By</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.checks.map((k) => (
                          <tr key={k.kind}>
                            <td>{SCREENING_CHECK_LABEL[k.kind]}</td>
                            <td>
                              <Chip tone={STATUS_TONE[k.status]}>
                                {STATUS_LABEL[k.status]}
                              </Chip>
                              {k.note && <div className="muted">{k.note}</div>}
                            </td>
                            <td>
                              {k.authority && `${k.authority} `}
                              {k.ref}
                              {k.resultOn && (
                                <div className="muted">
                                  {dateLabel(k.resultOn)}
                                </div>
                              )}
                            </td>
                            <td>
                              {k.status === "pending" && !k.ref ? "" : k.by}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {c.decision && (
                    <div className="small">
                      Decision by {c.decision.by}:{" "}
                      {SCREENING_RESULT_LABEL[c.decision.result]}.{" "}
                      {c.decision.note}
                      {c.decision.conditions && (
                        <div>Conditions: {c.decision.conditions}</div>
                      )}
                      {c.repeatDueOn && (
                        <div className="muted">
                          Repeat screening due {dateLabel(c.repeatDueOn)}
                        </div>
                      )}
                    </div>
                  )}
                  {c.endEmployment?.doneOn && (
                    <div className="small">
                      Employment ended {dateLabel(c.endEmployment.doneOn)}{" "}
                      ({c.endEmployment.by}): {c.endEmployment.note}
                    </div>
                  )}
                  {r.canRecordVetting && (
                    <div style={{ display: "grid", gap: 6 }}>
                      <div className="small" style={{ fontWeight: 600 }}>
                        KDN vetting result
                      </div>
                      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                        <input
                          className="input"
                          placeholder="KDN reference or letter number"
                          aria-label="KDN reference"
                          value={v("kdnRef")}
                          onChange={(e) => set("kdnRef", e.target.value)}
                        />
                        <input
                          className="input"
                          placeholder="What KDN said (needed if failed)"
                          aria-label="KDN note"
                          value={v("kdnNote")}
                          onChange={(e) => set("kdnNote", e.target.value)}
                        />
                      </div>
                      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={act.busy || v("kdnRef").trim().length < 3}
                          onClick={() =>
                            run(
                              () =>
                                api.screeningAct("vettingResult", {
                                  id: c.id,
                                  passed: true,
                                  ref: v("kdnRef"),
                                  note: v("kdnNote"),
                                }),
                              "Vetting passed. Now cleared.",
                              ["kdnRef", "kdnNote"],
                            )
                          }
                        >
                          Vetting passed
                        </button>
                        <button
                          className="btn btn-sm"
                          disabled={
                            act.busy ||
                            v("kdnRef").trim().length < 3 ||
                            v("kdnNote").trim().length < 5
                          }
                          onClick={() =>
                            run(
                              () =>
                                api.screeningAct("vettingResult", {
                                  id: c.id,
                                  passed: false,
                                  ref: v("kdnRef"),
                                  note: v("kdnNote"),
                                }),
                              "Vetting failed recorded. End the employment now.",
                              ["kdnRef", "kdnNote"],
                            )
                          }
                        >
                          Vetting failed
                        </button>
                      </div>
                    </div>
                  )}
                  {r.canRecordEnd && (
                    <div style={{ display: "grid", gap: 6 }}>
                      <div className="notice small" data-tone="crit">
                        KDN vetting failed. End the employment now through the
                        leaving steps, then record it here.
                      </div>
                      <input
                        className="input"
                        placeholder="Leaving record or letter, and the date it ended"
                        aria-label="How the employment ended"
                        value={v("endNote")}
                        onChange={(e) => set("endNote", e.target.value)}
                      />
                      <div>
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={act.busy || v("endNote").trim().length < 5}
                          onClick={() =>
                            run(
                              () =>
                                api.screeningAct("employmentEnded", {
                                  id: c.id,
                                  note: v("endNote"),
                                }),
                              "End of employment recorded.",
                              ["endNote"],
                            )
                          }
                        >
                          Employment ended
                        </button>
                      </div>
                    </div>
                  )}
                  {r.canWork && (
                    <div style={{ display: "grid", gap: 6 }}>
                      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                        <select
                          className="input"
                          aria-label="Check"
                          value={v("kind")}
                          onChange={(e) => set("kind", e.target.value)}
                        >
                          <option value="">Record a check…</option>
                          {c.checks.map((k) => (
                            <option key={k.kind} value={k.kind}>
                              {SCREENING_CHECK_LABEL[k.kind]}
                            </option>
                          ))}
                        </select>
                        <select
                          className="input"
                          aria-label="Result"
                          value={v("status") || "clear"}
                          onChange={(e) => set("status", e.target.value)}
                        >
                          <option value="clear">Clear</option>
                          <option value="concern">Concern</option>
                          <option value="not_needed">Not needed</option>
                          <option value="pending">Back to to-do</option>
                        </select>
                        <input
                          className="input"
                          placeholder="Authority, e.g. PDRM"
                          aria-label="Authority"
                          value={v("authority")}
                          onChange={(e) => set("authority", e.target.value)}
                        />
                        <input
                          className="input"
                          placeholder="Reference or where the evidence is filed"
                          aria-label="Reference"
                          value={v("ref")}
                          onChange={(e) => set("ref", e.target.value)}
                        />
                      </div>
                      <input
                        className="input"
                        placeholder="Note (needed for a concern or not needed)"
                        aria-label="Check note"
                        value={v("note")}
                        onChange={(e) => set("note", e.target.value)}
                      />
                      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={act.busy || !v("kind")}
                          onClick={() =>
                            run(
                              () =>
                                api.screeningAct("check", {
                                  id: c.id,
                                  kind: v("kind") as ScreeningCheckKind,
                                  status: v("status") || "clear",
                                  authority: v("authority"),
                                  ref: v("ref"),
                                  note: v("note"),
                                }),
                              "Check recorded.",
                              ["kind", "authority", "ref", "note"],
                            )
                          }
                        >
                          Save check
                        </button>
                        <button
                          className="btn btn-sm"
                          disabled={act.busy || v("note").trim().length < 5}
                          title="Write the reason in the note first"
                          onClick={() =>
                            run(
                              () =>
                                api.screeningAct("withdraw", {
                                  id: c.id,
                                  note: v("note"),
                                }),
                              "Case withdrawn.",
                              ["note"],
                            )
                          }
                        >
                          Withdraw case
                        </button>
                      </div>
                    </div>
                  )}
                  {r.canDecide && (
                    <div
                      style={{
                        display: "grid",
                        gap: 6,
                        borderTop: "1px solid var(--line, #ddd)",
                        paddingTop: 6,
                      }}
                    >
                      <div className="small" style={{ fontWeight: 600 }}>
                        Your decision
                      </div>
                      {!r.canClear && (
                        <div className="muted small">
                          Still open:{" "}
                          {r.open
                            .map((k) => SCREENING_CHECK_LABEL[k])
                            .join(", ")}
                        </div>
                      )}
                      <select
                        className="input"
                        aria-label="Decision"
                        value={v("result")}
                        onChange={(e) => set("result", e.target.value)}
                      >
                        <option value="">Choose…</option>
                        {r.canClear && (
                          <option value="cleared">
                            {SCREENING_RESULT_LABEL.cleared}
                          </option>
                        )}
                        {r.canClearPending && (
                          <option value="cleared_pending">
                            {SCREENING_RESULT_LABEL.cleared_pending}
                          </option>
                        )}
                        <option value="not_cleared">
                          {SCREENING_RESULT_LABEL.not_cleared}
                        </option>
                      </select>
                      <input
                        className="input"
                        placeholder="Reason for the decision"
                        aria-label="Decision reason"
                        value={v("reason")}
                        onChange={(e) => set("reason", e.target.value)}
                      />
                      {r.concerns.length > 0 &&
                        v("result") &&
                        v("result") !== "not_cleared" && (
                          <input
                            className="input"
                            placeholder="Conditions for clearing despite the concern"
                            aria-label="Conditions"
                            value={v("conditions")}
                            onChange={(e) => set("conditions", e.target.value)}
                          />
                        )}
                      <div>
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={
                            act.busy ||
                            !v("result") ||
                            v("reason").trim().length < 5
                          }
                          onClick={() =>
                            run(
                              () =>
                                api.screeningAct("decide", {
                                  id: c.id,
                                  result: v("result"),
                                  note: v("reason"),
                                  conditions: v("conditions"),
                                }),
                              "Decision recorded.",
                              ["result", "reason", "conditions"],
                            )
                          }
                        >
                          Record decision
                        </button>
                      </div>
                    </div>
                  )}
                  {c.status === "open" &&
                    d.role === "decide" &&
                    c.openedById === myId &&
                    !r.canDecide && (
                      <div className="muted small">
                        You opened this case, so the other HR Director decides.
                      </div>
                    )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {d.screeners.length > 0 && (
        <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
          <div className="small" style={{ fontWeight: 600 }}>
            People doing screening
          </div>
          <div className="muted small">
            Each should be screened, have accepted confidentiality and be
            trained in screening.
          </div>
          {d.screeners.map((x) => (
            <div key={x.userId} className="small">
              {x.name}{" "}
              <Chip tone={x.screened ? "ok" : "warn"}>
                {x.screened ? "screened" : "not screened"}
              </Chip>{" "}
              <Chip tone={x.confidentiality ? "ok" : "warn"}>
                {x.confidentiality ? "confidentiality accepted" : "confidentiality not accepted"}
              </Chip>{" "}
              <Chip tone={x.trained ? "ok" : "warn"}>
                {x.trained ? "trained" : "no screening training"}
              </Chip>
            </div>
          ))}
        </div>
      )}
      {works && (
        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
          <div className="small" style={{ fontWeight: 600 }}>
            Open a screening case
          </div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <select
              className="input"
              aria-label="Who is screened"
              value={subject}
              onChange={(e) => set("subject", e.target.value)}
            >
              {Object.entries(SCREENING_SUBJECT_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            {company ? (
              <>
                <select
                  className="input"
                  aria-label="Company"
                  value={v("companyId")}
                  onChange={(e) => set("companyId", e.target.value)}
                >
                  <option value="">Company…</option>
                  {d.companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <input
                  className="input"
                  placeholder="Name as on IC or passport"
                  aria-label="Name"
                  value={v("name")}
                  onChange={(e) => set("name", e.target.value)}
                />
                <input
                  className="input"
                  placeholder="IC or passport, last 4 digits only"
                  aria-label="Masked ID"
                  value={v("idMasked")}
                  onChange={(e) => set("idMasked", e.target.value)}
                />
              </>
            ) : (
              <input
                className="input"
                placeholder="Staff number"
                aria-label="Staff number"
                value={v("staffNo")}
                onChange={(e) => set("staffNo", e.target.value)}
              />
            )}
          </div>
          <div>
            <button
              className="btn btn-sm btn-primary"
              disabled={
                act.busy ||
                (company
                  ? !v("companyId") || v("name").trim().length < 3
                  : v("staffNo").trim().length < 2)
              }
              onClick={() =>
                run(
                  () =>
                    api.screeningAct(
                      "open",
                      company
                        ? {
                            subject,
                            companyId: v("companyId"),
                            name: v("name"),
                            idMasked: v("idMasked"),
                          }
                        : { subject, staffNo: v("staffNo") },
                    ),
                  "Case opened.",
                  ["companyId", "name", "idMasked", "staffNo"],
                )
              }
            >
              Open case
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}
