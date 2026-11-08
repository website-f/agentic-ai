import { Select } from '../SearchSelect';
import { useState } from "react";
import {
  DILIGENCE_CHECK_LABEL,
  DILIGENCE_RESULT_LABEL,
  type DiligenceCheckKind,
} from "@prima/core";
import { api } from "../api";
import {
  Chip,
  ErrorNotice,
  Loading,
  dateLabel,
  useAction,
  useLoad,
} from "../ui";

const todayMyt = () =>
  new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

/**
 * Client due diligence on the client file, assignment instructions per site on the contract, and the guard's own site
 * instructions on the Duty screen (PIKM/ISO review, Fauzan 5 Nov 2026). The mobilisation checklist checks both itself.
 */
const STATUS_TONE = {
  pending: "warn",
  clear: "ok",
  concern: "crit",
  not_needed: "info",
} as const;
const STATUS_LABEL = {
  pending: "to do",
  clear: "clear",
  concern: "concern",
  not_needed: "not needed",
} as const;

export function DiligenceSection({ accountId }: { accountId: string }) {
  const b = useLoad(
    () => api.clientDiligence(accountId).catch(() => null),
    [accountId],
  );
  const act = useAction();
  const [f, setF] = useState<Record<string, string>>({});
  const v = (k: string) => f[k] ?? "";
  const set = (k: string, x: string) => setF((o) => ({ ...o, [k]: x }));
  if (!b.data) return b.loading ? <Loading what="due diligence" /> : null;
  const d = b.data;
  const dd = d.diligence;
  const run = (
    action: "start" | "check" | "decide",
    body: Record<string, unknown>,
    ok: string,
    reset: string[],
  ) =>
    void act
      .run(() => api.clientDiligenceAct(accountId, action, body), ok)
      .then(
        (r) =>
          r &&
          (setF((o) => ({
            ...o,
            ...Object.fromEntries(reset.map((k) => [k, ""])),
          })),
          b.reload()),
      );
  return (
    <section className="small">
      <h4>Client due diligence</h4>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <Chip
          tone={
            d.state.ok ? "ok" : d.state.state === "declined" ? "crit" : "warn"
          }
        >
          {d.state.state === "none"
            ? "not started"
            : d.state.state === "open"
              ? "in progress"
              : d.state.state === "declined"
                ? "declined"
                : d.state.state === "due"
                  ? "review overdue"
                  : "accepted"}
        </Chip>
        <span className="muted">{d.state.detail}</span>
        {dd?.reviewDueOn &&
          dd.decision &&
          dd.decision.result !== "declined" && (
            <span className="muted">Review by {dateLabel(dd.reviewDueOn)}</span>
          )}
      </div>
      {dd && (
        <div className="table-wrap" style={{ marginTop: 6 }}>
          <table className="table small">
            <tbody>
              {dd.checks.map((k) => (
                <tr key={k.kind}>
                  <td>{DILIGENCE_CHECK_LABEL[k.kind]}</td>
                  <td>
                    <Chip tone={STATUS_TONE[k.status]}>
                      {STATUS_LABEL[k.status]}
                    </Chip>
                    {k.note && <div className="muted">{k.note}</div>}
                  </td>
                  <td>{k.ref}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dd?.decision && (
        <div style={{ marginTop: 4 }}>
          {DILIGENCE_RESULT_LABEL[dd.decision.result]} by {dd.decision.by}:{" "}
          {dd.decision.note}
          {dd.decision.conditions && (
            <div>Conditions: {dd.decision.conditions}</div>
          )}
        </div>
      )}
      {d.can.start && (
        <button
          className="btn btn-sm"
          style={{ marginTop: 6 }}
          disabled={act.busy}
          onClick={() => run("start", {}, "Due diligence opened.", [])}
        >
          {dd ? "Start the review again" : "Start due diligence"}
        </button>
      )}
      {d.can.work && dd && (
        <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <Select
              className="input"
              aria-label="Check"
              value={v("kind")}
              onChange={(e) => set("kind", e.target.value)}
            >
              <option value="">Record a check…</option>
              {dd.checks.map((k) => (
                <option key={k.kind} value={k.kind}>
                  {DILIGENCE_CHECK_LABEL[k.kind]}
                </option>
              ))}
            </Select>
            <select
              className="input"
              aria-label="Result"
              value={v("status") || "clear"}
              onChange={(e) => set("status", e.target.value)}
            >
              <option value="clear">Clear</option>
              <option value="concern">Concern</option>
              <option value="not_needed">Not needed</option>
              <option value="pending">Back to to-do</option>
            </select>
          </div>
          <input
            className="input"
            placeholder="Reference: search result, letter or where it is filed"
            aria-label="Reference"
            value={v("ref")}
            onChange={(e) => set("ref", e.target.value)}
          />
          <input
            className="input"
            placeholder="Note (needed for a concern or not needed)"
            aria-label="Check note"
            value={v("note")}
            onChange={(e) => set("note", e.target.value)}
          />
          <div>
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy || !v("kind")}
              onClick={() =>
                run(
                  "check",
                  {
                    kind: v("kind") as DiligenceCheckKind,
                    status: v("status") || "clear",
                    ref: v("ref"),
                    note: v("note"),
                  },
                  "Check recorded.",
                  ["kind", "ref", "note"],
                )
              }
            >
              Save check
            </button>
          </div>
        </div>
      )}
      {d.can.decide && (
        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
          <b>Your decision</b>
          {d.open.length > 0 && (
            <div className="muted">
              Still open:{" "}
              {d.open.map((k) => DILIGENCE_CHECK_LABEL[k]).join("; ")}
            </div>
          )}
          <Select
            className="input"
            aria-label="Decision"
            value={v("result")}
            onChange={(e) => set("result", e.target.value)}
          >
            <option value="">Choose…</option>
            {d.open.length === 0 && d.concerns.length === 0 && (
              <option value="accepted">
                {DILIGENCE_RESULT_LABEL.accepted}
              </option>
            )}
            {d.open.length === 0 && (
              <option value="accepted_conditions">
                {DILIGENCE_RESULT_LABEL.accepted_conditions}
              </option>
            )}
            <option value="declined">{DILIGENCE_RESULT_LABEL.declined}</option>
          </Select>
          <input
            className="input"
            placeholder="Reason for the decision"
            aria-label="Decision reason"
            value={v("reason")}
            onChange={(e) => set("reason", e.target.value)}
          />
          {v("result") === "accepted_conditions" && (
            <input
              className="input"
              placeholder="Conditions, e.g. one month deposit"
              aria-label="Conditions"
              value={v("conditions")}
              onChange={(e) => set("conditions", e.target.value)}
            />
          )}
          <div>
            <button
              className="btn btn-sm btn-primary"
              disabled={
                act.busy || !v("result") || v("reason").trim().length < 5
              }
              onClick={() =>
                run(
                  "decide",
                  {
                    result: v("result"),
                    note: v("reason"),
                    conditions: v("conditions"),
                  },
                  "Decision recorded.",
                  ["result", "reason", "conditions"],
                )
              }
            >
              Record decision
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}

/** Assignment instructions for each site on a contract. */
export function InstructionsSection({ siteIds }: { siteIds: string[] }) {
  if (!siteIds.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Assignment instructions</h2>
          <div className="muted small">
            What each post does, the site routine, reporting and emergency
            contacts, signed by the client. Officers brief the guards.
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gap: 12, padding: "8px 16px 12px" }}>
        {siteIds.map((s) => (
          <SiteInstructions key={s} siteId={s} />
        ))}
      </div>
    </section>
  );
}

function SiteInstructions({ siteId }: { siteId: string }) {
  const b = useLoad(
    () => api.siteInstructions(siteId).catch(() => null),
    [siteId],
  );
  const act = useAction();
  const [edit, setEdit] = useState<Record<string, string> | null>(null);
  const [sign, setSign] = useState<Record<string, string> | null>(null);
  if (!b.data)
    return b.loading ? (
      <Loading what="instructions" />
    ) : (
      <div className="muted small">Not available to you.</div>
    );
  const d = b.data;
  const ins = d.instructions;
  const writes = d.role === "write";
  const startEdit = () =>
    setEdit({
      general: ins?.general ?? "",
      emergency: ins?.emergency ?? "",
      reporting: ins?.reporting ?? "",
      material: "yes",
      ...Object.fromEntries(
        d.posts.map((p) => [
          `post:${p.id}`,
          ins?.posts.find((x) => x.postId === p.id)?.duties ?? "",
        ]),
      ),
    });
  return (
    <div className="small" style={{ display: "grid", gap: 6 }}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <b>{d.site.name}</b>
        {ins ? (
          <Chip tone={d.state.ok ? "ok" : "warn"}>
            {ins.clientSigned
              ? `version ${ins.version}, signed by the client`
              : `version ${ins.version}, waiting for the client`}
          </Chip>
        ) : (
          <Chip tone="warn">not written</Chip>
        )}
      </div>
      {!d.state.ok && <div className="muted">{d.state.detail}</div>}
      {ins && !edit && (
        <>
          <div>
            <b>Site routine:</b> {ins.general}
          </div>
          {ins.posts.map((p) => (
            <div key={p.postId}>
              <b>{p.postName}:</b> {p.duties}
            </div>
          ))}
          <div>
            <b>Reporting:</b> {ins.reporting}
          </div>
          <div>
            <b>Emergency:</b> {ins.emergency}
          </div>
          {ins.clientSigned && (
            <div className="muted">
              Signed by {ins.clientSigned.name} ({ins.clientSigned.role}) on{" "}
              {dateLabel(ins.clientSigned.on)} · {ins.clientSigned.ref}
            </div>
          )}
        </>
      )}
      {writes && !edit && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <button className="btn btn-sm" onClick={startEdit}>
            {ins ? "New version" : "Write instructions"}
          </button>
          {ins && !ins.clientSigned && (
            <button
              className="btn btn-sm btn-primary"
              onClick={() =>
                setSign(
                  sign ? null : { name: "", role: "", on: todayMyt(), ref: "" },
                )
              }
            >
              Record client signature
            </button>
          )}
        </div>
      )}
      {edit && (
        <div style={{ display: "grid", gap: 6 }}>
          <textarea
            className="input"
            rows={3}
            placeholder="Site routine: access control, patrols, keys, logbooks"
            aria-label="Site routine"
            value={edit.general}
            onChange={(e) => setEdit({ ...edit, general: e.target.value })}
          />
          {d.posts.map((p) => (
            <textarea
              key={p.id}
              className="input"
              rows={2}
              placeholder={`Duties at ${p.name}`}
              aria-label={`Duties at ${p.name}`}
              value={edit[`post:${p.id}`]}
              onChange={(e) =>
                setEdit({ ...edit, [`post:${p.id}`]: e.target.value })
              }
            />
          ))}
          <input
            className="input"
            placeholder="Who guards report to, how incidents are reported"
            aria-label="Reporting"
            value={edit.reporting}
            onChange={(e) => setEdit({ ...edit, reporting: e.target.value })}
          />
          <input
            className="input"
            placeholder="Emergency contacts: police, Bomba, hospital, client"
            aria-label="Emergency contacts"
            value={edit.emergency}
            onChange={(e) => setEdit({ ...edit, emergency: e.target.value })}
          />
          {ins && (
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={edit.material === "yes"}
                onChange={(e) =>
                  setEdit({ ...edit, material: e.target.checked ? "yes" : "" })
                }
              />
              Material change: the client signs again (untick for a typo or
              wording fix)
            </label>
          )}
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy}
              onClick={() =>
                void act
                  .run(
                    () =>
                      api.siteInstructionsAct(siteId, "save", {
                        general: edit.general,
                        emergency: edit.emergency,
                        reporting: edit.reporting,
                        material: edit.material === "yes",
                        posts: d.posts.map((p) => ({
                          postId: p.id,
                          duties: edit[`post:${p.id}`] ?? "",
                        })),
                      }),
                    "Instructions saved.",
                  )
                  .then((r) => r && (setEdit(null), b.reload()))
              }
            >
              Save
            </button>
            <button className="btn btn-sm" onClick={() => setEdit(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {sign && (
        <div style={{ display: "grid", gap: 6 }}>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <input
              className="input"
              placeholder="Client signatory's name"
              aria-label="Signatory name"
              value={sign.name}
              onChange={(e) => setSign({ ...sign, name: e.target.value })}
            />
            <input
              className="input"
              placeholder="Position"
              aria-label="Signatory position"
              value={sign.role}
              onChange={(e) => setSign({ ...sign, role: e.target.value })}
            />
            <input
              className="input"
              type="date"
              aria-label="Date signed"
              value={sign.on}
              onChange={(e) => setSign({ ...sign, on: e.target.value })}
            />
          </div>
          <input
            className="input"
            placeholder="Where the signed copy is filed"
            aria-label="Signed copy reference"
            value={sign.ref}
            onChange={(e) => setSign({ ...sign, ref: e.target.value })}
          />
          <div>
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy}
              onClick={() =>
                void act
                  .run(
                    () =>
                      api.siteInstructionsAct(siteId, "client_signed", sign),
                    "Client signature recorded.",
                  )
                  .then((r) => r && (setSign(null), b.reload()))
              }
            >
              Save signature
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}
