import { Select } from '../SearchSelect';
import { useState } from 'react';
import { api, type EthicsBoard, type RbaBoard, type RbaTraceBoard, type WorkerFilesBoard } from '../api';
import { DataTable, type DtColumn, type DtFilter } from '../DataTable';
import { Chip, Drawer, ErrorNotice, Kpi, Loading, dateLabel, useAction, useLoad, type Tone } from '../ui';
import { useRouteTab } from '../App';
import { SopHelp } from '../sop/SopHelp';

/**
 * RBA readiness (Fauzan, 8 Nov 2026, after the RBA Code v8.0 checklist review): the monthly dashboard, red items that
 * go to ACT, the Chief of Staff and the COO the same day, the OM's monthly site safety check, the yearly committee the
 * CoS names, ACT's trace review, the worker master file and the ethics declaration staff sign once on entering service. Discipline appeals are the
 * HR appeal step (HR-APPEAL, IWAY). Prima keeps the
 * records; it is not an RBA certificate, and nothing is shown green until there is something to count.
 */

type Tab = 'dashboard' | 'red' | 'sites' | 'committee' | 'trace' | 'files' | 'ethics';
/** P121: the tabs a link may ask for (#rba/trace); the screen still shows only the tabs this person has. */
const RBA_TABS: readonly Tab[] = ['dashboard', 'red', 'sites', 'committee', 'trace', 'files', 'ethics'];
const KPI_TONE: Record<'green' | 'red' | 'unknown', Tone> = { green: 'ok', red: 'crit', unknown: 'unknown' };
const FOLDER: Record<'ok' | 'missing' | 'in_ja' | 'na', { t: string; tone: Tone }> = {
  ok: { t: 'On file', tone: 'ok' },
  missing: { t: 'Missing', tone: 'crit' },
  in_ja: { t: 'In JA', tone: 'info' },
  na: { t: 'Not needed', tone: 'neutral' },
};
const ROLE_LABEL: Record<string, string> = {
  act: 'ACT',
  leader: 'Group leadership',
  hr: 'HR',
  fwm: 'FWM',
  committee: 'RBA committee',
  company: 'Company office',
  ops: 'Operations',
};

export function RbaView() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [tab, setTab] = useRouteTab<Tab>('dashboard', RBA_TABS);
  const board = useLoad(() => api.rbaBoard(companyId), [companyId]);
  // Everyone in the office signs the ethics declaration once on entering service, even without an RBA role.
  if (board.error)
    return (
      <div className="page">
        <div className="page-head">
          <h1>RBA readiness</h1>
          <span style={{ alignSelf: 'flex-start' }}><SopHelp id="gov-rba-ethics" /></span>
        </div>
        <EthicsTab companyId={null} />
      </div>
    );
  if (!board.data)
    return (
      <div className="page">
        <Loading what="RBA readiness" />
      </div>
    );
  const b = board.data;
  const cid = b.companyId;
  const tabs: [Tab, string][] = [
    ...(b.role !== 'ops' ? ([['dashboard', 'Dashboard'], ['red', `Red items (${b.red.length})`]] as [Tab, string][]) : []),
    ['sites', `Site checks (${b.siteChecks.filter((s) => s.overdue).length} due)`],
    ['committee', 'Committee'],
    ...(b.role !== 'ops' && b.role !== 'fwm' ? ([['trace', 'Trace review']] as [Tab, string][]) : []),
    ...(b.can.files ? ([['files', 'Worker files']] as [Tab, string][]) : []),
    ['ethics', 'Ethics declaration'],
  ];
  const current = tabs.some(([t]) => t === tab) ? tab : tabs[0][0];
  return (
    <div className="page">
      <div className="page-head">
        <h1>RBA readiness</h1>
        <span style={{ alignSelf: 'flex-start' }}><SopHelp id={current === 'ethics' || current === 'committee' ? 'gov-rba-ethics' : 'gov-rba-trace'} /></span>
        {b.companies.length > 1 && (
          <Select className="select" aria-label="Company" value={cid ?? ''} onChange={(e) => setCompanyId(e.target.value)}>
            {b.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} {c.name}
              </option>
            ))}
          </Select>
        )}
      </div>
      <span className="muted small">
        You see this as {ROLE_LABEL[b.role] ?? b.role}. Records for the RBA Code v8.0 checklist; this is not a certificate. Unknown means nothing to count yet, never green.
      </span>
      <div className="tabbar" role="tablist" aria-label="RBA" style={{ flexWrap: 'wrap' }}>
        {tabs.map(([t, l]) => (
          <button key={t} role="tab" aria-selected={current === t} onClick={() => setTab(t)}>
            {l}
          </button>
        ))}
      </div>
      {current === 'dashboard' && <Dashboard b={b} />}
      {current === 'red' && <RedItems b={b} />}
      {current === 'sites' && <SiteChecks b={b} />}
      {current === 'committee' && <Committee b={b} />}
      {current === 'trace' && cid && <TraceTab companyId={cid} />}
      {current === 'files' && cid && <FilesTab companyId={cid} />}
      {current === 'ethics' && <EthicsTab companyId={b.role === 'company' ? cid : null} />}
    </div>
  );
}

