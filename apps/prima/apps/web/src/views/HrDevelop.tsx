import { useState } from "react";
import { api } from "../api";
import { Card, Empty, Person } from "../kit";
import { Chip, ErrorNotice, Loading, dateLabel, useAction, useLoad } from "../ui";
import "../styles/hrx.css";

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
    <Card
      flush
      title={mine ? "My training" : "Training"}
      sub="Courses attended, with the HRD Corp claim reference when the levy pays."
      actions={d.rows.length > 0 ? <span className="hx-count">{d.rows.length > 50 ? `50 of ${d.rows.length}` : d.rows.length} record{d.rows.length === 1 ? "" : "s"}</span> : undefined}
    >
      {d.rows.length === 0 && <Empty title="No training recorded." />}
      {d.rows.length > 0 && (
        <ul className="hx-rows">
          {d.rows.slice(0, 50).map((r) => (
            <li key={r.id} className="hx-row">
              <div className="hx-row-main">
                <span className="hx-row-title">{r.course}</span>
                <span className="hx-row-meta">
                  {mine ? "" : `${r.name} · `}
                  {r.provider ? `${r.provider} · ` : ""}
                  {dateLabel(r.from)}
                  {r.to !== r.from ? ` to ${dateLabel(r.to)}` : ""}
                </span>
              </div>
              <div className="hx-row-side">
                <Chip tone="neutral">{r.hours} h</Chip>
              </div>
              {(r.hrdRef || r.certificateRef) && (
                <div className="hx-row-body">
                  <p className="hx-meta-list">
                    {r.hrdRef && (
                      <span>
                        HRD Corp <b>{r.hrdRef}</b>
                      </span>
                    )}
                    {r.certificateRef && (
                      <span>
                        Certificate <b>{r.certificateRef}</b>
                      </span>
                    )}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {d.canRecord && (
        <div className="hp-section">
          <div className="hx-form">
            <h3 className="hx-form-title">Record training</h3>
            <div className="hx-form-grid">
              <label className="field">
                <span className="label">Staff member</span>
                <select className="select" aria-label="Staff member trained" value={v("p")} onChange={(e) => set("p", e.target.value)}>
                  <option value="">Choose staff</option>
                  {(staff.data ?? []).map((s) => (
                    <option key={s.personId} value={s.personId}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="label">Course</span>
                <input className="input" placeholder="Course" aria-label="Course" value={v("c")} onChange={(e) => set("c", e.target.value)} />
              </label>
              <label className="field">
                <span className="label">Provider</span>
                <input className="input" placeholder="Provider" aria-label="Provider" value={v("pr")} onChange={(e) => set("pr", e.target.value)} />
              </label>
              <label className="field">
                <span className="label">Course start</span>
                <input className="input" type="date" aria-label="Course start" value={v("from") || today()} onChange={(e) => set("from", e.target.value)} />
              </label>
              <label className="field">
                <span className="label">Course end</span>
                <input className="input" type="date" aria-label="Course end" value={v("to") || v("from") || today()} onChange={(e) => set("to", e.target.value)} />
              </label>
              <label className="field">
                <span className="label">Hours</span>
                <input className="input" type="number" min={0} placeholder="Hours" aria-label="Hours" value={v("h")} onChange={(e) => set("h", e.target.value)} />
              </label>
              <label className="field">
                <span className="label">Cost, RM</span>
                <input className="input" type="number" min={0} placeholder="Cost RM" aria-label="Cost" value={v("cost")} onChange={(e) => set("cost", e.target.value)} />
              </label>
              <label className="field">
                <span className="label">HRD Corp reference</span>
                <input className="input" placeholder="HRD Corp ref" aria-label="HRD Corp reference" value={v("hrd")} onChange={(e) => set("hrd", e.target.value)} />
              </label>
            </div>
            <ErrorNotice error={act.error} />
            <div className="hx-form-actions">
              <button
                className="btn btn-primary btn-sm"
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
          </div>
        </div>
      )}
      {!d.canRecord && act.error && (
        <div className="hp-section">
          <ErrorNotice error={act.error} />
        </div>
      )}
    </Card>
  );
}

const APPRAISAL_LABEL = (r: { status: string; staffAt?: string | null }) =>
  r.status === "with_appraiser" ? "with appraiser" : r.status === "with_staff" ? (r.staffAt ? "read by staff" : "with staff") : "closed";

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
    <Card
      flush
      title="Appraisals"
      sub="HR opens it and names the appraiser. The appraiser rates 1 to 5, the staff member reads it and may comment, then HR closes it."
    >
      {d.rows.length === 0 && <Empty title="No appraisals." />}
      {d.rows.length > 0 && (
        <ul className="hx-rows">
          {d.rows.map((r) => (
            <li key={r.id} className="hx-row">
              <div className="hx-row-main">
                <span className="hx-row-title">
                  {r.name} · {r.year}
                </span>
                <span className="hx-row-meta">Appraiser {r.appraiserName}</span>
              </div>
              <div className="hx-row-side">
                {r.rating != null && <Chip tone="info">Rating {r.rating} of 5</Chip>}
                <Chip tone={r.status === "closed" ? "ok" : "warn"}>{APPRAISAL_LABEL(r)}</Chip>
              </div>
              {(r.rating != null || r.staffComment || r.canRate || r.canComment || r.canClose) && (
                <div className="hx-row-body">
                  {r.rating != null && (r.strengths || r.improve || r.trainingNeeds) && (
                    <dl className="hp-notes">
                      {r.strengths && (
                        <div>
                          <dt>Went well</dt>
                          <dd>{r.strengths}</dd>
                        </div>
                      )}
                      {r.improve && (
                        <div>
                          <dt>To improve</dt>
                          <dd>{r.improve}</dd>
                        </div>
                      )}
                      {r.trainingNeeds && (
                        <div>
                          <dt>Training</dt>
                          <dd>{r.trainingNeeds}</dd>
                        </div>
                      )}
                    </dl>
                  )}
                  {r.staffComment && <p className="hx-row-meta">Staff comment: {r.staffComment}</p>}
                  {r.canRate && (
                    <div className="hx-form">
                      <div className="hx-form-grid">
                        <label className="field">
                          <span className="label">Rating</span>
                          <select className="select" aria-label={`Rating for ${r.name}`} value={v(`${r.id}:rt`)} onChange={(e) => set(`${r.id}:rt`, e.target.value)}>
                            <option value="">Rating</option>
                            {[1, 2, 3, 4, 5].map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span className="label">What went well</span>
                          <input className="input" placeholder="What went well" aria-label={`What went well for ${r.name}`} value={v(`${r.id}:s`)} onChange={(e) => set(`${r.id}:s`, e.target.value)} />
                        </label>
                        <label className="field">
                          <span className="label">What to improve</span>
                          <input className="input" placeholder="What to improve" aria-label={`What to improve for ${r.name}`} value={v(`${r.id}:i`)} onChange={(e) => set(`${r.id}:i`, e.target.value)} />
                        </label>
                        <label className="field">
                          <span className="label">Training needs</span>
                          <input className="input" placeholder="Training needs" aria-label={`Training needs for ${r.name}`} value={v(`${r.id}:t`)} onChange={(e) => set(`${r.id}:t`, e.target.value)} />
                        </label>
                      </div>
                      <div className="hx-form-actions">
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
                    </div>
                  )}
                  {r.canComment && (
                    <div className="hp-inline">
                      <input className="input" placeholder="Your comment (optional)" aria-label="Your comment on the appraisal" value={v(`${r.id}:c`)} onChange={(e) => set(`${r.id}:c`, e.target.value)} />
                      <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => void act.run(() => api.commentAppraisal(r.id, v(`${r.id}:c`)), "Thank you.").then(() => b.reload())}>
                        I have read it
                      </button>
                    </div>
                  )}
                  {r.canClose && (
                    <div className="hp-inline">
                      <input className="input" placeholder="Comment (needed)" aria-label={`Closing comment for ${r.name}`} value={v(`${r.id}:n`)} onChange={(e) => set(`${r.id}:n`, e.target.value)} />
                      <button className="btn btn-sm" disabled={act.busy || !v(`${r.id}:n`).trim()} onClick={() => void act.run(() => api.closeAppraisal(r.id, v(`${r.id}:n`)), "Closed.").then(() => b.reload())}>
                        Close
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {(d.canOpen || act.error) && (
        <div className="hp-section">
          {d.canOpen && (
            <div className="hx-form">
              <h3 className="hx-form-title">Open an appraisal</h3>
              <div className="hx-form-grid">
                <label className="field">
                  <span className="label">Staff member</span>
                  <select className="select" aria-label="Staff member to appraise" value={v("p")} onChange={(e) => set("p", e.target.value)}>
                    <option value="">Staff member</option>
                    {d.staff.map((s) => (
                      <option key={s.personId} value={s.personId}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="label">Appraiser</span>
                  <select className="select" aria-label="Appraiser" value={v("a")} onChange={(e) => set("a", e.target.value)}>
                    <option value="">Appraiser</option>
                    {d.appraisers
                      .filter((x) => x.personId !== v("p"))
                      .map((x) => (
                        <option key={x.userId} value={x.userId}>
                          {x.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  <span className="label">Year</span>
                  <input className="input" aria-label="Year" value={v("y") || today().slice(0, 4)} onChange={(e) => set("y", e.target.value)} />
                </label>
              </div>
              <div className="hx-form-actions">
                <button
                  className="btn btn-primary btn-sm"
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
            </div>
          )}
          <ErrorNotice error={act.error} />
        </div>
      )}
    </Card>
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
    <Card
      flush
      title={mine ? "Policies to read" : "Handbook and policies"}
      sub="Every office staff member reads and acknowledges the latest version. A new version asks again."
    >
      {d.rows.length === 0 && <Empty title="No policies published yet." />}
      {d.rows.length > 0 && (
        <ul className="hx-rows">
          {d.rows.map((r) => (
            <li key={r.id} className="hx-row">
              <div className="hx-row-main">
                <span className="hx-row-title">{r.title}</span>
                <span className="hx-row-meta">
                  {KIND_LABEL[r.kind]} · version {r.version}, {dateLabel(r.publishedOn)}
                  {r.acked != null && ` · ${r.acked} acknowledged, ${r.missing?.length ?? 0} not yet`}
                </span>
              </div>
              <div className="hx-row-side">{r.myAck ? <Chip tone="ok">acknowledged</Chip> : r.canAck ? <Chip tone="warn">to read</Chip> : null}</div>
              <div className="hx-row-body">
                <div className="hx-row-actions">
                  <button className="btn btn-sm" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                    {open === r.id ? "Hide" : "Read"}
                  </button>
                  {r.canAck && (
                    <button className="btn btn-sm btn-primary" disabled={act.busy || open !== r.id} title={open !== r.id ? "Read it first" : undefined} onClick={() => void act.run(() => api.acknowledgePolicy(r.id), "Acknowledged.").then(() => b.reload())}>
                      I have read and understood it
                    </button>
                  )}
                  {d.canPublish && (
                    <button className="btn btn-sm btn-ghost" onClick={() => setF({ id: r.id, kind: r.kind, title: r.title, body: r.body })}>
                      New version
                    </button>
                  )}
                </div>
                {open === r.id && <div className="hp-doc">{r.body}</div>}
                {open === r.id && r.missing && r.missing.length > 0 && (
                  <p className="hx-row-meta">
                    Not yet: {r.missing.slice(0, 30).map((m) => m.name).join(", ")}
                    {r.missing.length > 30 ? " and more" : ""}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {(d.canPublish || act.error) && (
        <div className="hp-section">
          {d.canPublish && (
            <div className="hx-form">
              <h3 className="hx-form-title">{v("id") ? "New version" : "Publish a policy"}</h3>
              <div className="hx-form-grid">
                <label className="field">
                  <span className="label">Kind</span>
                  <select className="select" aria-label="Policy kind" value={v("kind") || "handbook"} onChange={(e) => set("kind", e.target.value)}>
                    {Object.entries(KIND_LABEL).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="label">Title</span>
                  <input className="input" placeholder="Title" aria-label="Policy title" value={v("title")} onChange={(e) => set("title", e.target.value)} />
                </label>
                <label className="field hx-form-wide">
                  <span className="label">Policy text</span>
                  <textarea className="textarea" rows={5} placeholder="The text staff read, or where the full document is kept" aria-label="Policy text" value={v("body")} onChange={(e) => set("body", e.target.value)} />
                </label>
              </div>
              <div className="hx-form-actions">
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
                  <button className="btn btn-sm btn-ghost" onClick={() => setF({})}>
                    Cancel
                  </button>
                )}
              </div>
            </div>
          )}
          <ErrorNotice error={act.error} />
        </div>
      )}
    </Card>
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
    <Card
      flush
      title="Legal points for the directors"
      sub="Only the HR Director and the CEO see this. Sources are a starting point, not legal advice. Nothing here certifies compliance."
    >
      <ul className="hx-rows">
        {d.rows.map((r) => {
          const e = f[r.id] ?? { status: r.status, directorId: r.director?.id ?? "", note: "" };
          const upd = (p: Partial<typeof e>) => setF({ ...f, [r.id]: { ...e, ...p } });
          return (
            <li key={r.id} className="hx-row" data-tone={r.status === "resolved" ? undefined : r.status === "in_review" ? "warn" : "unknown"}>
              <div className="hx-row-main">
                <span className="hx-row-title">{r.title}</span>
                <span className="hx-row-meta">
                  {r.area} · {r.affected.count == null ? "records not visible to you" : `${r.affected.count} record${r.affected.count === 1 ? "" : "s"}`}
                  {r.director ? ` · ${r.director.name} responsible` : " · no director named"}
                </span>
              </div>
              <div className="hx-row-side">
                <Chip tone={tone(r.status)}>{d.statusLabel[r.status]}</Chip>
              </div>
              <div className="hx-row-body">
                <p className="hx-row-text">{r.issue}</p>
                <p className="hx-row-meta">Sources: {r.sources.join("; ")}</p>
                {r.affected.sample.length > 0 && (
                  <p className="hx-row-meta">
                    Includes: {r.affected.sample.map((x) => x.name).join(", ")}
                    {(r.affected.count ?? 0) > r.affected.sample.length ? " and more" : ""}
                  </p>
                )}
                <div className="hx-form">
                  <div className="hx-form-grid hp-grid-legal">
                    <label className="field">
                      <span className="label">Status</span>
                      <select className="select" aria-label="Status" value={e.status} onChange={(x) => upd({ status: x.target.value })}>
                        {Object.entries(d.statusLabel).map(([k, l]) => (
                          <option key={k} value={k}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span className="label">Responsible director</span>
                      <select className="select" aria-label="Responsible director" value={e.directorId} onChange={(x) => upd({ directorId: x.target.value })}>
                        <option value="">Responsible director…</option>
                        {d.directors.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span className="label">Note</span>
                      <input className="input" placeholder="Note or where the evidence is kept" aria-label="Note" value={e.note} onChange={(x) => upd({ note: x.target.value })} />
                    </label>
                  </div>
                  <div className="hx-form-actions">
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
                </div>
                {r.history.length > 0 && (
                  <ol className="hp-history">
                    {r.history.slice(0, 5).map((h, i) => (
                      <li key={i}>
                        {dateLabel(h.at.slice(0, 10))} · {h.by}: {d.statusLabel[h.status]} · {h.note}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {act.error && (
        <div className="hp-section">
          <ErrorNotice error={act.error} />
        </div>
      )}
    </Card>
  );
}

const RATE_LABEL = { normal: "Normal day rate", restDay: "Rest day rate", publicHoliday: "Public holiday rate" } as const;

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
    <Card
      flush
      title="Staff overtime"
      sub={`Rates ${s.normal}x normal day, ${s.restDay}x rest day, ${s.publicHoliday}x public holiday. The Act covers staff earning up to RM${d.rule.value.eaWageCap.toLocaleString()} a month.`}
      actions={s.enabled ? <Chip tone="ok">on</Chip> : <Chip tone="neutral">off</Chip>}
    >
      {d.canEdit && (
        <div className="hp-section">
          <div className="hx-form">
            <label className="hp-check">
              <input type="checkbox" checked={edit.enabled} onChange={(e) => upd({ enabled: e.target.checked })} /> Overtime on
            </label>
            <div className="hx-form-grid">
              {(["normal", "restDay", "publicHoliday"] as const).map((k) => (
                <label key={k} className="field">
                  <span className="label">{RATE_LABEL[k]}</span>
                  <input className="input" inputMode="decimal" aria-label={`${k} rate`} value={edit[k]} onChange={(e) => upd({ [k]: e.target.value })} />
                </label>
              ))}
            </div>
            <fieldset className="hp-fieldset">
              <legend className="label">Staff who may claim overtime</legend>
              <div className="hp-pick">
                {d.staff.map((p) => (
                  <label key={p.personId} className="hp-check">
                    <input type="checkbox" checked={edit.ids.includes(p.personId)} onChange={(e) => upd({ ids: e.target.checked ? [...edit.ids, p.personId] : edit.ids.filter((x) => x !== p.personId) })} />
                    <span>
                      {p.name} {!p.coveredByAct && <span className="muted">(above the Act's wage limit)</span>}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="field">
              <span className="label">Reason for the change</span>
              <input className="input" placeholder="Reason for the change" aria-label="Reason" value={edit.comment} onChange={(e) => upd({ comment: e.target.value })} />
            </label>
            <div className="hx-form-actions">
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
        </div>
      )}
      {d.canEdit && (
        <div className="hp-section">
          <div className="hx-form">
            <h3 className="hx-form-title">Work out overtime pay</h3>
            <div className="hx-form-grid">
              <label className="field">
                <span className="label">Staff member</span>
                <select className="select" aria-label="Staff member" value={calc.personId} onChange={(e) => setCalc({ ...calc, personId: e.target.value })}>
                  <option value="">Work out pay for…</option>
                  {d.staff.map((p) => (
                    <option key={p.personId} value={p.personId}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="label">Hours</span>
                <input className="input" inputMode="decimal" placeholder="Hours" aria-label="Hours" value={calc.hours} onChange={(e) => setCalc({ ...calc, hours: e.target.value })} />
              </label>
              <label className="field">
                <span className="label">Kind of day</span>
                <select className="select" aria-label="Kind of day" value={calc.kind} onChange={(e) => setCalc({ ...calc, kind: e.target.value as typeof calc.kind })}>
                  <option value="normal">Normal day</option>
                  <option value="restDay">Rest day</option>
                  <option value="publicHoliday">Public holiday</option>
                </select>
              </label>
            </div>
            <div className="hx-form-actions">
              <button
                className="btn btn-sm"
                disabled={act.busy || !calc.personId || !(Number(calc.hours) > 0)}
                onClick={() => void act.run(() => api.overtimePreview({ personId: calc.personId, hours: Number(calc.hours), kind: calc.kind })).then((r) => r && setOut(`RM${r.amount.toFixed(2)} (RM${r.hourly.toFixed(2)} an hour x ${r.rate} x ${r.hours} h)${r.eligible ? "" : " · not on the overtime list"}`))}
              >
                Work out
              </button>
              {out && (
                <output className="hp-result" aria-live="polite">
                  {out}
                </output>
              )}
            </div>
          </div>
        </div>
      )}
      {act.error && (
        <div className="hp-section">
          <ErrorNotice error={act.error} />
        </div>
      )}
    </Card>
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
    <Card
      flush
      title="Guard training and legal papers"
      sub="KDN guard card, eSIMS vetting, CSG (within the first year) and TNG. HR and the company head record them; KDN counts untrained guards at licence renewal."
      actions={
        <label className="hp-check hp-switch">
          <input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Only guards needing action
        </label>
      }
    >
      {d.summary.length > 0 && (
        <div className="hp-tiles" role="list" aria-label="Guard papers by company">
          {d.summary.map((s) => (
            <div key={s.companyId} className="hp-tile" role="listitem">
              <span className="hp-tile-name">{s.companyName}</span>
              <span className="hx-row-meta">
                {s.guards} guards · CSG done {s.csgDone}
                {s.csgDue ? ` · due ${s.csgDue}` : ""}
              </span>
              {(s.csgOverdue > 0 || s.kdnBlocked > 0) && (
                <span className="hp-tile-chips">
                  {s.csgOverdue > 0 && <Chip tone="crit">{s.csgOverdue} past CSG deadline</Chip>}
                  {s.kdnBlocked > 0 && <Chip tone="crit">{s.kdnBlocked} no valid KDN card</Chip>}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {rows.length === 0 && <Empty title="Nothing needs action." />}
      {rows.length > 0 && (
        <ul className="hx-rows hp-guards">
          {rows.slice(0, 200).map((r) => (
            <li key={r.personId} className="hx-row" data-tone={r.kdn.level === "block" || r.csg.level === "block" ? "crit" : r.kdn.level === "warn" || r.csg.level === "warn" ? "warn" : undefined}>
              <div className="hx-row-main">
                <Person name={r.name} sub={`${r.staffNo} · ${r.courses} other course${r.courses === 1 ? "" : "s"}`} size={34} />
              </div>
              <div className="hx-row-side">
                <Chip tone={tone(r.kdn.level)}>{r.kdn.chip ?? (r.kdn.level === "ok" ? `KDN to ${r.kdn.expiresOn ? dateLabel(r.kdn.expiresOn) : "?"}` : "KDN")}</Chip>
                <Chip tone={tone(r.csg.level)}>{r.csg.chip ?? (r.csg.level === "ok" ? "CSG done" : "CSG")}</Chip>
                {r.tng && <Chip tone="ok">TNG</Chip>}
                {r.canManage && (
                  <button className="btn btn-sm" aria-expanded={open === r.personId} onClick={() => (setOpen(open === r.personId ? null : r.personId), setF({}))}>
                    {open === r.personId ? "Close" : "Record"}
                  </button>
                )}
              </div>
              {((r.kdn.message || r.csg.message) || open === r.personId) && (
                <div className="hx-row-body">
                  {(r.kdn.message || r.csg.message) && <p className="hx-row-meta">{[r.kdn.message, r.csg.message].filter(Boolean).join(" ")}</p>}
                  {open === r.personId && (
                    <div className="hx-form">
                      <div className="hx-form-grid">
                        <label className="field">
                          <span className="label">Paper</span>
                          <select className="select" aria-label={`Paper for ${r.name}`} value={kind} onChange={(e) => set("type", e.target.value)}>
                            {d.types.map((t) => (
                              <option key={t.type} value={t.type}>
                                {t.label}
                              </option>
                            ))}
                            <option value="COURSE">Other course</option>
                          </select>
                        </label>
                        {kind === "COURSE" ? (
                          <>
                            <label className="field">
                              <span className="label">Course</span>
                              <input className="input" placeholder="Course" aria-label="Course" value={v("course")} onChange={(e) => set("course", e.target.value)} />
                            </label>
                            <label className="field">
                              <span className="label">Hours</span>
                              <input className="input" type="number" min={0} placeholder="Hours" aria-label="Hours" value={v("hours")} onChange={(e) => set("hours", e.target.value)} />
                            </label>
                          </>
                        ) : (
                          <label className="field">
                            <span className="label">Number</span>
                            <input className="input" placeholder="Card, certificate or eSIMS no." aria-label="Number" value={v("number")} onChange={(e) => set("number", e.target.value)} />
                          </label>
                        )}
                        <label className="field">
                          <span className="label">Issued, done or submitted on</span>
                          <input className="input" type="date" aria-label="Issued, done or submitted on" value={v("on") || today()} onChange={(e) => set("on", e.target.value)} />
                        </label>
                        {(kind === "KDN_GUARD_CARD" || kind === "TNG_TRAINING") && (
                          <label className="field">
                            <span className="label">Expires on</span>
                            <input className="input" type="date" aria-label="Expires on" value={v("exp")} onChange={(e) => set("exp", e.target.value)} />
                          </label>
                        )}
                      </div>
                      <div className="hx-form-actions">
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
                        <button className="btn btn-sm btn-ghost" onClick={() => (setOpen(null), setF({}))}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {(d.total > 500 || act.error) && (
        <div className="hp-section">
          {d.total > 500 && <p className="hx-source">Showing the first 500 of {d.total}.</p>}
          <ErrorNotice error={act.error} />
        </div>
      )}
    </Card>
  );
}
