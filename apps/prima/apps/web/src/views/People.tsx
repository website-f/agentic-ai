import { Select } from '../SearchSelect';
import { useEffect, useState } from 'react';
import { CheckCircleIcon, PhoneIcon, ProhibitIcon, UsersThreeIcon, WarningIcon } from '@phosphor-icons/react';
import { ATTENDANCE_ISSUE_LABEL, GROUP_EMPLOYER_ID, LEAVE_LABEL, isGroupLeader, jaOwns, missingStaffFacts, staffHistoryRole } from '@prima/core';
import { api, type GuardProfile, type PersonDetail } from '../api';
import { useApp } from '../App';
import { Chip, Drawer, ErrorNotice, ExpiryChip, Findings, Kpi, Loading, dateLabel, dayLabel, hhmm, useAction, useLoad } from '../ui';
import { Avatar, Card, Facts, PageHead, Person, Search, Stat, Stats, Toolbar } from '../kit';
import { LeaveForm } from './Leave';
import { SocsoTab } from './Socso';
import { ClaimsPolicy, DisciplinePolicy, HiringChecklist, HospitalClaims, MedicalHistory, Sec } from './HrFile';
import { SHIFT_STATE } from './shared';
import { RecordButton } from './RecordForm';
import { ImportButton } from './ImportDrawer';
import { GuardTrainingPanel } from './HrDevelop';
import { FaceCapture } from './FaceCheck';
import { GroupHistoryTab, HistoryLookupPanel } from './StaffHistory';
import { GuardPhoneCard } from './GuardPhoneOffice';
import '../styles/people.css';

export function People({ openPersonId }: { openPersonId?: string }) {
  const { companyId: chosen, me } = useApp();
  // HR and group leadership also open PWVSB's own central staff (Fauzan, 27 Oct 2026).
  const hr = me.user.department === 'hr' || isGroupLeader(me.user);
  const [central, setCentral] = useState(false);
  const companyId = hr && central ? GROUP_EMPLOYER_ID : chosen;
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'blocked' | 'np'>('all');
  const [open, setOpen] = useState<string | undefined>(openPersonId);
  const [hireCheck, setHireCheck] = useState(false);
  const historyRole = staffHistoryRole(me.user);
  // P90: the list is asked for once typing pauses, not on every key (each ask reads the company's guards).
  const [query, setQuery] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data, error } = useLoad(() => api.people(companyId, query), [companyId, query]);

  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  const rows = (data ?? []).filter((r) => (filter === 'blocked' ? !r.deployable : filter === 'np' ? r.person.nationality === 'NP' : true));
  const blockedCount = (data ?? []).filter((r) => !r.deployable).length;
  const dueCount = (data ?? []).filter((r) => r.deployable && r.warnings).length;
  const okCount = (data ?? []).filter((r) => r.deployable && !r.warnings).length;

  return (
    <div className="page pp-page">
      <PageHead
        title={hr ? 'People' : 'Guards'}
        sub={
          <>
            Allowed to work means a valid KDN guard card (or vetting already submitted in eSIMS while KDN decides), CSG training done within the first year of
            work, age 60 or under, and for Nepali guards a valid permit, passport, FOMEMA and insurance. Guards and officers come from the JA Group
            app; office staff are added here.
          </>
        }
        actions={
          <>
            <ImportButton kind="officeStaff" companyId={companyId} />
            <RecordButton kind="officeStaff" companyId={companyId} label="Add office staff" primary />
            {historyRole && (
              <button className="btn" aria-pressed={hireCheck} onClick={() => setHireCheck(!hireCheck)}>
                Look up staff history
              </button>
            )}
          </>
        }
      />

      {data && (
        <Stats>
          <Stat label={q ? 'Found' : 'On the list'} value={data.length} icon={<UsersThreeIcon />} tone="info" onClick={() => setFilter('all')} />
          <Stat label="Allowed to work" value={okCount} icon={<CheckCircleIcon />} tone={okCount ? 'ok' : 'neutral'} />
          <Stat label="Allowed, papers due" value={dueCount} icon={<WarningIcon />} tone={dueCount ? 'warn' : 'neutral'} />
          <Stat label="Not allowed" value={blockedCount} icon={<ProhibitIcon />} tone={blockedCount ? 'crit' : 'ok'} onClick={() => setFilter('blocked')} />
        </Stats>
      )}

      {hireCheck && <HistoryLookupPanel />}

      <Card flush>
        <div className="pp-toolbar">
          <Toolbar
            end={
              hr && (
                <div className="seg" role="group" aria-label="Employer">
                  <button aria-pressed={!central} onClick={() => setCentral(false)}>
                    Chosen company
                  </button>
                  <button aria-pressed={central} onClick={() => setCentral(true)}>
                    PWVSB central staff
                  </button>
                </div>
              )
            }
          >
            <Search value={q} onChange={setQ} placeholder="Search name or staff number" />
            <div className="seg" role="group" aria-label="Filter">
              <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                All
              </button>
              <button aria-pressed={filter === 'blocked'} onClick={() => setFilter('blocked')}>
                Not allowed ({blockedCount})
              </button>
              {me.user.department !== 'hr' && (
                <button aria-pressed={filter === 'np'} onClick={() => setFilter('np')}>
                  Nepali
                </button>
              )}
            </div>
          </Toolbar>
        </div>
        {!data && <Loading what="guards" />}
        {data && (
          <div className="table-wrap pp-table">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="hide-sm">Role</th>
                  <th className="hide-sm">From</th>
                  <th>Can work</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 300).map((r) => (
                  <tr key={r.person.id} className="clickable" onClick={() => setOpen(r.person.id)}>
                    <td>
                      <button type="button" className="pp-row-open" onClick={(e) => (e.stopPropagation(), setOpen(r.person.id))}>
                        <Person name={r.person.name} sub={<span className="mono">{r.person.staffNo}</span>} size={34} />
                      </button>
                    </td>
                    <td className="hide-sm pp-cap">{r.person.role.replace('_', ' ')}</td>
                    <td className="hide-sm">{nationalityLabel(r.person.nationality)}</td>
                    <td>{r.deployable ? r.warnings ? <Chip tone="warn">Yes, papers due</Chip> : <Chip tone="ok">Yes</Chip> : <Chip tone="crit">No</Chip>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 300 && <div className="empty">Showing 300 of {rows.length}. Search to narrow down.</div>}
            {rows.length === 0 && <div className="empty">Nobody matches.</div>}
          </div>
        )}
      </Card>

      <GuardTrainingPanel />
      {open && <PersonDrawer personId={open} onClose={() => setOpen(undefined)} />}
    </div>
  );
}

