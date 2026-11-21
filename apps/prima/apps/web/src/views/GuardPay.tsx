import { Select } from '../SearchSelect';
import { useState } from "react";
import type { ProofInput } from "@prima/core";
import { ProofPicker } from "./Proof";
import type { GuardPayLine, GuardPayStage } from "@prima/core";
import {
  api,
  type GuardAdvanceBoard,
  type GuardLoanBoard,
  type GuardPayBoard,
  type GuardPayFile,
  type GuardPayRunView,
} from "../api";
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
  type Tone,
} from "../ui";
import { Empty } from "../kit";
import { SopHelp } from "../sop/SopHelp";
import { DataTable } from "../DataTable";

/**
 * Guard pay run (Fauzan, 5 Nov 2026). Guards, stationed officers and patrolling officers are paid from locked
 * attendance under the ACT pay formula used at their site. HR prepares each company's month, the COO approves with a
 * reason, Finance pays through the bank. While the JA Group app still pays guards, every month is a trial to compare.
 */

const STAGE: Record<GuardPayStage, [Tone, string]> = {
  draft: ["neutral", "Draft with the company"],
  submitted: ["warn", "With the COO"],
  approved: ["info", "Approved, with Finance"],
  paid: ["ok", "Paid"],
};
const FILES: [GuardPayFile, string][] = [
  ["bank", "Bank upload"],
  ["ewallet", "E-wallet list"],
  ["sql", "SQL Account journal"],
  ["epf", "EPF list"],
  ["socso", "SOCSO and EIS list"],
  ["pcb", "PCB list"],
];
const rm = (n: number) =>
  `RM${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthLabel = (p: string) =>
  new Date(`${p}-01T00:00:00Z`).toLocaleDateString("en-MY", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

export function GuardPayView() {
  const { data, error } = useLoad(() => api.guardPayroll(), []);
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="guard pay" />;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Guard pay</h1>
        <p className="muted">
          {/* P105: plainer order of who does what (B1: the Company Manager names who prepares). */}
          Monthly pay for guards and officers, from locked attendance and the ACT pay formula used at each site. A company executive named by the Company Manager prepares it, the COO approves with a reason, and Finance pays through the bank. Prima only drafts the files.
        </p>
        <div className="row" style={{ marginTop: 8 }}>
          <SopHelp id="pay-guard-run" />
        </div>
      </div>
      {!data.rule.primaPays && (
        // Fauzan, 8 Nov 2026: the switch date (rule PAY-GUARD switchDate). Until then the JA Group app pays guards.
        <div className="notice" data-tone="info" data-testid="guard-pay-switch">
          <strong>Prima takes over guard pay on 1 Aug 2027. Until then runs are trials; JA Group app still pays.</strong>
          <div>Each month here is worked out to compare with JA, cannot be marked paid, and its bank file says not to upload it.</div>
        </div>
      )}
      {!data.on && (
        <div className="notice" data-tone="warn">
          The guard pay run is not switched on in this database yet. Nothing
          can be prepared until the guard pay module is installed with
          approval.
        </div>
      )}
      <ConsentLetters />
      <Runs data={data} onOpen={setOpen} />
      {open && <RunDrawer runId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** B1 (11 Nov 2026): the Company Manager names who prepares the company's guard pay run, with a reason. */
function Preparers({ e }: { e: GuardPayBoard["employers"][number] }) {
  const act = useAction();
  const [editing, setEditing] = useState(false);
  const [ids, setIds] = useState<string[]>(e.preparers?.userIds ?? []);
  const [reason, setReason] = useState("");
  const names = e.preparerNames.length ? e.preparerNames.join(", ") : null;
  return (
    <div className="small">
      {/* P107: the table's "Prepared by" heading (or the phone card's label) names this cell. */}
      {names ?? <Chip tone="warn">nobody named yet</Chip>}
      {e.canNamePreparers && !editing && (
        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }} onClick={() => setEditing(true)}>
          {names ? "Change" : "Name who prepares"}
        </button>
      )}
      {editing && (
        <div className="stack" style={{ gap: 6, marginTop: 6 }}>
          {e.office.map((o) => (
            <label key={o.id} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={ids.includes(o.id)}
                onChange={(ev) => setIds(ev.target.checked ? [...ids, o.id] : ids.filter((x) => x !== o.id))}
              />
              {o.name} <span className="muted">{o.title}</span>
            </label>
          ))}
          <input className="input" placeholder="Reason (required)" value={reason} onChange={(ev) => setReason(ev.target.value)} />
          <ErrorNotice error={act.error} />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || reason.trim().length < 5}
              onClick={() =>
                act.run(() => api.setGuardPayPreparers(e.companyId, ids, reason), "Saved. They can now prepare and submit the run.").then((r) => { if (r !== undefined) setEditing(false); })
              }
            >
              Save
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** B1b: hours recorded beside hours paid. A line that does not match is held until attendance or leave is corrected. */
function HoursLine({ h, full }: { h: NonNullable<GuardPayLine["hours"]>; full?: boolean }) {
  if (h.notCompared) return <div className="small muted">Hours not compared: {h.notCompared}</div>;
  return (
    <div className="small" style={h.match ? undefined : { color: "var(--crit, #b91c1c)" }}>
      Hours recorded {h.recorded} · hours paid {h.paid} {h.match ? <Chip tone="ok">match</Chip> : <Chip tone="crit">do not match</Chip>}
      {full && (
        <div className="muted">
          Recorded: duty {h.duty}, paid leave {h.leave}, holidays {h.holiday}. Paid: normal {h.normal}, overtime {h.ot}, rest day {h.restDay}, public holiday{" "}
          {h.publicHoliday}, leave {h.leave}, holidays {h.holiday}.
        </div>
      )}
    </div>
  );
}

function Runs({
  data,
  onOpen,
}: {
  data: GuardPayBoard;
  onOpen: (id: string) => void;
}) {
  const act = useAction();
  const mine = data.runs.filter((r) => r.mineToAct);
  const late = data.employers.filter((e) => e.lastLate);
  const lastMonth = data.runs.filter((r) => r.period === data.prev);
  const prepare = (companyId: string, period: string) =>
    act.run(
      () => api.prepareGuardPay(companyId, period),
      "Prepared. Check the lines, then submit.",
    );
  return (
    <>
      <div className="kpis">
        <Kpi
          label="Waiting for you"
          value={mine.length}
          tone={mine.length ? "warn" : "ok"}
        />
        <Kpi
          label={`${monthLabel(data.prev)} net pay`}
          value={rm(lastMonth.reduce((n, r) => n + r.totals.net, 0))}
          note={`${lastMonth.reduce((n, r) => n + r.totals.headcount, 0)} guards and officers`}
        />
        <Kpi
          label="Lines to check"
          value={lastMonth.reduce((n, r) => n + r.totals.flagged, 0)}
          tone={lastMonth.some((r) => r.totals.flagged) ? "warn" : "ok"}
        />
        <Kpi
          label={`Not paid by the ${data.rule.payByDay}th`}
          value={late.length}
          tone={late.length ? "crit" : "ok"}
          note="Employment Act s.19"
        />
      </div>
      <ErrorNotice error={act.error} />
      <section className="panel">
        <div className="panel-head">
          <h3>By company</h3>
        </div>
        {data.employers.length === 0 && (
          <Empty title="No guards or officers on the pay list yet">
            A company appears here once it has active guards or officers in People. The person its Company Manager names then prepares each month's pay from their locked attendance.
          </Empty>
        )}
        {data.employers.length > 0 && (
          <div className="panel-body">
            {/* P107: a data table (search, status filter, sort, pages; cards on a phone) in place of the hand-drawn list. */}
            <DataTable
              label="By company"
              stateKey="guardpay.companies"
              rows={data.employers}
              rowKey={(e) => e.companyId}
              searchText={(e) => e.preparerNames.join(" ")}
              columns={[
                { id: "company", label: "Company", value: (e) => e.companyName, render: (e) => <strong>{e.companyName}</strong>, phone: "title" },
                { id: "guards", label: "Guards and officers", value: (e) => e.guards, sort: "number" },
                { id: "preparers", label: "Prepared by", value: (e) => e.preparerNames.join(", "), render: (e) => <Preparers e={e} /> },
                { id: "last", label: "Last month", value: (e) => (e.last ? STAGE[e.last.stage][1] : "not prepared"), translate: true, render: (e) => monthCell(data.prev, e.last, e) },
                { id: "current", label: "This month", value: (e) => (e.current ? STAGE[e.current.stage][1] : "not prepared"), translate: true, render: (e) => monthCell(data.period, e.current, e) },
              ]}
              filters={[
                {
                  id: "stage",
                  label: "Status",
                  value: (e) => [e.last?.stage ?? "none", e.current?.stage ?? "none"],
                  options: [...(Object.keys(STAGE) as GuardPayStage[]).map((k) => ({ value: k, label: STAGE[k][1] })), { value: "none", label: "Not prepared" }],
                },
              ]}
            />
          </div>
        )}
      </section>
      {data.runs.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>Pay runs</h3>
          </div>
          <div className="panel-body">
            {/* P107: every month's runs in one data table (month, status, company and "your turn" filters) in place of a panel per month. */}
            <DataTable
              label="Pay runs"
              stateKey="guardpay.runs"
              phoneFacts={5}
              rows={data.runs}
              rowKey={(r) => r.id}
              onRowClick={(r) => onOpen(r.id)}
              columns={[
                { id: "company", label: "Company", value: (r) => r.companyName, render: (r) => <strong>{r.companyName}</strong>, phone: "title" },
                { id: "month", label: "Month", value: (r) => r.period, sort: "date", render: (r) => monthLabel(r.period), phone: "sub" },
                { id: "headcount", label: "Guards and officers", value: (r) => r.totals.headcount, sort: "number", hideBelow: 1100 },
                { id: "gross", label: "Gross pay", value: (r) => r.totals.gross, sort: "money", render: (r) => rm(r.totals.gross), hideBelow: 1200 },
                { id: "net", label: "Net pay", value: (r) => r.totals.net, sort: "money", render: (r) => rm(r.totals.net) },
                { id: "cost", label: "Employer cost", value: (r) => r.totals.cost, sort: "money", render: (r) => rm(r.totals.cost), hideBelow: 1200 },
                {
                  id: "status",
                  label: "Status",
                  value: (r) => (r.late ? "Late" : STAGE[r.stage][1]),
                  translate: true,
                  render: (r) => (
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      {r.trial && <Chip tone="info">Trial</Chip>}
                      {r.mineToAct && <Chip tone="warn">Your turn</Chip>}
                      <Chip tone={r.late ? "crit" : STAGE[r.stage][0]}>{r.late ? "Late" : STAGE[r.stage][1]}</Chip>
                    </div>
                  ),
                },
              ]}
              filters={[
                { id: "month", label: "Month", value: (r) => r.period, optionLabel: monthLabel },
                { id: "stage", label: "Status", value: (r) => r.stage, optionLabel: (v) => STAGE[v as GuardPayStage]?.[1] ?? v },
                { id: "company", label: "Company", value: (r) => r.companyName },
                {
                  id: "only",
                  label: "Show only",
                  value: (r) => [r.mineToAct ? "mine" : "", r.late ? "late" : "", r.trial ? "trial" : ""],
                  options: [
                    { value: "mine", label: "Your turn" },
                    { value: "late", label: "Late" },
                    { value: "trial", label: "Trial" },
                  ],
                },
              ]}
            />
          </div>
        </section>
      )}
    </>
  );

  /** A company's month in the By company table: open its run, prepare it, or say it is not prepared (as before P107). */
  function monthCell(p: string, r: GuardPayBoard["employers"][number]["last"], e: GuardPayBoard["employers"][number]) {
    return r ? (
      <button className="btn btn-ghost btn-sm" onClick={() => onOpen(r.id)}>
        {monthLabel(p)}: <Chip tone={STAGE[r.stage][0]}>{STAGE[r.stage][1]}</Chip>
      </button>
    ) : e.prepares && data.on ? (
      <button className={`btn btn-sm${p === data.prev ? " btn-primary" : ""}`} disabled={act.busy} onClick={() => prepare(e.companyId, p)}>
        Prepare {monthLabel(p)}
      </button>
    ) : (
      <Chip tone="unknown">{monthLabel(p)}: not prepared</Chip>
    );
  }
}

function RunDrawer({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [tick, setTick] = useState(0);
  const { data, error } = useLoad(() => api.guardPayRun(runId), [runId, tick]);
  const [slip, setSlip] = useState<GuardPayLine | null>(null);
  return (
    <Drawer
      title={data ? `${data.companyName}, ${monthLabel(data.run.period)}` : "Guard pay"}
      sub={data ? (data.waitingOn ?? `Paid ${dateLabel(data.run.paid?.paidOn)}`) : undefined}
      onClose={onClose}
    >
      {error && <ErrorNotice error={error} />}
      {!data && !error && <Loading what="guard pay" />}
      {data && !slip && (
        <RunBody data={data} onSlip={setSlip} onChanged={() => setTick((n) => n + 1)} />
      )}
      {data && slip && (
        <>
          <button className="btn btn-ghost btn-sm" onClick={() => setSlip(null)}>
            Back to the list
          </button>
          <GuardPayslip
            line={slip}
            period={data.run.period}
            companyName={data.companyName}
            trial={data.run.trial}
          />
        </>
      )}
    </Drawer>
  );
}

function RunBody({
  data,
  onSlip,
  onChanged,
}: {
  data: GuardPayRunView;
  onSlip: (l: GuardPayLine) => void;
  onChanged: () => void;
}) {
  const { run, totals, can } = data;
  const act = useAction();
  const [note, setNote] = useState("");
  const [bankRef, setBankRef] = useState("");
  const [pcbChecked, setPcbChecked] = useState(false);
  const [filter, setFilter] = useState<"all" | "flagged">("flagged");
  const step = async (fn: () => Promise<unknown>, msg: string) => {
    if (await act.run(fn, msg)) onChanged();
  };
  const download = async (kind: GuardPayFile) => {
    const f = await act.run(
      () => api.guardPayExport(run.id, kind),
      run.trial ? "Trial file saved. Do not upload it." : "Draft file saved. Check it before it goes to the bank or the agency.",
    );
    if (!f) return;
    const url = URL.createObjectURL(new Blob([f.body], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = f.filename;
    a.click();
    URL.revokeObjectURL(url);
  };
  const steps: [string, (typeof run)["prepared"] | null][] = [
    ["Prepared by HR", run.prepared],
    ["Submitted by HR", run.submitted],
    ["Approved by the COO", run.approved],
    ["Paid by Finance", run.paid],
  ];
  const lines = filter === "flagged" ? run.lines.filter((l) => l.flags.length) : run.lines;
  return (
    <>
      {run.trial && (
        <div className="notice" data-tone="info">
          Trial beside the JA Group app: compare, do not pay.
        </div>
      )}
      {run.laterOf && (
        <div className="notice" data-tone="info">
          Later run for {run.period}: it pays only the guards whose absence waited for the OD/OGM decision. The rest of the month was paid in the company's own run.
        </div>
      )}
      {data.waiting.length > 0 && (
        <div className="notice" data-tone="warn">
          <strong>
            {data.waiting.length} guard{data.waiting.length === 1 ? "" : "s"} not in this run
          </strong>{" "}
          (only their pay waits; everyone else is paid here). Each is paid in a later run once the OD/OGM decides the absence.
          <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
            {data.waiting.map((w) => (
              <li key={w.personId}>
                {w.staffNo} {w.name}: {w.why.join(" ")}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.laterRuns.length > 0 && (
        <div className="muted small">
          Later runs this month:{" "}
          {data.laterRuns.map((r) => `${r.staffNos.join(", ") || "nobody"} (${r.stage})`).join("; ")}
        </div>
      )}
      <div className="kpis">
        <Kpi label="Guards and officers" value={totals.headcount} />
        <Kpi label="Net pay" value={rm(totals.net)} />
        <Kpi label="Employer cost" value={rm(totals.cost)} note="Gross, EPF, SOCSO, EIS, HRD" />
        <Kpi label="Overtime hours" value={totals.otHours.toLocaleString("en-MY")} />
      </div>
      {data.ja ? (
        <section className="panel">
          <div className="panel-head">
            <h3>Beside the JA Group app</h3>
            <span className="muted small">JA sent {dateTimeLabel(data.ja.receivedAt)} · {data.ja.status}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th className="num">Prima</th>
                  <th className="num">JA</th>
                  <th className="num">Difference</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Headcount</td>
                  <td className="num">{totals.headcount}</td>
                  <td className="num">{data.ja.headcount}</td>
                  <td className="num">{data.ja.diffHeadcount}</td>
                </tr>
                <tr>
                  <td>Gross</td>
                  <td className="num">{rm(totals.gross)}</td>
                  <td className="num">{rm(data.ja.gross)}</td>
                  <td className="num">{rm(data.ja.diffGross)}</td>
                </tr>
                <tr>
                  <td>Net</td>
                  <td className="num">{rm(totals.net)}</td>
                  <td className="num">{rm(data.ja.net)}</td>
                  <td className="num">{rm(data.ja.diffNet)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        run.trial && (
          <div className="notice" data-tone="unknown">
            JA has not sent its payroll for this company and month, so there
            is nothing to compare yet.
          </div>
        )
      )}
      <section className="panel">
        <div className="panel-head">
          <h3>Steps</h3>
        </div>
        <div className="list">
          {steps.map(([label, s]) => (
            <div key={label} className="list-item">
              <div>{label}</div>
              <span className="muted small">
                {s ? `${s.by} · ${dateTimeLabel(s.at)}${s.note ? ` · ${s.note}` : ""}` : "Not yet"}
              </span>
            </div>
          ))}
          {run.paid && (
            <div className="muted small">
              Bank reference {run.paid.bankRef}, paid {dateLabel(run.paid.paidOn)}, PCB checked in e-PCB.
            </div>
          )}
          {run.returns.map((r) => (
            <div key={r.at} className="notice" data-tone="warn">
              Returned by {r.by} on {dateTimeLabel(r.at)}: {r.note}
            </div>
          ))}
        </div>
      </section>
      <PayOut data={data} onChanged={onChanged} />
      {(run.sitesOver ?? []).length > 0 && (
        <div className="notice" data-tone="warn">
          Over their man-hours without approval:{" "}
          {(run.sitesOver ?? []).map((o) => `${o.siteName} (+${o.overBy} h, ${o.approver === "ogm" ? "OGM" : "Operations Director"})`).join(", ")}.
          Wages are still due by the {dateLabel(data.payBy)}; ask the approver to approve or explain the hours.
        </div>
      )}
      <Holidays data={data} onChanged={onChanged} />
      <ErrorNotice error={act.error} />
      {(can.submit || can.approve || can.pay || can.return || can.prepare) && (
        <section className="panel">
          <div className="panel-head">
            <h3>Your step</h3>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.monthOpen && can.submit && (
              <p className="muted small">
                The month is not over yet. Prepare it to see how it stands;
                submit it once the last day is worked and locked.
              </p>
            )}
            {can.pay && (
              <>
                <input
                  className="input"
                  aria-label="Bank reference"
                  placeholder="Bank payment reference"
                  value={bankRef}
                  onChange={(e) => setBankRef(e.target.value)}
                />
                <label className="row small" style={{ gap: 6 }}>
                  <input type="checkbox" checked={pcbChecked} onChange={(e) => setPcbChecked(e.target.checked)} />
                  PCB checked against LHDN e-PCB for every line
                </label>
              </>
            )}
            {(can.approve || can.return) && (
              <input
                className="input"
                aria-label="Reason"
                placeholder={can.approve ? "Reason or comment (needed to approve or return)" : "What needs to change (to return)"}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {can.prepare && (
                <button
                  className="btn btn-sm"
                  disabled={act.busy}
                  onClick={() =>
                    step(
                      () => (run.laterOf ? api.prepareGuardPayLater(run.laterOf) : api.prepareGuardPay(run.companyId, run.period)),
                      "Recalculated from the latest attendance.",
                    )
                  }
                >
                  Recalculate
                </button>
              )}
              {can.prepareLater && (
                <button
                  className="btn btn-sm"
                  disabled={act.busy}
                  onClick={() => step(() => api.prepareGuardPayLater(run.id), "Later run prepared for the guards whose absence is now decided.")}
                >
                  Pay decided guards in a later run
                </button>
              )}
              {can.submit && (
                <button
                  className="btn btn-primary btn-sm"
                  disabled={act.busy || data.monthOpen}
                  onClick={() => step(() => api.guardPayStep(run.id, "submit", {}), "Sent to the COO.")}
                >
                  Submit to the COO
                </button>
              )}
              {can.approve && (
                <button
                  className="btn btn-primary btn-sm"
                  disabled={act.busy || note.trim().length < 3}
                  onClick={() => step(() => api.guardPayStep(run.id, "approve", { note }), run.trial ? "Approved as a trial." : "Approved, Finance can pay.")}
                >
                  Approve
                </button>
              )}
              {can.pay && (
                <button
                  className="btn btn-primary btn-sm"
                  disabled={act.busy || !bankRef.trim() || !pcbChecked}
                  onClick={() => step(() => api.guardPayStep(run.id, "pay", { bankRef, pcbChecked }), "Marked paid.")}
                >
                  Mark paid
                </button>
              )}
              {can.return && (
                <button
                  className="btn btn-sm"
                  disabled={act.busy || !note.trim()}
                  onClick={() => step(() => api.guardPayStep(run.id, "return", { note }), "Returned to HR.")}
                >
                  Return to HR
                </button>
              )}
            </div>
          </div>
        </section>
      )}
      {can.export && (
        <section className="panel">
          <div className="panel-head">
            <h3>{run.trial ? "Trial files (do not upload)" : "Draft files for Finance"}</h3>
          </div>
          <p className="small">
            Control total: {data.control.count} payments, {rm(data.control.net)}, check code{" "}
            <span className="mono">{data.control.code}</span>. Only Finance takes the bank file.
          </p>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {FILES.filter(([k]) => (k !== "bank" && k !== "ewallet") || can.bankFile)
              .filter(([k]) => k !== "ewallet" || data.pay.ewallet.count > 0)
              .map(([k, label]) => (
              <button key={k} className="btn btn-sm" disabled={act.busy} onClick={() => download(k)}>
                {label}
              </button>
            ))}
            {can.cashFile && (
              <button className="btn btn-sm" disabled={act.busy} onClick={() => download("cash")}>
                Cash list (CEO approval)
              </button>
            )}
          </div>
        </section>
      )}
      {!can.export && can.cashFile && (
        <button className="btn btn-sm" disabled={act.busy} onClick={() => download("cash")}>
          Cash list (CEO approval)
        </button>
      )}
      <section className="panel">
        <div className="panel-head">
          <h3>Guards and officers</h3>
          <span className="muted small">
            EPF {rm(totals.epf)} · SOCSO {rm(totals.socso)} · LINDUNG {rm(totals.lindung)} · EIS {rm(totals.eis)} · PCB {rm(totals.pcb)}
          </span>
        </div>
        <div className="tabbar" role="tablist" aria-label="Lines">
          <button role="tab" aria-selected={filter === "flagged"} onClick={() => setFilter("flagged")}>
            To check ({totals.flagged})
          </button>
          <button role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")}>
            All ({totals.headcount})
          </button>
        </div>
        {/* P107: a data table (search by name, staff number or formula; site and formula filters; sort; pages; cards on a
            phone). The To check / All tabs still choose the rows; a line opens its payslip as before. */}
        <div className="panel-body">
          <DataTable
            label="Guards and officers"
            stateKey={`guardpay.lines.${run.id}`}
            rows={lines}
            rowKey={(l) => l.personId}
            onRowClick={onSlip}
            searchText={(l) => `${l.staffNo} ${l.formulaCode ?? ""}`}
            empty={<div className="empty">Nothing to check.</div>}
            columns={[
              {
                id: "name",
                label: "Name",
                value: (l) => l.name,
                render: (l) => (
                  <>
                    <span style={{ fontWeight: 600 }}>{l.name}</span> <span className="muted small">{l.staffNo}</span>
                  </>
                ),
                phone: "title",
              },
              {
                id: "site",
                label: "Site",
                value: (l) => l.mainSiteName || "no shifts",
                render: (l) => (
                  <>
                    {l.mainSiteName || "no shifts"}
                    <div className="muted small">{l.formulaCode ?? "No formula"}</div>
                  </>
                ),
                phone: "sub",
              },
              {
                id: "days",
                label: "Days",
                value: (l) => l.daysWorked,
                sort: "number",
                render: (l) => (
                  <>
                    {l.daysWorked}{" "}
                    <span className="muted small">
                      ({l.restDaysWorked} rest, {l.holidaysWorked} holiday)
                    </span>
                  </>
                ),
              },
              { id: "ot", label: "Overtime hours", value: (l) => l.otHours, sort: "number" },
              { id: "gross", label: "Gross pay", value: (l) => l.gross, sort: "money", render: (l) => rm(l.gross) },
              { id: "net", label: "Net pay", value: (l) => l.net, sort: "money", render: (l) => <span style={{ fontWeight: 600 }}>{rm(l.net)}</span> },
            ]}
            filters={[
              { id: "site", label: "Site", value: (l) => l.mainSiteName || "no shifts" },
              { id: "formula", label: "Formula", value: (l) => l.formulaCode ?? "No formula" },
            ]}
            rowDetail={(l) => {
              const consent = data.role === "hr" && (l.accountProblem || (l.bank && (l.bank.holder ?? "own") !== "own") || l.bank?.kind === "ewallet");
              if (!l.hours && !l.flags.length && !(l.exceptions ?? []).length && !can.prepare && !consent) return null;
              return (
                <div data-no-row-click style={{ display: "grid", gap: 4, minWidth: 0 }}>
                  {l.hours && <HoursLine h={l.hours} />}
                  {l.flags.map((f) => (
                    <div key={f} className="small" style={{ color: "var(--warn, #b45309)" }}>
                      {f}
                    </div>
                  ))}
                  {(l.exceptions ?? []).length > 0 && (
                    <div className="small" style={{ marginTop: 4 }}>
                      <strong>Exception list</strong> (the rest of the month is paid)
                      <ul style={{ margin: "2px 0 0 18px", padding: 0 }}>
                        {(l.exceptions ?? []).map((x) => (
                          <li key={x}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {can.prepare && <LineEdit runId={run.id} line={l} onChanged={onChanged} />}
                  {consent && <ConsentEdit line={l} onChanged={onChanged} />}
                </div>
              );
            }}
          />
        </div>
      </section>
    </>
  );
}

/**
 * Public holidays for the month. Guard holidays come from the yearly lists the Operations Director or OGM set (per
 * state); HR enters them here only for a company with no yearly list. Staff holidays are separate.
 */
function Holidays({ data, onChanged }: { data: GuardPayRunView; onChanged: () => void }) {
  const { run, can } = data;
  if (run.holidaySource === "yearly") {
    const dates = [...new Set(run.lines.flatMap((l) => l.holidayDates ?? []))].sort();
    const lost = run.lines.reduce((n, l) => n + (l.holidaysLost?.length ?? 0), 0);
    return (
      <section className="panel">
        <div className="panel-head">
          <h3>Public holidays in {monthLabel(run.period)}</h3>
        </div>
        <p className="muted small">
          From the guard public holiday lists the Operations Director or the OGM set for the year (each site's state, else
          the whole company). Staff holidays are separate. Change the list under Site man-hours, Public holidays, then recalculate.
        </p>
        {dates.length ? (
          <div className="list">
            {dates.map((d) => (
              <div key={d} className="list-item">
                {dateLabel(d)}
              </div>
            ))}
          </div>
        ) : (
          <p className="small">No guard public holiday this month.</p>
        )}
        {lost > 0 && (
          <p className="small" style={{ color: "var(--warn, #b45309)" }}>
            {lost} holiday{lost === 1 ? "" : "s"} not paid: absent without leave on the working day before or after (EA s.60D(2)).
          </p>
        )}
      </section>
    );
  }
  const act = useAction();
  const [date, setDate] = useState("");
  const [label, setLabel] = useState("");
  const save = async (list: { date: string; label: string }[]) => {
    if (await act.run(() => api.prepareGuardPay(run.companyId, run.period, list), "Holidays saved and the month recalculated.")) {
      setDate("");
      setLabel("");
      onChanged();
    }
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Public holidays in {monthLabel(run.period)}</h3>
      </div>
      {!run.holidays.length && (
        <p className="muted small">
          None entered. HR enters the gazetted holidays for the company's states; until then no day is paid at the holiday rate.
        </p>
      )}
      <div className="list">
        {run.holidays.map((h) => (
          <div key={h.date} className="list-item">
            <span>
              {dateLabel(h.date)} · {h.label}
            </span>
            {can.prepare && (
              <button
                className="btn btn-ghost btn-sm"
                disabled={act.busy}
                onClick={() => save(run.holidays.filter((x) => x.date !== h.date))}
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
      {can.prepare && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          <input
            className="input"
            type="date"
            aria-label="Holiday date"
            min={`${run.period}-01`}
            max={`${run.period}-${String(new Date(Date.UTC(Number(run.period.slice(0, 4)), Number(run.period.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ maxWidth: 170 }}
          />
          <input
            className="input"
            aria-label="Holiday name"
            placeholder="Name as gazetted"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            style={{ maxWidth: 220 }}
          />
          <button
            className="btn btn-sm"
            disabled={act.busy || !date || !label.trim()}
            onClick={() => save([...run.holidays, { date, label: label.trim() }])}
          >
            Add holiday
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}

function LineEdit({ runId, line, onChanged }: { runId: string; line: GuardPayLine; onChanged: () => void }) {
  const act = useAction();
  const [pcb, setPcb] = useState(line.pcbSource === "entered" ? String(line.pcb) : "");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [uniformNo, setUniformNo] = useState("");
  const extra = line.items.filter((x) => x.kind === "extra").map((x) => ({ label: x.label, amount: x.amount }));
  const save = async (patch: Parameters<typeof api.setGuardPayLine>[2], msg: string) => {
    if (await act.run(() => api.setGuardPayLine(runId, line.personId, patch), msg)) onChanged();
  };
  return (
    <details>
      <summary className="small">PCB or one-off item</summary>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 4 }}>
        <input
          className="input"
          style={{ maxWidth: 150 }}
          aria-label={`PCB for ${line.name}`}
          inputMode="decimal"
          placeholder="PCB from e-PCB"
          value={pcb}
          onChange={(e) => setPcb(e.target.value)}
        />
        <button
          className="btn btn-sm"
          disabled={act.busy}
          onClick={() => save({ pcb: pcb.trim() === "" ? null : Number(pcb) }, "PCB saved.")}
        >
          {pcb.trim() === "" ? "Use estimate" : "Save PCB"}
        </button>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 4 }}>
        <input
          className="input"
          style={{ maxWidth: 220 }}
          aria-label="One-off item and reason"
          placeholder="Item and reason"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <input
          className="input"
          style={{ maxWidth: 120 }}
          aria-label="Amount"
          inputMode="decimal"
          placeholder="RM (minus to deduct)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <select className="input" style={{ maxWidth: 190 }} aria-label="Uniform" value={uniformNo} onChange={(e) => setUniformNo(e.target.value)}>
          <option value="">Not a uniform</option>
          <option value="4">4th uniform (guard pays)</option>
          <option value="5">5th uniform (guard pays)</option>
        </select>
        <button
          className="btn btn-sm"
          disabled={act.busy || !label.trim() || !amount.trim()}
          onClick={() => save({ extra: [...extra, { label: label.trim(), amount: Number(amount), uniformNo: uniformNo ? Number(uniformNo) : undefined }] }, "Item added. The COO sees it flagged.")}
        >
          Add
        </button>
        {extra.length > 0 && (
          <button className="btn btn-ghost btn-sm" disabled={act.busy} onClick={() => save({ extra: [] }, "One-off items removed.")}>
            Remove one-off items
          </button>
        )}
      </div>
      <ErrorNotice error={act.error} />
    </details>
  );
}

