import { OpsGuide } from "./OpsGuide";
import { useEffect, useState } from "react";
import { api, type AmBoard } from "../api";
import { FixedAssetsPanel } from "./FixedAssets";
import { RecordButton } from "./RecordForm";
import {
  Chip,
  ErrorNotice,
  Kpi,
  Loading,
  dateLabel,
  useAction,
  useLoad,
  type Tone,
} from "../ui";

/**
 * Asset Management (Fauzan, 26 Oct 2026): 450 rental units, every non-electronic asset, 2 resorts, 6 orchards and the
 * training facility. A working model, on mock data, of what the Asset Management system's developer should build; its
 * real data will come to Prima by API. No group company sees it: only the Asset Management team, group leadership and
 * the finance staff who oversee it.
 */

type Tab =
  | "overview"
  | "units"
  | "monthly"
  | "rent"
  | "maintenance"
  | "assets"
  | "books"
  | "properties"
  | "check"
  | "buy";
const TABS: [Tab, string][] = [
  ["overview", "Overview"],
  ["units", "Units"],
  ["monthly", "Monthly rent"],
  ["rent", "Rent and arrears"],
  ["maintenance", "Maintenance"],
  ["assets", "Assets"],
  ["books", "Depreciation and disposal"],
  ["properties", "Resorts, orchards, training"],
  ["check", "System check"],
  ["buy", "Purchases"],
];
const TYPE: Record<AmBoard["byType"][number]["type"], string> = {
  RESIDENTIAL: "Residential",
  COMMERCIAL: "Commercial",
  INDUSTRIAL: "Industrial",
  LAND: "Land",
};
const STATUS: Record<AmBoard["units"][number]["status"], [Tone, string]> = {
  let: ["ok", "Let"],
  vacant: ["warn", "Vacant"],
  maintenance: ["neutral", "Under maintenance"],
  reserved: ["info", "Reserved"],
};
const CATEGORY: Record<
  AmBoard["assets"]["byCategory"][number]["category"],
  string
> = {
  FURNITURE: "Furniture",
  FITTING: "Fittings",
  RENOVATION: "Renovations",
  OTHER: "Other (non-electronic)",
};
const KIND: Record<AmBoard["properties"][number]["kind"], string> = {
  RESORT: "Resort",
  ORCHARD: "Orchard",
  TRAINING: "Training facility",
};
const rm = (n: number) => `RM${Math.round(n).toLocaleString("en-MY")}`;

export function AssetsView() {
  const { data, error } = useLoad(() => api.amBoard(), []);
  const [tab, setTab] = useState<Tab>("overview");
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="Asset Management" />;
  const k = data.kpis;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Asset Management</h1>
        <p className="muted">
          The group's rental units, office furniture and fittings, resorts,
          orchards and training facility. Seen only by the Asset Management
          team, group leadership and the finance staff who oversee it. Test
          version on made-up data: the Asset Management system will send the
          real figures.
        </p>
      </div>
      <div className="kpis">
        <Kpi
          label="Units let"
          value={`${k.let} / ${k.units}`}
          note={`${k.occupancyPct}% occupied · ${k.vacant} vacant`}
          tone={k.occupancyPct >= 85 ? "ok" : "warn"}
        />
        <Kpi
          label="Rent collected this month"
          value={rm(k.collectedThisMonth)}
          note={`of ${rm(k.billedThisMonth)} billed`}
          tone={k.collectedThisMonth >= k.billedThisMonth * 0.9 ? "ok" : "warn"}
        />
        <Kpi
          label="Arrears"
          value={rm(k.arrears)}
          note={`${k.arrears90} tenants 90 days or more`}
          tone={k.arrears90 ? "crit" : k.arrears ? "warn" : "ok"}
        />
        <Kpi
          label="Work orders open"
          value={k.openOrders}
          note={`${k.overdueOrders} overdue`}
          tone={k.overdueOrders ? "crit" : "ok"}
        />
      </div>
      <div
        className="tabbar"
        role="tablist"
        aria-label="Asset Management sections"
        style={{ flexWrap: "wrap" }}
      >
        {TABS.map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {label}
          </button>
        ))}
      </div>
      {data.can.approveLetters && data.lateUpdates.length > 0 && (
        <LateUpdates data={data} />
      )}
      {tab === "overview" && <Overview data={data} />}
      {tab === "units" && <Units data={data} />}
      {tab === "monthly" && <MonthlyRent data={data} />}
      {tab === "rent" && (
        <>
          <WhatsAppReminders />
          <Rent data={data} />
        </>
      )}
      {tab === "maintenance" && <Maintenance data={data} />}
      {tab === "assets" && <Assets data={data} />}
      {tab === "books" && <FixedAssetsPanel />}
      {tab === "properties" && <Properties data={data} />}
      {tab === "check" && <RentCheck />}
      {tab === "buy" && <Purchases data={data} />}
      <OpsGuide area="assets" />
    </div>
  );
}

