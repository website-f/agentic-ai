import { useState } from "react";
import { api } from "../api";
import { Card, Empty } from "../kit";
import { Chip, ErrorNotice, Loading, dateLabel, useAction, useLoad } from "../ui";
import "../styles/hrx.css";

/**
 * Staff movement (Fauzan, 3 Nov 2026): promotion (naik pangkat), transfer to another group company, and secondment.
 * HR prepares; each step approves or refuses with a comment. After the last approval nothing changes on the staff record
 * until the effective date; HR or the CEO applies it on the day (Arisha main review, 3 Nov 2026).
 * - Promotion: HR Director, then CEO, then the Vice Chairman consents.
 * - Transfer: the receiving company head accepts, then the HR Director. A new employment at the new company (fresh
 *   leave and service by law); the HR record keeps when the person first started in the group.
 * - Secondment: the host company head, the HR Director, then the CEO consents. The employer does not change.
 */
const KIND = { promotion: "Promotion (naik pangkat)", transfer: "Transfer to another company", secondment: "Secondment" } as const;
type Kind = keyof typeof KIND;

export function StaffMovementPanel({ onlyIfAny = false }: { onlyIfAny?: boolean } = {}) {
  const list = useLoad(() => api.staffMovements().catch(() => null), []);
  const act = useAction();
  const [note, setNote] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const blank = { personId: "", kind: "promotion" as Kind, toCompanyId: "", effectiveOn: "", reason: "", jobTitle: "", department: "", reportsTo: "", basicPay: "", branchId: "", staffNo: "", until: "" };
  const [f, setF] = useState(blank);
  if (list.error) return <ErrorNotice error={list.error} />;
  if (list.loading && !list.data) return <Loading what="staff movements" />;
  const d = list.data;
  if (!d || (onlyIfAny && !d.rows.length && !d.canPrepare)) return null;
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const person = d.prep?.staff.find((s) => s.id === f.personId);
  const target = d.prep?.employers.find((c) => c.id === f.toCompanyId);
  const step = (id: string, approve: boolean) =>
    void act.run(() => api.staffMovementStep(id, approve, note[id] ?? ""), approve ? "Approved." : "Refused.").then(() => list.reload());
  const statusText = (r: (typeof d.rows)[number]) =>
    r.status === "waiting"
      ? `waiting for ${r.waitingOn}`
      : r.status === "approved"
        ? r.due
          ? "approved, due to apply"
          : `approved, takes effect ${dateLabel(r.effectiveOn)}`
        : r.status === "done" && r.applied
          ? `applied ${dateLabel(r.applied.at.slice(0, 10))}`
          : r.status;
  const showApply = d.rows.some((r) => r.canApply) || (d.allowancesDue ?? 0) > 0;
  return (
    <Card
      flush
      title="Staff movement"
      sub="Promotion: HR Director, CEO, then Vice Chairman consent. Transfer: the receiving company head, then the HR Director. Secondment: the host company head, the HR Director, then the CEO. Every step needs a comment. Once approved, nothing changes until the date it takes effect."
      actions={
        showApply || (d.canPrepare && !open) ? (
          <>
            {showApply && (
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy}
                onClick={async () => {
                  const r = await act.run(() => api.applyDueStaffMovements(), "Done. Anything that could not be applied shows the reason below.");
                  if (r) list.reload();
                }}
              >
                {(d.allowancesDue ?? 0) > 0 ? `Apply changes due today (${d.allowancesDue} allowance${d.allowancesDue === 1 ? "" : "s"})` : "Apply movements due today"}
              </button>
            )}
            {d.canPrepare && !open && (
              <button className="btn btn-sm" onClick={() => setOpen(true)}>
                New movement
              </button>
            )}
          </>
        ) : undefined
      }
    >
      {open && d.prep && (
        <div className="hp-section">
          <div className="hx-form">
            <h3 className="hx-form-title">New movement</h3>
            <div className="hx-form-grid">
              <label className="field">
                <span className="label">Staff member</span>
                <select className="select" aria-label="Staff member" value={f.personId} onChange={set("personId")}>
                  <option value="">Choose</option>
                  {d.prep.staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.staffNo} · {s.companyName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="label">Movement</span>
                <select className="select" aria-label="Movement" value={f.kind} onChange={set("kind")}>
                  {(Object.keys(KIND) as Kind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND[k]}
                    </option>
                  ))}
                </select>
              </label>
              {f.kind !== "promotion" && (
                <label className="field">
                  <span className="label">{f.kind === "transfer" ? "New company" : "Host company"}</span>
                  <select className="select" aria-label="Other company" value={f.toCompanyId} onChange={set("toCompanyId")}>
                    <option value="">Choose</option>
                    {d.prep.employers
                      .filter((c) => c.id !== person?.companyId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <label className="field">
                <span className="label">Takes effect on</span>
                <input className="input" type="date" aria-label="Takes effect on" value={f.effectiveOn} onChange={set("effectiveOn")} />
              </label>
              {f.kind === "secondment" && (
                <label className="field">
                  <span className="label">Last day of secondment</span>
                  <input className="input" type="date" aria-label="Last day of secondment" value={f.until} onChange={set("until")} />
                </label>
              )}
              {f.kind === "transfer" && (
                <>
                  <label className="field">
                    <span className="label">Branch at the new company</span>
                    <select className="select" aria-label="New branch" value={f.branchId} onChange={set("branchId")}>
                      <option value="">Choose</option>
                      {(target?.branches ?? []).map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span className="label">Staff number at the new company</span>
                    <input className="input mono" aria-label="New staff number" value={f.staffNo} onChange={set("staffNo")} />
                  </label>
                </>
              )}
              {f.kind !== "secondment" && (
                <>
                  <label className="field">
                    <span className="label">New job title {f.kind === "transfer" ? "(blank keeps it)" : ""}</span>
                    <input className="input" aria-label="New job title" value={f.jobTitle} onChange={set("jobTitle")} placeholder={person?.jobTitle} />
                  </label>
                  <label className="field">
                    <span className="label">New department (blank keeps it)</span>
                    <input className="input" aria-label="New department" value={f.department} onChange={set("department")} />
                  </label>
                  <label className="field">
                    <span className="label">Reports to (blank keeps it)</span>
                    <input className="input" aria-label="Reports to" value={f.reportsTo} onChange={set("reportsTo")} />
                  </label>
                  <label className="field">
                    <span className="label">New basic pay, RM a month (blank keeps it)</span>
                    <input className="input" inputMode="decimal" aria-label="New basic pay" value={f.basicPay} onChange={set("basicPay")} />
                  </label>
                </>
              )}
              <label className="field hx-form-wide">
                <span className="label">Reason</span>
                <input className="input" aria-label="Movement reason" value={f.reason} onChange={set("reason")} placeholder="e.g. promotion letter, request from the other company" />
              </label>
            </div>
            {f.kind === "transfer" && (
              <p className="notice small" data-tone="info">
                By law the new company is a new employment: leave and service start again there. The HR record keeps when they first joined the group. The
                full IC and salary account move behind the HR wall. A new pay at the new company goes through the usual pay change.
              </p>
            )}
            <ErrorNotice error={act.error} />
            <div className="hx-form-actions">
              <button
                className="btn btn-primary btn-sm"
                disabled={act.busy || !f.personId || !f.effectiveOn || f.reason.trim().length < 5}
                onClick={async () => {
                  const r = await act.run(
                    () =>
                      api.prepareStaffMovement({
                        personId: f.personId,
                        kind: f.kind,
                        toCompanyId: f.kind === "promotion" ? null : f.toCompanyId || null,
                        effectiveOn: f.effectiveOn,
                        reason: f.reason,
                        jobTitle: f.jobTitle || null,
                        department: f.department || null,
                        reportsTo: f.reportsTo || null,
                        basicPay: f.basicPay.trim() ? Number(f.basicPay) : null,
                        branchId: f.branchId || null,
                        staffNo: f.staffNo || null,
                        until: f.until || null,
                      }),
                    "Sent for approval. Nothing changes on the staff record before the date it takes effect.",
                  );
                  if (r) {
                    setOpen(false);
                    setF(blank);
                    list.reload();
                  }
                }}
              >
                Send for approval
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => (setOpen(false), setF(blank))}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {!open && act.error && (
        <div className="hp-section">
          <ErrorNotice error={act.error} />
        </div>
      )}
      {d.rows.length === 0 && <Empty title="No staff movements." />}
      {d.rows.length > 0 && (
        <ul className="hx-rows">
          {d.rows.slice(0, 30).map((r) => (
            <li key={r.id} className="hx-row" data-tone={r.applyError ? "crit" : undefined}>
              <div className="hx-row-main">
                <span className="hx-row-title">
                  {r.personName} · {KIND[r.kind]}
                  {r.kind !== "promotion" ? ` · ${r.fromName} to ${r.toName}` : ""}
                </span>
                <span className="hx-row-meta">
                  From {dateLabel(r.effectiveOn)}
                  {r.until ? ` until ${dateLabel(r.until)}` : ""}
                  {r.post.jobTitle ? ` · ${r.post.jobTitle}` : ""}
                  {r.post.basicPay ? ` · RM${r.post.basicPay}` : ""}
                  {r.post.staffNo ? ` · new no. ${r.post.staffNo}` : ""} · {r.reason} · by {r.preparedBy}
                </span>
              </div>
              <div className="hx-row-side">
                <Chip tone={r.status === "done" ? "ok" : r.applyError ? "crit" : r.status === "waiting" || r.status === "approved" ? "warn" : "neutral"}>{statusText(r)}</Chip>
              </div>
              {(r.steps.length > 0 || r.login || r.applyError || r.canAuthoriseLogin || r.canAct || r.canCancel) && (
                <div className="hx-row-body">
                  {r.steps.length > 0 && (
                    <ol className="hp-history" aria-label="Approvals">
                      {r.steps.map((x, i) => (
                        <li key={i} data-tone={x.approve ? "ok" : "crit"}>
                          {x.approve ? "Approved" : "Refused"} by {x.by}
                          {x.standIn ? ` (standing in for the ${x.role === "hr_director" ? "HR Director" : "Vice Chairman"}, pilot)` : ""}: {x.note}
                        </li>
                      ))}
                    </ol>
                  )}
                  {r.login && (
                    <p className="hx-row-text">
                      Login:{" "}
                      {r.login.status === "to_authorise"
                        ? "still points to the old record; the HR Director or the CEO authorises moving it"
                        : r.login.status === "authorised"
                          ? `move authorised by ${r.login.authorisedBy}; IT moves it through the account process, then confirms on the IT page`
                          : r.login.status === "refused"
                            ? `move refused by ${r.login.authorisedBy}: ${r.login.note}`
                            : `moved to the new company, confirmed by ${r.login.doneBy}`}
                    </p>
                  )}
                  {r.applyError && (
                    <p className="notice small" data-tone="crit">
                      Not applied yet: {r.applyError.message}
                    </p>
                  )}
                  {r.canAuthoriseLogin && (
                    <div className="hp-inline">
                      <input
                        className="input"
                        placeholder="Comment (needed)"
                        aria-label={`Login comment for ${r.personName}`}
                        value={note[`login-${r.id}`] ?? ""}
                        onChange={(e) => setNote((x) => ({ ...x, [`login-${r.id}`]: e.target.value }))}
                      />
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={act.busy || !(note[`login-${r.id}`] ?? "").trim()}
                        onClick={() => void act.run(() => api.authoriseMovementLogin(r.id, true, note[`login-${r.id}`] ?? ""), "Authorised. IT moves the login next.").then(() => list.reload())}
                      >
                        Authorise login move
                      </button>
                      <button
                        className="btn btn-sm"
                        disabled={act.busy || !(note[`login-${r.id}`] ?? "").trim()}
                        onClick={() => void act.run(() => api.authoriseMovementLogin(r.id, false, note[`login-${r.id}`] ?? ""), "Refused.").then(() => list.reload())}
                      >
                        Refuse
                      </button>
                    </div>
                  )}
                  {(r.canAct || r.canCancel) && (
                    <div className="hp-inline">
                      <input
                        className="input"
                        placeholder="Comment (needed)"
                        aria-label={`Comment on ${r.personName} movement`}
                        value={note[r.id] ?? ""}
                        onChange={(e) => setNote((x) => ({ ...x, [r.id]: e.target.value }))}
                      />
                      {r.canAct && (
                        <>
                          <button className="btn btn-sm btn-primary" disabled={act.busy || !(note[r.id] ?? "").trim()} onClick={() => step(r.id, true)}>
                            {r.standIn ? "Approve (standing in)" : "Approve"}
                          </button>
                          <button className="btn btn-sm" disabled={act.busy || !(note[r.id] ?? "").trim()} onClick={() => step(r.id, false)}>
                            Refuse
                          </button>
                        </>
                      )}
                      {r.canCancel && (
                        <button
                          className="btn btn-sm btn-ghost"
                          disabled={act.busy || !(note[r.id] ?? "").trim()}
                          onClick={() => void act.run(() => api.cancelStaffMovement(r.id, note[r.id] ?? ""), "Cancelled.").then(() => list.reload())}
                        >
                          Cancel movement
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
