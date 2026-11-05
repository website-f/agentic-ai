import { useState } from 'react';
import type { ProofInput } from '@prima/core';
import { api, type Reports } from '../api';
import { Chip, Drawer, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { ProofPicker } from './Proof';

const STATUS: Record<string, { label: string; tone: Tone }> = {
  on_time: { label: 'Sent on time', tone: 'ok' },
  late: { label: 'Sent late', tone: 'warn' },
  missing: { label: 'Not sent', tone: 'crit' },
  not_due: { label: 'Not due yet', tone: 'neutral' },
  unknown: { label: 'Unknown, not on the app', tone: 'unknown' },
};

const DAY = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** How often a report is due, in words (Fauzan, 2 Nov 2026: recurring or one time). */
function when(d: { frequency: string; dueDay: number; dueOn?: string | null }): string {
  switch (d.frequency) {
    case 'weekly':
      return `Weekly, due ${DAY[d.dueDay]}`;
    case 'fortnightly':
      return `Every 2 weeks, due ${DAY[d.dueDay]} of the second week`;
    case 'quarterly':
      return `Quarterly, due on day ${d.dueDay} of the month after the quarter`;
    case 'yearly':
      return `Yearly, due ${d.dueOn ? d.dueOn.slice(5) : 'on the set date'} each year`;
    case 'once':
      return `One time, due ${d.dueOn ?? 'on the set date'}`;
    default:
      return `Monthly, due on day ${d.dueDay} of the next month`;
  }
}

/** Weekly and monthly reports to the Director Office (Fauzan, 25 Oct 2026): what you must send, and for the Director Office, who has sent. */
export function ReportsView() {
  const { data, error } = useLoad(() => api.reports(), []);
  const [editing, setEditing] = useState(false);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="reports" />
      </div>
    );
  const due = data.mine.flatMap((m) => m.periods).filter((p) => p.status === 'missing').length;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Reports to the Director Office</h1>
          <p>Weekly and monthly reports each company and central department sends. The Director Office Administrator sets the list and follows who has sent.</p>
        </div>
        {data.canEdit && data.editList && (
          <button className="btn btn-primary" onClick={() => setEditing(true)}>
            Change the report list
          </button>
        )}
      </div>
      {editing && data.editList && <ReportListEditor list={data.editList} departments={data.departments} onDone={() => setEditing(false)} />}
      {data.mine.length > 0 && (
        <>
          <div className="kpis">
            <Kpi label="Reports you send" value={data.mine.length} />
            <Kpi label="Overdue" value={due} tone={due ? 'crit' : 'ok'} />
          </div>
          <section className="panel">
            <div className="panel-head">
              <h3>To send</h3>
            </div>
            <div className="list">
              {data.mine.map((m) => (
                <MineRow key={`${m.def.id}:${m.companyId}`} m={m} />
              ))}
            </div>
          </section>
        </>
      )}
      {data.board && <Board board={data.board} />}
      {data.mine.length === 0 && !data.board && <div className="empty">No report is due from you.</div>}
      <p className="muted small">The starting list is a proposal; the Director Office Administrator changes it with Change the report list.</p>
    </div>
  );
}

