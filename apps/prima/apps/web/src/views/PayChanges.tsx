import { useState } from "react";
import { api, type PayChangesData } from "../api";
import {
  Chip,
  ErrorNotice,
  Loading,
  dateLabel,
  dateTimeLabel,
  useAction,
  useLoad,
} from "../ui";

const rm = (n: number | null) =>
  n == null ? "none" : `RM${n.toLocaleString("en-MY")}`;

/**
 * Basic pay changes (Fauzan, 27 Oct 2026: "need CoS verify"). HR sets the pay on the staff form; it takes effect only
 * when the HR Director, the Chief of Staff or Deputy, verifies it. HR follows its requests here.
 */
export function PayChangesPanel() {
  const { data, error } = useLoad(() => api.payChanges(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="pay changes" />;
  const pending = data.rows.filter((r) => r.change.status === "pending");
  const mine = pending.filter((r) => r.mine).length;
  const recent = data.rows
    .filter((r) => r.change.status !== "pending")
    .slice(0, 5);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Pay and salary account changes to verify</h2>
        <Chip tone={mine ? "warn" : pending.length ? "info" : "ok"}>
          {mine ? `${mine} for you` : `${pending.length} waiting`}
        </Chip>
      </div>
      <div className="list">
        {pending.length === 0 && (
          <div className="empty">No pay change is waiting.</div>
        )}
        {pending.map((r) => (
          <PayRow key={r.change.id} r={r} canVerify={data.canVerify} />
        ))}
        {recent.map((r) => (
          <PayRow key={r.change.id} r={r} canVerify={false} />
        ))}
      </div>
      <div className="muted small" style={{ padding: "8px 12px" }}>
        HR sets the pay or salary account on the staff form. The current pay
        stays until the Chief of Staff or Deputy verifies it (the Vice Chairman
        for their own pay). A new salary account is used only after the HR
        Director and Finance both check it, and the staff member is told. Nobody
        verifies their own request or their own record.
      </div>
    </section>
  );
}

function PayRow({
  r,
  canVerify,
}: {
  r: PayChangesData["rows"][number];
  canVerify: boolean;
}) {
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const act = useAction();
  const c = r.change;
  const decide = (verify: boolean) =>
    act.run(
      () => api.decidePayChange(c.id, verify, note),
      verify
        ? c.kind === "BANK"
          ? "Checked. The new account is used once both checks are done."
          : "Verified. The new pay is on the record."
        : "Rejected.",
    );
  return (
    <div
      className="list-item"
      style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}
    >
      <div
        className="row"
        style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}
      >
        <div>
          <div style={{ fontWeight: 600 }}>
            {r.person?.name ?? c.personId} ·{" "}
            {c.kind === "BANK"
              ? `salary account ${c.bankFrom ? `${c.bankFrom.bank} ${c.bankFrom.accountMasked}` : "none"} to ${c.bankTo ? `${c.bankTo.bank} ${c.bankTo.accountMasked}` : "none"}`
              : `${rm(c.from)} to ${rm(c.to)}`}
          </div>
          <div className="muted small">
            {r.person
              ? `${r.person.staffNo} · ${r.person.jobTitle ?? ""} · `
              : ""}
            {r.companyName} · from {dateLabel(c.effectiveOn)}
          </div>
          <div className="small">{c.reason}</div>
          <div className="muted small">
            Asked {dateTimeLabel(c.requestedAt)} by {c.requestedBy}
            {c.hrDirectorCheck ? ` · HR Director: ${c.hrDirectorCheck.by}` : ""}
            {c.financeCheck ? ` · Finance: ${c.financeCheck.by}` : ""}
            {c.decidedBy
              ? ` · ${c.status} by ${c.decidedBy}${c.note ? `: ${c.note}` : ""}`
              : ""}
          </div>
        </div>
        <Chip
          tone={
            c.status === "pending"
              ? "warn"
              : c.status === "verified"
                ? "ok"
                : "crit"
          }
        >
          {c.status === "pending"
            ? `With ${r.waitingOn}`
            : c.status === "verified"
              ? "Verified"
              : "Rejected"}
        </Chip>
      </div>
      {canVerify && r.mine && !open && (
        <div>
          <button className="btn btn-sm" onClick={() => setOpen(true)}>
            Verify
          </button>
        </div>
      )}
      {canVerify && r.mine && open && (
        <>
          <input
            className="input"
            aria-label="Verification note"
            placeholder="Note (required to reject)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <ErrorNotice error={act.error} />
          <div className="row">
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy}
              onClick={() => decide(true)}
            >
              Verify
            </button>
            <button
              className="btn btn-sm"
              disabled={act.busy}
              onClick={() => decide(false)}
            >
              Reject
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
