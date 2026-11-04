import { useMemo, useState } from 'react';
import type { ProofInput } from '@prima/core';
import { api, type ItBoard } from '../api';
import { saveFile } from '../save';
import { Chip, notify, Drawer, ErrorNotice, Kpi, dateLabel, dateTimeLabel, useAction } from '../ui';
import { ProofPicker } from './Proof';
import { useApp } from '../App';
import { JobEmails } from '../connections/mail/job-emails';
import { jobEmailClient } from '../connections/mail/job-emails-client';
import { TenderStepsMine } from './ItPilot';

/**
 * The IT pilot (Fauzan, 28 Oct 2026): "how to edit what to do, how to make sure they do the job given", with the COO
 * monitoring and the CEO overseeing. The IT Manager supervises and is not technical: gives jobs, chases them and
 * accepts the proof. The IT Lead is technical: he checks technical jobs. The CEO owns every system and decides access.
 */

type JobRow = NonNullable<ItBoard['jobs']>[number];
type Job = JobRow['job'];
type TicketRow = NonNullable<ItBoard['tickets']>[number];

export const JOB_KIND: Record<Job['kind'], string> = {
  task: 'Task',
  install: 'Install or set up',
  check: 'Check',
  training: 'Training (Microsoft 365)',
  access: 'Accounts and access',
  other: 'Other',
};
const JOB_STATUS: Record<Job['status'], [Parameters<typeof Chip>[0]['tone'], string]> = {
  todo: ['warn', 'Not started'],
  doing: ['info', 'Being done'],
  submitted: ['info', 'Done, to check'],
  checked: ['info', 'IT Lead checked'],
  accepted: ['ok', 'Accepted'],
  returned: ['crit', 'Sent back'],
  cancelled: ['unknown', 'Cancelled'],
};
const ROLE: Record<string, string> = { manager: 'IT Manager', lead: 'IT Lead', executive: 'IT Executive' };
const today = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

function waitingText(r: JobRow): string {
  const j = r.job;
  if ((j.status === 'submitted' || j.status === 'checked') && r.nextCheck) return r.nextCheck;
  if (j.status === 'returned') return `Sent back to ${j.assignee}`;
  if (j.status === 'accepted') return `Accepted by ${j.acceptedBy}${r.acceptedLate ? ' (submitted late)' : ''}`;
  if (j.status === 'cancelled') return 'Cancelled';
  return `With ${j.assignee}`;
}

function lateChip(r: JobRow) {
  if (!r.lateDays) return null;
  const who = r.level === 'ceo' ? 'CEO sees it' : r.level === 'coo' ? 'COO sees it' : 'IT Manager sees it';
  return <Chip tone={r.level === 'manager' ? 'warn' : 'crit'}>{`${r.lateDays} day${r.lateDays === 1 ? '' : 's'} late · ${who}`}</Chip>;
}

export function JobLine({ r, onOpen }: { r: JobRow; onOpen: () => void }) {
  const j = r.job;
  return (
    <button className="list-item" style={{ width: '100%', textAlign: 'left', flexWrap: 'wrap', gap: 6 }} onClick={onOpen}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>
          {j.ref} · {j.title}
        </div>
        <div className="muted small">
          {JOB_KIND[j.kind]} · {j.priority} · {j.assignee} · due {dateLabel(j.dueOn)} · {waitingText(r)}
          {j.technical ? ' · technical' : ''}
          {j.returns ? ` · sent back ${j.returns}×` : ''}
        </div>
      </div>
      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
        {lateChip(r)}
        <Chip tone={JOB_STATUS[j.status][0]}>{JOB_STATUS[j.status][1]}</Chip>
      </div>
    </button>
  );
}