function Dashboard({ b }: { b: RbaBoard }) {
  if (!b.dashboard.length) return <div className="empty">Choose a company to see its monthly targets.</div>;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Monthly targets</h3>
      </div>
      <div className="kpis">
        {b.dashboard.map((k) => (
          <Kpi key={k.key} label={k.label} value={k.value == null ? 'UNKNOWN' : k.unit === 'pct' ? `${k.value}%` : k.value} note={`${k.unit === 'pct' ? `Target ${k.target}%` : `Target ${k.target}`} · ${k.detail}`} tone={KPI_TONE[k.state]} />
        ))}
      </div>
    </section>
  );
}

function RedItems({ b }: { b: RbaBoard }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Red items</h3>
      </div>
      <span className="muted small" style={{ padding: '0 12px' }}>
        A gap graded red on a site's RBA list goes the same day to ACT, the Chief of Staff and the COO. It clears when the item is checked again as met.
      </span>
      {/* P107: red items as a table: search, site and client list filters. */}
      <DataTable
        label="Red items"
        stateKey="gov.rba.red"
        rows={b.red}
        rowKey={(x) => `${x.codeId}-${x.reqCode}`}
        columns={RED_COLUMNS}
        filters={RED_FILTERS}
        rowTone={() => 'crit'}
        empty={<div className="empty">No red items.</div>}
      />
    </section>
  );
}

type Red = RbaBoard['red'][number];
const RED_COLUMNS: DtColumn<Red>[] = [
  { id: 'site', label: 'Site', value: (x) => x.site, render: (x) => <strong>{x.site}</strong>, phone: 'sub' },
  { id: 'item', label: 'Requirement', value: (x) => `${x.reqCode} ${x.text}`, phone: 'title' },
  { id: 'list', label: 'Client list', value: (x) => x.codeName, hideBelow: 1000 },
  { id: 'by', label: 'Graded by', value: (x) => x.by },
  { id: 'at', label: 'On', value: (x) => x.at.slice(0, 10), sort: 'date' },
  { id: 'note', label: 'Note', value: (x) => x.note, sort: false, hideBelow: 1200 },
];
const RED_FILTERS: DtFilter<Red>[] = [
  { id: 'site', label: 'Site', value: (x) => x.site },
  { id: 'list', label: 'Client list', value: (x) => x.codeName },
];

type SiteCheck = RbaBoard['siteChecks'][number];
const SITE_CHECK_COLUMNS: DtColumn<SiteCheck>[] = [
  { id: 'site', label: 'Site', value: (s) => s.site, render: (s) => <strong>{s.site}</strong>, phone: 'title' },
  { id: 'list', label: 'Client list', value: (s) => s.codeName, phone: 'sub' },
  { id: 'every', label: 'Every (days)', value: (s) => s.everyDays, sort: 'number', hideBelow: 1000 },
  { id: 'last', label: 'Last check', value: (s) => s.lastOn, sort: 'date', render: (s) => (s.lastOn ? dateLabel(s.lastOn) : 'Never checked') },
  { id: 'due', label: 'Due', value: (s) => s.dueOn, sort: 'date' },
  { id: 'state', label: 'Status', value: (s) => (s.overdue ? 'Due' : 'Done'), translate: true, render: (s) => <Chip tone={s.overdue ? 'crit' : 'ok'}>{s.overdue ? 'Due' : 'Done'}</Chip> },
];
const SITE_CHECK_FILTERS: DtFilter<SiteCheck>[] = [
  { id: 'state', label: 'Status', value: (s) => (s.overdue ? 'due' : 'done'), options: [{ value: 'due', label: 'Due' }, { value: 'done', label: 'Done' }] },
  { id: 'list', label: 'Client list', value: (s) => s.codeName },
];

