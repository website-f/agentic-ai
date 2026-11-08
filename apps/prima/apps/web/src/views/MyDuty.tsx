import { useEffect, useState } from 'react';
import { CalendarBlankIcon, ClockIcon, FootprintsIcon, ShieldCheckIcon, UserMinusIcon } from '@phosphor-icons/react';
import { jaOwns } from '@prima/core';
import { api, type MyDuty as Duty } from '../api';
import { Card, PageHead, Stat, Stats } from '../kit';
import { Chip, ErrorNotice, Loading, dateLabel, hhmm, useLoad, type Tone } from '../ui';
import { FLAG_LABEL } from './shared';
import { BenefitsTab, HoursTab, LeaveTab, TrainingTab, WarningsTab, WorkTab } from './People';
import { SocsoTab } from './Socso';
import { MyItemsPanel } from './MyItems';
import '../styles/selfservice.css';
import { MyGuardPayslips } from './GuardPay';
import { PoliciesPanel } from './HrDevelop';

const PERSON_ROLE: Record<string, string> = { guard: 'Guard', supervisor: 'Officer', patrol_officer: 'Patrolling officer', office: 'Office staff' };

type Tab = 'roster' | 'clock' | 'patrol' | 'me';
type MeTab = 'work' | 'training' | 'hours' | 'leave' | 'socso' | 'warnings' | 'benefits';

const CLOCK: Record<Duty['clockRecord'][number]['status'], { label: string; tone: Tone }> = {
  on_time: { label: 'On time', tone: 'ok' },
  late: { label: 'Late', tone: 'warn' },
  no_show: { label: 'Not attended', tone: 'crit' },
  on_duty: { label: 'On duty', tone: 'info' },
  awaiting: { label: 'Clock in now', tone: 'warn' },
};

const ROUND: Record<Duty['patrols'][number]['rounds'][number]['status'], { label: string; tone: Tone }> = {
  done: { label: 'Done', tone: 'ok' },
  partly: { label: 'Not finished', tone: 'warn' },
  colleague: { label: 'Done by colleague', tone: 'neutral' },
  missed: { label: 'Missed', tone: 'crit' },
  now: { label: 'In progress', tone: 'info' },
};

/** A date as a small calendar block: weekday over day of month. */
function DateBlock({ date, now }: { date: string; now?: boolean }) {
  const d = new Date(`${date}T00:00:00+08:00`);
  const wd = d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Asia/Kuala_Lumpur' });
  return (
    <span className="ss-date" data-now={now ? '' : undefined} aria-hidden="true">
      <small>{wd}</small>
      <b>{Number(date.slice(8, 10))}</b>
    </span>
  );
}

/**
 * A guard's own sign-in (Fauzan, 25 Oct 2026): view only. Their details, reminders, roster, clock-in and clock-out
 * record, and patrol rounds done or missed. Nothing about any other guard or the company.
 */
