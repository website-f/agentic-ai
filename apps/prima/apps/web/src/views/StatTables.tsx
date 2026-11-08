import { Select } from '../SearchSelect';
import { useState } from "react";
import type { StatTable } from "@prima/core";
import { api } from "../api";
import { Chip, ErrorNotice, Loading, dateLabel, useAction, useLoad, type Tone } from "../ui";
import { useApp } from "../App";

/**
 * EPF and PERKESO contribution tables kept row by row in Prima (Fauzan, 2 Nov 2026: "Make sure epf and socso have table
 * for it ... Epf or socso publish their table of calculation"). Payroll takes every EPF, SOCSO and EIS amount from the
 * reference rows for review. Loading and checking never activates a table for payroll.
 * Also the employer's own EPF, PERKESO, LHDN and HRD Corp numbers for the contribution files.
 */

const STATUS: Record<StatTable["status"], [Tone, string]> = {
  built_in: ["warn", "Built-in copy, not verified"],
  loaded: ["warn", "Waiting for its check"],
  checked: ["ok", "Loaded and checked"],
  replaced: ["neutral", "Replaced"],
};
const n2 = (n: number) => n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TABLES = ["EPF-A", "EPF-E", "EPF-F", "SOCSO-1", "SOCSO-2", "EIS"];