function SiteChecks({ b }: { b: RbaBoard }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Monthly site safety check</h3>
      </div>
      <span className="muted small" style={{ padding: '0 12px' }}>
        The OM who covers the site does the site inspection on the site's client requirements page (Sites, then the site). Sites with an RBA list are checked every 30 days unless the list says otherwise.
      </span>
      <DataTable
        label="Monthly site safety check"
        stateKey="gov.rba.sites"
        rows={b.siteChecks}
        rowKey={(s) => s.codeId}
        columns={SITE_CHECK_COLUMNS}
        filters={SITE_CHECK_FILTERS}
        rowTone={(s) => (s.overdue ? 'crit' : undefined)}
        empty={<div className="empty">No site has a client list with a regular site check.</div>}
      />
    </section>
  );
}

function Committee({ b }: { b: RbaBoard }) {
  const c = b.committee;
  const act = useAction();
  const [edit, setEdit] = useState(false);
  const [picked, setPicked] = useState<string[]>(c.current?.members.flatMap((m) => ('userId' in m && m.userId ? [m.userId] : [])) ?? []);
  const [others, setOthers] = useState('');
  const [note, setNote] = useState('');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>RBA committee {c.year}</h3>
        {c.canName && !edit && (
          <button className="btn btn-sm" onClick={() => setEdit(true)}>
            {c.current ? 'Change members' : 'Name the committee'}
          </button>
        )}
      </div>
      <span className="muted small" style={{ padding: '0 12px' }}>
        The Operations Director and a few company heads; the Chief of Staff chooses up to 6 members every year (Fauzan, 7 and 8 Nov 2026). Each company head sees their own company here; the Operations Director sees every company.
      </span>
      <ErrorNotice error={act.error} />
      {!edit && (
        <div className="list">
          {!c.current && <div className="empty">Not named yet for {c.year}.</div>}
          {c.current?.members.map((m, i) => (
            <div key={i} className="list-item">
              <span>{m.name}</span>
              <Chip tone="neutral">{m.seat === 'ops_director' ? 'Operations Director' : m.seat === 'company_head' ? 'Company head' : 'Member'}</Chip>
            </div>
          ))}
          {c.current && (
            <div className="muted small" style={{ padding: 12 }}>
              Named by {c.current.namedBy} on {c.current.at.slice(0, 10)}
              {'note' in c.current && c.current.note ? ` · ${c.current.note}` : ''}
            </div>
          )}
        </div>
      )}
      {edit && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12 }}>
          {c.candidates.map((u) => (
            <label key={u.userId} className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={picked.includes(u.userId)} onChange={(e) => setPicked(e.target.checked ? [...picked, u.userId] : picked.filter((x) => x !== u.userId))} />
              <span>
                {u.name} <span className="muted small">({u.seat === 'ops_director' ? 'Operations Director' : `Company head${u.company ? `, ${u.company}` : ''}`})</span>
              </span>
            </label>
          ))}
          <input className="input" aria-label="Other members" placeholder="Other members without a sign-in, separated by commas (optional)" value={others} onChange={(e) => setOthers(e.target.value)} />
          <input className="input" aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !picked.length}
              onClick={async () => {
                const r = await act.run(
                  () => api.nameRbaCommittee({ memberUserIds: picked, others: others.split(',').map((x) => ({ name: x.trim() })).filter((x) => x.name), note }),
                  'Committee named.',
                );
                if (r) setEdit(false);
              }}
            >
              Save
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setEdit(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function TraceTab({ companyId }: { companyId: string }) {
  const board = useLoad(() => api.rbaTraceBoard(companyId), [companyId]);
  const act = useAction();
  const lastMonth = (() => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d.toISOString().slice(0, 7);
  })();
  const [period, setPeriod] = useState(lastMonth);
  const [openKey, setOpenKey] = useState<string | null>(null);
  if (board.error) return <ErrorNotice error={board.error} />;
  if (!board.data) return <Loading what="trace reviews" />;
  const t: RbaTraceBoard = board.data;
  const traceRows: TraceLine[] = t.reviews.flatMap((review) => review.rows.map((row) => ({ review, row })));
  const opened = openKey ? traceRows.find((x) => `${x.review.id}-${x.row.personId}` === openKey) : undefined;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Trace review: {t.company.name}</h3>
      </div>
      <span className="muted small" style={{ padding: '0 12px' }}>
        ACT takes {t.rule.value.traceSampleSize} workers for a month, foreign workers first, and checks the roster, the clock, the pay line and the bank proof agree. Guard pay is still in trial, so JA keeps the bank proof.
      </span>
      <ErrorNotice error={act.error} />
      {t.canRun && (
        <div className="row" style={{ gap: 6, padding: 12 }}>
          <input className="input" type="month" aria-label="Month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          <button className="btn btn-primary btn-sm" disabled={act.busy || !period} onClick={() => act.run(() => api.runRbaTrace(companyId, period), 'Trace review done.')}>
            Run the trace
          </button>
        </div>
      )}
      {!t.reviews.length && <div className="empty">No trace review yet.</div>}
      {/* P107: each review's summary line, then every worker of every review in one table; a row opens its mismatches. */}
      {t.reviews.map((r) => (
        <div key={r.id} className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', padding: '4px 12px' }}>
          <strong>
            {r.ref} · {r.period}
          </strong>
          <span className="muted small">
            {r.rows.length} workers · {r.rows.filter((x) => x.mismatches.length).length} with a mismatch · by {r.by.name}
          </span>
        </div>
      ))}
      {t.reviews.length > 0 && (
        <DataTable
          label="Trace review workers"
          stateKey="gov.rba.trace"
          rows={traceRows}
          rowKey={(x) => `${x.review.id}-${x.row.personId}`}
          columns={TRACE_COLUMNS}
          filters={TRACE_FILTERS}
          onRowClick={(x) => setOpenKey(`${x.review.id}-${x.row.personId}`)}
          rowTone={(x) => (traceResult(x.row)[0] === 'crit' ? 'crit' : undefined)}
        />
      )}
      {opened && (
        <Drawer title={`${opened.row.staffNo} ${opened.row.name}`} sub={`${opened.review.ref} · ${opened.review.period}`} onClose={() => setOpenKey(null)}>
          <TraceRowItem reviewId={opened.review.id} row={opened.row} canSettle={t.canRun} />
        </Drawer>
      )}
    </section>
  );
}