type Tab = 'work' | 'training' | 'hours' | 'leave' | 'socso' | 'warnings' | 'benefits' | 'history';

const STATUS_LABEL: Record<string, [string, 'ok' | 'warn' | 'neutral']> = {
  active: ['Active', 'ok'],
  suspended: ['Suspended', 'warn'],
  left: ['Left', 'neutral'],
};

/**
 * The guard profile (Fauzan, 25 Oct 2026): HR details, papers and training with what comes next, hours worked,
 * warnings, chances to upgrade, leave and sick-day balances, and pay and benefits for the company and HR only.
 * Users who may not open the profile see the basic record.
 */
function PersonDrawer({ personId, onClose }: { personId: string; onClose: () => void }) {
  const prof = useLoad(() => api.guardProfile(personId), [personId]);
  const basic = useLoad(() => (prof.error ? api.person(personId) : Promise.resolve(null)), [personId, !!prof.error]);
  const data = prof.data ?? basic.data;
  const [tab, setTab] = useState<Tab>('work');
  const { me } = useApp();
  const p = data?.person;
  // Group employment history (Fauzan, 4 Nov 2026): on the profile for HR only; everyone else looks up by number.
  const history: [Tab, string][] = staffHistoryRole(me.user) === 'hr' ? [['history', 'Group history']] : [];
  const tabs: [Tab, string][] = prof.data
    ? [
        ['work', 'Work'],
        ['training', 'Training'],
        ['hours', prof.data.access.pay && !jaOwns('payroll') ? 'Hours and pay' : 'Hours'],
        ['leave', 'Leave'],
        ['socso', 'SOCSO'],
        ['warnings', 'Warnings'],
        ...(prof.data.access.pay ? ([['benefits', 'Benefits']] as [Tab, string][]) : []),
        ...history,
      ]
    : history.length
      ? [['work', 'Work'], ...history]
      : [];
  const blocked = data ? data.findings.some((f) => f.level === 'block') : false;
  const status = p ? STATUS_LABEL[p.status] : undefined;
  return (
    <Drawer
      title={
        p ? (
          <span className="pp-title">
            <Avatar name={p.name} size={40} />
            <span>{p.name}</span>
          </span>
        ) : (
          'Guard'
        )
      }
      sub={p ? `${p.staffNo} · ${p.jobTitle ?? ROLE_LABEL[p.role]} · ${data?.branch?.name ?? ''}` : undefined}
      onClose={onClose}
    >
      <ErrorNotice error={basic.error} />
      {!data && !basic.error && <Loading what="profile" />}
      {data && p && (
        <>
          <div className="pp-hero">
            <div className="pp-hero-chips">
              {status && <Chip tone={status[1]}>{status[0]}</Chip>}
              <Chip tone="neutral">{nationalityLabel(p.nationality)}</Chip>
              {p.role !== 'office' &&
                (blocked ? (
                  <Chip tone="crit">Cannot work today</Chip>
                ) : data.findings.length ? (
                  <Chip tone="warn">Can work, papers due</Chip>
                ) : (
                  <Chip tone="ok">Can work</Chip>
                ))}
            </div>
            <div className="pp-hero-actions">
              {/\d/.test(p.phone) && (
                <a className="btn btn-sm" href={`tel:${p.phone.replace(/[^\d+]/g, '')}`}>
                  <PhoneIcon /> Call
                </a>
              )}
              {p.role === 'office' && <RecordButton kind="officeStaff" id={p.id} label="Edit staff details" />}
            </div>
          </div>
          {tabs.length > 0 && (
            <div className="tabbar pp-tabs" role="tablist" aria-label="Profile sections">
              {tabs.map(([k, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
                  {label}
                  {k === 'warnings' && prof.data!.warnings.activeWarnings > 0 && <span className="tab-count">{prof.data!.warnings.activeWarnings}</span>}
                  {k === 'training' && prof.data!.next.length > 0 && <span className="tab-count">{prof.data!.next.length}</span>}
                </button>
              ))}
            </div>
          )}
          {tab === 'work' && <WorkTab data={data} />}
          {prof.data && tab === 'training' && <TrainingTab d={prof.data} />}
          {prof.data && tab === 'hours' && <HoursTab d={prof.data} />}
          {prof.data && tab === 'leave' && <LeaveTab d={prof.data} personId={personId} />}
          {prof.data && tab === 'socso' && <SocsoTab d={prof.data} personId={personId} />}
          {prof.data && tab === 'warnings' && <WarningsTab d={prof.data} onChange={prof.reload} />}
          {prof.data && tab === 'benefits' && <BenefitsTab d={prof.data} />}
          {tab === 'history' && <GroupHistoryTab personId={personId} />}
        </>
      )}
    </Drawer>
  );
}

/**
 * Face for clock-in, not enrolled yet (P78). An office staff member opening their own record registers it here with
 * the full-screen camera; HR then approves the photo. Everyone else registers on their own phone.
 */
function FaceNotEnrolled({ personId, office }: { personId: string; office: boolean }) {
  const { me } = useApp();
  const act = useAction();
  const [sent, setSent] = useState(false);
  const own = office && me.user.personId === personId;
  return (
    <div className="pp-face">
      <Chip tone={sent ? 'info' : 'warn'}>{sent ? 'Waiting for HR to approve' : 'Not enrolled'}</Chip>
      {own && !sent && (
        <FaceCapture
          label="Register my face"
          title="Register your face"
          busy={act.busy}
          onCapture={(r) =>
            void act.run(() => api.registerFace({ photo: r.photo, descriptor: r.descriptor }), 'Sent to HR to approve.').then((ok) => ok && setSent(true))
          }
        />
      )}
      {!own && office && <span className="muted small">They register it on their own phone, on the Clock screen.</span>}
      <ErrorNotice error={act.error} />
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = { guard: 'Guard', supervisor: 'Officer', patrol_officer: 'Patrolling officer', office: 'Office staff' };

// P81: a record loaded from the staff list has no nationality, IC, birth date, phone or joining date yet. It says so,
// never a default that looks like a fact.
const NOT_RECORDED = 'Not recorded yet';
function nationalityLabel(n: string | undefined): string {
  return n === 'NP' ? 'Nepal' : n === 'MY' ? 'Malaysia' : 'Nationality not recorded yet';
}

export function WorkTab({ data }: { data: PersonDetail }) {
  const p = data.person;
  const missing = missingStaffFacts(p);
  return (
    <div className="pp-tab">
      {missing.length > 0 && (
        <div className="notice" data-tone="warn">
          Not recorded yet: {missing.join(', ')}. HR adds them with Edit on this record; payroll waits for the birth date, joining date and nationality.
        </div>
      )}
      <Sec title="Personal and employment">
        <div className="pp-box pp-pad">
          <Facts
            items={[
              ['Identity (masked)', p.idMasked ? <span className="mono">{p.idMasked}</span> : NOT_RECORDED],
              ['Born', p.dob ? dateLabel(p.dob) : NOT_RECORDED],
              ['Phone', p.phone ? <span className="mono">{p.phone}</span> : NOT_RECORDED],
              ['Joined', p.hiredOn ? dateLabel(p.hiredOn) : NOT_RECORDED],
              ['Face for clock-in', p.faceEnrolledOn ? `Enrolled ${dateLabel(p.faceEnrolledOn)}` : <FaceNotEnrolled personId={p.id} office={p.role === 'office'} />],
            ]}
          />
        </div>
      </Sec>
      {p.role !== 'office' && (
        <Sec title="Can this guard work today?">
          {data.findings.length === 0 ? (
            <div className="notice" data-tone="ok">
              Yes. All required papers are valid.
            </div>
          ) : (
            <div className="pp-box pp-pad">
              <Findings items={data.findings} />
            </div>
          )}
          {data.armedFindings.some((f) => f.code === 'MISSING_FIREARM_PERMIT' || f.code === 'EXPIRED_FIREARM_PERMIT') && (
            <p className="pp-note">Not cleared for armed posts.</p>
          )}
        </Sec>
      )}
      {'hiring' in data && <HiringChecklist d={data as GuardProfile} />}
      {(data.canSetPin || data.accounts.length > 0) && <AccessSection data={data} />}
      {p.role !== 'office' && (
        <Sec title="Shifts, last and next 7 days">
          <div className="list pp-box">
            {data.shifts.length === 0 && <div className="empty">No shifts.</div>}
            {data.shifts.map((s) => (
              <div key={s.id} className="list-item">
                <div>
                  <div>
                    {dayLabel(s.date)} · {hhmm(s.start)}–{hhmm(s.end)}
                  </div>
                  <div className="muted small">{s.siteName}</div>
                </div>
                <Chip tone={SHIFT_STATE[s.state].tone}>{SHIFT_STATE[s.state].label}</Chip>
              </div>
            ))}
          </div>
        </Sec>
      )}
    </div>
  );
}

/**
 * PIN and Prima access (pre-publication review R1 and R3, 31 Oct 2026). HR or the company office sets the PIN used on
 * site devices and as a witness; it is never shown again. HR, the HR Director or the CEO closes a leaver's access.
 */
function AccessSection({ data }: { data: PersonDetail }) {
  const act = useAction();
  const [pin, setPin] = useState('');
  const [closing, setClosing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [from, setFrom] = useState('');
  const p = data.person;
  return (
    <Sec title="PIN and Prima access">
      <ErrorNotice error={act.error} />
      <div className="list pp-box">
        <div className="list-item">
          <div>
            <div>PIN for site devices and witness sign-offs</div>
            <div className="muted small">Kept only in a form nobody can read back. A forgotten PIN is set again.</div>
          </div>
          {data.pinSet ? <Chip tone="ok">Set</Chip> : <Chip tone="warn">Not set</Chip>}
        </div>
        {data.canSetPin && p.status === 'active' && (
          <div className="list-item pp-pin">
            <input
              className="input"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              aria-label="New PIN"
              placeholder="New PIN, 4 to 6 digits"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            />
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || pin.length < 4}
              onClick={() => act.run(() => api.setStaffPin(p.id, pin), 'PIN set. Tell the person in private; it is not shown again.').then(() => setPin(''))}
            >
              Set PIN
            </button>
          </div>
        )}
        {data.canSetPin && p.status === 'active' && p.role !== 'office' && <GuardPhoneCard personId={p.id} companyId={p.companyId} />}
        {data.accounts.map((a) => (
          <div key={a.userId} className="list-item pp-stack">
            <div className="pp-line">
              <div>
                <div>Prima account: {a.title}</div>
                {a.closed && <div className="muted small">Closed by {a.closed.by}: {a.closed.reason}</div>}
              </div>
              {a.closedFrom ? <Chip tone="crit">Closed from {dateLabel(a.closedFrom)}</Chip> : <Chip tone="ok">Open</Chip>}
            </div>
            {a.canClose && !a.closedFrom && closing !== a.userId && (
              <div className="pp-actions">
                <button className="btn btn-sm" onClick={() => setClosing(a.userId)}>
                  Close access
                </button>
              </div>
            )}
            {closing === a.userId && (
              <div className="pp-form">
                <input className="input" aria-label="Reason" placeholder="Reason, e.g. resigned, contract ended, dismissed" value={reason} onChange={(e) => setReason(e.target.value)} />
                <label className="field">
                  <span className="label">From (empty means now)</span>
                  <input className="input" type="date" aria-label="Close from" value={from} onChange={(e) => setFrom(e.target.value)} />
                </label>
                <p className="muted small">From that day Prima refuses this account and its company grants end. IT still disables the Microsoft account.</p>
                <div className="pp-actions">
                  <button className="btn btn-sm" onClick={() => setClosing(null)}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={act.busy || reason.trim().length < 3}
                    onClick={() =>
                      act
                        .run(() => api.closeAccess(a.userId, { from: from || null, reason }), (r) => `Access closed from ${dateLabel(r.from)}.`)
                        .then((r) => r && setClosing(null))
                    }
                  >
                    Close access
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Sec>
  );
}

export function TrainingTab({ d }: { d: GuardProfile }) {
  return (
    <div className="pp-tab">
      <Sec title="Coming next">
        {d.next.length === 0 ? (
          <div className="notice" data-tone="ok">
            Nothing due in the next 90 days.
          </div>
        ) : (
          <div className="list pp-box">
            {d.next.map((n) => (
              <div key={n.type} className="list-item">
                <div>
                  <div>{n.label}</div>
                  {n.note && <div className="muted small">{n.note}</div>}
                </div>
                <ExpiryChip status={n.status} daysLeft={n.daysLeft} />
              </div>
            ))}
          </div>
        )}
      </Sec>
      <Sec title="Licences, training and certificates">
        <div className="list pp-box">
          {d.credentials.length === 0 && <div className="empty">None needed for this job.</div>}
          {d.credentials.map((c) => (
            <div key={c.type} className="list-item">
              <div>
                <div>
                  {c.label} {!c.required && <span className="muted small">(extra)</span>}
                </div>
                <div className="muted small mono">
                  {c.credential
                    ? `${c.credential.number} · ${c.type === 'KDN_VETTING' ? `submitted ${dateLabel(c.credential.issuedOn)}` : c.credential.expiresOn ? `expires ${dateLabel(c.credential.expiresOn)}` : 'no expiry'}`
                    : 'No record'}
                </div>
              </div>
              <ExpiryChip status={c.status} daysLeft={c.daysLeft} text={c.chip ?? (c.type === 'KDN_VETTING' ? 'Submitted' : undefined)} />
            </div>
          ))}
        </div>
      </Sec>
      <Sec title="Chances to upgrade">
        <div className="list pp-box">
          {d.upgrades.map((u) => (
            <div key={u.id} className="list-item">
              <div>
                <div>{u.name}</div>
                <div className="muted small">
                  {u.by} · {u.why}
                </div>
              </div>
              <Chip tone={u.eligible ? 'ok' : 'neutral'}>{u.eligible ? 'Can apply' : 'Not yet'}</Chip>
            </div>
          ))}
        </div>
        <p className="pp-note">Placeholder list until Group HR gives the real course catalogue and HRD Corp rules ({d.upgradeRule.id}).</p>
      </Sec>
    </div>
  );
}

/**
 * self: the person looking at their own record. Fauzan, 28 Oct 2026: staff see their own amounts only, not how they are
 * worked out or the law behind them; HR, managers and ACT keep the workings on their own screens.
 */
export function HoursTab({ d, self }: { d: GuardProfile; self?: boolean }) {
  const m = d.hours;
  return (
    <div className="pp-tab">
      <div className="kpis">
        <Kpi label="Hours this month" value={m.thisMonth.hours} note={`${m.thisMonth.days} days, ${m.thisMonth.overtimeHours} h overtime`} />
        <Kpi label="Hours last month" value={m.lastMonth.hours} note={`${m.lastMonth.days} days, ${m.lastMonth.overtimeHours} h overtime`} />
        <Kpi label="Missed shifts this month" value={m.thisMonth.missed} tone={m.thisMonth.missed ? 'warn' : 'ok'} note={`${m.thisMonth.late} late`} />
      </div>
      {!d.pay && d.access.pay && jaOwns('payroll') && <p className="pp-note">Pay and payslips are in the JA Group app.</p>}
      {d.pay && (
        <Sec title="Pay this month (estimate)">
          {d.pay.basic == null ? (
            <div className="notice" data-tone="warn">
              No pay on record.
            </div>
          ) : (
            <div className="list pp-box">
              <div className="list-item">
                <span>Basic pay</span>
                <span className="mono">RM{d.pay.basic.toFixed(2)}</span>
              </div>
              {d.pay.workings.map((w, i) => (
                <div key={w.label} className={i === d.pay!.workings.length - 1 ? 'list-item pp-total' : 'list-item'}>
                  <div>
                    <div>{w.label}</div>
                    {!self && (
                      <div className="muted small">
                        {w.formula}
                        {w.law ? ` · ${w.law}` : ''}
                      </div>
                    )}
                  </div>
                  <span className="mono">RM{w.amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="pp-note">An estimate from clock-in times, before payroll. EPF, SOCSO, EIS and tax deductions come with the payroll rules and payslips.</p>
        </Sec>
      )}
      <Sec title="Hours day by day, this month">
        <div className="list pp-box">
          {m.days.length === 0 && <div className="empty">No clocked shift this month yet.</div>}
          {m.days.map((x) => (
            <div key={x.clockIn} className="list-item">
              <div>
                <div>
                  {dayLabel(x.date)} · {x.siteName}
                </div>
                <div className="muted small mono">
                  in {hhmm(x.clockIn)} · out {hhmm(x.clockOut)} · {x.normal} h normal{x.overtime ? ` + ${x.overtime} h overtime` : ''}
                </div>
              </div>
              <div className="pp-chips">
                {x.late && <Chip tone="warn">Late</Chip>}
                <span className="mono">{x.hours} h</span>
              </div>
            </div>
          ))}
        </div>
        <p className="pp-note">{self ? `Total this month: ${m.thisMonth.hours} h.` : `Hours over 8 in a day count as overtime. Total this month: ${m.thisMonth.hours} h.`}</p>
      </Sec>
    </div>
  );
}

export function LeaveTab({ d, personId, self }: { d: GuardProfile; personId: string; self?: boolean }) {
  const [asking, setAsking] = useState(false);
  const [redo, setRedo] = useState<{ kind: (typeof d.leave.requests)[number]['kind']; from: string; to: string; reason: string; illness?: string; clinic?: string; mcNo?: string; correctsId?: string; reusedDocs?: number } | null>(null);
  const b = d.leave.balances;
  return (
    <div className="pp-tab">
      <div className="kpis">
        <Kpi
          label="Annual leave left"
          value={b.annual.left}
          note={`${b.annual.taken} of ${b.annual.entitled} taken${b.annual.pending ? `, ${b.annual.pending} asked` : ''}`}
        />
        <Kpi label="Sick days left" value={b.sick.left} note={`${b.sick.taken} of ${b.sick.entitled} taken`} tone={b.sick.left ? 'ok' : 'warn'} />
        <Kpi label="With hospitalisation" value={b.hospital.left} note={`of ${b.hospital.entitled} days a year`} />
        {b.maternity.entitled > 0 && <Kpi label="Maternity leave" value={b.maternity.entitled} note={b.maternity.taken ? `${b.maternity.taken} taken this year` : 'consecutive days a birth'} />}
        {b.paternity.entitled > 0 && <Kpi label="Paternity leave" value={b.paternity.entitled - b.paternity.taken} note={`of ${b.paternity.entitled} days a birth`} />}
      </div>
      <div className="pp-bar">
        <p className="pp-note">
          {b.years} year{b.years === 1 ? '' : 's'} of service. {b.note ? `${b.note} ` : ''}
          {!self && b.rule.source}
        </p>
        {d.access.requestLeave && !asking && (
          <button className="btn btn-sm btn-primary" onClick={() => setAsking(true)}>
            {self ? 'Ask for leave' : 'Ask for leave for this person'}
          </button>
        )}
      </div>
      {asking && <LeaveForm key={redo ? `${redo.from}-${redo.to}` : 'new'} personId={personId} prefill={redo} onDone={() => (setAsking(false), setRedo(null))} />}
      <Sec title="Requests">
        <div className="list pp-box">
          {d.leave.requests.length === 0 && <div className="empty">No requests yet.</div>}
          {d.leave.requests.map((q) => (
            <div key={q.id} className="list-item">
              <div>
                <div>
                  {LEAVE_LABEL[q.kind]} · {dateLabel(q.from)}
                  {q.to !== q.from ? ` to ${dateLabel(q.to)}` : ''} ({q.days} d)
                </div>
                <div className="muted small">
                  {q.illness ? `${q.illness}${q.clinic ? `, ${q.clinic}` : ''} · ` : ''}
                  {q.reason}
                  {q.decidedBy ? ` · ${q.status} by ${q.decidedBy}` : ''}
                  {q.decisionNote ? `: ${q.decisionNote}` : ''}
                  {q.proofIds.length ? ` · ${q.kind === 'SICK' || q.kind === 'HOSPITAL' ? 'MC' : 'document'} uploaded` : ''}
                </div>
              </div>
              <div className="pp-chips">
                <Chip tone={q.status === 'approved' ? 'ok' : q.status === 'rejected' ? 'crit' : 'warn'}>{q.status}</Chip>
                {q.status === 'rejected' && d.access.requestLeave && !asking && !d.leave.requests.some((x) => x.correctsId === q.id) && (
                  <button
                    className="btn btn-sm"
                    title="Opens a new request with these details for you to correct; the refused one stays on record"
                    onClick={() =>
                      (setRedo({
                        kind: q.kind,
                        from: q.from,
                        to: q.to,
                        reason: q.reason,
                        illness: q.illness,
                        clinic: q.clinic,
                        mcNo: q.mcNo,
                        // Your own refused request: its MC documents are reused, not uploaded again (the server checks).
                        ...(self ? { correctsId: q.id, reusedDocs: q.proofIds.length } : {}),
                      }),
                      setAsking(true))
                    }
                  >
                    Correct and send again
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Sec>
      <HospitalClaims d={d} />
    </div>
  );
}

export function WarningsTab({ d, self, onChange }: { d: GuardProfile; self?: boolean; onChange?: () => void }) {
  const w = d.warnings;
  return (
    <div className="pp-tab">
      {!self && <DisciplinePolicy d={d} />}
      <Sec title="Disciplinary record">
        <div className="list pp-box">
          {w.discipline.length === 0 && <div className="empty">No warnings on record.</div>}
          {w.discipline.map((x) => (
            <div key={x.id} className="list-item pp-stack">
              <div className="pp-strong">
                {x.label} · {dateLabel(x.date)}
              </div>
              <div className="muted small">
                {x.by}: {x.note}
                {x.proof ? ` · ${x.proof} document(s)` : ''}
              </div>
              <DisciplineAppealBox x={x} self={!!self} onChange={onChange} />
            </div>
          ))}
        </div>
      </Sec>
      <Sec title="Attendance problems, last 30 days">
        <div className="list pp-box">
          {w.recent.length === 0 && <div className="empty">None.</div>}
          {w.recent.map((x, i) => (
            <div key={i} className="list-item">
              <div>
                <div>{ATTENDANCE_ISSUE_LABEL[x.issue]}</div>
                <div className="muted small">
                  {dateLabel(x.date)} · {x.siteName}
                </div>
              </div>
              <Chip tone={x.open ? 'warn' : 'neutral'}>{x.open ? 'Open' : 'Closed'}</Chip>
            </div>
          ))}
        </div>
      </Sec>
    </div>
  );
}

export function BenefitsTab({ d, self }: { d: GuardProfile; self?: boolean }) {
  return (
    <div className="pp-tab">
      <Sec title="Medical and other benefits">
        <div className="list pp-box">
          {(d.benefits ?? []).map((b) => (
            <div key={b.name} className="list-item">
              <div>
                <div>{b.name}</div>
                <div className="muted small">{b.detail}</div>
              </div>
              <Chip tone={b.status === 'unknown' ? 'warn' : 'ok'}>
                {b.status === 'statutory' ? 'Statutory' : b.status === 'on_record' ? 'On record' : 'Unknown'}
              </Chip>
            </div>
          ))}
        </div>
        <p className="pp-note">Company cover and claims are not linked yet, so they show as Unknown, never as fine.</p>
      </Sec>
      <MedicalHistory d={d} />
      <ClaimsPolicy d={d} self={self} />
    </div>
  );
}

type DisciplineEntry = Pick<GuardProfile['warnings']['discipline'][number], 'id' | 'appealable' | 'appealDueBy' | 'appeal' | 'canAppealOwn' | 'canDecideAppeal'>;
const APPEAL_RESULT_LABEL = { upheld: 'Upheld', varied: 'Varied to a lighter step', overturned: 'Overturned' } as const;
const APPEAL_LANG_LABEL = { ms: 'Bahasa Melayu', en: 'English', ne: 'नेपाली (Nepali)', bn: 'বাংলা (Bengali)', my: 'မြန်မာ (Burmese)', hi: 'हिन्दी (Hindi)', ur: 'اردو (Urdu)', id: 'Bahasa Indonesia', ta: 'தமிழ் (Tamil)', zh: '中文 (Chinese)' } as const;
const LIGHTER_STEPS = ['VERBAL_WARNING', 'WRITTEN_WARNING', 'FINAL_WARNING', 'SUSPENSION', 'DOWNGRADE'] as const;
const STEP_LABEL_SHORT: Record<string, string> = { VERBAL_WARNING: 'Verbal warning', WRITTEN_WARNING: 'Written warning', FINAL_WARNING: 'Final warning', SUSPENSION: 'Suspension', DOWNGRADE: 'Downgrade', DISMISSAL: 'Dismissal' };

/**
 * A guard's appeal against a disciplinary step (IWAY finding, Fauzan 6 Nov 2026): the guard appeals on their own
 * sign-in, or the company or HR records it from the guard's letter, within the window; the HR Director or the CEO who
 * did not record the step decides with reasons.
 */
export function DisciplineAppealBox({ x, self, onChange }: { x: DisciplineEntry; self: boolean; onChange?: () => void }) {
  const act = useAction();
  const [f, setF] = useState({ text: '', lang: '', result: '', variedTo: '' });
  const [open, setOpen] = useState(false);
  if (!x.appealable) return null;
  const a = x.appeal;
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  const canRecord = !self && !a && !!x.appealDueBy && today <= x.appealDueBy;
  const done = () => {
    setOpen(false);
    setF({ text: '', lang: '', result: '', variedTo: '' });
    onChange?.();
  };
  return (
    <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
      {a ? (
        <div>
          Appeal {dateLabel(a.lodgedOn)} ({a.via === 'own' ? 'by the guard' : a.via === 'company' ? 'recorded by the company' : 'recorded by HR'}, {APPEAL_LANG_LABEL[a.lang]}): {a.grounds}{' '}
          {a.decision ? (
            <Chip tone={a.decision.result === 'upheld' ? 'neutral' : 'ok'}>
              {APPEAL_RESULT_LABEL[a.decision.result]}
              {a.decision.variedTo ? `: ${STEP_LABEL_SHORT[a.decision.variedTo]}` : ''}
            </Chip>
          ) : (
            <Chip tone="warn">waiting for HR Director</Chip>
          )}
          {a.decision && <div className="muted">{a.decision.by}: {a.decision.reason}</div>}
        </div>
      ) : x.appealDueBy && today <= x.appealDueBy ? (
        <div className="muted">{self ? `You may appeal by ${dateLabel(x.appealDueBy)}.` : `The guard may appeal by ${dateLabel(x.appealDueBy)}.`}</div>
      ) : null}
      {(x.canAppealOwn || canRecord) && !open && (
        <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>
          {x.canAppealOwn ? 'Appeal' : "Record the guard's appeal"}
        </button>
      )}
      {open && (x.canAppealOwn || canRecord) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <textarea className="input" rows={3} placeholder={x.canAppealOwn ? 'Why you appeal, in your own words and language' : "The guard's grounds, from their letter"} aria-label="Grounds of appeal" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
          <Select className="select" aria-label="Language of the appeal" value={f.lang} onChange={(e) => setF({ ...f, lang: e.target.value })}>
            <option value="">Language: the guard's mother tongue</option>
            {Object.entries(APPEAL_LANG_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
          <button
            className="btn btn-sm btn-primary"
            style={{ alignSelf: 'flex-start' }}
            disabled={act.busy || f.text.trim().length < 10}
            onClick={async () => {
              const r = await act.run(() => api.lodgeDisciplineAppeal(x.id, { grounds: f.text, lang: (f.lang || null) as keyof typeof APPEAL_LANG_LABEL | null }), 'Appeal sent to HR.');
              if (r) done();
            }}
          >
            Send appeal
          </button>
        </div>
      )}
      {x.canDecideAppeal && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Select className="select" aria-label="Appeal decision" value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })}>
              <option value="">Decision</option>
              {Object.entries(APPEAL_RESULT_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
            {f.result === 'varied' && (
              <Select className="select" aria-label="Varied to" value={f.variedTo} onChange={(e) => setF({ ...f, variedTo: e.target.value })}>
                <option value="">Lighter step</option>
                {LIGHTER_STEPS.map((k) => (
                  <option key={k} value={k}>
                    {STEP_LABEL_SHORT[k]}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <input className="input" placeholder="Reasons in writing (needed)" aria-label="Reasons for the appeal decision" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
          <button
            className="btn btn-sm btn-primary"
            style={{ alignSelf: 'flex-start' }}
            disabled={act.busy || !f.result || f.text.trim().length < 20 || (f.result === 'varied' && !f.variedTo)}
            onClick={async () => {
              const r = await act.run(
                () =>
                  api.decideDisciplineAppeal(x.id, {
                    result: f.result as keyof typeof APPEAL_RESULT_LABEL,
                    variedTo: f.result === 'varied' ? (f.variedTo as (typeof LIGHTER_STEPS)[number]) : null,
                    reason: f.text,
                  }),
                'Appeal decided.',
              );
              if (r) done();
            }}
          >
            Decide appeal
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}
