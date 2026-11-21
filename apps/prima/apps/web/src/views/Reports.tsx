import { Select } from '../SearchSelect';
import { useState } from 'react';
import { FileTextIcon, WarningIcon } from '@phosphor-icons/react';
import type { ProofInput } from '@prima/core';
import { api, type Reports } from '../api';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { Card, Empty, PageHead, Stat, Stats } from '../kit';
import { DataTable, useTableState, type DtColumn, type DtFilter } from '../DataTable';
import { ProofPicker } from './Proof';
import '../styles/leadership.css';
import { SopHelp } from '../sop/SopHelp';

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
          <>
            <SopHelp id="board-monthly-report" />
            {data.canEdit && data.editList && (
              <button className="btn btn-primary" onClick={() => setEditing(true)}>
                Change the report list
              </button>
            )}
          </>
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
                      sections: covered,
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

type BoardRow = NonNullable<Reports['board']>[number];
const boardFrom = (b: BoardRow) => (b.def.from === 'company' ? 'Every company' : (b.rows[0]?.name ?? ''));

/** P107: the board as a data table; a row opens who has sent under it, as the old folded rows did. */
const BOARD_COLUMNS: DtColumn<BoardRow>[] = [
  { id: 'name', label: 'Report', value: (b) => b.def.name, phone: 'title', render: (b) => <span className="ld-row-title">{b.def.name}</span> },
  { id: 'period', label: 'Period', value: (b) => b.period.label, sort: false, phone: 'sub' },
  { id: 'due', label: 'Due', value: (b) => b.period.due, sort: 'date' },
  { id: 'from', label: 'From', value: boardFrom, translate: true, hideBelow: 1100 },
  {
    id: 'status',
    label: 'Status',
    // Sorted by how many have not sent.
    value: (b) => b.totals.missing,
    sort: 'number',
    search: false,
    align: 'left',
    render: (b) => (
      <span className="ld-chips">
        {b.totals.onTime > 0 && <Chip tone="ok">{b.totals.onTime} on time</Chip>}
        {b.totals.late > 0 && <Chip tone="warn">{b.totals.late} late</Chip>}
        {b.totals.missing > 0 && <Chip tone="crit">{b.totals.missing} not sent</Chip>}
        {b.totals.notDue > 0 && <Chip tone="neutral">{b.totals.notDue} not due</Chip>}
        {b.totals.unknown > 0 && <Chip tone="unknown">{b.totals.unknown} unknown</Chip>}
      </span>
    ),
  },
];
const BOARD_FILTERS: DtFilter<BoardRow>[] = [
  {
    id: 'show',
    label: 'Show',
    value: (b) => [...(b.totals.missing > 0 ? ['missing'] : []), ...(b.totals.late > 0 ? ['late'] : [])],
    options: [
      { value: 'missing', label: 'Not sent' },
      { value: 'late', label: 'Late' },
    ],
  },
  {
    id: 'from',
    label: 'From',
    value: (b) => (b.def.from === 'company' ? 'company' : 'department'),
    options: [
      { value: 'company', label: 'From companies' },
      { value: 'department', label: 'From departments' },
    ],
  },
];

function Board({ board }: { board: NonNullable<Reports['board']> }) {
  const [open, setOpen] = useState<string | null>(null);
  // The tiles pick a filter in the table, as they picked the old "Show" buttons.
  const table = useTableState('reports.board');
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
        <Stat label="Reports on the list" value={board.length} icon={<FileTextIcon />} tone="info" onClick={() => table.set({ f: { show: '', from: '' } })} />
        <Stat label="Sent on time" value={onTime} tone="ok" />
        <Stat label="Sent late" value={late} tone={late ? 'warn' : 'ok'} onClick={() => table.set({ f: { show: 'late' } })} />
        <Stat label="Not sent" value={missing} tone={missing ? 'crit' : 'ok'} onClick={() => table.set({ f: { show: 'missing' } })} />
      </Stats>
      <DataTable
        label="Who has sent"
        control={table}
        rows={board}
        rowKey={(b) => b.def.id}
        columns={BOARD_COLUMNS}
        filters={BOARD_FILTERS}
        searchPlaceholder="Search reports"
        searchText={(b) => b.rows[0]?.name ?? ''}
        onRowClick={(b) => setOpen(open === b.def.id ? null : b.def.id)}
        rowDetail={(b) => (open === b.def.id ? <BoardDetail b={b} /> : undefined)}
        empty={<Empty title="No report matches." />}
      />
    </section>
  );
}

/** Who has sent one report: the nested table stays as it was. */
function BoardDetail({ b }: { b: BoardRow }) {
  return (
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
      {b.totals.unknown > 0 && <p className="muted small ld-pad">{b.totals.unknown} companies are not on the app yet, so their reports are Unknown.</p>}
    </div>
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
                  <Select
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
                  </Select>
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
                  <Select className="select" aria-label="Due" value={d.dueDay} onChange={(e) => set(i, { dueDay: Number(e.target.value) })}>
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
                  </Select>
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