/** One guard's payslip: every line with how it is worked out, deductions, and what the employer pays on top. */
export function GuardPayslip({
  line: l,
  period,
  companyName,
  trial,
}: {
  line: GuardPayLine;
  period: string;
  companyName: string;
  trial?: boolean;
}) {
  const row = (label: string, amount: number, how?: string, minus = false) => (
    <div key={label} className="list-item" style={{ gap: 8 }}>
      <span>
        {label}
        {how && <span className="muted small"> · {how}</span>}
      </span>
      <span>{minus && amount ? `(${rm(amount)})` : rm(amount)}</span>
    </div>
  );
  return (
    <section className="panel">
      {trial && (
        <div className="notice" data-tone="info">
          Trial payslip to compare with the JA Group app. Not paid from Prima.
        </div>
      )}
      <div className="panel-head">
        <h3>
          {l.name} · {l.staffNo}
        </h3>
        <span className="muted small">
          {companyName} · {monthLabel(period)} · {l.mainSiteName || "no shifts"}
        </span>
      </div>
      <p className="muted small">
        {l.formulaName}
        {l.formulaCode ? ` (${l.formulaCode} v${l.formulaVersion}, ${l.formulaScope})` : ""} · daily rate {rm(l.dailyRate)} (basic ÷ 26) · hourly{" "}
        {rm(l.hourlyRate)} · {l.daysWorked} days worked, {l.paidLeaveDays} paid leave, full month {l.fullMonthDays}
      </p>
      {l.hours && <HoursLine h={l.hours} full />}
      <div className="list">
        {l.items.filter((x) => !(x.kind === "extra" && x.amount < 0) && x.kind !== "advance").map((x) =>
          row(
            x.label,
            Math.abs(x.amount),
            x.qty != null && x.rate != null ? `${x.qty} ${x.unit}${x.qty === 1 ? "" : "s"} × ${rm(Math.abs(x.rate))}` : undefined,
            x.amount < 0,
          ),
        )}
        {row("Gross pay", l.gross)}
        {row("EPF (employee)", l.epfEe, `on ${rm(l.epfWages)}, overtime not included`, true)}
        {row("SOCSO (employee)", l.socsoEe, undefined, true)}
        {l.lindungStatus === "opted_out" ? (
          <div className="list-item">
            <span>LINDUNG 24 Jam</span>
            <span className="muted">Opted out</span>
          </div>
        ) : (
          l.lindungStatus === "deducted" && row(`LINDUNG 24 Jam (${(l.lindungRate * 100).toFixed(2)}%)`, l.lindungEe, undefined, true)
        )}
        {l.nationality === "MY" && row("EIS (employee)", l.eisEe, undefined, true)}
        {(l.others ?? []).filter((o) => o.ee > 0).map((o) => row(`${o.name} (employee)`, o.ee, undefined, true))}
        {row(l.pcbSource === "estimate" ? "PCB (estimate)" : "PCB", l.pcb, undefined, true)}
        {l.utility > 0 && row("Hostel utility (approved)", l.utility, undefined, true)}
        {l.items.filter((x) => x.kind === "extra" && x.amount < 0).map((x) => row(x.label, -x.amount, "one-off deduction", true))}
        {l.items.filter((x) => x.kind === "advance").map((x) => row(x.label, -x.amount, "advance taken back", true))}
        {l.items.filter((x) => x.kind === "arrival").map((x) => row(x.label, -x.amount, "arrival advance recovery under reviewed cap", true))}
        {l.items.filter((x) => x.kind === "loan").map((x) => row(x.label, -x.amount, "repayment (within 50% of wages)", true))}
        <div className="list-item" style={{ fontWeight: 700 }}>
          <span>Net pay</span>
          <span>{rm(l.net)}</span>
        </div>
      </div>
      <p className="muted small">
        Paid by your employer on top: EPF {rm(l.epfEr)}, SOCSO {rm(l.socsoEr)}
        {l.nationality === "MY" ? `, EIS ${rm(l.eisEr)}` : ""}
        {(l.others ?? []).filter((o) => o.er > 0).map((o) => `, ${o.name} ${rm(o.er)}`).join("")}.{" "}
        {l.bank
          ? `Paid to ${l.bank.kind === "ewallet" ? "e-wallet " : ""}${l.bank.bank} ${l.bank.accountMasked}${
              l.bank.holder === "relative" || l.bank.holder === "friend" ? ` (${l.bank.holderName ?? "account holder"}, ${l.bank.relationship ?? l.bank.holder}, with your written consent)` : ""
            }.`
          : "No bank account or e-wallet on record."}
        {(l.holidaysLost ?? []).length > 0 && ` Public holiday not paid: ${(l.holidaysLost ?? []).map((d) => dateLabel(d)).join(", ")} (absent without leave next to it).`}
      </p>
    </section>
  );
}