type TraceReview = RbaTraceBoard['reviews'][number];
type TraceLine = { review: TraceReview; row: TraceReview['rows'][number] };
const traceResult = (x: TraceLine['row']): [Tone, string] => [
  !x.mismatches.length ? 'ok' : x.outcome && x.outcome.kind !== 'finding' ? 'neutral' : 'crit',
  !x.mismatches.length ? 'Agrees' : x.outcome ? x.outcome.kind : 'Mismatch',
];
const TRACE_COLUMNS: DtColumn<TraceLine>[] = [
  { id: 'name', label: 'Name', value: (x) => x.row.name, render: (x) => <span><strong>{x.row.staffNo}</strong> {x.row.name}</span>, phone: 'title' },
  { id: 'nationality', label: 'Nationality', value: (x) => x.row.nationality, phone: 'sub' },
  { id: 'review', label: 'Review', value: (x) => `${x.review.ref} · ${x.review.period}`, hideBelow: 1100 },
  { id: 'roster', label: 'Roster hours', value: (x) => x.row.rosterHours, sort: 'number' },
  { id: 'clock', label: 'Clocked hours', value: (x) => x.row.clockedHours, sort: 'number' },
  { id: 'payDays', label: 'Paid days', value: (x) => x.row.payDays, sort: 'number', render: (x) => x.row.payDays ?? 'none', hideBelow: 1000 },
  { id: 'paid', label: 'Paid', value: (x) => x.row.paid.replace('_', ' '), hideBelow: 1200 },
  { id: 'result', label: 'Result', value: (x) => traceResult(x.row)[1], translate: true, render: (x) => <Chip tone={traceResult(x.row)[0]}>{traceResult(x.row)[1]}</Chip> },
];
const TRACE_FILTERS: DtFilter<TraceLine>[] = [
  { id: 'review', label: 'Review', value: (x) => `${x.review.ref} · ${x.review.period}` },
  { id: 'result', label: 'Result', value: (x) => traceResult(x.row)[1] },
  { id: 'nationality', label: 'Nationality', value: (x) => x.row.nationality },
];

