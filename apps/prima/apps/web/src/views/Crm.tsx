import { useState } from "react";
import type {
  ClientLostReason,
  ClientPersonRole,
  ClientRenewalAnswer,
  ClientRenewalDecision,
  ClientRequestKind,
  ProofInput,
} from "@prima/core";
import {
  CLIENT_LOST_REASON,
  CLIENT_PERSON_ROLE,
  CLIENT_RENEWAL_ANSWER,
  CLIENT_RENEWAL_DECISION,
  CLIENT_REQUEST_KIND,
} from "@prima/core";
import { api, type CrmBoard, type CrmClient } from "../api";
import {
  Chip,
  Drawer,
  ErrorNotice,
  Kpi,
  Loading,
  dateLabel,
  dateTimeLabel,
  useAction,
  useLoad,
} from "../ui";
import { ProofPicker } from "./Proof";

/**
 * Client CRM (Fauzan, 4 Nov 2026: "Yes build that. We want complete"). The whole client lifecycle in one place: leads
 * and quotations, won work waiting to become a client, onboarding, active clients, renewals, requests and complaints,
 * and lost clients. Each company sees only its own clients; group leadership also sees the group view.
 */

export type CrmTab = "pipeline" | "renewals" | "open" | "lost" | "group";
type Row = CrmBoard["clients"][number];

const STAGE: Record<Row["stage"], string> = {
  onboarding: "Onboarding",
  active: "Active",
  renewal: "Renewal due",
  offboarding: "Leaving",
  ended: "Ended",
};
const TONE: Record<Row["tone"], string> = {
  crit: "Needs attention",
  warn: "Follow up",
  unknown: "Unknown",
  ok: "In order",
};
const rm = (n: number | null) =>
  n == null ? "unknown" : `RM${Math.round(n).toLocaleString("en-MY")}`;

export function CrmView({ tab }: { tab: CrmTab }) {
  const { data, error } = useLoad(() => api.crmBoard(), []);
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="clients" />;
  return (
    <>
      {open && <ClientFile id={open} onClose={() => setOpen(null)} />}
      {tab === "pipeline" && <Pipeline data={data} onOpen={setOpen} />}
      {tab === "renewals" && <Renewals data={data} onOpen={setOpen} />}
      {tab === "open" && <OpenItems data={data} onOpen={setOpen} />}
      {tab === "lost" && <Lost data={data} onOpen={setOpen} />}
      {tab === "group" && data.group && <Group data={data} onOpen={setOpen} />}
    </>
  );
}

function ClientRowButton({
  r,
  onOpen,
  extra,
  money,
}: {
  r: Row;
  money: boolean;
  onOpen: (id: string) => void;
  extra?: string;
}) {
  return (
    <button className="list-item crm-row" onClick={() => onOpen(r.id)}>
      <div>
        <div style={{ fontWeight: 600 }}>{r.name}</div>
        <div className="muted small">
          {r.companyName} · {STAGE[r.stage]}
          {money ? ` · ${rm(r.monthly)} a month` : ""}
          {r.owner ? ` · in charge: ${r.owner}` : " · nobody in charge"}
          {extra ? ` · ${extra}` : ""}
        </div>
        {r.issues.length > 0 && (
          <div className="small">
            {r.issues
              .slice(0, 3)
              .map((i) => i.what)
              .join(" · ")}
          </div>
        )}
      </div>
      <Chip tone={r.tone}>{TONE[r.tone]}</Chip>
    </button>
  );
}

