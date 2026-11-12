import { Select } from '../SearchSelect';
import { useEffect, useState } from "react";
import { bqWorkbookXlsx } from "@prima/core";
import { api, type AmBqView } from "../api";
import { saveFile } from "../save";
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, useAction, useLoad, type Tone } from "../ui";

/**
 * Bill of quantities, quotes and award for one Asset Management work order (Fauzan, 5 Nov 2026, rule AM-BQ). The team
 * prepares the BQ, the Asset Director approves it (and the COO above the limit), quotes are compared line by line,
 * and the lowest complete quote wins unless a reason is approved. Prices come only from our own past awarded jobs or
 * from a price staff entered with its source.
 */

const rm = (n: number) => `RM${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
type Kind = AmBqView["templates"][number]["kind"];
interface EditLine {
  item: string;
  unit: string;
  qty: string;
  rate: string;
  note: string;
  /** Building BQs: section letter, working shown to contractors, and (Pilihan). */
  section: string;
  calc: string;
  optional: boolean;
}
const blank: EditLine = { item: "", unit: "", qty: "", rate: "", note: "", section: "", calc: "", optional: false };
type Bq = NonNullable<AmBqView["bq"]>;
type Section = { code: string; title: string };
const UNIT_SHOWN: Record<string, string> = { m2: "m²", m3: "m³" };

/** Bil numbers as on Fauzan's sample BQ: A1, A2, B1 ... (plain L1, L2 when the BQ has no sections). */
function bilNumbers(lines: { section?: string }[], sections: Section[] | undefined): string[] {
  if (!sections?.length) return lines.map((_, i) => `L${i + 1}`);
  const count: Record<string, number> = {};
  return lines.map((l) => {
    const c = l.section || sections[0].code;
    count[c] = (count[c] ?? 0) + 1;
    return `${c}${count[c]}`;
  });
}

/** The BQ as an Excel file for contractors (Ringkasan, BQ, Nota), built in the browser; our rates are not in it. */
function DownloadXlsx({ bq, fallbackTitle }: { bq: Bq; fallbackTitle: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const go = async () => {
    const bytes = bqWorkbookXlsx({
      title: bq.title || fallbackTitle,
      location: bq.location,
      sections: bq.sections,
      lines: bq.lines,
      contingencyPct: bq.contingencyPct,
      notes: bq.notes,
      drawings: bq.drawings,
    });
    const name = `BQ-${(bq.title || fallbackTitle).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "kerja"}.xlsx`;
    setMsg(await saveFile(name, new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })));
  };
  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }}>
      <button className="btn btn-sm" onClick={go}>
        Download BQ for contractors (Excel)
      </button>
      <span className="muted small">Ringkasan, BQ and Nota sheets. The Kadar column is left empty for the contractor; our prices are not in the file.</span>
      {msg && <span className="small">{msg}</span>}
    </div>
  );
}
const ROUTE: Record<string, string> = { DIRECT: "One quote", RFQ: "Three quotes (RFQ)", TENDER: "Open tender" };
const STATUS: Record<string, [Tone, string]> = {
  draft: ["neutral", "Draft"],
  submitted: ["warn", "Waiting for approval"],
  approved: ["ok", "BQ approved"],
  returned: ["crit", "Returned"],
};

export function AmBqDrawer({ workOrderId, onClose }: { workOrderId: string; onClose: () => void }) {
  const { data, error, reload } = useLoad(() => api.amBq(workOrderId), [workOrderId]);
  return (
    <Drawer title={data ? `BQ: ${data.workOrder.title}` : "BQ"} sub={data ? `Due ${dateLabel(data.workOrder.dueOn)}` : undefined} onClose={onClose}>
      {error && <ErrorNotice error={error} />}
      {!data && !error && <Loading what="the BQ" />}
      {data && <Body data={data} workOrderId={workOrderId} reload={reload} />}
    </Drawer>
  );
}

function Body({ data, workOrderId, reload }: { data: AmBqView; workOrderId: string; reload: () => void }) {
  const bq = data.bq;
  return (
    <>
      {bq && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          <Chip tone={STATUS[bq.status][0]}>{STATUS[bq.status][1]}</Chip>
          {data.route && <Chip tone="neutral">{ROUTE[data.route.route]}</Chip>}
          {data.route?.cooToo && <Chip tone="warn">COO also approves</Chip>}
          <span className="muted small">
            Estimate {rm(data.estimate.withContingency)}
            {data.estimate.contingency > 0 ? ` with ${bq.contingencyPct}% contingency` : ""}
            {data.estimate.unpriced > 0 ? `, ${data.estimate.unpriced} line(s) not priced yet` : ""}
          </span>
        </div>
      )}
      {data.route && <p className="muted small">{data.route.why}</p>}
      {data.can.edit ? <Brief data={data} workOrderId={workOrderId} reload={reload} /> : bq?.brief && <BriefView data={data} />}
      {data.can.edit && data.briefMissing.length === 0 && <Editor data={data} workOrderId={workOrderId} reload={reload} />}
      {!data.can.edit && bq && bq.lines.length > 0 && <Lines data={data} />}
      {bq && <Steps steps={[["Asset Director", bq.director], ["COO", bq.coo]]} />}
      {data.can.decide && <Decide label="BQ" onDecide={(approve, note) => api.amBqAction(workOrderId, { kind: "decide", approve, note })} reload={reload} returnWord="Return" />}
      {bq && (bq.status === "approved" || bq.quotes.length > 0) && <Quotes data={data} workOrderId={workOrderId} reload={reload} />}
      {data.price && <Variations data={data} workOrderId={workOrderId} reload={reload} />}
      {data.advice.length > 0 && (
        <section className="panel">
          <h3>Advice for the lowest cost</h3>
          <ul className="small">
            {data.advice.map((a, i) => (
              <li key={i}>{a.text}</li>
            ))}
          </ul>
          <p className="muted small">Advice only. The team and the approvers decide.</p>
        </section>
      )}
    </>
  );
}

function Lines({ data }: { data: AmBqView }) {
  const bq = data.bq!;
  const bil = bilNumbers(bq.lines, bq.sections);
  const groups = bq.sections?.length ? bq.sections : [{ code: "", title: "" }];
  return (
    <section className="panel">
      <h3>Bill of quantities</h3>
      {bq.title && <p className="small" style={{ fontWeight: 600 }}>{bq.title}</p>}
      {bq.location && <p className="muted small">Place: {bq.location}</p>}
      {groups.map((g) => {
        const rows = bq.lines.map((l, i) => ({ l, i })).filter(({ l }) => !g.code || (l.section || groups[0].code) === g.code);
        if (!rows.length) return null;
        const sub = rows.reduce((n, { l }) => n + (l.rate == null ? 0 : l.qty * l.rate), 0);
        return (
          <div key={g.code || "all"} style={{ marginBottom: 8 }}>
            {g.code && (
              <div className="row small" style={{ justifyContent: "space-between", fontWeight: 600, marginTop: 6 }}>
                <span>
                  {g.code}. {g.title}
                </span>
                <span>{rm(sub)}</span>
              </div>
            )}
            <div className="list">
              {rows.map(({ l, i }) => (
                <div key={l.id} className="list-item" style={{ flexWrap: "wrap", gap: 6 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>
                      {bil[i]}. {l.item}
                      {l.optional ? " (optional)" : ""}
                    </div>
                    <div className="muted small">
                      {l.qty} {UNIT_SHOWN[l.unit] ?? l.unit} × {l.rate == null ? "no price yet" : rm(l.rate)}
                      {l.rateFrom === "past" ? " (our past price)" : l.rateFrom === "staff" ? ` (${l.note})` : ""}
                      {l.calc ? ` · ${l.calc}` : ""}
                    </div>
                  </div>
                  <span className="small">{l.rate == null ? "" : rm(l.qty * l.rate)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {(bq.contingencyPct ?? 0) > 0 && (
        <p className="small">
          Lines {rm(data.estimate.known)} + contingency {bq.contingencyPct}% {rm(data.estimate.contingency)} = <b>{rm(data.estimate.withContingency)}</b>
        </p>
      )}
      {bq.notes?.length ? (
        <details>
          <summary className="small">Notes for contractors ({bq.notes.length})</summary>
          <ol className="small">
            {bq.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ol>
        </details>
      ) : null}
      {bq.drawings?.length ? (
        <p className="muted small">Drawings: {bq.drawings.map((d) => `${d.ref} ${d.title}`).join("; ")}</p>
      ) : null}
      <DownloadXlsx bq={bq} fallbackTitle={data.workOrder.title} />
    </section>
  );
}

function Editor({ data, workOrderId, reload }: { data: AmBqView; workOrderId: string; reload: () => void }) {
  const bq = data.bq;
  const { run, busy, error } = useAction();
  // The kind of job and the measurements come from the job details saved above.
  const kind = bq!.jobKind;
  const measurements = bq!.measurements;
  const template = data.templates.find((t) => t.kind === kind)!;
  const building = template.building;
  const toEdit = (ls: { item: string; unit: string; qty: number; rate: number | null; note: string; section?: string; calc?: string; optional?: boolean }[]): EditLine[] =>
    ls.map((l) => ({
      item: l.item,
      unit: l.unit,
      qty: String(l.qty),
      rate: l.rate == null ? "" : String(l.rate),
      note: l.note,
      section: l.section ?? "",
      calc: l.calc ?? "",
      optional: !!l.optional,
    }));
  const [lines, setLines] = useState<EditLine[]>(bq ? toEdit(bq.lines) : []);
  const [doc, setDoc] = useState({
    title: bq?.title ?? "",
    location: bq?.location ?? "",
    contingency: bq?.contingencyPct == null ? "" : String(bq.contingencyPct),
    notes: (bq?.notes ?? []).join("\n"),
  });
  const [sections, setSections] = useState<Section[]>(bq?.sections ?? []);
  const [drawings, setDrawings] = useState<{ ref: string; title: string }[]>(bq?.drawings ?? []);
  useEffect(() => {
    if (!bq) return;
    setLines(toEdit(bq.lines));
    setDoc({ title: bq.title ?? "", location: bq.location ?? "", contingency: bq.contingencyPct == null ? "" : String(bq.contingencyPct), notes: (bq.notes ?? []).join("\n") });
    setSections(bq.sections ?? []);
    setDrawings(bq.drawings ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bq?.version]);
  const nums = () => measurements;
  const set = (i: number, k: keyof EditLine, v: string | boolean) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const draft = () =>
    run(async () => {
      const d = (await api.amBqAction(workOrderId, { kind: "draft", jobKind: kind, measurements: nums() })) as {
        lines: Parameters<typeof toEdit>[0];
        title?: string;
        sections?: Section[];
        notes?: string[];
        contingencyPct?: number;
      };
      setLines(toEdit(d.lines));
      if (d.sections) setSections(d.sections);
      if (d.title || d.notes || d.contingencyPct != null)
        setDoc((x) => ({
          ...x,
          title: d.title ?? x.title,
          contingency: d.contingencyPct == null ? x.contingency : String(d.contingencyPct),
          notes: d.notes ? d.notes.join("\n") : x.notes,
        }));
      return d;
    });
  const save = () =>
    run(
      () =>
        api.amBqAction(workOrderId, {
          kind: "save",
          jobKind: kind,
          measurements: nums(),
          version: bq?.version ?? 0,
          lines: lines.map((l) => ({
            item: l.item,
            unit: l.unit,
            qty: Number(l.qty),
            rate: l.rate.trim() === "" ? null : Number(l.rate),
            note: l.note,
            ...(building ? { section: l.section || sections[0]?.code || undefined, calc: l.calc, optional: l.optional } : {}),
          })),
          ...(building
            ? {
                title: doc.title,
                location: doc.location,
                sections,
                contingencyPct: doc.contingency.trim() === "" ? 0 : Number(doc.contingency),
                notes: doc.notes.split("\n").map((n) => n.trim()).filter(Boolean),
                drawings: drawings.filter((d) => d.ref.trim() || d.title.trim()),
              }
            : {}),
        }),
      "BQ saved",
    ).then(reload);
  const submit = () => run(() => api.amBqAction(workOrderId, { kind: "submit" }), "BQ sent for approval").then(reload);
  const total = lines.reduce((n, l) => n + (l.rate.trim() === "" ? 0 : Number(l.qty) * Number(l.rate) || 0), 0);
  const pct = Number(doc.contingency) || 0;
  const bil = bilNumbers(lines, building ? sections : undefined);
  const nextCode = () => {
    for (let i = 0; i < 26; i++) {
      const c = String.fromCharCode(65 + i);
      if (!sections.some((x) => x.code === c)) return c;
    }
    return "";
  };
  return (
    <section className="panel">
      <h3>Prepare the BQ</h3>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <span className="muted small">
          {template.label}
          {building
            ? ` · ${template.measures.filter((m) => (measurements[m.key] ?? 0) > 0).length} measurements from the job details`
            : template.measures
                .filter((m) => (measurements[m.key] ?? 0) > 0)
                .map((m) => ` · ${m.label} ${measurements[m.key]} ${m.unit}`)
                .join("")}
        </span>
        {kind !== "OTHER" ? (
          <button className="btn btn-sm" disabled={busy} onClick={draft}>
            Draft from template
          </button>
        ) : null}
      </div>
      <p className="muted small">
        The draft uses the site measurements and our own past awarded prices. A line with no past price stays empty: ask suppliers, and write where any
        price you enter comes from.
        {building ? " Quantities that need a factor (footing size, roof slope) say so in their working; check them against the drawings." : ""}
      </p>
      {building && (
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginBottom: 8 }}>
          <label className="small" style={{ display: "grid", gap: 2, gridColumn: "1 / -1" }}>
            BQ title (on every sheet)
            <input className="input" value={doc.title} onChange={(e) => setDoc({ ...doc, title: e.target.value })} />
          </label>
          <label className="small" style={{ display: "grid", gap: 2 }}>
            Place (Lokasi)
            <input className="input" value={doc.location} onChange={(e) => setDoc({ ...doc, location: e.target.value })} />
          </label>
          <label className="small" style={{ display: "grid", gap: 2 }}>
            Contingency % (0 to 20)
            <input className="input" inputMode="decimal" value={doc.contingency} onChange={(e) => setDoc({ ...doc, contingency: e.target.value })} />
          </label>
        </div>
      )}
      {building && (
        <details style={{ marginBottom: 8 }}>
          <summary className="small">Sections ({sections.length})</summary>
          {sections.map((x, i) => (
            <div key={i} className="row" style={{ gap: 6, marginTop: 4, flexWrap: "wrap" }}>
              <input className="input" aria-label={`Section ${i + 1} letter`} value={x.code} style={{ width: 50 }} onChange={(e) => {
                  // Lines under the old letter move with it, so renaming a section never leaves lines behind.
                  const code = e.target.value.toUpperCase().slice(0, 2);
                  setLines(lines.map((l) => (l.section === x.code ? { ...l, section: code } : l)));
                  setSections(sections.map((y, j) => (j === i ? { ...y, code } : y)));
                }} />
              <input className="input" aria-label={`Section ${i + 1} title`} value={x.title} style={{ flex: "1 1 220px" }} onChange={(e) => setSections(sections.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)))} />
              {!lines.some((l) => l.section === x.code) && (
                <button className="btn btn-sm btn-ghost" onClick={() => setSections(sections.filter((_, j) => j !== i))}>
                  Remove
                </button>
              )}
            </div>
          ))}
          <button className="btn btn-sm btn-ghost" style={{ marginTop: 4 }} disabled={sections.length >= 26} onClick={() => setSections([...sections, { code: nextCode(), title: "" }])}>
            Add a section
          </button>
        </details>
      )}
      <div className="list">
        {lines.map((l, i) => (
          <div key={i} className="list-item" style={{ flexWrap: "wrap", gap: 6 }}>
            {building && (
              <>
                <span className="small muted" style={{ width: 32 }}>
                  {bil[i]}
                </span>
                <Select className="input" aria-label={`Line ${i + 1} section`} value={l.section || sections[0]?.code || ""} onChange={(e) => set(i, "section", e.target.value)} style={{ width: 70 }}>
                  {sections.map((x) => (
                    <option key={x.code} value={x.code}>
                      {x.code}
                    </option>
                  ))}
                </Select>
              </>
            )}
            <input className="input" aria-label={`Line ${i + 1} item`} placeholder="Item" value={l.item} onChange={(e) => set(i, "item", e.target.value)} style={{ flex: "2 1 220px" }} />
            <input className="input" aria-label={`Line ${i + 1} unit`} placeholder="Unit" value={l.unit} onChange={(e) => set(i, "unit", e.target.value)} style={{ width: 70 }} />
            <input className="input" aria-label={`Line ${i + 1} quantity`} placeholder="Qty" inputMode="decimal" value={l.qty} onChange={(e) => set(i, "qty", e.target.value)} style={{ width: 90 }} />
            <input className="input" aria-label={`Line ${i + 1} rate`} placeholder="Rate RM" inputMode="decimal" value={l.rate} onChange={(e) => set(i, "rate", e.target.value)} style={{ width: 100 }} />
            <input className="input" aria-label={`Line ${i + 1} price source`} placeholder="Where the price comes from" value={l.note} onChange={(e) => set(i, "note", e.target.value)} style={{ flex: "1 1 160px" }} />
            {building && (
              <>
                <input className="input" aria-label={`Line ${i + 1} working`} placeholder="Working (e.g. 7.2 x 6.0)" value={l.calc} onChange={(e) => set(i, "calc", e.target.value)} style={{ flex: "1 1 160px" }} />
                <label className="small row" style={{ gap: 4 }}>
                  <input type="checkbox" checked={l.optional} onChange={(e) => set(i, "optional", e.target.checked)} /> Optional
                </label>
              </>
            )}
            <button className="btn btn-sm btn-ghost" aria-label={`Remove line ${i + 1}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        ))}
      </div>
      {building && (
        <>
          <label className="small" style={{ display: "grid", gap: 2, marginTop: 8 }}>
            Notes and assumptions for contractors (one per line)
            <textarea className="input" rows={6} value={doc.notes} onChange={(e) => setDoc({ ...doc, notes: e.target.value })} />
          </label>
          <div className="small" style={{ marginTop: 8 }}>
            Drawings the BQ is read with
          </div>
          {drawings.map((d, i) => (
            <div key={i} className="row" style={{ gap: 6, marginTop: 4, flexWrap: "wrap" }}>
              <input className="input" aria-label={`Drawing ${i + 1} number`} placeholder="L-01" value={d.ref} style={{ width: 80 }} onChange={(e) => setDrawings(drawings.map((y, j) => (j === i ? { ...y, ref: e.target.value } : y)))} />
              <input className="input" aria-label={`Drawing ${i + 1} title`} placeholder="Pelan lantai" value={d.title} style={{ flex: "1 1 220px" }} onChange={(e) => setDrawings(drawings.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)))} />
              <button className="btn btn-sm btn-ghost" onClick={() => setDrawings(drawings.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
          ))}
          <button className="btn btn-sm btn-ghost" style={{ marginTop: 4 }} disabled={drawings.length >= 30} onClick={() => setDrawings([...drawings, { ref: "", title: "" }])}>
            Add a drawing
          </button>
        </>
      )}
      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        <button className="btn btn-sm" onClick={() => setLines([...lines, { ...blank, section: sections.at(-1)?.code ?? "" }])}>
          Add line
        </button>
        <span className="muted small">
          Priced so far {rm(total)}
          {building && pct > 0 ? ` + ${pct}% contingency = ${rm(total * (1 + pct / 100))}` : ""}
        </span>
        <button className="btn btn-sm btn-primary" disabled={busy || lines.length === 0} onClick={save}>
          Save BQ
        </button>
        {data.can.submit && (
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={submit}>
            Send for approval
          </button>
        )}
      </div>
      <ErrorNotice error={error} />
      {bq && bq.lines.length > 0 && <DownloadXlsx bq={bq} fallbackTitle={data.workOrder.title} />}
    </section>
  );
}