function MineRow({ m }: { m: Reports['mine'][number] }) {
  const [sending, setSending] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const [covered, setCovered] = useState<string[]>([]);
  const act = useAction();
  const p = m.periods.find((x) => x.period === sending);
  const sections = m.def.sections ?? [];
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div>
        <div style={{ fontWeight: 600 }}>{m.def.name}</div>
        <div className="muted small">
          {m.companyName ? `${m.companyName} · ` : ''}
          {when(m.def)} · {m.def.detail}
        </div>
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {m.periods.map((x) => (
          <button
            key={x.period}
            className="btn btn-sm"
            aria-pressed={sending === x.period}
            disabled={!!x.sent}
            title={x.sent ? `Sent by ${x.sent.by}, ${dateTimeLabel(x.sent.at)}` : `Due ${dateLabel(x.due)}`}
            onClick={() => setSending(sending === x.period ? null : x.period)}
          >
            {x.period} <Chip tone={STATUS[x.status].tone}>{STATUS[x.status].label}</Chip>
          </button>
        ))}
      </div>
      {p && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="small">
            Send {m.def.name} for {p.label} (due {dateLabel(p.due)})
          </div>
          <ProofPicker site={null} refText="Report" items={proof} onChange={setProof} documentsOnly required />
          {sections.length > 0 && (
            <fieldset style={{ display: 'grid', gap: 4, border: 0, padding: 0, margin: 0 }}>
              <legend className="small">Standard form (set by ACT): tick each section your report covers</legend>
              {sections.map((x) => (
                <label key={x} className="small" style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    checked={covered.includes(x)}
                    onChange={(e) => setCovered(e.target.checked ? [...covered, x] : covered.filter((y) => y !== x))}
                  />
                  {x}
                </label>
              ))}
            </fieldset>
          )}
          <input className="input" aria-label="Report note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <ErrorNotice error={act.error} />
          <div>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !proof.length}
              onClick={async () => {
                const r = await act.run(
                  () =>
                    api.submitReport({
                      defId: m.def.id,
                      period: p.period,
                      companyId: m.companyId,
                      note,
                      proof,
                    }),
                  'Report sent to the Director Office.',
                );
                if (r) {
                  setSending(null);
                  setProof([]);
                  setNote('');
                  setCovered([]);
                }
              }}
            >
              Send report
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Board({ board }: { board: NonNullable<Reports['board']> }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Who has sent</h3>
        <span className="muted small">Latest period due for each report</span>
      </div>
      <div className="list">
        {board.map((b) => (
          <div key={b.def.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
            <button
              className="list-button"
              style={{
                textAlign: 'left',
                background: 'none',
                border: 0,
                padding: 0,
              }}
              onClick={() => setOpen(open === b.def.id ? null : b.def.id)}
            >
              <div style={{ fontWeight: 600 }}>{b.def.name}</div>
              <div className="muted small">
                {b.period.label}, due {dateLabel(b.period.due)} · from {b.def.from === 'company' ? 'every company' : b.rows[0]?.name}
              </div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {b.totals.onTime > 0 && <Chip tone="ok">{b.totals.onTime} on time</Chip>}
                {b.totals.late > 0 && <Chip tone="warn">{b.totals.late} late</Chip>}
                {b.totals.missing > 0 && <Chip tone="crit">{b.totals.missing} not sent</Chip>}
                {b.totals.notDue > 0 && <Chip tone="neutral">{b.totals.notDue} not due</Chip>}
                {b.totals.unknown > 0 && <Chip tone="unknown">{b.totals.unknown} unknown</Chip>}
              </div>
            </button>
            {open === b.def.id && (
              <div className="list">
                {b.rows
                  .filter((r) => r.status !== 'unknown')
                  .map((r) => (
                    <div key={r.key} className="list-item">
                      <div>
                        <div>{r.name}</div>
                        {r.sent && (
                          <div className="muted small">
                            {r.sent.by}, {dateTimeLabel(r.sent.at)}
                            {r.sent.note ? ` · ${r.sent.note}` : ''}
                          </div>
                        )}
                      </div>
                      <Chip tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Chip>
                    </div>
                  ))}
                {b.totals.unknown > 0 && (
                  <div className="muted small" style={{ padding: 8 }}>
                    {b.totals.unknown} companies are not on the app yet, so their reports are Unknown.
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

type Def = NonNullable<Reports['editList']>[number];

/** The Director Office Administrator adds, changes or takes reports off the list; a report taken off keeps its history. */
function ReportListEditor({ list, departments, onDone }: { list: Def[]; departments: Reports['departments']; onDone: () => void }) {
  const act = useAction();
  const [defs, setDefs] = useState<Def[]>(list);
  const [note, setNote] = useState('');
  const set = (i: number, patch: Partial<Def>) => setDefs(defs.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  return (
    <Drawer title="Report list" sub="Who sends what, how often and when it is due. A report taken off the list keeps its history." onClose={onDone}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {defs.map((d, i) => (
          <div
            key={d.id || `new-${i}`}
            className="panel"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: 10,
            }}
          >
            <input className="input" aria-label="Report name" placeholder="Report name" value={d.name} onChange={(e) => set(i, { name: e.target.value })} />
            <input
              className="input"
              aria-label="What it covers"
              placeholder="What it covers"
              value={d.detail}
              onChange={(e) => set(i, { detail: e.target.value })}
            />
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <select className="select" aria-label="Sent by" value={d.from} onChange={(e) => set(i, { from: e.target.value as Def['from'] })}>
                <option value="company">Every company</option>
                <option value="department">A central department</option>
              </select>
              {d.from === 'department' && (
                <select
                  className="select"
                  aria-label="Department"
                  value={d.department ?? ''}
                  onChange={(e) =>
                    set(i, {
                      department: (e.target.value || undefined) as Def['department'],
                    })
                  }
                >
                  <option value="">Choose the department</option>
                  {departments.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
                </select>
              )}
              <select
                className="select"
                aria-label="How often"
                value={d.frequency}
                onChange={(e) =>
                  set(i, {
                    frequency: e.target.value as Def['frequency'],
                    dueDay: 1,
                  })
                }
              >
                <option value="weekly">Weekly</option>
                <option value="fortnightly">Every 2 weeks</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
                <option value="once">One time</option>
              </select>
              {d.frequency === 'yearly' || d.frequency === 'once' ? (
                <input className="input" type="date" aria-label="Due date" value={d.dueOn ?? ''} onChange={(e) => set(i, { dueOn: e.target.value })} />
              ) : (
                <select className="select" aria-label="Due" value={d.dueDay} onChange={(e) => set(i, { dueDay: Number(e.target.value) })}>
                  {d.frequency === 'weekly' || d.frequency === 'fortnightly'
                    ? DAY.slice(1).map((x, k) => (
                        <option key={x} value={k + 1}>
                          Due {x}
                        </option>
                      ))
                    : Array.from({ length: 28 }, (_, k) => (
                        <option key={k} value={k + 1}>
                          Due day {k + 1} of the {d.frequency === 'quarterly' ? 'month after the quarter' : 'next month'}
                        </option>
                      ))}
                </select>
              )}
              <button className="btn btn-sm" onClick={() => setDefs(defs.filter((_, j) => j !== i))}>
                Take off the list
              </button>
            </div>
          </div>
        ))}
        <button
          className="btn btn-sm"
          disabled={defs.length >= 40}
          onClick={() =>
            setDefs([
              ...defs,
              {
                id: '',
                name: '',
                detail: '',
                from: 'company',
                frequency: 'monthly',
                dueDay: 7,
                active: true,
              },
            ])
          }
        >
          Add a report
        </button>
        <input className="input" aria-label="What changed" placeholder="What changed and why" value={note} onChange={(e) => setNote(e.target.value)} />
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || note.trim().length < 3}
          onClick={async () => {
            const ok = await act.run(() => api.setReportDefs(defs, note), 'Report list saved.');
            if (ok) onDone();
          }}
        >
          Save the list
        </button>
        <ErrorNotice error={act.error} />
      </div>
    </Drawer>
  );
}
