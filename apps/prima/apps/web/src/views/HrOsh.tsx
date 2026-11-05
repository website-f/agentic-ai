import { useState } from "react";
import { api } from "../api";
import { Chip, ErrorNotice, Loading, dateLabel, useAction, useLoad } from "../ui";

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
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Office safety (OSH)</h2>
          <div className="muted small">
            OSH coordinator for each employer with 5 or more staff, office risk
            assessment each year, and DOSH forms within 7 days. HR files with
            DOSH and records the reference here.
          </div>
        </div>
        <Chip tone={lateCount ? "crit" : d.rows.some((r) => r.needsCoordinator) ? "warn" : "ok"}>
          {lateCount} DOSH form{lateCount === 1 ? "" : "s"} to send
        </Chip>
      </div>
      <div className="list">
        {d.rows.length === 0 && <div className="empty">No employers.</div>}
        {d.rows.map((r) => {
          const staff = d.staff.filter((s) => s.companyId === r.companyId);
          const k = (x: string) => `${r.companyId}:${x}`;
          return (
            <div key={r.companyId} className="list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
              <div>
                <span style={{ fontWeight: 600 }}>{r.companyName}</span> · {r.staff} staff{" "}
                {r.needsCoordinator && <Chip tone="warn">no OSH coordinator</Chip>}
                {r.noAssessment && <Chip tone="warn">no office risk assessment</Chip>}
              </div>
              <div className="muted small">
                Coordinator:{" "}
                {r.coordinator
                  ? `${r.coordinator.name} since ${dateLabel(r.coordinator.appointedOn)}${r.coordinator.trainingRef ? ` (training ${r.coordinator.trainingRef})` : ""}`
                  : "none"}
              </div>
              {r.canAppoint && staff.length > 0 && (
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  <select className="input" aria-label={`OSH coordinator for ${r.companyName}`} value={f(k("coord"))} onChange={(e) => set(k("coord"), e.target.value)}>
                    <option value="">Choose staff</option>
                    {staff.map((s) => (
                      <option key={s.personId} value={s.personId}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <input className="input" style={{ width: 160 }} placeholder="Training ref (optional)" aria-label={`Training reference for ${r.companyName}`} value={f(k("train"))} onChange={(e) => set(k("train"), e.target.value)} />
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
              {r.assessments.map((a) => (
                <div key={a.id} className="muted small">
                  Risk assessment {a.workplace}: {dateLabel(a.assessedOn)}, {a.hazards} hazards, {a.highRisks} high · review by {dateLabel(a.nextReviewOn)}{" "}
                  {a.overdue && <Chip tone="crit">review overdue</Chip>}
                </div>
              ))}
              {r.canKeep && (
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  <input className="input" style={{ width: 150 }} placeholder="Office or floor" aria-label={`Workplace assessed for ${r.companyName}`} value={f(k("wp"))} onChange={(e) => set(k("wp"), e.target.value)} />
                  <input className="input" style={{ width: 90 }} type="number" min={0} placeholder="Hazards" aria-label={`Hazards for ${r.companyName}`} value={f(k("hz"))} onChange={(e) => set(k("hz"), e.target.value)} />
                  <input className="input" style={{ width: 90 }} type="number" min={0} placeholder="High risk" aria-label={`High risks for ${r.companyName}`} value={f(k("hi"))} onChange={(e) => set(k("hi"), e.target.value)} />
                  <input className="input" placeholder="Controls for high risks" aria-label={`Controls for ${r.companyName}`} value={f(k("ctl"))} onChange={(e) => set(k("ctl"), e.target.value)} />
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
              )}
              {r.incidents.map((i) => (
                <div key={i.id} className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  <div className="small" style={{ flex: 1, minWidth: 200 }}>
                    <span style={{ fontWeight: 600 }}>
                      {d.labels[i.incident]} {dateLabel(i.occurredOn)}
                      {i.name ? ` · ${i.name}` : ""}
                    </span>{" "}
                    {i.serious && <Chip tone="crit">serious</Chip>} <span className="muted">{i.description}</span>
                    <div className="muted">
                      {i.reported ? `${i.form} sent ${dateLabel(i.reported.on)}, reference ${i.reported.ref}` : `${i.form} by ${dateLabel(i.reportBy)}`}
                    </div>
                  </div>
                  {!i.reported && r.canKeep && (
                    <>
                      <Chip tone={i.late ? "crit" : "warn"}>{i.late ? "late" : "due"}</Chip>
                      <input className="input" style={{ width: 150 }} placeholder="DOSH reference" aria-label={`DOSH reference for ${d.labels[i.incident]} ${i.occurredOn}`} value={ref[i.id] ?? ""} onChange={(e) => setRef((x) => ({ ...x, [i.id]: e.target.value }))} />
                      <button
                        className="btn btn-sm"
                        disabled={act.busy || (ref[i.id] ?? "").trim().length < 3}
                        onClick={() => void act.run(() => api.recordOshReport(i.id, { reportedOn: today(), ref: ref[i.id] ?? "" }), "Recorded.").then(() => b.reload())}
                      >
                        Sent today
                      </button>
                    </>
                  )}
                </div>
              ))}
              <details>
                <summary className="small">Record an accident or disease</summary>
                <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  <select className="input" aria-label={`What happened at ${r.companyName}`} value={f(k("ik")) || "accident"} onChange={(e) => set(k("ik"), e.target.value)}>
                    {(Object.keys(d.labels) as Kind[]).map((x) => (
                      <option key={x} value={x}>
                        {d.labels[x]}
                      </option>
                    ))}
                  </select>
                  <input className="input" type="date" aria-label={`Date it happened at ${r.companyName}`} value={f(k("on")) || today()} onChange={(e) => set(k("on"), e.target.value)} />
                  {staff.length > 0 && (
                    <select className="input" aria-label={`Staff involved at ${r.companyName}`} value={f(k("who"))} onChange={(e) => set(k("who"), e.target.value)}>
                      <option value="">No one named</option>
                      {staff.map((s) => (
                        <option key={s.personId} value={s.personId}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <label className="small">
                    <input type="checkbox" checked={f(k("ser")) === "1"} onChange={(e) => set(k("ser"), e.target.checked ? "1" : "")} /> Death or serious injury
                  </label>
                  <input className="input" placeholder="What happened and where" aria-label={`Description at ${r.companyName}`} value={f(k("desc"))} onChange={(e) => set(k("desc"), e.target.value)} />
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
              </details>
            </div>
          );
        })}
      </div>
      <ErrorNotice error={act.error} />
    </section>
  );
}