export function MyDuty() {
  const { data, error, reload } = useLoad(() => api.myDuty(), []);
  // Office and central staff have no roster or patrols here: they open straight on their details.
  const staff = data?.person.role === 'office';
  const [tab, setTab] = useState<Tab>('roster');
  const [meTab, setMeTab] = useState<MeTab>('work');
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  if (error)
    return (
      <div className="page ss">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page ss">
        <Loading what="your duty" />
      </div>
    );
  const d = data;
  const view: Tab = staff ? 'me' : tab;
  const late = d.clockRecord.filter((c) => c.status === 'late').length;
  const absent = d.clockRecord.filter((c) => c.status === 'no_show').length;
  const shift = d.onNow ? d.roster.find((r) => r.id === d.onNow?.id) : d.next ? d.roster.find((r) => r.id === d.next?.id) : undefined;
  return (
    <div className="page ss">
      <PageHead
        title={d.person.name}
        sub={
          <>
            {d.person.staffNo} · {d.person.jobTitle ?? PERSON_ROLE[d.person.role] ?? 'Guard'} · {d.person.companyName}
          </>
        }
      />

      {!staff && shift && (
        <div className="ss-hero" data-on={d.onNow ? '' : undefined}>
          <span className="ss-hero-icon" aria-hidden="true">
            <ShieldCheckIcon size={26} />
          </span>
          <div className="ss-hero-main">
            <span className="ss-hero-kicker">{d.onNow ? 'On duty now' : 'Next shift'}</span>
            <span className="ss-hero-title">
              {dateLabel(shift.date)} · {hhmm(shift.start)} to {hhmm(shift.end)}
            </span>
            <span className="ss-hero-sub">
              {shift.siteName} · {shift.postName}
              {shift.address ? ` · ${shift.address}` : ''}
            </span>
          </div>
          <div className="ss-hero-side">{d.onNow ? <Chip tone="info">Now</Chip> : <Chip tone="warn">Next</Chip>}</div>
        </div>
      )}

      {d.reminders.length > 0 && (
        <Card title="Reminders" flush>
          <ul className="ss-rows">
            {d.reminders.map((r, i) => (
              <li key={i} className="ss-row" data-tone={r.tone === 'crit' ? 'crit' : r.tone === 'warn' ? 'warn' : undefined}>
                <span className="ss-row-main">{r.text}</span>
                <Chip tone={r.tone}>{r.tone === 'crit' ? 'Now' : r.tone === 'warn' ? 'Soon' : 'Note'}</Chip>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <MyItemsPanel />
      {!staff && <PoliciesPanel mine />}
      <PoliciesPanel briefing />

      {!staff && (
        <Stats>
          <Stat label="Shifts in next 14 days" value={d.roster.length} icon={<CalendarBlankIcon size={16} />} tone="info" onClick={() => setTab('roster')} />
          <Stat label="Late in last 30 days" value={late} tone={late ? 'warn' : 'ok'} icon={<ClockIcon size={16} />} onClick={() => setTab('clock')} />
          <Stat label="Not attended, 30 days" value={absent} tone={absent ? 'crit' : 'ok'} icon={<UserMinusIcon size={16} />} onClick={() => setTab('clock')} />
          <Stat
            label="Patrol rounds missed, 7 days"
            value={d.patrolSummary.missed}
            tone={d.patrolSummary.missed ? 'warn' : 'ok'}
            note={`${d.patrolSummary.done} done`}
            icon={<FootprintsIcon size={16} />}
            onClick={() => setTab('patrol')}
          />
        </Stats>
      )}

      {!staff && (
        <div className="tabbar ss-tabs" role="tablist" aria-label="My duty sections">
          {(
            [
              ['roster', 'Roster'],
              ['clock', 'Clock in and out'],
              ['patrol', 'Patrols'],
              ['me', 'My details'],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
      )}

      {view === 'roster' && (
        <Card title="My roster" sub="Published shifts, next 14 days" flush>
          <ul className="ss-rows">
            {d.roster.length === 0 && <li className="empty">No published shift in the next 14 days.</li>}
            {d.roster.map((r) => (
              <li key={r.id} className="ss-row ss-dated">
                <DateBlock date={r.date} now={r.id === d.onNow?.id} />
                <span className="ss-row-main">
                  <span className="ss-row-title ss-times">
                    {dateLabel(r.date)} · {hhmm(r.start)} to {hhmm(r.end)}
                  </span>
                  <span className="ss-meta">
                    {r.siteName} · {r.postName}
                  </span>
                  {r.address && <span className="ss-meta">{r.address}</span>}
                </span>
                <span>{r.id === d.onNow?.id ? <Chip tone="info">Now</Chip> : r.id === d.next?.id ? <Chip tone="warn">Next</Chip> : null}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {view === 'clock' && (
        <Card title="Clock in and out" sub="Last 30 days" flush>
          <ul className="ss-rows">
            {d.clockRecord.length === 0 && <li className="empty">No shift in the last 30 days.</li>}
            {d.clockRecord.map((c) => (
              <li key={c.shiftId} className="ss-row ss-dated" data-tone={CLOCK[c.status].tone === 'crit' ? 'crit' : CLOCK[c.status].tone === 'warn' ? 'warn' : undefined}>
                <DateBlock date={c.date} />
                <span className="ss-row-main">
                  <span className="ss-row-title">
                    {dateLabel(c.date)} · {c.siteName}
                  </span>
                  <span className="ss-meta mono">
                    Shift {hhmm(c.start)}–{hhmm(c.end)} · in {c.clockIn ? hhmm(c.clockIn) : '--:--'} · out {c.clockOut ? hhmm(c.clockOut) : '--:--'}
                  </span>
                  {c.flags.filter((f) => f !== 'LATE').length > 0 && (
                    <span className="ss-meta">
                      {c.flags
                        .filter((f) => f !== 'LATE')
                        .map((f) => FLAG_LABEL[f] ?? f)
                        .join(', ')}
                    </span>
                  )}
                </span>
                <Chip tone={CLOCK[c.status].tone}>{CLOCK[c.status].label}</Chip>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {view === 'patrol' && (
        <>
          {d.patrols.length === 0 && <div className="empty">No patrol shift in the last 7 days.</div>}
          {d.patrols.map((p) => (
            <Card
              key={p.shiftId}
              title={
                <>
                  {dateLabel(p.date)} · {p.siteName}
                </>
              }
              sub={`A round every ${p.intervalMin} minutes: tap every checkpoint`}
              actions={
                <Chip tone={p.missed ? 'warn' : 'ok'}>
                  {p.done} done{p.missed ? `, ${p.missed} missed` : ''}
                </Chip>
              }
              flush
            >
              <ul className="ss-rows">
                {p.rounds.map((r) => (
                  <li key={r.from} className="ss-row" data-tone={ROUND[r.status].tone === 'crit' ? 'crit' : undefined}>
                    <span className="ss-row-main">
                      <span className="mono small">
                        {hhmm(r.from)}–{hhmm(r.to)} · {r.tapped} of {r.total} checkpoints
                      </span>
                    </span>
                    <Chip tone={ROUND[r.status].tone}>{ROUND[r.status].label}</Chip>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </>
      )}

      {view === 'me' && (
        <>
          <div className="tabbar ss-tabs" role="tablist" aria-label="My details sections">
            {(
              [
                ['work', 'Papers'],
                ['training', 'Training'],
                ['hours', jaOwns('payroll') ? 'Hours' : 'Hours and pay'],
                ['leave', 'Leave'],
                ['socso', 'SOCSO'],
                ['warnings', 'Warnings'],
                ['benefits', 'Benefits'],
              ] as [MeTab, string][]
            ).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={meTab === k} onClick={() => setMeTab(k)}>
                {label}
              </button>
            ))}
          </div>
          <Card>
            {meTab === 'work' && <WorkTab data={d.profile} />}
            {meTab === 'training' && <TrainingTab d={d.profile} />}
            {meTab === 'hours' && <HoursTab d={d.profile} self />}
            {meTab === 'leave' && <LeaveTab d={d.profile} personId={d.person.id} self />}
            {meTab === 'socso' && <SocsoTab d={d.profile} personId={d.person.id} />}
            {meTab === 'warnings' && <WarningsTab d={d.profile} self onChange={reload} />}
            {meTab === 'benefits' && <BenefitsTab d={d.profile} self />}
          </Card>
        </>
      )}

      {/* Guard pay run (Fauzan, 5 Nov 2026): a guard's or officer's own payslips, once Prima pays them. */}
      {!staff && <MyGuardPayslips />}

      <p className="ss-note">
        {staff
          ? 'Your own record. Ask for leave under Leave; your clock in and out is under Clock.'
          : 'View only. To ask for leave or give a reason for an absence, use the site device or inform your Operations Manager (OM).'}
      </p>
    </div>
  );
}
