import { useState } from "react";
import {
  isGroupLeader,
  type StaffPayLine,
  type StaffPayStage,
} from "@prima/core";
import {
  api,
  type StaffPayBoard,
  type StaffPayFile,
  type StaffPayRunView,
} from "../api";
import { useApp } from "../App";
import { PayChangesPanel } from "./PayChanges";
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

/**
 * Staff payroll (Fauzan, 27 Oct 2026). Guards and officers are paid from the JA Group app; staff are paid here. HR
 * prepares each employer's month, the Chief of Staff approves, the Vice Chairman consents, then Finance pays through the
 * bank and posts to SQL Account. Prima drafts the files; it never pays or files anything itself.
 */

const STAGE: Record<StaffPayStage, [Tone, string]> = {
  draft: ["neutral", "Draft with HR"],
  submitted: ["warn", "With the Chief of Staff"],
  approved: ["warn", "With the Vice Chairman"],
  consented: ["info", "With Finance to pay"],
  paid: ["ok", "Paid"],
};
const FILES: [StaffPayFile, string][] = [
  ["bank", "Bank upload"],
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

export function StaffPayView() {
  const { me } = useApp();
  const { data, error } = useLoad(() => api.staffPayroll(), []);
  // Pay changes: HR follows them, the Chief of Staff or Deputy verifies them (Fauzan, 27 Oct 2026).
  const seesPayChanges =
    me.user.department === "hr" ||
    isGroupLeader(me.user) ||
    me.user.department === "finance";
  const [tab, setTab] = useState<"runs" | "mine" | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="staff payroll" />;
  const current = tab ?? (data.role ? "runs" : "mine");
  return (
    <div className="page">
      <div className="page-head">
        <h1>Staff payroll</h1>
        <p className="muted">
          For staff only; guards and officers are paid from the JA Group app. HR
          prepares, the Chief of Staff approves, the Vice Chairman consents, and
          Finance pays through the bank and posts to SQL Account. Wages are due
          by the {data.rule.payByDay}th of the next month.
        </p>
      </div>
      {data.role && (
        <div className="tabbar" role="tablist" aria-label="Staff payroll">
          <button
            role="tab"
            aria-selected={current === "runs"}
            onClick={() => setTab("runs")}
          >
            Payroll
          </button>
          <button
            role="tab"
            aria-selected={current === "mine"}
            onClick={() => setTab("mine")}
          >
            My payslips
          </button>
        </div>
      )}
      {current === "runs" && seesPayChanges && <PayChangesPanel />}
      {current === "runs" ? (
        <Runs data={data} onOpen={setOpen} />
      ) : (
        <Mine data={data} />
      )}
      {open && <RunDrawer runId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Runs({
  data,
  onOpen,
}: {
  data: StaffPayBoard;
  onOpen: (id: string) => void;
}) {
  const act = useAction();
  const mine = data.runs.filter((r) => r.mineToAct);
  const late = data.employers.filter((e) => e.lastLate);
  const thisMonth = data.runs.filter((r) => r.period === data.period);
  const periods = [...new Set(data.runs.map((r) => r.period))];
  return (
    <>
      <div className="kpis">
        <Kpi
          label="Waiting for you"
          value={mine.length}
          tone={mine.length ? "warn" : "ok"}
        />
        <Kpi
          label={`${monthLabel(data.prev)} not paid by the ${data.rule.payByDay}th`}
          value={late.length}
          tone={late.length ? "crit" : "ok"}
          note="Employment Act s.19"
        />
        <Kpi
          label={`${monthLabel(data.period)} net pay`}
          value={rm(thisMonth.reduce((n, r) => n + r.totals.net, 0))}
          note={`${thisMonth.length} employers`}
        />
        <Kpi
          label="Staff with something to check"
          value={thisMonth.reduce((n, r) => n + r.totals.flagged, 0)}
          tone={thisMonth.some((r) => r.totals.flagged) ? "warn" : "ok"}
        />
      </div>
      {late.length > 0 && (
        <div className="notice" data-tone="crit">
          {monthLabel(data.prev)} salaries not paid by the {data.rule.payByDay}
          th: {late.map((e) => e.companyName).join(", ")}.
        </div>
      )}
      <section className="panel">
        <div className="panel-head">
          <h3>{monthLabel(data.period)} by employer</h3>
        </div>
        <ErrorNotice error={act.error} />
        <div className="list">
          {data.employers.map((e) => (
            <div
              key={e.companyId}
              className="list-item"
              style={{ flexWrap: "wrap", gap: 6 }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{e.companyName}</div>
                <div className="muted small">{e.staff} staff</div>
              </div>
              {e.current ? (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => onOpen(e.current!.id)}
                >
                  <Chip tone={STAGE[e.current.stage][0]}>
                    {STAGE[e.current.stage][1]}
                  </Chip>
                </button>
              ) : data.role === "hr" ? (
                <button
                  className="btn btn-primary btn-sm"
                  disabled={act.busy}
                  onClick={() =>
                    act.run(
                      () => api.prepareStaffPay(e.companyId, data.period),
                      "Prepared. Check the lines, then submit.",
                    )
                  }
                >
                  Prepare {monthLabel(data.period)}
                </button>
              ) : (
                <Chip tone="unknown">Not prepared</Chip>
              )}
            </div>
          ))}
        </div>
      </section>
      {periods.map((p) => (
        <section key={p} className="panel">
          <div className="panel-head">
            <h3>{monthLabel(p)}</h3>
          </div>
          <div className="list">
            {data.runs
              .filter((r) => r.period === p)
              .map((r) => (
                <button
                  key={r.id}
                  className="list-item"
                  style={{
                    flexWrap: "wrap",
                    gap: 6,
                    textAlign: "left",
                    width: "100%",
                  }}
                  onClick={() => onOpen(r.id)}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{r.companyName}</div>
                    <div className="muted small">
                      {r.totals.headcount} staff · gross {rm(r.totals.gross)} ·
                      net {rm(r.totals.net)} · employer cost {rm(r.totals.cost)}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    {r.mineToAct && <Chip tone="warn">Your turn</Chip>}
                    <Chip tone={r.late ? "crit" : STAGE[r.stage][0]}>
                      {r.late ? "Late" : STAGE[r.stage][1]}
                    </Chip>
                  </div>
                </button>
              ))}
          </div>
        </section>
      ))}
    </>
  );
}

function RunDrawer({ runId, onClose }: { runId: string; onClose: () => void }) {
  const { data, error } = useLoad(() => api.staffPayRun(runId), [runId]);
  const [slip, setSlip] = useState<StaffPayLine | null>(null);
  return (
    <Drawer
      title={
        data ? `${data.companyName}, ${monthLabel(data.run.period)}` : "Payroll"
      }
      sub={
        data
          ? (data.waitingOn ?? `Paid ${dateLabel(data.run.paid?.paidOn)}`)
          : undefined
      }
      onClose={onClose}
    >
      {error && <ErrorNotice error={error} />}
      {!data && !error && <Loading what="payroll" />}
      {data && !slip && <RunBody data={data} onSlip={setSlip} />}
      {data && slip && (
        <>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setSlip(null)}
          >
            Back to the list
          </button>
          <Payslip
            line={slip}
            period={data.run.period}
            companyName={data.companyName}
          />
        </>
      )}
    </Drawer>
  );
}

function RunBody({
  data,
  onSlip,
}: {
  data: StaffPayRunView;
  onSlip: (l: StaffPayLine) => void;
}) {
  const { run, totals, can } = data;
  const act = useAction();
  const [note, setNote] = useState("");
  const [bankRef, setBankRef] = useState("");
  const [pcbChecked, setPcbChecked] = useState(false);
  const download = async (kind: StaffPayFile) => {
    const f = await act.run(
      () => api.staffPayExport(run.id, kind),
      "Draft file saved. Check it before it goes to the bank or the agency.",
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
    ["Approved by the Chief of Staff", run.approved],
    ["Consented by the Vice Chairman", run.consented],
    ["Paid by Finance", run.paid],
  ];
  return (
    <>
      <div className="kpis">
        <Kpi label="Staff" value={totals.headcount} />
        <Kpi label="Net pay" value={rm(totals.net)} />
        <Kpi
          label="Employer cost"
          value={rm(totals.cost)}
          note="Gross, claims, EPF, SOCSO, EIS, HRD"
        />
        <Kpi
          label="PCB estimated"
          value={totals.pcbEstimated}
          tone={totals.pcbEstimated ? "warn" : "ok"}
          note="Finance checks in LHDN e-PCB"
        />
      </div>
      {data.ownLine && (data.role === "cos" || data.role === "vc") && (
        <div className="notice" data-tone="info">
          Your own salary is in this month. The{" "}
          {data.role === "cos"
            ? "Vice Chairman's consent"
            : "Chief of Staff's approval"}{" "}
          is the second check on it.
        </div>
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
                {s
                  ? `${s.by} · ${dateTimeLabel(s.at)}${s.note ? ` · ${s.note}` : ""}`
                  : "Not yet"}
              </span>
            </div>
          ))}
          {run.paid && (
            <div className="muted small">
              Bank reference {run.paid.bankRef}, paid{" "}
              {dateLabel(run.paid.paidOn)}, PCB checked in e-PCB.
            </div>
          )}
          {run.returns.map((r) => (
            <div key={r.at} className="notice" data-tone="warn">
              Returned by {r.by} on {dateTimeLabel(r.at)}: {r.note}
            </div>
          ))}
        </div>
      </section>
      <ErrorNotice error={act.error} />
      {(can.submit ||
        can.approve ||
        can.consent ||
        can.pay ||
        can.return ||
        can.prepare) && (
        <section className="panel">
          <div className="panel-head">
            <h3>Your step</h3>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
                  <input
                    type="checkbox"
                    checked={pcbChecked}
                    onChange={(e) => setPcbChecked(e.target.checked)}
                  />
                  PCB checked against LHDN e-PCB for every line
                </label>
              </>
            )}
            {can.return && (
              <input
                className="input"
                aria-label="Note"
                placeholder="What needs to change (to return)"
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
                    act.run(
                      () => api.prepareStaffPay(run.companyId, run.period),
                      "Recalculated.",
                    )
                  }
                >
                  Recalculate
                </button>
              )}
              {can.submit && (
                <button
                  className="btn btn-primary btn-sm"
                  disabled={act.busy}
                  onClick={() =>
                    act.run(
                      () => api.staffPayStep(run.id, "submit", {}),
                      "Sent to the Chief of Staff.",
                    )
                  }
                >
                  Submit to the Chief of Staff
                </button>
              )}
              {can.approve && (
                <button
                  className="btn btn-primary btn-sm"
                  disabled={act.busy}
                  onClick={() =>
                    act.run(
                      () => api.staffPayStep(run.id, "approve", {}),
                      "Approved, sent to the Vice Chairman.",
                    )
                  }
                >
                  Approve
                </button>
              )}
              {can.consent && (
                <button
                  className="btn btn-primary btn-sm"
                  disabled={act.busy}
                  onClick={() =>
                    act.run(
                      () => api.staffPayStep(run.id, "consent", {}),
                      "Consented, Finance can pay.",
                    )
                  }
                >
                  Consent
                </button>
              )}
              {can.pay && (
                <button
                  className="btn btn-primary btn-sm"
                  disabled={act.busy || !bankRef.trim() || !pcbChecked}
                  onClick={() =>
                    act.run(
                      () =>
                        api.staffPayStep(run.id, "pay", {
                          bankRef,
                          pcbChecked,
                        }),
                      "Marked paid.",
                    )
                  }
                >
                  Mark paid
                </button>
              )}
              {can.return && (
                <button
                  className="btn btn-sm"
                  disabled={act.busy || !note.trim()}
                  onClick={() =>
                    act.run(
                      () => api.staffPayStep(run.id, "return", { note }),
                      "Returned to HR.",
                    )
                  }
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
            <h3>Draft files for Finance</h3>
          </div>
          <p className="muted small">
            Prima does not send these anywhere. Finance checks them, then
            uploads to the bank, SQL Account, KWSP, PERKESO and LHDN.
          </p>
          <p className="small">
            Control total: {data.control.count} payments, RM
            {data.control.net.toLocaleString("en-MY", {
              minimumFractionDigits: 2,
            })}
            , check code <span className="mono">{data.control.code}</span>.
            Finance matches these on the bank portal before releasing. Only
            Finance takes the bank file.
          </p>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {FILES.filter(([k]) => k !== "bank" || can.bankFile).map(
              ([k, label]) => (
                <button
                  key={k}
                  className="btn btn-sm"
                  disabled={act.busy}
                  onClick={() => download(k)}
                >
                  {label}
                </button>
              ),
            )}
          </div>
        </section>
      )}
      <section className="panel">
        <div className="panel-head">
          <h3>Staff</h3>
          <span className="muted small">
            EPF {rm(totals.epf)} · PCB {rm(totals.pcb)} · HRD {rm(totals.hrd)}
          </span>
        </div>
        <SocsoColumns lines={run.lines} totals={totals} />
        <div className="list">
          {run.lines.map((l) => (
            <div
              key={l.personId}
              className="list-item"
              style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}
            >
              <div
                className="row"
                style={{
                  justifyContent: "space-between",
                  gap: 6,
                  flexWrap: "wrap",
                }}
              >
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ padding: 0, textAlign: "left" }}
                  onClick={() => onSlip(l)}
                >
                  <span style={{ fontWeight: 600 }}>{l.name}</span>{" "}
                  <span className="muted small">{l.jobTitle}</span>
                </button>
                <span style={{ fontWeight: 600 }}>{rm(l.net)}</span>
              </div>
              <div className="muted small">
                Gross {rm(l.gross)} · EPF {rm(l.epfEe)} · SOCSO {rm(l.socsoEe)}{" "}
                · LINDUNG{" "}
                {l.lindungStatus === "opted_out"
                  ? "opted out"
                  : rm(l.lindungEe)}{" "}
                · EIS {rm(l.eisEe)} · PCB {rm(l.pcb)}
                {l.pcbSource === "estimate" && l.pcb > 0 ? " (estimate)" : ""}
                {l.claims ? ` · claims ${rm(l.claims)}` : ""}
              </div>
              {l.flags.map((f) => (
                <div
                  key={f}
                  className="small"
                  style={{ color: "var(--warn, #b45309)" }}
                >
                  {f}
                </div>
              ))}
              {can.prepare && <PcbEdit runId={run.id} line={l} />}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function PcbEdit({ runId, line }: { runId: string; line: StaffPayLine }) {
  const act = useAction();
  const [pcb, setPcb] = useState(
    line.pcbSource === "entered" ? String(line.pcb) : "",
  );
  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      <input
        className="input"
        style={{ maxWidth: 160 }}
        aria-label={`PCB for ${line.name}`}
        inputMode="decimal"
        placeholder="PCB from e-PCB"
        value={pcb}
        onChange={(e) => setPcb(e.target.value)}
      />
      <button
        className="btn btn-sm"
        disabled={act.busy}
        onClick={() =>
          act.run(
            () =>
              api.setStaffPayLine(runId, line.personId, {
                pcb: pcb.trim() === "" ? null : Number(pcb),
              }),
            "PCB saved.",
          )
        }
      >
        {pcb.trim() === "" ? "Use estimate" : "Save PCB"}
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function Mine({ data }: { data: StaffPayBoard }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!data.mine.length)
    return (
      <section className="panel">
        <div className="empty">
          No payslips yet. They appear here once Finance has paid the month.
        </div>
      </section>
    );
  const slip = open == null ? null : data.mine[open];
  return (
    <>
      <section className="panel">
        <div className="list">
          {data.mine.map((m, i) => (
            <button
              key={m.runId}
              className="list-item"
              style={{ width: "100%", textAlign: "left" }}
              onClick={() => setOpen(i)}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{monthLabel(m.period)}</div>
                <div className="muted small">Paid {dateLabel(m.paidOn)}</div>
              </div>
              <span style={{ fontWeight: 600 }}>{rm(m.line.net)}</span>
            </button>
          ))}
        </div>
      </section>
      {slip && (
        <Drawer
          title={`Payslip, ${monthLabel(slip.period)}`}
          sub={slip.companyName}
          onClose={() => setOpen(null)}
        >
          <Payslip
            line={slip.line}
            period={slip.period}
            companyName={slip.companyName}
          />
        </Drawer>
      )}
    </>
  );
}

function Payslip({
  line: l,
  period,
  companyName,
}: {
  line: StaffPayLine;
  period: string;
  companyName: string;
}) {
  const row = (label: string, amount: number, minus = false) => (
    <div key={label} className="list-item">
      <span>{label}</span>
      <span>{minus && amount ? `(${rm(amount)})` : rm(amount)}</span>
    </div>
  );
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>
          {l.name} · {l.staffNo}
        </h3>
        <span className="muted small">
          {companyName} · {monthLabel(period)} · {l.jobTitle}
        </span>
      </div>
      <div className="list">
        {row("Basic pay", l.basic)}
        {l.allowanceLines.map((a) => row(a.label, a.amount))}
        {l.unpaidDays > 0 &&
          row(
            `Unpaid leave, ${l.unpaidDays} day${l.unpaidDays === 1 ? "" : "s"}`,
            l.unpaidDeduction,
            true,
          )}
        {row("Gross pay", l.gross)}
        {row("EPF (employee)", l.epfEe, true)}
        {row("SOCSO (employee)", l.socsoEe, true)}
        {l.lindungStatus === "opted_out" ? (
          <div className="list-item">
            <span>LINDUNG 24 Jam</span>
            <span className="muted">Opted out</span>
          </div>
        ) : (
          l.lindungStatus === "deducted" &&
          row(
            `LINDUNG 24 Jam (${(l.lindungRate * 100).toFixed(2)}%)`,
            l.lindungEe,
            true,
          )
        )}
        {row("EIS (employee)", l.eisEe, true)}
        {row(
          l.pcbSource === "estimate" ? "PCB (estimate)" : "PCB",
          l.pcb,
          true,
        )}
        {l.claims > 0 && row("Claims paid back", l.claims)}
        <div className="list-item" style={{ fontWeight: 700 }}>
          <span>Net pay</span>
          <span>{rm(l.net)}</span>
        </div>
      </div>
      <p className="muted small">
        Paid by your employer on top: EPF {rm(l.epfEr)}, SOCSO {rm(l.socsoEr)},
        EIS {rm(l.eisEr)}.{" "}
        {l.bank
          ? `Paid to ${l.bank.bank} ${l.bank.accountMasked}.`
          : "No salary account on record."}
      </p>
    </section>
  );
}

/**
 * Normal SOCSO and LINDUNG 24 Jam in separate columns, each with its own total (Fauzan, 27 Oct 2026). LINDUNG is paid
 * by the employee only; a Malaysian with an opt-out on file shows "Opted out". EIS is for Malaysians only.
 */
function SocsoColumns({
  lines,
  totals,
}: {
  lines: StaffPayRunView["run"]["lines"];
  totals: StaffPayRunView["totals"];
}) {
  return (
    <div className="table-wrap" style={{ marginBottom: 8 }}>
      <table>
        <thead>
          <tr>
            <th>Staff</th>
            <th className="num">SOCSO employer</th>
            <th className="num">SOCSO employee</th>
            <th className="num">LINDUNG 24 Jam</th>
            <th className="num">EIS employer</th>
            <th className="num">EIS employee</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.personId}>
              <td>{l.name}</td>
              <td className="num">{rm(l.socsoEr)}</td>
              <td className="num">{rm(l.socsoEe)}</td>
              <td className="num">
                {l.lindungStatus === "opted_out" ? (
                  <span className="muted">Opted out</span>
                ) : (
                  rm(l.lindungEe)
                )}
              </td>
              <td className="num">
                {l.nationality === "MY" ? (
                  rm(l.eisEr)
                ) : (
                  <span className="muted">n/a</span>
                )}
              </td>
              <td className="num">
                {l.nationality === "MY" ? (
                  rm(l.eisEe)
                ) : (
                  <span className="muted">n/a</span>
                )}
              </td>
            </tr>
          ))}
          <tr style={{ fontWeight: 700 }}>
            <td>Total</td>
            <td className="num">{rm(totals.socsoEr)}</td>
            <td className="num">{rm(totals.socsoEe)}</td>
            <td className="num">{rm(totals.lindung)}</td>
            <td className="num">{rm(totals.eisEr)}</td>
            <td className="num">{rm(totals.eisEe)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