/** A guard's or officer's own payslips, on their Duty screen. Paid months only. */
export function MyGuardPayslips() {
  const { data, error } = useLoad(() => api.myGuardPayslips(), []);
  const [open, setOpen] = useState<number | null>(null);
  if (error) return null;
  if (!data) return null;
  const slip = open == null ? null : data.payslips[open];
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>My payslips</h3>
      </div>
      {!data.payslips.length ? (
        <div className="empty">No payslips here yet. Your pay still comes from the JA Group app.</div>
      ) : (
        <div className="list">
          {data.payslips.map((m, i) => (
            <button key={m.runId} className="list-item" style={{ width: "100%", textAlign: "left" }} onClick={() => setOpen(i)}>
              <div>
                <div style={{ fontWeight: 600 }}>{monthLabel(m.period)}</div>
                <div className="muted small">Paid {dateLabel(m.paidOn)}</div>
              </div>
              <span style={{ fontWeight: 600 }}>{rm(m.line.net)}</span>
            </button>
          ))}
        </div>
      )}
      {slip && (
        <Drawer title={`Payslip, ${monthLabel(slip.period)}`} sub={slip.companyName} onClose={() => setOpen(null)}>
          <GuardPayslip line={slip.line} period={slip.period} companyName={slip.companyName} />
        </Drawer>
      )}
    </section>
  );
}