type Step = { by: string; at: string; approve: boolean; note: string } | null;
function Steps({ steps, consent = [] }: { steps: [string, Step][]; consent?: string[] }) {
  const done = steps.filter(([, s]) => s);
  if (!done.length) return null;
  return (
    <div className="list">
      {done.map(([who, s]) => (
        <div key={who} className="list-item small">
          <span>
            {who}: {s!.by}, {consent.includes(who) ? (s!.approve ? "consented" : "refused") : s!.approve ? "approved" : "not approved"}: {s!.note}
          </span>
          <span className="muted">{dateLabel(s!.at.slice(0, 10))}</span>
        </div>
      ))}
    </div>
  );
}

function Decide({
  label,
  onDecide,
  reload,
  returnWord,
  approveWord = "Approve",
}: {
  label: string;
  onDecide: (approve: boolean, note: string) => Promise<unknown>;
  reload: () => void;
  returnWord: string;
  approveWord?: string;
}) {
  const { run, busy, error } = useAction();
  const [note, setNote] = useState("");
  const go = (approve: boolean) => run(() => onDecide(approve, note), `${label}: ${(approve ? approveWord : returnWord).toLowerCase()} recorded`).then(reload);
  return (
    <section className="panel">
      <h3>Your decision on the {label}</h3>
      <input className="input" aria-label="Reason" placeholder="Reason (a short comment is enough)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => go(true)}>
          {approveWord}
        </button>
        <button className="btn btn-sm" disabled={busy} onClick={() => go(false)}>
          {returnWord}
        </button>
      </div>
      <ErrorNotice error={error} />
    </section>
  );
}

