import { useState } from "react";
import { api } from "../api";
import { Card, Empty } from "../kit";
import { Chip, ErrorNotice, Loading, dateLabel, useAction, useLoad } from "../ui";
import "../styles/hrx.css";

/**
 * HR Phase 3, office OSH (Fauzan, 2 Nov 2026): each employer's OSH coordinator (OSHA s.29A), office risk
 * assessments (HIRARC, s.18B) and accidents to report to DOSH (NADOPOD: JKKP 6 or 7 within 7 days). HR files with
 * DOSH and records the reference; Prima never files. A company manager sees their own employer; a named coordinator
 * keeps their own employer's records.
 */
const today = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

type Kind = "accident" | "dangerous_occurrence" | "poisoning" | "disease";

/** coordinatorOnly: on the staff clock screen, shown only to a named coordinator who is not in HR. */
export function OfficeOshPanel({ coordinatorOnly = false }: { coordinatorOnly?: boolean }) {
  const b = useLoad(() => api.officeOsh().catch(() => null), []);
  const act = useAction();
  const [form, setForm] = useState<Record<string, string>>({});
  const [ref, setRef] = useState<Record<string, string>>({});
  const f = (k: string) => form[k] ?? "";
  const set = (k: string, v: string) => setForm((x) => ({ ...x, [k]: v }));
  if (b.error) return <ErrorNotice error={b.error} />;
  if (!b.data) return b.loading ? <Loading what="office safety" /> : null;
  const d = coordinatorOnly && b.data.rows.some((r) => r.canAppoint) ? null : coordinatorOnly ? { ...b.data, rows: b.data.rows.filter((r) => r.canKeep) } : b.data;
  if (!d || (coordinatorOnly && !d.rows.length)) return null;
  const lateCount = d.rows.reduce((n, r) => n + r.incidents.filter((i) => !i.reported).length, 0);
  return (
    <Card
      flush
      title="Office safety (OSH)"
      sub="OSH coordinator for each employer with 5 or more staff, office risk assessment each year, and DOSH forms within 7 days. HR files with DOSH and records the reference here."
      actions={
        <Chip tone={lateCount ? "crit" : d.rows.some((r) => r.needsCoordinator) ? "warn" : "ok"}>
          {lateCount} DOSH form{lateCount === 1 ? "" : "s"} to send
        </Chip>
      }
    >
      {d.rows.length === 0 && <Empty title="No employers." />}
      {d.rows.length > 0 && (
        <ul className="hx-rows">
          {d.rows.map((r) => {
            const staff = d.staff.filter((s) => s.companyId === r.companyId);
            const k = (x: string) => `${r.companyId}:${x}`;
            const late = r.incidents.some((i) => !i.reported && i.late);
            return (
              <li key={r.companyId} className="hx-row" data-tone={late ? "crit" : r.needsCoordinator || r.noAssessment ? "warn" : undefined}>
                <div className="hx-row-main">
                  <span className="hx-row-title">{r.companyName}</span>
                  <span className="hx-row-meta">
                    {r.staff} staff · Coordinator:{" "}
                    {r.coordinator
                      ? `${r.coordinator.name} since ${dateLabel(r.coordinator.appointedOn)}${r.coordinator.trainingRef ? ` (training ${r.coordinator.trainingRef})` : ""}`
                      : "none"}
                  </span>
                </div>
                <div className="hx-row-side">
                  {r.needsCoordinator && <Chip tone="warn">no OSH coordinator</Chip>}
                  {r.noAssessment && <Chip tone="warn">no office risk assessment</Chip>}
                </div>
                <div className="hx-row-body">
                  {r.canAppoint && staff.length > 0 && (
                    <div className="hp-inline">
                      <select className="select" aria-label={`OSH coordinator for ${r.companyName}`} value={f(k("coord"))} onChange={(e) => set(k("coord"), e.target.value)}>
                        <option value="">Choose staff</option>
                        {staff.map((s) => (
                          <option key={s.personId} value={s.personId}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      <input className="input" placeholder="Training ref (optional)" aria-label={`Training reference for ${r.companyName}`} value={f(k("train"))} onChange={(e) => set(k("train"), e.target.value)} />
                      <button
                        className="btn btn-sm"
                        disabled={act.busy || !f(k("coord"))}
                        onClick={() =>
                          void act
                            .run(() => api.appointOshCoordinator({ companyId: r.companyId, personId: f(k("coord")), appointedOn: today(), trainingRef: f(k("train")) || null, note: "" }), "Coordinator named.")
                            .then(() => b.reload())
                        }
                      >
                        Name coordinator
                      </button>
                    </div>
                  )}

                  {(r.assessments.length > 0 || r.canKeep) && (
                    <div className="hp-block">
                      <h3 className="hp-block-title">Office risk assessments</h3>
                      {r.assessments.length > 0 && (
                        <ul className="hp-items">
                          {r.assessments.map((a) => (
                            <li key={a.id}>
                              <span className="hp-item-text">
                                <b>{a.workplace}</b>
                                <span className="hx-row-meta">
                                  Assessed {dateLabel(a.assessedOn)}, {a.hazards} hazards, {a.highRisks} high · review by {dateLabel(a.nextReviewOn)}
                                </span>
                              </span>
                              {a.overdue && <Chip tone="crit">review overdue</Chip>}
                            </li>
                          ))}
                        </ul>
                      )}
                      {r.canKeep && (
                        <div className="hx-form">
                          <div className="hx-form-grid">
                            <label className="field">
                              <span className="label">Office or floor</span>
                              <input className="input" placeholder="Office or floor" aria-label={`Workplace assessed for ${r.companyName}`} value={f(k("wp"))} onChange={(e) => set(k("wp"), e.target.value)} />
                            </label>
                            <label className="field">
                              <span className="label">Hazards</span>
                              <input className="input" type="number" min={0} placeholder="Hazards" aria-label={`Hazards for ${r.companyName}`} value={f(k("hz"))} onChange={(e) => set(k("hz"), e.target.value)} />
                            </label>
                            <label className="field">
                              <span className="label">High risk</span>
                              <input className="input" type="number" min={0} placeholder="High risk" aria-label={`High risks for ${r.companyName}`} value={f(k("hi"))} onChange={(e) => set(k("hi"), e.target.value)} />
                            </label>
                            <label className="field">
                              <span className="label">Controls for high risks</span>
                              <input className="input" placeholder="Controls for high risks" aria-label={`Controls for ${r.companyName}`} value={f(k("ctl"))} onChange={(e) => set(k("ctl"), e.target.value)} />
                            </label>
                          </div>
                          <div className="hx-form-actions">
                            <button
                              className="btn btn-sm"
                              disabled={act.busy || f(k("wp")).trim().length < 2 || f(k("hz")) === ""}
                              onClick={() =>
                                void act
                                  .run(
                                    () =>
                                      api.recordOfficeAssessment({
                                        companyId: r.companyId,
                                        workplace: f(k("wp")),
                                        assessedOn: today(),
                                        hazards: Number(f(k("hz"))),
                                        highRisks: Number(f(k("hi")) || 0),
                                        controls: f(k("ctl")),
                                      }),
                                    "Assessment recorded.",
                                  )
                                  .then(() => b.reload())
                              }
                            >
                              Assessed today
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {r.incidents.length > 0 && (
                    <div className="hp-block">
                      <h3 className="hp-block-title">Accidents and DOSH forms</h3>
                      <ul className="hp-items">
                        {r.incidents.map((i) => (
                          <li key={i.id} data-tone={!i.reported ? (i.late ? "crit" : "warn") : undefined}>
                            <span className="hp-item-text">
                              <b>
                                {d.labels[i.incident]} {dateLabel(i.occurredOn)}
                                {i.name ? ` · ${i.name}` : ""}
                              </b>
                              <span className="hx-row-text">{i.description}</span>
                              <span className="hx-row-meta">
                                {i.reported ? `${i.form} sent ${dateLabel(i.reported.on)}, reference ${i.reported.ref}` : `${i.form} by ${dateLabel(i.reportBy)}`}
                              </span>
                            </span>
                            <span className="hp-item-side">
                              {i.serious && <Chip tone="crit">serious</Chip>}
                              {!i.reported && r.canKeep && <Chip tone={i.late ? "crit" : "warn"}>{i.late ? "late" : "due"}</Chip>}
                            </span>
                            {!i.reported && r.canKeep && (
                              <span className="hp-inline hp-item-act">
                                <input className="input" placeholder="DOSH reference" aria-label={`DOSH reference for ${d.labels[i.incident]} ${i.occurredOn}`} value={ref[i.id] ?? ""} onChange={(e) => setRef((x) => ({ ...x, [i.id]: e.target.value }))} />
                                <button
                                  className="btn btn-sm"
                                  disabled={act.busy || (ref[i.id] ?? "").trim().length < 3}
                                  onClick={() => void act.run(() => api.recordOshReport(i.id, { reportedOn: today(), ref: ref[i.id] ?? "" }), "Recorded.").then(() => b.reload())}
                                >
                                  Sent today
                                </button>
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <details className="hp-details">
                    <summary>Record an accident or disease</summary>
                    <div className="hx-form">
                      <div className="hx-form-grid">
                        <label className="field">
                          <span className="label">What happened</span>
                          <select className="select" aria-label={`What happened at ${r.companyName}`} value={f(k("ik")) || "accident"} onChange={(e) => set(k("ik"), e.target.value)}>
                            {(Object.keys(d.labels) as Kind[]).map((x) => (
                              <option key={x} value={x}>
                                {d.labels[x]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span className="label">Date</span>
                          <input className="input" type="date" aria-label={`Date it happened at ${r.companyName}`} value={f(k("on")) || today()} onChange={(e) => set(k("on"), e.target.value)} />
                        </label>
                        {staff.length > 0 && (
                          <label className="field">
                            <span className="label">Staff involved</span>
                            <select className="select" aria-label={`Staff involved at ${r.companyName}`} value={f(k("who"))} onChange={(e) => set(k("who"), e.target.value)}>
                              <option value="">No one named</option>
                              {staff.map((s) => (
                                <option key={s.personId} value={s.personId}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        <label className="field hx-form-wide">
                          <span className="label">What happened and where</span>
                          <input className="input" placeholder="What happened and where" aria-label={`Description at ${r.companyName}`} value={f(k("desc"))} onChange={(e) => set(k("desc"), e.target.value)} />
                        </label>
                      </div>
                      <label className="hp-check">
                        <input type="checkbox" checked={f(k("ser")) === "1"} onChange={(e) => set(k("ser"), e.target.checked ? "1" : "")} /> Death or serious injury
                      </label>
                      <div className="hx-form-actions">
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={act.busy || f(k("desc")).trim().length < 10}
                          onClick={() =>
                            void act
                              .run(
                                () =>
                                  api.reportOshIncident({
                                    companyId: r.companyId,
                                    incident: (f(k("ik")) || "accident") as Kind,
                                    occurredOn: f(k("on")) || today(),
                                    personId: f(k("who")) || null,
                                    serious: f(k("ser")) === "1",
                                    description: f(k("desc")),
                                  }),
                                "Recorded. Send the DOSH form by the date shown.",
                              )
                              .then(() => b.reload())
                          }
                        >
                          Record
                        </button>
                      </div>
                    </div>
                  </details>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {act.error && (
        <div className="hp-section">
          <ErrorNotice error={act.error} />
        </div>
      )}
    </Card>
  );
}
