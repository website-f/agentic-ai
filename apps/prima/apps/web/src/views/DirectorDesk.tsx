import { Select } from '../SearchSelect';
import { useState } from 'react';
import { api } from '../api';
import { useApp } from '../App';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, n, useAction, useLoad } from '../ui';
import { DataTable, type DtColumn, type DtFilter } from '../DataTable';
import { Card, Empty, Person, Stat, Stats } from '../kit';
import { CentralAdminGuide } from './CentralAdminGuide';

/**
 * Central Admin 5E (Fauzan, 2 Nov 2026): the weekly Director Office digest, put together from what is already keyed in,
 * and CEO instructions tracked to done. The CEO gives an instruction, or the Director Office records it for the CEO; it
 * lands in the owner's own task list and the CEO accepts the result with a reason.
 */
/** The CEO instructions as loaded once by the Director Office screen (P121: it also shows a jump button at the top). */
export type CeoInstructionsLoad = { data: Awaited<ReturnType<typeof api.ceoInstructions>> | null; reload: () => void };

export function DirectorDesk({ instr }: { instr: CeoInstructionsLoad }) {
  const { go } = useApp();
  const digest = useLoad(() => api.directorDigest().catch(() => null), []);
  const legal = useLoad(() => api.directorLegalFlags().catch(() => null), []);
  if (digest.error) return <ErrorNotice error={digest.error} />;
  if (digest.loading && !digest.data) return <Loading what="weekly digest" />;
  return (
    <>
      {digest.data && (
        <Card
          title="This week"
          sub={`${dateLabel(digest.data.week.from)} to ${dateLabel(digest.data.week.to)} · put together from what is keyed in`}
        >
          <div className="ld-stack">
            <Stats>
              {digest.data.lines.map((l) => (
                <Stat
                  key={l.key}
                  label={l.label}
                  value={n(l.value)}
                  tone={l.tone}
                  onClick={() => go({ view: l.go as never })}
                />
              ))}
            </Stats>
            {digest.data.meetings.length > 0 && (
              <ul className="ld-mini">
                {digest.data.meetings.slice(0, 10).map((m) => (
                  <li key={m.id}>
                    <span className="mono small ld-mini-when">{m.start.slice(0, 16).replace('T', ' ')}</span>
                    <span className="ld-mini-what">
                      {m.title} <span className="muted">· {m.companyName}</span>
                    </span>
                    {m.prepState === 'late' && <Chip tone="crit">pre-brief late</Chip>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}
      {instr.data && (
        <div id="ceo-instructions">
          <Instructions data={instr.data} reload={instr.reload} />
        </div>
      )}
      {legal.data && <LegalFlags data={legal.data} />}
      <CentralAdminGuide view="doa" />
    </>
  );
}

/** The CEO accepts a finished instruction with a reason, or returns it with what to fix (the server checks who may). */
function ReviewResult({ taskId, reload }: { taskId: string; reload: () => void }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const decide = (accept: boolean) =>
    act.run(() => api.workTaskReview(taskId, accept, note).then(reload), accept ? 'Accepted.' : 'Returned to fix.');
  return (
    <span className="ld-row-full ld-inline-add">
      <input className="input" aria-label="Reason" placeholder="Reason (to return it, say what to fix)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn btn-sm btn-primary" disabled={act.busy || !note.trim()} onClick={() => decide(true)}>
        Accept
      </button>
      <button className="btn btn-sm" disabled={act.busy || note.trim().length < 10} onClick={() => decide(false)}>
        Return to fix
      </button>
      {act.error && <span className="error small">{act.error.message}</span>}
    </span>
  );
}

type InstructionRow = NonNullable<Awaited<ReturnType<typeof api.ceoInstructions>>>['rows'][number];
type FlagRow = NonNullable<Awaited<ReturnType<typeof api.directorLegalFlags>>>['rows'][number];
const I_TONE = {
  overdue: 'crit',
  open: 'info',
  returned: 'warn',
  waiting_review: 'warn',
  accepted: 'ok',
} as const;
const I_LABEL = {
  overdue: 'Overdue',
  open: 'Open',
  returned: 'Returned to fix',
  waiting_review: 'Done, waiting for the CEO',
  accepted: 'Accepted',
} as const;
const when = (iso: string) => iso.slice(0, 16).replace('T', ' ');
const INSTRUCTION_COLUMNS: DtColumn<InstructionRow>[] = [
  { id: 'title', label: 'Instruction', value: (r) => r.task.title, render: (r) => <strong>{r.task.title}</strong>, phone: 'title' },
  { id: 'who', label: 'Who', value: (r) => r.task.userName, render: (r) => <Person name={r.task.userName} size={24} />, phone: 'sub' },
  { id: 'due', label: 'Due', value: (r) => r.dueAt, sort: 'date', render: (r) => <span className="mono small">{when(r.dueAt)}</span> },
  { id: 'done', label: 'Done means', value: (r) => r.task.doneMeans, sort: false, hideBelow: 1200 },
  { id: 'from', label: 'From', value: (r) => r.task.assignedBy, hideBelow: 1300 },
  { id: 'state', label: 'Status', value: (r) => I_LABEL[r.state], translate: true, render: (r) => <Chip tone={I_TONE[r.state]}>{I_LABEL[r.state]}</Chip> },
];
const INSTRUCTION_FILTERS: DtFilter<InstructionRow>[] = [
  { id: 'show', label: 'Show', value: (r) => (r.state === 'accepted' ? 'accepted' : 'open'), options: [{ value: 'open', label: 'Not accepted yet' }, { value: 'accepted', label: 'Accepted' }] },
  { id: 'state', label: 'Status', value: (r) => r.state, optionLabel: (v) => I_LABEL[v as InstructionRow['state']] ?? v },
  { id: 'who', label: 'Who', value: (r) => r.task.userName },
];
const FLAG_COLUMNS: DtColumn<FlagRow>[] = [
  { id: 'title', label: 'Legal point', value: (r) => r.title, render: (r) => <strong>{r.title}</strong>, phone: 'title' },
  { id: 'source', label: 'Source', value: (r) => r.source, phone: 'sub' },
  { id: 'since', label: 'Since', value: (r) => r.since, sort: 'date' },
  { id: 'responsible', label: 'Responsible', value: (r) => `${r.responsible}${r.responsibleAssumed ? ' (assumed, to confirm)' : ''}` },
  { id: 'records', label: 'Records', value: (r) => r.records.length, sort: 'number', hideBelow: 1100 },
  { id: 'status', label: 'Status', value: () => 'Open', translate: true, sort: false, render: () => <Chip tone="warn">Open</Chip> },
];
const FLAG_FILTERS: DtFilter<FlagRow>[] = [
  { id: 'source', label: 'Source', value: (r) => r.source },
  { id: 'responsible', label: 'Responsible', value: (r) => r.responsible },
];

function Instructions({ data, reload }: { data: NonNullable<Awaited<ReturnType<typeof api.ceoInstructions>>>; reload: () => void }) {
  const { me } = useApp();
  const ceo = me.user.opsTier === 'ceo';
  const act = useAction();
  const [userId, setUserId] = useState('');
  const [title, setTitle] = useState('');
  const [doneMeans, setDoneMeans] = useState('');
  const [due, setDue] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const open = data.rows.find((r) => r.task.id === openId);
  return (
    <Card title="CEO instructions">
      <div className="ld-stack">
        <Stats>
          <Stat label="Overdue" value={data.totals.overdue} tone={data.totals.overdue ? 'crit' : 'ok'} />
          <Stat label="Open" value={data.totals.open} />
          <Stat label="Waiting for the CEO" value={data.totals.waiting} tone={data.totals.waiting ? 'warn' : 'ok'} />
          <Stat label="Done" value={data.totals.done} tone="ok" />
        </Stats>

        <div className="ld-subpanel">
          <h3>Give an instruction</h3>
          <div className="ld-form ld-form-4">
            <label className="field">
              <span className="label">Who</span>
              <Select className="select" aria-label="Who" value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Who does it</option>
                {data.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="field">
              <span className="label">Instruction</span>
              <input className="input" aria-label="Instruction" placeholder="The instruction" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Done means</span>
              <input
                className="input"
                aria-label="Done means"
                placeholder='What "done" looks like'
                value={doneMeans}
                onChange={(e) => setDoneMeans(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="label">Due</span>
              <input className="input" aria-label="Due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
            </label>
          </div>
          {act.error && (
            <p className="notice" data-tone="crit">
              {act.error.message}
            </p>
          )}
          <div className="ld-actions">
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy || !userId || !due}
              onClick={() =>
                act.run(
                  () =>
                    api
                      .ceoInstruct({
                        userId,
                        title,
                        doneMeans,
                        dueAt: new Date(due).toISOString(),
                        priority: 'high',
                      })
                      .then(() => {
                        setTitle('');
                        setDoneMeans('');
                        reload();
                      }),
                  'Instruction given.',
                )
              }
            >
              Give instruction
            </button>
          </div>
        </div>

        <DataTable
          label="CEO instructions"
          stateKey="board.doa.instructions"
          defaults={{ f: { show: 'open' } }}
          rows={data.rows}
          rowKey={(r) => r.task.id}
          columns={INSTRUCTION_COLUMNS}
          filters={INSTRUCTION_FILTERS}
          searchText={(r) => r.task.evidence?.note ?? ''}
          onRowClick={(r) => setOpenId(r.task.id)}
          rowTone={(r) => (I_TONE[r.state] === 'crit' ? 'crit' : I_TONE[r.state] === 'warn' ? 'warn' : undefined)}
          actions={(r) => [{ label: ceo && r.state === 'waiting_review' ? 'Review' : 'Open', onClick: () => setOpenId(r.task.id) }]}
          empty={<Empty title="No open instructions." />}
        />
        {open && (
          <Drawer title={open.task.title} sub={`${open.task.userName} · due ${when(open.dueAt)}`} onClose={() => setOpenId(null)}>
            <div className="ld-stack">
              <p className="ld-row-meta">
                Done means: {open.task.doneMeans} · from {open.task.assignedBy}
              </p>
              {open.task.evidence && <p className="ld-row-text">Result: {open.task.evidence.note}</p>}
              <Chip tone={I_TONE[open.state]}>{I_LABEL[open.state]}</Chip>
              {ceo && open.state === 'waiting_review' && <ReviewResult taskId={open.task.id} reload={reload} />}
            </div>
          </Drawer>
        )}
      </div>
    </Card>
  );
}

/**
 * Legal flags for the directors only (main review, 2 Nov 2026). Staff screens show the work to do; the directors
 * see the legal point, its source, the records it touches, who answers for it, its status and the audit trail. An open
 * point is never shown as compliant.
 */
function LegalFlags({ data }: { data: NonNullable<Awaited<ReturnType<typeof api.directorLegalFlags>>> }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const r = data.rows.find((x) => x.id === openId);
  return (
    <section className="k-card" aria-label="Legal flags">
      <div className="k-card-head">
        <div className="k-card-title">
          <h2>Legal flags</h2>
          <p>Directors only · {data.totals.open} open · not confirmed compliant until resolved</p>
        </div>
        <Chip tone={data.totals.open ? 'warn' : 'ok'}>{data.totals.open}</Chip>
      </div>
      <DataTable
        label="Legal flags"
        stateKey="board.doa.legalflags"
        rows={data.rows}
        rowKey={(x) => x.id}
        columns={FLAG_COLUMNS}
        filters={FLAG_FILTERS}
        searchText={(x) => `${x.detail} ${x.records.map((y) => y.label).join(' ')}`}
        onRowClick={(x) => setOpenId(x.id)}
        rowTone={() => 'warn'}
        actions={(x) => [{ label: `History (${x.history.length})`, onClick: () => setOpenId(x.id) }]}
        empty={<Empty title="No open legal flags in the records you can see." />}
      />
      {r && (
        <Drawer title={r.title} sub={`Source: ${r.source} · since ${dateLabel(r.since)}`} onClose={() => setOpenId(null)}>
          <div className="ld-stack">
            <p className="ld-row-meta">
              Responsible: {r.responsible}
              {r.responsibleAssumed ? ' (assumed, to confirm)' : ''}
            </p>
            <p className="ld-row-text">
              {r.detail} Records: {r.records.map((x) => x.label).join('; ')}
            </p>
            <ul className="ld-mini">
              {r.history.map((h, i) => (
                <li key={i}>
                  <span className="mono small ld-mini-when">{when(h.at)}</span>
                  <span className="ld-mini-what">
                    {h.actor} · {h.summary}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Drawer>
      )}
    </section>
  );
}
