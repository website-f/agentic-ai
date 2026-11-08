import { Select } from '../SearchSelect';
import { useState } from "react";
import { COMPULSORY_HOLIDAY_LABEL, LEAVE_LABEL, isOwnerAdmin } from "@prima/core";
import { api } from "../api";
import { useApp } from "../App";
import {
  Chip,
  ErrorNotice,
  Loading,
  dateLabel,
  useAction,
  useLoad,
} from "../ui";
import { Avatar, Card, Empty, Search, Steps, Toolbar } from "../kit";
import "../styles/leave.css";
import { ImportButton } from "./ImportDrawer";

/**
 * HR Phase 3, slice 3C (Fauzan, 2 Nov 2026): public holidays HR keeps (more than the Act if HR wants), leave days HR
 * gives above the Act, working from home only for staff HR allows, and flexible hours or days requests.
 */
function keepsHr(u: {
  role: string;
  department?: string | null;
  leadership?: string | null;
}) {
  return (
    (u.role === "pwvsb_officer" && u.department === "hr") ||
    u.leadership === "cos" ||
    u.leadership === "deputy_cos"
  );
}

type Compulsory = keyof typeof COMPULSORY_HOLIDAY_LABEL;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A small calendar leaf: the day over the month. */
function DateLeaf({ date }: { date: string }) {
  return (
    <span className="lv-leaf" aria-hidden="true">
      <span className="lv-leaf-m">{MONTHS[Number(date.slice(5, 7)) - 1] ?? ""}</span>
      <span className="lv-leaf-d">{Number(date.slice(8, 10)) || ""}</span>
    </span>
  );
}

