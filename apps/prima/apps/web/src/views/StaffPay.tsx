import { Select } from '../SearchSelect';
import { useEffect, useRef, useState } from "react";
import {
  CaretRightIcon,
  DownloadSimpleIcon,
  FileCsvIcon,
  FlagIcon,
  HourglassMediumIcon,
  PlusIcon,
  WalletIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
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
import { StatTablesView } from "./StatTables";
import { AdvancesOverdue } from "./FinanceCash";
import {
  Chip,
  Drawer,
  ErrorNotice,
  Loading,
  dateLabel,
  dateTimeLabel,
  useAction,
  useLoad,
  type Tone,
} from "../ui";
import { Card, Empty, PageHead, Person, Stat, Stats, Steps, type StepState } from "../kit";
import "../styles/payroll.css";

/**
 * Staff payroll (Fauzan, 27 Oct 2026). Guards and officers are paid from the JA Group app; staff are paid here. HR
 * prepares each employer's month, the Chief of Staff approves, then the COO approves (Fauzan, 1 Nov 2026), then Finance
 * pays through the bank and posts to SQL Account. Each approval needs a comment. Prima drafts the files; it never pays or files anything itself.
 */

const STAGE: Record<StaffPayStage, [Tone, string]> = {
  draft: ["neutral", "Draft with HR"],
  submitted: ["warn", "With the Chief of Staff"],
  approved: ["warn", "With the COO"],
  coo_approved: ["info", "With Finance to pay"],
  paid: ["ok", "Paid"],
};
/** The stages in order, so a run's progress can be drawn from its stage alone. */
const ORDER: StaffPayStage[] = ["draft", "submitted", "approved", "coo_approved", "paid"];
const FILES: [StaffPayFile, string][] = [
  ["bank", "Bank upload"],
  ["sql", "SQL Account journal"],
  ["epf", "EPF list"],
  ["socso", "SOCSO and EIS list"],
  ["pcb", "PCB list"],
  ["zakat", "Zakat list by body"],
];
const rm = (n: number) =>
  `RM${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthLabel = (p: string) =>
  new Date(`${p}-01T00:00:00Z`).toLocaleDateString("en-MY", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

/** HR prepares, the Chief of Staff approves, the COO approves, Finance pays: drawn from the run's stage. */
function runSteps(stage: StaffPayStage, late: boolean) {
  const at = ORDER.indexOf(stage);
  const labels: [string, string][] = [
    ["Prepared by HR", "HR to submit"],
    ["Chief of Staff approves", "Chief of Staff to approve"],
    ["COO approves", "COO to approve"],
    [stage === "paid" ? "Paid by Finance" : "Finance pays", "Finance to pay"],
  ];
  return labels.map(([label, waiting], i) => {
    const state: StepState = at > i ? "done" : at === i ? (late ? "stopped" : "now") : "todo";
    return { label, state, note: at === i ? (late ? `${waiting}, late` : waiting) : undefined };
  });
}

export function StaffPayView() {
  const { me } = useApp();
  const { data, error } = useLoad(() => api.staffPayroll(), []);
  // Pay changes: HR follows them, the Chief of Staff or Deputy verifies them (Fauzan, 27 Oct 2026).
  const seesPayChanges =
    me.user.department === "hr" ||
    isGroupLeader(me.user) ||
    me.user.department === "finance";
  const [tab, setTab] = useState<"runs" | "mine" | "tables" | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="staff payroll" />;
  const current = tab ?? (data.role ? "runs" : "mine");
  return (
    <div className="page pay">
      <PageHead
        title="Staff payroll"
        sub={
          <>
            For staff only; guards and officers are paid from the JA Group app.
            HR prepares, the Chief of Staff approves, then the COO approves, and
            Finance pays through the bank and posts to SQL Account. Wages are
            due by the {data.rule.payByDay}th of the next month.
          </>
        }
        actions={
          data.canPrepare && current === "runs" ? (
            <button className="btn btn-primary" onClick={() => setPreparing(true)}>
              <PlusIcon size={16} /> Start a payroll month
            </button>
          ) : undefined
        }
      >
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
            <button
              role="tab"
              aria-selected={current === "tables"}
              onClick={() => setTab("tables")}
            >
              EPF and SOCSO tables
            </button>
          </div>
        )}
      </PageHead>
      {current === "runs" ? (
        <Runs data={data} onOpen={setOpen} seesPayChanges={seesPayChanges} />
      ) : current === "tables" ? (
        <StatTablesView />
      ) : (
        <Mine data={data} />
      )}
      {open && <RunDrawer runId={open} onClose={() => setOpen(null)} />}
      {preparing && (
        <PrepareDrawer
          data={data}
          onClose={() => setPreparing(false)}
          onDone={(id) => {
            setPreparing(false);
            setOpen(id);
          }}
        />
      )}
    </div>
  );
}

/**
 * Start (or recalculate) an employer's month (P78: HR, or the owner as master administrator). The month is built from
 * the staff records, unpaid leave and approved claims; the lines are then checked and adjusted in the month itself.
 */
function PrepareDrawer({
  data,
  onClose,
  onDone,
}: {
  data: StaffPayBoard;
  onClose: () => void;
  onDone: (runId: string) => void;
}) {
  const act = useAction();
  const [companyId, setCompanyId] = useState(data.employers[0]?.companyId ?? "");
  const [period, setPeriod] = useState(data.period);
  const [tried, setTried] = useState(false);
  const run = data.runs.find((r) => r.companyId === companyId && r.period === period) ?? null;
  const locked = !!run && run.stage !== "draft";
  const save = async () => {
    setTried(true);
    if (!companyId || locked) return;
    const r = (await act.run(
      () => api.prepareStaffPay(companyId, period),
      run ? "Recalculated. Check the lines, then submit." : "Prepared. Check the lines, then submit.",
    )) as { id?: string } | undefined;
    if (r) onDone(r.id ?? `sp-${companyId}-${period}`);
  };
  return (
    <Drawer title="Start a payroll month" sub="Staff payroll, for office staff" onClose={onClose}>
      {data.employers.length === 0 ? (
        <Empty title="No employer with office staff yet">
          Add office staff on the People screen first; each employer's month lists its active office staff.
        </Empty>
      ) : (
        <div className="pay-prep">
          <label className="field">
            <span className="label">Employer</span>
            <Select className="select" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              {data.employers.map((e) => (
                <option key={e.companyId} value={e.companyId}>
                  {e.companyName} ({e.staff} staff)
                </option>
              ))}
            </Select>
            {tried && !companyId && <span className="help" data-tone="crit">Choose the employer.</span>}
          </label>
          <label className="field">
            <span className="label">Month</span>
            <select className="select" value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value={data.period}>{monthLabel(data.period)}</option>
              <option value={data.prev}>{monthLabel(data.prev)}</option>
            </select>
            <span className="help">Payroll is prepared for this month or last month.</span>
          </label>
          {run && (
            <div className="notice" data-tone={locked ? "warn" : "info"}>
              {locked
                ? `${monthLabel(period)} is already ${STAGE[run.stage][1].toLowerCase()}. It changes only if it is returned to HR.`
                : `${monthLabel(period)} is already a draft. Starting it again recalculates it from the staff records; one-off allowances, entered PCB and part-month pay are kept.`}
            </div>
          )}
          <p className="muted small">
            Each line comes from the staff record: basic pay, fixed allowances, unpaid leave and approved claims, with EPF,
            SOCSO, EIS and an estimated PCB. Add one-off allowances, the PCB from e-PCB and part-month pay on each line
            after it opens. The Chief of Staff and the COO approve it; whoever prepares or submits a month cannot approve it.
          </p>
          <ErrorNotice error={act.error} />
          <div className="pay-actions">
            <button className="btn btn-primary" disabled={act.busy || locked} onClick={() => void save()}>
              {act.busy ? "Working…" : run ? "Recalculate the month" : "Prepare the month"}
            </button>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </Drawer>
  );
}

function Runs({
  data,
  onOpen,
  seesPayChanges,
}: {
  data: StaffPayBoard;
  onOpen: (id: string) => void;
  seesPayChanges: boolean;
}) {
  const act = useAction();
  const mine = data.runs.filter((r) => r.mineToAct);
  const late = data.employers.filter((e) => e.lastLate);
  const thisMonth = data.runs.filter((r) => r.period === data.period);
  const flagged = thisMonth.reduce((n, r) => n + r.totals.flagged, 0);
  // This month's runs show on the employer cards; every other run is listed by month underneath.
  const onCards = new Set(data.employers.map((e) => e.current?.id).filter(Boolean));
  const others = data.runs.filter((r) => !onCards.has(r.id));
  const periods = [...new Set(others.map((r) => r.period))];
  const runOf = (id: string) => data.runs.find((r) => r.id === id) ?? null;
  // Exceptions first: the runs waiting for you, then late ones, then those with staff to check.
  const rank = (e: StaffPayBoard["employers"][number]) => {
    const r = e.current ? runOf(e.current.id) : null;
    if (r?.mineToAct) return 0;
    if (e.lastLate || r?.late) return 1;
    if (r?.totals.flagged) return 2;
    return 3;
  };
  const employers = [...data.employers].sort((a, b) => rank(a) - rank(b));
  return (
    <>
      <Stats>
        <Stat
          label="Waiting for you"
          value={mine.length}
          tone={mine.length ? "warn" : "ok"}
          icon={<HourglassMediumIcon size={18} />}
        />
        <Stat
          label={`${monthLabel(data.prev)} not paid by the ${data.rule.payByDay}th`}
          value={late.length}
          tone={late.length ? "crit" : "ok"}
          note="Employment Act s.19"
          icon={<WarningCircleIcon size={18} />}
        />
        <Stat
          label={`${monthLabel(data.period)} net pay`}
          value={<span className="pay-fig">{rm(thisMonth.reduce((n, r) => n + r.totals.net, 0))}</span>}
          note={`${thisMonth.length} employers`}
          icon={<WalletIcon size={18} />}
        />
        <Stat
          label="Staff with something to check"
          value={flagged}
          tone={flagged ? "warn" : "ok"}
          icon={<FlagIcon size={18} />}
        />
      </Stats>
      {late.length > 0 && (
        <div className="notice" data-tone="crit">
          {monthLabel(data.prev)} salaries not paid by the {data.rule.payByDay}
          th: {late.map((e) => e.companyName).join(", ")}.
        </div>
      )}
      <div className={seesPayChanges ? "pay-board pay-board-two" : "pay-board"}>
        {seesPayChanges && (
          <aside className="pay-aside" aria-label="To verify">
            <div className="pay-inbox">
              <PayChangesPanel />
            </div>
            <div className="pay-adv">
              <AdvancesOverdue />
            </div>
          </aside>
        )}
        <div className="pay-main">
          <section className="pay-section" aria-labelledby="pay-month-h">
            <div className="pay-section-head">
              <h2 id="pay-month-h">{monthLabel(data.period)} by employer</h2>
              {mine.length > 0 && (
                <Chip tone="warn">{`${mine.length} waiting for you`}</Chip>
              )}
            </div>
            <ErrorNotice error={act.error} />
            {employers.length === 0 ? (
              <Empty title="No employer with staff yet">
                Add office staff on the People screen; each employer with active office staff gets a payroll month here.
              </Empty>
            ) : (
              <div className="pay-runs">
                {employers.map((e) => {
                  const r = e.current ? runOf(e.current.id) : null;
                  const stage = e.current?.stage ?? null;
                  return (
                    <article
                      key={e.companyId}
                      className="pay-run"
                      data-turn={r?.mineToAct ? "yes" : undefined}
                      data-late={r?.late || e.lastLate ? "yes" : undefined}
                    >
                      <header className="pay-run-head">
                        <div className="pay-run-title">
                          <h3>{e.companyName}</h3>
                          <span className="muted small">{e.staff} staff</span>
                        </div>
                        <div className="pay-run-tags">
                          {r?.mineToAct && <Chip tone="warn">Your turn</Chip>}
                          {e.lastLate && (
                            <Chip tone="crit">{`${monthLabel(data.prev)} late`}</Chip>
                          )}
                          {stage ? (
                            <Chip tone={r?.late ? "crit" : STAGE[stage][0]}>
                              {r?.late ? "Late" : STAGE[stage][1]}
                            </Chip>
                          ) : (
                            <Chip tone="unknown">Not prepared</Chip>
                          )}
                        </div>
                      </header>
                      {stage && <Steps steps={runSteps(stage, !!r?.late)} />}
                      {r && (
                        <dl className="pay-figs">
                          <div>
                            <dt>Gross</dt>
                            <dd>{rm(r.totals.gross)}</dd>
                          </div>
                          <div>
                            <dt>Net</dt>
                            <dd>{rm(r.totals.net)}</dd>
                          </div>
                          <div>
                            <dt>Employer cost</dt>
                            <dd>{rm(r.totals.cost)}</dd>
                          </div>
                          <div data-tone={r.totals.flagged ? "warn" : undefined}>
                            <dt>To check</dt>
                            <dd>{r.totals.flagged}</dd>
                          </div>
                        </dl>
                      )}
                      {(e.current || data.canPrepare) && (
                      <footer className="pay-run-foot">
                        {e.current ? (
                          <button
                            className={r?.mineToAct ? "btn btn-primary btn-sm" : "btn btn-sm"}
                            onClick={() => onOpen(e.current!.id)}
                          >
                            {r?.mineToAct ? "Open and act" : "Open"}
                            <CaretRightIcon size={14} aria-hidden="true" />
                          </button>
                        ) : data.canPrepare ? (
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
                        ) : null}
                      </footer>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
          {periods.map((p) => (
            <Card key={p} title={monthLabel(p)} flush>
              <div className="pay-hist">
                {others
                  .filter((r) => r.period === p)
                  .sort((a, b) => Number(b.mineToAct) - Number(a.mineToAct))
                  .map((r) => (
                    <button
                      key={r.id}
                      className="pay-hist-row"
                      data-turn={r.mineToAct ? "yes" : undefined}
                      onClick={() => onOpen(r.id)}
                    >
                      <span className="pay-hist-name">
                        <strong>{r.companyName}</strong>
                        <span className="muted small">{r.totals.headcount} staff</span>
                      </span>
                      <span className="pay-hist-figs">
                        <span>
                          <span className="pay-hist-k">Gross</span> {rm(r.totals.gross)}
                        </span>
                        <span>
                          <span className="pay-hist-k">Net</span> {rm(r.totals.net)}
                        </span>
                        <span>
                          <span className="pay-hist-k">Employer cost</span> {rm(r.totals.cost)}
                        </span>
                      </span>
                      <span className="pay-hist-tags">
                        {r.mineToAct && <Chip tone="warn">Your turn</Chip>}
                        <Chip tone={r.late ? "crit" : STAGE[r.stage][0]}>
                          {r.late ? "Late" : STAGE[r.stage][1]}
                        </Chip>
                        <CaretRightIcon size={14} aria-hidden="true" className="pay-caret" />
                      </span>
                    </button>
                  ))}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}

const REMIT: Record<
  | "not_listed"
  | "no_bill"
  | "to_prepare"
  | "prepared"
  | "approved"
  | "paid"
  | "late",
  [Tone, string]
> = {
  not_listed: ["neutral", "Not on Finance's list"],
  no_bill: ["neutral", "Waiting for the file"],
  to_prepare: ["info", "Finance to prepare"],
  prepared: ["info", "Being approved"],
  approved: ["warn", "Approved, to pay"],
  paid: ["ok", "Paid"],
  late: ["crit", "Late"],
};

function RunDrawer({ runId, onClose }: { runId: string; onClose: () => void }) {
  const { data, error } = useLoad(() => api.staffPayRun(runId), [runId]);
  const [slip, setSlip] = useState<StaffPayLine | null>(null);
  const slipRef = useRef<HTMLDivElement>(null);
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
          <div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setSlip(null)}
            >
              Back to the list
            </button>
          </div>
          <div ref={slipRef}>
            <Payslip
              line={slip}
              period={data.run.period}
              companyName={data.companyName}
            />
          </div>
          <div>
            <button
              className="btn btn-sm"
              onClick={() => downloadSlip(slipRef.current, `${data.run.period}-${slip.staffNo}`)}
            >
              <DownloadSimpleIcon size={16} aria-hidden="true" />
              {data.run.stage === "paid" ? "Download payslip" : "Download draft payslip"}
            </button>
          </div>
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
  // HR's allowance list, read once for the one-off pickers on a draft month.
  const alw = useLoad(() => (can.prepare ? api.allowanceTypes().catch(() => null) : Promise.resolve(null)), [can.prepare]);
  const oneOffTypes = (alw.data?.types ?? []).filter((t) => t.active && t.frequency !== "monthly");
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
    ["Approved by the COO", run.cooApproved],
    ["Paid by Finance", run.paid],
  ];
  const nowAt = steps.findIndex(([, s]) => !s);
  const acts =
    can.submit || can.approve || can.cooApprove || can.pay || can.return || can.prepare;
  return (
    <div className="pay-detail">
      <Stats>
        <Stat label="Staff" value={totals.headcount} />
        <Stat label="Net pay" value={<span className="pay-fig">{rm(totals.net)}</span>} />
        <Stat
          label="Employer cost"
          value={<span className="pay-fig">{rm(totals.cost)}</span>}
          note="Gross, claims, EPF, SOCSO, EIS, HRD"
        />
        <Stat
          label="PCB estimated"
          value={totals.pcbEstimated}
          tone={totals.pcbEstimated ? "warn" : "ok"}
          note="Finance checks in LHDN e-PCB"
        />
      </Stats>
      {data.ownLine && (data.role === "cos" || data.role === "coo") && (
        <div className="notice" data-tone="info">
          Your own salary is in this month. The{" "}
          {data.role === "cos" ? "COO's approval" : "Chief of Staff's approval"}{" "}
          is the second check on it.
        </div>
      )}
      {acts && (
        <section className="pay-yourstep" aria-labelledby="pay-yourstep-h">
          <div className="pay-yourstep-head">
            <h3 id="pay-yourstep-h">Your step</h3>
            <Chip tone="warn">Your turn</Chip>
          </div>
          <ErrorNotice error={act.error} />
          {can.pay && (
            <div className="pay-form">
              <label className="field">
                <span className="label">Bank reference</span>
                <input
                  className="input"
                  placeholder="Bank payment reference"
                  value={bankRef}
                  onChange={(e) => setBankRef(e.target.value)}
                />
              </label>
              <label className="pay-check small">
                <input
                  type="checkbox"
                  checked={pcbChecked}
                  onChange={(e) => setPcbChecked(e.target.checked)}
                />
                PCB checked against LHDN e-PCB for every line
              </label>
            </div>
          )}
          {(can.return || can.approve || can.cooApprove) && (
            <label className="field">
              <span className="label">Comment</span>
              <textarea
                className="textarea pay-note"
                rows={2}
                placeholder={
                  can.approve || can.cooApprove
                    ? "Comment (needed to approve; a short one is fine), or what needs to change (to return)"
                    : "What needs to change (to return)"
                }
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          )}
          <div className="pay-actions">
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
                disabled={act.busy || !note.trim()}
                onClick={() =>
                  act.run(
                    () => api.staffPayStep(run.id, "approve", { note }),
                    "Approved, sent to the COO.",
                  )
                }
              >
                Approve
              </button>
            )}
            {can.cooApprove && (
              <button
                className="btn btn-primary btn-sm"
                disabled={act.busy || !note.trim()}
                onClick={() =>
                  act.run(
                    () => api.staffPayStep(run.id, "coo_approve", { note }),
                    "Approved, Finance can pay.",
                  )
                }
              >
                Approve as COO
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
        </section>
      )}
      {!acts && <ErrorNotice error={act.error} />}
      {data.blockers.length > 0 && (
        <section className="notice pay-blockers" data-tone="warn" aria-label="Before submitting">
          <h3>Before this month can be submitted</h3>
          <ul>
            {data.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </section>
      )}
      <Card title="Steps">
        <ol className="pay-timeline">
          {steps.map(([label, s], i) => (
            <li key={label} data-state={s ? "done" : i === nowAt ? "now" : "todo"}>
              <span className="pay-timeline-dot" aria-hidden="true">
                {s ? "✓" : i + 1}
              </span>
              <span className="pay-timeline-text">
                <span className="pay-timeline-label">{label}</span>
                <span className="muted small">
                  {s
                    ? `${s.by} · ${dateTimeLabel(s.at)}${s.note ? ` · ${s.note}` : ""}`
                    : "Not yet"}
                </span>
              </span>
            </li>
          ))}
        </ol>
        {run.paid && (
          <p className="muted small pay-after">
            Bank reference {run.paid.bankRef}, paid{" "}
            {dateLabel(run.paid.paidOn)}, PCB checked in e-PCB.
          </p>
        )}
        {run.returns.map((r) => (
          <div key={r.at} className="notice pay-after" data-tone="warn">
            Returned by {r.by} on {dateTimeLabel(r.at)}: {r.note}
          </div>
        ))}
      </Card>
      {data.directorChecks.length > 0 && (
        <Card
          title="For directors to verify"
          sub="Shown only to directors. Payroll carries on as normal; these stay unresolved until the published table is loaded and checked, or the PCB is entered from LHDN's e-PCB."
          actions={<Chip tone="warn">{`${data.directorChecks.length} unresolved`}</Chip>}
          flush
        >
          <ul className="pay-rows">
            {data.directorChecks.map((x) => (
              <li key={x.key} className="pay-row-stack">
                <div className="pay-row-top">
                  <span>{x.text}</span>
                  <Chip tone="warn">{x.status}</Chip>
                </div>
                <div className="muted small">
                  Source: {x.source} · Affects: {x.affected} · Responsible:{" "}
                  {x.responsible}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {data.remittances.length > 0 &&
        ["approved", "consented", "paid"].includes(data.run.stage) && (
          <Card
            title="Contributions and zakat, paid by Finance"
            sub="What this payroll owes EPF, PERKESO, LHDN, HRD Corp and the zakat bodies, due the month after. Shown from Finance's records; nothing to do here."
            flush
          >
            <ul className="pay-rows">
              {data.remittances.map((x) => (
                <li key={x.body} className="pay-row-stack">
                  <div className="pay-row-top">
                    <strong>{x.body}</strong>
                    <Chip tone={REMIT[x.state][0]}>{REMIT[x.state][1]}</Chip>
                  </div>
                  <div className="muted small pay-remit-meta">
                    <span>due {dateLabel(x.dueOn)}</span>
                    {x.amount != null && <span className="pay-fig">RM{x.amount.toFixed(2)}</span>}
                    {x.paidOn && <span>paid {dateLabel(x.paidOn)}</span>}
                    {x.seenInBank && <span>seen in the bank</span>}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      {can.export && (
        <Card
          title="Draft files for Finance"
          sub="Prima does not send these anywhere. Finance checks them, then uploads to the bank, SQL Account, KWSP, PERKESO and LHDN."
        >
          <div className="pay-control">
            <p className="small">
              Control total: {data.control.count} payments,{" "}
              <span className="pay-fig">
                RM
                {data.control.net.toLocaleString("en-MY", {
                  minimumFractionDigits: 2,
                })}
              </span>
              , check code <span className="mono">{data.control.code}</span>.
            </p>
            <p className="muted small">
              Finance matches these on the bank portal before releasing. Only
              Finance takes the bank file.
            </p>
          </div>
          <div className="pay-files">
            {FILES.filter(([k]) => k !== "bank" || can.bankFile).map(
              ([k, label]) => (
                <button
                  key={k}
                  className="btn btn-sm"
                  disabled={act.busy}
                  onClick={() => download(k)}
                >
                  <FileCsvIcon size={16} aria-hidden="true" />
                  {label}
                </button>
              ),
            )}
          </div>
        </Card>
      )}
      <Card
        title="Staff"
        sub={
          <span className="pay-fig">
            EPF {rm(totals.epf)} · PCB {rm(totals.pcb)} · HRD {rm(totals.hrd)}
          </span>
        }
        actions={
          run.lines.length > 0 ? (
            <AllPayslips lines={run.lines} period={run.period} companyName={data.companyName} paid={run.stage === "paid"} />
          ) : undefined
        }
        flush
      >
        <SocsoColumns lines={run.lines} totals={totals} />
        <ul className="pay-lines">
          {run.lines.map((l) => (
            <li key={l.personId} className="pay-line" data-flagged={l.flags.length ? "yes" : undefined}>
              <div className="pay-line-head">
                <button
                  className="pay-line-name"
                  onClick={() => onSlip(l)}
                  aria-label={`Payslip for ${l.name}`}
                >
                  <Person name={l.name} sub={l.jobTitle} size={32} />
                </button>
                <span className="pay-line-net">
                  <span className="pay-line-k">Net</span>
                  {rm(l.net)}
                </span>
              </div>
              <dl className="pay-line-figs">
                <div>
                  <dt>Gross</dt>
                  <dd>{rm(l.gross)}</dd>
                </div>
                <div>
                  <dt>EPF</dt>
                  <dd>{rm(l.epfEe)}</dd>
                </div>
                <div>
                  <dt>SOCSO</dt>
                  <dd>{rm(l.socsoEe)}</dd>
                </div>
                <div>
                  <dt>LINDUNG</dt>
                  <dd>{l.lindungStatus === "opted_out" ? "opted out" : rm(l.lindungEe)}</dd>
                </div>
                <div>
                  <dt>EIS</dt>
                  <dd>{rm(l.eisEe)}</dd>
                </div>
                <div>
                  <dt>PCB{l.pcbSource === "estimate" && l.pcb > 0 ? " (estimate)" : ""}</dt>
                  <dd>{rm(l.pcb)}</dd>
                </div>
                {l.claims ? (
                  <div>
                    <dt>Claims</dt>
                    <dd>{rm(l.claims)}</dd>
                  </div>
                ) : null}
              </dl>
              {l.flags.length > 0 && (
                <ul className="pay-flags">
                  {l.flags.map((f) => (
                    <li key={f}>
                      <WarningCircleIcon size={14} aria-hidden="true" />
                      {f}
                    </li>
                  ))}
                </ul>
              )}
              {can.prepare && (
                <div className="pay-line-edit">
                  <PcbEdit runId={run.id} line={l} />
                  <OneOffEdit runId={run.id} line={l} types={oneOffTypes} />
                  {l.partMonth && <PartPayEdit runId={run.id} line={l} />}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/**
 * Every payslip of the month in one file (P78), to print or keep: marked as a draft until Finance has paid the month.
 * Staff still see their own payslip in the app once it is paid.
 */
function AllPayslips({
  lines,
  period,
  companyName,
  paid,
}: {
  lines: StaffPayLine[];
  period: string;
  companyName: string;
  paid: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [making, setMaking] = useState(false);
  useEffect(() => {
    if (!making) return;
    downloadSlip(ref.current, `${period}-${paid ? "all" : "draft"}`);
    setMaking(false);
  }, [making, period, paid]);
  return (
    <>
      <button className="btn btn-sm" disabled={making} onClick={() => setMaking(true)}>
        <DownloadSimpleIcon size={16} aria-hidden="true" />
        {paid ? "Download all payslips" : "Download draft payslips"}
      </button>
      {making && (
        <div ref={ref} hidden>
          {!paid && <p className="muted">Draft: not paid yet. Figures may still change before Finance pays the month.</p>}
          {lines.map((l) => (
            <Payslip key={l.personId} line={l} period={period} companyName={companyName} />
          ))}
        </div>
      )}
    </>
  );
}

function PcbEdit({ runId, line }: { runId: string; line: StaffPayLine }) {
  const act = useAction();
  const [pcb, setPcb] = useState(
    line.pcbSource === "entered" ? String(line.pcb) : "",
  );
  return (
    <div className="pay-edit">
      <input
        className="input pay-in-sm"
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

/**
 * Part-month pay (Arisha main review, 3 Nov 2026): no proration rule is set, so HR enters the basic and the fixed
 * allowances for the days worked, with how it was worked out. The month cannot be submitted until every such line has it.
 */
function PartPayEdit({ runId, line }: { runId: string; line: StaffPayLine }) {
  const act = useAction();
  const [basic, setBasic] = useState(line.partPay ? String(line.partPay.basic) : "");
  const [allow, setAllow] = useState(line.partPay ? String(line.partPay.allowances) : "");
  const [note, setNote] = useState(line.partPay?.note ?? "");
  return (
    <div className="pay-edit">
      <span className="small pay-edit-label">
        Part month {dateLabel(line.partMonth!.from)} to {dateLabel(line.partMonth!.to)}:
      </span>
      <input className="input pay-in-sm" inputMode="decimal" aria-label={`Part-month basic for ${line.name}`} placeholder="Basic, RM" value={basic} onChange={(e) => setBasic(e.target.value)} />
      <input className="input pay-in-md" inputMode="decimal" aria-label={`Part-month allowances for ${line.name}`} placeholder="Fixed allowances, RM" value={allow} onChange={(e) => setAllow(e.target.value)} />
      <input className="input pay-in-lg" aria-label={`How the part-month pay was worked out for ${line.name}`} placeholder="How it was worked out" value={note} onChange={(e) => setNote(e.target.value)} />
      <button
        className="btn btn-sm"
        disabled={act.busy || basic.trim() === "" || note.trim().length < 5}
        onClick={() =>
          act.run(
            () => api.setStaffPayLine(runId, line.personId, { partPay: { basic: Number(basic), allowances: allow.trim() === "" ? 0 : Number(allow), note } }),
            "Part-month pay saved.",
          )
        }
      >
        Save part-month pay
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

/**
 * One-off allowances in the month come from HR's allowance list (Fauzan, 3 Nov 2026), so each keeps its EPF, SOCSO,
 * PCB and HRD ticks. A one-off on HR's own line is flagged for the Chief of Staff and the COO.
 */
function OneOffEdit({ runId, line, types: oneOff }: { runId: string; line: StaffPayLine; types: { id: string; name: string }[] }) {
  const act = useAction();
  const [typeId, setTypeId] = useState("");
  const [amount, setAmount] = useState("");
  const extra = line.allowanceLines.filter((a) => !a.fixed);
  const save = (next: { label: string; amount: number; typeId?: string | null }[], msg: string) =>
    act.run(() => api.setStaffPayLine(runId, line.personId, { extra: next }), msg);
  return (
    <div className="pay-edit">
      {extra.map((a, i) => (
        <span key={i} className="small pay-oneoff">
          One-off: {a.label} <span className="pay-fig">{rm(a.amount)}</span>{" "}
          <button className="btn btn-sm btn-ghost" disabled={act.busy} onClick={() => save(extra.filter((_, k) => k !== i), "One-off removed.")}>
            Remove
          </button>
        </span>
      ))}
      {oneOff.length > 0 && (
        <>
          <Select className="input pay-in-lg" aria-label={`One-off allowance for ${line.name}`} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            <option value="">One-off allowance</option>
            {oneOff.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <input
            className="input pay-in-sm"
            inputMode="decimal"
            aria-label={`One-off amount for ${line.name}`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <button
            className="btn btn-sm"
            disabled={act.busy || !typeId || !(Number(amount) > 0)}
            onClick={async () => {
              const r = await save([...extra, { label: "", amount: Number(amount), typeId }], "One-off added.");
              if (r) {
                setTypeId("");
                setAmount("");
              }
            }}
          >
            Add one-off
          </button>
        </>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

/**
 * Fauzan, 2 Nov 2026 (slice 3F): payslips are delivered in the app and staff download them. The file is the payslip
 * as shown, as a page the staff member can keep or print to PDF. Nothing leaves the phone.
 */
function downloadSlip(node: HTMLElement | null, period: string) {
  if (!node) return;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Payslip ${period}</title><style>body{font-family:system-ui,sans-serif;max-width:640px;margin:24px auto;padding:0 16px;color:#111}.list-item{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #ddd}.muted{color:#555}h3{margin:0 0 4px}section{margin-bottom:32px;break-after:page}</style></head><body>${node.innerHTML}</body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `payslip-${period}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Mine({ data }: { data: StaffPayBoard }) {
  const [open, setOpen] = useState<number | null>(null);
  const slipRef = useRef<HTMLDivElement>(null);
  if (!data.mine.length)
    return (
      <div className="pay-mine">
        <Card title="My payslips">
          <Empty title="No payslips yet">
            They appear here once Finance has paid the month.
          </Empty>
        </Card>
        <MyZakat />
      </div>
    );
  const slip = open == null ? null : data.mine[open];
  const years = [...new Set(data.mine.map((m) => m.period.slice(0, 4)))];
  return (
    <div className="pay-mine">
      <Card title="My payslips" sub="Open a month to see the payslip and download it." flush>
        {years.map((y) => (
          <div key={y} className="pay-slips-year">
            {years.length > 1 && <h3 className="pay-slips-y">{y}</h3>}
            <ul className="pay-slips">
              {data.mine.map((m, i) =>
                m.period.slice(0, 4) !== y ? null : (
                  <li key={m.runId}>
                    <button className="pay-slip-item" onClick={() => setOpen(i)}>
                      <span className="pay-slip-month">
                        <strong>{monthLabel(m.period)}</strong>
                        <span className="muted small">
                          {m.companyName} · Paid {dateLabel(m.paidOn)}
                        </span>
                      </span>
                      <span className="pay-slip-net pay-fig">{rm(m.line.net)}</span>
                      <CaretRightIcon size={14} aria-hidden="true" className="pay-caret" />
                    </button>
                  </li>
                ),
              )}
            </ul>
          </div>
        ))}
      </Card>
      <MyZakat />
      {slip && (
        <Drawer
          title={`Payslip, ${monthLabel(slip.period)}`}
          sub={slip.companyName}
          onClose={() => setOpen(null)}
        >
          <div ref={slipRef}>
            <Payslip
              line={slip.line}
              period={slip.period}
              companyName={slip.companyName}
            />
          </div>
          <div>
            <button
              className="btn btn-sm"
              onClick={() => downloadSlip(slipRef.current, slip.period)}
            >
              <DownloadSimpleIcon size={16} aria-hidden="true" />
              Download payslip
            </button>
          </div>
        </Drawer>
      )}
    </div>
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
  const row = (label: string, amount: number, minus = false, kind?: string) => (
    <div key={label} className="list-item pay-slip-row" data-kind={kind}>
      <span>{label}</span>
      <span className="pay-fig">{minus && amount ? `(${rm(amount)})` : rm(amount)}</span>
    </div>
  );
  return (
    <section className="pay-slip">
      <header className="pay-slip-head">
        <h3>
          {l.name} · {l.staffNo}
        </h3>
        <span className="muted small">
          {companyName} · {monthLabel(period)} · {l.jobTitle}
        </span>
      </header>
      <div className="pay-slip-rows">
        {row("Basic pay", l.basic)}
        {l.allowanceLines.map((a) => row(a.label, a.amount))}
        {l.unpaidDays > 0 &&
          row(
            `Unpaid leave, ${l.unpaidDays} day${l.unpaidDays === 1 ? "" : "s"}`,
            l.unpaidDeduction,
            true,
          )}
        {row("Gross pay", l.gross, false, "sum")}
        {row("EPF (employee)", l.epfEe, true)}
        {row("SOCSO (employee)", l.socsoEe, true)}
        {l.lindungStatus === "opted_out" ? (
          <div className="list-item pay-slip-row">
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
          `${l.pcbSource === "estimate" ? "PCB (estimate)" : "PCB"}${(l.zakat ?? 0) > 0 ? `, after zakat rebate of ${rm(Math.min(l.zakat ?? 0, l.pcbBeforeZakat ?? 0))}` : ""}`,
          l.pcb,
          true,
        )}
        {(l.zakat ?? 0) > 0 &&
          row(
            `Zakat to ${l.zakatBody} (${l.zakatPercent}%, your choice)`,
            l.zakat ?? 0,
            true,
          )}
        {l.claims > 0 && row("Claims paid back", l.claims)}
        <div className="list-item pay-slip-row" data-kind="net">
          <strong>Net pay</strong>
          <strong className="pay-fig">{rm(l.net)}</strong>
        </div>
      </div>
      <p className="muted small pay-slip-foot">
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
    <div className="table-wrap pay-socso">
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
          <tr className="pay-total">
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

/** The staff member's own zakat deduction (Fauzan, 2 Nov 2026): which body and what percentage of gross pay. */
function MyZakat() {
  const { data, error, reload } = useLoad(
    () => api.myZakat().catch(() => null),
    [],
  );
  const act = useAction();
  const [body, setBody] = useState<string | null>(null);
  const [pct, setPct] = useState<string | null>(null);
  if (error || !data) return null;
  const b = body ?? data.choice?.body ?? "";
  const p = pct ?? String(data.choice?.percent ?? data.usualPercent);
  const est =
    data.basicPay && b ? (data.basicPay * Number(p || 0)) / 100 : null;
  return (
    <Card
      title="My zakat deduction"
      actions={
        <Chip tone={data.choice ? "ok" : "neutral"}>
          {data.choice
            ? `${data.choice.percent}% to ${data.choice.body}`
            : "None"}
        </Chip>
      }
    >
      <div className="pay-zakat">
        <p className="muted small">
          Your choice: the zakat body and the percentage of your gross pay. It is
          deducted from your salary, paid by the company to the body, and your PCB
          goes down by the same amount. It applies from the next payroll HR
          prepares. Only you can change or stop it.
        </p>
        <label className="field">
          <span className="label">Zakat body</span>
          <Select
            className="select"
            value={b}
            onChange={(e) => setBody(e.target.value)}
          >
            <option value="">No zakat deduction</option>
            {data.bodies.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </Select>
        </label>
        {b && (
          <label className="field">
            <span className="label">
              Percentage of gross pay ({data.minPercent}% to {data.maxPercent}%)
            </span>
            <input
              className="input"
              inputMode="decimal"
              value={p}
              onChange={(e) => setPct(e.target.value)}
            />
          </label>
        )}
        {est != null && (
          <p className="muted small">
            About <span className="pay-fig">{rm(Math.round(est * 100) / 100)}</span> a month on your basic pay.
          </p>
        )}
        <div>
          <button
            className="btn btn-primary"
            disabled={act.busy}
            onClick={async () => {
              const ok = await act.run(
                () =>
                  api.setMyZakat(
                    b ? { body: b, percent: Number(p) } : { body: null },
                  ),
                b
                  ? "Saved. It applies from the next payroll."
                  : "Zakat deduction stopped from the next payroll.",
              );
              if (ok) {
                setBody(null);
                setPct(null);
                reload();
              }
            }}
          >
            {b
              ? "Save my choice"
              : data.choice
                ? "Stop my zakat deduction"
                : "Save"}
          </button>
        </div>
        <ErrorNotice error={act.error} />
        {data.history.length > 0 && (
          <div className="muted small">
            Changes:{" "}
            {data.history
              .slice(0, 4)
              .map(
                (h) =>
                  `${dateLabel(h.at.slice(0, 10))} ${h.body ? `${h.percent}% ${h.body}` : "stopped"}`,
              )
              .join(" · ")}
          </div>
        )}
      </div>
    </Card>
  );
}
