import { useState } from 'react';
import { CaretDownIcon, FileTextIcon, WarningIcon } from '@phosphor-icons/react';
import type { ProofInput } from '@prima/core';
import { api, type Reports } from '../api';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { Card, Empty, PageHead, Search, Stat, Stats, Toolbar } from '../kit';
import { ProofPicker } from './Proof';
import '../styles/leadership.css';

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
    <div className="page ld">
      <PageHead
        title="Reports to the Director Office"
        sub="Weekly and monthly reports each company and central department sends. The Director Office Administrator sets the list and follows who has sent."
        actions={
          data.canEdit &&
          data.editList && (
            <button className="btn btn-primary" onClick={() => setEditing(true)}>
              Change the report list
            </button>
          )
        }
      />
      {editing && data.editList && <ReportListEditor list={data.editList} departments={data.departments} onDone={() => setEditing(false)} />}
      {data.mine.length > 0 && (
        <>
          <Stats>
            <Stat label="Reports you send" value={data.mine.length} icon={<FileTextIcon />} tone="info" />
            <Stat label="Overdue" value={due} tone={due ? 'crit' : 'ok'} icon={<WarningIcon />} />
          </Stats>
          <Card title="To send" sub="Choose a period to send its report" flush>
            <ul className="ld-rows">
              {data.mine.map((m) => (
                <MineRow key={`${m.def.id}:${m.companyId}`} m={m} />
              ))}
            </ul>
          </Card>
        </>
      )}
      {data.board && <Board board={data.board} />}
      {data.mine.length === 0 && !data.board && (
        <Card>
          <Empty title="No report is due from you." />
        </Card>
      )}
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
    <li className="ld-report">
      <div className="ld-report-head">
        <span className="ld-row-title">{m.def.name}</span>
        <span className="ld-row-meta">
          {m.companyName ? `${m.companyName} · ` : ''}
          {when(m.def)} · {m.def.detail}
        </span>
      </div>
      <div className="ld-periods" role="group" aria-label={`Periods of ${m.def.name}`}>
        {m.periods.map((x) => (
          <button
            key={x.period}
            type="button"
            className="ld-period"
            data-status={x.status}
            aria-pressed={sending === x.period}
            disabled={!!x.sent}
            title={x.sent ? `Sent by ${x.sent.by}, ${dateTimeLabel(x.sent.at)}` : `Due ${dateLabel(x.due)}`}
            onClick={() => setSending(sending === x.period ? null : x.period)}
          >
            <span className="ld-period-name">{x.period}</span>
            <Chip tone={STATUS[x.status].tone}>{STATUS[x.status].label}</Chip>
          </button>
        ))}
      </div>
      {p && (
        <div className="ld-subpanel">
          <h3>
            Send {m.def.name} for {p.label} (due {dateLabel(p.due)})
          </h3>
          <ProofPicker site={null} refText="Report" items={proof} onChange={setProof} documentsOnly required />
          {sections.length > 0 && (
            <fieldset className="ld-checks">
              <legend className="label">Standard form (set by ACT): tick each section your report covers</legend>
              {sections.map((x) => (
                <label key={x} className="ld-check">
                  <input
                    type="checkbox"
                    checked={covered.includes(x)}
                    onChange={(e) => setCovered(e.target.checked ? [...covered, x] : covered.filter((y) => y !== x))}
                  />
                  <span>{x}</span>
                </label>
              ))}
            </fieldset>
          )}
          <label className="field">
            <span className="label">Note (optional)</span>
            <input className="input" aria-label="Report note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <ErrorNotice error={act.error} />
          <div className="ld-actions">
            <button className="btn btn-sm" onClick={() => setSending(null)}>
              Cancel
            </button>
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
    </li>
  );
}

type BoardShow = 'all' | 'missing' | 'late' | 'company' | 'department';
const BOARD_SHOW: [BoardShow, string][] = [
  ['all', 'All'],
  ['missing', 'Not sent'],
  ['late', 'Late'],
  ['company', 'From companies'],
  ['department', 'From departments'],
];

