import { useState } from "react";
import type { GrcStream } from "@prima/core";
import { api, type GiftInput, type GrcBoard, type WhistleInput } from "../api";
import { useApp } from "../App";
import {
  Chip,
  ErrorNotice,
  Kpi,
  Loading,
  dateLabel,
  dateTimeLabel,
  useAction,
  useLoad,
} from "../ui";

/**
 * Speak up and assurance (V15). Everyone can report wrongdoing (anonymously if they wish) and declare gifts. Each
 * company proves its obligations and internal audit checks the proof; no proof is unknown, never green. A report
 * never reaches anyone it names.
 */

type Tab = "speak" | "gifts" | "obligations" | "osh" | "reports";
type Obl = GrcBoard["obligations"][number];

const STREAM: Record<GrcStream, string> = {
  OSH: "Safety and health",
  EMPLOYEE_RELATIONS: "Employee relations",
  ANTI_BRIBERY: "Anti-bribery",
  TAX: "Tax",
  CONTINUITY: "Continuity",
  PRIVACY: "Privacy",
  INTERNAL_AUDIT: "Internal audit",
  SUPPLIER: "Suppliers",
  WELFARE: "Worker welfare",
  FRAUD: "Fraud checks",
};
const STATE: Record<Obl["state"], ["ok" | "warn" | "crit" | "info", string]> = {
  ok: ["ok", "Proven and checked"],
  due_soon: ["info", "Due soon"],
  unchecked: ["warn", "Proof not checked"],
  unknown: ["warn", "Unknown: no proof"],
  overdue: ["crit", "Overdue"],
  failed: ["crit", "Proof rejected"],
};
const CATEGORY: Record<WhistleInput["category"], string> = {
  BRIBERY: "Bribery or kickbacks",
  FRAUD: "Fraud or theft",
  SAFETY: "Safety danger",
  HARASSMENT: "Harassment",
  MISCONDUCT: "Other misconduct",
  OTHER: "Something else",
};

