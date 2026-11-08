import { Select } from '../SearchSelect';
import { useState } from "react";
import { api } from "../api";
import type {
  OpportunityInput,
  SourceCheckInput,
  TenderOpportunities,
  TenderSources,
} from "../api/types";
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

type Opp = TenderOpportunities["rows"][number];

/**
 * Tenders and quotation opportunities found (Fauzan, 4 Nov 2026). The Director Office records what it finds and sets
 * which companies enter; a company may enter one itself, or tell the Director Office about one it found. That only
 * informs the Director Office: no approval is needed.
 */
export function TenderOpportunitiesPanel({
  companyId,
}: {
  companyId?: string;
}) {
  const { data, error } = useLoad(() => api.tenderOpportunities(), []);
  const [adding, setAdding] = useState(false);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="opportunities" />;
  const doa = data.canAssign;
  const open = data.rows.filter((r) => !r.closed);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Tenders and quotations found (peluang)</h3>
        {data.canRecord && !adding && (
          <button className="btn btn-sm" onClick={() => setAdding(true)}>
            {doa ? "Record what was found" : "Tell the Director Office"}
          </button>
        )}
      </div>
      <p className="muted small" style={{ margin: "0 0 8px" }}>
        {doa
          ? "Record each tender or quotation found and set which companies enter it. Companies can also enter one themselves or tell you about one they found; that only informs you."
          : "The Director Office lists what it found and may set your company to enter. You can also enter one yourself, or tell the Director Office about a tender or quotation you found or entered. No approval needed."}
      </p>
      {doa && (
        <div className="kpis">
          <Kpi label="Open" value={open.length} />
          <Kpi
            label="Open, no company yet"
            value={open.filter((r) => r.entries.length === 0).length}
            tone={open.some((r) => !r.entries.length) ? "warn" : "ok"}
          />
          <Kpi
            label="Companies told you"
            value={data.rows.reduce((a, r) => a + r.informedByCompany, 0)}
          />
        </div>
      )}
      {adding && (
        <RecordForm
          data={data}
          companyId={companyId}
          onDone={() => setAdding(false)}
        />
      )}
      <div className="list">
        {data.rows.length === 0 && (
          <div className="muted">Nothing recorded yet.</div>
        )}
        {data.rows.map((r) => (
          <OppRow key={r.id} r={r} data={data} companyId={companyId} />
        ))}
      </div>
    </section>
  );
}

