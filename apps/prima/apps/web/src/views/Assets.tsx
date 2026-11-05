import { OpsGuide } from "./OpsGuide";
import { useEffect, useState } from "react";
import {
  BuildingsIcon,
  CoinsIcon,
  WarningIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import { api, type AmBoard } from "../api";
import { FixedAssetsPanel } from "./FixedAssets";
import { RecordButton } from "./RecordForm";
import { Card, Empty, PageHead, Search, Stat, Stats, Toolbar } from "../kit";
import {
  Chip,
  ErrorNotice,
  Loading,
  dateLabel,
  useAction,
  useLoad,
  type Tone,
} from "../ui";
import "../styles/biz.css";

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
/** Row edge colour for a tone: only problems get one. */
const edge = (t: Tone) => (t === "crit" || t === "warn" ? t : undefined);

export function AssetsView() {
  const { data, error } = useLoad(() => api.amBoard(), []);
  const [tab, setTab] = useState<Tab>("overview");
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="Asset Management" />;
  const k = data.kpis;
  return (
    <div className="page bz-am-page">
      <PageHead
        title="Asset Management"
        sub="The group's rental units, office furniture and fittings, resorts, orchards and training facility. Seen only by the Asset Management team, group leadership and the finance staff who oversee it. Test version on made-up data: the Asset Management system will send the real figures."
      />
      <Stats>
        <Stat
          label="Units let"
          value={`${k.let} / ${k.units}`}
          note={`${k.occupancyPct}% occupied · ${k.vacant} vacant`}
          tone={k.occupancyPct >= 85 ? "ok" : "warn"}
          icon={<BuildingsIcon size={16} />}
          onClick={() => setTab("units")}
        />
        <Stat
          label="Rent collected this month"
          value={rm(k.collectedThisMonth)}
          note={`of ${rm(k.billedThisMonth)} billed`}
          tone={k.collectedThisMonth >= k.billedThisMonth * 0.9 ? "ok" : "warn"}
          icon={<CoinsIcon size={16} />}
          onClick={() => setTab("monthly")}
        />
        <Stat
          label="Arrears"
          value={rm(k.arrears)}
          note={`${k.arrears90} tenants 90 days or more`}
          tone={k.arrears90 ? "crit" : k.arrears ? "warn" : "ok"}
          icon={<WarningIcon size={16} />}
          onClick={() => setTab("rent")}
        />
        <Stat
          label="Work orders open"
          value={k.openOrders}
          note={`${k.overdueOrders} overdue`}
          tone={k.overdueOrders ? "crit" : "ok"}
          icon={<WrenchIcon size={16} />}
          onClick={() => setTab("maintenance")}
        />
      </Stats>
      {data.can.approveLetters && data.lateUpdates.length > 0 && (
        <LateUpdates data={data} />
      )}
      <div
        className="tabbar bz-am-tabs"
        role="tablist"
        aria-label="Asset Management sections"
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
      {tab === "overview" && <Overview data={data} />}
      {tab === "units" && <Units data={data} />}
      {tab === "monthly" && <MonthlyRent data={data} />}
      {tab === "rent" && (
        <>
          <Rent data={data} />
          <WhatsAppReminders />
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
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <span className="bz-meter bz-am-bar" data-tone={tone}>
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}

function Overview({ data }: { data: AmBoard }) {
  const max = Math.max(...data.monthly.map((m) => m.billed), 1);
  const watches: { label: string; n: number; tone: Tone }[] = [
    {
      label: "Tenants 90 days or more in arrears",
      n: data.kpis.arrears90,
      tone: "crit",
    },
    {
      label: `Agreements ending within ${data.rule.tenancyWarnDays} days`,
      n: data.expiring.length,
      tone: "warn",
    },
    {
      label: `Insurance, assessment or quit rent due within ${data.rule.dueWarnDays} days or overdue`,
      n: data.dues.length,
      tone: "warn",
    },
    {
      label: `Units vacant over ${data.rule.vacantWarnDays} days`,
      n: data.vacantLong.length,
      tone: "warn",
    },
    {
      label: "Licences due within 60 days (resorts, orchards, training)",
      n: data.properties.reduce((n, p) => n + p.licencesDue.length, 0),
      tone: "warn",
    },
    {
      label: "Assets not checked in the last 12 months",
      n: data.assets.notChecked,
      tone: "warn",
    },
    {
      label: "Disposals waiting for approval",
      n: data.assets.disposalPending.length,
      tone: "warn",
    },
  ];
  // Exceptions first: anything that needs attention comes before what is clear.
  const ordered = [
    ...watches.filter((w) => w.n),
    ...watches.filter((w) => !w.n),
  ];
  return (
    <>
      <Card title="Watch list" sub="What needs attention first">
        <ul className="bz-am-watch">
          {ordered.map((w) => (
            <Watch key={w.label} label={w.label} n={w.n} tone={w.tone} />
          ))}
        </ul>
      </Card>
      <div className="bz-two">
        <Card title="Units by type">
          <ul className="bz-am-bars">
            {data.byType.map((t) => (
              <li key={t.type}>
                <div className="bz-am-bar-head">
                  <span className="bz-am-bar-label">{TYPE[t.type]}</span>
                  <span className="bz-sub">
                    {t.let} of {t.units} let · {t.vacant} vacant ·{" "}
                    <strong className="bz-am-pct">{t.occupancyPct}%</strong>
                  </span>
                </div>
                <Bar value={t.let} max={t.units} tone="ok" />
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Rent billed and collected" sub="Last 6 months">
          <ul className="bz-am-bars">
            {data.monthly.map((m) => (
              <li key={m.period}>
                <div className="bz-am-bar-head">
                  <span className="bz-am-bar-label">{m.period}</span>
                  <span className="bz-sub">
                    {rm(m.collected)} of {rm(m.billed)} (
                    {m.billed ? Math.round((m.collected / m.billed) * 100) : 0}
                    %)
                  </span>
                </div>
                <Bar value={m.collected} max={max} tone="ok" />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

function Watch({ label, n, tone }: { label: string; n: number; tone: Tone }) {
  return (
    <li className="bz-am-watch-item" data-tone={n ? tone : "ok"}>
      <span className="bz-am-watch-n">{n}</span>
      <span className="bz-am-watch-label">{label}</span>
      <Chip tone={n ? tone : "ok"}>{n ? "Needs attention" : "Clear"}</Chip>
    </li>
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
    <>
      <Toolbar end={<RecordButton kind="amUnit" label="Add unit" primary />}>
        <Search
          value={q}
          onChange={setQ}
          placeholder="Unit, tenant or town"
          label="Search"
        />
        <select
          className="select bz-filter"
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
          className="select bz-filter"
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
      </Toolbar>
      <Card title="Units" actions={<span className="bz-count">{rows.length} units</span>} flush>
        {rows.length === 0 && <Empty title="No unit matches." />}
        <ul className="bz-rows">
          {rows.slice(0, 100).map((u) => (
            <li key={u.id}>
              <div className="bz-row bz-am-row" data-tone={edge(STATUS[u.status][0])}>
                <div className="bz-row-main">
                  <span className="bz-row-title">
                    <span className="mono">{u.code}</span> · {u.name}
                  </span>
                  <span className="bz-row-meta">
                    {u.tenant
                      ? `${u.tenant}${u.internal ? " (group)" : ""} · until ${dateLabel(u.endOn)}`
                      : u.vacantDays != null
                        ? `vacant ${u.vacantDays} days`
                        : "—"}
                  </span>
                </div>
                <div className="bz-am-money">
                  <span className="bz-amt">{rm(u.rent)}</span>
                  <span className="bz-sub">a month</span>
                  {u.owed ? (
                    <span className="bz-am-owes">owes {rm(u.owed)}</span>
                  ) : null}
                </div>
                <div className="bz-am-side">
                  <Chip tone={STATUS[u.status][0]}>{STATUS[u.status][1]}</Chip>
                  <div className="bz-actions">
                    <RecordButton kind="amUnit" id={u.id} label="Edit unit" />
                    <RecordButton
                      kind="amTenancy"
                      id={u.id}
                      label={u.tenant ? "Tenant and agreement" : "Let this unit"}
                    />
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {rows.length > 100 && (
          <p className="bz-note bz-am-more">
            Showing the first 100. Narrow the search to see others.
          </p>
        )}
      </Card>
    </>
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
    <section className="k-card bz-am-alert" aria-label="Late rent updates">
      <div className="k-card-head">
        <div className="k-card-title">
          <h2>Rent updates late: {data.lateUpdates.length}</h2>
          <p>
            Unpaid units the rental team has not updated in 10 days. Shown to
            you as Asset Director.
          </p>
        </div>
        {data.lateUpdates.length > 5 && (
          <div className="k-card-actions">
            <button className="btn btn-sm" onClick={() => setAll(!all)}>
              {all ? "Show fewer" : `Show all ${data.lateUpdates.length}`}
            </button>
          </div>
        )}
      </div>
      <ul className="bz-rows">
        {rows.map((u) => (
          <li key={u.id}>
            <div className="bz-row" data-tone="crit">
              <div className="bz-row-main">
                <span className="bz-row-title">{u.tenant}</span>
                <span className="bz-row-meta">
                  <span className="mono">{u.code}</span> · last update{" "}
                  {u.update!.lastOn ? dateLabel(u.update!.lastOn) : "none"}
                </span>
              </div>
              <div className="bz-row-side">
                <span className="bz-amt">owes {rm2(u.due)}</span>
                <Chip tone="crit">
                  {u.update!.daysLate
                    ? `${u.update!.daysLate} days late`
                    : "Due today"}
                </Chip>
              </div>
            </div>
          </li>
        ))}
      </ul>
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
      <Stats>
        <Stat
          label="Collected"
          value={rm(paid)}
          note={`of ${rm(billed)} billed`}
          tone={paid >= billed ? "ok" : "warn"}
        />
        <Stat
          label="Not paid"
          value={count("unpaid")}
          tone={count("unpaid") ? "crit" : "ok"}
          onClick={() => setShow(show === "unpaid" ? "all" : "unpaid")}
        />
        <Stat
          label="Part paid"
          value={count("part")}
          tone={count("part") ? "warn" : "ok"}
          onClick={() => setShow(show === "part" ? "all" : "part")}
        />
        <Stat
          label="Paid"
          value={count("paid")}
          tone="ok"
          onClick={() => setShow(show === "paid" ? "all" : "paid")}
        />
        <Stat
          label="Update due (every 10 days)"
          value={data.kpis.updatesDue}
          tone={data.kpis.updatesDue ? "crit" : "ok"}
          note="Unpaid units not updated in 10 days, all months"
          onClick={() => setShow(show === "due" ? "all" : "due")}
        />
      </Stats>
      <Toolbar
        end={
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
        }
      >
        <Search
          value={q}
          onChange={setQ}
          placeholder="Tenant or unit code"
          label="Find a tenant or unit"
        />
        <select
          className="select bz-filter"
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
      </Toolbar>
      <Card
        title={period ? monthLabel(period) : "Monthly rent"}
        sub="A unit shows as paid only when its payment is recorded. A payment pays the oldest unpaid month first. Until a unit is paid, the rental team updates it at least every 10 days: call, WhatsApp, email or visit, then record what happened."
        actions={<span className="bz-count">{shown.length} units</span>}
        flush
      >
        {shown.length === 0 && <Empty title="No unit matches." />}
        <ul className="bz-rows">
          {shown.slice(0, 150).map(({ u, m, state }) => (
            <li key={u.id}>
              <div className="bz-row bz-am-row" data-tone={edge(PAY_STATE[state][0])}>
                <div className="bz-row-main">
                  <span className="bz-row-title">{u.tenant}</span>
                  <span className="bz-row-meta">
                    <span className="mono">{u.code}</span> · {u.name}
                    {state === "paid" && m.paidOn
                      ? ` · paid ${dateLabel(m.paidOn)}`
                      : ""}
                    {u.owed > 0 && state === "paid"
                      ? ` · still owes ${rm2(u.owed)} from earlier`
                      : ""}
                  </span>
                </div>
                <div className="bz-am-money">
                  <span className="bz-amt">{rm2(m.amount)}</span>
                  {state === "part" && (
                    <span className="bz-sub">
                      paid {rm2(m.paid)}, {rm2(m.amount - m.paid)} left
                    </span>
                  )}
                </div>
                <div className="bz-am-side">
                  <div className="bz-chips bz-am-chips">
                    <Chip tone={PAY_STATE[state][0]}>{PAY_STATE[state][1]}</Chip>
                    <UpdateChip u={u} />
                  </div>
                  {u.due > 0 && open !== u.id && (
                    <button className="btn btn-sm" onClick={() => setOpen(u.id)}>
                      Contact or record payment
                    </button>
                  )}
                </div>
                {u.due > 0 && open === u.id && (
                  <div className="bz-am-expand">
                    <FollowUpPanel u={u} canRecord={data.can.record} />
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
        {shown.length > 150 && (
          <p className="bz-note bz-am-more">
            Showing 150 of {shown.length}. Search or filter to narrow.
          </p>
        )}
      </Card>
    </>
  );
}

/** Arrears by age, from the arrears list itself: how much is owed in each bucket. */
function Aging({ rows }: { rows: UnitRow[] }) {
  const buckets = [...new Set(rows.map((a) => a.arrearsBucket))].sort(
    (a, b) => a - b,
  );
  const total = rows.reduce((n, a) => n + a.owed, 0);
  if (!rows.length) return null;
  return (
    <div className="bz-am-aging" aria-label="Arrears by age">
      {buckets.map((b) => {
        const inB = rows.filter((a) => a.arrearsBucket === b);
        const owed = inB.reduce((n, a) => n + a.owed, 0);
        const tone: Tone = b >= 90 ? "crit" : b >= 30 ? "warn" : "neutral";
        return (
          <div key={b} className="bz-am-age" data-tone={tone}>
            <span className="bz-am-age-label">
              {b ? `${b}+ days` : "Under 30 days"}
            </span>
            <span className="bz-am-age-value">{rm(owed)}</span>
            <span className="bz-sub">
              {inB.length} tenant{inB.length === 1 ? "" : "s"}
            </span>
            <span className="bz-meter" data-tone={tone === "neutral" ? undefined : tone}>
              <span style={{ width: `${total ? (owed / total) * 100 : 0}%` }} />
            </span>
          </div>
        );
      })}
    </div>
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
      <Stats>
        <Stat
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
        <Stat
          label="Promises to pay broken"
          value={data.kpis.brokenPromises}
          tone={data.kpis.brokenPromises ? "crit" : "ok"}
        />
        <Stat
          label="Letters waiting for the Asset Director"
          value={data.lettersToApprove.length}
          tone={data.lettersToApprove.length ? "warn" : "ok"}
        />
      </Stats>
      {data.reversalsToApprove.length > 0 && (
        <Card
          title="Reversals waiting for the Asset Director"
          actions={<span className="bz-count">{data.reversalsToApprove.length}</span>}
          flush
        >
          <ul className="bz-rows">
            {data.reversalsToApprove.map((p) => (
              <li key={p.id}>
                <ReversalLine p={p} canDecide={data.can.approveReversals} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      {data.lettersToApprove.length > 0 && (
        <Card
          title="Letters waiting for the Asset Director"
          actions={<span className="bz-count">{data.lettersToApprove.length}</span>}
          flush
        >
          <ul className="bz-rows">
            {data.lettersToApprove.map((l) => (
              <li key={l.id}>
                <LetterLine l={l} canDecide={data.can.approveLetters} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card
        title="Arrears"
        sub="Open a tenant to record a payment or a follow-up. Letters and any legal step need the Asset Director; nothing goes to lawyers automatically."
        actions={<span className="bz-amt">{rm(data.kpis.arrears)}</span>}
        flush
      >
        {data.arrears.length > 0 && (
          <div className="bz-am-aging-wrap">
            <Aging rows={data.arrears} />
          </div>
        )}
        {data.arrears.length === 0 && <Empty title="No arrears." />}
        <ul className="bz-rows">
          {data.arrears.map((a) => (
            <li key={a.id}>
              <ArrearsLine a={a} canRecord={data.can.record} />
            </li>
          ))}
        </ul>
      </Card>
      <div className="bz-two">
        {data.can.record && (
          <Card
            title="Record a payment"
            sub={`Any rent received: cash, transfer, cheque or online. It pays the oldest unpaid month first. Cash needs the official receipt number and Finance confirms it is banked within ${data.rule.cashBankDays} days.`}
          >
            <div className="bz-stack">
              <Search
                value={find}
                onChange={(v) => {
                  setFind(v);
                  setUnitId("");
                }}
                placeholder="Find a tenant or unit code"
                label="Find a tenant or unit"
              />
              {!chosen && matches.length > 0 && (
                <ul className="bz-rows bz-am-picker">
                  {matches.map((u) => (
                    <li key={u.id}>
                      <button className="bz-row" onClick={() => setUnitId(u.id)}>
                        <span className="bz-row-main">
                          <span className="bz-row-title">{u.tenant}</span>
                          <span className="bz-row-meta">
                            {u.code} · {u.name} · {rm2(u.rent)} a month
                          </span>
                        </span>
                        <span className="bz-row-side">
                          <Chip tone={u.due ? "warn" : "ok"}>
                            {u.due ? `Due ${rm2(u.due)}` : "Nothing due"}
                          </Chip>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {chosen && (
                <div className="bz-act">
                  <div className="bz-am-chosen">
                    <strong>{chosen.tenant}</strong>
                    <span className="bz-sub">
                      {chosen.code} · due {rm2(chosen.due)}
                    </span>
                  </div>
                  <PaymentForm
                    u={chosen}
                    onDone={() => (setUnitId(""), setFind(""))}
                  />
                </div>
              )}
            </div>
          </Card>
        )}
        {(data.cashToBank.length > 0 || data.can.bank) && (
          <Card
            title="Payments to confirm in the bank"
            actions={<span className="bz-count">{data.cashToBank.length}</span>}
            flush
          >
            {!data.cashToBank.length && (
              <Empty title="Every payment is confirmed in the bank." />
            )}
            <ul className="bz-rows">
              {data.cashToBank.map((c) => (
                <li key={c.id}>
                  <CashLine c={c} canBank={data.can.bank} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      {data.recentPayments.length > 0 && (
        <Card title="Payments recorded" flush>
          <ul className="bz-rows">
            {data.recentPayments.map((p) => (
              <li key={p.id}>
                <PaymentLine p={p} canReverse={data.can.record} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card
        title="Group office and state branches"
        sub="They rent from Asset Management and pay like any tenant, from their own company's account."
        flush
      >
        <ul className="bz-rows">
          {data.internal.map((u) => (
            <li key={u.id}>
              <div className="bz-row" data-tone={u.owed ? "warn" : undefined}>
                <div className="bz-row-main">
                  <span className="bz-row-title">{u.tenant}</span>
                  <span className="bz-row-meta">
                    {u.code} · {u.name} · {rm(u.rent)} a month
                  </span>
                </div>
                <div className="bz-row-side">
                  <Chip tone={u.owed ? "warn" : "ok"}>
                    {u.owed ? `Owes ${rm(u.owed)}` : "Paid up"}
                  </Chip>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <div className="bz-two">
        <Card title="Agreements ending soon" flush>
          {data.expiring.length === 0 && <Empty title="None ending soon." />}
          <ul className="bz-rows">
            {data.expiring.slice(0, 40).map((e) => (
              <li key={e.unitId}>
                <div className="bz-row">
                  <div className="bz-row-main">
                    <span className="bz-row-title">{e.tenant}</span>
                    <span className="bz-row-meta">
                      {e.code} · ends {dateLabel(e.endOn)}
                    </span>
                  </div>
                  <div className="bz-row-side">
                    <Chip tone={e.days <= 30 ? "crit" : "warn"}>{e.days} days</Chip>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Insurance, assessment and quit rent" flush>
          {data.dues.length === 0 && <Empty title="Nothing due." />}
          <ul className="bz-rows">
            {data.dues.slice(0, 40).map((d) => (
              <li key={`${d.unitId}-${d.what}`}>
                <div className="bz-row">
                  <div className="bz-row-main">
                    <span className="bz-row-title">{d.what}</span>
                    <span className="bz-row-meta">
                      {d.code} · {d.name} · {dateLabel(d.on)}
                    </span>
                  </div>
                  <div className="bz-row-side">
                    <Chip tone={d.days < 0 ? "crit" : "warn"}>
                      {d.days < 0 ? `${-d.days} days overdue` : `${d.days} days`}
                    </Chip>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
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
    <Card
      title="Work orders"
      sub="Each closes with photos before and after, the cost and the contractor."
      actions={<RecordButton kind="amWorkOrder" label="Add work order" />}
      flush
    >
      {data.workOrders.length === 0 && <Empty title="No work orders." />}
      <ul className="bz-rows">
        {data.workOrders.map((w) => (
          <li key={w.id}>
            <div className="bz-row bz-am-row" data-tone={edge(tone(w)[0])}>
              <div className="bz-row-main">
                <span className="bz-row-title">{w.title}</span>
                <span className="bz-row-meta">
                  {w.place} ·{" "}
                  {w.source === "tenant" ? "tenant complaint" : w.source}
                  {w.contractor ? ` · ${w.contractor}` : ""}
                </span>
              </div>
              <div className="bz-am-money">
                <span className="bz-am-due">due {dateLabel(w.dueOn)}</span>
                {w.cost != null && <span className="bz-sub">{rm(w.cost)}</span>}
              </div>
              <div className="bz-am-side">
                <Chip tone={tone(w)[0]}>{tone(w)[1]}</Chip>
                <RecordButton kind="amWorkOrder" id={w.id} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
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
      <Card
        title="Register"
        sub={`${data.assets.count} in use · ${rm(data.assets.cost)} at cost · ${data.assets.poor} in poor condition`}
        actions={<RecordButton kind="amAsset" label="Add asset" />}
      >
        <div className="bz-stack">
          <div className="bz-am-cats">
            {data.assets.byCategory.map((c) => (
              <div key={c.category} className="bz-am-cat">
                <span className="bz-sub">{CATEGORY[c.category]}</span>
                <span className="bz-am-cat-n">{c.count}</span>
                <span className="bz-sub">{rm(c.cost)}</span>
              </div>
            ))}
          </div>
          <p className="bz-note">
            Computers and other electronic items are not on this register until
            the group decides who owns them. Buying and disposal are decided by
            Asset Management, with approval as in the group approval structure.
          </p>
        </div>
      </Card>
      {data.assets.disposalPending.length > 0 && (
        <Card title="Disposals waiting for approval" flush>
          <ul className="bz-rows">
            {data.assets.disposalPending.map((a) => (
              <li key={a.id}>
                <div className="bz-row" data-tone="warn">
                  <div className="bz-row-main">
                    <span className="bz-row-title">
                      <span className="mono">{a.tag}</span> · {a.description}
                    </span>
                    <span className="bz-row-meta">{a.location}</span>
                  </div>
                  <div className="bz-row-side">
                    <Chip tone="warn">Waiting</Chip>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card
        title="Assets"
        actions={
          <Search
            value={q}
            onChange={setQ}
            placeholder="Tag, item or place"
            label="Search assets"
          />
        }
        flush
      >
        {rows.length === 0 && <Empty title="No asset matches." />}
        <ul className="bz-rows">
          {rows.slice(0, 60).map((a) => {
            const t: Tone =
              a.status === "disposed"
                ? "neutral"
                : a.condition === "poor"
                  ? "warn"
                  : "ok";
            return (
              <li key={a.id}>
                <div className="bz-row bz-am-row" data-tone={edge(t)}>
                  <div className="bz-row-main">
                    <span className="bz-row-title">
                      <span className="mono">{a.tag}</span> · {a.description}
                    </span>
                    <span className="bz-row-meta">
                      {a.location} · bought {dateLabel(a.boughtOn)} · checked{" "}
                      {a.lastCheckedOn ? dateLabel(a.lastCheckedOn) : "never"}
                    </span>
                  </div>
                  <div className="bz-am-money">
                    <span className="bz-amt">{rm(a.cost)}</span>
                  </div>
                  <div className="bz-am-side">
                    <Chip tone={t}>
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
              </li>
            );
          })}
        </ul>
        {rows.length > 60 && (
          <p className="bz-note bz-am-more">
            Showing 60 of {rows.length}. Search to narrow.
          </p>
        )}
      </Card>
    </>
  );
}

function Properties({ data }: { data: AmBoard }) {
  return (
    <div className="bz-am-props">
      {data.properties.map((p) => {
        const surplus = p.income6 >= p.cost6;
        return (
          <Card
            key={p.id}
            title={p.name}
            sub={`${KIND[p.kind]} · ${p.town}, ${p.state} · ${p.detail}`}
          >
            <div className="bz-stack">
              <div className="bz-am-figs" aria-label="Last 6 months">
                <div>
                  <span className="bz-sub">Income, last 6 months</span>
                  <span className="bz-amt">{rm(p.income6)}</span>
                </div>
                <div>
                  <span className="bz-sub">Cost</span>
                  <span className="bz-amt">{rm(p.cost6)}</span>
                </div>
                <div data-tone={surplus ? "ok" : "crit"}>
                  <span className="bz-sub">{surplus ? "Surplus" : "Deficit"}</span>
                  <span className="bz-amt">{rm(Math.abs(p.income6 - p.cost6))}</span>
                </div>
              </div>
              {p.last && (
                <div className="bz-am-last">
                  <span className="bz-am-last-period">{p.last.period}</span>
                  <span className="bz-sub">
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
              {p.licences.length > 0 && (
                <ul className="bz-am-licences" aria-label="Licences">
                  {p.licences.map((l) => {
                    const due = p.licencesDue.find((d) => d.name === l.name);
                    return (
                      <li key={l.name}>
                        <span>{l.name}</span>
                        <Chip tone={due ? (due.days <= 30 ? "crit" : "warn") : "ok"}>
                          {due
                            ? `${due.days} days left`
                            : `to ${dateLabel(l.expiresOn)}`}
                        </Chip>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>
        );
      })}
    </div>
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
    <div className="bz-stack">
      <div className="bz-am-fields">
        <label className="field">
          <span className="label">Amount received</span>
          <input
            className="input"
            placeholder="Amount (RM)"
            inputMode="decimal"
            value={f.amount}
            onChange={(e) => setF({ ...f, amount: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="label">How it was paid</span>
          <select
            className="select"
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
        </label>
        <label className="field">
          <span className="label">Date received</span>
          <input
            className="input"
            type="date"
            value={f.on}
            onChange={(e) => setF({ ...f, on: e.target.value })}
          />
        </label>
        {f.method !== "CASH" && (
          <label className="field">
            <span className="label">Bank reference or cheque number</span>
            <input
              className="input"
              placeholder="Bank ref or cheque no."
              value={f.ref}
              onChange={(e) => setF({ ...f, ref: e.target.value })}
            />
          </label>
        )}
      </div>
      <div className="bz-actions">
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
        <span className="bz-note">
          The app numbers the official receipt; give it to the tenant. Finance
          confirms every payment against the bank.
        </span>
      </div>
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
    <div className="bz-stack">
      <div className="bz-am-fields">
        <label className="field">
          <span className="label">What was done</span>
          <select
            className="select"
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
        </label>
        {f.action === "PROMISE" && (
          <label className="field">
            <span className="label">Promised to pay on</span>
            <input
              className="input"
              type="date"
              value={f.promiseOn}
              onChange={(e) => setF({ ...f, promiseOn: e.target.value })}
            />
          </label>
        )}
        <label className="field bz-am-wide">
          <span className="label">What happened</span>
          <input
            className="input"
            placeholder="What happened"
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
          />
        </label>
      </div>
      <div className="bz-actions">
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
      <p className="bz-note">
        No phone or email on file. Add them under Units, Tenant and agreement.
      </p>
    );
  return (
    <div className="bz-actions">
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
      <p className="bz-note">
        The rental team contacts tenants and records payments.
      </p>
    );
  return (
    <div className="bz-act bz-am-follow">
      <div className="bz-sec">
        <div className="bz-sec-head">
          <h3>Contact the tenant</h3>
          <span className="bz-sub">
            Last update{" "}
            {u.update?.lastOn ? dateLabel(u.update.lastOn) : "none yet"}. Update
            at least every 10 days until paid.
          </span>
        </div>
        <ContactBar u={u} onContact={setAction} />
      </div>
      <div className="bz-sec bz-am-split">
        <h3>What happened</h3>
        <FollowUpForm u={u} action={action} />
      </div>
      <div className="bz-sec bz-am-split">
        <h3>Payment received</h3>
        <PaymentForm u={u} />
      </div>
    </div>
  );
}

function ArrearsLine({ a, canRecord }: { a: UnitRow; canRecord: boolean }) {
  const [open, setOpen] = useState(false);
  const tone: Tone =
    a.promise?.broken || a.arrearsBucket >= 90
      ? "crit"
      : a.arrearsBucket >= 30
        ? "warn"
        : "neutral";
  return (
    <div className="bz-am-item" data-open={open || undefined}>
      <button
        className="bz-row bz-am-row"
        data-tone={edge(tone)}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="bz-row-main">
          <span className="bz-row-title">
            {a.tenant}
            {a.internal ? " (group)" : ""}
          </span>
          <span className="bz-row-meta">
            {a.code} · {a.name} · unpaid since {a.owedSince}
            {a.followUps.length
              ? ` · last: ${FOLLOW[a.followUps.at(-1)!.action].split(" (")[0].toLowerCase()} ${dateLabel(a.followUps.at(-1)!.on)}`
              : " · no follow-up yet"}
          </span>
          {a.promise && (
            <span className="bz-am-promise" data-broken={a.promise.broken || undefined}>
              Promised to pay by {dateLabel(a.promise.on)}
              {a.promise.broken ? ": not kept" : ""}
            </span>
          )}
        </span>
        <span className="bz-am-money">
          <span className="bz-amt">{rm(a.owed)}</span>
        </span>
        <span className="bz-am-side">
          <span className="bz-chips bz-am-chips">
            <UpdateChip u={a} />
            <Chip tone={tone}>
              {a.arrearsBucket ? `${a.arrearsBucket}+ days` : "Under 30 days"}
            </Chip>
          </span>
        </span>
      </button>
      {open && (
        <div className="bz-am-expand bz-stack">
          {a.followUps.length > 0 && (
            <ol className="bz-am-history" aria-label="Follow-ups">
              {a.followUps.map((f) => (
                <li key={f.id}>
                  <span className="bz-am-history-when">{dateLabel(f.on)}</span>
                  <span>
                    <strong>{FOLLOW[f.action].split(" (")[0]}</strong> ·{" "}
                    {f.note} ({f.by})
                    {f.action === "LETTER" || f.action === "NOTICE"
                      ? f.approval
                        ? f.approval.approve
                          ? `, approved by ${f.approval.by}`
                          : `, stopped by ${f.approval.by}: ${f.approval.note}`
                        : ", waiting for the Asset Director"
                      : ""}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <FollowUpPanel u={a} canRecord={canRecord} />
        </div>
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
    <div className="bz-am-item">
      <div className="bz-row" data-tone={c.late ? "crit" : "warn"}>
        <div className="bz-row-main">
          <span className="bz-row-title">{c.tenant}</span>
          <span className="bz-row-meta">
            {c.code} · receipt {c.receiptNo} · {METHOD[c.method].toLowerCase()}{" "}
            · received {dateLabel(c.on)} by {c.by}
          </span>
        </div>
        <div className="bz-row-side">
          <span className="bz-amt">{rm2(c.amount)}</span>
          <Chip tone={c.late ? "crit" : "warn"}>
            {c.late
              ? "Late"
              : c.method === "CASH"
                ? "To bank in"
                : "To match in the bank"}
          </Chip>
        </div>
      </div>
      {canBank && (
        <div className="bz-am-expand">
          <div className="bz-am-inline">
            <label className="field">
              <span className="label">Banked on</span>
              <input
                className="input"
                type="date"
                value={on}
                onChange={(e) => setOn(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="label">Bank-in slip number</span>
              <input
                className="input"
                placeholder={
                  c.method === "CASH" ? "Bank-in slip no." : "Bank statement ref"
                }
                value={slip}
                onChange={(e) => setSlip(e.target.value)}
              />
            </label>
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
          <ErrorNotice error={act.error} />
        </div>
      )}
      {!canBank && act.error && <ErrorNotice error={act.error} />}
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
    <div className="bz-am-item">
      <div className="bz-row" data-tone="warn">
        <div className="bz-row-main">
          <span className="bz-row-title">
            {l.tenant}: {FOLLOW[l.action].split(" (")[0]}
          </span>
          <span className="bz-row-meta">
            {l.code} · asked {dateLabel(l.on)} by {l.by} · {l.note}
          </span>
        </div>
        <div className="bz-row-side">
          <span className="bz-amt">owes {rm(l.owed)}</span>
        </div>
      </div>
      <div className="bz-am-expand">
        {canDecide ? (
          <div className="bz-am-inline">
            <label className="field bz-am-wide">
              <span className="label">Note</span>
              <input
                className="input"
                placeholder="Note (required to stop)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
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
          <p className="bz-note">
            The Asset Director approves it before it is sent.
          </p>
        )}
        <ErrorNotice error={act.error} />
      </div>
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
    <div className="bz-am-item">
      <div className="bz-row" data-tone="warn">
        <div className="bz-row-main">
          <span className="bz-row-title">
            {p.tenant}: {rm2(p.amount)} {METHOD[p.method].toLowerCase()},
            receipt {p.receiptNo}
          </span>
          <span className="bz-row-meta">
            {p.code} · recorded {dateLabel(p.on)} by {p.by} · reversal asked by{" "}
            {p.reversal!.by}: {p.reversal!.reason}
          </span>
        </div>
      </div>
      <div className="bz-am-expand">
        {canDecide ? (
          <div className="bz-am-inline">
            <label className="field bz-am-wide">
              <span className="label">Note</span>
              <input
                className="input"
                placeholder="Note (required to refuse)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
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
          <p className="bz-note">
            The Asset Director approves it. The person who recorded the payment
            never reverses it alone.
          </p>
        )}
        <ErrorNotice error={act.error} />
      </div>
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
    <div className="bz-am-item">
      <div className="bz-row bz-am-row" data-reversed={p.reversed ? "" : undefined}>
        <div className="bz-row-main">
          <span className="bz-row-title bz-am-pay-title">
            {p.tenant}: {METHOD[p.method].toLowerCase()}
          </span>
          <span className="bz-row-meta">
            {p.code} · receipt {p.receiptNo}
            {p.ref ? ` · ${p.ref}` : ""} · {dateLabel(p.on)} by {p.by} · for{" "}
            {p.applied.map((x) => x.period).join(", ")}
            {p.banked
              ? ` · banked ${dateLabel(p.banked.on)}, slip ${p.banked.slipRef}`
              : ""}
          </span>
          {p.reversal && !p.reversed && (
            <span className="bz-am-flag">
              Reversal asked by {p.reversal.by}: {p.reversal.reason}. Waiting
              for the Asset Director.
            </span>
          )}
          {p.reversed && (
            <span className="bz-am-flag">
              Reversed by {p.reversed.by}: {p.reversed.reason}
            </span>
          )}
        </div>
        <div className="bz-am-money">
          <span className="bz-amt bz-am-pay-amt">{rm2(p.amount)}</span>
        </div>
        <div className="bz-am-side">
          {p.banked && <Chip tone="ok">Banked</Chip>}
          {p.reversed && <Chip tone="neutral">Reversed</Chip>}
          {canReverse && !p.reversed && !p.reversal && !p.banked && (
            <button
              className="btn btn-sm"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              Ask to reverse
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="bz-am-expand">
          <div className="bz-am-inline">
            <label className="field bz-am-wide">
              <span className="label">Why reverse</span>
              <input
                className="input"
                placeholder="Why (wrong tenant, wrong amount, cheque bounced)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
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
        </div>
      )}
      {act.error && (
        <div className="bz-am-expand">
          <ErrorNotice error={act.error} />
        </div>
      )}
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
    <Card
      title="Asset Management system against Prima"
      sub={`${data.fromSystem} of ${data.units} units sent by the system · ${data.notFromSystem} not sent yet`}
      actions={
        data.differences.length > 0 ? (
          <Chip tone="warn">{data.differences.length} differences</Chip>
        ) : undefined
      }
      flush
    >
      {data.differences.length === 0 && (
        <Empty
          title={
            data.fromSystem
              ? "No differences."
              : "The Asset Management system is not connected yet, so there is nothing to compare."
          }
        />
      )}
      {data.differences.length > 0 && (
        <div className="table-wrap bz-am-table">
          <table>
            <thead>
              <tr>
                <th>Unit</th>
                <th>Prima</th>
                <th>System</th>
                <th>Difference</th>
              </tr>
            </thead>
            <tbody>
              {data.differences.map((d, i) => (
                <tr key={i}>
                  <td>
                    <span className="bz-row-title">
                      <span className="mono">{d.code}</span> · {d.name}
                    </span>
                  </td>
                  <td>{d.prima}</td>
                  <td>{d.system}</td>
                  <td>
                    <Chip tone="warn">{d.issue}</Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
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
  const waiting = data.purchases.filter((a) => a.status === "buy_requested").length;
  return (
    <div className="bz-am-buy">
      <Card
        title="Purchase requests"
        actions={waiting ? <Chip tone="warn">{waiting} waiting for a decision</Chip> : undefined}
        flush
      >
        {data.purchases.length === 0 && <Empty title="No purchase requests." />}
        <ul className="bz-rows">
          {data.purchases.map((a) => {
            const p = a.purchase!;
            const st = BUY_STATE[a.status] ?? { label: a.status, tone: "neutral" as Tone };
            return (
              <li key={a.id}>
                <div className="bz-am-item">
                  <div className="bz-row" data-tone={edge(st.tone)}>
                    <div className="bz-row-main">
                      <span className="bz-row-title">
                        {p.qty} × {a.description}
                      </span>
                      <span className="bz-row-meta">
                        {a.location} · asked by {p.askedBy} on {dateLabel(p.askedAt.slice(0, 10))}: {p.reason}
                      </span>
                      {p.decidedBy && (
                        <span className="bz-am-flag">
                          {p.decidedBy}: {p.decisionReason}
                        </span>
                      )}
                    </div>
                    <div className="bz-row-side">
                      <span className="bz-amt">{rm(p.estCost)}</span>
                      <Chip tone={st.tone}>{st.label}</Chip>
                    </div>
                  </div>
                  {a.status === "buy_approved" && (
                    <div className="bz-am-expand">
                      <ReceiveBought id={a.id} approved={p.estCost} busy={busy} run={run} />
                    </div>
                  )}
                  {a.status === "buy_requested" && (
                    <div className="bz-am-expand">
                      <div className="bz-am-inline">
                        <label className="field bz-am-wide">
                          <span className="label">Reason for the decision</span>
                          <input className="input" aria-label={`Reason for ${a.description}`} placeholder="Reason" value={why[a.id] ?? ""} onChange={(e) => setWhy({ ...why, [a.id]: e.target.value })} />
                        </label>
                        <button className="btn btn-sm btn-primary" disabled={busy || (why[a.id] ?? "").trim().length < 3} onClick={() => run(() => api.amBuyDecide(a.id, true, why[a.id] ?? "", p.estCost), "Purchase approved")}>
                          Approve
                        </button>
                        <button className="btn btn-sm" disabled={busy || (why[a.id] ?? "").trim().length < 3} onClick={() => run(() => api.amBuyDecide(a.id, false, why[a.id] ?? "", p.estCost), "Purchase refused")}>
                          Refuse
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card title="Ask to buy" sub="The Asset Management team asks. Once bought, the request becomes the asset in the register.">
        <div className="bz-form">
          <ErrorNotice error={error} />
          <label className="field bz-span">
            <span className="label">What to buy</span>
            <input className="input" placeholder="What to buy" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">Category</span>
            <select className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as typeof form.category })}>
              <option value="FURNITURE">Furniture</option>
              <option value="FITTING">Fitting</option>
              <option value="RENOVATION">Renovation</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label className="field">
            <span className="label">Quantity</span>
            <input className="input" type="number" min={1} placeholder="Qty" value={form.qty} onChange={(e) => setForm({ ...form, qty: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span className="label">Estimated cost (RM)</span>
            <input className="input" type="number" min={0} placeholder="Estimated RM" value={form.estCost || ""} onChange={(e) => setForm({ ...form, estCost: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span className="label">Location</span>
            <input className="input" placeholder="Where it goes" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </label>
          <label className="field bz-span">
            <span className="label">Owning entity</span>
            <input className="input" placeholder="Owning entity" value={form.ownerEntity} onChange={(e) => setForm({ ...form, ownerEntity: e.target.value })} />
          </label>
          <label className="field bz-span">
            <span className="label">Reason</span>
            <input className="input" placeholder="Reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </label>
          <div className="bz-span bz-actions">
            <button className="btn btn-primary" disabled={busy || !ready} onClick={() => run(() => api.amBuyRequest(form).then(() => setForm(empty)), "Purchase request sent")}>
              Ask
            </button>
          </div>
        </div>
      </Card>
    </div>
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
    <Card
      title="WhatsApp rent reminders"
      actions={
        <>
          <Chip tone={c.sending ? "ok" : "unknown"}>{c.sending ? "Connected, sending" : c.configured ? "Set up, switched off" : "Not connected"}</Chip>
          <button
            className="btn btn-sm"
            disabled={busy}
            onClick={() =>
              run(() => api.amWhatsAppRun(), (r) => (r.sending ? `${r.sent} sent, ${r.queued} queued` : `${r.queued} planned (WhatsApp not connected)`))
            }
          >
            Check reminders now
          </button>
        </>
      }
    >
      <div className="bz-stack bz-am-wa">
        <p className="bz-note">
          Sent {t.beforeDays} days before rent is due (day {t.dueDay} of the month; reminder days proposed), on the due day, then {t.firstLateDays} days late and every {t.lateEveryDays} days
          until {t.stopAfterLateDays} days, between {t.sendFromHour} am and {t.sendToHour - 12} pm. Only to tenants who agreed; a tenant who replies STOP is never
          messaged again. Replies show on the unit. Automatic messages do not replace the team's own update every 10 days.
          {!c.sending && " Until WhatsApp Business is connected, reminders are planned here but not sent."}
        </p>
        <div className="bz-chips">
          <Chip tone="info">
            {data.agreed} of {data.tenants} tenants agreed
          </Chip>
          {data.failed ? <Chip tone="crit">{data.failed} failed</Chip> : null}
        </div>
        <ErrorNotice error={actError} />
        {data.owingWithoutConsent.length > 0 && (
          <div className="bz-sec">
            <h3>Owing rent, not yet agreed to WhatsApp</h3>
            <ul className="bz-rows bz-am-box">
              {data.owingWithoutConsent.slice(0, 30).map((u) => (
                <li key={u.unitId}>
                  <div className="bz-am-wa-row">
                    <div className="bz-row-main">
                      <span className="bz-row-title">
                        {u.code} · {u.tenant}
                      </span>
                      {!u.hasMobile && <span className="bz-row-meta">No Malaysian mobile on file</span>}
                    </div>
                    {u.hasMobile && (
                      <div className="bz-am-inline">
                        <input
                          className="input bz-am-grow"
                          aria-label={`How ${u.tenant} agreed`}
                          placeholder="How they agreed, e.g. signed form"
                          value={how[u.unitId] ?? ""}
                          onChange={(e) => setHow({ ...how, [u.unitId]: e.target.value })}
                        />
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={busy || (how[u.unitId] ?? "").trim().length < 5}
                          onClick={() => run(() => api.amWhatsAppConsent(u.unitId, true, how[u.unitId] ?? ""), `${u.code}: WhatsApp reminders on`)}
                        >
                          Agreed
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {data.agreedUnits.length > 0 && (
          <div className="bz-sec">
            <h3>Agreed</h3>
            <ul className="bz-rows bz-am-box">
              {data.agreedUnits.slice(0, 50).map((u) => (
                <li key={u.unitId}>
                  <div className="bz-row">
                    <div className="bz-row-main">
                      <span className="bz-row-title">
                        {u.code} · {u.tenant}
                      </span>
                      <span className="bz-row-meta">
                        {u.how} · recorded by {u.by}
                      </span>
                    </div>
                    <div className="bz-row-side">
                      <button className="btn btn-sm" disabled={busy} onClick={() => run(() => api.amWhatsAppConsent(u.unitId, false, "Tenant asked to stop"), `${u.code}: WhatsApp reminders stopped`)}>
                        Stop
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {data.recent.length > 0 && (
          <div className="bz-sec">
            <h3>Recent reminders</h3>
            <ul className="bz-rows bz-am-box">
              {data.recent.slice(0, 20).map((r) => (
                <li key={r.id}>
                  <div className="bz-am-item">
                    <div className="bz-row" data-tone={edge((WA_STATUS[r.status] ?? WA_STATUS.queued).tone)}>
                      <div className="bz-row-main">
                        <span className="bz-row-title">
                          {r.code} · {r.tenant}
                        </span>
                        <span className="bz-row-meta">
                          {r.period}, {WA_STAGE[r.stage]} · {rm(r.amount)}
                          {r.lastError ? ` · ${r.lastError}` : ""}
                        </span>
                      </div>
                      <div className="bz-row-side">
                        <Chip tone={(WA_STATUS[r.status] ?? WA_STATUS.queued).tone}>{(WA_STATUS[r.status] ?? WA_STATUS.queued).label}</Chip>
                      </div>
                    </div>
                    {r.status === "uncertain" && (
                      <div className="bz-am-expand">
                        <div className="bz-am-inline">
                          <input
                            className="input bz-am-grow"
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
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
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
    <div className="bz-stack">
      <div className="bz-am-inline">
        <label className="field">
          <span className="label">Asset tag</span>
          <input className="input" placeholder="Asset tag" value={tag} onChange={(e) => setTag(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Actual cost (RM)</span>
          <input className="input" type="number" min={0} placeholder={`Actual RM (up to ${rm(approved)})`} value={cost} onChange={(e) => setCost(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Bought on</span>
          <input className="input" type="date" value={on} max={today} onChange={(e) => setOn(e.target.value)} />
        </label>
        {!over && (
          <button className="btn btn-sm btn-primary" disabled={busy || tag.trim().length < 3 || !(n > 0)} onClick={() => run(() => api.amBuyReceived(id, { tag, cost: n, boughtOn: on }), "Received: added to the register")}>
            Received
          </button>
        )}
      </div>
      {over && (
        <div className="bz-am-inline">
          <div className="notice bz-span" data-tone="warn">
            Above the approved {rm(approved)}: it must be approved again.
          </div>
          <label className="field bz-am-wide">
            <span className="label">Why the price changed</span>
            <input className="input" placeholder="Why the price changed" value={why} onChange={(e) => setWhy(e.target.value)} />
          </label>
          <button className="btn btn-sm" disabled={busy || why.trim().length < 5} onClick={() => run(() => api.amBuyReprice(id, n, why), "Sent back for approval at the new amount")}>
            Ask again at {rm(n)}
          </button>
        </div>
      )}
    </div>
  );
}
