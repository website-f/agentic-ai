import { Select } from '../SearchSelect';
import { useState } from "react";
import { isOwnerAdmin } from "@prima/core";
import { api, type Vacancies } from "../api";
import { useApp } from "../App";
import { Card, Empty } from "../kit";
import { Chip, ErrorNotice, Loading, dateLabel, useAction, useLoad } from "../ui";
import "../styles/hrx.css";

/**
 * HR Phase 3, slice 3B (Fauzan, 2 Nov 2026): joining and leaving. Prima works out what must be filed and the latest day
 * to file it, drafts the EA figures and the register, and reminds HR about probation and retirement. Vacancies are
 * approved by the CEO and signed by the company head.
 */
function save(f: { filename: string; body: string }) {
  const url = URL.createObjectURL(new Blob([f.body], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = f.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function keepsHr(u: { role: string; department?: string | null; leadership?: string | null }) {
  return (u.role === "pwvsb_officer" && u.department === "hr") || u.leadership === "cos" || u.leadership === "deputy_cos";
}

export function JoinLeavePanel() {
  const { me } = useApp();
  // P78: the owner records filings and drafts the EA forms like HR; confirming probation stays with HR.
  const keeper = keepsHr(me.user);
  const hr = keeper || isOwnerAdmin(me.user);
  const b = useLoad(() => (hr ? api.hrJoinLeave() : Promise.resolve(null)), [hr]);
  const act = useAction();
  const [ref, setRef] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [ext, setExt] = useState<Record<string, string>>({});
  const [guide, setGuide] = useState<Awaited<ReturnType<typeof api.leavingGuide>> | null>(null);
  if (!hr) return null;
  if (b.error) return <ErrorNotice error={b.error} />;
  if (!b.data) return <Loading what="joining and leaving" />;
  const d = b.data;
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  const open = d.filings.filter((f) => !f.filed);
  return (
    <Card
      flush
      title="Joining and leaving"
      sub="Filings show the latest day to file. Prima drafts and reminds; HR files with LHDN, KWSP and PERKESO and records the reference."
      actions={<Chip tone={open.some((f) => f.overdue) ? "crit" : open.length ? "warn" : "ok"}>{open.length} to file</Chip>}
    >
      {d.maternityGuard.length > 0 && (
        <div className="hp-section">
          {d.maternityGuard.map((p) => (
            <div key={p.personId} className="notice small" data-tone="crit">
              {p.name} ({p.staffNo}): termination recorded around maternity leave. Employment Act s.41A allows it only for misconduct, wilful breach or closure.
            </div>
          ))}
        </div>
      )}

      <div className="hp-subhead">
        <h3>Filings</h3>
        <span className="hx-count">{d.filings.length}</span>
      </div>
      {d.filings.length === 0 && <Empty title="Nothing due." />}
      {d.filings.length > 0 && (
        <ul className="hx-rows">
          {d.filings.map((f) => (
            <li key={f.id} className="hx-row" data-tone={!f.filed ? (f.overdue ? "crit" : "warn") : undefined}>
              <div className="hx-row-main">
                <span className="hx-row-title">
                  {f.label} · {f.name ?? f.companyName}
                </span>
                <span className="hx-row-meta">
                  {f.filed ? `Filed ${dateLabel(f.filed.filedOn)}, reference ${f.filed.ref}, by ${f.filed.by}` : `Latest by ${dateLabel(f.latestBy)}`} · {f.companyName}
                  {f.kind === "EA" || f.kind === "BORANG_E" ? ` · year ${f.period}` : ""}
                </span>
              </div>
              <div className="hx-row-side">
                {!f.filed && <Chip tone={f.overdue ? "crit" : "warn"}>{f.overdue ? "late" : "due"}</Chip>}
                {f.kind === "EA" && (
                  <button className="btn btn-sm" disabled={act.busy} onClick={() => void act.run(() => api.eaDraft(f.companyId, f.period)).then((r) => r && save(r))}>
                    EA figures
                  </button>
                )}
              </div>
              {!f.filed && (
                <div className="hx-row-body">
                  <div className="hp-inline">
                    <input
                      className="input"
                      placeholder="Reference"
                      aria-label={`Reference for ${f.label}`}
                      value={ref[f.id] ?? ""}
                      onChange={(e) => setRef((x) => ({ ...x, [f.id]: e.target.value }))}
                    />
                    <button
                      className="btn btn-sm"
                      disabled={act.busy || (ref[f.id] ?? "").trim().length < 3}
                      onClick={() =>
                        void act
                          .run(
                            () =>
                              api.recordHrFiling({
                                kind: f.kind,
                                companyId: f.companyId,
                                personId: f.personId,
                                period: f.period,
                                ref: ref[f.id] ?? "",
                                filedOn: today,
                              }),
                            "Recorded.",
                          )
                          .then(() => b.reload())
                      }
                    >
                      Filed today
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {d.probations.length > 0 && (
        <>
          <div className="hp-subhead">
            <h3>Probation to confirm or extend</h3>
            <span className="hx-count">{d.probations.length}</span>
          </div>
          <ul className="hx-rows">
            {d.probations.map((p) => (
              <li key={p.personId} className="hx-row" data-tone={p.overdue ? "crit" : undefined}>
                <div className="hx-row-main">
                  <span className="hx-row-title">
                    {p.name} ({p.staffNo})
                  </span>
                  <span className="hx-row-meta">
                    {p.companyName} · ends {dateLabel(p.endsOn)}
                  </span>
                </div>
                <div className="hx-row-side">{p.overdue && <Chip tone="crit">passed</Chip>}</div>
                {keeper && (
                <div className="hx-row-body">
                  <div className="hp-probation">
                    <label className="field">
                      <span className="label">Comment</span>
                      <input
                        className="input"
                        placeholder="Comment (needed)"
                        aria-label={`Comment for ${p.name}`}
                        value={note[p.personId] ?? ""}
                        onChange={(e) => setNote((x) => ({ ...x, [p.personId]: e.target.value }))}
                      />
                    </label>
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={act.busy || !(note[p.personId] ?? "").trim()}
                      onClick={() => void act.run(() => api.decideProbation(p.personId, "confirm", null, note[p.personId] ?? ""), "Confirmed.").then(() => b.reload())}
                    >
                      Confirm
                    </button>
                    <label className="field">
                      <span className="label">New last day</span>
                      <input
                        className="input"
                        type="date"
                        aria-label="New last day of probation"
                        value={ext[p.personId] ?? ""}
                        onChange={(e) => setExt((x) => ({ ...x, [p.personId]: e.target.value }))}
                      />
                    </label>
                    <button
                      className="btn btn-sm"
                      disabled={act.busy || !(note[p.personId] ?? "").trim() || !ext[p.personId]}
                      onClick={() => void act.run(() => api.decideProbation(p.personId, "extend", ext[p.personId], note[p.personId] ?? ""), "Probation extended.").then(() => b.reload())}
                    >
                      Extend
                    </button>
                  </div>
                </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {d.retirements.length > 0 && (
        <>
          <div className="hp-subhead">
            <h3>At or near retirement age ({d.rule.value.retireAge})</h3>
            <span className="hx-count">{d.retirements.length}</span>
          </div>
          <ul className="hx-rows">
            {d.retirements.map((p) => (
              <li key={p.personId} className="hx-row">
                <div className="hx-row-main">
                  <span className="hx-row-title">
                    {p.name} ({p.staffNo})
                  </span>
                  <span className="hx-row-meta">
                    {p.companyName} · age {p.age}
                  </span>
                </div>
                <div className="hx-row-side">
                  <Chip tone={p.over ? "crit" : "warn"}>{p.over ? "over 60" : "soon"}</Chip>
                  <button className="btn btn-sm" onClick={() => void act.run(() => api.leavingGuide(p.personId)).then((g) => g && setGuide(g))}>
                    Leaving guide
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {guide && (
        <div className="hp-section">
          <div className="hp-guide" role="region" aria-label="Leaving guide">
            <div className="hp-guide-head">
              <h3>
                Leaving guide: {guide.name}, {guide.years} years of service
              </h3>
              <button className="btn btn-sm btn-ghost" onClick={() => setGuide(null)}>
                Close
              </button>
            </div>
            <p className="hx-row-text">
              Notice under the Act: {guide.noticeWeeks} weeks. Termination benefit:{" "}
              {guide.benefit.eligible
                ? `${guide.benefit.daysPerYear} days a year, about RM${guide.benefit.amount.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`
                : "not due (under 12 months)"}
              .
            </p>
            <ol className="hp-guide-steps">
              {guide.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
        </div>
      )}

      <div className="hp-subhead">
        <h3>Register of employees</h3>
      </div>
      <div className="hp-section hp-section-first">
        <p className="hx-source">Kept {d.rule.value.keepYears} years after a staff member leaves. Take it per employer.</p>
        <RegisterButtons />
        <ErrorNotice error={act.error} />
      </div>
    </Card>
  );
}

function RegisterButtons() {
  const { me } = useApp();
  const act = useAction();
  const [cid, setCid] = useState("pwvsb");
  const companies = me.companies ?? [];
  return (
    <>
      <div className="hp-inline">
        <Select className="select" value={cid} onChange={(e) => setCid(e.target.value)} aria-label="Employer">
          <option value="pwvsb">PWVSB (central)</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <button className="btn btn-sm" disabled={act.busy} onClick={() => void act.run(() => api.employeeRegister(cid)).then((r) => r && save(r))}>
          Download register
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </>
  );
}

const VACANCY_STATUS = {
  waiting_ceo: "waiting for the CEO",
  waiting_head: "waiting for the company head",
  open: "open",
  refused: "refused",
  filled: "filled",
  cancelled: "cancelled",
} as const;

/** Vacancies: HR or the company manager raises; the CEO approves; the company head signs (Fauzan, 2 Nov 2026). */
export function VacanciesPanel() {
  const { me } = useApp();
  const u = me.user;
  const allowed = keepsHr(u) || u.opsTier === "ceo" || u.opsTier === "om" || u.opsTier === "regional" || u.role === "company_manager";
  const list = useLoad(() => (allowed ? api.vacancies() : Promise.resolve(null)), [allowed]);
  const act = useAction();
  const [note, setNote] = useState<Record<string, string>>({});
  const [raising, setRaising] = useState(false);
  const [f, setF] = useState({
    companyId: u.role === "company_manager" ? (u.companyIds[0] ?? "") : "pwvsb",
    title: "",
    department: "",
    headcount: "1",
    reason: "",
    payFrom: "",
    payTo: "",
    category: "staff" as "staff" | "guard" | "officer",
    state: "",
  });
  if (!allowed) return null;
  if (list.error) return <ErrorNotice error={list.error} />;
  if (!list.data) return <Loading what="vacancies" />;
  const d = list.data;
  const step = (id: string, action: "ceo_approve" | "ceo_refuse" | "sign" | "close", done: string) =>
    void act.run(() => api.vacancyStep(id, action, note[id] ?? ""), done).then(() => list.reload());
  const companies = me.companies ?? [];
  return (
    <Card
      flush
      title="Vacancies"
      sub="The CEO approves a vacancy, then the company head signs the approval. The CEO approves and signs PWVSB central posts. Every step needs a comment."
      actions={
        <>
          <Chip tone="info">{d.rows.filter((r) => r.status === "open").length} open</Chip>
          {d.canRaise && !raising && (
            <button className="btn btn-sm btn-primary" onClick={() => setRaising(true)}>
              Raise a vacancy
            </button>
          )}
        </>
      }
    >
      {raising && (
        <div className="hp-section">
          <div className="hx-form">
            <h3 className="hx-form-title">Raise a vacancy</h3>
            <div className="hx-form-grid">
              <label className="field">
                <span className="label">Employer</span>
                <Select className="select" value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })} aria-label="Employer">
                  {(keepsHr(u) || isOwnerAdmin(u)) && <option value="pwvsb">PWVSB (central)</option>}
                  {companies
                    .filter((c) => keepsHr(u) || isOwnerAdmin(u) || u.companyIds.includes(c.id))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </Select>
              </label>
              <label className="field">
                <span className="label">Job title</span>
                <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} aria-label="Job title" />
              </label>
              <label className="field">
                <span className="label">Department</span>
                <input className="input" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} aria-label="Department" />
              </label>
              <label className="field">
                <span className="label">Kind of post</span>
                <select className="select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as typeof f.category })} aria-label="Kind of post">
                  <option value="staff">Office staff</option>
                  <option value="guard">Guard</option>
                  <option value="officer">Patrolling officer</option>
                </select>
              </label>
              {f.category !== "staff" && (
                <label className="field">
                  <span className="label">State (its OM approves the job post)</span>
                  <Select className="select" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} aria-label="State">
                    <option value="">Choose…</option>
                    {MY_STATES.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              <label className="field">
                <span className="label">How many</span>
                <input className="input" inputMode="numeric" value={f.headcount} onChange={(e) => setF({ ...f, headcount: e.target.value })} aria-label="How many" />
              </label>
              <label className="field">
                <span className="label">Pay from (RM a month)</span>
                <input className="input" inputMode="decimal" value={f.payFrom} onChange={(e) => setF({ ...f, payFrom: e.target.value })} aria-label="Pay from" />
              </label>
              <label className="field">
                <span className="label">Pay to (RM a month)</span>
                <input className="input" inputMode="decimal" value={f.payTo} onChange={(e) => setF({ ...f, payTo: e.target.value })} aria-label="Pay to" />
              </label>
              <label className="field hx-form-wide">
                <span className="label">Why the post is needed</span>
                <input className="input" placeholder="Why the post is needed" aria-label="Why the post is needed" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
              </label>
            </div>
            <div className="hx-form-actions">
              <button
                className="btn btn-primary btn-sm"
                disabled={act.busy || f.title.trim().length < 3 || f.reason.trim().length < 5 || (f.category !== "staff" && !f.state) || !/^\d+$/.test(f.headcount)}
                onClick={async () => {
                  const r = await act.run(
                    () =>
                      api.raiseVacancy({
                        companyId: f.companyId,
                        title: f.title,
                        department: f.department,
                        headcount: Number(f.headcount),
                        reason: f.reason,
                        payFrom: f.payFrom ? Number(f.payFrom) : null,
                        payTo: f.payTo ? Number(f.payTo) : null,
                        category: f.category,
                        state: f.category === "staff" ? null : f.state,
                      }),
                    "Sent to the CEO.",
                  );
                  if (r) {
                    setRaising(false);
                    list.reload();
                  }
                }}
              >
                Send to the CEO
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setRaising(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {d.rows.length === 0 && <Empty title="No vacancies." />}
      {d.rows.length > 0 && (
        <ul className="hx-rows">
          {d.rows.slice(0, 30).map((r) => (
            <li key={r.id} className="hx-row">
              <div className="hx-row-main">
                <span className="hx-row-title">
                  {r.headcount} x {r.title} · {r.companyName}
                  {r.category && r.category !== "staff" ? ` · ${r.category === "guard" ? "guard" : "patrolling officer"}, ${r.state ?? ""}` : ""}
                </span>
                <span className="hx-row-meta">
                  {r.reason}
                  {r.payFrom ? ` · RM${r.payFrom}${r.payTo ? ` to RM${r.payTo}` : ""}` : ""} · raised by {r.raisedBy}
                  {r.ceo ? ` · CEO ${r.ceo.approve ? "approved" : "refused"}: ${r.ceo.note}` : ""}
                  {r.head ? ` · signed by ${r.head.by}: ${r.head.note}` : ""}
                </span>
              </div>
              <div className="hx-row-side">
                <Chip tone={r.status === "open" || r.status === "filled" ? "ok" : r.status === "refused" || r.status === "cancelled" ? "neutral" : "warn"}>
                  {r.status === "waiting_head" && r.signer === "ceo" ? "waiting for the CEO to sign" : VACANCY_STATUS[r.status]}
                </Chip>
              </div>
              {(r.canCeo || r.canSign || r.canClose) && (
                <div className="hx-row-body">
                  <div className="hp-inline">
                    <input className="input" placeholder="Comment (needed)" aria-label={`Comment on ${r.title}`} value={note[r.id] ?? ""} onChange={(e) => setNote((x) => ({ ...x, [r.id]: e.target.value }))} />
                    {r.canCeo && (
                      <>
                        <button className="btn btn-sm btn-primary" disabled={act.busy || !(note[r.id] ?? "").trim()} onClick={() => step(r.id, "ceo_approve", r.signer === "ceo" ? "Approved and signed." : "Approved.")}>
                          {r.signer === "ceo" ? "Approve and sign" : "Approve"}
                        </button>
                        <button className="btn btn-sm" disabled={act.busy || !(note[r.id] ?? "").trim()} onClick={() => step(r.id, "ceo_refuse", "Refused.")}>
                          Refuse
                        </button>
                      </>
                    )}
                    {r.canSign && (
                      <button className="btn btn-sm btn-primary" disabled={act.busy || !(note[r.id] ?? "").trim()} onClick={() => step(r.id, "sign", "Signed.")}>
                        Sign the approval
                      </button>
                    )}
                    {r.canClose && (
                      <button className="btn btn-sm" disabled={act.busy || !(note[r.id] ?? "").trim()} onClick={() => step(r.id, "close", r.status === "open" ? "Marked filled." : "Cancelled.")}>
                        {r.status === "open" ? "Mark filled" : "Cancel"}
                      </button>
                    )}
                  </div>
                </div>
              )}
              {r.applicantCount !== null && (r.status === "open" || (r.applicantCount ?? 0) > 0) && (
                <div className="hx-row-body">
                  <ApplicantList vacancyId={r.id} count={r.applicantCount ?? 0} hired={r.hiredCount ?? 0} headcount={r.headcount} />
                </div>
              )}
              {(r.status === "open" || r.advert) && (
                <div className="hx-row-body">
                  <JobPost key={`${r.id}:${r.advert?.version ?? 0}:${r.advert?.status ?? ""}`} row={r} channels={d.channels} onDone={() => list.reload()} />
                </div>
              )}
            </li>
          ))}
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

const MY_STATES = [
  "Johor", "Kedah", "Kelantan", "Kuala Lumpur", "Labuan", "Melaka", "Negeri Sembilan", "Pahang",
  "Perak", "Perlis", "Pulau Pinang", "Putrajaya", "Sabah", "Sarawak", "Selangor", "Terengganu",
];

type VacancyRow = Vacancies["rows"][number];
type ChannelRow = Vacancies["channels"][number];

const ADVERT_STATUS: Record<string, string> = {
  draft: "draft",
  waiting_approval: "waiting for approval",
  approved: "approved, not published",
  withdrawn: "withdrawn",
};

/**
 * The job post for an open vacancy (rule HR-JOB-ADVERT, Fauzan 5 Nov 2026). HR or the company manager drafts; the
 * HR Director (staff) or the state's OM (guards, patrolling officers) approves. Social publishing is switched off:
 * nothing here posts anything, and a post HR makes by hand is recorded as HR's own statement.
 */
function JobPost({
  row,
  channels,
  onDone,
}: {
  row: VacancyRow;
  channels: ChannelRow[];
  onDone: () => void;
}) {
  const a = row.advert ?? null;
  const act = useAction();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(a?.text ?? "");
  const [chosen, setChosen] = useState<string[]>(a?.channels ?? ["facebook"]);
  const [applyHow, setApplyHow] = useState(a?.applyHow ?? "");
  // A closing date is required (within 90 days); a new post starts at 30 days from today, Malaysia time.
  const [closingDate, setClosingDate] = useState(a?.closingDate ?? new Date(Date.now() + 8 * 3_600_000 + 30 * 86_400_000).toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [postChannel, setPostChannel] = useState<string>(a?.channels[0] ?? "facebook");
  const [link, setLink] = useState("");
  const [where, setWhere] = useState("");
  const noLink = postChannel === "whatsapp" || postChannel === "notice_board" || postChannel === "other_place";
  const step = (
    action: "draft" | "submit" | "approve" | "return" | "record_posted" | "withdraw",
    input: Record<string, unknown>,
    done: string,
  ) =>
    void act
      .run(() => api.advertStep(row.id, action, { ...input, version: a?.version }), done)
      .then((r) => {
        if (r) {
          setEditing(false);
          setNote("");
          setLink("");
          onDone();
        }
      });
  const draftInput = (useText: boolean) => ({
    text: useText ? text : "",
    channels: chosen,
    applyHow,
    closingDate: closingDate || null,
  });
  return (
    <div className="card" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div style={{ fontWeight: 600 }}>Job post</div>
        <div className="row" style={{ gap: 6 }}>
          {a && <Chip tone={a.status === "approved" ? "ok" : a.status === "withdrawn" ? "neutral" : "warn"}>{ADVERT_STATUS[a.status]}</Chip>}
          <Chip tone="neutral">Publishing off</Chip>
        </div>
      </div>
      <div className="muted small">
        Approved by the {row.approverLabel}, never by the person who wrote the wording. Social accounts are not connected yet, so
        Prima does not post anything.
      </div>
      {row.advertApproverMissing && (
        <div className="small" style={{ color: "var(--warn, #b54708)" }}>
          No Operations Manager covers {row.state} yet, so nobody can approve this post. Ask for an OM to be assigned to the state.
        </div>
      )}
      {row.advertExpired && a?.status !== "withdrawn" && (
        <div className="small" style={{ color: "var(--warn, #b54708)" }}>
          The closing date has passed. Withdraw the post and take down any copies made by hand, or edit it with a new date.
        </div>
      )}
      {a && !editing && (
        <>
          <pre className="small" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{a.text}</pre>
          <div className="muted small">
            Version {a.version} ·{" "}
            {a.origin === "template" ? "drafted from Prima's template (AI not connected)" : a.origin === "ai" ? "drafted by AI, not yet checked" : "written by hand"} · by{" "}
            {a.writtenBy} · to {a.channels.join(", ")}
            {a.closingDate ? ` · closes ${a.closingDate}` : ""}
            {a.approved ? ` · approved by ${a.approved.by}: ${a.approved.note}` : ""}
          </div>
          {row.advertChecks.map((c) => (
            <div key={c.code} className="small" style={{ color: c.level === "block" ? "var(--crit, #b42318)" : "var(--warn, #b54708)" }}>
              {c.level === "block" ? "Must fix: " : "Check: "}
              {c.message}
            </div>
          ))}
          {a.status === "approved" && (a.outbox ?? []).length > 0 && (
            <div className="muted small">
              Queued, not sent (automatic posting is not switched on):{" "}
              {(a.outbox ?? []).map((o) => `${o.channel} (${o.status === "posted" ? "posted" : o.status === "failed" ? "failed" : "waiting for the account to be connected"})`).join(" · ")}
            </div>
          )}
          {a.manualPosts.length > 0 && (
            <div className="muted small">
              Posted by hand (recorded by HR, not checked by Prima):{" "}
              {a.manualPosts
                .map((p) => `${p.link ? `${p.channel} ${p.link}` : `${p.channel.replace("_", " ")}: ${p.where} (no link)`} (wording v${p.version}${p.version !== a.version ? ", older wording" : ""})`)
                .join(" · ")}
            </div>
          )}
        </>
      )}
      {editing && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            {channels.map((c) => (
              <label key={c.id} className="small" title={c.why}>
                <input
                  type="checkbox"
                  checked={chosen.includes(c.id)}
                  onChange={(e) =>
                    setChosen((x) => (e.target.checked ? [...x, c.id] : x.filter((y) => y !== c.id)))
                  }
                />{" "}
                {c.name} ({c.paid ? "paid per post, " : ""}not connected)
              </label>
            ))}
          </div>
          <input
            className="input"
            placeholder="How to apply: official company email, form link or recruitment number"
            aria-label="How to apply"
            value={applyHow}
            onChange={(e) => setApplyHow(e.target.value)}
          />
          <label className="field">
            <span className="label">Closing date</span>
            <input className="input" type="date" aria-label="Closing date" value={closingDate} onChange={(e) => setClosingDate(e.target.value)} />
          </label>
          <textarea
            className="input"
            rows={8}
            placeholder="Leave empty and press Draft for me, or write the post yourself"
            aria-label="Post wording"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <button className="btn btn-sm" disabled={act.busy || chosen.length === 0} onClick={() => step("draft", draftInput(false), "Drafted. Read it before sending.")}>
              Draft for me
            </button>
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy || chosen.length === 0 || text.trim().length < 20}
              onClick={() => step("draft", draftInput(true), "Saved.")}
            >
              Save my wording
            </button>
            <button className="btn btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {!editing && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {row.canAdvertDraft && (
            <button
              className="btn btn-sm"
              onClick={() => {
                setText(a?.text ?? "");
                setEditing(true);
              }}
            >
              {a ? "Edit the post" : "Write the job post"}
            </button>
          )}
          {row.canAdvertSubmit && (
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy || row.advertChecks.some((c) => c.level === "block")}
              onClick={() => step("submit", {}, `Sent to the ${row.approverLabel}.`)}
            >
              Send for approval
            </button>
          )}
          {(row.canAdvertApprove || row.canAdvertWithdraw) && (
            <input className="input" placeholder="Comment (needed)" aria-label="Job post comment" value={note} onChange={(e) => setNote(e.target.value)} />
          )}
          {row.canAdvertApprove && (
            <>
              <div className="small" style={{ flexBasis: "100%", color: "var(--warn, #b54708)" }}>
                Approving queues this wording for {a?.channels.join(", ")}. Once an account is connected and automatic posting is switched on, this exact wording goes out without another check.
                {row.approvingAsBackup ? " You are approving as the Regional OM backup." : ""}
              </div>
              <button className="btn btn-sm btn-primary" disabled={act.busy || !note.trim()} onClick={() => step("approve", { note }, "Approved. It is queued; nothing is posted until an account is connected.")}>
                Approve wording
              </button>
              <button className="btn btn-sm" disabled={act.busy || !note.trim()} onClick={() => step("return", { note }, "Sent back.")}>
                Send back
              </button>
            </>
          )}
          {row.canAdvertWithdraw && (
            <button className="btn btn-sm" disabled={act.busy || !note.trim()} onClick={() => step("withdraw", { note }, "Withdrawn.")}>
              Withdraw
            </button>
          )}
        </div>
      )}
      {!editing && row.canAdvertRecord && a && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <button className="btn btn-sm" onClick={() => void navigator.clipboard?.writeText(a.text)}>
            Copy the wording
          </button>
          <Select className="select" aria-label="Posted on" value={postChannel} onChange={(e) => setPostChannel(e.target.value)} style={{ width: "auto" }}>
            {a.channels.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value="whatsapp">WhatsApp group (no link)</option>
            <option value="notice_board">Notice board (no link)</option>
            <option value="other_place">Other place (no link)</option>
          </Select>
          {noLink ? (
            <input className="input" placeholder="Where: group or board name" aria-label="Where it was posted" value={where} onChange={(e) => setWhere(e.target.value)} />
          ) : (
            <input className="input" placeholder="https link to the post you made" aria-label="Post link" value={link} onChange={(e) => setLink(e.target.value)} />
          )}
          <button
            className="btn btn-sm"
            disabled={act.busy || (noLink ? where.trim().length < 3 : !link.startsWith("https://"))}
            onClick={() => step("record_posted", noLink ? { channel: postChannel, where } : { channel: postChannel, link }, "Recorded as posted by hand.")}
          >
            Record a post I made
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

type ApplicantStatus = "new" | "shortlisted" | "interview" | "offered" | "hired" | "rejected" | "withdrawn";
const APPLICANT_LABEL: Record<ApplicantStatus, string> = {
  new: "new",
  shortlisted: "shortlisted",
  interview: "interview",
  offered: "offered",
  hired: "hired",
  rejected: "not taken",
  withdrawn: "withdrew",
};
const SOURCES = ["facebook", "instagram", "linkedin", "tiktok", "jobstreet", "walk_in", "referral", "other"] as const;

/**
 * Applicants for one vacancy (Fauzan, 5 Nov 2026: HR only). Name and one way to reach them; no IC or CV kept here.
 * Hiring someone does not create a staff record: HR then uses the joining steps.
 */
function ApplicantList({ vacancyId, count, hired, headcount }: { vacancyId: string; count: number; hired: number; headcount: number }) {
  const [open, setOpen] = useState(false);
  const list = useLoad(() => (open ? api.applicants(vacancyId) : Promise.resolve(null)), [open, vacancyId]);
  const act = useAction();
  const [note, setNote] = useState<Record<string, string>>({});
  const [when, setWhen] = useState<Record<string, string>>({});
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10); // Malaysia date
  const [f, setF] = useState({ name: "", phone: "", email: "", source: "facebook" as (typeof SOURCES)[number], appliedOn: today });
  if (!open)
    return (
      <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setOpen(true)}>
        Applicants ({count}, {hired} of {headcount} hired)
      </button>
    );
  if (list.error) return <ErrorNotice error={list.error} />;
  if (!list.data) return <Loading what="applicants" />;
  const d = list.data;
  const step = (id: string, status: Exclude<ApplicantStatus, "new">, done: string) =>
    void act
      // datetime-local has no time zone: convert in the browser (Malaysia time) so the server stores the right moment.
      .run(() => api.applicantStep(id, status, note[id] ?? "", status === "interview" && when[id] ? new Date(when[id]).toISOString() : null), done)
      .then((r) => r && list.reload());
  return (
    <div className="card" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div style={{ fontWeight: 600 }}>Applicants</div>
        <Chip tone="neutral">HR only</Chip>
      </div>
      <div className="muted small">
        Keep only the name and a way to reach them. Hiring here does not make a staff record: use the joining steps after.
      </div>
      {d.rows.length === 0 && <div className="empty">No applicants yet.</div>}
      {d.rows.map((a) => (
        <div key={a.id} style={{ display: "flex", flexDirection: "column", gap: 4, borderTop: "1px solid var(--line, #eee)", paddingTop: 6 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 600 }}>{a.name}</div>
              <div className="muted small">
                {[a.phone, a.email].filter(Boolean).join(" · ")} · from {a.source.replace("_", " ")} · applied {a.appliedOn}
                {a.interviewAt ? ` · interview ${new Date(a.interviewAt).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" })}` : ""}
              </div>
            </div>
            <Chip tone={a.status === "hired" ? "ok" : a.status === "rejected" || a.status === "withdrawn" ? "neutral" : "info"}>
              {APPLICANT_LABEL[a.status]}
            </Chip>
          </div>
          {a.next.length > 0 && (
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <input
                className="input"
                placeholder="Comment (needed to refuse, offer or hire)"
                aria-label={`Comment on ${a.name}`}
                value={note[a.id] ?? ""}
                onChange={(e) => setNote((x) => ({ ...x, [a.id]: e.target.value }))}
              />
              {a.next.includes("interview") && (
                <input
                  className="input"
                  type="datetime-local"
                  aria-label={`Interview time for ${a.name}`}
                  value={when[a.id] ?? ""}
                  onChange={(e) => setWhen((x) => ({ ...x, [a.id]: e.target.value }))}
                  style={{ width: "auto" }}
                />
              )}
              {a.next.map((s) => (
                <button
                  key={s}
                  className={`btn btn-sm${s === "hired" || s === "offered" ? " btn-primary" : ""}`}
                  disabled={act.busy || (["rejected", "offered", "hired", "withdrawn"].includes(s) && !(note[a.id] ?? "").trim()) || (s === "interview" && !when[a.id])}
                  onClick={() => step(a.id, s as Exclude<ApplicantStatus, "new">, "Saved.")}
                >
                  {{ shortlisted: "Shortlist", interview: a.status === "interview" ? "Move interview" : "Set interview", offered: "Offer", hired: "Hired", rejected: "Not taken", withdrawn: "Withdrew", new: "" }[s]}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      {d.canAdd && (
        <div className="grid-2" style={{ marginTop: 6 }}>
          <input className="input" placeholder="Name" aria-label="Applicant name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input className="input" placeholder="Phone" aria-label="Applicant phone" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <input className="input" placeholder="Email" aria-label="Applicant email" inputMode="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <Select className="select" aria-label="Where they saw the post" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value as typeof f.source })}>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </Select>
          <input className="input" type="date" aria-label="Applied on" value={f.appliedOn} onChange={(e) => setF({ ...f, appliedOn: e.target.value })} />
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy || f.name.trim().length < 2 || (!f.phone.trim() && !f.email.trim())}
            onClick={async () => {
              const r = await act.run(() => api.addApplicant(vacancyId, f), "Added.");
              if (r) {
                setF({ name: "", phone: "", email: "", source: f.source, appliedOn: today });
                list.reload();
              }
            }}
          >
            Add applicant
          </button>
        </div>
      )}
      <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setOpen(false)}>
        Hide
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}
