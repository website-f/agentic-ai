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
import { Card, PageHead, Person, Stat, Stats, Toolbar } from '../kit';
import { DataTable } from '../DataTable';
import { Chip, ErrorNotice, Loading, dateLabel, dateTimeLabel, dayLabel, hhmm, useAction, useLoad } from '../ui';
import { AlertState, FollowUpDrawer, ISSUE_TONE, isAbsence } from './FollowUp';
import { LeavePanel } from './Leave';
import { AttendanceReports, ImportTimesheetButton } from './AttendanceReports';

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
      {/* P112: a short header; the rules each section follows are shown in that section. */}
      <PageHead
        title="Attendance"
        sub="Who came, who was late and who was absent: the day sheet from the site devices, absences, leave, and each person's attendance from the monthly reports."
        actions={<ImportTimesheetButton onDone={() => setTab('reports')} />}
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
          Staff attendance
        </button>
      </div>

      {alerts.error && tab !== 'reports' && <ErrorNotice error={alerts.error} />}
      {tab === 'reports' && <AttendanceReports />}
      {tab === 'day' && (
        <DaySheet
          onOpen={setOpen}
          repeatMin={a?.repeatMin ?? 5}
          alerting={a && a.open.length > 0 ? <AlertingNow items={a.open} every={a.repeatMin} onOpen={setOpen} /> : null}
        />
      )}
      {tab === 'leave' && <LeavePanel companyId={companyId} />}
      {/* P90: after a failed load the error above stays alone, not beside a spinner that never stops. */}
      {tab === 'record' && (a ? <Record a={a} onOpen={setOpen} /> : alerts.error ? null : <Loading what="absence records" />)}

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