export function HolidaysPanel() {
  const [year, setYear] = useState(
    String(new Date(Date.now() + 8 * 3_600_000).getUTCFullYear()),
  );
  const list = useLoad(() => api.publicHolidays(year), [year]);
  const act = useAction();
  const [f, setF] = useState({
    date: "",
    name: "",
    states: "",
    compulsory: "" as "" | Compulsory,
    note: "",
  });
  const [why, setWhy] = useState<Record<string, string>>({});
  if (list.error) return <ErrorNotice error={list.error} />;
  if (!list.data) return <Loading what="public holidays" />;
  const d = list.data;
  const short = d.checks.filter((c) => !c.ok);
  return (
    <Card
      title={`Public holidays ${d.year}`}
      sub={`Staff leave skips these days and weekends. The Act needs at least ${d.rule.value.minPerYear} a year with the five fixed ones; HR may add more.`}
      actions={
        <>
        {d.canEdit && <ImportButton kind="publicHoliday" />}
        <Select
          className="select"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          aria-label="Year"
        >
          {[0, 1].map((n) => {
            const y = String(Number(new Date().getUTCFullYear()) + n);
            return (
              <option key={y} value={y}>
                {y}
              </option>
            );
          })}
        </Select>
        </>
      }
      flush
    >
      {short.length > 0 && (
        <div className="lv-pad">
          <div className="notice small" data-tone="warn">
            Not complete yet for {short.length} state
            {short.length === 1 ? "" : "s"}:{" "}
            {short
              .slice(0, 6)
              .map(
                (c) =>
                  `${c.state} (${c.count} of ${c.min}${c.missing.length ? `, missing ${c.missing.map((m) => COMPULSORY_HOLIDAY_LABEL[m]).join(", ")}` : ""})`,
              )
              .join("; ")}
            {short.length > 6 ? " …" : ""}
          </div>
        </div>
      )}
      <div className="lv-rows">
        {d.holidays.length === 0 && (
          <div className="empty">No holidays entered for {d.year} yet.</div>
        )}
        {d.holidays.map((h) => (
          <div key={h.id} className="lv-row lv-holiday" data-removed={h.removed ? "true" : undefined}>
            <DateLeaf date={h.date} />
            <div className="lv-row-text">
              <div className="lv-req-title lv-strike">
                {dateLabel(h.date)} · {h.name}
              </div>
              <div className="lv-req-sub">
                {h.states ? h.states.join(", ") : "All states"}
                {h.compulsory ? ` · fixed by the Act` : ""}
                {h.removed
                  ? ` · removed by ${h.removed.by}: ${h.removed.note}`
                  : ` · added by ${h.addedBy}`}
              </div>
            </div>
            {d.canEdit && !h.removed && (
              <div className="lv-remove">
                <input
                  className="input"
                  placeholder="Reason to remove"
                  aria-label={`Reason to remove ${h.name}`}
                  value={why[h.id] ?? ""}
                  onChange={(e) =>
                    setWhy((x) => ({ ...x, [h.id]: e.target.value }))
                  }
                />
                <button
                  className="btn btn-sm"
                  disabled={act.busy || !(why[h.id] ?? "").trim()}
                  onClick={() =>
                    void act
                      .run(
                        () => api.removePublicHoliday(h.id, why[h.id] ?? ""),
                        "Holiday removed.",
                      )
                      .then(() => list.reload())
                  }
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {d.canEdit && (
        <div className="lv-pad lv-divide">
          <div className="lv-formbox">
            <h3 className="lv-formbox-title">Add a holiday</h3>
            <div className="lv-form">
              <label className="field">
                <span className="label">Date</span>
                <input
                  className="input"
                  type="date"
                  value={f.date}
                  onChange={(e) => setF({ ...f, date: e.target.value })}
                  aria-label="Holiday date"
                />
              </label>
              <label className="field">
                <span className="label">Name</span>
                <input
                  className="input"
                  value={f.name}
                  onChange={(e) => setF({ ...f, name: e.target.value })}
                  aria-label="Holiday name"
                  placeholder="e.g. Hari Raya Aidilfitri"
                />
              </label>
              <label className="field">
                <span className="label">States (empty for all)</span>
                <input
                  className="input"
                  value={f.states}
                  onChange={(e) => setF({ ...f, states: e.target.value })}
                  aria-label="States"
                  placeholder={d.checks
                    .map((c) => c.state)
                    .slice(0, 2)
                    .join(", ")}
                />
              </label>
              <label className="field">
                <span className="label">Fixed by the Act?</span>
                <Select
                  className="select"
                  value={f.compulsory}
                  onChange={(e) =>
                    setF({ ...f, compulsory: e.target.value as "" | Compulsory })
                  }
                  aria-label="Fixed holiday"
                >
                  <option value="">No</option>
                  {(Object.keys(COMPULSORY_HOLIDAY_LABEL) as Compulsory[]).map(
                    (k) => (
                      <option key={k} value={k}>
                        {COMPULSORY_HOLIDAY_LABEL[k]}
                      </option>
                    ),
                  )}
                </Select>
              </label>
              <div className="lv-form-foot">
                <ErrorNotice error={act.error} />
                <button
                  className="btn btn-primary"
                  disabled={act.busy || !f.date || f.name.trim().length < 3}
                  onClick={async () => {
                    const states = f.states
                      .split(",")
                      .map((x) => x.trim())
                      .filter(Boolean);
                    const r = await act.run(
                      () =>
                        api.addPublicHoliday({
                          date: f.date,
                          name: f.name,
                          states: states.length ? states : null,
                          compulsory: f.compulsory || null,
                          note: f.note,
                        }),
                      "Holiday added.",
                    );
                    if (r) {
                      setF({
                        date: "",
                        name: "",
                        states: "",
                        compulsory: "",
                        note: "",
                      });
                      list.reload();
                    }
                  }}
                >
                  Add holiday
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

const OVERRIDE_KINDS = ["ANNUAL", "SICK", "MATERNITY", "PATERNITY"] as const;

/** HR's list of office staff: who may work from home, and leave days HR gives above the Act. */
export function HrLeaveSettingsPanel() {
  const { me } = useApp();
  // P78: the owner sets these like HR (the server checks the same).
  const hr = keepsHr(me.user) || isOwnerAdmin(me.user);
  const list = useLoad(
    () => (hr ? api.hrLeaveSettings() : Promise.resolve(null)),
    [hr],
  );
  const act = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<(typeof OVERRIDE_KINDS)[number]>("ANNUAL");
  const [days, setDays] = useState("");
  const [q, setQ] = useState("");
  if (!hr) return null;
  if (list.error) return <ErrorNotice error={list.error} />;
  if (!list.data) return <Loading what="staff leave settings" />;
  const rows = list.data.staff.filter(
    (s) =>
      !q || `${s.name} ${s.staffNo}`.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <Card
      title="Working from home and extra leave"
      sub="Working from home stays blocked until HR allows it for the staff member. HR may give more leave than the Act, never less."
      actions={
        <>
          <Chip tone="info">
            {list.data.staff.filter((s) => s.wfhAllowed).length} may work from
            home
          </Chip>
          <ImportButton kind="leaveEntitlement" label="Import leave days" />
        </>
      }
      flush
    >
      <div className="lv-pad">
        <Toolbar end={<span className="muted small">{rows.length > 50 ? `First 50 of ${rows.length}` : `${rows.length} staff`}</span>}>
          <Search value={q} onChange={setQ} placeholder="Find staff" />
        </Toolbar>
      </div>
      <div className="lv-rows">
        {rows.length === 0 && <Empty title="No staff match">Try another name or staff number.</Empty>}
        {rows.slice(0, 50).map((s) => (
          <div key={s.personId} className="lv-staff">
            <div className="lv-row">
              <Avatar name={s.name} size={36} />
              <div className="lv-row-text">
                <div className="lv-req-title">
                  {s.name} ({s.staffNo}) {s.jobTitle ? `· ${s.jobTitle}` : ""}
                </div>
                <div className="lv-req-sub">
                  {s.wfhAllowed
                    ? `Working from home allowed by ${s.wfhAllowed.by}`
                    : "Working from home not allowed"}
                  {Object.entries(s.overrides).map(
                    ([k, o]) =>
                      ` · ${LEAVE_LABEL[k as (typeof OVERRIDE_KINDS)[number]]} ${o!.days} days`,
                  )}
                </div>
              </div>
              {!s.own && (
                <button
                  className="btn btn-sm"
                  aria-expanded={open === s.personId}
                  onClick={() =>
                    setOpen(open === s.personId ? null : s.personId)
                  }
                >
                  {open === s.personId ? "Close" : "Change"}
                </button>
              )}
            </div>
            {open === s.personId && (
              <div className="lv-formbox lv-staff-edit">
                <label className="field">
                  <span className="label">Reason (needed)</span>
                  <input
                    className="input"
                    placeholder="Reason (needed)"
                    aria-label="Reason"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <div className="lv-staff-groups">
                  <div className="lv-staff-group">
                    <span className="label">Working from home</span>
                    <button
                      className="btn btn-sm"
                      disabled={act.busy || !note.trim()}
                      onClick={() =>
                        void act
                          .run(
                            () =>
                              api.setWfhAllowed(s.personId, !s.wfhAllowed, note),
                            s.wfhAllowed
                              ? "Working from home stopped."
                              : "Working from home allowed.",
                          )
                          .then(() => list.reload())
                      }
                    >
                      {s.wfhAllowed
                        ? "Stop working from home"
                        : "Allow working from home"}
                    </button>
                  </div>
                  <div className="lv-staff-group">
                    <span className="label">Leave days above the Act</span>
                    <div className="lv-inline">
                      <Select
                        className="select"
                        value={kind}
                        onChange={(e) =>
                          setKind(e.target.value as (typeof OVERRIDE_KINDS)[number])
                        }
                        aria-label="Leave kind"
                      >
                        {OVERRIDE_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {LEAVE_LABEL[k]}
                          </option>
                        ))}
                      </Select>
                      <input
                        className="input lv-days"
                        inputMode="numeric"
                        placeholder="Days"
                        aria-label="Days"
                        value={days}
                        onChange={(e) => setDays(e.target.value)}
                      />
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={act.busy || !note.trim() || !/^\d+$/.test(days)}
                        onClick={() =>
                          void act
                            .run(
                              () =>
                                api.setLeaveOverride(
                                  s.personId,
                                  kind,
                                  Number(days),
                                  note,
                                ),
                              "Leave days set.",
                            )
                            .then(() => list.reload())
                        }
                      >
                        Set days
                      </button>
                      {s.overrides[kind] && (
                        <button
                          className="btn btn-sm btn-ghost"
                          disabled={act.busy || !note.trim()}
                          onClick={() =>
                            void act
                              .run(
                                () =>
                                  api.setLeaveOverride(
                                    s.personId,
                                    kind,
                                    null,
                                    note,
                                  ),
                                "Back to the Act.",
                              )
                              .then(() => list.reload())
                          }
                        >
                          Back to the Act
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {act.error && (
        <div className="lv-pad">
          <ErrorNotice error={act.error} />
        </div>
      )}
    </Card>
  );
}

/** Flexible hours or days (Employment Act s.60P): staff ask, HR answers in writing within 60 days. */
export function FlexPanel() {
  const list = useLoad(() => api.flexRequests(), []);
  const act = useAction();
  const { me } = useApp();
  const [asking, setAsking] = useState(false);
  const [f, setF] = useState({
    kind: "hours" as "hours" | "days",
    detail: "",
    reason: "",
    from: "",
  });
  const [note, setNote] = useState<Record<string, string>>({});
  if (list.error) return <ErrorNotice error={list.error} />;
  if (!list.data) return <Loading what="flexible work requests" />;
  const d = list.data;
  const staff = !!me.user.personId;
  if (!d.canDecide && !staff) return null;
  const pending = d.rows.filter((r) => r.status === "pending");
  return (
    <Card
      title="Flexible hours or days"
      sub="Ask HR for different hours or days. HR answers in writing within 60 days, with the reasons if it says no."
      actions={
        <>
          {d.canDecide && (
            <Chip tone={pending.length ? "warn" : "ok"}>
              {pending.length} waiting
            </Chip>
          )}
          {staff && !asking && !pending.some((r) => r.own) && (
            <button className="btn btn-sm" onClick={() => setAsking(true)}>
              Ask for flexible hours or days
            </button>
          )}
        </>
      }
      flush
    >
      {asking && (
        <div className="lv-pad">
          <div className="lv-formbox">
            <h3 className="lv-formbox-title">Ask for flexible hours or days</h3>
            <div className="lv-form">
              <label className="field">
                <span className="label">Hours or days</span>
                <select
                  className="select"
                  value={f.kind}
                  onChange={(e) =>
                    setF({ ...f, kind: e.target.value as "hours" | "days" })
                  }
                  aria-label="Hours or days"
                >
                  <option value="hours">Hours</option>
                  <option value="days">Days</option>
                </select>
              </label>
              <label className="field">
                <span className="label">From</span>
                <input
                  className="input"
                  type="date"
                  value={f.from}
                  onChange={(e) => setF({ ...f, from: e.target.value })}
                  aria-label="From"
                />
              </label>
              <label className="field lv-full">
                <span className="label">What you ask for</span>
                <input
                  className="input"
                  placeholder="What you ask for, e.g. 8.00 to 5.00"
                  aria-label="What you ask for"
                  value={f.detail}
                  onChange={(e) => setF({ ...f, detail: e.target.value })}
                />
              </label>
              <label className="field lv-full">
                <span className="label">Reason</span>
                <input
                  className="input"
                  placeholder="Reason"
                  aria-label="Reason"
                  value={f.reason}
                  onChange={(e) => setF({ ...f, reason: e.target.value })}
                />
              </label>
              <div className="lv-form-foot">
                <button className="btn btn-ghost" onClick={() => setAsking(false)}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  disabled={
                    act.busy ||
                    f.detail.trim().length < 5 ||
                    f.reason.trim().length < 5 ||
                    !f.from
                  }
                  onClick={async () => {
                    const r = await act.run(
                      () => api.requestFlex({ ...f, to: null }),
                      "Sent to HR.",
                    );
                    if (r) {
                      setAsking(false);
                      list.reload();
                    }
                  }}
                >
                  Send to HR
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="lv-rows">
        {d.rows.length === 0 && <div className="empty">No requests.</div>}
        {d.rows.slice(0, 30).map((r) => (
          <article key={r.id} className="lv-req">
            <header className="lv-req-head">
              {d.canDecide && <Avatar name={r.name} size={40} />}
              <div className="lv-req-who">
                <div className="lv-req-title">
                  {d.canDecide ? `${r.name}: ` : ""}flexible {r.kind} from{" "}
                  {dateLabel(r.from)}
                </div>
                <div className="lv-req-sub">
                  {r.detail} · {r.reason}
                </div>
              </div>
              <div className="lv-req-status">
                <Chip
                  tone={
                    r.status === "approved"
                      ? "ok"
                      : r.status === "refused"
                        ? "crit"
                        : r.overdue
                          ? "crit"
                          : "warn"
                  }
                >
                  {r.overdue ? "overdue" : r.status}
                </Chip>
              </div>
            </header>
            <div className="lv-steps">
              <Steps
                steps={[
                  { label: "Asked", state: "done" },
                  r.status === "pending"
                    ? { label: "HR answers in writing", state: r.overdue ? "stopped" : "now", note: `answer by ${dateLabel(r.answerBy)}` }
                    : {
                        label: r.status === "approved" ? "Approved" : "Refused",
                        state: r.status === "approved" ? "done" : "stopped",
                        note: `${r.status} by ${r.decidedBy}: ${r.note}`,
                      },
                ]}
              />
            </div>
            {d.canDecide && r.status === "pending" && !r.own && (
              <div className="lv-req-act">
                <div className="lv-decide">
                  <input
                    className="input"
                    placeholder="Written answer (needed; give the grounds for a refusal)"
                    aria-label={`Answer for ${r.name}`}
                    value={note[r.id] ?? ""}
                    onChange={(e) =>
                      setNote((x) => ({ ...x, [r.id]: e.target.value }))
                    }
                  />
                  <div className="lv-decide-btns">
                    <button
                      className="btn btn-sm"
                      disabled={act.busy || (note[r.id] ?? "").trim().length < 10}
                      onClick={() =>
                        void act
                          .run(
                            () => api.decideFlex(r.id, false, note[r.id] ?? ""),
                            "Refused in writing.",
                          )
                          .then(() => list.reload())
                      }
                    >
                      Refuse
                    </button>
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={act.busy || !(note[r.id] ?? "").trim()}
                      onClick={() =>
                        void act
                          .run(
                            () => api.decideFlex(r.id, true, note[r.id] ?? ""),
                            "Approved.",
                          )
                          .then(() => list.reload())
                      }
                    >
                      Approve
                    </button>
                  </div>
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
      {act.error && (
        <div className="lv-pad">
          <ErrorNotice error={act.error} />
        </div>
      )}
    </Card>
  );
}
