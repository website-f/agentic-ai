import { Select } from '../SearchSelect';
import { useState } from "react";
import {
  NC_OUTCOME_LABEL,
  NC_SOURCE_LABEL,
  SUPPLIER_RESULT_LABEL,
  type NcOutcome,
  type NcSource,
} from "@prima/core";
import { api, type QmsOpsBoard } from "../api";
import { Chip, ErrorNotice, Kpi, dateLabel, useAction } from "../ui";

/**
 * Quality operations (Fauzan, 5 Nov 2026 "Build any not build"): service faults, supplier ratings, quality objectives,
 * controlled documents and management review, on the Quality and compliance screen. Guards and officers never see it.
 */

type FaultRow = QmsOpsBoard["faults"][number];
type SupplierRow = QmsOpsBoard["suppliers"][number];
type ItemRow = QmsOpsBoard["items"][number];
type Tone = "ok" | "warn" | "crit" | "info";
const col = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  marginBottom: 8,
} as const;
const line = {
  flexDirection: "column",
  alignItems: "stretch",
  gap: 4,
} as const;
const head = {
  justifyContent: "space-between",
  gap: 6,
  flexWrap: "wrap",
} as const;
const ITEM_STATUS: Record<ItemRow["item"]["status"], [Tone, string]> = {
  active: ["info", "On the way"],
  done: ["ok", "Reached"],
  retired: ["info", "Withdrawn"],
  draft: ["warn", "Waiting for a decision"],
  approved: ["ok", "In force"],
  not_agreed: ["warn", "Sent back"],
  replaced: ["info", "Replaced"],
};
const RESULT_TONE: Record<SupplierRow["rating"]["state"], Tone> = {
  not_rated: "warn",
  due: "warn",
  keep: "ok",
  watch: "warn",
  stop: "crit",
};
const RESULT_LABEL: Record<SupplierRow["rating"]["state"], string> = {
  not_rated: "Not rated yet",
  due: "Rating due",
  ...SUPPLIER_RESULT_LABEL,
};

// ---------- Service faults ----------

export function Faults({ data }: { data: QmsOpsBoard }) {
  const [adding, setAdding] = useState(false);
  const canAdd =
    data.role === "company" || data.role === "ops" || data.role === "act";
  return (
    <>
      <div className="kpis">
        <Kpi
          label="Open"
          value={data.kpis.faultsOpen}
          tone={data.kpis.faultsOpen ? "warn" : "ok"}
        />
        <Kpi
          label="Need a root cause"
          value={data.kpis.needRootCause}
          tone={data.kpis.needRootCause ? "warn" : "ok"}
        />
      </div>
      <p className="muted small">
        When the service was not what was agreed: record what happened and what
        was done at once. Serious faults, and a second fault at the same site
        within {data.rule.repeatDays} days, go to ACT to find the root cause.
      </p>
      <section className="panel">
        <div className="panel-head">
          <h3>Service faults</h3>
          {canAdd && (
            <button className="btn btn-sm" onClick={() => setAdding(!adding)}>
              {adding ? "Cancel" : "Record a fault"}
            </button>
          )}
        </div>
        {adding && <FaultForm data={data} onDone={() => setAdding(false)} />}
        <div className="list">
          {!data.faults.length && (
            <div className="empty">Nothing recorded.</div>
          )}
          {data.faults.map((r) => (
            <FaultLine key={r.nc.id} row={r} data={data} />
          ))}
        </div>
      </section>
    </>
  );
}