/** Jobs: give a job, follow every job, filter by what needs attention. */
export function Jobs({ data }: { data: ItBoard }) {
  const [filter, setFilter] = useState<'open' | 'late' | 'check' | 'done' | 'all'>('open');
  const [who, setWho] = useState('');
  const [form, setForm] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const rows = (data.jobs ?? []).filter(
    (r) =>
      (!who || r.job.assigneeId === who) &&
      (filter === 'all' ||
        (filter === 'open' && r.open) ||
        (filter === 'late' && r.lateDays > 0) ||
        (filter === 'check' && (r.job.status === 'submitted' || r.job.status === 'checked')) ||
        (filter === 'done' && r.job.status === 'accepted')),
  );
  const row = (data.jobs ?? []).find((r) => r.job.id === open) ?? null;
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h3>IT jobs</h3>
          {data.assigner && (
            <button className="btn btn-sm btn-primary" onClick={() => setForm(!form)}>
              Give a job
            </button>
          )}
        </div>
        <p className="muted small">
          Every job has one named person and a due date. It is finished only when it is submitted with proof and accepted by the IT Manager; a
          technical job is checked by the IT Lead first, and the IT Manager checks the proof of the IT Lead’s own technical jobs. Nobody checks or accepts their own work. The COO may accept or return any job, and whoever was in charge of checking it is told. A job {data.jobRule.cooAfterDays} days late goes to the COO,
          and {data.jobRule.ceoAfterDays} days late to the CEO.
        </p>
        {form && <GiveJob data={data} onDone={() => setForm(false)} />}
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <select className="select" aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="open">Open</option>
            <option value="late">Late</option>
            <option value="check">Waiting for a check</option>
            <option value="done">Accepted</option>
            <option value="all">All</option>
          </select>
          <select className="select" aria-label="Person" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Everyone</option>
            {(data.team ?? [])
              .filter((t) => t.itRole !== 'manager')
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </div>
        <div className="list">
          {!rows.length && <div className="empty">Nothing here.</div>}
          {rows.map((r) => (
            <JobLine key={r.job.id} r={r} onOpen={() => setOpen(r.job.id)} />
          ))}
        </div>
      </section>
      {row && <JobDrawer data={data} r={row} onClose={() => setOpen(null)} />}
    </>
  );
}

function doers(data: ItBoard) {
  return (data.team ?? []).filter((t) => t.itRole !== 'manager');
}

/** Regular work from the IT plan, filled in for the manager to check and give. */
export type JobPreset = { kind: Job['kind']; title: string; detail: string; dueOn: string; technical: boolean; planKey: string };

