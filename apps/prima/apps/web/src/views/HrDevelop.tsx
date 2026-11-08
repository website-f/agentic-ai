import { useState } from "react";
import { api } from "../api";
import type { StaffLangId } from "../api/types";
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
const AUDIENCE_LABEL = { office: "Office staff", guards: "Guards and officers", all: "Everyone" } as const;
const ROLE_LABEL = { guard: "Guards", supervisor: "Officers", patrol_officer: "Patrol officers", office: "Office staff" } as const;
const BRIEF_MAX = 80;
type Lang = StaffLangId;

/**
 * Policies staff read and acknowledge. Three ways in: HR's full list (publish, versions, languages, who is missing);
 * "mine" for a staff member or guard acknowledging on their own sign-in; "briefing" for an officer, OM or company manager
 * recording the guards who acknowledged at a briefing (guard code of conduct, PIKM/ISO review, Fauzan 5 Nov 2026).
 * Languages and scope (IWAY finding, Fauzan 6 Nov 2026): English and Malay always, plus each worker's mother tongue;
 * the language each worker signed is recorded; a policy can be for everyone, a job or a site.
 */
export function PoliciesPanel({ mine = false, briefing = false }: { mine?: boolean; briefing?: boolean }) {
  const b = useLoad(() => api.hrPolicies().catch(() => null), []);
  const act = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const [readLang, setReadLang] = useState<Record<string, Lang>>({});
  const [f, setF] = useState<Record<string, string>>({});
  const [brief, setBrief] = useState<{ id: string; sel: string[]; ref: string; lang: string } | null>(null);
  const [tr, setTr] = useState<{ id: string; lang: string; title: string; body: string; translator: string } | null>(null);
  const [mt, setMt] = useState<{ personId: string; lang: string }>({ personId: "", lang: "" });
  const v = (k: string) => f[k] ?? "";
  const set = (k: string, x: string) => setF((o) => ({ ...o, [k]: x }));
  if (!b.data) return b.loading ? <Loading what="policies" /> : null;
  const d = b.data;
  const full = !mine && !briefing;
  const rows = mine ? d.rows.filter((r) => r.canAck || r.myAck) : briefing ? d.rows.filter((r) => r.briefableCount > 0) : d.rows;
  if (!full && (d.canPublish || !rows.length)) return null;
  const langLabel = (l: string) => d.languages.find((x) => x.id === l)?.label ?? l;
  const siteName = (id: string) => d.sites.find((x) => x.id === id)?.name ?? id;
  const toggle = (pid: string) =>
    setBrief((x) => (x ? { ...x, sel: x.sel.includes(pid) ? x.sel.filter((y) => y !== pid) : x.sel.length >= BRIEF_MAX ? x.sel : [...x.sel, pid] } : x));
  const roles = v("roles") ? v("roles").split(",") : [];
  const sites = v("sites") ? v("sites").split(",") : [];
  return (
    <Card
      flush
      title={mine ? "Policies to read" : briefing ? "Briefing acknowledgements" : "Handbook and policies"}
      sub={
        briefing
          ? "After you brief your guards, tick who was there and understood it, choose the language you briefed in, and give the briefing sheet or reference."
          : mine
            ? "Choose your language, read it, then tap to confirm you understood it."
            : "Each policy has English and Malay copies, plus the mother tongues of the staff it is for. A material change asks everyone again; a small correction does not."
      }
    >
      {rows.length === 0 && <Empty title="No policies published yet." />}
      {rows.length > 0 && (
        <ul className="hx-rows">
          {rows.map((r) => {
            const have = r.copies.map((c) => c.lang);
            const lang: Lang = readLang[r.id] ?? (r.myLang && have.includes(r.myLang) ? r.myLang : "en");
            const copy = r.copies.find((c) => c.lang === lang) ?? r.copies[0];
            const scope = r.scope;
            return (
              <li key={r.id} className="hx-row">
                <div className="hx-row-main">
                  <span className="hx-row-title">{full ? r.title : copy.title}</span>
                  <span className="hx-row-meta">
                    {KIND_LABEL[r.kind]} · version {r.version}, {dateLabel(r.publishedOn)}
                    {full && r.acked != null && ` · ${r.acked} acknowledged, ${r.missingCount ?? 0} not yet`}
                    {full && r.acked != null && r.ackedByLang && Object.keys(r.ackedByLang).length > 0
                      ? ` (${Object.entries(r.ackedByLang)
                          .map(([l, n]) => `${n} in ${l === "unknown" ? "language not recorded" : langLabel(l)}`)
                          .join(", ")})`
                      : ""}
                    {full && r.acked != null && r.notInMotherTongue ? ` · ${r.notInMotherTongue} signed in a language other than their mother tongue` : ""}
                    {!mine && r.briefableCount > 0 && ` · ${r.briefableCount} of your guards not yet`}
                  </span>
                </div>
                <div className="hx-row-side">
                  {!briefing && (r.myAck ? <Chip tone="ok">acknowledged{r.myAckLang ? ` (${langLabel(r.myAckLang)})` : ""}</Chip> : r.canAck ? <Chip tone="warn">to read</Chip> : null)}
                </div>
                <div className="hx-row-body">
                  {full && (
                    <div className="sx-chips">
                      <Chip tone="info">{AUDIENCE_LABEL[r.audience]}</Chip>
                      {scope?.roles?.length ? <Chip tone="info">{scope.roles.map((x) => ROLE_LABEL[x]).join(", ")}</Chip> : null}
                      {scope?.jobTitles?.length ? <Chip tone="info">Job: {scope.jobTitles.join(", ")}</Chip> : null}
                      {scope?.siteIds?.length ? <Chip tone="info">Site: {scope.siteIds.map(siteName).join(", ")}</Chip> : null}
                      <span className="hx-row-meta">Copies:</span>
                      {r.copies.map((c) => (
                        <Chip key={c.lang} tone="ok">
                          {c.label}
                        </Chip>
                      ))}
                      {(r.languageGaps ?? []).map((g) => (
                        <Chip key={g.lang} tone={g.required ? "crit" : "warn"}>
                          {g.label} missing{g.people ? `: ${g.people} staff` : ""}
                        </Chip>
                      ))}
                    </div>
                  )}
                  <div className="hx-row-actions">
                    <select className="select" aria-label="Language" value={lang} onChange={(e) => setReadLang({ ...readLang, [r.id]: e.target.value as Lang })}>
                      {r.copies.map((c) => (
                        <option key={c.lang} value={c.lang}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <button className="btn btn-sm" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                      {open === r.id ? "Hide" : "Read"}
                    </button>
                    {!briefing && r.canAck && (
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={act.busy || open !== r.id}
                        title={open !== r.id ? "Read it first" : undefined}
                        onClick={() => void act.run(() => api.acknowledgePolicy(r.id, lang), "Acknowledged.").then(() => b.reload())}
                      >
                        I have read and understood it
                      </button>
                    )}
                    {!mine && r.briefableCount > 0 && (
                      <button className="btn btn-sm" aria-expanded={brief?.id === r.id} onClick={() => setBrief(brief?.id === r.id ? null : { id: r.id, sel: [], ref: "", lang })}>
                        {brief?.id === r.id ? "Close briefing" : "Record briefing"}
                      </button>
                    )}
                    {full && d.canPublish && (
                      <>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => {
                            const ms = r.copies.find((c) => c.lang === "ms");
                            setF({
                              id: r.id,
                              kind: r.kind,
                              title: r.title,
                              body: r.body,
                              audience: r.audience,
                              material: "",
                              msTitle: ms?.title ?? "",
                              msBody: ms?.body ?? "",
                              msBy: ms?.translator ?? "",
                              roles: (scope?.roles ?? []).join(","),
                              jobs: (scope?.jobTitles ?? []).join(", "),
                              sites: (scope?.siteIds ?? []).join(","),
                            });
                          }}
                        >
                          New version
                        </button>
                        <button
                          className="btn btn-sm btn-ghost"
                          aria-expanded={tr?.id === r.id}
                          onClick={() => setTr(tr?.id === r.id ? null : { id: r.id, lang: r.languageGaps?.find((g) => !g.required)?.lang ?? "ne", title: "", body: "", translator: "" })}
                        >
                          {tr?.id === r.id ? "Close translation" : "Add translation"}
                        </button>
                      </>
                    )}
                  </div>
                  {open === r.id && <div className="hp-doc">{copy.body}</div>}
                  {full && open === r.id && r.missing && r.missing.length > 0 && (
                    <p className="hx-row-meta">
                      Not yet: {r.missing.slice(0, 30).map((m) => `${m.name} (${langLabel(m.lang)})`).join(", ")}
                      {(r.missingCount ?? 0) > 30 ? " and more" : ""}
                    </p>
                  )}
                  {full && open === r.id && d.canPublish && r.missing && r.missing.length > 0 && (
                    <div className="hx-form">
                      <h3 className="hx-form-title">Set a staff member's mother tongue</h3>
                      <div className="hx-form-grid">
                        <label className="field">
                          <span className="label">Staff member</span>
                          <select className="select" aria-label="Staff member" value={mt.personId} onChange={(e) => setMt({ ...mt, personId: e.target.value })}>
                            <option value="">Staff member</option>
                            {r.missing.slice(0, 200).map((m) => (
                              <option key={m.personId} value={m.personId}>
                                {m.name} ({langLabel(m.lang)})
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span className="label">Mother tongue</span>
                          <select className="select" aria-label="Mother tongue" value={mt.lang} onChange={(e) => setMt({ ...mt, lang: e.target.value })}>
                            <option value="">Language</option>
                            {d.languages.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="hx-form-actions">
                        <button
                          className="btn btn-sm"
                          disabled={act.busy || !mt.personId || !mt.lang}
                          onClick={() => void act.run(() => api.setMotherTongue(mt.personId, mt.lang as Lang), "Language saved.").then((x) => x && (setMt({ personId: "", lang: "" }), b.reload()))}
                        >
                          Save language
                        </button>
                      </div>
                    </div>
                  )}
                  {tr?.id === r.id && (
                    <div className="hx-form">
                      <h3 className="hx-form-title">Add a translation</h3>
                      <div className="hx-form-grid">
                        <label className="field">
                          <span className="label">Language</span>
                          <select className="select" aria-label="Translation language" value={tr.lang} onChange={(e) => setTr({ ...tr, lang: e.target.value })}>
                            {d.languages
                              .filter((l) => l.id !== "en")
                              .map((l) => (
                                <option key={l.id} value={l.id}>
                                  {l.label}
                                  {have.includes(l.id) ? " (replace)" : ""}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label className="field">
                          <span className="label">Title</span>
                          <input className="input" placeholder="Title in this language" aria-label="Translated title" value={tr.title} onChange={(e) => setTr({ ...tr, title: e.target.value })} />
                        </label>
                        <label className="field">
                          <span className="label">Translated by</span>
                          <input className="input" placeholder="Translated by (person or service)" aria-label="Translated by" value={tr.translator} onChange={(e) => setTr({ ...tr, translator: e.target.value })} />
                        </label>
                        <label className="field hx-form-wide">
                          <span className="label">Text</span>
                          <textarea className="textarea" rows={5} placeholder="The text in this language" aria-label="Translated text" value={tr.body} onChange={(e) => setTr({ ...tr, body: e.target.value })} />
                        </label>
                      </div>
                      <div className="hx-form-actions">
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={act.busy || tr.title.trim().length < 3 || tr.body.trim().length < 20 || tr.translator.trim().length < 3}
                          onClick={() =>
                            void act
                              .run(() => api.addPolicyCopy(r.id, { lang: tr.lang as Lang, title: tr.title, body: tr.body, translator: tr.translator }), "Translation saved.")
                              .then((x) => x && (setTr(null), b.reload()))
                          }
                        >
                          Save translation
                        </button>
                      </div>
                    </div>
                  )}
                  {brief?.id === r.id && (
                    <div className="hx-form">
                      <h3 className="hx-form-title">Record a briefing</h3>
                      <div className="hx-row-actions">
                        <button className="btn btn-sm" onClick={() => setBrief({ ...brief, sel: r.briefable.slice(0, BRIEF_MAX).map((x) => x.personId) })}>
                          Tick all shown (up to {BRIEF_MAX})
                        </button>
                        <button className="btn btn-sm" onClick={() => setBrief({ ...brief, sel: [] })}>
                          Untick all
                        </button>
                        <span className="hx-row-meta">{brief.sel.length} ticked</span>
                      </div>
                      <div style={{ display: "grid", gap: 2, maxHeight: 240, overflowY: "auto" }}>
                        {r.briefable.map((x) => (
                          <label key={x.personId} className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <input type="checkbox" checked={brief.sel.includes(x.personId)} onChange={() => toggle(x.personId)} />
                            {x.name}{" "}
                            <span className="muted">
                              {x.staffNo} · {langLabel(x.lang)}
                            </span>
                          </label>
                        ))}
                      </div>
                      <div className="hx-form-grid">
                        <label className="field">
                          <span className="label">Briefed in</span>
                          <select className="select" aria-label="Briefing language" value={brief.lang} onChange={(e) => setBrief({ ...brief, lang: e.target.value })}>
                            {r.copies.map((c) => (
                              <option key={c.lang} value={c.lang}>
                                Briefed in {c.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span className="label">Briefing reference</span>
                          <input className="input" placeholder="Briefing sheet or reference, e.g. Night briefing 5 Nov, sheet 12" aria-label="Briefing reference" value={brief.ref} onChange={(e) => setBrief({ ...brief, ref: e.target.value })} />
                        </label>
                      </div>
                      <div className="hx-form-actions">
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={act.busy || !brief.sel.length || brief.ref.trim().length < 3}
                          onClick={() =>
                            void act
                              .run(() => api.recordBriefingAcks(r.id, brief.sel, brief.ref, brief.lang as Lang), "Briefing recorded.")
                              .then((x) => x && (setBrief(null), b.reload()))
                          }
                        >
                          Record {brief.sel.length} acknowledgement{brief.sel.length === 1 ? "" : "s"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {((full && d.canPublish) || act.error) && (
        <div className="hp-section">
          {full && d.canPublish && (
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
                  <span className="label">Who must read it</span>
                  <select className="select" aria-label="Who must read it" value={v("audience") || "office"} onChange={(e) => set("audience", e.target.value)}>
                    {Object.entries(AUDIENCE_LABEL).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="field hx-form-wide">
                  <span className="label">Only for (leave empty for everyone)</span>
                  <div className="sx-chips">
                    {Object.entries(ROLE_LABEL).map(([k, l]) => (
                      <label key={k} className="small" style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <input type="checkbox" checked={roles.includes(k)} onChange={(e) => set("roles", (e.target.checked ? [...roles, k] : roles.filter((x) => x !== k)).join(","))} />
                        {l}
                      </label>
                    ))}
                  </div>
                </div>
                <label className="field">
                  <span className="label">Job titles</span>
                  <input className="input" placeholder="Separated by commas (e.g. Admin Executive)" aria-label="Job titles" value={v("jobs")} onChange={(e) => set("jobs", e.target.value)} />
                </label>
                <label className="field">
                  <span className="label">Sites</span>
                  <select
                    className="select"
                    aria-label="Add a site"
                    value=""
                    onChange={(e) => e.target.value && !sites.includes(e.target.value) && set("sites", [...sites, e.target.value].join(","))}
                  >
                    <option value="">Add a site</option>
                    {d.sites.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </label>
                {sites.length > 0 && (
                  <div className="sx-chips hx-form-wide">
                    {sites.map((id) => (
                      <button key={id} className="btn btn-sm" title="Remove this site" onClick={() => set("sites", sites.filter((x) => x !== id).join(","))}>
                        {siteName(id)} ✕
                      </button>
                    ))}
                  </div>
                )}
                <label className="field hx-form-wide">
                  <span className="label">Title in English</span>
                  <input className="input" placeholder="Title in English" aria-label="Policy title" value={v("title")} onChange={(e) => set("title", e.target.value)} />
                </label>
                <label className="field hx-form-wide">
                  <span className="label">English text</span>
                  <textarea className="textarea" rows={5} placeholder="The English text staff read, or where the full document is kept" aria-label="Policy text" value={v("body")} onChange={(e) => set("body", e.target.value)} />
                </label>
                <label className="field hx-form-wide">
                  <span className="label">Tajuk dalam Bahasa Melayu</span>
                  <input className="input" placeholder="Tajuk dalam Bahasa Melayu" aria-label="Malay title" value={v("msTitle")} onChange={(e) => set("msTitle", e.target.value)} />
                </label>
                <label className="field hx-form-wide">
                  <span className="label">Teks dalam Bahasa Melayu</span>
                  <textarea className="textarea" rows={5} placeholder="Teks dalam Bahasa Melayu (always required)" aria-label="Malay text" value={v("msBody")} onChange={(e) => set("msBody", e.target.value)} />
                </label>
                <label className="field">
                  <span className="label">Malay copy translated by</span>
                  <input className="input" placeholder="Malay copy translated by" aria-label="Malay copy translated by" value={v("msBy")} onChange={(e) => set("msBy", e.target.value)} />
                </label>
              </div>
              <p className="hx-row-meta">Add other mother tongues after publishing, with Add translation.</p>
              {v("id") && (
                <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" checked={v("material") === "yes"} onChange={(e) => set("material", e.target.checked ? "yes" : "")} />
                  Material change: everyone acknowledges again and other translations are needed again (leave unticked for a typo or wording fix)
                </label>
              )}
              <div className="hx-form-actions">
                <button
                  className="btn btn-sm btn-primary"
                  disabled={act.busy || v("title").trim().length < 3 || v("body").trim().length < 20 || v("msTitle").trim().length < 3 || v("msBody").trim().length < 20 || v("msBy").trim().length < 3}
                  onClick={() =>
                    void act
                      .run(
                        () =>
                          api.publishPolicy({
                            id: v("id") || null,
                            kind: (v("kind") || "handbook") as keyof typeof KIND_LABEL,
                            title: v("title"),
                            body: v("body"),
                            audience: (v("audience") || "office") as keyof typeof AUDIENCE_LABEL,
                            material: v("id") ? v("material") === "yes" : undefined,
                            scope: {
                              roles: roles as (keyof typeof ROLE_LABEL)[],
                              jobTitles: v("jobs")
                                .split(",")
                                .map((x) => x.trim())
                                .filter(Boolean),
                              siteIds: sites,
                            },
                            copies: [{ lang: "ms", title: v("msTitle"), body: v("msBody"), translator: v("msBy") }],
                          }),
                        v("id") ? "New version published." : "Published.",
                      )
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
                <p className="hx-row-meta">Sources: {readableSources(r.sources)}</p>
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
                <Chip tone={tone(r.kdn.level)}>{r.kdn.chip ?? (r.kdn.level === "ok" ? (r.kdn.expiresOn ? `KDN to ${dateLabel(r.kdn.expiresOn)}` : "KDN held, no expiry date") : r.kdn.level === "block" ? "KDN card not valid" : "KDN to check")}</Chip>
                <Chip tone={tone(r.csg.level)}>{r.csg.chip ?? (r.csg.level === "ok" ? "CSG done" : r.csg.level === "block" ? "CSG not done" : "CSG due")}</Chip>
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

/**
 * P80: sources as people read them. Laws and agreements stay; the builders' file names (docs/HR_PHASE3.md) are dropped
 * and a record store (prima.staff_faces) is named as Prima's records.
 */
function readableSources(sources: string[]): string {
  const out = sources
    .map((s) => s.replace(/\bdocs\/[\w./-]+\.md,?\s*/g, '').trim())
    .flatMap((s) => (/^prima\.[a-z_]+(, prima\.[a-z_]+)*$/.test(s) ? s.split(', ').map((x) => `Prima's ${x.slice(6).replace(/_/g, ' ')} records`) : [s]))
    .filter(Boolean);
  return out.length ? [...new Set(out)].join('; ') : 'Prima records';
}