function TraceRowItem({ reviewId, row: x, canSettle }: { reviewId: string; row: RbaTraceBoard['reviews'][number]['rows'][number]; canSettle: boolean }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const open = x.mismatches.length > 0 && (!x.outcome || x.outcome.kind === 'finding');
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <span>
          <strong>{x.staffNo}</strong> {x.name} <span className="muted small">({x.nationality})</span>
        </span>
        <span className="muted small">
          Roster {x.rosterHours}h · clock {x.clockedHours}h · paid days {x.payDays ?? 'none'} · {x.paid.replace('_', ' ')}
        </span>
        <Chip tone={!x.mismatches.length ? 'ok' : x.outcome && x.outcome.kind !== 'finding' ? 'neutral' : 'crit'}>
          {!x.mismatches.length ? 'Agrees' : x.outcome ? x.outcome.kind : 'Mismatch'}
        </Chip>
      </div>
      {x.mismatches.map((m, i) => (
        <span key={i} className="small">
          · {m}
        </span>
      ))}
      {x.outcome && (
        <span className="muted small">
          {x.outcome.by}: {x.outcome.note}
        </span>
      )}
      <ErrorNotice error={act.error} />
      {canSettle && open && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" aria-label="What was found" placeholder="What was found and what was done" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          {(x.outcome?.kind === 'finding' ? (['corrected'] as const) : (['explained', 'corrected', 'finding'] as const)).map((k) => (
            <button key={k} className="btn btn-sm" disabled={act.busy || note.trim().length < 10} onClick={() => act.run(() => api.settleRbaTraceRow(reviewId, x.personId, { kind: k, note }), 'Recorded.')}>
              {k === 'explained' ? 'Explained' : k === 'corrected' ? 'Corrected' : 'Finding'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FilesTab({ companyId }: { companyId: string }) {
  const board = useLoad(() => api.workerFiles(companyId), [companyId]);
  const [open, setOpen] = useState<string | null>(null);
  if (board.error) return <ErrorNotice error={board.error} />;
  if (!board.data) return <Loading what="worker files" />;
  const f: WorkerFilesBoard = board.data;
  const opened = open ? f.rows.find((r) => r.personId === open) : undefined;
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h3>Foreign worker files: {f.company.name}</h3>
        </div>
        <span className="muted small" style={{ padding: '0 12px' }}>
          Nine folders per worker, from the records Prima keeps. "In JA" means the JA Group app keeps it while guards stay there.
        </span>
        {/* P107: the workers as a table; a row opens its nine folders (was an inline fold). */}
        <DataTable
          label="Foreign worker files"
          stateKey="gov.rba.files"
          rows={f.rows}
          rowKey={(r) => r.personId}
          columns={FILE_COLUMNS}
          filters={FILE_FILTERS}
          onRowClick={(r) => setOpen(r.personId)}
          rowTone={(r) => (r.missing ? 'crit' : undefined)}
          empty={<div className="empty">No foreign workers in this company.</div>}
        />
      </section>
      {opened && (
        <Drawer title={`${opened.staffNo} ${opened.name}`} sub={opened.status} onClose={() => setOpen(null)}>
          <div className="list">
            {opened.folders.map((x) => (
              <div key={x.key} className="list-item">
                <span className="small">
                  {x.label} <span className="muted">· {x.detail}</span>
                </span>
                <Chip tone={FOLDER[x.state].tone}>{FOLDER[x.state].t}</Chip>
              </div>
            ))}
          </div>
        </Drawer>
      )}
      {f.contractsMissing && (
        <section className="panel">
          <div className="panel-head">
            <h3>Guards with no signed contract on file ({f.contractsMissing.length})</h3>
          </div>
          <DataTable
            label="Guards with no signed contract"
            stateKey="gov.rba.contracts"
            rows={f.contractsMissing}
            rowKey={(p) => p.personId}
            columns={[
              { id: 'staffNo', label: 'Staff number', value: (p) => p.staffNo, render: (p) => <strong>{p.staffNo}</strong>, phone: 'sub' },
              { id: 'name', label: 'Name', value: (p) => p.name, phone: 'title' },
              { id: 'nationality', label: 'Nationality', value: (p) => p.nationality },
            ]}
            filters={[{ id: 'nationality', label: 'Nationality', value: (p) => p.nationality }]}
            empty={<div className="empty">Every guard and officer has a signed agreement on file.</div>}
          />
        </section>
      )}
    </>
  );
}

type WorkerFile = WorkerFilesBoard['rows'][number];
const FILE_COLUMNS: DtColumn<WorkerFile>[] = [
  { id: 'staffNo', label: 'Staff number', value: (r) => r.staffNo, render: (r) => <strong>{r.staffNo}</strong>, phone: 'sub' },
  { id: 'name', label: 'Name', value: (r) => r.name, phone: 'title' },
  { id: 'status', label: 'Status', value: (r) => r.status, translate: true },
  { id: 'missing', label: 'Folders', value: (r) => r.missing, sort: 'number', search: false, render: (r) => <Chip tone={r.missing ? 'crit' : 'ok'}>{r.missing ? `${r.missing} missing` : 'Complete'}</Chip> },
];
const FILE_FILTERS: DtFilter<WorkerFile>[] = [
  { id: 'files', label: 'Folders', value: (r) => (r.missing ? 'missing' : 'complete'), options: [{ value: 'missing', label: 'Something missing' }, { value: 'complete', label: 'Complete' }] },
  { id: 'status', label: 'Status', value: (r) => r.status },
];

function EthicsTab({ companyId }: { companyId: string | null }) {
  const board = useLoad(() => api.ethicsBoard(companyId), [companyId]);
  const act = useAction();
  const [ticked, setTicked] = useState<string[]>([]);
  const [interests, setInterests] = useState('');
  const [none, setNone] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  if (board.error) return <ErrorNotice error={board.error} />;
  if (!board.data) return <Loading what="ethics declaration" />;
  const e: EthicsBoard = board.data;
  const ethicsRows: EthicsLine[] = e.list
    ? [
        ...e.list.signed
          .filter((d) => !d.interestsNone)
          .map((d) => ({ key: d.id, name: d.name, title: '', interests: d.interests, state: d.review ? (d.review.action === 'managed' ? 'Managed' : 'No conflict') : 'For ACT review', d })),
        ...e.list.missing.map((m) => ({ key: `m-${m.userId}`, name: m.name, title: m.title, interests: '', state: 'Not signed', d: null })),
      ]
    : [];
  const openDecl = openId ? e.list?.signed.find((d) => d.id === openId) : undefined;
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h3>My ethics declaration</h3>
        </div>
        <ErrorNotice error={act.error} />
        {e.mine ? (
          <div style={{ padding: 12 }}>
            <Chip tone="ok">Signed {e.mine.at.slice(0, 10)}</Chip>
            <div className="muted small" style={{ marginTop: 6 }}>
              {e.mine.interestsNone ? 'No interests declared.' : `Interests: ${e.mine.interests}`}
              {e.mine.review ? ` · ACT: ${e.mine.review.action === 'managed' ? 'managed' : 'no conflict'}` : ''}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12 }}>
            {e.statements.map((s) => (
              <label key={s.key} className="row" style={{ gap: 6, alignItems: 'flex-start' }}>
                <input type="checkbox" checked={ticked.includes(s.key)} onChange={(ev) => setTicked(ev.target.checked ? [...ticked, s.key] : ticked.filter((x) => x !== s.key))} />
                <span>{s.text}</span>
              </label>
            ))}
            <textarea className="input" aria-label="Interests" rows={3} placeholder="Interests that could conflict with your work, such as a relative at a supplier or a side business" value={interests} disabled={none} onChange={(ev) => setInterests(ev.target.value)} />
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={none} onChange={(ev) => setNone(ev.target.checked)} />
              <span>I have no such interests</span>
            </label>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || ticked.length < e.statements.length || (!none && interests.trim().length < 10)}
              onClick={() => act.run(() => api.signEthicsDeclaration({ statements: ticked, interests: none ? '' : interests, interestsNone: none }), 'Declaration signed.')}
            >
              Sign
            </button>
          </div>
        )}
      </section>
      {e.list && (
        <section className="panel">
          <div className="panel-head">
            <h3>
              {e.list.signed.length} signed, {e.list.missing.length} not yet
            </h3>
          </div>
          {/* P107: declared interests and those not signed yet in one table; a declared row opens ACT's review. */}
          <DataTable
            label="Ethics declarations"
            stateKey="gov.rba.ethics"
            rows={ethicsRows}
            rowKey={(x) => x.key}
            columns={ETHICS_COLUMNS}
            filters={ETHICS_FILTERS}
            onRowClick={(x) => x.d && setOpenId(x.d.id)}
            rowTone={(x) => (x.state === 'For ACT review' ? 'warn' : undefined)}
          />
        </section>
      )}
      {openDecl && (
        <Drawer title={openDecl.name} sub="Ethics declaration" onClose={() => setOpenId(null)}>
          <InterestRow d={openDecl} canReview={e.canReview} />
        </Drawer>
      )}
    </>
  );
}