export function GiveJob({ data, onDone, preset }: { data: ItBoard; onDone: () => void; preset?: JobPreset }) {
  const act = useAction();
  const [kind, setKind] = useState<Job['kind']>(preset?.kind ?? 'task');
  const [title, setTitle] = useState(preset?.title ?? '');
  const [detail, setDetail] = useState(preset?.detail ?? '');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueOn, setDueOn] = useState(preset && preset.dueOn > today() ? preset.dueOn : today());
  const [priority, setPriority] = useState<'P1' | 'P2' | 'P3'>('P3');
  const [technical, setTechnical] = useState(preset?.technical ?? false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
      <input className="input" aria-label="Job" placeholder="What has to be done" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="input" aria-label="Details" placeholder="Details: where, for whom, what counts as done" value={detail} onChange={(e) => setDetail(e.target.value)} />
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <select className="select" aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as Job['kind'])}>
          {(Object.keys(JOB_KIND) as Job['kind'][]).map((k) => (
            <option key={k} value={k}>
              {JOB_KIND[k]}
            </option>
          ))}
        </select>
        <select className="select" aria-label="Give to" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
          <option value="">Give to…</option>
          {doers(data).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select className="select" aria-label="Urgency" value={priority} onChange={(e) => setPriority(e.target.value as 'P1' | 'P2' | 'P3')}>
          <option value="P1">P1 urgent</option>
          <option value="P2">P2 soon</option>
          <option value="P3">P3 normal</option>
        </select>
        <label className="row small" style={{ gap: 4 }}>
          Due
          <input className="input" type="date" aria-label="Due" value={dueOn} min={today()} onChange={(e) => setDueOn(e.target.value)} />
        </label>
      </div>
      <label className="row small" style={{ gap: 6 }}>
        <input type="checkbox" checked={technical} onChange={(e) => setTechnical(e.target.checked)} />
        <span>Technical: the IT Lead checks it before the IT Manager accepts it</span>
      </label>
      <button
        className="btn btn-primary btn-sm"
        disabled={act.busy || !title.trim() || !assigneeId}
        onClick={() =>
          act
            .run(() => api.itAct('giveJob', { kind, title, detail, assigneeId, dueOn, priority, technical, planKey: preset?.planKey }), 'Job given.')
            .then((r) => r && onDone())
        }
      >
        Give the job
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

export function JobDrawer({ data, r, onClose }: { data: ItBoard; r: JobRow; onClose: () => void }) {
  const {me}=useApp();
  const emailClient=useMemo(()=>jobEmailClient((...args)=>api.m365Call(me.user.id,...args)),[me.user.id]);
  // The COO may decide anyone's IT job, always with a reason; whoever was in charge is told (Fauzan, 31 Oct 2026).
  const coo = data.role === 'coo' || data.role === 'view'; // The CEO's IT role is 'view'; he has full authority (Fauzan, 31 Oct 2026).
  const act = useAction();
  const j = r.job;
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const [edit, setEdit] = useState(false);
  const step = (s: string, ok: string) =>
    act.run(() => api.itAct('jobStep', { id: j.id, step: s, note, proof: s === 'submit' ? proof : [] }), ok).then((x) => {
      if (x) {
        setNote('');
        setProof([]);
      }
    });
  const download = async (sha256: string, name: string) => {
    const f = (await act.run(() => api.itAct('jobProof', { id: j.id, sha256 }))) as { data: string } | undefined;
    if (f) {
      const m = await saveFile(name, f.data);
      if (m) notify(m);
    }
  };
  const c = r.can;
  return (
    <Drawer title={`${j.ref} · ${j.title}`} sub={`${JOB_KIND[j.kind]} · ${j.priority}${j.technical ? ' · technical' : ''}`} onClose={onClose}>
      <ErrorNotice error={act.error} />
      <JobEmails key={`${me.user.id}:${j.id}`} client={emailClient} userId={me.user.id} jobId={j.id} />
      <section className="panel">
        <div className="list">
          <div className="list-item">
            <span>Status</span>
            <span className="row" style={{ gap: 4 }}>
              {lateChip(r)}
              <Chip tone={JOB_STATUS[j.status][0]}>{JOB_STATUS[j.status][1]}</Chip>
            </span>
          </div>
          <div className="list-item">
            <span>Doer</span>
            <span>{j.assignee}</span>
          </div>
          <div className="list-item">
            <span>Given by</span>
            <span>
              {j.givenBy}, {dateTimeLabel(j.at)}
            </span>
          </div>
          <div className="list-item">
            <span>Due</span>
            <span>{dateLabel(j.dueOn)}</span>
          </div>
          <div className="list-item">
            <span>Next</span>
            <span>{waitingText(r)}</span>
          </div>
        </div>
        {j.detail && <p className="small">{j.detail}</p>}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Proof</h3>
        </div>
        <div className="list">
          {!j.proof.length && <div className="empty">No proof yet. A job cannot be submitted without it.</div>}
          {j.proof.map((p) => (
            <div key={p.sha256} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
              <button className="link-button" style={{ fontWeight: 600, textAlign: 'left' }} onClick={() => void download(p.sha256, p.name)}>
                {p.name}
              </button>
              <div className="muted small">
                {p.by}, {dateTimeLabel(p.at)} · SHA-256 {p.sha256.slice(0, 12)}…
              </div>
            </div>
          ))}
        </div>
      </section>
      {(c.start || c.submit || c.check || c.accept || c.back || c.cancel || c.note) && (
        <section className="panel">
          <div className="panel-head">
            <h3>Act</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <textarea
              className="input"
              aria-label="Note"
              placeholder={
                c.submit ? 'What was done (needed to submit)' : coo && (c.accept || c.back) ? 'Why you decide in place of the person in charge (needed)' : c.accept || c.back ? 'What is missing (needed to send back)' : 'Note or update'
              }
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {c.submit && <ProofPicker site={null} refText={j.ref} items={proof} onChange={setProof} documentsOnly required />}
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {c.start && (
                <button className="btn btn-sm" disabled={act.busy} onClick={() => void step('start', 'Started.')}>
                  Start
                </button>
              )}
              {c.submit && (
                <button className="btn btn-sm btn-primary" disabled={act.busy || !note.trim() || !proof.length} onClick={() => void step('submit', 'Submitted with proof.')}>
                  Submit as done
                </button>
              )}
              {c.check && (
                <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => void step('check', 'Technical check passed.')}>
                  Technical check passed
                </button>
              )}
              {c.accept && (
                <button className="btn btn-sm btn-primary" disabled={act.busy || (coo && !note.trim())} onClick={() => void step('accept', 'Accepted.')}>
                  Accept
                </button>
              )}
              {c.back && (
                <button className="btn btn-sm" disabled={act.busy || note.trim().length < 5} onClick={() => void step('return', 'Sent back.')}>
                  Send back
                </button>
              )}
              {c.note && (
                <button className="btn btn-sm" disabled={act.busy || !note.trim()} onClick={() => void step('note', 'Note added.')}>
                  Add note
                </button>
              )}
              {c.cancel && (
                <button className="btn btn-sm" disabled={act.busy || note.trim().length < 5} onClick={() => void step('cancel', 'Cancelled.')}>
                  Cancel job
                </button>
              )}
              {c.edit && (
                <button className="btn btn-sm" onClick={() => setEdit(!edit)}>
                  Change the job
                </button>
              )}
            </div>
          </div>
        </section>
      )}
      {edit && <EditJob data={data} j={j} onDone={() => setEdit(false)} />}
      <section className="panel">
        <div className="panel-head">
          <h3>History</h3>
        </div>
        <div className="list">
          <div className="list-item">
            <span>Given to {j.assignee}</span>
            <span className="muted small">
              {dateTimeLabel(j.at)} · {j.givenBy}
            </span>
          </div>
          {j.log.map((l, i) => (
            <div key={i} className="list-item">
              <span>
                {
                  {
                    start: 'Started',
                    note: 'Note',
                    submit: 'Submitted',
                    check: 'IT Lead check passed',
                    accept: 'Accepted',
                    return: 'Sent back',
                    edit: 'Changed',
                    cancel: 'Cancelled',
                  }[l.what]
                }
                {l.note ? `: ${l.note}` : ''}
              </span>
              <span className="muted small">
                {dateTimeLabel(l.at)} · {l.by}
              </span>
            </div>
          ))}
        </div>
      </section>
    </Drawer>
  );
}

