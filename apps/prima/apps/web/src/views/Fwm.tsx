import { useState } from 'react';
import { FWM_TASK_LABEL, FW_LEVEL_LABEL, type FwmTaskKind, type FwPaper, type ProofInput } from '@prima/core';
import { api, type FwmBoard } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { CooNoticesPanel } from './CooNotices';
import { DocList, ProofPicker } from './Proof';

/**
 * Foreign Worker Management (Fauzan, 26 Oct 2026). FWM renews every foreign worker's papers and sends the OMs dated
 * tasks; reminders run at 120, 90, 60, 30 and 15 days (15 is urgent) and escalate FWM, Chief of Staff, COO, CEO, with
 * the CEO told 7 days before expiry. A renewal submitted with its receipt pauses the ladder.
 */

type Item = FwmBoard['items'][number];
type TaskRow = FwmBoard['tasks'][number];

const KINDS: FwmTaskKind[] = ['FOMEMA', 'JIM', 'TNG', 'BIOMETRIC', 'OTHER'];

function today(): string {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
}

function stageTone(i: Item): Tone {
  if (!i.stage) return 'unknown';
  if (i.stage.paused) return 'info';
  if (i.stage.step === 0 || i.stage.urgent) return 'crit';
  if ((i.stage.step ?? 999) <= 60) return 'warn';
  return 'neutral';
}

