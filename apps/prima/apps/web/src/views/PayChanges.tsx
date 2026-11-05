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
 * when the HR Director, the Chief of Staff or Deputy, verifies it and then the Vice Chairman consents to the amount
 * (Fauzan, 1 Nov 2026: salary amounts set each year or on review). Every check needs a comment.
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
  const consent = r.as === "vice_chairman";
  const decide = (verify: boolean) =>
    act.run(
      () => api.decidePayChange(c.id, verify, note),
      verify
        ? c.kind === "BANK"
          ? "Checked. The new account is used once both checks are done."
          : consent
            ? c.kind === "ALLOWANCE"
              ? "Consented. The new allowances are on the record."
              : "Consented. The new pay is on the record."
            : "Verified. It now waits for the Vice Chairman's consent."
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
              : c.kind === "ALLOWANCE"
                ? `monthly allowances ${rm(c.from)} to ${rm(c.to)} a month`
                : `${rm(c.from)} to ${rm(c.to)}`}
          </div>
          <div className="muted small">
            {r.person
              ? `${r.person.staffNo} · ${r.person.jobTitle ?? ""} · `
              : ""}
            {r.companyName} · from {dateLabel(c.effectiveOn)}
          </div>
          {c.kind === "ALLOWANCE" && (
            <div className="small">
              Now: {(c.allowancesFrom ?? []).map((a) => `${a.label} ${rm(a.amount)}`).join(", ") || "none"}. New:{" "}
              {(c.allowancesTo ?? []).map((a) => `${a.label} ${rm(a.amount)}`).join(", ") || "none"}.
            </div>
          )}
          <div className="small">{c.reason}</div>
          <div className="muted small">
            Asked {dateTimeLabel(c.requestedAt)} by {c.requestedBy}
            {c.hrDirectorCheck
              ? ` · HR Director: ${c.hrDirectorCheck.by}${c.hrDirectorCheck.note ? ` (${c.hrDirectorCheck.note})` : ""}`
              : ""}
            {c.vcConsent ? ` · Vice Chairman: ${c.vcConsent.by}` : ""}
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
              ? c.applied === null
                ? `Consented, takes effect ${c.effectiveOn}`
                : "Verified"
              : "Rejected"}
        </Chip>
      </div>
      {canVerify && r.mine && !open && (
        <div>
          <button className="btn btn-sm" onClick={() => setOpen(true)}>
            {consent ? "Consent" : "Verify"}
          </button>
        </div>
      )}
      {canVerify && r.mine && open && (
        <>
          <input
            className="input"
            aria-label="Verification note"
            placeholder="Comment (needed to verify or reject; a short one is fine to verify)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <ErrorNotice error={act.error} />
          <div className="row">
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !note.trim()}
              onClick={() => decide(true)}
            >
              {consent ? "Consent" : "Verify"}
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
