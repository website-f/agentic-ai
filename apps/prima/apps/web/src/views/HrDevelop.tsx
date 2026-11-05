import { useState } from "react";
import { api } from "../api";
import { Chip, ErrorNotice, Loading, dateLabel, useAction, useLoad } from "../ui";

/**
 * HR Phase 3, slice 3F (Fauzan, 2 Nov 2026): training records, the yearly appraisal and the handbook, code of conduct
 * and IT-use acknowledgements. HR keeps them; staff see their own. Appraisal is not the KPI (on hold).
 */
const today = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

export function TrainingPanel({ mine = false }: { mine?: boolean }) {
  const b = useLoad(() => api.trainingRecords().catch(() => null), []);
  const staff = useLoad(() => api.appraisals().then((a) => a.staff).catch(() => []), []);
  const act = useAction();
  const [f, setF] = useState<Record<string, string>>({});
  const v = (k: string) => f[k] ?? "";
  const set = (k: string, x: string) => setF((o) => ({ ...o, [k]: x }));
  if (!b.data) return b.loading ? <Loading what="training" /> : null;
  const d = b.data;
  if (mine && d.canRecord) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{mine ? "My training" : "Training"}</h2>
          <div className="muted small">
            Courses attended, with the HRD Corp claim reference when the levy
            pays.
          </div>
        </div>
      </div>
      <div className="list">
        {d.rows.length === 0 && <div className="empty">No training recorded.</div>}
        {d.rows.slice(0, 50).map((r) => (
          <div key={r.id} className="list-item">
            <div>
              <div style={{ fontWeight: 600 }}>
                {r.course}
                {mine ? "" : ` · ${r.name}`}
              </div>
              <div className="muted small">
                {r.provider ? `${r.provider} · ` : ""}
                {dateLabel(r.from)}
                {r.to !== r.from ? ` to ${dateLabel(r.to)}` : ""} · {r.hours} h
                {r.hrdRef ? ` · HRD Corp ${r.hrdRef}` : ""}
                {r.certificateRef ? ` · certificate ${r.certificateRef}` : ""}
              </div>
            </div>
          </div>
        ))}
      </div>
      {d.canRecord && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          <select className="input" aria-label="Staff member trained" value={v("p")} onChange={(e) => set("p", e.target.value)}>
            <option value="">Choose staff</option>
            {(staff.data ?? []).map((s) => (
              <option key={s.personId} value={s.personId}>
                {s.name}
              </option>
            ))}
          </select>
          <input className="input" placeholder="Course" aria-label="Course" value={v("c")} onChange={(e) => set("c", e.target.value)} />
          <input className="input" style={{ width: 140 }} placeholder="Provider" aria-label="Provider" value={v("pr")} onChange={(e) => set("pr", e.target.value)} />
          <input className="input" type="date" aria-label="Course start" value={v("from") || today()} onChange={(e) => set("from", e.target.value)} />
          <input className="input" type="date" aria-label="Course end" value={v("to") || v("from") || today()} onChange={(e) => set("to", e.target.value)} />
          <input className="input" style={{ width: 80 }} type="number" min={0} placeholder="Hours" aria-label="Hours" value={v("h")} onChange={(e) => set("h", e.target.value)} />
          <input className="input" style={{ width: 100 }} type="number" min={0} placeholder="Cost RM" aria-label="Cost" value={v("cost")} onChange={(e) => set("cost", e.target.value)} />
          <input className="input" style={{ width: 130 }} placeholder="HRD Corp ref" aria-label="HRD Corp reference" value={v("hrd")} onChange={(e) => set("hrd", e.target.value)} />
          <button
            className="btn btn-sm"
            disabled={act.busy || !v("p") || v("c").trim().length < 3 || !Number(v("h"))}
            onClick={() =>
              void act
                .run(
                  () =>
                    api.recordTraining({
                      personId: v("p"),
                      course: v("c"),
                      provider: v("pr"),
                      from: v("from") || today(),
                      to: v("to") || v("from") || today(),
                      hours: Number(v("h")),
                      cost: v("cost") === "" ? null : Number(v("cost")),
                      hrdRef: v("hrd") || null,
                      certificateRef: null,
                    }),
                  "Training recorded.",
                )
                .then((r) => r && (setF({}), b.reload()))
            }
          >
            Record
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}

export function AppraisalsPanel({ mine = false }: { mine?: boolean }) {
  const b = useLoad(() => api.appraisals().catch(() => null), []);
  const act = useAction();
  const [f, setF] = useState<Record<string, string>>({});
  const v = (k: string) => f[k] ?? "";
  const set = (k: string, x: string) => setF((o) => ({ ...o, [k]: x }));
  if (!b.data) return b.loading ? <Loading what="appraisals" /> : null;
  const d = b.data;
  if (mine && d.canOpen) return null;
  if (mine && !d.rows.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Appraisals</h2>
          <div className="muted small">
            HR opens it and names the appraiser. The appraiser rates 1 to 5, the
            staff member reads it and may comment, then HR closes it.
          </div>
        </div>
      </div>
      <div className="list">
        {d.rows.length === 0 && <div className="empty">No appraisals.</div>}
        {d.rows.map((r) => (
          <div key={r.id} className="list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
            <div>
              <span style={{ fontWeight: 600 }}>
                {r.name} · {r.year}
              </span>{" "}
              · appraiser {r.appraiserName}{" "}
              <Chip tone={r.status === "closed" ? "ok" : "warn"}>
                {r.status === "with_appraiser" ? "with appraiser" : r.status === "with_staff" ? (r.staffAt ? "read by staff" : "with staff") : "closed"}
              </Chip>
            </div>
            {r.rating != null && (
              <div className="small">
                Rating {r.rating} of 5{r.strengths ? ` · Went well: ${r.strengths}` : ""}
                {r.improve ? ` · To improve: ${r.improve}` : ""}
                {r.trainingNeeds ? ` · Training: ${r.trainingNeeds}` : ""}
              </div>
            )}
            {r.staffComment && <div className="small muted">Staff comment: {r.staffComment}</div>}
            {r.canRate && (
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <select className="input" aria-label={`Rating for ${r.name}`} value={v(`${r.id}:rt`)} onChange={(e) => set(`${r.id}:rt`, e.target.value)}>
                  <option value="">Rating</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <input className="input" placeholder="What went well" aria-label={`What went well for ${r.name}`} value={v(`${r.id}:s`)} onChange={(e) => set(`${r.id}:s`, e.target.value)} />
                <input className="input" placeholder="What to improve" aria-label={`What to improve for ${r.name}`} value={v(`${r.id}:i`)} onChange={(e) => set(`${r.id}:i`, e.target.value)} />
                <input className="input" placeholder="Training needs" aria-label={`Training needs for ${r.name}`} value={v(`${r.id}:t`)} onChange={(e) => set(`${r.id}:t`, e.target.value)} />
                <button
                  className="btn btn-sm btn-primary"
                  disabled={act.busy || !v(`${r.id}:rt`)}
                  onClick={() =>
                    void act
                      .run(() => api.rateAppraisal(r.id, { rating: Number(v(`${r.id}:rt`)), strengths: v(`${r.id}:s`), improve: v(`${r.id}:i`), trainingNeeds: v(`${r.id}:t`) }), "Rated.")
                      .then(() => b.reload())
                  }
                >
                  Send to staff
                </button>
              </div>
            )}
            {r.canComment && (
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <input className="input" placeholder="Your comment (optional)" aria-label="Your comment on the appraisal" value={v(`${r.id}:c`)} onChange={(e) => set(`${r.id}:c`, e.target.value)} />
                <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => void act.run(() => api.commentAppraisal(r.id, v(`${r.id}:c`)), "Thank you.").then(() => b.reload())}>
                  I have read it
                </button>
              </div>
            )}
            {r.canClose && (
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <input className="input" placeholder="Comment (needed)" aria-label={`Closing comment for ${r.name}`} value={v(`${r.id}:n`)} onChange={(e) => set(`${r.id}:n`, e.target.value)} />
                <button className="btn btn-sm" disabled={act.busy || !v(`${r.id}:n`).trim()} onClick={() => void act.run(() => api.closeAppraisal(r.id, v(`${r.id}:n`)), "Closed.").then(() => b.reload())}>
                  Close
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {d.canOpen && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          <select className="input" aria-label="Staff member to appraise" value={v("p")} onChange={(e) => set("p", e.target.value)}>
            <option value="">Staff member</option>
            {d.staff.map((s) => (
              <option key={s.personId} value={s.personId}>
                {s.name}
              </option>
            ))}
          </select>
          <select className="input" aria-label="Appraiser" value={v("a")} onChange={(e) => set("a", e.target.value)}>
            <option value="">Appraiser</option>
            {d.appraisers
              .filter((x) => x.personId !== v("p"))
              .map((x) => (
                <option key={x.userId} value={x.userId}>
                  {x.name}
                </option>
              ))}
          </select>
          <input className="input" style={{ width: 80 }} aria-label="Year" value={v("y") || today().slice(0, 4)} onChange={(e) => set("y", e.target.value)} />
          <button
            className="btn btn-sm"
            disabled={act.busy || !v("p") || !v("a")}
            onClick={() =>
              void act
                .run(() => api.openAppraisal({ personId: v("p"), appraiserId: v("a"), year: v("y") || today().slice(0, 4) }), "Appraisal opened.")
                .then((r) => r && (setF({}), b.reload()))
            }
          >
            Open appraisal
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}

const KIND_LABEL = { handbook: "Staff handbook", code_of_conduct: "Code of conduct", it_use: "IT use policy", other: "Other policy" } as const;

export function PoliciesPanel({ mine = false }: { mine?: boolean }) {
  const b = useLoad(() => api.hrPolicies().catch(() => null), []);
  const act = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const v = (k: string) => f[k] ?? "";
  const set = (k: string, x: string) => setF((o) => ({ ...o, [k]: x }));
  if (!b.data) return b.loading ? <Loading what="policies" /> : null;
  const d = b.data;
  if (mine && (d.canPublish || !d.rows.length)) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{mine ? "Policies to read" : "Handbook and policies"}</h2>
          <div className="muted small">
            Every office staff member reads and acknowledges the latest version.
            A new version asks again.
          </div>
        </div>
      </div>
      <div className="list">
        {d.rows.length === 0 && <div className="empty">No policies published yet.</div>}
        {d.rows.map((r) => (
          <div key={r.id} className="list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
            <div>
              <span style={{ fontWeight: 600 }}>{r.title}</span> · {KIND_LABEL[r.kind]} · version {r.version}, {dateLabel(r.publishedOn)}{" "}
              {r.myAck ? <Chip tone="ok">acknowledged</Chip> : r.canAck ? <Chip tone="warn">to read</Chip> : null}
              {r.acked != null && (
                <span className="muted small">
                  {" "}
                  · {r.acked} acknowledged, {r.missing?.length ?? 0} not yet
                </span>
              )}
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-sm" onClick={() => setOpen(open === r.id ? null : r.id)}>
                {open === r.id ? "Hide" : "Read"}
              </button>
              {r.canAck && (
                <button className="btn btn-sm btn-primary" disabled={act.busy || open !== r.id} title={open !== r.id ? "Read it first" : undefined} onClick={() => void act.run(() => api.acknowledgePolicy(r.id), "Acknowledged.").then(() => b.reload())}>
                  I have read and understood it
                </button>
              )}
              {d.canPublish && (
                <button className="btn btn-sm" onClick={() => setF({ id: r.id, kind: r.kind, title: r.title, body: r.body })}>
                  New version
                </button>
              )}
            </div>
            {open === r.id && <div className="small" style={{ whiteSpace: "pre-wrap" }}>{r.body}</div>}
            {open === r.id && r.missing && r.missing.length > 0 && (
              <div className="muted small">Not yet: {r.missing.slice(0, 30).map((m) => m.name).join(", ")}{r.missing.length > 30 ? " and more" : ""}</div>
            )}
          </div>
        ))}
      </div>
      {d.canPublish && (
        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <select className="input" aria-label="Policy kind" value={v("kind") || "handbook"} onChange={(e) => set("kind", e.target.value)}>
              {Object.entries(KIND_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <input className="input" placeholder="Title" aria-label="Policy title" value={v("title")} onChange={(e) => set("title", e.target.value)} />
          </div>
          <textarea className="input" rows={5} placeholder="The text staff read, or where the full document is kept" aria-label="Policy text" value={v("body")} onChange={(e) => set("body", e.target.value)} />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy || v("title").trim().length < 3 || v("body").trim().length < 20}
              onClick={() =>
                void act
                  .run(() => api.publishPolicy({ id: v("id") || null, kind: (v("kind") || "handbook") as keyof typeof KIND_LABEL, title: v("title"), body: v("body") }), v("id") ? "New version published." : "Published.")
                  .then((r) => r && (setF({}), b.reload()))
              }
            >
              {v("id") ? "Publish new version" : "Publish"}
            </button>
            {v("id") && (
              <button className="btn btn-sm" onClick={() => setF({})}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}

/**
 * HR legal points for the directors only (review, 2 Nov 2026; Fauzan confirmed 14:59Z): privacy, retention and face-data
 * points with their sources, the records they touch, a responsible director, a status and history. Nobody else sees
 * this panel, and no staff screen shows a legal notice or block. An open point stays unresolved.
 */
export function HrLegalPanel() {
  const b = useLoad(() => api.hrLegalChecks().catch(() => null), []);
  const act = useAction();
  const [f, setF] = useState<Record<string, { status: string; directorId: string; note: string }>>({});
  if (!b.data) return null;
  const d = b.data;
  const tone = (s: string) => (s === "resolved" ? "ok" : s === "in_review" ? "warn" : "unknown");
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Legal points for the directors</h2>
          <div className="muted small">Only the HR Director and the CEO see this. Sources are a starting point, not legal advice. Nothing here certifies compliance.</div>
        </div>
      </div>
      <div className="list">
        {d.rows.map((r) => {
          const e = f[r.id] ?? { status: r.status, directorId: r.director?.id ?? "", note: "" };
          const upd = (p: Partial<typeof e>) => setF({ ...f, [r.id]: { ...e, ...p } });
          return (
            <div key={r.id} className="list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
              <div>
                <span style={{ fontWeight: 600 }}>{r.title}</span> <Chip tone={tone(r.status)}>{d.statusLabel[r.status]}</Chip>{" "}
                <span className="muted small">
                  {r.area} · {r.affected.count == null ? "records not visible to you" : `${r.affected.count} record${r.affected.count === 1 ? "" : "s"}`}
                  {r.director ? ` · ${r.director.name} responsible` : " · no director named"}
                </span>
              </div>
              <div className="small">{r.issue}</div>
              <div className="muted small">Sources: {r.sources.join("; ")}</div>
              {r.affected.sample.length > 0 && <div className="muted small">Includes: {r.affected.sample.map((x) => x.name).join(", ")}{(r.affected.count ?? 0) > r.affected.sample.length ? " and more" : ""}</div>}
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <select className="input" aria-label="Status" value={e.status} onChange={(x) => upd({ status: x.target.value })}>
                  {Object.entries(d.statusLabel).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
                <select className="input" aria-label="Responsible director" value={e.directorId} onChange={(x) => upd({ directorId: x.target.value })}>
                  <option value="">Responsible director…</option>
                  {d.directors.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
                <input className="input" placeholder="Note or where the evidence is kept" aria-label="Note" value={e.note} onChange={(x) => upd({ note: x.target.value })} />
                <button
                  className="btn btn-sm btn-primary"
                  disabled={act.busy || !e.note.trim()}
                  onClick={() =>
                    void act
                      .run(() => api.updateHrLegalCheck(r.id, { status: e.status as typeof r.status, directorId: e.directorId || null, note: e.note }), "Saved.")
                      .then((ok) => ok && (setF({ ...f, [r.id]: { ...e, note: "" } }), b.reload()))
                  }
                >
                  Save
                </button>
              </div>
              {r.history.length > 0 && (
                <div className="muted small">
                  {r.history.slice(0, 5).map((h, i) => (
                    <div key={i}>
                      {dateLabel(h.at.slice(0, 10))} · {h.by}: {d.statusLabel[h.status]} · {h.note}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <ErrorNotice error={act.error} />
    </section>
  );
}

/**
 * Staff overtime (slice 3D, Fauzan 2 Nov 2026): off until HR turns it on, sets the rates (never below the Employment
 * Act) and ticks the staff who may claim it. Anyone can work out what some hours would pay.
 */
export function OvertimePanel() {
  const b = useLoad(() => api.staffOvertime().catch(() => null), []);
  const act = useAction();
  const [f, setF] = useState<{ enabled: boolean; normal: string; restDay: string; publicHoliday: string; ids: string[]; comment: string } | null>(null);
  const [calc, setCalc] = useState({ personId: "", hours: "", kind: "normal" as "normal" | "restDay" | "publicHoliday" });
  const [out, setOut] = useState<string | null>(null);
  if (!b.data) return b.loading ? <Loading what="overtime" /> : null;
  const d = b.data;
  if (!d.canEdit && !d.staff.length) return null;
  const s = d.setting;
  const edit = f ?? { enabled: s.enabled, normal: String(s.normal), restDay: String(s.restDay), publicHoliday: String(s.publicHoliday), ids: "personIds" in s ? s.personIds : [], comment: "" };
  const upd = (p: Partial<typeof edit>) => setF({ ...edit, ...p });
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Staff overtime</h2>
          <div className="muted small">
            {s.enabled ? <Chip tone="ok">on</Chip> : <Chip tone="neutral">off</Chip>} Rates {s.normal}x normal day, {s.restDay}x rest day, {s.publicHoliday}x public holiday. The Act covers staff earning up to RM{d.rule.value.eaWageCap.toLocaleString()} a month.
          </div>
        </div>
      </div>
      {d.canEdit && (
        <div style={{ display: "grid", gap: 6 }}>
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={edit.enabled} onChange={(e) => upd({ enabled: e.target.checked })} /> Overtime on
          </label>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {(["normal", "restDay", "publicHoliday"] as const).map((k) => (
              <input key={k} className="input" style={{ width: 120 }} inputMode="decimal" aria-label={`${k} rate`} value={edit[k]} onChange={(e) => upd({ [k]: e.target.value })} />
            ))}
          </div>
          <div className="list" style={{ maxHeight: 220, overflow: "auto" }}>
            {d.staff.map((p) => (
              <label key={p.personId} className="list-item small" style={{ gap: 6 }}>
                <input type="checkbox" checked={edit.ids.includes(p.personId)} onChange={(e) => upd({ ids: e.target.checked ? [...edit.ids, p.personId] : edit.ids.filter((x) => x !== p.personId) })} />
                {p.name} {!p.coveredByAct && <span className="muted">(above the Act's wage limit)</span>}
              </label>
            ))}
          </div>
          <input className="input" placeholder="Reason for the change" aria-label="Reason" value={edit.comment} onChange={(e) => upd({ comment: e.target.value })} />
          <div className="row">
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy || !edit.comment.trim()}
              onClick={() =>
                void act
                  .run(() => api.setStaffOvertime({ enabled: edit.enabled, normal: Number(edit.normal), restDay: Number(edit.restDay), publicHoliday: Number(edit.publicHoliday), personIds: edit.ids, comment: edit.comment }), "Overtime saved.")
                  .then((r) => r && (setF(null), b.reload()))
              }
            >
              Save
            </button>
          </div>
        </div>
      )}
      {d.canEdit && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          <select className="input" aria-label="Staff member" value={calc.personId} onChange={(e) => setCalc({ ...calc, personId: e.target.value })}>
            <option value="">Work out pay for…</option>
            {d.staff.map((p) => (
              <option key={p.personId} value={p.personId}>
                {p.name}
              </option>
            ))}
          </select>
          <input className="input" style={{ width: 90 }} inputMode="decimal" placeholder="Hours" aria-label="Hours" value={calc.hours} onChange={(e) => setCalc({ ...calc, hours: e.target.value })} />
          <select className="input" aria-label="Kind of day" value={calc.kind} onChange={(e) => setCalc({ ...calc, kind: e.target.value as typeof calc.kind })}>
            <option value="normal">Normal day</option>
            <option value="restDay">Rest day</option>
            <option value="publicHoliday">Public holiday</option>
          </select>
          <button
            className="btn btn-sm"
            disabled={act.busy || !calc.personId || !(Number(calc.hours) > 0)}
            onClick={() => void act.run(() => api.overtimePreview({ personId: calc.personId, hours: Number(calc.hours), kind: calc.kind })).then((r) => r && setOut(`RM${r.amount.toFixed(2)} (RM${r.hourly.toFixed(2)} an hour x ${r.rate} x ${r.hours} h)${r.eligible ? "" : " · not on the overtime list"}`))}
          >
            Work out
          </button>
          {out && <span className="small">{out}</span>}
        </div>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}

/**
 * Guard training and legal papers (Fauzan, 2 Nov 2026): HR and the guard's company head see and keep the KDN card,
 * eSIMS vetting, CSG and TNG, and add other courses. Firearm papers stay with Arms Control; foreign worker papers
 * with FWM.
 */
export function GuardTrainingPanel() {
  const b = useLoad(() => api.guardTraining().catch(() => null), []);
  const act = useAction();
  const [only, setOnly] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const v = (k: string) => f[k] ?? "";
  const set = (k: string, x: string) => setF((o) => ({ ...o, [k]: x }));
  if (!b.data) return b.loading ? <Loading what="guard training" /> : null;
  const d = b.data;
  const tone = (l: string) => (l === "block" ? "crit" : l === "warn" ? "warn" : "ok");
  const rows = only ? d.rows.filter((r) => r.kdn.level !== "ok" || r.csg.level !== "ok") : d.rows;
  const kind = v("type") || "CSG_TRAINING";
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Guard training and legal papers</h2>
          <div className="muted small">
            KDN guard card, eSIMS vetting, CSG (within the first year) and TNG.
            HR and the company head record them; KDN counts untrained guards at
            licence renewal.
          </div>
        </div>
      </div>
      <div className="list">
        {d.summary.map((s) => (
          <div key={s.companyId} className="list-item">
            <span style={{ fontWeight: 600 }}>{s.companyName}</span>
            <span className="small">
              {s.guards} guards · CSG done {s.csgDone}
              {s.csgDue ? ` · due ${s.csgDue}` : ""}{" "}
              {s.csgOverdue > 0 && <Chip tone="crit">{s.csgOverdue} past CSG deadline</Chip>}{" "}
              {s.kdnBlocked > 0 && <Chip tone="crit">{s.kdnBlocked} no valid KDN card</Chip>}
            </span>
          </div>
        ))}
      </div>
      <label className="small" style={{ display: "block", margin: "8px 0" }}>
        <input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Only guards needing action
      </label>
      <div className="list">
        {rows.length === 0 && <div className="empty">Nothing needs action.</div>}
        {rows.slice(0, 200).map((r) => (
          <div key={r.personId} className="list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
            <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontWeight: 600 }}>
                {r.name} ({r.staffNo})
              </span>
              <Chip tone={tone(r.kdn.level)}>{r.kdn.chip ?? (r.kdn.level === "ok" ? `KDN to ${r.kdn.expiresOn ? dateLabel(r.kdn.expiresOn) : "?"}` : "KDN")}</Chip>
              <Chip tone={tone(r.csg.level)}>{r.csg.chip ?? (r.csg.level === "ok" ? "CSG done" : "CSG")}</Chip>
              {r.tng && <Chip tone="ok">TNG</Chip>}
              <span className="muted small">{r.courses} other course{r.courses === 1 ? "" : "s"}</span>
              {r.canManage && (
                <button className="btn btn-sm" onClick={() => (setOpen(open === r.personId ? null : r.personId), setF({}))}>
                  {open === r.personId ? "Close" : "Record"}
                </button>
              )}
            </div>
            {(r.kdn.message || r.csg.message) && <div className="muted small">{[r.kdn.message, r.csg.message].filter(Boolean).join(" ")}</div>}
            {open === r.personId && (
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <select className="input" aria-label={`Paper for ${r.name}`} value={kind} onChange={(e) => set("type", e.target.value)}>
                  {d.types.map((t) => (
                    <option key={t.type} value={t.type}>
                      {t.label}
                    </option>
                  ))}
                  <option value="COURSE">Other course</option>
                </select>
                {kind === "COURSE" ? (
                  <>
                    <input className="input" placeholder="Course" aria-label="Course" value={v("course")} onChange={(e) => set("course", e.target.value)} />
                    <input className="input" style={{ width: 80 }} type="number" min={0} placeholder="Hours" aria-label="Hours" value={v("hours")} onChange={(e) => set("hours", e.target.value)} />
                  </>
                ) : (
                  <input className="input" style={{ width: 170 }} placeholder="Card, certificate or eSIMS no." aria-label="Number" value={v("number")} onChange={(e) => set("number", e.target.value)} />
                )}
                <input className="input" type="date" aria-label="Issued, done or submitted on" value={v("on") || today()} onChange={(e) => set("on", e.target.value)} />
                {(kind === "KDN_GUARD_CARD" || kind === "TNG_TRAINING") && (
                  <input className="input" type="date" aria-label="Expires on" value={v("exp")} onChange={(e) => set("exp", e.target.value)} />
                )}
                <button
                  className="btn btn-sm btn-primary"
                  disabled={act.busy || (kind === "COURSE" ? v("course").trim().length < 3 || !Number(v("hours")) : v("number").trim().length < 3)}
                  onClick={() =>
                    void act
                      .run(
                        () =>
                          kind === "COURSE"
                            ? api.recordTraining({ personId: r.personId, course: v("course"), provider: "", from: v("on") || today(), to: v("on") || today(), hours: Number(v("hours")), cost: null, hrdRef: null, certificateRef: null })
                            : api.recordGuardPaper({ personId: r.personId, type: kind as "CSG_TRAINING", number: v("number"), issuedOn: v("on") || today(), expiresOn: v("exp") || null }),
                        "Recorded.",
                      )
                      .then((x) => x && (setOpen(null), setF({}), b.reload()))
                  }
                >
                  Save
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {d.total > 500 && <div className="muted small">Showing the first 500 of {d.total}.</div>}
      <ErrorNotice error={act.error} />
    </section>
  );
}