export function FwmView() {
  const { data, error } = useLoad(() => api.fwmBoard(), []);
  const [tab, setTab] = useState<'papers' | 'year10' | 'tasks' | null>(null);
  const [mine, setMine] = useState(true);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="foreign workers" />;
  const board = data.role !== 'om' && data.role !== 'despatch';
  const view = tab ?? (board ? 'papers' : 'tasks');
  const forMeFirst = data.role === 'escalation' && mine;
  const items = forMeFirst ? data.items.filter((i) => i.forMe) : data.items;
  const openTasks = data.tasks.filter((t) => t.task.status !== 'accepted').length;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Foreign workers</h1>
        <p className="muted">
          {data.role === 'om'
            ? 'Tasks from Foreign Worker Management: get the guard there, then send the proof.'
            : 'Foreign Worker Management renews permits, passports, FOMEMA and insurance, and sends the OMs dated tasks.'}
        </p>
      </div>
      <CooNoticesPanel notices={data.cooNotices} />
      {board && (
        <div className="kpis">
          {data.level && data.level !== 'FWM' && (
            <Kpi label={`Reached ${FW_LEVEL_LABEL[data.level]}`} value={data.counts.forMe} tone={data.counts.forMe ? 'crit' : 'ok'} />
          )}
          <Kpi label="Expired or urgent" value={data.counts.urgent} tone={data.counts.urgent ? 'crit' : 'ok'} note="15 days or less" />
          <Kpi label="CEO alerted" value={data.counts.ceo} tone={data.counts.ceo ? 'crit' : 'ok'} note="7 days or less" />
          <Kpi label="Renewal submitted" value={data.counts.submitted} note="Ladder paused" />
          <Kpi label="No expiry on record" value={data.counts.missing} tone={data.counts.missing ? 'unknown' : 'ok'} note="Unknown, not green" />
        </div>
      )}
      <div className="tabbar" role="tablist" aria-label="Foreign worker sections">
        {board && (
          <button role="tab" aria-selected={view === 'papers'} onClick={() => setTab('papers')}>
            Papers
          </button>
        )}
        {board && (
          <button role="tab" aria-selected={view === 'year10'} onClick={() => setTab('year10')}>
            Year 10
            {data.year10.length > 0 && <span className="tab-count">{data.year10.length}</span>}
          </button>
        )}
        <button role="tab" aria-selected={view === 'tasks'} onClick={() => setTab('tasks')}>
          Tasks
          {openTasks > 0 && <span className="tab-count">{openTasks}</span>}
        </button>
      </div>

      {view === 'papers' && (
        <section className="panel">
          <div className="panel-head">
            <h2>Papers on the reminder ladder</h2>
            {data.role === 'escalation' && (
              <div className="tabbar" role="tablist" aria-label="Which papers">
                <button role="tab" aria-selected={mine} onClick={() => setMine(true)}>
                  For me
                </button>
                <button role="tab" aria-selected={!mine} onClick={() => setMine(false)}>
                  All
                </button>
              </div>
            )}
          </div>
          <div className="list">
            {items.length === 0 && <div className="empty">{forMeFirst ? 'Nothing has reached you.' : 'No paper within 120 days.'}</div>}
            {items.slice(0, 200).map((i) => (
              <PaperRow key={`${i.person.id}-${i.paper}`} i={i} canWork={data.canWork} />
            ))}
          </div>
          <p className="muted small" style={{ padding: '8px 12px' }}>
            {data.rules.ladder.source} {data.rules.passport.source}
          </p>
        </section>
      )}

      {view === 'year10' && (
        <section className="panel">
          <div className="panel-head">
            <h2>Reaching year {data.rules.cap.value} within a year</h2>
          </div>
          <div className="list">
            {data.year10.length === 0 && <div className="empty">Nobody reaches year {data.rules.cap.value} within a year.</div>}
            {data.year10.map((y) => (
              <div key={y.person.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
                <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
                  <div style={{ fontWeight: 600 }}>{y.person.name}</div>
                  <Chip tone={y.plan.daysToLeave < 0 ? 'crit' : y.plan.daysToLeave <= 120 ? 'warn' : 'info'}>
                    Year {y.plan.year} of {y.plan.cap}
                  </Chip>
                </div>
                <div className="muted small">
                  {y.person.staffNo} · {y.person.companyName}
                </div>
                <div className="small">
                  Goes home by {dateLabel(y.plan.leaveBy)}. Apply for the fresh permit from {dateLabel(y.plan.applyFrom)}; back from{' '}
                  {dateLabel(y.plan.backFrom)}.
                </div>
              </div>
            ))}
          </div>
          <p className="muted small" style={{ padding: '8px 12px' }}>
            {data.rules.cap.source} Service is counted from the hire date until the first permit date is on record.
          </p>
        </section>
      )}

      {view === 'tasks' && (
        <section className="panel">
          <div className="panel-head">
            <h2>Tasks to the OMs</h2>
          </div>
          <div className="list">
            {data.tasks.length === 0 && <div className="empty">No task.</div>}
            {data.tasks.map((t) => (
              <TaskRowView key={t.task.id} t={t} reasonRequired={data.reasonRequired} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function PaperRow({ i, canWork }: { i: Item; canWork: boolean }) {
  const [mode, setMode] = useState<'renew' | 'task' | null>(null);
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {i.person.name} · {i.label}
          </div>
          <div className="muted small">
            {i.person.staffNo} · {i.person.companyName}
            {i.expiresOn ? ` · expires ${dateLabel(i.expiresOn)}` : ' · no expiry on record'}
            {i.paper === 'PASSPORT' && i.deadline ? ` · renew by ${dateLabel(i.deadline)} (12 months left for the PLKS)` : ''}
          </div>
          {i.stage && !i.stage.paused && <div className="small">Alerted: {i.stage.alerted.map((l) => FW_LEVEL_LABEL[l]).join(', then ')}</div>}
          {i.renewal && (
            <div className="small">
              Submitted {dateLabel(i.renewal.submittedOn)} via {i.renewal.channel} by {i.renewal.by}
              {i.renewal.note ? ` · ${i.renewal.note}` : ''}
            </div>
          )}
        </div>
        <Chip tone={stageTone(i)}>
          {i.stage
            ? i.stage.paused
              ? 'Submitted'
              : `${i.daysLeft! < 0 ? 'Expired' : `${i.daysLeft} d`}${i.stage.priority ? ` · ${i.stage.priority}` : ''}`
            : 'Unknown'}
        </Chip>
      </div>
      {canWork && !mode && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {i.expiresOn && !i.renewal && (
            <button className="btn btn-sm" onClick={() => setMode('renew')}>
              Renewal submitted
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setMode('task')}>
            Send task to OM
          </button>
        </div>
      )}
      {mode === 'renew' && <RenewalForm personId={i.person.id} paper={i.paper} onDone={() => setMode(null)} />}
      {mode === 'task' && <TaskForm personId={i.person.id} paper={i.paper} onDone={() => setMode(null)} />}
    </div>
  );
}

function RenewalForm({ personId, paper, onDone }: { personId: string; paper: FwPaper; onDone: () => void }) {
  const [submittedOn, setSubmittedOn] = useState(today());
  const [channel, setChannel] = useState(
    paper === 'PLKS_PERMIT' ? 'FWCMS' : paper === 'FOMEMA' ? 'FOMEMA' : paper === 'PASSPORT' ? 'Embassy of Nepal' : 'Insurer',
  );
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  return (
    <div className="panel" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="grid-2">
        <label className="field">
          <span className="label">Submitted on</span>
          <input className="input" type="date" aria-label="Submitted on" value={submittedOn} onChange={(e) => setSubmittedOn(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Where</span>
          <input className="input" aria-label="Where submitted" value={channel} onChange={(e) => setChannel(e.target.value)} />
        </label>
      </div>
      <input className="input" aria-label="Renewal note" placeholder="Note, such as levy paid" value={note} onChange={(e) => setNote(e.target.value)} />
      <ProofPicker site={null} refText="FWM" items={proof} onChange={setProof} documentsOnly required />
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !proof.length || channel.trim().length < 3}
          onClick={async () => {
            const ok = await act.run(
              () => api.submitFwRenewal(personId, paper, { submittedOn, channel, note }, proof),
              'Recorded. The reminders pause until the new date is on record.',
            );
            if (ok) onDone();
          }}
        >
          Save
        </button>
        <button className="btn btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function TaskForm({ personId, paper, onDone }: { personId: string; paper: FwPaper; onDone: () => void }) {
  const [kind, setKind] = useState<FwmTaskKind>(paper === 'FOMEMA' ? 'FOMEMA' : paper === 'PLKS_PERMIT' || paper === 'PASSPORT' ? 'JIM' : 'OTHER');
  const [what, setWhat] = useState('');
  const [place, setPlace] = useState('');
  const [dueOn, setDueOn] = useState(today());
  const act = useAction();
  return (
    <div className="panel" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="grid-2">
        <label className="field">
          <span className="label">Task</span>
          <select className="select" aria-label="Task kind" value={kind} onChange={(e) => setKind(e.target.value as FwmTaskKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {FWM_TASK_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">Due</span>
          <input className="input" type="date" aria-label="Due" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
        </label>
      </div>
      <input
        className="input"
        aria-label="What the OM must do"
        placeholder="What the OM must get done"
        value={what}
        onChange={(e) => setWhat(e.target.value)}
      />
      <input className="input" aria-label="Place" placeholder="Where, such as the FOMEMA clinic" value={place} onChange={(e) => setPlace(e.target.value)} />
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || what.trim().length < 5}
          onClick={async () => {
            const ok = await act.run(() => api.createFwmTask(personId, { kind, what, place, dueOn }), 'Task sent to the OM.');
            if (ok) onDone();
          }}
        >
          Send
        </button>
        <button className="btn btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const STATUS: Record<TaskRow['task']['status'], { label: string; tone: Tone }> = {
  open: { label: 'Waiting for the OM', tone: 'warn' },
  returned: { label: 'Sent back to the OM', tone: 'crit' },
  done: { label: 'Done, FWM to check', tone: 'info' },
  accepted: { label: 'Accepted', tone: 'ok' },
};

function TaskRowView({ t, reasonRequired }: { t: TaskRow; reasonRequired: boolean }) {
  const [mode, setMode] = useState<'done' | 'review' | null>(null);
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  const docs = useLoad(
    () => (mode === 'review' || t.task.status === 'accepted' ? api.fwmDocs(t.task.id) : Promise.resolve([])),
    [mode, t.task.id, t.task.status],
  );
  const s = STATUS[t.task.status];
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {t.label} · {t.person?.name ?? ''}
          </div>
          <div className="muted small">
            {t.person?.staffNo} · {t.person?.companyName} · due {dateLabel(t.task.dueOn)}
            {t.task.place ? ` · ${t.task.place}` : ''}
          </div>
          <div className="small">{t.task.what}</div>
          <div className="muted small">
            From {t.task.createdBy} to {t.omName}
            {t.task.doneBy ? ` · done by ${t.task.doneBy}, ${dateTimeLabel(t.task.doneAt!)}${t.task.doneNote ? `: ${t.task.doneNote}` : ''}` : ''}
            {t.task.reviewNote ? ` · FWM: ${t.task.reviewNote}` : ''}
          </div>
        </div>
        <div className="row" style={{ gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {t.overdue && <Chip tone="crit">Overdue</Chip>}
          <Chip tone={s.tone}>{s.label}</Chip>
        </div>
      </div>
      {t.task.status === 'accepted' && docs.data && <DocList docs={docs.data} />}
      {!mode && (t.canDo || t.canReview) && (
        <div>
          <button className="btn btn-sm" onClick={() => setMode(t.canDo ? 'done' : 'review')}>
            {t.canDo ? 'Done, send proof' : 'Check the proof'}
          </button>
        </div>
      )}
      {mode === 'done' && (
        <>
          <ProofPicker site={null} refText="FWM" items={proof} onChange={setProof} documentsOnly required />
          <input className="input" aria-label="Done note" placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
          <ErrorNotice error={act.error} />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !proof.length}
              onClick={async () => {
                const ok = await act.run(() => api.doneFwmTask(t.task.id, note, proof), 'Sent to FWM to check.');
                if (ok) setMode(null);
              }}
            >
              Send
            </button>
            <button className="btn btn-sm" onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </>
      )}
      {mode === 'review' && (
        <>
          {docs.data ? <DocList docs={docs.data} /> : <Loading what="proof" />}
          {reasonRequired && <div className="muted small">You are checking in place of FWM: give the reason (a short one is fine). The FWM Manager, Deputy and the officer who sent it are told.</div>}
          <input
            className="input"
            aria-label="Review note"
            placeholder={reasonRequired ? 'Reason (needed to accept or send back)' : 'Note (needed to send back)'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <ErrorNotice error={act.error} />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || (reasonRequired && !note.trim())}
              onClick={() => act.run(() => api.reviewFwmTask(t.task.id, true, note), 'Accepted.')}
            >
              Accept
            </button>
            <button
              className="btn btn-sm"
              disabled={act.busy || note.trim().length < 5}
              onClick={() => act.run(() => api.reviewFwmTask(t.task.id, false, note), 'Sent back to the OM.')}
            >
              Send back
            </button>
          </div>
        </>
      )}
    </div>
  );
}