function DaySheet({ onOpen, alerting, repeatMin }: { onOpen: (i: AttendanceIssueView) => void; alerting: ReactNode; repeatMin: number }) {
  const { companyId, me } = useApp();
  const today = dateOf(me.now);
  const [date, setDate] = useState(today);
  const { data, error } = useLoad(() => api.attendance(companyId, date), [companyId, date]);
  const lock = useAction();

  const rows = ordered(data);
  const issueByShift = new Map<string, AttendanceIssueView[]>();
  for (const i of data?.issues ?? []) if (i.shiftId) issueByShift.set(i.shiftId, [...(issueByShift.get(i.shiftId) ?? []), i]);
  // P107: one list for the data table: each shift (replacements right under the post they cover), then clock-ins with
  // no shift. "Problems" are what the old "Only show problems" box kept.
  const problem = (r: (typeof rows)[number]) => !!r.parent || issueByShift.has(r.row.id) || rows.some((x) => x.parent === r.row.id) || r.row.state === 'unfilled';
  const sheet: SheetRow[] = [
    ...rows.map((r): SheetRow => ({ kind: 'shift', id: r.row.id, row: r.row, parent: r.parent, problem: problem(r) })),
    ...(data?.notRostered ?? []).map((a): SheetRow => ({ kind: 'stray', id: a.id, a })),
  ];
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
      <p className="muted small att-rules">
        The PIC is alerted when a guard is absent or a clock-in fails a check, every {repeatMin} minutes until someone acts. Lock each day after
        checking it. Nothing here pays, deducts or disciplines anyone automatically. Clock-ins come only from the site device with a face check; they are not typed in here. Shifts are added on the Roster.
      </p>

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
      </Toolbar>
      <ErrorNotice error={lock.error} />
      {error && <ErrorNotice error={error} />}

      {!error && (
        <Card title={`Day sheet, ${dayLabel(date)}`} sub="Problems, empty posts and replacements first; choose Show: All for every shift on this day." flush>
          {/* P107: the day sheet as a data table: search, show problems or all, site and check filters, sort, pages. */}
          <div className="att-dt">
            <DataTable
              label={`Day sheet, ${dayLabel(date)}`}
              stateKey="attendance.day"
              defaults={{ f: { show: 'problems' } }}
              rows={data ? sheet : null}
              loading={!data}
              loadingWhat="attendance"
              rowKey={(x) => x.id}
              searchPlaceholder="Search guard, staff no, site or post"
              searchText={(x) => (x.kind === 'shift' ? `${x.row.staffNo ?? ''} ${x.row.postName}` : '')}
              rowClass={(x) => (x.kind === 'stray' ? 'att-stray' : x.parent ? 'att-sub' : undefined)}
              rowTone={(x) =>
                x.kind === 'stray' || x.row.state === 'no_show' || x.row.state === 'unfilled' ? 'crit' : x.row.state === 'late_on_duty' ? 'warn' : undefined
              }
              empty={<div className="empty">No problems on this day.</div>}
              filters={[
                {
                  id: 'show',
                  label: 'Show',
                  value: (x) => (x.kind === 'stray' || x.problem ? 'problems' : 'fine'),
                  allLabel: 'Every shift',
                  options: [
                    { value: 'problems', label: 'Only problems' },
                    { value: 'fine', label: 'No problem' },
                  ],
                },
                { id: 'site', label: 'Site', value: (x) => (x.kind === 'shift' ? x.row.siteName : x.a.siteName) },
                { id: 'check', label: 'Check', value: checkWords },
              ]}
              columns={[
                {
                  id: 'guard',
                  label: 'Guard',
                  value: (x) => (x.kind === 'shift' ? x.row.personName : x.a.personName) ?? '',
                  phone: 'title',
                  render: (x) =>
                    x.kind === 'shift' ? (
                      <Guard name={x.row.personName} staffNo={x.row.staffNo}>
                        {x.parent && <Chip tone="info">Replacement for {data?.rows.find((y) => y.id === x.parent)?.personName ?? 'empty post'}</Chip>}
                      </Guard>
                    ) : (
                      <Guard name={x.a.personName} />
                    ),
                },
                {
                  id: 'site',
                  label: 'Site and post',
                  value: (x) => (x.kind === 'shift' ? x.row.siteName : x.a.siteName),
                  render: (x) =>
                    x.kind === 'shift' ? (
                      <>
                        <div className="att-site">{x.row.siteName}</div>
                        <div className="muted small">{x.row.postName}</div>
                      </>
                    ) : (
                      x.a.siteName
                    ),
                },
                {
                  id: 'shift',
                  label: 'Shift',
                  value: (x) => (x.kind === 'shift' ? x.row.start : null),
                  sort: 'date',
                  search: false,
                  render: (x) => (x.kind === 'shift' ? <span className="mono att-nowrap">{hhmm(x.row.start)}–{hhmm(x.row.end)}</span> : <span className="muted">Not rostered</span>),
                },
                {
                  id: 'in',
                  label: 'In',
                  value: (x) => (x.kind === 'shift' ? x.row.attendance?.clockIn : x.a.clockIn) ?? null,
                  sort: 'date',
                  search: false,
                  render: (x) => <span className="mono">{hhmm(x.kind === 'shift' ? x.row.attendance?.clockIn : x.a.clockIn)}</span>,
                },
                {
                  id: 'out',
                  label: 'Out',
                  value: (x) => (x.kind === 'shift' ? x.row.attendance?.clockOut : x.a.clockOut) ?? null,
                  sort: 'date',
                  search: false,
                  render: (x) => <span className="mono">{hhmm(x.kind === 'shift' ? x.row.attendance?.clockOut : x.a.clockOut)}</span>,
                },
                {
                  id: 'distance',
                  label: 'Distance',
                  value: (x) => (x.kind === 'shift' ? x.row.attendance?.distanceM : x.a.distanceM) ?? null,
                  sort: 'number',
                  search: false,
                  hideBelow: 1200,
                  render: (x) => {
                    const m = x.kind === 'shift' ? x.row.attendance?.distanceM : x.a.distanceM;
                    return <span className="att-nowrap">{m != null ? `${m} m` : '–'}</span>;
                  },
                },
                {
                  id: 'check',
                  label: 'Check',
                  value: (x) => checkWords(x).join(', '),
                  translate: true,
                  render: (x) => (
                    <div className="att-chips">
                      {x.kind === 'stray' ? (
                        <Chip tone="crit">Not on roster</Chip>
                      ) : x.row.attendance?.flags.length ? (
                        x.row.attendance.flags.map((f) => (
                          <Chip key={f} tone={FLAG_TONE[f]}>
                            {FLAG_LABEL[f]}
                          </Chip>
                        ))
                      ) : (
                        <Chip tone={SHIFT_STATE[x.row.state].tone}>{SHIFT_STATE[x.row.state].label}</Chip>
                      )}
                    </div>
                  ),
                },
                {
                  id: 'alert',
                  label: 'Alert and action',
                  sort: false,
                  render: (x) => {
                    const its = x.kind === 'shift' ? (issueByShift.get(x.row.id) ?? []) : nr.get(x.a.id) ? [nr.get(x.a.id)!] : [];
                    return (
                      <div className="att-chips">
                        {its.map((i) => (
                          <button key={i.key} className="btn btn-sm att-alert-btn" onClick={() => onOpen(i)} title={ATTENDANCE_ISSUE_LABEL[i.issue]}>
                            <AlertState i={i} every={5} />
                          </button>
                        ))}
                      </div>
                    );
                  },
                },
              ]}
            />
          </div>
        </Card>
      )}
    </>
  );
}

