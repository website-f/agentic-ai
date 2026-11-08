import { Select } from '../SearchSelect';
import { useRef, useState } from "react";
import {
  FootprintsIcon,
  HeadsetIcon,
  PhoneIncomingIcon,
  SirenIcon,
  UserCheckIcon,
  VideoCameraIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { api, type Cms, type CmsSettingsPatch } from "../api";
import { useApp } from "../App";
import { ATTENDANCE_ISSUE_LABEL, CMS_SERVICE_KINDS, type AttendanceIssueView } from "@prima/core";
import { Card, Empty, Facts, PageHead, Split, Stat, Stats } from "../kit";
import {
  Chip,
  ErrorNotice,
  Loading,
  dateLabel,
  hhmm,
  humanize,
  useAction,
  useLoad,
  type Tone,
} from "../ui";
import { AlertState, FollowUpDrawer } from "./FollowUp";
import { RecordButton } from "./RecordForm";
import { ImportButton } from "./ImportDrawer";
import "../styles/ops.css";
import { CmsDevicesTab } from "./SiteDispatch";
import { PoliceHelpPanel } from "./PoliceHelp";
import { GuardPhonesBoard } from "./GuardPhoneOffice";

type Tab =
  | "now"
  | "emergencies"
  | "devices"
  | "sites"
  | "roster"
  | "phones"
  | "guardphones"
  | "settings"
  | "duties"
  | "staff"
  | "commissioning";

const TABS: { id: Tab; label: string }[] = [
  { id: "now", label: "Now" },
  { id: "emergencies", label: "Emergencies and incidents" },
  { id: "devices", label: "Site devices" },
  { id: "sites", label: "Sites" },
  { id: "phones", label: "Phone desk" },
  { id: "guardphones", label: "Guard phones" },
  { id: "roster", label: "Roster" },
  { id: "settings", label: "Settings" },
  { id: "duties", label: "What CMS does" },
  { id: "staff", label: "Staff" },
  { id: "commissioning", label: "Commissioning" },
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

/** On a phone the chosen item's detail sits under the list, so bring it into view. */
function revealOnPhone(el: HTMLElement | null) {
  if (el && window.matchMedia("(max-width: 860px)").matches)
    requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
}

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
      <PageHead
        title="CMS command centre"
        sub={
          <>
            The 24-hour centre that watches every site of every company: guards&apos;
            attendance and patrols, CCTV linked from sites, emergencies and
            incidents, arms out of the vault and vault watch, and every
            company&apos;s IP phones. Each shift has at least{" "}
            {data.minimum.headControl} Head Control and{" "}
            {data.minimum.monitorOfficers} Monitor Officer. Arms Control sets
            the roster and the settings. CMS monitors and escalates; the company
            decides.
          </>
        }
      />
      <Stats>
        <Stat
          label="Emergencies not acknowledged"
          value={o.alarmsNotAcked}
          tone={o.alarmsLate ? "crit" : o.alarmsNotAcked ? "warn" : "ok"}
          note={`Acknowledge within ${data.settings.alarmAckSec} s`}
          icon={<SirenIcon size={16} />}
          onClick={() => setTab("emergencies")}
        />
        <Stat
          label="Guards on post now"
          value={`${o.guardsOnDuty} of ${o.guardsExpected}`}
          tone={o.noShow + o.uncovered ? "crit" : o.late ? "warn" : "ok"}
          note={`${o.noShow} not clocked in, ${o.uncovered} posts empty`}
          icon={<UserCheckIcon size={16} />}
          onClick={() => setTab("sites")}
        />
        <Stat
          label="Patrols missed"
          value={o.patrolMissedSites}
          tone={o.patrolMissedSites ? "warn" : "ok"}
          note="Sites with a checkpoint not tapped in time"
          icon={<FootprintsIcon size={16} />}
        />
        <Stat
          label="Open incidents"
          value={o.incidentsOpen}
          tone={o.p1Open ? "crit" : o.incidentsOpen ? "warn" : "ok"}
          note={`${o.p1Open} P1`}
          icon={<WarningIcon size={16} />}
        />
        <Stat
          label="CCTV live"
          value={`${o.cctvLive} of ${o.sites}`}
          tone={o.cctvFaults ? "crit" : "ok"}
          note={`${o.cctvFaults} faults, ${o.notLinked} sites not linked`}
          icon={<VideoCameraIcon size={16} />}
        />
        <Stat
          label="CMS on shift"
          value={`${t.onShiftNow} of ${t.seatsNow}`}
          tone={t.seatsNow && t.onShiftNow === t.seatsNow ? "ok" : "crit"}
          note={`${t.rosterGaps} empty seats ahead`}
          icon={<HeadsetIcon size={16} />}
          onClick={() => setTab("roster")}
        />
        <Stat
          label="To call back"
          value={t.awaitingCallback}
          tone={t.lateCallbacks ? "crit" : t.awaitingCallback ? "warn" : "ok"}
          note={`${t.lateCallbacks} late`}
          icon={<PhoneIncomingIcon size={16} />}
          onClick={() => setTab("phones")}
        />
      </Stats>
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
      {/* CMS monitors police help requests (Fauzan, 3 Nov 2026: Arms Control coordinates, company authorises, CMS monitors). */}
      {tab === "now" && <PoliceHelpPanel />}
      {tab === "emergencies" && <Emergencies data={data} />}
      {tab === "devices" && <CmsDevicesTab />}
      {tab === "sites" && (
        <>
          <AttendanceAlertsPanel data={data} />
          <Sites data={data} />
        </>
      )}
      {tab === "roster" && <RosterTab data={data} />}
      {tab === "phones" && <Phones data={data} />}
      {tab === "guardphones" && <GuardPhonesBoard />}
      {tab === "settings" && <Settings data={data} />}
      {tab === "duties" && <Duties data={data} />}
      {tab === "staff" && <Staff data={data} />}
      {tab === "commissioning" && <Commissioning />}
    </div>
  );
}