function FaultForm({
  data,
  onDone,
}: {
  data: QmsOpsBoard;
  onDone: () => void;
}) {
  const act = useAction();
  const [f, setF] = useState({
    siteId: "",
    source: "client_complaint" as NcSource,
    sourceRef: "",
    what: "",
    correction: "",
    serious: false,
    clientTold: false,
    clientNote: "",
    detectedOn: "",
  });
  return (
    <div style={col}>
      <Select
        className="select"
        aria-label="Site"
        value={f.siteId}
        onChange={(e) => setF({ ...f, siteId: e.target.value })}
      >
        <option value="">
          {data.role === "ops"
            ? "Choose the site"
            : "Site (if it was at a site)"}
        </option>
        {data.sites.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>
      <Select
        className="select"
        aria-label="Where it came from"
        value={f.source}
        onChange={(e) => setF({ ...f, source: e.target.value as NcSource })}
      >
        {(Object.keys(NC_SOURCE_LABEL) as NcSource[]).map((k) => (
          <option key={k} value={k}>
            {NC_SOURCE_LABEL[k]}
          </option>
        ))}
      </Select>
      <input
        className="input"
        aria-label="Reference"
        placeholder="Case or complaint reference (optional)"
        value={f.sourceRef}
        onChange={(e) => setF({ ...f, sourceRef: e.target.value })}
      />
      <textarea
        className="input"
        aria-label="What happened"
        rows={2}
        placeholder="What happened"
        value={f.what}
        onChange={(e) => setF({ ...f, what: e.target.value })}
      />
      <input
        className="input"
        aria-label="Done at once"
        placeholder="What was done at once"
        value={f.correction}
        onChange={(e) => setF({ ...f, correction: e.target.value })}
      />
      <label className="small">
        Date found
        <input
          className="input"
          type="date"
          value={f.detectedOn}
          onChange={(e) => setF({ ...f, detectedOn: e.target.value })}
        />
      </label>
      <label className="small row" style={{ gap: 6 }}>
        <input
          type="checkbox"
          checked={f.serious}
          onChange={(e) => setF({ ...f, serious: e.target.checked })}
        />{" "}
        Serious (safety, a client could end the contract, or the law)
      </label>
      <label className="small row" style={{ gap: 6 }}>
        <input
          type="checkbox"
          checked={f.clientTold}
          onChange={(e) => setF({ ...f, clientTold: e.target.checked })}
        />{" "}
        The client was told or answered
      </label>
      {f.clientTold && (
        <input
          className="input"
          aria-label="How the client was told"
          placeholder="How and when"
          value={f.clientNote}
          onChange={(e) => setF({ ...f, clientNote: e.target.value })}
        />
      )}
      <button
        className="btn btn-primary btn-sm"
        disabled={
          act.busy ||
          f.what.trim().length < 10 ||
          f.correction.trim().length < 5
        }
        onClick={() =>
          act
            .run(
              () =>
                api.qualityAction("recordFault", {
                  ...f,
                  companyId: data.companyId,
                  siteId: f.siteId || undefined,
                  detectedOn: f.detectedOn || undefined,
                }),
              "Recorded.",
            )
            .then((x) => x && onDone())
        }
      >
        Record
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function FaultLine({ row, data }: { row: FaultRow; data: QmsOpsBoard }) {
  const act = useAction();
  const [mode, setMode] = useState<"close" | "root" | null>(null);
  const [outcome, setOutcome] = useState<NcOutcome>("corrected");
  const [note, setNote] = useState("");
  const [clientName, setClientName] = useState("");
  const [owner, setOwner] = useState(data.owners[0]?.id ?? "");
  const [area, setArea] = useState("PATROL");
  const nc = row.nc;
  return (
    <div className="list-item" style={line}>
      <div className="row" style={head}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {nc.ref}: {nc.what}
          </div>
          <div className="muted small">
            {NC_SOURCE_LABEL[nc.source]}
            {row.siteName ? ` · ${row.siteName}` : ""} ·{" "}
            {dateLabel(nc.detectedOn)} · by {nc.by}
            {nc.sourceRef ? ` · ref ${nc.sourceRef}` : ""}
          </div>
          <div className="small">Done at once: {nc.correction}</div>
          <div className="muted small">
            {nc.clientTold
              ? `Client told: ${nc.clientNote || "yes"}`
              : "Client not told"}
          </div>
          {nc.rootCause && (
            <div className="small">
              Root cause: ACT finding {nc.rootCause.findingRef}
            </div>
          )}
          {nc.close && (
            <div className="small">
              {NC_OUTCOME_LABEL[nc.close.outcome]}
              {nc.close.clientName ? ` (${nc.close.clientName})` : ""} ·{" "}
              {nc.close.by}: {nc.close.note}
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
          {nc.serious && <Chip tone="crit">Serious</Chip>}
          {nc.repeatOf.length > 0 && (
            <Chip tone="warn">Repeat at this site</Chip>
          )}
          {row.needsRootCause && !nc.rootCause && (
            <Chip tone="warn">Root cause needed</Chip>
          )}
          <Chip tone={row.open ? "warn" : "ok"}>
            {row.open ? "Open" : "Closed"}
          </Chip>
        </div>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {row.canClose && (
          <button
            className="btn btn-sm"
            onClick={() => setMode(mode === "close" ? null : "close")}
          >
            {mode === "close" ? "Cancel" : "Close"}
          </button>
        )}
        {row.canRaise && (
          <button
            className="btn btn-sm"
            onClick={() => setMode(mode === "root" ? null : "root")}
          >
            {mode === "root" ? "Cancel" : "Find the root cause"}
          </button>
        )}
      </div>
      {mode === "close" && (
        <div style={col}>
          <Select
            className="select"
            aria-label="How it ended"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as NcOutcome)}
          >
            {(Object.keys(NC_OUTCOME_LABEL) as NcOutcome[]).map((k) => (
              <option key={k} value={k}>
                {NC_OUTCOME_LABEL[k]}
              </option>
            ))}
          </Select>
          {outcome === "client_accepted" && (
            <input
              className="input"
              aria-label="Client person"
              placeholder="Client person who accepted it"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
            />
          )}
          <input
            className="input"
            aria-label="What was done"
            placeholder="What was done (needed)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || note.trim().length < 3}
            onClick={() =>
              act
                .run(
                  () =>
                    api.qualityAction("closeFault", {
                      id: nc.id,
                      outcome,
                      note,
                      clientName,
                    }),
                  "Closed.",
                )
                .then((x) => x && setMode(null))
            }
          >
            Close the fault
          </button>
        </div>
      )}
      {mode === "root" && (
        <div style={col}>
          <Select
            className="select"
            aria-label="Owner"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          >
            {data.owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
          <Select
            className="select"
            aria-label="Workflow"
            value={area}
            onChange={(e) => setArea(e.target.value)}
          >
            {data.actAreas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || !owner}
            onClick={() =>
              act
                .run(
                  () =>
                    api.qualityAction("rootCause", {
                      id: nc.id,
                      ownerUserId: owner,
                      area,
                    }),
                  "Raised as an ACT finding.",
                )
                .then((x) => x && setMode(null))
            }
          >
            Raise as an ACT finding
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

// ---------- Suppliers ----------

export function Suppliers({ data }: { data: QmsOpsBoard }) {
  return (
    <>
      <div className="kpis">
        <Kpi
          label="To rate"
          value={data.kpis.suppliersDue}
          tone={data.kpis.suppliersDue ? "warn" : "ok"}
        />
        <Kpi
          label="On watch"
          value={data.kpis.suppliersWatch}
          tone={data.kpis.suppliersWatch ? "warn" : "ok"}
        />
      </div>
      <p className="muted small">
        Rate each supplier on quality, time and paperwork from 1 (poor) to 5
        (very good), at least once a year. Stop blocks the supplier; only
        Finance can unblock it.
      </p>
      <section className="panel">
        <div className="list">
          {!data.suppliers.length && <div className="empty">No suppliers.</div>}
          {data.suppliers.map((s) => (
            <SupplierLine key={s.id} row={s} />
          ))}
        </div>
      </section>
    </>
  );
}

function SupplierLine({ row }: { row: SupplierRow }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [g, setG] = useState({
    quality: 4,
    onTime: 4,
    paperwork: 4,
    result: "keep" as keyof typeof SUPPLIER_RESULT_LABEL,
    issues: "",
  });
  const last = row.rating.last;
  const st =
    row.blocked && row.rating.state !== "stop" ? null : row.rating.state;
  return (
    <div className="list-item" style={line}>
      <div className="row" style={head}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{row.name}</div>
          <div className="muted small">{row.companyName}</div>
          {last && (
            <div className="small">
              Last rated {dateLabel(last.on)} by {last.by}: quality{" "}
              {last.quality}, time {last.onTime}, paperwork {last.paperwork}
              {last.issues ? ` · ${last.issues}` : ""}
            </div>
          )}
          {row.rating.dueOn && (
            <div className="muted small">
              Next rating by {dateLabel(row.rating.dueOn)}
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 4 }}>
          {row.blocked && <Chip tone="crit">Blocked</Chip>}
          {st && <Chip tone={RESULT_TONE[st]}>{RESULT_LABEL[st]}</Chip>}
        </div>
      </div>
      {row.canRate && (
        <button
          className="btn btn-sm"
          style={{ alignSelf: "flex-start" }}
          onClick={() => setOpen(!open)}
        >
          {open ? "Cancel" : "Rate"}
        </button>
      )}
      {open && (
        <div style={col}>
          {(["quality", "onTime", "paperwork"] as const).map((k) => (
            <label key={k} className="small">
              {k === "quality"
                ? "Quality of goods or work"
                : k === "onTime"
                  ? "On time"
                  : "Paperwork right (invoice, delivery order, certificates)"}
              <Select
                className="select"
                value={g[k]}
                onChange={(e) => setG({ ...g, [k]: Number(e.target.value) })}
              >
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </label>
          ))}
          <Select
            className="select"
            aria-label="Result"
            value={g.result}
            onChange={(e) =>
              setG({ ...g, result: e.target.value as typeof g.result })
            }
          >
            {(
              Object.keys(
                SUPPLIER_RESULT_LABEL,
              ) as (keyof typeof SUPPLIER_RESULT_LABEL)[]
            ).map((k) => (
              <option key={k} value={k}>
                {SUPPLIER_RESULT_LABEL[k]}
              </option>
            ))}
          </Select>
          <input
            className="input"
            aria-label="What went wrong"
            placeholder="What went wrong (needed for watch, stop or a score of 2 or less)"
            value={g.issues}
            onChange={(e) => setG({ ...g, issues: e.target.value })}
          />
          {g.result === "stop" && (
            <div className="notice" data-tone="warn">
              Stop blocks this supplier now. Only Finance can unblock it.
            </div>
          )}
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy}
            onClick={() =>
              act
                .run(
                  () => api.qualityAction("rateSupplier", { id: row.id, ...g }),
                  "Rated.",
                )
                .then((x) => x && setOpen(false))
            }
          >
            Save the rating
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

// ---------- Objectives, documents, review ----------

export function Items({
  data,
  kind,
}: {
  data: QmsOpsBoard;
  kind: "objective" | "document" | "review";
}) {
  const [adding, setAdding] = useState(false);
  const keeper = data.role === "act" || data.role === "keep";
  const rows = data.items.filter(
    (r) =>
      r.item.kind === kind &&
      (r.item.status !== "replaced" || kind !== "document"),
  );
  const title =
    kind === "objective"
      ? "Quality objectives"
      : kind === "document"
        ? "Controlled documents"
        : "Management review";
  return (
    <>
      {kind === "objective" && (
        <Kpi
          label="Past their date"
          value={data.kpis.objectivesLate}
          tone={data.kpis.objectivesLate ? "warn" : "ok"}
        />
      )}
      <p className="muted small">
        {kind === "objective"
          ? "A few measurable targets for the year, each with an owner and a date. ACT or the Chief of Staff records progress."
          : kind === "document"
            ? "The procedures and forms in force, by code and version. The file stays in SharePoint; Prima keeps the link and does not check the file. A new version is approved by a second person, never its writer."
            : "Prima puts together the figures for the review. ACT or the Chief of Staff writes the record with decisions, owners and dates; the CEO agrees it."}
      </p>
      {kind === "review" && data.pack && <Pack pack={data.pack} />}
      <section className="panel">
        <div className="panel-head">
          <h3>{title}</h3>
          {keeper && (
            <button className="btn btn-sm" onClick={() => setAdding(!adding)}>
              {adding ? "Cancel" : "Add"}
            </button>
          )}
        </div>
        {adding && <ItemForm kind={kind} onDone={() => setAdding(false)} />}
        <div className="list">
          {!rows.length && <div className="empty">Nothing recorded.</div>}
          {rows.map((r) => (
            <ItemLine key={r.item.id} row={r} />
          ))}
        </div>
      </section>
    </>
  );
}

function Pack({ pack }: { pack: NonNullable<QmsOpsBoard["pack"]> }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Inputs for the review</h3>
      </div>
      <div className="table-wrap">
        <table className="table">
          <tbody>
            {pack.items.map((i) => (
              <tr key={i.label}>
                <td style={{ fontWeight: 600 }}>{i.label}</td>
                <td>{i.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        {pack.note} As of {dateLabel(pack.asOf)}.
      </p>
    </section>
  );
}

function ItemLine({ row }: { row: ItemRow }) {
  const act = useAction();
  const [note, setNote] = useState("");
  const [value, setValue] = useState("");
  const [edit, setEdit] = useState(false);
  const i = row.item;
  const [tone, label] = ITEM_STATUS[i.status];
  const last = i.progress?.at(-1);
  return (
    <div className="list-item" style={line}>
      <div className="row" style={head}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {i.kind === "document" ? `${i.code} ` : ""}
            {i.title}
            {i.kind === "document" ? `, version ${i.version}` : ""}
          </div>
          {i.body && (
            <div className="small" style={{ whiteSpace: "pre-wrap" }}>
              {i.body}
            </div>
          )}
          {i.kind === "objective" && (
            <>
              <div className="small">
                {i.measure}: target {i.target} by {dateLabel(i.dueOn ?? "")} ·
                owner {i.ownerTitle}
              </div>
              <div className="muted small">
                {last
                  ? `Now ${last.value} (${dateLabel(last.on)})${last.note ? `: ${last.note}` : ""}`
                  : "No progress recorded yet"}
              </div>
            </>
          )}
          {i.kind === "document" && (
            <>
              <div className="muted small">
                Owner {i.ownerTitle}
                {i.audience ? ` · for ${i.audience}` : ""} · review by{" "}
                {dateLabel(row.reviewDueOn)}
              </div>
              {i.link && (
                <div className="small">
                  <a href={i.link} target="_blank" rel="noreferrer noopener">
                    Open the file
                  </a>{" "}
                  <span className="muted">(link not checked by Prima)</span>
                </div>
              )}
            </>
          )}
          {i.kind === "review" && (
            <>
              <div className="muted small">
                Held {dateLabel(i.heldOn ?? "")} · {i.attendees}
              </div>
              {(i.decisions ?? []).map((d, n) => (
                <div key={n} className="small">
                  {n + 1}. {d.text} · {d.ownerTitle} by {dateLabel(d.dueOn)}
                </div>
              ))}
              {!!i.inputs?.length && (
                <div className="muted small">
                  {i.inputs.length} inputs from Prima kept with the record.
                </div>
              )}
            </>
          )}
          {i.decision && (
            <div className="muted small">
              {i.decision.agree ? "Agreed" : "Sent back"} by {i.decision.by}:{" "}
              {i.decision.note}
            </div>
          )}
          <div className="muted small">Written by {i.by}</div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          {row.late && (
            <Chip tone="warn">
              {i.kind === "objective" ? "Past its date" : "Review due"}
            </Chip>
          )}
          <Chip tone={tone}>{label}</Chip>
        </div>
      </div>
      {row.canProgress && (
        <input
          className="input"
          aria-label="Figure now"
          placeholder="Figure now"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      )}
      {(row.canDecide || row.canReview || row.canRetire || row.canProgress) && (
        <input
          className="input"
          aria-label="Reason"
          placeholder={row.canProgress ? "Note" : "Reason (needed)"}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      )}
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {row.canDecide && (
          <>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || note.trim().length < 3}
              onClick={() =>
                act.run(
                  () =>
                    api.qualityAction("decideItem", {
                      id: i.id,
                      agree: true,
                      note,
                    }),
                  "Agreed.",
                )
              }
            >
              {i.kind === "review" ? "Agree the record" : "Approve"}
            </button>
            <button
              className="btn btn-sm"
              disabled={act.busy || note.trim().length < 3}
              onClick={() =>
                act.run(
                  () =>
                    api.qualityAction("decideItem", {
                      id: i.id,
                      agree: false,
                      note,
                    }),
                  "Sent back.",
                )
              }
            >
              Send back
            </button>
          </>
        )}
        {row.canProgress && (
          <>
            <button
              className="btn btn-sm"
              disabled={act.busy || !value.trim()}
              onClick={() =>
                act.run(
                  () =>
                    api.qualityAction("progress", { id: i.id, value, note }),
                  "Saved.",
                )
              }
            >
              Record progress
            </button>
            <button
              className="btn btn-sm"
              disabled={act.busy || !value.trim() || note.trim().length < 3}
              onClick={() =>
                act.run(
                  () =>
                    api.qualityAction("progress", {
                      id: i.id,
                      value,
                      note,
                      done: true,
                    }),
                  "Marked reached.",
                )
              }
            >
              Reached
            </button>
          </>
        )}
        {row.canReview && (
          <button
            className="btn btn-sm"
            disabled={act.busy || note.trim().length < 3}
            onClick={() =>
              act.run(
                () => api.qualityAction("reviewItem", { id: i.id, note }),
                "Review recorded.",
              )
            }
          >
            Reviewed, no change
          </button>
        )}
        {row.canRetire && (
          <button
            className="btn btn-sm"
            disabled={act.busy || note.trim().length < 3}
            onClick={() =>
              act.run(
                () => api.qualityAction("retireItem", { id: i.id, note }),
                "Withdrawn.",
              )
            }
          >
            Withdraw
          </button>
        )}
        {row.canEdit && (
          <button className="btn btn-sm" onClick={() => setEdit(!edit)}>
            {edit
              ? "Cancel"
              : i.kind === "document" && i.status === "approved"
                ? "New version"
                : "Change"}
          </button>
        )}
      </div>
      {edit && (
        <ItemForm kind={i.kind} item={i} onDone={() => setEdit(false)} />
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function ItemForm({
  kind,
  item,
  onDone,
}: {
  kind: "objective" | "document" | "review";
  item?: ItemRow["item"];
  onDone: () => void;
}) {
  const act = useAction();
  const [g, setG] = useState({
    title: item?.title ?? "",
    body: item?.body ?? "",
    measure: item?.measure ?? "",
    target: item?.target ?? "",
    ownerTitle: item?.ownerTitle ?? "",
    dueOn: item?.dueOn ?? "",
    code: item?.code ?? "",
    link: item?.link ?? "",
    audience: item?.audience ?? "",
    reviewEveryMonths:
      item?.reviewEveryMonths ?? (kind === "document" ? 24 : 12),
    heldOn: item?.heldOn ?? "",
    attendees: item?.attendees ?? "",
    note: "",
  });
  const [decisions, setDecisions] = useState<
    { text: string; ownerTitle: string; dueOn: string }[]
  >(
    item?.decisions?.length
      ? item.decisions
      : [{ text: "", ownerTitle: "", dueOn: "" }],
  );
  const set = (k: keyof typeof g) => (e: { target: { value: string } }) =>
    setG({ ...g, [k]: e.target.value });
  const decided = kind !== "objective";
  return (
    <div style={col}>
      {kind === "document" && (
        <input
          className="input"
          aria-label="Code"
          placeholder="Code, for example SOP-OPS-01"
          value={g.code}
          disabled={!!item}
          onChange={set("code")}
        />
      )}
      <input
        className="input"
        aria-label="Title"
        placeholder="Title"
        value={g.title}
        onChange={set("title")}
      />
      {kind !== "review" && (
        <textarea
          className="input"
          aria-label="Notes"
          rows={2}
          placeholder={
            kind === "document"
              ? "What changed in this version (optional)"
              : "Notes (optional)"
          }
          value={g.body}
          onChange={set("body")}
        />
      )}
      {kind === "objective" && (
        <>
          <input
            className="input"
            aria-label="Measure"
            placeholder="How it is measured"
            value={g.measure}
            onChange={set("measure")}
          />
          <input
            className="input"
            aria-label="Target"
            placeholder="Target"
            value={g.target}
            onChange={set("target")}
          />
          <input
            className="input"
            aria-label="Owner"
            placeholder="Owner by job title"
            value={g.ownerTitle}
            onChange={set("ownerTitle")}
          />
          <label className="small">
            Reach by
            <input
              className="input"
              type="date"
              value={g.dueOn}
              onChange={set("dueOn")}
            />
          </label>
        </>
      )}
      {kind === "document" && (
        <>
          <input
            className="input"
            aria-label="Owner"
            placeholder="Owner by job title"
            value={g.ownerTitle}
            onChange={set("ownerTitle")}
          />
          <input
            className="input"
            aria-label="Link"
            placeholder="SharePoint link (https://...)"
            value={g.link}
            onChange={set("link")}
          />
          <input
            className="input"
            aria-label="Who uses it"
            placeholder="Who uses it"
            value={g.audience}
            onChange={set("audience")}
          />
          <label className="small">
            Review every (months)
            <input
              className="input"
              type="number"
              min={1}
              max={36}
              value={g.reviewEveryMonths}
              onChange={set("reviewEveryMonths")}
            />
          </label>
        </>
      )}
      {kind === "review" && (
        <>
          <label className="small">
            Held on
            <input
              className="input"
              type="date"
              value={g.heldOn}
              onChange={set("heldOn")}
            />
          </label>
          <input
            className="input"
            aria-label="Who attended"
            placeholder="Who attended"
            value={g.attendees}
            onChange={set("attendees")}
          />
          <div className="small" style={{ fontWeight: 600 }}>
            Decisions and actions
          </div>
          {decisions.map((d, n) => (
            <div key={n} style={{ display: "grid", gap: 4 }}>
              <input
                className="input"
                aria-label={`Decision ${n + 1}`}
                placeholder="Decision or action"
                value={d.text}
                onChange={(e) =>
                  setDecisions(
                    decisions.map((x, j) =>
                      j === n ? { ...x, text: e.target.value } : x,
                    ),
                  )
                }
              />
              <input
                className="input"
                aria-label={`Owner ${n + 1}`}
                placeholder="Owner by job title"
                value={d.ownerTitle}
                onChange={(e) =>
                  setDecisions(
                    decisions.map((x, j) =>
                      j === n ? { ...x, ownerTitle: e.target.value } : x,
                    ),
                  )
                }
              />
              <input
                className="input"
                type="date"
                aria-label={`Date ${n + 1}`}
                value={d.dueOn}
                onChange={(e) =>
                  setDecisions(
                    decisions.map((x, j) =>
                      j === n ? { ...x, dueOn: e.target.value } : x,
                    ),
                  )
                }
              />
            </div>
          ))}
          <button
            className="btn btn-sm"
            style={{ alignSelf: "flex-start" }}
            onClick={() =>
              setDecisions([
                ...decisions,
                { text: "", ownerTitle: "", dueOn: "" },
              ])
            }
          >
            Add a decision
          </button>
          <div className="muted small">
            Prima keeps its figures as they are today with the record.
          </div>
        </>
      )}
      {item && (
        <input
          className="input"
          aria-label="What changed"
          placeholder="What changed"
          value={g.note}
          onChange={set("note")}
        />
      )}
      <button
        className="btn btn-primary btn-sm"
        disabled={act.busy || g.title.trim().length < 3}
        onClick={() =>
          act
            .run(
              () =>
                api.qualityAction("saveItem", {
                  ...g,
                  id: item?.id,
                  kind,
                  reviewEveryMonths: Number(g.reviewEveryMonths),
                  decisions: decisions.filter((d) => d.text.trim()),
                }),
              decided ? "Sent for a decision." : "Saved.",
            )
            .then((x) => x && onDone())
        }
      >
        {kind === "review"
          ? "Save and send to the CEO"
          : kind === "document"
            ? "Save and send for approval"
            : "Save"}
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}