/** P107: a line of the day sheet: a shift (a replacement knows the post it covers), or a clock-in with no shift. */
type SheetRow =
  | { kind: 'shift'; id: string; row: AttendanceDay['rows'][number]; parent: string | null; problem: boolean }
  | { kind: 'stray'; id: string; a: AttendanceDay['notRostered'][number] };

/** What the Check column says, in words (the chips), for search and its filter. */
function checkWords(x: SheetRow): string[] {
  if (x.kind === 'stray') return ['Not on roster'];
  return x.row.attendance?.flags.length ? x.row.attendance.flags.map((f) => FLAG_LABEL[f]) : [SHIFT_STATE[x.row.state].label];
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

/** "Post empty" or "Absent", as the chip says. */
function absenceWord(i: AttendanceIssueView): string {
  return isAbsence(i) && i.issue === 'POST_EMPTY' ? 'Post empty' : 'Absent';
}

function Record({ a, onOpen }: { a: AttendanceAlerts; onOpen: (i: AttendanceIssueView) => void }) {
  return (
    <div className="att-record">
      <div className="att-record-main">
        <Card title="Absences, last 14 days" flush>
          {/* P107: a data table (search, not closed / all, site and kind filters, sort, pages) in place of the first 80. */}
          <DataTable
            label="Absences, last 14 days"
            stateKey="attendance.absences"
            defaults={{ f: { which: 'open' } }}
            rows={a.absences}
            rowKey={(i) => i.key}
            searchPlaceholder="Search guard, site or post"
            searchText={(i) => `${i.postName ?? ''}`}
            onRowClick={onOpen}
            empty={<div className="empty">No absences to show.</div>}
            filters={[
              {
                id: 'which',
                label: 'Which absences',
                value: (i) => (i.open ? 'open' : 'closed'),
                options: [
                  { value: 'open', label: 'Not closed' },
                  { value: 'closed', label: 'Closed' },
                ],
              },
              { id: 'site', label: 'Site', value: (i) => i.siteName ?? '' },
              { id: 'kind', label: 'Kind', value: (i) => absenceWord(i) },
            ]}
            columns={[
              {
                id: 'guard',
                label: 'Guard',
                value: (i) => i.personName ?? 'No guard rostered',
                phone: 'title',
                render: (i) => <span className="att-row-title">{i.personName ?? 'No guard rostered'}</span>,
              },
              { id: 'date', label: 'Date', value: (i) => i.date, sort: 'date' },
              {
                id: 'site',
                label: 'Site and shift',
                value: (i) => i.siteName ?? '',
                render: (i) => (
                  <span className="muted small">
                    {i.siteName}
                    {i.postName ? ` · ${i.postName}` : ''} · {hhmm(i.shiftStart)}–{hhmm(i.shiftEnd)}
                  </span>
                ),
              },
              {
                id: 'actions',
                label: 'Done so far',
                value: (i) => i.actions.map((x) => FOLLOW_UP_LABEL[x.kind]).join(', '),
                sort: false,
                hideBelow: 1280,
              },
              {
                id: 'state',
                label: 'Alert',
                value: (i) => absenceWord(i),
                translate: true,
                render: (i) => (
                  <span className="att-row-side">
                    <Chip tone={ISSUE_TONE[i.issue]}>{absenceWord(i)}</Chip>
                    <AlertState i={i} every={a.repeatMin} />
                  </span>
                ),
              },
            ]}
          />
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
          <DataTable
            label="Disciplinary records"
            stateKey="attendance.discipline"
            rows={a.discipline}
            rowKey={(x) => x.record.id}
            searchPlaceholder="Search guard or site"
            searchText={(x) => `${x.siteName} ${x.record.note ?? ''} ${x.record.by}`}
            phoneFacts={3}
            empty={<div className="empty">No disciplinary action recorded.</div>}
            filters={[
              { id: 'discipline', label: 'Action', value: (x) => x.record.discipline ?? '', optionLabel: (k) => DISCIPLINE_LABEL[k as keyof typeof DISCIPLINE_LABEL] ?? k },
              { id: 'issue', label: 'Issue', value: (x) => x.record.issue, optionLabel: (k) => ATTENDANCE_ISSUE_LABEL[k as keyof typeof ATTENDANCE_ISSUE_LABEL] ?? k },
            ]}
            columns={[
              { id: 'guard', label: 'Guard', value: (x) => x.personName, phone: 'title', render: (x) => <strong>{x.personName}</strong> },
              {
                id: 'action',
                label: 'Action',
                value: (x) => (x.record.discipline ? DISCIPLINE_LABEL[x.record.discipline] : ''),
                translate: true,
                render: (x) => <Chip tone="warn">{x.record.discipline ? DISCIPLINE_LABEL[x.record.discipline] : ''}</Chip>,
              },
              { id: 'date', label: 'Date', value: (x) => x.record.date, sort: 'date' },
            ]}
            rowDetail={(x) => (
              <div className="hx-dt-body">
                <div className="muted small">
                  {ATTENDANCE_ISSUE_LABEL[x.record.issue]} on {dateLabel(x.record.date)} at {x.siteName} · recorded {dateTimeLabel(x.record.at)} by {x.record.by}
                </div>
                {x.record.note && <div className="small att-note">{x.record.note}</div>}
              </div>
            )}
          />
        </Card>
      </div>

      <div className="att-record-full">
        <Card title="Every action taken" sub="Kept in the audit trail" flush>
          {/* P107: every action (no longer only the latest 60) as a data table: search, kind / issue / desk filters, pages. */}
          <DataTable
            label="Every action taken"
            stateKey="attendance.actions"
            rows={a.records}
            rowKey={(x) => x.record.id}
            searchPlaceholder="Search guard, site, person or note"
            searchText={(x) => `${x.replacementName ?? ''} ${x.record.note ?? ''} ${x.record.by}`}
            empty={<div className="empty">Nothing recorded yet.</div>}
            filters={[
              { id: 'kind', label: 'Action', value: (x) => x.record.kind, optionLabel: (k) => FOLLOW_UP_LABEL[k as keyof typeof FOLLOW_UP_LABEL] ?? k },
              { id: 'issue', label: 'Issue', value: (x) => x.record.issue, optionLabel: (k) => ATTENDANCE_ISSUE_LABEL[k as keyof typeof ATTENDANCE_ISSUE_LABEL] ?? k },
              {
                id: 'desk',
                label: 'By',
                value: (x) => (x.record.byDesk === 'cms' ? 'cms' : 'company'),
                options: [
                  { value: 'cms', label: 'CMS' },
                  { value: 'company', label: 'The company' },
                ],
              },
            ]}
            columns={[
              {
                id: 'action',
                label: 'Action',
                value: (x) => FOLLOW_UP_LABEL[x.record.kind],
                translate: true,
                phone: 'title',
                render: (x) => (
                  <span className="att-row-title">
                    {FOLLOW_UP_LABEL[x.record.kind]}
                    {x.record.discipline ? `: ${DISCIPLINE_LABEL[x.record.discipline]}` : ''}
                    {x.replacementName ? `: ${x.replacementName}` : ''}
                  </span>
                ),
              },
              { id: 'issue', label: 'Issue', value: (x) => ATTENDANCE_ISSUE_LABEL[x.record.issue], translate: true },
              { id: 'guard', label: 'Guard', value: (x) => x.personName || 'empty post' },
              { id: 'site', label: 'Site', value: (x) => x.siteName, hideBelow: 1200 },
              { id: 'at', label: 'When', value: (x) => x.record.at, sort: 'date', render: (x) => dateTimeLabel(x.record.at) },
              { id: 'by', label: 'By', value: (x) => `${x.record.by}${x.record.byDesk === 'cms' ? ' (CMS)' : ''}`, hideBelow: 1280 },
            ]}
            rowDetail={(x) => (x.record.note ? <div className="small att-note">{x.record.note}</div> : null)}
          />
        </Card>
      </div>
    </div>
  );
}