function OppRow({
  r,
  data,
  companyId,
}: {
  r: Opp;
  data: TenderOpportunities;
  companyId?: string;
}) {
  const act = useAction();
  const [picked, setPicked] = useState<string[]>([]);
  const [pick, setPick] = useState(false);
  const doa = data.canAssign;
  const mine = companyId ? r.canEnter.includes(companyId) : false;
  const companyName = (id: string) =>
    data.companies.find((c) => c.id === id)?.name ?? id;
  return (
    <div
      className="list-item"
      style={{ alignItems: "flex-start", flexDirection: "column", gap: 4 }}
    >
      <div style={{ fontWeight: 600 }}>
        {r.title}{" "}
        <span className="muted small">
          ({r.kind === "TENDER" ? "Tender" : "Quotation"})
        </span>
      </div>
      <div className="muted small">
        {r.buyer}
        {r.ref ? (
          <>
            {" · "}
            <span className="mono">{r.ref}</span>
          </>
        ) : null}
        {" · "}
        {r.channel === "GOVERNMENT" ? "Government" : "Private"} · closes{" "}
        {dateLabel(r.closesOn)}
        {r.closed
          ? " (closed)"
          : r.daysLeft <= 7
            ? ` (${r.daysLeft} day(s) left)`
            : ""}{" "}
        · found via {r.source}
      </div>
      <div className="muted small">
        {r.origin === "DOA"
          ? "Recorded by the Director Office"
          : "A company told the Director Office"}{" "}
        ({r.foundBy}, {dateTimeLabel(r.foundAt)}){r.note ? ` · ${r.note}` : ""}
      </div>
      <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
        {r.entries.length === 0 && (
          <Chip tone={r.closed ? "neutral" : "warn"}>
            No company entering yet
          </Chip>
        )}
        {r.entries.map((e) => (
          <Chip
            key={e.companyId}
            tone={e.setBy === "DOA" ? "ok" : "neutral"}
            title={`${e.by}, ${dateTimeLabel(e.at)}${e.note ? `: ${e.note}` : ""}`}
          >
            {e.companyName}: {e.setBy === "DOA" ? "set by DOA" : "own entry"}
          </Chip>
        ))}
      </div>
      <ErrorNotice error={act.error} />
      {doa && !r.closed && r.canEnter.length > 0 && !pick && (
        <button className="btn btn-sm" onClick={() => setPick(true)}>
          Set companies to enter
        </button>
      )}
      {doa && pick && (
        <div className="field">
          {r.canEnter.map((c) => (
            <label key={c} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={picked.includes(c)}
                onChange={(x) =>
                  setPicked(
                    x.target.checked
                      ? [...picked, c]
                      : picked.filter((p) => p !== c),
                  )
                }
              />
              {companyName(c)}
            </label>
          ))}
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !picked.length}
              onClick={async () => {
                if (
                  await act.run(
                    () => api.enterTenderOpportunity(r.id, picked, ""),
                    "Companies set to enter.",
                  )
                ) {
                  setPick(false);
                  setPicked([]);
                }
              }}
            >
              Set them to enter
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setPick(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {!doa && mine && (
        <button
          className="btn btn-sm"
          disabled={act.busy}
          onClick={() =>
            act.run(
              () => api.enterTenderOpportunity(r.id, [companyId!], ""),
              "Entered. The Director Office is informed.",
            )
          }
        >
          We are entering this
        </button>
      )}
    </div>
  );
}

function RecordForm({
  data,
  companyId,
  onDone,
}: {
  data: TenderOpportunities;
  companyId?: string;
  onDone: () => void;
}) {
  const act = useAction();
  const doa = data.canAssign;
  const [f, setF] = useState<OpportunityInput>({
    kind: "TENDER",
    ref: "",
    title: "",
    buyer: "",
    channel: "GOVERNMENT",
    source: "",
    closesOn: "",
    guards: null,
    note: "",
  });
  const [picked, setPicked] = useState<string[]>([]);
  const ownCompany =
    companyId && data.companies.some((c) => c.id === companyId)
      ? companyId
      : data.companies[0]?.id;
  const set = (patch: Partial<OpportunityInput>) => setF({ ...f, ...patch });
  return (
    <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <label className="field">
          <span className="label">Kind</span>
          <select
            className="select"
            value={f.kind}
            onChange={(e) =>
              set({ kind: e.target.value as OpportunityInput["kind"] })
            }
          >
            <option value="TENDER">Tender</option>
            <option value="QUOTATION">
              Quotation (sebut harga) or proposal
            </option>
          </select>
        </label>
        <label className="field">
          <span className="label">Government or private</span>
          <select
            className="select"
            value={f.channel}
            onChange={(e) =>
              set({ channel: e.target.value as OpportunityInput["channel"] })
            }
          >
            <option value="GOVERNMENT">Government</option>
            <option value="PRIVATE">Private</option>
          </select>
        </label>
        <label className="field">
          <span className="label">Closes on</span>
          <input
            className="input"
            type="date"
            value={f.closesOn}
            onChange={(e) => set({ closesOn: e.target.value })}
          />
        </label>
      </div>
      <label className="field">
        <span className="label">Title</span>
        <input
          className="input"
          value={f.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="e.g. Guarding services, Zone E"
        />
      </label>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <label className="field">
          <span className="label">Buyer or client</span>
          <input
            className="input"
            value={f.buyer}
            onChange={(e) => set({ buyer: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="label">Tender or quotation number</span>
          <input
            className="input"
            value={f.ref}
            onChange={(e) => set({ ref: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="label">Where found</span>
          <input
            className="input"
            value={f.source}
            onChange={(e) => set({ source: e.target.value })}
            placeholder="Portal, client, branch"
          />
        </label>
        <label className="field">
          <span className="label">Guards (if known)</span>
          <input
            className="input"
            type="number"
            min={0}
            value={f.guards ?? ""}
            onChange={(e) =>
              set({
                guards: e.target.value === "" ? null : Number(e.target.value),
              })
            }
          />
        </label>
      </div>
      <label className="field">
        <span className="label">Note</span>
        <input
          className="input"
          value={f.note}
          onChange={(e) => set({ note: e.target.value })}
          placeholder="Briefing, site visit, conditions"
        />
      </label>
      {doa ? (
        <div className="field">
          <span className="label">
            Companies to enter (you can also set them later)
          </span>
          {data.companies.map((c) => (
            <label key={c.id} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={picked.includes(c.id)}
                onChange={(x) =>
                  setPicked(
                    x.target.checked
                      ? [...picked, c.id]
                      : picked.filter((p) => p !== c.id),
                  )
                }
              />
              {c.name}
            </label>
          ))}
        </div>
      ) : (
        <p className="muted small">
          Your company is entered and the Director Office is informed.
        </p>
      )}
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy}
          onClick={async () => {
            const input = doa
              ? { ...f, companyIds: picked }
              : { ...f, companyId: ownCompany };
            if (
              await act.run(
                () => api.recordTenderOpportunity(input),
                doa
                  ? "Recorded."
                  : "Recorded. The Director Office is informed.",
              )
            )
              onDone();
          }}
        >
          Save
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Buyer and portal sites the Director Office checks for tenders (Fauzan, 4 Nov 2026). Prima never visits these sites;
 * staff record what they saw. A page that could be read is not proof every tender was seen.
 */
export function TenderSourcesPanel() {
  const { data, error } = useLoad(() => api.tenderSources(), []);
  const act = useAction();
  const [adding, setAdding] = useState(false);
  const [showAll, setShowAll] = useState(false);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="tender sites" />;
  const rows = showAll ? data.rows : data.rows.filter((r) => r.active);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Sites to check for tenders</h3>
        {data.canEdit && (
          <div className="row" style={{ gap: 6 }}>
            {data.starterLeft > 0 && (
              <button
                className="btn btn-sm"
                disabled={act.busy}
                onClick={() =>
                  act.run(() => api.loadTenderSourceStarter(), "Sites added.")
                }
              >
                Add the {data.starterLeft} sites from the 4 Nov sweep
              </button>
            )}
            {!adding && (
              <button className="btn btn-sm" onClick={() => setAdding(true)}>
                Add a site
              </button>
            )}
          </div>
        )}
      </div>
      <p className="muted small" style={{ margin: "0 0 8px" }}>
        Staff check each site and record what they saw. Prima does not visit,
        register or log in to these sites. A page that could be read does not
        prove every tender or vendor invitation was seen; a failed or partly
        read page is checked again on the next sweep.
      </p>
      <div className="kpis">
        <Kpi label="Sites watched" value={data.summary.watched} />
        <Kpi
          label="Due for checking"
          value={data.summary.due}
          tone={data.summary.due ? "warn" : "ok"}
        />
        <Kpi
          label="Vendor login not reached"
          value={data.summary.vendorLimited}
        />
        <Kpi
          label="Partly read"
          value={data.summary.partial}
          tone={data.summary.partial ? "warn" : undefined}
        />
        <Kpi
          label="Could not open"
          value={data.summary.error}
          tone={data.summary.error ? "crit" : undefined}
        />
      </div>
      <ErrorNotice error={act.error} />
      {adding && <AddSource onDone={() => setAdding(false)} />}
      <div className="list">
        {rows.length === 0 && <div className="muted">No sites yet.</div>}
        {rows.map((r) => (
          <SourceRow
            key={r.id}
            r={r}
            canEdit={data.canEdit}
            labels={data.statusLabels}
          />
        ))}
      </div>
      {data.rows.some((r) => !r.active) && (
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setShowAll(!showAll)}
        >
          {showAll
            ? "Hide sites no longer watched"
            : "Show sites no longer watched"}
        </button>
      )}
    </section>
  );
}

function SourceRow({
  r,
  canEdit,
  labels,
}: {
  r: TenderSources["rows"][number];
  canEdit: boolean;
  labels: TenderSources["statusLabels"];
}) {
  const [checking, setChecking] = useState(false);
  const [history, setHistory] = useState(false);
  const act = useAction();
  const last = r.checks[0];
  const tone = !last
    ? "warn"
    : last.status === "ERROR"
      ? "crit"
      : last.status === "PARTIAL"
        ? "warn"
        : "ok";
  return (
    <div
      className="list-item"
      style={{ alignItems: "flex-start", flexDirection: "column", gap: 4 }}
    >
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <strong>{r.buyer}</strong>
        <Chip tone={tone}>{r.statusLabel}</Chip>
        {r.due && <Chip tone="warn">{r.why}</Chip>}
        {!r.active && <Chip tone="neutral">Not watched</Chip>}
      </div>
      <div
        className="small"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          minWidth: 0,
          maxWidth: "100%",
        }}
      >
        {r.urls.map((u) => (
          <a
            key={u}
            href={u}
            target="_blank"
            rel="noopener noreferrer"
            style={{ overflowWrap: "anywhere" }}
          >
            {u}
          </a>
        ))}
      </div>
      {last && (
        <div className="muted small">
          {dateTimeLabel(last.at)} by {last.by}: {last.result}
          {last.found ? ` · ${last.found} found` : ""}
          {last.followUp ? ` · Follow-up: ${last.followUp}` : ""}
        </div>
      )}
      {history &&
        r.checks.slice(1).map((c) => (
          <div key={c.at} className="muted small">
            {dateTimeLabel(c.at)} by {c.by}: {labels[c.status]}. {c.result}
          </div>
        ))}
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {canEdit && r.active && !checking && (
          <button className="btn btn-sm" onClick={() => setChecking(true)}>
            Record a check
          </button>
        )}
        {r.checks.length > 1 && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setHistory(!history)}
          >
            {history
              ? "Hide earlier checks"
              : `Earlier checks (${r.checks.length - 1})`}
          </button>
        )}
        {canEdit && (
          <button
            className="btn btn-ghost btn-sm"
            disabled={act.busy}
            onClick={() =>
              act.run(
                () => api.updateTenderSource(r.id, { active: !r.active }),
                r.active ? "No longer watched." : "Watched again.",
              )
            }
          >
            {r.active ? "Stop watching" : "Watch again"}
          </button>
        )}
      </div>
      {checking && (
        <CheckForm
          id={r.id}
          labels={labels}
          onDone={() => setChecking(false)}
        />
      )}
    </div>
  );
}

function CheckForm({
  id,
  labels,
  onDone,
}: {
  id: string;
  labels: TenderSources["statusLabels"];
  onDone: () => void;
}) {
  const act = useAction();
  const [f, setF] = useState<SourceCheckInput>({
    status: "CHECKED",
    result: "",
    followUp: "",
    found: 0,
  });
  return (
    <div style={{ display: "grid", gap: 8, width: "100%" }}>
      <label className="field">
        <span className="label">What the check found</span>
        <Select
          className="select"
          value={f.status}
          onChange={(e) =>
            setF({ ...f, status: e.target.value as SourceCheckInput["status"] })
          }
        >
          {(["CHECKED", "VENDOR_LIMITED", "PARTIAL", "ERROR"] as const).map(
            (s) => (
              <option key={s} value={s}>
                {labels[s]}
              </option>
            ),
          )}
        </Select>
      </label>
      <label className="field">
        <span className="label">Result and gaps</span>
        <textarea
          className="textarea"
          value={f.result}
          onChange={(e) => setF({ ...f, result: e.target.value })}
          placeholder="e.g. 6 guarding tenders confirmed from the PDFs; supplier page timed out"
        />
      </label>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <label className="field">
          <span className="label">Tenders found</span>
          <input
            className="input"
            type="number"
            min={0}
            value={f.found}
            onChange={(e) => setF({ ...f, found: Number(e.target.value) || 0 })}
          />
        </label>
        <label className="field" style={{ flex: 1 }}>
          <span className="label">Follow-up</span>
          <input
            className="input"
            value={f.followUp}
            onChange={(e) => setF({ ...f, followUp: e.target.value })}
            placeholder="Confirm registration, certificates, field codes; retry"
          />
        </label>
      </div>
      {f.found > 0 && (
        <p className="muted small">
          Record each tender found in the list above so the companies can enter
          it.
        </p>
      )}
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy}
          onClick={async () => {
            if (
              await act.run(
                () => api.recordTenderSourceCheck(id, f),
                "Check recorded.",
              )
            )
              onDone();
          }}
        >
          Save check
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function AddSource({ onDone }: { onDone: () => void }) {
  const act = useAction();
  const [buyer, setBuyer] = useState("");
  const [urls, setUrls] = useState("");
  return (
    <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
      <label className="field">
        <span className="label">Buyer or portal</span>
        <input
          className="input"
          value={buyer}
          onChange={(e) => setBuyer(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="label">Web addresses (one per line, https)</span>
        <textarea
          className="textarea"
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
        />
      </label>
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy}
          onClick={async () => {
            const list = urls.split(/\s+/).filter(Boolean);
            if (
              await act.run(
                () => api.addTenderSource({ buyer, urls: list, note: "" }),
                "Site added.",
              )
            )
              onDone();
          }}
        >
          Add
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
