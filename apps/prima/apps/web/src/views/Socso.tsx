import { useState } from 'react';
import { ClockCountdownIcon, FilesIcon, FirstAidKitIcon, PhoneIcon, PlusIcon } from '@phosphor-icons/react';
import {
  GROUP_EMPLOYER_ID,
  isGroupLeader,
  SOCSO_STATUS_LABEL,
  SOCSO_TYPE_DETAIL,
  SOCSO_TYPE_LABEL,
  SOCSO_RESTRICTION_LABEL,
  socsoTriage,
  type SocsoRestrictionKind,
  type Nationality,
  type ProofInput,
  type SocsoCaseType,
  type SocsoStatus,
} from '@prima/core';
import { api, type GuardProfile, type SocsoClaimDetail, type SocsoClaims } from '../api';
import { Card, Empty, Facts, PageHead, Person, Search, Stat, Stats, Steps, Toolbar, type StepState } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, dateTimeLabel, hhmm, useAction, useLoad, type Tone } from '../ui';
import { DocList, ProofPicker } from './Proof';
import { DoshPanel, DoshRegisterPanel, FamilyPanel, LindungPanel } from './SocsoMore';
import { useApp } from '../App';
import '../styles/hrx.css';

/**
 * SOCSO (PERKESO) claims (Fauzan, 26 Oct 2026: "Find out about how to claim socso, the sop, the cases that can claim.
 * Put it in hr. And give every staff profile have button on socso claim submittion."). PERKESO has no API: HR submits
 * Form 34 in ASSIST and records the reference here; the app keeps the papers, the deadlines and the payroll effect.
 */

const TYPES: SocsoCaseType[] = ['WORK_ACCIDENT', 'COMMUTING', 'EMERGENCY', 'OCCUPATIONAL_DISEASE', 'NON_WORK_ACCIDENT', 'INVALIDITY', 'DEATH'];

const STATUS_TONE: Record<SocsoStatus, Tone> = {
  DRAFT: 'warn',
  REPORTED: 'info',
  DOCS_COMPLETE: 'info',
  UNDER_REVIEW: 'info',
  APPROVED: 'ok',
  REJECTED: 'crit',
  APPEAL: 'warn',
  CLOSED: 'neutral',
};

type Form34 = SocsoClaimDetail['form34'];
type ClaimRow = SocsoClaims['rows'][number];

function Form34Chip({ f }: { f: Form34 }) {
  if (f.state === 'not_needed') return <Chip tone="neutral">Worker applies (LINDUNG)</Chip>;
  if (f.state === 'done') return <Chip tone="ok">Form 34 sent</Chip>;
  if (f.state === 'overdue') return <Chip tone="crit">Form 34 overdue by {Math.abs(f.hoursLeft)} h</Chip>;
  return <Chip tone={f.state === 'reminder' ? 'warn' : 'info'}>Form 34 due in {f.hoursLeft} h</Chip>;
}

/** Local time in Malaysia as the value of a datetime-local field. */
function nowLocal(): string {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 16);
}

/**
 * Where a claim is in PERKESO's process, read from its status only:
 * Form 34, papers, PERKESO review, the decision, paid and closed.
 */
const PROGRESS: Record<SocsoStatus, StepState[]> = {
  DRAFT: ['now', 'todo', 'todo', 'todo', 'todo'],
  REPORTED: ['done', 'now', 'todo', 'todo', 'todo'],
  DOCS_COMPLETE: ['done', 'done', 'now', 'todo', 'todo'],
  UNDER_REVIEW: ['done', 'done', 'now', 'todo', 'todo'],
  APPROVED: ['done', 'done', 'done', 'done', 'now'],
  REJECTED: ['done', 'done', 'done', 'stopped', 'todo'],
  APPEAL: ['done', 'done', 'done', 'now', 'todo'],
  CLOSED: ['done', 'done', 'done', 'done', 'done'],
};
function ClaimSteps({ status, form34, perkesoRef }: { status: SocsoStatus; form34: Form34; perkesoRef?: string | null }) {
  const s = PROGRESS[status];
  const decision = status === 'APPROVED' ? 'Approved' : status === 'REJECTED' ? 'Rejected' : status === 'APPEAL' ? 'Appeal' : "PERKESO's decision";
  return (
    <Steps
      steps={[
        { label: 'Form 34 in ASSIST', state: s[0], note: perkesoRef ? `PERKESO ${perkesoRef}` : form34.state === 'not_needed' ? 'Worker applies (LINDUNG)' : `Due ${dateTimeLabel(form34.due)}` },
        { label: 'Papers to PERKESO', state: s[1] },
        { label: 'PERKESO review', state: s[2] },
        { label: decision, state: s[3] },
        { label: 'Paid and closed', state: s[4] },
      ]}
    />
  );
}