/**
 * How the month is paid (Fauzan, 6 Nov 2026): bank account or e-wallet only. A guard with no usable account is paid in
 * cash only when the Director Office lists them and the COO or the CEO gives it.
 */
function PayOut({ data, onChanged }: { data: GuardPayRunView; onChanged: () => void }) {
  const { run, can, pay } = data;
  const act = useAction();
  const [reason, setReason] = useState<Record<string, string>>({});
  const cash = run.cash ?? [];
  // P107: the cash list in its usual order (by site, then staff number), and each guard's main site for the unpayable table.
  const cashRows = [...cash].sort((a, b) => (a.siteName ?? "").localeCompare(b.siteName ?? "") || a.staffNo.localeCompare(b.staffNo));
  const siteOf = (personId: string) => run.lines.find((l) => l.personId === personId)?.mainSiteName || null;
  const go = async (personId: string, action: "list" | "unlist" | "supersede" | "decide", give?: boolean) => {
    if (await act.run(() => api.guardPayCash(run.id, personId, action, { reason: reason[personId] ?? "", give }), action === "decide" ? "Decision recorded." : "Cash list updated.")) {
      setReason((r) => ({ ...r, [personId]: "" }));
      onChanged();
    }
  };
  const field = (personId: string, placeholder: string) => (
    <input
      className="input"
      style={{ maxWidth: 260 }}
      aria-label={placeholder}
      placeholder={placeholder}
      value={reason[personId] ?? ""}
      onChange={(e) => setReason((r) => ({ ...r, [personId]: e.target.value }))}
    />
  );
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>How it is paid</h3>
        <span className="muted small">Due by {dateLabel(data.payBy)} (EA s.19)</span>
      </div>
      <p className="small">
        Bank: {pay.bank.count} guards, {rm(pay.bank.net)} · E-wallet: {pay.ewallet.count}, {rm(pay.ewallet.net)} · Wage cash:{" "}
        {pay.cash.count}, {rm(pay.cash.net)}
      </p>
      <p className="muted small">
        Wages use a verified bank account or e-wallet, or the Director Office lists the named wage amount for CEO approval. Only the CEO approves wage cash; the CEO or COO hands it over and Director Office uploads the genuine receipt. Additional DOA support is separate and never deducted from ordinary wages.
      </p>
      {pay.unpayable.length > 0 && (
        // P107: a data table (search, site filter, sort, pages; cards on a phone); the cash listing form sits under each row.
        <div className="panel-body">
          <DataTable
            label="Cannot be paid into an account"
            stateKey={`guardpay.unpayable.${run.id}`}
            rows={pay.unpayable}
            rowKey={(u) => u.personId}
            searchText={(u) => u.staffNo}
            columns={[
              {
                id: "name",
                label: "Name",
                value: (u) => u.name,
                render: (u) => (
                  <>
                    <span style={{ fontWeight: 600 }}>{u.name}</span> <span className="muted small">{u.staffNo}</span>
                  </>
                ),
                phone: "title",
              },
              { id: "site", label: "Site", value: (u) => siteOf(u.personId) },
              { id: "problem", label: "Problem", value: (u) => u.problem, render: (u) => <span className="small" style={{ color: "var(--warn, #b45309)" }}>{u.problem}</span> },
              { id: "net", label: "Net pay", value: (u) => u.net, sort: "money", render: (u) => rm(u.net) },
            ]}
            filters={[
              { id: "site", label: "Site", value: (u) => siteOf(u.personId) },
              { id: "problem", label: "Problem", value: (u) => u.problem },
            ]}
            rowDetail={
              can.listCash
                ? (u) => (
                    <div className="row" data-no-row-click style={{ gap: 6, flexWrap: "wrap" }}>
                      {field(u.personId, "Why this guard needs cash")}
                      <button className="btn btn-sm" disabled={act.busy || (reason[u.personId] ?? "").trim().length < 5} onClick={() => go(u.personId, "list")}>
                        List for cash
                      </button>
                    </div>
                  )
                : undefined
            }
          />
        </div>
      )}
      {cash.length > 0 && (
        <>
          <h4 className="small" style={{ marginTop: 8 }}>
            Cash list (Director Office)
          </h4>
          {pay.cashBySite.length > 0 && (
            <p className="muted small">
              By site: {pay.cashBySite.map((x) => `${x.site} ${x.count} (${rm(x.net)})`).join(" · ")} · handed out {pay.cashHandedOut}/{pay.cash.count} · signed receipts{" "}
              {pay.cashReceipts}/{pay.cash.count}
            </p>
          )}
          {/* P107: a data table (search, site, decision and receipt filters, sort, pages; cards on a phone). Each row's
              decision, take-off, replace, hand-out and receipt steps sit under it with the same permission checks as before. */}
          <div className="panel-body">
            <DataTable
              label="Cash list (Director Office)"
              stateKey={`guardpay.cash.${run.id}`}
              rows={cashRows}
              rowKey={(c) => c.personId}
              searchText={(c) => `${c.staffNo} ${c.reason}`}
              columns={[
                {
                  id: "name",
                  label: "Name",
                  value: (c) => c.name,
                  render: (c) => (
                    <>
                      <span style={{ fontWeight: 600 }}>{c.name}</span> <span className="muted small">{c.staffNo}</span>
                    </>
                  ),
                  phone: "title",
                },
                { id: "site", label: "Site", value: (c) => c.siteName ?? null },
                { id: "amount", label: "Amount", value: (c) => c.amount ?? null, sort: "money", render: (c) => (c.amount != null ? rm(c.amount) : "\u2013") },
                {
                  id: "decision",
                  label: "Decision",
                  value: (c) => (c.decision ? (c.decision.give ? "Cash given" : "Cash refused") : null),
                  translate: true,
                  render: (c) =>
                    c.decision ? (
                      <span className="small">
                        {c.decision.give ? "Cash given" : "Cash refused"} by the {c.decision.tier.toUpperCase()} ({c.decision.by}): {c.decision.note}
                      </span>
                    ) : !can.decideCash ? (
                      <Chip tone="warn">Waiting for the CEO</Chip>
                    ) : (
                      "\u2013"
                    ),
                },
              ]}
              filters={[
                { id: "site", label: "Site", value: (c) => c.siteName ?? null },
                {
                  id: "decision",
                  label: "Decision",
                  value: (c) => (c.decision ? (c.decision.give ? "given" : "refused") : "waiting"),
                  options: [
                    { value: "waiting", label: "Undecided" },
                    { value: "given", label: "Cash given" },
                    { value: "refused", label: "Cash refused" },
                  ],
                },
                {
                  id: "receipt",
                  label: "Signed receipt",
                  value: (c) => (c.receipt ? "yes" : c.decision?.give ? "no" : null),
                  options: [
                    { value: "yes", label: "Uploaded" },
                    { value: "no", label: "Not uploaded" },
                  ],
                },
              ]}
              rowDetail={(c) => (
                <div data-no-row-click style={{ display: "grid", gap: 6, minWidth: 0 }}>
                  <div className="muted small">
                    Listed by {c.listedBy}: {c.reason}
                  </div>
                  {!c.decision && can.decideCash && (
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      {field(c.personId, "Reason or comment")}
                      <button className="btn btn-primary btn-sm" disabled={act.busy || (reason[c.personId] ?? "").trim().length < 3} onClick={() => go(c.personId, "decide", true)}>
                        Give cash
                      </button>
                      <button className="btn btn-sm" disabled={act.busy || (reason[c.personId] ?? "").trim().length < 3} onClick={() => go(c.personId, "decide", false)}>
                        Refuse
                      </button>
                    </div>
                  )}
                  {!c.decision && can.listCash && (
                    <div>
                      <button className="btn btn-ghost btn-sm" disabled={act.busy} onClick={() => go(c.personId, "unlist")}>
                        Take off the list
                      </button>
                    </div>
                  )}
                  {can.listCash && !run.paid && !c.handedOut && !c.receipt && (c.decision || c.amount !== run.lines.find(l => l.personId === c.personId)?.net || c.approvedSiteId !== run.lines.find(l => l.personId === c.personId)?.mainSiteId || c.approvalVersion !== 2) && (
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      {field(c.personId, "Reason for replacing unpaid cash listing")}
                      <button className="btn btn-sm" disabled={act.busy || (reason[c.personId] ?? "").trim().length < 5} onClick={() => go(c.personId, "supersede")}>
                        Replace and request fresh CEO approval
                      </button>
                    </div>
                  )}
                  {c.decision?.give && <CashHandOut runId={run.id} c={c} canHandOut={can.handOutCash} canUpload={can.uploadReceipt} onChanged={onChanged} />}
                </div>
              )}
            />
          </div>
        </>
      )}
      {!!run.cashHistory?.length && <details>
        <summary>Previous unpaid cash listings ({run.cashHistory.length})</summary>
        {run.cashHistory.map((h, i) => <p className="small" key={i}>
          {h.entry.staffNo} · {rm(h.entry.amount ?? 0)} · {h.entry.siteName || 'No site'} · {h.entry.decision ? `${h.entry.decision.give ? 'Approved' : 'Refused'} by ${h.entry.decision.by}: ${h.entry.decision.note}` : 'Undecided'}.
          {' '}Replaced by {h.superseded.by} at {h.superseded.at}: {h.superseded.note}
        </p>)}
      </details>}
      <ErrorNotice error={act.error} />
    </section>
  );
}