function Pipeline({
  data,
  onOpen,
}: {
  data: CrmBoard;
  onOpen: (id: string) => void;
}) {
  const [stage, setStage] = useState<string>("");
  const [converting, setConverting] = useState<
    CrmBoard["leads"][number] | null
  >(null);
  const won = data.leads.filter((l) => l.stage === "won" && !l.clientAccountId);
  const openLeads = data.leads.filter((l) => l.open);
  const shown = stage
    ? data.clients.filter((r) => r.stage === stage)
    : data.clients.filter((r) => r.tone === "crit" || r.tone === "warn");
  return (
    <div className="page-section">
      {converting && (
        <ConvertLead
          lead={converting}
          sites={data.convertSites[converting.companyId]}
          onDone={() => setConverting(null)}
        />
      )}
      <p className="muted small">
        From the first lead to the last invoice. Tap a stage to see its clients.
        Values are a month; unknown is never counted as zero.
      </p>
      <div className="crm-stages">
        {data.pipeline.map((p) => (
          <button
            key={p.key}
            className="kpi crm-stage"
            aria-pressed={stage === p.key}
            onClick={() =>
              setStage(
                stage === p.key || ["lead", "proposal", "won"].includes(p.key)
                  ? ""
                  : p.key,
              )
            }
          >
            <span className="label">{p.label}</span>
            <span className="kpi-value">{p.count}</span>
            <span className="kpi-note">
              {p.monthly != null ? rm(p.monthly) : (p.note ?? "")}
            </span>
          </button>
        ))}
      </div>
      {data.unknownValue > 0 && (
        <div className="muted small">
          {data.unknownValue} clients have no contract or invoice value on
          record.
        </div>
      )}
      {(won.length > 0 || data.awaitingContracts.length > 0) && (
        <section className="panel">
          <div className="panel-head">
            <h3>Won, client not opened yet</h3>
          </div>
          <div className="list">
            {won.map((l) => (
              <div key={l.id} className="list-item">
                <div>
                  <div style={{ fontWeight: 600 }}>{l.prospect}</div>
                  <div className="muted small">
                    {l.ref} · {l.companyName} · won {dateLabel(l.closedOn)} ·{" "}
                    {rm(l.estMonthly)} a month
                  </div>
                </div>
                {l.canConvert ? (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => setConverting(l)}
                  >
                    Open as client
                  </button>
                ) : (
                  <Chip tone="warn">Waiting for the company</Chip>
                )}
              </div>
            ))}
            {data.awaitingContracts.map((c) => (
              <div key={c.id} className="list-item">
                <div>
                  <div style={{ fontWeight: 600 }}>{c.client}</div>
                  <div className="muted small">
                    Contract {c.ref} · {c.companyName} · starts{" "}
                    {dateLabel(c.startOn)} · not tied to a client yet
                  </div>
                </div>
                <Chip tone="warn">{c.state}</Chip>
              </div>
            ))}
          </div>
        </section>
      )}
      {openLeads.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h3>Leads and quotations</h3>
              <div className="muted small">
                Worked on the Tenders and quotes page: research, site survey,
                quotation.
              </div>
            </div>
          </div>
          <div className="list">
            {openLeads.slice(0, 30).map((l) => (
              <div key={l.id} className="list-item">
                <div>
                  <div style={{ fontWeight: 600 }}>{l.prospect}</div>
                  <div className="muted small">
                    {l.ref} · {l.companyName} · {rm(l.estMonthly)} a month ·
                    next: {l.waiting}
                  </div>
                </div>
                <Chip tone={l.tone === "info" ? "neutral" : l.tone}>
                  {l.stage === "proposal" ? "With client" : "Working"}
                </Chip>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="panel">
        <div className="panel-head">
          <h3>
            {stage ? STAGE[stage as Row["stage"]] : "Clients needing attention"}
          </h3>
        </div>
        <div className="list">
          {shown.length === 0 && <div className="empty">Nothing here.</div>}
          {shown.slice(0, 60).map((r) => (
            <ClientRowButton
              key={r.id}
              r={r}
              onOpen={onOpen}
              money={data.seesMoney}
            />
          ))}
          {shown.length > 60 && (
            <div className="muted small">Showing 60 of {shown.length}.</div>
          )}
        </div>
      </section>
    </div>
  );
}

/** A won lead becomes the client: pick its sites and the contract end, and onboarding starts. */
function ConvertLead({
  lead,
  sites,
  onDone,
}: {
  lead: CrmBoard["leads"][number];
  sites: { id: string; name: string }[] | undefined;
  onDone: () => void;
}) {
  const act = useAction();
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [ends, setEnds] = useState("");
  const co = sites ? { sites } : undefined;
  return (
    <Drawer
      title={`Open ${lead.prospect} as a client`}
      sub={`${lead.ref} · ${lead.companyName}`}
      onClose={onDone}
    >
      {!co && (
        <div className="empty">You cannot open clients for this company.</div>
      )}
      {co && (
        <div className="crm-file">
          <div className="form">
            <div className="small">Choose the client's sites</div>
            {co.sites.length === 0 && (
              <div className="muted small">
                No sites for this company yet. Add the site first in Sites.
              </div>
            )}
            {co.sites.map((x) => (
              <label key={x.id} className="row small" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={siteIds.includes(x.id)}
                  onChange={(e) =>
                    setSiteIds(
                      e.target.checked
                        ? [...siteIds, x.id]
                        : siteIds.filter((y) => y !== x.id),
                    )
                  }
                />
                {x.name}
              </label>
            ))}
            <label className="small">
              Contract end date
              <input
                className="input"
                type="date"
                value={ends}
                onChange={(e) => setEnds(e.target.value)}
              />
            </label>
            <button
              className="btn btn-primary"
              disabled={act.busy}
              onClick={() =>
                act
                  .run(
                    () =>
                      api.addClientAccount({
                        companyId: lead.companyId,
                        name: lead.prospect,
                        siteIds,
                        contractEndsOn: ends || null,
                        leadId: lead.id,
                      }),
                    "Client opened. Onboarding started.",
                  )
                  .then((r) => r && onDone())
              }
            >
              Open client and start onboarding
            </button>
            <ErrorNotice error={act.error} />
          </div>
        </div>
      )}
    </Drawer>
  );
}

function Renewals({
  data,
  onOpen,
}: {
  data: CrmBoard;
  onOpen: (id: string) => void;
}) {
  const r = data.rule;
  return (
    <div className="page-section">
      <p className="muted small">
        A renewal opens {r.renewalOpenDays} days before the contract ends. The
        company manager decides by {r.decideByDays} days before; the offer
        reaches the client by {r.proposalByDays} days before.
      </p>
      <section className="panel">
        <div className="list">
          {data.renewals.length === 0 && (
            <div className="empty">
              No contract ends in the next {r.renewalOpenDays} days.
            </div>
          )}
          {data.renewals.map((x) => (
            <button
              key={x.id}
              className="list-item crm-row"
              onClick={() => onOpen(x.id)}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{x.name}</div>
                <div className="muted small">
                  {x.companyName} · ends {dateLabel(x.renewal!.endsOn)} (
                  {x.renewal!.daysLeft} days)
                  {data.seesMoney ? ` · ${rm(x.monthly)} a month` : ""}
                  {x.renewalDecision
                    ? ` · ${CLIENT_RENEWAL_DECISION[x.renewalDecision]}`
                    : ""}
                </div>
                <div className="small">
                  Next: {x.renewal!.next}
                  {x.renewal!.late ? ` · ${x.renewal!.late}` : ""}
                </div>
              </div>
              <Chip
                tone={x.renewal!.tone === "info" ? "neutral" : x.renewal!.tone}
              >
                {x.renewal!.late ? "Late" : "On time"}
              </Chip>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function OpenItems({
  data,
  onOpen,
}: {
  data: CrmBoard;
  onOpen: (id: string) => void;
}) {
  const late = data.open.filter((x) => x.late).length;
  return (
    <div className="page-section">
      <div className="kpis">
        <Kpi
          label="Open requests"
          value={data.open.filter((x) => x.kind === "request").length}
        />
        <Kpi
          label="Open complaints"
          value={data.open.filter((x) => x.kind === "complaint").length}
        />
        <Kpi label="Overdue" value={late} tone={late ? "crit" : "ok"} />
      </div>
      <section className="panel">
        <div className="list">
          {data.open.length === 0 && (
            <div className="empty">No open client requests or complaints.</div>
          )}
          {data.open.map((x) => (
            <button
              key={x.id}
              className="list-item crm-row"
              onClick={() => onOpen(x.accountId)}
            >
              <div>
                <div style={{ fontWeight: 600 }}>
                  {x.client} · {x.kind === "request" ? "Request" : "Complaint"}
                </div>
                <div className="muted small">
                  {x.companyName} · from {x.from} ·{" "}
                  {dateLabel(x.at.slice(0, 10))} · due {dateLabel(x.due)}
                </div>
                <div className="small">{x.what}</div>
              </div>
              <Chip tone={x.late ? "crit" : "warn"}>
                {x.late ? "Overdue" : "Open"}
              </Chip>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function Lost({
  data,
  onOpen,
}: {
  data: CrmBoard;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="page-section">
      <section className="panel">
        <div className="panel-head">
          <h3>Why clients left (last 12 months)</h3>
        </div>
        <div className="list">
          {data.lostBy.length === 0 && data.lostUnknown === 0 && (
            <div className="empty">No client left in the last 12 months.</div>
          )}
          {data.lostBy.map((x) => (
            <div key={x.reason} className="list-item">
              <div>{x.label}</div>
              <Chip tone="neutral">{x.count}</Chip>
            </div>
          ))}
          {data.lostUnknown > 0 && (
            <div className="list-item">
              <div>Reason not grouped</div>
              <Chip tone="unknown">{data.lostUnknown}</Chip>
            </div>
          )}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Leaving and ended clients</h3>
        </div>
        <div className="list">
          {data.lost.length === 0 && <div className="empty">Nothing here.</div>}
          {data.lost.map((x) => (
            <button
              key={x.id}
              className="list-item crm-row"
              onClick={() => onOpen(x.id)}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{x.name}</div>
                <div className="muted small">
                  {x.companyName} · {STAGE[x.stage]} ·{" "}
                  {x.lostReason
                    ? CLIENT_LOST_REASON[x.lostReason]
                    : "reason not grouped"}
                  {x.reason ? `: ${x.reason}` : ""}
                </div>
                {x.winBackOn && (
                  <div className="small">
                    Approach again from {dateLabel(x.winBackOn)}
                  </div>
                )}
              </div>
              <Chip tone={x.stage === "ended" ? "neutral" : "warn"}>
                {STAGE[x.stage]}
              </Chip>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function Group({
  data,
  onOpen,
}: {
  data: CrmBoard;
  onOpen: (id: string) => void;
}) {
  const g = data.group!;
  return (
    <div className="page-section">
      <p className="muted small">
        Group leadership only. Each company still runs its own clients.
      </p>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>By company</h3>
            <div className="muted small">
              Biggest client's share of the company's monthly value: over 30% is
              a concentration risk.
            </div>
          </div>
        </div>
        <div className="list">
          {g.byCompany.map((c) => (
            <div key={c.companyId} className="list-item">
              <div>
                <div style={{ fontWeight: 600 }}>{c.companyName}</div>
                <div className="muted small">
                  {c.clients} clients · {rm(c.monthly)} a month
                  {c.unknownValue
                    ? ` · ${c.unknownValue} with value unknown`
                    : ""}
                </div>
              </div>
              <Chip
                tone={
                  c.topShare == null
                    ? "unknown"
                    : c.topShare > 30
                      ? "warn"
                      : "ok"
                }
              >
                {c.topShare == null ? "Unknown" : `Biggest ${c.topShare}%`}
              </Chip>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Biggest clients</h3>
        </div>
        {g.top.length === 0 && <p className="panel-empty">No client has a contract value recorded yet, so none rank here.</p>}
        <div className="list">
          {g.top.map((t) => (
            <button
              key={t.id}
              className="list-item crm-row"
              onClick={() => onOpen(t.id)}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{t.name}</div>
                <div className="muted small">{t.companyName}</div>
              </div>
              <span>{rm(t.monthly)}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>Same client at two or more of our companies</h3>
            <div className="muted small">
              Matched by name. Check they are the same client before acting.
            </div>
          </div>
        </div>
        <div className="list">
          {g.shared.length === 0 && <div className="empty">None found.</div>}
          {g.shared.map((s) => (
            <div key={s.name} className="list-item">
              <div>{s.name}</div>
              <div className="muted small">{s.companies.join(", ")}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ---------- The client file: everything about one client ----------

function ClientFile({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error } = useLoad(() => api.crmClient(id), [id]);
  return (
    <Drawer
      title={data?.account.name ?? "Client"}
      sub={
        data
          ? `${data.account.companyName} · ${STAGE[data.account.stage]}`
          : undefined
      }
      onClose={onClose}
    >
      {error && <ErrorNotice error={error} />}
      {!data && !error && <Loading what="client" />}
      {data && <ClientFileBody c={data} />}
    </Drawer>
  );
}

function ClientFileBody({ c }: { c: CrmClient }) {
  const a = c.account;
  return (
    <div className="crm-file">
      <section>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <Chip tone={c.tone}>{TONE[c.tone]}</Chip>
          <span className="small">
            {c.seesMoney ? `${rm(c.monthly)} a month` : ""}
            {c.monthlyFrom === "invoice"
              ? " (last invoice)"
              : c.monthlyFrom === "contract"
                ? " (contract)"
                : ""}
          </span>
        </div>
        {c.issues.length > 0 && (
          <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {c.issues.map((i, k) => (
              <li key={k}>{i.what}</li>
            ))}
          </ul>
        )}
      </section>
      <section className="small">
        <h4>About the client</h4>
        <div>
          Client since {dateLabel(a.startedOn)} · contract ends{" "}
          {a.contractEndsOn ? dateLabel(a.contractEndsOn) : "not on record"}
        </div>
        <div>
          Sites:{" "}
          {c.sites.length ? c.sites.map((x) => x.name).join(", ") : "none"}
        </div>
        <div>
          Came from:{" "}
          {c.lead
            ? `lead ${c.lead.ref} (${c.lead.source}), won ${dateLabel(c.lead.closedOn)}${c.quotation ? `, quotation ${c.quotation.ref} RM${Math.round(c.quotation.monthlyTotal).toLocaleString("en-MY")} a month` : ""}`
            : a.origin?.kind === "lead"
              ? `lead ${a.origin.ref}`
              : a.origin?.kind === "tender"
                ? `tender ${a.origin.ref}`
                : "opened directly"}
        </div>
        <div>
          Contracts:{" "}
          {c.contracts.length
            ? c.contracts
                .map(
                  (k) =>
                    `${k.ref} (${k.state}, ${dateLabel(k.startOn)} to ${dateLabel(k.endOn)})`,
                )
                .join(" · ")
            : "none tied to this client"}
        </div>
        <div>
          {c.seesMoney ? "Billing: " : ""}
          {!c.seesMoney
            ? ""
            : a.billing
              ? `invoiced to ${a.billing.invoicedTo ?? "-"}, RM${a.billing.overdueAmount.toFixed(2)} overdue as of ${dateLabel(a.billing.asOf)}`
              : "unknown (SQL Account not connected)"}
        </div>
        {a.lostReason && (
          <div>
            Left because: {CLIENT_LOST_REASON[a.lostReason]}
            {a.offboardReason ? ` (${a.offboardReason})` : ""}
            {a.winBackOn
              ? ` · approach again from ${dateLabel(a.winBackOn)}`
              : ""}
          </div>
        )}
      </section>
      <OwnerSection c={c} />
      <PeopleSection c={c} />
      <RenewalSection c={c} />
      <RequestsSection c={c} />
      {c.can.offboard && <OffboardSection c={c} />}
      <section className="small">
        <h4>What happened</h4>
        {c.timeline.length === 0 && (
          <div className="muted">Nothing on record yet.</div>
        )}
        <ul className="crm-timeline">
          {c.timeline.slice(0, 40).map((e, k) => (
            <li key={k}>
              <span className="muted">{dateTimeLabel(e.at)}</span> ·{" "}
              <b>{e.kind}</b> · {e.what}
              {e.by ? ` · ${e.by}` : ""}
            </li>
          ))}
        </ul>
        <div className="muted">
          Visits, reports, ratings, complaints and invoices are recorded on the
          Client board tab.
        </div>
      </section>
    </div>
  );
}

function OwnerSection({ c }: { c: CrmClient }) {
  const act = useAction();
  const [who, setWho] = useState("");
  return (
    <section className="small">
      <h4>Person in charge</h4>
      <div>
        {c.account.owner
          ? `${c.account.owner.name}, since ${dateLabel(c.account.owner.since)}`
          : "Nobody named yet."}
      </div>
      {c.can.owner && c.owners.length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <select
            className="select"
            aria-label="Person in charge"
            value={who}
            onChange={(e) => setWho(e.target.value)}
          >
            <option value="">Choose</option>
            {c.owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <button
            className="btn btn-sm"
            disabled={!who || act.busy}
            onClick={() =>
              act.run(() => api.setClientOwner(c.account.id, who), "Saved.")
            }
          >
            Save
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}

function PeopleSection({ c }: { c: CrmClient }) {
  const act = useAction();
  const [adding, setAdding] = useState(false);
  const [p, setP] = useState({
    name: "",
    position: "",
    role: "site" as ClientPersonRole,
    phone: "",
    email: "",
    main: false,
  });
  return (
    <section className="small">
      <h4>People at the client</h4>
      {c.people.length === 0 && (
        <div className="muted">No contact on record.</div>
      )}
      {c.people.map((x) => (
        <div key={x.id} className="row crm-person">
          <div>
            <b>{x.name}</b>
            {x.main ? " (main contact)" : ""} · {x.position} ·{" "}
            {CLIENT_PERSON_ROLE[x.role]}
            <div>
              {x.phone && (
                <a href={`tel:${x.phone.replace(/[ -]/g, "")}`}>{x.phone}</a>
              )}
              {x.phone && x.email ? " · " : ""}
              {x.email && <a href={`mailto:${x.email}`}>{x.email}</a>}
            </div>
          </div>
          {c.can.people && (
            <div className="row" style={{ gap: 4 }}>
              {!x.main && (
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={act.busy}
                  onClick={() =>
                    act.run(
                      () => api.updateClientPerson(c.account.id, x.id, "main"),
                      "Saved.",
                    )
                  }
                >
                  Make main
                </button>
              )}
              <button
                className="btn btn-ghost btn-sm"
                disabled={act.busy}
                onClick={() =>
                  act.run(
                    () => api.updateClientPerson(c.account.id, x.id, "remove"),
                    "Saved.",
                  )
                }
              >
                No longer there
              </button>
            </div>
          )}
        </div>
      ))}
      {c.can.people && !adding && (
        <button className="btn btn-sm" onClick={() => setAdding(true)}>
          Add a person
        </button>
      )}
      {adding && (
        <div className="form">
          <input
            className="input"
            placeholder="Name"
            aria-label="Name"
            value={p.name}
            onChange={(e) => setP({ ...p, name: e.target.value })}
          />
          <input
            className="input"
            placeholder="Position"
            aria-label="Position"
            value={p.position}
            onChange={(e) => setP({ ...p, position: e.target.value })}
          />
          <select
            className="select"
            aria-label="What they do for us"
            value={p.role}
            onChange={(e) =>
              setP({ ...p, role: e.target.value as ClientPersonRole })
            }
          >
            {(Object.keys(CLIENT_PERSON_ROLE) as ClientPersonRole[]).map(
              (k) => (
                <option key={k} value={k}>
                  {CLIENT_PERSON_ROLE[k]}
                </option>
              ),
            )}
          </select>
          <input
            className="input"
            type="tel"
            placeholder="Work phone"
            aria-label="Work phone"
            value={p.phone}
            onChange={(e) => setP({ ...p, phone: e.target.value })}
          />
          <input
            className="input"
            type="email"
            placeholder="Work email"
            aria-label="Work email"
            value={p.email}
            onChange={(e) => setP({ ...p, email: e.target.value })}
          />
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={p.main}
              onChange={(e) => setP({ ...p, main: e.target.checked })}
            />{" "}
            Main contact
          </label>
          <div className="muted">
            Work details only. No IC number or home address.
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy}
              onClick={() =>
                act
                  .run(() => api.addClientPerson(c.account.id, p), "Added.")
                  .then((r) => {
                    if (r) {
                      setAdding(false);
                      setP({
                        name: "",
                        position: "",
                        role: "site",
                        phone: "",
                        email: "",
                        main: false,
                      });
                    }
                  })
              }
            >
              Save person
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}

function RenewalSection({ c }: { c: CrmClient }) {
  const act = useAction();
  const rn = c.renewal;
  const st = c.renewalState;
  const [choice, setChoice] = useState<ClientRenewalDecision>("renew");
  const [pct, setPct] = useState(0);
  const [reason, setReason] = useState("");
  const [proof, setProof] = useState<ProofInput[]>([]);
  const [answer, setAnswer] = useState<ClientRenewalAnswer>("accepted");
  const [note, setNote] = useState("");
  const [ends, setEnds] = useState("");
  if (!st && !rn && !c.pastRenewals.length) return null;
  return (
    <section className="small">
      <h4>Renewal</h4>
      {st && (
        <div>
          Contract ends {dateLabel(st.endsOn)} ({st.daysLeft} days). Next:{" "}
          {st.next}
          {st.late ? ` · ${st.late}` : ""}
        </div>
      )}
      {rn?.decision && (
        <div>
          Decision: {CLIENT_RENEWAL_DECISION[rn.decision.choice]}
          {rn.decision.pricePct
            ? ` (${rn.decision.pricePct > 0 ? "+" : ""}${rn.decision.pricePct}%)`
            : ""}{" "}
          · {rn.decision.reason} · {rn.decision.by}
        </div>
      )}
      {rn?.proposal && (
        <div>
          Offer sent {dateLabel(rn.proposal.at.slice(0, 10))} by{" "}
          {rn.proposal.by}
        </div>
      )}
      {rn?.answer && (
        <div>
          Client: {CLIENT_RENEWAL_ANSWER[rn.answer.choice]}
          {rn.answer.note ? ` · ${rn.answer.note}` : ""}
        </div>
      )}
      {c.pastRenewals.length > 0 && (
        <div className="muted">
          Before:{" "}
          {c.pastRenewals
            .map(
              (p) =>
                `${dateLabel(p.endsOn)}: ${p.answer ? CLIENT_RENEWAL_ANSWER[p.answer.choice] : p.decision ? CLIENT_RENEWAL_DECISION[p.decision.choice] : "closed"}`,
            )
            .join(" · ")}
        </div>
      )}
      {c.can.decide && (
        <div className="form">
          <div style={{ fontWeight: 600 }}>
            {rn?.decision ? "Change the decision" : "Decide the renewal"}
          </div>
          <select
            className="select"
            aria-label="Decision"
            value={choice}
            onChange={(e) => setChoice(e.target.value as ClientRenewalDecision)}
          >
            {(
              Object.keys(CLIENT_RENEWAL_DECISION) as ClientRenewalDecision[]
            ).map((k) => (
              <option key={k} value={k}>
                {CLIENT_RENEWAL_DECISION[k]}
              </option>
            ))}
          </select>
          {choice === "renew_new_price" && (
            <label>
              Price change %
              <input
                className="input"
                type="number"
                step={0.5}
                value={pct || ""}
                onChange={(e) => setPct(Number(e.target.value) || 0)}
              />
            </label>
          )}
          <input
            className="input"
            placeholder="Reason"
            aria-label="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy}
            onClick={() =>
              act
                .run(
                  () =>
                    api.decideClientRenewal(c.account.id, {
                      choice,
                      pricePct: pct,
                      reason,
                    }),
                  "Decision saved.",
                )
                .then((r) => r && setReason(""))
            }
          >
            Save decision
          </button>
        </div>
      )}
      {c.can.offer && (
        <div className="form">
          <div style={{ fontWeight: 600 }}>
            Renewal offer sent to the client
          </div>
          <ProofPicker
            site={null}
            refText="Renewal"
            items={proof}
            onChange={setProof}
            documentsOnly
            required
          />
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || !proof.length}
            onClick={() =>
              act
                .run(
                  () => api.sendClientRenewalOffer(c.account.id, proof),
                  "Offer recorded.",
                )
                .then((r) => r && setProof([]))
            }
          >
            Record offer sent
          </button>
        </div>
      )}
      {c.can.answer && (rn?.proposal || rn?.decision?.choice === "rebid") && (
        <div className="form">
          <div style={{ fontWeight: 600 }}>Client's answer</div>
          <select
            className="select"
            aria-label="Answer"
            value={answer}
            onChange={(e) => setAnswer(e.target.value as ClientRenewalAnswer)}
          >
            {(Object.keys(CLIENT_RENEWAL_ANSWER) as ClientRenewalAnswer[]).map(
              (k) => (
                <option key={k} value={k}>
                  {CLIENT_RENEWAL_ANSWER[k]}
                </option>
              ),
            )}
          </select>
          {answer === "accepted" && (
            <>
              <label>
                New contract end date
                <input
                  className="input"
                  type="date"
                  value={ends}
                  onChange={(e) => setEnds(e.target.value)}
                />
              </label>
              <ProofPicker
                site={null}
                refText="Renewal"
                items={proof}
                onChange={setProof}
                documentsOnly
                required
              />
            </>
          )}
          <input
            className="input"
            placeholder="Note"
            aria-label="Note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy}
            onClick={() =>
              act
                .run(
                  () =>
                    api.answerClientRenewal(c.account.id, {
                      choice: answer,
                      note,
                      newEndsOn: ends || null,
                      proof,
                    }),
                  "Answer recorded.",
                )
                .then((r) => {
                  if (r) {
                    setProof([]);
                    setNote("");
                  }
                })
            }
          >
            Record answer
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}

function RequestsSection({ c }: { c: CrmClient }) {
  const act = useAction();
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState({
    kind: "more_guards" as ClientRequestKind,
    what: "",
    from: "",
    neededBy: "",
  });
  const [closing, setClosing] = useState<string | null>(null);
  const [out, setOut] = useState({
    status: "done" as "done" | "declined",
    outcome: "",
    variationRef: "",
  });
  return (
    <section className="small">
      <h4>Client requests</h4>
      {c.requests.length === 0 && (
        <div className="muted">No requests on record.</div>
      )}
      {c.requests.slice(0, 10).map((x) => (
        <div key={x.id} className="crm-person">
          <div>
            <Chip
              tone={
                x.status === "open"
                  ? "warn"
                  : x.status === "done"
                    ? "ok"
                    : "neutral"
              }
            >
              {x.status === "open"
                ? "Open"
                : x.status === "done"
                  ? "Done"
                  : "Declined"}
            </Chip>{" "}
            <b>{CLIENT_REQUEST_KIND[x.kind]}</b>: {x.what} · from {x.from} ·{" "}
            {dateLabel(x.at.slice(0, 10))}
            {x.neededBy ? ` · needed by ${dateLabel(x.neededBy)}` : ""}
            {x.outcome ? ` · ${x.outcome}` : ""}
            {x.variationRef ? ` (variation ${x.variationRef})` : ""}
          </div>
          {c.can.closeRequest && x.status === "open" && closing !== x.id && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setClosing(x.id)}
            >
              Close
            </button>
          )}
          {closing === x.id && (
            <div className="form">
              <select
                className="select"
                aria-label="Outcome"
                value={out.status}
                onChange={(e) =>
                  setOut({
                    ...out,
                    status: e.target.value as "done" | "declined",
                  })
                }
              >
                <option value="done">Done</option>
                <option value="declined">Declined</option>
              </select>
              <input
                className="input"
                placeholder={
                  out.status === "done" ? "What was done" : "Why declined"
                }
                aria-label="What was done"
                value={out.outcome}
                onChange={(e) => setOut({ ...out, outcome: e.target.value })}
              />
              {out.status === "done" &&
                (x.kind === "more_guards" || x.kind === "fewer_guards") && (
                  <input
                    className="input"
                    placeholder="Signed variation reference"
                    aria-label="Signed variation reference"
                    value={out.variationRef}
                    onChange={(e) =>
                      setOut({ ...out, variationRef: e.target.value })
                    }
                  />
                )}
              <button
                className="btn btn-primary btn-sm"
                disabled={act.busy}
                onClick={() =>
                  act
                    .run(
                      () =>
                        api.closeClientRequest(c.account.id, x.id, {
                          ...out,
                          variationRef: out.variationRef || null,
                        }),
                      "Request closed.",
                    )
                    .then((r) => {
                      if (r) {
                        setClosing(null);
                        setOut({
                          status: "done",
                          outcome: "",
                          variationRef: "",
                        });
                      }
                    })
                }
              >
                Save
              </button>
            </div>
          )}
        </div>
      ))}
      {c.can.request && !adding && (
        <button className="btn btn-sm" onClick={() => setAdding(true)}>
          Log a request
        </button>
      )}
      {adding && (
        <div className="form">
          <select
            className="select"
            aria-label="Request"
            value={q.kind}
            onChange={(e) =>
              setQ({ ...q, kind: e.target.value as ClientRequestKind })
            }
          >
            {(Object.keys(CLIENT_REQUEST_KIND) as ClientRequestKind[]).map(
              (k) => (
                <option key={k} value={k}>
                  {CLIENT_REQUEST_KIND[k]}
                </option>
              ),
            )}
          </select>
          <input
            className="input"
            placeholder="What the client asked for"
            aria-label="What the client asked for"
            value={q.what}
            onChange={(e) => setQ({ ...q, what: e.target.value })}
          />
          <input
            className="input"
            placeholder="Who at the client asked"
            aria-label="Who at the client asked"
            value={q.from}
            onChange={(e) => setQ({ ...q, from: e.target.value })}
          />
          <label>
            Needed by (if the client said)
            <input
              className="input"
              type="date"
              value={q.neededBy}
              onChange={(e) => setQ({ ...q, neededBy: e.target.value })}
            />
          </label>
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy}
              onClick={() =>
                act
                  .run(
                    () =>
                      api.addClientRequest(c.account.id, {
                        ...q,
                        neededBy: q.neededBy || null,
                      }),
                    "Request logged.",
                  )
                  .then((r) => {
                    if (r) {
                      setAdding(false);
                      setQ({
                        kind: "more_guards",
                        what: "",
                        from: "",
                        neededBy: "",
                      });
                    }
                  })
              }
            >
              Save request
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}

function OffboardSection({ c }: { c: CrmClient }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ClientLostReason>("price");
  const [why, setWhy] = useState("");
  const [winBack, setWinBack] = useState("");
  return (
    <section className="small">
      <h4>Client leaving</h4>
      {!open ? (
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
          Start offboarding
        </button>
      ) : (
        <div className="form">
          <select
            className="select"
            aria-label="Why the client is leaving"
            value={reason}
            onChange={(e) => setReason(e.target.value as ClientLostReason)}
          >
            {(Object.keys(CLIENT_LOST_REASON) as ClientLostReason[]).map(
              (k) => (
                <option key={k} value={k}>
                  {CLIENT_LOST_REASON[k]}
                </option>
              ),
            )}
          </select>
          <input
            className="input"
            placeholder="What happened"
            aria-label="What happened"
            value={why}
            onChange={(e) => setWhy(e.target.value)}
          />
          <label>
            Approach again from (optional)
            <input
              className="input"
              type="date"
              value={winBack}
              onChange={(e) => setWinBack(e.target.value)}
            />
          </label>
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy}
            onClick={() =>
              act
                .run(
                  () =>
                    api.startOffboarding(c.account.id, why, {
                      reason,
                      winBackOn: winBack || null,
                    }),
                  "Offboarding started.",
                )
                .then((r) => r && setOpen(false))
            }
          >
            Start offboarding
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}

export const CRM_TABS: [CrmTab | "board", string][] = [
  ["board", "Client board"],
  ["pipeline", "Pipeline"],
  ["renewals", "Renewals"],
  ["open", "Requests and complaints"],
  ["lost", "Lost clients"],
  ["group", "Group"],
];
