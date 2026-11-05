import { useState } from "react";
import { api } from "../api";
import { Chip, ErrorNotice, Loading, dateLabel, useAction, useLoad } from "../ui";

/**
 * Allowances (Fauzan, 3 Nov 2026: "HR also have the ability to set allowance, the amount and what allowance is").
 * HR keeps the list: the name, monthly or one-off, the usual amount and cap, and whether the allowance counts for EPF,
 * SOCSO (with EIS and LINDUNG), PCB and the HRD levy. HR ticks those from its own reading of the law; Prima does not
 * decide them. Setting a staff member's monthly allowances waits for the HR Director, then the Vice Chairman's consent.
 */
const FREQ = { monthly: "Monthly", one_off: "One-off", both: "Monthly or one-off" } as const;
type Freq = keyof typeof FREQ;
const rm = (n: number | null) => (n == null ? "varies" : `RM${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export function AllowancesPanel() {
  const list = useLoad(() => api.allowanceTypes().catch(() => null), []);
  const act = useAction();
  const blank = { id: "", name: "", frequency: "monthly" as Freq, usualAmount: "", cap: "", epf: true, socso: true, pcb: true, hrd: true, basis: "", active: true, note: "" };
  const [f, setF] = useState<typeof blank | null>(null);
  const [who, setWho] = useState<string | null>(null);
  if (list.error) return <ErrorNotice error={list.error} />;
  if (list.loading && !list.data) return <Loading what="allowances" />;
  const d = list.data;
  if (!d) return null;
  const tick = (k: "epf" | "socso" | "pcb" | "hrd", label: string) =>
    f && (
      <label className="row small" style={{ gap: 4 }}>
        <input type="checkbox" aria-label={`Counts for ${label}`} checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />
        {label}
      </label>
    );
  return (
    <section className="panel" aria-label="Allowances">
      <div className="panel-head">
        <div>
          <h2>Allowances</h2>
          <div className="muted small">
            HR's list of allowances and what each counts for. A staff member's monthly allowances change only after the HR Director verifies and the
            Vice Chairman consents, like basic pay.
          </div>
        </div>
        {d.canEdit && !f && (
          <button className="btn btn-sm" onClick={() => setF(blank)}>
            New allowance
          </button>
        )}
      </div>
      {f && (
        <div className="list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
          <div className="grid-2">
            <label className="field">
              <span className="label">Allowance name</span>
              <input className="input" aria-label="Allowance name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Paid</span>
              <select className="input" aria-label="Paid" value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value as Freq })}>
                {(Object.keys(FREQ) as Freq[]).map((k) => (
                  <option key={k} value={k}>
                    {FREQ[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">Usual amount, RM (blank if it varies)</span>
              <input className="input" inputMode="decimal" aria-label="Usual amount" value={f.usualAmount} onChange={(e) => setF({ ...f, usualAmount: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Cap a month, RM (blank for none)</span>
              <input className="input" inputMode="decimal" aria-label="Cap" value={f.cap} onChange={(e) => setF({ ...f, cap: e.target.value })} />
            </label>
          </div>
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <span className="small">Counts for:</span>
            {tick("epf", "EPF")}
            {tick("socso", "SOCSO, EIS, LINDUNG")}
            {tick("pcb", "PCB")}
            {tick("hrd", "HRD levy")}
            {f.id && (
              <label className="row small" style={{ gap: 4 }}>
                <input type="checkbox" aria-label="In use" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
                In use (untick to retire it)
              </label>
            )}
          </div>
          <label className="field">
            <span className="label">Where the ticks come from</span>
            <input className="input" aria-label="Basis" value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value })} placeholder="e.g. EPF Act wage definition, LHDN ruling" />
          </label>
          {f.id && (
            <label className="field">
              <span className="label">Why it changes</span>
              <input className="input" aria-label="Why it changes" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
            </label>
          )}
          <ErrorNotice error={act.error} />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy}
              onClick={async () => {
                const r = await act.run(
                  () =>
                    api.saveAllowanceType({
                      id: f.id || null,
                      name: f.name,
                      frequency: f.frequency,
                      usualAmount: f.usualAmount.trim() ? Number(f.usualAmount) : null,
                      cap: f.cap.trim() ? Number(f.cap) : null,
                      epf: f.epf,
                      socso: f.socso,
                      pcb: f.pcb,
                      hrd: f.hrd,
                      basis: f.basis,
                      active: f.active,
                      note: f.note,
                    }),
                  "Saved. Payroll uses it from the next calculation.",
                );
                if (r) {
                  setF(null);
                  list.reload();
                }
              }}
            >
              Save allowance
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setF(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="list">
        {d.types.length === 0 && <div className="empty">No allowances on the list yet.</div>}
        {d.types.map((t) => (
          <div key={t.id} className="list-item" style={{ justifyContent: "space-between", gap: 6, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 600 }}>
                {t.name} {!t.active && <Chip tone="neutral">retired</Chip>}
              </div>
              <div className="muted small">
                {FREQ[t.frequency]} · usual {rm(t.usualAmount)}
                {t.cap != null ? ` · cap ${rm(t.cap)}` : ""} · counts for{" "}
                {[t.epf && "EPF", t.socso && "SOCSO/EIS", t.pcb && "PCB", t.hrd && "HRD"].filter(Boolean).join(", ") || "none"}
              </div>
              <div className="muted small">Basis: {t.basis}</div>
            </div>
            {d.canEdit && (
              <button
                className="btn btn-sm btn-ghost"
                onClick={() =>
                  setF({
                    id: t.id,
                    name: t.name,
                    frequency: t.frequency,
                    usualAmount: t.usualAmount == null ? "" : String(t.usualAmount),
                    cap: t.cap == null ? "" : String(t.cap),
                    epf: t.epf,
                    socso: t.socso,
                    pcb: t.pcb,
                    hrd: t.hrd,
                    basis: t.basis,
                    active: t.active,
                    note: "",
                  })
                }
              >
                Change
              </button>
            )}
          </div>
        ))}
      </div>
      {d.staff && (
        <>
          <h3 style={{ marginTop: 12 }}>Staff monthly allowances</h3>
          <div className="list">
            {d.staff.slice(0, 200).map((s) => (
              <div key={s.personId} className="list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
                <div className="row" style={{ justifyContent: "space-between", gap: 6, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {s.name} · {s.staffNo}
                    </div>
                    <div className="muted small">
                      {s.companyName} ·{" "}
                      {s.allowances.length
                        ? s.allowances.map((a) => `${a.label} ${rm(a.amount)}${a.onList ? "" : " (not on the list)"}`).join(", ")
                        : "no monthly allowance"}
                    </div>
                    {s.pending && (
                      <div className="small">
                        Waiting for approval: {s.pending.to.map((a) => `${a.label} ${rm(a.amount)}`).join(", ") || "none"} from {dateLabel(s.pending.effectiveOn)}
                      </div>
                    )}
                  </div>
                  {!s.own && !s.pending && who !== s.personId && (
                    <button className="btn btn-sm" onClick={() => setWho(s.personId)}>
                      Set allowances
                    </button>
                  )}
                </div>
                {who === s.personId && (
                  <StaffAllowanceEdit
                    staff={s}
                    types={d.types}
                    onDone={(saved) => {
                      setWho(null);
                      if (saved) list.reload();
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

type Data = NonNullable<Awaited<ReturnType<typeof api.allowanceTypes>>>;

function StaffAllowanceEdit({ staff, types, onDone }: { staff: NonNullable<Data["staff"]>[number]; types: Data["types"]; onDone: (saved: boolean) => void }) {
  const act = useAction();
  // Lines entered before the list carry no type: HR moves each onto a listed allowance here.
  const [rows, setRows] = useState(staff.allowances.map((a) => ({ typeId: a.onList ? a.typeId! : "", amount: String(a.amount), was: a.onList ? "" : a.label })));
  const [effectiveOn, setEffectiveOn] = useState("");
  const [reason, setReason] = useState("");
  const monthly = types.filter((t) => t.active && t.frequency !== "one_off");
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {rows.map((r, i) => (
        <div key={i} className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <select
            className="input"
            aria-label={`Allowance ${i + 1}`}
            value={r.typeId}
            onChange={(e) => {
              const t = types.find((x) => x.id === e.target.value);
              setRows(rows.map((x, k) => (k === i ? { ...x, typeId: e.target.value, amount: x.amount || (t?.usualAmount != null ? String(t.usualAmount) : "") } : x)));
            }}
          >
            <option value="">{r.was ? `Choose for "${r.was}"` : "Choose"}</option>
            {types
              .filter((t) => monthly.includes(t) || t.id === r.typeId)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.cap != null ? ` (cap ${rm(t.cap)})` : ""}
                </option>
              ))}
          </select>
          <input
            className="input"
            style={{ maxWidth: 140 }}
            inputMode="decimal"
            aria-label={`Amount ${i + 1}`}
            value={r.amount}
            onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)))}
          />
          <button className="btn btn-sm btn-ghost" onClick={() => setRows(rows.filter((_, k) => k !== i))}>
            Remove
          </button>
        </div>
      ))}
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <button className="btn btn-sm btn-ghost" onClick={() => setRows([...rows, { typeId: "", amount: "", was: "" }])}>
          Add allowance
        </button>
      </div>
      <div className="grid-2">
        <label className="field">
          <span className="label">Starts on</span>
          <input className="input" type="date" aria-label="Allowance starts on" value={effectiveOn} onChange={(e) => setEffectiveOn(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Reason</span>
          <input className="input" aria-label="Allowance reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. offer letter, new post, yearly review" />
        </label>
      </div>
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || rows.some((r) => !r.typeId) || !effectiveOn || reason.trim().length < 5}
          onClick={async () => {
            const r = await act.run(
              () => api.requestAllowanceChange(staff.personId, { allowances: rows.map((x) => ({ typeId: x.typeId, amount: Number(x.amount) })), effectiveOn, reason }),
              "Sent to the HR Director to verify. The record changes after the Vice Chairman consents.",
            );
            if (r) onDone(true);
          }}
        >
          Send for approval
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => onDone(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
