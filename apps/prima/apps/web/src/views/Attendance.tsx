import { useState, type ReactNode } from 'react';
import {
  ClipboardTextIcon,
  ClockIcon,
  MapPinIcon,
  SignOutIcon,
  SmileyXEyesIcon,
  UserCircleDashedIcon,
  UserMinusIcon,
  WarningIcon,
} from '@phosphor-icons/react';
import { ATTENDANCE_ISSUE_LABEL, DISCIPLINE_LABEL, FOLLOW_UP_LABEL, addDays, dateOf, type AttendanceIssueView } from '@prima/core';
import { api } from '../api';
import type { AttendanceAlerts, AttendanceDay } from '../api/types';
import { useApp } from '../App';
import { Card, PageHead, Person, Search, Stat, Stats, Toolbar } from '../kit';
import { Chip, ErrorNotice, Loading, dateLabel, dateTimeLabel, dayLabel, hhmm, useAction, useLoad } from '../ui';
import { AlertState, FollowUpDrawer, ISSUE_TONE, isAbsence } from './FollowUp';
import { LeavePanel } from './Leave';
import { AttendanceReports } from './AttendanceReports';

/** P81: sessionStorage key another screen sets to open Attendance on its monthly reports. */
export const ATT_TAB_KEY = 'prima-attendance-tab';
import { FLAG_LABEL, FLAG_TONE, SHIFT_STATE } from './shared';
import '../styles/attendance.css';

type Issue = AttendanceIssueView['issue'];

/** The order the PIC reads the live alerts in: absences first, then failed checks, then lateness. */
const ISSUE_ORDER: Issue[] = ['NO_SHOW', 'POST_EMPTY', 'FACE_NOT_MATCHED', 'OUTSIDE_GEOFENCE', 'NOT_ROSTERED', 'LATE', 'EARLY_LEAVE'];
const ISSUE_ICON: Record<Issue, ReactNode> = {
  NO_SHOW: <UserMinusIcon size={18} />,
  POST_EMPTY: <UserCircleDashedIcon size={18} />,
  FACE_NOT_MATCHED: <SmileyXEyesIcon size={18} />,
  OUTSIDE_GEOFENCE: <MapPinIcon size={18} />,
  NOT_ROSTERED: <WarningIcon size={18} />,
  LATE: <ClockIcon size={18} />,
  EARLY_LEAVE: <SignOutIcon size={18} />,
};

