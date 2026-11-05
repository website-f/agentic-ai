import { useState } from "react";
import { api } from "../api";
import { useApp } from "../App";
import {
  Chip,
  ErrorNotice,
  Loading,
  dateLabel,
  useAction,
  useLoad,
} from "../ui";

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

export function JoinLeavePanel() {
  const { me } = useApp();
  const hr = keepsHr(me.user);
  const b = useLoad(
    () => (hr ? api.hrJoinLeave() : Promise.resolve(null)),
    [hr],
  );
  const act = useAction();
  const [ref, setRef] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [ext, setExt] = useState<Record<string, string>>({});
  const [guide, setGuide] = useState<Awaited<
    ReturnType<typeof api.leavingGuide>
  > | null>(null);
  if (!hr) return null;
  if (b.error) return <ErrorNotice error={b.error} />;
  if (!b.data) return <Loading what="joining and leaving" />;
  const d = b.data;
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  const open = d.filings.filter((f) => !f.filed);
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Joining and leaving</h2>
          <div className="muted small">
            Filings show the latest day to file. Prima drafts and reminds; HR
            files with LHDN, KWSP and PERKESO and records the reference.
          </div>
        </div>
        <Chip
          tone={
            open.some((f) => f.overdue) ? "crit" : open.length ? "warn" : "ok"
          }
        >
          {open.length} to file
        </Chip>
      </div>
      {d.maternityGuard.map((p) => (
        <div key={p.personId} className="notice small" data-tone="crit">
          {p.name} ({p.staffNo}): termination recorded around maternity leave.
          Employment Act s.41A allows it only for misconduct, wilful breach or
          closure.
        </div>
      ))}
      <h3>Filings</h3>
      <div className="list">
        {d.filings.length === 0 && <div className="empty">Nothing due.</div>}
        {d.filings.map((f) => (
          <div
            key={f.id}
            className="list-item"
            style={{ flexWrap: "wrap", gap: 6 }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>
                {f.label} · {f.name ?? f.companyName}
              </div>
              <div className="muted small">
                {f.filed
                  ? `Filed ${dateLabel(f.filed.filedOn)}, reference ${f.filed.ref}, by ${f.filed.by}`
                  : `Latest by ${dateLabel(f.latestBy)}`}{" "}
                · {f.companyName}
                {f.kind === "EA" || f.kind === "BORANG_E"
                  ? ` · year ${f.period}`
                  : ""}
              </div>
            </div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {f.kind === "EA" && (
                <button
                  className="btn btn-sm"
                  disabled={act.busy}
                  onClick={() =>
                    void act
                      .run(() => api.eaDraft(f.companyId, f.period))
                      .then((r) => r && save(r))
                  }
                >
                  EA figures
                </button>
              )}
              {!f.filed && (
                <>
                  <Chip tone={f.overdue ? "crit" : "warn"}>
                    {f.overdue ? "late" : "due"}
                  </Chip>
                  <input
                    className="input"
                    style={{ width: 160 }}
                    placeholder="Reference"
                    aria-label={`Reference for ${f.label}`}
                    value={ref[f.id] ?? ""}
                    onChange={(e) =>
                      setRef((x) => ({ ...x, [f.id]: e.target.value }))
                    }
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
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      {d.probations.length > 0 && (
        <>
          <h3>Probation to confirm or extend</h3>
          <div className="list">
            {d.probations.map((p) => (
              <div
                key={p.personId}
                className="list-item"
                style={{
                  flexDirection: "column",
                  alignItems: "stretch",
                  gap: 6,
                }}
              >
                <div>
                  <span style={{ fontWeight: 600 }}>{p.name}</span> ({p.staffNo}
                  ) · {p.companyName} · ends {dateLabel(p.endsOn)}{" "}
                  {p.overdue && <Chip tone="crit">passed</Chip>}
                </div>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  <input
                    className="input"
                    placeholder="Comment (needed)"
                    aria-label={`Comment for ${p.name}`}
                    value={note[p.personId] ?? ""}
                    onChange={(e) =>
                      setNote((x) => ({ ...x, [p.personId]: e.target.value }))
                    }
                  />
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={act.busy || !(note[p.personId] ?? "").trim()}
                    onClick={() =>
                      void act
                        .run(
                          () =>
                            api.decideProbation(
                              p.personId,
                              "confirm",
                              null,
                              note[p.personId] ?? "",
                            ),
                          "Confirmed.",
                        )
                        .then(() => b.reload())
                    }
                  >
                    Confirm
                  </button>
                  <input
                    className="input"
                    type="date"
                    aria-label="New last day of probation"
                    value={ext[p.personId] ?? ""}
                    onChange={(e) =>
                      setExt((x) => ({ ...x, [p.personId]: e.target.value }))
                    }
                  />
                  <button
                    className="btn btn-sm"
                    disabled={
                      act.busy ||
                      !(note[p.personId] ?? "").trim() ||
                      !ext[p.personId]
                    }
                    onClick={() =>
                      void act
                        .run(
                          () =>
                            api.decideProbation(
                              p.personId,
                              "extend",
                              ext[p.personId],
                              note[p.personId] ?? "",
                            ),
                          "Probation extended.",
                        )
                        .then(() => b.reload())
                    }
                  >
                    Extend
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {d.retirements.length > 0 && (
        <>
          <h3>At or near retirement age ({d.rule.value.retireAge})</h3>
          <div className="list">
            {d.retirements.map((p) => (
              <div key={p.personId} className="list-item">
                <div>
                  {p.name} ({p.staffNo}) · {p.companyName} · age {p.age}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <Chip tone={p.over ? "crit" : "warn"}>
                    {p.over ? "over 60" : "soon"}
                  </Chip>
                  <button
                    className="btn btn-sm"
                    onClick={() =>
                      void act
                        .run(() => api.leavingGuide(p.personId))
                        .then((g) => g && setGuide(g))
                    }
                  >
                    Leaving guide
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {guide && (
        <div className="notice small" data-tone="info" style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 600 }}>
            Leaving guide: {guide.name}, {guide.years} years of service
          </div>
          <div>
            Notice under the Act: {guide.noticeWeeks} weeks. Termination
            benefit:{" "}
            {guide.benefit.eligible
              ? `${guide.benefit.daysPerYear} days a year, about RM${guide.benefit.amount.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`
              : "not due (under 12 months)"}
            .
          </div>
          <ol style={{ margin: "6px 0 0 18px" }}>
            {guide.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <button className="btn btn-sm" onClick={() => setGuide(null)}>
            Close
          </button>
        </div>
      )}
      <h3>Register of employees</h3>
      <p className="muted small">
        Kept {d.rule.value.keepYears} years after a staff member leaves. Take it
        per employer.
      </p>
      <RegisterButtons />
      <ErrorNotice error={act.error} />
    </section>
  );
}

function RegisterButtons() {
  const { me } = useApp();
  const act = useAction();
  const [cid, setCid] = useState("pwvsb");
  const companies = me.companies ?? [];
  return (
    <div className="row" style={{ gap: 6 }}>
      <select
        className="select"
        value={cid}
        onChange={(e) => setCid(e.target.value)}
        aria-label="Employer"
      >
        <option value="pwvsb">PWVSB (central)</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button
        className="btn btn-sm"
        disabled={act.busy}
        onClick={() =>
          void act
            .run(() => api.employeeRegister(cid))
            .then((r) => r && save(r))
        }
      >
        Download register
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

/** Vacancies: HR or the company manager raises; the CEO approves; the company head signs (Fauzan, 2 Nov 2026). */
export function VacanciesPanel() {
  const { me } = useApp();
  const u = me.user;
  const allowed =
    keepsHr(u) || u.opsTier === "ceo" || u.role === "company_manager";
  const list = useLoad(
    () => (allowed ? api.vacancies() : Promise.resolve(null)),
    [allowed],
  );
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
  });
  if (!allowed) return null;
  if (list.error) return <ErrorNotice error={list.error} />;
  if (!list.data) return <Loading what="vacancies" />;
  const d = list.data;
  const step = (
    id: string,
    action: "ceo_approve" | "ceo_refuse" | "sign" | "close",
    done: string,
  ) =>
    void act
      .run(() => api.vacancyStep(id, action, note[id] ?? ""), done)
      .then(() => list.reload());
  const companies = me.companies ?? [];
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Vacancies</h2>
          <div className="muted small">
            The CEO approves a vacancy, then the company head signs the
            approval. Every step needs a comment.
          </div>
        </div>
        <Chip tone="info">
          {d.rows.filter((r) => r.status === "open").length} open
        </Chip>
      </div>
      <div className="list">
        {d.rows.length === 0 && <div className="empty">No vacancies.</div>}
        {d.rows.slice(0, 30).map((r) => (
          <div
            key={r.id}
            className="list-item"
            style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}
          >
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 600 }}>
                  {r.headcount} x {r.title} · {r.companyName}
                </div>
                <div className="muted small">
                  {r.reason}
                  {r.payFrom
                    ? ` · RM${r.payFrom}${r.payTo ? ` to RM${r.payTo}` : ""}`
                    : ""}{" "}
                  · raised by {r.raisedBy}
                  {r.ceo
                    ? ` · CEO ${r.ceo.approve ? "approved" : "refused"}: ${r.ceo.note}`
                    : ""}
                  {r.head ? ` · signed by ${r.head.by}: ${r.head.note}` : ""}
                </div>
              </div>
              <Chip
                tone={
                  r.status === "open" || r.status === "filled"
                    ? "ok"
                    : r.status === "refused" || r.status === "cancelled"
                      ? "neutral"
                      : "warn"
                }
              >
                {
                  {
                    waiting_ceo: "waiting for the CEO",
                    waiting_head: "waiting for the company head",
                    open: "open",
                    refused: "refused",
                    filled: "filled",
                    cancelled: "cancelled",
                  }[r.status]
                }
              </Chip>
            </div>
            {(r.canCeo || r.canSign || r.canClose) && (
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <input
                  className="input"
                  placeholder="Comment (needed)"
                  aria-label={`Comment on ${r.title}`}
                  value={note[r.id] ?? ""}
                  onChange={(e) =>
                    setNote((x) => ({ ...x, [r.id]: e.target.value }))
                  }
                />
                {r.canCeo && (
                  <>
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={act.busy || !(note[r.id] ?? "").trim()}
                      onClick={() => step(r.id, "ceo_approve", "Approved.")}
                    >
                      Approve
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={act.busy || !(note[r.id] ?? "").trim()}
                      onClick={() => step(r.id, "ceo_refuse", "Refused.")}
                    >
                      Refuse
                    </button>
                  </>
                )}
                {r.canSign && (
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={act.busy || !(note[r.id] ?? "").trim()}
                    onClick={() => step(r.id, "sign", "Signed.")}
                  >
                    Sign the approval
                  </button>
                )}
                {r.canClose && (
                  <button
                    className="btn btn-sm"
                    disabled={act.busy || !(note[r.id] ?? "").trim()}
                    onClick={() =>
                      step(
                        r.id,
                        "close",
                        r.status === "open" ? "Marked filled." : "Cancelled.",
                      )
                    }
                  >
                    {r.status === "open" ? "Mark filled" : "Cancel"}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {d.canRaise && !raising && (
        <button
          className="btn btn-sm"
          style={{ alignSelf: "flex-start", marginTop: 8 }}
          onClick={() => setRaising(true)}
        >
          Raise a vacancy
        </button>
      )}
      {raising && (
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
              <span className="label">Employer</span>
              <select
                className="select"
                value={f.companyId}
                onChange={(e) => setF({ ...f, companyId: e.target.value })}
                aria-label="Employer"
              >
                {keepsHr(u) && <option value="pwvsb">PWVSB (central)</option>}
                {companies
                  .filter((c) => keepsHr(u) || u.companyIds.includes(c.id))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span className="label">Job title</span>
              <input
                className="input"
                value={f.title}
                onChange={(e) => setF({ ...f, title: e.target.value })}
                aria-label="Job title"
              />
            </label>
            <label className="field">
              <span className="label">Department</span>
              <input
                className="input"
                value={f.department}
                onChange={(e) => setF({ ...f, department: e.target.value })}
                aria-label="Department"
              />
            </label>
            <label className="field">
              <span className="label">How many</span>
              <input
                className="input"
                inputMode="numeric"
                value={f.headcount}
                onChange={(e) => setF({ ...f, headcount: e.target.value })}
                aria-label="How many"
              />
            </label>
            <label className="field">
              <span className="label">Pay from (RM a month)</span>
              <input
                className="input"
                inputMode="decimal"
                value={f.payFrom}
                onChange={(e) => setF({ ...f, payFrom: e.target.value })}
                aria-label="Pay from"
              />
            </label>
            <label className="field">
              <span className="label">Pay to (RM a month)</span>
              <input
                className="input"
                inputMode="decimal"
                value={f.payTo}
                onChange={(e) => setF({ ...f, payTo: e.target.value })}
                aria-label="Pay to"
              />
            </label>
          </div>
          <input
            className="input"
            placeholder="Why the post is needed"
            aria-label="Why the post is needed"
            value={f.reason}
            onChange={(e) => setF({ ...f, reason: e.target.value })}
          />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-primary"
              disabled={
                act.busy ||
                f.title.trim().length < 3 ||
                f.reason.trim().length < 5 ||
                !/^\d+$/.test(f.headcount)
              }
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
            <button className="btn" onClick={() => setRaising(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}