export function GrcView() {
  const { data, error } = useLoad(() => api.grcBoard(), []);
  const [tab, setTab] = useState<Tab>("speak");
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="speak up and assurance" />;
  const k = data.kpis;
  const sees = data.roles.length > 0;
  const tabs: [Tab, string][] = [
    ["speak", "Speak up"],
    ["gifts", "Gifts"],
  ];
  if (sees) tabs.push(["obligations", "Obligations"], ["osh", "Site safety"]);
  if (data.handled.length || data.toReview.length)
    tabs.push(["reports", `Reports to handle (${k.reportsToHandle})`]);
  return (
    <div className="page">
      <div className="page-head">
        <h1>Speak up and assurance</h1>
        <p className="muted">
          Report wrongdoing safely, declare gifts, and see what each company
          must prove. A report never goes to anyone it names, and you can stay
          anonymous.
        </p>
        <p className="notice" data-tone="info">
          Test data. The gift limit, acknowledgement time and who handles
          reports are proposals.
        </p>
      </div>
      {sees && (
        <div className="kpis">
          <Kpi
            label="Proof rejected or overdue"
            value={k.failed + k.overdue}
            tone={k.failed + k.overdue ? "crit" : "ok"}
          />
          <Kpi
            label="Unknown, no proof"
            value={k.unknown}
            tone={k.unknown ? "warn" : "ok"}
          />
          <Kpi
            label="Proof not checked"
            value={k.unchecked}
            tone={k.unchecked ? "warn" : "ok"}
          />
          <Kpi
            label="Sites without a current risk assessment"
            value={k.oshUnknown}
            tone={k.oshUnknown ? "warn" : "ok"}
          />
          {data.whistleStats && (
            <Kpi
              label="Speak-up reports open"
              value={data.whistleStats.open}
              tone={data.whistleStats.ackLate ? "crit" : "ok"}
              note={
                data.whistleStats.ackLate
                  ? `${data.whistleStats.ackLate} not acknowledged in ${data.rule.whistleAckDays} days`
                  : undefined
              }
            />
          )}
          {k.giftsToDecide > 0 && (
            <Kpi label="Gifts to decide" value={k.giftsToDecide} tone="warn" />
          )}
        </div>
      )}
      <div
        className="tabbar"
        role="tablist"
        aria-label="Speak up and assurance"
      >
        {tabs.map(([t, l]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "speak" && <SpeakUp data={data} />}
      {tab === "gifts" && <Gifts data={data} />}
      {tab === "obligations" && <Obligations data={data} />}
      {tab === "osh" && <Osh data={data} />}
      {tab === "reports" && <Reports data={data} />}
    </div>
  );
}

function SpeakUp({ data }: { data: GrcBoard }) {
  const { me } = useApp();
  const act = useAction();
  const companies = me.companies.length ? me.companies : data.companies;
  const [f, setF] = useState<WhistleInput>({
    anonymous: true,
    companyId: null,
    category: "MISCONDUCT",
    summary: "",
    implicatedUserIds: [],
  });
  const [receipt, setReceipt] = useState<{
    code: string;
    handledBy: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const check = useAction();
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h3>Report wrongdoing</h3>
        </div>
        {receipt ? (
          <div className="notice" data-tone="info">
            Your report is in. Keep this code to check on it:{" "}
            <strong>{receipt.code}</strong>. It went to {receipt.handledBy}.
            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn btn-sm" onClick={() => setReceipt(null)}>
                Make another report
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            <select
              className="input"
              aria-label="What is it about"
              value={f.category}
              onChange={(e) =>
                setF({
                  ...f,
                  category: e.target.value as WhistleInput["category"],
                })
              }
            >
              {Object.entries(CATEGORY).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <select
              className="input"
              aria-label="Which company"
              value={f.companyId ?? ""}
              onChange={(e) =>
                setF({ ...f, companyId: e.target.value || null })
              }
            >
              <option value="">Company (optional)</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <textarea
              className="input"
              rows={5}
              aria-label="What happened"
              placeholder="What happened, when, where, and who was involved"
              value={f.summary}
              onChange={(e) => setF({ ...f, summary: e.target.value })}
            />
            <div className="small" style={{ fontWeight: 600 }}>
              Is any of these people involved? Your report will not go to them.
            </div>
            {data.handlers.map((h) => (
              <label key={h.id} className="row small" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={f.implicatedUserIds.includes(h.id)}
                  onChange={(e) =>
                    setF({
                      ...f,
                      implicatedUserIds: e.target.checked
                        ? [...f.implicatedUserIds, h.id]
                        : f.implicatedUserIds.filter((x) => x !== h.id),
                    })
                  }
                />
                {h.name}, {h.title}
              </label>
            ))}
            <label className="row small" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={f.anonymous}
                onChange={(e) => setF({ ...f, anonymous: e.target.checked })}
              />{" "}
              Do not record my name
            </label>
            <button
              className="btn btn-primary"
              disabled={act.busy || f.summary.trim().length < 20}
              onClick={() =>
                act
                  .run(() => api.submitWhistle(f))
                  .then((r) => {
                    if (r) {
                      setReceipt(r);
                      setF({
                        anonymous: true,
                        companyId: null,
                        category: "MISCONDUCT",
                        summary: "",
                        implicatedUserIds: [],
                      });
                    }
                  })
              }
            >
              Send report
            </button>
            <ErrorNotice error={act.error} />
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Check a report</h3>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <input
            className="input"
            aria-label="Receipt code"
            placeholder="Receipt code, e.g. SU-0001-K7Q"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button
            className="btn btn-sm"
            disabled={check.busy || !code.trim()}
            onClick={() =>
              check
                .run(() => api.whistleStatus(code))
                .then(
                  (r) =>
                    r &&
                    setStatus(
                      `${r.code}: ${r.status}${r.outcome ? `. Outcome: ${r.outcome}` : ""}`,
                    ),
                )
            }
          >
            Check
          </button>
        </div>
        {status && <p className="small">{status}</p>}
        <ErrorNotice error={check.error} />
        {data.mine.length > 0 && (
          <div className="list" style={{ marginTop: 6 }}>
            {data.mine.map((m) => (
              <div key={m.code} className="list-item">
                <div className="small">
                  {m.code} · {CATEGORY[m.category]} · sent {dateTimeLabel(m.at)}
                </div>
                <Chip tone={m.status === "closed" ? "ok" : "info"}>
                  {m.status}
                </Chip>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function Gifts({ data }: { data: GrcBoard }) {
  const act = useAction();
  const [f, setF] = useState<GiftInput>({
    companyId: null,
    direction: "received",
    counterparty: "",
    counterpartyKind: "CLIENT",
    description: "",
    value: 0,
    on: "",
    cash: false,
  });
  const [form, setForm] = useState(false);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Gifts and hospitality</h3>
        <button className="btn btn-sm" onClick={() => setForm(!form)}>
          Declare a gift
        </button>
      </div>
      <p className="muted small">
        Declare every gift or hospitality given or received. Above RM
        {data.rule.giftDecisionAbove}, anything with a public official, and any
        cash need a decision by the Chief of Staff or Deputy. Cash is never
        kept.
      </p>
      {form && (
        <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
          <select
            className="input"
            aria-label="Given or received"
            value={f.direction}
            onChange={(e) =>
              setF({
                ...f,
                direction: e.target.value as GiftInput["direction"],
              })
            }
          >
            <option value="received">Received</option>
            <option value="given">Given</option>
          </select>
          <input
            className="input"
            aria-label="With whom"
            placeholder="With whom (company or person)"
            value={f.counterparty}
            onChange={(e) => setF({ ...f, counterparty: e.target.value })}
          />
          <select
            className="input"
            aria-label="Who they are"
            value={f.counterpartyKind}
            onChange={(e) =>
              setF({
                ...f,
                counterpartyKind: e.target
                  .value as GiftInput["counterpartyKind"],
              })
            }
          >
            <option value="CLIENT">Client</option>
            <option value="SUPPLIER">Supplier</option>
            <option value="PUBLIC_OFFICIAL">Public official</option>
            <option value="OTHER">Other</option>
          </select>
          <input
            className="input"
            aria-label="What it was"
            placeholder="What it was"
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
          <input
            className="input"
            aria-label="Value RM"
            placeholder="Value RM (estimate)"
            inputMode="decimal"
            value={f.value || ""}
            onChange={(e) => setF({ ...f, value: Number(e.target.value) })}
          />
          <input
            className="input"
            type="date"
            aria-label="Date"
            value={f.on}
            onChange={(e) => setF({ ...f, on: e.target.value })}
          />
          <label className="row small" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={f.cash}
              onChange={(e) => setF({ ...f, cash: e.target.checked })}
            />{" "}
            It was cash or a cash voucher
          </label>
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() =>
              act
                .run(() => api.declareGift(f), "Declared.")
                .then((x) => {
                  if (x) setForm(false);
                })
            }
          >
            Declare
          </button>
          <ErrorNotice error={act.error} />
        </div>
      )}
      <div className="list">
        {!data.gifts.length && <div className="empty">No declarations.</div>}
        {data.gifts.map((g) => (
          <GiftLine key={g.gift.id} g={g} />
        ))}
      </div>
    </section>
  );
}

function GiftLine({ g: row }: { g: GrcBoard["gifts"][number] }) {
  const act = useAction();
  const [note, setNote] = useState("");
  const g = row.gift;
  const tone = g.decision
    ? g.decision.outcome === "approved"
      ? "ok"
      : "info"
    : g.needsDecision
      ? "warn"
      : "ok";
  const label = g.decision
    ? `Decided: ${g.decision.outcome}`
    : g.needsDecision
      ? "Decision needed"
      : "Recorded";
  return (
    <div
      className="list-item"
      style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}
    >
      <div
        className="row"
        style={{ justifyContent: "space-between", gap: 6, flexWrap: "wrap" }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {g.declarantName}: {g.description}
          </div>
          <div className="muted small">
            {g.direction === "received" ? "Received from" : "Given to"}{" "}
            {g.counterparty} (
            {g.counterpartyKind.toLowerCase().replace("_", " ")}) · RM
            {g.value.toFixed(2)}
            {g.cash ? " · cash" : ""} · {dateLabel(g.on)} · {row.companyName}
            {g.decision
              ? ` · ${g.decision.by}${g.decision.note ? `: ${g.decision.note}` : ""}`
              : ""}
          </div>
        </div>
        <Chip tone={tone}>{label}</Chip>
      </div>
      {row.canDecide && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <input
            className="input"
            aria-label="Note"
            placeholder="Note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {(["approved", "return", "donate", "refused"] as const)
            .filter(
              (o) =>
                o !== "approved" ||
                (!g.cash && g.counterpartyKind !== "PUBLIC_OFFICIAL"),
            )
            .map((o) => (
              <button
                key={o}
                className="btn btn-sm"
                disabled={act.busy}
                onClick={() =>
                  act.run(
                    () => api.decideGift(g.id, o, note),
                    "Decision recorded.",
                  )
                }
              >
                {
                  {
                    approved: "May keep",
                    return: "Return it",
                    donate: "Donate it",
                    refused: "Refuse",
                  }[o]
                }
              </button>
            ))}
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function Obligations({ data }: { data: GrcBoard }) {
  const [stream, setStream] = useState<GrcStream | "">("");
  const [all, setAll] = useState(false);
  const rows = data.obligations.filter(
    (o) => (!stream || o.item.stream === stream) && (all || o.state !== "ok"),
  );
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>What each company must prove</h3>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <select
            className="input"
            aria-label="Workstream"
            value={stream}
            onChange={(e) => setStream(e.target.value as GrcStream | "")}
          >
            <option value="">All workstreams</option>
            {Object.entries(STREAM).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <button className="btn btn-sm" onClick={() => setAll(!all)}>
            {all ? "Hide proven" : "Show proven"}
          </button>
        </div>
      </div>
      <p className="muted small">
        The company records the proof; internal audit checks it. Only checked,
        current proof is green.
      </p>
      <div className="list">
        {!rows.length && <div className="empty">Nothing open.</div>}
        {rows.slice(0, 150).map((o) => (
          <OblLine key={o.item.id} o={o} />
        ))}
      </div>
    </section>
  );
}

function OblLine({ o: row }: { o: Obl }) {
  const act = useAction();
  const [on, setOn] = useState("");
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const o = row.item;
  const [tone, label] = STATE[row.state];
  return (
    <div
      className="list-item"
      style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}
    >
      <div
        className="row"
        style={{ justifyContent: "space-between", gap: 6, flexWrap: "wrap" }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {row.companyName}: {o.title}
          </div>
          <div className="muted small">
            {STREAM[o.stream]} · every {o.everyMonths} month
            {o.everyMonths === 1 ? "" : "s"} · {o.basis}
          </div>
          <div className="small">
            {o.evidence
              ? `Proof ${o.evidence.ref}, dated ${dateLabel(o.evidence.on)}, by ${o.evidence.by}`
              : "No proof recorded"}
            {row.dueOn ? ` · next due ${dateLabel(row.dueOn)}` : ""}
            {o.checked
              ? ` · ${o.checked.ok ? "accepted" : "rejected"} by ${o.checked.by}${o.checked.note ? `: ${o.checked.note}` : ""}`
              : ""}
          </div>
        </div>
        <Chip tone={tone}>{label}</Chip>
      </div>
      {row.role === "company" && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <input
            className="input"
            type="date"
            aria-label="Done on"
            value={on}
            onChange={(e) => setOn(e.target.value)}
          />
          <input
            className="input"
            aria-label="Proof reference"
            placeholder="Document or reference"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
          />
          <button
            className="btn btn-sm"
            disabled={act.busy || !on || !ref.trim()}
            onClick={() =>
              act.run(() => api.grcEvidence(o.id, on, ref), "Proof recorded.")
            }
          >
            Record proof
          </button>
        </div>
      )}
      {row.role === "auditor" && o.evidence && !o.checked && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <input
            className="input"
            aria-label="Check note"
            placeholder="Note (required to reject)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() =>
              act.run(() => api.grcCheck(o.id, true, note), "Proof accepted.")
            }
          >
            Accept proof
          </button>
          <button
            className="btn btn-sm"
            disabled={act.busy || !note.trim()}
            onClick={() =>
              act.run(() => api.grcCheck(o.id, false, note), "Proof rejected.")
            }
          >
            Reject
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function Osh({ data }: { data: GrcBoard }) {
  const [all, setAll] = useState(false);
  const rows = data.osh.filter((s) => all || s.state !== "ok");
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Site risk assessments (HIRARC)</h3>
        <button className="btn btn-sm" onClick={() => setAll(!all)}>
          {all ? "Hide current" : "Show current"}
        </button>
      </div>
      <p className="muted small">
        OSHA 1994 s.18B: every site has a risk assessment, reviewed every{" "}
        {data.rule.oshReviewMonths} months. A site with none is unknown.
      </p>
      <div className="list">
        {!rows.length && (
          <div className="empty">Every site has a current assessment.</div>
        )}
        {rows.slice(0, 100).map((s) => (
          <OshLine key={s.siteId} s={s} />
        ))}
      </div>
    </section>
  );
}

function OshLine({ s }: { s: GrcBoard["osh"][number] }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    assessedOn: "",
    hazards: "",
    highRisks: "",
    controlsRef: "",
  });
  const tone =
    s.state === "ok"
      ? "ok"
      : s.state === "due_soon"
        ? "info"
        : s.state === "overdue"
          ? "crit"
          : "warn";
  const label = {
    ok: "Current",
    due_soon: "Review soon",
    overdue: "Review overdue",
    unknown: "Unknown: none on file",
  }[s.state];
  return (
    <div
      className="list-item"
      style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}
    >
      <div
        className="row"
        style={{ justifyContent: "space-between", gap: 6, flexWrap: "wrap" }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{s.siteName}</div>
          <div className="muted small">
            {s.companyName}
            {s.last
              ? ` · assessed ${dateLabel(s.last.assessedOn)}, ${s.last.hazards} hazards, ${s.last.highRisks} high · review by ${dateLabel(s.last.nextReviewOn)}`
              : ""}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Chip tone={tone}>{label}</Chip>
          {s.canRecord && (
            <button className="btn btn-sm" onClick={() => setOpen(!open)}>
              Record
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <input
            className="input"
            type="date"
            aria-label="Assessed on"
            value={f.assessedOn}
            onChange={(e) => setF({ ...f, assessedOn: e.target.value })}
          />
          <input
            className="input"
            aria-label="Hazards"
            placeholder="Hazards found"
            inputMode="numeric"
            value={f.hazards}
            onChange={(e) => setF({ ...f, hazards: e.target.value })}
          />
          <input
            className="input"
            aria-label="High risks"
            placeholder="High risk"
            inputMode="numeric"
            value={f.highRisks}
            onChange={(e) => setF({ ...f, highRisks: e.target.value })}
          />
          <input
            className="input"
            aria-label="HIRARC reference"
            placeholder="HIRARC reference"
            value={f.controlsRef}
            onChange={(e) => setF({ ...f, controlsRef: e.target.value })}
          />
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() =>
              act.run(
                () =>
                  api.recordOshAssessment(s.siteId, {
                    assessedOn: f.assessedOn,
                    hazards: Number(f.hazards),
                    highRisks: Number(f.highRisks),
                    controlsRef: f.controlsRef,
                  }),
                "Risk assessment recorded.",
              )
            }
          >
            Save
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function Reports({ data }: { data: GrcBoard }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Reports you handle</h3>
      </div>
      <p className="muted small">
        Acknowledge within {data.rule.whistleAckDays} days. Keep the reporter's
        identity confidential; never share the report with anyone it names.
      </p>
      <div className="list">
        {data.handled.map((h) => (
          <ReportLine key={h.report.id} h={h} />
        ))}
      </div>
      {data.toReview.length > 0 && (
        <>
          <h3 style={{ marginTop: 12 }}>
            Closures for a second handler to agree
          </h3>
          <div className="list">
            {data.toReview.map((t) => (
              <ReviewLine key={t.report.id} t={t} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function ReviewLine({ t }: { t: GrcBoard["toReview"][number] }) {
  const act = useAction();
  const [note, setNote] = useState("");
  const r = t.report;
  return (
    <div
      className="list-item"
      style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}
    >
      <div style={{ fontWeight: 600 }}>
        {r.code}: {CATEGORY[r.category]} · {t.companyName}
      </div>
      <div className="small" style={{ whiteSpace: "pre-wrap" }}>
        {r.summary}
      </div>
      {r.notes.map((n, i) => (
        <div key={i} className="muted small">
          {dateTimeLabel(n.at)} {n.by}: {n.text}
        </div>
      ))}
      <div className="small">Proposed outcome: {r.proposedOutcome}</div>
      <input
        className="input"
        aria-label="Review note"
        placeholder="Note (needed to send it back)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy}
          onClick={() =>
            act.run(
              () => api.whistleReview(r.id, true, note),
              "Agreed and closed.",
            )
          }
        >
          Agree and close
        </button>
        <button
          className="btn btn-sm"
          disabled={act.busy || note.trim().length < 3}
          onClick={() =>
            act.run(
              () => api.whistleReview(r.id, false, note),
              "Sent back for more investigation.",
            )
          }
        >
          Send back
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function ReportLine({ h }: { h: GrcBoard["handled"][number] }) {
  const act = useAction();
  const [text, setText] = useState("");
  const r = h.report;
  return (
    <div
      className="list-item"
      style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}
    >
      <div
        className="row"
        style={{ justifyContent: "space-between", gap: 6, flexWrap: "wrap" }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {r.code}: {CATEGORY[r.category]}
          </div>
          <div className="muted small">
            {h.companyName} · received {dateTimeLabel(r.at)} ·{" "}
            {r.anonymous ? "anonymous" : `from ${r.reporterName}`}
          </div>
        </div>
        <Chip tone={h.ackLate ? "crit" : r.status === "closed" ? "ok" : "warn"}>
          {h.ackLate ? "Acknowledge now" : r.status}
        </Chip>
      </div>
      <div className="small" style={{ whiteSpace: "pre-wrap" }}>
        {r.summary}
      </div>
      {r.notes.map((n, i) => (
        <div key={i} className="muted small">
          {dateTimeLabel(n.at)} {n.by}: {n.text}
        </div>
      ))}
      {r.outcome && <div className="small">Outcome: {r.outcome}</div>}
      {r.status === "closing" && (
        <div className="small">
          Proposed outcome: {r.proposedOutcome}. Waiting for a second handler to
          agree.
        </div>
      )}
      {r.status !== "closed" && r.status !== "closing" && (
        <>
          <input
            className="input"
            aria-label="Note or outcome"
            placeholder="Note, or the outcome when closing"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {r.status === "received" && (
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy}
                onClick={() =>
                  act.run(
                    () => api.whistleStep(r.id, "acknowledge", ""),
                    "Acknowledged.",
                  )
                }
              >
                Acknowledge
              </button>
            )}
            {r.status !== "investigating" && (
              <button
                className="btn btn-sm"
                disabled={act.busy}
                onClick={() =>
                  act.run(
                    () => api.whistleStep(r.id, "investigate", ""),
                    "Investigation opened.",
                  )
                }
              >
                Investigate
              </button>
            )}
            <button
              className="btn btn-sm"
              disabled={act.busy || !text.trim()}
              onClick={() =>
                act.run(
                  () => api.whistleStep(r.id, "note", text),
                  "Note added.",
                )
              }
            >
              Add note
            </button>
            <button
              className="btn btn-sm"
              disabled={act.busy || !text.trim()}
              onClick={() =>
                act.run(
                  () => api.whistleStep(r.id, "close", text),
                  "Sent to a second handler to agree.",
                )
              }
            >
              Propose closing
            </button>
          </div>
        </>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}
