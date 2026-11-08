import { useState, type ReactNode } from "react";
import { api, type AmExtrasBoard } from "../api";
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, useAction, useLoad, type Tone } from "../ui";

/**
 * Asset Management extras (Fauzan, 5 Nov 2026, rule AM-EXTRAS proposed): the contractors list, finding tenants for
 * empty units, utility meters, resort bookings, orchard harvests and planned maintenance. The screen only shows and
 * asks; the server checks who may do each step and every field. Test version on made-up data.
 */

export type AmExtrasSection = "contractors" | "letting" | "meters" | "resorts" | "orchards" | "planned";

const rm = (n: number) => `RM${(Math.round(n * 100) / 100).toLocaleString("en-MY")}`;
const todayMy = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

const TRADES: Record<string, string> = {
  CIVIL: "Building and civil works",
  ROOFING: "Roofing",
  PLUMBING: "Plumbing",
  ELECTRICAL: "Electrical",
  AIRCOND: "Air conditioning",
  PAINTING: "Painting",
  LANDSCAPE: "Grass cutting and landscape",
  PEST: "Pest control",
  CLEANING: "Cleaning",
  LIFT: "Lift",
  FIRE: "Fire equipment",
  GENERAL: "General repairs",
};
const CHANNELS: Record<string, string> = {
  PORTAL: "Property website",
  SIGNBOARD: "Signboard at the unit",
  AGENT: "Estate agent",
  SOCIAL: "Social media",
  NEWSPAPER: "Newspaper",
  WORD_OF_MOUTH: "Word of mouth",
  OTHER: "Other",
};
const LOST: Record<string, string> = {
  PRICE: "Rent too high",
  LOCATION: "Location",
  CONDITION: "Unit condition",
  SIZE: "Size",
  NO_RESPONSE: "Stopped answering",
  CHOSE_OTHER: "Took another place",
  UNIT_LET: "Unit let to someone else",
  NOT_SUITABLE: "Not a suitable tenant",
  OTHER: "Other",
};
const STAY: Record<string, string> = { ROOM: "Room", CHALET: "Chalet", HALL: "Function hall", CAMPSITE: "Camping pitch" };
const C_STATUS: Record<string, [Tone, string]> = {
  pending: ["warn", "Waiting for approval"],
  active: ["ok", "Approved for use"],
  suspended: ["crit", "Suspended"],
  blacklisted: ["crit", "Blacklisted"],
};
const E_STATUS: Record<string, [Tone, string]> = {
  new: ["info", "New"],
  viewing: ["neutral", "Viewing"],
  offer: ["warn", "Offer to approve"],
  approved: ["ok", "Offer approved"],
  signed: ["ok", "Signed"],
  lost: ["neutral", "Closed"],
};
const B_STATUS: Record<string, [Tone, string]> = {
  held: ["warn", "Held"],
  confirmed: ["info", "Confirmed"],
  checked_in: ["ok", "In house"],
  checked_out: ["neutral", "Checked out"],
  cancelled: ["neutral", "Cancelled"],
  no_show: ["crit", "No-show"],
};
const PM_STATE: Record<string, [Tone, string]> = {
  overdue: ["crit", "Overdue"],
  due: ["warn", "Due soon"],
  ordered: ["info", "Work order open"],
  planned: ["ok", "Planned"],
  paused: ["neutral", "Paused"],
};

// ---------- A small form: fields in, one server step out ----------

type Field = {
  key: string;
  label: string;
  kind?: "text" | "number" | "date" | "select" | "check" | "multi";
  options?: Record<string, string>;
  initial?: string | boolean | string[];
  wide?: boolean;
};

function StepForm({
  area,
  action,
  id = "",
  fields,
  fixed = {},
  submit,
  done,
  note,
  transform,
}: {
  transform?: (body: Record<string, unknown>) => Record<string, unknown>;
  area: string;
  action: string;
  id?: string;
  fields: Field[];
  fixed?: Record<string, unknown>;
  submit: string;
  done: string;
  note?: ReactNode;
}) {
  const act = useAction();
  const [v, setV] = useState<Record<string, string | boolean | string[]>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.initial ?? (f.kind === "check" ? false : f.kind === "multi" ? [] : f.kind === "date" ? "" : f.kind === "select" ? Object.keys(f.options ?? {})[0] ?? "" : "")])),
  );
  const set = (k: string, x: string | boolean | string[]) => setV((o) => ({ ...o, [k]: x }));
  const body = () => {
    const out: Record<string, unknown> = { ...fixed };
    for (const f of fields) out[f.key] = f.kind === "number" ? (v[f.key] === "" ? null : Number(v[f.key])) : v[f.key];
    return transform ? transform(out) : out;
  };
  return (
    <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {fields.map((f) =>
          f.kind === "select" ? (
            <Captioned key={f.key} label={f.label}>
              <select className="input" aria-label={f.label} value={String(v[f.key])} onChange={(e) => set(f.key, e.target.value)}>
                {Object.entries(f.options ?? {}).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </Captioned>
          ) : f.kind === "check" ? (
            <label key={f.key} className="small" style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input type="checkbox" checked={v[f.key] === true} onChange={(e) => set(f.key, e.target.checked)} />
              {f.label}
            </label>
          ) : f.kind === "multi" ? (
            <div key={f.key} className="row" style={{ gap: 4, flexWrap: "wrap" }} role="group" aria-label={f.label}>
              {Object.entries(f.options ?? {}).map(([k, l]) => {
                const on = (v[f.key] as string[]).includes(k);
                return (
                  <button key={k} type="button" className="btn btn-sm" aria-pressed={on} onClick={() => set(f.key, on ? (v[f.key] as string[]).filter((x) => x !== k) : [...(v[f.key] as string[]), k])}>
                    {on ? "✓ " : ""}
                    {l}
                  </button>
                );
              })}
            </div>
          ) : (
            <Captioned key={f.key} label={f.label} wide={f.wide}>
              <input
                className="input"
                aria-label={f.label}
                placeholder={f.kind === "date" ? undefined : f.label}
                type={f.kind === "date" ? "date" : "text"}
                inputMode={f.kind === "number" ? "decimal" : undefined}
                value={String(v[f.key])}
                onChange={(e) => set(f.key, e.target.value)}
                title={f.label}
              />
            </Captioned>
          ),
        )}
        <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => act.run(() => api.amExtrasAct(area, action, id, body()), done)}>
          {submit}
        </button>
      </div>
      {note && <span className="muted small">{note}</span>}
      <ErrorNotice error={act.error} />
    </div>
  );
}

/** A field with its name shown above it, so a filled-in box still says what it is. */
const Captioned = ({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) => (
  <div style={{ display: "grid", gap: 2, flex: wide ? "1 1 260px" : undefined, minWidth: 0 }}>
    <span className="muted small" aria-hidden="true">
      {label}
    </span>
    {children}
  </div>
);

/** A row that opens one form at a time. */
function Actions({ items }: { items: [string, ReactNode][] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!items.length) return null;
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
        {items.map(([label]) => (
          <button key={label} className="btn btn-sm" aria-expanded={open === label} onClick={() => setOpen(open === label ? null : label)}>
            {label}
          </button>
        ))}
      </div>
      {items.filter(([label]) => label === open).map(([label, form]) => (
        <div key={label}>{form}</div>
      ))}
    </div>
  );
}

