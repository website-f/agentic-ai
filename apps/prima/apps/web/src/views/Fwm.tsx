import { Select } from '../SearchSelect';
import { useState, useMemo } from 'react';
import {
  BellRingingIcon,
  ClipboardTextIcon,
  ClockCountdownIcon,
  GitDiffIcon,
  HandshakeIcon,
  HourglassIcon,
  PaperPlaneTiltIcon,
  QuestionIcon,
  SirenIcon,
  WarningIcon,
} from '@phosphor-icons/react';
import { GroupHistoryPanel, HistoryLookupPanel } from './StaffHistory';
import { FWM_TASK_LABEL, FW_LEVEL_LABEL, type FwmTaskKind, type FwPaper, type ProofInput, FW_PAPERS } from '@prima/core';
import { api, type FwmBoard } from '../api';
import { Avatar, Card, Empty, PageHead, Search, Stat, Stats, Steps, Toolbar, type StepState } from '../kit';
import { Chip, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { CooNoticesPanel } from './CooNotices';
import { DocList, ProofPicker } from './Proof';
import { FwmWelfarePanel } from './FwmWelfare';
import { FwmRecruitmentPanel } from './FwmRecruitment';
import '../styles/hrx.css';

/**
 * Foreign Worker Management (Fauzan, 26 Oct 2026). FWM renews every foreign worker's papers and sends the OMs dated
 * tasks; reminders run at 120, 90, 60, 30 and 15 days (15 is urgent) and escalate FWM, Chief of Staff, COO, CEO, with
 * the CEO told 7 days before expiry. A renewal submitted with its receipt pauses the ladder.
 *
 * Real use in both Prima and the JA Group app (Fauzan, 5 Nov 2026): FWM records each paper from its copy, everyone
 * alerted at 30 days or less acknowledges within 1 working day, and the JA app's dates sit beside Prima's. Where they
 * differ the ladder counts to the earlier date until FWM settles it.
 */

type Item = FwmBoard['items'][number];
type TaskRow = FwmBoard['tasks'][number];
type Worker = FwmBoard['workers'][number];
type Alignment = NonNullable<FwmBoard['alignment']>;

const KINDS: FwmTaskKind[] = ['FOMEMA', 'JIM', 'TNG', 'BIOMETRIC', 'OTHER'];
const PAPERS: FwPaper[] = FW_PAPERS;
const PAGE = 100;

const SOURCE: Record<'prima' | 'ja' | 'sample', { label: string; tone: Tone; title: string }> = {
  prima: { label: 'From the paper', tone: 'ok', title: 'Recorded in Prima from a copy of the paper' },
  ja: { label: 'From JA', tone: 'info', title: 'Date taken from the JA Group app; copy not seen in Prima' },
  sample: { label: 'Sample data', tone: 'unknown', title: 'Sample data from the demo set; record the real paper' },
};

const JA_STATUS: Record<string, string> = {
  active: 'Active',
  home_leave: 'Home leave',
  exit_pending: 'Exit pending',
  exited: 'Exited',
  absconded: 'Absconded',
  other: 'Other',
};

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

/** The stripe on a row: only warning tones colour it. */
const stripe = (t: Tone) => (t === 'crit' || t === 'warn' || t === 'unknown' ? t : undefined);

export function FwmView() {
  const { data, error } = useLoad(() => api.fwmBoard(), []);
  const [tab, setTab] = useState<'papers' | 'workers' | 'align' | 'year10' | 'tasks' | 'welfare' | 'recruit' | null>(null);
  const [mine, setMine] = useState(true);
  const [q, setQ] = useState('');
  const [company, setCompany] = useState('');
  const [paper, setPaper] = useState<FwPaper | ''>('');
  const [only, setOnly] = useState<'' | 'ack' | 'differ' | 'ja'>('');
  const [shown, setShown] = useState(PAGE);
  const companies = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of data?.items ?? []) m.set(i.person.companyId, i.person.companyName);
    for (const w of data?.workers ?? []) m.set(w.companyId, w.companyName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="foreign workers" />
      </div>
    );
  const board = data.role !== 'om' && data.role !== 'despatch';
  const view = tab ?? (board ? 'papers' : 'tasks');
  const forMeFirst = data.role === 'escalation' && mine;
  const text = q.trim().toLowerCase();
  const items = data.items.filter(
    (i) =>
      (!forMeFirst || i.forMe) &&
      (!company || i.person.companyId === company) &&
      (!paper || i.paper === paper) &&
      (!text || i.person.name.toLowerCase().includes(text) || i.person.staffNo.toLowerCase().includes(text)) &&
      (only !== 'ack' || i.acksOwed.length > 0) &&
      (only !== 'differ' || i.datesDiffer) &&
      (only !== 'ja' || i.jaOnly),
  );
  const openTasks = data.tasks.filter((t) => t.task.status !== 'accepted').length;
  const tasksFound = text
    ? data.tasks.filter((t) => `${t.person?.name ?? ''} ${t.person?.staffNo ?? ''} ${t.person?.companyName ?? ''} ${t.label} ${t.omName}`.toLowerCase().includes(text))
    : data.tasks;
  const yearFound = text ? data.year10.filter((y) => `${y.person.name} ${y.person.staffNo} ${y.person.companyName}`.toLowerCase().includes(text)) : data.year10;
  const align = data.alignment;
  const alignCount = align ? align.datesDiffer.length + align.jaOnly.length + align.notInJa.length + align.statusDiffers.length : 0;
  const search = (v: string) => (setQ(v), setShown(PAGE));
  return (
    <div className="page">
      <PageHead
        title="Foreign workers"
        sub={
          data.role === 'om'
            ? 'Tasks from Foreign Worker Management: get the guard there, then send the proof.'
            : 'Foreign Worker Management renews permits, passports, FOMEMA and insurance, and sends the OMs dated tasks. The same board runs in the JA Group app; both dates are shown.'
        }
      />
      <CooNoticesPanel notices={data.cooNotices} />
      {board ? (
        <Stats>
          {data.level && data.level !== 'FWM' && (
            <Stat
              label={`Reached ${FW_LEVEL_LABEL[data.level]}`}
              value={data.counts.forMe}
              tone={data.counts.forMe ? 'crit' : 'ok'}
              icon={<BellRingingIcon size={16} />}
              note="Papers escalated to you"
            />
          )}
          {data.level && (
            <Stat
              label="For you to acknowledge"
              value={data.counts.ackMine}
              tone={data.counts.ackMine ? 'warn' : 'ok'}
              note="Within 1 working day"
              icon={<HandshakeIcon size={16} />}
              onClick={() => (setTab('papers'), setOnly('ack'))}
            />
          )}
          <Stat label="Expired or urgent" value={data.counts.urgent} tone={data.counts.urgent ? 'crit' : 'ok'} note="15 days or less" icon={<SirenIcon size={16} />} />
          <Stat label="CEO alerted" value={data.counts.ceo} tone={data.counts.ceo ? 'crit' : 'ok'} note="7 days or less" icon={<WarningIcon size={16} />} />
          <Stat
            label="Acknowledgement late"
            value={data.counts.ackLate}
            tone={data.counts.ackLate ? 'crit' : 'ok'}
            note="Past 1 working day"
            icon={<ClockCountdownIcon size={16} />}
          />
          <Stat label="Renewal submitted" value={data.counts.submitted} note="Ladder paused" tone="info" icon={<PaperPlaneTiltIcon size={16} />} />
          <Stat
            label="No expiry on record"
            value={data.counts.missing}
            tone={data.counts.missing ? 'unknown' : 'ok'}
            note="Unknown, not green"
            icon={<QuestionIcon size={16} />}
          />
          <Stat
            label="Prima and JA differ"
            value={data.counts.datesDiffer}
            tone={data.counts.datesDiffer ? 'warn' : 'ok'}
            note="Counts to the earlier date"
            icon={<GitDiffIcon size={16} />}
            onClick={align ? () => setTab('align') : undefined}
          />
        </Stats>
      ) : (
        <Stats>
          <Stat label="Open tasks" value={openTasks} tone={openTasks ? 'warn' : 'ok'} note="Not yet accepted by FWM" icon={<ClipboardTextIcon size={16} />} />
          <Stat
            label="Overdue"
            value={data.tasks.filter((t) => t.overdue).length}
            tone={data.tasks.some((t) => t.overdue) ? 'crit' : 'ok'}
            note="Past the due date"
            icon={<ClockCountdownIcon size={16} />}
          />
          <Stat
            label="Sent back"
            value={data.tasks.filter((t) => t.task.status === 'returned').length}
            tone={data.tasks.some((t) => t.task.status === 'returned') ? 'crit' : 'ok'}
            note="FWM asked for more"
            icon={<HourglassIcon size={16} />}
          />
        </Stats>
      )}
      <div className="tabbar hx-tabs" role="tablist" aria-label="Foreign worker sections">
        {board && (
          <button role="tab" aria-selected={view === 'papers'} onClick={() => setTab('papers')}>
            Papers
          </button>
        )}
        {data.canWork && (
          <button role="tab" aria-selected={view === 'workers'} onClick={() => setTab('workers')}>
            Workers
          </button>
        )}
        {board && align && (
          <button role="tab" aria-selected={view === 'align'} onClick={() => setTab('align')}>
            Prima and JA
            {alignCount > 0 && <span className="tab-count">{alignCount}</span>}
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
        {board && (
          <button role="tab" aria-selected={view === 'welfare'} onClick={() => setTab('welfare')}>
            Recruitment and welfare
          </button>
        )}
        {board && (
          <button role="tab" aria-selected={view === 'recruit'} onClick={() => setTab('recruit')}>
            Recruitment steps
          </button>
        )}
      </div>

      {view === 'welfare' && <FwmWelfarePanel />}
      {view === 'recruit' && <FwmRecruitmentPanel />}

      {(view === 'papers' || view === 'year10' || view === 'tasks') && (
        <Toolbar
          end={
            view === 'papers' && data.role === 'escalation' ? (
              <div className="seg" role="group" aria-label="Which papers">
                <button aria-pressed={mine} onClick={() => setMine(true)}>
                  For me
                </button>
                <button aria-pressed={!mine} onClick={() => setMine(false)}>
                  All
                </button>
              </div>
            ) : undefined
          }
        >
          <Search value={q} onChange={search} placeholder="Name or staff no." label="Search name or staff number" />
          {view === 'papers' && (
            <>
              <Select className="select hx-filter" aria-label="Company" value={company} onChange={(e) => (setCompany(e.target.value), setShown(PAGE))}>
                <option value="">All companies</option>
                {companies.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
              <Select className="select hx-filter" aria-label="Paper" value={paper} onChange={(e) => (setPaper(e.target.value as FwPaper | ''), setShown(PAGE))}>
                <option value="">All papers</option>
                {PAPERS.map((p) => (
                  <option key={p} value={p}>
                    {data.items.find((i) => i.paper === p)?.label ?? p}
                  </option>
                ))}
              </Select>
              <select className="select hx-filter" aria-label="Show only" value={only} onChange={(e) => (setOnly(e.target.value as typeof only), setShown(PAGE))}>
                <option value="">Everything</option>
                <option value="ack">Acknowledgement owed</option>
                <option value="differ">Prima and JA differ</option>
                <option value="ja">In JA only</option>
              </select>
            </>
          )}
        </Toolbar>
      )}

      {view === 'papers' && (
        <div className="hx-stack-tight">
          <Card
            title="Papers on the reminder ladder"
            sub="Reminders at 120, 90, 60, 30 and 15 days; a submitted renewal pauses the ladder."
            actions={<span className="hx-count">{items.length > shown ? `First ${shown} of ${items.length}` : `${items.length} paper${items.length === 1 ? '' : 's'}`}</span>}
            footer={
              items.length > shown ? (
                <button className="btn btn-sm" onClick={() => setShown(shown + PAGE)}>
                  Show more ({items.length - shown} left)
                </button>
              ) : undefined
            }
            flush
          >
            {items.length === 0 ? (
              <Empty title={forMeFirst ? 'Nothing has reached you.' : 'No paper within 120 days.'}>
                {text || company || paper || only ? 'No paper matches the search or filters.' : undefined}
              </Empty>
            ) : (
              <ul className="hx-rows">
                {items.slice(0, shown).map((i) => (
                  <PaperRow key={`${i.person.id ?? i.person.staffNo}-${i.person.companyId}-${i.paper}`} i={i} canWork={data.canWork} onAlign={() => setTab('align')} />
                ))}
              </ul>
            )}
          </Card>
          <p className="hx-source">
            {data.rules.ladder.source} {data.rules.passport.source} {data.rules.ack.source}
          </p>
        </div>
      )}

      {view === 'workers' && data.canWork && <WorkersView workers={data.workers} />}

      {view === 'align' && align && <AlignView a={align} canWork={data.canWork} branches={data.branches} note={data.rules.both.source} />}

      {view === 'year10' && (
        <div className="hx-stack-tight">
          <Card title={`Reaching year ${data.rules.cap.value} within a year`} actions={<span className="hx-count">{yearFound.length}</span>} flush>
            {yearFound.length === 0 ? (
              <Empty title={`Nobody reaches year ${data.rules.cap.value} within a year.`}>{text ? 'Nobody matches the search.' : undefined}</Empty>
            ) : (
              <ul className="hx-rows">
                {yearFound.map((y) => {
                  const tone = y.plan.daysToLeave < 0 ? 'crit' : y.plan.daysToLeave <= 120 ? 'warn' : 'info';
                  return (
                    <li key={y.person.id} className="hx-row fw-row" data-tone={tone === 'info' ? undefined : tone}>
                      <Avatar name={y.person.name} size={36} />
                      <div className="hx-row-main">
                        <span className="hx-row-title">{y.person.name}</span>
                        <span className="hx-row-meta">
                          {y.person.staffNo} · {y.person.companyName}
                        </span>
                      </div>
                      <div className="hx-row-side">
                        <Chip tone={tone}>
                          Year {y.plan.year} of {y.plan.cap}
                        </Chip>
                      </div>
                      <div className="hx-row-body">
                        <div className="fw-dates">
                          <span>
                            <span className="label">Goes home by</span>
                            <b>{dateLabel(y.plan.leaveBy)}</b>
                          </span>
                          <span>
                            <span className="label">Apply for the fresh permit from</span>
                            <b>{dateLabel(y.plan.applyFrom)}</b>
                          </span>
                          <span>
                            <span className="label">Back from</span>
                            <b>{dateLabel(y.plan.backFrom)}</b>
                          </span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <p className="hx-source">{data.rules.cap.source} Service is counted from the hire date until the first permit date is on record.</p>
        </div>
      )}

      {view === 'tasks' && (
        <Card title="Tasks to the OMs" actions={<span className="hx-count">{openTasks} open</span>} flush>
          {tasksFound.length === 0 ? (
            <Empty title="No task.">{text ? 'No task matches the search.' : undefined}</Empty>
          ) : (
            <ul className="hx-rows">
              {tasksFound.map((t) => (
                <TaskRowView key={t.task.id} t={t} reasonRequired={data.reasonRequired} />
              ))}
            </ul>
          )}
        </Card>
      )}
      {board && <HistoryLookupPanel />}
      {board && <GroupHistoryPanel />}
    </div>
  );
}

function PaperRow({ i, canWork, onAlign }: { i: Item; canWork: boolean; onAlign: () => void }) {
  const [mode, setMode] = useState<'renew' | 'task' | 'new' | 'ack' | null>(null);
  const act = useAction();
  const personId = i.person.id;
  const tone = stageTone(i);
  return (
    <li className="hx-row fw-row" data-tone={stripe(tone)}>
      <Avatar name={i.person.name} size={36} />
      <div className="hx-row-main">
        <span className="hx-row-title">
          {i.person.name} · {i.label}
        </span>
        <span className="hx-row-meta">
          {i.person.staffNo} · {i.person.companyName}
        </span>
      </div>
      <div className="hx-row-side">
        {i.jaOnly && <Chip tone="unknown">In JA only</Chip>}
        {i.source && (
          <Chip tone={SOURCE[i.source].tone} title={SOURCE[i.source].title}>
            {SOURCE[i.source].label}
          </Chip>
        )}
        {i.datesDiffer && <Chip tone="warn">Dates differ</Chip>}
        {i.acksOwed.some((a) => a.late) && <Chip tone="crit">Not acknowledged</Chip>}
        <Chip tone={tone}>
          {i.stage
            ? i.stage.paused
              ? 'Submitted'
              : `${i.daysLeft! < 0 ? 'Expired' : `${i.daysLeft} d`}${i.stage.priority ? ` · ${i.stage.priority}` : ''}`
            : 'Unknown'}
        </Chip>
      </div>
      <div className="hx-row-body">
        <div className="hx-meta-list">
          <span>
            {i.expiresOn ? (
              <>
                Expires <b>{dateLabel(i.expiresOn)}</b>
              </>
            ) : (
              'No expiry on record'
            )}
          </span>
          {i.paper === 'PASSPORT' && i.deadline && (
            <span>
              Renew by <b>{dateLabel(i.deadline)}</b> (12 months left for the PLKS)
            </span>
          )}
          {(i.datesDiffer || i.ja) && (
            <span>
              Prima: {i.primaExpiresOn ? dateLabel(i.primaExpiresOn) : 'none'} · JA app: {i.ja?.expiresOn ? dateLabel(i.ja.expiresOn) : 'none'}
              {i.ja?.stale ? ' (JA feed late, treat as unknown)' : ''}
              {i.datesDiffer ? ` · counting to the earlier date (${i.countedFrom === 'ja' ? 'JA' : 'Prima'}) until FWM settles it` : ''}
            </span>
          )}
          {i.stage && !i.stage.paused && <span>Alerted: {i.stage.alerted.map((l) => FW_LEVEL_LABEL[l]).join(', then ')}</span>}
          {i.acks.map((a) => (
            <span key={`${a.level}-${a.at}`}>
              Acknowledged by {a.by} ({FW_LEVEL_LABEL[a.level]}), {dateTimeLabel(a.at)}
              {a.note ? `: ${a.note}` : ''}
            </span>
          ))}
          {i.acksOwed.length > 0 && (
            <span>To acknowledge: {i.acksOwed.map((a) => `${FW_LEVEL_LABEL[a.level]} by ${dateLabel(a.dueOn)}${a.late ? ' (late)' : ''}`).join(' · ')}</span>
          )}
          {i.renewal && (
            <span>
              Submitted {dateLabel(i.renewal.submittedOn)} via {i.renewal.channel} by {i.renewal.by}
              {i.renewal.note ? ` · ${i.renewal.note}` : ''}. Record the new paper when it comes.
            </span>
          )}
          {i.jaSubmitted && i.ja?.renewalSubmittedOn && <span>The JA app says the renewal was submitted on {dateLabel(i.ja.renewalSubmittedOn)}.</span>}
        </div>
        {!mode && (i.canAck || (canWork && (i.jaOnly || personId))) && (
          <div className="hx-row-actions">
            {i.canAck && (
              <button className="btn btn-sm btn-primary" onClick={() => setMode('ack')}>
                Acknowledge
              </button>
            )}
            {canWork && i.jaOnly && (
              <button className="btn btn-sm" onClick={onAlign}>
                Add to Prima
              </button>
            )}
            {canWork && personId && (
              <>
                <button className="btn btn-sm" onClick={() => setMode('new')}>
                  New paper received
                </button>
                {i.primaExpiresOn && !i.renewal && !i.jaSubmitted && (
                  <button className="btn btn-sm" onClick={() => setMode('renew')}>
                    Renewal submitted
                  </button>
                )}
                {i.ja?.expiresOn && i.ja.expiresOn !== i.primaExpiresOn && (
                  <button
                    className="btn btn-sm"
                    disabled={act.busy}
                    onClick={() => act.run(() => api.recordFwPaper(personId, i.paper, { mode: 'ja' }, []), 'The JA app date is now on record in Prima.')}
                  >
                    Use the JA date
                  </button>
                )}
                <button className="btn btn-sm" onClick={() => setMode('task')}>
                  Send task to OM
                </button>
              </>
            )}
          </div>
        )}
        <ErrorNotice error={act.error} />
        {mode === 'ack' && i.credentialId && <AckForm credentialId={i.credentialId} onDone={() => setMode(null)} />}
        {mode === 'new' && personId && <PaperForm personId={personId} paper={i.paper} mode="new" onDone={() => setMode(null)} />}
        {mode === 'renew' && personId && <RenewalForm personId={personId} paper={i.paper} onDone={() => setMode(null)} />}
        {mode === 'task' && personId && <TaskForm personId={personId} paper={i.paper} onDone={() => setMode(null)} />}
      </div>
    </li>
  );
}

function AckForm({ credentialId, onDone }: { credentialId: string; onDone: () => void }) {
  const [note, setNote] = useState('');
  const act = useAction();
  return (
    <div className="hx-form">
      <h3 className="hx-form-title">Acknowledge</h3>
      <label className="field">
        <span className="label">Note</span>
        <input
          className="input"
          aria-label="Acknowledgement note"
          placeholder="Note, such as what you asked FWM to do (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <ErrorNotice error={act.error} />
      <div className="hx-form-actions">
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy}
          onClick={async () => {
            const ok = await act.run(() => api.ackFwPaper(credentialId, note), 'Acknowledged.');
            if (ok) onDone();
          }}
        >
          Acknowledge
        </button>
        <button className="btn btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Record a paper from its copy, or correct a mistake on the one on record (with a reason). */
function PaperForm({
  personId,
  paper,
  mode,
  current,
  onDone,
}: {
  personId: string;
  paper: FwPaper;
  mode: 'new' | 'correct';
  current?: { number: string | null; issuedOn: string | null; expiresOn: string | null };
  onDone: () => void;
}) {
  const [number, setNumber] = useState(mode === 'correct' ? (current?.number ?? '') : '');
  const [issuedOn, setIssuedOn] = useState(mode === 'correct' ? (current?.issuedOn ?? today()) : today());
  const [expiresOn, setExpiresOn] = useState(mode === 'correct' ? (current?.expiresOn ?? '') : '');
  const [reason, setReason] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  // A correction that moves the expiry later needs the copy too (the server refuses it otherwise).
  const needsCopy = mode === 'new' || (!!current?.expiresOn && !!expiresOn && expiresOn > current.expiresOn);
  const ready = number.trim().length >= 3 && !!issuedOn && !!expiresOn && (!needsCopy || proof.length > 0) && (mode === 'new' || reason.trim().length >= 5);
  return (
    <div className="hx-form">
      <h3 className="hx-form-title">{mode === 'new' ? 'Record the paper from its copy' : 'Correct a mistake'}</h3>
      <div className="hx-form-grid">
        <label className="field">
          <span className="label">{paper === 'PASSPORT' ? 'Passport number (last 4 kept)' : 'Number'}</span>
          <input className="input" aria-label="Paper number" value={number} onChange={(e) => setNumber(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Issued on</span>
          <input className="input" type="date" aria-label="Issued on" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Expires on</span>
          <input className="input" type="date" aria-label="Expires on" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
        </label>
        {mode === 'correct' && (
          <label className="field hx-form-wide">
            <span className="label">What was wrong</span>
            <input className="input" aria-label="Correction reason" placeholder="What was wrong (needed)" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        )}
      </div>
      <ProofPicker site={null} refText="FWM" items={proof} onChange={setProof} documentsOnly required={needsCopy} />
      <ErrorNotice error={act.error} />
      <div className="hx-form-actions">
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !ready}
          onClick={async () => {
            const ok = await act.run(
              () => api.recordFwPaper(personId, paper, { mode, number, issuedOn, expiresOn, reason }, proof),
              mode === 'new' ? 'Recorded. The ladder now counts to the new date.' : 'Corrected. The old values are kept.',
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

function WorkersView({ workers }: { workers: Worker[] }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const text = q.trim().toLowerCase();
  const found = text.length >= 2 ? workers.filter((w) => w.name.toLowerCase().includes(text) || w.staffNo.toLowerCase().includes(text)).slice(0, 30) : [];
  return (
    <>
      <Toolbar>
        <Search value={q} onChange={setQ} placeholder="Type a name or staff number" label="Find a worker" />
      </Toolbar>
      <Card title="Record a worker’s papers" actions={<span className="hx-count">{workers.length} in Prima</span>} flush>
        {text.length < 2 ? (
          <Empty title={`${workers.length} foreign workers in Prima.`}>Type at least 2 letters to find one.</Empty>
        ) : found.length === 0 ? (
          <Empty title="Nobody matches." />
        ) : (
          <ul className="hx-rows">
            {found.map((w) => (
              <li key={w.id} className="hx-row fw-row">
                <Avatar name={w.name} size={36} />
                <div className="hx-row-main">
                  <span className="hx-row-title">{w.name}</span>
                  <span className="hx-row-meta">
                    {w.staffNo} · {w.companyName} · {w.branch}
                  </span>
                </div>
                <div className="hx-row-side">
                  {w.jaStatus && w.jaStatus !== 'active' && <Chip tone="warn">JA: {JA_STATUS[w.jaStatus] ?? w.jaStatus}</Chip>}
                  <button className="btn btn-sm" aria-expanded={open === w.id} onClick={() => setOpen(open === w.id ? null : w.id)}>
                    {open === w.id ? 'Close' : 'Papers'}
                  </button>
                </div>
                {open === w.id && (
                  <div className="hx-row-body">
                    <ul className="hx-rows">
                      {w.papers.map((p) => (
                        <WorkerPaper key={p.paper} personId={w.id} p={p} />
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function WorkerPaper({ personId, p }: { personId: string; p: Worker['papers'][number] }) {
  const [mode, setMode] = useState<'new' | 'correct' | null>(null);
  const act = useAction();
  return (
    <li className="hx-row" data-tone={!p.expiresOn ? 'unknown' : p.datesDiffer ? 'warn' : undefined}>
      <div className="hx-row-main">
        <span className="hx-row-title">{p.label}</span>
        <span className="hx-row-meta">
          {p.expiresOn ? `${p.number || 'no number'} · issued ${p.issuedOn ? dateLabel(p.issuedOn) : '?'} · expires ${dateLabel(p.expiresOn)}` : 'Not on record in Prima'}
          {p.jaExpiresOn ? ` · JA app: ${dateLabel(p.jaExpiresOn)}` : ''}
        </span>
      </div>
      <div className="hx-row-side">
        {p.source && (
          <Chip tone={SOURCE[p.source].tone} title={SOURCE[p.source].title}>
            {SOURCE[p.source].label}
          </Chip>
        )}
        {p.datesDiffer && <Chip tone="warn">Dates differ</Chip>}
        {!p.expiresOn && <Chip tone="unknown">Unknown</Chip>}
      </div>
      <div className="hx-row-body">
        {!mode && (
          <div className="hx-row-actions">
            <button className="btn btn-sm" onClick={() => setMode('new')}>
              {p.expiresOn ? 'New paper received' : 'Record from the paper'}
            </button>
            {p.credentialId && (
              <button className="btn btn-sm" onClick={() => setMode('correct')}>
                Correct a mistake
              </button>
            )}
            {p.jaExpiresOn && p.jaExpiresOn !== p.expiresOn && (
              <button
                className="btn btn-sm"
                disabled={act.busy}
                onClick={() => act.run(() => api.recordFwPaper(personId, p.paper, { mode: 'ja' }, []), 'The JA app date is now on record in Prima.')}
              >
                Use the JA date
              </button>
            )}
          </div>
        )}
        <ErrorNotice error={act.error} />
        {mode && <PaperForm personId={personId} paper={p.paper} mode={mode} current={p} onDone={() => setMode(null)} />}
      </div>
    </li>
  );
}

function AlignView({ a, canWork, branches, note }: { a: Alignment; canWork: boolean; branches: FwmBoard['branches']; note: string }) {
  const late = a.feeds.filter((f) => f.state !== 'ok');
  return (
    <div className="hx-stack-tight">
      <Card title="JA app feed by company" flush>
        {late.length === 0 ? (
          <Empty title="Every company’s JA foreign-worker feed is current." />
        ) : (
          <ul className="hx-rows">
            {late.map((f) => (
              <li key={f.companyId} className="hx-row" data-tone="unknown">
                <div className="hx-row-main">
                  <span className="hx-row-title">{f.companyName}</span>
                  <span className="hx-row-meta">{f.lastAt ? `Last delivery ${dateTimeLabel(f.lastAt)}` : 'Nothing received from the JA app yet'}</span>
                </div>
                <div className="hx-row-side">
                  <Chip tone="unknown">{f.state === 'none' ? 'No feed' : 'Feed late'}</Chip>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Dates differ" actions={<span className="hx-count">{a.datesDiffer.length}</span>} flush>
        {a.datesDiffer.length === 0 ? (
          <Empty title="Prima and the JA app agree on every date they both hold." />
        ) : (
          <ul className="hx-rows">
            {a.datesDiffer.slice(0, 200).map((d) => (
              <li key={`${d.person.id}-${d.paper}`} className="hx-row" data-tone="warn">
                <div className="hx-row-main">
                  <span className="hx-row-title">
                    {d.person.name} · {d.label}
                  </span>
                  <span className="hx-row-meta">
                    {d.person.staffNo} · {d.person.companyName} · Prima {d.prima ? dateLabel(d.prima) : 'none'} · JA {d.ja ? dateLabel(d.ja) : 'none'}
                  </span>
                </div>
                <div className="hx-row-side">{canWork && d.person.id && <UseJaButton personId={d.person.id} paper={d.paper} />}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="In the JA app, not in Prima" actions={<span className="hx-count">{a.jaOnly.length}</span>} flush>
        {a.jaOnly.length === 0 ? (
          <Empty title="Every worker the JA app sent is in Prima." />
        ) : (
          <ul className="hx-rows">
            {a.jaOnly.slice(0, 200).map((w) => (
              <JaOnlyRow key={w.recordId} w={w} canWork={canWork} branches={branches.filter((b) => b.companyId === w.companyId)} />
            ))}
          </ul>
        )}
      </Card>
      <Card title="In Prima, missing from the JA app" actions={<span className="hx-count">{a.notInJa.length}</span>} flush>
        {a.notInJa.length === 0 ? (
          <Empty title="None (only companies whose JA feed is current are checked)." />
        ) : (
          <ul className="hx-rows">
            {a.notInJa.slice(0, 200).map((p) => (
              <li key={p.id ?? p.staffNo} className="hx-row">
                <div className="hx-row-main">
                  <span className="hx-row-title">{p.name}</span>
                  <span className="hx-row-meta">
                    {p.staffNo} · {p.companyName}
                  </span>
                </div>
                <div className="hx-row-side">
                  <Chip tone="warn">Ask JA</Chip>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card
        title="JA status needs a look"
        actions={<span className="hx-count">{a.statusDiffers.length}</span>}
        footer={<p className="hx-source">Prima never changes a worker’s status from the JA app by itself. Check with the company and record the change in the worker’s file.</p>}
        flush
      >
        {a.statusDiffers.length === 0 ? (
          <Empty title="No worker is on home leave, exiting, exited or absconded in the JA app." />
        ) : (
          <ul className="hx-rows">
            {a.statusDiffers.slice(0, 200).map((p) => (
              <li key={p.id ?? p.staffNo} className="hx-row">
                <div className="hx-row-main">
                  <span className="hx-row-title">{p.name}</span>
                  <span className="hx-row-meta">
                    {p.staffNo} · {p.companyName} · Prima: {p.primaStatus}
                  </span>
                </div>
                <div className="hx-row-side">
                  <Chip tone={p.jaStatus === 'absconded' || p.jaStatus === 'exited' ? 'crit' : 'warn'}>JA: {JA_STATUS[p.jaStatus] ?? p.jaStatus}</Chip>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="hx-source">{note}</p>
    </div>
  );
}

function UseJaButton({ personId, paper }: { personId: string; paper: FwPaper }) {
  const act = useAction();
  return (
    <>
      <button
        className="btn btn-sm"
        disabled={act.busy}
        onClick={() => act.run(() => api.recordFwPaper(personId, paper, { mode: 'ja' }, []), 'The JA app date is now on record in Prima.')}
      >
        Use the JA date
      </button>
      <ErrorNotice error={act.error} />
    </>
  );
}

function JaOnlyRow({ w, canWork, branches }: { w: Alignment['jaOnly'][number]; canWork: boolean; branches: FwmBoard['branches'] }) {
  const [adding, setAdding] = useState(false);
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [hiredOn, setHiredOn] = useState('');
  const [dob, setDob] = useState('');
  const act = useAction();
  return (
    <li className="hx-row" data-tone={w.status === 'absconded' ? 'crit' : undefined}>
      <div className="hx-row-main">
        <span className="hx-row-title">{w.name}</span>
        <span className="hx-row-meta">
          {w.staffNo} · {w.companyName} · {w.nationality}
          {w.siteCode ? ` · site ${w.siteCode}` : ''} · received {dateTimeLabel(w.receivedAt)}
        </span>
      </div>
      <div className="hx-row-side">
        <Chip tone={w.status === 'absconded' ? 'crit' : w.status === 'active' ? 'unknown' : 'warn'}>JA: {JA_STATUS[w.status] ?? w.status}</Chip>
      </div>
      {((canWork && !adding && w.status !== 'absconded') || adding) && (
        <div className="hx-row-body">
          {canWork && !adding && w.status !== 'absconded' && (
            <div className="hx-row-actions">
              <button className="btn btn-sm" onClick={() => setAdding(true)}>
                Add to Prima
              </button>
            </div>
          )}
          {adding && (
            <div className="hx-form">
              <h3 className="hx-form-title">Add to Prima</h3>
              <div className="hx-form-grid">
                <label className="field">
                  <span className="label">Branch</span>
                  <Select className="select" aria-label="Branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="field">
                  <span className="label">Hire date</span>
                  <input className="input" type="date" aria-label="Hire date" value={hiredOn} onChange={(e) => setHiredOn(e.target.value)} />
                </label>
                <label className="field">
                  <span className="label">Date of birth (passport)</span>
                  <input className="input" type="date" aria-label="Date of birth" value={dob} onChange={(e) => setDob(e.target.value)} />
                </label>
              </div>
              <p className="hx-source">Name, staff number and paper dates come from the JA app. Record each paper from its copy afterwards.</p>
              <ErrorNotice error={act.error} />
              <div className="hx-form-actions">
                <button
                  className="btn btn-primary btn-sm"
                  disabled={act.busy || !branchId || !hiredOn || !dob}
                  onClick={async () => {
                    const ok = await act.run(() => api.addFwWorkerFromJa(w.recordId, { branchId, hiredOn, dob }), 'Added to Prima.');
                    if (ok) setAdding(false);
                  }}
                >
                  Add
                </button>
                <button className="btn btn-sm" onClick={() => setAdding(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function RenewalForm({ personId, paper, onDone }: { personId: string; paper: FwPaper; onDone: () => void }) {
  const [submittedOn, setSubmittedOn] = useState(today());
  const [channel, setChannel] = useState(
    paper === 'PLKS_PERMIT' ? 'FWCMS' : paper === 'KDN_LETTER' ? 'eSIMS' : paper === 'FOMEMA' ? 'FOMEMA' : paper === 'PASSPORT' ? 'Embassy of Nepal' : 'Insurer',
  );
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  return (
    <div className="hx-form">
      <h3 className="hx-form-title">Renewal submitted</h3>
      <div className="hx-form-grid">
        <label className="field">
          <span className="label">Submitted on</span>
          <input className="input" type="date" aria-label="Submitted on" value={submittedOn} onChange={(e) => setSubmittedOn(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Where</span>
          <input className="input" aria-label="Where submitted" value={channel} onChange={(e) => setChannel(e.target.value)} />
        </label>
        <label className="field hx-form-wide">
          <span className="label">Note</span>
          <input className="input" aria-label="Renewal note" placeholder="Note, such as levy paid" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <ProofPicker site={null} refText="FWM" items={proof} onChange={setProof} documentsOnly required />
      <ErrorNotice error={act.error} />
      <div className="hx-form-actions">
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
    <div className="hx-form">
      <h3 className="hx-form-title">Send a task to the OM</h3>
      <div className="hx-form-grid">
        <label className="field">
          <span className="label">Task</span>
          <Select className="select" aria-label="Task kind" value={kind} onChange={(e) => setKind(e.target.value as FwmTaskKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {FWM_TASK_LABEL[k]}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span className="label">Due</span>
          <input className="input" type="date" aria-label="Due" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
        </label>
        <label className="field hx-form-wide">
          <span className="label">What the OM must do</span>
          <input
            className="input"
            aria-label="What the OM must do"
            placeholder="What the OM must get done"
            value={what}
            onChange={(e) => setWhat(e.target.value)}
          />
        </label>
        <label className="field hx-form-wide">
          <span className="label">Place</span>
          <input className="input" aria-label="Place" placeholder="Where, such as the FOMEMA clinic" value={place} onChange={(e) => setPlace(e.target.value)} />
        </label>
      </div>
      <ErrorNotice error={act.error} />
      <div className="hx-form-actions">
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

/** Where a task is: sent, the OM's proof, FWM's check. */
function taskSteps(t: TaskRow): { label: string; state: StepState; note?: string }[] {
  const s = t.task.status;
  return [
    { label: 'Task sent', state: 'done', note: `due ${dateLabel(t.task.dueOn)}` },
    {
      label: 'OM sends proof',
      state: s === 'open' ? 'now' : s === 'returned' ? 'stopped' : 'done',
      note: s === 'returned' ? 'Sent back' : t.task.doneBy ? t.task.doneBy : undefined,
    },
    { label: 'FWM checks', state: s === 'accepted' ? 'done' : s === 'done' ? 'now' : 'todo' },
  ];
}

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
    <li className="hx-row fw-row" data-tone={t.overdue || t.task.status === 'returned' ? 'crit' : undefined}>
      <Avatar name={t.person?.name ?? t.label} size={36} />
      <div className="hx-row-main">
        <span className="hx-row-title">
          {t.label} · {t.person?.name ?? ''}
        </span>
        <span className="hx-row-meta">
          {t.person?.staffNo} · {t.person?.companyName} · due {dateLabel(t.task.dueOn)}
          {t.task.place ? ` · ${t.task.place}` : ''}
        </span>
      </div>
      <div className="hx-row-side">
        {t.overdue && <Chip tone="crit">Overdue</Chip>}
        <Chip tone={s.tone}>{s.label}</Chip>
      </div>
      <div className="hx-row-body">
        <p className="hx-row-text">{t.task.what}</p>
        <Steps steps={taskSteps(t)} />
        <div className="hx-meta-list">
          <span>
            From {t.task.createdBy} to {t.omName}
          </span>
          {t.task.doneBy && (
            <span>
              Done by {t.task.doneBy}, {dateTimeLabel(t.task.doneAt!)}
              {t.task.doneNote ? `: ${t.task.doneNote}` : ''}
            </span>
          )}
          {t.task.reviewNote && <span>FWM: {t.task.reviewNote}</span>}
        </div>
        {t.task.status === 'accepted' && docs.data && <DocList docs={docs.data} />}
        {!mode && (t.canDo || t.canReview) && (
          <div className="hx-row-actions">
            <button className="btn btn-primary btn-sm" onClick={() => setMode(t.canDo ? 'done' : 'review')}>
              {t.canDo ? 'Done, send proof' : 'Check the proof'}
            </button>
          </div>
        )}
        {mode === 'done' && (
          <div className="hx-form">
            <h3 className="hx-form-title">Send the proof to FWM</h3>
            <ProofPicker site={null} refText="FWM" items={proof} onChange={setProof} documentsOnly required />
            <label className="field">
              <span className="label">Note</span>
              <input className="input" aria-label="Done note" placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <ErrorNotice error={act.error} />
            <div className="hx-form-actions">
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
          </div>
        )}
        {mode === 'review' && (
          <div className="hx-form">
            <h3 className="hx-form-title">Check the proof</h3>
            {docs.data ? <DocList docs={docs.data} /> : <Loading what="proof" />}
            {reasonRequired && (
              <p className="notice" data-tone="info">
                You are checking in place of FWM: give the reason (a short one is fine). The FWM Manager, Deputy and the officer who sent it are told.
              </p>
            )}
            <label className="field">
              <span className="label">{reasonRequired ? 'Reason' : 'Comment'}</span>
              <input
                className="input"
                aria-label="Review note"
                placeholder={reasonRequired ? 'Reason (needed to accept or send back)' : 'Comment (needed to accept or send back)'}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <ErrorNotice error={act.error} />
            <div className="hx-form-actions">
              <button
                className="btn btn-primary btn-sm"
                disabled={act.busy || !note.trim()}
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
          </div>
        )}
      </div>
    </li>
  );
}