function Bar({
  value,
  max,
  tone,
}: {
  value: number;
  max: number;
  tone: "ok" | "muted";
}) {
  return (
    <div
      style={{
        height: 8,
        background: "var(--line, #e5e7eb)",
        borderRadius: 4,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${max ? Math.min(100, (value / max) * 100) : 0}%`,
          height: "100%",
          background:
            tone === "ok" ? "var(--ok, #15803d)" : "var(--muted, #94a3b8)",
        }}
      />
    </div>
  );
}

function Overview({ data }: { data: AmBoard }) {
  const max = Math.max(...data.monthly.map((m) => m.billed), 1);
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h3>Units by type</h3>
        </div>
        <div className="list">
          {data.byType.map((t) => (
            <div
              key={t.type}
              className="list-item"
              style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}
            >
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span>{TYPE[t.type]}</span>
                <span className="muted small">
                  {t.let} of {t.units} let · {t.vacant} vacant ·{" "}
                  {t.occupancyPct}%
                </span>
              </div>
              <Bar value={t.let} max={t.units} tone="ok" />
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Rent billed and collected</h3>
          <span className="muted small">Last 6 months</span>
        </div>
        <div className="list">
          {data.monthly.map((m) => (
            <div
              key={m.period}
              className="list-item"
              style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}
            >
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span>{m.period}</span>
                <span className="muted small">
                  {rm(m.collected)} of {rm(m.billed)} (
                  {m.billed ? Math.round((m.collected / m.billed) * 100) : 0}%)
                </span>
              </div>
              <Bar value={m.collected} max={max} tone="ok" />
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Watch list</h3>
        </div>
        <div className="list">
          <Watch
            label={`Agreements ending within ${data.rule.tenancyWarnDays} days`}
            n={data.expiring.length}
            tone="warn"
          />
          <Watch
            label={`Insurance, assessment or quit rent due within ${data.rule.dueWarnDays} days or overdue`}
            n={data.dues.length}
            tone="warn"
          />
          <Watch
            label={`Units vacant over ${data.rule.vacantWarnDays} days`}
            n={data.vacantLong.length}
            tone="warn"
          />
          <Watch
            label="Tenants 90 days or more in arrears"
            n={data.kpis.arrears90}
            tone="crit"
          />
          <Watch
            label="Licences due within 60 days (resorts, orchards, training)"
            n={data.properties.reduce((n, p) => n + p.licencesDue.length, 0)}
            tone="warn"
          />
          <Watch
            label="Assets not checked in the last 12 months"
            n={data.assets.notChecked}
            tone="warn"
          />
          <Watch
            label="Disposals waiting for approval"
            n={data.assets.disposalPending.length}
            tone="warn"
          />
        </div>
      </section>
    </>
  );
}

function Watch({ label, n, tone }: { label: string; n: number; tone: Tone }) {
  return (
    <div className="list-item">
      <span>{label}</span>
      <Chip tone={n ? tone : "ok"}>{n}</Chip>
    </div>
  );
}

function Units({ data }: { data: AmBoard }) {
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const rows = data.units.filter(
    (u) =>
      (!type || u.type === type) &&
      (!status || u.status === status) &&
      (!q ||
        `${u.code} ${u.name} ${u.tenant ?? ""} ${u.town}`
          .toLowerCase()
          .includes(q.toLowerCase())),
  );
  return (
    <section className="panel">
      <div
        className="row"
        style={{ gap: 6, flexWrap: "wrap", marginBottom: 8 }}
      >
        <select
          className="select"
          aria-label="Type"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">All types</option>
          {data.byType.map((t) => (
            <option key={t.type} value={t.type}>
              {TYPE[t.type]}
            </option>
          ))}
        </select>
        <select
          className="select"
          aria-label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Any status</option>
          {Object.entries(STATUS).map(([k, [, label]]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <input
          className="input"
          aria-label="Search"
          placeholder="Unit, tenant or town"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <RecordButton kind="amUnit" label="Add unit" primary />
      </div>
      <div className="muted small" style={{ marginBottom: 6 }}>
        {rows.length} units
      </div>
      <div className="list">
        {rows.slice(0, 100).map((u) => (
          <div
            key={u.id}
            className="list-item"
            style={{ flexWrap: "wrap", gap: 6 }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>
                {u.code} · {u.name}
              </div>
              <div className="muted small">
                {u.tenant
                  ? `${u.tenant}${u.internal ? " (group)" : ""} · until ${dateLabel(u.endOn)}`
                  : u.vacantDays != null
                    ? `vacant ${u.vacantDays} days`
                    : "—"}{" "}
                · {rm(u.rent)} a month
                {u.owed ? ` · owes ${rm(u.owed)}` : ""}
              </div>
            </div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <Chip tone={STATUS[u.status][0]}>{STATUS[u.status][1]}</Chip>
              <RecordButton kind="amUnit" id={u.id} label="Edit unit" />
              <RecordButton
                kind="amTenancy"
                id={u.id}
                label={u.tenant ? "Tenant and agreement" : "Let this unit"}
              />
            </div>
          </div>
        ))}
        {rows.length > 100 && (
          <div className="muted small">
            Showing the first 100. Narrow the search to see others.
          </div>
        )}
      </div>
    </section>
  );
}

type UnitRow = AmBoard["units"][number];
const rm2 = (n: number) =>
  `RM${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const METHOD = {
  CASH: "Cash",
  TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
  ONLINE: "Online (FPX, DuitNow)",
} as const;
const FOLLOW = {
  CALL: "Phone call",
  MESSAGE: "WhatsApp or SMS",
  EMAIL: "Email",
  VISIT: "Visit",
  PROMISE: "Promise to pay",
  LETTER: "Reminder letter (Asset Director approves)",
  NOTICE: "Notice of demand (Asset Director approves)",
  NOTE: "Note",
} as const;
const todayMy = () =>
  new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

/** Unpaid units whose 10-day update is late: the Asset Director is alerted (Fauzan, 27 Oct 2026). */
function LateUpdates({ data }: { data: AmBoard }) {
  const [all, setAll] = useState(false);
  const rows = all ? data.lateUpdates : data.lateUpdates.slice(0, 5);
  return (
    <section className="panel" aria-label="Late rent updates">
      <div className="panel-head">
        <h3>Rent updates late: {data.lateUpdates.length}</h3>
        <span className="muted small">
          Unpaid units the rental team has not updated in 10 days. Shown to you
          as Asset Director.
        </span>
      </div>
      <div className="list">
        {rows.map((u) => (
          <div
            key={u.id}
            className="list-item"
            style={{ flexWrap: "wrap", gap: 6 }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{u.tenant}</div>
              <div className="muted small">
                {u.code} · owes {rm2(u.due)} · last update{" "}
                {u.update!.lastOn ? dateLabel(u.update!.lastOn) : "none"}
              </div>
            </div>
            <Chip tone="crit">
              {u.update!.daysLate
                ? `${u.update!.daysLate} days late`
                : "Due today"}
            </Chip>
          </div>
        ))}
      </div>
      {data.lateUpdates.length > 5 && (
        <button className="btn btn-sm" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${data.lateUpdates.length}`}
        </button>
      )}
    </section>
  );
}

type PayState = "paid" | "part" | "unpaid";
const PAY_STATE: Record<PayState, [Tone, string]> = {
  paid: ["ok", "Paid"],
  part: ["warn", "Part paid"],
  unpaid: ["crit", "Not paid"],
};
const monthLabel = (p: string) =>
  new Date(`${p}-01T00:00:00Z`).toLocaleDateString("en-MY", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

/**
 * Every let unit for one month, paid or not (Fauzan, 27 Oct 2026). Paid comes only from a recorded payment, never from a
 * tick: the button records the payment, which is set against the oldest unpaid month first.
 */
function MonthlyRent({ data }: { data: AmBoard }) {
  const periods = [
    ...new Set(data.units.flatMap((u) => u.months.map((m) => m.period))),
  ]
    .sort()
    .reverse();
  const [period, setPeriod] = useState(periods[0] ?? "");
  const [show, setShow] = useState<"all" | PayState | "due">("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const rows = data.units
    .map((u) => {
      const m = u.months.find((x) => x.period === period);
      if (!m) return null;
      const state: PayState =
        m.paid >= m.amount ? "paid" : m.paid > 0 ? "part" : "unpaid";
      return { u, m, state };
    })
    .filter((r): r is NonNullable<typeof r> => !!r);
  const count = (st: PayState) => rows.filter((r) => r.state === st).length;
  const shown = rows
    .filter(
      (r) =>
        show === "all" ||
        (show === "due" ? !!r.u.update?.due : r.state === show),
    )
    .filter(
      (r) =>
        !q.trim() ||
        `${r.u.code} ${r.u.tenant ?? ""} ${r.u.name}`
          .toLowerCase()
          .includes(q.trim().toLowerCase()),
    )
    .sort(
      (a, b) =>
        ["unpaid", "part", "paid"].indexOf(a.state) -
          ["unpaid", "part", "paid"].indexOf(b.state) ||
        a.u.code.localeCompare(b.u.code),
    );
  const billed = rows.reduce((n, r) => n + r.m.amount, 0);
  const paid = rows.reduce((n, r) => n + Math.min(r.m.paid, r.m.amount), 0);
  return (
    <>
      <div className="kpis">
        <Kpi label="Paid" value={count("paid")} tone="ok" />
        <Kpi
          label="Part paid"
          value={count("part")}
          tone={count("part") ? "warn" : "ok"}
        />
        <Kpi
          label="Not paid"
          value={count("unpaid")}
          tone={count("unpaid") ? "crit" : "ok"}
        />
        <Kpi
          label="Update due (every 10 days)"
          value={data.kpis.updatesDue}
          tone={data.kpis.updatesDue ? "crit" : "ok"}
          note="Unpaid units not updated in 10 days, all months"
        />
        <Kpi
          label="Collected"
          value={rm(paid)}
          note={`of ${rm(billed)} billed`}
          tone={paid >= billed ? "ok" : "warn"}
        />
      </div>
      <section className="panel">
        <div
          className="row"
          style={{ gap: 6, flexWrap: "wrap", marginBottom: 8 }}
        >
          <select
            className="select"
            aria-label="Month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            {periods.map((p) => (
              <option key={p} value={p}>
                {monthLabel(p)}
              </option>
            ))}
          </select>
          <div className="seg" role="group" aria-label="Show">
            {(
              [
                ["all", "All"],
                ["unpaid", "Not paid"],
                ["part", "Part paid"],
                ["paid", "Paid"],
                ["due", "Update due"],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                aria-pressed={show === k}
                onClick={() => setShow(k)}
              >
                {l}
              </button>
            ))}
          </div>
          <input
            className="input"
            aria-label="Find a tenant or unit"
            placeholder="Tenant or unit code"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <p className="muted small" style={{ marginTop: 0 }}>
          A unit shows as paid only when its payment is recorded. A payment pays
          the oldest unpaid month first. Until a unit is paid, the rental team
          updates it at least every 10 days: call, WhatsApp, email or visit,
          then record what happened.
        </p>
        <div className="list">
          {shown.length === 0 && <div className="empty">No unit matches.</div>}
          {shown.slice(0, 150).map(({ u, m, state }) => (
            <div
              key={u.id}
              className="list-item"
              style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}
            >
              <div
                className="row"
                style={{
                  justifyContent: "space-between",
                  flexWrap: "nowrap",
                  alignItems: "flex-start",
                  gap: 6,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{u.tenant}</div>
                  <div className="muted small">
                    {u.code} · {u.name} · {rm2(m.amount)}
                    {state === "part"
                      ? ` · paid ${rm2(m.paid)}, ${rm2(m.amount - m.paid)} left`
                      : ""}
                    {state === "paid" && m.paidOn
                      ? ` · paid ${dateLabel(m.paidOn)}`
                      : ""}
                    {u.owed > 0 && state === "paid"
                      ? ` · still owes ${rm2(u.owed)} from earlier`
                      : ""}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 4,
                  }}
                >
                  <Chip tone={PAY_STATE[state][0]}>{PAY_STATE[state][1]}</Chip>
                  <UpdateChip u={u} />
                </div>
              </div>
              {u.due > 0 &&
                (open === u.id ? (
                  <FollowUpPanel u={u} canRecord={data.can.record} />
                ) : (
                  <div>
                    <button
                      className="btn btn-sm"
                      onClick={() => setOpen(u.id)}
                    >
                      Contact or record payment
                    </button>
                  </div>
                ))}
            </div>
          ))}
          {shown.length > 150 && (
            <div className="muted small">
              Showing 150 of {shown.length}. Search or filter to narrow.
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function Rent({ data }: { data: AmBoard }) {
  const [find, setFind] = useState("");
  const [unitId, setUnitId] = useState("");
  const matches = find.trim()
    ? data.units
        .filter(
          (u) =>
            u.tenant &&
            `${u.code} ${u.tenant} ${u.name}`
              .toLowerCase()
              .includes(find.trim().toLowerCase()),
        )
        .slice(0, 20)
    : [];
  const chosen = data.units.find((u) => u.id === unitId) ?? null;
  return (
    <>
      <div className="kpis">
        <Kpi
          label="Cash not yet banked"
          value={data.kpis.cashToBank}
          tone={
            data.cashToBank.some((c) => c.late)
              ? "crit"
              : data.kpis.cashToBank
                ? "warn"
                : "ok"
          }
        />
        <Kpi
          label="Promises to pay broken"
          value={data.kpis.brokenPromises}
          tone={data.kpis.brokenPromises ? "crit" : "ok"}
        />
        <Kpi
          label="Letters waiting for the Asset Director"
          value={data.lettersToApprove.length}
          tone={data.lettersToApprove.length ? "warn" : "ok"}
        />
      </div>
      {data.can.record && (
        <section className="panel">
          <div className="panel-head">
            <h3>Record a payment</h3>
          </div>
          <p className="muted small">
            Any rent received: cash, transfer, cheque or online. It pays the
            oldest unpaid month first. Cash needs the official receipt number
            and Finance confirms it is banked within {data.rule.cashBankDays}{" "}
            days.
          </p>
          <div style={{ display: "grid", gap: 6 }}>
            <input
              className="input"
              aria-label="Find a tenant or unit"
              placeholder="Find a tenant or unit code"
              value={find}
              onChange={(e) => {
                setFind(e.target.value);
                setUnitId("");
              }}
            />
            {!chosen && matches.length > 0 && (
              <div className="list">
                {matches.map((u) => (
                  <button
                    key={u.id}
                    className="list-item list-button"
                    onClick={() => setUnitId(u.id)}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{u.tenant}</div>
                      <div className="muted small">
                        {u.code} · {u.name} · {rm2(u.rent)} a month
                      </div>
                    </div>
                    <Chip tone={u.due ? "warn" : "ok"}>
                      {u.due ? `Due ${rm2(u.due)}` : "Nothing due"}
                    </Chip>
                  </button>
                ))}
              </div>
            )}
            {chosen && (
              <>
                <div className="small">
                  <strong>{chosen.tenant}</strong> · {chosen.code} · due{" "}
                  {rm2(chosen.due)}
                </div>
                <PaymentForm
                  u={chosen}
                  onDone={() => (setUnitId(""), setFind(""))}
                />
              </>
            )}
          </div>
        </section>
      )}
      {(data.cashToBank.length > 0 || data.can.bank) && (
        <section className="panel">
          <div className="panel-head">
            <h3>Payments to confirm in the bank</h3>
          </div>
          <div className="list">
            {!data.cashToBank.length && (
              <div className="empty">
                Every payment is confirmed in the bank.
              </div>
            )}
            {data.cashToBank.map((c) => (
              <CashLine key={c.id} c={c} canBank={data.can.bank} />
            ))}
          </div>
        </section>
      )}
      {data.reversalsToApprove.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>Reversals waiting for the Asset Director</h3>
          </div>
          <div className="list">
            {data.reversalsToApprove.map((p) => (
              <ReversalLine
                key={p.id}
                p={p}
                canDecide={data.can.approveReversals}
              />
            ))}
          </div>
        </section>
      )}
      {data.lettersToApprove.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>Letters waiting for the Asset Director</h3>
          </div>
          <div className="list">
            {data.lettersToApprove.map((l) => (
              <LetterLine
                key={l.id}
                l={l}
                canDecide={data.can.approveLetters}
              />
            ))}
          </div>
        </section>
      )}
      <section className="panel">
        <div className="panel-head">
          <h3>Arrears</h3>
          <span className="muted small">
            Open a tenant to record a payment or a follow-up. Letters and any
            legal step need the Asset Director; nothing goes to lawyers
            automatically.
          </span>
        </div>
        <div className="list">
          {data.arrears.length === 0 && (
            <div className="empty">No arrears.</div>
          )}
          {data.arrears.map((a) => (
            <ArrearsLine key={a.id} a={a} canRecord={data.can.record} />
          ))}
        </div>
      </section>
      {data.recentPayments.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>Payments recorded</h3>
          </div>
          <div className="list">
            {data.recentPayments.map((p) => (
              <PaymentLine key={p.id} p={p} canReverse={data.can.record} />
            ))}
          </div>
        </section>
      )}
      <section className="panel">
        <div className="panel-head">
          <h3>Group office and state branches</h3>
          <span className="muted small">
            They rent from Asset Management and pay like any tenant, from their
            own company's account.
          </span>
        </div>
        <div className="list">
          {data.internal.map((u) => (
            <div
              key={u.id}
              className="list-item"
              style={{ flexWrap: "wrap", gap: 6 }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{u.tenant}</div>
                <div className="muted small">
                  {u.code} · {u.name} · {rm(u.rent)} a month
                </div>
              </div>
              <Chip tone={u.owed ? "warn" : "ok"}>
                {u.owed ? `Owes ${rm(u.owed)}` : "Paid up"}
              </Chip>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Agreements ending soon</h3>
        </div>
        <div className="list">
          {data.expiring.slice(0, 40).map((e) => (
            <div
              key={e.unitId}
              className="list-item"
              style={{ flexWrap: "wrap", gap: 6 }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{e.tenant}</div>
                <div className="muted small">
                  {e.code} · ends {dateLabel(e.endOn)}
                </div>
              </div>
              <Chip tone={e.days <= 30 ? "crit" : "warn"}>{e.days} days</Chip>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Insurance, assessment and quit rent</h3>
        </div>
        <div className="list">
          {data.dues.slice(0, 40).map((d) => (
            <div
              key={`${d.unitId}-${d.what}`}
              className="list-item"
              style={{ flexWrap: "wrap", gap: 6 }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{d.what}</div>
                <div className="muted small">
                  {d.code} · {d.name} · {dateLabel(d.on)}
                </div>
              </div>
              <Chip tone={d.days < 0 ? "crit" : "warn"}>
                {d.days < 0 ? `${-d.days} days overdue` : `${d.days} days`}
              </Chip>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function Maintenance({ data }: { data: AmBoard }) {
  const tone = (w: AmBoard["workOrders"][number]): [Tone, string] =>
    w.status === "done"
      ? ["ok", "Done"]
      : w.overdue
        ? ["crit", "Overdue"]
        : w.status === "in_progress"
          ? ["warn", "In progress"]
          : ["neutral", "Open"];
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Work orders</h3>
        <span className="muted small">
          Each closes with photos before and after, the cost and the contractor.
        </span>
        <RecordButton kind="amWorkOrder" label="Add work order" />
      </div>
      <div className="list">
        {data.workOrders.map((w) => (
          <div
            key={w.id}
            className="list-item"
            style={{ flexWrap: "wrap", gap: 6 }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{w.title}</div>
              <div className="muted small">
                {w.place} ·{" "}
                {w.source === "tenant" ? "tenant complaint" : w.source} · due{" "}
                {dateLabel(w.dueOn)}
                {w.contractor ? ` · ${w.contractor}` : ""}
                {w.cost != null ? ` · ${rm(w.cost)}` : ""}
              </div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <Chip tone={tone(w)[0]}>{tone(w)[1]}</Chip>
              <RecordButton kind="amWorkOrder" id={w.id} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Assets({ data }: { data: AmBoard }) {
  const [q, setQ] = useState("");
  const rows = data.assets.list.filter(
    (a) =>
      !q ||
      `${a.tag} ${a.description} ${a.location}`
        .toLowerCase()
        .includes(q.toLowerCase()),
  );
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h3>Register</h3>
          <span className="muted small">
            {data.assets.count} in use · {rm(data.assets.cost)} at cost ·{" "}
            {data.assets.poor} in poor condition
          </span>
          <RecordButton kind="amAsset" label="Add asset" />
        </div>
        <div className="list">
          {data.assets.byCategory.map((c) => (
            <div key={c.category} className="list-item">
              <span>{CATEGORY[c.category]}</span>
              <span className="muted small">
                {c.count} · {rm(c.cost)}
              </span>
            </div>
          ))}
        </div>
        <p className="muted small">
          Computers and other electronic items are not on this register until
          the group decides who owns them. Buying and disposal are decided by
          Asset Management, with approval as in the group approval structure.
        </p>
      </section>
      {data.assets.disposalPending.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>Disposals waiting for approval</h3>
          </div>
          <div className="list">
            {data.assets.disposalPending.map((a) => (
              <div key={a.id} className="list-item">
                <span>
                  {a.tag} · {a.description} · {a.location}
                </span>
                <Chip tone="warn">Waiting</Chip>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="panel">
        <input
          className="input"
          aria-label="Search assets"
          placeholder="Tag, item or place"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="list" style={{ marginTop: 8 }}>
          {rows.slice(0, 60).map((a) => (
            <div
              key={a.id}
              className="list-item"
              style={{ flexWrap: "wrap", gap: 6 }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>
                  {a.tag} · {a.description}
                </div>
                <div className="muted small">
                  {a.location} · {rm(a.cost)} · bought {dateLabel(a.boughtOn)} ·
                  checked{" "}
                  {a.lastCheckedOn ? dateLabel(a.lastCheckedOn) : "never"}
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <Chip
                  tone={
                    a.status === "disposed"
                      ? "neutral"
                      : a.condition === "poor"
                        ? "warn"
                        : "ok"
                  }
                >
                  {a.status === "disposed"
                    ? "Disposed"
                    : a.status === "disposal_pending"
                      ? "Disposal pending"
                      : a.condition}
                </Chip>
                {a.status !== "disposed" && (
                  <RecordButton kind="amAsset" id={a.id} />
                )}
              </div>
            </div>
          ))}
          {rows.length > 60 && (
            <div className="muted small">
              Showing 60 of {rows.length}. Search to narrow.
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function Properties({ data }: { data: AmBoard }) {
  return (
    <>
      {data.properties.map((p) => (
        <section key={p.id} className="panel">
          <div className="panel-head">
            <div style={{ minWidth: 0 }}>
              <h3>{p.name}</h3>
              <div className="muted small">
                {KIND[p.kind]} · {p.town}, {p.state} · {p.detail}
              </div>
            </div>
          </div>
          <div className="list">
            <div className="list-item">
              <span>Last 6 months</span>
              <span className="muted small">
                income {rm(p.income6)} · cost {rm(p.cost6)} ·{" "}
                {p.income6 >= p.cost6 ? "surplus" : "deficit"}{" "}
                {rm(Math.abs(p.income6 - p.cost6))}
              </span>
            </div>
            {p.last && (
              <div className="list-item">
                <span>{p.last.period}</span>
                <span className="muted small">
                  {p.last.occupancyPct != null
                    ? `${p.last.occupancyPct}% occupied · `
                    : ""}
                  {p.last.harvestKg != null
                    ? `${p.last.harvestKg.toLocaleString()} kg harvested · `
                    : ""}
                  {p.last.bookings != null
                    ? `${p.last.bookings} bookings · `
                    : ""}
                  income {rm(p.last.income)}
                </span>
              </div>
            )}
            {p.licences.map((l) => {
              const due = p.licencesDue.find((d) => d.name === l.name);
              return (
                <div key={l.name} className="list-item">
                  <span>{l.name}</span>
                  <Chip tone={due ? (due.days <= 30 ? "crit" : "warn") : "ok"}>
                    {due
                      ? `${due.days} days left`
                      : `to ${dateLabel(l.expiresOn)}`}
                  </Chip>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

function PaymentForm({ u, onDone }: { u: UnitRow; onDone?: () => void }) {
  const act = useAction();
  const [f, setF] = useState({
    amount: u.due ? String(u.due) : "",
    method: "CASH" as keyof typeof METHOD,
    on: todayMy(),
    ref: "",
  });
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <input
          className="input"
          aria-label="Amount received"
          placeholder="Amount (RM)"
          inputMode="decimal"
          value={f.amount}
          onChange={(e) => setF({ ...f, amount: e.target.value })}
        />
        <select
          className="input"
          aria-label="How it was paid"
          value={f.method}
          onChange={(e) =>
            setF({ ...f, method: e.target.value as keyof typeof METHOD })
          }
        >
          {Object.entries(METHOD).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input
          className="input"
          type="date"
          aria-label="Date received"
          value={f.on}
          onChange={(e) => setF({ ...f, on: e.target.value })}
        />
      </div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {f.method !== "CASH" && (
          <input
            className="input"
            aria-label="Bank reference or cheque number"
            placeholder="Bank ref or cheque no."
            value={f.ref}
            onChange={(e) => setF({ ...f, ref: e.target.value })}
          />
        )}
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy || !f.amount}
          onClick={() =>
            act
              .run(
                () =>
                  api.amRecordPayment(u.id, { ...f, amount: Number(f.amount) }),
                f.method === "CASH"
                  ? "Recorded. The receipt number is on the payment list; Finance banks the cash next."
                  : "Recorded. The receipt number is on the payment list; Finance confirms it in the bank.",
              )
              .then((x) => {
                if (x) onDone?.();
              })
          }
        >
          Record payment
        </button>
      </div>
      <span className="muted small">
        The app numbers the official receipt; give it to the tenant. Finance
        confirms every payment against the bank.
      </span>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function FollowUpForm({
  u,
  action = "CALL",
}: {
  u: UnitRow;
  action?: keyof typeof FOLLOW;
}) {
  const act = useAction();
  const [f, setF] = useState({ action, note: "", promiseOn: "" });
  useEffect(() => {
    setF((x) => ({ ...x, action }));
  }, [action]);
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <select
          className="input"
          aria-label="What was done"
          value={f.action}
          onChange={(e) =>
            setF({ ...f, action: e.target.value as keyof typeof FOLLOW })
          }
        >
          {Object.entries(FOLLOW).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        {f.action === "PROMISE" && (
          <input
            className="input"
            type="date"
            aria-label="Promised to pay on"
            value={f.promiseOn}
            onChange={(e) => setF({ ...f, promiseOn: e.target.value })}
          />
        )}
      </div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <input
          className="input"
          aria-label="What happened"
          placeholder="What happened"
          value={f.note}
          onChange={(e) => setF({ ...f, note: e.target.value })}
        />
        <button
          className="btn btn-sm"
          disabled={
            act.busy ||
            !f.note.trim() ||
            (f.action === "PROMISE" && !f.promiseOn)
          }
          onClick={() =>
            act
              .run(
                () =>
                  api.amFollowUp(u.id, {
                    action: f.action,
                    note: f.note,
                    promiseOn: f.action === "PROMISE" ? f.promiseOn : null,
                  }),
                f.action === "LETTER" || f.action === "NOTICE"
                  ? "Sent to the Asset Director to approve."
                  : "Follow-up recorded.",
              )
              .then((x) => {
                if (x) setF({ action: "CALL", note: "", promiseOn: "" });
              })
          }
        >
          Record follow-up
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

/** Malaysian mobile 012-345 6789 as WhatsApp wants it: 60123456789. */
const waNumber = (phone: string) => {
  const d = phone.replace(/\D/g, "");
  return d.startsWith("0") ? `6${d}` : d;
};

/**
 * Call, WhatsApp and Email the tenant from the phone (Fauzan, 27 Oct 2026). The app opens the phone's own dialler, WhatsApp
 * or mail app with a reminder already written; nothing is sent by Prima itself. Each button also opens the follow-up note,
 * so the update is recorded.
 */
function ContactBar({
  u,
  onContact,
}: {
  u: UnitRow;
  onContact: (a: keyof typeof FOLLOW) => void;
}) {
  // Malay first, English below (Fauzan, 27 Oct 2026).
  const text = [
    `Salam sejahtera ${u.tenant}, ini Pengurusan Aset, Kumpulan PWVSB. Sewa bagi ${u.code} ${u.name} sebanyak ${rm2(u.due)} masih belum dijelaskan. Sila buat bayaran dan hantar resit kepada kami. Terima kasih.`,
    `Hello ${u.tenant}, this is Asset Management, PWVSB Group. Rent for ${u.code} ${u.name} of ${rm2(u.due)} is still unpaid. Please pay and send us the receipt. Thank you.`,
  ].join("\n\n");
  if (!u.tenantPhone && !u.tenantEmail)
    return (
      <div className="muted small">
        No phone or email on file. Add them under Units, Tenant and agreement.
      </div>
    );
  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      {u.tenantPhone && (
        <>
          <a
            className="btn btn-sm"
            href={`tel:${u.tenantPhone.replace(/[^0-9+]/g, "")}`}
            onClick={() => onContact("CALL")}
          >
            Call
          </a>
          <a
            className="btn btn-sm"
            href={`https://wa.me/${waNumber(u.tenantPhone)}?text=${encodeURIComponent(text)}`}
            target="_blank"
            rel="noreferrer"
            onClick={() => onContact("MESSAGE")}
          >
            WhatsApp
          </a>
        </>
      )}
      {u.tenantEmail && (
        <a
          className="btn btn-sm"
          href={`mailto:${u.tenantEmail}?subject=${encodeURIComponent(`Sewa / Rent ${u.code}`)}&body=${encodeURIComponent(text)}`}
          onClick={() => onContact("EMAIL")}
        >
          Email
        </a>
      )}
    </div>
  );
}

/** Where an unpaid unit stands on the every-10-days update (rule AM-WATCH). */
function UpdateChip({ u }: { u: UnitRow }) {
  if (!u.update) return null;
  return u.update.due ? (
    <Chip tone="crit">
      {u.update.daysLate
        ? `Update ${u.update.daysLate} days late`
        : "Update due today"}
    </Chip>
  ) : (
    <Chip tone="neutral">Next update {dateLabel(u.update.nextOn)}</Chip>
  );
}

/** Contact the tenant, then record what happened or the payment. */
function FollowUpPanel({ u, canRecord }: { u: UnitRow; canRecord: boolean }) {
  const [action, setAction] = useState<keyof typeof FOLLOW>("CALL");
  if (!canRecord)
    return (
      <div className="muted small">
        The rental team contacts tenants and records payments.
      </div>
    );
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div className="muted small">
        Last update {u.update?.lastOn ? dateLabel(u.update.lastOn) : "none yet"}
        . Update at least every 10 days until paid.
      </div>
      <ContactBar u={u} onContact={setAction} />
      <div className="label">What happened</div>
      <FollowUpForm u={u} action={action} />
      <div className="label">Payment received</div>
      <PaymentForm u={u} />
    </div>
  );
}

function ArrearsLine({ a, canRecord }: { a: UnitRow; canRecord: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="list-item"
      style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}
    >
      <button
        className="row"
        style={{
          justifyContent: "space-between",
          gap: 6,
          flexWrap: "wrap",
          background: "none",
          border: 0,
          padding: 0,
          textAlign: "left",
          color: "inherit",
          cursor: "pointer",
        }}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {a.tenant}
            {a.internal ? " (group)" : ""}
          </div>
          <div className="muted small">
            {a.code} · {a.name} · unpaid since {a.owedSince}
            {a.followUps.length
              ? ` · last: ${FOLLOW[a.followUps.at(-1)!.action].split(" (")[0].toLowerCase()} ${dateLabel(a.followUps.at(-1)!.on)}`
              : " · no follow-up yet"}
          </div>
          {a.promise && (
            <div className="small">
              Promised to pay by {dateLabel(a.promise.on)}
              {a.promise.broken ? ": not kept" : ""}
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className="mono">{rm(a.owed)}</span>
          <UpdateChip u={a} />
          <Chip
            tone={
              a.promise?.broken || a.arrearsBucket >= 90
                ? "crit"
                : a.arrearsBucket >= 30
                  ? "warn"
                  : "neutral"
            }
          >
            {a.arrearsBucket ? `${a.arrearsBucket}+ days` : "Under 30 days"}
          </Chip>
        </div>
      </button>
      {open && (
        <>
          {a.followUps.length > 0 && (
            <div className="small" style={{ display: "grid", gap: 2 }}>
              {a.followUps.map((f) => (
                <div key={f.id}>
                  {dateLabel(f.on)} · {FOLLOW[f.action].split(" (")[0]} ·{" "}
                  {f.note} ({f.by})
                  {f.action === "LETTER" || f.action === "NOTICE"
                    ? f.approval
                      ? f.approval.approve
                        ? `, approved by ${f.approval.by}`
                        : `, stopped by ${f.approval.by}: ${f.approval.note}`
                      : ", waiting for the Asset Director"
                    : ""}
                </div>
              ))}
            </div>
          )}
          <FollowUpPanel u={a} canRecord={canRecord} />
        </>
      )}
    </div>
  );
}

function CashLine({
  c,
  canBank,
}: {
  c: AmBoard["cashToBank"][number];
  canBank: boolean;
}) {
  const act = useAction();
  const [slip, setSlip] = useState("");
  const [on, setOn] = useState(todayMy());
  return (
    <div
      className="list-item"
      style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}
    >
      <div
        className="row"
        style={{ justifyContent: "space-between", gap: 6, flexWrap: "wrap" }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {c.tenant}: {rm2(c.amount)}
          </div>
          <div className="muted small">
            {c.code} · receipt {c.receiptNo} · {METHOD[c.method].toLowerCase()}{" "}
            · received {dateLabel(c.on)} by {c.by}
          </div>
        </div>
        <Chip tone={c.late ? "crit" : "warn"}>
          {c.late
            ? "Late"
            : c.method === "CASH"
              ? "To bank in"
              : "To match in the bank"}
        </Chip>
      </div>
      {canBank && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <input
            className="input"
            type="date"
            aria-label="Banked on"
            value={on}
            onChange={(e) => setOn(e.target.value)}
          />
          <input
            className="input"
            aria-label="Bank-in slip number"
            placeholder={
              c.method === "CASH" ? "Bank-in slip no." : "Bank statement ref"
            }
            value={slip}
            onChange={(e) => setSlip(e.target.value)}
          />
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy || !slip.trim()}
            onClick={() =>
              act.run(
                () => api.amBankCash(c.unitId, c.id, { on, slipRef: slip }),
                "Confirmed in the bank.",
              )
            }
          >
            {c.method === "CASH" ? "Banked" : "Seen in the bank"}
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function LetterLine({
  l,
  canDecide,
}: {
  l: AmBoard["lettersToApprove"][number];
  canDecide: boolean;
}) {
  const act = useAction();
  const [note, setNote] = useState("");
  return (
    <div
      className="list-item"
      style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>
          {l.tenant}: {FOLLOW[l.action].split(" (")[0]}
        </div>
        <div className="muted small">
          {l.code} · owes {rm(l.owed)} · asked {dateLabel(l.on)} by {l.by} ·{" "}
          {l.note}
        </div>
      </div>
      {canDecide ? (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <input
            className="input"
            aria-label="Note"
            placeholder="Note (required to stop)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() =>
              act.run(
                () => api.amDecideLetter(l.unitId, l.id, true, note),
                "Approved; it can be sent.",
              )
            }
          >
            Approve
          </button>
          <button
            className="btn btn-sm"
            disabled={act.busy || !note.trim()}
            onClick={() =>
              act.run(
                () => api.amDecideLetter(l.unitId, l.id, false, note),
                "Stopped.",
              )
            }
          >
            Stop
          </button>
        </div>
      ) : (
        <div className="muted small">
          The Asset Director approves it before it is sent.
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function ReversalLine({
  p,
  canDecide,
}: {
  p: AmBoard["reversalsToApprove"][number];
  canDecide: boolean;
}) {
  const act = useAction();
  const [note, setNote] = useState("");
  return (
    <div
      className="list-item"
      style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}
    >
      <div style={{ fontWeight: 600 }}>
        {p.tenant}: {rm2(p.amount)} {METHOD[p.method].toLowerCase()}, receipt{" "}
        {p.receiptNo}
      </div>
      <div className="muted small">
        {p.code} · recorded {dateLabel(p.on)} by {p.by} · reversal asked by{" "}
        {p.reversal!.by}: {p.reversal!.reason}
      </div>
      {canDecide ? (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <input
            className="input"
            aria-label="Note"
            placeholder="Note (required to refuse)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() =>
              act.run(
                () => api.amDecideReversal(p.unitId, p.id, true, note),
                "Reversed. Record the right payment again.",
              )
            }
          >
            Approve reversal
          </button>
          <button
            className="btn btn-sm"
            disabled={act.busy || !note.trim()}
            onClick={() =>
              act.run(
                () => api.amDecideReversal(p.unitId, p.id, false, note),
                "Refused. The payment stands.",
              )
            }
          >
            Refuse
          </button>
        </div>
      ) : (
        <div className="muted small">
          The Asset Director approves it. The person who recorded the payment
          never reverses it alone.
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function PaymentLine({
  p,
  canReverse,
}: {
  p: AmBoard["recentPayments"][number];
  canReverse: boolean;
}) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <div
      className="list-item"
      style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}
    >
      <div
        className="row"
        style={{ justifyContent: "space-between", gap: 6, flexWrap: "wrap" }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontWeight: 600,
              textDecoration: p.reversed ? "line-through" : undefined,
            }}
          >
            {p.tenant}: {rm2(p.amount)} {METHOD[p.method].toLowerCase()}
          </div>
          <div className="muted small">
            {p.code} · receipt {p.receiptNo}
            {p.ref ? ` · ${p.ref}` : ""} · {dateLabel(p.on)} by {p.by} · for{" "}
            {p.applied.map((x) => x.period).join(", ")}
            {p.banked
              ? ` · banked ${dateLabel(p.banked.on)}, slip ${p.banked.slipRef}`
              : ""}
          </div>
          {p.reversal && !p.reversed && (
            <div className="small">
              Reversal asked by {p.reversal.by}: {p.reversal.reason}. Waiting
              for the Asset Director.
            </div>
          )}
          {p.reversed && (
            <div className="small">
              Reversed by {p.reversed.by}: {p.reversed.reason}
            </div>
          )}
        </div>
        {canReverse && !p.reversed && !p.reversal && !p.banked && (
          <button className="btn btn-sm" onClick={() => setOpen(!open)}>
            Ask to reverse
          </button>
        )}
      </div>
      {open && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <input
            className="input"
            aria-label="Why reverse"
            placeholder="Why (wrong tenant, wrong amount, cheque bounced)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            className="btn btn-sm"
            disabled={act.busy || !reason.trim()}
            onClick={() =>
              act.run(
                () => api.amReversePayment(p.unitId, p.id, reason),
                "Sent to the Asset Director to approve.",
              )
            }
          >
            Ask the Asset Director
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

/**
 * Where the Asset Management system and Prima disagree on rent, status, tenant or paid months (slice 4G). The system's
 * figures sit beside Prima's and never overwrite them; a month the system shows paid is "reported", not money received.
 */
function RentCheck() {
  const { data, error } = useLoad(() => api.amRentCheck(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="the rent check" />;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Asset Management system against Prima</h2>
        <span className="muted small">
          {data.fromSystem} of {data.units} units sent by the system · {data.notFromSystem} not sent yet
        </span>
      </div>
      <div className="list">
        {data.differences.length === 0 && (
          <div className="empty">
            {data.fromSystem ? "No differences." : "The Asset Management system is not connected yet, so there is nothing to compare."}
          </div>
        )}
        {data.differences.map((d, i) => (
          <div key={i} className="list-item">
            <div>
              <div style={{ fontWeight: 600 }}>
                {d.code} · {d.name}
              </div>
              <div className="muted small">
                Prima: {d.prima} · System: {d.system}
              </div>
            </div>
            <Chip tone="warn">{d.issue}</Chip>
          </div>
        ))}
      </div>
    </section>
  );
}

const BUY_STATE: Record<string, { label: string; tone: Tone }> = {
  buy_requested: { label: "Waiting for a decision", tone: "warn" },
  buy_approved: { label: "Approved, to buy", tone: "info" },
  buy_refused: { label: "Refused", tone: "neutral" },
};

/** Furniture and fittings purchases: the team asks with a reason; the FD (up to the limit) or the COO decides with a reason. */
function Purchases({ data }: { data: AmBoard }) {
  const empty = { description: "", category: "FURNITURE" as const, qty: 1, estCost: 0, location: "", ownerEntity: "", reason: "" };
  const [form, setForm] = useState<{ description: string; category: "FURNITURE" | "FITTING" | "RENOVATION" | "OTHER"; qty: number; estCost: number; location: string; ownerEntity: string; reason: string }>(empty);
  const [why, setWhy] = useState<Record<string, string>>({});
  const { run, busy, error } = useAction();
  const ready = form.description.trim() && form.location.trim() && form.ownerEntity.trim() && form.reason.trim().length >= 3 && form.qty > 0 && form.estCost > 0;
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Ask to buy</h2>
          <span className="muted small">The Asset Management team asks. Once bought, the request becomes the asset in the register.</span>
        </div>
        <ErrorNotice error={error} />
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          <input className="input" aria-label="What to buy" placeholder="What to buy" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ flex: 2, minWidth: 180 }} />
          <select className="input" aria-label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as typeof form.category })}>
            <option value="FURNITURE">Furniture</option>
            <option value="FITTING">Fitting</option>
            <option value="RENOVATION">Renovation</option>
            <option value="OTHER">Other</option>
          </select>
          <input className="input" type="number" min={1} aria-label="Quantity" placeholder="Qty" value={form.qty} onChange={(e) => setForm({ ...form, qty: Number(e.target.value) })} style={{ width: 70 }} />
          <input className="input" type="number" min={0} aria-label="Estimated cost (RM)" placeholder="Estimated RM" value={form.estCost || ""} onChange={(e) => setForm({ ...form, estCost: Number(e.target.value) })} style={{ width: 120 }} />
          <input className="input" aria-label="Location" placeholder="Where it goes" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} style={{ flex: 1, minWidth: 140 }} />
          <input className="input" aria-label="Owning entity" placeholder="Owning entity" value={form.ownerEntity} onChange={(e) => setForm({ ...form, ownerEntity: e.target.value })} style={{ flex: 1, minWidth: 140 }} />
          <input className="input" aria-label="Reason" placeholder="Reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} style={{ flex: 2, minWidth: 180 }} />
          <button className="btn btn-sm btn-primary" disabled={busy || !ready} onClick={() => run(() => api.amBuyRequest(form).then(() => setForm(empty)), "Purchase request sent")}>
            Ask
          </button>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Purchase requests</h2>
        </div>
        <div className="list">
          {data.purchases.length === 0 && <div className="empty">No purchase requests.</div>}
          {data.purchases.map((a) => {
            const p = a.purchase!;
            const st = BUY_STATE[a.status] ?? { label: a.status, tone: "neutral" as Tone };
            return (
              <div key={a.id} className="list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {p.qty} × {a.description} · {rm(p.estCost)}
                    </div>
                    <div className="muted small">
                      {a.location} · asked by {p.askedBy} on {dateLabel(p.askedAt.slice(0, 10))}: {p.reason}
                    </div>
                    {p.decidedBy && (
                      <div className="small">
                        {p.decidedBy}: {p.decisionReason}
                      </div>
                    )}
                  </div>
                  <Chip tone={st.tone}>{st.label}</Chip>
                </div>
                {a.status === "buy_approved" && <ReceiveBought id={a.id} approved={p.estCost} busy={busy} run={run} />}
                {a.status === "buy_requested" && (
                  <div className="row" style={{ flexWrap: "wrap" }}>
                    <input className="input" aria-label={`Reason for ${a.description}`} placeholder="Reason" value={why[a.id] ?? ""} onChange={(e) => setWhy({ ...why, [a.id]: e.target.value })} style={{ flex: 1, minWidth: 160 }} />
                    <button className="btn btn-sm btn-primary" disabled={busy || (why[a.id] ?? "").trim().length < 3} onClick={() => run(() => api.amBuyDecide(a.id, true, why[a.id] ?? "", p.estCost), "Purchase approved")}>
                      Approve
                    </button>
                    <button className="btn btn-sm" disabled={busy || (why[a.id] ?? "").trim().length < 3} onClick={() => run(() => api.amBuyDecide(a.id, false, why[a.id] ?? "", p.estCost), "Purchase refused")}>
                      Refuse
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

const WA_STATUS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "Waiting to send", tone: "neutral" },
  sent: { label: "Sent", tone: "info" },
  delivered: { label: "Delivered", tone: "ok" },
  read: { label: "Read", tone: "ok" },
  failed: { label: "Failed", tone: "crit" },
  uncertain: { label: "May or may not have gone", tone: "warn" },
  cancelled: { label: "Cancelled (paid)", tone: "neutral" },
};
const WA_STAGE: Record<string, string> = { before: "3 days before", due: "due day", late: "late" };

/**
 * WhatsApp rent reminders (Fauzan, 2 Nov 2026). Only tenants who agreed are messaged; the team records how they agreed.
 * Until an owner connects WhatsApp Business, reminders are only planned and the panel says so.
 */
function WhatsAppReminders() {
  const { data, error } = useLoad(() => api.amWhatsApp(), []);
  const [how, setHow] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Record<string, string>>({});
  const { run, busy, error: actError } = useAction();
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="WhatsApp reminders" />;
  const c = data.connector;
  const t = data.timings;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>WhatsApp rent reminders</h2>
        <Chip tone={c.sending ? "ok" : "unknown"}>{c.sending ? "Connected, sending" : c.configured ? "Set up, switched off" : "Not connected"}</Chip>
      </div>
      <p className="muted small">
        Sent {t.beforeDays} days before rent is due (day {t.dueDay} of the month; reminder days proposed), on the due day, then {t.firstLateDays} days late and every {t.lateEveryDays} days
        until {t.stopAfterLateDays} days, between {t.sendFromHour} am and {t.sendToHour - 12} pm. Only to tenants who agreed; a tenant who replies STOP is never
        messaged again. Replies show on the unit. Automatic messages do not replace the team's own update every 10 days.
        {!c.sending && " Until WhatsApp Business is connected, reminders are planned here but not sent."}
      </p>
      <ErrorNotice error={actError} />
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span className="small">
          {data.agreed} of {data.tenants} tenants agreed{data.failed ? ` · ${data.failed} failed` : ""}
        </span>
        <button
          className="btn btn-sm"
          disabled={busy}
          onClick={() =>
            run(() => api.amWhatsAppRun(), (r) => (r.sending ? `${r.sent} sent, ${r.queued} queued` : `${r.queued} planned (WhatsApp not connected)`))
          }
        >
          Check reminders now
        </button>
      </div>
      {data.owingWithoutConsent.length > 0 && (
        <>
          <h3 className="small" style={{ marginTop: 12 }}>
            Owing rent, not yet agreed to WhatsApp
          </h3>
          <div className="list">
            {data.owingWithoutConsent.slice(0, 30).map((u) => (
              <div key={u.unitId} className="list-item" style={{ flexWrap: "wrap", gap: 6 }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontWeight: 600 }}>
                    {u.code} · {u.tenant}
                  </div>
                  {!u.hasMobile && <div className="muted small">No Malaysian mobile on file</div>}
                </div>
                {u.hasMobile && (
                  <>
                    <input
                      className="input"
                      aria-label={`How ${u.tenant} agreed`}
                      placeholder="How they agreed, e.g. signed form"
                      value={how[u.unitId] ?? ""}
                      onChange={(e) => setHow({ ...how, [u.unitId]: e.target.value })}
                      style={{ flex: 1, minWidth: 160 }}
                    />
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={busy || (how[u.unitId] ?? "").trim().length < 5}
                      onClick={() => run(() => api.amWhatsAppConsent(u.unitId, true, how[u.unitId] ?? ""), `${u.code}: WhatsApp reminders on`)}
                    >
                      Agreed
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {data.agreedUnits.length > 0 && (
        <>
          <h3 className="small" style={{ marginTop: 12 }}>
            Agreed
          </h3>
          <div className="list">
            {data.agreedUnits.slice(0, 50).map((u) => (
              <div key={u.unitId} className="list-item">
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {u.code} · {u.tenant}
                  </div>
                  <div className="muted small">
                    {u.how} · recorded by {u.by}
                  </div>
                </div>
                <button className="btn btn-sm" disabled={busy} onClick={() => run(() => api.amWhatsAppConsent(u.unitId, false, "Tenant asked to stop"), `${u.code}: WhatsApp reminders stopped`)}>
                  Stop
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {data.recent.length > 0 && (
        <>
          <h3 className="small" style={{ marginTop: 12 }}>
            Recent reminders
          </h3>
          <div className="list">
            {data.recent.slice(0, 20).map((r) => (
              <div key={r.id} className="list-item">
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {r.code} · {r.tenant}
                  </div>
                  <div className="muted small">
                    {r.period}, {WA_STAGE[r.stage]} · {rm(r.amount)}
                    {r.lastError ? ` · ${r.lastError}` : ""}
                  </div>
                </div>
                <Chip tone={(WA_STATUS[r.status] ?? WA_STATUS.queued).tone}>{(WA_STATUS[r.status] ?? WA_STATUS.queued).label}</Chip>
                {r.status === "uncertain" && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", width: "100%" }}>
                    <input
                      className="input"
                      aria-label={`What you checked for ${r.code}`}
                      placeholder="What you checked (WhatsApp Business inbox, tenant)"
                      value={checked[r.id] ?? ""}
                      onChange={(e) => setChecked({ ...checked, [r.id]: e.target.value })}
                    />
                    {(
                      [
                        ["went", "It went"],
                        ["resend", "Send again"],
                        ["drop", "Leave it"],
                      ] as const
                    ).map(([o, label]) => (
                      <button
                        key={o}
                        className="btn btn-sm"
                        disabled={busy || (checked[r.id] ?? "").trim().length < 5}
                        onClick={() => run(() => api.amWhatsAppSettle(r.unitId, r.id, o, checked[r.id] ?? ""), `${r.code}: ${label.toLowerCase()}`)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Bought: record the tag, the actual cost and the date, and the request becomes the asset. The cost cannot be above what
 * was approved; if the price went up, ask again at the new amount and it goes back for approval.
 */
function ReceiveBought({ id, approved, busy, run }: { id: string; approved: number; busy: boolean; run: ReturnType<typeof useAction>["run"] }) {
  const today = new Date().toISOString().slice(0, 10);
  const [tag, setTag] = useState("");
  const [cost, setCost] = useState("");
  const [on, setOn] = useState(today);
  const [why, setWhy] = useState("");
  const n = Number(cost);
  const over = cost !== "" && n > approved;
  return (
    <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
      <input className="input" aria-label="Asset tag" placeholder="Asset tag" value={tag} onChange={(e) => setTag(e.target.value)} style={{ width: 130 }} />
      <input className="input" type="number" min={0} aria-label="Actual cost (RM)" placeholder={`Actual RM (up to ${rm(approved)})`} value={cost} onChange={(e) => setCost(e.target.value)} style={{ width: 170 }} />
      <input className="input" type="date" aria-label="Bought on" value={on} max={today} onChange={(e) => setOn(e.target.value)} />
      {!over && (
        <button className="btn btn-sm btn-primary" disabled={busy || tag.trim().length < 3 || !(n > 0)} onClick={() => run(() => api.amBuyReceived(id, { tag, cost: n, boughtOn: on }), "Received: added to the register")}>
          Received
        </button>
      )}
      {over && (
        <>
          <span className="small">Above the approved {rm(approved)}: it must be approved again.</span>
          <input className="input" aria-label="Why the price changed" placeholder="Why the price changed" value={why} onChange={(e) => setWhy(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
          <button className="btn btn-sm" disabled={busy || why.trim().length < 5} onClick={() => run(() => api.amBuyReprice(id, n, why), "Sent back for approval at the new amount")}>
            Ask again at {rm(n)}
          </button>
        </>
      )}
    </div>
  );
}