function Board({ board }: { board: NonNullable<Reports['board']> }) {
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [show, setShow] = useState<BoardShow>('all');
  const needle = q.trim().toLowerCase();
  const rows = board.filter(
    (b) =>
      (!needle || `${b.def.name} ${b.rows[0]?.name ?? ''}`.toLowerCase().includes(needle)) &&
      (show === 'all' ||
        (show === 'missing' && b.totals.missing > 0) ||
        (show === 'late' && b.totals.late > 0) ||
        (show === 'company' && b.def.from === 'company') ||
        (show === 'department' && b.def.from !== 'company')),
  );
  const missing = board.reduce((s, b) => s + b.totals.missing, 0);
  const late = board.reduce((s, b) => s + b.totals.late, 0);
  const onTime = board.reduce((s, b) => s + b.totals.onTime, 0);
  return (
    <section className="ld-section" aria-labelledby="ld-board">
      <div className="ld-section-head">
        <h2 id="ld-board">Who has sent</h2>
        <span className="muted small">Latest period due for each report</span>
      </div>
      <Stats>
        <Stat label="Reports on the list" value={board.length} icon={<FileTextIcon />} tone="info" onClick={() => setShow('all')} />
        <Stat label="Sent on time" value={onTime} tone="ok" />
        <Stat label="Sent late" value={late} tone={late ? 'warn' : 'ok'} onClick={() => setShow('late')} />
        <Stat label="Not sent" value={missing} tone={missing ? 'crit' : 'ok'} onClick={() => setShow('missing')} />
      </Stats>
      <Toolbar
        end={
          <div className="seg ld-seg" role="group" aria-label="Show reports">
            {BOARD_SHOW.map(([k, label]) => (
              <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)}>
                {label}
              </button>
            ))}
          </div>
        }
      >
        <Search value={q} onChange={setQ} placeholder="Search reports" />
      </Toolbar>
      <div className="k-card">
        {rows.length === 0 && <Empty title="No report matches." />}
        <ul className="ld-rows">
          {rows.map((b) => {
            const isOpen = open === b.def.id;
            return (
              <li key={b.def.id} className="ld-cat" data-open={isOpen}>
                <button type="button" className="ld-cat-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : b.def.id)}>
                  <span className="ld-row-main">
                    <span className="ld-row-title">{b.def.name}</span>
                    <span className="ld-row-meta">
                      {b.period.label}, due {dateLabel(b.period.due)} · from {b.def.from === 'company' ? 'every company' : b.rows[0]?.name}
                    </span>
                  </span>
                  <span className="ld-chips ld-cat-chips">
                    {b.totals.onTime > 0 && <Chip tone="ok">{b.totals.onTime} on time</Chip>}
                    {b.totals.late > 0 && <Chip tone="warn">{b.totals.late} late</Chip>}
                    {b.totals.missing > 0 && <Chip tone="crit">{b.totals.missing} not sent</Chip>}
                    {b.totals.notDue > 0 && <Chip tone="neutral">{b.totals.notDue} not due</Chip>}
                    {b.totals.unknown > 0 && <Chip tone="unknown">{b.totals.unknown} unknown</Chip>}
                  </span>
                  <CaretDownIcon className="ld-cat-caret" size={16} aria-hidden="true" />
                </button>
                {isOpen && (
                  <div className="ld-cat-body">
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>From</th>
                            <th>Sent</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {b.rows
                            .filter((r) => r.status !== 'unknown')
                            .map((r) => (
                              <tr key={r.key}>
                                <td>{r.name}</td>
                                <td className="muted">
                                  {r.sent ? (
                                    <>
                                      {r.sent.by}, {dateTimeLabel(r.sent.at)}
                                      {r.sent.note ? ` · ${r.sent.note}` : ''}
                                    </>
                                  ) : (
                                    '–'
                                  )}
                                </td>
                                <td>
                                  <Chip tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Chip>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                    {b.totals.unknown > 0 && (
                      <p className="muted small ld-pad">{b.totals.unknown} companies are not on the app yet, so their reports are Unknown.</p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
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
      <div className="ld-editor">
        {defs.map((d, i) => (
          <fieldset key={d.id || `new-${i}`} className="ld-def">
            <legend className="ld-def-legend">{d.name || 'New report'}</legend>
            <label className="field">
              <span className="label">Report name</span>
              <input className="input" aria-label="Report name" placeholder="Report name" value={d.name} onChange={(e) => set(i, { name: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">What it covers</span>
              <input
                className="input"
                aria-label="What it covers"
                placeholder="What it covers"
                value={d.detail}
                onChange={(e) => set(i, { detail: e.target.value })}
              />
            </label>
            <div className="ld-form">
              <label className="field">
                <span className="label">Sent by</span>
                <select className="select" aria-label="Sent by" value={d.from} onChange={(e) => set(i, { from: e.target.value as Def['from'] })}>
                  <option value="company">Every company</option>
                  <option value="department">A central department</option>
                </select>
              </label>
              {d.from === 'department' && (
                <label className="field">
                  <span className="label">Department</span>
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
                </label>
              )}
              <label className="field">
                <span className="label">How often</span>
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
              </label>
              {d.frequency === 'yearly' || d.frequency === 'once' ? (
                <label className="field">
                  <span className="label">Due date</span>
                  <input className="input" type="date" aria-label="Due date" value={d.dueOn ?? ''} onChange={(e) => set(i, { dueOn: e.target.value })} />
                </label>
              ) : (
                <label className="field">
                  <span className="label">Due</span>
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
                </label>
              )}
            </div>
            <div className="ld-actions">
              <button className="btn btn-sm btn-ghost" onClick={() => setDefs(defs.filter((_, j) => j !== i))}>
                Take off the list
              </button>
            </div>
          </fieldset>
        ))}
        <button
          className="btn btn-sm ld-add"
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
        <div className="ld-sticky">
          <label className="field">
            <span className="label">What changed and why</span>
            <input className="input" aria-label="What changed" placeholder="What changed and why" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <ErrorNotice error={act.error} />
          <div className="ld-actions">
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
          </div>
        </div>
      </div>
    </Drawer>
  );
}