function Now({ data }: { data: Cms }) {
  const c = data.current;
  // In the last hour of a shift, the handover to the next shift is shown too.
  const next = data.roster.find((r) => !r.live && !r.done && Date.parse(r.start) - Date.parse(data.now) <= 60 * 60_000) ?? null;
  return (
    <>
    <MyDesk data={data} />
    <div className="cm-now">
      <Card
        title="To act on"
        sub="Most urgent first. Arms alerts are on the Arms control board."
        actions={
          <Chip tone={data.alerts.some((a) => a.tone === "crit") ? "crit" : data.alerts.length ? "warn" : "ok"}>
            {data.alerts.length}
          </Chip>
        }
        flush
      >
        {data.alerts.length === 0 && <Empty title="Nothing to act on." />}
        <ul className="op-list">
          {data.alerts.map((a, i) => (
            <li key={i} className="op-item cm-q" data-tone={a.tone}>
              <span className="cm-q-bar" aria-hidden="true" />
              <span className="op-main">
                <span className="op-title">{a.title}</span>
                <span className="op-meta">{a.detail}</span>
              </span>
              <Chip tone={a.tone}>{a.kind}</Chip>
            </li>
          ))}
        </ul>
      </Card>

      <Card
        title="On shift now"
        sub={c ? `${dateLabel(c.date)} ${hhmm(c.start)}–${hhmm(c.end)}` : undefined}
        flush
      >
        {!c && <Empty title="No shift is planned for now.">Plan the roster.</Empty>}
        <ul className="op-list">
          {c?.seats.map((s) => (
            <li key={s.shift.id} className="op-item">
              <div className="op-line">
                <div className="op-main">
                  <span className="op-title">{s.shift.staffName ?? "Nobody rostered"}</span>
                  <span className="op-meta">
                    {POST[s.shift.post]}
                    {s.shift.clockIn ? ` · in ${hhmm(s.shift.clockIn)}` : ""}
                  </span>
                </div>
                <Chip tone={SEAT[s.state].tone}>{SEAT[s.state].label}</Chip>
              </div>
            </li>
          ))}
          {c?.handover && (
            <li className="op-item">
              <HandoverView h={c.handover} />
            </li>
          )}
          {next?.handover && (
            <li className="op-item">
              <HandoverView h={next.handover} title={`Handover to the ${hhmm(next.start)} shift`} />
            </li>
          )}
        </ul>
      </Card>
    </div>
    </>
  );
}

type Handover = NonNullable<Cms["roster"][number]["handover"]>;

/** The two steps of a shift handover, as everyone on the board sees them. */
function HandoverView({ h, title = "Shift handover" }: { h: Handover; title?: string }) {
  const out = h.outgoing?.written ?? null;
  const tone: Tone = h.disputed ? "crit" : h.at ? "ok" : "warn";
  return (
    <div className="op-stack">
      <div className="op-line">
        <span className="op-title">{title}</span>
        <Chip tone={tone}>{h.disputed ? "Not agreed" : h.at ? "Taken" : "Open"}</Chip>
      </div>
      <span className="op-meta">
        <span className="muted">1. Handed over by: </span>
        {out
          ? `${out.by} at ${hhmm(out.at)}${out.via === "cms_app" ? " (CMS desk)" : ""}: ${out.note}`
          : h.outgoing
            ? `${h.outgoing.name} has not written it yet`
            : "No Head Control on the shift before"}
      </span>
      {out && out.openItems.length > 0 && (
        <ul className="op-meta" style={{ margin: "0 0 0 18px", padding: 0 }}>
          {out.openItems.slice(0, 12).map((i) => (
            <li key={i.kind + i.ref}>{i.label}</li>
          ))}
          {out.openItems.length > 12 && <li>and {out.openItems.length - 12} more</li>}
        </ul>
      )}
      {out && out.openItems.length === 0 && <span className="op-meta">Nothing open on the board when it was written.</span>}
      <span className="op-meta">
        <span className="muted">2. Taken by: </span>
        {h.at
          ? `${h.takenBy} at ${hhmm(h.at)}${h.via === "cms_app" ? " (CMS desk)" : ""}: ${h.note}`
          : `${h.takenBy ?? "Head Control"} has not taken it yet`}
      </span>
    </div>
  );
}

/**
 * The signed-in CMS officer's own seats: clock in, write the handover at the end of the shift (Head Control), take
 * the handover at the start of the next one, and clock out. Each action is checked again on the server.
 */