/** The HR page: what SOCSO covers, how to claim, and every claim the user may follow. */
export function SocsoView() {
  const { data, error } = useLoad(() => api.socsoClaims(), []);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<SocsoStatus | ''>('');
  const [starting, setStarting] = useState(false);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="SOCSO claims" />
      </div>
    );
  const rows = data.rows.filter((r) => filter === 'all' || r.claim.status !== 'CLOSED');
  const due = data.rows.filter((r) => r.form34.state === 'reminder' || r.form34.state === 'overdue').length;
  const missing = data.rows.filter((r) => r.claim.status !== 'CLOSED' && r.missing > 0).length;
  const checkIns = data.rows.filter((r) => r.checkIn?.overdue).length;
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (!status || r.claim.status === status) &&
      (!needle ||
        [r.person?.name ?? '', r.person?.staffNo ?? '', r.companyName, r.typeLabel, r.claim.perkesoRef ?? ''].some((v) => v.toLowerCase().includes(needle))),
  );
  const statuses = [...new Set(data.rows.map((r) => r.claim.status))];
  const count = shown.length === rows.length ? `${rows.length} claim${rows.length === 1 ? '' : 's'}` : `${shown.length} of ${rows.length}`;
  return (
    <div className="page">
      <PageHead
        title="SOCSO claims"
        sub="Start a claim here or from the person's profile (the SOCSO tab). HR submits Form 34 in PERKESO ASSIST and records the reference here."
        actions={
          data.canStart ? (
            <button className="btn btn-primary" onClick={() => setStarting(true)}>
              <PlusIcon size={16} /> Start a claim
            </button>
          ) : undefined
        }
      />
      <Stats>
        <Stat label="Open claims" value={data.rows.filter((r) => r.claim.status !== 'CLOSED').length} icon={<FirstAidKitIcon size={16} />} tone="info" />
        <Stat
          label="Form 34 due or late"
          value={due}
          tone={due ? 'crit' : 'ok'}
          note="Due 48 hours after the company was told"
          icon={<ClockCountdownIcon size={16} />}
        />
        <Stat label="Papers missing" value={missing} tone={missing ? 'warn' : 'ok'} icon={<FilesIcon size={16} />} />
        <Stat
          label="Check-ins overdue"
          value={checkIns}
          tone={checkIns ? 'warn' : 'ok'}
          note="Officer calls weekly while the person is off"
          icon={<PhoneIcon size={16} />}
        />
      </Stats>
      <div className="sx-layout">
        <div className="hx-stack-tight">
          <Toolbar
            end={
              <div className="seg" role="group" aria-label="Which claims">
                <button aria-pressed={filter === 'open'} onClick={() => setFilter('open')}>
                  Open
                </button>
                <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                  All
                </button>
              </div>
            }
          >
            <Search value={q} onChange={setQ} placeholder="Search name, staff no. or PERKESO ref" label="Search claims" />
            <select className="select hx-filter" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as SocsoStatus | '')}>
              <option value="">Every status</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {SOCSO_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Toolbar>
          <Card title="Claims" actions={<span className="hx-count">{count}</span>} flush>
            {rows.length === 0 ? (
              <Empty
                title={data.canSeeAny ? 'No claim.' : 'You do not follow SOCSO claims for any company.'}
                action={
                  data.canStart ? (
                    <button className="btn btn-sm" onClick={() => setStarting(true)}>
                      Start a claim
                    </button>
                  ) : undefined
                }
              />
            ) : shown.length === 0 ? (
              <Empty title="No claim matches the search." />
            ) : (
              <ul className="hx-rows">
                {shown.map((r) => (
                  <li key={r.claim.id}>
                    <ClaimButton r={r} onOpen={() => setOpen(r.claim.id)} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <SocsoSop />
      </div>
      <DoshRegisterPanel />
      {open && (
        <Drawer title="SOCSO claim" onClose={() => setOpen(null)}>
          <SocsoClaimBody id={open} />
        </Drawer>
      )}
      {starting && (
        <StartClaimDrawer
          onClose={() => setStarting(false)}
          onStarted={(id) => {
            setStarting(false);
            setOpen(id);
          }}
        />
      )}
    </div>
  );
}

/** Start a claim from the SOCSO page (P78): find the person in the chosen company, then the same form as the profile. */
function StartClaimDrawer({ onClose, onStarted }: { onClose: () => void; onStarted: (id: string) => void }) {
  const { companyId: chosen, me } = useApp();
  const central = me.user.department === 'hr' || isGroupLeader(me.user);
  const [own, setOwn] = useState(false);
  const companyId = central && own ? GROUP_EMPLOYER_ID : chosen;
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<{ id: string; name: string; nationality: Nationality; optedOut: boolean } | null>(null);
  const list = useLoad(() => (pick ? Promise.resolve(null) : api.people(companyId, q)), [companyId, q, !!pick]);
  return (
    <Drawer title="Start a SOCSO claim" sub={pick ? pick.name : 'Choose the person'} onClose={onClose}>
      {pick ? (
        <>
          <div>
            <button className="btn btn-ghost btn-sm" onClick={() => setPick(null)}>
              Choose someone else
            </button>
          </div>
          <StartSocsoForm personId={pick.id} nationality={pick.nationality} optedOut={pick.optedOut} onDone={(id) => (id ? onStarted(id) : setPick(null))} />
        </>
      ) : (
        <div className="hx-stack-tight">
          {central && (
            <div className="seg" role="group" aria-label="Employer">
              <button aria-pressed={!own} onClick={() => setOwn(false)}>
                Chosen company
              </button>
              <button aria-pressed={own} onClick={() => setOwn(true)}>
                PWVSB central staff
              </button>
            </div>
          )}
          <Search value={q} onChange={setQ} placeholder="Search name or staff number" label="Search people" />
          <ErrorNotice error={list.error} />
          {!list.data && !list.error && <Loading what="people" />}
          {list.data && list.data.length === 0 && <Empty title="Nobody matches." />}
          {list.data && list.data.length > 0 && (
            <ul className="hx-rows">
              {list.data.slice(0, 30).map((r) => (
                <li key={r.person.id}>
                  <button
                    className="sx-claim"
                    onClick={() =>
                      setPick({ id: r.person.id, name: r.person.name, nationality: r.person.nationality, optedOut: r.person.lindungOptOut === true })
                    }
                  >
                    <span className="sx-claim-who">
                      <Person name={r.person.name} sub={r.person.staffNo} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Drawer>
  );
}

/** One claim in the register: the person, the case and its deadlines. */
function ClaimButton({ r, onOpen }: { r: ClaimRow; onOpen: () => void }) {
  const open = r.claim.status !== 'CLOSED';
  const tone = r.claim.status === 'DRAFT' && r.form34.state === 'overdue' ? 'crit' : open && (r.claim.status === 'DRAFT' || r.missing > 0) ? 'warn' : undefined;
  return (
    <button className="sx-claim" data-tone={tone} onClick={onOpen}>
      <span className="sx-claim-who">
        <Person name={r.person?.name ?? 'Unknown person'} sub={[r.person?.staffNo, r.companyName].filter(Boolean).join(' · ')} />
      </span>
      <span className="sx-claim-case">
        <span className="hx-row-title">{r.typeLabel}</span>
        <span className="hx-row-meta">
          {dateTimeLabel(r.claim.incidentAt)}
          {r.claim.perkesoRef ? ` · PERKESO ${r.claim.perkesoRef}` : ''}
        </span>
      </span>
      <span className="sx-claim-chips">
        {r.claim.status === 'DRAFT' && <Form34Chip f={r.form34} />}
        <Chip tone={STATUS_TONE[r.claim.status]}>{r.statusLabel}</Chip>
        {r.missing > 0 && <Chip tone={open ? 'warn' : 'neutral'}>{r.missing} paper(s) missing</Chip>}
        {r.checkIn?.overdue && <Chip tone="warn">Check-in overdue</Chip>}
      </span>
    </button>
  );
}

/** The SOP in short (SOCSO Claims SOP, 26 Oct 2026). */
export function SocsoSop() {
  return (
    <Card title="How to claim (SOP)">
      <div className="sx-sop">
        <details className="sx-details">
          <summary>What SOCSO pays for</summary>
          <ul className="sx-types">
            {TYPES.map((t) => (
              <li key={t}>
                <strong>{SOCSO_TYPE_LABEL[t]}</strong>
                <span>{SOCSO_TYPE_DETAIL[t]}</span>
              </li>
            ))}
            <li className="sx-types-not">
              Not SOCSO: ordinary illness (sick leave), clinic visits (panel or the foreign worker medical ledger), hospital bills of foreign workers (SPIKPA),
              and job loss (EIS, claimed by the worker).
            </li>
          </ul>
        </details>
        <details className="sx-details">
          <summary>Steps and deadlines</summary>
          <ol className="sx-sop-steps">
            <li>The guard or officer tells the OM straight away. Get treatment first: any panel clinic or government hospital.</li>
            <li>The OM or HR starts the claim on the person's profile, with when it happened and when the company was told.</li>
            <li>HR submits Form 34 in PERKESO ASSIST within 48 hours of being told, and records the reference. A reminder shows at 24 hours.</li>
            <li>HR adds the papers on the checklist. Medical papers are seen by HR only.</li>
            <li>Mark documents complete, then under PERKESO review. Record PERKESO's decision.</li>
            <li>Rejected: appeal to the Appellate Board within 90 days, or close. Approved: record the amount paid and close.</li>
            <li>Permanent disablement: claim within 12 months of the last MC day.</li>
          </ol>
        </details>
        <details className="sx-details">
          <summary>How the MC days are paid</summary>
          <p className="sx-sop-text">
            Basic pay only (Fauzan, 26 Oct 2026). Three MC days or fewer: company sick leave. Four days or more on an accepted claim: PERKESO pays temporary
            disablement and the company does not pay those days (Employment Act s.60F(4)). While PERKESO decides, the days are held, then settled.
          </p>
        </details>
      </div>
    </Card>
  );
}

/** The SOCSO tab on a staff profile: the Start button for the OM and HR, and the person's claims. */
export function SocsoTab({ d, personId }: { d: GuardProfile; personId: string }) {
  const s = d.socso;
  const [starting, setStarting] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  if (open)
    return (
      <div className="sx-tab">
        <div>
          <button className="btn btn-sm" onClick={() => setOpen(null)}>
            Back to claims
          </button>
        </div>
        <SocsoClaimBody id={open} />
      </div>
    );
  return (
    <div className="sx-tab">
      <div className="sx-tab-head">
        <span className="small">SOCSO no. {d.person.socsoNo ?? 'not on record'}</span>
        {d.person.nationality === 'MY' && (
          <Chip tone={s.lindung === 'covered' ? 'ok' : s.lindung === 'opted_out' ? 'warn' : 'unknown'}>
            LINDUNG 24 Jam: {s.lindung === 'covered' ? 'covered' : s.lindung === 'opted_out' ? 'opted out' : 'unknown'}
          </Chip>
        )}
        {s.canStart && !starting && (
          <button className="btn btn-primary btn-sm sx-tab-start" onClick={() => setStarting(true)}>
            Start SOCSO claim
          </button>
        )}
      </div>
      {starting && (
        <StartSocsoForm
          personId={personId}
          nationality={d.person.nationality}
          optedOut={s.lindung === 'opted_out'}
          onDone={(id) => {
            setStarting(false);
            if (id) setOpen(id);
          }}
        />
      )}
      <section className="sx-sec">
        <h3>Claims</h3>
        <div className="sx-box">
          {s.claims.length === 0 ? (
            <div className="empty">No SOCSO claim.</div>
          ) : (
            <ul className="hx-rows">
              {s.claims.map((c) => (
                <li key={c.id}>
                  <button className="sx-claim sx-claim-short" onClick={() => setOpen(c.id)}>
                    <span className="sx-claim-case">
                      <span className="hx-row-title">
                        {c.typeLabel} · {dateTimeLabel(c.incidentAt)}
                      </span>
                      <span className="hx-row-meta">{c.perkesoRef ? `PERKESO ${c.perkesoRef}` : 'Not yet reported to PERKESO'}</span>
                    </span>
                    <span className="sx-claim-chips">
                      {c.status === 'DRAFT' && <Form34Chip f={c.form34} />}
                      <Chip tone={STATUS_TONE[c.status]}>{c.statusLabel}</Chip>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      {!s.canStart && <p className="muted small">To claim, tell your OM or the HR office. They start the claim and submit it to PERKESO.</p>}
    </div>
  );
}

/** Start a claim: the kind of case (or "Not sure" questions), when it happened and when the company was told. */
export function StartSocsoForm({
  personId,
  nationality,
  optedOut,
  onDone,
}: {
  personId: string;
  nationality: Nationality;
  optedOut: boolean;
  onDone: (id: string | null) => void;
}) {
  const [type, setType] = useState<SocsoCaseType | ''>('');
  const [unsure, setUnsure] = useState(false);
  const [q, setQ] = useState({ onDuty: false, commuting: false, outsideWorkInMalaysia: false, illness: false, permanent: false });
  const [incidentAt, setIncidentAt] = useState(nowLocal());
  const [toldAt, setToldAt] = useState(nowLocal());
  const [place, setPlace] = useState('');
  const [description, setDescription] = useState('');
  const [witnesses, setWitnesses] = useState('');
  const act = useAction();
  const triage = socsoTriage(q, nationality);
  const types = TYPES.filter((t) => t !== 'NON_WORK_ACCIDENT' || nationality !== 'MY' || !optedOut);
  const check = (k: keyof typeof q, label: string) => (
    <label className="sx-check">
      <input type="checkbox" checked={q[k]} onChange={(e) => setQ({ ...q, [k]: e.target.checked })} />
      {label}
    </label>
  );
  return (
    <div className="hx-form">
      <h4 className="hx-form-title">Start a SOCSO claim</h4>
      <label className="field">
        <span className="label">Kind of case</span>
        <select className="select" aria-label="Kind of case" value={type} onChange={(e) => setType(e.target.value as SocsoCaseType | '')}>
          <option value="">Choose…</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {SOCSO_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </label>
      {type && <span className="muted small">{SOCSO_TYPE_DETAIL[type]}</span>}
      {!unsure && (
        <div>
          <button className="link-button small" onClick={() => setUnsure(true)}>
            Not sure which kind?
          </button>
        </div>
      )}
      {unsure && (
        <div className="sx-triage">
          {check('illness', 'It is an illness, not an accident')}
          {q.illness && check('permanent', 'It leaves the person permanently unable to work')}
          {!q.illness && check('onDuty', 'Hurt while on duty')}
          {!q.illness && !q.onDuty && check('commuting', 'Hurt on the direct trip between home and work')}
          {!q.illness && !q.onDuty && !q.commuting && check('outsideWorkInMalaysia', 'An accident outside work, in Malaysia')}
          <div className="sx-triage-advice">
            {triage.advice}
            {triage.type === 'NON_WORK_ACCIDENT' && nationality === 'MY' && optedOut ? ' This person opted out, so it is not covered.' : ''}
          </div>
          {triage.type && triage.type !== type && types.includes(triage.type) && (
            <div>
              <button className="btn btn-sm" onClick={() => setType(triage.type!)}>
                Use {SOCSO_TYPE_LABEL[triage.type]}
              </button>
            </div>
          )}
        </div>
      )}
      <div className="hx-form-grid">
        <label className="field">
          <span className="label">When it happened</span>
          <input className="input" type="datetime-local" aria-label="When it happened" value={incidentAt} onChange={(e) => setIncidentAt(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">When the company was told</span>
          <input className="input" type="datetime-local" aria-label="When the company was told" value={toldAt} onChange={(e) => setToldAt(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span className="label">Where</span>
        <input className="input" aria-label="Where" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Site and spot, or the road" />
      </label>
      <label className="field">
        <span className="label">What happened and the injury</span>
        <textarea className="textarea" rows={3} aria-label="What happened" value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Witnesses</span>
        <input className="input" aria-label="Witnesses" value={witnesses} onChange={(e) => setWitnesses(e.target.value)} placeholder="Names, if any" />
      </label>
      <span className="muted small">Form 34 is due in PERKESO ASSIST 48 hours after the company was told.</span>
      <ErrorNotice error={act.error} />
      <div className="hx-form-actions">
        <button
          className="btn btn-primary"
          disabled={act.busy || !type || description.trim().length < 10}
          onClick={async () => {
            const r = await act.run(
              () =>
                api.startSocsoClaim(personId, {
                  type: type as SocsoCaseType,
                  incidentAt: `${incidentAt}:00+08:00`,
                  toldAt: `${toldAt}:00+08:00`,
                  place,
                  description,
                  witnesses,
                }),
              'Claim started. Submit Form 34 in ASSIST and record the reference.',
            );
            if (r) onDone(r.id);
          }}
        >
          Start claim
        </button>
        <button className="btn" onClick={() => onDone(null)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** One claim: deadlines, the paper checklist, the payroll effect, the next step and the history. */
export function SocsoClaimBody({ id }: { id: string }) {
  const { data, error } = useLoad(() => api.socsoClaim(id), [id]);
  const [view, setView] = useState<'claim' | 'rehab' | 'lindung' | 'family' | 'dosh'>('claim');
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="claim" />;
  const c = data.claim;
  const p = data.person;
  const openRestrictions = data.rehab.restrictions.filter((r) => !r.clearedAt).length;
  const papersDone = data.items.filter((i) => i.done).length;
  const dates: [string, string][] = [
    ['Happened', dateTimeLabel(c.incidentAt)],
    ['Company told', dateTimeLabel(c.toldAt)],
    c.type === 'NON_WORK_ACCIDENT' ? ['Form 34', 'Not needed: the worker applies to PERKESO (LINDUNG tab)'] : ['Form 34 due', dateTimeLabel(data.form34.due)],
  ];
  if (data.later.permanentBy) dates.push(['Permanent disablement claim by', dateLabel(data.later.permanentBy)]);
  if (data.later.appealBy) dates.push(['Appeal by', dateLabel(data.later.appealBy)]);
  if (data.checkIn) dates.push(['Next check-in', data.checkIn.overdue ? `Overdue since ${dateLabel(data.checkIn.due)}` : dateLabel(data.checkIn.due)]);
  return (
    <div className="sx-claim-body">
      <header className="sx-claim-head">
        <Person
          name={p.name}
          size={44}
          sub={`${p.staffNo} · ${p.nationality === 'MY' ? 'Malaysian' : 'Foreign worker'} · SOCSO no. ${p.socsoNo ?? 'not on record'}`}
        />
        <div className="sx-claim-type">{data.typeLabel}</div>
        <div className="sx-chips">
          <Chip tone={STATUS_TONE[c.status]}>{data.statusLabel}</Chip>
          <Form34Chip f={data.form34} />
          {c.perkesoRef && <Chip tone="neutral">PERKESO {c.perkesoRef}</Chip>}
          {data.checkIn && (
            <Chip tone={data.checkIn.overdue ? 'warn' : 'info'}>Check-in {data.checkIn.overdue ? 'overdue' : `due ${dateLabel(data.checkIn.due)}`}</Chip>
          )}
        </div>
      </header>
      <div className="sx-progress">
        <ClaimSteps status={c.status} form34={data.form34} perkesoRef={c.perkesoRef} />
      </div>
      <div className="tabbar hx-tabs" role="tablist" aria-label="Claim sections">
        <button role="tab" aria-selected={view === 'claim'} onClick={() => setView('claim')}>
          Claim
        </button>
        <button role="tab" aria-selected={view === 'rehab'} onClick={() => setView('rehab')}>
          Rehabilitation
          {openRestrictions > 0 && <span className="tab-count">{openRestrictions}</span>}
        </button>
        {data.lindung && (
          <button role="tab" aria-selected={view === 'lindung'} onClick={() => setView('lindung')}>
            LINDUNG
            {data.lindung.verifyClock?.overdue && <span className="tab-count">!</span>}
          </button>
        )}
        {c.type === 'DEATH' && (
          <button role="tab" aria-selected={view === 'family'} onClick={() => setView('family')}>
            Family and payments
            {data.dependants && data.dependants.gaps.length > 0 && <span className="tab-count">{data.dependants.gaps.length}</span>}
          </button>
        )}
        {data.dosh && (
          <button role="tab" aria-selected={view === 'dosh'} onClick={() => setView('dosh')}>
            DOSH
            {data.dosh.clock?.overdue && <span className="tab-count">!</span>}
          </button>
        )}
      </div>
      {view === 'rehab' && <RehabPanel d={data} />}
      {view === 'lindung' && data.lindung && <LindungPanel d={data} />}
      {view === 'family' && <FamilyPanel d={data} />}
      {view === 'dosh' && data.dosh && <DoshPanel d={data} />}
      {view === 'claim' && (
        <>
          <section className="sx-sec">
            <h3>What happened</h3>
            <p className="sx-text">{c.description}</p>
            <div className="sx-facts">
              <Facts items={dates} />
            </div>
            <div className="hx-meta-list">
              {c.place && (
                <span>
                  <b>Where</b> {c.place}
                </span>
              )}
              {c.witnesses && (
                <span>
                  <b>Witnesses</b> {c.witnesses}
                </span>
              )}
              <span>
                Started by {c.openedBy}, {dateTimeLabel(c.openedAt)}
                {c.type === 'NON_WORK_ACCIDENT' ? '. The worker applies to PERKESO; see the LINDUNG tab.' : ''}
              </span>
            </div>
          </section>
          {data.payroll && (
            <section className="sx-sec">
              <h3>Pay for the MC days</h3>
              <p className="sx-text">{data.payroll.text}</p>
            </section>
          )}
          <section className="sx-sec">
            <div className="sx-sec-head">
              <h3>Papers</h3>
              <span className="hx-count">
                {papersDone} of {data.items.length} done
              </span>
            </div>
            <div className="sx-box">
              <ul className="hx-rows">
                {data.items.map((i) => (
                  <li key={i.id}>
                    <PaperRow claimId={c.id} item={i} canManage={data.can.manage} canIncident={data.can.addIncident} closed={c.status === 'CLOSED'} />
                  </li>
                ))}
              </ul>
            </div>
            {!data.can.manage && <p className="muted small">Medical papers are kept by HR and are not shown here.</p>}
          </section>
          {(data.prefill.shifts.length > 0 || data.prefill.attendance.length > 0) && (
            <section className="sx-sec">
              <h3>From the app: roster and clock-in</h3>
              <ul className="sx-lines">
                {data.prefill.shifts.map((s, k) => (
                  <li key={`s${k}`}>
                    Rostered {dateLabel(s.date)} {hhmm(s.start)}–{hhmm(s.end)} · {s.site}
                  </li>
                ))}
                {data.prefill.attendance.map((a, k) => (
                  <li key={`a${k}`}>
                    Clocked in {a.clockIn ? `${dateLabel(a.clockIn.slice(0, 10))} ${hhmm(a.clockIn)}` : '-'}
                    {a.clockOut ? `, out ${hhmm(a.clockOut)}` : ', no clock-out'} · {a.site}
                  </li>
                ))}
              </ul>
              {data.prefill.wages && (
                <p className="muted small">
                  Basic pay RM{data.prefill.wages.basic.toLocaleString()} a month for the wage schedule. {data.prefill.wages.note}
                </p>
              )}
            </section>
          )}
          {data.can.manage && <NextStep d={data} />}
          {c.decision && (
            <section className="sx-sec">
              <h3>PERKESO's decision</h3>
              <p className="sx-text">
                {c.decision.outcome === 'APPROVED' ? 'Approved' : 'Rejected'} on {dateLabel(c.decision.on)}: {c.decision.note}
              </p>
              {(c.amountPaid != null && data.can.manage) || c.returnToWork ? (
                <div className="hx-meta-list">
                  {c.amountPaid != null && data.can.manage && <span>Paid RM{c.amountPaid.toLocaleString()}</span>}
                  {c.returnToWork && <span>Back at work {dateLabel(c.returnToWork)}</span>}
                </div>
              ) : null}
            </section>
          )}
          <section className="sx-sec">
            <h3>History</h3>
            <ol className="sx-history">
              {[...c.history].reverse().map((h, k) => (
                <li key={k}>
                  <span>{h.what}</span>
                  <span className="muted small">
                    {h.by}, {dateTimeLabel(h.at)}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}

function PaperRow({
  claimId,
  item,
  canManage,
  canIncident,
  closed,
}: {
  claimId: string;
  item: SocsoClaimDetail['items'][number];
  canManage: boolean;
  canIncident: boolean;
  closed: boolean;
}) {
  const [mode, setMode] = useState<'add' | 'skip' | null>(null);
  const [proof, setProof] = useState<ProofInput[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const act = useAction();
  const mayAdd = !closed && !item.fromApp && (canManage || (canIncident && item.id === 'INCIDENT'));
  const isMc = item.id === 'MC';
  return (
    <div className="hx-row">
      <div className="hx-row-main">
        <span className="hx-row-title">{item.label}</span>
        <span className="hx-row-meta">
          {item.fromApp ? 'From the app' : item.required ? 'Required' : 'If any'}
          {item.medical ? ' · HR only' : ''}
          {item.override ? ` · going ahead without: ${item.override.reason} (${item.override.by})` : ''}
        </span>
      </div>
      <div className="hx-row-side">
        <Chip tone={item.done ? 'ok' : item.required ? 'warn' : 'neutral'}>
          {item.done ? (item.override ? 'Waived' : 'Done') : item.required ? 'Missing' : 'Optional'}
        </Chip>
      </div>
      <div className="hx-row-body">
        {item.docs.length > 0 && <DocList docs={item.docs} />}
        {mayAdd && !mode && (
          <div className="hx-row-actions">
            <button className="btn btn-sm" onClick={() => setMode('add')}>
              {item.docs.length ? 'Add more' : 'Add paper'}
            </button>
            {canManage && item.required && !item.done && (
              <button className="btn btn-ghost btn-sm" onClick={() => setMode('skip')}>
                Go ahead without
              </button>
            )}
          </div>
        )}
        {mode === 'add' && (
          <div className="hx-form">
            {isMc && (
              <div className="hx-form-grid">
                <label className="field">
                  <span className="label">MC from</span>
                  <input className="input" type="date" aria-label="MC from" value={from} onChange={(e) => setFrom(e.target.value)} />
                </label>
                <label className="field">
                  <span className="label">MC to</span>
                  <input className="input" type="date" aria-label="MC to" value={to} onChange={(e) => setTo(e.target.value)} />
                </label>
              </div>
            )}
            <ProofPicker site={null} refText="SOCSO" items={proof} onChange={setProof} documentsOnly required />
            <ErrorNotice error={act.error} />
            <div className="hx-form-actions">
              <button
                className="btn btn-primary btn-sm"
                disabled={act.busy || !proof.length || (isMc && (!from || !to))}
                onClick={async () => {
                  const r = await act.run(() => api.addSocsoDoc(claimId, item.id, proof, isMc ? { from, to } : undefined), 'Paper added.');
                  if (r) {
                    setMode(null);
                    setProof([]);
                  }
                }}
              >
                Save
              </button>
              <button className="btn btn-sm" onClick={() => setMode(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {mode === 'skip' && (
          <div className="hx-form">
            <label className="field">
              <span className="label">Why go ahead without it</span>
              <input
                className="input"
                aria-label="Why go ahead without it"
                placeholder="Why the claim goes ahead without it"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <ErrorNotice error={act.error} />
            <div className="hx-form-actions">
              <button
                className="btn btn-primary btn-sm"
                disabled={act.busy || reason.trim().length < 5}
                onClick={async () => {
                  const r = await act.run(() => api.overrideSocsoDoc(claimId, item.id, reason), 'Noted.');
                  if (r) setMode(null);
                }}
              >
                Save
              </button>
              <button className="btn btn-sm" onClick={() => setMode(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const NEXT: Record<SocsoStatus, { to: SocsoStatus; label: string }[]> = {
  DRAFT: [{ to: 'REPORTED', label: 'Form 34 submitted in ASSIST' }],
  REPORTED: [{ to: 'DOCS_COMPLETE', label: 'All papers sent to PERKESO' }],
  DOCS_COMPLETE: [{ to: 'UNDER_REVIEW', label: 'PERKESO is reviewing' }],
  UNDER_REVIEW: [
    { to: 'APPROVED', label: 'PERKESO approved' },
    { to: 'REJECTED', label: 'PERKESO rejected' },
  ],
  REJECTED: [
    { to: 'APPEAL', label: 'Appeal lodged' },
    { to: 'CLOSED', label: 'Close without appeal' },
  ],
  APPEAL: [
    { to: 'APPROVED', label: 'Appeal approved' },
    { to: 'REJECTED', label: 'Appeal rejected' },
  ],
  APPROVED: [{ to: 'CLOSED', label: 'Paid, close the claim' }],
  CLOSED: [],
};

/** HR moves the claim on, with what each step needs. */
function NextStep({ d }: { d: SocsoClaimDetail }) {
  const c = d.claim;
  const [to, setTo] = useState<SocsoStatus | null>(null);
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [on, setOn] = useState(nowLocal().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [back, setBack] = useState('');
  const act = useAction();
  const moves = NEXT[c.status].map((m) =>
    m.to === 'REPORTED' && c.type === 'NON_WORK_ACCIDENT' ? { ...m, label: 'Worker applied for LINDUNG' } : m,
  );
  if (!moves.length) return null;
  const needsNote = to === 'APPROVED' || to === 'REJECTED' || to === 'APPEAL';
  const needsAmount = to === 'CLOSED' && c.status === 'APPROVED';
  const ready = to && (to !== 'REPORTED' || ref.trim().length >= 4) && (!needsNote || note.trim().length >= 3) && (!needsAmount || amount !== '');
  return (
    <section className="hx-form sx-next">
      <h3 className="hx-form-title">Next step</h3>
      <div className="hx-form-actions" role="group" aria-label="Next step">
        {moves.map((m) => (
          <button key={m.to} className={`btn btn-sm${to === m.to ? ' btn-primary' : ''}`} aria-pressed={to === m.to} onClick={() => setTo(m.to)}>
            {m.label}
          </button>
        ))}
      </div>
      {to && (
        <div className="hx-form-grid">
          {to === 'REPORTED' && (
            <label className="field">
              <span className="label">{c.type === 'NON_WORK_ACCIDENT' ? "PERKESO application number (from the worker's slip)" : 'PERKESO reference from ASSIST'}</span>
              <input className="input" aria-label="PERKESO reference" value={ref} onChange={(e) => setRef(e.target.value)} />
            </label>
          )}
          {needsNote && (
            <label className="field">
              <span className="label">{to === 'APPEAL' ? 'What the appeal is about' : "PERKESO's decision, in short"}</span>
              <input className="input" aria-label="Decision note" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          )}
          {(to === 'APPROVED' || to === 'REJECTED') && (
            <label className="field">
              <span className="label">Date of the decision letter</span>
              <input className="input" type="date" aria-label="Decision date" value={on} onChange={(e) => setOn(e.target.value)} />
            </label>
          )}
          {to === 'CLOSED' && c.status === 'APPROVED' && (
            <label className="field">
              <span className="label">Amount PERKESO paid (RM)</span>
              <input className="input" type="number" min={0} step="0.01" aria-label="Amount paid" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
          )}
          {to === 'CLOSED' && (
            <label className="field">
              <span className="label">Back at work on</span>
              <input className="input" type="date" aria-label="Back at work" value={back} onChange={(e) => setBack(e.target.value)} />
            </label>
          )}
        </div>
      )}
      {to === 'DOCS_COMPLETE' && d.items.some((i) => i.required && !i.done) && (
        <span className="muted small">Some required papers are missing. Add them, or choose "Go ahead without" and say why.</span>
      )}
      <ErrorNotice error={act.error} />
      {to && (
        <div className="hx-form-actions">
          <button
            className="btn btn-primary btn-sm"
            disabled={!ready || act.busy}
            onClick={async () => {
              const r = await act.run(
                () =>
                  api.advanceSocsoClaim(c.id, to, {
                    perkesoRef: to === 'REPORTED' ? ref : undefined,
                    note: needsNote ? note : undefined,
                    on: to === 'APPROVED' || to === 'REJECTED' ? on : undefined,
                    amountPaid: needsAmount ? Number(amount) : null,
                    returnToWork: to === 'CLOSED' && back ? back : null,
                  }),
                `Claim is now: ${SOCSO_STATUS_LABEL[to].toLowerCase()}.`,
              );
              if (r) setTo(null);
            }}
          >
            Save
          </button>
        </div>
      )}
    </section>
  );
}

const RESTRICTIONS: SocsoRestrictionKind[] = ['NO_DUTY', 'NO_PATROL', 'NO_ARMED', 'NO_NIGHT'];

/**
 * Rehabilitation and return to work (SOP rehabilitation section). HR keeps the PERKESO Return to Work referral, the
 * plan, appointments and work restrictions; open restrictions stop the roster placing the person on unsuitable posts.
 * The officer checks in every week while the person is off and for the first month back.
 */
function RehabPanel({ d }: { d: SocsoClaimDetail }) {
  const r = d.rehab;
  const c = d.claim;
  const manage = d.can.manage && c.status !== 'CLOSED';
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({
    rtwRequestedOn: r.rtwRequestedOn ?? '',
    referralOn: r.referralOn ?? '',
    cmName: r.caseManager?.name ?? '',
    cmPhone: r.caseManager?.phone ?? '',
    plan: r.plan,
    targetReturn: r.targetReturn ?? '',
  });
  const [appt, setAppt] = useState({ at: '', what: '' });
  const [rs, setRs] = useState<{ kind: SocsoRestrictionKind; note: string; from: string; until: string }>({
    kind: 'NO_PATROL',
    note: '',
    from: nowLocal().slice(0, 10),
    until: '',
  });
  const [clearing, setClearing] = useState<string | null>(null);
  const [clearNote, setClearNote] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const act = useAction();
  const field = (k: keyof typeof form, label: string, type = 'text') => (
    <label className="field">
      <span className="label">{label}</span>
      <input className="input" type={type} aria-label={label} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
    </label>
  );
  const rtw: [string, string][] = [];
  if (d.rtwOffered) {
    rtw.push(['Referral', `${r.rtwRequestedOn ? `asked ${dateLabel(r.rtwRequestedOn)}` : 'not asked yet'}${r.referralOn ? `, referred ${dateLabel(r.referralOn)}` : ''}`]);
    rtw.push(['PERKESO case manager', r.caseManager ? `${r.caseManager.name}${r.caseManager.phone ? `, ${r.caseManager.phone}` : ''}` : 'not known yet']);
  }
  rtw.push(['Target return', r.targetReturn ? dateLabel(r.targetReturn) : 'not set']);
  if (r.plan) rtw.push(['Plan', r.plan]);
  return (
    <div className="sx-rehab">
      {!d.rtwOffered && (
        <p className="notice" data-tone="info">
          PERKESO gives foreign workers appliances only (such as crutches or a prosthesis), not the Return to Work programme. Foreign Worker Management keeps
          the work pass valid during a long MC.
        </p>
      )}
      <section className="sx-sec">
        <div className="sx-sec-head">
          <h3>Return to work</h3>
          {manage && !edit && (
            <button className="btn btn-sm" onClick={() => setEdit(true)}>
              Update
            </button>
          )}
        </div>
        {!edit && (
          <div className="sx-facts">
            <Facts items={rtw} />
          </div>
        )}
        {edit && (
          <div className="hx-form">
            {d.rtwOffered && (
              <div className="hx-form-grid">
                {field('rtwRequestedOn', 'Return to Work asked on', 'date')}
                {field('referralOn', 'PERKESO referred on', 'date')}
                {field('cmName', 'Case manager name')}
                {field('cmPhone', 'Case manager phone', 'tel')}
              </div>
            )}
            {field('targetReturn', 'Target return date', 'date')}
            <label className="field">
              <span className="label">Plan</span>
              <textarea className="textarea" rows={2} aria-label="Plan" value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} />
            </label>
            <ErrorNotice error={act.error} />
            <div className="hx-form-actions">
              <button
                className="btn btn-primary btn-sm"
                disabled={act.busy}
                onClick={async () => {
                  const ok = await act.run(
                    () =>
                      api.setSocsoRehab(c.id, {
                        ...(d.rtwOffered
                          ? {
                              rtwRequestedOn: form.rtwRequestedOn || null,
                              referralOn: form.referralOn || null,
                              caseManager: form.cmName.trim() ? { name: form.cmName, phone: form.cmPhone } : null,
                            }
                          : {}),
                        plan: form.plan,
                        targetReturn: form.targetReturn || null,
                      }),
                    'Saved.',
                  );
                  if (ok) setEdit(false);
                }}
              >
                Save
              </button>
              <button className="btn btn-sm" onClick={() => setEdit(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="sx-sec">
        <h3>Work restrictions</h3>
        <p className="muted small">The roster will not place the person against an open restriction until HR clears it.</p>
        {r.restrictions.length === 0 ? (
          <p className="muted small">No restriction.</p>
        ) : (
          <div className="sx-box">
            <ul className="hx-rows">
              {r.restrictions.map((x) => (
                <li key={x.id} className="hx-row" data-tone={x.clearedAt ? undefined : 'warn'}>
                  <div className="hx-row-main">
                    <span className="hx-row-title">{SOCSO_RESTRICTION_LABEL[x.kind]}</span>
                    <span className="hx-row-meta">
                      From {dateLabel(x.from)}
                      {x.until ? `, doctor's date ${dateLabel(x.until)}` : ''}
                      {x.note ? ` · ${x.note}` : ''} · set by {x.setBy}
                    </span>
                    {x.clearedAt && (
                      <span className="hx-row-meta">
                        Cleared by {x.clearedBy}, {dateTimeLabel(x.clearedAt)}: {x.clearNote}
                      </span>
                    )}
                  </div>
                  <div className="hx-row-side">
                    <Chip tone={x.clearedAt ? 'neutral' : 'warn'}>{x.clearedAt ? 'Cleared' : 'Open'}</Chip>
                  </div>
                  <div className="hx-row-body">
                    {manage && !x.clearedAt && clearing !== x.id && (
                      <div className="hx-row-actions">
                        <button className="btn btn-sm" onClick={() => setClearing(x.id)}>
                          Clear
                        </button>
                      </div>
                    )}
                    {clearing === x.id && (
                      <div className="hx-form">
                        <label className="field">
                          <span className="label">Why it is cleared</span>
                          <input
                            className="input"
                            aria-label="Why it is cleared"
                            placeholder="Why, such as the fitness to work certificate"
                            value={clearNote}
                            onChange={(e) => setClearNote(e.target.value)}
                          />
                        </label>
                        <ErrorNotice error={act.error} />
                        <div className="hx-form-actions">
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={act.busy || clearNote.trim().length < 5}
                            onClick={async () => {
                              const ok = await act.run(() => api.clearSocsoRestriction(c.id, x.id, clearNote), 'Restriction cleared.');
                              if (ok) {
                                setClearing(null);
                                setClearNote('');
                              }
                            }}
                          >
                            Save
                          </button>
                          <button className="btn btn-sm" onClick={() => setClearing(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {manage && (
          <div className="hx-form">
            <h4 className="hx-form-title">Add a restriction</h4>
            <div className="hx-form-grid">
              <label className="field">
                <span className="label">New restriction</span>
                <select
                  className="select"
                  aria-label="Restriction"
                  value={rs.kind}
                  onChange={(e) => setRs({ ...rs, kind: e.target.value as SocsoRestrictionKind })}
                >
                  {RESTRICTIONS.map((k) => (
                    <option key={k} value={k}>
                      {SOCSO_RESTRICTION_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="label">From</span>
                <input className="input" type="date" aria-label="Restriction from" value={rs.from} onChange={(e) => setRs({ ...rs, from: e.target.value })} />
              </label>
              <label className="field">
                <span className="label">Doctor's last day</span>
                <input
                  className="input"
                  type="date"
                  aria-label="Restriction until"
                  value={rs.until}
                  onChange={(e) => setRs({ ...rs, until: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="label">Note</span>
                <input
                  className="input"
                  aria-label="Restriction note"
                  placeholder="From the doctor's note"
                  value={rs.note}
                  onChange={(e) => setRs({ ...rs, note: e.target.value })}
                />
              </label>
            </div>
            <div className="hx-form-actions">
              <button
                className="btn btn-sm"
                disabled={act.busy || !rs.from}
                onClick={() =>
                  act.run(() => api.addSocsoRestriction(c.id, { kind: rs.kind, note: rs.note, from: rs.from, until: rs.until || null }), 'Restriction added.')
                }
              >
                Add restriction
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="sx-sec">
        <h3>Appointments</h3>
        {r.appointments.length === 0 ? (
          <p className="muted small">No appointment.</p>
        ) : (
          <ul className="sx-lines">
            {r.appointments.map((a) => (
              <li key={a.id}>
                <b>{dateTimeLabel(a.at)}</b> · {a.what}
              </li>
            ))}
          </ul>
        )}
        {manage && (
          <div className="sx-inline">
            <input
              className="input"
              type="datetime-local"
              aria-label="Appointment time"
              value={appt.at}
              onChange={(e) => setAppt({ ...appt, at: e.target.value })}
            />
            <input
              className="input"
              aria-label="Appointment for"
              placeholder="Clinic review, physiotherapy…"
              value={appt.what}
              onChange={(e) => setAppt({ ...appt, what: e.target.value })}
            />
            <button
              className="btn btn-sm"
              disabled={act.busy || !appt.at || appt.what.trim().length < 3}
              onClick={async () => {
                const ok = await act.run(() => api.addSocsoAppointment(c.id, { at: `${appt.at}:00+08:00`, what: appt.what }), 'Appointment added.');
                if (ok) setAppt({ at: '', what: '' });
              }}
            >
              Add
            </button>
          </div>
        )}
      </section>

      <section className="sx-sec">
        <h3>Weekly check-ins</h3>
        <p className="muted small">
          The officer calls every week while the person is off, and for the first month back.
          {d.checkIn ? ` Next one ${d.checkIn.overdue ? 'is overdue since' : 'due'} ${dateLabel(d.checkIn.due)}.` : ''}
        </p>
        {r.checkIns.length === 0 ? (
          <p className="muted small">No check-in yet.</p>
        ) : (
          <ol className="sx-history">
            {[...r.checkIns].reverse().map((k, i) => (
              <li key={i}>
                <span>{k.note}</span>
                <span className="muted small">
                  {k.by}, {dateTimeLabel(k.at)}
                </span>
              </li>
            ))}
          </ol>
        )}
        {d.can.addIncident && (
          <div className="sx-inline">
            <input
              className="input"
              aria-label="Check-in note"
              placeholder="How the person is doing"
              value={checkIn}
              onChange={(e) => setCheckIn(e.target.value)}
            />
            <button
              className="btn btn-sm"
              disabled={act.busy || checkIn.trim().length < 5}
              onClick={async () => {
                const ok = await act.run(() => api.addSocsoCheckIn(c.id, checkIn), 'Check-in recorded.');
                if (ok) setCheckIn('');
              }}
            >
              Record
            </button>
          </div>
        )}
      </section>
      <ErrorNotice error={!edit && !clearing ? act.error : null} />
    </div>
  );
}