function EditJob({ data, j, onDone }: { data: ItBoard; j: Job; onDone: () => void }) {
  const act = useAction();
  const [title, setTitle] = useState(j.title);
  const [detail, setDetail] = useState(j.detail);
  const [dueOn, setDueOn] = useState(j.dueOn < today() ? today() : j.dueOn);
  const [assigneeId, setAssigneeId] = useState(j.assigneeId);
  const [priority, setPriority] = useState(j.priority);
  const [technical, setTechnical] = useState(j.technical);
  const [reason, setReason] = useState('');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Change the job</h3>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input className="input" aria-label="Job" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="input" aria-label="Details" value={detail} onChange={(e) => setDetail(e.target.value)} />
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <select className="select" aria-label="Doer" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            {doers(data).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select className="select" aria-label="Urgency" value={priority} onChange={(e) => setPriority(e.target.value as 'P1' | 'P2' | 'P3')}>
            <option value="P1">P1 urgent</option>
            <option value="P2">P2 soon</option>
            <option value="P3">P3 normal</option>
          </select>
          <input className="input" type="date" aria-label="Due" value={dueOn} min={today()} onChange={(e) => setDueOn(e.target.value)} />
        </div>
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" checked={technical} onChange={(e) => setTechnical(e.target.checked)} />
          <span>Technical (IT Lead checks)</span>
        </label>
        <input className="input" aria-label="Why" placeholder="Why it is changed (kept in the history)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy || reason.trim().length < 3}
          onClick={() =>
            act
              .run(
                () =>
                  api.itAct('editJob', {
                    id: j.id,
                    reason,
                    patch: {
                      title,
                      detail,
                      dueOn: dueOn !== j.dueOn ? dueOn : undefined,
                      assigneeId: assigneeId !== j.assigneeId ? assigneeId : undefined,
                      priority,
                      technical,
                    },
                  }),
                'Job changed.',
              )
              .then((x) => x && onDone())
          }
        >
          Save the change
        </button>
        <ErrorNotice error={act.error} />
      </div>
    </section>
  );
}

