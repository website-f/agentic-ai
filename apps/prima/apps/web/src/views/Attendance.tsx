import { useState } from 'react';
import { ATTENDANCE_ISSUE_LABEL, DISCIPLINE_LABEL, FOLLOW_UP_LABEL, addDays, dateOf, type AttendanceIssueView } from '@prima/core';
import { api } from '../api';
import type { AttendanceAlerts, AttendanceDay } from '../api/types';
import { useApp } from '../App';
import { Chip, ErrorNotice, Loading, dateLabel, dateTimeLabel, dayLabel, hhmm, useAction, useLoad } from '../ui';
import { AlertState, FollowUpDrawer, ISSUE_TONE, isAbsence } from './FollowUp';
import { LeavePanel } from './Leave';
import { FLAG_LABEL, FLAG_TONE, SHIFT_STATE } from './shared';

export function AttendanceView() {
  const { companyId } = useApp();
  const [tab, setTab] = useState<'day' | 'record' | 'leave'>('day');
  const alerts = useLoad(() => api.attendanceAlerts(companyId), [companyId]);
  const [open, setOpen] = useState<AttendanceIssueView | null>(null);
  const a = alerts.data;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Attendance</h1>
          <p>
            The PIC is alerted when a guard is absent or a clock-in fails a check, every {a?.repeatMin ?? 5} minutes until someone acts. Lock each day after
            checking it. Nothing here pays, deducts or disciplines anyone automatically.
          </p>
        </div>
      </div>

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
      </div>

      {alerts.error && <ErrorNotice error={alerts.error} />}
      {a && a.open.length > 0 && tab === 'day' && <AlertingNow items={a.open} every={a.repeatMin} onOpen={setOpen} />}
      {tab === 'day' && <DaySheet onOpen={setOpen} />}
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

function AlertingNow({ items, every, onOpen }: { items: AttendanceIssueView[]; every: number; onOpen: (i: AttendanceIssueView) => void }) {
  return (
    <section className="panel" aria-label="Alerting the PIC now">
      <div className="panel-head">
        <h2>Alerting the PIC now</h2>
        <span className="muted small">Repeats every {every} min until an action is recorded</span>
      </div>
      <div className="list">
        {items.map((i) => (
          <button key={i.key} className="list-item" onClick={() => onOpen(i)}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>
                {ATTENDANCE_ISSUE_LABEL[i.issue]}: {i.personName ?? i.postName}
              </div>
              <div className="muted small">
                {i.siteName}
                {i.postName ? ` · ${i.postName}` : ''} · since {hhmm(i.raisedAt)} · PIC {i.pic.name}
              </div>
              {i.actions.length > 0 && (
                <div className="small">
                  {FOLLOW_UP_LABEL[i.actions[i.actions.length - 1].kind]} by {i.actions[i.actions.length - 1].by}, post still not covered
                </div>
              )}
            </div>
            <AlertState i={i} every={every} />
          </button>
        ))}
      </div>
    </section>
  );
}

function DaySheet({ onOpen }: { onOpen: (i: AttendanceIssueView) => void }) {
  const { companyId, me } = useApp();
  const today = dateOf(me.now);
  const [date, setDate] = useState(today);
  const [onlyIssues, setOnlyIssues] = useState(true);
  const { data, error } = useLoad(() => api.attendance(companyId, date), [companyId, date]);
  const lock = useAction();

  if (error) return <ErrorNotice error={error} />;
  const rows = ordered(data);
  const issueByShift = new Map<string, AttendanceIssueView[]>();
  for (const i of data?.issues ?? []) if (i.shiftId) issueByShift.set(i.shiftId, [...(issueByShift.get(i.shiftId) ?? []), i]);
  const shown = rows.filter(
    (r) => !onlyIssues || r.parent || issueByShift.has(r.row.id) || rows.some((x) => x.parent === r.row.id) || r.row.state === 'unfilled',
  );
  const issues = (data?.rows ?? []).filter((r) => r.state === 'no_show' || (r.attendance?.flags.length ?? 0) > 0).length;
  const nr = new Map((data?.issues ?? []).filter((i) => i.issue === 'NOT_ROSTERED').map((i) => [i.attendanceId, i]));

  return (
    <>
      <div className="row">
        <div className="seg">
          {[-2, -1, 0].map((o) => {
            const d = addDays(today, o);
            return (
              <button key={o} aria-pressed={date === d} onClick={() => setDate(d)}>
                {o === 0 ? 'Today' : o === -1 ? 'Yesterday' : dayLabel(d)}
              </button>
            );
          })}
        </div>
        <label className="row small" style={{ gap: 6 }}>
          <input id="only-issues" type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
          Only show problems
        </label>
      </div>

      {data && (
        <div className="row">
          <Chip tone={issues ? 'warn' : 'ok'}>{issues} records to check</Chip>
          {data.notRostered.length > 0 && <Chip tone="crit">{data.notRostered.length} clock-ins not on roster</Chip>}
          {data.locked ? <Chip tone="ok">Day locked</Chip> : <Chip tone="neutral">Not locked</Chip>}
          <span style={{ flex: 1 }} />
          {data.canLock && date < today && !data.locked && (
            <button
              className="btn btn-primary"
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
        </div>
      )}
      <ErrorNotice error={lock.error} />

      <section className="panel">
        {!data && <Loading what="attendance" />}
        {data && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Guard</th>
                  <th>Site and post</th>
                  <th>Shift</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Distance</th>
                  <th>Check</th>
                  <th>Alert and action</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ row: r, parent }) => {
                  const its = issueByShift.get(r.id) ?? [];
                  return (
                    <tr key={r.id} style={parent ? { background: 'var(--surface-2, transparent)' } : undefined}>
                      <td style={parent ? { paddingLeft: 24 } : undefined}>
                        <div style={{ fontWeight: 600 }}>{r.personName ?? '—'}</div>
                        <div className="mono small muted">{r.staffNo}</div>
                        {parent && <Chip tone="info">Replacement for {data.rows.find((x) => x.id === parent)?.personName ?? 'empty post'}</Chip>}
                      </td>
                      <td>
                        <div>{r.siteName}</div>
                        <div className="muted small">{r.postName}</div>
                      </td>
                      <td className="mono">
                        {hhmm(r.start)}–{hhmm(r.end)}
                      </td>
                      <td className="mono">{hhmm(r.attendance?.clockIn)}</td>
                      <td className="mono">{hhmm(r.attendance?.clockOut)}</td>
                      <td className="num">{r.attendance?.distanceM != null ? `${r.attendance.distanceM} m` : '–'}</td>
                      <td>
                        <div className="row" style={{ gap: 4 }}>
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
                        <div className="row" style={{ gap: 4 }}>
                          {its.map((i) => (
                            <button key={i.key} className="btn btn-sm" onClick={() => onOpen(i)} title={ATTENDANCE_ISSUE_LABEL[i.issue]}>
                              <AlertState i={i} every={5} />
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {data.notRostered.map((a) => {
                  const i = nr.get(a.id);
                  return (
                    <tr key={a.id}>
                      <td style={{ fontWeight: 600 }}>{a.personName}</td>
                      <td>{a.siteName}</td>
                      <td className="muted">Not rostered</td>
                      <td className="mono">{hhmm(a.clockIn)}</td>
                      <td className="mono">{hhmm(a.clockOut)}</td>
                      <td className="num">{a.distanceM != null ? `${a.distanceM} m` : '–'}</td>
                      <td>
                        <Chip tone="crit">Not on roster</Chip>
                      </td>
                      <td>
                        {i && (
                          <button className="btn btn-sm" onClick={() => onOpen(i)}>
                            <AlertState i={i} every={5} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {shown.length === 0 && data.notRostered.length === 0 && <div className="empty">No problems on this day.</div>}
          </div>
        )}
      </section>
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
    <>
      <section className="panel" aria-label="Absences">
        <div className="panel-head">
          <h2>Absences, last 14 days</h2>
          <div className="seg">
            <button aria-pressed={only === 'open'} onClick={() => setOnly('open')}>
              Not closed
            </button>
            <button aria-pressed={only === 'all'} onClick={() => setOnly('all')}>
              All
            </button>
          </div>
        </div>
        <div className="list">
          {absences.length === 0 && <div className="empty">No absences to show.</div>}
          {absences.slice(0, 80).map((i) => (
            <button key={i.key} className="list-item" onClick={() => onOpen(i)}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>
                  {i.personName ?? 'No guard rostered'} · {dateLabel(i.date)}
                </div>
                <div className="muted small">
                  {i.siteName}
                  {i.postName ? ` · ${i.postName}` : ''} · {hhmm(i.shiftStart)}–{hhmm(i.shiftEnd)}
                </div>
                {i.actions.length > 0 && <div className="small">{i.actions.map((x) => FOLLOW_UP_LABEL[x.kind]).join(', ')}</div>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                <Chip tone={ISSUE_TONE[i.issue]}>{isAbsence(i) && i.issue === 'POST_EMPTY' ? 'Post empty' : 'Absent'}</Chip>
                <AlertState i={i} every={a.repeatMin} />
              </div>
            </button>
          ))}
        </div>
      </section>

      {a.s15.length > 0 && (
        <section className="panel" aria-label="Employment Act section 15(2)">
          <div className="panel-head">
            <h2>Absent more than 2 working days in a row</h2>
            <span className="muted small">Employment Act s.15(2) may apply. HR checks leave, excuse and whether the guard informed the company first.</span>
          </div>
          <div className="list">
            {a.s15.map((x) => (
              <div key={x.personId + x.from} className="list-item">
                <div>
                  <div style={{ fontWeight: 600 }}>{x.personName}</div>
                  <div className="muted small">
                    {dateLabel(x.from)} to {dateLabel(x.to)}, no excuse recorded
                  </div>
                </div>
                <Chip tone="crit">{x.days} working days</Chip>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel" aria-label="Disciplinary records">
        <div className="panel-head">
          <h2>Disciplinary records</h2>
          <span className="muted small">
            One group handbook for every guard, under the Employment Act. Decided and recorded by the company, never by the app.
          </span>
        </div>
        <div className="list">
          {a.discipline.length === 0 && <div className="empty">No disciplinary action recorded.</div>}
          {a.discipline.map(({ record: r, personName, siteName }) => (
            <div key={r.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{personName}</strong>
                <Chip tone="warn">{r.discipline ? DISCIPLINE_LABEL[r.discipline] : ''}</Chip>
              </div>
              <div className="muted small">
                {ATTENDANCE_ISSUE_LABEL[r.issue]} on {dateLabel(r.date)} at {siteName} · recorded {dateTimeLabel(r.at)} by {r.by}
              </div>
              {r.note && <div className="small">{r.note}</div>}
            </div>
          ))}
        </div>
      </section>

      <section className="panel" aria-label="All actions">
        <div className="panel-head">
          <h2>Every action taken</h2>
          <span className="muted small">Kept in the audit trail</span>
        </div>
        <div className="list">
          {a.records.length === 0 && <div className="empty">Nothing recorded yet.</div>}
          {a.records.slice(0, 60).map(({ record: r, personName, replacementName, siteName }) => (
            <div key={r.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
              <div style={{ fontWeight: 600 }}>
                {FOLLOW_UP_LABEL[r.kind]}
                {r.discipline ? `: ${DISCIPLINE_LABEL[r.discipline]}` : ''}
                {replacementName ? `: ${replacementName}` : ''}
              </div>
              <div className="muted small">
                {ATTENDANCE_ISSUE_LABEL[r.issue]} · {personName || 'empty post'} · {siteName} · {dateTimeLabel(r.at)} · {r.by}
                {r.byDesk === 'cms' ? ' (CMS)' : ''}
              </div>
              {r.note && <div className="small">{r.note}</div>}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
