import { useEffect, useState } from 'react';
import { jaOwns } from '@prima/core';
import { api, type MyDuty as Duty } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, hhmm, useLoad, type Tone } from '../ui';
import { FLAG_LABEL } from './shared';
import { BenefitsTab, HoursTab, LeaveTab, TrainingTab, WarningsTab, WorkTab } from './People';
import { SocsoTab } from './Socso';
import { MyItemsPanel } from './MyItems';

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

/**
 * A guard's own sign-in (Fauzan, 25 Oct 2026): view only. Their details, reminders, roster, clock-in and clock-out
 * record, and patrol rounds done or missed. Nothing about any other guard or the company.
 */
export function MyDuty() {
  const { data, error } = useLoad(() => api.myDuty(), []);
  // Office and central staff have no roster or patrols here: they open straight on their details.
  const staff = data?.person.role === 'office';
  const [tab, setTab] = useState<Tab>('roster');
  const [meTab, setMeTab] = useState<MeTab>('work');
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="your duty" />
      </div>
    );
  const d = data;
  const view: Tab = staff ? 'me' : tab;
  const late = d.clockRecord.filter((c) => c.status === 'late').length;
  const absent = d.clockRecord.filter((c) => c.status === 'no_show').length;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{d.person.name}</h1>
          <p>
            {d.person.staffNo} · {d.person.jobTitle ?? PERSON_ROLE[d.person.role] ?? 'Guard'} · {d.person.companyName}
          </p>
        </div>
      </div>

      <MyItemsPanel />

      {d.reminders.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>Reminders</h2>
          </div>
          <div className="list">
            {d.reminders.map((r, i) => (
              <div key={i} className="list-item" style={{ justifyContent: 'flex-start', gap: 10 }}>
                <Chip tone={r.tone}>{r.tone === 'crit' ? 'Now' : r.tone === 'warn' ? 'Soon' : 'Note'}</Chip>
                <span>{r.text}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {!staff && (
        <div className="kpis">
          <Kpi label="Shifts in next 14 days" value={d.roster.length} />
          <Kpi label="Late in last 30 days" value={late} tone={late ? 'warn' : 'ok'} />
          <Kpi label="Not attended, 30 days" value={absent} tone={absent ? 'crit' : 'ok'} />
          <Kpi
            label="Patrol rounds missed, 7 days"
            value={d.patrolSummary.missed}
            tone={d.patrolSummary.missed ? 'warn' : 'ok'}
            note={`${d.patrolSummary.done} done`}
          />
        </div>
      )}

      {!staff && (
        <div className="tabbar" role="tablist" aria-label="My duty sections" style={{ flexWrap: 'wrap' }}>
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
        <section className="panel">
          <div className="list">
            {d.roster.length === 0 && <div className="empty">No published shift in the next 14 days.</div>}
            {d.roster.map((r) => (
              <div key={r.id} className="list-item">
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {dateLabel(r.date)} · {hhmm(r.start)} to {hhmm(r.end)}
                  </div>
                  <div className="muted small">
                    {r.siteName} · {r.postName}
                  </div>
                  {r.address && <div className="muted small">{r.address}</div>}
                </div>
                {r.id === d.onNow?.id ? <Chip tone="info">Now</Chip> : r.id === d.next?.id ? <Chip tone="warn">Next</Chip> : null}
              </div>
            ))}
          </div>
        </section>
      )}

      {view === 'clock' && (
        <section className="panel">
          <div className="list">
            {d.clockRecord.length === 0 && <div className="empty">No shift in the last 30 days.</div>}
            {d.clockRecord.map((c) => (
              <div key={c.shiftId} className="list-item">
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {dateLabel(c.date)} · {c.siteName}
                  </div>
                  <div className="muted small mono">
                    Shift {hhmm(c.start)}–{hhmm(c.end)} · in {c.clockIn ? hhmm(c.clockIn) : '--:--'} · out {c.clockOut ? hhmm(c.clockOut) : '--:--'}
                  </div>
                  {c.flags.filter((f) => f !== 'LATE').length > 0 && (
                    <div className="muted small">
                      {c.flags
                        .filter((f) => f !== 'LATE')
                        .map((f) => FLAG_LABEL[f] ?? f)
                        .join(', ')}
                    </div>
                  )}
                </div>
                <Chip tone={CLOCK[c.status].tone}>{CLOCK[c.status].label}</Chip>
              </div>
            ))}
          </div>
        </section>
      )}

      {view === 'patrol' && (
        <>
          {d.patrols.length === 0 && <div className="empty">No patrol shift in the last 7 days.</div>}
          {d.patrols.map((p) => (
            <section key={p.shiftId} className="panel">
              <div className="panel-head">
                <div>
                  <h3>
                    {dateLabel(p.date)} · {p.siteName}
                  </h3>
                  <div className="muted small">A round every {p.intervalMin} minutes: tap every checkpoint</div>
                </div>
                <Chip tone={p.missed ? 'warn' : 'ok'}>
                  {p.done} done{p.missed ? `, ${p.missed} missed` : ''}
                </Chip>
              </div>
              <div className="list">
                {p.rounds.map((r) => (
                  <div key={r.from} className="list-item">
                    <span className="mono small">
                      {hhmm(r.from)}–{hhmm(r.to)} · {r.tapped} of {r.total} checkpoints
                    </span>
                    <Chip tone={ROUND[r.status].tone}>{ROUND[r.status].label}</Chip>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </>
      )}

      {view === 'me' && (
        <>
          <div className="tabbar" role="tablist" aria-label="My details sections" style={{ flexWrap: 'wrap' }}>
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
          <section className="panel" style={{ padding: 12 }}>
            {meTab === 'work' && <WorkTab data={d.profile} />}
            {meTab === 'training' && <TrainingTab d={d.profile} />}
            {meTab === 'hours' && <HoursTab d={d.profile} self />}
            {meTab === 'leave' && <LeaveTab d={d.profile} personId={d.person.id} self />}
            {meTab === 'socso' && <SocsoTab d={d.profile} personId={d.person.id} />}
            {meTab === 'warnings' && <WarningsTab d={d.profile} self />}
            {meTab === 'benefits' && <BenefitsTab d={d.profile} self />}
          </section>
        </>
      )}

      <p className="muted small">
        {staff
          ? 'Your own record. Ask for leave under Leave; your clock in and out is under Clock.'
          : 'View only. To ask for leave or give a reason for an absence, use the site device or inform your Operations Manager (OM).'}
      </p>
    </div>
  );
}