function MyDesk({ data }: { data: Cms }) {
  const { run, busy, error } = useAction();
  const [text, setText] = useState<Record<string, string>>({});
  const nowMs = Date.parse(data.now);
  const mine = data.roster
    .flatMap((r) => r.seats.filter((s) => s.mine).map((s) => ({ r, s })))
    .filter(({ r }) => Date.parse(r.start) - nowMs < 60 * 60_000 || r.live);
  if (!data.canDesk || mine.length === 0) return null;
  const val = (k: string) => text[k] ?? "";
  const set = (k: string, v: string) => setText({ ...text, [k]: v });
  return (
    <Card title="My seat" sub="Head Control stays on the desk until the next Head Control takes the handover." flush>
      <div className="op-pad">
        <ErrorNotice error={error} />
      </div>
      <ul className="op-list">
        {mine.map(({ r, s }) => {
          const sh = s.shift;
          const hc = sh.post === "HEAD_CONTROL";
          const endMs = Date.parse(r.end);
          const startMs = Date.parse(r.start);
          const canIn = !sh.clockIn && nowMs >= startMs - 30 * 60_000 && nowMs < endMs;
          const onDesk = !!sh.clockIn && !sh.clockOut;
          const writeOut = hc && onDesk && !r.handoverOut && nowMs >= endMs - 60 * 60_000;
          const take = hc && !!sh.clockIn && r.handover && !r.handover.at;
          const early = nowMs < endMs - data.restRules.earlyGraceMin * 60_000;
          const k = sh.id;
          return (
            <li key={k} className="op-item">
              <div className="op-line">
                <div className="op-main">
                  <span className="op-title">
                    {POST[sh.post]} · {dateLabel(r.date)} {hhmm(r.start)}–{hhmm(r.end)}
                  </span>
                  <span className="op-meta">
                    {sh.clockIn ? `In ${hhmm(sh.clockIn)}` : "Not clocked in"}
                    {sh.clockOut ? ` · out ${hhmm(sh.clockOut)}` : ""}
                  </span>
                </div>
                <Chip tone={SEAT[s.state].tone}>{SEAT[s.state].label}</Chip>
              </div>
              {canIn && (
                <div className="op-form-actions">
                  <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(() => api.cmsSeatClockIn(sh.id), "Clocked in")}>
                    Clock in
                  </button>
                </div>
              )}
              {take && (
                <div className="op-box">
                  <span className="op-section-title">Take the handover</span>
                  <HandoverView h={r.handover!} />
                  <textarea
                    className="textarea"
                    aria-label="Handover taken, note"
                    placeholder="What you checked and what is still open, or the part you do not agree with"
                    value={val(k + ":in")}
                    onChange={(e) => set(k + ":in", e.target.value)}
                  />
                  <div className="op-form-actions">
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={busy}
                      onClick={() => run(() => api.recordCmsHandover(sh.id, val(k + ":in"), true), "Handover taken")}
                    >
                      Agree and take over
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={busy}
                      onClick={() => run(() => api.recordCmsHandover(sh.id, val(k + ":in"), false), "Handover taken as not agreed. Arms Control is told.")}
                    >
                      Take over, not agreed
                    </button>
                  </div>
                </div>
              )}
              {writeOut && (
                <div className="op-box">
                  <span className="op-section-title">Write the handover for the next Head Control</span>
                  <span className="op-meta">Open alarms, false alarms to review and calls to return are added from the board.</span>
                  <textarea
                    className="textarea"
                    aria-label="Handover for the next shift"
                    placeholder="Arms still out, alarms open, calls to return, anything to watch"
                    value={val(k + ":out")}
                    onChange={(e) => set(k + ":out", e.target.value)}
                  />
                  <div className="op-form-actions">
                    <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(() => api.giveCmsHandover(sh.id, val(k + ":out")), "Handover written")}>
                      Write handover
                    </button>
                  </div>
                </div>
              )}
              {hc && r.handoverOut && (
                <span className="op-meta">Handover written at {hhmm(r.handoverOut.at)}. Wait for the next Head Control to take it, then clock out.</span>
              )}
              {onDesk && (
                <div className="op-act">
                  {early && (
                    <input
                      className="input"
                      aria-label="Why you are leaving early"
                      placeholder="Leaving before the shift ends: why"
                      value={val(k + ":outnote")}
                      onChange={(e) => set(k + ":outnote", e.target.value)}
                    />
                  )}
                  <button className="btn btn-sm" disabled={busy} onClick={() => run(() => api.cmsSeatClockOut(sh.id, val(k + ":outnote")), "Clocked out")}>
                    Clock out
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function RosterTab({ data }: { data: Cms }) {
  const [pick, setPick] = useState<Record<string, string>>({});
  const [why, setWhy] = useState<Record<string, string>>({});
  const { run, busy, error } = useAction();
  const active = data.staff.filter((s) => s.active);
  return (
    <Card
      title="Roster"
      sub={`Planned to ${data.tiles.plannedTo ? dateLabel(data.tiles.plannedTo) : "–"}`}
      actions={
        data.canManage && (
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
        )
      }
      flush
    >
      <div className="op-pad">
        <ErrorNotice error={error} />
        <p className="op-note">
          {data.settings.shiftPattern === "2x12"
            ? "Two 12-hour shifts"
            : "Three 8-hour shifts"}{" "}
          from {data.settings.firstShiftStart}, with{" "}
          {data.settings.headControlPerShift} Head Control and{" "}
          {data.settings.monitorOfficersPerShift} Monitor Officer
          {data.settings.monitorOfficersPerShift === 1 ? "" : "s"}. Nobody works
          more than {data.restRules.maxHours} hours in a row, everyone has at least{" "}
          {data.restRules.minRestHours} hours' rest between stretches (Arms Control setting) and a
          rest day after {data.restRules.maxDaysInRow} days in a row, and nobody is
          put on a seat during approved leave.
        </p>
      </div>
      <ul className="op-list op-top-line">
        {data.roster.map((r) => {
          const empty = r.short.headControl + r.short.monitorOfficers;
          return (
            <li key={r.start} className="op-item" data-tone={empty ? "crit" : undefined}>
              <div className="op-line">
                <span className="op-title">
                  {dateLabel(r.date)} {hhmm(r.start)}–{hhmm(r.end)}
                </span>
                <Chip tone={empty ? "crit" : r.live ? "info" : "ok"}>
                  {empty ? `${empty} empty` : r.live ? "Now" : "Full"}
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
                  <div key={s.shift.id} className="cm-seat-row">
                    <span>
                      <span className="muted">{POST[s.shift.post]}:</span>{" "}
                      {s.shift.staffName ?? <span className="op-crit">nobody</span>}
                      {s.state === "no_show" ? (
                        <span className="op-crit"> · not clocked in</span>
                      ) : null}
                      {s.shift.released?.length ? (
                        <span className="muted">
                          {" "}
                          · taken off: {s.shift.released[s.shift.released.length - 1].name} (
                          {s.shift.released[s.shift.released.length - 1].reason})
                        </span>
                      ) : null}
                    </span>
                    {data.canManage && s.shift.staffName && !s.shift.clockIn && !r.done && (
                      <div className="op-act">
                        <input
                          className="input"
                          aria-label={`Why take ${s.shift.staffName} off ${s.shift.id}`}
                          placeholder="Sick, leave, emergency…"
                          value={why[s.shift.id] ?? ""}
                          onChange={(e) => setWhy({ ...why, [s.shift.id]: e.target.value })}
                        />
                        <button
                          className="btn btn-sm"
                          disabled={busy || (why[s.shift.id] ?? "").trim().length < 3}
                          onClick={() =>
                            run(
                              () => api.releaseCmsSeat(s.shift.id, why[s.shift.id] ?? ""),
                              "Taken off the seat. Put someone else on it.",
                            )
                          }
                        >
                          Take off
                        </button>
                      </div>
                    )}
                    {can && (
                      <div className="op-act">
                        <Select
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
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </Select>
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={busy || !pick[s.shift.id]}
                          onClick={() =>
                            run(
                              () =>
                                api.assignCmsShift(s.shift.id, pick[s.shift.id]),
                              `${who.find((p) => p.id === pick[s.shift.id])?.name ?? "Staff member"} is on the seat`,
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
            </li>
          );
        })}
      </ul>
    </Card>
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
      <Card
        title="Call back"
        sub={`Calls forwarded to CMS that nobody answered. Call back within ${data.settings.callbackWithinMin} minutes.`}
        actions={
          <Chip tone={data.callbacks.some((c) => c.late) ? "crit" : data.callbacks.length ? "warn" : "ok"}>
            {data.callbacks.length}
          </Chip>
        }
        flush
      >
        {error && (
          <div className="op-pad">
            <ErrorNotice error={error} />
          </div>
        )}
        {data.callbacks.length === 0 && <Empty title="No calls waiting." />}
        <ul className="op-list">
          {data.callbacks.map((c) => (
            <li key={c.call.id} className="op-item" data-tone={c.late ? "crit" : "warn"}>
              <div className="op-line">
                <div className="op-main">
                  <span className="op-title">
                    {c.call.caller} · {hhmm(c.call.at)}
                  </span>
                  <span className="op-meta">
                    {c.extLabel} · {c.companyName}
                  </span>
                </div>
                <Chip tone={c.late ? "crit" : "warn"}>{c.waited} min</Chip>
              </div>
              {data.canDesk && (
                <div className="op-act">
                  <input
                    className="input"
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
            </li>
          ))}
        </ul>
      </Card>
      <div className="op-grid-2">
        <Card
          title="Today by company"
          sub={`${data.tiles.companiesWithoutPhones} companies have no phones linked yet: Unknown`}
          flush
        >
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
                    <td className="num op-num" data-tone={p.awaitingCallback ? "crit" : undefined}>
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
        </Card>
        <Card
          title="Company extensions"
          sub={`Forward to CMS after ${data.settings.forwardAfterSec} seconds of ringing; set in each phone system`}
          actions={
            <>
              <ImportButton kind="phoneExtension" />
              <RecordButton kind="phoneExtension" label="Add extension" />
            </>
          }
          flush
        >
          <ul className="op-list">
            {data.extensions.map((x) => (
              <li key={x.ext.id} className="op-item">
                <div className="op-line">
                  <div className="op-main">
                    <span className="op-title">
                      {x.ext.label} · ext {x.ext.ext}
                    </span>
                    <span className="op-meta">
                      {x.ext.forwardToCms
                        ? `Forwards after ${x.ext.forwardAfterSec ?? "?"} s`
                        : "Does not forward"}{" "}
                      · {x.ext.status}
                      {x.ext.lastSeenAt ? `, seen ${hhmm(x.ext.lastSeenAt)}` : ""}
                    </span>
                    <span className="op-co">{x.companyName}</span>
                  </div>
                  <div className="op-chips">
                    <Chip tone={x.issue ? ISSUE[x.issue].tone : "ok"}>
                      {x.issue ? ISSUE[x.issue].label : "OK"}
                    </Chip>
                    <RecordButton kind="phoneExtension" id={x.ext.id} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card title="Calls today" sub="Latest first, from the phone system's call records" flush>
        <ul className="op-list">
          {data.calls.map((c) => (
            <li key={c.call.id} className="op-item">
              <div className="op-line">
                <div className="op-main">
                  <span className="op-title">
                    {hhmm(c.call.at)} · {c.call.caller}
                  </span>
                  <span className="op-meta">
                    {c.extLabel} · {c.companyName}
                  </span>
                  {c.call.answeredBy && (
                    <span className="op-meta">
                      Answered at CMS by {c.call.answeredBy}
                    </span>
                  )}
                  {c.call.callbackAt && (
                    <span className="op-meta">
                      Called back {hhmm(c.call.callbackAt)}
                      {c.call.callbackBy ? ` by ${c.call.callbackBy}` : ""}
                    </span>
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
            </li>
          ))}
        </ul>
      </Card>
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
  | "alarmAckSec"
  | "minRestHours";

const NUM_FIELDS: { key: NumKey; label: string; help: string }[] = [
  {
    key: "headControlPerShift",
    label: "Head Control per shift",
    help: "At least 1",
  },
  {
    key: "minRestHours",
    label: "Rest between shifts, hours",
    help: "Least rest between one stretch of work and the next. HR can view it.",
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
    <Card
      title="CMS settings"
      sub={
        s.updatedAt
          ? `Last changed ${dateLabel(s.updatedAt.slice(0, 10))} ${hhmm(s.updatedAt)} by ${s.updatedBy}`
          : "Default settings"
      }
      footer={
        !off && (
          <>
            {dirty && (
              <button className="btn" onClick={() => setForm({})}>
                Undo
              </button>
            )}
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
          </>
        )
      }
    >
      <div className="op-form">
        {off && (
          <div className="notice">Only Arms Control can change these.</div>
        )}
        <ErrorNotice error={error} />
        <div className="op-form-grid">
          <label className="field">
            <span className="label">Shift pattern</span>
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
            <span className="label">First shift starts</span>
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
              <span className="label">{f.label}</span>
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
        <p className="op-note">
          A change to the shift pattern or staffing applies from tomorrow&apos;s
          first shift. Seats that no longer fit are cancelled and listed in the
          audit trail so they can be rostered again. The ring time is set in
          each company&apos;s phone system; CMS flags any extension that differs.
        </p>
      </div>
    </Card>
  );
}

function Duties({ data }: { data: Cms }) {
  return (
    <Card
      title="What CMS does"
      sub="From V13, V14, V15 and Fauzan's instructions. Not shown as done until it works at a site."
      flush
    >
      <ul className="op-list">
        {data.duties.map((d, i) => (
          <li key={i} className="op-item">
            <div className="op-line">
              <div className="op-main">
                <span className="op-title">{d.duty}</span>
                <span className="op-meta">{d.source}</span>
              </div>
              <Chip tone={DUTY[d.status].tone}>{DUTY[d.status].label}</Chip>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Staff({ data }: { data: Cms }) {
  return (
    <Card
      title="CMS staff"
      sub="Head Control staff can also sit as Monitor Officer"
      actions={
        <>
          <ImportButton kind="cmsStaff" />
          <RecordButton kind="cmsStaff" label="Add CMS staff" />
        </>
      }
      flush
    >
      <ul className="op-list">
        {data.staff.map((p) => (
          <li key={p.id} className="op-item">
            <div className="op-line">
              <div className="op-main">
                <span className="op-title">{p.name}</span>
                <span className="op-meta">
                  {p.posts.map((x) => POST[x]).join(", ")} · console ext {p.ext}
                </span>
              </div>
              <div className="op-chips">
                <Chip tone={p.linked ? "ok" : "warn"}>
                  {p.linked ? "Prima account linked" : "No Prima account: cannot clock in"}
                </Chip>
                <Chip tone={p.active ? "ok" : "neutral"}>
                  {p.active ? "Active" : "Inactive"}
                </Chip>
                <RecordButton kind="cmsStaff" id={p.id} />
              </div>
            </div>
          </li>
        ))}
      </ul>
      {data.hours && (
        <>
          <div className="op-pad">
            <span className="op-section-title">Hours this month</span>
            <p className="op-note">From clock-in to clock-out. This is the hours record for HR, not a payslip.</p>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Seats</th>
                  <th>Worked</th>
                  <th>Hours</th>
                  <th>Late in</th>
                  <th>Left early</th>
                  <th>No clock-out</th>
                  <th>Missed</th>
                  <th>Taken off</th>
                </tr>
              </thead>
              <tbody>
                {data.hours.map((h) => (
                  <tr key={h.staffId}>
                    <td>{h.name}</td>
                    <td>{h.seats}</td>
                    <td>{h.worked}</td>
                    <td>{h.hours}</td>
                    <td>{h.late}</td>
                    <td>{h.early}</td>
                    <td>{h.noClockOut}</td>
                    <td>{h.missed}</td>
                    <td>{h.takenOff}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

const ALARM: Record<Cms["ops"]["alarms"][number]["alarm"]["kind"], string> = {
  GUARD_SOS: "Guard SOS",
  PANIC: "Panic button",
  INTRUSION: "Intrusion alarm",
  FIRE: "Fire alarm",
  CAMERA_TAMPER: "Camera tamper",
  LINK_LOST: "Site link lost",
  CMS_EVENT: "CMS event",
  AI_CCTV: "AI on CCTV",
  AI_SENSOR: "AI on sensor",
  VEHICLE_WATCH: "Vehicle on watch at gate",
};

const secs = (n: number) =>
  n < 120
    ? `${n} s`
    : n < 7200
      ? `${Math.floor(n / 60)} min`
      : `${Math.floor(n / 3600)} h`;

type AlarmRow = Cms["ops"]["alarms"][number];

function alarmState(a: AlarmRow): { tone: Tone; label: string } {
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
  return { tone, label };
}

function Emergencies({ data }: { data: Cms }) {
  const { run, busy, error } = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pick, setPick] = useState<string | null>(null);
  const detail = useRef<HTMLDivElement>(null);
  const { setCompanyId, go } = useApp();
  const alarms = data.ops.alarms;
  const sel =
    alarms.find((a) => a.alarm.id === pick) ??
    alarms.find((a) => a.alarm.status === "new") ??
    alarms[0];
  const choose = (id: string) => {
    setPick(id);
    revealOnPhone(detail.current);
  };
  const queue = (
    <Card
      title="Emergencies and alarms"
      sub={`Guard SOS, panic, intrusion, fire, camera tamper. Acknowledge within ${data.settings.alarmAckSec} s, check, then close.`}
      flush
    >
      {alarms.length === 0 && <Empty title="No alarms today." />}
      <ul className="op-list">
        {alarms.map((a) => {
          const x = a.alarm;
          const st = alarmState(a);
          return (
            <li key={x.id}>
              <button
                className="op-item cm-q cm-alarm"
                data-tone={st.tone}
                aria-current={sel?.alarm.id === x.id}
                onClick={() => choose(x.id)}
              >
                <span className="cm-q-bar" aria-hidden="true" />
                <span className="op-main">
                  <span className="op-title">{ALARM[x.kind]}</span>
                  <span className="op-meta">
                    {a.siteName} · {a.companyName}
                  </span>
                  <span className="op-time">{hhmm(x.at)}</span>
                </span>
                <span className="op-side">
                  {x.status === "new" && (
                    <span className="cm-age" data-tone={st.tone}>
                      {secs(a.waitedSec)}
                    </span>
                  )}
                  <Chip tone={st.tone}>{x.status === "new" ? "Waiting" : st.label}</Chip>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
  const x = sel?.alarm;
  const st = sel ? alarmState(sel) : null;
  const panel = (
    <div ref={detail} className="cm-detail">
      {sel && x && st ? (
        <Card
          title={`${ALARM[x.kind]} · ${hhmm(x.at)}`}
          sub={sel.siteName}
          actions={<Chip tone={st.tone}>{st.label}</Chip>}
        >
          <div className="op-facts">
            <Facts
              items={[
                ["Site", sel.siteName],
                ["Company", sel.companyName],
                ["Source", x.source],
                ["Raised", hhmm(x.at)],
                [
                  "Acknowledged",
                  x.ackAt
                    ? `By ${x.ackBy} after ${secs(sel.ackSec ?? 0)}${sel.late && x.status !== "new" ? " (late)" : ""}`
                    : `Not yet, waiting ${secs(sel.waitedSec)}`,
                ],
                ...(x.note ? ([["Note", x.note]] as [string, string][]) : []),
              ]}
            />
          </div>
          <ErrorNotice error={error} />
          {data.canDesk && x.status === "new" && (
            <div className="op-sec">
              <p className="op-note">
                Acknowledge first, then check the camera and call the guard.
              </p>
              <div className="op-act">
                <button
                  className="btn btn-primary"
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
            </div>
          )}
          {data.canDesk && x.status === "acknowledged" && (
            <div className="op-sec">
              <label className="field">
                <span className="label">What was checked</span>
                <input
                  className="input"
                  aria-label={`What was checked ${x.id}`}
                  placeholder="What was checked: camera, guard, call"
                  value={notes[x.id] ?? ""}
                  onChange={(e) =>
                    setNotes({ ...notes, [x.id]: e.target.value })
                  }
                />
              </label>
              <div className="op-act">
                <button
                  className="btn btn-danger"
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
                  className="btn"
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
            </div>
          )}
        </Card>
      ) : (
        <Card title="Alarm detail">
          <Empty title="No alarm chosen.">Alarms show here as they come in.</Empty>
        </Card>
      )}
    </div>
  );
  return (
    <>
      <Split list={queue} detail={panel} />
      {data.ops.falseToReview.length > 0 && (
        <Card
          title="False alarms for Head Control to review"
          sub="Another person checks every false alarm. Not agreeing opens the incident for the company."
          flush
        >
          <ul className="op-list">
            {data.ops.falseToReview.map((f) => (
              <li key={f.alarm.id} className="op-item">
                <div className="op-main">
                  <span className="op-title">
                    {ALARM[f.alarm.kind]} · {hhmm(f.alarm.at)} · {f.siteName}
                  </span>
                  <span className="op-meta">
                    Closed as false by {f.alarm.closedBy ?? "CMS"}
                    {f.alarm.note ? `: ${f.alarm.note}` : ""}
                  </span>
                </div>
                {data.canDesk && (
                  <div className="op-act">
                    <input
                      className="input"
                      aria-label={`Review note ${f.alarm.id}`}
                      placeholder="What you checked (always needed; a short note is fine)"
                      value={notes[f.alarm.id] ?? ""}
                      onChange={(e) =>
                        setNotes({ ...notes, [f.alarm.id]: e.target.value })
                      }
                    />
                    <button
                      className="btn btn-sm"
                      disabled={busy || !(notes[f.alarm.id] ?? "").trim()}
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
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card
        title="Open incidents at sites"
        sub="The company decides the response and closes the case; CMS follows it"
        flush
      >
        {data.ops.incidents.length === 0 && <Empty title="No open incidents." />}
        <ul className="op-list">
          {data.ops.incidents.map((k) => {
            const tone: Tone =
              k.case.sla === "breached"
                ? "crit"
                : k.case.severity === "P1"
                  ? "crit"
                  : k.case.severity === "P2"
                    ? "warn"
                    : "neutral";
            return (
              <li key={k.case.id}>
                <button
                  className="op-item"
                  data-tone={tone}
                  disabled={!data.canManage}
                  onClick={() => {
                    if (!data.canManage) return;
                    setCompanyId(k.case.companyId);
                    go({ view: "cases", caseId: k.case.id });
                  }}
                >
                  <span className="op-line">
                    <span className="op-main">
                      <span className="op-title">
                        {k.case.severity} {k.case.title}
                      </span>
                      <span className="op-meta">
                        {k.case.ref} · {k.siteName} · opened {hhmm(k.case.openedAt)} ·{" "}
                        {humanize(k.case.status)}
                      </span>
                      <span className="op-co">{k.companyName}</span>
                    </span>
                    <Chip tone={tone}>
                      {k.case.sla === "breached"
                        ? "Response late"
                        : k.case.sla === "met"
                          ? "Responded"
                          : "Clock running"}
                    </Chip>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
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

const CONTACT_ROLE: Record<string, string> = {
  site_supervisor: "Site supervisor",
  company_manager: "Company manager",
  regional_om: "Regional OM",
};

/**
 * Masterplan §191: CMS operators verify each call-out contact with a test call; Arms Control accepts the service once
 * every contact is verified and the sites are linked. The company records the signed scope and the client's acceptance.
 */
function Commissioning() {
  const { data, error } = useLoad(() => api.cmsCommissioning(), []);
  const act = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="commissioning" />;
  const key = (id: string, i: number | "accept") => `${id}:${i}`;
  return (
    <Card
      title="Commissioning: signed CMS service per contract"
      sub="Verify each contact by a test call and record a test of each signed service at each site. CCTV and alarm tests are checked against Prima's records; attendance and patrol run in the JA app, so the operator attests them. Accepting needs all of these."
      flush
    >
      {act.error && (
        <div className="op-pad">
          <ErrorNotice error={act.error} />
        </div>
      )}
      {data.rows.length === 0 && (
        <Empty title="No contract has a signed CMS scope yet." />
      )}
      <ul className="op-list">
        {data.rows.map((r) => {
          const svc = r.service;
          return (
            <li key={r.contractId} className="op-item">
              <div className="op-line">
                <div className="op-main">
                  <span className="op-title">
                    {r.ref} · {r.clientName} · {r.companyName}
                  </span>
                  <span className="op-meta">
                    Scope v{svc.version}, signed {dateLabel(svc.signedOn)} by{" "}
                    {svc.clientSignatory} (ref {svc.signedRef}).{" "}
                    {r.siteNames
                      .map((x) => `${x.name} ${x.from}-${x.to}`)
                      .join("; ")}
                  </span>
                </div>
                <Chip tone={r.gaps.length ? "warn" : "ok"}>
                  {r.gaps.length ? `${r.gaps.length} to do` : "Commissioned"}
                </Chip>
              </div>
              {svc.contacts.map((c, i) => (
                <div key={i} className="cm-check">
                  <span>
                    {CONTACT_ROLE[c.role]}: {c.name}
                  </span>
                  {c.verifiedAt ? (
                    <span>
                      <Chip tone="ok">Verified by {c.verifiedBy}</Chip>
                    </span>
                  ) : c.userId === data.userId ? (
                    <span className="muted">
                      Another operator verifies your number
                    </span>
                  ) : (
                    <div className="op-act">
                      <input
                        className="input"
                        aria-label={`How ${c.name} was verified`}
                        placeholder="Test call answered, number confirmed"
                        value={notes[key(r.contractId, i)] ?? ""}
                        onChange={(e) =>
                          setNotes({
                            ...notes,
                            [key(r.contractId, i)]: e.target.value,
                          })
                        }
                      />
                      <button
                        className="btn btn-sm"
                        disabled={act.busy}
                        onClick={() =>
                          act.run(
                            () =>
                              api.verifyCmsContact(
                                r.contractId,
                                i,
                                svc.version,
                                notes[key(r.contractId, i)] ?? "",
                              ),
                            "Contact verified.",
                          )
                        }
                      >
                        Mark verified
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {svc.services.flatMap((service) =>
                r.siteNames.map((site) => {
                  const done = (svc.tests ?? []).find(
                    (t) => t.service === service && t.siteId === site.siteId,
                  );
                  const k = `${r.contractId}:test:${service}:${site.siteId}`;
                  return (
                    <div key={k} className="cm-check">
                      <span>
                        Test: {CMS_SERVICE_KINDS[service]}, {site.name}
                      </span>
                      {done ? (
                        <span>
                          <Chip tone={done.basis === "prima_record" ? "ok" : "warn"}>
                            {done.basis === "prima_record"
                              ? `Checked in Prima, by ${done.by}`
                              : `Operator attested, by ${done.by}`}
                          </Chip>
                        </span>
                      ) : (
                        <div className="op-act">
                          <input
                            className="input"
                            aria-label={`Test of ${CMS_SERVICE_KINDS[service]} at ${site.name}`}
                            placeholder="What was tested and what CMS saw"
                            value={notes[k] ?? ""}
                            onChange={(e) => setNotes({ ...notes, [k]: e.target.value })}
                          />
                          <button
                            className="btn btn-sm"
                            disabled={act.busy}
                            onClick={() =>
                              act.run(
                                () =>
                                  api.recordCmsTest(
                                    r.contractId,
                                    svc.version,
                                    service,
                                    site.siteId,
                                    notes[k] ?? "",
                                  ),
                                "Test recorded.",
                              )
                            }
                          >
                            Record test
                          </button>
                        </div>
                      )}
                    </div>
                  );
                }),
              )}
              {r.gaps.length > 0 && (
                <ul className="cm-gaps">
                  {r.gaps.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              )}
              {data.canAccept && !svc.operatorAcceptance && (
                <div className="op-act">
                  <input
                    className="input"
                    aria-label="Reason for accepting"
                    placeholder="Reason for accepting for CMS"
                    value={notes[key(r.contractId, "accept")] ?? ""}
                    onChange={(e) =>
                      setNotes({
                        ...notes,
                        [key(r.contractId, "accept")]: e.target.value,
                      })
                    }
                  />
                  <button
                    className="btn btn-sm"
                    disabled={act.busy}
                    onClick={() =>
                      act.run(
                        () =>
                          api.acceptCmsService(
                            r.contractId,
                            "operator",
                            svc.version,
                            { note: notes[key(r.contractId, "accept")] ?? "" },
                          ),
                        "Accepted for CMS.",
                      )
                    }
                  >
                    Accept for CMS
                  </button>
                </div>
              )}
              {svc.operatorAcceptance && (
                <p className="op-note">
                  Accepted for CMS by {svc.operatorAcceptance.by}.{" "}
                  {svc.clientAcceptance
                    ? `Client accepted (${svc.clientAcceptance.clientName}, ref ${svc.clientAcceptance.ref}).`
                    : "Waiting for the company to record the client's acceptance."}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

const kpiTime = (sec: number | null) =>
  sec === null
    ? "-"
    : sec < 120
      ? `${sec} s`
      : `${Math.round(sec / 6) / 10} min`;

/** Masterplan §195: how fast alarms are acknowledged, and how much of the linked site equipment CMS can actually see. */
function CmsResponseKpis({ k }: { k: Cms["ops"]["kpis"] }) {
  const cov = k.coverage;
  return (
    <Card
      title="Response and coverage, last 24 hours"
      sub={`Target: acknowledge within ${k.targetSec} s (CMS setting). Unknown is never counted as online.`}
      flush
    >
      <div className="op-pad">
        <div className="cm-kpi-strip">
          <div className="cm-kpi">
            <span>Alarms</span>
            <strong>{k.all.alarms}</strong>
          </div>
          <div className="cm-kpi">
            <span>Acknowledge, median</span>
            <strong>{kpiTime(k.all.ackMedianSec)}</strong>
          </div>
          <div className="cm-kpi">
            <span>90% within</span>
            <strong>{kpiTime(k.all.ackP90Sec)}</strong>
          </div>
          <div className="cm-kpi" data-tone={k.all.ackOverTarget ? "warn" : undefined}>
            <span>Over target</span>
            <strong>{k.all.ackOverTarget}</strong>
          </div>
          <div className="cm-kpi" data-tone={k.all.waitingOverTarget ? "crit" : undefined}>
            <span>Waiting over target now</span>
            <strong>{k.all.waitingOverTarget}</strong>
          </div>
          <div className="cm-kpi">
            <span>False alarms</span>
            <strong>
              {k.all.falseAlarms}
              {k.all.falseRatePct === null ? "" : ` (${k.all.falseRatePct}%)`}
            </strong>
          </div>
        </div>
        <p className="small">
          Linked systems: {cov.online} online, {cov.offline} offline,{" "}
          <b>{cov.unknown} unknown</b>
          {cov.unknownPct === null ? "" : ` (${cov.unknownPct}%)`} of{" "}
          {cov.linkedSystems}. Sites not linked to CMS: {cov.sitesNotLinked}.
        </p>
        <p className="small">
          Contracted monitoring: {k.contracted.contractedMin} min signed,{" "}
          {k.contracted.reachableMin} min with CMS evidence a linked system
          was up,{" "}
          {k.contracted.downMin} min down,{" "}
          <b>{k.contracted.unknownMin} min unknown</b>
          {k.contracted.reachablePct === null
            ? ""
            : ` (${k.contracted.reachablePct}% of signed minutes)`}
          .
          {k.contracted.contractsWithoutScope > 0 &&
            ` ${k.contracted.contractsWithoutScope} live or mobilising contract(s) have no signed CMS scope.`}
        </p>
        <p className="op-note">
          These counts are each system&apos;s last reported status and
          Prima&apos;s own alarm records. Contracted minutes count as up only
          while the CMS app&apos;s reports (sent every 5 minutes, each good for
          15) show a linked system up; time with no report is unknown. None of
          this shows guards on post, or that recordings are complete and
          intact.
        </p>
      </div>
      <div className="table-wrap op-top-line">
        <table className="op-sticky-first">
          <thead>
            <tr>
              <th>Company</th>
              <th className="num">Alarms</th>
              <th className="num">Acknowledge, median</th>
              <th className="num">Over target</th>
              <th className="num">Waiting now</th>
              <th className="num">False rate</th>
              <th className="num">Systems unknown</th>
              <th className="num">Sites not linked</th>
            </tr>
          </thead>
          <tbody>
            {k.byCompany.map((c) => (
              <tr key={c.companyId}>
                <td>{c.companyName}</td>
                <td className="num">{c.alarms}</td>
                <td className="num">{kpiTime(c.ackMedianSec)}</td>
                <td className="num">{c.ackOverTarget}</td>
                <td className="num">{c.waitingOverTarget}</td>
                <td className="num">
                  {c.falseRatePct === null ? "-" : `${c.falseRatePct}%`}
                </td>
                <td className="num">
                  {c.coverage.unknown} of {c.coverage.linkedSystems}
                </td>
                <td className="num">{c.coverage.sitesNotLinked}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

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
      <Card
        title="Sites"
        sub={`${rows.length} shown`}
        actions={
          <>
            <ImportButton kind="siteSystem" label="Import CCTV and alarms" />
            <Select
              className="select op-filter"
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
            </Select>
            <div className="seg" role="group" aria-label="Which sites">
              <button aria-pressed={!all} onClick={() => setAll(false)}>
                Needs attention
              </button>
              <button aria-pressed={all} onClick={() => setAll(true)}>
                All {data.ops.tiles.sites}
              </button>
            </div>
          </>
        }
        flush
      >
        {rows.length === 0 && <Empty title="Every site is fine." />}
        <ul className="op-list">
          {rows.map((s) => {
            const m = MONITORING[s.monitoring];
            const cctv = s.cctv;
            const tone: Tone = s.worst === "crit" ? "crit" : s.worst === "warn" ? "warn" : "ok";
            return (
              <li key={s.site.id} className="op-item" data-tone={tone}>
                <div className="op-line">
                  <div className="op-main">
                    <span className="op-title">{s.site.name}</span>
                    <span className="op-meta">
                      {s.site.code} · {s.site.client} · {s.site.risk} risk
                      {s.site.armed ? " · armed" : ""}
                    </span>
                    <span className="op-co">{s.companyName}</span>
                  </div>
                  <Chip tone={tone}>
                    {s.worst === "ok"
                      ? "Fine"
                      : s.worst === "crit"
                        ? "Act now"
                        : "Check"}
                  </Chip>
                </div>
                <div className="op-main">
                  <span className="small">
                    <span className="muted">Attendance:</span>{" "}
                    {s.manning.expected === 0 ? (
                      "no shift now"
                    ) : (
                      <>
                        {s.manning.onDuty} of {s.manning.expected} on post
                        {s.manning.late ? `, ${s.manning.late} late` : ""}
                        {s.manning.noShow ? (
                          <span className="op-crit">
                            , {s.manning.noShow} not clocked in
                          </span>
                        ) : null}
                        {s.manning.uncovered ? (
                          <span className="op-crit">
                            , {s.manning.uncovered} post empty
                          </span>
                        ) : null}
                      </>
                    )}
                  </span>
                  <span className="small">
                    <span className="muted">Patrol:</span>{" "}
                    {s.patrolMissed.length ? (
                      <span className="op-warn">
                        {s.patrolMissed.join(", ")} not tapped in{" "}
                        {s.patrolIntervalMin} min
                      </span>
                    ) : s.manning.onDuty ? (
                      "on time"
                    ) : (
                      "no guard on post"
                    )}
                  </span>
                </div>
                <div className="op-chips small">
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
                <div className="op-act">
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
              </li>
            );
          })}
        </ul>
      </Card>
      <Card
        title="By company, now"
        sub={`${data.ops.tiles.companiesWithoutSites} companies have no site data yet: Unknown`}
        flush
      >
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
                  <td className="num op-num" data-tone={c.noShow ? "crit" : undefined}>
                    {c.noShow}
                  </td>
                  <td className="num op-num" data-tone={c.uncovered ? "crit" : undefined}>
                    {c.uncovered}
                  </td>
                  <td className="num">{c.patrolMissedSites}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <CmsResponseKpis k={data.ops.kpis} />
    </>
  );
}

/** Attendance alerts going to each company's PIC (Shahirah, 25 Oct 2026). CMS can call the guard; the company does the rest. */
function AttendanceAlertsPanel({ data }: { data: Cms }) {
  const [open, setOpen] = useState<AttendanceIssueView | null>(null);
  const items = data.attendanceAlerts;
  return (
    <section className="k-card" aria-label="Attendance alerts">
      <div className="k-card-head">
        <div className="k-card-title">
          <h2>Attendance alerts to the PIC</h2>
          <p>
            Repeating every {data.attendanceRepeatMin} min until acted on. CMS may
            call the guard; the company sends the replacement.
          </p>
        </div>
        <Chip tone={items.some((i) => i.repeating) ? "crit" : items.length ? "warn" : "ok"}>
          {items.length}
        </Chip>
      </div>
      <div className="k-card-body k-flush">
        {items.length === 0 && (
          <Empty title="No attendance alerts running." />
        )}
        <ul className="op-list">
          {items.slice(0, 40).map((i) => (
            <li key={i.key}>
              <button className="op-item" onClick={() => setOpen(i)}>
                <span className="op-line">
                  <span className="op-main">
                    <span className="op-title">
                      {ATTENDANCE_ISSUE_LABEL[i.issue]}: {i.personName ?? i.postName}
                    </span>
                    <span className="op-meta">
                      {i.siteName} · {i.companyName} · PIC {i.pic.name}
                    </span>
                  </span>
                  <AlertState i={i} every={data.attendanceRepeatMin} />
                </span>
              </button>
            </li>
          ))}
        </ul>
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