/** Assign a help request, a joiner or leaver, or a tender's IT part to one person. */
export function AssignPick({ data, current, onPick, busy }: { data: ItBoard; current: string | null | undefined; onPick: (id: string) => void; busy: boolean }) {
  return (
    <select className="select" aria-label="Give to" value={current ?? ''} disabled={busy} onChange={(e) => e.target.value && onPick(e.target.value)}>
      <option value="">{current ? 'Give to…' : 'Nobody yet: give to…'}</option>
      {doers(data).map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}

/** Everything given to me, and for the IT Manager and IT Lead what waits for their check. */
export function MyWork({ data, openTab }: { data: ItBoard; openTab: (t: 'jobs' | 'tickets' | 'onboarding' | 'tenders') => void }) {
  const act = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const w = data.myWork;
  if (!w) return null;
  const row = (data.jobs ?? []).find((r) => r.job.id === open) ?? null;
  const manager = data.role === 'manager';
  const late = manager ? (data.jobs ?? []).filter((r) => r.lateDays > 0 && !r.can.accept && r.job.status !== 'submitted') : [];
  const nothing = !w.jobs.length && !w.toCheck.length && !w.tickets.length && !w.unassigned.length && !w.onboarding.length && !w.tenders.length && !late.length && !(w.tenderSteps ?? []).length && !(w.cooNotices ?? []).length;
  return (
    <>
      <p className="muted small">
        {manager
          ? 'You make sure the team does the job: give work, check the proof and accept or return it (the IT Lead’s jobs too), and chase what is late.'
          : data.lead
            ? 'Your jobs, and the technical checks waiting for you. You also give out help requests and jobs.'
            : 'Everything given to you. Submit each job with proof; the IT Manager accepts it.'}
      </p>
      <ErrorNotice error={act.error} />
      {nothing && <div className="empty">Nothing is waiting for you.</div>}
      <TenderStepsMine data={data} openTab={() => openTab('tenders')} />
      {(w.cooNotices ?? []).length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>The COO or CEO decided these</h3>
          </div>
          <div className="list">
            {(w.cooNotices ?? []).map((n) => (
              <div key={n.noticeId} className="list-item" style={{ flexWrap: 'wrap', gap: 6 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {n.ref} · {n.title}
                  </div>
                  <div className="muted small">
                    {n.by} {n.what === 'accept' ? 'accepted it' : 'sent it back'} · {dateTimeLabel(n.at)}
                    {n.note ? ` · ${n.note}` : ''}
                  </div>
                </div>
                <button className="btn btn-sm" disabled={act.busy} onClick={() => void act.run(() => api.itAct('seenNotice', { id: n.jobId, noticeId: n.noticeId }), 'Noted.')}>
                  Seen
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {w.toCheck.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>{manager ? 'Done, for you to accept' : 'For your technical check'}</h3>
          </div>
          <div className="list">
            {w.toCheck.map((r) => (
              <JobLine key={r.job.id} r={r} onOpen={() => setOpen(r.job.id)} />
            ))}
          </div>
        </section>
      )}
      {late.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>Late jobs to chase</h3>
          </div>
          <div className="list">
            {late.map((r) => (
              <JobLine key={r.job.id} r={r} onOpen={() => setOpen(r.job.id)} />
            ))}
          </div>
        </section>
      )}
      {w.unassigned.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>Help requests nobody has</h3>
          </div>
          <div className="list">
            {w.unassigned.map((t) => (
              <div key={t.ticket.id} className="list-item" style={{ flexWrap: 'wrap', gap: 6 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {t.ticket.ref} · {t.ticket.title}
                  </div>
                  <div className="muted small">
                    {t.ticket.priority} · {t.ticket.raisedBy} · due {dateTimeLabel(t.due)}
                  </div>
                </div>
                <AssignPick data={data} current={null} busy={act.busy} onPick={(id) => void act.run(() => api.itAct('assignTicket', { id: t.ticket.id, toId: id }), 'Given.')} />
              </div>
            ))}
          </div>
        </section>
      )}
      {w.jobs.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>My jobs</h3>
          </div>
          <div className="list">
            {w.jobs.map((r) => (
              <JobLine key={r.job.id} r={r} onOpen={() => setOpen(r.job.id)} />
            ))}
          </div>
        </section>
      )}
      {w.tickets.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>My help requests</h3>
            <button className="btn btn-sm" onClick={() => openTab('tickets')}>
              Open
            </button>
          </div>
          <div className="list">
            {w.tickets.map((t: TicketRow) => (
              <div key={t.ticket.id} className="list-item">
                <span>
                  {t.ticket.ref} · {t.ticket.title}
                </span>
                <Chip tone={t.breached ? 'crit' : 'info'}>{t.breached ? 'Past time limit' : `due ${dateTimeLabel(t.due)}`}</Chip>
              </div>
            ))}
          </div>
        </section>
      )}
      {(w.onboarding.length > 0 || w.tenders.length > 0) && (
        <section className="panel">
          <div className="panel-head">
            <h3>Joiners, leavers and tenders given to me</h3>
          </div>
          <div className="list">
            {w.onboarding.map((o) => (
              <button key={o.item.id} className="list-item" style={{ width: '100%', textAlign: 'left' }} onClick={() => openTab('onboarding')}>
                <span>
                  {o.item.personName} · {o.item.kind === 'join' ? 'joins' : 'leaves'} {dateLabel(o.item.on)}
                </span>
                <Chip tone={o.late ? 'crit' : 'warn'}>{o.open} to do</Chip>
              </button>
            ))}
            {w.tenders.map((t) => (
              <button key={t.task.id} className="list-item" style={{ width: '100%', textAlign: 'left' }} onClick={() => openTab('tenders')}>
                <span>{t.task.title}</span>
                <Chip tone={t.daysLeft <= 3 ? 'crit' : 'warn'}>{`${t.open} to fill · ${t.daysLeft} days`}</Chip>
              </button>
            ))}
          </div>
        </section>
      )}
      {row && <JobDrawer data={data} r={row} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Each person's record for the last 30 days: for the IT Manager, the IT Lead, the COO and the CEO. */
export function Team({ data }: { data: ItBoard }) {
  const k = data.kpis!;
  const rows = data.teamRows ?? [];
  return (
    <>
      <div className="kpis">
        <Kpi label="Jobs open" value={k.jobsOpen} note={`${k.jobsWaitingCheck} waiting for a check`} />
        <Kpi label="Jobs late" value={k.jobsLate} tone={k.jobsLate ? 'crit' : 'ok'} note={`${k.jobsToCoo} gone to the COO or CEO`} />
        <Kpi label="Help requests late" value={k.ticketsLate} tone={k.ticketsLate ? 'crit' : 'ok'} note={`${k.ticketsUnassigned} not given to anyone`} />
        <Kpi label="Access for the CEO" value={k.accessWaiting} tone={k.accessWaiting ? 'warn' : 'ok'} note={`${k.accessReviewDue} systems due for review`} />
      </div>
      <section className="panel">
        <div className="panel-head">
          <h3>Who is doing what (last 30 days)</h3>
        </div>
        <p className="muted small">
          On time means accepted jobs submitted by the due date and help requests fixed within their time limit. Sent back counts work the IT Manager
          or IT Lead returned. Reopened counts fixes the person who asked said did not work. Tender steps counts eP tender steps finished, and how many took
          longer than their minutes.
        </p>
        <div className="table-wrap" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Jobs open</th>
                <th>Late</th>
                <th>To check</th>
                <th>Done</th>
                <th>Sent back</th>
                <th>Help open</th>
                <th>Help late</th>
                <th>Help fixed</th>
                <th>Reopened</th>
                <th>On time</th>
                <th>Tender steps</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    <div className="muted small">{ROLE[r.itRole ?? ''] ?? ''}</div>
                  </td>
                  {r.itRole === 'manager' ? (
                    <td colSpan={10} className="muted small">
                      Supervises: gives work and accepts it. Not given jobs.
                    </td>
                  ) : (
                    <>
                      <td>{r.jobsOpen}</td>
                      <td>{r.jobsLate ? <Chip tone="crit">{r.jobsLate}</Chip> : 0}</td>
                      <td>{r.waitingCheck}</td>
                      <td>{r.jobsDone}</td>
                      <td>{r.sentBack}</td>
                      <td>{r.ticketsOpen}</td>
                      <td>{r.ticketsLate ? <Chip tone="crit">{r.ticketsLate}</Chip> : 0}</td>
                      <td>{r.ticketsDone}</td>
                      <td>{r.reopened}</td>
                      <td>{r.onTimePct == null ? <Chip tone="unknown">No work yet</Chip> : <Chip tone={r.onTimePct >= 90 ? 'ok' : r.onTimePct >= 75 ? 'warn' : 'crit'}>{`${r.onTimePct}%`}</Chip>}</td>
                    </>
                  )}
                  <td>
                    {r.tenderSteps}
                    {r.tenderStepsLate ? (
                      <>
                        {' '}
                        <Chip tone="warn">{`${r.tenderStepsLate} over time`}</Chip>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/** Every system the group runs: the CEO owns it and decides who may sign in; IT only operates (Fauzan, 28 Oct 2026). */
export function Systems({ data }: { data: ItBoard }) {
  const act = useAction();
  const staff = data.role === 'manager' || data.role === 'team';
  const [ask, setAsk] = useState<string | null>(null);
  const [note, setNote] = useState('');
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h3>Recorded access requests for the CEO</h3>
        </div>
        <ErrorNotice error={act.error} />
        <div className="list">
          {!(data.accessRequests ?? []).length && <div className="empty">None.</div>}
          {(data.accessRequests ?? []).map((r) => (
            <div key={r.request.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {r.request.ref} · {r.request.action === 'grant' ? `Give ${r.request.name} ${r.request.level} access` : `Remove ${r.request.name}`} · {r.system}
                  </div>
                  <div className="muted small">
                    Asked by {r.request.askedBy}, {dateTimeLabel(r.request.at)} · {r.request.reason}
                    {r.request.decidedBy ? ` · ${r.request.decidedBy}${r.request.decisionNote ? `: ${r.request.decisionNote}` : ''}` : ''}
                  </div>
                </div>
                <Chip tone={r.request.status === 'waiting' ? 'warn' : r.request.status === 'approved' ? 'ok' : 'crit'}>
                  {r.request.status === 'waiting' ? 'With the CEO' : r.request.status === 'approved' ? 'Approved' : 'Rejected'}
                </Chip>
              </div>
              {r.canDecide && (
                <>
                  <input className="input" aria-label="Note" placeholder="Note (needed to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => void act.run(() => api.itAct('decideAccess', { id: r.request.id, approve: true, note }), 'Approval recorded. Apply and verify external access separately.')}>
                      Approve
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={act.busy || !note.trim()}
                      onClick={() => void act.run(() => api.itAct('decideAccess', { id: r.request.id, approve: false, note }), 'Rejected.')}
                    >
                      Reject
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Systems and recorded access</h3>
        </div>
        <p className="muted small">
          The CEO is the owner and master administrator of every system, domain and account. IT staff only operate them with approved access. This register records decisions; it does not grant or revoke access in Microsoft or other systems.
          Passwords are never kept here; only where the CEO’s master sign-in and recovery codes are kept. The CEO confirms each list every{' '}
          {data.jobRule.accessReviewDays} days.
        </p>
        <div className="list">
          {(data.accounts ?? []).map((a) => (
            <div key={a.account.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{a.account.name}</div>
                  <div className="muted small">
                    Owner {a.account.owner} · master sign-in kept: {a.account.masterKeptAt} · two-step sign-in{' '}
                    {a.account.mfa == null ? 'unknown' : a.account.mfa ? 'on' : 'OFF'}
                    {a.account.note ? ` · ${a.account.note}` : ''}
                  </div>
                  <div className="muted small">
                    {a.account.access.length ? a.account.access.map((x) => `${x.name} (${x.level})`).join(', ') : 'No IT access recorded; external permissions are not verified'}
                  </div>
                </div>
                <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                  {a.notOwnedByCeo && <Chip tone="crit">Not owned by the CEO</Chip>}
                  {a.account.mfa === false && <Chip tone="crit">Two-step sign-in off</Chip>}
                  <Chip tone={a.reviewDue ? 'warn' : 'ok'}>{a.reviewDue ? 'Review due' : `Reviewed ${dateLabel(a.account.reviewedOn!)}`}</Chip>
                </div>
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {data.ceo && (
                  <button className="btn btn-sm" disabled={act.busy} onClick={() => void act.run(() => api.itAct('reviewAccount', { id: a.account.id }), 'Recorded access list reviewed; external permissions still require verification.')}>
                    Confirm the recorded list
                  </button>
                )}
                {staff && (
                  <button className="btn btn-sm" onClick={() => setAsk(ask === a.account.id ? null : a.account.id)}>
                    Ask the CEO to change access
                  </button>
                )}
              </div>
              {ask === a.account.id && <AskAccess data={data} accountId={a.account.id} onDone={() => setAsk(null)} />}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function AskAccess({ data, accountId, onDone }: { data: ItBoard; accountId: string; onDone: () => void }) {
  const act = useAction();
  const [action, setAction] = useState<'grant' | 'remove'>('grant');
  const [userId, setUserId] = useState('');
  const [level, setLevel] = useState<'operator' | 'admin'>('operator');
  const [reason, setReason] = useState('');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <select className="select" aria-label="Change" value={action} onChange={(e) => setAction(e.target.value as 'grant' | 'remove')}>
          <option value="grant">Give access</option>
          <option value="remove">Remove access</option>
        </select>
        <select className="select" aria-label="Person" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Person…</option>
          {(data.people ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {action === 'grant' && (
          <select className="select" aria-label="Level" value={level} onChange={(e) => setLevel(e.target.value as 'operator' | 'admin')}>
            <option value="operator">Operator</option>
            <option value="admin">Administrator</option>
          </select>
        )}
      </div>
      <input className="input" aria-label="Why" placeholder="Why" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button
        className="btn btn-sm btn-primary"
        disabled={act.busy || !userId || reason.trim().length < 5}
        onClick={() => act.run(() => api.itAct('askAccess', { accountId, action, userId, level, reason }), 'Sent to the CEO.').then((x) => x && onDone())}
      >
        Send to the CEO
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}
