import { useState } from 'react';
import { ATTENDANCE_ISSUE_LABEL, GROUP_EMPLOYER_ID, LEAVE_LABEL, isGroupLeader, jaOwns } from '@prima/core';
import { api, type GuardProfile, type PersonDetail } from '../api';
import { useApp } from '../App';
import { Chip, Drawer, ErrorNotice, ExpiryChip, Findings, Kpi, Loading, dateLabel, dayLabel, hhmm, useAction, useLoad } from '../ui';
import { LeaveForm } from './Leave';
import { SocsoTab } from './Socso';
import { ClaimsPolicy, DisciplinePolicy, HiringChecklist, HospitalClaims, MedicalHistory } from './HrFile';
import { SHIFT_STATE } from './shared';
import { RecordButton } from './RecordForm';
import { GuardTrainingPanel } from './HrDevelop';

export function People({ openPersonId }: { openPersonId?: string }) {
  const { companyId: chosen, me } = useApp();
  // HR and group leadership also open PWVSB's own central staff (Fauzan, 27 Oct 2026).
  const hr = me.user.department === 'hr' || isGroupLeader(me.user);
  const [central, setCentral] = useState(false);
  const companyId = hr && central ? GROUP_EMPLOYER_ID : chosen;
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'blocked' | 'np'>('all');
  const [open, setOpen] = useState<string | undefined>(openPersonId);
  const { data, error } = useLoad(() => api.people(companyId, q), [companyId, q]);

  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  const rows = (data ?? []).filter((r) => (filter === 'blocked' ? !r.deployable : filter === 'np' ? r.person.nationality === 'NP' : true));
  const blockedCount = (data ?? []).filter((r) => !r.deployable).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{hr ? 'People' : 'Guards'}</h1>
          <p>
            Allowed to work means a valid KDN guard card (or vetting already submitted in eSIMS while KDN decides), CSG training done within the first year of
            work, age 60 or under, and for Nepali guards a valid permit, passport, FOMEMA and insurance.
          </p>
        </div>
        <div className="row">
          <input id="people-search" className="input" placeholder="Search name or staff number" value={q} onChange={(e) => setQ(e.target.value)} />
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
          {hr && (
            <div className="seg" role="group" aria-label="Employer">
              <button aria-pressed={!central} onClick={() => setCentral(false)}>
                Chosen company
              </button>
              <button aria-pressed={central} onClick={() => setCentral(true)}>
                PWVSB central staff
              </button>
            </div>
          )}
          <RecordButton kind="officeStaff" companyId={companyId} label="Add office staff" />
        </div>
      </div>
      <GuardTrainingPanel />
      <section className="panel">
        {!data && <Loading what="guards" />}
        {data && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Staff no</th>
                  <th className="hide-sm">Role</th>
                  <th className="hide-sm">From</th>
                  <th>Can work</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 300).map((r) => (
                  <tr key={r.person.id} className="clickable" onClick={() => setOpen(r.person.id)}>
                    <td style={{ fontWeight: 600 }}>{r.person.name}</td>
                    <td className="mono">{r.person.staffNo}</td>
                    <td className="hide-sm">{r.person.role.replace('_', ' ')}</td>
                    <td className="hide-sm">{r.person.nationality === 'NP' ? 'Nepal' : 'Malaysia'}</td>
                    <td>{r.deployable ? r.warnings ? <Chip tone="warn">Yes, papers due</Chip> : <Chip tone="ok">Yes</Chip> : <Chip tone="crit">No</Chip>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 300 && <div className="empty">Showing 300 of {rows.length}. Search to narrow down.</div>}
            {rows.length === 0 && <div className="empty">Nobody matches.</div>}
          </div>
        )}
      </section>
      {open && <PersonDrawer personId={open} onClose={() => setOpen(undefined)} />}
    </div>
  );
}