function Quotes({ data, workOrderId, reload }: { data: AmBqView; workOrderId: string; reload: () => void }) {
  const bq = data.bq!;
  const cmp = data.comparison;
  const award = bq.award;
  const { run, busy, error } = useAction();
  const [pick, setPick] = useState("");
  const [reason, setReason] = useState("");
  const ask = () => run(() => api.amBqAction(workOrderId, { kind: "award", quoteId: pick, reason }), "Award sent for approval").then(reload);
  const awarded = award ? bq.quotes.find((q) => q.id === award.quoteId) : null;
  return (
    <section className="panel">
      <h3>Quotes</h3>
      {cmp && (
        <div className="list">
          {cmp.checks.map((c) => (
            <div key={c.quoteId} className="list-item" style={{ flexWrap: "wrap", gap: 6 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{c.contractor}</div>
                <div className="muted small">
                  {rm(c.total)}
                  {!c.sumOk ? ` · quote says ${rm(c.statedTotal)}` : ""}
                  {c.statedWithContingency ? ` · total on the quote ${rm(c.statedTotal)} includes our contingency; compared without it` : ""}
                  {c.missing.length ? ` · ${c.missing.length} line(s) not priced` : ""}
                  {c.dearer.length ? ` · ${c.dearer.length} line(s) dearer than our past price` : ""}
                  {c.expired ? " · no longer valid" : ""}
                </div>
              </div>
              {cmp.lowestId === c.quoteId && <Chip tone="ok">Lowest complete</Chip>}
            </div>
          ))}
        </div>
      )}
      {!cmp && <p className="muted small">No quotes yet. Ask {bq.route === "DIRECT" ? "one contractor" : `${data.rule.quotesForRfq} contractors`} to price every BQ line.</p>}
      {data.can.addQuote && <AddQuote data={data} workOrderId={workOrderId} reload={reload} />}
      {award && awarded && (
        <p className="small">
          Award to <b>{awarded.contractor}</b> at {rm(award.total)}
          {award.reason ? ` (reason: ${award.reason})` : ""}: {award.final ? "approved" : (award.director && !award.director.approve) || (award.coo && !award.coo.approve) ? "turned down" : "waiting for approval"}.
        </p>
      )}
      {award && <Steps steps={[["Asset Director", award.director], ["COO", award.coo]]} />}
      {data.can.reopen && <Reopen workOrderId={workOrderId} reload={reload} />}
      {data.can.askAward && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          <Select className="input" aria-label="Quote to award" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose the quote</option>
            {bq.quotes.map((q) => (
              <option key={q.id} value={q.id}>
                {q.contractor}
              </option>
            ))}
          </Select>
          <input className="input" aria-label="Reason" placeholder="Reason, if not the lowest or too few quotes" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="btn btn-sm btn-primary" disabled={busy || !pick} onClick={ask}>
            Ask to award
          </button>
        </div>
      )}
      <ErrorNotice error={error} />
      {data.can.decideAward && <Decide label="award" onDecide={(approve, note) => api.amBqAction(workOrderId, { kind: "awardDecide", approve, note })} reload={reload} returnWord="Turn down" />}
    </section>
  );
}

function AddQuote({ data, workOrderId, reload }: { data: AmBqView; workOrderId: string; reload: () => void }) {
  const bq = data.bq!;
  const { run, busy, error } = useAction();
  const [f, setF] = useState({ contractor: "", ref: "", receivedOn: "", validUntil: "", statedTotal: "" });
  const [rates, setRates] = useState<Record<string, string>>({});
  const save = () =>
    run(
      () =>
        api.amBqAction(workOrderId, {
          kind: "quote",
          quote: {
            contractor: f.contractor,
            ref: f.ref,
            receivedOn: f.receivedOn,
            validUntil: f.validUntil || null,
            statedTotal: Number(f.statedTotal),
            lines: bq.lines.filter((l) => (rates[l.id] ?? "").trim() !== "").map((l) => ({ lineId: l.id, rate: Number(rates[l.id]) })),
          },
        }),
      "Quote recorded",
    ).then((r) => {
      if (r) {
        setF({ contractor: "", ref: "", receivedOn: "", validUntil: "", statedTotal: "" });
        setRates({});
      }
      reload();
    });
  const field = (k: keyof typeof f, label: string, type = "text") => (
    <label className="small" style={{ display: "grid", gap: 2 }}>
      {label}
      <input className="input" type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  );
  return (
    <details style={{ marginTop: 8 }}>
      <summary className="btn btn-sm">Record a quote</summary>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 6 }}>
        {field("contractor", "Contractor")}
        {field("ref", "Quote number")}
        {field("receivedOn", "Received on", "date")}
        {field("validUntil", "Valid until", "date")}
        {field("statedTotal", "Total on the quote (RM)")}
      </div>
      <div className="list">
        {bq.lines.map((l) => (
          <div key={l.id} className="list-item small" style={{ gap: 6 }}>
            <span>
              {l.id}. {l.item} ({l.qty} {l.unit})
            </span>
            <input
              className="input"
              inputMode="decimal"
              aria-label={`Rate for line ${l.id}`}
              placeholder="Rate RM"
              value={rates[l.id] ?? ""}
              onChange={(e) => setRates({ ...rates, [l.id]: e.target.value })}
              style={{ width: 100 }}
            />
          </div>
        ))}
      </div>
      <button className="btn btn-sm btn-primary" disabled={busy} onClick={save}>
        Save quote
      </button>
      <ErrorNotice error={error} />
    </details>
  );
}

