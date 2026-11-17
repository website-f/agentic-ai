// P112 (Fitri, 17 Nov 2026: "in attendance HR page i click any user and saw its details, can you make it seamless, can
// filter either this month, this year, KPI attendance and so on ... and i don't see when i click and the details come
// out change designation and change company"): one person's attendance from the monthly reports over a period they
// choose, with the figures worked out on the server (AttendanceReportService.personPeriod), month by month and each day,
// and Change designation / Change company for that person (StaffBulk.tsx, the same rules as the staff list).
import { useState } from 'react';
import {
  CalendarCheckIcon,
  CalendarXIcon,
  ClockCountdownIcon,
  FirstAidKitIcon,
  GaugeIcon,
  HourglassMediumIcon,
  SignOutIcon,
  TargetIcon,
  UserMinusIcon,
} from '@phosphor-icons/react';
import { attendancePeriod, dateOf, type AttendanceDayStatus, type AttendancePeriodKind } from '@prima/core';
import { api } from '../api';
import type { AttendancePersonPeriodView } from '../api/attendance-reports';
import { useApp } from '../App';
import { DataTable } from '../DataTable';
import { Card, Empty, Stat } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, useLoad, type Tone } from '../ui';
import { StaffPersonActions, useStaffChangeRights } from './StaffBulk';
import { OfficeMemberCard } from './OfficeMemberCard';
import '../styles/attendance-person.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const nf = (v: number, d = 0) => v.toLocaleString('en-MY', { minimumFractionDigits: d, maximumFractionDigits: d });
const hm = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`);
export const pct = (v: number | null) => (v === null ? '–' : `${nf(v, 1)}%`);

/** A period on the screen: a chip (or the latest month the reports have) and the days or months it covers. */
export interface PeriodChoice {
  kind: AttendancePeriodKind | 'latest';
  from: string;
  to: string;
}

const CHIPS: { kind: AttendancePeriodKind | 'latest'; label: string }[] = [
  { kind: 'latest', label: 'Latest month' },
  { kind: 'this_month', label: 'This month' },
  { kind: 'last_month', label: 'Last month' },
  { kind: 'this_year', label: 'This year' },
  { kind: 'last_12', label: 'Last 12 months' },
  { kind: 'custom', label: 'Custom range' },
];

/** The days of a chip, from today (core attendancePeriod); 'latest' is the newest month on the reports. */
export function periodDays(kind: PeriodChoice['kind'], today: string, latest: string | null): PeriodChoice | null {
  if (kind === 'latest') {
    if (!latest) return null;
    const p = attendancePeriod('this_month', `${latest}-01`);
    return { kind, ...p };
  }
  if (kind === 'custom') return null;
  return { kind, ...attendancePeriod(kind, today) };
}

/** The same period in whole months (YYYY-MM), for the page's overview. */
export const asMonths = (p: PeriodChoice): PeriodChoice => ({ ...p, from: p.from.slice(0, 7), to: p.to.slice(0, 7) });

/**
 * The period chips: Latest month (where the page has one), This month, Last month, This year, Last 12 months and a
 * custom range (days in a person's details, whole months on the page).
 */
export function PeriodPicker({
  value,
  onChange,
  unit,
  latest,
  withLatest = false,
}: {
  value: PeriodChoice;
  onChange: (p: PeriodChoice) => void;
  unit: 'day' | 'month';
  latest: string | null;
  withLatest?: boolean;
}) {
  const { me } = useApp();
  const today = dateOf(me.now);
  const conv = (p: PeriodChoice) => (unit === 'month' ? asMonths(p) : p);
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);
  const okCustom = !!from && !!to && from <= to;
  return (
    <div className="ap-period">
      <div className="ap-chips" role="group" aria-label="Period">
        {CHIPS.filter((c) => withLatest || c.kind !== 'latest').map((c) => (
          <button
            key={c.kind}
            type="button"
            className="ap-chip"
            aria-pressed={value.kind === c.kind}
            disabled={c.kind === 'latest' && !latest}
            onClick={() => {
              if (c.kind === 'custom') {
                setFrom(value.from);
                setTo(value.to);
                onChange({ kind: 'custom', from: value.from, to: value.to });
                return;
              }
              const p = periodDays(c.kind, today, latest);
              if (p) onChange(conv(p));
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
      {value.kind === 'custom' && (
        <form
          className="ap-custom"
          onSubmit={(e) => {
            e.preventDefault();
            if (okCustom) onChange({ kind: 'custom', from, to });
          }}
        >
          <label className="field">
            <span className="label">From</span>
            <input className="input" type={unit === 'month' ? 'month' : 'date'} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">To</span>
            <input className="input" type={unit === 'month' ? 'month' : 'date'} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-sm btn-primary" disabled={!okCustom || (from === value.from && to === value.to)}>
            Show
          </button>
        </form>
      )}
    </div>
  );
}

/** What each day status is called and how it is coloured (core dayStatus). */
export const DAY_STATUS: Record<AttendanceDayStatus, { label: string; tone: Tone }> = {
  present: { label: 'On time', tone: 'ok' },
  late: { label: 'Late', tone: 'warn' },
  early: { label: 'Left early', tone: 'warn' },
  absent: { label: 'Absent', tone: 'crit' },
  leave: { label: 'Leave', tone: 'info' },
  mc: { label: 'MC', tone: 'info' },
  rest: { label: 'Rest day', tone: 'neutral' },
  holiday: { label: 'Public holiday', tone: 'neutral' },
  none: { label: 'Nothing on the report', tone: 'neutral' },
};

/** The period a person's details open on: the page's period in days (whole months on the page). */
export function daysOf(p: PeriodChoice): PeriodChoice {
  if (p.from.length === 10) return p;
  return { kind: p.kind, from: `${p.from}-01`, to: attendancePeriod('this_month', `${p.to}-01`).to };
}

export function AttendancePersonDrawer({ importId, k, initial, latest, onClose }: { importId: string; k: string; initial: PeriodChoice; latest: string | null; onClose: () => void }) {
  const [period, setPeriod] = useState<PeriodChoice>(() => daysOf(initial));
  const client = api.attendanceReports!;
  const { data, error, loading, reload } = useLoad(() => client.personPeriod(importId, k, period.from, period.to), [importId, k, period.from, period.to]);
  const p = data;
  const name = p ? (p.person?.name ?? p.employee.name) : 'Attendance';
  const staffNo = p ? (p.person?.staffNo ?? p.employee.empCode) : null;
  const title = p ? (p.person?.jobTitle ?? p.employee.designation) : null;
  return (
    <Drawer title={<span data-no-translate>{name}</span>} sub={p ? [staffNo, title, p.companyName].filter(Boolean).join(' · ') : undefined} onClose={onClose}>
      <div className="ap" data-busy={loading || undefined}>
        {p && <PersonHead p={p} onChanged={reload} />}
        <PeriodPicker value={period} onChange={setPeriod} unit="day" latest={p && p.reportMonths.length ? p.reportMonths[p.reportMonths.length - 1] : latest} withLatest />
        <p className="muted small ap-span">
          {dateLabel(period.from)} – {dateLabel(period.to)}
          {p && p.reportMonths.length > 0 && (
            <>
              {' · '}
              <span>Reports cover</span> {monthName(p.reportMonths[0])} – {monthName(p.reportMonths[p.reportMonths.length - 1])}
            </>
          )}
        </p>
        {error && <ErrorNotice error={error} />}
        {!p && !error && <Loading what="attendance" />}
        {p && p.kpi.days === 0 && (
          <Card>
            <Empty title="No attendance for this period">
              The monthly reports have nothing for this person in these days. Choose another period, or Latest month.
            </Empty>
          </Card>
        )}
        {p && p.kpi.days > 0 && <PersonFigures p={p} />}
        <p className="muted small">
          Figures are as the attendance system printed them; nothing here pays, deducts or disciplines anyone. The reports do not say the site worked
          or whether a leave was approved, so those are not shown.
        </p>
      </div>
    </Drawer>
  );
}

/** Who this is, the actions for them, and where the office member card goes. */
function PersonHead({ p, onChanged }: { p: AttendancePersonPeriodView; onChanged: () => void }) {
  const rights = useStaffChangeRights();
  const x = p.person;
  return (
    <div className="ap-head">
      {!x && <div className="notice" data-tone="warn">Not matched to a staff record yet. HR matches it under “Match to staff”.</div>}
      {x && (
        <StaffPersonActions
          person={{ id: x.id, name: x.name, staffNo: x.staffNo, role: x.role, status: x.status, leaving: x.leaving, companyId: x.companyId, jobTitle: x.jobTitle, companyName: x.companyId === p.companyId ? p.companyName : null }}
          rights={rights}
          onDone={onChanged}
        />
      )}
      {x && <OfficeMemberCard person={{ id: x.id, name: x.name, jobTitle: x.jobTitle ?? null, companyId: x.companyId, staffNo: x.staffNo ?? null }} />}
    </div>
  );
}

function PersonFigures({ p }: { p: AttendancePersonPeriodView }) {
  const k = p.kpi;
  return (
    <>
      <div className="ap-tiles">
        <Stat label="Working days" value={nf(k.workingDays)} icon={<CalendarCheckIcon size={16} />} tone="neutral" note={`${nf(k.rest)} rest · ${nf(k.holiday)} public holiday`} />
        <Stat label="Present" value={nf(k.present)} icon={<CalendarCheckIcon size={16} />} tone="ok" note={`${nf(k.actualH, 1)} h worked`} />
        <Stat label="Absent" value={nf(k.absent)} icon={<UserMinusIcon size={16} />} tone={k.absent ? 'crit' : 'ok'} />
        <Stat label="Late" value={nf(k.lateCount)} icon={<ClockCountdownIcon size={16} />} tone={k.lateCount ? 'warn' : 'ok'} note={k.lateMin ? `${hm(k.lateMin)} in all` : undefined} />
        <Stat label="Early out" value={nf(k.earlyCount)} icon={<SignOutIcon size={16} />} tone={k.earlyCount ? 'warn' : 'ok'} note={k.earlyMin ? `${hm(k.earlyMin)} in all` : undefined} />
        <Stat label="Leave / MC" value={`${nf(k.leave)} / ${nf(k.mc)}`} icon={<FirstAidKitIcon size={16} />} tone="info" />
        <Stat label="Overtime hours" value={nf(k.otHours, 1)} icon={<HourglassMediumIcon size={16} />} tone="info" />
        <Stat label="Attendance rate" value={pct(k.rate)} icon={<GaugeIcon size={16} />} tone={rateTone(k.rate)} note="Present out of present and absent days" />
        <Stat label="Punctuality" value={pct(k.punctuality)} icon={<TargetIcon size={16} />} tone={rateTone(k.punctuality)} note="Present days not late" />
      </div>

      {p.months.length > 1 && (
        <Card title="Month by month" sub="Attendance rate as a bar; the figures beside it" flush>
          <ul className="ap-months">
            {p.months.map((m) => (
              <li key={m.month}>
                <span className="ap-m-name">{monthName(m.month)}</span>
                <span className="ap-m-bar" role="img" aria-label={`Attendance rate ${pct(m.rate)}`}>
                  <span className="ap-m-fill" data-tone={rateTone(m.rate)} style={{ ['--w' as string]: `${m.rate ?? 0}%` }} />
                </span>
                <span className="ap-m-rate num">{pct(m.rate)}</span>
                <span className="ap-m-figs small">
                  <span>
                    <strong>{m.present}</strong> <span>present</span>
                  </span>
                  <span data-tone={m.absent ? 'crit' : undefined}>
                    <strong>{m.absent}</strong> <span>absent</span>
                  </span>
                  <span data-tone={m.lateCount ? 'warn' : undefined}>
                    <strong>{m.lateCount}</strong> <span>late</span>
                  </span>
                  <span>
                    <strong>{m.leave + m.mc}</strong> <span>leave / MC</span>
                  </span>
                  <span>
                    <strong>{nf(m.otHours, 1)}</strong> <span>OT h</span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Each day" sub={`${nf(p.days.length)} days on the reports in this period`} flush>
        <DataTable
          label="Each day"
          stateKey="attendance.person.days"
          rows={p.days}
          rowKey={(d) => d.id}
          noSearch
          empty={<div className="empty">No days with this status in the period.</div>}
          filters={[{ id: 'status', label: 'Status', value: (d) => d.status, allLabel: 'Every day', optionLabel: (s) => DAY_STATUS[s as AttendanceDayStatus]?.label ?? s }]}
          rowTone={(d) => (d.status === 'absent' ? 'crit' : d.status === 'late' || d.status === 'early' ? 'warn' : undefined)}
          columns={[
            { id: 'date', label: 'Date', value: (d) => d.date, sort: 'date', phone: 'title', render: (d) => <span className="ap-nowrap">{dateLabel(d.date)}</span> },
            {
              id: 'status',
              label: 'Status',
              value: (d) => DAY_STATUS[d.status].label,
              translate: true,
              phone: 'sub',
              // The report's reason (leave code) under the chip, where it says more than the status.
              render: (d) => (
                <span className="ap-status-cell">
                  <Chip tone={DAY_STATUS[d.status].tone}>{DAY_STATUS[d.status].label}</Chip>
                  {d.reasonLabel && d.status !== 'rest' && d.status !== 'holiday' && <span className="muted small">{d.reasonLabel}</span>}
                </span>
              ),
            },
            { id: 'in', label: 'In / out', value: (d) => d.in ?? '', search: false, render: (d) => <span className="mono ap-nowrap">{d.in ?? '–'} / {d.out ?? '–'}</span> },
            { id: 'late', label: 'Late', value: (d) => d.lateMin, sort: 'number', search: false, render: (d) => (d.lateMin ? hm(d.lateMin) : '–') },
            { id: 'early', label: 'Early out', value: (d) => d.earlyMin, sort: 'number', search: false, hideBelow: 700, render: (d) => (d.earlyMin ? hm(d.earlyMin) : '–') },
            { id: 'ot', label: 'OT h', value: (d) => d.otHours, sort: 'number', search: false, hideBelow: 700, render: (d) => (d.otHours ? nf(d.otHours, 2) : '–') },
            // Kept for Export; the table shows the reason under the status.
            { id: 'reason', label: 'Reason', value: (d) => d.reasonLabel ?? '', hideBelow: 100000, phone: 'hidden' },
          ]}
        />
      </Card>
    </>
  );
}

/** Rates are shown, not judged: no owner-decided target exists, so every rate has the same calm colour. */
export function rateTone(v: number | null): 'info' | 'neutral' {
  return v === null ? 'neutral' : 'info';
}