type Declared = NonNullable<EthicsBoard['list']>['signed'][number];
type EthicsLine = { key: string; name: string; title: string; interests: string; state: string; d: Declared | null };
const ETHICS_TONE: Record<string, Tone> = { 'For ACT review': 'warn', Managed: 'ok', 'No conflict': 'ok', 'Not signed': 'warn' };
const ETHICS_COLUMNS: DtColumn<EthicsLine>[] = [
  { id: 'name', label: 'Name', value: (x) => x.name, render: (x) => <strong>{x.name}</strong>, phone: 'title' },
  { id: 'title', label: 'Job title', value: (x) => x.title, phone: 'sub', hideBelow: 1000 },
  { id: 'interests', label: 'Interests declared', value: (x) => x.interests, sort: false },
  { id: 'state', label: 'Status', value: (x) => x.state, translate: true, render: (x) => <Chip tone={ETHICS_TONE[x.state] ?? 'neutral'}>{x.state}</Chip> },
];
const ETHICS_FILTERS: DtFilter<EthicsLine>[] = [{ id: 'state', label: 'Status', value: (x) => x.state }];

function InterestRow({ d, canReview }: { d: NonNullable<EthicsBoard['list']>['signed'][number]; canReview: boolean }) {
  const act = useAction();
  const [note, setNote] = useState('');
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <span>
          <strong>{d.name}</strong> declared: {d.interests}
        </span>
        <Chip tone={d.review ? 'ok' : 'warn'}>{d.review ? (d.review.action === 'managed' ? 'Managed' : 'No conflict') : 'For ACT review'}</Chip>
      </div>
      {d.review && <span className="muted small">{d.review.by}: {d.review.note}</span>}
      <ErrorNotice error={act.error} />
      {canReview && !d.review && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" aria-label="Review note" placeholder="Reason, and what was put in place if managed" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <button className="btn btn-sm" disabled={act.busy || note.trim().length < 10} onClick={() => act.run(() => api.reviewEthicsInterests(d.id, { action: 'no_conflict', note }), 'Recorded.')}>
            No conflict
          </button>
          <button className="btn btn-sm" disabled={act.busy || note.trim().length < 10} onClick={() => act.run(() => api.reviewEthicsInterests(d.id, { action: 'managed', note }), 'Recorded.')}>
            Managed
          </button>
        </div>
      )}
    </div>
  );
}
