import { useState } from "react";
import { api, type Cms, type CmsSettingsPatch } from "../api";
import { useApp } from "../App";
import { ATTENDANCE_ISSUE_LABEL, type AttendanceIssueView } from "@prima/core";
import {
  Chip,
  ErrorNotice,
  Kpi,
  Loading,
  dateLabel,
  hhmm,
  useAction,
  useLoad,
  type Tone,
} from "../ui";
import { AlertState, FollowUpDrawer } from "./FollowUp";
import { RecordButton } from "./RecordForm";

type Tab =
  | "now"
  | "emergencies"
  | "sites"
  | "roster"
  | "phones"
  | "settings"
  | "duties"
  | "staff";

const TABS: { id: Tab; label: string }[] = [
  { id: "now", label: "Now" },
  { id: "emergencies", label: "Emergencies and incidents" },
  { id: "sites", label: "Sites" },
  { id: "phones", label: "Phone desk" },
  { id: "roster", label: "Roster" },
  { id: "settings", label: "Settings" },
  { id: "duties", label: "What CMS does" },
  { id: "staff", label: "Staff" },
];

const POST: Record<Cms["staff"][number]["posts"][number], string> = {
  HEAD_CONTROL: "Head Control",
  MONITOR_OFFICER: "Monitor Officer",
};

const SEAT: Record<
  Cms["roster"][number]["seats"][number]["state"],
  { label: string; tone: Tone }
> = {
  on_duty: { label: "On duty", tone: "ok" },
  awaiting: { label: "Starting", tone: "info" },
  no_show: { label: "Not clocked in", tone: "crit" },
  uncovered: { label: "Nobody rostered", tone: "crit" },
  later: { label: "Rostered", tone: "neutral" },
  done: { label: "Done", tone: "neutral" },
};

const DUTY: Record<
  Cms["duties"][number]["status"],
  { label: string; tone: Tone }
> = {
  in_app: { label: "In the app", tone: "ok" },
  mock_feed: { label: "In the app, feed not connected", tone: "info" },
  planned: { label: "Planned", tone: "neutral" },
  off: { label: "Off by policy", tone: "unknown" },
};

/**
 * CMS management (Fauzan, 25 Oct 2026). Arms Control sets the roster and the CMS parameters; every
 * shift has 1 Head Control and 1 Monitor Officer. CMS is also the focal point for every company's
 * IP phones. CMS monitors and escalates; each company still decides (V13 s.2).
 */
export function CmsView() {
  const [tab, setTab] = useState<Tab>("now");
  const { data, error } = useLoad(() => api.cms(), []);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="CMS" />
      </div>
    );
  const t = data.tiles;
  const o = data.ops.tiles;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>CMS command centre</h1>
          <p>
            The 24-hour centre that watches every site of every company: guards'
            attendance and patrols, CCTV linked from sites, emergencies and
            incidents, arms out of the vault and vault watch, and every
            company's IP phones. Each shift has at least{" "}
            {data.minimum.headControl} Head Control and{" "}
            {data.minimum.monitorOfficers} Monitor Officer. Arms Control sets
            the roster and the settings. CMS monitors and escalates; the company
            decides.
          </p>
        </div>
      </div>
      <div className="kpis">
        <Kpi
          label="Emergencies not acknowledged"
          value={o.alarmsNotAcked}
          tone={o.alarmsLate ? "crit" : o.alarmsNotAcked ? "warn" : "ok"}
          note={`Acknowledge within ${data.settings.alarmAckSec} s`}
        />
        <Kpi
          label="Guards on post now"
          value={`${o.guardsOnDuty} of ${o.guardsExpected}`}
          tone={o.noShow + o.uncovered ? "crit" : o.late ? "warn" : "ok"}
          note={`${o.noShow} not clocked in, ${o.uncovered} posts empty`}
        />
        <Kpi
          label="Patrols missed"
          value={o.patrolMissedSites}
          tone={o.patrolMissedSites ? "warn" : "ok"}
          note="Sites with a checkpoint not tapped in time"
        />
        <Kpi
          label="Open incidents"
          value={o.incidentsOpen}
          tone={o.p1Open ? "crit" : o.incidentsOpen ? "warn" : "ok"}
          note={`${o.p1Open} P1`}
        />
        <Kpi
          label="CCTV live"
          value={`${o.cctvLive} of ${o.sites}`}
          tone={o.cctvFaults ? "crit" : "ok"}
          note={`${o.cctvFaults} faults, ${o.notLinked} sites not linked`}
        />
        <Kpi
          label="CMS on shift"
          value={`${t.onShiftNow} of ${t.seatsNow}`}
          tone={t.seatsNow && t.onShiftNow === t.seatsNow ? "ok" : "crit"}
          note={`${t.rosterGaps} empty seats ahead`}
        />
        <Kpi
          label="To call back"
          value={t.awaitingCallback}
          tone={t.lateCallbacks ? "crit" : t.awaitingCallback ? "warn" : "ok"}
          note={`${t.lateCallbacks} late`}
        />
      </div>
      <div className="tabbar" role="tablist" aria-label="CMS sections">
        {TABS.map((x) => (
          <button
            key={x.id}
            role="tab"
            aria-selected={tab === x.id}
            onClick={() => setTab(x.id)}
          >
            {x.label}
            {x.id === "now" && data.alerts.length > 0 && (
              <span className="tab-count">{data.alerts.length}</span>
            )}
            {x.id === "phones" && t.awaitingCallback > 0 && (
              <span className="tab-count">{t.awaitingCallback}</span>
            )}
            {x.id === "emergencies" && o.alarmsNotAcked > 0 && (
              <span className="tab-count">{o.alarmsNotAcked}</span>
            )}
          </button>
        ))}
      </div>
      {tab === "now" && <Now data={data} />}
      {tab === "emergencies" && <Emergencies data={data} />}
      {tab === "sites" && (
        <>
          <AttendanceAlertsPanel data={data} />
          <Sites data={data} />
        </>
      )}
      {tab === "roster" && <RosterTab data={data} />}
      {tab === "phones" && <Phones data={data} />}
      {tab === "settings" && <Settings data={data} />}
      {tab === "duties" && <Duties data={data} />}
      {tab === "staff" && <Staff data={data} />}
    </div>
  );
}