type Field = AmBqView["templates"][number]["brief"][number];

/**
 * The details needed before a BQ can be built (Fauzan, 5 Nov 2026): what was discussed with the requester, what was
 * found on site, the standard required and the measurements. Drafting stays closed until every required item is in.
 */
function Brief({ data, workOrderId, reload }: { data: AmBqView; workOrderId: string; reload: () => void }) {
  const bq = data.bq;
  const { run, busy, error } = useAction();
  const [kind, setKind] = useState<Kind>(bq?.brief?.jobKind ?? bq?.jobKind ?? "PAINTING");
  const [answers, setAnswers] = useState<Record<string, string>>(bq?.brief?.answers ?? {});
  const [measure, setMeasure] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(bq?.measurements ?? {}).map(([k, v]) => [k, String(v)])),
  );
  const template = data.templates.find((t) => t.kind === kind)!;
  const done = data.briefMissing.length === 0 && bq?.brief?.jobKind === kind;
  const [open, setOpen] = useState(!done);
  const save = () =>
    run(
      () =>
        api.amBqAction(workOrderId, {
          kind: "brief",
          jobKind: kind,
          answers,
          measurements: Object.fromEntries(template.measures.map((m) => [m.key, Number(measure[m.key] || 0)])),
          version: bq?.version ?? 0,
        }),
      "Job details saved",
    ).then(reload);
  const input = (f: Field) => {
    const v = answers[f.key] ?? "";
    const set = (x: string) => setAnswers({ ...answers, [f.key]: x });
    if (f.kind === "yesno" || f.kind === "choice")
      return (
        <Select className="input" value={v} onChange={(e) => set(e.target.value)}>
          <option value="">Choose</option>
          {(f.kind === "yesno" ? ["yes", "no"] : f.options!).map((o) => (
            <option key={o} value={o}>
              {o === "yes" ? "Yes" : o === "no" ? "No" : o}
            </option>
          ))}
        </Select>
      );
    if (f.kind === "date") return <input className="input" type="date" value={v} onChange={(e) => set(e.target.value)} />;
    return <input className="input" value={v} onChange={(e) => set(e.target.value)} />;
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Job details before the BQ</h3>
        <Chip tone={done ? "ok" : "warn"}>{done ? "Complete" : `${data.briefMissing.length} still needed`}</Chip>
        {done && (
          <button className="btn btn-sm btn-ghost" onClick={() => setOpen(!open)}>
            {open ? "Hide" : "Show"}
          </button>
        )}
      </div>
      {open && (
        <>
          <p className="muted small">
            The Maintenance Executive or Manager fills these in from the talk with the requester and the site visit. The BQ can be drafted once every
            item marked * is in.
          </p>
          <label className="small" style={{ display: "grid", gap: 2 }}>
            Kind of job *
            <Select className="input" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              {data.templates.map((t) => (
                <option key={t.kind} value={t.kind}>
                  {t.label}
                </option>
              ))}
            </Select>
          </label>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginTop: 8 }}>
            {template.brief.map((f) => (
              <label key={f.key} className="small" style={{ display: "grid", gap: 2 }} title={f.help}>
                {f.label}
                {f.required ? " *" : ""}
                {input(f)}
              </label>
            ))}
            {template.measures.map((m) => (
              <label key={m.key} className="small" style={{ display: "grid", gap: 2 }}>
                {`${m.label} (${m.unit})${m.required || !template.measures.some((x) => x.required) ? " *" : ""}`}
                <input className="input" inputMode="decimal" value={measure[m.key] ?? ""} onChange={(e) => setMeasure({ ...measure, [m.key]: e.target.value })} />
              </label>
            ))}
          </div>
          {data.briefMissing.length > 0 && bq?.brief && (
            <p className="small" style={{ marginTop: 6 }}>
              Still needed: {data.briefMissing.join("; ")}.
            </p>
          )}
          <button className="btn btn-sm btn-primary" style={{ marginTop: 8 }} disabled={busy} onClick={save}>
            Save job details
          </button>
          <ErrorNotice error={error} />
        </>
      )}
    </section>
  );
}