/** The CEO or COO hands the cash out; the Director Office uploads the guard's signed receipt paper (Fauzan, 6 Nov 2026). */
function CashHandOut({
  runId,
  c,
  canHandOut,
  canUpload,
  onChanged,
}: {
  runId: string;
  c: NonNullable<GuardPayRunView["run"]["cash"]>[number];
  canHandOut: boolean;
  canUpload: boolean;
  onChanged: () => void;
}) {
  const act = useAction();
  const [on, setOn] = useState(new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10));
  const [proof, setProof] = useState<ProofInput[]>([]);
  const [genuine, setGenuine] = useState(false);
  return (
    <div style={{ width: "100%" }}>
      {c.handedOut ? (
        <div className="small">
          Handed out on {dateLabel(c.handedOut.on)} by the {c.handedOut.tier.toUpperCase()} ({c.handedOut.by})
        </div>
      ) : canHandOut ? (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <input className="input" type="date" style={{ maxWidth: 170 }} aria-label="Date handed out" value={on} onChange={(e) => setOn(e.target.value)} />
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy}
            onClick={async () => {
              if (await act.run(() => api.guardPayCash(runId, c.personId, "handout", { on }), "Recorded as handed out. The Director Office uploads the signed receipt.")) onChanged();
            }}
          >
            Cash handed out
          </button>
        </div>
      ) : (
        <Chip tone="warn">Waiting for the CEO or COO to hand out</Chip>
      )}
      {c.receipt ? (
        <div className="small">
          Signed receipt uploaded by {c.receipt.uploadedBy}: {c.receipt.name}
        </div>
      ) : c.handedOut && canUpload ? (
        <div>
          <label><input type="checkbox" checked={genuine} onChange={e=>setGenuine(e.target.checked)} /> Genuine acknowledgement supplied for this worker, wage month and amount; no stored signature pasted.</label>
          <ProofPicker site={null} refText={`Cash receipt ${c.staffNo}`} items={proof} onChange={setProof} documentsOnly required />
          <button
            className="btn btn-sm"
            disabled={act.busy || proof.length !== 1 || !genuine}
            onClick={async () => {
              if (await act.run(() => api.guardPayCash(runId, c.personId, "receipt", { proof, transactionSpecific: genuine, signedByPersonId: c.personId, amount: c.amount }), "Signed receipt uploaded.")) {
                setProof([]);
                onChanged();
              }
            }}
          >
            Upload signed receipt
          </button>
        </div>
      ) : c.handedOut ? (
        <Chip tone="warn">Signed receipt not uploaded yet (Director Office)</Chip>
      ) : null}
      <ErrorNotice error={act.error} />
    </div>
  );
}