const Flags = ({ flags }: { flags: string[] }) =>
  flags.length ? (
    <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
      {flags.map((f) => (
        <Chip key={f} tone={/ended|lapsed|Overdue|unpaid|spoiled|under the recent|usual|empty unit|kept/.test(f) ? "crit" : "warn"}>
          {f}
        </Chip>
      ))}
    </div>
  ) : null;

// ---------- Panel ----------

export function AmExtrasPanel({ section }: { section: AmExtrasSection }) {
  const { data, error } = useLoad(() => api.amExtras(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="Asset Management" />;
  if (!data.installed)
    return (
      <section className="panel">
        <p>
          Not set up on this server yet. The database step (db/modules/am-extras-v1.sql) is applied only in an authorized
          migration window. Nothing here is lost: staff enter the records once it is set up.
        </p>
      </section>
    );
  return (
    <>
      {section === "contractors" && <Contractors d={data} />}
      {section === "letting" && <Letting d={data} />}
      {section === "meters" && <Meters d={data} />}
      {section === "resorts" && <Resorts d={data} />}
      {section === "orchards" && <Orchards d={data} />}
      {section === "planned" && <Planned d={data} />}
      {data.can.bank && data.toBank.length > 0 && (section === "resorts" || section === "orchards") && <ToBank d={data} section={section} />}
    </>
  );
}

// ---------- Contractors ----------

function Contractors({ d }: { d: AmExtrasBoard }) {
  const [q, setQ] = useState("");
  const rows = d.contractors.filter((c) => !q || `${c.name} ${c.trades.map((t) => TRADES[t]).join(" ")} ${c.states.join(" ")}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="kpis">
        <Kpi label="Approved for use" value={d.kpis.contractorsActive} />
        <Kpi label="Waiting for the Asset Director" value={d.kpis.contractorsToApprove} tone={d.kpis.contractorsToApprove ? "warn" : "ok"} />
        <Kpi label="Names on jobs, not on the list" value={d.unlistedContractors.length} tone={d.unlistedContractors.length ? "warn" : "ok"} />
      </div>
      <section className="panel">
        <div className="panel-head">
          <h3>Contractors</h3>
          <span className="muted small">The team adds; the Asset Director approves for use, suspends or blacklists, always with a reason. Every finished job is rated.</span>
          <input className="input" aria-label="Find a contractor" placeholder="Name, work or state" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {d.can.act && (
          <Actions
            items={[
              [
                "Add contractor",
                <StepForm
                  area="contractor"
                  action="add"
                  fields={[
                    { key: "name", label: "Registered name", wide: true },
                    { key: "ssmNo", label: "SSM number" },
                    { key: "cidbGrade", label: "CIDB grade", kind: "select", options: { "": "No CIDB", G1: "G1", G2: "G2", G3: "G3", G4: "G4", G5: "G5", G6: "G6", G7: "G7" } },
                    { key: "cidbExpiry", label: "CIDB ends", kind: "date" },
                    { key: "contactName", label: "Contact person" },
                    { key: "phone", label: "Phone" },
                    { key: "email", label: "Email" },
                    { key: "trades", label: "Kinds of work", kind: "multi", options: TRADES },
                  ]}
                  submit="Add"
                  done="Added. The Asset Director approves it before it is used."
                />,
              ],
            ]}
          />
        )}
        <div className="list">
          {rows.length === 0 && <div className="empty">No contractor matches.</div>}
          {rows.map((c) => (
            <div key={c.id} className="list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 6, flexWrap: "nowrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{c.name}</div>
                  <div className="muted small">
                    {c.trades.map((t) => TRADES[t]).join(", ")} · {c.states.join(", ") || "states not given"}
                    {c.cidbGrade ? ` · CIDB ${c.cidbGrade} to ${dateLabel(c.cidbExpiry)}` : " · no CIDB"}
                  </div>
                  <div className="muted small">
                    {c.jobs} jobs ({c.openJobs} open) · {rm(c.spend)} paid on finished jobs
                    {c.avgRating != null ? ` · rated ${c.avgRating}/5, ${c.onTimePct}% on time` : " · not rated yet"}
                    {d.can.act && c.phone ? ` · ${c.contactName} ${c.phone}` : ""}
                  </div>
                </div>
                <span style={{ flexShrink: 0 }}><Chip tone={C_STATUS[c.status][0]}>{C_STATUS[c.status][1]}</Chip></span>
              </div>
              <Flags flags={c.flags} />
              <Actions
                items={[
                  ...(c.canDecide
                    ? ([
                        [
                          "Decide",
                          <StepForm
                            area="contractor"
                            action="decide"
                            id={c.id}
                            fixed={{ version: c.version }}
                            fields={[
                              { key: "status", label: "Decision", kind: "select", options: { active: "Approve for use", suspended: "Suspend", blacklisted: "Blacklist" } },
                              { key: "reason", label: "Reason", wide: true },
                            ]}
                            submit="Save decision"
                            done="Decision saved."
                            note="You cannot approve a contractor you added yourself."
                          />,
                        ],
                      ] as [string, ReactNode][])
                    : []),
                  ...(d.can.act && c.unrated.length
                    ? ([
                        [
                          `Rate a finished job (${c.unrated.length})`,
                          <StepForm
                            area="contractor"
                            action="rate"
                            id={c.id}
                            fixed={{ version: c.version }}
                            fields={[
                              { key: "workOrderId", label: "Job", kind: "select", options: Object.fromEntries(c.unrated.map((w) => [w.id, `${w.title}, ${w.place}, ${dateLabel(w.doneOn)}`])) },
                              { key: "quality", label: "Quality", kind: "select", options: { "5": "5 very good", "4": "4 good", "3": "3 fair", "2": "2 poor", "1": "1 very poor" } },
                              { key: "onTime", label: "Finished on time", kind: "check" },
                              { key: "note", label: "Comment", wide: true },
                            ]}
                            submit="Save rating"
                            done="Rating saved."
                          />,
                        ],
                      ] as [string, ReactNode][])
                    : []),
                ]}
              />
            </div>
          ))}
        </div>
        {d.unlistedContractors.length > 0 && (
          <p className="muted small">On past work orders but not on this list: {d.unlistedContractors.join(", ")}. Add them so their work can be rated.</p>
        )}
      </section>
    </>
  );
}

// ---------- Finding tenants ----------

function Letting({ d }: { d: AmExtrasBoard }) {
  const [show, setShow] = useState<"attention" | "all">("attention");
  const rows = show === "all" ? d.toLet : d.toLet.filter((u) => u.flags.length || u.offersToApprove || u.openEnquiries);
  return (
    <>
      <div className="kpis">
        <Kpi label="Units to let" value={d.toLet.length} note="empty, or tenancy ending within 90 days" />
        <Kpi label="Offers for the Asset Director" value={d.kpis.offersToApprove} tone={d.kpis.offersToApprove ? "warn" : "ok"} />
        <Kpi label="Empty and not advertised" value={d.kpis.unitsNotAdvertised} tone={d.kpis.unitsNotAdvertised ? "crit" : "ok"} />
      </div>
      <section className="panel">
        <div className="panel-head">
          <h3>Finding tenants</h3>
          <span className="muted small">
            Advertise each empty unit within {d.rule.advertWithinDays} days, answer every enquiry within {d.rule.enquiryFollowUpDays} days. The Asset Director
            approves every offer; an offer under the asking rent needs a reason. Signing does not start billing: add the tenancy on the unit.
          </span>
          <div className="row" style={{ gap: 4 }}>
            {(["attention", "all"] as const).map((k) => (
              <button key={k} className="btn btn-sm" aria-pressed={show === k} onClick={() => setShow(k)}>
                {k === "attention" ? "Needs action" : "All units to let"}
              </button>
            ))}
          </div>
        </div>
        {d.lostWhy.length > 0 && <p className="muted small">Why enquiries did not go ahead: {d.lostWhy.map((x) => `${LOST[x.reason]} ${x.count}`).join(" · ")}</p>}
        <div className="list">
          {rows.length === 0 && <div className="empty">Nothing needs action.</div>}
          {rows.slice(0, 120).map((u) => (
            <div key={u.unitId} className="list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 6, flexWrap: "nowrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {u.code} {u.name}
                  </div>
                  <div className="muted small">
                    {u.town}, {u.state} · asking {rm(u.askingRent)}/month ·{" "}
                    {u.vacantDays != null ? `empty ${u.vacantDays} days` : `tenancy ends ${dateLabel(u.endsOn)}`}
                    {u.adverts.length ? ` · advertised: ${u.adverts.map((a) => CHANNELS[a.channel]).join(", ")}` : ""}
                  </div>
                </div>
                <span style={{ flexShrink: 0 }}><Chip tone={u.openEnquiries ? "info" : "neutral"}>{u.openEnquiries} open enquiries</Chip></span>
              </div>
              <Flags flags={u.flags} />
              {u.enquiries.map((e) => (
                <div key={e.id} style={{ borderLeft: "3px solid var(--line, #ddd)", paddingLeft: 8, display: "grid", gap: 4 }}>
                  <div className="row" style={{ justifyContent: "space-between", gap: 6 }}>
                    <span className="small">
                      <b>{e.name}</b> · {e.phone} · {CHANNELS[e.source]} · {dateLabel(e.on)}
                      {e.use ? ` · ${e.use}` : ""}
                      {e.viewingOn ? ` · viewing ${dateLabel(e.viewingOn)}` : ""}
                    </span>
                    <span style={{ flexShrink: 0 }}><Chip tone={E_STATUS[e.status][0]}>{E_STATUS[e.status][1]}</Chip></span>
                  </div>
                  {e.offer && (
                    <span className="muted small">
                      Offer {rm(e.offer.rent)}/month from {dateLabel(e.offer.startOn)}, {e.offer.months} months, deposit {e.offer.depositMonths} months, by {e.offer.by}
                      {e.belowAsking ? ` · under asking: ${e.offer.reason}` : ""}
                      {e.decision ? ` · ${e.decision.approve ? "approved" : "turned down"} by ${e.decision.by}: ${e.decision.note}` : ""}
                    </span>
                  )}
                  {e.signed && <span className="muted small">Agreement {e.signed.agreementRef} signed {dateLabel(e.signed.on)}</span>}
                  {e.lost && <span className="muted small">Closed: {LOST[e.lost.reason]} {e.lost.note}</span>}
                  {e.stale && <Chip tone="warn">No next step for over {d.rule.enquiryFollowUpDays} days</Chip>}
                  {!["signed", "lost"].includes(e.status) && (
                    <Actions
                      items={[
                        ...(d.can.act
                          ? ([
                              ["Viewing", <StepForm area="letting" action="step" id={u.unitId} fixed={{ step: "viewing", enquiryId: e.id, version: u.version }} fields={[{ key: "on", label: "Viewing date", kind: "date" }]} submit="Save" done="Viewing saved." />],
                              ["Note", <StepForm area="letting" action="step" id={u.unitId} fixed={{ step: "note", enquiryId: e.id, version: u.version }} fields={[{ key: "text", label: "What happened", wide: true }]} submit="Save" done="Note saved." />],
                              ...(e.status !== "approved"
                                ? ([
                                    [
                                      "Offer",
                                      <StepForm
                                        area="letting"
                                        action="step"
                                        id={u.unitId}
                                        fixed={{ step: "offer", enquiryId: e.id, version: u.version }}
                                        fields={[
                                          { key: "rent", label: "Rent RM/month", kind: "number", initial: String(u.askingRent) },
                                          { key: "startOn", label: "Start date", kind: "date" },
                                          { key: "months", label: "Months", kind: "number", initial: "24" },
                                          { key: "depositMonths", label: "Deposit (months)", kind: "number", initial: "2" },
                                          { key: "reason", label: "Reason if under asking", wide: true },
                                        ]}
                                        submit="Send to the Asset Director"
                                        done="Offer saved. The Asset Director decides."
                                      />,
                                    ],
                                  ] as [string, ReactNode][])
                                : []),
                              ...(e.status === "approved"
                                ? ([
                                    [
                                      "Signed",
                                      <StepForm
                                        area="letting"
                                        action="step"
                                        id={u.unitId}
                                        fixed={{ step: "signed", enquiryId: e.id, version: u.version }}
                                        fields={[
                                          { key: "agreementRef", label: "Agreement number" },
                                          { key: "on", label: "Signed on", kind: "date", initial: todayMy() },
                                        ]}
                                        submit="Record signing"
                                        done="Signed. Add the tenancy on the unit to start billing."
                                      />,
                                    ],
                                  ] as [string, ReactNode][])
                                : []),
                              ["Close", <StepForm area="letting" action="step" id={u.unitId} fixed={{ step: "lost", enquiryId: e.id, version: u.version }} fields={[{ key: "reason", label: "Why", kind: "select", options: LOST }, { key: "note", label: "Note", wide: true }]} submit="Close enquiry" done="Closed." />],
                            ] as [string, ReactNode][])
                          : []),
                        ...(d.can.decide && e.status === "offer"
                          ? ([
                              [
                                "Approve or turn down",
                                <StepForm
                                  area="letting"
                                  action="step"
                                  id={u.unitId}
                                  fixed={{ step: "decide", enquiryId: e.id, version: u.version }}
                                  fields={[
                                    { key: "approve", label: "Approve this offer", kind: "check" },
                                    { key: "note", label: "Reason", wide: true },
                                  ]}
                                  submit="Save decision"
                                  done="Decision saved."
                                  note="Leave the box unticked to turn it down. You cannot decide an offer you made."
                                />,
                              ],
                            ] as [string, ReactNode][])
                          : []),
                      ]}
                    />
                  )}
                </div>
              ))}
              {d.can.act && (
                <Actions
                  items={[
                    ["Advertise", <StepForm area="letting" action="advert" id={u.unitId} fields={[{ key: "channel", label: "Where", kind: "select", options: CHANNELS }, { key: "ref", label: "Link, agent or place", wide: true }, { key: "on", label: "Date", kind: "date", initial: todayMy() }]} submit="Save" done="Advert saved." />],
                    ["New enquiry", <StepForm area="letting" action="enquiry" id={u.unitId} fields={[{ key: "name", label: "Name" }, { key: "phone", label: "Phone" }, { key: "source", label: "Heard from", kind: "select", options: CHANNELS }, { key: "use", label: "What for", wide: true }]} submit="Save" done="Enquiry saved." note="Personal data: only the Asset Management team sees the phone number." />],
                  ]}
                />
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// ---------- Meters ----------

function Meters({ d }: { d: AmExtrasBoard }) {
  const [show, setShow] = useState<"flagged" | "all">("flagged");
  const [q, setQ] = useState("");
  const rows = d.meters.filter((m) => (show === "all" || m.flags.length) && (!q || `${m.place} ${m.account}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <div className="kpis">
        <Kpi label="Meters" value={d.meters.length} />
        <Kpi label="Flagged" value={d.kpis.metersFlagged} note={`not read in ${d.rule.meterReadDays} days, a jump, or use at an empty unit`} tone={d.kpis.metersFlagged ? "warn" : "ok"} />
      </div>
      <section className="panel">
        <div className="panel-head">
          <h3>Utility meters</h3>
          <span className="muted small">Read every meter monthly with a photo. A reading over {d.rule.meterSpikeX}x the usual is flagged. Recording a bill is not paying it: Finance pays.</span>
          <div className="row" style={{ gap: 4 }}>
            {(["flagged", "all"] as const).map((k) => (
              <button key={k} className="btn btn-sm" aria-pressed={show === k} onClick={() => setShow(k)}>
                {k === "flagged" ? "Flagged" : "All meters"}
              </button>
            ))}
            <input className="input" aria-label="Find a meter" placeholder="Unit, place or account" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="list">
          {rows.length === 0 && <div className="empty">No meter matches.</div>}
          {rows.slice(0, 120).map((m) => (
            <div key={m.id} className="list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
              <div className="row" style={{ justifyContent: "space-between", gap: 6, alignItems: "flex-start", flexWrap: "nowrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {m.place} · {m.kind === "ELECTRICITY" ? "Electricity" : "Water"}
                  </div>
                  <div className="muted small">
                    {m.account} · {m.payer === "owner" ? "the group pays" : "tenant pays"}
                    {m.last ? ` · last ${m.last.reading} on ${dateLabel(m.last.on)}${m.last.usage != null ? `, used ${m.last.usage}` : ""}` : " · never read"}
                    {m.usual != null ? ` · usual ${m.usual}` : ""}
                    {m.bills.length ? ` · last bill ${m.bills.at(-1)!.period} ${rm(m.bills.at(-1)!.amount)}` : ""}
                  </div>
                </div>
              </div>
              <Flags flags={m.flags} />
              {d.can.act && (
                <Actions
                  items={[
                    [
                      "Record reading",
                      <StepForm
                        area="meter"
                        action="read"
                        id={m.id}
                        fixed={{ version: m.version }}
                        fields={[
                          { key: "reading", label: "Meter number", kind: "number" },
                          { key: "on", label: "Date", kind: "date", initial: todayMy() },
                          { key: "photoRef", label: "Photo reference" },
                          { key: "newMeter", label: "New meter", kind: "check" },
                          { key: "note", label: "Note (why changed)", wide: true },
                        ]}
                        submit="Save reading"
                        done="Reading saved."
                      />,
                    ],
                    ...(m.payer === "owner"
                      ? ([
                          [
                            "Record bill",
                            <StepForm
                              area="meter"
                              action="bill"
                              id={m.id}
                              fixed={{ version: m.version }}
                              fields={[
                                { key: "period", label: "Month (YYYY-MM)", initial: todayMy().slice(0, 7) },
                                { key: "amount", label: "Amount RM", kind: "number" },
                                { key: "billRef", label: "Bill number" },
                              ]}
                              submit="Save bill"
                              done="Bill recorded. Finance pays it."
                            />,
                          ],
                        ] as [string, ReactNode][])
                      : []),
                  ]}
                />
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// ---------- Resorts ----------

function Resorts({ d }: { d: AmExtrasBoard }) {
  const [rid, setRid] = useState(d.resorts[0]?.id ?? "");
  const r = d.resorts.find((x) => x.id === rid) ?? d.resorts[0];
  if (!r) return <div className="empty">No resort.</div>;
  const open = r.bookings.filter((b) => !["checked_out", "cancelled", "no_show"].includes(b.status));
  const closed = r.bookings.filter((b) => ["checked_out", "cancelled", "no_show"].includes(b.status));
  return (
    <>
      <div className="kpis">
        <Kpi label="Guests in house (both resorts)" value={d.kpis.inHouse} />
        <Kpi label="Arriving today here" value={r.arrivingToday} />
        <Kpi label="Payments for Finance to confirm" value={d.kpis.toBank} tone={d.kpis.toBank ? "warn" : "ok"} />
      </div>
      <section className="panel">
        <div className="panel-head">
          <h3>Resort bookings</h3>
          <div className="row" style={{ gap: 4 }}>
            {d.resorts.map((x) => (
              <button key={x.id} className="btn btn-sm" aria-pressed={x.id === r.id} onClick={() => setRid(x.id)}>
                {x.name}
              </button>
            ))}
          </div>
          <span className="muted small">
            Never more rooms than there are. An outside booking is held {d.rule.holdDays} days, confirmed with a {d.rule.depositPct}% deposit, and paid in full before
            check-out. A group booking is billed to its company. The Asset Director sets the price list; a lower price needs a reason.
          </span>
        </div>
        <Flags flags={r.flags} />
        {r.stay?.policy && (
          <p className="muted small" style={{ margin: "4px 0" }}>
            House rules: check-in from {r.stay.policy.checkInTime}, check-out by {r.stay.policy.checkOutTime} · free cancellation up to {r.stay.policy.freeCancelDays} days before arrival, then{" "}
            {r.stay.policy.lateCancelKeepPct}% of what was paid is kept · no-show keeps {r.stay.policy.noShowKeepPct}% ·{" "}
            {r.stay.policy.sstRegistered ? "registered for service tax" : "not registered for service tax (none charged)"} · MOTAC {r.stay.policy.motacNo || "not recorded"}
            {r.stay.policy.motacExpiresOn ? ` to ${dateLabel(r.stay.policy.motacExpiresOn)}` : ""}
          </p>
        )}
        {r.stay ? (
          <div style={{ overflowX: "auto" }}>
            <table className="table small" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th>Free rooms, next 14 nights</th>
                  {r.grid[0]?.nights.map((n) => (
                    <th key={n.night} style={{ textAlign: "center" }}>
                      {n.night.slice(8)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.grid.map((g) => (
                  <tr key={g.type}>
                    <td>
                      {STAY[g.type]} ({g.capacity}) {g.rate != null ? rm(g.rate) : ""}
                    </td>
                    {g.nights.map((n) => {
                      const free = n.free;
                      return (
                        <td
                          key={n.night}
                          title={n.out ? `${n.out} out of order` : undefined}
                          style={{ textAlign: "center", fontWeight: free === 0 ? 700 : undefined, color: free === 0 ? "var(--crit, #b42318)" : undefined }}
                        >
                          {free}
                          {n.out ? "*" : ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No rooms or price list yet. The Asset Director sets them.</p>
        )}
        {r.grid.some((g) => g.nights.some((n) => n.out)) && <span className="muted small">* A room is out of order that night and is not sold.</span>}
        <Actions
          items={[
            ...(d.can.act && r.stay
              ? ([
                  [
                    "New booking",
                    <StepForm
                      area="booking"
                      action="add"
                      fixed={{ propertyId: r.id }}
                      fields={[
                        { key: "type", label: "Kind", kind: "select", options: Object.fromEntries(Object.keys(r.stay.capacity).map((t) => [t, STAY[t]])) },
                        { key: "qty", label: "How many", kind: "number", initial: "1" },
                        { key: "checkIn", label: "Arrive", kind: "date" },
                        { key: "checkOut", label: "Leave", kind: "date" },
                        { key: "guest", label: "Guest or group" },
                        { key: "phone", label: "Phone" },
                        { key: "rate", label: "Price per night (blank = list)", kind: "number" },
                        { key: "discountReason", label: "Reason if under the list", wide: true },
                        { key: "internal", label: "Group booking (billed to a company)", kind: "check" },
                        { key: "billTo", label: "Bill to (group booking)", wide: true },
                      ]}
                      submit="Book"
                      done="Booked."
                    />,
                  ],
                ] as [string, ReactNode][])
              : []),
            ...(d.can.decide
              ? ([
                  [
                    "Rooms and price list",
                    <StepForm
                      area="resort"
                      action="rates"
                      id={r.id}
                      fields={[
                        ...(["ROOM", "CHALET", "HALL", "CAMPSITE"] as const).flatMap((t) => [
                          { key: `cap_${t}`, label: `${STAY[t]}s`, kind: "number" as const, initial: String(r.stay?.capacity[t] ?? "") },
                          { key: `rate_${t}`, label: `${STAY[t]} RM/night`, kind: "number" as const, initial: String(r.stay?.rates[t] ?? "") },
                        ]),
                        { key: "sstPct", label: "Service tax %", kind: "number" as const, initial: String(r.stay?.taxes?.sstPct ?? 0) },
                        { key: "tourismTaxPerNight", label: "Tourism tax RM per room-night (foreign guests)", kind: "number" as const, initial: String(r.stay?.taxes?.tourismTaxPerNight ?? 0) },
                        { key: "stateFeePerNight", label: "State fee RM per room-night", kind: "number" as const, initial: String(r.stay?.taxes?.stateFeePerNight ?? 0) },
                        { key: "stateFeeName", label: "State fee name", initial: r.stay?.taxes?.stateFeeName ?? "" },
                        { key: "taxNote", label: "Where the rates come from", wide: true, initial: r.stay?.taxes?.note ?? "" },
                      ]}
                      transform={(b) => ({
                        capacity: Object.fromEntries(["ROOM", "CHALET", "HALL", "CAMPSITE"].map((t) => [t, b[`cap_${t}`] ?? 0])),
                        rates: Object.fromEntries(["ROOM", "CHALET", "HALL", "CAMPSITE"].map((t) => [t, b[`rate_${t}`] ?? 0])),
                        taxes: { sstPct: b.sstPct ?? 0, tourismTaxPerNight: b.tourismTaxPerNight ?? 0, stateFeePerNight: b.stateFeePerNight ?? 0, stateFeeName: b.stateFeeName, note: b.taxNote },
                      })}
                      submit="Save price list"
                      done="Price list saved."
                      note="Prices here are your approved list. Tax rates apply to new bookings only; Finance confirms them with Customs and the state. The sample figures are made up."
                    />,
                  ],
                  ...(r.stay
                    ? ([
                        [
                          "House rules",
                          <StepForm
                            area="resort"
                            action="policy"
                            id={r.id}
                            fields={[
                              { key: "sstRegistered", label: "Company registered for service tax", kind: "check", initial: r.stay.policy?.sstRegistered ?? false },
                              { key: "motacNo", label: "MOTAC registration no.", initial: r.stay.policy?.motacNo ?? "" },
                              { key: "motacExpiresOn", label: "MOTAC valid until", kind: "date", initial: r.stay.policy?.motacExpiresOn ?? "" },
                              { key: "checkInTime", label: "Check-in from (HH:MM)", initial: r.stay.policy?.checkInTime ?? "15:00" },
                              { key: "checkOutTime", label: "Check-out by (HH:MM)", initial: r.stay.policy?.checkOutTime ?? "12:00" },
                              { key: "freeCancelDays", label: "Free cancellation, days before arrival", kind: "number", initial: String(r.stay.policy?.freeCancelDays ?? "") },
                              { key: "lateCancelKeepPct", label: "Late cancellation: % of paid kept", kind: "number", initial: String(r.stay.policy?.lateCancelKeepPct ?? "") },
                              { key: "noShowKeepPct", label: "No-show: % of paid kept", kind: "number", initial: String(r.stay.policy?.noShowKeepPct ?? "") },
                            ]}
                            submit="Save house rules"
                            done="House rules saved."
                            note="New bookings take these terms; existing bookings keep the terms they were made under. Without service tax registration no service tax is charged."
                          />,
                        ],
                      ] as [string, ReactNode][])
                    : []),
                ] as [string, ReactNode][])
              : []),
          ]}
        />
        <div className="list">
          {open.length === 0 && <div className="empty">No open bookings.</div>}
          {[...open, ...closed.slice(-8)].map((b) => (
            <div key={b.id} className="list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
              <div className="row" style={{ justifyContent: "space-between", gap: 6, alignItems: "flex-start", flexWrap: "nowrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {b.ref} · {b.guest}
                  </div>
                  <div className="muted small">
                    {b.qty} {STAY[b.type].toLowerCase()} · {dateLabel(b.checkIn)} to {dateLabel(b.checkOut)} ({b.nights} nights) · {rm(b.rate)}/night · total {rm(b.total)}
                    {b.internal ? ` · bill to ${b.billTo}` : ` · paid ${rm(b.paid)}`}
                    {d.can.act ? ` · ${b.phone}` : ""}
                  </div>
                  <div className="muted small">
                    Bill: room {rm(b.bill.room)}
                    {b.bill.extras ? ` · extras ${rm(b.bill.extras)}` : ""}
                    {b.bill.sst ? ` · service tax ${rm(b.bill.sst)}` : ""}
                    {b.bill.tourism ? ` · tourism tax ${rm(b.bill.tourism)}` : ""}
                    {b.bill.stateFee ? ` · ${b.taxRates?.stateFeeName || "state fee"} ${rm(b.bill.stateFee)}` : ""}
                    {(b.roomNos ?? []).length ? ` · rooms ${(b.roomNos ?? []).join(", ")}` : ""}
                    {b.register ? ` · ID ${b.register.idType === "MYKAD" ? "MyKad" : b.register.idType === "PASSPORT" ? "passport" : "other"} ${b.register.idNo}, ${b.register.nationality}` : ""}
                  </div>
                  {b.settlement && (
                    <div className="muted small">
                      Under the terms: RM{b.settlement.keep} kept ({b.settlement.keepPct}%) · RM{b.settlement.refundDue} owed back · RM{b.settlement.refunded} paid back
                    </div>
                  )}
                  {(b.charges ?? []).length > 0 && (
                    <div className="muted small">
                      Extras: {(b.charges ?? []).map((c) => `${c.what} ${rm(c.amount)}${c.reason ? ` (${c.reason})` : ""}`).join("; ")}
                    </div>
                  )}
                </div>
                <span style={{ flexShrink: 0 }}><Chip tone={B_STATUS[b.status][0]}>{B_STATUS[b.status][1]}</Chip></span>
              </div>
              <Flags flags={b.flags} />
              {d.can.act && b.settlement && b.settlement.refundDue > b.settlement.refunded && (
                <Actions
                  items={[
                    [
                      "Pay back",
                      <StepForm
                        area="booking"
                        action="step"
                        id={b.id}
                        fixed={{ step: "refund", version: b.version }}
                        fields={[
                          { key: "amount", label: "Amount RM", kind: "number", initial: String(Math.round((b.settlement.refundDue - b.settlement.refunded) * 100) / 100) },
                          { key: "method", label: "How", kind: "select", options: { TRANSFER: "Transfer", CASH: "Cash", CARD: "Card", ONLINE: "Online" } },
                          { key: "ref", label: "Reference (not cash)" },
                        ]}
                        submit="Record refund"
                        done="Refund recorded. Finance confirms it in the bank."
                      />,
                    ],
                  ]}
                />
              )}
              {d.can.act && !["checked_out", "cancelled", "no_show"].includes(b.status) && (
                <Actions
                  items={[
                    ...(!b.internal && b.balance > 0
                      ? ([
                          [
                            "Payment",
                            <StepForm
                              area="booking"
                              action="step"
                              id={b.id}
                              fixed={{ step: "pay", version: b.version }}
                              fields={[
                                { key: "amount", label: "Amount RM", kind: "number", initial: String(b.balance) },
                                { key: "method", label: "How", kind: "select", options: { CASH: "Cash", TRANSFER: "Transfer", CARD: "Card", ONLINE: "Online" } },
                                { key: "ref", label: "Reference (not cash)" },
                              ]}
                              submit="Record"
                              done="Payment recorded. Finance confirms it in the bank."
                            />,
                          ],
                        ] as [string, ReactNode][])
                      : []),
                    ...(b.status === "held" ? ([["Confirm", <StepForm area="booking" action="step" id={b.id} fixed={{ step: "confirm", version: b.version }} fields={[]} submit="Confirm booking" done="Confirmed." />]] as [string, ReactNode][]) : []),
                    ...(b.status === "confirmed"
                      ? ([
                          [
                            "Check in",
                            <StepForm
                              area="booking"
                              action="step"
                              id={b.id}
                              fixed={{ step: "checkin", version: b.version }}
                              fields={[
                                { key: "idType", label: "ID", kind: "select", options: { MYKAD: "MyKad", PASSPORT: "Passport", OTHER: "Other ID" } },
                                { key: "idNo", label: "ID number" },
                                { key: "nationality", label: "Nationality", initial: "Malaysia" },
                                ...(b.type === "ROOM" || b.type === "CHALET"
                                  ? [{ key: "roomNos", label: `${b.qty} ${STAY[b.type].toLowerCase()} no. (e.g. ${r.rooms.filter((x) => x.type === b.type && x.state === "vacant" && x.hk !== "dirty").slice(0, b.qty).map((x) => x.no).join(", ") || "none ready"})` }]
                                  : []),
                              ]}
                              submit="Check in"
                              done="Checked in."
                              note={`Guest register (Innkeepers Act): only the Asset Management team sees the ID number. A foreign guest pays tourism tax.${b.terms ? ` Check-in from ${b.terms.checkInTime}, check-out by ${b.terms.checkOutTime}.` : ""}`}
                            />,
                          ],
                        ] as [string, ReactNode][])
                      : []),
                    ...(["confirmed", "checked_in"].includes(b.status)
                      ? ([
                          [
                            "Add extra",
                            <StepForm
                              area="booking"
                              action="step"
                              id={b.id}
                              fixed={{ step: "charge", version: b.version }}
                              fields={[
                                { key: "what", label: "What (meal, extra bed, activity)", wide: true },
                                { key: "amount", label: "RM (minus to correct)", kind: "number" },
                                { key: "reason", label: "Reason if minus", wide: true },
                              ]}
                              submit="Add to bill"
                              done="Added to the bill."
                            />,
                          ],
                        ] as [string, ReactNode][])
                      : []),
                    ...(b.status === "checked_in" ? ([["Check out", <StepForm area="booking" action="step" id={b.id} fixed={{ step: "checkout", version: b.version }} fields={[]} submit="Check out" done="Checked out." />]] as [string, ReactNode][]) : []),
                    ...(["held", "confirmed"].includes(b.status)
                      ? ([
                          ["Cancel", <StepForm area="booking" action="step" id={b.id} fixed={{ step: "cancel", version: b.version }} fields={[{ key: "reason", label: "Why", wide: true }]} submit="Cancel booking" done="Cancelled." note={b.terms ? `Terms: free up to ${b.terms.freeCancelDays} days before arrival, then ${b.terms.lateCancelKeepPct}% of what was paid is kept.` : "No terms on record: the Asset Director decides any refund."} />],
                          ["No-show", <StepForm area="booking" action="step" id={b.id} fixed={{ step: "noshow", version: b.version }} fields={[{ key: "reason", label: "Note", wide: true }]} submit="Mark no-show" done="Marked no-show." note={b.terms ? `Terms: ${b.terms.noShowKeepPct}% of what was paid is kept.` : undefined} />],
                        ] as [string, ReactNode][])
                      : []),
                  ]}
                />
              )}
            </div>
          ))}
        </div>
      </section>
      <DailyReport r={r} />
      <RoomsBoard r={r} can={d.can.act} />
    </>
  );
}

type Resort = AmExtrasBoard["resorts"][number];

/** The front office's end-of-day numbers, like a hotel night audit. */
function DailyReport({ r }: { r: Resort }) {
  const x = r.report;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Today at {r.name}</h3>
        <span className="muted small">Rooms and chalets only (halls and pitches are not counted in occupancy). Taxes are from stays that ended this month, for Finance to file.</span>
      </div>
      <div className="kpis">
        <Kpi label="Rooms to sell tonight" value={x.roomsAvailable} />
        <Kpi label="Sold tonight" value={x.roomsSold} />
        <Kpi label="Occupancy" value={`${x.occupancyPct}%`} />
        <Kpi label="Average rate (ADR)" value={rm(x.adr)} />
        <Kpi label="Revenue per room (RevPAR)" value={rm(x.revpar)} />
        <Kpi label="Unpaid, guests in house" value={rm(x.openBalances)} tone={x.openBalances ? "warn" : "ok"} />
      </div>
      <div className="list small">
        <div className="list-item">Arriving today: {x.arrivals.length ? x.arrivals.map((a) => `${a.ref} ${a.guest}`).join("; ") : "none"}</div>
        <div className="list-item">Leaving today: {x.departures.length ? x.departures.map((a) => `${a.ref} ${a.guest}${a.balance > 0 ? ` (owes ${rm(a.balance)})` : ""}`).join("; ") : "none"}</div>
        <div className="list-item">In house: {x.inHouse}</div>
        {x.noShowsToMark.length > 0 && <div className="list-item">Did not arrive, mark as no-show or check in: {x.noShowsToMark.map((a) => `${a.ref} ${a.guest} (${dateLabel(a.checkIn)})`).join("; ")}</div>}
        <div className="list-item">
          Taken today: {rm(x.paymentsToday.total)}
          {Object.entries(x.paymentsToday.byMethod).map(([k, v]) => ` · ${k.toLowerCase()} ${rm(v)}`)}
        </div>
        <div className="list-item">
          This month ({x.monthToDate.stays} stays closed): service tax {rm(x.monthToDate.sst)} · tourism tax {rm(x.monthToDate.tourismTax)} ({x.monthToDate.tourismRoomNights} foreign room-nights)
          {x.monthToDate.stateFeeName ? ` · ${x.monthToDate.stateFeeName} ${rm(x.monthToDate.stateFee)}` : ""}
        </div>
      </div>
    </section>
  );
}

const HK: Record<string, [string, string]> = { dirty: ["warn", "Dirty"], clean: ["info", "Cleaned"], inspected: ["ok", "Inspected"] };

/** Housekeeping: which rooms are dirty, cleaned or inspected (ready to sell), and which are out of order. */
function RoomsBoard({ r, can }: { r: Resort; can: boolean }) {
  const [only, setOnly] = useState<"all" | "dirty" | "out">("all");
  if (!r.rooms.length) return null;
  const rows = r.rooms.filter((x) => (only === "dirty" ? x.hk === "dirty" && x.state !== "out" : only === "out" ? x.state === "out" : true));
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Rooms and cleaning</h3>
        <div className="row" style={{ gap: 4 }}>
          {(["all", "dirty", "out"] as const).map((k) => (
            <button key={k} className="btn btn-sm" aria-pressed={only === k} onClick={() => setOnly(k)}>
              {k === "all" ? "All" : k === "dirty" ? `Dirty (${r.hk.dirty})` : `Out of order (${r.hk.out})`}
            </button>
          ))}
        </div>
        <span className="muted small">
          {r.hk.readyToSell} empty and inspected, ready for a guest. A room is cleaned, then someone else inspects it. A guest goes only into a clean room; check-out leaves it dirty.
        </span>
      </div>
      <div className="list">
        {rows.map((x) => (
          <div key={x.no} className="list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
            <div className="row" style={{ justifyContent: "space-between", gap: 6, flexWrap: "nowrap" }}>
              <div style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{x.no}</span> <span className="muted small">{STAY[x.type]}</span>
                <div className="muted small">
                  {x.state === "out" && x.out ? `Out of order to ${dateLabel(x.out.until)}: ${x.out.reason}` : x.guest ? `${x.guest.ref} ${x.guest.name}, leaves ${dateLabel(x.guest.checkOut)}` : "Empty"}
                  {` · ${HK[x.hk][1].toLowerCase()} by ${x.hkBy}`}
                </div>
              </div>
              <span style={{ flexShrink: 0 }}><Chip tone={x.state === "out" ? "crit" : (HK[x.hk][0] as "ok")}>{x.state === "out" ? "Out of order" : HK[x.hk][1]}</Chip></span>
            </div>
            {can && (
              <Actions
                items={[
                  ...(x.state !== "out"
                    ? ([
                        ...(x.hk !== "clean" ? [["Cleaned", <StepForm area="room" action="step" id={r.id} fixed={{ step: "status", roomNo: x.no, hk: "clean" }} fields={[]} submit="Mark cleaned" done="Marked cleaned." />]] : []),
                        ...(x.hk === "clean" ? [["Inspected", <StepForm area="room" action="step" id={r.id} fixed={{ step: "status", roomNo: x.no, hk: "inspected" }} fields={[]} submit="Mark inspected" done="Inspected." note="Not the person who cleaned it." />]] : []),
                        ...(x.hk !== "dirty" && !x.guest ? [["Dirty", <StepForm area="room" action="step" id={r.id} fixed={{ step: "status", roomNo: x.no, hk: "dirty" }} fields={[]} submit="Mark dirty" done="Marked dirty." />]] : []),
                        [
                          "Out of order",
                          <StepForm
                            area="room"
                            action="step"
                            id={r.id}
                            fixed={{ step: "out", roomNo: x.no }}
                            fields={[
                              { key: "from", label: "From", kind: "date", initial: todayMy() },
                              { key: "until", label: "Until", kind: "date" },
                              { key: "reason", label: "What is wrong", wide: true },
                            ]}
                            submit="Take out"
                            done="Taken out of sale."
                            note="Raise a work order for the repair. The room is not sold on these nights."
                          />,
                        ],
                      ] as [string, ReactNode][])
                    : ([["Back in use", <StepForm area="room" action="step" id={r.id} fixed={{ step: "back", roomNo: x.no }} fields={[]} submit="Back in use" done="Back in use; clean it first." />]] as [string, ReactNode][])),
                ]}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- Orchards ----------

function Orchards({ d }: { d: AmExtrasBoard }) {
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h3>Orchards, last 30 days</h3>
          <span className="muted small">
            Every kilo picked is sold, spoiled or kept with a note. Each sale has a weighing slip. A price {d.rule.priceDropPct}% under the recent average,
            spoilage over {d.rule.spoilPct}% or more than {d.rule.keptPct}% kept or given away is flagged.
          </span>
        </div>
        <div className="list">
          {d.orchards.map((o) => (
            <div key={o.id} className="list-item">
              <span>{o.name}</span>
              <span className="muted small">
                {o.picked30.toLocaleString("en-MY")} kg picked · {rm(o.sold30)} sold · {o.spoiled30} kg spoiled {o.flags ? `· ${o.flags} flags` : ""}
              </span>
            </div>
          ))}
        </div>
        {d.can.act && (
          <Actions
            items={[
              [
                "Record a pick",
                <StepForm
                  area="harvest"
                  action="add"
                  fields={[
                    { key: "propertyId", label: "Orchard", kind: "select", options: Object.fromEntries(d.properties.filter((p) => p.kind === "ORCHARD").map((p) => [p.id, p.name])) },
                    { key: "crop", label: "Crop" },
                    { key: "pickedKg", label: "Kg picked", kind: "number" },
                    { key: "on", label: "Date", kind: "date", initial: todayMy() },
                    { key: "photoRef", label: "Photo on the scale" },
                  ]}
                  submit="Save pick"
                  done="Pick saved."
                />,
              ],
            ]}
          />
        )}
      </section>
      {d.credit.some((s) => !s.banked) && (
        <section className="panel">
          <div className="panel-head">
            <h3>Sold on credit, not yet paid</h3>
          </div>
          <div className="list">
            {d.credit
              .filter((s) => !s.banked)
              .map((s) => (
                <div key={s.id} className="list-item">
                  <span>
                    {s.buyer} · {s.crop}
                  </span>
                  <span className="muted small">
                    {rm(s.amount)} · {s.days} days · {s.place}
                  </span>
                </div>
              ))}
          </div>
        </section>
      )}
      <section className="panel">
        <div className="panel-head">
          <h3>Picks</h3>
        </div>
        <div className="list">
          {d.harvests.slice(0, 60).map((h) => (
            <div key={h.id} className="list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
              <div className="row" style={{ justifyContent: "space-between", gap: 6, alignItems: "flex-start", flexWrap: "nowrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {h.place} · {h.crop} · {dateLabel(h.on)}
                  </div>
                  <div className="muted small">
                    {h.pickedKg} kg picked · {h.sales.reduce((n, s) => n + s.kg, 0)} kg sold for {rm(h.amount)} · {h.spoiledKg} kg spoiled · {h.keptKg} kg kept
                  </div>
                  {h.sales.map((s) => (
                    <div key={s.id} className="muted small">
                      {s.buyer}: {s.kg} kg at {rm(s.pricePerKg)}/kg = {rm(s.amount)}, slip {s.slipRef}, {s.method.toLowerCase()}
                      {s.banked ? " · in the bank" : s.method === "CREDIT" ? " · not paid yet" : " · Finance to confirm"}
                    </div>
                  ))}
                </div>
                <span style={{ flexShrink: 0 }}><Chip tone={h.left > 0 ? "warn" : "ok"}>{h.left > 0 ? `${h.left} kg left` : "Accounted for"}</Chip></span>
              </div>
              <Flags flags={h.flags} />
              {d.can.act && h.left > 0 && (
                <Actions
                  items={[
                    [
                      "Sale",
                      <StepForm
                        area="harvest"
                        action="step"
                        id={h.id}
                        fixed={{ step: "sale", version: h.version }}
                        fields={[
                          { key: "buyer", label: "Buyer" },
                          { key: "kg", label: "Kg", kind: "number", initial: String(h.left) },
                          { key: "pricePerKg", label: "RM per kg", kind: "number" },
                          { key: "slipRef", label: "Weighing slip" },
                          { key: "method", label: "Paid by", kind: "select", options: { CASH: "Cash", TRANSFER: "Transfer", CREDIT: "Credit (pay later)" } },
                          { key: "ref", label: "Bank ref (transfer)" },
                        ]}
                        submit="Save sale"
                        done="Sale saved."
                      />,
                    ],
                    ["Spoiled", <StepForm area="harvest" action="step" id={h.id} fixed={{ step: "spoiled", version: h.version }} fields={[{ key: "kg", label: "Kg", kind: "number" }, { key: "note", label: "Why", wide: true }]} submit="Save" done="Saved." />],
                    ["Kept or given", <StepForm area="harvest" action="step" id={h.id} fixed={{ step: "kept", version: h.version }} fields={[{ key: "kg", label: "Kg", kind: "number" }, { key: "note", label: "Who to and why", wide: true }]} submit="Save" done="Saved." />],
                  ]}
                />
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// ---------- Planned maintenance ----------

function Planned({ d }: { d: AmExtrasBoard }) {
  const act = useAction();
  const [show, setShow] = useState<"soon" | "all">("soon");
  const rows = show === "all" ? d.plans : d.plans.filter((p) => p.state !== "planned");
  return (
    <>
      <div className="kpis">
        <Kpi label="Planned jobs" value={d.plans.length} />
        <Kpi label="Overdue" value={d.kpis.pmOverdue} note={`${d.kpis.pmStatutoryOverdue} required by law or licence`} tone={d.kpis.pmStatutoryOverdue ? "crit" : d.kpis.pmOverdue ? "warn" : "ok"} />
      </div>
      <section className="panel">
        <div className="panel-head">
          <h3>Planned maintenance</h3>
          <span className="muted small">
            A job becomes a work order {d.rule.pmLeadDays} days before it is due. When the work order is done, the next date moves on. Only the Asset Director
            pauses a job the law or a licence requires.
          </span>
          <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
            {(["soon", "all"] as const).map((k) => (
              <button key={k} className="btn btn-sm" aria-pressed={show === k} onClick={() => setShow(k)}>
                {k === "soon" ? "Due, overdue or ordered" : "All plans"}
              </button>
            ))}
            {d.can.act && (
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy}
                onClick={() =>
                  act.run(
                    () => api.amExtrasAct("pm", "raise", "", {}),
                    (r) => {
                      const x = r as { raised?: unknown[]; rolled?: unknown[] };
                      return `${x.raised?.length ?? 0} work orders raised, ${x.rolled?.length ?? 0} plans moved on.`;
                    },
                  )
                }
              >
                Raise due work orders
              </button>
            )}
          </div>
        </div>
        <ErrorNotice error={act.error} />
        {d.can.act && (
          <Actions
            items={[
              [
                "Add a planned job",
                <StepForm
                  area="pm"
                  action="add"
                  fields={[
                    { key: "propertyId", label: "Property", kind: "select", options: { "": "(a unit instead)", ...Object.fromEntries(d.properties.map((p) => [p.id, p.name])) } },
                    { key: "unitId", label: "Unit", kind: "select", options: { "": "(a property instead)", ...Object.fromEntries(d.units.map((u) => [u.id, `${u.code} ${u.name}`])) } },
                    { key: "task", label: "What is done", wide: true },
                    { key: "trade", label: "Kind of work", kind: "select", options: TRADES },
                    { key: "everyMonths", label: "Every (months)", kind: "number", initial: "12" },
                    { key: "nextDueOn", label: "Next due", kind: "date" },
                    { key: "statutory", label: "Required by law or licence", kind: "check" },
                  ]}
                  submit="Add"
                  done="Planned job added."
                />,
              ],
            ]}
          />
        )}
        <div className="list">
          {rows.length === 0 && <div className="empty">Nothing due.</div>}
          {rows.map((p) => (
            <div key={p.id} className="list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
              <div className="row" style={{ justifyContent: "space-between", gap: 6, alignItems: "flex-start", flexWrap: "nowrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {p.task} {p.statutory && <Chip tone="info">Law or licence</Chip>}
                  </div>
                  <div className="muted small">
                    {p.place} · {TRADES[p.trade]} · every {p.everyMonths} months · due {dateLabel(p.nextDueOn)}
                    {p.lastDoneOn ? ` · last done ${dateLabel(p.lastDoneOn)}` : ""}
                    {p.workOrder ? ` · work order ${p.workOrder.status.replace("_", " ")}` : ""}
                    {p.paused ? ` · paused by ${p.paused.by}: ${p.paused.reason}` : ""}
                  </div>
                </div>
                <span style={{ flexShrink: 0 }}><Chip tone={PM_STATE[p.state][0]}>{PM_STATE[p.state][1]}</Chip></span>
              </div>
              {d.can.act && (!p.statutory || d.can.decide) && (
                <Actions
                  items={[
                    [
                      p.paused ? "Resume" : "Pause",
                      <StepForm area="pm" action="pause" id={p.id} fixed={{ resume: !!p.paused, version: p.version }} fields={[{ key: "reason", label: "Why", wide: true }]} submit={p.paused ? "Resume" : "Pause"} done="Saved." />,
                    ],
                  ]}
                />
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// ---------- Finance: confirm resort and harvest money in the bank ----------

function ToBank({ d, section }: { d: AmExtrasBoard; section: "resorts" | "orchards" }) {
  const rows = d.toBank.filter((x) => (section === "resorts" ? x.kind === "stay" : x.kind === "harvest"));
  if (!rows.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>For Finance: confirm in the bank</h3>
        <span className="muted small">A recorded payment is not proof until Finance matches it to the bank.</span>
      </div>
      <div className="list">
        {rows.map((x) => (
          <div key={x.id} className="list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
            <span className="small">
              {x.label} · {rm(x.amount)} {x.method.toLowerCase()} on {dateLabel(x.on)} · receipt {x.receiptNo || "none"} {x.ref}
            </span>
            <StepForm
              area={x.kind === "stay" ? "booking" : "harvest"}
              action="bank"
              id={x.parentId}
              fixed={x.kind === "stay" ? { paymentId: x.id } : { saleId: x.id }}
              fields={[
                { key: "on", label: "Bank date", kind: "date", initial: todayMy() },
                { key: "slipRef", label: "Slip or statement ref" },
              ]}
              submit="Confirm in the bank"
              done="Confirmed."
            />
          </div>
        ))}
      </div>
    </section>
  );
}