function BriefView({ data }: { data: AmBqView }) {
  const b = data.bq!.brief!;
  const t = data.templates.find((x) => x.kind === b.jobKind)!;
  return (
    <details className="panel">
      <summary>
        <b>Job details</b> <span className="muted small">by {b.by}</span>
      </summary>
      <div className="list">
        {t.brief
          .filter((f) => b.answers[f.key])
          .map((f) => (
            <div key={f.key} className="list-item small">
              <span className="muted">{f.label}</span>
              <span>{b.answers[f.key] === "yes" ? "Yes" : b.answers[f.key] === "no" ? "No" : b.answers[f.key]}</span>
            </div>
          ))}
      </div>
    </details>
  );
}

/** Reopen an approved BQ when the route was wrong or the scope changed; the quotes so far are kept as an earlier round. */
function Reopen({ workOrderId, reload }: { workOrderId: string; reload: () => void }) {
  const { run, busy, error } = useAction();
  const [reason, setReason] = useState("");
  return (
    <details style={{ marginTop: 8 }}>
      <summary className="btn btn-sm btn-ghost">Reopen the BQ</summary>
      <p className="muted small">Use this when the job must go out on another route or the scope changed. The quotes so far are kept as an earlier round.</p>
      <label className="small" style={{ display: "grid", gap: 2 }}>
        Reason
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button className="btn btn-sm" style={{ marginTop: 6 }} disabled={busy} onClick={() => run(() => api.amBqAction(workOrderId, { kind: "reopen", reason }), "BQ reopened").then(reload)}>
        Reopen
      </button>
      <ErrorNotice error={error} />
    </details>
  );
}