/** HR records whose account it is and the guard's signed written consent for someone else's account. */
function ConsentEdit({ line, onChanged }: { line: GuardPayLine; onChanged: () => void }) {
  const act = useAction();
  const b = line.bank;
  const [holder, setHolder] = useState<string>(b?.holder ?? "own");
  const [kind, setKind] = useState<string>(b?.kind ?? "bank");
  const [holderName, setHolderName] = useState(b?.holderName ?? "");
  const [relationship, setRelationship] = useState(b?.relationship ?? "");
  const [docRef, setDocRef] = useState(b?.consent?.docRef ?? "");
  const [signedOn, setSignedOn] = useState(b?.consent?.signedOn ?? "");
  const [commissioner, setCommissioner] = useState(b?.consent?.oaths?.commissioner ?? "");
  const [stampRef, setStampRef] = useState(b?.consent?.oaths?.stampRef ?? "");
  const [stampedOn, setStampedOn] = useState(b?.consent?.oaths?.stampedOn ?? "");
  if (!b) return <div className="muted small">No account on record: add a verified payment account or ask Director Office to list the named wage amount for CEO cash approval.</div>;
  const other = holder === "relative" || holder === "friend";
  return (
    <details>
      <summary className="small">Whose account, and written consent</summary>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 4 }}>
        <select className="input" style={{ maxWidth: 170 }} aria-label="Account type" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="bank">Bank account</option>
          <option value="ewallet">E-wallet</option>
        </select>
        <select className="input" style={{ maxWidth: 200 }} aria-label="Whose account" value={holder} onChange={(e) => setHolder(e.target.value)}>
          <option value="own">The guard's own</option>
          <option value="joint">Joint with the guard</option>
          <option value="relative">Immediate relative's</option>
          <option value="friend">Close friend's</option>
        </select>
        {other && (
          <>
            <input className="input" style={{ maxWidth: 180 }} aria-label="Account holder" placeholder="Account holder's name" value={holderName} onChange={(e) => setHolderName(e.target.value)} />
            <input className="input" style={{ maxWidth: 140 }} aria-label="Relationship" placeholder="Relationship" value={relationship} onChange={(e) => setRelationship(e.target.value)} />
            <input className="input" style={{ maxWidth: 160 }} aria-label="Consent form reference" placeholder="Consent form ref" value={docRef} onChange={(e) => setDocRef(e.target.value)} />
            <input className="input" type="date" style={{ maxWidth: 170 }} aria-label="Date signed" value={signedOn} onChange={(e) => setSignedOn(e.target.value)} />
            <input className="input" style={{ maxWidth: 200 }} aria-label="Commissioner for Oaths" placeholder="Commissioner for Oaths (name)" value={commissioner} onChange={(e) => setCommissioner(e.target.value)} />
            <input className="input" style={{ maxWidth: 140 }} aria-label="Stamp number" placeholder="Stamp number" value={stampRef} onChange={(e) => setStampRef(e.target.value)} />
            <input className="input" type="date" style={{ maxWidth: 170 }} aria-label="Date stamped" value={stampedOn} onChange={(e) => setStampedOn(e.target.value)} />
          </>
        )}
        <button
          className="btn btn-sm"
          disabled={act.busy || (other && (!holderName.trim() || !relationship.trim() || !docRef.trim() || !signedOn || !commissioner.trim() || !stampRef.trim() || !stampedOn))}
          onClick={async () => {
            if (
              await act.run(
                () => api.recordPayConsent(line.personId, { holder, kind, holderName, relationship, docRef, signedOn, commissioner, stampRef, stampedOn }),
                other ? "Recorded. The COO approves the letter before the account is used." : "Recorded. Recalculate the month to update the line.",
              )
            )
              onChanged();
          }}
        >
          Save
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </details>
  );
}

const STATUS: Record<string, [Tone, string]> = {
  pending: ["warn", "Waiting for approval"],
  approved: ["info", "Approved"],
  paid: ["ok", "Paid"],
  cancelled: ["neutral", "Cancelled"],
};

/**
 * Wage advances (Fauzan, 6 Nov 2026): usually paid on the 20th. The OM sets the amount and date for one guard or in
 * bulk for a site, zone or region; the Operations Director (private) or the OGM (government) approves once, and any
 * change needs one more approval. The month's pay takes the advance back.
 */
export function GuardAdvancesView() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [period, setPeriod] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const { data, error } = useLoad(() => api.guardAdvances({ companyId, period }), [companyId, period, tick]);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="advances" />;
  const thisMonth = data.period;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Wage advances</h1>
        <p className="muted">
          Usually paid on the 20th to the guard's bank account or e-wallet. The OM sets the amount and date for one guard or for a site, zone or
          region; the Operations Director (private sites) or the OGM (government sites) approves once, and any change needs one more approval. The
          month's pay takes it back. An advance may not be more than last month's wages (EA s.22).
        </p>
        <div className="row" style={{ marginTop: 8 }}>
          <SopHelp id="pay-wage-advance" />
        </div>
      </div>
      {!data.primaPays && (
        <div className="notice" data-tone="info">
          Trial: the JA Group app still pays guards, so advances here are not paid from Prima. The trial pay run still takes approved advances back
          so the figures can be compared.
        </div>
      )}
      {!data.on && (
        <div className="notice" data-tone="warn">
          Advances are not switched on in this database yet. They need the guard pay module installed with approval.
        </div>
      )}
      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        <Select className="input" style={{ maxWidth: 260 }} aria-label="Company" value={data.companyId} onChange={(e) => setCompanyId(e.target.value)}>
          {data.companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <input className="input" type="month" style={{ maxWidth: 170 }} aria-label="Month" value={thisMonth} onChange={(e) => setPeriod(e.target.value || null)} />
      </div>
      <div className="kpis">
        <Kpi label="Waiting for approval" value={data.totals.pending} tone={data.totals.pending ? "warn" : "ok"} />
        <Kpi label="Approved" value={data.totals.approved} />
        <Kpi label="Paid" value={data.totals.paid} />
        <Kpi label="Total" value={rm(data.totals.amount)} />
      </div>
      {data.role === "om" && data.on && <AdvanceForm data={data} onDone={() => setTick((n) => n + 1)} />}
      <AdvanceList data={data} onChanged={() => setTick((n) => n + 1)} />
    </div>
  );
}

function AdvanceForm({ data, onDone }: { data: GuardAdvanceBoard; onDone: () => void }) {
  const act = useAction();
  const [basis, setBasis] = useState<"guard" | "site" | "zone" | "region">("site");
  const [ref, setRef] = useState("");
  const [amount, setAmount] = useState("");
  const [payOn, setPayOn] = useState(`${data.period}-${data.payDay}`);
  const [reason, setReason] = useState("");
  const choices = basis === "guard" ? data.choices.guards : basis === "site" ? data.choices.sites : basis === "zone" ? data.choices.zones : data.choices.regions;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Set advances</h3>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <select className="input" style={{ maxWidth: 140 }} aria-label="For" value={basis} onChange={(e) => { setBasis(e.target.value as typeof basis); setRef(""); }}>
          <option value="guard">One guard</option>
          <option value="site">A site</option>
          <option value="zone">A zone (branch)</option>
          <option value="region">A region</option>
        </select>
        <Select className="input" style={{ maxWidth: 240 }} aria-label="Which" value={ref} onChange={(e) => setRef(e.target.value)}>
          <option value="">Pick…</option>
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <input className="input" style={{ maxWidth: 120 }} aria-label="Amount each" inputMode="decimal" placeholder="RM each" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <input className="input" type="date" style={{ maxWidth: 170 }} aria-label="Pay date" value={payOn} onChange={(e) => setPayOn(e.target.value)} />
        <input className="input" style={{ maxWidth: 240 }} aria-label="Reason" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !ref || !Number(amount)}
          onClick={async () => {
            const r = await act.run(
              () => api.setGuardAdvances({ companyId: data.companyId, period: payOn.slice(0, 7), basis, ref, amount: Number(amount), payOn, reason }),
              "Advances set. They wait for the Operations Director or the OGM.",
            );
            if (r) {
              setAmount("");
              onDone();
            }
          }}
        >
          Set advances
        </button>
      </div>
      <p className="muted small">Guards with no bank account or e-wallet they can be paid into, or with an advance already this month, are skipped.</p>
      <ErrorNotice error={act.error} />
    </section>
  );
}