export function AttendanceView() {
  const { companyId } = useApp();
  // P81: the HR screen opens this screen on the monthly reports (ATT_TAB_KEY).
  const [tab, setTab] = useState<'day' | 'record' | 'leave' | 'reports'>(() => {
    try {
      const t = sessionStorage.getItem(ATT_TAB_KEY);
      sessionStorage.removeItem(ATT_TAB_KEY);
      return t === 'reports' ? 'reports' : 'day';
    } catch {
      return 'day';
    }
  });
  const alerts = useLoad(() => api.attendanceAlerts(companyId), [companyId]);
  const [open, setOpen] = useState<AttendanceIssueView | null>(null);
  const a = alerts.data;

  return (
    <div className="page att">
      <PageHead
        title="Attendance"
        sub={
          <>
            The PIC is alerted when a guard is absent or a clock-in fails a check, every {a?.repeatMin ?? 5} minutes until someone acts. Lock each day after
            checking it. Nothing here pays, deducts or disciplines anyone automatically. Clock-ins come only from the site device with a face check; they are not typed in here. Shifts are added on the Roster.
          </>
        }
      />

      <div className="tabbar" role="tablist" aria-label="Attendance sections">
        <button role="tab" aria-selected={tab === 'day'} onClick={() => setTab('day')}>
          Day sheet
          {a && a.open.length > 0 && <span className="tab-count">{a.open.length}</span>}
        </button>
        <button role="tab" aria-selected={tab === 'record'} onClick={() => setTab('record')}>
          Absence and discipline
        </button>
        <button role="tab" aria-selected={tab === 'leave'} onClick={() => setTab('leave')}>
          Leave requests
        </button>
        <button role="tab" aria-selected={tab === 'reports'} onClick={() => setTab('reports')}>
          Monthly reports
        </button>
      </div>

      {alerts.error && tab !== 'reports' && <ErrorNotice error={alerts.error} />}
      {tab === 'reports' && <AttendanceReports />}
      {tab === 'day' && (
        <DaySheet
          onOpen={setOpen}
          alerting={a && a.open.length > 0 ? <AlertingNow items={a.open} every={a.repeatMin} onOpen={setOpen} /> : null}
        />
      )}
      {tab === 'leave' && <LeavePanel companyId={companyId} />}
      {tab === 'record' && (a ? <Record a={a} onOpen={setOpen} /> : <Loading what="absence records" />)}

      {open && a && (
        <FollowUpDrawer
          i={open}
          canFollowUp={a.canFollowUp}
          canDiscipline={a.canDiscipline}
          canReplace={a.canReplace}
          stepIn={a.stepIn}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

/** The live alerts, one column per kind of problem, each alert a card the PIC can open. */
function AlertingNow({ items, every, onOpen }: { items: AttendanceIssueView[]; every: number; onOpen: (i: AttendanceIssueView) => void }) {
  const groups = ISSUE_ORDER.map((k) => ({ issue: k, items: items.filter((i) => i.issue === k) })).filter((g) => g.items.length > 0);
  return (
    <Card
      title={
        <span className="att-live-title">
          <span className="att-pulse" aria-hidden="true" />
          Alerting the PIC now
        </span>
      }
      sub={`Repeats every ${every} min until an action is recorded`}
      actions={<Chip tone="crit">{items.length} open</Chip>}
    >
      <div className="att-groups">
        {groups.map((g) => (
          <section key={g.issue} className="att-group" data-tone={ISSUE_TONE[g.issue]} aria-label={ATTENDANCE_ISSUE_LABEL[g.issue]}>
            <h3 className="att-group-head">
              <span className="att-group-icon" aria-hidden="true">
                {ISSUE_ICON[g.issue]}
              </span>
              <span className="att-group-label">{ATTENDANCE_ISSUE_LABEL[g.issue]}</span>
              <span className="att-count">{g.items.length}</span>
            </h3>
            <div className="att-alerts">
              {g.items.map((i) => {
                const last = i.actions[i.actions.length - 1];
                return (
                  <button
                    key={i.key}
                    type="button"
                    className="att-alert"
                    onClick={() => onOpen(i)}
                    aria-label={`${ATTENDANCE_ISSUE_LABEL[i.issue]}: ${i.personName ?? i.postName}`}
                  >
                    <span className="att-alert-who">{i.personName ?? i.postName}</span>
                    <span className="att-alert-where">
                      {i.siteName}
                      {i.postName ? ` · ${i.postName}` : ''}
                    </span>
                    <span className="att-alert-meta">
                      since {hhmm(i.raisedAt)} · PIC {i.pic.name}
                    </span>
                    {last && (
                      <span className="att-alert-last">
                        {FOLLOW_UP_LABEL[last.kind]} by {last.by}, post still not covered
                      </span>
                    )}
                    <span className="att-alert-state">
                      <AlertState i={i} every={every} />
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </Card>
  );
}

/** A guard in a table row: avatar, name and staff number; an empty post shows a dashed placeholder. */
function Guard({ name, staffNo, children }: { name: string | null | undefined; staffNo?: string | null; children?: ReactNode }) {
  return (
    <div className="att-guard">
      {name ? (
        <Person name={name} size={32} sub={staffNo ? <span className="mono">{staffNo}</span> : undefined} />
      ) : (
        <span className="k-person">
          <span className="att-nobody" aria-hidden="true" />
          <span className="k-person-text">
            <span className="k-person-name">—</span>
            {staffNo && <span className="k-person-sub mono">{staffNo}</span>}
          </span>
        </span>
      )}
      {children}
    </div>
  );
}

function DaySheet({ onOpen, alerting }: { onOpen: (i: AttendanceIssueView) => void; alerting: ReactNode }) {
  const { companyId, me } = useApp();
  const today = dateOf(me.now);
  const [date, setDate] = useState(today);
  const [onlyIssues, setOnlyIssues] = useState(true);
  const [q, setQ] = useState('');
  const { data, error } = useLoad(() => api.attendance(companyId, date), [companyId, date]);
  const lock = useAction();

  const rows = ordered(data);
  const issueByShift = new Map<string, AttendanceIssueView[]>();
  for (const i of data?.issues ?? []) if (i.shiftId) issueByShift.set(i.shiftId, [...(issueByShift.get(i.shiftId) ?? []), i]);
  const needle = q.trim().toLowerCase();
  const matches = (...xs: (string | null | undefined)[]) => !needle || xs.some((x) => x?.toLowerCase().includes(needle));
  const shown = rows
    .filter((r) => !onlyIssues || r.parent || issueByShift.has(r.row.id) || rows.some((x) => x.parent === r.row.id) || r.row.state === 'unfilled')
    .filter((r) => matches(r.row.personName, r.row.staffNo, r.row.siteName, r.row.postName));
  const notRostered = (data?.notRostered ?? []).filter((x) => matches(x.personName, x.siteName));
  const dayRows = data?.rows ?? [];
  const issues = dayRows.filter((r) => r.state === 'no_show' || (r.attendance?.flags.length ?? 0) > 0).length;
  const noShows = dayRows.filter((r) => r.state === 'no_show').length;
  const late = dayRows.filter((r) => r.state === 'late_on_duty' || r.attendance?.flags.includes('LATE')).length;
  const away = dayRows.filter((r) => r.attendance?.flags.includes('OUTSIDE_GEOFENCE')).length;
  const empty = dayRows.filter((r) => r.state === 'unfilled').length;
  const nr = new Map((data?.issues ?? []).filter((i) => i.issue === 'NOT_ROSTERED').map((i) => [i.attendanceId, i]));
  const day = date === today ? 'today' : dayLabel(date);

  return (
    <>
      {data && (
        <Stats>
          <Stat label="No-shows" value={noShows} tone={noShows ? 'crit' : 'ok'} icon={<UserMinusIcon size={16} />} note={day} />
          <Stat label="Late" value={late} tone={late ? 'warn' : 'ok'} icon={<ClockIcon size={16} />} note={day} />
          <Stat label="Away from site" value={away} tone={away ? 'crit' : 'ok'} icon={<MapPinIcon size={16} />} note={day} />
          <Stat label="Posts empty" value={empty} tone={empty ? 'crit' : 'ok'} icon={<UserCircleDashedIcon size={16} />} note="Unfilled shifts" />
          <Stat
            label="Records to check"
            value={issues}
            tone={issues ? 'warn' : 'ok'}
            icon={<ClipboardTextIcon size={16} />}
            note={data.notRostered.length > 0 ? `${data.notRostered.length} clock-ins not on roster` : undefined}
          />
        </Stats>
      )}

      {alerting}

      <Toolbar
        end={
          data && (
            <>
              {data.notRostered.length > 0 && <Chip tone="crit">{data.notRostered.length} clock-ins not on roster</Chip>}
              <Chip tone={issues ? 'warn' : 'ok'}>{issues} records to check</Chip>
              {data.locked ? <Chip tone="ok">Day locked</Chip> : <Chip tone="neutral">Not locked</Chip>}
              {data.canLock && date < today && !data.locked && (
                <button
                  className="btn btn-primary btn-sm"
                  disabled={lock.busy}
                  onClick={() =>
                    lock.run(
                      () => api.lockAttendance(companyId, date),
                      (r) => `Locked ${r.locked} records for ${dayLabel(date)}.`,
                    )
                  }
                >
                  Lock {dayLabel(date)}
                </button>
              )}
            </>
          )
        }
      >
        <div className="seg" role="group" aria-label="Day">
          {[-2, -1, 0].map((o) => {
            const d = addDays(today, o);
            return (
              <button key={o} aria-pressed={date === d} onClick={() => setDate(d)}>
                {o === 0 ? 'Today' : o === -1 ? 'Yesterday' : dayLabel(d)}
              </button>
            );
          })}
        </div>
        <label className="att-check">
          <input id="only-issues" type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
          Only show problems
        </label>
        <Search value={q} onChange={setQ} placeholder="Search guard, staff no, site or post" />
      </Toolbar>
      <ErrorNotice error={lock.error} />
      {error && <ErrorNotice error={error} />}

      {!error && (
        <Card title={`Day sheet, ${dayLabel(date)}`} sub={onlyIssues ? 'Showing problems, empty posts and replacements' : 'Every shift on this day'} flush>
          {!data && (
            <div className="att-pad">
              <Loading what="attendance" />
            </div>
          )}
          {data && (
            <div className="table-wrap att-sheet">
              <table>
                <thead>
                  <tr>
                    <th>Guard</th>
                    <th>Site and post</th>
                    <th>Shift</th>
                    <th>In</th>
                    <th>Out</th>
                    <th className="num">Distance</th>
                    <th>Check</th>
                    <th>Alert and action</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(({ row: r, parent }) => {
                    const its = issueByShift.get(r.id) ?? [];
                    return (
                      <tr key={r.id} className={parent ? 'att-sub' : undefined} data-state={r.state}>
                        <td>
                          <Guard name={r.personName} staffNo={r.staffNo}>
                            {parent && (
                              <Chip tone="info">Replacement for {data.rows.find((x) => x.id === parent)?.personName ?? 'empty post'}</Chip>
                            )}
                          </Guard>
                        </td>
                        <td>
                          <div className="att-site">{r.siteName}</div>
                          <div className="muted small">{r.postName}</div>
                        </td>
                        <td className="mono att-nowrap">
                          {hhmm(r.start)}–{hhmm(r.end)}
                        </td>
                        <td className="mono">{hhmm(r.attendance?.clockIn)}</td>
                        <td className="mono">{hhmm(r.attendance?.clockOut)}</td>
                        <td className="num att-nowrap">{r.attendance?.distanceM != null ? `${r.attendance.distanceM} m` : '–'}</td>
                        <td>
                          <div className="att-chips">
                            {r.attendance?.flags.length ? (
                              r.attendance.flags.map((f) => (
                                <Chip key={f} tone={FLAG_TONE[f]}>
                                  {FLAG_LABEL[f]}
                                </Chip>
                              ))
                            ) : (
                              <Chip tone={SHIFT_STATE[r.state].tone}>{SHIFT_STATE[r.state].label}</Chip>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="att-chips">
                            {its.map((i) => (
                              <button key={i.key} className="btn btn-sm att-alert-btn" onClick={() => onOpen(i)} title={ATTENDANCE_ISSUE_LABEL[i.issue]}>
                                <AlertState i={i} every={5} />
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {notRostered.map((a) => {
                    const i = nr.get(a.id);
                    return (
                      <tr key={a.id} className="att-stray">
                        <td>
                          <Guard name={a.personName} />
                        </td>
                        <td>{a.siteName}</td>
                        <td className="muted">Not rostered</td>
                        <td className="mono">{hhmm(a.clockIn)}</td>
                        <td className="mono">{hhmm(a.clockOut)}</td>
                        <td className="num att-nowrap">{a.distanceM != null ? `${a.distanceM} m` : '–'}</td>
                        <td>
                          <Chip tone="crit">Not on roster</Chip>
                        </td>
                        <td>
                          {i && (
                            <button className="btn btn-sm att-alert-btn" onClick={() => onOpen(i)}>
                              <AlertState i={i} every={5} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {shown.length === 0 && notRostered.length === 0 && (
                <div className="empty">{needle ? `Nothing on this day matches “${q.trim()}”.` : 'No problems on this day.'}</div>
              )}
            </div>
          )}
        </Card>
      )}
    </>
  );
}

/** Day rows with each replacement placed right under the post it covers (Shahirah, 25 Oct 2026). */
function ordered(data: AttendanceDay | null): { row: AttendanceDay['rows'][number]; parent: string | null }[] {
  if (!data) return [];
  const parentOf = data.replacementFor;
  const children = new Map<string, AttendanceDay['rows']>();
  for (const r of data.rows) {
    const p = parentOf[r.id];
    if (p) children.set(p, [...(children.get(p) ?? []), r]);
  }
  const out: { row: AttendanceDay['rows'][number]; parent: string | null }[] = [];
  for (const r of data.rows) {
    if (parentOf[r.id] && data.rows.some((x) => x.id === parentOf[r.id])) continue;
    out.push({ row: r, parent: null });
    for (const c of children.get(r.id) ?? []) out.push({ row: c, parent: r.id });
  }
  return out;
}

function Record({ a, onOpen }: { a: AttendanceAlerts; onOpen: (i: AttendanceIssueView) => void }) {
  const [only, setOnly] = useState<'open' | 'all'>('open');
  const absences = a.absences.filter((i) => only === 'all' || i.open);
  return (
    <div className="att-record">
      <div className="att-record-main">
        <Card
          title="Absences, last 14 days"
          actions={
            <div className="seg" role="group" aria-label="Which absences">
              <button aria-pressed={only === 'open'} onClick={() => setOnly('open')}>
                Not closed
              </button>
              <button aria-pressed={only === 'all'} onClick={() => setOnly('all')}>
                All
              </button>
            </div>
          }
          flush
        >
          <div className="list">
            {absences.length === 0 && <div className="empty">No absences to show.</div>}
            {absences.slice(0, 80).map((i) => (
              <button key={i.key} className="list-item att-row" onClick={() => onOpen(i)}>
                <span className="att-row-main">
                  <span className="att-row-title">
                    {i.personName ?? 'No guard rostered'} · {dateLabel(i.date)}
                  </span>
                  <span className="muted small">
                    {i.siteName}
                    {i.postName ? ` · ${i.postName}` : ''} · {hhmm(i.shiftStart)}–{hhmm(i.shiftEnd)}
                  </span>
                  {i.actions.length > 0 && <span className="small">{i.actions.map((x) => FOLLOW_UP_LABEL[x.kind]).join(', ')}</span>}
                </span>
                <span className="att-row-side">
                  <Chip tone={ISSUE_TONE[i.issue]}>{isAbsence(i) && i.issue === 'POST_EMPTY' ? 'Post empty' : 'Absent'}</Chip>
                  <AlertState i={i} every={a.repeatMin} />
                </span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <div className="att-record-side">
        {a.s15.length > 0 && (
          <Card
            title="Absent more than 2 working days in a row"
            sub="Employment Act s.15(2) may apply. HR checks leave, excuse and whether the guard informed the company first."
            flush
          >
            <div className="list">
              {a.s15.map((x) => (
                <div key={x.personId + x.from} className="list-item att-row">
                  <span className="att-row-main">
                    <Person
                      name={x.personName}
                      size={32}
                      sub={
                        <>
                          {dateLabel(x.from)} to {dateLabel(x.to)}, no excuse recorded
                        </>
                      }
                    />
                  </span>
                  <Chip tone="crit">{x.days} working days</Chip>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card
          title="Disciplinary records"
          sub="One group handbook for every guard, under the Employment Act. Decided and recorded by the company, never by the app."
          flush
        >
          <div className="list">
            {a.discipline.length === 0 && <div className="empty">No disciplinary action recorded.</div>}
            {a.discipline.map(({ record: r, personName, siteName }) => (
              <div key={r.id} className="list-item att-entry">
                <div className="att-entry-head">
                  <strong>{personName}</strong>
                  <Chip tone="warn">{r.discipline ? DISCIPLINE_LABEL[r.discipline] : ''}</Chip>
                </div>
                <div className="muted small">
                  {ATTENDANCE_ISSUE_LABEL[r.issue]} on {dateLabel(r.date)} at {siteName} · recorded {dateTimeLabel(r.at)} by {r.by}
                </div>
                {r.note && <div className="small att-note">{r.note}</div>}
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="att-record-full">
        <Card title="Every action taken" sub="Kept in the audit trail" flush>
          <div className="list">
            {a.records.length === 0 && <div className="empty">Nothing recorded yet.</div>}
            {a.records.slice(0, 60).map(({ record: r, personName, replacementName, siteName }) => (
              <div key={r.id} className="list-item att-entry att-log">
                <div className="att-row-title">
                  {FOLLOW_UP_LABEL[r.kind]}
                  {r.discipline ? `: ${DISCIPLINE_LABEL[r.discipline]}` : ''}
                  {replacementName ? `: ${replacementName}` : ''}
                </div>
                <div className="muted small">
                  {ATTENDANCE_ISSUE_LABEL[r.issue]} · {personName || 'empty post'} · {siteName} · {dateTimeLabel(r.at)} · {r.by}
                  {r.byDesk === 'cms' ? ' (CMS)' : ''}
                </div>
                {r.note && <div className="small att-note">{r.note}</div>}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