const NEXT: Record<string, string> = { approval: "Waiting for approval", ceo: "Waiting for the CEO's consent", chairman: "Waiting for the Chairman's consent" };
type VoLine = { lineId: string; item: string; unit: string; qty: string; rate: string; note: string };
const blankVo: VoLine = { lineId: "", item: "", unit: "", qty: "", rate: "", note: "" };

/**
 * Variation orders (Fauzan, 5 Nov 2026): after the award, every change of work or price goes through a VO. Each line
 * adds work or omits it (negative quantity) at the awarded rate, or a new rate with its reason. The Asset Director
 * approves, and the COO too when the VOs together pass the rule's share of the award or the price passes the limit.
 */
function Variations({ data, workOrderId, reload }: { data: AmBqView; workOrderId: string; reload: () => void }) {
  const bq = data.bq!;
  const price = data.price!;
  const vos = bq.variations ?? [];
  const awardedQuote = bq.quotes.find((q) => q.id === bq.award?.quoteId);
  const awardedRate = (lineId: string) => awardedQuote?.lines.find((l) => l.lineId === lineId)?.rate;
  const { run, busy, error } = useAction();
  const [reason, setReason] = useState("");
  const [ref, setRef] = useState("");
  const [lines, setLines] = useState<VoLine[]>([{ ...blankVo }]);
  const setLine = (i: number, patch: Partial<VoLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pickLine = (i: number, lineId: string) => {
    const r = lineId ? awardedRate(lineId) : undefined;
    setLine(i, { lineId, rate: r == null ? "" : String(r) });
  };
  const total = lines.reduce((n, l) => n + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
  const ask = () =>
    run(
      () =>
        api.amBqAction(workOrderId, {
          kind: "vo",
          reason,
          contractorRef: ref,
          lines: lines.map((l) => ({ lineId: l.lineId || null, item: l.item, unit: l.unit, qty: Number(l.qty), rate: Number(l.rate), note: l.note })),
        }),
      "Variation order sent for approval",
    ).then((r) => {
      if (r) {
        setReason("");
        setRef("");
        setLines([{ ...blankVo }]);
      }
      reload();
    });
  const state = (v: (typeof vos)[number]) =>
    v.final
      ? (["ok", "Approved, CEO and Chairman consented"] as const)
      : v.withdrawn
        ? (["neutral", "Withdrawn"] as const)
        : [v.director, v.coo, v.ceo, v.chairman].some((s) => s && !s.approve)
          ? (["crit", "Turned down"] as const)
        : (["warn", NEXT[price.openVo === v.id && price.openVoNext ? price.openVoNext : "approval"]] as const);
  return (
    <section className="panel">
      <h3>Variation orders</h3>
      <p className="small">
        Awarded {rm(price.awarded)} · price now <b>{rm(price.now)}</b>
        {price.now !== price.awarded ? ` (${price.voPct > 0 ? "+" : ""}${price.voPct}%)` : ""}
      </p>
      <p className="muted small">Every change of work or price after the award goes through a variation order. The work order price changes only when it is approved.</p>
      {vos.length > 0 && (
        <div className="list">
          {vos.map((v) => {
            const [tone, word] = state(v);
            return (
              <div key={v.id} className="list-item small" style={{ display: "block" }}>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  <b>{v.id}</b>
                  <span>
                    {v.amount >= 0 ? "+" : "-"}
                    {rm(Math.abs(v.amount))}
                  </span>
                  <Chip tone={tone}>{word}</Chip>
                  <span className="muted">
                    {v.askedBy}, {dateLabel(v.askedAt.slice(0, 10))}, contractor ref {v.contractorRef}
                  </span>
                </div>
                <div>{v.reason}</div>
                <ul style={{ margin: "4px 0" }}>
                  {v.lines.map((l, i) => (
                    <li key={i}>
                      {l.lineId ? `${l.lineId}. ` : "New: "}
                      {l.item}, {l.qty > 0 ? "+" : ""}
                      {l.qty} {l.unit} at {rm(l.rate)}
                      {l.note ? ` (${l.note})` : ""}
                    </li>
                  ))}
                </ul>
                <Steps
                  steps={[
                    ["Asset Director", v.director],
                    ["COO", v.coo],
                    ["CEO consent", v.ceo ?? null],
                    ["Chairman consent", v.chairman ?? null],
                  ]}
                  consent={["CEO consent", "Chairman consent"]}
                />
                {v.withdrawn && (
                  <div className="muted">
                    Withdrawn by {v.withdrawn.by}: {v.withdrawn.note}
                  </div>
                )}
                {data.role === "team" && price.openVo === v.id && <Withdraw voId={v.id} workOrderId={workOrderId} reload={reload} />}
              </div>
            );
          })}
        </div>
      )}
      {price.openVo && price.openVoCooToo && price.openVoNext === "approval" && <p className="muted small">The COO also approves {price.openVo}.</p>}
      <p className="muted small">After approval, every variation order, whatever its value, needs the CEO's consent and then the Chairman's before the price changes.</p>
      {data.can.decideVo && price.openVo && (
        <Decide
          label={`variation order ${price.openVo}`}
          onDecide={(approve, note) => api.amBqAction(workOrderId, { kind: "voDecide", voId: price.openVo!, approve, note })}
          reload={reload}
          returnWord={price.openVoNext === "approval" ? "Turn down" : "Refuse"}
          approveWord={price.openVoNext === "approval" ? "Approve" : "Consent"}
        />
      )}
      {data.can.askVo && (
        <details style={{ marginTop: 8 }}>
          <summary className="btn btn-sm">Raise a variation order</summary>
          <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            <label className="small" style={{ display: "grid", gap: 2, flex: "1 1 220px" }}>
              Why the work or price changes
              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <label className="small" style={{ display: "grid", gap: 2 }}>
              Contractor VO quote or letter number
              <input className="input" value={ref} onChange={(e) => setRef(e.target.value)} />
            </label>
          </div>
          <p className="muted small">Pick a BQ line to add or omit (a negative quantity omits), or leave it on new work. A rate other than the awarded rate needs its reason.</p>
          {lines.map((l, i) => (
            <div key={i} className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 4 }}>
              <Select className="input" aria-label={`VO line ${i + 1}`} value={l.lineId} onChange={(e) => pickLine(i, e.target.value)}>
                <option value="">New work</option>
                {bq.lines.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.id}. {b.item} ({b.unit})
                  </option>
                ))}
              </Select>
              {!l.lineId && (
                <>
                  <input className="input" aria-label={`Item ${i + 1}`} placeholder="Item" value={l.item} onChange={(e) => setLine(i, { item: e.target.value })} />
                  <input className="input" aria-label={`Unit ${i + 1}`} placeholder="Unit" value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} style={{ width: 70 }} />
                </>
              )}
              <input className="input" inputMode="decimal" aria-label={`Quantity ${i + 1}`} placeholder="Qty (+/-)" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} style={{ width: 90 }} />
              <input className="input" inputMode="decimal" aria-label={`Rate ${i + 1}`} placeholder="Rate RM" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} style={{ width: 100 }} />
              <input className="input" aria-label={`Note ${i + 1}`} placeholder="Note" value={l.note} onChange={(e) => setLine(i, { note: e.target.value })} />
              {lines.length > 1 && (
                <button className="btn btn-sm btn-ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                  Remove
                </button>
              )}
            </div>
          ))}
          <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            <button className="btn btn-sm btn-ghost" onClick={() => setLines([...lines, { ...blankVo }])} disabled={lines.length >= 50}>
              Add a line
            </button>
            <span className="small">
              This VO: {total >= 0 ? "+" : "-"}
              {rm(Math.abs(total))}, price would be {rm(price.now + total)}
            </span>
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={ask}>
              Send for approval
            </button>
          </div>
          <ErrorNotice error={error} />
        </details>
      )}
      {!data.can.askVo && <ErrorNotice error={error} />}
    </section>
  );
}

/** Withdraw a waiting VO with a reason, so a corrected one can be raised. */
function Withdraw({ voId, workOrderId, reload }: { voId: string; workOrderId: string; reload: () => void }) {
  const { run, busy, error } = useAction();
  const [reason, setReason] = useState("");
  return (
    <details style={{ marginTop: 4 }}>
      <summary className="btn btn-sm btn-ghost">Withdraw {voId}</summary>
      <label className="small" style={{ display: "grid", gap: 2 }}>
        Reason
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button className="btn btn-sm" style={{ marginTop: 6 }} disabled={busy} onClick={() => run(() => api.amBqAction(workOrderId, { kind: "voWithdraw", voId, reason }), `${voId} withdrawn`).then(reload)}>
        Withdraw
      </button>
      <ErrorNotice error={error} />
    </details>
  );
}