type Tab = 'work' | 'training' | 'hours' | 'leave' | 'socso' | 'warnings' | 'benefits';

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
  const p = data?.person;
  const tabs: [Tab, string][] = prof.data
    ? [
        ['work', 'Work'],
        ['training', 'Training'],
        ['hours', prof.data.access.pay && !jaOwns('payroll') ? 'Hours and pay' : 'Hours'],
        ['leave', 'Leave'],
        ['socso', 'SOCSO'],
        ['warnings', 'Warnings'],
        ...(prof.data.access.pay ? ([['benefits', 'Benefits']] as [Tab, string][]) : []),
      ]
    : [];
  return (
    <Drawer
      title={p?.name ?? 'Guard'}
      sub={p ? `${p.staffNo} · ${p.jobTitle ?? ROLE_LABEL[p.role]} · ${data?.branch?.name ?? ''}` : undefined}
      onClose={onClose}
    >
      <ErrorNotice error={basic.error} />
      {!data && !basic.error && <Loading what="profile" />}
      {data && p && (
        <>
          {p.role === 'office' && (
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <RecordButton kind="officeStaff" id={p.id} label="Edit staff details" />
            </div>
          )}
          {tabs.length > 0 && (
            <div className="tabbar" role="tablist" aria-label="Profile sections" style={{ flexWrap: 'wrap' }}>
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
          {prof.data && tab === 'warnings' && <WarningsTab d={prof.data} />}
          {prof.data && tab === 'benefits' && <BenefitsTab d={prof.data} />}
        </>
      )}
    </Drawer>
  );
}

const ROLE_LABEL: Record<string, string> = { guard: 'Guard', supervisor: 'Officer', patrol_officer: 'Patrolling officer', office: 'Office staff' };

export function WorkTab({ data }: { data: PersonDetail }) {
  const p = data.person;
  return (
    <>
      <div className="grid-2">
        <div>
          <div className="label">Identity (masked)</div>
          <div className="mono">{p.idMasked}</div>
        </div>
        <div>
          <div className="label">Born</div>
          <div>{dateLabel(p.dob)}</div>
        </div>
        <div>
          <div className="label">Phone</div>
          <div className="mono">{p.phone}</div>
        </div>
        <div>
          <div className="label">Joined</div>
          <div>{dateLabel(p.hiredOn)}</div>
        </div>
        <div>
          <div className="label">Face for clock-in</div>
          <div>{p.faceEnrolledOn ? `Enrolled ${dateLabel(p.faceEnrolledOn)}` : <Chip tone="warn">Not enrolled</Chip>}</div>
        </div>
      </div>
      {'hiring' in data && <HiringChecklist d={data as GuardProfile} />}
      {(data.canSetPin || data.accounts.length > 0) && <AccessSection data={data} />}
      {p.role !== 'office' && (
        <section>
          <h3>Can this guard work today?</h3>
          {data.findings.length === 0 ? (
            <div className="notice" data-tone="ok">
              Yes. All required papers are valid.
            </div>
          ) : (
            <Findings items={data.findings} />
          )}
          {data.armedFindings.some((f) => f.code === 'MISSING_FIREARM_PERMIT' || f.code === 'EXPIRED_FIREARM_PERMIT') && (
            <p className="muted small" style={{ marginTop: 6 }}>
              Not cleared for armed posts.
            </p>
          )}
        </section>
      )}
      {p.role !== 'office' && (
        <section>
          <h3>Shifts, last and next 7 days</h3>
          <div className="list">
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
        </section>
      )}
    </>
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
    <section>
      <h3>PIN and Prima access</h3>
      <ErrorNotice error={act.error} />
      <div className="list">
        <div className="list-item">
          <div>
            <div>PIN for site devices and witness sign-offs</div>
            <div className="muted small">Kept only in a form nobody can read back. A forgotten PIN is set again.</div>
          </div>
          {data.pinSet ? <Chip tone="ok">Set</Chip> : <Chip tone="warn">Not set</Chip>}
        </div>
        {data.canSetPin && p.status === 'active' && (
          <div className="list-item" style={{ gap: 8 }}>
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
        {data.accounts.map((a) => (
          <div key={a.userId} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div>Prima account: {a.title}</div>
                {a.closed && <div className="muted small">Closed by {a.closed.by}: {a.closed.reason}</div>}
              </div>
              {a.closedFrom ? <Chip tone="crit">Closed from {dateLabel(a.closedFrom)}</Chip> : <Chip tone="ok">Open</Chip>}
            </div>
            {a.canClose && !a.closedFrom && closing !== a.userId && (
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn btn-sm" onClick={() => setClosing(a.userId)}>
                  Close access
                </button>
              </div>
            )}
            {closing === a.userId && (
              <>
                <input className="input" aria-label="Reason" placeholder="Reason, e.g. resigned, contract ended, dismissed" value={reason} onChange={(e) => setReason(e.target.value)} />
                <label className="field">
                  <span className="label">From (empty means now)</span>
                  <input className="input" type="date" aria-label="Close from" value={from} onChange={(e) => setFrom(e.target.value)} />
                </label>
                <p className="muted small">From that day Prima refuses this account and its company grants end. IT still disables the Microsoft account.</p>
                <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
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
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function TrainingTab({ d }: { d: GuardProfile }) {
  return (
    <>
      <section>
        <h3>Coming next</h3>
        {d.next.length === 0 ? (
          <div className="notice" data-tone="ok">
            Nothing due in the next 90 days.
          </div>
        ) : (
          <div className="list">
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
      </section>
      <section>
        <h3>Licences, training and certificates</h3>
        <div className="list">
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
      </section>
      <section>
        <h3>Chances to upgrade</h3>
        <div className="list">
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
        <p className="muted small">Placeholder list until Group HR gives the real course catalogue and HRD Corp rules ({d.upgradeRule.id}).</p>
      </section>
    </>
  );
}

/**
 * self: the person looking at their own record. Fauzan, 28 Oct 2026: staff see their own amounts only, not how they are
 * worked out or the law behind them; HR, managers and ACT keep the workings on their own screens.
 */
export function HoursTab({ d, self }: { d: GuardProfile; self?: boolean }) {
  const m = d.hours;
  return (
    <>
      <div className="kpis">
        <Kpi label="Hours this month" value={m.thisMonth.hours} note={`${m.thisMonth.days} days, ${m.thisMonth.overtimeHours} h overtime`} />
        <Kpi label="Hours last month" value={m.lastMonth.hours} note={`${m.lastMonth.days} days, ${m.lastMonth.overtimeHours} h overtime`} />
        <Kpi label="Missed shifts this month" value={m.thisMonth.missed} tone={m.thisMonth.missed ? 'warn' : 'ok'} note={`${m.thisMonth.late} late`} />
      </div>
      {!d.pay && d.access.pay && jaOwns('payroll') && <p className="muted small">Pay and payslips are in the JA Group app.</p>}
      {d.pay && (
        <section>
          <h3>Pay this month (estimate)</h3>
          {d.pay.basic == null ? (
            <div className="notice" data-tone="warn">
              No pay on record.
            </div>
          ) : (
            <div className="list">
              <div className="list-item">
                <span>Basic pay</span>
                <span className="mono">RM{d.pay.basic.toFixed(2)}</span>
              </div>
              {d.pay.workings.map((w, i) => (
                <div key={w.label} className="list-item" style={i === d.pay!.workings.length - 1 ? { fontWeight: 600 } : undefined}>
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
          <p className="muted small">
            An estimate from clock-in times, before payroll. EPF, SOCSO, EIS and tax deductions come with the payroll rules and payslips.
          </p>
        </section>
      )}
      <section>
        <h3>Hours day by day, this month</h3>
        <div className="list">
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
              <div className="row" style={{ gap: 6 }}>
                {x.late && <Chip tone="warn">Late</Chip>}
                <span className="mono">{x.hours} h</span>
              </div>
            </div>
          ))}
        </div>
        <p className="muted small">{self ? `Total this month: ${m.thisMonth.hours} h.` : `Hours over 8 in a day count as overtime. Total this month: ${m.thisMonth.hours} h.`}</p>
      </section>
    </>
  );
}

export function LeaveTab({ d, personId, self }: { d: GuardProfile; personId: string; self?: boolean }) {
  const [asking, setAsking] = useState(false);
  const [redo, setRedo] = useState<{ kind: (typeof d.leave.requests)[number]['kind']; from: string; to: string; reason: string; illness?: string; clinic?: string; mcNo?: string; correctsId?: string; reusedDocs?: number } | null>(null);
  const b = d.leave.balances;
  return (
    <>
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
      <p className="muted small">
        {b.years} year{b.years === 1 ? '' : 's'} of service. {b.note ? `${b.note} ` : ''}
        {!self && b.rule.source}
      </p>
      {d.access.requestLeave && !asking && (
        <div>
          <button className="btn btn-sm" onClick={() => setAsking(true)}>
            {self ? 'Ask for leave' : 'Ask for leave for this person'}
          </button>
        </div>
      )}
      {asking && <LeaveForm key={redo ? `${redo.from}-${redo.to}` : 'new'} personId={personId} prefill={redo} onDone={() => (setAsking(false), setRedo(null))} />}
      <section>
        <h3>Requests</h3>
        <div className="list">
          {d.leave.requests.length === 0 && <div className="empty">No requests yet.</div>}
          {d.leave.requests.map((q) => (
            <div key={q.id} className="list-item" style={{ flexWrap: 'wrap', gap: 6 }}>
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
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
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
      </section>
      <HospitalClaims d={d} />
    </>
  );
}

export function WarningsTab({ d, self }: { d: GuardProfile; self?: boolean }) {
  const w = d.warnings;
  return (
    <>
      {!self && <DisciplinePolicy d={d} />}
      <section>
        <h3>Disciplinary record</h3>
        <div className="list">
          {w.discipline.length === 0 && <div className="empty">No warnings on record.</div>}
          {w.discipline.map((x) => (
            <div key={x.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
              <div style={{ fontWeight: 600 }}>
                {x.label} · {dateLabel(x.date)}
              </div>
              <div className="muted small">
                {x.by}: {x.note}
                {x.proof ? ` · ${x.proof} document(s)` : ''}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h3>Attendance problems, last 30 days</h3>
        <div className="list">
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
      </section>
    </>
  );
}

export function BenefitsTab({ d, self }: { d: GuardProfile; self?: boolean }) {
  return (
    <section>
      <h3>Medical and other benefits</h3>
      <div className="list">
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
      <p className="muted small">Company cover and claims are not linked yet, so they show as Unknown, never as fine.</p>
      <MedicalHistory d={d} />
      <ClaimsPolicy d={d} self={self} />
    </section>
  );
}