export function StatTablesView() {
  const { me } = useApp();
  const { data, error, reload } = useLoad(() => api.statTables(), []);
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="contribution tables" />;
  return (
    <>
      <p className="muted small">
        These published EPF, SOCSO and EIS tables are a review-only reference registry. HR or Finance loads a table,
        and a second authorised person checks it against the published document. Checking does not activate it for payroll.
        Payroll continues to use the CEO&apos;s month-effective statutory settings. Table activation needs a separately
        reviewed authority and calculation change. Every loaded version is kept.
      </p>
      {data.waiting.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>Waiting for a check</h3>
          </div>
          {data.waiting.map((t) => (
            // Nobody checks a table they loaded (the server refuses it too).
            <Waiting key={`${t.id}-${t.version}`} t={t} canCheck={data.canCheck && t.loaded?.byId !== me.user.id} onDone={reload} />
          ))}
        </section>
      )}
      <section className="panel">
        <div className="panel-head">
          <h3>Reference tables selected for {data.period} (not applied to payroll)</h3>
        </div>
        <div className="list">
          {data.inForce.map((t) => (
            <div key={t.id} className="list-item" style={{ display: "block" }}>
              <div className="row" style={{ justifyContent: "space-between", gap: 6, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{t.name}</div>
                  <div className="muted small">
                    {t.appliesTo} · from {t.from} · {t.version}
                  </div>
                </div>
                <Chip tone={STATUS[t.status][0]}>{STATUS[t.status][1]}</Chip>
              </div>
              <div className="muted small" style={{ marginTop: 4 }}>
                {t.source}
              </div>
              <div className="muted small">Checked against: {t.checkedRows}</div>
              {t.checked && (
                <div className="muted small">
                  Checked by {t.checked.by} on {dateLabel(t.checked.at.slice(0, 10))}: {t.checked.comment}
                </div>
              )}
              <button className="btn btn-ghost btn-sm" onClick={() => setOpen(open === t.id ? null : t.id)}>
                {open === t.id ? "Hide the rows" : `Show all ${t.rows.length} rows`}
              </button>
              {open === t.id && <Rows t={t} />}
            </div>
          ))}
        </div>
      </section>
      {data.canLoad && <LoadForm onDone={reload} />}
      <EmployerNos employers={data.employers} canEdit={data.canLoad} onDone={reload} />
      {data.history.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>Loaded versions</h3>
          </div>
          <div className="list">
            {data.history.map((t) => (
              <div key={`${t.id}-${t.version}`} className="list-item" style={{ flexWrap: "wrap", gap: 6 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {t.name} {t.version}
                  </div>
                  <div className="muted small">
                    From {t.from} · {t.rowCount} rows · loaded by {t.loaded?.by} ({t.loaded?.comment})
                  </div>
                </div>
                <Chip tone={STATUS[t.status][0]}>{STATUS[t.status][1]}</Chip>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function Rows({ t }: { t: StatTable }) {
  let from = 0;
  return (
    <div className="table-wrap" style={{ maxHeight: 360, overflow: "auto", marginTop: 6 }}>
      <table>
        <thead>
          <tr>
            <th>Wages (RM)</th>
            <th style={{ textAlign: "right" }}>Employer</th>
            <th style={{ textAlign: "right" }}>Employee</th>
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r) => {
            const label = `${n2(from === 0 ? 0.01 : from + 0.01)} - ${n2(r.upTo)}`;
            from = r.upTo;
            return (
              <tr key={r.upTo}>
                <td>{label}</td>
                <td style={{ textAlign: "right" }}>{n2(r.er)}</td>
                <td style={{ textAlign: "right" }}>{n2(r.ee)}</td>
              </tr>
            );
          })}
          <tr>
            <td>Above {n2(from)}</td>
            <td colSpan={2} style={{ textAlign: "right" }}>
              {t.above === "last_row" ? "Same as the last row (wage ceiling)" : `${t.above.erPct}% / ${t.above.eePct}% of the wage, rounded up to the ringgit`}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Waiting({ t, canCheck, onDone }: { t: StatTable; canCheck: boolean; onDone: () => void }) {
  const act = useAction();
  const [comment, setComment] = useState("");
  return (
    <div className="list-item" style={{ display: "block" }}>
      <div style={{ fontWeight: 600 }}>
        {t.name} {t.version}, wages from {t.from}
      </div>
      <div className="muted small">
        {t.rows.length} rows · {t.source} · loaded by {t.loaded?.by} from {t.loaded?.comment}
      </div>
      <Rows t={t} />
      {canCheck ? (
        <>
          <label className="field">
            <span>What you checked it against</span>
            <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Every row against KWSP's PDF dated ..." />
          </label>
          <div className="row" style={{ gap: 6 }}>
            {(["check", "reject"] as const).map((d) => (
              <button
                key={d}
                className={d === "check" ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}
                disabled={act.busy}
                onClick={async () => {
                  if (await act.run(() => api.checkStatTable({ id: t.id, version: t.version, decision: d, comment }), d === "check" ? "Reference checked. Payroll settings are unchanged." : "Rejected.")) onDone();
                }}
              >
                {d === "check" ? "Checked, use it" : "Reject"}
              </button>
            ))}
          </div>
          <ErrorNotice error={act.error} />
        </>
      ) : (
        <p className="muted small">The Finance Director, the Chief of Staff or the CEO checks it.</p>
      )}
    </div>
  );
}

function LoadForm({ onDone }: { onDone: () => void }) {
  const act = useAction();
  const [f, setF] = useState({ id: "SOCSO-1", from: "", source: "", doc: "", rows: "" });
  const [changes, setChanges] = useState<number | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Load a new published table</h3>
      </div>
      <div style={{ padding: "0 12px 12px" }}>
        <label className="field">
          <span>Table</span>
          <Select className="select" value={f.id} onChange={set("id")}>
            {TABLES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span>Published effective wage month, for reference (YYYY-MM)</span>
          <input className="input" value={f.from} onChange={set("from")} placeholder="2027-01" />
        </label>
        <label className="field">
          <span>Where it comes from (notice or schedule and its date)</span>
          <input className="input" value={f.source} onChange={set("source")} />
        </label>
        <label className="field">
          <span>Published PDF attached</span>
          <input className="input" value={f.doc} onChange={set("doc")} placeholder="Jadual caruman PERKESO 2027.pdf" />
        </label>
        <label className="field">
          <span>Rows: one per line, from, to, employer, employee (copy from the PDF)</span>
          <textarea className="input" rows={8} value={f.rows} onChange={set("rows")} placeholder={"0.01\t30.00\t0.40\t0.10\n30.01\t50.00\t0.70\t0.20"} />
        </label>
        <button
          className="btn btn-primary"
          disabled={act.busy}
          onClick={async () => {
            const r = await act.run(() => api.loadStatTable(f), "Loaded for review. This does not change payroll calculations.");
            if (r) {
              setChanges((r as { changeCount: number }).changeCount);
              setF({ ...f, rows: "" });
              onDone();
            }
          }}
        >
          Load for checking
        </button>
        {changes != null && <p className="muted small">{changes} row(s) differ from the table in force.</p>}
        <ErrorNotice error={act.error} />
      </div>
    </section>
  );
}

type Nos = { epf: string | null; socso: string | null; lhdnE: string | null; hrd: string | null } | null;

function EmployerNos({ employers, canEdit, onDone }: { employers: { companyId: string; companyName: string; nos: Nos }[]; canEdit: boolean; onDone: () => void }) {
  const act = useAction();
  const [edit, setEdit] = useState<{ companyId: string; epf: string; socso: string; lhdnE: string; hrd: string } | null>(null);
  const LABELS: [keyof NonNullable<Nos>, string][] = [
    ["epf", "EPF employer number"],
    ["socso", "PERKESO employer code"],
    ["lhdnE", "LHDN E number"],
    ["hrd", "HRD Corp number"],
  ];
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Employer numbers</h3>
      </div>
      {employers.length === 0 && <p className="panel-empty">No employer is in your view yet. Each company's EPF, SOCSO, LHDN and HRD Corp numbers are kept here.</p>}
      <div className="list">
        {employers.map((e) => (
          <div key={e.companyId} className="list-item" style={{ display: "block" }}>
            <div style={{ fontWeight: 600 }}>{e.companyName}</div>
            {edit?.companyId === e.companyId ? (
              <>
                {LABELS.map(([k, l]) => (
                  <label key={k} className="field">
                    <span>{l}</span>
                    <input className="input" value={edit[k]} onChange={(x) => setEdit({ ...edit, [k]: x.target.value })} />
                  </label>
                ))}
                <button
                  className="btn btn-primary btn-sm"
                  disabled={act.busy}
                  onClick={async () => {
                    const { companyId, ...v } = edit;
                    const nos = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim() || null])) as NonNullable<Nos>;
                    if (await act.run(() => api.setEmployerNos(companyId, nos), "Saved.")) {
                      setEdit(null);
                      onDone();
                    }
                  }}
                >
                  Save
                </button>
                <ErrorNotice error={act.error} />
              </>
            ) : (
              <div className="row" style={{ justifyContent: "space-between", gap: 6, flexWrap: "wrap" }}>
                <div className="muted small">{LABELS.map(([k, l]) => `${l}: ${e.nos?.[k] ?? "not recorded"}`).join(" · ")}</div>
                {canEdit && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setEdit({ companyId: e.companyId, epf: e.nos?.epf ?? "", socso: e.nos?.socso ?? "", lhdnE: e.nos?.lhdnE ?? "", hrd: e.nos?.hrd ?? "" })}
                  >
                    Edit
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