function AdvanceList({ data, onChanged }: { data: GuardAdvanceBoard; onChanged: () => void }) {
  const act = useAction();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [edit, setEdit] = useState<Record<string, { amount: string; payOn: string; reason: string }>>({});
  const approvable = data.advances.filter((a) => a.can.approve);
  const done = async (fn: () => Promise<unknown>, msg: string) => {
    if (await act.run(fn, msg)) {
      setPicked(new Set());
      setNote("");
      onChanged();
    }
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Advances in {monthLabel(data.period)}</h3>
      </div>
      {approvable.length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set(approvable.map((a) => a.id)))}>
            Pick all {approvable.length} I can approve
          </button>
          <input className="input" style={{ maxWidth: 260 }} aria-label="Approval reason" placeholder="Reason or comment" value={note} onChange={(e) => setNote(e.target.value)} />
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || !picked.size || note.trim().length < 3}
            onClick={() => done(() => api.approveGuardAdvances([...picked], note), `${picked.size} approved.`)}
          >
            Approve {picked.size || ""}
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
      {/* P107: a data table (search, status and approver filters, sort, pages; cards on a phone). The ticks keep feeding the
          approve bar above; the change form opens under its row. */}
      <div className="panel-body">
        <DataTable
          label="Advances"
          stateKey="advances.list"
          phoneFacts={5}
          rows={data.advances}
          rowKey={(a) => a.id}
          searchText={(a) => `${a.staffNo} ${a.set.by}`}
          empty={<div className="empty">No advances set for this month.</div>}
          selection={approvable.length > 0 ? { selected: picked, onChange: setPicked, canSelect: (a) => a.can.approve } : undefined}
          columns={[
            {
              id: "name",
              label: "Name",
              value: (a) => a.name,
              render: (a) => (
                <>
                  <span style={{ fontWeight: 600 }}>{a.name}</span> <span className="muted small">{a.staffNo}</span>
                </>
              ),
              phone: "title",
            },
            { id: "amount", label: "Amount", value: (a) => a.amount, sort: "money", render: (a) => <span style={{ fontWeight: 600 }}>{rm(a.amount)}</span> },
            { id: "payOn", label: "Pay date", value: (a) => a.payOn, sort: "date", render: (a) => dateLabel(a.payOn) },
            { id: "basis", label: "For", value: (a) => a.basisLabel, hideBelow: 1200 },
            { id: "approver", label: "Approver", value: (a) => (a.approverTier === "ogm" ? "OGM" : "Operations Director"), translate: true, hideBelow: 1100 },
            {
              id: "status",
              label: "Status",
              value: (a) => STATUS[a.status][1],
              translate: true,
              render: (a) => <Chip tone={STATUS[a.status][0]}>{STATUS[a.status][1]}</Chip>,
            },
          ]}
          filters={[
            { id: "status", label: "Status", value: (a) => a.status, optionLabel: (v) => STATUS[v]?.[1] ?? v },
            { id: "approver", label: "Approver", value: (a) => a.approverTier, optionLabel: (v) => (v === "ogm" ? "OGM" : "Operations Director") },
          ]}
          actions={
            data.advances.some((a) => a.can.change)
              ? (a) => [
                  {
                    label: "Change or cancel",
                    hidden: !a.can.change || !!edit[a.id],
                    onClick: () => setEdit((x) => ({ ...x, [a.id]: { amount: String(a.amount), payOn: a.payOn, reason: "" } })),
                  },
                ]
              : undefined
          }
          rowDetail={(a) => {
            const e = edit[a.id];
            return (
              <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
                <div className="muted small">
                  set by {a.set.by}
                  {a.version > 1 ? ` · changed ${a.version - 1} time${a.version > 2 ? "s" : ""}` : ""}
                  {a.approvals.length ? ` · last approved by ${a.approvals[a.approvals.length - 1].by}` : ""}
                </div>
                {a.flags.map((f) => (
                  <div key={f} className="small" style={{ color: "var(--warn, #b45309)" }}>
                    {f}
                  </div>
                ))}
                {a.can.change && e && (
                  <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    <input className="input" style={{ maxWidth: 110 }} aria-label="New amount" inputMode="decimal" value={e.amount} onChange={(ev) => setEdit((x) => ({ ...x, [a.id]: { ...e, amount: ev.target.value } }))} />
                    <input className="input" type="date" style={{ maxWidth: 170 }} aria-label="New pay date" value={e.payOn} onChange={(ev) => setEdit((x) => ({ ...x, [a.id]: { ...e, payOn: ev.target.value } }))} />
                    <input className="input" style={{ maxWidth: 220 }} aria-label="Why it changes" placeholder="Why it changes" value={e.reason} onChange={(ev) => setEdit((x) => ({ ...x, [a.id]: { ...e, reason: ev.target.value } }))} />
                    <button
                      className="btn btn-sm"
                      disabled={act.busy || e.reason.trim().length < 3}
                      onClick={() => done(() => api.changeGuardAdvance(a.id, { action: "change", amount: Number(e.amount), payOn: e.payOn, reason: e.reason }), a.status === "approved" ? "Changed. It needs one more approval." : "Changed.")}
                    >
                      Save change
                    </button>
                    <button className="btn btn-ghost btn-sm" disabled={act.busy || e.reason.trim().length < 3} onClick={() => done(() => api.changeGuardAdvance(a.id, { action: "cancel", reason: e.reason }), "Cancelled.")}>
                      Cancel advance
                    </button>
                  </div>
                )}
              </div>
            );
          }}
        />
      </div>
    </section>
  );
}

