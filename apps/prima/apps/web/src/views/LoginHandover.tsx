import { useState } from "react";
import { api } from "../api";
import { Chip, ErrorNotice, dateLabel, useAction, useLoad } from "../ui";

/**
 * Login handovers after a transfer (Arisha main review, 3 Nov 2026): IT's view of which accounts must move to the new
 * company once the HR Director (or the CEO) has authorised it. It shows no pay, no reasons and no staff record detail.
 * Prima does not change accounts: IT does it through the approved account process, then confirms here, and Prima checks
 * the account points to the new record, reaches the new company and no longer reaches the old one.
 */
export function LoginHandoverPanel() {
  const list = useLoad(() => api.loginHandovers().catch(() => null), []);
  const act = useAction();
  const [note, setNote] = useState<Record<string, string>>({});
  const rows = (list.data?.rows ?? []).filter((r) => r.status !== "refused");
  if (!rows.length) return null;
  return (
    <section className="panel" aria-label="Login handovers">
      <div className="panel-head">
        <div>
          <h2>Login handovers after a transfer</h2>
          <div className="muted small">
            Move each account to the new company through the approved account process, then confirm. Prima checks the account before it accepts.
          </div>
        </div>
      </div>
      <ErrorNotice error={act.error} />
      <div className="list">
        {rows.map((r) => (
          <div key={r.id} className="list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
            <div className="row" style={{ justifyContent: "space-between", gap: 6, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 600 }}>{r.personName}</div>
                <div className="muted small">
                  {r.fromCompanyName} to {r.toCompanyName} from {dateLabel(r.effectiveOn)} · account{r.accounts.length === 1 ? "" : "s"}:{" "}
                  {r.accounts.map((a) => `${a.name} (${a.userId})`).join(", ")}
                </div>
                {r.authorised && <div className="muted small">Authorised by {r.authorised.by}</div>}
                {r.done && <div className="muted small">Confirmed by {r.done.by}</div>}
              </div>
              <Chip tone={r.status === "done" ? "ok" : "warn"}>
                {r.status === "to_authorise" ? "waiting for authorisation" : r.status === "authorised" ? "to move" : "done"}
              </Chip>
            </div>
            {r.canConfirm && (
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <input
                  className="input"
                  placeholder="What was changed (needed)"
                  aria-label={`Handover note for ${r.personName}`}
                  value={note[r.id] ?? ""}
                  onChange={(e) => setNote((x) => ({ ...x, [r.id]: e.target.value }))}
                />
                <button
                  className="btn btn-sm btn-primary"
                  disabled={act.busy || !(note[r.id] ?? "").trim()}
                  onClick={() => void act.run(() => api.confirmMovementLogin(r.movementId, note[r.id] ?? ""), "Confirmed.").then(() => list.reload())}
                >
                  Confirm login moved
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