function Now({ data }: { data: Cms }) {
  const c = data.current;
  const { run, busy, error } = useAction();
  const [note, setNote] = useState("");
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>On shift now</h2>
          {c && (
            <span className="muted small">
              {dateLabel(c.date)} {hhmm(c.start)}–{hhmm(c.end)}
            </span>
          )}
        </div>
        <div className="list">
          {!c && (
            <div className="empty">
              No shift is planned for now. Plan the roster.
            </div>
          )}
          {c?.seats.map((s) => (
            <div key={s.shift.id} className="list-item">
              <div>
                <div style={{ fontWeight: 600 }}>
                  {s.shift.staffName ?? "Nobody rostered"}
                </div>
                <div className="muted small">
                  {POST[s.shift.post]}
                  {s.shift.clockIn ? ` · in ${hhmm(s.shift.clockIn)}` : ""}
                </div>
              </div>
              <Chip tone={SEAT[s.state].tone}>{SEAT[s.state].label}</Chip>
            </div>
          ))}
          {c?.handover && (
            <div
              className="list-item"
              style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}
            >
              <div
                className="row"
                style={{
                  justifyContent: "space-between",
                  flexWrap: "nowrap",
                  alignItems: "flex-start",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>Shift handover</div>
                  <div className="muted small">
                    {c.handover.at
                      ? `Taken ${hhmm(c.handover.at)}: ${c.handover.note}`
                      : "Not taken yet. Head Control writes what is still open."}
                  </div>
                </div>
                <Chip tone={c.handover.at ? "ok" : "warn"}>
                  {c.handover.at ? "Taken" : "Open"}
                </Chip>
              </div>
              {!c.handover.at && data.canDesk && (
                <>
                  <ErrorNotice error={error} />
                  <textarea
                    className="textarea"
                    aria-label="Handover note"
                    placeholder="Arms still out, alarms open, calls to return…"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <div>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () =>
                            api.recordCmsHandover(c.handover!.shiftId, note),
                          "Handover recorded",
                        )
                      }
                    >
                      Record handover
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>To act on</h2>
          <span className="muted small">
            Most urgent first. Arms alerts are on the Arms control board.
          </span>
        </div>
        <div className="list">
          {data.alerts.length === 0 && (
            <div className="empty">Nothing to act on.</div>
          )}
          {data.alerts.map((a, i) => (
            <div key={i} className="list-item">
              <div>
                <div style={{ fontWeight: 600 }}>{a.title}</div>
                <div className="muted small">{a.detail}</div>
              </div>
              <Chip tone={a.tone}>{a.kind}</Chip>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function RosterTab({ data }: { data: Cms }) {
  const [pick, setPick] = useState<Record<string, string>>({});
  const { run, busy, error } = useAction();
  const active = data.staff.filter((s) => s.active);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Roster</h2>
        <div className="row">
          <span className="muted small">
            Planned to{" "}
            {data.tiles.plannedTo ? dateLabel(data.tiles.plannedTo) : "–"}
          </span>
          {data.canManage && (
            <button
              className="btn btn-sm btn-primary"
              disabled={busy}
              onClick={() =>
                run(
                  () => api.planCmsRoster(7),
                  "Next week added. Put someone on each seat.",
                )
              }
            >
              Plan next week
            </button>
          )}
        </div>
      </div>
      <ErrorNotice error={error} />
      <p className="muted small" style={{ padding: "10px 16px 0" }}>
        {data.settings.shiftPattern === "2x12"
          ? "Two 12-hour shifts"
          : "Three 8-hour shifts"}{" "}
        from {data.settings.firstShiftStart}, with{" "}
        {data.settings.headControlPerShift} Head Control and{" "}
        {data.settings.monitorOfficersPerShift} Monitor Officer
        {data.settings.monitorOfficersPerShift === 1 ? "" : "s"}. Nobody works
        more than 12 hours in a row.
      </p>
      <div className="list">
        {data.roster.map((r) => (
          <div
            key={r.start}
            className="list-item"
            style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}
          >
            <div
              className="row"
              style={{ justifyContent: "space-between", flexWrap: "nowrap" }}
            >
              <div style={{ fontWeight: 600 }}>
                {dateLabel(r.date)} {hhmm(r.start)}–{hhmm(r.end)}
              </div>
              <Chip
                tone={
                  r.short.headControl + r.short.monitorOfficers
                    ? "crit"
                    : r.live
                      ? "info"
                      : "ok"
                }
              >
                {r.short.headControl + r.short.monitorOfficers
                  ? `${r.short.headControl + r.short.monitorOfficers} empty`
                  : r.live
                    ? "Now"
                    : "Full"}
              </Chip>
            </div>
            {r.seats.map((s) => {
              const can =
                data.canManage &&
                !r.done &&
                (s.state === "uncovered" ||
                  s.state === "later" ||
                  s.state === "no_show");
              const who = active.filter((p) => p.posts.includes(s.shift.post));
              return (
                <div
                  key={s.shift.id}
                  className="row"
                  style={{ justifyContent: "space-between" }}
                >
                  <div className="small">
                    <span className="muted">{POST[s.shift.post]}:</span>{" "}
                    {s.shift.staffName ?? (
                      <span style={{ color: "var(--crit)" }}>nobody</span>
                    )}
                    {s.state === "no_show" ? (
                      <span style={{ color: "var(--crit)" }}>
                        {" "}
                        · not clocked in
                      </span>
                    ) : null}
                  </div>
                  {can && (
                    <div className="row" style={{ flexWrap: "nowrap" }}>
                      <select
                        className="select"
                        aria-label={`Who sits ${POST[s.shift.post]} ${s.shift.id}`}
                        value={pick[s.shift.id] ?? ""}
                        onChange={(e) =>
                          setPick({ ...pick, [s.shift.id]: e.target.value })
                        }
                      >
                        <option value="">
                          {s.shift.staffName ? "Replace…" : "Choose…"}
                        </option>
                        {who.map((p) => (
                          <option key={p.id} value={p.name}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={busy || !pick[s.shift.id]}
                        onClick={() =>
                          run(
                            () =>
                              api.assignCmsShift(s.shift.id, pick[s.shift.id]),
                            `${pick[s.shift.id]} is on the seat`,
                          )
                        }
                      >
                        Set
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

const ISSUE: Record<
  NonNullable<Cms["extensions"][number]["issue"]>,
  { label: string; tone: Tone }
> = {
  not_forwarding: { label: "Not forwarding to CMS", tone: "warn" },
  offline: { label: "Offline", tone: "crit" },
  unknown: { label: "Not confirmed", tone: "unknown" },
  ring_mismatch: { label: "Ring time differs", tone: "warn" },
};

function Phones({ data }: { data: Cms }) {
  const { run, busy, error } = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Call back</h2>
          <span className="muted small">
            Calls forwarded to CMS that nobody answered. Call back within{" "}
            {data.settings.callbackWithinMin} minutes.
          </span>
        </div>
        <ErrorNotice error={error} />
        <div className="list">
          {data.callbacks.length === 0 && (
            <div className="empty">No calls waiting.</div>
          )}
          {data.callbacks.map((c) => (
            <div
              key={c.call.id}
              className="list-item"
              style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}
            >
              <div
                className="row"
                style={{
                  justifyContent: "space-between",
                  flexWrap: "nowrap",
                  alignItems: "flex-start",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {c.call.caller} · {hhmm(c.call.at)}
                  </div>
                  <div className="muted small">
                    {c.extLabel} · {c.companyName}
                  </div>
                </div>
                <Chip tone={c.late ? "crit" : "warn"}>{c.waited} min</Chip>
              </div>
              {data.canDesk && (
                <div className="row" style={{ flexWrap: "nowrap" }}>
                  <input
                    className="input"
                    style={{ flex: 1 }}
                    aria-label={`Call-back note ${c.call.id}`}
                    placeholder="What they needed, passed to whom"
                    value={notes[c.call.id] ?? ""}
                    onChange={(e) =>
                      setNotes({ ...notes, [c.call.id]: e.target.value })
                    }
                  />
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () =>
                          api.logCallback(c.call.id, notes[c.call.id] ?? ""),
                        "Call-back recorded",
                      )
                    }
                  >
                    Called back
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Today by company</h2>
          <span className="muted small">
            {data.tiles.companiesWithoutPhones} companies have no phones linked
            yet: Unknown
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th className="num">Calls</th>
                <th className="num">To CMS</th>
                <th className="num">CMS answered</th>
                <th className="num">Missed</th>
                <th className="num hide-sm">Phones</th>
              </tr>
            </thead>
            <tbody>
              {data.phoneByCompany.map((p) => (
                <tr key={p.company.id}>
                  <td>{p.company.name}</td>
                  <td className="num">{p.calls}</td>
                  <td className="num">{p.forwarded}</td>
                  <td className="num">{p.cmsAnswered}</td>
                  <td
                    className="num"
                    style={
                      p.awaitingCallback
                        ? { color: "var(--crit)", fontWeight: 600 }
                        : undefined
                    }
                  >
                    {p.missed}
                  </td>
                  <td className="num hide-sm">
                    {p.extensions}
                    {p.extensionIssues
                      ? ` (${p.extensionIssues} problem${p.extensionIssues === 1 ? "" : "s"})`
                      : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Company extensions</h2>
          <span className="muted small">
            Forward to CMS after {data.settings.forwardAfterSec} seconds of
            ringing; set in each phone system
          </span>
          <RecordButton kind="phoneExtension" label="Add extension" />
        </div>
        <div className="list">
          {data.extensions.map((x) => (
            <div key={x.ext.id} className="list-item">
              <div>
                <div style={{ fontWeight: 600 }}>
                  {x.ext.label} · ext {x.ext.ext}
                </div>
                <div className="muted small">
                  {x.ext.forwardToCms
                    ? `Forwards after ${x.ext.forwardAfterSec ?? "?"} s`
                    : "Does not forward"}{" "}
                  · {x.ext.status}
                  {x.ext.lastSeenAt ? `, seen ${hhmm(x.ext.lastSeenAt)}` : ""}
                </div>
                <div className="small">{x.companyName}</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <Chip tone={x.issue ? ISSUE[x.issue].tone : "ok"}>
                  {x.issue ? ISSUE[x.issue].label : "OK"}
                </Chip>
                <RecordButton kind="phoneExtension" id={x.ext.id} />
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Calls today</h2>
          <span className="muted small">
            Latest first, from the phone system's call records
          </span>
        </div>
        <div className="list">
          {data.calls.map((c) => (
            <div key={c.call.id} className="list-item">
              <div>
                <div style={{ fontWeight: 600 }}>
                  {hhmm(c.call.at)} · {c.call.caller}
                </div>
                <div className="muted small">
                  {c.extLabel} · {c.companyName}
                </div>
                {c.call.answeredBy && (
                  <div className="muted small">
                    Answered at CMS by {c.call.answeredBy}
                  </div>
                )}
                {c.call.callbackAt && (
                  <div className="muted small">
                    Called back {hhmm(c.call.callbackAt)}
                    {c.call.callbackBy ? ` by ${c.call.callbackBy}` : ""}
                  </div>
                )}
              </div>
              <Chip
                tone={
                  c.call.outcome === "answered"
                    ? "neutral"
                    : c.call.outcome === "forwarded_answered"
                      ? "ok"
                      : c.call.callbackAt
                        ? "neutral"
                        : "crit"
                }
              >
                {c.call.outcome === "answered"
                  ? `Answered ${c.call.answerSec} s`
                  : c.call.outcome === "forwarded_answered"
                    ? `CMS ${c.call.answerSec} s`
                    : c.call.callbackAt
                      ? "Missed, called back"
                      : "Missed"}
              </Chip>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

type NumKey =
  | "headControlPerShift"
  | "monitorOfficersPerShift"
  | "clockInGraceMin"
  | "handoverWithinMin"
  | "vaultWatchCheckMin"
  | "forwardAfterSec"
  | "answerTargetSec"
  | "callbackWithinMin"
  | "alarmAckSec";

const NUM_FIELDS: { key: NumKey; label: string; help: string }[] = [
  {
    key: "headControlPerShift",
    label: "Head Control per shift",
    help: "At least 1",
  },
  {
    key: "monitorOfficersPerShift",
    label: "Monitor Officers per shift",
    help: "At least 1",
  },
  {
    key: "clockInGraceMin",
    label: "Clock-in grace, minutes",
    help: "After this a seat counts as a no-show",
  },
  {
    key: "handoverWithinMin",
    label: "Handover within, minutes",
    help: "From the start of the shift",
  },
  {
    key: "vaultWatchCheckMin",
    label: "Vault watch check-in, minutes",
    help: "Each vault watch checks in with CMS this often",
  },
  {
    key: "forwardAfterSec",
    label: "Forward to CMS after, seconds",
    help: "Ring time at the company extension",
  },
  {
    key: "answerTargetSec",
    label: "CMS answers within, seconds",
    help: "After the call reaches CMS",
  },
  {
    key: "callbackWithinMin",
    label: "Call back within, minutes",
    help: "For a forwarded call nobody answered",
  },
  {
    key: "alarmAckSec",
    label: "Acknowledge alarms within, seconds",
    help: "Guard SOS, panic, intrusion and fire",
  },
];

function Settings({ data }: { data: Cms }) {
  const s = data.settings;
  const [form, setForm] = useState<CmsSettingsPatch>({});
  const { run, busy, error } = useAction();
  const val = <K extends keyof CmsSettingsPatch>(k: K) =>
    (form[k] ?? s[k as keyof typeof s]) as NonNullable<CmsSettingsPatch[K]>;
  const dirty = Object.keys(form).length > 0;
  const off = !data.canManage;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>CMS settings</h2>
        <span className="muted small">
          {s.updatedAt
            ? `Last changed ${dateLabel(s.updatedAt.slice(0, 10))} ${hhmm(s.updatedAt)} by ${s.updatedBy}`
            : "Default settings"}
        </span>
      </div>
      <div
        className="panel-body"
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        {off && (
          <div className="notice">Only Arms Control can change these.</div>
        )}
        <ErrorNotice error={error} />
        <div className="grid-2">
          <label className="field">
            <span className="small">Shift pattern</span>
            <select
              className="select"
              disabled={off}
              value={val("shiftPattern")}
              onChange={(e) =>
                setForm({
                  ...form,
                  shiftPattern: e.target.value as "2x12" | "3x8",
                })
              }
            >
              <option value="2x12">Two 12-hour shifts</option>
              <option value="3x8">Three 8-hour shifts</option>
            </select>
          </label>
          <label className="field">
            <span className="small">First shift starts</span>
            <input
              className="input"
              disabled={off}
              type="time"
              step={1800}
              value={val("firstShiftStart")}
              onChange={(e) =>
                setForm({ ...form, firstShiftStart: e.target.value })
              }
            />
          </label>
          {NUM_FIELDS.map((f) => (
            <label key={f.key} className="field">
              <span className="small">{f.label}</span>
              <input
                className="input"
                disabled={off}
                type="number"
                min={data.limits[f.key].min}
                max={data.limits[f.key].max}
                value={val(f.key)}
                onChange={(e) =>
                  setForm({ ...form, [f.key]: Number(e.target.value) })
                }
              />
              <span className="muted small">
                {f.help} ({data.limits[f.key].min} to {data.limits[f.key].max})
              </span>
            </label>
          ))}
        </div>
        <p className="muted small">
          A change to the shift pattern or staffing applies from tomorrow's
          first shift. Seats that no longer fit are cancelled and listed in the
          audit trail so they can be rostered again. The ring time is set in
          each company's phone system; CMS flags any extension that differs.
        </p>
        {!off && (
          <div className="row">
            <button
              className="btn btn-primary"
              disabled={busy || !dirty}
              onClick={async () => {
                const r = (await run(
                  () => api.updateCmsSettings(form),
                  "CMS settings saved",
                )) as { changes: string[] } | undefined;
                if (r) setForm({});
              }}
            >
              Save settings
            </button>
            {dirty && (
              <button className="btn" onClick={() => setForm({})}>
                Undo
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Duties({ data }: { data: Cms }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>What CMS does</h2>
        <span className="muted small">
          From V13, V14, V15 and Fauzan's instructions. Not shown as done until
          it works at a site.
        </span>
      </div>
      <div className="list">
        {data.duties.map((d, i) => (
          <div key={i} className="list-item">
            <div>
              <div style={{ fontWeight: 600 }}>{d.duty}</div>
              <div className="muted small">{d.source}</div>
            </div>
            <Chip tone={DUTY[d.status].tone}>{DUTY[d.status].label}</Chip>
          </div>
        ))}
      </div>
    </section>
  );
}

function Staff({ data }: { data: Cms }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>CMS staff</h2>
        <span className="muted small">
          Head Control staff can also sit as Monitor Officer
        </span>
        <RecordButton kind="cmsStaff" label="Add CMS staff" />
      </div>
      <div className="list">
        {data.staff.map((p) => (
          <div key={p.id} className="list-item">
            <div>
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              <div className="muted small">
                {p.posts.map((x) => POST[x]).join(", ")} · console ext {p.ext}
              </div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <Chip tone={p.active ? "ok" : "neutral"}>
                {p.active ? "Active" : "Inactive"}
              </Chip>
              <RecordButton kind="cmsStaff" id={p.id} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const ALARM: Record<Cms["ops"]["alarms"][number]["alarm"]["kind"], string> = {
  GUARD_SOS: "Guard SOS",
  PANIC: "Panic button",
  INTRUSION: "Intrusion alarm",
  FIRE: "Fire alarm",
  CAMERA_TAMPER: "Camera tamper",
  LINK_LOST: "Site link lost",
};

const secs = (n: number) =>
  n < 120
    ? `${n} s`
    : n < 7200
      ? `${Math.floor(n / 60)} min`
      : `${Math.floor(n / 3600)} h`;

function Emergencies({ data }: { data: Cms }) {
  const { run, busy, error } = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const { setCompanyId, go } = useApp();
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Emergencies and alarms</h2>
          <span className="muted small">
            Guard SOS, panic, intrusion, fire, camera tamper. Acknowledge within{" "}
            {data.settings.alarmAckSec} s, check, then close.
          </span>
        </div>
        <ErrorNotice error={error} />
        <div className="list">
          {data.ops.alarms.length === 0 && (
            <div className="empty">No alarms today.</div>
          )}
          {data.ops.alarms.map((a) => {
            const x = a.alarm;
            const tone: Tone =
              x.status === "new"
                ? a.late
                  ? "crit"
                  : "warn"
                : x.status === "acknowledged"
                  ? "info"
                  : x.verdict === "real"
                    ? "crit"
                    : "neutral";
            const label =
              x.status === "new"
                ? `Waiting ${secs(a.waitedSec)}`
                : x.status === "acknowledged"
                  ? "Being checked"
                  : x.verdict === "real"
                    ? "Real, incident opened"
                    : "False alarm";
            return (
              <div
                key={x.id}
                className="list-item"
                style={{
                  flexDirection: "column",
                  alignItems: "stretch",
                  gap: 6,
                }}
              >
                <div
                  className="row"
                  style={{
                    justifyContent: "space-between",
                    flexWrap: "nowrap",
                    alignItems: "flex-start",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {ALARM[x.kind]} · {hhmm(x.at)}
                    </div>
                    <div className="muted small">
                      {a.siteName} · {x.source}
                    </div>
                    {x.ackAt && (
                      <div className="muted small">
                        Acknowledged by {x.ackBy} after {secs(a.ackSec ?? 0)}
                        {a.late && x.status !== "new" ? " (late)" : ""}
                      </div>
                    )}
                    {x.note && <div className="muted small">{x.note}</div>}
                    <div className="small">{a.companyName}</div>
                  </div>
                  <Chip tone={tone}>{label}</Chip>
                </div>
                {data.canDesk && x.status === "new" && (
                  <div>
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => api.acknowledgeAlarm(x.id),
                          "Acknowledged. Check the camera and call the guard.",
                        )
                      }
                    >
                      Acknowledge
                    </button>
                  </div>
                )}
                {data.canDesk && x.status === "acknowledged" && (
                  <div className="row" style={{ flexWrap: "wrap" }}>
                    <input
                      className="input"
                      style={{ flex: 1, minWidth: 180 }}
                      aria-label={`What was checked ${x.id}`}
                      placeholder="What was checked: camera, guard, call"
                      value={notes[x.id] ?? ""}
                      onChange={(e) =>
                        setNotes({ ...notes, [x.id]: e.target.value })
                      }
                    />
                    <button
                      className="btn btn-sm btn-danger"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => api.closeAlarm(x.id, "real", notes[x.id] ?? ""),
                          "Incident opened for the company",
                        )
                      }
                    >
                      Real: open incident
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () =>
                            api.closeAlarm(x.id, "false", notes[x.id] ?? ""),
                          "Recorded as a false alarm",
                        )
                      }
                    >
                      False alarm
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
      {data.ops.falseToReview.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>False alarms for Head Control to review</h2>
            <span className="muted small">
              Another person checks every false alarm. Not agreeing opens the
              incident for the company.
            </span>
          </div>
          <div className="list">
            {data.ops.falseToReview.map((f) => (
              <div
                key={f.alarm.id}
                className="list-item"
                style={{
                  flexDirection: "column",
                  alignItems: "stretch",
                  gap: 6,
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  {ALARM[f.alarm.kind]} · {hhmm(f.alarm.at)} · {f.siteName}
                </div>
                <div className="muted small">
                  Closed as false by {f.alarm.closedBy ?? "CMS"}
                  {f.alarm.note ? `: ${f.alarm.note}` : ""}
                </div>
                {data.canDesk && (
                  <div className="row" style={{ flexWrap: "wrap" }}>
                    <input
                      className="input"
                      style={{ flex: 1, minWidth: 180 }}
                      aria-label={`Review note ${f.alarm.id}`}
                      placeholder="What you checked (needed if it was real)"
                      value={notes[f.alarm.id] ?? ""}
                      onChange={(e) =>
                        setNotes({ ...notes, [f.alarm.id]: e.target.value })
                      }
                    />
                    <button
                      className="btn btn-sm"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () =>
                            api.reviewFalseAlarm(
                              f.alarm.id,
                              true,
                              notes[f.alarm.id] ?? "",
                            ),
                          "Agreed: false alarm.",
                        )
                      }
                    >
                      Agree, false
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () =>
                            api.reviewFalseAlarm(
                              f.alarm.id,
                              false,
                              notes[f.alarm.id] ?? "",
                            ),
                          "It was real: incident opened for the company.",
                        )
                      }
                    >
                      It was real
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="panel">
        <div className="panel-head">
          <h2>Open incidents at sites</h2>
          <span className="muted small">
            The company decides the response and closes the case; CMS follows it
          </span>
        </div>
        <div className="list">
          {data.ops.incidents.length === 0 && (
            <div className="empty">No open incidents.</div>
          )}
          {data.ops.incidents.map((k) => (
            <button
              key={k.case.id}
              className="list-item"
              disabled={!data.canManage}
              onClick={() => {
                if (!data.canManage) return;
                setCompanyId(k.case.companyId);
                go({ view: "cases", caseId: k.case.id });
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>
                  {k.case.severity} {k.case.title}
                </div>
                <div className="muted small">
                  {k.case.ref} · {k.siteName} · opened {hhmm(k.case.openedAt)} ·{" "}
                  {k.case.status}
                </div>
                <div className="small">{k.companyName}</div>
              </div>
              <Chip
                tone={
                  k.case.sla === "breached"
                    ? "crit"
                    : k.case.severity === "P1"
                      ? "crit"
                      : k.case.severity === "P2"
                        ? "warn"
                        : "neutral"
                }
              >
                {k.case.sla === "breached"
                  ? "Response late"
                  : k.case.sla === "met"
                    ? "Responded"
                    : "Clock running"}
              </Chip>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

const MONITORING: Record<
  Cms["ops"]["sites"][number]["monitoring"],
  { label: string; tone: Tone }
> = {
  live: { label: "CCTV live", tone: "ok" },
  partial: { label: "CCTV partial", tone: "warn" },
  offline: { label: "CCTV offline", tone: "crit" },
  not_linked: { label: "Not linked", tone: "unknown" },
};

function Sites({ data }: { data: Cms }) {
  const [all, setAll] = useState(false);
  const [company, setCompany] = useState("");
  const rows = data.ops.sites.filter(
    (s) => (all || s.worst !== "ok") && (!company || s.companyId === company),
  );
  const companies = [
    ...new Map(
      data.ops.sites.map((s) => [s.companyId, s.companyName]),
    ).entries(),
  ];
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>By company, now</h2>
          <span className="muted small">
            {data.ops.tiles.companiesWithoutSites} companies have no site data
            yet: Unknown
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th className="num">Not clocked in</th>
                <th className="num">Posts empty</th>
                <th className="num">Patrols missed</th>
              </tr>
            </thead>
            <tbody>
              {data.ops.byCompany.map((c) => (
                <tr key={c.companyId}>
                  <td>{c.companyName}</td>
                  <td
                    className="num"
                    style={
                      c.noShow
                        ? { color: "var(--crit)", fontWeight: 600 }
                        : undefined
                    }
                  >
                    {c.noShow}
                  </td>
                  <td
                    className="num"
                    style={
                      c.uncovered
                        ? { color: "var(--crit)", fontWeight: 600 }
                        : undefined
                    }
                  >
                    {c.uncovered}
                  </td>
                  <td className="num">{c.patrolMissedSites}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Sites</h2>
          <div className="row">
            <select
              className="select"
              aria-label="Company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            >
              <option value="">All companies</option>
              {companies.map(([id, n]) => (
                <option key={id} value={id}>
                  {n}
                </option>
              ))}
            </select>
            <div className="seg">
              <button aria-pressed={!all} onClick={() => setAll(false)}>
                Needs attention
              </button>
              <button aria-pressed={all} onClick={() => setAll(true)}>
                All {data.ops.tiles.sites}
              </button>
            </div>
          </div>
        </div>
        <div className="list">
          {rows.length === 0 && (
            <div className="empty">Every site is fine.</div>
          )}
          {rows.map((s) => {
            const m = MONITORING[s.monitoring];
            const cctv = s.cctv;
            return (
              <div
                key={s.site.id}
                className="list-item"
                style={{
                  flexDirection: "column",
                  alignItems: "stretch",
                  gap: 4,
                }}
              >
                <div
                  className="row"
                  style={{
                    justifyContent: "space-between",
                    flexWrap: "nowrap",
                    alignItems: "flex-start",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{s.site.name}</div>
                    <div className="muted small">
                      {s.site.code} · {s.site.client} · {s.site.risk} risk
                      {s.site.armed ? " · armed" : ""}
                    </div>
                    <div className="small">{s.companyName}</div>
                  </div>
                  <Chip
                    tone={
                      s.worst === "crit"
                        ? "crit"
                        : s.worst === "warn"
                          ? "warn"
                          : "ok"
                    }
                  >
                    {s.worst === "ok"
                      ? "Fine"
                      : s.worst === "crit"
                        ? "Act now"
                        : "Check"}
                  </Chip>
                </div>
                <div className="small">
                  <span className="muted">Attendance:</span>{" "}
                  {s.manning.expected === 0 ? (
                    "no shift now"
                  ) : (
                    <>
                      {s.manning.onDuty} of {s.manning.expected} on post
                      {s.manning.late ? `, ${s.manning.late} late` : ""}
                      {s.manning.noShow ? (
                        <span style={{ color: "var(--crit)" }}>
                          , {s.manning.noShow} not clocked in
                        </span>
                      ) : null}
                      {s.manning.uncovered ? (
                        <span style={{ color: "var(--crit)" }}>
                          , {s.manning.uncovered} post empty
                        </span>
                      ) : null}
                    </>
                  )}
                </div>
                <div className="small">
                  <span className="muted">Patrol:</span>{" "}
                  {s.patrolMissed.length ? (
                    <span style={{ color: "var(--warn)" }}>
                      {s.patrolMissed.join(", ")} not tapped in{" "}
                      {s.patrolIntervalMin} min
                    </span>
                  ) : s.manning.onDuty ? (
                    "on time"
                  ) : (
                    "no guard on post"
                  )}
                </div>
                <div className="row small" style={{ gap: 6 }}>
                  <Chip tone={m.tone}>{m.label}</Chip>
                  {cctv?.linked && cctv.cameras !== null && (
                    <span className="muted">
                      {cctv.camerasOnline ?? 0}/{cctv.cameras} cameras
                      {cctv.status === "not_recording" ? ", not recording" : ""}
                    </span>
                  )}
                  {s.alarmPanel && (
                    <span className="muted">
                      · alarm panel {s.alarmPanel.status}
                    </span>
                  )}
                  {s.openAlarms > 0 && (
                    <Chip tone="crit">{s.openAlarms} alarm open</Chip>
                  )}
                  {s.openIncidents > 0 && (
                    <Chip tone="crit">{s.openIncidents} incident</Chip>
                  )}
                </div>
                <div className="row small" style={{ gap: 6 }}>
                  {cctv && (
                    <RecordButton
                      kind="siteSystem"
                      id={cctv.id}
                      label="Edit CCTV"
                    />
                  )}
                  {s.alarmPanel && (
                    <RecordButton
                      kind="siteSystem"
                      id={s.alarmPanel.id}
                      label="Edit alarm panel"
                    />
                  )}
                  <RecordButton
                    kind="siteSystem"
                    companyId={s.site.companyId}
                    label="Add CCTV or alarm"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

/** Attendance alerts going to each company's PIC (Shahirah, 25 Oct 2026). CMS can call the guard; the company does the rest. */
function AttendanceAlertsPanel({ data }: { data: Cms }) {
  const [open, setOpen] = useState<AttendanceIssueView | null>(null);
  const items = data.attendanceAlerts;
  return (
    <section className="panel" aria-label="Attendance alerts">
      <div className="panel-head">
        <h2>Attendance alerts to the PIC</h2>
        <span className="muted small">
          Repeating every {data.attendanceRepeatMin} min until acted on. CMS may
          call the guard; the company sends the replacement.
        </span>
      </div>
      <div className="list">
        {items.length === 0 && (
          <div className="empty">No attendance alerts running.</div>
        )}
        {items.slice(0, 40).map((i) => (
          <button key={i.key} className="list-item" onClick={() => setOpen(i)}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>
                {ATTENDANCE_ISSUE_LABEL[i.issue]}: {i.personName ?? i.postName}
              </div>
              <div className="muted small">
                {i.siteName} · {i.companyName} · PIC {i.pic.name}
              </div>
            </div>
            <AlertState i={i} every={data.attendanceRepeatMin} />
          </button>
        ))}
      </div>
      {open && (
        <FollowUpDrawer
          i={open}
          canFollowUp={false}
          canDiscipline={false}
          canReplace={false}
          canDesk={data.canDesk}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}