/** Consent letters for someone else's account, stamped by a Commissioner for Oaths, waiting for the COO (Fauzan, 6 Nov 2026). */
function ConsentLetters() {
  const [tick, setTick] = useState(0);
  const { data } = useLoad(() => api.payConsentsWaiting(), [tick]);
  const act = useAction();
  const [note, setNote] = useState<Record<string, string>>({});
  if (!data || !data.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Consent letters waiting for the COO</h3>
      </div>
      <p className="muted small">
        A guard paid into an immediate relative's or close friend's account needs a written consent letter stamped by a Commissioner for Oaths
        (Pesuruhjaya Sumpah), approved by the COO. Until then the guard cannot be paid into that account.
      </p>
      <div className="list">
        {data.map((c) => (
          <div key={c.personId} className="list-item" style={{ flexWrap: "wrap", gap: 6 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>
                {c.name} <span className="muted small">{c.staffNo}</span>
              </div>
              <div className="muted small">
                {c.account.holderName} ({c.account.relationship}) · {c.account.bank} {c.account.accountMasked} · letter {c.account.consent?.docRef} signed{" "}
                {dateLabel(c.account.consent?.signedOn)} · stamped by {c.account.consent?.oaths.commissioner} ({c.account.consent?.oaths.stampRef}) on{" "}
                {dateLabel(c.account.consent?.oaths.stampedOn)} · recorded by {c.account.consent?.recordedBy}
              </div>
            </div>
            {c.canApprove ? (
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <input
                  className="input"
                  style={{ maxWidth: 240 }}
                  aria-label="Reason"
                  placeholder="Reason or comment"
                  value={note[c.personId] ?? ""}
                  onChange={(e) => setNote((n) => ({ ...n, [c.personId]: e.target.value }))}
                />
                <button
                  className="btn btn-primary btn-sm"
                  disabled={act.busy || (note[c.personId] ?? "").trim().length < 3}
                  onClick={async () => {
                    if (await act.run(() => api.approvePayConsent(c.personId, note[c.personId] ?? ""), "Approved. Recalculate the month to use the account.")) setTick((n) => n + 1);
                  }}
                >
                  Approve letter
                </button>
              </div>
            ) : (
              <Chip tone="warn">Waiting for the COO</Chip>
            )}
          </div>
        ))}
      </div>
      <ErrorNotice error={act.error} />
    </section>
  );
}

/**
 * Statutory rates (Fauzan, 6 Nov 2026): the CEO sets EPF, SOCSO, EIS, LINDUNG and HRD from a month. P98 moved the screen
 * to its own file, laid out like the salary calculator (StatutoryRates.tsx, statutory-model.ts, styles/statutory.css).
 */
export { StatutoryRatesView as StatutoryView } from "./StatutoryRates";

const LOAN_STATUS: Record<string, [Tone, string]> = {
  pending_cos: ["warn", "Waiting for the Chief of Staff"],
  pending_ceo: ["warn", "Waiting for the CEO"],
  approved: ["info", "Approved, not paid out"],
  paid_out: ["info", "Being repaid"],
  settled: ["ok", "Settled"],
  rejected: ["neutral", "Rejected"],
  cancelled: ["neutral", "Cancelled"],
};

/**
 * Advance and loan scheme (Fauzan, 6 Nov 2026, IWAY item 4). Separate from the wage advance on the 20th. HR records each
 * one with the worker's signed agreement; the Chief of Staff then the CEO approve; Finance is told at every step, pays it
 * out and watches the balance. The pay run takes repayments only from these records, keeping all deductions within half
 * the wages.
 */
export function GuardLoansView() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const { data, error } = useLoad(() => api.guardLoans({ companyId }), [companyId, tick]);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="advances and loans" />;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Advances and loans</h1>
        <p className="muted">
          Each advance or loan has a limit, a purpose, a repayment period and the worker's signed agreement. HR records it, the Chief of Staff
          approves, then the CEO. Finance is told at each step, pays it out and watches what is owed. The guard pay run takes repayments only from
          these records, and all deductions together stay within half the month's wages (EA s.24(8)). The wage advance on the 20th is on its own
          screen. Exceptional guard cash support is additional pay, never a repayable loan or a wage deduction; use the separate manually approved DOA handover for that support.
        </p>
        <div className="row" style={{ marginTop: 8 }}>
          <SopHelp id="pay-advance-loan" />
        </div>
      </div>
      {!data.primaPays && (
        <div className="notice" data-tone="info">
          Trial: the JA Group app still pays guards. Records can be made and approved, but Finance pays them out from Prima only after the switch date,
          because repayments come off Prima's pay run.
        </div>
      )}
      {!data.on && (
        <div className="notice" data-tone="warn">
          Advances and loans are not switched on in this database yet. They need the guard pay module installed with approval.
        </div>
      )}
      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        <Select className="input" style={{ maxWidth: 260 }} aria-label="Company" value={data.companyId} onChange={(e) => setCompanyId(e.target.value)}>
          {data.companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="kpis">
        <Kpi label="Waiting for approval" value={data.totals.waiting} tone={data.totals.waiting ? "warn" : "ok"} />
        <Kpi label="Being repaid" value={data.totals.open} />
        <Kpi label="Lent (open)" value={rm(data.totals.lent)} />
        <Kpi label="Still owed" value={rm(data.totals.owed)} />
      </div>
      {data.role === "hr" && data.on && <LoanForm data={data} onDone={() => setTick((n) => n + 1)} />}
      <LoanList data={data} onChanged={() => setTick((n) => n + 1)} />
    </div>
  );
}

function LoanForm({ data, onDone }: { data: GuardLoanBoard; onDone: () => void }) {
  const act = useAction();
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  const blank = { personId: "", kind: "loan", limit: "", amount: "", purpose: "", months: "6", firstPeriod: today.slice(0, 7), docRef: "", signedOn: today };
  const [f, setF] = useState(blank);
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const ready = f.personId && Number(f.limit) > 0 && f.purpose.trim().length >= 5 && Number(f.months) >= 1 && f.docRef.trim().length >= 3 && f.signedOn;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Record an advance or loan</h3>
      </div>
      {/* P98: each box has its name above it and the boxes share the width (on a phone they no longer pile up unnamed). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", gap: 12, marginBottom: 10 }}>
        <label className="field">
          <span>Guard</span>
          <Select className="input" aria-label="Guard" value={f.personId} onChange={set("personId")}>
            <option value="">Pick a guard…</option>
            {data.guards.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span>Kind</span>
          <select className="input" aria-label="Kind" value={f.kind} onChange={set("kind")}>
            <option value="loan">Loan</option>
            <option value="advance">Advance</option>
          </select>
        </label>
        <label className="field">
          <span>Limit (RM)</span>
          <input className="input" aria-label="Limit" inputMode="decimal" placeholder="Limit RM" value={f.limit} onChange={set("limit")} />
        </label>
        <label className="field">
          <span>Amount lent (RM)</span>
          <input className="input" aria-label="Amount lent" inputMode="decimal" placeholder="Lent RM (= limit)" value={f.amount} onChange={set("amount")} />
        </label>
        <label className="field">
          <span>Purpose</span>
          <input className="input" aria-label="Purpose" placeholder="Purpose" value={f.purpose} onChange={set("purpose")} />
        </label>
        <label className="field">
          <span>Months to repay</span>
          <input className="input" aria-label="Months to repay" inputMode="numeric" placeholder="Months" value={f.months} onChange={set("months")} />
        </label>
        <label className="field">
          <span>First repayment month</span>
          <input className="input" type="month" aria-label="First repayment month" value={f.firstPeriod} onChange={set("firstPeriod")} />
        </label>
        <label className="field">
          <span>Signed agreement reference</span>
          <input className="input" aria-label="Signed agreement reference" placeholder="Signed agreement ref." value={f.docRef} onChange={set("docRef")} />
        </label>
        <label className="field">
          <span>Date the worker signed</span>
          <input className="input" type="date" aria-label="Date the worker signed" value={f.signedOn} onChange={set("signedOn")} />
        </label>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !ready}
          onClick={async () => {
            const r = await act.run(
              () =>
                api.recordGuardLoan({
                  companyId: data.companyId,
                  personId: f.personId,
                  kind: f.kind,
                  limit: Number(f.limit),
                  amount: f.amount ? Number(f.amount) : undefined,
                  purpose: f.purpose,
                  months: Number(f.months),
                  firstPeriod: f.firstPeriod,
                  docRef: f.docRef,
                  signedOn: f.signedOn,
                }),
              "Recorded. It waits for the Chief of Staff; Finance has been told.",
            );
            if (r) {
              setF(blank);
              onDone();
            }
          }}
        >
          Record
        </button>
      </div>
      <p className="muted small">Paid into the guard's own bank account or e-wallet only. Keep the signed agreement on file under the reference given.</p>
      <ErrorNotice error={act.error} />
    </section>
  );
}

function LoanList({ data, onChanged }: { data: GuardLoanBoard; onChanged: () => void }) {
  const act = useAction();
  const [note, setNote] = useState<Record<string, string>>({});
  const [bankRef, setBankRef] = useState<Record<string, string>>({});
  const done = async (id: string, fn: () => Promise<unknown>, msg: string) => {
    if (await act.run(fn, msg)) {
      setNote((x) => ({ ...x, [id]: "" }));
      onChanged();
    }
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Records</h3>
      </div>
      <ErrorNotice error={act.error} />
      {!data.loans.length && <p className="muted small">No advance or loan recorded for this company.</p>}
      {/* P107: a data table (search, status and kind filters, sort, pages; cards on a phone). Each record's details and its
          approve, pay-out and cancel steps sit under its row with the same checks as before. */}
      {data.loans.length > 0 && (
        <div className="panel-body">
          <DataTable
            label="Records"
            stateKey="loans.list"
            rows={data.loans}
            rowKey={(l) => l.id}
            searchText={(l) => `${l.staffNo} ${l.signature.docRef} ${l.requested.by}`}
            columns={[
              {
                id: "name",
                label: "Name",
                value: (l) => l.name,
                render: (l) => (
                  <>
                    <span style={{ fontWeight: 600 }}>{l.name}</span> <span className="muted small">{l.staffNo}</span>
                  </>
                ),
                phone: "title",
              },
              { id: "kind", label: "Kind", value: (l) => (l.kind === "loan" ? "Loan" : "Advance"), translate: true },
              { id: "purpose", label: "Purpose", value: (l) => l.purpose, hideBelow: 1200, phone: "sub" },
              { id: "amount", label: "Amount", value: (l) => l.amount, sort: "money", render: (l) => <span style={{ fontWeight: 600 }}>{rm(l.amount)}</span> },
              {
                id: "owed",
                label: "Owed",
                value: (l) => (l.status === "paid_out" || l.status === "settled" ? l.balance : null),
                sort: "money",
                render: (l) => (l.status === "paid_out" || l.status === "settled" ? rm(l.balance) : "\u2013"),
                hideBelow: 1100,
              },
              {
                id: "status",
                label: "Status",
                value: (l) => LOAN_STATUS[l.status][1],
                translate: true,
                render: (l) => <Chip tone={LOAN_STATUS[l.status][0]}>{LOAN_STATUS[l.status][1]}</Chip>,
              },
            ]}
            filters={[
              { id: "status", label: "Status", value: (l) => l.status, optionLabel: (v) => LOAN_STATUS[v]?.[1] ?? v },
              {
                id: "kind",
                label: "Kind",
                value: (l) => l.kind,
                options: [
                  { value: "loan", label: "Loan" },
                  { value: "advance", label: "Advance" },
                ],
              },
            ]}
            rowDetail={(l) => {
              const n = note[l.id] ?? "";
              return (
                <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
                  <div className="muted small">
                    {l.kind === "loan" ? "Loan" : "Advance"} · {l.purpose} · limit {rm(l.limit)} · {l.months} month{l.months === 1 ? "" : "s"} at {rm(l.instalment)} from{" "}
                    {monthLabel(l.firstPeriod)} · signed agreement {l.signature.docRef} ({dateLabel(l.signature.signedOn)}) · recorded by {l.requested.by}
                  </div>
                  <div className="small">
                    {l.cos ? `Chief of Staff approved (${l.cos.by}): ${l.cos.note}` : ""}
                    {l.ceo ? ` · CEO approved: ${l.ceo.note}` : ""}
                    {l.rejected ? `${l.status === "cancelled" ? "Cancelled" : `Rejected by the ${l.rejected.tier === "cos" ? "Chief of Staff" : "CEO"}`}: ${l.rejected.note}` : ""}
                    {l.paidOut ? ` · paid out ${dateLabel(l.paidOut.paidOn)} (${l.paidOut.bankRef})` : ""}
                    {l.status === "paid_out" || l.status === "settled" ? ` · repaid ${rm(l.amount - l.balance)}, owed ${rm(l.balance)}` : ""}
                  </div>
                  {l.flags.map((f) => (
                    <div key={f} className="small" style={{ color: "var(--warn, #b45309)" }}>
                      {f}
                    </div>
                  ))}
                  {data.role === "finance" && l.financeNotices.length > 0 && (
                    <div className="muted small">Finance notices: {l.financeNotices.map((x) => `${dateTimeLabel(x.at)} ${x.text}`).join(" · ")}</div>
                  )}
                  {(l.can.cos || l.can.ceo) && (
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      <input className="input" style={{ maxWidth: 260 }} aria-label="Reason or comment" placeholder="Reason or comment" value={n} onChange={(e) => setNote((x) => ({ ...x, [l.id]: e.target.value }))} />
                      <button className="btn btn-primary btn-sm" disabled={act.busy || n.trim().length < 3} onClick={() => done(l.id, () => api.guardLoanStep(l.id, "decide", { decision: "approve", note: n }), "Approved. Finance has been told.")}>
                        Approve
                      </button>
                      <button className="btn btn-sm" disabled={act.busy || n.trim().length < 3} onClick={() => done(l.id, () => api.guardLoanStep(l.id, "decide", { decision: "reject", note: n }), "Rejected.")}>
                        Reject
                      </button>
                    </div>
                  )}
                  {l.can.payOut && (
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      <input className="input" style={{ maxWidth: 220 }} aria-label="Bank reference" placeholder="Bank reference" value={bankRef[l.id] ?? ""} onChange={(e) => setBankRef((x) => ({ ...x, [l.id]: e.target.value }))} />
                      <button className="btn btn-primary btn-sm" disabled={act.busy || !(bankRef[l.id] ?? "").trim()} onClick={() => done(l.id, () => api.guardLoanStep(l.id, "payout", { bankRef: bankRef[l.id] }), "Paid out.")}>
                        Paid out
                      </button>
                    </div>
                  )}
                  {l.can.cancel && (
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      <input className="input" style={{ maxWidth: 260 }} aria-label="Why cancel" placeholder="Why cancel" value={n} onChange={(e) => setNote((x) => ({ ...x, [l.id]: e.target.value }))} />
                      <button className="btn btn-ghost btn-sm" disabled={act.busy || n.trim().length < 3} onClick={() => done(l.id, () => api.guardLoanStep(l.id, "cancel", { note: n }), "Cancelled.")}>
                        Cancel record
                      </button>
                    </div>
                  )}
                </div>
              );
            }}
          />
        </div>
      )}
    </section>
  );
}
